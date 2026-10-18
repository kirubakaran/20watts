/**
 * The sound of a hand axe being made, for the Acheulean hand axe. Nobody
 * recorded a knapper under a free licence, so this sequences one real
 * strike of stone on stone (Freesound 539973, "Flint Strike" by Za-Games,
 * CC0) the way knapping goes: a few blows, a pause to turn the core and
 * look, a few more; each blow a little louder or softer, higher or lower.
 *
 *   node scripts/dev/knapping.mjs
 *
 * Writes data/originals/zen-21530762/knapping.mp3 (48 s). Then
 * `npm run fetch-assets -- zen-21530762` encodes it as the exhibit's sound.
 * Needs ffmpeg on the PATH.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "data/originals/zen-21530762");
const STRIKE_URL = "https://cdn.freesound.org/previews/539/539973_12029332-hq.mp3";
const strike = path.join(DIR, "flint-strike-539973.mp3");
const raw = path.join(DIR, "strike.raw");
const out = path.join(DIR, "knapping.mp3");
const SR = 44100;
const SECONDS = 48;

mkdirSync(DIR, { recursive: true });
if (!existsSync(strike)) {
  const buf = Buffer.from(await (await fetch(STRIKE_URL, { headers: { "user-agent": "20watts (https://20watts.org)" } })).arrayBuffer());
  writeFileSync(strike, buf);
}
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", strike, "-f", "s16le", "-ac", "1", "-ar", String(SR), raw]);
let src = new Int16Array(readFileSync(raw).buffer.slice(0));
const first = src.findIndex((v) => Math.abs(v) > 300);
src = src.subarray(Math.max(0, first - 40));

// A fixed sequence, so the file is the same every time it is made.
let seed = 20;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const between = (a, b) => a + (b - a) * rand();

const mix = new Float64Array(SR * SECONDS);
function blow(at, gain, rate) {
  const base = Math.round(at * SR);
  const n = Math.floor(src.length / rate);
  for (let i = 0; i < n; i++) {
    const p = i * rate;
    const j = Math.floor(p);
    if (j + 1 >= src.length || base + i >= mix.length) break;
    mix[base + i] += (src[j] * (1 - (p - j)) + src[j + 1] * (p - j)) * gain;
  }
}
let t = 0.8;
while (t < SECONDS - 2) {
  const blows = 2 + Math.floor(rand() * 5);
  for (let k = 0; k < blows; k++) {
    blow(t, between(0.35, 1), between(0.85, 1.25));
    t += between(0.45, 1.1);
  }
  t += between(1.2, 3); // turning the core, looking
}
let peak = 0;
for (const v of mix) peak = Math.max(peak, Math.abs(v));
const pcm = new Int16Array(mix.length);
for (let i = 0; i < mix.length; i++) pcm[i] = Math.round((mix[i] / peak) * 0.85 * 32767);
writeFileSync(raw, Buffer.from(pcm.buffer));
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ac", "1", "-ar", String(SR), "-i", raw, "-codec:a", "libmp3lame", "-q:a", "4", out]);
execFileSync("rm", [raw]);
console.log(`wrote ${path.relative(ROOT, out)}`);
