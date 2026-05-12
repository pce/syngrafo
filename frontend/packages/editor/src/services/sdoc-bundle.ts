/**
 * @file services/sdoc-bundle.ts
 * Read and write the .sdoc bundle format.
 *
 * A .sdoc file is a plain ZIP archive:
 *   document.json        — SDM document envelope (syngrafo/1)
 *   assets/<filename>    — images and other embedded media
 *
 * Loading is done entirely in JS (fflate unzip).
 * Saving packs the ZIP in JS and writes binary bytes via the
 * `dms_write_base64_file` IPC binding (C++ decodes base64, writes raw bytes).
 *
 * The backend only participates via dms_fetch_data_url (read) and
 * dms_write_base64_file (write) — no C++ ZIP knowledge needed.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { decodeDocument, encodeDocument } from "../models/project";
import type { SBlock, SDocument } from "../models/sdm";
import { ipcRawCall, parseIpcResult } from "./ipc";


const MIME: Record<string, string> = {
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  webp: "image/webp",
  svg:  "image/svg+xml",
  avif: "image/avif",
};

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}


/** Decode a data-URL (or bare base64 string) to a Uint8Array. */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64    = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)!;
  return bytes;
}

/** Encode a Uint8Array to a base64 string (no data-URL prefix). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}


export interface SdocBundle {
  document: SDocument;
  /**
   * Map of "asset://filename" → object/blob URL.
   * Register these into the useAssetSrc blob store so images render immediately.
   */
  assets: Map<string, string>;
}

/**
 * Unzip a .sdoc bundle from a data-URL (as returned by dms_fetch_data_url).
 * Returns the parsed SDocument and a map of asset:// URIs to blob URLs.
 */
export function loadSdocBundle(dataUrl: string): SdocBundle {
  const bytes = dataUrlToBytes(dataUrl);
  const files = unzipSync(bytes);

  const docBytes = files["document.json"];
  if (!docBytes) throw new Error(".sdoc bundle is missing document.json");

  const document = decodeDocument(strFromU8(docBytes));

  const assets = new Map<string, string>();
  for (const [entryPath, data] of Object.entries(files)) {
    if (!entryPath.startsWith("assets/")) continue;
    const filename = entryPath.slice("assets/".length);
    if (!filename) continue;
    const blob = new Blob([data.buffer as ArrayBuffer], { type: guessMime(filename) });
    assets.set(`asset://${filename}`, URL.createObjectURL(blob));
  }

  return { document, assets };
}

// ── Save ─────────────────────────────────────────────────────────────────────

export interface SdocAsset {
  /** e.g. "Logo.png" — the filename inside assets/ */
  filename: string;
  data:     Uint8Array;
}

/**
 * Pack an SDocument and its assets into a .sdoc ZIP.
 * Returns the raw bytes of the archive.
 *
 * @param doc     The document to serialise (NLP annotations are stripped).
 * @param assets  Asset files to embed.  Pass an empty array for text-only docs.
 */
export function createSdocBundle(doc: SDocument, assets: SdocAsset[] = []): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "document.json": strToU8(encodeDocument(doc)),
  };
  for (const { filename, data } of assets) {
    entries[`assets/${filename}`] = data;
  }
  return zipSync(entries, { level: 6 });
}


