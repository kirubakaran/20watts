/**
 * Touch controls, for a phone or a tablet: drag anywhere on the canvas to
 * look around, a thumbstick in the bottom-left corner to walk, and a row
 * of buttons in the bottom-right for the hops, since walking 500 m by
 * thumb is no way to see a museum. The buttons fire the same actions the
 * keyboard and the headset do. The DOM is in index.html (#touch); this
 * only wires it.
 */
import type { Action, Player } from "./player";

const STICK_RADIUS = 44;

export function hasTouch(): boolean {
  return matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).has("touch");
}

export function setupTouch(player: Player, canvas: HTMLElement, onAction: (a: Action) => void) {
  document.body.classList.add("touch");

  // Look: one finger dragging on the canvas. Only the first finger steers.
  let lookId: number | null = null;
  let lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || lookId !== null) return;
    lookId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId) return;
    // A full-height drag turns about a quarter turn.
    const k = (Math.PI / 2) / Math.min(window.innerWidth, window.innerHeight);
    player.look((e.clientX - lastX) * k, (e.clientY - lastY) * k);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const lookEnd = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = null; };
  canvas.addEventListener("pointerup", lookEnd);
  canvas.addEventListener("pointercancel", lookEnd);

  // Walk: a thumbstick. The knob follows the finger within the ring; the
  // offset, as a fraction of the radius, is the walking vector.
  const stick = document.getElementById("stick")!;
  const knob = stick.querySelector<HTMLElement>(".knob")!;
  let stickId: number | null = null;
  let cx = 0, cy = 0;
  const setKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    player.setTouchWalk(dx / STICK_RADIUS, -dy / STICK_RADIUS);
  };
  stick.addEventListener("pointerdown", (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    e.preventDefault();
  });
  stick.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
    setKnob(dx, dy);
  });
  const stickEnd = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    setKnob(0, 0);
  };
  stick.addEventListener("pointerup", stickEnd);
  stick.addEventListener("pointercancel", stickEnd);

  // Hops.
  for (const b of document.querySelectorAll<HTMLButtonElement>("#hops button")) {
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", () => onAction(b.dataset.action as Action));
  }
}
