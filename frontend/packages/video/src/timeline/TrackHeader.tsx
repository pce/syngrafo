/**
 * TrackHeader.tsx
 * Left-side header panel for a single track lane in the video timeline.
 * Shows track name, mute/solo buttons, and delete. Fixed 180px wide.
 */

import React from 'react';
import type { VideoTrackLane } from '../types/video.ts';

export interface TrackHeaderProps {
  track:          VideoTrackLane;
  height:         number;
  isSelected:     boolean;
  onSelect:       (id: string) => void;
  onMuteToggle:   (id: string) => void;
  onSoloToggle:   (id: string) => void;
  onDelete:       (id: string) => void;
}

/** Kind to icon/emoji */
const KIND_ICON: Record<string, string> = {
  video:  '🎬',
  audio:  '🔊',
  effect: '✨',
};

export const TrackHeader: React.FC<TrackHeaderProps> = ({
  track,
  height,
  isSelected,
  onSelect,
  onMuteToggle,
  onSoloToggle,
  onDelete,
}) => {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      className={[
        'flex items-center gap-1 px-2 border-b border-gray-700 cursor-pointer select-none',
        'transition-colors',
        isSelected ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-750',
      ].join(' ')}
      style={{ width: 180, height, flexShrink: 0 }}
      onClick={() => onSelect(track.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(track.id); }}
    >
      {/* Kind icon */}
      <span className="text-sm leading-none" aria-hidden="true">
        {KIND_ICON[track.kind] ?? '▪'}
      </span>

      {/* Label */}
      <span
        className="flex-1 min-w-0 text-xs text-gray-200 font-medium truncate"
        title={track.label}
      >
        {track.label}
      </span>

      {/* Mute */}
      <button
        aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.label}`}
        onClick={(e) => { e.stopPropagation(); onMuteToggle(track.id); }}
        className={[
          'text-[10px] px-1.5 py-0.5 rounded font-bold leading-none',
          track.muted
            ? 'bg-yellow-600 text-yellow-100'
            : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
        ].join(' ')}
      >
        M
      </button>

      {/* Solo */}
      <button
        aria-label={`${track.solo ? 'Unsolo' : 'Solo'} ${track.label}`}
        onClick={(e) => { e.stopPropagation(); onSoloToggle(track.id); }}
        className={[
          'text-[10px] px-1.5 py-0.5 rounded font-bold leading-none',
          track.solo
            ? 'bg-green-600 text-green-100'
            : 'bg-gray-700 text-gray-400 hover:bg-gray-600',
        ].join(' ')}
      >
        S
      </button>

      {/* Delete */}
      <button
        aria-label={`Delete ${track.label}`}
        onClick={(e) => { e.stopPropagation(); onDelete(track.id); }}
        className="text-[10px] px-1 py-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 leading-none"
        title="Delete track"
      >
        ✕
      </button>
    </div>
  );
};
