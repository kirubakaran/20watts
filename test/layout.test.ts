import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeLayout, DEFAULT_LAYOUT, WORLD_LAYOUT, type Layout } from "../src/layout/layout";
import { footprintOf, onDisplay, type Artwork, type Collection } from "../src/data/types";
import { Navigator } from "../src/locomotion/navigate";
import type { Player } from "../src/locomotion/player";

const collection = JSON.parse(readFileSync(new URL("../src/data/collection.json", import.meta.url), "utf8")) as Collection;
const shown = onDisplay(collection.artworks);

/** A copy of a work with a new id, date and size, for synthetic collections. */
function variant(base: Artwork, id: string, year: number, month: number | null, widthM: number, extra: Partial<Artwork> = {}): Artwork {
  const a: Artwork = structuredClone(base);
  a.id = id;
  a.date = { ...a.date, year, month, day: null };
  a.physical = { widthCm: widthM * 100, heightCm: widthM * 60, depthCm: null, weightKg: null };
  delete a.branch;
  delete a.order;
  return Object.assign(a, extra);
}

function footprintRects(layout: Layout, works: Artwork[]) {
  return works.map((a) => {
    const p = layout.placements.get(a.id)!;
    const f = footprintOf(a);
    return { id: a.id, x0: p.position.x - f.width / 2, x1: p.position.x + f.width / 2, z0: p.position.z - f.depth / 2, z1: p.position.z + f.depth / 2 };
  });
}

function overlaps(layout: Layout, works: Artwork[]): string[] {
  const r = footprintRects(layout, works);
  const out: string[] = [];
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i]!, b = r[j]!;
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) out.push(`${a.id} / ${b.id}`);
    }
  return out;
}

describe("the collection on the lane", () => {
  const layout = computeLayout(shown);

  it("places every shown work, and nothing else", () => {
    expect([...layout.placements.keys()].sort()).toEqual(shown.map((a) => a.id).sort());
    const hidden = collection.artworks.filter((a) => a.moderation.status !== "approved");
    expect(hidden.length).toBeGreaterThan(0);
    for (const a of hidden) expect(layout.placements.has(a.id)).toBe(false);
  });

  it("is deterministic", () => {
    const again = computeLayout(shown);
    for (const [id, p] of layout.placements) expect(again.placements.get(id)!.position.toArray()).toEqual(p.position.toArray());
  });

  it("has no overlapping footprints", () => {
    expect(overlaps(layout, shown)).toEqual([]);
  });

  it("keeps every main-lane work on the spine unless it shares a month", () => {
    const main = shown.filter((a) => !a.branch && !a.landmark);
    for (const a of main) {
      const p = layout.placements.get(a.id)!;
      const sameMonth = main.filter((b) => b.date.year === a.date.year && (b.date.month ?? 0) === (a.date.month ?? 0));
      if (sameMonth.length === 1) expect(p.position.x, a.id).toBe(0);
    }
  });

  it("runs forward in time, row by row, with no geography axis", () => {
    const keyOf = (a: Artwork) => a.date.year * 13 + (a.date.month ?? 0);
    const main = shown.filter((a) => !a.branch).sort((p, q) => keyOf(p) - keyOf(q));
    let lastZ = Infinity;
    let lastKey = -Infinity;
    for (const a of main) {
      const p = layout.placements.get(a.id)!;
      const key = keyOf(a);
      if (key > lastKey) expect(p.position.z).toBeLessThan(lastZ);
      else expect(p.position.z).toBe(lastZ);
      lastZ = p.position.z;
      lastKey = key;
    }
    expect(layout.geoAxis).toEqual([]);
  });

  it("stands the 6502 beside the Apple IIc, and its die beside the 6502, in the IIc's row", () => {
    const iic = layout.placements.get("wm-11118452")!;
    const chip = layout.placements.get("wm-153446594")!;
    const die = layout.placements.get("wm-53469085")!;
    expect(chip.position.z).toBe(iic.position.z);
    expect(die.position.z).toBe(iic.position.z);
    expect(chip.position.x).toBeGreaterThan(iic.position.x);
    expect(die.position.x).toBeGreaterThan(chip.position.x);
    expect(chip.branchOf).toBe("wm-11118452");
    expect(die.branchOf).toBe("wm-153446594");
    const labels = layout.cells.filter((c) => c.branch && ["wm-11118452", "wm-153446594"].includes(c.branch.of)).map((c) => c.branch!.label);
    expect(labels).toEqual(["the chip inside", "inside the chip"]);
  });
});

