# fix-shell (round 1) – report

Owner area: SHELL (`src/home/shell.js`, `src/home/kitchen.js`, `src/home/exterior.js`). Contracts in ARCHITECTURE §4/§15
are unchanged (`buildShell/buildKitchen/buildExterior(ctx, layout)`, same return shapes; `buildExterior` still returns
`{ group, ready, setDaylight, dispose }`). New exports from `shell.js`: `periodicNoise(seed)`, `gridSample(…)` (fast
tileable noise for the canvas textures, used by the kitchen) and `claddingMaterial(hex, quality, params)`.

Evidence: `.shots/fix-shell-r1/` – `before-*.png` (state at start), `after-*.png` / `after2-*.png` (final), and the
photo | before | after sheets `final-*.png`. No console errors on `/dev/sandbox.html` (low / medium / high) or `/?play=1`
(walk, orbit).

## Findings

| Finding | Status | What changed | Evidence |
| --- | --- | --- | --- |
| Worktop: crisp criss-crossing white lines | fixed | `kitchen.js worktopMaterial` rewritten: per-pixel domain-warped fbm (quarter-res warp/clouds/mask, half-res flow bands + wisp ridges, full-res fine fibre), warm dark base around #3b3633, wide soft lighter bands (± ≈ 20 % lightness in sRGB, p5 53 / p95 85 on 0–255), only short broken thin wisps inside the lighter bands. No stroked lines any more. | `final-worktop.png`, `after-082941.png`, `after-082950.png`, `after2-wt-close.png`, tile preview `stone6.png` |
| Terrace stair/guard too large; lawn smears | fixed (geometry from the photos, low confidence) + lighting part handed over | See «Terrace photo fit» below: the stair runs **south** along the terrace's west edge from the facade (not west along x = 9.3), 0.75 m wide with one slatted guard, level top step, landing and concrete path at y ≈ −1.72; terrace west edge z = 6.75; clad west face, white corner pier; lawn next to the house at the landing level. Ground shader: points the south photo does not cover (steeper than its bottom row / outside its azimuth range) fade to the photo's own lawn colour with a soft world-space variation instead of the clamped, streaked edge texels. Deck relief softened. The tan colour of railing/deck is the low morning sun lighting them (see «For LIGHTING»). | `final-terrace.png` (082841: photo / reviewer camera before / solved camera after; 082852: photo / v4-082843 / after), `after-082841s.png`, `after-082852s.png`, `after-082829.png` (no green streaks in win-s1/s2), `d1-noon-082841s.png`, `walk-gate2.png` |
| k2 shows the annex roof; k1 from the bench a smear | fixed | `ost` backdrop now masks (soft alpha edge, drawn blended after the opaque layers) its annex texels (u < 0.42–0.48 below its roof), its soft green lower fill (v < 0.42) and its soft west end (u > 0.78–0.84, beyond what k1 shows from the island). Through k2 the south photo (river, boathouses) shows; through k1 from the bench the sharp trees of the south photo; from the island (082950) the view is unchanged except that the 3D annex/sor show where the photo's annex was. | `final-k2.png`, `cmp-k1-f1.png` (photo / after / before), `cmp-k1-layers.png` (which layer caused the smear), `after-082950.png` |
| Black glass switch panels light blue-grey | fixed (mostly) | Glass panel = `MeshPhysicalMaterial` #08080a, roughness 0.42, `specularIntensity` 0.3, `envMapIntensity` 0.05 (the windows' env reflection and area-light highlights made it grey-blue); ordinary switches («Bryter ved døra») matt dark plastic. Sampled: before #485969, after #020b17, photo #0a090c (the slight blue cast of all near-black surfaces comes from the current lighting). | `final-switch.png`, `after2-082924.png` |
| Tall cabinets brushed-metal look; shutter without slats | fixed | Own `graphiteOakMaterial` (fine low-contrast vertical oak grain ±1.5 %, fine mottling, faint relief, roughness 0.72, env 0.45) instead of `mat('oak')`; colour = spec #55575a pulled 12 % toward a warm grey (the full 082937 photo shows a neutral grey next to the wall: #716e6f vs #b4bab1). Shutter: the tambour used to sit 2 cm **behind the carcass face** (inside the carcass box, so only the plain dark carcass showed) – moved in front of it, rounded slat profile + a painted slat map (light upper edge, dark joint) + guide channels. | `final-cabinets.png`, `after-082937.png` |
| Floor: narrow streaky strips, strong plank contrast | fixed | `shell.js floorMaterial` rewritten (ImageData): soft cathedral grain (parabolic ring iso-lines, warped), very faint fibres, plank tone ± 2 % (spec grainContrast 0.06 × 0.35), very subtle seams (22 % toward the seam colour, no light bevel line), soft half-res seam V in the normal map (normalScale 0.35), matt (roughness 0.72, env 0.6). | `final-floor-a.png`, `final-floor-b.png` (083019: photo / reviewer render / after), `after-082909.png` |
| H: green paint stops at the door frame | fixed | `shell.setPaint`: walls that continue the plane of the high wall past the hall door (derived from the layout: same line, joined end→start → `w-gang`) follow the high wall's paint while they have no colour of their own (`setPaint('w-gang', c)` still overrides, `null` returns to following). So the H `wallPaint` (#55665b on w-hoy) now also paints above and beside the door up to the corner, like the montage; the same for any proposal/user colour on the high wall. `paintOf('w-gang')` (index.js) still reports the room-spec value. | `final-H.png`, `after-H-0_for.png` |
| Exterior photos decoded/uploaded on the main thread, block the start | fixed | `ImageBitmapLoader` (decode off the main thread, `imageOrientation: 'flipY'`), `renderer.initTexture` right on arrival (upload during loading, not in the first frame): 4096×2048 upload 25–40 ms (was up to 231 ms decode+upload). «middels» uses the `lav` files for ost/nord/sor-kveld (2048×1229 / 1024×591 / 2048×1024) and the full 4096 only for the main south view; «lav» all `lav`; «høy» all full. The blue-hour photo is fetched only when the daylight first drops to ≤ 0.55 (verified: requested at 18:54, not at 08:30). `ready` waits for the day photos but never more than 2.5 s; a late photo fades in from the sky colour (0.6 s, via `onBeforeRender`). Photo VRAM on «middels» by day ≈ 59 MB (was ≈ 120 MB). | `perf.html` (`?quality=`), `prof.mjs`, `slow.mjs` → `cmp-slow.png` (5 s delayed photos: room starts with sky colour, photos fade in), numbers below |
| Cladding/floor textures generated separately (≈ 0.5 s) | fixed | One neutral-grey `woodCladding` set (shared cache key) tinted per material (`claddingMaterial`), 256×512 below «høy»: generated once for the walls and the annex/terrace face (50–78 ms instead of 172 + 180 ms). Exterior concrete at half resolution below «høy» (25–35 ms instead of 127 ms). Floor 88–119 ms (was 162). | `prof.mjs` output below |

