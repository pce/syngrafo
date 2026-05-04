import { Block, BlockType } from "../models/block";
import { DocumentModel } from "../models/document";

export type BlockPatchOp =
  | { op: "create"; afterId: string | null; type: BlockType; content: string; styleId?: string }
  | { op: "update"; id: string; content?: string; styleId?: string }
  | { op: "delete"; id: string }
  | { op: "move"; id: string; afterId: string | null };

/**
 * Result from a block-patch LM call.
 * Distinguishes "intentional no-op" (ops=[]) from "parse failure" (failed=true).
 */
export interface BlockPatchResult {
  /** The operations to apply.  Empty array = intentional no-op. */
  ops: BlockPatchOp[];
  /** true when the model response could not be parsed as valid JSON ops. */
  failed: boolean;
  /** Raw model output for debugging. */
  raw: string;
}

/**
 * A single entry in the compact block sketch sent to the LM.
 * Defined here (not in pdfproj.ts) because it is an LM context concern.
 */
export interface BlockSketchEntry {
  id: string;
  type: string;
  /** The CSS style class applied to this block (e.g. "heading1", "body"). */
  styleId: string;
  /** Plain-text content preview — 200 chars max; HTML tags stripped. */
  preview: string;
}

export interface IBlockOperations {
  /**
   * Parse the model's raw text into a BlockPatchResult.
   * Returns `failed=true` when no valid JSON array is found.
   */
  parseBlockPatch(raw: string): BlockPatchResult;

  /**
   * Apply a BlockPatchOp[] to a DocumentModel **atomically** (one signal fire).
   * Returns the number of operations successfully applied.
   */
  applyBlockPatch(doc: DocumentModel, ops: BlockPatchOp[]): number;

  /**
   * For multi-page documents, return only the blocks on the same page as the
   * focused block.  Falls back to a window of `maxBlocks` around the focus.
   */
  getPageFocusedBlocks(allBlocks: Block[], focusedBlockId: string | null | undefined, maxBlocks?: number): Block[];

  /**
   * Produce a compact "block sketch" array for LM context.
   * Each entry has: { id, type, styleId, preview }
   */
  blocksToSketch(blocks: Block[]): BlockSketchEntry[];
}

