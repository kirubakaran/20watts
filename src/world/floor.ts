/**
 * The ground, the sky and the light. There are no walls: the museum is one
 * open plane under a skylit gallery sky.
 *
 *  Floor:  polished concrete drawn procedurally, in 16 m tiles with
 *          hairline joints every 4 m and a firmer line on the tile edge,
 *          so a quiet grid gives the eye a scale. Rows are at least 16 m
 *          apart, so the grid often, not always, falls on a row boundary.
 *          The plane is finite but follows the visitor, so the lane can
 *          grow without anyone walking off its edge.
 *  Sky:    a gradient dome, warm pale horizon to a cooler zenith, with the
 *          fog matched to the horizon so distance fades cleanly. Near some
 *          works it turns to a night of stars or a sunrise (see sky.ts),
 *          and the lights dim with it.
 *  Light:  an overcast HDRI as the environment map (never drawn) so PBR
 *          materials have something to reflect, plus a soft directional
 *          light that casts shadows for models and follows the visitor.
 */
import {
  CanvasTexture,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { HORIZON, Sky, type SkyState } from "./sky";

export { HORIZON, ZENITH } from "./sky";
export const BACKGROUND = HORIZON;

/** Layout cell pitch in metres; the floor tile repeats at this size. */
const CELL = 16;
const ENV_URL = "/env/overcast_soil_puresky_1k.hdr";

function concreteTexture(): CanvasTexture {
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#b8b2a6";
  ctx.fillRect(0, 0, size, size);

  // Mottling: many soft, low-contrast blots at a few scales.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [count, radius, alpha] of [
    [60, 220, 0.07],
    [260, 70, 0.07],
    [1400, 14, 0.08],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const x = rnd() * size, y = rnd() * size, r = radius * (0.5 + rnd());
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.5;
      g.addColorStop(0, dark ? `rgba(60,55,48,${alpha})` : `rgba(255,252,245,${alpha})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  // Joints every 4 m, a firmer one on the cell boundary.
  const joint = size / (CELL / 4);
  ctx.strokeStyle = "rgba(90,84,74,0.35)";
  ctx.lineWidth = 2;
  for (let i = 1; i < CELL / 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * joint, 0); ctx.lineTo(i * joint, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * joint); ctx.lineTo(size, i * joint); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(90,84,74,0.6)";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

export interface World {
  floor: Mesh;
  sky: Sky;
  /** Call each frame so the floor, the sky and the shadow-casting light stay centred on the visitor. */
  follow(viewer: Vector3): void;
  /** Call each frame with what the sky should be doing; the fog and the lights follow it. */
  setSky(state: SkyState): void;
}

export function buildWorld(scene: Scene, renderer: WebGLRenderer, extent = 2000): World {
  const background = new Color().copy(HORIZON);
  scene.background = background;
  const fog = new Fog(HORIZON, 40, 220);
  scene.fog = fog;
  const sky = new Sky(extent / 2);
  scene.add(sky.group);

  // Environment lighting from the HDRI, never drawn as the background.
  const pmrem = new PMREMGenerator(renderer);
  new HDRLoader().load(ENV_URL, (hdr) => {
    hdr.mapping = EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.environmentIntensity = 0.45;
    hdr.dispose();
    pmrem.dispose();
  });

  const tex = concreteTexture();
  tex.repeat.set(extent / CELL, extent / CELL);
  const floor = new Mesh(
    new PlaneGeometry(extent, extent),
    new MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = "floor";
  scene.add(floor);

  const hemi = new HemisphereLight(0xffffff, 0xb8b2a6, 0.25);
  scene.add(hemi);

  const sun = new DirectionalLight(0xfff4e6, 1.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -30;
  cam.right = cam.top = 30;
  cam.near = 1;
  cam.far = 120;
  const target = new Object3D();
  scene.add(sun, target);
  sun.target = target;
  const offset = new Vector3(20, 40, 10);
  const sunColour = new Color(0xfff4e6);
  const dawnColour = new Color(0xffc48a);

  return {
    floor,
    sky,
    setSky(state) {
      sky.set(state, renderer.getPixelRatio());
      fog.color.copy(sky.horizonNow);
      background.copy(sky.horizonNow);
      // Lights go down with the sky, never out: the floor must stay walkable.
      const keep = 1 - 0.82 * state.dim;
      hemi.intensity = 0.25 * keep;
      sun.intensity = 1.1 * keep;
      scene.environmentIntensity = 0.45 * keep;
      // At a sunrise the museum's light comes from the sun's side and is warm.
      sun.color.copy(sunColour).lerp(dawnColour, state.dawn);
      if (state.sun && state.sun.altitude > 0 && state.dawn > 0.5) {
        offset.copy(sky.sunDirection).multiplyScalar(45).setY(Math.max(12, sky.sunDirection.y * 45));
      } else {
        offset.set(20, 40, 10);
      }
    },
    follow(viewer) {
      target.position.set(viewer.x, 0, viewer.z);
      sun.position.copy(target.position).add(offset);
      // The lane grows with every work added, so the floor and sky are not
      // sized to it: they keep up with the visitor. The floor shifts a whole
      // tile at a time, which the repeating texture cannot show.
      floor.position.set(Math.round(viewer.x / CELL) * CELL, 0, Math.round(viewer.z / CELL) * CELL);
      sky.group.position.set(viewer.x, 0, viewer.z);
    },
  };
}
