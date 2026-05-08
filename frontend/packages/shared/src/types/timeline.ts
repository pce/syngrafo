export type TrackKind = 'video' | 'audio' | 'effect';

export interface FrameRange {
  startFrame: number;
  endFrame: number;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  label: string;
  range: FrameRange;
  /** Arbitrary per-clip metadata (shader chain, CSD text, etc.) */
  meta?: Record<string, unknown>;
}

export interface TrackLane {
  id: string;
  kind: TrackKind;
  label: string;
  muted: boolean;
  solo: boolean;
  clips: TimelineClip[];
}

export interface TimelineState {
  fps: number;            // frames per second (e.g. 25, 30, 60)
  durationFrames: number;
  playheadFrame: number;
  tracks: TrackLane[];
  selectedClipId: string | null;
}

/** A point on the timeline where an operator/event is anchored */
export interface FramePoint {
  frame: number;
  clipId: string;
  /** operator key matching one of the VideoEventMap or AudioEventMap keys */
  operatorKey: string;
}
