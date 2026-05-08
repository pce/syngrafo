/**
 * video.ts
 * Core domain types for the @syngrafo/video package.
 *
 * Frames (integers) are the primary timeline unit throughout. Seconds are a
 * derived representation and should be computed via the shared time utilities
 * (framesToSeconds / secondsToFrames) only when needed for display or export.
 */

import type { EasingType, FrameRange, TimelineClip, TrackLane } from '@syngrafo/shared';
import { uid } from '@syngrafo/shared';

export type VideoClipKind = 'image' | 'video' | 'audio' | 'solid_color';

export interface VideoResolution {
  width: number;
  height: number;
}

export interface VideoSource {
  kind: VideoClipKind;
  /** Absolute or relative filesystem path (used by the native backend). */
  path?: string;
  /** Remote or object URL. */
  url?: string;
  /** Raw Blob (e.g. from a file picker or recorded media). */
  blob?: Blob;
  /** CSS/hex color string (e.g. '#1a2b3c') — only used when kind === 'solid_color'. */
  color?: string;
}

export type ShaderNodeType =
  | 'blur'
  | 'brightness_contrast'
  | 'rotate'
  | 'opacity'
  | 'chroma_key'
  | 'custom_glsl';

/**
 * Discriminated union of shader node variants.
 * Each variant carries only the parameters relevant to that operation.
 */
export type ShaderNode =
  | { type: 'blur'; radius: number }
  | { type: 'brightness_contrast'; brightness: number; contrast: number; saturation: number }
  | { type: 'rotate'; angleDeg: number }
  | { type: 'opacity'; value: number }
  | { type: 'chroma_key'; colorHex: string; threshold: number; softness: number }
  | { type: 'custom_glsl'; fragmentSrc: string };

/**
 * Ordered shader pipeline applied to a clip.
 * Index 0 receives the raw decoded frame; the last node produces the final output.
 */
export type ShaderChain = ShaderNode[];

export interface VideoKeyframe {
  id: string;
  property: 'opacity' | 'scale' | 'rotation' | 'posX' | 'posY' | 'volume';
  /** Absolute frame number on the project timeline. */
  frame: number;
  value: number;
  easing: EasingType;
}

/**
 * A time-bounded shader effect attached to a clip.
 * startFrame / endFrame are clip-relative (0 = first frame of the clip).
 */
export interface VideoEffect {
  id: string;
  kind: ShaderNodeType;
  label: string;
  /** Clip-relative start frame (inclusive). */
  startFrame: number;
  /** Clip-relative end frame (inclusive). -1 means "until end of clip". */
  endFrame: number;
  enabled: boolean;
  node: ShaderNode;
}

/**
 * VideoClip extends the shared TimelineClip interface so it can be placed on a
 * TrackLane and referenced by shared event types. The `range` field (FrameRange)
 * uses absolute timeline frames.
 */
export interface VideoClip extends TimelineClip {
  kind: VideoClipKind;
  source: VideoSource;
  /** z-ordering relative to other clips: 0 = bottom of the compositing stack. */
  layer: number;
  /** Clip-level compositing opacity in [0, 1]. */
  opacity: number;
  /** Audio gain in [0, 1]. Relevant for 'audio' and 'video' clips. */
  volume: number;
  /** Uniform scale factor — 1.0 = original pixel size. */
  scale: number;
  /** Horizontal pixel offset from the canvas center. */
  posX: number;
  /** Vertical pixel offset from the canvas center. */
  posY: number;
  /** Clockwise rotation in degrees. */
  rotation: number;
  shaderChain: ShaderChain;
  effects: VideoEffect[];
  keyframes: VideoKeyframe[];
}

/**
 * VideoTrackLane narrows the shared TrackLane so that `clips` is typed as
 * VideoClip[] and adds a `layer` field for z-ordering at the track level.
 * Since VideoClip extends TimelineClip the structural constraint is satisfied.
 */
export interface VideoTrackLane extends Omit<TrackLane, 'clips'> {
  /** z-ordering for the entire track: 0 = bottom. */
  layer: number;
  clips: VideoClip[];
}

export interface VideoProjectSettings {
  /** CSS/hex canvas background colour, e.g. '#000000'. */
  backgroundColor: string;
  /** Frame duration assigned to newly imported still images. */
  defaultImageDurationFrames: number;
}

/**
 * Top-level project document stored in IndexedDB.
 * `id` is 0 until the record is persisted (IndexedDB autoIncrement fills it in).
 */
export interface VideoProject {
  /** IndexedDB auto-increment primary key. 0 = not yet saved. */
  id: number;
  name: string;
  fps: number;
  resolution: VideoResolution;
  durationFrames: number;
  settings: VideoProjectSettings;
  tracks: VideoTrackLane[];
  /** Unix epoch milliseconds. */
  createdAt: number;
  /** Unix epoch milliseconds. */
  updatedAt: number;
}

/**
 * Creates a VideoProject with sensible defaults and one empty video track.
 * The returned object has `id: 0` — call videoStorage.createProject() to
 * persist it and receive the real numeric id back.
 *
 * @param name  Human-readable project name.
 * @param fps   Frames per second (default 30).
 */
export function defaultProject(name: string, fps = 30): VideoProject {
  const now = Date.now();
  const defaultTrack: VideoTrackLane = {
    id: uid(),
    kind: 'video',
    label: 'Video 1',
    muted: false,
    solo: false,
    layer: 0,
    clips: [],
  };

  return {
    id: 0,
    name,
    fps,
    resolution: { width: 1920, height: 1080 },
    /** 10 s default duration */
    durationFrames: fps * 10,
    settings: {
      backgroundColor: '#000000',
      /** 5 s default image duration */
      defaultImageDurationFrames: fps * 5,
    },
    tracks: [defaultTrack],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Creates a VideoClip positioned at `startFrame` for `durationFrames` frames.
 * The `range.endFrame` is inclusive: endFrame = startFrame + durationFrames - 1.
 *
 * @param source         Describes the media source for the clip.
 * @param startFrame     Absolute timeline frame where the clip begins.
 * @param durationFrames Length of the clip in frames.
 * @param layer          z-order within the track (0 = bottom).
 * @param trackId        ID of the parent VideoTrackLane.
 * @param label          Human-readable name shown in the timeline.
 */
export function clipFromSource(
  source: VideoSource,
  startFrame: number,
  durationFrames: number,
  layer: number,
  trackId: string,
  label: string,
): VideoClip {
  const range: FrameRange = {
    startFrame,
    endFrame: startFrame + durationFrames - 1,
  };

  return {
    id: uid(),
    trackId,
    label,
    range,
    kind: source.kind,
    source,
    layer,
    opacity: 1,
    volume: 1,
    scale: 1,
    posX: 0,
    posY: 0,
    rotation: 0,
    shaderChain: [],
    effects: [],
    keyframes: [],
  };
}
