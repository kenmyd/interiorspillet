# Planbygger: fra kundens tegninger til 3D-hus

Skrevet 2026-10-21 (v1) og 2026-10-22 (runde 1, fase A–C) på grenen `claude/planbygger-5d0fe3` (kuttet fra
`hele-huset`). Siden er `planbygger.html` (egen vite-inngang). Koden ligger i `src/planbygger/`, KI-serveren i
`server/planbygger-ai/`, og verktøy og tester i `tools/planbygger-*` og `tools/test-planbygger*.mjs`. Designet og
kontraktene for runde 1 står i `notes/planbygger-runde1-design.md`, og testsettet i `plantegninger/` (`README.md`).

Planbyggeren gjør én ting: en kunde laster opp tegningene av sitt eget hus, og får et 3D-hus hen kan gå rundt i.

- **v1, én plan:** kunden setter målestokken, gjenkjenningen foreslår vegger, dører og vinduer, og kunden retter
  forslaget i editoren. Alt skjer i nettleseren, uten server og uten KI.
- **Runde 1, «Generer»:** kunden slipper alle tegningene sine, plantegninger og fasader, og trykker «Generer».
  Planbyggeren ordner etasjene, finner målestokken og rommene, spør bare om det den ikke finner selv, og åpner
  3D-huset. Editoren fra v1 heter nå «Finjuster».

Prinsippet er at KI forstår og klassisk bildebehandling måler. KI-en (Claude, valgfri) leser tekst og symboler på en
nedskalert kopi av tegningen og svarer med strukturert JSON. Alle mål og koordinater kommer fra den klassiske
gjenkjenningen i nettleseren. Uten KI virker alt, bare med flere spørsmål: 129 mot 29 på de ti testhusene.

## Status etter runde 1

Sluttkontrollen etter fase C (2026-10-22) ga 29 av 30 «Ferdig betyr»-mål og 1786 av 1793 sjekker i Node-testene. Runde 1
er altså nesten, men ikke helt, ferdig etter sin egen definisjon (se «Sluttkontrollen»).

**Det som virker:**
- «Generer» bygger alle ti testhusene, med og uten KI. Alle 20 husfilene har 0 feil i spillets validator.
- Med KI er målestokken innen 2 % på alle 12 etasjene der fasiten har en, og innen 0,3 % på hus1, hus2, hus3 og hus5.
- Dobbeltdører, skyvedører og takvinduer stemmer med fasiten på hus1, hus2, hus3, hus5 og den skannede hus6.
- Spillets egen figur (`PlayerController`) går trappa opp og ned i hus1, hus3, hus4 og hus9, med og uten KI (31–44°).
- Med KI blir det 1–6 spørsmål per hus, 29 i alt, og 15 av dem er takhøyden.

**Det som ikke virker:**
- **hus8:** trappa som finnes, er for bratt for husformatet (64°). Den bygges ikke, så kjelleren nås ikke til fots før
  motoren får kvartsvingte trapper (forespørsel 9).
- **hus7 uten KI** er et tomt hus: skalaen er −60 %, og veggene er tegnet som to tynne streker.
- **hus2:** BOD-nisjen er åpen mot ENTRÉ langs en strek-prikk-linje som gjenkjenningen ikke finner, så den slås sammen
  med GANG og ENTRÉ.
  Det er det ene «Ferdig betyr»-målet som ikke er nådd (12 av 17 rom med navn i eget rom).
- **De ferske KI-svarene:** på hus6 havner navnet ENTRE i vaskerommet, og på hus1 kommer et unødvendig trappespørsmål.
  Begge skyldes `generate.js` (se «Åpne oppgaver»).
- **Røde testpakker:** `test-planbygger-build3d.mjs` 200 av 203 og `test-planbygger-generate.mjs` 302 av 306, av
  grunnene over.
- **Uten KI** får ingen rom navn, og hus6 og hus7 får feil målestokk (−47 og −60 %, men den spørres om).
- **Motoren mangler** dobbeltdører, skyvedører, takvinduer, kvartsvingte trapper og skrå himling (forespørsel 7–10).
- **KI-ruta er ikke montert i `server.mjs`**, så på nettet går «Generer» uten KI.

**Det eieren bør teste først** (lokalt, se «Prøv den»; KI krever nøkkelen i miljøet):
1. **hus3** (`1etg.png`, `2etg.png`, `fasader.png`) uten KI: «Generer», «Neste» gjennom 13 kort, og gå opp trappa i 3D.
   Med KI blir det 2 kort.
2. **hus1** (alle seks filene): to etasjer, to dobbeltdører, en skyvedør og 4 takvinduer. Den kvartsvingte trappa blir
   en U-trapp.
3. **hus6** (`plan-1etg-tilbygg.pdf`, skannet): den skrå veggen i tilbygget, seks skyvedører og fem rom. Se hvor navnet
   på entreen havner.
4. **hus8** (alle tre JPG-ene): trappespørsmålet som sier at trappa er for bratt, med «Ingen trapp» som standardsvar.
5. **En egen plan** med «Bare én plan …», rettet i «Finjuster».

## Prøv den

```
npx vite --config tools/planbygger-vite.config.mjs --port 5270
```

Åpne `http://127.0.0.1:5270/planbygger.html`.

- **«Generer»:** slipp alle filene i én av mappene under `plantegninger/` på startsiden «Slipp alle tegningene her».
  Trykk «Generer», svar på kortene eller trykk «Hopp over resten», og huset åpnes i 3D.
- **KI:** testserveren svarer på `/api/planbygger/ai` når `ANTHROPIC_API_KEY` er satt i miljøet og SDK-en er
  installert i KI-serverens egen mappe (`npm ci --prefix server/planbygger-ai`, aldri i roten). Ellers sier stabelen
  at KI er av, og «Generer» går uten.
- **v1, én plan:** «Prøv med eksempelplanen» (`plantegning.png`). Klikk på målelinja «12.21 m» til høyre, skriv
  `12,21`, og trykk Enter. Rett forslaget, og trykk «Gå rundt i 3D». «Bare én plan …» gjør det samme med en egen fil.

`npm run build` tar med siden (`dist/planbygger.html`), og `server.mjs` serverer den bak samme innlogging som spillet.

## Runde 1: «Generer»

### Flyten på siden

1. **Slipp tegningene** (`stack.js`, `decodeFile`): PNG, JPG, WebP, AVIF og PDF, mange filer på én gang.
   - Bildene leses med EXIF-retningen (`createImageBitmap(file, { imageOrientation: 'from-image' })`), så et mobilfoto
     står riktig. En JPEG gir også brennvidden (`FocalLengthIn35mmFilm` / 43,27) videre til `rectifyPhoto`.
   - **PDF:** hver side blir en tegning. En skannet side gjengis i skannets egen oppløsning, opptil 6000 px, så
     nettleseren får det samme bildet som Node-testene (hus7: 4771 × 3332 px). En vektorside gjengis med 200 dpi, høyst
     4000 px. `pdfPage: { widthPt, heightPt, widthPx, heightPx }` går til målestokken. pdf.js hentes fra jsDelivr først
     når noen åpner en PDF.
   - **Flere sider** leses lat: et miniatyrbilde og en analyse ved 2000 px per side. Ved «Generer» gjengis bare sidene
     som brukes, i full størrelse, og slippes etterpå. Høyst 40 sider tas med, og stabelen sier fra om resten.
2. **Stabelen** (`stack.js`): etasjene med miniatyr, øverste etasje øverst, og fasadene og «Annet» ved siden av.
   - Merkelappen (Etasje, Fasade eller Annet) kommer fra `splitSheet` og `isPhoto` i arbeideren. Et ark med flere
     tegninger sier «Arket har 4 tegninger … – de deles opp». «Annet» tas ikke med.
   - Kortet sier hvorfor tegningen står der, for eksempel «2. etasje fra filnavnet».
   - Et kort kan dras til ny plass («plassert av deg»), og rekkefølgen går til `generate` som `input.level`. En
     merkelapp kunden har endret, går som `input.kind`. Begge vinner over filnavn, `sheet.js` og KI.
   - Er KI på, står det at en nedskalert kopi av tegningene sendes til KI-tjenesten.
3. **«Generer»** (`generate.js`) med fremdrift: en stolpe, steget som pågår og de siste stegene.
4. **Veiviseren** (`guide.js`): ett kort per spørsmål, med et utsnitt av tegningen, spørsmålet, hjelpeteksten,
   sikkerheten («Sikker», «Ganske sikker», «Usikker») og et ferdig utfylt svar. Knappene er «Tilbake», «Hopp over
   resten» (beholder de utfylte svarene) og «Neste» (Enter). Til `applyAnswers` går svarene som er endret, og rommene
   kunden har sett. Velger kunden den andre av to alternative tegninger, eller et nytt foto, kjøres «Generer» på nytt.
5. **Rett i 3D.** «Finjuster» åpner v1-editoren på det genererte dokumentet med tegningene som bakgrunn, og
   «Tegningene» går tilbake til stabelen. «Fortsett med …» virker også for et generert hus.

**Editoren** bruker `OPENING_KINDS` og `setOpeningKind` (`model.js`): Dør, Dobbeltdør, Skyvedør, Vindu og Åpning uten
dør. En dobbeltdør tegnes med to buer (`leaf` og `leaf2`), en skyvedør med to forskjøvne blad og en dobbel pil, uten
«Åpningsvinkel» og «Snu hengselen». Takvinduer tegnes stiplet med kryss, og skillelinjer som strek-prikk-linjer. De to
siste kan ikke redigeres ennå.

**I arbeideren** (`worker.js`) kjøres de tunge stegene gjennom `opts.exec`: `rectifyPhoto`, `splitSheet`,
`cleanForWalls`, `detectPlan`, `autoScale`, `readFacade` og `findStairs`. Arbeideren sender bare rene data tilbake
(`{ walls, openings, skylights, stairs, separators, stats }`), og med den gir alle ti husene det samme som de direkte
kallene (målt i fase B). `alignLevelTo` og kontrollen kjører fortsatt på hovedtråden: 1,5–2,3 s per hus.

### Stegene i «Generer»

`generate(inputs, opts) → { doc, questions, report, images }`. `inputs` er `[{ name, img, pdfPage?, focal?, kind?,
level? }]`. `opts.ai` er KI-en eller `null`, og `report` sier hvilken metode hvert steg brukte og hvor sikker den er.

1. **Fotoer** går gjennom `rectifyPhoto`, som avslår digitale tegninger selv. Et usikkert foto blir et spørsmål om et
   nytt bilde, og et ark som går ut av bildet, et spørsmål om formen.
2. **Ark med flere tegninger** deles med `splitSheet` og `cropImage`. KI-svaret `classify` avgjør fasade eller snitt,
   og gir titler, etasjenavn og om en plan er en egen bygning (en garasje ved siden av huset).
3. **Like tegninger** brukes én gang, med et notat (hus8 har de samme planene på ett ark og hver for seg), med mindre
   navnene sier ulike etasjer. En liten plan ved siden av huset tas ikke med. «…-alternativ» blir et valg (hus9).
4. **Per plan:** en foreløpig skala (`autoScale` uten KI, eller arvet fra en sikrere etasje i samme tegnesett) →
   merker (`marks.js`) og `readPlan` → `estimateScale` med KI-svaret, PDF-siden, BRA og de andre etasjene (flytter
   skalaen seg mer enn 4 %, kjøres `autoScale` på nytt) → `detectPlan` på den endelige skalaen med `clean: true` →
   semantikken: romnavn og -typer (KI-punktene legges i rommene som ble funnet), dørvarianter, takvinduer og trapper.
   Rommene er alltid etasjens rom slik husfila ser dem: delt av skillelinjene og med øyene skåret ut (`levelRooms`).
   Planer fra ulike tegnesett måles side om side, så KI-svarene kommer samtidig.
5. **Etasjene ordnes:** filnavn, så titler (KI), så innhold (inngang og kjøkken gir hovedetasjen, takvinduer øverste
   etasje og kjellerord nederste).
6. **Etasjene legges oppå hverandre** med `alignLevelTo` og plantegningene, og en trapp legges inn der begge etasjene
   viser den. Halvsvingt og kvartsvingt blir U-trapp, kvartsvingt med et notat. Fra fase C:
   - `orientStair` velger veien ned som har gulv i begge ender, målt et skritt (0,35 m) ut av trappa, også gjennom en
     dør. En U-trapp prøves med det øverste løpet på begge sider. Uten noen slik vei blir det et spørsmål.
   - Tynne streker (opptil 8 cm, uten åpninger) på tvers inne i en trapp som etasjen selv viser, er trinn og tas bort
     (`dropTreadLines`). En strek langs enden av trappa i etasjen over tas bort bare når den stenger trappas eneste
     landing (`stairEndLines`).
   - En trapp brattere enn figuren går (51,7°, `STAIR_MAX_SLOPE_DEG` fra `WALKABLE_NORMAL_Y`), bygges ikke. Den blir et
     spørsmål med grunnen og «Ingen trapp» som standardsvar, og «Rett trapp» eller «U-trapp» setter den inn igjen.
7. **Fasadene** gir takformen (`houseRoof`) og brystning og høyde per etasje til vinduene (`facade.js`). Fasader fra
   samme ark deler skalaen fra den sikreste dørlesningen. Uten fasader får vinduene standardhøyder per romtype.
8. **Kontrollen:** huset eksporteres og valideres med spillets `validateHouse`. `generate` retter og noterer det den
   kan: slagretning og hengsel på dører (D6), en åpning oppå en annen, vegglinjer som skifter tykkelse med noen
   millimeter, og en vegg funnet to ganger noen centimeter fra hverandre (bare når det gir færre feil).
9. **Spørsmålene** lages (`questions.js`).

**Regler som kom etter målingene i fase B:**

- **Samme tegnesett.** Bare to tegninger fra samme ark, eller to bilder med lik størrelse og stil (`similarSource`),
  arver målestokken direkte. Med ulik bildestørrelse arves den bare når omrisset av huset stemmer (likt, eller én
  zoomfaktor), ellers blir den et spørsmål. Grunnen er hus9, der filene har ulik skala (45,4 og 54,1 px/m): med arv ble
  «Øvre etasje» +17 % med 5 vegger og 0 rom.
- **Tomme etasjer** måles på nytt for seg, så uten rydding, så som konturlinjer (to tynne streker per vegg fylles, en
  åpen side med garasjeporter lukkes med en vegg og en åpning), og til sist med den foreløpige gjenkjenningen. Er
  etasjen fortsatt tom, kommer spørsmålet «walls» og et notat om å tegne den i «Finjuster». hus7 med KI får slik ett rom
  på 30 m² med porten som én åpning på 5,2 m.
- **KI-dørene.** KI-en bestemmer varianten bare der den klassiske lesningen er svakest: en slagdør på minst 1,05 m som
  KI-en kaller dobbeltdør, og en åpning i en innervegg som KI-en kaller skyvedør. Alle andre endringer KI-en ville
  gjort, ga feil antall på hus2, hus3 og hus5.
- **KI-kallene.** Høyst 3 svar ventes på samtidig (`opts.aiConcurrency`), og hvert arks `classify` sendes mens de neste
  arkene deles. Med 6,6 s per kall gikk hus1 fra 61 til 35 s og hus4 fra 79 til 53 s (simulert).
- **Robusthet.** Et KI-svar som `{}`, eller en utfører som gir `null`, krasjer ikke. To filer med samme navn får hvert
  sitt navn. Navn som «GARASJE 30,25» blir navn og areal. Et merke i parentes, som «(G)» for en garderobe, er ikke et
  romnavn når rommet også har et ekte navn (fase C).

### Spørsmålene

Hvert spørsmål har et utsnitt, en tekst på norsk, et ferdig utfylt svar og en sikkerhet. `applyAnswers(doc,
questions, answers)` endrer bare det som avviker fra svaret som allerede står i dokumentet.

| Type | Når | Svar |
|---|---|---|
| `scale` | målestokken kommer fra standardmål, har lav sikkerhet, eller er arvet uten at omrisset stemmer | husets ytre bredde i meter |
| `bra` | det samme, men tegningen har ingen mål eller arealer (hus8) | BRA i m² |
| `ceiling` | alltid, én per etasje; himlingstekster som «SKRÅ HIMLING 24°» står som hjelp | takhøyden (standard 2,4 m) |
| `windows` | ingen fasader | brystning og høyde |
| `room` | et rom over 2 m² uten navn fra tegningen (uten KI: alle) | navn og type, med typen gjettet |
| `stair` | typen er usikker eller KI-en er uenig med tegningen; trappa går over en vegg, har ikke noe rom under eller ingen vei med gulv i begge ender; den er for bratt (standardsvar «ingen»); eller bare KI-en ser den | rett, U eller ingen |
| `order` | rekkefølgen er usikker | etasjene nedenfra og opp |
| `alternative` | to alternative tegninger av samme etasje | hvilken (kjører «Generer» på nytt) |
| `photo`, `shape` | usikkert foto, eller arket går ut av bildet | nytt bilde, eller bekreft formen |
| `facade` | fasaden har bare vegghøyden som skala | vegghøyden fra bakken til takfoten |
| `walls` | en etasje uten vegger eller rom | ikke noe svar: etasjen tegnes i «Finjuster» |

`guide.js` mangler foreløpig overskriften for `walls` (`KIND_TITLE.walls = 'Vegger'`), så kortet står uten type.

### Målt i nettleseren

`tools/test-planbygger-browser.mjs --lock` kjører «Generer» på hus3 ende til ende. Etter fase C: 51 av 51 (del 0–10
og 12).

| | hus3 uten KI | hus3 med opptakene |
|---|---|---|
| «Generer» | 13,6 s | 15,2 s |
| Spørsmål | 13 (skala 2, takhøyde 2, rom 9) | 2 (takhøyde 2) |
| 3D | 2 etasjer, 0 feil, 5 advarsler, 106 kolliderere | 2 etasjer, 0 feil, 6 advarsler, 107 kolliderere |
| Gikk med W i 1,2 s | 2,65 m | 2,65 m |
| Skala fra rommene | | +0,5 % i 1. etasje, 0,0 % i 2. etasje |
| Rommene i 1. etasje | Stue, Entré, Bod | Kjøkken/stue + Entré, Vask, WC/D |

- **Opptakene** spilles av gjennom testserverens KI-rute, og sidens egen `ai.js` brukes uendret (skalerer ned, lager
  PNG, sender og rydder svaret). På hus3 hadde alle 5 kallene nøyaktig samme bilde som opptaket.
- **Alle ti husene** (`--only=hus`) er sist kjørt i fase B: 60 av 62. hus7 uten KI var tomt, og hus9 med opptakene hadde
  1 feil i validatoren med JPEG-ene slik Edge dekoder dem (Node hadde 0). Gjenkjenningen er altså følsom for
  JPEG-dekoderen. `MAX_ERRORS` i testen godtar fortsatt 2 feil på hus1 og 11 på hus2, mens Node nå måler 0.
- En skannet PDF-side gjengis som det samme bildet som Node-testene leser (snittavvik 0,01–0,02 grånivåer).
- **Gåing** er bevist i nettleseren på hus3, og i Node i alle trappene som bygges (se «3D»).

## Flyten med én plan (v1)

Dette er «Prøv med eksempelplanen» og «Bare én plan …» på startsiden, og editoren bak «Finjuster».

1. **Last opp** PNG, JPG, WebP eller PDF (første side, med pdf.js fra jsDelivr). En skjev plan rettes opp med en gang
   (se «Gjenkjenningen», steg 0), og vinkelen står i etasjepanelet («Rotasjon», med «Rett opp»).
2. **Skala.** Kunden klikker på en målelinje. Linja festes til endene sine, også over tekstboksen midt på
   (`scale.js traceLine`), og kunden skriver bare inn tallet. To vilkårlige punkter går også. «Foreslå automatisk»
   antar at den tynneste vanlige veggen er 10 cm og at medianen av dørhullene er 90 cm. Forslaget bommet med +1,8 % på
   1. etasje og −0,5 % på kjelleren, og vises som en 2 m lang linje kunden kan sjekke.
