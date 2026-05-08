// In-memory store for VideoProject and VideoAsset records.

import type { VideoProject, VideoClipKind } from '../types/video.ts';

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

let _nextProjectId = 1;
let _nextAssetId   = 1;

const _projects = new Map<number, VideoProject>();
const _assets   = new Map<number, VideoAsset>();

export const videoStorage = {
  async createProject(
    data: Omit<VideoProject, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<VideoProject> {
    const now    = Date.now();
    const id     = _nextProjectId++;
    const record: VideoProject = { ...data, id, createdAt: now, updatedAt: now };
    _projects.set(id, record);
    return record;
  },

  async getProject(id: number): Promise<VideoProject | undefined> {
    return _projects.get(id);
  },

  async listProjects(): Promise<VideoProject[]> {
    return Array.from(_projects.values());
  },

  async updateProject(project: VideoProject): Promise<void> {
    _projects.set(project.id, { ...project, updatedAt: Date.now() });
  },

  async deleteProject(id: number): Promise<void> {
    _projects.delete(id);
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
