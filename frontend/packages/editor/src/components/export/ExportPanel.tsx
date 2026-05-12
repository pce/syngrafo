import React, { useState, useCallback, useEffect } from "react";
import { markupToSafeHtml, type MarkupFormat } from "@syngrafo/shared";
import { useEditor } from "../../store/editor-store";
import { PAGE_SIZE_MM, type SBlock, type SPageConfig, type SStyleClass } from "../../models/sdm";
import { Icon } from "../../components/Icon";
import { ipcRawCall, parseIpcResult } from "../../services/ipc";
import { blocksToHtml, htmlToBlocks } from "../../services/html-parser";
import { blocksToAsciiDoc, blocksToMarkdown, blocksToPlainText } from "../../services/block-serializers";
import { blocksFromJson, decodeDocument } from "../../models";
import { getDocumentBaseName, getDocumentDisplayTitle } from "../../models/document-meta";
import { loadSdocBundle, saveSdocToPath } from "../../services/sdoc-bundle";
import { setAssetBlob, clearAssetBlobs, getAssetBlobEntries } from "../../hooks/useAssetSrc";


/** Removes runtime `nlp` fields from blocks before IPC transmission.
 *  The backend schema does not include NLP annotations and they must be
 *  stripped before serialisation. */
function stripNlp(blocks: SBlock[]): SBlock[] {
  return JSON.parse(
    JSON.stringify(blocks, (k, v) => (k === "nlp" ? undefined : v)),
  ) as SBlock[];
}

interface RecentExport {
  id: number;
  doc_uuid: string;
  title: string;
  path: string;
  kind: "pdf" | "html" | "sdoc" | "md" | "adoc";
  zone_name: string;
  exported_at: number;
  /** Always 0 for PDF exports — the native renderer writes the file
   *  asynchronously and the size is not known at IPC response time. */
  file_size: number;
}

interface RecentDoc {
  uuid:       string;
  title:      string;
  zone_name:  string;
  created_at: number;
  updated_at: number;
}


export interface ExportPanelProps {
  onClose?: () => void;
  /**
   * Called when the user clicks "Export PDF" inside the panel.
   * Should be wired to EditorShell's handleExportPDF so the shell can
   * switch to a canvas context before saucer captures the webview.
   * When omitted the panel falls back to calling dms_save_pdf directly
   * (works only if a canvas is already rendered — use onExportPDF in
     * production to avoid capturing the export panel UI instead of the doc).
    */
  onExportPDF?: () => void;
}

