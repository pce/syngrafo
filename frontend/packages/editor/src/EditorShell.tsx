import React, { useEffect, useState } from "react";
import { EditorProvider, useEditor } from "./store/editor-store";
import { EditorCanvas } from "./EditorCanvas";
import { BlockTreePanel } from "./components/panels/BlockTreePanel";
import { StylePanel } from "./components/panels/StylePanel";
import { StatsPanel } from "./components/panels/StatsPanel";
import { NLPPanel } from "./components/panels/NLPPanel";
import { DocumentPanel } from "./components/panels/DocumentPanel";
import { ExportPanel } from "./components/export/ExportPanel";
import type { SDocument } from "./models/sdm";
import type { WorkspaceContext, DocumentIntent } from "./models/editor-context";
import { WORKSPACE_CONTEXT_META } from "./models/editor-context";
import { Icon } from "./components/Icon";
import type { IconName } from "./components/Icon";

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
  onSave,
  className = "",
}: EditorShellProps): React.ReactElement {
  return (
    <EditorProvider
      initialDoc={doc}
      initialContext={initialContext}
      initialIntent={initialIntent}
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
  const { context, isDirty, statusMessage, isAnalyzing } = state;

  const [leftOpen, setLeftOpen] = useState(true);

  // Auto-clear status message after 3 s.
  useEffect(() => {
    if (!statusMessage) return;
    const t = setTimeout(() => dispatch({ type: "CLEAR_STATUS" }), 3000);
    return () => clearTimeout(t);
  }, [statusMessage, dispatch]);

  // Visibility rules.
  const showLeft = context === "layout" || context === "nlp";
  const showCanvas =
    context === "compose" ||
    context === "layout" ||
    context === "review" ||
    context === "nlp";
  // stats and export occupy the full content width (no canvas, no left panel).
  const isFullContentContext = context === "stats" || context === "export";

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
      className={`flex flex-col h-full bg-[var(--theme-bg)] text-[var(--theme-text)] overflow-hidden ${className}`}
    >
      <header className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-0.5 flex-1">
          {Object.values(WORKSPACE_CONTEXT_META).map((meta) => {
            const isActive = context === meta.id;
            return (
              <button
                key={meta.id}
                onClick={() => dispatch({ type: "SET_CONTEXT", context: meta.id })}
                title={`${meta.label}${meta.shortcut ? ` (${meta.shortcut})` : ""}\n${meta.description}`}
                className={[
                  "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide transition-colors",
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

        {state.doc && (
          <span className="text-[11px] font-medium text-[var(--theme-text-muted)] px-2 truncate max-w-48" title={state.doc.meta.title}>
            {state.doc.meta.title || "Untitled"}
          </span>
        )}

        {isAnalyzing && (
          <span className="flex items-center gap-1 text-[9px] text-[var(--theme-text-muted)] animate-pulse">
            <Icon name="refresh" size="xs" />
            <span className="font-mono">analyzing</span>
          </span>
        )}

        {isDirty && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
            title="Unsaved changes"
          />
        )}

        <button
          onClick={handleSave}
          disabled={!isDirty}
          className={[
            "px-3 py-1 rounded text-[10px] font-bold transition-all",
            isDirty
              ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90"
              : "text-[var(--theme-text-muted)] opacity-40 cursor-default",
          ].join(" ")}
        >
          Save
        </button>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {showLeft && !isFullContentContext && leftOpen && (
          <>
            <aside className="shrink-0 w-56 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] flex flex-col overflow-hidden">
              {/* Clickable header collapses the panel — no separate close button */}
              <div
                onClick={() => setLeftOpen(false)}
                title="Click to collapse"
                className="flex items-center gap-1 px-2 py-0.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/40 shrink-0 cursor-pointer hover:bg-[var(--theme-bg)]/70 transition-colors select-none group"
              >
                <Icon name="layout" size="xs" className="text-[var(--theme-text-muted)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 flex-1">
                  Blocks
                </span>
                <Icon
                  name="chevron-left"
                  size="xs"
                  className="text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-40 transition-opacity"
                />
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-b border-[var(--theme-border)]">
                <BlockTreePanel />
              </div>
              <div className="h-72 shrink-0 overflow-hidden">
                <DocumentPanel />
              </div>
            </aside>
            <div className="w-0.5 shrink-0 bg-[var(--theme-border)] hover:bg-[var(--theme-primary)]/40 transition-colors cursor-col-resize" />
          </>
        )}

        {showLeft && !isFullContentContext && !leftOpen && (
          <button
            onClick={() => setLeftOpen(true)}
            className="w-5 shrink-0 flex flex-col items-center justify-center gap-1 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
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

        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {showCanvas && <EditorCanvas />}
          {context === "stats" && <StatsPanel />}
          {context === "export" && <ExportPanel />}
        </div>

        {!isFullContentContext && (context === "layout" || context === "nlp") && (
          <>
            <div className="w-0.5 shrink-0 bg-[var(--theme-border)]" />
            <aside className="shrink-0 w-56 border-l border-[var(--theme-border)] bg-[var(--theme-surface)] overflow-hidden flex flex-col">
              {context === "layout" && <StylePanel />}
              {context === "nlp" && <NLPPanel />}
            </aside>
          </>
        )}
      </div>

      {(statusMessage || isAnalyzing) && (
        <div
          className={[
            "shrink-0 flex items-center gap-2 px-3 py-1 text-[10px] font-medium border-t border-[var(--theme-border)]",
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
                className="opacity-50 hover:opacity-100"
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
