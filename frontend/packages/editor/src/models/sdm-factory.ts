/**
 * @file models/sdm-factory.ts
 * Pure factory functions and immutable tree-mutation utilities for the
 * Syngrafo Document Model.  No classes, no signals, no framework deps.
 */

import type {
  SDocument,
  SDocMeta,
  SBlock,
  SBlockType,
  SStyleClass,
  Span,
  SpanMark,
} from "./sdm";

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

export function createDocument(meta?: Partial<SDocMeta>): SDocument {
  const now = nowSecs();
  return {
    $schema: "syngrafo/1",
    id: crypto.randomUUID(),
    meta: {
      title: "",
      created_at: now,
      updated_at: now,
      ...meta,
    },
    page: { size: "a4", orientation: "portrait", margin: "md" },
    styles: {},
    blocks: [createBlock("p")],
  };
}

/**
 * Creates a minimal valid SBlock of the given type.
 * `overrides` is spread last so callers can supply any extra fields, but
 * `type` and `id` are always authoritative and cannot be overridden.
 */
export function createBlock(type: SBlockType, overrides?: Record<string, unknown>): SBlock {
  const id = crypto.randomUUID();
  const x = overrides ?? {};
  switch (type) {
    case "p":
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "quote":
    case "li":
    case "td":
    case "th":
    case "figcaption":
      return { spans: [], ...x, type, id } as SBlock;
    case "ul":
    case "ol":
      return { children: [], ...x, type, id } as SBlock;
    case "code":
      return { text: "", ...x, type, id } as SBlock;
    case "img":
      return { src: "", ...x, type, id } as SBlock;
    case "hr":
    case "pagebreak":
      return { ...x, type, id } as SBlock;
    case "hbox":
    case "vbox":
    case "col":
      return { children: [], ...x, type, id } as SBlock;
    case "grid":
      return { columns: [], children: [], ...x, type, id } as SBlock;
    case "table":
    case "tr":
      return { children: [], ...x, type, id } as SBlock;
    case "callout":
      return { variant: "info", children: [], ...x, type, id } as SBlock;
    default: {
      // TypeScript will flag this if a new SBlockType is added without a case.
      const _exhaustive: never = type;
      throw new Error(`createBlock: unknown type "${_exhaustive}"`);
    }
  }
}

export function createSpan(text: string, marks?: SpanMark[]): Span {
  if (!marks || marks.length === 0) return { text };
  return { text, marks };
}

/** Deep-clones a block, assigning fresh UUIDs to it and all descendants. */
export function cloneBlock(block: SBlock): SBlock {
  const id = crypto.randomUUID();
  if ("children" in block && Array.isArray((block as { children?: unknown }).children)) {
    const children = (block as unknown as { children: SBlock[] }).children;
    return { ...block, id, children: children.map(cloneBlock) } as SBlock;
  }
  return { ...block, id };
}

/** Returns the block's children array if present, otherwise null. */
function getChildren(block: SBlock): SBlock[] | null {
  if ("children" in block && Array.isArray((block as { children?: unknown }).children)) {
    return (block as unknown as { children: SBlock[] }).children;
  }
  return null;
}

/** Structural-share helper: returns a new block with children replaced. */
function withChildren(block: SBlock, children: SBlock[]): SBlock {
  return { ...block, children } as SBlock;
}

/** Returns a flat array of every block and all their descendants. */
export function flattenBlocks(blocks: SBlock[]): SBlock[] {
  const result: SBlock[] = [];
  function walk(bs: SBlock[]): void {
    for (const b of bs) {
      result.push(b);
      const ch = getChildren(b);
      if (ch) walk(ch);
    }
  }
  walk(blocks);
  return result;
}

