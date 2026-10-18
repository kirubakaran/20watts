import { ACESFilmicToneMapping, AudioListener, type Mesh, PCFShadowMap, PerspectiveCamera, Plane, Raycaster, Scene, Timer, Vector2, Vector3, WebGLRenderer } from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import type { Collection } from "./data/types";
import collectionJson from "./data/collection.json";
import { computeLayout, DEFAULT_LAYOUT, WORLD_LAYOUT } from "./layout/layout";
import { buildWorld } from "./world/floor";
import { DEFAULT_STREAM, Streamer } from "./world/stream";
import { Exhibit } from "./world/exhibit";
import { buildAxisCues, cullAxisCues, setAxesNight } from "./world/axes";
import { Player, type Action } from "./locomotion/player";
import { clearPlace, restorePlace, trackPlace } from "./locomotion/resume";
import { Navigator } from "./locomotion/navigate";
import { Grabber } from "./locomotion/grab";
import { Card } from "./world/card";
import { buildEntrance, GATE_HALF_WIDTH, GATE_HEIGHT } from "./world/sign";
import { hasTouch, setupTouch } from "./locomotion/touch";
import { Coach } from "./locomotion/coach";
import { grabbable } from "./data/types";
import { Tour } from "./world/tour";
import { audible, onAudible, resumeAudio, setAudioListener } from "./assets/sound";
import { resolveAt } from "./data/find";
import { baseHeightOf, footprintOf, onDisplay } from "./data/types";
import { Sky, type SkyState } from "./world/sky";

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
// Works shown from inside only are cut off at the ankle from the lane; the cut is a clipping plane on their materials.
renderer.localClippingEnabled = true;
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
// Recordings play from where works stand; the listener rides on the camera.
const listener = new AudioListener();
camera.add(listener);
setAudioListener(listener, renderer.xr);
// Until the first gesture, browsers hold the sound back; a button says so, and is the gesture.
{
  const soundButton = document.getElementById("sound") as HTMLButtonElement | null;
  const show = () => soundButton && (soundButton.hidden = audible() || renderer.xr.isPresenting);
  onAudible(show);
  renderer.xr.addEventListener("sessionstart", show);
  renderer.xr.addEventListener("sessionend", show);
  // A moment after load, so a visitor who clicks straight in never sees it.
  setTimeout(show, 1500);
  soundButton?.addEventListener("click", () => { resumeAudio(); soundButton.blur(); });
}

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
// Landmarks are meant to be seen from afar, so they are built once, here, and never torn down.
const budgetMB = Number(params.get("budgetMB"));
const streamer = new Streamer(scene, visible.filter((a) => !a.landmark), layout, gpu, budgetMB > 0 ? { ...DEFAULT_STREAM, budgetBytes: budgetMB * 1048576 } : DEFAULT_STREAM);
const landmarks = visible.filter((a) => a.landmark).map((a) => {
  const e = new Exhibit(a, layout.placements.get(a.id)!, gpu);
  scene.add(e.group);
  return e;
});
const axisCues = buildAxisCues(layout, layoutCfg);
scene.add(axisCues);

