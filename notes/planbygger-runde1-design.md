# Planbygger runde 1: design og kontrakter

Arbeidsdokument for runde 1, «Generer»-flyten. Det beskriver modulene og formatene mellom dem, så flere agenter kan
bygge samtidig uten å vente på hverandre. Selve brukerdokumentasjonen er fortsatt `notes/planbygger.md`.

## Målet

En lat husbygger slipper alle tegningene sine, plantegninger og fasader, og trykker «Generer». Planbyggeren:

1. ordner etasjene;
2. finner målestokken;
3. gjenkjenner rommene;
4. stiller bare de spørsmålene den ikke kan svare på selv, med ferdig utfylte svar;
5. åpner 3D-huset.

Editoren fra v1 blir «Finjuster».

**Prinsipp:** KI forstår, klassisk bildebehandling måler. KI leser tekst og tolker symboler og svarer med strukturert
JSON. Alle mål og koordinater kommer fra den klassiske gjenkjenningen. Uten KI (ingen nøkkel, feil, brukt opp kvote)
virker alt fortsatt, bare med flere spørsmål.

## Testsettet

`plantegninger/` har ti hus, se `plantegninger/README.md`. Node-testene leser PNG-kopiene i `plantegninger/_png/` når
originalen ikke er PNG. Fasiten ligger i `plantegninger/<hus>/fasit.json`, med formatet under.

## Felles typer

- **Bilde:** `{ width, height, data: Uint8ClampedArray }` i RGBA, slik `readPng` (`tools/planbygger-png.mjs`) og
  `ImageData` gir det. Alle moduler tar og gir slike bilder.
- **Piksler og meter:** gjenkjenningen jobber i piksler. Dokumentet (`model.js`) jobber i plan-meter = piksler / pxPerM.
- **Normaliserte koordinater** (0–1, fra øvre venstre hjørne) brukes bare i KI-svar, fordi modellen ser et nedskalert
  bilde.

## Fasit: `plantegninger/<hus>/fasit.json`

```json
{
  "house": "hus1",
  "files": {
    "1etg.png": { "kind": "plan", "level": 0 },
    "2etg.png": { "kind": "plan", "level": 1 },
    "fasade1.avif": { "kind": "facade" }
  },
  "levels": [
    {
      "level": 0, "name": "1. etasje", "file": "1etg.png",
      "title": null,
      "rooms": [ { "label": "SOV", "area": 14.8, "kind": "bedroom" } ],
      "doors": { "single": 5, "double": 2, "sliding": 1, "exterior": 2 },
      "windows": 12,
      "skylights": 0,
      "stair": { "type": "quarter-turn", "note": "fritt tekst" },
      "dimensions": [ { "text": "15.44", "m": 15.44, "what": "ytre mål, venstre side" } ],
      "scale": { "hints": ["areas"], "pxPerM": null, "note": "" },
      "ceiling": [ "SKRÅ HIMLING 24°" ],
      "notes": ""
    }
  ],
  "facades": [ { "file": "fasade1.avif", "roof": "gable-dormer", "storeys": 2, "windows": 6, "doors": 1 } ],
  "notes": ""
}
```

- `level`: −1 kjeller/underetasje, 0 hovedetasje (inngang), 1 etasjen over, osv.
- `kind` for rom: verdiene i `ROOM_KINDS` (`model.js`).
- `stair.type`: `straight`, `quarter-turn`, `half-turn`, `spiral` eller `none`.
- `roof`: `gable`, `gable-dormer`, `hip`, `mono-pitch`, `flat` eller `mixed`.

Felt som ikke kan leses av tegningen, settes til `null`.

## Moduler og grensesnitt

Alt nytt ligger i nye filer, med unntak av `detect.js`, `app.js` og `tools/planbygger-vite-plugin.mjs`. De har hver sin
eier.

### `src/planbygger/sheet.js` – flere tegninger på ett ark

`splitSheet(img) → { blocks: [{ bbox: [x0, y0, x1, y1], kind: 'plan'|'facade'|'section'|'text'|'other', score }] }`
og `cropImage(img, bbox, pad = 0) → img`.

Metoden er klassisk:
1. Blekket skaleres ned og dilateres, og komponentene blir blokker.
2. Blokkene klassifiseres på trekk: lukkede veggsløyfer gir plan, en lang bakkelinje nederst og takflater gir fasade,
   og bare tekst gir tekst.

