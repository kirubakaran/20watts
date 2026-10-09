import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import type { Collection } from "./data/types";
import collectionJson from "./data/collection.json";
import { computeLayout, DEFAULT_LAYOUT, WORLD_LAYOUT } from "./layout/layout";
import { buildWorld } from "./world/floor";
import { DEFAULT_STREAM, Streamer } from "./world/stream";
import { buildAxisCues } from "./world/axes";
import { Player, type Action } from "./locomotion/player";
import { clearPlace, restorePlace, trackPlace } from "./locomotion/resume";
import { Navigator } from "./locomotion/navigate";
import { buildEntrance, GATE_HALF_WIDTH, GATE_HEIGHT } from "./world/sign";
import { hasTouch, setupTouch } from "./locomotion/touch";
import { baseHeightOf, footprintOf, onDisplay } from "./data/types";

// JSON import types are inferred per record; the schema is the source of truth.
const collection = collectionJson as unknown as Collection;

const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
const touch = hasTouch();
// A phone's 3x screen is more pixels than its GPU wants to fill.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, touch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
// Filmic tone mapping for the 3D materials; image planes opt out so paintings stay faithful.
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.appendChild(renderer.domElement);
// The button says "VR not supported" wherever there is no WebXR at all; on a phone that is just clutter.
if ("xr" in navigator) document.body.appendChild(VRButton.createButton(renderer));

const scene = new Scene();
const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1200);
/** A vertical FOV of 70° is a slit on a portrait phone; widen it so a work and its placard fit. */
function fitCamera() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = camera.aspect < 1 ? 90 : 70;
  camera.updateProjectionMatrix();
}
fitCamera();
const player = new Player(renderer, camera, renderer.domElement);
scene.add(player.rig);

const world = buildWorld(scene, renderer);

const gpu = {
  maxTextureSize: renderer.capabilities.maxTextureSize,
  maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
};

const params = new URLSearchParams(location.search);
const visible = onDisplay(collection.artworks);
// One lane in time order, or with ?view=world the same works spread by longitude.
const layoutCfg = params.get("view") === "world" ? WORLD_LAYOUT : DEFAULT_LAYOUT;
const layout = computeLayout(visible, layoutCfg);
// Works exist as stubs until the visitor is near; the streamer builds and tears down exhibits.
const budgetMB = Number(params.get("budgetMB"));
const streamer = new Streamer(scene, visible, layout, gpu, budgetMB > 0 ? { ...DEFAULT_STREAM, budgetBytes: budgetMB * 1048576 } : DEFAULT_STREAM);
scene.add(buildAxisCues(layout, layoutCfg));

// Hops between eras and cells, and jumps to a work.
const stops = visible.map((a) => {
  const p = layout.placements.get(a.id)!.position;
  return { id: a.id, x: p.x, z: p.z, footprint: footprintOf(a), overhead: baseHeightOf(a) > 2, threshold: a.display.threshold };
});
const nav = new Navigator(layout, stops);
// The gateway stands across the spine a few metres before the viewing spot
// of the oldest work; a new visitor arrives outside it, looking through.
const ENTRANCE_SETBACK = 2.5;
const first = visible.find((a) => !a.branch);
const entrance = first ? nav.standingPoint(first.id) : null;
if (entrance) {
  const gate = buildEntrance();
  gate.position.set(entrance.x, 0, entrance.z + ENTRANCE_SETBACK);
  scene.add(gate);
}
/**
 * Far enough outside the gateway to see the whole of it, with sky above
 * the cap: a portrait phone's narrow view needs the width to fit, a
 * landscape phone's short view needs the height to.
 */
function entranceDistance(): number {
  const halfV = (camera.fov * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  const forWidth = (GATE_HALF_WIDTH + 0.4) / Math.tan(halfH);
  const forHeight = (GATE_HEIGHT + 1.2 - player.eyeHeight) / Math.tan(halfV);
  return Math.max(4.5, forWidth, forHeight);
}
const goToEntrance = () => entrance && player.teleport(entrance.x, entrance.z + ENTRANCE_SETBACK + entranceDistance(), 0);

const act = (a: Action) => {
  if (a === "eraNext") nav.hopEra(player, 1);
  else if (a === "eraPrev") nav.hopEra(player, -1);
  else if (a === "east") nav.hopGeo(player, 1);
  else if (a === "west") nav.hopGeo(player, -1);
  else if (a === "start") goToEntrance();
  else nav.goLast(player);
};
player.setActionHandler(act);
if (touch) setupTouch(player, renderer.domElement, act);

// Where to start, in order of precedence:
//   ?spawn=x,z,yawDegrees   anywhere, for debugging
//   ?spawn=start            the entrance, forgetting the saved place
//   ?at=<id> | <year> | newest   in front of that work
//   the saved place from last time, else the entrance.
const landmarks = stops;
const spawnParam = params.get("spawn");
const atParam = params.get("at");
if (spawnParam === "start") clearPlace();
if (spawnParam && spawnParam !== "start") {
  const [x = 0, z = 0, yawDeg = 0] = spawnParam.split(",").map(Number);
  player.spawn(x, z, (yawDeg * Math.PI) / 180);
} else if (atParam && nav.goTo(player, resolveAt(atParam))) {
  // placed in front of the requested work
} else if (!restorePlace(player, landmarks) && entrance) {
  goToEntrance();
}
const savePlace = trackPlace(player, landmarks);

/** "newest" is the most recently added work; a number is the nearest year; anything else is an id. */
function resolveAt(at: string): string {
  if (at === "newest") {
    return visible.reduce((best, a) => (a.createdAt >= best.createdAt ? a : best)).id;
  }
  const year = Number(at);
  if (Number.isFinite(year) && at.trim() !== "") {
    // On the lane: a branch work stands in its anchor's year, not its own.
    const lane = visible.filter((a) => !a.branch);
    return lane.reduce((best, a) => (Math.abs(a.date.year - year) < Math.abs(best.date.year - year) ? a : best)).id;
  }
  return at;
}

// ?debug logs what the streamer holds, for checking the budget on a device.
if (params.has("debug")) {
  setInterval(() => {
    console.log(`streamer: ${streamer.liveCount} exhibits, ${(streamer.residentBytes / 1048576).toFixed(0)} MB estimated: ${streamer.report(eye)}`);
  }, 2000);
}

const hud = document.getElementById("hud");
renderer.xr.addEventListener("sessionstart", () => hud && (hud.hidden = true));
renderer.xr.addEventListener("sessionend", () => hud && (hud.hidden = false));

window.addEventListener("resize", () => {
  fitCamera();
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
  streamer.update(eye, dt);
  renderer.render(scene, camera);
});
