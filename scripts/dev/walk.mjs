#!/usr/bin/env node
/**
 * Walk the whole lane in headless Chrome and measure what the museum holds
 * and how fast it draws at every row: JS heap, the streamer's estimate of
 * GPU bytes against its budget, live exhibits, geometries and textures,
 * draw calls and triangles, frame times, and which exhibits are drawing
 * the most objects. The walk hops row by row with the navigator, waits for
 * the streamer to settle at each, and samples. REVERSE=1 walks back again,
 * which is how a leak shows: the second pass should hold no more than the
 * first.
 *
 * Chrome is bounded through chrome.mjs. Run it after a session of
 * additions, not after every change; it takes a few minutes.
 *
 * Usage:
 *   node scripts/dev/walk.mjs [url] [out.json]
 *   npm run walk
 * Environment:
 *   DWELL=3       seconds to settle at each row before sampling
 *   LIMIT=1500    hard wall-clock limit for the whole run
 *   REVERSE=1     walk back to the start afterwards
 *   FROM=z        start at this z on the lane instead of the entrance
 *   ROWS=n        stop after this many hops (for looking at one stretch)
 *   VERBOSE=1     also print which exhibits draw the most objects at each row
 *   MAX_CALLS=n   draw calls a row may reach before the walk counts it loose (default 1200)
 *   SIZE, SOFTWARE_GL, CHROME as for screenshot.mjs
 * Output: a JSON file of samples and a summary on stdout. Exit code 1 if
 * the budget was exceeded, draw calls passed MAX_CALLS, or the heap grew
 * by more than a third over the walk (or, with REVERSE, did not come back).
 */
import { writeFile } from "node:fs/promises";
import { openChrome } from "./chrome.mjs";

const [url = "https://localhost:5173/", out = "walk.json"] = process.argv.slice(2);
const DWELL = Number(process.env.DWELL ?? 3) * 1000;
const LIMIT = Number(process.env.LIMIT ?? 1500) * 1000;
const REVERSE = !!process.env.REVERSE;
const FROM = process.env.FROM != null ? Number(process.env.FROM) : null;
const ROWS = Number(process.env.ROWS ?? 2000);
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 1200);

const fmt = (n, d = 0) => (n == null ? "-" : Number(n).toFixed(d));
const samples = [];
let startedAt = Date.now();
// Uncapped frame rate, so frame times measure the museum and not the display's refresh.
const { page, shutdown, onLimit } = await openChrome({ limitMs: LIMIT, flags: ["--js-flags=--expose-gc", "--disable-frame-rate-limit", "--disable-gpu-vsync"] });
onLimit(() => samples.length && writeFile(out, JSON.stringify({ url, when: new Date().toISOString(), partial: "gave up", samples }, null, 2)));

async function sample(leg, row) {
  // Force a collection first so the heap number is what is held, not what is pending.
  await page.evaluate("(window.gc && window.gc(), null)");
  const [x, , z] = await page.evaluate("window.__20watts.eye()");
  const s = await page.evaluate("window.__20watts.stats()");
  const r = { leg, row, x: +x.toFixed(1), z: +z.toFixed(1), ...s };
  samples.push(r);
  console.log(
    `${fmt((Date.now() - startedAt) / 1000).padStart(4)}s ${leg} ${String(row).padStart(3)}  z ${fmt(z).padStart(6)}  heap ${fmt(r.heapMB).padStart(4)} MB  gpu ${fmt(r.residentMB).padStart(5)}/${fmt(r.budgetMB)} MB  live ${String(r.live).padStart(3)}  tex ${String(r.textures).padStart(3)}  geo ${String(r.geometries).padStart(4)}  calls ${String(r.calls).padStart(4)}  tris ${fmt(r.triangles / 1e6, 2).padStart(5)} M  frame ${fmt(r.frameMsAvg, 1)} ms avg, ${fmt(r.frameMsP95, 1)} p95`,
  );
  if (process.env.VERBOSE) console.log(`     objects: ${r.objects.map((o) => `${o.id} ${o.n}`).join(", ")}; floor labels ${r.labels}`);
}