describe("synthetic collections", () => {
  const base = shown.find((a) => a.kind === "image" && !a.branch)!;

  it("orders works of one month by day, then hand-set order, then importance, west to east", () => {
    const works = [
      variant(base, "c", 1990, 6, 1, { importance: 0.9 }),
      variant(base, "b", 1990, 6, 1, { importance: 0.5, order: 2 }),
      variant(base, "a", 1990, 6, 1, { importance: 0.1, order: 1 }),
      variant(base, "d", 1990, 6, 1, { importance: 0.5 }),
    ];
    works[3]!.date.day = 20;
    const l = computeLayout(works);
    const xs = ["a", "b", "c", "d"].map((id) => l.placements.get(id)!.position.x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    expect(new Set(works.map((w) => l.placements.get(w.id)!.position.z)).size).toBe(1);
  });

  it("packs tiny and huge works without overlap, on the lane and in the world view", () => {
    const works = [
      variant(base, "tiny", 1900, null, 0.1),
      variant(base, "huge", 1900, null, 30),
      variant(base, "mid", 1900, 3, 2),
      variant(base, "next", 1901, null, 1),
      variant(base, "far", 2000, 1, 12),
    ];
    works[1]!.madeIn.point = { lat: 0, lon: 100 };
    for (const cfg of [DEFAULT_LAYOUT, WORLD_LAYOUT]) {
      const l = computeLayout(works, cfg);
      expect(overlaps(l, works)).toEqual([]);
    }
  });

  it("hangs a chain off the east edge of the anchor's cell, and moves the rest of the row over", () => {
    const works = [
      variant(base, "anchor", 1990, 6, 1, { order: 1 }),
      variant(base, "neighbour", 1990, 6, 1, { order: 2 }),
      variant(base, "step1", 1950, null, 8, { branch: { of: "anchor", step: 1, label: "one" } }),
      variant(base, "step2", 1950, null, 1, { branch: { of: "step1", step: 1, label: "two" } }),
      variant(base, "elsewhere", 1990, 6, 1, { order: 3 }),
    ];
    // In the world view the third work is a cell of its own, east of the anchor's.
    works[4]!.madeIn.point = { lat: 0, lon: 100 };
    const l = computeLayout(works, WORLD_LAYOUT);
    expect(overlaps(l, works)).toEqual([]);
    const x = (id: string) => l.placements.get(id)!.position.x;
    // A chain hangs off the cell, which holds every work of that month: anchor, then its neighbour, then the steps.
    expect(x("neighbour")).toBeGreaterThan(x("anchor"));
    expect(x("step1")).toBeGreaterThan(x("neighbour"));
    expect(x("step2")).toBeGreaterThan(x("step1"));
    expect(x("elsewhere")).toBeGreaterThan(x("step2"));
    // The anchor itself stands where it would without its branches.
    const without = computeLayout(works.filter((w) => !w.branch), WORLD_LAYOUT);
    expect(x("anchor")).toBe(without.placements.get("anchor")!.position.x);
  });

  it("spaces rows by depth so a building does not reach into its neighbours", () => {
    const model = shown.find((a) => a.kind === "model" && !a.branch)!;
    const building = structuredClone(model);
    building.id = "building";
    building.date = { ...building.date, year: 1850, month: null, day: null };
    delete building.branch;
    const v = building.asset.versions[0] as { bounds: { width: number; height: number; depth: number } };
    v.bounds = { width: 40, height: 30, depth: 60 };
    building.display = { ...building.display, threshold: 33 };
    const works = [variant(base, "before", 1840, null, 2), building, variant(base, "after", 1860, null, 2)];
    const l = computeLayout(works);
    const z = (id: string) => l.placements.get(id)!.position.z;
    expect(z("before") - z("building")).toBeGreaterThanOrEqual(0.25 + 8 + 30);
    expect(z("building") - z("after")).toBeGreaterThanOrEqual(30 + 8 + 0.25);
    expect(overlaps(l, works)).toEqual([]);
    expect(l.cells.find((c) => c.z === z("building"))!.threshold).toBe(33);
    // The era labels sit between the rows' extents.
    const edges = l.timeAxis.map((t) => t.edge!);
    expect(edges[1]).toBeLessThan(z("before"));
    expect(edges[1]).toBeGreaterThan(z("building") + 30);
  });

  it("stands a landmark off to the side without deepening its row, with a pointer on the lane", () => {
    const sim = shown.find((a) => a.kind === "sim" && a.landmark)!;
    const pyramid = structuredClone(sim);
    pyramid.id = "pyramid";
    pyramid.date = { ...pyramid.date, year: 1850, month: null, day: null };
    pyramid.landmark = { side: "west", distance: 300 };
    const works = [variant(base, "before", 1840, null, 2), pyramid, variant(base, "after", 1860, null, 2)];
    const l = computeLayout(works);
    const z = (id: string) => l.placements.get(id)!.position.z;
    const p = l.placements.get("pyramid")!.position;
    expect(p.x).toBe(-300);
    expect(z("before") - p.z).toBe(DEFAULT_LAYOUT.cellPitchZ);
    expect(p.z - z("after")).toBe(DEFAULT_LAYOUT.cellPitchZ);
    const cell = l.cells.find((c) => c.landmark)!;
    expect(cell.landmark!.label).toBe(pyramid.title);
    expect(l.timeAxis.map((t) => t.value)).toEqual([1840, 1850, 1860]);
    // Hops: the era hop stops on the lane at its year; a sideways hop goes out to its foot and back.
    const stops = works.map((a) => ({ id: a.id, x: l.placements.get(a.id)!.position.x, z: l.placements.get(a.id)!.position.z, footprint: footprintOf(a) }));
    const n = new Navigator(l, stops);
    const pos = { x: 0, z: 0 };
    const walker = { floorPosition: () => pos, teleport: (x: number, zz: number) => { pos.x = x; pos.z = zz; } } as unknown as Player;
    n.goTo(walker, "before");
    expect(n.hopEra(walker, 1)).toBe(true);
    expect(pos.x).toBe(0);
    expect(pos.z).toBe(p.z + 2.5);
    expect(n.hopGeo(walker, -1)).toBe(true);
    expect(pos.x).toBe(-300);
    expect(pos.z).toBeGreaterThan(p.z + 230 / 2);
    expect(n.hopGeo(walker, 1)).toBe(true);
    expect(pos.x).toBe(0);
    expect(n.hopEra(walker, 1)).toBe(true);
    expect(pos.z).toBeLessThan(z("after") + 10);
  });

  it("leaves a branch whose anchor is not shown off the floor", () => {
    const works = [...shown, variant(base, "orphan", 1990, 6, 1, { branch: { of: "nope", step: 1, label: "x" } })];
    expect(onDisplay(works).map((a) => a.id)).not.toContain("orphan");
  });
});

describe("hops", () => {
  const layout = computeLayout(shown);
  const stops = shown.map((a) => {
    const p = layout.placements.get(a.id)!.position;
    return { id: a.id, x: p.x, z: p.z, footprint: footprintOf(a) };
  });
  const nav = new Navigator(layout, stops);
  const player = {
    x: 0, z: 0,
    floorPosition() { return { x: this.x, z: this.z }; },
    teleport(x: number, z: number) { this.x = x; this.z = z; },
  };
  const fake = player as unknown as Parameters<Navigator["goTo"]>[0];

  it("walks every row forward then back", () => {
    const rows = new Set(layout.cells.map((c) => c.timeRank)).size;
    nav.goTo(fake, shown[0]!.id);
    let n = 0;
    while (nav.hopEra(fake, 1)) n++;
    expect(n).toBe(rows - 1);
    let m = 0;
    while (nav.hopEra(fake, -1)) m++;
    expect(m).toBe(rows - 1);
  });

  it("stands at the door of a work with a threshold", () => {
    const model = shown.find((a) => a.kind === "model" && !a.branch)!;
    const l = computeLayout(shown);
    const p = l.placements.get(model.id)!.position;
    const n = new Navigator(l, [{ id: model.id, x: p.x, z: p.z, footprint: footprintOf(model), threshold: 21 }]);
    expect(n.standingPoint(model.id)).toEqual({ x: p.x, z: p.z + 21 });
  });

  it("goes sideways from the Apple IIc to the chip, to the die, and no further", () => {
    nav.goTo(fake, "wm-11118452");
    const x0 = player.x;
    expect(nav.hopGeo(fake, 1)).toBe(true);
    expect(player.x).toBeGreaterThan(x0);
    expect(nav.hopGeo(fake, 1)).toBe(true);
    expect(nav.hopGeo(fake, 1)).toBe(false);
    expect(nav.hopGeo(fake, -1)).toBe(true);
    expect(nav.hopGeo(fake, -1)).toBe(true);
    expect(player.x).toBe(x0);
    expect(nav.hopGeo(fake, -1)).toBe(false);
  });
});
