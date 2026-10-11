/**
 * A room of pictures (`display.ring`): the record's asset and its
 * alternates, each curved to the inside of a ring of the given radius,
 * hung in order around it from the left end round to the right with the
 * opening toward the lane, so the visitor at the centre turns to see
 * them as the painter meant. One ladder per panel; the exhibit asks all
 * of them for the same sharpness by the room's radius.
 */
import { BackSide, CylinderGeometry, Group, Mesh, MeshBasicMaterial, RepeatWrapping, type Texture } from "three";
import type { Artwork, ImageAsset } from "../data/types";
import { assetsOf, baseHeightOf } from "../data/types";
import { ImageLadder } from "../assets/textures";

export class Ring {
  readonly ladders: ImageLadder[] = [];
  private readonly meshes: Mesh[] = [];
  private lastRequestedPx = 0;

  constructor(artwork: Artwork, group: Group, gpu: { maxTextureSize: number; maxAnisotropy: number }) {
    const ring = artwork.display.ring!;
    const assets = assetsOf(artwork).filter((x): x is ImageAsset => x.kind === "image");
    const base = baseHeightOf(artwork);
    // Total arc the panels and gaps take; they are centred on the far side (-Z), away from the way in.
    const widths = ring.panels.map((p) => (p.widthCm / 100) * artwork.display.scale);
    const total = widths.reduce((s, w) => s + w, 0) + ring.gap * (widths.length - 1);
    let angle = Math.PI + total / (2 * ring.radius); // start at the left end, going clockwise seen from above
    assets.forEach((asset, i) => {
      const v = asset.versions.find((x) => x.id === asset.currentVersionId) ?? asset.versions[0];
      const size = ring.panels[i];
      if (!v || !size) return;
      const w = widths[i]!, h = (size.heightCm / 100) * artwork.display.scale;
      const arc = w / ring.radius;
      // An open cylinder segment seen from inside; thetaStart is measured from +Z toward +X in three.
      const geom = new CylinderGeometry(ring.radius, ring.radius, h, Math.max(8, Math.round(arc * 24)), 1, true, angle - arc, arc);
      const mat = new MeshBasicMaterial({ color: 0xd8d4cc, side: BackSide, toneMapped: false });
      const mesh = new Mesh(geom, mat);
      mesh.position.y = base + h / 2;
      mesh.name = `panel-${i}`;
      group.add(mesh);
      this.meshes.push(mesh);
      angle -= arc + ring.gap / ring.radius;
      if (v.rungs.length) {
        const ladder = new ImageLadder(v.rungs, gpu.maxTextureSize, gpu.maxAnisotropy);
        ladder.onUpgrade((t: Texture) => {
          // Seen from inside, the cylinder's u runs the wrong way; flip it so the picture reads left to right.
          t.wrapS = RepeatWrapping;
          t.repeat.x = -1;
          t.offset.x = 1;
          mat.map = t;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        });
        ladder.requestLowest();
        this.ladders.push(ladder);
      }
    });
  }

  /** Ask every panel for the sharpness the room's radius needs, up to `cap`; only when the need has grown by a quarter. */
  request(artwork: Artwork, pxPerRadian: number, cap: number) {
    const ring = artwork.display.ring!;
    const desiredPx = Math.min((Math.max(...ring.panels.map((p) => p.widthCm / 100)) / Math.max(1, ring.radius)) * pxPerRadian, cap);
    if (desiredPx > this.lastRequestedPx * 1.25) {
      this.lastRequestedPx = desiredPx;
      for (const l of this.ladders) l.request(desiredPx);
    }
  }

  get residentBytes(): number {
    return this.ladders.reduce((s, l) => s + l.residentBytes, 0);
  }

  dispose() {
    for (const l of this.ladders) l.dispose();
    this.ladders.length = 0;
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
      m.removeFromParent();
    }
    this.meshes.length = 0;
  }
}
