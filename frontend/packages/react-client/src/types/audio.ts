/**
 * AudioRecordingDocument — represents a recorded or imported audio file.
 * The audio data lives on disk inside the active Zone's folder.
 * The path is stored in SQLite; no browser storage (IndexedDB / localStorage) is used.
 */
export interface AudioRecordingDocument {
  id?:        number;   // DB row id
  name:       string;   // display name
  path:       string;   // absolute path to the audio file on disk
  blob?:      Blob;     // in-memory blob for immediate playback/download
  mimeType:   string;   // e.g. "audio/webm" | "audio/mp4"
  duration?:  number;   // seconds
  createdAt?: number;   // Unix ms
}

/** Track playback mode for the step-sequencer */
export enum TrackMode {
  STEP     = "STEP",
  XY       = "XY",
  CIRCULAR = "CIRCULAR",
}

/** Synthesizer waveform type */
export enum InstrumentType {
  Sine      = "sine",
  Square    = "square",
  Sawtooth  = "sawtooth",
  Triangle  = "triangle",
  PatchBlock = "patchBlock",
}

/** A single note in a sequencer track */
export interface Note {
  id:       string;
  pitch:    number;   // MIDI note number
  time:     number;   // step index
  duration: number;
  velocity: number;
}

/** Full track descriptor used by AudioTimelinePage */
export interface AudioTrack {
  id:                 string;
  name:               string;
  mode:               TrackMode;
  notes:              Note[];
  length:             number;
  color:              string;
  solo:               boolean;
  mute:               boolean;
  schedulerMuted:     boolean;
  instrument:         InstrumentType;
  octaveOffset:       number;
  rootNote?:          string;
  scaleName?:         string;
  scaleNotes?:        string[];
  loopIndependently?: boolean;
  /** When instrument is PatchBlock, references a PatchRegistryEntry id */
  patchId?:           string;
}
