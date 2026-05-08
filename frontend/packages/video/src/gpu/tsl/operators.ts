import {
  uv, vec2, vec4, float,
  sin, cos, sqrt, atan, clamp, mod,
  texture as tex3,
} from 'three/tsl';
import type { Texture } from 'three';
import type { ShaderNode } from '../../types/shader.ts';

/**
 * Phase 1: transform UV coordinates without sampling the texture.
 * Returns `uvIn` unchanged for unrecognised shader kinds.
 */
export function applyUVTransform(
  node: ShaderNode,
  uvIn: ReturnType<typeof uv>,
): ReturnType<typeof uv> {
  const p = node.params;

  switch (node.kind) {
    case 'mirror':
    case 'flip': {
      const axis = p.axis ?? 0;
      if (axis === 1) {
        return vec2(uvIn.x, float(1).sub(uvIn.y)) as unknown as ReturnType<typeof uv>;
      }
      if (axis === 2) {
        return vec2(float(1).sub(uvIn.x), float(1).sub(uvIn.y)) as unknown as ReturnType<typeof uv>;
      }
      // axis === 0: horizontal flip
      return vec2(float(1).sub(uvIn.x), uvIn.y) as unknown as ReturnType<typeof uv>;
    }

    case 'scale-in': {
      const targetScale = p.targetScale ?? 1.2;
      return uvIn.sub(0.5).div(float(targetScale)).add(0.5) as unknown as ReturnType<typeof uv>;
    }

    case 'scale-out': {
      const targetScale = p.targetScale ?? 0.85;
      return uvIn.sub(0.5).div(float(targetScale)).add(0.5) as unknown as ReturnType<typeof uv>;
    }

    case 'kaleidoscope': {
      const segments = p.segments ?? 6;
      const centered   = uvIn.sub(0.5);
      const r          = sqrt(centered.dot(centered));
      const angle      = atan(centered.y, centered.x);
      const segAngle   = float(Math.PI * 2 / segments);
      const fold       = mod(angle, segAngle);
      // Mirror within the sector so the pattern tiles cleanly
      const foldMirrored = fold.lessThan(segAngle.mul(0.5))
        .select(fold, segAngle.sub(fold));
      return vec2(cos(foldMirrored), sin(foldMirrored))
        .mul(r)
        .add(0.5) as unknown as ReturnType<typeof uv>;
    }

    case 'blackhole': {
      const strength = p.strength ?? 0.5;
      const centered = uvIn.sub(0.5);
      const r        = sqrt(centered.dot(centered));
      const warpedR  = r.sub(float(strength).mul(r.mul(r)));
      const warped   = uvIn.sub(0.5).normalize().mul(warpedR).add(0.5);
      // Guard against division by zero near the centre
      return r.greaterThan(float(0.001))
        .select(warped, uvIn) as unknown as ReturnType<typeof uv>;
    }

    case 'noise': {
      const amplitude = p.amplitude ?? 0.02;
      const frequency = p.frequency ?? 10;
      const pScaled   = uvIn.mul(float(frequency));
      // Simple hash-based pseudo-noise (sine lattice)
      const nx = sin(pScaled.x.mul(127.1).add(pScaled.y.mul(311.7)));
      const ny = sin(pScaled.x.mul(269.5).add(pScaled.y.mul(183.3)));
      return uvIn.add(
        vec2(nx, ny).mul(float(amplitude)),
      ) as unknown as ReturnType<typeof uv>;
    }

    default:
      return uvIn;
  }
}

/** Precomputed [1,2,1 / 2,4,2 / 1,2,1] / 16 Gaussian kernel weights. */
const GAUSS_WEIGHTS: ReadonlyArray<ReadonlyArray<number>> = [
  [1 / 16, 2 / 16, 1 / 16],
  [2 / 16, 4 / 16, 2 / 16],
  [1 / 16, 2 / 16, 1 / 16],
];

/**
 * Phase 2: transform the already-sampled colour node.
 * Multi-tap effects (blur, dof, tilt-blur) re-sample `srcTex` using `uvFinal`
 * as their base UV.
 * Returns `colorIn` unchanged for unrecognised shader kinds.
 */
export function applyColorTransform(
  node: ShaderNode,
  colorIn: ReturnType<typeof vec4>,
  srcTex: Texture,
  uvFinal: ReturnType<typeof uv>,
): ReturnType<typeof vec4> {
  const p = node.params;

  switch (node.kind) {
    case 'fade': {
      const alpha = p.alpha ?? 1;
      return vec4(
        colorIn.rgb,
        colorIn.a.mul(float(alpha)),
      ) as ReturnType<typeof vec4>;
    }

    case 'cinema': {
      const vignetteStr = p.vignetteStr ?? 1.5;
      const contrast    = p.contrast    ?? 1.2;
      const centered    = uvFinal.sub(0.5);
      const vignette    = clamp(
        float(1).sub(centered.length().mul(float(vignetteStr * 2))),
        float(0),
        float(1),
      );
      const rgb = colorIn.rgb.sub(0.5).mul(float(contrast)).add(0.5);
      return vec4(rgb.mul(vignette), colorIn.a) as ReturnType<typeof vec4>;
    }

    case 'blur':
    case 'dof': {
      const blurStrength = p.blurStrength ?? 0.5;
      // dof uses a slightly larger step so depth-of-field blur is more visible
      const blurStep = node.kind === 'dof'
        ? blurStrength * 0.02
        : blurStrength * 0.015;

      // Unrolled 3×3 Gaussian — JS loop builds the fixed node graph at material-compile time
      let acc = vec4(0, 0, 0, 0) as ReturnType<typeof vec4>;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const ox = (i - 1) * blurStep;
          const oy = (j - 1) * blurStep;
          const w  = GAUSS_WEIGHTS[i][j];
          const s  = tex3(srcTex, uvFinal.add(vec2(ox, oy)));
          acc = acc.add(s.mul(float(w))) as ReturnType<typeof vec4>;
        }
      }
      return acc;
    }

    case 'tilt-blur': {
      const tiltAngle    = p.tiltAngle    ?? 0;
      const blurStrength = p.blurStrength ?? 0.5;
      const step         = blurStrength * 0.012;
      const dir          = vec2(cos(float(tiltAngle)), sin(float(tiltAngle)));

      // 5-tap linear blur along the tilt direction
      let acc = vec4(0, 0, 0, 0) as ReturnType<typeof vec4>;
      for (let i = -2; i <= 2; i++) {
        const s = tex3(srcTex, uvFinal.add(dir.mul(float(step * i))));
        acc = acc.add(s) as ReturnType<typeof vec4>;
      }
      return acc.div(float(5)) as ReturnType<typeof vec4>;
    }

    default:
      return colorIn;
  }
}
