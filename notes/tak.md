# Tak og skrå himling i husformatet

Husformatet har nå tak: saltak (også med ulike takfall og takfot på de to sidene), valmtak, halvvalm, mansardtak (med
gavler eller valmet), pulttak, flatt tak, V-tak og flatt tak eller pulttak bak en parapet (attika), med ark (takopplett,
også med valm og med flere vinduer) og innfelte takterrasser i takflaten, takstein, skifer, papp eller stålplater,
vindskier, vannbord, takrenner, mønepanne og vinkelrenner. Fløyer med ulik mønehøyde og bredde møtes i kiler og
vinkelrenner, også når fløyen står på etasjen under (L-, T- og U-hus), og en fløy som er høyere enn mønet går tvers
gjennom (kryssark). Himlinger kan følge taket (skrå himling, hanebjelkeloft), og vegger under taket får toppen fra
himlingen, så knevegger og gavler kommer av seg selv. Takvinduer (`ceilings[].skylights`) under et tak ligger i
takflaten. Ytterkledningen går opp under husets eget tak. Piper (`chimneys[]`) går fra gulvet eller fra taket og opp
gjennom taket, med beslag.

Alt er valgfrie felt. Et hus uten `roofs` bygges som før. Eierens hus har ingen `roofs`, og det ser ut nøyaktig som før,
også lyset. Det er kontrollert med skjermbilder av spillet før og etter (stua, høyveggen, gangen, kjelleren, inngangen og
terrassen: 0 piksler endret) og med `node tools/house-tests/owner-fingerprint.mjs`, som tar et fingeravtrykk av all
geometrien til eierens rom (`layout 9fd8f7a355b0f410`, `rooms a7cf211c026c6559`, likt før og etter).

**Kode:** modellen er `src/home/roofgeom.js` (uten three.js; brukes av `layout.js`, byggeren og validatoren), byggeren
`src/home/roof.js` (kalles fra `rooms.js`), tekkingene `roofCovering` og `roofFinish` i `src/world/surfaces.js`.
`layout.js` gir `layout.house.roofs` og `layout.house.roofFieldOf(levelId)`, og himlinger under tak får `surface`.
**Se dem:** `dev/tak.html` (seks testhus i `src/dev/tak-hus.js`, med knapper for visningene ute og inne og «Tak» for
dukkehusvisningen). **Test:** `node tools/house-tests/tak.test.mjs` (også med i `node tools/test-house.mjs`).

**Halvvalm, pulttaksark i ytterveggen, piper og vinduer med skrå overkant** (hus1, hus4, hus5): `dev/takdetaljer.html`
(fire testhus i `src/dev/takdetaljer-hus.js`, port 5279 med `takdetaljer-test` i `.claude/launch.json`; «Gå» går med
spillets figur, og `__bump('pipe-a', 's')` går figuren inn i en pipe). **Test:**
`node tools/house-tests/takdetaljer.test.mjs`. Pipene: modellen er `src/home/chimneygeom.js`, byggeren
`src/home/chimney.js`. Eierens hus er uendret også etter dette: fingeravtrykket er byte for byte likt, og de 12
visningene i `tools/refcheck.mjs` tatt før (b7456b7) og etter er like (0 piksler; ett bilde hadde 3–5 piksler støy, som
også kom mellom to bilder av samme kode). Lys- og akustikkdumpen er identisk.

**Flere taktyper** (se «Flere taktyper» under): `dev/taktyper.html` (ti testhus i `src/dev/taktyper-hus.js`, port 5271
med `taktyper-test` i `.claude/launch.json`). **Test:** `node tools/house-tests/taktyper.test.mjs` (sjekker også
fingeravtrykket til eierens hus: likt, `layout 9fd8f7a355b0f410`, `rooms a7cf211c026c6559`). Nytt i modellen:
`roofFields(parts)` (feltet for hver etasje, uten taket over etasjen over), `activePlane` og `planesProfile`.

## Taket: `roofs[]`

`roofs` er en ny toppnøkkel, en liste med takdeler. Hver del er et rektangel i plan med ett tak over. Et hus med L-,
T- eller U-form får én del per fløy, hver med `outline` på sin egen fløy. En del som står med en hel side mot en annen
del (sidefløyen, på samme etasje eller etasjen under), går inn under den andre til midten av den. Der to deler
overlapper, gjelder den høyeste, så fløyene møtes i kilrenner av seg selv (testhus F). Hovedhuset beholder takfoten
langs sidefløyen. Se «Tak som møtes» under for detaljene.

