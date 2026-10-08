/**
 * The ground, the sky and the light. There are no walls: the museum is one
 * open plane under a skylit gallery sky.
 *
 *  Floor:  polished concrete drawn procedurally, one tile per layout cell
 *          (16 m), with hairline joints every 4 m and a firmer line on the
 *          cell boundary so the time and geography grid shows quietly.
 *  Sky:    a gradient dome, warm pale horizon to a cooler zenith, with the
 *          fog matched to the horizon so distance fades cleanly.
 *  Light:  an overcast HDRI as the environment map (never drawn) so PBR
 *          materials have something to reflect, plus a soft directional
 *          light that casts shadows for models and follows the visitor.
 */
import {
  BackSide,
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
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

export const HORIZON = new Color(0xece9e2);
export const ZENITH = new Color(0xc7cfd8);
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

function skyDome(radius: number): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { horizon: { value: HORIZON }, zenith: { value: ZENITH } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDir;
      void main() {
        float t = smoothstep(0.0, 0.6, max(vDir.y, 0.0));
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new Mesh(new SphereGeometry(radius, 48, 24), material);
  dome.name = "sky";
  dome.frustumCulled = false;
  return dome;
}

export interface World {
  floor: Mesh;
  /** Call each frame so the shadow-casting light stays centred on the visitor. */
  follow(viewer: Vector3): void;
}

export function buildWorld(scene: Scene, renderer: WebGLRenderer, extent = 2000): World {
  scene.background = HORIZON;
  scene.fog = new Fog(HORIZON, 40, 220);
  scene.add(skyDome(extent / 2));

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

  scene.add(new HemisphereLight(0xffffff, 0xb8b2a6, 0.25));

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

  return {
    floor,
    follow(viewer) {
      target.position.set(viewer.x, 0, viewer.z);
      sun.position.copy(target.position).add(offset);
    },
  };
}
