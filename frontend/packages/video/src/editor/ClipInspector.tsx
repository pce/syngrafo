/**
 * @file editor/ClipInspector.tsx
 * Sidebar panel that shows editable properties for a single {@link VideoClip}.
 *
 * Sections
 *  A  Basic clip properties: label, kind, opacity, scale, position, rotation.
 *     Includes "Clip tools" (Reverse) when the clip is a video with a source path.
 */

import React, { useCallback } from 'react';
import type { VideoClip, VideoProject } from '../types/video.ts';
import type { StretchMorphOp } from '../types/effect.ts';
import { PlasmaPreview } from '../browser/PlasmaPreview.tsx';
import { uid } from '@syngrafo/shared';

// ── Style constants ────────────────────────────────────────────────────────────

/** Section label above a group of controls. */
const labelClass =
  'block text-[10px] font-medium uppercase tracking-wide text-[var(--theme-text-muted)] mb-1';

/** Base style for action buttons in the inspector. */
const btnBase = 'text-xs px-2 py-1 rounded transition-colors';

/** Style for inactive (default) action buttons. */
const btnInactive =
  'bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] ' +
  'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ClipInspectorProps {
  /** The clip currently being inspected. */
  clip: VideoClip;
  /** The parent project (provides fps and resolution context). */
  project: VideoProject;
  /** Current playhead frame (for keyframe context). */
  currentFrame: number;
  /** Called whenever a clip property is changed. */
  onChange: (clip: VideoClip) => void;
  /** Called when the inspector should be closed. */
  onClose: () => void;
  /** Called when the user wants to reverse this video clip. */
  onReverse?: (clip: VideoClip) => void;
  /** Called when the user wants to pick a morph target asset for a StretchMorphOp. */
  onTargetSelect?: (op: StretchMorphOp, clip: VideoClip) => void;
}

// ── Shared input className ─────────────────────────────────────────────────────

const inputClass =
  'w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-2 py-1 ' +
  'text-xs text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-primary)]';

// ── Component ─────────────────────────────────────────────────────────────────

