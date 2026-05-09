/** Standard Csound header — must match AudioContext settings */
export const CSD_HEADER = `
<CsOptions>
-d -m0 -odac
</CsOptions>
<CsInstruments>
sr     = 48000
ksmps  = 128
nchnls = 2
0dbfs  = 1
`.trim();

export const CSD_FOOTER = `</CsInstruments>`;

export const SCORE_HEADER = `<CsScore>`;
export const SCORE_FOOTER = `</CsScore>\n</CsoundSynthesizer>`;

/** Wrap orchestra + score into a complete CSD */
export function makeCsd(orc: string, score: string): string {
  return [
    '<CsoundSynthesizer>',
    CSD_HEADER,
    orc,
    CSD_FOOTER,
    SCORE_HEADER,
    score,
    SCORE_FOOTER,
  ].join('\n');
}

/**
 * Like makeCsd() but targets offline file rendering instead of DAC output.
 * The output is written to `outputVPath` in the Csound WASM virtual FS
 * (default "/render/output.wav"), which can be read back with CsoundEngine.readFile().
 *
 * To render to disk via the IPC path, pass outputVPath = outputDiskPath and
 * use audioService.exportWav() instead — which calls native Csound with -o flag.
 */
export function makeOfflineCsd(
  orc:         string,
  score:       string,
  outputVPath  = '/render/output.wav',
  sr           = 48000,
): string {
  return `<CsoundSynthesizer>
<CsOptions>
-d -m0 -o ${outputVPath}
</CsOptions>
<CsInstruments>
sr     = ${sr}
ksmps  = 32
nchnls = 2
0dbfs  = 1

${orc}
</CsInstruments>
<CsScore>
${score}
</CsScore>
</CsoundSynthesizer>`;
}