### Timings (headless Edge, RTX 2060 S, dev server, «middels», CPU ×1; the machine was shared with other agents, best runs)

| | before (review-perf-r1) | after |
| --- | --- | --- |
| buildShell (incl. cladding + floor) | 518 ms | 211 ms (+ cladding 50 ms once) |
| buildKitchen | 80 ms | 197 ms (per-pixel worktop 70–78 ms + graphite 28 ms; the old stroked veins were cheap but wrong) |
| buildExterior (sync) | 399 ms | 210 ms |
| day photos ready after buildExterior | blocking, ≈ 0.8 s (prod) | 150–250 ms typical, capped at 2.5 s |
| largest photo upload | 231 ms (decode + upload in the first render) | 25–40 ms (ImageBitmap, during loading) |

Sum shell + kitchen + exterior ≈ 0.62 s (was ≈ 1.0 s). Under CPU ×4: shell 530, kitchen 356, exterior 362 ms.

## Terrace photo fit (exterior.js `TERRACE_FIT`)

room-spec's terrace is a sketch (`outside.confidence: 'low'`). I solved two cameras from their window frames
(`solvecam.mjs`: 082841 → pos (6.126, 1.604, 7.92), yaw 91.6°, pitch −11.35°, roll −2.2°, rms 9 px; 082852 → (6.576,
1.649, 10.729), yaw 132.0°, pitch −10.7°, roll −1.7°, rms 5 px – the backdrop centre (6.1, 1.65, 10.45) is 0.5 m too far
from the glass for that photo) and intersected picked pixels with planes (`ray.mjs`). Result (≈ ±0.15 m):
terrace SW corner at x ≈ 9.8, z ≈ 6.7–6.9 (not 7.4); the stair runs **south** along that edge from the facade under
win-s1 (top step level to x ≈ 7.62, guard level there – the long diagonal rail seen from above in 082841) down to a pale
concrete landing at y ≈ −1.72 (x 9.55–10.5); its outer guard at z ≈ 7.5; a concrete path along the guard and on along
the foundation under win-s2; the lawn beside it at about the landing's level. Projected into both photos the new model
lines up with the railing, screen, guard and landing (`final-terrace.png`).

