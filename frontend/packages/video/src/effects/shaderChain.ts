/**
 * shaderChain.ts
 * Pure helper functions for building and manipulating ShaderChain pipelines.
 *
 * All helpers are intentionally immutable — they return new arrays and never
 * mutate their inputs. This makes them safe to use in React reducers or Zustand
 * stores without additional cloning.
 */

import type { ShaderChain, ShaderNode } from '../types/video.ts';

/** Create a Gaussian blur node. `radius` is in pixels. */
export function makeBlur(radius: number): ShaderNode {
  return { type: 'blur', radius };
}

/**
 * Create a brightness/contrast/saturation node.
 *
 * Conventions (matching common GPU shader conventions):
 *  - brightness: additive offset, 0 = unchanged
 *  - contrast:   multiplicative factor, 0 = unchanged (grey), 1 = full
 *  - saturation: 1 = original, 0 = greyscale, >1 = hyper-saturated
 */
export function makeBrightnessContrast(
  brightness = 0,
  contrast = 0,
  saturation = 1,
): ShaderNode {
  return { type: 'brightness_contrast', brightness, contrast, saturation };
}

/**
 * Create an opacity node.
 * `value` is clamped to [0, 1]: 0 = fully transparent, 1 = fully opaque.
 */
export function makeOpacity(value: number): ShaderNode {
  return { type: 'opacity', value: Math.max(0, Math.min(1, value)) };
}

/**
 * Create a chroma-key (green/blue-screen) node.
 *
 * @param colorHex  Hex colour to key out (e.g. '#00ff00').
 * @param threshold Distance in colour-space below which a pixel is keyed. Default 0.3.
 * @param softness  Feather range above the threshold for smooth edges. Default 0.05.
 */
export function makeChromaKey(
  colorHex: string,
  threshold = 0.3,
  softness = 0.05,
): ShaderNode {
  return { type: 'chroma_key', colorHex, threshold, softness };
}

/** Create a rotation node. `angleDeg` is clockwise degrees. */
export function makeRotate(angleDeg: number): ShaderNode {
  return { type: 'rotate', angleDeg };
}

/** Returns a new, empty shader chain (no operations applied). */
export function defaultChain(): ShaderChain {
  return [];
}

/**
 * Append `node` to the end of `chain`. Returns a new chain.
 * The original chain is not mutated.
 */
export function addNode(chain: ShaderChain, node: ShaderNode): ShaderChain {
  return [...chain, node];
}

/**
 * Remove the node at `index` from `chain`. Returns a new chain.
 * If `index` is out of bounds the original chain is returned unchanged.
 */
export function removeNode(chain: ShaderChain, index: number): ShaderChain {
  if (index < 0 || index >= chain.length) return chain;
  return [...chain.slice(0, index), ...chain.slice(index + 1)];
}

/**
 * Move the node at position `from` to position `to`.
 * Both indices refer to positions in the *original* chain.
 * Returns a new chain; the original is not mutated.
 * If either index is out of bounds, or `from === to`, the original is returned.
 */
export function moveNode(chain: ShaderChain, from: number, to: number): ShaderChain {
  if (
    from === to ||
    from < 0 || from >= chain.length ||
    to   < 0 || to   >= chain.length
  ) {
    return chain;
  }

  const result = [...chain];
  const spliced = result.splice(from, 1);
  const node = spliced[0];
  // splice(from, 1) always removes exactly one element because we've already
  // checked 0 <= from < chain.length above, so node is never undefined.
  if (node === undefined) return chain;
  result.splice(to, 0, node);
  return result;
}

/**
 * Serialize a ShaderChain to a compact JSON string.
 * Suitable for storing in `ShaderChainUpdateEvent.chainJson` or persisting
 * inside a `VideoClip.meta` record.
 */
export function chainToJson(chain: ShaderChain): string {
  return JSON.stringify(chain);
}

/**
 * Deserialize a ShaderChain from a JSON string produced by `chainToJson`.
 * Falls back to an empty chain if parsing fails or the result is not an array,
 * so callers never need to guard against thrown exceptions.
 */
export function jsonToChain(json: string): ShaderChain {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as ShaderChain;
    return [];
  } catch {
    return [];
  }
}
