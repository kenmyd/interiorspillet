# walls – notes for the integrator

Owner of `src/models/walldesigns.js`, `src/ui/WallPanel.js`, `src/ui/PhotoCompare.js`. Screenshots in `.shots/walls/`.

## What is there

### `models/walldesigns.js` (ARCHITECTURE §9 – exports kept, a few added)

```js
applyWallDesign(highWallInfo, elements|null, { quality }?) → Group|null   // in highWall.anchor, replaces + disposes the old one
buildWallDesign(elements, { quality, wall }) → Group|null    // same design as a free group (WallPanel thumbnails)
disposeDesign(group)
ELEMENT_TYPES { type: { label, short, icon } }                // all 16 types, Norwegian labels
elementEditor(type, element?) → schema (Def.params format + type 'color' with palette)  // keys ending Mm/Cm = mm/cm
elementValues(el) → values for that schema · setElementParam(el, key, value) → NEW element (re-estimates alpha)
createElement(type, { u, v }?) · describeElement(el) · elementBounds(el) → { u0, v0, u1, v1, depth }
elementAbsorption(el) → m² (delegates to design/Acoustics.js so the badge and the panel agree)
setWallQuality('low'|'medium'|'high') · WOOD_PRESETS
```

Group `userData.model = { parts, lights, surfaces, colliders, elements }` – all group-local (= anchor space).

- Slats: one indexed BufferGeometry per (material, part) – three wood tones per wall, random grain offset per slat, felt
  backing, battens/Glava shadow box behind the standoff, oak end trims on open edges. (Merged geometry instead of
  InstancedMesh on purpose: same draw-call count, but every slat gets its own part of the texture – identical
  instances show a visible repeat.) Akupixel/checker tiles alternate the slat direction per tile (top-left =
  `startOrientation`), or are felt tiles (`fill: 'felt'`).
- Sockets/switches (room-spec fixtures on w-hoy) that a covering element hides get a black surface-mount box
  («påbyggsramme») on the element face – as in montage B and the B material list.
- Art: procedural motifs (landscape-hills with sun / line-art / abstract-shapes / botanical) on canvas in the element's
  palette, felt-print speckle, metre UVs + the felt normal map, frames black/oak/smoked-oak/walnut/white/none,
  passe-partout for non-acoustic prints. A triptych with the same seed continues across the panels (global u).
- Tapestry (diamond / kilim / stripes / plain) with wool relief, rod with finials and brackets, fringe.
- Curtain: real wave folds (amplitude from `fullness` and `waveWidth` = wavelength, capped at a real wave-heading depth),
  track on the sloped ceiling at its real height (layout.ceilingHeightAt), hem, double-sided fabric.
- Moss (ball/flat/reindeer mix, displaced grid, vertex colours), wood-wool cement hexagons (own texture), felt circles,
  shelves and floating sideboards (flat / ribbed / slatted fronts, bench with seat cushion, books + vase decor),
  fold-out hooks, LED strip (profile + emissive diffuser + additive wall-wash glow + 1 spot per ~1.1 m),
  wall lamps and plants via `registry.buildModel('wall-sconce'|'wall-arm'|'plant-floor')` (so they look like the
  LAMPS/SOFT models; their lights are re-based into the design group), painted fields (rect / arch).
- Lights: `userData.model.lights` (point/spot, group-local, `emissiveMeshes`) – SceneSync already sends them as `'__wall'`.

### `ui/WallPanel.js`
Status bar (◀ ▶, name, live RT60 from `editor.acoustics()` or a preview computation, «uten veggtiltak», +m² Sabine,
price, badges), tabs «Forslag» / «Rediger». Browsing = PREVIEW (scene only: wall, paint, lights); «Bruk dette
forslaget» commits (`design.setWallProposal`). ← → flip while the panel is open (capture listener, so the player does
not strafe). Montage thumbnails (photo part only) or live-rendered thumbnails through the montage camera for the
proposals without an image (rendered into a corner of the game canvas inside `update()` before the frame's render;
visible cards first, every other frame, not in orbit/plan). Editor: wall paint, element list with
paramEditor/duplicate/remove, add element, «Lagre som mitt forslag», «Tilbakestill», «Tøm veggen»; the selected
element gets an amber outline on the wall; a click on the wall selects the element under the cursor.

