import type { VideoClip } from '../types/video.ts';
import type { VideoOperator, FadeInOp, FadeOutOp } from '../types/effect.ts';
import type { TimelineEvent } from './timeline-events.ts';

type Adapter<T extends VideoOperator> = (op: T, event: TimelineEvent, clip: VideoClip) => T;

/**
 * Apply the adapter for one operator, if registered.
 * Returns the operator unchanged when no adapter exists.
 */
export function applyOperatorAdapter(
  op:    VideoOperator,
  event: TimelineEvent,
  clip:  VideoClip,
): VideoOperator {
  const adapter = OPERATOR_ADAPTERS[op.kind] as Adapter<typeof op> | undefined;
  return adapter ? adapter(op, event, clip) : op;
}

/**
 * Recompute all operators on a clip after a structural timeline event.
 * Safe to call on every mutation — adapters are idempotent.
 */
export function adaptOperators(
  clip:  VideoClip,
  event: TimelineEvent,
): VideoClip {
  const adapted = clip.operators.map(op => applyOperatorAdapter(op, event, clip));
  return adapted === clip.operators ? clip : { ...clip, operators: adapted };
}

// ─── Adapter registry ─────────────────────────────────────────────────────────

const OPERATOR_ADAPTERS: Partial<{
  [K in VideoOperator['kind']]: Adapter<Extract<VideoOperator, { kind: K }>>;
}> = {

  fadeIn(op: FadeInOp, event): FadeInOp {
    if (event.kind !== 'clip:resized') return op;
    const clipLen = event.to.endFrame - event.to.startFrame + 1;
    return {
      ...op,
      durationFrames: Math.min(op.durationFrames, Math.max(1, Math.floor(clipLen * 0.3))),
    };
  },

  fadeOut(op: FadeOutOp, event): FadeOutOp {
    if (event.kind !== 'clip:resized') return op;
    const clipLen  = event.to.endFrame - event.to.startFrame + 1;
    const duration = Math.min(op.durationFrames, Math.max(1, Math.floor(clipLen * 0.3)));
    // Re-anchor to clip end: startFrame is clip-relative.
    return { ...op, durationFrames: duration, startFrame: clipLen - duration };
  },
};
