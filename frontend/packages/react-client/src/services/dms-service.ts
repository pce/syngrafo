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

import type {
  FsEntry,
  DirTree,
  ReadFileResult,
  IndexResult,
  BulkIndexResult,
  AsyncTransferStartResult,
  SearchResult,
  SearchResults,
  IndexStatus,
  DocMetadata,
  WorkflowState,
  WorkflowTransition,
  ZoneWorkflow,
  DocumentLink,
  DocumentLifecycle,
  FolderDashboardItem,
  FolderDashboardData,
  Zone,
  ZoneHistoryItem,
  OcrResult,
  BookmarkRoot,
  BookmarkKind,
  Bookmark,
  BookmarkResolveResult,
  DiskUsageInfo,
  ZoneDiskUsage,
  PaletteEntry,
  RgbHistogram,
  ImageAnalysis,
  SvgPalette,
  SvgConvertOpts,
  GltfMode,
  GltfConvertOpts,
  MeshConvertResult,
  Keyword,
  Entity,
  ProgressPhase,
  DmsProgressEvent,
} from "./dms-types";

import {
  mapEntry,
  mapDirTree,
  mapKeyword,
  mapEntity,
  mapKeywords,
  mapEntities,
  mapReadFile,
  mapIndexResult,
  mapSearchResult,
  mapSearchResults,
  mapIndexStatus,
  mapDocMetadata,
  mapWorkflowState,
  mapWorkflowTransition,
  mapDocumentLink,
  mapDocumentLifecycle,
  mapZoneWorkflow,
  mapFolderDashboard,
} from "./dms-mappers";

