# add-lighting – warm cast, ceilings, LED coves, exterior (verify-r1 «Remaining» 1–2)

Owner: «lighting». Files changed: `src/home/lighting.js`, `src/home/exterior.js`, and in `src/data/room-spec.json`
only the lumens of `builtInLights` and of `f-pendel-stue` (table below). `src/ui/LightPanel.js` unchanged.
Tools, renders and sheets: `.shots/add-lighting/` (`rs.mjs` = many sandbox views in one load + photo|render pairs with
region samples, `tri.mjs` / `sheet.mjs` = photo | before | after sheets, `game.mjs` / `walk.mjs` = fps + shader
programs + console in the game, `ev.mjs` = evaluate JS in the sandbox, `--lm=led:120,…` overrides lumens in the page).
«Before» = the pre-change build (verify-r1's `dist/`, snapshot served read-only), «after» = this tree.

## Data hand-off (FOUNDATION – please add to `src/data/scripts/fixes.mjs` and `research/room-spec.json`)

`normalize-data.mjs --apply` would otherwise put the old values back. Only these numbers changed (colorK unchanged, 2700):

| id | field | old | new |
| --- | --- | --- | --- |
| led-sor, led-tvstue, led-kjokken | lumensPerM | 400 | **120** |
| led-overskap | lumensPerM | 300 | **120** |
| spot-hoyvegg-1 … 4 | lumens | 400 | **250** |
| tak-tvstue | lumens | 3000 | **400** |
| pendel-oy-1 … 3 | lumens | 400 | **250** |
| ring-kjokken-1, ring-kjokken-2 | lumens | 2000 | **500** |
| f-pendel-stue (furniture) | light.lumens | 2000 | **800** |

Lamps on at the photo time: 17 321 → 5 688 lm. Verified against the photos, not copied from the r1 suggestion
(140 lm/m / 600 / 700 / 300 / 1000): with the colour model below 120 lm/m still gives a clear cove wash (083012,
082726, 082909), 400 lm leaves the TV-stue sofa and rug grey (082726/082736), 250 lm keeps the high-wall pools. A
design saved earlier (localStorage «Forrige økt») still carries the chandelier's 2000 lm in `item.light`.

## What changed in lighting.js (and why)

| Problem (verify-r1) | Change |
| --- | --- |
| Neutral surfaces beige-brown, lamp light tints the whole room | **Bounce locality** (`BOUNCE_LOCAL`): a lamp's flux enters the radiosity / env map / exposure / white balance × `0.1 + 0.9·R²/(R²+d²)` (R 3 m, d = lamp–camera distance, strips: distance to the segment). One env probe spread every lamp's bounce over the whole open-plan room. Re-solved after 1.2 m of camera movement (≈ 1.1 ms incl. env rebuild, measured); camera outside the room (orbit/plan) → room centre. |
| Same + camera colour | **White balance rewritten** (`WB`): one diagonal matrix that maps the dominant light (daylight and lamps mixed in mired by the lamps' weight `m`) onto its partly adapted colour on the blackbody locus. Next to lamps the daylight stays almost uncorrected (the photos' daylit walls are grey-blue, pools amber); daylight alone is balanced on the measured colour of the light on the surfaces (`dayAlone` 0.6 – noon ceilings less peach); lamps alone (evening/night) 0.9 on a colour halfway between the lamps' own and that of their bounce (grey stays grey, warm-white pools). Eased like the exposure (0.4 s). The old additive day + 0.6·lamp / von Kries partial adaptation is gone (its log-RGB mix also went olive in the evening). |
| Daylight too neutral vs. the photos | Blocked-sun sky 9000 → **11 000 K** (`BLUE_SKY_K`); the ground-reflected part of the window light gets the garden's green-grey (`GROUND_TINT`) – the mixture with lamp light is grey-cyan as in the photos instead of lilac. |
| Ceiling around the chandelier orange (083012: grey there) | Item point lights whose fixture has ceiling-glow decals (custom-blended glow meshes – only the molecule chandelier today) become a **downward half-space spot (70 %) + a weak point light (30 %)** (`HALF_SPACE_SPOT`); its decals × 1.4. Ceiling rings / tak-tvstue (Lambertian spots) send 15 % up in the bounce (`RING_UP_SHARE`). Without any up-light the evening ceiling was a dark brown cave. |
| LED coves disappear at photo-like lumens | Strips get **`STRIP_SIGNATURE` 8×** priority for the rect slots (windows that lose one fall back to their far-field spot, which looks nearly the same from a few metres). |
| LED lines / kitchen ring white | Emissive glow is **soft-capped on its brightest channel** (`EMISSIVE_DISPLAY_CAP` 1.8): lines and rings keep the light's colour instead of clipping to white. Ceiling decals (custom blending) are not capped. |
| Exposure per mode | `MODE_KEY` evening 0.95, night 0.85. The view out of the windows is exposed as for a room of ≥ 10 nits (`VIEW_LKEY_MIN`), so the dimmer lamp-lit room does not brighten the blue-hour backdrop back toward the day photo. |
| Exterior deck/railing/stair tan in shade at 08:30 | `setDaylight(level, skyHex, light)` gets a third argument `{ sky, ground, envSize }` (display radiance of the sky dome = `Edh·S/π`, soft-capped at 0.9, colour ≤ 7000 K, ground 0.2 × global). See exterior.js. |

New dev URL params: `&wbd= &wba= &wbl= &wbe= &wbp=` (white balance: day, dayAlone, lamps, lampsEvening, pull).
`info()` unchanged; `_wbInfo` now `{ dayShare, lampShare, lampWeight, whiteK: [srcK, appK] }`.

## What changed in exterior.js

- The 3D exterior's materials are **own clones** of the cached `mat()` ones (same shader programs) and get their own
  **sky environment**: a two-colour dome (sky / ground) → CubeCamera → `PMREMGenerator.fromCubemap` at the room env's
  size (`envSize`), so the program keys are identical. Rebuilt only when the hue changes (quantised); the level goes
  into `envMapIntensity` (1 for all exterior materials – the authored 0.4 only damped the room's bounce). Like the
  backdrops it keeps the photos' white balance (the room's evening balance turned the deck violet).
- Measured at 08:30 (082841): deck render #595966 / photo #5a6069 (before #45301f), railing #54504c / #595a5a
  (before #584126). `setDaylight` without the third argument behaves as before.

## Evidence (photo 08:30 | before | after)

- `sheet-day-0830.jpg` (0_for, 083012, 082726, 082909, 082924), `sheet-day-0830-b.jpg` (082806, 082736, 082937,
  083019, 082827), `sheet-exterior.jpg` (082841, 082852, evening 082841), `sheet-evening-night.jpg` (evening and night
  at 0_for / 083012 / 082726), `sheet-noon.jpg` (12:30 day mode, default 13:00 June). Single rows: `tri-<view>.jpg`.
- Region samples (sRGB mean, B/R) 0_for – photo / before / after: ceiling #79756e 0.90 / #7e634e 0.62 / #706563 0.88;
  floor #8f9199 1.06 / #7b7476 0.96 / #7e7d86 1.06; TV-stue sofa #43454f 1.17 / #523d2a 0.51 / #2a2a31 1.16.
  083012: TV-stue back wall #7f8688 1.07 / #857466 0.76 / #797577 0.98; ceiling right of the chandelier #5e6060 1.01 /
  #f7ac5c 0.37 / #a57559 0.54.
- Game (`game.mjs`, «middels», 1600×900, RTX 2060S): 60 fps in day 08:30, walking, evening, night, noon (vsync);
  warm walking pass p99 17.6 ms; shader programs 57 → 60 in exactly the same steps as the before build (no extra
  programs); 0 console errors. Sandbox «lav»/«høy»: 0 errors. `vite build` clean.

## Open issues / requests

- **High-wall pools** are peach rather than orange (#fac2a2 vs #da9765): the upper high wall gets too much daylight
  from the 45° window rect lights (photo: upper wall ≈ ¼ of the lower). Fewer spot lumens did not help; needs the
  window light split into a sky part (down) and a ground part (up) – a second rect per window costs compile time.
- **LAMPS**: the chandelier's ceiling decals sit right of the fixture in 083012 (photo: halo up-left) and the kitchen
  ring has no ceiling halo (082937). With the half-space split the decals carry most of the up-light now.
- Noon / sun in the room: sunlit Sand ceilings are still warm-peach (sun bounce off the oak floor); the sunlit 3D
  exterior is overexposed (the sun is a scene light at the indoor exposure – pre-existing).
- Evening: the LED cove over the south windows is a wall washer aimed through the glass – it lights the terrace
  railing warm (no glass attenuation for lights).
- `notes/lighting.md` still describes AgX and the old white balance; this file supersedes it on those points.
