import type { VideoKeyframe } from '../types/video.ts';
import type { EasingType } from '@syngrafo/shared';

/** Evaluate a single easing curve at normalised t ∈ [0, 1]. */
function applyEasing(t: number, easing: EasingType): number {
  switch (easing) {
    case 'linear':    return t;
    case 'easeIn':    return t * t;
    case 'easeOut':   return t * (2 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case 'spring': {
      // Critically-damped spring approximation (good enough for display)
      const c = 1 - Math.exp(-5 * t);
      return c + 0.2 * Math.sin(10 * t) * Math.exp(-6 * t);
    }
    default: return t;
  }
}

/**
 * Evaluate keyframes for a single property at the given absolute frame.
 * Returns `defaultValue` when no keyframes exist for the property.
 */
export function evaluateKeyframes(
  keyframes:    VideoKeyframe[],
  property:     VideoKeyframe['property'],
  frame:        number,
  defaultValue: number,
): number {
  const ks = keyframes
    .filter(k => k.property === property)
    .sort((a, b) => a.frame - b.frame);

  if (ks.length === 0) return defaultValue;

  const first = ks[0];
  const last  = ks[ks.length - 1];
  // These are always defined after the length check above, but TypeScript
  // requires explicit guards under noUncheckedIndexedAccess.
  if (!first || !last)        return defaultValue;
  if (frame <= first.frame)   return first.value;
  if (frame >= last.frame)    return last.value;

  const nextIdx = ks.findIndex(k => k.frame > frame);
  const prev    = ks[nextIdx - 1];
  const next    = ks[nextIdx];
  // nextIdx is always ≥ 1 here (frame is strictly between first and last),
  // so both lookups are valid — guards satisfy the strict compiler check.
  if (!prev || !next) return defaultValue;
  const t = (frame - prev.frame) / (next.frame - prev.frame);
  return prev.value + (next.value - prev.value) * applyEasing(t, next.easing);
}

/**
 * Evaluate all transform keyframes for a clip at `frame` and return a
 * flat record of the animated values, falling back to the clip's static
 * properties where no keyframe exists.
 */
export function evaluateClipTransform(
  clip: {
    keyframes: VideoKeyframe[];
    opacity:   number;
    scale:     number;
    posX:      number;
    posY:      number;
    rotation:  number;
  },
  frame: number,
) {
  return {
    opacity:  evaluateKeyframes(clip.keyframes, 'opacity',  frame, clip.opacity),
    scale:    evaluateKeyframes(clip.keyframes, 'scale',    frame, clip.scale),
    posX:     evaluateKeyframes(clip.keyframes, 'posX',     frame, clip.posX),
    posY:     evaluateKeyframes(clip.keyframes, 'posY',     frame, clip.posY),
    rotation: evaluateKeyframes(clip.keyframes, 'rotation', frame, clip.rotation),
  };
}
