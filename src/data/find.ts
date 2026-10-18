/**
 * Which work a link means. `?at=` takes a slug (`stonehenge`), an alias
 * (`ligo`), a record id, a year, or "newest"; names are matched without
 * regard to case. Returns the record id, or the text itself when nothing
 * matches, so the caller's lookup fails in the ordinary way.
 */
import type { Artwork } from "./types";

export function resolveAt(visible: Artwork[], at: string): string {
  const key = at.trim().toLowerCase();
  if (!key) return at;
  if (key === "newest") {
    return visible.reduce((best, a) => (a.createdAt >= best.createdAt ? a : best)).id;
  }
  const named = visible.find((a) => a.id.toLowerCase() === key || a.slug.toLowerCase() === key || a.aliases.some((n) => n.toLowerCase() === key));
  if (named) return named.id;
  const year = Number(key);
  if (Number.isFinite(year)) {
    // On the lane: a branch work stands in its anchor's year, not its own.
    const lane = visible.filter((a) => !a.branch);
    return lane.reduce((best, a) => (Math.abs(a.date.year - year) < Math.abs(best.date.year - year) ? a : best)).id;
  }
  return at;
}
