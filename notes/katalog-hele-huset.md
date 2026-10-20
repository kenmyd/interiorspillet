# katalog-hele-huset – furniture for the whole house

Owner «katalog» (branch `worktree-katalog-hele-huset`). Dev server 5260 (`.claude/launch.json` → «katalog-dev»), scripts
and screenshots in `.shots/kat/` (not in git). Owns `research/catalog-new/*-hele-huset.json`, `research/catalog/`,
`src/data/catalog/`, `src/catalog/`, `src/models/`, `src/data/archetypes.json`, catalogue parts of
`src/data/scripts/normalize-data.mjs` / `fixes.mjs`, `tools/test-design.mjs` (catalogue checks) and this note.

The house gets a bathroom, a hall/entrance and a bedroom on the 1st floor, and a basement with a hall (stair), a
basement living room (20,6 m²), a small bedroom (7,4 m²), a bathroom/laundry and an entrance room
(`notes/hele-huset-fakta.md` in the main checkout). This round fills the catalogue for those rooms.

## 1. Categories (catalog/index.js `CATEGORIES`, normalize-data.mjs `CATEGORY_KEYS`)

Order: **Sofaer** `sofa` · Lenestoler · **Bord** `bord` · **Spisestoler** `stoler` · Skjenker · **TV-benker** `tvbenk` ·
Vitrineskap · **Hyller** `hylle` · **Senger** `seng` · **Nattbord** `nattbord` · **Kommoder** `kommode` ·
**Garderobeskap** `garderobe` · **Speil** `speil` · **Bad** `bad` · **Gang** `gang` · Taklamper · Små lamper ·
Puter og pledd · Tepper · Solskjerming · Akustikk · Smått.

`sofa`, `bord`, `stoler`, `hylle` were the «extra» categories of the existing furniture (home/existing.js), so the
existing sofas, tables, dining chairs and the wall shelf now swap («Bytt modell») with catalogue products. Every
category has `rooms` (stue, kjellerstue, soverom, bad, gang, alle) for a future room filter in the panel. The three
mirrors of round 1 moved from Smått to Speil (`fixes.mjs` `CATEGORY_MOVES`, subcategory `veggspeil`).

Subcategories (`SUBCATEGORY_LABELS`): sofa `2-seter 3-seter hjornesofa sjeselong sovesofa` · bord `spisebord sofabord` ·
stoler `spisebenk` · hylle `bokhylle vegghylle` · seng `kontinentalseng rammeseng oppbevaringsseng enkeltseng sengegavl
sengebenk` · nattbord `vegghengt` · garderobe `garderobeskap skyvedorsgarderobe` · speil `veggspeil gulvspeil` ·
bad `speilskap baderomsskap handkle badematte handkleholder tilbehor skittentoy` · gang `skoskap benk knagger stumtjener` ·
teppe `lopere` · solskjerming `morklegging`.

## 2. Research rules (`research/catalog-new/<category>-hele-huset.json`)

A JSON array of products, the same fields as round 1 (see `research/catalog-new/vitrineskap.json`):

```
{ id, category, subcategory?, name, brand, store, url, priceNok, salePriceNok?, priceNote, priceConfidence,
  dims: { w, d, h } (metres; cm/mm are converted), archetype, mount?, params, variants: [...], defaultVariant,
  absorption, absorptionNote?, description, why, imageUrl, verified, verifiedNote }
variant = { name, colors: { part: '#rrggbb' }, materials: { part: kind }, priceNok?, salePriceNok?, priceConfidence?,
            url?, paramsOverride? }
```

- **Stores**: Bohus first (the owner likes Bohus), then IKEA, then Skeidar, Jysk, Nordic Nest, Kid, Rusta, Clas Ohlson …
- **Verified on the product page, dated 2026-10-20.** Bohus is a Magento PWA: its product page renders the store's
  GraphQL data (`https://www.bohus.no/graphql`), so `priceNote` says «Pris sjekket 2026-10-20 på produktsiden
  (bohus.no-produktdata, varenr. 312261) …». IKEA: the product page (`/no/no/p/…`) and its search API agree.
  `priceNok` = ordinary price, `salePriceNok` = campaign price when the page shows one («før» price).
  `priceConfidence`: checked (read on the product page) / check (category list, «sjekk prisen ved kjøp») / estimate.
