/**
 * Top-level video editor shell.
 *
 * Responsibilities:
 *  - Load / create a {@link VideoProject} from in-memory storage on mount.
 *  - Sync the playhead frame from {@link videoBus} `playheadMove` events.
 *  - Debounce-persist project mutations (500 ms).
 *  - Drive native file/folder import via {@link videoService}.
 *  - Expose a collapsible, resizable {@link AssetBrowser} panel on the RIGHT side.
 *  - Trigger {@link videoService.exportVideo} from the export dialog.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { videoBus, fileService } from '@syngrafo/shared';
import { videoStorage }  from '../storage/videoStorage.ts';
import { videoService }  from '../ipc/video-service.ts';
import { defaultProject, clipFromSource } from '../types/video.ts';
import type { VideoProject, VideoClip, VideoClipKind } from '../types/video.ts';
import { VideoTimeline } from '../timeline/VideoTimeline.tsx';
import { VideoPreview }  from '../preview/VideoPreview.tsx';
import { Icon }          from '@syngrafo/ui';
import { AssetBrowser }  from '../browser/AssetBrowser.tsx';
import { SequenceImportDialog } from '../browser/SequenceImportDialog.tsx';

export interface VideoEditorPageProps {
  /** If provided, loads an existing project; otherwise creates a new one. */
  projectId?:  number;
  onBack?:     () => void;
  workingDir?: string;
  className?:  string;
}

const SAVE_DEBOUNCE_MS = 500;

/** Maps the three importable clip kinds to their header icon names. */
const IMPORT_ICON = {
  image: 'image',
  video: 'video',
  audio: 'audio',
} as const;

type AssetKind = 'image' | 'video' | 'audio';

