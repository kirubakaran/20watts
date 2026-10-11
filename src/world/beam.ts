/**
 * The sun through an opening (`display.oculus` with a standing `sky.sun`):
 * a ray from the oculus along the sun's line finds where it lands on the
 * model, and a soft shaft of light is drawn to that point with a bright
 * disc on the wall. The scan's own lighting is baked into its
 * photographs, so this is the only way the sun can mark it. Built in the
 * exhibit's own frame, so it moves with the work.
 */
import { AdditiveBlending, CircleGeometry, CylinderGeometry, DoubleSide, Group, type Material, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from "three";
import type { Artwork } from "../data/types";
import { baseHeightOf } from "../data/types";

/** The beam for this work as it stands in `group`, or null if the sun's line misses the model. */
export function buildBeam(artwork: Artwork, group: Group, root: Group): Group | null {
  const o = artwork.display.oculus!;
  const sun = artwork.display.sky!.sun!;
  const DEG = Math.PI / 180;
  const az = sun.azimuth * DEG, alt = sun.altitude * DEG;
  const toSun = new Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  const dir = toSun.clone().negate();
  const origin = new Vector3(o.x, baseHeightOf(artwork) + o.y, o.z).applyMatrix4(group.matrixWorld);
  const hit = new Raycaster(origin, dir, 0.5, 200).intersectObject(root, true).find((h) => (h.object as Mesh).name !== "backing");
  if (!hit) return null;
  const inv = group.matrixWorld.clone().invert();
  const start = origin.clone().applyMatrix4(inv);
  const end = hit.point.clone().applyMatrix4(inv);
  const localDir = end.clone().sub(start).normalize();
  const beam = new Group();
  beam.name = "sunbeam";
  const length = start.distanceTo(end);
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), localDir);
  const mid = start.clone().addScaledVector(localDir, length / 2);
  // Nested shells, faint, so the shaft has a soft core and no hard edge.
  for (const [k, opacity] of [[1, 0.07], [0.8, 0.08], [0.6, 0.1], [0.4, 0.12]] as const) {
    const shell = new Mesh(
      new CylinderGeometry(o.radius * k, o.radius * k, length, 32, 1, true),
      new MeshBasicMaterial({ color: 0xfff0cf, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
    );
    shell.quaternion.copy(quat);
    shell.position.copy(mid);
    beam.add(shell);
  }
  // The disc where it lands, laid on the surface and lifted a hair off it.
  const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(inv) : localDir.clone().negate();
  if (normal.dot(localDir) > 0) normal.negate();
  const disc = new Mesh(
    new CircleGeometry(o.radius * 1.08, 48),
    new MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
  );
  disc.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
  disc.position.copy(end).addScaledVector(normal, 0.08);
  beam.add(disc);
  return beam;
}

export function disposeBeam(beam: Group) {
  beam.traverse((m) => m instanceof Mesh && (m.geometry.dispose(), (m.material as Material).dispose()));
  beam.removeFromParent();
}
