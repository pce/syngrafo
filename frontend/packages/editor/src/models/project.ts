/**
 * @file models/project.ts
 * SDM JSON serialization — encode/decode SDocument to/from a JSON string.
 */

import type { SDocument } from "./sdm";

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
  return parsed as SDocument;
}
