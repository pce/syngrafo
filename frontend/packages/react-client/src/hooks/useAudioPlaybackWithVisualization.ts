/**
 * useAudioPlaybackWithVisualization
 *
 * Drives Web Audio API playback and exposes an AnalyserNode for canvas
 * visualizers to read directly — no per-frame React state updates.
 *
 * Sources accepted by play():
 *   - Blob              (recorded audio stored in IndexedDB)
 *   - string            (absolute path → served via local:// scheme)
 *   - local:// URL      (already-formed local:// string)
 *
 * Usage:
 *   const { play, stop, analyserNode, visualizationData, currentPlayingId, isPlaying }
 *     = useAudioPlaybackWithVisualization();
 */

import { useRef, useState, useCallback } from "react";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Slow-path data (10 fps) — used for time labels & progress text only.
 *  Canvas visualizers read the AnalyserNode directly for 60 fps smoothness. */
export interface PlaybackVisualizationData {
  progress:    number;  // 0.0 – 1.0
  currentTime: number;  // seconds
  duration:    number;  // seconds
  isPlaying:   boolean;
}

export interface AudioPlaybackControls {
  /** Start playback. source can be a Blob, an absolute path, or a local:// URL. */
  play:               (source: Blob | string, id: string) => Promise<void>;
  stop:               () => void;
  /** True while downloading + decoding the audio file (before playback starts). */
  isLoading:          boolean;
  /** The live AnalyserNode — null when idle. Canvas components watch this prop
   *  and restart their own rAF loop when it changes. */
  analyserNode:       AnalyserNode | null;
  /** Coarse progress snapshot updated at ~10 fps for text/label rendering. */
  visualizationData:  PlaybackVisualizationData | null;
  currentPlayingId:   string | null;
  isPlaying:          boolean;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAudioPlaybackWithVisualization(): AudioPlaybackControls {
  // Imperative audio objects — never stored in React state
  const ctxRef       = useRef<AudioContext | null>(null);
  const sourceRef    = useRef<AudioBufferSourceNode | null>(null);
  const rafRef       = useRef<number | null>(null);
  const startedAtRef = useRef(0);  // audioCtx.currentTime snapshot at play start
  const durRef       = useRef(0);
  const tickStampRef = useRef(0);  // last time we flushed to React state

  // React state — drives re-renders only when truly necessary
  const [analyserNode,     setAnalyserNode]     = useState<AnalyserNode | null>(null);
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null);
  const [isPlaying,        setIsPlaying]        = useState(false);
  const [isLoading,        setIsLoading]        = useState(false);
  const [visualizationData, setVizData]         = useState<PlaybackVisualizationData | null>(null);

  // ── stop ───────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    try { sourceRef.current?.stop(); } catch { /* already stopped */ }
    sourceRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setAnalyserNode(null);
    setIsPlaying(false);
    setIsLoading(false);
    setCurrentPlayingId(null);
    setVizData(null);
  }, []);

  // ── play ───────────────────────────────────────────────────────────────────
  const play = useCallback(async (source: Blob | string, id: string) => {
    // Guard: ignore if already loading or playing (prevents double-tap)
    // Tear down any in-progress playback first
    try { sourceRef.current?.stop(); } catch { /* ok */ }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    setIsLoading(true);
    setIsPlaying(false);
    setCurrentPlayingId(null);

    try {
      // Lazily create AudioContext
      const ctx = ctxRef.current ?? new AudioContext();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      // Resolve source → ArrayBuffer
      let arrayBuffer: ArrayBuffer;
      if (source instanceof Blob) {
        arrayBuffer = await source.arrayBuffer();
      } else {
        const url = source.startsWith("local://")
          ? source
          : `local://local${source}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`[audio] fetch failed: ${resp.status} ${url}`);
        arrayBuffer = await resp.arrayBuffer();
      }

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const duration    = audioBuffer.duration;

      // Build audio graph: source → analyser → speakers
      const analyser = ctx.createAnalyser();
      analyser.fftSize              = 2048;
      analyser.smoothingTimeConstant = 0.8;

      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(analyser);
      analyser.connect(ctx.destination);

      durRef.current       = duration;
      startedAtRef.current = ctx.currentTime;
      src.start(0);

      src.onended = () => {
        setIsPlaying(false);
        setCurrentPlayingId(null);
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        setVizData({ progress: 1, currentTime: duration, duration, isPlaying: false });
      };

      sourceRef.current = src;

      // Push initial state to React
      setAnalyserNode(analyser);
      setCurrentPlayingId(id);
      setIsPlaying(true);
      setIsLoading(false);
      setVizData({ progress: 0, currentTime: 0, duration, isPlaying: true });
      tickStampRef.current = performance.now();

      // Progress loop — runs at rAF rate but only flushes React state at ~10 fps
      const tick = () => {
        const elapsed  = Math.min(ctx.currentTime - startedAtRef.current, duration);
        const progress = elapsed / duration;
        const now = performance.now();
        if (now - tickStampRef.current >= 100) {
          tickStampRef.current = now;
          setVizData({ progress, currentTime: elapsed, duration, isPlaying: true });
        }
        if (elapsed < duration) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setIsLoading(false);
      setIsPlaying(false);
      throw err;
    }
  }, []);

  return { play, stop, isLoading, analyserNode, visualizationData, currentPlayingId, isPlaying };
}
