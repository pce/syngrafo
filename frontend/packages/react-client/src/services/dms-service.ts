//
// Document Management System — saucer expose() bindings.
//
// Saucer IPC: C++ bindings are accessed via window.saucer.call(name, args)
// or window.saucer.exposed.name(...args) — NOT via window.dms_name() directly.
//
// C++ response shapes are mapped to the TS interfaces below so components
// never need to know about C++ field naming conventions.
//

import type { NlpEnvelope } from "./nlp-service";

// DMS payload types (TS-canonical, component-friendly)

export type FsEntryKind = "file" | "dir" | "symlink";

export interface FsEntry {
  name:      string;
  path:      string;        // absolute path
  kind:      FsEntryKind;
  size?:     number;        // bytes
  modified?: number;        // Unix ms
  mime?:     string;        // guessed from extension
  indexed?:  boolean;       // has a record in the DMS index
}

export interface DirTree {
  path:    string;
  entries: FsEntry[];
}

export interface ReadFileResult {
  path:       string;
  filename:   string;
  content:    string | null;  // null for binary files
  size:       number;
  mtime:      number;
  mimeType:   string;
  lineCount:  number;
  truncated:  boolean;
  binary:     boolean;
}

export interface IndexResult {
  docId:         number;
  path:          string;
  filename:      string;
  mimeType:      string;
  snippet:       string;
  keywords:      Keyword[];
  entities:      Entity[];
  sentiment:     number;
  sentimentLabel:string;
  lang:          string;
  dimensions:    number;
  indexedAt:     number;
  unchanged:     boolean;
}

export interface BulkIndexResult {
  taskId:     string;
  totalFiles: number;
}

export interface SearchResult {
  docId:     number;
  path:      string;
  filename:  string;
  score:     number;
  snippet:   string;
  mimeType:  string;
  keywords:  Keyword[];
  sentiment: number;
  lang:      string;
}

export interface SearchResults {
  strategy: "semantic" | "keyword";
  query:    string;
  results:  SearchResult[];
}

export interface IndexStatus {
  totalDocs:     number;
  bulkActive:    boolean;
  lastIndexedAt: number;
}

export interface DocMetadata {
  docId:          number;
  path:           string;
  filename:       string;
  extension:      string;
  mimeType:       string;
  sizeBytes:      number;
  mtime:          number;
  indexedAt:      number;
  snippet:        string;
  keywords:       Keyword[];
  entities:       Entity[];
  sentiment:      number;
  sentimentLabel: string;
  lang:           string;
  hasEmbedding:   boolean;
  dimensions:     number;
}

/** A Zone is a named project workspace.
 *  `in_path`  = source folder (user's original documents)
 *  `out_path` = workspace folder (Papiere index + processed files)
 */
export interface Zone {
  in_path:         string;
  out_path:        string;
  name:            string;
  description:     string;
  taxonomy_domain: string;
}

export interface ZoneHistoryItem {
  name:            string;
  in_path:         string;
  out_path:        string;
  last_visited:    number;
  description:     string;
  taxonomy_domain: string;
  /** True when the zone DB is AES-256 encrypted via SQLCipher. */
  is_encrypted?:   boolean;
}

export interface OcrResult {
  text:   string;
  cached: boolean;
  quality?: "ok" | "low" | "garbage";
}

/** Target kind for a bookmark — a folder or anything else (file, image, …). */
export type BookmarkKind = "file" | "folder";

/**
 * A Bookmark is a named quick-jump target that lives inside a Zone.
 *
 * `target` is a zone-relative materialized path, e.g.:
 *   - `path/to/file.py`        → whole file
 *   - `path/to/file.py?10:12`  → line range 10–12 (inclusive)
 *   - `path/to/file.py?10:`    → from line 10 to EOF
 *   - `path/to/folder/`        → directory (trailing slash)
 *   - `path/to/image.png`      → image file (kind = "file")
 *
 * Canonical URI:  `/#<zoneName>/<target>`
 */
