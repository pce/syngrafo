import { ipcCall } from '@syngrafo/shared';
import type { IpcResult } from '@syngrafo/shared';

export type { IpcResult };

export interface ExportResult { outputPath: string; durationSec: number; }
export interface AudioInfo    { sampleRate: number; channels: number; durationSec: number; }

export interface AudioProjectMeta {
  id:         number;
  name:       string;
  zone_name:  string;
  created_at: number;
  updated_at: number;
}

export interface AudioProjectSaveMeta {
  id:         number;
  name:       string;
  zone_name:  string;
  updated_at: number;
}

export interface AudioProjectLoadResult<T> {
  id:         number;
  name:       string;
  zone_name:  string;
  data:       T;
  created_at: number;
  updated_at: number;
}

export const audioService = {
  exportWav: (csdText: string, outputPath: string) =>
    ipcCall<ExportResult>('audio_export_wav', csdText, outputPath),

  getAudioInfo: (filePath: string) =>
    ipcCall<AudioInfo>('audio_get_info', filePath),

  validateCsd: (csdText: string) =>
    ipcCall<{ valid: boolean; errors: string[] }>('audio_validate_csd', csdText),

  /** Save or upsert a named project. Generic over project type T. */
  saveProject: <T>(name: string, zoneName: string, project: T) =>
    ipcCall<AudioProjectSaveMeta>('audio_save_project', name, zoneName, JSON.stringify(project)),

  /** Load a saved project by name; returns the full document in `data`. */
  loadProject: <T>(name: string, zoneName: string) =>
    ipcCall<AudioProjectLoadResult<T>>('audio_load_project', name, zoneName),

  /** List saved project metadata for the zone (newest first). */
  listProjects: (zoneName: string) =>
    ipcCall<AudioProjectMeta[]>('audio_list_projects', zoneName),

  /** Delete a saved project by name+zone. */
  deleteProject: (name: string, zoneName: string) =>
    ipcCall<{ deleted: boolean }>('audio_delete_project', name, zoneName),
};
