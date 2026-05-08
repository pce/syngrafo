import type { FrameRange } from '@syngrafo/shared';

export type ClipKind = 'video' | 'image' | 'color';

export interface VideoClip {
  id: string;
  trackId: string;
  kind: ClipKind;
  label: string;
  /** Absolute path on disk — backend resolves this */
  sourcePath: string;
  range: FrameRange;         // on the master timeline
  sourceOffset: number;      // first frame to use from sourcePath (0 = beginning)
  speed: number;             // 1.0 = normal, 0.5 = half, 2.0 = double
  opacity: number;           // 0–1
  thumbnail?: string;        // base64 data URL, loaded lazily via IPC
}

export interface VideoTrack {
  id: string;
  label: string;
  muted: boolean;
  solo: boolean;
  clips: VideoClip[];
  /** z-index in the compositor (0 = bottom) */
  zIndex: number;
}

export interface VideoProject {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  durationFrames: number;
  tracks: VideoTrack[];
  playheadFrame: number;
}
