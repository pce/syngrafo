import type { EasingType } from '@syngrafo/shared';

export type OperatorKind = 'fadeIn' | 'fadeOut' | 'transition' | 'freeze' | 'speedRamp';

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

export type VideoOperator = FadeInOp | FadeOutOp | TransitionOp | SpeedRampOp;
