# fix-ui – round 1 (reviewer findings for the «ui» area)

Fixer for `src/ui/Toolbar.js`, `CatalogPanel.js`, `Inspector.js`, `SavePanel.js`, `ShoppingPanel.js`, `AcousticsWidget.js`,
`controlsHelp.js`. Scripts and screenshots: `.shots/fix-ui-r1/` (`lib.mjs` = the integrator's Playwright helpers on port
5250, plus a stub for Vite's HMR socket so other fixers' edits cannot reload a page mid-test). All end with `[errors] 0`.
Contracts in ARCHITECTURE.md are unchanged (constructors, `open/close/toggle/isOpen/update/dispose`); only additions.

## Findings

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Shopping list drops the wall for a saved «Mitt forslag» | fixed | `s1-shopwall.mjs`: K → «Lagre som mitt forslag» → wall `Mitt forslag «K – min variant» (basert på forslag K …)`, 12 500 kr, total 12 500 (was null / 0). `s13-wall.mjs` (review t13): B2 + element + save → 15 700–17 000 kr. Screenshot `s1-after-custom.png` |
| 2 | «Bytt modell» ▶ moves after the first swap | fixed | `s5-swap.mjs` (real mouse, 3 clicks on the same spot): Ronda with own colour ▶ y 139→139→139→139, names Beetle, Meno, Ellis (was 299→248, Beetle ×3); existing «Svingstol (ved vinduet)» 139 ×4, Vilde, Ronda, Beetle; scrolled down: ▶ still at y 139; keys `.` `.` `,` → Meno, Ellis, Meno. `s5-after-*.png` |
| 3 | Design panel: edited room shown as «Original – Aktiv» with an «Åpen» button | fixed | `s10-saves.mjs`: fresh room → only «Original · Åpen nå» (badge, no button); after edits → «Ulagret design · Åpen nå – Endret fra Original i dag kl. 20:18 · 2 nye ting · vegg P2 · solskjerming på 1 vindu» [Lagre …] + «Original» [Åpne original] (asks first: dialog «Åpne originalen? … Ctrl+Z henter det tilbake»); after saving with a 64-character name: the name wraps, badge «Åpen nå», no disabled «Åpen» button. `s10-02-edited.png`, `s10-04-saved.png` |
| 4 | Shopping list: wrong quantity/price for an edited wall | fixed (WallPanel header: WALLS) | `s1-shopwall.mjs`: P2 reduced to 4 × 3 → «ca. 5 000 kr, regnet om fra forslaget (P2: ca. 7 500 kr)», material «Akupixel 60 × 60 cm akustikkfliser – 12 stk (4 × 3) – forslaget hadde 18 stk», original list in a «Materialliste for forslag P2 slik det var» fold. `s1-after-edited.png` |
| 5 | Acoustics badge covers «H Hjelp» | fixed | `s9-corner.mjs` at 1366×768, 1280×720, 1920×1080, 1100×700, 1024×700: overlap hint/badge 1751 px² → 0, badge/toolbar 0, element at the hint centre = canvas (was the badge). `s9-after-1280.png` |
| 6 | Inspector: warning banner pushes content down; variant dot stays; opened part cut off | fixed | `s6-inspector.mjs`: «Trekk» opened → swatches bottom 560 ≤ body bottom 581 (scrollIntoView with the sticky box as scroll margin); palette colour clicked → swatch y 514 → 513 (smooth-scroll settle), variant highlight off, note «Du har valgt egen farge … [Butikkens farger]» BELOW the colour rows, «egen» marker on the part row, «Egen farge · utgangspunkt: Adore 68 …» under the variants. `s6-after-02-colour.png` |
| 7 | Handleliste header uses a map pin | fixed (WallPanel button: WALLS) | panel title now has the toolbar's bag icon (`s2-shopping-shading.png`, `panels/50-shopping-full.png`) |
| 8 | Inspector size sliders / «Bytt modell» push furniture through walls, windows, ceiling | fixed | `s7-grow.mjs` (review t14): Nola 140 w/d to max → bmax x 6.91 / z 11.92 (window wall 6.92, west wall 11.93; was 7.5 / 11.99); swaps Wolin/Øland/Acro → bmax x ≤ 6.57, back stays at the wall (z 11.92); Mara canvas w/h max → w 2.40, h 2.36 (slider max = wall top over its span − 4 cm), centre 5.72/1.21, bbox y 0.03–2.39, x 4.52–6.92 (was y up to 3.42, x 7.40). `s7-02-art-grown.png` |
| 9 | Shopping list drops the wall after «Lagre som mitt forslag» (bugs lens) | fixed | same as #1 (`s13-wall.mjs`: «saved custom» shopWall 15 700–17 000, undo/redo chain keeps it) |
| 10 | Toolbar buttons keep focus – Enter repeats | fixed | `s8-focus.mjs` (review t17): after a click focus = canvas; Enter after 2nd Katalog click → catalogue stays closed; downloads after «Bilde» + Space + Enter = 1 (was 2); history after «Angre» + Space + Enter 2 → 2 (was 2 → 1) |
| 11 | Shading priced differently in the list and the window panel | fixed (shared module: SHADING) | `s2-shading.mjs`: every solskjerming product (19) on every window (6), variant 1: WindowPanel total vs ShoppingPanel total – 114 compared, 0 differ (≤ 10 kr rounding of made-to-measure prices); window panel lines and warnings printed in the list/CSV/print (e.g. «Ferdigmål 140 × 155 cm: 2 stk. side om side … OBS: 25 cm for kort»). The terrace door no longer warns «For kort» for made-to-measure Duette |
| 12 | Shading products are grey boxes in the catalogue | fixed in the catalogue (dev/models.html: owner of src/dev) | `s3-thumbs.mjs`: 8 shading products render as the real blind/curtain/screen in a studio window (`s3-after2-sheet.png`), no «unknown archetype» warnings any more (also the shopping list rows show them) |
| 13 | «Velg vindu» throws away product and variant | fixed | `s4-catalog-window.mjs`: VECKLARFLY «Hvit (aluminium)» → «Velg vindu» → real click on the window glass → `win-s1` = `{ productId: ikea-vecklarfly-persienne-140x155, variantIndex: 1, venetian, recess }`, one undo step «Solskjerming: …», window panel opens on it; the detail view also lists the 6 windows (size + what they have now) as buttons; a later window click without «Velg vindu» applies nothing. `s4-02-pending.png`, `s4-03-window-applied.png` |
| 14 | Inspector shows rows for parts the model doesn't have | fixed | `s14-deadparts.mjs`: all 141 non-shading products placed and selected – rows without meshes 0, model parts without a row 0 (was 94 products). E.g. Basoon side table: Plate, Ben; Akupanel 240×60: Spiler, Bakside; Frigg rug: Grunnfarge |
| 15 | Shading rows link to the default variant's page | fixed | `s2-shading.mjs`: url check ok for all 114 rows; text output shows `…/vecklarfly-persienne-hvit-90583705/` for «Hvit (aluminium)» |
| 16 | Thumbnail renderer warm-up during loading (2nd context + PMREM ≈ 5 s) | fixed (pre-rendered images not done) | `s12-perf.mjs` with a getContext spy: ONE WebGL context during loading (was 2 + PMREM(RoomEnvironment)); the thumbnail context is created in idle time after start (or on first request). First catalogue open: 4 thumbnails 1.27 s, longest frame 133 ms. `s15-reenter.mjs`: after Avslutt → «Gå inn i stua» only the new game's own context is created and the 4 thumbnails show in 6 ms (cache kept) |

