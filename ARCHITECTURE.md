# Interiørspillet – arkitektur og kontrakter

Et førstepersons 3D-spill i nettleseren (Three.js r186 + Vite 8, ren JS, ES-moduler) der brukeren går rundt i
sin egen stue og prøver ut interiør. Kodebasen og stilen er kopiert fra `C:\Dev\Kraftverkspillet` (se
`SCAFFOLD.md` for de kopierte modulene og API-ene deres). **All tekst brukeren ser er på norsk bokmål.**

Dette dokumentet er kontrakten mellom modulene. Hver modul har én eier; ikke endre andres filer. Trenger du noe
fra en annen modul som ikke finnes ennå, så bruk kontrakten slik den står her, og lag en liten lokal fallback.

---------------------------------------------------------------------------------------------------------------

## 1. Koordinater, enheter, konvensjoner

- Meter, sekunder, grader i data (radianer i Three.js). `+x` = sør (mot de store vinduene), `+z` = vest (mot
  TV-stua), `+y` = opp. Origo = gulvet i det øverste venstre innerhjørnet av plantegningen. Nord = `−x`,
  øst = `−z` (kjøkkenenden).
- `rotationDeg` = `rotation.y` i grader. Et objekts front peker mot lokal `+z`: 0 → front mot vest (+z),
  90 → mot sør (+x), 180 → mot øst (−z), −90 → mot nord (−x).
- Farger er `#rrggbb`-strenger i data. Malingsnavnene `sand` og `marrakesh` er gyldige farger overalt der en
  vegg- eller takfarge forventes (de slås opp i paletten).
- Lys: `colorK` (fargetemperatur i kelvin), `lumens`. Omregning til Three.js-intensitet skjer **bare** i
  `home/lighting.js`.
- Absorpsjon: Sabine-m² ved 500–1000 Hz.
- Ingen `Math.random()` i modellbyggere: bruk `models/kit.js` → `rng(seed)`, så modellene er like hver gang.

## 2. Data (`src/data/`, importeres som JSON av Vite)

| Fil | Innhold | Kilde |
| --- | --- | --- |
| `room-spec.json` | Vegger, åpninger, tak, gulv, kjøkken, eksisterende møbler, lys, terrasse, fotokameraer – og for hele huset nivåer, rom, hull, trapper, `builtIns` og lysgrupper | `research/room-spec.json` (stua) + `research/house/NN-*.json` (resten av huset) |
| `catalog/<kategori>.json` | Produkter (skjema i §6) | `research/catalog/*.json` |
| `wall-proposals.json` | `{ wallFacts, proposals: [...] }` – alle forslag til den høye veggen (eksisterende + nye) | `research/wall-proposals*.json` |
| `palette.json` | `{ walls: {sand, marrakesh}, paints: [...], materials: [...] }` | `research/palette.json` |

**`room-spec.json` redigeres aldri for hånd.** Den genereres med `node src/data/scripts/normalize-data.mjs --only=room-spec`
(deterministisk – ved flettekonflikt kjører du den på nytt). Normaliseren (`src/data/scripts/house.mjs`, plan:
`notes/hele-huset-design.md` §1.7):
- fletter `research/house/NN-*.json` inn i `research/room-spec.json` i sortert rekkefølge (lister etter id,
  `wallOpenings` lapper åpningene i en eksisterende vegg, `levelId`/`roomId` på fila stemples på oppføringene);
- `research/house/00-ids.json` er id-registeret og skjemaet (nivåer, rom, lysgrupper, de frosne stue-id-ene) og flettes
  ikke inn;
- `validateHouse` kaster ved feil, så ingenting skrives: id-er, skjema, veggsløyfer, overlapp, dørformat, kjente
  arketyper (ikke alias), `roomId` på alle nye oppføringer (uten havner de i stua), og fri bredde forbi et åpent
  dørblad (D6: alltid feil, fordi åpningsvinkelen er et modellvalg). Anslåtte verdier (`estimated`) gir advarsler der
  planen sier det;
- skriver «Målelista» (alle `estimated`-felt) som generert avsnitt i `research/room-spec-notes.md`.

