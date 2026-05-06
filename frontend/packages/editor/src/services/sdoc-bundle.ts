/**
 * @file services/sdoc-bundle.ts
 * Read and write the .sdoc bundle format.
 *
 * A .sdoc file is a plain ZIP archive:
 *   document.json        — SDM document envelope (syngrafo/1)
 *   assets/<filename>    — images and other embedded media
 *
 * Loading is done entirely in JS (fflate unzip).
 * Saving produces a Uint8Array that must be written to disk by the caller
 * (e.g. via dms_write_file after base64-encoding, or a future binary IPC).
 *
 * The backend only participates via dms_fetch_data_url (read) and
 * dms_write_file (write) — no C++ ZIP knowledge needed.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { decodeDocument, encodeDocument } from "../models/project";
import type { SDocument } from "../models/sdm";

// ── MIME helpers ─────────────────────────────────────────────────────────────

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

// ── Data-URL helpers ─────────────────────────────────────────────────────────

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

// ── Load ─────────────────────────────────────────────────────────────────────

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
  /** e.g. "VHCLogo.png" — the filename inside assets/ */
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
