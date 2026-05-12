import * as React from "react";
import AsciidoctorFactory from "@asciidoctor/core";
import { Marked } from "marked";

export type MarkupFormat = "markdown" | "asciidoc";

type SafeTag =
  | "a"
  | "blockquote"
  | "br"
  | "code"
  | "em"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "hr"
  | "img"
  | "input"
  | "li"
  | "ol"
  | "p"
  | "pre"
  | "strong"
  | "table"
  | "tbody"
  | "td"
  | "th"
  | "thead"
  | "tr"
  | "ul";

type SafeNode = SafeTextNode | SafeElementNode;

interface SafeTextNode {
  type: "text";
  value: string;
}

interface SafeElementNode {
  type: "element";
  tag: SafeTag;
  attrs: Record<string, string | boolean>;
  children: SafeNode[];
}

export interface MarkupPreviewProps {
  source: string;
  format: MarkupFormat;
  className?: string;
  style?: React.CSSProperties;
}

const markdownParser = new Marked({
  gfm: true,
  breaks: true,
});

const asciidoctor = AsciidoctorFactory();
const BLOCKED_TAGS = new Set([
  "audio",
  "canvas",
  "embed",
  "form",
  "iframe",
  "math",
  "meta",
  "object",
  "script",
  "style",
  "svg",
  "textarea",
  "video",
]);
const UNWRAP_TAGS = new Set(["article", "body", "div", "main", "section", "span"]);
const ALLOWED_TAGS = new Set<SafeTag>([
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "input",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);
const SELF_CLOSING_TAGS = new Set<SafeTag>(["br", "hr", "img", "input"]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizePreviewUrl(raw: string, kind: "href" | "src"): string | null {
  const value = raw.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("data:")) {
    return null;
  }
  if (value.startsWith("/")) return `local:/${value}`;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    const allowed = kind === "href"
      ? /^(https?:|mailto:|file:|local:)/i
      : /^(https?:|file:|local:)/i;
    return allowed.test(value) ? value : null;
  }
  return value;
}

function normaliseTextContent(value: string): string {
  return value.replace(/\u00a0/g, " ");
}

function parseMarkdownRawHtml(source: string): string {
  const rendered = markdownParser.parse(source);
  return typeof rendered === "string" ? rendered : "";
}

function parseAsciiDocRawHtml(source: string): string {
  const rendered = asciidoctor.convert(source, {
    backend: "html5",
    safe: "secure",
    standalone: false,
    header_footer: false,
    attributes: {
      icons: "false",
      "skip-front-matter": "",
    },
  });
  return typeof rendered === "string" ? rendered : "";
}

function sanitiseElementAttributes(element: Element, tag: SafeTag): Record<string, string | boolean> {
  const attrs: Record<string, string | boolean> = {};
  if (tag === "a") {
    const href = sanitizePreviewUrl(element.getAttribute("href") ?? "", "href");
    if (href) attrs.href = href;
  } else if (tag === "img") {
    const src = sanitizePreviewUrl(element.getAttribute("src") ?? "", "src");
    if (!src) return {};
    attrs.src = src;
    const alt = element.getAttribute("alt");
    if (alt) attrs.alt = alt;
  } else if (tag === "input") {
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    if (type !== "checkbox" || element.hasAttribute("disabled") === false) return {};
    attrs.type = "checkbox";
    attrs.disabled = true;
    if (element.hasAttribute("checked")) attrs.checked = true;
  } else if (tag === "ol") {
    const start = element.getAttribute("start");
    if (start && /^\d+$/.test(start)) attrs.start = start;
  }
  return attrs;
}

function domNodeToSafeNodes(node: Node): SafeNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [{ type: "text", value: normaliseTextContent(node.textContent ?? "") }];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (BLOCKED_TAGS.has(tag)) return [];

  if (UNWRAP_TAGS.has(tag)) {
    return Array.from(element.childNodes).flatMap(domNodeToSafeNodes);
  }

  if (!ALLOWED_TAGS.has(tag as SafeTag)) {
    return Array.from(element.childNodes).flatMap(domNodeToSafeNodes);
  }

  const safeTag = tag as SafeTag;
  const attrs = sanitiseElementAttributes(element, safeTag);
  if (safeTag === "a" && typeof attrs.href !== "string") {
    return Array.from(element.childNodes).flatMap(domNodeToSafeNodes);
  }
  if (safeTag === "img" && typeof attrs.src !== "string") {
    return [];
  }
  if (safeTag === "input" && attrs.type !== "checkbox") {
    return [];
  }

  return [{
    type: "element",
    tag: safeTag,
    attrs,
    children: SELF_CLOSING_TAGS.has(safeTag)
      ? []
      : Array.from(element.childNodes).flatMap(domNodeToSafeNodes),
  }];
}

function parseSafeNodesFromHtml(html: string): SafeNode[] {
  if (typeof DOMParser === "undefined") {
    return html ? [{ type: "text", value: html }] : [];
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.body.childNodes).flatMap(domNodeToSafeNodes);
}