| Felt | Standard | Betydning |
|---|---|---|
| `id` | `roof-<n>` | Unik id. |
| `name` | `''` | Navn (vises bare på testsiden). |
| `type` | `'gable'` | `'gable'` (saltak), `'hip'` (valmtak), `'half-hip'` (halvvalm), `'mansard'` (mansardtak), `'mono-pitch'` (pulttak), `'flat'` eller `'butterfly'` (V-tak). Planbyggerens `doc.roof` bruker de samme navnene; `'gable-dormer'` er `'gable'` med `dormers`, og `'mixed'` er flere deler. |
| `levelId` | øverste etasje | Etasjen taket ligger over. Himlingene og veggene i den etasjen følger det. |
| `outline` | rektangelet rundt utsiden av etasjens yttervegger | Fire hjørner `[[x, z], …]`: yttersiden av veggene taket dekker (uten utstikk). |
| `pitch` | gable 35, hip 30, half-hip 35, mansard 60, mono-pitch 10, flat 0, butterfly 8 | Takvinkel i grader (0–70; mansard: den bratte nedre delen, 0–80). |
| `pitchBack`, `eaveHeightBack`, `kneeHeightBack`, `overhangBack` | `pitch`, forsidens takfot, `overhang` | Saltak og V-tak: baksidens takvinkel, takfot og utstikk. Se «Saltak med ulike takfall og takfot». |
| `pitchUpper`, `breakDepth`, `breakHeight`, `hipped` | 25, en seksdel av bredden, –, `false` | Mansardtak: den slake øvre delen, knekken og valmede ender. Se «Mansardtak». |
| `parapet` | – | Flatt tak og pulttak: `true` eller `{ height, top, thickness, color, copingColor }`. Se «Parapet». |
| `terraces` | `[]` | Innfelte takterrasser. Se «Innfelt takterrasse». |
| `valleys`, `valleyColor` | `true`, `#3e4145` | Vinkelrenner (beslag) der deler møtes, der en ark møter taket, i V-takets dal og på mansardens knekk. |
| `pitchEnds` | `pitch` | Valmtak og halvvalm: vinkelen på valmene (endene). |
| `hipHeight` | en tredel av gavlens høyde | Halvvalm: hvor langt ned fra mønet valmen går, målt der den møter yttersiden av gavlveggen. Se «Halvvalm». |
| `hipDepth` | – | Halvvalm, i stedet for `hipHeight`: hvor langt inn fra yttersiden av gavlveggen mønet begynner (`hipHeight = hipDepth · tan(pitchEnds)`). |
| `ridge` | langs den lengste siden | Saltak, valm, mansard og V-tak: mønets (V-tak: dalens) retning `[dx, dz]`. |
| `fall` | se under | Pulttak: retningen taket faller mot `[dx, dz]`. Uten `fall` er den høye siden den lengste kanten med lavest nummer i `outline`. Saltak med ulike sider og V-tak: forsiden er den som faller mot `fall` (uten `fall`: siden med den første kanten i `outline` langs mønet). |
| `ridgeHeight` | – | Mønehøyden: toppen av tekkingen på mønet (pulttak: den høye kanten; V-tak: de høye kantene) over etasjens gulv. |
| `kneeHeight` | – | Kneveggshøyden: der undersiden av taket møter innsiden av ytterveggen på langsiden, over etasjens gulv. |
| `eaveHeight` | høyeste yttervegg i etasjen | Undersiden av taket i ytterkant av veggen på langsiden (raftet), over etasjens gulv. |
| `overhang` | 0,5 (flatt tak 0,3; med parapet 0) | Utstikk ved takfoten (langsidene; valm, valmet mansard og flatt tak: alle sider). |
| `vergeOverhang` | 0,3 | Utstikk ved gavlene (pulttak: også den høye siden; halvvalm: også valmene øverst på gavlene). |
| `thickness` | 0,3 | Takets oppbygning (sperrer, lekter og tekking) målt vinkelrett på takflaten (mansard: den øvre delen; saltak med ulike sider og V-tak: den slakeste siden). |
| `covering` | gable, hip og half-hip `'tile'`, mansard `'slate'`, mono-pitch og butterfly `'steel'`, flat `'felt'` | `'tile'` (takstein), `'slate'` (skifer), `'felt'` (papp), `'steel'` (stålplater). |
| `color` | tile `#3a3634`, slate `#3c4046`, felt `#2b2b2d`, steel `#30343a` | Tekkingens middelfarge. |
| `trimColor` | `#2f2f31` | Vindskier, vannbord og takrenner. |
| `soffitColor` | `trimColor` | Undersiden av utstikket. |
| `gutters` | `true` når `pitch` ≥ 5 (ikke med parapet) | Takrenner langs takfoten (aldri på V-takets høye kanter). |
| `ridgeCap` | `true` unntatt på papp | Mønepanne langs mønet og gratene. |
| `wallThickness` | median av etasjens yttervegger | Veggtykkelsen `kneeHeight` måles fra. |
| `dormers` | `[]` | Arker og takoppletter, se under. |

Bare én av `ridgeHeight`, `kneeHeight` og `eaveHeight` trengs. Gis flere, gjelder den første i den rekkefølgen (og
validatoren varsler). Alle høyder er lokale, over gulvet i etasjen `levelId`, som ellers i husformatet.

**Hvordan taket er bygd:** hvert plan i modellen er **undersiden** av taket, altså himlingen i rommene under. Tekkingen
ligger `thickness / cos(pitch)` høyere. Et tak er det laveste av planene sine (saltak 2, valm og halvvalm 4, pulttak og
flatt 1).

### Halvvalm

`type: 'half-hip'` er et saltak der toppen av hver gavl er valmet (som på hus1). Gavlveggen står under valmen, og
kledningen går opp til valmen, 5 cm inn i taket (også en `cladding`-sone med `gable: true`). Inne følger gavlveggen
himlingen: med en himling som går til mønet (`type: 'roof'`), blir toppen av gavlveggen flat under valmen.

- `hipHeight` er hvor langt ned fra mønet valmen går, målt på yttersiden av gavlveggen. Standard er en tredel av gavlens
  høyde (fra raftet til mønet). Valmen er brattere enn eller like bratt som taket (`pitchEnds`, standard `pitch`).
- `hipDepth` er det samme målt vannrett: mønet begynner `hipDepth` inn fra gavlveggen.
- Vannbordet under valmen ligger `vergeOverhang · tan(pitchEnds)` lavere enn der valmen møter veggen. Leser du
  `hipHeight` fra en fasadetegning ned til vannbordet, trekk fra dette.
- Valmene har vannbord, men ingen takrenne. Gratene og mønet får mønepanne.
- Feil: `hipHeight` utenfor 0,1 m til gavlens høyde − 0,1 m (lenger ned blir det et valmtak), eller valmer som møtes.
  Advarsel: både `hipHeight` og `hipDepth` (da gjelder `hipHeight`).

```json
{ "id": "roof-hus1", "type": "half-hip", "levelId": "loft", "outline": [[0, 0], [10, 0], [10, 8], [0, 8]],
  "pitch": 40, "kneeHeight": 1.0, "hipHeight": 1.2 }
```