Ett ark med én tegning gir én blokk. Testes på hus7 (plan, snitt og fire fasader), `hus8/plantegning-1` (tre planer) og
`hus1/hus3 fasader.png` (fire fasader i rad).

### `src/planbygger/photo.js` – mobilfoto av en utskrift

- `isPhoto(img) → { photo: bool, score }`: lys, metning og farge i kantene skiller et foto fra en digital tegning.
- `rectifyPhoto(img, { maxSide = 2400 }) → { img, quad: [[x, y] × 4] | null, applied }`:
  1. Finn arket, det største lyse firkantede området.
  2. Finn de fire hjørnene og lag en homografi til A-forhold (√2), så arket blir rett.
  3. Jevn ut lyset: del på bakgrunnen (stor uskarphet eller maks-filter) og normaliser til hvitt.

Testes på `hus3-foto` mot `hus3`.

### `src/planbygger/clean.js` – rydde før veggene

`cleanForWalls(img, { pxPerM }) → img`:
- **Fargede påskrifter** (mettet blå eller rød, som forklaringene på hus6) blir papir.
- **Fargede gulvflater** som er lysere enn veggtonen, blir papir.

Skravur og teksturer (hus4 og hus9) undersøkes. Fjern dem bare hvis det beviselig hjelper på målingene. `detectPlan` får
valget `clean: true`, med standard på.

### `src/planbygger/detect.js` – forbedringer (én eier)

- **Dører med `variant`:** `'single' | 'double' | 'sliding'`.
  - Dobbeltdør: to buer fra hver sin karm, hver med radius ≈ halve åpningen.
  - Skyvedør: åpning med forskjøvne parallelle tynne linjer og gjerne en pil.
- **Takvinduer:** `skylights: [{ x0, y0, x1, y1 }]`, stiplede rektangler inne i rom. De skal ikke bli vegger.
- **Trapper:** `stairs: [{ bbox, axis, treads, kind: 'straight'|'quarter-turn'|'half-turn'|'unknown' }]`, områder med
  jevnt fordelte parallelle tynne linjer. Svingtrinn er linjer som går ut fra et punkt.
- **Ikke vegger:** stiplede linjer (takkant, «Plan himling»), fliser og rutenett utenfor huset, gulvskravur.
- **Rom som slås sammen:** finn årsaken til at hall og bod på hus1 1. etasje blir ett rom, og rett den.
- **Husformatet:** sjekk hva det støtter (dobbeltdør, skyvedør, takvindu) i `src/data/scripts/house.mjs` og
  dørbyggerne. Det som ikke støttes, eksporteres som det nærmeste (åpning eller dør), og blir en forespørsel i notatene.

### `src/planbygger/autoscale.js` – målestokken i lag

`estimateScale(input) → result`. Input:
`{ img, det0, rooms0, ppm0, ai, pdfPage?: { widthPt, heightPt }, bra?: number, sameSource?: [result] }`.
- `det0` og `rooms0` er gjenkjenningen og rommene ved en foreløpig `ppm0`.
- `ai` er svaret fra `readPlan`, eller `null`.

Result: `{ pxPerM, method, spread, n, confidence: 'high'|'medium'|'low', candidates: [{ method, pxPerM, weight, detail }] }`.

| Lag | Metode |
|---|---|
| `dimensions` | Mål fra KI. Et ytre mål sammenlignes med husets ytre utstrekning (ytterveggenes flater) langs riktig akse. En målekjede finnes klassisk nær stedet KI oppgir (`traceLine`), og den målte pikselavstanden gjelder. |
| `areas` | `sqrt(rompiksler² / etikett-m²)` per rom (rompiksler² = areal ved `ppm0` · `ppm0`²). Median, og avvikere ut (MAD). Rom med skråtak eller på loft teller mindre. |
| `paper` | «1:100» + PDF-sidestørrelsen: px per mm på arket = bildebredde / (sidebredde i pt · 25,4/72), og pxPerM = 10 · px/mm ved 1:100. |
| `standard` | Dørblad 0,8–0,9 m, seng 2,0 m, kjøkkenbenk 0,6 m dyp, tynneste vegg 10 cm. Lav sikkerhet. |
| `bra` | BRA fra brukeren mot innvendig fotavtrykk. Middels til lav sikkerhet. |

Det beste laget vinner, og de andre kontrollerer det. Er de uenige med mer enn 3 %, settes sikkerheten ned.
`sameSource`: etasjer fra samme kilde (samme bildestørrelse og stil) kan arve skalaen fra den sikreste etasjen. Det er
viktig for loft, der arealene er mindre enn gulvflaten.

