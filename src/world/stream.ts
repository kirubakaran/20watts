/**
 * The streaming world. Every work is known from the start as a stub (its
 * place and size, from the layout); an Exhibit, with its meshes, ladders
 * and placards, exists only while the visitor is near. Since rows run
 * along time, this is infinite scroll through the eras: rows ahead are
 * built as you approach and rows behind are torn down as you leave.
 *
 * Three radii, outer to inner:
 *   unload   beyond this an exhibit is disposed
 *   load     within this a stub becomes an exhibit (lowest rung first)
 *   placard  within this an exhibit has its placards (text is dear)
 * and a memory budget: when the estimated GPU bytes held exceed it, the
 * farthest exhibits fall back to their smallest rung until it fits.
 *
 * The sweep runs a few times a second, over the rows near the visitor
 * only; the per-frame work is just the live exhibits' rung requests.
 */
import type { Scene, Vector3 } from "three";
import type { Artwork, Footprint } from "../data/types";
import { footprintOf } from "../data/types";
import type { Layout, Placement } from "../layout/layout";
import { Exhibit } from "./exhibit";

export interface StreamConfig {
  loadRadius: number;
  unloadRadius: number;
  placardRadius: number;
  /** Estimated GPU bytes allowed for exhibits' textures and meshes. */
  budgetBytes: number;
  /** Exhibits nearer than this keep their quality even over budget. */
  protectRadius: number;
  /** Seconds between sweeps. */
  sweepEvery: number;
}

const MOBILE = /OculusBrowser|Quest|Android|Mobile/i.test(navigator.userAgent);

export const DEFAULT_STREAM: StreamConfig = {
  loadRadius: 90,
  unloadRadius: 130,
  placardRadius: 35,
  budgetBytes: (MOBILE ? 384 : 1536) * 1024 * 1024,
  protectRadius: 25,
  sweepEvery: 0.25,
};

interface Stub {
  artwork: Artwork;
  placement: Placement;
  footprint: Footprint;
  exhibit: Exhibit | null;
}

interface Row {
  z: number;
  stubs: Stub[];
}

export class Streamer {
  private readonly rows: Row[];
  private readonly live = new Set<Stub>();
  private since = Infinity;
  private lastX = NaN;
  private lastZ = NaN;

  constructor(
    private readonly scene: Scene,
    artworks: Artwork[],
    layout: Layout,
    private readonly gpu: { maxTextureSize: number; maxAnisotropy: number },
    private readonly cfg: StreamConfig = DEFAULT_STREAM,
  ) {
    const byRow = new Map<number, Row>();
    for (const a of artworks) {
      const placement = layout.placements.get(a.id);
      if (!placement) continue;
      const rank = placement.cell.timeRank;
      const row = byRow.get(rank) ?? byRow.set(rank, { z: placement.position.z, stubs: [] }).get(rank)!;
      row.z = Math.max(row.z, placement.position.z);
      row.stubs.push({ artwork: a, placement, footprint: footprintOf(a), exhibit: null });
    }
    // Rows in time order: z decreasing, since the future is -Z.
    this.rows = [...byRow.values()].sort((p, q) => q.z - p.z);
  }

  /** How many exhibits exist right now. */
  get liveCount(): number {
    return this.live.size;
  }

  /** Estimated GPU bytes held by live exhibits. */
  get residentBytes(): number {
    let b = 0;
    for (const s of this.live) b += s.exhibit!.residentBytes;
    return b;
  }

  /** Live exhibits whose place is within `radius` of a floor point. */
  exhibitsWithin(x: number, z: number, radius: number): Exhibit[] {
    const out: Exhibit[] = [];
    for (const s of this.live) {
      const p = s.placement.position;
      if (Math.hypot(p.x - x, p.z - z) <= radius + s.footprint.width) out.push(s.exhibit!);
    }
    return out;
  }

  /** The biggest holders, for ?debug. */
  report(eye: Vector3, n = 5): string {
    return [...this.live]
      .map((s) => ({ id: s.artwork.id, d: this.distance(s, eye), mb: s.exhibit!.residentBytes / 1048576, capped: s.exhibit!.capped }))
      .sort((p, q) => q.mb - p.mb)
      .slice(0, n)
      .map((r) => `${r.id} ${r.mb.toFixed(0)} MB at ${r.d.toFixed(0)} m${r.capped ? " (held low)" : ""}`)
      .join("; ");
  }

  /** Call every frame with the viewer's eye position. */
  update(eye: Vector3, dt: number) {
    this.since += dt;
    const moved = Math.hypot(eye.x - this.lastX, eye.z - this.lastZ);
    if (this.since >= this.cfg.sweepEvery || !(moved < 2)) {
      this.since = 0;
      this.lastX = eye.x;
      this.lastZ = eye.z;
      this.sweep(eye);
    }
    for (const s of this.live) s.exhibit!.update(eye, dt);
  }

  private sweep(eye: Vector3) {
    const { loadRadius, unloadRadius, placardRadius } = this.cfg;
    // Tear down what is far, wherever it is.
    for (const s of this.live) {
      if (this.distance(s, eye) > unloadRadius) this.unload(s);
    }
    // Build what is near, looking only at rows within reach along time.
    for (const row of this.rows) {
      if (row.z > eye.z + loadRadius) continue;
      if (row.z < eye.z - loadRadius) break;
      for (const s of row.stubs) {
        const d = this.distance(s, eye);
        if (!s.exhibit && d <= loadRadius) this.load(s);
        // A building's placards stand at its door, which is `threshold` from its centre.
        s.exhibit?.setPlacards(d <= placardRadius + (s.artwork.display.threshold ?? 0));
      }
    }
    this.enforceBudget(eye);
  }

  /**
   * Over budget: the farthest exhibits fall back to their smallest rung and
   * are held there. Well under budget: the nearest held exhibit is let go
   * again, one per sweep, so quality creeps back rather than oscillating.
   */
  private enforceBudget(eye: Vector3) {
    let held = this.residentBytes;
    const byDistance = [...this.live].map((s) => ({ s, d: this.distance(s, eye) })).sort((p, q) => q.d - p.d);
    if (held > this.cfg.budgetBytes) {
      for (const { s, d } of byDistance) {
        if (d <= this.cfg.protectRadius || s.exhibit!.capped) continue;
        const before = s.exhibit!.residentBytes;
        if (s.exhibit!.shrink()) held -= before - s.exhibit!.residentBytes;
        if (held <= this.cfg.budgetBytes) break;
      }
    } else if (held < this.cfg.budgetBytes * 0.6) {
      const nearest = byDistance.reverse().find(({ s }) => s.exhibit!.capped);
      nearest?.s.exhibit!.uncap();
    }
  }

  private distance(s: Stub, eye: Vector3): number {
    const p = s.placement.position;
    return Math.hypot(p.x - eye.x, p.z - eye.z);
  }

  private load(s: Stub) {
    const e = new Exhibit(s.artwork, s.placement, this.gpu);
    this.scene.add(e.group);
    s.exhibit = e;
    this.live.add(s);
  }

  private unload(s: Stub) {
    s.exhibit?.dispose();
    s.exhibit = null;
    this.live.delete(s);
  }
}
