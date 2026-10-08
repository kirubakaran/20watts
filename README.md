# VR Museum

A museum you walk through in VR or on a flat screen, in the browser. One open
plane, no walls: forward is later in time, right is further east. Works float
at their true size, and you can walk behind one and see it mirrored.

v1 holds two works: Leonardo's *Last Supper* at its real 8.8 × 4.6 m, and
the Apollo 11 command module *Columbia*, a 3D scan from the Smithsonian,
3.9 m across. Walk forward from one and left to reach the other: 1495 Milan
to 1969 California.

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
src/world/floor.ts       ground, light, fog
src/world/exhibit.ts     one work in the world: image or glTF, placards, shadow
src/assets/textures.ts   image ladder; sharper rungs load as you approach
src/assets/models.ts     glb ladder, same idea for 3D scans
src/locomotion/player.ts desktop and VR movement
scripts/fetch-assets.ts  pulls images and models from their sources into public/assets
public/draco/            Draco mesh decoder, copied from three's examples
```

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
`currentVersionId` picks the one shown. Source downloads are cached in
`.cache/`.

- **Images** from Wikimedia Commons: the Commons API is asked for a ladder
  of thumbnail widths, saved as `<width>.jpg`.
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
objects go in. A model from elsewhere needs its glb rungs prepared by hand
to the same contract: Y-up, metres, base on the floor, footprint centred.

## License

Code is AGPL-3.0-only. Collection text is CC BY-SA 4.0. Images and models
carry their own licenses, shown on each placard. See [NOTICE.md](NOTICE.md).

## Credits

The Last Supper image is public domain, via Wikimedia Commons. The Columbia
scan is CC0 from the Smithsonian Institution's Digitization Program Office.
Placard text uses Inter (SIL Open Font License). Meshes are decoded with
Google's Draco (Apache-2.0). Schema fields follow the conventions of
[A Walkable History of Art](https://github.com/justdataplease/art-history-museum)
so its Wikipedia-derived dataset can be imported later.
