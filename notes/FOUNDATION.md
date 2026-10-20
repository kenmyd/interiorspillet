# FOUNDATION – read this first

Render core, editor hub and the stubs, built by «foundation-render» on top of ARCHITECTURE.md / SCAFFOLD.md and the
data layer (notes/foundation-data.md). Everything below **works end to end today**: `/?play=1` loads the real room
with the original furniture as block-out models, a toolbar, an acoustics badge, selection (click → inspector),
placement from the stub catalogue, undo/redo, walk/orbit/plan views. Your job is to replace a stub with the real
thing while keeping the signatures here.

Dev server for your own tests: `npx vite --host 127.0.0.1 --port <your port> --strictPort`, then
`node tools/shot.mjs "http://127.0.0.1:<port>/…" out.png`.

| Page | What |
| --- | --- |
| `/?play=1&pos=x,y,z&yaw=deg&pitch=deg&view=walk\|orbit\|plan&design=<name>&start=continue` | the game |
| `/dev/sandbox.html?cam=x,y,z&look=x,y,z&fov=deg&photo=<id>&mode=day\|evening\|night&hour=h&month=m&ceil=0&orbit=0&quality=` | the home under a free camera; `photo=20261018_082909` (or `0_for`, `…083019`, `…082806`, `…082924` …) looks through a room-spec photo camera – shoot at 4:3 (`--w=1280 --h=960`) and compare with `public/img/foto/<id>.jpg`. `window.__setView({ pos, look, fov })` (or positional) for `--views` |
| `/dev/models.html?arch=<id>&dims={json}&params={json}&colors={json}&materials={json}&rot=deg` | one model under studio light |
| `/dev/models.html?cat=<catalogKey>[&variant=n]` / `?all=1` / `?mat=1[&kinds=a,b&color=%23hex]` | catalogue grid (variant 0) / every archetype / every material kind; `&focus=<id>` frames one, `&labels=0`, `&cols=n`, `&cam=…&look=…&fov=` |

The dev pages never write saved designs (read-only storage). `window.__ready` is set on all pages.

---------------------------------------------------------------------------------------------------------------

## 1. Who owns what

| Owner | Files (stub today unless marked) |
| --- | --- |
| FOUNDATION (done) | `home/index.js`, `home/materials.js`, `models/kit.js`, `models/registry.js`, `design/SceneSync.js`, `design/Editor.js`, `core/Game.js`, `main.js`, `ui/panelKit.js`, `ui/panels.css`, `dev/*`, `src/dev/*` |
| SHELL | `home/shell.js`, `home/kitchen.js`, `home/exterior.js` |
| LIGHTING | `home/lighting.js`, `ui/LightPanel.js` |
| SEATING / TABLES / LAMPS / SOFT | `models/seating.js`, `tables.js`, `lamps.js`, `textiles.js` + `decor.js` |
| SHADING | `models/shading.js`, `ui/WindowPanel.js` |
| WALLS | `models/walldesigns.js`, `ui/WallPanel.js`, `ui/PhotoCompare.js` |
| INTERACT | `design/Placement.js`, `Selection.js`, `ViewModes.js` |
| UI | `ui/Toolbar.js`, `CatalogPanel.js`, `Inspector.js`, `SavePanel.js`, `ShoppingPanel.js`, `AcousticsWidget.js` |

Every stub starts with `// STUB – owned by <OWNER>` and describes what it does now.

---------------------------------------------------------------------------------------------------------------

## 2. Materials – `home/materials.js`

```js
import { mat, paint, emissive, shadeMaterial, resolveColor, MATERIAL_KINDS, MATERIAL_LABELS, materialOptions } from '../home/materials.js';

mat(kind, hex?, opts?)            // cached (kind, hex, opts) – NEVER mutate or dispose it
paint('sand' | 'marrakesh' | '#hex', { roughness? })   // matt wall paint, cached
emissive(hex = '#fff4e0', intensity = 1, { color? })     // NEW material each call (LightManager dims it per lamp)
shadeMaterial(kind, hex, { glow = '#ffd2a0', intensity = 0.8, ...opts })  // NEW: textured lamp shade that glows when lit
resolveColor(c, fallback = '#9a9a9a')   // 'sand' | 'marrakesh' | palette paint id/name/code | palette material id | '#rgb' | '#rrggbb'
MATERIAL_KINDS, MATERIAL_LABELS, MATERIAL_GROUP_LABELS, ALL_KINDS
materialOptions('fabric' | ['oak', 'walnut'] | undefined) → [[kind, 'Norsk navn'], …]   // for <select>
kindGroup(kind), defaultColor(kind), isTransparentKind(kind), materialInfo(kind)
configureMaterials({ quality }) / prepareMaterials(kinds, onProgress)   // createHome calls both
assetUrl('img/…')                 // URL of a public/ file that also works from dev/*.html (window.__ASSET_BASE__)
```

