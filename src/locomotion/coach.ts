/**
 * What a visitor has already learned to do, so the museum stops telling
 * them. Each control gets a hint until it has been used once; the lesson
 * is kept in the browser, so a second visit starts without the hints.
 * Nothing else is stored.
 */
export type Lesson = "touch.look" | "touch.walk" | "touch.read" | "touch.hop" | "vr.read" | "vr.hop" | "vr.grab";

const KEY = "20watts.learned.v1";

export class Coach {
  private readonly learned = new Set<Lesson>();
  private readonly listeners = new Set<() => void>();

  constructor() {
    try {
      for (const l of JSON.parse(localStorage.getItem(KEY) ?? "[]") as Lesson[]) this.learned.add(l);
    } catch {
      /* no storage: every visit is a first visit */
    }
  }

  has(lesson: Lesson): boolean {
    return this.learned.has(lesson);
  }

  /** Mark a control used. Returns true the first time. */
  learn(lesson: Lesson): boolean {
    if (this.learned.has(lesson)) return false;
    this.learned.add(lesson);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.learned]));
    } catch {
      /* fine */
    }
    for (const fn of this.listeners) fn();
    return true;
  }

  /** Called whenever a lesson is learned, for hints that should go away. */
  onChange(fn: () => void) {
    this.listeners.add(fn);
    fn();
  }

  /** Reflect the lessons on the document, so CSS can hide what is learned: body.learned-touch-walk etc. */
  reflect(body: HTMLElement) {
    this.onChange(() => {
      for (const l of this.learned) body.classList.add(`learned-${l.replace(".", "-")}`);
    });
  }
}
