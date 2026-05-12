import type { FrameRange } from '@syngrafo/shared';
import type { VideoClip } from '../types/video.ts';

export type TimelineEvent =
  | { kind: 'clip:added';   clip:   VideoClip }
  | { kind: 'clip:removed'; clipId: string }
  | { kind: 'clip:moved';   clipId: string; from: FrameRange; to: FrameRange }
  | { kind: 'clip:resized'; clipId: string; from: FrameRange; to: FrameRange };

export type TimelineEventKind = TimelineEvent['kind'];

type Handler = (event: TimelineEvent) => void;

/**
 * Simple synchronous pub/sub bus for timeline mutations.
 * Operators and effects subscribe to receive structural change notifications
 * so they can self-adjust (e.g. fade durations stay proportional on resize).
 */
export class TimelineEventBus {
  private readonly handlers = new Set<Handler>();

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: TimelineEvent): void {
    this.handlers.forEach(h => h(event));
  }
}
