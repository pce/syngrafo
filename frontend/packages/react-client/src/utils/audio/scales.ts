import { InstrumentType } from "@/types/audio";

const CHROMATIC = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;

//  Scale interval patterns (semitones from root)
const SCALE_INTERVALS: Record<string, number[]> = {
  major:        [0, 2, 4, 5, 7, 9, 11],
  minor:        [0, 2, 3, 5, 7, 8, 10],
  "harm-minor": [0, 2, 3, 5, 7, 8, 11],
  "mel-minor":  [0, 2, 3, 5, 7, 9, 11],
  pentatonic:   [0, 2, 4, 7, 9],
  "penta-min":  [0, 3, 5, 7, 10],
  blues:        [0, 3, 5, 6, 7, 10],
  dorian:       [0, 2, 3, 5, 7, 9, 10],
  phrygian:     [0, 1, 3, 5, 7, 8, 10],
  lydian:       [0, 2, 4, 6, 7, 9, 11],
  mixolydian:   [0, 2, 4, 5, 7, 9, 10],
  locrian:      [0, 1, 3, 5, 6, 8, 10],
  chromatic:    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  wholetone:    [0, 2, 4, 6, 8, 10],
  diminished:   [0, 2, 3, 5, 6, 8, 9, 11],
};

/** All available scale names, in display order. */
export const SCALE_NAMES = Object.keys(SCALE_INTERVALS);

/**
 * Returns note names for the given root + scale, starting from the root.
 * Falls back to chromatic if the scale name is unknown.
 *
 * @param rootNote  e.g. "C", "F#", "Bb" (sharps only — Bb treated as A#)
 * @param scaleName e.g. "major", "blues", "dorian"
 */
export function getScaleNotes(rootNote: string, scaleName: string): string[] {
  const startIdx = (CHROMATIC as readonly string[]).indexOf(rootNote);
  if (startIdx < 0) return [...CHROMATIC]; // unknown root → chromatic

  const intervals = SCALE_INTERVALS[scaleName] ?? SCALE_INTERVALS["chromatic"]!;
  return intervals.map(semitones => CHROMATIC[(startIdx + semitones) % 12]!);
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
