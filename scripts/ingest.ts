/**
 * Items to the collection. Reads every data/items/*.json, builds its record
 * with src/data/ingest.ts, keeps what the asset pipeline has already put on
 * the record in src/data/collection.json, and writes the collection back in
 * time order. Records with no item file are left exactly as they are.
 *
 *   npm run ingest                 apply every item
 *   npm run ingest -- <slug> ...   only these
 *   npm run ingest -- --diff       show what would change, write nothing
 *   npm run ingest -- --check      exit 1 if anything would change (for CI)
 *   npm run ingest -- --bootstrap  write an item file for every record that has none
 *   npm run ingest -- --adopt      rewrite every item whose record was edited by hand, from the record
 *
 * Then `npm run fetch-assets -- <id>` for anything new or re-sourced.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artworkIdOf, fingerprint, ingest } from "../src/data/ingest";
import type { Item } from "../src/data/item";
import type { Artwork, Collection } from "../src/data/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COLLECTION = path.join(ROOT, "src/data/collection.json");
const ITEMS = path.join(ROOT, "data/items");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const want = new Set(args.filter((a) => !a.startsWith("--")));
const now = new Date().toISOString();

/** Dotted paths where two JSON values differ, for reading a diff at a glance. */
function differences(a: unknown, b: unknown, at = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((v, i) => differences(v, b[i], `${at}[${i}]`));
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k));
  }
  const show = (v: unknown) => { const s = JSON.stringify(v) ?? "undefined"; return s.length > 70 ? s.slice(0, 67) + "..." : s; };
  return [`${at}: ${show(a)} -> ${show(b)}`];
}

