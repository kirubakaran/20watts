/**
 * Model ladder loader, the glb counterpart of the image ladder. Each model
 * has rungs of increasing quality; the renderer asks for the rung whose
 * textures match how big the work is on screen, and this module loads it
 * once and hands over the scene to swap in. Higher rungs are never dropped
 * in v1; eviction comes with the streaming world.
 */
import { Group, Material, Mesh, type Object3D, SRGBColorSpace, Texture } from "three";
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

/** Free everything a loaded glb scene holds on the GPU. */
export function disposeObject(root: Object3D) {
  root.traverse((o) => {
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
    return (usable.find(({ r }) => (r.textureSize ?? Infinity) >= desiredPx) ?? usable[usable.length - 1]!).i;
  }

  /** Ensure a rung of at least `desiredPx` is loaded or loading. Never downgrades. */
  request(desiredPx: number) {
    const i = this.pick(desiredPx);
    if (i < 0 || i <= this.bestRank) return;
    const rung = this.rungs[i]!;
    if (this.pending.has(rung.url)) return;
    const p = loader()
      .loadAsync(assetUrl(rung.url))
      .then((gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
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

  requestLowest() {
    const r = this.rungs[0];
    if (r) this.request(r.textureSize ?? 0);
  }

  dispose() {
    if (this.best) disposeObject(this.best);
    this.best = null;
    this.pending.clear();
    this.listeners.clear();
  }
}