Kategorinøkler (katalogrekkefølge): `sofa`, `lenestol`, `bord`, `stoler`, `skjenk`, `tvbenk`, `vitrineskap`, `hylle`, `seng`,
`nattbord`, `kommode`, `garderobe`, `speil`, `bad`, `gang`, `taklampe`, `smalamper`, `tekstil`, `teppe`, `solskjerming`,
`akustikk`, `smatt` (372 produkter; se `notes/katalog-hele-huset.md`).
Bilder som spillet viser (fotomontasjer, stuebilder til fotosammenligning, utsikt) ligger nedskalert under
`public/img/…` og refereres med **relative** stier (`img/forslag/B.jpg`) – bygget skal virke i en undermappe.

## 3. Mappestruktur og eiere

```
src/
  main.js, config.js, style.css               (scaffold)
  core/      Events, Input, Collision, Interaction, Highlight, Settings, Audio, Music, Game   (scaffold; Game: integrasjon; Music: bakgrunnsmusikk)
  player/    PlayerController.js, Seats.js    (scaffold; Seats: sitte i stoler/sofaer – E over et møbel med seatY, E/WASD reiser deg)
  ui/        dom, Hud, PauseMenu, SettingsPanel, Loading, Dialog, icons, controlsHelp, ui.css (scaffold)
  world/     proctex, surfaces, shapeUtil, propMaterials, Door                         (scaffold)
  data/      *.json                            (FOUNDATION)
  catalog/index.js                             (FOUNDATION)
  home/
    index.js        createHome(ctx) – setter sammen alt             (FOUNDATION)
    layout.js       room-spec → typede, avledede mål (ALLE mål her) (FOUNDATION)
    materials.js    materialer/teksturer                            (FOUNDATION)
    existing.js     eksisterende møbler → DesignState-elementer     (FOUNDATION)
    shell.js        vegger m/åpninger, gulv, tak, nedforinger, lister, vinduer, dører, LED-lister, spotter  (SHELL)
    kitchen.js      kjøkkeninnredning                               (SHELL)
    exterior.js     terrasse, rekkverk, utsikt (foto-backdrop), bakke                         (SHELL)
    lighting.js     sol/himmel/tid, LightManager, innebygde lys, skygger, eksponering, AO    (LIGHTING)
  models/
    kit.js          geometri-hjelpere                               (FOUNDATION)
    registry.js     arketype → bygger, buildModel()                 (FOUNDATION)
    seating.js      lenestoler, spisestoler, barkrakker, sofaer     (SEATING)
    tables.js       bord, sidebord, skjenker, TV-benk, vegghylle     (TABLES)
    lamps.js        alle lamper og armaturer                         (LAMPS)
    textiles.js     puter, pledd, puffer, tepper                     (SOFT)
    decor.js        planter, vaser, kunst, speil, lys, TV, høyttalere, kurver, akustikkprodukter (SOFT)
    beds.js         senger, sengegavler, benker                      (KATALOG)
    storage.js      garderobeskap, kommoder, nattbord, skoskap, veggskap, speilskap, bokhyller (KATALOG; bygger på tables.js buildCabinet)
    chairs.js       spisestoler med ramme                           (KATALOG)
    fixtures.js     gulvspeil, håndklær, håndklestiger/-stenger, badetilbehør, knaggrekker, stumtjenere (KATALOG)
    shading.js      solskjerming på vinduer                          (SHADING)
    walldesigns.js  elementene i veggforslagene                     (WALLS)
  design/
    DesignState.js  hele designet som data + angre/gjør om          (FOUNDATION)
    SceneSync.js    DesignState → 3D (bygger/oppdaterer modeller)   (FOUNDATION)
    Acoustics.js    etterklangstid (Sabine)                          (FOUNDATION)
    Saves.js        lagring (localStorage), eksport/import          (FOUNDATION)
    Placement.js    plassering og flytting                          (INTERACT)
    Selection.js    velge objekter/vegger/vinduer med musa          (INTERACT)
    ViewModes.js    gå / oversikt (dukkehus) / plan                 (INTERACT)
  ui/ (nye)
    panelKit.js     felles paneler, faner, kort, fargevelger, glidere (FOUNDATION)
    panels.css      stil for de nye panelene (bygger på ui.css)      (FOUNDATION)
    Toolbar.js, CatalogPanel.js, Inspector.js, SavePanel.js, ShoppingPanel.js, AcousticsWidget.js   (UI)
    WallPanel.js, PhotoCompare.js               (WALLS)
    WindowPanel.js                              (SHADING)
    LightPanel.js, SunPanel.js                  (LIGHTING)
public/img/…        nedskalerte bilder           (FOUNDATION; WALLS legger til miniatyrer ved behov)
deploy/             .htaccess-mal, README for opplasting (INTEGRATION)
```

