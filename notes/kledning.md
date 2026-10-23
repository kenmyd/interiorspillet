# Ytterkledning, sokkel, terrasser og balkonger i husformatet

Husformatet har nå ytterkledning og dekk. Kledningen kan være tre (tømmermannskledning, dobbeltfals, skyggepanel eller
rett kledning, stående eller liggende), fasadeplater, puss, tegl eller naturstein. Den kan deles i soner per etasje,
vegg, høydebånd og gavl, med sokkel, hjørnekasser, omramming rundt vinduer og dører og beslag der to materialer møtes.
Dekkene er terrasser, balkonger, verandaer og takterrasser med bord, fliser eller betong, stolper eller lukket under,
rekkverk (glass, liggende eller stående spiler, stålspiler) og utvendige trapper ned til bakken. Dekkene og trappene kan
gås på.

Alt er valgfritt: to nye toppnøkler, `cladding` og `decks`. Et hus uten dem bygges som før. Eierens hus har ingen av
dem og er helt uendret. Det er kontrollert med `node tools/house-tests/owner-fingerprint.mjs`
(`layout 9fd8f7a355b0f410`, `rooms a7cf211c026c6559`, 301 mesher, likt før og etter) og med skjermbilder av spillet før
og etter: de tolv referansebildene til `tools/refcheck.mjs` (de åtte fotokameraene, spawn, dukkehuset fra sør og nord,
planen) og lys- og akustikkdumpen, laget på denne grenen før arbeidet og sjekket etter, pluss inngangen og terrassen
utenfra. Alt var likt.

**Kode:** modellen er `src/home/claddinggeom.js` og `src/home/deckgeom.js` (uten three.js; brukes av `layout.js`,
byggerne og validatoren). Byggerne er `src/home/cladding.js` (ytterlaget per veggstykke, kalt fra `rooms.js`) og
`src/home/decks.js` (dekkene, kalt fra `rooms.js` etter takene). Teksturene ligger i `src/world/surfaces.js`
(`facadeCovering`, `facadeFinish`). `layout.js` gir `layout.house.cladding`, `layout.house.decks`, og dekkene er med i
`floorYAt` og `walkRects`.
**Se dem:** `dev/kledning.html` (fem testhus i `src/dev/kledning-hus.js`, hvert med sin egen husfil). Knappene viser
husene og detaljene. «Tak» skjuler himlinger og tak (dukkehuset). «Gå (WASD)» lar deg gå med spillets figur på dekkene og
i trappene. Testserveren er «kledning-test» i `.claude/launch.json`, port 5278.
**Test:** `node tools/house-tests/kledning.test.mjs` (også med i `node tools/test-house.mjs`).

## Kledningen: `cladding`

```json
"cladding": {
  "default": { "type": "wood", "direction": "horizontal", "profile": "shiplap", "color": "#e6e2d8" },
  "zones": [ { "id": "gavl-plater", "gable": true, "type": "panels", "color": "#4f565b" } ],
  "plinth": { "height": 0.3, "material": "concrete" },
  "trim": { "color": "#f4f2ee", "corners": true, "surrounds": true }
}
```

### En finish: `default` og hver sone

| Felt | Standard | Betydning |
|---|---|---|
| `type` | `'wood'` | `'wood'` (tre), `'panels'` (fasadeplater), `'render'` (puss), `'brick'` (tegl) eller `'stone'` (naturstein). |
| `direction` | `'vertical'` | `'vertical'` eller `'horizontal'`. Gjelder tre og plater (liggende plater: modulen ligger). |
| `profile` | stående: `'board-batten'`, liggende: `'shiplap'` | Bare tre: `'board-batten'` (tømmermannskledning, 148 mm underbord med 48 mm lekter), `'shiplap'` (dobbeltfals, 128 mm dekkbredde med skyggelinje), `'shadow'` (skyggepanel, 110 mm bord med 10 mm spor), `'plain'` (rett kledning, 150 mm bord med tette skjøter). |
| `color` | tre `#4a4642`, plater `#8b8f91`, puss `#d9d6cf`, tegl `#8c4b3c`, stein `#85817a` | Middelfargen. |
| `module` | `[1.2, 2.4]` | **Nytt felt.** Bare plater: platestørrelsen `[bredde, høyde]` i meter. Fugene sentreres på veggen. |

