/**
 * A black hole with its accretion disc, computed as Luminet did in 1979
 * on an IBM 7040, when he made the first picture of what one would look
 * like: rays of light traced backward from the eye through the bent space
 * of Schwarzschild's solution, so the far side of the disc is lifted into
 * view over the top and under the bottom of the hole, and a thin ring of
 * light rims the shadow. The disc glows hotter inward and the side
 * coming toward you is brighter, as his was.
 *
 * It is drawn on a square held up facing the visitor, like a window: for
 * each point of the window a ray is fired from the eye and bent step by
 * step around the mass placed at the window's centre, so walking round
 * it works, and the shadow is where rays end on the horizon. Stars behind
 * are a made-up field; the museum does not show through, which is the one
 * dishonesty.
 *
 * Params: radius (Schwarzschild radius in metres, default 0.22), steps
 * (ray steps, default 110; fewer on a phone), discOuter (in radii, 8).
 */
import { DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { num, type Program } from "./index";

const VERT = `
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAG = `
  precision highp float;
  uniform vec3 eye;
  uniform vec3 hole;
  uniform float rs;
  uniform float discOuter;
  uniform float time;
  uniform int steps;
  varying vec3 vWorld;
  varying vec2 vUv;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(vec3(i, 0.0)), b = hash(vec3(i + vec2(1.0, 0.0), 0.0)), c = hash(vec3(i + vec2(0.0, 1.0), 0.0)), d = hash(vec3(i + vec2(1.0, 1.0), 0.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // The disc: hot and bright inside, cooler and fainter out, with streaks turning with the flow.
  vec3 discColour(vec3 p, vec3 dir) {
    float r = length(p.xz) / rs;
    float ang = atan(p.z, p.x);
    float t = (r - 3.0) / (discOuter - 3.0);
    float speed = 1.6 / sqrt(r);
    float streak = noise(vec2(r * 2.2, ang * 3.0 - time * speed * 0.6)) * 0.6 + noise(vec2(r * 9.0, ang * 7.0 - time * speed * 1.3)) * 0.4;
    // Doppler: the side of the disc coming toward the eye is brighter and bluer.
    vec3 vel = normalize(vec3(-sin(ang), 0.0, cos(ang)));
    float dop = 1.0 + 0.55 * dot(vel, -dir);
    float heat = pow(1.0 - t, 1.3);
    vec3 cool = vec3(0.85, 0.35, 0.12), hot = vec3(1.0, 0.92, 0.78);
    vec3 c = mix(cool, hot, heat) * (0.35 + 1.3 * heat) * (0.55 + 0.9 * streak) * dop;
    return c;
  }

  void main() {
    vec3 o = eye - hole;
    vec3 d = normalize(vWorld - eye);
    vec3 p = o;
    vec3 v = d;
    vec3 h = cross(p, v);
    float h2 = dot(h, h);
    vec3 colour = vec3(0.0);
    float alpha = 0.0;
    float transmit = 1.0;
    bool captured = false;
    float farR = discOuter * rs * 2.8;
    for (int i = 0; i < 400; i++) {
      if (i >= steps) break;
      float r = length(p);
      if (r < rs) { captured = true; break; }
      if (r > farR && dot(p, v) > 0.0) break;
      // Step size: fine near the hole, coarse far out.
      float ds = clamp(r * 0.12, rs * 0.06, rs * 1.5);
      // Null geodesic in Schwarzschild, as a bending force: a = -1.5 rs h^2 r / |r|^5.
      vec3 a = -1.5 * rs * h2 * p / pow(r, 5.0);
      vec3 pn = p + v * ds + 0.5 * a * ds * ds;
      vec3 vn = normalize(v + a * ds);
      // Crossing the disc plane between the inner and outer edges.
      if (p.y * pn.y < 0.0) {
        float f = p.y / (p.y - pn.y);
        vec3 x = mix(p, pn, f);
        float rr = length(x.xz) / rs;
        if (rr > 3.0 && rr < discOuter) {
          float edge = smoothstep(3.0, 3.6, rr) * (1.0 - smoothstep(discOuter - 2.0, discOuter, rr));
          vec3 c = discColour(x, vn) * edge;
          float a0 = edge * 0.9;
          colour += transmit * c * a0;
          alpha += transmit * a0;
          transmit *= (1.0 - a0 * 0.85);
        }
      }
      p = pn; v = vn;
    }
    if (!captured) {
      // A field of distant stars, bent with the ray; faint, so the ring shows.
      vec3 sd = normalize(v);
      float s = pow(hash(floor(sd * 420.0)), 60.0) * 2.5;
      colour += transmit * vec3(0.9, 0.95, 1.0) * s;
      alpha += transmit * s * 0.9;
    } else {
      alpha = 1.0;
    }
    // The window has no edge: everything fades out toward it.
    float vig = 1.0 - smoothstep(0.3, 0.5, length(vUv - 0.5));
    gl_FragColor = vec4(colour * vig, clamp(alpha, 0.0, 1.0) * vig);
    #include <colorspace_fragment>
  }`;

export const blackhole: Program = (params, bounds) => {
  const rs = num(params, "radius", 0.22);
  const steps = Math.round(num(params, "steps", 110));
  const discOuter = num(params, "discOuter", 8);
  // The window is as wide as the bounds say and square; the hole sits at the bounds' mid-height, so eye level.
  const size = bounds.width;
  const material = new ShaderMaterial({
    uniforms: { eye: { value: new Vector3() }, hole: { value: new Vector3() }, rs: { value: rs }, discOuter: { value: discOuter }, time: { value: 0 }, steps: { value: steps } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const quad = new Mesh(new PlaneGeometry(size, size), material);
  quad.position.y = bounds.height / 2;
  quad.frustumCulled = false;
  const group = new Group();
  group.add(quad);
  const eye = new Vector3();
  let t = 0;
  return {
    object: group,
    update(dt, distance) {
      if (distance > 50) return;
      t += dt;
      material.uniforms.time!.value = t;
      // The window faces the eye; the hole sits at the window's centre.
      quad.getWorldPosition(material.uniforms.hole!.value as Vector3);
      material.uniforms.eye!.value = eye;
    },
    dispose() {
      quad.geometry.dispose();
      material.dispose();
    },
    residentBytes: 0,
    setEye(p: Vector3) {
      eye.copy(p);
      quad.lookAt(p);
    },
  };
};
