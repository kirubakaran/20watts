/**
 * The artwork record. This is the full attribute list the museum will ever
 * need, written down now so that imports, user contributions, moderation,
 * 3D objects and layout all hang off one schema from day one.
 *
 * Conventions:
 *  - Distances in metres, physical sizes in centimetres, dates as years
 *    (negative for BCE), timestamps as ISO 8601 strings.
 *  - `id` is stable for the life of the record and never encodes the image.
 *    Imports from Wikimedia use "wm-<commons page curid>", Smithsonian 3D
 *    imports use "si-<EDAN record id>", Sketchfab imports use "sf-<model uid>",
 *    Zenodo mirrors use "zen-<record id>", Met images use "met-<object id>",
 *    user additions use "usr-<uuid>".
 */

export type ArtworkId = string;

export type ArtworkKind = "image" | "model";

export interface Creator {
  name: string;
  slug: string | null;
  wikidataQid: string | null;
  wikipediaUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
  /** "painter" | "workshop" | "attributed" | "after" | "sculptor" | "engineer" ... */
  role: string | null;
}

export interface DateInfo {
  /** The single year used for ordering on the time axis. Always present. */
  year: number;
  /** Month (1–12) and day of that year when known; they refine the order. */
  month: number | null;
  day: number | null;
  yearStart: number | null;
  yearEnd: number | null;
  /** Human label, e.g. "c. 1495–1498". */
  label: string;
  precision: "day" | "year" | "decade" | "century" | "circa";
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Place {
  name: string | null;
  region: string | null;
  country: string | null;
  point: GeoPoint | null;
  wikidataQid: string | null;
}

export interface CurrentLocation extends Place {
  institution: string | null;
  inventoryNumber: string | null;
}

export interface PhysicalSize {
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  weightKg: number | null;
}

export interface License {
  /** e.g. "Public domain", "CC BY-SA 4.0", "Fair use". */
  name: string;
  url: string | null;
}

export interface Credit {
  author: string | null;
  license: License;
  /** The page that documents the file, e.g. its Commons description page. */
  sourcePage: string | null;
}

export type ModerationStatus = "approved" | "pending" | "rejected" | "takedown";

export interface Moderation {
  status: ModerationStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reason: string | null;
  flags: string[];
}

export interface Contribution {
  /** User id, or null for automated imports. */
  by: string | null;
  at: string;
  note: string | null;
}

/** One rung of the thumbnail ladder; the renderer picks a rung by distance. */
export interface ImageRung {
  width: number;
  height: number;
  url: string;
  bytes: number | null;
}

/**
 * A short silent clip that replaces the still when the visitor is close.
 * Cut by the pipeline from the source video in data/originals.
 */
export interface MotionLoop {
  /** Seconds into the source video where the loop (and the still) begin. */
  start: number;
  seconds: number;
  url: string;
  width: number;
  height: number;
  bytes: number | null;
}

export interface ImageVersion {
  id: string;
  original: {
    url: string;
    width: number;
    height: number;
    bytes: number | null;
    mime: string;
  };
  /** Ascending by width. Populated by the asset pipeline, served from our host. */
  rungs: ImageRung[];
  /** Optional motion, for a work that is really a moving image. */
  loop: MotionLoop | null;
  credit: Credit;
  contributed: Contribution;
  moderation: Moderation;
  /**
   * "wikimedia-commons" | "video-still" | "screenshot" | "user-upload" | "iiif" ...
   * "video-still" means the original is a video in data/originals and both
   * the still and the loop are cut from it.
   */
  provenance: string;
}

/** One quality tier of a model, served from our host. */
export interface ModelRung {
  quality: "thumb" | "low" | "medium" | "high";
  url: string;
  bytes: number | null;
  triangles: number | null;
  /** Largest texture edge in pixels; the renderer picks a rung by this. */
  textureSize: number | null;
  /** Mesh is KHR_draco_mesh_compression encoded; the loader needs the decoder. */
  draco: boolean;
}

export interface ModelVersion {
  id: string;
  /** Where the model came from: a glb, or a scene manifest the pipeline understands. */
  original: {
    url: string;
    /** "glb" | "voyager-document" ... */
    format: string;
    bytes: number | null;
    triangles: number | null;
    /**
     * Metres per unit of the source file, when it is not in metres (many
     * photogrammetry exports are unitless). The pipeline bakes it into the
     * rungs, so the rungs are always metres. Omit or 1 for a file in metres.
     */
    unitScale?: number;
    /**
     * Rotation to apply to the source, as XYZ Euler angles in degrees, for a
     * scan that is not upright or does not face +Z. Baked into the rungs.
     */
    rotation?: [number, number, number];
  };
  /**
   * Ascending by quality. Each rung is one .glb, Y-up, in metres, with the
   * base at y = 0 and the footprint centred on the origin. Populated by the
   * asset pipeline, which bakes unit and origin fixes into the file.
   */
  rungs: ModelRung[];
  /** Multiplier applied on top of the file, normally 1. */
  scale: number;
  /** Axis-aligned bounds in metres after `scale`. */
  bounds: { width: number; height: number; depth: number };
  credit: Credit;
  contributed: Contribution;
  moderation: Moderation;
  /**
   * "smithsonian-3d" | "zenodo" | "sketchfab" | "user-upload" ...
   * "zenodo" (or any direct glb URL) is downloaded into data/originals.
   * Sources the pipeline cannot fetch itself (Sketchfab needs a login, uploads
   * arrive by hand) are read from data/originals/<artwork id>/ instead.
   */
  provenance: string;
  /** A scan of the actual object, or an artist's reconstruction of its type. */
  representation: "scan" | "reconstruction";
}

export interface ImageAsset {
  kind: "image";
  currentVersionId: string;
  versions: ImageVersion[];
}

export interface ModelAsset {
  kind: "model";
  currentVersionId: string;
  versions: ModelVersion[];
}

/**
 * A side quest: this work stands beside another, off the main lane, because
 * the two belong together in a way time does not show: the chip inside a
 * computer, the manual that came in its box, the die inside the chip.
 * Steps count outward from the anchor, 1 nearest; a step's own date is kept
 * for the placard but does not place it. A branch of a branch is allowed
 * (the anchor may itself be a branch work); the chain stands in one row.
 */
export interface Branch {
  of: ArtworkId;
  step: number;
  /** Stencilled on the floor in front of it, e.g. "the chip inside". */
  label: string;
}

export interface DisplayHints {
  /** Multiplier on physical size. 1 = true scale. */
  scale: number;
  /**
   * Height of the bottom edge (image) or base (model) above the floor,
   * metres. null lets the museum decide, see baseHeightOf(): small things
   * rise to display-case height, big things stand on the floor.
   */
  baseHeight: number | null;
  /** Images only: what you see from behind. */
  back: "mirror" | "backing" | "none";
  /** Facing override in radians; null lets the layout decide. */
  yaw: number | null;
  /** Width in metres to use when physical size is unknown. */
  fallbackWidthM: number;
}

export interface Artwork {
  id: ArtworkId;
  kind: ArtworkKind;
  title: string;
  titleOriginal: string | null;
  altTitles: string[];
  creators: Creator[];
  date: DateInfo;
  /** Where it was made. Kept for the world view (`?view=world`), which spreads a row by longitude. */
  madeIn: Place;
  /** Where it is today. */
  location: CurrentLocation;
  /** e.g. "Italian". */
  culture: string | null;
  /** e.g. "High Renaissance". */
  movement: string | null;
  /** Period slug as used by the Wikipedia-derived dataset; kept for import compatibility. */
  periodSlug: string | null;
  medium: string | null;
  materials: string[];
  genre: string[];
  /** What is depicted. */
  subjects: string[];
  physical: PhysicalSize;
  description: string;
  facts: string[];
  wikipediaUrl: string | null;
  wikidataQid: string | null;
  /** Other catalogue ids: { "commons-curid": "...", "met": "...", "rkd": "..." }. */
  externalIds: Record<string, string>;
  /** Still in copyright; display under fair use with a label. */
  copyrighted: boolean;
  asset: ImageAsset | ModelAsset;
  display: DisplayHints;
  tags: string[];
  /** Wikipedia pageviews over the trailing year; a popularity signal. */
  pageviews: number | null;
  /** Editorial importance 0..1; the last resort for ordering works that share a date. */
  importance: number | null;
  /**
   * Hand-set order among works of the same month on the main lane; lower
   * stands earlier (further west). Absent: by day, then importance.
   */
  order?: number;
  /** Where it stands when not on the main lane. Absent: on the lane, in time order. */
  branch?: Branch;
  /**
   * Other ways of showing the same work: a photograph beside a scan, the
   * earlier part beside the later one. `asset` is what is shown; these are
   * recorded with full credit and provenance so a device that cannot show
   * the first, or a later editor, can fall back or switch without a new
   * record. The pipeline builds their rungs; the renderer does not read
   * them yet.
   */
  alternates?: (ImageAsset | ModelAsset)[];
  moderation: Moderation;
  source: "wikipedia-import" | "user" | "admin";
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  schemaVersion: 1;
  generatedAt: string;
  artworks: Artwork[];
}

/** Footprint on the ground in metres, used by the layout. */
export interface Footprint {
  width: number;
  depth: number;
  height: number;
}

/** Every asset of a work, shown one first. */
export function assetsOf(a: Artwork): (ImageAsset | ModelAsset)[] {
  return [a.asset, ...(a.alternates ?? [])];
}

/**
 * The works on display: approved, and not a branch of something absent.
 * The order is the collection's, which is by date.
 */
export function onDisplay(artworks: Artwork[]): Artwork[] {
  let shown = artworks.filter((a) => a.moderation.status === "approved");
  // A branch whose anchor is not shown is not shown; repeat for chains.
  for (;;) {
    const ids = new Set(shown.map((a) => a.id));
    const next = shown.filter((a) => !a.branch || ids.has(a.branch.of));
    if (next.length === shown.length) return next;
    shown = next;
  }
}

export function currentImageVersion(a: Artwork): ImageVersion | null {
  if (a.asset.kind !== "image") return null;
  return a.asset.versions.find((v) => v.id === a.asset.currentVersionId) ?? a.asset.versions[0] ?? null;
}

export function currentModelVersion(a: Artwork): ModelVersion | null {
  if (a.asset.kind !== "model") return null;
  return a.asset.versions.find((v) => v.id === a.asset.currentVersionId) ?? a.asset.versions[0] ?? null;
}

/** Display size in metres for an image, from physical size, else pixel aspect and fallback width. */
export function imageDisplaySize(a: Artwork): { width: number; height: number } {
  const s = a.display.scale;
  const { widthCm, heightCm } = a.physical;
  if (widthCm && heightCm) return { width: (widthCm / 100) * s, height: (heightCm / 100) * s };
  const v = currentImageVersion(a);
  const aspect = v ? v.original.height / v.original.width : 1;
  const w = a.display.fallbackWidthM * s;
  return { width: w, height: w * aspect };
}

/**
 * Where the bottom of a work sits above the floor. An explicit baseHeight
 * wins. Otherwise a model is raised so that it reads at a comfortable height:
 * something small and upright (a phone, a point) is centred at 1.4 m, just
 * below the eyes; something small and flat (a keyboard) a little lower, at
 * 1.15 m, so its top face is seen; the lift tapers off with size and a work
 * over 1.2 m tall stands on the floor. An image hangs with its centre at
 * 1.5 m, or from the floor when it is too tall for that.
 */
export function baseHeightOf(a: Artwork): number {
  if (a.display.baseHeight != null) return a.display.baseHeight;
  const fp = footprintOf(a);
  if (a.kind === "image") return Math.max(0, 1.5 - fp.height / 2);
  const h = fp.height;
  if (h >= 1.2) return 0;
  const aspect = h / Math.max(fp.width, fp.depth, 1e-6);
  const t = Math.min(1, Math.max(0, (aspect - 0.25) / 0.35)); // 0 flat .. 1 upright
  const centre = 1.15 + 0.25 * t;
  const lift = centre - h / 2;
  // Taper to the floor between 0.6 m and 1.2 m tall.
  return h <= 0.6 ? lift : lift * ((1.2 - h) / 0.6);
}

export function footprintOf(a: Artwork): Footprint {
  if (a.kind === "model") {
    const v = currentModelVersion(a);
    const b = v ? v.bounds : { width: 1, height: 1, depth: 1 };
    const s = a.display.scale;
    return { width: b.width * s, depth: b.depth * s, height: b.height * s };
  }
  const { width, height } = imageDisplaySize(a);
  // A floating image is thin, but give it some depth so neighbours keep clear.
  return { width, depth: 0.5, height };
}
