import { describe, expect, it } from "vitest";
import collection from "../src/data/collection.json";
import { resolveAt } from "../src/data/find";
import type { Artwork } from "../src/data/types";

const all = (collection as { artworks: Artwork[] }).artworks;

describe("?at=", () => {
  it("takes a slug, an alias or an id, in any case", () => {
    expect(all.find((a) => a.id === resolveAt(all, "stonehenge"))?.slug).toBe("stonehenge");
    expect(resolveAt(all, "ligo")).toBe("sim-gw150914-merger");
    expect(resolveAt(all, "LIGO")).toBe("sim-gw150914-merger");
    expect(resolveAt(all, "gw150914-merger")).toBe("sim-gw150914-merger");
    expect(resolveAt(all, "sim-gw150914-merger")).toBe("sim-gw150914-merger");
  });
  it("takes a year, and newest", () => {
    expect(all.find((a) => a.id === resolveAt(all, "1903"))?.slug).toBe("wright-flyer-1903");
    expect(resolveAt(all, "newest")).toBe(all.reduce((b, a) => (a.createdAt >= b.createdAt ? a : b)).id);
  });
  it("hands back what it cannot place", () => {
    expect(resolveAt(all, "no-such-work")).toBe("no-such-work");
  });
});
