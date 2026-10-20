# TABLES – notes for the integrator

`src/models/tables.js` replaces the stub (same export `archetypes`, same ids, same Def fields). Also exported:
`ribPanelGeometry(w, h, { pitch, depth, t, seg })` – reeded/fluted panel geometry (WALLS may reuse it for slats or a
floating sideboard element).

## What the builders read

| Archetype | Params used (besides dims) |
| --- | --- |
| coffee-table-rect | `topT`/`topThickness`, `frame` tube-box (box frame + bottom rectangle on the floor, the TV-stue table) / legs / sled, `tubeW`, `overhang` |
| coffee-table-round-nesting, side-table-nesting | `tables: [{ d, h, offset? }]`, `topT`/`topThickness`, `frame` ring (edge band + floor ring, the settbord) / legs (slim splayed rods), `legCount`, `legAngle` |
| dining-table-oval | `shape` stadium/oval/round/rect, `legs` a-frame/four/pedestal, `legInset`, `edge` bevel/straight, `leaves` (extension leaves → seams; default 2, matches 082909), `topT` |
| side-table-round | `base` pedestal / sculptural-pedestal / hourglass / tripod, `topD`, `waistD`, `baseD`, `topT`/`topThickness` |
| side-table-c | `topT`/`topThickness`, `tubeW`, `baseW`, `baseD` (C opens toward +z) |
| sideboard, tv-bench | all of skjenk.json: `base` legs/plinth/wall/none, `legH`, `legStyle` metal-thin/wood-taper/block/metal-frame, `legFrame`, `fronts` (per column: door/glass/open/drawer/drawersN), `doors` (resizes `fronts`), `drawerRow`, `drawerH`, `frontStyle` flat/ribbed/slatted/cane/glass/framed, `frontPattern` herringbone, `frontFit` inset/overlay, `handle` none/bar/cutout/knob, `handleLen`, `top` same/marble, `topT`, `corners` square/rounded, `cornerR`, `roundedEndsToFloor`, `slidingDoors`, `mountHeight`, `glassPattern` fluted/clear, `ribPitch` |
| wall-shelf | `style` grid (uprights/bars/boards in metres, x from the middle, y from the bottom – scaled to dims) / simple (`shelves`), `boardDepth`, `barW` |

- `base: 'wall'` floats: the model's bottom is at `mountHeight` (the catalogue keeps `mount: 'floor'`, so the origin
  stays on the floor), and `userData.model.colliders` covers only the cabinet.
- Every model has `userData.model.surfaces` (each shelf board of the wall shelf is its own surface) and a
  `recolor(part, hex, kind)`: simple parts are swapped in place; parts with derived materials (dining top chamfer,
  ribbed/slatted/cane/glass/herringbone fronts, a wood↔metal handle change …) return `false` → SceneSync rebuilds.
- Catalogue nesting sets without offsets (Duett): dims = the largest table; the lower table is pulled out just far
  enough (≈ 0.25 m) to pass between the legs of the upper one, so the visible set is wider than `dims` by design.

## Please fix elsewhere (I could not)

1. **catalog/index.js – `paramsOverride` is ignored.** skjenk.json variants carry `paramsOverride` (BESTÅ:
   Lappviken/Hedeviken → `frontStyle: 'flat'`, Studsviken → `'cane'`), but `productToItemSpec` merges only
   `v.params`. Please merge `{ ...p.params, ...v.params, ...v.paramsOverride }`. Until then the model infers `cane`
   from a rattan front and `glass` from a glass front kind, but Lappviken/Hedeviken still render ribbed.
2. **Floor items on rugs are buried.** Rugs are 1.5–2 cm thick (f-teppe-stue 0.02, f-teppe-tv 0.015) and the tables
   stand at y = 0, so the settbord floor rings (12 mm rod) and the TV coffee table's bottom frame (20 mm tube)
   disappear in the rug, while the photos (082806, 082809, 082726) show them on top of it. Placement/SceneSync (or
   existing.js) should lift floor items whose footprint is on a rug by the rug's thickness, or the rug model should
   keep its walkable top low.
3. **f-sofabord-tv top material.** room-spec says «antrasitt betong-/keramikkpreget plate», but the data uses
   `marble-dark`, whose texture has bright white veins (`.shots/tables/sandbox-coffee.png`). `travertine` in the same
   #4a4746 gives the matt mottled slab of the photo (`.shots/tables/top-materials.png`).
4. **Nola corner radius is an assumption.** «Oval skjenk / avrundede ender»: for `corners: 'rounded'` with
   `slidingDoors` (or `roundedEndsToFloor`, Honey) I use fully round ends (`cornerR = d/2`); otherwise 0.04. I did not
   download the product images (downloads need the user's go-ahead), so please compare with `imageUrl` and set
   `params.cornerR` in skjenk.json if the real ends are tighter.
5. The dining A-frames are at `legInset` 0.40 (room-spec). Against 082909 the near feet look ≈ 0.1–0.15 m closer to
   the end, but that is within the photo camera's ±0.2 m – re-measure if it matters.
