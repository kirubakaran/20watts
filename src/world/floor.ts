/**
 * The ground and the light. There are no walls: the museum is one open
 * plane. The floor carries a faint grid so motion reads in VR, and fog
 * fades the far distance into the background colour.
 */
import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
} from "three";

export const BACKGROUND = new Color(0xe9e6df);

function gridTexture(): CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#cfcac0";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#bfb9ae";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function buildWorld(scene: Scene, extent = 2000) {
  scene.background = BACKGROUND;
  scene.fog = new Fog(BACKGROUND, 40, 160);

  const tex = gridTexture();
  tex.repeat.set(extent / 2, extent / 2); // one tile = 2 m
  const floor = new Mesh(
    new PlaneGeometry(extent, extent),
    new MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = "floor";
  scene.add(floor);

  scene.add(new HemisphereLight(0xffffff, 0xb8b2a6, 1.1));
  const sun = new DirectionalLight(0xfff4e6, 1.2);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  return { floor };
}
