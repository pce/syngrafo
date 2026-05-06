/**
 * @file services/html-ir.ts
 * HTML → IR (Intermediate Representation) pre-pass.
 *
 * The pipeline separates concerns into two clean phases:
 *
 *   Phase 1  DOM → IRNode tree   (this file)
 *            Each node is annotated with a `layout` hint derived from
 *            inline styles, CSS classes, and structural heuristics.
 *
 *   Phase 2  IRNode tree → SBlock[]   (html-parser.ts)
 *            Uses the layout hints to emit hbox/vbox/grid/callout blocks
 *            instead of falling back to flat paragraph sequences.
 *
 * Keeping the IR layer separate makes it easy to unit-test layout detection
 * independently of block generation, and to extend with new heuristics
 * without touching the serialisation logic.
 */

import type { AlignH, AlignV, CalloutVariant, SpacingToken, SStyleProps } from "../models/sdm";

export type LayoutHint =
  | "hbox"      // horizontal flex / multi-column side-by-side
  | "vbox"      // vertical flex / stacked container
  | "grid"      // explicit CSS grid
  | "col"       // flex/grid column child
  | "callout"   // note / warning / tip box
  | "flow"      // transparent wrapper — children become sibling blocks
  | "leaf";     // semantic block element (p, h1, ul, table, …)

export interface IRNode {
  kind:             "element" | "text";
  tag:              string;
  classes:          string[];
  attrs:            Record<string, string>;
  /** Parsed key/value map from the element's `style` attribute. */
  css:              Record<string, string>;
  layout:           LayoutHint;
  calloutVariant?:  CalloutVariant;
  /** Track list for grid containers, e.g. ["1fr", "2fr"]. */
  gridColumns?:     string[];
  /** Column width for col blocks inside hbox/grid (e.g. "33%", "1fr", "auto"). */
  width?:           string;
  /** Spacing token resolved from CSS gap/column-gap/row-gap or data-gap. */
  gap?:             SpacingToken;
  /** Container or block alignment. */
  align?:           { h?: AlignH; v?: AlignV };
  /** CSS grid column span. */
  span?:            number;
  /** CSS properties mapped to SDM tokens (leaf nodes only). */
  styleOverrides?:  Partial<SStyleProps>;
  children:         IRNode[];
  /** Present only when kind === "text". */
  text?:            string;
  /** Reference to the original DOM element (null for text nodes). */
  raw:              Element | null;
}

const CONTAINER_TAGS = new Set([
  "div", "section", "article", "main",
  "header", "footer", "aside", "nav", "form",
]);

const LEAF_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code", "hr", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "figure", "figcaption", "img",
]);

/** Parse the value of a `style` attribute into a plain key/value map. */
export function parseInlineStyle(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const key = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim().toLowerCase();
    if (key && val) result[key] = val;
  }
  return result;
}

function parseGridColumns(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => t.replace(/repeat\((\d+),\s*(.+)\)/, (_m, n, track) =>
      Array(Number(n)).fill(track.trim()).join(" "),
    ))
    .flatMap(t => t.split(/\s+/));
}

/**
 * Maps a raw CSS length string to the nearest SpacingToken.
 * Scale: none=0, xs≤6px, sm≤12px, md≤20px, lg≤28px, xl≤40px, 2xl≥41px.
 * Handles `px` and `rem`/`em` units (1rem = 16px).
 */
export function cssGapToSpacing(value: string): SpacingToken {
  const v = value.trim().toLowerCase();
  if (v === "0" || v === "none") return "none";

  let px: number;
  const remMatch = v.match(/^([\d.]+)r?em$/);
  if (remMatch) {
    px = parseFloat(remMatch[1]!) * 16;
  } else {
    const pxMatch = v.match(/^([\d.]+)px$/);
    if (pxMatch) {
      px = parseFloat(pxMatch[1]!);
    } else {
      return "md"; // unknown unit — default to md
    }
  }

  if (px <= 0)  return "none";
  if (px <= 6)  return "xs";
  if (px <= 12) return "sm";
  if (px <= 20) return "md";
  if (px <= 28) return "lg";
  if (px <= 40) return "xl";
  return "2xl";
}

