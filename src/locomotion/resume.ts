/**
 * Resume where you left off. The visitor's place is saved in the browser
 * while they move and restored on the next visit, so a reload or a new
 * deploy does not send them back to the oldest work.
 *
 * The place is stored relative to the nearest work, not as bare
 * coordinates: adding works shifts whole rows, but "three metres in front
 * of the Commodore 64" still means the same thing afterwards. If that work
 * is gone, the bare coordinates are used instead.
 */
import type { Player } from "./player";

const KEY = "20watts.place.v1";
const SAVE_EVERY_S = 1;
const MOVED_M = 0.25;

interface Place {
  /** Nearest work and the offset from it, metres on the floor. */
  near: string | null;
  dx: number;
  dz: number;
  /** Absolute fallback. */
  x: number;
  z: number;
  yaw: number;
}

export interface Landmark {
  id: string;
  x: number;
  z: number;
}

function nearest(x: number, z: number, landmarks: Landmark[]): Landmark | null {
  let best: Landmark | null = null;
  let bestD = Infinity;
  for (const l of landmarks) {
    const d = (l.x - x) ** 2 + (l.z - z) ** 2;
    if (d < bestD) (bestD = d), (best = l);
  }
  return best;
}

function read(): Place | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Place>;
    if (typeof p.x !== "number" || typeof p.z !== "number" || typeof p.yaw !== "number") return null;
    return { near: typeof p.near === "string" ? p.near : null, dx: p.dx ?? 0, dz: p.dz ?? 0, x: p.x, z: p.z, yaw: p.yaw };
  } catch {
    return null;
  }
}

function write(p: Place) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private window or storage blocked: resuming is a convenience, not a requirement.
  }
}

/** Forget the saved place. */
export function clearPlace() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Put the visitor back where they were. Returns false if nothing was saved. */
export function restorePlace(player: Player, landmarks: Landmark[]): boolean {
  const p = read();
  if (!p) return false;
  const l = p.near ? landmarks.find((m) => m.id === p.near) : undefined;
  if (l) player.spawn(l.x + p.dx, l.z + p.dz, p.yaw);
  else player.spawn(p.x, p.z, p.yaw);
  return true;
}

/**
 * Returns a function to call every frame; it saves the place about once a
 * second while the visitor moves, and on pagehide regardless.
 */
export function trackPlace(player: Player, landmarks: Landmark[]): (dt: number) => void {
  let since = 0;
  let lastX = NaN;
  let lastZ = NaN;
  let lastYaw = NaN;
  const save = () => {
    const { x, z } = player.rig.position;
    const yaw = player.rig.rotation.y;
    lastX = x;
    lastZ = z;
    lastYaw = yaw;
    const l = nearest(x, z, landmarks);
    write({ near: l?.id ?? null, dx: l ? x - l.x : 0, dz: l ? z - l.z : 0, x, z, yaw });
  };
  window.addEventListener("pagehide", save);
  return (dt) => {
    since += dt;
    if (since < SAVE_EVERY_S) return;
    since = 0;
    const { x, z } = player.rig.position;
    if (Math.hypot(x - lastX, z - lastZ) < MOVED_M && Math.abs(player.rig.rotation.y - lastYaw) < 0.05) return;
    save();
  };
}
