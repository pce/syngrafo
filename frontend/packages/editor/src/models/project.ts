/**
 * @file models/project.ts
 * SDM JSON serialisation — encode/decode SDocument to/from a JSON string.
 * Also exposes lower-level utilities for fragment import and id-repair.
 */

import type { SBlock, SDocument } from "./sdm";

/**
 * Serializes a document to JSON, stripping all runtime-only `nlp` annotations
 * from every block so they are not persisted.
 */
export function encodeDocument(doc: SDocument): string {
  return JSON.stringify(
    doc,
    (key, value) => (key === "nlp" ? undefined : value),
    2,
  );
}

/**
 * Parses a JSON string and returns a validated SDocument.
 * Throws a descriptive Error if the JSON is invalid or the schema tag is missing/wrong.
 */
export function decodeDocument(json: string): SDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`decodeDocument: invalid JSON — ${(e as Error).message}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>)["$schema"] !== "syngrafo/1"
  ) {
    const got = (parsed as Record<string, unknown> | null | undefined)?.["$schema"] ?? "missing";
    throw new Error(`decodeDocument: expected $schema "syngrafo/1", got "${got}".`);
  }
  return assignMissingIds(parsed as SDocument);
}

/**
 * Walks every block (recursively) and fills in a fresh UUID for any block
 * that is missing an `id` field.  Returns the original document reference
 * unchanged if no ids were added — useful for importing externally authored
 * or hand-written SDM files.
 */
export function assignMissingIds(doc: SDocument): SDocument {
  const blocks = fillIds(doc.blocks);
  if (blocks === doc.blocks) return doc;
  return { ...doc, blocks };
}

function fillIds(blocks: SBlock[]): SBlock[] {
  let changed = false;
  const result = blocks.map(b => {
    const withId: SBlock = b.id ? b : { ...b, id: crypto.randomUUID() } as SBlock;
    const hadId = withId === b;

    // Recurse into any children array.
    if ("children" in withId && Array.isArray((withId as { children?: unknown }).children)) {
      const orig = (withId as unknown as { children: SBlock[] }).children;
      const next = fillIds(orig);
      if (next !== orig) {
        changed = true;
        return { ...withId, children: next } as SBlock;
      }
    }
    if (!hadId) changed = true;
    return withId;
  });
  return changed ? result : blocks;
}

/**
 * Parses a raw JSON value (string or already-parsed array) as an SBlock[].
 * Assigns missing ids.  Throws if the value is not an array.
 *
 * Typical use: import a blocks fragment exported from another document or
 * pasted from an external source, then dispatch IMPORT_BLOCKS.
 */
export function blocksFromJson(raw: string | unknown): SBlock[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`blocksFromJson: invalid JSON — ${(e as Error).message}`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `blocksFromJson: expected a JSON array of blocks, got ${
        parsed === null ? "null" : typeof parsed
      }.`,
    );
  }
  return fillIds(parsed as SBlock[]);
}
