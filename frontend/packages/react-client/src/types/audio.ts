/** AudioRecordingDocument — stored in IndexedDB by audioStorage */
export interface AudioRecordingDocument {
  id?:        number;
  name:       string;
  blob:       Blob;
  mimeType:   string;
  duration?:  number;
  createdAt?: number;
}

/** Track playback mode for the step-sequencer */
export enum TrackMode {
  STEP     = "STEP",
  XY       = "XY",
  CIRCULAR = "CIRCULAR",
}

/** Synthesizer waveform type */
export enum InstrumentType {
  Sine     = "sine",
  Square   = "square",
  Sawtooth = "sawtooth",
  Triangle = "triangle",
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
}
