import React, { useState, useCallback, useEffect } from "react";
import { useEditor } from "../../store/editor-store";
import { isTextBlock, type SBlock, type Span } from "../../models/sdm";
import { Icon } from "../../components/Icon";

declare global {
  interface Window {
    saucer?: {
      call<T = string>(name: string, params?: unknown[]): Promise<T>;
      exposed?: Record<string, (...args: unknown[]) => Promise<string>>;
    };
  }
}

async function ipcCall(name: string, ...args: unknown[]): Promise<string | null> {
  const fn = window.saucer?.exposed?.[name];
  if (typeof fn !== "function") return null;
  return fn(...args);
}

/** Removes runtime `nlp` fields from blocks before IPC transmission.
 *  The backend schema does not include NLP annotations and they must be
 *  stripped before serialisation. */
function stripNlp(blocks: SBlock[]): SBlock[] {
  return JSON.parse(
    JSON.stringify(blocks, (k, v) => (k === "nlp" ? undefined : v)),
  ) as SBlock[];
}

interface IpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function parseIpcResult<T>(raw: string | null): IpcResult<T> {
  if (raw === null) throw new Error("IPC binding not available");
  const parsed = JSON.parse(raw) as IpcResult<T>;
  if (!parsed.ok) throw new Error(parsed.error ?? "Unknown backend error");
  return parsed;
}

interface RecentExport {
  id: number;
  doc_uuid: string;
  title: string;
  path: string;
  kind: "pdf" | "html";
  zone_name: string;
  exported_at: number;
  /** Always 0 for PDF exports — the native renderer writes the file
   *  asynchronously and the size is not known at IPC response time. */
  file_size: number;
}

function spansToHtml(spans: Span[]): string {
  return spans
    .map((span) => {
      let html = span.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      for (const mark of span.marks ?? []) {
        switch (mark) {
          case "bold":      html = `<strong>${html}</strong>`; break;
          case "italic":    html = `<em>${html}</em>`; break;
          case "underline": html = `<u>${html}</u>`; break;
          case "strike":    html = `<s>${html}</s>`; break;
          case "code":      html = `<code>${html}</code>`; break;
          case "link":      html = `<a href="${span.href ?? "#"}">${html}</a>`; break;
          case "sup":       html = `<sup>${html}</sup>`; break;
          case "sub":       html = `<sub>${html}</sub>`; break;
        }
      }
      return html;
    })
    .join("");
}

