/**
 * @file hooks/useAssetSrc.ts
 * Resolves asset:// and local:// image src strings to renderable data URLs
 * via the dms_fetch_data_url IPC binding.
 *
 * asset://filename  →  resolved relative to the loaded document's directory
 * local:///abs/path →  used directly as the filesystem path
 * http/https/data:  →  returned unchanged
 */

import { useEffect, useState } from "react";
import { ipcRawCall } from "../services/ipc";
import { useEditor } from "../store/editor-store";

/** Module-level cache so repeated renders don't re-fetch. */
const cache = new Map<string, string>();

/**
 * In-memory blob-URL store for assets unpacked from a .sdoc bundle.
 * Populated by ExportPanel when a .sdoc file is loaded.
 * Checked before any IPC fetch so bundle assets render with zero latency.
 */
const blobStore = new Map<string, string>();

/** Register an asset URI → blob URL (called during .sdoc load). */
export function setAssetBlob(assetUri: string, blobUrl: string): void {
  blobStore.set(assetUri, blobUrl);
  cache.delete(assetUri); // invalidate any stale IPC-fetched entry
}

/** Clear all bundle assets (called before loading a new .sdoc). */
export function clearAssetBlobs(): void {
  for (const url of blobStore.values()) URL.revokeObjectURL(url);
  blobStore.clear();
  cache.clear();
}

function resolveToPath(src: string, docPath: string | null): string | null {
  if (src.startsWith("local://")) {
    return src.slice("local://".length);
  }
  if (src.startsWith("asset://")) {
    const filename = src.slice("asset://".length);
    if (!docPath) return null;
    const dir = docPath.substring(0, docPath.lastIndexOf("/"));
    return `${dir}/${filename}`;
  }
  return null;
}

function isUnresolvable(src: string): boolean {
  return !src.startsWith("asset://") && !src.startsWith("local://");
}

/**
 * Resolves an image src to a renderable URL.
 * Returns an empty string while the fetch is in-flight (show a placeholder).
 */
export function useAssetSrc(src: string): string {
  const { state } = useEditor();
  const docPath  = state.documentPath;
  const cacheKey = `${docPath ?? ""}|${src}`;

  const [resolved, setResolved] = useState<string>(() => {
    if (isUnresolvable(src)) return src;
    if (blobStore.has(src))  return blobStore.get(src)!;
    return cache.get(cacheKey) ?? "";
  });

  useEffect(() => {
    if (isUnresolvable(src)) {
      setResolved(src);
      return;
    }
    // Bundle asset available synchronously — no IPC needed
    if (blobStore.has(src)) {
      setResolved(blobStore.get(src)!);
      return;
    }
    if (cache.has(cacheKey)) {
      setResolved(cache.get(cacheKey)!);
      return;
    }
    const absPath = resolveToPath(src, docPath);
    if (!absPath) return;

    let cancelled = false;

    ipcRawCall("dms_fetch_data_url", absPath)
      .then(raw => {
        if (cancelled || !raw) return;
        try {
          // dms_fetch_data_url returns { ok, data: { data_url } }
          const envelope = JSON.parse(raw) as { ok: boolean; data?: { data_url: string } };
          const dataUrl  = envelope.data?.data_url;
          if (dataUrl) {
            cache.set(cacheKey, dataUrl);
            setResolved(dataUrl);
          }
        } catch { /* ignore parse errors — placeholder stays */ }
      })
      .catch(() => { /* network / IPC failure — placeholder stays */ });

    return () => { cancelled = true; };
  }, [src, docPath, cacheKey]);

  return resolved;
}