`opts` (part of the cache key): `grain: 'y'|'z'|'v'` rotates the texture 90° (see below), `scale: 2` = texture twice as
coarse (chunky knit, big bouclé), `roughness`, `metalness`, `side: 'double'`, `opacity`, `open: true` (rattan:
see-through weave via alphaTest), `flat: true` (no textures – tiny parts), `emissive: '#hex'`,
`emissiveIntensity`, `envMapIntensity`.

Rules:
- **UVs must be in metres** (use the kit geometries / `kit.worldUV`): every texture is metre-scaled (bouclé loops
  ≈ 3–5 mm, weave ≈ 1 mm threads, knit stitches 9 × 7 mm, wood rings ≈ 7 mm, marble tile 0.9 m). A texture on 0..1
  UVs is wrong by 10–100×.
- The colour is the material colour, normalised so the **average albedo equals the hex** (purchase colours stay
  true). One texture set per kind is shared by all colours.
- Wood grain, brushed metal streaks and knit columns run along texture **U**. Box-projected geometry: pass the axis
  to `worldUV(geo, 1, { grain: 'z' })` / `kit.box(w,h,d,{ grain })` / `roundedBox(…, { grain })`. Lathe/tube/cylinder
  UVs: u = around/along – use `mat('oak', hex, { grain: 'v' })` when the grain must run along v.
- Fabrics use `MeshPhysicalMaterial` sheen (off on «lav»). Metals/mirror need the scene environment (LightManager
  sets `scene.environment`).
- Glass kinds are transparent, `setShadows` makes them not cast.
- Paint: `paint('sand')` = Jotun 1140 #cfc5b4, `paint('marrakesh')` = Jotun 1623 #aea191 (palette.json).
- Recolouring: SceneSync swaps `mesh.material = mat(newKind, newHex, oldOpts)` on the meshes of a part – this only
  works when the part's meshes use cached `mat()` materials. Anything else (custom/emissive/shade materials) makes
  SceneSync rebuild the model, which is fine – or give the model a `recolor(part, hex, kind)` function.

---------------------------------------------------------------------------------------------------------------

## 3. Model kit – `models/kit.js`

