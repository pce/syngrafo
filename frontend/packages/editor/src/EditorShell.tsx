import React, { useCallback, useEffect, useRef, useState } from "react";
import { EditorProvider, useEditor } from "./store/editor-store";
import { EditorCanvas } from "./EditorCanvas";
import { BlockTreePanel } from "./components/panels/BlockTreePanel";
import { StylePanel } from "./components/panels/StylePanel";
import { StatsPanel } from "./components/panels/StatsPanel";
import { NLPPanel } from "./components/panels/NLPPanel";
import { DocumentPanel } from "./components/panels/DocumentPanel";
import { ExportPanel } from "./components/export/ExportPanel";
import { Toolbar } from "./components/toolbar/Toolbar";
import { PAGE_SIZE_MM, type SDocument } from "./models/sdm";
import type { WorkspaceContext, DocumentIntent } from "./models/editor-context";
import { WORKSPACE_CONTEXT_META } from "./models/editor-context";
import { ipcRawCall, parseIpcResult } from "./services/ipc";
import { Icon } from "./components/Icon";
import type { IconName } from "./components/Icon";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { useSwipeToPan } from "./hooks/useSwipeToPan";

const CTX_ICONS: Record<WorkspaceContext, IconName> = {
  compose: "edit",
  layout: "layout",
  review: "eye",
  stats: "bar-chart",
  nlp: "tag",
  export: "download",
};

export interface EditorShellProps {
  doc: SDocument;
  initialContext?: WorkspaceContext;
  initialIntent?: DocumentIntent;
  initialPath?: string;
  onSave?: (doc: SDocument) => Promise<void> | void;
  className?: string;
}

/**
 * Top-level editor component. Wraps `EditorProvider` and renders the full
 * shell layout: toolbar, left/right panels, canvas, and status bar.
 */
export function EditorShell({
  doc,
  initialContext = "layout",
  initialIntent = "freeform",
  initialPath,
  onSave,
  className = "",
}: EditorShellProps): React.ReactElement {
  return (
    <EditorProvider
      initialDoc={doc}
      initialContext={initialContext}
      initialIntent={initialIntent}
      initialPath={initialPath}
    >
      <EditorShellContent {...(onSave ? { onSave } : {})} className={className} />
    </EditorProvider>
  );
}

interface ShellContentProps {
  onSave?: (doc: SDocument) => Promise<void> | void;
  className?: string;
}

