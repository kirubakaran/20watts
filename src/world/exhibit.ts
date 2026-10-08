/**
 * An exhibit is one artwork standing in the world: a free-floating image
 * (seen mirrored from behind) or a 3D model on the floor, plus a placard on
 * each side and a soft contact shadow so it reads as grounded in VR.
 */
import {
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type Texture,
} from "three";
import { Text } from "troika-three-text";
import type { Artwork } from "../data/types";
import { currentImageVersion, currentModelVersion, imageDisplaySize, footprintOf } from "../data/types";
import { ImageLadder } from "../assets/textures";
import { ModelLadder } from "../assets/models";
import { Motion } from "../assets/motion";
import type { Placement } from "../layout/layout";

const FONT_REGULAR = "/fonts/inter-400.woff";
const FONT_BOLD = "/fonts/inter-600.woff";

/** Screen pixels a 1 m object at 1 m should get before we ask for a sharper rung. */
const PX_PER_RADIAN = 1600;
/** A moving image starts playing inside this distance and stops again beyond the larger one. */
const MOTION_NEAR = 14;
const MOTION_FAR = 18;

let shadowTexture: CanvasTexture | null = null;
function getShadowTexture(): CanvasTexture {
  if (shadowTexture) return shadowTexture;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.28)");
  g.addColorStop(0.6, "rgba(0,0,0,0.10)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  shadowTexture = new CanvasTexture(c);
  return shadowTexture;
}

