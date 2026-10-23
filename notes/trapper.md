# Trappetyper i husformatet

2026-10-22. Rett trapp som virker uten omvei, kvartsvingt trapp (L) med svingtrinn eller repos, bratt trapp (trappestige),
tette opptrinn, flere rekkverk og stolper som slutter ved gulvet. Planbyggerens forespørsel 6, 9, 16 og 17, og eierens
F7, F12, F21, F41, F42, F82 og K8. Alt nytt er valgfrie felt i en `stairs`-oppføring. Eierens trapp
(`research/house/20-trapp.json`, `half-turn-winder`) bruker ingen av dem og bygges i den gamle koden, bit for bit som før.

**Kode**
- `src/home/stairtypes.js` (ny, ren, uten three.js): planen for de nye typene. Ganglinja, hvilken side som er inner og
  ytter, fotavtrykket, antall opptrinn (2R + G ≈ 0,62), plasseringen av nesene og rampa. Byggeren, `layout.js` og
  validatoren bruker samme fil, så de er enige om tallene.
- `src/home/stairs.js` (byggeren): de nye typene går gjennom `stairPlan`. Den halvsvingte trappa bruker den gamle koden
  (`walkLine`, `chains`, inntrinnene og rekkverket rundt øyet). Nytt for alle typer: tette opptrinn, rekkverk langs løpet
  og `guardStyle`-valgene.
- `src/home/layout.js`: en L-trapp uten eget `footprint` får L-en, ikke hullet. `risers` kan mangle, og `surfaceY`
  følger rampa, også over et repos.
- `src/data/scripts/house.mjs` `validateHouse`: de nye typene, `risers` valgfritt, egne normer for bratt trapp, og
  advarsel eller feil når trappa er brattere enn figuren går.
- `src/core/Collision.js`: *klatreflater* (`climbs`). Den bratte trappa er for bratt for kollisjonskilen, så figuren går
  på en analytisk flate i stedet, som på terrenget. Den slår bare inn for en kolliderer med `userData.climb`.
- `research/house/00-ids.json`: skjemaet tar typene `steep` og `quarter-turn-landing`, og `risers` er ikke lenger påkrevd.

**Test:** `node tools/house-tests/stairtypes.test.mjs` (60 sjekker, ca. 1 min), eller `node tools/test-house.mjs`.
Testen sjekker at eierens trapp er uendret mot `tools/house-tests/fixtures/stair-owner.json` (lages med
`node tools/house-tests/stair-owner-snapshot.mjs --write`). Den sjekker også validatoren og geometrien, at ingen flater
ligger i samme plan, og gangtesten: opp og ned alle typene ved 30, 60 og 144 Hz, og løp og huk ved 60 Hz.

**Testside:** `/tools/trapper/index.html` på testserveren (`.claude/launch.json` «trapper-test», port 5275). Testhuset
(`tools/trapper/testhus.mjs`) har en kjeller og en hovedetasje, og fem trapper med hver sin rekkverksstil. Du kan gå
fritt (WASD og mus), og knappene «Ned» og «Opp» går hver trapp med spillets figur. Kameraknappene viser trappa fra
foten, toppen, siden og ovenfra.

---

## Felles felt

Koordinatene er planpunkter `[x, z]`, og høydene kommer fra etasjene (`fromLevel` og `toLevel`).

| felt | standard | betydning |
|---|---|---|
| `type` | – | `'straight'`, `'steep'`, `'quarter-turn-winder'`, `'quarter-turn-landing'` eller `'half-turn-winder'` |
| `risers` | beregnet | antall opptrinn. Uten dette feltet gir 2R + G nærmest 0,62 med R ≤ 0,22 (bratt: R ≤ 0,25) og G ≥ 0,10. Den halvsvingte trappa må fortsatt ha `risers`. |
| `top.edge`, `top.down` | – | øverste neselinje (gulvkanten i etasjen over), og retningen ned løpet |
| `foot.edge`, `foot.down` | – | nederste neselinje, og retningen ned (ut på gulvet) |
| `top.straightTreads`, `foot.straightTreads` | beregnet | antall rette trinn øverst og nederst (svingtrinn) eller i hvert løp (repos) |
| `footprint` | se typene | trappas omriss i planen (kanten for vanger og håndlist, og flata figuren går på) |
| `tread` | `{ thickness: 0.04, nosing: 0.03, batten: { h: 0.04, inset: 0.025, depth: 0.045 }, color: '#ada396' }` | trinnene. `batten: false` fjerner lista under nesa. |
| `openRisers` | `true` | `false` gir **tette opptrinn** (F7) |
| `riser` | `{ thickness: 0.018, color: trinnets eik }` | opptrinnsbrettene ved `openRisers: false`, for eksempel `color: '#f2efe8'` (hvite) |
| `stringers` | `{ color: '#1d1e21', thickness: 0.05, depth: 0.28, footCut }` | vangene. `footCut` er nesa + 0,015 for de nye typene (som før: nesa). |
| `guards`, `guardStyle` | se *Rekkverk* | |
| `handrails` | `[]` | se *Håndlist* |

