/**
 * Two black holes spiralling into one, as LIGO heard on 14 September
 * 2015: GW150914, thirty-six and twenty-nine suns a billion light-years
 * away, circling faster and closer until they merged in a fifth of a
 * second and rang down to one. The masses are drawn as black spheres over
 * a sheet of spacetime that they dent and that their motion ripples, the
 * waves spiralling outward at the sheet's own speed of light; a panel
 * below draws the strain, the stretch of space the detectors measured,
 * and at the moment of merger the recording LIGO made of it, pitched into
 * hearing, is played. Then it begins again.
 *
 * The inspiral follows the leading-order chirp, frequency rising as
 * (t_c - t)^(-3/8), slowed a hundredfold so it can be watched.
 *
 * Params: period (seconds for one inspiral, default 14), sound (url of
 * the chirp to play at merger), radius (metres of the spheres' orbit at
 * the start, default 1.1).
 */
import { BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from "three";
import { OneShot } from "../assets/sound";
import { Panel, INK, INK_SOFT, RULE, ACCENT, caption, num, type Program } from "./index";

export const merger: Program = (params, bounds) => {
  const period = num(params, "period", 14);
  const r0 = num(params, "radius", 1.1);
  const soundUrl = typeof params.sound === "string" ? params.sound : null;
  const group = new Group();
  const m1 = 36, m2 = 29;
  const q1 = m2 / (m1 + m2), q2 = m1 / (m1 + m2);
  const s1 = new Mesh(new SphereGeometry(0.11, 32, 24), new MeshBasicMaterial({ color: 0x000000 }));
  const s2 = new Mesh(new SphereGeometry(0.095, 32, 24), new MeshBasicMaterial({ color: 0x000000 }));
  const orbitY = bounds.height * 0.55;
  s1.position.y = s2.position.y = orbitY;
  group.add(s1, s2);

  // The sheet: a grid that the masses dent and the waves ripple.
  const N = 72;
  const sheetSize = bounds.width;
  const sheetGeom = new PlaneGeometry(sheetSize, sheetSize, N, N);
  sheetGeom.rotateX(-Math.PI / 2);
  const sheet = new Mesh(sheetGeom, new MeshStandardMaterial({ color: 0x6b7888, wireframe: true, transparent: true, opacity: 0.55 }));
  sheet.position.y = orbitY - 0.35;
  group.add(sheet);
  const basePos = (sheetGeom.attributes.position as BufferAttribute).array.slice() as Float32Array;

  // The strain, drawn below.
  const panel = new Panel(bounds.width, 0.5, 300, 24);
  panel.mesh.position.set(0, 0.02, bounds.depth / 2 - 0.02);
  group.add(panel.mesh);
  const samples = Math.round(panel.w * 0.9);
  const strain = new Float32Array(samples);
  let tx = 0;
  const px0 = panel.w * 0.05;
  const paint = () => {
    const ctx = panel.ctx;
    panel.clear();
    ctx.strokeStyle = RULE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px0, panel.h / 2); ctx.lineTo(px0 + samples, panel.h / 2); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < samples; i++) {
      const x = px0 + i, y = panel.h / 2 - strain[i]! * panel.h * 0.4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = INK_SOFT;
    ctx.font = `${Math.round(panel.w * 0.028)}px system-ui, sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("strain h(t): the stretch of space, as a detector sees it", px0, panel.h * 0.06);
    caption(panel, "slowed a hundred times; merger marked in red");
  };
  paint();

  const chirp = soundUrl ? new OneShot(soundUrl) : null;
  if (chirp?.node) {
    chirp.node.position.set(0, orbitY, 0);
    group.add(chirp.node);
  }

  let t = 0;
  let phase = 0;
  let played = false;
  const tc = period * 0.82; // merger time within the loop; the rest is ringdown and a pause
  const f0 = 0.35; // orbits per second at the start

  return {
    object: group,
    update(dt, distance) {
      if (distance > 60) return;
      t += dt;
      if (t > period) { t = 0; played = false; }
      let a: number, amp: number, f: number;
      if (t < tc) {
        const tau = Math.max(0.02, 1 - t / tc);
        f = f0 * Math.pow(tau, -3 / 8);
        a = r0 * Math.pow(f0 / f, 2 / 3);
        phase += dt * f * 2 * Math.PI;
        amp = Math.min(1, 0.12 / a);
        s1.visible = s2.visible = true;
        s1.position.x = Math.cos(phase) * a * q1; s1.position.z = Math.sin(phase) * a * q1;
        s2.position.x = -Math.cos(phase) * a * q2; s2.position.z = -Math.sin(phase) * a * q2;
      } else {
        // Ringdown: one hole, a wobble dying away.
        const u = t - tc;
        f = 2.2; a = 0; amp = Math.exp(-u * 3.5) * 0.9;
        phase += dt * f * 2 * Math.PI;
        s1.visible = true; s2.visible = false;
        s1.position.set(Math.sin(phase) * 0.02 * amp, orbitY, 0);
        s1.scale.setScalar(1.35);
        if (!played) { played = true; chirp?.play(); }
      }
      if (t < dt) s1.scale.setScalar(1);
      // The sheet: dents under the masses, and the quadrupole wave spiralling out.
      const pos = sheetGeom.attributes.position as BufferAttribute;
      const c = 1.6; // wave speed on the sheet, metres a second
      for (let i = 0; i < pos.count; i++) {
        const x = basePos[i * 3]!, z = basePos[i * 3 + 2]!;
        let y = 0;
        for (const s of [s1, s2]) {
          if (!s.visible) continue;
          const dx = x - s.position.x, dz = z - s.position.z;
          y -= 0.11 / (Math.hypot(dx, dz) + 0.09);
        }
        const r = Math.hypot(x, z), th = Math.atan2(z, x);
        const retarded = phase - (r / c) * 2 * Math.PI * f;
        y += amp * 0.045 * Math.cos(2 * (th - retarded)) / (0.4 + r);
        pos.setY(i, Math.max(-0.5, y));
      }
      pos.needsUpdate = true;
      // The strain trace: the wave at the detector, one sample per redraw.
      panel.draw(dt, distance, () => {
        tx += 1;
        strain.copyWithin(1, 0, samples - 1);
        strain[0] = amp * Math.cos(2 * phase) * (t < tc ? 1 : 1) ;
        paint();
        if (t >= tc && t < tc + 0.3) { panel.ctx.fillStyle = ACCENT; panel.ctx.fillRect(px0, panel.h * 0.2, 3, panel.h * 0.6); panel.texture.needsUpdate = true; }
      });
    },
    dispose() {
      s1.geometry.dispose(); (s1.material as MeshBasicMaterial).dispose();
      s2.geometry.dispose(); (s2.material as MeshBasicMaterial).dispose();
      sheetGeom.dispose(); (sheet.material as MeshStandardMaterial).dispose();
      panel.dispose();
      chirp?.dispose();
    },
    residentBytes: panel.residentBytes + N * N * 48,
  };
};

