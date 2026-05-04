import React, { useState, useCallback } from "react";
import { useEditorDoc } from "../../store/editor-store";
import { useSignal } from "../../hooks/useSignal";
import type { Block } from "../../models/block";
import { Icon } from "../../components/Icon";

function blockToHTML(block: Block): string {
  const type = block.getType();
  const content = block.getContent();
  const meta = block.getMetadata();
  const cls = block.getStyleId();
  const escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  switch (type) {
    case "h1":
      return `<h1 class="${cls}">${escaped}</h1>`;
    case "h2":
      return `<h2 class="${cls}">${escaped}</h2>`;
    case "h3":
      return `<h3 class="${cls}">${escaped}</h3>`;
    case "p":
      return `<p class="${cls}">${escaped}</p>`;
    case "ul":
      return `<ul class="${cls}">${escaped
        .split("\n")
        .map((l) => `<li>${l}</li>`)
        .join("")}</ul>`;
    case "ol":
      return `<ol class="${cls}">${escaped
        .split("\n")
        .map((l) => `<li>${l}</li>`)
        .join("")}</ol>`;
    case "li":
      return `<li class="${cls}">${escaped}</li>`;
    case "code":
      return `<pre class="${cls}"><code>${escaped}</code></pre>`;
    case "hr":
      return `<hr />`;
    case "pagebreak":
      return `<!-- page break -->`;
    case "nlp-block":
      return `<p class="${cls}">${escaped}</p>`;
    case "stream":
      return `<p class="${cls}">${escaped}</p>`;
    case "raw-html":
      return content; // passthrough
    case "img":
      return `<img src="${String(meta.src ?? "")}" alt="${String(meta.alt ?? "")}" class="${cls}" />`;
    case "figure":
      return `<figure class="${cls}">${content}</figure>`;
    case "callout": {
      const variant = String(meta.variant ?? "info");
      const title = meta.title ? `<strong>${String(meta.title)}</strong> ` : "";
      return `<div class="callout callout-${variant} ${cls}" role="note">${title}${escaped}</div>`;
    }
    case "reveal":
      return `<figure class="reveal ${cls}" style="position:relative"><img src="${String(meta.beforeSrc ?? "")}" alt="${String(meta.labelBefore ?? "Before")}" /><img src="${String(meta.afterSrc ?? "")}" alt="${String(meta.labelAfter ?? "After")}" /></figure>`;
    case "embed":
      return `<iframe src="${String(meta.src ?? "")}" class="${cls}" allowfullscreen></iframe>`;
    case "table":
      return `<table class="${cls}">${escaped}</table>`;
    case "columns":
    case "hbox":
    case "vbox":
      return `<div class="columns ${cls}">${escaped}</div>`;
    default:
      return escaped ? `<div class="${cls}">${escaped}</div>` : "";
  }
}

function generateHTML(blocks: Block[], includeStyle: boolean, css: string): string {
  const bodyHtml = blocks.map(blockToHTML).filter(Boolean).join("\n");
  const styleTag = includeStyle ? `\n<style>\n${css}\n</style>\n` : "";
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />${styleTag}</head>\n<body>\n${bodyHtml}\n</body>\n</html>`;
}

function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => b.getContent().trim())
    .filter(Boolean)
    .join("\n\n");
}

export interface ExportPanelProps {
  onExportPDF?: () => void;
  onExportHTML?: (html: string) => void;
}

export function ExportPanel({ onExportPDF, onExportHTML }: ExportPanelProps) {
  const doc = useEditorDoc();
  const blocks = useSignal(doc.blocks);
  const pageSize = useSignal(doc.pageSize);
  const pageMarginMm = useSignal(doc.pageMarginMm);
  const title = useSignal(doc.title);
  const filename = useSignal(doc.filename);

  const [includeStyle, setIncludeStyle] = useState(true);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const showCopy = (msg: string) => {
    setCopyMsg(msg);
    setTimeout(() => setCopyMsg(null), 2000);
  };

  const handlePDF = useCallback(() => {
    onExportPDF?.();
    window.print();
  }, [onExportPDF]);

  const getCSS = () => doc.getStyleLibrary().generateCSS();

  const handleCopyHTML = useCallback(async () => {
    const html = generateHTML([...blocks], includeStyle, getCSS());
    await navigator.clipboard.writeText(html);
    onExportHTML?.(html);
    showCopy("HTML copied!");
  }, [blocks, includeStyle]);

  const handleDownloadHTML = useCallback(() => {
    const html = generateHTML([...blocks], includeStyle, getCSS());
    const blob = new Blob([html], { type: "text/html" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: filename.replace(/\.pdf$/i, "") + ".html",
    });
    a.click();
    URL.revokeObjectURL(a.href);
    onExportHTML?.(html);
    showCopy("HTML downloaded!");
  }, [blocks, filename, includeStyle]);

  const handleCopyText = useCallback(async () => {
    const text = blocksToText([...blocks]);
    await navigator.clipboard.writeText(text);
    showCopy("Text copied!");
  }, [blocks]);

  const sectionCls = "rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 flex flex-col gap-3";
  const btnPrimary =
    "w-full py-2.5 rounded-lg text-xs font-bold bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90 active:scale-[0.98] transition-all";
  const btnOutline =
    "w-full py-2 rounded-lg text-xs font-bold border border-[var(--theme-primary)] text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10 transition-colors";

  return (
    <div className="flex flex-col h-full overflow-y-auto text-[var(--theme-text)] p-4 gap-4 max-w-xl mx-auto">
      <div>
        <h2 className="text-base font-black text-[var(--theme-text)]">{title || "Untitled Document"}</h2>
        <p className="text-[10px] text-[var(--theme-text-muted)] opacity-60 mt-0.5">
          {blocks.length} blocks · {pageSize.toUpperCase()} · {pageMarginMm} mm margins
        </p>
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="print" size="xs" />
            PDF Export
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">
            Uses browser print dialog (@media print). Page size: <strong>{pageSize.toUpperCase()}</strong>, margins: <strong>{pageMarginMm} mm</strong>.
            Interactive blocks (reveal sliders) become static two-panel splits in PDF.
          </p>
        </div>
        <button onClick={handlePDF} className={btnPrimary}>
          Export PDF…
        </button>
        <div className="text-[8px] text-[var(--theme-text-muted)] opacity-40 leading-snug">
          Tip: In the print dialog choose "Save as PDF" and deselect headers/footers for the cleanest output.
        </div>
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="globe" size="xs" />
            HTML Export
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">Generates clean semantic HTML from all blocks.</p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={includeStyle} onChange={(e) => setIncludeStyle(e.target.checked)} className="accent-[var(--theme-primary)]" />
          <span className="text-[10px] text-[var(--theme-text)]">Include &lt;style&gt; tag with design system CSS</span>
        </label>

        <div className="flex gap-2">
          <button onClick={handleCopyHTML} className={btnPrimary}>
            Copy HTML
          </button>
          <button onClick={handleDownloadHTML} className={btnOutline}>
            Download
          </button>
        </div>
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="file-text" size="xs" />
            Plain Text
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60">Strips all markup — just the raw text content of every block.</p>
        </div>
        <button onClick={handleCopyText} className={btnOutline}>
          Copy as Text
        </button>
      </div>

      {copyMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--theme-text)] text-[var(--theme-bg)] text-xs font-bold px-4 py-2 rounded-full shadow-lg pointer-events-none animate-fade-in z-50">
          <Icon name="check" size="xs" />
          {copyMsg}
        </div>
      )}
    </div>
  );
}
