# foundation-data – notes for the integrator

Owner: «foundation-data». Files: `src/data/**`, `src/catalog/index.js`, `src/design/DesignState.js`,
`src/design/Acoustics.js`, `src/design/Saves.js`, `src/home/layout.js`, `src/home/existing.js`, `tools/test-design.mjs`.

Run the tests: `node tools/test-design.mjs` (77 checks, no browser).
Rebuild the data from `research/`: `node src/data/scripts/normalize-data.mjs [--verbose]`.

## What exists

| File | Content |
| --- | --- |
| `data/room-spec.json` | copy of research (valid, unchanged) – 12 walls, 7 openings, 45 furniture, 15 built-in lights, 8 photo cameras |
| `data/palette.json` | copy of research – walls sand/marrakesh, 34 paints, 47 materials |
| `data/catalog/<key>.json` | 160 products / 389 variants in the 9 categories, normalised (see below) |
| `data/wall-proposals.json` | `{ version, …, acousticModel, wallFacts, proposals[40] }` – 0, B … G2, then N1 … N19 |
| `data/archetypes.json` | NEW shared schema: archetype → `{ family, mount, label }`, family → canonical `parts` + Norwegian `partLabels`, valid material kinds, alias tables. Registry/Inspector can use it as a fallback. |
| `data/scripts/normalize-data.mjs` | the normaliser (not bundled) |

