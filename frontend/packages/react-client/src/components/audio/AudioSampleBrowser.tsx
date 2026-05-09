/**
 * AudioSampleBrowser
 *
 * Media-file browser for the audio editor.
 *   - When no folder is loaded: shows a compact path-input + folder-icon browse button.
 *   - When a folder is loaded: shows the full FileBrowser with an icon-only browse button.
 *   - Inline ▶/■ play button per row using the Web-Audio hook.
 *   - Drag source: sets dataTransfer with SAMPLE_DRAG_TYPE payload.
 *   - onSampleSelect(path, name) called on double-click / Enter.
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
  onSampleSelect?: (path: string, name: string) => void;
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
  const [pathInput,   setPathInput]   = useState(startDir);

  const onPathChangeRef = useRef(onPathChange);
  useEffect(() => { onPathChangeRef.current = onPathChange; }, [onPathChange]);

  const { play, stop, currentPlayingId, isPlaying } = useAudioPlaybackWithVisualization();

  // ── Directory loading ─────────────────────────────────────────────────────
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
            name: e.name, path: e.path, kind: e.kind,
            size: e.size, modified: e.modified, indexed: e.indexed,
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

  const startDirRef = useRef(startDir);
  useEffect(() => {
    if (startDirRef.current) void loadDir(startDirRef.current);
  }, [loadDir]);

  const handleNavigate  = useCallback((path: string) => void loadDir(path), [loadDir]);
  const handleFileOpen  = useCallback((path: string) => {
    const name = path.split('/').pop() ?? path;
    onSampleSelect?.(path, name);
  }, [onSampleSelect]);
  const handleListSubdirs = useCallback(
    (path: string) => fileService.listSubdirs(path), [],
  );

  const handleBrowse = useCallback(async () => {
    const res = await fileService.selectDirectory();
    if (res.ok && res.data) void loadDir(res.data);
  }, [loadDir]);

  const handlePathInputCommit = useCallback(() => {
    const p = pathInput.trim();
    if (p) void loadDir(p);
  }, [pathInput, loadDir]);

  // Drag source
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

  const renderIcon = useCallback((entry: FileBrowserEntry): React.ReactNode | null => {
    if (entry.kind === 'dir') {
      return <Icon name="folder" size={14} className="text-amber-500/70" />;
    }
    const isActive = currentPlayingId === entry.path;
    return (
      <button
        onClick={async (e) => {
          e.stopPropagation();
          if (isActive && isPlaying) { stop(); }
          else { try { await play(entry.path, entry.path); } catch { /* ignore */ } }
        }}
        className={`flex items-center justify-center w-4 h-4 rounded transition-colors ${
          isActive && isPlaying ? 'text-emerald-400' : 'text-indigo-400/70 hover:text-emerald-400'
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

  // No-folder state
  if (!currentPath) {
    return (
      <div className={`flex flex-col h-full ${className ?? ''}`}>
        {/* Path input row */}
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

        {/* Subtle empty hint */}
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 opacity-30 pointer-events-none select-none">
          <Icon name="audio" size={20} />
          <span className="text-[10px] text-[var(--theme-text-muted)]">no samples folder</span>
        </div>
      </div>
    );
  }

  // filebrowsing finally, when folder is loaded
  return (
    <div className={`flex flex-col h-full ${className ?? ''}`}>
      <FileBrowser
        entries={entries}
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
