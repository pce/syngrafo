/**
 * AssetBrowser  video-editor media picker.
 *
 * Uses `fileService` from `@syngrafo/shared` for all file-system IPC so
 * the field mapping (C++ snake_case → TS camelCase) is done in one place.
 *
 * Interaction model:
 *   - Double-click / Enter key → calls onFileSelect (adds clip at playhead)
 *   - Drag a file onto a timeline lane → HTML5 DnD via ASSET_DRAG_TYPE payload
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { FileBrowser, Icon } from '@syngrafo/ui';
import type { FileBrowserEntry } from '@syngrafo/ui';
import { fileService } from '@syngrafo/shared';
import type { VideoClipKind } from '../types/video.ts';

/** Drag-transfer MIME type shared between AssetBrowser and VideoTimeline. */
export const ASSET_DRAG_TYPE = 'application/x-video-asset';


const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'opus']);
const ALL_MEDIA  = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS]);

function ext(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function inferKind(path: string): VideoClipKind {
  const e = ext(path.split('/').pop() ?? path);
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  if (AUDIO_EXTS.has(e)) return 'audio';
  return 'image';
}

/**
 * If `p` looks like a file path (last segment contains a '.'), return its parent.
 * Returns '' when `p` is empty.
 */
function deriveDir(p: string | undefined): string {
  if (!p) return '';
  const last = p.split('/').pop() ?? '';
  if (last.includes('.')) return p.split('/').slice(0, -1).join('/') || '/';
  return p;
}


export interface AssetBrowserProps {
  /**
   * Starting directory. May be empty (no folder yet) or a file path
   * (collapsed to its parent automatically).
   */
  workingDir?: string;
  /** Called when the user double-clicks / presses Enter on a file. */
  onFileSelect: (path: string, kind: VideoClipKind) => void;
  /** Fires whenever the user navigates to a new directory. */
  onPathChange?: (path: string) => void;
  /**
   * When set, only files whose extension matches this kind are shown.
   * Directories are always shown.
   */
  filterKind?: 'image' | 'video' | 'audio' | null;
  className?: string;
}


export const AssetBrowser: React.FC<AssetBrowserProps> = ({
  workingDir,
  onFileSelect,
  onPathChange,
  filterKind,
  className,
}) => {
  const startDir = deriveDir(workingDir);

  const [currentPath, setCurrentPath] = useState(startDir);
  const [pathInput,   setPathInput]   = useState(startDir);
  const [entries,     setEntries]     = useState<FileBrowserEntry[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const onPathChangeRef = useRef(onPathChange);
  useEffect(() => { onPathChangeRef.current = onPathChange; }, [onPathChange]);


  const loadDir = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fileService.scanDir(path);

      if (res.ok && res.data) {
        const mapped: FileBrowserEntry[] = res.data.entries
          .filter(e => {
            if (e.kind === 'dir') return true;
            return ALL_MEDIA.has(ext(e.name));
          })
          .map(e => ({
            name:     e.name,
            path:     e.path,
            kind:     e.kind,
            size:     e.size,
            modified: e.modified,
            indexed:  e.indexed,
          }));

        const parentPath = path.split('/').slice(0, -1).join('/') || '/';
        const all: FileBrowserEntry[] = path === '/'
          ? mapped
          : [{ name: '..', path: parentPath, kind: 'dir' as const }, ...mapped];

        setEntries(all);
        setCurrentPath(path);
        setPathInput(path);
        onPathChangeRef.current?.(path);
      } else {
        setError(res.error ?? 'Failed to list directory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the initial directory once on mount.
  const startDirRef = useRef(startDir);
  useEffect(() => {
    if (startDirRef.current) void loadDir(startDirRef.current);
  }, [loadDir]);


  const handleNavigate  = useCallback((path: string) => void loadDir(path), [loadDir]);
  const handleFileOpen  = useCallback((path: string) => onFileSelect(path, inferKind(path)), [onFileSelect]);
  const handleListSubdirs = useCallback((path: string) => fileService.listSubdirs(path), []);

  const handleBrowse = useCallback(async () => {
    const res = await fileService.selectDirectory();
    if (res.ok && res.data) void loadDir(res.data);
  }, [loadDir]);

  const handlePathInputCommit = useCallback(() => {
    const trimmed = pathInput.trim();
    if (trimmed) void loadDir(trimmed);
  }, [pathInput, loadDir]);


  const displayEntries = useMemo(() => {
    if (!filterKind) return entries;
    return entries.filter(e => {
      if (e.kind === 'dir') return true;
      const e_ = ext(e.name);
      if (filterKind === 'image') return IMAGE_EXTS.has(e_);
      if (filterKind === 'video') return VIDEO_EXTS.has(e_);
      if (filterKind === 'audio') return AUDIO_EXTS.has(e_);
      return true;
    });
  }, [entries, filterKind]);


  const toolbarRight = useMemo(() => (
    <button
      onClick={handleBrowse}
      title="Change folder"
      className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                 hover:bg-[var(--theme-bg)] transition-colors shrink-0"
    >
      <Icon name="folder-open" size={14} />
    </button>
  ), [handleBrowse]);


  const renderIcon = useCallback((entry: FileBrowserEntry): React.ReactNode | null => {
    if (entry.kind === 'dir') return <Icon name="folder"  size={14} className="text-amber-500/70" />;
    const e_ = ext(entry.name);
    if (IMAGE_EXTS.has(e_)) return <Icon name="image"  size={14} className="text-indigo-400/70" />;
    if (VIDEO_EXTS.has(e_)) return <Icon name="video"  size={14} className="text-violet-400/70" />;
    if (AUDIO_EXTS.has(e_)) return <Icon name="audio"  size={14} className="text-emerald-400/70" />;
    return <Icon name="file" size={14} className="text-[var(--theme-text-muted)] opacity-50" />;
  }, []);


  const handleFileDragStart = useCallback((entry: FileBrowserEntry, e: React.DragEvent) => {
    const kind = inferKind(entry.path);
    e.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify({ path: entry.path, kind }));
    e.dataTransfer.effectAllowed = 'copy';

    const ghost = document.createElement('div');
    ghost.textContent = `+ ${entry.name}`;
    Object.assign(ghost.style, {
      position: 'fixed', top: '-200px', left: '0',
      padding: '4px 10px',
      background: 'var(--theme-primary, #6366f1)',
      color: 'white', borderRadius: '6px',
      fontSize: '11px', fontWeight: '600',
      pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '9999',
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 8, 12);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);


  // No-folder state
  if (!currentPath) {
    return (
      <div className={`flex flex-col h-full ${className ?? ''}`}>
        <div className="flex items-center gap-1 px-2 py-2 border-b border-[var(--theme-border)] shrink-0">
          <input
            type="text"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handlePathInputCommit(); }}
            placeholder="Paste folder path…"
            className="flex-1 min-w-0 text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)]
                       rounded px-2 py-1 text-[var(--theme-text)] placeholder-[var(--theme-text-muted)]/50
                       focus:outline-none focus:border-[var(--theme-primary)]"
          />
          <button
            onClick={handlePathInputCommit}
            title="Go to path"
            className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]
                       hover:bg-[var(--theme-bg)] transition-colors shrink-0 border border-[var(--theme-border)]"
          >
            <Icon name="chevron-right" size={12} />
          </button>
          <button
            onClick={handleBrowse}
            title="Browse for folder"
            className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                       hover:bg-[var(--theme-bg)] transition-colors shrink-0 border border-[var(--theme-border)]"
          >
            <Icon name="folder-open" size={14} />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 opacity-30 pointer-events-none select-none">
          <Icon name="folder-open" size={20} />
          <span className="text-[10px] text-[var(--theme-text-muted)]">no media folder</span>
        </div>
      </div>
    );
  }

  // Normal state: folder loaded
  return (
    <div className={`flex flex-col h-full ${className ?? ''}`}>
      <FileBrowser
        entries={displayEntries}
        currentPath={currentPath}
        loading={loading}
        error={error}
        onNavigate={handleNavigate}
        onFileOpen={handleFileOpen}
        onListSubdirs={handleListSubdirs}
        onFileDragStart={handleFileDragStart}
        toolbarRight={toolbarRight}
        renderIcon={renderIcon}
        className="flex-1 min-h-0"
      />
    </div>
  );
};
