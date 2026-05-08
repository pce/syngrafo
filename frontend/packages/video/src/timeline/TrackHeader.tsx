import React from 'react';
import type { VideoTrackLane } from '../types/video.ts';
import { Icon } from '@syngrafo/ui';
import type { IconName } from '@syngrafo/ui';

export interface TrackHeaderProps {
  track:        VideoTrackLane;
  height:       number;
  isSelected:   boolean;
  onSelect:     (id: string) => void;
  onMuteToggle: (id: string) => void;
  onSoloToggle: (id: string) => void;
  onDelete:     (id: string) => void;
}

const KIND_ICON_NAME: Record<string, IconName> = {
  video:  'film',
  audio:  'music',
  effect: 'sparkles',
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
        'flex items-center gap-1 px-2 border-b border-[var(--theme-border)] cursor-pointer select-none',
        'transition-colors',
        isSelected ? 'bg-[var(--theme-border)]' : 'bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]',
      ].join(' ')}
      style={{ width: 180, height, flexShrink: 0 }}
      onClick={() => onSelect(track.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(track.id); }}
    >
      <Icon
        name={KIND_ICON_NAME[track.kind] ?? 'ellipsis'}
        size={14}
        aria-hidden
      />

      <span
        className="flex-1 min-w-0 text-xs text-[var(--theme-text)] font-medium truncate"
        title={track.label}
      >
        {track.label}
      </span>

      <button
        aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.label}`}
        onClick={(e) => { e.stopPropagation(); onMuteToggle(track.id); }}
        className={[
          'text-[10px] px-1.5 py-0.5 rounded font-bold leading-none',
          track.muted
            ? 'bg-yellow-600 text-yellow-100'
            : 'bg-[var(--theme-surface)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]',
        ].join(' ')}
      >
        M
      </button>

      <button
        aria-label={`${track.solo ? 'Unsolo' : 'Solo'} ${track.label}`}
        onClick={(e) => { e.stopPropagation(); onSoloToggle(track.id); }}
        className={[
          'text-[10px] px-1.5 py-0.5 rounded font-bold leading-none',
          track.solo
            ? 'bg-green-600 text-green-100'
            : 'bg-[var(--theme-surface)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]',
        ].join(' ')}
      >
        S
      </button>

      <button
        aria-label={`Delete ${track.label}`}
        onClick={(e) => { e.stopPropagation(); onDelete(track.id); }}
        className="flex items-center justify-center p-0.5 rounded
                   text-[var(--theme-text-muted)] hover:text-[var(--theme-danger)] hover:bg-[var(--theme-bg)]"
        title="Delete track"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
};
