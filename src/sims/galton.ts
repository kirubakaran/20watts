/**
 * Galton's board (1873): balls fall through rows of pegs, bouncing left
 * or right at each with even odds, and pile up below in the bell curve.
 * Francis Galton built it to show how many small chances add up to the
 * normal distribution; here the balls never run out. When the bins are
 * full the board empties and begins again, and the expected curve is
 * drawn faintly over the pile.
 *
 * Params: rows (default 12), perSecond (balls released, default 6).
 */
import { Group } from "three";
import { Panel, INK, INK_SOFT, RULE, ACCENT, caption, num, type Program } from "./index";

interface Ball {
  /** Left (0) or right (1) at each row. */
  path: Uint8Array;
  /** Progress in rows, fractional. */
  t: number;
}

export const galton: Program = (params, bounds) => {
  const rows = Math.round(num(params, "rows", 12));
  const perSecond = num(params, "perSecond", 6);
  const panel = new Panel(bounds.width, bounds.height, 420, 30);
  const group = new Group();
  group.add(panel.mesh);

  const w = panel.w, h = panel.h;
  const bins = rows + 1;
  const pitch = w / (bins + 2);
  const topY = h * 0.12, pegGap = (h * 0.5) / rows;
  const binsTop = topY + rows * pegGap + pegGap;
  const binsBottom = h * 0.94;
  const counts = new Uint16Array(bins);
  const dotR = pitch * 0.17;
  const perColumn = Math.floor((binsBottom - binsTop) / (dotR * 2.1));
  const balls: Ball[] = [];
  let total = 0, release = 0, resting = 0;

  const pegX = (row: number, i: number) => w / 2 + (i - row / 2) * pitch;
  const fallSpeed = 7; // rows per second

  const paint = () => {
    const ctx = panel.ctx;
    panel.clear();
    // Pegs.
    ctx.fillStyle = INK_SOFT;
    for (let r = 0; r < rows; r++) for (let i = 0; i <= r; i++) {
      ctx.beginPath(); ctx.arc(pegX(r, i), topY + r * pegGap, pitch * 0.09, 0, Math.PI * 2); ctx.fill();
    }
    // Bin walls.
    ctx.strokeStyle = RULE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let b = 0; b <= bins; b++) {
      const x = w / 2 + (b - bins / 2) * pitch;
      ctx.moveTo(x, binsTop); ctx.lineTo(x, binsBottom);
    }
    ctx.moveTo(w / 2 - (bins / 2) * pitch, binsBottom); ctx.lineTo(w / 2 + (bins / 2) * pitch, binsBottom);
    ctx.stroke();
    // Piles.
    ctx.fillStyle = INK;
    for (let b = 0; b < bins; b++) {
      const x = w / 2 + (b - bins / 2 + 0.5) * pitch;
      for (let k = 0; k < Math.min(counts[b]!, perColumn); k++) {
        ctx.beginPath(); ctx.arc(x, binsBottom - dotR - k * dotR * 2.1, dotR, 0, Math.PI * 2); ctx.fill();
      }
    }
    // The expected curve, scaled to the pile.
    if (total > 10) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      const peak = Math.min(perColumn, Math.max(...counts));
      // Binomial(rows, 1/2) relative to its mode.
      const mode = binomial(rows, rows / 2);
      for (let px = 0; px <= bins * pitch; px += 3) {
        const k = px / pitch - 0.5;
        const y = binsBottom - (binomialReal(rows, k) / mode) * peak * dotR * 2.1;
        const x = w / 2 - (bins / 2) * pitch + px;
        if (px === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Falling balls.
    ctx.fillStyle = ACCENT;
    for (const ball of balls) {
      const r = Math.floor(ball.t), f = ball.t - r;
      let i = 0;
      for (let k = 0; k < r; k++) i += ball.path[k]!;
      const x0 = pegX(r, i) - (r < rows ? 0 : pitch / 2 - ball.path[rows - 1]! * pitch);
      const x1 = r < rows ? pegX(r + 1, i + ball.path[r]!) : x0;
      const x = x0 + (x1 - x0) * f;
      const y = topY + (r - 1) * pegGap + f * pegGap + pegGap * 0.5;
      ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = `${Math.round(w * 0.032)}px system-ui, sans-serif`;
    ctx.fillStyle = INK_SOFT;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${total} balls`, w * 0.97, h * 0.025);
    caption(panel, `${rows} rows of pegs, even odds at each`);
  };
  paint();

  return {
    object: group,
    update(dt, distance) {
      panel.draw(dt, distance, (elapsed) => {
        if (resting > 0) {
          resting -= elapsed;
          if (resting <= 0) { counts.fill(0); total = 0; }
          paint();
          return;
        }
        release += elapsed * perSecond;
        while (release >= 1 && balls.length < 40) {
          release -= 1;
          const path = new Uint8Array(rows);
          for (let k = 0; k < rows; k++) path[k] = Math.random() < 0.5 ? 0 : 1;
          balls.push({ path, t: 0 });
        }
        for (let i = balls.length - 1; i >= 0; i--) {
          const ball = balls[i]!;
          ball.t += elapsed * fallSpeed;
          if (ball.t >= rows + 1) {
            let bin = 0;
            for (let k = 0; k < rows; k++) bin += ball.path[k]!;
            counts[bin]!++;
            total++;
            balls.splice(i, 1);
            if (counts[bin]! >= perColumn) resting = 6;
          }
        }
        paint();
      });
    },
    dispose: () => panel.dispose(),
    residentBytes: panel.residentBytes,
  };
};

function lnGamma(x: number): number {
  // Lanczos approximation, plenty for a dashed curve.
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** C(n, k) / 2^n for real k, so the curve is smooth between the bins. */
function binomialReal(n: number, k: number): number {
  if (k < -0.5 || k > n + 0.5) return 0;
  const kk = Math.min(Math.max(k, 0), n);
  return Math.exp(lnGamma(n + 1) - lnGamma(kk + 1) - lnGamma(n - kk + 1) - n * Math.LN2);
}

function binomial(n: number, k: number): number {
  return binomialReal(n, k);
}
