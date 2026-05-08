import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { AudioTrack, AudioBlock as AudioBlockType } from './types.ts';
import { VARIATIONS, BLOCK_COLORS } from './types.ts';
import { AudioBlock } from './AudioBlock.tsx';
import { uid, audioBus } from '@syngrafo/shared';
import { useCsound } from '../csound/useCsound.ts';

interface BlockArrangerProps {
  tracks:          AudioTrack[];
  totalBars?:      number;
  bpm?:            number;
  onTracksChange?: (tracks: AudioTrack[]) => void;
}

export const BlockArranger: React.FC<BlockArrangerProps> = ({
  tracks: initialTracks,
  totalBars = 64,
  bpm = 120,
  onTracksChange,
}) => {
  const [tracks,      setTracks]      = useState<AudioTrack[]>(initialTracks);
  const [currentBar,  setCurrentBar]  = useState(0);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [blockLength, setBlockLength] = useState(8);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const csound = useCsound();

  // Propagate track changes upward
  useEffect(() => { onTracksChange?.(tracks); }, [tracks, onTracksChange]);

  // Playback tick — advances current bar at the right BPM
  const startTick = useCallback(() => {
    const beatsPerBar = 4;
    const secPerBeat  = 60 / bpm;
    const secPerBar   = secPerBeat * beatsPerBar;
    tickRef.current = setInterval(() => {
      setCurrentBar(b => (b + 1) % totalBars);
    }, secPerBar * 1000);
  }, [bpm, totalBars]);

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  // Cleanup interval on unmount
  useEffect(() => () => stopTick(), [stopTick]);

  // On bar change: find blocks at this position and trigger them via Csound
  useEffect(() => {
    if (!isPlaying || !csound.isReady) return;
    tracks.forEach(track => {
      if (track.muted) return;
      const block = track.blocks.find(b =>
        currentBar >= b.position && currentBar < b.position + b.length
      );
      if (!block) return;

      // Notify bus
      audioBus.emit('csdPlay', { blockId: block.id, csdText: block.orcFragment });

      // Send live score event to running Csound
      if (block.scoreEvents.trim()) {
        csound.readScore(block.scoreEvents).catch(console.warn);
      }

      // Set any channel overrides
      Object.entries(block.channels).forEach(([k, v]) => csound.setChannel(k, v));
    });
  }, [currentBar, isPlaying]);  // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = async () => {
    if (isPlaying) {
      stopTick();
      await csound.stop();
      setIsPlaying(false);
      setCurrentBar(0);
    } else {
      if (!csound.isReady) return;
      // Build a master orc from all track blocks' orcFragments
      const allOrcs = tracks
        .flatMap(t => t.blocks)
        .map(b => b.orcFragment)
        .filter(Boolean)
        .join('\n');
      if (allOrcs.trim()) {
        await csound.compileOrc(allOrcs);
      }
      startTick();
      setIsPlaying(true);
    }
  };

  const addBlock = (trackId: string, barPosition: number) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const snapped = barPosition - (barPosition % blockLength);
      // Cycle variation if block already there
      const existing = t.blocks.find(
        b => snapped >= b.position && snapped < b.position + b.length
      );
      if (existing) {
        const vi = VARIATIONS.indexOf(existing.variation);
        const nextVar = VARIATIONS[(vi + 1) % VARIATIONS.length] ?? 'A';
        return {
          ...t,
          blocks: t.blocks.map(b =>
            b.id === existing.id ? { ...b, variation: nextVar } : b
          ),
        };
      }
      const newBlock: AudioBlockType = {
        id: uid(), trackId,
        variation: 'A',
        position: snapped,
        length: blockLength,
        orcFragment: '', scoreEvents: '', channels: {},
      };
      return { ...t, blocks: [...t.blocks, newBlock] };
    }));
  };

  const removeBlock = (blockId: string) => {
    setTracks(prev =>
      prev.map(t => ({ ...t, blocks: t.blocks.filter(b => b.id !== blockId) }))
    );
    if (selectedId === blockId) setSelectedId(null);
  };

  const cycleVariation = (blockId: string) => {
    setTracks(prev => prev.map(t => ({
      ...t,
      blocks: t.blocks.map(b => {
        if (b.id !== blockId) return b;
        const vi = VARIATIONS.indexOf(b.variation);
        return { ...b, variation: VARIATIONS[(vi + 1) % VARIATIONS.length] ?? 'A' };
      }),
    })));
  };

  const playheadPercent = `${(currentBar / totalBars) * 100}%`;

  return (
    <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 border-b border-gray-700">
        <button
          onClick={togglePlay}
          disabled={!csound.isReady && !isPlaying}
          className="px-4 py-1.5 rounded text-sm font-medium text-white disabled:opacity-40
            bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-colors"
        >
          {isPlaying ? '⏹ Stop' : '▶ Play'}
        </button>
        <span className="text-gray-400 text-xs font-mono">
          Bar {currentBar + 1} / {totalBars}
        </span>
        <span className="text-gray-500 text-xs">{bpm} BPM</span>
        <div className="ml-auto flex items-center gap-2 text-gray-400 text-xs">
          <label htmlFor="block-length-select">Block</label>
          <select
            id="block-length-select"
            value={blockLength}
            onChange={e => setBlockLength(Number(e.target.value))}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-white text-xs"
          >
            {[2, 4, 8, 16, 32].map(n => (
              <option key={n} value={n}>{n} bars</option>
            ))}
          </select>
        </div>
        {/* Engine state badge */}
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          csound.state === 'ready'   ? 'bg-green-900  text-green-300'  :
          csound.state === 'playing' ? 'bg-blue-900   text-blue-300'   :
          csound.state === 'loading' ? 'bg-yellow-900 text-yellow-300' :
          csound.state === 'error'   ? 'bg-red-900    text-red-300'    :
          'bg-gray-700 text-gray-400'
        }`}>
          {csound.state}
        </span>
      </div>

      {/* Ruler + Playhead */}
      <div className="relative h-5 bg-gray-800 border-b border-gray-700 overflow-hidden">
        {Array.from({ length: Math.floor(totalBars / 4) + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute top-0 h-full text-[10px] text-gray-500 pl-0.5 select-none"
            style={{ left: `${(i * 4 / totalBars) * 100}%` }}
          >
            {i * 4}
          </div>
        ))}
        <div
          className="absolute top-0 h-full w-px bg-red-500 pointer-events-none z-10"
          style={{ left: playheadPercent, boxShadow: '0 0 4px #ef4444' }}
        />
      </div>

      {/* Track rows */}
      <div className="flex flex-col overflow-y-auto max-h-96">
        {tracks.map(track => (
          <div key={track.id} className="border-b border-gray-700 last:border-0">
            {/* Track header */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/60 border-b border-gray-700/50">
              <span className="text-sm text-gray-300 font-medium min-w-[80px] truncate">
                {track.name}
              </span>
              <button
                aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
                onClick={() =>
                  setTracks(p =>
                    p.map(t => t.id === track.id ? { ...t, muted: !t.muted } : t)
                  )
                }
                className={`text-xs px-2 py-0.5 rounded ${
                  track.muted
                    ? 'bg-yellow-700 text-yellow-200'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                M
              </button>
              <button
                aria-label={`${track.solo ? 'Unsolo' : 'Solo'} ${track.name}`}
                onClick={() =>
                  setTracks(p =>
                    p.map(t => t.id === track.id ? { ...t, solo: !t.solo } : t)
                  )
                }
                className={`text-xs px-2 py-0.5 rounded ${
                  track.solo
                    ? 'bg-green-700 text-green-200'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                S
              </button>
            </div>
            {/* Block row — click to add/cycle blocks */}
            <div
              className="relative h-10 cursor-pointer select-none"
              onClick={e => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const fraction = (e.clientX - rect.left) / rect.width;
                const bar = Math.floor(fraction * totalBars);
                addBlock(track.id, bar);
              }}
            >
              {/* Grid lines */}
              <div className="absolute inset-0 flex pointer-events-none">
                {Array.from({ length: Math.floor(totalBars / blockLength) }, (_, i) => (
                  <div key={i} className="flex-1 border-r border-gray-700/50" />
                ))}
              </div>
              {/* Blocks */}
              {track.blocks.map(block => (
                <AudioBlock
                  key={block.id}
                  block={block}
                  totalBars={totalBars}
                  isSelected={selectedId === block.id}
                  isPlaying={
                    isPlaying &&
                    currentBar >= block.position &&
                    currentBar < block.position + block.length
                  }
                  onSelect={setSelectedId}
                  onRemove={removeBlock}
                  onVariationCycle={cycleVariation}
                />
              ))}
              {/* Playhead overlay */}
              <div
                className="absolute top-0 h-full w-px bg-red-500/50 pointer-events-none z-10"
                style={{ left: playheadPercent }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Variation legend */}
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-800/60 border-t border-gray-700">
        {VARIATIONS.map(v => (
          <div key={v} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: BLOCK_COLORS[v] }}
            />
            <span className="text-xs text-gray-400">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