3. **Gjenkjenning** (`detect.js`, i en Web Worker): 0,3–0,5 s på små planer og 1–2 s på store (hus4, hus7).
4. **Retting** i 2D-editoren (`editor.js`). Rommene regnes ut på nytt etter hver endring.
5. **Etasjer og trapp.** «+ Etasje» legger til en etasje med egen plantegning, skala og gulvhøyde. «Juster ytterhjørnet
   mot hovedetasjen» (NØ, NV, SØ, SV) legger ytterflatene i flukt (avstemming V1). Trappeverktøyet (T) tegner en rett
   trapp eller en U-trapp (spillets `half-turn-winder`) ned til etasjen under: du drar hullet fra toppen mot foten,
   hjørnene festes til veggflatene, og opptrinn og rekkverk regnes ut. Dører har en åpningsvinkel. Gangdøra i eierens
   hus må stå på 180° (D6), ellers gir validatoren under 0,75 m fri bredde mot trapperekkverket.
6. **3D** (`viewer.js`) med spillets egne byggere, ovenfra som et dukkehus eller til fots. Dørene åpnes med E eller et
   klikk.
7. **Last ned** «Husfil» (formatet i `research/house/NN-*.json`) eller «Prosjektet» (dokumentet med plantegningene).
   Dokumentet lagres også i nettleseren (localStorage, og bildene i IndexedDB).

## Gjenkjenningen: klassisk bildebehandling

Alle konstantene står i `DETECT_DEFAULTS` i `src/planbygger/detect.js`. Et mål i meter blir piksler gjennom skalaen.

0. **Skjeve planer** (`estimateSkew`). Vinkelen er den der de mørke pikslene hoper seg opp i færrest rader og kolonner
   (projeksjonsprofiler, søkt over ±10° i steg på 0,5° og så 0,05°). Bildet dreies tilbake bilineært før alt annet
   (`rotateImage`). Planer dreid opptil 6° begge veier fikk vinkelen eksakt (± 0,05°) og de samme veggene, dørene og
   vinduene, under 0,3 cm fra den rette planen. Perspektiv rettes ikke her, men i `photo.js`.
1. **Gråtoner og blekkmaske.** Terskelen ligger i den første dalen etter det svarte toppunktet i histogrammet (11 på
   1. etasje, 12 i kjelleren), så grå møbler, benker og skravur ikke blir vegg. På en kopi vi selv har skalert opp
   (under 50 px/m) brukes den dypeste dalen (87 ved 35 px/m).
   - **Grå vegger:** finner den svarte terskelen nesten ingen vegger, prøves toppene i histogrammet som et grått bånd,
     og båndet med flest lange veggløp vinner (`autoWallTone`). Grå vegger på 70, 115 og 150 finnes på de syntetiske
     planene. I etasjepanelet kan kunden også velge «Veggfarge – Velg» og klikke på en vegg (båndet −25/+20).
2. **Åpning med et lite kvadrat** (3×3 ved 50 px/m). Strøk tynnere enn den tynneste veggen forsvinner (tekst,
   mållinjer, dørbuer og vinduslinjer), og klumper under 12 cm fjernes. Planer under 50 px/m tolkes på en oppskalert
   kopi (2–3×), ellers ville en vegg på 10 cm (3,5 px) forsvinne. 1. etasje i 2× og 4× oppløsning (7,5 MP) gir samme
   resultat på 0,5–1,7 s. Splinter kortere enn 60 % av veggtykkelsen fjernes.
3. **Lange løp per akse.** Løp lengre enn den tykkeste veggen (0,5 m) blir veggbiter langs aksen. Korte stubber
   beholdes når de ligger i båndet til en vegglinje, eller står på flaten av en vegg på tvers. Skrå vegger finnes fra
   fase C i et eget steg (`slantedWalls`, under).
4. **Rektangler med subpikselpresisjon.** Hver bit deles der utstrekningen på tvers endrer seg. Senter og tykkelse
   regnes ut ved å integrere mørkheten på tvers, målt mot den mørkeste siden, så en grå benk inntil veggen ikke gjør
   den tykkere. 1. etasje får 0,10 og 0,16 m, som tegnet.
5. **Sammenslåing og skjøter.** Kolineære biter med samme bånd slås sammen. En vegglinje som skifter tykkelse, blir to
   vegger ende mot ende. Frie ender festes inn i en vegg på tvers: L-, T- og X-skjøter.
6. **Hull i veggene** mellom kolineære biter, og fra en fri ende til neste vegg:
   - **Søyler** (kolonner mørke på tvers av hele veggen) deler hullet.
   - **Dør:** en kvartsirkel av tynne, mørke prikker, søkt fra hengselpunkter langs hullet i begge retninger og på begge
     sider, med radius 0,55–1,05 m. Hvert punkt på buen må være en tynn strek med papir på begge sider, og en bue
     gjennom vegg er umulig. Minst 60 % av buen må være tegnet: ekte dører fikk 0,92–1,0, de beste feiltreffene 0,46.
     Resten av hullet blir sidefelt (vindu) hvis det er over 30 cm.
   - **Vindu eller åpning:** linjer langs veggen i båndet gir vindu i en yttervegg og åpning i en innervegg. Et hull med
     linjer kan være opptil 14 m (glassvegger og vindusrekker).
   - **Tomme hull** under 1,3 m blir en åpning, men bare når biten henger fast i veggnettet i den andre enden, så et
     bord ved en vegg ikke vokser inn i den.
7. **Nettverk og ytterside.** Vegger utenfor hovednettverket fjernes (møbler, tekst). Yttervegger finnes ved å
   flomfylle papiret fra bildekanten med veggene lukket.

Uten KI kan romnavn ikke leses (det finnes ingen OCR), så romtypen gjettes med regler (`guessKind` i `export.js`): det
største rommet er stue, et lite rom med ytterdør entré, et rom med minst tre dører eller åpninger gang, uten vindu og
under 12 m² bod, under 7 m² bad, og resten soverom. Det ga riktig type for 11 av 12 rom i eierens hus, og for 29 av de
56 rommene «Generer» finner uten KI på de ti testhusene. Navnene vises med «?» til kunden har bekreftet dem.

### Nytt i runde 1: dørvarianter, takvinduer, trapper og rydding

**Dørvarianter.** `openings[].variant` er `'single'`, `'double'` eller `'sliding'`, og følger med i dokumentet
(`variant`, `leaf2`).
- **Dobbeltdør:** to buer med samme slagside fra hver sin karm, med spisser som møtes innen 15 cm. Smale blad under
  `doorMin` får et eget søk med halv bredde.
- **Skyvedør:** tynne linjer langs veggen som dekker 25–80 % av hullet fra én karm, eller to forskjøvne blad fra hver
  sin karm. Et blad må være minst 35 cm: ekte blad ble målt til 0,41–1,31 m, de falske til 0,18–0,34 m (et teppe, et
  badekar, en åpen passasje). Fase C la til blad på forskjøvne spor i en glassvegg og skyvedører i lomme.

**Takvinduer.** `skylights: [{ x0, y0, x1, y1 }]` er stiplede rektangler inne i rom: 0,5–1,5 × 0,6–1,8 m, minst tre av
de fire sidene tegnet og ikke inntil en vegg. hus1 2. etasje gir 3 av 4 uten KI og 4 av 4 med KI.

**Trapper.** `stairs: [{ bbox, axis, treads, kind }]`.
- **Løp:** minst fire jevnt fordelte, parallelle tynne linjer, 60–170 cm lange og 14–40 cm fra hverandre.
- **Svingtrinn** er linjer som går ut fra ett punkt, også skrå linjer på 1 px som blir prikker. Stemmerutene ligger fast
  på bildet (fase C), så de ikke flytter seg når boksen for symbolene endres.
- **Typen** bestemmes av løpene først: to løp side om side er halvsvingt, to i rett vinkel kvartsvingt, og svingtrinn i
  begge ender av ett løp halvsvingt (hus6). Uten slike løp avgjør vifta.
- **Rundt et smalt øye** der hvert trinn er et svingtrinn (hus4): øyet er et vindu på 0,5 × 1,6 m som holder den indre
  enden av minst 8 lange skrå streker i 6 retninger. Minst 3 linjer til hver side gir halvsvingt.

**Ikke vegger.** Stiplede linjer (takkant, «Plan himling», bjelker), fliser og rutenett utenfor huset, og gulvskravur
blir aldri vegg- eller vinduslinjer (tregulvskravuren i hus4 gir 0 vegger). To halvdeler som ligger flate mot
hverandre, er én vegg, og linjer i et hull under 0,6 m i en innervegg er noe montert på veggen (el-skapet mellom hall og
bod i hus1).

**Svake buer over tegnede vinduer** (hus8 tegner dørbåndet som et vindu): en bue under 75 % (under 85 % uten blad) er
en dør bare når døra fyller hullet, og bladet eller minst 80 % av buen er tegnet. Lenestoler (hus5), en kryssboks
(hus2), et dusjkar (hus9) og en trapp (hus1) blir dermed ikke dører.

**Rydding.** `detectPlan(img, { clean: true })` kjører `cleanForWalls` (`clean.js`) først, i bildets egen oppløsning.
«Generer» sender alltid `clean: true`, mens `DETECT_DEFAULTS.clean` fortsatt er `false`, så v1 og testene står stille.
Uten rydding gir hus4 2. etasje, hus6 og hus9 nesten ingenting.

**Fart.** Symbolene søkes bare i boksen rundt rommene, grå vegger prøves først, og buetesten stopper når resten av
punktene ikke kan nå 45 %. Fase A tok 0,4–1,8 s per plan uten rydding (hus2 0,97 → 0,83 s, hus4 1. etasje 2,35 →
1,83 s), men fotoet gikk fra 0,67 til 1,04 s, fordi buesøket bruker 0,5 s i sju lange glassfelt i støyet. Ryddingen
legger til 0,15–0,6 s per megapiksel. Med rydding tok en plan 0,6–4,4 s i én kjøring i fase C (hus6 fra
fargeoriginalen er tregest).

### Nytt i runde 1: skillelinjer mellom åpne soner

En åpen plan har ofte en strek-prikk-linje der to soner møtes (TV-stue og entré i hus4). Det er ikke en vegg.

- **Kontrakten:** `detect.js` gir `separators: [{ a, b }]` i piksler, `model.js` gir `level.separators` i meter
  (`rescaleLevel` skalerer dem), og `regions.js` deler rommene med `findRooms(walls, { separators })` eller
  `levelRooms(level)`. Romkanten langs en skillelinje har `wall: null`, `side: 0` og `separator: id`.
- **Metoden:** veggbåndet leses kolonne for kolonne i hull lengre enn en passasje (1,3 m). Den mørkeste pikselen må
  stige over midten mellom blekk og papir minst 3 ganger og 3 ganger per meter, med streker på høyst 60 cm og brudd på
  høyst 20 cm. Under ca. 45 px/m er det åpne hullet selv kandidaten. Uten grensene slo regelen til på en flislagt
  WC-vegg (hus2), på en dør og et vindu i hus4 og på skannestøy (hus6).
- **Målt:** på den syntetiske åpne planen ved 35–120 px/m, med og uten rydding. hus4 1. etasje: TV-stua og Entré + gang
  blir to rom. hus9 øvre etasje: kanten av Halls flisgulv leses som en stiplet linje, og Hall blir eget rom (9,06 m²,
  fasit 9,07). Ingen andre hus fikk skillelinjer.
- **I bruk fra fase C:** `generate.js`, `export.js`, `autoscale.js` og `tools/planbygger-ai-record.mjs` lager rommene
  med `levelRooms(L)`, så delingen når «Generer», husfila og 3D-huset. Kunden kan ikke redigere dem i editoren ennå.

### Nytt i runde 1: hus9 og falske skyvedører (fase B)

Da vinduene i hus9s lysegrå vegger ble funnet, gikk ytterveggen hel gjennom, og tre feil ble rettet. Et tomt hull,
eller en «skyvedør» med ett blad, kobles bare til en bit som henger på husets veggnett (minst 12 % av det lengste), så
rammen rundt teppet i Barnesov og en dynekant i Voksensov faller bort. Skyvedørblad under 35 cm er borte. En svak bue
uten blad over et bånd med linjer er en dør bare når den fyller hele hullet (blomstene på teppet i alternativet). Det
gjenstår en bit på 0,8 m² ved trappa i underetasjen, en falsk skyvedør på skapet ved trappa i øvre etasje (517, 251),
og den ekte skyvedøra i vestveggen der finnes som et vindu.

### Nytt i fase C: sammenslåtte rom, grå vegger, hus6, skrå vegger og fotoet

Målt med `detectPlan(img, { pxPerM, clean: true })` på fasitskalaen og med «Generer» på alle husene. «Før» er commit
c71f792 (fase B).

**Sammenslåtte rom.** Hvert rom der to etiketter havnet sammen, er sjekket mot tegningen. To var ekte feil:
- **hus3 2. etasje, BAD + BOD.** Veggen mellom dem, gulvveggen under badet og en innkasset sjakt på 0,54 m hang sammen
  i én blokk, og `rectanglesOf` tok utstrekningen fra første til siste blekkpiksel i hver kolonne (en «vegg» på 2,7 m,
  forkastet). Nå følges hvert løp i en kolonne for seg når de til sammen er tykkere enn en vegg, og en vegg som flukter
  med en side av en tykk blokk, går videre gjennom den. BOD blir 1,77 m² (etikett 1,7), BAD 12,30 (12,0), og 7 rom.
- **hus4 2. etasje, W.I.C + Stue/kjøkken.** Badveggen stopper 1 px utenfor senterlinja til en stubb, og regelen for frie
  ender krevde at den krysset senterlinja. Nå holder det å krysse båndet: W.I.C 5,52 m² (5,6), Sov 10,16 (10,3) og Bad
  4,63 (4,6).

De andre er åpne planer der fasiten selv sier at ingenting er tegnet mellom sonene: hus1 2. etasje, hus2, hus3 og
hus3-foto 1. etasje, hus3 2. etasje, hus5, hus6 og hus8 1. etasje (se `OPEN_PLANS` under «Testene»). To ekte
sammenslåinger står igjen: i hus8 kjeller blir de to BOD-ene ett rom på 62 m², fordi pipa mellom dem (x 564–603,
y 897–952 px) ikke leses som vegg, og i hus2 er BOD trolig nisjen under WC/D (x 373–443, y 696–728 px), åpen mot ENTRÉ
langs en strek-prikk-linje (y ≈ 729) som gjenkjenningen ikke finner.

**Grå vegger med svarte konturer (hus4).** Veggtonens bånd (143–211) var bare fyllet, og konturene (0–110) lå utenfor:
en innervegg på 0,14 m ble 10 px av 17, og rommene ble 7–12 % for store. Nå følger `outlinedFaces` pikslene utenfor hver
flate så lenge de er veggmørke (høyst 0,1 m), og flytter flaten når gangen har passert noe mørkere enn båndet (en
kontur, ikke et grått gulv). Rommene i 1. etasje ved 120,7 px/m: Sov 7,5 8,09 → 7,46 m², Sov 9,3 9,95 → 9,20, Sov 8,1
8,71 → 8,03, Vask. 6,4 7,17 → 6,45, Bad 4,3 4,74 → 4,22 og Sportsbod 5,7 5,87 → 5,56. Avviket er −2,5 til +0,8 % (før
+3 til +12 %), og veggene er 0,14 og 0,27 m som tegnet. I «Generer» med KI gir arealene 120,2 px/m i begge etasjer
(−0,4 og −0,7 %, før +3,7 og +3,4 %).

**hus6, den skannede arkitekttegningen**, ble rettet i to runder. Den andre målte etter hva 3D-huset får: etter den
første hadde «Generer» fortsatt 3 rom, og 12 av 21 åpninger ble hoppet over fordi de ikke stod på noen romvegg.
1. **Skraverte vegger** (`clean.js`): strekene er 140–160 på 255, og terskelen brøt dem i prikker, så fyllet ble
   flekkete med doble vegger. Nå er `hatchInk` 60 og `hatchClose` 5 (før 70 og 3), og fyllet vokser ut til konturene
   (`growToOutlines`), også i hjørnene der muren trekkes inn (blokkene der er 100 og 95 % blekk, før 72 %).
2. **Trinn i en vegglinje:** der to deler av en vegglinje overlapper, blir blokken en kort vegg på tvers (77–80 px/m).
3. **Glassvegger med skyvefelt** (`slidingLeaf`): to blad på minst 0,6 m på hver sin rad, som overlapper delvis og
   når minst 20 cm forbi hverandre. En skyvedør over 3,6 m i et bånd med streker må ha slike forskjøvne blad (ellers ble
   bjelken i hus4 2. etasje en falsk skyvedør på 5,59 m).
4. **Stuas vestvegg ble ett vindu på 6,8 m:** et par kan nå bare gå over en tynnere bit i samme bånd når hullet er
   veggmørkt, og aldri med en åpning over den.
5. **Skyvedører i lomme:** (c) entré–stue er tegnet lukket, med bladet inn i en hul lomme, og blir en skyvedør på
   1,00 m med lomma som vegg. (d) WC–vaskerom er halvt åpen: døra er hullet utenom lomma, 0,90 m (fasit ca. 0,8; før en
   åpning på 1,85 m).
6. **SPISESTUE og nisjen over kjellernedgangen:** et hjørne på 0,42 × 0,42 m i én blekkblokk deles i armene, så
   vinduene nr. 2 og 3 finnes og KJØKKEN/SPISESTUE er lukket.
7. **Etiketter i bokser** over vaskeromsveggen: linjer med blekk mellom seg (over 25 %) er vegg, ikke vindu.
8. **Falske dører:** en svak bue der linjene går videre under og ved siden av, er vinduet (sofaen i STUE 2), og en dør
   med buens midtpunkt inne i en trapp er det båndet viser (en åpning på 1,07 m mot reposet i entreen).
9. **Den skrå veggen i tilbygget** (`slantedWalls`, ny): to frie vegg-ender med et tegnet bånd mellom seg på skrå
   (15–75°) blir én vegg med `axis: 'd'`. Båndet må ha blekk 90 % av veien og to streker på tvers 60 % av veien, og ikke
   krysse en vegg. Glassfeltet (f) blir en skyvedør på 4,43 m (fasit 4,4), og STUE 2 et lukket rom på 23,9 m² (23,4).

| hus6 (PNG ved 78,6–79,0 px/m og fargeoriginalen) | Før | Etter første runde | Nå | Fasit |
|---|---|---|---|---|
| Vinduer | 16 | 9 (5 ekte) | 9: alle 8 + sidefeltet | 8 |
| Dører enkel/dobbel/skyve | 6/0/3 (fargeoriginalen 5/0/3) | 5/0/4 | 2/0/6 | 2/0/6 |
| Rom etter veggene | 3 | 3 | 5 | 7 etiketter, 5 rom |

- **Rommene:** STUE + SPISESTUE + KJØKKEN 79,8 m² (etikettene 83; fasiten sier selv at de er ett åpent rom), STUE 2
  23,9, ENTRE 17,5, VASKEROM 6,0 og WC 3,2.
- **Sidefeltet ved ytterdøra** (0,36 m) er ikke et vindu i fasiten for hus6, men er det i fasitene for hus2, hus3 og
  hus5. Gjenkjenningen behandler dem likt.
- **I 3D-huset med KI:** 5 rom (før 3), 0 av 19 åpninger hoppet over (før 12 av 21), 9 vinduer, 2 dører og 8 åpninger
  (de 6 skyvedørene, passasjen KJØKKEN–STUE og åpningen mot trappa), 78,9 px/m (+0,1 %), 0 feil, og figuren når alle 5
  rommene. Navnene er likevel feil (se «Hva KI-en leser godt og dårlig»). **Uten KI** er skalaen −47 % (standardmål,
  spurt om), og figuren når 3 av 4 rom.

**Mobilfotoet (hus3-foto).** Det opprettede bildet holder veggene. Kameraet brøt de tynne rammelinjene i nordvinduet i
biter, `bandSymbol` leste dem som en stiplet linje, og et langt stiplet hull blir aldri en åpning, så det store rommet
stod åpent ut. Nå er brutte rader der bruddene ikke ligger over hverandre noe sted, tegnede linjer (en stiplet linje har
brudd gjennom hele båndet). Løp som får plass i én veggtykkelse, er én vegg, og en vegg med lengde 0 etter festingen
strykes. Med rydding ved 100,2–102,8 px/m blir det 3 rom (Kjøkken/stue med Entré ca. 63 m², Vask 7,7 og WC/D 4,5–5,0),
5 vinduer (fasit 6) og 7–8 slagdører (7). Før var det 1–2 rom. Over ca. 103 px/m deler inventaret WC/D i småbiter. I
«Generer» med KI: 4 av 4 rom funnet, 3 rom i 3D (før 1), dører 7/0/0 og 5 vinduer.

