# 20watts

[20watts.org](https://20watts.org): everything here was made by a
20-watt brain. A museum you walk through in VR or on a flat screen, in the browser. One open
plane, no walls: forward is later in time, and a side quest stands off to
the right of the work it belongs with. Works float at their true size, and
you can walk behind one and see it mirrored.

v1 holds seventy-three works. They run from an Acheulean
hand axe (a CC0 photogrammetry scan, 300,000 years old) and the Lion-man of
Hohlenstein-Stadel through eleven cave and rock paintings from five
continents (with a scanned cast of a Lascaux wall beside the Lascaux
photograph), the Altamira ceiling, a scan of the Deutsches Museum's
full-size replica hung overhead, Stonehenge as a model you walk into, the Venus of Willendorf, a Clovis point (another scan), a
proto-cuneiform tablet, the Nebra sky disc, an Exekias amphora, the
Rosetta Stone, the Alexander Mosaic at its real 5.8 m, the Pantheon in Rome
(a photogrammetry scan of the interior, 43 m across, that you walk into
through its door and stand under the oculus), the Chi Rho page of
the Book of Kells, Fan Kuan's *Travelers Among Mountains and Streams*, a
Benin plaque, Leonardo's *Last Supper* at 8.8 × 4.6 m, Lilienthal's 1894
glider (a scan of the Deutsches Museum's replica, hung in the air), the 1903 Wright
Flyer and the Apollo 11 command module *Columbia* as Smithsonian 3D scans,
and from India the Dancing Girl of Mohenjo-daro, a Tamil-Brahmi rock
inscription near Madurai, the Iron Pillar of Delhi, a Padmapani from
Ajanta, a palm-leaf Tirukkural, the Descent of the Ganges relief at
Mamallapuram hung at its real 29 m, and the Brihadisvara Temple at
Thanjavur, a
Lunar Roving Vehicle (the Deutsches Museum's reconstruction of its replica), a
1924 Ford Model T, bombe drums, the first transistor, the Apple I, a
Cray-1, an Apple II, a Commodore 64 (a photogrammetry scan), an Apple IIc
with the MOS 6502 and its die beside it as the first side quest,
a Macintosh Plus (the Deutsches Museum's own, scanned), and the rickroll, a frozen frame of Rick Astley at the size of a living-room
television that starts to move when you walk up to it. The first iPhone is
a CC BY artist's model from Sketchfab, standing at its true 11 cm. Ten
equations hang among them as typeset sheets, from the Pythagorean theorem
in Euclid's Elements to Shannon entropy, each in the year and place it
was written down: Newton's gravitation, Euler's identity, Bayes' theorem,
Maxwell's equations, Boltzmann's entropy, E = mc², Einstein's field
equations and the Schrödinger equation, plus Brahmagupta's rules for
zero and Madhava's series for π from India. Nine pieces of music hang as
their manuscripts or first editions and play as you approach, from a
Brandenburg Concerto to Clair de lune, Joplin's Maple Leaf Rag, Caruso's
1907 record and the 1860 phonautogram that is the oldest recording of a
human voice; the Apollo 11 command module carries the landing's
air-to-ground and the rover the Apollo 16 drive.

## Run it

```bash
npm install
npm run dev
```

`npm test` runs the layout and navigation tests. The dev server is HTTPS (WebXR requires it). On a desktop browser open
`https://localhost:5173`, click to capture the mouse, WASD to walk, Shift to
run. On a Quest, open `https://<your LAN IP>:5173` in the headset browser,
accept the self-signed certificate once, and press **Enter VR**. Left stick
walks, right stick snap-turns.

Walking the whole museum takes a while, so there are hops: `[` and `]`
jump an era back or forward, `,` and `.` sideways along a row (to a work
of the same month, or to a side quest), and in VR the A / B buttons hop
eras and X / Y hop sideways; on a phone, drag to look, a stick in the
corner walks, and buttons do the hops; `Home` and `End`, or
`Shift` with `[` and `]`, jump to the entrance and the latest era. A hop lands you on the
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

## Streaming

Every work is known from the start only as a stub, its place and size from
the layout. `src/world/stream.ts` builds an exhibit (meshes, ladders, contact
shadow) when the visitor comes within 90 m, gives it placards within 35 m,
since text is the dearest part, and tears it down beyond 130 m. Rows run
along time, so this is infinite scroll through the eras, and the sweep
looks only at rows within reach. A memory budget, 384 MB estimated GPU
bytes on a headset or phone and 1.5 GB on a desktop, makes the farthest
exhibits fall back to their smallest rung when it is exceeded; the ladders
in `src/assets/` know how to shrink. Hops and `?at=` work from the stubs,
so a jump builds its surroundings on the next sweep. `?debug` logs the
count of live exhibits and the bytes held every two seconds, and
`?budgetMB=` overrides the budget for testing.

## Layout

```
src/data/types.ts        the Artwork record: every attribute we will ever need
src/data/collection.json the collection
src/layout/layout.ts     time -> row, branches beside their anchors -> world position + facing
src/world/floor.ts       ground, sky dome, environment light, shadows
src/world/axes.ts        year and side-quest labels stencilled on the floor
src/world/exhibit.ts     one work in the world: image or glTF, placards, shadow
src/assets/textures.ts   image ladder; sharper rungs load as you approach
src/assets/models.ts     glb ladder, same idea for 3D scans
src/assets/sound.ts      a recording heard from where a work stands, by distance
data/figures/            the drawings on the equation sheets, SVG
src/locomotion/player.ts desktop and VR movement
src/locomotion/touch.ts  phone controls: drag to look, a stick, hop buttons
src/locomotion/resume.ts remembers your place in the browser and restores it
src/locomotion/navigate.ts hops between eras and cells, and jumps to a work
src/world/sign.ts        the entrance gateway
scripts/fetch-assets.ts  pulls images and models from their sources into public/assets
test/layout.test.ts      layout, branches and hops, run with npm test
scripts/dev/screenshot.mjs one bounded headless-Chrome capture, for checking renders
scripts/dev/preview.html four fixed views of one model rung, for checking orientation and scale
scripts/dev/bounds.ts    bounds, root transforms and texture sizes of a glTF, before it goes in
public/draco/            Draco mesh decoder, copied from three's examples
public/env/              overcast HDRI used for environment lighting, never drawn
```

### Ground and sky

The floor is polished concrete drawn procedurally: one tile per layout
cell with hairline joints every 4 m and a firmer line on the 16 m cell
boundary, so the grid of rows shows without labels. The sky is
a gradient dome, warm at the horizon and cooler overhead, with the fog
matched to the horizon. Lighting is a CC0 overcast HDRI from Poly Haven
used only as the environment map, plus a soft directional light that casts
shadows for 3D objects and follows the visitor. Paintings opt out of tone
mapping so their colours stay as scanned.

### Axes

The time axis is ordered, not to scale. Works are binned by date, to the
month when the record has one; only non-empty bins become rows, so empty
centuries do not exist in the world. Two works a year apart stand one
behind the other on the spine; two from the same month stand side by side,
the earlier to the west (by `date.day`, then a hand-set `order`, then
`importance`). `timeBinMonths` in the layout config widens the bins to
years or decades. Geography is not an axis: every work stands on the one
lane, whatever its longitude, and the record keeps `madeIn` for the world
view, `?view=world`, which spreads each month's works by 5° of longitude
into cells, west to east and centred on the spine, with the longitude
printed on the floor.

A work with a `branch` is a side quest: it does not take a row of its own
but stands to the right of the work it belongs with, in that work's row,
with its label stencilled on the floor in front of it ("the chip inside").
Steps count outward, and a step can have steps of its own, so the Apple
IIc has the 6502 beside it and the 6502 has its die beside that. The chain
hangs off the east edge of the anchor's cell, as close as the works' widths
allow and never closer than 6 m, and anything else in the row moves over.
The sideways hop walks it. A branch keeps its own date for the placard.

Rows are only as wide as they need to be: cells are spaced by the row's
widest cell plus a gap, between 6 m and the full 16 m pitch. Along time,
rows are at least 16 m apart, and further when a row is deep, so that 8 m
of clear floor stays between one row's back and the next one's front; the
Pantheon takes 43 m of the lane and its neighbours step back. A work you
walk into carries `display.threshold`, the distance from its centre to its
door: the standing point, the hops, `?at=` and the placards go there
instead of standing back to take in the whole. `computeLayout` returns the
time ticks, each with the boundary where its label goes, and the list of
occupied cells.

Those feed the cues stencilled on the floor (`src/world/axes.ts`): the
year is printed on the boundary line you cross when you step into a new
year ("35,000 BCE", "c. 200 BCE", "1976"), once, however many months of it
have a row, since the month is almost never what matters. Nothing is drawn
where nothing stands.

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
CC BY requires. Give `date.month` (and `day`) when the record has one; it
sets the order within a year, and `order` breaks a tie by hand. To stand a
work beside another instead of in its own time, give it a `branch`: the
anchor's id, a `step` (1 nearest) and the floor label. A second way of
showing the same work (a photograph beside a scan, an earlier example of
the same part) goes in `alternates`, with its own credit and provenance;
the pipeline builds its rungs under `public/assets/<id>/alt1/`, and the
renderer does not use it yet. `npm run fetch-assets -- <id>` builds one
work's assets instead of the whole collection. For a building, set
`display.threshold` to the distance from the centre to the door, and
`display.back: "mirror"` if the scan is of the interior only, so both sides
of every surface are drawn and it reads as solid from outside;
`scripts/dev/bounds.ts` prints a file's size and `scripts/dev/preview.html`
shows which way it faces before you set `original.rotation`.

An equation is an image record with provenance `typeset` and the TeX in
`original.tex`; the pipeline sets it with MathJax on a sheet the shape of
the record's physical size (100 × 85 cm) under the drawing named in
`original.figure`, an SVG in `data/figures/`, and renders the ladder,
keeping the equation's SVG in `data/originals/<id>/`. Date it to when and
where it was written down, and say in the description whose notation the
sheet uses when that came later, as it did for Maxwell's.

A recording goes in `audio` on the record: the original's URL (Commons,
NASA, anything direct), the excerpt's `start` and `seconds`, the
performers, and its own credit, since a performance has a copyright of its
own even when the piece is centuries old. The pipeline downloads the
original into `data/originals/<id>/`, cuts and fades the excerpt with
ffmpeg and serves it as `sound.mp3`. It plays from where the work stands,
through the browser's spatial audio, starting as the visitor comes within
`display.hearing` metres (18 by default) and stopping a few metres beyond,
and the placard carries a "Sound:" line. A model's `original.omit` lists
node names to leave out of the rungs, such as the land around a monument. Leave `display.baseHeight` null unless a
work needs a particular height: a small upright object is then centred at
1.4 m, just below the eyes, a small flat one a little lower so its top is
seen, and anything over 1.2 m tall stands on the floor.

A work whose source cannot be fetched by script, such as a Sketchfab model,
is added with `moderation.status: "pending"` and skipped by the pipeline
until its files are in `data/originals/<artwork id>/`; then run
`npm run fetch-assets` and set the status to `approved`. The iPhone came in
this way: the glTF zip from Sketchfab, unpacked into its folder.

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
Kaffer). The Chauvet and Lascaux photographs show full-size facsimiles,
since those caves are closed, and the Altamira ceiling is a photogrammetry
scan of the Deutsches Museum's 1962 replica (inventory number 75270) by
[Deutsches Museum | Digital](https://sketchfab.com/deutsches-museum),
CC BY-SA 4.0; the placards say so.
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
CC0 by Blakespot; the Apple IIc photograph is CC BY 3.0 by Bilby. The MOS
6502 photograph is CC BY-SA 4.0 by ZyMOS, its 1975 ceramic alternate CC
BY-SA 4.0 by Christian Bassow, and the 6502 die photograph CC BY 3.0 by
Pauli Rautakorpi.
The iPhone is "iPhone 1st
generation" by [skjoldbroder](https://sketchfab.com/skjoldbroder) on
Sketchfab, CC BY 4.0, and the Apple II set-up is "Apple II Computer" by
[dark_igorek](https://sketchfab.com/dark_igorek) on Sketchfab, CC BY 4.0.
The Macintosh Plus is a photogrammetry scan of inventory number 2000-468 by
[Deutsches Museum | Digital](https://sketchfab.com/deutsches-museum),
CC BY-SA 4.0, and the Lunar Roving Vehicle is their 3D reconstruction of
replica 2019-407 from scans and the original drawings, CC BY-SA 4.0. The
Lilienthal glider is their scan of the museum's 1958 replica, inventory
number 1976-817, CC BY-SA 4.0. The equation sheets are typeset by this
project with MathJax and are CC0.
The Pantheon interior is "The Pantheon Interior" by
[artfletch](https://sketchfab.com/artfletch) on Sketchfab, CC BY 4.0, a
photogrammetry scan with a reconstructed floor. Stonehenge is "Stonehenge
England - VR" by [hermes3](https://sketchfab.com/hermes3) on Sketchfab, CC
BY 4.0, an artist's model shown without its surrounding land; the Lascaux
panel is "Scene with large deer from the Lascaux Cave" by
[3dhdscan](https://sketchfab.com/3dhdscan), CC BY 4.0, a scan of the cast
in the Anthropos Pavilion, Brno. The recordings are credited on each
placard: the Advent Chamber Orchestra (CC BY-SA 2.0), John Harrison with
the Wichita State University Chamber Players (CC BY-SA 4.0), the Fulda
Symphonic Orchestra (public domain), Frank Lévy for Musopen (CC0),
Laurens Goedhart (CC BY 3.0), the United States Marine Band and Enrico
Caruso's 1907 Victor record (public domain), the First Sounds recovery of
Scott de Martinville's phonautogram, and NASA's Apollo air-to-ground
loops (public domain). The manuscript and title-page images are public
domain scans from the Berlin State Library, the Bibliothèque nationale de
France, the Library of Congress and Wikimedia Commons, except the
Beethoven page (CC BY-SA 4.0 via IMSLP). The Indian works are Commons photographs: Gary Todd (CC0) for the Dancing
Girl, Ms Sarah Welch (CC BY-SA 4.0) for the Arittapatti inscription, Aiwok
(CC BY-SA 3.0) for the Iron Pillar, Anandajoti Bhikkhu (CC BY 2.0) for the
Ajanta Padmapani, the Tamil Virtual Academy's public-domain scan of the
Tirukkural leaf, Bernard Gagnon (CC BY-SA 3.0) for the Descent of the
Ganges and Nandhinikandhasamy (CC BY-SA 4.0) for the Brihadisvara vimana.
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
