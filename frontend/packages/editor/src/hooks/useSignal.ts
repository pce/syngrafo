import { useSyncExternalStore, useCallback, useEffect } from "react";
import type { ReadonlySignal } from "@preact/signals-core";

export function useSignal<T>(sig: ReadonlySignal<T> | { value: T; subscribe: (fn: () => void) => () => void }): T {
  const subscribe = useCallback((onStoreChange: () => void) => sig.subscribe(onStoreChange), [sig]);
  const getSnapshot = useCallback(() => sig.value, [sig]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSignalState<T>(sig: { value: T; subscribe: (fn: () => void) => () => void }): [T, (next: T) => void] {
  const value = useSignal(sig);
  const setter = useCallback(
    (next: T) => {
      sig.value = next;
    },
    [sig],
  );
  return [value, setter];
}

export function useSignalEffect<T>(sig: ReadonlySignal<T> | { value: T; subscribe: (fn: (v?: T) => void) => () => void }, callback: (value: T) => void): void {
  useEffect(() => {
    callback(sig.value);
    const unsub = (sig as { subscribe: (fn: () => void) => () => void }).subscribe(() => {
      callback(sig.value);
    });
    return unsub;
  }, [sig, callback]);
}
