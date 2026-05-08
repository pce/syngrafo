/**
 * VideoTimeline.tsx
 * Main video timeline component.
 *
 * Features:
 *  - Track lanes with clip blocks, drag-to-move and resize
 *  - Playhead (rAF-based playback, frame-accurate)
 *  - Keyboard: Space=play/pause, ←/→=±1 frame (Shift=±fps), Del=delete clip, S=split
 *  - Zoom slider (pixelsPerFrame adjusts)
 *  - Add-track buttons (video, audio, image)
 *  - Timecode display
 *  - Emits to shared videoBus on playhead move
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { toTimecode, videoBus, uid } from '@syngrafo/shared';
import type { VideoProject, VideoTrackLane, VideoClip } from '../types/video.ts';
import { Ruler }       from './Ruler.tsx';
import { ClipBlock }   from './ClipBlock.tsx';
import { TrackHeader } from './TrackHeader.tsx';

const TRACK_HEIGHT   = 64;     // px per track row
const HEADER_WIDTH   = 180;    // px for track-header column
const MIN_ZOOM       = 0.25;
const MAX_ZOOM       = 8;

interface DragState {
  clipId:     string;
  trackId:    string;
  edge:       'body' | 'start' | 'end';
  startMouseX: number;
  /** Original range at drag start */
  origStart:  number;
  origEnd:    number;
}

export interface VideoTimelineProps {
  project:         VideoProject;
  onProjectChange: (p: VideoProject) => void;
}