```js
import * as K from './kit.js';

// geometry (metres, metre UVs)
K.box(w, h, d, { grain, uvScale = 1, bottom = false })             // bottom: origin at the bottom centre
K.roundedBox(w, h, d, r = 0.01, seg = 2, { grain, uvScale, bottom })
K.cushion(w, h, d, { puff = 0.15, round = 0.5, axis, top = 1, bottom = 0.5, sides = 0.25, pinch = 0, seg = 10, bottomOrigin, grain, uvScale })
      // soft pillowy box measuring exactly w×h×d; axis = thin axis ('y' seat cushion, 'z' back cushion / throw pillow);
      // pinch 0.5 = throw-pillow corners; bottom 0 = flat underside
K.taperLeg(h, rTop, rBottom = rTop, { seg = 12, square = false })   // y 0..h, origin at the floor
K.cylinder(rTop, rBottom, h, { seg = 24, open, center = false, thetaStart, thetaLength })   // bottom origin
K.sphere(r, { wSeg, hSeg, phiStart, phiLength, thetaStart, thetaLength })
K.torus(R, r, { radial, tubular, arc })
K.lathe([[r, y], …], { seg = 32, phiStart, phiLength })          // profile bottom → top; u around, v along profile
K.tube(points, r, { seg, radial = 8, closed, curve: 'catmull' | 'line', tension })   // u along, v around
K.extrudeShape(shape | [[x,y],…], depth, { bevel = 0, bevelSegments = 2, curveSegments = 24, center })  // along +z
// shapes (2D x/y)
K.roundedRectShape(w, h, r), K.stadiumShape(w, h), K.ellipseShape(w, h, n = 48), K.ringShape(rOut, rIn)
K.arcPoints(r, a0, a1, n, cx, cy) → Vector2[], K.arcPoints3(center, r, a0, a1, n, xAxis, yAxis) → Vector3[]
// UVs / normals
K.worldUV(geometry, scale = 1, { grain = 'x', offset }), K.planarUV(geometry, axis, scale)
K.smoothNormals(geometry, precision = 1e4, creaseDeg = 180)       // smooth shading, UV seams kept
// assembly
K.partMesh(geometry, material, part, { position, rotation, scale, name, noMerge })   // tags userData.part
K.tagPart(mesh, part), K.collectParts(root) → { part: Mesh[] }
K.finishModel(group, { lights, surfaces, seatY, colliders, merge = true, shadows = true, recolor }) → group
K.mergeSameMaterial(group), K.setShadows(root, cast, receive), K.disposeModel(root), K.sharedGeometry(key, factory)
K.pointLight([x,y,z], { lumens, colorK, emissiveMeshes }), K.spotLight(pos, dir, { angle, penumbra, lumens, colorK, emissiveMeshes })
// misc
K.rng(seed | 'string') → () => [0,1)  (+ .range(a,b) .int(a,b) .pick(arr) .sign() .jitter(v,a) .gauss())
K.DEG, K.clamp01, K.lerp
K.blockout(spec, { archetype, family, mount })   // the placeholder box model (registry fallback, stubs)
```

A builder in five lines:
```js
build(spec) {
  const { w, d, h } = spec.dims, C = spec.colors, M = spec.materials;
  const g = new THREE.Group();
  g.add(K.partMesh(K.roundedBox(w, 0.03, d, 0.004, 2, { grain: 'x' }), mat(M.top, C.top), 'top', { position: [0, h - 0.015, 0] }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    g.add(K.partMesh(K.taperLeg(h - 0.03, 0.018, 0.012), mat(M.legs, C.legs), 'legs', { position: [sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)] }));
  return K.finishModel(g, { surfaces: [{ y: h, w, d, center: [0, 0] }] });
}
```
- `finishModel` sets shadows (glass/emissive never cast), merges meshes with the same material + part + shadow
  flags (one draw call each), and writes `userData.model = { parts, lights, surfaces, seatY?, colliders? }`.
- Keep animated or separately-lit pieces out of the merge with `userData.noMerge = true` (on the mesh or a parent
  group). Lamp bulbs/shades in `emissiveMeshes` must be noMerge (partMesh(…, { noMerge: true })).
- `colliders: [{ min: [x,y,z], max: [x,y,z] }]` (model space) when the AABB would block too much (L-sofa, an arch,
  a table with an open frame). Without it SceneSync uses the whole AABB for floor items taller than 0.3 m.
- Determinism: `K.rng(seed)` only, never Math.random().
- Quality: `spec.quality` = 'low' | 'medium' | 'high' (fewer segments on low).

---------------------------------------------------------------------------------------------------------------

## 4. Registry – `models/registry.js`

```js
ARCHETYPES                       // frozen merge of seating/tables/lamps/textiles/decor `archetypes`
getArchetype(id) → Def | null
mergeSpec(def, spec) → { archetype, dims, params, colors, materials, quality }   // defaults merged (1 level)
buildModel({ archetype, dims, params, colors, materials, quality }) → Group      // never throws; grey/blockout box + console.warn on a missing archetype or a throwing builder (userData.model.fallback = true)
archetypesFor(categoryKey) → id[], setModelQuality('low'|'medium'|'high')
```
The returned group has `userData.archetype`, `userData.spec` (merged) and `userData.model`. Def format exactly as
ARCHITECTURE §5. The stubs show a working Def per archetype (label/mount/parts/partLabels from
`data/archetypes.json`, defaults, a small `params` schema, `dimsRange`) – keep the ids, replace `build`.

---------------------------------------------------------------------------------------------------------------

