/**
 * useArrangement — manages the section/block arranger state.
 *
 * - Keeps the arrangement (list of sections, active section index, repeat counter)
 * - Exposes helpers to add/remove/reorder sections, toggle slot mutes, etc.
 * - Provides `sectionMutes` (Map<trackId, boolean>) for the current section
 * - Exposes `onCycleComplete` handler to be called by AudioTimeline each loop
 * - Copy-on-write: `editSlotNotes` deep-clones the global track into the slot
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import type { AudioTrack } from '../types/audio';
import type { Arrangement, ArrangementSection, SectionTrackSlot } from '../types/arrangement';
import { makeSection, makeArrangement } from '../types/arrangement';

export interface UseArrangementReturn {
  arrangement:     Arrangement;
  activeSectionIdx: number;
  activeSection:   ArrangementSection | null;
  /** Map<trackId, boolean> — true = muted by current section slot */
  sectionMutes:    Map<string, boolean>;
  /** Create the initial arrangement from the current tracks */
  initArrangement: (trackIds: string[]) => void;
  /** Add a new empty section (clones slot list from first section) */
  addSection:      (name?: string) => void;
  /** Remove a section by id */
  removeSection:   (sectionId: string) => void;
  /** Move a section up or down in the list */
  moveSection:     (sectionId: string, direction: 'up' | 'down') => void;
  /** Rename a section */
  renameSection:   (sectionId: string, name: string) => void;
  /** Set how many times a section repeats */
  setRepeatCount:  (sectionId: string, count: number) => void;
  /** Toggle mute of a track slot within a section */
  toggleSlotMute:  (sectionId: string, trackId: string) => void;
  /** Called by AudioTimeline each time the step sequencer wraps a full cycle.
   *  Advances the repeat counter; when exhausted, moves to next section. */
  onCycleComplete: () => void;
  /** When a track slot is about to be edited, promote it to a local copy */
  promoteSlotCopy: (sectionId: string, trackId: string, globalTrack: AudioTrack) => void;
  /** Returns the effective AudioTrack for a slot (local copy or global) */
  resolveSlot:     (sectionId: string, trackId: string, globalTracks: AudioTrack[]) => AudioTrack | undefined;
  /** Sync slot list when global tracks change (add/remove tracks) */
  syncTracks:      (trackIds: string[]) => void;
  /** Jump to a specific section index (for manual navigation) */
  goToSection:         (idx: number) => void;
  /** Toggle whether the arrangement loops back to section 0 after the last */
  setLoopArrangement:  (loop: boolean) => void;
  /** Replace the entire arrangement from a preset/load action. */
  loadArrangement:     (arrangement: Arrangement, activeSectionIdx?: number) => void;
}

