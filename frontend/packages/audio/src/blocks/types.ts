import type { uid as _uid } from '@syngrafo/shared';

export type BlockVariation = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const VARIATIONS: BlockVariation[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export interface AudioBlock {
  id: string;
  trackId: string;
  variation: BlockVariation;
  /** Position in bars (0-based) */
  position: number;
  /** Length in bars */
  length: number;
  /** CSD orchestra fragment for this block (no header, no score) */
  orcFragment: string;
  /** Score events for this block */
  scoreEvents: string;
  /** Named control channel overrides for this block */
  channels: Record<string, number>;
  color?: string;
}

export interface AudioTrack {
  id: string;
  name: string;
  muted: boolean;
  solo: boolean;
  volume: number;  // 0.0–1.0
  blocks: AudioBlock[];
  /** Currently active variation */
  currentVariation: BlockVariation;
}

export const BLOCK_COLORS: Record<BlockVariation, string> = {
  A: '#3b82f6',  // blue
  B: '#22c55e',  // green
  C: '#f97316',  // orange
  D: '#a855f7',  // purple
  E: '#ec4899',  // pink
  F: '#14b8a6',  // teal
};
