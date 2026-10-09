/**
 * Asset pipeline. Reads the collection, fetches each imported asset from
 * its source, prepares a ladder of qualities, writes them under
 * public/assets/<artwork id>/, and records the rungs back into the
 * collection. The museum then serves everything from its own host and
 * never hotlinks a source.
 *
 *  Images, provenance "wikimedia-commons":
 *    asks the Commons API for a ladder of thumbnail widths and downloads
 *    them as <width>.jpg.
 *
 *  Images from a video, provenance "video-still":
 *    the source video sits in data/originals/<artwork id>/. ffmpeg cuts the
 *    still at `loop.start` into a ladder of JPEG widths and encodes the
 *    silent loop as a small H.264 mp4. Needs ffmpeg on the PATH.
 *
 *  Images from a file, provenance "screenshot" or "user-upload":
 *    the source png or jpg is read from data/originals/<artwork id>/ and
 *    resized into a ladder of JPEG widths.
 *
 *  Models from a file, provenance "zenodo", "sketchfab" or "user-upload":
 *    the source glb or glTF is read from data/originals/<artwork id>/. For
 *    "zenodo" (any direct glb URL) the pipeline downloads it there first;
 *    for the others put the unpacked download there by hand, and until it
 *    is there the work is skipped with a warning. The ladder is built from
 *    that one file: textures are resized per tier and the mesh is simplified
 *    for the lower tiers, then everything gets the same metres, origin and
 *    Draco treatment as below. `original.unitScale` converts unitless or
 *    non-metre files to metres, and `original.rotation` (XYZ Euler degrees)
 *    uprights a scan that is tilted or faces the wrong way; both are baked.
 *
 *  Models, provenance "smithsonian-3d":
 *    `original.url` is a Voyager document.json from 3d-api.si.edu. Each of
 *    its Web3D quality tiers (thumb, low, medium, high) is a set of Draco
 *    glb parts in centimetres. For each tier the parts are merged into one
 *    glb, converted to metres with the base at y = 0 and the footprint
 *    centred, re-encoded with Draco, and written as <quality>.glb.
 *
 * Every source file is kept in data/originals/<artwork id>/. That directory
 * is the archive of record: originals are written once, never modified,
 * and are the thing to back up. The rungs are rebuilt from them.
 *
 * Usage: npm run fetch-assets
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Document, NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, draco, mergeDocuments, prune, simplify, textureCompress, unpartition, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
import type { Collection, ImageRung, ImageVersion, ModelRung, ModelVersion } from "../src/data/types";

const ROOT = path.resolve(import.meta.dirname, "..");
const COLLECTION = path.join(ROOT, "src/data/collection.json");
const OUT_DIR = path.join(ROOT, "public/assets");
const ORIGINALS_DIR = path.join(ROOT, "data/originals");
const TARGET_WIDTHS = [1024, 2048, 4096];
const USER_AGENT = "20watts/0.1 (https://20watts.org)";

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/** Download to `dest` unless a non-empty file is already there. Returns the byte size. */
async function download(url: string, dest: string): Promise<number> {
  try {
    const s = await stat(dest);
    if (s.size > 0) return s.size;
  } catch {}
  await mkdir(path.dirname(dest), { recursive: true });
  const buf = Buffer.from(await (await fetchOk(url)).arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

// ---------------------------------------------------------------- images

function commonsTitleFromUrl(url: string): string {
  const m = /\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url);
  if (!m?.[1]) throw new Error(`Not a Commons original URL: ${url}`);
  return "File:" + decodeURIComponent(m[1]);
}

async function thumbInfo(title: string, width: number): Promise<{ url: string; width: number; height: number }> {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(width),
    format: "json",
  }).toString();
  const json = (await (await fetchOk(api.toString())).json()) as {
    query: { pages: Record<string, { imageinfo?: { thumburl: string; thumbwidth: number; thumbheight: number }[] }> };
  };
  const info = Object.values(json.query.pages)[0]?.imageinfo?.[0];
  if (!info) throw new Error(`No imageinfo for ${title}`);
  // Commons snaps to a fixed set of pre-rendered widths; the URL carries the real one.
  const real = /\/(\d+)px-/.exec(info.thumburl);
  const realWidth = real?.[1] ? Number(real[1]) : info.thumbwidth;
  let url = info.thumburl.split("?")[0]!;
  // A png (or tiff, svg) source renders png thumbnails, many times the size of
  // a jpeg; appending .jpg asks Commons for a jpeg rendering instead.
  if (!/\.jpe?g$/i.test(url)) url += ".jpg";
  return { url, width: realWidth, height: Math.round((info.thumbheight / info.thumbwidth) * realWidth) };
}