### Ark og takopplett: `dormers[]`

| Felt | Standard | Betydning |
|---|---|---|
| `id` | `<tak>-ark-<n>` | Unik id. |
| `type` | `'gable'` | `'gable'` (ark med saltak og egen gavl), `'hip'` (ark med valm: saltak med en valm foran) eller `'shed'` (pulttak, slakere enn taket). |
| `front` | – | To punkter `[[x, z], [x, z]]`: forkanten, yttersiden av fronten. Ligger den på husets yttervegg, er det en **ark**: veggen under går opp og blir arkens gavl, og vinduet står i veggen (`walls[].openings`). Ligger den lenger opp på taket, er det en **takopplett** med egen forvegg. |
| `height` | 2,2 | Høyden på arkens takfot foran, på undersiden, over etasjens gulv. |
| `pitch` | gable og hip: takets vinkel (på mansard 40); shed: 12 | Arkens takvinkel. |
| `pitchFront` | `pitch` | Ark med valm: valmens vinkel foran (10–80). |
| `overhang` | 0,25 | Arkens utstikk foran og på sidene. |
| `frontThickness` | 0,15 | Takopplett: forveggens tykkelse. |
| `window` | – | Takopplett: vinduet i forveggen, `{ width, height, sill?, frame?, sashes?, panes?, bars? }` (som et vindu, notes/vindusmodeller.md). Uten `sill` står det 15 cm under taket. |
| `windows` | – | Takopplett over flere vinduer: en liste som `window`, hvert med `offset` (fra forkantens første punkt langs forkanten til vinduets nærmeste kant); uten `offset` fordeles de jevnt. Gjelder foran `window`. |

Arken går fra fronten og inn til den møter taket (kilrennen). Forkanten bør stå parallelt med takfoten (den rettes inn).

**Ark med pulttak og front i ytterveggen (hus1, fasade 1):** `type: 'shed'` med `front` på yttersiden av husets vegg.
Pulttaket faller mot fronten (`pitch`, standard 12°, slakere enn taket) og stiger bakover til det møter hovedtaket i en
vannrett kilrenne. Veggen under fronten går opp og blir arkens front: inne følger toppen arkens himling, ute går
kledningen opp i arkens tak. Dører og vinduer i fronten er vanlige åpninger i den veggen (`walls[].openings`), også en
balkongdør. Takfoten på hovedtaket er kuttet mellom arkens sider, så en balkong (`decks[]`, `kind: 'balcony'` på
etasjen) kan stå foran. Sidene (vangene) er kledd fra hovedtaket og opp. `height` er undersiden av arkens takfot på
yttersiden av veggen, over gulvet; `overhang` er utstikket foran og på sidene.

```json
"dormers": [{ "id": "ark-hus1", "type": "shed", "front": [[4.0, 0], [7.6, 0]], "height": 2.4, "pitch": 15, "overhang": 0.35 }]
```

med en balkongdør og to vinduer i veggen under (x 4,0–7,6) og
`{ "id": "balkong", "kind": "balcony", "levelId": "loft", "y": -0.02, "outline": [[4.2, 0], [4.2, -1.2], [7.4, -1.2], [7.4, 0]] }`.

## Flere taktyper

Testhusene i `src/dev/taktyper-hus.js` (A–J, `dev/taktyper.html`) viser hver type. Alle feltene er valgfrie; et tak uten
dem bygges som før.

### Tak som møtes: fløyer med ulik mønehøyde og bredde (A, B)

- Hver fløy er sin egen takdel med `outline` på fløyen (yttersiden av veggene). En fløy kan ligge over en annen etasje
  enn hovedtaket (`levelId`): den lave sidefløyen og vindfanget på hus A har taket over `hoved`, hovedhuset over `loft`.
- **Inn i den andre:** en del med en hel side mot en annen del går inn under den til midten av den (til mønet på et L)
  og blir kuttet der den andre er høyere. Det som stikker opp over det andre taket, er kilen, og der flatene møtes,
  kommer vinkelrennene. Det skjer ikke på en side delen faller mot (en takfot beholder utstikket: to saltak side om side
  møtes i en renne over veggen mellom seg), og ikke når delen hele veien ligger over den andre (da går den andre inn i
  denne, som en lavere del i flukt med gavlen).
- **Gjennom den andre (kryssark):** er fløyens møne høyere enn den andres, går den tvers gjennom og ut på den andre
  siden, med sitt eget gavlutstikk der. Veggen under (hovedfløyens fasade) får gavlen opp til fløyens tak, inne og ute,
  og rommet under krysset får himlingen opp i begge takene (hus B).
- **Takfoten over en lavere fløy:** hovedtakets utstikk ligger over fløyens tak der det er høyere og blir kuttet der
  fløyens tak er høyere. Fløyens tak går videre inn under utstikket til veggen. Et vindfang eller tilbygg med pulttak
  inntil veggen under takfoten (hus A) er `type: 'mono-pitch'` med den høye siden mot huset.
- **Himlingene:** inne i en dels kjerne (outline + det den går inn i den andre) gjelder bare delene som har kjernen der,
  så sidefløyens himling under hovedhusets takfot er sidefløyens. Et rom under krysset ser den høyeste av dem.
- **Etasjer:** en etasje har ikke tak der en del på etasjen over har kjernen sin (etasjen over dekker den): stua under
  loftet på hus A har flat himling, selv om sidefløyens tak går inn over den. En vegg i etasjen under som står innenfor
  en slik kjerne, stopper under gulvet over, også når rommet på baksiden er åpent til sitt eget tak.
- **Vinkelrenner:** et beslag 22 cm bredt på hver side der to deler møtes, der en ark møter taket, i et V-taks dal og på
  en mansards knekk (`roof-valley:<id>`, farge `valleyColor`, av med `valleys: false`).
