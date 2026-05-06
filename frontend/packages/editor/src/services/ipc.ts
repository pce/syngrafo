/**
 * @file services/ipc.ts
 * Shared saucer IPC helpers — single `declare global` for the entire package.
 */

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

/** Returns the named exposed binding function, or `undefined` if not available. */
export function ipcBinding(name: string): ((...args: unknown[]) => Promise<string>) | undefined {
  return window.saucer?.exposed?.[name];
}

/**
 * Call a named IPC binding with positional args.
 * Returns the raw JSON string from the backend, or `null` if the binding is absent.
 */
export async function ipcRawCall(name: string, ...args: unknown[]): Promise<string | null> {
  const fn = ipcBinding(name);
  if (typeof fn !== "function") return null;
  return fn(...args);
}

/**
 * Parse a raw IPC result string.
 * Throws if `raw` is `null` (binding absent) or `ok` is `false` (backend error forwarded).
 */
export function parseIpcResult<T>(raw: string | null): IpcResult<T> {
  if (raw === null) throw new Error("IPC binding not available");
  const parsed = JSON.parse(raw) as IpcResult<T>;
  if (!parsed.ok) throw new Error(parsed.error ?? "Unknown backend error");
  return parsed;
}

/**
 * Call a named IPC binding and return a parsed `IpcResult<T>`.
 * Throws on absent binding or backend error.
 */
export async function ipcCall<T = unknown>(
  name: string,
  ...args: unknown[]
): Promise<IpcResult<T>> {
  const raw = await ipcRawCall(name, ...args);
  return parseIpcResult<T>(raw);
}

/**
 * Call a named IPC binding silently.
 * Returns `{ ok: false, error: "..." }` on any failure — never throws.
 */
export async function ipcTryCall<T = unknown>(
  name: string,
  ...args: unknown[]
): Promise<IpcResult<T>> {
  try {
    const fn = ipcBinding(name);
    if (typeof fn !== "function") return { ok: false, error: "not connected" };
    const raw = await fn(...args);
    return JSON.parse(raw) as IpcResult<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
