import { isTextBlock, type SBlock, type Span } from "../models/sdm";

export function spansToPlainText(spans: Span[]): string {
  return spans.map((span) => span.text).join("").trim();
}

export function spansToMarkdown(spans: Span[]): string {
  return spans
    .map((span) => {
      let text = span.text.replace(/([\\`*_#[\]()!>~-])/g, "\\$1");
      for (const mark of span.marks ?? []) {
        switch (mark) {
          case "bold": text = `**${text}**`; break;
          case "italic": text = `*${text}*`; break;
          case "strike": text = `~~${text}~~`; break;
          case "code": text = `\`${text}\``; break;
          case "link": text = `[${text}](${span.href ?? "#"})`; break;
          default: break;
        }
      }
      return text;
    })
    .join("");
}

export function spansToAsciiDoc(spans: Span[]): string {
  return spans
    .map((span) => {
      let text = span.text;
      for (const mark of span.marks ?? []) {
        switch (mark) {
          case "bold": text = `*${text}*`; break;
          case "italic": text = `_${text}_`; break;
          case "strike": text = `[line-through]#${text}#`; break;
          case "code": text = `\`${text}\``; break;
          case "link": text = `link:${span.href ?? "#"}[${text}]`; break;
          default: break;
        }
      }
      return text;
    })
    .join("");
}

function blockToMarkdown(block: SBlock, depth = 0): string {
  const indent = "  ".repeat(depth);
  switch (block.type) {
    case "p": return spansToMarkdown(block.spans);
    case "h1": return `# ${spansToMarkdown(block.spans)}`;
    case "h2": return `## ${spansToMarkdown(block.spans)}`;
    case "h3": return `### ${spansToMarkdown(block.spans)}`;
    case "h4": return `#### ${spansToMarkdown(block.spans)}`;
    case "quote": return `> ${spansToMarkdown(block.spans)}`;
    case "code": return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
    case "img": return `![${block.alt ?? ""}](${block.src})`;
    case "hr": return "---";
    case "pagebreak": return "\n---\n";
    case "li": return `${indent}- ${spansToMarkdown(block.spans)}`;
    case "ul": return block.children.map((child) => blockToMarkdown(child, depth)).join("\n");
    case "ol": return block.children.map((child, index) => `${indent}${index + 1}. ${spansToMarkdown(child.spans)}`).join("\n");
    case "callout": {
      const title = block.title ? `**${block.title}**\n\n` : "";
      return `> ${title}${block.children.map((child) => blockToMarkdown(child, depth + 1)).join("\n> ")}`;
    }
    case "vbox":
    case "hbox":
    case "grid":
    case "col":
    case "table":
    case "tr":
      return "children" in block ? block.children.map((child) => blockToMarkdown(child, depth)).join("\n\n") : "";
    case "td":
    case "th":
    case "figcaption":
      return spansToMarkdown(block.spans);
    default:
      return "";
  }
}

export function blocksToMarkdown(blocks: SBlock[]): string {
  return blocks.map((block) => blockToMarkdown(block)).filter(Boolean).join("\n\n");
}

function blockToAsciiDoc(block: SBlock, depth = 0): string {
  const indent = "  ".repeat(depth);
  switch (block.type) {
    case "p": return spansToAsciiDoc(block.spans);
    case "h1": return `= ${spansToAsciiDoc(block.spans)}`;
    case "h2": return `== ${spansToAsciiDoc(block.spans)}`;
    case "h3": return `=== ${spansToAsciiDoc(block.spans)}`;
    case "h4": return `==== ${spansToAsciiDoc(block.spans)}`;
    case "quote": return `[quote]\n____\n${spansToAsciiDoc(block.spans)}\n____`;
    case "code": return `${block.language ? `[source,${block.language}]\n` : ""}----\n${block.text}\n----`;
    case "img": return `image::${block.src}[${block.alt ?? ""}]`;
    case "hr": return "'''";
    case "pagebreak": return "<<<";
    case "li": return `${indent}* ${spansToAsciiDoc(block.spans)}`;
    case "ul": return block.children.map((child) => blockToAsciiDoc(child, depth)).join("\n");
    case "ol": return block.children.map((child, index) => `${indent}${index + 1}. ${spansToAsciiDoc(child.spans)}`).join("\n");
    case "callout": {
      const title = block.title ? `${block.title}\n` : "";
      return `[NOTE]\n====\n${title}${block.children.map((child) => blockToAsciiDoc(child, depth + 1)).join("\n\n")}\n====`;
    }
    case "vbox":
    case "hbox":
    case "grid":
    case "col":
    case "table":
    case "tr":
      return "children" in block ? block.children.map((child) => blockToAsciiDoc(child, depth)).join("\n\n") : "";
    case "td":
    case "th":
    case "figcaption":
      return spansToAsciiDoc(block.spans);
    default:
      return "";
  }
}

export function blocksToAsciiDoc(blocks: SBlock[]): string {
  return blocks.map((block) => blockToAsciiDoc(block)).filter(Boolean).join("\n\n");
}

export function blocksToPlainText(blocks: SBlock[]): string {
  const lines: string[] = [];
  const visit = (block: SBlock) => {
    if (isTextBlock(block)) {
      const text = spansToPlainText(block.spans);
      if (text) lines.push(text);
    } else if (block.type === "code") {
      if (block.text.trim()) lines.push(block.text.trim());
    } else if ("children" in block) {
      const children = (block as { children?: unknown }).children;
      if (Array.isArray(children)) {
        children.forEach((child) => visit(child as SBlock));
      }
    }
  };
  blocks.forEach(visit);
  return lines.join("\n\n");
}