### `ui/PhotoCompare.js`
`open(photoCamera|id?, imageUrl?, { proposal, follow })` → `views.setPhotoCamera(cam)` + photo overlay (wipe handle,
«Skillelinje», «Synlighet», «Bytt side», «Bare bildet», «Bare 3D», «50 % gjennomsiktig», «Lys som på bildet» =
design.setEnv evening / the photo's date and time, restored on close), photo list = the montage camera + the 7 room
photos. Montage mode follows the proposal WallPanel shows. Scaled by the camera's vertical FOV over the canvas height,
cropped to `photoRect` – verified aligned in `.shots/walls/cmp5.png` and `cmp-photo2.png`. `close()` → `views.exitPhoto()`.

## Please wire up / decide

1. **Custom proposals in the design.** `DesignState.normaliseWall` drops unknown fields, so «Mine forslag» are stored
   in localStorage `interiorspillet.wallCustom.v1` (the ACTIVE one is in the design anyway: `wall.proposalId =
   'mitt-…'`, `wall.elements`). To let them travel with saved/exported designs, keep
   `wall.custom: [{ id, code, name, description, elements, wallPaint, sabineAdded, rt60, createdAt }]` in
   normaliseWall/toJSON/undo; WallPanel would then read/write it (one-line change in `loadCustom/saveCustom`).
2. **Collision of wall elements** (curtain, sideboard, bench, plant, lamps, shelves): `userData.model.colliders`
   (group-local boxes). WallPanel registers them with `game.collision.addDynamicBox` as a fallback; better in
   SceneSync `_syncWall` – then set `home.sync.wallColliders = true` and WallPanel stops.
3. **SceneSync `_syncWall`** drops `penumbra` from the lights (the LED spots use 0.95) – please pass it through.
   Quality: call `setWallQuality(quality.level)` in createHome next to `setModelQuality` (WallPanel sets it from
   settings, but the first wall is built before the editor exists).
4. **Selection**: pass the hit point – `editor.select({ kind: 'wall', wallId, point: hit.point })`; WallPanel uses
   it to pick the clicked element (it falls back to its own raycast of the wall).
5. **Shell**: the skirting board should be hidden behind elements that stand on the floor (drawing 09). walldesigns
   covers it with felt between thin direct-mounted slats (T), but a `shell.setSkirtingGaps([{ u0, u1 }])` would be
   cleaner. Montage H also paints the bit of wall above/right of the door (w-gang) – our paint only covers w-hoy.
6. **controlsHelp**: add «← → – bla i veggforslagene (når veggpanelet er åpent)».
7. **Toolbar P** → `ui.photo.toggle()` opens the montage camera with the montage of the proposal in use; the other
   photos are in its «Bilde» list.
8. **LIGHTING**: the LED glow plane is a `MeshLambertMaterial` (additive, `userData.kind = 'emissive'`,
   `baseIntensity`) – dimmed through `emissiveMeshes` like the bulbs.

## Seen while testing (not mine)

- `tables.js` `coffee-table-round-nesting`: «pts is not iterable» (registry falls back to a box).
- Transient: `lighting.js` «illum.addScaledColor is not a function», decor archetypes missing while SOFT was editing.
- ViewModes' «Fotovinkel – Esc tilbake» hint sits under the PhotoCompare bar (harmless).
- Testing tip: every save by anyone reloads pages through HMR; I tested with my own Vite config `server.hmr: false`
  (same port 5192) to get stable screenshots.
