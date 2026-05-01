/**
 * audioStorage — IndexedDB persistence for recorded/imported audio files.
 * No external dependencies; uses the browser's native IndexedDB API.
 */
import type { AudioRecordingDocument } from "@/types/audio";

const DB_NAME    = "syngrafo-audio";
const STORE_NAME = "recordings";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

async function getAudioFiles(): Promise<AudioRecordingDocument[]> {
  const db    = await openDb();
  const store = tx(db, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as AudioRecordingDocument[]);
    req.onerror   = () => reject(req.error);
  });
}

async function addAudioFile(
  doc: Omit<AudioRecordingDocument, "id" | "createdAt">,
): Promise<number> {
  const db    = await openDb();
  const store = tx(db, "readwrite");
  const record: Omit<AudioRecordingDocument, "id"> = { ...doc, createdAt: Date.now() };
  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror   = () => reject(req.error);
  });
}

async function deleteAudioFile(id: number): Promise<void> {
  const db    = await openDb();
  const store = tx(db, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function updateAudioFile(doc: AudioRecordingDocument): Promise<void> {
  if (doc.id == null) throw new Error("updateAudioFile: doc has no id");
  const db    = await openDb();
  const store = tx(db, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(doc);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export const audioStorage = {
  getAudioFiles,
  addAudioFile,
  deleteAudioFile,
  updateAudioFile,
};
