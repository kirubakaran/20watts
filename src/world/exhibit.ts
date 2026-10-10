/**
 * An exhibit is one artwork standing in the world: a free-floating image
 * (seen mirrored from behind) or a 3D model on the floor, plus a placard on
 * each side and a soft contact shadow so it reads as grounded in VR.
 *
 * Exhibits are built and torn down by the streamer as the visitor moves;
 * placards, the dearest part, only exist within reading distance.
 */
import {
  AdditiveBlending,
  BackSide,
  Color,
  Box3,
  CanvasTexture,
  CylinderGeometry,
  Quaternion,
  Raycaster,
  CircleGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from "three";
import { Text } from "troika-three-text";
import type { Material } from "three";
import type { Artwork } from "../data/types";
import { baseHeightOf, currentAudioVersion, currentImageVersion, currentModelVersion, currentSimVersion, imageDisplaySize, footprintOf } from "../data/types";
import { PROGRAMS, type Sim } from "../sims";
import { Sound } from "../assets/sound";
import { ImageLadder } from "../assets/textures";
import { ModelLadder } from "../assets/models";
import { Motion } from "../assets/motion";
import type { Placement } from "../layout/layout";

const FONT_REGULAR = "/fonts/inter-400.woff";
const FONT_BOLD = "/fonts/inter-600.woff";
/** Placard ink by day and under a night sky, where dark ink on a dark floor would vanish. */
const INK_DAY = new Color(0x2a2824), INK_NIGHT = new Color(0xf3eee3);
const BODY_DAY = new Color(0x4a4740), BODY_NIGHT = new Color(0xd9d3c6);
const tmpColour = new Color();
const tagPos = new Vector3();

/** Screen pixels a 1 m object at 1 m should get before we ask for a sharper rung. */
const PX_PER_RADIAN = 1600;
/** A moving image starts playing inside this distance and stops again beyond the larger one. */
const MOTION_NEAR = 14;
const MOTION_FAR = 18;
/** A recording starts at the record's hearing distance, or this, and stops a few metres further out. */
const HEARING = 18;
const HEARING_MARGIN = 5;

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

let backing: MeshStandardMaterial | null = null;
/** Lime plaster, drawn on the back faces only, shared by every backed model. */
function backingMaterial(): MeshStandardMaterial {
  return (backing ??= new MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.95, side: BackSide }));
}

function soundLine(a: Artwork): string {
  const v = currentAudioVersion(a);
  if (!v) return "";
  const page = v.credit.sourcePage ? new URL(v.credit.sourcePage).hostname : v.provenance;
  return `Sound: ${v.performers ?? v.credit.author ?? "unknown"} · ${v.credit.license.name} · ${page}`;
}

function creditLine(a: Artwork): string {
  const sim = currentSimVersion(a);
  if (sim) return `Computed live as you watch · ${sim.credit.license.name} · ${sim.credit.author ?? "20watts"}`;
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
  if (!parts.length) return "";
  // A page is shown larger than life, since the idea on it is the work, not the paper.
  const s = a.display.scale;
  return parts.join(" × ") + (s !== 1 ? `, shown at ${Number.isInteger(s) ? s : s.toFixed(1)}×` : "");
}

/** The words of a placard, in parts, so the card can set each in its own voice. */
export function placardLines(a: Artwork): { title: string; meta: string; body: string; credit: string } {
  const creators = a.creators.map((c) => {
    const life =
      c.birthYear && c.deathYear ? ` (${c.birthYear}\u2013${c.deathYear})`
      : c.birthYear ? ` (b. ${c.birthYear})`
      : c.deathYear ? ` (d. ${c.deathYear})`
      : "";
    return `${c.name}${life}`;
  }).join(", ");
  const place = [a.madeIn.name, a.madeIn.country].filter(Boolean).join(", ");
  const title = a.title + (a.titleOriginal && a.titleOriginal !== a.title ? `  \u00b7  ${a.titleOriginal}` : "");
  const meta = [
    creators,
    [a.date.label, place].filter(Boolean).join("  \u00b7  "),
    [a.medium, sizeLine(a)].filter(Boolean).join("  \u00b7  "),
    a.location.institution ?? "",
  ].filter(Boolean).join("\n");
  const facts = a.facts.length ? a.facts.map((f) => `\u00b7  ${f}`).join("\n") : "";
  const body = [a.description, facts].filter(Boolean).join("\n\n");
  const credit = [creditLine(a), soundLine(a)].filter(Boolean).join("\n");
  return { title, meta, body, credit };
}