**Andre planer:**
- **hus1 1. etasje:** skyvedøra i lomme er 0,82 m (hullet 0,80 m). Før var den 1,71 m med lomma.
- **hus4 2. etasje:** den falske slagdøra ved trappefoten (svingtrinnene) er borte, så slagdørene er 4 som i fasiten.
  Bjelken over trapperommet (strek-prikk, y ≈ 456 px) er fortsatt en falsk vegg, nå med én åpning på 5,59 m (før en
  falsk dør og en åpning på 4,49 m). Fasiten sier at trappa er åpen der.
- **hus9 underetasje-alternativet:** Stue og Sone skilles nå av veggen fasiten har (x 364–371). Åpningen i den (fasit
  0,9 m) ligger mest under en svart tegning, blir 0,59 m og strykes (`minPassage` 0,6 m). En falsk vegg på trappepynten
  og en falsk åpning på 2 m over en seng er borte.
- **Uendret:** hus2, hus3, hus5, hus7, hus3-foto og eierens plan har de samme dørene, vinduene og rommene. Ingen plan
  uten skrå vegger får en (testet på hus1, hus2, hus3, hus5, hus8 og hus9).

### Målt per plan

`detectPlan(img, { pxPerM, clean: true })` på fasitskalaen. A er commit ade03bf (fase A), B c71f792 (fase B) og C etter
fase C. Rom er regioner med skillelinjene. Overlegg: `node tools/planbygger-debug.mjs <plan.png> <ut.png> --ppm=…
--clean --rooms`.

| Plan | Dører e/d/s: A → B → C (fasit) | Vinduer: A → B → C (fasit) | Rom: A → B → C (fasit) | Skillelinjer |
|---|---|---|---|---|
| hus1 1. etasje | 4/2/1 → 4/2/1 → 4/2/1 (4/2/1) | 11 → 11 → 11 (11) | 6 → 6 → 6 (6) | 0 |
| hus1 2. etasje | 6/0/0 → 6/0/0 → 6/0/0 (6/0/0) | 6 → 6 → 6 (6) | 6 → 6 → 6 (7) | 0 |
| hus2 | 10/0/5 → 10/0/5 → 10/0/5 (10/0/5) | 12 → 12 → 12 (12) | 14 → 14 → 14 (17) | 0 |
| hus3 1. etasje | 6/0/0 → 6/0/0 → 6/0/0 (7/0/0) | 5 → 5 → 5 (6) | 3 → 3 → 3 (4) | 0 |
| hus3 2. etasje | 2/0/3 → 2/0/3 → 2/0/3 (4/0/3) | 6 → 6 → 6 (6) | 6 → 6 → 7 (8) | 0 |
| hus4 1. etasje | 7/0/1 → 7/0/1 → 7/0/1 (8/0/1) | 7 → 7 → 7 (6) | 7 → 8 → 8 (9) | 1 |
| hus4 2. etasje | 5/0/0 → 5/0/0 → 4/0/0 (4/0/0) | 9 → 9 → 9 (9) | 4 → 4 → 6 (5) | 0 |
| hus5 | 10/0/4 → 10/0/4 → 10/0/4 (10/0/4) | 15 → 15 → 15 (15) | 11 → 11 → 11 (13) | 0 |
| hus6 | 5/0/3 → 5/0/3 → 2/0/6 (2/0/6) | 16 → 16 → 9 (8) | 3 → 3 → 5 (7 etiketter, 5 rom) | 0 |
| hus7 | 0/0/0 (0/0/0) | 0 (0) | 0 (1) | 0 |
| hus8 kjeller | 5/0/0 → 5/0/0 → 5/0/0 (5/0/0) | 4 → 4 → 4 (4) | 6 → 6 → 6 (7) | 0 |
| hus8 1. etasje (36 px/m) | 5/0/0 → 7/0/0 → 7/0/0 (7/0/3) | 10 → 8 → 8 (6) | 9 → 9 → 9 (10) | 0 |
| hus9 øvre | 2/0/2 → 2/0/1 → 2/0/1 (3/0/1) | 9 → 9 → 9 (8) | 7 → 8 → 8 (5) | 1 |
| hus9 underetasje | 2/0/3 → 4/0/0 → 4/0/0 (5/0/0) | 1 → 5 → 5 (6) | 10 → 9 → 9 (7) | 0 |

Dørene på hus1, hus2, hus3 og hus5 står også på riktig sted: dobbeltdørene i hus1 er HALL → STUE og terrassedøra, og
skyvedørene i hus2 (5), hus5 (4) og hus3 2. etasje (3) ligger på fasitens punkter. De to manglende dørene i hus3
2. etasje er tegnet halvt åpne (bladet på 30–45°) og blir åpninger.

Trappene, mot fasiten (overlapp med fasitens boks):

| Plan | Fasit | A | C | |
|---|---|---|---|---|
| hus1 1. etasje | kvartsvingt | kvartsvingt 95 % | kvartsvingt 94 % | ✓ |
| hus1 2. etasje | kvartsvingt | kvartsvingt 39 % | kvartsvingt 85 % | ✓ |
| hus2, hus5, hus7 | ingen | ingen | ingen | ✓ (ingen falsk trapp av skrå tekst eller en skråstilt lenestol) |
| hus3 1. etasje | rett | rett 43 % | rett 87 % | ✓ |
| hus3 2. etasje | rett | rett 89 % | rett 89 % | ✓ |
| hus4 1. etasje | halvsvingt | ingen | halvsvingt 91 % | ✓ |
| hus4 2. etasje | halvsvingt | ingen | halvsvingt 87 % | ✓ |
| hus6 | halvsvingt | rett | halvsvingt 81 % | ✓ |
| hus8 kjeller | kvartsvingt | ingen | ingen | ✗ |
| hus8 1. etasje | rett | ingen | rett 71 % | ✓ |
| hus9 øvre | kvartsvingt | rett 39 % | rett 39 % (51 % ved 50 px/m) | ✗ |
| hus9 underetasje | kvartsvingt | ingen | ingen | ✗ |

De syntetiske planene består ved 40–120 px/m med støy og 3° skjevhet: 9 av 9 åpninger med variant, begge takvinduene,
rett trapp og L-trapp med svingtrinn, og U-trappa rundt et øye (`planbygger-synth.mjs`) som halvsvingt ved 50–120 px/m.

### Begrensninger i gjenkjenningen

- **Rom slått sammen over noe tegnet:** hus8 kjeller (pipa) og hus2 (BOD-nisjen bak strek-prikk-linja).
- **Vegger som to tynne streker** (hus7) leses ikke, og garasjeporter blir ikke åpninger. «Generer» har en reserve.
- **Trappesymbolet som vegger** (hus9): `generate.js` tar strekene bort, men `detect.js` burde ikke lage dem.
- **Falske vegger:** bjelken over trapperommet i hus4 2. etasje; møbler og den indre rammelinja i de hvite vindusfeltene
  i hus9; en kjøkkenlinje i hus9 blir to parallelle vegger (slått sammen i kontrollen).
- **Trapper:** hus8 kjeller er bitteliten (ca. 1,4 × 1,3 m ved 34 px/m) med lysegrå linjer på 1 px, og hus9 tegner
  trappa som skyggelagte tretrinn. Det trenger en annen metode, for eksempel periodisk tekstur. En U-trapp med to rette
  løp får bare løpene (43–61 % overlapp).
- **Halvt åpne dører** blir åpninger (hus3 2. etasje), og terrassedøra i hus8 går tapt ved 36 px/m (bladet ca. 0,53 m,
  under `doorMin`).
- **hus4:** carporten og sportsboden har ytterflater på 18 px mot 31 tegnet (`outlinedFaces` flytter høyst 0,1 m).
- **hus9 underetasje-alternativet:** åpningen mellom Stue og Sone blir 0,59 m og strykes (fasit 0,9 m).
- **Skillelinja i hus9** er en gulvkant, ikke en tegnet strek: regelen godtar også gulvkanter mellom to veggender.
- **Tidskravene i testen** (hus7 og hus6) er det beste av 3 kjøringer, fordi maskinen varierte fra 1,7 til 4,2 s.

## Modulene i runde 1

Hver modul er klassisk bildebehandling, har sin egen test (`tools/test-planbygger-<modul>.mjs`) og ble målt mot
fasiten i fase A og gått gjennom av en kritiker. Tallene er fra fase A med mindre noe annet står. Det «Generer» får
ut av dem samlet, står i «Runde 1: målinger per hus».

### Ark med flere tegninger (`sheet.js`)

`splitSheet(img) → { blocks: [{ bbox, kind, score }] }` deler et ark i blokker: `plan`, `facade`, `section`, `text`
eller `other`. `cropImage(img, bbox, pad)` skjærer ut en blokk.

**Metoden:** blekket (alt tydelig mørkere enn papiret, og lange, tynne linjer i lyst blekk) leses på et arbeidsraster
på ca. 1000 px. Pekelinjer med en prikk i enden kuttes (hus7). Blekket dilateres, komponentene blir blokker, og øyer
inne i en plan slås sammen med planen. Så klassifiseres de:
- **plan:** rom, eller yttervegger som når sidene av blokken;
- **fasade:** en bakkelinje som stikker ut i begge ender, en skrå takkant, eller en bred tegning uten vegger i sidene;
- **snitt:** krever bevis (en skrå takkant med tomt loft under og skårne vegger i begge ender av taket), ellers fasade.

Tegningene måles mot hverandre (et kompass ved en plan blir `other` og hektes på den, en stripe med fasader blir
tegninger selv om hver er liten), og målekjeder, kotelinjaler og små symboler blir med i utsnittet.

**Målt** i egen størrelse og omsamplet 0,5–2×: hus7 gir 4 fasader, 1 snitt og 1 plan fra 1500 til 4771 px; hus8 3, 1
og 2 planer med overlapp ≥ 0,95 (≥ 0,9 omsamplet); fasadearkene til hus2 og hus3 4 fasader ved alle skalaer; og 12
enkeltfasader og 11 enkeltplaner 1 tegning hver (planene med 99–100 % av blekket). Tid: 0,25–0,36 s for 2000 px og
ca. 1 s for skanningen på 16 MP.

**Begrensninger:**
- Testsettet har bare ett ekte snitt (hus7). Et snitt med flatt tak, eller med vegger som enkeltstreker, helt svarte
  eller to streker uten fyll, blir fasade. Derfor avgjør KI-svaret `classify` mellom fasade og snitt når KI finnes.
- En flat boks med vinduer og ingen bakkelinje utenfor blir plan (garasjen i hus8 er nettopp det).
- En målekjede bredere enn huset nederst på en plan kan gjøre den til fasade, og lange, svake skannerstriper kan binde
  sammen tegninger. Ingen av delene er sett i testsettet. Under ca. 1500 px faller hus7.

### Foto av en utskrift (`photo.js`)

`isPhoto(img)` skiller et mobilfoto av en utskrift fra en digital plan. `rectifyPhoto(img, { maxSide = 2400 })` finner
arket, retter opp perspektivet til A-format og jevner ut lyset. Svaret er `{ img, quad, applied, cut, aspect, reason }`:
`cut` er sidene av arket utenfor bildet, og `reason` hvorfor ingenting ble gjort (`'digital'`, `'no-sheet'`,
`'unsure'`).

**Metoden:**
- **Foto eller digital:** andelen rent hvite piksler, hvitt i en ramme langs kanten, metning og mørke i rammen (pulten),
  og hvor flat rammen er. En flat ramme er digital uansett farge (et skjermbilde med svarte felt, en PDF på grått).
- **Arket** finnes på farge (det største lyse, umettede området) eller på kanter (en Hough-transform, på grå eller hvit
  pult). Hver side tilpasses med det lengste rette strekket, så et ark over pultkanten tas fra den flate enden. En side
  utenfor bildet bygges av de tre andre og et hullkamera. To sider utenfor gir `'unsure'`.
- **Kontroller:** heller ingen oppretting enn et galt ark. Hver side må ha papirkant langs minst 40 % av seg, arket må
  ha A-forhold (± 15 %), og hver side må skille papir fra noe annet. Så homografi til A4, forfining med veggenes linjer
  og lysutjevning.

**Målt** på hus3-foto mot hus3 1. etasje (skala fra husets ytre mål), farger / gråtoner: hjørnene innen 2,6 / 3,2 px,
husets form (b/h) 1,0007 / 1,0015, vegger funnet 89 / 93 % med snitt 2,5 / 2,0 cm, og 8 av 11 dører og vinduer med 3 / 5
ekstra. Syntetiske foto gir formfeil ≤ 0,05 % (≤ 0,12 % ved 55–60°, −1,0 til +0,24 % med en side utenfor bildet). Ingen
av de 30 planene, 6 skjermbildene eller de grå skanningene rettes opp. Tid: 1,1–2,1 s per foto i Node.

**Begrensninger:**
- Bare ett ekte foto er testet. Tersklene er satt etter det og syntetiske bilder.
- `isPhoto` kaller en grå, støyete skanning uten rent hvitt et foto (0,62–0,84), men `rectifyPhoto` avslår den.
- Et nærbilde uten synlig arkkant, en pult like lys som papiret og et overeksponert foto gir ingen oppretting.
- Geometrien er god (husets form innen 0,3 %). Gjenkjenningen på fotoets tynne linjer ga 1 av 4 rom etter fase B, og
  gir 3 rom i 3D og 5 av 6 vinduer etter fase C.

### Rydding før veggene (`clean.js`)

`cleanForWalls(img, { pxPerM }) → img` rydder bildet før veggene. Originalen røres ikke, og `img.cleanStats` sier hva
som ble gjort. Veggene er som regel nøytrale (svarte, mørkegrå eller lys grå fylling mellom mørke konturer), noen ganger
svakt farget (skiferblå på hus3, blåstikk i et mobilfoto) eller tegnet i farge.

**Stegene:**
1. **Veggtonen:** gråbåndet der flest tykke strøk er formet som vegger, målt over nøytrale og fargede piksler hver for
   seg. Fargede vegger beholdes når de er minst en fjerdedel av de nøytrale, og veggenes eget fargestikk løfter
   fargegrensene.
2. **Farge blir papir:** forklaringer oppå tegningen (hus6) og fargede gulv og møbler (hus8, hus9). En tynn farget strek
   over en vegg fylles inn fra tvers over streken.
3. **Bare på lysegrå vegger:** tykke mørke møbler og lyse gulv blir papir, og en påtegnet vegg får veggtonen.
4. **Skraverte vegger blir hele** (hus6). Fra fase C med `hatchInk` 60 og `hatchClose` 5, og fyllet vokser ut til
   konturene (`growToOutlines`), også i de utvendige hjørnene der en mur trekkes inn.
5. **Skravur blir papir**, som standard bare på lysegrå vegger (hus4).

**Målt** i fase A (gjenkjenning og rom før → etter rydding):

| Plan | Rom | Veggene funnet | På veggblekk | Feil vegg (m²) |
|---|---|---|---|---|
| eierens hus | 4/4 → 4/4 | 76 → 76 % | 100 → 100 % | 0,00 → 0,00 |
| hus1, hus2, hus3, hus5, hus8 | uendret bilde eller lik gjenkjenning | | | |
| hus4 1. etasje | 4/7 → 6/7 | 65 → 64 % | 79 → 98 % | 1,85 → 0,15 |
| hus4 2. etasje | 0/4 → 1/4 | 0 → 57 % | 0 → 91 % | 1,55 → 0,42 |
| hus6 | 0/7 → 3/7 | 1 → 45 % | 18 → 92 % | 0,77 → 1,07 |
| hus9 øvre | 0/5 → 3/5 | 0 → 96 % | 0 → 86 % | 0,77 → 2,23 |
| hus9 underetasje | 0/7 → 6/7 | 0 → 99 % | 1 → 90 % | 0,73 → 1,74 |

Testen krever «aldri verre» for hver plan: like mange riktige rom, ingen vegger tapt, ikke mer feil vegg og ikke færre
dører og vinduer i ekte vegger. Godtatte økninger i feil vegg står med grunnen i `tools/fixtures/clean/plans.json`
(hus6: en vegg tvers over åpningen mellom STUE 2 og SPISESTUE; hus9: trappens omriss, badekarkanten, sengekanter og
spisestoler). Fase C la til at hus6s skraverte vegger er minst 95 % blekk og at trappetrinnet i stuas sørvegg er fylt
ut. Tid: 0,15–0,6 s per megapiksel (hus7-arket på 16 MP 2,3 s), og ca. 300 MB toppminne over startnivået på hus7-arket.

**Begrensninger:**
- På hus9 blir den lyseblå glassflaten papir, og den indre rammelinja i det hvite vindusfeltet blir en tynn vegg.
- Røde «nye vegger» blant svarte beholdes bare når de er minst en fjerdedel av de svarte veggene.
- De godtatte verdiene må måles på nytt når gjenkjenningen endrer seg mye.

### Målestokken i lag (`autoscale.js`)

`estimateScale(input) → { pxPerM, method, spread, n, confidence, candidates, outline }`. `autoScale` er det samme uten
KI, med gjenkjenning og rom på nytt når skalaen flytter seg. Det beste laget vinner, og de andre kontrollerer det.

| Lag | Metode |
|---|---|
| `dimensions` | mål fra KI, sammenlignet med husets ytre utstrekning eller en fasade mellom to ytterhjørner der begge flatene når fram til teksten |
| `areas` | `sqrt(rompiksler² / etikett-m²)` per rom, median, avvikere ut; rom med skråtak eller på loft teller mindre |
| `paper` | «1:100» og PDF-sidens størrelse (px per mm på arket) |
| `standard` | dørblad, tynneste vegg (10 cm) og veggtykkelser fra det grå båndet; lav sikkerhet |
| `bra` | BRA fra kunden mot det innvendige fotavtrykket |
| `sameSource` | en annen etasje i samme tegnesett |

**Regler som kom etter gjennomgangen:**
- **Samme tegnesett er ikke samme px/m.** Loftet i hus1 er tegnet i 0,965 av 1. etasjes målestokk, selv om bildene er
  like høye. `sameSource` sammenligner derfor omrisset: likt innen 1,2 % arves, og begge aksene endret med samme
  faktor (innen 1 %) ganges med faktoren, med sikkerheten ett hakk ned. hus1 2. etasje gir 93,80 px/m (−0,2 %).
- **Mål som stemmer tilfeldig.** Laget regner ut sjansen for at samsvaret er tilfeldig, og høy sikkerhet krever under
  1 % og minst 2 mål. Tilfeldige tall ved de ekte etikettene gir 0 av 48 «høy» (før 9 av 12 på hus6).
- **Papir på et utsnitt** bruker `pdfPage.widthPx`/`heightPx` (sidens størrelse da den ble gjengitt): hus7-utsnittet
  gir 118,11 px/m (+0,6 %).
- **Arealer og dører som kontroll:** rom som er uenige med hverandre, teller mindre, og dørene er strengere kontroll jo
  flere de er (5 % ved 4 dører eller flere, 8 % ved 3 og 15 % ved 2).
- **Fart:** hus6 tar 2,5 s (før 9,6 s). En ny runde kjøres bare når et lag med vekt ≥ 0,3 flyttet skalaen.

**Målt** i fase A (`test-planbygger-autoscale.mjs`):

| Hus | Metode | px/m | Fasit | Avvik | Sikkerhet |
|---|---|---|---|---|---|
| hus1 1. etasje | arealer | 97,17 | 97,4 | −0,23 % | høy |
| hus1 2. etasje | samme kilde, × 0,965 | 93,80 | 94,0 | −0,21 % | middels |
| hus2 | mål (9 av 9) | 55,70 | 55,65 | +0,09 % | høy |
| hus3 1. etasje | mål (2 av 2) | 47,90 | 47,88 | +0,04 % | høy |
| hus3 2. etasje | arealer | 47,58 | 47,82 | −0,50 % | høy |
| hus4 1. etasje | arealer | 126,77 | ~120,5 | +5,2 % | middels |
| hus5 | arealer | 47,02 | 46,8 | +0,46 % | høy |
| hus6 | mål | 79,16 | 78,8 | +0,46 % | høy |
| hus6 | bare «1:100» | 78,79 | 78,8 | −0,02 % | middels |
| hus7-utsnittet | papir | 118,11 | 117,4 | +0,60 % | middels |
| eierens 1. etasje | mål | 51,35 | 51,43 | −0,15 % | høy |
| hus8 | standardmål | 31,18 | – | – | lav |
| hus8 | BRA 140 (antatt) | 30,81 | – | – | middels |

