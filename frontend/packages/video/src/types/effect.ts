import type { EasingType, SpringConfig } from '@syngrafo/shared';

export interface FadeInOp {
  kind: 'fadeIn';
  id: string;
  clipId: string;
  startFrame: number;
  durationFrames: number;
  easing: EasingType;
}

export interface FadeOutOp {
  kind: 'fadeOut';
  id: string;
  clipId: string;
  startFrame: number;
  durationFrames: number;
  easing: EasingType;
}

export interface TransitionOp {
  kind: 'transition';
  id: string;
  fromClipId: string;
  toClipId: string;
  startFrame: number;
  durationFrames: number;
  type: 'dissolve' | 'wipe-left' | 'wipe-right' | 'push' | 'zoom';
  easing: EasingType;
}

export interface SpeedRampOp {
  kind: 'speedRamp';
  id: string;
  clipId: string;
  startFrame: number;
  endFrame: number;
  fromSpeed: number;
  toSpeed: number;
  easing: EasingType;
}

/**
 * Ken Burns pan + zoom over the clip's full duration.
 * Scale and offset are spring-interpolated from their `from` to `to` values.
 */
export interface KenBurnsOp {
  kind: 'kenburns';
  id: string;
  clipId: string;
  fromScale: number;
  toScale: number;
  /** Normalised UV pan offset; [0,0] = no pan. Positive = top-left shift. */
  fromOffset: [number, number];
  toOffset: [number, number];
  springConfig?: SpringConfig;
}

export type VideoOperator = FadeInOp | FadeOutOp | TransitionOp | SpeedRampOp | KenBurnsOp;