export function useArrangement(): UseArrangementReturn {
  const [arrangement,      setArrangement]      = useState<Arrangement>(() => makeArrangement([]));
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const repeatCounterRef = useRef(0); // how many cycles the active section has played

  // ── Helpers ─────────────────────────────────────────────────────────────

  const activeSection = useMemo<ArrangementSection | null>(
    () => arrangement.sections[activeSectionIdx] ?? null,
    [arrangement.sections, activeSectionIdx],
  );

  const sectionMutes = useMemo<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    if (!activeSection) return m;
    for (const slot of activeSection.trackSlots) {
      if (slot.mute) m.set(slot.trackId, true);
    }
    return m;
  }, [activeSection]);

  // ── Init / sync ──────────────────────────────────────────────────────────

  const initArrangement = useCallback((trackIds: string[]) => {
    setArrangement(makeArrangement(trackIds));
    setActiveSectionIdx(0);
    repeatCounterRef.current = 0;
  }, []);

  const syncTracks = useCallback((trackIds: string[]) => {
    setArrangement(prev => {
      const sections = prev.sections.map(section => {
        // Add slots for new tracks
        const existingIds = new Set(section.trackSlots.map(s => s.trackId));
        const newSlots = trackIds
          .filter(id => !existingIds.has(id))
          .map(id => ({ trackId: id, mute: false } satisfies SectionTrackSlot));
        // Remove slots for deleted tracks
        const pruned = section.trackSlots.filter(s => trackIds.includes(s.trackId));
        return { ...section, trackSlots: [...pruned, ...newSlots] };
      });
      return { ...prev, sections };
    });
  }, []);

  // ── Section management ────────────────────────────────────────────────────

  const addSection = useCallback((name?: string) => {
    setArrangement(prev => {
      const baseSlotsFrom = prev.sections[0];
      const slotIds = baseSlotsFrom
        ? baseSlotsFrom.trackSlots.map(s => s.trackId)
        : [];
      const n = prev.sections.length + 1;
      const newName = name ?? `PTN_${n.toString().padStart(2, '0')}`;
      const section = makeSection(newName, slotIds);
      return { ...prev, sections: [...prev.sections, section] };
    });
  }, []);

  const removeSection = useCallback((sectionId: string) => {
    setArrangement(prev => {
      const sections = prev.sections.filter(s => s.id !== sectionId);
      return { ...prev, sections: sections.length ? sections : prev.sections };
    });
    setActiveSectionIdx(prev => Math.max(0, prev - 1));
  }, []);

  const moveSection = useCallback((sectionId: string, direction: 'up' | 'down') => {
    setArrangement(prev => {
      const idx = prev.sections.findIndex(s => s.id === sectionId);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.sections.length) return prev;
      const sections = [...prev.sections];
      [sections[idx], sections[targetIdx]] = [sections[targetIdx]!, sections[idx]!];
      return { ...prev, sections };
    });
  }, []);

  const renameSection = useCallback((sectionId: string, name: string) => {
    setArrangement(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === sectionId ? { ...s, name } : s),
    }));
  }, []);

  const setRepeatCount = useCallback((sectionId: string, count: number) => {
    setArrangement(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id === sectionId ? { ...s, repeatCount: Math.max(1, count) } : s
      ),
    }));
  }, []);

  // ── Slot management ───────────────────────────────────────────────────────

  const toggleSlotMute = useCallback((sectionId: string, trackId: string) => {
    setArrangement(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id !== sectionId ? s : {
          ...s,
          trackSlots: s.trackSlots.map(slot =>
            slot.trackId === trackId ? { ...slot, mute: !slot.mute } : slot
          ),
        }
      ),
    }));
  }, []);

  const promoteSlotCopy = useCallback((sectionId: string, trackId: string, globalTrack: AudioTrack) => {
    setArrangement(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id !== sectionId ? s : {
          ...s,
          trackSlots: s.trackSlots.map(slot =>
            slot.trackId !== trackId ? slot : {
              ...slot,
              localCopy: structuredClone(globalTrack),
            }
          ),
        }
      ),
    }));
  }, []);

  const resolveSlot = useCallback((
    sectionId: string, trackId: string, globalTracks: AudioTrack[],
  ): AudioTrack | undefined => {
    const section = arrangement.sections.find(s => s.id === sectionId);
    const slot    = section?.trackSlots.find(s => s.trackId === trackId);
    if (!slot) return globalTracks.find(t => t.id === trackId);
    return slot.localCopy ?? globalTracks.find(t => t.id === trackId);
  }, [arrangement.sections]);

  // ── Cycle / playback advance ──────────────────────────────────────────────

  const onCycleComplete = useCallback(() => {
    setArrangement(prev => {
      const section = prev.sections[activeSectionIdx];
      if (!section) return prev;
      const nextCount = repeatCounterRef.current + 1;
      if (nextCount < section.repeatCount) {
        repeatCounterRef.current = nextCount;
        return prev; // still in the same section
      }
      // Move to next section
      repeatCounterRef.current = 0;
      const nextIdx = activeSectionIdx + 1;
      if (nextIdx < prev.sections.length) {
        setActiveSectionIdx(nextIdx);
      } else if (prev.loopArrangement) {
        setActiveSectionIdx(0);
      }
      // State is fine; activeSectionIdx updated via setActiveSectionIdx
      return prev;
    });
  }, [activeSectionIdx]);

  const goToSection = useCallback((idx: number) => {
    setActiveSectionIdx(idx);
    repeatCounterRef.current = 0;
  }, []);

  const setLoopArrangement = useCallback((loop: boolean) => {
    setArrangement(prev => ({ ...prev, loopArrangement: loop }));
  }, []);

  const loadArrangement = useCallback((nextArrangement: Arrangement, nextActiveSectionIdx = 0) => {
    setArrangement(structuredClone(nextArrangement));
    setActiveSectionIdx(Math.max(0, nextActiveSectionIdx));
    repeatCounterRef.current = 0;
  }, []);

  return {
    arrangement,
    activeSectionIdx,
    activeSection,
    sectionMutes,
    initArrangement,
    addSection,
    removeSection,
    moveSection,
    renameSection,
    setRepeatCount,
    toggleSlotMute,
    onCycleComplete,
    promoteSlotCopy,
    resolveSlot,
    syncTracks,
    goToSection,
    setLoopArrangement,
    loadArrangement,
  };
}
