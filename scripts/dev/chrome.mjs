/**
 * One bounded headless Chrome for the dev tools. The museum renders
 * continuously, and with software GL a headless Chrome burns several cores
 * for as long as it lives, so every tool goes through this: Chrome starts
 * in its own process group with a small window, is killed on exit, error,
 * timeout, SIGINT or SIGTERM, and gives up after a hard limit no matter
 * what. Never launch Chrome by hand for a check.
 *
 *   const { page, shutdown } = await openChrome({ limitMs, size, profile, console });
 *   await page.navigate(url); await page.sleep(ms);
 *   const value = await page.evaluate("expression");
 *   const png = await page.screenshot();
 *   await shutdown(0);
 *
 * Environment honoured by every tool: CHROME (binary path), SOFTWARE_GL=1
 * (SwiftShader), SIZE=WxH.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openChrome({ limitMs = 45_000, size = process.env.SIZE ?? "960x600", profile: keep, console: wantConsole = false, flags = [] } = {}) {
  const [W, H] = size.split("x").map(Number);
  const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const keepProfile = !!keep;
  const profile = keep || (await mkdtemp(path.join(tmpdir(), "20watts-chrome-")));
  if (keepProfile) await rm(path.join(profile, "DevToolsActivePort"), { force: true }).catch(() => {});
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
    ...flags,
    "about:blank",
  ];
  if (process.env.SOFTWARE_GL) args.push("--use-angle=swiftshader", "--enable-unsafe-swiftshader");

  const chrome = spawn(CHROME, args, { detached: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", (d) => (stderr += d));

  let done = false;
  const onLimit = [];
  async function shutdown(code, why) {
    if (done) return;
    done = true;
    if (why) console.error(why);
    try { process.kill(-chrome.pid, "SIGKILL"); } catch {}
    try { chrome.kill("SIGKILL"); } catch {}
    if (!keepProfile) await rm(profile, { recursive: true, force: true }).catch(() => {});
    process.exit(code);
  }
  process.on("SIGINT", () => shutdown(130, "interrupted"));
  process.on("SIGTERM", () => shutdown(143, "terminated"));
  process.on("uncaughtException", (e) => shutdown(1, String(e?.stack ?? e)));
  const limiter = setTimeout(async () => {
    for (const f of onLimit) await f().catch(() => {});
    shutdown(3, `gave up after ${limitMs / 1000}s`);
  }, limitMs);
  limiter.unref();

  // Chrome writes "<port>\n<path>" here once it listens; port 0 avoids clashes.
  let endpoint = null;
  for (let i = 0; i < 100 && !endpoint; i++) {
    try {
      const [port, p] = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
      endpoint = `ws://127.0.0.1:${port}${p}`;
    } catch { await sleep(100); }
  }
  if (!endpoint) throw new Error("Chrome did not start\n" + stderr);

  const ws = new WebSocket(endpoint);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (wantConsole) console.log(`[${m.params.type}] ${text}`);
      if (m.params.type === "error" || m.params.type === "warning") errors.push(text);
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description ?? "exception");
  };
  const call = (method, params = {}, sessionId) =>
    new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId);
  await call("Runtime.enable", {}, sessionId);

  const page = {
    size: [W, H],
    errors,
    sleep,
    navigate: (url) => call("Page.navigate", { url }, sessionId),
    async evaluate(expression) {
      const { result } = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text + ": " + (result.exceptionDetails.exception?.description ?? ""));
      return result?.result?.value;
    },
    async screenshot() {
      const { result } = await call("Page.captureScreenshot", { format: "png" }, sessionId);
      if (!result?.data) throw new Error("no screenshot data");
      return Buffer.from(result.data, "base64");
    },
    /** Wait until the museum's probe is up (the page must be opened with ?probe). */
    async ready(timeoutMs = 60_000) {
      for (let i = 0; i < timeoutMs / 200; i++) {
        if (await this.evaluate("typeof window.__20watts === 'object'")) return true;
        await sleep(200);
      }
      throw new Error("the museum did not expose its probe; is the dev server up, and the url opened with ?probe?");
    },
  };
  return { page, shutdown, onLimit: (f) => onLimit.push(f) };
}
