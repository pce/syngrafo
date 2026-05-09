import {
  uv, vec2, vec4, float, uniform,
  sin, cos, sqrt, atan, clamp, mod, mix, smoothstep,
  texture as tex3,
} from 'three/tsl';
import type { Texture } from 'three';
import type { ShaderNode } from '../../types/shader.ts';

/**
 * Global time uniform in seconds (frame / fps).
 * Updated by SceneCompositor on every renderFrame call.
 * Shader cases that want time-animated effects read this node.
 */
export const globalTimeU = uniform(0.0);

/**
 * Build a TSL color node that performs a plasma-noise stretch morph between
 * `srcTex` and `dstTex`.
 *
 * The node graph is built at material-compile time (this function is called
 * from JS when the mesh material needs rebuilding).  Runtime-variable
 * quantities (morphT, opacity, globalTimeU) are uniforms that get updated
 * every frame without recompilation.
 *
 * Plasma field: three-harmonic sum of sine/cosine waves at different
 * spatial frequencies and phases.  Evolves over time via globalTimeU.
 *
 * Color-distance gate: pixels where src and dst are similar (low contrast)
 * barely move → dark-on-dark regions appear frozen.
 *
 * Motion blur: N samples accumulated along the displacement vector give an
 * in-camera streak feel.
 */
