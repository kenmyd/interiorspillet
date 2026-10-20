# verify-r1 – integration check after the fix round 1

Verifier for the parallel fixes in `notes/fix-*.md`. Dev server 5291 (normal `npx vite`), scripts and screenshots in
`.shots/verify-r1/`. Everything below was run on the integrated tree after all fixers had finished.

## Result

| # | Check | Result |
| --- | --- | --- |
| 1a | `npm run build` | **pass** (one old warning: `IMPORT_IS_UNDEFINED estimateShading` – see «Remaining») |
| 1b | `node tools/test-design.mjs` | **pass** 77/77 after updating two stale counts (was 75/77) |
| 1c | 0 console errors from the start screen | **pass** – `start-flow.mjs`: menu → Enter → game → Esc → «Avslutt til hovedmeny» → Enter again: 0 errors, 0 warnings |
| 1d | 0 console errors from `/?play=1` | **pass** – all flows a–g, the walls/ui/interact re-runs, «høy» game run (`high-game.mjs`), sandbox «lav»/«høy» |
| 2 | End-to-end flows a–g | **pass** (`run-all.sh` → `run-all.log`, 0 errors each) – 3 scripts updated for intended UI changes |
| 3 | Spot-checks of this round's fixes (40) | 36 pass, 4 partial (all the warm lamp-light cast), 0 broken – table below |
| 4 | `npm run pack` + dist in a sub-folder | **pass** – zip 11,3 MB / 102 files; unpacked to `<tmp>/www/stue/` on a static server: menu → game → quit → re-enter, wall thumbnails, montage compare (B2), catalogue thumbnails, sandbox – 0 errors, 0 failed requests |

## What I repaired / changed

| File | Change | Why |
| --- | --- | --- |
| `tools/test-design.mjs` | furniture count 45 → 62; originals = `spec.furniture.length − 1 + 5` | the 17 decor items from fix-core made two checks stale (core asked for it) |
| `src/core/Game.js`, `src/dev/sandbox.js` | initial `renderer.toneMapping = NeutralToneMapping` (was AgX) | fix-lighting switched the LightManager to Khronos PBR Neutral; same value up front = no double compile |
| `src/data/scripts/fixes.mjs` (+ applied to `src/data/room-spec.json`) | `f-pendel-stue.params.shadeD` → `[0.16 ×4, 0.105 ×4]` | fix-lamps' data hand-off for «shades a bit too big» was not applied by the data owner. Added to the idempotent fixes so `normalize-data.mjs` keeps it; `--apply` changed only those 8 numbers (diffed) |
| `src/design/SceneSync.js` | `_compile` skips programs three.js already destroyed (`p?.program`) | same guard the gate's `check()` already had; avoids polling deleted programs |
| `README.md` | «Bytt modell» also with `,` / `.`; «Lys som på bildet» = the «Før» photo's light (18.10. 08:30, spots + LED), not evening; montage-less proposals = bare 3D | text was out of date after fix-ui / fix-walls / fix-lighting |
| `notes/integrator.md` | tone-mapping rows say PBR Neutral | AgX was out of date |
| `.shots/verify-r1/flow-a.mjs` | swap buttons by `title^="Neste modell"` | Inspector titles are now «Neste modell (.)» |
| `.shots/verify-r1/flow-f.mjs` | start button `^Fortsett` (now «Fortsett: <navn>»), output dir | fix-core menu change |
| `.shots/verify-r1/flow-g.mjs` | re-project the item after selecting it | fix-interact reframes orbit/plan to the area the Inspector leaves free, so the old screen point was stale (drags «did nothing») |

No conflicts between fixers broke a flow. The only cross-area hand-offs that nobody did were the chandelier data (done
above), the tone-mapping alignment (done) and the lamp-lumen data (not done, see «Remaining»).

## Flows (screenshots in `.shots/verify-r1/`)

- **a** catalogue → Vilde placed at (3.75, 0, 9.86) → colour #2b2a28 → leg style swivel-disc → wood-taper → ▶ ▶ ◀ swaps
  in place (Ronda, Beetle, Ronda; same position/rotation) → undo ×3 / redo ✓ (`a1…a7`). 60 fps.
- **b** click high wall → panel → flip B → B2 → E → F → A → P2 applied (0,72 s) → Rediger: checker colour A #5f4936 →
  #6b4a33 → «Sammenlign» photo mode → wipe → Esc back to walk ✓ (`b1…b8`).
- **c** window win-s2 → venetian (VECKLARFLY) → colour → closed + tilt 40° → striped sun at 13:00 ✓ (`c1…c5`).
- **d** evening → floor lamp → pendant over the dining table (snapped to the middle, «65 cm over spisebord») → chandelier
  dragged (5.45, 10.15) → (5.94, 9.76) ✓ (`d1…d6`).
- **e** cushions 0,86 → 0,85 s, rug 0,81 s (−0,04), breakdown lists them ✓ (`e1…e3`).
- **f** save «Test verify» → reload → «Fortsett: Test verify» → items, wall P2, shading kept → shopping list ca. 20 218 kr
  (chair, rug, wall P2, venetian with its size warnings) → Før/etter → PNG download ✓ (`f1…f7`).
