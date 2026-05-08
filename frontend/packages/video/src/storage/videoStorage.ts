/**
 * videoStorage.ts
 * IndexedDB persistence layer for VideoProject and VideoAsset records.
 *
 * Uses only the native `indexedDB` browser API — no external dependencies.
 * The database is opened lazily on first use (lazy singleton pattern) and the
 * connection is reused for every subsequent call.
 *
 * Schema (version 1)
 *  - projects  keyPath:'id' autoIncrement  → VideoProject
 *  - assets    keyPath:'id' autoIncrement  → VideoAsset
 */

import type { VideoProject, VideoClipKind } from '../types/video.ts';

/** An imported media file tracked in the project asset library. */
export interface VideoAsset {
  /** IndexedDB auto-increment primary key. 0 = not yet saved. */
  id: number;
  name: string;
  kind: VideoClipKind;
  /** Filesystem path (native backend). */
  path?: string;
  /** Raw Blob (from a file picker or downloaded media). */
  blob?: Blob;
  /** Remote or object URL. */
  url?: string;
  /** Data URL or object URL for the thumbnail preview. */
  thumbnailUrl?: string;
  /** Unix epoch milliseconds when this asset was added. */
  addedAt: number;
}

const DB_NAME      = 'syngrafo-video';
const DB_VERSION   = 1;

const STORE_PROJECTS = 'projects';
const STORE_ASSETS   = 'assets';

/** Wrap an IDBRequest in a Promise that resolves with request.result. */
function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

/**
 * Wrap an IDBTransaction in a Promise that resolves when the transaction
 * commits successfully (`oncomplete`) or rejects on error/abort.
 */
function transactionPromise(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new DOMException('IDB transaction aborted', 'AbortError'));
  });
}

export class VideoStorage {
  private _db: IDBDatabase | null = null;

  /**
   * Open (or reuse) the IndexedDB connection.
   * The first call creates the database and object stores; subsequent calls
   * return the cached IDBDatabase immediately.
   */
  open(): Promise<IDBDatabase> {
    if (this._db !== null) return Promise.resolve(this._db);

    return new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id', autoIncrement: true });
        }

        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: 'id', autoIncrement: true });
        }
      };

      req.onsuccess = (event) => {
        this._db = (event.target as IDBOpenDBRequest).result;

        // Propagate external close events so we don't cache a dead connection.
        this._db.onclose = () => { this._db = null; };

        resolve(this._db);
      };

      req.onerror   = () => reject(req.error);
      req.onblocked = () =>
        reject(new DOMException(
          'IndexedDB open was blocked. Close other tabs using this database.',
          'BlockedError',
        ));
    });
  }

  /** Close the underlying IDBDatabase and reset the cached reference. */
  close(): void {
    this._db?.close();
    this._db = null;
  }

  /**
   * Insert a new project record. The `id`, `createdAt`, and `updatedAt` fields
   * are set automatically — do not include them in `data`.
   *
   * Returns the persisted project with the real numeric `id` assigned by IDB.
   */
  async createProject(
    data: Omit<VideoProject, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<VideoProject> {
    const db  = await this.open();
    const now = Date.now();

    // Omit `id` so that IDB's autoIncrement generates it.
    const record: Omit<VideoProject, 'id'> = { ...data, createdAt: now, updatedAt: now };

    const tx    = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    const idReq = store.add(record);

    const [generatedId] = await Promise.all([
      requestPromise(idReq),
      transactionPromise(tx),
    ]);

    return { ...record, id: generatedId as number };
  }

  /**
   * Retrieve a project by its numeric id.
   * Returns `undefined` if no project with that id exists.
   */
  async getProject(id: number): Promise<VideoProject | undefined> {
    const db    = await this.open();
    const tx    = db.transaction(STORE_PROJECTS, 'readonly');
    const store = tx.objectStore(STORE_PROJECTS);
    return requestPromise(store.get(id)) as Promise<VideoProject | undefined>;
  }

  /** Return all projects in insertion order. */
  async listProjects(): Promise<VideoProject[]> {
    const db    = await this.open();
    const tx    = db.transaction(STORE_PROJECTS, 'readonly');
    const store = tx.objectStore(STORE_PROJECTS);
    return requestPromise(store.getAll()) as Promise<VideoProject[]>;
  }

  /**
   * Replace the stored project record with the supplied value.
   * `updatedAt` is refreshed to the current time automatically.
   *
   * The caller must ensure `project.id` matches an existing record.
   */
  async updateProject(project: VideoProject): Promise<void> {
    const db     = await this.open();
    const record = { ...project, updatedAt: Date.now() };
    const tx     = db.transaction(STORE_PROJECTS, 'readwrite');
    const store  = tx.objectStore(STORE_PROJECTS);
    store.put(record);
    return transactionPromise(tx);
  }

  /** Permanently delete a project by its numeric id. */
  async deleteProject(id: number): Promise<void> {
    const db    = await this.open();
    const tx    = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    store.delete(id);
    return transactionPromise(tx);
  }

  /**
   * Insert a new asset record. The `id` and `addedAt` fields are set
   * automatically — do not include them in `data`.
   *
   * Returns the persisted asset with the real numeric `id` assigned by IDB.
   */
  async addAsset(data: Omit<VideoAsset, 'id' | 'addedAt'>): Promise<VideoAsset> {
    const db = await this.open();

    const record: Omit<VideoAsset, 'id'> = { ...data, addedAt: Date.now() };

    const tx    = db.transaction(STORE_ASSETS, 'readwrite');
    const store = tx.objectStore(STORE_ASSETS);
    const idReq = store.add(record);

    const [generatedId] = await Promise.all([
      requestPromise(idReq),
      transactionPromise(tx),
    ]);

    return { ...record, id: generatedId as number };
  }

  /** Return all assets in insertion order. */
  async listAssets(): Promise<VideoAsset[]> {
    const db    = await this.open();
    const tx    = db.transaction(STORE_ASSETS, 'readonly');
    const store = tx.objectStore(STORE_ASSETS);
    return requestPromise(store.getAll()) as Promise<VideoAsset[]>;
  }

  /** Permanently delete an asset by its numeric id. */
  async deleteAsset(id: number): Promise<void> {
    const db    = await this.open();
    const tx    = db.transaction(STORE_ASSETS, 'readwrite');
    const store = tx.objectStore(STORE_ASSETS);
    store.delete(id);
    return transactionPromise(tx);
  }
}

/**
 * Module-level singleton.
 * Import this directly rather than constructing a new VideoStorage instance:
 *
 * ```webviewapp/frontend/packages/video/src/storage/videoStorage.ts#L1
 * import { videoStorage } from '@syngrafo/video/storage/videoStorage.ts';
 * const projects = await videoStorage.listProjects();
 * ```
 */
export const videoStorage = new VideoStorage();
