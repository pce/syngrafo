import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import {
  EditorShell,
  type SDocument,
  createDefaultDocument,
  getDocumentDisplayTitle,
  normalizeDocumentMetadata,
} from "@syngrafo/editor";
import { Icon } from "./Icon";
import { useSettings } from "../store/settings-store";
import { getResolvedPaperStyle, paperStyleBackgroundCss } from "../models/paper-style";

export interface EditorPortalProps {
  /** Mounts the editor subtree when true; unmounting releases all resources. */
  open: boolean;
  /** Document to edit. If omitted, a blank document is created on first open. */
  doc?: SDocument;
  onClose?: () => void;
  /** Receives the updated document after the user presses Save. */
  onSave?: (doc: SDocument) => void;
  workingDir?: string;
}

/**
 * Full-screen editor portal.
 *
 * The guard component returns null when closed, so the entire EditorProvider /
 * EditorShell subtree only exists while the portal is open — hooks, observers,
 * and timers all clean up automatically on close.
 */
export function EditorPortal({ open, doc, onClose, onSave, workingDir }: EditorPortalProps) {
  if (!open) return null;
  return <EditorPortalContent doc={doc} onClose={onClose} onSave={onSave} workingDir={workingDir} />;
}

interface ContentProps {
  doc?: SDocument;
  onClose?: () => void;
  onSave?: (doc: SDocument) => void;
  workingDir?: string;
}

function EditorPortalContent({ doc: docProp, onClose, onSave, workingDir }: ContentProps) {
  useLingui();
  const { settings } = useSettings();
  const paper = getResolvedPaperStyle(settings.paperStyles, settings.defaultPaperStyleId);
  const [doc] = useState<SDocument>(() => {
    if (docProp) return normalizeDocumentMetadata(docProp, workingDir);
    return createDefaultDocument({ title: "" });
  });

  const handleClose = useCallback(() => onClose?.(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  useEffect(() => {
    const prev = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    return () => {
      window.document.body.style.overflow = prev;
    };
  }, []);

  const displayTitle = getDocumentDisplayTitle(doc, workingDir);

  return createPortal(
    <div
      id="sgf-editor-root"
      className="fixed inset-0 z-[200] flex flex-col bg-[var(--theme-bg)] text-[var(--theme-text)]"
      style={{ background: "var(--theme-bg)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Editor: ${displayTitle}`}
    >
      <header className="sgf-portal-header flex items-center gap-2 px-4 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] shrink-0 shadow-sm z-10">
        <Icon name="edit" size="xs" className="text-[var(--theme-primary)] shrink-0" />
        <span
          className="text-sm font-semibold text-[var(--theme-text)] flex-1 truncate"
          title={displayTitle}
        >
          {displayTitle}
        </span>
        <span className="text-[9px] text-[var(--theme-text-muted)] hidden sm:block select-none">
          {i18n._({ id: "Esc to close", message: "Esc to close" })}
        </span>
        <button
          onClick={handleClose}
          title={i18n._({ id: "Close editor (Esc)", message: "Close editor (Esc)" })}
          className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors shrink-0"
        >
          <Icon name="close" size="xs" />
        </button>
      </header>

      <div className="flex-1 min-h-0" style={{ background: paperStyleBackgroundCss(paper) }}>
        <EditorShell doc={doc} onSave={onSave} initialPath={workingDir} className="flex-1 min-h-0" />
      </div>
    </div>,
    window.document.body,
  );
}