async function fetchCommonsImage(artId: string, version: { original: { url: string; width: number }; rungs: ImageRung[] }) {
  const title = commonsTitleFromUrl(version.original.url);
  const dir = path.join(OUT_DIR, artId);
  const rungs = new Map<number, ImageRung>();
  for (const w of TARGET_WIDTHS) {
    if (w >= version.original.width) break;
    const t = await thumbInfo(title, w);
    if (rungs.has(t.width)) continue;
    const file = `${t.width}.jpg`;
    const bytes = await download(t.url, path.join(dir, file));
    rungs.set(t.width, { width: t.width, height: t.height, url: `/assets/${artId}/${file}`, bytes });
    console.log(`${artId}: ${t.width}px (${(bytes / 1024).toFixed(0)} KB)`);
  }
  version.rungs = [...rungs.values()].sort((a, b) => a.width - b.width);
}

const IMAGE_WIDTHS = [640, 1280, 2560, 5120];

async function buildLocalImage(artId: string, version: ImageVersion) {
  const dir = path.join(ORIGINALS_DIR, artId);
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const src = files[0];
  if (!src) throw new Error(`${artId}: put the source image in ${dir}`);
  const srcPath = path.join(dir, src);
  const meta = await sharp(srcPath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const bytes = (await stat(srcPath)).size;
  version.original = { url: version.original.url, width, height, bytes, mime: `image/${meta.format ?? "png"}` };
  const outDir = path.join(OUT_DIR, artId);
  await mkdir(outDir, { recursive: true });
  const rungs: ImageRung[] = [];
  const widths = [...IMAGE_WIDTHS.filter((w) => w < width), width];
  for (const w of widths) {
    const file = `${w}.jpg`;
    const info = await sharp(srcPath).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(outDir, file));
    rungs.push({ width: info.width, height: info.height, url: `/assets/${artId}/${file}`, bytes: info.size });
    console.log(`${artId}: ${info.width}px (${(info.size / 1024).toFixed(0)} KB)`);
  }
  version.rungs = rungs;
}

const LOOP_WIDTH = 640;

async function buildVideoStill(artId: string, version: ImageVersion) {
  const dir = path.join(ORIGINALS_DIR, artId);
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => /\.(mp4|webm|mov|mkv)$/i.test(f));
  const src = files[0];
  if (!src) throw new Error(`${artId}: put the source video in ${dir}`);
  const loop = version.loop;
  if (!loop) throw new Error(`${artId}: a video-still version needs \`loop\` with start and seconds`);
  const srcPath = path.join(dir, src);
  const outDir = path.join(OUT_DIR, artId);
  await mkdir(outDir, { recursive: true });

  // The still: one full-size frame, then the usual image ladder from it.
  const framePath = path.join(dir, `frame-${loop.start}.png`);
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(loop.start), "-i", srcPath, "-frames:v", "1", framePath]);
  const meta = await sharp(framePath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  version.original = { url: version.original.url, width, height, bytes: (await stat(srcPath)).size, mime: "video/mp4" };
  const rungs: ImageRung[] = [];
  for (const w of [...IMAGE_WIDTHS.filter((x) => x < width), width]) {
    const file = `${w}.jpg`;
    const info = await sharp(framePath).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(outDir, file));
    rungs.push({ width: info.width, height: info.height, url: `/assets/${artId}/${file}`, bytes: info.size });
    console.log(`${artId}: still ${info.width}px (${(info.size / 1024).toFixed(0)} KB)`);
  }
  version.rungs = rungs;

  // The loop: silent, small, H.264 so every headset browser plays it.
  const loopFile = `loop-${LOOP_WIDTH}.mp4`;
  const loopPath = path.join(outDir, loopFile);
  await run("ffmpeg", [
    "-v", "error", "-y", "-ss", String(loop.start), "-t", String(loop.seconds), "-i", srcPath,
    "-an", "-vf", `scale=${LOOP_WIDTH}:-2,fps=25`,
    "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-crf", "22", "-g", "25", "-movflags", "+faststart",
    loopPath,
  ]);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", loopPath]);
  const [lw = LOOP_WIDTH, lh = Math.round((LOOP_WIDTH * height) / width)] = stdout.trim().split(",").map(Number);
  const bytes = (await stat(loopPath)).size;
  version.loop = { ...loop, url: `/assets/${artId}/${loopFile}`, width: lw, height: lh, bytes };
  console.log(`${artId}: loop ${loop.seconds}s ${lw}x${lh} (${(bytes / 1024).toFixed(0)} KB)`);
}

// ---------------------------------------------------------------- models

const QUALITIES = ["thumb", "low", "medium", "high"] as const;
type Quality = (typeof QUALITIES)[number];

/** The parts of a Voyager document we read. */
interface VoyagerDocument {
  scenes: { units?: string }[];
  models: {
    units?: string;
    derivatives: { usage: string; quality: string; assets: { uri: string; type: string; byteSize?: number; numFaces?: number }[] }[];
  }[];
}

