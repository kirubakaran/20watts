/**
 * Jumping around the museum: one era forward or back, one cell sideways
 * (along a row: a work of the same month, or a branch), or straight to a work. Every jump lands you on the spine of a row,
 * in front of a cell, facing the future, the way you would arrive on foot.
 *
 * A row has one standing line for all its cells, set by its deepest and
 * widest cell, so hops along a row are pure sideways moves.
 */
import type { Footprint } from "../data/types";
import type { Layout, LayoutCell } from "../layout/layout";
import type { Player } from "./player";

export interface Stop {
  id: string;
  x: number;
  z: number;
  footprint: Footprint;
  /** Hung above head height: stand beneath it rather than in front. */
  overhead?: boolean;
  /** Entered at a door this far in front of the centre: stand there. */
  threshold?: number;
}

interface Row {
  z: number;
  /** Where to stand to take the row in. */
  frontZ: number;
  /** West to east. */
  cells: LayoutCell[];
}

/** How far back from the centre of something this wide and deep to stand. */
function standoff(width: number, depth: number): number {
  return depth / 2 + Math.min(10, Math.max(2.5, width * 0.6));
}

export class Navigator {
  private readonly rows: Row[];
  private readonly stops = new Map<string, Stop>();

  constructor(layout: Layout, stops: Stop[]) {
    const byRank = new Map<number, LayoutCell[]>();
    for (const c of layout.cells) (byRank.get(c.timeRank) ?? byRank.set(c.timeRank, []).get(c.timeRank)!).push(c);
    this.rows = [...byRank.entries()]
      .sort(([p], [q]) => p - q)
      .map(([, cells]) => {
        cells.sort((p, q) => p.x - q.x);
        const z = cells[0]!.z;
        return { z, frontZ: z + Math.max(...cells.map((c) => c.threshold ?? standoff(c.width, c.depth))), cells };
      });
    for (const s of stops) this.stops.set(s.id, s);
  }

  /** Where to stand to look at one work, or null if it is not on display. */
  standingPoint(id: string): { x: number; z: number } | null {
    const s = this.stops.get(id);
    if (!s) return null;
    if (s.overhead) return { x: s.x, z: s.z };
    return { x: s.x, z: s.z + (s.threshold ?? standoff(s.footprint.width, s.footprint.depth)) };
  }

  /** Stand in front of one work. Returns false if it is not on display. */
  goTo(player: Player, id: string): boolean {
    const p = this.standingPoint(id);
    if (!p) return false;
    player.teleport(p.x, p.z, 0);
    return true;
  }

  /** Next era (dir 1, forward, toward -Z) or previous (dir -1). Returns false at either end. */
  hopEra(player: Player, dir: 1 | -1): boolean {
    const { x, z } = player.floorPosition();
    // Rows whose standing line is clearly ahead (or behind), nearest first.
    const ahead = this.rows.filter((r) => (dir > 0 ? r.frontZ < z - 0.5 : r.frontZ > z + 0.5));
    const row = dir > 0 ? ahead[0] : ahead[ahead.length - 1];
    if (!row) return false;
    const cell = nearestBy(row.cells, (c) => Math.abs(c.x - x));
    player.teleport(cell.x, row.frontZ, 0);
    return true;
  }

  /** The latest era: in front of the cell nearest the spine in the last row. */
  goLast(player: Player): boolean {
    const row = this.rows[this.rows.length - 1];
    if (!row) return false;
    const cell = nearestBy(row.cells, (c) => Math.abs(c.x));
    player.teleport(cell.x, row.frontZ, 0);
    return true;
  }

  /** Next cell east (dir 1, +X) or west (dir -1) in the row you are at. */
  hopGeo(player: Player, dir: 1 | -1): boolean {
    const { x, z } = player.floorPosition();
    const row = nearestBy(this.rows, (r) => Math.abs(r.frontZ - z));
    const cells = row.cells.filter((c) => (dir > 0 ? c.x > x + 0.5 : c.x < x - 0.5));
    const cell = dir > 0 ? cells[0] : cells[cells.length - 1];
    if (!cell) return false;
    player.teleport(cell.x, row.frontZ, 0);
    return true;
  }
}

function nearestBy<T>(items: T[], cost: (t: T) => number): T {
  let best = items[0] as T;
  let bestCost = Infinity;
  for (const it of items) {
    const c = cost(it);
    if (c < bestCost) (bestCost = c), (best = it);
  }
  return best;
}
