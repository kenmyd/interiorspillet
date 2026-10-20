# fix-textiles – round 1

Fixer for «textiles». Changed file: `src/models/textiles.js`. Evidence and scripts are in `.shots/fix-textiles-r1/`.

## Finding: TV-stue rug (cream base and simplified pattern vs a light cool-grey rug with large charcoal shapes, mid-grey blocks and a pinstripe band) – **fixed** (pattern and charcoal in textiles.js; the base colour cast belongs to lighting, see below)

### Reproduction and analysis

- The reviewer renders (`review-accuracy-r1/e2-082736/082726/082755.png`) show what they describe: two half-discs with
  flat edges along the axes, a short band of thin dark lines on a light ground, little mid-grey, and charcoal that looks
  mid-brown.
- I rectified the rug in the photos onto the rug plane to get its real layout (`img.mjs warp`, `vp.mjs`, `proj.mjs`):
  - 082726 and 082736: three visible rug corners, plus the 4th corner from the vanishing points of the coffee-table edges
    → `w726big.png`, `w736big.png` (600 px/m, grid overlays `g726.png`, `g736.png`, `g736s.png`, `g726u.png`).
  - 082806 with its calibrated room-spec camera (it puts the rug corners within 3–16 px) → `w806big.png` / `g806.png`.
  - Coordinates: u = 0…2.3 m from the north end (chaise side) to the south end, v = 0…1.6 m from the sofa side (east) to
    the TV side (west). The views agree to about 5 cm. I fitted circles to the traced outlines of the shapes.
- What the real rug has: a light cool-grey field. Two charcoal **lenses**, each the intersection of two discs and not a
  half-disc with an axis-aligned edge. The big one runs from about (0.35, 0.44) to (0.92, 1.50) and passes under the
  chaise. The small one has its tips at (1.36, 1.29) and (1.94, 0.79). A **dark band with off-white pinstripes** (2 cm
  pitch, about 35 % white) runs along the west long edge for u 0–1.05, v 1.235–1.6. A narrow band of **charcoal
  pinstripes** sits at u 1.30–1.48, v 0.10–0.85, partly under the table, with a mid-grey wedge left of it that has a
  slanted edge. There is a **mid-grey L-block** (u 1.38–2.3 × v 1.30–1.6 and u 1.97–2.3 × v 0.83–1.6), an **off-white
  block** (u 1.05–1.38 × v 1.22–1.6), a carved light block with faint ribs, and a narrow off-white binding («smal hvit
  kant»).
- **Second cause, also in textiles.js:** the rug sheen. `sheenColor` was the base colour lifted toward white and applied
  to the whole rug. So the charcoal regions got a light sheen that washed them out at grazing angles. Measured in
  082736 (charcoal / light-field luminance): photo 0.27, old render 0.49 (`#4a3e31` against `#8f7e6b`).

### Changes (`src/models/textiles.js`)

1. `rugRegionFn('geometric')` was rewritten from the traced layout above. The layout is in metres on the real 2.3 × 1.6 m
   rug and stretches with the dims. Pinstripes keep a 2 cm pitch, follow the unjittered weave position and have a slight
   hand-tufted wobble.
   - Layers: lenses (accent), wide pinstripe band (accent and accent3), narrow pinstripe band (accent on base), mid-grey
     L-block and wedge (accent2), off-white block and binding (accent3), ribbed block (accent2 at 22 % in stripes).
   - `seed` 2–4 mirror the layout, so «Variant av mønsteret» now does something for this pattern.
   - Coverage (flat-lit, `rugtop-final.png`): charcoal 27 % («about a quarter»), mid-grey 17.5 %, light 53 %, off-white 3 %.
   - The pattern map is 400 px/m (was 380): 8 px per stripe period, 4 at «low» quality.