- **g** orbit select + drag chair (4.92, 8.82) → (4.31, 9.25); plan select + drag table, R, undo ×3 back to the start ✓
  (`g1…g6`).

## Spot-checks (round-1 fixes)

Renders: `vr.mjs` (one sandbox load, many views, `pair-<id>.jpg` = photo | render), views in `views-*.json`.
Game checks: copies of the fixers' scripts in `re-walls/`, `re-ui/`, `re-interact/` (pointed at 5291).

| Fix | Verdict | Evidence |
| --- | --- | --- |
| [lighting] sun at 08:30 18 Oct / day mode +1 h | pass | auto 08:30: alt 2.3°, az 111°, `blocked`, `sunInRoom false`; day 08:30: effective hour 8.50, no sun; noon June: sun in (`vr` output, `pair-082827.jpg`) |
| [lighting] 2700 K near-white, neutrals beige | **partial** | pools/LED now amber (`pair-082924.jpg`, `pair-0_for.jpg`); neutral surfaces still read warm/beige (TV-stue sofa, rug, floor in `pair-082726.jpg`, `pair-082736.jpg`) – lamp lumens, see «Remaining» |
| [lighting] too flat | **partial** | window walls darker, floor less flat; ceilings still beige-brown and bright vs the grey photo ceilings (`pair-082909.jpg`, `pair-083012.jpg`) |
| [lighting] evening for montages = dark brown | pass (light) / **partial** (colour) | PhotoCompare now uses `PHOTO_ENV` (08:30, auto) + spots/LED: `pc-check.mjs` → time 18.10 8.5, canUndo false, env restored on close. With LED forced on the 3D half is clearly more orange than the montage (`pc1-B-3d.png`, `pc3-B-half.png`) |
| [lighting] high-wall pools narrow/tall/sharp (photo) | pass | soft round-topped amber pools (`pair-082924.jpg`, `pair-0_for.jpg`) |
| [lighting] spots white, hard, 2× tall (montage) | pass | same |
| [shell] worktop lines | pass | cloudy dark marbling (`pair-082941.jpg`) |
| [shell] terrace stair/guard, lawn smears | pass (geometry) | smaller stair/guard, no streaks (`pair-082841.jpg`, `pair-082852.jpg`); the 3D deck/railing still renders tan in shade (Remaining) |
| [shell] k2 annex roof / k1 smear | pass | river + boathouses through k2, sharp trees through k1 (`closeups-c.jpg` k2/k1); a soft vertical seam between the two backdrops is visible from the bench |
| [lamps] chandelier: ceiling light, amber inner, shade size | pass | two soft ceiling pools (`pools.jpg`: on/off), brass/amber insides; shade size fixed with the data change above (`c-chand-083012.png` vs `pair-083012.jpg`) |
| [seating] curved bouclé sofa | pass | pebble seat + bolster back with high curl (`pair-082806.jpg`) |
| [core] colours/materials existing items | pass | light-grey chairs, charcoal cushions, dark TV table top, bouclé (`pair-0_for.jpg`, `pair-082736.jpg`) |
| [shell] black glass switch panels | pass | near-black (slight navy) (`c-switch-082924.png`, `c-cu-G2-hooks.png`) |
| [shell] graphite-oak cabinets, shutter slats | pass | `pair-082937.jpg` |
| [textiles] TV-stue rug | pass (pattern) / **partial** (base colour warm – lighting) | lenses, pinstripe bands, blocks match (`pair-082736.jpg`, `pair-082726.jpg`) |
| [core] tabletop/shelf decor | pass | jute mats, candlesticks, glasses, shelf items (`pair-082827.jpg`, `pair-082736.jpg`) |
| [shell] floor planks | pass | soft low-contrast planks (`pair-083019.jpg`) |
| [seating] corner sofa piping | pass | subtle (`pair-082736.jpg`) |
| [decor] waste bin | pass | rectangular steel pedal bin (`pair-082950.jpg`) |
| [ui] shopping list drops «Mitt forslag» wall | pass | `re-ui/s1-shopwall`, `s13-wall`: «Mitt forslag «K – min variant» … ca. 12 500 kr», undo/redo chain keeps it |
| [walls] freezes when browsing | pass | `re-walls/perf-open.mjs`: 20 s after V 0 frames > 100 ms, flipping all 40 proposals max frame 57 ms, no new programs |
| [walls] «Lys som på bildet» night scene | pass | 08:30 auto + spots (`re-walls/flow-compare`) |
| [walls] «Rediger» stale on flip | pass | rows follow the shown proposal (`flow-edit` [rediger flip]) |
| [walls] «Lys som på bildet» undo steps | pass | canUndo false while on / after Esc / after close |
| [walls] E lamp + decor | pass | lamp, books, vase (`closeups-walls.jpg` cu-E, `pair-m-E.jpg`) |
| [walls] C curtain flat / heading | pass | folds + cover profile (`pair-m-C.jpg`, cu-C); spot hot streaks on the folds remain (lighting) |
| [walls] G2 hooks | pass | `c-cu-G2-hooks.png` |
| [walls] T grooves | pass | reads near-continuous (cu-T) |
| [shell] H paint stops at the door | pass | green round the door to the corner (`pair-m-H.jpg`, cu-H) |
| [walls] striped light under slat bands (E, N3) | pass | clean paint (cu-E, cu-N3) |
| [walls] sticky header | pass | `flow-open` [header]: status bar outside the scroll body |
| [walls] «Mine forslag» codes | pass | «Egen 1», «Egen 2» |
| [walls] compare without montage | pass | N1: bare 3D, «Sammenlign med bildet», «Vis før-bildet» |
| [walls] PhotoCompare tag / ghost hint | pass | [swap] tags end left of the panel, key bar hidden |
| [walls] N14 bench | pass | table 5.37 → 4.245, wall-side chairs hidden, one undo step |
| [walls] new elements on top | pass | art added at u 2.7 v 2.05 beside the checker |
| [walls] RT60 cards vs status | pass | A/P/H/X/G2/N1 identical |
| [walls] «Tilbakestill» cancel | pass | preview kept |
| [interact] ghost through walls | pass | `re-interact/r1-floor`: cursor on the high wall → ghost at x 3.44 «inntil veggen» |
| [ui] «Bytt modell» ▶ moves | pass | `re-ui/s5-swap`: ▶ y 128 for every click, also scrolled |

