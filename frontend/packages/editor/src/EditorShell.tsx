import React, { useEffect, useState } from "react";
import { useEditor } from "./store/editor-store";
import { EditorCanvas } from "./EditorCanvas";
import { BlockTreePanel } from "./components/panels/BlockTreePanel";
import { StylePanel } from "./components/panels/StylePanel";
import { StatsPanel } from "./components/panels/StatsPanel";
import { NLPPanel } from "./components/panels/NLPPanel";
import { DocumentPanel } from "./components/panels/DocumentPanel";
import { ExportPanel } from "./components/export/ExportPanel";
import type { DocumentModel } from "./models/document";
import type { WorkspaceContext, DocumentIntent } from "./models/editor-context";
import { WORKSPACE_CONTEXT_META } from "./models/editor-context";
import { encodePdfProj } from "./services/project";

const CTX_ICONS: Record<WorkspaceContext, string> = {
  compose: "✏",
  layout: "⊞",
  review: "👁",
  stats: "📊",
  nlp: "🏷",
  export: "⬇",
};

export interface EditorShellProps {
  document: DocumentModel;
  initialContext?: WorkspaceContext;
  initialIntent?: DocumentIntent;
  onSave?: (json: string) => void;
  className?: string;
}

export function EditorShell({ document: docProp, initialContext = "layout", initialIntent = "freeform", onSave, className = "" }: EditorShellProps) {
  const { state, dispatch } = useEditor();

  useEffect(() => {
    dispatch({ type: "SET_DOCUMENT", document: docProp });
    dispatch({ type: "SET_CONTEXT", context: initialContext });
    dispatch({ type: "SET_INTENT", intent: initialIntent });
  }, [docProp]);

  const { context, isDirty, statusMessage, isAnalyzing } = state;

  const [leftOpen, setLeftOpen] = useState(true);

  const showLeft = context === "layout";
  const showRight = context === "layout" || context === "nlp";
  const showCanvas = context === "compose" || context === "layout" || context === "review" || context === "nlp";

  const handleSave = () => {
    if (!state.document) return;
    const json = encodePdfProj(state.document);
    onSave?.(json);
    dispatch({ type: "SET_DIRTY", isDirty: false });
    dispatch({ type: "SET_STATUS", text: "Saved", statusType: "success" });
  };

  useEffect(() => {
    if (!statusMessage) return;
    const t = setTimeout(() => dispatch({ type: "CLEAR_STATUS" }), 3000);
    return () => clearTimeout(t);
  }, [statusMessage, dispatch]);

  return (
    <div className={`flex flex-col h-full bg-[var(--theme-bg)] text-[var(--theme-text)] overflow-hidden ${className}`}>
      <header className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-0.5 flex-1">
          {Object.values(WORKSPACE_CONTEXT_META).map((meta) => {
            const isActive = context === meta.id;
            return (
              <button
                key={meta.id}
                onClick={() => dispatch({ type: "SET_CONTEXT", context: meta.id })}
                title={`${meta.label} (${meta.shortcut ?? ""})\n${meta.description}`}
                className={[
                  "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide transition-colors",
                  isActive
                    ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                    : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)]",
                ].join(" ")}
              >
                <span>{CTX_ICONS[meta.id]}</span>
                <span className="hidden sm:inline">{meta.label}</span>
              </button>
            );
          })}
        </div>

        {isAnalyzing && <span className="text-[9px] text-[var(--theme-text-muted)] animate-pulse font-mono">⟳ analyzing</span>}

        {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />}

        <button
          onClick={handleSave}
          disabled={!isDirty}
          className={[
            "px-3 py-1 rounded text-[10px] font-bold transition-all",
            isDirty ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90" : "text-[var(--theme-text-muted)] opacity-40 cursor-default",
          ].join(" ")}
        >
          Save
        </button>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {showLeft && leftOpen && (
          <>
            <aside className="shrink-0 w-56 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] flex flex-col overflow-hidden">
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

        {showLeft && !leftOpen && (
          <button
            onClick={() => setLeftOpen(true)}
            className="w-5 shrink-0 flex flex-col items-center justify-center gap-0.5 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
          >
            <span className="text-[8px] font-black uppercase tracking-widest" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
              Blocks
            </span>
          </button>
        )}

        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {showCanvas && <EditorCanvas readOnly={context === "review"} className="flex-1" />}
          {context === "stats" && <StatsPanel />}
          {context === "export" && <ExportPanel />}
        </div>

        {showRight && (
          <>
            <div className="w-0.5 shrink-0 bg-[var(--theme-border)]" />
            <aside className="shrink-0 w-56 border-l border-[var(--theme-border)] bg-[var(--theme-surface)] overflow-hidden flex flex-col">
              {context === "layout" && <StylePanel />}
              {context === "nlp" && <NLPPanel />}
            </aside>
          </>
        )}
      </div>

      {statusMessage && (
        <div
          className={[
            "shrink-0 flex items-center gap-2 px-3 py-1 text-[10px] font-medium border-t border-[var(--theme-border)]",
            statusMessage.type === "error"
              ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
              : statusMessage.type === "warning"
                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                : statusMessage.type === "success"
                  ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
                  : "bg-[var(--theme-surface)] text-[var(--theme-text-muted)]",
          ].join(" ")}
        >
          <span className="flex-1">{statusMessage.text}</span>
          <button onClick={() => dispatch({ type: "CLEAR_STATUS" })} className="text-[9px] opacity-50 hover:opacity-100">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