const UNITS_TO_METRES: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048 };

/** For each model, the Web3D glb at `quality`, or the nearest tier it does have. */
function voyagerParts(doc: VoyagerDocument, quality: Quality): { uri: string; faces: number | null }[] {
  const order: Quality[] = ["thumb", "low", "medium", "high"];
  const want = order.indexOf(quality);
  return doc.models.map((m, i) => {
    const web = m.derivatives
      .filter((d) => d.usage === "Web3D")
      .map((d) => ({ tier: order.indexOf(d.quality.toLowerCase() as Quality), asset: d.assets.find((a) => a.type === "Model") }))
      .filter((d): d is { tier: number; asset: NonNullable<typeof d.asset> } => d.tier >= 0 && !!d.asset)
      .sort((a, b) => a.tier - b.tier);
    const pick = web.filter((d) => d.tier <= want).at(-1) ?? web[0];
    if (!pick) throw new Error(`Voyager model ${i} has no Web3D derivative`);
    return { uri: pick.asset.uri, faces: pick.asset.numFaces ?? null };
  });
}

let gltfIO: NodeIO | null = null;
async function io(): Promise<NodeIO> {
  if (!gltfIO) {
    gltfIO = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });
  }
  return gltfIO;
}

/**
 * Merge glb parts into one scene, convert to metres, put the base on the
 * floor with the footprint centred, Draco-encode, and write to `dest`.
 * Returns the bounds in metres and the triangle and texture statistics.
 */
interface TierOptions {
  /** Fraction of triangles to keep, 1 = all. */
  ratio: number;
  /** Longest texture edge after resizing, in pixels. */
  textureSize: number;
}

/** XYZ Euler degrees to a glTF quaternion [x, y, z, w]. */
function eulerToQuat([xDeg, yDeg, zDeg]: [number, number, number]): [number, number, number, number] {
  const [x, y, z] = [(xDeg * Math.PI) / 360, (yDeg * Math.PI) / 360, (zDeg * Math.PI) / 360];
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

async function mergeParts(partFiles: string[], unitScale: number, dest: string, tier?: TierOptions, rotation?: [number, number, number]) {
  const nio = await io();
  const out = new Document();
  for (const file of partFiles) mergeDocuments(out, await nio.read(file));

  const root = out.getRoot();
  const holder = out.createNode("model");
  for (const scene of root.listScenes()) {
    for (const child of scene.listChildren()) {
      scene.removeChild(child);
      holder.addChild(child);
    }
    scene.dispose();
  }
  const scene = out.createScene("Scene").addChild(holder);
  root.setDefaultScene(scene);

  // Orient first, measure in source units, then bake scale and origin into the holder node.
  if (rotation) holder.setRotation(eulerToQuat(rotation));
  const b = getBounds(scene);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  holder.setScale([unitScale, unitScale, unitScale]);
  holder.setTranslation([-cx * unitScale, -b.min[1] * unitScale, -cz * unitScale]);

  if (tier) {
    await MeshoptSimplifier.ready;
    await out.transform(
      weld(),
      ...(tier.ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio: tier.ratio, error: 0.001 })] : []),
      textureCompress({ encoder: sharp, targetFormat: "webp", quality: 85, resize: [tier.textureSize, tier.textureSize] }),
    );
  }
  await out.transform(dedup(), prune(), unpartition(), draco({ method: "edgebreaker" }));

  let triangles = 0;
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      triangles += Math.round((p.getIndices()?.getCount() ?? p.getAttribute("POSITION")?.getCount() ?? 0) / 3);
    }
  }
  let textureSize = 0;
  for (const t of root.listTextures()) textureSize = Math.max(textureSize, ...(t.getSize() ?? [0, 0]));

  await mkdir(path.dirname(dest), { recursive: true });
  const glb = await nio.writeBinary(out);
  await writeFile(dest, glb);
  return {
    bytes: glb.byteLength,
    triangles,
    textureSize: textureSize || null,
    bounds: {
      width: (b.max[0] - b.min[0]) * unitScale,
      height: (b.max[1] - b.min[1]) * unitScale,
      depth: (b.max[2] - b.min[2]) * unitScale,
    },
  };
}

