# fix-walls r1 – report

Fixer for «walls» (`src/models/walldesigns.js`, `src/ui/WallPanel.js`, `src/ui/PhotoCompare.js`). Scripts and
screenshots: `.shots/fix-walls-r1/` (dev server on 5248 with `vite.config.mjs` there = the project config without HMR).
New asset files: `public/img/forslag/thumb/N1.jpg … N19.jpg` (static thumbnails, made by `gen-thumbs.mjs`).

Measurements were taken while other fixers ran headless browsers on the same GPU (CPU load ≈ 45 %), so single long
frames of 200–500 ms show up in every run, also with nothing of mine running (`probe-own.mjs`: WallPanel's own
per-frame work is ≤ 7 ms, 17 ms in total over 1 246 frames with the panel open and 12 flips).

## Findings

| Finding | Status | Evidence |
| --- | --- | --- |
| Multi-second freezes when browsing (live thumbnails, first builds, shader compiles) | fixed | see «Performance» below |
| «Lys som på bildet» gives a night scene | fixed | `flow-compare.mjs` [compare B]: light 18.10 kl. 08:30 auto, spots on; `cmp-0-0830.png` vs `cmp-0-evening.png` |
| «Rediger» goes stale when flipping | fixed | `flow-edit.mjs` [rediger flip]: rows «Sjakkbrett av spiler» + preview note; `e2-rediger-flipped-P.png` |
| «Lys som på bildet» adds undo steps | fixed | `flow-compare.mjs`: canUndo false while on, after Esc and after closing; design env unchanged |
| E: lamp missing, door seams | fixed | `cmp-E-under.png` (lamp, books, vase, 4 visible doors, no stripes) |
| C curtain flat / heading / niche end | fixed | `cmp-C.png`, `cmp-C-top.png` |
| G2 hooks invisible | fixed | `cmp-G2-hooks.png` |
| T black grooves | fixed (rendering rule, see below) | `cmp-T-pitch.png` |
| Striped light under slat bands (E, N3) | fixed | `cmp-E-under.png` (paint under the band is clean) |
| Sticky header lets content show through | fixed | status bar no longer overlays the scrolling body: `e1-rediger-K.png`, `e4-added-art.png` |
| «Mine forslag» codes M1 … / misleading note | fixed (name on other browsers: needs DesignState) | `flow-edit.mjs` [custom]: «Egen 2», «Egen 1» after a deletion; new note text |
| Compare for proposals without a montage overlays «Før» | fixed | `c4-compare-N1-3d.png` (Bare 3D, «Sammenlign med bildet», «Vis før-bildet»), `c5-…`; custom based on B → B's montage (`flow-orbit.mjs`) |
| Tag under the wall panel after «Bytt side»; ghost hint | fixed | `flow-compare.mjs` [swap]: tags end at x 854 < panel 874; `.ix-keys` hidden |
| N14 bench: table 1.2 m away | fixed | `e7-N14-tip.png`, `e8-N14-table-moved.png`, [bench] table x 5.37 → 4.245, wall-side chairs hidden, one undo step |
| New elements on top of existing ones | fixed | `placeElement` (least overlap, nearest the middle / the selected element); `e4-added-art.png` |
| Cards vs status bar RT60 differ | fixed | `flow-edit.mjs` [rt]: A 0,68/0,68, P 0,72/0,72, H 0,81/0,81, X 0,80/0,80, G2 0,73/0,73 |
| «Tilbakestill» while previewing discards the preview on cancel | fixed | `flow-edit.mjs` [reset cancel]: preview B still shown, design unchanged |
| Header takes ~45 % / content hidden on tab switch / «Bruk» jumps | fixed | status 141–160 px of 662 at 1366×768 (was ≈ 300); scrollTop 0 on tab change; «I bruk i designet» placeholder |
| Clicking the wall / V does not bring the wall into view | fixed | `flow-open.mjs`: from 0.7 m → montage standpoint, wall left of the panel (`o2-panel-framed.png`, `o3-flip-B2.png`); Esc walks back to 3.9, 6.4 |
| Stale colour after wood change; duplicate SAND | fixed | [wood]: inputs show #6b4a33 after «Valnøtt»; palette duplicates [] |
| Compare panel covers the montage; HUD/outline show through; «RT60», «Runde 1» | fixed | `c1-compare-B-bar.png` (slim 46 px bar), compass/room banner/key bar hidden, [highlight] comparing false; cards «Etterklang ≈», «Første forslag» |
| Tapestry (G) ~1 s texture building | fixed | in the game G builds in 35 ms (`probe-tap.mjs`); canvases are built once by the warm-up and kept (LRU 48) – `probe-flip.mjs`: preview G 12 ms sync |

