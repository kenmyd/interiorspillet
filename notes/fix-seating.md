# fix-seating (round 1) – report

Fixer for the module area «seating». Only `src/models/seating.js` was edited (plus this note). Evidence, test
scripts and before/after shots: `.shots/fix-seating-r1/`. The "old" renders were made in the same page and the same
light as the "new" ones, by building the item with a copy of the previous `seating.js`
(`.shots/fix-seating-r1/seating_old.js`, imports rewritten) and swapping it in (`ab-views.mjs`).

## 1. «Curved bouclé sofa (f-buet-sofa) is modelled as a boxy sofa with a tall, straight back» – FIXED

What the photos show (082806, 082819, 082823, crops in `photo-crops.png`, `photo-crops2.png`): a thick, soft pebble seat
(convex front, near-semicircular window end, bottom tucked in, a self-welt round the top edge, almost no visible base)
and one continuous back bolster lying on the seat: a low round bolster arm with a flat end disc and welt at the palm
end rolls up into the back, the back rises gently toward the window end and swells into a higher, fuller curl that
wraps forward round the window end.

`sofa-curved` was rebuilt from scratch (`buildSofaCurved`):
- Seat: one `slabGeometry` with per-corner radii (round window end concentric with the curl, softer arm end), convex
  front bow, big top/bottom radii (0.095 / 0.10), belly and dome; a welt (`slabSeam`) round the top edge; a recessed
  plinth hidden in the shadow under the tucked-in bottom. Stays inside `dims` (belly allowed for).
- Back: one `bandGeometry` along a kidney-shaped plan path (arm line → corner → back with its ends 2 cm forward of the
  middle → curl wrapping 28° past the end). The section is a circle in the arm (a lying bolster, `rBot` = radius,
  concentric flat dome end with a welt ring) and a round-topped bolster along the back (7° recline, sits down in the
  seat). Heights: curl top = `dims.h` (0.75), back middle = h − `wingRise` (0.69), arm side 0.665, bolster 0.58.
- New param `wingRise` («Vingeenden høyere enn ryggen (m)», 0–0.15) = the asymmetric high end the reviewer asked for;
  `wingEnd` mirrors it as before. The Inspector's height slider now moves the whole back (curl top = `dims.h`).
  Hidden: `curlDeg` (wrap of the curl, default 28), `legStyle`/`legH`, `frontConvex`, `backT`, `bolsterD`.
- `params.backH` is no longer used (it put the wing 3 cm above `dims.h`, and the calibrated 082806 overlay shows the
  real curl top at ≈ dims.h). `home/existing.js` still sets `out.backH = 0.78` – harmless, FOUNDATION can drop it.
- Shared helpers (backward compatible): `rrOutline` takes [left, right] radii (and never produces negative straight
  sides), `samplePath` takes [start, end] end lengths, `bandGeometry` takes function `rTop`/`rBot`, `startCap`/`endCap`
  ({ len, concentric }) and `capUV` (planar UVs on flat end discs, cylindrical on rounded ends – no texture streaks),
  `stripsGeometry` got planar/cylindrical UV modes and `uRow`. `slabGeometry`'s rim now uses the full outline ring
  for u on every ring: inset rings no longer shear the texture into streaks on rounded seat edges (all slab seats).

Evidence: `final-overlay-082806.png` (calibrated photo camera 082806: photo | render | 50 % blend – silhouette, curl
and pebble seat now line up) vs `final-overlay-082806-old.png`; `cmp-sofa-top.png` (old | new top view: bean plan,
round window end, convex front, curl, bolster); `cmp-082823.png`, `cmp-082819.png` (old | new, same light);
model close-ups `m1-*.png`, `m4-wingzoom.png`, `m4-armzoom.png`, low quality `m6low-*.png`, mirrored / resized /
legged variants `m5-mirror.png`, `m5-variant.png`; the throw still drapes over the bolster (`cmp-throw.png`).
Checks: `check2.json` (all 12 seating archetypes × dims-range ends × low/medium/high + curved-sofa param variants:
201 builds, 0 errors, 0 NaN; curved sofa inside its dims in every case, ≤ 2 mm below the floor only for splayed wood
legs as every legged model). Triangles: curved sofa 7.1k / 13k / 17.5k (low / medium / high), 3 draw calls.

## 2. «Corner sofa piping outlines too prominent» – FIXED

Cause: the contrast cord was 9 mm thick and used the flat (untextured, sheen-less) material, which shades much darker
than the textured bouclé/woven fabric with sheen beside it – a dark outline round every cushion, arm and base.
Fix in `seating.js`: the box-sofa piping cord radius 4.5 → 3.2 mm (6.4 mm cord), and a contrast piping (part `piping`,
only when the item has `colors.piping`) now uses the same textured fabric material as the cover (with sheen), so it
reads as a slightly darker cord like in 082736 / 082726 / 082827. The colour itself is the item's own `#55514c`
(unchanged – the user's piping colour stays exact; self-welts in the upholstery colour stay flat). In-place recolour
via SceneSync keeps the textured material (checked in the game, see below).

Evidence: `cmp-082736.png` (old | new | photo), `cmp-lsofa-near.png` (old | new close), `cmp-082726.png`,
`pipe-cmp-far.png` / `pipe-cmp-AB.png` / `pipe-cmp-CD.png` (material variants that were tried).
If the data owner wants even less contrast, a lighter `f-hjornesofa.colors.piping` in room-spec is a data change.

## In-game check (`flow-seating.mjs`, BASE=http://127.0.0.1:5242)

Inspector for «Buet sofa» lists «Vingeenden høyere enn ryggen», «Høy vingeende», «Armlenehøyde» (no old «Rygghøyde i
vingeenden»; `g1-inspector-sofa.png`); `wingRise` 0.12 rebuilds without fallback; piping recolour of the corner sofa
→ `woven #e8e2d6`, textured, not flat; undo restores both; console errors: none.

## Not mine / seen while testing

- Other modules were being edited at the same time: the dev page hot-reloaded often and `home/lighting.js` was briefly
  broken (`FLOOR_CLUTTER is not defined`); the warm light in the later shots comes from there, not from seating.
- Pre-existing, small: `sofa-modular-l` at the smallest depth of its dimsRange (d 1.4) reaches 2 cm past `dims.d`.