`{}` gir det samme som før: stående tømmermannskledning i `#4a4642` (samme tekstur som eierens hus).

### Sonene: `zones[]`

Unntak fra `default`. Hver sone har feltene til en finish og disse:

| Felt | Betydning |
|---|---|
| `id` | Unik id (påkrevd). `name` er valgfritt. |
| `levelId` | Bare veggene på dette nivået. Uten: alle nivåer. |
| `walls` | Bare disse veggene (yttervegger). Tom eller uten: alle. |
| `from`, `to` | Høydebånd i meter over etasjens gulv. Uten `from`: helt ned. Uten `to`: helt opp. |
| `gable` | `true`: bare gavltrekanten (se under). |

- **Arv:** En sone uten `type` arver `default` (type, retning, profil, modul) og har sin egen `color` hvis den er gitt.
  En sone med samme `type` arver det den ikke sier selv. En sone med en annen `type` starter fra den typens standarder.
- **Rekkefølge:** Den siste sonen som gjelder for et punkt, vinner. Sett de brede sonene først og unntakene etter.
- **Kjelleren:** Nivåer under hovedetasjen har puss (`#d9d6cf`) hvis ingen sone gjelder, slik som før. `default` gjelder
  for hovedetasjen og oppover. Vil du ha noe annet på kjelleren, lager du en sone med `levelId`.
- **`facadeSegments`:** Har huset `cladding`, brukes ikke materialet og fargen fra `facadeSegments`. Validatoren varsler
  hvis begge finnes.

**Gavltrekanten** er den delen av ytterlaget som ligger over raftelinja. Raftelinja er det laveste punktet på
takprofilen langs veggen (der kledningen går opp i taket), forlenget ut til hjørnene. På en gavlvegg under saltak eller
pulttak er det trekanten (pulttak: trapesen) over takfoten. På langveggene er toppen vannrett, så de har ingen gavl.
Under en ark går gavlen opp i arken, og der blir arkens front gavl. Vegger uten tak over har ingen gavl. Validatoren
varsler om en gavlsone på et nivå uten saltak eller pulttak. Arkenes sider og forvegger på takoppletter bruker gavlsonen
for nivået (eller `default`).

### Sokkelen: `plinth`

| Felt | Standard | Betydning |
|---|---|---|
| `height` | 0.3 | Fra bakken opp til kledningen (0–3 m). |
| `material` | `'concrete'` | `'concrete'`, `'render'` eller `'stone'`. |
| `color` | betong `#9c9b96`, puss `#b9b6ae`, stein `#7d7a74` | |

Sokkelen er et bånd på ytterlaget, fra 0,3 m under bakken til `height` over den. Over båndet begynner kledningen, med et
beslag mellom dem. Under båndet har veggen sin egen finish, så en synlig kjeller beholder pussen. På et sokkelhus der
kjelleren står fritt mot én side, er kjelleren selve sokkelen. Bruk da en sone på kjelleren i stedet for `plinth`.

**Bakken** er gulvet i hovedetasjen − 0,15 m (`GROUND_STEP`, det samme som planbyggerens 3D-visning bruker). Det er
verdens-y. Et dekk kan ha sin egen bakke (`decks[].groundY`).

### Hjørnekasser og omramming: `trim`

| Felt | Standard | Betydning |
|---|---|---|
| `color` | fargen på `default` | Hjørnekassene og beslagene. |
| `corners` | `true` | Hjørnekasser: to bord (10 cm + 22 mm) på hvert utvendig hjørne mellom to yttervegger, og en firkantlist (45 mm) i innvendige hjørner. |
| `surrounds` | `true` | **Nytt felt.** Omramming: bord (10 cm) rundt hvert vindu og hver dør på utsiden. Vinduer får også et bord under, og smygen utvendig får samme farge. |