`TERRACE_FIT` is applied only while room-spec still has the old sketch (`stair.from === [9.3, 7.4]`).

## For the room-spec owner (DATA) – please move these into `outside.terrace` (research/ + src/data/)

- `polygon`: the two vertices at z 7.4 → **6.75**; `railingLines`: `[[9.8,0],[9.8,6.75]]`, `[[7.65,6.75],[9.8,6.75]]`.
- `stair`: `from [7.62, 7.125]`, `to [9.55, 7.125]`, `width 0.75`, `topY −0.03`, `bottomY −1.72`, `guards 'outer'`,
  `guardHeight 0.85`, `landing { polygon [[9.55,6.75],[10.5,6.75],[10.5,8.1],[9.55,8.1]], y −1.72 }`,
  `path { polygon [[7.22,7.5],[9.55,7.5],[9.55,8.1],[7.22,8.1]], y −1.72 }`,
  `walk { polygon [[7.22,8.1],[8.0,8.1],[8.0,11.6],[7.22,11.6]], y −1.72 }`. The description «trapp vestover langs
  fasaden» (railing note and win-s1 `outsideView`) should read «trapp sørover langs terrassens vestkant».
- new `outside.nearGround: { y: −1.75, toX: 10.6 }` (exterior.js uses TERRACE_FIT's values until then).
Once moved, `TERRACE_FIT` / `fitTerrace` in exterior.js can be deleted (it is already a no-op when `stair.from` changes).

## For LIGHTING

- The 3D outside (deck, railing, stair, landing, annex) is lit by the low morning sun (08:30, October: sun in the ESE,
  ≈ 8° high), so it reads tan/near white; in 082841/082843/082852 the whole terrace and the near lawn are in shade (the
  sun is still behind the hills/trees to the east – only the far bank is lit). Please shade the near exterior when the
  sun is low in the east (terrain/horizon occlusion for the sun, or a lower direct-sun factor for objects outside), and
  consider the outdoor exposure note in notes/shell.md («For LIGHTING»).
- Near-black materials (the switch panel, the shutter) pick up a slight blue cast from the current fill/sky light.

## For the integrator / perf

- `createHome` still awaits `exterior.ready`; it now resolves when the day photos are in **or after 2.5 s**, whichever
  comes first, so it is safe to keep (screenshots on a normal line still get the photos). Dropping the await in
  `home/index.js` would make the start completely independent of the photos (they fade in).
- KTX2/Basis for the photos was not done (needs a transcoder + new asset files: outside this area).

## Tools in `.shots/fix-shell-r1/`

- `rshot.mjs` = `tools/shot.mjs` + a stub for `/@vite/client` (no HMR reloads while other agents save files; port 5240 by
  default; rebuild with `node .shots/fix-shell-r1/mkrshot.mjs`).
- `mk.mjs views.json prefix` → `--steps` for the sandbox (same format as review-accuracy-r1/mksteps.mjs).
- `ray.mjs` (unproject pixels / project points), `tri.mjs` (triangulate), `solvecam.mjs` (camera from known points and
  lines), `gridimg.html` (photo with a pixel grid), `overlay.html`, `crop.html`, `grid.html`.
- `perf.html?quality=…` + `prof.mjs [quality] [cpu×]` (builder timings / CPU profile), `slow.mjs delayMs mode hour`
  (delayed photos, lazy evening photo, console errors).
- `stone-test.mjs` / `floor-test.mjs` (tune the canvas generators in node, write PNG tiles).

## Not changed / known limits

- The ground under the near facade (where no photo exists) is a soft lawn colour, not grass detail.
- The blur of the south-photo projection from viewpoints far from its centre (e.g. trees seen from the kitchen) is the
  matte-painting limit; the masks above only pick the better of the two photos per direction.
- Seen with the current warm lighting the worktop and the fronts look browner than in the photos; the albedos match the
  photos' ratios to the walls.