export const ClipInspector: React.FC<ClipInspectorProps> = ({
  clip,
  project,
  currentFrame,
  onChange,
  onClose,
  onReverse,
  onTargetSelect,
}) => {
  // Silence unused-variable warnings — currentFrame and project are intentionally
  // passed so callers can always provide them and future sections (keyframes,
  // effects) can reference them without a prop-interface change.
  void currentFrame;
  void project;

  /** Convenience: merge a partial update and call onChange. */
  const update = useCallback(
    (patch: Partial<VideoClip>) => onChange({ ...clip, ...patch }),
    [clip, onChange],
  );

  // ── Stretch-Morph helpers ───────────────────────────────────────────────────
  const morphOp = clip.operators.find(
    (op): op is StretchMorphOp => op.kind === 'stretch-morph',
  );

  const addMorphOp = () => {
    const newOp: StretchMorphOp = {
      kind:              'stretch-morph',
      id:                uid(),
      clipId:            clip.id,
      noiseScale:        3.0,
      noiseSpeed:        1.0,
      noiseAmp:          0.05,
      colorDistGate:     0.5,
      motionBlurSamples: 3,
      startFrame:        0,
      durationFrames:    clip.range.endFrame - clip.range.startFrame + 1,
    };
    update({ operators: [...clip.operators, newOp] });
  };

  const updateMorphOp = (partial: Partial<StretchMorphOp>) => {
    if (!morphOp) return;
    update({
      operators: clip.operators.map(op =>
        op.id === morphOp.id ? { ...morphOp, ...partial } : op,
      ),
    });
  };

  const removeMorphOp = () => {
    update({ operators: clip.operators.filter(op => op.kind !== 'stretch-morph') });
  };

  return (
    <div className="flex flex-col h-full bg-[var(--theme-surface)] text-[var(--theme-text)] text-xs overflow-y-auto">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--theme-border)] flex-shrink-0">
        <span className="text-xs font-semibold text-[var(--theme-text)] truncate" title={clip.label}>
          {clip.label}
        </span>
        <button
          onClick={onClose}
          className="ml-2 flex-shrink-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </div>

      {/* ── Section A — Basic properties ────────────────────────────────── */}
      <div className="flex flex-col gap-3 p-3">

        {/* Label */}
        <div>
          <label className={labelClass}>Label</label>
          <input
            value={clip.label}
            onChange={e => update({ label: e.target.value })}
            className={inputClass}
          />
        </div>

        {/* Kind (read-only) */}
        <div>
          <label className={labelClass}>Kind</label>
          <span className="capitalize text-[var(--theme-text-muted)]">{clip.kind}</span>
        </div>

        {/* Opacity */}
        <div>
          <label className={labelClass}>
            Opacity — {Math.round(clip.opacity * 100)}%
          </label>
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={clip.opacity}
            onChange={e => update({ opacity: parseFloat(e.target.value) })}
            className="w-full accent-[var(--theme-primary)]"
          />
        </div>

        {/* Scale */}
        <div>
          <label className={labelClass}>Scale</label>
          <input
            type="number"
            min={0.01} max={20} step={0.05}
            value={clip.scale}
            onChange={e => update({ scale: parseFloat(e.target.value) || 1 })}
            className={inputClass}
          />
        </div>

        {/* Position */}
        <div>
          <label className={labelClass}>Position (px)</label>
          <div className="flex gap-2">
            <input
              type="number" step={1}
              value={clip.posX}
              onChange={e => update({ posX: parseFloat(e.target.value) || 0 })}
              placeholder="X"
              className={`${inputClass} w-1/2`}
            />
            <input
              type="number" step={1}
              value={clip.posY}
              onChange={e => update({ posY: parseFloat(e.target.value) || 0 })}
              placeholder="Y"
              className={`${inputClass} w-1/2`}
            />
          </div>
        </div>

        {/* Rotation */}
        <div>
          <label className={labelClass}>Rotation (°)</label>
          <input
            type="number" step={1}
            value={clip.rotation}
            onChange={e => update({ rotation: parseFloat(e.target.value) || 0 })}
            className={inputClass}
          />
        </div>

        {/* Clip tools — Reverse (video with source path only) */}
        {(clip.kind === 'video') && clip.source.path && onReverse && (
          <div className="pt-2 border-t border-[var(--theme-border)]">
            <label className={labelClass}>Clip tools</label>
            <button
              onClick={() => onReverse(clip)}
              className={`${btnBase} ${btnInactive} flex items-center gap-1.5`}
              title="Reverse this clip segment and write to disk via FFmpeg"
            >
              ↺ Reverse clip
            </button>
          </div>
        )}

      </div>

      {/* ── Section D — Stretch Morph ────────────────────────────────────── */}
      <div className="space-y-2 p-3 border-t border-[var(--theme-border)]">
        <div className="flex items-center justify-between">
          <label className={labelClass}>Stretch Morph</label>
          {morphOp
            ? (
              <button
                onClick={removeMorphOp}
                className="text-[10px] text-[var(--theme-danger)] hover:opacity-80 px-1"
              >
                Remove
              </button>
            )
            : (
              <button
                onClick={addMorphOp}
                className={`${btnBase} ${btnInactive} text-[10px]`}
              >
                + Add Morph
              </button>
            )
          }
        </div>

        {morphOp && (
          <div className="space-y-3 p-2 bg-[var(--theme-bg)] rounded border border-[var(--theme-border)]">

            {/* Plasma noise preview */}
            <div className="flex items-start gap-3">
              <PlasmaPreview
                noiseScale={morphOp.noiseScale}
                noiseSpeed={morphOp.noiseSpeed}
                animate
                width={120}
                height={68}
              />
              <div className="flex-1 text-[10px] text-[var(--theme-text-muted)] leading-relaxed">
                <p>R = X flow · G = Y flow · B = density</p>
                <p className="mt-1 opacity-70">
                  Dark pixels stand still where src ≈ dst.
                </p>
              </div>
            </div>

            {/* Target image */}
            <div>
              <label className="block text-[10px] text-[var(--theme-text-muted)] mb-1">
                Morph target image
              </label>
              {morphOp.targetUrl ? (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--theme-text)] truncate flex-1 font-mono">
                    {morphOp.targetPath ?? morphOp.targetUrl}
                  </span>
                  <button
                    onClick={() => updateMorphOp({ targetUrl: undefined, targetPath: undefined })}
                    className="text-[10px] text-[var(--theme-danger)] shrink-0"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-[var(--theme-text-muted)] italic">
                  No target — clip self-dissolves via plasma.
                  {onTargetSelect && (
                    <button
                      onClick={() => onTargetSelect(morphOp, clip)}
                      className="ml-2 underline text-[var(--theme-primary)]"
                    >
                      Pick target…
                    </button>
                  )}
                </p>
              )}
            </div>

            {/* Morph window: start + duration */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-[var(--theme-text-muted)] mb-0.5">
                  Start (frames)
                </label>
                <input
                  type="number"
                  min={0}
                  max={clip.range.endFrame - clip.range.startFrame}
                  value={morphOp.startFrame}
                  onChange={e => updateMorphOp({ startFrame: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  className="w-full bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded px-2 py-1 text-xs text-[var(--theme-text)]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--theme-text-muted)] mb-0.5">
                  Duration (frames)
                </label>
                <input
                  type="number"
                  min={1}
                  value={morphOp.durationFrames}
                  onChange={e => updateMorphOp({ durationFrames: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className="w-full bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded px-2 py-1 text-xs text-[var(--theme-text)]"
                />
              </div>
            </div>

            {/* Noise params */}
            {(
              [
                ['Noise scale', 'noiseScale',        0.5, 12,  0.1  ] as const,
                ['Noise speed', 'noiseSpeed',        0.1,  5,  0.1  ] as const,
                ['Amplitude',   'noiseAmp',          0,    0.2, 0.005] as const,
                ['Color gate',  'colorDistGate',     0.1,  2,  0.05 ] as const,
                ['Motion blur', 'motionBlurSamples', 1,    7,  1    ] as const,
              ] as const
            ).map(([label, key, min, max, step]) => (
              <div key={key}>
                <div className="flex justify-between mb-0.5">
                  <label className="text-[10px] text-[var(--theme-text-muted)]">{label}</label>
                  <span className="text-[10px] text-[var(--theme-text-muted)] font-mono">
                    {morphOp[key].toFixed(step < 0.1 ? 3 : step < 1 ? 2 : 0)}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={morphOp[key]}
                  onChange={e => updateMorphOp({ [key]: parseFloat(e.target.value) })}
                  className="w-full accent-[var(--theme-primary)]"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