**Omrammingen har vinduets eller dørens egen karmfarge** (`frame.color` i vindusformatet, som er `#25272b` hvis den
mangler). Det er ingen egen farge for omramming. Uten `trim` er alt som før: ingen hjørnekasser og ingen omramming, og
smygen er mørk (`#2f2f31`).

Hjørnekassene går fra sokkelen (eller bunnen av ytterlaget) og opp i taket eller opp til etasjen over. Et hjørne som står
på et hjørne i etasjen under, begynner ved gulvet. Hjørnekassen under går da opp til samme gulv, over dekkekanten.

**Beslag** (2,5 cm ut fra veggen, i `trim.color` eller `#2f2f31`) ligger der to ulike finisher møtes: sokkel og kledning,
høydebånd og gavllinja. Det er åpning for vinduer og dører, og beslaget stopper ved hjørnekassene. Under bakken er det
ingen beslag.

## Dekkene: `decks[]`

```json
"decks": [
  { "id": "c-terrasse", "kind": "terrace", "levelId": "hoved", "y": -0.02, "groundY": -2.85,
    "outline": [[28.6, 0], [28.6, -3.2], [36.4, -3.2], [36.4, 0]],
    "surface": "boards", "supports": "posts", "railing": { "type": "wood-vertical" },
    "stairs": [ { "edge": 1, "at": 6.6, "width": 1.1 } ] }
]
```

| Felt | Standard | Betydning |
|---|---|---|
| `id` | – | Unik id (påkrevd). `name` er valgfritt. |
| `kind` | `'terrace'` | `'terrace'`, `'balcony'`, `'porch'` (veranda/trappeplatå) eller `'roof-terrace'`. |
| `levelId` | – | Etasjen dekket hører til. Uten `levelId` står dekket fritt på bakken. |
| `outline` | – | Omrisset `[[x, z], …]`, i samme koordinater som rom og vegger. Kantene som står mot huset, skal ligge på yttersiden av veggen. Kant `i` går fra `outline[i]` til `outline[i + 1]`. |
| `y` | 0 | Toppen av dekket i meter over gulvet i `levelId`, eller over bakken uten `levelId`. Ved en dør: −0,02 (2 cm under terskelen). |
| `surface` | takterrasse `'tiles'`, ellers `'boards'` | `'boards'` (terrassebord langs husveggen), `'tiles'` (fliser 60 × 60) eller `'concrete'`. |
| `color` | bord `#8b7d6b`, fliser `#9a9690`, betong `#a7a49e` | |
| `supports` | terrasse `'posts'`, veranda `'solid'`, balkong og takterrasse `'none'` | `'posts'`: stolper (12 × 12) under de frie kantene, høyst 2 m mellom dem, ingen inntil veggen. `'solid'`: lukket ned til bakken. `'none'`: ingenting under (balkong, takterrasse). |
| `railing.type` | terrasse og veranda `'wood-vertical'`, balkong og takterrasse `'glass'` | `'glass'`, `'wood-slats'` (liggende 7 cm spiler), `'wood-vertical'` (stående 36 mm spiler, 11 cm c/c), `'steel-bars'` (stålspiler) eller `'none'`. |
| `railing.height` | 1.0 | Høyden over dekket (0,5–2). |
| `railing.edges` | – | Kantnumre som skal ha rekkverk, uansett fall. Uten: alle frie kanter med fall over 0,5 m. |
| `railing.color` | stål og glass `#1d1e21`, tre: dekkets farge | **Nytt felt.** |
| `stairs[]` | – | `{ edge, at, width }`. Trapper ned til bakken, se under. |
| `thickness` | terrasse og veranda 0,2, balkong 0,18, takterrasse 0,12 | **Nytt felt.** Tykkelsen på dekket (det som synes i kanten). |
| `groundY` | bakken | **Nytt felt.** Bakken under dekket (verdens-y), for en skrånende tomt. Stolpene og trappene går ned hit. |

