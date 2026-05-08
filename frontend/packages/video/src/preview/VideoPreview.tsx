/**
 * VideoPreview.tsx
 * Canvas-based composition preview.
 *
 * Renders the active clips at a given frame number using the browser's 2D canvas
 * API. For now image/video clips show a coloured placeholder with the label
 * (since we don't decode media in the browser for the MVP). When a clip has a
 * source.blob or source.url set, the actual image is drawn.
 *
 * Keyframe interpolation uses the shared `ease()` helper so the preview
 * accurately reflects the same easing curves used by the backend renderer.
 */

import React, { useRef, useEffect } from 'react';
import { ease } from '@syngrafo/shared';
import type { VideoProject, VideoClip, VideoKeyframe } from '../types/video.ts';

const KIND_FILL: Record<string, string> = {
  image:       '#1e40af',
  video:       '#4c1d95',
  audio:       '#14532d',
  solid_color: '#92400e',
};

function sampleKeyframes(
  keyframes: VideoKeyframe[],
  property: VideoKeyframe['property'],
  frame: number,
  defaultValue: number,
): number {
  const kfs = keyframes
    .filter(k => k.property === property)
    .sort((a, b) => a.frame - b.frame);

  if (kfs.length === 0) return defaultValue;

  const first = kfs[0];
  const last  = kfs[kfs.length - 1];
  if (!first || !last) return defaultValue;

  if (frame <= first.frame) return first.value;
  if (frame >= last.frame)  return last.value;

  // Find the surrounding pair
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (!a || !b) continue;
    if (frame >= a.frame && frame <= b.frame) {
      const range = b.frame - a.frame;
      const t     = range === 0 ? 1 : (frame - a.frame) / range;
      return ease(a.value, b.value, t, b.easing);
    }
  }
  return defaultValue;
}

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => { imageCache.set(url, img); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

export interface VideoPreviewProps {
  project: VideoProject;
  frame:   number;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ project, frame }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = project.resolution;
    canvas.width  = width;
    canvas.height = height;

    // Clear with background colour
    ctx.fillStyle = project.settings.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Collect active clips (frame in range), sorted by layer ascending
    const active: VideoClip[] = project.tracks
      .flatMap(t => t.clips)
      .filter(c => frame >= c.range.startFrame && frame <= c.range.endFrame)
      .sort((a, b) => a.layer - b.layer);

    // Render each clip
    const drawNext = (idx: number) => {
      if (idx >= active.length) return;
      const clip = active[idx];
      if (!clip) { drawNext(idx + 1); return; }

      // Sample animated properties
      const opacity   = sampleKeyframes(clip.keyframes, 'opacity',  frame, clip.opacity);
      const scale     = sampleKeyframes(clip.keyframes, 'scale',    frame, clip.scale);
      const rotation  = sampleKeyframes(clip.keyframes, 'rotation', frame, clip.rotation);
      const posX      = sampleKeyframes(clip.keyframes, 'posX',     frame, clip.posX);
      const posY      = sampleKeyframes(clip.keyframes, 'posY',     frame, clip.posY);

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

      // Apply transform (relative to canvas center)
      const cx = width  / 2 + posX;
      const cy = height / 2 + posY;
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale, scale);

      const drawW = width;
      const drawH = height;

      if (clip.kind === 'audio') {
        // Audio: text placeholder
        ctx.fillStyle = 'rgba(20, 83, 45, 0.5)';
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = `${Math.floor(drawH / 10)}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`♫  ${clip.label}`, 0, 0);
      } else if (clip.kind === 'solid_color' && clip.source.color) {
        ctx.fillStyle = clip.source.color;
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
      } else {
        // image / video — try to draw actual media or fall back to placeholder
        const url = clip.source.url
          ?? (clip.source.blob ? URL.createObjectURL(clip.source.blob) : undefined);

        if (url) {
          // Async path: load and redraw (subsequent calls hit the cache)
          const saved = ctx.getTransform();
          loadImage(url).then(img => {
            // Re-enter render after async load
            const c2 = canvasRef.current;
            if (!c2) return;
            const ctx2 = c2.getContext('2d');
            if (!ctx2) return;
            ctx2.save();
            ctx2.setTransform(saved);
            ctx2.globalAlpha = Math.max(0, Math.min(1, opacity));
            const iw = img.naturalWidth  || drawW;
            const ih = img.naturalHeight || drawH;
            ctx2.drawImage(img, -iw / 2, -ih / 2, iw, ih);
            ctx2.restore();
            drawNext(idx + 1);
          }).catch(() => {
            drawPlaceholder(ctx, clip.label, drawW, drawH, KIND_FILL[clip.kind] ?? '#374151');
            ctx.restore();
            drawNext(idx + 1);
          });
          return;   // drawNext continues inside the then/catch
        } else {
          drawPlaceholder(ctx, clip.label, drawW, drawH, KIND_FILL[clip.kind] ?? '#374151');
        }
      }

      ctx.restore();
      drawNext(idx + 1);
    };

    drawNext(0);
  }, [project, frame]);

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full"
        style={{ objectFit: 'contain' }}
        aria-label="Video preview"
      />
    </div>
  );
};

function drawPlaceholder(
  ctx:    CanvasRenderingContext2D,
  label:  string,
  w:      number,
  h:      number,
  fill:   string,
) {
  ctx.fillStyle = fill + '88';   // semi-transparent
  ctx.fillRect(-w / 2, -h / 2, w, h);
  // Dashed border
  ctx.strokeStyle = fill;
  ctx.lineWidth   = 2;
  ctx.setLineDash([12, 8]);
  ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
  ctx.setLineDash([]);
  // Label
  ctx.fillStyle    = 'rgba(255,255,255,0.8)';
  ctx.font         = `${Math.max(14, Math.floor(h / 12))}px sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);
}
