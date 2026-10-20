# interact – notes for the integrator

Owner of `src/design/Selection.js`, `src/design/Placement.js`, `src/design/ViewModes.js` and the small extension of
`src/core/Input.js`. Exported names and constructor signatures are unchanged (`new Selection(editor)`,
`new Placement(editor)`, `new ViewModes(editor)`); everything the Editor calls (handleClick, update, dispose,
start/beginDrag/isActive/cancel, mode/set/toggle/setPhotoCamera/exitPhoto/camera/pointerNDC/isWalking) works as in
FOUNDATION.md §7.

## What is there

**Selection** – hover glow (Highlight.js) + a cursor pill («Svingstol (nord) – klikk for å endre», «Den høye veggen –
klikk for forslag», «Vegg … – klikk for å endre farge», «Vindu / Terrassedør – klikk for solskjerming»); picking with
real occlusion (shell, kitchen, items; window frames count as the window; the high-wall design counts as the wall).
Left click → `editor.select(...)` (walls and windows also get `point: hit.point`, WallPanel asked for it); doors keep
working (an InteractionSystem target that is closer wins). Selected item: amber glow + a footprint gizmo on its
underlay (rug top / table top / floor under a pendant, plumb line for ceiling items), front chevron and a rotate handle
(drag it: 15° steps, Alt = free). Keys (only when `editor.keysActive()`): R / Shift+R (next 15° step), Delete /
Backspace, **Ctrl+D everywhere, D in orbit/plan/photo** (plain D strafes in walk mode – ui.md #8 asked for a decision:
this is it), arrow keys 2 cm / Shift 10 cm (view-relative, snapped to the room axes; wall items: along the wall / up-down).
A key bar above the toolbar lists the keys for the selection / placement / view.

