# Tak og skrå himling i husformatet

Husformatet har nå tak: saltak, valmtak, pulttak og flatt tak, med ark (takopplett) på takflaten, takstein, skifer,
papp eller stålplater, vindskier, vannbord, takrenner og mønepanne. Himlinger kan følge taket (skrå himling,
hanebjelkeloft), og vegger under taket får toppen fra himlingen, så knevegger og gavler kommer av seg selv.
Takvinduer (`ceilings[].skylights`) under et tak ligger i takflaten. Ytterkledningen går opp under husets eget tak.

Alt er valgfrie felt. Et hus uten `roofs` bygges som før. Eierens hus har ingen `roofs`, og det ser ut nøyaktig som før,
også lyset. Det er kontrollert med skjermbilder av spillet før og etter (stua, høyveggen, gangen, kjelleren, inngangen og
terrassen: 0 piksler endret) og med `node tools/house-tests/owner-fingerprint.mjs`, som tar et fingeravtrykk av all
geometrien til eierens rom (`layout 9fd8f7a355b0f410`, `rooms a7cf211c026c6559`, likt før og etter).

**Kode:** modellen er `src/home/roofgeom.js` (uten three.js; brukes av `layout.js`, byggeren og validatoren), byggeren
`src/home/roof.js` (kalles fra `rooms.js`), tekkingene `roofCovering` og `roofFinish` i `src/world/surfaces.js`.
`layout.js` gir `layout.house.roofs` og `layout.house.roofFieldOf(levelId)`, og himlinger under tak får `surface`.
**Se dem:** `dev/tak.html` (seks testhus i `src/dev/tak-hus.js`, med knapper for visningene ute og inne og «Tak» for
dukkehusvisningen). **Test:** `node tools/house-tests/tak.test.mjs` (også med i `node tools/test-house.mjs`).

## Taket: `roofs[]`

`roofs` er en ny toppnøkkel, en liste med takdeler. Hver del er et rektangel i plan med ett tak over. Et hus med L-
eller T-form får én del per fløy, hver med `outline` på sin egen fløy. En del som står med en hel side mot en annen
del på samme etasje (sidefløyen), går inn under den andre til midten av den. Der to deler overlapper, gjelder den
høyeste, så fløyene møtes i kilrenner av seg selv (testhus F). Hovedhuset beholder takfoten langs sidefløyen.

| Felt | Standard | Betydning |
|---|---|---|
| `id` | `roof-<n>` | Unik id. |
| `name` | `''` | Navn (vises bare på testsiden). |
| `type` | `'gable'` | `'gable'` (saltak), `'hip'` (valmtak), `'mono-pitch'` (pulttak) eller `'flat'`. Planbyggerens `doc.roof` bruker de samme navnene; `'gable-dormer'` er `'gable'` med `dormers`, og `'mixed'` er flere deler. |
| `levelId` | øverste etasje | Etasjen taket ligger over. Himlingene og veggene i den etasjen følger det. |
| `outline` | rektangelet rundt utsiden av etasjens yttervegger | Fire hjørner `[[x, z], …]`: yttersiden av veggene taket dekker (uten utstikk). |
| `pitch` | gable 35, hip 30, mono-pitch 10, flat 0 | Takvinkel i grader (0–70). |
| `pitchEnds` | `pitch` | Valmtak: vinkelen på valmene (endene). |
| `ridge` | langs den lengste siden | Saltak og valm: mønets retning `[dx, dz]`. |
| `fall` | se under | Pulttak: retningen taket faller mot `[dx, dz]`. Uten `fall` er den høye siden den lengste kanten med lavest nummer i `outline`. |
| `ridgeHeight` | – | Mønehøyden: toppen av tekkingen på mønet (pulttak: den høye kanten) over etasjens gulv. |
| `kneeHeight` | – | Kneveggshøyden: der undersiden av taket møter innsiden av ytterveggen på langsiden, over etasjens gulv. |
| `eaveHeight` | høyeste yttervegg i etasjen | Undersiden av taket i ytterkant av veggen på langsiden (raftet), over etasjens gulv. |
| `overhang` | 0,5 (flatt tak 0,3) | Utstikk ved takfoten (langsidene; valm og flatt tak: alle sider). |
| `vergeOverhang` | 0,3 | Utstikk ved gavlene (pulttak: også den høye siden). |
| `thickness` | 0,3 | Takets oppbygning (sperrer, lekter og tekking) målt vinkelrett på takflaten. |
| `covering` | gable og hip `'tile'`, mono-pitch `'steel'`, flat `'felt'` | `'tile'` (takstein), `'slate'` (skifer), `'felt'` (papp), `'steel'` (stålplater). |
| `color` | tile `#3a3634`, slate `#3c4046`, felt `#2b2b2d`, steel `#30343a` | Tekkingens middelfarge. |
| `trimColor` | `#2f2f31` | Vindskier, vannbord og takrenner. |
| `soffitColor` | `trimColor` | Undersiden av utstikket. |
| `gutters` | `true` når `pitch` ≥ 5 | Takrenner langs takfoten. |
| `ridgeCap` | `true` unntatt på papp | Mønepanne langs mønet og gratene. |
| `wallThickness` | median av etasjens yttervegger | Veggtykkelsen `kneeHeight` måles fra. |
| `dormers` | `[]` | Arker og takoppletter, se under. |

