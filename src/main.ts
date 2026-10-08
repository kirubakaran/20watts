import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import type { Collection } from "./data/types";
import collectionJson from "./data/collection.json";
import { computeLayout } from "./layout/layout";
import { buildWorld } from "./world/floor";
import { Exhibit } from "./world/exhibit";
import { Player } from "./locomotion/player";

// JSON import types are inferred per record; the schema is the source of truth.
const collection = collectionJson as unknown as Collection;

const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
// Filmic tone mapping for the 3D materials; image planes opt out so paintings stay faithful.
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new Scene();
const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1200);
const player = new Player(renderer, camera, renderer.domElement);
scene.add(player.rig);

const world = buildWorld(scene, renderer);

const gpu = {
  maxTextureSize: renderer.capabilities.maxTextureSize,
  maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
};

const visible = collection.artworks.filter((a) => a.moderation.status === "approved");
const layout = computeLayout(visible);
const exhibits = visible.map((a) => new Exhibit(a, layout.placements.get(a.id)!, gpu));
for (const e of exhibits) scene.add(e.group);

// Spawn in front of the first work, far enough back to take it in.
// Debug override: ?spawn=x,z,yawDegrees
const first = exhibits[0];
const spawnParam = new URLSearchParams(location.search).get("spawn");
if (spawnParam) {
  const [x = 0, z = 0, yawDeg = 0] = spawnParam.split(",").map(Number);
  player.spawn(x, z, (yawDeg * Math.PI) / 180);
} else if (first) {
  const p = first.group.position;
  const w = Math.max(4, first.artwork.physical.widthCm ? first.artwork.physical.widthCm / 100 : 2);
  player.spawn(p.x, p.z + w * 1.2, 0);
}

const hud = document.getElementById("hud");
renderer.xr.addEventListener("sessionstart", () => hud && (hud.hidden = true));
renderer.xr.addEventListener("sessionend", () => hud && (hud.hidden = false));

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new Timer();
const eye = new Vector3();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  player.update(dt);
  player.viewerPosition(eye);
  world.follow(eye);
  for (const e of exhibits) e.update(eye);
  renderer.render(scene, camera);
});