## 4. `home/` – huset

### `createHome(ctx)` (`home/index.js`)
`ctx` er det Game.js sender (se SCAFFOLD.md) + `ctx.design` (DesignState) og `ctx.lighting` opprettes her.
Returnerer `home`:

```js
home = {
  spawn: { position: Vector3, yaw, pitch },
  rooms: [{ id, name, box: Box3 }],          // soner fra room-spec (for HUD «Du er i: Spisestue»)
  layout,                                    // home/layout.js-objektet
  walls: [WallInfo], windows: [WindowInfo], doors: [DoorInfo],
  highWall: HighWallInfo,
  ceilingHeightAt(x, z) → number,            // tar hensyn til skråtak og nedforinger
  floorY: 0,
  roots: { shell: Group, kitchen: Group, exterior: Group, items: Group, wall: Group, shading: Group },
  pickables: { floor: Mesh[], walls: Mesh[], ceilings: Mesh[], windows: Mesh[] },  // for Selection/Placement
  lighting: LightManager,
  sync: SceneSync,
  update(dt, time, state), dispose(),
}
```

`WallInfo = { id, name, start: Vector2(x,z), end: Vector2, normal: Vector2 (inn i rommet), length, thickness,
paint ('sand'|'marrakesh'|'#hex'), meshes: Mesh[] (romsiden), heightAt(u) → topp ved posisjon u langs veggen,
isHigh: bool }`. Veggens romside-mesh har `userData.pick = { kind: 'wall', wallId }`.

`WindowInfo = { id, name, wallId, type: 'window'|'terrace-door', width, height, sill, center: Vector3 (midt i
åpningen, i veggens romside-plan), normal: Vector3 (inn i rommet), right: Vector3 (langs veggen, mot høyre sett
fra rommet), revealDepth, anchor: Group }`. `anchor` har origo midt **øverst** i åpningen på romsiden av
lysningen, lokal `+x` = right, `−y` = ned, `+z` = inn i rommet. Glass-mesh har
`userData.pick = { kind: 'window', windowId }`. Solskjerming henges i `anchor`.

`HighWallInfo = { wallId, origin: Vector3 (u=0, v=0 i verden), uDir: Vector3, normal: Vector3, width, height,
anchor: Group }` – `anchor` har origo i (u=0, v=0) på veggflaten, lokal `+x` = u, `+y` = v, `+z` = inn i rommet.

### `home/layout.js`
Leser `data/room-spec.json` og eksporterer et frosset objekt med avledede verdier (veggvektorer, normaler,
åpninger i verdenskoordinater, tak-funksjon, soner, høy vegg). **Alle mål bor i room-spec/layout** – ingen
magiske tall for rommet andre steder.

### `home/materials.js`
```js
mat(kind, hex?, opts?) → THREE.Material        // cachet på (kind, hex, opts)
paint(colorOrName) → MeshStandardMaterial      // 'sand' | 'marrakesh' | '#hex', matt veggmaling
emissive(hex, intensity) → material
MATERIAL_KINDS: { fabric: [...], wood: [...], metal: [...], stone: [...], glass: [...], other: [...] }
MATERIAL_LABELS: { boucle: 'Bouclé', velour: 'Velur', ... }    // norske navn til nedtrekkslister
resolveColor('sand'|'marrakesh'|'#hex') → '#hex'
```
`kind`: stoffer `boucle woven velvet velour linen wool felt leather teddy knit cotton`; tre `oak white-oak
smoked-oak walnut black-oak teak ash painted lacquer`; metall `black-metal brass chrome steel bronze`; stein
`marble-dark marble-white travertine`; glass `glass-clear glass-opal glass-smoked`; annet `rattan paper ceramic
plastic plant-leaf soil candle moss cork mirror`. Hex farger basisteksturen (prosedyriske teksturer fra
`world/proctex.js`, delt og gjenbrukt). `opts.grain: 'x'|'y'|'z'` for treretning. Teksturene er laget for
UV-er i meter: bruk `kit.worldUV(geometry, scale)` / kit-geometriene, så fiberstørrelse og årer blir riktige.

## 5. `models/` – prosedyriske modeller

### Byggerkontrakt
Hver modellfil eksporterer `export const archetypes = { '<arketype>': Def, ... }`:

```js
Def = {
  label: 'Skalstol (dreibar)',              // norsk
  mount: 'floor'|'wall'|'ceiling'|'surface'|'soft'|'rug'|'window',
  parts: ['upholstery', 'legs'],            // fargbare deler, i den rekkefølgen Inspector viser dem
  partLabels: { upholstery: 'Trekk', legs: 'Ben' },
  defaults: { dims: {w,d,h}, params: {...}, colors: {...}, materials: {...} },
  params: { key: { type: 'number', min, max, step, label } | { type: 'enum', options: [[verdi, 'Etikett']], label } | { type: 'bool', label } },
  dimsRange: { w: [min,max], d: [min,max], h: [min,max] },   // for størrelsesglidere
  build(spec) → THREE.Group,
}
spec = { dims: {w,d,h}, params, colors: {part: '#hex'}, materials: {part: kind}, quality }   // ferdig flettet med defaults
```

Opphav og orientering etter `mount`:
- `floor`, `surface`, `rug`: origo midt i fotavtrykket på underlaget (y = 0 er bunnen). Front mot `+z`.
- `wall`: origo midt på baksiden (x = midten, y = **vertikal midte**), baksiden ligger i z = 0, objektet stikker ut mot `+z`.
- `ceiling`: origo i festepunktet i taket; objektet henger ned langs `−y`. `params.drop` = avstand tak → underkant.
- `soft`: puter/pledd. Origo midt på undersiden. Plasseres på hvilken som helst flate (seter, rygger, bord, gulv).
- `window`: kun `models/shading.js` (se §8).

Gruppen som returneres skal ha:
```js
group.userData.model = {
  parts: { [part]: Mesh[] },                 // valgfritt: lar SceneSync bytte farge uten ombygging
  lights: [{ type: 'point'|'spot', position: [x,y,z], direction?: [x,y,z], angle?, penumbra?, colorK, lumens,
             emissiveMeshes?: Mesh[] }],     // lamper; lokale koordinater
  surfaces: [{ y, w, d, center: [x, z] }],   // flate topper (bord, skjenker) der små ting kan stå
  seatY?: number,
}
```
Alle mesher: `castShadow = receiveShadow = true` (bortsett fra glass/emissive), del geometri/materialer der det
går, InstancedMesh/merge for mange like deler (spiler, lameller). Mål modellen mot `dims` – brukeren kan endre
størrelse, så alt må skalere fornuftig (ikke bare `scale`-strekk av ben og puter).

`models/registry.js`: `ARCHETYPES` (alle filers `archetypes` flettet), `getArchetype(id)`,
`buildModel({ archetype, dims, params, colors, materials })` (fletter med defaults, kaller build, faller tilbake
til en grå boks hvis noe kaster), `archetypesFor(category)`.

### Arketyper per fil
- **seating.js**: `tub-swivel wingback lounge-wood club-box recliner shell-legs rocking dining-chair bar-stool
  sofa-modular-l sofa-curved sofa-straight`
- **tables.js**: `coffee-table-rect coffee-table-round-nesting dining-table-oval side-table-round side-table-c
  side-table-nesting sideboard tv-bench wall-shelf display-cabinet` (vitrineskap: gulv eller vegg – `mounts`)
- **lamps.js**: `pendant-dome pendant-globe pendant-cylinder pendant-linear pendant-multi pendant-tiered
  pendant-woven pendant-mushroom pendant-slatted ceiling-ring chandelier-molecule floor-arc floor-tripod floor-pole-shade
  floor-mushroom floor-uplight floor-globe floor-reading table-mushroom table-shade table-globe table-portable
  table-dome wall-sconce wall-arm`
- **textiles.js**: `cushion throw pouf rug`
- **decor.js**: `plant-floor plant-small vase art-frame mirror candle-holder basket tv speaker slat-panel
  fabric-panel acoustic-art felt-shape ceiling-absorber`
- **beds.js**: `bed headboard bench` · **storage.js**: `wardrobe dresser bedside-table shoe-cabinet wall-cabinet
  mirror-cabinet bookcase` · **chairs.js**: `chair` · **fixtures.js**: `mirror-floor towel towel-ladder towel-rail
  bath-accessory coat-rack coat-stand` (parametre: `notes/katalog-hele-huset.md` §3)

Hvis room-spec bruker en `kind` som ikke finnes, mapper `home/existing.js` den til nærmeste arketype.

