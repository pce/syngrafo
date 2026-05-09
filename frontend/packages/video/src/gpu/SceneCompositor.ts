import * as THREE from 'three';
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu';
import { texture, uniform, uv, vec2, vec4, float } from 'three/tsl';
import { simulateSpring, SPRING_PRESETS } from '@syngrafo/shared';
import type { SpringConfig } from '@syngrafo/shared';
import type { VideoProject, VideoClip } from '../types/video.ts';
import type { KenBurnsOp, FadeInOp, FadeOutOp, StretchMorphOp } from '../types/effect.ts';
import { applyUVTransform, applyColorTransform, globalTimeU, buildMorphColorNode } from './tsl/operators.ts';
import type { ShaderNode } from '../types/shader.ts';

interface ClipMesh {
  mesh:      THREE.Mesh<THREE.PlaneGeometry, MeshBasicNodeMaterial>;
  opacityU:  ReturnType<typeof uniform>;
  scaleU:    ReturnType<typeof uniform>;
  offsetU:   ReturnType<typeof uniform>;
  texUrl:    string | null;
  chainKey:  string;
  morphTU:   ReturnType<typeof uniform>;   // 0→1 morph progress uniform
  dstTex:    THREE.Texture | null;         // morph destination texture
  dstTexUrl: string | null;                // tracks which dst is loaded
}