export interface Bookmark {
  id:         number;
  zone_name:  string;
  label:      string;
  /** Zone-relative path, optionally with `?<from>:<to>` suffix. */
  target:     string;
  kind:       BookmarkKind;
  line_from:  number;   // 0 = not specified
  line_to:    number;   // 0 = not specified (open range)
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface BookmarkResolveResult {
  abs_path:  string;
  line_from: number;
  line_to:   number;
  kind:      BookmarkKind;
  exists:    boolean;
  zone_name: string;
  target:    string;
}


/**
 * Build the canonical display URI for a bookmark:
 *   `/#<zoneName>/<target>`
 */
export function bookmarkUri(zoneName: string, target: string): string {
  return `/#${zoneName}/${target}`;
}

/**
 * Parse a canonical bookmark URI (`/#<zone>/<target>`) back into its parts.
 * Returns `null` if the string is not a valid bookmark URI.
 */
export function parseBookmarkUri(uri: string): { zone: string; target: string } | null {
  if (!uri.startsWith("/#")) return null;
  const rest = uri.slice(2);               // "<zone>/<target>"
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  return { zone: rest.slice(0, slash), target: rest.slice(slash + 1) };
}

/**
 * Parse the `?<from>:<to>` suffix out of a zone-relative target string.
 * Returns the bare path and (optionally) the line numbers.
 */
export function parseBookmarkTarget(target: string): {
  path:      string;
  lineFrom?: number;
  lineTo?:   number;
} {
  const q = target.lastIndexOf("?");
  if (q < 0) return { path: target };
  const spec  = target.slice(q + 1);
  const colon = spec.indexOf(":");
  if (colon < 0) return { path: target }; // no colon → treat whole string as path
  const fromStr = spec.slice(0, colon);
  const toStr   = spec.slice(colon + 1);
  const lineFrom = fromStr ? parseInt(fromStr, 10) : undefined;
  const lineTo   = toStr   ? parseInt(toStr,   10) : undefined;
  if (lineFrom !== undefined && isNaN(lineFrom)) return { path: target };
  return { path: target.slice(0, q), lineFrom, lineTo };
}

export interface PaletteEntry {
  r: number; g: number; b: number;
  hex: string;
  count: number;
  pct: number;
}
export interface RgbHistogram { r: number[]; g: number[]; b: number[]; }
export interface ImageAnalysis {
  width: number; height: number;
  palette: PaletteEntry[];
  histogram: RgbHistogram;
}
export type SvgPalette =
  | "db8" | "db16" | "db32"
  | "spectrum14" | "spectrum16"
  | "auto8" | "auto16" | "auto32";
export interface SvgConvertOpts {
  palette?: SvgPalette;
  smooth?: boolean;
  gridSize?: number;
}

export interface Keyword {
  term:       string;
  frequency:  number;
  tfidfScore: number;
  pos:        string;
}

export interface Entity {
  text:       string;
  type:       string;
  position:   number;
  confidence: number;
}


export type ProgressPhase = "start" | "indexing" | "complete";

export interface DmsProgressEvent {
  phase:   ProgressPhase;
  file?:   string;
  done:    number;
  total:   number;
  errors:  number;
}

// Saucer call helper
//
// window.saucer.exposed is a JS Proxy: any property access returns a function
// that calls the named C++ binding.  typeof exposed.anything === "function"
// is always true, so the guard below only fires when the saucer bridge itself
// is absent (i.e. the page is opened in a normal browser).

function binding(name: string): ((...args: unknown[]) => Promise<string>) | undefined {
  return window.saucer?.exposed?.[name];
}

async function call<T>(
  fn: ((...args: unknown[]) => Promise<string>) | undefined,
  ...args: unknown[]
): Promise<NlpEnvelope<T>> {
  if (typeof fn !== "function") {
    return { ok: false, error: "DMS binding not available — C++ host not connected" };
  }
  try {
    const raw = await fn(...args);
    return JSON.parse(raw) as NlpEnvelope<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// C++ → TS shape mappers
// C++ uses snake_case and some field names differ from our TS conventions.
// All translation happens here so components never see raw C++ shapes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEntry(raw: any): FsEntry {
  return {
    name:     String(raw.name ?? ""),
    path:     String(raw.path ?? ""),
    kind:     raw.is_dir ? "dir" : "file",
    size:     typeof raw.size === "number" ? raw.size : undefined,
    modified: typeof raw.mtime === "number" ? raw.mtime * 1000 : undefined,
    mime:     typeof raw.mime_type === "string" ? raw.mime_type : undefined,
    indexed:  !!raw.indexed,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDirTree(raw: any): DirTree {
  return {
    path:    String(raw.path ?? ""),
    entries: Array.isArray(raw.items) ? raw.items.map(mapEntry) : [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapKeyword(raw: any): Keyword {
  return {
    term:       String(raw.term ?? ""),
    frequency:  Number(raw.frequency ?? 0),
    tfidfScore: Number(raw.tfidf_score ?? 0),
    pos:        String(raw.pos ?? ""),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEntity(raw: any): Entity {
  return {
    text:       String(raw.text ?? ""),
    type:       String(raw.type ?? ""),
    position:   Number(raw.position ?? 0),
    confidence: Number(raw.confidence ?? 0),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapKeywords(raw: any): Keyword[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(mapKeyword);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEntities(raw: any): Entity[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(mapEntity);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapReadFile(raw: any): ReadFileResult {
  return {
    path:      String(raw.path ?? ""),
    filename:  String(raw.filename ?? ""),
    content:   raw.binary ? null : (typeof raw.content === "string" ? raw.content : null),
    size:      Number(raw.size ?? 0),
    mtime:     Number(raw.mtime ?? 0),
    mimeType:  String(raw.mime_type ?? ""),
    lineCount: Number(raw.line_count ?? 0),
    truncated: !!raw.truncated,
    binary:    !!raw.binary,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIndexResult(raw: any): IndexResult {
  return {
    docId:          Number(raw.doc_id ?? 0),
    path:           String(raw.path ?? ""),
    filename:       String(raw.filename ?? ""),
    mimeType:       String(raw.mime_type ?? ""),
    snippet:        String(raw.snippet ?? ""),
    keywords:       mapKeywords(raw.keywords),
    entities:       mapEntities(raw.entities),
    sentiment:      Number(raw.sentiment ?? 0),
    sentimentLabel: String(raw.sentiment_label ?? "neutral"),
    lang:           String(raw.lang ?? "en"),
    dimensions:     Number(raw.dimensions ?? 0),
    indexedAt:      Number(raw.indexed_at ?? 0),
    unchanged:      !!raw.unchanged,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSearchResult(raw: any): SearchResult {
  return {
    docId:     Number(raw.doc_id ?? 0),
    path:      String(raw.path ?? ""),
    filename:  String(raw.filename ?? ""),
    score:     Number(raw.score ?? 0),
    snippet:   String(raw.snippet ?? ""),
    mimeType:  String(raw.mime_type ?? ""),
    keywords:  mapKeywords(raw.keywords),
    sentiment: Number(raw.sentiment ?? 0),
    lang:      String(raw.lang ?? "en"),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSearchResults(raw: any): SearchResults {
  return {
    strategy: raw.strategy === "semantic" ? "semantic" : "keyword",
    query:    String(raw.query ?? ""),
    results:  Array.isArray(raw.results) ? raw.results.map(mapSearchResult) : [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIndexStatus(raw: any): IndexStatus {
  return {
    totalDocs:     Number(raw.total_docs ?? 0),
    bulkActive:    !!raw.bulk_active,
    lastIndexedAt: Number(raw.last_indexed_at ?? 0),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocMetadata(raw: any): DocMetadata {
  return {
    docId:          Number(raw.doc_id ?? 0),
    path:           String(raw.path ?? ""),
    filename:       String(raw.filename ?? ""),
    extension:      String(raw.extension ?? ""),
    mimeType:       String(raw.mime_type ?? ""),
    sizeBytes:      Number(raw.size_bytes ?? 0),
    mtime:          Number(raw.mtime ?? 0),
    indexedAt:      Number(raw.indexed_at ?? 0),
    snippet:        String(raw.snippet ?? ""),
    keywords:       mapKeywords(raw.keywords),
    entities:       mapEntities(raw.entities),
    sentiment:      Number(raw.sentiment ?? 0),
    sentimentLabel: String(raw.sentiment_label ?? "neutral"),
    lang:           String(raw.lang ?? "en"),
    hasEmbedding:   !!raw.has_embedding,
    dimensions:     Number(raw.dimensions ?? 0),
  };
}


export const dms = {

  /**
   * List immediate children of `path`.
   * Pass recursive=true to walk the entire subtree.
   */
  scanDir: async (path: string, recursive = false): Promise<NlpEnvelope<DirTree>> => {
    const res = await call<unknown>(binding("dms_scan_dir"), path, recursive);
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return { ok: true, data: mapDirTree(res.data) };
  },

  /** Read a UTF-8 text file (up to 10 MiB). Binary files return content=null. */
  readFile: async (path: string): Promise<NlpEnvelope<ReadFileResult>> => {
    const res = await call<unknown>(binding("dms_read_file"), path);
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return { ok: true, data: mapReadFile(res.data) };
  },

  /** Write (create or overwrite) a UTF-8 text file. */
  writeFile: async (path: string, content: string): Promise<NlpEnvelope<{ written: boolean }>> => {
    return call<{ written: boolean }>(binding("dms_write_file"), path, content);
  },

  /**
   * Embed + NLP-analyse + persist a single document.
   * Returns full NLP metadata including keywords, entities, sentiment.
   */
  indexDocument: async (path: string): Promise<NlpEnvelope<IndexResult>> => {
    const res = await call<unknown>(binding("dms_index_document"), path);
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return { ok: true, data: mapIndexResult(res.data) };
  },

  /**
   * Walk `dir` recursively, indexing every text file.
   * Returns immediately with { taskId, totalFiles }.
   * Progress arrives via window.__dms_progress callbacks from C++.
   * Cancel via dms.bulkStop().
   */
  bulkIndex: async (dir: string): Promise<NlpEnvelope<BulkIndexResult>> => {
    const res = await call<{task_id: string; total_files: number}>(
      binding("dms_bulk_index"), dir
    );
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return {
      ok: true,
      data: { taskId: res.data.task_id, totalFiles: res.data.total_files },
    };
  },

  /** Request cooperative cancellation of the running bulk index. */
  bulkStop: (): Promise<NlpEnvelope<{ stopped: boolean }>> =>
    call<{ stopped: boolean }>(binding("dms_bulk_stop")),

  /** Re-index the active zone's workspace directory in the background. */
  bulkIndexZone: async (): Promise<NlpEnvelope<{ task_id: string; total_files: number }>> => {
    return call<{ task_id: string; total_files: number }>(binding("dms_bulk_index_zone"));
  },

  /**
   * Semantic search (cosine similarity) with keyword-LIKE fallback when ONNX
   * is unavailable.  Returns up to `topK` results sorted by score descending.
   */
  search: async (query: string, topK = 10): Promise<NlpEnvelope<SearchResults>> => {
    const res = await call<unknown>(binding("dms_search"), query, topK);
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return { ok: true, data: mapSearchResults(res.data) };
  },

  /** Total indexed documents, bulk-active flag, last indexed timestamp. */
  indexStatus: async (): Promise<NlpEnvelope<IndexStatus>> => {
    const res = await call<unknown>(binding("dms_index_status"));
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return { ok: true, data: mapIndexStatus(res.data) };
  },

  /** All stored NLP metadata for a specific file path. */
  getMetadata: async (path: string): Promise<NlpEnvelope<DocMetadata>> => {
    const res = await call<unknown>(binding("dms_get_metadata"), path);
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return { ok: true, data: mapDocMetadata(res.data) };
  },

  /** EXIF / image metadata for an image file (on-demand, no DB required). */
  getExif: async (path: string): Promise<NlpEnvelope<Record<string, unknown>>> => {
    return call<Record<string, unknown>>(binding("dms_get_exif"), path);
  },

  /** Get the list of recently visited zones. */
  getZones: async (): Promise<NlpEnvelope<ZoneHistoryItem[]>> => {
    return call<ZoneHistoryItem[]>(binding("dms_get_zones"));
  },

  /** Save or update a zone in history.
   * Pass `password` to enable AES-256 encryption on the zone's SQLite DB
   * (requires the app to be linked against SQLCipher). The raw password is
   * never stored — only a PBKDF2-SHA256 derived key is persisted. */
  upsertZone: async (
    name: string,
    inPath: string,
    outPath: string,
    description = "",
    taxonomyDomain = "General",
    password?: string,
  ): Promise<NlpEnvelope<{ok: boolean}>> => {
    return call<{ok: boolean}>(
      binding("dms_upsert_zone"),
      name, inPath, outPath,
      password ?? null,   // 4th arg = optional password (null → unencrypted)
      description,
      taxonomyDomain,
    );
  },

  /** Perform OCR on an image file. */
  ocrDocument: async (path: string, zoneName = ""): Promise<NlpEnvelope<OcrResult>> => {
    return call<OcrResult>(binding("dms_ocr_document"), path, zoneName);
  },

  /** Open a native directory picker. Returns the chosen absolute path, or "" if cancelled. */
  selectDirectory: async (): Promise<NlpEnvelope<string>> => {
    // The C++ binding returns { path: string } inside the envelope data.
    const res = await call<{ path: string }>(binding("dms_select_directory"));
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, data: res.data?.path ?? "" };
  },

  /** Open a native multi-file picker. Returns absolute paths of selected files.
   *  Empty array if the user cancels. */
  selectFiles: async (): Promise<NlpEnvelope<{ paths: string[] }>> => {
    return call<{ paths: string[] }>(binding("dms_select_files"));
  },

  /** Strategic move/copy into a zone with optional processing. */
  importToZone: async (path: string, zoneName: string, compress = false, scan = false): Promise<NlpEnvelope<{ok: boolean, dest: string, meta: any}>> => {
    return call<{ok: boolean, dest: string, meta: any}>(binding("dms_import_to_zone"), path, zoneName, compress, scan);
  },

  /** Open a zone-specific database or return to global. */
  openZoneDb: async (zoneName: string, password?: string): Promise<NlpEnvelope<{ status: string; zone?: string }>> => {
    const res = await call<{ status: string; zone?: string }>(binding("dms_open_zone_db"), zoneName, password);
    return res;
  },

  async fileToZone(path: string, zoneName: string): Promise<NlpEnvelope<{ dest: string }>> {
    return call<{ dest: string }>(binding("dms_file_to_zone"), path, zoneName);
  },

  /** Rectify a document image. */
  rectifyDocument: async (path: string, outPath?: string): Promise<NlpEnvelope<{ success: boolean; outPath: string }>> => {
    return call<{ success: boolean; outPath: string }>(binding("dms_rectify_document"), path, outPath ?? null);
  },

  /** Export an image to PDF. */
  exportPdf: async (srcPath: string, outPath: string): Promise<NlpEnvelope<{ success: boolean; outPath: string }>> => {
    return call<{ success: boolean; outPath: string }>(binding("dms_export_pdf"), srcPath, outPath);
  },

  /** Convert a raster image to SVG using greedy rect-merge. Saves next to source. */
  imageToSvg: async (path: string, opts: SvgConvertOpts = {}): Promise<NlpEnvelope<{ outPath: string; palette: string; colors: number }>> => {
    return call<{ outPath: string; palette: string; colors: number }>(
      binding("dms_image_to_svg"),
      JSON.stringify({ path, ...opts })
    );
  },

  /** Convert a raster image to SVG using connected-component polygon boundary tracing. */
  imageToSvgPoly: async (path: string, opts: SvgConvertOpts = {}): Promise<NlpEnvelope<{ outPath: string; palette: string; colors: number }>> => {
    return call<{ outPath: string; palette: string; colors: number }>(
      binding("dms_image_to_svg_poly"),
      JSON.stringify({ path, ...opts })
    );
  },

  /** Convert a raster image to low-poly triangulated SVG. */
  imageToSvgTri: async (path: string, opts: SvgConvertOpts = {}): Promise<NlpEnvelope<{ outPath: string; palette: string; colors: number; gridSize: number }>> => {
    return call<{ outPath: string; palette: string; colors: number; gridSize: number }>(
      binding("dms_image_to_svg_tri"),
      JSON.stringify({ path, ...opts })
    );
  },

  /** Extract colour palette + RGB histogram from a raster image (no file saved). */
  imageAnalyze: async (path: string, palette: string = "auto16"): Promise<NlpEnvelope<ImageAnalysis>> => {
    return call<ImageAnalysis>(
      binding("dms_image_analyze"),
      JSON.stringify({ path, palette })
    );
  },

  /** Always-available file stats — DB-first, FS fallback. Never requires indexing. */
  fileStats: (path: string) =>
    call<FileStats>(binding("dms_file_stats"), path),

  /** Lightweight DB registration (no NLP). Idempotent INSERT OR IGNORE.
   *  Call fire-and-forget whenever any file is selected so that every viewed
   *  file becomes queryable by kind/size/ext even before explicit indexing. */
  registerFile: (path: string) =>
    call<{ registered: boolean; kind: string; size?: number; mtime?: number }>(
      binding("dms_register_file"), path
    ),

  /**
   * Fetch an arbitrary local file as a `data:<mime>;base64,...` URL.
   * Use this instead of `local://local{path}` for files outside the app bundle,
   * e.g. images the user browses to in their home directory.
   */
  fetchDataUrl: async (path: string): Promise<NlpEnvelope<{ dataUrl: string }>> => {
    const res = await call<{ data_url: string }>(binding("dms_fetch_data_url"), path);
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return { ok: true, data: { dataUrl: res.data.data_url } };
  },

  /** Check whether a filesystem path exists. */
  pathExists: async (path: string): Promise<NlpEnvelope<{ exists: boolean; isDir: boolean }>> => {
    const res = await call<{ exists: boolean; is_dir: boolean }>(binding("dms_path_exists"), path);
    if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
    return { ok: true, data: { exists: res.data.exists, isDir: res.data.is_dir } };
  },

  /**
   * Resolve a network/virtual URL (smb://, afp://, nfs://, ftp://, cifs://) to
   * a local filesystem path.  Returns `mounted: true` + `resolved` when the
   * share is already mounted.  Returns `mounted: false` + `open_url` when it
   * isn't — the UI can use this to prompt the user to mount the share.
   */
  resolveNetworkPath: async (path: string): Promise<NlpEnvelope<{
    resolved:   string;
    mounted:    boolean;
    scheme:     string;
    host?:      string;
    share?:     string;
    mount_hint?: string;
    open_url?:  string;
  }>> => {
    return call(binding("dms_resolve_network_path"), path);
  },

  /** Create a directory (and all parents) if it does not already exist. */
  createDir: async (path: string): Promise<NlpEnvelope<{ created: boolean; path: string }>> => {
    return call<{ created: boolean; path: string }>(binding("dms_create_dir"), path);
  },


  /**
   * Copy one or more files/dirs into `destDir`.
   * Calls C++ binding `dms_copy_files(sources_json, destDir, conflict)`.
   * `conflict` = "replace" | "keep" | "skip"  (default "keep")
   */
  copyFiles: async (
    sources: string[],
    destDir: string,
    conflict: "replace" | "keep" | "skip" = "keep",
  ): Promise<NlpEnvelope<{ copied: number; skipped: number; errors: string[] }>> => {
    return call(binding("dms_copy_files"), JSON.stringify(sources), destDir, conflict);
  },

  /**
   * Move one or more files/dirs into `destDir`.
   * Calls C++ binding `dms_move_files(sources_json, destDir, conflict)`.
   */
  moveFiles: async (
    sources: string[],
    destDir: string,
    conflict: "replace" | "keep" | "skip" = "keep",
  ): Promise<NlpEnvelope<{ moved: number; skipped: number; errors: string[] }>> => {
    return call(binding("dms_move_files"), JSON.stringify(sources), destDir, conflict);
  },

  /**
   * Permanently delete files/dirs.
   * Calls C++ binding `dms_delete_files(paths_json)`.
   */
  deleteFiles: async (
    paths: string[],
  ): Promise<NlpEnvelope<{ deleted: number; errors: string[] }>> => {
    return call(binding("dms_delete_files"), JSON.stringify(paths));
  },

  /**
   * Create a compressed archive from `sources`.
   * format: "zip" | "tar.gz" | "tar.bz2" | "tar.zst"
   * Calls C++ binding `dms_create_archive(sources_json, destPath, format)`.
   */
  createArchive: async (
    sources: string[],
    destPath: string,
    format: "zip" | "tar.gz" | "tar.bz2" | "tar.zst" = "zip",
  ): Promise<NlpEnvelope<{ path: string; sizeBytes: number }>> => {
    return call(binding("dms_create_archive"), JSON.stringify(sources), destPath, format);
  },

  /**
   * Compress a single file (in-place or to new path).
   * format: "gz" | "bz2" | "zst"
   * Calls C++ binding `dms_compress_file(srcPath, destPath, format, level)`.
   */
  compressFile: async (
    srcPath: string,
    destPath: string,
    format: "gz" | "bz2" | "zst" = "gz",
    level = 6,
  ): Promise<NlpEnvelope<{ path: string; sizeBytes: number; ratio: number }>> => {
    return call(binding("dms_compress_file"), srcPath, destPath, format, level);
  },

  /**
   * Share a file via the native share sheet (macOS) or copy path to clipboard.
   * Calls C++ binding `dms_share_file(path)`.
   */
  shareFile: async (
    path: string,
  ): Promise<NlpEnvelope<{ shared: boolean }>> => {
    return call(binding("dms_share_file"), path);
  },

  /**
   * Persist a string key-value preference in the global DB.
   * Falls back to localStorage when the C++ host is not connected.
   */
  savePreference: async (key: string, value: string): Promise<void> => {
    if (typeof window.saucer?.call === "function") {
      await call<unknown>(binding("dms_save_preference"), key, value);
    } else {
      localStorage.setItem(`pref:${key}`, value);
    }
  },

  /**
   * Load a previously saved preference from the global DB.
   * Falls back to localStorage when the C++ host is not connected.
   */
  loadPreference: async (key: string): Promise<string | null> => {
    if (typeof window.saucer?.call === "function") {
      const res = await call<{ value: string | null }>(binding("dms_load_preference"), key);
      return res.ok ? (res.data?.value ?? null) : null;
    } else {
      return localStorage.getItem(`pref:${key}`);
    }
  },

  /** True when running inside the saucer webview (C++ bindings present). */
  isConnected: (): boolean => typeof window.saucer?.call === "function",


  /**
   * Add a bookmark to a zone.
   * `target` is a zone-relative path (e.g. `"reports/q1.py?5:20"`).
   * Returns the newly created Bookmark.
   */
  bookmark: {
    add: async (
      zoneName: string,
      label: string,
      target: string,
    ): Promise<NlpEnvelope<Bookmark>> => {
      return call<Bookmark>(binding("dms_bookmark_add"), zoneName, label, target);
    },

    /**
     * List all bookmarks for a zone, sorted by sort_order then id.
     */
    list: async (zoneName: string): Promise<NlpEnvelope<Bookmark[]>> => {
      return call<Bookmark[]>(binding("dms_bookmark_list"), zoneName);
    },

    /**
     * Delete a bookmark by id.
     */
    delete: async (id: number): Promise<NlpEnvelope<{ deleted: boolean; id: number }>> => {
      return call<{ deleted: boolean; id: number }>(binding("dms_bookmark_delete"), id);
    },

    /**
     * Update label, target, and sort_order of a bookmark.
     * Returns the updated Bookmark.
     */
    update: async (
      id: number,
      label: string,
      target: string,
      sortOrder: number,
    ): Promise<NlpEnvelope<Bookmark>> => {
      return call<Bookmark>(binding("dms_bookmark_update"), id, label, target, sortOrder);
    },

    /**
     * Resolve a zone-relative target to an absolute filesystem path.
     * Parses `?<from>:<to>` line-range suffixes and determines `kind`.
     */
    resolve: async (
      zoneName: string,
      target: string,
    ): Promise<NlpEnvelope<BookmarkResolveResult>> => {
      return call<BookmarkResolveResult>(binding("dms_bookmark_resolve"), zoneName, target);
    },
  },
};

// Register the C++ progress callback
//
// C++ calls:
//   window.__dms_progress({ phase, file?, done, total, errors })
//
// Subscribe with:
//   dms.onProgress((ev) => { ... })
// Unsubscribe by calling the returned cleanup function.

type ProgressListener = (ev: DmsProgressEvent) => void;

export function onDmsProgress(listener: ProgressListener): () => void {
  const prev = (window as unknown as Record<string, unknown>)["__dms_progress"];

  (window as unknown as Record<string, unknown>)["__dms_progress"] =
    (ev: DmsProgressEvent) => {
      if (typeof prev === "function") (prev as ProgressListener)(ev);
      listener(ev);
    };

  return () => {
    (window as unknown as Record<string, unknown>)["__dms_progress"] = prev;
  };
}

//  MIME helpers
const TEXT_EXTS  = new Set([
  ".txt", ".md", ".markdown", ".rst", ".csv", ".json", ".xml",
  ".html", ".htm", ".log", ".yaml", ".yml", ".toml", ".ini",
  ".cfg", ".conf", ".env",
]);
const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp",
  ".heic", ".heif", ".avif", ".tga", ".gif", ".svg",
]);

const VIDEO_EXTS = new Set([
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".ogv", ".flv", ".wmv",
]);
const DOC_EXTS   = new Set([".pdf", ".docx", ".odt", ".rtf", ".doc"]);
const CODE_EXTS  = new Set([
  ".cpp", ".cc", ".cxx", ".c", ".h", ".hh", ".hpp",
  ".py", ".js", ".ts", ".jsx", ".tsx", ".rs", ".go",
  ".java", ".swift", ".kt", ".rb", ".sh", ".bash",
  ".zsh", ".sql", ".r", ".tex",
]);
const AUDIO_EXTS = new Set([
  ".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac", ".opus", ".wma",
]);
const MODEL3D_EXTS = new Set([
  ".ply", ".obj", ".gltf", ".glb", ".stl",
  ".splat", ".spz",           // Gaussian Splat formats
  ".xyz", ".pcd",             // Point cloud formats
]);
const ARCHIVE_EXTS = new Set([
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".tbz2",
]);
export const CSS_EXTS = new Set([".css", ".scss", ".sass", ".less"]);

/** True for any 3D / Gaussian-Splat / point-cloud file. */
export function is3DModelFile(path: string): boolean { return MODEL3D_EXTS.has(extOf(path)); }
/** Alias used by the viewer – single canonical name across the codebase. */
export const is3DFile = is3DModelFile;

// Canonical file-kind taxonomy — mirrors kind_for_extension() in dms_bindings.hh.
export type FileKind =
  | "image" | "vector" | "audio" | "video" | "document"
  | "markup" | "style" | "data" | "code"
  | "archive" | "text" | "model3d" | "other";

// Icon name subset used for FileKind badges — avoids importing from Icon.tsx (circular).
export type KindIconName =
  | "image" | "music" | "video" | "document" | "code" | "style"
  | "database" | "archive" | "file" | "cube";

// Human-readable label + SVG icon name for each kind (used in the AnalysisPanel).
export const KIND_LABEL: Record<FileKind, string> = {
  image:    "Image",
  vector:   "Vector",
  audio:    "Audio",
  video:    "Video",
  document: "Document",
  markup:   "Markup",
  style:    "Style",
  data:     "Data",
  code:     "Code",
  archive:  "Archive",
  text:     "Text",
  model3d:  "3D Model",
  other:    "File",
};

/** Maps each FileKind to an SVG icon name (see Icon.tsx). */
export const KIND_ICON: Record<FileKind, KindIconName> = {
  image:    "image",
  vector:   "image",
  audio:    "music",
  video:    "video",
  document: "document",
  markup:   "code",
  style:    "style",
  data:     "database",
  code:     "code",
  archive:  "archive",
  text:     "document",
  model3d:  "cube",
  other:    "file",
};

/** FileStats — always available for any selected file, DB-first then FS fallback. */
export interface FileStats {
  path:    string;
  name:    string;
  ext:     string;    // lowercase, no leading dot (e.g. "mp3")
  kind:    FileKind;
  mime:    string;
  size:    number;    // bytes
  mtime:   number;    // unix seconds
  indexed: boolean;   // full NLP analysis available
  inDb:    boolean;   // basic stats are in the DB
}

export function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

export function isTextFile(path: string):    boolean { return TEXT_EXTS.has(extOf(path));    }
export function isImageFile(path: string):   boolean { return IMAGE_EXTS.has(extOf(path));   }
export function isDocFile(path: string):     boolean { return DOC_EXTS.has(extOf(path));     }
export function isCodeFile(path: string):    boolean { return CODE_EXTS.has(extOf(path));    }
export function isAudioFile(path: string):   boolean { return AUDIO_EXTS.has(extOf(path));   }
export function isVideoFile(p: string): boolean { return VIDEO_EXTS.has(extOf(p)); }
export function isSvgFile(path: string):     boolean { return extOf(path) === ".svg";         }
export function isArchiveFile(path: string): boolean { return ARCHIVE_EXTS.has(extOf(path)); }
export function isCssFile(path: string):     boolean { return CSS_EXTS.has(extOf(path));     }
export function isHtmlFile(path: string):    boolean {
  return new Set([".html", ".htm", ".xhtml"]).has(extOf(path));
}

/** Derive the FileKind for a path purely from its extension. */
export function fileKind(path: string): FileKind {
  const ext = extOf(path);
  if (isSvgFile(path))         return "vector";
  if (isImageFile(path))       return "image";
  if (isAudioFile(path))       return "audio";
  if (VIDEO_EXTS.has(ext))     return "video";
  if (is3DModelFile(path))     return "model3d";
  if (isDocFile(path))         return "document";
  if (CSS_EXTS.has(ext))       return "style";
  if (isHtmlFile(path))        return "markup";
  const DATA = new Set([".json",".yaml",".yml",".toml",".csv",".sql",".ini",".env",".conf",".cfg"]);
  if (DATA.has(ext))           return "data";
  if (ARCHIVE_EXTS.has(ext))   return "archive";
  if (isCodeFile(path))        return "code";
  if (isTextFile(path))        return "text";
  return "other";
}

export function isSupportedFile(path: string): boolean {
  return isTextFile(path)  || isImageFile(path) || isDocFile(path)  ||
         isCodeFile(path)  || isAudioFile(path) || isVideoFile(path) ||
         isArchiveFile(path) || isCssFile(path) || is3DModelFile(path);
}

// ── LLM Model Downloader ─────────────────────────────────────────────────────
// Mirrors saucer::model_downloader::ModelInfo (C++ struct).

export interface LlmModelInfo {
  id:          string;
  name:        string;
  description: string;
  filename:    string;
  size_bytes:  number;
  downloaded:  boolean;
}

export type LlmDownloadStatus =
  | "idle" | "downloading" | "completed" | "failed" | "cancelled";

export interface LlmDownloadProgress {
  download_id:      string;
  model_id:         string;
  bytes_downloaded: number;
  total_bytes:      number;
  status:           LlmDownloadStatus;
  error_message:    string;
}

export const models = {
  /** List all catalog entries with their current download state. */
  list: async (): Promise<LlmModelInfo[]> => {
    const raw = await window.saucer.call<string>("model_list", []);
    try { return JSON.parse(raw) as LlmModelInfo[]; } catch { return []; }
  },

  /** Start downloading a model.  Returns download_id or "error:…". */
  start: (modelId: string) =>
    window.saucer.call<string>("model_start", [modelId]),

  /** Poll progress for an active download. */
  progress: async (downloadId: string): Promise<LlmDownloadProgress> => {
    const raw = await window.saucer.call<string>("model_progress", [downloadId]);
    return JSON.parse(raw) as LlmDownloadProgress;
  },

  /** Cancel an active download.  Returns true if the cancellation was registered. */
  cancel: (downloadId: string) =>
    window.saucer.call<boolean>("model_cancel", [downloadId]),

  /** Delete a downloaded model file from disk. */
  remove: (modelId: string) =>
    window.saucer.call<boolean>("model_delete", [modelId]),

  /** Get the absolute path to a downloaded model file, or "" if absent. */
  path: (modelId: string) =>
    window.saucer.call<string>("model_path", [modelId]),

  /** Get the current LLM models directory. */
  getModelsDir: () =>
    window.saucer.call<string>("model_get_models_dir", []),

  /** Persist a new LLM models directory.  Takes effect on next launch. */
  setModelsDir: (path: string) =>
    window.saucer.call<string>("model_set_models_dir", [path]),
};