## 6. Katalog (`catalog/index.js`)
```js
CATEGORIES: [{ key, label, icon, iconSvg, rooms }]   // norsk: Sofaer, Lenestoler, Bord, Spisestoler, Skjenker, TV-benker, Vitrineskap,
                                                     // Hyller, Senger, Nattbord, Kommoder, Garderobeskap, Speil, Bad, Gang, Taklamper,
                                                     // Små lamper, Puter og pledd, Tepper, Solskjerming, Akustikk, Smått
                                                     // rooms: stue | kjellerstue | soverom | bad | gang | alle (for et romfilter)
EXTRA_CATEGORIES: { elektronikk }                    // sofa/bord/stoler/hylle er katalogkategorier – eksisterende møbler kan byttes
products(categoryKey) → Product[]; getProduct(id); search(text)
productToItemSpec(product, variantIndex = product.defaultVariant) → item-spec for DesignState.add (uten position)
```
Product-feltene: `id category subcategory? name brand store url priceNok salePriceNok? priceNote dims archetype
params variants[{name, colors, materials}] defaultVariant absorption light? description why imageUrl verified`.

## 7. `design/` – modellen av designet

### `DesignState` (eier all tilstand som lagres)
```js
class DesignState extends Emitter {
  items: Map<uid, Item>
  wall: { proposalId: string|null, elements: Element[]|null, edited: bool }   // den høye veggen
  paints: { [wallId]: colorOrName }          // overstyrt veggfarge; mangler = room-spec
  windows: { [windowId]: ShadingSpec|null }
  env: { hour: 13, month: 6, day: 15, mode: 'auto'|'day'|'evening'|'night', builtIn: { [groupId]: { on, dimmer } }, exposure: 1 }
  meta: { name, createdAt, updatedAt, originalRooms, originalUids, specRevision }   // se Saves (versjon 2)

  add(spec) → uid; update(uid, patch); remove(uid); get(uid); list(filter?)
  setWall(patch); setWindow(windowId, spec|null); setPaint(wallId, color|null); setEnv(patch)
  transaction(label, fn)       // alt inni blir ett angresteg (dra-flytting osv.)
  undo(); redo(); canUndo; canRedo
  toJSON(); load(json); resetToOriginal()
  events: 'item:add' {uid,item} · 'item:update' {uid,item,patch} · 'item:remove' {uid,item} · 'wall' · 'window' {windowId}
          'paint' {wallId} · 'env' {patch} · 'load' · 'change' (etter alt over) · 'history'
}
Item = { uid, source: 'existing'|'catalog'|'custom', refId, name, category, archetype, mount,
         position: [x,y,z], rotationDeg, dims, params, colors, materials, variantIndex,
         light?: { on, dimmer, colorK }, attach?: { wallId? , normal?: [x,y,z], tilt?: deg },
         hidden?: bool, locked?: bool }
ShadingSpec = { productId?, archetype, params, colors, materials, open: 0..1, tilt: deg, mount }
Element = se research/wall-proposals.json (type + u, v, w, h + typeparametre)
```
Originaldesignet = eksisterende møbler fra room-spec (source `existing`), ingen veggforslag (`0`), ingen
solskjerming. `resetToOriginal()` laster det.

### `SceneSync`
Lytter på DesignState og holder 3D-scenen lik: bygger/ombygger modeller (`registry.buildModel`) i
`home.roots.items`, setter `userData.pick = { kind: 'item', uid }` på rotgruppen, kaller
`home.lighting.setItemLights(uid, lights|null)`, `applyShading(windowInfo, spec)` fra `models/shading.js`,
`applyWallDesign(home.highWall, elements)` fra `models/walldesigns.js`, `home.setPaint?`/maling på vegger, og
`lighting.requestShadowUpdate()`. API: `getObject(uid) → Group`, `objectBounds(uid) → Box3`.

