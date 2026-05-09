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

/**
 * Plasma-noise stretch-morph between this clip's source and an optional
 * target image.
 *
 * At each UV, a 3-harmonic plasma vector field displaces the source
 * texture outward and the destination texture inward as `t` advances from
 * 0 to 1. The displacement is gated by the per-pixel color distance
 * between src and dst so that dark-on-dark areas appear frozen while
 * high-contrast pixels morph dramatically.
 *
 * The field is described by three parameters:
 *   noiseScale  — spatial frequency (UV units); higher = finer plasma
 *   noiseSpeed  — how fast the field evolves (multiplied with globalTimeU)
 *   noiseAmp    — maximum UV displacement magnitude
 *
 * colorDistGate — power applied to the [0,√3] color-distance term before
 *   multiplying with noiseAmp.  0.5 (sqrt) = perceptually linear response.
 *   Lower values make more pixels move; higher values restrict motion to
 *   only the most contrasting areas.
 *
 * motionBlurSamples — number of samples accumulated along the displacement
 *   path for in-camera motion-blur feel. 1 = sharp, 3-5 = cinematic.
 */
export interface StretchMorphOp {
  kind: 'stretch-morph';
  id: string;
  clipId: string;
  /** URL of the morph destination image.  If omitted the clip loops on itself. */
  targetUrl?: string;
  /** Absolute path on disk for the morph target. */
  targetPath?: string;
  /** Plasma spatial scale. Default 3.0. */
  noiseScale: number;
  /** Evolution speed factor. Default 1.0. */
  noiseSpeed: number;
  /** Maximum UV displacement. Default 0.05. */
  noiseAmp: number;
  /** Color-distance gate power (0.5 = sqrt). Default 0.5. */
  colorDistGate: number;
  /** Motion-blur sample count (1–7). Default 3. */
  motionBlurSamples: number;
  /** Clip-relative start frame for the morph window. */
  startFrame: number;
  /** Duration of the morph in frames. */
  durationFrames: number;
}

export type VideoOperator = FadeInOp | FadeOutOp | TransitionOp | SpeedRampOp | KenBurnsOp | StretchMorphOp;
