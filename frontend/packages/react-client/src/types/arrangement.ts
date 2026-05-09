/**
 * arrangement.ts — Song-level Pattern Arranger types.
 *
 * A "Pattern" in the Pattern Arranger is an ArrangementSection — a named
 * portion of the song (PTN_01, PTN_02, …) that:
 *   - contains per-track slot overrides (mute/unmute)
 *   - is reference-based by default (no track data copied)
 *   - gets a local track copy only when the user edits its pattern
 *   - loops `repeatCount` times before the arranger advances
 */

import type { AudioTrack } from './audio';

/**
 * A track slot in one section. By default it just holds a reference
 * (trackId + mute flag). When the user edits this slot's notes, the
 * original track is deep-cloned into `localCopy` so the global track
 * is not affected.
 */
export interface SectionTrackSlot {
  trackId: string;
  mute:    boolean;
  /** Present only after the user has edited this slot's pattern */
  localCopy?: AudioTrack;
}

/**
 * A named section of the song — one "Block" in the Block Arranger.
 * The sequencer plays through `repeatCount` full cycles of the step
 * pattern before moving to the next section.
 */
export interface ArrangementSection {
  id:          string;
  name:        string;   // e.g. "PTN_01", "PTN_02"
  repeatCount: number;   // ≥ 1
  trackSlots:  SectionTrackSlot[];
}

export interface Arrangement {
  sections:        ArrangementSection[];
  /** When true, restart from section 0 after the last section plays */
  loopArrangement: boolean;
}

export function makeSection(name: string, trackIds: string[]): ArrangementSection {
  return {
    id:          Math.random().toString(36).slice(2, 10),
    name,
    repeatCount: 1,
    trackSlots:  trackIds.map(trackId => ({ trackId, mute: false })),
  };
}

export function makeArrangement(trackIds: string[]): Arrangement {
  const firstSection = makeSection('PTN_01', trackIds);
  // Default: one section that loops forever (handled externally)
  return {
    sections:        [firstSection],
    loopArrangement: true,
  };
}
