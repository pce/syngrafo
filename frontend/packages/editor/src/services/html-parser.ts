import { Block, BlockType, CalloutVariant } from "../models/block";
import { StyleLibrary, StyleClass, CSSProperties } from "../models/style";

/**
 * Abstraction over the asset persistence layer.
 * The default implementation is a no-op; replace via configureHtmlParser()
 * for environments that need real asset persistence.
 */
export interface IAssetStore {
  saveAsset(data: string, filename: string): void;
}

/**
 * Full interface for the HTML parser — enables injection into LMService,
 * ChatPanel, and other consumers for testing / alternative implementations.
 */
export interface IHtmlParser {
  parseDocument(html: string): Document;
  cleanInput(html: string): string;
  toBlocks(html: string, lib?: StyleLibrary, doc?: Document): Block[];
  importWithStyles(html: string, lib: StyleLibrary): ImportHtmlResult;
  toHtml(blocks: Block[]): string;
  parseCss(css: string): Record<string, CSSProperties>;
}

/**
 * Default no-op asset store.
 * SVG data-URIs are "saved" silently.  Supply a real store via
 * configureHtmlParser({ assetStore: … }) when asset persistence is required.
 */
const _noOpAssetStore: IAssetStore = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  saveAsset(_data: string, _filename: string): void {
    /* no-op — swap via configureHtmlParser() for persistent asset storage */
  },
};

interface HtmlParserConfig {
  assetStore: IAssetStore;
}

let _config: HtmlParserConfig = {
  assetStore: _noOpAssetStore,
};

/**
 * Override parser dependencies (useful for testing or alternative environments).
 *
 * @example
 *   configureHtmlParser({ assetStore: mockAssetStore });
 */
export function configureHtmlParser(config: Partial<HtmlParserConfig>): void {
  _config = { ..._config, ...config };
}

/**
 * Tags that become top-level blocks when encountered directly.
 */
const BLOCK_TAGS = new Set<string>([
  "h1",
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "table",
  "figure",
  "pre",
  "hr",
  "img",
  "svg", // handled separately → asset + img block
  "code", // top-level <code> rare but valid
]);

/**
 * Container tags whose children should be recursively flattened into blocks
 * instead of the container itself becoming a block.
 * NOTE: These are checked AFTER the data-block-type check, so a div with
 * data-block-type="callout" is handled as a callout, not recursed.
 */
const CONTAINER_TAGS = new Set<string>(["div", "section", "article", "main", "header", "footer", "aside", "nav", "form", "fieldset"]);

/**
 * Inline-level tags that the LM sometimes emits at block level.
 * Wrap them in a <p> so they don't vanish.
 */
const INLINE_BLOCK_TAGS = new Set<string>(["strong", "em", "b", "i", "u", "s", "span", "a", "abbr", "mark", "small"]);

/**
 * Strip markdown code fences and leading/trailing whitespace from an HTML string.
 * Call this ONCE before parsing — do not call on already-cleaned strings.
 */
