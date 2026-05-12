// IPC-backed store for VideoProject records; VideoAsset is in-memory only.

import type { VideoProject, VideoClipKind } from '../types/video.ts';
import { videoService } from '../ipc/video-service.ts';
import type { ProjectMeta } from '../ipc/video-service.ts';

/** An imported media file tracked in the project asset library. */
export interface VideoAsset {
  /** Numeric id. 0 = not yet persisted. */
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

/** Name-based IPC requires a local id↔name bridge; populated on create/update/load. */
let _cache: Map<number, VideoProject> = new Map();
let _nameToId: Map<string, number>   = new Map();

let _nextAssetId = 1;
const _assets    = new Map<number, VideoAsset>();

const DEFAULT_ZONE = 'global';

export const videoStorage = {
  async createProject(
    data: Omit<VideoProject, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<VideoProject> {
    const now   = Date.now();
    const draft: VideoProject = { ...data, id: 0, createdAt: now, updatedAt: now };
    const r = await videoService.saveProject(draft.name, DEFAULT_ZONE, draft);
    if (!r.ok) throw new Error(r.error);
    const record: VideoProject = { ...draft, id: r.data.id };
    _cache.set(record.id, record);
    _nameToId.set(record.name, record.id);
    return record;
  },

  async getProject(id: number): Promise<VideoProject | undefined> {
    // No round-trip possible without a name; caller should use loadProjectByName to hydrate.
    return _cache.get(id);
  },

  async listProjects(): Promise<ProjectMeta[]> {
    const r = await videoService.listProjects(DEFAULT_ZONE);
    return r.ok ? r.data : [];
  },

  async updateProject(project: VideoProject): Promise<void> {
    const updated = { ...project, updatedAt: Date.now() };
    const r = await videoService.saveProject(project.name, DEFAULT_ZONE, updated);
    if (!r.ok) throw new Error(r.error);
    _cache.set(project.id, updated);
    _nameToId.set(project.name, project.id);
  },

  async deleteProject(id: number): Promise<void> {
    const project = _cache.get(id);
    if (!project) return;
    const r = await videoService.deleteProject(project.name, DEFAULT_ZONE);
    if (!r.ok) throw new Error(r.error);
    _cache.delete(id);
    _nameToId.delete(project.name);
  },

  /**
   * Load a project by name from the backend and populate the local cache.
   * Useful for restoring projects across sessions.
   */
  async loadProjectByName(name: string): Promise<VideoProject | undefined> {
    const r = await videoService.loadProject(name, DEFAULT_ZONE);
    if (!r.ok) return undefined;
    const project = r.data.data;
    _cache.set(project.id, project);
    _nameToId.set(project.name, project.id);
    return project;
  },

  async addAsset(data: Omit<VideoAsset, 'id' | 'addedAt'>): Promise<VideoAsset> {
    const id     = _nextAssetId++;
    const record: VideoAsset = { ...data, id, addedAt: Date.now() };
    _assets.set(id, record);
    return record;
  },

  async listAssets(): Promise<VideoAsset[]> {
    return Array.from(_assets.values());
  },

  async deleteAsset(id: number): Promise<void> {
    _assets.delete(id);
  },
};
