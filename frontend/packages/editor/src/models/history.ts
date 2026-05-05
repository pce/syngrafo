/**
 * @file models/history.ts
 * Pure functional undo/redo stack — no classes, no signals.
 * Generic over any snapshot type T.
 */

export interface HistoryState<T> {
  readonly past:    readonly T[];
  readonly present: T;
  readonly future:  readonly T[];
}

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

/**
 * Appends the current present to past, sets present = next, clears future.
 * Trims the oldest past entries once past.length exceeds maxEntries (default 50).
 */
export function pushHistory<T>(h: HistoryState<T>, next: T, maxEntries = 50): HistoryState<T> {
  const raw = [...h.past, h.present];
  const past = raw.length > maxEntries ? raw.slice(raw.length - maxEntries) : raw;
  return { past, present: next, future: [] };
}

/** Returns h unchanged (same reference) if there is nothing to undo. */
export function undoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) return h;
  const past    = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1] as T;
  const future  = [h.present, ...h.future];
  return { past, present, future };
}

/** Returns h unchanged (same reference) if there is nothing to redo. */
export function redoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) return h;
  const present = h.future[0] as T;
  const past    = [...h.past, h.present];
  const future  = h.future.slice(1);
  return { past, present, future };
}

export function canUndo<T>(h: HistoryState<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: HistoryState<T>): boolean {
  return h.future.length > 0;
}
