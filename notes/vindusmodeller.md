# Vindusmodeller i husformatet

Vinduene i husformatet kan nå være inndelt (todelt, tredelt, overlys, rutenett av felt), ha sprosser, og hvert felt kan
være fast eller åpningsbart med hengslene oppe, nede, til venstre eller til høyre. Takvinduer (`ceilings[].skylights`)
bygges med hull i himlingen, en foret sjakt og et ekte vindu. Alt er valgfrie felt: et vindu uten dem bygges som før.

Byggeren er `buildWindow` i `src/home/wallkit.js` (brukt av `rooms.js` og `shell.js`). `rooms.js` bygger gulvet ut til
karmen og takvinduene, `layout.js` sender feltene videre, og `validateHouse` i `src/data/scripts/house.mjs` sjekker dem
(`windowModelIssues(o)` er eksportert, så planbyggeren kan sjekke ett vindu for seg).

**Se dem:** `dev/vinduer.html` (testhuset i `src/dev/vinduer-hus.js`: 20 vinduer og 2 takvinduer, med knapper for
visningene). **Test:** `node tools/house-tests/vinduer.test.mjs` (også med i `node tools/test-house.mjs`).

2026-10-23: formede vinduer (`shape`: gavlvindu, trekant, rundt, mangekant), hjørnevindu (`corner`), glassvegg og
fransk balkong (`frenchBalcony`), se «Fasadetypene» under. **Se dem:** `dev/fasadetyper.html` (to hus i
`src/dev/fasadetyper-hus.js`). **Test:** `node tools/house-tests/fasadetyper.test.mjs`. Bygget på grenen
`claude/hungry-mendeleev-b747e9` (vinduer med skrå overkant), som ikke er godkjent inn i master ennå.

## Feltene på et vindu

Et vindu er en åpning med `type: 'window'` i `walls[].openings[]`. Hullet er som før: `offset`, `width`, `height` og
`sill` (underkanten av hullet over gulvet; med `sillBoard` er det toppen av vinduskarmplata).

| Felt | Standard | Betydning |
|---|---|---|
| `sashes` | ett fast felt | Feltene i vinduet, se under. De skal dekke hele vinduet uten å overlappe. |
| `panes` | `[1, 1]` | `[kolonner, rader]` med ruter i hvert felt som ikke har sin egen `panes`. Hele tall 1–12. |
| `bars.width` | `0.024` | Sprossenes bredde i meter (0,005–0,08). Den krympes til en tredel av ruta, så smale vinduer får plass. |
| `bars.color` | rammens farge | Sprossenes farge, for eksempel hvite sprosser i en svart ramme. |
| `frame.color` | `'#25272b'` | Rammens farge (som før). |
| `frame.width` | `0.07` | Synlig ramme fra hullet til glasset langs ytterkanten (som før). |
| `frame.depth` | `0.07` | Rammens dybde i veggen (som før). |
| `frame.mullion` | `max(0.03, 0.6 × frame.width)` | Bredden på posten (loddrett) eller losholtet (vannrett) der to felt møtes. |
| `revealFloor` | `true` når `sill` er 0 og det ikke er noen `sillBoard` | Rommets gulv går ut til karmen. Gjelder bare vinduer som står på gulvet. |
| `reveal`, `sillBoard`, `frosted` | som før | Lysningens dybde og farge, vinduskarmplata og frostet glass. |
| `topSlope` | – (vannrett) | Skrå overkant: grader (−80 til 80), stigende mot høyre sett fra rommet, eller `'follow-roof'` (parallelt med veggens topp over vinduet). Se «Skrå overkant» under. |

Hvert felt i `sashes`:

| Felt | Standard | Betydning |
|---|---|---|
| `from`, `to` | `0`, `1` | Brøk av bredden, fra venstre mot høyre sett fra rommet. |
| `bottom`, `top` | `0`, `1` | Brøk av høyden, fra `sill` og opp. |
| `opening` | `false` | `true`: åpningsbart (karm, ramme med skyggefuge, håndtak). `false`: fast glass med glasslist. |
| `hinge` | `'top'` | `'top'`, `'bottom'`, `'left'` eller `'right'`: hengslene sett fra rommet. Håndtaket står på motsatt side (topphengslet: midt på bunnstykket; sidehengslet: midt på motsatt side, pekende ned). |
| `panes` | vinduets `panes` | `[kolonner, rader]` med ruter i dette feltet. |