Hvilken side er hvilken: **inner** er innsiden av svingen, **outer** er yttersiden (veggene). For en rett trapp er
inner den venstre siden **sett oppover** trappa. `'left'` og `'right'` betyr alltid sett oppover, for alle typer.

---

## 1. Rett trapp – `type: 'straight'`

Ett løp fra `top.edge` til `foot.edge`, langs `top.down`. Kantene kan listes i hvilken som helst rekkefølge.
Fotavtrykket kan være hullet (rektangelet). Omveien `straightStairFix` i planbyggerens `viewer.js` trengs ikke lenger
(forespørsel 6). Inntrinnene er like: ganglinja / (risers − 1).

```json
{ "id": "trapp-1", "type": "straight", "fromLevel": "kjeller", "toLevel": "hoved", "openingId": "trappehull-1",
  "roomIds": ["kjeller", "stue"],
  "top":  { "edge": [[1.0, 1.0], [1.9, 1.0]], "down": [0, 1] },
  "foot": { "edge": [[1.0, 4.24], [1.9, 4.24]], "down": [0, 1] },
  "guards": [ { "id": "rekk-1-1", "level": "hoved", "line": [[1.0, 4.3], [1.0, 1.0]] }, { "id": "rekk-1-v", "on": "left" } ],
  "guardStyle": { "hang": 0 } }
```
Med 2,6 m etasjehøyde og 3,24 m ganglinje gir dette 14 opptrinn à 0,186 og inntrinn 0,249 (2R + G = 0,621).

## 2. Kvartsvingt trapp med svingtrinn – `type: 'quarter-turn-winder'`

To løp i vinkel (en L). `foot.down` står vinkelrett på `top.down`. Svingretningen følger av geometrien: `foot.down` til
høyre for `top.down` sett nedover er en høyresving. Løpene kan ha ulik lengde. Hjørnet (den indre stolpen) er der den
indre siden av øvre løp (gjennom `top.edge`) møter den indre siden av nedre løp (gjennom `foot.edge`).

- **Ganglinja** går midt i løpene, og i hjørnet som en kvartsirkel rundt det indre hjørnet, fra halve bredden av øvre
  løp til halve bredden av nedre (som V13 for den halvsvingte).
- **Inntrinnene** er like på ganglinja. Nesene innenfor ett inntrinn fra svingen er **balanserte svingtrinn**: de
  fordeles jevnt langs den indre vangen mellom de siste rette trinnene, så ingen blir spisse. Testhuset gir 6 svingtrinn,
  og det smaleste har 13 cm ved den indre vangen.
- **Fotavtrykket** er L-en fra kantene, hvis `footprint` mangler. Det nedre løpet kan gå videre **under gulvet** i
  etasjen over (hus8). Hullet trenger ikke dekke det, men validatoren sjekker den frie høyden der.
- Det indre hjørnet får en kollisjonskloss (som øyet i U-trappa), fordi svingtrinnene er bratte helt inne ved stolpen.

```json
{ "id": "trapp-2", "type": "quarter-turn-winder", "risers": 14,
  "top":  { "edge": [[7.0, 1.0], [7.9, 1.0]], "down": [0, 1] },
  "foot": { "edge": [[8.95, 2.5], [8.95, 3.4]], "down": [1, 0] },
  "guards": [ { "id": "rekk-2-inn", "on": "inner" }, { "id": "rekk-2-ut", "on": "outer" } ],
  "guardStyle": { "infill": "bars", "hang": 0 } }
```
Her er det indre hjørnet (7,9; 2,5) og det ytre (7,0; 3,4). Trappa svinger til venstre sett nedover.

## 3. Kvartsvingt trapp med repos – `type: 'quarter-turn-landing'`

Som L-trappa, men hjørnet er et kvadratisk **repos** (ett trinn, flatt). Hvert løp fylles av sine trinn:
`foot.straightTreads` nederst og `top.straightTreads` øverst. Uten de feltene fordeles risers − 2 etter løpenes lengde.
Reposet er trinn nr. `foot.straightTreads + 1`. Validatoren regner inntrinnet bare på løpene, og rampa figuren går på er
flat over reposet.

```json
{ "id": "trapp-3", "type": "quarter-turn-landing", "risers": 14,
  "top":  { "edge": [[12.0, 1.0], [12.9, 1.0]], "down": [0, 1] },
  "foot": { "edge": [[10.5, 2.5], [10.5, 3.4]], "down": [-1, 0] },
  "guards": [ { "id": "rekk-3-inn", "on": "inner" } ],
  "guardStyle": { "infill": "rods", "hang": 0 } }
```