## 5. SceneSync – `design/SceneSync.js` (home.sync)

```js
const sync = home.sync;               // created by createHome; listens to home.design
sync.getObject(uid) → Group | null    // item root: userData.pick = { kind: 'item', uid }, userData.uid, .model, .spec
sync.objectBounds(uid, target?) → Box3 | null   // world AABB
sync.objects() → Group[]              // all item roots (raycast these)
sync.itemAt(object3D) → uid | null
sync.placeObject(object, { mount, position, rotationDeg, attach })   // mount rules (also for ghosts)
sync.buildGhost(itemSpec) → Group     // translucent preview, no pick/shadows; add to scene yourself, K.disposeModel() when done
sync.ghostTint(ghost, ok)             // red tint when the spot is invalid
sync.flush()                          // apply queued item changes now (getObject/objectBounds do it for you)
sync.syncAll()                        // full rebuild (done automatically on design 'load')
sync.on('built', ({ uid, object, item, rebuilt }) => …)   // also 'moved' { uid, object, item }, 'removed' { uid }
```
- Item changes are queued and applied once per frame (home.update → sync.update). Colour/material-only →
  material swap; position/rotationDeg/attach → move; `light` → lights re-sent; `hidden` → visibility; dims/params/
  archetype/mount → rebuild (old model disposed).
- Mount rules: floor/surface/rug/soft at `item.position` + `rotationDeg`; wall: local +z = `attach.normal` (else the
  wall's normal from `attach.wallId`, else rotationDeg), `attach.tilt` (deg) leans the top back toward the wall;
  ceiling: y = `home.ceilingHeightAt(x, z)`.
- Collision: floor items taller than 0.3 m get `collision.addDynamicBox` (2 cm slack), updated on move, disabled
  when hidden.
- Lights: the model's `userData.model.lights` (local) → world → `lighting.setItemLights(uid, [{ type, position, direction,
  angle, penumbra, colorK, lumens, on, dimmer, emissiveMeshes }])`. `item.light` overrides colorK/on/dimmer, and
  `item.light.lumens` is split over the model's lights by their lumens share. The high wall's design lights go out
  as uid `'__wall'`.
- Also: `design.wall` → `applyWallDesign(home.highWall, elements)`; `design.windows[id]` → `applyShading(windowInfo,
  spec)` → `lighting.setWindowTransmission(id, t)`; `design.paints` → `home.setPaint(wallId, colour|null)`;
  `design.env` → `lighting.setTime/setMode/setExposure/setBuiltIn(groupId, state|null)`; every change →
  `lighting.requestShadowUpdate()`.

---------------------------------------------------------------------------------------------------------------

## 6. The home – `home/index.js`

```js
home = {
  spawn, rooms, layout, walls, windows, doors, highWall, ceilingHeightAt, floorY: 0,
  roots: { shell, kitchen, exterior, items, wall, shading },   // window anchors live in roots.shading, the high-wall anchor in roots.wall
  pickables: { floor, walls, ceilings, windows },              // from the shell (ceilings include the bulkheads)
  builtInLights,                                               // shell + kitchen
  lighting, design, saves, sync, shell, kitchen, exterior,
  setPaint(wallId|ceilingId, colour|null), paintOf(wallId),
  update(dt, time, state), dispose(),
}
```
Build order: design (original, or `?design=` / `start=continue`) → textures for the kinds in use → shell → kitchen →
exterior → LightManager → SceneSync.syncAll. `ctx.design` and `ctx.lighting` are set. Spawn: dining area (4.2, 0, 4.0)
looking past the table to the swivel chairs and the south windows.

Start design: «Gå inn i stua» = today's room (an unnamed previous session is first saved as «Forrige økt (dd.mm.
hh:mm)»); «Fortsett siste design» (shown when Saves has an autosave or an active named design) = `saves.restore()`.

---------------------------------------------------------------------------------------------------------------

## 7. Editor – `design/Editor.js` (game.editor, window.__game.editor)

```js
editor.game, .home, .design, .sync, .saves, .layout, .events (= game.events), .input, .camera, .renderer, .scene, .hud, .uiRoot, .catalog
editor.selection, .placement, .views
editor.ui = { toolbar, catalog, inspector, wall, window, light, saves, shopping, acoustics, photo }
editor.selected                        // { kind: 'item'|'wall'|'window'|null, uid?, wallId?, windowId? }
editor.select(target | null)           // emits 'select' { selected, previous } on editor.events and opens the panel:
                                       //   item → ui.inspector.open(sel), high wall → ui.wall.open(sel),
                                       //   other wall → ui.inspector.open(sel), window → ui.window.open(windowId),
                                       //   null → ui.inspector.close()