/** "1495" or "2,560 BCE": the year as the floor writes it, for the name tag. */
function yearTag(a: Artwork): string {
  const y = a.date.year;
  if (y <= -100_000) return `${(-y).toLocaleString("en-US")} years ago`;
  if (y < 0) return `${(-y).toLocaleString("en-US")} BCE`;
  return `${y}`;
}

/**
 * The name tag: the title and the year in small letters floating above
 * the work, turned to the visitor, always there within reading range so
 * the lane can be read at a walk. Everything else waits on the card.
 */
function makeTag(a: Artwork): Text {
  const t = new Text();
  t.text = a.title;
  t.font = FONT_REGULAR;
  t.fontSize = 0.045;
  t.lineHeight = 1.25;
  t.maxWidth = 2.2;
  t.textAlign = "center";
  t.color = 0x2a2824;
  t.fillOpacity = 0.55;
  t.anchorX = "center";
  t.anchorY = "bottom";
  const year = new Text();
  year.text = yearTag(a);
  year.font = FONT_REGULAR;
  year.fontSize = 0.034;
  year.color = 0x8a857c;
  year.fillOpacity = 0.75;
  year.anchorX = "center";
  year.anchorY = "top";
  year.position.y = -0.02;
  t.add(year);
  t.sync();
  year.sync();
  return t;
}

export class Exhibit {
  readonly group = new Group();
  private ladder: ImageLadder | ModelLadder | null = null;
  private imageMaterial: MeshBasicMaterial | null = null;
  private motion: Motion | null = null;
  private sound: Sound | null = null;
  private sim: Sim | null = null;
  private modelRoot: Group | null = null;
  /** Shown from inside only: how far the walls have risen, 0 cut at the ankle to 1 whole. */
  private revealT = 0;
  private revealMaterials: Material[] = [];
  /** Keeps everything below its height; raised to let the walls up. */
  private readonly revealPlane = new Plane(new Vector3(0, -1, 0), 0);
  private plan: { canvas: HTMLCanvasElement; w: number; d: number } | null = null;
  private beam: Group | null = null;
  private planTexture: CanvasTexture | null = null;
  /** In a visitor's hand: a sharper rung that arrives meanwhile waits until it is put down. */
  private held = false;
  private pendingRoot: Group | null = null;
  private readonly box = new Box3();
  private readonly centre = new Vector3();
  /** Centre of the work in world space, fixed once built. */
  readonly worldCentre = new Vector3();
  private readonly displayWidth: number;
  private lastRequestedPx = 0;
  /** Highest quality this exhibit may ask for; lowered by shrink(), lifted by uncap(). */
  private qualityCap = Infinity;
  private placards: Group[] = [];
  private tag: Text | null = null;
  private focused = false;
  private night = 0;
  private readonly footprint;

  constructor(
    readonly artwork: Artwork,
    placement: Placement,
    private readonly gpu: { maxTextureSize: number; maxAnisotropy: number },
  ) {
    this.group.name = artwork.id;
    this.group.position.copy(placement.position);
    this.group.rotation.y = placement.yaw;

    const fp = footprintOf(artwork);
    this.footprint = fp;
    this.displayWidth = fp.width;
    this.group.add(contactShadow(fp.width, fp.depth));

    if (artwork.kind === "image") this.buildImage();
    else if (artwork.kind === "sim") this.buildSim();
    else this.buildModel();
    this.worldCentre.copy(this.group.position).add(this.centre);
    const audio = currentAudioVersion(artwork);
    if (audio) {
      this.sound = new Sound(audio);
      const node = this.sound.attach();
      if (node) {
        node.position.copy(this.centre);
        this.group.add(node);
      }
    }
  }

  /** Whether the placards exist. They are built within reading distance only. */
  get hasPlacards(): boolean {
    return this.placards.length > 0;
  }