export function cleanHtmlInput(html: string): string {
  return html
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * THE ONLY DOMParser call in the frontend codebase.
 *
 * Parse a (cleaned) HTML string and return the resulting Document.
 * All other functions that need a DOM accept a pre-parsed Document or call
 * this function once and pass the result around.
 */
export function parseHtmlDocument(html: string): Document {
  const cleaned = cleanHtmlInput(html);
  // Safety guard: refuse obvious JSON (prevents data corruption on LM fail)
  if (/^\s*[\[{]/.test(cleaned)) {
    console.warn("[html-parser] Input looks like JSON, not HTML — returning empty document");
    return new DOMParser().parseFromString("", "text/html");
  }
  return new DOMParser().parseFromString(cleaned, "text/html");
}

/** Convert a kebab-case CSS property name to camelCase. */
export function kebabToCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Parse a CSS text string into a map of   selector → CSSProperties.
 *
 * Only simple single-class selectors `.foo` are handled; compound selectors,
 * pseudo-classes, and at-rules are silently ignored.
 *
 * @param css  The raw CSS text (e.g. the textContent of a <style> element).
 */
export function parseCssText(css: string): Record<string, CSSProperties> {
  const result: Record<string, CSSProperties> = {};
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleRegex = /([^{]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(stripped)) !== null) {
    const rawSels = (m[1] ?? "").trim();
    const body = (m[2] ?? "").trim();
    for (const sel of rawSels.split(",")) {
      const selector = sel.trim();
      if (!/^\.[\w-]+$/.test(selector)) continue;
      const classId = selector.slice(1);
      const props: CSSProperties = result[classId] ?? {};
      for (const decl of body.split(";")) {
        const ci = decl.indexOf(":");
        if (ci === -1) continue;
        const rawProp = decl.slice(0, ci).trim();
        const value = decl.slice(ci + 1).trim();
        if (!rawProp || !value) continue;
        props[kebabToCamel(rawProp)] = value;
      }
      result[classId] = props;
    }
  }
  return result;
}

/**
 * Guess a BlockType baseTag from CSS declarations and/or the actual element tag.
 */
export function inferBaseTagFromCSS(declarations: CSSProperties, elementTag?: string): string {
  const validTags = ["h1", "h2", "h3", "p", "ul", "ol", "li", "figcaption", "code", "table"];
  if (elementTag && validTags.includes(elementTag)) return elementTag;
  const fsSrc = declarations.fontSize ?? "";
  const fs = parseInt(fsSrc, 10) || 0;
  const pxApprox = fsSrc.endsWith("pt") ? fs * 1.333 : fs;
  if (pxApprox >= 28) return "h1";
  if (pxApprox >= 20) return "h2";
  if (pxApprox >= 16) return "h3";
  if (declarations.fontFamily?.toLowerCase().includes("mono")) return "code";
  return "p";
}

/**
 * Encode an SVG string as a data URI (SVG is text-based; no need for base64).
 */
export function svgToDataUri(svgContent: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgContent);
}

interface BuildContext {
  lib?: StyleLibrary | undefined;
  tagStyleMap: Record<string, string>;
  uid: number;
  idPrefix: string;
  assetStore: IAssetStore;
}

function resolveStyle(tag: string, ctx: BuildContext, className?: string): string | undefined {
  if (className && ctx.lib) {
    for (const cls of className.split(/\s+/).filter(Boolean)) {
      if (ctx.lib.hasStyle(cls)) return cls;
    }
  }
  return ctx.tagStyleMap[tag] ?? undefined;
}

function newId(type: string, ctx: BuildContext): string {
  return `${ctx.idPrefix}-${type}-${Date.now()}-${ctx.uid++}`;
}

/**
 * Entry point: walk a parsed Document and return Block[].
 * Delegates to buildBlocksFromChildren on the body element.
 */
function buildBlocksFromDocument(doc: Document, ctx: BuildContext): Block[] {
  return buildBlocksFromChildren(doc.body, ctx);
}

/**
 * Recursively walk the children of `parent` and produce Block[].
 *
 * Handles:
 *   - data-block-type markers → callout / reveal / columns blocks
 *   - orphan <li> elements    → collected into a single <ul> block
 *   - container tags          → recursed (div, section, article, …)
 *   - h4/h5/h6                → folded to h3
 *   - blockquote              → p, or recursed if it contains block children
 *   - inline tags at block    → wrapped in p so they are not silently dropped
 *   - top-level text nodes    → wrapped in p
 *   - all BLOCK_TAGS          → direct Block creation
 */
function buildBlocksFromChildren(parent: Element, ctx: BuildContext): Block[] {
  const blocks: Block[] = [];
  let orphanLis: Element[] = [];

  const flushOrphanLis = () => {
    if (orphanLis.length === 0) return;
    const content = orphanLis.map((li) => `<li>${li.innerHTML.trim()}</li>`).join("");
    blocks.push(new Block(newId("ul", ctx), "ul", content, resolveStyle("ul", ctx)));
    orphanLis = [];
  };

  for (const node of Array.from(parent.childNodes)) {
    // ── Bare text nodes → p ───────────────────────────────────────────────
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) {
        flushOrphanLis();
        blocks.push(new Block(newId("p", ctx), "p", text, resolveStyle("p", ctx)));
      }
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const cls = el.getAttribute("class") ?? undefined;

    // ── Orphan <li> — collect until the run ends ──────────────────────────
    if (tag === "li") {
      orphanLis.push(el);
      continue;
    }
    flushOrphanLis();

    // ── Typed blocks via data-block-type ──────────────────────────────────
    // Checked before container-tag recursion so that a
    // <div data-block-type="callout"> is treated as a callout, not recursed.
    const dataBlockType = el.getAttribute("data-block-type");

    if (dataBlockType === "callout") {
      const variant = (el.getAttribute("data-variant") ?? "info") as CalloutVariant;
      const content = el.innerHTML.trim();
      const b = new Block(newId("callout", ctx), "callout", content, resolveStyle("callout", ctx, cls));
      b.setMetadata({ variant });
      blocks.push(b);
      continue;
    }

    if (dataBlockType === "reveal") {
      const beforeSrc = el.getAttribute("data-before-src") ?? "";
      const afterSrc = el.getAttribute("data-after-src") ?? "";
      const splitAxis = (el.getAttribute("data-split-axis") ?? "v") as "v" | "h";
      const splitRatio = parseFloat(el.getAttribute("data-split-ratio") ?? "0.5");
      const b = new Block(newId("reveal", ctx), "reveal", "", resolveStyle("reveal", ctx, cls));
      b.setMetadata({ beforeSrc, afterSrc, splitAxis, splitRatio, interactive: true });
      blocks.push(b);
      continue;
    }

    if (dataBlockType === "columns") {
      const childBlocks = buildBlocksFromChildren(el, ctx);
      const n = childBlocks.length || 1;
      const columnsBlock = new Block(newId("columns", ctx), "columns", "", resolveStyle("columns", ctx, cls));
      columnsBlock.setMetadata({
        splitAxis: "v" as const,
        ratios: childBlocks.map(() => 1 / n),
        children: childBlocks.map((b) => b.getId()),
      });
      blocks.push(columnsBlock, ...childBlocks);
      continue;
    }

    // ── SVG → data-URI asset + img block ─────────────────────────────────
    if (tag === "svg") {
      const svgStr = new XMLSerializer().serializeToString(el);
      const dataUri = svgToDataUri(svgStr);
      ctx.assetStore.saveAsset(dataUri, `svg-${Date.now()}.svg`);
      blocks.push(new Block(newId("img", ctx), "img", dataUri, resolveStyle("img", ctx)));
      continue;
    }

    // ── HR ────────────────────────────────────────────────────────────────
    if (tag === "hr") {
      blocks.push(new Block(newId("hr", ctx), "hr", ""));
      continue;
    }

    // ── IMG ───────────────────────────────────────────────────────────────
    if (tag === "img") {
      const src = (el as HTMLImageElement).getAttribute("src") ?? "";
      if (src) blocks.push(new Block(newId("img", ctx), "img", src, resolveStyle("img", ctx, cls)));
      continue;
    }

    // ── TABLE ─────────────────────────────────────────────────────────────
    if (tag === "table") {
      const content = el.innerHTML.trim();
      if (content) blocks.push(new Block(newId("table", ctx), "table", content, resolveStyle("table", ctx, cls)));
      continue;
    }

    // ── FIGURE (img + optional figcaption) ────────────────────────────────
    if (tag === "figure") {
      const imgEl = el.querySelector("img");
      const capEl = el.querySelector("figcaption");
      if (imgEl) {
        const src = imgEl.getAttribute("src") ?? "";
        if (src) blocks.push(new Block(newId("img", ctx), "img", src, resolveStyle("img", ctx)));
      }
      if (capEl) {
        const capContent = capEl.innerHTML.trim();
        if (capContent) blocks.push(new Block(newId("figcaption", ctx), "figcaption", capContent, resolveStyle("figcaption", ctx, cls)));
      }
      continue;
    }

    // ── PRE / top-level CODE ──────────────────────────────────────────────
    if (tag === "pre" || tag === "code") {
      const inner = el.querySelector("code");
      const content = inner ? inner.innerHTML.trim() : el.innerHTML.trim();
      if (content) blocks.push(new Block(newId("code", ctx), "code", content, resolveStyle("code", ctx, cls)));
      continue;
    }

    // ── Standard block tags (h1 h2 h3 p ul ol) ───────────────────────────
    if (BLOCK_TAGS.has(tag)) {
      const content = el.innerHTML.trim();
      if (content) blocks.push(new Block(newId(tag, ctx), tag as BlockType, content, resolveStyle(tag, ctx, cls)));
      continue;
    }

    // ── h4 / h5 / h6 → fold to h3 ────────────────────────────────────────
    if (tag === "h4" || tag === "h5" || tag === "h6") {
      const content = el.innerHTML.trim();
      if (content) blocks.push(new Block(newId("h3", ctx), "h3", content, resolveStyle("h3", ctx, cls)));
      continue;
    }

    // ── blockquote ────────────────────────────────────────────────────────
    if (tag === "blockquote") {
      const hasBlockChild = Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()) || CONTAINER_TAGS.has(c.tagName.toLowerCase()));
      if (hasBlockChild) {
        blocks.push(...buildBlocksFromChildren(el, ctx));
      } else {
        const content = el.innerHTML.trim();
        if (content) blocks.push(new Block(newId("p", ctx), "p", content, resolveStyle("p", ctx, cls)));
      }
      continue;
    }

    // ── Container tags → recurse ──────────────────────────────────────────
    if (CONTAINER_TAGS.has(tag)) {
      blocks.push(...buildBlocksFromChildren(el, ctx));
      continue;
    }

    // ── Inline elements at block level → wrap in p ────────────────────────
    if (INLINE_BLOCK_TAGS.has(tag)) {
      const content = el.outerHTML.trim();
      if (content) blocks.push(new Block(newId("p", ctx), "p", content, resolveStyle("p", ctx)));
      continue;
    }

    // ── Unknown tags — try innerHTML as a p fallback ──────────────────────
    const fallback = el.innerHTML.trim();
    if (fallback) blocks.push(new Block(newId("p", ctx), "p", fallback, resolveStyle("p", ctx)));
  }

  flushOrphanLis();
  return blocks;
}