function serialiseSafeNode(node: SafeNode): string {
  if (node.type === "text") return escapeHtml(node.value);

  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => {
      if (value === true) return ` ${key}`;
      if (value === false || value == null) return "";
      return ` ${key}="${escapeHtml(String(value))}"`;
    })
    .join("");

  if (SELF_CLOSING_TAGS.has(node.tag)) {
    return `<${node.tag}${attrs}>`;
  }

  return `<${node.tag}${attrs}>${node.children.map(serialiseSafeNode).join("")}</${node.tag}>`;
}

function renderNode(node: SafeNode, key: string, parentTag?: SafeTag): React.ReactNode {
  if (node.type === "text") return node.value;

  const children = node.children.map((child, index) =>
    renderNode(child, `${key}-${index}`, node.tag),
  );
  const props: Record<string, unknown> = { key };

  switch (node.tag) {
    case "h1":
      props.className = "text-2xl font-bold mt-4 mb-2";
      break;
    case "h2":
      props.className = "text-xl font-bold mt-4 mb-2";
      break;
    case "h3":
      props.className = "text-lg font-semibold mt-3 mb-1.5";
      break;
    case "h4":
      props.className = "text-base font-semibold mt-3 mb-1";
      break;
    case "h5":
    case "h6":
      props.className = "text-sm font-semibold mt-2 mb-1";
      break;
    case "p":
      props.className = "my-2";
      break;
    case "blockquote":
      props.className = "my-3 border-l-4 border-[var(--theme-border)] pl-4 italic opacity-90";
      break;
    case "ul":
    case "ol":
      props.className = "my-2 pl-5 space-y-1";
      if (node.tag === "ol" && typeof node.attrs.start === "string") {
        props.start = Number(node.attrs.start);
      }
      break;
    case "li":
      props.className = "leading-relaxed";
      break;
    case "pre":
      props.className = "my-3 overflow-x-auto rounded-lg p-3 text-[11px] leading-snug font-mono whitespace-pre bg-[var(--theme-surface)] border border-[var(--theme-border)]";
      break;
    case "code":
      props.className = parentTag === "pre"
        ? "font-mono"
        : "font-mono text-[0.82em] px-1 py-0.5 rounded bg-[var(--theme-surface)] border border-[var(--theme-border)]";
      break;
    case "strong":
      props.className = "font-semibold";
      break;
    case "em":
      props.className = "italic";
      break;
    case "hr":
      props.className = "my-4 border-[var(--theme-border)]";
      break;
    case "a":
      props.href = node.attrs.href;
      props.target = "_blank";
      props.rel = "noreferrer noopener";
      props.className = "underline underline-offset-2 text-[var(--theme-primary)]";
      break;
    case "img":
      props.src = node.attrs.src;
      props.alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
      props.loading = "lazy";
      props.className = "max-w-full rounded-lg border border-[var(--theme-border)] my-2";
      break;
    case "table":
      props.className = "my-3 w-full border-collapse text-sm";
      break;
    case "thead":
      props.className = "bg-[var(--theme-surface)]";
      break;
    case "tbody":
      props.className = "divide-y divide-[var(--theme-border)]";
      break;
    case "tr":
      props.className = "align-top";
      break;
    case "th":
      props.className = "border border-[var(--theme-border)] px-2 py-1 text-left font-semibold";
      break;
    case "td":
      props.className = "border border-[var(--theme-border)] px-2 py-1";
      break;
    case "input":
      props.type = "checkbox";
      props.checked = node.attrs.checked === true;
      props.disabled = true;
      props.className = "mr-2 align-middle accent-current";
      break;
  }

  return React.createElement(node.tag, props, ...children);
}

export function tokenizeMarkdown(source: string) {
  return markdownParser.lexer(source);
}

export function markupToSafeHtml(source: string, format: MarkupFormat): string {
  const rawHtml = format === "asciidoc"
    ? parseAsciiDocRawHtml(source)
    : parseMarkdownRawHtml(source);
  return parseSafeNodesFromHtml(rawHtml).map(serialiseSafeNode).join("");
}

export function renderMarkdownPreview(source: string): string {
  return markupToSafeHtml(source, "markdown");
}

export function renderAsciiDocPreview(source: string): string {
  return markupToSafeHtml(source, "asciidoc");
}

export function renderMarkupPreview(source: string, format: MarkupFormat): string {
  return markupToSafeHtml(source, format);
}

export function MarkupPreview({
  source,
  format,
  className,
  style,
}: MarkupPreviewProps): React.ReactElement {
  const nodes = React.useMemo(
    () => parseSafeNodesFromHtml(markupToSafeHtml(source, format)),
    [source, format],
  );

  return React.createElement(
    "div",
    { className, style },
    ...nodes.map((node, index) => renderNode(node, `markup-${index}`)),
  );
}