**Etter fase C:** hus4 var +3,8 % med høy sikkerhet etter fase B, og testen «ikke høy sikkerhet når den bommer med over
2 %» feilet. Med flatene på de grå veggene (`outlinedFaces`) og skillelinjene i rommene (`levelRooms`) gir arealene
120,2 px/m i begge etasjer (−0,4 og −0,7 %, høy), og hus4 med Haiku i testen −0,8 %. Testen gir 106 av 106.

**Begrensninger:**
- Et utsnitt uten målestokktekst og med vegger som to tynne streker (hus7 uten KI) beholder en gal foreløpig skala
  (−60 %), og en skannet PDF uten KI (hus6) faller til standardmålene (−47 %). Begge spørres om.
- Omskaleringen av loftet antar felles yttervegger. Et jevnt tilbaketrukket toppetasje på et nesten kvadratisk hus ville
  sett ut som en annen målestokk, så sikkerheten går ett hakk ned.
- Sjansemodellen antar at feilleste mål ligger jevnt fordelt (logaritmisk) mellom 0,8 og 20 m.

### Etasjer oppå hverandre (`align.js`)

`alignLevelTo(level, ref, { img, refImg }) → { offset, method: 'stair'|'outline'|'corner', score, detail }`. Den første
metoden som er sikker nok, vinner. Etasjene endres ikke.

- **Trapp, med bildene.** Trappeboksene kommer fra `detect.stairs`, og en etasje uten trapp letes gjennom av en egen
  trappefinner. Strekene i hver boks søkes i den andre etasjens tegning fra grovt til fint (16, 8, 2 og 1 cm). Et rett
  løp passer nesten like godt ett trinn lenger fram (94 % på hus3), så toppene rangeres begge veier, og et klart omriss
  velger. Et treff teller når et annet søk eller omrisset bekrefter det, eller når det er klart best. Et ubekreftet
  treff som et sterkt omriss motsier, forkastes (en «trapp» i bunnteksten på begge FINN-arkene i hus8).
- **Trapp, uten bildene:** bokser av omtrent samme størrelse pares, men bare når noe annet er enig.
- **Omriss:** ytterveggbåndene rastres til 5 cm, og forskyvningen med mest overlapp finnes innenfor ±2 m og forfines
  til 1 cm. Dekningen (`coverage`) brukes bare når et omriss skal overstyre en trapp. Omrisset alene har ikke noe krav
  til dekning ennå, selv om designet ber om minst 0,1.
- **Hjørne:** `alignLevel` i `export.js`, som reserve.

**Målt**, feil mot håndmålt fasit, med trapp og bilder / omriss alene: hus1 1,1 / 0,4 cm, hus3 0,5 / 2,3 cm, hus4
0,6 cm / hjørne 679 cm feil, hus9 (grov fasit) 2,1 cm / hjørne 714 cm feil, og hus8 (grov fasit) hjørne 0,9 cm i begge.
Eierens kjeller havner med hjørne NØ, som i v1. Tid med bildene: 3,3–3,6 s på hus6-arket kaldt, 0,8 s med varme
strek-cacher. Trappefinneren bruker 1,2–1,7 s per stort ark.

**Begrensninger:**
- En falsk «trapp» som begge arkene har på samme sted, bekrefter seg selv.
- Uten bilder og med et svakt omriss (hus4 2. etasje har 10 vegger) faller den tilbake til hjørnet, flere meter feil.
- Uten et klart omriss (hus4, hus9) avgjør tegningen alene hvilket trinn som er riktig, med bare 6–7 % margin. hus9
  uten KI legges med hjørnet (score 0,28), så trappa står ikke der tegningen har den, selv om den kan gås.

### Fasader (`facade.js`)

`readFacade(img, { ai, storeys, floorHeight = 2.7, pxPerM })` leser én fasadetegning: takform, bakke, takfot og møne,
vinduer og dører med etasje, brystning og høyde, skala, metode, sikkerhet, `skew` og `workScale`. `houseRoof` stemmer
over alle fasadene, med vekt 1 per fasade fordelt på typene omrisset tillater.

**Metoden:**
0. **Arbeidskopi:** skjevheten måles (±4°, ned til 0,025°) og rettes opp. Et hus over 900 px eller 200–400 px høyt
   leses på en kopi der huset er 650 px høyt.
1. Papir og blekk fra histogrammet.
2. **Bakkelinja** er den laveste lange linja med blekk over og nesten ikke noe under. På et arkitektark prøves alle
   linjer på minst 15 % av blekket, og det største og høyeste huset som står på en av dem, vinner. Holder huset under
   18 % av blekket, gis ingen bakkelinje heller enn en gal.
3. **Mønet** fra omrisset, uten piper. **Takfoten** er underkanten av takflaten på en langside, underkanten av
   takkanten på en flat topp, eller toppen av hjørnene.
4. **Vinduer og dører** er lukkede rammer med lysere innside. En garasjeport er en dør: minst 2 m bred, på gulvet, med
   minst fire linjer tvers over og ingen stolper.
5. **Skalaen** kommer fra en dør (2,1 m), glass til gulvet, en dør på et øvre gulv, vindusoverkanten, en etasjelinje
   eller vegghøyden, i den rekkefølgen. Hver må gi et hus på 2–30 m.
6. **Etasjer, brystning og høyde:** et oppgitt etasjetall brukes, men aldri færre enn vinduene står i.

**Målt** uten KI på de 20 fasadene til hus1–hus5: takform 16 av 20, vinduer 70 av 71 (sum avvik 5), dører 17 av 18
(sum avvik 5), etasjer 19 av 20, og skalaen innen 5 / 10 % på 10 / 16 av 16. Husets tak blir riktig på hus1 (saltak med
ark), hus2, hus3 (saltak) og hus4 (pulttak). hus5 blir pulttak, der fasiten sier «mixed». hus7: VEST, SØR og NORD får
riktig bakkelinje (529, 529 og 526 px fra bakke til møne, fasit 528) og saltak, og NORD finner de to portene og får
112,9 px/m (−4 %). Skjeve tegninger (0,5–2°) finnes innen 0,025°, med skala 0 til +5 % fra den rette. Under 0,8 s per
fasade.

**Begrensninger:**
- **Uskarphet:** en tegning som er skalert 10 %, dreid bilineært eller forstørret, gjør karmene på 1–2 px grå, og
  dørene forsvinner først. Sum avvik på 20 fasader: 10 i egen størrelse, 20–26 dreid og 15–29 skalert. hus4 fasade 4
  mister da den øvre døra og får 2,3 × for høy skala.
- **Vegghøyden som skala** antar 2,7 m per etasje. Garasjen i hus7 har 2,2 m, så VEST og SØR blir −19 og −20 % alene.
  «Generer» gir dem skalaen fra NORD, som har en dør.
- **hus7 ØST** har en trappet fot i skrånende terreng og gir ingen bakkelinje.
- **KI-svaret på fasadene brukes ikke lenger:** det gjorde tak og vinduer dårligere (se «KI-laget»).

## KI-laget

KI-en leser det klassisk gjenkjenning ikke forstår: romnavn, arealer, titler, mål, målestokk, himlingstekster,
dørtyper, takvinduer og trapp. Mål og koordinater kommer fortsatt fra den klassiske gjenkjenningen. Uten nøkkel, SDK
eller kvote svarer KI-laget `null`, og alt virker som før, bare med flere spørsmål.

### Delene

- **Serveren** (`server/planbygger-ai/index.mjs` og `prompts.mjs`) har sin egen `package.json` og `@anthropic-ai/sdk`
  i `server/planbygger-ai/node_modules` (i `.gitignore`). Prosjektets `node_modules` røres ikke.
  - `createAiHandler()` er en mellomvare for `POST /api/planbygger/ai` og `GET /api/planbygger/ai/status`. Nøkkelen
    blir på serveren. `createAiService()` er det samme uten HTTP, for opptaksskriptet og testene.
  - SDK-en importeres lat. Uten den, eller uten nøkkel, sier statusen `available: false`, og hvert kall gir 503.
  - Forespørselen er `messages.create` med bildet og en tekst, `output_config.format` med oppgavens JSON-skjema og
    tenking med en innsats per oppgave. `stop_reason` sjekkes før svaret leses.
  - Vite monterer den i `tools/planbygger-vite-plugin.mjs`, med lat import, så Vite virker uten SDK.
- **Klienten** (`src/planbygger/ai.js`): `aiStatus()`, `aiRead(task, { image, marks, unmarked, hints })` og
  `setAiTransport()` for testene. Den skalerer bildet ned til høyst 1600 px, sender det som PNG, kaster aldri, og
  kobler svarene til merkene. Et rom uten merke får etiketten som ligger i polygonet sitt.
- **Merkene** (`src/planbygger/marks.js`): `drawMarks(img, { rooms, openings }) → { img, marks, unmarked }` tegner røde
  tall for rom og blå bokstaver for åpninger, med en strek til hullet. Rom uten plass til et merke går i `unmarked`.

### Oppgavene

| Oppgave | Bildet | Svaret | «Generer» bruker det til |
|---|---|---|---|
| `classify` | hele arket | tegningene (type, boks, tittel, etasjenavn), målestokktekst | fasade eller snitt, titler og etasjerekkefølge, egen bygning, «1:100» til papirlaget |
| `readPlan` | den merkede planen | rom (navn, areal, type), etiketter, mål, åpningstyper, takvinduer, trapp, himlingstekster | romnavn og -typer, målestokken (mål og arealer), dobbeltdører og skyvedører i innervegger, takvinduer, trappetypen, hjelpetekst om takhøyden |
| `readFacade` | én fasade | takform, etasjer, vinduer og dører | ingenting: sendes ikke (se under) |

Alle svar har `at: [nx, ny]` per merke, så de kan kobles til riktig ting igjen om nummereringen endrer seg.

### Modell per oppgave: Haiku

Valget bygger på det «Generer» lager med hver modells opptak, målt mot fasiten (`node
tools/planbygger-measure-all.mjs --model readPlan=sonnet` osv.), ikke på poengene per svar. Serveren velger modell per
oppgave, og klienten kan ikke velge.

- **readPlan: Haiku.** Sonnet koster omtrent 10 ganger så mye per kall og er ikke bedre samlet. På samme bilde og merker
  (`node tools/planbygger-ai-record.mjs --compare`, alle 17 parene, fase C) får Haiku 209 av 254 for $0,026 og Sonnet
  207 for $0,27, og på readPlan alene (7 tegninger) 174 og 173 av 205. I «Generer» gir Sonnet hus2 13 rom med navn mot
  Haikus 12, og hus6 3 navngitte rom og 2 spørsmål, men hus3 1. etasje får et falskt takvindu.
- **classify: Haiku.** Begge modellene ga de samme tegningene og etasjene på 3 ark. Sonnet ga hus8 ett spørsmål mindre
  og hus9 underetasje dørtall nærmere fasiten, for omtrent 12 ganger prisen.
- **readFacade: sendes ikke.** Ingen del av svaret slo tegningen alene.

### Fasadene: KI-en leser dem ikke lenger

Med Haiku ble fasadene dårligere enn uten KI. Målt i fase B med «Generer» på de 24 fasadene til hus1–hus5 og hus7, med
én del av fasadesvaret slått av om gangen:

| KI-svaret på fasadene | Hustak riktig | Fasadevinduer eksakt (sum feil) | Fasadedører eksakt (sum feil) |
|---|---|---|---|
| ingen KI | 5 av 6 | 19 av 24 (5) | 19 av 24 (5) |
| Haiku, tak og dør/vindu-typer | 3 av 6 | 17 (8) | 18 (8) |
| Haiku, bare taket | 3 av 6 | 19 (5) | 19 (5) |
| Haiku, bare typene | 5 av 6 | 17 (8) | 18 (8) |
| Sonnet der det finnes (7 fasader), begge deler | 4 av 6 | 18 (8) | 18 (10) |
| Sonnet, uten taket | 5 av 6 | 18 (8) | 18 (10) |

- **Taket:** `facade.js` regner KI-taket som en hel stemme som også avgjør ved likt, men modellen ser bare én fasade.
  hus1 har halvvalm med ark, og modellene sier «hip» og «gable». På hus2s små utsnitt (ca. 200 × 80 px) leser Haiku
  langsiden av et saltak som pulttak.
- **Dør/vindu-typene** retter én fasade (hus1 fasade 1) og ødelegger fem. **Etasjetallet** tas fra planene.

Derfor er `AI_FACADE_USE` i `ai.js` satt til `{ roof: false, kinds: false }`, og `aiRead` sender ikke `readFacade`. Det
sparer 4 kall à 5–7 s per hus. Opptakene testes fortsatt, og `--facade-ai` i measure-all eller `setAiFacadeUse` slår
dem på igjen for en måling.

### Merkene

Rommerkene settes først. Skiva med den hvite kanten skal ikke dekke noe mørkere enn grått 140 (tekst, vegger, streker),
andre merker, åpningshull eller plassen rett foran en åpning (110 var for lite, for grå romtekst ligger på 110–170 på
hus3). Åpningsmerkene settes ved siden av veggen med en strek til hullet, og strekene tegnes før skivene.

Målt i fase A på 7 planer: 0 skiver som overlapper, 0 streker gjennom skiver og 0 rommerker over tekst. 4 åpningskanter
berører en strek (3–13 px), og 4 rom fikk ikke merke (tre små rom på hus2 og BAD 5,0 på hus5), men fikk navnet tilbake
gjennom polygonet. 22–165 ms per plan.

- Tekst lysere enn grått 140 er ikke vernet: streken til et merke på hus8 går over «E» i ENTRÉ.
- Merkene tegnes fra den foreløpige gjenkjenningen, og det begrenser hva KI-en kan lese. Etter fase C har hus6 bare 2
  rommerker, to merker på hvert av vinduene i den tilbaketrukne delen av stua og ingen på vestsiden. På hus3 1. etasje
  har de to faste glassfeltene ingen egne merker, så 4 av 6 vinduer er det høyeste en modell kan få der. På hus3-foto
  deles WC/D i to langs åpningene P–Q.

### Vern

- **Kvote:** 40 kall per økt (informasjonskapselen `pb_ai`) og 150 per IP i et glidende døgn. En klient uten
  informasjonskapsel får en ny økt, så den virkelige grensen er IP-kvoten og et tak for hele serveren: 1000 kall og
  5 USD per døgn. Et treff i hurtigbufferen teller ikke. Kvoten og taket lever i minnet og nullstilles ved omstart.
- **IP bak proxy:** serveren bruker den siste `X-Forwarded-For`-oppføringen, slik `server.mjs` gjør. `trustProxy` slås
  på av seg selv når `RAILWAY_ENVIRONMENT_NAME` eller `RAILWAY_ENVIRONMENT` er satt.
- **Modellen** velges av serveren, og `model` fra nettleseren overses. Bare opptaksskriptet (`ctx.allowModel`) eller
  `PLANBYGGER_AI_ALLOW_MODEL=1` i Vite slipper det gjennom. Sonnet koster 20 ganger så mye som Haiku per token inn.
- **Ellers:** bildet høyst 1600 px og 6 MB, høyst 3 kall samtidig med kø (30, 120 s), 60 s tidsgrense per kall,
  høyst 300 merker, og en hurtigbuffer på disk i `.shots/planbygger/ai-cache/` etter sha256 av oppgave,
  promptversjon, modell, innsats, bilde, merker og hint.

### Kostnad og tid så langt

161 ekte kall, til sammen ca. $0,92 (`.shots/planbygger/ai-record-log.jsonl`, tokens og pris per kall): fase A 60 kall
for $0,38, fase B 79 kall for $0,31 (Haiku 65 for $0,07, Sonnet 14 for $0,24), og fase C 22 av 25 kall for $0,23
(15 Haiku-kall på readPlan for $0,040 og 7 Sonnet-kall for $0,191).

| Modell | Oppgave | Kall (fase A og B) | Pris per kall | Tid per kall | Tokens inn / ut |
|---|---|---|---|---|---|
| Haiku | readPlan | 42 | $0,0024 | 16,5 s | 7136 / 3438 |
| Haiku | classify | 39 | $0,0007 | 4,7 s | 3804 / 623 |
| Haiku | readFacade | 28 | $0,0007 | 6,5 s | 3180 / 852 |
| Sonnet | readPlan | 16 | $0,0256 | 8,7 s | 6962 / 1168 |
| Sonnet | classify | 5 | $0,0098 | 5,3 s | 3781 / 226 |
| Sonnet | readFacade | 9 | $0,0094 | 4,4 s | 3205 / 296 |

- **Per hus** med Haiku og uten fasade-KI blir det ett `classify` per fil og ett `readPlan` per plan: hus1 (6 filer,
  2 planer) ca. $0,009 og hus2 (2 filer, 1 plan) ca. $0,004, rundt 5–10 øre per hus.
- **Tiden:** Haiku bruker 16,5 s i snitt på `readPlan`. Tidene i tabellen over husene (7–26 s) er med opptakene, uten
  ventetid. Et hus med to etasjer fra samme tegnesett må anslagsvis regne med 40–60 s med ekte KI. «Generer» med ekte
  KI er ikke målt i nettleseren.

### Hva KI-en leser godt og dårlig

**Godt** (Haiku, nesten feilfritt): romnavn og arealer, også med desimalkomma; titler og målestokk; ytre mål og mm-mål
(14 av 17 på hus6); himlingstekster; antall tegninger på et ark og titlene deres.

**Dårlig:**
- **Skyvedører** leses dårlig av begge modellene (fase B: 0 av 8 plass-sjekker på hus2 og hus3 2. etasje). Skyvedørene
  «Generer» bygger, kommer fra `detect.js`.
- **Dørtall:** Haiku teller for mange slagdører og for få skyvedører, og leser sidefelt og glassdører feil. Planer uten
  merker gir få eller ingen åpninger.
- **Trappetypen** er feil på 7 opptak med Haiku.
- **Variasjon:** samme bilde gir ulike svar (to kjøringer på hus3 1. etasje ga 9 og 7 av 10 riktige åpningsbokstaver).
- **Kjente modellfeil** (sett på overlegg og ført i `KNOWN` i `tools/test-planbygger-ai.mjs`): på hus2 kaller Haiku
  WIC 4.6 «(G)», og Sonnet leser glassdørene P, G og R som vinduer. På hus3 1. etasje leser Haiku inngangsdøra med
  sidefelt som dobbeltdør og døra under trappa som åpning, og Sonnet sidefeltet D som dør. På hus4 2. etasje leses den
  tynne dobbeltstreken mellom W.I.C og Bad som dør. På hus5 leses skyvedøra H som vindu og sidefeltet D og vinduet U som
  dører, og «Skråhiml.» mangler. På hus6 leser Haiku L som dør og M som skyvedør, og Sonnet ENTRE som 10 m². På hus9
  øvre leser Sonnet B og D som dobbeltdører.

**Det de ferske svarene gjorde i «Generer»** (fase C): hus5 er uendret (10/0/4 dører, 15 vinduer, 9 rom med navn + 4
åpne). hus1 fikk et trappespørsmål, fordi Haiku sier «rett trapp» om den kvartsvingte i 2. etasje. På hus6 gir Haiku
merke 2 navnet «ENTRE 18», og punktet modellen oppgir (`at`), ligger i entreen. Men `semantics()` i `generate.js` legger
navnet etter et punkt inne i det foreløpige rommet, som havner i vaskerommet: resultatet er «Entre + Vaskerom» på
6,0 m² og et romspørsmål for den ekte entreen (17,5 m²). Lagt etter `at` ville rommene blitt Stue 2, Stue + Spisestue +
Kjøkken, Entre, Vaskerom og WC. På hus2 ligger Haikus BOD i nisjen fasiten kaller «trolig» BOD. Haiku er ikke tatt opp
på nytt for å få testene grønne.

**Utviklingen** (`node tools/planbygger-measure-all.mjs`, «Generer» med KI):

| | Fase A-opptak | Fase B | Fase C (nå) |
|---|---|---|---|
| spørsmål med KI (uten KI) | 55 | 26 (120) | 29 (129) |
| hustak riktig | 5 av 6 | 5 av 6 | 5 av 6 |
| fasadevinduer eksakt (sum feil) | 19 av 24 (5) | 19 (5) | 19 (5) |
| rom funnet / riktig type, av 110 | 82 / 72 | 99 / 89 | 106 / 99 |
| rom med navn i eget rom / i en åpen plan, av 110 | – | 72 / – | 81 / 19 |
| etasjer med skala innen 2 %, av 12 med fasitskala | 8 | 10 | 12 |

