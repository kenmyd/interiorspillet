# add-lamps – the wooden slat pendants (Secto Design)

Owner «lamps». File changed: `src/models/lamps.js` only. Evidence and scripts: `.shots/add-lamps/` (dev server 5311,
started with `.shots/add-lamps/vite.nohmr.config.mjs` = the project config without HMR, because other developers' edits
reloaded the pages mid-test). Product photos for reference only: `.ref/lamps/secto4200*.png`, `secto4201*`,
`octo4240*`, `octo4241*`.

## What is new

- **Archetype `pendant-slatted`** («Spilelampe (tre)», mount `ceiling`, parts `shade` (strips, outside) / `inner`
  (strips, inside + rings) / `metal` (ceiling cup, socket) / `cord`). Params: `profile` 'secto' | 'octo',
  `profilePoints` [[m down from the shade top, outer Ø], …] (followed exactly; else the built-in outline of the
  family), `slats` (count at the nominal neck), `slatW`, `slatT`, `rings`, `neckD` / `neckH`, `shadeD` / `shadeH`,
  `bulbAt`, `closedTop`, `openBottom` (informational), `canopyD` / `canopyH`, `dropDefault` / `maxDrop`, `lumens`,
  `colorK`. Inspector schema: `drop` (max 2.2 m), `profile` («Form»: Kjegle (Secto) / Kolbe (Octo)), `slats`
  («Antall spiler»). Defaults = Secto 4200 in birch, drop 1.2 m.
- **Construction**: every strip is one bent strip swept along the outline (centripetal Catmull-Rom through every measured
  point; the straight neck stays straight and the strip leaves it tangentially – a Hermite bend that starts ≤ 2.5 cm
  above the measured neck end, ≈ 1 mm off that point, like the soft shoulder in the photos). Broad face outward, sides and
  end grain; constant strip width, so the strips tile the closed neck edge to edge (0.5 mm hairlines) and the gaps open
  toward the belly / rim (Secto 4200 ≈ 11 mm at the rim, Octo 4240 ≈ 3 cm at the belly). Thin plywood rings inside
  (bottom rim, neck base, under the cap), a cap that closes the top, cord grip, socket and bulb hidden in the neck, the
  tall Ø12.2 × 11.2 cm cup on the ceiling (tilts with the sloping ceiling like the other canopies) and the textile cord
  cut to the drop.
- **Scaling / switching**: the outline is scaled to `dims` (w = widest Ø, h = height); the strip width is kept (the count
  follows the neck circumference), so a bigger lamp gets more strips and «Form» on a Secto gives an Octo with the
  same strips (28 at Ø30) – and the other way round. Fewer strips from the slider get wider and still close the neck.
- **Finishes**: birch (`ash`), white / black laminate (`painted`, outer face only – the inside stays birch through the
  `inner` part), walnut veneer (`walnut`). Grain along the strip (u = length), each strip its own piece of the texture.