### `Acoustics`
`computeAcoustics(design, home, { roomId = 'stue-kjokken' }) → { rt60, absorption, volume, baseline, breakdown: [{ label, m2 }],
changes, roomId, roomName, roomKind, mode: 'calibrated'|'estimate', estimated, target, level }`.
Stua: kalibrering mot rommets volum fra geometrien og en grunnabsorpsjon slik at originaldesignet gir 0,86 s.
Endringer: nye/fjernede elementer (`absorption` fra katalog/arketype), veggforslag (`sabineAdded` eller beregnet fra
elementene), gardiner/solskjerming (stoff × areal × hvor lukket), tepper (luv × areal).
Andre rom (hele huset, steg 16 E3): **anslått** fra rommets flater, dører (lukket) og åpninger (α 0,5), med eget mål per
romtype. `roomName` får etasjen lagt til når to rom har samme navn («Soverom (kjeller)»).
- `itemRoomId(item, layout)`: rommet et møbel teller i (veggfeste, ellers nivå + planposisjon).
- `acousticsFor(design, home, roomId)`: `computeAcoustics` per rom, cachet til neste endring i designet.
  `Editor.acoustics(roomId)` bruker den for andre rom enn stua (stua har sin egen cache som før).

### `Saves`
Flere navngitte design i localStorage (`interiorspillet.designs.v1`), autolagring av det aktive, eksport til
`.json`-fil og import, «Original» kan alltid lastes. All lagring i try/catch.
- **DESIGN_VERSION 2** (hele huset, steg 16 E3): hvert møbel har `level` ('hoved', 'kjeller'). I minnet er y verdens-y;
  i en lagring er y **nivålokal** (over nivåets gulv). `originalJSON()` gir verdens-y med markøren `ySpace: 'world'`.
  - `meta.originalRooms`: rommene designet har fått originalene til. Lasting legger til originalene i rom som mangler
    (en v1-lagring = ['stue-kjokken']).
  - `meta.originalUids`: alle original-uid-er dataene hadde da designet ble lagret. Et original som er nytt i dataene,
    kommer inn også i et rom designet allerede hadde. Et listet møbel brukeren fjernet, kommer ikke tilbake.
  - `meta.specRevision`: hash per original slik dataene ga det. Et urørt original følger dataene.
  - Før første skriving kopieres v1-lagringer til `interiorspillet.designs.v1.backup` (én gang).

## 8. Solskjerming (`models/shading.js`)
```js
SHADING_TYPES: [{ archetype, label, params }]       // venetian, roller, pleated, duo-roller, vertical, curtain, roman
applyShading(windowInfo, spec|null) → { group, transmission }   // bygger i windowInfo.anchor, fjerner gammel
shadingTransmission(spec) → 0..1                    // andel dagslys som slipper inn (åpen = 1)
```
`open` (0 = helt nede/lukket, 1 = helt oppe/åpen), `tilt` for persienner/lameller. Lukkede lameller og stoff
skal kaste skygge for sola; delvis gjennomskinnelige stoffer slipper gjennom en andel (f.eks. dithered
`customDepthMaterial`) og lyser svakt når sola treffer dem.

## 9. Veggforslag (`models/walldesigns.js`)
```js
applyWallDesign(highWallInfo, elements|null) → Group      // bygger i highWall.anchor, fjerner gammel
ELEMENT_TYPES: { slats, panel, art, tapestry, checker, circles, hexagons, curtain, moss, shelf, sideboard-floating, hooks, led, lamp-wall, paint-block, plant,
                 wallpaper, moulding, bookcase, ledge }   // runde 3: tapet, listverk, bokhylle, bildehylle
elementEditor(type) → param-skjema for WallPanel (samme format som Def.params)
elementAbsorption(element) → m²
```

## 10. Lys (`home/lighting.js`)
```js
class LightManager {
  constructor({ scene, renderer, camera, home, settings, quality })
  setTime({ hour, month, day })        // sol: breddegrad 58.1° N, vinduene mot sør (+x); nord = −x, øst = −z
  setMode('auto'|'day'|'evening'|'night')
  setItemLights(uid, lights|null)      // lights i verdenskoordinater: [{ type, position: Vector3, direction?, angle?, colorK, lumens, on, dimmer, emissiveMeshes }]
  builtInGroups: [{ id, label, lumens, dimmer }]   // LED-lister, takspotter ved høy vegg, kjøkkenlys, pendler, TV-stue-taklampe …
  setBuiltIn(groupId, { on, dimmer })
  setWindowTransmission(windowId, t)   // solskjerming demper himmellys og sol per vindu
  requestShadowUpdate()                // skyggekart oppdateres bare ved endringer (autoUpdate = false)
  update(dt, camera)                   // lysbudsjett: maks N punktlys aktive (nærmest/sterkest)
}
```
Retning mot sola for asimut A (fra nord, med klokka) og høyde h: `(−cos A·cos h, sin h, −sin A·cos h)`.