Fase C skiller mellom en åpen plan, der fasiten selv sier at ingenting er tegnet mellom sonene (`OPEN_PLANS`), og en
ekte sammenslåing over en tegnet vegg, dør eller skillelinje (6 i fase C).

### Opptakene og testene

- **87 opptak** i `tools/fixtures/planbygger-ai/`: 70 med Haiku (alle oppgavene i alle de ti husene) og 17 med Sonnet
  (de vanskelige tilfellene), alle tatt opp gjennom «Generer» (`node tools/planbygger-measure-all.mjs --record --budget
  N`), så hvert har nøyaktig bildet, merkene, hintene og utsnittet «Generer» sender.
- **Alle 87 er ferske etter fase C:** `node tools/test-planbygger-ai.mjs --strict-fresh` gir 389 av 389, og alle er i
  bruk. Det tok tre runder: 9 Haiku-opptak, 5 Sonnet-opptak, og så 6 Haiku og 2 Sonnet på nytt da `clean.js` og
  `detect.js` endret merkene på hus1, hus3 1. etasje, hus4 2. etasje, hus5 og hus6 (på hus1 2. etasje, hus3 1. etasje og
  hus5 var bare skivene flyttet, «annet bilde»).
- **`node tools/test-planbygger-ai.mjs`** spiller dem av uten nøkkel og sjekker hvert svar mot `fasit.json`: rom,
  typer, etiketter, dørvarianter, vinduer, takvinduer, trapp, tittel, målestokk, mål, himlingstekster, tak og
  tegningsboksene. Et avvik feiler, med mindre det står i `KNOWN`, og et kjent avvik som blir riktig, feiler også. Et
  foreldet opptak (annet bilde, andre merker, hint eller utsnitt) spilles av etter plassering med MERK, og feiler med
  `--strict-fresh`. Fra fase C feiler også et navn som er til overs når alle fasitrommene har fått sitt («ekstra rom»:
  samme etikett på to merker, eller en tekst som ikke er et rom). hus3-foto gir «WC/D» på merke 3 og 4 (i `KNOWN`).
- **Plass-sjekkene** (`BY_EYE` i `tools/planbygger-ai-fixtures.mjs`) er punkter sjekket på et overlegg: rommet modellen
  ga navnet, må dekke fasitpunktet, og merket nærmest et fasitpunkt for en åpning (innen 0,4 m) må ha riktig type. 83
  rom og 84 åpninger på 11 opptak, så et ombytte av to lesninger feiler. Skyvedøra STUE–KJØKKEN på hus1 er flyttet til
  midten av åpningen (800, 576), slik fasiten oppgir; før lå punktet på toppen av lomma (617).
- **Å ta opp igjen** når `detect.js`, `clean.js`, `regions.js` eller `generate.js` endrer bildet eller merkene: se hva
  som er foreldet med `node tools/planbygger-measure-all.mjs --record --dry` (og `… --record --dry --model
  readPlan=sonnet --tasks readPlan --only hus2,hus3,hus6,hus9`), og ta dem opp med `--budget N`. Sonnet-parene på
  readPlan er hus2, hus3 1. og 2. etasje, hus6, hus8 plantegning-3 del 1 og hus9 ×2. hus8 plantegning-2 har ikke noe
  Sonnet-opptak, og skal ikke ha det.

### Personvern og samtykke

- **Uten KI sendes ingenting.** Statuslinja sier «Alt kjøres i nettleseren – planen sendes ingen steder.»
- **Med KI** sendes en nedskalert kopi (høyst 1600 px, PNG) av hver tegning med merkene, og filnavnet og etasjenavnet
  som hint, til serveren og videre til Anthropics API. Originalfilen sendes ikke, og bildet lages på nytt fra pikslene,
  så EXIF-data i et mobilfoto (som posisjonen) følger ikke med.
- **Hurtigbufferen** lagrer svaret etter en hash, ikke bildet. Loggen har oppgave, modell, tokens, pris og tid, ikke
  innhold.
- **I dag** sier stabelen at «en nedskalert kopi av tegningene sendes til KI-tjenesten». Det er informasjon, ikke
  samtykke.
- **Før KI-en slås på for kunder:** et eget valg før første «Generer» med en forklaring på hva som sendes; en
  personvernerklæring som nevner Anthropic som databehandler, og en databehandleravtale (en plantegning av et hjem er
  personopplysninger, ofte med adresse i filnavnet eller på tegningen); Anthropics vilkår for lagring og bruk av
  API-data; og om filnavnet i det hele tatt bør sendes.

### Montering i server.mjs (ikke gjort)

`server.mjs` er en ren `http.createServer` uten avhengigheter. KI-ruta må monteres bak innloggingen og **før** linja
`if (req.method === 'POST') return login(req, res, url);`, for i dag går hver POST til innloggingen:

```js
import { createAiHandler } from './server/planbygger-ai/index.mjs';
const planbyggerAi = createAiHandler({ limits: { trustProxy: true } });

// i request-handleren, etter /healthz og sjekken av STUE_BRUKER/STUE_PASSORD:
if (url.pathname === '/api/planbygger/ai' || url.pathname.startsWith('/api/planbygger/ai/')) {
  if (!loggedIn(req)) return res.writeHead(401).end();
  return planbyggerAi(req, res);
}
```

Det trengs også `ANTHROPIC_API_KEY` som variabel i Railway, `npm ci --prefix server/planbygger-ai` i byggesteget
(ellers sier statusen `available: false`), en plass for hurtigbufferen (`limits.cacheDir`) eller å godta at den
forsvinner ved hver utrulling, og en lokal test med `node server.mjs` før noe rulles ut.

## Rommene og eksporten

**Rom** (`regions.js`). Veggene i editormodellen (senterlinjer med tykkelse) tegnes i et raster på 2 cm. Hver ende
forlenges med halve tykkelsen til den tykkeste veggen den møter, så L-hjørner lukkes uten at en tykk vegg stikker inn
i rommet ved en T-skjøt. De frie cellene flomfylles, omrisset av hvert rom følges langs cellekantene og forenkles
(Douglas–Peucker, 1,2 celler), og hver kant festes til flaten av veggen den går langs. Polygonene blir dermed eksakte på
veggflatene, og hver kant vet hvilken vegg og side den ligger på. Fra fase C lager alle deler av «Generer» rommene med
`levelRooms(level)`:
- **Skillelinjer** deler rommene. Hjørnet der romkanten går over fra vegg til skillelinje, beholdes (på hus4 lå linja
  én rute fra veggflaten og ble glattet bort).
- **Øyer** skjæres ut (`cutIslands`), fordi et rom i husformatet er ett polygon uten hull. Et område med en øy av rom
  inni (hus2: WC/D og BOD midt i stua) deles med to rette kutt fra øya ut til veggene, der kuttene sammen er kortest.
  hus2 får «Gang + Entré» vest for kjernen og «Stue + Kjøkken» øst for den.
- **Skrå vegger:** kanten langs en skrå vegg ble en trapp av ca. 30 korte kanter. Nå blir minst tre punkter på rad
  innen 1,6 celler fra flaten til en vegg utenfor aksene, én kant (`alongSlanted`). hus6: STUE 2 gikk fra 34 til 5
  hjørner, eksporten fra 83 til 54 vegger, og skyvedøra (f) er hel (4,42 m, før kuttet til 0,52 m).
- **Småhakk:** to parallelle flater under 1,2 cm fra hverandre legges på én linje (`MIN_JOG`).

**Husformatet** (`export.js`) følger reglene i `notes/hele-huset-design.md` §1:
- **Romsløyfer:** hvert rom får sin egen veggsløyfe med klokka, med rommet til høyre og normalen inn.
- **Delte vegger:** en romkant deles der rommet bak skifter, likt på begge sider. Rommet med lavest nummer eier
  veggskiva (tykkelse = avstanden mellom flatene), og det andre rommets bit er `backOf` (D13). Tykkelsen bak én vegg kan
  variere med høyst 4 mm, og veggen tar den minste, så den ikke går inn i rommet bak (på loftet i hus1 lå en flate
  0,100 m bak en vegg på 0,106 m).
- **T-skjøter:** et kort stykke foran enden av en vegg på tvers slås sammen med naboen, men blir fritt igjen hvis det
  ellers ville gått inn i et annet roms vegg.
- **Yttervegger** får planens tykkelse, minst «Yttervegg minst» (0,25 m), og går aldri inn i et annet rom. Der to roms
  yttervegger møtes i et ytterhjørne, tynnes bare de ytterste 1,2 cm (før ble 1,92 m vegg på loftet i hus1 5 mm tykk).
- **Skillelinjer og kutt** (fase C): det ene rommet får en vegg med tykkelse 0 og én åpning over hele lengden og
  høyden, og det andre rommets kant er `backOf` den. `rooms.js` bygger ingenting for en vegg uten tykkelse, og åpningen
  er portalen for `visibility.js`. `counts.openBoundaries` teller dem (hus2 2, hus4 1, hus9 med KI 1).
- **Et rom rundt en vegg** (fase C, bodfronten under trappa i hus3): før ble det to yttervegger på 0,25 m, og den ene
  stod 0,11 m inn i toppen av trappa. Nå eier den ene siden en innervegg med veggens egen tykkelse, og den andre får en
  vegg uten tykkelse. En dør i en slik vegg kobles til «ute», fordi formatet krever to ulike rom (forespørsel 13).
- **En åpning langs flere rom** (fase C, hus4: 4,5 m langs trapperommet og rommet ved siden av) deles over veggene til
  alle rommene. Før lå den bare på veggen den overlappet mest, så toppen av U-trappa møtte en vegg.
- **Dører** får `door:{ hinge, swing, opensInto, leaf … }`, og dører og åpninger får `connects`
  (ytterdører `['rom', 'ute']`).
- **Trapper:** U-trappa legges slik editoren tegner den (det øverste løpet fra `stairGeometry`). En landing må ha plass
  til figuren, også 0,2 m til hver side av midten. En trapp brattere enn 51,7° gir en advarsel.
- **Rydding:** kanter under 1 cm tas bort (hus3-foto uten KI fikk en vegg på 9 mm), normalen på en skrå vegg regnes fra
  de avrundede endene, og et trappehull som stikker 4 mm ut av et rom, flyttes inn på romkanten (hus1 uten KI).
- **Det andre:** tak, gulv etter romtype, én plafond og én lysgruppe per rom, alt merket `estimated`. Planen dreies
  etter nordretningen (spillets +x er sør og +z vest), og origo legges i det innvendige hjørnet av hovedetasjen.

**Det husformatet ikke har ennå** eksporteres som det nærmeste, og `source` sier det (forespørsel 7–13): en dobbeltdør
blir to dører side om side, hengslet i hver sin karm; en skyvedør og en garasjeport blir en åpning; takvinduer blir data
på himlingen (`ceilings[].skylights`), som ingenting bygger; en kvartsvingt trapp blir en U-trapp med et notat, eller
bygges ikke når den blir for bratt (hus8); en skillelinje blir en vegg uten tykkelse med en åpning; en dør i en vegg
med samme rom på begge sider kobles til «ute»; og takformen står bare i dokumentet (`doc.roof`), med flat himling.

**Kontroll.** Huset valideres med spillets egen `validateHouse` (`src/data/scripts/house.mjs`), også i nettleseren
(«Kontroller huset»). Den eneste feilen som filtreres bort, er at «stue-kjokken» mangler (den gjelder bare eierens hus).
v1-testplanene og de syntetiske planene gir 0 feil og 0 advarsler, og alle 20 kjøringene av «Generer» (10 hus, med og
uten KI) 0 feil etter fase C. I fase B hadde hus1 2 (flatene på loftet) og hus2 11 (rom som øyer i den åpne stua).

## 3D

`viewer.js` setter sammen `baseSpec()` og husfila og bygger `layout.js` med `buildLayout`, `rooms.js` med `buildRooms`
og `stairs.js` med `buildStairs`, de samme byggerne som spillet bruker. Spilleren går med `PlayerController`, `Input`,
`CollisionWorld` og `InteractionSystem`. Lyset er enkelt: himmel, sol fra sør og én lampe per rom. Stua i spillet
(`shell.js`, `kitchen.js`, `LightManager`, designet) brukes ikke. Takvinduene vises som lyse felt med ramme i taket, som
en stedfortreder til `rooms.js` bygger dem.

**Gangtesten** (fase C, `tools/test-planbygger-build3d.mjs`) kjører «Generer» på alle husene, med opptakene og uten KI,
og tar standardsvaret på hvert spørsmål. Huset eksporteres og bygges i Node med spillets byggere, slik `viewer.js` gjør.
Testen sjekker 0 feil i validatoren, at dørene og vinduene er bygd, minst ett rom og et startpunkt på gulvet per etasje,
og kollisjon for veggene. Mellom to etasjer må det finnes en trapp med trinn og kollisjon, med toppen og foten på gulv,
ikke brattere enn 51,7° (`WALKABLE_NORMAL_Y` i `src/config.js`: brattere bakke er en vegg for figuren). Spillets figur
(`PlayerController` i en `CollisionWorld` med alle kollisjonene i huset) går den fra 0,8 m foran foten til 0,6 m forbi
toppen og ned igjen, og må ende på gulvet over og under. Før godtok testen alle trapper med trinn og gulv ved endene,
også en på 64°. Del 0 har fem små hus bygd for hånd (en øy og en skillelinje, et rom rundt en vegg, en åpning langs to
rom, en skrå vegg, og en rett trapp som er lang nok eller for kort). `planbygger-measure-all.mjs` går trappene på samme
måte og skriver stigningen i trappekolonnen.

Etter fase C: 200 av 203. Figuren går trappa opp og ned i hus1 (31–31,5°), hus3 (39°), hus4 (38°) og hus9 (38,5° med
KI, der trappa er 3,39 av 3,7 m, og 43,6° uten KI). 17 av 20 kjøringer kan gås gjennom alle etasjene. Unntakene er
hus7 uten KI (ingen rom) og hus8 med og uten KI (trappa er for bratt for formatet og bygges ikke). Målt, ikke sjekket:
uten KI når figuren 3 av 4 rom i hus6.

## Testene

Alle er rene Node-skript med `check`, `section` og `done` fra `tools/planbygger-lib.mjs`, og ingen trenger
API-nøkkel. Tallene er fra sluttkontrollen etter fase C.

| Test | Sjekker | Tid | Hva |
|---|---|---|---|
| `test-planbygger.mjs` | 121 | 13 s | v1: rasteroperasjoner, rom, eksport mot validatoren, syntetiske planer (35–120 px/m, støy, grå vegger, 2× og 4×), eierens hus, skala, byggerne, rettingene, etasjer og trapper, skjeve planer |
| `test-planbygger-detect.mjs` | 215 | 118 s | dørvarianter, takvinduer, trapper, skillelinjer ved 35–120 px/m, hus4, hus6, hus8 og hus9, tider (beste av 3); del 10 fra fase C |
| `test-planbygger-ai.mjs` | 389 | 476 s | opptakene mot fasiten, plass-sjekkene, «ekstra rom», vernet over ekte HTTP (Vite på port 5276; `--no-vite` hopper over), merkene, KI mot uten KI; `--strict-fresh` |
| `test-planbygger-autoscale.mjs` | 106 | 66 s | lagene, tilfeldige mål, papir på utsnitt, samme kilde, hus4 |
| `test-planbygger-sheet.mjs` | 201 | 30 s | arkene i egen størrelse og omsamplet |
| `test-planbygger-photo.mjs` | 35 | 48 s | hus3-foto (også med rydding ±1,5 % skala), syntetiske foto, digitale tegninger |
| `test-planbygger-clean.mjs` | 95 | 55 s | «aldri verre» per plan, fargede vegger, hus6s skraverte vegger og trappetrinnet |
| `test-planbygger-align.mjs` | 49 | 26 s | trapp, omriss og hjørne mot håndmålt fasit |
| `test-planbygger-facade.mjs` | 73 | 18 s | fasadene, skjeve og skalerte tegninger, hus7 |
| `test-planbygger-generate.mjs` | 306 | 299 s | «Generer» på alle husene med og uten KI mot fasiten, svarene, avspillingen, feilsituasjoner, `OPEN_PLANS` mot fasiten og «Ferdig betyr» |
| `test-planbygger-build3d.mjs` | 203 | 259 s | husfila i spillets byggere, og gangtesten i trappene (se «3D») |

- **Del 10 i detect** (fase C): syntetisk sjakt, trappetrinn med vindu og skrått hjørne; hus3 2. etasje (7 rom); hus4
  (arealer ±4 %, veggtykkelser, W.I.C); hus6 ved 78,6–79,0 px/m og fargeoriginalen (hvert av de 8 vinduene og ingen
  andre enn sidefeltet, (c) som skyvedør i lomme med lomma som vegg, (f) som skyvedør på 4,0–4,8 m, (d) på 0,7–1,0 m,
  dørene 2/0/6, ingen dør på trappas sidevegg, og rommene); og ingen skrå vegger på seks planer uten.
- **Generate-testen** har terskler fra det runde 1 når, så en sjekk som feiler, er en tilbakegang. Fase C fjernet
  unntaket for hus4 (`SCALE_UNASKED_KNOWN`) og strammet inn (0 feil i validatoren på alle husene, hus4 innen 1 %, flere
  rom med navn). To terskler ble løsere, begge med grunnen i fila: hus8 får 6 spørsmål (før 5), og trappa der godtas som
  spurt om og ikke bygd (`'steep'`). «Ferdig betyr» feiler bare med `--strict-goals`. `--quick` tar hus1, hus3 og hus8.
- **`test-planbygger-browser.mjs --lock`** kjører siden i en hodeløs Edge (egen Vite-server, port 5272 som standard, tar
  GPU-låsen; skjermbilder i `.shots/planbygger/`). Del 0 er uten nettleser, del 1–8 er v1, del 9–10 hus3 uten KI og med
  opptakene, del 11 (`--houses` eller `--only=hus`) alle ti husene, og del 12 en PDF med 45 sider. Testserveren svarer
  selv på `/api/planbygger/ai`, og `ANTHROPIC_API_KEY` fjernes fra miljøet.
- **`node tools/planbygger-measure-all.mjs --write`** kjører «Generer» på alle husene og skriver tabellen i «Runde 1:
  målinger per hus». `--json f` og `--from f` gjenbruker en kjøring, `--only` velger hus, `--model readPlan=sonnet`
  bytter modell, `--facade-ai` slår fasade-KI-en på, og `--record --budget N` tar opp KI-svar (bare med nøkkel; `--dry`
  viser hva som ville blitt tatt opp). `OPEN_PLANS` lister de åpne planene per etasje med fasitens egne ord, og
  generate-testen sjekker at sitatene står i `fasit.json`.

## Målinger mot eierens hus

Fasiten er huset som ble bygd for hånd i natt (`research/house/10-hoved-rom.json`, `30-kjeller.json` og stua i
`research/room-spec.json`, flettet i `src/data/room-spec.json`). Dette er v1-flyten med én plan: skala fra den lengste
målelinja, og nord til venstre. Rettingene er det eieren gjør i editoren (`tools/planbygger-corrections.mjs`, én linje
per handling): gi rommene navn, gjøre gangdøra om fra åpning til dør (den er tegnet som et vindu, uten bue), legge inn
døra til den grå boden (den finnes ikke i planen), snu hengsel og slagretning, og sette ytterveggene til 0,30 m. Det som
ble flyttet etter bildene i natt (V-punktene i `notes/hele-huset-avstemming.md`), er ikke rettet og står igjen som
avvik.

Veggavviket måles langs alle romflater med 5 cm mellomrom. «Etter forskyvning» betyr etter den beste
parallellforskyvningen. Kjellerdataene ligger 0,13 m ut i x og z med vilje (avstemming V1).

<!-- målinger:start -->
_Generert av `node tools/planbygger-measure.mjs --write`._

### 1. etasje

Skala fra målelinja «12,21 m» (628 px): 51,43 px/m. Gjenkjenningen tok 689 ms og fant 11 vegger, 3 dører, 7 vinduer og 1 åpninger.

**Vegger mot dataene slik de er bygd**

| | Automatisk | Etter retting |
|---|---|---|
| Veggflater funnet (innen 15 cm, av lengden) | 100 % | 100 % |
| Snittavvik, rå | 1,7 cm | 1,7 cm |
| Median / p90 / maks, rå | 1,7 / 3,7 / 4,1 cm | 1,7 / 3,7 / 4,1 cm |
| Beste parallellforskyvning (x, z) | 1,7, 1,8 cm | 1,7, 1,8 cm |
| Snittavvik etter forskyvning | 1,2 cm | 1,2 cm |
| Median / p90 / maks etter forskyvning | 1,1 / 1,9 / 2,3 cm | 1,1 / 1,9 / 2,3 cm |
| Veggflater funnet etter forskyvning | 100 % | 100 % |
| Ekstra veggflate (ikke i fasiten) | 0,00 m av 72,1 m | 0,00 m av 72,1 m |

