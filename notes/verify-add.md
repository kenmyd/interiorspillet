# verify-add – integration check after the «add» round (14 new products, Vitrineskap, lighting pass)

Verifier for `notes/add-catalog.md`, `add-lamps.md`, `add-seating.md`, `add-storage.md`, `add-lighting.md`. Dev server
5319, the packed zip unpacked to `<scratch>/www/stue/` on a small static server (5329). Scripts and screenshots in
`.shots/add-verify-add/` (`lib.mjs` = the verify-r1 helpers with the HMR stub and `teleport()`).

## Result

| # | Check | Result |
| --- | --- | --- |
| 1 | add-lighting's lumens survive the normaliser | **pass** after the fix: they were **not** in `fixes.mjs` – a re-run put 400 lm/m, 3000, 2000 … back. Now in `fixRoomSpec`; `normalize-data.mjs --out=<scratch>` → room-spec lumens identical, catalogue / palette / walls byte-identical; the only diff left is 17 decor `notes` strings (text, see Remaining 8). `fixRoomSpec` is idempotent on the current room-spec. |
| 2a | `npm run build` | **pass** (only the old `IMPORT_IS_UNDEFINED estimateShading` warning) |
| 2b | `node tools/test-design.mjs` | **pass 96/96** (the chandelier check was stale: 2000 → 800 lm; one new test for old saves) |
| 2c | 0 console errors, start screen and `/?play=1` | **pass** – `start-flow` (menu → game → quit → re-enter) 0 errors 0 warnings on dev and on the zip in `/stue/`; every game script below 0 errors |
| 3 | 14 new products in the game | **pass** after 3 fixes (below) – placement, ◀ ▶, recolour, shopping list |
| 4 | regression flows a–g (`.shots/verify-r1/run-all.sh`) | **pass** 7/7, 0 errors, run 3× (the last after every fix), no script changes needed |
| 5 | load time, fps | zip in a sub-folder: **cold 13,2 s**, warm revisit **3,0 s**, quit → re-enter **2,0 s** (dev: 13,5 / 3,1 / 2,0). **60 fps** (vsync) day and evening, original and with 5 new products, 1920×1080 «middels» – details below |
| 6 | `npm run pack` | **pass** – 102 files (13,1 MB) → 11,3 MB zip; unpacked in `/stue/`: menu → game → quit → re-enter, wall panel + montage + catalogue thumbnails, 0 errors, 0 failed requests |

## What I changed

| File | Change | Why |
| --- | --- | --- |
| `src/data/scripts/fixes.mjs` | `BUILT_IN_LUMENS` (LED 120 lm/m, spots 250, tak-tvstue 400, island pendants 250, kitchen rings 500) + `f-pendel-stue.light.lumens = 800` in `fixRoomSpec` | step 1: the normaliser would have overwritten add-lighting's values |
| `src/design/DesignState.js` | on load, an `existing` item's `light.lumens` comes from today's room-spec (dimmer / colour / on stay) | lumens are data, nothing in the UI edits them; an autosave / «Forrige økt» from before still had the 2000 lm chandelier (add-lighting noted it) |
| `src/design/Placement.js` | a wall item with `params.mountHeight` starts at `mountHeight + h/2` | BESTÅ hung with its bottom at 1,13 m instead of the shop's 1,20 m (the Inspector's floor → wall swap already used 1,20) – add-catalog / add-storage hand-off |
| `src/design/Placement.js` | `display-cabinet` in `AUTO_FACE` | a floor vitrine dropped by a wall at the default rotation stood side-on to it (my first run: Sagene r180 against the high wall); now back to the wall within 40 cm, R still turns it on open floor (`autoface.mjs`) – add-storage hand-off |
| `src/ui/Inspector.js` | `floorOnly` params hidden on wall-mounted items | BESTÅ offered «Understell: Ben / Sokkel»; «Sokkel» on a wall item makes the builder draw it with the floor origin (add-storage hand-off). BESTÅ now lists no Understell / Bentype / høyde |
| `tools/test-design.mjs` | chandelier lumens 800; new «old save: existing lamp lumens from the room-spec» | intended data change; covers the DesignState fix |
| `ARCHITECTURE.md` | §2 / §6 category `vitrineskap`, §5 `display-cabinet` (tables.js) and `pendant-slatted` (lamps.js), §13 vitrine parts | three add-* notes asked for it |

