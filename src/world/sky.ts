/**
 * The sky, and how it changes near certain works. By day it is the
 * gallery's gradient, warm at the horizon, cool at the zenith. Near a work
 * with a sky hint it becomes the sky that work was made under: a night of
 * stars from the bright star catalogue, placed as they stood over that
 * latitude in that year, or a sunrise on the bearing a monument was built
 * to face, climbing a little and sinking again on a loop. Fully in effect
 * within the hint's radius, gone again a fifth further out.
 *
 * North is the way the lane runs, toward the future (-Z); east is +X.
 *
 * Stars: catalogue positions are J2000. They are carried to the year by
 * rotating along the ecliptic by the precession rate, 50.29" a year, and
 * taking the obliquity of that date. Over four thousand years that is
 * fifty degrees, which moves the Pleiades from Taurus to the equinox;
 * what it ignores, the slow wander of the ecliptic itself, is under a
 * degree. Then the local sky for the latitude and sidereal time, the
 * usual way. Nothing here is precise to the eye's width; it is the right
 * sky, not a planetarium.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { SkyHint } from "../data/types";

export const HORIZON = new Color(0xece9e2);
export const ZENITH = new Color(0xc7cfd8);
const NIGHT_HORIZON = new Color(0x1a2130);
const NIGHT_ZENITH = new Color(0x05070d);
const DAWN_HORIZON = new Color(0xf2b46a);
const DAWN_ZENITH = new Color(0x6d86a8);
const STARS_URL = "/sky/stars.json";

interface Catalogue {
  stars: [number, number, number, number | null][];
}

/** What the sky is doing this frame. */
export interface SkyState {
  /** 0 day, 1 full night. */
  night: number;
  /** 0 none, 1 full sunrise colouring. */
  dawn: number;
  /** Degrees clockwise from north, and above the horizon (negative: below). */
  sun: { azimuth: number; altitude: number } | null;
  /** Which stars, or null for none. Positions are recomputed when this changes. */
  stars: { year: number; latitude: number; siderealHours: number } | null;
  /** How much to dim the museum's lights, 0 none, 1 fully. */
  dim: number;
}

const DEG = Math.PI / 180;

/** Catalogue J2000 right ascension and declination to a unit vector in the local sky: x east, y up, z south (so -z north). */
function localDirection(raDeg: number, decDeg: number, year: number, latitude: number, siderealHours: number, out: Vector3): Vector3 {
  // Equatorial J2000 to ecliptic.
  const eps0 = 23.4393 * DEG;
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
  const ex = x, ey = y * Math.cos(eps0) + z * Math.sin(eps0), ez = -y * Math.sin(eps0) + z * Math.cos(eps0);
  // Precession along the ecliptic, and the obliquity of the date.
  const t = (year - 2000) / 100;
  const dLon = (5029.1 / 3600) * DEG * t;
  const lon = Math.atan2(ey, ex) + dLon, lat = Math.asin(ez);
  const eps = (23.4393 - 0.013 * t) * DEG;
  const px = Math.cos(lat) * Math.cos(lon), py = Math.cos(lat) * Math.sin(lon), pz = Math.sin(lat);
  // Ecliptic of date back to equatorial of date.
  const qx = px, qy = py * Math.cos(eps) - pz * Math.sin(eps), qz = py * Math.sin(eps) + pz * Math.cos(eps);
  const ra2 = Math.atan2(qy, qx), dec2 = Math.asin(qz);
  // Hour angle to altitude and azimuth.
  const H = siderealHours * 15 * DEG - ra2;
  const phi = latitude * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(dec2) + Math.cos(phi) * Math.cos(dec2) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(-Math.cos(dec2) * Math.sin(H), Math.sin(dec2) * Math.cos(phi) - Math.cos(dec2) * Math.sin(phi) * Math.cos(H));
  return out.set(Math.sin(az) * Math.cos(alt), sinAlt, -Math.cos(az) * Math.cos(alt));
}

function starSprite(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.8)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** A star's tint from its colour index: blue-white for negative, orange past 1.5. */
function tint(bv: number | null, out: Color): Color {
  const t = Math.min(1, Math.max(0, ((bv ?? 0.6) + 0.3) / 2));
  return out.setRGB(0.75 + 0.25 * t, 0.85 + 0.1 * (1 - Math.abs(t - 0.4)), 1 - 0.45 * t);
}

export class Sky {
  readonly group = new Group();
  private readonly dome: Mesh;
  private readonly domeMaterial: ShaderMaterial;
  private readonly stars: Points;
  private readonly starMaterial: ShaderMaterial;
  private catalogue: Catalogue | null = null;
  private starsKey = "";
  private readonly radius: number;
  readonly sunDirection = new Vector3(0, -1, 0);
  readonly state: SkyState = { night: 0, dawn: 0, sun: null, stars: null, dim: 0 };
  /** The horizon colour right now, for the fog and the background. */
  readonly horizonNow = new Color().copy(HORIZON);

