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
 *  Equations, provenance "typeset":
 *    `original.tex` is set with MathJax, centred on a sheet whose shape is
 *    the record's physical size, and rendered into a ladder of JPEG widths.
 *    The SVG is kept in data/originals/<artwork id>/equation.svg.
 *
 *  Recordings (`audio` on a record), any provenance with a direct URL:
 *    the original is downloaded into data/originals/<artwork id>/ and
 *    ffmpeg cuts the excerpt (`start`, `seconds`), fades it in and out,
 *    and writes it as sound.mp3. Needs ffmpeg and ffprobe on the PATH.
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
 * Usage: npm run fetch-assets [-- <artwork id> ...]
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Document, NodeIO, Primitive, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, draco, mergeDocuments, prune, simplify, textureCompress, unpartition, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
import type { Artwork, AudioVersion, Collection, ImageRung, ImageVersion, ModelRung, ModelVersion } from "../src/data/types";

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

/**
 * The file a Commons URL names, and for a page rendered out of a multipage
 * file (a djvu or pdf: .../thumb/x/xy/Book.djvu/page3-1920px-Book.djvu.jpg)
 * which page.
 */
function commonsTitleFromUrl(url: string): { title: string; page: number | null } {
  const page = /\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)\/page(\d+)-\d+px-/.exec(url);
  if (page?.[1]) return { title: "File:" + decodeURIComponent(page[1]), page: Number(page[2]) };
  const m = /\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url);
  if (!m?.[1]) throw new Error(`Not a Commons original URL: ${url}`);
  return { title: "File:" + decodeURIComponent(m[1]), page: null };
}

async function thumbInfo(title: string, width: number, page: number | null = null): Promise<{ url: string; width: number; height: number }> {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(width),
    ...(page ? { iiurlparam: `page${page}-${width}px` } : {}),
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
  // a jpeg; appending .jpg asks Commons for a jpeg rendering instead. When
  // Commons hands back the original itself (a small file), it is used as is.
  if (url.includes("/thumb/") && !/\.jpe?g$/i.test(url)) url += ".jpg";
  return { url, width: realWidth, height: Math.round((info.thumbheight / info.thumbwidth) * realWidth) };
}

async function fetchCommonsImage(artId: string, version: { original: { url: string; width: number; height: number }; rungs: ImageRung[] }) {
  const { title, page } = commonsTitleFromUrl(version.original.url);
  const dir = path.join(OUT_DIR, artId);
  const rungs = new Map<number, ImageRung>();
  for (const w of TARGET_WIDTHS) {
    if (w >= version.original.width) break;
    const t = await thumbInfo(title, w, page);
    if (rungs.has(t.width)) continue;
    const file = `${t.width}.${/\.png$/i.test(t.url) ? "png" : "jpg"}`;
    const bytes = await download(t.url, path.join(dir, file));
    rungs.set(t.width, { width: t.width, height: t.height, url: `/assets/${artId}/${file}`, bytes });
    console.log(`${artId}: ${t.width}px (${(bytes / 1024).toFixed(0)} KB)`);
  }
  // A small original (under the first target width) is served as it is.
  if (rungs.size === 0) {
    const { width, height } = version.original;
    const url = version.original.url.split("?")[0]!;
    const file = `${width}.${/\.png$/i.test(url) ? "png" : "jpg"}`;
    const bytes = await download(url, path.join(dir, file));
    rungs.set(width, { width, height, url: `/assets/${artId}/${file}`, bytes });
    console.log(`${artId}: ${width}px, the original (${(bytes / 1024).toFixed(0)} KB)`);
  }
  version.rungs = [...rungs.values()].sort((a, b) => a.width - b.width);
}

const IMAGE_WIDTHS = [640, 1280, 2560, 5120];

// ---------------------------------------------------------------- recordings

/** Width and height of a video's first video stream. */
async function probeSize(file: string): Promise<number[]> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  return stdout.trim().split("\n")[0]!.split(",").filter((x) => x !== "").map(Number);
}

async function probeSeconds(file: string): Promise<number | null> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  } catch {
    return null;
  }
}

