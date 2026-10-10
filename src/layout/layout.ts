/**
 * Layout: maps artworks onto the ground plane.
 *
 *   forward/back (world -Z / +Z)  = time, future is forward (-Z)
 *   left/right   (world -X / +X)  = off the lane: branches, and in the world
 *                                   view, geography (west left, east right)
 *
 * The time axis is ORDERED, not to scale. Works are binned by date, to the
 * month when it is known; distinct non-empty bins are ranked, and each rank
 * becomes one row. Empty stretches of time simply do not exist in the
 * world. Two works a year apart stand one behind the other; two from the
 * same month stand side by side, earlier (by day, then a hand-set order,
 * then importance) to the west.
 *
 * The main lane runs along the spine (x = 0). A work with a `branch` does
 * not take a row of its own: it stands beside its anchor, to the east, as
 * a side quest, and a chain of them (the chip inside the computer, the die
 * inside the chip) runs further east in order. Branches are packed tight,
 * each step as close as the two works' widths allow, never closer than the
 * minimum pitch.
 *
 * Rows are spaced along time by what stands in them: at least `cellPitchZ`
 * apart, and further when a row is deep (a building) so that `rowGapZ` of
 * clear floor stays between a row's back and the next row's front.
 *
 * The world view (`geoBinDegrees` set) adds the second axis: works of the
 * same month are split by degrees of longitude into cells, side by side
 * from west to east and centred on the spine. Empty cells do not exist: a
 * row holds only the cells that have works. Cells in a row are spaced by
 * the row's widest cell plus a gap, between a minimum (so neighbours are
 * still distinct cells) and the full pitch.
 *
 * Only this module knows about time, geography and branches. The renderer
 * only sees positions, yaws and footprints.
 */
import { Vector3 } from "three";
import type { Artwork } from "../data/types";
import { footprintOf } from "../data/types";

export interface LayoutConfig {
  /** Months per time bin: 1 orders by month where known, 12 by year, 120 by decade. */
  timeBinMonths: number;
  /** Degrees of longitude per geography cell, or null for one lane with no geography. */
  geoBinDegrees: number | null;
  /** Smallest distance between adjacent time rows, metres. */
  cellPitchZ: number;
  /** Clear floor kept between the extents of adjacent rows, metres. */
  rowGapZ: number;
  /** Clear floor between the back of a row and the standing line of the next, metres. */
  standingClearance: number;
  /** Largest distance between adjacent cells in a row, metres. */
  cellPitchX: number;
  /** Smallest distance between adjacent cells in a row, metres. */
  minPitchX: number;
  /** Clear space between the widest cells of a row, metres. */
  cellGap: number;
  /** Clear space either side of a cell, metres: room for the placards beside a low work. */
  cellPadding: number;
  /** Clear space between works inside a cell, metres. */
  itemGap: number;
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  timeBinMonths: 1,
  geoBinDegrees: null,
  cellPitchZ: 16,
  rowGapZ: 8,
  standingClearance: 3,
  cellPitchX: 16,
  minPitchX: 6,
  cellGap: 2,
  cellPadding: 1.2,
  itemGap: 2,
};

/** The same collection with geography as the second axis. */
export const WORLD_LAYOUT: LayoutConfig = { ...DEFAULT_LAYOUT, geoBinDegrees: 5 };

export interface Placement {
  id: string;
  position: Vector3;
  /** Rotation about Y. 0 faces +Z, i.e. toward a visitor arriving from the past. */
  yaw: number;
  /** Global ranks on each axis. Rows are compacted, so geoRank is an order, not a column. */
  cell: { timeRank: number; geoRank: number };
  /** Set on a branch work: the id of the work it stands beside. */
  branchOf?: string;
}

export interface AxisTick {
  rank: number;
  /** Bin start value (year, or degrees of longitude). */
  value: number;
  /** Time axis only: month (1–12) the bin starts in, or null when it starts on an unknown month. */
  month?: number | null;
  /** World coordinate of the cell centre on that axis. */
  coord: number;
  /** Time axis only: z of the boundary a visitor crosses into this row, where the label goes. */
  edge?: number;
  count: number;
}

/** One occupied cell in world coordinates: a time row crossed with a column, or a branch step. */
export interface LayoutCell {
  timeRank: number;
  geoRank: number;
  /** Cell centre. */
  x: number;
  z: number;
  /** Extent of the packed works and their padding, metres. */
  width: number;
  depth: number;
  /** The tallest work, from the floor. */
  height: number;
  count: number;
  /** A branch step: the anchor's id and the label for the floor. */
  branch?: { of: string; label: string };
  /** A work entered at a door: how far in front of the centre to stand, instead of standing back. */
  threshold?: number;
  /** Off the lane, seen from afar: which side, how far, and the title for the pointer on the lane. */
  landmark?: { side: "east" | "west"; distance: number; label: string };
}

