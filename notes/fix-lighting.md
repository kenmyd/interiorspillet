# fix-lighting – round 1 (fixer for «lighting»)

Files changed: `src/home/lighting.js`, `src/ui/LightPanel.js` (nothing else). Tests, renders and tools:
`.shots/fix-lighting-r1/` (`rs.mjs` renders many views in ONE sandbox load, `cmp.mjs` photo | render sheets with
sample boxes, `patches.mjs` radiosity budget per patch, `skyline.mjs` horizon from the backdrops, `spotfit*.mjs` wall
pool fits, `cclen.mjs`/`cc.html` shader compile cost per light pool, `build.mjs` sandbox build time, `panel.mjs` «Lys og
sol» checks, `perf/` and `flow/` = copies of the reviewer/integrator scripts pointed at port 5241). All scripts stub
Vite's `/@vite/client` (no HMR reloads while other fixers edit files; CSS still applied). Originals for diffing:
`lighting.orig.js`, `LightPanel.orig.js`. `b-*` = renders before the fix, `z-*` = after.

## Per finding

| # | Finding | Status | What changed |
| --- | --- | --- | --- |
| 1 | Sun shines in at 08:30 / day mode moves the sun an hour | **fixed** | Terrain horizon + trees, day mode only moves a dark sun |
| 2 | 2700 K renders near-white, neutrals beige | **fixed (colour model)**, rest = lamp lumens (data) | White balance like a phone camera, PBR Neutral tone mapping |
| 3 | Lighting too flat | **partly fixed** | Window light goes down, sky/ground split, zone patches, local ambient |
| 4 | Evening mode for montages = dark brown | **partly fixed** – PhotoCompare must change (WALLS) | `PHOTO_ENV` + «Som på bildene» preset, evening WB |
| 5 | High-wall pools narrow, bullet-shaped, sharp top | **fixed** (within three.js cone limits) | Soft 32° cone, penumbra 1, aimed 0.25 m lower |
| 6 | Spots white, hard-edged, 2× too tall | **fixed** | Same + WB/tone mapping (pools amber) |
| 7 | «null» under the lamp list | **fixed** | `replaceChildren(...[…].filter(Boolean))` |
| 8 | Light pools unrolled in every shader (load time) | **fixed** | «middels» 4/10/8 (+4 shadowed) → 2/6/4 (+4 shadowed), fallbacks |
| 9 | Per-frame CPU (light uniforms) | **mostly fixed** – rest is draw calls (SHELL) | Fewer lights, static spot shadows, throttled sun shadow |
| 10 | PMREM rebuild cost | **fixed** | One reused target, ≤ 1 rebuild / 0.35 s, env 64² on «middels» |

### 1 – sun and horizon
- `HORIZON` (exported): skyline [compass azimuth°, elevation°] measured on `public/img/utsikt/sor.jpg` + `ost.jpg`
  (`skyline.mjs`): east ridge 10–12°, valley gap SSE 2.4°, far bank SW 5–6.5°. `TREES`: the trees just west of the house
  (195–248°, crowns ≈ 18°) dim the sun to 50 % instead of hiding it. `room-spec outside.horizon` / `outside.trees`
  (same format, optional) override both – the data owner can refine them.
- `sunVisibility(alt, az)` (exported, soft over the sun disc). Behind the hills: Edn = 0 (no sun light, no sun patches,
  no shadow), the window sky loses its circumsolar glow and turns bluer (9000 K – only the blue sky lights the
  windows). 18 Oct: the sun clears the ridge at ≈ 09:45 (alt 10.7°), shines through the trees in the afternoon and is gone behind the far bank at ≈ 17:25 (sunset 18:19).
- Day mode: the chosen time is kept while the sun is ≥ 1° up (behind the hills or not = daylight without direct sun);
  below 1° the sun stands as at the nearest time of the day when it is clear above the hills. Panel text updated.
- Info: `effectiveHour`, `horizonDeg`, `sunVisibility`, `sunBlocked`, `sunFiltered`; the sun line says
  «… i øst (111°) – men bak åsene, så den skinner ikke inn ennå.», «… skinner svakt inn gjennom trærne», «(som kl. 09:57)».
- Evidence (`z.json`/`i.json`): auto 08:30 → alt 2.32°, az 111.2°, `sunInRoom: false`, `blocked: true`; day 08:30 →
  effective hour 8.50 (was 09:25 / alt 8.3°), no sun; day 07:00 → 09:57 (sun 12° SE, shines in). Renders: no sun
  parallelograms in `z-auto-082827.png` / `final-082827.png` (old `b-auto-082827.png` had them), terrace railing in
  shade at 08:30 (`c-i-terrace.png`, `i-auto-082841.png`) and sunlit at noon (`i-noon-082841.png`).