/**
 * Default implementation of IHtmlParser.
 * Relies on _config.assetStore for SVG persistence (injectable via configureHtmlParser).
 */
export class HtmlParser implements IHtmlParser {
  constructor(private assetStore?: IAssetStore) {}

  private getAssetStore(): IAssetStore {
    return this.assetStore ?? _config.assetStore;
  }

  parseDocument(html: string): Document {
    return parseHtmlDocument(html);
  }

  cleanInput(html: string): string {
    return cleanHtmlInput(html);
  }

  parseCss(css: string): Record<string, CSSProperties> {
    return parseCssText(css);
  }

  toBlocks(html: string, lib?: StyleLibrary, _doc?: Document): Block[] {
    const doc = _doc ?? parseHtmlDocument(html);
    const tagStyleMap: Record<string, string> = {};
    if (lib) {
      for (const style of lib.getAllStyles()) {
        const t = style.getBaseTag();
        if (!tagStyleMap[t] && style.isBuiltIn()) tagStyleMap[t] = style.getId();
      }
    }
    const ctx: BuildContext = {
      ...(lib !== undefined ? { lib } : {}),
      tagStyleMap,
      uid: 0,
      idPrefix: "lm",
      assetStore: this.getAssetStore(),
    };
    const blocks = buildBlocksFromDocument(doc, ctx);
    if (!blocks.length) {
      const cleaned = cleanHtmlInput(html);
      if (cleaned) {
        const styleId = tagStyleMap["p"] ?? undefined;
        blocks.push(new Block(`lm-p-${Date.now()}-0`, "p", cleaned, styleId));
      }
    }
    return blocks;
  }

