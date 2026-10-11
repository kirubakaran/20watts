/**
 * Bohr's atom (1913): hydrogen as a nucleus with one electron allowed only
 * on certain orbits, jumping between them and giving off or taking in a
 * flash of light whose colour is fixed by the jump. The electron here
 * runs round the shells, and every few seconds a photon comes in and
 * lifts it, or it falls and a photon leaves, in the colour hydrogen
 * really makes: the red, blue-green and violet of the Balmer lines, and
 * the ultraviolet of the fall to the ground state shown as a faint violet.
 *
 * The shells are drawn closer together than n-squared would put them, so
 * four fit in a panel; the proportions are a diagram's, the colours are
 * the spectrum's.
 *
 * Params: shells (default 4), diameter (metres, default 2.6).
 */
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, DoubleSide, Sprite, SpriteMaterial, CanvasTexture, Vector3 } from "three";
import { num, type Program } from "./index";

/** Wavelength of the n -> m line, nanometres, from the Rydberg formula. */
function wavelength(n: number, m: number): number {
  return 1 / (0.010973732 * (1 / (m * m) - 1 / (n * n)));
}

/** A visible wavelength to an sRGB colour, roughly; ultraviolet shown as faint violet, infrared as faint red. */
function colourOf(nm: number): [number, number, number] {
  if (nm < 380) return [0.45, 0.2, 0.7];
  if (nm > 750) return [0.6, 0.15, 0.1];
  let r = 0, g = 0, b = 0;
  if (nm < 440) (r = (440 - nm) / 60), (b = 1);
  else if (nm < 490) (g = (nm - 440) / 50), (b = 1);
  else if (nm < 510) (g = 1), (b = (510 - nm) / 20);
  else if (nm < 580) (r = (nm - 510) / 70), (g = 1);
  else if (nm < 645) (r = 1), (g = (645 - nm) / 65);
  else r = 1;
  return [r, g, b];
}

function glow(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export const atom: Program = (params, bounds) => {
  const shells = Math.round(num(params, "shells", 4));
  const diameter = num(params, "diameter", Math.min(bounds.width, bounds.height));
  const group = new Group();
  const centre = new Group();
  centre.position.y = bounds.height / 2;
  group.add(centre);
  // Shell radii: spaced so they fit, growing outward.
  const radii = Array.from({ length: shells }, (_, i) => (diameter / 2) * (0.14 + 0.86 * Math.pow((i + 1) / shells, 1.45)));
  for (const r of radii) {
    const ring = new Mesh(new RingGeometry(r - 0.004, r + 0.004, 96), new MeshBasicMaterial({ color: 0x8a857c, side: DoubleSide, transparent: true, opacity: 0.6 }));
    centre.add(ring);
  }
  const nucleus = new Mesh(new SphereGeometry(diameter * 0.03, 24, 16), new MeshBasicMaterial({ color: 0xa8503a }));
  centre.add(nucleus);
  const electron = new Mesh(new SphereGeometry(diameter * 0.018, 20, 14), new MeshBasicMaterial({ color: 0x3b6ea8 }));
  centre.add(electron);
  const photonTex = glow();
  const photon = new Sprite(new SpriteMaterial({ map: photonTex, blending: AdditiveBlending, transparent: true, depthWrite: false }));
  photon.scale.setScalar(diameter * 0.09);
  photon.visible = false;
  centre.add(photon);

  let n = 1;
  let phase = 0;
  let wait = 2;
  // A photon on its way: from and to shell, direction, progress 0..1, in (absorb) or out (emit).
  let flight: { from: number; to: number; dir: Vector3; t: number; out: boolean } | null = null;
  const tmp = new Vector3();

  const speedOf = (k: number) => 2.2 / (k * k); // slower on the outer shells, as the real thing is

  return {
    object: group,
    update(dt, distance) {
      if (distance > 60) return;
      phase += dt * speedOf(n);
      const r = radii[n - 1]!;
      electron.position.set(Math.cos(phase) * r, Math.sin(phase) * r, 0);
      if (flight) {
        flight.t += dt * 0.9;
        const len = diameter * 0.75;
        // In: from the edge to the electron; out: from the electron to the edge.
        const s = flight.out ? flight.t : 1 - flight.t;
        tmp.copy(flight.dir).multiplyScalar(len * s);
        photon.position.copy(flight.out ? tmp.add(electron.position) : tmp.add(electron.position));
        if (flight.t >= 1) {
          if (!flight.out) n = flight.to;
          flight = null;
          photon.visible = false;
          wait = 1.5 + Math.random() * 3;
        }
        return;
      }
      wait -= dt;
      if (wait > 0) return;
      // Up by absorbing, or down by emitting; from the ground state it can only go up.
      const up = n === 1 || (n < shells && Math.random() < 0.45);
      const to = up ? Math.min(shells, n + 1 + Math.floor(Math.random() * (shells - n))) : Math.max(1, n - 1 - Math.floor(Math.random() * (n - 1)));
      const nm = wavelength(Math.max(n, to), Math.min(n, to));
      const [cr, cg, cb] = colourOf(nm);
      (photon.material as SpriteMaterial).color.setRGB(cr, cg, cb);
      photon.visible = true;
      const a = Math.random() * Math.PI * 2;
      flight = { from: n, to, dir: new Vector3(Math.cos(a), Math.sin(a), 0), t: 0, out: !up };
      if (!up) n = to;
    },
    dispose() {
      centre.traverse((o) => {
        if (o instanceof Mesh) { o.geometry.dispose(); (o.material as MeshBasicMaterial).dispose(); }
      });
      photonTex.dispose();
      (photon.material as SpriteMaterial).dispose();
    },
    residentBytes: 64 * 64 * 4,
  };
};
