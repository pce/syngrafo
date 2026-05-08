import * as THREE from 'three';
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu';
import { texture, uniform, uv, vec2, vec4, float } from 'three/tsl';
import { simulateSpring, SPRING_PRESETS } from '@syngrafo/shared';
import type { SpringConfig } from '@syngrafo/shared';
import type { VideoProject, VideoClip } from '../types/video.ts';
import type { KenBurnsOp, FadeInOp, FadeOutOp } from '../types/effect.ts';
import { applyUVTransform, applyColorTransform } from './tsl/operators.ts';

interface ClipMesh {
  mesh:     THREE.Mesh<THREE.PlaneGeometry, MeshBasicNodeMaterial>;
  opacityU: ReturnType<typeof uniform>;
  scaleU:   ReturnType<typeof uniform>;
  offsetU:  ReturnType<typeof uniform>;
  texUrl:   string | null;
  chainKey: string;
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

    const { width, height } = project.resolution;
    if (width !== this.w || height !== this.h) this.resize(width, height);

    for (const cm of this.pool.values()) cm.mesh.visible = false;

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
            renderer.render(scene, camera);
          }).catch(() => { /* leave placeholder */ });
        }
      }

      this.applyFrameUniforms(cm, clip, frame);
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

    const cm: ClipMesh = { mesh, opacityU, scaleU, offsetU, texUrl: null, chainKey: '' };
    this.pool.set(clip.id, cm);
    return cm;
  }

  private rebuildColorNode(cm: ClipMesh, clip: VideoClip, tex: THREE.Texture): void {
    let uvNode = uv().sub(0.5).div(cm.scaleU).add(cm.offsetU).add(0.5) as ReturnType<typeof uv>;

    for (const node of clip.shaderChain) {
      if (!node.enabled) continue;
      uvNode = applyUVTransform(node, uvNode);
    }

    tex.colorSpace = THREE.SRGBColorSpace;
    let colorNode = texture(tex, uvNode) as ReturnType<typeof vec4>;

    for (const node of clip.shaderChain) {
      if (!node.enabled) continue;
      colorNode = applyColorTransform(node, colorNode, tex, uvNode);
    }

    colorNode = vec4(colorNode.rgb, colorNode.a.mul(cm.opacityU)) as ReturnType<typeof vec4>;
    cm.mesh.material.colorNode = colorNode as never;
    cm.mesh.material.needsUpdate = true;
    cm.chainKey = JSON.stringify(clip.shaderChain);
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
