/**
 * The card: what a placard was, freed from the wall. When the visitor asks
 * to read about the work in focus, a cream sheet appears in the air at
 * reading distance, a little to one side of their line of sight so the
 * work stays in view, facing them. It stays where it opened, turning to
 * keep facing them as they look around, and fades as they walk away, so
 * reading is done standing and walking is never done with a sheet in
 * tow. Title, then the maker, date, place and material in a quieter grey,
 * then the description and facts, then the credit, small and grey.
 */
import { DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Vector3 } from "three";
import { Text } from "troika-three-text";
import type { Artwork } from "../data/types";
import { placardLines } from "./exhibit";

const FONT_REGULAR = "/fonts/inter-400.woff";
const FONT_BOLD = "/fonts/inter-600.woff";
const WIDTH = 0.92;
const PAD = 0.05;
/** Where it opens: this far ahead, this far to the right of the gaze, in radians. */
const DISTANCE = 1.15;
const SIDE = 0.42;
/** Fades from this far off the spot it opened at, gone at the second. */
const FADE_FROM = 1.2;
const GONE_AT = 2.6;

function text(font: string, size: number, colour: number, lineHeight = 1.38): Text {
  const t = new Text();
  t.font = font;
  t.fontSize = size;
  t.lineHeight = lineHeight;
  t.maxWidth = WIDTH - 2 * PAD;
  t.color = colour;
  t.anchorX = "left";
  t.anchorY = "top";
  t.renderOrder = 21;
  t.material.depthTest = false;
  t.position.x = -WIDTH / 2 + PAD;
  t.position.z = 0.002;
  return t;
}

export class Card {
  readonly group = new Group();
  private readonly sheet: Mesh;
  private readonly parts: { title: Text; meta: Text; body: Text; credit: Text };
  private shown: Artwork | null = null;
  private readonly openedAt = new Vector3();
  private opacity = 0;
  private readonly targetQuat = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly fwd = new Vector3();

  constructor() {
    this.group.name = "card";
    this.group.visible = false;
    this.sheet = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xf3eee3, transparent: true, opacity: 0.96, side: DoubleSide, toneMapped: false, depthWrite: false, depthTest: false }),
    );
    this.sheet.renderOrder = 20;
    this.group.add(this.sheet);
    this.parts = {
      title: text(FONT_BOLD, 0.04, 0x2a2824, 1.25),
      meta: text(FONT_REGULAR, 0.021, 0x8a857c, 1.4),
      body: text(FONT_REGULAR, 0.0245, 0x4a4740, 1.38),
      credit: text(FONT_REGULAR, 0.018, 0xa8a39a, 1.4),
    };
    this.group.add(this.parts.title, this.parts.meta, this.parts.body, this.parts.credit);
  }

  get artwork(): Artwork | null {
    return this.shown;
  }

  /** Show this work, or hide if it is the one showing. */
  toggle(a: Artwork, camera: PerspectiveCamera) {
    if (this.shown?.id === a.id) return this.hide();
    this.shown = a;
    const lines = placardLines(a);
    this.parts.title.text = lines.title;
    this.parts.meta.text = lines.meta;
    this.parts.body.text = lines.body;
    this.parts.credit.text = lines.credit;
    for (const t of Object.values(this.parts)) t.sync();
    // Where it hangs: ahead and to the side, the top a little above the eyes.
    camera.getWorldPosition(this.tmp);
    camera.getWorldDirection(this.fwd);
    const yaw = Math.atan2(-this.fwd.x, -this.fwd.z) - SIDE;
    this.group.position.set(this.tmp.x - Math.sin(yaw) * DISTANCE, this.tmp.y + 0.42, this.tmp.z - Math.cos(yaw) * DISTANCE);
    this.openedAt.copy(this.tmp);
    this.face(camera);
    this.group.quaternion.copy(this.targetQuat);
    this.group.visible = true;
  }

  hide() {
    this.shown = null;
  }

  /** Turned to the eyes, upright. */
  private face(camera: PerspectiveCamera) {
    camera.getWorldPosition(this.tmp);
    const dx = this.tmp.x - this.group.position.x, dz = this.tmp.z - this.group.position.z;
    this.targetQuat.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(dx, dz));
  }

  /** Lay the parts out top to bottom from their measured heights, and size the sheet to them. Cheap; every frame while shown. */
  private layout() {
    const gap = 0.022;
    let y = 0;
    for (const [name, t] of Object.entries(this.parts)) {
      const bounds = t.textRenderInfo?.blockBounds;
      if (!t.text || !bounds) { t.visible = false; continue; }
      t.visible = true;
      t.position.y = y;
      y -= bounds[3] - bounds[1];
      y -= name === "title" ? gap * 0.6 : name === "meta" ? gap * 1.6 : gap * 1.3;
    }
    const h = -y + 2 * PAD - gap;
    this.sheet.scale.set(WIDTH, h, 1);
    this.sheet.position.set(0, PAD - h / 2, 0);
  }

  update(dt: number, camera: PerspectiveCamera) {
    let want = this.shown ? 1 : 0;
    if (this.shown) {
      camera.getWorldPosition(this.tmp);
      const walked = this.tmp.distanceTo(this.openedAt);
      if (walked >= GONE_AT) this.shown = null;
      else if (walked > FADE_FROM) want = 1 - (walked - FADE_FROM) / (GONE_AT - FADE_FROM);
    }
    this.opacity += (want - this.opacity) * Math.min(1, dt * 7);
    if (this.opacity < 0.01 && !this.shown) {
      this.group.visible = false;
      return;
    }
    this.layout();
    this.face(camera);
    this.group.quaternion.slerp(this.targetQuat, Math.min(1, dt * 5));
    (this.sheet.material as MeshBasicMaterial).opacity = 0.96 * this.opacity;
    for (const t of Object.values(this.parts)) t.fillOpacity = this.opacity;
  }
}