export interface Layout {
  placements: Map<string, Placement>;
  timeAxis: AxisTick[];
  /** Empty when the layout has no geography axis. */
  geoAxis: AxisTick[];
  cells: LayoutCell[];
}

/** Works with no known longitude go in a bin past the eastern edge. */
const UNKNOWN_GEO_BIN = Number.POSITIVE_INFINITY;

/** Months since year 0; an unknown month sorts before January of its year. */
function timeBin(a: Artwork, cfg: LayoutConfig): number {
  return Math.floor((a.date.year * 13 + (a.date.month ?? 0)) / cfg.timeBinMonths);
}
function binStart(bin: number, cfg: LayoutConfig): { year: number; month: number | null } {
  const m = bin * cfg.timeBinMonths;
  const year = Math.floor(m / 13);
  const month = m - year * 13;
  return { year, month: month === 0 ? null : month };
}

function geoBin(a: Artwork, cfg: LayoutConfig): number {
  if (cfg.geoBinDegrees == null) return 0;
  const lon = a.madeIn.point?.lon ?? a.location.point?.lon;
  if (lon == null) return UNKNOWN_GEO_BIN;
  return Math.floor(lon / cfg.geoBinDegrees);
}

function rankBins(bins: number[]): Map<number, number> {
  const distinct = [...new Set(bins)].sort((p, q) => p - q);
  return new Map(distinct.map((b, i) => [b, i]));
}

function importanceOf(a: Artwork): number {
  return a.importance ?? (a.pageviews ? Math.log10(a.pageviews) / 7 : 0);
}

/** Earlier first: by day (unknown first), then hand-set order, then importance. */
function byDateOrder(p: Artwork, q: Artwork): number {
  return (
    (p.date.day ?? 0) - (q.date.day ?? 0) ||
    (p.order ?? Infinity) - (q.order ?? Infinity) ||
    importanceOf(q) - importanceOf(p)
  );
}

/**
 * The branch works hanging off `anchor`, nearest first: its own steps in
 * order, each followed by the steps hanging off it.
 */
function branchChain(anchor: string, children: Map<string, Artwork[]>): Artwork[] {
  const out: Artwork[] = [];
  for (const b of children.get(anchor) ?? []) out.push(b, ...branchChain(b.id, children));
  return out;
}

/**
 * How far back from the centre of something this big a visitor stands to
 * take it in: far enough for its width, or its height when it is a tall
 * print or a tower, never closer than arm's length nor farther than ten
 * metres. The navigator lands hops here, and the layout keeps this much
 * clear floor in front of every row.
 */
export function standoffOf(fp: { width: number; depth: number; height: number }): number {
  return fp.depth / 2 + Math.min(10, Math.max(2.5, fp.width * 0.6, fp.height * 0.9));
}