**Dører, vinduer og åpninger** (mot dataene, etter forskyvning; funnet = senteret innen 60 cm på en parallell vegg)

| | Fasit | Automatisk | Etter retting |
|---|---|---|---|
| Dører | 4 | 4 funnet, 3 riktig type, 3 slår riktig vei (3 foreslått) | 4 funnet, 4 riktig type, 4 slår riktig vei (4 foreslått) |
| Vinduer | 7 | 7 funnet, 7 riktig type (7 foreslått) | 7 funnet, 7 riktig type (7 foreslått) |
| Åpninger uten dør | 0 | 0 funnet, 0 riktig type (1 foreslått) | 0 funnet, 0 riktig type (0 foreslått) |
| Senteravvik, snitt | | 6,4 cm | 6,4 cm |
| Breddeavvik, snitt | | 4,8 cm | 4,8 cm |
| Ikke funnet | | – | – |
| Ekstra | | 0 | 0 |

**Rommene** (mot dataene, etter forskyvning)

| Rom (fasit) | Areal fasit | Automatisk: areal (IoU) | Etter retting: areal (IoU) |
|---|---|---|---|
| Stue/kjøkken | 53,78 m² | 53,37 m² (100 %), «Stue», type ✓ | 53,37 m² (100 %), navn ✓, type ✓ |
| Bad | 5,62 m² | 5,53 m² (97 %), navn ✓, type ✓ | 5,53 m² (97 %), navn ✓, type ✓ |
| Gang | 6,58 m² | 6,44 m² (98 %), navn ✓, type ✓ | 6,44 m² (98 %), navn ✓, type ✓ |
| Soverom | 11,45 m² | 11,46 m² (99 %), navn ✓, type ✓ | 11,46 m² (99 %), navn ✓, type ✓ |

Validatoren (`validateHouse`): Automatisk: 0 feil, 0 advarsler; Etter retting: 0 feil, 0 advarsler.

Rettingene (7 handlinger i editoren): rommet «Bad» (bathroom); rommet «Gang» (hall); rommet «Soverom» (bedroom); rommet «Stue/kjøkken» (living); åpningen gang/stue → dør; døra gang/stue: åpningsvinkel 180°; yttervegg minst 0,30 m.

### Kjeller

Skala fra målelinja «10,50 m» (633 px): 60,29 px/m. Gjenkjenningen tok 440 ms og fant 18 vegger, 6 dører, 6 vinduer og 1 åpninger.

**Vegger mot dataene slik de er bygd**

| | Automatisk | Etter retting |
|---|---|---|
| Veggflater funnet (innen 15 cm, av lengden) | 89 % | 89 % |
| Snittavvik, rå | 12,9 cm | 12,9 cm |
| Median / p90 / maks, rå | 13,0 / 13,6 / 14,2 cm | 13,0 / 13,6 / 14,2 cm |
| Beste parallellforskyvning (x, z) | 13,0, 13,0 cm | 13,0, 13,0 cm |
| Snittavvik etter forskyvning | 0,5 cm | 0,5 cm |
| Median / p90 / maks etter forskyvning | 0,2 / 1,0 / 6,5 cm | 0,2 / 1,0 / 6,5 cm |
| Veggflater funnet etter forskyvning | 89 % | 89 % |
| Ekstra veggflate (ikke i fasiten) | 11,44 m av 104,6 m | 11,44 m av 104,6 m |

**Dører, vinduer og åpninger** (mot dataene, etter forskyvning; funnet = senteret innen 60 cm på en parallell vegg)

| | Fasit | Automatisk | Etter retting |
|---|---|---|---|
| Dører | 7 | 6 funnet, 6 riktig type, 6 slår riktig vei (6 foreslått) | 7 funnet, 7 riktig type, 7 slår riktig vei (7 foreslått) |
| Vinduer | 6 | 6 funnet, 6 riktig type (6 foreslått) | 6 funnet, 6 riktig type (6 foreslått) |
| Åpninger uten dør | 1 | 1 funnet, 1 riktig type (1 foreslått) | 1 funnet, 1 riktig type (1 foreslått) |
| Senteravvik, snitt | | 8,3 cm | 8,5 cm |
| Breddeavvik, snitt | | 7,8 cm | 7,3 cm |
| Ikke funnet | | `door-bod-2` | – |
| Ekstra | | 0 | 0 |

**Rommene** (mot dataene, etter forskyvning)

| Rom (fasit) | Areal fasit | Automatisk: areal (IoU) | Etter retting: areal (IoU) |
|---|---|---|---|
| Gang | 13,08 m² | 12,23 m² (94 %), navn ✓, type ✓ | 12,23 m² (94 %), navn ✓, type ✓ |
| Vaskerom | 10,26 m² | 10,70 m² (95 %), «Soverom 1», type bedroom | 10,70 m² (95 %), navn ✓, type ✓ |
| Soverom | 7,44 m² | 7,46 m² (100 %), «Soverom 2», type ✓ | 7,46 m² (100 %), navn ✓, type ✓ |
| Kjellerstue | 20,60 m² | 20,59 m² (99 %), «Stue», type ✓ | 20,59 m² (99 %), navn ✓, type ✓ |
| Entré | 6,87 m² | 6,50 m² (93 %), navn ✓, type ✓ | 6,50 m² (93 %), navn ✓, type ✓ |
| Bod | 3,47 m² | 3,84 m² (90 %), «Bod 1», type ✓ | 3,84 m² (90 %), navn ✓, type ✓ |
| Bod (grå) | 9,91 m² | 9,90 m² (100 %), «Bod 2», type ✓ | 9,90 m² (100 %), navn ✓, type ✓ |
| Bod under terrassen | 10,54 m² | 10,67 m² (98 %), «Bod 3», type ✓ | 10,67 m² (98 %), navn ✓, type ✓ |

Validatoren (`validateHouse`): Automatisk: 0 feil, 0 advarsler; Etter retting: 0 feil, 0 advarsler.

Rettingene (12 handlinger i editoren): rommet «Bod» (storage); rommet «Bod (grå)» (storage); rommet «Bod under terrassen» (storage); rommet «Gang» (hall); rommet «Entré» (entrance); rommet «Vaskerom» (laundry); rommet «Soverom» (bedroom); rommet «Kjellerstue» (living); ny dør gang/bod (grå); bredde 0,95; døra til boden: snu hengselen; døra til boden: snu slagretningen.

### Hele huset: kjelleren under 1. etasje

Kjelleren er plassert bare med justeringsregelen «ytterhjørnet NØ mot hovedetasjen», uten noen beste forskyvning. Tallene viser hvor nær regelen kommer eierens håndplasserte kjeller (avstemming V1: ytterflatene i flukt).

| | Automatisk | Etter retting |
|---|---|---|
| Kjelleren: veggflater funnet (innen 15 cm) | 92 % | 92 % |
| Kjelleren: snittavvik / median / p90 | 0,9 / 0,2 / 1,1 cm | 0,9 / 0,2 / 1,1 cm |
| Kjelleren: rest-forskyvning (x, z) som regelen ikke fanget | 0,0, -0,2 cm | 0,0, -0,2 cm |
| 1. etasje: snittavvik | 1,7 cm | 1,7 cm |
| Dører i hele huset (fasit 11) | 10 funnet, 9 slår riktig vei | 11 funnet, 11 slår riktig vei |
| Vinduer i hele huset (fasit 13) | 13 funnet | 13 funnet |
| Trappa (fasit: halvsvingt, 13 opptrinn) | ingen | U-trapp, 14 opptrinn, inntrinn 0,221 (fasit 0,240), fotavtrykk 76 % IoU, øverste trinnkant 16 cm unna |
| Validatoren | 0 feil, 0 advarsler | 0 feil, 6 advarsler |

Rettingene i hele huset er de to listene over pluss trappa (23 handlinger): trapp tegnet over trapperommet; type U-trapp; drei 90°; snu retningen. Trappa er tegnet som U-trapp over trapperommet. Eierens trapp har et kort øvre løp (1 rett trinn) og et lengre nedre løp, mens planbyggerens U-trapp har like lange løp. Derfor ligger den øverste trinnkanten litt lenger øst. Validatoren advarer: stairs/trapp-1: 2·opptrinn + inntrinn = 0,585 er utenfor 0,60–0,64; stairs/trapp-1: trinnene går utenfor gang-2 ved (1,58; 2,31); stairs/trapp-1: øverste trinnkant (med nesa) står 0,000 fra karmen til door-bad-1 (minst 0,05).

<!-- målinger:slutt -->

**Hva tallene betyr:**

- **1. etasje:** alle veggflatene er funnet, med 1,2 cm snittavvik og maks 2,3 cm etter forskyvning, under én piksel
  (1 px = 1,9 cm). Alle 4 dørene og 7 vinduene er funnet. Den ene «feilen» er gangdøra, som planen tegner som en åpning
  uten bue. Rommene overlapper fasiten med 97–100 %.
- **Kjelleren:** veggene som finnes, ligger 0,5 cm unna (median 0,2 cm). De 11 % av veggflatene som ikke ble funnet, er
  nøyaktig de veggene nattarbeidet flyttet bort fra tegningen: sjaktveggene låst til 1. etasje (V3: `w-kg-nisje`,
  `w-b1-vest`, `w-kg-vest` og `w-vask-ost`), entréens vestvegg på ytterflaten (V8) og bod 3 flyttet 6 cm (V9). Døra til
  den grå boden er ikke tegnet, så den kan ikke finnes.
- **Rettinger:** 7 handlinger i 1. etasje og 12 i kjelleren, mest romnavn (4 + 8). Etter dem er alle dørene, vinduene og
  rommene på plass med riktig type, slagretning og navn.
- **Hele huset:** regelen «ytterhjørnet NØ» alene legger kjelleren der nattarbeidet la den for hånd, med 0,2 cm
  restforskyvning og 0,9 cm snittavvik. Trappa er ikke gjenkjent her. Den er tegnet for hånd som U-trapp, som har like
  lange løp, mens eierens har et kort øvre og et langt nedre løp.

## Runde 1: målinger per hus

<!-- hus:start -->
_Generert av `node tools/planbygger-measure-all.mjs --write`: «Generer» på alle husene, med de lagrede KI-svarene (Haiku) og uten KI, mot `plantegninger/<hus>/fasit.json`._

Kolonnene: per etasje skilt med «·». Skala: px/m og feilen mot fasitens px/m (– der fasiten ikke har noen, og på fotoet, som rettes opp til et annet rutenett), og metoden. «Skala fra rommene»: medianen av generert areal / etikettareal over rommene som ble funnet, som skalafeil. Rom: funnet (en generert region for etiketten: etter navn, ellers areal innen 15 %), med navnet fra tegningen i et eget rom («+n åpen»: etiketter i ett rom med samlet navn der tegningen har en åpen plan uten noe tegnet mellom dem, slik fasiten sier; «+n delt»: etiketter som deler rom fordi gjenkjenningen slo dem sammen over en tegnet vegg, dør eller skillelinje), med riktig type (gang og entré godtas begge for rommet med inngangsdøra). Vegger / rom i 3D: veggene i etasjen og rommene eksporten lager. Dører: enkle/doble/skyve, fasiten i parentes. Trapp: bygd som rett eller U, typen tegningen viste, fasitens type i parentes, så stigningen og om spillerens figur går den opp og ned i 3D-huset (PlayerController med husets kollisjon; brattere enn 51,7° er en vegg for den). «Ingen» i et hus med to etasjer betyr at etasjene ikke henger sammen. Fasadevinduer: generert/fasit per fasade.

| Hus | KI | Etasjer (rekkefølge) | Skala px/m (feil) | Skala fra rommene | Rom: funnet / navn / type | Vegger / rom i 3D | Dører enkel/dobbel/skyve (fasit) | Vinduer | Takvinduer | Trapp | Tak | Fasadevinduer | Spørsmål | Feil i 3D-huset |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hus1 | ja | 2 av 2 (2/2 rett) | 97,2 (−0,2 %) areas · 93,8 (−0,2 %) sameSource | −0,0 % (6 rom) · +19,5 % (5 rom) | 6/6/6 av 6 · 7/5 (+2 åpen)/6 av 7 | 19 / 6 · 23 / 6 | 4/2/1 (4/2/1) · 6/0/0 (6/0/0) | 11 (11) · 6 (6) | 0 (0) · 4 (4) | U fra kvartsvingt (kvartsvingt), 32°, gås opp og ned | gable-dormer (gable-dormer) | 4 av 4 fasader; 7/6 4/4 3/3 4/4 | 3 (stair 1, ceiling 2) | 0 feil, 1 adv. |
| hus1 | nei | 2 av 2 (2/2 rett) | 95,7 (−1,7 %) standard · 91,4 (−2,8 %) standard | +1,5 % (6 rom) · +0,3 % (1 rom) | 6/0/2 av 6 · 1/0/0 av 7 | 19 / 6 · 23 / 6 | 4/2/1 (4/2/1) · 6/0/0 (6/0/0) | 11 (11) · 6 (6) | 0 (0) · 3 (4) | U fra kvartsvingt (kvartsvingt), 31°, gås opp og ned | gable-dormer (gable-dormer) | 4 av 4 fasader; 7/6 4/4 3/3 4/4 | 16 (scale 2, ceiling 2, room 12) | 0 feil, 1 adv. |
| hus2 | ja | 1 av 1 (1/1 rett) | 55,7 (+0,2 %) dimensions | −0,4 % (12 rom) | 17/12 (+2 åpen) (+3 delt)/16 av 17 | 30 / 15 | 10/0/5 (10/0/5) | 12 (12) | 0 (0) | ingen (ingen) | gable (gable) | 4 av 4 fasader; 3/3 1/2 4/4 2/3 | 1 (ceiling 1) | 0 feil, 0 adv. |
| hus2 | nei | 1 av 1 (1/1 rett) | 55,9 (+0,6 %) standard | −0,6 % (12 rom) | 12/0/7 av 17 | 30 / 15 | 10/0/5 (10/0/5) | 12 (12) | 0 (0) | ingen (ingen) | gable (gable) | 4 av 4 fasader; 3/3 1/2 4/4 2/3 | 13 (scale 1, ceiling 1, room 11) | 0 feil, 0 adv. |
| hus3 | ja | 2 av 2 (2/2 rett) | 47,9 (−0,0 %) dimensions · 47,7 (−0,2 %) areas | +0,5 % (2 rom) · +0,1 % (6 rom) | 4/2 (+2 åpen)/3 av 4 · 8/6 (+2 åpen)/7 av 8 | 12 / 3 · 15 / 7 | 6/0/0 (7/0/0) · 2/0/3 (4/0/3) | 5 (6) · 6 (6) | 0 (0) · 0 (0) | rett fra rett (rett), 39°, gås opp og ned | gable (gable) | 4 av 4 fasader; 3/4 2/2 4/4 2/2 | 2 (ceiling 2) | 0 feil, 1 adv. |
| hus3 | nei | 2 av 2 (2/2 rett) | 48,4 (+1,0 %) standard · 48,4 (+1,2 %) sameSource | −0,2 % (3 rom) · −1,5 % (6 rom) | 3/0/1 av 4 · 6/0/5 av 8 | 12 / 3 · 15 / 7 | 6/0/0 (7/0/0) · 2/0/3 (4/0/3) | 5 (6) · 6 (6) | 0 (0) · 0 (0) | rett fra rett (rett), 39°, gås opp og ned | gable (gable) | 4 av 4 fasader; 3/4 2/2 4/4 2/2 | 13 (scale 2, ceiling 2, room 9) | 0 feil, 1 adv. |
| hus3-foto | ja | 1 av 1 (1/1 rett) | 102,4 (–) dimensions | +0,9 % (1 rom) | 4/1 (+2 åpen) (+1 delt)/3 av 4 | 30 / 3 | 7/0/0 (7/0/0) | 5 (6) | 0 (0) | ingen (ingen) | – | – | 2 (windows 1, ceiling 1) | 0 feil, 0 adv. |
| hus3-foto | nei | 1 av 1 (1/1 rett) | 103,0 (–) standard | +2,5 % (2 rom) | 2/0/0 av 4 | 30 / 3 | 7/0/0 (7/0/0) | 5 (6) | 0 (0) | ingen (ingen) | – | – | 6 (windows 1, scale 1, ceiling 1, room 3) | 0 feil, 0 adv. |
| hus4 | ja | 2 av 2 (2/2 rett) | 120,2 (−0,4 %) areas · 120,2 (−0,7 %) areas | −0,1 % (8 rom) · −0,0 % (4 rom) | 8/8/8 av 9 · 4/4/4 av 5 | 27 / 8 · 13 / 6 | 7/0/1 (8/0/1) · 4/0/0 (4/0/0) | 7 (6) · 9 (9) | 0 (0) · 0 (0) | U fra U (U), 38°, gås opp og ned | mono-pitch (mono-pitch) | 4 av 4 fasader; 5/5 2/2 7/6 2/2 | 4 (ceiling 2, room 2) | 0 feil, 2 adv. |
| hus4 | nei | 2 av 2 (2/2 rett) | 120,4 (−0,2 %) standard · 120,4 (−0,5 %) sameSource | −0,2 % (7 rom) · −0,2 % (3 rom) | 7/0/5 av 9 · 3/0/1 av 5 | 27 / 8 · 13 / 6 | 7/0/1 (8/0/1) · 4/0/0 (4/0/0) | 7 (6) · 9 (9) | 0 (0) · 0 (0) | U fra U (U), 38°, gås opp og ned | mono-pitch (mono-pitch) | 4 av 4 fasader; 5/5 2/2 7/6 2/2 | 18 (scale 2, ceiling 2, room 14) | 0 feil, 2 adv. |
| hus5 | ja | 1 av 1 (1/1 rett) | 47,0 (+0,3 %) areas | −0,0 % (9 rom) | 13/9 (+4 åpen)/12 av 13 | 24 / 11 | 10/0/4 (10/0/4) | 15 (15) | 0 (0) | ingen (ingen) | mono-pitch (mixed) | 4 av 4 fasader; 3/3 3/3 4/4 5/5 | 1 (ceiling 1) | 0 feil, 0 adv. |
| hus5 | nei | 1 av 1 (1/1 rett) | 46,8 (−0,3 %) standard | +0,5 % (9 rom) | 9/0/5 av 13 | 24 / 11 | 10/0/4 (10/0/4) | 15 (15) | 0 (0) | ingen (ingen) | mono-pitch (mixed) | 4 av 4 fasader; 3/3 3/3 4/4 5/5 | 13 (scale 1, ceiling 1, room 11) | 0 feil, 0 adv. |
| hus6 | ja | 1 av 1 (1/1 rett) | 78,9 (+0,1 %) dimensions | +1,6 % (2 rom) | 7/2 (+3 åpen) (+2 delt)/6 av 7 | 26 / 5 | 2/0/6 (2/0/6) | 9 (8) | 0 (0) | ingen (ingen) | – | – | 3 (windows 1, ceiling 1, room 1) | 0 feil, 0 adv. |
| hus6 | nei | 1 av 1 (1/1 rett) | 41,7 (−47,1 %) standard | +0,0 % (1 rom) | 1/0/1 av 7 | 22 / 4 | 1/0/3 (2/0/6) | 6 (8) | 0 (0) | ingen (ingen) | – | – | 7 (windows 1, scale 1, ceiling 1, room 4) | 0 feil, 2 adv. |
| hus7 | ja | 1 av 1 (1/1 rett) | 117,5 (+0,1 %) dimensions | −1,1 % (1 rom) | 1/1/1 av 1 | 6 / 1 | 0/0/0 (0/0/0) | 0 (0) | 0 (0) | ingen (ingen) | gable (gable) | 4 av 4 fasader; 0/0 0/0 0/0 0/0 | 2 (windows 1, ceiling 1) | 0 feil, 0 adv. |
| hus7 | nei | 1 av 1 (1/1 rett) | 47,1 (−59,9 %) standard | – | 0/0/0 av 1 | 9 / 0 | 0/0/0 (0/0/0) | 0 (0) | 0 (0) | ingen (ingen) | gable (gable) | 4 av 4 fasader; 0/0 0/0 0/0 0/0 | 4 (windows 1, scale 1, walls 1, ceiling 1) | 0 feil, 0 adv. |
| hus8 | ja | 2 av 2 (2/2 rett) | 31,2 (–) standard · 31,2 (–) standard | – · – | 6/6/6 av 7 · 9/7 (+2 åpen)/9 av 10 | 17 / 6 · 18 / 8 | 5/0/0 (5/0/0) · 6/0/1 (7/0/3) | 4 (4) · 6 (6) | 0 (0) · 0 (0) | ingen (kvartsvingt), den som ble funnet er for bratt (spurt, «ingen trapp»); etasjene henger ikke sammen | – | – | 6 (stair 1, windows 1, bra 2, ceiling 2) | 0 feil, 0 adv. |
| hus8 | nei | 2 av 2 (2/2 rett) | 31,2 (–) standard · 31,2 (–) standard | – · – | 0/0/0 av 7 · 0/0/0 av 10 | 17 / 6 · 18 / 8 | 5/0/0 (5/0/0) · 6/0/1 (7/0/3) | 4 (4) · 6 (6) | 0 (0) · 0 (0) | ingen (kvartsvingt), den som ble funnet er for bratt (spurt, «ingen trapp»); etasjene henger ikke sammen | – | – | 21 (stair 1, windows 1, order 1, scale 2, ceiling 2, room 14) | 0 feil, 0 adv. |
| hus9 | ja | 2 av 2 (2/2 rett) | 44,7 (−1,6 %) areas · 53,3 (−1,5 %) areas | −0,7 % (5 rom) · −0,1 % (7 rom) | 5/5/5 av 5 · 7/7/7 av 7 | 21 / 6 · 23 / 8 | 2/0/1 (3/0/1) · 3/0/0 (5/0/0) | 9 (8) · 5 (6) | 0 (0) · 0 (0) | rett fra rett (kvartsvingt), 39°, gås opp og ned | – | – | 5 (windows 1, alternative 1, ceiling 2, room 1) | 0 feil, 0 adv. |
| hus9 | nei | 2 av 2 (2/2 rett) | 50,0 (+10,1 %) standard · 50,3 (−7,0 %) standard | +4,3 % (1 rom) · −0,9 % (5 rom) | 1/0/1 av 5 · 5/0/1 av 7 | 12 / 4 · 26 / 8 | 2/0/0 (3/0/1) · 4/0/0 (5/0/0) | 8 (8) · 5 (6) | 0 (0) · 0 (0) | rett fra rett (kvartsvingt), 44°, gås opp og ned | – | – | 18 (stair 1, windows 1, alternative 1, scale 2, ceiling 2, room 11) | 0 feil, 3 adv. |

