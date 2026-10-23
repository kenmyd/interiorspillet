# lighting – notes for the integrator

Owner of `src/home/lighting.js` (LightManager, sun/daylight helpers), `src/ui/LightPanel.js` («Belysning», the lamps)
and `src/ui/SunPanel.js` («Sol», time of day, date, light mode, weather, exposure, latitude).
Exported names and signatures from the stub are kept (`LightManager`, `sunPosition`, `kelvinToColor`); new exports:
`SITE`, `solarPosition`, `sunTimes`, `daylight`, `dayOfYear`, `dateFromDayOfYear`, `utcOffset`.

## How it works (short)

- **Photometric units everywhere, one scene scale S.** Sun in lux, window sky light as RectAreaLights in nits,
  lamps in candela from lumens (spot: lm / cone solid angle, point: lm / 4π, ceiling rings: Lambertian lm / π), LED
  strips as thin RectAreaLights tilted 38° toward their wall (wall washers). Every value is multiplied by S
  (partial eye adaptation, `S = 0.18 / (Lavg^0.72 · 60^0.28)`) before it reaches three.js, so
  `renderer.toneMappingExposure` stays 1 and unlit materials (the photo backdrops, highlight glow, ghosts) keep their
  display brightness. `design.env.exposure` multiplies S («Lysstyrke på bildet» in the panel, ±2 EV).
- **Tone mapping: AgX** (set by the LightManager constructor, overriding Game.js' ACES). It matched the photos best
  (neutral greige walls, warm scallops) and rolls sun patches off without hard clipping. Partial white balance
  (von Kries, 45 %) toward the colour of the light on the room's surfaces.
- **Sun**: NOAA solar position with CET/CEST (EU rule), refraction, latitude from settings (default 58.1° N),
  longitude 8.0° E. One DirectionalLight, shadow camera fitted tightly around the room box (≈ 6 mm/texel on
  «middels» 2048², 3 mm on «høy» 4096²), PCF radius 2.2–3.2 texels ≈ the real penumbra of window frames.
  `shadowMap.autoUpdate = false`; maps re-render on `requestShadowUpdate()` and when the sun moves.
- **Bounce**: a 23-patch radiosity solve over the real room (floor, both ceilings, every wall, glass, bulkheads)
  with every source's flux landed on the patches (sun: 9 rays per window traced onto floor/walls, reveal shading
  included). The patch radiances become a low-poly copy of the room → PMREM → `scene.environment` (indirect light
  and reflections). Sunlit floor patches become upward RectAreaLights per wall (`bounce:w-sor`,
  `bounce:w-kjokken-sor`); their first bounce is removed from the env floor (no double counting).
- **Budget**: fixed pools (point/spot/rect: lav 2/6/4, middels 4/10/8, høy 6/14/10); counts never change, so lamps
  going on/off never recompile shaders. Every 0.25 s (or when the camera moves 0.5 m) the sources with the largest
  `flux / (1 + d²)` (× 0.35–0.7 when behind the camera, × 2.5 for the four high-wall spots, +30 % hysteresis) get a
  slot; the rest keep their emissive
  glow and their direct flux goes into an ambient term (their bounce is in the env map anyway). The four spots of
  group `spots` own 4 shadow-casting spot slots on «middels»/«høy» (512²/1024², static) – slats/art on the high wall
  cast real shadows. Newly assigned lights fade in over ~0.15 s.
- **Emissive**: glowing materials are indexed per material. With `userData.baseIntensity` (materials.emissive /
  shadeMaterial) the luminance is `baseIntensity · 150 nits · √(lm / 800)` (the models tune their relative glow for a
  night view), otherwise 0.8 · lumens of *all* lights of the fixture /
  (π · ½ area); clamped 20–30 000 nits, colour = light colour × white balance. Lamps that list their glowing meshes
  on `lights[0]` only (LAMPS, shell/kitchen built-ins) are handled (grouped per item uid / built-in id). Cached
  `mat()` materials are never touched.
- **AO**: GTAO (three/addons GTAOPass, no EffectComposer) on «høy» only: the frame is rendered straight to the
  screen, then GTAO's AO is multiplied on top, clipped to the room box (photos/sky untouched). ~4 ms at 1080p on an
  RTX 2060S, so not on «middels».