### Kantene, fallet og rekkverket

- En kant (eller en del av den) som står mot en yttervegg i dekkets høyde, får ikke rekkverk, ikke stolper og ingen
  kantflate. Dekket henger på veggen der.
- Fallet utenfor en fri kant er toppen av dekket minus det man lander på 0,3 m utenfor: bakken, gulvet i et rom eller et
  lavere dekk. Tak teller ikke, fordi de ikke kan gås på. En takterrasse får derfor rekkverk mot takflaten.
- Rekkverk står på frie kanter med mer enn 0,5 m fall (TEK17 § 12-17), men aldri der en trapp går ut. Med
  `railing.edges` står det på de kantene som er listet (bare de frie delene). `'none'` gir ingen rekkverk. Validatoren
  varsler om fall over 0,5 m uten rekkverk og om rekkverk lavere enn 0,9 m der det er fall.

### Trappene: `stairs[]`

| Felt | Standard | Betydning |
|---|---|---|
| `edge` | – | Kanten trappa går ut fra. Den må være fri. |
| `at` | midt på kanten | Midten av trappa, i meter fra `outline[edge]` langs kanten. |
| `width` | 1,0 (høyst kantens lengde) | Bredden (0,6–4). Trappa må ligge innenfor kanten. |

Trappa går rett ut fra kanten (vinkelrett, bort fra dekket) og ned til dekkets bakke. Opptrinnet R er høyst 0,18, og
inntrinnet er G = 0,62 − 2R, mellom 0,26 og 0,32. Dekkets kant er øverste trinn. På et dekk med bord blir trappa en
tretrapp med trinn, tette opptrinn og vanger. På fliser og betong blir den en støpt trapp. Har trappa mer enn 0,5 m
fall, får den rekkverk på begge sider i dekkets rekkverkstype. Ett opptrinn (lavt dekk) er bare kanten.

### Å gå på dekkene

Dekket er en lukket plate med kollisjon på toppen og kantene. Stolpene kolliderer også. Hvert rekkverk er en rad med
`Box3` opp til håndlista + 0,1 (biter på 10 cm langs en skrå kant). Hver trapp har en usynlig, lukket kile langs
neselinja, slik husets trapper har (`deck-wedge:<id>:<n>`, ikke i scenen). Figuren (r 0,3, steg 0,3) går opp og ned
uten å hoppe. `layout.house.floorYAt` finner dekket og rampa over trappa. `walkRects` har ett rektangel per dekk med
trapper (`deckId`).

## Byggeren

- **Ytterlaget per sone:** `rooms.js` bygger ytterlaget som før (opp i taket, opp til fasaden over, ned over
  dekkekanten). Med `cladding` kuttes kledningsflata langs vannrette linjer (sonenes `from` og `to`, gavllinja,
  sokkelens topp og bunn), og hvert bånd får sin finish. Bånd med samme finish blir ett. UV: u langs hele veggen (ikke
  bare stykket), v opp. Liggende tre og plater bytter u og v i geometrien. Teksturen roteres aldri.
- **Teksturene** er nøytrale grå sett som fargelegges per bruk (`facadeFinish(kind, hex, { profile, module })`,
  DataTextures som virker i Node). Det er ett cachet sett per type, profil og modul, og ett cachet materiale per finish.
  Stående tømmermannskledning bruker `claddingMaterial` (`woodCladding`), slik eierens hus gjør. Ingen vegg lager egne
  teksturer. Oppløsningen er full på «høy» og halv ellers.