function blockToHtml(block: SBlock): string {
  switch (block.type) {
    case "p":
      return `<p>${spansToHtml(block.spans)}</p>`;
    case "h1":
      return `<h1>${spansToHtml(block.spans)}</h1>`;
    case "h2":
      return `<h2>${spansToHtml(block.spans)}</h2>`;
    case "h3":
      return `<h3>${spansToHtml(block.spans)}</h3>`;
    case "h4":
      return `<h4>${spansToHtml(block.spans)}</h4>`;
    case "quote":
      return `<blockquote>${spansToHtml(block.spans)}</blockquote>`;
    case "li":
      return `<li>${spansToHtml(block.spans)}</li>`;
    case "td":
      return `<td>${spansToHtml(block.spans)}</td>`;
    case "th":
      return `<th>${spansToHtml(block.spans)}</th>`;
    case "code": {
      const escaped = block.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const lang = block.language ? ` class="language-${block.language}"` : "";
      return `<pre><code${lang}>${escaped}</code></pre>`;
    }
    case "img": {
      const alt = (block.alt ?? "").replace(/"/g, "&quot;");
      const fitStyle = block.fit ? ` style="object-fit:${block.fit}"` : "";
      const caption = block.caption
        ? `<figcaption>${block.caption}</figcaption>`
        : "";
      return `<figure><img src="${block.src}" alt="${alt}"${fitStyle} />${caption}</figure>`;
    }
    case "hr":
      return `<hr />`;
    case "pagebreak":
      return `<div style="page-break-after:always"></div>`;
    case "ul":
      return `<ul>${block.children
        .map((c) => `<li>${spansToHtml(c.spans)}</li>`)
        .join("")}</ul>`;
    case "ol":
      return `<ol>${block.children
        .map((c) => `<li>${spansToHtml(c.spans)}</li>`)
        .join("")}</ol>`;
    case "hbox":
      return `<div style="display:flex;gap:1rem">${block.children
        .map(blockToHtml)
        .join("")}</div>`;
    case "vbox":
      return `<div style="display:flex;flex-direction:column;gap:1rem">${block.children
        .map(blockToHtml)
        .join("")}</div>`;
    case "col": {
      const w = block.width ? `flex:0 0 ${block.width}` : "flex:1";
      return `<div style="${w};min-width:0">${block.children
        .map(blockToHtml)
        .join("")}</div>`;
    }
    case "grid": {
      const cols = block.columns.join(" ");
      return `<div style="display:grid;grid-template-columns:${cols};gap:1rem">${block.children
        .map(blockToHtml)
        .join("")}</div>`;
    }
    case "table":
      return `<table><tbody>${block.children.map(blockToHtml).join("")}</tbody></table>`;
    case "tr":
      return `<tr>${block.children.map(blockToHtml).join("")}</tr>`;
    case "callout": {
      const title = block.title ? `<strong>${block.title}</strong> ` : "";
      return `<div class="callout callout-${block.variant}" role="note">${title}${block.children
        .map(blockToHtml)
        .join("")}</div>`;
    }
    default:
      return "";
  }
}

/** Recursively serialise `SBlock[]` to an HTML string. */
function blocksToHtml(blocks: SBlock[]): string {
  return blocks.map(blockToHtml).filter(Boolean).join("\n");
}

/** Extract all readable text from the document as plain text. */
function blocksToPlainText(blocks: SBlock[]): string {
  const lines: string[] = [];
  const visit = (b: SBlock) => {
    if (isTextBlock(b)) {
      const t = b.spans.map((s) => s.text).join("").trim();
      if (t) lines.push(t);
    } else if (b.type === "code") {
      if (b.text.trim()) lines.push(b.text.trim());
    } else if ("children" in b) {
      const ch = (b as unknown as Record<string, unknown>)["children"];
      if (Array.isArray(ch)) (ch as SBlock[]).forEach(visit);
    }
  };
  blocks.forEach(visit);
  return lines.join("\n\n");
}

export interface ExportPanelProps {
  onClose?: () => void;
}

export function ExportPanel({ onClose }: ExportPanelProps): React.ReactElement {
  const { state, dispatch } = useEditor();
  const { doc, isExporting } = state;

  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [recentExports, setRecentExports] = useState<RecentExport[]>([]);

  const flash = (msg: string) => {
    setCopyMsg(msg);
    setTimeout(() => setCopyMsg(null), 2200);
  };

  const loadRecentExports = useCallback(async () => {
    try {
      const raw = await ipcCall("dms_get_recent_exports", 10);
      const res = parseIpcResult<RecentExport[]>(raw);
      setRecentExports(res.data ?? []);
    } catch {
      // Not critical — silently ignore if the binding isn't available yet.
    }
  }, []);

  useEffect(() => {
    void loadRecentExports();
  }, [loadRecentExports]);

  const handleSave = useCallback(async () => {
    if (!doc) return;
    try {
      const raw = await ipcCall(
        "dms_document_save",
        doc.id,
        doc.meta.title,
        JSON.stringify(stripNlp(doc.blocks)),
        JSON.stringify(doc.styles),
        JSON.stringify(doc.page),
        doc.meta.zone ?? "",
      );
      parseIpcResult(raw);
      dispatch({ type: "SET_DIRTY", value: false });
      dispatch({ type: "SET_STATUS", text: "Document saved", kind: "success" });
      flash("Saved ✓");
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    }
  }, [doc, dispatch]);

  const handleExportPDF = useCallback(async () => {
    if (!doc) return;
    dispatch({ type: "SET_EXPORTING", value: true });
    try {
      const raw = await ipcCall(
        "dms_save_pdf",
        doc.id,
        doc.meta.title,
        doc.meta.zone ?? "",
        "",
      );
      parseIpcResult(raw);
      dispatch({ type: "SET_STATUS", text: "PDF exported", kind: "success" });
      flash("PDF exported ✓");
      await loadRecentExports();
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    } finally {
      dispatch({ type: "SET_EXPORTING", value: false });
    }
  }, [doc, dispatch, loadRecentExports]);

  const handleExportHTML = useCallback(async () => {
    if (!doc) return;
    dispatch({ type: "SET_EXPORTING", value: true });
    try {
      const raw = await ipcCall(
        "dms_save_html",
        doc.id,
        doc.meta.title,
        blocksToHtml(doc.blocks),
        doc.meta.zone ?? "",
        "",
      );
      parseIpcResult(raw);
      dispatch({ type: "SET_STATUS", text: "HTML exported", kind: "success" });
      flash("HTML exported ✓");
      await loadRecentExports();
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    } finally {
      dispatch({ type: "SET_EXPORTING", value: false });
    }
  }, [doc, dispatch, loadRecentExports]);

  const handleCopyHTML = useCallback(async () => {
    if (!doc) return;
    try {
      const html = blocksToHtml(doc.blocks);
      await navigator.clipboard.writeText(html);
      flash("HTML copied!");
      dispatch({ type: "SET_STATUS", text: "HTML copied to clipboard", kind: "success" });
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    }
  }, [doc, dispatch]);

  const handleCopyText = useCallback(async () => {
    if (!doc) return;
    try {
      const text = blocksToPlainText(doc.blocks);
      await navigator.clipboard.writeText(text);
      flash("Text copied!");
      dispatch({ type: "SET_STATUS", text: "Plain text copied to clipboard", kind: "success" });
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    }
  }, [doc, dispatch]);

  const sectionCls =
    "rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 flex flex-col gap-3";
  const btnPrimary =
    "w-full py-2.5 rounded-lg text-xs font-bold bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const btnOutline =
    "w-full py-2 rounded-lg text-xs font-bold border border-[var(--theme-primary)] text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--theme-text-muted)] opacity-50 p-6 gap-2">
        <Icon name="download" size="lg" />
        <span className="text-[10px] font-medium uppercase tracking-wide">No document loaded</span>
        {onClose && (
          <button onClick={onClose} className="mt-2 text-[9px] underline opacity-70">
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-[var(--theme-text)] p-4 gap-4 max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-black text-[var(--theme-text)] truncate">
            {doc.meta.title || "Untitled Document"}
          </h2>
          <p className="text-[10px] text-[var(--theme-text-muted)] opacity-60 mt-0.5">
            {doc.blocks.length} blocks · {doc.page.size.toUpperCase()} · {doc.page.orientation} · {doc.page.margin} margin
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)]"
            title="Close"
          >
            <Icon name="close" size="xs" />
          </button>
        )}
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="bookmark" size="xs" />
            Save Document
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">
            Persist the document to the workspace database. Required before exporting.
          </p>
        </div>
        <button onClick={handleSave} className={btnPrimary}>
          Save Document
        </button>
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="print" size="xs" />
            PDF Export
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">
            Render to PDF via the native engine. Page size:{" "}
            <strong>{doc.page.size.toUpperCase()}</strong>, orientation:{" "}
            <strong>{doc.page.orientation}</strong>.
          </p>
        </div>
        <button onClick={handleExportPDF} disabled={isExporting} className={btnPrimary}>
          {isExporting ? (
            <span className="flex items-center justify-center gap-1.5">
              <Icon name="refresh" size="xs" /> Exporting…
            </span>
          ) : (
            "Export PDF"
          )}
        </button>
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="globe" size="xs" />
            HTML Export
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">
            Generate clean semantic HTML. Save via the backend or copy to clipboard.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportHTML} disabled={isExporting} className={btnPrimary}>
            Export HTML
          </button>
          <button onClick={handleCopyHTML} className={btnOutline}>
            Copy HTML
          </button>
        </div>
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="file-text" size="xs" />
            Plain Text
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60">
            Strips all markup — raw text from every block.
          </p>
        </div>
        <button onClick={handleCopyText} className={btnOutline}>
          Copy as Plain Text
        </button>
      </div>

      <div className={sectionCls}>
        <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
          <Icon name="refresh" size="xs" />
          Recent Exports
        </h3>
        {recentExports.length === 0 ? (
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-50 italic">
            No recent exports.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recentExports.map((exp) => (
              <li key={exp.id} className="flex items-center gap-2 text-[9px]">
                <span className="text-[var(--theme-text-muted)] opacity-60 shrink-0 w-16 tabular-nums">
                  {new Date(exp.exported_at * 1000).toLocaleDateString()}
                </span>
                <span
                  className={[
                    "shrink-0 px-1 py-0.5 rounded text-[8px] font-bold uppercase",
                    exp.kind === "pdf"
                      ? "bg-rose-500/15 text-rose-600"
                      : "bg-blue-500/15 text-blue-600",
                  ].join(" ")}
                >
                  {exp.kind.toUpperCase()}
                </span>
                <span className="flex-1 truncate text-[var(--theme-text)] opacity-80">
                  {exp.title || "Untitled"}
                </span>
                <button
                  onClick={() => void ipcCall("dms_open_path", exp.path)}
                  className="shrink-0 text-[var(--theme-primary)] hover:opacity-70 transition-opacity font-bold"
                  title={exp.path}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {copyMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-[var(--theme-text)] text-[var(--theme-bg)] text-xs font-bold px-4 py-2 rounded-full shadow-lg pointer-events-none z-50">
          <Icon name="check" size="xs" />
          {copyMsg}
        </div>
      )}
    </div>
  );
}
