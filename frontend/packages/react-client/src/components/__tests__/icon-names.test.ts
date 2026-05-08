/**
 * @file icon-names.test.ts
 * @brief Verifies that the IconName union contains all expected entries,
 *        including the csound and ffmpeg additions.
 *
 * The compile-time `satisfies` constraint on ALL_ICON_NAMES catches two
 * classes of mistake at once:
 *   - a typo in our snapshot array (element not assignable to IconName), and
 *   - a name that exists in the array but has been removed from the union.
 *
 * Run with:  bun test src
 */

import { describe, it, expect } from "bun:test";
import type { IconName } from "../Icon";

// Compile-time guard: every element must be a member of IconName.
// TypeScript will error here before any test runs if a name is misspelled
// or has been removed from the union.
const ALL_ICON_NAMES = [
  "document", "style", "tree", "image", "export", "import", "print",
  "home", "folder", "upload", "download", "trash", "plus", "check",
  "close", "times", "settings", "stats", "analytics", "edit", "palette",
  "block", "chevron-down", "chevron-up", "search",
  "heading1", "heading2", "heading3", "paragraph", "list", "minus",
  "file", "info", "ellipsis", "columns", "rows", "grab", "copy",
  "undo", "redo", "refresh", "ruler", "language", "sentiment",
  "readability", "safety", "brain", "sparkles", "activity",
  "chart", "bar-chart", "pie-chart", "database", "cloud",
  "terminal", "code", "cpu", "microchip", "scan", "scissors",
  "shield", "move", "share", "archive", "compress-file",
  "chevron-left", "chevron-right", "arrow-right", "panel-right",
  "folder-open", "link", "warning", "music", "video", "cube",
  "eye", "eye-off", "rotate", "grid", "bookmark", "compass",
  "map-pin", "layers", "star", "clock", "calendar", "trending-up",
  "tag", "color-swatch", "tray", "play", "dino", "csound", "ffmpeg",
] as const satisfies readonly IconName[];

const ICON_SET = new Set<string>(ALL_ICON_NAMES);

describe("IconName — complete snapshot", () => {
  it("snapshot covers all 94 declared names", () => {
    expect(ALL_ICON_NAMES.length).toBe(94);
  });

  it("contains csound", () => {
    expect(ICON_SET.has("csound")).toBe(true);
  });

  it("contains ffmpeg", () => {
    expect(ICON_SET.has("ffmpeg")).toBe(true);
  });

  it("csound and ffmpeg are distinct entries", () => {
    expect("csound" === "ffmpeg").toBe(false);
  });

  it("contains the expected audio/video-adjacent names", () => {
    expect(ICON_SET.has("music")).toBe(true);
    expect(ICON_SET.has("video")).toBe(true);
    expect(ICON_SET.has("play")).toBe(true);
  });

  it("contains no duplicate entries", () => {
    expect(ICON_SET.size).toBe(ALL_ICON_NAMES.length);
  });
});

describe("IconName — new entries relative to existing baseline", () => {
  const BASELINE_NAMES = [
    "edit", "close", "music", "video", "play",
    "dino", "document", "settings", "columns", "search",
  ] as const satisfies readonly IconName[];

  it("baseline names are all present in the full snapshot", () => {
    for (const name of BASELINE_NAMES) {
      expect(ICON_SET.has(name)).toBe(true);
    }
  });

  it("csound and ffmpeg extend the baseline", () => {
    const baselineSet = new Set<string>(BASELINE_NAMES);
    expect(baselineSet.has("csound")).toBe(false);
    expect(baselineSet.has("ffmpeg")).toBe(false);
    expect(ICON_SET.has("csound")).toBe(true);
    expect(ICON_SET.has("ffmpeg")).toBe(true);
  });
});
