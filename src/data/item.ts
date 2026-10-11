/**
 * An item: how a work is described before it is a record. One JSON file per
 * work in data/items/, written by a person or an agent who has found the
 * thing, checked its licence and read about it; `ingest` turns it into the
 * Artwork record the museum runs on, and the asset pipeline fills in what
 * only it can know (rungs, bounds, bytes). This is also the shape a
 * contribution will arrive in once there is a backend: the same file, the
 * same ingest, the same checks, with moderation deciding whether it shows.
 *
 * Everything a visitor reads comes from `object`; everything about the file
 * and its licence from `source`; everything about how it stands from the
 * top-level hints. Keep titles to names: places, editions, catalogue numbers
 * and "replica" belong in the description.
 */

export type ItemKind = "image" | "model" | "sim";

/** Where the file came from. `type` decides the record's id and provenance. */
export interface ItemSource {
  /**
   * "commons" (Wikimedia Commons, id wm-<curid>), "met", "cma", "smithsonian-3d",
   * "sketchfab", "zenodo", "nasa", "typeset" (an equation, id eq-<slug>),
   * "procedural" (a program in src/sims, id sim-<slug>), "video-still", "youtube" (id yt-<curid>), or
   * "user-upload" and anything else (id usr-<slug>).
   */
  type: string;
  /** The source's own id: Commons page id, Sketchfab uid, Zenodo record, NASA slug. */
  curid?: string | number | null;
  fileTitle?: string | null;
  url?: string;
  sourcePage?: string | null;
  /** Pixel size and byte count of the original. Optional: the pipeline measures them (Commons files are asked for) and keeps what it finds. */
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  mime?: string | null;
  /** "Public domain", "CC0", "CC BY 4.0"...; the ingest fills the URL for the common ones. */
  licenseName?: string | null;
  licenseUrl?: string | null;
  author?: string | null;
  /** Provenance in prose: what the file is, where it is from, how its licence was checked. Kept with the record. */
  notes?: string | null;
  /** What the museum did to the file to show it (cropped, rescaled, materials restored, a figure drawn); kept with the notes, as its own paragraph. */
  changes?: string | null;
  /** Typeset equations. */
  tex?: string;
  figure?: string;
  /** Simulations. */
  program?: string;
  params?: Record<string, number | string | boolean>;
  bounds?: { width: number; height: number; depth: number };
  /** Models: the original's format when it is not a glb ("voyager-document"). */
  format?: string;
  /** Models: fixes the pipeline bakes into the rungs. */
  unitScale?: number;
  rotation?: [number, number, number];
  omit?: string[];
  materials?: import("./types").MaterialFix[];
  pointSize?: number;
}

export interface ItemCreator {
  name: string;
  role?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  wikidataQid?: string | null;
  wikipediaUrl?: string | null;
  slug?: string | null;
}

/** The thing itself, as a visitor should learn of it. */
export interface ItemObject {
  year: number;
  month?: number | null;
  day?: number | null;
  yearStart?: number | null;
  yearEnd?: number | null;
  /** The date as the card says it: "c. 1600 BCE", "14 September 2015". */
  dateLabel: string;
  /** How exact the date is; worked out from the year and range when absent. */
  datePrecision?: "day" | "year" | "decade" | "century" | "circa";
  madeIn: { name?: string | null; region?: string | null; country?: string | null; lat?: number | null; lon?: number | null; wikidataQid?: string | null };
  location?: { name?: string | null; region?: string | null; country?: string | null; lat?: number | null; lon?: number | null; wikidataQid?: string | null; institution?: string | null; inventoryNumber?: string | null } | null;
  creator?: ItemCreator | null;
  /** More than one maker (a designer and a manufacturer): listed in order; `creator` is then ignored. */
  creators?: ItemCreator[];
  culture?: string | null;
  movement?: string | null;
  medium?: string | null;
  materials?: string[];
  subjects?: string[];
  widthCm?: number | null;
  heightCm?: number | null;
  depthCm?: number | null;
  weightKg?: number | null;
  description: string;
  facts?: string[];
  wikipediaUrl?: string | null;
  wikidataQid?: string | null;
}

export interface ItemAudio {
  type: string;
  url: string;
  bytes?: number | null;
  mime?: string | null;
  seconds?: number | null;
  start?: number;
  excerptSeconds?: number | null;
  performers?: string | null;
  author?: string | null;
  licenseName?: string | null;
  licenseUrl?: string | null;
  sourcePage?: string | null;
  notes?: string | null;
}

export interface ItemAlternate {
  url: string;
  width: number;
  height: number;
  bytes?: number | null;
  mime?: string | null;
  author?: string | null;
  licenseName?: string | null;
  licenseUrl?: string | null;
  sourcePage?: string | null;
  notes?: string | null;
}

export interface Item {
  slug: string;
  title: string;
  titleOriginal?: string | null;
  altTitles?: string[];
  kind: ItemKind;
  source: ItemSource;
  object: ItemObject;
  /** 0 to 1: how much the tour and the sound arbiter should favour it. */
  importance?: number;
  /** The guided visit stops here and says this: one line about the work itself. */
  tour?: string | null;
  genre?: string[];
  tags?: string[];
  periodSlug?: string | null;
  /** A flat work reproduced edge to edge (a painting, a page): its size is the image's size. */
  flat?: boolean;
  /** Models: a scan of the thing, or a reconstruction of it. */
  representation?: "scan" | "reconstruction";
  // How it stands; see DisplayHints in types.ts for each.
  baseHeight?: number | null;
  back?: "mirror" | "backing" | "none";
  yaw?: number | null;
  scale?: number | null;
  spin?: number | null;
  grab?: boolean | null;
  hearing?: number | null;
  threshold?: number | null;
  reveal?: number | null;
  invitation?: string | null;
  oculus?: import("./types").DisplayHints["oculus"];
  ring?: import("./types").DisplayHints["ring"];
  sky?: import("./types").SkyHint;
  fallbackWidthM?: number;
  loop?: import("./types").MotionLoop | null;
  order?: number | null;
  branch?: import("./types").Branch | null;
  landmark?: import("./types").Landmark | null;
  alternates?: ItemAlternate[];
  audio?: ItemAudio | null;
  /** Instead of a work of its own: a recording to hang on this existing record. */
  attachAudioTo?: string | null;
  moderation?: import("./types").Moderation | null;
  /** Shown under fair use rather than a free licence; flags say why. */
  copyrighted?: boolean;
  flags?: string[];
  /** Who made the record: an import, a visitor, or the museum by hand. */
  recordSource?: "wikipedia-import" | "user" | "admin";
  /** Further ids at other services, added to the ones the ingest derives. */
  externalIds?: Record<string, string>;
  /** Left out of the collection, with the reason in the notes. */
  skip?: boolean;
}
