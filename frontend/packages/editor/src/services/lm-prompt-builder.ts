import type { SkillContext } from "../models/skill";

/** Minimal shape expected from a StyleClass for prompt embedding. */
export interface StyleEntry {
  id: string;
  name: string;
  baseTag: string;
  /** Short purpose hint shown to the LM — helps it pick the right class. */
  hint?: string;
}

const BUILTIN_HINTS: Record<string, string> = {
  title: "Document title — large, centered",
  heading1: "Top-level section heading",
  heading2: "Subsection heading",
  heading3: "Minor heading",
  lead: "Prominent intro paragraph — slightly larger body",
  body: "Standard body text",
  "body-sm": "Small body / fine print",
  subtitle: "Subtitle or byline — centered, lighter weight",
  caption: "Image or table caption — italic, centered",
  quote: "Pull quote or blockquote — indented with left border",
  note: "Callout note or aside — tinted background",
  code: "Inline or block code — monospace",
  "table-info": "General-purpose data table",
  "footer-text": "Footer paragraph text",
  "footer-note": "Footer fine print / legal",
  "footer-container": "Horizontal footer layout box",
  "footer-bar-container": "Bottom footer bar with top border",
  "footer-column": "Vertical column inside a footer box",
};

export interface ILMPromptBuilder {
  buildCreateSystemPrompt(styles: StyleEntry[], skillContext?: SkillContext | null): string;

  buildEditSystemPrompt(styles: StyleEntry[], skillContext?: SkillContext | null): string;

  buildBlockPatchSystemPrompt(styles: StyleEntry[], skillContext?: SkillContext | null): string;

  /**
   * Build the NLPWriter annotation system prompt.
   * Instructs the LM to wrap each word in a <span> with Penn Treebank POS tags,
   * keyword flags, and named-entity type attributes.
   *
   * Used by NLPWriter when the C++ NLP engine is unavailable and the LM is
   * used as a fallback annotator.
   *
   * @param lang  Optional ISO 639-1 language code, e.g. "en" | "de" | "fr".
   *              Appended as a language hint in the system prompt.
   */
  buildNLPAnnotationSystemPrompt?(lang?: string): string;
}

export class LMPromptBuilder implements ILMPromptBuilder {
  /** Build a compact, human-readable style list for embedding in prompts. */
  private buildStyleCatalog(styles: StyleEntry[]): string {
    if (!styles.length) return "  (none defined)";
    const byTag: Record<string, string[]> = {};
    for (const s of styles) {
      const tag = s.baseTag || "any";
      const hint = s.hint ?? BUILTIN_HINTS[s.id];
      const label = hint ? `"${s.id}" — ${hint}` : `"${s.id}" (${s.name})`;
      (byTag[tag] ??= []).push(label);
    }
    return Object.entries(byTag)
      .map(([tag, ids]) => `  <${tag}>: ${ids.join(", ")}`)
      .join("\n");
  }

  /**
   * If a skill is active, emit a labeled section to inject above the style
   * catalog.  Returns an empty string when no skill context is provided.
   */
  private buildSkillSection(skillContext?: SkillContext | null): string {
    if (!skillContext?.instructions) return "";
    return `\nSkill: ${skillContext.name}\n` + `${skillContext.instructions}\n`;
  }

  buildCreateSystemPrompt(styles: StyleEntry[], skillContext?: SkillContext | null): string {
    const catalog = this.buildStyleCatalog(styles);
    return (
      "You are a document writing assistant embedded in a PDF editor. " +
      "Always respond with raw HTML only — no Markdown, no explanations, no prose outside tags. " +
      "Supported block tags: <h1> <h2> <h3> <p> <ul> <ol> <li> <table> <thead> <tbody> <tr> <td> <th> <hr> <strong> <em> <br>. " +
      "You MAY also output inline SVG as a top-level <svg> element — it will be automatically saved as an image asset.\n" +
      "Rules:\n" +
      "• Wrap list items inside <ul> or <ol>.\n" +
      "• Tables MUST use <table><thead><tr><th>…</th></tr></thead><tbody><tr><td>…</td></tr></tbody></table>.\n" +
      "• Add a class= attribute to every block element using exactly one styleId from the catalog below.\n" +
      '  Example: <h1 class="heading1">My Title</h1>  <p class="body">Body text</p>\n' +
      '  Example: <ul class="body"><li>Item 1</li><li>Item 2</li></ul>\n' +
      "• NEVER use <div>, <span>, <script>, or any tag not listed above.\n" +
      "• NEVER add prose, preamble, or explanations outside the HTML tags.\n" +
      this.buildSkillSection(skillContext) +
      "\nAvailable style IDs (use ONLY these):\n" +
      catalog
    );
  }

