# SHADING – notes for the integrator

Owner: «shading». Files: `src/models/shading.js`, `src/ui/WindowPanel.js` (nothing else edited).

## What is built

`models/shading.js` (exports kept from the stub, plus extras):

| export | |
| --- | --- |
| `SHADING_TYPES` | `[{ archetype, label, params, mounts, defaultMount, tilt, band, top, main, partLabels }]` – params in Def.params format |
| `applyShading(windowInfo, spec\|null) → { group, transmission }` | builds in `windowInfo.anchor`; when only `open`, `tilt`, `params.band`, `params.top` change it **animates** the existing model instead of rebuilding |
| `shadingTransmission(spec) → 0..1` | daylight share for the sky/fill light (direct sun is shadowed by the geometry itself) |
| `shadingSize(windowInfo, spec)` | width/drop/track/fabric width/pieces/fullness/short – used by the panel's price estimate |
| `defaultShadingSpec(archetype, windowInfo?)`, `FABRICS`, `MOUNT_LABELS`, `productSizing(product)` | for UIs |
| `setShadingDaylight(colour\|null, windowId='*')`, `setShadingDaylightHint(colour\|null)` | daylight radiance behind fabrics (see below) |
| `shadingHooks.requestShadowUpdate` | called once when an animation ends (WindowPanel sets it to `home.lighting.requestShadowUpdate()`) |
| `updateShading(dt)` | optional driver; animations also advance by themselves from the renderer (`onBeforeRender` of the rail) |

Types: venetian (16/25/35/50 mm, alu/wood/bamboo, ladder cords or tapes, tilt wand, real stack when raised), roller
(screen/sheer/linen/filter/dimout/blackout, brackets or cassette, chain/cordless handle), pleated (single, top-down/
bottom-up with `params.top`, honeycomb «duette»), duo roller (two striped layers, `params.band` 0 = open stripes, 1 =
closed), vertical (89/127 mm vanes, stack left/right/split, bottom chain), curtain (wave/pinch pleat/rings/eyelets,
sheer/linen/velvet/wool/dimout/blackout, ceiling track or wall rod/track, `params.span: 'window'|'wall'`, 1 or 2 panels,
floor or sill length, fullness, check pattern for the Rebell wool), roman (folds collapse from the bottom), exterior
zip screen (cassette + guides on the facade). Mounts: recess (inside the reveal, in front of the frame and handles),
frame (on the glazing), wall (above/beside the opening, clamped half-way to the neighbouring openings), ceiling,
exterior. Ready-made products are shown honestly: several pieces side by side when one is too narrow, and the real
length when it is too short (e.g. VECKLARFLY 155 cm on the 181 cm south windows).

Light: opaque slats/fabric cast normal shadows; translucent fabric casts an ordered-dither (Bayer 4×4)
`customDepthMaterial` with coverage `1 − T`, which the PCF filter turns into partial sun; the fabric's room side glows
from the sun behind it (translucency term patched into `RE_Direct`, sun shadow looked up 3 cm outside the fabric so it
is not self-shadowed – walls/reveals still shade it) and from the daylit window (emissive × the window's sky luminance).

## Things to wire / check

1. **Clickable shading** – WindowPanel adds every built shading group (`userData.pick = { kind: 'window', windowId }`)
   to `home.pickables.windows` after each design `'window'`/`'load'` event, so a click on a closed curtain/blind selects
   its window (otherwise the wall behind gets picked). If you prefer, move this into SceneSync._syncWindow (push
   `applyShading(...).group`, remove the old one) and I can drop `WindowPanel._syncPickables`.
2. **Daylight behind fabrics (LIGHTING)** – the glow needs the UNSHADED sky luminance of each window in render units.
   Today shading.js finds the window's sky RectAreaLight (within 0.45 m of the glass) and divides its intensity by
   `shadingTransmission(spec)`; when that window has no pool slot it uses a hint the WindowPanel derives from
   `lighting.info().outdoorLux × lighting.stats.S × 0.085`. Exact would be: in `LightManager._apply()` call
   `setShadingDaylight(skyColor × wb × (w.L / t) × S, w.id)` per window (import from `models/shading.js`).
3. **setWindowTransmission** – keep it for the sky/fill only (the current LightManager does: the sun's intensity is
   not multiplied by it). Multiplying the sun by it would double-count, because the shading geometry already shadows
   the sun (dithered for translucent fabric).
4. **Shadow filter** – the dithered fabric shadows assume PCF with `shadow.radius ≥ ~2` texels (now 2.2 on «middels»);
   with a smaller radius the 4 × 4 stipple can show on the floor.
5. **Animations** refresh `renderer.shadowMap.needsUpdate` every 2nd frame while moving and call
   `shadingHooks.requestShadowUpdate` once at the end (so the bounce/environment is not rebuilt every frame).
6. **Acoustics** (`design/Acoustics.js`) estimates its own curtain width/height; `shadingSize(windowInfo, spec)` gives
   the exact track width, drop and fabric width (also for wall-wide curtains, which are one spec per opening).
7. **Wall-wide curtain** = the same spec (`params.span: 'wall'`) on every opening of the wall; each opening builds its
   segment (to the pillar midpoints / wall ends), so stacks end up at the pillars. The panel writes all of them in one
   transaction; «Fjern» removes all.
8. `dev/models.html` cannot show shading (not in the registry) – test with the sandbox:
   `__sandbox.design.setWindow('win-s1', spec)`.

## Catalogue gaps (data owner, `src/data/catalog/solskjerming.json`)

- No blackout roller, no 16/35 mm venetian, no linen roller, no made-to-measure screen roller, only one roman blind
  (140 cm high – too low for the south windows) and one vertical blind.
- Ready-made products list only one size each (the largest); other widths are only in `priceNote`. A `sizes:
  [[w,h,price]]` field would let the panel pick the best fitting size instead of «n stk. side om side».
- Made-to-measure prices are scaled from the 220 × 180 reference by area (blinds) or track width (curtains), with
  «Fra-pris» as the floor; a per-m² `priceNote` is not used by any product yet.

## Verification

Screenshots in `.shots/shading/` (sandbox at 13:00, 15 October, «middels»): `final/{venetian,roller,pleated,duo,
vertical,curtain,curtain2,roman,exterior}.png` (closed / half open / tilted on the two big south windows),
`final/sun-oct13-tilt45.png`, `-tilt-45.png`, `-wood50-tilt45.png`, `-sheer.png` (sun patterns), `wall-closed.png` /
`wall-open.png` (curtain over the whole wall), `kitchen.png`, `tv.png`, `door.png`, `side-*.png` (mount positions),
`evening.png`, `anim-mid.png`, `panel*.png`, `final/panel-curtain-price.png`. Timings: build 2–9 ms per window,
re-pose 0.06 ms (venetian) to 0.6 ms (curtain segment); game 60 fps with six shaded windows, also while animating.