  /** How dark the sky is, 0 to 1: the tag's ink goes pale with it. */
  setNight(night: number) {
    if (night === this.night) return;
    this.night = night;
    if (this.tag) {
      this.tag.color = tmpColour.copy(INK_DAY).lerp(INK_NIGHT, night).getHex();
      for (const c of this.tag.children) if (c instanceof Text) c.color = tmpColour.copy(new Color(0x8a857c)).lerp(BODY_NIGHT, night).getHex();
    }
  }

  /** The work the visitor is looking at: its tag comes forward. */
  setFocus(on: boolean) {
    if (on === this.focused) return;
    this.focused = on;
    if (this.tag) this.tag.fillOpacity = on ? 0.95 : 0.55;
  }

  /**
   * The name tag, within reading range only: above the work, or beside
   * the door of a building, turned to the visitor every frame.
   */
  setPlacards(on: boolean) {
    if (on === this.hasPlacards) return;
    if (!on) {
      if (this.tag) {
        this.group.remove(this.tag);
        this.tag.dispose();
        this.tag = null;
      }
      this.placards = [];
      return;
    }
    const fp = this.footprint;
    const base = baseHeightOf(this.artwork);
    const threshold = this.artwork.display.threshold;
    const tag = makeTag(this.artwork);
    // Above the work; a tall one gets it low in front instead, like a label on the floor; at a door, beside the door.
    const top = base + fp.height + 0.22;
    if (threshold != null) tag.position.set(-1.6, 1.6, threshold - 0.5);
    else if (top > 2.7) tag.position.set(0, 0.35, fp.depth / 2 + 0.6);
    else tag.position.set(0, Math.max(top, 0.9), fp.depth / 2 + 0.05);
    this.tag = tag;
    this.group.add(tag);
    this.placards = [tag as unknown as Group];
    const n = this.night;
    this.night = -1;
    this.setNight(n);
    const f = this.focused;
    this.focused = !f;
    this.setFocus(f);
  }

  private buildImage() {
    const a = this.artwork;
    const v = currentImageVersion(a);
    const { width, height } = imageDisplaySize(a);
    const y = baseHeightOf(a) + height / 2;
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
    this.centre.set(0, baseHeightOf(a) + fp.height / 2, 0);
    if (v.rungs.length === 0) return;
    if (a.display.reveal != null) this.buildRevealFloor(fp.width, fp.depth);
    // Rungs are in metres with the base at y = 0 and the footprint centred,
    // so the only transforms left are the record's own scale and height.
    const ladder = new ModelLadder(v.rungs, v.pointSize ?? 0.03, this.gpu.maxTextureSize, this.gpu.maxAnisotropy);
    ladder.onUpgrade((root: Group) => {
      if (this.held) {
        this.pendingRoot = root;
        return;
      }
      if (this.modelRoot) this.group.remove(this.modelRoot);
      root.scale.setScalar(v.scale * a.display.scale);
      root.position.y = baseHeightOf(a);
      root.name = "model";
      this.prepareRoot(root);
      this.modelRoot = root;
      this.group.add(root);
      this.rootAdded(root);
    });
    ladder.requestLowest();
    this.ladder = ladder;
  }

  private buildSim() {
    const a = this.artwork;
    const v = currentSimVersion(a);
    const fp = footprintOf(a);
    this.centre.set(0, baseHeightOf(a) + fp.height / 2, 0);
    const program = v && PROGRAMS[v.program];
    if (!v || !program) {
      console.warn(`${a.id}: no such program ${v?.program}`);
      return;
    }
    this.sim = program(v.params, v.bounds);
    const root = this.sim.object;
    root.scale.setScalar(a.display.scale);
    root.position.y = baseHeightOf(a);
    root.name = "sim";
    this.modelRoot = root as Group;
    this.group.add(root);
  }

