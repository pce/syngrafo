/**
 * Configuration emitted by SequenceImportDialog when the user confirms.
 */
import type { LookPresetId } from './look.ts';

/** How the sequence is arranged on the timeline. */
export type SeqImportMode = 'photoshow' | 'daumenkino';  // 'collage' — phase 2

/**
 * Transition applied at the boundaries of each clip.
 * - 'none'        hard cut (no blend, no keyframes)
 * - 'fade'        opacity fadeIn/fadeOut operators
 * - 'slide-left'  clip enters from right, exits left (posX keyframes)
 * - 'slide-right' clip enters from left, exits right
 * - 'slide-up'    enters from bottom, exits top
 * - 'slide-down'  enters from top, exits bottom
 * - 'random'      one of the slide variants chosen randomly per clip
 */
export type SeqTransition =
  | 'none' | 'fade'
  | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'random';

export interface SequenceImportConfig {
  mode: SeqImportMode;
  /** Photoshow: seconds per clip (converted to frames by the caller). */
  secPerClip: number;
  /** Daumenkino: integer frames-per-image (1 = true flipbook at project FPS). */
  framesPerImage: number;
  /** Transition style applied to every clip. */
  transition: SeqTransition;
  /**
   * Overlap duration for fade/slide transitions in frames.
   * Ignored when transition === 'none'.
   */
  transitionFrames: number;
  /** Add a randomised Ken Burns pan+zoom operator on each clip. */
  kenBurns: boolean;
  /**
   * When true the sequence is designed to loop:
   * the first and last clips will have mirrored fades so the loop is seamless.
   */
  loopable: boolean;
  /** Look preset ID to apply as a shader chain to every imported clip. */
  lookPresetId: LookPresetId;
}

export const SEQ_IMPORT_DEFAULTS: SequenceImportConfig = {
  mode: 'photoshow',
  secPerClip: 4,
  framesPerImage: 1,
  transition: 'fade',
  transitionFrames: 15,
  kenBurns: true,
  loopable: false,
  lookPresetId: 'none',
};
