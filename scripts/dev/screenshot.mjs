#!/usr/bin/env node
/**
 * One bounded screenshot of the museum in headless Chrome.
 *
 * The museum renders continuously, and with software GL a headless Chrome
 * burns several cores for as long as it lives. This script therefore:
 *   - starts Chrome itself, in its own process group, with a small window,
 *   - takes exactly one capture after a fixed settle time,
 *   - kills the whole group on exit, error, timeout, SIGINT or SIGTERM,
 *   - gives up after LIMIT seconds no matter what.
 * Never launch Chrome by hand for a check; use this.
 *
 * Usage:
 *   node scripts/dev/screenshot.mjs <url> [out.png]
 * Environment:
 *   WAIT=12       seconds to let assets load before the capture
 *   LIMIT=45      hard wall-clock limit for the whole run
 *   SIZE=960x600  window size
 *   SOFTWARE_GL=1 use SwiftShader (slow, CPU-bound); default tries the GPU first
 *   CHROME=...    path to the Chrome binary
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const [url, out = "screenshot.png"] = process.argv.slice(2);
if (!url) {
  console.error("usage: screenshot.mjs <url> [out.png]");
  process.exit(2);
}
const WAIT = Number(process.env.WAIT ?? 12) * 1000;
const LIMIT = Number(process.env.LIMIT ?? 45) * 1000;
const [W, H] = (process.env.SIZE ?? "960x600").split("x").map(Number);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profile = await mkdtemp(path.join(tmpdir(), "musee-shot-"));
const args = [
  "--headless=new",
  `--user-data-dir=${profile}`,
  "--remote-debugging-port=0",
  "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required",
  `--window-size=${W},${H}`,
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-background-networking",
  "about:blank",
];
if (process.env.SOFTWARE_GL) args.push("--use-angle=swiftshader", "--enable-unsafe-swiftshader");

const chrome = spawn(CHROME, args, { detached: true, stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
chrome.stderr.on("data", (d) => (stderr += d));

let done = false;
async function shutdown(code, why) {
  if (done) return;
  done = true;
  if (why) console.error(why);
  try { process.kill(-chrome.pid, "SIGKILL"); } catch {}
  try { chrome.kill("SIGKILL"); } catch {}
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => shutdown(130, "interrupted"));
process.on("SIGTERM", () => shutdown(143, "terminated"));
process.on("uncaughtException", (e) => shutdown(1, String(e)));
const limiter = setTimeout(() => shutdown(3, `gave up after ${LIMIT / 1000}s`), LIMIT);
limiter.unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome writes "<port>\n<path>" here once it listens; port 0 avoids clashes.
async function devtoolsEndpoint() {
  const file = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    try {
      const [port, p] = (await readFile(file, "utf8")).trim().split("\n");
      return `ws://127.0.0.1:${port}${p}`;
    } catch {}
    await sleep(100);
  }
  throw new Error("Chrome did not start\n" + stderr);
}

async function main() {
  const ws = new WebSocket(await devtoolsEndpoint());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const call = (method, params = {}, sessionId) =>
    new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId);
  await call("Page.navigate", { url }, sessionId);
  await sleep(WAIT);
  const { result } = await call("Page.captureScreenshot", { format: "png" }, sessionId);
  if (!result?.data) throw new Error("no screenshot data");
  await writeFile(out, Buffer.from(result.data, "base64"));
  console.log(`${out} (${W}x${H}, waited ${WAIT / 1000}s)`);
}

main().then(() => shutdown(0), (e) => shutdown(1, String(e?.stack ?? e)));
