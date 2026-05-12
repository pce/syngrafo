import {
  GRAINADE_DEF,
  instantiateBlock,
  makeEmptyPatch,
  type Patch,
} from "@syngrafo/audio";
import { InstrumentType, TrackMode, type AudioTrack } from "@/types/audio";
import type { Arrangement, ArrangementSection, SectionTrackSlot } from "@/types/arrangement";

export interface PatchPresetFileV1 {
  version: 1;
  kind: "syngrafo.patch";
  name: string;
  presetRef?: string;
  patch: Patch;
}

export interface PatternTrackPreset {
  id: string;
  name: string;
  mode: TrackMode;
  notes: AudioTrack["notes"];
  length: number;
  color: string;
  solo: boolean;
  mute: boolean;
  schedulerMuted: boolean;
  instrument: InstrumentType;
  octaveOffset: number;
  rootNote?: string;
  scaleName?: string;
  scaleNotes?: string[];
  loopIndependently?: boolean;
  patchRef?: string;
}

export interface PatternSectionTrackSlotPreset {
  trackId: string;
  mute: boolean;
  localCopy?: PatternTrackPreset;
}

export interface PatternSectionPreset {
  id: string;
  name: string;
  repeatCount: number;
  trackSlots: PatternSectionTrackSlotPreset[];
}

export interface PatternArrangementPreset {
  sections: PatternSectionPreset[];
  loopArrangement: boolean;
}

export interface PatternPresetFileV1 {
  version: 1;
  kind: "syngrafo.pattern";
  name: string;
  bpm: number;
  activeSectionIdx: number;
  tracks: PatternTrackPreset[];
  arrangement: PatternArrangementPreset;
  patches?: PatchPresetFileV1[];
}

function makePatchPreset(
  name: string,
  presetRef: string,
  params: Partial<Record<string, number | boolean | string>>,
): PatchPresetFileV1 {
  const block = instantiateBlock("grainade", GRAINADE_DEF, name);
  return {
    version: 1,
    kind: "syngrafo.patch",
    name,
    presetRef,
    patch: {
      ...makeEmptyPatch(name),
      name,
      blocks: [
        {
          ...block,
          params: {
            ...block.params,
            ...params,
          },
        },
      ],
      cables: [],
    },
  };
}

function makePulseTrack(
  id: string,
  name: string,
  length: number,
  steps: number[],
  instrument: InstrumentType,
  color: string,
  patchRef?: string,
): PatternTrackPreset {
  return {
    id,
    name,
    mode: TrackMode.STEP,
    notes: steps.map((time) => ({
      id: `${id}-${time}`,
      pitch: 60,
      time,
      duration: 0.5,
      velocity: 100,
    })),
    length,
    color,
    solo: false,
    mute: false,
    schedulerMuted: false,
    instrument,
    octaveOffset: 0,
    rootNote: "C",
    scaleName: "major",
    scaleNotes: ["C", "D", "E", "F", "G", "A", "B"],
    loopIndependently: true,
    ...(patchRef ? { patchRef } : {}),
  };
}

function makeSingleSection(trackIds: string[]): PatternArrangementPreset {
  return {
    sections: [
      {
        id: "ptn-01",
        name: "PTN_01",
        repeatCount: 1,
        trackSlots: trackIds.map((trackId) => ({ trackId, mute: false })),
      },
    ],
    loopArrangement: true,
  };
}

const WOOD_CLICK_PATCH = makePatchPreset("Wood Click", "wood-click", {
  density: 12,
  grainSize: 14,
  bitCrush: 0.12,
  bitRate: 0.08,
  amplitude: 0.72,
});

const FM_DUST_PATCH = makePatchPreset("FM Dust", "fm-dust", {
  density: 42,
  grainSize: 24,
  position: 0.25,
  amplitude: 0.62,
  bitCrush: 0.2,
});

const DRONE_SPARK_PATCH = makePatchPreset("Drone Spark", "drone-spark", {
  density: 18,
  grainSize: 85,
  position: 0.4,
  amplitude: 0.68,
  drone: true,
  glide: 180,
});