export const VideoTimeline: React.FC<VideoTimelineProps> = ({
  project,
  onProjectChange,
}) => {
  // state
  const [playheadFrame,   setPlayheadFrame]   = useState(0);
  const [isPlaying,       setIsPlaying]       = useState(false);
  const [zoom,            setZoom]            = useState(1);
  const [selectedClipId,  setSelectedClipId]  = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [scrollLeft,      setScrollLeft]      = useState(0);
  const [viewportWidth,   setViewportWidth]   = useState(800);

  // refs
  const scrollRef    = useRef<HTMLDivElement>(null);
  const rafRef       = useRef<number | null>(null);
  const lastTimeRef  = useRef<number | null>(null);
  const dragRef      = useRef<DragState | null>(null);
  const playheadRef  = useRef(playheadFrame);
  playheadRef.current = playheadFrame;

  const { fps, durationFrames } = project;

  // pixelsPerFrame: base is 50px/second (i.e. 50/fps px/frame) × zoom
  const pixelsPerFrame = (50 / fps) * zoom;
  const totalWidth     = durationFrames * pixelsPerFrame;

  // sync viewport width
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setViewportWidth(entry.contentRect.width);
    });
    ro.observe(scrollRef.current);
    setViewportWidth(scrollRef.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  // playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current  = null;
        lastTimeRef.current = null;
      }
      return;
    }

    const tick = (now: number) => {
      if (lastTimeRef.current === null) { lastTimeRef.current = now; }
      const elapsed = (now - lastTimeRef.current) / 1000;   // seconds
      lastTimeRef.current = now;

      const deltaFrames = elapsed * fps;
      const next = playheadRef.current + deltaFrames;

      if (next >= durationFrames) {
        setPlayheadFrame(0);
        setIsPlaying(false);
        return;
      }

      const newFrame = Math.floor(next);
      if (newFrame !== playheadRef.current) {
        setPlayheadFrame(newFrame);
        videoBus.emit('playheadMove', { frame: newFrame });
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, fps, durationFrames]);

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when an input/textarea has focus
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          setIsPlaying(p => !p);
          break;

        case 'ArrowLeft':
          e.preventDefault();
          setPlayheadFrame(f => {
            const next = Math.max(0, f - (e.shiftKey ? fps : 1));
            videoBus.emit('playheadMove', { frame: next });
            return next;
          });
          break;

        case 'ArrowRight':
          e.preventDefault();
          setPlayheadFrame(f => {
            const next = Math.min(durationFrames - 1, f + (e.shiftKey ? fps : 1));
            videoBus.emit('playheadMove', { frame: next });
            return next;
          });
          break;

        case 'Delete':
        case 'Backspace':
          if (selectedClipId) {
            e.preventDefault();
            deleteClip(selectedClipId);
          }
          break;

        case 's':
        case 'S':
          if (selectedClipId) {
            e.preventDefault();
            splitClip(selectedClipId, playheadRef.current);
          }
          break;

        default: break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fps, durationFrames, selectedClipId]);

  // scroll tracking
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft((e.currentTarget as HTMLDivElement).scrollLeft);
  };

  // clip helpers

  const updateClip = useCallback((
    clipId: string,
    updater: (clip: VideoClip) => VideoClip,
  ) => {
    const tracks = project.tracks.map(t => ({
      ...t,
      clips: t.clips.map(c => c.id === clipId ? updater(c) : c),
    }));
    onProjectChange({ ...project, tracks });
  }, [project, onProjectChange]);

  const deleteClip = useCallback((clipId: string) => {
    const tracks = project.tracks.map(t => ({
      ...t,
      clips: t.clips.filter(c => c.id !== clipId),
    }));
    onProjectChange({ ...project, tracks });
    setSelectedClipId(null);
  }, [project, onProjectChange]);

  const splitClip = useCallback((clipId: string, frame: number) => {
    const track = project.tracks.find(t => t.clips.some(c => c.id === clipId));
    if (!track) return;
    const clip = track.clips.find(c => c.id === clipId);
    if (!clip || frame <= clip.range.startFrame || frame >= clip.range.endFrame) return;

    const first:  VideoClip = { ...clip, id: uid(), range: { startFrame: clip.range.startFrame, endFrame: frame - 1 } };
    const second: VideoClip = { ...clip, id: uid(), range: { startFrame: frame, endFrame: clip.range.endFrame } };

    const tracks = project.tracks.map(t => {
      if (t.id !== track.id) return t;
      return {
        ...t,
        clips: t.clips.flatMap(c => c.id === clipId ? [first, second] : [c]),
      };
    });
    onProjectChange({ ...project, tracks });
    setSelectedClipId(null);
  }, [project, onProjectChange]);

  // drag logic

  const handleClipDragStart = useCallback((
    e: React.MouseEvent,
    clipId: string,
    edge: 'body' | 'start' | 'end',
  ) => {
    const track = project.tracks.find(t => t.clips.some(c => c.id === clipId));
    const clip  = track?.clips.find(c => c.id === clipId);
    if (!clip) return;

    dragRef.current = {
      clipId,
      trackId: track!.id,
      edge,
      startMouseX: e.clientX,
      origStart:   clip.range.startFrame,
      origEnd:     clip.range.endFrame,
    };

    const onMouseMove = (me: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx     = me.clientX - drag.startMouseX;
      const dFrame = Math.round(dx / pixelsPerFrame);

      if (drag.edge === 'body') {
        const dur   = drag.origEnd - drag.origStart;
        const start = Math.max(0, drag.origStart + dFrame);
        updateClip(drag.clipId, c => ({
          ...c,
          range: { startFrame: start, endFrame: start + dur },
        }));
      } else if (drag.edge === 'start') {
        const newStart = Math.max(0, Math.min(drag.origEnd - 1, drag.origStart + dFrame));
        updateClip(drag.clipId, c => ({
          ...c,
          range: { startFrame: newStart, endFrame: drag.origEnd },
        }));
      } else {
        const newEnd = Math.max(drag.origStart + 1, drag.origEnd + dFrame);
        updateClip(drag.clipId, c => ({
          ...c,
          range: { startFrame: drag.origStart, endFrame: newEnd },
        }));
      }
    };

    const onMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  }, [project, pixelsPerFrame, updateClip]);

  // add track

  const addTrack = useCallback((kind: 'video' | 'audio' | 'image') => {
    const realKind  = kind === 'image' ? 'video' : kind;   // image clips live on video lanes
    const count     = project.tracks.filter(t => t.kind === realKind).length + 1;
    const label     = kind === 'audio' ? `Audio ${count}` :
                      kind === 'image' ? `Images ${count}` : `Video ${count}`;
    const newTrack: VideoTrackLane = {
      id:    uid(),
      kind:  realKind as 'video' | 'audio' | 'effect',
      label,
      muted: false,
      solo:  false,
      layer: project.tracks.length,
      clips: [],
    };
    onProjectChange({ ...project, tracks: [...project.tracks, newTrack] });
  }, [project, onProjectChange]);

  // track mute / solo / delete

  const toggleMute = useCallback((id: string) => {
    const tracks = project.tracks.map(t =>
      t.id === id ? { ...t, muted: !t.muted } : t
    );
    onProjectChange({ ...project, tracks });
  }, [project, onProjectChange]);

  const toggleSolo = useCallback((id: string) => {
    const tracks = project.tracks.map(t =>
      t.id === id ? { ...t, solo: !t.solo } : t
    );
    onProjectChange({ ...project, tracks });
  }, [project, onProjectChange]);

  const deleteTrack = useCallback((id: string) => {
    const tracks = project.tracks.filter(t => t.id !== id);
    onProjectChange({ ...project, tracks });
    if (selectedTrackId === id) setSelectedTrackId(null);
  }, [project, onProjectChange, selectedTrackId]);

  // seek

  const handleSeek = useCallback((frame: number) => {
    setPlayheadFrame(frame);
    videoBus.emit('playheadMove', { frame });
  }, []);

  // playhead auto-scroll
  useEffect(() => {
    if (!scrollRef.current) return;
    const x = playheadFrame * pixelsPerFrame;
    const sl = scrollRef.current.scrollLeft;
    const vw = scrollRef.current.clientWidth;
    if (x < sl || x > sl + vw - 40) {
      scrollRef.current.scrollLeft = Math.max(0, x - vw / 2);
    }
  // Only auto-scroll during playback to avoid hijacking manual scroll
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying ? playheadFrame : null, pixelsPerFrame]);

  // timecode display
  const timecode = toTimecode(playheadFrame, fps);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white overflow-hidden">

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">

        {/* Transport */}
        <button
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={() => setIsPlaying(p => !p)}
          className="w-8 h-8 flex items-center justify-center rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <button
          aria-label="Stop"
          onClick={() => { setIsPlaying(false); handleSeek(0); }}
          className="w-8 h-8 flex items-center justify-center rounded bg-gray-700 hover:bg-gray-600 text-white text-sm"
        >
          ⏹
        </button>

        {/* Timecode */}
        <span className="font-mono text-xs text-gray-300 w-28 tabular-nums">
          {timecode}
        </span>

        <div className="w-px h-5 bg-gray-600" />

        {/* Zoom */}
        <span className="text-xs text-gray-500">Zoom</span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={zoom}
          onChange={e => setZoom(parseFloat(e.target.value))}
          className="w-24 accent-indigo-400"
          aria-label="Timeline zoom"
        />
        <span className="text-xs text-gray-500 w-8">{zoom.toFixed(1)}×</span>

        <div className="w-px h-5 bg-gray-600" />

        {/* Add track buttons */}
        <span className="text-xs text-gray-500">Add:</span>
        {(['video', 'audio', 'image'] as const).map(kind => (
          <button
            key={kind}
            onClick={() => addTrack(kind)}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 capitalize"
          >
            + {kind}
          </button>
        ))}

        <div className="flex-1" />

        {/* Selected clip info */}
        {selectedClipId && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <button
              onClick={() => selectedClipId && splitClip(selectedClipId, playheadFrame)}
              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
              title="Split at playhead (S)"
            >
              ✂ Split
            </button>
            <button
              onClick={() => deleteClip(selectedClipId)}
              className="px-2 py-1 rounded bg-gray-700 hover:bg-red-700 text-gray-300"
              title="Delete clip (Del)"
            >
              🗑 Delete
            </button>
          </div>
        )}
      </div>

      {/* ── Body (headers + lanes) ────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Track headers column — scrolls vertically with the lanes */}
        <div
          className="flex-shrink-0 overflow-y-hidden border-r border-gray-700"
          style={{ width: HEADER_WIDTH }}
        >
          {/* Ruler placeholder row */}
          <div
            className="bg-gray-800 border-b border-gray-600"
            style={{ height: 28, width: HEADER_WIDTH }}
          />
          {project.tracks.map(track => (
            <TrackHeader
              key={track.id}
              track={track}
              height={TRACK_HEIGHT}
              isSelected={selectedTrackId === track.id}
              onSelect={setSelectedTrackId}
              onMuteToggle={toggleMute}
              onSoloToggle={toggleSolo}
              onDelete={deleteTrack}
            />
          ))}
        </div>

        {/* Scrollable timeline area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-auto"
          onScroll={handleScroll}
        >
          {/* Inner content — full timeline width */}
          <div style={{ width: Math.max(totalWidth, viewportWidth), position: 'relative' }}>

            {/* Ruler */}
            <Ruler
              fps={fps}
              durationFrames={durationFrames}
              pixelsPerFrame={pixelsPerFrame}
              scrollLeft={scrollLeft}
              viewportWidth={viewportWidth}
              playheadFrame={playheadFrame}
              onSeek={handleSeek}
            />

            {/* Track lanes */}
            <div className="relative" style={{ width: totalWidth }}>
              {project.tracks.map(track => (
                <div
                  key={track.id}
                  className={[
                    'relative border-b border-gray-700',
                    track.muted ? 'opacity-50' : '',
                  ].join(' ')}
                  style={{ height: TRACK_HEIGHT }}
                  onClick={(e) => {
                    // Click on empty lane area — seek to that position
                    if ((e.target as HTMLElement).classList.contains('lane-bg')) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x    = e.clientX - rect.left + scrollLeft;
                      handleSeek(Math.max(0, Math.round(x / pixelsPerFrame)));
                    }
                  }}
                >
                  {/* Lane background for click detection */}
                  <div className="lane-bg absolute inset-0 bg-gray-900 pointer-events-auto" />

                  {/* Grid lines every second */}
                  <div className="absolute inset-0 pointer-events-none">
                    {Array.from({ length: Math.floor(durationFrames / fps) + 1 }, (_, i) => (
                      <div
                        key={i}
                        className="absolute top-0 h-full w-px bg-gray-700/40"
                        style={{ left: i * fps * pixelsPerFrame }}
                      />
                    ))}
                  </div>

                  {/* Clips */}
                  {track.clips.map(clip => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      pixelsPerFrame={pixelsPerFrame}
                      trackHeight={TRACK_HEIGHT}
                      isSelected={selectedClipId === clip.id}
                      isPlaying={
                        isPlaying &&
                        playheadFrame >= clip.range.startFrame &&
                        playheadFrame <= clip.range.endFrame
                      }
                      onSelect={setSelectedClipId}
                      onDragStart={handleClipDragStart}
                    />
                  ))}
                </div>
              ))}

              {/* Playhead — full-height vertical line */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none z-20"
                style={{
                  left: playheadFrame * pixelsPerFrame,
                  boxShadow: '0 0 4px #ef4444',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