### 2 – white balance and lamp colour
- White point = daylight on the surfaces + lamp light × `WB_LAMP_WEIGHT` 0.6 (blending to the lamps when there is
  no daylight), partial adaptation `WB_ADAPT` 0.55 with daylight, `WB_ADAPT_LAMPS` 0.9 with lamps alone
  (`wbcalc.mjs` checks the model against the photo pairs: daylit sand → (0.74, 1, 1.26)/G, photo (0.73, 1, 1.34);
  2700 K → (2.2, 1, 0.23)/G, photo pools ≈ (2.1, 1, 0.45)). Measured in the scene at 08:30: window light colour
  (0.72, 1.07, 1.56), lamp light (1.67, 0.83, 0.22) (`wb.json`).
- **Tone mapping AgX → Khronos PBR Neutral**, key 0.18 → 0.26 (same mid-grey brightness). AgX desaturates bright
  saturated colour toward white, so the amber pools and LED coves bleached to cream whatever the white balance
  (`c-n13-082924.png` AgX vs Neutral). Neutral also keeps the catalogue base colours true, which suits a design tool.
  `&tm=agx` still works for comparison.
- Result (`final-082924.png`): pool #ebddc8 → #fdcca4 (photo #d79460…#f6b06a), LED coves amber in
  `final-082909.png`. The daylit high wall is still beige-grey (#a39086, photo #b5c6ce) because the lamp light
  reaching it is ~40 % of its light at 08:30: see «lamp lumens» below. With photo-like lamp output it becomes
  #bcafa7 (`final-cal-082924.png`).

### 3 – flatness
- The windows' sky light goes DOWN into the room: rect lights tilted 45° (was 15°), and in the radiosity the sky part
  lands only on what lies below the glass top, the ground-reflected part only on what lies above the sill. Ceiling
  direct daylight 71 → 17 lux (`patches.mjs`).
- Floor and the living-room ceiling split per zone (kitchen / dining / sitting / TV-stue): one floor patch spread the
  kitchen and TV-stue lamps over the whole floor of the environment map. Floor clutter 0.8 → 0.75.
- Sources without a light slot no longer add flux/room-area as uniform ambient: they add what they give near the
  camera (Φ / 16π(d² + 1) × the part of their lobe facing the camera), eased.
- Ratios (sRGB, `final-082909.png`): floor/wall 0.81 → 0.62, ceiling/wall 0.79 → 0.59 (photo 0.37 / 0.45). 082924:
  ceiling/wall 0.73 → 0.64; the floor there stays ≈ 0.7 (lamp light; the photographer also shadows that floor).
  Not at the target: the remaining fill is the lamps' bounce – see below.

### 4 – evening / montages
- `PHOTO_ENV = { hour: 8.5, month: 10, day: 18, mode: 'auto' }` (exported): the light of the photos AND the montages
  (they are built on the «Før» photo of the same morning). LightPanel has a new preset chip «Som på bildene» that sets
  it. In auto at this time the TV-stue strip window shows the daylight view (no white reflection blob).
- `final-0_for.png`: montage | old evening (what PhotoCompare shows today) | auto at PHOTO_ENV | new evening. The auto
  render matches the montage far better (floor #9e9da6 vs #a1a6b1, amber pools, daylight in the windows).
- Evening mode itself: lamp-only white balance 0.85 → 0.9 (less brown); it stays a blue-hour scene by design.
- **Needs WALLS** (not my file): `PhotoCompare._photoEnv()` returns `{ mode: 'evening' }` for montages (line ≈ 392).
  Please return `{ ...PHOTO_ENV }` (`import { PHOTO_ENV } from '../home/lighting.js'`) instead.

### 5 + 6 – high-wall spots
- Fitted with `spotfit.mjs` / `spotfit2.mjs` (wall 0.33 m from the emission point): half-angle 32° (was beamDeg/2 ×
  1.3 ≈ 23° with penumbra 0.5), penumbra 1 (the falloff spans the whole cone – no hard rim), aimed at 2.0 m (was 2.25).
  Pools ≈ 1.5× wider at the same contour, blurred top, ≈ 60 % of the old peak (so they stay amber), lower edge
  ≈ 1.6 m. Spot candela now use the exact smoothstep solid angle (lumens stay lumens at any penumbra).
- Not reachable with a three.js circular cone: the 0.8 m-wide ROUND pools of the photo. A cone 0.38 m in front of the
  wall always peaks just under the ceiling (cos³ of the grazing incidence) and a wider cone runs down the wall and
  onto the floor (36–45° tried: rounder pools but warm lower wall/floor, `c-comp*.png`). A light cookie (SpotLight.map)
  that fades the lower half solved it in the fit, but four extra samplers exceed MAX_TEXTURE_IMAGE_UNITS (16) on
  textured materials – reverted.
- Evidence: `final-082924.png`, `final-0_for.png`, `final-082909.png` (soft amber pools vs old white bullets).

### 7 – «null»
- `p-*.png` / `panel.mjs`: no text node «null» in `.lp` in any state; console clean.

### 8 – light pools
- «middels»: point 2, spot 6 (the 4 high-wall spots keep shadows, so wall designs cast shadows under all four), rect 4.
  «lav»: 2/4/3, no spot shadows. «høy»: 4/10/8 (+4 shadowed) – the old «middels». Window sky light without a rect
  slot uses a soft far-field spot (86°, behind the glass); the sun-patch bounce lights are upward spots under the floor
  (no rect slots).
- Compile per lit program (`cclen.mjs`, isolated): 4/10/8/4 ≈ 1.7–2.6 s → 2/6/4/4 ≈ 0.9–1.3 s.
- Sandbox «bygget på» (`build.mjs`, cold): old pools 35.7 / 31.9 s → new 12.3 / 13.5 s.
- Game cold load (`perf/patchload-newvsold.json`): 39.0 / 35.0 s → 15.8 / 12.9 s; «Forbereder grafikken»
  20.2 / 22.6 s → 8.3 / 6.8 s.

### 9 – per-frame CPU (`perf/frameprof-new-x4.txt` vs `frameprof-old-x4.txt`, CPU ×4, same machine/run)
- walk 32 → 58 fps (JS/frame 10.6 → 3.8 ms), orbit 27 → 39 fps (32 → 17 ms), plan 30 → 38 fps (31 → 22 ms).
- Spot shadow maps are static (`shadow.autoUpdate = false`, re-rendered on `requestShadowUpdate()` or a slot change),
  so the sun moving / a blind animating (shading.js sets the global flag) re-renders only the sun's map; the sun's map
  is throttled to 10 Hz while the clock is dragged.
- What is left in orbit/plan is draw-call work (`WebGLBindingStates.needsUpdate` 14 %, 449 draws) – **SHELL/kitchen**:
  merge static meshes per material. Fewer lights in orbit/plan cannot be done without recompiling every program.

### 10 – environment / PMREM
- The env room is rendered into one `WebGLCubeRenderTarget` and `pmrem.fromCubemap(…, this._envRT)` reuses the same
  PMREM target (no allocate/dispose per rebuild). Rebuilds at most every 0.35 s while sliders move (a single click
  still rebuilds at once). «middels» env 128² → 64² (the env is a flat-coloured low-poly room).
- `perf/slider.json`: drag 2 s → 7–8 env builds (was one per input event, 62 in the review), drag fps ×1 59 /
  ×4 46 (review: 59 / 32), env rebuild 3.2 ms ×1.

## Lamp lumens (FOUNDATION data – the main remaining mismatch)
The photos show the lamps on at 08:30 but their light is local and weak against the daylight: in 082726 the TV-stue
triple ring glows but leaves no pool on the floor/sofa; the LED coves are thin amber lines with a short wash; the
lower high wall is pure daylight. With room-spec's lumens (17 300 lm on: `led-*` 400 lm/m, `tak-tvstue` 3000,
`ring-kjokken-*` 2000, chandelier 2000, spots 400) lamps put out more flux than the daylight (12 900 lm through the
windows), so their bounce tints every wall and fills floor and ceiling (`patches.mjs`: TV-stue floor 172 lux lamp vs
35 lux day). Rendering the same views with the groups dimmed to led 0.35 / tvstue 0.2 / kjokken 0.35 / overskap 0.5
/ spots 0.75 and the item lamps 0.5 (`zc-*`, `final-cal-*.png`) gives the photo look (neutral TV-stue, grey sofa,
cool daylit walls). Suggested room-spec values: LED strips ≈ 140 lm/m, `tak-tvstue` ≈ 600 lm, kitchen rings ≈ 700 lm,
under-cabinet ≈ 150 lm/m, spots ≈ 300 lm, chandelier ≈ 1000 lm. Lighting converts whatever the data says.

## Requests to other areas
- **WALLS** – PhotoCompare: use `PHOTO_ENV` for montages (see 4).
- **FOUNDATION** – room-spec lumens (above); optional `outside.horizon` / `outside.trees` if the skyline should be
  refined (format above).
- **LAMPS** – `ceilingPool` decals (`POOL_GAIN`) were matched to the old white balance + AgX; with amber lamp light
  they now render as saturated yellow discs on the ceiling (083012 view, `c-h-083012.png`). Please re-match against
  082806 / 083012.
- **SHELL** – exterior: the 3D deck/railing in shade is lit only by the interior env + ambient, which are warm now, so
  the railing reads orange-brown at 08:30 instead of grey (#7c776f). Give the exterior materials a sky-light emissive
  that follows `setDaylight(level, skyHex)` (also lighting.md #4). Draw calls: merge static shell/kitchen meshes (9).
- **Integrator** – `core/Game.js` and `dev/sandbox.js` set `AgXToneMapping` before the LightManager switches to
  `NeutralToneMapping`: set Neutral there too so nothing compiles twice. `notes/lighting.md` still describes AgX, the
  old pools and WB values (not my file to edit in this round).

## Contracts
ARCHITECTURE §10 API unchanged. New exports: `HORIZON`, `TREES`, `horizonElevation`, `sunVisibility`, `PHOTO_ENV`.
`info()` has the extra fields listed in 1. Dev params unchanged (`&tm=`, `&key=`, `&pools=`, `&ao=`).
