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
