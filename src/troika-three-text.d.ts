// Minimal typing for troika-three-text; its bundled declarations are incomplete.
declare module "troika-three-text" {
  import { Mesh } from "three";
  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    lineHeight: number | "normal";
    letterSpacing: number;
    maxWidth: number;
    color: number | string;
    /** Opacity of the glyph fill, 0..1. */
    fillOpacity: number;
    depthOffset: number;
    anchorX: number | "left" | "center" | "right" | `${number}%`;
    anchorY: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom" | `${number}%`;
    textAlign: "left" | "right" | "center" | "justify";
    /** Layout result, available after sync(). blockBounds is [minX, minY, maxX, maxY] in local units. */
    textRenderInfo: { blockBounds: [number, number, number, number] } | null;
    sync(callback?: () => void): void;
    dispose(): void;
  }
  export function preloadFont(options: { font?: string; characters?: string }, callback: () => void): void;
}