editor.startPlacing(itemSpec, { onDone }) → placement.start
editor.handleClick(ndc) → bool         // Game routes Input clicks here first; placement → selection → (false) InteractionSystem
editor.handleEscape() → bool           // cancel placement → close the top panel (+deselect) → deselect → back to walk; false → Game pauses
editor.raycast(ndc, { items, walls, windows, floor, ceilings, exclude }) → Hit | null
     // Hit = { kind, uid?|wallId?|windowId?|ceilingId?, object, point: Vector3, normal: Vector3 (world, toward the camera), distance }
editor.pointerNDC(target?) → Vector2 | null   // cursor in any view mode
editor.keysActive() → bool             // check this in every keydown shortcut (no text field, not paused, no modal)
editor.blocksGameInput() → bool        // a form field has focus or a modal panel/dialog is open → the player stands still
editor.acoustics() → computeAcoustics(design, home)   // cached until the next design change
editor.activeCamera                    // views.camera ?? game camera (Game renders with it)
```
Events on `editor.events` (the game bus): `'select'`, `'panel' { id, open }`, `'placing' { active, spec? }`, `'view' { mode }`,
plus the usual `'toast' { text, seconds }` / `'sfx' { name }`.

Constructors are `new X(editor)`, each in a try/catch: a module that throws is replaced by an inert stand-in and
logged, the rest keeps working. `update(dt)` is called on views, selection, placement and every `ui.*` that has it.

Contracts the stubs already follow (keep them):
- **Selection**: `handleClick(ndc) → bool` (return false when nothing of ours was hit or an InteractionSystem target is
  closer, so doors keep working), `update(dt)`, `dispose()`. Owns R / Shift+R / Delete / D (+ arrows) for the selected item.
- **Placement**: `start(spec, { onDone })`, `handleClick(ndc) → bool`, `beginDrag(uid, hit) → bool`, `isActive`, `cancel()`,
  `update(dt)`, `dispose()`. Use `input.setPointerClaim(fn)` for drag-to-move in walk mode.
- **ViewModes**: `mode`, `isWalking`, `camera` (render camera), `pointerNDC(target)`, `set(mode)`, `toggle()`,
  `setPhotoCamera(layout.photoCameras[i])`, `exitPhoto()`, `update(dt)`, `dispose()`. Outside 'walk' the stub takes
  `game.blockInput('view')` and feeds its own canvas clicks to `editor.handleClick(ndc)`; Esc then reaches
  `editor.handleEscape()` through the Editor's own key listener (Input is disabled).
- **Panels**: `open(arg?)`, `close()`, `toggle()`, `isOpen`, `update?(dt)`, `dispose()`. Toolbar owns K V B L Tab O M I P
  Ctrl+Z Ctrl+Y (the stub does them already).

Game frame (core/Game.js): input → Esc (`editor.handleEscape()` else pause) → help → player (only when
`views.isWalking && !editor.blocksGameInput()`) → interaction → click (`editor.handleClick` first) / E →
`editor.update(dt)` → room → `home.update` → audio → HUD → render (`home.lighting.render(renderer, scene, camera)` if
the LightManager defines it – post-processing hook – else `renderer.render`). `window.__game.home/.design/.editor`.

---------------------------------------------------------------------------------------------------------------

## 8. Panel kit – `ui/panelKit.js` (+ `ui/panels.css`)

```js
import { BasePanel, createPanel, section, field, row, tabs, card, swatches, colorPicker, slider, select, toggle,
  textInput, button, iconButton, paramEditor, badge, emptyState, comingSoon, confirmDialog, infoDialog,
  fmtNok, fmtMeters, fmtCm, paletteColors, captureKeys, isFormFocused, anyModalOpen, closeTopPanel } from './panelKit.js';

