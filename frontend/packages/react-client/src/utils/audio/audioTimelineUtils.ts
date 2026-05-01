import { TrackMode, InstrumentType } from "@/types/audio";
import type { AudioTrack } from "@/types/audio";
import { getScaleNotes } from "./scales";

export const EMPTY_TRACKS: AudioTrack[] = [
  {
    id:             "track-1",
    name:           "Track 1",
    mode:           TrackMode.STEP,
    notes:          [],
    length:         16,
    color:          "#4a90e2",
    solo:           false,
    mute:           false,
    schedulerMuted: false,
    instrument:     InstrumentType.Sine,
    octaveOffset:   0,
    rootNote:       "C",
    scaleName:      "major",
    scaleNotes:     getScaleNotes("C", "major"),
    loopIndependently: true,
  },
];

export const DEMO_TRACKS: AudioTrack[] = EMPTY_TRACKS;
