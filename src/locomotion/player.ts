/**
 * The visitor. One rig (a Group) carries the camera; moving and turning the
 * rig moves the visitor on desktop and in VR alike.
 *
 *  Desktop: click to capture the mouse, WASD to walk, Shift to run,
 *           [ and ] hop an era back or forward, , and . hop sideways,
 *           Home and End (or Shift with [ and ]) jump to the entrance and
 *           the latest era.
 *  VR:      left thumbstick walks relative to where you look,
 *           right thumbstick snap-turns 30° per flick,
 *           A / B hop an era forward or back, X / Y hop sideways.
 *  Touch:   drag to look, an on-screen stick to walk, buttons for the
 *           hops (see touch.ts).
 *
 * Hops are reported as actions; something that knows the layout decides
 * where they land (see navigate.ts).
 */
import { Group, PerspectiveCamera, Quaternion, Vector3, WebGLRenderer } from "three";

const WALK = 2.5;
const RUN = 6;
const EYE_HEIGHT = 1.65;
const SNAP_ANGLE = Math.PI / 6;
const DEADZONE = 0.2;

export type Action = "eraNext" | "eraPrev" | "east" | "west" | "start" | "end";
const KEY_ACTIONS: Record<string, Action> = { BracketRight: "eraNext", BracketLeft: "eraPrev", Period: "east", Comma: "west", Home: "start", End: "end" };
/** Quest Touch button indices: 4 is A or X, 5 is B or Y. */
const XR_ACTIONS: Record<string, Action> = { "right:4": "eraNext", "right:5": "eraPrev", "left:4": "west", "left:5": "east" };

export class Player {
  readonly rig = new Group();
  private keys = new Set<string>();
  private pitch = 0;
  private snapLatched = false;
  private readonly pressed = new Set<string>();
  private touchWalk = { strafe: 0, fwd: 0 };
  private onAction: ((a: Action) => void) | null = null;
  private readonly tmpQ = new Quaternion();
  private readonly tmpV = new Vector3();
  private readonly headPos = new Vector3();

