import type { ClipLayout } from '../types/video.ts';

/**
 * UV scale and offset that letterbox/pillarbox a source into the canvas.
 *
 * In the vertex shader, apply as:
 *   uv_fitted = (uv - 0.5) * vec2(scaleU, scaleV) + 0.5 + vec2(offsetU, offsetV)
 */
export interface FitRect {
  /** UV scale: values > 1 mean the source is cropped. */
  scaleU:  number;
  scaleV:  number;
  /** UV offset applied after scaling (for cover + pivot). */
  offsetU: number;
  offsetV: number;
}

/**
 * Compute the UV transform needed to fit a source with `srcAspect` (w/h)
 * into a canvas with `canvasAspect` according to `layout`.
 *
 * - `contain` — letterbox/pillarbox; the entire source is visible, bars added.
 * - `cover`   — fill the frame + crop; the source fills every pixel, edges trimmed.
 * - `fill`    — stretch to fill; aspect ratio is not preserved.
 */
export function computeFitRect(
  srcAspect:    number,
  canvasAspect: number,
  layout:       ClipLayout,
): FitRect {
  // ratio > 1 → source is wider than the canvas
  const ratio = srcAspect / canvasAspect;

  let scaleU = 1;
  let scaleV = 1;

  switch (layout.fit) {
    case 'contain':
      // Letterbox / pillarbox: scale down the dimension that overflows.
      if (ratio > 1) scaleV = ratio;      // source wider → pillarbox top/bottom
      else           scaleU = 1 / ratio;  // source taller → letterbox left/right
      break;

    case 'cover':
      // Fill + crop: scale up the dimension that falls short, then crop overflow.
      if (ratio > 1) scaleU = 1 / ratio;  // source wider → crop left/right
      else           scaleV = ratio;       // source taller → crop top/bottom
      break;

    case 'fill':
      // Stretch to fill — no UV correction needed.
      break;
  }

  // Pivot: for `cover`, shift the crop window so `pivotX/Y` stays centred.
  // scaleU/V < 1 means the texture is over-sampled; offset slides the window.
  const offsetU = layout.fit === 'cover' ? (1 - scaleU) * (layout.pivotX - 0.5) : 0;
  const offsetV = layout.fit === 'cover' ? (1 - scaleV) * (layout.pivotY - 0.5) : 0;

  return { scaleU, scaleV, offsetU, offsetV };
}

// ─── Mesh transform ───────────────────────────────────────────────────────────

/** World-space 2-D transform for a clip mesh on a W×H canvas. */
export interface MeshTransform {
  x:           number;  // pixels from canvas center (right = positive)
  y:           number;  // pixels from canvas center (up = positive in Three.js)
  scaleX:      number;
  scaleY:      number;
  rotationRad: number;
}

/**
 * Convert the clip's artistic transform properties (posX, posY, scale, rotation)
 * into the world-space values needed by Three.js (or any NDC-based renderer).
 *
 * `posX`/`posY` are canvas-pixel offsets from the centre; the returned `y` is
 * negated because screen-space Y increases downward while Three.js Y increases
 * upward.
 */
export function computeMeshTransform(
  canvasW: number,
  canvasH: number,
  posX:    number,   // pixels from canvas center, positive = right
  posY:    number,   // pixels from canvas center, positive = down (screen space)
  scale:   number,   // uniform scale factor; 1.0 = full canvas size
  rotDeg:  number,   // clockwise degrees
): MeshTransform {
  return {
    x:           posX,
    y:           -posY,                      // flip Y: screen-down → world-up
    scaleX:      (canvasW / 2) * scale,
    scaleY:      (canvasH / 2) * scale,
    rotationRad: (rotDeg * Math.PI) / 180,
  };
}