async function buildAudio(artId: string, version: AudioVersion) {
  const origDir = path.join(ORIGINALS_DIR, artId);
  const name = decodeURIComponent(path.basename(new URL(version.original.url).pathname)).replace(/[^\w.-]+/g, "_");
  const src = path.join(origDir, name);
  version.original.bytes = await download(version.original.url, src);
  version.original.seconds = (await probeSeconds(src)) ?? version.original.seconds;
  const dir = path.join(OUT_DIR, artId);
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, "sound.mp3");
  const total = version.original.seconds;
  const length = version.seconds ?? (total != null ? Math.max(0, total - version.start) : null);
  const fade = length != null ? Math.min(3, length / 4) : 2;
  const filters = [`afade=t=in:st=0:d=${fade}`, ...(length != null ? [`afade=t=out:st=${Math.max(0, length - fade)}:d=${fade}`] : [])];
  const args = ["-y", "-v", "error", "-ss", String(version.start), ...(length != null ? ["-t", String(length)] : []), "-i", src,
    "-vn", "-ac", "2", "-ar", "44100", "-af", filters.join(","), "-b:a", "128k", out];
  await run("ffmpeg", args);
  const bytes = (await stat(out)).size;
  version.encoded = { url: `/assets/${artId}/sound.mp3`, bytes, seconds: await probeSeconds(out) };
  console.log(`${artId}: sound.mp3 ${version.encoded.seconds ?? "?"} s (${(bytes / 1024).toFixed(0)} KB)`);
}

// ---------------------------------------------------------------- equations

import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

const SHEET = "#f3eee3";
const INK = "#2a2824";

/** TeX to a standalone SVG string with a pixel size, `exPx` pixels per ex. */
function texToSvg(tex: string, exPx: number): { svg: string; width: number; height: number } {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const html = mathjax.document("", { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: "local" }) });
  const node = html.convert(tex, { display: true });
  let svg = adaptor.innerHTML(node);
  const w = Number(/width="([\d.]+)ex"/.exec(svg)?.[1]);
  const h = Number(/height="([\d.]+)ex"/.exec(svg)?.[1]);
  if (!w || !h) throw new Error(`MathJax gave no size for ${tex}`);
  const width = Math.round(w * exPx);
  const height = Math.round(h * exPx);
  svg = svg.replace(/width="[\d.]+ex"/, `width="${width}"`).replace(/height="[\d.]+ex"/, `height="${height}"`);
  svg = svg.replace(/currentColor/g, INK);
  return { svg, width, height };
}

/**
 * The equation on a sheet: the sheet's shape is the record's physical size
 * (so the image hangs at exactly that size), the equation fills at most
 * 78% of its width and 55% of its height, centred.
 */