/**
 * Extracts the column width from CSS properties and class names.
 *
 * Priority order:
 * 1. `css["width"]` if not `"auto"`
 * 2. `css["flex-basis"]` if not `"auto"`
 * 3. `css["flex"]`: extract `X%` or derive `Nfr` from the flex-grow value
 * 4. Tailwind fraction classes: `w-1/2`, `w-2/3`, etc. → percentage
 * 5. Bootstrap column classes: `col-4`, `col-md-6`, etc. (out of 12) → percentage
 */
export function extractColWidth(
  css: Record<string, string>,
  classes: string[],
): string | undefined {
  const w = css["width"];
  if (w && w !== "auto") return w;

  const flexBasis = css["flex-basis"];
  if (flexBasis && flexBasis !== "auto") return flexBasis;

  const flex = css["flex"];
  if (flex) {
    const pctMatch = flex.match(/(\d+(?:\.\d+)?%)/);
    if (pctMatch) return pctMatch[1];
    const parts = flex.trim().split(/\s+/);
    const grow = parseFloat(parts[0]!);
    if (!isNaN(grow)) return `${grow}fr`;
  }

  const classStr = classes.join(" ");

  const twMatch = classStr.match(/\bw-(\d+)\/(\d+)\b/);
  if (twMatch) {
    const pct = Math.round((parseInt(twMatch[1]!, 10) / parseInt(twMatch[2]!, 10)) * 100);
    return `${pct}%`;
  }

  const bsMatch = classStr.match(/\bcol(?:-(?:xs|sm|md|lg|xl|xxl))?-(\d+)\b/);
  if (bsMatch) {
    const pct = Math.round((parseInt(bsMatch[1]!, 10) / 12) * 100);
    return `${pct}%`;
  }

  return undefined;
}

/**
 * Maps flex/grid container CSS alignment properties to SDM alignment tokens.
 * - `align-items` → vertical alignment (`AlignV`)
 * - `justify-content` → horizontal alignment (`AlignH`)
 *
 * Returns `undefined` if neither property is present or recognisable.
 */
export function cssToContainerAlign(
  css: Record<string, string>,
): { h?: AlignH; v?: AlignV } | undefined {
  const result: { h?: AlignH; v?: AlignV } = {};

  const ai = css["align-items"] ?? "";
  if (ai === "flex-start" || ai === "start")  result.v = "top";
  else if (ai === "center")                   result.v = "middle";
  else if (ai === "flex-end" || ai === "end") result.v = "bottom";
  else if (ai === "stretch")                  result.v = "fill";

  const jc = css["justify-content"] ?? "";
  if (jc === "flex-start" || jc === "start")  result.h = "start";
  else if (jc === "center")                   result.h = "center";
  else if (jc === "flex-end" || jc === "end") result.h = "end";
  else if (jc === "stretch")                  result.h = "fill";

  return (result.h !== undefined || result.v !== undefined) ? result : undefined;
}

/**
 * Maps common inline CSS properties to SDM `SStyleProps` tokens.
 * Intended for leaf nodes only. Returns `undefined` if nothing was mappable.
 *
 * Mapped properties:
 * - `color` → `overrides.color`
 * - `background-color` → `overrides.background`
 * - `font-style: italic` → `overrides.style`
 * - `font-weight` → `overrides.weight` (bold/700–900 → "bold", 600 → "semibold",
 *   500 → "medium", normal/400 → "normal")
 * - `text-align` → `overrides.align`
 */
export function cssToStyleOverrides(
  css: Record<string, string>,
): Partial<SStyleProps> | undefined {
  const overrides: Partial<SStyleProps> = {};
  let hasAny = false;

  if (css["color"]) {
    overrides.color = css["color"];
    hasAny = true;
  }

  if (css["background-color"]) {
    overrides.background = css["background-color"];
    hasAny = true;
  }

  if (css["font-style"] === "italic") {
    overrides.style = "italic";
    hasAny = true;
  }

  const fw = css["font-weight"];
  if (fw) {
    if (fw === "bold" || fw === "700" || fw === "800" || fw === "900") {
      overrides.weight = "bold";
      hasAny = true;
    } else if (fw === "600") {
      overrides.weight = "semibold";
      hasAny = true;
    } else if (fw === "500") {
      overrides.weight = "medium";
      hasAny = true;
    } else if (fw === "normal" || fw === "400") {
      overrides.weight = "normal";
      hasAny = true;
    }
  }

  const ta = css["text-align"];
  if (ta === "left" || ta === "center" || ta === "right" || ta === "justify") {
    overrides.align = ta;
    hasAny = true;
  }

  return hasAny ? overrides : undefined;
}

