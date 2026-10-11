/**
 * Where a work stands: `npm run where <id or title fragment>` prints the
 * record's row, position, standing point and neighbours, so a check needs
 * no browser. With no argument it lists the whole lane in order.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeLayout, standoffOf } from "../../src/layout/layout";
import { baseHeightOf, footprintOf } from "../../src/data/types";
import type { Artwork, Collection } from "../../src/data/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const c = JSON.parse(await readFile(path.join(ROOT, "src/data/collection.json"), "utf8")) as Collection;
const shown = c.artworks.filter((a) => a.moderation.status === "approved");
const layout = computeLayout(shown);
const query = process.argv.slice(2).join(" ").toLowerCase();

const line = (a: Artwork) => {
  const p = layout.placements.get(a.id)!;
  const fp = footprintOf(a);
  const where = a.landmark ? `landmark ${a.landmark.side} ${a.landmark.distance} m` : a.branch ? `branch of ${a.branch.of} step ${a.branch.step}` : "lane";
  return `${String(p.position.z.toFixed(0)).padStart(6)} ${String(p.position.x.toFixed(0)).padStart(5)}  ${String(a.date.year).padStart(7)}  ${a.id.padEnd(38)} ${a.title}  [${where}]`;
};

const rows = [...shown].sort((p, q) => layout.placements.get(q.id)!.position.z - layout.placements.get(p.id)!.position.z || layout.placements.get(p.id)!.position.x - layout.placements.get(q.id)!.position.x);
if (!query) {
  console.log("     z     x     year  id                                     title");
  for (const a of rows) console.log(line(a));
  process.exit(0);
}

const hits = shown.filter((a) => a.id.toLowerCase() === query || a.id.toLowerCase().includes(query) || a.title.toLowerCase().includes(query));
if (!hits.length) { console.error(`nothing called ${query}`); process.exit(1); }
for (const a of hits) {
  const p = layout.placements.get(a.id)!;
  const fp = footprintOf(a);
  const foot = a.landmark
    ? { x: p.position.x, z: p.position.z + fp.depth / 2 + Math.max(10, (fp.height + (baseHeightOf(a) ?? 0)) * 0.8) }
    : { x: p.position.x, z: p.position.z + (a.display.threshold ?? standoffOf(fp)) };
  console.log(`${a.title}  (${a.id})`);
  console.log(`  at x ${p.position.x.toFixed(1)}, z ${p.position.z.toFixed(1)}; row ${p.cell.timeRank}; ${fp.width.toFixed(1)} × ${fp.height.toFixed(1)} × ${fp.depth.toFixed(1)} m, base ${baseHeightOf(a) ?? "eye-centred"}`);
  console.log(`  stand at x ${foot.x.toFixed(1)}, z ${foot.z.toFixed(1)}  ->  ?spawn=${foot.x.toFixed(1)},${foot.z.toFixed(1)},0   or   ?at=${a.id}`);
  const i = rows.indexOf(a);
  const near = rows.slice(Math.max(0, i - 3), i + 4).filter((b) => b !== a);
  console.log("  nearby:");
  for (const b of near) console.log("   " + line(b));
}
