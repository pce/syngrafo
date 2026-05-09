/**
 * Look preset types and registry.
 *
 * A "look" is a named, pre-built ShaderNode chain that can be applied to every
 * clip imported via the SequenceImportDialog. Each preset's `makeNodes()` method
 * returns a fresh array so callers can give each clip its own independent chain.
 */

import type { ShaderNode } from './shader.ts';
import { uid } from '@syngrafo/shared';

// ── Preset IDs ───────────────────────────────────────────────────────────────

export type LookPresetId =
  | 'none'
  | 'cinematic'
  | 'retro-film'
  | 'duotone-warm'
  | 'duotone-cool'
  | 'duotone-bw'
  | 'tritone-sunset'
  | 'tritone-ocean'
  | 'rounded';

// ── Preset interface ─────────────────────────────────────────────────────────

export interface LookPreset {
  id: LookPresetId;
  name: string;
  description: string;
  /** Emoji or short glyph shown in the look picker UI. */
  badge: string;
  /** Returns a fresh ShaderNode[] with new UIDs — each clip gets its own chain. */
  makeNodes: () => ShaderNode[];
}

// ── Node factory helper ───────────────────────────────────────────────────────

function node(
  kind: ShaderNode['kind'],
  label: string,
  params: ShaderNode['params'] = {},
): ShaderNode {
  return {
    id:         uid(),
    kind,
    label,
    enabled:    true,
    focusPoint: { x: 0.5, y: 0.5 },
    params,
  };
}

// ── Preset registry ───────────────────────────────────────────────────────────

export const LOOK_PRESETS: readonly LookPreset[] = [
  {
    id:          'none',
    name:        'None',
    description: 'No look applied — passthrough.',
    badge:       '○',
    makeNodes:   () => [],
  },
  {
    id:          'cinematic',
    name:        'Cinematic',
    description: 'Film-grade contrast with subtle vignette and grain.',
    badge:       '🎬',
    makeNodes:   () => [
      node('cinema', 'Cinematic', {
        vignetteStr: 0.40,
        grainAmount: 0.03,
        chromaShift: 0.0015,
        contrast:    1.22,
        saturation:  0.88,
      }),
    ],
  },
  {
    id:          'retro-film',
    name:        'Retro Film',
    description: 'Warm grain, lifted blacks, and aged film vignette.',
    badge:       '📽',
    makeNodes:   () => [
      node('film-grain', 'Retro Film', {
        vignetteStr: 0.85,
        grainAmount: 0.07,
        warmth:      0.12,
        lift:        0.05,
        saturation:  0.18,
      }),
    ],
  },
  {
    id:          'duotone-warm',
    name:        'Warm Duo',
    description: 'Deep violet shadows, warm golden highlights.',
    badge:       '🟡',
    makeNodes:   () => [
      node('duotone', 'Warm Duotone', {
        shadowColor:    0x1a1a3e,  // deep violet
        highlightColor: 0xf5c842,  // warm gold
        intensity:      1,
      }),
    ],
  },
  {
    id:          'duotone-cool',
    name:        'Cool Duo',
    description: 'Dark navy shadows, electric teal highlights.',
    badge:       '🔵',
    makeNodes:   () => [
      node('duotone', 'Cool Duotone', {
        shadowColor:    0x0a0e1a,  // dark navy
        highlightColor: 0x00d4aa,  // electric teal
        intensity:      1,
      }),
    ],
  },
  {
    id:          'duotone-bw',
    name:        'B&W',
    description: 'Pure black-and-white — high-contrast monochrome.',
    badge:       '◑',
    makeNodes:   () => [
      node('duotone', 'Black & White', {
        shadowColor:    0x111111,
        highlightColor: 0xfafafa,
        intensity:      1,
      }),
    ],
  },
  {
    id:          'tritone-sunset',
    name:        'Sunset',
    description: 'Violet shadows → amber midtones → cream highlights.',
    badge:       '🌅',
    makeNodes:   () => [
      node('tritone', 'Sunset', {
        shadowColor:    0x2d1b4e,  // deep violet
        midtoneColor:   0xe07b39,  // amber
        highlightColor: 0xfff0c8,  // cream
        intensity:      1,
      }),
    ],
  },
  {
    id:          'tritone-ocean',
    name:        'Ocean',
    description: 'Dark blue shadows → teal midtones → pale aqua highlights.',
    badge:       '🌊',
    makeNodes:   () => [
      node('tritone', 'Ocean', {
        shadowColor:    0x050d24,  // deep ocean blue
        midtoneColor:   0x0e7c8c,  // teal
        highlightColor: 0xb8f0ef,  // pale aqua
        intensity:      1,
      }),
    ],
  },
  {
    id:          'rounded',
    name:        'Rounded',
    description: 'Soft SDF rounded-corner frame mask.',
    badge:       '▢',
    makeNodes:   () => [
      node('rounded-frame', 'Rounded Frame', {
        cornerRadius: 0.08,
      }),
    ],
  },
] as const;

// ── Lookup helper ─────────────────────────────────────────────────────────────

export function getLookPreset(id: LookPresetId): LookPreset {
  return LOOK_PRESETS.find(p => p.id === id) ?? (LOOK_PRESETS[0] as LookPreset);
}
