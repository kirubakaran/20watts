/**
 * What a record must get right before it is shown: the checks that a
 * reviewer would otherwise make by eye. Pure, so the test suite runs them
 * over the collection and the future backend runs them over a contribution
 * before it is even queued. Each finding names the record, the field and
 * what is wrong; "error" blocks, "warn" is for a person to weigh.
 */
import type { Artwork } from "./types";
import { PROGRAM_NAMES } from "./programs";

export interface Finding {
  id: string;
  level: "error" | "warn";
  field: string;
  message: string;
}

const MAX_TITLE = 48;

export function lintArtwork(a: Artwork, all: Map<string, Artwork>): Finding[] {
  const out: Finding[] = [];
  const err = (field: string, message: string) => out.push({ id: a.id, level: "error", field, message });
  const warn = (field: string, message: string) => out.push({ id: a.id, level: "warn", field, message });

  // Titles are names. Everything else goes in the description.
  if (!a.title.trim()) err("title", "empty");
  if (/[()\[\]]/.test(a.title)) err("title", "has brackets; put the detail in the description");
  if (/:\s/.test(a.title)) warn("title", "has a colon; a subtitle belongs in the description");
  if (a.title.length > MAX_TITLE) warn("title", `${a.title.length} characters; over ${MAX_TITLE} reads as a sentence on a tag`);
  if (/\b(replica|facsimile|cast|reconstruction|detail|cropped)\b/i.test(a.title) && !/^David, after/.test(a.title)) warn("title", "says what the file is rather than what the work is; the description should carry that");

  // The visitor reads the description; it must exist and say the things the title no longer does.
  if (a.description.trim().length < 120) err("description", "shorter than two sentences");
  if (a.kind === "sim" && a.asset.kind === "sim" && a.asset.versions[0]?.program !== "pyramid"
    && !/as you watch|not a picture|not a film|not a recording|not drawn|not an image|running now|computed live/i.test(a.description)) {
    warn("description", "a simulation should say that it is being computed as the visitor watches");
  }
  if (!a.date.label) err("date.label", "missing");
  if (!Number.isFinite(a.date.year)) err("date.year", "missing");

  // Credit: every file has a licence and a source page; public domain needs no author.
  const versions = a.asset.versions;
  if (!versions.length) err("asset", "no versions");
  for (const v of versions) {
    if (!v.credit.license.name) err("asset.credit.license", "no licence");
    if (/NC|ND/i.test(v.credit.license.name) && !/non-commercial allowed/i.test(v.contributed.note ?? "")) err("asset.credit.license", `${v.credit.license.name} is not a free licence`);
    if (!v.contributed.note) warn("asset.contributed.note", "no provenance note; say where the file came from and how it was checked");
  }
  if (a.asset.kind === "image" || a.asset.kind === "model") {
    const v = a.asset.versions[0]!;
    if (a.moderation.status === "approved" && v.rungs.length === 0) err("asset.rungs", "nothing built; run the asset pipeline");
  }
  if (a.asset.kind === "model") {
    const b = a.asset.versions[0]!.bounds;
    if (b.width <= 0 || b.height <= 0 || b.depth <= 0) err("asset.bounds", "empty bounds");
    if (b.width === 1 && b.height === 1 && b.depth === 1) err("asset.bounds", "placeholder bounds; the pipeline has not measured it");
  }
  if (a.asset.kind === "sim") {
    const v = a.asset.versions[0]!;
    if (!PROGRAM_NAMES.includes(v.program)) err("asset.program", `no program called ${v.program}`);
    if (v.bounds.width <= 0 || v.bounds.height <= 0) err("asset.bounds", "empty bounds");
  }

  // Standing: hints that contradict each other or point at nothing.
  if (a.landmark && a.landmark.distance < 20) err("landmark.distance", "a landmark stands at least 20 m off the lane");
  if (a.landmark && a.branch) err("landmark", "a landmark cannot also be a branch");
  if (a.branch) {
    if (!all.has(a.branch.of)) err("branch.of", `no such work ${a.branch.of}`);
    if (a.branch.step === 0) err("branch.step", "0; steps count outward from 1, negative to the west");
    if (!a.branch.label) warn("branch.label", "no floor label");
  }
  if (a.display.sky && a.display.sky.radius <= 0) err("display.sky.radius", "no radius");
  if (a.display.spin != null && a.display.spin <= 0) err("display.spin", "seconds per turn must be positive");
  if (a.display.scale <= 0) err("display.scale", "not positive");
  if (a.kind === "image" && a.display.scale > 1 && a.physical.widthCm == null) warn("display.scale", "scaled, but no size to scale from");
  if (a.importance != null && (a.importance < 0 || a.importance > 1)) err("importance", "outside 0 to 1");
  // Fair use is a decision a person makes, not a flag a contributor sets.
  if (a.copyrighted && !a.moderation.reviewedBy) err("copyrighted", "a copyrighted work needs a reviewer named in moderation.reviewedBy, with the reason");
  if (a.copyrighted && !a.moderation.flags.includes("fair-use")) err("copyrighted", "a copyrighted work must carry the fair-use flag");
  if (a.tour != null && a.tour.trim().length < 20) err("tour", "a tour line is at least a sentence");
  if (a.tour && /\b(museum|lane|the row|hop|placard|card)\b/i.test(a.tour)) warn("tour", "a tour line is about the work, not about the museum");
  if (a.audio) {
    const v = a.audio.versions[0]!;
    if (!v.credit.license.name) err("audio.credit.license", "no licence");
    if (a.moderation.status === "approved" && !v.encoded) err("audio.encoded", "excerpt not built; run the asset pipeline");
  }
  return out;
}

export function lintCollection(artworks: Artwork[]): Finding[] {
  const all = new Map(artworks.map((a) => [a.id, a]));
  const out: Finding[] = [];
  const seen = new Map<string, string>();
  for (const a of artworks) {
    out.push(...lintArtwork(a, all));
    if (a.moderation.status !== "approved") continue;
    const key = a.title.toLowerCase();
    if (seen.has(key)) out.push({ id: a.id, level: "warn", field: "title", message: `same title as ${seen.get(key)}` });
    else seen.set(key, a.id);
  }
  return out;
}