  constructor(radius: number) {
    this.radius = radius;
    this.domeMaterial = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        horizon: { value: new Color().copy(HORIZON) },
        zenith: { value: new Color().copy(ZENITH) },
        sunDir: { value: new Vector3(0, -1, 0) },
        dawn: { value: 0 },
        night: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 horizon;
        uniform vec3 zenith;
        uniform vec3 sunDir;
        uniform float dawn;
        uniform float night;
        varying vec3 vDir;
        void main() {
          float t = smoothstep(0.0, 0.6, max(vDir.y, 0.0));
          vec3 c = mix(horizon, zenith, t);
          // A warm glow around the sun, strongest at the horizon, and the disc itself.
          float toSun = max(dot(vDir, sunDir), 0.0);
          float glow = pow(toSun, 6.0) * (1.0 - t) * 0.55 + pow(toSun, 60.0) * 0.35;
          c += vec3(1.0, 0.72, 0.42) * glow * dawn;
          float disc = smoothstep(0.99975, 0.99990, toSun) * step(0.0, sunDir.y + 0.01);
          c = mix(c, vec3(1.0, 0.96, 0.85), disc * dawn);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new Mesh(new SphereGeometry(radius, 48, 24), this.domeMaterial);
    this.dome.name = "sky";
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    this.starMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { sprite: { value: starSprite() }, night: { value: 0 }, pixelScale: { value: 1 } },
      vertexShader: `
        attribute float size;
        attribute vec3 tint;
        uniform float pixelScale;
        varying vec3 vTint;
        varying float vFade;
        void main() {
          vTint = tint;
          // Stars dim and shrink toward the horizon, as the air takes them.
          vFade = smoothstep(-0.02, 0.12, normalize(position).y);
          gl_PointSize = size * pixelScale;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D sprite;
        uniform float night;
        varying vec3 vTint;
        varying float vFade;
        void main() {
          float a = texture2D(sprite, gl_PointCoord).a;
          gl_FragColor = vec4(vTint * a * night * vFade, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.stars = new Points(new BufferGeometry(), this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);
  }

  /** The star catalogue is fetched once, the first time stars are wanted. */
  private async loadCatalogue(): Promise<Catalogue | null> {
    if (this.catalogue) return this.catalogue;
    try {
      const res = await fetch(STARS_URL);
      this.catalogue = (await res.json()) as Catalogue;
    } catch (e) {
      console.warn("stars:", e);
      return null;
    }
    return this.catalogue;
  }

  private async placeStars(cfg: NonNullable<SkyState["stars"]>) {
    const key = `${cfg.year}/${cfg.latitude}/${cfg.siderealHours}`;
    if (key === this.starsKey) return;
    this.starsKey = key;
    const cat = await this.loadCatalogue();
    if (!cat || key !== this.starsKey) return;
    const n = cat.stars.length;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), tints = new Float32Array(n * 3);
    const v = new Vector3(), c = new Color();
    const r = this.radius * 0.96;
    cat.stars.forEach(([ra, dec, mag, bv], i) => {
      localDirection(ra, dec, cfg.year, cfg.latitude, cfg.siderealHours, v).multiplyScalar(r).toArray(pos, i * 3);
      // Brightness as apparent size: first magnitude about 9 px, the faintest 2.
      size[i] = Math.max(1.6, 9 * Math.pow(10, -0.16 * (mag + 1.2)));
      tint(bv, c).toArray(tints, i * 3);
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("size", new BufferAttribute(size, 1));
    g.setAttribute("tint", new BufferAttribute(tints, 3));
    this.stars.geometry.dispose();
    this.stars.geometry = g;
  }

  /** Apply a state; call every frame. `pixelRatio` keeps star sizes honest on dense screens. */
  set(state: SkyState, pixelRatio: number) {
    Object.assign(this.state, state);
    const { night, dawn, sun, stars } = state;
    const u = this.domeMaterial.uniforms;
    // Day to night, with the dawn colours laid over near the sun's side.
    const horizon = (u.horizon!.value as Color).copy(HORIZON).lerp(NIGHT_HORIZON, night).lerp(DAWN_HORIZON, dawn * 0.85);
    (u.zenith!.value as Color).copy(ZENITH).lerp(NIGHT_ZENITH, night).lerp(DAWN_ZENITH, dawn * 0.8);
    this.horizonNow.copy(horizon);
    u.dawn!.value = dawn;
    u.night!.value = night;
    if (sun) {
      const az = sun.azimuth * DEG, alt = sun.altitude * DEG;
      this.sunDirection.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    } else {
      this.sunDirection.set(0, -1, 0);
    }
    (u.sunDir!.value as Vector3).copy(this.sunDirection);

    this.starMaterial.uniforms.night!.value = night;
    this.starMaterial.uniforms.pixelScale!.value = pixelRatio;
    this.stars.visible = night > 0.01 && stars != null;
    if (stars) void this.placeStars(stars);
  }

  /** The sky's effect at a distance from a work with this hint: 1 within the radius, 0 a fifth further out. */
  static weight(hint: SkyHint, distance: number): number {
    const r0 = hint.radius, r1 = hint.radius * 1.2;
    if (distance <= r0) return 1;
    if (distance >= r1) return 0;
    const t = (distance - r0) / (r1 - r0);
    return 1 - t * t * (3 - 2 * t);
  }
}
