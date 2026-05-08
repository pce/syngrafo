/** @file File-system IPC helpers — shared across audio, video, editor packages. */

import { ipcCall } from '../ipc.ts';
import type { IpcResult } from '../ipc.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  size?: number;
  /** Milliseconds since epoch */
  modified?: number;
  mime?: string;
  indexed?: boolean;
}

export interface ScanDirResult {
  path: string;
  entries: FsEntry[];
}

// ---------------------------------------------------------------------------
// Raw C++ shape → FsEntry mapper (not exported)
// ---------------------------------------------------------------------------

interface RawFsEntry {
  name?: unknown;
  path?: unknown;
  is_dir?: unknown;
  size?: unknown;
  mtime?: unknown;
  mime_type?: unknown;
  indexed?: unknown;
}

function mapRawEntry(raw: RawFsEntry): FsEntry {
  return {
    name: String(raw.name ?? ''),
    path: String(raw.path ?? ''),
    kind: raw.is_dir ? 'dir' : 'file',
    size: typeof raw.size === 'number' ? raw.size : undefined,
    modified: typeof raw.mtime === 'number' ? raw.mtime * 1000 : undefined,
    mime: typeof raw.mime_type === 'string' ? raw.mime_type : undefined,
    indexed: !!raw.indexed,
  };
}

// ---------------------------------------------------------------------------
// Individual service functions
// ---------------------------------------------------------------------------

async function scanDir(
  path: string,
  recursive = false,
): Promise<IpcResult<ScanDirResult>> {
  const res = await ipcCall<{ path?: string; items?: unknown[] }>(
    'dms_scan_dir',
    path,
    recursive,
  );

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? 'dms_scan_dir failed' };
  }

  const raw = res.data;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const entries = items.map((item) => mapRawEntry(item as RawFsEntry));

  return {
    ok: true,
    data: {
      path: typeof raw.path === 'string' ? raw.path : path,
      entries,
    },
  };
}

async function listSubdirs(path: string): Promise<string[]> {
  try {
    const res = await scanDir(path);
    if (!res.ok || !res.data) return [];
    return res.data.entries
      .filter((e) => e.kind === 'dir')
      .map((e) => e.path);
  } catch {
    return [];
  }
}

async function selectDirectory(): Promise<IpcResult<string>> {
  const res = await ipcCall<{ path: string }>('dms_select_directory');
  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? 'dms_select_directory failed' };
  }
  return { ok: true, data: res.data.path };
}

async function selectFiles(): Promise<IpcResult<string[]>> {
  const res = await ipcCall<{ paths: string[] }>('dms_select_files');
  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? 'dms_select_files failed' };
  }
  return { ok: true, data: res.data.paths ?? [] };
}

async function createDir(path: string): Promise<IpcResult<void>> {
  return ipcCall('dms_create_dir', path);
}

async function pathExists(
  path: string,
): Promise<IpcResult<{ exists: boolean; isDir: boolean }>> {
  return ipcCall<{ exists: boolean; isDir: boolean }>('dms_path_exists', path);
}

async function savePreference(key: string, value: string): Promise<void> {
  if (typeof window.saucer?.exposed?.dms_save_preference === 'function') {
    await ipcCall('dms_save_preference', key, value);
  } else {
    localStorage.setItem('pref:' + key, value);
  }
}

async function loadPreference(key: string): Promise<string | null> {
  const res = await ipcCall<{ value: string | null }>('dms_load_preference', key);
  if (res.ok && res.data) {
    return res.data.value;
  }
  return localStorage.getItem('pref:' + key);
}

// ---------------------------------------------------------------------------
// Exported service object
// ---------------------------------------------------------------------------

export const fileService = {
  /**
   * List immediate children of `path`.
   * Uses `dms_scan_dir` binding (always registered by the C++ host).
   */
  scanDir,

  /**
   * Convenience: return only the subdirectory paths of `path`.
   * Useful for breadcrumb chevron menus.
   */
  listSubdirs,

  /**
   * Open a native OS folder picker.
   * Returns the chosen absolute path or an error if cancelled.
   */
  selectDirectory,

  /**
   * Open a native OS multi-file picker.
   * Returns absolute paths of selected files (empty array if cancelled).
   */
  selectFiles,

  /** Create a directory (and all parents). */
  createDir,

  /** Check whether a path exists and whether it is a directory. */
  pathExists,

  /**
   * Persist a string preference.
   * Uses dms_save_preference when the C++ host is present;
   * falls back to localStorage in browser dev mode.
   */
  savePreference,

  /**
   * Load a persisted string preference.
   * Falls back to localStorage when the C++ host is absent.
   * Returns null when the key has never been set.
   */
  loadPreference,
};
