/**
 * A scanned interior shown from inside only (`display.reveal`): from the
 * lane it is cut off at the floor by a clipping plane and what shows is a
 * plan, a slab the size of its footprint with the walls drawn from the
 * scan's own vertices as ink on the museum's cream sheet, the title at
 * the far edge and the invitation at the near one. Step onto the slab and
 * the walls rise out of the plan over a second and a half.
 *
 * Owned by an Exhibit, which hands it the model's materials to clip and
 * each sharper root as it arrives so the plan can be redrawn from it.
 */
import { CanvasTexture, Group, type Material, Mesh, MeshStandardMaterial, Plane, PlaneGeometry, SRGBColorSpace, Vector3 } from "three";
import type { Artwork } from "../data/types";
import { baseHeightOf } from "../data/types";

export class Reveal {
  /** Keeps everything below its height; raised to let the walls up. */
  readonly plane = new Plane(new Vector3(0, -1, 0), 0);
  private materials: Material[] = [];
  /** How far the walls have risen, 0 cut at the ankle to 1 whole. */
  private t = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly slab: Mesh;
  private readonly w: number;
  private readonly d: number;

  constructor(
    private readonly artwork: Artwork,
    private readonly group: Group,
    private readonly footprint: { width: number; depth: number; height: number },
  ) {
    this.w = footprint.width + 2;
    this.d = footprint.depth + 2;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1024;
    this.canvas.height = Math.round((1024 * this.d) / this.w);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.drawPlan(null);
    // Lit like the floor around it, so it reads as paving with a drawing on it, not a light box.
    this.slab = new Mesh(new PlaneGeometry(this.w, this.d), new MeshStandardMaterial({ map: this.texture, roughness: 0.92, metalness: 0 }));
    this.slab.rotation.x = -Math.PI / 2;
    this.slab.position.y = baseHeightOf(artwork) + 0.012;
    this.slab.receiveShadow = true;
    this.slab.name = "reveal-floor";
    group.add(this.slab);
  }

  /** The model's materials, fresh from a rung: they are clipped at the plane from now on. */
  clip(materials: Material[]) {
    this.materials = materials;
    for (const m of materials) m.clippingPlanes = [this.plane];
    this.applyCut();
  }

  /**
   * The plan on the slab: the scan's vertices between knee and head
   * height, dropped onto the floor as ink dots, so the walls draw their
   * own floor plan. Redrawn from each sharper root as it arrives; the
   * group must be in the scene with its world matrix current.
   */
  drawPlan(root: Group | null) {
    const { canvas, w, d } = this;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width, H = canvas.height;
    // The museum's own sheet, a shade toward stone so it sits under the lights like the floor.
    ctx.fillStyle = "#d9d0bd";
    ctx.fillRect(0, 0, W, H);
    // A metre grid, faint.
    ctx.strokeStyle = "rgba(42,40,36,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 1) { const px = (x / w) * W; ctx.moveTo(px, 0); ctx.lineTo(px, H); }
    for (let z = 0; z <= d; z += 1) { const pz = (z / d) * H; ctx.moveTo(0, pz); ctx.lineTo(W, pz); }
    ctx.stroke();
    if (root) {
      root.updateMatrixWorld(true);
      const base = this.group.position.y + baseHeightOf(this.artwork);
      const lo = base + 0.5, hi = base + 2.6;
      const v = new Vector3();
      ctx.fillStyle = "rgba(42,40,36,0.34)";
      root.traverse((o) => {
        if (!(o instanceof Mesh) || o.name === "backing") return;
        const pos = o.geometry.attributes.position;
        if (!pos) return;
        const step = Math.max(1, Math.floor(pos.count / 400000));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (v.y < lo || v.y > hi) continue;
          // Into the slab's own frame: x east, z toward the visitor (down the canvas).
          const lx = v.x - this.group.position.x, lz = v.z - this.group.position.z;
          const px = ((lx + w / 2) / w) * W, pz = ((lz + d / 2) / d) * H;
          ctx.fillRect(px - 1, pz - 1, 2, 2);
        }
      });
    }
    ctx.fillStyle = "rgba(42,40,36,0.85)";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = `600 ${Math.round(W * 0.045)}px system-ui, sans-serif`;
    ctx.fillText(this.artwork.display.invitation ?? "Step in", W / 2, H - H * 0.02);
    ctx.font = `${Math.round(W * 0.022)}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(42,40,36,0.55)";
    ctx.fillText(this.artwork.title, W / 2, H * 0.02);
    this.texture.needsUpdate = true;
  }

  /** The height everything is cut at: the floor from the lane, the sky from inside. */
  private applyCut() {
    const k = 1 - (1 - this.t) * (1 - this.t);
    const cut = (this.footprint.height + 1) * k;
    this.plane.constant = this.group.position.y + baseHeightOf(this.artwork) + cut;
  }

  /** Walls cut at the ankle, rising, or whole, by the visitor's distance across the floor from the centre. */
  update(floorDistance: number, dt: number) {
    if (!this.materials.length) return;
    const want = floorDistance < this.artwork.display.reveal! ? 1 : 0;
    const before = this.t;
    this.t = Math.max(0, Math.min(1, this.t + (want > this.t ? dt : -dt) / 1.4));
    if (this.t !== before) this.applyCut();
  }

  dispose() {
    this.texture.dispose();
    this.slab.geometry.dispose();
    (this.slab.material as Material).dispose();
    this.group.remove(this.slab);
    this.materials = [];
  }
}