/** Depth-first search. Returns the block or null if not found. */
export function findBlock(blocks: SBlock[], id: string): SBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    const ch = getChildren(block);
    if (ch) {
      const found = findBlock(ch, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns a new array with the target block replaced by `updater(block)`.
 * Only allocates new arrays/objects on the path to the mutated node.
 * If the id is not found, the original array reference is returned unchanged.
 */
export function updateBlock(
  blocks: SBlock[],
  id: string,
  updater: (b: SBlock) => SBlock,
): SBlock[] {
  let mutated = false;
  const result = blocks.map(block => {
    if (block.id === id) {
      const next = updater(block);
      if (next !== block) mutated = true;
      return next;
    }
    const ch = getChildren(block);
    if (ch) {
      const nextCh = updateBlock(ch, id, updater);
      if (nextCh !== ch) {
        mutated = true;
        return withChildren(block, nextCh);
      }
    }
    return block;
  });
  return mutated ? result : blocks;
}

/**
 * Top-level insertion only — does not recurse into children.
 * If `afterId` is undefined or not found at the top level, the block is appended.
 */
export function insertBlock(blocks: SBlock[], block: SBlock, afterId?: string): SBlock[] {
  if (afterId === undefined) return [...blocks, block];
  const idx = blocks.findIndex(b => b.id === afterId);
  if (idx === -1) return [...blocks, block];
  return [...blocks.slice(0, idx + 1), block, ...blocks.slice(idx + 1)];
}

/** Removes the block with the given id anywhere in the tree. */
export function deleteBlock(blocks: SBlock[], id: string): SBlock[] {
  let mutated = false;
  const result: SBlock[] = [];
  for (const block of blocks) {
    if (block.id === id) {
      mutated = true;
      continue;
    }
    const ch = getChildren(block);
    if (ch) {
      const nextCh = deleteBlock(ch, id);
      if (nextCh !== ch) {
        mutated = true;
        result.push(withChildren(block, nextCh));
        continue;
      }
    }
    result.push(block);
  }
  return mutated ? result : blocks;
}

/**
 * Moves a block up or down among its top-level siblings.
 * Returns the same reference if the block is already at the boundary or not found.
 */
export function moveBlock(blocks: SBlock[], id: string, direction: "up" | "down"): SBlock[] {
  const idx = blocks.findIndex(b => b.id === id);
  if (idx === -1) return blocks;
  if (direction === "up" && idx === 0) return blocks;
  if (direction === "down" && idx === blocks.length - 1) return blocks;
  const arr = [...blocks];
  const swap = direction === "up" ? idx - 1 : idx + 1;
  [arr[idx], arr[swap]] = [arr[swap]!, arr[idx]!];
  return arr;
}

/** Finds by id at the top level, inserts a deep-cloned copy immediately after it. */
export function duplicateBlock(blocks: SBlock[], id: string): SBlock[] {
  const idx = blocks.findIndex(b => b.id === id);
  if (idx === -1) return blocks;
  const clone = cloneBlock(blocks[idx]!);
  return [...blocks.slice(0, idx + 1), clone, ...blocks.slice(idx + 1)];
}

/** Replaces the children array of the block with the given id. */
export function setChildren(blocks: SBlock[], id: string, children: SBlock[]): SBlock[] {
  return updateBlock(blocks, id, b => withChildren(b, children));
}

/**
 * Applies a blocks transformation to a document, updating `meta.updated_at`.
 * If `fn` returns the same blocks reference, the original document is returned unchanged.
 */
export function applyDocMutations(
  doc: SDocument,
  fn: (blocks: SBlock[]) => SBlock[],
): SDocument {
  const nextBlocks = fn(doc.blocks);
  if (nextBlocks === doc.blocks) return doc;
  return {
    ...doc,
    blocks: nextBlocks,
    meta: { ...doc.meta, updated_at: nowSecs() },
  };
}

export function addStyle(doc: SDocument, id: string, cls: SStyleClass): SDocument {
  return { ...doc, styles: { ...doc.styles, [id]: cls } };
}

export function removeStyle(doc: SDocument, id: string): SDocument {
  if (!(id in doc.styles)) return doc;
  const styles = { ...doc.styles };
  delete styles[id];
  return { ...doc, styles };
}
