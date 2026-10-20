# fix-shading – round 1 (reviewer findings for «shading»)

Files changed: `src/models/shading.js`, `src/ui/WindowPanel.js` (nothing else). Evidence (screenshots, scripts, JSON
output): `.shots/fix-shading-r1/` – `driver.mjs` is a persistent Edge/Playwright driver (port 5391, Vite HMR socket
blocked so other fixers' edits do not reload the page), `run.sh <script.js>` posts a script to it. Dev server 5247.

| Finding | Result |
| --- | --- |
| Choosing a window in the list does not show or highlight it | **fixed** |
| The chosen colour is thrown away when picking a product or another type | **fixed** |
| Curtain panels look like stepped translucent blocks up close | **fixed** (cause: transparency sorting, not tessellation) |
| Each quit-to-menu leaves the session in memory; shading hook bound to the first session | **fixed for shading**; the remaining retainer is core (`panelKit` host) |
| Terrace door: closed blinds stay in the doorway; the door swings through a lowered screen | **fixed** |

## 1. Window list: show and highlight the window

- The chosen window is outlined while the panel is open: a pulsing amber frame on the wall around the opening
  (`window-marker:<id>`, `userData.isHighlight`, so «Bilde» leaves it out) plus a low-glow `Highlighter` (glow 0.3)
  on the frame, the door leaf and the shading. It follows rebuilds of the shading and also shows when the window was
  clicked in 3D (before, nothing was outlined). The flash when you pick a window is still there.
- Picking a window in the list (and the new **«Vis vinduet»** button under the list):
  - walk view: if you can see the window from where you stand (samples just in front of the glass behind the reveal,
    static collision only, not edge-on, not too small/far) the camera **turns** toward it in 0.3–0.85 s, placed in
    the middle of the part of the view the panel leaves free. If not, you are **moved in front of it** (a free spot
    inside the room 1.4–3.8 m along the normal, no furniture box or wall within the capsule) behind a 0.3 s dark
    blink – no flying through walls. The turn stops as soon as you move the mouse.
  - dollhouse (orbit): the camera flies to the window from inside the room (spherical path round the pivot, so
    OrbitControls never clamps it half-way).
  - plan: the outline shows it («Vinduet er markert i planen.»).
- The list is a radio group: the radio says which window the panel edits; a separate badge (colour dot + type ·
  brand) says that the window has shading, «Ingen solskjerming» otherwise.

Evidence: `r1-c-pleated.png` (before: camera unchanged, window out of sight, empty dot), `t1-c-overlys-pleated.png`
(after: moved to the TV corner facing the overlys window, outlined, radio + «Plissé» badge), `t1-d-s2.png` (turn
only), `t1c-door.png` / `t1d-2500.png` (terrace door from the TV corner → moved to the dining table end),
`t1c-k1.png`, `t1-f-orbit-k2.png`, `t1-g-orbit-tv.png` (orbit flights), `t1b-a-clicked-window.png` (clicked in 3D),
`t1c-plan.png`. Scripts `t1.js`, `t1b.js`, `t1c.js`, `t1d.js`.

## 2. Colour kept across products and types

- The panel remembers the colour the user picked per window (variant swatch, own colour, rail swatch) for the
  session; without a remembered colour the current spec's colour counts when it is not the type's default. A change
  from outside the panel (undo/redo, load) forgets it, so the window's own spec decides again.
- **Another type**: the colour (and an explicitly chosen rail colour) goes onto the new type; a custom venetian's
  head rail follows the slats.
- **A product**: the nearest variant by CIE76 ΔE is chosen when ΔE ≤ 10 (toast «Nærmeste farge hos …» when it is
  not exact); otherwise the product is shown in the user's own colour and a toast says it may not exist at the
  store, with the nearest variant's name. The colour field then says «Egen farge – finnes kanskje ikke hos butikken».
- Picking a product also keeps the mount the user chose for blinds (so a door-leaf blind stays on the leaf).

Logged (`t2.js`, output `t2-out.json`): Gråturkis `#3e5857` → Alu-persienner 25 mm keeps `#3e5857` (nearest
Antrasitt ΔE ≈ 13, toast) instead of black `#171717`; variant Sand `#cdbf9f` → Rullegardin, Plissé, Duo, Lamell,
Gardin, Liftgardin, Screen, Persienne all `#cdbf9f`; back on Alu-persienner → its Sand variant (v3); Sand → Magna
roller → nearest variant A662 beige `#c2b49c`. Screenshots `t2-a-alu-custom.png`, `t2-c-alu-sand.png`,
`t2-d-magna.png`.

## 3. Curtains as stepped translucent plates

Reproduced in `r3-a-curtain.png` (staircase top edge, horizontal ledges, blocky stripes). Toggling showed the cause:
not the tessellation or the dithered shadow (`r3-b-noshadow.png` still stepped) but **transparency sorting** – the
linen (16 % see-through) was `transparent` with `depthWrite = false`, so within one mesh the back folds blended over
the front folds in index order, and the window glass behind (drawn later, renderOrder 2) painted its reflection on
top of the curtain. With depth writing the folds read as fabric (`r3-c-depthwrite.png`, `r3-d-…`).
Fix: `depthPrepass()` – a depth-only copy of every see-through fabric with self-overlapping folds (curtain panels,
pleats, roman folds; renderOrder −1, polygon offset, no pick/highlight/shadow), so only the front-most layer blends.
After: `t3-a-curtain-open.png` (same close view), `t3-b-curtain-closed.png`, `t3-c-sheer.png`, `t3-d-from-door.png`.
Not done: a sheen term – with the sorting fixed the folds read as fabric, and a sheen would change every calibrated
shading fabric.

## 4. Sessions kept alive after «Avslutt»

- `WindowPanel` now always (re)binds `shadingHooks.requestShadowUpdate` to its own session and clears it in
  `dispose()` (only if it is still its own hook).
- New `releaseShading(windows?)` in shading.js: removes and disposes every built shading of these windows, door
  bindings included, and – when nothing is left – clears `ACTIVE`, `_renderer`, `_lastFrame`, the daylight hint and
  manual daylight. `WindowPanel.dispose()` calls it with the home's windows (before, the rigs stayed in the
  module-level `LIVE`/`ACTIVE` sets with their window info → anchor → scene, until a later session rendered 60 s).