async function buildTypeset(artId: string, version: ImageVersion, physical: { widthCm: number | null; heightCm: number | null }) {
  const tex = version.original.tex;
  if (!tex) throw new Error(`${artId}: provenance typeset needs original.tex`);
  const aspect = physical.widthCm && physical.heightCm ? physical.heightCm / physical.widthCm : 0.62;
  const W = 2560;
  const H = Math.round(W * aspect);
  // With a figure, the figure takes the upper part of the sheet and the equation the lower.
  const figure = version.original.figure ? await readFile(path.join(ROOT, version.original.figure)) : null;
  const eqBand = figure ? { top: H * 0.68, height: H * 0.24 } : { top: H * 0.225, height: H * 0.55 };
  // Render once, large, then fit.
  const probe = texToSvg(tex, 40);
  const scale = Math.min((W * 0.78) / probe.width, eqBand.height / probe.height);
  const { svg, width, height } = texToSvg(tex, 40 * scale);
  const origDir = path.join(ORIGINALS_DIR, artId);
  await mkdir(origDir, { recursive: true });
  await writeFile(path.join(origDir, "equation.svg"), svg);
  version.original.url = `data/originals/${artId}/equation.svg`;
  version.original.width = W;
  version.original.height = H;
  version.original.mime = "image/svg+xml";
  version.original.bytes = Buffer.byteLength(svg);

  const glyphs = await sharp(Buffer.from(svg), { density: 72 }).png().toBuffer();
  const layers = [{ input: glyphs, left: Math.round((W - width) / 2), top: Math.round(eqBand.top + (eqBand.height - height) / 2) }];
  if (figure) {
    const figW = Math.round(W * 0.62);
    const fig = sharp(figure, { density: 300 }).resize({ width: figW });
    const meta = await fig.toBuffer({ resolveWithObject: true });
    const figH = Math.min(meta.info.height, Math.round(H * 0.56));
    layers.unshift({ input: meta.data, left: Math.round((W - figW) / 2), top: Math.round(H * 0.07 + (H * 0.56 - figH) / 2) });
  }
  const sheet = sharp({ create: { width: W, height: H, channels: 3, background: SHEET } })
    .composite(layers)
    .jpeg({ quality: 92 });
  const full = await sheet.toBuffer();
  const dir = path.join(OUT_DIR, artId);
  await mkdir(dir, { recursive: true });
  const rungs: ImageRung[] = [];
  for (const w of IMAGE_WIDTHS) {
    if (w > W) break;
    const file = `${w}.jpg`;
    const buf = w === W ? full : await sharp(full).resize({ width: w }).jpeg({ quality: 90 }).toBuffer();
    await writeFile(path.join(dir, file), buf);
    rungs.push({ width: w, height: Math.round((H * w) / W), url: `/assets/${artId}/${file}`, bytes: buf.length });
    console.log(`${artId}: ${w}px (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  version.rungs = rungs;
}

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

  // A film letterboxed or pillarboxed inside the file is cropped to its own shape, centred.
  const crop: string[] = [];
  if (loop.aspect) {
    const [sw = 0, sh = 0] = await probeSize(srcPath);
    const [cw, ch] = sw / sh > loop.aspect ? [Math.round(sh * loop.aspect), sh] : [sw, Math.round(sw / loop.aspect)];
    crop.push(`crop=${cw}:${ch}`);
  }
  // The still: one full-size frame, then the usual image ladder from it.
  const framePath = path.join(dir, `frame-${loop.start}.png`);
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(loop.start), "-i", srcPath, "-frames:v", "1", ...(crop.length ? ["-vf", crop[0]!] : []), framePath]);
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
    "-an", "-vf", [...crop, `scale=${LOOP_WIDTH}:-2`, "fps=25"].join(","),
    "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-crf", "22", "-g", "25", "-movflags", "+faststart",
    loopPath,
  ]);
  const [lw = LOOP_WIDTH, lh = Math.round((LOOP_WIDTH * height) / width)] = await probeSize(loopPath);
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
  /** For a point cloud: fraction of points to keep. Clouds are huge, so this is far below `ratio`. */
  points: number;
  /**
   * Largest deviation the simplifier may introduce, as a fraction of the
   * mesh's extent. A thumb seen from 90 m can stray a few centimetres; a
   * mesh of thin struts (a glider) will not simplify at all under a tight
   * bound, so the lower tiers get a looser one.
   */
  error?: number;
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

async function mergeParts(partFiles: string[], unitScale: number, dest: string, tier?: TierOptions, rotation?: [number, number, number], omit?: string[]) {
  const nio = await io();
  const out = new Document();
  for (const file of partFiles) mergeDocuments(out, await nio.read(file));
  if (omit?.length) {
    for (const node of out.getRoot().listNodes()) {
      if (omit.some((o) => node.getName().includes(o))) node.setMesh(null);
    }
  }

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

  // A point cloud (a scan published as points, not a mesh) is thinned, not
  // simplified: every k-th point is kept, with its colour as bytes, and
  // nothing else; normals mean nothing for unlit dots.
  const cloud = root.listMeshes().some((m) => m.listPrimitives().some((p) => p.getMode() === Primitive.Mode.POINTS));
  let points = 0;
  if (cloud) {
    const keep = tier ? tier.points : 1;
    for (const m of root.listMeshes()) {
      for (const p of m.listPrimitives()) {
        if (p.getMode() !== Primitive.Mode.POINTS) continue;
        const pos = p.getAttribute("POSITION")!;
        const col = p.getAttribute("COLOR_0");
        const n = pos.getCount();
        const step = Math.max(1, Math.round(1 / keep));
        const kept = Math.floor((n + step - 1) / step);
        const xyz = new Float32Array(kept * 3);
        const rgb = new Uint8Array(kept * 3);
        const v: number[] = [0, 0, 0, 0];
        for (let i = 0, j = 0; i < n; i += step, j++) {
          pos.getElement(i, v);
          xyz[j * 3] = v[0]!; xyz[j * 3 + 1] = v[1]!; xyz[j * 3 + 2] = v[2]!;
          if (col) {
            col.getElement(i, v);
            // Colours are stored linear; the renderer takes vertex colours as linear too.
            rgb[j * 3] = Math.round(Math.min(1, v[0]!) * 255); rgb[j * 3 + 1] = Math.round(Math.min(1, v[1]!) * 255); rgb[j * 3 + 2] = Math.round(Math.min(1, v[2]!) * 255);
          } else {
            rgb[j * 3] = rgb[j * 3 + 1] = rgb[j * 3 + 2] = 200;
          }
        }
        for (const sem of p.listSemantics()) p.setAttribute(sem, null);
        p.setIndices(null);
        p.setAttribute("POSITION", out.createAccessor().setType("VEC3").setArray(xyz));
        p.setAttribute("COLOR_0", out.createAccessor().setType("VEC3").setArray(rgb).setNormalized(true));
        points += kept;
      }
    }
    await out.transform(dedup(), prune(), unpartition(), draco({ method: "sequential" }));
  } else {
    if (tier) {
      await MeshoptSimplifier.ready;
      await out.transform(
        weld(),
        ...(tier.ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio: tier.ratio, error: tier.error ?? 0.001 })] : []),
        textureCompress({ encoder: sharp, targetFormat: "webp", quality: 85, resize: [tier.textureSize, tier.textureSize] }),
      );
    }
    await out.transform(dedup(), prune(), unpartition(), draco({ method: "edgebreaker" }));
  }

  let triangles = 0;
  if (!cloud) for (const m of root.listMeshes()) {
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
    points: cloud ? points : null,
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
    rungs.push({ quality, url: `/assets/${artId}/${file}`, bytes: r.bytes, triangles: r.triangles, ...(r.points != null ? { points: r.points } : {}), textureSize: r.textureSize, draco: true });
    bounds = r.bounds;
    console.log(`${artId}: ${quality} ${(r.bytes / 1024).toFixed(0)} KB, ${r.points != null ? `${r.points} points` : `${r.triangles} tris`}, ${r.textureSize ?? "no"} px textures`);
  }
  version.rungs = rungs;
  version.bounds = { width: round(bounds.width), height: round(bounds.height), depth: round(bounds.depth) };
  version.original.triangles = rungs.at(-1)?.triangles ?? null;
  version.original.format = "voyager-document";
}

/** Tiers built from one source file, mirroring the Smithsonian ladder. */
const LOCAL_TIERS: Record<Quality, TierOptions> = {
  thumb: { ratio: 0.05, points: 0.01, textureSize: 512, error: 0.01 },
  low: { ratio: 0.35, points: 0.04, textureSize: 1024, error: 0.004 },
  medium: { ratio: 0.6, points: 0.12, textureSize: 2048, error: 0.002 },
  high: { ratio: 1, points: 0.25, textureSize: 4096 },
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
    const r = await mergeParts([path.join(dir, src)], unitScale, path.join(OUT_DIR, artId, file), LOCAL_TIERS[quality], version.original.rotation, version.original.omit);
    rungs.push({ quality, url: `/assets/${artId}/${file}`, bytes: r.bytes, triangles: r.triangles, ...(r.points != null ? { points: r.points } : {}), textureSize: r.textureSize, draco: r.points == null });
    bounds = r.bounds;
    console.log(`${artId}: ${quality} ${(r.bytes / 1024).toFixed(0)} KB, ${r.points != null ? `${r.points} points` : `${r.triangles} tris`}, ${r.textureSize ?? "no"} px textures`);
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

/** Build the rungs of one asset. `dir` is the path under public/assets: the id, or id/altN for an alternate. */
async function buildAsset(dir: string, asset: Artwork["asset"], art: Artwork): Promise<boolean> {
  let touched = false;
  if (asset.kind === "image") {
    for (const version of asset.versions) {
      if (version.provenance === "wikimedia-commons") await fetchCommonsImage(dir, version);
      else if (version.provenance === "typeset") await buildTypeset(dir, version, art.physical);
      else if (version.provenance === "video-still") await buildVideoStill(dir, version);
      else if (version.provenance === "screenshot" || version.provenance === "user-upload") await buildLocalImage(dir, version);
      else continue;
      touched = true;
    }
  } else if (asset.kind === "sim") {
    // Nothing to fetch: a program in src/sims runs it.
  } else {
    for (const version of asset.versions) {
      if (version.provenance === "smithsonian-3d") await fetchSmithsonianModel(dir, version);
      else if (["zenodo", "sketchfab", "user-upload"].includes(version.provenance)) {
        if (!(await buildLocalModel(dir, version))) continue;
      } else continue;
      touched = true;
    }
  }
  return touched;
}

async function main() {
  const collection = JSON.parse(await readFile(COLLECTION, "utf8")) as Collection;
  // `npm run fetch-assets -- <id> <id>` builds only those works.
  const only = new Set(process.argv.slice(2));
  for (const art of collection.artworks) {
    if (only.size > 0 && !only.has(art.id)) continue;
    let touched = await buildAsset(art.id, art.asset, art);
    for (const [i, alt] of (art.alternates ?? []).entries()) {
      if (await buildAsset(`${art.id}/alt${i + 1}`, alt, art)) touched = true;
    }
    for (const version of art.audio?.versions ?? []) {
      await buildAudio(art.id, version);
      touched = true;
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
