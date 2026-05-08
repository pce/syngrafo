/** Convert a frame number to seconds given a frame rate. */
export const framesToSeconds = (frame: number, fps: number): number => frame / fps;

/** Convert seconds to the nearest frame number given a frame rate. */
export const secondsToFrames = (seconds: number, fps: number): number =>
  Math.round(seconds * fps);

/** Format a frame number as SMPTE-style timecode "HH:MM:SS:FF". */
export function toTimecode(frame: number, fps: number): string {
  const totalSeconds = Math.floor(frame / fps);
  const ff = frame % fps;
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return [hh, mm, ss, ff].map(n => String(n).padStart(2, '0')).join(':');
}

/** Parse a SMPTE timecode string back to a frame number. */
export function fromTimecode(tc: string, fps: number): number {
  const [hh = 0, mm = 0, ss = 0, ff = 0] = tc.split(':').map(Number);
  return ((hh * 3600 + mm * 60 + ss) * fps) + ff;
}