## 11. Interaksjon (`design/`)
- **Velg**: venstreklikk (uten å dra) på et objekt → velg det (Inspector åpnes). Klikk på den høye veggen →
  WallPanel. Klikk på en annen vegg → enkel fargevelger for veggen. Klikk på et vindu → WindowPanel. Klikk i
  tomt rom → velg bort. Hover: rim-glød (core/Highlight.js) + kort tekst («Lenestol – klikk for å endre»).
- **Flytt**: hold venstre knapp på et **valgt** objekt og dra → flytter langs underlaget (gulv / vegg / tak /
  bordflate) med snapping (10 cm-rutenett av som standard, mot vegger, 15° rotasjon). `R` / `Shift+R`
  roterer ±15°, `Delete` sletter, `D` dupliserer, `Esc` velger bort, `Ctrl+Z` / `Ctrl+Y` angrer/gjør om.
  Når venstre knapp trykkes på et valgt objekt skal `Input` **ikke** starte mouse-look (legg til en
  `Input.setPointerClaim(fn)`-krok: `fn(event) → true` gjør at trykket tilhører plasseringen).
- **Plasser nytt**: CatalogPanel → «Plasser» → et halvgjennomsiktig spøkelse følger musa på riktig underlag →
  venstreklikk plasserer, høyreklikk/Esc avbryter, `R` roterer.
- **Visning** (`ViewModes`): `gå` (PlayerController), `oversikt` (OrbitControls rundt rommet, taket og veggene
  nærmest kameraet skjules – dukkehus) og `plan` (ortografisk ovenfra, taket skjult). `Tab` bytter. Myk
  overgang. Alle verktøy virker i alle visninger.
- **Fotovinkel**: `room-spec.photoCameras` og montasje-vinkelen kan settes som kamera (gå-modus parkeres).

## 12. UI
Samme visuelle stil som kraftverkspillet (ui.css). Nye paneler bygges med `ui/panelKit.js`:
`createPanel({ id, title, side: 'left'|'right'|'bottom', width }) → { el, body, open(), close(), toggle(), isOpen,
onClose }`, `tabs(...)`, `card(...)`, `swatches(colors, onPick)`, `colorPicker(hex, onChange)`, `slider({ label,
min, max, step, value, unit, onInput })`, `select({ label, options, value, onChange })`, `toggle(...)`,
`button(...)`, `paramEditor(schema, values, onChange)` (lager riktig kontroll per param-type).
Paneler fanger tastatur når et input-felt har fokus (spillet skal da ikke gå/rotere).

Verktøylinja (nederst): Katalog (K) · Veggforslag (V) · Vinduer (B) · Belysning (L) · Sol (T) · Visning (Tab) ·
Før/etter (O) · Design (M: lagre/åpne/eksport) · Handleliste (I) · Bilde (P) · Angre/Gjør om. Hjørnebadge:
etterklangstid («Etterklang ≈ 0,72 s», grønn ≤ 0,6, gul ≤ 0,7, rød over), klikk viser fordelingen.

## 13. Kanoniske delnavn (`parts`) – samme navn i katalog-varianter og modeller

| Arketyper | Deler |
| --- | --- |
| lenestoler, sofaer, spisestol, barkrakk | `upholstery` (trekk), `legs` (ben/fot), `frame` (synlig treramme, bare der den finnes) |
| bord, sidebord, skjenk, TV-benk, vegghylle | `body` (korpus/understell), `front`, `top` (plate), `legs`, `handle` |
| vitrineskap, garderobeskap, bokhylle, skoskap, veggskap | `body` (korpus), `front` (dører/klaffer), `top` (topplate), `legs` (understell), `handle` (grep) |
| kommode, nattbord | som bord: `body`, `front` (fronter), `top`, `legs`, `handle` |
| speilskap | `body`, `front` (speildører), `handle` |
| seng, sengegavl | `frame` (seng/ramme), `headboard` (hodegavl), `legs`, `bedding` (sengetøy), `throw` (sengeteppe, valgfri); gavl: `headboard`, `legs` |
| benk, spisestol med ramme | `upholstery` (sete/trekk), `legs`, `frame` (ramme, rygg, hylle) |
| håndklær | `fabric`, `piping` (bord/stripe) |
| håndklestige/-stang, knaggrekke, stumtjener, badetilbehør | `body`, `accent` (knagger/pumpe), `fabric` (håndklær/klær som vises) |
| lamper | `shade` (skjerm), `inner` (innside skjerm), `base` (fot/stativ), `metal` (arm/ramme/oppheng), `cord` |
| pute, pledd, puff | `fabric`, `piping` |
| teppe | `base`, `accent`, `accent2` |
| solskjerming | `fabric` (stoff), `slat` (lameller), `rail` (skinne/kasse/beslag) |
| plante | `leaves`, `pot` |
| vase, lysestake, kurv, TV, høyttaler | `body` (+ `flowers` for vase med blomster) |
| kunst, speil, gulvspeil | `print` (motiv/speilglass), `frame` |
| akustikkprodukter | `panel`, `slats`, `backing`, `frame` |

