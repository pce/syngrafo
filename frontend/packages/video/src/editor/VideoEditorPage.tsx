/**
 * VideoEditorPage.tsx
 * Top-level video editor page component.
 *
 * Handles:
 *  - Loading or creating a VideoProject from IndexedDB via videoStorage
 *  - Wiring VideoTimeline ↔ VideoPreview via videoBus playheadMove events
 *  - Persisting project changes (debounced 500 ms)
 *  - Asset import via native IPC (open file/folder dialog)
 *  - Export trigger via videoService.exportVideo
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { videoBus } from '@syngrafo/shared';
import { videoStorage } from '../storage/videoStorage.ts';
import { videoService }  from '../ipc/video-service.ts';
import { defaultProject } from '../types/video.ts';
import type { VideoProject, VideoClip } from '../types/video.ts';
import { clipFromSource } from '../types/video.ts';
import { VideoTimeline }  from '../timeline/VideoTimeline.tsx';
import { VideoPreview }   from '../preview/VideoPreview.tsx';

export interface VideoEditorPageProps {
  /** If provided, loads an existing project; otherwise creates a new one. */
  projectId?: number;
  onBack?:    () => void;
}

const SAVE_DEBOUNCE_MS = 500;

export const VideoEditorPage: React.FC<VideoEditorPageProps> = ({
  projectId,
  onBack,
}) => {
  const [project,    setProject]    = useState<VideoProject | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [frame,      setFrame]      = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameValue,  setNameValue]  = useState('');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportPath, setExportPath] = useState('');
  const [exporting,  setExporting]  = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // load project on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        let p: VideoProject | undefined;

        if (projectId !== undefined) {
          p = await videoStorage.getProject(projectId);
        }

        if (!p) {
          // Create a new default project
          const template = defaultProject('Untitled Project', 30);
          p = await videoStorage.createProject(template);
        }

        if (!cancelled) {
          setProject(p);
          setNameValue(p.name);
        }
      } catch (err) {
        console.error('[VideoEditor] Failed to load/create project:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  // sync playhead frame from timeline bus
  useEffect(() => {
    const off = videoBus.on('playheadMove', ({ frame: f }) => setFrame(f));
    return off;
  }, []);

  // debounce-persist on changes
  const handleProjectChange = useCallback((p: VideoProject) => {
    setProject(p);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      videoStorage.updateProject(p).catch(err =>
        console.warn('[VideoEditor] Auto-save failed:', err)
      );
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // project name commit
  const commitName = useCallback(() => {
    setEditingName(false);
    if (!project) return;
    const updated = { ...project, name: nameValue.trim() || project.name };
    handleProjectChange(updated);
  }, [project, nameValue, handleProjectChange]);

  // import asset via IPC
  const importFile = useCallback(async (kind: 'image' | 'video' | 'audio') => {
    if (!project) return;

    const filter = kind === 'image'  ? 'image/*'
                 : kind === 'audio'  ? 'audio/*'
                 : 'video/*';

    const result = await videoService.openFileDialog(filter);
    if (!result.ok || !result.data) return;

    const { path } = result.data;
    const name = path.split('/').pop() ?? path;

    // Add to asset library
    await videoStorage.addAsset({ name, kind, path });

    // Add as a clip on the first suitable track (or create one)
    let track = project.tracks.find(t =>
      kind === 'audio' ? t.kind === 'audio' : t.kind === 'video'
    );

    let tracks = [...project.tracks];
    if (!track) {
      track = {
        id: crypto.randomUUID(),
        kind: kind === 'audio' ? 'audio' : 'video',
        label: kind === 'audio' ? 'Audio 1' : 'Video 1',
        muted: false, solo: false,
        layer: tracks.length,
        clips: [],
      };
      tracks = [...tracks, track];
    }

    const startFrame = frame;
    const durFrames  = project.settings.defaultImageDurationFrames;
    const clip: VideoClip = clipFromSource(
      { kind, path },
      startFrame,
      durFrames,
      track.layer,
      track.id,
      name,
    );

    tracks = tracks.map(t =>
      t.id === track!.id ? { ...t, clips: [...t.clips, clip] } : t
    );
    handleProjectChange({ ...project, tracks });
  }, [project, frame, handleProjectChange]);

  const importImageSequence = useCallback(async () => {
    if (!project) return;
    const result = await videoService.openFolderDialog();
    if (!result.ok || !result.data) return;

    const seqResult = await videoService.importImageSequence(result.data.path, project.fps);
    if (!seqResult.ok) {
      console.warn('[VideoEditor] Image sequence import failed:', seqResult.error);
      return;
    }
    // Backend creates the track — reload project from storage
    const refreshed = await videoStorage.getProject(project.id);
    if (refreshed) handleProjectChange(refreshed);
  }, [project, handleProjectChange]);

  const handleExport = useCallback(async () => {
    if (!project) return;
    setExporting(true);
    try {
      const result = await videoService.exportVideo(
        JSON.stringify(project),
        exportPath,
      );
      if (result.ok && result.data) {
        alert(`Exported to: ${result.data.outputPath}  (${result.data.frameCount} frames, ${result.data.durationSec.toFixed(2)}s)`);
      } else {
        alert(`Export failed: ${result.error ?? 'unknown error'}`);
      }
    } finally {
      setExporting(false);
      setShowExportDialog(false);
    }
  }, [project, exportPath]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-950 text-gray-400">
        <span className="text-sm">Loading project…</span>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-950 text-red-400">
        <span className="text-sm">Failed to load project.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-gray-950 text-white overflow-hidden">

      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800"
            aria-label="Back"
          >
            ← Back
          </button>
        )}

        {/* Project name */}
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-sm text-white w-48 focus:outline-none focus:border-indigo-500"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="text-sm font-medium text-gray-100 hover:text-white hover:bg-gray-800 rounded px-2 py-0.5"
            title="Click to rename"
          >
            {project.name}
          </button>
        )}

        <span className="text-xs text-gray-600">
          {project.resolution.width}×{project.resolution.height} @ {project.fps}fps
        </span>

        <div className="flex-1" />

        {/* Import buttons */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Import:</span>
          {(['image', 'video', 'audio'] as const).map(k => (
            <button
              key={k}
              onClick={() => importFile(k)}
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 capitalize"
            >
              {k === 'image' ? '🖼' : k === 'video' ? '🎬' : '🔊'} {k}
            </button>
          ))}
          <button
            onClick={importImageSequence}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
            title="Import image sequence from folder"
          >
            📁 Sequence
          </button>
        </div>

        <div className="w-px h-5 bg-gray-700" />

        {/* Export */}
        <button
          onClick={() => setShowExportDialog(true)}
          className="text-xs px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-medium"
        >
          ⬆ Export
        </button>
      </header>

      {/* ── Body: Preview (top) + Timeline (bottom) ─────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Preview panel — 60% height */}
        <div
          className="flex-none bg-gray-950 border-b border-gray-800 overflow-hidden"
          style={{ height: '60%' }}
        >
          <VideoPreview project={project} frame={frame} />
        </div>

        {/* Timeline panel — 40% height */}
        <div className="flex-1 overflow-hidden">
          <VideoTimeline
            project={project}
            onProjectChange={handleProjectChange}
          />
        </div>
      </div>

      {/* ── Export dialog ─────────────────────────────────────────────────── */}
      {showExportDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 w-96 shadow-2xl">
            <h2 className="text-sm font-semibold text-white mb-4">Export Video</h2>

            <label className="block text-xs text-gray-400 mb-1">Output path</label>
            <input
              value={exportPath}
              onChange={e => setExportPath(e.target.value)}
              placeholder="/path/to/output.mp4"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white mb-4 focus:outline-none focus:border-indigo-500"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowExportDialog(false)}
                className="px-4 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={!exportPath.trim() || exporting}
                className="px-4 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 text-sm text-white disabled:opacity-50"
              >
                {exporting ? 'Exporting…' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
