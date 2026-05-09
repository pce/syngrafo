/**
 * SequenceImportDialog (v2)
 *
 * Modal that:
 *  1. Scans `folderPath` on mount via `video_list_directory` (the one
 *     registered binding that actually works for media listings).
 *  2. Natural-sorts the results so file001.jpg < file002.jpg < file010.jpg.
 *  3. Lets the user configure mode (Photoshow / Daumenkino), transitions,
 *     Ken Burns, loop, and a look preset.
 *  4. Calls `onConfirm(files, config)` when the user clicks Import.
 *
 * Callers are responsible for creating the actual timeline clips from the
 * returned file list (see VideoEditorPage.handleSeqConfirm).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '@syngrafo/ui';
import { videoService } from '../ipc/video-service.ts';
import type { SequenceImportConfig, SeqTransition } from '../types/sequence.ts';
import { SEQ_IMPORT_DEFAULTS } from '../types/sequence.ts';
import { LOOK_PRESETS } from '../types/look.ts';

// ── Supported extensions ─────────────────────────────────────────────────────
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif'];
const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v'];
const ALL_MEDIA_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Transition options ────────────────────────────────────────────────────────

const TRANSITION_OPTIONS: Array<{ value: SeqTransition; label: string }> = [
  { value: 'none',        label: 'Hard cut' },
  { value: 'fade',        label: 'Fade'     },
  { value: 'slide-left',  label: '← Slide'  },
  { value: 'slide-right', label: '→ Slide'  },
  { value: 'slide-up',    label: '↑ Slide'  },
  { value: 'slide-down',  label: '↓ Slide'  },
  { value: 'random',      label: '✦ Random' },
];

// ── Props ────────────────────────────────────────────────────────────────────

export interface SequenceImportDialogProps {
  /** Absolute path of the folder to scan. */
  folderPath: string;
  /** Project FPS — used for derived frame/time labels. */
  fps: number;
  /** Called when the user confirms import. */
  onConfirm: (files: string[], config: SequenceImportConfig) => void;
  onCancel: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export const SequenceImportDialog: React.FC<SequenceImportDialogProps> = ({
  folderPath,
  fps,
  onConfirm,
  onCancel,
}) => {
  const [files,    setFiles]    = useState<string[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [config,   setConfig]   = useState<SequenceImportConfig>(SEQ_IMPORT_DEFAULTS);

  const updateConfig = useCallback((partial: Partial<SequenceImportConfig>) => {
    setConfig(prev => ({ ...prev, ...partial }));
  }, []);

  // ── Scan on mount ─────────────────────────────────────────────────────────
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const photoshowFrames   = Math.round(config.secPerClip * fps);
  const photoshowTotalSec = (files.length * config.secPerClip).toFixed(1);
  const daumekinoTotal    = files.length * config.framesPerImage;
  const daumekinoTotalSec = (daumekinoTotal / fps).toFixed(1);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    if (files.length === 0) return;
    onConfirm(files, config);
  }, [files, config, onConfirm]);

  const handleBackdrop = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  // ── Render ────────────────────────────────────────────────────────────────
  const isPhotoshow  = config.mode === 'photoshow';
  const isDaumenkino = config.mode === 'daumenkino';

  return (
    <div
      className="fixed inset-0 bg-[var(--theme-bg)]/70 flex items-center justify-center z-50"
      onClick={handleBackdrop}
    >
      <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-lg
                      w-[520px] max-w-[95vw] shadow-2xl flex flex-col max-h-[85vh]">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--theme-border)] shrink-0">
          <Icon name="folder-open" size={16} className="text-[var(--theme-primary)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--theme-text)] flex-1">
            Import Sequence
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

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">

          {/* Section 1: Folder + file count */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider
                               text-[var(--theme-text-muted)] mb-1">
              Folder
            </label>
            <div
              className="text-xs text-[var(--theme-text)] bg-[var(--theme-bg)] rounded
                         px-3 py-2 font-mono truncate border border-[var(--theme-border)]"
              title={folderPath}
            >
              {folderPath}
            </div>
            <div className="mt-2">
              {loading && (
                <p className="text-xs text-[var(--theme-text-muted)] animate-pulse">
                  Scanning directory…
                </p>
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
            </div>
          </div>

          {/* Section 2: Mode tabs */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider
                               text-[var(--theme-text-muted)] mb-2">
              Mode
            </label>

            {/* Pill group */}
            <div className="flex gap-1 p-0.5 bg-[var(--theme-bg)] rounded-full w-fit border border-[var(--theme-border)]">
              {(['photoshow', 'daumenkino'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => updateConfig({ mode: m })}
                  className={[
                    'px-4 py-1 rounded-full text-xs font-medium transition-colors',
                    config.mode === m
                      ? 'bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]'
                      : 'bg-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]',
                  ].join(' ')}
                >
                  {m === 'photoshow' ? 'Photoshow' : 'Daumenkino'}
                </button>
              ))}
            </div>

            {/* Mode-specific settings */}
            <div className="mt-3">
              {isPhotoshow && (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider
                                     text-[var(--theme-text-muted)]">
                    Duration per image
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0.5}
                      max={60}
                      step={0.5}
                      value={config.secPerClip}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v) && v >= 0.5) updateConfig({ secPerClip: v });
                      }}
                      className="w-20 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded
                                 px-2 py-1.5 text-sm text-[var(--theme-text)]
                                 focus:outline-none focus:border-[var(--theme-primary)]"
                    />
                    <span className="text-xs text-[var(--theme-text-muted)]">seconds</span>
                    {files.length > 0 && (
                      <span className="text-[10px] text-[var(--theme-text-muted)] ml-auto tabular-nums">
                        {photoshowFrames} frames · {photoshowTotalSec}s total
                      </span>
                    )}
                  </div>
                </div>
              )}

              {isDaumenkino && (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider
                                     text-[var(--theme-text-muted)]">
                    Frames per image
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      value={config.framesPerImage}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        if (Number.isFinite(v) && v >= 1) updateConfig({ framesPerImage: v });
                      }}
                      className="w-20 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded
                                 px-2 py-1.5 text-sm text-[var(--theme-text)]
                                 focus:outline-none focus:border-[var(--theme-primary)]"
                    />
                    <span className="text-xs text-[var(--theme-text-muted)]">frames</span>
                    {files.length > 0 && (
                      <span className="text-[10px] text-[var(--theme-text-muted)] ml-auto tabular-nums">
                        {daumekinoTotal} total frames · @{fps}fps = {daumekinoTotalSec}s total
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-amber-400/80">
                    Harsh cuts only — transitions disabled.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Transitions (Photoshow only) */}
          {isPhotoshow && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider
                                 text-[var(--theme-text-muted)] mb-2">
                Transition
              </label>

              <div className="grid grid-cols-3 gap-1.5">
                {TRANSITION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateConfig({ transition: opt.value })}
                    className={[
                      'px-2 py-1.5 rounded text-xs font-medium transition-colors text-center',
                      config.transition === opt.value
                        ? 'bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]'
                        : 'bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]',
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {config.transition !== 'none' && (
                <div className="mt-2.5 flex items-center gap-2">
                  <label className="text-[10px] text-[var(--theme-text-muted)] shrink-0">
                    Transition length
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={config.transitionFrames}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v >= 1) updateConfig({ transitionFrames: v });
                    }}
                    className="w-16 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded
                               px-2 py-1 text-sm text-[var(--theme-text)]
                               focus:outline-none focus:border-[var(--theme-primary)]"
                  />
                  <span className="text-[10px] text-[var(--theme-text-muted)]">frames</span>
                </div>
              )}
            </div>
          )}

          {/* Section 4: Options */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider
                               text-[var(--theme-text-muted)] mb-2">
              Options
            </label>
            <div className="flex items-center gap-5 flex-wrap">
              {isPhotoshow && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={config.kenBurns}
                    onChange={e => updateConfig({ kenBurns: e.target.checked })}
                    className="accent-[var(--theme-primary)] w-3.5 h-3.5 shrink-0"
                  />
                  <span className="text-xs text-[var(--theme-text)]">
                    Ken Burns
                  </span>
                  <span className="text-[10px] text-[var(--theme-text-muted)]">Subtle pan+zoom</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.loopable}
                  onChange={e => updateConfig({ loopable: e.target.checked })}
                  className="accent-[var(--theme-primary)] w-3.5 h-3.5 shrink-0"
                />
                <span className="text-xs text-[var(--theme-text)]">
                  Loopable
                </span>
                <span className="text-[10px] text-[var(--theme-text-muted)]">Seamless loop</span>
              </label>
            </div>
          </div>

          {/* Section 5: Look / Style */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider
                               text-[var(--theme-text-muted)] mb-2">
              Look
            </label>
            <div className="grid grid-cols-3 gap-2">
              {LOOK_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => updateConfig({ lookPresetId: preset.id })}
                  className={[
                    'flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg',
                    'bg-[var(--theme-bg)] border transition-all',
                    config.lookPresetId === preset.id
                      ? 'border-[var(--theme-primary)] ring-2 ring-[var(--theme-primary)]'
                      : 'border-[var(--theme-border)] hover:border-[var(--theme-primary)]/40',
                  ].join(' ')}
                  title={preset.description}
                >
                  <span className="text-2xl leading-none">{preset.badge}</span>
                  <span className="text-[10px] text-[var(--theme-text)] truncate w-full text-center">
                    {preset.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Section 6: Collapsible file list */}
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

        {/* ── Footer ───────────────────────────────────────────────────────── */}
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
            {loading ? 'Scanning…' : `Import ${files.length} clips`}
          </button>
        </div>
      </div>
    </div>
  );
};
