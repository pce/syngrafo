/**
 * CommandBar.tsx — Midnight Commander-style footer command bar.
 *
 * Layout
 * ──────
 *  [ N selected ]  [ F5 COPY ] [ F6 MOVE ] [ F8 DELETE ] [ SHARE ] [ COMPRESS ] [ ARCHIVE ]
 *
 * The bar receives left/right panel context from Dashboard and:
 * • Uses the "active" panel's selection as the source
 * • Pre-fills copy/move destination with the OTHER panel's current path
 * • Keyboard shortcuts: F5=copy, F6=move, F8=delete, Ctrl+Z=compress, Ctrl+Shift+A=archive
 *
 * All dialogs are mounted here so they overlay the full screen.
 */

import React, { useState, useEffect } from "react";
import Icon from "../Icon";
import {
  CopyMoveDialog,
  DeleteDialog,
  ShareDialog,
  CompressDialog,
  ArchiveDialog,
} from "./FileOpDialogs";

// ── types ─────────────────────────────────────────────────────────────────────

export interface PanelContext {
  path: string;
  selection: string[];
}

export interface CommandBarProps {
  leftPanel: PanelContext;
  rightPanel: PanelContext;
  /** Which panel last had focus — determines source + target for operations */
  activePanel: "left" | "right";
  /** Called after a mutating operation so both panels can refresh */
  onRefresh?: () => void;
}

type ActiveOp =
  | "copy"
  | "move"
  | "delete"
  | "share"
  | "compress"
  | "archive"
  | null;

// ── command button ─────────────────────────────────────────────────────────────

const CmdBtn: React.FC<{
  label: string;
  shortcut?: string;
  disabled?: boolean;
  accent?: string;
  onClick: () => void;
}> = ({ label, shortcut, disabled, accent = "bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]", onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={shortcut ? `${label} (${shortcut})` : label}
    className={`
      flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider
      rounded border border-[var(--theme-border)] transition-colors shrink-0
      disabled:opacity-30 disabled:cursor-not-allowed
      ${accent}
    `}
  >
    {shortcut && (
      <span className="text-[8px] font-black opacity-50 border border-current px-0.5 py-0 rounded mr-0.5">
        {shortcut}
      </span>
    )}
    {label}
  </button>
);

// ── component ─────────────────────────────────────────────────────────────────

const CommandBar: React.FC<CommandBarProps> = ({
  leftPanel,
  rightPanel,
  activePanel,
  onRefresh,
}) => {
  const [activeOp, setActiveOp] = useState<ActiveOp>(null);

  // Derive active / target context
  const active = activePanel === "left" ? leftPanel : rightPanel;
  const target = activePanel === "left" ? rightPanel : leftPanel;

  const hasSelection = active.selection.length > 0;
  const count        = active.selection.length;

  // ── keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't steal focus from text inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "F5")                       { e.preventDefault(); if (hasSelection) setActiveOp("copy"); }
      if (e.key === "F6")                       { e.preventDefault(); if (hasSelection) setActiveOp("move"); }
      if (e.key === "F8")                       { e.preventDefault(); if (hasSelection) setActiveOp("delete"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        // Ctrl+Z for compress (unusual but distinct)
        // Note: we use Alt+C to avoid conflict with system undo
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === "a") {
        e.preventDefault();
        if (hasSelection) setActiveOp("archive");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasSelection]);

  const handleSuccess = () => {
    onRefresh?.();
  };

  const close = () => setActiveOp(null);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Operation dialogs ─────────────────────────────────────────── */}
      {activeOp === "copy" && (
        <CopyMoveDialog
          op="copy"
          sources={active.selection}
          defaultDest={target.path}
          onClose={close}
          onSuccess={handleSuccess}
        />
      )}
      {activeOp === "move" && (
        <CopyMoveDialog
          op="move"
          sources={active.selection}
          defaultDest={target.path}
          onClose={close}
          onSuccess={handleSuccess}
        />
      )}
      {activeOp === "delete" && (
        <DeleteDialog
          paths={active.selection}
          onClose={close}
          onSuccess={handleSuccess}
        />
      )}
      {activeOp === "share" && active.selection.length === 1 && active.selection[0] && (
        <ShareDialog
          path={active.selection[0]}
          onClose={close}
        />
      )}
      {activeOp === "compress" && (
        <CompressDialog
          paths={active.selection}
          onClose={close}
          onSuccess={handleSuccess}
        />
      )}
      {activeOp === "archive" && (
        <ArchiveDialog
          paths={active.selection}
          defaultDestDir={active.path}
          onClose={close}
          onSuccess={handleSuccess}
        />
      )}

      {/* ── Bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0 overflow-x-auto">

        {/* Selection indicator */}
        <div className="flex items-center gap-1 min-w-[90px] shrink-0">
          {hasSelection ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-primary)] shrink-0" />
              <span className="text-[9px] font-bold text-[var(--theme-text)]">
                {count} selected
              </span>
            </>
          ) : (
            <span className="text-[9px] text-[var(--theme-text-muted)]">No selection</span>
          )}
        </div>

        <div className="h-4 w-px bg-[var(--theme-border)] shrink-0" />

        {/* Path preview */}
        <span className="text-[9px] font-mono text-[var(--theme-text-muted)] truncate max-w-[150px] hidden md:block">
          {active.path
            ? active.path.split("/").slice(-2).join("/")
            : "…"}
          {target.path && (
            <>
              {" → "}
              {target.path.split("/").slice(-2).join("/")}
            </>
          )}
        </span>

        <div className="flex-1" />

        {/* ── Commands ────────────────────────────────────────────────── */}
        <CmdBtn
          label="Copy"
          shortcut="F5"
          disabled={!hasSelection}
          accent="text-[var(--theme-text)] bg-[var(--theme-surface)] hover:bg-blue-500/10 hover:border-blue-400/30 hover:text-blue-500"
          onClick={() => setActiveOp("copy")}
        />
        <CmdBtn
          label="Move"
          shortcut="F6"
          disabled={!hasSelection}
          accent="text-[var(--theme-text)] bg-[var(--theme-surface)] hover:bg-amber-500/10 hover:border-amber-400/30 hover:text-amber-500"
          onClick={() => setActiveOp("move")}
        />
        <CmdBtn
          label="Delete"
          shortcut="F8"
          disabled={!hasSelection}
          accent="text-[var(--theme-text)] bg-[var(--theme-surface)] hover:bg-rose-500/10 hover:border-rose-400/30 hover:text-rose-500"
          onClick={() => setActiveOp("delete")}
        />

        <div className="h-4 w-px bg-[var(--theme-border)] shrink-0" />

        <CmdBtn
          label="Share"
          disabled={!hasSelection || count > 1}
          accent="text-[var(--theme-text)] bg-[var(--theme-surface)] hover:bg-violet-500/10 hover:border-violet-400/30 hover:text-violet-500"
          onClick={() => setActiveOp("share")}
        />
        <CmdBtn
          label="Compress"
          disabled={!hasSelection}
          accent="text-[var(--theme-text)] bg-[var(--theme-surface)] hover:bg-emerald-500/10 hover:border-emerald-400/30 hover:text-emerald-500"
          onClick={() => setActiveOp("compress")}
        />
        <CmdBtn
          label="Archive"
          disabled={!hasSelection}
          accent="text-[var(--theme-text)] bg-[var(--theme-surface)] hover:bg-cyan-500/10 hover:border-cyan-400/30 hover:text-cyan-500"
          onClick={() => setActiveOp("archive")}
        />
      </div>
    </>
  );
};

export default CommandBar;

