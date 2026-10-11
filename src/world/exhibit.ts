/**
 * An exhibit is one artwork standing in the world: a free-floating image
 * (seen mirrored from behind) or a 3D model on the floor, plus a placard on
 * each side and a soft contact shadow so it reads as grounded in VR.
 *
 * Exhibits are built and torn down by the streamer as the visitor moves;
 * placards, the dearest part, only exist within reading distance.
 */
import { BackSide, Box3, CanvasTexture, CircleGeometry, Color, DoubleSide, FrontSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Vector3, type Texture } from "three";
import { Text } from "troika-three-text";
import type { Material } from "three";
import { standoffOf } from "../layout/layout";
import type { Artwork } from "../data/types";
import { baseHeightOf, currentAudioVersion, currentImageVersion, currentModelVersion, currentSimVersion, imageDisplaySize, footprintOf } from "../data/types";
import { PROGRAMS, type Sim } from "../sims";
import { Sound } from "../assets/sound";
import { ImageLadder } from "../assets/textures";
import { ModelLadder } from "../assets/models";
import { Motion } from "../assets/motion";
import { Reveal } from "./reveal";
import { Ring } from "./ring";
import { buildBeam, disposeBeam } from "./beam";
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
/** A recording may be heard within the record's hearing distance, or this; which one plays is decided outside (main.ts). */
const HEARING = 18;

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
  /** A room of pictures, with one ladder per panel. */
  private ring: Ring | null = null;
  private imageMaterial: MeshBasicMaterial | null = null;
  private motion: Motion | null = null;
  private sound: Sound | null = null;
  /** Whether the museum wants this recording heard now (one at a time), and how loud it is on its way there. */
  private soundWanted = false;
  private soundLevel = 0;
  /** Where a slowly turning work has got to, radians; kept across rung swaps. */
  private spinAngle = 0;
  private sim: Sim | null = null;
  private modelRoot: Group | null = null;
  /** Shown from inside only: the plan slab and the clipping that raises the walls. */
  private reveal: Reveal | null = null;
  private beam: Group | null = null;
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

    if (artwork.kind === "image" && artwork.display.ring) this.buildRing();
    else if (artwork.kind === "image") this.buildImage();
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

  /** Metres from the work within which its recording may be heard. */
  get hearing(): number {
    return this.artwork.display.hearing ?? HEARING;
  }

  get hasSound(): boolean {
    return this.sound != null;
  }

  /** The museum's say on whether this recording plays now; the fade is handled here. */
  setSoundWanted(on: boolean) {
    this.soundWanted = on;
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
    // Above the work; a tall one gets it low in front instead, like a label on the floor, and larger,
    // since the visitor stands further back from a tall thing; at a door, beside the door.
    const top = base + fp.height + 0.22;
    if (threshold != null) tag.position.set(-1.6, 1.6, threshold - 0.5);
    else if (top > 3.4) {
      tag.position.set(0, 0.35, fp.depth / 2 + 0.6);
      tag.scale.setScalar(Math.max(1, standoffOf(fp) / 2.2));
    } else tag.position.set(0, Math.max(top, 0.9), fp.depth / 2 + 0.05);
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

  /** A room of pictures: see ring.ts. The visitor stands at its centre. */
  private buildRing() {
    const a = this.artwork;
    const fp = footprintOf(a);
    this.centre.set(0, baseHeightOf(a) + fp.height / 2, 0);
    this.ring = new Ring(a, this.group, this.gpu);
  }

  private buildModel() {
    const a = this.artwork;
    const v = currentModelVersion(a);
    if (!v) return;
    const fp = footprintOf(a);
    this.centre.set(0, baseHeightOf(a) + fp.height / 2, 0);
    if (v.rungs.length === 0) return;
    if (a.display.reveal != null) this.reveal = new Reveal(a, this.group, fp);
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
    const clipped: Material[] = [];
    for (const o of meshes) {
      if (this.reveal) clipped.push(...(Array.isArray(o.material) ? o.material : [o.material]));
      o.castShadow = true;
      if (back === "mirror") for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.side = DoubleSide;
      if (back === "backing") {
        // The scan's own back faces would draw over the skin; only its fronts stay.
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.side = FrontSide;
        const skin = new Mesh(o.geometry, backingMaterial().clone());
        skin.castShadow = true;
        skin.name = "backing";
        o.add(skin);
        if (this.reveal) clipped.push(skin.material as Material);
      }
    }
    this.reveal?.clip(clipped);
  }

  /** After a root is in the scene: the blueprint and the sunbeam need world positions. */
  private rootAdded(root: Group) {
    const d = this.artwork.display;
    if (d.reveal == null && !(d.oculus && d.sky?.sun)) return;
    this.group.updateMatrixWorld(true);
    this.reveal?.drawPlan(root);
    if (d.oculus && d.sky?.sun) {
      if (this.beam) disposeBeam(this.beam);
      this.beam = buildBeam(this.artwork, this.group, root);
      if (this.beam) this.group.add(this.beam);
    }
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
    return (this.ladder?.residentBytes ?? 0) + (this.sim?.residentBytes ?? 0) + (this.ring?.residentBytes ?? 0);
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
    if (!this.ladder && !this.motion && !this.sound && !this.sim && !this.tag && !this.ring) return;
    const d = Math.max(viewerWorldPos.distanceTo(this.worldCentre), 0.5);
    if (this.tag) {
      // Turn the tag to the visitor, upright.
      this.tag.getWorldPosition(tagPos);
      this.tag.rotation.y = Math.atan2(viewerWorldPos.x - tagPos.x, viewerWorldPos.z - tagPos.z) - this.group.rotation.y;
    }
    this.sim?.setEye?.(viewerWorldPos);
    this.sim?.update(dt, d);
    if (this.artwork.display.spin && this.modelRoot && !this.held && d < 400) {
      this.spinAngle = (this.spinAngle + (dt * 2 * Math.PI) / this.artwork.display.spin) % (2 * Math.PI);
      this.modelRoot.rotation.y = this.spinAngle;
    }
    this.reveal?.update(Math.hypot(viewerWorldPos.x - this.worldCentre.x, viewerWorldPos.z - this.worldCentre.z), dt);
    if (this.sound) {
      // Cross-fade toward what is wanted: a second to come up, a second to go.
      const target = this.soundWanted ? 1 : 0;
      this.soundLevel += Math.max(-dt, Math.min(dt, (target - this.soundLevel) * 1.4 + (target > this.soundLevel ? 0.02 : -0.02)));
      this.soundLevel = Math.max(0, Math.min(1, this.soundLevel));
      if (target > 0 && !this.sound.isPlaying) this.sound.play();
      if (target === 0 && this.soundLevel <= 0.005 && this.sound.isPlaying) this.sound.pause();
      this.sound.setVolume(this.soundLevel);
    }
    this.ring?.request(this.artwork, PX_PER_RADIAN, this.qualityCap);
    if (this.ladder) {
      const desiredPx = Math.min((this.displayWidth / d) * PX_PER_RADIAN, this.qualityCap);
      // Hysteresis: only ask again when the need has grown by a quarter.
      if (desiredPx > this.lastRequestedPx * 1.25) {
        this.lastRequestedPx = desiredPx;
        this.ladder.request(desiredPx);
      } else if (d > 25 && !this.held && !this.capped && desiredPx * 4 < this.lastRequestedPx) {
        // Walked well away from something seen close: let the sharp rung go and hold what this
        // distance needs, so a building looked at from inside does not keep its full textures
        // from a hundred metres off.
        this.ladder.shrink();
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
    this.ring?.dispose();
    this.ring = null;
    this.motion = null;
    this.sim?.dispose();
    this.sim = null;
    this.reveal?.dispose();
    this.reveal = null;
    if (this.beam) disposeBeam(this.beam);
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