### Catalogue normalisation
- Every product: unique id, `dims` in metres, archetype from ARCHITECTURE §5/§8, `mount` from the archetype
  (floor vases with `params.floor` → `floor`; everything else exactly the archetype's mount).
- Variant colour/material keys are the canonical part names (§13) and EVERY variant has a colour + material for every
  part of its family (lamps: shade/inner/base/metal/cord, tables: body/front/top/legs/handle, rugs: base/accent/accent2,
  shading: fabric/slat/rail, acoustic: panel/slats/backing/frame, framed: print/frame, plants: leaves/pot, objects: body).
- Optional extra parts kept where physical: seating `frame`/`piping`, pouf `legs`, plant `trunk`, vase `flowers`.
- Pattern colours with no part moved to params: `params.accentColor`, `lineColor`, `wireColor`, `glassColor`,
  `tapeColor` (variant-level `params`, merged into the item spec by `productToItemSpec`).
- Material values mapped to the §4 kinds (e.g. `opal-plastic`→`glass-opal`, `textile`→`cotton`, `painted-metal`/
  `white-metal`/`alu`→`painted` (bare grey alu → `steel`), `bamboo`→`ash`, `veneer`→`oak`, `wool-blend`→`wool`).
- Mount caveats for builders (origin conventions differ, so the mount was NOT changed):
  - wall-hung sideboards (`params.base: 'wall'`, `params.mountHeight`) stay `floor` → TABLES should lift the body by `mountHeight`.
  - the leaning mirror (`params.leaning: true`) stays `wall` → DECOR may tilt it / put its bottom on the floor.

### Wall proposals
- `image` = `img/forslag/<CODE>.jpg`, `thumb` = `img/forslag/thumb/<CODE>.jpg` for the 21 proposals with a montage
  (incl. «0»); N1–N19 have `image: null, thumb: null`. Original paths kept in `imageSource`.
- The two drawings (`5_Tegninger/08…png`, `09…png`) are NOT in public/ – their source paths are in `drawingsSource`.
  If WallPanel should show them, image-prep must copy them (e.g. `public/img/forslag/tegninger/`) and WALLS map the names.
- `acousticModel` copied to the top level. `wallFacts.width` is 3.90 (drawings) – the real wall is 3.91
  (`layout.highWall.width`). `wallFacts.worldPlacementHint` and `wallFacts.obstacles` spot positions are old estimates:
  use `layout.highWall` / `layout.builtInLights` (spots at u 0.76/1.62/2.48/3.34).

## home/layout.js
`import { layout } from './home/layout.js'` – deep-frozen (vectors too: clone before mutating). Highlights:
`walls[]` (start/end/dir/normal Vector2, dir3/normal3, length, thickness (outward), paint/paintHex, topProfile,
heightAt(u), pointAt(u,y), openings[] with `center/topCenter/bottomCenter/normal/right/corners/rect/hole/revealDepth`),
`wallsById`, `windows[]` (6, incl. the terrace door), `doors[]` (door-gang + door-terrasse with a Door.js `basis`),
`zones[]` (polygon, area, `box` 0…3.1, contains), `zoneAt(x,z)`, `ceilings[]`, `ceilingHeightAt(x,z)`, `bulkheads[]`
(footprint, `topAt(t)`), `floor` (polygon, area, contains), `highWall` (origin/uDir/normal/width/height exactly as the
spec + `toWorld(u,v)`, `toUV(p)`), `builtInLights[]`, `lightGroups`, `kitchen.items[]` (with `box`), `fixtures[]`,
`outside`, `photoCameras[]`, `photoCamera(id)`, `volume` (138.6 m³), `floorArea` (53.8 m²), `resolvePaint(name|hex)`,
`furniture` (raw spec entries), `spec`.

- **Sill convention**: `opening.sill` = bottom of the hole = TOP of the sill board (research: «vindusbrettet ligger på
  0,29»). Existing decor stands on the sills at y = sill (0.29 / 1.64), so SHELL should put the board's top at `sill`.
- **builtInLights[].group** is the §15 contract id (`led`, `spots`, `kjokken`, `overskap`, `tvstue`); the room-spec
  group is in `specGroup`. `lumens` for strips = lumensPerM × length; spots have `direction` (to `aimAt`) and `beamDeg`.
  `skinne-kjokken` is the track (`emits: false`). `layout.lightGroups` = `[{ id, label }]` (Norwegian) for LightPanel /
  `env.builtIn`.
- **photoCameras[]**: `{ id, file, fileName, montage, pos, lookAt, rotation: { x, y, z, order: 'YXZ' }, vfovDeg,
  aspect, photoRect, imageSize, k1 }` – `camera.rotation.set(r.x, r.y, r.z)` with order YXZ and `fov = vfovDeg`.
  Verified: rendering the layout through 082924, 082806 and 0_for and overlaying the real photo lines up
  (`.shots/foundation-data/edges-*.png`). The photos are NOT in public/ yet – PhotoCompare needs downscaled copies
  (montage: crop with `photoRect`, the bottom text strip is outside it).

## home/existing.js
`originalItems(layout)` → 49 item specs (45 entries, the TV-stue sill decor group split into 5 pieces), uids
`ex-<spec id>` (pieces `ex-f-dekor-overlys-1…5`), source `existing`, refId = spec id, canonical parts, valid materials.
- Position per mount = the model origin (§5): wall items use the spec `center` (vertical middle) and get
  `attach: { wallId, normal }`; ceiling = attachment point; others = bottom centre.
- Descriptive spec text moved to `item.notes`; params keep numbers/booleans/short codes only. Code values the
  builders can switch on: tub-swivel `legStyle: 'drum'` + `baseD/baseH` (drum base, no legs), sofas `base: 'plinth'`,
  `sofa-modular-l.modules: [{ kind: corner|seat|arm|chaise, w, d? }]` + armSide/shortLeg*, `sofa-curved.wingEnd/bolsterEnd`,
  dining chair `shell: 'shell', legStyle: 'slim-metal'`, bar stool `footrest`, coffee table `frame: 'tube-box'`,
  nesting tables `frame: 'ring', tables: [{ d, h, offset }]`, dining table `shape: 'stadium', legs: 'a-frame', legInset`,
  rugs `pile`/`pattern: 'geometric'|'pebble'`/`border`, plants `species: anthurium|palm|pothos|fern|herb` +
  `pedestal`/`stand` objects, vases `shape: ribbed|wave|round|bubble|bottle|block` + `flowers: hydrangea|pampas|eucalyptus|sprig`,
  basket `shape: cylinder|pedal-bin|rect|oval`, candle holder `kind: lantern|tealight`, art `motif: 'misty-trees'` + `palette`,
  chandelier `drop/hubDrop/shades/shadeD/canopyD/rod`. Unknown values should fall back to the builder default.
- `item.acoustic = { m2, ref }` – absorption estimate at the spec dims (sofa 3.0 / 2.2, swivel chairs 0.6, dining
  chairs 0.25, rugs α(pile) × area …). Original furniture total 12.24 m².
- The chandelier carries `light: { on, dimmer, colorK: 2700, lumens: 2000 }`. Kitchen + built-in lights stay in the shell.

## catalog/index.js
§6 API plus: `allProducts()`, `categoryLabel(key)`, `EXTRA_CATEGORIES` (sofa/bord/stoler/elektronikk/hylle used by the
existing items), `SUBCATEGORY_LABELS`, `archetypeInfo(id)`, `priceOf(product, variantIndex)` → `{ price, listPrice,
onSale, from }`, `productToShadingSpec(product, variantIndex)` → ShadingSpec for `design.setWindow()`
(`mount` = installation `recess|frame|wall|ceiling` from `params.mount`; product-level `mount` is always `window`).
`CATEGORIES[].icon` are `ui/icons.js` keys (sofa, home, bulb, lamp, palette, sliders, blinds, volume, pin).
`productToItemSpec` puts `light: { on, dimmer, colorK, lumens }` on lamps and `acoustic: { m2, ref }` on everything.

## design/DesignState.js
`new DesignState({ layout? })` starts with the ORIGINAL design (no undo step): existing items, wall `{ proposalId: '0',
elements: [], edited: false }`, no shading, default env. Events exactly as §7; each mutation emits its event, then
`'change' { type, … }`, then `'history'`. Additions beyond §7:
- `begin(label)` / `end()` / `cancel()` – a drag across frames (`transaction()` also accepts a promise-returning fn).
- `update(uid, patch, { coalesce: 'key' })` – merge rapid edits (sliders) into one step; `setEnv`/`setPaint`/same-product
  `setWindow` coalesce automatically within 1 s.
- `setWallProposal(id)` – sets the wall AND the proposal's `wallPaint` on `w-hoy` as one step (H, N8, N13 have one).
  `setWall({ proposalId })` alone loads the proposal's elements; `setWall({ elements })` marks it `edited`.
- `duplicate(uid, { offset })`, `proposal(id?)`, `setMeta({ name })`, `undoLabel`/`redoLabel`, `clearHistory()`,
  `originalJSON()`, `load(json, { keepHistory, label })` (throws a Norwegian Error on broken JSON).
- `resetToOriginal()` is undoable by default (`{ keepHistory: false }` to clear).
- **SceneSync must do a full resync on `'load'`** (load replaces everything without per-item events). Undo/redo
  emit normal per-item events.
- Items carry extra fields: `acoustic`, `notes`, `confidence`; `light.lumens`. `get()`/`list()` return live objects –
  treat as read-only (every mutation replaces the stored object).
- `env.builtIn` keys are `layout.lightGroups` ids; missing = LightManager default.

## design/Acoustics.js
`computeAcoustics(design, home)` → `{ rt60, absorption, volume, baseline: 0.86, roomAbsorption, target: [0.4, 0.6],
level: 'green'|'yellow'|'red', label: 'Etterklang ≈ 0,86 s', breakdown: [{ label, m2 }], changes: [{ label, m2 }] }`.
Original = 0.860 s (room absorption calibrated to 13.70 m² + furniture 12.24 m²); proposal B → 0.677 s, C → 0.710,
N1 → 0.640 (all within 0.01 s of the research figures). Also exported: `itemAbsorption(item)` (for the Inspector),
`elementAbsorption(el)` (same model as `walldesigns.elementAbsorption` should use: area × alpha, circles πr², hexagons
n × hex area, curtain w × (top − bottom)), `wallAbsorption(wall)`, `shadingAbsorption(win, spec)`, `rt60For(A, V)`.

## design/Saves.js
`new Saves(design, { autosave: true })`. Suggested wiring in home/index.js or Editor:
```js
const saves = new Saves(design);
if (!saves.loadFromParams(game.dev.params)) saves.restore();   // ?design=<name>, else last session
```
API: `list()` («Original» first), `save(name)`, `load(name)`, `loadOriginal()`, `remove`, `rename`, `uniqueName`,
`exportFile(name?)`, `exportText`, `importFile(file)` / `importText(text)` (throw Norwegian errors), `pickAndImport()`,
`autosaveNow()`, `available`, `dispose()`. Storage key `interiorspillet.designs.v1`; all access guarded.

## Needs from others
- None blocking. SceneSync should pass `item.light` (on/dimmer/colorK/lumens) to `setItemLights` (builder lights give
  positions; the item gives the values).
- Placement: ceiling items must snap y to `layout.ceilingHeightAt(x, z)` (the chandelier keeps `params.drop`).