  constructor(
    private readonly renderer: WebGLRenderer,
    readonly camera: PerspectiveCamera,
    domElement: HTMLElement,
  ) {
    this.rig.name = "player";
    this.rig.add(camera);
    camera.position.set(0, EYE_HEIGHT, 0);

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      // Shift with the era keys jumps to either end: { and } on a US layout.
      const a = e.shiftKey && e.code === "BracketLeft" ? "start"
        : e.shiftKey && e.code === "BracketRight" ? "end"
        : KEY_ACTIONS[e.code];
      if (a && !e.repeat) this.onAction?.(a);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    domElement.addEventListener("click", (e) => {
      // A tap is not a click to capture the mouse with; touch has its own controls.
      if ((e as PointerEvent).pointerType === "touch") return;
      if (!renderer.xr.isPresenting && document.pointerLockElement !== domElement) domElement.requestPointerLock();
    });
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== domElement) return;
      this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
  }

  /** Turn by `dyaw` to the right and `dpitch` down, radians. */
  look(dyaw: number, dpitch: number) {
    this.rig.rotation.y -= dyaw;
    this.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.pitch - dpitch));
    this.camera.rotation.x = this.pitch;
  }

  /** The on-screen stick: strafe right and forward, each -1..1. */
  setTouchWalk(strafe: number, fwd: number) {
    this.touchWalk.strafe = strafe;
    this.touchWalk.fwd = fwd;
  }

  /** Put the visitor at ground position (x, z) facing `yaw` (0 = looking toward -Z, the future). */
  spawn(x: number, z: number, yaw = 0) {
    this.rig.position.set(x, 0, z);
    this.rig.rotation.y = yaw;
  }

  /**
   * Move the visitor so their head stands over (x, z) facing `yaw`. In VR
   * the head is offset from the rig by wherever they are in the play space,
   * and turned by wherever they are looking, so both are compensated.
   */
  teleport(x: number, z: number, yaw = 0) {
    if (this.renderer.xr.isPresenting) {
      this.rig.rotation.y += yaw - this.headYaw();
    } else {
      this.rig.rotation.y = yaw;
    }
    this.rig.updateMatrixWorld(true);
    const head = this.camera.getWorldPosition(this.tmpV);
    this.rig.position.x += x - head.x;
    this.rig.position.z += z - head.z;
  }

  /** Where the visitor stands on the floor, world x and z. */
  floorPosition(): { x: number; z: number } {
    const head = this.camera.getWorldPosition(this.tmpV);
    return { x: head.x, z: head.z };
  }

  /** Hear about hops; one listener. */
  setActionHandler(fn: (a: Action) => void) {
    this.onAction = fn;
  }

  private headYaw(): number {
    this.camera.getWorldQuaternion(this.tmpQ);
    const look = this.tmpV.set(0, 0, -1).applyQuaternion(this.tmpQ);
    return Math.atan2(-look.x, -look.z);
  }

  /** World position of the eyes. */
  viewerPosition(out: Vector3): Vector3 {
    return this.camera.getWorldPosition(out);
  }

  update(dt: number) {
    if (this.renderer.xr.isPresenting) this.updateXR(dt);
    else this.updateDesktop(dt);
  }

  private updateDesktop(dt: number) {
    const k = this.keys;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const strafe = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    if (fwd || strafe) {
      const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? RUN : WALK;
      this.moveRelativeToYaw(this.rig.rotation.y, strafe, fwd, speed * dt);
    }
    // The stick: walking pace at the ring, a jog when pushed to the rim.
    const t = this.touchWalk;
    const push = Math.hypot(t.strafe, t.fwd);
    if (push > 0.1) {
      const speed = WALK * (0.4 + push * (push > 0.95 ? 2 : 1));
      this.moveRelativeToYaw(this.rig.rotation.y, t.strafe, t.fwd, speed * dt);
    }
  }

  private updateXR(dt: number) {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    // Head yaw in world space: thumbstick-forward means where you are looking.
    this.camera.getWorldQuaternion(this.tmpQ);
    const look = this.tmpV.set(0, 0, -1).applyQuaternion(this.tmpQ);
    const headYaw = Math.atan2(-look.x, -look.z);

    for (const src of session.inputSources) {
      this.pollButtons(src);
      const axes = src.gamepad?.axes;
      if (!axes || axes.length < 4) continue;
      const x = axes[2] ?? 0;
      const y = axes[3] ?? 0;
      if (src.handedness === "left") {
        const mx = Math.abs(x) > DEADZONE ? x : 0;
        const my = Math.abs(y) > DEADZONE ? -y : 0;
        if (mx || my) this.moveRelativeToYaw(headYaw, mx, my, WALK * dt);
      } else if (src.handedness === "right") {
        if (Math.abs(x) > 0.6) {
          if (!this.snapLatched) {
            this.snapTurn(x > 0 ? -SNAP_ANGLE : SNAP_ANGLE);
            this.snapLatched = true;
          }
        } else if (Math.abs(x) < 0.3) {
          this.snapLatched = false;
        }
      }
    }
  }

  /** Fire an action on the press edge of the A/B/X/Y buttons. */
  private pollButtons(src: XRInputSource) {
    const buttons = src.gamepad?.buttons;
    if (!buttons) return;
    for (const idx of [4, 5]) {
      const key = `${src.handedness}:${idx}`;
      const down = buttons[idx]?.pressed ?? false;
      if (down && !this.pressed.has(key)) {
        this.pressed.add(key);
        const a = XR_ACTIONS[key];
        if (a) this.onAction?.(a);
      } else if (!down) {
        this.pressed.delete(key);
      }
    }
  }

  private moveRelativeToYaw(yaw: number, strafe: number, fwd: number, dist: number) {
    const len = Math.hypot(strafe, fwd) || 1;
    const sx = strafe / len, sf = fwd / len;
    // forward is -Z in rig space; rotate by yaw into world
    const dx = (sx * Math.cos(yaw) - sf * Math.sin(yaw)) * dist;
    const dz = (-sx * Math.sin(yaw) - sf * Math.cos(yaw)) * dist;
    this.rig.position.x += dx;
    this.rig.position.z += dz;
  }

  /** Rotate the rig about the head, not the rig origin, so the visitor turns in place. */
  private snapTurn(angle: number) {
    this.camera.getWorldPosition(this.headPos);
    this.rig.rotation.y += angle;
    this.rig.updateMatrixWorld(true);
    const after = this.camera.getWorldPosition(this.tmpV);
    this.rig.position.x += this.headPos.x - after.x;
    this.rig.position.z += this.headPos.z - after.z;
  }
}