export class SceneCompositor {
  private canvas:           HTMLCanvasElement;
  private renderer:         WebGPURenderer | null         = null;
  private scene:            THREE.Scene | null            = null;
  private camera:           THREE.OrthographicCamera | null = null;
  private pool:             Map<string, ClipMesh>         = new Map();
  private texCache:         Map<string, THREE.Texture>    = new Map();
  private texLoader         = new THREE.TextureLoader();
  private springCurveCache: Map<string, number[]>         = new Map();
  private w = 1920;
  private h = 1080;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false });
    await renderer.init();
    renderer.setSize(this.canvas.clientWidth || this.w, this.canvas.clientHeight || this.h, false);

    const camera = new THREE.OrthographicCamera(
      -this.w / 2,  this.w / 2,
       this.h / 2, -this.h / 2,
      0.01, 100,
    );
    camera.position.z = 10;

    this.renderer = renderer;
    this.scene    = new THREE.Scene();
    this.camera   = camera;
  }

  async renderFrame(project: VideoProject, frame: number): Promise<void> {
    const { renderer, scene, camera } = this;
    if (!renderer || !scene || !camera) return;

    // Capture frame in a const so async closures always reference the correct value.
    const currentFrame = frame;

    // Advance the global time uniform so time-animated shaders evolve frame by frame
    (globalTimeU as unknown as { value: number }).value = currentFrame / Math.max(1, project.fps);

    const { width, height } = project.resolution;
    if (width !== this.w || height !== this.h) this.resize(width, height);

    // set scene background from project settings.
    scene.background = new THREE.Color(
      project.settings?.backgroundColor ?? 0x141414,
    );

    for (const cm of this.pool.values()) cm.mesh.visible = false;

    // prune pool entries for clips no longer present in the project.
    const allClipIds = new Set(
      project.tracks.flatMap(t => t.clips.map(c => c.id)),
    );
    for (const [clipId, cm] of this.pool) {
      if (!allClipIds.has(clipId)) {
        cm.mesh.geometry.dispose();
        (cm.mesh.material as MeshBasicNodeMaterial).dispose();
        this.scene!.remove(cm.mesh);
        this.pool.delete(clipId);
      }
    }

    const activeClips: VideoClip[] = [];
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (frame >= clip.range.startFrame && frame <= clip.range.endFrame) {
          activeClips.push(clip);
        }
      }
    }
    activeClips.sort((a, b) => a.layer - b.layer);

    for (const clip of activeClips) {
      const cm = this.getOrCreateMesh(clip);
      cm.mesh.visible     = true;
      cm.mesh.renderOrder = clip.layer;

      const chainKey = JSON.stringify(clip.shaderChain);
      if (cm.chainKey !== chainKey && cm.texUrl !== null) {
        const cached = this.texCache.get(cm.texUrl);
        if (cached) this.rebuildColorNode(cm, clip, cached);
      }

      // ── Stretch-Morph operator ─────────────────────────────────────────
      const morphOp = clip.operators.find(
        (op): op is StretchMorphOp => op.kind === 'stretch-morph',
      );

      if (morphOp) {
        const clipRelFrame  = currentFrame - clip.range.startFrame;
        const morphStart    = morphOp.startFrame;
        const morphEnd      = morphOp.startFrame + morphOp.durationFrames - 1;
        const inMorphWindow = clipRelFrame >= morphStart && clipRelFrame <= morphEnd;

        if (inMorphWindow) {
          const rawT = morphOp.durationFrames > 1
            ? (clipRelFrame - morphStart) / (morphOp.durationFrames - 1)
            : 0;
          (cm.morphTU as unknown as { value: number }).value = Math.max(0, Math.min(1, rawT));

          const targetUrl = morphOp.targetUrl
            ?? (morphOp.targetPath ? `file://${morphOp.targetPath}` : null);

          if (targetUrl) {
            if (cm.dstTexUrl !== targetUrl) {
              cm.dstTexUrl = targetUrl;
              const cachedDst = this.texCache.get(targetUrl);
              if (cachedDst) {
                cm.dstTex = cachedDst;
              } else {
                this.texLoader.loadAsync(targetUrl).then(dst => {
                  this.texCache.set(targetUrl, dst);
                  cm.dstTex = dst;
                  const srcTex = cm.texUrl ? this.texCache.get(cm.texUrl) : null;
                  if (srcTex) {
                    this.rebuildColorNode(cm, clip, srcTex, undefined, dst, morphOp);
                    renderer.render(scene, camera);
                  }
                }).catch(() => { /* no dst — degrade gracefully */ });
              }
            }

            // If dst texture is loaded, ensure color node is the morph node.
            if (cm.dstTex) {
              const expectedKey = `morph:${morphOp.id}:${cm.dstTex.uuid}`;
              const srcTex = cm.texUrl ? this.texCache.get(cm.texUrl) : null;
              if (cm.chainKey !== expectedKey && srcTex) {
                this.rebuildColorNode(cm, clip, srcTex, undefined, cm.dstTex, morphOp);
              }
            }
          }
        } else {
          // Outside morph window — reset progress and clear morph node if active.
          (cm.morphTU as unknown as { value: number }).value = 0;
          if (cm.dstTex && cm.chainKey.startsWith('morph:')) {
            const srcTex = cm.texUrl ? this.texCache.get(cm.texUrl) : null;
            if (srcTex) this.rebuildColorNode(cm, clip, srcTex);
          }
        }
      }

      // solid_color clips have no URL; paint them with a flat colour node.
      if (clip.source.kind === 'solid_color' || (!clip.source.url && clip.source.color)) {
        const hex = clip.source.color ?? '#000000';
        const cr = parseInt(hex.slice(1, 3), 16) / 255;
        const cg = parseInt(hex.slice(3, 5), 16) / 255;
        const cb = parseInt(hex.slice(5, 7), 16) / 255;
        cm.mesh.material.colorNode = vec4(float(cr), float(cg), float(cb), cm.opacityU) as never;
        cm.mesh.material.needsUpdate = true;
        this.applyFrameUniforms(cm, clip, currentFrame);
        continue;
      }

      if (clip.source.url && cm.texUrl !== clip.source.url) {
        const url    = clip.source.url;
        cm.texUrl    = url;
        const cached = this.texCache.get(url);
        if (cached) {
          this.rebuildColorNode(cm, clip, cached);
        } else {
          this.texLoader.loadAsync(url).then((tex) => {
            this.texCache.set(url, tex);
            this.rebuildColorNode(cm, clip, tex);
            // apply per-frame uniforms after the async load so the
            // clip shows at the correct opacity/scale instead of staying gray.
            this.applyFrameUniforms(cm, clip, currentFrame);
            renderer.render(scene, camera);
          }).catch(() => { /* leave placeholder */ });
        }
      }

      this.applyFrameUniforms(cm, clip, currentFrame);
    }

    renderer.render(scene, camera);
  }

  private getOrCreateMesh(clip: VideoClip): ClipMesh {
    const existing = this.pool.get(clip.id);
    if (existing) return existing;

    const opacityU = uniform(1.0);
    const scaleU   = uniform(1.0);
    const offsetU  = uniform(new THREE.Vector2(0, 0));

    const geometry = new THREE.PlaneGeometry(this.w, this.h);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    material.colorNode = vec4(float(0.08), float(0.08), float(0.08), opacityU) as never;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = clip.layer;
    this.scene!.add(mesh);

    const morphTU = uniform(0.0);
    const cm: ClipMesh = {
      mesh, opacityU, scaleU, offsetU,
      texUrl: null, chainKey: '',
      morphTU, dstTex: null, dstTexUrl: null,
    };
    this.pool.set(clip.id, cm);
    return cm;
  }

  private rebuildColorNode(
    cm:       ClipMesh,
    clip:     VideoClip,
    tex:      THREE.Texture,
    chain?:   ShaderNode[],
    dstTex?:  THREE.Texture,
    morphOp?: StretchMorphOp,
  ): void {
    // If a destination texture + morph operator are provided, use the plasma
    // morph shader instead of the normal shader chain.
    if (dstTex && morphOp) {
      cm.mesh.material.colorNode = buildMorphColorNode(
        tex, dstTex,
        uv(),
        cm.morphTU,
        cm.opacityU,
        morphOp.noiseScale,
        morphOp.noiseSpeed,
        morphOp.noiseAmp,
        morphOp.colorDistGate,
        morphOp.motionBlurSamples,
      ) as never;
      cm.mesh.material.needsUpdate = true;
      cm.chainKey = `morph:${morphOp.id}:${dstTex.uuid}`;
      return;
    }

    const effectiveChain = chain ?? clip.shaderChain;

    let uvNode = uv().sub(0.5).div(cm.scaleU).add(cm.offsetU).add(0.5) as ReturnType<typeof uv>;

    for (const node of effectiveChain) {
      if (!node.enabled) continue;
      uvNode = applyUVTransform(node, uvNode);
    }

    tex.colorSpace = THREE.SRGBColorSpace;
    let colorNode = texture(tex, uvNode) as ReturnType<typeof vec4>;

    for (const node of effectiveChain) {
      if (!node.enabled) continue;
      colorNode = applyColorTransform(node, colorNode, tex, uvNode);
    }

    colorNode = vec4(colorNode.rgb, colorNode.a.mul(cm.opacityU)) as ReturnType<typeof vec4>;
    cm.mesh.material.colorNode = colorNode as never;
    cm.mesh.material.needsUpdate = true;
    cm.chainKey = JSON.stringify(effectiveChain);
  }

  private applyFrameUniforms(cm: ClipMesh, clip: VideoClip, frame: number): void {
    const clipRelFrame = frame - clip.range.startFrame;
    const clipDur      = clip.range.endFrame - clip.range.startFrame + 1;
    const t            = Math.max(0, Math.min(1, clipRelFrame / clipDur));

    let alpha = clip.opacity;

    for (const op of clip.operators) {
      switch (op.kind) {
        case 'fadeIn': {
          const fade = op as FadeInOp;
          if (clipRelFrame < fade.durationFrames)
            alpha *= clipRelFrame / fade.durationFrames;
          break;
        }
        case 'fadeOut': {
          const fade = op as FadeOutOp;
          if (clipRelFrame >= clipDur - fade.durationFrames)
            alpha *= (clipDur - clipRelFrame) / fade.durationFrames;
          break;
        }
        case 'kenburns': {
          const kb       = op as KenBurnsOp;
          const cacheKey = `${clip.id}:${kb.id}`;

          let curve = this.springCurveCache.get(cacheKey);
          if (!curve) {
            const cfg: SpringConfig = kb.springConfig ?? SPRING_PRESETS.gentle;
            curve = Array.from(simulateSpring(0, 1, cfg, 60, 5));
            this.springCurveCache.set(cacheKey, curve);
          }

          const idx     = Math.min(Math.floor(t * curve.length), curve.length - 1);
          const springT = curve[idx] ?? t;
          const scale   = kb.fromScale + (kb.toScale  - kb.fromScale)  * springT;
          const ox      = kb.fromOffset[0] + (kb.toOffset[0] - kb.fromOffset[0]) * springT;
          const oy      = kb.fromOffset[1] + (kb.toOffset[1] - kb.fromOffset[1]) * springT;

          (cm.scaleU  as unknown as { value: number }).value = scale;
          (cm.offsetU.value as THREE.Vector2).set(ox, oy);
          break;
        }
        default: break;
      }
    }

    (cm.opacityU as unknown as { value: number }).value = Math.max(0, Math.min(1, alpha));
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.renderer?.setSize(w, h, false);

    if (this.camera) {
      this.camera.left   = -w / 2;
      this.camera.right  =  w / 2;
      this.camera.top    =  h / 2;
      this.camera.bottom = -h / 2;
      this.camera.updateProjectionMatrix();
    }

    for (const cm of this.pool.values()) {
      cm.mesh.geometry.dispose();
      cm.mesh.geometry = new THREE.PlaneGeometry(w, h);
    }
  }

  dispose(): void {
    for (const cm of this.pool.values()) {
      cm.mesh.geometry.dispose();
      cm.mesh.material.dispose();
      this.scene?.remove(cm.mesh);
    }
    this.pool.clear();
    for (const tex of this.texCache.values()) tex.dispose();
    this.texCache.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene    = null;
    this.camera   = null;
  }
}
