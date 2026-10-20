# textiles.js – notes for the integrator

Owner: «textiles» (SOFT). File: `src/models/textiles.js` (only file changed). Exports `archetypes = { cushion, throw,
pouf, rug }` with the same ids/Def fields as the stub (ARCHITECTURE §5), Norwegian labels from `data/archetypes.json`.

## What the builders accept

| archetype | params (Inspector schema in `Def.params`) | origin / dims |
| --- | --- | --- |
| cushion | `shape` square/lumbar/round/bolster, `texture` (fabric kind or `bobble` = popcorn), `pattern` solid/check/houndstooth/herringbone/zigzag/stripes/waffle, `patternColor`, `lean` (° to the horizontal: 90 upright, 70 leaning on a sofa back, 0 lying flat), `flange` (m), `piping` | centre of the footprint on the surface (bottom = 0). w = width, h = height, d = loft |
| throw | `drape` folded/over-arm/over-back/flat (legacy `folded` / `draped` from existing.js still work), `fringe`, `fringeColor`, `texture`, `pattern`, `patternColor`, `armH`, `armW`, `backH`, `backT`, `hang` | y = 0 is the seat; the hanging part may go below it. Over-arm: arm at local +x. Over-back: back at local −z. Catalogue: w × d = fabric, h = thickness. Room-spec throws (legacy flags + h > 2 cm): w × d × h = visible bounds |
| pouf | `shape` round/cylinder/square, `texture`, `legs` none/wood/plinth, `legHeight`, `stitchedLines`, `storage`, `piping` | parts fabric, piping, **legs** (catalogue variants colour the legs). Reports `seatY` and a top `surface` |
| rug | `shape` rect/round/oval/organic, `pile` flat/low/medium/high/shaggy, `pattern` solid/melange/border/stripes/geometric/abstract/wool-knotted/pebble, `weave` hand-tufted/handwoven/machine-woven/flatweave/braided/felted, `fringe`, `border` + `borderColor`, `accent3Color`, `seed` | dims.h = thickness. Parts base/accent/accent2 |

## Things to wire up / decide

1. **Existing cushions overlap the corner-sofa back.** room-spec positions put the leaning cushions 5–20 cm into the
   back cushions of `sofa-modular-l` (back front face z = 8.61 at the seat, leaning back 6°). With the footprint-centre
   origin (contract) and lean 70°, they touch the back at roughly these positions (existing.js or room-spec):
   - `f-pute-1` (corner, rot 45): `[0.47, 0.45, 8.83]` (today `[0.42, 0.45, 8.66]`)
   - `f-pute-2` (popcorn, rot 10): `[0.84, 0.45, 8.76]` (today `[0.78, 0.45, 8.70]`)
   - `f-pute-3` (rot 0): `[2.35, 0.45, 8.72]` (today `[2.35, 0.45, 8.66]`)
   - `f-pute-4` (rot −30, lean 60, against the arm): `[2.45, 0.45, 8.82]` (today `[2.56, 0.45, 8.76]`)
   Rule of thumb for Placement: a cushion with lean 70° should stand with its centre ≈ (T·cos20° + H·sin20°)/2 ≈ 0.15 m
   in front of the back face.
2. **existing.js, throw** `f-pledd-salvie` comes through as `draped: 'arm'` → shown over the arm (correct). Setting
   `drape: 'over-arm'` explicitly would make the Inspector's «Plassering» select show it (it shows the schema default
   «Brettet» when `drape` is missing). Same for `f-pledd-tv` → `drape: 'folded'`.
3. **Footsteps on rugs**: `collision.addSurfaceZone(box, 'rug')` for every rug item (SceneSync/home – not mine).
4. **Ambient occlusion**: cushions/throws read much puffier with AO (LIGHTING); without it the soft shading is subtle.
5. **Texture warm-up**: first use of a look generates canvases (popcorn ≈ 0.2–0.4 s, pebble rug ≈ 0.2 s, geometric rug
   pattern ≈ 0.12 s, others < 0.1 s). They happen during createHome for the original design. Nothing else needed.

## Behaviour that other modules rely on

- Recolouring: plain fabrics use cached `mat()` → SceneSync swaps materials. Relief/patterned fabrics use shared
  clones (`userData.shared`, not `cached`) → SceneSync rebuilds (cheap, textures are cached). Rugs provide
  `userData.model.recolor` and recolour in place through shader uniforms (no rebuild); a kind change or accent2 on a
  fringed rug returns false → rebuild.
- Shared textures/materials carry `userData.shared` so `kit.disposeModel` never disposes them; rug materials are per
  rug and disposed with the model. Pattern textures are LRU-cached (evicted ones are disposed and re-upload on use).
- Fringes are alpha-tested ribbons with `userData.noShadow`.
- No `Math.random`; everything is seeded from the spec.

## Verification (screenshots in `.shots/textiles/`)

- `tekstil-1.png`, `tekstil-low.png`, `tekstil-high.png` – `/dev/models.html?cat=tekstil` (all 24 products, 3 qualities)
- `teppe-1.png`, `teppe-low.png`, `teppe-high.png`, `sheet-r1.png`, `sheet-rugs.png` – `?cat=teppe` and variants
- `cmp-2.png` – photo cameras 082806 / 082827 and the TV-rug view vs photo 082736
- `cmp-soft.png`, `sheet-room3.png`, `sheet-room4.png` – corner cushions, folded throw on the chaise, sage throw
- `sheet-c2.png` – popcorn / chunky knit / bouclé cushions and the waffle-knit throw close up