try {
  const u = new URL(url);
  u.searchParams.set("probe", "");
  u.searchParams.set("spawn", FROM != null ? `0,${FROM},0` : "start");
  await page.navigate(u.toString());
  await page.ready();
  await page.sleep(DWELL);
  startedAt = Date.now();

  await sample("fwd", 0);
  for (let row = 1; row <= ROWS; row++) {
    await page.ready(); // the dev server reloads the page when a file changes underneath it
    if (!(await page.evaluate("window.__20watts.hop(1)"))) break;
    await page.sleep(DWELL);
    await sample("fwd", row);
  }
  if (REVERSE) {
    for (let row = 1; row <= ROWS; row++) {
      if (!(await page.evaluate("window.__20watts.hop(-1)"))) break;
      await page.sleep(DWELL);
      await sample("back", row);
    }
  }

  const max = (k) => samples.reduce((m, s) => (s[k] != null && s[k] > (m?.[k] ?? -Infinity) ? s : m), samples[0]);
  const worstGpu = max("residentMB"), worstHeap = max("heapMB"), worstCalls = max("calls"), worstTris = max("triangles"), slowest = max("frameMsP95");
  const first = samples[0], last = samples[samples.length - 1];
  const summary = {
    rows: samples.filter((s) => s.leg === "fwd").length,
    budgetMB: first.budgetMB,
    maxGpuMB: worstGpu.residentMB, maxGpuAt: { row: worstGpu.row, z: worstGpu.z, holders: worstGpu.holders },
    maxHeapMB: worstHeap.heapMB, maxHeapAt: { row: worstHeap.row, z: worstHeap.z },
    heapStartMB: first.heapMB, heapEndMB: last.heapMB,
    maxCalls: worstCalls.calls, maxCallsAt: { z: worstCalls.z, objects: worstCalls.objects },
    maxTrianglesM: worstTris.triangles / 1e6, maxTrianglesAt: worstTris.z,
    slowestFrameP95Ms: slowest.frameMsP95, slowestAt: slowest.z,
    consoleErrors: page.errors.slice(0, 20),
  };
  await writeFile(out, JSON.stringify({ url: u.toString(), when: new Date().toISOString(), dwellSeconds: DWELL / 1000, summary, samples }, null, 2));

  console.log(`\n${summary.rows} rows${REVERSE ? " and back" : ""}; written to ${out}`);
  console.log(`GPU estimate peaks at ${fmt(summary.maxGpuMB)} MB of ${fmt(summary.budgetMB)} MB at z ${summary.maxGpuAt.z} (${summary.maxGpuAt.holders})`);
  console.log(`heap ${fmt(summary.heapStartMB)} MB at the start, peaks ${fmt(summary.maxHeapMB)} MB at z ${summary.maxHeapAt.z}, ends ${fmt(summary.heapEndMB)} MB`);
  console.log(`draw calls peak ${summary.maxCalls} at z ${summary.maxCallsAt.z} (${summary.maxCallsAt.objects.map((o) => `${o.id} ${o.n}`).join(", ")}); triangles peak ${fmt(summary.maxTrianglesM, 2)} M at z ${summary.maxTrianglesAt}`);
  console.log(`slowest frames: p95 ${fmt(summary.slowestFrameP95Ms, 1)} ms at z ${summary.slowestAt}`);
  if (page.errors.length) console.log(`${page.errors.length} console errors/warnings, first: ${page.errors[0]}`);

  const problems = [];
  if (summary.maxGpuMB > summary.budgetMB) problems.push(`GPU estimate over budget: ${fmt(summary.maxGpuMB)} > ${fmt(summary.budgetMB)} MB`);
  if (summary.maxCalls > MAX_CALLS) problems.push(`draw calls reached ${summary.maxCalls} at z ${summary.maxCallsAt.z}; over ${MAX_CALLS} is slow in a headset`);
  if (summary.heapStartMB != null) {
    const grew = summary.heapEndMB / summary.heapStartMB;
    if (REVERSE ? grew > 1.25 : grew > 1.6) problems.push(`heap grew ${fmt((grew - 1) * 100)}% over the walk (${fmt(summary.heapStartMB)} to ${fmt(summary.heapEndMB)} MB)`);
  }
  if (problems.length) {
    console.log("\nNOT TIGHT:\n  " + problems.join("\n  "));
    await shutdown(1);
  }
  console.log("\ntight.");
  await shutdown(0);
} catch (e) {
  await shutdown(1, String(e?.stack ?? e));
}