- **Ingen flater i samme plan:** Båndene møtes uten overlapp (kuttene regnes likt fra begge sider). Hjørnekasser og
  omramming i ett veggstykke er én union av rektangler. Beslagene står 2,5 cm ut, gjæres i hjørner mellom yttervegger og
  ender rett ved en T-skjøt mot en skillevegg. Rekkverk slutter 1,2 cm fra husveggen, dekkets kant og trappas vanger.
  Håndlister som møtes i et hjørne, overlapper ikke. Lister er smalere enn stolpene og ender ved stolpeflatene.
  Testen sjekker dette for alle fem testhusene.
- **Navn:** `room-outside:<rom>:<materiale>` (kledningen er i rommets utebatch og kolliderer som før, `facade-<type>`,
  `painted <trimfarge>` for hjørnekasser og beslag og `painted <karmfarge>` for omramming), `deck:<id>` (gruppa i
  nivåets rot, `levelId`, ellers hovedetasjen) og `deck:<id>:<materiale>`.
- **Validatorrettelse (tak):** En yttervegg som står under veggen i etasjen over (ikke under et rom), regnes ikke lenger
  som «utenfor taket». Det traff testhus D, der 2. etasje står over halve 1. etasje.

## Eksempler

**Plater i gavlen og tre under** (testhus A): `"zones": [{ "id": "gavl", "gable": true, "type": "panels", "color": "#4f565b" }]`
med `default` som liggende dobbeltfals.

**Puss på kjelleretasjen og tre over** (testhus C):

```json
"cladding": {
  "default": { "type": "wood", "direction": "vertical", "profile": "shadow", "color": "#3b3f43" },
  "zones": [
    { "id": "kjeller-puss", "levelId": "kjeller", "type": "render", "color": "#cfc9bd" },
    { "id": "gavl-liggende", "gable": true, "type": "wood", "direction": "horizontal", "profile": "plain" }
  ],
  "trim": { "color": "#3b3f43" }
}
```

**Teglbånd nederst i 1. etasje, steinsokkel, bare hjørnekasser** (testhus B):

```json
"cladding": {
  "default": { "type": "wood", "direction": "vertical", "profile": "board-batten", "color": "#6b4a36" },
  "zones": [ { "id": "teglband", "levelId": "hoved", "to": 1.0, "type": "brick" } ],
  "plinth": { "height": 0.25, "material": "stone" },
  "trim": { "color": "#2f2f31", "surrounds": false }
}
```

**Én vegg i stein** (testhus D): `{ "id": "nord-stein", "walls": ["w-d1-n", "w-d2-n"], "type": "stone" }`.

**Balkong med glassrekkverk** i 2. etasje, foran en dør i veggen:

```json
{ "id": "b-balkong", "kind": "balcony", "levelId": "etg2", "y": -0.02, "outline": [[16.6, 0], [16.6, -1.5], [21.0, -1.5], [21.0, 0]] }
```

**Veranda med ett trinn og spiler på sidene** (fallet er under 0,5 m, så kantene er listet):

```json
{ "id": "a-veranda", "kind": "porch", "levelId": "hoved", "y": -0.02, "outline": [[3.6, 0], [3.6, -1.6], [6.3, -1.6], [6.3, 0]],
  "railing": { "type": "wood-slats", "edges": [0, 2], "height": 0.9 }, "stairs": [{ "edge": 1, "at": 1.35, "width": 1.4 }] }
```

**Takterrasse** på flatt tak over en fløy, fra en dør i 2. etasje (dekket ligger på taket):

```json
{ "id": "d-takterrasse", "kind": "roof-terrace", "levelId": "etg2", "y": -0.02, "thickness": 0.06,
  "outline": [[46.05, 0.3], [49.7, 0.3], [49.7, 6.7], [46.05, 6.7]], "railing": { "type": "steel-bars" } }
```

**Frittstående platting** med støpt trapp (uten `levelId`: `y` er over bakken):

```json
{ "id": "e-platting", "kind": "terrace", "y": 0.75, "outline": [[54, -0.5], [58.5, -0.5], [58.5, 2.6], [54, 2.6]],
  "surface": "concrete", "supports": "solid", "railing": { "type": "steel-bars" }, "stairs": [{ "edge": 3, "at": 1.2, "width": 1.2 }] }
```

