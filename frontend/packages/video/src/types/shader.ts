import type { SpringConfig } from '@syngrafo/shared';

export type ShaderKind =
  | 'kenburns'
  | 'mirror'
  | 'flip'
  | 'scale-in'
  | 'scale-out'
  | 'kaleidoscope'
  | 'blackhole'
  | 'noise'
  | 'blur'
  | 'dof'
  | 'tilt-blur'
  | 'cinema'
  | 'lut'
  | 'fade'
  | 'custom';

export interface FocusPoint {
  x: number;
  y: number;
}

export interface ShaderParams {
  // Ken Burns
  fromScale?: number;
  toScale?: number;
  fromOffsetX?: number;
  fromOffsetY?: number;
  toOffsetX?: number;
  toOffsetY?: number;
  // mirror / flip
  axis?: number;          // 0 = horizontal, 1 = vertical, 2 = both
  // scale-in / scale-out
  targetScale?: number;
  // kaleidoscope
  segments?: number;
  // blackhole
  strength?: number;
  radius?: number;
  // noise
  amplitude?: number;
  frequency?: number;
  // dof
  focalDistance?: number;
  focalRange?: number;
  blurStrength?: number;
  // tilt-blur
  tiltAngle?: number;
  tiltWidth?: number;
  tiltSoftness?: number;
  // cinema
  vignetteStr?: number;
  grainAmount?: number;
  chromaShift?: number;
  contrast?: number;
  saturation?: number;
  // fade / generic
  alpha?: number;
  intensity?: number;
  [key: string]: number | undefined;
}

export interface ShaderNode {
  id: string;
  kind: ShaderKind;
  label: string;
  enabled: boolean;
  focusPoint: FocusPoint;
  params: ShaderParams;
  /** Per-node spring override; falls back to ShaderChainConfig.springConfig. */
  springConfig?: SpringConfig;
}

export interface ShaderChainConfig {
  nodes: ShaderNode[];
  springConfig: SpringConfig;
}