2. `rugShader`: the sheen now follows the yarn under each fragment. It uses
   `mix(rc, 1, 0.35) × max(0.12, smoothstep(0, 0.25, luminance(rc)))`, and `material.sheenColor` is white × sheen.
   - For mid and light yarn (linear luminance ≥ 0.25) the sheen is the same as before. The catalogue rugs look the same
     (`cmp-models-teppe.png`, old `textiles/teppe-final.png` against new).
   - Dark yarn keeps only a faint sheen. Program cache key `textile-rug-2`.
   - The base recolour no longer touches `sheenColor`; the per-fragment tint uses the base uniform.
3. A doc line at the top of the file about the geometric pattern and the seed mirrors.

The contracts are unchanged: same params, parts (base/accent/accent2) and in-place recolour. Pattern generation takes
about 0.1 s at «medium», as before.

### Verification

- `cmp-top.png`: flat-lit top view of the new pattern (`rug.html`, isolated page that loads only textiles.js) beside the
  three rectified photos.
- `final-082736.png`, `final-082726.png`, `final-082755.png`: each has 4 panels. The panels are the photo, the reviewer's
  old render, the new render (auto, 8:30 on 18 October, the reviewer's camera) and the new render in day mode.
  - The charcoal lenses, the long black and white pinstripe band from the north-west corner, the narrow band under the
    table, the mid-grey L-block, the off-white block and the binding now match the photos.
  - The view along the west edge (082755) now reads light / mid-grey / off-white / stripes / lens / stripes from left to
    right, as in the photo.
- Charcoal against the light field in 082736 (auto) is now 0.28 (`#3f2c1f` against `#bca189`); the photo is 0.27.
  In day mode the charcoal is `#292727`.
- `after2-close.png` / `after2-close-low.png`: close-ups at «medium» and «low». The stripes are clean, with no moiré.
- `rug-variants.png`, `rugvar-portrait.png`: the mirrored seeds and a portrait 1.2 × 1.8 m rug.
- No console errors on `/dev/sandbox.html`, `/dev/models.html?cat=teppe` or `/?play=1`. Only the usual ANGLE X4122
  shader warnings appear.

## Not textiles: the base colour cast (for LIGHTING, optionally the data owner)

- The rug colours come from data (`room-spec` `f-teppe-tv`: main `#c4c2bf`, a neutral light grey). The shader does not
  tint them: in flat light the base renders neutral (`rugtop-final.png`).
- In the auto 8:30 render, the neutral sofa (`#707173`) gets the same warm cast as the rug.
  - Render/data ratio, sofa: R 1.02, G 0.81, B 0.64.
  - Render/data ratio, rug: R 0.90, G 0.77, B 0.66.
- In day mode (13:00 June) the rug light field renders `#9c9590`, a neutral light grey. **LIGHTING** must fix the
  white balance and warmth of the morning auto light. Then the rug will read cool grey like the sofa.
- In the photos the rug is also bluer than the sofa (082736: rug `#a4b6c8`, sofa seat `#827e82`). Much of that is the
  cool daylight on the low pile. If the rug still reads warmer than the sofa after the white-balance fix, the room-spec
  owner could shift main toward about `#c0c2c6` and accent2 toward `#8c8e92`. That is a data change, not mine.
- Small data note (optional): the calibrated 082806 view puts the coffee table's south end about 5–8 cm further south,
  relative to the rug, than room-spec has it (x 2.45). The v (z) placement matches.

## Tools left in `.shots/fix-textiles-r1/`

`img.mjs` (crop / sample / homography warp), `vp.mjs` (vanishing points → hidden corner), `proj.mjs` (projects with a
room-spec photo camera, `ROLLSIGN=-1` matches the photo), `inv.mjs`, `gridov.mjs` (10 cm grid overlay), `grid.mjs`,
`sheet.mjs`, `cover.mjs`, `mksteps.mjs` + `views*.json`, `rug.html` (isolated rug preview: `?px=&seed=&w=&d=&pile=`).

`vite.nohmr.config.mjs` is the project config with HMR off. Other fixers' edits caused full reloads that broke scripted
shots, so the server on 5245 was run with this config.
