import type {
  SBlock,
  STextBlock,
  SListBlock,
  SHBoxBlock,
  SVBoxBlock,
  SColBlock,
  SGridBlock,
  STableBlock,
  SCalloutBlock,
  Span,
  SpanMark,
} from "../models/sdm";
import { createBlock } from "../models/sdm-factory";
import { domToIR, type IRNode } from "./html-ir";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function walkInlineNodes(
  nodes: NodeList,
  inheritedMarks: SpanMark[],
  inheritedHref?: string,
): Span[] {
  const spans: Span[] = [];

  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) {
        const span: Span = { text };
        if (inheritedMarks.length) span.marks = [...inheritedMarks];
        if (inheritedHref)        span.href  = inheritedHref;
        spans.push(span);
      }
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el  = node as Element;
    const tag = el.tagName.toLowerCase();
    const newMarks = [...inheritedMarks];
    let   href     = inheritedHref;

    if      (tag === "strong" || tag === "b")   newMarks.push("bold");
    else if (tag === "em"     || tag === "i")   newMarks.push("italic");
    else if (tag === "u")                        newMarks.push("underline");
    else if (tag === "s"      || tag === "del") newMarks.push("strike");
    else if (tag === "code")                     newMarks.push("code");
    else if (tag === "a") {
      newMarks.push("link");
      href = el.getAttribute("href") ?? undefined;
    }
    else if (tag === "sup") newMarks.push("sup");
    else if (tag === "sub") newMarks.push("sub");
    // Other inline tags (span, abbr, mark, …) — pass through without new marks

    spans.push(...walkInlineNodes(el.childNodes, newMarks, href));
  }

  return spans;
}

/** Parse inline HTML (a fragment with marks) into Span[]. */
export function htmlToSpans(html: string): Span[] {
  if (!html.trim()) return [];

  // Non-browser fallback: strip tags and return plain text
  if (typeof document === "undefined") {
    const text = html.replace(/<[^>]+>/g, "").trim();
    return text ? [{ text }] : [];
  }

  const container = document.createElement("div");
  container.innerHTML = html;
  return walkInlineNodes(container.childNodes, []);
}

/** Render Span[] to an inline HTML string. */
export function spansToHtml(spans: Span[]): string {
  return spans
    .map((span) => {
      let html = escapeHtml(span.text);
      const marks = span.marks ?? [];

      // innermost first so nesting reads naturally
      if (marks.includes("code"))      html = `<code>${html}</code>`;
      if (marks.includes("sup"))       html = `<sup>${html}</sup>`;
      if (marks.includes("sub"))       html = `<sub>${html}</sub>`;
      if (marks.includes("strike"))    html = `<s>${html}</s>`;
      if (marks.includes("underline")) html = `<u>${html}</u>`;
      if (marks.includes("italic"))    html = `<em>${html}</em>`;
      if (marks.includes("bold"))      html = `<strong>${html}</strong>`;
      if (marks.includes("link")) {
        const href = span.href ? ` href="${escapeHtml(span.href)}"` : "";
        html = `<a${href}>${html}</a>`;
      }

      return html;
    })
    .join("");
}

/**
 * Phase 2: Convert an IRNode tree into SBlock[].
 * Layout hints set in Phase 1 (html-ir.ts) drive the block type chosen here.
 */
