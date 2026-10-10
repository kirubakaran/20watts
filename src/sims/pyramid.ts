/**
 * A pyramid built from its published figures: a square base and a height,
 * in metres, with the stone courses drawn as lines. There is no scan of
 * the Great Pyramid anyone may download, and a plain shape at true size
 * is the point of it anyway: 146 m of stone, seen from a distance and
 * then from the foot.
 *
 * Params: base (side of the square, default 230.3), height (default
 * 146.6, as built; it stands 138.5 today), courses (default 210).
 */
import { CanvasTexture, ConeGeometry, Group, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from "three";
import { num, type Program } from "./index";

function coursesTexture(courses: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 2048;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#c9b48a";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "rgba(90,70,40,0.35)";
  for (let i = 0; i < courses; i++) {
    const y = Math.round((i / courses) * c.height);
    ctx.fillRect(0, y, c.width, 1);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export const pyramid: Program = (params) => {
  const base = num(params, "base", 230.3);
  const height = num(params, "height", 146.6);
  const courses = Math.round(num(params, "courses", 210));
  // A four-sided cone is a square pyramid; its radius is half the base's diagonal.
  const geometry = new ConeGeometry((base / 2) * Math.SQRT2, height, 4, 1, false);
  const material = new MeshStandardMaterial({ map: coursesTexture(courses), roughness: 0.95, flatShading: true });
  // The scene's fog ends a couple of hundred metres out, which would swallow a
  // thing meant to be seen from afar; it gets a longer haze of its own instead.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hazeFar = { value: 1600 };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <fog_pars_fragment>", "#include <fog_pars_fragment>\nuniform float hazeFar;")
      .replace("#include <fog_fragment>", `
        #ifdef USE_FOG
          float hazeFactor = smoothstep(150.0, hazeFar, vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, hazeFactor * 0.92);
        #endif`);
  };
  const mesh = new Mesh(geometry, material);
  mesh.position.y = height / 2;
  mesh.rotation.y = Math.PI / 4;
  mesh.receiveShadow = true;
  const group = new Group();
  group.add(mesh);
  return {
    object: group,
    update() {},
    dispose() {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
    residentBytes: 8 * 2048 * 4,
  };
};
