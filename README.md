# Interiørspillet

Et 3D-spill i nettleseren der du går rundt i **din egen stue** – kjøkkenet, spisestua, sittegruppa ved de store
sørvinduene mot elva og TV-stua – og prøver ut interiør før du kjøper noe:

- **Den høye veggen** (3,91 × 3,00 m): 40 forslag (spilevegger, sjakkbrett med Akupixel, tekstilpaneler, gardinvegg,
  mose, akustikkbilder …) som du kan bla i, ta i bruk, endre og sammenligne med fotomontasjene.
- **Møbler og lamper** fra katalogen (Bohus, IKEA, Christiania Belysning, Fagmøbler m.fl. – 174 produkter med ekte mål
  og priser i 10 kategorier): lenestoler og hvilestoler, skjenker, vitrineskap (også veggmontert), taklamper (bl.a.
  Secto- og Octo-spilelamper i tre), gulv- og bordlamper, puter, pledd, puffer, tepper, solskjerming, akustikkprodukter
  og pynt.
- **Solskjerming** på vinduene (persienner, rullegardiner, plissé, duo, lameller, gardiner, liftgardin, screen) med
  ekte sol som slipper inn i striper gjennom lamellene.
- **Lys og sol**: sola følger klokke og dato på 58,1° nord, kveld/natt med lampene og LED-listene på.
- **Akustikk**: etterklangstiden (Sabine) regnes ut fortløpende – i dag ca. 0,86 s, målet er 0,4–0,6 s.
- **Handleliste** med priser, lenker og totalsum, **lagring** av flere design, **før/etter** og **bilde** (PNG).

Alt kjører lokalt i nettleseren; ingenting sendes noe sted. Designene lagres i nettleseren (localStorage) og kan
eksporteres til fil.

---------------------------------------------------------------------------------------------------------------

## Kom i gang