Vanlige feil fanges av validatoren: et hull mellom feltene (det ville blitt et åpent hull i veggen), felt som overlapper,
`from ≥ to`, ukjent `hinge`, ugyldige `panes` og `bars`. Den varsler når rammen tar nesten alt glasset, når rutene blir
under 6 cm, og om `revealFloor: true` på et vindu som ikke står på gulvet. For oppføringer med `estimated` blir feilene
bare advarsler.

### Hva byggeren gjør

- **Ingen flater i samme plan:** karmen er 2,5 mm smalere enn hullet og står 1,25 mm under toppen av det
  (`FRAME_INSET` i `wallkit.js`), og den står på sålen. Gummilista i faste vinduer står 1 mm dypere enn glasset. Der
  sprossene krysser hverandre, er de vannrette 2 mm grunnere. Testen sjekker at ingen to flater med samme retning
  overlapper i samme plan.
- **Rammen står inne i veggen:** uten `reveal.depth` blir lysningen så dyp som veggen. Da settes rammen i veggen
  (veggtykkelse − rammedybde − 5 mm), også for vinduer som står på gulvet. Glassfeltene ved ytterdører er unntatt.
- **Gulv ut til glasset:** for et vindu med `sill` 0 får rommets gulv en stripe ut til karmen. Stripa er en del av
  gulvflaten (`floor:<rom>`), så den har samme materiale, bordretning og kollisjon. Har lysningen egen farge, får den
  da ingen bunnforing.
- **Ett glass per vindu:** alle glassfeltene er slått sammen i én mesh, `glass:<id>`. Den står på dybden til det første
  feltet, slik `shading.js` leser den.

## Former og størrelser

Formen er bare `width`, `height` og `sill`, og inndelingen kommer i tillegg:

- **Smalt og høyt:** `width: 0.45, height: 1.8, sill: 0.5`.
- **Lite og firkantet:** `width: 0.6, height: 0.6, sill: 1.4`.
- **Helt ned til gulvet:** `sill: 0`, uten `sillBoard`. Toppen kan gå opp til veggens høyde.
- **Skrå overkant** langs taket: `topSlope`, se under.

## Skrå overkant: `topSlope`

Et vindu i en vegg under et skrått tak (en gavl, en vegg under et pulttak, som på hus4 og hus5) kan ha overkanten
parallell med takfallet. Karmen, rammene, glasset, sprossene, hullet i veggen, hullet i kledningen, omrammingen
(`cladding.trim.surrounds`) og foringen i lysningen følger skråningen. Et vindu uten `topSlope` bygges nøyaktig som før.

- `topSlope: 'follow-roof'`: overkanten følger veggens topp over vinduet (linja mellom toppen ved de to sidene). Under et
  tak (`roofs`) er veggens topp himlingen, så overkanten blir parallell med takfallet. Knekker veggens topp over
  vinduet (mønet i en gavl), følger overkanten linja mellom endene, og validatoren varsler.
- `topSlope: 20` (grader): overkanten stiger 20° mot høyre sett fra rommet, altså fra veggens `from` mot `to`. Negativt:
  den faller. Fra utsiden er det motsatt, slik som for `sashes`.
- **Høyden:** `sill + height` er den høye enden av overkanten (vinduets ytre ramme, som på fasaden). Den lave enden er
  `width · tan(vinkel)` lavere. Det må være minst 0,1 m mellom den og brystningen.
- **Feltene:** felt som går helt til toppen (`top: 1`, standard), får skrå overkant. Felt under et losholt (`top` < 1)
  er rektangler og må slutte under den lave enden av skråningen der de står. Sprossene i et skrått felt går opp til
  skråningen, og de vannrette stopper der skråningen kommer ned til dem. Rutene deles etter feltets midthøyde.
- Et overlys over en dør er et eget vindu over døra, med `sill` over dørens topp. To åpninger over hverandre i samme
  vegg er ikke en overlapp når det er minst 5 cm vegg mellom dem.

