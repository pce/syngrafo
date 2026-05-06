/**
 * @file hooks/useSwipeToPan.ts
 * Attaches passive touch listeners to a container element and fires
 * directional callbacks when the user makes a horizontal swipe gesture.
 *
 * Intended for panel open/close on touch screens:
 *   - Swipe right from the left-edge zone  → onSwipeRight (open left panel)
 *   - Swipe left  from the right-edge zone → onSwipeLeft  (open right panel)
 *
 * The edge-zone restriction avoids conflicting with horizontal scroll inside
 * block content (e.g. code blocks, wide tables).
 *
 * Callbacks are stored in a stable ref so they can be updated each render
 * without re-attaching the DOM listeners.
 */

import { useEffect, useRef } from "react";

export interface SwipeToPanOptions {
  /** Minimum horizontal travel in px before the gesture fires. Default 50. */
  threshold?: number;
  /**
   * Width of the "hot zone" in px from each screen edge where a swipe is
   * recognised.  Swipes that start outside this zone are ignored so normal
   * horizontal scroll inside the canvas is not disrupted.  Default 40.
   */
  edgeZone?: number;
  /** Set false to disable the hook without unmounting. Default true. */
  enabled?: boolean;
}

export function useSwipeToPan(
  ref: React.RefObject<HTMLElement | null>,
  onSwipeRight?: () => void,
  onSwipeLeft?: () => void,
  options: SwipeToPanOptions = {},
): void {
  const { threshold = 50, edgeZone = 40, enabled = true } = options;

  // Stable ref so we never re-attach listeners when the callbacks change.
  const cbs = useRef({ onSwipeRight, onSwipeLeft });
  useEffect(() => {
    cbs.current = { onSwipeRight, onSwipeLeft };
  });

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let activeEdge: "left" | "right" | null = null;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      const W = window.innerWidth;
      if (startX <= edgeZone) {
        activeEdge = "left";
      } else if (startX >= W - edgeZone) {
        activeEdge = "right";
      } else {
        activeEdge = null;
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!activeEdge) return;
      const t = e.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      activeEdge = null;

      // Reject if primarily vertical.
      if (Math.abs(dy) > Math.abs(dx) * 0.75) return;
      if (Math.abs(dx) < threshold) return;

      if (dx > 0) cbs.current.onSwipeRight?.();
      else cbs.current.onSwipeLeft?.();
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, [ref, threshold, edgeZone, enabled]);
}
