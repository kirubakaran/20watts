import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentSimVersion, footprintOf, grabbable, onDisplay, type Collection } from "../src/data/types";
import { PROGRAMS } from "../src/sims";

const collection = JSON.parse(readFileSync(new URL("../src/data/collection.json", import.meta.url), "utf8")) as Collection;
const shown = onDisplay(collection.artworks);

describe("simulations", () => {
  const sims = shown.filter((a) => a.kind === "sim");

  it("has a program for every sim work in the catalogue", () => {
    expect(sims.length).toBeGreaterThan(0);
    for (const a of sims) {
      const v = currentSimVersion(a)!;
      expect(PROGRAMS[v.program], `${a.id} wants program ${v.program}`).toBeDefined();
      expect(v.provenance).toBe("procedural");
    }
  });

  it("takes its footprint from the version's bounds", () => {
    for (const a of sims) {
      const v = currentSimVersion(a)!;
      expect(footprintOf(a)).toEqual({ width: v.bounds.width * a.display.scale, depth: v.bounds.depth * a.display.scale, height: v.bounds.height * a.display.scale });
    }
  });

  it("is never picked up unless the record says so", () => {
    for (const a of sims) expect(grabbable(a)).toBe(a.display.grab === true);
  });
});

describe("picking up", () => {
  it("allows small models only, never buildings, images or landmarks", () => {
    for (const a of shown) {
      if (a.display.grab != null) continue;
      const fp = footprintOf(a);
      const small = a.kind === "model" && Math.max(fp.width, fp.height, fp.depth) <= 1.2;
      const expected = small && a.display.threshold == null && !a.landmark;
      expect(grabbable(a), a.id).toBe(expected);
    }
  });
});