function irToBlocks(nodes: IRNode[]): SBlock[] {
  const blocks: SBlock[] = [];

  for (const node of nodes) {
    if (node.kind === "text") {
      if (node.text) blocks.push(createBlock("p", { spans: [{ text: node.text }] }));
      continue;
    }

    switch (node.layout) {
      case "hbox": {
        const cols: SBlock[] = [];
        for (const child of node.children) {
          if (child.layout === "col") {
            // roundtrip: child is already a col — preserve its width/span
            const inner = irToBlocks(child.children);
            cols.push(createBlock("col", {
              children: inner,
              ...(child.width ? { width: child.width } : {}),
              ...(child.span  ? { span:  child.span  } : {}),
            }));
          } else {
            const inner = irToBlocks([child]);
            cols.push(createBlock("col", {
              children: inner,
              ...(child.width ? { width: child.width } : {}),
            }));
          }
        }
        if (cols.length > 0) {
          blocks.push(createBlock("hbox", {
            children: cols as unknown as SColBlock[],
            gap: node.gap ?? "md",
            ...(node.align ? { align: node.align } : {}),
            ...(node.styleOverrides ? { styleOverrides: node.styleOverrides } : {}),
          }));
        } else {
          blocks.push(...irToBlocks(node.children));
        }
        break;
      }

      case "vbox": {
        const inner = irToBlocks(node.children);
        if (inner.length > 0) {
          blocks.push(createBlock("vbox", {
            children: inner,
            gap: node.gap ?? "sm",
            ...(node.align ? { align: node.align } : {}),
            ...(node.styleOverrides ? { styleOverrides: node.styleOverrides } : {}),
          }));
        }
        break;
      }

      case "grid": {
        const cols: SBlock[] = [];
        for (const child of node.children) {
          if (child.layout === "col") {
            const inner = irToBlocks(child.children);
            cols.push(createBlock("col", {
              children: inner,
              ...(child.width ? { width: child.width } : {}),
              ...(child.span  ? { span:  child.span  } : {}),
            }));
          } else {
            const inner = irToBlocks([child]);
            cols.push(createBlock("col", { children: inner }));
          }
        }
        blocks.push(createBlock("grid", {
          columns: node.gridColumns ?? ["1fr"],
          gap: node.gap ?? "md",
          children: cols as unknown as SColBlock[],
        }));
        break;
      }

      case "col":
        blocks.push(...irToBlocks(node.children));
        break;

      case "callout": {
        const inner = irToBlocks(node.children);
        blocks.push(createBlock("callout", {
          variant: node.calloutVariant ?? "info",
          children: inner,
          ...(node.styleOverrides ? { styleOverrides: node.styleOverrides } : {}),
        }));
        break;
      }

      case "flow":
        blocks.push(...irToBlocks(node.children));
        break;

      case "leaf":
      default: {
        // Delegate to the tag-specific element builder
        const el = node.raw;
        if (el) {
          let block = elementToBlock(el);
          if (block && node.styleOverrides) {
            block = { ...block, styleOverrides: node.styleOverrides } as SBlock;
          }
          if (block) blocks.push(block);
        }
        break;
      }
    }
  }

  return blocks;
}

/**
 * @deprecated Use the IR-based pipeline (irToBlocks via htmlToBlocks) instead.
 * Kept for callers that pass a NodeList directly without going through DOMParser.
 */
function collectBlocks(nodes: NodeList): SBlock[] {
  return irToBlocks(domToIR(nodes));
}

function elementToBlock(el: Element): SBlock | null {
  const tag = el.tagName.toLowerCase();

  // Text blocks
  if (tag === "p")
    return createBlock("p", { spans: htmlToSpans(el.innerHTML) });
  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4")
    return createBlock(tag, { spans: htmlToSpans(el.innerHTML) });
  if (tag === "h5" || tag === "h6")  // fold to h4
    return createBlock("h4", { spans: htmlToSpans(el.innerHTML) });
  if (tag === "blockquote")
    return createBlock("quote", { spans: htmlToSpans(el.innerHTML) });

  // Lists
  if (tag === "ul" || tag === "ol") {
    const children = Array.from(el.querySelectorAll(":scope > li")).map((li) =>
      createBlock("li", { spans: htmlToSpans(li.innerHTML) }),
    ) as STextBlock[];
    return createBlock(tag, { children });
  }

  // Code
  if (tag === "pre") {
    const codeEl   = el.querySelector("code") ?? el;
    const langMatch = codeEl.className.match(/language-(\w+)/);
    const language  = langMatch?.[1];
    return createBlock("code", {
      text: codeEl.textContent ?? "",
      ...(language ? { language } : {}),
    });
  }
  if (tag === "code")
    return createBlock("code", { text: el.textContent ?? "" });

  // Void
  if (tag === "hr")
    return createBlock("hr");

  // Image / figure
  if (tag === "img") {
    const src = el.getAttribute("src") ?? "";
    if (!src) return null;
    const alt = el.getAttribute("alt") ?? undefined;
    return createBlock("img", { src, ...(alt ? { alt } : {}) });
  }
  if (tag === "figure") {
    const imgEl = el.querySelector("img");
    if (!imgEl) return null;
    const src = imgEl.getAttribute("src") ?? "";
    if (!src) return null;
    const alt     = imgEl.getAttribute("alt") ?? undefined;
    const capEl   = el.querySelector("figcaption");
    const caption = capEl?.textContent?.trim() ?? undefined;
    return createBlock("img", {
      src,
      ...(alt     ? { alt }     : {}),
      ...(caption ? { caption } : {}),
    });
  }

  // Table
  if (tag === "table") {
    const rows = Array.from(el.querySelectorAll("tr")).map((tr) => {
      const cells = Array.from(tr.children)
        .filter((c) => c.tagName === "TD" || c.tagName === "TH")
        .map((cell) =>
          createBlock(cell.tagName.toLowerCase() as "td" | "th", {
            spans: htmlToSpans(cell.innerHTML),
          }),
        ) as STextBlock[];
      return createBlock("tr", { children: cells });
    });
    return createBlock("table", { children: rows });
  }

  // Unknown → p with text content
  const fallback = el.textContent?.trim();
  return fallback ? createBlock("p", { spans: [{ text: fallback }] }) : null;
}