**Per hus, med KI** (validatorens gjenstående feil, de første to, og det «Generer» selv noterte):

- **hus1:** 9,3 s, 8 av 8 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). 2. etasje: trappa er kvartsvingt (svinger 90°), men husformatet har bare rette trapper og U-trapper. Den er lagt inn som U-trapp.
- **hus2:** 7,3 s, 3 av 3 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). Rettet for 3D-huset: 1. etasje: dør slagretning byttet.
- **hus3:** 14,7 s, 5 av 5 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). Rettet for 3D-huset: 1. etasje: dør slagretning byttet.
- **hus3-foto:** 14,5 s, 2 av 2 KI-oppgaver hadde et opptak. Rettet for 3D-huset: 1. etasje: dør slagretning byttet; 1. etasje: en åpning som lå oppå en annen, er fjernet.
- **hus4:** 25,9 s, 8 av 8 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke)
- **hus5:** 8,0 s, 6 av 6 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). Rettet for 3D-huset: 1. etasje: dør slagretning byttet; 1. etasje: dør slagretning byttet.
- **hus6:** 17,6 s, 2 av 2 KI-oppgaver hadde et opptak
- **hus7:** 9,5 s, 2 av 2 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). «garasje-plan-snitt-fasade.pdf»: veggene ble ikke funnet på vanlig måte, så de er lest som konturlinjer (to tynne streker per vegg) (den åpne siden nederst er lukket med en vegg med 1 åpning der portene står). Sjekk dem i «Finjuster». «garasje-plan-snitt-fasade.pdf» («ØST»): Fant ingen sikker bakkelinje: huset står ikke på noen lang linje (terreng, målekjeder eller tekst rundt det).
- **hus8:** 9,5 s, 5 av 5 KI-oppgaver hadde et opptak. «plantegning-1.jpg» (del 1) er samme tegning som «plantegning-2.jpg», og er brukt én gang. «plantegning-1.jpg» (del 2) er samme tegning som «plantegning-3.jpg» (del 1), og er brukt én gang. «plantegning-1.jpg» (del 3) er samme tegning som «plantegning-3.jpg» (del 2), og er brukt én gang. «plantegning-3.jpg»: en mindre bygning ved siden av huset er ikke tatt med som etasje.
- **hus9:** 10,2 s, 5 av 5 KI-oppgaver hadde et opptak. Øvre etasje: 2 streker på tvers inne i trappa var lest som vegger (trinn eller snittlinje) og er tatt bort, så trappa kan gås. Underetasje: 3 streker på tvers inne i trappa var lest som vegger (trinn eller snittlinje) og er tatt bort, så trappa kan gås. Øvre etasje: en strek langs enden av trappa var lest som en vegg og stengte toppen; den er tatt bort, så trappa kan gås. Rettet for 3D-huset: Øvre etasje: en åpning som lå oppå en annen, er fjernet; Underetasje: en åpning som lå oppå en annen, er fjernet; en vegg som var funnet to ganger, noen centimeter fra hverandre, er slått sammen. «underetasje-alternativ.jpg» er et alternativ til «underetasje.jpg»; huset er bygd med «underetasje.jpg».

**«Ferdig betyr» (hus1, hus2, hus3 og hus5 med KI):**

| Hus | Etasje | Mål | Resultat | |
|---|---|---|---|---|
| hus1 | 1. etasje | skala innen 2 % | −0,2 % | ✓ |
| hus1 | 1. etasje | rom med navn (eget rom, eller samlet navn i en åpen plan) | 6 av 6 i eget rom | ✓ |
| hus1 | 1. etasje | dobbeltdører | 2 (fasit 2) | ✓ |
| hus1 | 1. etasje | skyvedører | 1 (fasit 1) | ✓ |
| hus1 | 1. etasje | takvinduer | 0 (fasit 0) | ✓ |
| hus1 | 2. etasje | skala innen 2 % | −0,2 % | ✓ |
| hus1 | 2. etasje | rom med navn (eget rom, eller samlet navn i en åpen plan) | 5 av 7 i eget rom, 2 i åpen plan (GANG/TRAPP + LOFTSTUE) | ✓ |
| hus1 | 2. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus1 | 2. etasje | skyvedører | 0 (fasit 0) | ✓ |
| hus1 | 2. etasje | takvinduer | 4 (fasit 4) | ✓ |
| hus2 | 1. etasje | skala innen 2 % | +0,2 % | ✓ |
| hus2 | 1. etasje | rom med navn (eget rom, eller samlet navn i en åpen plan) | 12 av 17 i eget rom, 2 i åpen plan (KJØKKEN + STUE), 3 slått sammen over en tegnet vegg, dør eller skillelinje (GANG, BOD, ENTRÉ) | ✗ |
| hus2 | 1. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus2 | 1. etasje | skyvedører | 5 (fasit 5) | ✓ |
| hus2 | 1. etasje | takvinduer | 0 (fasit 0) | ✓ |
| hus3 | 1. etasje | skala innen 2 % | −0,0 % | ✓ |
| hus3 | 1. etasje | rom med navn (eget rom, eller samlet navn i en åpen plan) | 2 av 4 i eget rom, 2 i åpen plan (KJØKKEN/STUE + ENTRÉ) | ✓ |
| hus3 | 1. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus3 | 1. etasje | skyvedører | 0 (fasit 0) | ✓ |
| hus3 | 1. etasje | takvinduer | 0 (fasit 0) | ✓ |
| hus3 | 2. etasje | skala innen 2 % | −0,2 % | ✓ |
| hus3 | 2. etasje | rom med navn (eget rom, eller samlet navn i en åpen plan) | 6 av 8 i eget rom, 2 i åpen plan (ARBEIDSROM + GANG) | ✓ |
| hus3 | 2. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus3 | 2. etasje | skyvedører | 3 (fasit 3) | ✓ |
| hus3 | 2. etasje | takvinduer | 0 (fasit 0) | ✓ |
| hus5 | 1. etasje | skala innen 2 % | +0,3 % | ✓ |
| hus5 | 1. etasje | rom med navn (eget rom, eller samlet navn i en åpen plan) | 9 av 13 i eget rom, 4 i åpen plan (STUE/KJØKKEN + SPISESTUE + GANG + SOV) | ✓ |
| hus5 | 1. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus5 | 1. etasje | skyvedører | 4 (fasit 4) | ✓ |
| hus5 | 1. etasje | takvinduer | 0 (fasit 0) | ✓ |

<!-- hus:slutt -->

**Hva tallene betyr** (etter fase C):

- **Spørsmål:** med KI 1–6 per hus, 29 i alt, og 15 av dem er takhøyden. Uten KI 4–21 per hus, 129 i alt, mest romnavn
  (hus8 21, hus4 og hus9 18).
- **Skala:** med KI er alle 12 etasjene der fasiten har en skala, innen 2 % (størst hus9, −1,6 %), og rommene på
  hus3-foto stemmer innen 0,9 %. hus8 har ingen skala i fasiten: «Generer» spør om BRA og står på 31,2 px/m, mot
  fasitens anslag på ca. 34. Uten KI bommer hus6 (−47 %), hus7 (−60 %) og hus9 (+10 og −7 %), men alle spørres om.
- **Rom:** med KI er 106 av 110 funnet, 81 med navnet i eget rom, 19 i en åpen plan fasiten beskriver og 6 slått sammen
  over noe tegnet, og 99 har riktig type. Uten KI er 56 funnet, 29 med riktig type og ingen med navn.
- **Dører og vinduer** stemmer på hus1, hus2, hus4 2. etasje, hus5, hus7 og hus8 kjeller, og dørene på hus6 og
  hus3-foto. hus3 mangler 1 slagdør og 1 vindu i 1. etasje og 2 slagdører i 2. etasje (de halvt åpne), hus4
  1. etasje 1 slagdør (og har 1 vindu for mye), hus8 1. etasje 1 slagdør og 2 skyvedører, og hus9 1 og 2 slagdører.
  hus6 har sidefeltet som vindu.
- **Tak:** riktig på 5 av 6 hus med fasader. hus5 blir pulttak, der fasiten sier «mixed».
- **Trapper:** riktig type på hus3 (rett) og hus4 (U). hus1 er kvartsvingt og bygges som U, og hus9 bygges rett der
  fasiten sier kvartsvingt. Alle trappene som bygges, kan gås (31–44°). hus8 får ingen, fordi den er for bratt.
- **3D-huset:** 0 feil i validatoren på alle 20 kjøringene (fase B: hus1 2 og hus2 11).
- **Tid:** 7–26 s per hus i Node med opptakene, uten ventetid på KI-en (hus4 er tregest).

### Sluttkontrollen

Alle testene etter fase C, kjørt etter hverandre med ingenting annet på maskinen, mens kildefilene stod stille:

| Test | Resultat | Tid |
|---|---|---|
| `test-planbygger.mjs` | 121 av 121 | 13 s |
| `test-planbygger-detect.mjs` | 215 av 215 | 118 s |
| `test-planbygger-autoscale.mjs` | 106 av 106 | 66 s |
| `test-planbygger-sheet.mjs` | 201 av 201 | 30 s |
| `test-planbygger-photo.mjs` | 35 av 35 | 48 s |
| `test-planbygger-clean.mjs` | 95 av 95 | 55 s |
| `test-planbygger-align.mjs` | 49 av 49 | 26 s |
| `test-planbygger-facade.mjs` | 73 av 73 | 18 s |
| `test-planbygger-build3d.mjs` | **200 av 203** | 259 s |
| `test-planbygger-generate.mjs` | **302 av 306**, «Ferdig betyr» 29 av 30 mål | 299 s |
| `test-planbygger-ai.mjs` (Vite på port 5276) | 389 av 389, ingen MERK | 476 s |
| I alt, 11 pakker | 1786 av 1793 | |
| `test-planbygger-generate.mjs --strict-goals` | 331 av 336 (de samme 4 og målet for hus2) | 294 s |
| `test-planbygger-ai.mjs --strict-fresh` | 389 av 389: alle opptakene er ferske | 474 s |
| `test-planbygger-browser.mjs --lock --port=5273` | 51 av 51 (del 0–10 og 12) | 85 s |

`planbygger-measure-all.mjs --write` skrev bare tabellen over. Radene var like med kjøringen før; bare tidene i «Per
hus» endret seg.

**De 7 sjekkene som feiler:**
- **build3d, hus7 uten KI:** ingen rom (skalaen −60 %, veggene er to tynne streker; veiviseren spør om veggene).
- **build3d, hus8 med og uten KI:** ingen trapp fra kjelleren. Etasjen over viser bare det øverste løpet av den
  kvartsvingte trappa, i en sjakt på 0,94 × 1,8 m. Boksen som finnes, er 0,91 × 1,32 m og gir 64° for 2,7 m, og ingen
  rett trapp eller U-trapp får plass der under 51,7° (en rett trapp trenger minst 2,1 m ganglinje).
- **generate, hus1:** 3 spørsmål mot høyst 2. Det ferske Haiku-svaret sier at trappa er rett, mens tegningen viser
  kvartsvingt, så «Generer» spør.
- **generate, hus2:** 12 av 17 rom med navn i eget rom mot minst 13 (BOD-nisjen).
- **generate, hus6:** 3 spørsmål mot høyst 2, og 2 rom med navn mot minst 3 (ENTRE i vaskerommet).

Ingen terskel er senket for å få en pakke grønn, og ingen av feilene står på en unntaksliste.

**«Ferdig betyr» for runde 1:**

| Mål | Nådd | Målt |
|---|---|---|
| «Generer» tar hvert av de ti husene fra filene til et 3D-hus man kan gå i | nei | Alle 20 kjøringene bygges med 0 feil i validatoren (fase B: hus1 2, hus2 11). Spillerens figur går hver trapp som er bygd, opp og ned. 17 av 20 kjøringer kan gås gjennom alle etasjene: hus8 henger ikke sammen (trappa er for bratt for formatet), og hus7 uten KI er tomt. |
| … med så få spørsmål som mulig | delvis | 29 med KI (1–6 per hus), 129 uten, og 15 av de 29 er takhøyden. hus1 og hus6 har ett spørsmål mer enn testens grense. |
| Skala innen 2 % på hus1, hus2, hus3 og hus5 | ja, med KI | −0,2 og −0,2 %, +0,2 %, 0,0 og −0,2 %, +0,3 %, med ferske opptak. Uten KI er hus1 2. etasje −2,8 % (og spurt om), de andre innen 1,7 %. |
| Rommene har navn | nesten | Hver etikett i eget rom, eller et samlet navn i en åpen plan fasiten beskriver: 5 av 6 etasjer består (hus1 6 av 6 og 5 + 2 åpen, hus3 2 + 2 og 6 + 2, hus5 9 + 4). hus2 har 12 av 17, 2 i åpen plan (KJØKKEN + STUE) og 3 slått sammen (GANG, BOD, ENTRÉ). |
| Dobbeltdører og skyvedører gjenkjennes | ja | Antallene og plassene stemmer på alle 6 etasjene. Skyvedøra i hus1 er 0,82 m (hullet 0,80; før 1,71). De kommer fra `detect.js` og eksporteres som åpninger. |
| Takvinduer gjenkjennes | ja | 4 av 4 på hus1 2. etasje (3 av 4 uten KI). De andre etasjene har ingen og fikk ingen. |
| Målt resultat per hus i notatene | ja | Tabellen over, med og uten KI, med trappenes stigning og om de kan gås. |
| Alle Node-tester grønne | nei | 1786 av 1793: build3d 3 og generate 4. De 9 andre pakkene er grønne. |

Det som står igjen, er hus8s trapp (motoren), hus7 uten KI, BOD-nisjen i hus2 (`detect.js`), og to ting i `generate.js`
som de ferske KI-svarene viste: navnet etter merkets eget punkt (hus6) og trappetypen fra tegningen foran KI-ens (hus1).

## Begrensninger: hva som fungerer, og hva som må rettes

**Fungerer godt:**
- digitale planer med svarte eller grå vegger (hus1, hus2, hus3, hus5): skala innen 0,3 % med KI, dørvariantene og
  vinduene stemmer, og trappene kan gås; lysegrå vegger med svarte konturer (hus4) innen 0,7 %; den skannede hus6 med KI
  (+0,1 %, dørene 2/0/6, en skrå vegg, 5 rom);
- flere tegninger på ett ark, PDF (skannet og vektor), AVIF, JPG og mobilfoto med EXIF-retning;
- etasjene i riktig rekkefølge på alle ti husene, lagt oppå hverandre innen 0,5–2,1 cm der trappa finnes;
- målestokk fra mål, arealer, «1:100», PDF-siden, BRA eller standardmål;
- dobbeltdører og skyvedører med symbol (også i lomme og som glassvegg), takvinduer som stiplede rektangler, og rette,
  kvartsvingte og halvsvingte trapper på 8 av 11 planer med trapp, uten falske trapper;
- åpne planer: skillelinjer og øyer når husfila som rom uten vegg mellom seg;
- takformen fra fasadene (5 av 6 hus);
- fargede rom, grå møbler, målelinjer, tekst og skravur, 35–200 px/m med støy, skjeve planer opptil ±10° og fasader
  opptil ±4°.

**Må rettes for hånd (i veiviseren eller «Finjuster»):**
- **Takhøyden** spørres alltid (2,4 m som forslag). Himlingstekster vises som hjelp, men skrå himling kan ikke bygges.
- **Rom i en åpen plan** får ett samlet navn («Sov + Gang»), slik tegningen viser dem, og kan deles med en vegg. Ekte
  sammenslåinger står igjen i hus2 (BOD-nisjen) og hus8 kjeller (pipa).
- **Romnavn uten KI:** typen gjettes, og navnet bør kunden skrive (ett kort per rom).
- **Dører uten bue eller symbol**, halvt åpne dører, dører som ikke er tegnet, og brystningshøyder uten fasader.
- **Kvartsvingte trapper** bygges som U-trapp, eller ikke i det hele tatt når de blir for bratte (hus8). Løp av ulik
  lengde blir bare omtrent riktige.
- **Skrå tak, nivåforskjeller i et rom og buede vegger** støttes ikke. Himlingen er flat med én høyde per rom.

**Fungerer ikke ennå:**
- **Mobilfoto:** arket rettes opp riktig og gir 3 rom i 3D og 5 av 6 vinduer, men gjenkjenningen er følsom for skalaen
  (over ca. 103 px/m deler inventaret WC/D i småbiter).
- **Skannede arkitekttegninger uten KI** (hus6): −47 %.
- **Vegger som to tynne konturlinjer** (hus7): med KI ett rom med porten som én åpning på 5,2 m (fasiten har to porter
  på 2,39 m og en stolpe), uten KI et tomt hus.
- **Hobbytegninger med teksturgulv og møbler** (hus9): skala innen 2 % med KI, men møbler blir vegger, og trappa
  (skyggelagte trinn) blir en rett trapp der trinnstrekene først leses som vegger.
- **En kvartsvingt trapp i en liten sjakt** (hus8) kan ikke bygges i husformatet.
- **KI-en** leser ikke skyvedører, fasadesvaret gjorde tak og vinduer dårligere (slått av), og et navn kan havne i
  nabo-rommet når gjenkjenningen deler det foreløpige rommet (hus6).
- **Svarte møbler inntil vegger** kan bli vegg.
- **Med ekte KI** er «Generer» ikke målt i nettleseren. `readPlan` tar 16,5 s i snitt med Haiku.

## Hvor langt er det til noe som kan selges?

Ærlig vurdering, oppdatert etter runde 1.

**Status per tegningstype** (fra tabellen over):