## 3 – the 14 products in the game (`place14.mjs`, `swap.mjs`, `shop.mjs`)

Every product through the real UI (K → search → card «Plasser» → mouse → R → click), Inspector open, real model (no
fallback box), screenshot from the placing view (`p-<id>-a.png`, with the Inspector) and a clean view (`p-<id>-b.png`), undo.

- **Secto 4200 / 4201 Small / Octo 4240 / 4241 Small** over the dining table, evening: snapped to the table centre
  (5,37 / 6,81), underside 1,40 m («65 cm over spisebord»), 806 lm 3000 K, spot 70 % + point 30 %, inside glows
  (`p-secto-4200-taklampe-b.png`, `p-octo-4240-taklampe-o54-b.png`, `s2-octo-walnut-evening.png`). The Octo's 41° spot
  lights the whole table evenly – no hard pool like the Secto's 35°; it does hold a spot slot in all views (`slots.mjs`).
- **Chicago, Timeout, Zermatt, Grande, Taycan** between the TV-stue and the sitting area at (3,62 / 9,55), r45, facing
  the sitting group; 0,70–0,90 m² sound, RT 0,86 → 0,83–0,84 s (`p-*-hvilestol-*-b.png`). At (3,75 / 9,85) r60 the
  Chicago's footstool really overlapped the small nesting table (Placement says so) – that spot is too tight.
- **Sagene, Belfort, Signature 1860** back to the high wall at z 6,0 (x 3,43, r90), **Scandi** in the free corner of
  the west wall (3,63 / 11,72, r180), **BESTÅ** hung on `w-hoy`, bottom 1,20 m (`p-*-vitrineskap-*-b.png`,
  `p-besta-*-b.png`).
- **◀ ▶** (`swap.mjs`): Secto 4200 ▶ ×18 round all 18 pendants back to itself (position constant, drop per product,
  0 fallbacks); Chicago ▶ ×7 round the 7 hvilestoler (position and r45 constant); Sagene ▶ Scandi ▶ Belfort ▶ Signature
  ▶ **BESTÅ on the wall (bottom 1,20)** ▶ Sagene back on the floor against the wall, ◀ again to BESTÅ.
- **Recolour**: Octo 4240 «Valnøtt» → 9 588 kr (før 11 985), own «Spiler» colour → «Egen farge · utgangspunkt:
  Valnøtt», undo ×2 back; Timeout «Cortina 09 Sand, skrog valnøtt» 31 498 kr (`s4-timeout-walnut.png`), own cover
  colour; BESTÅ «klart glass» → its own IKEA URL, back to «røykfarget» → the product URL; Scandi «mocca» 14 399 (før
  20 699).
- **Shopping list** (`shop.mjs`): all 14 at once, 9 on a non-default variant – every row's price, struck list price,
  variant and «Åpne» link equals the research files (computed independently): **14/14**, total 193 611 kr = the sum.
  Store groups Bohus / Christiania Belysning / IKEA (`l1-shopping-top.png`, `o4-overview-shopping.png`).
- Overview: Octo 4240 walnut over the table, Zermatt, Belfort + BESTÅ on the high wall – `o1-overview-day.png`,
  `o2-overview-evening.png`, `o3-overview-evening-sitting.png`. Categories in the gallery: `m-vitrineskap.png`,
  `m-taklampe.png`, `m-lenestol.png`.

## 5 – load time and fps (`perf.mjs`, Edge headless, RTX 2060 SUPER, `perf-dist.txt`, `perf-dev.txt`)