```json
{ "id": "win-loft-1", "type": "window", "offset": 0.55, "width": 0.8, "height": 1.3, "sill": 0.7, "topSlope": "follow-roof" }
```
Under skråtaket i en gavl på loftet: den høye enden 2,0 m over gulvet.

```json
{ "id": "win-stue-1", "type": "window", "offset": 0.9, "width": 2.0, "height": 3.0, "sill": 0.4, "topSlope": "follow-roof",
  "sashes": [{ "to": 0.5, "top": 0.7 }, { "from": 0.5, "top": 0.7, "opening": true, "hinge": "right" },
             { "to": 0.5, "bottom": 0.7 }, { "from": 0.5, "bottom": 0.7 }] }
```
Det store vinduet på hus5: fire felt, de to øverste følger takfallet.

```json
{ "id": "win-overlys", "type": "window", "offset": 0.8, "width": 1.0, "height": 0.55, "sill": 2.2, "topSlope": "follow-roof" }
```
Overlyset over en dør (offset 0.8, bredde 1.0, høyde 2.1) på hus4.

Byggeren: `layout.js` gir åpningen `topSlope` (stigning per meter langs veggen, 0 = vannrett), `topU0` og `topU1`
(toppen ved `u0` og `u1`), og `top` er fortsatt den høyeste. `wallLayer` i `wallkit.js` tar `y1b` på hull og
utsparinger, `buildWindow` bygger skrå felt som trapeser (`quadPrism`), og `cladding.js` lager omrammingen med et skrått
toppbord. Validatoren sjekker at den skrå toppen holder seg under veggen ved begge ender og ved hvert knekkpunkt i
veggens topp.

## Fasadetypene

Alt er valgfrie felt på åpningen i `walls[].openings[]`. Uten dem bygges vinduet nøyaktig som før.

### Formede vinduer: `shape`

| Felt | Standard | Betydning |
|---|---|---|
| `shape` | – (rektangel) | `'gable'` (femkant under mønet), `'triangle'`, `'round'` eller `'polygon'`. Bare på `type: 'window'`. |
| `width`, `height`, `sill` | som før | Boksen rundt formen. `sill + height` er det høyeste punktet (toppen). |
| `peak` | der veggens topp er høyest over vinduet (mønet), ellers 0,5 | `'gable'` og `'triangle'`: der toppen er, brøk av bredden fra venstre sett fra rommet. |
| `shoulder` | etter taket | `'gable'`: høyden på de loddrette sidene over `sill`, i meter. Uten den følger skråkantene veggens topp (taket), og uten tak over er de 35°. |
| `points` | – | `'polygon'`: hjørnene `[[x, y], …]` som brøker av bredden (fra venstre sett fra rommet) og høyden (fra `sill`). Formen må være konveks. |

- **Gavlvindu** (`'gable'`): de loddrette sidene opp til skuldrene, så to skråkanter til toppen. I en gavl under et
  tak (`roofs`) er skråkantene parallelle med takfallet på hver side av mønet, og `height` sier hvor nær mønet
  toppen er. Med mønet utenfor vinduet blir det en trapes. Er skulderen på brystningen, blir den siden en trekant.
- **Trekantvindu** (`'triangle'`): bunnen er hele bredden, og toppen er `peak`. Skråkantene følger ikke taket.
- **Rundt vindu** (`'round'`): en sirkel (en ellipse når `width` og `height` er ulike). Det kan ikke stå på gulvet,
  og det får ingen vinduskarmplate.
- **Inndeling:** et formet vindu er fast. Grensene i `sashes` blir poster og losholt (`frame.mullion` brede), og
  `panes` gir sprosser som klippes av glasset. `opening: true` brukes ikke, og validatoren varsler.
- Byggeren følger omrisset med karm, glassliste, gummilist, glass, hullet i veggen, hullet i kledningen, omrammingen
  (`cladding.trim.surrounds`) og foringen i lysningen. `topSlope` brukes ikke sammen med `shape`.

