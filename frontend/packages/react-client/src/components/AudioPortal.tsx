import React, { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import AudioTimelinePage from "./audio/AudioTimelinePage";
import { PatchWorkstation } from "./audio/modular/index";

export interface AudioPortalProps {
  open: boolean;
  onClose?: () => void;
  workingDir?: string;
}

export function AudioPortal({ open, onClose, workingDir }: AudioPortalProps) {
  if (!open) return null;
  return <AudioPortalContent onClose={onClose} workingDir={workingDir} />;
}

interface ContentProps {
  onClose?: () => void;
  workingDir?: string;
}

function AudioPortalContent({ onClose, workingDir }: ContentProps) {
  const handleClose = useCallback(() => onClose?.(), [onClose]);
  const [activeTab, setActiveTab] = useState<"sequencer" | "patcher">("sequencer");

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
      id="sgf-audio-root"
      className="fixed inset-0 z-[200] flex flex-col bg-[var(--theme-bg)] text-[var(--theme-text)]"
      role="dialog"
      aria-modal="true"
      aria-label="Csound Audio Editor"
    >
      <header className="sgf-portal-header flex items-center gap-2 px-4 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] shrink-0 shadow-sm z-10">
        <Icon name="csound" size="xs" className="text-[var(--theme-primary)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--theme-text)] flex-1 truncate">
          Csound Audio Editor
        </span>
        {/* Tab switcher */}
        <div className="flex rounded border border-[var(--theme-border)] overflow-hidden text-[9px] mx-2">
          {(["sequencer", "patcher"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={
                activeTab === tab
                  ? "px-3 py-1 bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] font-semibold uppercase tracking-wider"
                  : "px-3 py-1 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] uppercase tracking-wider"
              }
            >
              {tab === "sequencer" ? "\u23F1 Seq" : "\u2B21 Patch"}
            </button>
          ))}
        </div>

        <span className="text-[9px] text-[var(--theme-text-muted)] hidden sm:block select-none">
          Esc to close
        </span>
        <button
          onClick={handleClose}
          title="Close audio editor (Esc)"
          className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors shrink-0"
        >
          <Icon name="close" size="xs" />
        </button>
      </header>

      {activeTab === "sequencer"
        ? <AudioTimelinePage workingDir={workingDir} />
        : <PatchWorkstation />
      }
    </div>,
    window.document.body,
  );
}
