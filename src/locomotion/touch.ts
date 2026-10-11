/**
 * Touch controls, for a phone or a tablet: drag anywhere on the canvas to
 * look around, a thumbstick in the bottom-left corner to walk, and a row
 * of buttons in the bottom-right for the hops, since walking 500 m by
 * thumb is no way to see a museum. The buttons fire the same actions the
 * keyboard and the headset do. The DOM is in index.html (#touch); this
 * only wires it.
 */
import type { Action, Player } from "./player";
import type { Coach } from "./coach";

const STICK_RADIUS = 44;

export function hasTouch(): boolean {
  return matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).has("touch");
}

export function setupTouch(player: Player, canvas: HTMLElement, onAction: (a: Action) => void, onTap: (x: number, y: number) => void, coach: Coach) {
  document.body.classList.add("touch");

  // Look: one finger dragging on the canvas. Only the first finger steers.
  let lookId: number | null = null;
  let lastX = 0, lastY = 0;
  let downX = 0, downY = 0, downAt = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || lookId !== null) return;
    lookId = e.pointerId;
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    downAt = performance.now();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId) return;
    // A full-height drag turns about a quarter turn.
    const k = (Math.PI / 2) / Math.min(window.innerWidth, window.innerHeight);
    player.look((e.clientX - lastX) * k, (e.clientY - lastY) * k);
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 24) coach.learn("touch.look");
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const lookEnd = (e: PointerEvent) => {
    if (e.pointerId !== lookId) return;
    lookId = null;
    // A tap, not a drag: the museum decides whether it was on a work (read) or the floor (walk there).
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 12 && performance.now() - downAt < 350) onTap(e.clientX, e.clientY);
  };
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
    if (len > STICK_RADIUS * 0.5) coach.learn("touch.walk");
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
    b.addEventListener("click", () => { coach.learn("touch.hop"); onAction(b.dataset.action as Action); });
  }
}
