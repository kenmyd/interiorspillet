# add-catalog – 14 new products, the «vitrineskap» category

Owner «catalog». Dev server 5314, scripts and screenshots in `.shots/add-catalog/` (`lib.mjs` = the fix-ui helpers
with the HMR stub, pointed at 5314). `node tools/test-design.mjs` → **95/95**.

## What is in

| Area | Change |
| --- | --- |
| Data | `research/catalog-new/*.json` merged by the normaliser: lenestol 16 → 21 (Chicago, Timeout, Zermatt, Grande, Taycan), taklampe 15 → 19 (Secto 4200, 4201 Small, Octo 4240, 4241 Small), new `src/data/catalog/vitrineskap.json` (Sagene, Scandi, Belfort, Signature 1860, BESTÅ wall-hung). 174 products. Every verified field, price, sale price, variant price/url/`paramsOverride`, note, `params.notes` / `shapeNote` / `profilePoints` and image URL is kept (test «all 14 new products kept»). |
| `normalize-data.mjs` | `--only=catalog\|room-spec\|palette\|walls` and `--out=<dir>`; reads `research/catalog/<key>.json` + every `research/catalog-new/*.json` (product → its `category`, a same-id product replaces the older one in place, new ones are appended); category `vitrineskap` after `skjenk`; part plan `storage` (= the table keys); archetype `mounts` (a product may take another allowed mount: `params.base: 'wall'` or research `mount`); subcategory fills `recliner → hvilestol`, every `pendant-* → pendel` (only where missing – so «Bytt modell» on a Secto flips through all 18 pendants, not only the 4 whose research named a subcategory). A re-run reproduces `src/data/catalog/*.json` byte for byte (tested). |
| `fixes.mjs` | absorption of the 5 new hvilestoler 0,8 / 0,85 / 0,9 / 0,75 / 0,7 m² + `absorptionNote` (research had 0,55–0,8); `--apply --only=catalog` leaves room-spec alone. |
| `archetypes.json` | family `storage` («Oppbevaring», parts body/front/top/legs/handle = Korpus/Dører/Topplate/Understell/Grep); `display-cabinet` (storage, mount floor, **mounts [floor, wall]**, «Vitrineskap»); `pendant-slatted` (lamp, ceiling, «Spilelampe (tre)», parts shade/inner/metal/cord, own partLabels Spiler/Innside spiler/Takkopp); aliases vitrine/vitrineskap/glass-cabinet/display-case, pendant-slat/slatted-pendant. Archetype-level `parts`, `partLabels`, `mounts` documented in the file's `note`. |
| `catalog/index.js` | category `{ key: 'vitrineskap', label: 'Vitrineskap', icon: 'cabinet' }` after Skjenker (+ drawn `iconSvg`), `SUBCATEGORY_LABELS` hvilestol/pendel, `archetypeInfo()` → also `mounts`, `ownPartLabels` (partLabels = family + archetype), new `mountsCompatible(a, mountA, b, mountB)`. |
| `ui/icons.js` | `cabinet` icon. |
| CatalogPanel | «Fakta» rows per type (`typeFacts(p, catalog, vi)` export): vitrines – dører, hyller, lukket del nederst, innebygd lys, understell / «Henges på veggen (forslag: underkant 120 cm)»; hvilestoler – fotskammel følger med / innebygd fothviler, stjernefot, nakkepute; pendants without `drop` – cable default/max; `absorptionNote` under the facts. Facts follow the chosen variant (BESTÅ «klart glass»). |
| Inspector | swap ◀ ▶ across mounts of one multi-mount archetype (floor vitrines ↔ BESTÅ): floor → wall hangs it on the wall behind its back with the bottom at `params.mountHeight` (1,2 m), wall → floor stands it under where it hung, back to the wall – then `_fit` / `Placement.constrain` as every swap (one undo step). Variant pick resets params another variant overrides (BESTÅ «klart glass» → back to «røykfarget»; before it stuck). Archetype part names win over the builder's family names (Secto: Spiler / Innside spiler / Takkopp / Ledning). Wood kinds offered for wooden shades. Wall-hung cabinets/shelves: hint shows the bottom height («Underkant ca. 113 cm over gulvet …»). |
| ShoppingPanel | rows inside a store ordered by catalogue category, then name; category icon as the thumbnail placeholder; category in the row tooltip. Prices/links were already per variant (checked: BESTÅ variant url, Timeout per-variant prices). |
| Acoustics | recliner estimate (no data) 0,75–0,85 m² × size, `storage`/`table` families explicitly 0. With the data: hvilestoler 0,70–0,90 m², vitrines 0 (Zermatt alone: 0,86 → 0,83 s). |
| tools/test-design.mjs | 10 categories, icons, mount via `mounts`, new section «New products» (archetypes, counts, every new product's fields vs research, 22 price cases, BESTÅ wall + paramsOverride, Secto drop/light/profilePoints, subcategories, search, normaliser re-run reproduces the catalogue and writes no room-spec), acoustics of recliners/vitrines. |
| README | 174 products / 10 categories, Vitrineskap in the category list, «Bytt modell» across floor/wall vitrines, 95 tests, normaliser options. |

## Verified in the game (port 5314, real mouse/keyboard, 0 console errors)

- `catalog.mjs`: chips «Vitrineskap 5» after Skjenker with its icon; cards 7 799 (før 12 999, −40 %), 20 599, 16 799 (før
  20 999), 13 499 (før 18 299), 1 495 (før 1 695); sort by price; Scandi mocca swatch → 14 399 / 20 699; «hvilestol» → 8
  hits (Avila is a wingback with the word in its name), «secto» → 4; detail views (`c1…c6`).
- `place.mjs`: Sagene against the high wall (3,43 / 5,14, r 90, back to `w-hoy`), BESTÅ on `w-hoy` (wall mount, centre
  1,45), Secto 4200 over the dining table (806 lm 3000 K, drop 1,25); Inspector rows; swap ▶ ×5 Sagene → Scandi → Belfort
  → Signature → **BESTÅ on the wall (y 1,52)** → Sagene back on the floor at the wall; shopping list per store with sale and
  list prices and links (`p1…p7`).
- `place-all.mjs`: «Plasser» from the card for **all 14** (search → card → ghost → click): right mount, real model
  (no fallback box), Inspector open, price, sound row (0,70–0,90 m² for recliners), light 806 lm for pendants; undo each.
- `showcase.mjs`: Zermatt in the sitting area, Octo 4240 over the table by day and evening (`s1…s3`).

## For others

- **INTERACT (Placement)**: `WALL_V` has no `display-cabinet`, so a wall-hung vitrine starts at the 1,45 m default centre
  (bottom 1,13). `params.mountHeight + h/2` (1,52 for BESTÅ) would match the shop's suggestion and the Inspector swap.
- **FOUNDATION (registry)**: `fallbackModel` takes the mount from the Def/schema, not `spec.mount` – a wall-hung item of
  a multi-mount archetype would be drawn with the floor origin if its builder ever throws (`spec.mount || def?.mount`).
- **SEATING**: the recliners' footstool sits outside `dims` (the product dims are the chair), so Placement's overlap
  note fires early (Timeout/Zermatt next to the nesting tables). `colliders` / footprint for the stool would help.
- **TABLES**: works already (thumbnails, BESTÅ hangs right). Vitrines have `params.led: true` but no product `light`, so
  the Inspector shows no lamp controls and the shopping list no bulb; a `light` per product needs data that nobody
  has verified (lumens). `params.drawers` on Sagene are its two closed lower doors (see its description) – the catalogue
  shows «Lukket del nederst» instead of a drawer count.
- **Integrator / ARCHITECTURE.md**: §2 category list and §6 `CATEGORIES` need `vitrineskap` (Vitrineskap, after
  Skjenker); §5 lists should name `display-cabinet` (tables.js) and `pendant-slatted` (lamps.js); §13 «vitrineskap:
  body, front (dører), top, legs (understell), handle (grep)».
- **Data**: `src/data/room-spec.json` is no longer what `normalize-data.mjs` makes from research + fixes (only the decor
  `notes` texts differ – an older fixes.mjs wrote «– fix-core r1»). Run the normaliser with `--only=catalog` unless the
  room-spec owner wants it regenerated. I ran `fixes.mjs --apply` once by mistake: it rewrote room-spec.json with
  identical values (checked against the state before) – hence the new `--only=catalog`.
- Shipping («frakt 999 kr» in the vitrine price notes) is not in the shopping total (ShoppingPanel does not use
  `purchaseOf`/`shippingNok` yet).
