# fix-decor – round 1 (reviewer findings for `src/models/decor.js`)

Only `src/models/decor.js` was edited. Tests, scripts and screenshots: `.shots/fix-decor-r1/`.

| Finding | Status | Evidence |
| --- | --- | --- |
| Kitchen waste bin is round; the real one is a rectangular stainless pedal bin | **fixed** | `bin-before-082950.png` / `bin-after-082950.png` (photo-camera view of photo 082950), close-ups `bin-before-close*.png` / `bin-after-close*.png`, `bin-rect-gallery.png`, `bin-round-variant.png` |
| Artificial palms are much wider than their catalogue footprint | **fixed** | `plants-after.png` (front / ¾ / top with the catalogue box drawn in red; before = `.shots/review-catalog-r1/v-misc.png`), `ig-bananplante.png` + in-game bounds below, fuzz test |
| Decor models generate large canvases and read them back during loading | **partly fixed** (see «Perf» – the remaining cost is a one-time GPU/canvas warm-up that does not belong to the readback) | A/B numbers below; `atlas-512.png` vs `atlas-1024.png` |

## 1. Pedal bin (f-avfallsbotte)

- `basket` with `shape: 'pedal-bin'` now builds `buildPedalBinRect`: black plastic plinth with the pedal in front, brushed
  steel body (`materials.body`, vertical grain) with rounded vertical corners, black lid with bevelled top edge and a
  hinge block at the back, thin shadow line under the lid. Everything inside `dims` (the pedal is part of `d`; the
  body is set back by the pedal depth). `params.lidColor` (room-spec `colors.lid`, mapped by existing.js) colours lid,
  plinth and pedal.
- The old round bin is kept as `shape: 'pedal-bin-round'`. Inspector «Form»: «Pedalbøtte (firkantet)» /
  «Pedalbøtte (rund)».
- No change needed elsewhere: `home/existing.js` already sends `shape: 'pedal-bin'` for f-avfallsbotte, so the room
  bin is rectangular now (0.300 × 0.292 × 0.45 m world box at dims 0.30 × 0.28 × 0.45 – the 1.2 cm over d is the
  lid bevel/hinge rounding).

## 2. Plants fitted into the catalogue footprint

`fitPlant` has a footprint mode (`c.box = { hw: w/2, hd: d/2 }`), used whenever the plant has no `params.spread` wider
than its footprint (all catalogue plants):
1. the plant is turned about its stem to the angle (12 over a half turn) whose reach fits the footprint best (another
   angle must beat 0° by 3 % so a plant does not spin while its size slider is dragged);
2. x and z are scaled separately so the outermost leaf ends at ±w/2 and ±d/2 (horizontal scale limited to 0.45–1.25 ×
   the vertical one, so absurd 10 : 1 slider footprints keep plant proportions instead of becoming a flat card).

Squeezing a wide crown flat looks wrong for palms (leaflets get short, fronds stand like brooms), so palm/kentia,
strelitzia and monstera read `c.open` (0.15–1): canes / petioles stand up and fronds arch less. `narrowPlant` finds
the openness with one guess and one secant step (the same seed is rebuilt, ≤ 2 extra builds: palm ≈ +15 ms, others
≈ +5 ms) so the final fit only has ~15 % left to correct. Room plants with an explicit spread (f-palme 1.2 m on a
0.30 m pot, f-plante-sokkel, f-plante-stativ) keep the old radial fit unchanged (`sb-082806.png` = same palm as
`.shots/decor/sb-082806.png`).

World footprint (x × z, m) before → after (`measure-page.js`, catalogue variant 0):

| Product | dims w × d | before | after |
| --- | --- | --- | --- |
| Bergspalme H140 | 0.70 × 0.70 | 1.134 × 1.095 | 0.685 × 0.689 |
| Bananplante H150 | 0.80 × 0.80 | 1.143 × 1.423 | 0.728 × 0.703 |
| Fiolficus H150 | 0.50 × 0.50 | 0.606 × 0.557 | 0.425 × 0.496 |
| Verde monstera H64 | 0.85 × 0.76 | 0.967 × 0.849 | 0.849 × 0.732 |
| Oliven H120 | 0.55 × 0.55 | 0.499 × 0.403 | 0.525 × 0.518 |

In the game (`ingame-plants.js`, placed at (3.8, 0, 9.8) like the reviewer's `ig-wall-smatt-skjenk.json`,
`SceneSync.objectBounds`): Bananplante x 3.47–4.20, z 9.40–10.10 (was 3.25–4.39 / 9.03–10.46); Bergspalme
3.47–4.15 / 9.45–10.14 (was 3.22–4.35 / 9.26–10.36); Fiolficus 3.55–3.98 / 9.55–10.05 (was 3.44–4.04 / 9.52–10.08);
Oliven 3.55–4.08 / 9.56–10.08; Monstera 3.38–4.23 / 9.42–10.15 – all inside dims around (3.8, 9.8). Ficus/monstera are a little under their box on one side
(the crown is not symmetric about the stem; the fit is symmetric about the pot so the origin stays the pot centre).

