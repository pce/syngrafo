/**
 * CsdEditor
 *
 * Live CSD authoring and debug panel.
 *
 * Features:
 *  - Textarea for CSD orchestra text (no header needed — makeCsd wraps it)
 *  - Template selector: Pluck, FM, Grain, Sampler presets
 *  - Validate → audioService.validateCsd() (calls C++ audio_validate_csd)
 *  - Compile+Run → engine.compileOrc() starts a live performance
 *  - Score input → engine.readScore() injects events into running session
 *  - Stop → engine.stop()
 *  - Export WAV → audioService.exportWav() with a native save-path picker
 *  - Console: live Csound log tail (last 80 lines)
 *  - Engine state badge
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useCsound, audioService, PLUCK_INSTR, FM_INSTR, GRAIN_INSTR, SAMPLER_INSTR, makeCsd } from '@syngrafo/audio';
import { fileService } from '@syngrafo/shared';

// ── Presets ───────────────────────────────────────────────────────────────────

const TEMPLATES: Array<{ label: string; orc: string }> = [
  { label: 'Pluck',   orc: PLUCK_INSTR   },
  { label: 'FM',      orc: FM_INSTR       },
  { label: 'Grain',   orc: GRAIN_INSTR    },
  { label: 'Sampler', orc: SAMPLER_INSTR  },
];

const DEFAULT_ORC = PLUCK_INSTR;
const DEFAULT_SCORE = 'i "PluckInstr" 0 2\ne';

// ── Component ─────────────────────────────────────────────────────────────────

export interface CsdEditorProps {
  className?: string;
}

export const CsdEditor: React.FC<CsdEditorProps> = ({ className }) => {
  const [orcText,    setOrcText]    = useState(DEFAULT_ORC);
  const [scoreText,  setScoreText]  = useState(DEFAULT_SCORE);
  const [errors,     setErrors]     = useState<string[]>([]);
  const [validating, setValidating] = useState(false);
  const [exporting,  setExporting]  = useState(false);
  const [logOpen,    setLogOpen]    = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const engine = useCsound();

  // Auto-scroll log tail
  useEffect(() => {
    if (logOpen && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [engine.log, logOpen]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleValidate = useCallback(async () => {
    setValidating(true);
    setErrors([]);
    const csd = makeCsd(orcText, scoreText);
    const res = await audioService.validateCsd(csd);
    if (res.ok && res.data) {
      setErrors(res.data.valid ? [] : res.data.errors);
    } else {
      setErrors([res.error ?? 'Validation failed']);
    }
    setValidating(false);
  }, [orcText, scoreText]);

  const handleRun = useCallback(async () => {
    if (!engine.isReady) return;
    setErrors([]);
    try {
      await engine.compileOrc(orcText);
    } catch (err) {
      setErrors([String(err)]);
    }
  }, [engine, orcText]);

  const handleScore = useCallback(async () => {
    if (!engine.isReady || !scoreText.trim()) return;
    try {
      await engine.readScore(scoreText);
    } catch (err) {
      setErrors([String(err)]);
    }
  }, [engine, scoreText]);

  const handleStop = useCallback(async () => {
    try {
      await engine.stop();
    } catch { /* already stopped */ }
  }, [engine]);

  const handleExportWav = useCallback(async () => {
    const saveRes = await fileService.selectSavePath('output.wav', 'wav');
    if (!saveRes.ok || !saveRes.data) return;
    const outputPath = saveRes.data.path ?? (saveRes.data as unknown as string);
    if (!outputPath) return;
    setExporting(true);
    const csd = makeCsd(orcText, scoreText);
    const res = await audioService.exportWav(csd, outputPath);
    if (res.ok && res.data) {
      setErrors([`✓ Exported: ${res.data.outputPath} (${res.data.durationSec.toFixed(2)}s)`]);
    } else {
      setErrors([`Export failed: ${res.error ?? 'unknown error'}`]);
    }
    setExporting(false);
  }, [orcText, scoreText]);

  const loadTemplate = useCallback((orc: string) => {
    setOrcText(orc);
    setErrors([]);
  }, []);

  // ── State badge ──────────────────────────────────────────────────────────────

  const stateBadge = {
    idle:    { cls: 'bg-[var(--theme-bg)] text-[var(--theme-text-muted)]',   label: 'idle'    },
    loading: { cls: 'bg-yellow-500/20 text-yellow-400',                       label: 'loading' },
    ready:   { cls: 'bg-emerald-500/20 text-emerald-400',                     label: 'ready'   },
    playing: { cls: 'bg-[var(--theme-primary)]/20 text-[var(--theme-primary)]', label: '● live' },
    error:   { cls: 'bg-red-500/20 text-red-400',                             label: 'error'   },
  }[engine.state] ?? { cls: '', label: engine.state };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-full bg-[var(--theme-bg)] text-[var(--theme-text)] overflow-hidden ${className ?? ''}`}>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] shrink-0 flex-wrap gap-y-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] shrink-0">
          CSD
        </span>

        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${stateBadge.cls}`}>
          {stateBadge.label}
        </span>

        <div className="flex-1" />

        {/* Templates */}
        {TEMPLATES.map(t => (
          <button
            key={t.label}
            onClick={() => loadTemplate(t.orc)}
            className="text-[10px] px-2 py-0.5 rounded bg-[var(--theme-bg)] border border-[var(--theme-border)]
                       text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Orchestra editor */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="px-2 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-[var(--theme-text-muted)] shrink-0">
          Orchestra
        </div>
        <textarea
          value={orcText}
          onChange={e => { setOrcText(e.target.value); setErrors([]); }}
          spellCheck={false}
          className="flex-1 min-h-0 mx-2 p-2 font-mono text-[11px] leading-relaxed
                     bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded
                     text-[var(--theme-text)] resize-none focus:outline-none
                     focus:border-[var(--theme-primary)]"
          placeholder="instr MyInstr&#10;  ...&#10;endin"
        />
      </div>

      {/* Score */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <div className="text-[9px] font-semibold uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          Score
        </div>
        <textarea
          value={scoreText}
          onChange={e => setScoreText(e.target.value)}
          rows={3}
          spellCheck={false}
          className="w-full p-2 font-mono text-[11px] leading-relaxed
                     bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded
                     text-[var(--theme-text)] resize-none focus:outline-none
                     focus:border-[var(--theme-primary)]"
          placeholder={'i "MyInstr" 0 2\ne'}
        />
      </div>

      {/* Error / info strip */}
      {errors.length > 0 && (
        <div className="mx-2 mb-2 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30 shrink-0">
          {errors.map((e, i) => (
            <p key={i} className={`text-[10px] font-mono leading-snug ${
              e.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'
            }`}>{e}</p>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 px-2 pb-2 shrink-0 flex-wrap gap-y-1.5">
        <button
          onClick={handleValidate}
          disabled={validating}
          className="text-xs px-2.5 py-1 rounded border border-[var(--theme-border)]
                     bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]
                     text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]
                     disabled:opacity-50 transition-colors"
        >
          {validating ? 'Checking…' : 'Validate'}
        </button>

        <button
          onClick={handleRun}
          disabled={!engine.isReady || engine.isPlaying}
          className="text-xs px-2.5 py-1 rounded bg-[var(--theme-primary)] hover:opacity-90
                     text-[var(--theme-primary-fg)] disabled:opacity-40 font-medium"
        >
          ▶ Compile+Run
        </button>

        {engine.isPlaying && (
          <button
            onClick={handleStop}
            className="text-xs px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30
                       text-red-400 font-medium"
          >
            ⏹ Stop
          </button>
        )}

        {engine.isPlaying && (
          <button
            onClick={handleScore}
            disabled={!scoreText.trim()}
            className="text-xs px-2.5 py-1 rounded bg-[var(--theme-primary)]/20
                       hover:bg-[var(--theme-primary)]/30 text-[var(--theme-primary)]
                       disabled:opacity-40"
          >
            ↳ Score
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={handleExportWav}
          disabled={exporting}
          className="text-xs px-2.5 py-1 rounded border border-[var(--theme-border)]
                     bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]
                     text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]
                     disabled:opacity-50 transition-colors"
          title="Export as WAV (requires SGF_WITH_AUDIO=ON)"
        >
          {exporting ? 'Exporting…' : '↓ WAV'}
        </button>
      </div>

      {/* Csound log console */}
      <div className="border-t border-[var(--theme-border)] shrink-0">
        <button
          onClick={() => setLogOpen(v => !v)}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[9px] font-semibold
                     uppercase tracking-widest text-[var(--theme-text-muted)]
                     hover:text-[var(--theme-text)] hover:bg-[var(--theme-surface)] transition-colors"
        >
          <span>{logOpen ? '▾' : '▸'}</span>
          <span>Console</span>
          {engine.log.length > 0 && (
            <span className="ml-auto text-[9px] opacity-50">{engine.log.length}</span>
          )}
        </button>

        {logOpen && (
          <div
            ref={logRef}
            className="h-24 overflow-y-auto px-3 py-1 font-mono text-[10px] leading-relaxed
                       text-[var(--theme-text-muted)] bg-[var(--theme-surface)]"
          >
            {engine.log.length === 0 ? (
              <span className="opacity-40 italic">No output yet.</span>
            ) : (
              engine.log.slice(-80).map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">{line}</div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
