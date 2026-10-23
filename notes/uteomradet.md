# Uteområdet rundt et generert hus

Et generert hus sto på en flat, grønn plate. Nå kan husformatet ha feltet `site`: en tomt som kan skråne, med flater,
murer, gjerder, hekker, levegger og trapper. Motoren bygger tomta, og figuren kan gå ute.

Grenen er `claude/intelligent-benz-c08149`. Den fletter inn `claude/hungry-mendeleev-b747e9` (motoren med kledning,
dekk og tak), og den grenen er ikke godkjent inn i master ennå.

Alt er valgfritt. Et hus uten `site` bygges som før. Eierens hus har ikke `site`, og fingeravtrykket er uendret
(`layout 9fd8f7a355b0f410`, `rooms a7cf211c026c6559`, 301 mesher).

## Hva planbyggeren skal sende

1. **Terrenglinja per fasade:** `site.terrain.lines[]`, én per fasadetegning.
   - Hver linje er `{ id, side, points: [[x, z, y], …] }`.
   - Punktene ligger langs ytterflaten til veggene i fasaden, i husets plan (x, z). `y` er verdens-y: hovedetasjens
     gulv er dens `floorY`, og −0,15 er den gamle flate bakken (ett trinn under gulvet).
   - Slik regnes punktene ut: for et punkt s meter fra venstre ende av fasaden (sett utenfra), på høyden h over
     gulvlinja (±0,00 på tegningen), er punktet `[P0 + (P1 − P0)·s/L, h + floorY]`. P0 og P1 er endene av ytterflaten
     til veggene fasaden er matchet mot, og L er avstanden mellom dem.
   - Send minst de to endene, og et punkt der terrenget knekker (for eksempel der kjelleren begynner å stå fri).
   - Hus med kjeller: på siden der kjelleren står fri, ligger terrenget ved kjellergulvet (−0,15 under), eller det
     tegningen viser.
   - Terrenget passerer gjennom hver linje (± 12 mm). Mellom og utenfor linjene skråner det som et plan tilpasset alle
     punktene. 15 m ute flater det seg av.
2. **Dører og dekk:** ingenting nytt. Motoren leser dørene i ytterveggene (`openings` med `type: 'door'` og
   `connects: [rom, 'ute']`) og dekkene som før. Den lager selv:
   - heller foran døra når bakken er inntil 0,45 m under gulvet;
   - en trapp (en `porch` med trinn og rekkverk der fallet er over 0,5 m) når bakken ligger lavere;
   - en nedsenket gårdsplass med murer og trapp opp når døra står under terrenget (det gir en advarsel);
   - en sti med heller fra inngangen til innkjørselen eller gårdsplassen, når en slik finnes;
   - heller ved foten av hver dekktrapp.

   Dører bredere enn 1,9 m (garasje, carport) får ingenting: innkjørselen er utsiden deres. Utelat `groundY` på
   dekkene. Den regnes ut fra terrenget ved foten av trappa.
3. **Visningen (`src/planbygger/viewer.js`):** når huset har `site`, skal visningen ikke bygge sin egen bakkeplate
   (`ground`), `basementYards` eller `doorRamps`. Bakken og alt på tomta kommer fra `buildRooms`, og kolliderne ligger
   i `colliders`. Grensene for gåing er `layout.house.site.bounds` (eller det siste rektangelet i `walkRects`, det med
   `site: true`). Det går bra å beholde lyset og himmelen som nå.
4. **Eksporten:** `site` står nå i `schema.topLevel` i `research/house/00-ids.json`. Send `house.site` bare når
   `idsRegistry.schema.topLevel.includes('site')`, slik som `cladding` og `decks`.
5. **Senere (situasjonsplan og byggetegninger):** `site.lot`, `surfaces`, `fences`, `walls`, `steps` og
   `terrain.points` (koter) i formatet under.

## Formatet `site`

```
site: {
  terrain: { lines: [{ id, side?, points: [[x, z, y], …] }], points?: [[x, z, y], …] },
  lot?: [[x, z], …],                        tomtegrensen: plen innenfor, eng utenfor
  surfaces?: [{ id, kind, surface?, color?, outline | path + width, y?, blend?, walls?, wall? }],
  walls?: [{ id, line: [[x, z], …], height?, top?, thickness?, material?, color? }],
  fences?: [{ id, kind, line: [[x, z], …], height?, color? }],
  steps?: [{ id, from: [x, z], to: [x, z], width?, fromY?, toY?, material?, color?, cheeks? }],
  auto?: { entrances?, paths?, deckFeet? },  alle true som standard
  grass?: '#rrggbb', margin?: 8              plenfargen; hvor langt den fine bakken går ut forbi alt
}
```

