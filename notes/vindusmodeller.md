# Vindusmodeller i husformatet

Vinduene i husformatet kan nå være inndelt (todelt, tredelt, overlys, rutenett av felt), ha sprosser, og hvert felt kan
være fast eller åpningsbart med hengslene oppe, nede, til venstre eller til høyre. Takvinduer (`ceilings[].skylights`)
bygges med hull i himlingen, en foret sjakt og et ekte vindu. Alt er valgfrie felt: et vindu uten dem bygges som før.

Byggeren er `buildWindow` i `src/home/wallkit.js` (brukt av `rooms.js` og `shell.js`). `rooms.js` bygger gulvet ut til
karmen og takvinduene, `layout.js` sender feltene videre, og `validateHouse` i `src/data/scripts/house.mjs` sjekker dem
(`windowModelIssues(o)` er eksportert, så planbyggeren kan sjekke ett vindu for seg).

**Se dem:** `dev/vinduer.html` (testhuset i `src/dev/vinduer-hus.js`: 20 vinduer og 2 takvinduer, med knapper for
visningene). **Test:** `node tools/house-tests/vinduer.test.mjs` (også med i `node tools/test-house.mjs`).

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