const HBOX_CLASSES    = /\b(hbox|flex-row|row|columns|cols|two-col|three-col|sidebar|layout-h)\b/i;
const VBOX_CLASSES    = /\b(vbox|flex-col|stack|col|column|layout-v)\b/i;
const GRID_CLASSES    = /\b(grid|layout-grid|masonry)\b/i;
const CALLOUT_CLASSES = /\b(callout|note|tip|warning|danger|alert|success|info)\b/i;

/**
 * Derives a LayoutHint from an element's CSS map, class list, and tag.
 * The order of precedence is:
 *   0. `data-block-type` attribute (explicit override)
 *   1. Inline `display` / `flex-direction` / `grid-template-columns`
 *   2. Explicit class-name hints
 *   3. Structural heuristic (≥2 direct children with float or inline-block)
 *   4. Default: `"flow"` for containers, `"leaf"` for semantic elements
 */
export function detectLayoutHint(
  tag:     string,
  classes: string[],
  css:     Record<string, string>,
  el:      Element,
): { layout: LayoutHint; gridColumns?: string[]; calloutVariant?: CalloutVariant } {

  // ── Priority 0: data-block-type attribute override ────────────────────────
  const blockType = el.getAttribute("data-block-type");
  if (blockType) {
    switch (blockType) {
      case "hbox": return { layout: "hbox" };
      case "vbox": return { layout: "vbox" };
      case "col":  return { layout: "col" };
      case "grid": {
        const cols = el.getAttribute("data-columns");
        return {
          layout: "grid",
          gridColumns: cols?.split(",").filter(Boolean) ?? ["1fr"],
        };
      }
      case "callout": {
        const variant = (el.getAttribute("data-variant") as CalloutVariant) ?? "info";
        return { layout: "callout", calloutVariant: variant };
      }
    }
  }

  const display  = css["display"]               ?? "";
  const flexDir  = css["flex-direction"]         ?? "";
  const gridTpl  = css["grid-template-columns"]  ?? "";
  const classStr = classes.join(" ");

  // ── Priority 1: explicit inline display ───────────────────────────────────

  if (display === "grid" || gridTpl) {
    return {
      layout: "grid",
      gridColumns: gridTpl ? parseGridColumns(gridTpl) : ["1fr"],
    };
  }

  if (display === "flex" || display === "inline-flex") {
    const isCol = flexDir === "column" || flexDir === "column-reverse";
    return { layout: isCol ? "vbox" : "hbox" };
  }

  // ── Priority 2: class-name hints ──────────────────────────────────────────

  if (CALLOUT_CLASSES.test(classStr)) {
    const variant: CalloutVariant =
      /\b(warning|danger)\b/i.test(classStr) ? "warning" :
      /\bsuccess\b/i.test(classStr)          ? "success" :
      /\btip\b/i.test(classStr)              ? "tip"     :
      /\bnote\b/i.test(classStr)             ? "note"    :
      /\bdanger\b/i.test(classStr)           ? "danger"  : "info";
    return { layout: "callout", calloutVariant: variant };
  }

  if (GRID_CLASSES.test(classStr))  return { layout: "grid" };
  if (HBOX_CLASSES.test(classStr))  return { layout: "hbox" };
  if (VBOX_CLASSES.test(classStr))  return { layout: "vbox" };

  // ── Priority 3: structural heuristic ──────────────────────────────────────

  if (CONTAINER_TAGS.has(tag) && el.children.length >= 2) {
    const hint = inferLayoutFromChildren(el);
    if (hint) return { layout: hint };
  }

  // ── Priority 4: fallback ──────────────────────────────────────────────────

  return { layout: LEAF_TAGS.has(tag) ? "leaf" : "flow" };
}

