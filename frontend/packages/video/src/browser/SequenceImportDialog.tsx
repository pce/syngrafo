/**
 * SequenceImportDialog
 *
 * Modal that:
 *  1. Scans `folderPath` on mount via `video_list_directory` (the one
 *     registered binding that actually works for media listings).
 *  2. Natural-sorts the results so file001.jpg < file002.jpg < file010.jpg.
 *  3. Lets the user choose a duration per clip in seconds.
 *  4. Calls `onConfirm(files, secPerClip)` when the user clicks Import.
 *
 * Callers are responsible for creating the actual timeline clips from the
 * returned file list (see VideoEditorPage.handleSeqConfirm).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '@syngrafo/ui';
import { videoService } from '../ipc/video-service.ts';

// ── Supported extensions ────────────────────────────────────────────────────
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif'];
const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v'];
const ALL_MEDIA_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Natural sort (handles numeric segments: file001 < file002 < file010). */
function naturalSort(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const nameA = basename(a);
    const nameB = basename(b);
    return nameA.localeCompare(nameB, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function extOf(path: string): string {
  return (path.split('.').pop() ?? '').toLowerCase();
}

function isVideoExt(e: string): boolean {
  return VIDEO_EXTS.includes(e);
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SequenceImportDialogProps {
  /** Absolute path of the folder to scan. */
  folderPath: string;
  /** Project FPS — used only for the frame-count preview label. */
  fps: number;
  /**
   * Called when the user confirms.
   * @param files      Absolute paths in natural sort order.
   * @param secPerClip Duration to assign to each clip, in seconds.
   */
  onConfirm: (files: string[], secPerClip: number) => void;
  onCancel: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export const SequenceImportDialog: React.FC<SequenceImportDialogProps> = ({
  folderPath,
  fps,
  onConfirm,
  onCancel,
}) => {
  const [files,      setFiles]      = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [secPerClip, setSecPerClip] = useState(1.0);
  const [listOpen,   setListOpen]   = useState(false);

  // ── Scan on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    videoService
      .listDirectory(folderPath, ALL_MEDIA_EXTS)
      .then(res => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setFiles(naturalSort(res.data.files));
        } else {
          setError(res.error ?? 'Failed to scan directory');
        }
      })
      .catch(err => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [folderPath]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const framesEach   = Math.round(secPerClip * fps);
  const totalSec     = (files.length * secPerClip).toFixed(1);
  const totalFrames  = Math.round(files.length * secPerClip * fps);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSecChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setSecPerClip(Number.isFinite(v) && v >= 0.1 ? v : 0.1);
  }, []);

  const handleConfirm = useCallback(() => {
    if (files.length === 0) return;
    onConfirm(files, secPerClip);
  }, [files, secPerClip, onConfirm]);

  // ── Backdrop close ─────────────────────────────────────────────────────────
  const handleBackdrop = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 bg-[var(--theme-bg)]/70 flex items-center justify-center z-50"
      onClick={handleBackdrop}
    >
      <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-lg
                      w-[480px] max-w-[95vw] shadow-2xl flex flex-col max-h-[80vh]">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--theme-border)] shrink-0">
          <Icon name="folder-open" size={16} className="text-[var(--theme-primary)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--theme-text)] flex-1">
            Import Image Sequence
          </h2>
          <button
            onClick={onCancel}
            className="flex items-center justify-center w-6 h-6 rounded
                       text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]
                       hover:bg-[var(--theme-bg)]"
            aria-label="Close"
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">

          {/* Folder */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider
                               text-[var(--theme-text-muted)] mb-1">
              Folder
            </label>
            <div className="text-xs text-[var(--theme-text)] bg-[var(--theme-bg)] rounded
                            px-3 py-2 font-mono truncate border border-[var(--theme-border)]"
                 title={folderPath}>
              {folderPath}
            </div>
          </div>

          {/* Status */}
          {loading && (
            <p className="text-xs text-[var(--theme-text-muted)] animate-pulse">Scanning directory…</p>
          )}
          {error && (
            <p className="text-xs text-[var(--theme-danger)]">⚠ {error}</p>
          )}
          {!loading && !error && (
            <p className="text-xs text-[var(--theme-text-muted)]">
              Found{' '}
              <strong className="text-[var(--theme-text)]">{files.length}</strong>{' '}
              media file{files.length !== 1 ? 's' : ''}.
            </p>
          )}

          {/* Duration per clip */}
          {!loading && !error && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider
                                 text-[var(--theme-text-muted)] mb-2">
                Duration per clip
              </label>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="number"
                  min={0.1}
                  max={60}
                  step={0.1}
                  value={secPerClip}
                  onChange={handleSecChange}
                  className="w-24 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded
                             px-2 py-1.5 text-sm text-[var(--theme-text)]
                             focus:outline-none focus:border-[var(--theme-primary)]"
                />
                <span className="text-xs text-[var(--theme-text-muted)]">seconds</span>
                {files.length > 0 && (
                  <span className="text-[10px] text-[var(--theme-text-muted)] ml-auto tabular-nums">
                    {framesEach} fr/clip · {totalSec}s · {totalFrames} frames total
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Collapsible file list */}
          {!loading && files.length > 0 && (
            <div>
              <button
                onClick={() => setListOpen(v => !v)}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider
                           text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] mb-1"
              >
                <Icon name={listOpen ? 'chevron-down' : 'chevron-right'} size={11} />
                {listOpen ? 'Hide' : 'Show'} files
              </button>

              {listOpen && (
                <div className="bg-[var(--theme-bg)] rounded border border-[var(--theme-border)]
                                max-h-52 overflow-y-auto">
                  {files.map((f, i) => {
                    const e = extOf(f);
                    return (
                      <div
                        key={f}
                        className="flex items-center gap-2 px-3 py-1
                                   border-b border-[var(--theme-border)] last:border-0"
                      >
                        <span className="text-[10px] text-[var(--theme-text-muted)] w-8 shrink-0 tabular-nums text-right">
                          {i + 1}
                        </span>
                        <Icon
                          name={isVideoExt(e) ? 'video' : 'image'}
                          size={11}
                          className={isVideoExt(e) ? 'text-violet-400/70' : 'text-indigo-400/70'}
                        />
                        <span className="text-xs text-[var(--theme-text)] truncate font-mono">
                          {basename(f)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--theme-border)] shrink-0">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]
                       text-sm text-[var(--theme-text-muted)]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || files.length === 0}
            className="px-4 py-1.5 rounded bg-[var(--theme-primary)] hover:opacity-90
                       text-sm text-[var(--theme-primary-fg)] disabled:opacity-50 font-medium"
          >
            {loading ? 'Scanning…' : `Import ${files.length > 0 ? `${files.length} clips` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};
