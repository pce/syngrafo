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