| Tegning | Hus | Med KI | Uten KI |
|---|---|---|---|
| Digital katalog- eller meglertegning med arealer eller mål | hus1, hus2, hus3, hus5 | skala innen 0,3 %, dørene og vinduene stemmer, 1–3 spørsmål, trappene kan gås; åpne planer gir rom med samlet navn | skala innen 1,7 % (hus1 2. etasje −2,8 %, spurt), 13–16 spørsmål |
| Moderne, lysegrå vegger, tregulvskravur | hus4 | −0,4 og −0,7 %, 12 av 14 rom med navn, U-trapp som kan gås, 4 spørsmål | −0,2 og −0,5 %, 18 spørsmål |
| Skannet arkitekttegning (PDF) | hus6 | +0,1 %, dørene 2/0/6, 9 vinduer mot 8, 5 rom i 3D, men 2 av 7 navn i eget rom | −47 % (spurt), 4 rom i 3D |
| Garasje på et arkitektark | hus7 | +0,1 %, 1 rom, porten som én åpning | −60 % (spurt), tomt |
| FINN-tegning uten mål og arealer | hus8 | BRA spørres, 15 av 17 rom funnet (13 i eget rom, 2 i åpen plan), men kjelleren nås ikke | 21 spørsmål; ingen rom kan kobles til fasiten |
| Hobbytegning med lav oppløsning | hus9 | −1,6 og −1,5 %, 12 av 12 rom, rett trapp (fasit kvartsvingt) som kan gås | +10 og −7 % (spurt), 18 spørsmål |
| Mobilfoto av en utskrift | hus3-foto | arket rettes opp riktig, 4 av 4 rom funnet, 3 rom i 3D | 2 av 4 rom funnet, 3 rom i 3D |

**Hva runde 1 flyttet og viste:**
- «Flere plantyper» fra v1-anslaget er i stor grad gjort for digitale planer: dobbeltdører, skyvedører, takvinduer,
  trapper, flere tegninger på ett ark, PDF, oppretting av foto, og KI som leser navn og mål. Flyten for en lat kunde
  finnes (slipp alt, trykk «Generer», svar på 1–6 kort), og hvert av de ti testhusene er målt med og uten KI. Fase C
  gjorde alle husfilene gyldige og beviste at trappene kan gås med spillets egen figur.
- De rene digitale planene er nær målet. De vanskelige tegningene (skann, foto, konturlinjer, hobbytegninger) gir et
  hus, men ikke et riktig hus.
- KI-en hjelper mye på navn og målestokk, men lite eller negativt på symboler. Svarene varierer, og et nytt opptak kan
  gi et spørsmål mer (hus1, hus6). KI gjør også produktet avhengig av en tjeneste, en nøkkel, en kvote og en avtale om
  personvern.

**Det som gjenstår, grovt anslått for én utvikler:**
1. **Spillet må ta imot et kundehus** (3–5 uker), fortsatt den største biten. `createHome` (`src/home/index.js`) bygger
   alltid eierens stue (`shell.js`, `kitchen.js`, `exterior.js`, en `LightManager` kalibrert mot stua og et design med
   stuas møbler). For at en kunde skal kunne møblere, male og bruke lys, trengs en modus for et generisk hus, og
   husformatet og motoren trenger det runde 1 fant (forespørsel 5 og 7–13).
2. **Kontoer, lagring, personvern og KI-drift** (2–3 uker): én innlogging per kunde (`server.mjs` har ett felles
   passord), prosjekt og husfil lagret på serveren, sletting (GDPR), KI-ruta i `server.mjs`, kvote per konto, samtykke,
   personvernerklæring og databehandleravtale.
3. **Gjenkjenningen** (3–5 uker): rom slått sammen over noe tegnet, konturlinjer, skannede tegninger uten KI, foto,
   hobbytegninger, trappesymboler og de siste trappene. Ti hus er nok til å finne feilene, men ikke til å vite hvor ofte
   de skjer, så det trengs flere ekte kundeplaner.
4. **Flyten** (1–2 uker): `alignLevelTo` og kontrollen i arbeideren, ny kjøring når et svar flytter skalaen, redigerbare
   skillelinjer, «Generer» målt med ekte KI i nettleseren, og en måte å avbryte på.
5. **Finpuss** (1–2 uker): mobil og nettbrett (editoren og veiviseren er for mus og tastatur), hjelp i verktøyet, bedre
   feilmeldinger og ytelse.

Samlet blir det 10–17 uker til en første betalbar versjon for digitale planer (v1-anslaget var 7–13 uker). Runde 1 tok
unna mye av «flere plantyper», men la til KI-drift og personvern, og ti ekte hus viser mer som gjenstår enn de to
testplanene i v1 gjorde. Skannede tegninger og fotoer tar klart lengre tid. **Driften er billig:** alle mål regnes ut i
nettleseren, KI-en koster rundt 5–10 øre per hus med Haiku (serveren har et tak på 5 USD per døgn), og uten KI koster et
hus ingenting.

## Forespørsler til hele-huset-arbeidet

Planbyggeren redigerer ingen eksisterende motorfiler. Det som manglet, er løst i planbyggerens egen kode med
omveier. Dette ville gjort omveiene unødvendige:

1. **`buildLayout` (`src/home/layout.js`) godtar et tomt `floor.polygon`.** Den tar sentroiden av stuas gulv uten sjekk
   (`polygonCentroid` på en tom liste krasjer). Omveien er et gulv med null areal i husets første hjørne (`mergeOnto` i
   `export.js`).
2. **`validateHouse` får et valg for hus uten eierens stue**, for eksempel `{ generic: true }`. I dag gir den alltid
   «rommet «stue-kjokken» mangler», og planbyggeren filtrerer akkurat den meldingen (`OWNER_ONLY_ERRORS`).
3. **`house.mjs` leser `node:fs`, `node:path` og `node:url` på modulnivå** (`HERE` og `ROOT`), så den kan ikke
   importeres i nettleseren. Omveien er erstatninger for akkurat den fila (`tools/planbygger-vite-plugin.mjs`,
   `src/planbygger/shims/`). Bedre ville vært å flytte stiene inn i funksjonene, eller å skille ut de rene delene.
4. **Ytterkledningen i `rooms.js` følger stuas tak**, med fallback til helningen 0,16216 fra x 3,22, så på et kundehus
   blir kledningen 3,35 m høy for x < 3,22 og lavere ellers. Et datafelt for taklinja, eller veggens høyde + 0,3 når det
   ikke finnes noe skrått stuetak, ville løst det.
5. **`createHome` (`src/home/index.js`) får en modus for et generisk hus** som hopper over `shell`, `kitchen` og
   `exterior` når spesen ikke har noen stue, og gir lys per rom fra `lightGroups` og `builtInLights`. Da kan et
   planbyggerhus lastes inn i det ekte spillet med katalog, maling og design.
6. **`stairs.js` gir en rett trapp ingen trinn.** `chains()` tar trappas ytterside som den lengste veien rundt
   fotavtrykket mellom toppen og foten. Det stemmer for den halvsvingte trappa langs sjaktveggene, men for en
   rektangulær, rett trapp er det feil side, så `stairLayout` gir 0 trinn og ingen kollisjon. Omveien er at `viewer.js`
   (`straightStairFix`) gir `buildStairs` en kopi der fotavtrykket er én langside (2 punkter): 13 trinn og 82
   kolliderere, mens husfila og validatoren beholder det ekte hullet. Rettingen er at `chains()` tar siden overfor den
   indre linja for `type: 'straight'`. Testet i `tools/test-planbygger.mjs` §9, og gangtesten bruker samme omvei.
7. **Dobbeltdører og skyvedører** i dørbyggeren og `validateHouse`: `door.variant: 'double'` (to blad, `leaf` og
   `leaf2`, hengslet i hver sin karm) og `'sliding'` (blad som skyves langs veggen, uten slagområde). Omveien er to
   dører side om side og en åpning. hus1, hus2, hus3 og hus5 har 13 skyvedører og 2 dobbeltdører, og hus6 6
   skyvedører, som i dag ikke blir dører i 3D.
8. **Takvinduer:** `rooms.js` bygger `ceilings[].skylights` (et hull i himlingen med glass og karm). I dag er de bare
   data, og `viewer.js` viser lyse felt som stedfortreder (hus1 har 4).
9. **Kvartsvingte trapper** (L-trapp med svingtrinn) i husformatet og `stairs.js`, og løp av ulik lengde. Omveien er en
   U-trapp med et notat (hus1). For hus8 finnes ingen omvei: etasjen over viser bare en sjakt på 0,94 × 1,8 m, der
   ingen rett trapp eller U-trapp får plass under 51,7°, så kjelleren kan ikke nås til fots før dette finnes. hus9 har
   også en kvartsvingt trapp i fasiten.
10. **Takform og skrå himling** i husformatet: saltak, pulttak, valm og ark, og en himling som følger taket
    («SKRÅ HIMLING 24°» på hus2, «Skråhiml.» på hus5, loftet i hus1). I dag står takformen bare i `doc.roof`, og
    himlingen er flat med én høyde per rom.
11. **Garasjeport** som egen åpningstype (leddport eller vippeport, bred og uten slagområde). Omveien er en åpning
    (hus7: én åpning på 5,2 m).
12. **Åpen romgrense:** en romkant uten vegg, for skillelinja mellom to soner (TV-stue og entré i hus4, Hall i hus9) og
    kuttene rundt en øy (hus2). Omveien er en vegg med tykkelse 0 og én åpning over hele lengden og høyden.
13. **En dør eller åpning i en vegg med samme rom på begge sider** (`connects: [rom, rom]`) i husformatet og
    `validateHouse`: et rom som går rundt en vegg, som bodfronten under trappa i hus3. Omveien er
    `connects: [rom, 'ute']`, og kildeteksten sier hvorfor.
14. **Vinduer og dører i samme plan som veggen** (`rooms.js`, `wallkit.js`). Rammen er like bred som hullet, så
    sidene ligger i planet til lysningen. Det samme gjelder den mørke foringen i ytterdører, som ligger på listen. Det
    flimrer (F3, F4, F6, F8 og F14 fra testingen). Omveien er at `viewer.js` (`separateCoplanar`) gir rammer og foringer
    forrang i dybden. Rettingen i byggeren er en ramme 2–3 mm smalere enn hullet.
15. **Gulv ut til glasset i vinduer som står på gulvet** (brystning 0). I dag stopper gulvet ved veggflaten, og bakken
    synes i bunnen av lysningen (F5). Omveien er en tynn gulvstripe i rommets gulvmateriale (`viewer.js`,
    `revealFloors`).
16. **Tette opptrinn som valg** i `stairs.js`. I dag er opptrinnene alltid åpne (F7).
17. **Stolpene over trappehullet:** de henger 0,45 m ned under gulvet. Det er en detalj fra eierens hus, og i
    planbyggerens hus ser det ut som stolpen står langt ned på veggen (F12). Det trengs et valg i husformatet,
    for eksempel `guardStyle.hang`.

## Åpne oppgaver i planbyggeren

Det agentene i runde 1 ba eierne av andre planbyggerfiler om, og som ikke er gjort:

- **`generate.js`:**
  - legg navnet på et merket rom etter merkets eget `at` når det havner i et annet endelig rom enn punktet i det
    foreløpige rommet (`semantics()`; hus6: ENTRE i vaskerommet);
  - la trappetypen fra tegningen vinne over KI-typen uten å spørre når trinnene gir en klar lesning (hus1);
  - to like navn i ett rom gir navnet én gang («WC/D», ikke «WC/D + WC/D» på hus3-foto);
  - `askAi('readFacade')` får `null` med en gang, fordi fasade-KI-en er av. Kallet kan hoppes over eller merkes som av.
- **`detect.js`:**
  - hus2 (55,7 px/m): strek-prikk-linja mellom BOD-nisjen (x 373–443, y 696–728 px) og ENTRÉ, ved y ≈ 729 og
    x ≈ 374–444, som skillelinje (eller nisjen som eget rom i `regions.js`);
  - hus9: strekene i trappesymbolet blir tynne vegger (øvre etasje, 44,7 px/m: x 388 og 399 på tvers av båndet
    y 208–251, og x 322 i enden mot passasjen fra Hall; underetasjen, 53,3 px/m: stubber ved x 388, 442, 469 og 483 fra
    y 193 til ca. 241). I dag tar `generate.js` dem bort (`dropTreadLines`, `stairEndLines`);
  - hus4 2. etasje (120 px/m): bjelken over trapperommet (y ≈ 456 px, x 352–1381) blir en vegg med en åpning på 5,59 m,
    der fasiten sier at trappa er åpen mot Stue/kjøkken;
  - hus8 kjeller: pipa mellom de to BOD-ene (x 564–603, y 897–952 px) som vegg;
  - hus9 underetasje-alternativet: åpningen mellom Stue og Sone (0,59 mot 0,9 m);
  - halvt åpne dører (hus3 2. etasje), vegger som to tynne streker og garasjeporter (hus7), og én strek som blir to
    parallelle vegger (hus9);
  - hus9 øvre etasje er følsom for skalaen: 25 vegger ved fasitskalaen 45,4 px/m, men 12 ved 50 px/m;
  - merkene som begrenser KI-en (hus6, hus3 1. etasje og hus3-foto, se «Merkene»).
- **Kode som leser `det.walls`:** veggene kan nå ha `axis: 'd'` (skrå, etter aksveggene, a → b langs +x).
  `model.applyDetection` og `regions.js` bruker bare a, b og t, og `autoscale.js` hopper over dem i aksemålene. Annen
  kode som antar `'h'` eller `'v'`, må sjekkes.
- **Testene:** `test-planbygger-autoscale.mjs` viser til Sonnet-opptak for hus1 og hus4 1. etasje som ikke finnes, og
  hopper over dem. I `test-planbygger-browser.mjs` bør `MAX_ERRORS` (hus1 2, hus2 11) bli 0, og del 11 kjøres på nytt.
- **`worker.js`, `app.js` og `guide.js`:** kjør `alignLevelTo` og kontrollen i arbeideren; kjør `generate(inputs, {
  answers })` på nytt når et svar om målestokk eller BRA flytter skalaen mer enn 4 % (i dag skaleres bare dokumentet);
  `KIND_TITLE.walls = 'Vegger'`.
- **Editoren:** la kunden slette, flytte og tegne skillelinjer. `leaf` og `leaf2` på en dobbeltdør følger ikke med når
  bredden endres i panelet.
- **`facade.js`**, før fasade-KI-en slås på igjen: et KI-tak høyst en halv stemme og aldri avgjørende ved likt, og
  KI-ens dør- eller vindustype bare der omrisset ikke avgjør. Med vekt 0,5 blir hus1 riktig.
- **KI-opptakene:** ta opp det som blir foreldet når kildefilene endres. Neste promptversjon bør beskrive
  skyvedørsymbolet (en pil langs veggen, ingen bue) og måles med plass-sjekkene.
- **Beslutninger for eieren:**
  - hus2: skal BOD-nisjen telles som åpen mot GANG og ENTRÉ (fasiten sier at den er åpen langs en strek-prikk-linje), og
    skal grensen «minst 13 rom med navn» stå? Haiku gir 12, Sonnet 13;
  - sidefeltet ved ytterdøra: fasiten for hus6 teller det ikke som vindu, mens fasitene for hus2, hus3 og hus5 gjør det.
    Fasitene er ikke endret, og gjenkjenningen behandler alle likt;
  - skal `DETECT_DEFAULTS.clean` være på? «Generer» sender alltid `clean: true`. Ryddingen koster 0,15–0,6 s per
    megapiksel, og testen til `clean.js` må da bruke `clean: false` som uryddet utgangspunkt;
  - skal KI-en være på for kunder, og med hvilket samtykke (se «Personvern og samtykke»)?
  - er brennvidden 0,58 × diagonalen (et 24–28 mm hovedkamera) riktig for telefonene kundene bruker?

## Filene

| Fil | Innhold |
|---|---|
| `planbygger.html` | siden (egen inngang i `vite.config.js`) |
| `src/planbygger/app.js` | sideflyten: startsiden, stabelen, «Generer», veiviseren, editoren («Finjuster»), lagring, filer, PDF |
| `src/planbygger/stack.js` | opplastingen (EXIF, PDF med lat lesing) og tegningsstabelen |
| `src/planbygger/generate.js` | «Generer»: alle tegningene → et dokument med etasjer, skala, rom, dører, trapp og vinduer |
| `src/planbygger/questions.js` | spørsmålene og `applyAnswers` |
| `src/planbygger/guide.js` | veiviseren med ett kort per spørsmål |
| `src/planbygger/detect.js` | gjenkjenningen |
| `src/planbygger/clean.js` | rydding før veggene |
| `src/planbygger/sheet.js` | flere tegninger på ett ark |
| `src/planbygger/photo.js` | foto av en utskrift |
| `src/planbygger/autoscale.js` | målestokken i lag |
| `src/planbygger/align.js` | etasjer oppå hverandre og trappefinneren |
| `src/planbygger/facade.js` | fasader: takform, vinduer, dører og vindushøyder |
| `src/planbygger/marks.js` | merkene KI-en leser |
| `src/planbygger/ai.js` | KI-klienten (`aiStatus`, `aiRead`, `AI_FACADE_USE`) |
| `src/planbygger/image.js` | rasteroperasjoner (terskel, morfologi, løpelengder, komponenter, avstandskart) |
| `src/planbygger/geom.js` | geometri (polygoner, klipping, avstander) |
| `src/planbygger/scale.js` | skalaforslag og festing til målelinjer (v1) |
| `src/planbygger/model.js` | plandokumentet og redigeringsoperasjonene (`OPENING_KINDS`, `setOpeningKind`) |
| `src/planbygger/regions.js` | rom fra vegger, med skillelinjer, øyer og skrå vegger (`levelRooms`) |
| `src/planbygger/export.js` | husformatet, registeret og rammen |
| `src/planbygger/editor.js` | 2D-editoren |
| `src/planbygger/viewer.js` | 3D med spillets byggere |
| `src/planbygger/worker.js` | gjenkjenningen og de tunge stegene i «Generer» i en Web Worker |
| `src/planbygger/style.css` | sidens stil |
| `src/planbygger/shims/` | nettleserutgaver av `node:fs`, `path` og `url`, bare for `house.mjs` |
| `server/planbygger-ai/index.mjs` | KI-serveren: mellomvaren, vernet og hurtigbufferen |
| `server/planbygger-ai/prompts.mjs` | oppgavene, JSON-skjemaene og promptene (`PROMPT_VERSION`) |
| `server/planbygger-ai/package.json` | KI-serverens egen avhengighet (`@anthropic-ai/sdk`) |
| `plantegninger/` | testsettet: ti hus med `fasit.json`, og PNG-kopier i `_png/` (`README.md`) |
| `notes/planbygger-runde1-design.md` | design og kontrakter for runde 1 |
| `tools/test-planbygger.mjs` | v1-testene |
| `tools/test-planbygger-<modul>.mjs` | modultestene: `detect`, `ai`, `autoscale`, `sheet`, `photo`, `clean`, `align`, `facade`, `generate` |
| `tools/test-planbygger-build3d.mjs` | husfila i spillets byggere, og gangtesten i trappene |
| `tools/test-planbygger-browser.mjs` | siden ende til ende i hodeløs Edge (`--lock` tar GPU-låsen) |
| `tools/planbygger-measure.mjs` | målingene mot eierens hus (`--write` oppdaterer denne fila) |
| `tools/planbygger-measure-all.mjs` | målingene per hus (`--write` oppdaterer denne fila; `--record` tar opp KI-svar; `OPEN_PLANS`; gangen i trappene) |
| `tools/planbygger-ai-fixtures.mjs` | avspilling av KI-opptakene i Node og plass-sjekkene (`BY_EYE`) |
| `tools/planbygger-ai-record.mjs` | opptak av enkeltsvar fra KI-en (bare med nøkkel) og `--compare` |
| `tools/fixtures/planbygger-ai/` | KI-opptakene (87) |
| `tools/fixtures/clean/plans.json` | fasiten og de godtatte verdiene for ryddingen |
| `tools/fixtures/planbygger-autoscale/` | testdata for målestokken |
| `tools/planbygger-truth.mjs` | sammenligningen med fasiten (eierens hus) |
| `tools/planbygger-corrections.mjs` | rettingene som editorhandlinger |
| `tools/planbygger-synth.mjs` | syntetiske planer med fasit (også dørvarianter, takvinduer og U-trapper) |
| `tools/planbygger-debug.mjs` | tegner gjenkjenningen over en plan (`--clean`, `--rooms`) |
| `tools/planbygger-png.mjs` | PNG-lesing og -skriving for Node |
| `tools/planbygger-lib.mjs` | felles testkode |
| `tools/planbygger-vite.config.mjs` | testserveren (port 5270–5279) |
| `tools/planbygger-vite-plugin.mjs` | erstatningene for `house.mjs` i nettleseren og KI-ruta i Vite |