- **Begrensninger:** hver del er fortsatt et rektangel (en vinkel i ett tak er to deler). En innervegg mellom to rom som
  står opp over det lave taket, får ikke kledning: gi fløyen sin egen yttervegg med `backOf` fra rommet bak (som på
  hus A og B).

```json
{ "id": "roof-hoved", "type": "gable", "levelId": "loft", "outline": [[0, 0], [10, 0], [10, 8], [0, 8]], "pitch": 40, "kneeHeight": 1.0 },
{ "id": "roof-floy", "type": "gable", "levelId": "hoved", "outline": [[5.5, 8], [10, 8], [10, 13], [5.5, 13]], "pitch": 30, "ridge": [0, 1] },
{ "id": "roof-vindfang", "type": "mono-pitch", "levelId": "hoved", "outline": [[3, -2.5], [7, -2.5], [7, 0], [3, 0]], "pitch": 12, "fall": [0, -1], "eaveHeight": 2.25 }
```

### Saltak med ulike takfall og takfot (C)

`type: 'gable'` med ett eller flere av `pitchBack`, `eaveHeightBack`, `kneeHeightBack` og `overhangBack`. Forsiden er den
taket faller mot `fall` (uten `fall`: siden med den første kanten i `outline` langs mønet) og har `pitch`, `overhang` og
høydeankeret (`ridgeHeight`, `kneeHeight` eller `eaveHeight`). Baksiden har `pitchBack` (standard `pitch`),
`eaveHeightBack` eller `kneeHeightBack` (standard: samme høyde som forsiden) og `overhangBack`. Mønet havner der flatene
møtes (`split` i modellen: avstanden fra forsiden). Med `ridgeHeight` og ingen høyde for baksiden har begge takfotene
samme høyde. Gavlsonen i kledningen begynner ved den laveste takfoten.

- Feil: mønet havner utenfor huset, `pitchBack` utenfor 2–70. Advarsel: feltene på en annen type enn saltak og V-tak.

```json
{ "id": "roof-c", "type": "gable", "outline": [[34, 0], [44, 0], [44, 9], [34, 9]], "ridge": [1, 0], "fall": [0, -1],
  "pitch": 25, "eaveHeight": 2.4, "pitchBack": 45, "eaveHeightBack": 3.6, "overhangBack": 0.3 }
```

### Mansardtak (D, E)

`type: 'mansard'`: en bratt nedre del (`pitch`, standard 60°, inntil 80°) fra takfoten til knekken og en slak øvre
(`pitchUpper`, standard 25°, minst 5° slakere) til mønet, på begge langsider. Knekken står `breakDepth` inn fra yttersiden
av veggen (standard en seksdel av bredden), eller gi `breakHeight`: toppen av tekkingen på knekken over gulvet (les den
i fasadetegningen). `hipped: true` gir valmede ender med de samme vinklene (valmet mansard). Høydeankrene er som for
saltak; `kneeHeight` måles på den bratte delen. Gavlene følger profilen. Mønepanne bare på mønet og de øvre gratene,
beslag på knekken og de nedre gratene. Arker (kvister) står i den bratte delen og må slutte under knekken.

- Feil: `pitchUpper` ikke slakere enn `pitch`, knekken utenfor 0,2 m til midten − 0,3 m, et hus for kort for valmet
  mansard, en ark som går forbi knekken. Advarsel: mansardfeltene på en annen type.

```json
{ "id": "roof-d", "type": "mansard", "levelId": "loft", "outline": [[48, 0], [58, 0], [58, 8], [48, 8]],
  "pitch": 65, "pitchUpper": 25, "eaveHeight": 0.3, "breakDepth": 1.2,
  "dormers": [{ "type": "gable", "front": [[52.4, 0], [53.6, 0]], "height": 1.9, "pitch": 35, "overhang": 0.15 }] },
{ "id": "roof-e", "type": "mansard", "hipped": true, "outline": [[62, 0], [70, 0], [70, 7], [62, 7]], "pitch": 60, "pitchUpper": 22, "breakDepth": 0.8 }
```

### Parapet (attika) på flatt tak og pulttak (F, G)

`parapet: true` eller `{ height, top, thickness, color, copingColor }` på `type: 'flat'` eller `'mono-pitch'`. Parapeten
står på ytterveggene langs hele `outline` med vannrett topp: `height` over det høyeste punktet på tekkingen (standard
0,3) eller `top` over etasjens gulv (fra fasaden). `thickness` er standard veggtykkelsen. Kledningen går opp utsiden til
toppen, innsiden er tekkingen (eller `color`), og over ligger en beslått topp (`copingColor`, standard `trimColor`) som
stikker 4 cm ut på begge sider. Taket har da ingen utstikk, ingen vindskier og ingen takrenner (innvendig nedløp).

- Feil: parapet på en annen type, en topp under 5 cm eller over 2 m over tekkingen, `thickness` utenfor 0,08–0,8 m.
  Advarsel: `overhang` eller `vergeOverhang` sammen med parapet (de brukes ikke).
- Navn: `roof-parapet:<id>` (innsiden), `roof-coping:<id>` (beslaget).

```json
{ "id": "roof-f", "type": "flat", "levelId": "loft", "parapet": { "height": 0.45 } },
{ "id": "roof-g", "type": "mono-pitch", "pitch": 4, "fall": [0, 1], "eaveHeight": 2.6, "parapet": { "top": 3.6 } }
```

### Innfelt takterrasse: `terraces[]` (H)

En takterrasse skåret ned i en skrå takflate (saltak, valm, halvvalm, mansard, pulttak):

| Felt | Standard | Betydning |
|---|---|---|
| `id` | `<tak>-terrasse-<n>` | Unik id. |
| `front` | – | To punkter `[[x, z], [x, z]]` på takfoten: der yttersidene av sideveggene møter linja for yttersiden av veggen under raftet. |
| `depth` | – | Hvor langt inn fra den linja yttersiden av bakveggen står (minst 0,6 m). |
| `edge` | 0,04 | Hvor langt takkanten står ut over veggene rundt. |

