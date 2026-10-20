# fix-lamps – round 1 (fixer for «lamps»)

File changed: `src/models/lamps.js` only. Evidence: `.shots/fix-lamps-r1/`. Test server: port 5244 started with
`.shots/fix-lamps-r1/vite.nohmr.config.mjs` (the project config without HMR – other fixers' edits kept reloading the
pages mid-screenshot). Contracts of ARCHITECTURE §5 unchanged (ids, Def fields, `userData.model`).

## 1. Molecule chandelier: ceiling light, amber glow, shade size

**Fixed (light, glow) / data change needed (shade size).**

- **Why the glow was white:** the LightManager writes `emissive = light colour × white balance` into every lamp glow
  material whenever it recomputes, so the hue lamps.js baked into `emissive` (brass × 2700 K) never reached the screen;
  on top of that the chandelier's insides were bright enough for AgX to wash them to cream. Now every glow material
  of a lamp carries its surface hue in a shader multiplier (`lampGlowTint`, luminance 1, one shared program key
  `lamp-glow-tint-v1`, only for visibly non-white surfaces) and bulbs/LED faces keep part of their colour temperature
  (`BULB_WARMTH`). The base `emissive` keeps the rest, so pages without a LightManager look as before. Chandelier
  insides 0.32 → 0.10, bulbs 4.5 → 1.0 with warmth 0.6.
  Result: `final-crop-083012.png` (photo | before | now | now with Ø16/Ø10.5), `zoom-after7.png`.
- **Ceiling pools:** the two shades with most light above the horizon (K1 opening up, the west K3 shade sideways –
  spill half-angle 60° from the brass inside) get a soft warm pool where that light meets the ceiling. First built as
  two upward spots (≈ 15 % of the flux); measured in the sandbox they get **no light slot** from a few metres away
  (`lighting._items` → `slot: false` at the 082806 camera, the pool is 6 spots on this profile), so the pools came and
  went. Now they are budget-free decals in the canopy group (they lie on the sloping ceiling, dim with the lamp,
  hidden off the room's ceiling, on Placement ghosts, for raycasts, hover outline and `objectBounds`): unlit,
  not tone-mapped, blended as `ceiling × (1 + pool)` so nothing changes outside them. Level `POOL_GAIN`.
  Evidence: `crop-pool-082806.png` (photo | auto 08:30 | evening: two pools either side of the canopy like the photo),
  `final-crop-083012.png`, `d5-chandelier-moved.png` (game, selected + dragged, pool above it, no outline on it).
- **Shade size – needs a data change (FOUNDATION, `src/data/room-spec.json` + `research/room-spec.json`,
  furniture `f-pendel-stue`):** set `params.shadeD` to `[0.16, 0.16, 0.16, 0.16, 0.105, 0.105, 0.105, 0.105]`.
  Through the 083012 camera, with the room-spec sizes, the largest shade is 0.106 of the image width (same as the reviewer
  measured) while the fixture is about 10 % *narrower* than in the photo, so against the span the shades are ≈ 20 %
  too big. With Ø16/Ø10.5 the template scaling keeps the 1.0 m span and the proportions match the photo
  (`final-crop-083012.png`, right panel; tested with `design.update` in the sandbox). The span itself may be 5–10 %
  short (check against 082806 before changing `dims.w`). The archetype default in lamps.js is now Ø16/Ø10.5, so a new
  chandelier from the archetype is right already; the existing item follows room-spec, which is not mine to change.

## 2. Bar canopies on the sloped ceiling, loose cords

**Fixed.** Ceiling lamps now follow the ceiling: the canopy is built in its own group and turned onto the local
ceiling plane (slope from `home/layout.js` `ceilingHeightAt`, one-sided differences so bulkhead edges don't count,
≤ 25°), and the off-centre cords of bar pendants (`pendant-linear` wires, `pendant-multi` row cords) are cut to the
tilted canopy's underside. The bar itself stays level. The lamp watches its own world transform (override of the
root's `updateMatrixWorld`, work only when it moved/turned), so SceneSync, Placement drags and ghosts need nothing
new. Off the room's ceiling (gallery) and for `buildBuiltInFixture` (`params.followCeiling: false`) nothing tilts.
Measured for Stakato, Kelly, Linea and Daniella at rot 0 and 90 under the 9.2° slope (`canopy-measure.json`): both
canopy ends 12.2 mm into the ceiling (= EMBED), underside 22–25 mm below it (= canopy height), every cord top exactly
at the underside. Moving Kelly sloped → kitchen (flat) → sloped resets and re-tilts. Evidence: `canopy-sheet-a.png`,
`canopy-sheet-b.png` (left of each pair rot 0, right rot 90), flow D copy (`flow-d.mjs`: place, select, drag the
chandelier – 0 errors). The default rotation of bar pendants (Placement/catalog) no longer matters for the look, so
nothing is needed from INTERACT.

## 3. Lamp models vs catalogue dimensions

Measured with `dims-test.js` (bbox of the built model):

| Product | before | now | |
| --- | --- | --- | --- |
| Charge vegglampe (8 × 5.4 × 10) | 0.080 × 0.098 × 0.070 | 0.080 × 0.054 (+12 mm into the wall) × 0.098 | **fixed**: `wall-sconce` `spot` rebuilt as a compact up/down head that fills dims – flat back on a slim magnetic plate, rounded front, ribbed diffuser underneath, glowing slot on top (75/25 % down/up spots) – `m-bohus-charge-…png` |
| Cloud pendel Ø48 | 0.400 × 0.431, lowest 1.032 | 0.480 × 0.480, lowest = drop 1.05 | **fixed**: ball centres stretched per axis so the outer balls touch w × h × d – `m-nordicnest-by-rydens-cloud-…png` |
| Turner gulvlampe | 0.40 × 0.15 | 0.40 × 0.20 | **fixed**: the rectangular foot plate takes the depth (`dims.d`, or `params.baseDepth`) – `m-bohus-sindig-turner-…png` |
| Oslo Wood gulvlampe | 0.52 × 0.45 | 0.52 × 0.45 | **not changed (by design)**: three equal legs 120° apart on the Ø60 circle (`params.baseD`, now honoured) span 0.52 × 0.45 in plan – that is tripod geometry. Retailers give a 55 cm frame diameter, so stretching the feet to a 0.60 × 0.60 box would put the front legs on a Ø82 circle. If the data owner wants the box to read true: `dims` 0.52 × 0.45 (or `baseD: 0.55`). |

## Seen while testing (other owners)

- **SceneSync (`_compile`/gate, in progress by its owner):** adding/removing some lamps in the sandbox printed
  `GL_INVALID_OPERATION: glGetProgramiv: Expected a program name…` / `GL_INVALID_VALUE … Program object expected`
  (warnings, not errors). It also happens with the glow tint switched off and not for tables; the polling of
  `p.isReady()` in `_compile` probably reaches a program already destroyed (its last material was disposed) – the
  `check()` loop guards with `!p.program`, `_compile` does not.
- **LIGHTING (in progress):** during the session the item-light pools changed to 2 point / 6 spot / 4 rect and the
  white balance got much warmer (whole room orange in auto 08:30, compare `before-083012.png` with
  `final-083012.png`). One transient `VALIDATE_STATUS false` (brass / black-metal) appeared while those edits were
  half done; it did not come back in five later runs of the same view.
- Lamps out of reach of a light slot only get ambient: true for all item spots (why the pools are decals).