```json
{ "id": "win-gavl", "type": "window", "offset": 1.7, "width": 3.0, "height": 3.6, "sill": 0.5, "shape": "gable",
  "sashes": [{ "to": 0.3333 }, { "from": 0.3333, "to": 0.6667 }, { "from": 0.6667 }] }
```
Gavlvindu i vestgavlen under et saltak (35°), med to poster: skråkantene følger takfallet.

```json
{ "id": "win-trekant", "type": "window", "offset": 2.45, "width": 1.5, "height": 1.05, "sill": 2.75, "shape": "triangle" }
{ "id": "win-rund", "type": "window", "offset": 4.65, "width": 0.7, "height": 0.7, "sill": 1.3, "shape": "round", "panes": [2, 2] }
{ "id": "win-sekskant", "type": "window", "offset": 1.0, "width": 0.8, "height": 0.8, "sill": 1.2, "shape": "polygon",
  "points": [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]] }
```

### Hjørnevindu: `corner`

To vinduer i to yttervegger som møtes i et utvendig hjørne. Hjørnet mellom dem er borte fra brystningen til toppen, og
en hjørnepost står der (så dyp som veggen utenfor rammen, 10 cm i en 0,3 m vegg med `reveal.depth` 0,2).

| Felt | Betydning |
|---|---|
| `corner` | `'to'`: vinduet går til veggens `to`-ende og rundt hjørnet; `'from'`: til `from`-enden. |

- Vinduet på den andre veggen har motsatt `corner` (`'to'` møter `'from'`). Begge har samme `sill` og `height`, og
  samme `reveal.depth`. `offset` og `width` er hullet på romsiden: `offset + width` er veggens lengde for `'to'`,
  og `offset` er 0 for `'from'`.
- Rammen går forbi rommets hjørne inn til hjørneposten, uten karm på den siden. Karmplata og vannbrettet er gjæret
  inn i hjørnet. Kledningens hjørnekasse stopper under vinduet og fortsetter over det, og omrammingen går rundt
  hjørnet.
- Validatoren gir feil når vinduet ikke når hjørnet, når den andre veggen mangler et vindu med motsatt `corner`, når
  de har ulik høyde, og når hjørnet er innvendig. Et hjørnevindu kan ikke ha `shape` eller `topSlope`.

```json
{ "id": "win-hj-s", "type": "window", "offset": 8.3, "width": 1.1, "height": 1.3, "sill": 0.8, "corner": "to",
  "sashes": [{ "opening": true, "hinge": "left" }] }
{ "id": "win-hj-o", "type": "window", "offset": 0, "width": 1.4, "height": 1.3, "sill": 0.8, "corner": "from" }
```
Sørveggen (9,4 m) til høyre ende, østveggen fra sin første ende: de møtes i sørøst.

### Glassvegg og dør i glassvegg

- **Glassvegg:** et vanlig vindu over flere meter med `sill: 0` og `height` til like under veggens topp, delt med
  `sashes` (postene `frame.mullion` brede). Gulvet går ut til karmen. Feltene kan være åpningsbare.
- **Dør i glassvegg:** en dør med flere sidefelt (`door.sidelights`, se `notes/dortyper.md` 4). Flere sidefelt på
  samme side står etter hverandre fra karmen og inn, med en post mellom. Da er glassveggen og døra ett element med
  felles karm.

```json
{ "id": "win-glassvegg", "type": "window", "offset": 0.3, "width": 4.0, "height": 2.25, "sill": 0,
  "sashes": [{ "to": 0.2 }, { "from": 0.2, "to": 0.4 }, { "from": 0.4, "to": 0.6, "opening": true, "hinge": "left" },
             { "from": 0.6, "to": 0.8 }, { "from": 0.8 }] }
```

### Fransk balkong: `frenchBalcony`

Et rekkverk på fasaden foran en dør eller et vindu ned mot gulvet, uten balkonggulv. Det stopper figuren.

| Felt | Standard | Betydning |
|---|---|---|
| `frenchBalcony` | – | `true` eller `{ style, height, color }`. På en åpning (dør eller vindu) i en yttervegg. |
| `style` | `'glass'` | `'glass'` (glass i en smal ramme) eller `'bars'` (stålspiler, høyst 10 cm mellom dem). |
| `height` | 1,0 | Håndlistens topp over gulvet (0,8–1,3 m). |
| `color` | rammens farge | Rekkverkets farge. |

