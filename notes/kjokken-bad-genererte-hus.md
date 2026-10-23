# Kjøkken, bad og vaskerom i genererte hus

Gren `claude/recursing-lehmann-126891` (fra `claude/hungry-mendeleev-b747e9`). Ikke pushet.

Genererte hus får nå faste installasjoner fra det plantegningene viser. Formatet er det samme som eierens hus har brukt
for bad og vaskerom (`builtIns[]`), med flere typer og standardverdier. Planbyggeren sender **én oppføring per symbol**
med type, posisjon, retning og størrelse. Motoren finner selv ut hvordan symbolene henger sammen:
- kummen, oppvaskmaskinen, koketoppen og ovnen blir en del av benken de står i;
- dusjen får glass og sluk ut fra veggene rundt den;
- flisene går til riktig høyde.

Eierens hus bygges som før (se «Eierens hus» nederst).

- Testhus: `tools/kjokkenbad/testhus.mjs` (kjøkken med øy, bad og vaskerom).
- Testside: `/tools/kjokkenbad/index.html?view=kjokken|benk|hoyskap|bad|dusj|kar|vask|vaskdusj` (testserver
  `kjokkenbad-test`, port 5271).
- Test: `node tools/house-tests/kjokkenbad.test.mjs` (64 sjekker).

## Formatet: `builtIns[]`

```js
{ id: 'bi-…', roomId, type, mount: 'wall' | 'floor', wallId /* når mount er 'wall' */,
  position: [x, y, z], rotationDeg, dims: { w, d, h }, params?, colors?, collide?, name?, estimated?, source? }
```

- **position** er i etasjens koordinater:
  - for `mount: 'floor'`: midten av fotavtrykket;
  - for `mount: 'wall'`: midten av baksiden, på veggflaten (som møblene);
  - `y` er underkanten over gulvet (overskap 1,45, speil 1,1, servant 0,35, ellers 0).
- **rotationDeg** er retningen fronten peker: 0 = +z (vest), 90 = +x (sør), 180 = −z (øst), −90 = −x (nord).
- **dims.w** måles langs fronten, **dims.d** i dybden og **dims.h** i høyden.
- **wallId** er veggen i rommet som det henger på eller står mot. Validatoren krever den for `mount: 'wall'`.
- `id` må begynne med `bi-`. Validatoren krever `id`, `roomId`, `type`, `mount`, `position` og `dims`.

Standardverdiene står i `BUILT_IN_DEFAULTS` i `src/home/builtinplan.js`, som planbyggeren kan importere. Bruk
størrelsen du måler på planen, og standardverdien for resten. Dybden 0,6 på en benk er standard.

## Symbolene på planen og hva de gir

`PLAN_SYMBOLS` i `builtinplan.js` har bokstavmerkene.

| På planen | type | mount | dims (w × d × h) | y | Merk |
|---|---|---|---|---|---|
| Benk langs vegg, dybde 0,6 | `kitchen-bench` | wall | lengde × 0,6 × 0,9 | 0 | `params.backsplash: true \| { color, size, height }`: flis mellom benken og overskapene |
| Øy (frittstående benk) | `kitchen-island` | floor | lengde × dybde × 0,9 | 0 | Frontene peker dit `rotationDeg` sier (mot benken). Skapene er 0,6 dype (`params.depth`), og resten er overheng til sitteplasser. |
| Overskap (stiplet over benken) | `wall-cabinets` | wall | lengde × 0,35 × 0,7 | 1,45 | `params.toCeiling` gir en fylling opp til taket |
| V, ventilator (stiplet over koketoppen) | `hood` | wall | 0,6 × 0,48 × 0,5 | 1,55 | Pipa går til taket |
| HS | `tall-cabinet` | wall | 0,6 × 0,6 × 2,1 | 0 | Fylles opp til taket når det er under 0,4 m igjen |
| K | `fridge` | wall | 0,6 × 0,6 × 2,1 | 0 | Integrert. Med h ≤ 1,0 er det et underbenkskap (blir en del av benken). |
| F | `freezer` | wall | 0,6 × 0,6 × 2,1 | 0 | Som K |
| K/F, KF | `fridge-freezer` | wall | 0,6 × 0,6 × 2,1 | 0 | |
| M/O, O/M | `oven-tower` | wall | 0,6 × 0,6 × 2,1 | 0 | Skuffer, ovn i arbeidshøyde, mikro over |
| KV (kum i benken) | `sink` | floor | 0,6 (dobbel 0,8) × 0,5 × 0,9 | 0 | `params.bowls: 2` for dobbel kum |
| OM | `dishwasher` | floor | 0,6 × 0,6 × 0,9 | 0 | |
| KT, koketopp (fire ringer eller sikksakk) | `hob` | floor | 0,6 × 0,52 × 0,9 | 0 | |
| ST (stekeovn under benken) | `oven` | floor | 0,6 × 0,6 × 0,9 | 0 | Under koketoppen: samme posisjon som `hob`. ST ved siden av G i en gang er et skap, ikke en ovn. |
| WC (skål med sisterne) | `wc` | wall | 0,6 × 0,2 × 1,1 | 0 | `dims` er kassa. Skåla kommer i tillegg. |
| Servant | `vanity` | wall | bredde × 0,46 × 0,5 | 0,35 | |
| Speil | `mirror` (firkantet), `mirror-round` | wall | 0,6 × 0,03 × 0,8 | 1,1 | |
| Dusj (firkant med kryss, glassvegger stiplet) | `shower` | floor | fotavtrykket × 2,0 | 0 | Se «Dusjen» |
| Badekar | `bathtub` | floor | 1,7 × 0,75 × 0,58 | 0 | `params.style: 'built-in'` (standard) eller `'freestanding'` (ovalt kar på planen) |
| Sluk (liten firkant eller ring) | `floor-drain` | floor | 0,15 × 0,15 × 0,005 | 0 | `params.shape: 'square' \| 'round' \| 'linear'` (rennesluk: w = lengden). `collide: false`. |
| Håndkletørker | `towel-radiator` | wall | 0,5 × 0,08 × 1,2 | 0,2 | `params.form: 'ladder'` |
| VM | `washer` | floor | 0,6 × 0,6 × 0,85 | 0 | Under en benk: send benken og maskinen hver for seg. Motoren lar det være et rom i benken. |
| TT | `dryer` | floor | 0,6 × 0,6 × 0,85 | 0 | Stablet på VM: `y` = 0,87, `params.stackedOn: '<id til VM>'` |
| Benk i vaskerommet | `laundry-bench` | wall | lengde × 0,6 × 0,9 | 0 | `params.sink: { at, w, d }`: kum i benken (`at` = fra midten langs benken) |
| Skyllekar, SK | `utility-sink` | wall | 0,6 × 0,5 × 0,9 | 0 | Dyp kum på et skap |
| VVB, VB, W i ring (hus4) | `water-heater` | floor | Ø 0,55 × 1,3 | 0 | `w` = diameteren |

