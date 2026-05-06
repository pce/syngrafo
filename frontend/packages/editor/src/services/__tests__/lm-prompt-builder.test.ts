/**
 * @file services/__tests__/lm-prompt-builder.test.ts
 *
 * Unit tests for LMPromptBuilder (SDM methods) and parseSdmBlocks.
 * Pure functions only — no React, no IPC, no browser DOM required.
 *
 * Run with:  bun test
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  LMPromptBuilder,
  parseSdmBlocks,
  buildSdmDocumentContext,
} from "../lm-prompt-builder";
import type { SBlock, STextBlock, SListBlock, STableBlock } from "../../models/sdm";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** UUID v4 pattern */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const builder = new LMPromptBuilder();

// ─────────────────────────────────────────────────────────────────────────────
// buildSdmCreateSystemPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSdmCreateSystemPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
  });

  test("instructs LM to reply with a JSON array", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    // Must mention the output is a JSON array
    expect(prompt).toContain("JSON array");
    expect(prompt).toContain("[");
    expect(prompt).toContain("]");
  });

  test("forbids markdown fences", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(prompt).toContain("```");   // mentions them in the constraint
    expect(prompt).toMatch(/no\s*```|Zero markdown/i);
  });

  test("documents the p block schema", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(prompt).toContain('"type":"p"');
    expect(prompt).toContain('"spans"');
    expect(prompt).toContain('"text"');
  });

  test("documents heading blocks h1–h4", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(prompt).toContain('"type":"h1"');
    expect(prompt).toContain("h2");
    expect(prompt).toContain("h3");
    expect(prompt).toContain("h4");
  });

  test("documents ul/ol list blocks", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(prompt).toContain('"type":"ul"');
    expect(prompt).toContain('"type":"ol"');
    expect(prompt).toContain('"type":"li"');
  });

  test("documents hr divider", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(prompt).toContain('"type":"hr"');
  });

  test("documents table/tr/td/th blocks", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(prompt).toContain('"type":"table"');
    expect(prompt).toContain('"type":"tr"');
    expect(prompt).toContain('"type":"th"');
    expect(prompt).toContain('"type":"td"');
  });

  test("mentions span marks (bold, italic)", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(prompt).toContain("bold");
    expect(prompt).toContain("italic");
    expect(prompt).toContain('"marks"');
  });

  test("includes skill context when provided", () => {
    const skill = {
      id:           "resume",
      name:         "Resume",
      instructions: "Format the output as a professional one-page resume.",
    };
    const prompt = builder.buildSdmCreateSystemPrompt(skill);
    expect(prompt).toContain("Resume");
    expect(prompt).toContain("professional one-page resume");
  });

  test("works without skill context (null)", () => {
    const prompt = builder.buildSdmCreateSystemPrompt(null);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  test("works without skill context (undefined)", () => {
    const prompt = builder.buildSdmCreateSystemPrompt(undefined);
    expect(typeof prompt).toBe("string");
  });

  test("does not contain skill section when no skill provided", () => {
    const prompt = builder.buildSdmCreateSystemPrompt();
    expect(prompt).not.toContain("Skill:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSdmEditSystemPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSdmEditSystemPrompt", () => {
  const sampleBlocks: SBlock[] = [
    { id: "b1", type: "h1", spans: [{ text: "My Report" }] } as STextBlock,
    { id: "b2", type: "p",  spans: [{ text: "Executive summary goes here." }] } as STextBlock,
  ];

  test("returns a non-empty string", () => {
    const prompt = builder.buildSdmEditSystemPrompt(sampleBlocks);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  test("embeds the document context (block summaries)", () => {
    const prompt = builder.buildSdmEditSystemPrompt(sampleBlocks);
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("h1");
    expect(prompt).toContain("My Report");
    expect(prompt).toContain("[2]");
    expect(prompt).toContain("Executive summary");
  });

  test("instructs LM to return complete document as JSON array", () => {
    const prompt = builder.buildSdmEditSystemPrompt(sampleBlocks);
    expect(prompt).toContain("JSON array");
    expect(prompt).toContain("ALL blocks");
  });

  test("handles empty block array gracefully", () => {
    const prompt = builder.buildSdmEditSystemPrompt([]);
    expect(prompt).toContain("(empty document)");
  });

  test("includes skill context when provided", () => {
    const skill = { id: "invoice", name: "Invoice", instructions: "Keep a formal tone." };
    const prompt = builder.buildSdmEditSystemPrompt(sampleBlocks, skill);
    expect(prompt).toContain("Invoice");
    expect(prompt).toContain("formal tone");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSdmDocumentContext
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSdmDocumentContext", () => {
  test("empty array → placeholder string", () => {
    expect(buildSdmDocumentContext([])).toBe("(empty document)");
  });

  test("indexes blocks starting at 1", () => {
    const blocks: SBlock[] = [
      { id: "a", type: "p", spans: [{ text: "First" }] } as STextBlock,
      { id: "b", type: "p", spans: [{ text: "Second" }] } as STextBlock,
    ];
    const ctx = buildSdmDocumentContext(blocks);
    expect(ctx).toContain("[1]");
    expect(ctx).toContain("[2]");
    expect(ctx).not.toContain("[3]");
  });

  test("heading blocks include type and text", () => {
    const blocks: SBlock[] = [
      { id: "h", type: "h2", spans: [{ text: "Section Title" }] } as STextBlock,
    ];
    expect(buildSdmDocumentContext(blocks)).toContain('h2: "Section Title"');
  });

  test("ul block shows bullet summary", () => {
    const blocks: SBlock[] = [{
      id: "l", type: "ul",
      children: [
        { id: "l1", type: "li", spans: [{ text: "Alpha" }] },
        { id: "l2", type: "li", spans: [{ text: "Beta"  }] },
      ],
    } as SListBlock];
    const ctx = buildSdmDocumentContext(blocks);
    expect(ctx).toContain("• Alpha");
    expect(ctx).toContain("• Beta");
  });

  test("table block shows row count", () => {
    const blocks: SBlock[] = [{
      id: "t", type: "table",
      children: [
        { id: "r1", type: "tr", children: [] },
        { id: "r2", type: "tr", children: [] },
      ],
    } as STableBlock];
    expect(buildSdmDocumentContext(blocks)).toContain("table (2 rows)");
  });

  test("hr block", () => {
    const blocks: SBlock[] = [{ id: "hr", type: "hr" }];
    expect(buildSdmDocumentContext(blocks)).toContain("[1] hr");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSdmBlocks
// ─────────────────────────────────────────────────────────────────────────────

describe("parseSdmBlocks", () => {
  // ── Basic parsing ──────────────────────────────────────────────────────────

  test("empty array → empty result", () => {
    expect(parseSdmBlocks("[]")).toEqual([]);
  });

  test("single paragraph block", () => {
    const result = parseSdmBlocks('[{"type":"p","spans":[{"text":"Hello world"}]}]');
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("p");
    expect((result[0] as STextBlock).spans[0]?.text).toBe("Hello world");
  });

  test("heading blocks h1–h4", () => {
    const json =
      '[{"type":"h1","spans":[{"text":"One"}]},' +
      '{"type":"h2","spans":[{"text":"Two"}]},' +
      '{"type":"h3","spans":[{"text":"Three"}]},' +
      '{"type":"h4","spans":[{"text":"Four"}]}]';
    const result = parseSdmBlocks(json);
    expect(result.map((b) => b.type)).toEqual(["h1", "h2", "h3", "h4"]);
  });

  test("hr block", () => {
    const result = parseSdmBlocks('[{"type":"hr"}]');
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("hr");
  });

  test("multiple blocks in order", () => {
    const json = '[{"type":"h1","spans":[{"text":"T"}]},{"type":"p","spans":[{"text":"B"}]},{"type":"hr"}]';
    const result = parseSdmBlocks(json);
    expect(result.map((b) => b.type)).toEqual(["h1", "p", "hr"]);
  });

  // ── UUID assignment ────────────────────────────────────────────────────────

  test("assigns a valid UUID to blocks without an id", () => {
    const result = parseSdmBlocks('[{"type":"p","spans":[{"text":"x"}]}]');
    expect(result[0]?.id).toMatch(UUID_RE);
  });

  test("each call produces distinct UUIDs", () => {
    const json = '[{"type":"p","spans":[{"text":"x"}]}]';
    const a = parseSdmBlocks(json);
    const b = parseSdmBlocks(json);
    expect(a[0]?.id).not.toBe(b[0]?.id);
  });

  test("preserves an existing id from the LM if present", () => {
    const result = parseSdmBlocks('[{"id":"my-id","type":"p","spans":[{"text":"x"}]}]');
    expect(result[0]?.id).toBe("my-id");
  });

  // ── Fence stripping ────────────────────────────────────────────────────────

  test("strips ```json … ``` fences", () => {
    const json = '```json\n[{"type":"h1","spans":[{"text":"Title"}]}]\n```';
    const result = parseSdmBlocks(json);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("h1");
  });

  test("strips plain ``` … ``` fences", () => {
    const json = '```\n[{"type":"hr"}]\n```';
    const result = parseSdmBlocks(json);
    expect(result[0]?.type).toBe("hr");
  });

  test("strips uppercase ```JSON fences", () => {
    const json = '```JSON\n[{"type":"p","spans":[{"text":"hi"}]}]\n```';
    expect(parseSdmBlocks(json)[0]?.type).toBe("p");
  });

  // ── Object wrapper unwrapping ──────────────────────────────────────────────

  test("unwraps {\"blocks\":[...]} wrapper", () => {
    const json = '{"blocks":[{"type":"p","spans":[{"text":"Wrapped"}]}]}';
    const result = parseSdmBlocks(json);
    expect(result).toHaveLength(1);
    expect((result[0] as STextBlock).spans[0]?.text).toBe("Wrapped");
  });

  test("unwraps {\"content\":[...]} wrapper", () => {
    const json = '{"content":[{"type":"hr"}]}';
    const result = parseSdmBlocks(json);
    expect(result[0]?.type).toBe("hr");
  });

  test("unwraps {\"result\":[...]} wrapper", () => {
    const json = '{"result":[{"type":"p","spans":[{"text":"r"}]}]}';
    expect(parseSdmBlocks(json)[0]?.type).toBe("p");
  });

  // ── Span normalisation ─────────────────────────────────────────────────────

  test("normalises string spans to Span[]", () => {
    const result = parseSdmBlocks('[{"type":"p","spans":"Hello"}]');
    expect((result[0] as STextBlock).spans).toEqual([{ text: "Hello" }]);
  });

  test("normalises array-of-strings spans", () => {
    const result = parseSdmBlocks('[{"type":"p","spans":["Hello","World"]}]');
    expect((result[0] as STextBlock).spans).toEqual([{ text: "Hello" }, { text: "World" }]);
  });

  test("filters empty strings from spans", () => {
    const result = parseSdmBlocks('[{"type":"p","spans":["","ok",""]}]');
    expect((result[0] as STextBlock).spans).toEqual([{ text: "ok" }]);
  });

  test("preserves marks on spans", () => {
    const json = '[{"type":"p","spans":[{"text":"Bold","marks":["bold"]}]}]';
    const result = parseSdmBlocks(json);
    expect((result[0] as STextBlock).spans[0]).toEqual({ text: "Bold", marks: ["bold"] });
  });

  test("preserves href on link spans", () => {
    const json = '[{"type":"p","spans":[{"text":"Link","marks":["link"],"href":"https://example.com"}]}]';
    const result = parseSdmBlocks(json);
    const span = (result[0] as STextBlock).spans[0];
    expect(span?.href).toBe("https://example.com");
  });

  test("handles spans with non-string text by coercing to string", () => {
    const json = '[{"type":"p","spans":[{"text":42}]}]';
    const result = parseSdmBlocks(json);
    expect((result[0] as STextBlock).spans[0]?.text).toBe("42");
  });

  // ── List normalisation ─────────────────────────────────────────────────────

  test("normalises ul with string spans on children", () => {
    const json = '[{"type":"ul","children":[{"type":"li","spans":"Item 1"}]}]';
    const result = parseSdmBlocks(json);
    const ul = result[0] as SListBlock;
    expect(ul.type).toBe("ul");
    expect(ul.children[0]?.spans).toEqual([{ text: "Item 1" }]);
  });

  test("normalises ol children recursively", () => {
    const json = '[{"type":"ol","children":[{"type":"li","spans":["A","B"]}]}]';
    const result = parseSdmBlocks(json);
    const ol = result[0] as SListBlock;
    expect(ol.children[0]?.spans).toEqual([{ text: "A" }, { text: "B" }]);
  });

  test("assigns UUIDs to list children", () => {
    const json = '[{"type":"ul","children":[{"type":"li","spans":[{"text":"x"}]}]}]';
    const result = parseSdmBlocks(json);
    const li = (result[0] as SListBlock).children[0];
    expect(li?.id).toMatch(UUID_RE);
  });

  // ── Table normalisation ────────────────────────────────────────────────────

  test("table block with header and data rows", () => {
    const json =
      '[{"type":"table","children":[' +
      '{"type":"tr","header":true,"children":[{"type":"th","spans":[{"text":"Name"}]}]},' +
      '{"type":"tr","children":[{"type":"td","spans":[{"text":"Alice"}]}]}' +
      ']}]';
    const result = parseSdmBlocks(json);
    expect(result[0]?.type).toBe("table");
    const table = result[0] as STableBlock;
    expect(table.children).toHaveLength(2);
    expect(table.children[0]?.type).toBe("tr");
    expect(table.children[0]?.header).toBe(true);
  });

  test("normalises string spans on td cells", () => {
    const json =
      '[{"type":"table","children":[' +
      '{"type":"tr","children":[{"type":"td","spans":"Value"}]}' +
      ']}]';
    const result = parseSdmBlocks(json);
    const table = result[0] as STableBlock;
    const td = table.children[0]?.children[0] as STextBlock;
    expect(td?.spans).toEqual([{ text: "Value" }]);
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  test("throws on completely invalid JSON", () => {
    expect(() => parseSdmBlocks("{invalid json")).toThrow();
  });

  test("throws when input is a plain object (not array)", () => {
    expect(() => parseSdmBlocks('{"type":"p"}')).toThrow();
  });

  test("throws on empty string input", () => {
    expect(() => parseSdmBlocks("")).toThrow();
  });
});