/**
 * Structural heuristic: if ≥2 block-level children are all floated or
 * inline-block, we treat the parent as a horizontal layout (hbox).
 * This catches old-school CSS float grids and inline-block column layouts.
 */
function inferLayoutFromChildren(el: Element): LayoutHint | null {
  const children = Array.from(el.children);
  if (children.length < 2) return null;

  let floatedCount     = 0;
  let inlineBlockCount = 0;

  for (const child of children) {
    const style = parseInlineStyle(child.getAttribute("style") ?? "");
    const cls   = child.className ?? "";
    if (style["float"] === "left" || style["float"] === "right") floatedCount++;
    if (style["display"] === "inline-block") inlineBlockCount++;
    if (/\b(col-|md:w-|w-\d+\/\d+|col\s)/i.test(cls)) inlineBlockCount++;
  }

  const threshold = Math.ceil(children.length * 0.6);
  if (floatedCount     >= threshold) return "hbox";
  if (inlineBlockCount >= threshold) return "hbox";
  return null;
}

/**
 * Recursively converts a DOM NodeList into an IRNode tree.
 * The result is an annotated structure ready for Phase 2 (block generation).
 */
export function domToIR(nodes: NodeList | Element[]): IRNode[] {
  const result: IRNode[] = [];

  for (const node of Array.from(nodes as NodeList)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) {
        result.push({
          kind: "text", tag: "#text",
          classes: [], attrs: {}, css: {},
          layout: "leaf",
          children: [],
          text,
          raw: null,
        });
      }
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el      = node as Element;
    const tag     = el.tagName.toLowerCase();
    const classes = el.className
      ? el.className.trim().split(/\s+/).filter(Boolean)
      : [];
    const css     = parseInlineStyle(el.getAttribute("style") ?? "");

    const attrs: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      if (attr.name !== "style" && attr.name !== "class") {
        attrs[attr.name] = attr.value;
      }
    }

    const { layout, gridColumns, calloutVariant } =
      detectLayoutHint(tag, classes, css, el);

    // Spacing token from gap properties or data attribute
    const gapRaw = css["gap"] ?? css["column-gap"] ?? css["row-gap"]
                ?? el.getAttribute("data-gap") ?? "";
    const gap = gapRaw ? cssGapToSpacing(gapRaw) : undefined;

    // Column width (explicit data attr takes priority)
    const width = el.getAttribute("data-width") ?? extractColWidth(css, classes);

    // Grid column span
    const spanAttr = el.getAttribute("data-span");
    const span = spanAttr ? parseInt(spanAttr, 10) || undefined : undefined;

    // Alignment: merge CSS-derived and data-attribute sources
    const alignFromAttrs: { h?: AlignH; v?: AlignV } = {};
    const dah = el.getAttribute("data-align-h") as AlignH | null;
    const dav = el.getAttribute("data-align-v") as AlignV | null;
    if (dah) alignFromAttrs.h = dah;
    if (dav) alignFromAttrs.v = dav;
    const cssAlign = (layout === "hbox" || layout === "vbox" || layout === "grid")
      ? cssToContainerAlign(css)
      : undefined;
    const align = (dah || dav || cssAlign)
      ? { ...(cssAlign ?? {}), ...alignFromAttrs }
      : undefined;

    // Style overrides: only for leaf nodes; inline content handled by span walker
    const styleOverrides = layout === "leaf" ? cssToStyleOverrides(css) : undefined;

    const irNode: IRNode = {
      kind: "element",
      tag,
      classes,
      attrs,
      css,
      layout,
      ...(gridColumns    ? { gridColumns }    : {}),
      ...(calloutVariant ? { calloutVariant } : {}),
      ...(width          ? { width }          : {}),
      ...(gap            ? { gap }            : {}),
      ...(align          ? { align }          : {}),
      ...(span           ? { span }           : {}),
      ...(styleOverrides ? { styleOverrides } : {}),
      children: layout === "leaf"
        ? []
        : domToIR(el.childNodes),
      raw: el,
    };

    result.push(irNode);
  }

  return result;
}
