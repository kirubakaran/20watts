# 20watts

[20watts.org](https://20watts.org): everything here was made by a
20-watt brain. A museum you walk through in VR or on a flat screen, in the browser. One open
plane, no walls: forward is later in time, right is further east. Works float
at their true size, and you can walk behind one and see it mirrored.

v1 holds thirty-five works and one placeholder. They run from an Acheulean
hand axe (a CC0 photogrammetry scan, 300,000 years old) and the Lion-man of
Hohlenstein-Stadel through twelve cave and rock paintings from five
continents, the Venus of Willendorf, a Clovis point (another scan), a
proto-cuneiform tablet, the Nebra sky disc, an Exekias amphora, the
Rosetta Stone, the Alexander Mosaic at its real 5.8 m, the Chi Rho page of
the Book of Kells, Fan Kuan's *Travelers Among Mountains and Streams*, a
Benin plaque, Leonardo's *Last Supper* at 8.8 × 4.6 m, the 1903 Wright
Flyer and the Apollo 11 command module *Columbia* as Smithsonian 3D scans, a
1924 Ford Model T, bombe drums, the first transistor, the Apple I, a
Cray-1, a Commodore 64 (a photogrammetry scan), an Apple IIc, and the
rickroll, a frozen frame of Rick Astley at the size of a living-room
television that starts to move when you walk up to it. The first iPhone is
in the catalogue as a CC BY artist's model that must be downloaded from
Sketchfab by hand (see below) and is hidden until then.

## Run it

```bash
npm install
npm run dev
```

The dev server is HTTPS (WebXR requires it). On a desktop browser open
`https://localhost:5173`, click to capture the mouse, WASD to walk, Shift to
run. On a Quest, open `https://<your LAN IP>:5173` in the headset browser,
accept the self-signed certificate once, and press **Enter VR**. Left stick
walks, right stick snap-turns.

Walking the whole museum takes a while, so there are hops: `[` and `]`
jump an era back or forward, `,` and `.` a cell west or east, and in VR the
A / B buttons hop eras and X / Y hop west / east. A hop lands you on the
spine in front of the nearest cell of the next row, facing the future, as
if you had walked there. `?at=<work id>`, `?at=<year>` or `?at=newest`
opens the museum in front of that work, which is handy for checking a new
addition. A stone gateway across the spine, before the oldest work, carries
one line cut into its lintel ("Behold the works of 20-watt brains") and a
plaque on how to read the floor; a new visitor arrives outside it, looking
through.

You resume where you left off: the browser remembers your place, relative
to the nearest work so it survives new works shifting the rows, and a
reload or a new deploy puts you back there. `?spawn=start` forgets it and
starts at the oldest work. `?spawn=x,z,yawDegrees` places you anywhere for
debugging, e.g. `?spawn=0,-11,180` looks at the back of the first work.

To check a render without a headset, `node scripts/dev/screenshot.mjs
<url> out.png` starts a headless Chrome, takes one capture and kills it.
It is bounded on purpose: the museum renders continuously, and a stray
headless Chrome on software GL will peg several cores until it is killed.

## Layout

```
src/data/types.ts        the Artwork record: every attribute we will ever need
src/data/collection.json the collection
src/layout/layout.ts     (time, geography) -> cell -> world position + facing
src/world/floor.ts       ground, sky dome, environment light, shadows
src/world/axes.ts        era and longitude labels stencilled on the floor
src/world/exhibit.ts     one work in the world: image or glTF, placards, shadow
src/assets/textures.ts   image ladder; sharper rungs load as you approach
src/assets/models.ts     glb ladder, same idea for 3D scans
src/locomotion/player.ts desktop and VR movement
src/locomotion/resume.ts remembers your place in the browser and restores it
src/locomotion/navigate.ts hops between eras and cells, and jumps to a work
src/world/sign.ts        the entrance gateway
scripts/fetch-assets.ts  pulls images and models from their sources into public/assets
scripts/dev/screenshot.mjs one bounded headless-Chrome capture, for checking renders
scripts/dev/preview.html four fixed views of one model rung, for checking orientation and scale
public/draco/            Draco mesh decoder, copied from three's examples
public/env/              overcast HDRI used for environment lighting, never drawn
```

### Ground and sky

The floor is polished concrete drawn procedurally: one tile per layout
cell with hairline joints every 4 m and a firmer line on the 16 m cell
boundary, so the time and geography grid shows without labels. The sky is
a gradient dome, warm at the horizon and cooler overhead, with the fog
matched to the horizon. Lighting is a CC0 overcast HDRI from Poly Haven
used only as the environment map, plus a soft directional light that casts
shadows for 3D objects and follows the visitor. Paintings opt out of tone
mapping so their colours stay as scanned.

### Axes

Both axes are ordered, not to scale. Works are binned by decade and by
5° of longitude; only non-empty bins become cells, so empty centuries and
oceans do not exist in the world. Empty cells do not exist either: each
time row holds only the geography cells that have works in it, side by
side from west to east and centred on the spine, so the next era is always
one cell ahead rather than off to one side. In a sparse collection this
means a column is not a fixed longitude; once every row has every column
it is the plain grid. Rows are only as wide as they need to be: cells are
spaced by the row's widest cell plus a gap, between 6 m and the full 16 m
pitch, so two desktop computers stand a few metres apart and both are in
view from the spine, while the Wright Flyer's row keeps the full pitch.
Within a cell, works are packed in a grid, most important first. `computeLayout` returns the tick list for each axis and
the list of occupied cells.

Those feed the axis cues stencilled on the floor (`src/world/axes.ts`):
the era is printed on the boundary line you cross when you step into a
row ("35,000 BCE", "c. 200 BCE", "1490s") and the longitude at the front
edge of each occupied cell ("115°E"). Since neither axis is to scale, a
label is the only honest cue, and nothing is drawn where nothing stands.

### Assets

Everything is served from this host, never hotlinked. `npm run fetch-assets`
reads the collection, fetches each imported asset from its source, and
writes a ladder of qualities to `public/assets/<id>/`, recording the rungs
back into `collection.json`. Each artwork may hold several asset versions
(imports, user uploads) with their own credit and moderation state;
`currentVersionId` picks the one shown.

Every source file lands in `data/originals/<id>/`, the archive of record:
written once, never modified, and the one thing to back up, since the
rungs can always be rebuilt from it. It is gitignored; at release both the
originals and the served rungs move to the server's data directory, with
the originals mirrored to a bucket. The rungs under `public/assets` are a
proof-of-concept convenience so a clone runs without a build step.

The client prepends `VITE_ASSET_BASE` to every rung path, so the same
catalogue works from the dev server, the production host, or a bucket.
See `.env.example`.

- **Images** from Wikimedia Commons: the Commons API is asked for a ladder
  of thumbnail widths, saved as `<width>.jpg`.
- **Moving images** (provenance `video-still`): the source video sits in
  `data/originals/<id>/`. ffmpeg cuts the still at `loop.start` into the
  usual JPEG ladder and encodes a silent 640 px H.264 loop of
  `loop.seconds`. The exhibit shows the still from afar and swaps in the
  loop within 14 m, so it is already moving as you arrive from the previous
  cell. Needs ffmpeg on the PATH.
- **Models from a file** (provenance `zenodo`, `sketchfab` or
  `user-upload`): the source glb or glTF is read from `data/originals/<id>/`.
  For `zenodo`, or any direct glb URL, the pipeline downloads it there
  first; for the others you populate the directory by hand since those
  sources need a login, and until you do the work is skipped with a warning.
  The ladder is built from that one file: textures are resized per tier and
  re-encoded as WebP, the mesh is simplified for the lower tiers, and the
  result gets the same metres, origin and Draco treatment as a Smithsonian
  scan. Photogrammetry exports are often unitless; `original.unitScale`
  (metres per file unit) is baked into the rungs, as is `original.rotation`
  (XYZ Euler degrees) for a scan that is not upright or faces the wrong way.
  Check the result with `/scripts/dev/preview.html?model=/assets/<id>/high.glb`
  on the dev server, which shows front, left, top and back views on a grid.
- **Models** from Smithsonian 3D: the `original.url` is a Voyager
  `document.json`. Each of its quality tiers is a set of Draco glb parts in
  centimetres; the pipeline merges the parts, converts to metres with the
  base at y = 0 and the footprint centred, re-encodes with Draco, and saves
  `thumb.glb`, `low.glb`, `medium.glb`, `high.glb`. The renderer swaps rungs
  by texture size as you approach, exactly as it does for images. The
  Smithsonian CDN omits an intermediate certificate from its TLS chain,
  which Node does not fetch on its own, so the npm script passes the public
  Sectigo intermediate in `scripts/certs/` through `NODE_EXTRA_CA_CERTS`.

### Adding a work

Append a record to `collection.json` following `src/data/types.ts`, run
`npm run fetch-assets`, reload. For a Smithsonian scan, find the object on
[3d.si.edu](https://3d.si.edu), take the Voyager document id from its page,
and use `https://3d-api.si.edu/content/document/<id>/document.json` as the
model version's `original.url` with provenance `smithsonian-3d`. Only CC0
objects go in. For a Sketchfab model, download the glTF zip from its page,
unpack it into `data/originals/<artwork id>/`, set provenance `sketchfab`,
and run the pipeline. Mark an artist-made model `representation:
"reconstruction"`; the placard then says so and credits the author, which
CC BY requires.

The iPhone record is in the catalogue with `moderation.status: "pending"`.
To show it, log in to Sketchfab, download the glTF zip of model
`485c51878bc7449e81379a863ec862f5`, unpack it into
`data/originals/sf-485c51878bc7449e81379a863ec862f5/`, run
`npm run fetch-assets`, and set the status to `approved`.

A work still in copyright gets `copyrighted: true` and a `Fair use` licence
on its asset version. The placard then prints "In copyright · shown under
fair use" instead of a licence, and the asset should be small: a single
reduced frame or a few silent seconds, never the whole thing.

## Deploy

The site is static, so a server needs nothing but a web server with HTTPS
(WebXR refuses plain HTTP). `scripts/deploy.sh` does the rest over ssh:

```bash
# ~/.ssh/config on your machine
Host 20watts
    HostName <server>
    User twentywatts

npm run deploy            # build, sync data, publish a release
npm run deploy -- --site  # publish only the site
DRY_RUN=1 npm run deploy  # print the remote commands instead of running them
```

Under the deploy user's home it keeps `data/originals/` (added to, never
deleted from), `data/derived/` (the served rungs, mirrored from
`public/assets`) and `site/releases/<stamp>-<commit>/`, with `site/current`
a symlink swapped in one rename. The last five releases stay for rollback.
The web server maps `/` to `site/current` and `/assets/` to `data/derived`;
Vite's bundle lives under `/app/` so the two never collide.
`deploy/20watts.nginx.conf` is that mapping for nginx (install it, then
`certbot --nginx` for TLS, which WebXR requires). Set `DEPLOY_HOST` to use
another ssh alias.

## License

Code is AGPL-3.0-only. Collection text is CC BY-SA 4.0. Images and models
carry their own licenses, shown on each placard. See [NOTICE.md](NOTICE.md).

## Credits

The cave painting photographs come from Wikimedia Commons under the licence
on each placard: public domain (Mariano Cecowski, HTO, PanBK), CC BY
(Matthias Kabel, Surfsupusa, Mheidegger) and CC BY-SA (Cahyo Ramadhani,
Claude Valette, Mateus S. Figueiredo, Bernard Gagnon, Issam Barhoumi, Lukas
Kaffer). The Chauvet, Lascaux and Altamira photographs show full-size
facsimiles, since those caves are closed; the placards say so.
The object photographs are from Wikimedia Commons and the Met's Open Access
programme: CC0 (The Metropolitan Museum of Art for the proto-cuneiform
tablet, the Exekias amphora and the Benin plaque; Shonagon for the Nebra
sky disc; Ted Coles for the bombe drums), CC BY (Matthias Kabel, Windell
Oskay), CC BY-SA (Dagmar Hollmann, Hans Hillewaert, Rama) and public domain
reproductions of the Alexander Mosaic, the Book of Kells and Fan Kuan's
scroll. The Clovis point and the Saint-Acheul hand axe are CC0 photogrammetry
scans by the Research Laboratories of Archaeology, University of North
Carolina at Chapel Hill, mirrored on Zenodo. The Wright Flyer scan is CC0
from the Smithsonian. The bombe drums and the transistor on display at Bell
Labs are replicas, and the placards say so. The Commodore 64 is a
photogrammetry scan by Digital Heritage Australia with ACMI, CC BY 4.0,
mirrored on Zenodo. The Apple I photograph of the Smithsonian's board is
CC0 by Blakespot; the Apple IIc photograph is CC BY 3.0 by Bilby.
The iPhone is "iPhone 1st
generation" by [skjoldbroder](https://sketchfab.com/skjoldbroder) on
Sketchfab, CC BY 4.0.
The Last Supper image is public domain, via Wikimedia Commons. The Columbia
scan is CC0 from the Smithsonian Institution's Digitization Program Office.
The Model T is based on "1924 Ford Model T 3d model with interior" by
[shubhankar.arch.3d](https://sketchfab.com/shubhankar.arch.3d) on Sketchfab,
CC BY 4.0.
The rickroll still and loop are cut from Rick Astley's "Never Gonna Give
You Up" (RCA / Sony Music, directed by Simon West) and shown under fair
use. Placard text uses Inter (SIL Open Font License). Meshes are decoded
with Google's Draco (Apache-2.0). Environment lighting is "Overcast Soil
(Pure Sky)" from [Poly Haven](https://polyhaven.com/a/overcast_soil_puresky),
CC0. Schema fields follow the conventions of
[A Walkable History of Art](https://github.com/justdataplease/art-history-museum)
so its Wikipedia-derived dataset can be imported later.