- **Light**: spot down from the bulb (70 % of the lumens, half-angle = the cone the neck lets out: 35° Secto, 41° Octo)
  + a point light in the belly (30 %, the soft spill between the strips). The inside glows (emissive, in
  `lights[0].emissiveMeshes`) with a per-vertex level = direct light from the bulb in the neck (distance, angle, the
  neck's shadow on the shoulder; floor 0.15 for the bounced light), hue = birch² (`SLAT_GLOW_SAT`) so it reads golden,
  not white. One new shader program (`lamp-slat-glow-v1`). The glow mesh is merged by the builder itself (kit's merge
  would drop the `lampGlow` attribute).
- **Cost** (medium): 7 meshes, ≈ 8 k triangles Secto 4200, 16 k Octo 4240 (low 6 k / 11 k, high 11 k / 24 k).

## Evidence (`.shots/add-lamps/`)

- `compare.mjs` renders each product on `/dev/models.html` from a camera calibrated to the shop photo (same rows for the
  shade's top and bottom), extracts both silhouettes row by row and inverts them through the camera back to metres.
  `compare-sheet.png`: photo | model | outline overlay (red = photo, blue = model). Mean |Δwidth| (share of the widest
  Ø): Secto 4200 1.9 %, Secto 4201 1.3 %, Octo 4240 1.9 %, Octo 4241 1.7 % with the catalogue's profilePoints; Octo
  4240 **0.7 %**, Octo 4241 **0.5 %** with the corrected points below (`*-cmp-fix.png`). The model's own Ø at every
  profile point equals the data (± 0.5 mm, measured from the geometry).
- `finishes.png` (birch, walnut, black, white – Secto 4200 and Octo 4240), `secto-joint2.png` (the neck → flare bend).
- Game, evening (`game.mjs`): each product over the dining table at (5.37, 6.81), ceiling 2.651 m, drop 1.20 m →
  underside 1.45 m = **70 cm over the table top**: `game-*-diag.png`, `game-*-side.png`, `game-*-end.png`,
  `game-side-sheet.png`, `onoff.png` (same view off | on). 60 fps, 0 console errors.
- `inspect.mjs`: selected in the game (outline, Inspector parts «Spiler / Innside spiler / Takkopp / Ledning», drop
  «120 cm», «Underkant ca. 1,45 m»), canopy tilt under the 9.2° ceiling (su −0.162), «Form» switch and 30 strips
  (`inspect-switch.png`), undo ×2 back to octo / 44. `/dev/models.html?all=1`: 65 archetypes, no fallback;
  `?cat=taklampe`: 19 products, no fallback.

## Needed elsewhere (not my files)

1. **FOUNDATION / data – `src/data/archetypes.json`**: add
   `"pendant-slatted": { "family": "lamp", "mount": "ceiling", "label": "Spilelampe (tre)" }` (lamps.js carries the
   same entry as a local fallback, `LOCAL_SCHEMA`, so nothing breaks before). ARCHITECTURE §5 «lamps.js» list: add
   `pendant-slatted`.
2. **Data – the four products** of `research/catalog-new/taklampe-secto.json` are not in `src/data/catalog/taklampe.json`
   yet (I tested them through `design.add` with the JSON's params). They need no change to build.
3. **Data – Octo profilePoints (recommended)**: the photo's lower third is wider than the catalogue's points say (rim
   Ø0.36 → 0.39, at s = 0.646: 0.417 → 0.445). Re-measured through the calibrated camera (normalised to the official
   Ø54 / Ø45; neck points kept). The archetype's own Octo outline (`SLAT_PROFILES.octo`) already uses them.
   - `christiania-belysning-secto-design-octo-4240-taklampe-o54` `params.profilePoints`:
     `[[0,0.125],[0.17,0.125],[0.187,0.131],[0.204,0.151],[0.221,0.196],[0.238,0.262],[0.255,0.313],[0.272,0.353],[0.306,0.417],[0.34,0.463],[0.374,0.497],[0.408,0.519],[0.442,0.535],[0.469,0.54],[0.51,0.539],[0.544,0.529],[0.578,0.513],[0.612,0.483],[0.646,0.445],[0.663,0.42],[0.68,0.394]]`
     (and `bottomD` 0.394)
   - `christiania-belysning-secto-design-octo-4241-small-taklampe-o45` `params.profilePoints`:
     `[[0,0.107],[0.151,0.107],[0.165,0.114],[0.179,0.135],[0.193,0.192],[0.206,0.24],[0.22,0.281],[0.248,0.338],[0.275,0.379],[0.303,0.41],[0.33,0.431],[0.358,0.445],[0.385,0.449],[0.413,0.45],[0.44,0.444],[0.468,0.43],[0.495,0.409],[0.523,0.379],[0.536,0.36],[0.55,0.339]]`
     (and `bottomD` 0.339)
   - The Secto points agree with the photos within 1–3 % – no change needed.
4. **Data (optional)**: the birch colour `#dcc6a2` reads more yellow than the photos' pale, slightly pink birch
   (≈ `#e6d6c4`); walnut / black / white look right.
5. **LIGHTING (observation)**: from the dining-area spawn (3.4, 4.4) the lamp's downlight spot gets no light slot
   (`_score` = flux / (1 + d²), the 2 free spot slots go to other lamps), so the table pool disappears from ≈ 3 m and
   comes back closer (side / diagonal / end views all had the slot). Same for every item spot (fix-lamps noted it). A
   spot whose lit floor/table is in view could score by what it lights rather than by its distance.
6. **SceneSync (old suggestion, still open)**: `params.colorK` is the glow tint; products only give `light.colorK`
   (3000 K here, also the archetype default). Passing `params.colorK = item.light.colorK` would retint the glow when the
   user changes the colour temperature.
