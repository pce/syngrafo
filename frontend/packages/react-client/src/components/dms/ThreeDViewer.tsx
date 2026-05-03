/**
 * ThreeDViewer.tsx — Three.js-powered 3D model and point-cloud preview.
 *
 * Supported formats:
 *
 * Mesh            - PLY, OBJ (+MTL), GLTF, GLB, STL
 * Point-cloud     - XYZ (ASCII), PCD (ASCII/binary via PCDLoader)
 * Gaussian Splat  - .splat (antimatter15 compact binary, 32 bytes/splat)
 * Placeholder     - .spz  (compressed Gaussian Splat — decoder not bundled)
 *
 * Controls toolbar: wireframe · grid · auto-rotate · reset · point-size
 *
 * NOTE: is3DFile() lives in dms-service.ts as the canonical export;
 *       no named export of it here avoids Bun tree-shaking issues with
 *       heavy Three.js side-effects.
 */

import React, {
  useEffect, useRef, useState, useCallback, useId,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PLYLoader }  from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader }  from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader }  from "three/examples/jsm/loaders/MTLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader }  from "three/examples/jsm/loaders/STLLoader.js";
import { PCDLoader }  from "three/examples/jsm/loaders/PCDLoader.js";
import Icon from "../Icon";

// Format helpers (NOT re-exporting is3DFile — use dms-service.ts)
export type ModelFormat =
  | "ply" | "obj" | "gltf" | "glb" | "stl"
  | "splat" | "spz" | "xyz" | "pcd";

export function get3DFormat(path: string): ModelFormat | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, ModelFormat> = {
    ply: "ply", obj: "obj", gltf: "gltf", glb: "glb", stl: "stl",
    splat: "splat", spz: "spz", xyz: "xyz", pcd: "pcd",
  };
  return map[ext] ?? null;
}

// Internal helpers
interface Props { filePath: string; className?: string; }
type RenderKind = "mesh" | "points" | "unknown";

function fitToView(object: THREE.Object3D): void {
  const box  = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const ctr  = new THREE.Vector3();
  box.getSize(size); box.getCenter(ctr);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale  = maxDim > 0 ? 2 / maxDim : 1;
  object.scale.setScalar(scale);
  object.position.sub(ctr.multiplyScalar(scale));
}

function meshMaterial(): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color: 0x8888bb, specular: 0x222222, shininess: 40,
    side: THREE.DoubleSide, vertexColors: false,
  });
}

/** Parse antimatter15 compact .splat binary (32 bytes/Gaussian). */
function parseSplatToPoints(buffer: ArrayBuffer): THREE.Points {
  const stride    = 32;
  const count     = Math.floor(buffer.byteLength / stride);
  const view      = new DataView(buffer);
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const b = i * stride;
    positions[i * 3]     = view.getFloat32(b,      true);
    positions[i * 3 + 1] = view.getFloat32(b + 4,  true);
    positions[i * 3 + 2] = view.getFloat32(b + 8,  true);
    // color RGBA at offset 24 (r, g, b, opacity)
    colors[i * 3]     = view.getUint8(b + 24) / 255;
    colors[i * 3 + 1] = view.getUint8(b + 25) / 255;
    colors[i * 3 + 2] = view.getUint8(b + 26) / 255;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color",    new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.02, vertexColors: true, sizeAttenuation: true,
  }));
}

/** Parse ASCII XYZ: `x y z [r g b]` per line, `#` comments ignored. */
function parseXyzToPoints(text: string): THREE.Points {
  const pos: number[] = []; const col: number[] = []; let hasColor = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const p = line.split(/\s+/);
    if (p.length < 3) continue;
    pos.push(parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2]));
    if (p.length >= 6) {
      const r = parseFloat(p[3]), g = parseFloat(p[4]), b = parseFloat(p[5]);
      const s = (r > 1 || g > 1 || b > 1) ? 1 / 255 : 1;
      col.push(r * s, g * s, b * s); hasColor = true;
    } else { col.push(0.6, 0.65, 1.0); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color",    new THREE.BufferAttribute(new Float32Array(col), 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.02, vertexColors: hasColor, sizeAttenuation: true,
    color: hasColor ? 0xffffff : 0x88aaff,
  }));
}

