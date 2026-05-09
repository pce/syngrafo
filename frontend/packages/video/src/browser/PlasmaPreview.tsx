/**
 * PlasmaPreview.tsx
 *
 * A small canvas component that renders the stretch-morph plasma flow field
 * using the same 3-harmonic formula as the GPU shader, computed in JS on the
 * CPU at low resolution (128×72).
 *
 * R = X-displacement, G = Y-displacement, B = flow magnitude.
 * Useful for previewing noise scale and speed before rendering.
 *
 * When `animate` is true, loops at ~24 fps using requestAnimationFrame.
 */

import React, { useRef, useEffect, useCallback } from 'react';

export interface PlasmaPreviewProps {
  noiseScale:  number;
  noiseSpeed:  number;
  /** Width of the canvas in DOM pixels (default 160). */
  width?:      number;
  /** Height of the canvas in DOM pixels (default 90). */
  height?:     number;
  /** Animate the preview in real-time. Default false. */
  animate?:    boolean;
  /** External time override in seconds (used when animate=false). */
  time?:       number;
  className?:  string;
}

/**
 * JS implementation of the GPU plasma formula — must stay in sync with
 * `buildMorphColorNode` in gpu/tsl/operators.ts.
 */
function plasmaDx(u: number, v: number, t: number): number {
  return (
    Math.sin(u * 3.1 + v * 1.7 + t) +
    Math.sin(u * 1.9 + v * 2.3 + t * 0.71) +
    Math.sin(u * 0.7 + v * 3.7 + t * 1.37)
  ) / 3;
}

function plasmaDy(u: number, v: number, t: number): number {
  return (
    Math.cos(u * 2.3 + v * 1.1 + t * 0.83) +
    Math.cos(u * 3.7 + v * 0.9 + t * 0.53) +
    Math.cos(u * 1.3 + v * 2.9 + t * 1.13)
  ) / 3;
}

const RENDER_W = 128;
const RENDER_H = 72;

export const PlasmaPreview: React.FC<PlasmaPreviewProps> = ({
  noiseScale,
  noiseSpeed,
  width  = 160,
  height = 90,
  animate = false,
  time    = 0,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number | null>(null);
  const startRef  = useRef<number>(performance.now());

  const render = useCallback((t: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(RENDER_W, RENDER_H);
    const d       = imgData.data;
    const ft      = t * noiseSpeed;

    for (let py = 0; py < RENDER_H; py++) {
      for (let px = 0; px < RENDER_W; px++) {
        const u  = (px / RENDER_W) * noiseScale;
        const v  = (py / RENDER_H) * noiseScale;
        const dx = plasmaDx(u, v, ft);
        const dy = plasmaDy(u, v, ft);
        const mag = Math.sqrt(dx * dx + dy * dy);

        const i    = (py * RENDER_W + px) * 4;
        d[i]     = Math.round((dx * 0.5 + 0.5) * 255);  // R = x-flow
        d[i + 1] = Math.round((dy * 0.5 + 0.5) * 255);  // G = y-flow
        d[i + 2] = Math.round(Math.min(1, mag) * 200);   // B = magnitude
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [noiseScale, noiseSpeed]);

  // Static / externally-controlled time
  useEffect(() => {
    if (!animate) render(time);
  }, [animate, time, render]);

  // Animated loop
  useEffect(() => {
    if (!animate) return;
    startRef.current = performance.now();

    const tick = (now: number) => {
      render((now - startRef.current) / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [animate, render]);

  return (
    <canvas
      ref={canvasRef}
      width={RENDER_W}
      height={RENDER_H}
      className={`rounded border border-[var(--theme-border)] ${className}`}
      style={{ width, height, imageRendering: 'pixelated' }}
      aria-label="Plasma noise field preview"
    />
  );
};
