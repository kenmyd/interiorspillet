# shell – notes for the integrator

Owner of `src/home/shell.js`, `src/home/kitchen.js`, `src/home/exterior.js`. The return shapes are the ones in
ARCHITECTURE §4/§15 and notes/FOUNDATION.md §6. The signatures are unchanged: `buildShell(ctx, layout)`,
`buildKitchen(ctx, layout)` and `buildExterior(ctx, layout)`.

## What is built

| Part | Where | Notes |
| --- | --- | --- |
| Walls | shell | Every wall in `layout.walls` is extruded with its real thickness. Exterior walls have two layers: a 0.20 m room layer with SAND reveals, and a 0.10 m outer layer with dark vertical cladding that runs from a 0.30 m slab edge up under the roof. Corners are mitred along the wall chain (convex corners filled, reflex corners cut back), so there are no gaps or coplanar overlaps. Each wall has one pickable room-face mesh: `WallInfo.meshes[0]`, with `userData.pick = { kind: 'wall', wallId }`. UVs are recomputed after the mitre, so the texture is not sheared. |
| Openings | shell | Holes and notches come from `layout.walls[].openings`. Window boards sit **in** the hole with their top at `opening.sill`, so the decor on the sills stays at y = sill. Fixed windows: karm, glazing bead, gasket, and glass 4 cm into the frame. Top-hung windows (k1, k2): karm, shadow gap, a sash with a heavier bottom rail and the handle in the middle of that rail. There are also exterior metal window sills. |
| Glass | shell | `glassMaterial()` (exported) adds a Fresnel environment reflection on top of a constant, faintly green-grey transmission (CustomBlending with `blendColor`). There is no transmission pass. Panes collide, so the player cannot walk through them. `userData.pick = { kind: 'window', windowId }`. |
| Doors | shell | Both doors are `world/Door.js` instances. The Door's own steel frame and leaf meshes are replaced by our geometry on its pivot; animation, colliders and prompts are still Door's. The black hall door has a flat leaf with a routed panel groove, round roses only and a black karm lining 2 cm proud. It opens into a small, dim hall (x 1.50–3.12, z 2.32–4.53) with two closed doors. The glazed terrace door has an alu leaf, glass from 0.25 to 1.95 m and levers on both sides. It opens outward onto the terrace (verified by walking out: `.shots/shell/walk-door.png`). |
| Floor | shell | A canvas oak-plank texture is generated at load: 6 planks × 2 lengths per tile, 0.22 × 2.2 m, running along z, with random end joints and micro-bevels in the normal map. Its mean albedo is normalised to `floor.color`. |
| Skirting | shell | 7 × 1.2 cm, chamfered. It runs on every wall except openings, the tall-cabinet niche and where kitchen boxes stand against the wall. It wraps reflex corners. |
| Ceilings | shell | Built from the `layout.ceilings` polygons; the sloped one follows `heightAt`. Bulkheads are open-bottom prisms; their faces are pickable as `{ kind: 'ceiling', ceilingId: 'b-tvstue' / 'b-kjokken' }` and `setPaint` works for them. There is also a roof slab with eave and gutter, closing the shell for shadows and for the view from the terrace. It is in `pickables.ceilings` so ViewModes hides it, but it has no pick. |
| Built-in lights | shell + kitchen | LED coves (an alu profile flush with the ceiling plus an opal diffuser mesh). The four tilted spots (canopy, knuckle, can, recessed lens). The TV-stue ring lamp, the kitchen track with 3 pendants and the 2 kitchen ring lamps, all built with `registry.buildModel('pendant-cylinder' / 'ceiling-ring', …)`. The LED under the glass cabinet. |
| Fixtures | shell | Sockets (single or double by width), black-glass switch panels, smoke detectors, the sensor and the heat pump. |
| Kitchen | kitchen | See the file header. Collision is 4 boxes. `kitchen.surfaces = [{ id: 'benk'|'oy', y, box }]` are the worktops, for Placement. The worktop is its own canvas stone texture (fine light veins running along the length); materials.js `marble-dark` was too blotchy for this stone. |
| Exterior | exterior | Backdrops (see below), the terrace deck (walkable, footsteps 'tile'), railings, the stair (blocked at the top, so the player stays on the terrace), the landing, the annex, pillars, the white foundation, a rattan chair and table, and the lawn. `ctx.collision.setBounds` is widened to include the terrace. |

