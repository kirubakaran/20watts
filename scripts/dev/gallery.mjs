#!/usr/bin/env node
/**
 * Photograph the museum: one headless Chrome, one capture per stop, into a
 * folder with an index page, so a session's changes can be looked over in
 * one scroll and compared with the last run. Stops are the tour by default;
 * ALL=1 photographs every work from its standing point; MODELS=1 instead
 * photographs each model's top rung on the preview page, front, left, top
 * and back on a grid, which is where a wrong axis or a lost material shows.
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
 *   SIZE, SOFTWARE_GL, CHROME as for screenshot.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openChrome } from "./chrome.mjs";

const [url = "https://localhost:5173/", outDir = "gallery"] = process.argv.slice(2);
const DWELL = Number(process.env.DWELL ?? 6) * 1000;
const LIMIT = Number(process.env.LIMIT ?? 900) * 1000;
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const wanted = (id) => !ONLY || ONLY.some((o) => id.includes(o));

const { page, shutdown } = await openChrome({ limitMs: LIMIT });
const shots = [];
const index = () => `<!doctype html><meta charset="utf-8"><title>20watts gallery</title>
<style>body{font:14px system-ui;margin:16px;background:#f3eee3;color:#2a2824}figure{margin:0 0 24px}img{max-width:100%;border:1px solid #d9d3c6}figcaption{margin:4px 0}</style>
<h1>${shots.length} captures, ${new Date().toISOString()}</h1>
${shots.map((s) => `<figure><img src="${s.file}" loading="lazy"><figcaption><b>${s.title ?? s.id}</b> · ${s.id}${s.note ? ` · ${s.note}` : ""}</figcaption></figure>`).join("\n")}`;

try {
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
      shots.push({ id: m.id, title: m.title, file, note: m.url });
      console.log(`${file}  ${m.title}`);
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
      shots.push({ id, title: titles[id], file });
      console.log(`${file}  ${titles[id] ?? ""}`);
    }
  }
  await writeFile(path.join(outDir, "index.html"), index());
  console.log(`${shots.length} captures; open ${path.join(outDir, "index.html")}`);
  if (page.errors.length) console.log(`${page.errors.length} console errors/warnings, first: ${page.errors[0]}`);
  await shutdown(0);
} catch (e) {
  await writeFile(path.join(outDir, "index.html"), index()).catch(() => {});
  await shutdown(1, String(e?.stack ?? e));
}