/** An item that reproduces a record, for records made before there were items. Best effort; read it over. */
function itemOf(a: Artwork): Item {
  const v = a.asset.versions[0] as unknown as Record<string, unknown>;
  const original = (v.original ?? {}) as Record<string, unknown>;
  const credit = (v.credit ?? {}) as { author?: string | null; license?: { name?: string; url?: string | null }; sourcePage?: string | null };
  const contributed = (v.contributed ?? {}) as { note?: string | null };
  const prov = String(v.provenance ?? "");
  const type = prov === "wikimedia-commons" ? "commons" : a.id.startsWith("yt-") ? "youtube" : prov;
  const idTail = a.id.replace(/^[a-z]+-/, "");
  const source: Item["source"] = {
    type,
    curid: type === "commons" ? Number(a.externalIds["commons-curid"] ?? idTail) : a.id.startsWith("usr-") || a.id.startsWith("eq-") || a.id.startsWith("sim-") ? null : idTail,
    ...(a.asset.kind === "model" && original.format && original.format !== "glb" ? { format: original.format as string } : {}),
    fileTitle: a.externalIds["commons-file"] ? `File:${a.externalIds["commons-file"]}` : null,
    url: original.url as string | undefined,
    sourcePage: credit.sourcePage ?? null,
    width: (original.width as number | undefined) ?? null,
    height: (original.height as number | undefined) ?? null,
    bytes: (original.bytes as number | undefined) ?? null,
    mime: (original.mime as string | undefined) ?? null,
    licenseName: credit.license?.name ?? null,
    licenseUrl: credit.license?.url ?? null,
    author: credit.author ?? null,
    notes: contributed.note ?? null,
  };
  if (a.asset.kind === "sim") Object.assign(source, { program: v.program, params: v.params, bounds: v.bounds });
  if (prov === "typeset") Object.assign(source, { tex: original.tex ?? "", ...(original.figure ? { figure: original.figure } : {}) });
  if (a.asset.kind === "model") for (const k of ["unitScale", "rotation", "omit", "materials"]) if (original[k] != null) (source as unknown as Record<string, unknown>)[k] = original[k];
  if (a.asset.kind === "model" && v.pointSize != null) source.pointSize = v.pointSize as number;
  const cr = a.creators[0];
  const creatorOf = (c: Artwork["creators"][number]) => ({ name: c.name, role: c.role, birthYear: c.birthYear, deathYear: c.deathYear, wikidataQid: c.wikidataQid, ...(c.wikipediaUrl ? { wikipediaUrl: c.wikipediaUrl } : {}), ...(c.slug ? { slug: c.slug } : {}) });
  // Derived ids need the slug; the others may take a readable one from the title.
  const keepsSlug = /^(usr|eq|sim)-/.test(a.id);
  const titleSlug = a.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const derived: Record<string, string> = {};
  for (const [k, v2] of Object.entries(a.externalIds)) if (!["commons-curid", "commons-file"].includes(k) && v2 !== String(source.curid ?? "")) derived[k] = v2;
  const item: Item = {
    slug: keepsSlug ? a.id.replace(/^[a-z]+-/, "") : titleSlug,
    title: a.title,
    titleOriginal: a.titleOriginal,
    ...(a.altTitles.length ? { altTitles: a.altTitles } : {}),
    kind: a.kind,
    importance: a.importance ?? 0.8,
    genre: a.genre,
    tags: a.tags,
    periodSlug: a.periodSlug,
    flat: a.kind === "image" && a.physical.widthCm != null,
    baseHeight: a.display.baseHeight,
    source,
    object: {
      year: a.date.year, month: a.date.month, day: a.date.day, yearStart: a.date.yearStart, yearEnd: a.date.yearEnd, dateLabel: a.date.label,
      ...(a.date.precision !== (a.date.yearStart != null && a.date.yearEnd != null && a.date.yearStart !== a.date.yearEnd ? "circa" : Math.abs(a.date.year) < 5000 ? "year" : "circa") ? { datePrecision: a.date.precision } : {}),
      madeIn: { name: a.madeIn.name, region: a.madeIn.region, country: a.madeIn.country, lat: a.madeIn.point?.lat ?? null, lon: a.madeIn.point?.lon ?? null, wikidataQid: a.madeIn.wikidataQid },
      location: { name: a.location.name, region: a.location.region, country: a.location.country, lat: a.location.point?.lat ?? null, lon: a.location.point?.lon ?? null, wikidataQid: a.location.wikidataQid, institution: a.location.institution, inventoryNumber: a.location.inventoryNumber },
      creator: cr ? creatorOf(cr) : null,
      ...(a.creators.length > 1 ? { creators: a.creators.map(creatorOf) } : {}),
      culture: a.culture, movement: a.movement, medium: a.medium, materials: a.materials, subjects: a.subjects,
      widthCm: a.physical.widthCm, heightCm: a.physical.heightCm, depthCm: a.physical.depthCm, weightKg: a.physical.weightKg,
      description: a.description, facts: a.facts, wikipediaUrl: a.wikipediaUrl, wikidataQid: a.wikidataQid,
    },
  };
  if (Object.keys(derived).length) item.externalIds = derived;
  if (a.copyrighted) item.copyrighted = true;
  if (a.moderation.flags.length) item.flags = a.moderation.flags;
  const m = a.moderation;
  if (m.status !== "approved" || m.reviewedBy || m.reviewedAt || m.reason) item.moderation = m;
  if (a.source !== "wikipedia-import") item.recordSource = a.source;
  if (a.kind === "model") { item.representation = (v.representation as "scan" | "reconstruction") ?? "scan"; item.back = a.display.back; }
  for (const k of ["yaw", "spin", "grab", "hearing", "threshold", "reveal", "invitation", "oculus", "ring", "sky"] as const) {
    if (a.display[k] != null) (item as unknown as Record<string, unknown>)[k] = a.display[k];
  }
  if (a.display.scale !== 1) item.scale = a.display.scale;
  if (a.display.fallbackWidthM !== 1.2) item.fallbackWidthM = a.display.fallbackWidthM;
  if (a.asset.kind === "image" && a.asset.versions[0]?.loop) {
    const { start, seconds, aspect } = a.asset.versions[0].loop;
    item.loop = { start, seconds, ...(aspect != null ? { aspect } : {}) } as Item["loop"];
  }
  if (a.order != null) item.order = a.order;
  if (a.tour) item.tour = a.tour;
  if (a.branch) item.branch = a.branch;
  if (a.landmark) item.landmark = a.landmark;
  if (a.audio) {
    const au = a.audio.versions[0]!;
    item.audio = { type: au.provenance === "wikimedia-commons" ? "commons" : au.provenance, url: au.original.url, bytes: au.original.bytes, mime: au.original.mime, seconds: au.original.seconds, start: au.start, excerptSeconds: au.seconds, performers: au.performers, author: au.credit.author, licenseName: au.credit.license.name, licenseUrl: au.credit.license.url, sourcePage: au.credit.sourcePage, notes: au.contributed.note };
  }
  if (a.alternates?.length) {
    item.alternates = a.alternates.map((alt) => {
      const av = alt.versions[0] as unknown as Record<string, unknown>; const o = av.original as Record<string, unknown>; const c = av.credit as { author?: string | null; license?: { name?: string; url?: string | null }; sourcePage?: string | null };
      return { url: o.url as string, width: o.width as number, height: o.height as number, bytes: (o.bytes as number | null) ?? null, mime: o.mime as string, author: c.author ?? null, licenseName: c.license?.name ?? null, licenseUrl: c.license?.url ?? null, sourcePage: c.sourcePage ?? null, notes: ((av.contributed as { note?: string | null })?.note) ?? null };
    });
  }
  return item;
}