Hvordan motoren tolker symbolene (`planBuiltIns` i `src/home/builtinplan.js`):
- **En del av benken.** `sink`, `dishwasher`, `hob`, `oven` og lave `fridge`/`freezer` som har midten inne i en
  `kitchen-bench` eller `kitchen-island` i samme rom, bygges som en del av den. Kummen skjæres ut av benkeplata, og
  koketoppen ligger oppå. Benken bygger enhetene der symbolene står, og fyller resten med skuffer på omtrent 0,6 m. Står
  et slikt symbol alene, får det en kort benk. Validatoren gir da en advarsel.
- **Maskiner under benken.** En `washer` eller `dryer` inne i en `laundry-bench` blir et rom i benkens korpus.
  Benkeplata går over maskinen.
- **Uten noe av dette** (eierens hus) blir oppføringene ikke endret.

## Dusjen

Send fotavtrykket (`position` i midten, `dims.w` × `dims.d`). Har dusjen ingen `corner`, `points` eller `glass`, finner
motoren ut av resten fra veggene i rommet:
- **Glass på sidene uten vegg**, med en dør på den lengste. Fra 1,1 m er det en skyvedør, under det en slagdør.
  - `params.door: 'auto' | 'sliding' | 'swing' | 'none'` velger dør.
  - `params.shape: 'pentagon'` gir en femkantet dusj. Det er den stiplede diagonalen eller kvartsirkelen på planen.
- **Uten vegger** (`params.enclosure: 'none'`): ingen glass og ingen kollisjon, så figuren går rett inn.
- **Dusjsettet** henger midt på den lengste veggen.
- **Sluket.** Ligger det ikke et `floor-drain` inne i dusjen, lages et firkantet sluk i midten. `params.drain: 'linear'`
  gir et rennesluk langs veggen med dusjsettet, og `false` gir ikke noe sluk.
- **Flis på dusjveggene** helt til taket, også i et rom som ellers har lavere flis.

## Fliser

**Gulv.** Send `floor: { material: 'tiles', color, size: [0.3, 0.3], surface: 'tile' }` på rommet når planen viser
rutenett (hus2 BAD og VASK, hus4 Bad og Vask.). Bad og vaskerom bør få det selv uten rutenett. Flisene blir teksturert
gulv med fuger, og skrittene lyder som flis.

**Vegger.** Send `rooms[].wallTiles`:

```js
wallTiles: true                                         // til taket i rommets standardfliser
wallTiles: { height: 'ceiling' | 1.2, from: 0, color: '#ecebe7', size: [0.3, 0.6], grout: 0.003, groutColor, wallIds?, u? }
wallTiles: [ { … }, { … } ]                             // flere soner (u = [fra, til] langs én vegg i wallIds)
```

Riktig høyde, som planbyggeren skal sende:
- **Bad:** `wallTiles: true`. Det gir flis til taket, standard i Norge.
- **Vaskerom:** `wallTiles: { height: 1.2 }`, eller `true` når vaskerommet er et fullt våtrom med dusj. Dusjveggene går
  uansett til taket.
