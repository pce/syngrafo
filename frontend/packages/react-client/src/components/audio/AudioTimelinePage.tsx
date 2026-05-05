import { useState, useCallback, useEffect } from "react";
import AudioTimeline from "./AudioTimeline";
import { EMPTY_TRACKS } from "@/utils/audio/audioTimelineUtils";
import { TrackMode, InstrumentType } from "@/types/audio";
import type { AudioTrack, Note } from "@/types/audio";
import { getDefaultScaleForInstrument, getScaleNotes } from "@/utils/audio/scales";

const COLORS = ["#4a90e2","#50e3c2","#e2574a","#e2c64a","#bd10e0","#9013fe","#4a6fe3"];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#4a90e2";

const AudioTimelinePage = () => {
  const [tracks, setTracks] = useState<AudioTrack[]>(EMPTY_TRACKS);



  const handleNoteRemove = useCallback((trackId: string, noteId: string) => {
    setTracks((prev) =>
      prev.map((t) => t.id === trackId ? { ...t, notes: t.notes.filter((n) => n.id !== noteId) } : t)
    );
  }, []);

  const handleAddNote = useCallback((trackId: string, note: Note) => {
    setTracks((prev) =>
      prev.map((t) => t.id === trackId ? { ...t, notes: [...t.notes, note] } : t)
    );
  }, []);

  const handleTrackModeToggle = useCallback((trackId: string) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? {
              ...t,
              mode:
                t.mode === TrackMode.STEP
                  ? TrackMode.XY
                  : t.mode === TrackMode.XY
                  ? TrackMode.CIRCULAR
                  : TrackMode.STEP,
            }
          : t
      )
    );
  }, []);

  const handleTrackLengthChange = useCallback((trackId: string, length: number) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, length } : t));
  }, []);

  const handleTrackMute = useCallback((trackId: string) => {
    setTracks((prev) => {
      const updated   = prev.map((t) => t.id === trackId ? { ...t, mute: !t.mute } : t);
      const anySoloed = updated.some((t) => t.solo);
      return updated.map((t) => ({ ...t, schedulerMuted: anySoloed ? !t.solo : t.mute }));
    });
  }, []);

  const handleTrackSolo = useCallback((trackId: string) => {
    setTracks((prev) => {
      const isSoloed = prev.find((t) => t.id === trackId)?.solo ?? false;
      if (isSoloed) {
        return prev.map((t) => t.id === trackId ? { ...t, solo: false } : t);
      }
      return prev
        .map((t) => ({ ...t, solo: t.id === trackId }))
        .map((t) => ({ ...t, schedulerMuted: !t.solo }));
    });
  }, []);

  const handleOctaveChange = useCallback((trackId: string, change: number) => {
    setTracks((prev) =>
      prev.map((t) => t.id === trackId ? { ...t, octaveOffset: (t.octaveOffset ?? 0) + change } : t)
    );
  }, []);

  const handleClearPattern = useCallback((trackId: string) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, notes: [] } : t));
  }, []);

  const handleAddTrack = useCallback(() => {
    setTracks((prev) => {
      const newId   = `track-${prev.length + 1}`;
      const defaults = getDefaultScaleForInstrument(InstrumentType.Sine);
      const anySoloed = prev.some((t) => t.solo);
      const newTrack: AudioTrack = {
        id: newId,
        name: `Track ${prev.length + 1}`,
        mode: TrackMode.STEP,
        notes: [],
        length: 16,
        color: randomColor(),
        solo: false,
        mute: false,
        schedulerMuted: anySoloed,
        instrument: InstrumentType.Sine,
        octaveOffset: 0,
        ...defaults,
        loopIndependently: true,
      };
      return [...prev, newTrack];
    });
  }, []);

  const handleScaleChange = useCallback((trackId: string, rootNote: string, scaleName: string) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? { ...t, rootNote, scaleName, scaleNotes: getScaleNotes(rootNote, scaleName) }
          : t
      )
    );
  }, []);

  const handleInstrumentChange = useCallback((trackId: string, instrument: InstrumentType) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, instrument } : t));
  }, []);

  // Sync schedulerMuted on mount
  useEffect(() => {
    setTracks((prev) => {
      const anySoloed = prev.some((t) => t.solo);
      return prev.map((t) => ({ ...t, schedulerMuted: anySoloed ? !t.solo : t.mute }));
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-[var(--theme-bg)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
        <span className="text-xs font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
          Timeline
        </span>
        <span className="text-[10px] text-[var(--theme-text-muted)] opacity-50">
          {tracks.length} track{tracks.length !== 1 ? "s" : ""}
        </span>
      </div>
      {/* Main */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AudioTimeline
          tracks={tracks}
          onAddTrack={handleAddTrack}
          onTrackModeToggle={handleTrackModeToggle}
          onTrackLengthChange={handleTrackLengthChange}
          onTrackMute={handleTrackMute}
          onTrackSolo={handleTrackSolo}
          onOctaveChange={handleOctaveChange}
          onAddNote={handleAddNote}
          onScaleChange={handleScaleChange}
          onNoteRemove={handleNoteRemove}
          onClearPattern={handleClearPattern}
          onInstrumentChange={handleInstrumentChange}
        />
      </div>
    </div>
  );
};

export default AudioTimelinePage;
