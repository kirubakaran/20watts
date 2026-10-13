# 20watts

[20watts.org](https://20watts.org): a museum of what 20-watt brains have
made, walked through in VR or on a flat screen, in the browser.

One open plane, no walls. Forward is later in time. A side quest stands
to the right of the work it belongs with. Works stand at their true size:
the Alexander Mosaic at 5.8 m, the Pantheon at 43 m with a door you walk
through, the Great Pyramid 600 m off the lane at 146 m, the first iPhone
at 11 cm. You can walk behind a painting and see it mirrored.

About 150 works, from an Acheulean hand axe to AlphaGo's move 37.
Photographs and museum scans, 3D scans from the Smithsonian, NASA,
Sketchfab and the Deutsches Museum, equations typeset as sheets, early
films, recordings that play as you approach, and a dozen things computed
live: the Game of Life, the Mandelbrot set, a Lorenz attractor, a Galton
board, a Turing machine, Bohr's atom, a ray-traced black hole, GW150914.
Near some works the sky changes: the night of 1600 BCE over the Nebra
disc, a solstice sunrise at Stonehenge, noon through the Pantheon's
oculus, a crescent Moon over the Apollo 11 row.

## Run it

```bash
npm install
npm run dev     # https://localhost:5173
npm test
```

Desktop: click to capture the mouse, WASD to walk, Shift to run, `E` for
the card. Quest: open `https://<your LAN IP>:5173` in the headset browser
and press **Enter VR**. Left stick walks, right stick snap-turns, trigger
reads, grip picks up a small work. Phone: drag to look, tap a work to
read it or the floor to walk there.

Hops, since walking the whole lane takes a while:

| Keys | VR | Does |
|---|---|---|
| `[` `]` | A / B | an era back or forward |
| `,` `.` | X / Y | sideways along a row, or into a side quest |
| `Home` `End` | | the entrance, the latest era |
| `T`, `Shift T` | | next and previous stop on the guided visit |

URL parameters: `?at=<work id>`, `?at=<year>` or `?at=newest` opens in
front of a work. `?tour` starts the guided visit. `?spawn=start` forgets
your remembered place; `?spawn=x,z,yawDegrees` puts you anywhere.
`?view=world` spreads each row by longitude. `?debug` logs live exhibits
and bytes held.

## How it works

Every work starts as a stub with its place and size. `src/world/stream.ts`
builds it when you come within 90 m, adds text within 35 m, and tears it
down beyond 130 m, so the lane is an infinite scroll through the eras. A
GPU memory budget (384 MB on a headset or phone, 1.5 GB on desktop) pushes
the farthest exhibits down to their smallest rung when exceeded.

The time axis is ordered, not to scale: works are binned by date, and
only non-empty bins become rows. Two works from the same month stand side
by side. Rows are as wide and as far apart as their works need. Geography
is not an axis, though `madeIn` is kept for the world view.

```
data/items/           one JSON file per work: the source of truth
data/originals/       source files as fetched, never modified (gitignored)
public/assets/<id>/   the served ladder of qualities, built from the originals
src/data/             types, ingest, lint, collection.json
src/layout/           time -> row -> world position
src/world/            floor, sky, exhibits, cards, the gateway, the tour
src/sims/             the programs run live
src/assets/           image and model ladders, sound
src/locomotion/       desktop, VR and phone controls, hops, resume, grab, coach
scripts/              fetch-assets, ingest, lint, deploy
scripts/dev/          screenshot, walk, gallery, where, bounds, preview
test/                 layout, sims, sky, tour
```

## Adding a work

```bash
# write data/items/<id>.json in the shape of src/data/item.ts
npm run ingest                    # items -> collection.json (--diff, --check)
npm run fetch-assets -- <id>      # build the ladder into public/assets/<id>/
npm test                          # lint: titles, descriptions, licences, bounds
npm run where <id>                # where it stands and how to get there
```

Open `?at=<id>` to see it. `npm run gallery` photographs every tour stop
and diffs against the last run; `npm run walk` hops the whole lane in
headless Chrome and fails if memory, draw calls or heap growth go over
budget. Both take minutes, so run them after a batch of additions.

Sources the pipeline fetches itself: Wikimedia Commons images, Smithsonian
3D (`original.url` is the Voyager `document.json`, CC0 only), Zenodo and
any direct glb URL, NASA audio. A Sketchfab model needs a login, so
download the glTF zip by hand into `data/originals/<id>/`, set provenance
`sketchfab`, and mark it `moderation.status: "pending"` until its files
are there. Mark an artist's model `representation: "reconstruction"` so
the card credits the author.

Fields that place or change a work, all under `display` unless noted:

- `branch` (top level): the anchor's id, a `step` and a floor label. The
  work stands beside its anchor instead of in its own row.
- `landmark` (top level): `side` and `distance` in metres. Seen from afar,
  built once, reached by a sideways hop from its row.
- `threshold`: distance from centre to door. Hops and the card go there.
- `reveal`: a walk-in interior shows as a floor plan until you step on it.
  `back: "backing"` plasters the outside; `"mirror"` draws both sides.
- `ring`: `radius`, `gap` and `panel` sizes. Pictures curved round the
  visitor, who stands at the centre. Monet's Orangerie room.
- `sky`: a `radius` and `stars` (year, latitude, sidereal hours), `sunrise`
  (azimuth), or `sun` (azimuth, altitude). `oculus` draws a shaft of light
  where the sun's line meets the model; `moon` hangs the Moon with its real
  phase. Keep the radius short of the next row.
- `hearing`: metres at which a recording starts (18 by default). The
  recording itself goes in `audio` with the source URL, `start`, `seconds`
  and its own credit.
- `grab`, `spin`, `baseHeight`, `yaw`: whether it may be picked up in VR,
  slow rotation in seconds per turn, height override, facing.
- `original.unitScale`, `original.rotation`, `original.materials`,
  `original.omit`: fixes baked into the rungs for a scan that is unitless,
  not upright, lost its look on export, or carries land around a monument.
- `alternates`: a second showing of the same work, with its own credit.
- `tour`: one line about the work. Makes it a stop on the guided visit.
- `copyrighted: true` with a `Fair use` licence: the card says so, and the
  asset must be small. A named reviewer records the decision in
  `moderation`.

Kinds beyond images and models: an equation is an image with provenance
`typeset` and TeX in `original.tex`, set with MathJax under a figure from
`data/figures/`. A moving image (provenance `video-still`) is cut by
ffmpeg from a video in the originals into a still and a silent loop. A
simulation is kind `sim` with a `program` from `src/sims/`, `params` and
`bounds`; date it to the idea, not the code. A point-cloud scan is
thinned rather than simplified and drawn as dots.

Check a model before it goes in: `scripts/dev/bounds.ts` prints size and
texture sizes, `scripts/dev/preview.html?model=/assets/<id>/high.glb`
shows it from four sides.

## Deploy

```bash
npm run deploy            # build, sync data, publish a release
npm run deploy -- --site  # publish only the site
DRY_RUN=1 npm run deploy  # print the remote commands
```

Needs an ssh alias `20watts` (or `DEPLOY_HOST`) and a web server with
HTTPS. The script keeps `data/originals/`, `data/derived/` and the last
five releases under the deploy user's home, and swaps `site/current` in
one rename. `deploy/20watts.nginx.conf` is the nginx mapping.

## License

Code is AGPL-3.0-only. Collection text is CC BY-SA 4.0. Images, models
and recordings carry their own licences, shown on each card and listed in
[CREDITS.md](CREDITS.md). See [NOTICE.md](NOTICE.md).