Rekkverket står 7 cm ut fra fasaden, 6 cm bredere enn hullet på hver side, med fester inn i veggen. Validatoren gir
feil når en dør til en fransk balkong slår ut, og varsler når brystningen er over 0,6 m eller veggen ikke er en
yttervegg.

```json
{ "id": "door-sov-balkong", "type": "door", "offset": 1.0, "width": 1.3, "height": 2.1, "sill": 0, "interactive": true,
  "connects": ["sov1", "ute"], "frenchBalcony": { "style": "glass" },
  "door": { "variant": "double", "hinge": "from", "swing": "in", "opensInto": "sov1", "glass": true } }
{ "id": "win-sov2", "type": "window", "offset": 0.9, "width": 1.6, "height": 2.1, "sill": 0, "frenchBalcony": { "style": "bars" },
  "sashes": [{ "to": 0.5, "opening": true, "hinge": "left" }, { "from": 0.5, "opening": true, "hinge": "right" }] }
```

### Hva byggeren gjør (fasadetypene)

- `src/home/windowshape.js` (ny, uten three.js) lager omrisset (`windowOutline`). `layout.js` gir et formet vindu
  `outline` (i vinduets ramme) etter at veggene under et tak har fått toppen sin, og `corner` sendes videre.
- `wallkit.js`: `buildWindow` bygger formede vinduer langs omrisset og hjørnevinduer med rammen inn til hjørneposten.
  `wallLayer` tar hull med `pts` og hjørnekutt (`corner`). Et lag med slike hull trianguleres med gjæringen på plass,
  hver endeflate for seg. Det gamle laget flyttet endene etterpå, og da brettet de tynne trekantene fra veggenden mot et
  rundt hull seg over hverandre. Lag uten formede hull bygges som før.
- `rooms.js`: hullene etter omrisset, hjørnekuttet, foringen, fransk balkong (`src/home/frenchbalcony.js`, ny) med
  kollisjon. `cladding.js`: omramming langs omrisset, rundt hjørnevinduet og hjørnekassen delt rundt det.
- Testen sjekker blant annet at stråler gjennom glasset går ut og stråler ved siden av formen treffer veggen, at hjørnet
  er åpent bare mellom brystning og topp, at figuren stoppes av rekkverket (og går ut uten det), og at ingen to flater
  med samme retning overlapper i samme plan.

Ikke med:

- Et formet vindu er alltid fast, og et hjørnevindu har alltid hjørnepost (ikke glass mot glass uten post).
- `lighting.js` (lyset i eierens spill) regner et formet vindu som boksen rundt det.
- Et formet vindu i en innervegg med baksideflate (`backOf`) får et rektangulært hull i baksideflaten.

## Eksempler

```json
{ "id": "win-x-1", "type": "window", "offset": 0.5, "width": 1.2, "height": 1.2, "sill": 0.9 }
```
Fast og uten inndeling, som planbyggerens vinduer i dag.

```json
{ "id": "win-x-2", "type": "window", "offset": 0.5, "width": 1.2, "height": 1.2, "sill": 0.9,
  "sashes": [{ "opening": true }] }
```
Topphengslet, som eierens.

```json
"sashes": [{ "from": 0, "to": 0.5, "opening": true, "hinge": "left" },
           { "from": 0.5, "to": 1, "opening": true, "hinge": "right" }]
```
Todelt og sidehengslet, med hengslene ytterst.

```json
"sashes": [{ "from": 0, "to": 0.3333 }, { "from": 0.3333, "to": 0.6667, "opening": true }, { "from": 0.6667, "to": 1 }]
```
Tredelt: fast, så åpningsbart (topphengslet), så fast.

```json
"sashes": [{ "top": 0.7, "opening": true, "hinge": "left" }, { "bottom": 0.7 }]
```
Med fast overlys øverst (30 % av høyden).

```json
"sashes": [{ "from": 0, "to": 0.5, "top": 0.72, "opening": true, "hinge": "left" },
           { "from": 0.5, "to": 1, "top": 0.72, "opening": true, "hinge": "right" },
           { "bottom": 0.72 }]
```
Todelt med overlys over begge feltene.