Taket får et hull over terrassen, takfoten og takrenna er kuttet mellom sidene, og takkantene rundt hullet får vindski.
Veggene rundt (bakveggen med døra, sideveggene) er vanlige yttervegger i etasjen (`walls[]`), med toppen fra himlingen i
rommene innenfor og kledning opp i taket. Terrassegulvet er et dekk (`decks[]`, `kind: 'roof-terrace'`, `levelId`
etasjen): legg det 2 cm innenfor veggene og 2 cm over gulvet (`y: 0.02`) – kant i kant med veggene ligger dekkets kanter
i samme plan som kledningen. En yttervegg i en etasje over som står over et rom (rundt terrassen) begynner nå ved sitt
eget gulv, ikke nede ved undersiden av dekket (der lå den i samme plan som himlingen i rommet under).

- Feil: `front` som ikke ligger på takfoten, `depth` som når mønet (eller knekken), terrasse på flatt tak eller V-tak,
  en terrasse som overlapper en ark. Advarsel: bakveggen er lavere enn 2,0 m under taket.

```json
"terraces": [{ "id": "terrasse-h", "front": [[100.5, 0], [103.5, 0]], "depth": 2.2 }]
```

med dekket `{ "kind": "roof-terrace", "levelId": "loft", "y": 0.02, "outline": [[100.52, 0.02], [103.48, 0.02],
[103.48, 2.18], [100.52, 2.18]], "railing": { "type": "glass" } }`.

### Ark med valm og takopplett over flere vinduer (I)

- **Ark med valm:** `type: 'hip'` (og `pitchFront`, standard `pitch`) på en ark eller takopplett: saltak med en valm
  foran som stiger fra arkens takfot. Veggen under en ark på ytterveggen går opp til valmen (flat topp foran), og
  kledningen opp i den. Mønepanne på mønet og gratene, vinkelrenner der den møter taket.
- **Takopplett over flere vinduer:** `windows: [{ width, height, sill?, offset?, … }]` i stedet for `window`. Uten
  `offset` fordeles vinduene jevnt. Feil: et vindu som går utenfor forveggen, overlapper det før (minst 8 cm mellom)
  eller ikke får plass i høyden.

```json
"dormers": [
  { "id": "ark-i", "type": "hip", "front": [[114, 0], [117, 0]], "height": 2.3, "pitch": 40, "pitchFront": 45, "overhang": 0.3 },
  { "id": "opp-i", "type": "shed", "front": [[119.5, 7.2], [112.5, 7.2]], "height": 2.6, "pitch": 8,
    "windows": [{ "width": 1.0, "height": 0.8 }, { "width": 1.0, "height": 0.8 }, { "width": 1.0, "height": 0.8 }] }
]
```

### V-tak (sommerfugltak, J)

`type: 'butterfly'`: to flater som faller inn mot en dal. `ridge` er dalens retning, forsiden har `pitch` (standard 8) og
baksiden `pitchBack` (standard `pitch`); med ulike vinkler havner dalen nærmest den bratteste siden. Høydeankrene gjelder
de høye kantene: `eaveHeight` undersiden ved yttersiden av veggen på langsidene, `kneeHeight` ved innsiden, `ridgeHeight`
toppen av tekkingen på kantene, og `eaveHeightBack`/`kneeHeightBack` for baksiden. Gavlene blir V-formede, himlingen
følger taket, dalen får en renne (beslag) og de høye kantene vindskier, men ingen takrenner. I modellen er V-taket det
høyeste av de to planene (`combine: 'max'`).

- Feil: dalen utenfor huset, dalen under 1,5 m over gulvet, arker eller terrasser på et V-tak.

```json
{ "id": "roof-j", "type": "butterfly", "outline": [[125, 0], [134, 0], [134, 7], [125, 7]], "ridge": [1, 0], "fall": [0, -1],
  "pitch": 10, "pitchBack": 14, "eaveHeight": 3.0 }
```

## Piper: `chimneys[]`

`chimneys` er en ny toppnøkkel (i `schema.topLevel`). En pipe står på gulvet i det nederste rommet den står i, eller
begynner i taket, og går opp gjennom taket over seg.

| Felt | Standard | Betydning |
|---|---|---|
| `id` | `pipe-<n>` | Unik id (blant alle id-ene i huset). |
| `at` | – | Midten av pipa i plan, `[x, z]`. |
| `size` | brick og render `[0.5, 0.5]`, steel `[0.2, 0.2]` | `[bredde langs x, dybde langs z]`. En stålpipe er rund, og diameteren er den minste. |
| `material` | `'brick'` | `'brick'` (murt, teglstein), `'render'` (pusset) eller `'steel'` (rund stålpipe). |
| `color` | brick `#8a4b3c`, render `#d9d5cd`, steel `#2f3135` | Fargen utenfor. |
| `from` | `'floor'` | `'floor'`: fra gulvet i det nederste rommet som har pipa i seg (utenfor huset: fra bakken). `'roof'`: bare delen over taket. |
| `top` | 0,8 m over det høyeste punktet på tekkingen rundt pipa | Høyden på toppen: over gulvet i `levelId`, eller over bakken uten `levelId` (hovedetasjens gulv − 0,15). |
| `levelId` | – | Etasjen `top` er målt fra. |
| `insideColor` | `#ece9e3` (stål: `color`) | Fargen inne (pusset og malt; en stålpipe er stål også inne). |
| `flashingColor` | `#3a3c40` | Beslaget der pipa går gjennom taket. |