Du trenger [Node.js](https://nodejs.org) (versjon 20 eller nyere).

```bash
npm install
npm run dev
```

Åpne **http://127.0.0.1:5180** i Chrome, Edge eller Firefox. Trykk **«Gå inn i stua»** (eller Enter).
Har du et design fra forrige gang, er den store knappen (Enter) **«Fortsett: <navnet>»** (eller «Fortsett siste
design» når det ikke har fått navn), og **«Start med stua slik den er i dag»** starter på nytt.

Første gang tar lastingen litt tid («Forbereder grafikken»: skjermkortet lager alle skyggeleggerne på forhånd, så
ingenting hakker når du åpner katalogen eller blar i veggforslagene). Teksturene lages mens startskjermen vises og
huskes i nettleseren, så neste start går raskere.

| Kommando | Hva den gjør |
| --- | --- |
| `npm run dev` | utviklingsserver på http://127.0.0.1:5180 (oppdaterer seg selv når filer endres) |
| `npm run build` | lager nettversjonen i `dist/` (virker fra hvilken som helst mappe på en webserver) |
| `npm run preview` | viser `dist/` på http://127.0.0.1:4180 |
| `npm run pack` | bygger og pakker `dist/` + `.htaccess` i `deploy/interiorspillet-web.zip` for opplasting |

Nettversjonen for kenmyd.no: se **[deploy/LES_MEG_OPPLASTING.md](deploy/LES_MEG_OPPLASTING.md)**.

---------------------------------------------------------------------------------------------------------------

## Kontroller

### Bevegelse

| Tast / mus | Hva |
| --- | --- |
| **W A S D** (eller piltastene) | gå |
| **Shift** | løp |
| **Space** | hopp · **C** huk |
| **Hold høyre museknapp** og dra | se deg rundt (eller dra med venstre knapp i tomt rom) |
| **E** / klikk på en dør | åpne og lukke dører (gangdøra og terrassedøra) |
| **H** | vis/skjul hjelpen · **Esc** pause (Fortsett, Innstillinger, Kontroller, Avslutt) |

### Velge og flytte

| Tast / mus | Hva |
| --- | --- |
| **Venstreklikk** på et møbel | velg det – egenskapspanelet åpnes til høyre |
| **Venstreklikk** på den høye veggen | veggforslagene åpnes |
| **Venstreklikk** på en annen vegg | velg veggfarge (Sand, Marrakesh eller Jotun-paletten) |
| **Venstreklikk** på et vindu | solskjermingspanelet for det vinduet |
| **Dra** et valgt møbel | flytt det langs gulvet, veggen, taket eller bordplata (fester seg mot vegger og hjørner) |
| **Dra** den runde pilen ved møbelet | roter fritt i 15°-steg (hold **Alt** for fri vinkel) |
| **R** / **Shift + R** | roter 15° (også mens du plasserer) |
| **←  →  ↑  ↓** | flytt 2 cm (med **Shift**: 10 cm) |
| **Ctrl + D** | dupliser (bare **D** i oversikt og plan) |
| **Delete** | slett · **Esc** velg bort / lukk panelet |
| **G** | 10 cm-rutenett av/på · hold **Alt** = flytt uten å feste |
| **Musehjul** (på vegg) | høyde for bilder, speil og veggpaneler |
| **Ctrl + Z** / **Ctrl + Y** | angre / gjør om (alt kan angres, også flytting, farger og veggforslag) |

### Verktøylinja (nederst)

| Tast | Verktøy |
| --- | --- |
| **K** | Katalog |
| **V** | Veggforslag (← → blar mens panelet er åpent) |
| **B** | Vinduer og solskjerming |
| **L** | Lys og sol |
| **Tab** | Visning: gå → oversikt (dukkehus) → plan → gå |
| **O** | Før/etter |
| **M** | Design (lagre, åpne, eksportere) |
| **I** | Handleliste |
| **P** | Bilde – lagrer det du ser som PNG |

I **oversikt** snur du med høyre museknapp, flytter utsnittet med Shift + høyre knapp (eller midtre), og zoomer med
musehjulet. I **plan** drar du med høyre knapp og zoomer med hjulet. Alle verktøyene virker i alle visningene.

---------------------------------------------------------------------------------------------------------------

## Verktøyene

### Katalog (K)
1. Velg kategori øverst (Lenestoler, Skjenker, Vitrineskap, Taklamper, Små lamper, Puter og pledd, Tepper,
   Solskjerming, Akustikk, Smått) eller søk («bouclé», «eik», «IKEA» …). Klikk på et kort for detaljer, mål, pris og lenke til butikken.
2. **«Plasser»**: et halvgjennomsiktig spøkelse følger musa på riktig underlag (gulv, vegg, tak, bordplate, sofa).
   Rødt betyr at det kolliderer med noe. **Klikk** plasserer, **Shift + klikk** plasserer flere, høyreklikk/Esc avbryter.
3. Etterpå åpnes **egenskapspanelet**:
   - **Bytt modell ◀ ▶** (eller tastene **,** og **.**) – prøv de andre produktene i samme kategori på nøyaktig
     samme sted (en hvilestol blar blant hvilestolene, en pendel blant pendlene). Vitrineskapene blar også til det
     veggmonterte BESTÅ-skapet: det henges da på veggen bak skapet (underkant ca. 1,2 m), og tilbake står det på gulvet.
   - **Varianter** – butikkens farger. **Farger og materialer** – egen farge per del (trekk, ben, ramme …). Du får
     beskjed når fargen/målene ikke lenger finnes hos butikken.
   - **Størrelse**, **Form og detaljer** (f.eks. understell, armlener, puter), **Plassering** (rotasjon), **Lys**
     (på/av, dimmer, fargetemperatur, høyde under taket for pendler) og **Lyd** (hvor mye møbelet demper).
   - Dagens møbler kan også byttes ut («Prøv andre modeller her») og settes tilbake («Tilbake til …»).

### Veggforslag (V, eller klikk på den høye veggen)
- **◀ ▶** (eller piltastene) blar gjennom alle forslagene. Det du blar til er bare en forhåndsvisning.
  Øverst ser du etterklangstid, ekstra demping (m² Sabine) og omtrentlig pris.
- **«Bruk dette forslaget»** tar det i bruk i designet (kan angres).
- Fanen **«Rediger»**: veggfarge, alle elementene med sine mål og farger (f.eks. treslag og farge på spilene i
  sjakkbrettet), legg til / dupliser / fjern elementer, **«Lagre som mitt forslag»**. Klikk på et element på
  veggen for å velge det.
- **«Sammenlign med fotomontasjen»**: kameraet hopper til vinkelen fotomontasjene er tatt fra, og montasjen legges
  over 3D-bildet med en skillelinje du kan dra. «Lys som på bildet» (på som standard) setter lyset som på
  «Før»-bildet montasjene bygger på (18. oktober kl. 08:30, spottene og LED-listene på) – bare mens du
  sammenligner, designet endres ikke. Forslag uten montasje vises som bare 3D («Vis før-bildet» legger dagens
  vegg over). Esc går tilbake.

### Vinduer og solskjerming (B, eller klikk på et vindu)
- Velg vindu i lista (de to store stuevinduene, terrassedøra, de to kjøkkenvinduene og overlysvinduet i TV-stua).
- Velg **type** (persienne, rullegardin, plissé, duo-rullegardin, lamellgardin, gardin, liftgardin, utvendig screen),
  så **produkt** (med pris beregnet for akkurat dette vinduet) eller «Egendefinert».
- **Farge**, skinne/beslag, **Trukket opp**, **Lamellvinkel** (persienner) og montering (i lysningen, på karmen, på
  veggen, i taket). **«Bruk på alle vinduene i denne veggen»** kopierer valget.
- Sett klokka til f.eks. 13:00 i «Lys og sol» for å se sola komme inn i striper gjennom lamellene.

### Lys og sol (L)
- **Klokkeslett** og **dato** (snarveier for vinter, vår, sommer, høst og i dag) – sola står riktig for 58,1° nord med
  vinduene mot sør. Soloppgang, solnedgang og dagslengde vises.
- **Lysmodus**: Automatisk (de faste lysene slår seg på når det blir mørkt), Dagslys, Kveldslys, Natt.
  **Vær**: sol eller overskyet.
- **Lamper**: alle de faste lysene (LED-listene, spottene ved den høye veggen, kjøkkenlysene, taklampa i TV-stua)
  og lampene i designet – på/av og dimmer, «Alle på», «Alle av», «Automatisk».
- **Lysstyrke på bildet** (±2 EV) og breddegrad.
- Nye lamper fra katalogen lyser av seg selv; velg dem for dimmer, fargetemperatur og høyde under taket.

### Akustikk (merket nederst til venstre)
«Etterklang ≈ 0,86 s» er grønn (≤ 0,6 s), gul (≤ 0,7 s) eller rød. Etter en endring vises hvor mye den endret seg.
Klikk på merket for fordelingen: hva som demper i dag (rom, sofaer, puter, tepper …), hva du har endret, og hvor mye
mer demping som trengs for å nå 0,6 s. Tepper, puter, pledd, puffer, gardiner, tekstil- og spilevegger teller.

### Design – lagring (M)
- **Lagre** med et navn, **åpne**, **gi nytt navn** og **slette** lagrede design. «Original» er alltid stua slik
  den er i dag.
- Det du gjør lagres også automatisk (også når du lukker fanen – nettleseren spør ikke). **«Fortsett …»** på
  startskjermen tar deg tilbake dit du slapp. «Start med stua slik den er i dag» starter med dagens stue; en økt uten
  navn med endringer blir liggende som «Forrige økt (dato)» (de tre siste beholdes).
- Åpner du et annet design, «Original» eller en fil mens det du holder på med ikke har navn, tas det vare på som
  «Forrige økt (dato)». **Ctrl+Z** etter «Åpne»/«Importer» gir deg det forrige designet tilbake – med sitt eget navn,
  så autolagringen aldri skriver over feil design.
- **Eksporter til fil** / **Importer fra fil** (.json) – for sikkerhetskopi eller for å åpne designet på en annen maskin.
  Filer som ikke er et design fra Interiørspillet avvises, og urimelige verdier (mål, antall, posisjoner) rettes.

### Handleliste (I)
Alt nytt i designet, sortert per butikk, med pris, antall og lenke («Åpne»), veggforslaget med prisanslag og
materialliste, solskjerming per vindu (antall stk. eller måltilpasset pris), og møbler som er tatt ut av stua.
**Totalt** øverst. **Kopier liste**, **Last ned CSV** (regneark) og **Skriv ut**. Sjekk alltid pris og lagerstatus
hos butikken før du bestiller – prisene er hentet i oktober 2026. Hver farge har sin egen pris der butikken har det
(tilbud gjelder bare fargene butikken oppgir), og kampanjepriser som bare ble vist i en kategoriliste er merket
«sjekk prisen».

### Før/etter (O)
Viser stua slik den er i dag. Trykk O (eller Esc) igjen for å komme tilbake til designet ditt – ingenting går tapt.

### Bilde (P)
Lagrer det du ser (uten markeringer og menyer) som en PNG-fil, f.eks. `stua-2026-10-18-1709.png`.

### Innstillinger (Esc → Innstillinger, eller på startskjermen)
Musefølsomhet, invertert mus, museoppførsel (WoW-stil eller FPS), synsfelt, **grafikkvalitet** (Lav / Middels /
Høy – Høy gir myke skygger i krokene, AO og glans i stoffene), **Automatisk oppløsning** (senker oppløsningen hvis
bildet hakker, og øker den igjen når det er luft – «Middels» starter på inntil 1,25 × skjermoppløsningen), vis
bildefrekvens, lyd.

---------------------------------------------------------------------------------------------------------------

## Målene i stua – hvor du endrer dem

Alle mål for rommet ligger på **ett sted**:

- **`src/data/room-spec.json`** – vegger (`walls`: start/slutt, tykkelse, maling og åpninger med `offset`, `width`,
  `height`, `sill`), tak (`ceilings`: flatt 2,40 og skråtaket 3,00 → 2,40), nedforinger (`bulkheads`), gulv,
  kjøkkeninnredning (`kitchen`), dagens møbler (`furniture`: posisjon, rotasjon, mål, farger, materialer), faste
  lys (`builtInLights`), stikkontakter/brytere/varmepumpe (`fixtures`), den høye veggen (`highWall`), terrassen
  (`outside`) og fotovinklene (`photoCameras`). Fila **genereres** og redigeres ikke for hånd: kilden er
  `research/room-spec.json` (stua) pluss `research/house/NN-*.json` (resten av huset, med id-registeret
  `research/house/00-ids.json`), og `node src/data/scripts/normalize-data.mjs --only=room-spec` fletter dem, validerer
  hele huset (stopper ved feil, for eksempel en dør som sperrer en passasje) og skriver fila og «Målelista» i
  `research/room-spec-notes.md`.
- **`src/home/layout.js`** – leser room-spec og regner ut alt annet (veggvektorer, åpninger i 3D, takhøyde i hvert
  punkt, soner, volum, den høye veggens koordinater). Her skal det normalt ikke stå tall; endre i room-spec.
- Farger: `src/data/palette.json` (Jotun SAND #cfc5b4 og MARRAKESH #aea191 + paletten), produkter:
  `src/data/catalog/*.json`, veggforslag: `src/data/wall-proposals.json`.

Koordinater: meter, **+x = sør** (mot vinduene), **+z = vest** (mot TV-stua), +y = opp, origo = gulvet i det
nordøstre innerhjørnet (øverst til venstre på plantegningen). `rotationDeg` 0 = fronten mot vest, 90 = mot sør.

Etter en endring: lagre fila – siden lastes på nytt av seg selv med `npm run dev`. `node tools/test-design.mjs` sjekker
dataene (95 tester).

### Sjekk med målebånd (viktigst først)

Målene er satt sammen fra plantegningen og 42 bilder. Før du bestiller noe som må passe nøyaktig, mål dette:

1. **Den høye veggen**: fra nisjehjørnet (TV-stua) til ytterkant av den svarte dørkarmen – forventet **3,91 m** – og
   takhøyden helt inntil veggen i begge ender (forventet **3,00 m**).
2. **Skråtaket**: høyden ved vindusveggen (**2,40 m**) og over midten av spisebordet (forventet ca. **2,65 m**). Viktig for
   pendellengden over spisebordet.
3. **Vinduene, før du bestiller solskjerming** – innvendig lysning bredde × høyde:
   - stuevinduene: ca. **2,36 × 1,81 m** (de absolutte breddene er usikre med ca. ±3 cm)
   - langt kjøkkenvindu: **2,42 × 1,16 m** · kvadratisk kjøkkenvindu: ca. **1,12 × 1,14 m**
   - overlysvinduet i TV-stua: **1,75 × 0,48 m** · terrassedøra: ca. **0,88 × 2,10 m**
   - mål også lysningsdybden (**0,20 m**), om det er plass til persienne innenfor glasslisten, og avstanden fra overkant
     lysning til taket (**0,30 m**).
4. **Underkant av nedforingen over TV-stua** (2,40, 2,35 eller 2,33?).
5. **Langs sørveggen**: fra knekkhjørnet til terrassedøra (**0,07 m**) og pilarbreddene (**0,21 / 0,21 / 0,46 m**).
6. **Spottene ved den høye veggen**: avstand fra nisjehjørnet (0,76 / 1,62 / 2,48 / 3,34 m) og ut fra veggen (0,38 m).
7. **Spisebordet**: lengde × bredde (2,00 × 1,05 m, uttrukket?) og senter fra vindusveggen.
8. **Varmepumpa**: høyde over gulv (underkant ca. 2,55) og bredde (0,89–1,0 m).
9. **Kjøkkennedforingen**: avstand fra kjøkkenets bakvegg (**3,32 m**).
10. **Plassen til en ny lenestol** mellom TV-stua og sittegruppa: fritt gulv ca. x 3,2–4,4 m, z 8,4–11,3 m (mellom
    sofaarmen, palmen og svingstolen).

Også usikre: svingstolenes retning (±20°), maleriets størrelse (1,00 × 0,70 eller 1,20 × 0,80) og alle møbelfarger
(anslått fra morgenbilder). Fotovinklene 082806 og 082924 er godt bestemt; de andre har ca. ±0,2 m / ±3°.

---------------------------------------------------------------------------------------------------------------

## For den som vil se under panseret

- `ARCHITECTURE.md` (modulene og kontraktene), `SCAFFOLD.md` (kjernen), `notes/*.md` (hver moduls notater).
- Testsider: `/dev/sandbox.html?photo=20261018_082806` (fri kamera / fotovinkel – sammenlign med `public/img/foto/`),
  `/dev/models.html?cat=lenestol` (modellgalleri).
- URL-parametre i spillet: `?play=1&pos=x,y,z&yaw=grader&pitch=grader&view=walk|orbit|plan&design=<navn>&start=continue`
  (`pos` må være tre tall – ellers brukes startpunktet; et punkt inne i et møbel flyttes til nærmeste ledige gulv).
- Data: `src/data/scripts/fixes.mjs` er rettelsene oppå research-dataene (farger fra bildene, pynten på bordene,
  variantpriser, navn, demping for hvilestolene …) – `node src/data/scripts/fixes.mjs --apply` legger dem inn, og
  normaliseringsskriptet bruker dem. Katalogen bygges fra `research/catalog/*.json` pluss de nyeste rundene i
  `research/catalog-new/*.json`: `node src/data/scripts/normalize-data.mjs --only=catalog` (bare katalogen – rører
  ikke room-spec), `--out=<mappe>` skriver et annet sted (for å sammenligne).
- Skjermbilder/tester: `node tools/shot.mjs "/?play=1" ut.png` (Edge uten vindu, se kommentaren øverst i fila).

## Kjente begrensninger

- Utsikten er fotografier (morgen og et bearbeidet kveldsbilde); trær og fjellet nær huset forskyver seg litt når du
  går rundt. Terrassen, rekkverket og trappa er en enkel kulisse.
- Møblene er prosedyrisk modellert etter mål, farger og beskrivelser – ikke 3D-skannet. Sammenlign alltid med
  produktbildet hos butikken.
- Farger på skjerm avhenger av skjermen; lys og hvitbalanse er kalibrert mot bildene av stua, men er ikke en fargeprøve.
- Etterklangstiden er et Sabine-anslag (500–1000 Hz), kalibrert til 0,86 s for stua i dag – ikke en måling.
- «Mine forslag» for veggen lagres i nettleseren (ikke i eksporterte designfiler); forslaget du bruker følger designet.
