import type { SkillContext } from "../models/skill";
import type { SBlock, Span, SpanMark } from "../models/sdm";
import { blocksFromJson } from "../models/project";

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
   * Build the system prompt for SDM-native document creation.
   *
   * Instructs the LM to reply with a raw JSON array of SBlock objects so the
   * output can be imported directly without the htmlToBlocks() round-trip.
   * Use this prompt with local GGUF models (phi-3.5-mini, llama-3.2, etc);
   * fall back to buildCreateSystemPrompt() for external APIs that produce HTML.
   *
   * Pair with parseSdmBlocks() to convert the LM reply into SBlock[].
   */
  buildSdmCreateSystemPrompt(skillContext?: SkillContext | null): string;

  /**
   * Build the system prompt for SDM-native document editing.
   *
   * Serialises the current document's blocks as a compact plain-text summary
   * so the LM understands the document structure.  The LM is asked to return
   * the COMPLETE, updated document as a JSON array — same schema as create mode.
   *
   * @param blocks  Current top-level blocks of the document.
   */
  buildSdmEditSystemPrompt(blocks: SBlock[], skillContext?: SkillContext | null): string;

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
      '  1. list item     WRONG  →  correct: <ol class="body"><li>item</li></ul>\n' +
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

  // ── SDM-native prompts ──────────────────────────────────────────────────────

  buildSdmCreateSystemPrompt(skillContext?: SkillContext | null): string {
    return (
      "You are a document creation assistant embedded in Syngrafo.\n\n" +
      "OUTPUT — MANDATORY RULES:\n" +
      "• Reply with ONLY a raw JSON array of SBlock objects.\n" +
      '• First character must be "[", last must be "]".\n' +
      "• Zero prose. Zero markdown fences (no ```). Zero explanations.\n\n" +
      "BLOCK SCHEMA (minimal valid examples):\n" +
      '  Paragraph:     {"type":"p",  "spans":[{"text":"Body text."}]}\n' +
      '  Heading 1:     {"type":"h1", "spans":[{"text":"Title"}]}\n' +
      '  Heading 2–4:   {"type":"h2", "spans":[{"text":"Section"}]}  (h3, h4 same shape)\n' +
      '  Bullet list:   {"type":"ul", "children":[{"type":"li","spans":[{"text":"Item"}]}]}\n' +
      '  Numbered list: {"type":"ol", "children":[{"type":"li","spans":[{"text":"Item"}]}]}\n' +
      '  Divider:       {"type":"hr"}\n' +
      '  Table:         {"type":"table","children":[\n' +
      '                   {"type":"tr","header":true,"children":[{"type":"th","spans":[{"text":"Col"}]}]},\n' +
      '                   {"type":"tr","children":[{"type":"td","spans":[{"text":"Val"}]}]}\n' +
      "                 ]}\n\n" +
      "SPAN MARKS (optional — add \"marks\" array for inline formatting):\n" +
      '  Bold:   {"text":"word","marks":["bold"]}\n' +
      '  Italic: {"text":"word","marks":["italic"]}\n\n' +
      "CONSTRAINTS:\n" +
      "• All text blocks (p h1 h2 h3 h4 li td th) MUST have \"spans\":[{\"text\":\"…\"}] — never omit.\n" +
      "• Lists must wrap li children inside ul/ol — never put li at top level.\n" +
      "• Do NOT include \"id\" fields — assigned automatically.\n" +
      '• "style" field is optional — omit to use defaults.\n' +
      "• Top-level array items must be complete, self-contained blocks.\n" +
      this.buildSkillSection(skillContext)
    );
  }

  buildSdmEditSystemPrompt(blocks: SBlock[], skillContext?: SkillContext | null): string {
    const docContext = buildSdmDocumentContext(blocks);
    return (
      "You are a document editing assistant embedded in Syngrafo.\n\n" +
      "[CURRENT DOCUMENT]\n" +
      docContext +
      "\n\n" +
      "[TASK]\n" +
      "Apply the user's editing request to the document above.\n" +
      "Return the COMPLETE updated document as a raw JSON array of SBlock objects.\n\n" +
      "OUTPUT — MANDATORY RULES:\n" +
      "• Reply with ONLY a raw JSON array.\n" +
      '• First character must be "[", last must be "]".\n' +
      "• Zero prose. Zero markdown fences (no ```). Zero explanations.\n" +
      "• Include ALL blocks — even unchanged ones — in the correct order.\n\n" +
      "BLOCK SCHEMA (same as creation):\n" +
      '  Text:  {"type":"p","spans":[{"text":"…"}]}  — also h1 h2 h3 h4\n' +
      '  List:  {"type":"ul","children":[{"type":"li","spans":[{"text":"…"}]}]}\n' +
      '  Table: {"type":"table","children":[{"type":"tr","children":[{"type":"td","spans":[{"text":"…"}]}]}]}\n' +
      '  HR:    {"type":"hr"}\n' +
      "• Do NOT include \"id\" fields.\n" +
      this.buildSkillSection(skillContext)
    );
  }

  // ── NLP annotation ──────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// SDM document context serialiser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialise a block array to a compact, token-efficient plain-text summary
 * for inclusion in the edit system prompt.  Only top-level blocks are shown;
 * nested content is abbreviated to stay within context budgets.
 *
 * @example
 *   [1] h1: "Project Report"
 *   [2] p:  "Executive summary…"
 *   [3] ul: • Item A • Item B +1 more
 *   [4] table (3 rows)
 */
