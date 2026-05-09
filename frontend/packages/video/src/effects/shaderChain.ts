import type { ShaderNode, ShaderKind, ShaderParams } from '../types/shader.ts';
import { uid } from '@syngrafo/shared';

function make(kind: ShaderKind, label: string, params: ShaderParams = {}): ShaderNode {
  return {
    id: uid(),
    kind,
    label,
    enabled: true,
    focusPoint: { x: 0.5, y: 0.5 },
    params,
  };
}

export function makeKenBurns(params?: Partial<ShaderParams>): ShaderNode {
  return make('kenburns', 'Ken Burns', {
    fromScale: 1, toScale: 1.15,
    fromOffsetX: 0, fromOffsetY: 0,
    toOffsetX: 0.02, toOffsetY: 0.01,
    ...params,
  });
}

export function makeMirror(axis = 0, params?: Partial<ShaderParams>): ShaderNode {
  return make('mirror', 'Mirror', { axis, ...params });
}

export function makeFlip(axis = 1, params?: Partial<ShaderParams>): ShaderNode {
  return make('flip', 'Flip', { axis, ...params });
}

export function makeScaleIn(targetScale = 1.2, params?: Partial<ShaderParams>): ShaderNode {
  return make('scale-in', 'Scale In', { targetScale, intensity: 1, ...params });
}

export function makeScaleOut(targetScale = 0.8, params?: Partial<ShaderParams>): ShaderNode {
  return make('scale-out', 'Scale Out', { targetScale, intensity: 1, ...params });
}

export function makeKaleidoscope(segments = 6, params?: Partial<ShaderParams>): ShaderNode {
  return make('kaleidoscope', 'Kaleidoscope', { segments, ...params });
}

export function makeBlackhole(params?: Partial<ShaderParams>): ShaderNode {
  return make('blackhole', 'Blackhole', { strength: 0.5, radius: 0.3, ...params });
}

export function makeNoise(params?: Partial<ShaderParams>): ShaderNode {
  return make('noise', 'Noise', { amplitude: 0.05, frequency: 10, ...params });
}

export function makeBlur(params?: Partial<ShaderParams>): ShaderNode {
  return make('blur', 'Blur', { blurStrength: 0.5, ...params });
}

export function makeDof(params?: Partial<ShaderParams>): ShaderNode {
  return make('dof', 'Depth of Field', { focalDistance: 0.5, focalRange: 0.3, blurStrength: 0.5, ...params });
}

export function makeTiltBlur(params?: Partial<ShaderParams>): ShaderNode {
  return make('tilt-blur', 'Tilt Blur', { tiltAngle: 0, tiltWidth: 0.3, tiltSoftness: 0.5, ...params });
}

export function makeCinema(params?: Partial<ShaderParams>): ShaderNode {
  return make('cinema', 'Cinema', { vignetteStr: 0.5, grainAmount: 0.1, chromaShift: 0.02, contrast: 1, saturation: 1, ...params });
}

export function makeBloom(params?: Partial<ShaderParams>): ShaderNode {
  return make('bloom', 'Bloom', {
    threshold:  0.70,
    blurStrength: 0.40,
    intensity:  1.80,
    ...params,
  });
}

export function makeBokehGlow(params?: Partial<ShaderParams>): ShaderNode {
  return make('bokeh-glow', 'Bokeh Glow', {
    threshold: 0.75,
    radius:    0.35,
    intensity: 2.20,
    ...params,
  });
}

export function makeChromaticWarp(params?: Partial<ShaderParams>): ShaderNode {
  return make('chromatic-warp', 'Chromatic Warp', {
    intensity:  0.30,   // chromatic aberration strength
    amplitude:  0.008,  // warp field strength
    frequency:  3.0,    // warp field spatial scale
    ...params,
  });
}

export function makeFlowWarp(params?: Partial<ShaderParams>): ShaderNode {
  return make('flow-warp', 'Flow Warp', {
    intensity:    1.0,
    blurStrength: 0.30,
    ...params,
  });
}

export function makeDuotone(
  shadowHex    = 0x1a1a3e,  // deep violet
  highlightHex = 0xf5c842,  // warm gold
  params?: Partial<ShaderParams>,
): ShaderNode {
  return make('duotone', 'Duotone', {
    shadowColor:    shadowHex,
    highlightColor: highlightHex,
    intensity: 1,
    ...params,
  });
}

export function makeTritone(
  shadowHex    = 0x2d1b4e,   // deep violet
  midtoneHex   = 0xe07b39,   // amber
  highlightHex = 0xfff0c8,   // cream
  params?: Partial<ShaderParams>,
): ShaderNode {
  return make('tritone', 'Tritone', {
    shadowColor:    shadowHex,
    midtoneColor:   midtoneHex,
    highlightColor: highlightHex,
    intensity: 1,
    ...params,
  });
}

export function makeFilmGrain(params?: Partial<ShaderParams>): ShaderNode {
  return make('film-grain', 'Retro Film', {
    vignetteStr: 0.8,
    grainAmount: 0.06,
    warmth:      0.10,
    lift:        0.04,
    saturation:  0.15,  // desaturation amount (0 = no desat, 1 = full desat)
    ...params,
  });
}

export function makeRoundedFrame(params?: Partial<ShaderParams>): ShaderNode {
  return make('rounded-frame', 'Rounded Frame', {
    cornerRadius: 0.08,
    ...params,
  });
}

export function makeFade(alpha = 1, params?: Partial<ShaderParams>): ShaderNode {
  return make('fade', 'Fade', { alpha, ...params });
}

export function defaultChain(): ShaderNode[] {
  return [];
}

export function addNode(chain: ShaderNode[], node: ShaderNode): ShaderNode[] {
  return [...chain, node];
}

export function removeNode(chain: ShaderNode[], index: number): ShaderNode[] {
  if (index < 0 || index >= chain.length) return chain;
  return [...chain.slice(0, index), ...chain.slice(index + 1)];
}

/**
 * Move the node at position `from` to position `to`.
 * Both indices refer to positions in the *original* chain.
 * Returns a new chain; the original is not mutated.
 * If either index is out of bounds, or `from === to`, the original is returned.
 */
export function moveNode(chain: ShaderNode[], from: number, to: number): ShaderNode[] {
  if (
    from === to ||
    from < 0 || from >= chain.length ||
    to   < 0 || to   >= chain.length
  ) {
    return chain;
  }

  const result = [...chain];
  const [node] = result.splice(from, 1);
  if (node === undefined) return chain;
  result.splice(to, 0, node);
  return result;
}

export function chainToJson(chain: ShaderNode[]): string {
  return JSON.stringify(chain);
}

export function jsonToChain(json: string): ShaderNode[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as ShaderNode[];
    return [];
  } catch {
    return [];
  }
}
