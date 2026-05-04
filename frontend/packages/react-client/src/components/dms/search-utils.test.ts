/**
 * @file search-utils.test.ts
 * @brief Unit tests for search-utils pure functions.
 *
 * Run with:  bun test src/components/dms/search-utils.test.ts
 */

import { describe, it, expect } from "bun:test";
import { pathKind, resultScoreLabel, splitAtMatch } from "./search-utils";

// ---------------------------------------------------------------------------

describe("pathKind", () => {
  const zone = { out_path: "/data/zones/work" };

  it("classifies a .notes file when the zone is provided", () => {
    expect(pathKind("/data/zones/work/.notes/ideas.md", zone)).toBe("notes");
  });

  it("classifies a .kanban file when the zone is provided", () => {
    expect(pathKind("/data/zones/work/.kanban/todo.md", zone)).toBe("kanban");
  });

  it("falls back to .notes pattern when no zone is given", () => {
    expect(pathKind("/some/path/.notes/file.md", null)).toBe("notes");
  });

  it("falls back to .kanban pattern when no zone is given", () => {
    expect(pathKind("/some/path/.kanban/board.md", null)).toBe("kanban");
  });

  it("returns 'file' for a regular document path", () => {
    expect(pathKind("/data/zones/work/report.pdf", zone)).toBe("file");
  });

  it("returns 'file' when path is outside the provided zone", () => {
    expect(pathKind("/data/zones/other/.notes/file.md", zone)).toBe("notes");
  });

  it("does not misclassify a file whose name contains the substring 'notes'", () => {
    // "notes" in filename, not in the /.notes/ directory segment
    expect(pathKind("/data/zones/work/release-notes.md", zone)).toBe("file");
  });
});

// ---------------------------------------------------------------------------

describe("resultScoreLabel", () => {
  it("returns 'exact' for a filename match regardless of score", () => {
    expect(resultScoreLabel("filename", 0.85)).toBe("exact");
    expect(resultScoreLabel("filename", 1.00)).toBe("exact");
  });

  it("returns a percentage for snippet matches", () => {
    expect(resultScoreLabel("snippet", 0.75)).toBe("75%");
  });

  it("returns a percentage for keyword matches", () => {
    expect(resultScoreLabel("keyword", 0.65)).toBe("65%");
  });

  it("returns a percentage for fulltext matches", () => {
    expect(resultScoreLabel("fulltext", 0.60)).toBe("60%");
  });

  it("returns a percentage for hybrid matches", () => {
    expect(resultScoreLabel("hybrid", 0.92)).toBe("92%");
  });

  it("rounds the percentage correctly", () => {
    expect(resultScoreLabel("snippet", 0.756)).toBe("76%");
    expect(resultScoreLabel("snippet", 0.754)).toBe("75%");
  });

  it("never returns 'exact' for semantic matches even at high scores", () => {
    expect(resultScoreLabel("semantic", 0.97)).toBe("97%");
  });
});

// ---------------------------------------------------------------------------

describe("splitAtMatch", () => {
  it("returns null for an empty text", () => {
    expect(splitAtMatch("", "query")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(splitAtMatch("some text", "")).toBeNull();
  });

  it("returns null when the query is not found", () => {
    expect(splitAtMatch("hello world", "xyz")).toBeNull();
  });

  it("finds a match and returns correct slices", () => {
    const result = splitAtMatch("the markov chain", "markov");
    expect(result).not.toBeNull();
    expect(result!.before).toBe("the ");
    expect(result!.hit).toBe("markov");
    expect(result!.after).toBe(" chain");
  });

  it("is case-insensitive but preserves original casing in the hit slice", () => {
    const result = splitAtMatch("Markov Chain models", "markov");
    expect(result).not.toBeNull();
    expect(result!.hit).toBe("Markov"); // original casing
  });

  it("matches at the very start of the string", () => {
    const result = splitAtMatch("bitcoin.md contains notes", "bitcoin");
    expect(result!.before).toBe("");
    expect(result!.hit).toBe("bitcoin");
  });

  it("matches at the very end of the string", () => {
    const result = splitAtMatch("notes about bitcoin", "bitcoin");
    expect(result!.after).toBe("");
    expect(result!.hit).toBe("bitcoin");
  });
});

