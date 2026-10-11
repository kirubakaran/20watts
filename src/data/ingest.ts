/**
 * Items to records. `ingest(item, existing)` builds the Artwork record for an
 * item from scratch and then keeps, from the record already in the
 * collection, only what the asset pipeline put there: rungs, bounds,
 * measured bytes and sizes, the encoded excerpt, the creation date. So an
 * item is the single source of truth for everything a person writes, and
 * re-running the ingest after an edit changes exactly that edit.
 *
 * Pure: no files, no clock beyond `now`. The future backend runs the same
 * function on a contribution.
 */
import type {
  Artwork, AudioAsset, AudioVersion, Credit, DisplayHints, ImageAsset, ImageVersion, License, ModelAsset, ModelVersion, Moderation, SimAsset,
} from "./types";
import type { Item, ItemAlternate, ItemAudio } from "./item";

const LICENSE_URLS: Record<string, string> = {
  "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "cc by 2.0": "https://creativecommons.org/licenses/by/2.0/",
  "cc by 2.5": "https://creativecommons.org/licenses/by/2.5/",
  "cc by 3.0": "https://creativecommons.org/licenses/by/3.0/",
  "cc by 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "cc by-sa 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
  "cc by-sa 2.5": "https://creativecommons.org/licenses/by-sa/2.5/",
  "cc by-sa 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "cc by-sa 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
};

const approved = (flags: string[] = []): Moderation => ({ status: "approved", reviewedBy: null, reviewedAt: null, reason: null, flags });

function licenseOf(src: { licenseName?: string | null; licenseUrl?: string | null }): License {
  let name = src.licenseName || "Public domain";
  let url = src.licenseUrl || LICENSE_URLS[name.toLowerCase()] || null;
  const lower = name.toLowerCase();
  if (["pd", "public domain", "pd-art", "pd-old"].includes(lower)) { name = "Public domain"; url = null; }
  if (lower.startsWith("cc0")) name = "CC0 1.0";
  return { name, url };
}

/** The record id an item gets: stable, from the source's own id where it has one. */
export function artworkIdOf(item: Item): string {
  const s = item.source;
  switch (s.type) {
    case "commons": return `wm-${s.curid}`;
    case "video-still": if (s.curid) return `wm-${s.curid}`; break;
    case "met": return `met-${s.curid}`;
    case "cma": return `cma-${s.curid}`;
    case "smithsonian-3d": {
      const m = /document\/([0-9a-f-]+)\/document\.json/.exec(s.url ?? "");
      return `si-${s.curid ?? m?.[1]}`;
    }
    case "sketchfab": return `sf-${s.curid}`;
    case "zenodo": return `zen-${s.curid}`;
    case "nasa": return `nasa-${s.curid}`;
    case "youtube": return `yt-${s.curid}`;
    case "typeset": return `eq-${item.slug}`;
    case "procedural": return `sim-${item.slug}`;
  }
  return `usr-${item.slug}`;
}

function precisionOf(o: Item["object"]): Artwork["date"]["precision"] {
  if (o.datePrecision) return o.datePrecision;
  if (o.yearStart != null && o.yearEnd != null && o.yearStart !== o.yearEnd) return "circa";
  return Math.abs(o.year) < 5000 ? "year" : "circa";
}

function audioAsset(aid: string, au: ItemAudio, now: string): AudioAsset {
  const vid = `${aid}-audio-v1`;
  const version: AudioVersion = {
    id: vid,
    original: { url: au.url, bytes: au.bytes ?? null, mime: au.mime || "audio/mpeg", seconds: au.seconds ?? null },
    encoded: null,
    start: au.start ?? 0,
    seconds: au.excerptSeconds ?? null,
    performers: au.performers ?? null,
    credit: { author: au.author ?? null, license: licenseOf(au), sourcePage: au.sourcePage ?? null },
    contributed: { by: null, at: now, note: au.notes ?? null },
    moderation: approved(),
    provenance: au.type === "commons" ? "wikimedia-commons" : au.type,
  };
  return { currentVersionId: vid, versions: [version] };
}