## What changed

- **ShoppingPanel**: new export `wallEstimate(design, { customProposal })` – built-in proposal as before; edited
  proposal → price scaled per element type (tiles / m² / pieces, weighted by the proposal's area share), material list
  from the current elements (`describeElement` + tile counts / m² / ≈ akupanel count, a checker product line rewritten
  with the new count), notes; «Mitt forslag» (`mitt-…`) → resolved through `editor.ui.wall.proposal(id)` and priced from
  its base proposal (`custom.basedOn` / `custom.baseId` when WALLS adds them, else the «basert på forslag X –»
  description, else the built-in proposal with the same element types); walls that are no proposal → «Egen vegg, pris
  ukjent» + material list. `shadingEstimate(catalog, product, spec, win, { estimate })` uses ONE estimator:
  `models/shading.js` `estimateShading` if SHADING exports it, else `WindowPanel._estimate` (passed in by `list()`), else
  a 1:1 port of it (`shadingSize` + `productSizing`). Rows show the panel's lines and warnings, `pair` («2 par»), «på
  mål», the variant URL and a rendered thumbnail. Header icon = bag.
- **Inspector**: «Bytt modell» is the first, sticky block (fixed height, name/price/brand inside it), links below it;
  scroll to top after a swap; `,` / `.` flip models. Head banner removed; «egen farge» note inline below the colour rows
  (updated in place after a colour pick), «egen» marker per part, variant highlight off with own colours,
  «Butikkens farger» restores only colours/materials. Part rows = parts of `sync.getObject(uid).userData.model.parts`
  with meshes (falls back to `def.parts` when the model says nothing; re-renders when the model is rebuilt with other
  parts). New `_fit(uid, patch)`: caps wall items to the wall's length/top over their span and floor items to the
  ceiling, keeps the back against the wall on swaps when the depth changes, then `placement.constrain()`; used by the
  size sliders (with bisection to the largest size that still fits, slider snaps back and «… er begrenset til … – større
  får ikke plass her»), «Bruk målene», «Bytt modell», «Tilbakestill», variant params, rotation buttons and the wall
  height slider (its max = wall top over the item's span).
- **CatalogPanel**: no `warmUp()` in the constructor; renderer created in `requestIdleCallback` once the game runs; no
  PMREM/RoomEnvironment – hemisphere 1.85 + ambient 0.42 + key/fill/rim/bounce/camera lights, calibrated with
  `s3b-sample.mjs` (Vilde #6e7256 → #6a6d50, cushion #2a2826 → #2e2a27, Frigg rug #d7d1c5 → #dfd9cd; before: #5e6248,
  #32312f, #cec8bc); renderer + cache survive panel dispose. Shading thumbnails via `applyShading` on a studio window
  (wall, reveal, black frame, sky glass; size from the product). «Velg vindu» → `chooseWindow(p, vi)` (pending 60 s,
  applied on the next window selection) / `applyToWindow(p, vi, windowId)` (WindowPanel `_specFor` when available,
  else `productToShadingSpec`; one undo step) and a window list in the detail view.
- **SavePanel**: working-copy row «Ulagret design», «Åpen nå» badge instead of a disabled «Åpen» button, «Åpne original»
  with a confirm when unsaved, names/meta wrap; the list follows design changes while the panel is open.
- **Toolbar**: toolbar and «Før» buttons take no focus from a mouse click (mousedown default prevented, blur after a
  pointer click); Tab focus still works.
- **AcousticsWidget**: badge at bottom 3.3em (above the HUD hint), popover at 6.7em; the badge does not keep focus.
- **controlsHelp**: «, / . – Bytt modell» under «Valgt møbel».

## For other areas

- **WALLS** (`ui/WallPanel.js`): (a) `_saveCustom` could store `basedOn: { id, code }` (or `baseId`) on the custom entry –
  the shopping list then does not have to parse the description. (b) The header drops the price after an edit: use
  `wallEstimate(this.design, { customProposal: (id) => this.proposal(id) })` from `ui/ShoppingPanel.js` (`.text`,
  `.known`, `.note`) so the panel and the list show the same «ca. 5 000 kr, regnet om fra forslaget». (c) «Lagre som
  mitt forslag» uses `icon: 'pin'` (line ≈ 1127) – `check` (or a save icon) fits better.
- **SHADING**: move `WindowPanel._estimate` into `models/shading.js` as `export function estimateShading(product,
  variantIndex, spec, windowInfo)` returning `{ total, totalList, onSale, lines, warns }` and call it from WindowPanel.
  ShoppingPanel picks it up automatically (namespace import); until then it calls `editor.ui.window._estimate`.
- **dev/models.js** (FOUNDATION/integrator): `?cat=solskjerming` still shows grey boxes – build shading with
  `applyShading` on a dummy window like `CatalogPanel._shadingWindow`.
- **README** (integrator): «, / .» = Bytt modell in the Inspector; the Design panel now shows «Ulagret design».
- **Perf, not done**: pre-rendered static thumbnails (`tools/` script → `public/img/katalog/<id>-<variant>.jpg`) – needs
  files outside my area. Live thumbnails still take 0.1–2 s per category on first view (texture generation + compile),
  later views are cached. Without an environment map, polished metal (brass handles on black fronts) looks darker in
  thumbnails than before; the extra camera light keeps the shape readable.
- Observed once during `flow-copy.mjs` (20:24, while LIGHTING was editing `home/lighting.js`): «FRAGMENT shader texture
  image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)» for lamp materials in the MAIN context; gone on the next run
  (0 errors). Not caused by the thumbnail context (no shadow maps/env there), mentioned in case it returns.

## Tests

`s1-shopwall`, `s2-shading`, `s3-thumbs` (+ `s3b-sample` colours), `s4-catalog-window`, `s5-swap`, `s6-inspector`,
`s7-grow`, `s8-focus`, `s9-corner`, `s10-saves`, `s12-perf`, `s13-wall`, `s14-deadparts`, `s15-reenter`; regression:
`flow-copy.mjs` / `panels-copy.mjs` = the ui module's `.shots/ui/flow.mjs` / `panels.mjs` with the HMR stub
(`node .shots/fix-ui-r1/flow-copy.mjs http://127.0.0.1:5250 C:/Dev/Interiørspillet/.shots/fix-ui-r1/flow`) – both
`[errors] 0`. `tools/test-design.mjs`: 75/77 (the 2 failures are room-spec furniture counts, data area).