export function ExportPanel({ onClose, onExportPDF }: ExportPanelProps): React.ReactElement {
  const { state, dispatch } = useEditor();
  const { doc, isExporting, documentPath } = state;

  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [recentExports, setRecentExports] = useState<RecentExport[]>([]);
  const [recentDocs,          setRecentDocs]          = useState<RecentDoc[]>([]);
  const [isLoadingRecentDocs, setIsLoadingRecentDocs] = useState(false);

  // File-based templates scanned from data/documents/
  interface TemplateFile {
    name:     string;   // display name (derived from filename)
    path:     string;   // native FS path
    category: string;   // parent directory name
    ext:      "json" | "sdoc";
  }
  const [templateFiles,         setTemplateFiles]         = useState<TemplateFile[]>([]);
  const [isLoadingTemplates,    setIsLoadingTemplates]    = useState(false);
  const [expandedCategories,    setExpandedCategories]    = useState<Set<string>>(new Set());

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const [importHtml, setImportHtml] = useState("");
  const [importMarkupFormat, setImportMarkupFormat] = useState<"html" | MarkupFormat>("html");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importJson, setImportJson]       = React.useState("");
  const [importJsonMsg, setImportJsonMsg] = React.useState<string | null>(null);
  const [isPickingFile, setIsPickingFile] = React.useState(false);
  const [copyFormatMsg, setCopyFormatMsg] = useState<string | null>(null);

  const handleWriteTextExport = useCallback(async (
    extension: string,
    content: string,
    label: string,
  ) => {
    if (!doc) return;
    dispatch({ type: "SET_EXPORTING", value: true });
    try {
      const safeName = getDocumentBaseName(doc, documentPath);
      const pickRaw = await ipcRawCall("dms_select_save_path", `${safeName}.${extension}`, extension);
      const pickRes = parseIpcResult<{ path: string }>(pickRaw);
      const savePath = pickRes.data?.path ?? "";
      if (!savePath) return;
      parseIpcResult(await ipcRawCall("dms_write_file", savePath, content));
      await ipcRawCall("dms_record_export", savePath, doc.id, doc.meta.title, doc.meta.zone ?? "", extension);
      dispatch({ type: "SET_STATUS", text: `${label} exported`, kind: "success" });
      const recentRaw = await ipcRawCall("dms_get_recent_exports", 10);
      const recentRes = parseIpcResult<RecentExport[]>(recentRaw);
      setRecentExports(recentRes.data ?? []);
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    } finally {
      dispatch({ type: "SET_EXPORTING", value: false });
    }
  }, [dispatch, doc]);

  /**
   * Open the native OS file picker via IPC, read the selected file, then
   * either load it as the current document (full SDM envelope) or append
   * its blocks (bare SBlock[] array).
   *
   * The browser File API / <input type="file"> is blocked in this webview;
   * dms_select_files + dms_read_file is the correct native path.
   */
  const handleFilePickerLoad = useCallback(async () => {
    if (isPickingFile) return;
    setIsPickingFile(true);
    try {
      const pickRaw = await ipcRawCall("dms_select_files");
      const pickRes = parseIpcResult<{ paths: string[] }>(pickRaw);
      const paths   = pickRes.data?.paths ?? [];
      if (paths.length === 0) return; // user cancelled

      const path    = paths[0]!;
      const ext     = path.split(".").pop()?.toLowerCase();

      if (ext === "sdoc") {
        // .sdoc ZIP bundle — fetch as data-URL, unzip in JS, populate blob store
        const duRaw = await ipcRawCall("dms_fetch_data_url", path);
        const duRes = parseIpcResult<{ data_url: string }>(duRaw);
        const dataUrl = duRes.data?.data_url;
        if (!dataUrl) throw new Error("Could not read bundle file");

        clearAssetBlobs();
        const bundle = loadSdocBundle(dataUrl);
        for (const [uri, blobUrl] of bundle.assets) setAssetBlob(uri, blobUrl);

        dispatch({ type: "LOAD_DOCUMENT", doc: bundle.document, path, context: "layout" });
        dispatch({
          type: "SET_STATUS",
          text: `Loaded "${getDocumentDisplayTitle(bundle.document, path)}" — ${bundle.assets.size} asset${bundle.assets.size === 1 ? "" : "s"} embedded`,
          kind: "success",
        });
        return;
      }
      const readRaw = await ipcRawCall("dms_read_file", path);
      const readRes = parseIpcResult<{ content: string | null }>(readRaw);
      const text    = readRes.data?.content;

      if (!text) {
        dispatch({ type: "SET_STATUS", text: "File is empty or binary", kind: "warning" });
        return;
      }

      if (ext === "html" || ext === "htm" || ext === "md" || ext === "markdown" || ext === "adoc" || ext === "asciidoc") {
        const html = ext === "html" || ext === "htm"
          ? text
          : markupToSafeHtml(text, ext === "adoc" || ext === "asciidoc" ? "asciidoc" : "markdown");
        const blocks = htmlToBlocks(html);
        if (blocks.length === 0) {
          dispatch({ type: "SET_STATUS", text: "No blocks parsed from file", kind: "warning" });
          return;
        }
        dispatch({ type: "IMPORT_BLOCKS", blocks });
        dispatch({
          type: "SET_STATUS",
          text: `Imported ${blocks.length} block${blocks.length === 1 ? "" : "s"} from file`,
          kind: "success",
        });
        return;
      }

      const parsed: unknown = JSON.parse(text);

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>)["$schema"] === "syngrafo/1"
      ) {
        // Full SDM document — replace the current document
        const sdoc = decodeDocument(text);
        dispatch({ type: "LOAD_DOCUMENT", doc: sdoc, path, context: "layout" });
        dispatch({
          type: "SET_STATUS",
          text: `Loaded "${getDocumentDisplayTitle(sdoc, path)}" (${sdoc.blocks.length} blocks)`,
          kind: "success",
        });
      } else {
        // Bare SBlock[] fragment — append to current document
        const blocks = blocksFromJson(parsed);
        if (blocks.length === 0) {
          dispatch({ type: "SET_STATUS", text: "No blocks found in file", kind: "warning" });
          return;
        }
        dispatch({ type: "IMPORT_BLOCKS", blocks });
        dispatch({
          type: "SET_STATUS",
          text: `Imported ${blocks.length} block${blocks.length === 1 ? "" : "s"} from file`,
          kind: "success",
        });
      }
    } catch (err) {
      dispatch({ type: "SET_STATUS", text: `File error: ${(err as Error).message}`, kind: "error" });
    } finally {
      setIsPickingFile(false);
    }
  }, [isPickingFile, dispatch]);

  const flash = (msg: string) => {
    setCopyMsg(msg);
    setTimeout(() => setCopyMsg(null), 2200);
  };

  const loadRecentExports = useCallback(async () => {
    try {
      const raw = await ipcRawCall("dms_get_recent_exports", 10);
      const res = parseIpcResult<RecentExport[]>(raw);
      setRecentExports(res.data ?? []);
    } catch {
      // Not critical — silently ignore if the binding isn't available yet.
    }
  }, []);

  /** Load the 20 most-recently-saved documents from the workspace DB. */
  const loadRecentDocs = useCallback(async () => {
    setIsLoadingRecentDocs(true);
    try {
      const raw = await ipcRawCall("dms_document_list", "", 20);
      const res = parseIpcResult<RecentDoc[]>(raw);
      setRecentDocs(res.data ?? []);
    } catch { /* silently ignore — no DB connection in some contexts */ }
    finally { setIsLoadingRecentDocs(false); }
  }, []);

  /**
   * Scan data/documents/ for .json and .sdoc template files.
   * Each subfolder becomes a category (freeform, letter, invoice, …).
   * Uses a relative path that works when the binary is run from the
   * webviewapp/ root (development); for distribution set the
   * syngrafo_templates_dir preference to the absolute bundle path.
   */
  const scanTemplates = useCallback(async () => {
    setIsLoadingTemplates(true);
    try {
      // Load preference for custom templates dir, fall back to dev default.
      const prefRaw = await ipcRawCall("dms_load_preference", "syngrafo_templates_dir");
      const prefRes = parseIpcResult<{ value: string }>(prefRaw);
      const templatesDir = prefRes.data?.value || "data/documents";

      const raw = await ipcRawCall("dms_scan_dir", templatesDir, true);
      const res = parseIpcResult<{
        items: Array<{ name: string; path: string; is_dir: boolean }>
      }>(raw);

      const items = res.data?.items ?? [];
      const entries: TemplateFile[] = items
        .filter(i => !i.is_dir && (i.name.endsWith(".json") || i.name.endsWith(".sdoc")))
        .map(i => {
          // Derive category from the path: …/documents/CATEGORY/file.ext
          const norm    = i.path.replace(/\\/g, "/");
          const parts   = norm.split("/");
          const docIdx  = parts.lastIndexOf("documents");
          const category = docIdx >= 0 && parts[docIdx + 1]
            ? parts[docIdx + 1]!
            : "other";
          const ext     = i.name.endsWith(".sdoc") ? "sdoc" as const : "json" as const;
          const rawName = i.name.replace(/\.(json|sdoc)$/, "");
          const displayName = rawName.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          return { name: displayName, path: i.path, category, ext };
        });

      setTemplateFiles(entries);
      // Auto-expand first category if nothing is expanded yet
      const firstCat = entries[0]?.category;
      if (firstCat) {
        setExpandedCategories(prev => prev.size === 0 ? new Set([firstCat]) : prev);
      }
    } catch { /* offline or path not found — silently skip */ }
    finally { setIsLoadingTemplates(false); }
  }, []);

  /**
   * Open a template file by path.
   * Assigns a fresh document UUID so the template itself is never overwritten.
   */
  const handleOpenTemplate = useCallback(async (tpl: { path: string; ext: "json" | "sdoc"; name: string }) => {
    try {
      let loadedDoc;
      if (tpl.ext === "sdoc") {
        const duRaw = await ipcRawCall("dms_fetch_data_url", tpl.path);
        const duRes = parseIpcResult<{ data_url: string }>(duRaw);
        const dataUrl = duRes.data?.data_url;
        if (!dataUrl) throw new Error("Could not read bundle file");
        clearAssetBlobs();
        const bundle = loadSdocBundle(dataUrl);
        for (const [uri, blobUrl] of bundle.assets) setAssetBlob(uri, blobUrl);
        loadedDoc = bundle.document;
      } else {
        const readRaw = await ipcRawCall("dms_read_file", tpl.path);
        const readRes = parseIpcResult<{ content: string | null }>(readRaw);
        const text = readRes.data?.content;
        if (!text) throw new Error("Empty template file");
        loadedDoc = decodeDocument(text);
      }
      // Fresh document identity — never overwrites the template in the DB
      const freshDoc = {
        ...loadedDoc,
        id:   crypto.randomUUID(),
        meta: {
          ...loadedDoc.meta,
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        },
      };
      dispatch({ type: "LOAD_DOCUMENT", doc: freshDoc, path: null, context: "layout" });
      dispatch({ type: "SET_STATUS", text: `New document from "${tpl.name}" — save to keep`, kind: "success" });
    } catch (e) {
      dispatch({ type: "SET_STATUS", text: e instanceof Error ? e.message : "Failed to load template", kind: "error" });
    }
  }, [dispatch]);

  /** Open a previously-saved document by uuid. */
  const handleOpenRecentDoc = useCallback(async (uuid: string) => {
    try {
      const raw = await ipcRawCall("dms_document_load", uuid);
      const res = parseIpcResult<{
        uuid: string; title: string;
        blocks_json: string; styles_json: string;
        page_json: string; zone_name: string;
        created_at: number; updated_at: number;
      }>(raw);
      if (!res.data) throw new Error("Document not found in database");
      const d = res.data;
      // Reassemble into a full SDM JSON string so decodeDocument can
      // validate the schema and fill any missing block ids.
      const fullJson = JSON.stringify({
        $schema: "syngrafo/1",
        id:      d.uuid,
        meta: {
          title:      d.title,
          zone:       d.zone_name || undefined,
          created_at: d.created_at,
          updated_at: d.updated_at,
        },
        page:   JSON.parse(d.page_json)   as SPageConfig,
        styles: JSON.parse(d.styles_json) as Record<string, SStyleClass>,
        blocks: JSON.parse(d.blocks_json),
      });
      const loadedDoc = decodeDocument(fullJson);
      dispatch({ type: "LOAD_DOCUMENT", doc: loadedDoc, path: null, context: "layout" });
      dispatch({ type: "SET_STATUS", text: `Opened "${getDocumentDisplayTitle(loadedDoc)}"`, kind: "success" });
    } catch (e) {
      dispatch({ type: "SET_STATUS", text: e instanceof Error ? e.message : "Failed to open document", kind: "error" });
    }
  }, [dispatch]);

  useEffect(() => {
    void loadRecentExports();
    void loadRecentDocs();
    void scanTemplates();
  }, [loadRecentExports, loadRecentDocs, scanTemplates]);

  const handleSave = useCallback(async () => {
    if (!doc) return;
    try {
      if (documentPath?.toLowerCase().endsWith(".sdoc")) {
        // ── Save back to the original .sdoc bundle on disk ──────────────────
        // Pack the current document + assets into a new ZIP and overwrite the
        // source file.  Assets are fetched from the in-memory blob store that
        // was populated when the bundle was loaded.
        const { missingAssets } = await saveSdocToPath(
          documentPath,
          doc,
          getAssetBlobEntries(),
        );
        dispatch({ type: "SET_DIRTY", value: false });
        if (missingAssets.length > 0) {
          dispatch({
            type: "SET_STATUS",
            text: `Saved .sdoc (${missingAssets.length} asset${missingAssets.length === 1 ? "" : "s"} not embedded: ${missingAssets.join(", ")})`,
            kind: "warning",
          });
          flash("Saved ⚠");
        } else {
          dispatch({ type: "SET_STATUS", text: "Saved to .sdoc file", kind: "success" });
          flash("Saved ✓");
        }
      } else {
        // ── Save to DMS database (original behaviour for .json / in-memory docs)
        const raw = await ipcRawCall(
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
      }
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    }
  }, [doc, documentPath, dispatch]);

  const handleSaveAsSdoc = useCallback(async () => {
    if (!doc) return;
    try {
      // 1. Show the native Save-As dialog with a suggested filename.
      const safeName = getDocumentBaseName(doc, documentPath);
      const pickRaw  = await ipcRawCall("dms_select_save_path", safeName.endsWith(".sdoc") ? safeName : safeName + ".sdoc", "sdoc");
      const pickRes  = parseIpcResult<{ path: string }>(pickRaw);
      const savePath = pickRes.data?.path ?? "";
      if (!savePath) return; // user cancelled

      dispatch({ type: "SET_STATUS", text: "Packing .sdoc bundle\u2026", kind: "info" });

      // 2. Pack and write the bundle (reuses existing saveSdocToPath helper).
      const { missingAssets } = await saveSdocToPath(savePath, doc, getAssetBlobEntries());

      // 3. Record in the recent-exports audit log.
      await ipcRawCall(
        "dms_record_export",
        savePath, doc.id, doc.meta.title, doc.meta.zone ?? "", "sdoc",
      );

      // 4. Update the editor's document path so subsequent "Save" writes back to this file.
      dispatch({ type: "SET_DOCUMENT_PATH", path: savePath });
      dispatch({ type: "SET_DIRTY", value: false });

      if (missingAssets.length > 0) {
        dispatch({
          type: "SET_STATUS",
          text: `Saved .sdoc (${missingAssets.length} asset${missingAssets.length === 1 ? "" : "s"} missing: ${missingAssets.join(", ")})`,
          kind: "warning",
        });
        flash("Saved \u26a0");
      } else {
        dispatch({ type: "SET_STATUS", text: `Saved as .sdoc: ${savePath.split("/").pop()}`, kind: "success" });
        flash("Saved \u2713");
      }
      await loadRecentExports();
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    }
  }, [doc, dispatch, loadRecentExports]);

  const handleExportPDF = useCallback(async () => {
    if (!doc) return;
    dispatch({ type: "SET_EXPORTING", value: true });
    try {
      // Resolve page dimensions in mm (landscape swaps w/h).
      const baseSize = PAGE_SIZE_MM[doc.page.size];
      const { w: wMm, h: hMm } = doc.page.orientation === "landscape"
        ? { w: baseSize.h, h: baseSize.w }
        : baseSize;
      const raw = await ipcRawCall(
        "dms_save_pdf",
        doc.id, doc.meta.title, doc.meta.zone ?? "", "",
        wMm, hMm, doc.page.orientation,
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
      const raw = await ipcRawCall(
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

  const handleExportMarkdown = useCallback(async () => {
    if (!doc) return;
    await handleWriteTextExport("md", blocksToMarkdown(doc.blocks), "Markdown");
  }, [doc, handleWriteTextExport]);

  const handleExportAsciiDoc = useCallback(async () => {
    if (!doc) return;
    await handleWriteTextExport("adoc", blocksToAsciiDoc(doc.blocks), "AsciiDoc");
  }, [doc, handleWriteTextExport]);

  const handleCopyFormat = useCallback(async (label: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyFormatMsg(`${label} copied`);
      setTimeout(() => setCopyFormatMsg(null), 3000);
      dispatch({ type: "SET_STATUS", text: `${label} copied to clipboard`, kind: "success" });
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    }
  }, [dispatch]);

  const handleImportHTML = useCallback(() => {
    if (!doc || !importHtml.trim()) return;
    const html = importMarkupFormat === "html"
      ? importHtml
      : markupToSafeHtml(importHtml, importMarkupFormat);
    const parsed = htmlToBlocks(html);
    if (parsed.length === 0) {
      dispatch({ type: "SET_STATUS", text: "No blocks parsed from markup", kind: "warning" });
      return;
    }
    dispatch({ type: "IMPORT_BLOCKS", blocks: parsed });
    dispatch({ type: "SET_STATUS", text: `Imported ${parsed.length} block${parsed.length === 1 ? "" : "s"}`, kind: "success" });
    setImportMsg(`Imported ${parsed.length} block${parsed.length === 1 ? "" : "s"} ✓`);
    setImportHtml("");
    setTimeout(() => setImportMsg(null), 3000);
  }, [doc, importHtml, importMarkupFormat, dispatch]);

  const handleImportJson = useCallback(() => {
    if (!doc || !importJson.trim()) return;
    let blocks: SBlock[];
    try {
      blocks = blocksFromJson(importJson.trim());
    } catch (e) {
      dispatch({ type: "SET_STATUS", text: `JSON parse error: ${(e as Error).message}`, kind: "error" });
      return;
    }
    if (blocks.length === 0) {
      dispatch({ type: "SET_STATUS", text: "No blocks found in JSON", kind: "warning" });
      return;
    }
    dispatch({ type: "IMPORT_BLOCKS", blocks });
    dispatch({ type: "SET_STATUS", text: `Imported ${blocks.length} block${blocks.length === 1 ? "" : "s"}`, kind: "success" });
    setImportJsonMsg(`Imported ${blocks.length} block${blocks.length === 1 ? "" : "s"} ✓`);
    setImportJson("");
    setTimeout(() => setImportJsonMsg(null), 3000);
  }, [doc, importJson, dispatch]);

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
            {getDocumentDisplayTitle(doc, documentPath)}
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

      {/* ── Templates (from data/documents/) ─────────────────────────── */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
            <Icon name="layout" size="xs" />
            Templates
          </h3>
          <button
            onClick={() => void scanTemplates()}
            disabled={isLoadingTemplates}
            title="Rescan templates directory"
            className="text-[9px] text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors disabled:opacity-40"
          >
            <Icon name="refresh" size="xs" className={isLoadingTemplates ? "animate-spin" : ""} />
          </button>
        </div>

        {templateFiles.length === 0 ? (
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-50 italic">
            {isLoadingTemplates ? "Scanning\u2026" : "No templates found in data/documents/"}
          </p>
        ) : (
          // Accordion — one collapsible section per category
          (() => {
            const byCategory = templateFiles.reduce<Record<string, typeof templateFiles>>((acc, t) => {
              (acc[t.category] ??= []).push(t);
              return acc;
            }, {});
            return Object.entries(byCategory).map(([cat, files]) => {
              const isOpen = expandedCategories.has(cat);
              return (
                <div key={cat} className="border-b border-[var(--theme-border)] last:border-b-0">
                  {/* Category toggle header */}
                  <button
                    onClick={() => toggleCategory(cat)}
                    className="w-full flex items-center gap-2 py-2 text-left group hover:text-[var(--theme-primary)] transition-colors"
                  >
                    <Icon
                      name={isOpen ? "chevron-down" : "chevron-right"}
                      size="xs"
                      className="text-[var(--theme-text-muted)] opacity-60 shrink-0 transition-transform"
                    />
                    <span className="flex-1 text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-80 group-hover:opacity-100 capitalize">
                      {cat}
                    </span>
                    <span className="text-[8px] text-[var(--theme-text-muted)] opacity-40 font-normal">
                      {files.length}
                    </span>
                  </button>
                  {/* Template cards — shown only when expanded */}
                  {isOpen && (
                    <div className="grid grid-cols-2 gap-1.5 pb-2">
                      {files.map(tpl => (
                        <button
                          key={tpl.path}
                          onClick={() => void handleOpenTemplate(tpl)}
                          className="flex flex-col items-start gap-0.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-2 text-left transition-colors hover:border-[var(--theme-primary)]/60 hover:bg-[var(--theme-primary)]/5 active:scale-[0.98]"
                        >
                          <span className="text-[10px] font-bold text-[var(--theme-text)] truncate w-full">{tpl.name}</span>
                          <span className="text-[8px] text-[var(--theme-text-muted)] opacity-50 font-mono uppercase">{tpl.ext}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()
        )}
      </div>

      {/* ── Recent Documents ─────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
            <Icon name="file-text" size="xs" />
            Recent Documents
          </h3>
          <button
            onClick={() => void loadRecentDocs()}
            disabled={isLoadingRecentDocs}
            className="text-[9px] text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors disabled:opacity-40"
            title="Refresh list"
          >
            <Icon name="refresh" size="xs" className={isLoadingRecentDocs ? "animate-spin" : ""} />
          </button>
        </div>
        {recentDocs.length === 0 ? (
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-50 italic">
            {isLoadingRecentDocs ? "Loading…" : "No documents saved to database yet."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--theme-border)]">
            {recentDocs.map((d) => (
              <li key={d.uuid}>
                <button
                  onClick={() => void handleOpenRecentDoc(d.uuid)}
                  className="w-full flex items-center gap-2 py-2 text-left group hover:bg-[var(--theme-primary)]/5 rounded transition-colors px-1"
                >
                  <Icon name="file-text" size="xs" className="shrink-0 text-[var(--theme-text-muted)] opacity-40 group-hover:opacity-70" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-medium text-[var(--theme-text)] truncate group-hover:text-[var(--theme-primary)] transition-colors">
                      {d.title}
                    </span>
                    <span className="block text-[9px] text-[var(--theme-text-muted)] opacity-50">
                      {new Date(d.updated_at * 1000).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" })}
                      {d.zone_name && d.zone_name !== "global" ? ` · ${d.zone_name}` : ""}
                    </span>
                  </span>
                  <Icon name="chevron-right" size="xs" className="shrink-0 text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-40 transition-opacity" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Import Markup ───────────────────────────────────────────────── */}
      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="download" size="xs" className="rotate-180" />
            Import Markup
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">
            Paste HTML, GitHub-flavored Markdown, or AsciiDoc and click Import — blocks are appended to the document.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(["html", "markdown", "asciidoc"] as const).map((format) => (
            <button
              key={format}
              onClick={() => setImportMarkupFormat(format)}
              className={[
                "py-1 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors",
                importMarkupFormat === format
                  ? "bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                  : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50",
              ].join(" ")}
            >
              {format === "asciidoc" ? "AsciiDoc" : format}
            </button>
          ))}
        </div>
        <textarea
          value={importHtml}
          onChange={(e) => setImportHtml(e.target.value)}
          rows={6}
          placeholder={
            importMarkupFormat === "html"
              ? "<h1>Title</h1>\n<p>Paragraph text...</p>\n<ul><li>Item</li></ul>"
              : importMarkupFormat === "markdown"
                ? "# Title\n\n- item\n- [x] task\n\n```js\nconsole.log('hello')\n```"
                : "= Title\n\n* item\n\n[source,js]\n----\nputs 'hello'\n----"
          }
          className="w-full resize-y rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[10px] px-2 py-1.5 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
          spellCheck={false}
        />
        <div className="flex gap-2">
          <button
            onClick={handleImportHTML}
            disabled={!importHtml.trim() || !doc}
            className={btnPrimary}
          >
            Import blocks
          </button>
          <button
            onClick={() => { setImportHtml(""); setImportMsg(null); }}
            disabled={!importHtml.trim()}
            className={btnOutline}
          >
            Clear
          </button>
        </div>
        {importMsg && (
          <p className="text-[10px] text-emerald-600 font-medium">{importMsg}</p>
        )}
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="download" size="xs" className="rotate-180" />
            Import SDM JSON
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">
            Load a full <code className="font-mono">.sdoc</code> / <code className="font-mono">.json</code> document
            (replaces the current document), or paste a bare blocks array below to append.
          </p>
        </div>
        {/* Label-based file inputs are blocked in this webview — use the native picker via IPC instead. */}
        <button
          onClick={() => void handleFilePickerLoad()}
          disabled={isPickingFile}
          className={btnPrimary}
        >
          {isPickingFile ? (
            <span className="flex items-center justify-center gap-1.5">
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Opening…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              <Icon name="download" size="xs" className="rotate-180" />
              Load from file…
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 text-[9px] text-[var(--theme-text-muted)] opacity-40">
          <div className="flex-1 h-px bg-current" />
          or paste a blocks array
          <div className="flex-1 h-px bg-current" />
        </div>
        <textarea
          value={importJson}
          onChange={(e) => setImportJson(e.target.value)}
          rows={5}
          placeholder={'[{"type":"p","spans":[{"text":"Hello"}]}]'}
          className="w-full resize-y rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[10px] px-2 py-1.5 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
          spellCheck={false}
        />
        <div className="flex gap-2">
          <button
            onClick={handleImportJson}
            disabled={!importJson.trim() || !doc}
            className={btnPrimary}
          >
            Import blocks
          </button>
          <button
            onClick={() => { setImportJson(""); setImportJsonMsg(null); }}
            disabled={!importJson.trim()}
            className={btnOutline}
          >
            Clear
          </button>
        </div>
        {importJsonMsg && (
          <p className="text-[10px] text-emerald-600 font-medium">{importJsonMsg}</p>
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
        <button onClick={() => void handleSaveAsSdoc()} className={btnOutline}>
          <span className="flex items-center justify-center gap-1.5">
            <Icon name="download" size="xs" />
            Export as .sdoc bundle…
          </span>
        </button>
      </div>

      <div className={sectionCls}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
            <Icon name="print" size="xs" />
            PDF Export
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">
            Render to PDF via the native engine and the editor's print CSS. Page size:{" "}
            <strong>{doc.page.size.toUpperCase()}</strong>, orientation:{" "}
            <strong>{doc.page.orientation}</strong>.
          </p>
        </div>
        <button onClick={onExportPDF ?? handleExportPDF} disabled={isExporting} className={btnPrimary}>
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
            Text Exports
          </h3>
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-relaxed">
            Generate semantic HTML plus Markdown and AsciiDoc from the supported block subset.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleExportHTML} disabled={isExporting} className={btnPrimary}>
            Export HTML
          </button>
          <button onClick={handleCopyHTML} className={btnOutline}>
            Copy HTML
          </button>
          <button onClick={() => void handleExportMarkdown()} disabled={isExporting} className={btnPrimary}>
            Export Markdown
          </button>
          <button onClick={() => void handleCopyFormat("Markdown", blocksToMarkdown(doc.blocks))} className={btnOutline}>
            Copy Markdown
          </button>
          <button onClick={() => void handleExportAsciiDoc()} disabled={isExporting} className={btnPrimary}>
            Export AsciiDoc
          </button>
          <button onClick={() => void handleCopyFormat("AsciiDoc", blocksToAsciiDoc(doc.blocks))} className={btnOutline}>
            Copy AsciiDoc
          </button>
        </div>
        {copyFormatMsg && <p className="text-[10px] text-emerald-600 font-medium">{copyFormatMsg}</p>}
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
                  {exp.title}
                </span>
                <button
                  onClick={() => void ipcRawCall("dms_open_path", exp.path)}
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
