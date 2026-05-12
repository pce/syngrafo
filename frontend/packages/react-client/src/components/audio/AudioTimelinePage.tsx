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
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import { fileService } from "@syngrafo/shared";
import AudioTimeline from "./AudioTimeline";
import { AudioSampleBrowser, SAMPLE_DRAG_TYPE } from "./AudioSampleBrowser";
import { CsdEditor } from "./CsdEditor";
import { SectionArranger } from "./SectionArranger";
import { EMPTY_TRACKS } from "@/utils/audio/audioTimelineUtils";
import { TrackMode, InstrumentType } from "@/types/audio";
import type { AudioTrack, Note } from "@/types/audio";
import { getDefaultScaleForInstrument, getScaleNotes } from "@/utils/audio/scales";
import { useCsound, audioService } from "@syngrafo/audio";
import { useArrangement } from "@/hooks/useArrangement";
import { usePatchStore } from "@/store/patch-store";
import { OfflineRenderDialog } from "./OfflineRenderDialog";
import { ResizablePanel } from "@syngrafo/ui";
import { Icon } from "../Icon";
import { dms } from "@/services/dms-service";
import {
  BUNDLED_PATTERN_PRESETS,
  exportPatchPreset,
  exportPatternPreset,
  importPatternArrangement,
  importPatternTrack,
  isPatternPresetFile,
  slugifyPresetName,
  type PatchPresetFileV1,
  type PatternPresetFileV1,
} from "./presets";

const COLORS = ["#4a90e2","#50e3c2","#e2574a","#e2c64a","#bd10e0","#9013fe","#4a6fe3"];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#4a90e2";

interface AudioTimelinePageProps {
  workingDir?: string;
}

