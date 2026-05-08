/**
 * VideoPreview.tsx
 * Three.js-backed composition preview via SceneCompositor.
 *
 * Holds a <canvas> element and delegates all rendering to SceneCompositor.
 * Frame changes are debounced through requestAnimationFrame so rapid scrubbing
 * never queues up stale render calls. A ResizeObserver keeps the compositor
 * informed of layout changes without recreating observers on every re-render.
 */

import React, { useRef, useState, useEffect } from 'react';
import { SceneCompositor } from '../gpu/SceneCompositor.ts';
import type { VideoProject } from '../types/video.ts';

export interface VideoPreviewProps {
  project: VideoProject;
  frame:   number;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({ project, frame }) => {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const compositorRef = useRef<SceneCompositor | null>(null);
  const rafRef        = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Assign a new closure each render so the ResizeObserver always dispatches
   * against the latest `project`, `frame`, and `ready` without having to be
   * re-created. Writing to a ref during render is safe — refs don't trigger
   * re-renders.
   */
  const renderLatestRef = useRef<() => void>(() => { /* no-op until init completes */ });
  renderLatestRef.current = () => {
    const comp = compositorRef.current;
    if (!comp || !ready) return;
    comp.renderFrame(project, frame).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Frame render failed');
    });
  };

  // Create the compositor on mount and tear it down on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const comp = new SceneCompositor(canvas);
    compositorRef.current = comp;
    let cancelled = false;

    comp.init()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Compositor initialisation failed',
          );
        }
      });

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      comp.dispose();
      compositorRef.current = null;
    };
  }, []);

  // Observe the container for layout changes; relay to compositor + re-render.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      compositorRef.current?.resize(width, height);
      renderLatestRef.current();
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []); // Set up once — renderLatestRef is always current on each invocation.

  // RAF-debounced render on project / frame / ready transitions.
  // Cancel any pending frame before scheduling a new one so that rapid
  // scrubbing through the timeline never accumulates queued renders.
  useEffect(() => {
    if (!ready) return;
    const comp = compositorRef.current;
    if (!comp) return;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      comp.renderFrame(project, frame).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Frame render failed');
      });
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [project, frame, ready]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[var(--theme-bg)] overflow-hidden"
    >
      {/* Canvas stays mounted at all times so the compositor holds a stable GL context. */}
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        aria-label="Video preview"
      />

      {!ready && error == null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--theme-border)] border-t-[var(--theme-primary)] animate-spin" />
        </div>
      )}

      {error != null && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
          <p className="text-[var(--theme-danger)] text-sm text-center leading-relaxed">
            {error}
          </p>
        </div>
      )}
    </div>
  );
};
