# integrator – notes

Owner: «integrator» (everything; minimal fixes inside each module's design). Tests and screenshots:
`.shots/integrator/` (`run-all.sh` runs the flow scripts a–g, `perf.mjs` / `gpu.mjs` measure, `lib.mjs` = Playwright
helpers with real mouse/keyboard events, `sample.mjs` samples colours from PNG/JPG, `greycard.mjs` puts grey cards
next to the sofa in the sandbox).

## What was changed (and why)

| File | Change |
| --- | --- |
| `core/Input.js`, `design/ViewModes.js` | `overUi(e, canvas)`: the cursor over a panel/toolbar (no button held) no longer counts as «over the 3D view» – hover pills/glow no longer showed through panels (the canvas fills the window, so the old rect test was always true). Drags that cross a panel keep going. |
| `core/Highlight.js` | `new Highlighter({ glow })` scales the surface fill; outline width is constant on screen for orthographic cameras too (plan view, interact.md #4). |
| `design/Selection.js` | selected item glow 0.22 (mostly outline) – the amber fill hid the colour the user had just picked in the Inspector. |
| `design/Placement.js` | Shift latched at pointer release: «Shift + klikk plasserer flere» failed when Shift was released before the next frame handled the click. |
| `design/SceneSync.js` | (CRLF → LF) rug items get a `'rug'` footstep zone (moved/removed with the rug; `collision.removeSurfaceZone`), wall-design lights keep `penumbra` (lighting.md #3, walls.md #3), lamps get `params.colorK = item.light.colorK` for the glow tint and rebuild when it changes (lamps.md). |
| `core/Collision.js` | `addSurfaceZone` returns a handle; new `removeSurfaceZone(zone)`. |
| `design/Editor.js` | `raycast` skips meshes the view conceals and includes `views.pickRoots()` (interact.md #1); a panel opening hides the start-up help card (it showed through panels). |
| `ui/panelKit.js` | z-index from the open stack (10–19 docked, 25–34 centre/modal) instead of an ever-growing counter (ui.md #11); `setPanelHost({ onOpen })`. |
| `ui/PhotoCompare.js`, `ui/panels.css` | `#ui-root.pc-active` while comparing: the wall panel shrinks to its proposal switcher so the montage/3D view is visible. |
| `ui/Inspector.js` | «Avstand fra tak» capped by the cable (`params.maxDrop`); ceiling items without lights (absorbers) keep `drop` in «Form og detaljer» (decor.md #1); variant pick applies `paramsOverride`. |
| `ui/ShoppingPanel.js` | the wall row wraps (long price text ran out of the panel). |
| `ui/controlsHelp.js` | «← → bla i veggforslagene» (walls.md #6, full list only). |
| `ui/Toolbar.js` | P tooltip «Ta bilde av det du ser». |
| `ui/SettingsPanel.js`, `core/Settings.js` | new `autoResolution` (default on) + `sunLatitude` / `lightWeather` defaults (lighting.md #1). |
| `core/Game.js` | tone mapping = the LightManager's (AgX, since fix-lighting r1 Khronos PBR Neutral; no double compile, lighting.md #2); **dynamic resolution** `_adaptResolution` (−15 % after 2 s under 47 fps, back up after 12 s over 57 fps, never under 55 %; `game.resolutionScale`). |
| `dev/sandbox.js` | same tone mapping as the LightManager (PBR Neutral since verify-r1). |
| `home/index.js` | `setWallQuality(level)` before the first wall build (walls.md #3). |
| `home/lighting.js` | white balance: `WB_ADAPT` 0.45 → 0.70 by day and up to `WB_ADAPT_LAMPS` 0.85 when lamps light the room (blended by lamp share of the flux). 2700 K in linear sRGB is (1, 0.42, 0.10) – with 0.45 the evening room was orange-brown and a white card next to the sofa rendered #b7a48e at dawn; the photos (082806, 083012, 0_for) are close to neutral. |
| `home/shell.js` | TV-stue triple ring: `style: 'multi'` (was 'rings' → one ring), gold inner face from `accent` (shell.md «For LAMPS»). |
| `home/existing.js` | floor items whose centre is on a rug stand on it (`liftOntoRugs`, tables.md #2 / interact.md #5); explicit `drape` for the throws (textiles.md #2). |
| `catalog/index.js` | `paramsOverride` merged (tables.md #1); pendants start at `params.drop = dropDefault` (≤ maxDrop) (lamps.md). |
| `data/room-spec.json` (+ `research/`) | TV coffee table top `travertine` (tables.md #3), cushions moved against the sofa back (textiles.md #1), floor colour #a59b8f measured against the Jotun paints (shell.md). |
| `data/catalog/lenestol.json` (+ research) | Ronda «Storm» variants `priceNok: 7999` (ui.md #13). |
| `data/catalog/taklampe.json` (+ research) | Aneta Valencia `tiers: 3` (lamps.md). |
| `package.json` | script `pack` (= `vite build && node tools/pack.mjs`); no dependencies added. |
| new | `tools/pack.mjs` (zip writer, no deps), `deploy/.htaccess`, `deploy/LES_MEG_OPPLASTING.md`, `README.md`. |

## Requests handled elsewhere / decided

- P = «Bilde» (PNG) as ARCHITECTURE §12 says; PhotoCompare is opened from the wall panel («Sammenlign med
  fotomontasjen») – walls.md #7 is therefore not done on purpose.
- interact.md #6 (toolbar shows the view): the Toolbar already shows the mode dots.
- shading.md #1: WindowPanel keeps registering shading as pickable – works, left as is.

## Still open (nice to have, not blocking)

- **DesignState**: public `swapView/exportHistory/importHistory` for Før/etter, `replace(uid, spec)` for «Bytt modell»,
  `wall.custom` so «Mine forslag» travel in saved/exported designs (ui.md #2/#3, walls.md #1). Saves `'saved'` event
  (ui.md #4).
- **LIGHTING**: `setShadingDaylight` per window from `_apply()` (shading.md #2); emissive for the sunlit-shade 3D
  exterior (lighting.md #4); a cluster of spots for the chandelier (lighting.md #5). Per-pixel cost = the 22 pooled
  lights on «middels» (see perf below) – a «middels» profile of 4/6/4 saves ≈ 25 % GPU if ever needed.
- **SHELL**: `setSkirtingGaps` behind floor-standing wall elements; paint above the hall door for montage H (walls.md #5).
- **LAMPS**: long bar canopies on the sloped ceiling (tilt by the slope or turn them along z).
- **Data**: seating param refinements (seating.md #1), Nola corner radius (tables.md #4), shading catalogue gaps
  (shading.md), product images were never downloaded (needs the user's go-ahead).

## Performance (RTX 2060 SUPER, headless Edge, ANGLE D3D11, «middels»)

| Where | fps | GPU per frame (render + 1-px readPixels) |
| --- | --- | --- |
| Walk, sitting area, day, 1280×720 | 60 (vsync) | – |
| Walk, sitting area, evening, 1280×720 | 60 (vsync) | – |
| Walk, sitting area, day / evening, 1920×1080 | 60 / 60 | 8.6 / 7.4 ms (9.2 ms with a shadow-map update) |
| Orbit / plan | 60 / 60 | 385 / 419 draw calls |

81 draw calls / 93 k triangles in the walk view – not the bottleneck. The cost is per pixel: the fixed light pools
(4 point + 10 spot + 8 rect area lights) are evaluated for every fragment: pools 4/6/4 → 6.6 ms, no pools → 3.0 ms.
Shadow maps update only on changes (autoUpdate off). On a weaker GPU the new dynamic resolution keeps the frame rate
(≈ 0.72 scale halves the pixel work).