## Validatoren

`validateHouse` bruker samme modell som `layout.js`:

- **Feil:** ukjent `type`, `direction`, `profile` eller `material`, ugyldig farge eller `module`, en sone uten id eller med
  samme id som en annen, en sone med en vegg som ikke finnes, ikke er yttervegg eller står på et annet nivå, et nivå som
  ikke finnes, `to` ≤ `from`, sokkelhøyde utenfor 0–3. Dekk: ukjent `kind`, `surface`, `supports` eller
  `railing.type`, et nivå som ikke finnes, et `outline` med færre enn tre punkter, som krysser seg selv, har en kant under
  5 cm eller er mindre enn 0,25 m², et dekk under bakken, ugyldige `railing.edges` eller `railing.height`, en trapp på en
  kant som står mot huset, en trapp som går utenfor kanten eller med ugyldig `edge` eller `width`, og samme id to ganger.
- **Advarsler:** ukjente felt (skrivefeil), `profile` eller `direction` på en type som ikke bruker det, en gavlsone uten
  saltak eller pulttak, `cladding` sammen med `facadeSegments`, fall over 0,5 m uten rekkverk, rekkverk lavere enn 0,9 m
  der det er fall, en balkong uten kant mot huset, et `outline` som går inn i et rom, to dekk som overlapper i samme
  høyde, en trapp som er unødvendig (under 0,1 m) eller høyere enn 4 m, og `railing.edges` på en kant som står mot huset.

`cladding` og `decks` er lagt til i `schema.topLevel` i `research/house/00-ids.json`.

## Til planbyggeren

- **Navnene er som dere ba om.** Nye felt: `cladding.trim.surrounds`, `zones[].name`, `module` (plater),
  `decks[].thickness`, `decks[].groundY` og `decks[].railing.color`.
- **Bakken** er hovedetasjens gulv − 0,15, det samme som `GROUND_STEP` i `viewer.js`. Sokkelen måles herfra, og dekk
  uten `levelId` har `y` over den. Senker dere bakken i visningen (for eksempel for en høy sokkel), si fra. Da gjør vi
  bakken til et felt i formatet. En skrånende tomt per dekk: `groundY`.
- **Fra fasadetegningen:** Kledningstype og retning per felt blir `default` og `zones`. Gavlfeltet blir `gable: true`. Et
  bånd blir `from` og `to` over etasjens gulv. En etasje blir `levelId`, og én fasade blir `walls`. Sokkelhøyden fra
  terrenglinja til kledningen blir `plinth.height`. Har en kjeller som står fritt egen finish, lag en sone på kjelleren.
  Uten sone har den puss.
- **Dekk:** Legg kantene mot huset på yttersiden av veggen (ikke midt i veggen; validatoren varsler hvis omrisset går
  inn i et rom). `y` −0,02 ved en dør. Rekkverket kommer av seg selv på kanter med fall. `railing.edges` tvinger det,
  for eksempel på en lav veranda. En trapp er `{ edge, at, width }` rett ut fra en fri kant.
- **Visningen trenger ikke noe nytt:** `buildRooms` bygger dekkene. Kolliderne kommer i `colliders` (`Box3` og usynlige
  kiler), og løkka i `viewer.js` tar begge. `doorRamps` ved en ytterdør med et dekk foran ligger under dekket og er
  harmløs, men den kan droppes der et dekk dekker døra (`layout.house.decks[].contains(x, z)`).
- **Kjente begrensninger:** `shell.js` (eierens stue) leser ikke `cladding` (eierens hus har det ikke). Trappene er rette,
  uten repos, og går vinkelrett ut fra kanten. Stolper står bare langs frie kanter (store dekk får ingen midtrad). Arkenes
  sider bruker gavlsonens materiale, men UV-ene derfra er alltid stående. Én bakke per hus, pluss `groundY` per dekk.