## Backdrops and lawn (exterior.js)

- `sor` (60 m cylinder) is always drawn. `sor-kveld` loads after `ready` and is cross-faded in the shader. The ends of
  the cylinder fade into the sky colour above the horizon and into a dark foliage tone below it, so there is no hard
  edge when looking around from the terrace.
- `ost` (kitchen, 40 m) and `nord` (TV-stue strip window, 25 m) are drawn **only through their own windows**. The
  fragment shader keeps a texel only when the ray from the camera to the texel passes through the glass rectangle of
  `win-k1/k2` (or `win-tv`). So the 40 m kitchen cylinder never hangs in front of the south view, and the north photo
  never shows above the roof from the terrace. This needs no stencil buffer (Game's renderer has none).
- The **lawn** is the south photo projected from its camera centre onto 3D ground that falls toward the river: a
  matte-painting projection. It uses the same texels and daylight uniforms as the photo, so ground and backdrop meet
  seamlessly from the centre, and the lawn has real depth for viewers elsewhere. The near rock and trees smear
  slightly when seen off-centre.
- All of these are unlit `ShaderMaterial`s without tone mapping (`colorspace_fragment` only), with `renderOrder = 1`
  so they draw after the room and early-z skips most of them. The top 10–14 % of each photo fades into the sky colour,
  which is also written to `scene.background`.

### `setDaylight(level, skyHex?)`

| level | south photo | ost/nord | sky |
| --- | --- | --- | --- |
| ≥ 0.9 | morning photo × 1.0 | × 1.0 | the photo's own top colour |
| 0.5 | morning × 0.75, starting to fade | × 0.68 | |
| 0.22 → 0 | blue-hour photo × 1.0 → × 0.16 | × 0.25 → 0.12, bluish | blue-hour top colour, darkening |

`skyHex` (optional) overrides the sky colour and tints the photos by 12 %. LIGHTING already calls it with its
exterior level and sky colour.

## For LIGHTING (§15)

- Each `builtInLights` entry is `{ id, group, label, type: 'led-strip'|'spot'|'ceiling'|'pendant', from?, to?,
  position?, direction, angle?, penumbra?, colorK, lumens, emissiveMeshes, lightType? }` in world space. These are
  emission points, not mount points: your `atMount` test sees them as new-style entries.
  - LED strips: `from`/`to` are 1.2 cm below the ceiling, at the diffuser. `led-overskap` (group `overskap`) also lists
    the glass cabinet's emissive back panel in `emissiveMeshes`; that is the «light inside the cabinet».
  - Spots: `position` is the lens inside the can's mouth, `direction` points to `aimAt`, `angle` = beamDeg/2. All four
    spots share one lens mesh and material (same group, dimmed together).
  - Lamps from the LAMPS models: there is one entry per `userData.model.lights` entry, with world position and
    direction, and lumens split by share. If a model has no lights, one fallback entry is made (pendants get
    `lightType: 'spot'`).
- Outdoors, the 3D terrace, annex and railing are lit by your physical sun, while the photos are unlit at
  `setDaylight` brightness. With the interior-adapted exposure, the sunlit deck reads almost white from the terrace
  (`.shots/shell/c2-terrace.png`). From inside you only get glimpses, so this is fine there. If you adapt the exposure
  while the camera is outside (x > 6.9), the exterior will look right.
- The emissive materials are all our own (`materials.emissive()`), so you can change `emissiveIntensity` safely.

## For LAMPS

The built-in lamps use `registry.buildModel` with these specs. Please support the params:
- TV-stue (`tak-tvstue`): `ceiling-ring`, dims `{ w: 0.85, d: 0.55, h: 0.1 }`, params `{ drop: 0.1, rings: [0.45, 0.4, 0.3],
  count: 3, style: 'rings' }`. Three overlapping black rings with warm LED inside and underneath, and a brass hub
  (colours `shade/metal #151515`, `base #c8a46a`). The current model shows one ring.
- Kitchen rings (`ring-kjokken-1/2`): `ceiling-ring`, dims `{ w: 0.4, d: 0.4, h: 0.15 }`, params `{ drop: 0.15, rings: [0.4],
  count: 1, arm: true, style: 'arm' }`. A horizontal LED ring on a bent arm from a small ceiling cup (photo 082937).
- Island pendants: `pendant-cylinder`, dims `{ w: 0.07, d: 0.07, h: 0.3 }`, params `{ drop: 0.653 }`. The drop runs from
  the track adapter at y 2.353 down to the bottom at 1.70; everything is black.

The origin is the attachment point, hanging along −y (ARCHITECTURE §5). Please put the bulbs and LEDs in
`emissiveMeshes`.

## For INTERACT (ViewModes / Selection / Placement)

- Dollhouse: ViewModes already re-cuts the merged shell meshes per wall (`_prepareCut`), so nothing is needed from
  SHELL. The merged wall meshes are in `home.roots.shell`: `shell-walls:*` holds the reveals, cladding, trim and
  interior backs.
- `WindowInfo` also has `sillBoard: { y, depth } | null`, `frameDepth`, `frameWidth`, `opening` and `group` (the frame
  meshes, pickable). For the terrace door it also has `door` (the Door). The terrace door's glass moves with the leaf.
- The window frame meshes are in `pickables.windows`, so clicking a frame selects the window. The sill boards are not.
- `kitchen.surfaces` (the worktops, `{ id, y, box }`) is not wired anywhere yet.
- The terrace door's glass is both a window pick and the Door's interaction target. E always opens and closes the door.

## Data observations (for the room-spec owner)

- **Annex orientation**: room-spec says «mønet langs x» (ridge along x). But ost.jpg shows the gable facing the
  terrace: seen from the island, the verge falls from ≈ 2.6 m over the deck at x ≈ 8.6 to ≈ 1.2 m at x ≈ 10.9.
  exterior.js therefore builds the ridge along z (east–west), with eaves ≈ 1.3 m over the deck.
- **Floor colour**: I measured the floor against the known Jotun paints in the same photos: next to the SAND reveal in
  082823, and next to the MARRAKESH TV wall in 082806. Measured that way the floor is ≈ #a59b8f, about 8 % darker and a
  touch greyer than room-spec's #b4a99c. The shell uses the room-spec value, since all colours live in room-spec;
  change it there if wanted.
- The plank direction z is right: edge-enhanced crops of 082755 (TV-stue) and 082909 (dining) both show the long
  seams running east–west.

## Verification

Comparison sheets: `.shots/shell/cmp-v6-<photo>.png`, made with `.shots/shell/compare.html?a=<photo>&b=<render>[&crop=x,y,w,h]`.
Each sheet shows the photo, the render, a 50 % overlay and the difference. The walls, openings, ceiling lines,
bulkheads, door, heat pump, sockets, switches, spots and kitchen line up in 082924 and 0_for (well-determined
cameras). The rest agree within the camera uncertainty and the photos' barrel distortion. Evening:
`.shots/shell/v5-eve-*.png`. Close-ups: `.shots/shell/c1-*.png` and `c2-*.png`.

## Known gaps

- The outside is a stage set: the terrace, annex and stair come from low-confidence room-spec data. Near objects in
  the south photo (the lichen rock, the trees west of the house) only line up from near the photo centre
  (6.1, 1.65, 10.45).
- The stair is not walkable (there is an invisible gate at the top).
- The kitchen windows' `ost` photo also contains the annex. Away from the photo centre, a grey sliver of it can show
  beside the 3D annex.
