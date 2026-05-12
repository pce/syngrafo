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
import { videoBus, fileService, generateName, uid, SPRING_PRESETS } from '@syngrafo/shared';
import { videoStorage }  from '../storage/videoStorage.ts';
import { videoService }  from '../ipc/video-service.ts';
import { defaultProject, clipFromSource } from '../types/video.ts';
import type { VideoProject, VideoClip, VideoClipKind, VideoKeyframe } from '../types/video.ts';
import { VideoTimeline } from '../timeline/VideoTimeline.tsx';
import { VideoPreview }  from '../preview/VideoPreview.tsx';
import { Icon, ResizablePanel } from '@syngrafo/ui';
import { AssetBrowser }  from '../browser/AssetBrowser.tsx';
import { ClipInspector }  from './ClipInspector.tsx';
import { SequenceImportDialog } from '../browser/SequenceImportDialog.tsx';
import type { KenBurnsOp, VideoOperator } from '../types/effect.ts';
import type { SequenceImportConfig } from '../types/sequence.ts';
import { getLookPreset } from '../types/look.ts';
import { ProjectHub } from './ProjectHub.tsx';

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
  const [assetFilterKind,  setAssetFilterKind]  = useState<AssetKind | null>(null);
  const [assetCurrentPath, setAssetCurrentPath] = useState('');
  const [showSeqDialog,    setShowSeqDialog]    = useState(false);
  const [seqDialogPath,    setSeqDialogPath]    = useState('');
  const [inspectorClipId,  setInspectorClipId]  = useState<string | null>(null);
  const [showHub,          setShowHub]          = useState(false);

  const saveTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Tracks clip IDs for which we've already attempted thumbnail URL enrichment.
   */
  const enrichedClipIds = useRef(new Set<string>());


  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // Fetch the persisted project list first so we can resolve IDs across reloads.
        const list = await videoStorage.listProjects();

        if (projectId !== undefined) {
          // Try cache first; fall back to IPC lookup by matching numeric id.
          let p = await videoStorage.getProject(projectId);
          if (!p) {
            const meta = list.find(m => m.id === projectId);
            if (meta) p = await videoStorage.loadProjectByName(meta.name);
          }
          if (p) {
            if (!cancelled) { setProject(p); setNameValue(p.name); setShowHub(false); }
            return;
          }
        }

        if (list.length > 0) {
          // Show the hub — let the user pick which project to open.
          if (!cancelled) setShowHub(true);
        } else {
          // First launch — create a blank project immediately.
          const template = defaultProject(generateName(), 30);
          const p = await videoStorage.createProject(template);
          if (!cancelled) { setProject(p); setNameValue(p.name); setShowHub(false); }
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

    // Pre-fetch a thumbnail data-URL so the compositor can render this clip
    // immediately without waiting for the lazy enrichment effect (same pattern
    // as handleAssetSelect).
    let url: string | undefined;
    if (kind === 'image' || kind === 'video') {
      const r = await videoService.getThumbnail(path, 0);
      if (r.ok && r.data?.dataUrl) url = r.data.dataUrl;
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
      { kind, path, url },  // include pre-fetched url so compositor renders immediately
      frame,
      project.settings.defaultImageDurationFrames,
      track.layer,
      track.id,
      name,
    );
    // Mark as already enriched so the lazy effect skips it.
    if (url) enrichedClipIds.current.add(clip.id);

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
   * Creates one image clip per file with transitions, Ken Burns, and look
   * presets applied according to the user-chosen SequenceImportConfig.
   */
  const handleSeqConfirm = useCallback(async (
    files: string[],
    config: SequenceImportConfig,
  ) => {
    setShowSeqDialog(false);
    if (!project || files.length === 0) return;

    const fps = project.fps;
    const W   = project.resolution.width;
    const H   = project.resolution.height;

    // Duration per clip (frames)
    const durationFrames = config.mode === 'daumenkino'
      ? Math.max(1, config.framesPerImage)
      : Math.max(1, Math.round(config.secPerClip * fps));

    // Transition frames capped to half the clip duration
    const txFrames = config.transition === 'none'
      ? 0
      : Math.min(config.transitionFrames, Math.floor(durationFrames / 2));

    // Look preset shader nodes (each clip gets a fresh copy)
    const look = getLookPreset(config.lookPresetId);

    // Find or create an image track.
    let tracks = [...project.tracks];
    let track  = tracks.find(t => t.kind === 'image' || t.kind === 'video');
    if (!track) {
      track = {
        id:    uid(),
        kind:  'image' as const,
        label: 'Images 1',
        muted: false,
        solo:  false,
        layer: tracks.length,
        clips: [],
      };
      tracks = [...tracks, track];
    }

    const SLIDE_VARIANTS: Array<'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'> = [
      'slide-left', 'slide-right', 'slide-up', 'slide-down',
    ];

    let startFrame = frame;
    const newClips: VideoClip[] = files.map((path, i) => {
      const name   = path.split('/').pop() ?? path;
      const clipId = uid();

      // -- Operators --
      const operators: VideoOperator[] = [];

      // Resolve transition for this clip
      let tx = config.transition as typeof config.transition | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';
      if (tx === 'random') {
        tx = SLIDE_VARIANTS[i % SLIDE_VARIANTS.length]!;
      }

      if (config.mode !== 'daumenkino') {
        if (tx === 'fade') {
          // Fade via opacity operators
          if (txFrames > 0) {
            operators.push({ kind: 'fadeIn',  id: uid(), clipId, startFrame: 0,                          durationFrames: txFrames, easing: 'spring' });
            operators.push({ kind: 'fadeOut', id: uid(), clipId, startFrame: durationFrames - txFrames,  durationFrames: txFrames, easing: 'spring' });
          }
        }

        if (config.kenBurns) {
          // Alternate direction each clip for variety
          const panDir = i % 2 === 0 ? 1 : -1;
          const kb: KenBurnsOp = {
            kind:         'kenburns',
            id:           uid(),
            clipId,
            fromScale:    1.0,
            toScale:      1.12,
            fromOffset:   [0, 0] as [number, number],
            toOffset:     [0.015 * panDir, 0.005] as [number, number],
            springConfig: SPRING_PRESETS.gentle,
          };
          operators.push(kb);
        }
      }

      // -- Keyframe-based slide transitions --
      const keyframes: VideoKeyframe[] = [];
      if (config.mode !== 'daumenkino' && txFrames > 0) {
        const absStart = startFrame;
        // absEnd reserved for exit keyframes in a future iteration
        // const absEnd = startFrame + durationFrames - 1;

        if (tx === 'slide-left') {
          keyframes.push({ id: uid(), property: 'posX', frame: absStart,            value:  W, easing: 'spring' });
          keyframes.push({ id: uid(), property: 'posX', frame: absStart + txFrames, value:  0, easing: 'spring' });
        } else if (tx === 'slide-right') {
          keyframes.push({ id: uid(), property: 'posX', frame: absStart,            value: -W, easing: 'spring' });
          keyframes.push({ id: uid(), property: 'posX', frame: absStart + txFrames, value:  0, easing: 'spring' });
        } else if (tx === 'slide-up') {
          keyframes.push({ id: uid(), property: 'posY', frame: absStart,            value: -H, easing: 'spring' });
          keyframes.push({ id: uid(), property: 'posY', frame: absStart + txFrames, value:  0, easing: 'spring' });
        } else if (tx === 'slide-down') {
          keyframes.push({ id: uid(), property: 'posY', frame: absStart,            value:  H, easing: 'spring' });
          keyframes.push({ id: uid(), property: 'posY', frame: absStart + txFrames, value:  0, easing: 'spring' });
        }
      }

      // Build the base clip via clipFromSource, then override its operators/
      // keyframes with our carefully constructed set.
      const base = clipFromSource(
        { kind: 'image', path },
        startFrame,
        durationFrames,
        track!.layer,
        track!.id,
        name,
      );

      // Fix clipId references in operators to match the base clip's id
      const fixedOps = operators.map(op => ({ ...op, clipId: base.id })) as VideoOperator[];

      const clip: VideoClip = {
        ...base,
        id:          base.id,
        operators:   fixedOps,
        keyframes,
        shaderChain: look.makeNodes().map(n => ({ ...n, id: uid() })),
      };

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


  const handleKindFilter = useCallback((kind: AssetKind | null) => {
    setAssetFilterKind(prev => prev === kind ? null : kind);
  }, []);

  // ── Inspector ────────────────────────────────────────────────────────────

  /** The clip currently open in the inspector (re-derived on every render). */
  const inspectorClip = (inspectorClipId != null && project)
    ? project.tracks.flatMap(t => t.clips).find(c => c.id === inspectorClipId) ?? null
    : null;

  /** Update a single clip within the project and trigger auto-save. */
  const handleClipChange = useCallback((updatedClip: VideoClip) => {
    if (!project) return;
    handleProjectChange({
      ...project,
      tracks: project.tracks.map(t => ({
        ...t,
        clips: t.clips.map(c => c.id === updatedClip.id ? updatedClip : c),
      })),
    });
  }, [project, handleProjectChange]);

  /**
   * Reverse a video clip segment via FFmpeg (backend stub).
   *
   * For image sequences (multiple image clips in order), reversal is a
   * frontend-only operation: reverse the clips array on the track.
   * That requires track-level context; a 'Reverse Track Segment' action
   * in TrackHeader would be the right place. For now, only video clips
   * with a single source file are handled here.
   */
  const handleReverseClip = useCallback(async (clip: VideoClip) => {
    if (!project || !clip.source.path) return;

    const fps         = project.fps;
    const startSec    = (clip.sourceOffset ?? 0) / fps;
    const durationSec = (clip.range.endFrame - clip.range.startFrame + 1) / fps;

    // Auto-generate output path: /dir/name_reversed.ext
    const inputPath  = clip.source.path;
    const lastDot    = inputPath.lastIndexOf('.');
    const ext        = lastDot >= 0 ? inputPath.slice(lastDot)      : '.mp4';
    const base       = lastDot >= 0 ? inputPath.slice(0, lastDot)   : inputPath;
    const outputPath = `${base}_reversed${ext}`;

    const result = await videoService.reverseClip(inputPath, startSec, durationSec, outputPath);

    if (!result.ok || !result.data) {
      // Show error — reversal is a 🚧 stub until the backend binding is implemented
      alert(`Reverse not yet available: ${result.error ?? 'backend binding video_reverse_clip not registered'}`);
      return;
    }

    // Update the clip to point at the reversed file; clear the cached thumbnail URL
    const updated: VideoClip = {
      ...clip,
      source:       { ...clip.source, path: result.data.outputPath, url: undefined },
      sourceOffset: 0,
    };
    handleClipChange(updated);
  }, [project, handleClipChange]);


  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--theme-bg)] text-[var(--theme-text-muted)]">
        <span className="text-sm">Loading project…</span>
      </div>
    );
  }

  if (showHub) {
    return (
      <ProjectHub
        onOpen={async name => {
          setLoading(true);
          try {
            const p = await videoStorage.loadProjectByName(name);
            if (p) { setProject(p); setNameValue(p.name); }
          } finally {
            setShowHub(false);
            setLoading(false);
          }
        }}
        onNew={async () => {
          setLoading(true);
          try {
            const template = defaultProject(generateName(), 30);
            const p = await videoStorage.createProject(template);
            setProject(p);
            setNameValue(p.name);
          } finally {
            setShowHub(false);
            setLoading(false);
          }
        }}
      />
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
            className="flex items-center gap-1 text-sm font-medium text-[var(--theme-text)]
                       hover:bg-[var(--theme-bg)] rounded px-2 py-0.5 group"
            title="Click to rename"
          >
            {project.name}
            <Icon name="edit" size={10} aria-hidden
                  className="opacity-0 group-hover:opacity-40 transition-opacity" />
          </button>
        )}

        <span className="text-xs text-[var(--theme-text-muted)]">
          {project.resolution.width}x{project.resolution.height} @ {project.fps}fps
        </span>

        <div className="flex-1" />

        <button
          onClick={() => setShowHub(true)}
          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded
                     border border-[var(--theme-border)] text-[var(--theme-text-muted)]
                     hover:text-[var(--theme-text)] hover:border-[var(--theme-primary)]
                     transition-colors"
        >
          ⊞ Projects
        </button>

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
              onClipSelect={setInspectorClipId}
            />
          </div>
        </div>

        {inspectorClip && (
          <ResizablePanel
            label="Inspector"
            side="right"
            defaultWidth={260}
            minWidth={200}
            maxWidth={400}
            open={true}
            onOpenChange={(o) => { if (!o) setInspectorClipId(null); }}
          >
            <ClipInspector
              clip={inspectorClip}
              project={project}
              currentFrame={frame}
              onChange={handleClipChange}
              onClose={() => setInspectorClipId(null)}
              onReverse={handleReverseClip}
            />
          </ResizablePanel>
        )}

        <ResizablePanel
          label="Assets"
          side="right"
          defaultWidth={280}
          minWidth={180}
          maxWidth={500}
          defaultOpen={false}
          headerExtra={
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setAssetFilterKind(null)}
                className={[
                  'text-[9px] px-1.5 py-0.5 rounded',
                  assetFilterKind === null
                    ? 'bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]'
                    : 'bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]',
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
                    'flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded',
                    assetFilterKind === k
                      ? 'bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]'
                      : 'bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]',
                  ].join(' ')}
                  aria-pressed={assetFilterKind === k}
                  title={`Filter: ${k}`}
                >
                  <Icon name={IMPORT_ICON[k]} size={10} aria-hidden />
                </button>
              ))}
              <button
                onClick={importImageSequence}
                className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                title={assetCurrentPath
                  ? `Import sequence from: ${assetCurrentPath}`
                  : 'Import image sequence from folder'
                }
              >
                <Icon name="folder-open" size={10} aria-hidden />
              </button>
            </div>
          }
        >
          <AssetBrowser
            workingDir={workingDir}
            onFileSelect={handleAssetSelect}
            filterKind={assetFilterKind}
            onPathChange={setAssetCurrentPath}
            className="h-full"
          />
        </ResizablePanel>
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
