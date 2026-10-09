/**
 * The entrance: a stone gateway across the spine that a new visitor stands
 * outside of, looking through at the oldest work. One line is cut into the
 * lintel, and a small plaque on the left pier says how to read the floor.
 * It is the only construction in the museum, and the only text that is
 * not about a work.
 */
import { BoxGeometry, CanvasTexture, FrontSide, Group, Mesh, MeshStandardMaterial, SRGBColorSpace } from "three";
import { Text } from "troika-three-text";

const FONT_REGULAR = "/fonts/inter-400.woff";
const FONT_BOLD = "/fonts/inter-600.woff";

export const INSCRIPTION = "BEHOLD THE WORKS OF 20-WATT BRAINS";

/** Pier centres sit this far either side of the spine. */
const HALF_SPAN = 3.2;
const PIER = { w: 0.7, d: 0.7, h: 3.1 };
const LINTEL = { h: 1.0, d: 0.8 };
const CAP = { h: 0.14, overhang: 0.25 };
const STONE = 0xd9d3c6;
const PX_PER_M = 400;

function plaqueText(str: string, width: number): Text {
  const t = new Text();
  t.material.side = FrontSide;
  t.text = str;
  t.font = FONT_REGULAR;
  t.fontSize = 0.042;
  t.lineHeight = 1.3;
  t.maxWidth = width;
  t.color = 0x5a554c;
  t.anchorX = "center";
  t.anchorY = "middle";
  t.textAlign = "left";
  t.depthOffset = -1;
  t.sync();
  return t;
}

function block(w: number, h: number, d: number, material: MeshStandardMaterial | MeshStandardMaterial[]): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Stone with a line cut into it: the colour map carries the faint grain and
 * the slightly darker floor of the cut, the bump map gives the cut its
 * edges, so the sun does the rest. Drawn once the font is in.
 */
function inscribedStone(widthM: number, heightM: number, line: string): MeshStandardMaterial {
  const w = Math.round(widthM * PX_PER_M);
  const h = Math.round(heightM * PX_PER_M);
  const colour = document.createElement("canvas");
  const bump = document.createElement("canvas");
  colour.width = bump.width = w;
  colour.height = bump.height = h;

  const base = `#${STONE.toString(16).padStart(6, "0")}`;
  const cc = colour.getContext("2d")!;
  const bc = bump.getContext("2d")!;
  cc.fillStyle = base;
  cc.fillRect(0, 0, w, h);
  // Faint grain, so the face is not a flat fill next to the other faces.
  for (let i = 0; i < w * h * 0.004; i++) {
    cc.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.045)";
    cc.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  bc.fillStyle = "#808080";
  bc.fillRect(0, 0, w, h);

  const colourMap = new CanvasTexture(colour);
  colourMap.colorSpace = SRGBColorSpace;
  colourMap.anisotropy = 8;
  const bumpMap = new CanvasTexture(bump);
  const material = new MeshStandardMaterial({
    map: colourMap,
    bumpMap,
    bumpScale: 4,
    roughness: 0.85,
    metalness: 0,
  });

  const draw = () => {
    // Fit the line to the face: at most 86% of its width, at most half its height.
    let px = h * 0.5;
    const font = (size: number) => `600 ${size}px "Inter Inscription", sans-serif`;
    cc.font = font(px);
    cc.letterSpacing = "0.08em";
    const measured = cc.measureText(line).width;
    if (measured > w * 0.86) px *= (w * 0.86) / measured;
    for (const ctx of [cc, bc]) {
      ctx.font = font(px);
      ctx.letterSpacing = "0.08em";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    }
    // The floor of the cut is in shadow: a little darker and a little cooler.
    cc.fillStyle = "rgba(60, 54, 46, 0.42)";
    cc.fillText(line, w / 2, h / 2 + px * 0.04);
    // Lower in the bump map, with a soft edge so the bevel catches the light.
    bc.filter = "blur(1.2px)";
    bc.fillStyle = "#2a2a2a";
    bc.fillText(line, w / 2, h / 2 + px * 0.04);
    bc.filter = "none";
    colourMap.needsUpdate = true;
    bumpMap.needsUpdate = true;
  };

  const face = new FontFace("Inter Inscription", `url(${FONT_BOLD})`);
  face
    .load()
    .then((f) => {
      document.fonts.add(f);
      draw();
    })
    .catch(draw);
  return material;
}

/** The gateway, centred on the spine, facing +Z (toward the arriving visitor). Base at y = 0. */
export function buildEntrance(): Group {
  const g = new Group();
  const stone = new MeshStandardMaterial({ color: STONE, roughness: 0.85, metalness: 0 });

  for (const side of [-1, 1]) {
    const pier = block(PIER.w, PIER.h, PIER.d, stone);
    pier.position.set(side * HALF_SPAN, PIER.h / 2, 0);
    g.add(pier);
  }
  const span = 2 * HALF_SPAN + PIER.w;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z; the inscription is on +z, the front.
  const inscribed = inscribedStone(span, LINTEL.h, INSCRIPTION);
  const lintel = block(span, LINTEL.h, LINTEL.d, [stone, stone, stone, stone, inscribed, stone]);
  lintel.position.set(0, PIER.h + LINTEL.h / 2, 0);
  g.add(lintel);
  const cap = block(span + 2 * CAP.overhang, CAP.h, LINTEL.d + 2 * CAP.overhang, stone);
  cap.position.set(0, PIER.h + LINTEL.h + CAP.h / 2, 0);
  g.add(cap);

  // How to read the floor, on the left pier at eye height.
  const plaque = plaqueText(
    "Forward is later in time.\nEast is to your right.\nEvery work stands at its true size.\nThe eras are written on the floor.",
    PIER.w - 0.12,
  );
  plaque.position.set(-HALF_SPAN, 1.5, PIER.d / 2 + 0.003);
  g.add(plaque);

  return g;
}