Bare én av `ridgeHeight`, `kneeHeight` og `eaveHeight` trengs. Gis flere, gjelder den første i den rekkefølgen (og
validatoren varsler). Alle høyder er lokale, over gulvet i etasjen `levelId`, som ellers i husformatet.

**Hvordan taket er bygd:** hvert plan i modellen er **undersiden** av taket, altså himlingen i rommene under. Tekkingen
ligger `thickness / cos(pitch)` høyere. Et tak er det laveste av planene sine (saltak 2, valm 4, pulttak og flatt 1).

### Ark og takopplett: `dormers[]`

| Felt | Standard | Betydning |
|---|---|---|
| `id` | `<tak>-ark-<n>` | Unik id. |
| `type` | `'gable'` | `'gable'` (ark med saltak og egen gavl) eller `'shed'` (pulttak, slakere enn taket). |
| `front` | – | To punkter `[[x, z], [x, z]]`: forkanten, yttersiden av fronten. Ligger den på husets yttervegg, er det en **ark**: veggen under går opp og blir arkens gavl, og vinduet står i veggen (`walls[].openings`). Ligger den lenger opp på taket, er det en **takopplett** med egen forvegg. |
| `height` | 2,2 | Høyden på arkens takfot foran, på undersiden, over etasjens gulv. |
| `pitch` | gable: takets vinkel; shed: 12 | Arkens takvinkel. |
| `overhang` | 0,25 | Arkens utstikk foran og på sidene. |
| `frontThickness` | 0,15 | Takopplett: forveggens tykkelse. |
| `window` | – | Takopplett: vinduet i forveggen, `{ width, height, sill?, frame?, sashes?, panes?, bars? }` (som et vindu, notes/vindusmodeller.md). Uten `sill` står det 15 cm under taket. |

Arken går fra fronten og inn til den møter taket (kilrennen). Forkanten bør stå parallelt med takfoten (den rettes inn).

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
- **Flere takdeler:** hver del kuttes der en annen del på samme etasje er høyere (også takrenner og mønepanner), og
  himlingen får en loddrett flate der den går fra en lavere del inn under en høyere.
- **Dukkehus:** alt i taket (tekking, underside, vindskier, renner, mønepanne, arkenes sider og forvegger) ligger i
  `pickables.ceilings` uten `pick` og uten kollisjon, og skjules sammen med himlingene. Det ligger i etasjens
  `roots.levels[levelId]`, så det skjules også med etasjen.
- **Navn:** `roof:<id>` (tekking), `roof-soffit:<id>`, `roof-trim:<id>`, `roof-ridge:<id>`, `roof-gutter:<id>`,
  `roof-cheeks:<id>`, `roof-front:<ark>`, `roof-front-inside:<ark>` (malingen til himlingen under), `roof-window:<ark>`.
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

`roofs` er lagt til i `schema.topLevel` i `research/house/00-ids.json`.

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