  buildEditSystemPrompt(styles: StyleEntry[], skillContext?: SkillContext | null): string {
    const catalog = this.buildStyleCatalog(styles);
    return (
      "You are a document editing assistant embedded in a PDF editor.\n\n" +
      "══ OUTPUT FORMAT — READ THIS FIRST, FOLLOW IT EXACTLY ══\n" +
      "Your entire response MUST be raw HTML — nothing else.\n" +
      "ONE character of Markdown in your reply means the output is discarded.\n\n" +
      "FORBIDDEN — never write these:\n" +
      '  # Heading        WRONG  →  correct: <h1 class="heading1">Heading</h1>\n' +
      '  ## Heading       WRONG  →  correct: <h2 class="heading2">Heading</h2>\n' +
      '  ### Heading      WRONG  →  correct: <h3 class="heading3">Heading</h3>\n' +
      "  **bold**         WRONG  →  correct: <strong>bold</strong>\n" +
      "  *italic*         WRONG  →  correct: <em>italic</em>\n" +
      '  ```code```       WRONG  →  correct: <pre class="code"><code>code</code></pre>\n' +
      '  - list item      WRONG  →  correct: <ul class="body"><li>item</li></ul>\n' +
      '  1. list item     WRONG  →  correct: <ol class="body"><li>item</li></ol>\n' +
      '  plain text line  WRONG  →  correct: <p class="body">text line</p>\n\n' +
      "══ TASK ══\n" +
      "[DOCUMENT] contains the current document as HTML.\n" +
      "[REQUEST] contains what the user wants changed.\n" +
      "Apply the request. Return the COMPLETE modified document as raw HTML.\n\n" +
      "══ RULES ══\n" +
      "• Every block element MUST carry a class= attribute from the style catalog below.\n" +
      '  Correct: <h2 class="heading2">Section</h2>   <p class="body">Text.</p>\n' +
      "• Preserve class= and data-block-id= on blocks you do not change.\n" +
      "• Allowed tags: <h1> <h2> <h3> <p> <ul> <ol> <li> <table> <thead> <tbody> <tr> <td> <th> <hr> <strong> <em> <br>.\n" +
      "• NEVER use <div>, <span>, <script>, or any tag not listed above.\n" +
      "• Do NOT write anything outside HTML tags — no intro, no summary, no explanation.\n" +
      this.buildSkillSection(skillContext) +
      "\n══ STYLE CATALOG — class= values, use ONLY these ══\n" +
      catalog
    );
  }

  buildBlockPatchSystemPrompt(styles: StyleEntry[], skillContext?: SkillContext | null): string {
    const styleCatalog = this.buildStyleCatalog(styles);
    return (
      "You are a document block editor. " +
      "The user sends [BLOCKS] — a JSON array where each entry has:\n" +
      "  id      : block identifier (use EXACT IDs for update/delete/move)\n" +
      "  type    : block element type (h1 h2 h3 p ul ol table hr img)\n" +
      "  styleId : CSS style class currently applied to the block\n" +
      "  preview : plain-text content excerpt\n\n" +
      "The user also sends [REQUEST] — their editing instruction.\n\n" +
      "Reply with ONLY a valid JSON array of patch operations. No prose, no markdown fences.\n\n" +
      "Available patch operations:\n" +
      '  {"op":"create","afterId":"<id|null>","type":"<h1|h2|h3|p|ul|ol|table|hr>","content":"<innerHTML>","styleId":"<id>"}\n' +
      '  {"op":"update","id":"<id>","content":"<new innerHTML>"}\n' +
      '  {"op":"update","id":"<id>","styleId":"<style-id>"}\n' +
      '  {"op":"update","id":"<id>","content":"...","styleId":"..."}\n' +
      '  {"op":"delete","id":"<id>"}\n' +
      '  {"op":"move","id":"<id>","afterId":"<other-id|null>"}\n\n' +
      "Content format rules:\n" +
      '- Lists:  content = "<li>Item 1</li><li>Item 2</li>"\n' +
      '- Tables: content = "<thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody>"\n' +
      "- SVG:    type=img, content = \"<svg xmlns='...' ...>…</svg>\" (auto-saved as asset)\n\n" +
      "Available style IDs (use ONLY these):\n" +
      styleCatalog +
      this.buildSkillSection(skillContext) +
      "\nRules:\n" +
      "- UPDATE: preserve existing styleId unless the user asks to change it.\n" +
      "- CREATE: pick the most appropriate styleId from the catalog.\n" +
      "- Only reference IDs that appear in [BLOCKS].\n" +
      "- afterId=null inserts at the top; use last block's id to append at the end.\n" +
      "- Return [] ONLY if NO changes are necessary — never return [] on parse errors.\n" +
      "- Output must be valid JSON — nothing else."
    );
  }

  /**
   * Build the NLPWriter annotation system prompt.
   *
   * The LM is instructed to output each word as an HTML <span> element with:
   *   data-pos  — Penn Treebank POS tag (NN, VB, JJ, RB, IN, DT, CC, PRP, …)
   *   data-kw   — "1" if the word is a topical keyword, "0" otherwise
   *   data-ner  — named entity type (PERSON, ORG, GPE, LOC, DATE) or omitted
   *
   * This prompt is used when the C++ NLP engine is unavailable and the LM is
   * serving as a fallback annotator.  Results are parsed by nlp-analyzer.ts.
   *
   * @param lang  Optional ISO 639-1 language code hint (e.g. "en", "de", "fr").
   */
  buildNLPAnnotationSystemPrompt(lang?: string): string {
    return (
      "You are a linguistic annotation assistant. Output each word as an HTML span with data attributes.\n" +
      'Format: <span data-pos="NN" data-kw="0">word</span>\n' +
      "Rules:\n" +
      "• Every word (not punctuation) must be wrapped in a span.\n" +
      "• data-pos: Penn Treebank POS tag (NN, VB, JJ, RB, IN, DT, CC, PRP, etc.)\n" +
      '• data-kw: "1" if the word is a topical keyword, "0" otherwise.\n' +
      "• data-ner: named entity type (PERSON, ORG, GPE, LOC, DATE) or omit if none.\n" +
      '• Wrap the full paragraph in <p class="body">…</p>.\n' +
      "• Output raw HTML only. No prose, no markdown.\n" +
      (lang ? `• Language: ${lang}\n` : "")
    );
  }
}

/**
 * Default singleton — use directly or replace via DI container.
 *
 * @example
 *   // replace for testing:
 *   import { lmPromptBuilder } from "./lm-prompt-builder";
 *   Object.assign(lmPromptBuilder, myMockBuilder);
 */
export const lmPromptBuilder: ILMPromptBuilder = new LMPromptBuilder();