export function computeLayout(artworks: Artwork[], cfg: LayoutConfig = DEFAULT_LAYOUT): Layout {
  // Branches stand beside their anchors; only the rest takes part in binning.
  // A branch whose anchor is not here stands on the lane in its own time.
  const ids = new Set(artworks.map((a) => a.id));
  const children = new Map<string, Artwork[]>();
  const main: Artwork[] = [];
  for (const a of artworks) {
    if (a.branch && ids.has(a.branch.of)) (children.get(a.branch.of) ?? children.set(a.branch.of, []).get(a.branch.of)!).push(a);
    else main.push(a);
  }
  for (const list of children.values()) list.sort((p, q) => p.branch!.step - q.branch!.step);

  const tBins = main.map((a) => timeBin(a, cfg));
  const gBins = main.map((a) => geoBin(a, cfg));
  const tRank = rankBins(tBins);
  const gRank = rankBins(gBins);

  // Group into cells. A landmark keeps its row but stands off to the side,
  // so it is not packed with the row and does not deepen it.
  const cells = new Map<string, Artwork[]>();
  main.forEach((a, i) => {
    if (a.landmark) return;
    const key = `${tRank.get(tBins[i]!)}:${gRank.get(gBins[i]!)}`;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(a);
  });

  // Per time row, the geography ranks present, in order; a row is laid out
  // by these columns, so empty cells between works collapse.
  const rowCols = new Map<number, Map<number, number>>();
  for (const key of cells.keys()) {
    const [timeRank, geoRank] = key.split(":").map(Number) as [number, number];
    (rowCols.get(timeRank) ?? rowCols.set(timeRank, new Map()).get(timeRank)!).set(geoRank, 0);
  }
  for (const cols of rowCols.values()) {
    [...cols.keys()].sort((p, q) => p - q).forEach((g, i) => cols.set(g, i));
  }

  // Pack each cell's members and measure the result; the row pitch depends
  // on the widest cell in the row. On the lane a cell is one row deep, so
  // earlier is always to the west; the world view packs a square-ish grid.
  interface Packed { cols: number; rows: number; pitchX: number; pitchZ: number; width: number; depth: number; height: number }
  const packed = new Map<string, Packed>();
  for (const [key, members] of cells) {
    members.sort(byDateOrder);
    const fps = members.map(footprintOf);
    const maxW = Math.max(...fps.map((f) => f.width));
    const maxD = Math.max(...fps.map((f) => f.depth));
    const height = Math.max(...fps.map((f) => f.height));
    const pitchX = maxW + cfg.itemGap;
    const pitchZ = maxD + cfg.itemGap;
    const cols = cfg.geoBinDegrees == null ? members.length : Math.ceil(Math.sqrt(members.length));
    const rows = Math.ceil(members.length / cols);
    packed.set(key, {
      cols, rows, pitchX, pitchZ,
      width: (cols - 1) * pitchX + maxW + 2 * cfg.cellPadding,
      depth: (rows - 1) * pitchZ + maxD,
      height,
    });
  }
  const rowPitch = new Map<number, number>();
  for (const [timeRank, cols] of rowCols) {
    let widest = 0;
    for (const g of cols.keys()) widest = Math.max(widest, packed.get(`${timeRank}:${g}`)!.width);
    rowPitch.set(timeRank, Math.min(cfg.cellPitchX, Math.max(cfg.minPitchX, widest + cfg.cellGap)));
  }

  // Rows along time: each row's depth is its deepest cell or branch step,
  // and rows are spaced so a gap of clear floor stays between them, and so
  // that where a visitor stands to look at a row (its standing line, set
  // back by the widest work's standoff, or at a building's door) is clear
  // of the row before: a hop forward must never land inside a building.
  const rowDepth = new Map<number, number>();
  const rowFront = new Map<number, number>();
  for (const [key, members] of cells) {
    const timeRank = Number(key.split(":")[0]);
    rowDepth.set(timeRank, Math.max(rowDepth.get(timeRank) ?? 0, packed.get(key)!.depth));
    for (const a of members) {
      const front = a.display.threshold ?? standoffOf(footprintOf(a));
      rowFront.set(timeRank, Math.max(rowFront.get(timeRank) ?? 0, front));
    }
  }
  for (const anchorId of children.keys()) {
    const anchor = main.find((a) => a.id === anchorId);
    if (!anchor) continue;
    const timeRank = tRank.get(timeBin(anchor, cfg))!;
    for (const b of branchChain(anchorId, children)) rowDepth.set(timeRank, Math.max(rowDepth.get(timeRank) ?? 0, footprintOf(b).depth));
  }
  // A row with only a landmark in it is a stretch of clear lane with a pointer.
  for (const a of main) if (a.landmark) {
    const timeRank = tRank.get(timeBin(a, cfg))!;
    if (!rowDepth.has(timeRank)) rowDepth.set(timeRank, 0);
  }
  const rowZ = new Map<number, number>();
  const rowEdge = new Map<number, number>();
  {
    let z = 0;
    let prevDepth = 0;
    for (const timeRank of [...rowDepth.keys()].sort((p, q) => p - q)) {
      const depth = rowDepth.get(timeRank)!;
      if (timeRank === 0) {
        rowEdge.set(timeRank, cfg.cellPitchZ / 2);
      } else {
        const prevZ = z;
        z -= Math.max(cfg.cellPitchZ, prevDepth / 2 + cfg.rowGapZ + depth / 2, prevDepth / 2 + cfg.standingClearance + (rowFront.get(timeRank) ?? 0));
        rowEdge.set(timeRank, (prevZ - prevDepth / 2 + z + depth / 2) / 2);
      }
      rowZ.set(timeRank, z);
      prevDepth = depth;
    }
  }

  const placements = new Map<string, Placement>();
  const timeCounts = new Map<number, number>();
  const geoCounts = new Map<number, number>();
  const cellList: LayoutCell[] = [];
  const place = (a: Artwork, x: number, z: number, cell: { timeRank: number; geoRank: number }, branchOf?: string) => {
    const p: Placement = { id: a.id, position: new Vector3(x, 0, z), yaw: a.display.yaw ?? 0, cell };
    if (branchOf) p.branchOf = branchOf;
    placements.set(a.id, p);
  };

  for (const [key, members] of cells) {
    const [timeRank, geoRank] = key.split(":").map(Number) as [number, number];
    timeCounts.set(timeRank, (timeCounts.get(timeRank) ?? 0) + members.length);
    geoCounts.set(geoRank, (geoCounts.get(geoRank) ?? 0) + members.length);

    const row = rowCols.get(timeRank)!;
    const cx = (row.get(geoRank)! - (row.size - 1) / 2) * rowPitch.get(timeRank)!;
    const cz = rowZ.get(timeRank)!;
    const { cols, rows, pitchX, pitchZ, width, depth, height } = packed.get(key)!;
    const cell: LayoutCell = { timeRank, geoRank, x: cx, z: cz, width, depth, height, count: members.length };
    const thresholds = members.map((a) => a.display.threshold).filter((t): t is number => t != null);
    if (thresholds.length) cell.threshold = Math.max(...thresholds);
    cellList.push(cell);

    members.forEach((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cx + (col - (cols - 1) / 2) * pitchX;
      const z = cz + (row - (rows - 1) / 2) * pitchZ;
      place(a, x, z, { timeRank, geoRank });
    });
  }

  // Branches: east of the anchor's cell, one cell per step, packed tight.
  // Anything in the row east of the anchor moves over to make room, so the
  // anchor itself stays where the lane put it. Anchors west to east, so
  // the moves accumulate correctly.
  const anchors = main
    .filter((a) => children.has(a.id))
    .map((a) => ({ a, p: placements.get(a.id)! }))
    .sort((p, q) => p.p.position.x - q.p.position.x);
  for (const { a, p } of anchors) {
    const cell = cellList.find((c) => c.timeRank === p.cell.timeRank && c.geoRank === p.cell.geoRank && !c.branch)!;
    const chain = branchChain(a.id, children);
    let prevX = cell.x;
    let prevW = cell.width;
    const added: LayoutCell[] = [];
    for (const b of chain) {
      const fp = footprintOf(b);
      const w = fp.width + 2 * cfg.cellPadding;
      const x = prevX + Math.max(cfg.minPitchX, (prevW + w) / 2 + cfg.cellGap);
      const c: LayoutCell = {
        timeRank: cell.timeRank, geoRank: cell.geoRank, x, z: cell.z, width: w, depth: fp.depth, height: fp.height, count: 1,
        branch: { of: b.branch!.of, label: b.branch!.label },
      };
      added.push(c);
      place(b, x, cell.z, p.cell, b.branch!.of);
      prevX = x;
      prevW = w;
    }
    timeCounts.set(cell.timeRank, (timeCounts.get(cell.timeRank) ?? 0) + chain.length);
    // Make room: whatever stood east of the anchor's cell in this row moves
    // over by the chain's reach, or further if the last step is wider than
    // the row's cells.
    const shift = Math.max(prevX - cell.x, prevX + prevW / 2 - (cell.x + cell.width / 2));
    const inChain = new Set(chain.map((b) => b.id));
    for (const c of cellList) {
      if (c.timeRank === cell.timeRank && c.x > cell.x + 1e-6) c.x += shift;
    }
    for (const q of placements.values()) {
      if (q.cell.timeRank === cell.timeRank && !inChain.has(q.id) && q.position.x > cell.x + cell.width / 2 - 1e-6) {
        q.position.x += shift;
      }
    }
    cellList.push(...added);
  }

  // Landmarks: in their row, `distance` metres out to one side.
  for (const a of main) {
    if (!a.landmark) continue;
    const timeRank = tRank.get(timeBin(a, cfg))!;
    const geoRank = gRank.get(geoBin(a, cfg))!;
    const fp = footprintOf(a);
    const x = a.landmark.side === "east" ? a.landmark.distance : -a.landmark.distance;
    const z = rowZ.get(timeRank)!;
    cellList.push({
      timeRank, geoRank, x, z, width: fp.width + 2 * cfg.cellPadding, depth: fp.depth, height: fp.height, count: 1,
      landmark: { side: a.landmark.side, distance: a.landmark.distance, label: a.title },
    });
    place(a, x, z, { timeRank, geoRank });
    timeCounts.set(timeRank, (timeCounts.get(timeRank) ?? 0) + 1);
  }

  const timeAxis: AxisTick[] = [...tRank].map(([bin, rank]) => {
    const { year, month } = binStart(bin, cfg);
    return { rank, value: year, month, coord: rowZ.get(rank)!, edge: rowEdge.get(rank)!, count: timeCounts.get(rank) ?? 0 };
  });
  // Geography ticks give the order and counts; rows are compacted, so the
  // coord is where the column would sit in a full row.
  const geoMid = (gRank.size - 1) / 2;
  const geoAxis: AxisTick[] =
    cfg.geoBinDegrees == null
      ? []
      : [...gRank].map(([bin, rank]) => ({
          rank,
          value: Number.isFinite(bin) ? bin * cfg.geoBinDegrees! : Number.NaN,
          coord: (rank - geoMid) * cfg.cellPitchX,
          count: geoCounts.get(rank) ?? 0,
        }));

  return { placements, timeAxis, geoAxis, cells: cellList };
}
