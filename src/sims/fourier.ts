/**
 * A Fourier series (1822) drawn as epicycles: circles riding on circles,
 * each turning at an odd multiple of the first's speed with a radius that
 * shrinks as 1/n, and the tip of the last one tracing a square wave as it
 * goes. Fourier's claim, that any periodic shape is a sum of sines, made
 * visible: add more circles and the corners get sharper.
 *
 * Params: terms (default 7), speed (turns of the first circle per second,
 * default 0.12).
 */
import { Group } from "three";
import { Panel, INK, INK_SOFT, RULE, ACCENT, caption, num, type Program } from "./index";

export const fourier: Program = (params, bounds) => {
  const terms = Math.round(num(params, "terms", 7));
  const speed = num(params, "speed", 0.12);
  const panel = new Panel(bounds.width, bounds.height, 420, 30);
  const group = new Group();
  group.add(panel.mesh);

  const w = panel.w, h = panel.h;
  const R = h * 0.3;
  const cx = w * 0.26, cy = h * 0.5;
  const waveX = w * 0.52;
  const samples = Math.round(w - waveX - w * 0.04);
  const wave = new Float32Array(samples);
  let count = 0;
  let angle = 0;

  const paint = () => {
    const ctx = panel.ctx;
    panel.clear();
    // Axis for the wave.
    ctx.strokeStyle = RULE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(waveX, cy); ctx.lineTo(w - w * 0.04, cy);
    ctx.stroke();

    // The circles.
    let x = cx, y = cy;
    ctx.lineWidth = 2;
    for (let k = 0; k < terms; k++) {
      const n = 2 * k + 1;
      const r = (R * 4) / (Math.PI * n);
      ctx.strokeStyle = RULE;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      const nx = x + r * Math.cos(n * angle), ny = y + r * Math.sin(n * angle);
      ctx.strokeStyle = k === terms - 1 ? ACCENT : INK;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      x = nx; y = ny;
    }
    // The tip, and the line carrying its height across to the wave.
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(waveX, y); ctx.stroke();
    ctx.setLineDash([]);

    // The wave, newest sample at the left.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < Math.min(count, samples); i++) {
      const px = waveX + i, py = wave[i]!;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.font = `${Math.round(w * 0.02)}px system-ui, sans-serif`;
    ctx.fillStyle = INK_SOFT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${terms} terms: sin θ + sin 3θ/3 + sin 5θ/5 + …`, w * 0.03, h * 0.04);
    caption(panel, "the tip of the last circle draws a square wave");
  };
  panel.paint(paint);

  return {
    object: group,
    update(dt, distance) {
      panel.draw(dt, distance, (elapsed) => {
        angle += elapsed * speed * Math.PI * 2;
        // One sample per redraw: the height of the tip.
        let y = cy;
        for (let k = 0; k < terms; k++) {
          const n = 2 * k + 1;
          y += ((R * 4) / (Math.PI * n)) * Math.sin(n * angle);
        }
        wave.copyWithin(1, 0, samples - 1);
        wave[0] = y;
        count++;
        paint();
      });
    },
    dispose: () => panel.dispose(),
    residentBytes: panel.residentBytes,
  };
};
