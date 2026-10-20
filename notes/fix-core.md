# fix-core – round 1

Fixer for the «core» area (home/index, materials, existing, registry, SceneSync, Editor, DesignState, Acoustics, Saves,
Game, main, panelKit/panels.css/ui.css, Menu, Loading, Hud, data/**, catalog/**, README, deploy). Tests and screenshots:
`.shots/fix-core-r1/` (own dev server on 5251 without HMR: `vite.nohmr.mjs`, so other fixers' edits do not reload the
test pages; `lib.mjs` / `plib.mjs` = the review helpers pointed at 5251).

## Result per finding

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Colours/materials of existing items (dining chairs, dark cushions, TV table top, bouclé) | fixed | `s-20261018_082827.png`, `s-20261018_082829.png`, `s-tvtable.png`, `01-play.png` |
| 2 | Tabletop and shelf decor missing | fixed (17 items) | `s-20261018_082827.png`, `s-20261018_082829.png`, `s-tvtable.png`, `s-shelf.png` |
| 3 | Start screen: Enter discards the returning user's work | fixed | `m5-menu-named.png`, `m3-menu-after-quit.png`, `t-menu-saves.mjs` [3]–[6] |
| 4 | Loading tip «trykk E» | fixed (tip text) | `src/ui/Loading.js` |
| 5 | «Forlate nettstedet?» on every reload | fixed | `t-menu-saves.mjs` [11]: no dialog, a change 100 ms before reload is saved |
| 6 | See-through panels | fixed | `p2-zoom.png` (Inspector over the plan view) |
| 7 | Catalogue text polish | fixed in data; icons need UI | `t-shop.mjs`, `s1-shopping.png`, `src/data/scripts/fixes.mjs` |
| 8 | Undo of «Åpne»/«Importer» overwrites a named design | fixed | `t20-undo-open.mjs`: after Ctrl+Z active = B, A keeps its content |
| 9 | No «Fortsett» after «Avslutt til hovedmeny» | fixed | `t-menu-saves.mjs` [3], [10b] |
| 10 | Opening a design deletes unnamed autosaved work | fixed | `t-menu-saves.mjs` [7]: kept as «Forrige økt (…)» |
| 11 | Corrupt design files freeze the tab / empty the room | fixed | `t7b-garbage.mjs`: every case < 1 s (was HUNG), non-designs refused |
| 12 | Invalid `?pos=` → NaN player | fixed | `t11-params.mjs`: ignored with a warning; pos inside the island → free floor |
| 13 | «Forrige økt» pile-up | fixed | `t-menu-saves.mjs` [9] (3 kept), [10] (env-only not kept) |
| 14 | ~30 products with wrong variant prices | fixed | `t-shop.mjs`: Daisy Ito Stone 13 799, Rosa 2 × 375 = 750, VECKLARFLY hvit 699 |
| 15 | Slat panels rated as batten-mounted | fixed (data) | `t-acoustics.mjs`: 6 × Akupanel 300 + Gabel = 0,645 s (yellow) |
| 16 | Wall-mounted sideboards float | **not fixed** – needs INTERACT/TABLES (below) | – |
| 17 | Shopping list: extras, packs, freight | data + `catalog.purchaseOf()`; ShoppingPanel must use it | `t-shop.mjs` (quantiMini3: 2 packs 599,80; rosa2 + 2 inserts 658) |
| 18 | Doubtful price data | fixed in data + `priceOf().confidence`; display needs UI | `t-shop.mjs` (dalvik), fixes.mjs |
| 19 | Names with one variant's colour, default variants, H&M image | fixed except the H&M image | fixes.mjs |
| 20 | Shader compiles freeze the game 4.7–13.5 s | fixed | `placeflow.txt`: ghost phase max 17–550 ms (was 4 735–13 489) |
| 21 | Ghost clones every material as transparent | fixed | same |
| 22 | Game.load blocks 10–17 s | fixed | `load-final`: longest task 650 ms (was 9.6–16.1 s); 0 frames > 100 ms after start |
| 23 | Too many program variants | fixed for home/materials.js | 40 programs at start (66 items, most remaining ones are custom model materials), +17 warm-up variants cover every catalogue material |
| 24 | Procedural textures on the main thread every start | partly: IndexedDB cache + start-screen prefetch, no workers | `t-texcache.mjs`: «Lager materialer» 1 272 ms → 39 ms on the 2nd start |
| 25 | Før/etter rebuilds everything | fixed | `t-compare2.mjs`: toggle 3–5 ms, max frame ≤ 26 ms (was 253–832 ms / 1.8–5.2 s) |
| 26 | game.fps uses the clamped dt | fixed | `t-fps.mjs`: throttle ×12 real 26,6 / game 27,2 (was 15 / 30) |
| 27 | «middels» pixelRatio 1.5 | fixed (cap 1.25, scale up to 1.5, GPU probe) – not measured on a laptop | `Game._basePixelRatio/_maxScale/_probeGpu` |
| 28 | Nothing prepared on the start screen | fixed for modules + textures (no shaders) | `main.js prefetch()`, `t-texcache.mjs` |

No console errors in any of the runs (warnings only: the `[dev] ?pos=…` notices).

## What changed

**Saves / DesignState / menu (bugs)**
- `DesignState.load(json, { keepHistory, label, meta })`: a load step also records `meta`, so undo/redo of «Åpne»/
  «Importer» brings the previous name back. `Saves` listens for undo/redo and lets `store.active` follow the restored
  name (`_followName`) – autosave never writes one design's content into another.
- `Saves._beforeSwitch()` (load, loadOriginal, importText): writes a pending autosave of a named design first; unnamed
  work with real changes becomes «Forrige økt (dd.mm. hh:mm)» (`lastKept`). `archiveSession()` replaces the old
  chooseStartDesign copy. At most 3 «Forrige økt» (oldest first, never the active one); sessions that only changed
  light/time are not kept (`isWork`). A failed write prunes the old sessions and retries; then `onWriteError` → toast.
- `Saves.pending` / `flush()`; Game writes a waiting autosave on `pagehide`, when the tab is hidden and in
  `beforeunload` – the browser only asks when the write fails.
- Start screen: `Menu.setContinue({ name }|null)` – the primary (Enter) button is «Fortsett: <navn>» / «Fortsett siste
  design», the second «Start med stua slik den er i dag»; `onPlay(mode)`. main.js re-evaluates it before every show
  (also after «Avslutt til hovedmeny»).
- Validation (`normaliseItem/normaliseWall/normaliseShading`, `looksLikeDesign`, `setDesignLimits` registered by
  createHome from the model registry): dims clamped to the archetype's dimsRange (×0,5 … ×1,6) and to 12 m, positions
  to the room ± 3 m, number params to a wide band around their slider range (0 = «none» stays), non-finite/absurd numbers
  dropped, max 300 items / 80 wall elements, unknown element types / shading archetypes / window ids / paint surfaces /
  colour names dropped, wall element geometry (u/v/w/h, slat sizes, counts …) clamped. `importText` refuses files that
  are no design (`{items:null}`, `{items:{}}`, `{items:[]}` without the app marker, `{hello:1}`) – the Norwegian error
  message is unchanged.
- `devOverrides`: `pos` only with three finite numbers, `yaw`/`pitch` only finite (warnings otherwise);
  `Game._freeFloor` moves a dev start point that stands on furniture to the nearest free floor point.
- Loading tip: «Pek på en vegg eller et møbel og venstreklikk for å velge det.» + «Trykk E (eller klikk) for å åpne og
  lukke dørene.»

**Performance**
- `materials.js`: every material binds map + normalMap + roughnessMap (1×1 neutral textures for untextured kinds,
  `flat`, `emissive()`, `paint()`), so textured and untextured kinds share one program per side/transparency. Sheen
  (MeshPhysicalMaterial) only on «høy». `ghostMaterial()`, `placeholderMaterial()`, `warmupMaterials()`.
- Texture data is generated as typed arrays (`genSet` → `finishSet` with DataTextures, same orientation as before) and
  cached in IndexedDB (`interiorspillet-tex`, key = id@RES#hash of the generator sources – editing a generator
  invalidates it; old keys are pruned). `prepareMaterials(kinds, cb, { idle })`; main.js prefetches the room's kinds and
  then all kinds while the start screen is shown (`home/index.js prefetchHome`).
- `SceneSync`: new/rebuilt models (and the wall group, ghosts, recolours) are compiled with `renderer.compile` and show
  flat placeholders (or hide meshes with their own materials) until their programs report ready – no frame waits for a
  link. `prepareObject(obj)` does the same for anyone else. Ghosts use one translucent material per colour (the glass
  program) and precompile the real model for the click. `syncAll` diffs (unchanged items stay, moved ones move), models
  removed by a load are parked (≤ 48) and reused, the wall is rebuilt only when its elements change, the env only when
  it changed (that was the 1.4 s frame on «Før»). `syncAllAsync` (8 ms slices) for the loading screen.
- `Game.load`: Editor first, then every program of the scene plus `sync.warmUpGroup()` (all material variants, plain
  + instanced) compiled in parallel with progress «Forbereder grafikken», then the first frame, then a 5-frame GPU probe
  that lowers the start resolution on a slow GPU (> 16 ms). Load on this machine: 12,7–14,3 s first visit (was
  19–29 s), 2,6 s on a revisit; the warm-up costs ~4 s of the first load but removes every mid-session compile.
- fps on real elapsed time; dynamic resolution ignores windows with a frame > 250 ms and may scale up to the preset's
  pixel ratio; «middels» starts at ≤ 1,25.

**Data** (`src/data/scripts/fixes.mjs`, applied with `--apply` and by `normalize-data.mjs`, idempotent)
- room-spec: dining chairs #c8c8c6, dark cushions #4c4c4f, TV table top `ceramic` #3f3f41; 17 decor items (jute mats,
  candlesticks with sage candles, tealight glasses, wooden box, two glass globes, three candles in glass, shelf lantern,
  stone stack, bottle vase, plants, tealight holder). `existing.js` respects explicit `kind`/`shape`/`weave`/`pattern`.
- bouclé generator: loops bunched in ~8 mm clumps with shaded crevices (reads at 2–3 m), stronger normal.
- catalogue: variant `priceNok`/`salePriceNok` for all products the review listed (plus WoodUpp Charcoal, Oslo Wood
  stands, Loke dark grey …); `priceOf` – a variant with its own price is on sale only with its own sale price;
  `priceConfidence` ('checked'|'check'|'estimate', also per variant); campaign rule: the campaign price is used whenever
  the store showed it; when only a category list / search showed it, or the note says «sjekk», confidence = 'check'
  (Dalvik: 8 344 kr without «tilbud», verified false; Protre and H&M verified false; zipscreen fra-pris 8 634 kr,
  estimate; Luxaflex estimate). `requiredExtras` (inner cushions for 13 covers), `packSize`/`packPriceNok` (Quanti Mini),
  `shippingNok` (Gardinmaker 390 kr). Slat panels: Akupanel 240 0,86, 300 1,1, Akupixel 0,22, Protre 0,86 m² (rett på
  vegg) with `absorptionNote`. Names without one variant's colour / English, comma decimals (H24,4 / H23,5 / 180x43,5),
  brands («Storm (Bohus Exclusive)», «Bohus», casing), WoodUpp/Fibrotech variant names in Norwegian, default variants
  EKENÄSET/SALTSJÖBADEN = the photographed one, the Gardinmaker stock photos removed.
- `catalog/index.js`: `priceOf` (+ confidence, approx), `extrasOf`, `purchaseOf(product, vi, qty)` (packs, extras,
  freight), `CATEGORIES[].iconSvg` (drawn category icons in the ui/icons.js style).
- `ui/panels.css`: opaque panels (`--ip-panel-bg`), `[data-sticky]` / `.is-sticky` blocks get the same solid colour.

## For the other areas

- **UI (CatalogPanel, ShoppingPanel, Inspector, SavePanel)**:
  - show `priceOf(p, vi).confidence`: 'check' → «sjekk prisen ved kjøp», 'estimate' → «ca. …» (Luxaflex, zipscreen)
    in cards, detail and shopping list;
  - ShoppingPanel: use `catalog.purchaseOf(product, vi, qty)` – whole packs (`packs`), the `extras` lines (inner
    cushions; priceNok null = «pris ukjent»), and `shippingNok` once per store;
  - CatalogPanel tabs/placeholder: `svg(c.iconSvg)` instead of `ICONS[c.icon]` (Skjenker, Tepper, Puter og pledd, Smått
    now have fitting icons);
  - Inspector «Lyd»: show `product.absorptionNote` when present (which mounting the m² assumes);
  - SavePanel «Åpne …?» dialog: the unnamed work is now kept as «Forrige økt (dato)» by Saves (`saves.lastKept` holds
    the name after load/loadOriginal/importText) – the text «Det forsvinner fra skjermen» can say so, or the dialog
    can go.
- **WALLS (WallPanel previews)**: call `editor.sync.prepareObject(group)` after `applyWallDesign(hw, elements)` for a
  preview – the walldesigns' own materials (vertex colours, canvases) then compile without blocking a frame.
- **INTERACT (Placement)** – finding 16: a floor item whose `params.base === 'wall'` (BESTÅ veggmontert, Bolia Case) must
  stand with its back against a wall: snap the back to the nearest wall within ~0,5 m, otherwise status 'blocked'
  («må henges på en vegg»). Alternative (TABLES + FOUNDATION): give those products mount 'wall', let the sideboard
  builder use the wall origin (back centre, vertical middle) when `spec.mount === 'wall'`, and add the exception to
  `tools/test-design.mjs` line 86. I did not change the data mount because the normaliser/test contract is «product mount
  = archetype mount» and the builder's origin would be wrong.
- **tools/test-design.mjs (integrator)**: two count checks are now out of date because of the 17 decor items – line 54
  `spec.furniture.length === 45` → 62, line 131 `originals.length === 45 - 1 + 5` → 66 (better: derive from
  `spec.furniture`). Everything else passes (75/77).
- **research/**: `research/room-spec.json` / `research/catalog/*.json` / `research/room-spec-notes.md` are not mine –
  the corrections live in `src/data/scripts/fixes.mjs`, which `normalize-data.mjs` now applies after copying, so a re-run
  keeps them. Update the research notes text for the TV table (ceramic, #3f3f41) and the chairs/cushions if wanted.
- **H&M image** (`hm-putetrekk-i-boucle-50x50`): hm.com blocks automatic fetching – the image URL must be added by hand.
- **Texture workers** (finding 24): not done – a worker needs its own module file (outside my files) and would bundle a
  second copy of three.js; the IndexedDB cache + start-screen prefetch remove the cost from every start but the very
  first (and the first one happens behind the start screen when the user waits there).
- **Laptop check** (finding 27): the 1,25 cap / probe / scale-up are not measured on an Iris Xe-class laptop.
