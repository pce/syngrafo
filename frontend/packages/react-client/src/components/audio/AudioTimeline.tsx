import React from "react";
import type { AudioTrack, Note, InstrumentType } from "@/types/audio";

interface AudioTimelineProps {
  tracks:               AudioTrack[];
  onAddTrack:           () => void;
  onTrackModeToggle:    (trackId: string) => void;
  onTrackLengthChange:  (trackId: string, length: number) => void;
  onTrackMute:          (trackId: string) => void;
  onTrackSolo:          (trackId: string) => void;
  onOctaveChange:       (trackId: string, change: number) => void;
  onAddNote:            (trackId: string, note: Note) => void;
  onScaleChange:        (trackId: string, rootNote: string, scaleName: string) => void;
  onNoteRemove:         (trackId: string, noteId: string) => void;
  onClearPattern:       (trackId: string) => void;
  onInstrumentChange:   (trackId: string, instrument: InstrumentType) => void;
}

const AudioTimeline: React.FC<AudioTimelineProps> = ({ tracks, onAddTrack }) => (
  <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--theme-text-muted)] select-none p-8">
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      strokeLinejoin="round" className="w-12 h-12 opacity-30"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
    <div className="text-center">
      <p className="text-sm font-bold text-[var(--theme-text)] mb-1">Audio Timeline</p>
      <p className="text-xs max-w-xs leading-relaxed">
        Multi-track step-sequencer with STEP, XY and CIRCULAR modes — coming soon.
      </p>
      <p className="text-[10px] mt-1 opacity-60">{tracks.length} track{tracks.length !== 1 ? "s" : ""} ready</p>
    </div>
    <button
      onClick={onAddTrack}
      className="px-4 py-1.5 bg-[var(--theme-primary)] hover:opacity-90 text-white text-xs font-semibold rounded-lg transition-opacity"
    >
      Add Track
    </button>
  </div>
);

export default AudioTimeline;
