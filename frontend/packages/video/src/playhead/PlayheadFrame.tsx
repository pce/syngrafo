import React, { useState, useRef, useCallback } from 'react';
import { toTimecode } from '@syngrafo/shared';
import { FrameActions } from './FrameActions.tsx';

interface PlayheadFrameProps {
  frame: number;
  fps: number;
  totalFrames: number;
  selectedClipId: string | null;
  onFrameChange: (frame: number) => void;
  onOperatorAdd: (kind: string, frame: number, clipId: string | null) => void;
}

export const PlayheadFrame: React.FC<PlayheadFrameProps> = ({
  frame, fps, totalFrames, selectedClipId,
  onFrameChange, onOperatorAdd,
}) => {
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [scrubbing,   setScrubbing]   = useState(false);
  const scrubStartX   = useRef<number>(0);
  const scrubStartFrame = useRef<number>(0);
  const containerRef  = useRef<HTMLDivElement>(null);

  const timecode = toTimecode(frame, fps);

  // Scrub on drag — feels physical
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setScrubbing(true);
    scrubStartX.current     = e.clientX;
    scrubStartFrame.current = frame;
    e.preventDefault();
  }, [frame]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!scrubbing) return;
    const delta = e.clientX - scrubStartX.current;
    const framesPerPx = 0.5;  // sensitivity
    const newFrame = Math.max(0, Math.min(totalFrames - 1,
      Math.round(scrubStartFrame.current + delta * framesPerPx)));
    onFrameChange(newFrame);
  }, [scrubbing, totalFrames, onFrameChange]);

  const onMouseUp = useCallback(() => setScrubbing(false), []);

  React.useEffect(() => {
    if (scrubbing) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup',   onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, [scrubbing, onMouseMove, onMouseUp]);

  return (
    <div ref={containerRef} className="relative flex items-center gap-3 select-none">
      {/* Frame counter — drag to scrub */}
      <div
        className={[
          'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors cursor-ew-resize',
          scrubbing
            ? 'bg-indigo-900 border-indigo-500'
            : 'bg-gray-800 border-gray-600 hover:border-indigo-500',
        ].join(' ')}
        onMouseDown={onMouseDown}
        title="Drag to scrub"
      >
        {/* Film frame icon */}
        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="3" y="1" width="2" height="3" rx="0.5"/>
          <rect x="11" y="1" width="2" height="3" rx="0.5"/>
          <rect x="3" y="12" width="2" height="3" rx="0.5"/>
          <rect x="11" y="12" width="2" height="3" rx="0.5"/>
          <rect x="7" y="1" width="2" height="3" rx="0.5"/>
          <rect x="7" y="12" width="2" height="3" rx="0.5"/>
        </svg>

        <span className="font-mono text-white text-sm tracking-widest">{timecode}</span>

        <span className="font-mono text-gray-500 text-xs">
          F{frame}
        </span>
      </div>

      {/* Direct frame input */}
      <input
        type="number"
        min={0}
        max={totalFrames - 1}
        value={frame}
        onChange={e => onFrameChange(Number(e.target.value))}
        className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1.5
          text-white text-xs font-mono text-center
          focus:outline-none focus:border-indigo-400"
      />

      {/* Action trigger — the non-linear core */}
      <button
        onClick={() => setMenuOpen(v => !v)}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all',
          menuOpen
            ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/40'
            : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-indigo-400 hover:text-white',
        ].join(' ')}
        title="Place an event at this frame"
      >
        <span className="text-base leading-none">+</span>
        <span>Action</span>
        {menuOpen && <span className="ml-1 text-xs opacity-70">at F{frame}</span>}
      </button>

      {/* The action menu */}
      {menuOpen && (
        <FrameActions
          frame={frame}
          fps={fps}
          clipId={selectedClipId}
          onAdd={(kind) => {
            onOperatorAdd(kind, frame, selectedClipId);
            setMenuOpen(false);
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
};