- **Inne** er pipa en kasse (stål: et rør) i hver etasje den går gjennom, fra gulvet opp til gulvet over, og i den
  øverste opp til takets underside. Hver del ligger i etasjens rot (`roots.levels`), vises i dukkehuset som en vegg og
  har en `Box3` i `colliders`, så figuren går ikke gjennom den. Himlinger og etasjeskiller går inn i den.
- **Over taket:** murt eller pusset pipe med en pipekrage i betong (4 cm utenfor) og et røykrør, en stålpipe med en
  skjøt og en regnhatt på tre bein. Beslaget er et bånd 15 cm opp langs sidene (8 mm ut fra pipa) og et forkle 10 cm
  bredt på tekkingen rundt; på en stålpipe en krage. Begge følger takflaten, også over mønet. Mønepanna stopper ved pipa.
  Alt over taket ligger i `pickables.ceilings` (skjules med taket) uten kollisjon.
- **Navn:** `chimney-inside:<id>:<nivå>`, `chimney:<id>`, `chimney-cap:<id>`, `chimney-flue:<id>`,
  `chimney-flashing:<id>`.
- **Feil:** ukjent `material` eller `from`, `at` eller `size` som ikke er gyldige, et nivå som ikke finnes, en id brukt
  to ganger, `from: 'roof'` uten tak over, ingen `top` og ikke noe tak over, en topp under 0,3 m over taket eller for
  nær bunnen. **Advarsler:** en pipe som står i en vegg, på kanten av taket eller ikke under et tak.

```json
"chimneys": [
  { "id": "pipe-stue", "material": "brick", "at": [2.2, 4.7] },
  { "id": "pipe-ovn", "material": "steel", "at": [19.4, 4.3] },
  { "id": "pipe-mone", "material": "render", "from": "roof", "at": [34.6, 4.0], "size": [0.6, 0.45] }
]
```

## Himlingene

| `ceilings[].type` | Under et tak |
|---|---|
| `'flat'` (eller ingen) | Flat i `height` (standard: etasjens `ceilingDefault`), men aldri over taket: der taket kommer lavere, følger himlingen taket. |
| `'roof'` (ny) | Følger taket helt opp til mønet. Med `height` er himlingen flat i den høyden (hanebjelkeloft): «SKRÅ HIMLING 24°» på hus2 er `type: 'roof'` uten `height`, loftet i hus1 er `type: 'roof'`, `height: 2.4`. |
| `'slope'` | Som før (eierens stue). |

En himling under et tak er stykkevis plan. `layout` gir den `surface` (`planeAt`, `heightAt`, knekklinjene `lines` og
trinnene `steps`), `maxHeight` og et volum som stemmer med formen. Byggeren deler himlingen langs knekklinjene og setter
loddrette flater der den hopper (sidene på en ark, inn mot arken). Lysberegningen (`lighting.js`) deler den på samme måte.

## Veggene under taket

En vegg i etasjen under et tak som ikke har sin egen `topProfile`, får toppen fra himlingen: den høyeste av himlingen i
sitt eget rom (1 cm inn i rommet) og himlingene i rommene på baksiden (`backOf`). Slik blir ytterveggen på langsiden
en **knevegg** (`kneeHeight`), gavlveggen følger takfallet opp til mønet eller hanebjelken, og veggen under en ark går
opp i arken med et trinn ved sidene. En vegg med egen `topProfile` beholder den. `height` på en vegg under et tak
brukes da ikke. Validatoren regner ut den samme toppen og gir feil når et vindu eller en dør når over den, for
eksempel et vindu i en knevegg.

## Ytterkledningen

- **Under et tak:** kledningen går opp i taket, 5 cm over undersiden ved ytterkanten av veggen. På gavlene følger den
  takfallet, og under en ark blir den arkens gavl. Der ingen takdel dekker veggen, går den 0,3 over veggen.
- **Under en etasje:** der fasaden i etasjen over står på denne veggen, går kledningen opp til undersiden av dekket
  over. Kledningen i etasjen over begynner der (ikke lenger 0,6 under gulvet), så de møtes uten å overlappe.
- **Uten tak:** eierens hus følger stuas skrå tak som før. Et hus uten `roofs` og uten skrått stuetak får kledning 0,3
  over veggen (forespørsel 4). Den flate «taklinja» planbyggeren legger langt unna huset, trengs ikke lenger.
- **Etasjer over hovedetasjen** får kledning som standard (som hovedetasjen). Kjelleren har fortsatt puss.

## Takvinduer under et tak

Et takvindu (`ceilings[].skylights`, notes/vindusmodeller.md) i et rom under et tak ligger i takflaten, med rammen
4 cm over tekkingen. Sjakta er fire loddrette bord fra 12 mm under himlingen opp til tekkingen, og taket får et hull på
samme sted. På en skrå himling er sjakta bare takets tykkelse. Under en flat himling går den opp til taket. Formatet er
det samme: `polygon` i plan, kant 0 er bredden. Legg kantene langs og på tvers av takfallet, og hold vinduet på én
takflate (validatoren varsler om et vindu over mønet eller skjevt i takflaten). Uten tak er takvinduene som før.

## Byggeren og dukkehuset

- **Ingen flater i samme plan:** undersiden av taket ligger 1 cm over himlingene (`ROOF_GAP`), kledningen går 5 cm inn
  i taket, mønepanna stikker 2 cm forbi vindskiene, og sjakta går 3 mm inn under vindusrammen. Testen sjekker at ingen
  to flater med samme retning overlapper i samme plan i alle seks testhusene, at stråler opp fra hvert rom treffer en
  himling og stråler ned på hvert tak treffer taket (ingen hull), og at ingen del av et tak henger ned i et rom.
- **Flere takdeler:** hver del kuttes der en annen del (på hvilken som helst etasje) er høyere, også takrenner og
  mønepanner – men ikke der dens egen kjerne ligger under den andres utstikk (se «Tak som møtes»). Himlingen får en
  loddrett flate der den går fra en lavere del inn under en høyere. Et hull som berører kanten av en takflate, kuttes
  nå ut av flaten (som hull i trianguleringen ble det fylt igjen).