export class ShoppingPanel extends BasePanel {
  constructor(editor) {
    super(editor, { id: 'shopping', title: 'Handleliste', icon: 'pin', side: 'right', width: 26 });
    this.list = h('div.ip-list');
    this.body.append(section('Nytt i designet', this.list));
    this.foot.append(button({ label: 'Eksporter', icon: 'check', variant: 'primary', onClick: () => … }));
  }
  onOpen(arg) { /* refresh content */ }
  update(dt) {}
}
```
- `createPanel({ id, title, icon, side: 'left'|'right'|'bottom'|'center', width (em number or css), modal, closable,
  exclusive = true, parent, className, onClose })` → `{ el, head, body, foot, open(), close(), toggle(), isOpen,
  onOpen, onClose, setTitle(text), dispose() }`. Opening a panel closes the other exclusive panels on the same side.
  Modal panels get a backdrop, block the game input (via the Editor host) and handle their own Esc.
  `BasePanel(editor, opts)` wraps it: `open(arg)` calls `this.onOpen?.(arg)` first; `this.body`, `this.foot`, `this.panel`.
- `tabs([{ id, label, icon }], { value, onChange })` → `{ el, value, set(id) }`
- `card({ image | swatch | icon, title, subtitle, price (number → «12 990 kr»), priceOld, badges: ['Tekst' | { text, tone }],
  selected, onClick, actions: [buttons] })` → element with `.setSelected(bool)`. Relative `img/…` paths go through assetUrl.
- `swatches(['#hex' | { hex, name }], onPick(hex), { value, size })` → element with `.set(hex)`
- `colorPicker(hex, (hex, { final }) => …, { palette: 'paints'|'walls'|'materials'|array, label, swatchRow })` →
  `{ el, value, set }` – native picker + hex field + palette swatches; use `final` for the undo step.
- `slider({ label, min, max, step, value, unit, decimals, format, onInput, onChange })` → `{ el, input, value, set }`
  (onInput while dragging → `design.update(uid, patch, { coalesce: 'dims' })`; onChange on release)
- `select({ label, options: [[v, 'Etikett']] | [{ value, label }] | ['a'], value, onChange })` → `{ el, select, value, set, setOptions }`
- `toggle({ label, value, onChange })`, `textInput({ label, value, placeholder, type, onInput, onChange })`
- `button({ label, icon, onClick, variant: 'primary'|'ghost'|'danger', size: 'sm'|'lg', title, disabled })`, `iconButton({ icon, title, onClick, active })`
- `paramEditor(schema, values, (key, value, { final, values }) => …)` → `{ el, values, set(values) }` for Def.params /
  elementEditor schemas (`number` → slider, `enum` → select, `bool` → toggle, `color` → colorPicker, `text` → field).
- `confirmDialog({ title, text, okLabel = 'OK', cancelLabel = 'Avbryt', danger })` → `Promise<boolean>` (ui/Dialog.js)
- Keyboard: every panel stops keydown from leaving it while a form field inside has focus (`captureKeys`), so W/R/
  Delete/K… do not fire while typing or dragging a slider with the arrows; Esc in a field blurs it.
- CSS: `.ip-*` classes in `ui/panels.css`, built on the ui.css variables. **No backdrop-filter on anything that stays
  on screen** (it re-blurs the WebGL canvas every frame). Layers: HUD 5, toolbar 7, panels 8+, centre panels 25,
  pause 30, dialogs 40.

---------------------------------------------------------------------------------------------------------------

## 9. Small print

- `shot.mjs` prints `THREE.WebGLProgram: Program Info Log … X4122` warnings – that is ANGLE/D3D11 compiling three's
  own shaders (any material, also the scaffold) – harmless. Production builds set `renderer.debug.checkShaderErrors =
  false`, so users never see them.
- Texture generation at load ≈ 1 s for the ~15 kinds in the original design (all 41 kinds ≈ 3 s); textures of other
  kinds are made on first use (a short hitch when e.g. the first walnut product is placed) – call
  `prepareMaterials(kinds)` before showing a big gallery.
- Measured (RTX 2060, headless, «middels», original room): 56 fps (vsync-bound), ~140 draw calls in the game view,
  ~34 k triangles, 3–8 active point/spot lights.
