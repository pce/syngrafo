import type {
  SBlock,
  STextBlock,
  SListBlock,
  SHBoxBlock,
  SVBoxBlock,
  SColBlock,
  STableBlock,
  SCalloutBlock,
  Span,
  SpanMark,
} from "../models/sdm";
import { createBlock } from "../models/sdm-factory";

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

  // Containers: recurse would lose structural context — flatten to p
  const CONTAINERS = new Set(["div", "section", "article", "main", "header", "footer", "aside"]);
  if (CONTAINERS.has(tag)) {
    const text = el.textContent?.trim();
    return text ? createBlock("p", { spans: [{ text }] }) : null;
  }

  // Unknown → p with text content
  const fallback = el.textContent?.trim();
  return fallback ? createBlock("p", { spans: [{ text: fallback }] }) : null;
}

/** Parse an HTML string into an SBlock array. */
export function htmlToBlocks(html: string): SBlock[] {
  const cleaned = html
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  if (!cleaned || /^\s*[\[{]/.test(cleaned)) return [];
  if (typeof DOMParser === "undefined")          return [];

  const doc    = new DOMParser().parseFromString(cleaned, "text/html");
  const blocks: SBlock[] = [];

  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) blocks.push(createBlock("p", { spans: [{ text }] }));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const block = elementToBlock(node as Element);
    if (block) blocks.push(block);
  }

  return blocks;
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

    case "hbox":
      return `<div data-block-type="hbox">${blocksToHtml((b as SHBoxBlock).children)}</div>`;

    case "vbox":
      return `<div data-block-type="vbox">${blocksToHtml((b as SVBoxBlock).children)}</div>`;

    case "col": {
      const width = (b as SColBlock).width
        ? ` data-width="${escapeHtml((b as SColBlock).width!)}"`
        : "";
      return `<div data-block-type="col"${width}>${blocksToHtml((b as SColBlock).children)}</div>`;
    }

    case "grid":
      return `<div data-block-type="grid">${blocksToHtml(b.children)}</div>`;

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
