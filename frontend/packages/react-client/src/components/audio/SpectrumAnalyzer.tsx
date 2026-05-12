/**
 * SpectrumAnalyzer
 *
 * Canvas-based FFT spectrum with a logarithmic frequency axis.
 *
 *   - Logarithmic x-axis (Math.log1p scale)
 *   - Responsive resize handler
 *   - Rainbow HSL coloring
 *   - Accepts AnalyserNode directly
 *   - Has its own internal rAF loop
 *   - Stops the loop cleanly when not playing to avoid burning CPU at idle
 *   - Draws a subtle idle flat-line when the analyser is absent
 */

import React, { useRef, useEffect } from "react";


interface SpectrumAnalyzerProps {
  analyserNode: AnalyserNode | null;
  isPlaying:    boolean;
  className?:   string;
}


const SpectrumAnalyzer: React.FC<SpectrumAnalyzerProps> = ({
  analyserNode,
  isPlaying,
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number | null>(null);

  const resizeCanvas = (canvas: HTMLCanvasElement) => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr    = window.devicePixelRatio ?? 1;
    const { width, height } = parent.getBoundingClientRect();
    canvas.width  = Math.floor(width  * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;
  };

  // Draw loop — restarts when analyserNode or isPlaying changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    resizeCanvas(canvas);

    const cs      = getComputedStyle(document.documentElement);
    const themeBg = cs.getPropertyValue("--theme-bg").trim() || "#121212";

    const dpr     = window.devicePixelRatio ?? 1;
    const binCount = analyserNode ? analyserNode.frequencyBinCount : 1024;
    const freqData = new Uint8Array(binCount);

    const drawFrame = () => {
      const W = canvas.width  / dpr;
      const H = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = themeBg;
      ctx.fillRect(0, 0, W, H);

      if (!isPlaying || !analyserNode) {
        // Idle: draw a subtle flat baseline
        ctx.strokeStyle = "rgba(128,128,128,0.15)";
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(0, H - 1);
        ctx.lineTo(W, H - 1);
        ctx.stroke();
        // No rAF when idle — nothing to animate
        return;
      }

      analyserNode.getByteFrequencyData(freqData);

      // Draw bars with logarithmic x-axis spacing
      // Math.log1p(i) / Math.log1p(binCount) maps [0, binCount] → [0, 1] log-scaled
      const barW = W / binCount;

      for (let i = 0; i < binCount; i++) {
        const value   = freqData[i] ?? 0;
        const barH    = (value / 255) * H;

        // Log-scaled x position: compress high frequencies, expand low
        const xNorm = Math.log1p(i) / Math.log1p(binCount);
        const x     = xNorm * W;

        const hue   = (i / binCount) * 300; // 0° (red) → 300° (magenta)
        const lit   = 35 + (value / 255) * 30;
        ctx.fillStyle = `hsl(${hue}, 90%, ${lit}%)`;
        ctx.fillRect(x, H - barH, Math.max(1, barW), barH);
      }

      rafRef.current = requestAnimationFrame(drawFrame);
    };

    rafRef.current = requestAnimationFrame(drawFrame);

    const handleResize = () => {
      resizeCanvas(canvas);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [analyserNode, isPlaying]);

  return (
    <div className={`w-full h-48 ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
};

export default SpectrumAnalyzer;