- **Dukkehus:** alt i taket (tekking, underside, vindskier, renner, mønepanne, arkenes sider og forvegger) ligger i
  `pickables.ceilings` uten `pick` og uten kollisjon, og skjules sammen med himlingene. Det ligger i etasjens
  `roots.levels[levelId]`, så det skjules også med etasjen.
- **Navn:** `roof:<id>` (tekking), `roof-soffit:<id>`, `roof-trim:<id>`, `roof-ridge:<id>`, `roof-gutter:<id>`,
  `roof-cheeks:<id>`, `roof-front:<ark>`, `roof-front-inside:<ark>` (malingen til himlingen under), `roof-window:<ark>`
  (ett per vindu), `roof-valley:<id>` (vinkelrenner og knekkbeslag), `roof-parapet:<id>`, `roof-coping:<id>`.
- To motorretter som tak trengte: mørkt «dekke» (`cover:`) legges nå der etasjen over mangler (ikke bare
  hovedetasjens dekke), og aldri under et tak. Innervegger under et tak stoppes ikke lenger ved gulvet i etasjen over.

## Eksempler

Alle under har `levelId` på etasjen de ligger over og `outline` på yttersiden av veggene.

**Saltak med takstein over en loftsetasje (1 ½ etasje, knevegg 1,0 m):**

```json
{ "id": "roof-hus", "type": "gable", "levelId": "loft", "outline": [[0, 0], [10, 0], [10, 8], [0, 8]],
  "pitch": 40, "kneeHeight": 1.0, "covering": "tile" }
```

med himlinger `{ "type": "roof", "height": 2.4 }` (hanebjelkeloft) eller `{ "type": "roof" }` (åpent til mønet).

**Saltak i én etasje med «skrå himling 24°» i stua:**

```json
{ "id": "roof-hus", "type": "gable", "outline": [[50, 0], [58, 0], [58, 9], [50, 9]], "pitch": 24, "ridge": [0, 1],
  "covering": "tile", "color": "#7a3b2c", "trimColor": "#ece9e3" }
```

Taket sitter på veggene (`eaveHeight` = veggene). Stua har `{ "type": "roof" }`, de andre rommene flat himling.

**Valmtak med skifer:**

```json
{ "id": "roof-hus", "type": "hip", "outline": [[14, 0], [24, 0], [24, 8], [14, 8]], "pitch": 30, "covering": "slate" }
```

**Pulttak med stålplater, høyt mot nord:**

```json
{ "id": "roof-hus", "type": "mono-pitch", "outline": [[28, 0], [36, 0], [36, 6], [28, 6]], "pitch": 12, "fall": [0, -1],
  "covering": "steel" }
```

**Flatt tak med papp:**

```json
{ "id": "roof-hus", "type": "flat", "outline": [[40, 0], [46, 0], [46, 6], [40, 6]] }
```

**L-hus: hovedhus og en lavere sidefløy:**

```json
{ "id": "roof-hoved", "type": "gable", "outline": [[62, 0], [70, 0], [70, 6], [62, 6]], "pitch": 30 },
{ "id": "roof-floy", "type": "gable", "outline": [[66, 6], [70, 6], [70, 11], [66, 11]], "pitch": 30, "ridge": [0, 1] }
```

Sidefløyen står med hele sørsiden mot hovedhuset og går inn under det til mønet (z 3); kilrennene kommer av seg selv.

**Ark og takopplett på saltaket:**

```json
"dormers": [
  { "id": "ark-sor", "type": "gable", "front": [[6.5, 0], [8.5, 0]], "height": 2.3 },
  { "id": "opp-nord", "type": "shed", "front": [[8.0, 7.2], [6.0, 7.2]], "height": 2.6, "pitch": 10,
    "window": { "width": 1.2, "height": 0.7 } }
]
```

Arken står på veggen i z 0 (vinduet er et vanlig vindu i veggen under, `walls[].openings`). Takoppletten står 0,8 m
oppe på taket og har vinduet i sin egen forvegg.

## Validatoren

`validateHouse` sjekker `roofs` (`resolveRoofs` i `roofgeom.js` gir de samme meldingene til `layout.js`):

- **Feil:** ukjent `type` eller `covering`, `outline` som ikke er et rektangel, `pitch`, `thickness` eller utstikk
  utenfor grensene, et nivå som ikke finnes, en id brukt to ganger, en ark som er for lav for taket, når over mønet,
  ikke når over taket eller er smalere enn 0,4 m, en pulttaksark som ikke er slakere enn taket, et vindu som ikke får
  plass i forveggen til en takopplett, `type: 'roof'` på en himling uten tak over seg, og et vindu eller en dør som
  når over veggen under taket (kneveggen).
- **Advarsler:** flere høydeankre, en yttervegg som står utenfor taket (og ikke under en etasje), et takvindu over en
  knekk (møne, grat, ark) eller skjevt i takflaten, en forkant som ikke er parallell med takfoten, to takdeler i samme
  plan.

`roofs` og `chimneys` er lagt til i `schema.topLevel` i `research/house/00-ids.json`. Halvvalmen og pipene sjekkes som
beskrevet i sine avsnitt over, og vinduer med skrå overkant i notes/vindusmodeller.md. De nye taktypene (saltak med
ulike sider, mansard, parapet, innfelt takterrasse, ark med valm, takopplett med flere vinduer, V-tak) sjekkes som
beskrevet under «Flere taktyper», og en ark som går forbi mønet eller knekken der den står, er en feil. En gavlsone i
kledningen (`gable: true`) godtas også over mansardtak med gavler og V-tak.

## Til planbyggeren

