/**
 * ConfirmDialog.tsx — Atomic reusable confirmation modal.
 *
 * Same visual style as the DeleteDialog in FileOpDialogs.tsx.
 * Deliberately has zero dependencies on DMS state — just callbacks.
 */

import React, { useEffect } from "react";
import { Icon } from "../Icon";

interface ConfirmDialogProps {
  title:     string;
  message:   React.ReactNode;
  /** Label for the destructive button (default: "Delete"). */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel:  () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}) => {
  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--theme-border)]">
          <h2 className="flex-1 text-sm font-black text-[var(--theme-text)]">{title}</h2>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] transition-colors"
          >
            <Icon name="close" size="xs" />
          </button>
        </div>
        {/* Body */}
        <div className="px-4 py-4 text-xs text-[var(--theme-text-muted)] leading-relaxed">
          {message}
        </div>
        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--theme-border)]">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--theme-border)]
                       bg-[var(--theme-bg)] hover:bg-[var(--theme-surface)]
                       text-[var(--theme-text)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs font-bold rounded-lg
                       bg-[var(--theme-danger)] hover:opacity-90
                       text-white transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

