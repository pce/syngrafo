/**
 * @file csound-engine-state.test.ts
 * @brief Tests for the audioService IPC fallback behaviour.
 *
 * In the bun:test environment window.saucer is undefined, so every call
 * through ipcCall() must return { ok: false, error: "IPC not available" }
 * without throwing.
 *
 * Run with:  bun test src
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { audioService } from "../../../../audio/src/ipc/audio-service";

// Bun's test runner does not define window.  Polyfill it so the optional
// chain `window.saucer?.exposed?.[name]` resolves to undefined rather than
// throwing a ReferenceError.
beforeAll(() => {
  if (typeof window === "undefined") {
    (globalThis as unknown as Record<string, unknown>).window = globalThis;
  }
});

describe("audioService — IPC unavailable (no saucer bridge)", () => {
  it("exportWav returns ok:false", async () => {
    const result = await audioService.exportWav(
      "<CsoundSynthesizer></CsoundSynthesizer>",
      "/tmp/out.wav",
    );
    expect(result.ok).toBe(false);
  });

  it("exportWav error message mentions IPC not available", async () => {
    const result = await audioService.exportWav("", "/tmp/out.wav");
    expect(result.error).toContain("IPC not available");
  });

  it("exportWav carries no data on failure", async () => {
    const result = await audioService.exportWav("", "/tmp/out.wav");
    expect(result.data).toBeUndefined();
  });

  it("getAudioInfo returns ok:false", async () => {
    const result = await audioService.getAudioInfo("/tmp/test.wav");
    expect(result.ok).toBe(false);
  });

  it("getAudioInfo error message mentions IPC not available", async () => {
    const result = await audioService.getAudioInfo("/tmp/test.wav");
    expect(result.error).toContain("IPC not available");
  });

  it("getAudioInfo carries no data on failure", async () => {
    const result = await audioService.getAudioInfo("/tmp/test.wav");
    expect(result.data).toBeUndefined();
  });

  it("validateCsd returns ok:false", async () => {
    const result = await audioService.validateCsd("bad csd");
    expect(result.ok).toBe(false);
  });

  it("validateCsd error message mentions IPC not available", async () => {
    const result = await audioService.validateCsd("bad csd");
    expect(result.error).toContain("IPC not available");
  });

  it("validateCsd carries no data on failure", async () => {
    const result = await audioService.validateCsd("bad csd");
    expect(result.data).toBeUndefined();
  });
});

describe("audioService — result shape", () => {
  it("all three methods return objects with an ok property", async () => {
    const [a, b, c] = await Promise.all([
      audioService.exportWav("", "/tmp/x.wav"),
      audioService.getAudioInfo("/tmp/x.wav"),
      audioService.validateCsd(""),
    ]);
    expect(typeof a.ok).toBe("boolean");
    expect(typeof b.ok).toBe("boolean");
    expect(typeof c.ok).toBe("boolean");
  });

  it("all three methods settle (do not reject) when saucer is absent", async () => {
    await expect(
      Promise.all([
        audioService.exportWav("", "/tmp/x.wav"),
        audioService.getAudioInfo("/tmp/x.wav"),
        audioService.validateCsd(""),
      ]),
    ).resolves.toBeDefined();
  });
});
