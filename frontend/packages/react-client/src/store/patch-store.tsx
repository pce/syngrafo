/**
 * patch-store.tsx — Shared registry of named patches across the Audio Portal.
 *
 * Provides PatchStoreProvider + usePatchStore().
 * The PatchWorkstation uses this to expose its patch definitions to the
 * StepSequencer (which can use them as PatchBlock instruments).
 */

import React, {
  createContext, useContext, useState, useCallback, useRef, useMemo,
} from 'react';
import type { Patch } from '@syngrafo/audio';
import { makeEmptyPatch } from '@syngrafo/audio';
import { generateName } from '@syngrafo/shared';

export interface PatchRegistryEntry {
  id:    string;
  name:  string;
  patch: Patch;
}

/** Runtime callbacks registered by PatchWorkstation when its engine is live */
export interface PatchRuntime {
  /** Trigger the patch's main instrument */
  trigger: (blockId?: string, duration?: number) => void;
  isPlaying: boolean;
}

export interface PatchStoreCtx {
  patches:           PatchRegistryEntry[];
  /** Create a new empty patch entry */
  createPatch:       (name?: string) => PatchRegistryEntry;
  /** Overwrite the patch data for an existing entry */
  updatePatch:       (id: string, patch: Patch) => void;
  renamePatch:       (id: string, name: string) => void;
  removePatch:       (id: string) => void;
  /** Called by PatchWorkstation to register live engine callbacks */
  registerRuntime:   (patchId: string, runtime: PatchRuntime) => void;
  unregisterRuntime: (patchId: string) => void;
  /** Trigger a patch's sound (delegates to registered runtime if available) */
  triggerPatch:      (patchId: string, blockId?: string, duration?: number) => void;
  runtimeOf:         (patchId: string) => PatchRuntime | undefined;
}

const PatchStoreContext = createContext<PatchStoreCtx | null>(null);

export function PatchStoreProvider({ children }: { children: React.ReactNode }) {
  const [patches, setPatches] = useState<PatchRegistryEntry[]>([]);
  const runtimes = useRef<Map<string, PatchRuntime>>(new Map());

  const createPatch = useCallback((name = generateName()): PatchRegistryEntry => {
    const id = Math.random().toString(36).slice(2, 10);
    const entry: PatchRegistryEntry = { id, name, patch: makeEmptyPatch(name) };
    setPatches(prev => [...prev, entry]);
    return entry;
  }, []);

  const updatePatch = useCallback((id: string, patch: Patch) => {
    setPatches(prev => prev.map(e => e.id === id ? { ...e, patch } : e));
  }, []);

  const renamePatch = useCallback((id: string, name: string) => {
    setPatches(prev => prev.map(e => e.id === id ? { ...e, name } : e));
  }, []);

  const removePatch = useCallback((id: string) => {
    runtimes.current.delete(id);
    setPatches(prev => prev.filter(e => e.id !== id));
  }, []);

  const registerRuntime = useCallback((patchId: string, runtime: PatchRuntime) => {
    runtimes.current.set(patchId, runtime);
  }, []);

  const unregisterRuntime = useCallback((patchId: string) => {
    runtimes.current.delete(patchId);
  }, []);

  const triggerPatch = useCallback((patchId: string, blockId?: string, duration = 0.5) => {
    runtimes.current.get(patchId)?.trigger(blockId, duration);
  }, []);

  const runtimeOf = useCallback((patchId: string) => runtimes.current.get(patchId), []);

  const ctx = useMemo<PatchStoreCtx>(() => ({
    patches, createPatch, updatePatch, renamePatch, removePatch,
    registerRuntime, unregisterRuntime, triggerPatch, runtimeOf,
  }), [patches, createPatch, updatePatch, renamePatch, removePatch,
       registerRuntime, unregisterRuntime, triggerPatch, runtimeOf]);

  return <PatchStoreContext.Provider value={ctx}>{children}</PatchStoreContext.Provider>;
}

export function usePatchStore(): PatchStoreCtx {
  const ctx = useContext(PatchStoreContext);
  if (!ctx) throw new Error('usePatchStore must be used inside PatchStoreProvider');
  return ctx;
}
