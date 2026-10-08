# VR Museum

A museum you walk through in VR or on a flat screen, in the browser. One open
plane, no walls: forward is later in time, right is further east. Works float
at their true size, and you can walk behind one and see it mirrored.

v1 holds four works: Leonardo's *Last Supper* at its real 8.8 × 4.6 m, a
1924 Ford Model T runabout, the Apollo 11 command module *Columbia* as a
Smithsonian 3D scan, and the rickroll, a frozen frame of Rick Astley at the
size of a living-room television that starts to move when you walk up to
it. They step across the floor from 1495 Milan to 2007 London.

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

`?spawn=x,z,yawDegrees` places you anywhere for debugging, e.g.
`?spawn=0,-11,180` looks at the back of the first work.

## Layout

```
src/data/types.ts        the Artwork record: every attribute we will ever need
src/data/collection.json the collection (v1: one work)
src/layout/layout.ts     (time, geography) -> cell -> world position + facing
src/world/floor.ts       ground, sky dome, environment light, shadows
src/world/exhibit.ts     one work in the world: image or glTF, placards, shadow
src/assets/textures.ts   image ladder; sharper rungs load as you approach
src/assets/models.ts     glb ladder, same idea for 3D scans
src/locomotion/player.ts desktop and VR movement
scripts/fetch-assets.ts  pulls images and models from their sources into public/assets
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
oceans do not exist in the world. Within a cell, works are packed in a grid,
most important first. `computeLayout` returns the tick list for each axis so
later versions can draw cues where time stretches or compresses.

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
  loop within 6 m. Needs ffmpeg on the PATH.
- **Models from a file** (provenance `sketchfab` or `user-upload`): the
  source glb or glTF is read from `data/originals/<id>/`, which you populate
  by hand since those sources need a login. The ladder is built from that one
  file: textures are resized per tier and re-encoded as WebP, the mesh is
  simplified for the lower tiers, and the result gets the same metres,
  origin and Draco treatment as a Smithsonian scan.
- **Models** from Smithsonian 3D: the `original.url` is a Voyager
  `document.json`. Each of its quality tiers is a set of Draco glb parts in
  centimetres; the pipeline merges the parts, converts to metres with the
  base at y = 0 and the footprint centred, re-encodes with Draco, and saves
  `thumb.glb`, `low.glb`, `medium.glb`, `high.glb`. The renderer swaps rungs
  by texture size as you approach, exactly as it does for images.

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

A work still in copyright gets `copyrighted: true` and a `Fair use` licence
on its asset version. The placard then prints "In copyright · shown under
fair use" instead of a licence, and the asset should be small: a single
reduced frame or a few silent seconds, never the whole thing.

## License

Code is AGPL-3.0-only. Collection text is CC BY-SA 4.0. Images and models
carry their own licenses, shown on each placard. See [NOTICE.md](NOTICE.md).

## Credits

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
