/**
 * sequencerInstruments.ts
 *
 * Csound orchestra fragments equivalent to the four Web-Audio oscillator
 * types used by the step sequencer (sine, square, sawtooth, triangle).
 *
 * Each instrument expects:
 *   p4 = frequency in Hz
 *   p5 = velocity 0..1
 *   p3 = duration (from the score event)
 *
 * Instrument names match what arrangementToScore.ts emits.
 */

export const SEQ_SINE_INSTR = `
instr SeqSine
  ifreq = p4
  iamp  = p5 * 0.5
  kenv  linseg 0, 0.005, 1, p3 * 0.7, 0.7, p3 * 0.25, 0
  asig  oscil kenv * iamp, ifreq, 1
  outs  asig, asig
endin`;

export const SEQ_SQUARE_INSTR = `
instr SeqSquare
  ifreq = p4
  iamp  = p5 * 0.3
  kenv  linseg 0, 0.005, 1, p3 * 0.7, 0.7, p3 * 0.25, 0
  asig  vco2 kenv * iamp, ifreq, 10
  outs  asig, asig
endin`;

export const SEQ_SAW_INSTR = `
instr SeqSaw
  ifreq = p4
  iamp  = p5 * 0.25
  kenv  linseg 0, 0.005, 1, p3 * 0.7, 0.7, p3 * 0.25, 0
  asig  vco2 kenv * iamp, ifreq, 0
  outs  asig, asig
endin`;

export const SEQ_TRI_INSTR = `
instr SeqTri
  ifreq = p4
  iamp  = p5 * 0.4
  kenv  linseg 0, 0.005, 1, p3 * 0.7, 0.7, p3 * 0.25, 0
  asig  vco2 kenv * iamp, ifreq, 12
  outs  asig, asig
endin`;

/** The GEN01 sine-wave function table required by SeqSine. */
export const SEQ_SINE_TABLE = 'f 1 0 4096 10 1';

/** All four instrument definitions concatenated. */
export const SEQ_ALL_INSTRS = [
  SEQ_SINE_INSTR, SEQ_SQUARE_INSTR, SEQ_SAW_INSTR, SEQ_TRI_INSTR,
].join('\n');

/** Csound instrument name for each InstrumentType value string. */
export const SEQ_INSTR_NAME: Record<string, string> = {
  sine:     'SeqSine',
  square:   'SeqSquare',
  sawtooth: 'SeqSaw',
  triangle: 'SeqTri',
};