### `src/planbygger/align.js` – etasjer oppå hverandre

`alignLevelTo(level, ref) → { offset: [dx, dy], method: 'stair'|'outline'|'corner', score }`:
- **`stair`:** trapperektanglene ligger likt i begge etasjene.
- **`outline`:** ytterveggbåndene rastres til 5 cm, og forskyvningen som gir mest overlapp finnes innenfor ±2 m og
  forfines til 1 cm.
- **`corner`:** `alignLevel` i `export.js`, brukes som reserve.

### `src/planbygger/facade.js` – fasader

`readFacade(img, { ai, storeys?, floorHeight = 2.7 }) → result`. Result:
`{ roof, groundY, eaveY, ridgeY, windows: [{ x0, y0, x1, y1, kind: 'window'|'door', storey, sill, height }], pxPerM, method, confidence }`.

Metoden er klassisk:
1. Bakkelinja er den lengste mørke horisontale linja nederst.
2. Vinduer er lukkede rammer med lysere innside.
3. Skalaen kommer fra en dør (2,1 m høy, står på bakken) eller etasjehøyden.

`sill` og `height` er i meter over gulvet i sin etasje. Takformen kommer fra KI, eller fra omrisset hvis KI mangler.
Hvert fasadevindu kobles til planvinduene langs samme vegg når det lar seg gjøre. Ellers gir fasadene standardverdier
per etasje.

### KI-laget

**Server:** `server/planbygger-ai/`, med egen `package.json` og `@anthropic-ai/sdk` i `server/planbygger-ai/node_modules`.
Prosjektets `node_modules` er felles med andre arbeidsmapper og skal ikke røres.
- `index.mjs` eksporterer `createAiHandler({ apiKey = process.env.ANTHROPIC_API_KEY, models, limits })`, en
  Connect-mellomvare for `/api/planbygger/ai` (POST) og `/api/planbygger/ai/status` (GET).
- `tools/planbygger-vite-plugin.mjs` monterer den i `configureServer`, med lat import slik at Vite virker uten SDK.
- I `server.mjs` blir det én linje senere. Det gjøres ikke nå, men beskrives i notatene.
- **Vern:**
  - en kvote per økt (informasjonskapsel) og per IP;
  - bildet skaleres ned til maks 1600 px på den lengste siden;
  - maks 3 kall samtidig, de andre venter i kø;
  - 60 s tidsavbrudd;
  - en hurtigbuffer på disk etter sha256 av oppgave, promptversjon, modell og bilde, i `.shots/planbygger/ai-cache/`.
- Strukturert svar med `output_config.format` (JSON-skjema). Modell: `claude-haiku-5-5` eller `claude-sonnet-5-5`,
  valgt etter målinger.

**Klient:** `src/planbygger/ai.js`:
- `aiStatus()` gir `{ available, model, remaining }`.
- `aiRead(task, { image, marks, hints })` gir svaret eller `null`. Den kaster aldri.
- `setAiTransport(fn)` brukes av testene, som spiller av lagrede svar.

**Merker:** `src/planbygger/marks.js`:
`drawMarks(img, { rooms, openings, symbols }) → { img, marks: [{ id, kind: 'room'|'opening'|'symbol', at: [nx, ny] }] }`.
Rom får tall og åpninger bokstaver, i tydelige sirkler.

**Oppgaver og svar.** Alle svar har med `at: [nx, ny]` per merke, så de kan kobles til riktig ting igjen om
nummereringen endrer seg.

- `classify` (hele arket):
  `{ drawings: [{ kind, bbox: [nx0, ny0, nx1, ny1], title, levelName, level }], scaleText, notes }`
- `readPlan` (merket plan):
  - `levelTitle`, `scaleText`
  - `rooms: [{ mark, at, name, area, kind }]`
  - `labels: [{ text, area, at }]`: etiketter som ikke ligger i noe merket rom
  - `dimensions: [{ text, value, at, along: 'h'|'v', what: 'outer'|'chain'|'other' }]`
  - `openings: [{ mark, at, kind: 'door'|'double-door'|'sliding-door'|'window'|'opening'|'none' }]`
  - `skylights: [{ at }]`
  - `stair: { present, at, type, up: 'here'|'elsewhere'|'unknown' }`
  - `ceiling: [text]`, `furniture: [{ kind, at }]`