```json
"panes": [2, 3], "sashes": [{ "opening": true }]
```
Sprosser: 2 × 3 ruter.

```json
"width": 0.45, "height": 1.8, "sill": 0.5, "panes": [2, 6], "bars": { "width": 0.02 }
```
Smalt og veldig oppdelt (F26).

```json
"sashes": [{ "from": 0, "to": 0.3, "panes": [2, 3] }, { "from": 0.3, "to": 0.7, "opening": true, "panes": [3, 3] },
           { "from": 0.7, "to": 1, "panes": [2, 3] }]
```
Tredelt med egne ruter i hvert felt.

```json
"frame": { "color": "#f2f0eb" }, "panes": [3, 4]
```
Hvit karm med hvite sprosser.

```json
"panes": [3, 3], "bars": { "color": "#f2f0eb", "width": 0.03 }
```
Svart karm med hvite sprosser.

```json
"sill": 0, "height": 2.3, "sashes": [{ "from": 0, "to": 0.5 }, { "from": 0.5, "to": 1, "opening": true, "hinge": "right" }]
```
Helt ned til gulvet og todelt. Gulvet går ut til karmen uten noe ekstra felt.

```json
"sashes": [{ "from": 0, "to": 0.5, "top": 0.5 }, { "from": 0.5, "to": 1, "top": 0.5 },
           { "from": 0, "to": 0.5, "bottom": 0.5, "opening": true, "hinge": "left" },
           { "from": 0.5, "to": 1, "bottom": 0.5, "opening": true, "hinge": "right" }]
```
Fire felt (2 × 2), de to øverste åpningsbare.

## Takvinduer

Takvinduene står på takets oppføring i `ceilings[]`, som planbyggeren alt skriver:

| Felt | Standard | Betydning |
|---|---|---|
| `id` | – | Unik blant takvinduene. |
| `polygon` | – | Rektangel med 4 hjørner `[[x, z], …]` inne i takets polygon. Kanten fra hjørne 0 til 1 er vinduets bredde. |
| `depth` | `0.3` | Sjaktens dybde fra himlingen opp til karmen (0,05–2). |
| `opening` | `false` | Åpningsbart (ramme og håndtak på den første kanten) i stedet for fast. |
| `frame` | `{ color: '#25272b', width: 0.06, depth: 0.06 }` | Som på vinduer. |
| `sashes`, `panes`, `bars` | som på vinduer | Inndelingen av vinduet, sett nedenfra (bredde = kant 0, høyde = kant 1). |

```json
{ "id": "c-stue", "roomId": "stue", "polygon": [[0, 0], [6, 0], [6, 4], [0, 4]], "height": 2.4,
  "skylights": [
    { "id": "sk-stue-1", "polygon": [[2, 1], [2.78, 1], [2.78, 2.18], [2, 2.18]] },
    { "id": "sk-stue-2", "polygon": [[4, 1], [5.14, 1], [5.14, 2.18], [4, 2.18]], "depth": 0.45, "opening": true, "panes": [1, 2] }
  ] }
```

Byggeren skjærer hullet ut av himlingen. Sjakta er foret i takets maling, med en leppe på 12 mm under himlingen, og
følger maling som byttes i spillet. Vinduet ligger flatt øverst, med glasset ned mot rommet. Alt hører til taket
(`pickables.ceilings`), så det skjules sammen med himlingen i dukkehuset. Ingen av delene har kollisjon. Validatoren
krever et rektangel inne i taket og unike id-er, og varsler når et rom i etasjen over ligger over takvinduet. Det er
laget for flate himlinger: på en skrå himling ligger vinduet ved det høyeste hjørnet.

Ikke med: `lighting.js` (lyset i eierens spill) regner ikke med takvinduer. Lyset kommer bare med sola og himmelen der
huset vises, som i planbyggeren.

## Fra fasaden til formatet (for planbyggerens fasade-runde)

Per vindu på fasaden, koblet til vinduet på planen:

1. **Ytterkanten av rammen** gir `width` (bekreft mot planen), `height` og `sill` (avstanden fra gulvlinja). Når
   underkanten står på gulvlinja, er `sill` 0 og det er ingen `sillBoard`.
