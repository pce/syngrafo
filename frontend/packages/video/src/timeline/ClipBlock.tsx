/**
 * ClipBlock.tsx
 * A single clip block rendered within a track lane.
 * Positioned absolutely by frame range; supports drag-to-move and
 * drag-to-resize via edge handles. Emits mouse events up to VideoTimeline.
 */

import React from 'react';
import type { VideoClip, VideoClipKind } from '../types/video.ts';

const KIND_BG: Record<VideoClipKind, string> = {
  image:       'bg-blue-600',
  video:       'bg-violet-600',
  audio:       'bg-green-600',
  solid_color: 'bg-amber-600',
};

const KIND_RING: Record<VideoClipKind, string> = {
  image:       'ring-blue-400',
  video:       'ring-violet-400',
  audio:       'ring-green-400',
  solid_color: 'ring-amber-400',
};

export interface ClipBlockProps {
  clip:            VideoClip;
  pixelsPerFrame:  number;
  trackHeight:     number;
  isSelected:      boolean;
  isPlaying:       boolean;
  /** Called when the user presses the body or resize handles. */
  onDragStart: (
    e: React.MouseEvent,
    clipId: string,
    edge: 'body' | 'start' | 'end',
  ) => void;
  onSelect: (id: string) => void;
}

export const ClipBlock: React.FC<ClipBlockProps> = ({
  clip,
  pixelsPerFrame,
  trackHeight,
  isSelected,
  isPlaying,
  onDragStart,
  onSelect,
}) => {
  const left  = clip.range.startFrame * pixelsPerFrame;
  const width = Math.max(
    20,
    (clip.range.endFrame - clip.range.startFrame + 1) * pixelsPerFrame,
  );

  const bg   = KIND_BG[clip.kind]   ?? 'bg-gray-600';
  const ring = KIND_RING[clip.kind] ?? 'ring-gray-400';

  const handleBodyMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(clip.id);
    onDragStart(e, clip.id, 'body');
  };

  const handleStartMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(clip.id);
    onDragStart(e, clip.id, 'start');
  };

  const handleEndMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(clip.id);
    onDragStart(e, clip.id, 'end');
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`Clip: ${clip.label}`}
      className={[
        'absolute top-1 rounded cursor-move select-none overflow-hidden',
        'border border-white/10',
        bg,
        isSelected ? `ring-2 ${ring} shadow-lg` : 'opacity-90 hover:opacity-100',
        isPlaying   ? 'brightness-110' : '',
      ].join(' ')}
      style={{
        left,
        width,
        height: trackHeight - 8,
      }}
      onMouseDown={handleBodyMouseDown}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(clip.id);
      }}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-white/20 z-10"
        onMouseDown={handleStartMouseDown}
      />

      {/* Clip label */}
      <div className="px-2 py-0.5 h-full flex flex-col justify-between pointer-events-none">
        <span className="text-xs text-white font-medium truncate leading-tight">
          {clip.label}
        </span>

        {/* Effects / keyframe dot indicators */}
        {(clip.effects.length > 0 || clip.keyframes.length > 0) && (
          <div className="flex gap-1 items-center">
            {clip.effects.length > 0 && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-yellow-400"
                title={`${clip.effects.length} effect(s)`}
              />
            )}
            {clip.keyframes.length > 0 && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-orange-400"
                title={`${clip.keyframes.length} keyframe(s)`}
              />
            )}
          </div>
        )}
      </div>

      {/* Opacity overlay — visual cue for reduced-opacity clips */}
      {clip.opacity < 1 && (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: 1 - clip.opacity }}
        />
      )}

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-white/20 z-10"
        onMouseDown={handleEndMouseDown}
      />
    </div>
  );
};
