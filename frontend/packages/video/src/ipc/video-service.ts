/**
 * @file ipc/video-service.ts
 * TypeScript facade over the C++ video IPC bindings.
 *
 * Note, instead of vido_open_file|folder_dialog, use:
 *     - dms_select_directory / dms_select_files
 * exposed via `fileService` in @syngrafo/shared.
 */

import { ipcCall } from '@syngrafo/shared';
export type { IpcResult } from '@syngrafo/shared';


/** Full media metadata returned by `video_get_media_info`. */
export interface VideoMediaInfo {
  width:           number;
  height:          number;
  fps:             number;
  duration_sec:    number;
  duration_frames: number;
  codec:           string;
  has_audio:       boolean;
}

export interface VideoDecodedFrame {
  dataUrl:      string;  // data:image/jpeg;base64,…
  width:        number;
  height:       number;
  frameNumber:  number;
  timestampSec: number;
}

export interface VideoImportClipResult {
  resolvedPath: string;
  info: VideoMediaInfo;
}

export interface VideoListDirResult {
  files: string[];
}


export interface VideoExportResult {
  outputPath:  string;
  durationSec: number;
  frameCount:  number;
}


export const videoService = {

  /**
   * Retrieve full metadata for a media file (dimensions, fps, duration, codec).
   * Calls `video_get_media_info`.
   */
  getMediaInfo: (
    filePath: string,
  ) => ipcCall<VideoMediaInfo>('video_get_media_info', filePath),

  /**
   * Decode a specific frame from a video file and return it as a JPEG data-URL.
   * Calls `video_decode_frame`.
   */
  decodeFrame: (
    filePath:    string,
    frameNumber: number,
    fps:         number,
  ) => ipcCall<VideoDecodedFrame>('video_decode_frame', filePath, frameNumber, fps),

  /**
   * Grab a thumbnail frame at `atSec` seconds.
   * The backend derives the frame index from atSec × fps internally.
   * Calls `video_get_thumbnail`.
   */
  getThumbnail: (
    filePath: string,
    atSec:    number,
  ) => ipcCall<VideoDecodedFrame>('video_get_thumbnail', filePath, atSec),

  /**
   * Validate and import a single clip file; returns its resolved path and all
   * metadata in one round-trip.
   * Calls `video_import_clip`.
   */
  importClip: (
    absPath: string,
  ) => ipcCall<VideoImportClipResult>('video_import_clip', absPath),

  /**
   * List files in `dirPath` whose extension (case-insensitive, without dot)
   * matches one of `extensions`.
   * Calls `video_list_directory` — registered in video_bindings.hh.
   *
   * @example
   * videoService.listDirectory('/home/user/images', ['jpg','jpeg','png','webp'])
   */
  listDirectory: (
    dirPath:    string,
    extensions: string[],
  ) => ipcCall<VideoListDirResult>('video_list_directory', dirPath, extensions),

  // ── Not yet implemented in C++ — stubs that will resolve {ok:false} ──────
  // Keep these here so callers compile; implement the backend when ready.

  /**
   * Export a full project to a video file.
   * 🚧 NOT YET REGISTERED — requires backend FFmpeg encoder pipeline.
   * Will return `{ ok: false, error: 'IPC not available' }` until implemented.
   */
  exportVideo: (
    projectJson: string,
    outputPath:  string,
  ) => ipcCall<VideoExportResult>('video_export', projectJson, outputPath),

  /**
   * Render a single frame for preview.
   * 🚧 NOT YET REGISTERED — requires backend GPU compositor.
   */
  renderFrame: (
    projectJson: string,
    frame:       number,
  ) => ipcCall<{ dataUrl: string }>('video_render_frame', projectJson, frame),
};
