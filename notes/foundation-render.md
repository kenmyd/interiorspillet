# foundation-render – notes for the integrator

Owner of: `home/index.js`, `home/materials.js`, `models/kit.js`, `models/registry.js`, `design/SceneSync.js`,
`design/Editor.js`, `core/Game.js`, `main.js`, `ui/panelKit.js`, `ui/panels.css`, `dev/*.html`, `src/dev/*.js`,
`vite.config.js` (dev pages as build inputs) and the first versions (stubs) of shell/kitchen/exterior/lighting, the
five model files, shading, walldesigns, Placement/Selection/ViewModes and the ten UI panels.
The API for colleagues is in **notes/FOUNDATION.md**.

## Verified (screenshots in `.shots/foundation-render/`)

| Shot | Shows |
| --- | --- |
| `game-play.png`, `game-spawn.png` | `/?play=1`: room, toolbar, acoustics badge «Etterklang ≈ 0,86 s», compass, room banner; no console errors |
| `game-inspect.png` | selection glow + Inspector stub; SceneSync recolour kept the object (no rebuild), dims change rebuilt it, move + 3× undo restored it |
| `game-place.png` | Placement stub: armchair on the floor, linear pendant from the sloped ceiling (y = ceilingHeightAt), art frame on the high wall (`attach { wallId: 'w-hoy', normal: [1,0,0] }`); RT60 → 0,84 s |
| `game-orbit.png`, `game-plan.png` | `&view=orbit` / `&view=plan` (ceilings hidden) |
| `sb-20261018_082909.png`, `sb-20261018_083019.png`, `sb-20261018_082806.png`, `sb-20261018_082924.png`, `sb-0_for.png` | sandbox through the photo cameras – compare with `public/img/foto/<id>.jpg`: walls, openings, sloped ceiling, bulkheads, kitchen, spots, the original furniture (block-out) all line up |
| `sb-evening.png` | `mode=evening`: spots on the high wall, LED strip, chandelier |
| `models-all.png`, `models-lenestol.png`, `model-sofa.png` | `/dev/models.html?all=1`, `?cat=lenestol`, `?arch=…&dims=&colors=&materials=` |
| `mat-*.png`, `matz-*.png` | every material kind; close-ups of bouclé, weave, knit, linen, velvet, leather … |
| `menu-continue.png`, `continue-game.png` | start screen with «Fortsett siste design» (only with a last session) and the restore |

Walk tests: from the dining area into the TV-stue past the coffee table (the L-sofa uses two colliders, not its
AABB); the high wall stops the player. `npm run build` passes (dev pages included).

## Must wire up / decide

1. **controlsHelp.js** (scaffold, not mine): add the editor keys (K V B L Tab O M I P, R / Shift+R, Delete, D,
   Ctrl+Z / Ctrl+Y, Esc = avbryt/lukk) so the HUD help and the pause menu are right.
2. **Start screen**: main.js injects «Fortsett siste design» into Menu's `.kv-start__actions` (Menu.js is scaffold).
   Semantics: «Gå inn i stua» = today's room; an unnamed previous session is first stored as a named design
   «Forrige økt (dd.mm. hh:mm)» so nothing is lost; the continue button calls `saves.restore()` (active named
   design or the autosave). If you prefer «Gå inn i stua» to continue by default, change `startMode` in main.js.
3. **Esc chain**: Game → `editor.handleEscape()` (placement → top panel → selection → back to walk) before pausing;
   while Input is disabled (orbit/plan, non-modal blocks) the Editor listens itself. Modal panels/dialogs handle Esc.
4. `renderer.debug.checkShaderErrors` is off in production builds (ANGLE prints X4122 precision warnings for three's
   own shaders on D3D11 – harmless, but noisy).

## Needs from other modules (stubs follow these; owners please keep them)

- **LIGHTING**: `setBuiltIn(groupId, null)` = back to the default for the time of day (SceneSync sends null for
  groups missing in `env.builtIn`, e.g. after undo); optional `setExposure(v)` (else SceneSync sets
  `renderer.toneMappingExposure`); optional `render(renderer, scene, camera)` (Game/sandbox use it when present).
  `setItemLights` receives `emissiveMeshes` – dim their materials (each lamp has its own: `emissive()` /
  `shadeMaterial()` return new materials). The stub exports `sunPosition()` and `kelvinToColor()` – reuse if handy.
- **SHELL**: `buildShell` also returns `update(dt, state)` (doors) and `dispose()`, `buildExterior` an optional
  `ready` promise (createHome awaits it so the first frame shows the view) and `dispose()`. createHome re-parents
  every `windows[i].anchor` into `home.roots.shading` and `highWall.anchor` into `home.roots.wall` with `attach()`
  (world transform kept). Window glass meshes need `userData.pick = { kind: 'window', windowId }`, wall room-side
  meshes `{ kind: 'wall', wallId }`, floor `{ kind: 'floor' }`, ceilings `{ kind: 'ceiling', ceilingId }`
  (Editor.raycast walks up to the first `userData.pick`). `pickables.ceilings` are hidden by ViewModes outside
  walk mode. `setPaint(id, null)` must restore the room-spec colour (also for ceiling ids).
- **INTERACT**: ViewModes must expose `camera` and `pointerNDC(target)` (Editor.activeCamera / pointerNDC) and
  feed clicks to `editor.handleClick(ndc)` when Input is blocked.
- **LAMPS**: catalogue pendants carry `params.dropDefault` / `maxDrop`, ARCHITECTURE says `params.drop` – the stub
  uses `drop ?? dropDefault`; existing items (chandelier) use `drop`.
- **SOFT**: catalogue throws have UNFOLDED dims (e.g. 1.2 × 2.0 × 0.008) while the existing throws have folded
  dims + `params.folded`; `ceiling-absorber` dims are w × d (thickness) × h (baffle height).

## Data-layer observations (not blocking)

- `Saves` has no read-only accessor for a named design; the dev pages pass a read-only storage wrapper
  (`dev.readOnlySaves`) so they never touch the user's designs.
- `layout.doors` contains both doors; the shell stub builds `door-gang` with world/Door.js (black, hinge 'to',
  opens out) and treats `door-terrasse` as fixed glazing (it is in `layout.windows` too).

## Known gaps

- All models are block-outs (correct size, colours, parts, lights) until SEATING/TABLES/LAMPS/SOFT replace them.
- The shell stub has no skirting boards, reveals' window sashes, terrace railing, kitchen/north backdrops; the
  floor uses the scaffold `woodPlain` texture (too contrasty vs the photos).
- Lighting is a stub: uncalibrated exposure, no bounce/AO, simple sun; textures of unused kinds generate on first use.
- Placement has no snapping/drag-move; ViewModes has no smooth transitions or dollhouse wall hiding; most panels
  show «Kommer snart».