- **Kjøkken:** ingen `wallTiles`. Flis bak benken kommer fra benkens `params.backsplash`. Den går fra benkeplata (0,9) til
  underkanten av overskapene over, eller 0,6 m opp der det ikke er overskap.

Flisene ligger 8 mm foran veggen (`TILE_T`):
- `'ceiling'` følger veggens overkant, også under skrått tak, og går aldri gjennom taket;
- flisene skjæres rundt dører, vinduer og åpninger, med kantflater der de slutter;
- det som henger på flis (WC, servant, speil, håndkletørker, skyllekar, dusjsettet), flyttes 8 mm ut;
- i et flislagt rom får WC-kassa og fronten på et innebygd badekar de samme flisene.

## Til planbyggeren (`src/planbygger/*`, endres ikke herfra)

1. **Eksporten** (`export.js`):
   - én `builtIns`-oppføring per symbol (tabellen over), med `roomId`, `wallId` for veggtypene og `estimated:
     ['position', 'dims']`;
   - på rommene `floor: { material: 'tiles', … }` og `wallTiles` for `bathroom`/`laundry`;
   - kjøkkenbenken sender benken og hvert symbol i den hver for seg, ikke én stor oppføring;
   - en L-benk er to `kitchen-bench`, én per vegg, og den andre begynner 0,6 m fra hjørnet.
2. **Visningen** (`viewer.js`) bygger ikke `builtIns` ennå. Legg til `buildBuiltIns(ctx, layout)` fra
   `src/home/builtins.js` ved siden av `buildRooms` og `buildStairs`, og ta med `colliders` i kollisjonen. Spillet
   (`src/home/index.js`) gjør det allerede.
3. **Validatoren** kjenner typene og feltene gjennom `research/house/00-ids.json`, som planbyggeren allerede bruker.
   Nye feil og advarsler:
   - feil: ukjent type, en veggtype uten `mount: 'wall'`, `dims` som ikke er over 0, ugyldige `params` (`enclosure`,
     `door`, `drain`, `shape`, `style`, `bowls`, `backsplash`), feil i `wallTiles` og feil `floor.size`;
   - advarsel: overskap eller ventilator under 1,2 m, og et kjøkkensymbol som ikke står i en benk.

## Det som ikke er gjort

- Ingen lys i overskap, ventilator eller speil. `mirror-round` har sitt LED-lys, `mirror` er et vanlig speil.
- Ingen hjørneskap. En L-benk er to benker, og den andre begynner 0,6 m fra hjørnet. Blindhjørnet er ikke modellert.
- Gulvet faller ikke mot sluket.
- Flisene har ingen kantlist på utvendige hjørner. Inne i et rom er alle hjørner innvendige.
- Den skrå dusjen finner hjørnet fra veggene, men glasset følger fotavtrykket med standard returer (0,37).
- Ovnen og mikroen er svarte glassfronter med håndtak, uten display.

## Filene

| Fil | Hva |
|---|---|
| `src/home/builtinplan.js` (ny) | Planen: slotter, dusj, sluk, flissoner, flytting ut fra flisa, `BUILT_IN_DEFAULTS`, `PLAN_SYMBOLS`, `hostOf` |
| `src/home/kitchenkit.js` (ny) | Benk, øy, overskap, ventilator, høyskap, kjøle- og fryseskap, ovnsskap, slottene. Bruker `fittings.js` som `kitchen.js` |
| `src/home/walltiles.js` (ny) | Flisene på veggene |
| `src/home/builtins.js` | Kjører planen før byggingen, bygger flisene i rommets batch, `k.tileMaterial` |
| `src/home/bathroom.js` | `bathtub`, `mirror`, rennesluk, dusj uten vegger, dusjsettet på flis, flislagt WC-kasse |
| `src/home/laundry.js` | `utility-sink`, rom for maskiner under benken, dører på omtrent 0,6 når benken ikke har moduler, `sink.at` og `sink.depth` |
| `src/home/layout.js` | Sender `rooms[].wallTiles` videre |
| `src/home/rooms.js` | Gulv med `material: 'tiles'` blir teksturert, og skrittene lyder som flis |
| `src/data/scripts/house.mjs`, `research/house/00-ids.json` | Validatoren |
| `tools/kjokkenbad/*`, `tools/house-tests/kjokkenbad.test.mjs`, `.claude/launch.json` | Testhuset, testsiden og testen |

## Eierens hus

Planen endrer ikke eierens oppføringer. Det er de samme objektene i samme rekkefølge, og huset har ingen fliser, noe
testen sjekker. Fingeravtrykket er likt før og etter. `owner-fingerprint.mjs` og byggingen av `builtIns` ble målt med
`configureMaterials({ textureRes: 0.125 })`:
- layout `9fd8f7a355b0f410`;
- rooms `a7cf211c026c6559` (301 mesher);
- builtIns `4253f44bad881598` (44 mesher);
- kollisjon `1c82b6590fca5ffc`.

`kitchen.js` er ikke endret. `node tools/test-house.mjs` er grønn med alle 27 testene.
