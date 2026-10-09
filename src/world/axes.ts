/**
 * Axis cues stencilled on the floor. The time axis is ordered, not to
 * scale, so the only honest cue is a label: the era printed on the
 * boundary line you cross when you step into a new year. A branch step
 * carries its label at its front edge, so a side quest reads as one. In the
 * world view, the longitude is printed at the front edge of each cell.
 * Nothing is drawn where nothing stands.
 */
import { Group } from "three";
import { Text } from "troika-three-text";
import type { Layout, LayoutConfig } from "../layout/layout";
import { DEFAULT_LAYOUT } from "../layout/layout";

const FONT = "/fonts/inter-600.woff";
const INK = 0x5e584e;

/** "35,000 BCE", "c. 200 BCE", "1495", "1490s" for decade bins, "1.5 million years ago". */
export function eraLabel(year: number, binMonths: number): string {
  if (year <= -1_000_000) return `${(-year / 1_000_000).toFixed(1).replace(/\.0$/, "")} million years ago`;
  if (year <= -100_000) return `${(-year).toLocaleString("en-US")} years ago`;
  if (year < 0) return `${year <= -10_000 ? "" : "c. "}${(-year).toLocaleString("en-US")} BCE`;
  if (year === 0) return "1 CE";
  if (binMonths >= 120) return `${year}s`;
  return `${year}`;
}

/** "120°W", "0°", "5°E". */
export function longitudeLabel(binStart: number): string | null {
  if (!Number.isFinite(binStart)) return null;
  if (binStart === 0) return "0°";
  return `${Math.abs(binStart)}°${binStart < 0 ? "W" : "E"}`;
}

function stencil(text: string, size: number, anchorY: "top" | "bottom"): Text {
  const t = new Text();
  t.text = text;
  t.font = FONT;
  t.fontSize = size;
  t.color = INK;
  t.fillOpacity = 0.55;
  t.anchorX = "center";
  t.anchorY = anchorY;
  // Flat on the floor, reading for a visitor who faces the future (-Z).
  t.rotation.x = -Math.PI / 2;
  t.position.y = 0.004;
  // Pull the glyphs toward the camera in depth so they never fight the floor.
  t.depthOffset = -1;
  t.sync();
  return t;
}

export function buildAxisCues(layout: Layout, cfg: LayoutConfig = DEFAULT_LAYOUT): Group {
  const g = new Group();
  g.name = "axis-cues";
  const edgeOf = new Map(layout.timeAxis.map((t) => [t.rank, t.edge ?? t.coord + cfg.cellPitchZ / 2]));

  // Era: on the near boundary of a row, centred on the spine, hanging into
  // the row. Rows are months, but a month is almost never what matters, so
  // the label is the year, written once, on the first row of that year.
  let last = "";
  for (const tick of layout.timeAxis) {
    const label = eraLabel(tick.value, cfg.timeBinMonths);
    if (label === last) continue;
    last = label;
    const t = stencil(label, 0.7, "top");
    t.position.set(0, t.position.y, (tick.edge ?? tick.coord + cfg.cellPitchZ / 2) - 0.5);
    g.add(t);
  }

  // Branch steps: the label at the front edge, small.
  // World view: the longitude at the front edge of each cell.
  const lonByRank = new Map(layout.geoAxis.map((t) => [t.rank, t.value]));
  for (const cell of layout.cells) {
    const label = cell.branch ? cell.branch.label : longitudeLabel(lonByRank.get(cell.geoRank) ?? Number.NaN);
    if (!label) continue;
    const t = stencil(label, 0.3, "bottom");
    t.position.set(cell.x, t.position.y, edgeOf.get(cell.timeRank)! - 0.5);
    g.add(t);
  }
  return g;
}
