#!/usr/bin/env node
/**
 * Photograph the museum: one headless Chrome, one capture per stop, into a
 * folder with an index page, so a session's changes can be looked over in
 * one scroll and compared with the last run. Stops are the tour by default;
 * ALL=1 photographs every work from its standing point; MODELS=1 instead
 * photographs each model's top rung on the preview page, front, left, top
 * and back on a grid, which is where a wrong axis or a lost material shows.
 *
 * The previous run is kept beside the new one (<outDir>-prev) and every
 * capture is compared with its predecessor: the share of pixels that
 * changed noticeably is printed, stops over CHANGED (default 3%) are
 * listed as changed, and the index shows the old picture under the new
 * for those, so a regression is a scroll away rather than a memory.
 *
 * Usage:
 *   node scripts/dev/gallery.mjs [url] [outDir]
 *   npm run gallery
 * Environment:
 *   DWELL=6       seconds to settle at each stop before the capture
 *   LIMIT=900     hard wall-clock limit for the whole run
 *   ALL=1         every work, not only the tour
 *   MODELS=1      the preview grid of every model instead
 *   ONLY=a,b      only these ids (or id fragments)
 *   CHANGED=3     per cent of pixels that must differ for a stop to count as changed
 *   SIZE, SOFTWARE_GL, CHROME as for screenshot.mjs
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { openChrome } from "./chrome.mjs";

const [url = "https://localhost:5173/", outDir = "gallery"] = process.argv.slice(2);
const DWELL = Number(process.env.DWELL ?? 6) * 1000;
const LIMIT = Number(process.env.LIMIT ?? 900) * 1000;
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const CHANGED = Number(process.env.CHANGED ?? 3);
const wanted = (id) => !ONLY || ONLY.some((o) => id.includes(o));
const prevDir = `${outDir.replace(/\/$/, "")}-prev`;

/** Share of pixels, 0 to 1, that differ by more than a little between two captures of the same size. */
async function changedShare(a, b) {
  const [p, q] = await Promise.all([a, b].map((f) => sharp(f).raw().toBuffer({ resolveWithObject: true })));
  if (p.info.width !== q.info.width || p.info.height !== q.info.height) return 1;
  const n = p.info.width * p.info.height, ch = p.info.channels;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    if (Math.abs(p.data[o] - q.data[o]) + Math.abs(p.data[o + 1] - q.data[o + 1]) + Math.abs(p.data[o + 2] - q.data[o + 2]) > 48) changed += 1;
  }
  return changed / n;
}

/** Compare a fresh capture with the previous run's; returns the changed share, or null without a predecessor. */
async function compare(file) {
  const old = path.join(prevDir, file);
  try { await stat(old); } catch { return null; }
  return changedShare(old, path.join(outDir, file));
}

const { page, shutdown } = await openChrome({ limitMs: LIMIT });
const shots = [];
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const index = () => `<!doctype html><meta charset="utf-8"><title>20watts gallery</title>
<style>body{font:14px system-ui;margin:16px;background:#f3eee3;color:#2a2824}figure{margin:0 0 24px}img{max-width:100%;border:1px solid #d9d3c6}figcaption{margin:4px 0}.changed figcaption{color:#a8503a}.prev{opacity:.85}</style>
<h1>${shots.length} captures, ${new Date().toISOString()}${shots.some((s) => s.changed != null) ? `; ${shots.filter((s) => s.changed > CHANGED / 100).length} changed by more than ${CHANGED}% since the last run` : ""}</h1>
${shots.map((s) => `<figure${s.changed > CHANGED / 100 ? ' class="changed"' : ""}><img src="${s.file}" loading="lazy"><figcaption><b>${s.title ?? s.id}</b> · ${s.id}${s.note ? ` · ${s.note}` : ""}${s.changed != null ? ` · ${pct(s.changed)} changed` : ""}</figcaption>${s.changed > CHANGED / 100 ? `<img class="prev" src="../${path.basename(prevDir)}/${s.file}" loading="lazy"><figcaption>before</figcaption>` : ""}</figure>`).join("\n")}`;

try {
  // Keep the last run for comparison; one generation back is enough.
  try { await stat(outDir); await rm(prevDir, { recursive: true, force: true }); await rename(outDir, prevDir); } catch {}
  await mkdir(outDir, { recursive: true });
  if (process.env.MODELS) {
    const u = new URL(url);
    u.searchParams.set("probe", "");
    await page.navigate(u.toString());
    await page.ready();
    const models = await page.evaluate("window.__20watts.models()");
    for (const m of models) {
      if (!wanted(m.id)) continue;
      const p = new URL("/scripts/dev/preview.html", url);
      p.searchParams.set("model", m.url);
      await page.navigate(p.toString());
      await page.sleep(DWELL);
      const file = `model-${m.id}.png`;
      await writeFile(path.join(outDir, file), await page.screenshot());
      const changed = await compare(file);
      shots.push({ id: m.id, title: m.title, file, note: m.url, changed });
      console.log(`${file}  ${m.title}${changed != null ? `  (${pct(changed)} changed)` : ""}`);
    }
  } else {
    const u = new URL(url);
    u.searchParams.set("probe", "");
    u.searchParams.set("spawn", "start");
    await page.navigate(u.toString());
    await page.ready();
    const ids = await page.evaluate(process.env.ALL ? "window.__20watts.ids()" : "window.__20watts.tour()");
    const titles = Object.fromEntries(await page.evaluate("window.__20watts.titles()"));
    for (const id of ids) {
      if (!wanted(id)) continue;
      await page.ready(); // the dev server reloads the page when a file changes underneath it
      if (!(await page.evaluate(`window.__20watts.goTo(${JSON.stringify(id)})`))) { console.log(`${id}: not on display`); continue; }
      await page.sleep(DWELL);
      const file = `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
      await writeFile(path.join(outDir, file), await page.screenshot());
      const changed = await compare(file);
      shots.push({ id, title: titles[id], file, changed });
      console.log(`${file}  ${titles[id] ?? ""}${changed != null ? `  (${pct(changed)} changed)` : ""}`);
    }
  }
  await writeFile(path.join(outDir, "index.html"), index());
  const changedShots = shots.filter((s) => s.changed > CHANGED / 100);
  console.log(`${shots.length} captures; open ${path.join(outDir, "index.html")}`);
  if (changedShots.length) console.log(`changed by more than ${CHANGED}% since the last run: ${changedShots.map((s) => `${s.id} (${pct(s.changed)})`).join(", ")}`);
  else if (shots.some((s) => s.changed != null)) console.log("nothing changed by more than " + CHANGED + "% since the last run");
  if (page.errors.length) console.log(`${page.errors.length} console errors/warnings, first: ${page.errors[0]}`);
  await shutdown(0);
} catch (e) {
  await writeFile(path.join(outDir, "index.html"), index()).catch(() => {});
  await shutdown(1, String(e?.stack ?? e));
}