- Measured (`t4.js`, `t4-out.json`, CDP object counts with the query arrays released – the reviewer's counter kept
  every instance alive through the CDP result arrays, so it reads 1/2/3 regardless): at the menu after each of 3
  sessions: Game/Editor/DesignState/SceneSync/LightManager/WindowPanel **1**, Rig **0**, hook `null`; heap after GC
  42.4 → 43.5 → 44.6 MB (reviewer, old code: 42 → 50 → 53 → 54 MB).
- The one session still retained is the **latest** one, held by `ui/panelKit.js`'s module-level `host` (from
  `setPanelHost` in `Editor`): heap snapshot path `SourceTextModule → … scope.host → Object.blockInput →
  blockInput(closure).context → scope.game` (`t4-retainers.mjs`, `t4-retainers-full.txt`; no path goes through
  shading.js any more). **For core/FOUNDATION**: `Editor.dispose()` should call `setPanelHost(null)` (or panelKit
  should drop the host on dispose). In one run an `Inspector` window listener also held the session – UI area.
- Suggestion for FOUNDATION: `SceneSync.dispose()` could call `releaseShading(home.windows)` itself; the call in
  `WindowPanel.dispose()` then becomes a harmless no-op.

## 5. Terrace door

- On the terrace door (`windowInfo.door`), mount `'frame'` means **on the door leaf** («På dørbladet (følger døra)»)
  for venetian, pleated, roller and duo blinds, and it is their default there (`defaultShadingMount`; rollers/duos
  get the option via `shadingMounts`). The blind covers the leaf's glazing and beads, sits within 6 cm of the leaf
  (the lever handle is 4.6 cm out – checked in `t7b-*-handle.png`), cords/wand/chain go on the hinge side, venetian
  slats max 25 mm there. It is built in the anchor frame and hung on the leaf's pivot (matrix of the closed pose), so
  it swings with the door.
- Other blinds on the door (in the reveal, on the wall/ceiling; roman blinds) go **up by themselves** while the door
  is open (`Door.onChange`) and back down to the design's value when it has closed. Curtains and vertical blinds are
  left alone (they hang freely in front of the door).
- **Exterior screen**: the outward-opening leaf would pass through it, so `door.open` is wrapped while a screen is
  mounted: E runs the screen up (3× speed) and opens the door when it is up; it goes back down after the door has
  closed. The wrapper is removed when the screen is removed/rebuilt.
- The panel shows a line under «Montering» saying what happens when the door opens (`shadingDoorNote`).

Measured (`t5.js`, door opened with E): leaf venetian/duo/pleated bounds move with the leaf (x 7.09–7.13 closed →
7.25–7.91 open); venetian in the reveal and roller on the wall: open 0 → 1 while the door is open → back to 0 after
it closed; exterior screen: 350 ms after E the door is still shut (t = 0) and the screen at 0.71 → door opens when
the screen is up → screen down again after closing. Screenshots `t5-venetian-open.png` (blind on the open leaf),
`t5-venetian-recess-open.png`, `t5-exterior-screen-open.png`, `t5-roller-wall-open.png`, `t7-sandbox-door.png`.

## Contract notes (ARCHITECTURE §8)

- `applyShading` still returns `{ group, transmission }` and sets `anchor.userData.shading`/`shadingRig`; only a
  door-leaf blind's group is parented to the leaf pivot instead of the anchor.
- New exports: `shadingMounts`, `defaultShadingMount`, `shadingMountLabel`, `shadingDoorNote`, `releaseShading`.
- `defaultShadingSpec(archetype, windowInfo)` picks the leaf mount on the terrace door.

## For other areas

- **UI (ShoppingPanel)**: a product shown in the user's own colour still lists the variant's name; add «egen farge»
  when `spec.colors[main]` matches none of the product's variants.
- **LIGHTING**: while the door holds a blind up, `setWindowTransmission` still uses the design's value (minor).

## Regression

`t6.js`: venetian on the sofa window, closed and tilted from the panel sliders, 13:00 → striped light as in
`.shots/integrator/c4-striped-sun.png` (`t6-striped-sun.png`), `requestShadowUpdate` called at the end of each
animation (2 calls), 3 undo steps. `node tools/test-design.mjs`: 77 passed. No console errors in any run.
