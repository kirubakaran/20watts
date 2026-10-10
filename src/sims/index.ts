/**
 * Programs the museum runs live. A "sim" work names one of these and the
 * exhibit builds it in place of a downloaded image or model: a simulation
 * computed while you watch, or a shape built from published figures.
 *
 * Each program returns an object in metres with its base at y = 0 and its
 * footprint centred on the origin, like a model rung, and an update called
 * every frame with the time step and the visitor's distance. A program
 * should do little when the visitor is far: a canvas redrawn at full rate
 * for someone 80 m away is wasted on a phone.
 *
 * The palette is the museum's: ink on cream, the same sheet the equations
 * are set on, so a simulation reads as a page that happens to move.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace, DoubleSide } from "three";
import { life } from "./life";
import { mandelbrot } from "./mandelbrot";
import { lorenz } from "./lorenz";
import { fourier } from "./fourier";
import { galton } from "./galton";
import { turing } from "./turing";
import { pyramid } from "./pyramid";

export type Params = Record<string, number | string | boolean>;
export interface Bounds {
  width: number;
  height: number;
  depth: number;
}

export interface Sim {
  object: Object3D;
  /** Called every frame; `distance` is from the visitor's eyes to the work's centre, metres. */
  update(dt: number, distance: number): void;
  dispose(): void;
  /** Estimated GPU bytes held, for the streamer's budget. */
  residentBytes: number;
}

export type Program = (params: Params, bounds: Bounds) => Sim;

export const PROGRAMS: Record<string, Program> = { life, mandelbrot, lorenz, fourier, galton, turing, pyramid };

export const CREAM = "#f3eee3";
export const INK = "#2a2824";
export const INK_SOFT = "#8a857c";
export const RULE = "#d9d3c6";
export const ACCENT = "#a8503a";

/** Beyond this many metres a canvas program stops redrawing; nobody can tell. */
export const FREEZE_BEYOND = 60;

export function num(params: Params, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * A drawing surface standing upright, facing +Z: a canvas on a plane of
 * the given size in metres, hung with its bottom edge at y = 0, and the
 * canvas resolution chosen from the width so a metre gets `pxPerMetre`
 * pixels. Redraws are rate-limited by `draw(dt, distance)`, which calls
 * the painter at most `hz` times a second and not at all when frozen.
 */
export class Panel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;
  private acc = 0;

  constructor(widthM: number, heightM: number, pxPerMetre = 360, private readonly hz = 20) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(widthM * pxPerMetre);
    this.canvas.height = Math.round(heightM * pxPerMetre);
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: this.texture, toneMapped: false, side: DoubleSide }),
    );
    this.mesh.position.y = heightM / 2;
  }

  get w(): number {
    return this.canvas.width;
  }
  get h(): number {
    return this.canvas.height;
  }

  /** Clear to the cream sheet. */
  clear() {
    this.ctx.fillStyle = CREAM;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  /** Paint now, whatever the rate. */
  paint(painter: () => void) {
    painter();
    this.texture.needsUpdate = true;
  }

  /** Paint at most `hz` a second, never when the visitor is too far to see it. Returns the seconds advanced. */
  draw(dt: number, distance: number, painter: (elapsed: number) => void): number {
    this.acc += dt;
    if (distance > FREEZE_BEYOND || this.acc < 1 / this.hz) return 0;
    const elapsed = this.acc;
    this.acc = 0;
    painter(elapsed);
    this.texture.needsUpdate = true;
    return elapsed;
  }

  get residentBytes(): number {
    return this.w * this.h * 4;
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

/** A small caption in the corner of a panel: what you are looking at. */
export function caption(p: Panel, text: string, atTop = false) {
  const ctx = p.ctx;
  ctx.font = `${Math.round(p.w * 0.018)}px system-ui, sans-serif`;
  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = "left";
  ctx.textBaseline = atTop ? "top" : "bottom";
  ctx.fillText(text, p.w * 0.025, atTop ? p.h * 0.03 : p.h * 0.97);
}
