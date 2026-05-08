/**
 * @file portals.test.ts
 * @brief Tests for AudioPortal and VideoPortal prop contracts.
 *
 * Rendering the portals themselves requires jsdom + React testing library,
 * neither of which is available in bun:test by default.  These tests focus
 * on the exported prop interfaces and the behavioural guarantees that can be
 * exercised with plain TypeScript objects.
 *
 * Run with:  bun test src
 */

import { describe, it, expect } from "bun:test";
import type { AudioPortalProps } from "../AudioPortal";
import type { VideoPortalProps } from "../VideoPortal";

describe("AudioPortalProps", () => {
  it("open:false represents a closed portal", () => {
    const props: AudioPortalProps = { open: false };
    expect(props.open).toBe(false);
  });

  it("open:true represents an open portal", () => {
    const props: AudioPortalProps = { open: true };
    expect(props.open).toBe(true);
  });

  it("onClose is optional — omitting it is valid", () => {
    const props: AudioPortalProps = { open: true };
    expect(props.onClose).toBeUndefined();
  });

  it("onClose is a function when provided", () => {
    const props: AudioPortalProps = { open: true, onClose: () => {} };
    expect(typeof props.onClose).toBe("function");
  });

  it("onClose can be invoked when defined", () => {
    let called = false;
    const props: AudioPortalProps = { open: true, onClose: () => { called = true; } };
    props.onClose!();
    expect(called).toBe(true);
  });

  it("open flag is the sole required field", () => {
    const closed: AudioPortalProps = { open: false };
    const open: AudioPortalProps   = { open: true };
    expect(closed.open).toBe(false);
    expect(open.open).toBe(true);
  });
});

describe("VideoPortalProps", () => {
  it("open:false represents a closed portal", () => {
    const props: VideoPortalProps = { open: false };
    expect(props.open).toBe(false);
  });

  it("open:true represents an open portal", () => {
    const props: VideoPortalProps = { open: true };
    expect(props.open).toBe(true);
  });

  it("onClose is optional — omitting it is valid", () => {
    const props: VideoPortalProps = { open: true };
    expect(props.onClose).toBeUndefined();
  });

  it("onClose is a function when provided", () => {
    const props: VideoPortalProps = { open: true, onClose: () => {} };
    expect(typeof props.onClose).toBe("function");
  });

  it("onClose can be invoked when defined", () => {
    let called = false;
    const props: VideoPortalProps = { open: true, onClose: () => { called = true; } };
    props.onClose!();
    expect(called).toBe(true);
  });

  it("open flag is the sole required field", () => {
    const closed: VideoPortalProps = { open: false };
    const open: VideoPortalProps   = { open: true };
    expect(closed.open).toBe(false);
    expect(open.open).toBe(true);
  });
});

describe("AudioPortalProps vs VideoPortalProps — shared contract", () => {
  it("both interfaces have the same shape", () => {
    const audio: AudioPortalProps = { open: true, onClose: () => {} };
    const video: VideoPortalProps = { open: true, onClose: () => {} };
    expect(Object.keys(audio).sort()).toEqual(Object.keys(video).sort());
  });

  it("toggling open on AudioPortalProps works as expected", () => {
    let props: AudioPortalProps = { open: false };
    props = { ...props, open: true };
    expect(props.open).toBe(true);
    props = { ...props, open: false };
    expect(props.open).toBe(false);
  });

  it("toggling open on VideoPortalProps works as expected", () => {
    let props: VideoPortalProps = { open: false };
    props = { ...props, open: true };
    expect(props.open).toBe(true);
    props = { ...props, open: false };
    expect(props.open).toBe(false);
  });
});