## 4. Bratt trapp – `type: 'steep'`

En rett trapp for små sjakter (trappestige eller loftstige, F82). Den er brattere enn figuren kan gå på en kile
(48°), så den **klatres**: kollisjonen er en analytisk flate (`Collision.climbs`) langs rampa. Ved toppkanten løftes
flata slik at kapselen (radius 0,3) kommer over gulvkanten, og der føles det som et trinn. Klatringen opp går med
farten i den bratteste bakken figuren går (ca. 0,55 × gangfarten vannrett).

- **Normer** (validatoren): opptrinn ≤ 0,25, inntrinn ≥ 0,10 og **rampa ≤ 68°** (rampa er linja fra toppkanten til
  gulvet ved nederste nese, ca. 2° brattere enn trappa, så trappa blir høyst ca. 66°). Brudd gir feil (advarsel når
  målene er anslått). Under 45° gir advarsel, for da passer en vanlig trapp. 2R + G og minste inntrinn 0,22 gjelder ikke.
- Målt ved 30, 60 og 144 Hz går og løper figuren opp og ned uten å miste bakken opp til en rampe på 68°. Ved 70°
  mister den bakken ved foten på vei ned: flata som er løftet ved toppen, når ikke ned til rampa før foten.
- Ved toppen ligger klatreflata over trinnene: høyst 0,43 m over ved 57° (testhuset) og 0,62 m ved 66°, i den
  øverste halvmeteren. Kameraet glattes som ved et trinn.
- Hullet må gå så langt forbi foten at hodet kommer under kanten. Validatoren sjekker det (fri høyde).

```json
{ "id": "trapp-4", "type": "steep",
  "top":  { "edge": [[15.0, 1.0], [15.7, 1.0]], "down": [0, 1] },
  "foot": { "edge": [[15.0, 2.5], [15.7, 2.5]], "down": [0, 1] },
  "tread": { "nosing": 0.02 },
  "guards": [ { "id": "rekk-4-v", "on": "left" }, { "id": "rekk-4-h", "on": "right" } ] }
```
I et hull på 0,7 × 1,55 m og med 2,6 m etasjehøyde gir dette 11 opptrinn à 0,236 og inntrinn 0,15 (57,6°).

## 5. Halvsvingt trapp – `type: 'half-turn-winder'`

Uendret (eierens trapp, `well`, `{ on: 'well' }`). `guardStyle`-valgene nedenfor (`hang`, `infill`, `mount`, `posts`)
virker også her. Uten dem blir rekkverket nøyaktig som før.

---

## Rekkverk

**På gulvet rundt hullet:** `{ id, level, line: [[x, z], [x, z]] }` på hullets kant, som før. Det står på gulvet, en
halv stolpe inn fra kanten. Ta med alle frie kanter unntatt toppkanten.

**Langs løpet:** `{ id, on }` med `on` = `'inner'`, `'outer'`, `'left'` eller `'right'` (`'well'` = inner). Det trengs
der løpets side er åpen ned mot etasjen under. Rekkverket står midt på vangen, med håndlista `stairHeight` over neselinja.
Ved foten er håndlista minst `height − 0,05` over gulvet. Det har stolper ved foten (fra gulvet), i hvert hjørne (den
indre stolpen i en L, fra gulvet under) og ved toppkanten (opp til `height` over gulvet).
**Når et rekkverk på gulvet går langs samme side** over det øverste løpet, stopper rekkverket på trappa under
etasjeskillet: håndlista ligger vannrett 3,5 cm under det, og rekkverket slutter der vangen møter det. Da står det
ikke to rekkverk oppå hverandre.

`guardStyle`:

| felt | standard | betydning |
|---|---|---|
| `height`, `stairHeight` | 1.0, 0.9 | høyden over gulvet / over neselinja |
| `post`, `baluster`, `spacing` | 0.065, 0.022, 0.13 | stolpe, spile, avstand mellom spilene |
| `topRail` | `[0.07, 0.05]` | håndlista på gulvrekkverket [bredde, høyde]; `false` = ingen |
| `infill` | `'balusters'` | `'balusters'` (stående spiler), `'bars'` (liggende spiler), `'rods'` (stag) eller `'glass'` |
| `bars` | `{ spacing: 0.11, size: [0.04, 0.012] }` (`rods`: `{ spacing: 0.10, size: [0.012, 0.012] }`) | [høyde, bredde] og avstand. Langs løpet følger de håndlista. |
| `glass` | `{ thickness: 0.01, color: '#cfe3e0', opacity: 0.28 }` | glassplatene |
| `hang` | 0.45 (`mount: 'edge'`: 0.2) | hvor langt stolpene over trappa henger ned under gulvet. **0 = de slutter ved gulvet** (F12, F21, F42). |
| `mount` | `'floor'` | `'edge'` = **på kanten av etasjeskillet**: stolpene (eller glasset) står 3 mm utenfor hullkanten og henger ned langs den, uten list på gulvet |
| `posts` | `true` | `false` = glass uten stolper (bare med `infill: 'glass'`). Håndlista går som én list rundt hjørnene. |
| `color` | `'#1d1e21'` | (vangenes `stringers.color` farger alt stålet, som før) |