import type { FileStats } from "./file-utils";

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
  imageToSvg: async (path: string, opts: SvgConvertOpts = {}): Promise<NlpEnvelope<{ outPath: string; palette: string; colors: number; sourceSize?: { w: number; h: number } }>> => {
    return call<{ outPath: string; palette: string; colors: number; sourceSize?: { w: number; h: number } }>(
      binding("dms_image_to_svg"),
      JSON.stringify({ path, ...opts })
    );
  },

  /** Convert a raster image to SVG using connected-component polygon boundary tracing. */
  imageToSvgPoly: async (path: string, opts: SvgConvertOpts = {}): Promise<NlpEnvelope<{ outPath: string; palette: string; colors: number; sourceSize?: { w: number; h: number } }>> => {
    return call<{ outPath: string; palette: string; colors: number; sourceSize?: { w: number; h: number } }>(
      binding("dms_image_to_svg_poly"),
      JSON.stringify({ path, ...opts })
    );
  },

  /** Convert a raster image to low-poly triangulated SVG. */
  imageToSvgTri: async (path: string, opts: SvgConvertOpts = {}): Promise<NlpEnvelope<{ outPath: string; palette: string; colors: number; gridSize: number; sourceSize?: { w: number; h: number } }>> => {
    return call<{ outPath: string; palette: string; colors: number; gridSize: number; sourceSize?: { w: number; h: number } }>(
      binding("dms_image_to_svg_tri"),
      JSON.stringify({ path, ...opts })
    );
  },

  /** Convert a raster image to a binary glTF 2.0 (.glb) height-map mesh.
   *  Palette-quantises vertex colours when `opts.palette` is set.
   *  Output is saved next to the source as `[name]_solid.glb` / `_wfr.glb` / `_pxl.glb`. */
  imageToGltf: async (path: string, opts: GltfConvertOpts = {}): Promise<NlpEnvelope<MeshConvertResult>> => {
    return call<MeshConvertResult>(
      binding("dms_image_to_gltf"),
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

  /** Lifecycle/workflow APIs for documents and folder summaries. */
  lifecycle: {
    snapshot: async (ref: string): Promise<NlpEnvelope<DocumentLifecycle>> => {
      const res = await call<unknown>(binding("dms_document_lifecycle"), ref);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return { ok: true, data: mapDocumentLifecycle(res.data) };
    },

    timeline: async (ref: string, limit = 50): Promise<NlpEnvelope<Array<Record<string, unknown>>>> => {
      const res = await call<any>(binding("dms_document_timeline"), ref, limit);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return { ok: true, data: Array.isArray(res.data.events) ? res.data.events : [] };
    },

    workflow: async (zoneName = ""): Promise<NlpEnvelope<ZoneWorkflow>> => {
      const res = await call<unknown>(binding("dms_zone_workflow"), zoneName);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return { ok: true, data: mapZoneWorkflow(res.data) };
    },

    saveWorkflow: async (zoneName: string, workflow: ZoneWorkflow): Promise<NlpEnvelope<ZoneWorkflow>> => {
      const res = await call<unknown>(binding("dms_save_zone_workflow"), zoneName, JSON.stringify(workflow));
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return { ok: true, data: mapZoneWorkflow(res.data) };
    },

    transition: async (
      ref: string,
      nextState: string,
      actor = "user",
      reason = "",
    ): Promise<NlpEnvelope<{ documentUid: string; workflowId: string; workflowState: string; updatedAt: number }>> => {
      const res = await call<any>(binding("dms_document_workflow_transition"), ref, nextState, actor, reason);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return {
        ok: true,
        data: {
          documentUid: String(res.data.document_uid ?? ""),
          workflowId: String(res.data.workflow_id ?? ""),
          workflowState: String(res.data.workflow_state ?? ""),
          updatedAt: Number(res.data.updated_at ?? 0),
        },
      };
    },

    links: async (ref: string, limit = 20): Promise<NlpEnvelope<DocumentLink[]>> => {
      const res = await call<unknown[]>(binding("dms_document_links"), ref, limit);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return { ok: true, data: res.data.map(mapDocumentLink) };
    },

    addLink: async (
      sourceRef: string,
      targetRef: string,
      linkType: string,
      note = "",
    ): Promise<NlpEnvelope<DocumentLink>> => {
      const res = await call<unknown>(binding("dms_add_document_link"), sourceRef, targetRef, linkType, note);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return { ok: true, data: mapDocumentLink(res.data) };
    },

    folderDashboard: async (path: string, limit = 12): Promise<NlpEnvelope<FolderDashboardData>> => {
      const res = await call<unknown>(binding("dms_folder_dashboard"), path, limit);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return { ok: true, data: mapFolderDashboard(res.data) };
    },
  },

  /** Transfer and file-mutation APIs with background-task support. */
  transfer: {
    copy: async (
      sources: string[],
      destDir: string,
      conflict: "replace" | "keep" | "skip" = "keep",
    ): Promise<NlpEnvelope<{ copied: number; skipped: number; errors: string[] }>> => {
      return call(binding("dms_copy_files"), JSON.stringify(sources), destDir, conflict);
    },

    move: async (
      sources: string[],
      destDir: string,
      conflict: "replace" | "keep" | "skip" = "keep",
    ): Promise<NlpEnvelope<{ moved: number; skipped: number; errors: string[] }>> => {
      return call(binding("dms_move_files"), JSON.stringify(sources), destDir, conflict);
    },

    start: async (
      operation: "copy" | "move",
      sources: string[],
      destDir: string,
      conflict: "replace" | "keep" | "skip" = "keep",
    ): Promise<NlpEnvelope<AsyncTransferStartResult>> => {
      const res = await call<any>(
        binding("dms_transfer_files_start"),
        JSON.stringify(sources),
        destDir,
        conflict,
        operation,
      );
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return {
        ok: true,
        data: {
          taskId: String(res.data.task_id ?? ""),
          operation,
          destDir: String(res.data.dest_dir ?? destDir),
          totalBytes: Number(res.data.total_bytes ?? 0),
          totalFiles: Number(res.data.total_files ?? 0),
          skipped: Number(res.data.skipped ?? 0),
        },
      };
    },

    cancel: async (taskId: string): Promise<NlpEnvelope<{ cancelled: boolean; taskId: string }>> => {
      const res = await call<any>(binding("dms_transfer_cancel"), taskId);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      return {
        ok: true,
        data: {
          cancelled: !!res.data.cancelled,
          taskId: String(res.data.task_id ?? taskId),
        },
      };
    },
  },


  /**
   * Add a bookmark to a zone.
   * `root` selects the base area and `target` is relative to it.
   * Returns the newly created Bookmark.
   */
  bookmark: {
    add: async (
      zoneName: string,
      root: BookmarkRoot,
      label: string,
      target: string,
    ): Promise<NlpEnvelope<Bookmark>> => {
      return call<Bookmark>(binding("dms_bookmark_add"), zoneName, root, label, target);
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
     * Update root, label, target, and sort_order of a bookmark.
     * Returns the updated Bookmark.
     */
    update: async (
      id: number,
      root: BookmarkRoot,
      label: string,
      target: string,
      sortOrder: number,
    ): Promise<NlpEnvelope<Bookmark>> => {
      return call<Bookmark>(binding("dms_bookmark_update"), id, root, label, target, sortOrder);
    },

    /**
     * Resolve a typed bookmark target to an absolute filesystem path.
     * Parses `?<from>:<to>` line-range suffixes and determines `kind`.
     */
    resolve: async (
      zoneName: string,
      root: BookmarkRoot,
      target: string,
    ): Promise<NlpEnvelope<BookmarkResolveResult>> => {
      return call<BookmarkResolveResult>(binding("dms_bookmark_resolve"), zoneName, root, target);
    },
  },

  /** Zone-level utilities */
  zone: {
    /**
     * Query disk usage for the in_path (and out_path if on a different volume)
     * of the given zone.  Uses `std::filesystem::space` — works for regular
     * directories, mounted volumes (`/Volumes/…`), and cross-platform.
     */
    diskUsage: async (zoneName: string): Promise<NlpEnvelope<ZoneDiskUsage>> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await call<any>(binding("dms_zone_disk_usage"), zoneName);
      if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
      const mapInfo = (raw: any): DiskUsageInfo => ({
        path:      String(raw.path      ?? ""),
        capacity:  Number(raw.capacity  ?? 0),
        free:      Number(raw.free      ?? 0),
        available: Number(raw.available ?? 0),
        used:      Number(raw.used      ?? 0),
        usedRatio: Number(raw.used_ratio ?? 0),
      });
      return {
        ok:   true,
        data: {
          zone:     String(res.data.zone ?? zoneName),
          in_path:  mapInfo(res.data.in_path),
          out_path: res.data.out_path ? mapInfo(res.data.out_path) : undefined,
        },
      };
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

// Re-exports — keep all existing import paths working
export * from "./dms-types";
export * from "./file-utils";
export { models } from "./model-service";
export type { LlmModelInfo, LlmDownloadStatus, LlmDownloadProgress } from "./model-service";
