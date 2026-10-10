/**
 * Where collection assets live. The catalogue stores root-relative paths
 * like /assets/<id>/high.glb; this prepends the host that serves them, so
 * the same catalogue works from the dev server, from the colo, or from a
 * bucket in an emergency. Set VITE_ASSET_BASE at build time, e.g.
 * "https://assets.example.org". Empty means same origin.
 */
const BASE = (import.meta.env.VITE_ASSET_BASE ?? "").replace(/\/+$/, "");

/**
 * The URL to fetch a derived file from. Rung paths are stable, so a file
 * rebuilt in place (a sheet re-typeset with a figure, a model re-exported)
 * would otherwise be served from a browser's cache for as long as the host
 * allows. Its size from the catalogue is appended as a version tag: a
 * different file is a different URL.
 */
export function assetUrl(path: string, bytes?: number | null): string {
  return BASE + path + (bytes ? `?v=${bytes}` : "");
}
