/**
 * Modular patch types — EMS VCS3 pin-matrix metaphor.
 *
 * Rows of the matrix   = signal sources  (block output ports)
 * Columns of the matrix = signal sinks    (block modulatable params)
 * A pin                 = PatchCable connecting one row×column pair
 *
 * PatchEngine runs a ~50 Hz routing tick:
 *   1. Read Csound output channels → block.outputs
 *   2. For every cable: apply SignalTransform → write to target param channel
 */

// ── Port ─────────────────────────────────────────────────────────────────────

/** Semantic type of signal on a port */
export type PortDataType =
  | 'control'   // normalised float, typically 0..1 (k-rate)
  | 'pitch'     // semitone offset or Hz
  | 'trigger'   // gate / bang (0 or 1)
  | 'audio'     // a-rate — NOT routed via JS channels
  | 'string';   // text / path (not routable)

export interface PortDef {
  id:           string;
  label:        string;
  dataType:     PortDataType;
  min?:         number;
  max?:         number;
  unit?:        string;
  default?:     number | string;
  description?: string;
}

// ── Param ─────────────────────────────────────────────────────────────────────

export type ParamType = 'number' | 'boolean' | 'select' | 'string' | 'file';

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface ParamDef {
  id:           string;
  label:        string;
  type:         ParamType;
  min?:         number;
  max?:         number;
  step?:        number;
  options?:     SelectOption[];
  default:      number | boolean | string;
  /** When true a PatchCable can override this param from another block's output */
  modulatable?: boolean;
  unit?:        string;
  description?: string;
}

// ── Block kind ────────────────────────────────────────────────────────────────

export type BlockKind =
  | 'grainade'        // Granular sampler — the main voice block
  | 'signalFollower'  // Smooth + scale a control signal
  | 'dataTransform'   // Math: add / mul / subtract / min / max / mod
  | 'scaleQuantizer'  // Pitch quantiser to musical / microtonal scale (JS-side)
  | 'samplePlayer'    // Linear sample playback
  | 'grispChips'      // Bit-depth + sample-rate crusher
  | 'eq3'             // 3-band EQ
  | 'delay'           // Feedback delay
  | 'beatDetector'    // Audio amplitude / onset follower
  | 'xyPad';          // XY performance pad (JS-only, no Csound instrument)

// ── Block type definition ─────────────────────────────────────────────────────

export interface BlockTypeDef {
  kind:        BlockKind;
  label:       string;
  description: string;
  /** Accent colour shown in the block card header */
  color:       string;
  /** Named input ports — can be driven by PatchCables */
  inputs:      Record<string, PortDef>;
  /** Named output ports — can be cable sources */
  outputs:     Record<string, PortDef>;
  /** User-controllable params; modulatable ones double as cable targets */
  params:      Record<string, ParamDef>;
  /**
   * Csound orchestra fragment.
   * Replace `{{id}}` with the block instance id at compile time.
   * Empty string = JS-only block (xyPad, scaleQuantizer).
   */
  orcTemplate: string;
}

// ── Block instance ─────────────────────────────────────────────────────────────

export type ParamValue = number | boolean | string;

export interface BlockInstance {
  id:     string;
  kind:   BlockKind;
  label:  string;
  params: Record<string, ParamValue>;
  data?: {
    samplePath?:   string;   // host FS path
    sampleVPath?:  string;   // Csound virtual FS path
    sampleLoaded?: boolean;
  };
  /** Cached output port values — updated by PatchEngine each routing tick */
  outputs?: Record<string, number>;
}

// ── Signal transform ──────────────────────────────────────────────────────────

/**
 * Applied inline on a cable to remap the source signal before it reaches the
 * target param.
 *
 * Example — map GrainadeBlock.out.envelope (0..1) → Delay.feedback (0..0.9):
 *   inMin=0, inMax=1, outMin=0, outMax=0.9, mode='linear', clamp=true
 */
export interface SignalTransform {
  inMin:  number;
  inMax:  number;
  outMin: number;
  outMax: number;
  mode:   'linear' | 'exponential' | 'log';
  clamp:  boolean;
}

export const DEFAULT_TRANSFORM: SignalTransform = {
  inMin: 0, inMax: 1, outMin: 0, outMax: 1, mode: 'linear', clamp: true,
};

/** Apply a SignalTransform to a scalar value */
export function applyTransform(value: number, t: SignalTransform): number {
  const { inMin, inMax, outMin, outMax, mode, clamp } = t;
  const norm   = inMax === inMin ? 0 : (value - inMin) / (inMax - inMin);
  let   curved: number;
  switch (mode) {
    case 'exponential': curved = norm * norm;                   break;
    case 'log':         curved = norm <= 0 ? 0 : Math.sqrt(norm); break;
    default:            curved = norm;                          break;
  }
  let out = outMin + curved * (outMax - outMin);
  if (clamp) {
    const lo = Math.min(outMin, outMax);
    const hi = Math.max(outMin, outMax);
    out = Math.max(lo, Math.min(hi, out));
  }
  return out;
}

// ── Patch cable ────────────────────────────────────────────────────────────────

/** One "pin" in the VCS3 matrix — routes source output → target param */
export interface PatchCable {
  id:             string;
  sourceBlockId:  string;
  sourcePortId:   string;   // output port id on source block
  targetBlockId:  string;
  targetParamId:  string;   // param id on target block receiving the signal
  transform:      SignalTransform;
}

// ── Patch ──────────────────────────────────────────────────────────────────────

export interface Patch {
  id:     string;
  name:   string;
  blocks: BlockInstance[];
  cables: PatchCable[];
  bpm:    number;
}

import { generateName } from '@syngrafo/shared';

export function makeEmptyPatch(name = generateName()): Patch {
  return { id: crypto.randomUUID(), name, blocks: [], cables: [], bpm: 120 };
}

/** Create a BlockInstance with all params set to their type-def defaults */
export function instantiateBlock(
  kind:    BlockKind,
  typeDef: BlockTypeDef,
  label?:  string,
): BlockInstance {
  const params: Record<string, ParamValue> = {};
  for (const [id, def] of Object.entries(typeDef.params)) {
    params[id] = def.default;
  }
  return {
    id:      Math.random().toString(36).slice(2, 10),
    kind,
    label:   label ?? typeDef.label,
    params,
    outputs: {},
  };
}
