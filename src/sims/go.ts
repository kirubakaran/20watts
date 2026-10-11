/**
 * A game of Go replayed on a demonstration board, stone by stone, as the
 * commentators' boards showed it: here game 2 of AlphaGo against Lee
 * Sedol, Seoul, 10 March 2016, in which the machine's 37th move, a
 * shoulder hit on the fifth line that no professional would have
 * played, was described by Lee as "beautiful" and by Fan Hui as "not a
 * human move". The game runs to the end, pauses at move 37, pauses at
 * Lee's resignation after move 211, and begins again. Captures are
 * played out properly.
 *
 * Params: moves (the game as SGF coordinate pairs, "pdqc...", Black
 * first), pause (the move to dwell on, default 37), note (what to say
 * there), secondsPerMove (default 1.1), size (board width in metres).
 */
import { Group } from "three";
import { Panel, INK, INK_SOFT, ACCENT, num, type Program } from "./index";

const N = 19;
const WOOD = "#d8b878";
const LINE = "#5a4a2c";
const STAR = [3, 9, 15];

type Board = Int8Array; // 0 empty, 1 black, 2 white

function neighbours(i: number): number[] {
  const x = i % N, y = Math.floor(i / N), out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < N - 1) out.push(i + 1);
  if (y > 0) out.push(i - N);
  if (y < N - 1) out.push(i + N);
  return out;
}

/** The group containing `i`, and whether it has any liberty. */
function group(board: Board, i: number): { stones: number[]; alive: boolean } {
  const colour = board[i]!;
  const seen = new Set<number>([i]);
  const stack = [i];
  const stones: number[] = [];
  let alive = false;
  while (stack.length) {
    const s = stack.pop()!;
    stones.push(s);
    for (const n of neighbours(s)) {
      const v = board[n]!;
      if (v === 0) alive = true;
      else if (v === colour && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return { stones, alive };
}

/** Play a stone; remove any opposing groups left without liberties. */
function play(board: Board, i: number, colour: number) {
  board[i] = colour;
  for (const n of neighbours(i)) {
    if (board[n] === 3 - colour) {
      const g = group(board, n);
      if (!g.alive) for (const s of g.stones) board[s] = 0;
    }
  }
}

export const go: Program = (params, bounds) => {
  const sgf = typeof params.moves === "string" ? params.moves : "";
  const moves: number[] = [];
  for (let k = 0; k + 1 < sgf.length; k += 2) {
    const x = sgf.charCodeAt(k) - 97, y = sgf.charCodeAt(k + 1) - 97;
    if (x >= 0 && x < N && y >= 0 && y < N) moves.push(y * N + x);
  }
  const pauseAt = Math.round(num(params, "pause", 37));
  const note = typeof params.note === "string" ? params.note : "";
  const perMove = num(params, "secondsPerMove", 1.1);
  const size = num(params, "size", Math.min(bounds.width, bounds.height * 0.9));
  const strip = size * 0.1;
  const panel = new Panel(size, size + strip, 540, 30);
  const px = panel.w;
  const cell = (px * 0.92) / (N - 1);
  const x0 = (px - cell * (N - 1)) / 2;
  const stoneR = cell * 0.485;

  const board: Board = new Int8Array(N * N);
  let played = 0;
  let clock = 0;
  let hold = 0;
  let last = -1;

  const at = (i: number) => [x0 + (i % N) * cell, x0 + Math.floor(i / N) * cell] as const;

  const paint = () => {
    const ctx = panel.ctx;
    ctx.fillStyle = WOOD;
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#f3eee3";
    ctx.fillRect(0, px, px, panel.h - px);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = Math.max(1, px * 0.0016);
    ctx.beginPath();
    for (let k = 0; k < N; k++) {
      ctx.moveTo(x0, x0 + k * cell); ctx.lineTo(x0 + (N - 1) * cell, x0 + k * cell);
      ctx.moveTo(x0 + k * cell, x0); ctx.lineTo(x0 + k * cell, x0 + (N - 1) * cell);
    }
    ctx.stroke();
    ctx.fillStyle = LINE;
    for (const a of STAR) for (const b of STAR) {
      ctx.beginPath(); ctx.arc(x0 + a * cell, x0 + b * cell, px * 0.004, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < N * N; i++) {
      const v = board[i]!;
      if (!v) continue;
      const [cx, cy] = at(i);
      const g = ctx.createRadialGradient(cx - stoneR * 0.35, cy - stoneR * 0.4, stoneR * 0.1, cx, cy, stoneR);
      if (v === 1) { g.addColorStop(0, "#5a5a5a"); g.addColorStop(1, "#0c0c0c"); }
      else { g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#cfcac0"); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, stoneR, 0, Math.PI * 2); ctx.fill();
    }
    if (last >= 0 && board[last]) {
      const [cx, cy] = at(last);
      ctx.strokeStyle = played === pauseAt ? ACCENT : board[last] === 1 ? "#ffffff" : "#000000";
      ctx.lineWidth = px * 0.004;
      ctx.beginPath(); ctx.arc(cx, cy, stoneR * 0.5, 0, Math.PI * 2); ctx.stroke();
    }
    // The strip: whose move, and the note when dwelling.
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(px * 0.03)}px system-ui, sans-serif`;
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    const y = px + (panel.h - px) / 2;
    const who = played === 0 ? "" : played % 2 ? "Black, AlphaGo" : "White, Lee Sedol";
    ctx.fillText(played === 0 ? "AlphaGo v Lee Sedol, game 2 · Seoul, 10 March 2016" : `Move ${played} · ${who}`, x0, y);
    ctx.textAlign = "right";
    ctx.fillStyle = played === pauseAt ? ACCENT : INK_SOFT;
    const msg = played === pauseAt ? note : played >= moves.length ? "Lee Sedol resigns" : "";
    ctx.fillText(msg, px - x0, y);
  };
  panel.paint(paint);
  const group = new Group();
  group.add(panel.mesh);

  return {
    object: group,
    update(dt, distance) {
      if (distance > 60) return;
      if (hold > 0) { hold -= dt; return; }
      clock += dt;
      if (clock < perMove) return;
      clock = 0;
      if (played >= moves.length) {
        board.fill(0); played = 0; last = -1;
        panel.paint(paint);
        hold = 2;
        return;
      }
      last = moves[played]!;
      play(board, last, played % 2 === 0 ? 1 : 2);
      played += 1;
      panel.paint(paint);
      if (played === pauseAt) hold = 7;
      else if (played >= moves.length) hold = 8;
    },
    dispose() { panel.dispose(); },
    residentBytes: panel.residentBytes,
  };
};
