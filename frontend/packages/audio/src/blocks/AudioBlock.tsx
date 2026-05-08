import React from 'react';
import type { AudioBlock as AudioBlockType, BlockVariation } from './types.ts';
import { BLOCK_COLORS } from './types.ts';

interface AudioBlockProps {
  block: AudioBlockType;
  totalBars: number;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onVariationCycle: (id: string) => void;
}

export const AudioBlock: React.FC<AudioBlockProps> = ({
  block, totalBars, isSelected, isPlaying,
  onSelect, onRemove, onVariationCycle,
}) => {
  const left  = `${(block.position / totalBars) * 100}%`;
  const width = `${(block.length   / totalBars) * 100}%`;
  const color = block.color ?? BLOCK_COLORS[block.variation];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Block ${block.variation} at bar ${block.position}`}
      className={[
        'absolute top-1 rounded cursor-pointer select-none transition-all duration-100 border',
        'flex items-center justify-between px-2',
        isSelected ? 'ring-2 ring-white shadow-lg scale-y-105' : 'opacity-90 hover:opacity-100',
        isPlaying  ? 'animate-pulse' : '',
      ].join(' ')}
      style={{
        left, width,
        height: 'calc(100% - 0.5rem)',
        backgroundColor: color,
        borderColor: `color-mix(in srgb, ${color} 70%, black)`,
      }}
      onClick={() => onSelect(block.id)}
      onDoubleClick={() => onVariationCycle(block.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(block.id);
        if (e.key === 'Delete' || e.key === 'Backspace') onRemove(block.id);
      }}
    >
      <span className="text-xs font-bold text-white drop-shadow">{block.variation}</span>
      {isSelected && (
        <button
          aria-label="Remove block"
          className="w-4 h-4 rounded-full bg-white/20 hover:bg-red-500 flex items-center justify-center text-white text-xs leading-none"
          onClick={e => { e.stopPropagation(); onRemove(block.id); }}
        >
          &times;
        </button>
      )}
    </div>
  );
};
