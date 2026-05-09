/**
 * OfflineRenderDialog
 *
 * Modal dialog for offline audio rendering.
 *
 * Render path: IPC → audioService.exportWav()
 *   • Native Csound, fast, writes directly to disk.
 *   • A sidecar .loop.json file is written alongside the WAV with loop
 *     start/end info (best-effort, requires dms_write_file IPC binding).
 *
 * Options shown to user:
 *   - Output path (native save dialog)
 *   - Tail duration (default 1.0 s)
 *   - Source: "Current tracks" vs "Pattern Arranger" (if sections > 0)
 *   - BPM (editable, defaults to 120)
 *   - Sample rate: 44100 / 48000 / 96000
 */

import React, { useState, useCallback } from 'react';
import { fileService, ipcCall, generateName } from '@syngrafo/shared';
import { audioService }            from '@syngrafo/audio';
import { makeOfflineCsd }          from '@syngrafo/audio';
import { SEQ_ALL_INSTRS }          from '@syngrafo/audio';
import { arrangementToScore }      from '@syngrafo/audio';
import type { AudioTrack }         from '@/types/audio';
import type { Arrangement }        from '@/types/arrangement';

interface OfflineRenderDialogProps {
  tracks:      AudioTrack[];
  bpm:         number;
  arrangement: Arrangement | null;
  onClose:     () => void;
}

type RenderState = 'idle' | 'rendering' | 'done' | 'error';

