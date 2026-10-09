/**
 * Thumbnail ladder loader. Each image has rungs of increasing width; the
 * renderer asks for the rung that matches how big the work is on screen,
 * and this module loads it once and swaps it in. The streamer can ask it
 * to shrink back to its smallest rung when memory is wanted elsewhere.
 */
import { SRGBColorSpace, Texture, TextureLoader, LinearMipmapLinearFilter, LinearFilter } from "three";
import type { ImageRung } from "../data/types";
import { assetUrl } from "./base";

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
    const p = loader.loadAsync(assetUrl(rung.url)).then((t) => {
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

  /** Estimated GPU bytes of the rungs held: RGBA plus a third for mipmaps. */
  get residentBytes(): number {
    let bytes = 0;
    for (const t of this.loaded.values()) {
      const img = t.image as { width?: number; height?: number } | undefined;
      bytes += (img?.width ?? 0) * (img?.height ?? 0) * 4 * 1.34;
    }
    return bytes;
  }

  /** Drop every rung but the smallest held. Returns false if there was nothing to drop. */
  shrink(): boolean {
    if (this.loaded.size <= 1) return false;
    const widths = [...this.loaded.keys()].sort((p, q) => p - q);
    const keep = widths[0]!;
    for (const w of widths.slice(1)) {
      this.loaded.get(w)!.dispose();
      this.loaded.delete(w);
      this.pending.delete(w);
    }
    this.best = this.loaded.get(keep)!;
    this.bestWidth = keep;
    for (const fn of this.listeners) fn(this.best);
    return true;
  }

  /** Width of the smallest rung: the quality a shrunk ladder is held at. */
  get lowestQuality(): number {
    return this.rungs[0]?.width ?? 0;
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
