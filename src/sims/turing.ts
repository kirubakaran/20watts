/**
 * A Turing machine (1936): a tape of cells, a head that reads one, and a
 * table of rules saying, for the state it is in and the symbol it sees,
 * what to write, which way to move and which state to be in next. This
 * one counts in binary, adding one to the number on the tape over and
 * over, the way Turing's paper shows that so little is enough to compute
 * anything that can be computed. The rule being applied is marked on the
 * table as it fires.
 *
 * Params: stepsPerSecond (default 2.5), cells (tape cells shown, default 24).
 */
import { Group } from "three";
import { Panel, INK, INK_SOFT, RULE, ACCENT, CREAM, caption, num, type Program } from "./index";

type State = "seek" | "add" | "home" | "halt";
interface Rule { state: State; read: string; write: string; move: "L" | "R" | "-"; next: State; }

/** Walk right to the end of the number, add one from the right carrying left, walk home, repeat. */
const RULES: Rule[] = [
  { state: "seek", read: "0", write: "0", move: "R", next: "seek" },
  { state: "seek", read: "1", write: "1", move: "R", next: "seek" },
  { state: "seek", read: " ", write: " ", move: "L", next: "add" },
  { state: "add", read: "1", write: "0", move: "L", next: "add" },
  { state: "add", read: "0", write: "1", move: "L", next: "home" },
  { state: "add", read: " ", write: "1", move: "L", next: "home" },
  { state: "home", read: "0", write: "0", move: "L", next: "home" },
  { state: "home", read: "1", write: "1", move: "L", next: "home" },
  { state: "home", read: " ", write: " ", move: "R", next: "seek" },
];

export const turing: Program = (params, bounds) => {
  const rate = num(params, "stepsPerSecond", 2.5);
  const shown = Math.round(num(params, "cells", 24));
  const panel = new Panel(bounds.width, bounds.height, 420, 30);
  const group = new Group();
  group.add(panel.mesh);

  const w = panel.w, h = panel.h;
  const tape = new Map<number, string>();
  tape.set(1, "1");
  let head = 0;
  let state: State = "seek";
  let fired = -1;
  let steps = 0;
  let acc = 0;
  let leftmost = 0;

  const step = () => {
    const sym = tape.get(head) ?? " ";
    const i = RULES.findIndex((r) => r.state === state && r.read === sym);
    if (i < 0) { state = "halt"; return; }
    const r = RULES[i]!;
    tape.set(head, r.write);
    head += r.move === "R" ? 1 : r.move === "L" ? -1 : 0;
    state = r.next;
    fired = i;
    steps++;
    leftmost = Math.min(leftmost, head);
  };

  const paint = () => {
    const ctx = panel.ctx;
    panel.clear();
    const cell = w / (shown + 1);
    const tapeY = h * 0.36;
    const first = Math.min(leftmost, head - 2);
    // The tape.
    ctx.lineWidth = 2;
    ctx.font = `${Math.round(cell * 0.55)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let k = 0; k < shown; k++) {
      const pos = first + k;
      const x = cell * 0.5 + k * cell;
      const under = pos === head;
      ctx.fillStyle = under ? "#e9e1cf" : CREAM;
      ctx.fillRect(x, tapeY - cell * 0.4, cell, cell * 0.8);
      ctx.strokeStyle = under ? INK : RULE;
      ctx.strokeRect(x, tapeY - cell * 0.4, cell, cell * 0.8);
      ctx.fillStyle = INK;
      ctx.fillText(tape.get(pos) ?? "", x + cell / 2, tapeY);
    }
    // The head.
    const hx = cell * 0.5 + (head - first) * cell + cell / 2;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(hx, tapeY - cell * 0.48);
    ctx.lineTo(hx - cell * 0.22, tapeY - cell * 0.8);
    ctx.lineTo(hx + cell * 0.22, tapeY - cell * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.font = `${Math.round(cell * 0.34)}px system-ui, sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.fillText(state, hx, tapeY - cell * 0.86);

    // The number so far, in decimal, beside the tape.
    const digits = [...tape.entries()].filter(([, s]) => s !== " ").sort((p, q) => p[0] - q[0]).map(([, s]) => s).join("");
    const decimal = digits ? BigInt("0b" + digits).toString() : "0";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `${Math.round(w * 0.022)}px system-ui, sans-serif`;
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(`${decimal} so far · ${steps} steps`, w * 0.03, h * 0.05);

    // The table, the rule just applied marked.
    const colW = w * 0.15, rowH = h * 0.085, tx = w * 0.14, ty = h * 0.58;
    ctx.font = `${Math.round(rowH * 0.5)}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const cols = ["state", "reads", "writes", "moves", "then"];
    ctx.fillStyle = INK_SOFT;
    cols.forEach((c, i) => ctx.fillText(c, tx + i * colW + colW / 2, ty - rowH * 0.6));
    RULES.forEach((r, i) => {
      const y = ty + i * (rowH * 0.47);
      if (i === fired) {
        ctx.fillStyle = "#efe4d0";
        ctx.fillRect(tx - colW * 0.1, y - rowH * 0.24, colW * 5.2, rowH * 0.48);
      }
      ctx.fillStyle = i === fired ? ACCENT : INK;
      [r.state, r.read === " " ? "blank" : r.read, r.write === " " ? "blank" : r.write, r.move === "L" ? "left" : r.move === "R" ? "right" : "stay", r.next]
        .forEach((c, k) => ctx.fillText(c, tx + k * colW + colW / 2, y));
    });
    caption(panel, "nine rules: add one in binary, forever");
  };
  paint();

  return {
    object: group,
    update(dt, distance) {
      panel.draw(dt, distance, (elapsed) => {
        acc += elapsed * rate;
        let n = Math.min(3, Math.floor(acc));
        acc -= n;
        while (n-- > 0) step();
        paint();
      });
    },
    dispose: () => panel.dispose(),
    residentBytes: panel.residentBytes,
  };
};