  importWithStyles(html: string, lib: StyleLibrary): ImportHtmlResult {
    const doc = parseHtmlDocument(html);

    const cssRuleMap: Record<string, CSSProperties> = {};
    doc.querySelectorAll("style").forEach((styleEl) => {
      const rules = parseCssText(styleEl.textContent ?? "");
      for (const [classId, props] of Object.entries(rules)) {
        cssRuleMap[classId] = { ...(cssRuleMap[classId] ?? {}), ...props };
      }
    });

    const tagForClass: Record<string, string> = {};
    for (const el of Array.from(doc.body.querySelectorAll("*"))) {
      const t = el.tagName.toLowerCase();
      if (!BLOCK_TAGS.has(t)) continue;
      for (const cls of (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) {
        if (!tagForClass[cls]) tagForClass[cls] = t;
      }
    }

    const newStyleIds: string[] = [];
    for (const [classId, props] of Object.entries(cssRuleMap)) {
      if (lib.hasStyle(classId)) continue;
      if (Object.keys(props).length === 0) continue;
      const baseTag = inferBaseTagFromCSS(props, tagForClass[classId]);
      const name = classId
        .replace(/([A-Z])/g, " $1")
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
      lib.addStyle(new StyleClass(classId, name, baseTag, props, false));
      newStyleIds.push(classId);
    }

    const tagStyleMap: Record<string, string> = {};
    for (const style of lib.getAllStyles()) {
      const t = style.getBaseTag();
      if (!tagStyleMap[t] && style.isBuiltIn()) tagStyleMap[t] = style.getId();
    }

    const ctx: BuildContext = {
      ...(lib !== undefined ? { lib } : {}),
      tagStyleMap,
      uid: 0,
      idPrefix: "import",
      assetStore: this.getAssetStore(),
    };
    const blocks = buildBlocksFromDocument(doc, ctx);

    return { blocks, importedStyleCount: newStyleIds.length, newStyleIds };
  }

  toHtml(blocks: Block[]): string {
    return blocksToHtml(blocks);
  }
}

/**
 * Default HtmlParser singleton.
 * Replace via injection for testing; configure the asset store via configureHtmlParser().
 */
export const htmlParser: IHtmlParser = new HtmlParser();

/** @see IHtmlParser.toBlocks */
export function htmlToBlocks(html: string, lib?: StyleLibrary, _doc?: Document): Block[] {
  return htmlParser.toBlocks(html, lib, _doc);
}

/** @see IHtmlParser.importWithStyles */
export function importHtmlWithStyles(html: string, lib: StyleLibrary): ImportHtmlResult {
  return htmlParser.importWithStyles(html, lib);
}

export interface ImportHtmlResult {
  blocks: Block[];
  /** Number of newly registered StyleClass objects. */
  importedStyleCount: number;
  /** IDs of the newly created styles. */
  newStyleIds: string[];
}

/**
 * Serialise document blocks to compact HTML for LM context.
 *
 * Adds class= attributes so the model can see which style ID is applied.
 * data-block-id= attributes are included so the LM can reference exact block IDs.
 *
 * Handling for extended editor block types:
 *   callout   → <div data-block-type="callout" data-variant="…">…</div>
 *   reveal    → <div data-block-type="reveal" data-before-src="…" …></div>
 *   stream    → <div data-block-type="stream">…</div>
 *   nlp-block → <p …>…</p>      (NLP annotations are NOT serialised to HTML)
 *   nlp-tree  → <figure data-block-type="nlp-tree">…</figure>
 *   raw-html  → content verbatim (no wrapping element)
 *   embed     → <iframe src="…" allowfullscreen></iframe>
 *   columns   → <div data-block-type="columns">…</div>
 *   hbox/vbox → <div data-block-type="hbox|vbox">…</div>
 *
 * SVG data URIs are truncated to keep the token count down.
 */
export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      const tag = b.getType();
      const content = b.getContent();
      const cls = b.getStyleId() ? ` class="${b.getStyleId()}"` : "";
      const id = ` data-block-id="${b.getId()}"`;

