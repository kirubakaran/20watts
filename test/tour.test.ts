import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { onDisplay, type Collection } from "../src/data/types";
import { tourOf } from "../src/world/tour";

const collection = JSON.parse(readFileSync(new URL("../src/data/collection.json", import.meta.url), "utf8")) as Collection;
const visible = onDisplay(collection.artworks);
const shown = new Map(visible.map((a) => [a.id, a]));
const TOUR = tourOf(visible);

describe("the guided visit", () => {
  it("names only works on display, each once, in the order of the lane", () => {
    const ids = TOUR.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(shown.has(id), id).toBe(true);
    // Forward in time, so the visitor never doubles back; a branch counts as its anchor's year.
    const years = ids.map((id) => {
      const a = shown.get(id)!;
      const anchor = a.branch ? shown.get(a.branch.of) : null;
      return (anchor ?? a).date.year;
    });
    for (let i = 1; i < years.length; i++) expect(years[i]!, `${ids[i]} after ${ids[i - 1]}`).toBeGreaterThanOrEqual(years[i - 1]!);
  });

  it("says something about every stop, and has stops", () => {
    expect(TOUR.length).toBeGreaterThan(20);
    for (const s of TOUR) expect(s.line.length, s.id).toBeGreaterThan(20);
  });
});
