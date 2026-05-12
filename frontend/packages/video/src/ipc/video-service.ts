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
import type { VideoProject } from '../types/video.ts';

export interface ProjectMeta {
  id:         number;
  name:       string;
  zone_name:  string;
  created_at: number;
  updated_at: number;
}

export interface ProjectSaveMeta {
  id:         number;
  name:       string;
  zone_name:  string;
  updated_at: number;
}

export interface ProjectLoadResult<T> {
  id:         number;
  name:       string;
  zone_name:  string;
  data:       T;
  created_at: number;
  updated_at: number;
}

/**
 * Strip non-serializable fields (`blob`, `url`) from every clip source so the
 * project can be safely passed through JSON.stringify before saving.
 * Only `kind`, `path`, and `color` are kept on each source object.
 */
function stripBlobs(project: VideoProject): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map(t => ({
      ...t,
      clips: t.clips.map(c => ({
        ...c,
        source: { kind: c.source.kind, path: c.source.path, color: c.source.color },
      })),
    })),
  };
}

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

export interface VideoReverseResult {
  /** Absolute path to the reversed clip written to disk. */
  outputPath: string;
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

  /**
   * Export a full project to a video file (mp4 / H.264).
   * The backend composites all tracks frame-by-frame using libav* and
   * encodes with libx264 (falls back to native H.264 / MPEG-4).
   *
   * Export is CPU-bound and synchronous in the backend; expect it to take
   * roughly `durationFrames / fps` seconds of wall time at 1× speed
   * (varies with clip count, resolution, and encoder preset).
   */
  exportVideo: (
    projectJson: string,
    outputPath:  string,
  ) => ipcCall<VideoExportResult>('video_export', projectJson, outputPath),

  /** @remarks Not yet registered — requires GPU compositor. */
  renderFrame: (
    projectJson: string,
    frame:       number,
  ) => ipcCall<{ dataUrl: string }>('video_render_frame', projectJson, frame),

  /** @remarks Not yet registered — returns `{ok:false}` until `video_reverse_clip` is implemented in the C++ backend. */
  reverseClip: (
    inputPath:   string,
    startSec:    number,
    durationSec: number,
    outputPath:  string,
  ) => ipcCall<VideoReverseResult>('video_reverse_clip', inputPath, startSec, durationSec, outputPath),

  /** Save or upsert a VideoProject by name in a zone. Returns project metadata. */
  saveProject: (
    name:     string,
    zoneName: string,
    project:  VideoProject,
  ) => ipcCall<ProjectSaveMeta>(
    'video_save_project',
    name,
    zoneName,
    JSON.stringify(stripBlobs({ ...project, updatedAt: Date.now() })),
  ),

  /** Load a VideoProject by name+zone. Returns the full project in `data`. */
  loadProject: (
    name:     string,
    zoneName: string,
  ) => ipcCall<ProjectLoadResult<VideoProject>>('video_load_project', name, zoneName),

  /** List all saved video projects in a zone (metadata only, no project data). */
  listProjects: (
    zoneName: string,
  ) => ipcCall<ProjectMeta[]>('video_list_projects', zoneName),

  /** Delete a saved video project by name+zone. */
  deleteProject: (
    name:     string,
    zoneName: string,
  ) => ipcCall<{ deleted: boolean }>('video_delete_project', name, zoneName),
};
