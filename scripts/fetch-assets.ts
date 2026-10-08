/**
 * Asset pipeline, v1: for every Wikimedia-sourced image version, ask the
 * Commons API for a ladder of thumbnail widths, download them into
 * public/assets/<artwork id>/<width>.jpg, and write the resulting rungs back
 * into the collection. The museum then serves images from its own host and
 * never hotlinks Commons.
 *
 * Usage: npm run fetch-assets
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Collection, ImageRung } from "../src/data/types";

const ROOT = path.resolve(import.meta.dirname, "..");
const COLLECTION = path.join(ROOT, "src/data/collection.json");
const OUT_DIR = path.join(ROOT, "public/assets");
const TARGET_WIDTHS = [1024, 2048, 4096];
const USER_AGENT = "vrmuseum/0.1 (https://github.com/kiru/vrmuseum)";

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
  const res = await fetch(api, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Commons API ${res.status} for ${title}`);
  const json = (await res.json()) as { query: { pages: Record<string, { imageinfo?: { thumburl: string; thumbwidth: number; thumbheight: number }[] }> } };
  const page = Object.values(json.query.pages)[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error(`No imageinfo for ${title}`);
  // Commons snaps to a fixed set of pre-rendered widths; the URL carries the real one.
  const real = /\/(\d+)px-/.exec(info.thumburl);
  const realWidth = real?.[1] ? Number(real[1]) : info.thumbwidth;
  const url = info.thumburl.split("?")[0]!;
  return { url, width: realWidth, height: Math.round((info.thumbheight / info.thumbwidth) * realWidth) };
}

async function download(url: string, dest: string): Promise<number> {
  try {
    const s = await stat(dest);
    if (s.size > 0) return s.size;
  } catch {}
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Download ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

async function main() {
  const collection = JSON.parse(await readFile(COLLECTION, "utf8")) as Collection;
  for (const art of collection.artworks) {
    if (art.asset.kind !== "image") continue;
    for (const version of art.asset.versions) {
      if (version.provenance !== "wikimedia-commons") continue;
      const title = commonsTitleFromUrl(version.original.url);
      const dir = path.join(OUT_DIR, art.id);
      await mkdir(dir, { recursive: true });
      const rungs = new Map<number, ImageRung>();
      for (const w of TARGET_WIDTHS) {
        if (w >= version.original.width) break;
        const t = await thumbInfo(title, w);
        if (rungs.has(t.width)) continue;
        const file = `${t.width}.jpg`;
        const bytes = await download(t.url, path.join(dir, file));
        rungs.set(t.width, { width: t.width, height: t.height, url: `/assets/${art.id}/${file}`, bytes });
        console.log(`${art.id}: ${t.width}px (${(bytes / 1024).toFixed(0)} KB)`);
      }
      version.rungs = [...rungs.values()].sort((a, b) => a.width - b.width);
    }
    art.updatedAt = new Date().toISOString();
  }
  await writeFile(COLLECTION, JSON.stringify(collection, null, 2) + "\n");
  console.log("collection.json updated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
