import { describe, expect, it } from "vitest";
import collection from "../src/data/collection.json";
import { PROGRAMS } from "../src/sims/index";
import { PROGRAM_NAMES } from "../src/data/programs";
import { lintCollection } from "../src/data/lint";
import type { Artwork } from "../src/data/types";

const artworks = (collection as { artworks: Artwork[] }).artworks;

describe("the collection", () => {
  it("names only programs that exist", () => {
    expect(Object.keys(PROGRAMS).sort()).toEqual([...PROGRAM_NAMES].sort());
  });

  it("passes the lint with no errors", () => {
    const findings = lintCollection(artworks);
    const errors = findings.filter((f) => f.level === "error");
    const warns = findings.filter((f) => f.level === "warn");
    if (warns.length) console.log(warns.map((w) => `warn ${w.id} ${w.field}: ${w.message}`).join("\n"));
    expect(errors.map((e) => `${e.id} ${e.field}: ${e.message}`)).toEqual([]);
  });
});