// Viewer controls state
interface ViewerControls {
  wireframe: boolean; grid: boolean; autoRotate: boolean;
  pointSize: number;  renderKind: RenderKind;
}
const INIT: ViewerControls = {
  wireframe: false, grid: true, autoRotate: false,
  pointSize: 0.02,  renderKind: "unknown",
};

// Component

const ThreeDViewer: React.FC<Props> = ({ filePath, className = "" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef     = useRef<THREE.Scene | null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef  = useRef<OrbitControls | null>(null);
  const frameRef     = useRef<number>(0);
  const gridRef      = useRef<THREE.GridHelper | null>(null);
  const objectRef    = useRef<THREE.Object3D | null>(null);
  const mountedRef   = useRef(true);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [info,    setInfo]     = useState("");
  const [vc, setVc]           = useState<ViewerControls>(INIT);
  const sliderId = useId();

  const localUrl = useCallback(
    (p: string) => "local://local" + p.split("/").map(encodeURIComponent).join("/"),
    [],
  );

  const cleanup = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    controlsRef.current?.dispose();

    // Dispose all scene geometry + materials to free GPU memory
    if (sceneRef.current) {
      sceneRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
          obj.geometry?.dispose();
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
    }

    // forceContextLoss() explicitly releases the WebGL context back to the
    // browser immediately — without it, WKWebView keeps the context alive until
    // GC and quickly exhausts its hard limit of ~16 simultaneous contexts.
    if (rendererRef.current) {
      rendererRef.current.forceContextLoss();
      rendererRef.current.dispose();
    }
    if (containerRef.current) containerRef.current.innerHTML = "";
    rendererRef.current = null; sceneRef.current = null;
    cameraRef.current = null;   controlsRef.current = null;
    gridRef.current = null;     objectRef.current = null;
  }, []);

  // Apply wireframe toggle
  useEffect(() => {
    objectRef.current?.traverse((c) => {
      if (c instanceof THREE.Mesh && c.material)
        (c.material as THREE.MeshPhongMaterial).wireframe = vc.wireframe;
    });
  }, [vc.wireframe]);

  // Apply grid visibility
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = vc.grid;
  }, [vc.grid]);

  // Apply auto-rotate
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = vc.autoRotate;
  }, [vc.autoRotate]);

  // Apply point size
  useEffect(() => {
    objectRef.current?.traverse((c) => {
      if (c instanceof THREE.Points)
        (c.material as THREE.PointsMaterial).size = vc.pointSize;
    });
  }, [vc.pointSize]);

  // Scene setup + model load
  useEffect(() => {
    mountedRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    setLoading(true); setError(null); setInfo(""); setVc(INIT); cleanup();

    const W = container.clientWidth || 640;
    const H = container.clientHeight || 480;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFShadowMap;   // PCFSoftShadowMap removed in r184
    renderer.outputColorSpace  = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141414);
    sceneRef.current = scene;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 6, 4); sun.castShadow = true; scene.add(sun);
    const backLight = new THREE.DirectionalLight(0x8899ff, 0.4);
    backLight.position.set(-3, -2, -3);
    scene.add(backLight);

    const grid = new THREE.GridHelper(10, 20, 0x333333, 0x1e1e1e);
    scene.add(grid); gridRef.current = grid;

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.001, 2000);
    camera.position.set(0, 1.5, 3.5); cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true; controlsRef.current = controls;

    const ro = new ResizeObserver(() => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth, h = container.clientHeight;
      rendererRef.current.setSize(w, h);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    });
    ro.observe(container);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const fmt = get3DFormat(filePath);
    const url = localUrl(filePath);

    const onMesh = (obj: THREE.Object3D, stats: string) => {
      if (!mountedRef.current) return;
      fitToView(obj); scene.add(obj); objectRef.current = obj;
      setVc(v => ({ ...v, renderKind: "mesh" }));
      setLoading(false); setInfo(stats);
    };
    const onPts = (pts: THREE.Object3D, stats: string) => {
      if (!mountedRef.current) return;
      fitToView(pts); scene.add(pts); objectRef.current = pts;
      setVc(v => ({ ...v, renderKind: "points" }));
      setLoading(false); setInfo(stats);
    };
    const onErr = (e: unknown) => {
      if (!mountedRef.current) return;
      setError(`Failed to load: ${e instanceof Error ? e.message : String(e)}`);
      setLoading(false);
    };

    switch (fmt) {
      case "ply":
        new PLYLoader().load(url, (geo) => {
          geo.computeVertexNormals();
          const hasColor = geo.hasAttribute("color");
          const verts    = geo.attributes.position?.count ?? 0;
          const mat      = hasColor
            ? new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide })
            : meshMaterial();
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = mesh.receiveShadow = true;
          onMesh(mesh, `PLY · ${verts.toLocaleString()} vertices${hasColor ? " · vertex colors" : ""}`);
        }, undefined, onErr);
        break;

      case "obj": {
        const dir     = url.substring(0, url.lastIndexOf("/") + 1);
        const mtlPath = filePath.replace(/\.obj$/i, ".mtl");
        const loadObj = (mtl?: THREE.MtlCreator) => {
          const ldr = new OBJLoader();
          if (mtl) { mtl.preload(); ldr.setMaterials(mtl); }
          ldr.load(url, (obj) => {
            let faces = 0;
            obj.traverse((c) => {
              if (!(c instanceof THREE.Mesh)) return;
              c.castShadow = c.receiveShadow = true;
              if (!mtl) c.material = meshMaterial();
              const idx = (c.geometry as THREE.BufferGeometry).index;
              faces += idx ? idx.count / 3 : (c.geometry.attributes.position?.count ?? 0) / 3;
            });
            onMesh(obj, `OBJ · ${Math.round(faces).toLocaleString()} faces`);
          }, undefined, onErr);
        };
        fetch(localUrl(mtlPath))
          .then(r => { if (!r.ok) throw new Error("no mtl"); return r.text(); })
          .then(() => {
            const ml = new MTLLoader();
            ml.setPath(dir);
            ml.load(localUrl(mtlPath), (m) => loadObj(m), undefined, () => loadObj());
          })
          .catch(() => loadObj());
        break;
      }

      case "gltf":
      case "glb":
        new GLTFLoader().load(url, (gltf) => {
          let tris = 0;
          gltf.scene.traverse((c) => {
            if (!(c instanceof THREE.Mesh)) return;
            c.castShadow = c.receiveShadow = true;
            const geo = c.geometry as THREE.BufferGeometry;
            tris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;
          });
          onMesh(gltf.scene, `${fmt === "glb" ? "GLB" : "GLTF"} · ${Math.round(tris).toLocaleString()} triangles`);
        }, undefined, onErr);
        break;

      case "stl":
        new STLLoader().load(url, (geo) => {
          geo.computeVertexNormals();
          const mesh  = new THREE.Mesh(geo, meshMaterial());
          mesh.castShadow = mesh.receiveShadow = true;
          const tris  = (geo.attributes.position?.count ?? 0) / 3;
          onMesh(mesh, `STL · ${tris.toLocaleString()} triangles`);
        }, undefined, onErr);
        break;

      case "splat":
        fetch(url)
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
          .then(buf => {
            const pts   = parseSplatToPoints(buf);
            const count = (pts.geometry.attributes.position as THREE.BufferAttribute).count;
            onPts(pts, `Gaussian Splat · ${count.toLocaleString()} Gaussians (point-cloud preview)`);
          })
          .catch(onErr);
        break;

      case "spz":
        setError(
          "SPZ (compressed Gaussian Splat) requires an external decoder.\n" +
          "Convert to .splat or .ply with antimatter15/splat tools, then re-open.",
        );
        setLoading(false);
        break;

      case "xyz":
        fetch(url)
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
          .then(text => {
            const pts   = parseXyzToPoints(text);
            const count = (pts.geometry.attributes.position as THREE.BufferAttribute).count;
            onPts(pts, `XYZ · ${count.toLocaleString()} points`);
          })
          .catch(onErr);
        break;

      case "pcd":
        new PCDLoader().load(url, (pts) => {
          const count = ((pts as THREE.Points).geometry.attributes.position as THREE.BufferAttribute).count;
          onPts(pts, `PCD · ${count.toLocaleString()} points`);
        }, undefined, onErr);
        break;

      default:
        setError("Unsupported 3D format.");
        setLoading(false);
    }

    return () => { mountedRef.current = false; ro.disconnect(); cleanup(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  const resetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0, 1.5, 3.5);
    cameraRef.current.lookAt(0, 0, 0);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, []);

  const tbBtn = (active: boolean) =>
    `w-7 h-7 rounded flex items-center justify-center transition-colors duration-100 border ${
      active
        ? "bg-[var(--theme-primary)]/20 border-[var(--theme-primary)]/60 text-[var(--theme-primary)]"
        : "bg-[var(--theme-surface)] border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)]"
    }`;

  return (
    <div className={`relative flex flex-col w-full h-full ${className}`}>

      {/* ─── [Toolbar] ────────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div className="flex items-center gap-1 px-2 py-1.5 shrink-0 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]">
          {vc.renderKind === "mesh" && (
            <button title={vc.wireframe ? "Solid" : "Wireframe"}
              onClick={() => setVc(v => ({ ...v, wireframe: !v.wireframe }))}
              className={tbBtn(vc.wireframe)}>
              {/* wireframe lattice icon */}
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </button>
          )}
          <button title={vc.grid ? "Hide grid" : "Show grid"}
            onClick={() => setVc(v => ({ ...v, grid: !v.grid }))}
            className={tbBtn(vc.grid)}>
            <Icon name="grid" size="xs" />
          </button>
          <button title={vc.autoRotate ? "Stop rotation" : "Auto-rotate"}
            onClick={() => setVc(v => ({ ...v, autoRotate: !v.autoRotate }))}
            className={tbBtn(vc.autoRotate)}>
            <Icon name="rotate" size="xs" />
          </button>
          <button title="Reset camera" onClick={resetCamera} className={tbBtn(false)}>
            <Icon name="home" size="xs" />
          </button>

          {vc.renderKind === "points" && (
            <>
              <div className="w-px h-4 bg-[var(--theme-border)] mx-1" />
              <label htmlFor={sliderId}
                className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] shrink-0">
                Pt
              </label>
              <input id={sliderId} type="range" min="0" max="100"
                value={Math.round(((vc.pointSize - 0.005) / 0.095) * 100)}
                onChange={e => setVc(v => ({ ...v, pointSize: 0.005 + (parseInt(e.target.value) / 100) * 0.095 }))}
                className="w-20 h-1.5 accent-[var(--theme-primary)] cursor-pointer"
              />
            </>
          )}

          <span className="ml-auto text-[9px] text-[var(--theme-text-muted)] truncate max-w-[50%]">{info}</span>
          <span className="text-[8px] text-[var(--theme-text-muted)] opacity-40 shrink-0 ml-1 hidden sm:block">
            Drag · Scroll · Right-drag
          </span>
        </div>
      )}

      {/* ── [Canvas] ─────────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden" style={{ minHeight: 320 }} />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--theme-bg)]/85 rounded-lg">
          <span className="w-8 h-8 border-2 border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)] rounded-full animate-spin" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">
            Loading model…
          </span>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 bg-[var(--theme-bg)]/92 rounded-lg">
          <Icon name="warning" size="lg" className="opacity-40 text-[var(--theme-danger)]" />
          <p className="text-xs text-[var(--theme-danger)] text-center max-w-xs whitespace-pre-wrap">{error}</p>
        </div>
      )}
    </div>
  );
};

export default ThreeDViewer;

