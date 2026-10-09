import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import type { Collection } from "./data/types";
import collectionJson from "./data/collection.json";
import { computeLayout } from "./layout/layout";
import { buildWorld } from "./world/floor";
import { Exhibit } from "./world/exhibit";
import { buildAxisCues } from "./world/axes";
import { Player } from "./locomotion/player";
import { clearPlace, restorePlace, trackPlace } from "./locomotion/resume";
import { Navigator } from "./locomotion/navigate";
import { buildWelcomeSign } from "./world/sign";
import { footprintOf } from "./data/types";

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
scene.add(buildAxisCues(layout));

// Hops between eras and cells, and jumps to a work.
const nav = new Navigator(
  layout,
  exhibits.map((e) => ({ id: e.artwork.id, x: e.group.position.x, z: e.group.position.z, footprint: footprintOf(e.artwork) })),
);
player.setActionHandler((a) => {
  if (a === "eraNext") nav.hopEra(player, 1);
  else if (a === "eraPrev") nav.hopEra(player, -1);
  else if (a === "east") nav.hopGeo(player, 1);
  else nav.hopGeo(player, -1);
});

// Where to start, in order of precedence:
//   ?spawn=x,z,yawDegrees   anywhere, for debugging
//   ?spawn=start            the entrance, forgetting the saved place
//   ?at=<id> | <year> | newest   in front of that work
//   the saved place from last time, else the entrance.
const landmarks = exhibits.map((e) => ({ id: e.artwork.id, x: e.group.position.x, z: e.group.position.z }));
const first = exhibits[0];
const params = new URLSearchParams(location.search);
const spawnParam = params.get("spawn");
const atParam = params.get("at");
if (spawnParam === "start") clearPlace();
if (spawnParam && spawnParam !== "start") {
  const [x = 0, z = 0, yawDeg = 0] = spawnParam.split(",").map(Number);
  player.spawn(x, z, (yawDeg * Math.PI) / 180);
} else if (atParam && nav.goTo(player, resolveAt(atParam))) {
  // placed in front of the requested work
} else if (!restorePlace(player, landmarks) && first) {
  nav.goTo(player, first.artwork.id);
}
const savePlace = trackPlace(player, landmarks);

// The entrance sign stands ahead and to the left of where a new visitor
// arrives, turned toward them, like the panel at a gallery door.
const entrance = first ? nav.standingPoint(first.artwork.id) : null;
if (entrance) {
  const sign = buildWelcomeSign();
  sign.position.set(entrance.x - 2.0, 0.9, entrance.z - 3.6);
  sign.rotation.y = 0.4;
  scene.add(sign);
}

/** "newest" is the most recently added work; a number is the nearest year; anything else is an id. */
function resolveAt(at: string): string {
  if (at === "newest") {
    return visible.reduce((best, a) => (a.createdAt >= best.createdAt ? a : best)).id;
  }
  const year = Number(at);
  if (Number.isFinite(year) && at.trim() !== "") {
    return visible.reduce((best, a) => (Math.abs(a.date.year - year) < Math.abs(best.date.year - year) ? a : best)).id;
  }
  return at;
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
  savePlace(dt);
  player.viewerPosition(eye);
  world.follow(eye);
  for (const e of exhibits) e.update(eye);
  renderer.render(scene, camera);
});