/** Parse an HTML string into an SBlock array using the two-phase IR pipeline. */
export function htmlToBlocks(html: string): SBlock[] {
  const cleaned = html
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  if (!cleaned || /^\s*[\[{]/.test(cleaned)) return [];
  if (typeof DOMParser === "undefined")          return [];

  const parsedDoc = new DOMParser().parseFromString(cleaned, "text/html");
  const ir = domToIR(parsedDoc.body.childNodes);
  return irToBlocks(ir);
}

function blockToHtml(b: SBlock): string {
  switch (b.type) {
    case "p":
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return `<${b.type}>${spansToHtml(b.spans)}</${b.type}>`;

    case "quote":
      return `<blockquote>${spansToHtml(b.spans)}</blockquote>`;

    case "li":
      return `<li>${spansToHtml(b.spans)}</li>`;

    case "td":
      return `<td>${spansToHtml(b.spans)}</td>`;

    case "th":
      return `<th>${spansToHtml(b.spans)}</th>`;

    case "ul":
    case "ol":
      return `<${b.type}>${(b as SListBlock).children.map(blockToHtml).join("")}</${b.type}>`;

    case "code": {
      const lang = b.language ? ` class="language-${escapeHtml(b.language)}"` : "";
      return `<pre><code${lang}>${escapeHtml(b.text)}</code></pre>`;
    }

    case "img": {
      const rawSrc = b.src.startsWith("data:") ? `${b.src.slice(0, 64)}[…]` : b.src;
      const src    = escapeHtml(rawSrc);
      const alt    = b.alt ? ` alt="${escapeHtml(b.alt)}"` : "";
      if (b.caption) {
        return `<figure><img src="${src}"${alt}><figcaption>${escapeHtml(b.caption)}</figcaption></figure>`;
      }
      return `<img src="${src}"${alt}>`;
    }

    case "hr":
      return "<hr>";

    case "pagebreak":
      return `<hr class="pagebreak">`;

    case "hbox": {
      const hb = b as SHBoxBlock;
      let attr = ` data-block-type="hbox"`;
      if (hb.gap)      attr += ` data-gap="${hb.gap}"`;
      if (hb.align?.h) attr += ` data-align-h="${hb.align.h}"`;
      if (hb.align?.v) attr += ` data-align-v="${hb.align.v}"`;
      return `<div${attr}>${blocksToHtml(hb.children)}</div>`;
    }

    case "vbox": {
      const vb = b as SVBoxBlock;
      let attr = ` data-block-type="vbox"`;
      if (vb.gap)      attr += ` data-gap="${vb.gap}"`;
      if (vb.align?.v) attr += ` data-align-v="${vb.align.v}"`;
      return `<div${attr}>${blocksToHtml(vb.children)}</div>`;
    }

    case "col": {
      const cb = b as SColBlock;
      let attr = ` data-block-type="col"`;
      if (cb.width) attr += ` data-width="${escapeHtml(cb.width)}"`;
      if (cb.span)  attr += ` data-span="${cb.span}"`;
      return `<div${attr}>${blocksToHtml(cb.children)}</div>`;
    }

    case "grid": {
      const gb = b as SGridBlock;
      let attr = ` data-block-type="grid"`;
      if (gb.columns.length) attr += ` data-columns="${escapeHtml(gb.columns.join(","))}"`;
      if (gb.gap)            attr += ` data-gap="${gb.gap}"`;
      return `<div${attr}>${blocksToHtml(gb.children)}</div>`;
    }

    case "table":
      return `<table>${(b as STableBlock).children.map(blockToHtml).join("")}</table>`;

    case "tr":
      return `<tr>${b.children.map(blockToHtml).join("")}</tr>`;

    case "callout": {
      const cb = b as SCalloutBlock;
      return (
        `<div data-block-type="callout" data-variant="${escapeHtml(cb.variant)}">` +
        `${blocksToHtml(cb.children)}</div>`
      );
    }

    // SGridBlock is handled by the "grid" case above (type guard via cast)

    case "figcaption":
      return `<figcaption>${spansToHtml(b.spans)}</figcaption>`;

    default: {
      const _exhaustive: never = b as never;
      console.warn("[blocksToHtml] Unknown block type:", (_exhaustive as SBlock).type);
      return "";
    }
  }
}

/** Serialise an SBlock array to an HTML string. */
export function blocksToHtml(blocks: SBlock[]): string {
  return blocks.map(blockToHtml).join("\n");
}