Fuzz (`fuzz-page.js`): 2660 builds (every decor archetype × every enum option × min/max of every number param × 5
dims sets × low/medium/high, plus every smatt/akustikk product variant): no fallback boxes, no NaN vertices, no console
errors. Every fitted species keeps its leaves inside the footprint (≤ 1.02 × half-width) for all footprints up to
2 : 1 aspect; only extreme slider footprints (0.2 × 2 m) hit the 0.45 limit by design.

## 3. Perf (canvases during loading)

What the profile's «borderColor 279 ms self» is: Canvas 2D records draw calls and rasterises them on the first
readback, so the whole first painting (misty-trees: ~6 000 brush strokes, 6 blurred layers) was charged to the
border-strip `getImageData`. Measured here (headless Edge, RTX 2060S, a machine shared with other agents – noisy):

- **Border colour** no longer reads the full-size canvas: the motif is filtered down to 32 × 32 and only the outer
  ring of that is averaged (4 KB read). Edge colours stay within ±2 levels of the old strip average for every motif
  (e.g. misty-trees `#cdd1ce` vs `#d1d5d2`, photo `#8b9499` vs `#899398`). The motif canvas is no longer created with
  `willReadFrequently` (it was CPU-backed only for that readback), so painting and blurs run on the GPU canvas.
  Steady state (six motifs, painting + edge colour + texture upload with `gl.finish`, medians of 3 rounds, two
  runs): old 123 / 209 ms, new 117 / 155 ms.
- **Not removable here:** the first painting of a page still costs ≈ 350–450 ms cold, old and new alike (cold
  misty-trees old 373–784 ms, new 365–442 ms). It is a one-time GPU/canvas warm-up: the first accelerated canvas op of
  a page costs ≈ 100–140 ms and every new blur kernel ≈ 25–35 ms (`blur-probe.js`, `layer-probe.js`); the second
  misty-trees painting costs ≈ 25–50 ms. Real browsers keep these compiled programs in the GPU disk cache between
  visits; the headless runs always start with an empty profile. Quantising the blur radii did not measurably help.
- **Leaf atlas** (1024², 4 layers): the normal-map loop no longer goes through a clamping closure + `Math.hypot`
  per texel, and the mip coverage search uses one alpha histogram per cell (O(1) per bisection step instead of a
  pass over the cell). A/B in the same page (`atlas-ab2.js`, 6 alternating builds): median 221 → 174 ms, best
  183 → 122 ms. The canvases stay CPU-backed (`willReadFrequently`): with GPU canvases the 4 full readbacks cost the
  same and the first one adds the ~300 ms warm-up.
- **512² atlas on «middels» – not done on purpose:** at the distance you walk past a plant the 512² atlas visibly
  blurs the veins and the hole edges of a monstera leaf (`atlas-512.png` vs `atlas-1024.png`, same camera). It would
  save ≈ 60–80 ms once per page load. «Lav» already uses 512². If the integrator wants it anyway it is one line:
  `atlasRes` in decor.js.
- **IndexedDB cache / worker – not done:** the builder contract (ARCHITECTURE §5) is synchronous
  (`build(spec) → Group`), and both IndexedDB and an OffscreenCanvas worker are asynchronous; a deferred painting would
  need a placeholder texture plus a later swap (and the screenshot tools would catch the placeholder). Worth it only
  if load time becomes a real problem.

Whole-game load after the fix (`load.mjs`, menu path, machine under load from other agents, not comparable with the
review numbers): `load-menu-after.txt`, `load-direct-after.txt`, no console errors. Of 13 menu-path runs (load.mjs + crashprobe.mjs), 5 reached
«Klar» with 0 console errors; the others ended in «Target crashed» (4) or «Execution context was destroyed … navigation» (4)
(Vite full reloads – every dev server watches the same tree while the other fixers save files). The machine had
3.8 GB RAM free with ~25 Edge/node processes of the other fixers; the direct `?play=1` runs, every in-game shot and the
2660-build fuzz page (hundreds of motif canvases created and evicted) never crashed. I could not attribute the crashes
to decor; if the integrator sees «Target crashed» on a quiet machine, the first thing to try is putting
`{ willReadFrequently: true }` back on the motif canvas in `motifArt` (one line; borderColor works with both).

## Files in `.shots/fix-decor-r1/`

- `measure-page.js` (plant footprints), `views.mjs` + `lib.mjs` (view sheets with the catalogue box in red),
  `ingame-plants.js` (in-game bounds), `room-plants-ab.js`, `fuzz-page.js`
- `steps-bin-before.json` / `steps-bin-after.json` (sandbox views of the bin)
- perf: `bench-page.js`, `art-ab.js`, `atlas-ab2.js` (A/B against `old-decor.js` = decor.js before the perf changes,
  `new-decor.js` = after), `canvas-probe.js`, `blur-probe.js`, `layer-probe.js`, `load.mjs` + `plib.mjs`,
  `crashprobe.mjs`
