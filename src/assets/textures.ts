/**
 * Thumbnail ladder loader. Each image has rungs of increasing width; the
 * renderer asks for the rung that matches how big the work is on screen,
 * and this module loads it once and swaps it in. Higher rungs are never
 * dropped in v1; eviction comes with the streaming world.
 */
import { SRGBColorSpace, Texture, TextureLoader, LinearMipmapLinearFilter, LinearFilter } from "three";
import type { ImageRung } from "../data/types";

const loader = new TextureLoader();

export class ImageLadder {
  private loaded = new Map<number, Texture>();
  private pending = new Map<number, Promise<Texture>>();
  private best: Texture | null = null;
  private bestWidth = 0;
  private listeners = new Set<(t: Texture) => void>();

  constructor(
    public readonly rungs: ImageRung[],
    private readonly maxTextureSize: number,
    private readonly anisotropy: number,
  ) {}

  onUpgrade(fn: (t: Texture) => void) {
    this.listeners.add(fn);
  }

  /** Pick the smallest rung whose width covers `desiredPx` on screen, capped by the GPU. */
  private pick(desiredPx: number): ImageRung | null {
    const usable = this.rungs.filter((r) => r.width <= this.maxTextureSize && r.height <= this.maxTextureSize);
    if (usable.length === 0) return null;
    return usable.find((r) => r.width >= desiredPx) ?? usable[usable.length - 1]!;
  }

  /** Ensure a rung of at least `desiredPx` is loaded or loading. Never downgrades. */
  request(desiredPx: number) {
    const rung = this.pick(desiredPx);
    if (!rung || rung.width <= this.bestWidth || this.pending.has(rung.width)) return;
    const p = loader.loadAsync(rung.url).then((t) => {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = this.anisotropy;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.generateMipmaps = true;
      this.loaded.set(rung.width, t);
      if (rung.width > this.bestWidth) {
        this.best = t;
        this.bestWidth = rung.width;
        for (const fn of this.listeners) fn(t);
      }
      return t;
    });
    this.pending.set(rung.width, p);
  }

  get current(): Texture | null {
    return this.best;
  }

  /** The smallest rung, for an immediate first paint. */
  requestLowest() {
    const r = this.rungs[0];
    if (r) this.request(r.width);
  }

  dispose() {
    for (const t of this.loaded.values()) t.dispose();
    this.loaded.clear();
    this.pending.clear();
    this.listeners.clear();
  }
}