**Kollisjon:** rekkverket på gulvet er bokser fra gulvet til `height` (som før). Rekkverket langs løpet er bokser langs
vangen, til 0,95 over rampa.

## Håndlist på vegg

`handrails: [{ side, walls?, start?, startHeight?, height: 0.9, profile: [0.05, 0.04], offset: 0.05, color, led? }]`.
`side` er `'outer'` (standard), `'inner'`, `'left'` eller `'right'`. Lista følger den siden, 0,05 + halve profilen inn
fra veggen. For de nye typene går den langs alle veggene på den siden når `walls` mangler. Kompassnavnene
(`'nord'`, `'øst'` …) gjelder fortsatt. `start` og `startHeight` gir toppenden, og `led` gir lysstripe som før.

---

## Validatoren

Nye **feil** (advarsler når `top`, `foot`, `going`, `type` eller `risers` er anslått):
- `trappa er for bratt å gå i (… ° langs ganglinja, figuren går høyst 48°) – gjør den lengre, eller bruk type «steep»`
  (alle typer unntatt `steep`, målt på rampa, med reposet flatt);
- bratt trapp: `den bratte trappa er for bratt å klatre i spillet (… ° langs ganglinja, høyst 68°)`,
  `opptrinnet … er over 0,25`, `inntrinnet … er under 0,1`;
- repos: `et løp har ingen trinn`;
- `ukjent trappetype «…»`, og `risers må være et heltall ≥ 2` (når feltet er der, og alltid for `half-turn-winder`).

Ny **advarsel:** en bratt trapp under 45° (da passer en vanlig trapp).

Det som var før, gjelder fortsatt: opptrinn 0,15–0,22, 2R + G 0,60–0,64, inntrinn ≥ 0,22, fri høyde, dører og karmer.
En L-trapp får gå utenfor hullet (under gulvet), og den frie høyden sjekkes der. `report.stairs[]` har nå også `type`,
`walkDeg` og `risersComputed`.

## Til planbyggeren

- **Rett trapp:** behold formatet. `straightStairFix` i `viewer.js` kan fjernes, og `risers` kan utelates.
- **Kvartsvingt (hus1, hus8, hus9):** `type: 'quarter-turn-winder'`. `top.edge` og `top.down` som nå, og `foot.edge` er
  nederste neselinje på det andre løpet, med `foot.down` vinkelrett. Fotavtrykket utelates (L-en beregnes), eller du
  gir L-en selv. Hullet i etasjen over trenger bare dekke det som har for lite fri høyde under gulvet. Med repos:
  `'quarter-turn-landing'`. Omveien med U-trapp kan fjernes.
- **Bratt trapp eller stige (hus8, F82):** `type: 'steep'`.
- **Rekkverk:** som nå på hullkantene, pluss `{ on: 'left' | 'right' | 'inner' | 'outer' }` på sidene som er åpne ned
  mot etasjen under. `guardStyle.hang: 0` gir stolper som slutter ved gulvet (F12, F21, F42).
- **Tette opptrinn (F7):** `openRisers: false`, for eksempel med `riser: { color: '#f2efe8' }`.
- **hus8:** etter sjakten på 0,94 × 1,8 m ligger trappa bare ca. 1–1,3 m under gulvet, så et nedre løp under gulvet får
  ikke fri høyde. Da passer `steep`, slik eieren skriver i F82, eller et hull som dekker mer. Validatoren sier fra i begge
  tilfeller.

## Begrensninger

- Svingtrinnene i en L er alltid balanserte (`winders: 'balanced'`). Det finnes ikke radielle svingtrinn ennå.
- Den bratte trappa har vanlige trinn. Det finnes ikke runde stigetrinn.
- Ved toppen av den bratte trappa ligger klatreflata 0,4–0,6 m over trinnene i den øverste halvmeteren (se 4.).
- Bratt trapp over 68° rampe (ca. 66° trapp, en vanlig loftstige) kan ikke klatres i spillet ennå. Det krever en egen
  stigemodus i PlayerController.
- Rekkverket langs løpet har samme stil som rekkverket på gulvet (én `guardStyle` per trapp).