function contactShadow(width: number, depth: number): Mesh {
  const m = new Mesh(
    new CircleGeometry(0.5, 48),
    new MeshBasicMaterial({ map: getShadowTexture(), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.set(width * 1.3, Math.max(depth, width * 0.35), 1);
  m.position.y = 0.01;
  m.renderOrder = -1;
  return m;
}

function creditLine(a: Artwork): string {
  const v = currentImageVersion(a) ?? currentModelVersion(a);
  if (!v) return "";
  const lic = v.credit.license.name;
  const page = v.credit.sourcePage ? new URL(v.credit.sourcePage).hostname : v.provenance;
  if (a.copyrighted) return `© In copyright · shown under fair use · ${page}`;
  if ("representation" in v && v.representation === "reconstruction") {
    return `3D reconstruction by ${v.credit.author ?? "unknown"} · ${lic} · ${page}`;
  }
  return `${lic} · ${page}`;
}

function sizeLine(a: Artwork): string {
  const { widthCm, heightCm, depthCm } = a.physical;
  const parts = [heightCm, widthCm, depthCm].filter((n): n is number => n != null).map((n) => `${n} cm`);
  return parts.length ? parts.join(" × ") : "";
}

function makePlacard(a: Artwork, width: number): Group {
  const g = new Group();
  const creators = a.creators.map((c) => {
    const life =
      c.birthYear && c.deathYear ? ` (${c.birthYear}–${c.deathYear})`
      : c.birthYear ? ` (b. ${c.birthYear})`
      : c.deathYear ? ` (d. ${c.deathYear})`
      : "";
    return `${c.name}${life}`;
  }).join(", ");
  const place = [a.madeIn.name, a.madeIn.country].filter(Boolean).join(", ");

  const title = new Text();
  title.text = a.title + (a.titleOriginal && a.titleOriginal !== a.title ? `  ·  ${a.titleOriginal}` : "");
  title.font = FONT_BOLD;
  title.fontSize = 0.05;
  title.maxWidth = width;
  title.color = 0x2a2824;
  title.anchorX = "left";
  title.anchorY = "top";
  g.add(title);

  const body = new Text();
  body.text = [
    creators,
    [a.date.label, place].filter(Boolean).join("  ·  "),
    [a.medium, sizeLine(a)].filter(Boolean).join("  ·  "),
    a.location.institution ?? "",
    "",
    a.description,
    "",
    creditLine(a),
  ].join("\n");
  body.font = FONT_REGULAR;
  body.fontSize = 0.028;
  body.lineHeight = 1.35;
  body.maxWidth = width;
  body.color = 0x4a4740;
  body.anchorX = "left";
  body.anchorY = "top";
  body.position.y = -0.085;
  g.add(body);

  // The body hangs below the title, however many lines the title wraps to.
  title.sync(() => {
    const bounds = title.textRenderInfo?.blockBounds;
    if (bounds) body.position.y = bounds[1] - 0.03;
  });
  body.sync();
  return g;
}

export class Exhibit {
  readonly group = new Group();
  private ladder: ImageLadder | ModelLadder | null = null;
  private imageMaterial: MeshBasicMaterial | null = null;
  private motion: Motion | null = null;
  private modelRoot: Group | null = null;
  private readonly centre = new Vector3();
  private readonly displayWidth: number;
  private lastRequestedPx = 0;

  constructor(
    readonly artwork: Artwork,
    placement: Placement,
    private readonly gpu: { maxTextureSize: number; maxAnisotropy: number },
  ) {
    this.group.name = artwork.id;
    this.group.position.copy(placement.position);
    this.group.rotation.y = placement.yaw;

    const fp = footprintOf(artwork);
    this.displayWidth = fp.width;
    this.group.add(contactShadow(fp.width, fp.depth));

    if (artwork.kind === "image") this.buildImage();
    else this.buildModel();

    // Placards: one in front, one behind (mirrored). A work hung high enough
    // gets its placard underneath; a work that reaches the floor gets it beside.
    const PLACARD_W = 0.9;
    const base = artwork.display.baseHeight;
    const below = base >= 1.1;
    const top = below ? base - 0.08 : 1.45;
    const dx = below ? fp.width / 2 : fp.width / 2 + 0.15 + PLACARD_W;
    const dz = below ? fp.depth / 2 + 0.3 : 0.02;
    const front = makePlacard(artwork, PLACARD_W);
    front.position.set(-dx, top, dz);
    this.group.add(front);
    const back = makePlacard(artwork, PLACARD_W);
    back.position.set(dx, top, -dz);
    back.rotation.y = Math.PI;
    this.group.add(back);
  }

  private buildImage() {
    const a = this.artwork;
    const v = currentImageVersion(a);
    const { width, height } = imageDisplaySize(a);
    const y = a.display.baseHeight + height / 2;
    this.centre.set(0, y, 0);

    this.imageMaterial = new MeshBasicMaterial({
      color: 0xd8d4cc,
      side: a.display.back === "mirror" ? DoubleSide : FrontSide,
      toneMapped: false,
    });
    const plane = new Mesh(new PlaneGeometry(width, height), this.imageMaterial);
    plane.position.y = y;
    plane.name = "image";
    this.group.add(plane);

    if (a.display.back === "backing") {
      const backing = new Mesh(
        new PlaneGeometry(width, height),
        new MeshStandardMaterial({ color: 0x3b3834, roughness: 0.9 }),
      );
      backing.position.set(0, y, -0.005);
      backing.rotation.y = Math.PI;
      this.group.add(backing);
    }

    if (v && v.rungs.length > 0) {
      this.ladder = new ImageLadder(v.rungs, this.gpu.maxTextureSize, this.gpu.maxAnisotropy);
      this.ladder.onUpgrade((t: Texture) => {
        if (!this.imageMaterial || this.motion?.isPlaying) return;
        this.imageMaterial.map = t;
        this.imageMaterial.color.set(0xffffff);
        this.imageMaterial.needsUpdate = true;
      });
      this.ladder.requestLowest();
    }
    if (v?.loop) this.motion = new Motion(v.loop);
  }

  private buildModel() {
    const a = this.artwork;
    const v = currentModelVersion(a);
    if (!v) return;
    const fp = footprintOf(a);
    this.centre.set(0, a.display.baseHeight + fp.height / 2, 0);
    if (v.rungs.length === 0) return;
    // Rungs are in metres with the base at y = 0 and the footprint centred,
    // so the only transforms left are the record's own scale and height.
    const ladder = new ModelLadder(v.rungs, this.gpu.maxTextureSize, this.gpu.maxAnisotropy);
    ladder.onUpgrade((root: Group) => {
      if (this.modelRoot) this.group.remove(this.modelRoot);
      root.scale.setScalar(v.scale * a.display.scale);
      root.position.y = a.display.baseHeight;
      root.name = "model";
      root.traverse((o) => {
        if (o instanceof Mesh) o.castShadow = true;
      });
      this.modelRoot = root;
      this.group.add(root);
    });
    ladder.requestLowest();
    this.ladder = ladder;
  }

  /** Called every frame with the viewer's world position; upgrades the texture rung as they approach. */
  update(viewerWorldPos: Vector3) {
    if (!this.ladder && !this.motion) return;
    const worldCentre = this.centre.clone().applyMatrix4(this.group.matrixWorld);
    const d = Math.max(viewerWorldPos.distanceTo(worldCentre), 0.5);
    if (this.ladder) {
      const desiredPx = (this.displayWidth / d) * PX_PER_RADIAN;
      // Hysteresis: only ask again when the need has grown by a quarter.
      if (desiredPx > this.lastRequestedPx * 1.25) {
        this.lastRequestedPx = desiredPx;
        this.ladder.request(desiredPx);
      }
    }
    if (this.motion && this.imageMaterial) {
      if (d < MOTION_NEAR && !this.motion.isPlaying) {
        this.imageMaterial.map = this.motion.play();
        this.imageMaterial.color.set(0xffffff);
        this.imageMaterial.needsUpdate = true;
      } else if (d > MOTION_FAR && this.motion.isPlaying) {
        this.motion.pause();
        const still = this.ladder instanceof ImageLadder ? this.ladder.current : null;
        if (still) this.imageMaterial.map = still;
        this.imageMaterial.needsUpdate = true;
      }
    }
  }

  dispose() {
    this.motion?.dispose();
    this.ladder?.dispose();
    this.imageMaterial?.dispose();
  }
}