  /**
   * The floor of a work shown from inside only: a plaster slab the size
   * of its footprint, with "walk in" at the near edge, so the visitor
   * knows to step onto it. The walls rise once they do.
   */
  private buildRevealFloor(width: number, depth: number) {
    const w = width + 2, d = depth + 2;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = Math.round((1024 * d) / w);
    this.plan = { canvas, w, d };
    this.drawPlan(null);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    this.planTexture = tex;
    // Lit like the floor around it, so it reads as paving with a drawing on it, not a light box.
    const slab = new Mesh(new PlaneGeometry(w, d), new MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = baseHeightOf(this.artwork) + 0.012;
    slab.receiveShadow = true;
    slab.name = "reveal-floor";
    this.group.add(slab);
  }

  /**
   * The plan on the slab: the scan's vertices between knee and head
   * height, dropped onto the floor as ink dots on the museum's cream
   * sheet, so the walls draw their own floor plan; with the invitation at
   * the near edge. Redrawn from each sharper rung as it arrives.
   */
  private drawPlan(root: Group | null) {
    if (!this.plan) return;
    const { canvas, w, d } = this.plan;
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
    if (this.planTexture) this.planTexture.needsUpdate = true;
  }

  /** The height everything of a revealed work is cut at: the floor from the lane, the sky from inside. */
  private applyRevealCut() {
    const fp = this.footprint;
    const k = 1 - (1 - this.revealT) * (1 - this.revealT);
    const cut = (fp.height + 1) * k;
    this.revealPlane.constant = this.group.position.y + baseHeightOf(this.artwork) + cut;
  }

  /** Walls shown from inside only: cut at the ankle, rising, or whole, by how far in the visitor stands. */
  private updateReveal(d: number, dt: number) {
    const reveal = this.artwork.display.reveal;
    if (reveal == null || !this.modelRoot) return;
    const want = d < reveal ? 1 : 0;
    const before = this.revealT;
    this.revealT = Math.max(0, Math.min(1, this.revealT + (want > this.revealT ? dt : -dt) / 1.4));
    if (this.revealT !== before) this.applyRevealCut();
  }

  /**
   * Shadows, and what the back of a scanned interior looks like from
   * outside: "mirror" draws both sides of every surface, so the inside
   * textures show through reversed; "backing" adds a plain plaster skin on
   * the outside, which reads as a building rather than as broken glass.
   */
  private prepareRoot(root: Group) {
    const back = this.artwork.display.back;
    // Collect first: adding a skin while walking the tree would walk the skin too, and skin it, without end.
    const meshes: Mesh[] = [];
    root.traverse((o) => o instanceof Mesh && meshes.push(o));
    this.revealMaterials = [];
    for (const o of meshes) {
      if (this.artwork.display.reveal != null) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.clippingPlanes = [this.revealPlane];
          this.revealMaterials.push(m);
        }
      }
      o.castShadow = true;
      if (back === "mirror") for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.side = DoubleSide;
      if (back === "backing") {
        // The scan's own back faces would draw over the skin; only its fronts stay.
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.side = FrontSide;
        const skin = new Mesh(o.geometry, backingMaterial().clone());
        skin.castShadow = true;
        skin.name = "backing";
        o.add(skin);
        if (this.artwork.display.reveal != null) {
          (skin.material as Material).clippingPlanes = [this.revealPlane];
          this.revealMaterials.push(skin.material as Material);
        }
      }
    }
    if (this.artwork.display.reveal != null) this.applyRevealCut();
  }

  /** After a root is in the scene: the blueprint and the sunbeam need world positions. */
  private rootAdded(root: Group) {
    const d = this.artwork.display;
    if (d.reveal == null && !(d.oculus && d.sky?.sun)) return;
    this.group.updateMatrixWorld(true);
    if (d.reveal != null) this.drawPlan(root);
    if (d.oculus && d.sky?.sun) this.buildBeam(root);
  }

  /**
   * The sun through an opening: a ray from the oculus along the sun's
   * line finds where it lands on the model, and a soft shaft of light is
   * drawn to that point with a bright disc on the wall. The scan's own
   * lighting is baked into its photographs, so this is the only way the
   * sun can mark it.
   */
  private buildBeam(root: Group) {
    const o = this.artwork.display.oculus!;
    const sun = this.artwork.display.sky!.sun!;
    const DEG = Math.PI / 180;
    const az = sun.azimuth * DEG, alt = sun.altitude * DEG;
    const toSun = new Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    const dir = toSun.clone().negate();
    const origin = new Vector3(o.x, baseHeightOf(this.artwork) + o.y, o.z).applyMatrix4(this.group.matrixWorld);
    const hit = new Raycaster(origin, dir, 0.5, 200).intersectObject(root, true).find((h) => (h.object as Mesh).name !== "backing");
    if (!hit) return;
    if (this.beam) {
      this.group.remove(this.beam);
      this.beam.traverse((m) => m instanceof Mesh && (m.geometry.dispose(), (m.material as Material).dispose()));
    }
    // Everything in the exhibit's own frame, so it moves with it.
    const inv = this.group.matrixWorld.clone().invert();
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
    this.beam = beam;
    this.group.add(beam);
  }

  /** The model or simulation, for picking up; null for an image. */
  get body(): Group | null {
    return this.modelRoot;
  }

  get isHeld(): boolean {
    return this.held;
  }

  /** Taken into a hand, or put back. A rung that arrived meanwhile is applied on return. */
  hold(on = true) {
    this.held = on;
    if (!on && this.pendingRoot && this.ladder instanceof ModelLadder) {
      const root = this.pendingRoot;
      this.pendingRoot = null;
      const v = currentModelVersion(this.artwork)!;
      if (this.modelRoot) this.group.remove(this.modelRoot);
      root.scale.setScalar(v.scale * this.artwork.display.scale);
      root.position.y = baseHeightOf(this.artwork);
      root.name = "model";
      this.prepareRoot(root);
      this.modelRoot = root;
      this.group.add(root);
      this.rootAdded(root);
    }
  }

  /** Metres from a world point to the body's bounding box, 0 inside it. */
  distanceToBody(p: Vector3): number {
    if (!this.modelRoot) return Infinity;
    this.box.setFromObject(this.modelRoot);
    return this.box.distanceToPoint(p);
  }

  /** Estimated GPU bytes this exhibit holds. */
  get residentBytes(): number {
    return (this.ladder?.residentBytes ?? 0) + (this.sim?.residentBytes ?? 0);
  }

  /** Fall back to the smallest rung and stay there until uncap(). */
  shrink(): boolean {
    if (!this.ladder) return false;
    this.qualityCap = this.ladder.lowestQuality;
    this.lastRequestedPx = 0;
    return this.ladder.shrink();
  }

  /** Allow sharper rungs again. */
  uncap() {
    this.qualityCap = Infinity;
    this.lastRequestedPx = 0;
  }

  get capped(): boolean {
    return this.qualityCap !== Infinity;
  }

  /** Called every frame with the viewer's world position; upgrades the texture rung as they approach, runs a simulation. */
  update(viewerWorldPos: Vector3, dt = 0) {
    if (!this.ladder && !this.motion && !this.sound && !this.sim && !this.tag) return;
    const d = Math.max(viewerWorldPos.distanceTo(this.worldCentre), 0.5);
    if (this.tag) {
      // Turn the tag to the visitor, upright.
      this.tag.getWorldPosition(tagPos);
      this.tag.rotation.y = Math.atan2(viewerWorldPos.x - tagPos.x, viewerWorldPos.z - tagPos.z) - this.group.rotation.y;
    }
    this.sim?.update(dt, d);
    this.updateReveal(Math.hypot(viewerWorldPos.x - this.worldCentre.x, viewerWorldPos.z - this.worldCentre.z), dt);
    if (this.sound) {
      const near = this.artwork.display.hearing ?? HEARING;
      if (d < near && !this.sound.isPlaying) this.sound.play();
      else if (d > near + HEARING_MARGIN && this.sound.isPlaying) this.sound.pause();
    }
    if (this.ladder) {
      const desiredPx = Math.min((this.displayWidth / d) * PX_PER_RADIAN, this.qualityCap);
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

  /** Free everything: GPU resources, the video, the text, and leave the scene. */
  dispose() {
    this.setPlacards(false);
    this.focused = false;
    this.motion?.dispose();
    this.sound?.dispose();
    this.sound = null;
    this.ladder?.dispose();
    this.ladder = null;
    this.motion = null;
    this.sim?.dispose();
    this.sim = null;
    this.planTexture?.dispose();
    this.planTexture = null;
    this.plan = null;
    this.beam = null;
    // The ladder freed the model's own meshes; the rest is ours.
    if (this.modelRoot) this.group.remove(this.modelRoot);
    this.group.traverse((o) => {
      if (o instanceof Mesh && o.name !== "backing") {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    this.modelRoot = null;
    this.imageMaterial = null;
    this.group.removeFromParent();
    this.group.clear();
  }
}