Also re-run without findings: `re-walls/flow-open`, `flow-orbit`; `re-ui/s6-inspector`, `s7-grow`, `s10-saves`;
`re-interact/r4-views`.

## Remaining problems (not fixed here)

1. **Warm / orange overall cast, beige-brown ceilings** (the root of the «partial» rows). fix-lighting's colour model is
   in, but its suggested lamp data was not applied: room-spec still has LED strips 400 lm/m, `tak-tvstue` 3000 lm,
   kitchen rings 2000 lm, spots 400 lm, chandelier 2000 lm (suggested ≈ 140 lm/m / 600 / 700 / 300 / 1000). Their bounce
   tints every wall and lights the ceiling (`pair-083012.jpg`: the window LED washes the ceiling amber). PhotoCompare
   forces LED + spots on, so the 3D half is more orange than the montage. I did not change the lumens: fix-lighting's own
   calibrated renders (`.shots/fix-lighting-r1/final-cal-*.png`) are darker but the ceilings stay brown and the LED
   coves disappear – this needs a joint LIGHTING + data tuning pass, not an integration fix.
2. **Exterior 3D (deck, railing, stair, annex) reads tan/orange in shade** at 08:30 – SHELL and LIGHTING each handed it to
   the other (sky-light emissive via `setDaylight`, or lower fill outside).
3. **GL warnings when many lamps are added/removed quickly**: `lamp-churn.mjs` (111 add/remove in the sandbox) → ~100 ×
   «GL_INVALID_VALUE: glGetProgramiv: Program object expected». Instrumenting `gl.getProgramParameter` shows no JS call
   with a deleted program, so they come from inside the browser (programs deleted while KHR_parallel_shader_compile is
   still compiling them). Warnings only; none in the normal flows.
4. Build warning `IMPORT_IS_UNDEFINED estimateShading` (ShoppingPanel's optional hook; SHADING never exported it).
   Harmless: the list falls back to `WindowPanel._estimate` – prices identical (fix-ui s2: 114/114).
5. `panelKit`'s module-level host keeps the last session alive after «Avslutt» (no API to clear it; replaced by the next
   session) – fix-shading #4.
6. Small: the sun disc is drawn above the hills in the 082852 view while the sun is «behind the hills»; the kitchen ring
   lamp renders as a thin white ring (photo: glowing amber ring, `pair-082937.jpg`); H's green reads teal-blue and the
   montage also paints the wall above the TV-stue opening; spot hot streaks on curtain C; soft seam between the south and
   east backdrops seen through k1 from the bench.
7. Still open from earlier rounds: wall-mounted sideboards float (fix-core #16, INTERACT/TABLES), `wall.custom` in
   DesignState for exports, `research/room-spec.json` and its notes don't have the r1 data changes (they live in
   `src/data/scripts/fixes.mjs`) and the terrace fit is still `TERRACE_FIT` in exterior.js (data hand-off from fix-shell).

## Tools in `.shots/verify-r1/`

`lib.mjs` (integrator helpers, BASE 5291, OUT here), `flow-a…g.mjs` + `run-all.sh`, `start-flow.mjs` (menu → game →
quit → re-enter; `BASE`/`PATHNAME`/`PREFIX` env for the sub-folder test), `dist-check.mjs`, `pc-check.mjs`
(PhotoCompare light), `vr.mjs` (sandbox views + photo pairs), `tile.mjs` (contact sheets), `high-game.mjs` (game on a
quality preset), `lamp-churn.mjs` (GL-warning probe), `re-walls/`, `re-ui/`, `re-interact/` (fixer scripts retargeted).
