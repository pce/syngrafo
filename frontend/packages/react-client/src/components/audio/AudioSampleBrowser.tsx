/**
 * AudioSampleBrowser
 *
 * Media-file browser for the audio editor.  Mirrors the video package's
 * AssetBrowser pattern:
 *   - Scans a directory with fileService.scanDir (dms_scan_dir binding)
 *   - Filters to audio extensions only (directories always shown)
 *   - Inline ▶/■ play button per row using the Web-Audio hook
 *   - Browse… button opens a native folder picker
 *   - Drag source: sets dataTransfer with SAMPLE_DRAG_TYPE payload
 *   - onSampleSelect(path, name) called on double-click / Enter
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { FileBrowser, Icon } from '@syngrafo/ui';
import type { FileBrowserEntry } from '@syngrafo/ui';
import { fileService } from '@syngrafo/shared';
import { useAudioPlaybackWithVisualization } from '@/hooks/useAudioPlaybackWithVisualization';

export const SAMPLE_DRAG_TYPE = 'application/x-audio-sample';

const AUDIO_EXTS = new Set([
  'mp3','wav','aac','ogg','flac','m4a','opus','aiff','aif','wma','caf',
]);

function ext(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function deriveDir(p: string | undefined): string {
  if (!p) return '';
  const last = p.split('/').pop() ?? '';
  if (last.includes('.')) return p.split('/').slice(0, -1).join('/') || '/';
  return p;
}

export interface AudioSampleBrowserProps {
  workingDir?: string;
  /** Called when the user double-clicks / Enter on an audio file. */
  onSampleSelect?: (path: string, name: string) => void;
  /** Fires whenever the user navigates to a new directory. */
  onPathChange?: (path: string) => void;
  className?: string;
}

export const AudioSampleBrowser: React.FC<AudioSampleBrowserProps> = ({
  workingDir,
  onSampleSelect,
  onPathChange,
  className,
}) => {
  const startDir = deriveDir(workingDir);

  const [currentPath, setCurrentPath] = useState(startDir);
  const [entries,     setEntries]     = useState<FileBrowserEntry[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const onPathChangeRef = useRef(onPathChange);
  useEffect(() => { onPathChangeRef.current = onPathChange; }, [onPathChange]);

  const {
    play, stop,
    currentPlayingId, isPlaying,
  } = useAudioPlaybackWithVisualization();

  // ── Directory loading ───────────────────────────────────────────────────────
  const loadDir = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fileService.scanDir(path);
      if (res.ok && res.data) {
        const mapped: FileBrowserEntry[] = res.data.entries
          .filter(e => e.kind === 'dir' || AUDIO_EXTS.has(ext(e.name)))
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

  const startDirRef = useRef(startDir);
  useEffect(() => {
    if (startDirRef.current) void loadDir(startDirRef.current);
  }, [loadDir]);

  const handleNavigate = useCallback((path: string) => void loadDir(path), [loadDir]);

  const handleFileOpen = useCallback((path: string) => {
    const name = path.split('/').pop() ?? path;
    onSampleSelect?.(path, name);
  }, [onSampleSelect]);

  const handleListSubdirs = useCallback(
    (path: string) => fileService.listSubdirs(path),
    [],
  );

  // ── Drag source ─────────────────────────────────────────────────────────────
  const handleFileDragStart = useCallback((entry: FileBrowserEntry, e: React.DragEvent) => {
    e.dataTransfer.setData(
      SAMPLE_DRAG_TYPE,
      JSON.stringify({ path: entry.path, name: entry.name }),
    );
    e.dataTransfer.effectAllowed = 'copy';

    const ghost = document.createElement('div');
    ghost.textContent = `♪ ${entry.name}`;
    Object.assign(ghost.style, {
      position: 'fixed', top: '-200px', left: '0',
      padding: '4px 10px',
      background: 'var(--theme-primary, #4f46e5)',
      color: 'white', borderRadius: '6px',
      fontSize: '11px', fontWeight: '600',
      pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '9999',
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 8, 12);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  // ── Row icon + inline play button ───────────────────────────────────────────
  const renderIcon = useCallback((entry: FileBrowserEntry): React.ReactNode | null => {
    if (entry.kind === 'dir') {
      return <Icon name="folder" size={14} className="text-amber-500/70" />;
    }
    const isActive = currentPlayingId === entry.path;
    return (
      <button
        onClick={async (e) => {
          e.stopPropagation();
          if (isActive && isPlaying) {
            stop();
          } else {
            try {
              await play(entry.path, entry.path);
            } catch { /* ignore */ }
          }
        }}
        className={`flex items-center justify-center w-4 h-4 rounded transition-colors ${
          isActive && isPlaying
            ? 'text-emerald-400'
            : 'text-indigo-400/70 hover:text-emerald-400'
        }`}
        aria-label={isActive && isPlaying ? 'Stop' : 'Preview'}
        title={isActive && isPlaying ? 'Stop' : 'Preview'}
      >
        {isActive && isPlaying
          ? <Icon name="stop"  size={12} />
          : <Icon name="audio" size={12} />
        }
      </button>
    );
  }, [currentPlayingId, isPlaying, play, stop]);

  // ── Toolbar ─────────────────────────────────────────────────────────────────
  const toolbarRight = useMemo(() => (
    <button
      onClick={async () => {
        const res = await fileService.selectDirectory();
        if (res.ok && res.data) void loadDir(res.data);
      }}
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded
                 bg-[var(--theme-primary)] hover:opacity-90 text-[var(--theme-primary-fg)]
                 transition-colors shrink-0"
    >
      Browse…
    </button>
  ), [loadDir]);

  // ── Empty state ─────────────────────────────────────────────────────────────
  const emptyContent = !currentPath ? (
    <div className="flex flex-col items-center justify-center gap-3 p-6 h-full text-[var(--theme-text-muted)]">
      <Icon name="audio" size={24} />
      <p className="text-xs text-center leading-relaxed">
        No folder selected.<br />
        Click <strong>Browse…</strong> to pick a samples folder.
      </p>
    </div>
  ) : undefined;

  return (
    <div className={`flex flex-col h-full ${className ?? ''}`}>
      <FileBrowser
        entries={currentPath ? entries : []}
        currentPath={currentPath || '/'}
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
      {emptyContent}
    </div>
  );
};