export const OfflineRenderDialog: React.FC<OfflineRenderDialogProps> = ({
  tracks, bpm: initialBpm, arrangement, onClose,
}) => {
  const [outputPath,  setOutputPath]  = useState('');
  const [tailSecs,    setTailSecs]    = useState(1.0);
  const [bpm,         setBpm]         = useState(initialBpm);
  const [sr,          setSr]          = useState(48000);
  const [useArranger, setUseArranger] = useState(
    (arrangement?.sections.length ?? 0) > 0,
  );
  const [renderState, setRenderState] = useState<RenderState>('idle');
  const [progress,    setProgress]    = useState('');
  const [error,       setError]       = useState('');

  // Pre-compute render plan for the duration estimate display
  const plan = React.useMemo(() => {
    try {
      return arrangementToScore(
        tracks,
        useArranger ? arrangement : null,
        bpm, tailSecs, sr,
      );
    } catch { return null; }
  }, [tracks, arrangement, useArranger, bpm, tailSecs, sr]);

  const handleBrowseOutput = useCallback(async () => {
    const res = await fileService.selectSavePath(`${generateName()}.wav`, 'wav');
    if (res.ok && res.data?.path) setOutputPath(res.data.path);
  }, []);

  const handleRender = useCallback(async () => {
    if (!outputPath) { setError('Choose an output path first.'); return; }
    if (!plan)       { setError('Could not build score — check track data.'); return; }

    setRenderState('rendering');
    setError('');
    setProgress('Building CSD…');

    const csd = makeOfflineCsd(SEQ_ALL_INSTRS, plan.score, outputPath, sr);

    try {
      setProgress('Rendering via native Csound…');
      const res = await audioService.exportWav(csd, outputPath);

      if (!res.ok) throw new Error(res.error ?? 'Export failed');

      // Best-effort: write a sidecar .loop.json with loop markers so the
      // user can set cue points in a DAW. Requires dms_write_file IPC binding.
      // TODO: replace with fileService.writeFile once that IPC is registered.
      try {
        const sidecarPath = outputPath.replace(/\.wav$/i, '.loop.json');
        const loopInfo = JSON.stringify({
          loopStart: plan.loopStart,
          loopEnd:   plan.loopEnd,
          sr,
          bpm,
          totalSecs: plan.totalSecs,
          note: 'Loop start/end in seconds. Import into your DAW or sampler to set loop cue points.',
        }, null, 2);
        await ipcCall('dms_write_file', sidecarPath, loopInfo);
      } catch { /* best-effort — not fatal */ }

      const durSec = res.data?.durationSec ?? plan.totalSecs;
      setProgress(
        `Done — ${durSec.toFixed(2)} s  ` +
        `(loop ${plan.loopStart.toFixed(2)}–${plan.loopEnd.toFixed(2)} s)`,
      );
      setRenderState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRenderState('error');
    }
  }, [outputPath, plan, sr, bpm]);

  const durationStr = plan
    ? `~${plan.totalSecs.toFixed(2)} s  ·  loop ${plan.loopStart.toFixed(2)}–${plan.loopEnd.toFixed(2)} s  ·  ${tailSecs} s tail`
    : '—';

  const hasArrangement = (arrangement?.sections.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl shadow-2xl w-[420px] max-w-[95vw] flex flex-col overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--theme-border)]">
          <span className="text-sm font-bold text-[var(--theme-text)] flex-1">⬇ Offline Render</span>
          <button
            onClick={onClose}
            className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-lg leading-none px-1"
            aria-label="Close"
          >×</button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 p-4">

          {/* Source selector (only shown when arranger has sections) */}
          {hasArrangement && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
                Source
              </label>
              <div className="flex gap-2">
                {(['current', 'arranger'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setUseArranger(mode === 'arranger')}
                    className={`flex-1 text-[10px] py-1.5 rounded border font-semibold transition-colors ${
                      (mode === 'arranger') === useArranger
                        ? 'bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]'
                        : 'border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                    }`}
                  >
                    {mode === 'current' ? 'Current tracks (1×)' : 'Pattern Arranger (full song)'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Output path */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
              Output WAV
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                value={outputPath}
                onChange={e => setOutputPath(e.target.value)}
                placeholder="/path/to/render.wav"
                className="flex-1 min-w-0 text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)]
                           rounded px-2 py-1.5 text-[var(--theme-text)] placeholder-[var(--theme-text-muted)]/50
                           focus:outline-none focus:border-[var(--theme-primary)]"
              />
              <button
                onClick={handleBrowseOutput}
                className="px-2 py-1 text-[10px] rounded border border-[var(--theme-border)]
                           text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                           hover:border-[var(--theme-primary)] transition-colors shrink-0"
                title="Save As…"
              >
                …
              </button>
            </div>
          </div>

          {/* BPM / Tail / Sample Rate row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">BPM</label>
              <input
                type="number" min={40} max={300} step={1} value={bpm}
                onChange={e => setBpm(Number(e.target.value))}
                className="text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)]
                           rounded px-2 py-1.5 text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-primary)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Tail (s)</label>
              <input
                type="number" min={0} max={10} step={0.5} value={tailSecs}
                onChange={e => setTailSecs(Number(e.target.value))}
                className="text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)]
                           rounded px-2 py-1.5 text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-primary)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Sample Rate</label>
              <select
                value={sr}
                onChange={e => setSr(Number(e.target.value))}
                className="text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)]
                           rounded px-2 py-1.5 text-[var(--theme-text)] focus:outline-none"
              >
                <option value={44100}>44 100 Hz</option>
                <option value={48000}>48 000 Hz</option>
                <option value={96000}>96 000 Hz</option>
              </select>
            </div>
          </div>

          {/* Duration estimate */}
          <div className="text-[10px] text-[var(--theme-text-muted)] bg-[var(--theme-bg)] rounded px-3 py-2 font-mono">
            {durationStr}
          </div>

          {/* Progress indicator */}
          {renderState === 'rendering' && (
            <div className="flex items-center gap-2 text-[10px] text-[var(--theme-primary)]">
              <div className="w-3 h-3 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full animate-spin shrink-0" />
              {progress}
            </div>
          )}
          {renderState === 'done' && (
            <div className="text-[10px] text-emerald-400 font-semibold">✓ {progress}</div>
          )}
          {(renderState === 'error' || error) && (
            <div className="text-[10px] text-red-400">{error}</div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <div className="flex gap-2 px-4 py-3 border-t border-[var(--theme-border)] justify-end">
          <button
            onClick={onClose}
            className="text-[10px] px-3 py-1.5 rounded border border-[var(--theme-border)]
                       text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleRender}
            disabled={renderState === 'rendering' || !outputPath}
            className="text-[10px] px-4 py-1.5 rounded bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]
                       font-bold disabled:opacity-40 transition-opacity"
          >
            {renderState === 'rendering' ? 'Rendering…' : '⬇ Render WAV'}
          </button>
        </div>
      </div>
    </div>
  );
};
