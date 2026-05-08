/**
 * Ready-to-use CSD instrument definitions as orchestra fragments.
 * These contain no header and no score — compose with makeCsd().
 */

/**
 * Plucked string (Karplus-Strong via `pluck` opcode).
 * Channels: pitch_hz (default 440), amp (default 0.5)
 * Trigger: send score event "i 'PluckInstr' 0 2"
 */
export const PLUCK_INSTR = `
instr PluckInstr
  ipitch  chnget "pitch_hz"
  iamp    chnget "amp"
  ipitch  = (ipitch <= 0 ? 440 : ipitch)
  iamp    = (iamp   <= 0 ? 0.5 : iamp)
  aL      pluck iamp, ipitch, ipitch, 0, 1
  aR      pluck iamp, ipitch * 1.005, ipitch, 0, 1
  aenv    linsegr 0, 0.005, 1, p3 - 0.01, 1, 0.005, 0
          outs aL * aenv, aR * aenv
endin
`.trim();

/**
 * FM synthesis instrument.
 * Channels: freq (carrier Hz), ratio (modulator ratio), index (mod depth), amp
 */
export const FM_INSTR = `
instr FMInstr
  ifreq   chnget "freq"
  iratio  chnget "ratio"
  iindex  chnget "index"
  iamp    chnget "amp"
  ifreq   = (ifreq  <= 0 ? 440  : ifreq)
  iratio  = (iratio <= 0 ? 2.0  : iratio)
  iindex  = (iindex <= 0 ? 3.0  : iindex)
  iamp    = (iamp   <= 0 ? 0.5  : iamp)
  amod    poscil ifreq * iratio * iindex, ifreq * iratio
  acar    poscil iamp, ifreq + amod
  aenv    linsegr 0, 0.01, 1, p3 - 0.02, 1, 0.01, 0
          outs acar * aenv, acar * aenv
endin
`.trim();

/**
 * Looping segment instrument for block-based patterns.
 * p4 = pitch Hz, p5 = amplitude, p6 = loop start ratio, p7 = loop end ratio
 */
export const LOOP_INSTR = `
instr LoopInstr
  ipitch = p4
  iamp   = p5
  istart = p6
  iend   = p7
  kamp   linsegr 0, 0.01, iamp, p3 - 0.02, iamp, 0.01, 0
  aL     loopseg ipitch, istart, 0, istart, 0.5, iend, 0.5, iend
  aR     = aL
          outs aL * kamp, aR * kamp
endin
`.trim();

/**
 * Granular synthesis instrument using `grain` opcode.
 * Channels: freq, amp, grainsize (ms), density (grains/sec), pitch_rand
 */
export const GRAIN_INSTR = `
instr GrainInstr
  ifreq     chnget "freq"
  iamp      chnget "amp"
  igsz      chnget "grainsize"
  idensity  chnget "density"
  iprand    chnget "pitch_rand"
  ifreq     = (ifreq    <= 0 ? 200  : ifreq)
  iamp      = (iamp     <= 0 ? 0.3  : iamp)
  igsz      = (igsz     <= 0 ? 50   : igsz)
  idensity  = (idensity <= 0 ? 40   : idensity)
  iprand    = (iprand   <= 0 ? 0.01 : iprand)
  kamp      linsegr 0, 0.05, iamp, p3 - 0.1, iamp, 0.05, 0
  a1        grain kamp, ifreq, iprand, 0, igsz/1000, idensity, 1, 1, 0
            outs a1, a1
endin
`.trim();