function alternateAsset(aid: string, n: number, alt: ItemAlternate, now: string): ImageAsset {
  const vid = `${aid}-alt${n}-v1`;
  return {
    kind: "image",
    currentVersionId: vid,
    versions: [{
      id: vid,
      original: { url: alt.url, width: alt.width, height: alt.height, bytes: alt.bytes ?? null, mime: alt.mime || "image/jpeg" },
      rungs: [],
      loop: null,
      credit: { author: alt.author ?? null, license: licenseOf(alt), sourcePage: alt.sourcePage ?? null },
      contributed: { by: null, at: now, note: alt.notes ?? null },
      moderation: approved(),
      provenance: "wikimedia-commons",
    }],
  };
}

/** The record an item describes, before anything the pipeline adds. */
export function recordOf(item: Item, now: string): Artwork {
  const s = item.source;
  const o = item.object;
  const aid = artworkIdOf(item);
  const made = o.madeIn;
  const loc = o.location ?? {};
  const cr = o.creator;
  const credit: Credit = { author: s.author ?? null, license: licenseOf(s), sourcePage: s.sourcePage ?? null };
  const contributed = { by: null, at: now, note: s.notes || `Import from ${s.type}` };
  const externalIds: Record<string, string> = {};
  if (s.type === "commons") {
    externalIds["commons-curid"] = String(s.curid);
    externalIds["commons-file"] = (s.fileTitle ?? "").replace(/^File:/, "");
  } else if (s.curid) externalIds[s.type] = String(s.curid);
  Object.assign(externalIds, item.externalIds ?? {});

  let asset: ImageAsset | ModelAsset | SimAsset;
  let display: DisplayHints;
  let physical: Artwork["physical"];
  const size = { widthCm: o.widthCm ?? null, heightCm: o.heightCm ?? null, depthCm: o.depthCm ?? null, weightKg: o.weightKg ?? null };
  if (item.kind === "image") {
    const version: ImageVersion = {
      id: `${aid}-v1`,
      original: s.type === "typeset"
        ? { url: `data/originals/${aid}/equation.svg`, width: 0, height: 0, bytes: null, mime: "image/svg+xml", tex: s.tex ?? "", ...(s.figure ? { figure: s.figure } : {}) }
        : { url: s.url ?? "", width: s.width ?? 0, height: s.height ?? 0, bytes: s.bytes ?? null, mime: s.mime || "image/jpeg" },
      rungs: [],
      loop: item.loop ?? null,
      credit,
      contributed,
      moderation: item.moderation ?? approved(item.flags ?? []),
      provenance: s.type === "commons" ? "wikimedia-commons" : s.type === "youtube" ? "video-still" : s.type,
    };
    asset = { kind: "image", currentVersionId: version.id, versions: [version] };
    display = { scale: 1, baseHeight: item.baseHeight ?? null, back: "mirror", yaw: null, fallbackWidthM: item.fallbackWidthM ?? 1.2 };
    // A photo of an object is not the object: only a flat work takes the object's size.
    physical = item.flat ? { ...size, depthCm: null, weightKg: null } : { widthCm: null, heightCm: null, depthCm: null, weightKg: null };
  } else if (item.kind === "sim") {
    asset = {
      kind: "sim",
      currentVersionId: `${aid}-v1`,
      versions: [{ id: `${aid}-v1`, program: s.program ?? "", params: s.params ?? {}, bounds: s.bounds ?? { width: 1, height: 1, depth: 1 }, credit, contributed, moderation: item.moderation ?? approved(item.flags ?? []), provenance: "procedural" }],
    };
    display = { scale: 1, baseHeight: item.baseHeight ?? null, back: "none", yaw: null, fallbackWidthM: 1.2 };
    physical = size;
  } else {
    const prov = ["smithsonian-3d", "zenodo", "sketchfab", "user-upload", "nasa"].includes(s.type) ? s.type : "user-upload";
    const version: ModelVersion = {
      id: `${aid}-v1`,
      original: {
        url: s.url ?? "", format: s.format ?? (prov === "smithsonian-3d" ? "voyager-document" : "glb"), bytes: s.bytes ?? null, triangles: null,
        ...(s.unitScale ? { unitScale: s.unitScale } : {}),
        ...(s.rotation ? { rotation: s.rotation } : {}),
        ...(s.omit ? { omit: s.omit } : {}),
        ...(s.materials ? { materials: s.materials } : {}),
      },
      rungs: [],
      scale: 1,
      bounds: { width: 1, height: 1, depth: 1 },
      credit,
      contributed,
      moderation: item.moderation ?? approved(item.flags ?? []),
      provenance: prov,
      representation: item.representation ?? "scan",
      ...(s.pointSize ? { pointSize: s.pointSize } : {}),
    } as ModelVersion;
    asset = { kind: "model", currentVersionId: version.id, versions: [version] };
    display = { scale: 1, baseHeight: item.baseHeight ?? null, back: item.back ?? "none", yaw: null, fallbackWidthM: 1.2 };
    if (item.threshold != null) display.threshold = item.threshold;
    physical = size;
  }
  if (item.hearing != null) display.hearing = item.hearing;
  if (item.yaw != null) display.yaw = item.yaw;
  if (item.scale != null) display.scale = item.scale;
  if (item.spin != null) display.spin = item.spin;
  if (item.reveal != null) display.reveal = item.reveal;
  if (item.invitation) display.invitation = item.invitation;
  if (item.oculus) display.oculus = item.oculus;
  if (item.ring) display.ring = item.ring;
  if (item.threshold != null && item.kind === "image") display.threshold = item.threshold;
  if (item.grab != null) display.grab = item.grab;
  if (item.sky) display.sky = item.sky;

  const record: Artwork = {
    id: aid,
    kind: item.kind,
    title: item.title,
    titleOriginal: item.titleOriginal ?? null,
    altTitles: item.altTitles ?? [],
    creators: (o.creators ?? (cr ? [cr] : [])).map((c) => ({ name: c.name, slug: c.slug ?? null, wikidataQid: c.wikidataQid ?? null, wikipediaUrl: c.wikipediaUrl ?? null, birthYear: c.birthYear ?? null, deathYear: c.deathYear ?? null, role: c.role || "maker" })),
    date: { year: o.year, month: o.month ?? null, day: o.day ?? null, yearStart: o.yearStart ?? null, yearEnd: o.yearEnd ?? null, label: o.dateLabel, precision: precisionOf(o) },
    madeIn: { name: made.name ?? null, region: made.region ?? null, country: made.country ?? null, point: made.lat != null && made.lon != null ? { lat: made.lat, lon: made.lon } : null, wikidataQid: made.wikidataQid ?? null },
    location: { name: loc.name ?? null, region: loc.region ?? null, country: loc.country ?? null, point: loc.lat != null && loc.lon != null ? { lat: loc.lat, lon: loc.lon } : null, wikidataQid: loc.wikidataQid ?? null, institution: loc.institution ?? null, inventoryNumber: loc.inventoryNumber ?? null },
    culture: o.culture ?? null,
    movement: o.movement ?? null,
    periodSlug: item.periodSlug ?? null,
    medium: o.medium ?? null,
    materials: o.materials ?? [],
    genre: item.genre ?? [],
    subjects: o.subjects ?? [],
    physical,
    description: o.description,
    facts: o.facts ?? [],
    wikipediaUrl: o.wikipediaUrl ?? null,
    wikidataQid: o.wikidataQid ?? null,
    externalIds,
    copyrighted: item.copyrighted ?? false,
    asset,
    display,
    tags: item.tags ?? [],
    pageviews: null,
    importance: item.importance ?? 0.8,
    moderation: item.moderation ?? approved(item.flags ?? []),
    source: item.recordSource ?? "wikipedia-import",
    createdAt: now,
    updatedAt: now,
  };
  if (item.audio) record.audio = audioAsset(aid, item.audio, now);
  if (item.branch) record.branch = item.branch;
  if (item.landmark) record.landmark = item.landmark;
  if (item.order != null) record.order = item.order;
  if (item.alternates?.length) record.alternates = item.alternates.map((alt, i) => alternateAsset(aid, i + 1, alt, now));
  return record;
}

