/**
 * SlidingAudioVisualizer
 *
 * Canvas-based frequency bar visualizer with:
 *   - 60 fps rAF loop reading directly from AnalyserNode (no React re-renders)
 *   - Centered playhead; bars fade toward the edges (sliding-window feel)
 *   - Progress strip + time labels from visualizationData (10 fps text update)
 *   - Earth-tone idle animation (sine mountain ranges)
 *   - Fade transition state machine (idle → fadeIn → active → fadeOut)
 *   - Center playhead with dot indicator
 *   - Edge opacity fall-off on bars
 *   - Rendering to <canvas> + rAF loop
 *   - AnalyserNode read directly each frame
 */

import React, { useRef, useEffect } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import type { PlaybackVisualizationData } from "@/hooks/useAudioPlaybackWithVisualization";


interface SlidingAudioVisualizerProps {
  analyserNode:      AnalyserNode | null;
  visualizationData: PlaybackVisualizationData | null;
  isPlaying:         boolean;
  width?:            number;
  height?:           number;
  className?:        string;
}


function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Transition state for the idle ↔ active fade
type FadeState = "idle" | "fadeIn" | "active" | "fadeOut";


const SlidingAudioVisualizer: React.FC<SlidingAudioVisualizerProps> = ({
  analyserNode,
  visualizationData,
  isPlaying,
  width  = 300,
  height = 80,
  className = "",
}) => {
  useLingui();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number | null>(null);

  // Keep a ref to the latest visualizationData so the draw loop can read
  // progress without needing to re-run the effect every 10 fps.
  const vizRef = useRef(visualizationData);
  useEffect(() => { vizRef.current = visualizationData; }, [visualizationData]);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Snapshot theme colours once per effect run.  They are stable within a
    // single theme selection and re-read whenever the component remounts.
    const cs        = getComputedStyle(document.documentElement);
    const themeBg   = cs.getPropertyValue("--theme-bg").trim()      || "#121212";
    const themeSurf = cs.getPropertyValue("--theme-surface").trim() || "#1e1e1e";

    // Scale for retina / hi-DPI displays
    const dpr = window.devicePixelRatio ?? 1;
    canvas.width  = width  * dpr;
    canvas.height = height * dpr;
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const W = width;
    const H = height;
    const BAR_AREA_H = H - 10; // bottom 10 px reserved for progress strip
    const NUM_BARS   = 64;

    // Reusable data buffer — allocated once, mutated in place each frame
    const freqData = new Uint8Array(analyserNode ? analyserNode.frequencyBinCount : NUM_BARS);

    let fadeState:    FadeState = isPlaying ? "active" : "idle";
    let fadeProgress: number   = isPlaying ? 1 : 0;
    const FADE_IN_SPEED  = 0.03;
    const FADE_OUT_SPEED = 0.05;

    let startTime = performance.now();

    const draw = (now: number) => {
      const elapsed = (now - startTime) / 1000; // seconds


      if (isPlaying) {
        fadeState    = "active";
        fadeProgress = 1;
      } else {
        if (fadeState === "active" || fadeState === "fadeIn") {
          fadeState = "fadeOut";
        }
        if (fadeState === "fadeOut") {
          fadeProgress = Math.max(0, fadeProgress - FADE_OUT_SPEED);
          if (fadeProgress === 0) fadeState = "idle";
        } else if (fadeState === "idle") {
          fadeState    = "fadeIn";
          fadeProgress = 0;
        }
        if (fadeState === "fadeIn") {
          fadeProgress = Math.min(1, fadeProgress + FADE_IN_SPEED);
          if (fadeProgress === 1) fadeState = "active";
        }
      }

      let barData: Uint8Array;

      if (isPlaying && analyserNode) {
        analyserNode.getByteFrequencyData(freqData);
        barData = freqData;
      } else {
        // Idle: gentle sine-based mountain ranges (earth tones)
        const idle = new Uint8Array(NUM_BARS);
        for (let i = 0; i < NUM_BARS; i++) {
          const t  = i / NUM_BARS;
          const m1 = Math.abs(Math.sin(t * Math.PI * 3 + elapsed * 0.25)) * 80;
          const m2 = Math.abs(Math.sin(t * Math.PI * 5 + elapsed * 0.15)) * 50;
          const pulse = Math.sin(elapsed * 0.4) * 8;
          idle[i] = Math.min(255, Math.max(0, Math.round(m1 + m2 + pulse + 12)));
        }
        barData = idle;
      }

      ctx.fillStyle = themeBg;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = "rgba(128,128,128,0.07)";
      ctx.lineWidth   = 1;
      for (let g = 1; g < 4; g++) {
        const y = Math.round((BAR_AREA_H * g) / 4) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      const barW   = W / NUM_BARS;
      const maxBarH = BAR_AREA_H - 6;

      for (let i = 0; i < NUM_BARS; i++) {
        // Sample frequency bins mapped linearly to NUM_BARS slots
        const binIndex = Math.floor((i / NUM_BARS) * barData.length);
        const val      = barData[binIndex] ?? 0;
        const barH     = (val / 255) * maxBarH * fadeProgress;
        if (barH < 1) continue;

        const x = i * barW;

        const dist  = Math.abs(i / NUM_BARS - 0.5) * 2;  // 0 = center, 1 = edge
        const alpha = Math.max(0.2, 1 - dist * 0.7);

        // Color: earth tones when idle, blue-purple when playing
        let hue: number, sat: number, lit: number;
        if (!isPlaying) {
          const intensity = val / 255;
          hue = 28  + intensity * 14;
          sat = 55  - intensity * 25;
          lit = 20  + intensity * 30;
        } else {
          hue = 220 + (val / 255) * 60;
          sat = 75;
          lit = 42 + (val / 255) * 28;
        }

        ctx.fillStyle = `hsla(${hue},${sat}%,${lit}%,${alpha})`;
        ctx.beginPath();
        // roundRect: supported in WebKit ≥ 15.4 / Chrome 99 / WebKitGTK ≥ 6
        ctx.roundRect(x + 0.5, BAR_AREA_H - barH, Math.max(1, barW - 1), barH, 1);
        ctx.fill();
      }

      const cx = W / 2;
      const lineAlpha = isPlaying ? 0.85 : fadeProgress * 0.3;
      ctx.strokeStyle = `rgba(255,255,255,${lineAlpha})`;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, 4);
      ctx.lineTo(cx, BAR_AREA_H - 2);
      ctx.stroke();

      ctx.fillStyle = isPlaying ? "#4ade80" : `rgba(255,255,255,${lineAlpha})`;
      ctx.beginPath();
      ctx.arc(cx, 6, 3, 0, Math.PI * 2);
      ctx.fill();

      const progress = vizRef.current?.progress ?? 0;
      const stripY   = H - 8;

      ctx.fillStyle = themeSurf;
      ctx.fillRect(0, stripY, W, 8);

      if (progress > 0) {
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0,   "#3b82f6"); // blue-500
        grad.addColorStop(1,   "#8b5cf6"); // violet-500
        ctx.fillStyle = grad;
        ctx.fillRect(0, stripY, W * Math.min(1, progress), 8);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    startTime = performance.now();
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [analyserNode, isPlaying, width, height]);

  // Time labels: React render driven by 10 fps visualizationData update
  const currentTime = visualizationData?.currentTime ?? 0;
  const duration    = visualizationData?.duration    ?? 0;
  const hasTime     = duration > 0;
  const labelAlpha  = hasTime ? 1 : 0.2;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="rounded-lg overflow-hidden" style={{ width, height }}>
        <canvas ref={canvasRef} />
      </div>

      <div className="flex justify-between items-center px-0.5 text-xs font-mono text-[var(--theme-text-muted)]"
           style={{ width }}>
        <span style={{ opacity: labelAlpha }}>{fmt(currentTime)}</span>

        <div className="flex items-center gap-1.5 h-4">
          {isPlaying ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
              <span className="text-green-400 text-[10px] font-semibold tracking-wider">
                {i18n._({ id: "PLAYING", message: "PLAYING" })}
              </span>
            </>
          ) : (
            /* preserve space so layout doesn't jump */
            <span className="opacity-0 text-[10px]">READY</span>
          )}
        </div>

        <span style={{ opacity: labelAlpha }}>{fmt(duration)}</span>
      </div>
    </div>
  );
};

export default SlidingAudioVisualizer;
