/**
 * Where collection assets live. The catalogue stores root-relative paths
 * like /assets/<id>/high.glb; this prepends the host that serves them, so
 * the same catalogue works from the dev server, from the colo, or from a
 * bucket in an emergency. Set VITE_ASSET_BASE at build time, e.g.
 * "https://assets.example.org". Empty means same origin.
 */
const BASE = (import.meta.env.VITE_ASSET_BASE ?? "").replace(/\/+$/, "");

export function assetUrl(path: string): string {
  return BASE + path;
}
