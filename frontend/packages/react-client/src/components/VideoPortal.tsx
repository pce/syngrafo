import React, { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { VideoEditorPage } from "../../../video/src/editor/VideoEditorPage";

export interface VideoPortalProps {
  open: boolean;
  onClose?: () => void;
  workingDir?: string;
}

export function VideoPortal({ open, onClose, workingDir }: VideoPortalProps) {
  if (!open) return null;
  return <VideoPortalContent onClose={onClose} workingDir={workingDir} />;
}

interface ContentProps {
  onClose?: () => void;
  workingDir?: string;
}

function VideoPortalContent({ onClose, workingDir }: ContentProps) {
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

  return createPortal(
    <div
      id="sgf-video-root"
      className="fixed inset-0 z-[200] flex flex-col bg-[var(--theme-bg)] text-[var(--theme-text)]"
      role="dialog"
      aria-modal="true"
      aria-label="FFmpeg Video Editor"
    >
      <header className="sgf-portal-header flex items-center gap-2 px-4 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] shrink-0 shadow-sm z-10">
        <Icon name="ffmpeg" size="xs" className="text-[var(--theme-primary)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--theme-text)] flex-1 truncate">
          FFmpeg Video Editor
        </span>
        <span className="text-[9px] text-[var(--theme-text-muted)] hidden sm:block select-none">
          Esc to close
        </span>
        <button
          onClick={handleClose}
          title="Close video editor (Esc)"
          className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors shrink-0"
        >
          <Icon name="close" size="xs" />
        </button>
      </header>

      <VideoEditorPage onBack={onClose} workingDir={workingDir} className="flex-1 min-h-0" />
    </div>,
    window.document.body,
  );
}
