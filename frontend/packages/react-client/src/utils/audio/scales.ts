import { InstrumentType } from "@/types/audio";

/** Returns note names for the given root + scale.  Stub — returns chromatic. */
export function getScaleNotes(rootNote: string, _scaleName: string): string[] {
  const chromatic = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const start     = chromatic.indexOf(rootNote);
  if (start < 0) return chromatic;
  return [...chromatic.slice(start), ...chromatic.slice(0, start)];
}

/** Returns a sensible default scale for a given instrument type. */
export function getDefaultScaleForInstrument(_instrument: InstrumentType): {
  rootNote:   string;
  scaleName:  string;
  scaleNotes: string[];
} {
  return {
    rootNote:   "C",
    scaleName:  "major",
    scaleNotes: getScaleNotes("C", "major"),
  };
}