- **`surfaces`:**
  - `kind`: `'driveway'` (innkjørsel), `'yard'` (gårdsplass), `'path'`, `'patio'` (uteplass), `'lawn'` eller `'bed'`.
  - `surface`: `'gravel'`, `'asphalt'`, `'pavers'` (belegningsstein), `'slabs'` (heller), `'concrete'`, `'grass'` eller
    `'bark'`. Standard per kind: grus, grus, heller, belegningsstein, gress, bark.
  - `outline` er et polygon. `path` er en linje med `width` (standard 1,2).
  - Uten `y` følger flata terrenget. Med `y` (verdens-y) er den plan og skåret inn i terrenget: utenfor kantene glir
    bakken tilbake til terrenget over `blend` m (standard 1,2).
  - `walls: true | [kantnumre]` gir en støttemur langs kantene, utenfor flata. Der stiger ikke bakken gradvis: muren
    går fra under den lave siden til 6 cm over den høye. `wall: { thickness, material, color }` endrer muren.
  - Den siste flata som gjelder, vinner.
- **`walls`:** frittstående murer. Toppen ligger `height` (standard 0,6) over bakken, eller på `top`. `material` er
  `'concrete'`, `'stone'` eller `'block'`.
- **`fences`:** `kind` er `'fence'` (stakitt, 1,0 m), `'screen'` (levegg, 1,8 m) eller `'hedge'` (hekk, 1,3 m). De
  følger bakken.
- **`steps`:** en rett hagetrapp fra `from` til `to`. Høydene kommer fra bakken (eller `fromY` og `toY`). Hvert trinn
  er høyst 0,17 m, og inntrinnet er lengden delt på antall trinn. Trappa har vangemurer (`cheeks: false` tar dem
  bort), og bakken er plan i begge ender.

## Motoren

- `src/home/sitegeom.js` er modellen, uten three. Den har `terrainModel`, `resolveSite` (fyller inn standarder, lager
  inngangene, setter dekkene på terrenget og gir advarslene) og `sitePieces` (bakken delt opp langs alle kanter, uten
  sprekker).
- `src/home/site.js` er byggeren, kalt fra `rooms.js` etter dekkene. Alt ligger i én `MeshBatcher`: testhuset gir 15
  mesher (draw calls) og ca. 31 000 trekanter. Ingenting kaster skygge, og bakken tar imot skygge.
- `layout.js` gir `house.site` og et ekstra gårektangel. `rooms.js` lar ytterlaget i de laveste veggene gå ned til
  bakken der den faller.
- Sokkelen følger terrenget. Med `cladding` blir alt under sokkeltoppen sokkel, og uten `plinth` er det bar betong
  under hovedetasjens trinn. Uten `cladding` er fasaden betong under trinnet.
- `decks.js`: stolpene går ned til bakken under hver stolpe, og skjørtet på et `solid` dekk går ned til bakken.
- Validatoren (`house.mjs`) kjenner alle feltene. Ukjente verdier gir feil, og ukjente felt gir advarsel. Den varsler
  når terrenget ligger over hovedgulvet langs en vegg, når et gjerde går gjennom huset, og når en trapp er for bratt.

## Testene

- `node tools/house-tests/uteomrade.test.mjs` har 44 sjekker:
  - terrenget, inngangene og dekkene på terrenget;
  - at bakken er uten sprekker og at ingenting av den ligger inne i huset;
  - materialene, murene, vangemurene og stolpene;
  - at ingen flater ligger i samme plan;
  - sokkelen på et hus uten kjeller (med og uten `cladding`);
  - gangtester ved 30, 60 og 144 Hz: ned og opp hagetrappa, opp og ned terrassetrappa, opp til sidedøra og til
    inngangen, og at muren stopper figuren;
  - validatoren og eierens fingeravtrykk.
- Testside: `dev/uteomrade.html`, launch «uteomrade-test» på port 5272. Den har knapper for visningene, og «Gå» lar deg
  gå med spillets figur. `window.__walkPath([[x, z], …])` går en rute.

## Det som ikke er gjort

- Bakken har bare sprang ved murede kanter. En frittstående mur er en mur i skråningen, ikke en terrasse.
- Hagetrappene er rette.
- Fottrinnslyden er treverk ute også (ingen `addSurfaceZone` for gress og grus).
- Et generert hus med `site` i selve spillet (`index.js`) er ikke prøvd. Der bygger `exterior.js` også stuas gamle
  utside med terrassen.
