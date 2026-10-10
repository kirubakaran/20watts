/**
 * The Mandelbrot set (1980): the complex numbers c for which z → z² + c,
 * started at zero, never escapes. Drawn by the GPU every frame, zooming
 * slowly into a point on the boundary and back out again, because single
 * precision runs out of digits a few thousand times in.
 *
 * Params: centreRe, centreIm (the point zoomed into; default is in the
 * seahorse valley), period (seconds for one zoom in and out, default 120),
 * zoom (how many times smaller the view gets, default 8000).
 */
import { DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from "three";
import { num, type Program } from "./index";

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = `
  precision highp float;
  uniform vec2 centre;
  uniform float scale;
  uniform float aspect;
  varying vec2 vUv;
  const vec3 CREAM = vec3(0.953, 0.933, 0.890);
  const vec3 INK = vec3(0.165, 0.157, 0.141);
  const vec3 RUST = vec3(0.659, 0.314, 0.227);
  const vec3 SLATE = vec3(0.420, 0.470, 0.530);
  const vec3 OCHRE = vec3(0.851, 0.690, 0.400);
  const vec3 DEEP = vec3(0.180, 0.240, 0.340);
  // A palette that cycles with the escape count, so the boundary keeps its
  // contrast however deep the zoom: cream, ochre, rust, ink, deep blue, slate, and round again.
  vec3 palette(float u) {
    u = fract(u);
    float s = u * 6.0;
    if (s < 1.0) return mix(CREAM, OCHRE, s);
    if (s < 2.0) return mix(OCHRE, RUST, s - 1.0);
    if (s < 3.0) return mix(RUST, INK, s - 2.0);
    if (s < 4.0) return mix(INK, DEEP, s - 3.0);
    if (s < 5.0) return mix(DEEP, SLATE, s - 4.0);
    return mix(SLATE, CREAM, s - 5.0);
  }
  void main() {
    vec2 c = centre + (vUv - 0.5) * vec2(scale * aspect, scale);
    vec2 z = vec2(0.0);
    float n = 0.0;
    const float LIMIT = 400.0;
    for (float i = 0.0; i < LIMIT; i++) {
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      if (dot(z, z) > 256.0) break;
      n += 1.0;
    }
    vec3 colour = INK;
    if (n < LIMIT) {
      // Smooth escape count; the palette turns once every forty iterations,
      // slowed near the outside so the open plane stays cream.
      float nu = n + 1.0 - log2(log2(dot(z, z)) * 0.5);
      colour = palette(sqrt(nu) * 0.16);
    }
    // The constants are sRGB; the renderer expects linear and converts on output.
    gl_FragColor = vec4(pow(colour, vec3(2.2)), 1.0);
    #include <colorspace_fragment>
  }`;

export const mandelbrot: Program = (params, bounds) => {
  const centre = new Vector2(num(params, "centreRe", -0.743643887037151), num(params, "centreIm", 0.13182590420533));
  const period = num(params, "period", 120);
  const zoom = num(params, "zoom", 8000);
  const w = bounds.width, h = bounds.height;
  const material = new ShaderMaterial({
    uniforms: { centre: { value: centre }, scale: { value: 3 }, aspect: { value: w / h } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: DoubleSide,
  });
  const mesh = new Mesh(new PlaneGeometry(w, h), material);
  mesh.position.y = h / 2;
  const group = new Group();
  group.add(mesh);
  let t = 0;
  return {
    object: group,
    update(dt) {
      t = (t + dt) % period;
      // A cosine ease in and out between the whole set and the deepest view.
      const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
      material.uniforms.scale!.value = 3 * Math.pow(1 / zoom, k);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
    residentBytes: 0,
  };
};
