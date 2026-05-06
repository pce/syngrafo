/**
 * @file hooks/useClickOutside.ts
 * Fires `callback` when a mousedown event occurs outside `ref`.
 * Attaches/removes the global listener only when `enabled` is true.
 */
import { useEffect, type RefObject } from "react";

export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  callback: () => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        callback();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, callback, enabled]);
}
