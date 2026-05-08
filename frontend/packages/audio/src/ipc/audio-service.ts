import { ipcCall } from '@syngrafo/shared';
import type { IpcResult } from '@syngrafo/shared';

export type { IpcResult };

export interface ExportResult { outputPath: string; durationSec: number; }
export interface AudioInfo    { sampleRate: number; channels: number; durationSec: number; }

export const audioService = {
  exportWav: (csdText: string, outputPath: string) =>
    ipcCall<ExportResult>('audio_export_wav', csdText, outputPath),

  getAudioInfo: (filePath: string) =>
    ipcCall<AudioInfo>('audio_get_info', filePath),

  validateCsd: (csdText: string) =>
    ipcCall<{ valid: boolean; errors: string[] }>('audio_validate_csd', csdText),
};