export function buildSdmDocumentContext(blocks: SBlock[]): string {
  if (!blocks.length) return "(empty document)";
  const lines: string[] = [];

  blocks.forEach((b, i) => {
    const idx = i + 1;
    switch (b.type) {
      case "p":
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "quote":
      case "figcaption": {
        const text = b.spans.map((s) => s.text).join("").slice(0, 80);
        lines.push(`[${idx}] ${b.type}: "${text}"`);
        break;
      }
      case "ul":
      case "ol": {
        const bullets = b.children.slice(0, 3).map(
          (c) => "• " + c.spans.map((s) => s.text).join("").slice(0, 40),
        );
        const extra = b.children.length > 3 ? ` +${b.children.length - 3} more` : "";
        lines.push(`[${idx}] ${b.type}: ${bullets.join(" ")}${extra}`);
        break;
      }
      case "hr":
        lines.push(`[${idx}] hr`);
        break;
      case "table":
        lines.push(`[${idx}] table (${b.children.length} rows)`);
        break;
      case "hbox":
      case "vbox":
      case "col":
      case "grid":
        lines.push(`[${idx}] ${b.type} (layout, ${b.children.length} children)`);
        break;
      case "img": {
        const src = b.src.slice(0, 40);
        lines.push(`[${idx}] img: ${src}${b.alt ? ` alt="${b.alt}"` : ""}`);
        break;
      }
      case "callout":
        lines.push(`[${idx}] callout (${b.variant})${b.title ? `: "${b.title}"` : ""}`);
        break;
      case "code":
        lines.push(
          `[${idx}] code${b.language ? ` (${b.language})` : ""}: "${b.text.slice(0, 60)}"`,
        );
        break;
      case "pagebreak":
        lines.push(`[${idx}] pagebreak`);
        break;
      default: {
        // Future block types — show what we know.
        lines.push(`[${idx}] ${(b as SBlock).type}`);
      }
    }
  });

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// SDM block parser — converts LM JSON output into validated SBlock[]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a raw `spans` value from LM output into a valid `Span[]`.
 *
 * LMs commonly produce one of three broken formats:
 *   - `"spans": "plain text"`          — string instead of array
 *   - `"spans": ["a", "b"]`            — array of plain strings
 *   - `"spans": [{"text": "ok"}]`      — already correct (passed through)
 */
function normalizeRawSpans(raw: unknown): Span[] {
  if (typeof raw === "string") return raw.trim() ? [{ text: raw }] : [];
  if (!Array.isArray(raw)) return [];

  const result: Span[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) result.push({ text: item });
      continue;
    }
    if (item && typeof item === "object") {
      const obj  = item as Record<string, unknown>;
      const text = typeof obj["text"] === "string" ? obj["text"] : String(obj["text"] ?? "");
      if (!text) continue;
      const rawMarks = obj["marks"];
      const marks    = Array.isArray(rawMarks)
        ? (rawMarks as unknown[]).filter((m): m is SpanMark => typeof m === "string")
        : undefined;
      const href = typeof obj["href"] === "string" ? obj["href"] : undefined;
      result.push({
        text,
        ...(marks?.length ? { marks } : {}),
        ...(href          ? { href  } : {}),
      });
    }
  }
  return result;
}

/**
 * Recursively walk a block from LM output, normalising `spans` fields from
 * any of the degenerate formats the LM might produce, and recursing into any
 * `children` array.  Does not modify `type`, `id`, or other fields.
 */
function normalizeSdmBlock(block: SBlock): SBlock {
  let result: SBlock = block;

  // Normalise spans on all text-bearing blocks (p, h1–h4, li, td, th, …).
  if ("spans" in result) {
    const spans = normalizeRawSpans((result as unknown as { spans: unknown }).spans);
    result = { ...result, spans } as SBlock;
  }

  // Recurse into children (ul/ol → li, table → tr → td/th, hbox → col, …).
  if (
    "children" in result &&
    Array.isArray((result as unknown as { children?: unknown }).children)
  ) {
    const orig   = (result as unknown as { children: SBlock[] }).children;
    const normed = orig.map(normalizeSdmBlock);
    result = { ...result, children: normed } as SBlock;
  }

  return result;
}

/**
 * Strip markdown code fences and unwrap common object wrappers that LMs
 * place around a JSON array.  Returns a string that should start with `[`.
 */
function stripLMFences(text: string): string {
  let t = text.trim();

  // Remove ` ```json ` … ` ``` ` or ` ``` ` … ` ``` `
  t = t.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

  // Unwrap object wrappers: {"blocks":[...]}, {"content":[...]}, etc.
  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      for (const key of ["blocks", "content", "data", "result"]) {
        if (Array.isArray(obj[key])) return JSON.stringify(obj[key]);
      }
    } catch {
      // Not valid JSON — fall through; blocksFromJson will produce the error.
    }
  }

  return t;
}

/**
 * Parse and normalise LM-generated text into a valid `SBlock[]`.
 *
 * Handles the common quirks of LM JSON output:
 * - Markdown fences (` ```json ` … ` ``` ` or plain ` ``` `)
 * - Object wrappers like `{"blocks": [...]}`
 * - `"spans"` as a plain string or an array of strings
 * - Missing `id` fields — fresh UUIDs are assigned via `blocksFromJson`
 * - Preserved `marks` and `href` on span objects
 *
 * @throws `Error` if the text cannot be parsed as a JSON array after cleanup.
 *
 * @example
 *   const blocks = parseSdmBlocks(lmResponse.text);
 *   dispatch({ type: "IMPORT_BLOCKS", blocks });
 */
export function parseSdmBlocks(text: string): SBlock[] {
  const cleaned = stripLMFences(text);
  // blocksFromJson handles JSON parsing, throws descriptively on bad input,
  // and walks the tree assigning UUIDs to any block missing an id field.
  const blocks = blocksFromJson(cleaned);
  return blocks.map(normalizeSdmBlock);
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
