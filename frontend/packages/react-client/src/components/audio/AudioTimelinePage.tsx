/**
 * AudioTimelinePage
 *
 * workstation layout
 *   │ Pattern Arranger│ Sample Browser   │  Step Sequencer (AudioTimeline) │ CSD Editor  │
 *
 * Pattern Arranger:
 *   Named patterns (PTN_01, PTN_02, …) each hold per-track mute overrides.
 *   The sequencer cycles through patterns in order — each pattern repeats
 *   `repeatCount` times before advancing.  Tracks are reference-based by
 *   default; only when a slot's pattern is edited does it gain a local copy.
 *
 * PatchBlock instrument:
 *   Any StepSequencer track can select InstrumentType.PatchBlock and pick a
 *   named patch from the PatchWorkstation.  When a step fires, the shared
 *   PatchStore dispatches a trigger to the patch engine.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import AudioTimeline from "./AudioTimeline";
import { AudioSampleBrowser, SAMPLE_DRAG_TYPE } from "./AudioSampleBrowser";
import { CsdEditor } from "./CsdEditor";
import { SectionArranger } from "./SectionArranger";
import { EMPTY_TRACKS } from "@/utils/audio/audioTimelineUtils";
import { TrackMode, InstrumentType } from "@/types/audio";
import type { AudioTrack, Note } from "@/types/audio";
import { getDefaultScaleForInstrument, getScaleNotes } from "@/utils/audio/scales";
import { useCsound } from "@syngrafo/audio";
import { useArrangement } from "@/hooks/useArrangement";
import { usePatchStore } from "@/store/patch-store";
import { OfflineRenderDialog } from "./OfflineRenderDialog";
import { ResizablePanel } from "@syngrafo/ui";
import { Icon } from "../Icon";

const COLORS = ["#4a90e2","#50e3c2","#e2574a","#e2c64a","#bd10e0","#9013fe","#4a6fe3"];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#4a90e2";

interface AudioTimelinePageProps {
  workingDir?: string;
}

const AudioTimelinePage = ({ workingDir }: AudioTimelinePageProps) => {
  const [tracks, setTracks] = useState<AudioTrack[]>(EMPTY_TRACKS);
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);

  // Csound engine (for loading samples)
  const csound = useCsound();

  // Shared patch store for PatchBlock instrument tracks
  const patchStore = usePatchStore();

  const arr = useArrangement();

  // Initialise / sync arrangement whenever the track list changes
  const prevTrackIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const ids = tracks.map(t => t.id);
    const prev = prevTrackIdsRef.current;
    const changed = ids.length !== prev.length || ids.some((id, i) => id !== prev[i]);
    if (!changed) return;
    if (prev.length === 0) {
      arr.initArrangement(ids);
    } else {
      arr.syncTracks(ids);
    }
    prevTrackIdsRef.current = ids;
  }); // XXX intentionally no dep array: runs whenever tracks changes

  const handleSampleDrop = useCallback(async (path: string, name: string) => {
    if (!csound.isReady) return;
    try {
      const url   = `local://local${path}`;
      const resp  = await fetch(url);
      if (!resp.ok) return;
      const buf   = await resp.arrayBuffer();
      const vPath = `/samples/${name}`;
      csound.writeFile(vPath, new Uint8Array(buf));
      csound.setChannel("sampler_file", 0);
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

  /** Fired by AudioTimeline when a PatchBlock step fires */
  const handleTriggerPatch = useCallback((patchId: string, duration: number) => {
    patchStore.triggerPatch(patchId, undefined, duration);
  }, [patchStore]);

  /** Fired when the user picks a patch for a PatchBlock track */
  const handlePatchIdChange = useCallback((trackId: string, patchId: string) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, patchId } : t));
  }, []);

  // Sync schedulerMuted on mount
  useEffect(() => {
    setTracks(prev => {
      const anySoloed = prev.some(t => t.solo);
      return prev.map(t => ({ ...t, schedulerMuted: anySoloed ? !t.solo : t.mute }));
    });
  }, []);


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

        {arr.activeSection && (
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold
                           bg-[var(--theme-primary)]/20 text-[var(--theme-primary)]
                           border border-[var(--theme-primary)]/30 ml-1">
            <Icon name="play" size="xs" />
            {arr.activeSection.name}
            {arr.activeSection.repeatCount > 1 && (
              <span className="flex items-center gap-0.5 opacity-70">
                <Icon name="rotate" size="xs" />
                {arr.activeSection.repeatCount}
              </span>
            )}
          </span>
        )}

        <div className="flex-1" />

        {/* Offline render button */}
        <button
          onClick={() => setRenderDialogOpen(true)}
          className="text-[10px] px-2 py-1 rounded border border-[var(--theme-border)]
                     text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                     hover:border-[var(--theme-primary)] transition-colors font-semibold"
          title="Offline render to WAV"
        >
          ⬇ WAV
        </button>
      </div>

      {/* ── Four-panel body ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Far-left: Pattern Arranger */}
        <ResizablePanel label="Patterns" side="left" defaultWidth={190} minWidth={150} maxWidth={320}>
          <SectionArranger
            sections={arr.arrangement.sections}
            activeSectionIdx={arr.activeSectionIdx}
            globalTracks={tracks}
            loopArrangement={arr.arrangement.loopArrangement}
            isPlaying={false}
            onAddSection={arr.addSection}
            onRemoveSection={arr.removeSection}
            onMoveSection={arr.moveSection}
            onRenameSection={arr.renameSection}
            onRepeatCount={arr.setRepeatCount}
            onToggleSlotMute={arr.toggleSlotMute}
            onGoToSection={arr.goToSection}
            onToggleLoop={arr.setLoopArrangement}
          />
        </ResizablePanel>

        {/* Left: Sample browser */}
        <ResizablePanel label="Samples" side="left" defaultWidth={220} minWidth={160} maxWidth={400}>
          <AudioSampleBrowser
            workingDir={workingDir}
            onSampleSelect={handleSampleDrop}
            className="h-full"
          />
        </ResizablePanel>

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
            sectionMutes={arr.sectionMutes}
            onCycleComplete={arr.onCycleComplete}
            onTriggerPatch={handleTriggerPatch}
            onPatchIdChange={handlePatchIdChange}
          />
        </main>

        {/* Right: CSD editor */}
        <ResizablePanel label="CSD" side="right" defaultWidth={280} minWidth={180} maxWidth={600} defaultOpen={false}>
          <CsdEditor className="h-full" />
        </ResizablePanel>
      </div>

      {renderDialogOpen && (
        <OfflineRenderDialog
          tracks={tracks}
          bpm={120}
          arrangement={arr.arrangement}
          onClose={() => setRenderDialogOpen(false)}
        />
      )}
    </div>
  );
};

export default AudioTimelinePage;
