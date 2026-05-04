import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { EditorProvider, EditorShell, DocumentModel } from "@syngrafo/editor";
import Icon from "./Icon";

export interface EditorPortalProps {
  /** Mounts the editor subtree when true; unmounting releases all resources. */
  open: boolean;
  onClose: () => void;
  /** Shown in the portal header; falls back to the document's own title. */
  title?: string;
  /** Provide an existing document to continue editing, or omit for a blank one. */
  initialDocument?: DocumentModel;
  /** Receives the serialised JSON after the user presses Save. */
  onSave?: (json: string) => void;
}

/**
 * Full-screen editor portal.
 *
 * The guard component returns null when closed, so the entire EditorProvider /
 * EditorShell subtree only exists while the portal is open — hooks, signals,
 * observers and timers all clean up automatically on close.
 */
export function EditorPortal({ open, onClose, title, initialDocument, onSave }: EditorPortalProps) {
  if (!open) return null;
  return (
    <EditorPortalContent
      onClose={onClose}
      title={title}
      initialDocument={initialDocument}
      onSave={onSave}
    />
  );
}

interface ContentProps {
  onClose: () => void;
  title?: string;
  initialDocument?: DocumentModel;
  onSave?: (json: string) => void;
}

function EditorPortalContent({ onClose, title, initialDocument, onSave }: ContentProps) {
  const [doc] = useState<DocumentModel>(
    () => initialDocument ?? new DocumentModel(title ?? "Untitled Document"),
  );

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  useEffect(() => {
    const prev = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    return () => { window.document.body.style.overflow = prev; };
  }, []);

  const displayTitle = title ?? doc.getTitle();

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-[var(--theme-bg)] text-[var(--theme-text)]"
      role="dialog"
      aria-modal="true"
      aria-label={`Editor: ${displayTitle}`}
    >
      <header className="flex items-center gap-2 px-4 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] shrink-0 shadow-sm z-10">
        <Icon name="edit" size="xs" className="text-[var(--theme-primary)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--theme-text)] flex-1 truncate" title={displayTitle}>
          {displayTitle}
        </span>
        <span className="text-[9px] text-[var(--theme-text-muted)] hidden sm:block select-none">Esc to close</span>
        <button
          onClick={handleClose}
          title="Close editor (Esc)"
          className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors shrink-0"
        >
          <Icon name="close" size="xs" />
        </button>
      </header>

      <EditorProvider initialDocument={doc}>
        <EditorShell document={doc} onSave={onSave} className="flex-1 min-h-0" />
      </EditorProvider>
    </div>,
    window.document.body,
  );
}
