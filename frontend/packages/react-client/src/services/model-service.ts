// LLM model management — saucer call() bindings for model download / lifecycle.

/** Mirrors saucer::model_downloader::ModelInfo (C++ struct). */
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
    const raw = await window.saucer!.call<string>("model_list", []);
    try { return JSON.parse(raw) as LlmModelInfo[]; } catch { return []; }
  },

  /** Start downloading a model.  Returns download_id or "error:…". */
  start: (modelId: string) =>
    window.saucer!.call<string>("model_start", [modelId]),

  /** Poll progress for an active download. */
  progress: async (downloadId: string): Promise<LlmDownloadProgress> => {
    const raw = await window.saucer!.call<string>("model_progress", [downloadId]);
    return JSON.parse(raw) as LlmDownloadProgress;
  },

  /** Cancel an active download.  Returns true if the cancellation was registered. */
  cancel: (downloadId: string) =>
    window.saucer!.call<boolean>("model_cancel", [downloadId]),

  /** Delete a downloaded model file from disk. */
  remove: (modelId: string) =>
    window.saucer!.call<boolean>("model_delete", [modelId]),

  /** Get the absolute path to a downloaded model file, or "" if absent. */
  path: (modelId: string) =>
    window.saucer!.call<string>("model_path", [modelId]),

  /** Get the current LLM models directory. */
  getModelsDir: () =>
    window.saucer!.call<string>("model_get_models_dir", []),

  /** Persist a new LLM models directory.  Takes effect on next launch. */
  setModelsDir: (path: string) =>
    window.saucer!.call<string>("model_set_models_dir", [path]),
};
