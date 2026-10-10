/**
 * The Lorenz attractor (1963): three coupled equations Edward Lorenz
 * boiled down from a model of convection, whose solutions never repeat
 * and never leave a shape like a pair of wings. A long run is drawn once
 * as a thin tube; a bright point then flies the equations live, trailing
 * its recent path, so you can watch it swap wings when it pleases.
 *
 * Params: sigma, rho, beta (defaults 10, 28, 8/3), speed (time units per
 * second, default 1.2).
 */
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3 } from "three";
import { num, type Program } from "./index";

const TRAIL = 240;

export const lorenz: Program = (params, bounds) => {
  const sigma = num(params, "sigma", 10), rho = num(params, "rho", 28), beta = num(params, "beta", 8 / 3);
  const speed = num(params, "speed", 1.2);
  // Attractor units to metres: it spans about 40 wide, 55 deep, 50 tall.
  const s = bounds.height / 52;
  const toScene = (p: Vector3, out: Vector3) => out.set(p.x * s, (p.z - 1) * s + 0.02, p.y * s);

  const deriv = (p: Vector3, out: Vector3) => out.set(sigma * (p.y - p.x), p.x * (rho - p.z) - p.y, p.x * p.y - beta * p.z);
  const k1 = new Vector3(), k2 = new Vector3(), k3 = new Vector3(), k4 = new Vector3(), tmp = new Vector3();
  const rk4 = (p: Vector3, h: number) => {
    deriv(p, k1);
    deriv(tmp.copy(p).addScaledVector(k1, h / 2), k2);
    deriv(tmp.copy(p).addScaledVector(k2, h / 2), k3);
    deriv(tmp.copy(p).addScaledVector(k3, h), k4);
    p.addScaledVector(k1, h / 6).addScaledVector(k2, h / 3).addScaledVector(k3, h / 3).addScaledVector(k4, h / 6);
  };

  // The long run, as a tube.
  const p = new Vector3(1, 1, 1);
  for (let i = 0; i < 400; i++) rk4(p, 0.01);
  const pts: Vector3[] = [];
  for (let i = 0; i < 5000; i++) {
    rk4(p, 0.008);
    if (i % 2 === 0) pts.push(toScene(p, new Vector3()));
  }
  const tube = new Mesh(
    new TubeGeometry(new CatmullRomCurve3(pts), pts.length, 0.006, 5, false),
    new MeshStandardMaterial({ color: 0x4a4740, roughness: 0.8 }),
  );
  tube.castShadow = true;

  // The live point and its trail.
  const live = new Vector3(-2, 3, 20);
  const trail = new Float32Array(TRAIL * 3);
  const trailGeom = new BufferGeometry();
  trailGeom.setAttribute("position", new BufferAttribute(trail, 3));
  const trailLine = new Line(trailGeom, new LineBasicMaterial({ color: 0xa8503a, transparent: true, opacity: 0.9 }));
  trailLine.frustumCulled = false;
  const dot = new Mesh(new SphereGeometry(0.03, 12, 8), new MeshBasicMaterial({ color: 0xa8503a }));
  const where = new Vector3();
  const fill = () => {
    toScene(live, where);
    for (let i = 0; i < TRAIL; i++) where.toArray(trail, i * 3);
    dot.position.copy(where);
  };
  fill();

  const group = new Group();
  group.add(tube, trailLine, dot);
  return {
    object: group,
    update(dt, distance) {
      if (distance > 80) return;
      const h = 0.004;
      let steps = Math.min(40, Math.round((dt * speed) / h));
      while (steps-- > 0) {
        rk4(live, h);
        toScene(live, where);
        trail.copyWithin(3, 0, (TRAIL - 1) * 3);
        where.toArray(trail, 0);
      }
      dot.position.copy(where);
      (trailGeom.attributes.position as BufferAttribute).needsUpdate = true;
    },
    dispose() {
      tube.geometry.dispose();
      (tube.material as MeshStandardMaterial).dispose();
      trailGeom.dispose();
      (trailLine.material as LineBasicMaterial).dispose();
      dot.geometry.dispose();
      (dot.material as MeshBasicMaterial).dispose();
    },
    residentBytes: pts.length * 6 * 32,
  };
};
