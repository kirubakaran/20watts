#!/usr/bin/env node
/**
 * One bounded screenshot of the museum in headless Chrome, through
 * chrome.mjs (own process group, killed on exit, hard time limit).
 *
 * Usage:
 *   node scripts/dev/screenshot.mjs <url> [out.png]
 * The url takes the museum's own parameters: ?at=<id> stands before a work,
 * ?spawn=x,z,yaw,pitch stands anywhere looking anywhere (degrees; pitch
 * positive is up), ?read opens the card, ?tour starts the tour.
 * Environment:
 *   WAIT=12       seconds to let assets load before the capture
 *   LIMIT=45      hard wall-clock limit for the whole run
 *   SIZE=960x600  window size
 *   SOFTWARE_GL=1 use SwiftShader (slow, CPU-bound); default tries the GPU first
 *   CHROME=...    path to the Chrome binary
 *   PROFILE=dir   keep this Chrome profile between runs (localStorage etc.)
 *   CONSOLE=1     print the page's console messages while waiting
 */
import { writeFile } from "node:fs/promises";
import { openChrome } from "./chrome.mjs";

const [url, out = "screenshot.png"] = process.argv.slice(2);
if (!url) {
  console.error("usage: screenshot.mjs <url> [out.png]");
  process.exit(2);
}
const WAIT = Number(process.env.WAIT ?? 12) * 1000;
const LIMIT = Number(process.env.LIMIT ?? 45) * 1000;

const { page, shutdown } = await openChrome({ limitMs: LIMIT, profile: process.env.PROFILE, console: !!process.env.CONSOLE });
try {
  await page.navigate(url);
  await page.sleep(WAIT);
  await writeFile(out, await page.screenshot());
  console.log(`${out} (${page.size.join("x")}, waited ${WAIT / 1000}s)`);
  await shutdown(0);
} catch (e) {
  await shutdown(1, String(e?.stack ?? e));
}
