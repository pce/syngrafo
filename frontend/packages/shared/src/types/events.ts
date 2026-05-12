import type { EasingType } from "./physics";

export interface FadeInEvent    { clipId: string; frame: number; durationFrames: number; easing: EasingType; }
export interface FadeOutEvent   { clipId: string; frame: number; durationFrames: number; easing: EasingType; }
export interface TransitionEvent { fromClipId: string; toClipId: string; frame: number; type: 'cut' | 'dissolve' | 'wipe' | 'push'; durationFrames: number; easing: EasingType; }
export interface ShaderChainUpdateEvent { clipId: string; chainJson: string; }
export interface SeekEvent       { frame: number; }
export interface PlayheadMoveEvent { frame: number; }
export interface RenderJobEvent  { jobId: string; exportPath: string; fps: number; startFrame: number; endFrame: number; }

export interface VideoEventMap {
  fadeIn:            FadeInEvent;
  fadeOut:           FadeOutEvent;
  transition:        TransitionEvent;
  shaderChainUpdate: ShaderChainUpdateEvent;
  seek:              SeekEvent;
  playheadMove:      PlayheadMoveEvent;
  renderJob:         RenderJobEvent;
}

export interface AudioEventMap {
  csdPlay:    { blockId: string; csdText: string; };
  csdStop:    { blockId: string; };
  csdScore:   { blockId: string; scoreText: string; };
  channelSet: { name: string; value: number; };
  export:     { outputPath: string; durationSec: number; };
}