## What changed

### Performance (the two «high» findings + tapestry)
- **No live thumbnails for built-in proposals.** N1–N19 have static JPGs (`img/forslag/thumb/<id>.jpg`, rendered in the
  game through the montage camera with the montage light). WallPanel derives the path; a missing file (new proposal)
  falls back to a rendered thumbnail.
- **«Mine forslag»**: the thumbnail is taken from the scene on the frame after «Lagre» (no temporary build) and stored
  with the proposal (`thumb` in localStorage). Older ones are rendered one at a time, only for visible cards, ≥ 450 ms
  apart, after `renderer.compileAsync` of the temporary design.
- **Warm-up**: at construction (end of loading) one batch with a proposal per shader-heavy type (curtain, moss, LED,
  tapestry) is built and compiled with `compileAsync`; then every proposal is built once in `requestIdleCallback`
  (fills the texture/material caches), and one material per new program is kept alive so the program is not
  released with the throw-away design. Afterwards one 48×36 render through the montage camera uploads the textures
  the wall view shows.
- **Fewer shader programs**: the sideboard lamp shade uses `emissive()` (was a unique program), the tapestry is
  front-sided (same program as the art prints), the curtain is front-sided with vertex colours (same program as the
  moss walls – `probe-share.mjs`: both program 18). New programs from the wall designs: moss/curtain, LED glow, and
  the fringe's shadow-depth variant.
- Numbers (`.shots/review-montage-r1/flow-w10.mjs` / `flow-w3.mjs` run against 5248, and `perf-open.mjs`):
  - 30 s after V: total long frames 8 277 ms → 576 / 1 381 / 4 247 ms in three runs, worst frame 3 991 → 316 / 421 /
    979 ms, no programs compiled after V (57 → 57), no thumbnail renders (queue 0).
  - First apply: C 5 892 → 233 ms, G 5 505 → 429 ms, B 4 961 → 260 ms (`flow-w3.mjs 'C,G,B,E,N7,M'`, programs created
    0 except the 1 fringe depth program).
  - All 40 proposals with → (700 ms apart): long frames 2 341 ms (one C freeze) → 593 ms in total (`perf-open.mjs
    after3`); `probe-flip.mjs`: synchronous preview cost 1–22 ms, frames after it ≤ 83 ms.
  - The one cost left is compiling those few programs once: a 2–3 s frame right after loading (behind the
    loading screen when the GPU is quick enough). See «For LIGHTING».

### WallPanel
- Status bar moved out of the scroll body (between header and body, nothing scrolls under it): code line «FORSLAG B ·
  FORHÅNDSVISNING · NR. 2 · ANBEFALT» / «ENDRET FRA FORSLAG P2 · I BRUK», title on one line, one meta line, one row
  [Bruk dette forslaget | I bruk i designet] [Sammenlign] [Hele veggen | Gå tilbake], tabs. Tab change resets scroll.
- «Hele veggen» / opening from close up: walks the player (0.6–1.2 s glide) to the montage standpoint with yaw/pitch
  solved so the whole 3.91 × 3 m wall is centred in the area the panel leaves free; walks back on close unless the
  player moved (keys/mouse) since. From orbit/plan it puts the player there and flies back to walking. Not in photo mode.
- Cards: «Etterklang ≈ x s» from the same `computeAcoustics` as the status bar (cached, cleared when furniture/windows
  change); «Runde 1» → «Første forslag».
- Rediger: flipping re-renders the element list (and resets the selection); a param change that changes other values
  (wood → colour) re-renders the editor; palette deduplicated by hex; new elements via `placeElement`; «Tilbakestill»
  keeps the preview when the dialog is cancelled; no amber outline while the photo comparison is open.
- «Mine forslag»: code «Egen n» (first free number), `basedOn` stored (ShoppingPanel/PhotoCompare use it), toast with
  the name, note: «Mine forslag lagres bare i denne nettleseren – de følger ikke med når du eksporterer designet til
  fil …».
