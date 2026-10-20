# lamps – notes for the integrator

Owner: «lamps». File: `src/models/lamps.js` (only). All 24 archetypes of ARCHITECTURE §5 are real procedural
models now; ids, Def fields and the export name are unchanged.

## What exists

- `export const archetypes` – pendant-dome (metal dome / `ribbed` fluted glass pear / `slats` veneer dome),
  pendant-globe, pendant-cylinder, pendant-linear (bar + wires, `count` LED points), pendant-multi (`layout`:
  `row` | `cluster` | `branches`, `shadeShape`: `globe` | `slatted` | `dome`), pendant-tiered (PH-style, `tiers`),
  pendant-woven (`weave`: `rattan` ribs | `bamboo` open lattice | `fabric` pleated lantern | `linen` drum with frame
  and chain), pendant-mushroom, ceiling-ring (`style`: `halo` | `crown` (glass rods, `rods`) | `arm` (kitchen) |
  `multi` (`rings: [d…]`, TV-stue)), chandelier-molecule, floor-arc (`armShape` `arc` | `angular`), floor-tripod,
  floor-pole-shade (`shadeShape` drum | cylinder | rect, `baseShape` disc | rect | cone | cylinder |
  stacked-pebbles, `poleCount`), floor-mushroom (`tiers` → tiered head), floor-uplight (`readingArm`), floor-globe,
  floor-reading, table-mushroom, table-shade (`shadeShape` drum | wavy, `baseShape` vase | cylinder | wavy-column |
  disc), table-globe (globe | fluted-bulb), table-portable, table-dome, wall-sconce (half-drum | spot), wall-arm
  (glass-mushroom | cylinder-spot). Every catalogue product in `taklampe.json` / `smalamper.json` uses its params.
- **NEW** `export function buildBuiltInFixture(l, { quality })` – model of a built-in fitting from
  `layout.builtInLights`: `pendant-cylinder` (island pendants, track adapter, drop from `dims.bottomY`) and
  `ceiling-ring` (kitchen ring on a cranked arm; TV-stue triple ring when `dims.rings` is given). Returns a Group with
  origin at the attachment point (put it at `l.position`), `userData.model.lights` local (spot down, lumens/colorK
  from `l`) and `lights[0].emissiveMeshes`; `null` for strips/spots/track. **SHELL / kitchen.js can use it instead
  of the stub boxes**: `const g = buildBuiltInFixture(l); g.position.copy(l.position); group.add(g);
  emissiveMeshes = g.userData.model.lights[0].emissiveMeshes`.

## Conventions the other modules should know

- Ceiling: origin at the ceiling, hangs along −y, `params.drop` = ceiling → lowest point. Canopies reach 12 mm up
  into the ceiling so the sloping living-room ceiling shows no gap for normal canopies.
- Catalogue pendants: while `params.drop` equals the archetype default the builder uses `params.dropDefault`;
  `params.maxDrop` (cable length) caps the drop. **Suggestion for catalog/index.js `productToItemSpec`**: set
  `params.drop ??= params.dropDefault` for ceiling lamps, so the Inspector slider shows the real value; and the
  Inspector could use `params.maxDrop` as the slider max.
- Lights: opaque domes/cylinders/tiers/saucers → `spot` along −y (angle from the shade geometry), globes,
  translucent shades and open weaves → `point` at the bulb, uplight → `spot` along +y (+ reading spot). Multi-head
  rows (≤ 4 heads) get one light per head (lumens split), clusters/branches/chandelier one light. The chandelier's
  single point light sits just **below** the shades: item lights cast no shadows, so a light inside the fixture
  floodlit its own black arms/shells.
- Glow: all glowing meshes (bulbs, LED faces, translucent shades, lit shade insides) have their own materials
  (`emissive()` / `shadeMaterial()`, `userData.baseIntensity`) and are listed in `lights[0].emissiveMeshes` (other
  lights have none). Translucent shade glow = light colour (lifted toward white) × shade colour × `params.translucent`
  (default per kind: linen/cotton 0.5, paper 0.7, opal 0.9 …), so black shades barely glow. Intensities are tuned
  for exposure ≈ 1–1.5; the LightManager stub's night exposure ×2.2 makes the openings look quite white – LIGHTING
  may want to compensate emissives for exposure.
