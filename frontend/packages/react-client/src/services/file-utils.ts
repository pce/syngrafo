//  MIME / file-kind utilities — self-contained, no imports required.

export const TEXT_EXTS  = new Set([
  ".txt", ".md", ".markdown", ".rst", ".csv", ".json", ".xml",
  ".html", ".htm", ".log", ".yaml", ".yml", ".toml", ".ini",
  ".cfg", ".conf", ".env",
]);
export const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp",
  ".heic", ".heif", ".avif", ".tga", ".gif", ".svg",
]);

export const VIDEO_EXTS = new Set([
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".ogv", ".flv", ".wmv",
]);
export const DOC_EXTS   = new Set([".pdf", ".docx", ".odt", ".rtf", ".doc"]);
export const CODE_EXTS  = new Set([
  ".cpp", ".cc", ".cxx", ".c", ".h", ".hh", ".hpp",
  ".py", ".js", ".ts", ".jsx", ".tsx", ".rs", ".go",
  ".java", ".swift", ".kt", ".rb", ".sh", ".bash",
  ".zsh", ".sql", ".r", ".tex",
]);
export const AUDIO_EXTS = new Set([
  ".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac", ".opus", ".wma",
]);
export const MODEL3D_EXTS = new Set([
  ".ply", ".obj", ".gltf", ".glb", ".stl",
  ".splat", ".spz",           // Gaussian Splat formats
  ".xyz", ".pcd",             // Point cloud formats
]);
export const ARCHIVE_EXTS = new Set([
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
