# Lenestoler – gjennomgang av modeller og mål (2026-10-20)

Alle 21 lenestolene og svingstolen i rommet er stilt opp i samme målestokk (forfra og fra siden). Målene er sjekket mot
Bohus, IKEA, Fagmøbler og produsentenes egne sider (Conform, Stressless).

## Mål
- De fleste stolene stemmer med butikkens mål. Armlenehøyden oppgis aldri, så `armH` er fortsatt anslått.
- **Timeout:** 80 × 81 × 101 cm (Conform) **inkludert nakkeputen**. Selve ryggen er ca. 0,78 m, og puten står over.
  Armlenet er ca. 0,55 m, skammelen 51 × 38 × 39 cm.
- **Grande:** katalogvaren er «Grande med integrert fothviler». Bohus-siden viser ingen mål lenger, så høyden er satt
  som Zermatt med fothviler (1,09 m). Den eldre Grande 309082 (80 × 86 × 110, uten fothviler) er utgått.
- Rettet: Beetle setedybde 0,53, Saltsjöbaden setedybde 0,65, Opal skammel 54 × 40 × 39, Strandmon skammel
  60 × 40 × 44.
- Alt ligger i `src/data/scripts/fixes.mjs` (`dims`/`params` flettes inn). Kjør
  `node src/data/scripts/fixes.mjs --apply --only=catalog`. Testen bruker disse verdiene foran research-verdiene.

## Modeller (`src/models/seating.js`)
- **Timeout:** bruker nå `body: 'box'`. Sidevangene stopper over foten (`armBottom`), armlenene svinger utover
  mot toppen (`armTuck`), og den har egen nakkepute. Varianter med treskall får finér på utsiden uten
  armrull (`armCap: false`). «Helkledd» (rammen i samme stoff og farge) gir polstrede sider.
- **Opal / Stressless (`body: 'classic'`):** er bygget om i den felles hvilestolkoden. Ryggen er ett stykke med
  tverrsømmer, armputene ligger på korte bakre stolper, og stolen har ringfot med to S-buede stolper (`ringBase`).
  Skammelen står også på ringfot. Den gamle `buildReclinerClassic` er fjernet.
- **Cooper:** ny form `backShape: 'tufted'` i club-box: lav, dyp og uten armlener, med 2 × 2 tufter i setet og
  2 × 3 i ryggen.
- **Grande / Zermatt:** armrullen går over toppen og ned fronten til setet (`armFrontDrop` korter den). Den holder
  seg innenfor `dims.w`. Lukket integrert fothviler er nesten loddrett, like bred som setet og går opp bak setefronten.
- **Taycan (tulip):** armlenene når full bredde, ryggen er mer bakoverlent, armlenene er rundere sett fra siden og
  setet er tykkere når fothvileren er innebygd.
- Hvilestolens editor: «Utforming» → «Stressless (armputer på braketter, ringfot)». Club-box «Rygg» har fått
  «Puffete tufter, uten armlener».

## Verktøy
`.shots/chairs/`:
- `lineup.mjs` – alle stoler i samme målestokk. `--side=1` gir sidevisning, og skriptet lister avvik mellom modell
  og katalogmål.
- `views.mjs <id> [--set=JSON]` – forfra, fra siden og skrått.
- `room.mjs` – stoler plassert i stua.

Serveren `veggforslag-test` (port 5249, uten HMR) står i `.claude/launch.json`.

## Kjente rester
- Svingstolens mål i rommet (0,75 × 0,75 × 0,76) er anslått fra bilder. Brukeren bør måle den.
- Saltsjöbaden mangler skjørt og rullede armlener (boksform).
- Strandmon er ca. 3,5 cm for bred (vingene).
- Spaken på Grande og Zermatt stikker ca. 3 cm ut på den ene siden.
