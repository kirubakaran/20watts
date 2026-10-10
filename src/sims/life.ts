/**
 * Conway's Game of Life (1970), run on a slab lying on the floor so you
 * look down into it. A cell lives with two or three neighbours and is
 * born with exactly three; nothing else. The slab is seeded with a glider
 * gun and an R-pentomino and starts again when the board goes still.
 *
 * Params: cells (grid size, default 96), stepsPerSecond (default 6).
 */
import { Group } from "three";
import { Panel, INK, RULE, num, type Program } from "./index";

export const life: Program = (params, bounds) => {
  const n = Math.round(num(params, "cells", 96));
  const rate = num(params, "stepsPerSecond", 6);
  const size = Math.min(bounds.width, bounds.depth);
  const panel = new Panel(size, size, Math.max(240, (n * 5) / size), 30);
  // Lying flat, top face up, oriented so a visitor standing at +Z reads it upright.
  panel.mesh.rotation.x = -Math.PI / 2;
  panel.mesh.position.set(0, bounds.height, 0);
  const group = new Group();
  group.add(panel.mesh);

  let cells = new Uint8Array(n * n);
  let next = new Uint8Array(n * n);
  let still = 0;
  let generation = 0;
  let acc = 0;

  const set = (x: number, y: number) => {
    cells[((y + n) % n) * n + ((x + n) % n)] = 1;
  };
  const stamp = (x0: number, y0: number, rows: string[]) => {
    rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch === "O" && set(x0 + dx, y0 + dy)));
  };
  const seed = () => {
    cells.fill(0);
    generation = 0;
    still = 0;
    // Gosper's glider gun, top left; it fires a glider every 30 generations.
    stamp(2, 4, [
      "........................O...........",
      "......................O.O...........",
      "............OO......OO............OO",
      "...........O...O....OO............OO",
      "OO........O.....O...OO..............",
      "OO........O...O.OO....O.O...........",
      "..........O.....O.......O...........",
      "...........O...O....................",
      "............OO......................",
    ]);
    // An R-pentomino lower right: five cells that take 1,103 generations to settle.
    stamp(Math.round(n * 0.65), Math.round(n * 0.6), [".OO", "OO.", ".O."]);
  };
  seed();

  const step = () => {
    let changed = 0;
    for (let y = 0; y < n; y++) {
      const up = ((y + n - 1) % n) * n, row = y * n, down = ((y + 1) % n) * n;
      for (let x = 0; x < n; x++) {
        const l = (x + n - 1) % n, r = (x + 1) % n;
        const k = cells[up + l]! + cells[up + x]! + cells[up + r]! + cells[row + l]! + cells[row + r]! + cells[down + l]! + cells[down + x]! + cells[down + r]!;
        const alive = cells[row + x]!;
        const v = k === 3 || (alive && k === 2) ? 1 : 0;
        next[row + x] = v;
        if (v !== alive) changed++;
      }
    }
    [cells, next] = [next, cells];
    generation++;
    still = changed === 0 ? still + 1 : 0;
    // Still, or stuck in a short cycle for a long while: start over.
    if (still > 20 || generation > 4000) seed();
  };

  const paint = () => {
    const ctx = panel.ctx;
    const w = panel.w;
    panel.clear();
    const cell = w / n;
    // Faint grid.
    ctx.strokeStyle = RULE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i += 8) {
      ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, w);
      ctx.moveTo(0, i * cell); ctx.lineTo(w, i * cell);
    }
    ctx.stroke();
    ctx.fillStyle = INK;
    const inset = cell * 0.12;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (cells[y * n + x]) ctx.fillRect(x * cell + inset, y * cell + inset, cell - 2 * inset, cell - 2 * inset);
    }
    ctx.font = `${Math.round(w * 0.022)}px system-ui, sans-serif`;
    ctx.fillStyle = "#8a857c";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`generation ${generation}`, w - w * 0.02, w - w * 0.015);
  };
  panel.paint(paint);

  return {
    object: group,
    update(dt, distance) {
      panel.draw(dt, distance, (elapsed) => {
        acc += elapsed * rate;
        let steps = Math.min(4, Math.floor(acc));
        acc -= steps;
        while (steps-- > 0) step();
        paint();
      });
    },
    dispose: () => panel.dispose(),
    residentBytes: panel.residentBytes,
  };
};