- Skriv takformen fra fasadene som `roofs[]` (én del per tak, `type` som i `doc.roof`). `outline` kan utelates når
  taket dekker hele den øverste etasjen. Mønehøyden fra fasaden er `ridgeHeight` over gulvet i etasjen taket ligger
  over. Kneveggshøyden fra snittet er `kneeHeight`.
- Merk rommene med skrå himling med `type: 'roof'` (`height` for hanebjelken), og la veggene under taket være uten
  `topProfile`. Takvinduene kan stå som i dag; de havner i takflaten.
- Fjern den flate «taklinja» i `viewer.js` (`c-planbygger-taklinje`) når huset har `roofs`. Den brukes ikke da, og uten
  `roofs` og uten den får kledningen 0,3 over veggen.
- Endringer planbyggerens hus uten `roofs` også får: etasjer over hovedetasjen har kledning i stedet for puss som
  standard (F37 viste grå puss), kledningen i hovedetasjen går opp til kledningen i etasjen over, som begynner ved
  undersiden av dekket, og `cover:` legges bare der etasjen over mangler.
- Kjent begrensning: en T-skjøt mellom en yttervegg og en skillevegg med `backOf` gir et lite hull i toppen av
  ytterveggen. Det synes bare ovenfra i dukkehuset og er ikke en del av takarbeidet.
- **Halvvalm** (hus1): `type: 'half-hip'` med `hipHeight` (fra mønet ned til der valmen møter gavlveggen; i tegningen
  står vannbordet `vergeOverhang · tan(pitchEnds)` lavere) eller `hipDepth`. La gavlveggene være uten `topProfile`.
- **Arken på hus1:** `dormers: [{ type: 'shed', front: [[x, z], [x, z]] }]` med `front` på yttersiden av ytterveggen
  i loftsetasjen, `height` = undersiden av arkens takfot over loftsgulvet. Balkongdøra og vinduene er vanlige åpninger
  i den veggen, og balkongen er et dekk (`kind: 'balcony'`, `levelId` loftet). Pulttaket faller mot fronten og stiger
  bakover inn i hovedtaket, slik fasade 2 viser det.
- **Piper:** `chimneys: [{ id, at, size, material, top? }]`, `top` over bakken (eller over gulvet i `levelId`) fra
  fasaden. Uten `top` står den 0,8 m over taket. Stålpipene på hus4 og hus5 er `material: 'steel'`. Visningen trenger
  ingenting nytt: `buildRooms` bygger dem, og kolliderne kommer i `colliders`.
- **Skrå overkant** (hus4, hus5): `topSlope: 'follow-roof'` på vinduet, `height` målt til den høye enden. Et skrått
  overlys over en dør er et eget vindu over den (validatoren godtar nå åpninger over hverandre med minst 5 cm vegg).

### Til planbyggeren: de nye taktypene

Visningen trenger ingenting nytt for noen av dem: `buildLayout` og `buildRooms` bygger alt fra feltene under. Høyder er
over gulvet i etasjen taket ligger over (`levelId`), som før.

- **Fløyer (L-, T-, U-hus):** én `roofs[]`-del per fløy med `outline` på fløyens yttervegger og `levelId` på etasjen
  fløyen har taket over – en fløy i én etasje på et hus i 1 ½ etasje får `levelId: 'hoved'`, hovedhuset `'loft'`.
  Fløyen går selv inn i hovedtaket (kile og vinkelrenner), eller gjennom det når mønet er høyere (kryssark); send ingen
  ekstra felt for det. Et tilbygg eller vindfang med pulttak inntil veggen: `type: 'mono-pitch'`, `fall` bort fra huset,
  `eaveHeight` fra fasaden. Veggen mellom hovedhuset og fløyen: hovedhusets yttervegg med `backOf` fra fløyens rom.
- **Saltak med ulike sider:** `type: 'gable'`, `fall` mot forsiden, `pitch` og `eaveHeight` (eller `kneeHeight`) for
  forsiden fra gavlfasaden, `pitchBack` og `eaveHeightBack` (eller `kneeHeightBack`) for baksiden, `overhangBack` når
  utstikket er ulikt. Gi heller begge takfotene enn `ridgeHeight`: mønet havner der flatene møtes.
- **Mansard:** `type: 'mansard'`, `pitch` (den bratte delen), `pitchUpper` (den slake), `breakHeight` (knekken: toppen
  av tekkingen over gulvet, fra fasaden) eller `breakDepth`, og `eaveHeight`/`kneeHeight` eller `ridgeHeight`. Valmet
  mansard: `hipped: true`. Kvister i den bratte delen er vanlige `dormers` (typisk `type: 'gable'`) med `front` på
  ytterveggen; de må slutte under knekken.
- **Funkis / attika:** `type: 'flat'` (eller `'mono-pitch'` med fallet) og `parapet: { top }` med toppen av attikaen
  over gulvet fra fasaden (eller `height` over tekkingen). Ingen `overhang`. Veggene under er vanlige yttervegger.
- **Innfelt takterrasse:** `terraces: [{ front, depth }]` på taket, veggene rundt terrassen som yttervegger i
  etasjen (bakveggen med døra), og gulvet som `decks[]` med `kind: 'roof-terrace'`, `y: 0.02` og outline 2 cm innenfor
  veggene.
- **Ark med valm:** `dormers[].type: 'hip'` (og `pitchFront` når valmen er brattere). **Takopplett over flere vinduer:**
  `windows: [{ width, height, offset? }]` på takoppletten (`offset` fra forkantens første punkt).
- **V-tak:** `type: 'butterfly'`, `ridge` langs dalen, `fall` mot forsiden, `pitch`/`pitchBack` og `eaveHeight` (de høye
  kantene) fra gavlfasaden.
- Planbyggerens `doc.roof` kan bruke de samme navnene: `'mansard'` og `'butterfly'` er nye typer; attika, terrasse,
  valmet ark og flere vinduer er felt på delene.