      // ── Void / special core blocks ────────────────────────────────────
      if (tag === "hr" || tag === "pagebreak") return `<hr${id}>`;

      if (tag === "img") {
        const src = content.startsWith("data:") ? content.slice(0, 64) + "…" : content;
        return `<img src="${src}"${cls}${id}>`;
      }

      // ── PageWriter: callout ───────────────────────────────────────────
      if (tag === "callout") {
        const variant = String(b.getMetadataField("variant") ?? "info");
        return `<div${cls} data-block-type="callout" data-variant="${variant}"${id}>${content}</div>`;
      }

      // ── PageWriter: reveal ────────────────────────────────────────────
      if (tag === "reveal") {
        const beforeSrc = String(b.getMetadataField("beforeSrc") ?? "");
        const afterSrc = String(b.getMetadataField("afterSrc") ?? "");
        const splitAxis = String(b.getMetadataField("splitAxis") ?? "v");
        const splitRatio = String(b.getMetadataField("splitRatio") ?? "0.5");
        return (
          `<div${cls} data-block-type="reveal"` +
          ` data-before-src="${beforeSrc}"` +
          ` data-after-src="${afterSrc}"` +
          ` data-split-axis="${splitAxis}"` +
          ` data-split-ratio="${splitRatio}"${id}></div>`
        );
      }

      // ── PageWriter: stream ────────────────────────────────────────────
      if (tag === "stream") {
        return `<div${cls} data-block-type="stream"${id}>${content}</div>`;
      }

      // ── PageWriter: raw-html — emit content verbatim ──────────────────
      if (tag === "raw-html") {
        return content;
      }

      // ── PageWriter: embed ─────────────────────────────────────────────
      if (tag === "embed") {
        const src = String(b.getMetadataField("src") ?? "");
        return `<iframe src="${src}"${cls}${id} allowfullscreen></iframe>`;
      }

      // ── PageWriter: columns ───────────────────────────────────────────
      if (tag === "columns") {
        return `<div${cls} data-block-type="columns"${id}>${content}</div>`;
      }

      // ── Legacy layout containers ──────────────────────────────────────
      if (tag === "hbox" || tag === "vbox") {
        return `<div${cls} data-block-type="${tag}"${id}>${content}</div>`;
      }

      // ── NLPWriter: nlp-block → render as plain <p> ────────────────────
      // NLP token annotations are NOT included in the HTML context; the LM
      // sees the block as normal paragraph prose.
      if (tag === "nlp-block") {
        return `<p${cls}${id}>${content}</p>`;
      }

      // ── NLPWriter: nlp-tree → <figure> with SVG content ──────────────
      if (tag === "nlp-tree") {
        return `<figure${cls} data-block-type="nlp-tree"${id}>${content}</figure>`;
      }

      // ── Default: use tag name directly ────────────────────────────────
      return `<${tag}${cls}${id}>${content}</${tag}>`;
    })
    .join("\n");
}
