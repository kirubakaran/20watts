/**
 * Layout: maps artworks onto the ground plane.
 *
 *   forward/back (world -Z / +Z)  = time, future is forward (-Z)
 *   left/right   (world -X / +X)  = geography, west is left, east is right
 *
 * Both axes are ORDERED, not to scale. Works are binned (decades, degrees of
 * longitude), distinct non-empty bins are ranked, and each rank becomes one
 * cell. Empty stretches of time or space simply do not exist in the world.
 * Within a cell, works are packed in a small grid, most important first.
 *
 * Only this module knows about time and geography. The renderer only sees
 * positions, yaws and footprints.
 */
import { Vector3 } from "three";
import type { Artwork } from "../data/types";
import { footprintOf } from "../data/types";

export interface LayoutConfig {
  /** Years per time bin. */
  timeBinYears: number;
  /** Degrees of longitude per geography bin. */
  geoBinDegrees: number;
  /** Distance between adjacent time cells, metres. */
  cellPitchZ: number;
  /** Distance between adjacent geography cells, metres. */
  cellPitchX: number;
  /** Clear space between works inside a cell, metres. */
  itemGap: number;
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  timeBinYears: 10,
  geoBinDegrees: 5,
  cellPitchZ: 16,
  cellPitchX: 16,
  itemGap: 2,
};

export interface Placement {
  id: string;
  position: Vector3;
  /** Rotation about Y. 0 faces +Z, i.e. toward a visitor arriving from the past. */
  yaw: number;
  cell: { timeRank: number; geoRank: number };
}

export interface AxisTick {
  rank: number;
  /** Bin start value (year, or degrees of longitude). */
  value: number;
  /** World coordinate of the cell centre on that axis. */
  coord: number;
  count: number;
}

export interface Layout {
  placements: Map<string, Placement>;
  timeAxis: AxisTick[];
  geoAxis: AxisTick[];
}

/** Works with no known longitude go in a bin past the eastern edge. */
const UNKNOWN_GEO_BIN = Number.POSITIVE_INFINITY;

function timeBin(a: Artwork, cfg: LayoutConfig): number {
  return Math.floor(a.date.year / cfg.timeBinYears);
}

function geoBin(a: Artwork, cfg: LayoutConfig): number {
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

export function computeLayout(artworks: Artwork[], cfg: LayoutConfig = DEFAULT_LAYOUT): Layout {
  const tBins = artworks.map((a) => timeBin(a, cfg));
  const gBins = artworks.map((a) => geoBin(a, cfg));
  const tRank = rankBins(tBins);
  const gRank = rankBins(gBins);

  // Group into cells.
  const cells = new Map<string, Artwork[]>();
  artworks.forEach((a, i) => {
    const key = `${tRank.get(tBins[i]!)}:${gRank.get(gBins[i]!)}`;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(a);
  });

  const placements = new Map<string, Placement>();
  const timeCounts = new Map<number, number>();
  const geoCounts = new Map<number, number>();

  for (const [key, members] of cells) {
    const [timeRank, geoRank] = key.split(":").map(Number) as [number, number];
    timeCounts.set(timeRank, (timeCounts.get(timeRank) ?? 0) + members.length);
    geoCounts.set(geoRank, (geoCounts.get(geoRank) ?? 0) + members.length);

    const cx = geoRank * cfg.cellPitchX;
    const cz = -timeRank * cfg.cellPitchZ;

    // Pack members in a square-ish grid, most important at the centre first.
    members.sort((p, q) => importanceOf(q) - importanceOf(p));
    const fps = members.map(footprintOf);
    const pitchX = Math.max(...fps.map((f) => f.width)) + cfg.itemGap;
    const pitchZ = Math.max(...fps.map((f) => f.depth)) + cfg.itemGap;
    const cols = Math.ceil(Math.sqrt(members.length));
    const rows = Math.ceil(members.length / cols);

    members.forEach((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cx + (col - (cols - 1) / 2) * pitchX;
      const z = cz + (row - (rows - 1) / 2) * pitchZ;
      placements.set(a.id, {
        id: a.id,
        position: new Vector3(x, 0, z),
        yaw: a.display.yaw ?? 0,
        cell: { timeRank, geoRank },
      });
    });
  }

  const timeAxis: AxisTick[] = [...tRank].map(([bin, rank]) => ({
    rank,
    value: bin * cfg.timeBinYears,
    coord: -rank * cfg.cellPitchZ,
    count: timeCounts.get(rank) ?? 0,
  }));
  const geoAxis: AxisTick[] = [...gRank].map(([bin, rank]) => ({
    rank,
    value: Number.isFinite(bin) ? bin * cfg.geoBinDegrees : Number.NaN,
    coord: rank * cfg.cellPitchX,
    count: geoCounts.get(rank) ?? 0,
  }));

  return { placements, timeAxis, geoAxis };
}
