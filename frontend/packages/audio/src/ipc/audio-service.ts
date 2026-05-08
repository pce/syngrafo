/**
 * audio-service.ts
 * Saucer IPC calls to the C++ backend audio module.
 * The backend uses csound.hpp (linked lib, no subprocess) for offline rendering.
 */

// Mirror the saucer Window augmentation locally so audio-service.ts is
// self-contained without depending on @syngrafo/editor.
declare global {
  interface Window {
    saucer?: {
      call<T = string>(name: string, params?: unknown[]): Promise<T>;
      exposed?: Record<string, (...args: unknown[]) => Promise<string>>;
    };
  }
}

interface IpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function ipcCall<T>(name: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const fn = window.saucer?.exposed?.[name];
  if (typeof fn !== 'function') return { ok: false, error: 'IPC not available' };
  try {
    const raw = await fn(...args);
    return JSON.parse(raw) as IpcResult<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export interface ExportResult { outputPath: string; durationSec: number; }
export interface AudioInfo    { sampleRate: number; channels: number; durationSec: number; }

export const audioService = {
  /**
   * Render a CSD to a WAV file on disk.
   * Backend uses csound.hpp directly (NOT a subprocess).
   * @param csdText    full CSD string
   * @param outputPath absolute path for output .wav
   */
  exportWav: (csdText: string, outputPath: string) =>
    ipcCall<ExportResult>('audio_export_wav', csdText, outputPath),

  /**
   * Get info about an audio file decoded by the backend (libsndfile or csound's built-in reader).
   */
  getAudioInfo: (filePath: string) =>
    ipcCall<AudioInfo>('audio_get_info', filePath),

  /** Validate a CSD string for syntax errors (parse only, no perform). */
  validateCsd: (csdText: string) =>
    ipcCall<{ valid: boolean; errors: string[] }>('audio_validate_csd', csdText),
};
