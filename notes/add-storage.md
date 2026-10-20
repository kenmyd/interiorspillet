# add-storage – archetype «display-cabinet» (vitrineskap) in `src/models/tables.js`

Owner «storage». Dev server 5313, scripts and screenshots in `.shots/add-storage/`. Only `src/models/tables.js` was
changed (new builder + Def; `def()` takes an optional `info` fallback for archetypes not in `archetypes.json` – unused now
that add-catalog added `display-cabinet` there).

## What the builder does

`buildDisplayCabinet(spec)` – Def `display-cabinet` (label/mount/parts from `archetypes.json`: storage family, mount floor,
parts body/front/top/legs/handle), `dimsRange` w 0.4–2.0, d 0.28–0.6, h 0.4–2.3.

| Param | Effect |
| --- | --- |
| `base` legs / plinth / wall / none | `wall` = ARCHITECTURE §5 wall origin (back centre at z = 0, y = vertical middle, overlay door under a full-depth top – BESTÅ). When `spec.mount` is a string it wins over `base` (see FOUNDATION below). |
| `legStyle`, `legH`, `legFrame`, `tubeW` | `wood-taper`: chamfered skirt + round splayed legs (Sagene), or with `legFrame` (default: w ≥ 1.05) an apron + square splayed legs (Belfort); `metal-frame` ≥ 15 cm: square-tube stand – frame under the cabinet, corner legs, floor rails at the sides and back (Signature 1860); `block`, `metal-thin`; plinth recessed (Scandi) |
| `doors`, `doorLayout` side-by-side / stacked, `splitAt` | stacked: doors/2 columns × 2 rows with a fixed shelf behind the meeting rails |
| `doorStyle` glass-framed / glass-full / glass-ribbed / glass-smoked, `frameW`, `glassColor` | thin frames in the front material (wood 4 cm with a glazing bead, metal 1.3 cm untextured), clear glass = `glass-clear` (opacity 0.14, env reflection), frameless toughened glass with green edges + hinge plates, fluted glass (`ribPanelGeometry`), smoked glass (opacity 0.86) |
| `glassSides` | gables over the glass part become a frame with a pane |
| `shelves`, `shelfMaterial` glass / wood | total shelves: one goes into a closed lower cupboard (≥ 28 cm), one is the fixed shelf of stacked doors, wide cabinets (w > 1 m, ≥ 2 doors) get a bay per door column with the shelves split per bay, inner drawers stand on one per bay. Glass shelves 6 mm with a green front edge + chrome pins |
| `bottomHeight`, `drawers`, `drawerPosition` bottom / middle-inside, `drawerH`, `drawerAt` | closed lower part: ≥ 28 cm and drawers ≤ doors → doors side by side (Sagene: `drawers: 2` = its two lower doors), else drawers (side by side in a low band, stacked otherwise); `middle-inside` = a drawer per bay behind the glass with a finger notch (Belfort) |
| `led`, `ledK` | per section and bay an aluminium channel + glowing strip under the ceiling (a little behind the doors so the line shows through the glass), a light «wash» decal on the back and side walls of the bay, and one warm spot per strip (max 2, 50–420 lm by strip length) in `userData.model.lights` with strip + wash as `emissiveMeshes` |
| `decor` (default true) | neutral low-poly pieces on every level – standing/leaning or stacked books, bowls, vases, wine glasses, an upright plate, lidded jars – deterministic (`K.rng` per size/bay/level), sized to the free height/depth; ceramics and books are baked into one vertex-coloured mesh each, glasses merge with the door glass |
| `handle` bar / knob / cutout / none, `handleCutout`, `handleLen` | glass doors: on the stile at the opening edge (stacked: near the split); solid fronts: lip pull at the top edge (metal), wood bar, horizontal brass pull (knob), or a routed notch; `handleCutout` = routed stadium grip across the joint of stacked doors (Scandi) or vertical in the stile |
| `top` same / marble, `topT`, `corners` square / rounded, `cornerR`, `gableT`, `frontFit` | as the sideboard |

`userData.model.surfaces` = the top (wall: y = h/2, centre z = d/2); floor items use the default AABB collider (a floor
item with base 'wall' and `spec.mount` 'floor' gets a cabinet-only collider). `recolor`: colours and same-group kinds swap
in place; wood ↔ metal on front/handle/legs and stone ↔ wood on the top rebuild. ~15 meshes, 3–8 k triangles per cabinet.

## Please do elsewhere

1. **FOUNDATION (registry.mergeSpec)**: pass `spec.mount` through to the builder. `display-cabinet` already uses it when
   present (`typeof spec.mount === 'string'`); today it must infer the origin from `params.base === 'wall'`, which is right
   for every product and for the Inspector's floor ↔ wall swap (it swaps params and mount together).
2. **UI (Inspector)**: `base` is offered as legs / plinth only (moving an item between floor and wall is the swap's job).
   `base`, `legStyle`, `legH` carry `floorOnly: true` – please hide such params for `item.mount === 'wall'` (BESTÅ shows
   «Understell: Ben» today, and choosing «Sokkel» there would draw it with the floor origin).
3. **INTERACT (Placement)**: as add-catalog wrote – a wall-hung vitrine should start at `params.mountHeight + h/2`
   (BESTÅ 1.52) instead of the 1.45 default. Floor vitrines dropped on the high wall land side-on (rotation 0) – an
   auto-rotation «back to the wall» for tall storage would help.
4. **DATA (catalog)**: a `light` on the vitrines with LED (e.g. `{ colorK: 3000, lumens: 200 }`, Scandi max 6 W) so the
   Inspector gets on/off/dimmer for the LED – not verified by anyone, so I did not invent it. Optional shape params from
   the photos: Signature 1860 `frameW: 0.055`, Scandi `frameW: 0.05`, Belfort `legFrame: true` (today automatic by width).
5. **LIGHTING**: the vitrine spots are small (50–420 lm) and rarely win a slot near the high-wall spots, so the wash
   decals (same CustomBlending technique as the lamps' ceiling pools, `WASH_GAIN` 1.2 in tables.js) carry the look; tune
   `WASH_GAIN` if the LightManager's emissive levels change.
6. **Integrator / ARCHITECTURE.md §5**: add `display-cabinet` to the tables.js archetype list.

## Evidence (`.shots/add-storage/`)

- `compare-sheet.png` / `cmp-<product>.png`: product photo | `/dev/models.html?arch=display-cabinet` with the research
  params, for all five (`products.mjs`).
- `cat-vitrineskap.png`, `cat-vitrineskap-v1.png`: the category (variant 0 / 1, BESTÅ «klart glass» via paramsOverride).
- `room-final-evening-*.png`, `room-final-day-*.png`, `room-ev-v1-*.png`: all five in the sandbox against the high wall,
  BESTÅ hung on it (`room.mjs`: bounds, lights, 0 errors).
- `place-*.png` (`place.mjs`): real-mouse Placement in the game – BESTÅ on `w-hoy` (back at x 3.22, centre 1.45 m), Sagene
  on the floor, Inspector on the wall item; 0 errors.
- `variants-sheet.png` (`variants.mjs`): narrow frameless, wide fluted with 3 drawers + marble, stacked 4 doors with glass
  sides, rounded white with 4 stacked drawers, wall-hung 2-door with routed grips, no decor/LED with wood shelves.
- `recolor.mjs`: colour/kind swaps in place, legs wood → brass / dims / params rebuild, quality low/medium/high build.
- `cat-skjenk.png`: the 14 sideboards render as before (no fallback boxes).
