import type { SpringConfig } from '@syngrafo/shared';

export type ShaderKind = 'dof' | 'tilt-blur' | 'cinema' | 'lut' | 'custom';

/** A 2D normalised point [0,1] x [0,1] used as DoF/Blur focus point */
export interface FocusPoint {
  x: number;   // 0 = left,  1 = right
  y: number;   // 0 = top,   1 = bottom
}

export interface ShaderParams {
  // DoF
  focalDistance?: number;   // 0–1, distance at which things are in focus
  focalRange?:    number;   // 0–1, depth of field radius
  blurStrength?:  number;   // 0–1

  // Tilt-blur
  tiltAngle?:     number;   // degrees
  tiltWidth?:     number;   // 0–1
  tiltSoftness?:  number;   // 0–1

  // Cinema
  vignetteStr?:   number;   // 0–1
  grainAmount?:   number;   // 0–1
  chromaShift?:   number;   // 0–1
  contrast?:      number;   // 0–2 (1 = neutral)
  saturation?:    number;   // 0–2 (1 = neutral)

  // Generic
  intensity?:     number;   // 0–1 master strength
  [key: string]:  number | undefined;
}

export interface ShaderNode {
  id: string;
  kind: ShaderKind;
  label: string;
  enabled: boolean;
  focusPoint: FocusPoint;
  params: ShaderParams;
}

/**
 * An ordered chain of ShaderNodes.
 * The chain itself has spring physics for its visual layout —
 * nodes animate into position using springConfig when reordered.
 */
export interface ShaderChainConfig {
  nodes: ShaderNode[];
  /** Spring that governs the animated reordering of nodes in the UI */
  springConfig: SpringConfig;
}