export const VideoEditorPage: React.FC<VideoEditorPageProps> = ({
  projectId,
  onBack,
  workingDir = '',
  className  = '',
}) => {
  const [project,          setProject]          = useState<VideoProject | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [frame,            setFrame]            = useState(0);
  const [editingName,      setEditingName]      = useState(false);
  const [nameValue,        setNameValue]        = useState('');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportPath,       setExportPath]       = useState('');
  const [exporting,        setExporting]        = useState(false);
  const [assetPanelOpen,   setAssetPanelOpen]   = useState(false);
  const [assetPanelWidth,  setAssetPanelWidth]  = useState(280);
  const [assetFilterKind,  setAssetFilterKind]  = useState<AssetKind | null>(null);
  const [assetCurrentPath, setAssetCurrentPath] = useState('');
  const [showSeqDialog,    setShowSeqDialog]    = useState(false);
  const [seqDialogPath,    setSeqDialogPath]    = useState('');

  const saveTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizingRef     = useRef<{ startX: number; startWidth: number } | null>(null);
  /**
   * Tracks clip IDs for which we've already attempted thumbnail URL enrichment.
   */
  const enrichedClipIds = useRef(new Set<string>());


  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        let p: VideoProject | undefined;

        if (projectId !== undefined) {
          p = await videoStorage.getProject(projectId);
        }

        if (!p) {
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

  useEffect(() => {
    const off = videoBus.on('playheadMove', ({ frame: f }) => setFrame(f));
    return off;
  }, []);

  /**
   * Lazy thumbnail enrichment.
   *
   * The SceneCompositor renders clips using `clip.source.url` (a data-URL or
   * HTTP URL that Three.js TextureLoader can fetch). Clips added from the
   * native file system only have `clip.source.path`. This effect detects such
   * clips and populates `source.url` via `video_get_thumbnail` so they appear
   * in the preview.
   *
   * - Uses `enrichedClipIds` ref to attempt each clip at most once.
   * - Does NOT persist the enriched URL — it is re-derived on every load
   *   (thumbnail bytes are small; the IPC round-trip is fast).
   * - Fails silently when `SGF_WITH_VIDEO=OFF` (clip stays grey).
   */
  useEffect(() => {
    if (!project) return;

    const pending = project.tracks
      .flatMap(t => t.clips)
      .filter(
        c =>
          c.source.path &&
          !c.source.url &&
          (c.kind === 'image' || c.kind === 'video') &&
          !enrichedClipIds.current.has(c.id),
      );

    if (pending.length === 0) return;

    // Mark as in-progress before the async work to prevent re-triggering.
    pending.forEach(c => enrichedClipIds.current.add(c.id));

    let alive = true;
    void (async () => {
      const updates = new Map<string, string>(); // clipId → dataUrl

      await Promise.allSettled(
        pending.map(async clip => {
          const r = await videoService.getThumbnail(clip.source.path!, 0);
          if (r.ok && r.data?.dataUrl) updates.set(clip.id, r.data.dataUrl);
        }),
      );

      if (!alive || updates.size === 0) return;

      // Use functional updater so we read the latest project state,
      // not the stale closure value.
      setProject(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          tracks: prev.tracks.map(t => ({
            ...t,
            clips: t.clips.map(c =>
              updates.has(c.id)
                ? { ...c, source: { ...c.source, url: updates.get(c.id) } }
                : c,
            ),
          })),
        };
      });
    })();

    return () => { alive = false; };
  // Re-run when the track/clip list changes (but not on every project mutation).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.tracks]);


  const handleProjectChange = useCallback((p: VideoProject) => {
    setProject(p);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      videoStorage.updateProject(p).catch(err =>
        console.warn('[VideoEditor] Auto-save failed:', err)
      );
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const commitName = useCallback(() => {
    setEditingName(false);
    if (!project) return;
    const updated = { ...project, name: nameValue.trim() || project.name };
    handleProjectChange(updated);
  }, [project, nameValue, handleProjectChange]);


  /** Native file-dialog import (kept available but not surfaced in the header). */
  const importFile = useCallback(async (kind: AssetKind) => {
    if (!project) return;

    const result = await fileService.selectFiles();
    if (!result.ok || !result.data || result.data.length === 0) return;

    const path = result.data[0];
    const name = path.split('/').pop() ?? path;

    await videoStorage.addAsset({ name, kind, path });

    let track = project.tracks.find(t =>
      kind === 'audio' ? t.kind === 'audio' : t.kind === 'video'
    );

    let tracks = [...project.tracks];
    if (!track) {
      track = {
        id:    crypto.randomUUID(),
        kind:  kind === 'audio' ? 'audio' : 'video',
        label: kind === 'audio' ? 'Audio 1' : 'Video 1',
        muted: false, solo: false,
        layer: tracks.length,
        clips: [],
      };
      tracks = [...tracks, track];
    }

    const clip: VideoClip = clipFromSource(
      { kind, path },
      frame,
      project.settings.defaultImageDurationFrames,
      track.layer,
      track.id,
      name,
    );

    tracks = tracks.map(t =>
      t.id === track!.id ? { ...t, clips: [...t.clips, clip] } : t
    );
    handleProjectChange({ ...project, tracks });
  }, [project, frame, handleProjectChange]);

  /** Handles a file selection originating from the AssetBrowser side-panel. */
  const handleAssetSelect = useCallback(async (path: string, kind: VideoClipKind) => {
    if (!project) return;

    const name = path.split('/').pop() ?? path;

    // Pre-fetch a thumbnail data-URL so the compositor can render this clip
    // immediately without waiting for the lazy enrichment effect.
    let url: string | undefined;
    if (kind === 'image' || kind === 'video') {
      const r = await videoService.getThumbnail(path, 0);
      if (r.ok && r.data?.dataUrl) {
        url = r.data.dataUrl;
        enrichedClipIds.current.add('_pre_' + path); // won't match clip ID but harmless
      }
    }

    await videoStorage.addAsset({ name, kind, path });

    let track = project.tracks.find(t =>
      kind === 'audio' ? t.kind === 'audio' : t.kind === 'video'
    );

    let tracks = [...project.tracks];
    if (!track) {
      track = {
        id:    crypto.randomUUID(),
        kind:  kind === 'audio' ? 'audio' : 'video',
        label: kind === 'audio' ? 'Audio 1' : 'Video 1',
        muted: false, solo: false,
        layer: tracks.length,
        clips: [],
      };
      tracks = [...tracks, track];
    }

    const clip: VideoClip = clipFromSource(
      { kind, path, url },  // include pre-fetched url so compositor renders it right away
      frame,
      project.settings.defaultImageDurationFrames,
      track.layer,
      track.id,
      name,
    );
    // Mark this clip as already enriched so the lazy effect skips it.
    enrichedClipIds.current.add(clip.id);

    tracks = tracks.map(t =>
      t.id === track!.id ? { ...t, clips: [...t.clips, clip] } : t
    );
    handleProjectChange({ ...project, tracks });
  }, [project, frame, handleProjectChange]);

  /**
   * Open the SequenceImportDialog.
   * Uses the current AssetBrowser path if one has been navigated to,
   * otherwise falls back to a native folder-picker (dms_select_directory).
   */
  const importImageSequence = useCallback(async () => {
    if (!project) return;

    let folderPath = assetCurrentPath;
    if (!folderPath) {
      const res = await fileService.selectDirectory();
      if (!res.ok || !res.data) return;
      folderPath = res.data;
    }

    setSeqDialogPath(folderPath);
    setShowSeqDialog(true);
  }, [project, assetCurrentPath]);

  /**
   * Called by SequenceImportDialog on confirm.
   * Creates one image clip per file, packed sequentially starting at the
   * current playhead position.
   */
  const handleSeqConfirm = useCallback(async (files: string[], secPerClip: number) => {
    setShowSeqDialog(false);
    if (!project || files.length === 0) return;

    const durationFrames = Math.max(1, Math.round(secPerClip * project.fps));

    // Find or create an image track.
    let tracks = [...project.tracks];
    let track  = tracks.find(t => t.kind === 'image' || t.kind === 'video');
    if (!track) {
      track = {
        id:    crypto.randomUUID(),
        kind:  'image' as const,
        label: 'Images 1',
        muted: false, solo: false,
        layer: tracks.length,
        clips: [],
      };
      tracks = [...tracks, track];
    }

    let startFrame = frame;
    const newClips: VideoClip[] = files.map(path => {
      const name = path.split('/').pop() ?? path;
      const clip = clipFromSource(
        { kind: 'image', path },
        startFrame,
        durationFrames,
        track!.layer,
        track!.id,
        name,
      );
      startFrame += durationFrames;
      return clip;
    });

    // Register assets (best-effort, non-blocking).
    void Promise.all(
      files.map(path =>
        videoStorage.addAsset({
          name: path.split('/').pop() ?? path,
          kind: 'image' as const,
          path,
        })
      )
    );

    tracks = tracks.map(t =>
      t.id === track!.id ? { ...t, clips: [...t.clips, ...newClips] } : t
    );

    // Grow the project timeline if needed.
    const endFrame   = startFrame - 1;
    const newProject = {
      ...project,
      tracks,
      durationFrames: Math.max(project.durationFrames, endFrame + 1),
    };
    handleProjectChange(newProject);
  }, [project, frame, handleProjectChange]);


  useEffect(() => {
    if (showExportDialog && !exportPath && workingDir) {
      const name = (project?.name ?? 'output').replace(/[/\\:*?"<>|]/g, '_') + '.mp4';
      setExportPath(workingDir + '/' + name);
    }
  }, [showExportDialog]);

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


  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { startX: e.clientX, startWidth: assetPanelWidth };

    const onMove = (me: MouseEvent) => {
      if (!resizingRef.current) return;
      // Dragging LEFT widens the panel, dragging RIGHT narrows it.
      const delta = resizingRef.current.startX - me.clientX;
      setAssetPanelWidth(
        Math.max(160, Math.min(600, resizingRef.current.startWidth + delta))
      );
    };

    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [assetPanelWidth]);


  const handleKindFilter = useCallback((kind: AssetKind | null) => {
    setAssetFilterKind(prev => prev === kind ? null : kind);
    setAssetPanelOpen(true);
  }, []);


  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--theme-bg)] text-[var(--theme-text-muted)]">
        <span className="text-sm">Loading project…</span>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--theme-bg)] text-[var(--theme-danger)]">
        <span className="text-sm">Failed to load project.</span>
      </div>
    );
  }


  return (
    <div className={`flex flex-col h-full w-full bg-[var(--theme-bg)] text-[var(--theme-text)] overflow-hidden ${className}`}>

      <header className="flex items-center gap-3 px-4 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] flex-shrink-0">

        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-sm
                       px-2 py-1 rounded hover:bg-[var(--theme-bg)]"
            aria-label="Back"
          >
            <Icon name="arrow-left" size={14} aria-hidden /> Back
          </button>
        )}

        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditingName(false);
            }}
            className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded px-2 py-0.5 text-sm
                       text-[var(--theme-text)] w-48 focus:outline-none focus:border-[var(--theme-primary)]"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="text-sm font-medium text-[var(--theme-text)] hover:text-[var(--theme-text)]
                       hover:bg-[var(--theme-bg)] rounded px-2 py-0.5"
            title="Click to rename"
          >
            {project.name}
          </button>
        )}

        <span className="text-xs text-[var(--theme-text-muted)]">
          {project.resolution.width}×{project.resolution.height} @ {project.fps}fps
        </span>

        <div className="flex-1" />

        <button
          onClick={() => setAssetPanelOpen(v => !v)}
          className={[
            'flex items-center gap-1 text-xs px-2 py-1 rounded',
            assetPanelOpen
              ? 'bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]'
              : 'bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)]',
          ].join(' ')}
          aria-pressed={assetPanelOpen}
          aria-label="Toggle asset browser"
        >
          <Icon name="folder-open" size={14} aria-hidden /> Assets
        </button>

        <div className="w-px h-5 bg-[var(--theme-border)]" />

        <button
          onClick={() => setShowExportDialog(true)}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded
                     bg-[var(--theme-primary)] hover:opacity-90 text-[var(--theme-primary-fg)] font-medium"
        >
          <Icon name="upload" size={12} aria-hidden /> Export
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">

        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <div
            className="flex-none bg-[var(--theme-bg)] border-b border-[var(--theme-border)] overflow-hidden"
            style={{ height: '60%' }}
          >
            <VideoPreview project={project} frame={frame} />
          </div>

          <div className="flex-1 overflow-hidden">
            <VideoTimeline
              project={project}
              onProjectChange={handleProjectChange}
            />
          </div>
        </div>

        {assetPanelOpen && (
          <div
            className="w-1 flex-shrink-0 cursor-col-resize bg-[var(--theme-border)]
                       hover:bg-[var(--theme-primary)]/50 transition-colors"
            onMouseDown={handleResizeMouseDown}
            aria-hidden
          />
        )}

        {assetPanelOpen && (
          <aside
            className="flex-shrink-0 flex flex-col border-l border-[var(--theme-border)]
                       bg-[var(--theme-surface)] overflow-hidden"
            style={{ width: assetPanelWidth }}
          >
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 flex-wrap gap-y-1">
              <span className="text-xs font-semibold text-[var(--theme-text)] mr-1 select-none">Assets</span>

              <button
                onClick={() => setAssetFilterKind(null)}
                className={[
                  'text-xs px-2 py-0.5 rounded',
                  assetFilterKind === null
                    ? 'bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]'
                    : 'bg-[var(--theme-bg)] hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]',
                ].join(' ')}
                aria-pressed={assetFilterKind === null}
              >
                All
              </button>

              {(['image', 'video', 'audio'] as const).map(k => (
                <button
                  key={k}
                  onClick={() => handleKindFilter(k)}
                  className={[
                    'flex items-center gap-1 text-xs px-2 py-0.5 rounded',
                    assetFilterKind === k
                      ? 'bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]'
                      : 'bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]',
                  ].join(' ')}
                  aria-pressed={assetFilterKind === k}
                  title={`Filter: ${k}`}
                >
                  <Icon name={IMPORT_ICON[k]} size={11} aria-hidden />
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </button>
              ))}

              <button
                onClick={importImageSequence}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded
                           bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                title={assetCurrentPath
                  ? `Import sequence from: ${assetCurrentPath}`
                  : 'Import image sequence from folder'
                }
              >
                <Icon name="folder-open" size={11} aria-hidden />
                Seq{assetCurrentPath ? ' ·' : ''}
              </button>

              <div className="flex-1" />

              <button
                onClick={() => setAssetPanelOpen(false)}
                className="flex items-center justify-center w-5 h-5 rounded
                           text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]
                           hover:bg-[var(--theme-bg)]"
                aria-label="Close asset panel"
              >
                <Icon name="x" size={12} aria-hidden />
              </button>
            </div>

            <AssetBrowser
              workingDir={workingDir}
              onFileSelect={handleAssetSelect}
              filterKind={assetFilterKind}
              onPathChange={setAssetCurrentPath}
              className="flex-1 min-h-0"
            />
          </aside>
        )}
      </div>

      {showSeqDialog && seqDialogPath && (
        <SequenceImportDialog
          folderPath={seqDialogPath}
          fps={project.fps}
          onConfirm={handleSeqConfirm}
          onCancel={() => setShowSeqDialog(false)}
        />
      )}

      {showExportDialog && (
        <div className="fixed inset-0 bg-[var(--theme-bg)]/70 flex items-center justify-center z-50">
          <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-lg p-6 w-96 shadow-2xl">
            <h2 className="text-sm font-semibold text-[var(--theme-text)] mb-4">Export Video</h2>

            <label className="block text-xs text-[var(--theme-text-muted)] mb-1">Output path</label>
            <div className="flex gap-2 mb-4">
              <input
                value={exportPath}
                onChange={e => setExportPath(e.target.value)}
                placeholder="/path/to/output.mp4"
                className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-3 py-2
                           text-sm text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-primary)]"
              />
              <button
                onClick={async () => {
                  const name = (project?.name ?? 'output')
                    .replace(/[/\\:*?"<>|]/g, '_') + '.mp4';
                  const suggested = workingDir ? workingDir + '/' + name : name;
                  const res = await fileService.selectSavePath(suggested, 'mp4');
                  if (res.ok && res.data?.path) setExportPath(res.data.path);
                }}
                className="px-3 py-2 rounded bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]
                           text-sm text-[var(--theme-text-muted)] shrink-0"
                title="Browse for output path"
              >
                …
              </button>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowExportDialog(false)}
                className="px-4 py-1.5 rounded bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]
                           text-sm text-[var(--theme-text-muted)]"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={!exportPath.trim() || exporting}
                className="px-4 py-1.5 rounded bg-[var(--theme-primary)] hover:opacity-90
                           text-sm text-[var(--theme-primary-fg)] disabled:opacity-50"
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
