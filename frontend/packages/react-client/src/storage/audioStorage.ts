// In-memory persistence layer for AudioRecordingDocument records.
// Disk persistence goes through the DMS IPC layer (dms_write_file / dms_read_file).

import type { AudioRecordingDocument } from "../types/audio";

export interface NewAudioFileInput {
  name:      string;
  blob:      Blob;
  mimeType:  string;
  duration?: number;
}

let _store: AudioRecordingDocument[] = [];
let _nextId = 1;

export const audioStorage = {
  getAudioFiles: async (): Promise<AudioRecordingDocument[]> => {
    return [..._store];
  },

  addAudioFile: async (input: NewAudioFileInput): Promise<AudioRecordingDocument> => {
    const doc: AudioRecordingDocument = {
      id:        _nextId++,
      name:      input.name,
      path:      "",
      blob:      input.blob,
      mimeType:  input.mimeType,
      duration:  input.duration,
      createdAt: Date.now(),
    };
    _store.push(doc);
    return doc;
  },

  deleteAudioFile: async (id: number): Promise<void> => {
    _store = _store.filter((f) => f.id !== id);
  },

  updateAudioFile: async (file: AudioRecordingDocument): Promise<void> => {
    _store = _store.map((f) => (f.id === file.id ? file : f));
  },
};