/** What the pipeline wrote into a version, carried over from the record already in the collection. */
function carryVersion<T extends ImageVersion | ModelVersion>(fresh: T, old: T | undefined): T {
  if (!old) return fresh;
  const out = { ...fresh, rungs: old.rungs } as T;
  const o = { ...fresh.original } as Record<string, unknown>;
  const was = old.original as Record<string, unknown>;
  for (const k of ["bytes", "width", "height", "triangles"]) if ((o[k] == null || o[k] === 0) && was[k] != null) o[k] = was[k];
  out.original = o as T["original"];
  if ("bounds" in old) (out as ModelVersion).bounds = (old as ModelVersion).bounds;
  if ("scale" in old) (out as ModelVersion).scale = (old as ModelVersion).scale;
  if ("loop" in fresh && (fresh as ImageVersion).loop && (old as ImageVersion).loop) {
    (out as ImageVersion).loop = { ...(old as ImageVersion).loop, ...(fresh as ImageVersion).loop } as ImageVersion["loop"];
  }
  out.contributed = { ...fresh.contributed, at: old.contributed?.at ?? fresh.contributed.at };
  return out;
}

/** The record for an item, keeping what the pipeline has already built for it. */
export function ingest(item: Item, existing: Artwork | undefined, now: string): Artwork {
  const fresh = recordOf(item, now);
  if (!existing) return fresh;
  const out: Artwork = { ...fresh, createdAt: existing.createdAt, updatedAt: existing.updatedAt };
  if (fresh.asset.kind !== "sim" && existing.asset.kind === fresh.asset.kind) {
    const oldV = existing.asset.versions[0] as ImageVersion | ModelVersion | undefined;
    out.asset = { ...fresh.asset, versions: [carryVersion(fresh.asset.versions[0] as ImageVersion | ModelVersion, oldV)] } as ImageAsset | ModelAsset;
  }
  if (fresh.asset.kind === "sim" && existing.asset.kind === "sim") {
    out.asset = { ...fresh.asset, versions: [{ ...fresh.asset.versions[0]!, contributed: { ...fresh.asset.versions[0]!.contributed, at: existing.asset.versions[0]?.contributed.at ?? now } }] };
  }
  if (fresh.alternates && existing.alternates) {
    out.alternates = fresh.alternates.map((a, i) => {
      const old = existing.alternates?.[i];
      return old && old.kind === a.kind ? ({ ...a, versions: [carryVersion(a.versions[0] as ImageVersion, old.versions[0] as ImageVersion)] } as ImageAsset) : a;
    });
  }
  if (fresh.audio && existing.audio) {
    const oldA = existing.audio.versions[0];
    // The pipeline measured the original's length and size; those win over what the item guessed.
    const freshA = fresh.audio.versions[0]!;
    const original = { ...freshA.original, seconds: oldA?.original.seconds ?? freshA.original.seconds, bytes: oldA?.original.bytes ?? freshA.original.bytes };
    out.audio = { ...fresh.audio, versions: [{ ...freshA, original, encoded: oldA?.encoded ?? null, contributed: { ...freshA.contributed, at: oldA?.contributed.at ?? now } }] };
  } else if (!fresh.audio && existing.audio) {
    // A recording hung on the record by another item (attachAudioTo) stays.
    out.audio = existing.audio;
    if (existing.display.hearing != null && out.display.hearing == null) out.display.hearing = existing.display.hearing;
  }
  return out;
}

/** Stable JSON for comparing records: `updatedAt` aside, since it is what changes when anything does. */
export function fingerprint(a: Artwork): string {
  const { updatedAt: _u, ...rest } = a;
  return stable(rest);
}

/** JSON with every object's keys sorted, at every depth, so equal records print the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
