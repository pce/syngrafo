/**
 * PatchEngine
 *
 * Runs a requestAnimationFrame-based routing tick at ~50 Hz:
 *   1. For every block with a Csound instrument: read its output channels
 *      from Csound and cache them in block.outputs.
 *   2. For every PatchCable: read source.outputs[portId], apply SignalTransform,
 *      write the result to the target block's Csound param channel.
 *
 * JS-only blocks (xyPad, scaleQuantizer) bypass the Csound read step;
 * their outputs are written directly via setXYOutput() / setQuantizerOutput().
 *
 * Channel naming convention (must match orcTemplate strings in blockDefs):
 *   Param input:  "{blockId}.{paramId}"
 *   Port output:  "{blockId}.out.{portId}"
 */

import type { Patch, BlockInstance, BlockKind } from './types.ts';
import { applyTransform } from './types.ts';
import { BLOCK_REGISTRY } from './blockDefs.ts';
import type { CsoundEngine } from '../csound/CsoundEngine.ts';

export class PatchEngine {
  private patch:  Patch | null = null;
  private engine: CsoundEngine | null = null;
  private rafId:  number | null = null;
  private lastMs  = 0;
  private readonly intervalMs = 20; // ~50 Hz

  /** Start (or restart) the routing loop with a new patch + engine */
  start(patch: Patch, engine: CsoundEngine): void {
    this.patch  = patch;
    this.engine = engine;
    if (this.rafId === null) this.scheduleLoop();
  }

  /** Hot-swap patch without restarting the loop */
  update(patch: Patch): void {
    this.patch = patch;
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ── JS-only block output setters ─────────────────────────────────────────

  /** Called by the XY Pad UI — writes x/y into block.outputs and Csound channels */
  setXYOutput(blockId: string, x: number, y: number): void {
    const block = this.findBlock(blockId);
    if (!block) return;
    if (!block.outputs) block.outputs = {};
    block.outputs['x'] = x;
    block.outputs['y'] = y;
    this.engine?.setChannel(`${blockId}.out.x`, x);
    this.engine?.setChannel(`${blockId}.out.y`, y);
  }

  /** Called by ScaleQuantizer JS logic — writes quantized pitch to outputs */
  setQuantizerOutput(blockId: string, quantized: number): void {
    const block = this.findBlock(blockId);
    if (!block) return;
    if (!block.outputs) block.outputs = {};
    block.outputs['quantized'] = quantized;
    this.engine?.setChannel(`${blockId}.out.quantized`, quantized);
  }

  // ── Orchestra builder ─────────────────────────────────────────────────────

  /**
   * Build a Csound orchestra string from all blocks in the patch.
   * Call this before CsoundEngine.compileOrc() when starting a session.
   */
  buildOrchestra(patch: Patch): string {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const block of patch.blocks) {
      const def = BLOCK_REGISTRY[block.kind];
      if (!def.orcTemplate) continue;
      // Deduplicate instrument definitions (same kind → same instr name, different id)
      const fragment = def.orcTemplate.replace(/\{\{id\}\}/g, block.id);
      if (!seen.has(fragment)) {
        seen.add(fragment);
        parts.push(fragment);
      }
    }
    return parts.join('\n\n');
  }

  /**
   * Push all current param values of a block to Csound channels.
   * Call after compileOrc() and for every new block added while playing.
   */
  syncBlockParams(block: BlockInstance): void {
    if (!this.engine?.isReady) return;
    for (const [paramId, value] of Object.entries(block.params)) {
      const ch = `${block.id}.${paramId}`;
      if (typeof value === 'number')       this.engine.setChannel(ch, value);
      else if (typeof value === 'boolean') this.engine.setChannel(ch, value ? 1 : 0);
      else if (typeof value === 'string')  this.engine.setStringChannel(ch, value);
    }
  }


  /**
   * Fire a Csound score event for the given block's instrument.
   * Has no effect on JS-only blocks that have an empty orcTemplate.
   *
   * The score event format is:
   *   i "LabelNoSpaces_blockId" 0 <duration>
   */
  triggerBlock(blockId: string, duration = 0.5): void {
    const block = this.patch?.blocks.find(b => b.id === blockId);
    if (!block) return;
    const def = BLOCK_REGISTRY[block.kind];
    if (!def.orcTemplate) return;
    const instrName = def.label.replace(/\s+/g, '');
    this.engine?.inputMessage(`i "${instrName}_${blockId}" 0 ${duration}`);
  }

  /**
   * Trigger the first Csound-based block found in the patch.
   * Useful as a "play the main voice" shortcut when the caller
   * does not need to know which block drives the sound.
   */
  triggerAnyInstrument(duration = 0.5): void {
    if (!this.patch) return;
    const block = this.patch.blocks.find(b => !!BLOCK_REGISTRY[b.kind].orcTemplate);
    if (block) this.triggerBlock(block.id, duration);
  }


  private findBlock(id: string): BlockInstance | undefined {
    return this.patch?.blocks.find(b => b.id === id);
  }

  private scheduleLoop(): void {
    const tick = (now: number) => {
      if (now - this.lastMs >= this.intervalMs) {
        this.lastMs = now;
        void this.tick();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private async tick(): Promise<void> {
    if (!this.patch || !this.engine?.isReady) return;

    // ── Step 1: Read Csound output channels → block.outputs ───────────────
    for (const block of this.patch.blocks) {
      const def = BLOCK_REGISTRY[block.kind];
      if (!def.orcTemplate) continue; // JS-only blocks handle their own outputs
      if (!block.outputs) block.outputs = {};

      for (const portId of Object.keys(def.outputs)) {
        if (def.outputs[portId]?.dataType === 'audio') continue;
        try {
          const val = await this.engine.getChannel(`${block.id}.out.${portId}`);
          block.outputs[portId] = val ?? 0;
        } catch {
          // Instrument may not have started yet — skip silently
        }
      }
    }

    // ── Step 2: Route cables through signal transforms ─────────────────────
    for (const cable of this.patch.cables) {
      const src = this.findBlock(cable.sourceBlockId);
      if (!src?.outputs) continue;

      const raw         = src.outputs[cable.sourcePortId] ?? 0;
      const transformed = applyTransform(raw, cable.transform);

      // Write to Csound channel so the target block's instrument reads it
      this.engine.setChannel(
        `${cable.targetBlockId}.${cable.targetParamId}`,
        transformed,
      );
    }
  }
}

// Suppress unused-import warning: BlockKind is used structurally via BLOCK_REGISTRY
const _: BlockKind | undefined = undefined; void _;

/** Singleton — shared across the whole audio workstation */
export const patchEngine = new PatchEngine();
