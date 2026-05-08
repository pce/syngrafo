/**
 * Ruler.tsx
 * Timecode ruler for the video timeline.
 * Renders tick marks and SMPTE timecode labels using absolute pixel positions
 * that mirror the clip blocks below it (pixelsPerFrame × frame).
 */

import React, { useCallback } from 'react';
import { toTimecode } from '@syngrafo/shared';

export interface RulerProps {
  fps: number;
  durationFrames: number;
  pixelsPerFrame: number;
  /** Current horizontal scroll offset of the containing timeline div. */
  scrollLeft: number;
  viewportWidth: number;
  playheadFrame: number;
  onSeek: (frame: number) => void;
}

export const Ruler: React.FC<RulerProps> = ({
  fps,
  durationFrames,
  pixelsPerFrame,
  scrollLeft,
  viewportWidth,
  playheadFrame,
  onSeek,
}) => {
  const totalWidth = durationFrames * pixelsPerFrame;

  // Determine which frames are visible so we skip off-screen ticks
  const firstVisibleFrame = Math.max(0, Math.floor(scrollLeft / pixelsPerFrame) - fps);
  const lastVisibleFrame  = Math.min(
    durationFrames,
    Math.ceil((scrollLeft + viewportWidth) / pixelsPerFrame) + fps,
  );

  // Choose a major-tick interval: every second (fps frames), or every N seconds
  // for very zoomed-out views so labels don't overlap
  const targetMajorPixels = 80;  // desired pixel gap between major ticks
  const framesPerMajor    = Math.max(fps, Math.ceil(targetMajorPixels / pixelsPerFrame / fps) * fps);
  const framesPerMinor    = Math.max(1, Math.floor(framesPerMajor / 5));

  // Collect ticks in the visible range
  const ticks: Array<{ frame: number; major: boolean }> = [];
  const start = Math.floor(firstVisibleFrame / framesPerMinor) * framesPerMinor;
  for (let f = start; f <= lastVisibleFrame; f += framesPerMinor) {
    if (f < 0) continue;
    ticks.push({ frame: f, major: f % framesPerMajor === 0 });
  }

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect  = e.currentTarget.getBoundingClientRect();
      const x     = e.clientX - rect.left + scrollLeft;
      const frame = Math.max(0, Math.min(durationFrames - 1, Math.round(x / pixelsPerFrame)));
      onSeek(frame);
    },
    [scrollLeft, durationFrames, pixelsPerFrame, onSeek],
  );

  const playheadX = playheadFrame * pixelsPerFrame - scrollLeft;

  return (
    <div
      className="relative select-none cursor-pointer bg-[var(--theme-surface)] border-b border-[var(--theme-border)] overflow-hidden"
      style={{ height: 28, width: viewportWidth }}
      onClick={handleClick}
      title="Click to seek"
    >
      {/* Inner div carries the full timeline width so ticks stay in place */}
      <div className="absolute top-0 left-0" style={{ width: totalWidth, height: 28 }}>
        {ticks.map(({ frame, major }) => {
          const x = frame * pixelsPerFrame - scrollLeft;
          if (x < -10 || x > viewportWidth + 10) return null;
          return (
            <React.Fragment key={frame}>
              {/* Tick line */}
              <div
                className={major ? 'absolute bg-[var(--theme-text-muted)]' : 'absolute bg-[var(--theme-border)]'}
                style={{
                  left:   x,
                  top:    major ? 0 : 14,
                  width:  1,
                  height: major ? 28 : 14,
                }}
              />
              {/* Timecode label — only for major ticks */}
              {major && (
                <div
                  className="absolute text-[10px] text-[var(--theme-text-muted)] pl-1 whitespace-nowrap pointer-events-none"
                  style={{ left: x, top: 2 }}
                >
                  {toTimecode(frame, fps)}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Playhead needle */}
      {playheadX >= 0 && playheadX <= viewportWidth && (
        <div
          className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none z-10"
          style={{ left: playheadX, boxShadow: '0 0 3px #ef4444' }}
        />
      )}
    </div>
  );
};
