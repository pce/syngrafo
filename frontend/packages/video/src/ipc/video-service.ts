/**
 * Saucer IPC calls to the C++ video backend (libavformat/libavcodec/libswscale).
 * All methods wrap one `window.saucer.exposed` call and handle JSON parsing
 * + IPC-unavailable fallback transparently.
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

/** Returned by `exportVideo` on success. */
export interface VideoExportResult {
  outputPath: string;
  durationSec: number;
  frameCount: number;
}

/** Returned by `getVideoInfo` on success. */
export interface VideoFileInfo {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  /** Codec identifier, e.g. 'h264', 'vp9', 'hevc'. */
  codec: string;
}

export interface ImageSequenceImportResult {
  trackId: string;
  clipCount: number;
}

/** Falls back to `{ ok:false }` when running outside the Saucer webview. */
async function ipcCall<T>(name: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const fn = window.saucer?.exposed?.[name];
  if (typeof fn !== 'function') {
    return { ok: false, error: 'IPC not available' };
  }
  try {
    const raw = await fn(...args);
    return JSON.parse(raw) as IpcResult<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const videoService = {
  /**
   * Export a full project to a video file on disk.
   *
   * The backend reads `projectJson`, renders every track/clip through its
   * shader chain, and encodes the result to `outputPath`.
   *
   * @param projectJson Serialized `VideoProject` (use `JSON.stringify(project)`).
   * @param outputPath  Absolute destination path for the output file.
   */
  exportVideo: (
    projectJson: string,
    outputPath: string,
  ): Promise<IpcResult<VideoExportResult>> =>
    ipcCall<VideoExportResult>('video_export', projectJson, outputPath),

  /**
   * Retrieve metadata (dimensions, fps, duration, codec) for a video file.
   *
   * @param filePath Absolute path to the source video file.
   */
  getVideoInfo: (
    filePath: string,
  ): Promise<IpcResult<VideoFileInfo>> =>
    ipcCall<VideoFileInfo>('video_get_info', filePath),

  /**
   * Import a folder of sequentially named images as a set of clips.
   *
   * The backend walks `folderPath`, sorts the images by filename, and creates
   * one clip per frame at the given `fps`.
   *
   * @param folderPath Absolute path to the folder containing image files.
   * @param fps        Desired playback framerate for the imported sequence.
   */
  importImageSequence: (
    folderPath: string,
    fps: number,
  ): Promise<IpcResult<ImageSequenceImportResult>> =>
    ipcCall<ImageSequenceImportResult>('video_import_image_sequence', folderPath, fps),

  /**
   * Open a native OS file-picker dialog.
   *
   * @param filter Optional MIME type or extension hint (e.g. 'video/*', '*.mp4').
   *               Pass `undefined` to show all files.
   */
  openFileDialog: (
    filter?: string,
  ): Promise<IpcResult<{ path: string }>> =>
    ipcCall<{ path: string }>('video_open_file_dialog', filter),

  /**
   * Open a native OS folder-picker dialog.
   * Returns the selected folder path, or an error if the dialog was cancelled.
   */
  openFolderDialog: (): Promise<IpcResult<{ path: string }>> =>
    ipcCall<{ path: string }>('video_open_folder_dialog'),

  /**
   * Render a single frame and return it as a data URL for preview purposes.
   *
   * This is intentionally a synchronous-style render (one frame at a time)
   * suitable for scrubbing previews. For full exports use `exportVideo`.
   *
   * @param projectJson Serialized `VideoProject`.
   * @param frame       Absolute frame number to render.
   */
  renderFrame: (
    projectJson: string,
    frame: number,
  ): Promise<IpcResult<{ dataUrl: string }>> =>
    ipcCall<{ dataUrl: string }>('video_render_frame', projectJson, frame),
};
