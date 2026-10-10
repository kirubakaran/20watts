/**
 * Model ladder loader, the glb counterpart of the image ladder. Each model
 * has rungs of increasing quality; the renderer asks for the rung whose
 * textures match how big the work is on screen, and this module loads it
 * once and hands over the scene to swap in. One rung is held at a time;
 * the streamer can ask it to fall back to the smallest when memory is
 * wanted elsewhere.
 */
import { CanvasTexture, Group, Material, Mesh, type Object3D, Points, PointsMaterial, SRGBColorSpace, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import type { ModelRung } from "../data/types";
import { assetUrl } from "./base";

let sharedLoader: GLTFLoader | null = null;
function loader(): GLTFLoader {
  if (!sharedLoader) {
    const dracoLoader = new DRACOLoader().setDecoderPath("/draco/");
    sharedLoader = new GLTFLoader().setDRACOLoader(dracoLoader);
  }
  return sharedLoader;
}

let dotTexture: CanvasTexture | null = null;
/** A round dot, so a point cloud is a cloud of discs rather than squares. */
function dot(): CanvasTexture {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, Math.PI * 2);
  ctx.fill();
  return (dotTexture = new CanvasTexture(c));
}

/**
 * How sharp a rung is, in the pixels its detail can fill: its largest
 * texture, or for a point cloud about twice the square root of its points,
 * so a cloud climbs its ladder at the same distances a textured mesh does.
 */
function resolutionOf(r: ModelRung): number {
  if (r.textureSize) return r.textureSize;
  return r.points ? Math.round(2 * Math.sqrt(r.points)) : 0;
}

/** Free everything a loaded glb scene holds on the GPU. */
export function disposeObject(root: Object3D) {
  root.traverse((o) => {
    if (o instanceof Points) {
      o.geometry.dispose();
      (o.material as Material).dispose();
      return;
    }
    if (!(o instanceof Mesh)) return;
    o.geometry.dispose();
    const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof Texture) v.dispose();
      m.dispose();
    }
  });
}

export class ModelLadder {
  private pending = new Map<string, Promise<Group>>();
  private best: Group | null = null;
  private bestRank = -1;
  private listeners = new Set<(root: Group) => void>();

  constructor(
    public readonly rungs: ModelRung[],
    private readonly pointSize: number,
    private readonly maxTextureSize: number,
    private readonly anisotropy: number,
  ) {}

  onUpgrade(fn: (root: Group) => void) {
    this.listeners.add(fn);
  }

  /** Smallest rung whose textures cover `desiredPx`, capped by the GPU. Returns its index. */
  private pick(desiredPx: number): number {
    const usable = this.rungs
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => (r.textureSize ?? 0) <= this.maxTextureSize);
    if (usable.length === 0) return -1;
    return (usable.find(({ r }) => resolutionOf(r) >= desiredPx) ?? usable[usable.length - 1]!).i;
  }

  /** Ensure a rung of at least `desiredPx` is loaded or loading. Never downgrades. */
  request(desiredPx: number) {
    const i = this.pick(desiredPx);
    if (i < 0 || i <= this.bestRank) return;
    const rung = this.rungs[i]!;
    if (this.pending.has(rung.url)) return;
    const p = loader()
      .loadAsync(assetUrl(rung.url, rung.bytes))
      .then((gltf) => {
        const root = gltf.scene;
        // A point cloud's dots are sized in metres: the record's size at the top rung,
        // larger on a thinner rung so the surface still reads as solid.
        const top = this.rungs.at(-1)?.points;
        const size = this.pointSize * (top && rung.points ? Math.sqrt(top / rung.points) : 1);
        root.traverse((o) => {
          if (o instanceof Points) {
            (o.material as Material).dispose();
            o.material = new PointsMaterial({ size, sizeAttenuation: true, vertexColors: true, map: dot(), alphaTest: 0.5, transparent: false });
            return;
          }
          if (!(o instanceof Mesh)) return;
          const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            for (const v of Object.values(m)) {
              if (v instanceof Texture) v.anisotropy = this.anisotropy;
            }
            if ("map" in m && m.map instanceof Texture) m.map.colorSpace = SRGBColorSpace;
          }
        });
        if (i > this.bestRank) {
          const old = this.best;
          this.best = root;
          this.bestRank = i;
          for (const fn of this.listeners) fn(root);
          if (old) disposeObject(old);
        } else {
          disposeObject(root);
        }
        return root;
      });
    this.pending.set(rung.url, p);
  }

  get current(): Group | null {
    return this.best;
  }

  /** Estimated GPU bytes of the rung held, from its catalogue entry. */
  get residentBytes(): number {
    const r = this.rungs[this.bestRank];
    if (!r) return 0;
    const tex = r.textureSize ?? 0;
    // Assume three textures per material set (colour, normal, roughness), ~36 bytes a triangle, 16 a point.
    return tex * tex * 4 * 1.34 * 3 + (r.triangles ?? 0) * 36 + (r.points ?? 0) * 16;
  }

  /** Fall back to the smallest rung. Returns false if already there. */
  shrink(): boolean {
    if (this.bestRank <= 0) return false;
    if (this.best) disposeObject(this.best);
    this.best = null;
    this.bestRank = -1;
    this.pending.clear();
    this.requestLowest();
    return true;
  }

  /** Texture size of the smallest rung: the quality a shrunk ladder is held at. */
  get lowestQuality(): number {
    return this.rungs[0] ? resolutionOf(this.rungs[0]) : 0;
  }

  requestLowest() {
    const r = this.rungs[0];
    if (r) this.request(resolutionOf(r));
  }

  dispose() {
    if (this.best) disposeObject(this.best);
    this.best = null;
    this.pending.clear();
    this.listeners.clear();
  }
}