function EditorShellContent({ onSave, className = "" }: ShellContentProps): React.ReactElement {
  const { state, dispatch } = useEditor();
  const { context, isDirty, statusMessage, isAnalyzing, isExporting } = state;

  // Panel open/close state — default open on desktop, closed on narrow/touch.
  const initOpen = () => typeof window !== "undefined" ? window.innerWidth >= 768 : true;
  const [leftOpen,  setLeftOpen]  = useState(initOpen);
  const [rightOpen, setRightOpen] = useState(initOpen);
  const [showRulers, setShowRulers] = React.useState(true);

  // Reactive screen-width breakpoint — re-renders when crossing 768 px.
  const isNarrow = useIsNarrow(768);

  // Root ref for swipe-to-pan gesture attachment.
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-clear status message after 3 s.
  useEffect(() => {
    if (!statusMessage) return;
    const t = setTimeout(() => dispatch({ type: "CLEAR_STATUS" }), 3000);
    return () => clearTimeout(t);
  }, [statusMessage, dispatch]);

  // Keyboard shortcuts: Undo / Redo
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dispatch]);

  // Inject editor-scoped CSS once.
  // The @media print rules for whole-page isolation (hiding the DMS shell,
  // fixing the portal's position:fixed) live in react-client/src/index.css
  // because they must target elements outside the editor package.
  // This block covers only editor-internal rules that are needed even when
  // the editor package is used standalone (without react-client).
  useEffect(() => {
    const STYLE_ID = "sgf-editor-css";
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = [
      /* Placeholder on empty contentEditable blocks */
      ".sgf-editable:empty::before {",
      "  content: attr(data-placeholder);",
      "  color: #9ca3af;",
      "  pointer-events: none;",
      "  font-style: italic;",
      "}",
      /* Selection ring */
      ".block-selected {",
      "  outline: 2px solid rgba(59,130,246,0.5);",
      "  outline-offset: 2px;",
      "  border-radius: 2px;",
      "}",
      /* Editor-internal chrome — hidden in print and during export capture.
       * The outer-layer rules (DMS, portal header) are in index.css.         */
      "@media print {",
      "  .sgf-ui { display: none !important; }",
      "  .sgf-canvas-outer { overflow: visible !important; height: auto !important; background: white !important; }",
      "  .sgf-canvas-page  { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; width: 100% !important; }",
      "}",
      /* Belt-and-suspenders: same rules triggered by body.sgf-exporting class */
      "body.sgf-exporting .sgf-ui { display: none !important; }",
      "body.sgf-exporting .sgf-canvas-outer { overflow: visible !important; height: auto !important; background: white !important; }",
      "body.sgf-exporting .sgf-canvas-page  { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; width: 100% !important; }",
      /* Canvas is always kept in the DOM so the print engine can capture it
       * regardless of which context tab is active.  When not in a canvas
       * context the wrapper has .sgf-canvas-hidden (display:none on screen).
       * @media print and body.sgf-exporting both override it so the canvas
       * is visible to the native PDF renderer.                               */
      ".sgf-canvas-hidden { display: none !important; }",
      "@media print { .sgf-canvas-hidden { display: flex !important; flex-direction: column; flex: 1; min-height: 0; } }",
      "body.sgf-exporting .sgf-canvas-hidden { display: flex !important; flex-direction: column; flex: 1; min-height: 0; }",
      /* Non-canvas panels (Files / Stats) — hidden during PDF capture so only
       * the document canvas content appears in the PDF output.               */
      "@media print { .sgf-non-canvas-panel { display: none !important; } }",
      "body.sgf-exporting .sgf-non-canvas-panel { display: none !important; }",
      /* Ensure page background prints on all engines */
      ".sgf-canvas-page { -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
      /* Page rulers and explicit page-break blocks — hidden in print and during PDF export */
      "@media print { .sgf-page-ruler { display: none !important; } }",
      "body.sgf-exporting .sgf-page-ruler { display: none !important; }",
      /* Explicit page-break block — triggers a hard page break in print */
      "@media print { .sgf-pagebreak-block { break-before: page !important; display: block !important; height: 0 !important; overflow: hidden !important; } }",
      "body.sgf-exporting .sgf-pagebreak-block { break-before: page !important; }",
      /* ── Touch / pointer:coarse optimisations ────────────────────────── */
      /* Increase tap targets to Apple/Google HIG minimum (44 × 44 pt).        */
      /* .sgf-touch  — applied to every interactive element in the shell.       */
      "@media (pointer: coarse) {",
      "  .sgf-touch { min-width: 44px; min-height: 44px; }",
      "  .sgf-touch-h { min-height: 44px; }",
      /* Toolbar scrolls horizontally on narrow screens; give it a bit more room. */
      "  .sgf-toolbar-row { gap: 4px; padding-top: 4px; padding-bottom: 4px; }",
      /* Panel drawer: smooth slide + shadow when in overlay mode.              */
      "  .sgf-panel-drawer { transition: transform 220ms cubic-bezier(0.25,0,0.25,1); }",
      "}",
      /* Smooth slide on all screens (panel drawers used in both modes)         */
      ".sgf-panel-drawer { transition: transform 220ms cubic-bezier(0.25,0,0.25,1); }",
    ].join("\n");
    document.head.appendChild(el);
  }, []);

  /// stats,export ("files") are full content width (without canvas, no panels)
  const isFullContentContext = context === "stats" || context === "export";

  /// Swipe-to-pan gestures
  /// - Swipe right from left edge  → open left panel.
  /// - Swipe left  from right edge → open right panel.
  const showLeft   = context === "layout" || context === "nlp";
  const showRight  = !isFullContentContext && (context === "layout" || context === "nlp");
  useSwipeToPan(
    bodyRef,
    () => { if (showLeft  && !isFullContentContext && isNarrow) setLeftOpen(true); },
    () => { if (showRight && isNarrow)                          setRightOpen(true); },
    { enabled: isNarrow }, // Only active when there is a panel to reveal (overlay mode)

  );

  /**
   * Export PDF via the native platform print API.
   *
   * The EditorCanvas is always rendered in the DOM (even when a non-canvas
   * context such as Files or Stats is active) — it is hidden on screen via
   * .sgf-canvas-hidden, but the @media print and body.sgf-exporting CSS
   * rules override that class to reveal the canvas to the PDF renderer.
   *
   * This means we never need to switch context or wait for React to mount
   * the canvas, which eliminates the white-page flash that the old
   * context-switch approach caused.
   */
  const handleExportPDF = useCallback(async () => {
    if (!state.doc || isExporting) return;
    const doc = state.doc;

    dispatch({ type: "SET_EXPORTING", value: true });

    // Apply isolation: hides app chrome via body.sgf-exporting rules,
    // reveals the canvas even if currently in a non-canvas context.
    document.body.classList.add("sgf-exporting");

    // One rAF tick so the CSS class is committed before the print API
    // freezes the layout for PDF rendering.
    await new Promise<void>(r => requestAnimationFrame(() => r()));

    try {
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
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : String(e),
        kind: "error",
      });
    } finally {
      document.body.classList.remove("sgf-exporting");
      dispatch({ type: "SET_EXPORTING", value: false });
      // No context restoration — we never switched context!
    }
  }, [state.doc, isExporting, dispatch]);

  // Derived visibility flags — showLeft/showRight/isFullContentContext are
  // declared above the swipe hook so they can be used there.
  const showCanvas =
    context === "compose" ||
    context === "layout" ||
    context === "review" ||
    context === "nlp";
  // (isFullContentContext is already declared above via showRight/showLeft)

  const handleSave = async () => {
    if (!state.doc) return;
    try {
      await onSave?.(state.doc);
      dispatch({ type: "SET_DIRTY", value: false });
      dispatch({ type: "SET_STATUS", text: "Saved", kind: "success" });
    } catch (e) {
      dispatch({
        type: "SET_STATUS",
        text: e instanceof Error ? e.message : "Save failed",
        kind: "error",
      });
    }
  };

  return (
    <div
      ref={bodyRef}
      className={`flex flex-col h-full bg-[var(--theme-bg)] text-[var(--theme-text)] overflow-hidden ${className}`}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sgf-ui flex items-center gap-0.5 px-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0 z-20 shadow-sm">

        {/* Context tabs — .sgf-touch-h gives 44px min-height on touch */}
        <div className="sgf-ctx-tabs sgf-touch-h flex items-center gap-0.5 flex-1 overflow-x-auto">
          {Object.values(WORKSPACE_CONTEXT_META).map((meta) => {
            const isActive = context === meta.id;
            return (
              <button
                key={meta.id}
                onClick={() => dispatch({ type: "SET_CONTEXT", context: meta.id })}
                title={`${meta.label}${meta.shortcut ? ` (${meta.shortcut})` : ""}\n${meta.description}`}
                className={[
                  "sgf-touch flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wide transition-colors shrink-0",
                  isActive
                    ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                    : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)]",
                ].join(" ")}
              >
                <Icon name={CTX_ICONS[meta.id]} size="xs" />
                <span className="hidden sm:inline">{meta.label}</span>
              </button>
            );
          })}
        </div>

        {/* Document title */}
        {state.doc && (
          <span
            className="text-[11px] font-medium text-[var(--theme-text-muted)] px-2 truncate max-w-[120px] sm:max-w-48 hidden xs:block"
            title={state.doc.meta.title}
          >
            {state.doc.meta.title || "Untitled"}
          </span>
        )}

        {/* Analyzing indicator */}
        {isAnalyzing && (
          <span className="flex items-center gap-1 text-[9px] text-[var(--theme-text-muted)] animate-pulse shrink-0">
            <Icon name="refresh" size="xs" />
            <span className="font-mono hidden sm:inline">analyzing</span>
          </span>
        )}

        {/* Unsaved-changes dot */}
        {isDirty && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
            title="Unsaved changes"
          />
        )}

        {/* PDF button */}
        {state.doc && (
          <button
            onClick={handleExportPDF}
            disabled={isExporting || !state.doc}
            title="Export as PDF"
            className="sgf-touch flex items-center justify-center px-2 py-1.5 rounded text-[10px] font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors disabled:opacity-30 shrink-0"
          >
            {isExporting ? "…" : "PDF"}
          </button>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className={[
            "sgf-touch flex items-center justify-center px-3 py-1.5 rounded text-[10px] font-bold transition-all shrink-0",
            isDirty
              ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90"
              : "text-[var(--theme-text-muted)] opacity-40 cursor-default",
          ].join(" ")}
        >
          Save
        </button>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {/*
        position:relative is the anchor for absolutely-positioned panel drawers
        in overlay (narrow-screen) mode.
      */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">

        {/* ── BACKDROP — tapping dismisses both panels ─────────────────── */}
        {isNarrow && (leftOpen || rightOpen) && (
          <div
            className="absolute inset-0 z-30 bg-black/40"
            style={{ backdropFilter: "blur(1px)" }}
            onClick={() => { setLeftOpen(false); setRightOpen(false); }}
            aria-hidden="true"
          />
        )}

        {/* ── LEFT PANEL ───────────────────────────────────────────────── */}
        {showLeft && !isFullContentContext && (
          <>
            {/* The panel itself.
                Narrow/touch: absolute drawer that slides in/out.
                Desktop:      shrink-0 sidebar OR collapsed strip.           */}
            <aside
              className={[
                "sgf-ui sgf-panel-drawer flex flex-col overflow-hidden",
                "border-r border-[var(--theme-border)] bg-[var(--theme-surface)]",
                isNarrow
                  ? `absolute top-0 bottom-0 left-0 z-40 w-72 shadow-2xl ${
                      leftOpen ? "translate-x-0" : "-translate-x-full"
                    }`
                  : leftOpen
                  ? "shrink-0 w-56"
                  : "hidden",
              ].join(" ")}
            >
              {/* Header / close strip */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setLeftOpen(false)}
                onKeyDown={(e) => e.key === "Enter" && setLeftOpen(false)}
                title="Collapse panel"
                className="sgf-touch-h flex items-center gap-1.5 px-3 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/40 shrink-0 cursor-pointer hover:bg-[var(--theme-bg)]/70 transition-colors select-none group"
              >
                <Icon name="layout" size="xs" className="text-[var(--theme-text-muted)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 flex-1">
                  Blocks
                </span>
                <Icon
                  name="chevron-left"
                  size="xs"
                  className="text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-60 transition-opacity"
                />
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-b border-[var(--theme-border)]">
                <BlockTreePanel />
              </div>
              <div className="h-72 shrink-0 overflow-hidden">
                <DocumentPanel />
              </div>
            </aside>

            {/* Desktop drag-handle / narrow floating toggle */}
            {!isNarrow && leftOpen && (
              <div className="sgf-ui w-0.5 shrink-0 bg-[var(--theme-border)] hover:bg-[var(--theme-primary)]/40 transition-colors cursor-col-resize" />
            )}

            {/* Collapsed strip — desktop only (narrow uses swipe or FAB) */}
            {!isNarrow && !leftOpen && (
              <button
                onClick={() => setLeftOpen(true)}
                title="Open Blocks panel"
                className="sgf-ui w-7 shrink-0 flex flex-col items-center justify-center gap-1 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
              >
                <Icon name="chevron-right" size="xs" />
                <span
                  className="text-[8px] font-black uppercase tracking-widest"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  Blocks
                </span>
              </button>
            )}

            {/* Narrow: floating edge button when panel is closed */}
            {isNarrow && !leftOpen && (
              <button
                onClick={() => setLeftOpen(true)}
                title="Open Blocks panel"
                aria-label="Open Blocks panel"
                className="sgf-ui absolute left-0 top-1/2 -translate-y-1/2 z-20 w-6 h-16 flex flex-col items-center justify-center rounded-r-lg bg-[var(--theme-surface)] border border-l-0 border-[var(--theme-border)] shadow-md text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
              >
                <Icon name="chevron-right" size="xs" />
              </button>
            )}
          </>
        )}

        {/* ── CENTRE COLUMN ────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">

          {/* Editing toolbar — all canvas contexts except review */}
          {showCanvas && context !== "review" && (
            <div className="sgf-ui sgf-toolbar-row flex items-center shrink-0 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]">
              <div className="flex-1 min-w-0 overflow-hidden">
                <Toolbar />
              </div>
              {/* Ruler toggle */}
              <div className="shrink-0 px-1 border-l border-[var(--theme-border)]">
                <button
                  onClick={() => setShowRulers(r => !r)}
                  title={showRulers ? "Hide page rulers" : "Show page rulers"}
                  className={[
                    "sgf-touch flex items-center gap-1 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide transition-colors",
                    showRulers
                      ? "text-indigo-400 hover:text-indigo-500"
                      : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
                  ].join(" ")}
                >
                  <Icon name="columns" size="xs" />
                </button>
              </div>
            </div>
          )}

          {/* Preview bar — review context */}
          {showCanvas && context === "review" && (
            <div className="sgf-ui sgf-touch-h flex items-center gap-2 px-3 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
              <Icon name="eye" size="xs" className="text-[var(--theme-text-muted)] opacity-50" />
              <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-50 flex-1 hidden sm:block">
                Preview
              </span>
              <button
                onClick={handleExportPDF}
                disabled={isExporting || !state.doc}
                className="sgf-touch flex items-center gap-1.5 px-3 py-1 rounded bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] text-[10px] font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Icon name="print" size="xs" />
                {isExporting ? "Exporting…" : "Export PDF"}
              </button>
              <button
                onClick={() => setShowRulers(r => !r)}
                title={showRulers ? "Hide page rulers" : "Show page rulers"}
                className={[
                  "sgf-touch flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors",
                  showRulers
                    ? "text-indigo-400 hover:text-indigo-500"
                    : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
                ].join(" ")}
              >
                <Icon name="columns" size="xs" />
              </button>
            </div>
          )}

          {/* Canvas — always in the DOM so @media print and body.sgf-exporting
               can reveal it for PDF capture regardless of the active context.
               .sgf-canvas-hidden hides it on screen when not in a canvas
               context (display:none), but is overridden during print/export. */}
          <div className={showCanvas ? "flex-1 min-h-0 overflow-auto flex flex-col" : "sgf-canvas-hidden"}>
            <EditorCanvas showRulers={showRulers} />
          </div>

          {context === "stats" && (
            <div className="sgf-non-canvas-panel flex flex-col flex-1 min-h-0 overflow-auto">
              <StatsPanel />
            </div>
          )}
          {context === "export" && (
            <div className="sgf-non-canvas-panel flex flex-col flex-1 min-h-0 overflow-auto">
              <ExportPanel
                onClose={() => dispatch({ type: "SET_CONTEXT", context: "layout" })}
                onExportPDF={handleExportPDF}
              />
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL (Style / NLP) ────────────────────────────────── */}
        {!isFullContentContext && (context === "layout" || context === "nlp") && (
          <>
            {/* The panel itself */}
            <aside
              className={[
                "sgf-ui sgf-panel-drawer flex flex-col overflow-hidden",
                "border-l border-[var(--theme-border)] bg-[var(--theme-surface)]",
                isNarrow
                  ? `absolute top-0 bottom-0 right-0 z-40 w-72 shadow-2xl ${
                      rightOpen ? "translate-x-0" : "translate-x-full"
                    }`
                  : rightOpen
                  ? "shrink-0 w-56"
                  : "hidden",
              ].join(" ")}
            >
              {/* Header / close strip */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setRightOpen(false)}
                onKeyDown={(e) => e.key === "Enter" && setRightOpen(false)}
                title="Collapse panel"
                className="sgf-touch-h flex items-center gap-1.5 px-3 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/40 shrink-0 cursor-pointer hover:bg-[var(--theme-bg)]/70 transition-colors select-none group"
              >
                <Icon
                  name={context === "nlp" ? "tag" : "palette"}
                  size="xs"
                  className="text-[var(--theme-text-muted)]"
                />
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 flex-1">
                  {context === "nlp" ? "NLP" : "Style"}
                </span>
                <Icon
                  name="chevron-right"
                  size="xs"
                  className="text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-60 transition-opacity"
                />
              </div>
              {context === "layout" && <StylePanel />}
              {context === "nlp"    && <NLPPanel />}
            </aside>

            {/* Desktop separator */}
            {!isNarrow && rightOpen && (
              <div className="sgf-ui w-0.5 order-first shrink-0 bg-[var(--theme-border)]" />
            )}

            {/* Collapsed strip — desktop */}
            {!isNarrow && !rightOpen && (
              <button
                onClick={() => setRightOpen(true)}
                title={`Open ${context === "nlp" ? "NLP" : "Style"} panel`}
                className="sgf-ui w-7 shrink-0 flex flex-col items-center justify-center gap-1 border-l border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
              >
                <Icon name="chevron-left" size="xs" />
                <span
                  className="text-[8px] font-black uppercase tracking-widest"
                  style={{ writingMode: "vertical-rl" }}
                >
                  {context === "nlp" ? "NLP" : "Style"}
                </span>
              </button>
            )}

            {/* Narrow: floating edge button when panel is closed */}
            {isNarrow && !rightOpen && (
              <button
                onClick={() => setRightOpen(true)}
                title={`Open ${context === "nlp" ? "NLP" : "Style"} panel`}
                aria-label={`Open ${context === "nlp" ? "NLP" : "Style"} panel`}
                className="sgf-ui absolute right-0 top-1/2 -translate-y-1/2 z-20 w-6 h-16 flex flex-col items-center justify-center rounded-l-lg bg-[var(--theme-surface)] border border-r-0 border-[var(--theme-border)] shadow-md text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
              >
                <Icon name="chevron-left" size="xs" />
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      {(statusMessage || isAnalyzing) && (
        <div
          className={[
            "sgf-ui shrink-0 flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium border-t border-[var(--theme-border)]",
            statusMessage?.kind === "error"
              ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
              : statusMessage?.kind === "warning"
                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                : statusMessage?.kind === "success"
                  ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
                  : "bg-[var(--theme-surface)] text-[var(--theme-text-muted)]",
          ].join(" ")}
        >
          {isAnalyzing && !statusMessage && (
            <>
              <Icon name="refresh" size="xs" className="animate-spin" />
              <span className="flex-1 font-mono">Analyzing…</span>
            </>
          )}
          {statusMessage && (
            <>
              <span className="flex-1">{statusMessage.text}</span>
              <button
                onClick={() => dispatch({ type: "CLEAR_STATUS" })}
                className="sgf-touch opacity-50 hover:opacity-100"
              >
                <Icon name="close" size="xs" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
