/**
 * The sign at the entrance: the name, what it means, and how to read the
 * floor. It stands beside the spot where a new visitor arrives, angled
 * toward the spine, and is the only text in the museum that is not about
 * a work.
 */
import { FrontSide, Group } from "three";
import { Text } from "troika-three-text";

const FONT_REGULAR = "/fonts/inter-400.woff";
const FONT_BOLD = "/fonts/inter-600.woff";

function line(text: string, font: string, size: number, color: number, y: number, width: number): Text {
  const t = new Text();
  t.material.side = FrontSide;
  t.text = text;
  t.font = font;
  t.fontSize = size;
  t.lineHeight = 1.3;
  t.maxWidth = width;
  t.color = color;
  t.anchorX = "center";
  t.anchorY = "top";
  t.textAlign = "center";
  t.position.y = y;
  t.sync();
  return t;
}

export function buildWelcomeSign(): Group {
  const g = new Group();
  const w = 2.2;
  g.add(line("20watts", FONT_BOLD, 0.26, 0x2a2824, 0.95, w));
  g.add(line("Everything here was made by a 20-watt brain.", FONT_REGULAR, 0.1, 0x3a3832, 0.58, w));
  g.add(
    line(
      "Forward is later in time. East is to your right.\nEvery work stands at its true size.\nThe eras are written on the floor.",
      FONT_REGULAR,
      0.07,
      0x5e584e,
      0.3,
      w,
    ),
  );
  return g;
}
