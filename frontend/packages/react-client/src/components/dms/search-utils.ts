/**
 * @file search-utils.ts
 * @brief Pure helper functions for the search result UI.
 *
 * Extracted from SearchResults.tsx so they can be imported and unit-tested
 * independently of the React component tree.
 */

import type { Zone } from "@/services/dms-service.ts";

/**
 * Classify a result path into its content category.
 *
 * @param path - Absolute path of the search result.
 * @param zone - Currently active zone, used to detect `.notes` / `.kanban` subdirs.
 * @returns `"notes"` | `"kanban"` | `"file"`
 */
export function pathKind(
  path: string,
  zone: Pick<Zone, "out_path"> | null,
): "notes" | "kanban" | "file" {
  if (zone) {
    if (path.startsWith(zone.out_path + "/.notes")) return "notes";
    if (path.startsWith(zone.out_path + "/.kanban")) return "kanban";
  }
  if (path.includes("/.notes/")) return "notes";
  if (path.includes("/.kanban/")) return "kanban";
  return "file";
}

/**
 * Derive the human-readable score label for a search result.
 *
 * @param match - Match type returned by the backend ("filename" | "snippet" | etc.).
 * @param score - Relevance score in [0, 1].
 * @returns `"exact"` for filename matches; `"XX%"` for all other match types.
 */
export function resultScoreLabel(match: string, score: number): string {
  if (match === "filename") return "exact";
  return `${Math.round(score * 100)}%`;
}

/**
 * Find the first occurrence of `query` inside `text` (case-insensitive).
 *
 * @returns `{ before, hit, after }` slices, or `null` if not found.
 */
export function splitAtMatch(
  text: string,
  query: string,
): { before: string; hit: string; after: string } | null {
  if (!text || !query) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return null;
  return {
    before: text.slice(0, idx),
    hit:    text.slice(idx, idx + query.length),
    after:  text.slice(idx + query.length),
  };
}