// Hops between eras and cells, and jumps to a work.
const stops = visible.map((a) => {
  const p = layout.placements.get(a.id)!.position;
  return { id: a.id, x: p.x, z: p.z, footprint: footprintOf(a), overhead: baseHeightOf(a) > 2, threshold: a.display.threshold, landmark: !!a.landmark, lift: baseHeightOf(a) };
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

const tour = new Tour(visible, (id) => nav.goTo(player, id), document.getElementById("tour"));
// What the visitor has learned to do, kept between visits; hints show until each control has been used once.
const coach = new Coach();
coach.reflect(document.body);
const act = (a: Action) => {
  if (renderer.xr.isPresenting) {
    if (a === "read") coach.learn("vr.read");
    if (a === "eraNext" || a === "eraPrev") coach.learn("vr.hop");
  }
  if (a === "read") { if (focus) card.toggle(focus.artwork, camera); else card.hide(); }
  else if (a === "tourNext") tour.step(1);
  else if (a === "tourPrev") tour.step(-1);
  else if (a === "eraNext") nav.hopEra(player, 1);
  else if (a === "eraPrev") nav.hopEra(player, -1);
  else if (a === "east") nav.hopGeo(player, 1);
  else if (a === "west") nav.hopGeo(player, -1);
  else if (a === "start") goToEntrance();
  else nav.goLast(player);
};
player.setActionHandler(act);
/**
 * A tap on the screen: on a work, read about it; on the floor, walk there.
 * The floor point is where the tap's ray meets the ground; a work is hit if
 * the point lies within a stride of its footprint.
 */
const tapRay = new Raycaster();
const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const tapNdc = new Vector2();
const tapPoint = new Vector3();
function onTap(x: number, y: number) {
  tapNdc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  tapRay.setFromCamera(tapNdc, camera);
  const hit = tapRay.ray.intersectPlane(floorPlane, tapPoint);
  if (hit) {
    for (const e of [...streamer.exhibitsWithin(hit.x, hit.z, 14), ...landmarks]) {
      const fp = footprintOf(e.artwork);
      if (Math.abs(hit.x - e.worldCentre.x) < fp.width / 2 + 0.8 && Math.abs(hit.z - e.worldCentre.z) < fp.depth / 2 + 0.8) {
        coach.learn("touch.read");
        act("read");
        return;
      }
    }
    // The floor: walk there, but no further than the eye can judge.
    const eyeAt = player.floorPosition();
    const dx = hit.x - eyeAt.x, dz = hit.z - eyeAt.z, dist = Math.hypot(dx, dz);
    const k = Math.min(1, 40 / Math.max(dist, 1e-6));
    if (dist > 0.5) {
      player.walkTo(eyeAt.x + dx * k, eyeAt.z + dz * k);
      coach.learn("touch.walk");
      card.hide();
      return;
    }
  }
  // Looking at the sky, or at one's feet: a tap still reads what is in view.
  if (focus) { coach.learn("touch.read"); act("read"); }
}
if (touch) setupTouch(player, renderer.domElement, act, onTap, coach);
// In VR, small works can be picked up and turned in the hand; the trigger reads.
const grabber = new Grabber(renderer, player, (x, z, r) => streamer.exhibitsWithin(x, z, r), () => act("read"), () => coach.learn("vr.grab"));

/**
 * Focus: the work the visitor is looking at, nearest the centre of their
 * view within a dozen metres. Its name tag comes forward; "read" opens the
 * card for it.
 */
const card = new Card();
scene.add(card.group);
let focus: Exhibit | null = null;
const lookDir = new Vector3();
const toWork = new Vector3();
function updateFocus(eye: Vector3) {
  camera.getWorldDirection(lookDir);
  let best: Exhibit | null = null;
  let bestCost = Infinity;
  // Sideways matters, up and down hardly: a small page below the gaze is still what you are looking at.
  const lookYaw = Math.atan2(lookDir.x, lookDir.z);
  for (const e of [...streamer.exhibitsWithin(eye.x, eye.z, 14), ...landmarks]) {
    toWork.copy(e.worldCentre).sub(eye);
    const d = toWork.length();
    if (d < 0.3 || d > 40) continue;
    let turn = Math.abs(Math.atan2(toWork.x, toWork.z) - lookYaw);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const tilt = Math.abs(Math.atan2(toWork.y, Math.hypot(toWork.x, toWork.z)) - Math.asin(Math.max(-1, Math.min(1, lookDir.y))));
    // Inside a building: it is what you are looking at.
    const inside = e.artwork.display.threshold != null && d < (e.artwork.display.threshold ?? 0);
    if ((turn > 0.5 || tilt > 1.1) && !inside) continue;
    const cost = inside ? 0 : turn + tilt * 0.25 + d * 0.01;
    if (cost < bestCost) (bestCost = cost), (best = e);
  }
  if (best !== focus) {
    focus?.setFocus(false);
    best?.setFocus(true);
    focus = best;
  }
  // In a headset the hints hang under the tag of the work in focus, one lesson at a time.
  if (focus) {
    focus.setHint(!renderer.xr.isPresenting ? null
      : !coach.has("vr.read") ? "pull the trigger to read about this"
      : !coach.has("vr.hop") ? "A or B hops between eras"
      : !coach.has("vr.grab") && grabbable(focus.artwork) ? "squeeze the grip to pick it up"
      : null);
  }
}

// Where to start, in order of precedence:
//   ?spawn=x,z,yawDegrees   anywhere, for debugging
//   ?spawn=start            the entrance, forgetting the saved place
//   ?at=<slug> | <id> | <year> | newest   in front of that work
//   ?tour                   the first stop of the guided visit
//   the saved place from last time, else the entrance.
const spawnParam = params.get("spawn");
const atParam = params.get("at");
if (spawnParam === "start") clearPlace();
if (spawnParam && spawnParam !== "start") {
  // x, z, yaw in degrees (0 faces the future), and pitch in degrees, positive looking up.
  const [x = 0, z = 0, yawDeg = 0, pitchDeg = 0] = spawnParam.split(",").map(Number);
  player.spawn(x, z, (yawDeg * Math.PI) / 180);
  if (pitchDeg) player.look(0, (-pitchDeg * Math.PI) / 180);
} else if (params.has("tour")) {
  tour.start();
} else if (atParam && nav.goTo(player, resolveAt(visible, atParam))) {
  // placed in front of the requested work
} else if (!restorePlace(player, stops) && entrance) {
  goToEntrance();
}
const savePlace = trackPlace(player, stops);
// ?read opens the card for whatever is in front on arrival, for checking renders.
if (params.has("read")) setTimeout(() => act("read"), 2500);

// Idle: after twenty seconds without a touch, draw every third frame, so a
// tab left open does not keep a GPU busy for nothing; the simulations still
// advance. Never in a headset, where every frame matters.
const IDLE_AFTER = 20;
let idleSeconds = 0;
let frameNo = 0;
const wake = () => { idleSeconds = 0; };
for (const ev of ["keydown", "mousemove", "mousedown", "wheel", "touchstart", "pointerdown"]) window.addEventListener(ev, wake, { passive: true });

// ?probe hands the walk script (scripts/dev/walk.mjs) a way to hop the lane
// and read what the museum is holding and how fast it is drawing.
const frameMs: number[] = [];
if (params.has("probe")) {
  (window as unknown as { __20watts: unknown }).__20watts = {
    hop: (dir: 1 | -1) => { wake(); return nav.hopEra(player, dir); },
    goTo: (id: string) => { wake(); return nav.goTo(player, id); },
    ids: () => visible.map((a) => a.id),
    titles: () => visible.map((a) => [a.id, a.title]),
    tour: () => tour.ids,
    models: () => visible.filter((a) => a.asset.kind === "model" && a.asset.versions[0]?.rungs.length).map((a) => ({ id: a.id, title: a.title, url: a.asset.kind === "model" ? a.asset.versions[0]!.rungs.at(-1)!.url : "" })),
    eye: () => eye.toArray(),
    stats: () => {
      const frames = frameMs.splice(0);
      const sorted = [...frames].sort((p, q) => p - q);
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
      return {
        heapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
        residentMB: streamer.residentBytes / 1048576,
        budgetMB: DEFAULT_STREAM.budgetBytes / 1048576,
        live: streamer.liveCount,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        frames: frames.length,
        frameMsAvg: frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : null,
        frameMsP95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null,
        holders: streamer.report(eye, 3),
        // Who is drawing the most: renderable objects per exhibit in range, since each is a draw call or more.
        objects: [...streamer.exhibitsWithin(eye.x, eye.z, 300), ...landmarks]
          .map((e) => { let n = 0; e.group.traverse((o) => { if ((o as Mesh).isMesh || (o as unknown as { isLine?: boolean }).isLine || (o as unknown as { isPoints?: boolean }).isPoints || (o as unknown as { isSprite?: boolean }).isSprite) n += 1; }); return { id: e.artwork.id, n }; })
          .sort((p, q) => q.n - p.n).slice(0, 4),
        labels: axisCues.children.filter((o) => o.visible).length,
      };
    },
  };
}

// ?debug logs what the streamer holds, for checking the budget on a device.
if (params.has("debug")) {
  setInterval(() => {
    console.log(`streamer: ${streamer.liveCount} exhibits, ${(streamer.residentBytes / 1048576).toFixed(0)} MB estimated: ${streamer.report(eye)}`);
  }, 2000);
}

/**
 * The sky near works that change it. Each frame the nearest such work
 * sets how far in we are; a sunrise climbs from below the horizon to
 * eight degrees and back over a minute and a half, a night is still.
 */
const skyWorks = visible
  .filter((a) => a.display.sky)
  .map((a) => ({ hint: a.display.sky!, centre: layout.placements.get(a.id)!.position }));
const SUNRISE_PERIOD = 90;
let skyClock = 30;
const skyState: SkyState = { night: 0, dawn: 0, sun: null, stars: null, moon: null, dim: 0, sunLight: 0 };
function updateSky(eye: Vector3, dt: number) {
  skyClock += dt;
  // Stars and a sunrise are separate channels; each takes its nearest work, nearest relative to its radius.
  type Near = { hint: (typeof skyWorks)[number]["hint"]; w: number; r: number };
  let stars: Near | null = null, sunrise: Near | null = null, standing: Near | null = null;
  for (const s of skyWorks) {
    const d = Math.hypot(s.centre.x - eye.x, s.centre.z - eye.z);
    const w = Sky.weight(s.hint, d);
    if (w <= 0) continue;
    const near = { hint: s.hint, w, r: d / s.hint.radius };
    if (s.hint.stars && (!stars || near.r < stars.r)) stars = near;
    if (s.hint.sunrise && (!sunrise || near.r < sunrise.r)) sunrise = near;
    if (s.hint.sun && (!standing || near.r < standing.r)) standing = near;
  }
  skyState.night = 0;
  skyState.dawn = 0;
  skyState.sun = null;
  skyState.stars = null;
  skyState.moon = null;
  skyState.dim = 0;
  skyState.sunLight = 0;
  if (standing) {
    // A sun that stands still: the light comes from it, the sky barely changes.
    skyState.sun = { ...standing.hint.sun! };
    skyState.sunLight = standing.w;
    skyState.dawn = standing.w * 0.12;
  }
  if (stars) {
    skyState.night = stars.w;
    skyState.stars = stars.hint.stars!;
    skyState.moon = stars.hint.moon ?? null;
    skyState.dim = stars.w;
  }
  if (sunrise) {
    const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * (skyClock % SUNRISE_PERIOD)) / SUNRISE_PERIOD);
    const altitude = -4 + 12 * k;
    skyState.sun = { azimuth: sunrise.hint.sunrise!.azimuth, altitude };
    skyState.dawn = sunrise.w;
    // Darkest before the sun shows, brightening as it climbs.
    const up = Math.min(1, Math.max(0, altitude / 8));
    skyState.night = Math.max(skyState.night, sunrise.w * 0.45 * (1 - up));
    skyState.dim = Math.max(skyState.dim, sunrise.w * (0.55 - 0.4 * up));
    skyState.sunLight = sunrise.w > 0.5 ? sunrise.w : 0;
  }
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
  if (frameMs.length < 4096) frameMs.push(dt * 1000);
  idleSeconds += dt;
  frameNo += 1;
  const skipDraw = !renderer.xr.isPresenting && idleSeconds > IDLE_AFTER && frameNo % 3 !== 0;
  player.update(dt);
  grabber.update(dt);
  savePlace(dt);
  player.viewerPosition(eye);
  world.follow(eye);
  updateSky(eye, dt);
  world.setSky(skyState);
  streamer.update(eye, dt);
  streamer.setNight(skyState.night);
  setAxesNight(axisCues, skyState.night);
  cullAxisCues(axisCues, eye.z);
  updateFocus(eye);
  card.update(dt, camera);
  for (const e of landmarks) {
    e.update(eye, dt);
    e.setNight(skyState.night);
    e.setPlacards(eye.distanceTo(e.worldCentre) < DEFAULT_STREAM.placardRadius + footprintOf(e.artwork).depth / 2);
  }
  if (!skipDraw) renderer.render(scene, camera);
});