## 14. Navet: `design/Editor.js`

Opprettes av Game.js etter at huset er bygget. Alle verktøy og paneler får editoren i konstruktøren.
```js
class Editor {
  constructor(game, home)
  game, home, design /* DesignState */, sync /* SceneSync */, events, input, camera, renderer, scene, hud, uiRoot
  catalog                                  // catalog/index.js-modulen
  acoustics() → resultat fra computeAcoustics(design, home)
  selection /* Selection */, placement /* Placement */, views /* ViewModes */
  ui: { toolbar, catalog, inspector, wall, window, light, sun, saves, shopping, acoustics, photo }
  selected: { kind: 'item'|'wall'|'window'|null, uid?, wallId?, windowId? }
  select(target|null)                      // setter selected, sender 'select', åpner riktig panel
  startPlacing(itemSpec)                   // → placement.start
  update(dt)                               // hver frame: views, selection, placement, ui.*.update
  blocksGameInput() → bool                 // et tekstfelt har fokus eller et modalt panel er åpent
  dispose()
}
```
Konstruktører: `new Selection(editor)`, `new Placement(editor)`, `new ViewModes(editor)`, `new <X>Panel(editor)`.
Paneler: `open(arg?)`, `close()`, `toggle()`, `isOpen`, `update?(dt)`, `dispose()`.
`Placement`: `start(itemSpec, { onDone })`, `beginDrag(uid, hit)`, `isActive`, `cancel()`, `update(dt)`.
`ViewModes`: `mode` ('walk'|'orbit'|'plan'|'photo'), `set(mode)`, `toggle()`, `setPhotoCamera(cam)`, `exitPhoto()`,
`update(dt)` (spilleren står stille utenom 'walk'), `isWalking`.
Snarveier: Selection eier tastene for valgt objekt (R, Shift+R, Delete, D, Esc, piltaster = små flytt);
Toolbar eier de globale (K, V, B, L, T, Tab, O, M, I, P, Ctrl+Z, Ctrl+Y). Ingen snarvei virker mens et
tekstfelt har fokus.

## 15. Skall → lys (innebygde armaturer)
`buildShell`/`buildKitchen` returnerer `builtInLights: [{ id, group, label, type: 'led-strip'|'spot'|'ceiling'|
'pendant', from?: Vector3, to?: Vector3, position?: Vector3, direction?: Vector3, colorK, lumens, emissiveMeshes:
Mesh[] }]` (verdenskoordinater). `group` er en av `led` (LED-lister), `spots` (spotter ved den høye veggen),
`kjokken` (LED foran høyskapene og ringlampene i taket), `pendler` (de tre pendlene over kjøkkenøya), `tvstue`
(taklampa i TV-stua), `overskap` (lys under overskap). Hver gruppe har en standard-dimmer (`layout.lightGroups[].dimmer`);
av/på følger tiden på døgnet til gruppen slås av eller på for hånd. LightManager lager lyskildene og styrer emissiveMeshes. `buildExterior` returnerer `{ group, setDaylight(level
0..1, skyHex) }` så lyset kan dimme utsikten om kvelden.

## 16. Testing
- `npm run dev` (port 5180). URL-parametre: `?play=1&pos=x,y,z&yaw=deg&pitch=deg&view=walk|orbit|plan&design=<lagret navn>`.
- `node tools/shot.mjs "/?play=1&pos=…" ut.png --steps='[…]'` for skjermbilder (Edge headless).
- `window.__game` (Game), `window.__game.home`, `window.__game.design` (DesignState) for test-skript.
- Ingen konsollfeil. Bildefrekvens ≥ 50 fps på «middels» på en vanlig bærbar.