/** Collect all unique embedded/local image references from a block tree. */
function collectAssetRefs(blocks: SBlock[]): string[] {
  const refs = new Set<string>();
  function walk(b: SBlock) {
    // SImgBlock has .src; other blocks may have children
    if (b.type === "img") {
      const src = (b as { src: string }).src;
      if (src?.startsWith("asset://") || src?.startsWith("local://")) refs.add(src);
    }
    const children = (b as { children?: SBlock[] }).children;
    if (Array.isArray(children)) children.forEach(walk);
  }
  blocks.forEach(walk);
  return [...refs];
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[\/\\:*?"<>|]/g, "-").trim();
  return cleaned || "asset";
}

function uniqueFilename(base: string, used: Set<string>): string {
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let candidate = base;
  let seq = 2;
  while (used.has(candidate)) {
    candidate = `${stem}-${seq}${ext}`;
    seq += 1;
  }
  used.add(candidate);
  return candidate;
}

/** Fetch a blob URL and return its raw bytes. */
async function blobUrlToBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch blob: ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function pathToBytes(path: string): Promise<Uint8Array> {
  const raw = await ipcRawCall("dms_fetch_data_url", path);
  const dataUrl = parseIpcResult<{ data_url: string }>(raw).data?.data_url;
  if (!dataUrl) throw new Error(`Could not read asset: ${path}`);
  return dataUrlToBytes(dataUrl);
}

function rewriteImageRefs(blocks: SBlock[], mapping: Map<string, string>): SBlock[] {
  return blocks.map((block) => {
    const nextSrc = block.type === "img" ? mapping.get(block.src) : undefined;
    const children = (block as { children?: SBlock[] }).children;
    const nextChildren = Array.isArray(children) ? rewriteImageRefs(children, mapping) : undefined;
    if (!nextSrc && nextChildren === children) return block;
    return {
      ...block,
      ...(nextSrc ? { src: nextSrc } : {}),
      ...(nextChildren ? { children: nextChildren } : {}),
    } as SBlock;
  });
}


export interface SaveSdocResult {
  /** Number of raw bytes written to disk. */
  bytes: number;
  /** asset:// URIs referenced by the doc that were NOT found in assetBlobs. */
  missingAssets: string[];
}

/**
 * Pack the current document + its in-memory assets into a new .sdoc ZIP and
 * write it to `path` via the `dms_write_base64_file` IPC binding.
 *
 * @param path        Absolute path to write (must end in .sdoc).
 * @param doc         The SDocument to save (NLP fields are stripped by encodeDocument).
 * @param assetBlobs  Snapshot of the asset-URI → blob-URL map from useAssetSrc.
 *                    Obtain with `getAssetBlobEntries()` before calling.
 */
export async function saveSdocToPath(
  path: string,
  doc: SDocument,
  assetBlobs: Map<string, string>,
): Promise<SaveSdocResult> {
  // 1. Collect all asset:// references used in the document
  const refs = collectAssetRefs(doc.blocks);

  // 2. Fetch raw bytes for each referenced asset
  const assets: SdocAsset[] = [];
  const missingAssets: string[] = [];
  const remappedRefs = new Map<string, string>();
  const usedFilenames = new Set<string>();

  for (const ref of refs) {
    if (ref.startsWith("asset://")) {
      const blobUrl = assetBlobs.get(ref);
      if (!blobUrl) {
        missingAssets.push(ref);
        continue;
      }
      const filename = uniqueFilename(sanitizeFilename(ref.slice("asset://".length)), usedFilenames);
      const data = await blobUrlToBytes(blobUrl);
      assets.push({ filename, data });
      remappedRefs.set(ref, `asset://${filename}`);
      continue;
    }
    if (ref.startsWith("local://")) {
      const localPath = ref.slice("local://".length);
      try {
        const leaf = localPath.split(/[\\/]/).pop() ?? "image";
        const filename = uniqueFilename(sanitizeFilename(leaf), usedFilenames);
        const data = await pathToBytes(localPath);
        assets.push({ filename, data });
        remappedRefs.set(ref, `asset://${filename}`);
      } catch {
        missingAssets.push(ref);
      }
    }
  }

  const bundleDoc = remappedRefs.size > 0
    ? { ...doc, blocks: rewriteImageRefs(doc.blocks, remappedRefs) }
    : doc;

  // 3. Pack into a ZIP
  const zipBytes = createSdocBundle(bundleDoc, assets);

  // 4. Convert to base64 and write via IPC
  const b64 = bytesToBase64(zipBytes);
  const raw = await ipcRawCall("dms_write_base64_file", path, b64);
  if (raw === null) throw new Error("dms_write_base64_file IPC binding not available");

  const result = JSON.parse(raw) as { ok: boolean; error?: string; data?: { bytes: number } };
  if (!result.ok) throw new Error(result.error ?? "Failed to write .sdoc file");

  return {
    bytes: result.data?.bytes ?? zipBytes.length,
    missingAssets,
  };
}
