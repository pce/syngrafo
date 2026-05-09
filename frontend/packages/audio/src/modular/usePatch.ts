import { useState, useCallback, useEffect, useRef } from 'react';
import type { Patch, BlockInstance, PatchCable, BlockKind, ParamValue, SignalTransform } from './types.ts';
import { makeEmptyPatch, instantiateBlock, DEFAULT_TRANSFORM } from './types.ts';
import { BLOCK_REGISTRY } from './blockDefs.ts';
import { patchEngine } from './PatchEngine.ts';
import { CsoundEngine } from '../csound/CsoundEngine.ts';
import type { EngineState } from '../csound/CsoundEngine.ts';

export interface UsePatchReturn {
  patch:             Patch;
  addBlock:          (kind: BlockKind, label?: string) => BlockInstance;
  removeBlock:       (blockId: string) => void;
  setParam:          (blockId: string, paramId: string, value: ParamValue) => void;
  addCable:          (src: string, srcPort: string, tgt: string, tgtParam: string, t?: SignalTransform) => PatchCable;
  removeCable:       (cableId: string) => void;
  setCableTransform: (cableId: string, transform: SignalTransform) => void;
  /** Returns the cable driving a given target param, or undefined */
  cableAt:           (targetBlockId: string, targetParamId: string) => PatchCable | undefined;
  /** All cables sourced from a given block+port */
  cablesFrom:        (sourceBlockId: string, sourcePortId: string) => PatchCable[];
  startEngine:       () => Promise<void>;
  stopEngine:        () => Promise<void>;
  /** Trigger a block's instrument with a score event */
  trigger:           (blockId: string, duration?: number) => void;
  /** XY Pad output setter (JS-only, no Csound) */
  setXY:             (blockId: string, x: number, y: number) => void;
  loadPatch:         (patch: Patch) => void;
  isPlaying:         boolean;
  engineState:       EngineState;
}

export function usePatch(initialPatch?: Patch): UsePatchReturn {
  const [patch,       setPatch]       = useState<Patch>(() => initialPatch ?? makeEmptyPatch());
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [engineState, setEngineState] = useState<EngineState>('idle');
  const engineRef = useRef<CsoundEngine | null>(null);

  // Keep patchEngine in sync whenever React state changes
  useEffect(() => {
    if (engineRef.current) patchEngine.update(patch);
  }, [patch]);

  // ── Block management ────────────────────────────────────────────────────

  const addBlock = useCallback((kind: BlockKind, label?: string): BlockInstance => {
    const def   = BLOCK_REGISTRY[kind];
    const block = instantiateBlock(kind, def, label);
    setPatch(p => ({ ...p, blocks: [...p.blocks, block] }));
    if (engineRef.current?.isReady) patchEngine.syncBlockParams(block);
    return block;
  }, []);

  const removeBlock = useCallback((blockId: string) => {
    setPatch(p => ({
      ...p,
      blocks: p.blocks.filter(b => b.id !== blockId),
      cables: p.cables.filter(c => c.sourceBlockId !== blockId && c.targetBlockId !== blockId),
    }));
  }, []);

  // ── Param management ────────────────────────────────────────────────────

  const setParam = useCallback((blockId: string, paramId: string, value: ParamValue) => {
    setPatch(p => ({
      ...p,
      blocks: p.blocks.map(b =>
        b.id !== blockId ? b : { ...b, params: { ...b.params, [paramId]: value } }
      ),
    }));
    // Sync to Csound immediately
    const eng = engineRef.current;
    if (eng?.isReady) {
      const ch = `${blockId}.${paramId}`;
      if      (typeof value === 'number')  eng.setChannel(ch, value);
      else if (typeof value === 'boolean') eng.setChannel(ch, value ? 1 : 0);
      else if (typeof value === 'string')  eng.setStringChannel(ch, value);
    }
  }, []);

  // ── Cable management ────────────────────────────────────────────────────

  const addCable = useCallback((
    src: string, srcPort: string,
    tgt: string, tgtParam: string,
    transform: SignalTransform = DEFAULT_TRANSFORM,
  ): PatchCable => {
    const cable: PatchCable = {
      id: Math.random().toString(36).slice(2, 10),
      sourceBlockId: src, sourcePortId: srcPort,
      targetBlockId: tgt, targetParamId: tgtParam,
      transform,
    };
    setPatch(p => {
      // One-to-one: remove any existing cable to the same target param
      const rest = p.cables.filter(
        c => !(c.targetBlockId === tgt && c.targetParamId === tgtParam),
      );
      return { ...p, cables: [...rest, cable] };
    });
    return cable;
  }, []);

  const removeCable = useCallback((cableId: string) => {
    setPatch(p => ({ ...p, cables: p.cables.filter(c => c.id !== cableId) }));
  }, []);

  const setCableTransform = useCallback((cableId: string, transform: SignalTransform) => {
    setPatch(p => ({
      ...p,
      cables: p.cables.map(c => c.id === cableId ? { ...c, transform } : c),
    }));
  }, []);

  const cableAt = useCallback((targetBlockId: string, targetParamId: string) =>
    patch.cables.find(c => c.targetBlockId === targetBlockId && c.targetParamId === targetParamId),
  [patch.cables]);

  const cablesFrom = useCallback((sourceBlockId: string, sourcePortId: string) =>
    patch.cables.filter(c => c.sourceBlockId === sourceBlockId && c.sourcePortId === sourcePortId),
  [patch.cables]);

  // ── Engine management ───────────────────────────────────────────────────

  const startEngine = useCallback(async () => {
    const engine = await CsoundEngine.get({
      useWorker: true,
      useSAB:    true,
      onStateChange: s => setEngineState(s),
    });
    engineRef.current = engine;

    const orc = patchEngine.buildOrchestra(patch);
    if (orc.trim()) await engine.compileOrc(orc);

    for (const block of patch.blocks) patchEngine.syncBlockParams(block);

    patchEngine.start(patch, engine);
    setIsPlaying(true);
  }, [patch]);

  const stopEngine = useCallback(async () => {
    patchEngine.stop();
    await engineRef.current?.stop();
    setIsPlaying(false);
  }, []);

  const trigger = useCallback((blockId: string, duration = 2) => {
    const block = patch.blocks.find(b => b.id === blockId);
    if (!block || !engineRef.current?.isReady) return;
    const def = BLOCK_REGISTRY[block.kind];
    const instrName = `${def.label.replace(/\s/g, '')}_${blockId}`;
    engineRef.current.inputMessage(`i "${instrName}" 0 ${duration}`);
  }, [patch.blocks]);

  const setXY = useCallback((blockId: string, x: number, y: number) => {
    patchEngine.setXYOutput(blockId, x, y);
    setPatch(p => ({
      ...p,
      blocks: p.blocks.map(b =>
        b.id !== blockId ? b : { ...b, outputs: { ...b.outputs, x, y } }
      ),
    }));
  }, []);

  const loadPatch = useCallback((newPatch: Patch) => setPatch(newPatch), []);

  return {
    patch,
    addBlock, removeBlock,
    setParam,
    addCable, removeCable, setCableTransform,
    cableAt, cablesFrom,
    startEngine, stopEngine, trigger,
    setXY,
    loadPatch,
    isPlaying, engineState,
  };
}