export const BUNDLED_PATTERN_PRESETS: PatternPresetFileV1[] = [
  {
    version: 1,
    kind: "syngrafo.pattern",
    name: "3 over 4",
    bpm: 120,
    activeSectionIdx: 0,
    tracks: [
      makePulseTrack("pulse-4", "4 Pulse", 12, [0, 3, 6, 9], InstrumentType.Sine, "#4a90e2"),
      makePulseTrack("pulse-3", "3 Pulse", 12, [0, 4, 8], InstrumentType.PatchBlock, "#e2574a", "wood-click"),
    ],
    arrangement: makeSingleSection(["pulse-4", "pulse-3"]),
    patches: [WOOD_CLICK_PATCH],
  },
  {
    version: 1,
    kind: "syngrafo.pattern",
    name: "5 over 4",
    bpm: 110,
    activeSectionIdx: 0,
    tracks: [
      makePulseTrack("pulse-4", "4 Pulse", 20, [0, 5, 10, 15], InstrumentType.Square, "#50e3c2"),
      makePulseTrack("pulse-5", "5 Pulse", 20, [0, 4, 8, 12, 16], InstrumentType.PatchBlock, "#9013fe", "fm-dust"),
    ],
    arrangement: makeSingleSection(["pulse-4", "pulse-5"]),
    patches: [FM_DUST_PATCH],
  },
  {
    version: 1,
    kind: "syngrafo.pattern",
    name: "12 vs 16",
    bpm: 96,
    activeSectionIdx: 0,
    tracks: [
      makePulseTrack("triplet-grid", "12 Grid", 12, [0, 3, 6, 9], InstrumentType.Triangle, "#e2c64a"),
      makePulseTrack("straight-grid", "16 Grid", 16, [0, 4, 8, 12], InstrumentType.PatchBlock, "#bd10e0", "drone-spark"),
    ],
    arrangement: makeSingleSection(["triplet-grid", "straight-grid"]),
    patches: [DRONE_SPARK_PATCH],
  },
];

export function slugifyPresetName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "preset";
}

export function exportPatchPreset(name: string, patch: Patch, presetRef?: string): PatchPresetFileV1 {
  return {
    version: 1,
    kind: "syngrafo.patch",
    name,
    ...(presetRef ? { presetRef } : {}),
    patch: structuredClone({ ...patch, name }),
  };
}

export function exportPatternTrack(track: AudioTrack, patchRefById: Map<string, string>): PatternTrackPreset {
  const { patchId, ...rest } = structuredClone(track);
  const presetTrack: PatternTrackPreset = { ...rest };
  if (patchId) {
    const patchRef = patchRefById.get(patchId);
    if (patchRef) presetTrack.patchRef = patchRef;
  }
  return presetTrack;
}

export function exportPatternArrangement(
  arrangement: Arrangement,
  patchRefById: Map<string, string>,
): PatternArrangementPreset {
  return {
    loopArrangement: arrangement.loopArrangement,
    sections: arrangement.sections.map((section) => ({
      id: section.id,
      name: section.name,
      repeatCount: section.repeatCount,
      trackSlots: section.trackSlots.map((slot) => ({
        trackId: slot.trackId,
        mute: slot.mute,
        ...(slot.localCopy ? { localCopy: exportPatternTrack(slot.localCopy, patchRefById) } : {}),
      })),
    })),
  };
}

export function exportPatternPreset(args: {
  name: string;
  bpm: number;
  activeSectionIdx: number;
  tracks: AudioTrack[];
  arrangement: Arrangement;
  patchRefById: Map<string, string>;
  patches: PatchPresetFileV1[];
}): PatternPresetFileV1 {
  return {
    version: 1,
    kind: "syngrafo.pattern",
    name: args.name,
    bpm: args.bpm,
    activeSectionIdx: args.activeSectionIdx,
    tracks: args.tracks.map((track) => exportPatternTrack(track, args.patchRefById)),
    arrangement: exportPatternArrangement(args.arrangement, args.patchRefById),
    patches: args.patches,
  };
}

export function importPatternTrack(track: PatternTrackPreset, patchIdByRef: Map<string, string>): AudioTrack {
  const { patchRef, ...rest } = structuredClone(track);
  const runtimeTrack: AudioTrack = { ...rest };
  if (patchRef) {
    const patchId = patchIdByRef.get(patchRef);
    if (patchId) runtimeTrack.patchId = patchId;
  }
  return runtimeTrack;
}

export function importPatternArrangement(
  arrangement: PatternArrangementPreset,
  patchIdByRef: Map<string, string>,
): Arrangement {
  return {
    loopArrangement: arrangement.loopArrangement,
    sections: arrangement.sections.map((section): ArrangementSection => ({
      id: section.id,
      name: section.name,
      repeatCount: section.repeatCount,
      trackSlots: section.trackSlots.map((slot): SectionTrackSlot => ({
        trackId: slot.trackId,
        mute: slot.mute,
        ...(slot.localCopy ? { localCopy: importPatternTrack(slot.localCopy, patchIdByRef) } : {}),
      })),
    })),
  };
}

export function isPatchPresetFile(value: unknown): value is PatchPresetFileV1 {
  return !!value
    && typeof value === "object"
    && (value as { version?: unknown }).version === 1
    && (value as { kind?: unknown }).kind === "syngrafo.patch";
}

export function isPatternPresetFile(value: unknown): value is PatternPresetFileV1 {
  return !!value
    && typeof value === "object"
    && (value as { version?: unknown }).version === 1
    && (value as { kind?: unknown }).kind === "syngrafo.pattern";
}