2. **Loddrette poster** gir grensene `from` og `to` (posisjonen delt på bredden), og **vannrette losholt** gir `bottom`
   og `top` (høyden over underkanten delt på høyden). Hvert felt mellom dem er ett element i `sashes`.
3. **Åpningssymbolet** (strek-trekanten i feltet) gir `opening: true`. Vanlig tegnemåte er at spissen peker mot
   hengslene (sjekk det mot en tegning der du vet svaret), så spissen oppe gir `hinge: 'top'`, spissen til venstre gir
   `'left'` og så videre. Fasaden er sett utenfra, så venstre og høyre må byttes til slik det ser ut fra rommet. Uten
   noe symbol er feltet fast.
4. **Sprossene** telles per felt: `panes: [kolonner, rader]` = antall ruter. Er de like i alle feltene, holder én
   `panes` på vinduet.
5. **En skrå overkant** langs taket gir `topSlope: 'follow-roof'`, med `height` målt til den høye enden. Er den skrå
   uten å følge taket, er `topSlope` vinkelen i grader, med fortegnet sett fra rommet (motsatt av fasaden).
6. Det som er gjettet, føres i `estimated` (for eksempel `["sashes", "panes"]`), så validatoren bare advarer.
7. **Et vindu som ikke er et rektangel** gir `shape`. Under mønet i en gavl, med loddrette sider og skråkanter langs
   taket: `'gable'` med `height` til toppen (skråkantene kommer fra taket). Uten tak i huset: `shoulder` (sidenes
   høyde). En ren trekant: `'triangle'`, et koøye: `'round'`, alt annet konvekst: `'polygon'` med `points`.
8. **To vinduer som møtes i et hjørne** uten vegg mellom seg (fasaden viser glass på begge sider av hjørnet) får
   `corner`: `'to'` på vinduet ved veggens `to`-ende og `'from'` på vinduet på neste vegg. Hullene skal gå helt til
   hjørnet på romsiden, med samme `sill` og `height`.
9. **Et rekkverk rett foran en dør eller et vindu ned til gulvet** i en etasje over bakken, uten balkonggulv, gir
   `frenchBalcony` (`style: 'glass'` eller `'bars'` etter tegningen). Døra skal slå inn.
10. **Glassvegg:** ett vindu med `sill: 0` og `sashes` per felt. Står det en dør i glassveggen, er det en dør med
   sidefelt (`door.sidelights`, flere på samme side), se `notes/dortyper.md`.

Det planbyggeren kan fjerne når dette er flettet inn (forespørsel 8, 14 og 15):

- **`revealFloors` for vinduer** (`viewer.js`): `rooms.js` bygger nå gulvet ut til karmen. Lar dere stripa stå, ligger
  to gulv i samme plan, og det flimrer. Stripene for passasjer (`type: 'opening'`) er fortsatt deres.
- **Plassholderen for takvinduer** (det lyse feltet i `viewer.js`): den dekker nå det ekte takvinduet.
- **`separateCoplanar`:** vindusrammene trenger det ikke lenger. Den mørke foringen i ytterdører (forespørsel 14, andre
  del) og de andre rollene er ikke rørt her, siden dørene hører til dørøkta.

## Eierens hus

Eierens hus er bygget likt som før, med to unntak. Karmen er 1,25 mm smalere på hver side og i toppen, og gummilista i
de faste vinduene står 1 mm dypere. Sjekket slik:

- Med et fingeravtrykk av alle 14 vinduene, gulvene, takene og de andre meshene i `rooms.js`, og vinduene i stua gjennom
  `wallkit`, før og etter: glass, håndtak, karmplater, vannbrett, gulv og tak er identiske, og karmen har flyttet seg
  høyst 1,25 mm.
- I sandkassa (`dev/sandbox.html`, dag 21. juni kl. 13) med 8 bilder før og etter: stua, kjøkkenet, soverommet,
  badet, kjellerstua, soverommet i kjelleren, entreen i kjelleren og sørfasaden. 0,02–0,15 % av pikslene endret seg,
  bare langs karmkanten og i byggetida nede til venstre. Lyset gjennom vinduene er uendret, fordi `lighting.js` bare
  leser hullene.
