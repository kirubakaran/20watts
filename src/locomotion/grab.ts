/**
 * Picking things up, in VR. Squeeze the grip (or the trigger) with a hand
 * near a work that may be held and it comes into that hand; it follows the
 * hand's every turn until it is let go, then drifts back to its place in
 * under a second, so nothing is ever left lying about. Which works may be
 * held is the record's say (see `grabbable` in the schema): small models
 * by default, nothing you walk into, nothing seen from afar.
 *
 * There is no desktop equivalent; a mouse cannot do what a hand does.
 */
import { Group, Object3D, Quaternion, Vector3, type WebGLRenderer } from "three";
import { grabbable } from "../data/types";
import type { Exhibit } from "../world/exhibit";
import type { Player } from "./player";

/** Metres from the hand to the nearest part of a work within which a squeeze takes it. */
const REACH = 0.35;
const RETURN_SECONDS = 0.7;

interface Held {
  exhibit: Exhibit;
  body: Group;
  home: { parent: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3 };
}

interface Returning {
  body: Group;
  from: { position: Vector3; quaternion: Quaternion; scale: Vector3 };
  to: Held["home"];
  t: number;
}

export class Grabber {
  private readonly held = new Map<Object3D, Held>();
  private readonly returning: Returning[] = [];
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();

  constructor(
    renderer: WebGLRenderer,
    player: Player,
    private readonly exhibitsNear: (x: number, z: number, radius: number) => Exhibit[],
  ) {
    for (const i of [0, 1]) {
      const controller = renderer.xr.getController(i);
      player.rig.add(controller);
      const grab = () => this.grab(controller);
      const release = () => this.release(controller);
      controller.addEventListener("squeezestart", grab);
      controller.addEventListener("selectstart", grab);
      controller.addEventListener("squeezeend", release);
      controller.addEventListener("selectend", release);
      controller.addEventListener("disconnected", release);
    }
  }

  private grab(hand: Object3D) {
    if (this.held.has(hand)) return;
    const p = hand.getWorldPosition(this.tmp);
    let best: { e: Exhibit; d: number } | null = null;
    for (const e of this.exhibitsNear(p.x, p.z, 4)) {
      if (!grabbable(e.artwork) || !e.body || e.isHeld) continue;
      const d = e.distanceToBody(p);
      if (d <= REACH && (!best || d < best.d)) best = { e, d };
    }
    if (!best) return;
    const body = best.e.body!;
    const home = {
      parent: body.parent!,
      position: body.position.clone(),
      quaternion: body.quaternion.clone(),
      scale: body.scale.clone(),
    };
    // A work on its way back is taken again mid-flight.
    const i = this.returning.findIndex((r) => r.body === body);
    if (i >= 0) this.returning.splice(i, 1);
    best.e.hold();
    hand.attach(body);
    this.held.set(hand, { exhibit: best.e, body, home });
  }

  private release(hand: Object3D) {
    const h = this.held.get(hand);
    if (!h) return;
    this.held.delete(hand);
    h.home.parent.attach(h.body);
    this.returning.push({
      body: h.body,
      from: { position: h.body.position.clone(), quaternion: h.body.quaternion.clone(), scale: h.body.scale.clone() },
      to: h.home,
      t: 0,
    });
    h.exhibit.hold(false);
  }

  /** Ease whatever was let go back to where it belongs. */
  update(dt: number) {
    for (let i = this.returning.length - 1; i >= 0; i--) {
      const r = this.returning[i]!;
      r.t = Math.min(1, r.t + dt / RETURN_SECONDS);
      const k = 1 - (1 - r.t) * (1 - r.t);
      r.body.position.lerpVectors(r.from.position, r.to.position, k);
      r.body.quaternion.slerpQuaternions(r.from.quaternion, r.to.quaternion, k);
      r.body.scale.lerpVectors(r.from.scale, r.to.scale, k);
      if (r.t >= 1) this.returning.splice(i, 1);
    }
    void this.tmp2;
  }
}