- **Variants** = colours/finishes of one model and size (Bohus sells each colour as its own product: group them, give
  each variant its own `url`, and `priceNok`/`salePriceNok` when they differ from the product's).
- **imageUrl** = the store's main product photo (Bohus `image.url`, IKEA `mainImageUrl`).
- **dims** = the model's bounding box: w (width, x), d (depth, z), h (height). Beds: d includes the headboard.
- **Colours**: hex from the product photo / colour name (fabric shown in daylight), materials from
  `src/data/archetypes.json` `materials` (boucle woven velvet velour linen wool felt leather teddy knit cotton · oak
  white-oak smoked-oak walnut black-oak teak ash painted lacquer · black-metal brass chrome steel bronze ·
  marble-dark marble-white travertine · glass-clear glass-opal glass-smoked · rattan paper ceramic plastic plant-leaf
  soil candle moss cork mirror). White melamine/lacquer = `painted`.
- **absorption** (Sabine m², 500–1000 Hz): bed with bedding ≈ 1,2–1,6 (+0,2–0,4 upholstered headboard), headboard
  alone 0,3–0,5, sofa ≈ 1,05 × width, upholstered chair 0,25, wooden chair 0,05, upholstered bench 0,2, towel 0,05,
  bath mat/rug = pile α × area (flat 0,18, low 0,25, medium 0,28, high 0,32), cabinets/tables/mirrors 0.
- **why**: one or two Norwegian sentences on why it suits the room it is meant for (sizes from hele-huset-fakta:
  1st-floor bedroom 3,11 × 3,69, bathroom 2,53 × 2,22, hall 3,11 × 2,07 (stair takes 1,54 m), basement living room
  20,6 m², basement bedroom 7,4 m²). Keep it tidy and calm – the owner does not want clutter.
- All user-facing text in Norwegian bokmål (names as the store writes them, decimals with comma).

## 3. Archetypes

Origin/front as ARCHITECTURE §5: floor items stand on y = 0 with the front toward +z; wall items have the back at z = 0
and y = the vertical middle; soft items lie on any surface. `params.mountHeight` on a wall item = suggested height of its
underside above the floor (Placement starts it at mountHeight + h/2).

### New

| Archetype | Family / mount | Parts | Params |
| --- | --- | --- | --- |
| `bed` Seng | bed / floor | frame, headboard, legs, bedding (+ throw) | see below |
| `headboard` Sengegavl | bed / floor | headboard, legs | `style` (as bed `headboard`), `legH`, `wings` (m forward), `channels`, `buttonRows` |
| `bench` Benk | seating / floor | upholstery, legs, frame | `seat` upholstered/wood/cushion/cord, `seatT`, `legStyle` wood-taper/block/metal-thin/metal-frame/plinth/wood-frame, `legH`, `shelf` none/board/slats/basket, `tufted`, `storage` (lift lid box), `seatH` |
| `chair` Spisestol med ramme | seating / floor | upholstery, frame, legs | `back` upholstered/upholstered-round/spindles/slats/rail/y-back/panel/cane/ladder, `seat` upholstered/wood/cord/cane/cushion, `arms`, `legStyle` wood-taper/wood-square/metal-thin/sled, `seatH`, `spindles`, `stretchers` |
| `wardrobe` Garderobeskap | storage / floor | body, front, top, legs, handle | cabinet params (below) + `slidingDoors`, `doorFrame` none/alu, `slidingPanels`, `cornice`, `handleY` |
| `dresser` Kommode | table / floor | body, front, top, legs, handle | cabinet params + `graduated` |
| `bedside-table` Nattbord | table / floor | body, front, top, legs, handle | cabinet params (`base: 'wall'` + `mountHeight` = floating) |
| `bookcase` Bokhylle | storage / floor | body, front, top, legs, handle | `style` closed/open-back/ladder/frame, `cols`, `rows`, `doorRows`, `doorStyle` flat/glass/framed, `base`, `legH`, `decor`, `handle` |
| `shoe-cabinet` Skoskap | storage / floor | body, front, top, legs, handle | cabinet params, fronts `flip:N` (tilt-out compartments) |
| `wall-cabinet` Veggskap | storage / wall | body, front, top, legs, handle | cabinet params (doors/fronts/frontStyle/handle), `mountHeight`, `shelves` |
| `mirror-cabinet` Speilskap | storage / wall | body, front (mirror doors), handle | `doors`, `led` none/top/sides, `openShelf` none/bottom/side, `mirrorSides`, `mountHeight` |
| `mirror-floor` Gulvspeil | framed / floor | print (mirror), frame | `shape` rect/arch/oval/organic, `stand` lean/feet/easel/cheval, `tilt` (deg, lean), `frameW`, `frameDepth`, `mullions`, `mullionCols`, `mullionRows` |
| `towel` Håndklær | textile / soft | fabric, piping (border stripe) | `count` 1–4, `size` hand/bath/sheet, `fold` stack/roll, `texture` terry/waffle/linen/ribbed, `stripe` |
| `towel-ladder` Håndklestige | fixture / floor | body, fabric (towels) | `rungs`, `stand` lean/base/feet, `lean` (deg), `towels` 0–3 |
| `towel-rail` Håndklestang | fixture / wall | body, fabric | `style` bar/ring/hooks, `bars`, `towels` 0–3, `mountHeight` |
| `bath-accessory` Badetilbehør | fixture / surface | body, accent | `kind` dispenser/tumbler/toothbrush/soap-dish/tray/set, `ribbed` |
| `coat-rack` Knaggrekke | fixture / wall | body, accent (hooks), fabric (coats) | `style` rail/pegs/shelf, `hooks`, `hookStyle` peg/hook/double/knob, `coats` 0–3, `mountHeight` |
| `coat-stand` Stumtjener | fixture / floor | body, accent, fabric | `style` tree/tripod/rail, `hooks`, `base` round/cross/tripod, `shelf`, `coats` 0–3 |

**bed** (dims: w = outer width, d = outer length incl. headboard, h = top of the headboard, or of the bed without one)

| Param | Values |
| --- | --- |
| `bedType` | `continental` (kontinentalseng: fabric base box on legs + top mattress), `frame` (rammeseng: side rails round a mattress, fabric or wood), `storage` (base to the floor with drawers), `platform` (low wide wooden platform), `adjustable` (regulerbar: like continental, thinner base) |
| `mattressW`, `mattressL` | lying surface, m (1,8 × 2,0 …); default from dims |
| `seatH` | top of the bed (the lying surface) above the floor, m (continental ≈ 0,55–0,70, frame ≈ 0,45–0,55) |
| `topperH` | top mattress (overmadrass) thickness, m (continental 0,05–0,10; 0 = none) |
| `railH` | frame / platform beds: top of the side rails above the floor |
| `legH`, `legStyle` | `block`, `round`, `taper`, `metal`, `plinth` (recessed base), `skirt` (fabric to the floor) |
| `drawers` | storage beds: drawers per long side |
| `headboard` | `none`, `panel`, `channel` (vertical channels), `tufted` (buttons), `rounded`, `wing`, `wood`, `slats`, `cushions`, `cane` |
| `headboardH`, `headboardW`, `headboardT` | top above the floor, width (default w), thickness |
| `footboard`, `footboardH` | wooden frame beds with a foot end |
| `bedding` | `duvet` (made, two/three pillows – the default), `bedspread`, `none` |
| `pillows` | 2–4 |
| `throwRunner` | a bed runner / throw across the foot (part `throw`) |

**Cabinet params** (tables.js `buildCabinet`, shared by sideboard, tv-bench, wardrobe, dresser, bedside-table,
shoe-cabinet, wall-cabinet): `fronts` (columns left → right: `door`, `glass`, `open`, `mirror`, `drawers:N`, `flip:N`),
`doors` (column count), `frontStyle` flat/ribbed/slatted/cane/glass/framed/grooved, `frontPattern`, `ribPitch`,
`handle` none/bar/cutout/knob/edge, `handleLen`, `handleY`, `drawerRow` (drawers across the full width) + `drawerRowPos`
top/bottom + `drawerH`, `base` legs/plinth/wall/none, `legStyle` metal-thin/wood-taper/block/metal-frame, `legH`,
`mountHeight` (base wall), `top` same/marble, `topT`, `corners` square/rounded, `cornerR`, `slidingDoors`, `cornice`,
`graduated` (dresser drawers taller toward the floor), `frontFit` inset/overlay.

### Existing, extended

- `sofa-straight`: + `armStyle` box/slim/round/sloped/none, `backStyle` cushions/tight, `seatStyle` split/bench.
- `dining-table-oval` (label «Spisebord»): `legs` + trestle/sled/x/u-frame, `legStyle` square/round-taper/splayed/
  metal-thin for `legs: four`, `apron`.
- `basket`: + `lid`.

### Builder extensions added while tuning against the store photos

- **Cabinets** (tables.js `buildCabinet`): cells `mirror`, `flip:N`, `door+drawers:N` / `mirror+drawers:N` (+ `cellDrawerH`),
  `drawerRowPos: 'bottom'`, `drawerRowDoors` (the full-width row as a low door pair), `graduated`, `handle: 'edge'`,
  `handleY`, tall-door `cutout` = a vertical finger slot, `gripRecess: 'top'` (MALM-style channel), `frontStyle: 'grooved'`,
  `gallery` (a rim round the top), `lowerShelf` (TONSTAD), `midLegs`, `legFrame` on `metal-thin` (square legs, frame and
  stretchers), `metal-frame` above 10 cm = a square-tube stand with stretchers, `cornice`, sliding doors with
  `doorFrame: 'alu'` + `slidingPanels` (the dark interior now stays behind the back track).
- **Dining table** (`dining-table-oval`): `legs` + column (ribbed oval column, Nola) / spider (Bastia) / panel (slab legs,
  Signature 1800) / cross (fluted cross, Palma).
- **Sofas**: `sofa-modular-l` `layout: 'chaise'` (an open chaise with its own arm along the outer side, feet under the
  chaise); `armStyle` on both sofas.
- **Chairs**: `back: 'pad'` (a curved pad above the seat, KRYLBO), `hoop` for spindle backs (Noni); the upholstered back
  stands on the seat frame, the round back is a tub band falling into the arms, a panel back is one broad board.
- **Mirrors** (decor.js `buildMirror`, also used by `mirror-floor`): `shape: 'rounded'`, `shelf` (+ `shelfAt`, `shelfD`),
  `mullionLayout: 'border'` (+ `borderW`). **Mirror cabinet**: `doorFrame`, `cornice`.
- **Wall shelf** (simple): `brackets` straps / battens / brackets, `boardDepth`.
- **Bath accessory**: `squareBody`. **Bench**: `legH` under a storage box. **Headboard**: `slatPitch` (dense slats on a
  dark felt backing below 6 cm). **Coat stand**: `levels`, `pegStyle: 'flat'`. **Coat rack**: `hookStyle: 'disc'` + `sizes`.

Model tuning per product lives in `fixes.mjs` (`PRODUCTS`, section «hele huset»: params merged over the research) and,
for variant `paramsOverride`, in the research file itself (Madrid 103 mirror variants).

## 4. Result (2026-10-21)

136 new products (338 variants) in 15 files `research/catalog-new/*-hele-huset.json`: 105 Bohus, 30 IKEA, 1 Kid;
322 products in all. Per category: Sofaer 9, Bord 9 (6 spisebord + 3 sofabord), Spisestoler 8, TV-benker 6, Hyller 9,
Senger 17 (9 senger, 5 sengegavler, 3 sengebenker), Nattbord 9, Kommoder 9, Garderobeskap 8, Speil 10 (+3 moved), Bad
18, Gang 11, Tepper +5, Solskjerming +3 (mørklegging), Smått +5 (planter). Researched by seven parallel research agents
(brief `.shots/kat/BRIEF.md`, validator `.shots/kat/validate.mjs`, Bohus GraphQL / IKEA search helpers in `.shots/kat/`);
every price, link and photo was read from the store's product data on 2026-10-20.

Verification (port 5260):
- `node tools/test-design.mjs` → 110/110 (new section «Hele huset»: categories/icons/rooms, 18 archetypes with builders,
  every new product verified/dated/linked/priced/with texts, the Bohus share, prices, the moved mirrors, FAXÄLVEN as a
  wall lamp, wardrobe variant overrides, search). Re-running the normaliser reproduces `src/data/catalog` exactly.
- `.shots/kat/compare.mjs <category>`: the store photo next to the model for every product (`.shots/kat/cmp-*.png`); the
  models were tuned until proportions, legs, fronts, handles and colours matched.
- `.shots/kat/place-all.mjs`: every product of the new categories (334 variants) added through DesignState → a real
  model, never the grey fallback box; real Placement (ghost → click) of beds, wardrobes, a corner sofa, dressers,
  nightstands, towels, floor mirrors and a coat stand on the floor, and 8 wall items (mirror/wall cabinets, coat racks,
  a mirror, a towel rail, shelves) on the high wall at their `mountHeight` (`place-wall.mjs`); the catalogue panel per
  new category; the three curtains on `win-s1` (`curtains.mjs`). 0 console errors. `vite build` OK.

## 5. For others

- **UI (CatalogPanel)**: 22 category chips now take ~7 rows of the panel. `CATEGORIES[].rooms` is there for a room
  filter («Stue / Soverom / Bad / Gang / Kjeller», or the room the player stands in); the chips could use `c.iconSvg`
  (drawn per category) instead of the generic `ICONS[c.icon]` (four categories share «cabinet»).
- **House (home/existing.js)**: furniture of the new rooms should map archetype → category like the catalogue
  (bed/headboard → seng, bedside-table → nattbord, dresser → kommode, wardrobe → garderobe, bookcase → hylle,
  tv-bench → tvbenk, mirror/mirror-floor → speil, chair → stoler, towel*/mirror-cabinet/bath-accessory → bad,
  shoe-cabinet/coat-rack/coat-stand → gang) so «Bytt modell» offers the right products.
- **Placement**: wall items without a `WALL_V` entry start at `params.mountHeight + h/2` – every new wall product has a
  `mountHeight`. Floor mirrors lean; their AABB is the leaning mirror.
- **README**: product/category counts (322 / 22) and the new categories.
- Uncertain data is written in each product's `verifiedNote` / `params.notes` (estimated leg heights, topper
  thickness, depths read from photos, IKEA variant prices from the search API, Bohus «Expiring» stock in Bad).
