# wall-r3 – runde 3 av veggforslagene (2026-10-20)

20 nye forslag til den høye veggen, N20–N39, i fire grupper i veggpanelet:

| Gruppe | Forslag |
| --- | --- |
| Runde 3 – sekskanter | N20 bikube i filt (diagonal), N21 røkt eik + mose, N22 grønn ombre (spiss topp), N23 tre dybder ton i ton, N24 kork over skjenk |
| Runde 3 – sjakkbrett med skjenk | N25 røkt eik 4 × 3 + sort skjenk, N26 høyt tofarget + skjenk og bilde, N27 eik/olivenfilt + valnøttskjenk, N28 valnøtt 40 cm + sort skjenk |
| Runde 3 – bildevegger | N29 salongvegg (11 bilder), N30 to bildehyller med lente bilder, N31 rutenett 3 × 3, N32 spilevegg med tre bilder |
| Runde 3 – nye retninger | N33 panoramatapet, N34 fyllingspanel i Marrakesh med linfelt, N35 bokvegg til taket, N36 bølgevegg, N37 kanalpolstret fløyel, N38 kalkmaling + terrakotta-sol, N39 botanisk tapet over brystpanel |

## Kilde
`src/data/scripts/wall-round3.mjs` lager forslagene (sekskantmønstrene regnes ut med faste frø), regner ut
`sabineAdded`/`rt60` og skriver både `src/data/wall-proposals.json` og `research/wall-proposals-new.json`
(normaliseringsskriptet beholder dem da). Kjør det på nytt etter endringer; `--dry` viser bare tallene. Pris er
bevisst ikke beregnet (`priceText: 'Pris ikke beregnet'`).

## Nytt i `models/walldesigns.js`
- Nye elementtyper: `wallpaper` (botanisk, panorama, striper, fiskeskjell, gresstapet; bue-form mulig), `moulding`
  (kassetter / rutenett / stående lister / bare brystlist, i halvblank maling), `bookcase` (innebygd bokhylle med
  bøker og pynt, malt bakvegg), `ledge` (bildehylle med lente bilder i lag).
- `slats`: `waveAmp`/`wavePeriod`/`wavePhase` (bølgespiler). `checker`: `fill: 'wood-felt'`. `hexagons`: per flis
  `depth` og `surface` (eik, mose, filt, kork …). `paint-block`: `shape` sirkel/halvsirkel og `finish: 'limewash'`.
  `panel`: `edge: 'channel'` (kanalpolstring).
- Bilder som overlapper spiler/paneler/sjakkbrett/mose henger nå på forsiden av dem (ingen eksisterende forslag berøres).
- Editorfelt, verdier, alfa-estimat og beskrivelse for alt over; `Acoustics.js` har alfa for de nye typene.

## Testing
- `.shots/wall-r3/render.mjs` – rett forfra + montasjekamera per forslag (server på 5249: `veggforslag-test` i
  `.claude/launch.json`, uten HMR). `flow-panel.mjs` – veggpanelet i spillet: blar, «Rediger», legger til de nye typene.
- Miniatyrer: `BASE=http://127.0.0.1:5249 node .shots/fix-walls-r1/gen-thumbs.mjs N20 … N39`.
- `node tools/test-design.mjs` – 96/96 (forventer nå 60 forslag og de nye elementtypene).