- The glow tint uses `params.colorK` (default 2700). `item.light.colorK` is not part of the build spec; if a changed
  colour temperature should retint the shade glow, SceneSync could pass `params.colorK = item.light.colorK` (the
  light colour itself is already right through `setItemLights`).
- `userData.model.recolor = () => false`: any colour/material change rebuilds the lamp (the glows depend on the
  colours; builds are a few ms).
- Floor lamps carry `colliders` (foot/pole column + shade box) so a shade above a sofa does not block the floor.
- Wall lamps: back in z = 0, vertical middle at y = 0; plates reach 12 mm into the wall.
- Small powder-coated parts (black-metal, painted, plastic, lacquer) use `mat(kind, hex, { flat: true })` (black metal
  also `roughness: 0.62`): the orange-peel texture read as hammered metal at lamp scale.
- Cost (medium): 3–7 draw calls per lamp; 1–6 k triangles, Zuri 12 k (rattan ribs), the chandelier ≈ 16 k.

## The existing fixtures vs the photos

- **Molecule chandelier** (083006, 083012, 082809/082806): 8 shades, 4 × Ø20 + 4 × Ø13 (room-spec `shadeD`), ~3/4
  spheres (opening half-angle 42°), black matt outside, brass inside, visible bulbs, two main arms with two knuckles
  each, ball joints at the shades, Ø12 canopy, stem to the hub at 0.42 m, lowest shade at drop 0.79 m. The template was
  reconstructed from the two calibrated photos (082806 gives z/height almost orthographically, 083012 gives the rays
  → x; matched by height, ≈ 2 cm average disagreement) and checked in the sandbox through both photo cameras
  (`.shots/lamps/sb-083012b.png`, `sb-806zoom.png`). Note: the 083012 camera sees the hub ≈ 0.1 m west of the
  room-spec position, and the two photo calibrations disagree by ≈ 0.2 m at the hub – the item position in
  room-spec may be ~10 cm off (data, not changed).
- **Island pendants** (082941): black Ø7 × 30 cm cylinders on a cord from the track, recessed LED lens, narrow spot.
- **Kitchen rings** (082932): Ø40 flat LED ring (black body, opal LED face underneath) on a cranked flat arm from a Ø10
  cup, 15 cm under the ceiling.
- **TV-stue triple ring** (082726): rings Ø45/40/30 overlapping in 0.85 × 0.55, black band, gold inner face, LED
  underneath, gold hub with rods; largest toward north, smallest lowest toward the camera (east).

## Data observations (not changed – data is not mine)

- `bohus-aneta-valencia-taklampe-o45` has `tiers: 5` («estimert»); the product photo shows a cap + 3 shades – `3`
  would look right (the model renders 5 now: a stepped cone).
- `bohus-jakobsdals-liora-gulvlampe-h160` `baseD: 0.3`; the photo shows pebbles ≈ 0.16 wide – the builder caps the
  pebbles at 0.34 × shade Ø.
- `bohus-charge-oppladbar-vegglampe-h10` `d: 0.054` cannot hold its Ø8 head; the head sticks out ≈ 9 cm.
- Long bar canopies (Kelly / Daniella 0.8 m) are horizontal: hung across the slope of the living-room ceiling the
  ends show up to ≈ 6 cm gap/penetration. Rotate 90° (bar along z) or let SceneSync tilt ceiling items by the local
  ceiling slope.

## Unrelated things seen while testing (other owners)

- `seating.js`: wingback / lounge-wood / club-box builders threw `Cannot read properties of undefined (reading
  'edges')` in `cushionPiping` at one point (grey boxes).
- `/?play=1` at one point dropped the player out of the world («Du falt ut av verden») – shell/collision in progress.