Load = click on «Gå inn i stua» → loading screen gone + 10 frames. Cold = fresh browser profile (no HTTP or GPU program
cache), warm revisit = new page in the same profile, re-enter = «Avslutt til hovedmeny» → start again in the same page.

| build | cold | warm revisit | re-enter |
| --- | --- | --- | --- |
| zip in `/stue/` (static server) | 13,2 s (click → running 12,4 s) | 3,0 s | 2,0 s |
| dev server 5319 | 13,5 s | 3,1 s | 2,0 s |

fps at «middels», 1920×1080, pixel ratio 1, dynamic scale stayed 1: **60 fps in every view** (vsync), p99 16,8–16,9 ms.
GPU-bound cost per frame (render + 1-px readback):

| view | original day / evening | + 5 new products day / evening |
| --- | --- | --- |
| spawn (dining) | 5,7 / 5,8 ms | 6,2 / 5,6 ms |
| sitting area | 7,7 / 7,4 ms | 8,3 / 7,4 ms |
| high wall (vitrines, Octo) | 7,5 / 6,6 ms · 230 calls 240 k tris | 8,6 / 7,4 ms · 283 calls 298 k tris |

Shader programs 57 → 59 with the new products (slat glow + vitrine glass). Every game script also logs 60 fps.

## Remaining (not fixed here)

1. **Pendant swap keeps each product's default drop** instead of re-fitting it over the table: Secto 1,25 (65 cm over
   the table), Octo 1,20, the other pendants 1,0–1,1 (85–100 cm). Placement fits only on «Plasser» – for all pendants,
   not new. INTERACT / UI (`_fit` could reuse `Placement._dropOver`).
2. **Octo profilePoints** – add-lamps re-measured the lower third (0,7 % vs 1,9 % width error) and asked for new
   `params.profilePoints` / `bottomD`; not applied (catalogue data decision; the test «all 14 new products kept» pins the
   research values). Same for the optional birch colour (#dcc6a2 → ≈ #e6d6c4).
3. **Recliner style params** (add-seating's table: body / sides / headStyle / backSeams / footrest …) are still parsed
   from `params.notes`; they look right, but the research JSON should carry them.
4. **Shipping** («frakt 999 kr» for the Bohus vitrines, also Signature) is not in the shopping total – the panel only
   parses freight for solskjerming.
5. Vitrines have `params.led` but no product `light` → no on/off/dimmer in the Inspector, no bulb in the list (no
   verified lumens). BESTÅ «Høyglanset/svart» uses `black-oak` for the body (high-gloss lacquer would be closer).
6. Evening: the east backdrop through the kitchen window k2 stays fairly bright next to the dark blue-hour south
   windows (left in `p-octo-4240-taklampe-o54-b.png`) – only the south backdrop has an evening photo; LIGHTING / SHELL.
7. Old: build warning `estimateShading`; registry `fallbackModel` takes the mount from the Def, not `spec.mount`
   (add-catalog), and `mergeSpec` does not pass `spec.mount` (not needed any more with the Inspector fix).
8. `src/data/room-spec.json` ≠ normaliser output only in 17 decor `notes` texts (an older fixes.mjs wrote «… – fix-core
   r1» and «midt på»); harmless – regenerate with `--only=room-spec` if the data owner wants them equal.
   `research/room-spec.json` still has the old lumens (fixes.mjs carries the new ones).

## Tools in `.shots/add-verify-add/`

`lib.mjs`, `place14.mjs [regex]` (14 placements), `swap.mjs` (◀ ▶ + recolour), `shop.mjs` (shopping list vs research +
overview), `autoface.mjs` (vitrine back to the wall), `slots.mjs` (which lights hold the spot slots), `cord.mjs` /
`line.mjs` (pendant part bounds, the «line under the lamp» = table leaf seam + window frame, not geometry),
`perf.mjs` (load + fps; `BASE`, `PATHNAME`, `TAG`, `SCRATCH`), `r1/` (regression logs and screenshots), `dist/`
(sub-folder run).
