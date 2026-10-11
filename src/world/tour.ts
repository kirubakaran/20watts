/**
 * A guided first visit: a short path through the museum, one line about
 * each stop, for someone who does not yet know what to look for. T (or
 * the tour buttons on a phone) goes to the next stop; Shift T goes back.
 * Where you are in it is remembered in the browser, so a visit can be
 * picked up where it was left. Walking off between stops is fine; the
 * next press carries on from the next stop.
 *
 * Stops are the works that carry a `tour` line in their record, so a
 * contributor proposes a stop by writing the line, and one that is not on
 * display is simply not a stop.
 */
import type { Artwork } from "../data/types";

export interface Stop {
  id: string;
  /** One line, said on arrival. */
  line: string;
}

/**
 * The stops: every work on display with a `tour` line, in the order of the
 * lane (by date; a branch stands with its anchor, its own line after the
 * anchor's), so the visitor never doubles back.
 */
export function tourOf(visible: Artwork[]): Stop[] {
  const byId = new Map(visible.map((a) => [a.id, a]));
  const key = (a: Artwork): [number, number, number] => {
    const anchor = a.branch ? byId.get(a.branch.of) : undefined;
    const d = (anchor ?? a).date;
    return [d.year, d.month ?? 0, anchor ? Math.abs(a.branch!.step) : 0];
  };
  return visible
    .filter((a) => a.tour)
    .sort((p, q) => { const a = key(p), b = key(q); return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; })
    .map((a) => ({ id: a.id, line: a.tour! }));
}

const KEY = "20watts.tour.v1";
const SHOW_SECONDS = 14;

export class Tour {
  private readonly stops: Stop[];
  private at = -1;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    visible: Artwork[],
    private readonly goTo: (id: string) => boolean,
    private readonly caption: HTMLElement | null,
  ) {
    this.stops = tourOf(visible);
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (Number.isInteger(saved) && saved >= -1 && saved < this.stops.length) this.at = saved;
    } catch {
      /* no storage: the tour starts at the beginning each time */
    }
  }

  /** From the beginning. */
  /** The stops in order, for tools that photograph them. */
  get ids(): string[] {
    return this.stops.map((s) => s.id);
  }

  start() {
    this.at = -1;
    this.step(1);
  }

  /** The next stop (dir 1) or the previous (dir -1). At either end it says so and stays. */
  step(dir: 1 | -1) {
    const next = this.at + dir;
    if (next < 0 || next >= this.stops.length) {
      this.say(dir > 0 ? "That is the end of the tour. Wander." : "This is the first stop.", null);
      return;
    }
    this.at = next;
    try {
      localStorage.setItem(KEY, String(this.at));
    } catch {
      /* fine */
    }
    const stop = this.stops[this.at]!;
    this.goTo(stop.id);
    this.say(stop.line, `${this.at + 1} of ${this.stops.length}`);
  }

  private say(text: string, count: string | null) {
    if (!this.caption) return;
    this.caption.replaceChildren();
    if (count) {
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = count;
      this.caption.append(n);
    }
    const line = document.createElement("span");
    line.className = "line";
    line.textContent = text;
    this.caption.append(line);
    if (count && this.at < this.stops.length - 1) {
      const hint = document.createElement("span");
      hint.className = "next";
      hint.textContent = "T for the next stop";
      this.caption.append(hint);
    }
    this.caption.classList.add("on");
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.caption?.classList.remove("on"), SHOW_SECONDS * 1000);
  }
}
