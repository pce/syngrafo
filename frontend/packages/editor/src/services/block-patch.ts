import type { SBlock, SCodeBlock, SImgBlock, Span } from "../models/sdm";
import { isTextBlock } from "../models/sdm";
import { flattenBlocks, updateBlock } from "../models/sdm-factory";

export type BlockPatchOp =
  | { op: "replace";       id: string; content: string }
  | { op: "replace_spans"; id: string; spans: Span[] }
  | { op: "insert";        after_id: string | null; block: SBlock }
  | { op: "delete";        id: string }
  | { op: "move";          id: string; after_id: string | null }
  | { op: "set_style";     id: string; style: string | null }
  | { op: "set_attr";      id: string; key: string; value: unknown };

export interface BlockPatchResult {
  blocks:  SBlock[];
  applied: number;
  errors:  string[];
}

/** Parse a JSON string (LM output) into an op array. Tolerant — skips malformed ops. */
export function parseBlockPatch(raw: string): BlockPatchOp[] {
  let cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  const start = cleaned.indexOf("[");
  const end   = cleaned.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    console.warn("[parseBlockPatch] No JSON array found in:", cleaned.slice(0, 120));
    return [];
  }

  cleaned = cleaned.slice(start, end + 1);

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    const ops: BlockPatchOp[] = [];
    for (const item of parsed) {
      if (typeof item?.op !== "string") {
        console.warn("[parseBlockPatch] Skipping malformed op:", item);
        continue;
      }
      ops.push(item as BlockPatchOp);
    }
    return ops;
  } catch (e) {
    console.warn("[parseBlockPatch] JSON parse error:", e);
    return [];
  }
}

function tryDeleteBlock(
  blocks: SBlock[],
  id: string,
): { blocks: SBlock[]; found: boolean } {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx !== -1) {
    return {
      blocks: [...blocks.slice(0, idx), ...blocks.slice(idx + 1)],
      found: true,
    };
  }

  let found = false;
  const result = blocks.map((b) => {
    if (found) return b;
    const children = (b as { children?: SBlock[] }).children;
    if (Array.isArray(children)) {
      const sub = tryDeleteBlock(children, id);
      if (sub.found) {
        found = true;
        return { ...b, children: sub.blocks } as SBlock;
      }
    }
    return b;
  });
  return { blocks: result, found };
}

/**
 * Insert a block into the flat block list after `after_id`.
 * Different semantics from sdm-factory: supports null (prepend) and cross-level placement.
 */
function patchInsertBlock(
  blocks: SBlock[],
  after_id: string | null,
  block: SBlock,
): SBlock[] {
  if (after_id === null) return [block, ...blocks];
  const idx = blocks.findIndex((b) => b.id === after_id);
  if (idx !== -1) {
    return [...blocks.slice(0, idx + 1), block, ...blocks.slice(idx + 1)];
  }
  return [...blocks, block];
}

/**
 * Move a block to a new position.
 * Different semantics from sdm-factory: supports cross-level moves and null-prepend.
 */
function patchMoveBlock(
  blocks: SBlock[],
  id: string,
  after_id: string | null,
): SBlock[] {
  const target = flattenBlocks(blocks).find((b) => b.id === id);
  if (!target) return blocks;
  const { blocks: without } = tryDeleteBlock(blocks, id);
  return patchInsertBlock(without, after_id, target);
}

/** Apply an array of ops to a block list. Returns new blocks (immutable). */
export function applyBlockPatch(
  blocks: SBlock[],
  ops: BlockPatchOp[],
): BlockPatchResult {
  const errors: string[] = [];
  let applied = 0;
  let current = blocks;

  for (const op of ops) {
    try {
      switch (op.op) {
        case "replace":
          current = updateBlock(current, op.id, (b) =>
            isTextBlock(b) ? { ...b, spans: [{ text: op.content }] } : b,
          );
          applied++;
          break;

        case "replace_spans":
          current = updateBlock(current, op.id, (b) =>
            isTextBlock(b) ? { ...b, spans: op.spans } : b,
          );
          applied++;
          break;

        case "insert":
          current = patchInsertBlock(current, op.after_id, op.block);
          applied++;
          break;

        case "delete": {
          const { blocks: next, found } = tryDeleteBlock(current, op.id);
          if (found) {
            current = next;
            applied++;
          } else {
            errors.push(`delete: block "${op.id}" not found`);
          }
          break;
        }

        case "move":
          current = patchMoveBlock(current, op.id, op.after_id);
          applied++;
          break;

        case "set_style":
          current = updateBlock(current, op.id, (b) => ({
            ...b,
            style: op.style ?? undefined,
          } as SBlock));
          applied++;
          break;

        case "set_attr":
          current = updateBlock(current, op.id, (b) => ({
            ...b,
            [op.key]: op.value,
          } as SBlock));
          applied++;
          break;
      }
    } catch (e) {
      errors.push(
        `op "${op.op}" on "${(op as { id?: string }).id ?? "?"}" failed: ${String(e)}`,
      );
    }
  }

  return { blocks: current, applied, errors };
}

/**
 * Get the text blocks visible on the "current page" based on pagebreak positions.
 * Returns blocks from the last pagebreak (or start) to the next pagebreak (or end).
 */
export function getPageFocusedBlocks(
  blocks: SBlock[],
  currentPage = 0,
): SBlock[] {
  const pages: SBlock[][] = [];
  let page: SBlock[] = [];

  for (const b of blocks) {
    if (b.type === "pagebreak") {
      pages.push(page);
      page = [];
    } else {
      page.push(b);
    }
  }
  pages.push(page);

  const idx = Math.max(0, Math.min(currentPage, pages.length - 1));
  return pages[idx] ?? [];
}

/** Produce a compact text sketch of blocks for LM context. */
export function blocksToSketch(blocks: SBlock[]): string {
  const lines: string[] = [];

  for (const b of flattenBlocks(blocks)) {
    let preview = "";

    if (isTextBlock(b)) {
      preview = b.spans.map((s) => s.text).join("");
    } else if (b.type === "code") {
      preview = (b as SCodeBlock).text;
    } else if (b.type === "img") {
      const img = b as SImgBlock;
      preview = img.alt ?? img.src;
    }

    if (preview.length > 60) preview = `${preview.slice(0, 57)}…`;
    lines.push(`${b.id} [${b.type}] ${preview}`);
  }

  return lines.join("\n");
}
