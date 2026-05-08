/** @file Saucer IPC bridge — shared by audio, video, and any future package. */

declare global {
  interface Window {
    saucer?: {
      call<T = string>(name: string, params?: unknown[]): Promise<T>;
      exposed?: Record<string, (...args: unknown[]) => Promise<string>>;
    };
  }
}

export interface IpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function ipcCall<T>(name: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const fn = window.saucer?.exposed?.[name];
  if (typeof fn !== 'function') return { ok: false, error: 'IPC not available' };
  try {
    const raw = await fn(...args);
    return JSON.parse(raw) as IpcResult<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