export class BlockOperations implements IBlockOperations {
  parseBlockPatch(raw: string): BlockPatchResult {
    let cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");

    if (start === -1 || end === -1 || end < start) {
      console.warn("[BlockOperations.parseBlockPatch] No JSON array found:", cleaned);
      return { ops: [], failed: true, raw };
    }

    cleaned = cleaned.slice(start, end + 1);

    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) {
        return { ops: [], failed: true, raw };
      }
      const valid = parsed.filter((o: unknown) => typeof (o as { op?: unknown })?.op === "string");
      if (valid.length < parsed.length) {
        console.warn("[BlockOperations.parseBlockPatch] Some ops were malformed and skipped");
      }
      return { ops: valid as BlockPatchOp[], failed: false, raw };
    } catch (e) {
      console.warn("[BlockOperations.parseBlockPatch] JSON parse error:", e, "\nraw:", cleaned);
      return { ops: [], failed: true, raw };
    }
  }

  applyBlockPatch(doc: DocumentModel, ops: BlockPatchOp[]): number {
    if (!ops.length) return 0;

    let applied = 0;
    let uid = 0;
    const newId = (type: string) => `lm-patch-${type}-${Date.now()}-${uid++}`;

    // Work on a mutable copy — committed atomically below
    const blocks: Block[] = doc.getBlocks().slice();

    for (const op of ops) {
      try {
        if (op.op === "delete") {
          const idx = blocks.findIndex((b) => b.getId() === op.id);
          if (idx !== -1) {
            blocks.splice(idx, 1);
            applied++;
          }
        } else if (op.op === "update") {
          const b = blocks.find((b) => b.getId() === op.id);
          if (!b) continue;
          if (op.content !== undefined) b.setContent(op.content);
          if (op.styleId !== undefined) b.setStyleId(op.styleId);
          applied++;
        } else if (op.op === "create") {
          const block = new Block(newId(op.type), op.type, op.content, op.styleId);
          if (op.afterId === null) {
            blocks.unshift(block); // prepend to top
          } else {
            const idx = blocks.findIndex((b) => b.getId() === op.afterId);
            blocks.splice(idx === -1 ? blocks.length : idx + 1, 0, block);
          }
          applied++;
        } else if (op.op === "move") {
          const fromIdx = blocks.findIndex((b) => b.getId() === op.id);
          if (fromIdx === -1) continue;
          const [block] = blocks.splice(fromIdx, 1);
          if (!block) continue;
          if (op.afterId === null) {
            blocks.unshift(block);
          } else {
            const toIdx = blocks.findIndex((b) => b.getId() === op.afterId);
            blocks.splice(toIdx === -1 ? blocks.length : toIdx + 1, 0, block);
          }
          applied++;
        }
      } catch (e) {
        console.warn("[BlockOperations.applyBlockPatch] op failed:", op, e);
      }
    }

    // Atomic commit — one signal fire
    doc.setBlocks(blocks);
    return applied;
  }

  getPageFocusedBlocks(allBlocks: Block[], focusedBlockId: string | null | undefined, maxBlocks = 60): Block[] {
    if (!focusedBlockId || allBlocks.length <= maxBlocks) {
      return allBlocks.length <= maxBlocks ? allBlocks : allBlocks.slice(0, maxBlocks);
    }

    // Build page boundary indices
    const pageStarts: number[] = [0];
    allBlocks.forEach((b, i) => {
      if (b.getType() === "pagebreak" && i + 1 < allBlocks.length) {
        pageStarts.push(i + 1);
      }
    });
    pageStarts.push(allBlocks.length); // sentinel

    const focusedIdx = allBlocks.findIndex((b) => b.getId() === focusedBlockId);
    if (focusedIdx === -1) return allBlocks.slice(0, maxBlocks);

    // Find the page the focused block lives on
    let pageStart = 0;
    let pageEnd = allBlocks.length;
    for (let i = 0; i < pageStarts.length - 1; i++) {
      if (focusedIdx >= (pageStarts[i] ?? 0) && focusedIdx < (pageStarts[i + 1] ?? allBlocks.length)) {
        pageStart = pageStarts[i] ?? 0;
        pageEnd = pageStarts[i + 1] ?? allBlocks.length;
        break;
      }
    }

    const pageBlocks = allBlocks.slice(pageStart, pageEnd);
    if (pageBlocks.length <= maxBlocks) return pageBlocks;

    // Page is still too large → take a symmetric window around the focused block
    const relIdx = focusedIdx - pageStart;
    const half = Math.floor(maxBlocks / 2);
    const wStart = Math.max(0, relIdx - half);
    const wEnd = Math.min(pageBlocks.length, wStart + maxBlocks);
    return pageBlocks.slice(wStart, wEnd);
  }

  blocksToSketch(blocks: Block[]): BlockSketchEntry[] {
    return blocks.map((b) => {
      const raw = b
        .getContent()
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        id: b.getId(),
        type: b.getType(),
        styleId: b.getStyleId(),
        preview: raw.length > 200 ? raw.slice(0, 197) + "…" : raw,
      };
    });
  }
}

/**
 * Default singleton — use directly or replace via DI container.
 *
 * @example
 *   // replace for testing:
 *   import { blockOperations } from "./block-patch";
 *   Object.assign(blockOperations, myMockOps);
 */
export const blockOperations: IBlockOperations = new BlockOperations();

export const parseBlockPatch = (raw: string) => blockOperations.parseBlockPatch(raw);
export const applyBlockPatch = (doc: DocumentModel, ops: BlockPatchOp[]) => blockOperations.applyBlockPatch(doc, ops);
export const getPageFocusedBlocks = (blocks: Block[], focusedId: string | null | undefined, max?: number) =>
  blockOperations.getPageFocusedBlocks(blocks, focusedId, max);
export const blocksToSketch = (blocks: Block[]) => blockOperations.blocksToSketch(blocks);