**Placement** – ghost on the right underlay per mount (floor+rug: floor plane; wall: the wall under the cursor, wheel =
height in 5 cm (Shift 1 cm) steps, default centre heights per archetype, hint «midt 150 cm · underkant 90 cm»; ceiling:
the ceiling under the cursor in walk/photo, the point above what is under the cursor in orbit/plan; surface:
`userData.model.surfaces` with the footprint kept on the top, sills, kitchen counter, else floor; soft: any item/floor,
cushions lean against a backrest/armrest (centre at textiles.js' lean geometry, standing on the seat)). Snapping:
G = 10 cm grid (off by default), backs (or fronts) within 25 cm of a wall snap against it (rotation too, gap = the
baseboard thickness), sides into corners, wall items centre on the wall, Alt = no snapping. Items never go through
walls (pushed out, back inside). Red tint + hint when overlapping furniture, kitchen boxes, wall items or the 60 cm in
front of a door (still placeable, toast «Obs: …»); outside the room / over a window = cannot be placed. Floor
furniture whose centre is on a rug stands on the rug (tables.md #2) – for new placements, drags and nudges.
Left click places (`design.transaction('Plasser …', add)`), **Shift+click keeps placing**, right click / Esc cancels.
`beginDrag` / `beginRotate`: one undo step per drag (`design.begin/end`), Esc / right click reverts (`design.cancel`),
R rotates while dragging, the wheel lifts a dragged wall item; an undo/redo/load in the middle drops the drag.
The ghost has `userData.isGhost = true` (ui.md #5), so do the gizmos.

**ViewModes** – walk / orbit / plan / photo with 0.9 s eased flights (walk pose is the untouched game camera, so coming
back lands where you left). Orbit: OrbitControls (right drag turns, Shift+right / middle pans on the floor plane, wheel
zooms to the cursor, left drag on empty floor turns too, distance 2.2–24 m, polar 4–80°, pivot clamped to the room),
starts from the nearest room diagonal behind the player and frames the whole floor above the toolbar. Plan: my own
orthographic camera, north up / east right (plantegningen turned a quarter), right/middle/left-on-empty drag pans,
wheel zooms to the cursor (0.6–7×), dark wall sections, glass marks in the windows, door swings, room names with
areas, scale bar + north arrow. Photo: `setPhotoCamera(pc)` flies there (again from photo to photo), `exitPhoto()`
returns to the view before, Esc → walk (Editor). Tab cycles walk → orbit → plan → walk (Toolbar). `?view=` works.

Dollhouse: the shell merges wall bodies / cladding / lists / roof (shell.md «For INTERACT»), so ViewModes re-cuts the
shell once when the overview or plan is first shown: every triangle is sorted into its wall slab and clipped at the
wall's top line (sloped tops too), kept if inside the room (cut at the ceiling) or dropped (roof, hallway, eaves).
Copies are drawn instead of the originals; the originals stay as invisible shadow casters (colorWrite off), so the room
light does not change. Walls the camera sees from outside are cut away live (+ their windows' shading and the high-wall
design), a 24 cm stub with a dark cap marks them; all wall tops get a dark section cap. The tall/huge exterior pieces
(photo backdrop, lawn) are hidden in orbit/plan; the terrace stays. Rebuilt automatically when the shell's mesh/vertex
count changes; material swaps (repaint) are followed.

**Input** – new `setKeyClaim(fn)` (arrow keys / Ctrl+D do not walk while an item is selected) and a read-only
`pointerClient` getter. `setPointerClaim` behaviour unchanged (Selection uses it for drag-to-move in walk mode).

## Please wire up / decide

1. **Editor.raycast** does not know the overview: in orbit/plan it still hits the invisible original walls/ceilings
   and misses the cut copies. Either use `pickAt(editor, ndc, opts)` from `design/Selection.js` (real occlusion, skips
   `views.isConcealed(mesh)`, includes `views.pickRoots()`), or add those two checks to Editor.raycast.
2. **controlsHelp.js** is already close; fix: plan view pans with right drag (not «snur»); D duplicates only outside
   walk mode (Ctrl+D everywhere); add «Shift + klikk plasserer flere» (there), «Alt – fri vinkel på roteringshåndtaket»,
   «Dra roteringshåndtaket for å snu», «Venstre dra på tomt gulv snur (oversikt) / flytter (plan)».
3. **LIGHTING**: `lighting.render(renderer, scene, camera)` receives an **OrthographicCamera** in plan mode – any
   post-processing pass must cope (or skip AO there). Shadow maps are untouched by the view changes.
4. **core/Highlight.js** sizes its outline by the view distance (perspective). With the plan's ortho camera (placed
   6 m above the floor) the outline is ≈ 3 cm wide and grows in screen pixels when zoomed in; `uWidth` scaled by
   `1 / camera.zoom` for orthographic cameras would keep it constant.
5. **Existing floor items on rugs** are still at y = 0 in the original design (only moved ones are lifted): existing.js
   / room-spec could set `position[1]` = rug thickness for the settbord and the TV coffee table (tables.md #2).
6. **Toolbar** could show the active view (listen to `'view' { mode }`) – the stub only toggles.
7. Overview draw calls ≈ 390 vs ≈ 200 walking (copies + invisible casters); 56–60 fps (vsync) on the RTX 2060
   headless in all views. If a laptop struggles, the cut copies could be merged per wall across materials.

## Testing

Test pages ran on my own Vite with `server.hmr: false` (port 5193, config in my scratchpad, not in the repo) – every
save by anyone reloads HMR pages mid-test. Scripted pointer/keyboard tests (synthetic Pointer/Mouse/Keyboard events on
the canvas) with screenshots in `.shots/interact/`:
`w1-selected` → `w2-dragged` (svingstol dragged 1.00 m, one undo step «Flytt Svingstol (nord)») → `w3-rotated` (R: 15° →
30°) → `w4-undone` (Ctrl+Z ×2 back to the original), `p1-ghost`/`p2-placed` (Turner gulvlampe placed + selected),
`p3-sideboard-wall` (sideboard snapped against the TV wall, red: overlaps the TV), `k1-nudged` (3× ↑ = 6 cm, player did
not move, lifted onto the rug), `k2-rotated` (rotate handle −10° → 75°), `k3-duplicated` (Ctrl+D beside it), `k4`/`m1`/
`m2` (cushion leaning on the curved sofa), `k5-tablelamp` (on the lower nesting table), `m3-painting` (painting dragged
60 cm along the west wall, wheel +5 cm), `m4-photo` (photo camera 082909, Esc → walk), `h1`/`h3` (hover hints wall /
window), `d1-door` (door still opens with a click), `d2`–`d4` (Tab: orbit → plan → walk, back at the door),
`o1`–`o7` (orbit: select + drag in orbit, pendant above the dining table at exactly (5.37, 6.81), acoustic art on the
high wall, plan), `final-orbit`, `final-orbit-selected`, `final-plan`, `cap-tv` (dollhouse close-up).
No console errors from these modules.