- Default env (13:00, 15 June, auto). `auto`: built-in groups are on when the diffuse daylight on the floor is below
  160 lux (dawn, dusk, dark winter days, all blinds down). `day` clamps the clock into the day, `evening` = blue
  hour (sun −4°), `night` = −16°, both with lamps on.

- **Fires** (notes/peis-og-ovn.md): a fireplace's builder entry of type `'fire'` (id = group = `fire-<id>`, no `:`)
  becomes a Lambertian spot out of the stove's window (`HOUSE.fire`: 85°, no shadow) in the normal light budget; its
  slot intensity flickers ± 14 % per frame (`_flicker`, after `_apply`: no recompute, no shader change). The embers are
  its emissive mesh; the flames follow their glow. Its group is a data group of its room with `auto: 'evening'`.
  The owner's house has none (`_flickers` is empty).

## Measured (RTX 2060 SUPER, headless Edge, ANGLE D3D11)

| What | Result |
| --- | --- |
| Game `/?play=1`, «middels», 2400×1350, evening (all 17 300 lm on) | 60 fps (vsync), `lighting.render` 3.2–4.4 ms/frame incl. gl.finish |
| Same, day | 60 fps, ≈ 4.3 ms/frame |
| Sandbox 1920×1080: «middels» / «høy» (AO) | 3.8 ms / 8–10 ms per frame |
| Light pools on vs off (2400×1350) | +≈ 1 ms |
| `_recompute()` / env PMREM rebuild / per-frame apply + budget | 0.36 ms / 0.72 ms / 0.03 ms |

## Must wire up / requests

1. **Settings keys** `sunLatitude` (number, default 58.1) and `lightWeather` (`'clear'|'overcast'`) are set by the
   panel via `settings.set` (Settings persists unknown keys). Please add them to `DEFAULT_SETTINGS` (and, if wanted,
   to the graphics tab). If you would rather save them **with the design**, add `latitude`/`weather` to
   `DesignState.normaliseEnv` and let SceneSync call `lighting.setSite?.({ latitude, weather })` – tell me/whoever
   owns lighting and I add `setSite`; today the LightManager reads the settings and listens to their changes.
2. **Game.js** sets `renderer.toneMapping = ACESFilmicToneMapping`; the LightManager switches it to AgX in its
   constructor (before the first compile). Harmless, but you may want to change Game.js/sandbox to AgX too so nothing
   compiles twice. `toneMappingExposure` must stay 1 (exposure lives in S).
3. **SceneSync `_syncWall`** drops `penumbra` of the wall-design lights (walls.md #3) – I use it when present.
4. **Exterior (SHELL)**: `setDaylight(level, skyHex)` gets ≈ 1 by day (also at sunset – the morning photo was taken
   at a 2° sun), ≈ 0.15 at blue hour, 0.03 at night (level = √(view brightness relative to a well-exposed day photo),
   i.e. what shell.md's table expects). The 3D exterior (deck, railing, lawn) is lit only by the sun and the
   *interior* environment map, so it is too dark in shade by day; give those materials a little emissive that
   follows `level` if it matters.
5. **LAMPS**: the chandelier's single point light just below the shades lights the ceiling strongly (correct-ish –
   083012 shows a warm glow – but a cluster of spots along the shade openings would look closer to the photo).
6. **Debug/test hooks** (dev only, read from `location.search` by the LightManager): `&tm=agx|neutral|aces`,
   `&key=0.18`, `&ao=0|1`, `&pools=point,spot,rect,spotShadows`. `lighting.info()` returns sun/daylight numbers,
   `lighting.stats` = `{ S, recomputes, envBuilds }`, `lighting.groupState(id)`, `lighting.itemLightUids()`,
   `lighting.on('change', fn)`.
7. LightPanel injects its own small `<style data-owner="LightPanel">` (classes `.lp-*`) – no changes to panels.css.

## Known gaps

- One environment probe: indirect light is the same everywhere (the TV-stue niche gets the same bounce as the dining
  area; the ceiling is evenly lit). Direct light (sun, windows, lamps) provides the spatial variation.
- RectAreaLights and item point lights cast no shadows (light leaks under furniture are only darkened by AO on
  «høy»). Only the sun and the four high-wall spots cast shadows.
- Sun through blinds/curtains depends on SHADING's shadow casters; the LightManager scales the window's sky light
  and its bounce by `setWindowTransmission`.
- Weather has two states (sol/overskyet); no partial clouds.
- No bloom/glare around lamps.
