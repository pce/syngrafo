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
  | 'bloom'            // cinematic threshold bloom (additive glow)
  | 'bokeh-glow'       // threshold-based bokeh particle glow
  | 'chromatic-warp'   // smooth evolving field + lens chromatic aberration
  | 'flow-warp'        // Sobel-gradient-driven edge-flow distortion
  | 'duotone'          // 2-color luminance mapping
  | 'tritone'          // 3-stop luminance mapping
  | 'film-grain'       // retro warm-grain look
  | 'rounded-frame'    // SDF rounded-corner alpha mask
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
  // duotone / tritone color stops (packed 0xRRGGBB integer)
  shadowColor?:    number;
  midtoneColor?:   number;
  highlightColor?: number;
  // film-grain extras
  warmth?:  number;   // 0–1; adds warm orange tint
  lift?:    number;   // 0–0.2; raises the black point (faded-film look)
  // rounded-frame
  cornerRadius?: number;  // 0–0.49 (0 = square, 0.49 ≈ pill/circle)
  /** Luminance cutoff for bloom / bokeh-glow (0–1). */
  threshold?: number;
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
