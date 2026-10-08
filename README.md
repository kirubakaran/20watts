# VR Museum

A museum you walk through in VR or on a flat screen, in the browser. One open
plane, no walls: forward is later in time, right is further east. Works float
at their true size, and you can walk behind one and see it mirrored.

v1 holds one work: Leonardo's *Last Supper* at its real 8.8 × 4.6 m.

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
src/assets/textures.ts   thumbnail ladder; sharper rungs load as you approach
src/locomotion/player.ts desktop and VR movement
scripts/fetch-assets.ts  pulls thumbnails from Wikimedia into public/assets
```

### Axes

Both axes are ordered, not to scale. Works are binned by decade and by
5° of longitude; only non-empty bins become cells, so empty centuries and
oceans do not exist in the world. Within a cell, works are packed in a grid,
most important first. `computeLayout` returns the tick list for each axis so
later versions can draw cues where time stretches or compresses.

### Assets

Images are served from this host, never hotlinked. `npm run fetch-assets`
reads each Wikimedia-sourced image version, asks the Commons API for a
ladder of widths, downloads them to `public/assets/<id>/<width>.jpg`, and
writes the rungs back into `collection.json`. Each artwork may hold several
image versions (imports, user uploads) with their own credit and moderation
state; `currentVersionId` picks the one shown.

### Adding a work

Append a record to `collection.json` following `src/data/types.ts`, run
`npm run fetch-assets`, reload. A 3D object is `kind: "model"` with a `.glb`
in its asset and `bounds` in metres; the layout treats it as a footprint on
the floor.

## License

Code is AGPL-3.0-only. Collection text is CC BY-SA 4.0. Images and models
carry their own licenses, shown on each placard. See [NOTICE.md](NOTICE.md).

## Credits

The Last Supper image is public domain, via Wikimedia Commons. Placard text
uses Inter (SIL Open Font License). Schema fields follow the conventions of
[A Walkable History of Art](https://github.com/justdataplease/art-history-museum)
so its Wikipedia-derived dataset can be imported later.
