export { CsoundEngine }             from './csound/CsoundEngine.ts';
export type { EngineState, CsoundEngineOptions } from './csound/CsoundEngine.ts';

export { useCsound }                from './csound/useCsound.ts';
export type { UseCsoundReturn }     from './csound/useCsound.ts';

export { makeCsd, CSD_HEADER, CSD_FOOTER, SCORE_HEADER, SCORE_FOOTER }
                                    from './csound/csd/base.ts';
export * from './csound/csd/instruments.ts';

export { AudioBlock }               from './blocks/AudioBlock.tsx';
export { BlockArranger }            from './blocks/BlockArranger.tsx';
export type {
  AudioBlock as AudioBlockType,
  AudioTrack,
  BlockVariation,
}                                   from './blocks/types.ts';
export { BLOCK_COLORS, VARIATIONS } from './blocks/types.ts';

export { audioService }             from './ipc/audio-service.ts';
export type { ExportResult, AudioInfo } from './ipc/audio-service.ts';

// ── Modular patch system ──────────────────────────────────────────────────────
export * from './modular/types.ts';
export { BLOCK_REGISTRY, BLOCK_KINDS } from './modular/blockDefs.ts';
export {
  GRAINADE_DEF, SIGNAL_FOLLOWER_DEF, DATA_TRANSFORM_DEF,
  SCALE_QUANTIZER_DEF, SAMPLE_PLAYER_DEF, GRISP_CHIPS_DEF,
  EQ3_DEF, DELAY_DEF, BEAT_DETECTOR_DEF, XY_PAD_DEF,
} from './modular/blockDefs.ts';
export { PatchEngine, patchEngine } from './modular/PatchEngine.ts';
export { usePatch } from './modular/usePatch.ts';
export type { UsePatchReturn } from './modular/usePatch.ts';
