/**
 * @file hooks/useIsNarrow.ts
 * Returns true whenever the viewport width is below the given breakpoint.
 * Reactively updates on resize, so the caller re-renders immediately.
 *
 * Uses window.matchMedia rather than window.innerWidth to avoid the
 * fractional-pixel off-by-one errors that occur on HiDPI displays.
 */

import { useEffect, useState } from "react";

export function useIsNarrow(breakpoint = 768): boolean {
  const [narrow, setNarrow] = useState<boolean>(
    () =>
      typeof window !== "undefined"
        ? window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches
        : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);

    // Some older browsers only have addListener; addEventListener is preferred.
    mq.addEventListener("change", handler);
    setNarrow(mq.matches); // sync in case we mounted after a resize
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);

  return narrow;
}