async function fetchSmithsonianModel(artId: string, version: ModelVersion) {
  const docUrl = version.original.url;
  const docId = /\/document\/([^/]+)\//.exec(docUrl)?.[1] ?? "doc";
  const cache = path.join(ORIGINALS_DIR, artId);
  await download(docUrl, path.join(cache, `${docId}.document.json`));
  const doc = JSON.parse(await readFile(path.join(cache, `${docId}.document.json`), "utf8")) as VoyagerDocument;
  const units = doc.models[0]?.units ?? doc.scenes[0]?.units ?? "m";
  const unitScale = UNITS_TO_METRES[units];
  if (unitScale == null) throw new Error(`Unknown Voyager units "${units}" in ${docUrl}`);
  const base = docUrl.slice(0, docUrl.lastIndexOf("/") + 1);

  const rungs: ModelRung[] = [];
  let bounds = version.bounds;
  for (const quality of QUALITIES) {
    const parts = voyagerParts(doc, quality);
    // Asset URIs are relative to the document in older documents and absolute in newer ones.
    const files = parts.map((p) => path.join(cache, path.basename(new URL(p.uri, base).pathname)));
    for (const [i, p] of parts.entries()) await download(new URL(p.uri, base).toString(), files[i]!);
    const file = `${quality}.glb`;
    const r = await mergeParts(files, unitScale, path.join(OUT_DIR, artId, file));
    rungs.push({ quality, url: `/assets/${artId}/${file}`, bytes: r.bytes, triangles: r.triangles, textureSize: r.textureSize, draco: true });
    bounds = r.bounds;
    console.log(`${artId}: ${quality} ${(r.bytes / 1024).toFixed(0)} KB, ${r.triangles} tris, ${r.textureSize ?? "no"} px textures`);
  }
  version.rungs = rungs;
  version.bounds = { width: round(bounds.width), height: round(bounds.height), depth: round(bounds.depth) };
  version.original.triangles = rungs.at(-1)?.triangles ?? null;
  version.original.format = "voyager-document";
}

/** Tiers built from one source file, mirroring the Smithsonian ladder. */
const LOCAL_TIERS: Record<Quality, TierOptions> = {
  thumb: { ratio: 0.05, textureSize: 512 },
  low: { ratio: 0.35, textureSize: 1024 },
  medium: { ratio: 0.6, textureSize: 2048 },
  high: { ratio: 1, textureSize: 4096 },
};

async function buildLocalModel(artId: string, version: ModelVersion): Promise<boolean> {
  const dir = path.join(ORIGINALS_DIR, artId);
  const listGlbs = async () => (await readdir(dir).catch(() => [] as string[])).filter((f) => /\.(glb|gltf)$/i.test(f));
  let files = await listGlbs();
  if (!files.length && version.provenance === "zenodo") {
    const name = /\/files\/([^/]+\.glb)\b/i.exec(version.original.url)?.[1] ?? "source.glb";
    version.original.bytes = await download(version.original.url, path.join(dir, name));
    files = await listGlbs();
  }
  const src = files[0];
  if (!src) {
    console.warn(`${artId}: skipped, put the source .glb or .gltf in ${dir}`);
    return false;
  }
  const unitScale = version.original.unitScale ?? 1;
  const rungs: ModelRung[] = [];
  let bounds = version.bounds;
  for (const quality of QUALITIES) {
    const file = `${quality}.glb`;
    const r = await mergeParts([path.join(dir, src)], unitScale, path.join(OUT_DIR, artId, file), LOCAL_TIERS[quality], version.original.rotation);
    rungs.push({ quality, url: `/assets/${artId}/${file}`, bytes: r.bytes, triangles: r.triangles, textureSize: r.textureSize, draco: true });
    bounds = r.bounds;
    console.log(`${artId}: ${quality} ${(r.bytes / 1024).toFixed(0)} KB, ${r.triangles} tris, ${r.textureSize ?? "no"} px textures`);
  }
  version.rungs = rungs;
  version.bounds = { width: round(bounds.width), height: round(bounds.height), depth: round(bounds.depth) };
  version.original.triangles = rungs.at(-1)?.triangles ?? null;
  return true;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------- main

async function main() {
  const collection = JSON.parse(await readFile(COLLECTION, "utf8")) as Collection;
  for (const art of collection.artworks) {
    let touched = false;
    if (art.asset.kind === "image") {
      for (const version of art.asset.versions) {
        if (version.provenance === "wikimedia-commons") await fetchCommonsImage(art.id, version);
        else if (version.provenance === "video-still") await buildVideoStill(art.id, version);
        else if (version.provenance === "screenshot" || version.provenance === "user-upload") await buildLocalImage(art.id, version);
        else continue;
        touched = true;
      }
    } else {
      for (const version of art.asset.versions) {
        if (version.provenance === "smithsonian-3d") await fetchSmithsonianModel(art.id, version);
        else if (["zenodo", "sketchfab", "user-upload"].includes(version.provenance)) {
          if (!(await buildLocalModel(art.id, version))) continue;
        } else continue;
        touched = true;
      }
    }
    if (touched) art.updatedAt = new Date().toISOString();
  }
  await writeFile(COLLECTION, JSON.stringify(collection, null, 2) + "\n");
  console.log("collection.json updated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