- `readFacade`:
  `{ roof, storeys, windows: [{ bbox: [nx0, ny0, nx1, ny1], kind }], notes }`

**Opptak og testoppsett:**
- `tools/planbygger-ai-record.mjs` kjører bare med nøkkel. Den henter nøkkelen fra miljøet. På Windows leses
  brukervariabelen hvis prosessen ikke har den.
  - Den skriver `tools/fixtures/planbygger-ai/<hus>/<fil>.<oppgave>.json` med
    `{ promptVersion, model, marks, response, usage }`.
  - Taket er rundt 150 kall i denne runden, med Haiku først.
  - Den logger tokenbruk og pris.
- Testene spiller av opptakene og trenger aldri nøkkel.

### `src/planbygger/generate.js` – flyten

`generate(inputs, { ai, detect = detectPlan, onProgress }) → { doc, questions, report }`.
`inputs` er `[{ name, img, pdfPage? }]`.

Stegene:
1. Fotoer rettes opp (`photo.js`).
2. Ark med flere tegninger deles (`sheet.js`).
3. Hver tegning klassifiseres (`classify` og klassisk).
4. Etasjene ordnes: filnavn, så titler, så innhold. Inngang og kjøkken betyr hovedetasje, takvindu og skråtak betyr
   øverst, kjeller-ord betyr nederst.
5. Per plan:
   1. foreløpig skala fra standardmål;
   2. gjenkjenning og rom;
   3. `readPlan`;
   4. `estimateScale`;
   5. gjenkjenning på nytt med riktig skala;
   6. semantikken legges på (romnavn og -type, dørvarianter, takvinduer, trapp).
6. Etasjene legges oppå hverandre (`align.js`). En trapp tegnes inn der begge etasjene har den.
7. Fasadene gir takform og vindushøyder (`facade.js`).
8. Spørsmålene lages.

`questions: [{ id, kind: 'scale'|'ceiling'|'windows'|'room'|'stair'|'order'|'bra', level, crop: { file, bbox }, text, options, default, confidence }]`.
Teksten er på norsk.

`applyAnswers(doc, questions, answers) → doc`.

`report` sier hvilken metode som ble brukt i hvert steg, og hvor sikker den er.

### Brukerflaten

- `src/planbygger/stack.js`: slippsone for mange filer, og et etasjestabel med miniatyrer. Øverste etasje er øverst.
  Hver tegning har en merkelapp (Etasje, Fasade eller Annet), kan dras til ny plass, og viser grunnen til
  rekkefølgen.
- `src/planbygger/guide.js`: kortene, med utsnitt av tegningen, spørsmålet, det ferdig utfylte svaret, «Neste»,
  «Tilbake» og «Hopp over resten». Etterpå går den rett i 3D.
- `app.js`: startsiden blir «Slipp alle tegningene her», så stabelen, «Generer», fremdrift, veiviseren og 3D. «Finjuster»
  åpner editoren fra v1.

## Måling

`tools/planbygger-measure-all.mjs` kjører `generate` på alle husene med de lagrede KI-svarene og sammenligner med
fasiten. Den måler:
- skalafeilen, via median av generert areal mot etikettareal;
- romnavn og romtyper;
- dører per variant, vinduer, takvinduer og trapp;
- antall spørsmål.

Tabellen skrives inn i `notes/planbygger.md` mellom `<!-- hus:start -->` og `<!-- hus:slutt -->`.

## Regler for alle som jobber i runde 1

- **Bare nye filer**, med unntakene over. Motorfilene i `src/home`, `src/core`, `src/design`, `src/ui` og `src/player`
  røres ikke. Det som trengs der, skrives som en forespørsel.
- **Ingen commit og ingen push.** Hovedøkta committer etter hver gjennomgang.
- **Prosjektets `node_modules` røres ikke** (ingen `npm install` i roten). Den er felles med andre arbeidsmapper.
- **Porter 5270–5279.** Stopp bare egne prosesser etter PID, og aldri etter navn (eieren bruker Edge).
  Nettlesertesten bare med `--lock`.
- **API-nøkkelen** skal aldri skrives ut, logges eller havne i en fil.
- **Kode og kommentarer på engelsk**, i stilen til `src/planbygger/*`. Brukertekst på norsk.
- **Hver modul har sin egen test:** `tools/test-planbygger-<modul>.mjs`, med `check`, `section` og `done` fra
  `tools/planbygger-lib.mjs`.