- N14 (any bench element): «Flytt spisebordet inntil benken» in the details – one transaction: commits the preview,
  moves the table to 5 cm from the bench front, moves the end/far-side chairs and things on the table with it, hides
  the chairs between bench and table.

### PhotoCompare
- «Lys som på bildet» is a LightManager override (setTime/setMode/setBuiltIn), never `design.setEnv`; restored from
  `design.env` on close; dropped if the user changes the light meanwhile. Montages: `lighting.js` `PHOTO_ENV` (the
  «Før» photo, 18 Oct 08:30, auto) + spots and LED on; room photos: their own date/time. On by default.
- Proposals without a montage: Bare 3D (wipe 0), title «Sammenlign med bildet», «Vis før-bildet» toggle (the wipe
  remembered for the montage proposals); custom proposals with `basedOn` show that montage with a note.
- Starts as a slim bar (title, wipe slider, «Vis før-bildet», «Lys som på bildet», more/less, close); the full controls
  are one click away. Tags stay inside their half and outside docked side panels; compass, room banner and key bar
  hidden while comparing (`#ui-root.pc-active …`).

### walldesigns
- Sideboard: 6 mm door gaps over a near-black reveal; table lamp (LAMPS `table-mushroom`, disc foot, warm glowing
  shade, light into `userData.model.lights`) when `el.lamp === true`, `decor` contains 'lamp', or automatically when the
  design has no LED strip/wall lamp (E yes; N3, N15, N19 no). Editor: «Bordlampe på skjenken». Montage staging: two
  books (white/sage), slim white vase, lamp at the right. `decor` may be an array (books/vase/bowl/lamp).
- Curtain: «Skinne med dekklist» (default) – an 8 cm cover profile 2A + 4 cm deep hides the wave heads, returns to the
  wall at the niche end; the fabric wraps back to the wall at u = 0; fold contrast: normals tilted ×1.7 + fold AO in
  vertex colours. «Synlig skinne» keeps the old rail (editor «Skinne»).
- Hooks: on the face of the slat wall/panel they hang on (they were inside the slats), 7 × 9 cm light grey plate,
  dark slot, wooden flap folded out (editor «Platefarge»).
- Thin flush slats (standoff < 5 mm, slat ≤ 10 mm, gap ≤ 10 mm) show standard black felt in a dark tone of the slat
  colour (T); any other felt colour is kept as chosen.
- Vertical slat bands that float above the floor get a 12 mm bottom end trim (closes the open slat ends: no striped
  light leaks onto the paint below, E/N3).
- `placeElement`, `moveElement`, `sideboardHasLamp` exported; `elementValues(el, elements?)`; TEX_MAX 48.

## For other areas

- **LIGHTING**: a new material feature combination costs 1.5–10 s to compile here (ANGLE D3D11, 22 pooled lights with
  shadows), and even with `compileAsync` + KHR_parallel_shader_compile the main thread gets one 2–3 s frame while the
  GPU process links – probably a synchronous GPU call per frame (exposure read-back?) waiting behind the compile.
  Worth checking; fewer pooled light types would make every program cheaper. The spot hot streaks on the curtain (C)
  are the lighting finding, not changed here. The 3D spots render near-white, the montages show amber pools (WB).
- **FOUNDATION (layout.js)**: `photoCameras` drops unknown fields; PhotoCompare already reads `pc.env` (per-photo light,
  e.g. `{ hour, month, day, mode, builtIn }` for `0_for`) if layout passes it through. Data (`wall-proposals.json`):
  E's sideboard could say `"lamp": true` explicitly (the automatic rule covers it today); the stored `rt60` values
  are no longer shown (cards compute them).
- **DesignState**: `wall.custom` (walls.md #1) is still needed for the name of a custom proposal in exported designs /
  other browsers; WallPanel would read/write it in `loadCustom/saveCustom`.
- **INTEGRATOR**: panels.css `#ui-root.pc-active .wp-panel .wp-status { position: static }` is now harmless (the status
  bar is not sticky any more). The HUD room banner («Stue») appears when «Hele veggen» moves the player into another
  zone – expected.
- If proposals are added without a montage: run `node .shots/fix-walls-r1/gen-thumbs.mjs <ids>` (dev server on 5248)
  to make their thumbnails; without one the panel renders a thumbnail itself (slower).
