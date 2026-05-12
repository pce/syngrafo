//
// Document Management System — saucer expose() bindings.
//
// Saucer IPC: C++ bindings are accessed via window.saucer.call(name, args)
// or window.saucer.exposed.name(...args) — NOT via window.dms_name() directly.
//
// C++ response shapes are mapped to the TS interfaces below so components
// never need to know about C++ field naming conventions.
//

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

export interface AsyncTransferStartResult {
  taskId: string;
  operation: "copy" | "move";
  destDir: string;
  totalBytes: number;
  totalFiles: number;
  skipped: number;
}

export interface SearchResult {
  docId:     number;
  path:      string;
  filename:  string;
  score:     number;
  /** How the document was matched: "filename" | "snippet" | "keyword" | "fulltext" | "semantic" | "hybrid" */
  match:     string;
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

export interface WorkflowState {
  key: string;
  label: string;
  color: string;
  category: string;
  isDefault: boolean;
  isTerminal: boolean;
  sortOrder: number;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  label: string;
  requiresReason: boolean;
  sortOrder: number;
}

export interface ZoneWorkflow {
  id: string;
  zoneName: string;
  name: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
}

export interface DocumentLink {
  id: number;
  zoneName: string;
  sourceRef: string;
  targetRef: string;
  type: string;
  note: string;
  status: string;
  createdAt: number;
}

export interface DocumentLifecycle {
  documentUid: string;
  path: string;
  state: string;
  createdAt?: number;
  updatedAt?: number;
  workflow?: {
    id: string;
    zoneName: string;
    currentState: string;
    updatedAt: number;
    states: WorkflowState[];
    availableTransitions: WorkflowTransition[];
  };
  links: DocumentLink[];
  [key: string]: unknown;
}

export interface FolderDashboardItem {
  path: string;
  name: string;
  mtime: number;
  size: number;
  workflowState?: string;
  keywords?: Keyword[];
}

export interface FolderDashboardData {
  path: string;
  name: string;
  parentPath: string;
  fileCount: number;
  directoryCount: number;
  totalSize: number;
  recentItems: Array<{ path: string; name: string; mtime: number; size: number }>;
  hotItems: FolderDashboardItem[];
  workflowCounts: Array<{ stateKey: string; count: number }>;
  workflow: { id: string; states: WorkflowState[] };
  tagCloud: Array<{ tag: string; count: number }>;
  heatmap: Array<{ dayOffset: number; count: number }>;
  links: DocumentLink[];
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

export type BookmarkRoot = "source" | "workspace" | "notes" | "kanban";

/** Target kind for a bookmark. */
export type BookmarkKind = "file" | "folder" | "image";

/**
 * A Bookmark is a named quick-jump target that lives inside a Zone.
 *
 * `root` selects the base area inside the zone, while `target` is relative to it.
 *
 * `target` is a root-relative materialized path, e.g.:
 *   - `path/to/file.py`        → whole file
 *   - `path/to/file.py?10:12`  → line range 10–12 (inclusive)
 *   - `path/to/file.py?10:`    → from line 10 to EOF
 *   - `path/to/folder/`        → directory (trailing slash)
 *   - ``                       → the selected root itself
 *
 * Canonical URI:  `/#<zoneName>/<root>/<target>`
 */
export interface Bookmark {
  id:         number;
  zone_name:  string;
  label:      string;
  root:       BookmarkRoot;
  /** Root-relative path, optionally with `?<from>:<to>` suffix. */
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
  root:      BookmarkRoot;
  line_from: number;
  line_to:   number;
  kind:      BookmarkKind;
  exists:    boolean;
  zone_name: string;
  target:    string;
}




/** Disk-usage figures for one filesystem path (volume). */
export interface DiskUsageInfo {
  path:       string;
  capacity:   number;   // bytes
  free:       number;   // bytes (including reserved blocks)
  available:  number;   // bytes usable by the process
  used:       number;   // capacity − free
  usedRatio:  number;   // 0.0 – 1.0
}

/** Zone disk-usage report returned by dms_zone_disk_usage. */
export interface ZoneDiskUsage {
  zone:     string;
  in_path:  DiskUsageInfo;
  out_path?: DiskUsageInfo;   // only present when out_path is on a different volume
}


/**
 * Build the canonical display URI for a bookmark:
 *   `/#<zoneName>/<root>/<target>`
 */
export function bookmarkUri(zoneName: string, root: BookmarkRoot, target: string): string {
  return target ? `/#${zoneName}/${root}/${target}` : `/#${zoneName}/${root}`;
}

/**
 * Parse a canonical bookmark URI (`/#<zone>/<root>/<target>`) back into its parts.
 * Returns `null` if the string is not a valid bookmark URI.
 */
export function parseBookmarkUri(uri: string): { zone: string; root: BookmarkRoot; target: string } | null {
  if (!uri.startsWith("/#")) return null;
  const rest = uri.slice(2);
  const parts = rest.split("/");
  if (parts.length < 2) return null;
  const [zone, root, ...targetParts] = parts;
  if (!zone || !root) return null;
  if (root !== "source" && root !== "workspace" && root !== "notes" && root !== "kanban") {
    return null;
  }
  return { zone, root, target: targetParts.join("/") };
}

/**
 * Parse the `?<from>:<to>` suffix out of a root-relative target string.
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

export type GltfMode = "solid" | "wireframe" | "pixelperfect";

export interface GltfConvertOpts {
  palette?: SvgPalette;
  smooth?:  boolean;
  mode?:    GltfMode;
  gridSize?: number;
  depthScale?: number;
  useVertexColors?: boolean;
  maxDim?: number;
  blurSigma?: number;
}

export interface MeshConvertResult {
  outPath:    string;
  sizeBytes:  number;
  mode:       string;
  gridSize:   number;
  depthScale: number;
  sourceSize?: { w: number; h: number };
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


export type ProgressPhase = "start" | "indexing" | "progress" | "complete" | "cancelled";

export interface DmsProgressEvent {
  kind?: "indexing" | "transfer";
  task_id?: string;
  operation?: "copy" | "move";
  phase:   ProgressPhase;
  file?:   string;
  done?:   number;
  total?:  number;
  errors?: number;
  done_bytes?: number;
  total_bytes?: number;
  done_files?: number;
  total_files?: number;
  dest_dir?: string;
  source_path?: string;
  target_path?: string;
  skipped?: number;
  source_parent_dirs?: string[];
  entries?: Array<{
    source_path: string;
    target_path: string;
    name: string;
    is_dir: boolean;
    size_bytes: number;
  }>;
}