async function main() {
  const collection = JSON.parse(await readFile(COLLECTION, "utf8")) as Collection;
  const byId = new Map(collection.artworks.map((a) => [a.id, a]));
  const files = (await readdir(ITEMS)).filter((f) => f.endsWith(".json")).sort();
  const items: { file: string; item: Item }[] = [];
  for (const f of files) items.push({ file: f, item: JSON.parse(await readFile(path.join(ITEMS, f), "utf8")) as Item });

  if (flags.has("--bootstrap")) {
    const covered = new Set(items.filter(({ item }) => !item.skip && !item.attachAudioTo).map(({ item }) => artworkIdOf(item)));
    let n = 0;
    for (const a of collection.artworks) {
      if (covered.has(a.id)) continue;
      const item = itemOf(a);
      if (artworkIdOf(item) !== a.id) { console.warn(`${a.id}: would get id ${artworkIdOf(item)}; not written`); continue; }
      const file = path.join(ITEMS, `${item.slug}.json`);
      await writeFile(file, JSON.stringify(item, null, 1) + "\n");
      console.log(`wrote ${path.relative(ROOT, file)} for ${a.id}`);
      n += 1;
    }
    console.log(`${n} item files written; read them over`);
    return 0;
  }

  if (flags.has("--adopt")) {
    // The record was patched directly and is what has been seen running: make the item say the same.
    let n = 0;
    for (const { file, item } of items) {
      if (item.skip || item.attachAudioTo) continue;
      const existing = byId.get(artworkIdOf(item));
      if (!existing) continue;
      if (fingerprint(ingest(item, existing, existing.updatedAt)) === fingerprint(existing)) continue;
      const adopted = { ...itemOf(existing), slug: item.slug };
      if (artworkIdOf(adopted) !== existing.id) { console.warn(`${file}: adopting would change its id to ${artworkIdOf(adopted)}; left alone`); continue; }
      await writeFile(path.join(ITEMS, file), JSON.stringify(adopted, null, 1) + "\n");
      console.log(`adopted ${file}: ${differences(existing, ingest(item, existing, existing.updatedAt)).length} fields from the record`);
      n += 1;
    }
    console.log(`${n} items rewritten from their records`);
    return 0;
  }

  const out = new Map(byId);
  const changes: string[] = [];
  for (const { file, item } of items) {
    const slug = item.slug ?? file.replace(/\.json$/, "");
    if (want.size && !want.has(slug)) continue;
    if (item.skip) continue;
    if (item.attachAudioTo) {
      const target = out.get(item.attachAudioTo);
      if (!target) { console.warn(`${file}: no such work ${item.attachAudioTo} to hang audio on`); continue; }
      if (!item.audio) continue;
      const withAudio = ingest({ ...itemOf(target), audio: item.audio, hearing: item.hearing ?? null }, target, now);
      const next: Artwork = { ...target, audio: withAudio.audio, display: { ...target.display, ...(item.hearing != null ? { hearing: item.hearing } : {}) } };
      if (fingerprint(next) !== fingerprint(target)) { next.updatedAt = now; out.set(target.id, next); changes.push(`${target.id} (audio from ${file})`, ...differences(target, next).map((d) => `    ${d}`)); }
      continue;
    }
    const existing = out.get(artworkIdOf(item));
    const next = ingest(item, existing, now);
    if (!existing) { out.set(next.id, next); changes.push(`${next.id} added from ${file}`); continue; }
    if (fingerprint(next) !== fingerprint(existing)) {
      next.updatedAt = now;
      out.set(next.id, next);
      changes.push(`${next.id} from ${file}`, ...differences(existing, next).map((d) => `    ${d}`));
    }
  }

  if (changes.length) console.log(changes.join("\n")); else console.log("nothing to change");
  if (flags.has("--diff")) return 0;
  if (flags.has("--check")) return changes.length ? 1 : 0;
  if (!changes.length) return 0;
  collection.artworks = [...out.values()].sort((p, q) => p.date.year - q.date.year || (p.date.month ?? 0) - (q.date.month ?? 0));
  collection.generatedAt = now;
  await writeFile(COLLECTION, JSON.stringify(collection, null, 2) + "\n");
  console.log(`${collection.artworks.length} records written`);
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