const AudioTimelinePage = ({ workingDir }: AudioTimelinePageProps) => {
  const [tracks, setTracks] = useState<AudioTrack[]>(EMPTY_TRACKS);
  const [bpm, setBpm] = useState(120);
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [presetStatus, setPresetStatus] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('untitled');
  useLingui();

  const csound = useCsound();

  const patchStore = usePatchStore();

  const arr = useArrangement();

  // Initialise / sync arrangement whenever the track list changes
  const prevTrackIdsRef = useRef<string[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    const loadRecent = async () => {
      try {
        const list = await audioService.listProjects('global');
        if (!list.ok || list.data.length === 0) return;
        const recent = list.data[0]; // sorted newest-first by the backend
        const loaded = await audioService.loadProject<PatternPresetFileV1>(recent.name, 'global');
        if (!loaded.ok || !loaded.data?.data) return;
        const preset = loaded.data.data;
        if (isPatternPresetFile(preset)) {
          applyPatternPreset(preset);
          setProjectName(recent.name);
        }
      } catch {
        // No saved project — start fresh (silent failure is correct here).
      }
    };
    void loadRecent();
  }, []); // intentionally empty — run once on mount

  useEffect(() => {
    // Skip the initial mount — only auto-save after the user has made changes.
    // The ref-guard ensures we don't save the default empty state over a freshly loaded project.
    if (tracks === EMPTY_TRACKS) return;
    scheduleAutoSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, bpm]);

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

  const handleTriggerPatch = useCallback((patchId: string, duration: number) => {
    patchStore.triggerPatch(patchId, undefined, duration);
  }, [patchStore]);

  const handlePatchIdChange = useCallback((trackId: string, patchId: string) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, patchId } : t));
  }, []);

  const importPatchPresets = useCallback((patchPresets: PatchPresetFileV1[] | undefined) => {
    const patchIdByRef = new Map<string, string>();
    for (const preset of patchPresets ?? []) {
      const existing = patchStore.patches.find((entry) => entry.name === preset.name);
      if (existing) {
        patchStore.updatePatch(existing.id, preset.patch);
        patchStore.renamePatch(existing.id, preset.name);
        if (preset.presetRef) patchIdByRef.set(preset.presetRef, existing.id);
      } else {
        const entry = patchStore.createPatch(preset.name);
        patchStore.updatePatch(entry.id, preset.patch);
        if (preset.presetRef) patchIdByRef.set(preset.presetRef, entry.id);
      }
    }
    return patchIdByRef;
  }, [patchStore]);

  const buildPreset = useCallback((name: string) => {
    const usedPatchEntries = Array.from(new Set(
      tracks
        .filter(t => t.instrument === InstrumentType.PatchBlock && t.patchId)
        .map(t => patchStore.patches.find(e => e.id === t.patchId))
        .filter((e): e is NonNullable<typeof e> => !!e),
    ));
    const patchRefById = new Map<string, string>();
    const patchPresets = usedPatchEntries.map(entry => {
      const ref = slugifyPresetName(entry.name);
      patchRefById.set(entry.id, ref);
      return exportPatchPreset(entry.name, entry.patch, ref);
    });
    return exportPatternPreset({
      name,
      bpm,
      activeSectionIdx: arr.activeSectionIdx,
      tracks,
      arrangement: arr.arrangement,
      patchRefById,
      patches: patchPresets,
    });
  }, [arr.activeSectionIdx, arr.arrangement, bpm, patchStore.patches, tracks]);

  const scheduleAutoSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const preset = buildPreset(projectName);
      void audioService.saveProject(projectName, 'global', preset)
        .catch(err => console.warn('[AudioTimeline] Auto-save failed:', err));
    }, 800);
  }, [buildPreset, projectName]);

  const applyPatternPreset = useCallback((preset: PatternPresetFileV1) => {
    const patchIdByRef = importPatchPresets(preset.patches);
    const nextTracks = preset.tracks.map((track) => importPatternTrack(track, patchIdByRef));
    prevTrackIdsRef.current = nextTracks.map((track) => track.id);
    setTracks(nextTracks);
    setBpm(preset.bpm);
    arr.loadArrangement(importPatternArrangement(preset.arrangement, patchIdByRef), preset.activeSectionIdx);
    setPresetStatus(i18n._({ id: "Loaded pattern preset", message: "Loaded pattern preset" }) + `: ${preset.name}`);
  }, [arr, importPatchPresets]);

  const handleLoadBundledPattern = useCallback((preset: PatternPresetFileV1) => {
    applyPatternPreset(preset);
  }, [applyPatternPreset]);

  const handleLoadPattern = useCallback(async () => {
    const picked = await fileService.selectFiles();
    const path = picked.ok ? picked.data?.[0] : undefined;
    if (!path) return;
    const loaded = await dms.readFile(path);
    const content = loaded.ok ? loaded.data?.content : null;
    if (!content) {
      setPresetStatus(i18n._({ id: "Could not read preset file.", message: "Could not read preset file." }));
      return;
    }
    try {
      const parsed = JSON.parse(content) as unknown;
      if (!isPatternPresetFile(parsed)) {
        setPresetStatus(i18n._({ id: "Selected file is not a pattern preset.", message: "Selected file is not a pattern preset." }));
        return;
      }
      applyPatternPreset(parsed);
    } catch {
      setPresetStatus(i18n._({ id: "Preset file is not valid JSON.", message: "Preset file is not valid JSON." }));
    }
  }, [applyPatternPreset]);

  const handleSavePattern = useCallback(async () => {
    const usedPatchEntries = Array.from(new Set(
      tracks
        .filter((track) => track.instrument === InstrumentType.PatchBlock && track.patchId)
        .map((track) => patchStore.patches.find((entry) => entry.id === track.patchId))
        .filter((entry): entry is NonNullable<typeof entry> => !!entry),
    ));
    const patchRefById = new Map<string, string>();
    const patchPresets = usedPatchEntries.map((entry) => {
      const presetRef = slugifyPresetName(entry.name);
      patchRefById.set(entry.id, presetRef);
      return exportPatchPreset(entry.name, entry.patch, presetRef);
    });
    const preset = exportPatternPreset({
      name: "Audio Pattern",
      bpm,
      activeSectionIdx: arr.activeSectionIdx,
      tracks,
      arrangement: arr.arrangement,
      patchRefById,
      patches: patchPresets,
    });
    const save = await fileService.selectSavePath(`${slugifyPresetName(preset.name)}.sygpattern.json`, "json");
    const path = save.ok ? save.data?.path : undefined;
    if (!path) return;
    const written = await dms.writeFile(path, JSON.stringify(preset, null, 2));
    setPresetStatus(
      written.ok
        ? `${i18n._({ id: "Saved pattern preset", message: "Saved pattern preset" })}: ${path}`
        : (written.error ?? i18n._({ id: "Failed to save pattern preset.", message: "Failed to save pattern preset." }))
    );
  }, [arr.activeSectionIdx, arr.arrangement, bpm, patchStore.patches, tracks]);

  useEffect(() => {
    setTracks(prev => {
      const anySoloed = prev.some(t => t.solo);
      return prev.map(t => ({ ...t, schedulerMuted: anySoloed ? !t.solo : t.mute }));
    });
  }, []);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);


  return (
    <div className="h-full flex flex-col bg-[var(--theme-bg)] overflow-hidden">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--theme-border)]
                      bg-[var(--theme-surface)] shrink-0">
        <span className="text-xs font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
          {i18n._({ id: "Studio", message: "Studio" })}
        </span>
        <span
          className="text-[10px] text-[var(--theme-text-muted)] opacity-70 max-w-[120px] truncate"
          title={projectName}
        >
          {projectName}
        </span>
        <span className="text-[10px] text-[var(--theme-text-muted)] opacity-50">
          {tracks.length} track{tracks.length !== 1 ? "s" : ""}
        </span>

        <div className="flex items-center gap-1 pl-2">
          <span className="text-[9px] uppercase tracking-wider text-[var(--theme-text-muted)]">
            {i18n._({ id: "Examples", message: "Examples" })}
          </span>
          {BUNDLED_PATTERN_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => handleLoadBundledPattern(preset)}
              className="text-[10px] px-2 py-1 rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-primary)] transition-colors"
            >
              {preset.name}
            </button>
          ))}
        </div>

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

        <button
          onClick={() => void handleLoadPattern()}
          className="text-[10px] px-2 py-1 rounded border border-[var(--theme-border)]
                     text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                     hover:border-[var(--theme-primary)] transition-colors font-semibold"
        >
          {i18n._({ id: "Load Pattern", message: "Load Pattern" })}
        </button>

        <button
          onClick={() => void handleSavePattern()}
          className="text-[10px] px-2 py-1 rounded border border-[var(--theme-border)]
                     text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                     hover:border-[var(--theme-primary)] transition-colors font-semibold"
        >
          {i18n._({ id: "Save Pattern", message: "Save Pattern" })}
        </button>

        <button
          onClick={() => setRenderDialogOpen(true)}
          className="text-[10px] px-2 py-1 rounded border border-[var(--theme-border)]
                     text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                     hover:border-[var(--theme-primary)] transition-colors font-semibold"
          title={i18n._({ id: "Offline render to WAV", message: "Offline render to WAV" })}
        >
          {i18n._({ id: "⬇ WAV", message: "⬇ WAV" })}
        </button>
      </div>

      {presetStatus && (
        <div className="px-3 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]/60 text-[10px] text-[var(--theme-text-muted)]">
          {presetStatus}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">

        <ResizablePanel label={i18n._({ id: "Patterns", message: "Patterns" })} side="left" defaultWidth={190} minWidth={150} maxWidth={320}>
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

        <ResizablePanel label={i18n._({ id: "Samples", message: "Samples" })} side="left" defaultWidth={220} minWidth={160} maxWidth={400}>
          <AudioSampleBrowser
            workingDir={workingDir}
            onSampleSelect={handleSampleDrop}
            className="h-full"
          />
        </ResizablePanel>

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
            bpm={bpm}
            onBpmChange={setBpm}
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

        <ResizablePanel label={i18n._({ id: "CSD", message: "CSD" })} side="right" defaultWidth={280} minWidth={180} maxWidth={600} defaultOpen={false}>
          <CsdEditor className="h-full" />
        </ResizablePanel>
      </div>

      {renderDialogOpen && (
        <OfflineRenderDialog
          tracks={tracks}
          bpm={bpm}
          arrangement={arr.arrangement}
          onClose={() => setRenderDialogOpen(false)}
        />
      )}
    </div>
  );
};

export default AudioTimelinePage;