export function buildMorphColorNode(
  srcTex:           Texture,
  dstTex:           Texture,
  uvNode:           ReturnType<typeof uv>,
  morphTU:          ReturnType<typeof uniform>,
  opacityU:         ReturnType<typeof uniform>,
  noiseScale:       number,
  noiseSpeed:       number,
  noiseAmp:         number,
  colorDistGate:    number,
  motionBlurSamples: number,
): ReturnType<typeof vec4> {
  const t         = morphTU;
  const fieldTime = globalTimeU.mul(float(noiseSpeed));
  const uvS       = uvNode.mul(float(noiseScale));

  // ── 3-harmonic plasma field ───────────────────────────────────────────────────────────────────────────
  // Each harmonic uses different (irrational-ratio) spatial and temporal
  // frequencies to prevent tiling/periodicity.
  // X-direction
  const dx =
    sin(uvS.x.mul(3.1).add(uvS.y.mul(1.7)).add(fieldTime))
    .add(sin(uvS.x.mul(1.9).add(uvS.y.mul(2.3)).add(fieldTime.mul(0.71))))
    .add(sin(uvS.x.mul(0.7).add(uvS.y.mul(3.7)).add(fieldTime.mul(1.37))))
    .mul(float(1 / 3));

  // Y-direction (cosine harmonics with different coefficients)
  const dy =
    cos(uvS.x.mul(2.3).add(uvS.y.mul(1.1)).add(fieldTime.mul(0.83)))
    .add(cos(uvS.x.mul(3.7).add(uvS.y.mul(0.9)).add(fieldTime.mul(0.53))))
    .add(cos(uvS.x.mul(1.3).add(uvS.y.mul(2.9)).add(fieldTime.mul(1.13))))
    .mul(float(1 / 3));

  // ── Color-distance gate ──────────────────────────────────────────────────────────────────────────
  // Sample both textures at the neutral (un-displaced) UV to compute
  // how different src and dst are at each pixel.
  const srcBase = tex3(srcTex, uvNode);
  const dstBase = tex3(dstTex, uvNode);

  const cdR      = srcBase.r.sub(dstBase.r);
  const cdG      = srcBase.g.sub(dstBase.g);
  const cdB      = srcBase.b.sub(dstBase.b);
  // Euclidean color distance ∈ [0, √3 ≈ 1.73]
  const colorDist = sqrt(cdR.mul(cdR).add(cdG.mul(cdG)).add(cdB.mul(cdB)));

  // Gate: sqrt(dist) gives perceptually-linear response (default gate=0.5)
  // dark-to-dark → dist≈0 → dispMod≈0 → pixel stands still
  // colorDistGate is baked as a JS constant into the node graph
  const gateExp = Math.max(0.1, Math.min(2.0, colorDistGate));
  // Approximate pow(colorDist, gateExp) without .pow():
  //   gate=0.5 → sqrt(colorDist)
  //   gate=1.0 → colorDist
  //   gate=2.0 → colorDist * colorDist
  let dispMod: ReturnType<typeof float>;
  if (Math.abs(gateExp - 0.5) < 0.01) {
    dispMod = sqrt(colorDist).mul(float(noiseAmp));
  } else if (Math.abs(gateExp - 1.0) < 0.01) {
    dispMod = colorDist.mul(float(noiseAmp));
  } else if (Math.abs(gateExp - 2.0) < 0.01) {
    dispMod = colorDist.mul(colorDist).mul(float(noiseAmp));
  } else {
    // General case: use exp(gate * log(dist)) = dist^gate
    // In TSL we approximate using the identity: x^a ≈ exp(a*ln(x))
    // For simplicity, clamp gate to nearest supported value
    dispMod = sqrt(colorDist).mul(float(noiseAmp));
  }

  // Plasma displacement vector, scaled by color-distance gate
  const disp = vec2(dx, dy).mul(dispMod);

  // ── Motion blur accumulation ───────────────────────────────────────────────────────────────────────
  // Accumulate SAMPLES texture-pairs along the displacement path.
  // src warps outward (t → 1 means src UV shifts further out)
  // dst warps inward (t → 0 means dst UV starts from further in)
  const SAMPLES = Math.max(1, Math.min(7, Math.round(motionBlurSamples)));

  let acc = vec4(0, 0, 0, 0) as ReturnType<typeof vec4>;

  for (let s = 0; s < SAMPLES; s++) {
    // alpha: 0..1 spread across the sample range
    const alpha = SAMPLES > 1 ? s / (SAMPLES - 1) : 0.5;
    // A small parallax offset along the blur path (JS constant → TSL float)
    const blurOffset = (alpha - 0.5) * 0.12;

    const uvSrc = uvNode.add(disp.mul(t).mul(float(1 + blurOffset)));
    const uvDst = uvNode.sub(disp.mul(float(1).sub(t)).mul(float(1 - blurOffset)));

    const sc      = tex3(srcTex, uvSrc);
    const dc      = tex3(dstTex, uvDst);
    const blended = mix(sc, dc, t);
    acc = acc.add(blended) as ReturnType<typeof vec4>;
  }

  const finalColor = acc.div(float(SAMPLES));
  return vec4(finalColor.r, finalColor.g, finalColor.b, finalColor.a.mul(opacityU)) as ReturnType<typeof vec4>;
}

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

    case 'duotone': {
      const sc = p.shadowColor    ?? 0x1a1a3e;
      const hc = p.highlightColor ?? 0xf5c842;

      // Unpack at graph-build time (constants in the TSL node graph)
      const sr = float(((sc >>> 16) & 0xFF) / 255);
      const sg = float(((sc >>>  8) & 0xFF) / 255);
      const sb = float(( sc         & 0xFF) / 255);
      const hr = float(((hc >>> 16) & 0xFF) / 255);
      const hg = float(((hc >>>  8) & 0xFF) / 255);
      const hb = float(( hc         & 0xFF) / 255);

      // Rec. 709 luminance
      const lum = colorIn.r.mul(0.2126).add(colorIn.g.mul(0.7152)).add(colorIn.b.mul(0.0722));

      const r = sr.add(hr.sub(sr).mul(lum));
      const g = sg.add(hg.sub(sg).mul(lum));
      const b = sb.add(hb.sub(sb).mul(lum));

      return vec4(r, g, b, colorIn.a) as ReturnType<typeof vec4>;
    }

    case 'tritone': {
      const sc = p.shadowColor    ?? 0x2d1b4e;
      const mc = p.midtoneColor   ?? 0xe07b39;
      const hc = p.highlightColor ?? 0xfff0c8;

      const unpack = (c: number) => [
        float(((c >>> 16) & 0xFF) / 255),
        float(((c >>>  8) & 0xFF) / 255),
        float(( c         & 0xFF) / 255),
      ] as const;

      const [sr, sg, sb] = unpack(sc);
      const [mr, mg, mb] = unpack(mc);
      const [hr, hg, hb] = unpack(hc);

      const lum = colorIn.r.mul(0.2126).add(colorIn.g.mul(0.7152)).add(colorIn.b.mul(0.0722));

      // Lower half: shadow → midtone (lum in [0, 0.5] → t1 in [0, 1])
      const t1 = lum.mul(2).clamp(0, 1);
      // Upper half: midtone → highlight (lum in [0.5, 1] → t2 in [0, 1])
      const t2 = lum.sub(0.5).mul(2).clamp(0, 1);

      const lo_r = sr.add(mr.sub(sr).mul(t1));
      const lo_g = sg.add(mg.sub(sg).mul(t1));
      const lo_b = sb.add(mb.sub(sb).mul(t1));

      const hi_r = mr.add(hr.sub(mr).mul(t2));
      const hi_g = mg.add(hg.sub(mg).mul(t2));
      const hi_b = mb.add(hb.sub(mb).mul(t2));

      // For lum ≥ 0.5 use hi; otherwise use lo
      const inUpper = lum.greaterThanEqual(0.5);
      const r = inUpper.select(hi_r, lo_r);
      const g = inUpper.select(hi_g, lo_g);
      const b = inUpper.select(hi_b, lo_b);

      return vec4(r, g, b, colorIn.a) as ReturnType<typeof vec4>;
    }

    case 'film-grain': {
      const vigStr   = p.vignetteStr ?? 0.8;
      const grain    = p.grainAmount ?? 0.06;
      const warmth   = p.warmth      ?? 0.10;
      const lift     = p.lift        ?? 0.04;
      const desatAmt = p.saturation  ?? 0.15;  // this is actually desaturation amount

      // 1. Desaturate slightly
      const lum  = colorIn.r.mul(0.2126).add(colorIn.g.mul(0.7152)).add(colorIn.b.mul(0.0722));
      const dR   = colorIn.r.mul(float(1 - desatAmt)).add(lum.mul(float(desatAmt)));
      const dG   = colorIn.g.mul(float(1 - desatAmt)).add(lum.mul(float(desatAmt)));
      const dB   = colorIn.b.mul(float(1 - desatAmt)).add(lum.mul(float(desatAmt)));

      // 2. Warm tint: add to R, subtract from B
      const wR = dR.add(float(warmth * 0.08));
      const wG = dG;
      const wB = dB.sub(float(warmth * 0.05));

      // 3. Procedural grain (sine-lattice hash)
      const seed   = uvFinal.x.mul(127.1).add(uvFinal.y.mul(311.7));
      const noise  = sin(seed.mul(43758.5453)).fract().sub(0.5).mul(float(grain));

      // 4. Vignette
      const centered = uvFinal.sub(0.5);
      const vig = clamp(float(1).sub(centered.length().mul(float(vigStr * 2))), float(0), float(1));

      // 5. Shadow lift (raise black point)
      const liftF = float(lift);
      const fR = clamp(wR.add(noise).mul(vig).add(liftF), float(0), float(1));
      const fG = clamp(wG.add(noise).mul(vig).add(liftF), float(0), float(1));
      const fB = clamp(wB.add(noise).mul(vig).add(liftF), float(0), float(1));

      return vec4(fR, fG, fB, colorIn.a) as ReturnType<typeof vec4>;
    }

    case 'bloom': {
      const threshold = p.threshold    ?? 0.70;
      const blurStep  = (p.blurStrength ?? 0.40) * 0.016;
      const intensity = p.intensity    ?? 1.80;

      // Gaussian-weighted 5×5 bright-pass gather
      // Weights precomputed at graph-build time (JS constants → TSL float nodes)
      let brightAcc = vec4(0, 0, 0, 0) as ReturnType<typeof vec4>;
      let wTotal = 0;

      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const gw = Math.exp(-(i * i + j * j) * 0.4);   // Gaussian weight
          const sUV = uvFinal.add(vec2(i * blurStep, j * blurStep));
          const s   = tex3(srcTex, sUV);

          // Rec. 709 luminance
          const lum  = s.r.mul(0.2126).add(s.g.mul(0.7152)).add(s.b.mul(0.0722));
          const above = lum.greaterThan(float(threshold));

          // Accumulate weighted bright contribution component-wise
          const wr = above.select(s.r.mul(float(gw)), float(0));
          const wg = above.select(s.g.mul(float(gw)), float(0));
          const wb = above.select(s.b.mul(float(gw)), float(0));
          brightAcc = brightAcc.add(vec4(wr, wg, wb, float(0))) as ReturnType<typeof vec4>;
          wTotal += gw;
        }
      }

      const bloom = brightAcc.div(float(wTotal)).mul(float(intensity));
      // Additive blend: original + bloom (allow HDR — clamping happens at display)
      return vec4(
        colorIn.r.add(bloom.r),
        colorIn.g.add(bloom.g),
        colorIn.b.add(bloom.b),
        colorIn.a,
      ) as ReturnType<typeof vec4>;
    }

    case 'bokeh-glow': {
      const threshold  = p.threshold ?? 0.75;
      const radius     = (p.radius ?? 0.35) * 0.045;  // UV space radius
      const intensity  = p.intensity ?? 2.20;

      let acc = vec4(0, 0, 0, 0) as ReturnType<typeof vec4>;

      // 7×7 scan with Gaussian falloff (circle shape via exponential decay)
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const ox = i * (radius / 3);
          const oy = j * (radius / 3);
          const d2 = ox * ox + oy * oy;
          // Bokeh disc falloff: soft circle (not square)
          const falloff = Math.exp(-d2 / (radius * radius * 0.5));

          const sUV = uvFinal.add(vec2(ox, oy));
          const s   = tex3(srcTex, sUV);
          const lum = s.r.mul(0.2126).add(s.g.mul(0.7152)).add(s.b.mul(0.0722));
          const above = lum.greaterThan(float(threshold));

          const fr = above.select(s.r.mul(float(falloff)), float(0));
          const fg = above.select(s.g.mul(float(falloff)), float(0));
          const fb = above.select(s.b.mul(float(falloff)), float(0));
          acc = acc.add(vec4(fr, fg, fb, float(0))) as ReturnType<typeof vec4>;
        }
      }

      const glow = acc.mul(float(intensity * 0.08));
      return vec4(
        colorIn.r.add(glow.r),
        colorIn.g.add(glow.g),
        colorIn.b.add(glow.b),
        colorIn.a,
      ) as ReturnType<typeof vec4>;
    }

    case 'chromatic-warp': {
      const aberration = p.intensity  ?? 0.30;   // lens CA strength
      const warpAmt    = p.amplitude  ?? 0.008;  // warp field magnitude
      const warpScale  = p.frequency  ?? 3.0;    // warp field spatial frequency

      // Smooth, slowly evolving sine warp field (time-animated via globalTimeU)
      const t  = globalTimeU;
      const px = uvFinal.mul(float(warpScale));

      const warpX = sin(px.x.mul(2.7).add(px.y.mul(1.3)).add(t.mul(0.8)));
      const warpY = cos(px.x.mul(1.7).add(px.y.mul(3.1)).add(t.mul(0.5)));
      const warp  = vec2(warpX, warpY).mul(float(warpAmt));

      // Lens chromatic aberration: R/G/B channels shift radially from center
      const center   = uvFinal.sub(0.5);
      const lensDist = center.length().mul(float(aberration * 0.025));
      // Guard against zero-length at the exact center
      const lensDir  = center.length().greaterThan(float(0.0001))
        .select(center.normalize(), vec2(float(0), float(0)));

      const uvWarped = uvFinal.add(warp);
      const uvR = uvWarped.add(lensDir.mul(lensDist));           // Red: outward
      const uvG = uvWarped;                                       // Green: center
      const uvB = uvWarped.sub(lensDir.mul(lensDist));           // Blue: inward

      const r = tex3(srcTex, uvR).r;
      const g = tex3(srcTex, uvG).g;
      const b = tex3(srcTex, uvB).b;

      return vec4(r, g, b, colorIn.a) as ReturnType<typeof vec4>;
    }

    case 'flow-warp': {
      const warpStrength = p.intensity    ?? 1.0;
      const step         = (p.blurStrength ?? 0.30) * 0.0028;  // ~1-3 px in UV

      // 3×3 Sobel filter to compute the image gradient at this fragment
      const tl = tex3(srcTex, uvFinal.add(vec2(-step, -step)));
      const tm = tex3(srcTex, uvFinal.add(vec2(    0, -step)));
      const tr = tex3(srcTex, uvFinal.add(vec2( step, -step)));
      const ml = tex3(srcTex, uvFinal.add(vec2(-step,     0)));
      const mr = tex3(srcTex, uvFinal.add(vec2( step,     0)));
      const bl = tex3(srcTex, uvFinal.add(vec2(-step,  step)));
      const bm = tex3(srcTex, uvFinal.add(vec2(    0,  step)));
      const br = tex3(srcTex, uvFinal.add(vec2( step,  step)));

      // Luminance helper (inline — no actual JS function call during TSL node building)
      const lumTL = tl.r.mul(0.2126).add(tl.g.mul(0.7152)).add(tl.b.mul(0.0722));
      const lumTM = tm.r.mul(0.2126).add(tm.g.mul(0.7152)).add(tm.b.mul(0.0722));
      const lumTR = tr.r.mul(0.2126).add(tr.g.mul(0.7152)).add(tr.b.mul(0.0722));
      const lumML = ml.r.mul(0.2126).add(ml.g.mul(0.7152)).add(ml.b.mul(0.0722));
      const lumMR = mr.r.mul(0.2126).add(mr.g.mul(0.7152)).add(mr.b.mul(0.0722));
      const lumBL = bl.r.mul(0.2126).add(bl.g.mul(0.7152)).add(bl.b.mul(0.0722));
      const lumBM = bm.r.mul(0.2126).add(bm.g.mul(0.7152)).add(bm.b.mul(0.0722));
      const lumBR = br.r.mul(0.2126).add(br.g.mul(0.7152)).add(br.b.mul(0.0722));

      // Sobel X: right column − left column (weighted center row ×2)
      const gx = lumTR.add(lumMR.mul(2)).add(lumBR)
                  .sub(lumTL).sub(lumML.mul(2)).sub(lumBL);

      // Sobel Y: bottom row − top row (weighted center column ×2)
      const gy = lumBL.add(lumBM.mul(2)).add(lumBR)
                  .sub(lumTL).sub(lumTM.mul(2)).sub(lumTR);

      // Flow direction = perpendicular to gradient (tangent to edges)
      // rotate gradient 90°: (gx, gy) → (-gy, gx)
      const flowDir = vec2(gy.negate(), gx);

      const warpedUV = uvFinal.add(flowDir.mul(float(step * warpStrength * 4)));
      return tex3(srcTex, warpedUV) as ReturnType<typeof vec4>;
    }

    case 'rounded-frame': {
      const r  = p.cornerRadius ?? 0.08;
      const hr = 0.5 - r;

      // Centered position relative to canvas (UV in [0,1] → position in [-0.5, 0.5])
      const px = uvFinal.x.sub(0.5);
      const py = uvFinal.y.sub(0.5);

      // Rounded-rect SDF: q = abs(p) - (halfSize - cornerRadius)
      const qx = px.abs().sub(float(hr));
      const qy = py.abs().sub(float(hr));

      // length(max(q, 0)) + min(max(q.x, q.y), 0) - r
      const qxPos  = qx.max(float(0));
      const qyPos  = qy.max(float(0));
      const lenQ   = sqrt(qxPos.mul(qxPos).add(qyPos.mul(qyPos)));
      const inner  = qx.max(qy).min(float(0));
      const dist   = lenQ.add(inner).sub(float(r));

      // Anti-aliased edge: negative dist = inside frame
      // ~150 corresponds to ~6-7 px soft edge at 1080p
      const alpha = clamp(dist.negate().mul(float(150)), float(0), float(1));

      return vec4(colorIn.rgb, colorIn.a.mul(alpha)) as ReturnType<typeof vec4>;
    }

    default:
      return colorIn;
  }
}
