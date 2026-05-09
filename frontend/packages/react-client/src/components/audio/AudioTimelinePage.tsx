/**
 * AudioTimelinePage
 *
 * Three-panel audio workstation layout
 *   │ Sample Browser  │  Step Sequencer (AudioTimeline)│   CSD Editor   │
 *   │                 │                                │                │
 *
 * Sample workflow:
 *   1. Browse zone files in the left panel → double-click plays inline preview.
 *   2. Drag a sample onto a sequencer track → loads to Csound FS and sets it
 *      as the active sampler_file channel (ready to trigger via CsdEditor).
 *   3. In the CSD editor, pick the Sampler template, compile, and fire score
 *      events to audition the sample with envelope + effects.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import AudioTimeline from "./AudioTimeline";
import { AudioSampleBrowser, SAMPLE_DRAG_TYPE } from "./AudioSampleBrowser";
import { CsdEditor } from "./CsdEditor";
import { EMPTY_TRACKS } from "@/utils/audio/audioTimelineUtils";
import { TrackMode, InstrumentType } from "@/types/audio";
import type { AudioTrack, Note } from "@/types/audio";
import { getDefaultScaleForInstrument, getScaleNotes } from "@/utils/audio/scales";
import { useCsound } from "@syngrafo/audio";

const COLORS = ["#4a90e2","#50e3c2","#e2574a","#e2c64a","#bd10e0","#9013fe","#4a6fe3"];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#4a90e2";

// Default panel widths
const SAMPLE_PANEL_W = 220;
const CSD_PANEL_W    = 280;

interface AudioTimelinePageProps {
  workingDir?: string;
}

const AudioTimelinePage = ({ workingDir }: AudioTimelinePageProps) => {
  const [tracks, setTracks] = useState<AudioTrack[]>(EMPTY_TRACKS);

  // Panel visibility
  const [samplePanelOpen, setSamplePanelOpen] = useState(true);
  const [csdPanelOpen,    setCsdPanelOpen]    = useState(false);

  // Csound engine (for loading samples)
  const csound = useCsound();

  //  Sample drop handler
  // When a file is dragged from AudioSampleBrowser onto the page backdrop,
  // load it into Csound's virtual FS and set the sampler_file channel.

  const handleSampleDrop = useCallback(async (path: string, name: string) => {
    if (!csound.isReady) return;
    try {
      // Fetch raw bytes via the local:// scheme saucer exposes
      const url  = `local://local${path}`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const buf  = await resp.arrayBuffer();
      const vPath = `/samples/${name}`;
      csound.writeFile(vPath, new Uint8Array(buf));
      csound.setChannel("sampler_file", 0); // reset — string channel set below
      // setStringChannel is available on the engine via the useCsound wrapper
      // (added in CsoundEngine.ts). Fall back gracefully if not wrapped.
      if ("setStringChannel" in csound) {
        (csound as unknown as { setStringChannel: (n: string, v: string) => void })
          .setStringChannel("sampler_file", vPath);
      }
    } catch { /* ignore — file might not be accessible yet */ }
  }, [csound]);


  const handleNoteRemove = useCallback((trackId: string, noteId: string) => {
    setTracks(prev =>
      prev.map(t => t.id === trackId
        ? { ...t, notes: t.notes.filter(n => n.id !== noteId) }
        : t
      )
    );
  }, []);

  const handleAddNote = useCallback((trackId: string, note: Note) => {
    setTracks(prev =>
      prev.map(t => t.id === trackId ? { ...t, notes: [...t.notes, note] } : t)
    );
  }, []);

  const handleTrackModeToggle = useCallback((trackId: string) => {
    setTracks(prev =>
      prev.map(t =>
        t.id !== trackId ? t : {
          ...t,
          mode: t.mode === TrackMode.STEP ? TrackMode.XY
              : t.mode === TrackMode.XY   ? TrackMode.CIRCULAR
              : TrackMode.STEP,
        }
      )
    );
  }, []);

  const handleTrackLengthChange = useCallback((trackId: string, length: number) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, length } : t));
  }, []);

  const handleTrackMute = useCallback((trackId: string) => {
    setTracks(prev => {
      const updated   = prev.map(t => t.id === trackId ? { ...t, mute: !t.mute } : t);
      const anySoloed = updated.some(t => t.solo);
      return updated.map(t => ({ ...t, schedulerMuted: anySoloed ? !t.solo : t.mute }));
    });
  }, []);

  const handleTrackSolo = useCallback((trackId: string) => {
    setTracks(prev => {
      const isSoloed = prev.find(t => t.id === trackId)?.solo ?? false;
      if (isSoloed) return prev.map(t => t.id === trackId ? { ...t, solo: false } : t);
      return prev
        .map(t => ({ ...t, solo: t.id === trackId }))
        .map(t => ({ ...t, schedulerMuted: !t.solo }));
    });
  }, []);

  const handleOctaveChange = useCallback((trackId: string, delta: number) => {
    setTracks(prev =>
      prev.map(t =>
        t.id === trackId ? { ...t, octaveOffset: (t.octaveOffset ?? 0) + delta } : t
      )
    );
  }, []);

  const handleClearPattern = useCallback((trackId: string) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, notes: [] } : t));
  }, []);

  const handleAddTrack = useCallback(() => {
    setTracks(prev => {
      const newId     = `track-${prev.length + 1}`;
      const defaults  = getDefaultScaleForInstrument(InstrumentType.Sine);
      const anySoloed = prev.some(t => t.solo);
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
    setTracks(prev =>
      prev.map(t =>
        t.id === trackId
          ? { ...t, rootNote, scaleName, scaleNotes: getScaleNotes(rootNote, scaleName) }
          : t
      )
    );
  }, []);

  const handleInstrumentChange = useCallback((trackId: string, instrument: InstrumentType) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, instrument } : t));
  }, []);

  // Sync schedulerMuted on mount
  useEffect(() => {
    setTracks(prev => {
      const anySoloed = prev.some(t => t.solo);
      return prev.map(t => ({ ...t, schedulerMuted: anySoloed ? !t.solo : t.mute }));
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-[var(--theme-bg)] overflow-hidden">

      {/*  Page header  */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--theme-border)]
                      bg-[var(--theme-surface)] shrink-0">
        <span className="text-xs font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
          Studio
        </span>
        <span className="text-[10px] text-[var(--theme-text-muted)] opacity-50">
          {tracks.length} track{tracks.length !== 1 ? "s" : ""}
        </span>

        <div className="flex-1" />

        {/* Panel toggles */}
        <button
          onClick={() => setSamplePanelOpen(v => !v)}
          className={`text-[10px] px-2 py-1 rounded border font-semibold uppercase tracking-wider transition-colors ${
            samplePanelOpen
              ? "bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
              : "bg-[var(--theme-surface)] border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          }`}
          title="Toggle sample browser"
        >
          Samples
        </button>

        <button
          onClick={() => setCsdPanelOpen(v => !v)}
          className={`text-[10px] px-2 py-1 rounded border font-semibold uppercase tracking-wider transition-colors ${
            csdPanelOpen
              ? "bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
              : "bg-[var(--theme-surface)] border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          }`}
          title="Toggle CSD editor"
        >
          CSD
        </button>
      </div>

      {/*  Three-panel body  */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: Sample browser */}
        {samplePanelOpen && (
          <aside
            className="flex flex-col border-r border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0 overflow-hidden"
            style={{ width: SAMPLE_PANEL_W }}
          >
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--theme-text-muted)] flex-1">
                Samples
              </span>
              <button
                onClick={() => setSamplePanelOpen(false)}
                className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-xs"
                aria-label="Close sample panel"
              >×</button>
            </div>
            <AudioSampleBrowser
              workingDir={workingDir}
              onSampleSelect={handleSampleDrop}
              className="flex-1 min-h-0"
            />
          </aside>
        )}

        {/* Center: Step sequencer */}
        <main
          className="flex-1 min-w-0 overflow-hidden"
          onDragOver={e => {
            if (e.dataTransfer.types.includes(SAMPLE_DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={e => {
            const raw = e.dataTransfer.getData(SAMPLE_DRAG_TYPE);
            if (!raw) return;
            e.preventDefault();
            try {
              const { path, name } = JSON.parse(raw) as { path: string; name: string };
              void handleSampleDrop(path, name);
            } catch { /* ignore */ }
          }}
        >
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
        </main>

        {/* Right: CSD editor */}
        {csdPanelOpen && (
          <aside
            className="flex flex-col border-l border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0 overflow-hidden"
            style={{ width: CSD_PANEL_W }}
          >
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--theme-text-muted)] flex-1">
                CSD Editor
              </span>
              <button
                onClick={() => setCsdPanelOpen(false)}
                className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-xs"
                aria-label="Close CSD editor"
              >×</button>
            </div>
            <CsdEditor className="flex-1 min-h-0" />
          </aside>
        )}
      </div>
    </div>
  );
};

export default AudioTimelinePage;
