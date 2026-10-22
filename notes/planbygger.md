# Planbygger: fra kundens tegninger til 3D-hus

Skrevet 2026-10-21 (v1) og 2026-10-22 (runde 1) på grenen `claude/planbygger-5d0fe3` (kuttet fra `hele-huset`). Siden
er `planbygger.html` (egen vite-inngang). Koden ligger i `src/planbygger/`, KI-serveren i `server/planbygger-ai/`, og
verktøy og tester i `tools/planbygger-*` og `tools/test-planbygger*.mjs`. Designet og kontraktene for runde 1 står i
`notes/planbygger-runde1-design.md`, og testsettet i `plantegninger/` (`plantegninger/README.md`).

Planbyggeren gjør én ting: en kunde laster opp tegningene av sitt eget hus, og får et 3D-hus hen kan gå rundt i.

- **v1, én plan:** kunden setter målestokken, gjenkjenningen foreslår vegger, dører og vinduer, og kunden retter
  forslaget i editoren. Alt skjer i nettleseren, uten server og uten KI.
- **Runde 1, «Generer»:** kunden slipper alle tegningene sine, plantegninger og fasader, og trykker «Generer».
  Planbyggeren ordner etasjene, finner målestokken og rommene, spør bare om det den ikke finner selv, og åpner
  3D-huset. Editoren fra v1 heter nå «Finjuster».

Prinsippet er at KI forstår og klassisk bildebehandling måler. KI-en (Claude, valgfri) leser tekst og symboler på en
nedskalert kopi av tegningen og svarer med strukturert JSON. Alle mål og koordinater kommer fra den klassiske
gjenkjenningen i nettleseren. Uten KI virker alt, bare med flere spørsmål: 120 mot 26 på de ti testhusene.

## Prøv den

```
npx vite --config tools/planbygger-vite.config.mjs --port 5270
```

Åpne `http://127.0.0.1:5270/planbygger.html`.

- **«Generer»:** slipp alle filene i én av mappene under `plantegninger/` på startsiden «Slipp alle tegningene her».
  `hus3` er et godt første hus (`1etg.png`, `2etg.png` og `fasader.png`). Trykk «Generer», svar på kortene eller trykk
  «Hopp over resten», og huset åpnes i 3D.
- **KI:** testserveren svarer på `/api/planbygger/ai` når `ANTHROPIC_API_KEY` er satt i miljøet og SDK-en er
  installert i KI-serverens egen mappe (`npm ci --prefix server/planbygger-ai`, aldri i roten). Ellers sier stabelen
  at KI er av, og «Generer» går uten.
- **v1, én plan:** «Prøv med eksempelplanen» (det er `plantegning.png`). Klikk på målelinja «12.21 m» til høyre, skriv
  `12,21`, og trykk Enter. Etter et halvt sekund står forslaget der. Rett det, og trykk «Gå rundt i 3D». «Bare én plan
  …» gjør det samme med en egen fil.

`npm run build` tar med siden (`dist/planbygger.html`), og `server.mjs` serverer den bak samme innlogging som spillet.
KI-ruta er ikke montert i `server.mjs` ennå (se «KI-laget»), så på nettet går «Generer» uten KI.

## Runde 1: «Generer»

### Flyten på siden

1. **Slipp tegningene** (`stack.js`, `decodeFile`). Mange filer på én gang: PNG, JPG, WebP, AVIF og PDF.
   - Bildene leses med EXIF-retningen (`createImageBitmap(file, { imageOrientation: 'from-image' })`), så et mobilfoto
     står riktig. En JPEG gir også brennvidden (`FocalLengthIn35mmFilm` / 43,27) videre til `rectifyPhoto`.
   - **PDF:** hver side blir en tegning. En skannet side gjengis i skannets egen oppløsning, opptil 6000 px, samme
     grense som for et bilde. Da får nettleseren nøyaktig det bildet Node-testene leser (hus7: 4771 × 3332 px). En
     vektorside gjengis med 200 dpi, høyst 4000 px. `pdfPage: { widthPt, heightPt, widthPx, heightPx }` følger med til
     målestokken. pdf.js hentes fra jsDelivr først når noen åpner en PDF.
   - **PDF med flere sider** leses lat. Hver side får først et miniatyrbilde og en analyse ved 2000 px. Ved «Generer»
     gjengis bare sidene som brukes, i full størrelse, og etterpå slippes de fra minnet. Høyst 40 sider tas med, og
     stabelen sier fra om resten. «Bare én plan» bruker bare side 1.
2. **Stabelen** (`stack.js`). Etasjene står med miniatyr, øverste etasje øverst, og fasadene og «Annet» ved siden av.
   - Hver tegning har en merkelapp: Etasje, Fasade eller Annet. Den kommer fra `splitSheet` og `isPhoto` i arbeideren.
     Et ark med flere tegninger sier «Arket har 4 tegninger … – de deles opp». «Annet» tas ikke med.
   - Kortet sier hvorfor tegningen står der, for eksempel «2. etasje fra filnavnet». En tegning uten etasje i navnet
     plasseres av «Generer» etter tittel og innhold.
   - Et kort kan dras til ny plass. Da står det «plassert av deg», og rekkefølgen går til `generate` som `input.level`.
     En merkelapp kunden har endret på en fil med én tegning, går som `input.kind`. Begge vinner over filnavn,
     `sheet.js` og KI.
   - Stabelen viser om KI er på. Er den på, står det at en nedskalert kopi av tegningene sendes til KI-tjenesten.
3. **«Generer»** (`generate.js`) med fremdrift: en stolpe, steget som pågår og de siste stegene. Stegene står under.
4. **Veiviseren** (`guide.js`): ett kort per spørsmål. Kortet har et utsnitt av tegningen med boksen markert,
   spørsmålet, hjelpeteksten, sikkerheten («Sikker», «Ganske sikker», «Usikker») og et ferdig utfylt svar. Knappene er
   «Tilbake», «Hopp over resten» og «Neste» (Enter). «Hopp over resten» beholder de utfylte svarene.
   - Til `applyAnswers` går svarene som er endret, og rommene kunden har sett. Navnene deres regnes da som bekreftet.
   - Velger kunden den andre av to alternative tegninger, eller et nytt foto, kjøres «Generer» på nytt med svarene.
5. **Rett i 3D.** Øverst står «Finjuster», som åpner v1-editoren på det genererte dokumentet med tegningene som
   bakgrunn, og «Tegningene», som går tilbake til stabelen. Dokumentet lagres som før, så «Fortsett med …» virker også
   for et generert hus.

**Editoren og panelet** kjenner de nye tingene:
- Typemenyen bruker `OPENING_KINDS` og `setOpeningKind` (`model.js`): Dør, Dobbeltdør, Skyvedør, Vindu og Åpning uten
  dør. Type og variant endres sammen.
- En dobbeltdør tegnes med to buer fra hver sin karm (`leaf` og `leaf2`).
- En skyvedør tegnes med to forskjøvne blad og en dobbel pil, uten bue. Panelet skjuler «Åpningsvinkel» og «Snu
  hengselen», og H gjør ingenting på en skyvedør.
- Takvinduer tegnes stiplet med kryss, og skillelinjer mellom åpne soner som strek-prikk-linjer. De kan ikke redigeres
  ennå.

**I arbeideren** (`worker.js`) kjøres de tunge stegene gjennom `opts.exec`: `rectifyPhoto`, `splitSheet`,
`cleanForWalls`, `detectPlan`, `autoScale`, `readFacade` og `findStairs`. Arbeideren sender bare rene data tilbake:
gjenkjenningen som `{ walls, openings, skylights, stairs, separators, stats }`, uten feilsøkingsrasterne. Kan et
argument ikke sendes, kjøres steget på hovedtråden. Med arbeideren gir alle ti husene nøyaktig det samme som de
direkte kallene (målt uten KI). `alignLevelTo` og kontrollen kjører fortsatt på hovedtråden: 1,5–2,3 s per hus
(hus4 gikk fra 5,7 til 2,3 s uten KI).

### Stegene i «Generer»

`generate(inputs, opts) → { doc, questions, report, images }`. `inputs` er `[{ name, img, pdfPage?, focal?, kind?,
level? }]`. `opts.ai` er KI-en eller `null`, og `report` sier hvilken metode hvert steg brukte og hvor sikker den er.

1. **Fotoer** går gjennom `rectifyPhoto`. Den avslår digitale tegninger selv. Et foto den er usikker på, blir et
   spørsmål om et nytt bilde. Et ark som går ut av bildet, blir et spørsmål om formen.
2. **Ark med flere tegninger** deles med `splitSheet` og `cropImage`. KI-svaret `classify` avgjør fasade eller snitt,
   og gir titler, etasjenavn og om en plan er en egen bygning (en garasje ved siden av huset).
3. **Like tegninger** brukes én gang, med et notat (hus8 har de samme planene på ett ark og hver for seg). Sier navnene
   ulike etasjer (2etg og 3etg), brukes begge. En liten plan ved siden av huset tas ikke med som etasje.
   «…-alternativ» blir et valg mellom to tegninger (hus9).
4. **Per plan:**
   1. en foreløpig skala: `autoScale` uten KI, eller arvet fra en sikrere etasje i samme tegnesett;
   2. merker (`marks.js`) og `readPlan` på den merkede planen;
   3. `estimateScale` med KI-svaret, PDF-siden, BRA og de andre etasjenes resultater. Flytter skalaen seg mer enn 4 %,
      kjøres `autoScale` på nytt der;
   4. `detectPlan` på den endelige skalaen, med `clean: true`;
   5. semantikken: romnavn og romtyper (KI-punktene legges i rommene som ble funnet), dørvarianter, takvinduer og
      trappesymboler.

   Planer fra ulike tegnesett måles side om side, så KI-svarene kommer samtidig.
5. **Etasjene ordnes:** filnavn, så titler (KI), så innhold. Inngang og kjøkken gir hovedetasjen, takvinduer gir
   øverste etasje og kjellerord nederste.
6. **Etasjene legges oppå hverandre** med `alignLevelTo` og plantegningene. En trapp legges inn der begge etasjene
   viser den. Halvsvingt blir U-trapp. Kvartsvingt blir også U-trapp, med et notat, fordi husformatet ikke har
   kvartsvingte trapper.
7. **Fasadene** gir takformen (`houseRoof`) og brystning og høyde per etasje til vinduene (`facade.js`). Fasader fra
   samme ark deler skalaen fra den sikreste dørlesningen. Uten fasader får vinduene standardhøyder per romtype.
8. **Kontrollen:** huset eksporteres og valideres med spillets `validateHouse`. Det `generate` kan rette selv, rettes og
   noteres: slagretning og hengsel på dører (D6), en åpning oppå en annen, vegglinjer som skifter tykkelse med noen
   millimeter, og en vegg som er funnet to ganger noen centimeter fra hverandre. Det siste beholdes bare når det gir
   færre feil.
9. **Spørsmålene** lages (`questions.js`).

**Regler som kom etter målingene:**

- **Samme tegnesett.** Bare to tegninger fra samme ark, eller to bilder med lik størrelse og stil (`similarSource`),
  arver målestokken direkte. Filer med samme veggtykkelse, men ulik bildestørrelse, arver bare når omrisset av huset
  stemmer (likt, eller én zoomfaktor). En arvet målestokk som omrisset ikke bekrefter, blir et spørsmål.
  - Hvorfor: hus9 har to filer med ulik skala (fasit 45,4 og 54,1 px/m). Med arv ble «Øvre etasje» +17 %, med 5 vegger
    og 0 rom. Nå er den −1,6 %, med 24 vegger og 5 av 5 rom.
- **Tomme etasjer.** En etasje som blir tom med en arvet skala, måles på nytt for seg, med det samme KI-svaret. Er den
  fortsatt tom, prøves gjenkjenningen uten rydding, så konturlinjer, så den foreløpige gjenkjenningen.
  - Konturlinjer: to tynne streker per vegg fylles. En side som står åpen (garasjeporter), lukkes med en vegg og en
    åpning, og løse vegger av tekst og mållinjer fjernes.
  - Er etasjen fortsatt tom, kommer spørsmålet «walls» (uten svarfelt) og et notat om å tegne den i «Finjuster».
  - hus7: garasjen får nå ett rom på 30 m², med porten som én åpning på 5,2 m.
- **KI-dørene.** KI-en bestemmer varianten bare der den klassiske lesningen er svakest: en slagdør på minst 1,05 m som
  KI-en kaller dobbeltdør, og en åpning i en innervegg som KI-en kaller skyvedør. Alle andre endringer KI-en ville
  gjort, ga feil antall på hus2, hus3 og hus5.
- **KI-kallene.** Høyst 3 svar ventes på samtidig (`opts.aiConcurrency`). Hvert arks `classify` sendes mens de neste
  arkene deles. I en simulering med 6,6 s per kall gikk hus1 fra 61 til 35 s og hus4 fra 79 til 53 s.
- **Robusthet.** Et KI-svar som `{}`, eller en utfører som gir `null`, krasjer ikke. To filer med samme navn får hvert
  sitt navn. Uten plantegninger kommer et notat. Navn som «GARASJE 30,25» blir navn og areal.

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
| `stair` | typen er usikker, trappa går over en vegg eller har ikke noe rom under, eller bare KI-en ser den | rett, U eller ingen |
| `order` | rekkefølgen er usikker | etasjene nedenfra og opp |
| `alternative` | to alternative tegninger av samme etasje | hvilken (kjører «Generer» på nytt) |
| `photo`, `shape` | usikkert foto, eller arket går ut av bildet | nytt bilde, eller bekreft formen |
| `facade` | fasaden har bare vegghøyden som skala | vegghøyden fra bakken til takfoten |
| `walls` | en etasje uten vegger eller rom | ikke noe svar: etasjen tegnes i «Finjuster» |

`guide.js` mangler foreløpig overskriften for `walls` (`KIND_TITLE.walls = 'Vegger'`), så kortet står uten type.

### Målt i nettleseren

Nettlesertesten kjører «Generer» på hus3 ende til ende, og med `--only=hus` på alle ti husene (se «Testene»).

| | hus3 uten KI | hus3 med opptakene |
|---|---|---|
| «Generer» | 14–16 s | 12–17 s |
| Spørsmål | 13 (skala 2, takhøyde 2, rom 9) | 2 (takhøyde 2) |
| 3D | 2 etasjer, 0 feil, 5 advarsler, 105 kolliderere | 2 etasjer, 0 feil, 6 advarsler, 106 kolliderere |
| Gikk med W i 1,2 s | 2,66 m | 2,66 m |
| Skala | | +0,5 % i 1. etasje, 0,0 % i 2. etasje |
| Rommene i 1. etasje | Stue, Entré, Bod | Kjøkken/stue + Entré, Vask, WC/D |

- **Opptakene i nettleseren** spilles av gjennom testserverens egen KI-rute. Sidens egen KI-klient (`ai.js`) brukes
  uendret: den skalerer ned, lager PNG, sender og rydder svaret. Svaret velges etter samme bilde, så samme merker, så
  plassen. På hus3 ga 4 av 5 kall nøyaktig samme bilde og 1 samme merker.
- **Alle ti husene** (`--only=hus`, uten KI og med opptakene): 60 sjekker grønne og 2 røde.
  - **hus7 uten KI er et tomt hus:** 9 vegger og 0 rom, og veiviseren spør om veggene. Node får det samme.
  - **hus9 med opptakene har 1 feil i validatoren:** veggene `w-vask-5` og `w-bod-1-4` overlapper. Node har 0 feil på
    PNG-kopiene, men får den samme feilen med bildene slik Edge dekoder JPEG-ene. Gjenkjenningen er altså følsom for
    hvilken JPEG-dekoder som brukes.
  - En skannet PDF-side gjengis som det samme bildet som Node-testene leser (snittavvik 0,01–0,02 grånivåer). hus7,
    som før ble gjengitt mindre, gir nå nøyaktig samme resultat i nettleseren som i Node.
- **Gåing** er bare bevist i nettleseren på hus3. For de andre husene sjekker testen etasjer, vegger, rom og
  validatoren, ikke at man kan gå.

## Flyten med én plan (v1)

Dette er «Prøv med eksempelplanen» og «Bare én plan …» på startsiden, og editoren bak «Finjuster».

1. **Last opp.** PNG, JPG eller WebP. PDF går også: første side tegnes med pdf.js, som hentes fra jsDelivr bare når
   noen faktisk åpner en PDF, så bygget får ingen ny avhengighet. Siden har en slippsone og en eksempelknapp.
   En skjev plan (skannet eller fotografert rett ovenfra) rettes opp med en gang, se «Skjeve planer» under. Vinkelen
   står i etasjepanelet («Rotasjon», med «Rett opp» for å finne den på nytt).
2. **Skala.** Kunden klikker på en målelinje. Linja festes til endene sine, også over den hvite tekstboksen midt på
   (`scale.js traceLine`), og kunden skriver bare inn tallet som står på den. Det går også an å klikke to vilkårlige
   punkter. «Foreslå automatisk» gir et forslag uten OCR. Først antas den tynneste vanlige veggen å være 10 cm. Så
   antas medianen av dørhullene gjenkjenningen finner, å være 90 cm (9M-døra). Forslaget bommet med +1,8 % på
   1. etasje og −0,5 % på kjelleren. Det vises som en 2 m lang linje kunden kan sjekke mot en målelinje.
3. **Gjenkjenning** (`detect.js`, i en Web Worker). Den tar 0,3–0,5 s på små planer og 1–2 s på store (hus4, hus7).
4. **Retting** i 2D-editoren (`editor.js`). Rommene regnes ut på nytt etter hver endring.
5. **Etasjer og trapp.** «+ Etasje» legger til en etasje med sin egen plantegning, skala og gulvhøyde. «Juster
   ytterhjørnet mot hovedetasjen» (NØ, NV, SØ, SV) legger hjørnet av ytterveggene oppå hovedetasjens. Det er samme regel
   som nattarbeidet brukte for kjelleren (avstemming V1: ytterflatene i flukt). Hovedetasjen vises stiplet over den
   andre etasjen. Trappeverktøyet (T) tegner en trapp ned til etasjen under: du drar hullet fra toppen mot foten, og
   hjørnene festes til veggflatene. Antall opptrinn regnes ut fra gulvhøydene, og rekkverket settes på de frie sidene.
   Trappa kan være rett eller en U-trapp. U-trappa (spillets `half-turn-winder`) går ned langs den ene halvdelen,
   svinger rundt et smalt øye med svingtrinn og kommer tilbake langs den andre halvdelen, med rekkverk rundt øyet.
   Dører har en åpningsvinkel. Gangdøra i eierens hus må stå på 180° (D6), ellers gir validatoren under 0,75 m fri
   bredde mot trapperekkverket.
6. **3D** (`viewer.js`). Huset bygges med spillets egne byggere og kan sees ovenfra som et dukkehus eller gås rundt i.
   Dørene åpnes med E eller et klikk.
7. **Last ned.** «Husfil» er formatet i `research/house/NN-*.json`. «Prosjektet» er dokumentet med plantegningene,
   og kan åpnes igjen. Dokumentet lagres også i nettleseren mens kunden jobber (localStorage, og bildene i IndexedDB).

## Gjenkjenningen: klassisk bildebehandling

Alle konstantene står i `DETECT_DEFAULTS` i `src/planbygger/detect.js`. Et mål i meter blir piksler gjennom skalaen.

0. **Skjeve planer** (`estimateSkew`). Vinkelen er den der de mørke pikslene hoper seg opp i færrest rader og
   kolonner (projeksjonsprofiler: summen av kvadrerte radtellinger, søkt over ±10° i steg på 0,5° og så 0,05°). Bildet
   dreies tilbake bilineært før alt annet (`rotateImage`), og planens ramme er det opprettede bildet. Testet:
   1. etasje dreid 1,5°, −3,2° og 6°, kjelleren 2,2° og en syntetisk plan −4° – vinkelen ble funnet eksakt (± 0,05°), og
   gjenkjenningen ga de samme veggene, dørene og vinduene, under 0,3 cm fra den rette planen. Rette planer får 0°, og
   bildet røres ikke da. Perspektiv (et skrått foto) rettes ikke her, men i `photo.js`.
1. **Gråtoner og blekkmaske.** Terskelen ligger i den første dalen etter det svarte toppunktet i histogrammet: søket
   stopper der kurven stiger mot neste topp. Den ble 11 på 1. etasje og 12 i kjelleren. Grå møbler, benker og
   skravur blir dermed ikke vegg, heller ikke når en dreiing har gjort kantene grå (da steg den gamle regelen, «midt i
   den bredeste dalen», til 89 og tok med salongbordet). På en kopi vi selv har skalert opp (planer under 50 px/m)
   brukes den dypeste dalen: der er de blandede kantpikslene en del av veggen (terskel 87 ved 35 px/m).
   - **Grå vegger** (lysere enn den svarte teksten): finner den svarte terskelen nesten ingen vegger, prøves toppene i
     histogrammet som et grått bånd ut til dalene på hver side. Båndet som gir flest lange veggløp, vinner
     (`autoWallTone`).
   - **Prøv veggfargen:** i etasjepanelet kan kunden velge «Veggfarge – Velg» og klikke på en vegg. Tonen under klikket
     gir båndet −25/+20.
   - **Testet:** grå vegger på 70, 115 og 150 finnes automatisk på de syntetiske planene.
2. **Åpning med et lite kvadrat** (3×3 ved 50 px/m). Strøk som er tynnere enn den tynneste veggen, forsvinner: tekst,
   mållinjer, dørbuer og vinduslinjer. Små klumper under 12 cm (pilspisser, fet tekst) fjernes.
   Planer under 50 px/m tolkes på en bilineært oppskalert kopi (2–3×). Ellers ville en vegg på 10 cm (3,5 px) også
   forsvunnet. Fra den andre siden er 1. etasje testet i 2× og 4× oppløsning (7,5 MP, som en skanning), med samme
   resultat på 0,5–1,7 s. Splinter kortere enn 60 % av veggtykkelsen fjernes, siden de ellers sperrer hullanalysen
   ved høy oppløsning.
3. **Lange løp per akse.** Piksler i horisontale eller vertikale løp som er lengre enn den tykkeste veggen (0,5 m), blir
   veggbiter langs den aksen. Det som blir igjen (korte stubber mellom vinduer, stubber ved et hjørne), beholdes når
   det ligger i båndet til en veggline, eller står på flaten av en vegg på tvers.
4. **Rektangler med subpikselpresisjon.** Hver bit deles der utstrekningen på tvers endrer seg. Senter og tykkelse
   regnes så ut ved å integrere mørkheten på tvers av veggen. Den måles mot den mørkeste av de to sidene, så en grå
   benk inntil veggen ikke gjør veggen tykkere. Tykkelsene ble 0,10 og 0,16 m på 1. etasje, slik planen er tegnet.
5. **Sammenslåing og skjøter.** Kolineære biter med samme bånd slås sammen. En vegglinje som skifter tykkelse, blir to
   vegger som møtes ende mot ende. Frie ender festes inn i en vegg på tvers: L-, T- og X-skjøter.
6. **Hull i veggene.** Hull mellom kolineære biter, og fra en fri ende til neste vegg, undersøkes slik:
   - **Søyler:** hullet deles ved søyler (kolonner som er mørke på tvers av hele veggen).
   - **Dør:** en dør er en kvartsirkel av tynne, mørke prikker. Buen leter etter hengselpunkt langs hullet, begge
     retninger, begge sider og radier fra 0,55 til 1,05 m. Hvert punkt på buen må være en tynn strek med papir på begge
     sider, og en grå sofa under buen teller ikke. En bue som går gjennom vegg, er umulig. Grensen er at minst 60 % av
     buen er tegnet: ekte dører fikk 0,92–1,0, og de beste feiltreffene 0,46. Det som er igjen av hullet ved siden av
     døra, blir sidefelt (vindu) hvis det er over 30 cm.
   - **Vindu eller åpning:** linjer langs veggen i båndet gir vindu i en yttervegg og åpning i en innervegg.
   - **Tomme hull:** et tomt hull under 1,3 m blir en åpning, men bare når biten henger fast i veggnettet i den andre
     enden. En frittstående mørk blokk (et bord) ved en vegg vokser altså ikke inn i veggen. Lengre tomme hull er ikke
     åpninger. Et hull med linjer kan være opptil 14 m (glassvegger og vindusrekker).
7. **Nettverk og ytterside.** Vegger som ikke henger sammen med hovednettverket, fjernes (møbler, tekst). Yttervegger
   finnes ved å flomfylle papiret fra bildekanten med veggene lukket.

Uten KI kan romnavn ikke leses (det finnes ingen OCR), så romtypen gjettes med regler (`guessKind` i `export.js`):

| Regel | Romtype |
|---|---|
| Det største rommet | stue |
| Lite rom med ytterdør | entré |
| Minst tre dører eller åpninger | gang |
| Uten vindu og under 12 m² | bod |
| Under 7 m² | bad |
| Resten | soverom |

Det ga riktig type for 11 av 12 rom i eierens hus (vaskerommet ble soverom). Navnene vises med «?» til kunden har
bekreftet dem. På de ti testhusene ga reglene riktig type for 27 av de 50 rommene «Generer» fant uten KI. Med KI
kommer navnene og typene fra tegningen (`readPlan`).

### Nytt i runde 1: dørvarianter, takvinduer, trapper og rydding

**Dørvarianter.** `openings[].variant` er `'single'`, `'double'` eller `'sliding'`.
- **Dobbeltdør:** to buer fra hver sin karm. Det andre bladet er en bue med samme slagside fra den andre karmen, med en
  spiss som møter den første innen 15 cm. Smale blad under `doorMin` får et eget søk med halv bredde.
- **Skyvedør:** et hull der tynne linjer langs veggen dekker 25–80 % av hullet fra én karm, eller to forskjøvne blad
  fra hver sin karm. Et blad må være minst 35 cm: ekte skyvedørblad ble målt til 0,41–1,31 m, de falske til 0,18–0,34 m
  (kanten av et teppe, et badekar, en åpen passasje).
- **Modellen:** varianten følger med i dokumentet (`variant`, `leaf2`). En skyvedør har ikke noe slagblad.

**Takvinduer.** `skylights: [{ x0, y0, x1, y1 }]` er stiplede rektangler inne i rom: 0,5–1,5 × 0,6–1,8 m, minst tre av
de fire sidene tegnet og ikke inntil en vegg. hus1 2. etasje gir 3 av 4 uten KI og 4 av 4 med KI (det fjerde kommer
fra `readPlan`).

**Trapper.** `stairs: [{ bbox, axis, treads, kind }]`.
- **Løp:** minst fire jevnt fordelte, parallelle tynne linjer, 60–170 cm lange og 14–40 cm fra hverandre. Hyllene i en
  garderobe er kortere.
- **Svingtrinn** er linjer som går ut fra ett punkt. Tre linjer som møtes i ett punkt, fordeler stemmene sine på to
  celler. De skrå linjene på 1 px, som blir prikker i bildet, finnes også.
- **Typen bestemmes av løpene først:** to løp side om side gir halvsvingt, og to løp i rett vinkel gir kvartsvingt,
  uansett hvor bred vifta mellom dem er. Svingtrinn i begge ender av ett løp gir halvsvingt (hus6). Finnes ingen slike
  løp, avgjør vifta alene.
- **Trapper rundt et smalt øye**, der hvert trinn er et svingtrinn (hus4): først finnes klynger av lange skrå streker,
  heltrukne og stiplede. Øyet er et vindu på 0,5 × 1,6 m som holder den indre enden av minst 8 linjer i 6 retninger.
  Går minst 3 linjer ut til hver side av øyet, er trappa halvsvingt.
- Et viftepunkt eller midten av et løp på et veggbånd regnes ikke som inne i et rom.

**Ikke vegger.** Stiplede linjer (takkant, «Plan himling», bjelker), fliser og rutenett utenfor huset, og gulvskravur
blir aldri vegg- eller vinduslinjer. Tregulvskravuren i hus4 gir 0 vegger, både med og uten rydding.

**Hall og bod i hus1** ble ett rom i fase A. El-skapet er tegnet over halve veggen mellom dem, og feltet med linjer
ble en åpning. Nå blir to halvdeler som ligger flate mot hverandre, én vegg, og linjer i et hull under 0,6 m i en
innervegg er noe som er montert på veggen.

**Svake buer over tegnede vinduer.** I noen stiler (hus8) er dørbåndet tegnet akkurat som et vindu, og ytterdørene har
svake buer. En svak bue over et tegnet vindu (under 75 % av buen, eller under 85 % uten blad) er en dør bare når døra
fyller hullet, og bladet er tegnet eller minst 80 % av buen er tegnet. Lenestoler ved glasset (hus5), en stiplet
kryssboks (hus2), et dusjkar (hus9) og en trapp (hus1) blir dermed ikke dører. Ligger midten av buen på en trapp som
finnes senere, blir hullet vinduet det er tegnet som.

**Rydding.** `detectPlan(img, { clean: true })` kjører `cleanForWalls` (`clean.js`) først, i bildets egen oppløsning og
aldri to ganger. «Generer» sender alltid `clean: true`. `DETECT_DEFAULTS.clean` er fortsatt `false`, så v1 og
testene står stille. Uten rydding gir hus4 2. etasje, hus6 og hus9 nesten ingenting.

**Fart.** Symbolene søkes bare i boksen rundt rommene veggene lukker. Grå vegger prøves før noe annet, buetesten
stopper når resten av punktene ikke kan nå 45 %, og utsiden fylles linje for linje. Tider i Node uten rydding, beste
av to (fase A):

| Plan | Før runde 1 | Nå |
|---|---|---|
| hus1 1. etasje | 0,41 s | 0,41 s |
| hus2 | 0,97 s | 0,83 s |
| hus4 1. etasje | 2,35 s | 1,83 s |
| hus6 | 0,88 s | 0,72 s |
| hus7 | 1,86 s | 1,74 s |
| hus3-foto | 0,67 s | 1,04 s |

Ryddingen legger til 0,15–0,6 s per megapiksel (se `clean.js`). Fotoet ble tregere fordi buesøket bruker 0,5 s i sju
lange glassfelt i støyet. Å stoppe søket over 3,6 m ville miste en ekte ytterdør i hus3.

### Nytt i runde 1: skillelinjer mellom åpne soner

En åpen plan har ofte en strek-prikk-linje der to soner møtes (TV-stue og entré i hus4). Det er ikke en vegg.

- **Kontrakten:** `detect.js` gir `separators: [{ a, b }]` i piksler, `model.js` gir `level.separators` i meter (de
  skaleres med `rescaleLevel`), og `regions.js` deler rommene med `findRooms(walls, { separators })`, eller enklere
  `levelRooms(level)`. Romkanten langs en skillelinje har `wall: null`, `side: 0` og `separator: id`.
- **Metoden:** veggbåndet leses kolonne for kolonne i hull som er lengre enn en passasje (1,3 m). Den mørkeste pikselen
  må stige over midten mellom strekenes blekk og papiret minst 3 ganger og 3 ganger per meter, med streker på høyst
  60 cm og brudd på høyst 20 cm. Da er linjene streker, ikke vinduslinjer, og hullet blir en skillelinje i stedet for en
  åpning eller en skyvedør. Under ca. 45 px/m leses planen på en oppskalert kopi, og der er det åpne hullet selv
  kandidaten.
- **Målt:** på den syntetiske åpne planen ble linja funnet uten noen vegg langs den ved 35–120 px/m, med og uten
  rydding (2 → 3 rom, TV-stua ± 0,3 m²). hus4 1. etasje: TV-stua blir eget rom (12,3 m²) og Entré + gang et annet
  (16,5 m²). hus9 øvre etasje: kanten av Halls flisgulv leses som en stiplet linje mellom to veggender, og Hall blir
  eget rom med 9,06 m² (fasit 9,07). Det er en gulvkant, ikke en tegnet strek, men den ligger der rommene møtes. Ingen
  andre hus fikk skillelinjer.
- **Forkastet:** uten grensene for lengde og regelmessighet slo regelen til på en flislagt WC-vegg (hus2), på hus4s dør
  og vindu og på skannestøy (hus6).
- **Det gjenstår:** ingen av forbrukerne bruker skillelinjene ennå. `generate.js`, `export.js`, `autoscale.js` og
  `tools/planbygger-ai-record.mjs` kaller `findRooms(L.walls)` uten dem. Delingen når derfor ikke «Generer», eksporten
  eller 3D-huset, bare editoren (som tegner dem) og feilsøkingsverktøyet.

### Nytt i runde 1: hus9 og falske skyvedører

Da vinduene i hus9s lysegrå vegger ble funnet, gikk ytterveggen hel gjennom. Det åpnet for tre feil, som er rettet:

1. **Teppet i Barnesov.** Den mørke rammen rundt teppet ble koblet til ytterveggen gjennom tomme hull. Nå kobles et tomt
   hull, eller en «skyvedør» med ett blad og 1–2 rader, bare til en bit som henger på husets veggnett i den andre enden
   (et nett på minst 12 % av det lengste). Rammen blir et eget lite nett og faller bort. Det samme tok en dynekant i
   Voksensov.
2. **Skyvedørblad under 35 cm** (se dørvarianter over). De falske skyvedørene på 0,18 og 0,30 m (hus9) og 0,34 m
   (hus6) er borte.
3. **Dørbue over et vindu.** En svak bue uten tegnet dørblad over et bånd med linjer er en dør bare når den fyller hele
   hullet. Blomstene på teppet i hus9-alternativet laget en bue som var 75 % tegnet.

hus9 underetasje ved 50 px/m (skalaen «Generer» faktisk brukte da):

| | Commit ade03bf | Før rettingen | Nå | Fasit |
|---|---|---|---|---|
| Rom | 8 | 11 | 8 | 7 |
| Dører enkel/dobbel/skyve | 3/0/2 | 3/0/3 | 3/0/0 | 5/0/0 |
| Vinduer | 2 | 5 | 5 | 6 |

Begge barnesoverommene er nå lukket, og Voksensov er hel. Det gjenstår en smal bit på 0,8 m² ved trappa. Den falske
skyvedøra på skapet ved trappa i øvre etasje (517, 251) står igjen, og den ekte skyvedøra i vestveggen der finnes som et
vindu.

### Målt per plan

`detectPlan(img, { pxPerM, clean: true })`, slik «Generer» kaller den, på fasitskalaen. «ade03bf» er tilstanden ved
commit ade03bf (fase A), «før» etter fase B og «nå» etter gjennomgangen. Rom er antall regioner, uten skillelinjene.
Overlegg: `node tools/planbygger-debug.mjs <plan.png> <ut.png> --ppm=… --clean --rooms` (`--rooms` fyller rommene med
skillelinjene; `--scale` med desimaler virker nå).

| Plan | Dører e/d/s: ade03bf → før → nå (fasit) | Vinduer: ade03bf → nå (fasit) | Rom: ade03bf → før → nå (fasit) | Skillelinjer |
|---|---|---|---|---|
| hus1 1. etasje | 4/2/1 → 4/2/1 → 4/2/1 (4/2/1) | 11 → 11 (11) | 6 → 6 → 6 (6) | 0 |
| hus1 2. etasje | 6/0/0 → 6/0/0 → 6/0/0 (6/0/0) | 6 → 6 (6) | 6 → 6 → 6 (7) | 0 |
| hus2 | 10/0/5 → 10/0/5 → 10/0/5 (10/0/5) | 12 → 12 (12) | 14 → 14 → 14 (17) | 0 |
| hus3 1. etasje | 6/0/0 → 6/0/0 → 6/0/0 (7/0/0) | 5 → 5 (6) | 3 → 3 → 3 (4) | 0 |
| hus3 2. etasje | 2/0/3 → 2/0/3 → 2/0/3 (4/0/3) | 6 → 6 (6) | 6 → 6 → 6 (8) | 0 |
| hus4 1. etasje | 7/0/1 → 7/0/1 → 7/0/1 (8/0/1) | 7 → 7 (6) | 7 → 8 → 8 (9) | 1 |
| hus4 2. etasje | 5/0/0 → 5/0/0 → 5/0/0 (4/0/0) | 9 → 9 (9) | 4 → 4 → 4 (5) | 0 |
| hus5 | 10/0/4 → 10/0/4 → 10/0/4 (10/0/4) | 15 → 15 (15) | 11 → 11 → 11 (13) | 0 |
| hus6 | 5/0/3 → 5/0/4 → 5/0/3 (2/0/6) | 16 → 16 (8) | 3 → 3 → 3 (7) | 0 |
| hus7 | 0/0/0 (0/0/0) | 0 (0) | 0 (1) | 0 |
| hus8 kjeller | 5/0/0 → 5/0/0 → 5/0/0 (5/0/0) | 4 → 4 (4) | 6 → 6 → 6 (7) | 0 |
| hus8 1. etasje (36 px/m) | 5/0/0 → 7/0/0 → 7/0/0 (7/0/3) | 10 → 8 (6) | 9 → 9 → 9 (10) | 0 |
| hus9 øvre | 2/0/2 → 2/0/1 → 2/0/1 (3/0/1) | 9 → 9 (8) | 7 → 7 → 8 (5) | 1 |
| hus9 underetasje | 2/0/3 → 4/0/2 → 4/0/0 (5/0/0) | 1 → 5 (6) | 10 → 12 → 9 (7) | 0 |

Dørene på hus1, hus2, hus3 og hus5 står også på riktig sted: dobbeltdørene i hus1 er HALL → STUE og terrassedøra, og
de 5 skyvedørene i hus2, 4 i hus5 og 3 i hus3 2. etasje ligger på punktene fasiten er lest av. Én er for bred:
skyvedøra i hus1 1. etasje blir 1,71 m, fordi lommen den skyves inn i, regnes med (fasit 0,79 m).

Trappene, mot fasiten (overlapp med fasitens boks):

| Plan | Fasit | ade03bf | Nå | |
|---|---|---|---|---|
| hus1 1. etasje | kvartsvingt | kvartsvingt 95 % | kvartsvingt 94 % | ✓ |
| hus1 2. etasje | kvartsvingt | kvartsvingt 39 % | kvartsvingt 85 % | ✓ |
| hus2, hus5, hus7 | ingen | ingen | ingen | ✓ (ingen falsk trapp av skrå tekst eller en skråstilt lenestol) |
| hus3 1. etasje | rett | rett 43 % | rett 87 % | ✓ |
| hus3 2. etasje | rett | rett 89 % | rett 89 % | ✓ |
| hus4 1. etasje | halvsvingt | ingen | halvsvingt 91 % | ✓ |
| hus4 2. etasje | halvsvingt | ingen | halvsvingt 87 % | ✓ |
| hus6 | halvsvingt | rett (fase A), kvartsvingt 75 % (fase B) | halvsvingt 84–89 % | ✓ |
| hus8 kjeller | kvartsvingt | ingen | ingen | ✗ |
| hus8 1. etasje | rett | ingen | rett 71 % | ✓ |
| hus9 øvre | kvartsvingt | rett 39 % | rett 39 % (51 % ved 50 px/m) | ✗ |
| hus9 underetasje | kvartsvingt | ingen | ingen | ✗ |

De syntetiske planene består ved 40–120 px/m med støy og 3° skjevhet: 9 av 9 åpninger med variant, begge takvinduene,
rett trapp og L-trapp med svingtrinn. Den nye syntetiske U-trappa rundt et øye (`planbygger-synth.mjs`, `utrapp` og
`utrappStiplet`) finnes som halvsvingt ved 50–120 px/m med 88–98 % overlapp.

### Begrensninger i gjenkjenningen

- **Rom som slås sammen:** SOV + GANG (hus5), Arbeidsrom + Gang og Bad + Bod (hus3 2. etasje), TV-stue + Entré
  (hus4). Bad + Bod er en ekte feil: BOD er et rom på 1,7 m² med vegger. De andre er for det meste åpne planer. Dette
  er det som stopper målet «rom med navn» (se «Sluttkontrollen»).
- **Grå vegger med tynne konturer** (hus4): rommene blir for store, fordi veggflatene ikke legges på kanten av båndet.
  Det gir +3,7 % på arealskalaen.
- **Vegger som to tynne streker** (hus7) leses ikke, og garasjeporter blir ikke åpninger. «Generer» har en reserve som
  fyller konturene.
- **Én strek som to vegger:** en kjøkkenlinje i hus9 blir to parallelle vegger noen centimeter fra hverandre.
  «Generer» slår dem sammen i kontrollen.
- **Trapper:** hus8 kjeller er bitteliten (ca. 1,4 × 1,3 m ved 34 px/m) med lysegrå linjer på 1 px, under grensene både
  for vifter og øyer. hus9 tegner trappa som skyggelagte tretrinn, ikke som linjer. Det trenger en annen metode, for
  eksempel periodisk tekstur. Den syntetiske U-trappa med to rette løp får bare løpene (43–61 % overlapp).
- **hus6** (skannet arkitekttegning): 16 vinduer mot 8, dørene 5/0/3 mot 2/0/6 og 3 av 7 rom.
- **hus9:** møbler blir vegger også etter rydding, og den indre rammelinja i de hvite vindusfeltene blir en tynn vegg.
- **hus8 ved 36 px/m:** terrassedøra går tapt, fordi bladet bare er ca. 0,53 m ved den skalaen (under `doorMin` 0,55).
  Ved 32 og 34 px/m finnes alle 6 tegnede slagdører.
- **hus4 2. etasje:** et svingtrinn blir en falsk dør på 0,67 m.
- **Skillelinja i hus9** er en gulvkant, ikke en tegnet strek. Regelen godtar altså også gulvkanter mellom to
  veggender.
- **Tidskravene i testen** (hus7 og hus6) er det beste av 3 kjøringer, fordi maskinen varierte fra 1,7 til 4,2 s på
  samme plan mens andre tester kjørte.

## Modulene i runde 1

Hver modul er klassisk bildebehandling, har sin egen test (`tools/test-planbygger-<modul>.mjs`) og ble målt mot
fasiten i fase A og gått gjennom av en kritiker. Tallene er fra fase A med mindre noe annet står. Det «Generer» får
ut av dem samlet, står i «Runde 1: målinger per hus».

### Ark med flere tegninger (`sheet.js`)

`splitSheet(img) → { blocks: [{ bbox, kind, score }] }` deler et ark i blokker: `plan`, `facade`, `section`, `text`
eller `other`. `cropImage(img, bbox, pad)` skjærer ut en blokk.

**Metoden:**
1. **Blekk** er alt som er tydelig mørkere enn papiret, på et arbeidsraster på ca. 1000 px. Lange, tynne, rette linjer
   i lyst blekk teller også (den lyse bakkelinja og kledningen på en gjengitt fasade).
2. **Pekelinjer kuttes:** en tykk linje med en prikk i enden binder en forklaring til en tegning (hus7).
3. **Blokker:** blekket dilateres, og komponentene blir blokker. Øyer inne i en plan slås sammen med planen.
4. **Klassifisering:**
   - **plan:** rom, eller yttervegger som når sidene av blokken;
   - **fasade:** en bakkelinje som stikker ut i begge ender, en skrå takkant, eller en bred tegning uten vegger i
     sidene;
   - **snitt:** krever bevis, ellers blir det fasade. Bevisene er en skrå takkant med tomt loft under og skårne vegger
     (grå fyll eller skravur) i begge ender av taket.
5. **Tegningene måles mot hverandre:** et kompass ved en plan blir `other` og hektes på planen. En stripe med fasader
   blir tegninger selv om hver er liten for arket.
6. **Deler hektes på tegningen sin:** målekjeder, kotelinjaler og små symboler blir med i utsnittet.

**Målt** i egen størrelse og omsamplet 0,5–2×:

| Fil | Resultat |
|---|---|
| hus7 | 4 fasader, 1 snitt og 1 plan fra 1500 til 4771 px |
| hus8 | 3, 1 og 2 planer, overlapp ≥ 0,95 (≥ 0,9 omsamplet) |
| hus2- og hus3-fasadene | 4 fasader ved alle skalaer |
| 12 enkeltfasader og 11 enkeltplaner | 1 tegning hver, planene med 99–100 % av blekket |

Tid: 0,25–0,36 s for 2000 px og ca. 1 s for skanningen på 16 MP.

**Begrensninger:**
- Testsettet har bare ett ekte snitt (hus7). Et snitt med flatt tak, eller med vegger som enkeltstreker, helt svarte
  eller to streker uten fyll, blir fasade. Derfor avgjør KI-svaret `classify` mellom fasade og snitt når KI finnes.
- En flat boks med vinduer og ingen bakkelinje utenfor blir plan (garasjen i hus8 er nettopp det).
- En plan med en tynn linje nederst som stikker ut i begge ender (en målekjede bredere enn huset) kan bli fasade. Det
  er ikke sett i testsettet.
- Lange, svake streker (skannerstriper) kan binde sammen tegninger. Heller ikke det er sett.
- Under ca. 1500 px faller hus7.

### Foto av en utskrift (`photo.js`)

`isPhoto(img)` skiller et mobilfoto av en utskrift fra en digital plan. `rectifyPhoto(img, { maxSide = 2400 })` finner
arket, retter opp perspektivet til A-format og jevner ut lyset. Svaret er `{ img, quad, applied, cut, aspect, reason }`:
`cut` sier hvilke sider av arket som lå utenfor bildet, og `reason` hvorfor ingenting ble gjort (`'digital'`,
`'no-sheet'` eller `'unsure'`).

**Metoden:**
- **Foto eller digital:** fire trekk på et utvalg av pikslene: andelen rent hvite piksler, hvitt i en ramme langs
  kanten, metning og mørke i rammen (pulten), og hvor flat rammen er. En flat ramme er digital uansett farge, så et
  skjermbilde med svarte felt eller en PDF på grått er ikke et foto.
- **Arket** finnes på farge (det største lyse, umettede området, på farget eller mørk pult) eller på kanter (en
  Hough-transform av tynne kanter, på grå eller hvit pult). Hver side tilpasses med det lengste rette strekket, så et
  ark som henger over pultkanten, tas fra den flate enden.
- **En side utenfor bildet** bygges av de tre andre og et hullkamera. Stående eller liggende bestemmes av
  kameramodellen. To sider utenfor bildet gir `'unsure'`.
- **Kontroller:** heller ingen oppretting enn et galt ark. Hver side må ha papirkant langs minst 40 % av seg, arket må
  ha A-forhold (± 15 %), og hver side må skille papir fra noe annet.
- Så homografi til A4, forfining med veggenes linjer og lysutjevning.

**Målt** på hus3-foto mot hus3 1. etasje, med skala fra husets ytre mål:

| | Farger | Gråtoner |
|---|---|---|
| Hjørner | innen 2,6 px | innen 3,2 px av fargebildet |
| Husets form (b/h, 1 = riktig) | 1,0007 | 1,0015 |
| Vegger funnet / treffer | 89 % / 88 %, snitt 2,5 cm | 93 % / 90 %, 2,0 cm |
| Dører og vinduer | 8 av 11, 3 ekstra | 8 av 11, 5 ekstra |

- Syntetiske foto fra et hullkamera: grå, lys grå og hvit pult gir formfeil ≤ 0,05 %. En bratt vinkel (55–60°) gir
  ≤ 0,12 %. En side utenfor bildet gir −1,0 til +0,24 %.
- Alle 30 planer i testsettet og 6 skjermbilder rettes ikke opp. Grå, støyete skanninger rettes heller ikke opp.
- Tid: 1,1–2,1 s per foto i Node.

**Begrensninger:**
- Bare ett ekte foto er testet. Tersklene er satt etter det og syntetiske bilder.
- `isPhoto` kaller en grå, støyete skanning uten rent hvitt et foto (0,62–0,84). `rectifyPhoto` avslår den likevel.
- Et nærbilde uten synlig arkkant blir verken rettet opp eller lysutjevnet.
- En pult like lys som papiret der kanten går, og et overeksponert foto, gir ingen oppretting.
- Geometrien er god (husets form innen 0,3 %), men gjenkjenningen på fotoets tynne linjer er det ikke: «Generer» finner
  1 av 4 rom og 3 av 6 vinduer.

### Rydding før veggene (`clean.js`)

`cleanForWalls(img, { pxPerM }) → img` rydder bildet før veggene. Originalen røres ikke, og `img.cleanStats` sier hva
som ble gjort. Veggene i en plan er som regel nøytrale: svarte, mørkegrå eller en lys grå fylling mellom mørke
konturer. Noen ganger er de svakt farget (skiferblå på hus3, blåstikk i et mobilfoto) eller tegnet i farge.

**Stegene:**
1. **Veggtonen:** gråbåndet der flest tykke strøk er formet som vegger. Båndet måles over nøytrale og fargede piksler
   hver for seg. Fargede vegger beholdes når de er minst en fjerdedel av de nøytrale. Veggenes eget fargestikk løfter
   fargegrensene, så blåstikket i veggene, dørbuene og vinduslinjene ikke tas for farge.
2. **Farge blir papir:** forklaringer oppå tegningen (hus6) og fargede gulv og møbler (hus8, hus9). En tynn farget strek
   over en vegg fylles inn fra tvers over streken.
3. **Bare på lysegrå vegger:** tykke mørke møbler blir papir, en påtegnet vegg får veggtonen, og lyse gulv blir papir.
4. **Skraverte vegger blir hele** (hus6).
5. **Skravur blir papir**, som standard bare på lysegrå vegger (hus4).

**Målt** (gjenkjenning og rom før → etter rydding):

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
dører og vinduer i ekte vegger. Der en økning i feil vegg er godtatt, står det i `tools/fixtures/clean/plans.json` med
grunnen (hus6: en vegg tvers over den brede åpningen mellom STUE 2 og SPISESTUE; hus9: trappens omriss, badekarkanten,
sengekanter og spisestoler). Tid: 0,15–0,6 s per megapiksel (hus4 1,5 s, hus7-arket på 16 MP 2,3 s), og toppminnet er
ca. 300 MB over startnivået på hus7-arket.

**Begrensninger:**
- På hus9 blir den lyseblå glassflaten papir, og den indre rammelinja i det hvite vindusfeltet blir en tynn vegg.
  Underetasjen fikk 1 av 6 vinduer etter ryddingen (gjenkjenningen er rettet siden: 5 av 6).
- Røde «nye vegger» blant svarte beholdes bare når de er minst en fjerdedel av de svarte veggene.
- De godtatte verdiene er målt mot gjenkjenningen slik den var, og må måles på nytt når den endrer seg mye.

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
  like høye. `sameSource` sammenligner derfor omrisset av ytterveggene. Likt innen 1,2 %: skalaen arves. Begge aksene
  endret med samme faktor (innen 1 %): skalaen ganges med faktoren, og sikkerheten går ett hakk ned. hus1 2. etasje gir
  93,80 px/m (−0,2 %).
- **Mål som stemmer tilfeldig.** Et mål med mange kandidatlengder stemmer med nesten hva som helst. Laget regner ut
  sjansen for at samsvaret er tilfeldig, og høy sikkerhet krever under 1 % og minst 2 mål. Tilfeldige tall ved de ekte
  etikettene gir 0 av 48 «høy» (før 9 av 12 på hus6).
- **Papir på et utsnitt:** `pdfPage.widthPx`/`heightPx` er sidens størrelse da den ble gjengitt. Uten dem tier
  papirlaget på et utsnitt. hus7-utsnittet gir 118,11 px/m (+0,6 %).
- **Arealer og dører som kontroll:** rom som er uenige med hverandre, teller mindre. Dørene er strengere kontroll jo
  flere de er: 5 % ved 4 dører eller flere, 8 % ved 3 og 15 % ved 2.
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

**Nå** (gjenkjenningen er endret siden): hus4 1. etasje gir 125,07 px/m (+3,8 %) på 6 av 7 rom, med spredning 2,8 %, og
`autoscale.js` kaller det «høy». En falsk skyvedør som delte Sov 9,3, er borte, så estimatet ble bedre (fra +5,2 %),
men sikkerheten gikk over grensen. Testen «ikke høy sikkerhet når den bommer med over 2 %» feiler derfor (105 av 106).
Det er sikkerhetsregelen i `autoscale.js` som må se på dette.

**Begrensninger:**
- hus4: grå vegger gjør rommene for store, og TV-stue og Entré slås sammen. Arealene treffer +3,7–3,8 %.
- Et utsnitt uten målestokktekst og med vegger som to tynne streker (hus7 uten KI) beholder en gal foreløpig skala.
- Omskaleringen av loftet antar felles yttervegger. Et jevnt tilbaketrukket toppetasje på et nesten kvadratisk hus ville
  sett ut som en annen målestokk. Derfor går sikkerheten ett hakk ned.
- Sjansemodellen antar at feilleste mål ligger jevnt fordelt (logaritmisk) mellom 0,8 og 20 m.

### Etasjer oppå hverandre (`align.js`)

`alignLevelTo(level, ref, { img, refImg }) → { offset, method: 'stair'|'outline'|'corner', score, detail }`. Den første
metoden som er sikker nok, vinner. Etasjene endres ikke.

- **Trapp, med bildene.** Trappeboksene kommer fra `detect.stairs`. En etasje uten trapp letes gjennom av en egen
  trappefinner i `align.js`. Strekene i hver boks søkes i den andre etasjens tegning fra grovt til fint: 16, 8, 2 og
  1 cm. Et rett løp passer nesten like godt ett trinn lenger fram (94 % på hus3), så toppene rangeres begge veier, og et
  klart omriss velger mellom dem.
- **Når et treff teller:** når et annet søk eller omrisset bekrefter det, eller når det er klart best. Et ubekreftet
  treff som et sterkt omriss motsier, forkastes. Eksempel: en «trapp» i bunnteksten som begge FINN-arkene i hus8 har.
- **Trapp, uten bildene:** bokser av omtrent samme størrelse pares, men bare når noe annet er enig.
- **Omriss:** ytterveggbåndene rastres til 5 cm, og forskyvningen med mest overlapp finnes innenfor ±2 m og forfines
  til 1 cm. Dekningen (`coverage`, overlapp delt på den største etasjens ytterbånd) brukes bare når et omriss skal
  overstyre en trapp. Omrisset alene har ikke noe krav til dekning ennå, selv om designet ber om minst 0,1.
- **Hjørne:** `alignLevel` i `export.js`, som reserve.

**Målt**, feil mot håndmålt fasit:

| Hus | Med trapp og bilder | Omriss alene |
|---|---|---|
| hus1 | 1,1 cm | 0,4 cm |
| hus3 | 0,5 cm | 2,3 cm |
| hus4 | 0,6 cm | hjørne, 679 cm feil |
| hus9 (grov fasit) | 2,1 cm | hjørne, 714 cm feil |
| hus8 (grov fasit) | hjørne 0,9 cm | hjørne 0,9 cm |

Eierens kjeller havner med hjørne NØ, som `alignLevel` i v1. Tid med bildene: 3,3–3,6 s på hus6-arket kaldt, 0,8 s med
varme strek-cacher. Trappefinneren bruker 1,2–1,7 s per stort ark.

**Begrensninger:**
- En falsk «trapp» som begge arkene har på samme sted, bekrefter seg selv.
- Uten bilder og med et svakt omriss (hus4 2. etasje har 10 vegger) faller den tilbake til hjørnet, flere meter feil.
- Uten et klart omriss (hus4, hus9) avgjør tegningen alene hvilket trinn som er riktig, med bare 6–7 % margin.

### Fasader (`facade.js`)

`readFacade(img, { ai, storeys, floorHeight = 2.7, pxPerM })` leser én fasadetegning. Resultatet har takform, bakke,
takfot og møne, vinduer og dører med etasje, brystning og høyde, skala, metode, sikkerhet, `skew` og `workScale`.
`houseRoof` stemmer over alle fasadene.

**Metoden:**
0. **Arbeidskopi:** skjevheten måles (±4°, ned til 0,025°), og bildet rettes opp med nærmeste piksel. Et hus over
   900 px eller 200–400 px høyt leses på en kopi der huset er 650 px høyt.
1. Papir og blekk fra histogrammet.
2. **Bakkelinja** er den laveste lange linja med blekk over og nesten ikke noe under. På et arkitektark (terreng,
   målekjeder, biler) prøves alle linjer på minst 15 % av blekket, og det største og høyeste huset som står på en av
   dem, vinner. Holder huset under 18 % av blekket, gis ingen bakkelinje heller enn en gal.
3. **Mønet** fra omrisset, med piper kuttet bort. **Takfoten** er underkanten av takflaten på en langside,
   underkanten av takkanten på en flat topp, eller toppen av hjørnene.
4. **Vinduer og dører** er lukkede rammer med lysere innside. En garasjeport er en dør: minst 2 m bred, på gulvet, med
   minst fire linjer tvers over og ingen stolper.
5. **Skalaen** kommer fra en dør (2,1 m), glass til gulvet, en dør på et øvre gulv, vindusoverkanten, en etasjelinje
   eller vegghøyden, i den rekkefølgen. Hver må gi et hus på 2–30 m.
6. **Etasjer, brystning og høyde:** et oppgitt etasjetall brukes, men aldri færre enn vinduene står i.

**Husets tak** (`houseRoof`): hver fasade stemmer med vekt 1 fordelt på typene omrisset tillater.

**Målt** uten KI på de 20 fasadene til hus1–hus5:

| | Riktig |
|---|---|
| Takform per fasade | 16 av 20 |
| Vinduer | 70 av 71 (sum avvik 5) |
| Dører | 17 av 18 (sum avvik 5) |
| Etasjer | 19 av 20 |
| Skala innen 5 % / 10 % | 10 / 16 av 16 |

Husets tak blir riktig på hus1 (saltak med ark), hus2, hus3 (saltak) og hus4 (pulttak). hus5 blir pulttak, der
fasiten sier «mixed». hus7 (arkitektark): VEST, SØR og NORD får riktig bakkelinje (529, 529 og 526 px fra bakke til
møne, fasit 528) og saltak. NORD finner de to portene og får 112,9 px/m (−4 %). Skjeve tegninger (0,5–2°) finnes innen
0,025°, og skalaen avviker 0 til +5 % fra den rette tegningen. Det tar under 0,8 s per fasade.

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
  i `server/planbygger-ai/node_modules`, som er i `.gitignore`. Prosjektets `node_modules` røres ikke.
  - `createAiHandler()` er en mellomvare for `POST /api/planbygger/ai` og `GET /api/planbygger/ai/status`. Nøkkelen
    blir på serveren, og nettleseren ser den aldri.
  - `createAiService()` er det samme uten HTTP, for opptaksskriptet og testene.
  - SDK-en importeres lat. Uten den, eller uten nøkkel, sier statusen `available: false`, og hvert kall gir 503.
  - Forespørselen er `messages.create` med bildet og en tekst, `output_config.format` med oppgavens JSON-skjema og
    tenking med en innsats per oppgave. `stop_reason` sjekkes før svaret leses.
  - Vite monterer den i `tools/planbygger-vite-plugin.mjs`, med lat import, så Vite virker uten SDK.
- **Klienten** (`src/planbygger/ai.js`): `aiStatus()`, `aiRead(task, { image, marks, unmarked, hints })` og
  `setAiTransport()` for testene.
  - Den skalerer bildet ned til høyst 1600 px, sender det som PNG og kaster aldri.
  - Den kobler svarene til merkene. Et rom uten merke får etiketten som ligger i polygonet sitt.
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
tools/planbygger-measure-all.mjs --model readPlan=sonnet` osv.), ikke på poengene per svar. Klienten kan ikke velge
modell: serveren velger per oppgave.

- **readPlan: Haiku.** Sonnet ble tatt opp på 7 planer. På hus2 ga Sonnet navn til 16 av 17 rom, Haiku til 17. På hus3
  fikk Sonnet én romtype mindre riktig i 2. etasje og la til et takvindu som ikke finnes. På den skannede hus6 var
  Sonnet bedre: dørene ble 5/0/4 mot 7/0/3 (fasit 2/0/6) og vinduene 15 mot 17 (fasit 8). Resten var likt, også
  «Ferdig betyr». Sonnet koster omtrent 10 ganger så mye per kall.
- **classify: Haiku.** Begge modellene ga de samme tegningene og etasjene på 3 ark. Med Sonnet fikk hus8 ett spørsmål
  mindre, og hus9 underetasje fikk dørtall nærmere fasiten (5/0/3 mot 3/0/2, fasit 5/0/0). Det er for lite til å
  betale omtrent 12 ganger prisen.
- **readFacade: sendes ikke.** Ingen del av svaret slo tegningen alene.

### Fasadene: KI-en leser dem ikke lenger

Med Haiku som standard ble fasadene dårligere enn uten KI. Målt med «Generer» på de 24 fasadene til hus1–hus5 og hus7,
med én del av fasadesvaret slått av om gangen:

| KI-svaret på fasadene | Hustak riktig | Fasadevinduer eksakt (sum feil) | Fasadedører eksakt (sum feil) |
|---|---|---|---|
| ingen KI | 5 av 6 | 19 av 24 (5) | 19 av 24 (5) |
| Haiku, tak og dør/vindu-typer | 3 av 6 | 17 (8) | 18 (8) |
| Haiku, bare taket | 3 av 6 | 19 (5) | 19 (5) |
| Haiku, bare typene | 5 av 6 | 17 (8) | 18 (8) |
| Sonnet der det finnes (7 fasader), begge deler | 4 av 6 | 18 (8) | 18 (10) |
| Sonnet, uten taket | 5 av 6 | 18 (8) | 18 (10) |

- **Taket:** `facade.js` regner KI-taket som en hel stemme som også avgjør ved likt, men modellen ser bare én fasade.
  hus1 har halvvalm med ark, og begge modellene sier «hip» og «gable». hus2 har små utsnitt (ca. 200 × 80 px), og der
  leser Haiku langsiden av et saltak som pulttak.
- **Dør/vindu-typene** retter én fasade (hus1 fasade 1) og ødelegger fem.
- **Etasjetallet** brukes ikke, fordi «Generer» tar det fra planene.

Derfor er `AI_FACADE_USE` i `ai.js` satt til `{ roof: false, kinds: false }`. `aiRead` sender da ikke `readFacade` i
det hele tatt. Det sparer 4 kall à 5–7 s per hus. Opptakene ligger der fortsatt og testes, og `--facade-ai` i
measure-all eller `setAiFacadeUse` slår dem på igjen for en måling.

### Merkene

Rommerkene settes først. Skiva med den hvite kanten skal ikke dekke noe som er mørkere enn grått 140 (tekst, vegger,
streker), andre merker, åpningshull eller plassen rett foran en åpning. 110 var for lite, for grå romtekst ligger på
110–170 (hus3). Åpningsmerkene settes ved siden av veggen med en strek til hullet, og strekene tegnes før skivene.

Målt på 7 planer (hus1 begge etasjer, hus2, hus3, hus5 og hus8 plantegning-2 og -3):

| Måling | Resultat |
|---|---|
| Skiver som overlapper | 0 |
| Streker gjennom skiver | 0 |
| Rommerker over tekst | 0 |
| Åpningskanter som berører en strek | 4, på 3–13 px |
| Rom uten merke | 4 (tre små rom på hus2 og BAD 5,0 på hus5), alle fikk navnet sitt tilbake gjennom polygonet |
| Tid per plan | 22–165 ms |

Tekst som er lysere enn grått 140, er ikke vernet: streken til et merke på hus8 går over «E» i ENTRÉ.

### Vern

- **Kvote:** 40 kall per økt (informasjonskapselen `pb_ai`) og 150 per IP i et glidende døgn. En klient uten
  informasjonskapsel får en ny økt, så den virkelige grensen er IP-kvoten og et tak for hele serveren: 1000 kall og
  5 USD per døgn. Et treff i hurtigbufferen teller ikke.
- **IP bak proxy:** serveren bruker den siste `X-Forwarded-For`-oppføringen, den proxyen la til, slik `server.mjs`
  gjør. `trustProxy` slås på av seg selv når `RAILWAY_ENVIRONMENT_NAME` eller `RAILWAY_ENVIRONMENT` er satt.
- **Modellen** velges av serveren. `model` fra nettleseren overses. Bare opptaksskriptet (`ctx.allowModel`) eller
  `PLANBYGGER_AI_ALLOW_MODEL=1` i Vite slipper det gjennom. Sonnet koster 20 ganger så mye som Haiku per token inn.
- **Ellers:** bildet høyst 1600 px og 6 MB, høyst 3 kall samtidig med kø (30, 120 s), 60 s tidsgrense per kall,
  høyst 300 merker, og en hurtigbuffer på disk i `.shots/planbygger/ai-cache/` etter sha256 av oppgave,
  promptversjon, modell, innsats, bilde, merker og hint.
- **Kvoten og taket lever i minnet** og nullstilles når prosessen starter på nytt.

### Kostnad og tid så langt

139 ekte kall, til sammen $0,69 (`.shots/planbygger/ai-record-log.jsonl`, tokens og pris per kall):
- fase A: 60 kall, $0,38 (taket for fasen);
- fase B: 79 av 80 kall, $0,31: Haiku 65 kall for $0,07 og Sonnet 14 kall for $0,24;
- rettingen etter gjennomgangen brukte ingen ekte kall.

| Modell | Oppgave | Kall | Pris per kall | Tid per kall | Tokens inn / ut |
|---|---|---|---|---|---|
| Haiku | readPlan | 42 | $0,0024 | 16,5 s | 7136 / 3438 |
| Haiku | classify | 39 | $0,0007 | 4,7 s | 3804 / 623 |
| Haiku | readFacade | 28 | $0,0007 | 6,5 s | 3180 / 852 |
| Sonnet | readPlan | 16 | $0,0256 | 8,7 s | 6962 / 1168 |
| Sonnet | classify | 5 | $0,0098 | 5,3 s | 3781 / 226 |
| Sonnet | readFacade | 9 | $0,0094 | 4,4 s | 3205 / 296 |

- **Per hus** med Haiku og uten fasade-KI blir det ett `classify` per fil og ett `readPlan` per plan. hus1 (6 filer,
  2 planer) koster ca. $0,009 og hus2 (2 filer, 1 plan) ca. $0,004. Det er rundt 5–10 øre per hus.
- **Tiden:** Haiku tenker lenge på `readPlan` (16,5 s i snitt). Tidene i tabellen over husene (8–31 s) er med
  opptakene, uten ventetid. Med ekte KI kommer ventetiden i tillegg. Et hus med to etasjer fra samme tegnesett må
  anslagsvis regne med 40–60 s. Det er et anslag; «Generer» med ekte KI er ikke målt i nettleseren.

### Hva KI-en leser godt og dårlig

**Godt** (Haiku, nesten feilfritt):
- romnavn og arealer, også med desimalkomma;
- titler og målestokk;
- ytre mål og mm-mål (14 av 17 på hus6);
- himlingstekster;
- antall tegninger på et ark og titlene deres.

**Dårlig:**
- **Skyvedører:** ingen av modellene leser skyvedørene på en merket plan. Plass-sjekkene gir 0 av 8 på hus2 og hus3
  2. etasje med både Haiku og Sonnet, 3 av 4 på hus5 og 1 av 1 på hus1 (Haiku). Skyvedørene «Generer» bygger, kommer
  fra `detect.js`.
- **Dørtall:** Haiku teller for mange slagdører og for få skyvedører (hus2: 14 enkle mot 10, 1 skyvedør mot 5).
- **Planer uten merker** gir få eller ingen åpninger (hus6: 0 dører og 0 vinduer; fotoet: 0 av 6 vinduer).
- **Trappeformen:** feil på fire av sju planer med trapp i fase A.
- **Variasjon:** samme bilde gir ulike svar. To Haiku-kjøringer på hus3 1. etasje ga 9 av 10 og 7 av 10 riktige
  åpningsbokstaver.
- **Kjente modellfeil:** på hus3 1. etasje leser Haiku inngangsdøra med sidefelt som dobbeltdør, og døra under trappa
  og et østvindu som åpninger. På hus2 kaller Haiku WIC 4.6 «(G)» og Sonnet «WC».

**Før og etter opptakene i fase B** (`node tools/planbygger-measure-all.mjs`, «Generer» med KI; kolonnen «Nå» har også
med endringene i generate og detect etterpå):

| | Fase A-opptak | Nye opptak, Haiku leser fasadene | Nå: fasade-KI av |
|---|---|---|---|
| spørsmål med KI (uten KI: 120–122) | 55 | 28 | 26–27 |
| hustak riktig | 5 av 6 | 3 av 6 | 5 av 6 |
| fasadevinduer eksakt (sum feil) | 19 av 24 (5) | 17 (8) | 19 (5) |
| rom funnet / med navn / riktig type, av 110 | 82 / 69 / 72 | 94 / 94 / 85 | 99 / 99 / 89 |
| etasjer med skala innen 2 % | 8 | 9 | 10 |
| hus9 «Øvre etasje» | +10,1 %, 1 av 5 rom | +17,0 %, 0 av 5 rom | −1,6 %, 5 av 5 rom |

«Med navn» teller her alle etiketter som fikk et rom. Med den strengere regelen, der en etikett som deler rom med en
annen ikke teller, er det 72 av 110.

**hus9 var en tilbakegang, ikke en gevinst.** Med de nye opptakene gikk spørsmålene fra 19 til 6, men hovedetasjen falt
sammen. Den arvet skalaen fra underetasjen (+17 %), og fikk 5 vegger og 0 rom. Spørsmålene ble få fordi det nesten
ikke var noe igjen å spørre om. Siden arver ikke etasjer med ulik skala (se «Regler som kom etter målingene»), og
KI-testen sjekker nå at ingen etasje mister mer enn 40 % av veggene eller vinduene med KI mot uten.

### Opptakene og testene

- **87 opptak** i `tools/fixtures/planbygger-ai/`: 70 med Haiku (alle oppgavene i alle de ti husene) og 17 med Sonnet
  (de vanskelige tilfellene). Alle er tatt opp gjennom «Generer» (`node tools/planbygger-measure-all.mjs --record
  --budget N`), så hvert opptak har nøyaktig bildet, merkene, hintene og utsnittet «Generer» sendte.
- **`node tools/test-planbygger-ai.mjs`** spiller dem av uten nøkkel. Hvert svar sjekkes mot `fasit.json`: rom, typer,
  etiketter, dørvarianter, vinduer, takvinduer, trapp, tittel, målestokk, mål, himlingstekster, tak og tegningsboksene.
  Et avvik feiler, med mindre det står i `KNOWN`, og et kjent avvik som blir riktig, feiler også.
- **Plass-sjekkene** (`BY_EYE` i `tools/planbygger-ai-fixtures.mjs`) er punkter i fila, sjekket på et overlegg: rommet
  modellen ga navnet, må dekke fasitpunktet, og merket nærmest et fasitpunkt for en åpning (innen 0,4 m) må ha fått
  riktig type. 83 rom og 84 åpninger på 11 opptak. Et ombytte av to lesninger feiler, også når navnelista og antallene
  stemmer.
- **Foreldede opptak:** `detect.js` og `generate.js` har endret bildene eller merkene etter opptaket for `readPlan` på
  hus2 (Haiku og Sonnet), hus3 2. etasje (Haiku og Sonnet), hus3-foto (Haiku), hus6 (Haiku og Sonnet) og begge
  etasjene i hus9 (Haiku og Sonnet). Svarene spilles av og kobles etter posisjon. Testen skriver MERK, og den feiler
  med `--strict-fresh`. Skalaen på hus2 og hus3 2. etasje i «Ferdig betyr» hviler på slike opptak.
- **Å ta dem opp igjen** krever 6 Haiku-kall og 5 Sonnet-kall, når `detect.js` står stille: `node
  tools/planbygger-measure-all.mjs --record --only hus2,hus3,hus3-foto,hus6,hus9 --budget 6`, og det samme med
  `--model readPlan=sonnet`. Det er over budsjettet for fase B (79 av 80 er brukt).

### Personvern og samtykke

- **Uten KI sendes ingenting.** Statuslinja sier «Alt kjøres i nettleseren – planen sendes ingen steder.»
- **Med KI** sendes en nedskalert kopi (høyst 1600 px, PNG) av hver tegning med merkene, og filnavnet og etasjenavnet
  som hint, til serveren og videre til Anthropics API. Originalfilen sendes ikke. Bildet lages på nytt fra pikslene, så
  EXIF-data i et mobilfoto (som posisjonen) følger ikke med.
- **Hurtigbufferen** på serveren lagrer svaret (teksten modellen leste) etter en hash, ikke bildet. Loggen har oppgave,
  modell, tokens, pris og tid, ikke innhold.
- **Det kunden får vite i dag:** stabelen sier at «en nedskalert kopi av tegningene sendes til KI-tjenesten», og etter
  «Generer» at KI-en fikk nedskalerte kopier for å lese tekst og symboler. Det er informasjon, ikke samtykke.
- **Før KI-en slås på for kunder:**
  - et eget valg før første «Generer» (KI av eller på), og en forklaring på hva som sendes;
  - en personvernerklæring som nevner Anthropic som databehandler, og en databehandleravtale. En plantegning av et hjem
    er personopplysninger (planløsning, ofte adresse i filnavnet eller på tegningen);
  - avklare Anthropics vilkår for lagring og bruk av API-data, og skrive dem inn i erklæringen;
  - vurdere å la være å sende filnavnet, siden det ofte har adressen.

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

Det trengs også:
- `ANTHROPIC_API_KEY` som variabel i Railway;
- `npm ci --prefix server/planbygger-ai` i byggesteget, ellers sier statusen `available: false`;
- en plass for hurtigbufferen (`limits.cacheDir`), eller å godta at den forsvinner ved hver ny utrulling;
- å teste lokalt med `node server.mjs` før noe rulles ut.

## Rommene og eksporten

**Rom** (`regions.js`). Veggene i editormodellen (senterlinjer med tykkelse) tegnes i et raster på 2 cm. Hver ende
forlenges med halve tykkelsen til den tykkeste veggen den møter, så L-hjørner lukkes uten at en tykk vegg stikker inn
i rommet ved en T-skjøt. De frie cellene flomfylles, og omrisset av hvert rom følges langs cellekantene. Omrisset
forenkles (Douglas–Peucker, så en skrå vegg blir én kant), og hver kant festes til flaten av veggen den går langs.
Polygonene blir dermed eksakte på veggflatene, ikke på rasteret, og hver kant vet hvilken vegg og hvilken side den
ligger på. I runde 1 kan rommene også deles av skillelinjer (`findRooms(walls, { separators })` eller
`levelRooms(level)`), men «Generer» og eksporten bruker dem ikke ennå.

**Husformatet** (`export.js`). Eksporten følger reglene i `notes/hele-huset-design.md` §1:

- **Romsløyfer:** hvert rom får sin egen veggsløyfe med klokka, med rommet til høyre og normalen inn.
- **Delte vegger:** en romkant deles der rommet bak skifter, likt på begge sider. Rommet med lavest nummer eier veggskiva
  (tykkelse = avstanden mellom flatene). Det andre rommets bit er `backOf` (D13).
- **T-skjøter:** et kort stykke foran enden av en vegg som kommer inn på tvers, slås sammen med naboen.
- **Yttervegger:** får planens tykkelse, minst «Yttervegg minst» (0,25 m). De går aldri inn i et annet rom. Der to roms
  yttervegger møtes i et ytterhjørne, kuttes veggen og tynnes bare den biten som overlapper.
- **Dører:** dører får `door:{ hinge, swing, opensInto, leaf … }`. Dører og åpninger får `connects`, og ytterdører
  `['rom', 'ute']`.
- **Det andre:** tak, gulv etter romtype, én plafond og én lysgruppe per rom. Alt merkes `estimated`.
- **Retning:** planen dreies etter nordretningen (spillets +x er sør og +z vest). Origo legges i det innvendige hjørnet
  av hovedetasjen.

**Det husformatet ikke har ennå** eksporteres som det nærmeste, og `source` sier det (forespørsel 7–12 under):
- en dobbeltdør blir to dører side om side i hullet, hengslet i hver sin karm;
- en skyvedør blir en åpning;
- takvinduer blir data på rommets himling (`ceilings[].skylights`), som ingenting bygger;
- en garasjeport blir en åpning;
- en kvartsvingt trapp blir en U-trapp, med et notat;
- takformen står bare i dokumentet (`doc.roof`), og himlingen er flat med én høyde per rom.

**Kontroll.** Huset valideres med spillets egen `validateHouse` (`src/data/scripts/house.mjs`), også i nettleseren
(«Kontroller huset»). Den eneste feilen som filtreres bort, er at «stue-kjokken» mangler: den gjelder bare eierens hus.
Begge v1-testplanene og alle de syntetiske planene gir 0 feil og 0 advarsler. Med «Generer» gir 8 av de 10 testhusene
0 feil. hus1 har 2 (en vegg på loftet som ligger 0,100 m bak en vegg som er 0,106 m tykk) og hus2 har 11 (rom som ligger
som øyer i den åpne stua og overlapper den med 2,1 og 1,0 m²).

## 3D

`viewer.js` setter sammen `baseSpec()` og husfila og bygger `layout.js` med `buildLayout`, `rooms.js` med `buildRooms`
og `stairs.js` med `buildStairs`. Det er de samme byggerne som spillet bruker: vegger med flater og `backOf`, gulv, tak,
vinduer og dører som åpnes. Spilleren går med `PlayerController`, `Input`, `CollisionWorld` og `InteractionSystem`.

Lyset er enkelt: himmel, sol fra sør og én lampe per rom. Stua i spillet (`shell.js`, `kitchen.js`, `LightManager`,
designet) brukes ikke, siden et kundehus ikke har den.

Takvinduene vises som lyse felt med ramme i taket når man går rundt. Det er en stedfortreder til `rooms.js` bygger dem.

## Testene

Alle er rene Node-skript med `check`, `section` og `done` fra `tools/planbygger-lib.mjs`, og ingen trenger
API-nøkkel. Tallene er fra sluttkontrollen, kjørt etter hverandre med ingenting annet på maskinen.

| Test | Sjekker | Tid | Hva |
|---|---|---|---|
| `test-planbygger.mjs` | 121 | 14 s | v1: rasteroperasjoner, rom, eksport mot validatoren, syntetiske planer (35–120 px/m, støy, grå vegger, 2× og 4×), eierens hus, skala, `buildLayout` og `buildRooms`, rettingene, etasjer og trapper, skjeve planer |
| `test-planbygger-detect.mjs` | 163 | 121 s | dørvarianter, takvinduer, trapper (også U-trapp rundt et øye), skillelinjer ved 35–120 px/m, hus4, hus6, hus8 og hus9, tider (beste av 3) |
| `test-planbygger-ai.mjs` | 381 | 490 s | opptakene mot fasiten, plass-sjekkene, vernet over ekte HTTP (Vite på port 5276; `--no-vite` hopper over), merkene, KI mot uten KI per etasje |
| `test-planbygger-autoscale.mjs` | 106 | 70 s | lagene, tilfeldige mål, papir på utsnitt, samme kilde |
| `test-planbygger-sheet.mjs` | 201 | 32 s | arkene i egen størrelse og omsamplet |
| `test-planbygger-photo.mjs` | 32 | 42 s | hus3-foto, syntetiske foto, digitale tegninger som ikke skal rettes |
| `test-planbygger-clean.mjs` | 93 | 57 s | «aldri verre» per plan, fargede vegger |
| `test-planbygger-align.mjs` | 49 | 27 s | trapp, omriss og hjørne mot håndmålt fasit |
| `test-planbygger-facade.mjs` | 73 | 20 s | fasadene, skjeve og skalerte tegninger, hus7 |
| `test-planbygger-generate.mjs` | 295 | 310 s | «Generer» på alle husene med og uten KI mot fasiten, svarene, avspillingen, når noe går galt (4b), og «Ferdig betyr» |

- **`test-planbygger-generate.mjs`** har terskler fra det runde 1 når: en sjekk som feiler, er en tilbakegang. Hver
  etasje skal ha vegger og rom, takvinduene skal stemme eksakt, og en skala som er mer enn 3 % feil, skal spørres om.
  Unntakene står i en liste med begrunnelse (hus4 1. etasje +3,7 %). «Ferdig betyr» skrives ut som mål og feiler bare
  med `--strict-goals`. `--quick` tar bare hus1, hus3 og hus8.
- **`test-planbygger-browser.mjs --lock`** kjører siden ende til ende i en hodeløs Edge (egen Vite-server på port
  5272, tar GPU-låsen). Skjermbilder havner i `.shots/planbygger/`.
  - Del 0: uten nettleser (EXIF-brennvidden, stabelens første rekkefølge, arbeiderens rene data).
  - Del 1–8: v1 som før (eksempelplanen, målelinja, dra og angre, navngi et rom, 3D, gå og åpne en dør, en skjev plan).
  - Del 9: hus3 uten KI. Stabelen, «Generer», «Neste» på hvert kort, 3D med 2 etasjer og 0 feil, gå med W og
    «Finjuster». En skyvedør vises uten bue, vinkel og hengsel, og typemenyen gjør den om til en dobbeltdør.
  - Del 10: det samme med opptakene, spilt av gjennom testserverens KI-rute og sidens egen `ai.js`.
  - Del 11 (`--houses` eller `--only=hus`): alle ti husene med originalfilene, uten KI og med opptakene.
  - Del 12: en PDF med flere sider (lat lesing, 45 sider blir 40 med beskjed, «Bare én plan» tar side 1).
  - Ingen ekte KI-kall: testserveren svarer selv på `/api/planbygger/ai`, og `ANTHROPIC_API_KEY` fjernes fra
    serverens miljø.
  - Siste kjøring: 51 av 51 (del 0–10 og 12), og 60 av 62 med `--only=hus` (hus7 uten KI er tomt, og hus9 med
    opptakene har 1 feil i validatoren).
- **`node tools/planbygger-measure-all.mjs --write`** kjører «Generer» på alle husene og skriver tabellen i «Runde 1:
  målinger per hus». `--json f` og `--from f` gjenbruker en kjøring, `--only` velger hus, `--model readPlan=sonnet`
  bytter modell for en sammenligning, `--facade-ai` slår fasade-KI-en på, og `--record --budget N` tar opp nye
  KI-svar (bare med nøkkel).

## Målinger mot eierens hus

Fasiten er huset som ble bygd for hånd i natt (`research/house/10-hoved-rom.json`, `30-kjeller.json` og stua i
`research/room-spec.json`, flettet i `src/data/room-spec.json`). Brukerens valg er det siden ber om: skala fra den lengste
målelinja, og nord til venstre. Dette er v1-flyten med én plan.

Rettingene er det eieren gjør i editoren (`tools/planbygger-corrections.mjs`, én linje per handling):

- gi rommene navn;
- gjøre gangdøra om fra åpning til dør (den er tegnet som et vindu, uten bue);
- legge inn døra til den grå boden (den finnes ikke i planen);
- snu hengsel og slagretning;
- sette ytterveggene til 0,30 m.

Det som ble flyttet etter bildene i natt (V-punktene i `notes/hele-huset-avstemming.md`), er ikke rettet. Det står
igjen som avvik.

Veggavviket måles langs alle romflater med 5 cm mellomrom. «Etter forskyvning» betyr etter den beste
parallellforskyvningen. Kjellerdataene ligger 0,13 m ut i x og z med vilje (avstemming V1), og det absolutte origoet
betyr ikke noe for formen.

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

- **1. etasje:** alle veggflatene er funnet. Snittavviket er 1,2 cm og maks 2,3 cm etter forskyvning. Det er under én
  piksel (1 px = 1,9 cm), og avviket mellom tegningen og bildemålingene er like stort. Alle 4 dørene og 7 vinduene er
  funnet. Den ene «feilen» er gangdøra, som planen tegner som en åpning uten bue. Rommene overlapper fasiten med
  97–100 %.
- **Kjelleren:** veggene som finnes, ligger 0,5 cm unna (median 0,3 cm). De 11 % av veggflatene som ikke ble funnet,
  er nøyaktig de veggene nattarbeidet flyttet bort fra tegningen etter bildene:
  - sjaktveggene er låst til 1. etasje (V3): `w-kg-nisje`, `w-b1-vest`, `w-kg-vest` og `w-vask-ost`;
  - entréens vestvegg er lagt på ytterflaten (V8);
  - bod 3 er flyttet 6 cm (V9).

  Gjenkjenningen følger altså planen. Der fasiten avviker fra planen, avviker også forslaget. Døra til den grå boden
  er ikke tegnet, så den kan ikke finnes.
- **Rettinger:** 6 handlinger i 1. etasje og 12 i kjelleren. Etter dem er alle dørene, vinduene og rommene på plass med
  riktig type, slagretning og navn. Det meste er romnavn (4 + 8).
- **Hele huset:** justeringsregelen alene (ytterhjørnet NØ) legger kjelleren der nattarbeidet la den for hånd, med
  0,0 cm restforskyvning. Det er 0,9 cm snittavvik på kjellerveggene uten noen manuell forskyvning. Trappa er ikke
  gjenkjent i denne målingen. Den er tegnet for hånd som U-trapp, og en U-trapp har like lange løp, mens eierens har et
  kort øvre og et langt nedre løp.

## Runde 1: målinger per hus

<!-- hus:start -->
_Generert av `node tools/planbygger-measure-all.mjs --write`: «Generer» på alle husene, med de lagrede KI-svarene (Haiku) og uten KI, mot `plantegninger/<hus>/fasit.json`._

Kolonnene: per etasje skilt med «·». Skala: px/m og feilen mot fasitens px/m (– der fasiten ikke har noen, og på fotoet, som rettes opp til et annet rutenett), og metoden. «Skala fra rommene»: medianen av generert areal / etikettareal over rommene som ble funnet, som skalafeil. Rom: funnet (en generert region for etiketten: etter navn, ellers areal innen 15 %), med navnet fra tegningen i et eget rom («+n delt»: etiketter som deler rommet med en annen etikett, fordi gjenkjenningen slo dem sammen eller planen er åpen), med riktig type (gang og entré godtas begge for rommet med inngangsdøra). Vegger / rom i 3D: veggene i etasjen og rommene eksporten lager. Dører: enkle/doble/skyve, fasiten i parentes. Trapp: bygd som rett eller U, typen tegningen viste, fasitens type i parentes. Fasadevinduer: generert/fasit per fasade.

| Hus | KI | Etasjer (rekkefølge) | Skala px/m (feil) | Skala fra rommene | Rom: funnet / navn / type | Vegger / rom i 3D | Dører enkel/dobbel/skyve (fasit) | Vinduer | Takvinduer | Trapp | Tak | Fasadevinduer | Spørsmål | Feil i 3D-huset |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hus1 | ja | 2 av 2 (2/2 rett) | 97,2 (−0,2 %) areas · 93,8 (−0,2 %) sameSource | −0,0 % (6 rom) · +19,5 % (5 rom) | 6/6/6 av 6 · 7/5 (+2 delt)/6 av 7 | 19 / 6 · 23 / 6 | 4/2/1 (4/2/1) · 6/0/0 (6/0/0) | 11 (11) · 6 (6) | 0 (0) · 4 (4) | U fra kvartsvingt (kvartsvingt) | gable-dormer (gable-dormer) | 4 av 4 fasader; 7/6 4/4 3/3 4/4 | 2 (ceiling 2) | 2 feil, 1 adv. |
| hus1 | nei | 2 av 2 (2/2 rett) | 96,2 (−1,2 %) standard · 91,4 (−2,8 %) standard | +1,0 % (6 rom) · +0,3 % (1 rom) | 6/0/2 av 6 · 1/0/0 av 7 | 19 / 6 · 23 / 6 | 4/2/1 (4/2/1) · 6/0/0 (6/0/0) | 11 (11) · 6 (6) | 0 (0) · 3 (4) | U fra kvartsvingt (kvartsvingt) | gable-dormer (gable-dormer) | 4 av 4 fasader; 7/6 4/4 3/3 4/4 | 16 (scale 2, ceiling 2, room 12) | 2 feil, 1 adv. |
| hus2 | ja | 1 av 1 (1/1 rett) | 55,7 (+0,2 %) dimensions | −0,4 % (11 rom) | 17/12 (+5 delt)/15 av 17 | 30 / 14 | 10/0/5 (10/0/5) | 12 (12) | 0 (0) | ingen (ingen) | gable (gable) | 4 av 4 fasader; 3/3 1/2 4/4 2/3 | 1 (ceiling 1) | 11 feil, 0 adv. |
| hus2 | nei | 1 av 1 (1/1 rett) | 55,9 (+0,6 %) standard | −0,8 % (11 rom) | 11/0/7 av 17 | 30 / 14 | 10/0/5 (10/0/5) | 12 (12) | 0 (0) | ingen (ingen) | gable (gable) | 4 av 4 fasader; 3/3 1/2 4/4 2/3 | 12 (scale 1, ceiling 1, room 10) | 10 feil, 0 adv. |
| hus3 | ja | 2 av 2 (2/2 rett) | 47,9 (−0,0 %) dimensions · 47,7 (−0,2 %) areas | +0,5 % (2 rom) · −0,0 % (4 rom) | 4/2 (+2 delt)/3 av 4 · 8/4 (+4 delt)/6 av 8 | 12 / 3 · 15 / 6 | 6/0/0 (7/0/0) · 2/0/3 (4/0/3) | 5 (6) · 6 (6) | 0 (0) · 0 (0) | rett fra rett (rett) | gable (gable) | 4 av 4 fasader; 3/4 2/2 4/4 2/2 | 2 (ceiling 2) | 0 feil, 1 adv. |
| hus3 | nei | 2 av 2 (2/2 rett) | 48,4 (+1,0 %) standard · 48,4 (+1,2 %) sameSource | −0,2 % (3 rom) · −1,5 % (4 rom) | 3/0/1 av 4 · 4/0/4 av 8 | 12 / 3 · 15 / 6 | 6/0/0 (7/0/0) · 2/0/3 (4/0/3) | 5 (6) · 6 (6) | 0 (0) · 0 (0) | rett fra rett (rett) | gable (gable) | 4 av 4 fasader; 3/4 2/2 4/4 2/2 | 13 (scale 2, ceiling 2, room 9) | 0 feil, 1 adv. |
| hus3-foto | ja | 1 av 1 (1/1 rett) | 102,0 (–) dimensions | +1,4 % (1 rom) | 1/1/1 av 4 | 20 / 1 | 5/0/0 (7/0/0) | 3 (6) | 0 (0) | ingen (ingen) | – | – | 2 (windows 1, ceiling 1) | 0 feil, 0 adv. |
| hus3-foto | nei | 1 av 1 (1/1 rett) | 102,2 (–) standard | +3,3 % (2 rom) | 2/0/0 av 4 | 25 / 2 | 5/0/0 (7/0/0) | 3 (6) | 0 (0) | ingen (ingen) | – | – | 5 (windows 1, scale 1, ceiling 1, room 2) | 0 feil, 0 adv. |
| hus4 | ja | 2 av 2 (2/2 rett) | 125,1 (+3,7 %) areas · 125,1 (+3,4 %) sameSource | +0,1 % (6 rom) · +2,9 % (1 rom) | 8/6 (+2 delt)/7 av 9 · 3/1 (+2 delt)/2 av 5 | 27 / 7 · 13 / 3 | 7/0/0 (8/0/1) · 5/0/0 (4/0/0) | 8 (6) · 9 (9) | 0 (0) · 0 (0) | U fra U (U) | mono-pitch (mono-pitch) | 4 av 4 fasader; 5/5 2/2 7/6 2/2 | 5 (stair 1, ceiling 2, scale 1, room 1) | 0 feil, 2 adv. |
| hus4 | nei | 2 av 2 (2/2 rett) | 120,4 (−0,2 %) standard · 120,4 (−0,5 %) sameSource | +0,1 % (5 rom) · −4,1 % (3 rom) | 5/0/4 av 9 · 3/0/2 av 5 | 27 / 7 · 13 / 4 | 7/0/1 (8/0/1) · 5/0/0 (4/0/0) | 7 (6) · 9 (9) | 0 (0) · 0 (0) | U fra U (U) | mono-pitch (mono-pitch) | 4 av 4 fasader; 5/5 2/2 7/6 2/2 | 15 (scale 2, ceiling 2, room 11) | 0 feil, 3 adv. |
| hus5 | ja | 1 av 1 (1/1 rett) | 47,0 (+0,2 %) areas | −0,0 % (9 rom) | 13/9 (+4 delt)/12 av 13 | 24 / 11 | 10/0/4 (10/0/4) | 15 (15) | 0 (0) | ingen (ingen) | mono-pitch (mixed) | 4 av 4 fasader; 3/3 3/3 4/4 5/5 | 1 (ceiling 1) | 0 feil, 0 adv. |
| hus5 | nei | 1 av 1 (1/1 rett) | 46,8 (−0,3 %) standard | +0,5 % (9 rom) | 9/0/5 av 13 | 24 / 11 | 10/0/4 (10/0/4) | 15 (15) | 0 (0) | ingen (ingen) | mono-pitch (mixed) | 4 av 4 fasader; 3/3 3/3 4/4 5/5 | 13 (scale 1, ceiling 1, room 11) | 0 feil, 0 adv. |
| hus6 | ja | 1 av 1 (1/1 rett) | 79,0 (+0,3 %) dimensions | +0,9 % (3 rom) | 3/3/3 av 7 | 42 / 4 | 6/0/3 (2/0/6) | 16 (8) | 0 (0) | ingen (ingen) | – | – | 2 (windows 1, ceiling 1) | 0 feil, 0 adv. |
| hus6 | nei | 1 av 1 (1/1 rett) | 41,7 (−47,1 %) standard | – | 0/0/0 av 7 | 37 / 1 | 2/0/4 (2/0/6) | 10 (8) | 0 (0) | ingen (ingen) | – | – | 4 (windows 1, scale 1, ceiling 1, room 1) | 0 feil, 0 adv. |
| hus7 | ja | 1 av 1 (1/1 rett) | 117,5 (+0,1 %) dimensions | −1,1 % (1 rom) | 1/1/1 av 1 | 6 / 1 | 0/0/0 (0/0/0) | 0 (0) | 0 (0) | ingen (ingen) | gable (gable) | 4 av 4 fasader; 0/0 0/0 0/0 0/0 | 2 (windows 1, ceiling 1) | 0 feil, 0 adv. |
| hus7 | nei | 1 av 1 (1/1 rett) | 47,1 (−59,9 %) standard | – | 0/0/0 av 1 | 9 / 0 | 0/0/0 (0/0/0) | 0 (0) | 0 (0) | ingen (ingen) | gable (gable) | 4 av 4 fasader; 0/0 0/0 0/0 0/0 | 4 (windows 1, scale 1, walls 1, ceiling 1) | 0 feil, 0 adv. |
| hus8 | ja | 2 av 2 (2/2 rett) | 31,2 (–) standard · 31,2 (–) standard | – · – | 7/5 (+2 delt)/7 av 7 · 9/7 (+2 delt)/9 av 10 | 16 / 6 · 19 / 8 | 5/0/0 (5/0/0) · 6/0/1 (7/0/3) | 4 (4) · 6 (6) | 0 (0) · 0 (0) | rett fra rett (kvartsvingt) | – | – | 5 (windows 1, bra 2, ceiling 2) | 0 feil, 2 adv. |
| hus8 | nei | 2 av 2 (2/2 rett) | 31,2 (–) standard · 31,2 (–) standard | – · – | 0/0/0 av 7 · 0/0/0 av 10 | 16 / 6 · 19 / 8 | 5/0/0 (5/0/0) · 6/0/1 (7/0/3) | 4 (4) · 6 (6) | 0 (0) · 0 (0) | rett fra rett (kvartsvingt) | – | – | 20 (windows 1, order 1, scale 2, ceiling 2, room 14) | 0 feil, 2 adv. |
| hus9 | ja | 2 av 2 (2/2 rett) | 44,7 (−1,6 %) areas · 53,3 (−1,4 %) areas | −1,2 % (3 rom) · −0,1 % (7 rom) | 5/3 (+2 delt)/4 av 5 · 7/7/7 av 7 | 24 / 7 · 26 / 8 | 2/0/1 (3/0/1) · 3/0/1 (5/0/0) | 9 (8) · 5 (6) | 0 (0) · 0 (0) | rett fra rett (kvartsvingt) | – | – | 4 (windows 1, alternative 1, ceiling 2) | 0 feil, 2 adv. |
| hus9 | nei | 2 av 2 (2/2 rett) | 50,0 (+10,1 %) standard · 50,3 (−7,0 %) standard | +4,3 % (1 rom) · −0,9 % (5 rom) | 1/0/1 av 5 · 5/0/1 av 7 | 13 / 4 · 29 / 8 | 2/0/0 (3/0/1) · 4/0/0 (5/0/0) | 8 (8) · 5 (6) | 0 (0) · 0 (0) | rett fra rett (kvartsvingt) | – | – | 18 (stair 1, windows 1, alternative 1, scale 2, ceiling 2, room 11) | 0 feil, 3 adv. |

**Per hus, med KI** (validatorens gjenstående feil, de første to, og det «Generer» selv noterte):

- **hus1:** 11,0 s, 8 av 8 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). 2 feil: «walls/w-gang-trapp-loftstue-4: ligger 0,100 m bak w-bad-8, men w-bad-8 er 0,106 tykk – et backOf-par skal ligge nøyaktig én tykkelse fra hverandre»; «walls/w-bad-8 (bad, 0,11 tykk) står inne i rommet gang-trapp-loftstue (0,006 m²)». 2. etasje: trappa er kvartsvingt (svinger 90°), men husformatet har bare rette trapper og U-trapper. Den er lagt inn som U-trapp.
- **hus2:** 7,7 s, 3 av 3 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). 11 feil: «rommene stue-kjøkken-gang-entre og wc-d overlapper (2,143 m²)»; «rommene stue-kjøkken-gang-entre og bod overlapper (0,981 m²)»
- **hus3:** 16,4 s, 5 av 5 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). Rettet for 3D-huset: 1. etasje: dør slagretning byttet.
- **hus3-foto:** 11,9 s, 2 av 2 KI-oppgaver hadde et opptak
- **hus4:** 31,3 s, 8 av 8 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). Rettet for 3D-huset: 2. etasje: dør slagretning byttet.
- **hus5:** 9,5 s, 6 av 6 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). Rettet for 3D-huset: 1. etasje: dør slagretning byttet; 1. etasje: dør slagretning byttet.
- **hus6:** 20,6 s, 2 av 2 KI-oppgaver hadde et opptak. Rettet for 3D-huset: 1. etasje: dør hengsel byttet; 1. etasje: en åpning som lå oppå en annen, er fjernet.
- **hus7:** 11,2 s, 2 av 2 KI-oppgaver hadde et opptak (4 fasadeoppgaver sendes ikke). «garasje-plan-snitt-fasade.pdf»: veggene ble ikke funnet på vanlig måte, så de er lest som konturlinjer (to tynne streker per vegg) (den åpne siden nederst er lukket med en vegg med 1 åpning der portene står). Sjekk dem i «Finjuster». «garasje-plan-snitt-fasade.pdf» («ØST»): Fant ingen sikker bakkelinje: huset står ikke på noen lang linje (terreng, målekjeder eller tekst rundt det).
- **hus8:** 11,1 s, 5 av 5 KI-oppgaver hadde et opptak. «plantegning-1.jpg» (del 1) er samme tegning som «plantegning-2.jpg», og er brukt én gang. «plantegning-1.jpg» (del 2) er samme tegning som «plantegning-3.jpg» (del 1), og er brukt én gang. «plantegning-1.jpg» (del 3) er samme tegning som «plantegning-3.jpg» (del 2), og er brukt én gang. «plantegning-3.jpg»: en mindre bygning ved siden av huset er ikke tatt med som etasje. Rettet for 3D-huset: like tykkelser på vegglinjer som skifter noen millimeter.
- **hus9:** 11,2 s, 5 av 5 KI-oppgaver hadde et opptak. Rettet for 3D-huset: Øvre etasje: en åpning som lå oppå en annen, er fjernet; Underetasje: en åpning som lå oppå en annen, er fjernet; en vegg som var funnet to ganger, noen centimeter fra hverandre, er slått sammen. «underetasje-alternativ.jpg» er et alternativ til «underetasje.jpg»; huset er bygd med «underetasje.jpg».

**«Ferdig betyr» (hus1, hus2, hus3 og hus5 med KI):**

| Hus | Etasje | Mål | Resultat | |
|---|---|---|---|---|
| hus1 | 1. etasje | skala innen 2 % | −0,2 % | ✓ |
| hus1 | 1. etasje | rom med navn, hvert i sitt eget rom | 6 av 6 | ✓ |
| hus1 | 1. etasje | dobbeltdører | 2 (fasit 2) | ✓ |
| hus1 | 1. etasje | skyvedører | 1 (fasit 1) | ✓ |
| hus1 | 1. etasje | takvinduer | 0 (fasit 0) | ✓ |
| hus1 | 2. etasje | skala innen 2 % | −0,2 % | ✓ |
| hus1 | 2. etasje | rom med navn, hvert i sitt eget rom | 5 av 7, 2 deler rom med en annen etikett | ✗ |
| hus1 | 2. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus1 | 2. etasje | skyvedører | 0 (fasit 0) | ✓ |
| hus1 | 2. etasje | takvinduer | 4 (fasit 4) | ✓ |
| hus2 | 1. etasje | skala innen 2 % | +0,2 % | ✓ |
| hus2 | 1. etasje | rom med navn, hvert i sitt eget rom | 12 av 17, 5 deler rom med en annen etikett | ✗ |
| hus2 | 1. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus2 | 1. etasje | skyvedører | 5 (fasit 5) | ✓ |
| hus2 | 1. etasje | takvinduer | 0 (fasit 0) | ✓ |
| hus3 | 1. etasje | skala innen 2 % | −0,0 % | ✓ |
| hus3 | 1. etasje | rom med navn, hvert i sitt eget rom | 2 av 4, 2 deler rom med en annen etikett | ✗ |
| hus3 | 1. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus3 | 1. etasje | skyvedører | 0 (fasit 0) | ✓ |
| hus3 | 1. etasje | takvinduer | 0 (fasit 0) | ✓ |
| hus3 | 2. etasje | skala innen 2 % | −0,2 % | ✓ |
| hus3 | 2. etasje | rom med navn, hvert i sitt eget rom | 4 av 8, 4 deler rom med en annen etikett | ✗ |
| hus3 | 2. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus3 | 2. etasje | skyvedører | 3 (fasit 3) | ✓ |
| hus3 | 2. etasje | takvinduer | 0 (fasit 0) | ✓ |
| hus5 | 1. etasje | skala innen 2 % | +0,2 % | ✓ |
| hus5 | 1. etasje | rom med navn, hvert i sitt eget rom | 9 av 13, 4 deler rom med en annen etikett | ✗ |
| hus5 | 1. etasje | dobbeltdører | 0 (fasit 0) | ✓ |
| hus5 | 1. etasje | skyvedører | 4 (fasit 4) | ✓ |
| hus5 | 1. etasje | takvinduer | 0 (fasit 0) | ✓ |

<!-- hus:slutt -->

**Hva tallene betyr:**

- **Spørsmål:** med KI får hvert hus 1–5 spørsmål, 26 i alt. 15 av dem er takhøyden, som spørres for hver etasje. Uten
  KI blir det 4–20 per hus, 120 i alt, mest romnavn (hus8 20 og hus9 18).
- **Skala:** med KI er 10 av de 12 etasjene der fasiten har en skala, innen 2 %. hus4 er +3,7 og +3,4 % uten spørsmål,
  fordi de grå veggene gjør rommene for store. hus8 har ingen skala i fasiten: «Generer» spør om BRA og står på
  31,2 px/m, mot fasitens anslag på ca. 34. Uten KI bommer hus6 (−47 %), hus7 (−60 %) og hus9 (+10 og −7 %), men alle
  tre spørres om målestokken.
- **Rom:** med KI er 99 av 110 rom funnet, 72 med navn i et eget rom og 27 som deler rom med en annen etikett, og 89
  med riktig type. Uten KI er 50 funnet, 27 med riktig type og ingen med navn.
- **Dører og vinduer:** stemmer på hus1, hus2 og hus5. hus3 mangler 1 og 2 enkle dører. hus6 får 16 vinduer mot 8 og
  dørene 6/0/3 mot 2/0/6.
- **Tak:** riktig på 5 av 6 hus med fasader. hus5 blir pulttak, der fasiten sier «mixed».
- **Trapper:** riktig type på hus3 (rett) og hus4 (U). hus1 er kvartsvingt og bygges som U, fordi husformatet ikke har
  kvartsvingte trapper. hus8 og hus9 bygges rett, der fasiten sier kvartsvingt.
- **3D-huset:** 0 feil i validatoren på 8 av 10 hus. hus1 har 2 og hus2 11 (se «Kontroll» over).
- **De svake husene:** hus3-foto blir et skall med 1 rom (4 i fasiten). hus6 får 4 rom i 3D mot 7 etiketter. hus7 uten
  KI er tomt.
- **Tid:** 8–31 s per hus i Node med opptakene, uten ventetid på KI-en (hus4 er tregest).

### Sluttkontrollen

Alle testene, kjørt etter hverandre med ingenting annet på maskinen:

| Test | Resultat | Tid |
|---|---|---|
| `test-planbygger.mjs` | 121 av 121 | 14 s |
| `test-planbygger-detect.mjs` | 163 av 163 | 121 s |
| `test-planbygger-ai.mjs` (Vite på port 5276) | 381 av 381, med 7 MERK om foreldede opptak | 490 s |
| `test-planbygger-autoscale.mjs` | **105 av 106** | 70 s |
| `test-planbygger-sheet.mjs` | 201 av 201 | 32 s |
| `test-planbygger-photo.mjs` | 32 av 32 | 42 s |
| `test-planbygger-clean.mjs` | 93 av 93 | 57 s |
| `test-planbygger-align.mjs` | 49 av 49 | 27 s |
| `test-planbygger-facade.mjs` | 73 av 73 | 20 s |
| `test-planbygger-generate.mjs` | 295 av 295, «Ferdig betyr» 25 av 30 mål | 310 s |
| I alt | 1513 av 1514 | |

Sjekken som feiler, er «hus4/1etg.readPlan.claude-haiku: ikke høy sikkerhet når den bommer med over 2 %». Arealene gir
125,07 px/m (+3,8 %) med sikkerheten «høy» (se `autoscale.js`). Nettlesertesten kjøres bare av den som eier
brukerflaten; siste kjøring er 51 av 51, og 60 av 62 for alle husene.

**«Ferdig betyr» for runde 1:**

| Mål | Nådd | Målt |
|---|---|---|
| «Generer» tar hvert av de ti husene fra filene til et 3D-hus man kan gå i | delvis | Alle ti bygges, med og uten KI: 20 av 20 kjøringer uten krasj, også gjennom spillets `buildLayout`, `buildRooms` og `stairLayout`. Gåing er bare bevist i nettleseren, på hus3. Validatoren avviser hus1 (2 feil) og hus2 (11). hus3-foto er et skall (1 rom, 4 vegger og 0 vinduer i husfila), og hus7 uten KI er tomt. |
| … med så få spørsmål som mulig | ja | 26 med KI (1–5 per hus), 120 uten. 15 av de 26 er takhøyden. hus4 1. etasje bygges +3,7 % uten spørsmål. |
| Skala innen 2 % på hus1, hus2, hus3 og hus5 | ja, med KI | −0,2 og −0,2 %, +0,2 %, 0,0 og −0,2 %, +0,2 %. Svarene bak hus2 og hus3 2. etasje er foreldede opptak. Uten KI er hus1 2. etasje −2,8 % (og spurt om). |
| Rommene har navn | nei | Med regelen «hver etikett i sitt eget rom» består 1 av 6 etasjer: hus1 1. etasje, 6 av 6. De andre: hus1 2. etasje 5 av 7, hus2 12 av 17, hus3 2 av 4 og 4 av 8, hus5 9 av 13. De fleste er åpne planer, der det genererte rommet får et sammensatt navn («Stue + Kjøkken + Gang + Entré», «Gang/trapp + Loftstue», «Sov + Gang»). Én er en ekte feil: «Bad + Bod» i hus3 2. etasje. |
| Dobbeltdører og skyvedører gjenkjennes | ja | Antallene og plassene stemmer på alle 6 etasjene. Skyvedøra i hus1 er for bred (1,71 mot 0,79 m). Skyvedørene kommer fra `detect.js`, ikke fra KI-en, og eksporteres som åpninger. |
| Takvinduer gjenkjennes | ja | 4 av 4 på hus1 2. etasje (3 av 4 uten KI). De andre etasjene har ingen og fikk ingen. |
| Målt resultat per hus i notatene | ja | Tabellen over, med og uten KI. |
| Alle Node-tester grønne | nei | 1513 av 1514 (autoscale, hus4). |

Runde 1 er altså ikke ferdig etter sin egen definisjon. To mål er ikke nådd (navnene og testene), og ett er bare delvis
nådd (å gå i alle husene). Det som stopper navnene, er gjenkjenningen som slår sammen rom, og at noen planer er åpne,
ikke KI-svarene.

## Begrensninger: hva som fungerer, og hva som må rettes

**Fungerer godt:**

- digitale planer fra husleverandører og meglere med svarte eller grå vegger (hus1, hus2, hus3, hus5): med KI er
  skalaen innen 0,2 %, og dørvariantene og vinduene stemmer med fasiten;
- flere tegninger på ett ark (hus7, hus8, fasadeark), PDF (skannet og vektor), AVIF, JPG og mobilfoto med EXIF-retning;
- etasjene i riktig rekkefølge på alle ti husene, og lagt oppå hverandre innen 0,5–2,1 cm der trappa finnes (hus1, hus3,
  hus4 og hus9);
- målestokk fra mål, arealer, «1:100» og PDF-siden, BRA eller standardmål;
- dobbeltdører og skyvedører tegnet med symbol, takvinduer tegnet som stiplede rektangler;
- rette, kvartsvingte og halvsvingte trapper på 8 av 11 planer med trapp, og ingen falske trapper på de tre uten;
- takformen fra fasadene (5 av 6 hus);
- fargede rom, grå møbler, målelinjer, tekst og skravur;
- oppløsning fra ca. 35 px/m (oppskalert) til minst 200 px/m, også med pikselstøy;
- skjeve planer opptil ±10° og skjeve fasader opptil ±4° (rettes opp automatisk).

**Må rettes for hånd (i veiviseren eller «Finjuster»):**

- **Takhøyden** spørres alltid, med 2,4 m som forslag. Himlingstekster som «SKRÅ HIMLING 24°» vises som hjelp, men
  skrå himling kan ikke bygges.
- **Rom som er slått sammen.** Åpne planer og noen gjenkjenningsfeil gir ett rom med to navn («Sov + Gang»). Kunden
  deler dem med en vegg i «Finjuster». Skillelinjer som finnes, deler dem ikke ennå.
- **Romnavn uten KI.** Typen gjettes ut fra størrelse, dører og vinduer. Navnet bør kunden skrive (ett kort per rom).
- **Dører uten bue eller symbol**, og ting som ikke står i planen: dører som ikke er tegnet, og brystningshøyder når det
  ikke finnes fasader.
- **Kvartsvingte trapper** bygges som U-trapp, og trapper med løp av ulik lengde blir bare omtrent riktige.
- **Skrå tak, nivåforskjeller i et rom og buede vegger** støttes ikke. Himlingen er flat med én høyde per rom.

**Fungerer ikke ennå:**

- **Mobilfoto:** arket rettes opp riktig (husets form innen 0,3 %), men gjenkjenningen på fotoets tynne linjer gir 1 av
  4 rom (hus3-foto).
- **Skannede arkitekttegninger** (hus6): skalaen treffer med KI (+0,3 %), men det blir 3 av 7 rom, 16 vinduer mot 8 og
  dørene 6/0/3 mot 2/0/6. Uten KI blir skalaen −47 %.
- **Vegger som to tynne konturlinjer** (hus7): med KI blir det ett rom med porten som én åpning på 5,2 m (fasiten har to
  porter på 2,39 m og en stolpe). Uten KI blir huset tomt.
- **Hobbytegninger med teksturgulv og møbler** (hus9): skalaen er innen 2 % med KI, men møbler blir vegger, og trappa,
  tegnet som skyggelagte trinn, finnes ikke.
- **Lysegrå vegger med tynne konturer** (hus4): rommene blir for store, og skalaen +3,7 % uten spørsmål.
- **Skrå vegger** i gjenkjenningen. Editoren og eksporten støtter dem, så de kan tegnes inn.
- **Svarte møbler inntil vegger** kan bli vegg.
- **KI-en leser ikke skyvedører** på en merket plan, og fasadesvaret gjorde tak og vinduer dårligere (det er slått av).
- **Med ekte KI** er «Generer» ikke målt i nettleseren. `readPlan` tar 16,5 s i snitt med Haiku.

## Hvor langt er det til noe som kan selges?

Ærlig vurdering, oppdatert etter runde 1.

**Status per tegningstype** (med KI / uten KI, fra tabellen over):

| Tegning | Hus | Med KI | Uten KI |
|---|---|---|---|
| Digital katalog- eller meglertegning med arealer eller mål | hus1, hus2, hus3, hus5 | skala innen 0,2 %, dørene og vinduene stemmer, 1–2 spørsmål; åpne planer gir sammenslåtte rom | skala innen 1,2 % (hus1 2. etasje −2,8 %, spurt), 12–16 spørsmål |
| Moderne, lysegrå vegger, tregulvskravur | hus4 | +3,7 % uten spørsmål, 8 av 9 rom, U-trapp | −0,2 %, 15 spørsmål |
| Skannet arkitekttegning (PDF) | hus6 | +0,3 %, 3 av 7 rom, 16 vinduer mot 8 | −47 % (spurt), 1 rom i 3D |
| Garasje på et arkitektark | hus7 | +0,1 %, 1 rom, porten som én åpning | −60 % (spurt), tomt |
| FINN-tegning uten mål og arealer | hus8 | BRA spørres, 16 av 17 rom | 20 spørsmål; ingen rom kan kobles til fasiten (ingen navn, ingen arealer) |
| Hobbytegning med lav oppløsning | hus9 | −1,6 og −1,4 %, 12 av 12 rom, rett trapp der fasiten har kvartsvingt | +10 og −7 % (spurt), 18 spørsmål |
| Mobilfoto av en utskrift | hus3-foto | arket rettes opp riktig, men 1 av 4 rom | 2 av 4 rom |

**Hva runde 1 flyttet:**

- «Flere plantyper» fra v1-anslaget er i stor grad gjort for digitale planer: dobbeltdører, skyvedører, takvinduer,
  trapper, flere tegninger på ett ark, PDF, oppretting av foto, og KI som leser navn og mål.
- Det finnes et testsett med ti ekte hus og fasit, og hvert hus er målt, med og uten KI.
- Flyten for en lat kunde finnes: slipp alt, trykk «Generer», svar på 1–5 kort.

**Hva runde 1 viste:**

- De rene digitale planene er nær målet. De vanskelige tegningene (skann, foto, konturlinjer, hobbytegninger) gir et
  hus, men ikke et riktig hus.
- KI-en hjelper mye på navn og målestokk, men lite eller negativt på symboler (skyvedører, fasader).
- KI gjør produktet avhengig av en tjeneste, en nøkkel, en kvote og en avtale om personvern.

**Det som gjenstår, grovt anslått for én utvikler:**

1. **Spillet må ta imot et kundehus** (3–5 uker). Det er fortsatt den største biten. Spillets `createHome`
   (`src/home/index.js`) bygger alltid eierens stue: `shell.js`, `kitchen.js`, `exterior.js`, en `LightManager`
   kalibrert mot stua og et design med stuas møbler. For at en kunde skal kunne møblere med katalogen, male og bruke
   lys, må spillet ha en modus for et generisk hus. I tillegg trenger husformatet og motoren det runde 1 fant:
   dobbeltdører, skyvedører, takvinduer, kvartsvingte trapper, takform og skrå himling, garasjeport og åpne romgrenser
   (forespørsel 5 og 7–12).
2. **Kontoer, lagring, personvern og KI-drift** (2–3 uker): én innlogging per kunde (`server.mjs` har bare ett felles
   passord), lagring av prosjekt og husfil på serveren, sletting (en plantegning er personopplysninger etter GDPR),
   KI-ruta i `server.mjs`, kvote per konto i stedet for per IP, samtykke, personvernerklæring og databehandleravtale.
3. **Gjenkjenningen** (3–5 uker): rom som slås sammen (det som stopper målet «rom med navn»), grå vegger, konturlinjer,
   skannede arkitekttegninger, foto, hobbytegninger, de siste trappene og skillelinjene i «Generer» og eksporten. Det
   trengs fortsatt flere ekte kundeplaner: ti hus er nok til å finne feilene, men ikke til å vite hvor ofte de skjer.
4. **Flyten** (1–2 uker): `alignLevelTo` og kontrollen i arbeideren, ny kjøring når et svar flytter skalaen, redigerbare
   skillelinjer, «Generer» målt med ekte KI i nettleseren, og en måte å avbryte på.
5. **Finpuss** (1–2 uker): mobil og nettbrett (editoren og veiviseren er for mus og tastatur i dag), hjelp i selve
   verktøyet, bedre feilmeldinger og ytelse.

Samlet blir det 10–17 uker til en første betalbar versjon for digitale planer. v1-anslaget var 7–13 uker. Anslaget går
opp, ikke ned: runde 1 tok unna mye av «flere plantyper», men la til KI-drift og personvern, og ti ekte hus viser mer
som gjenstår enn de to testplanene i v1 gjorde. Skannede tegninger og fotoer tar klart lengre tid.

**Driften er fortsatt billig.** Alle mål regnes ut i nettleseren, så serveren bruker ingen CPU på dem. KI-en koster
rundt 5–10 øre per hus med Haiku, og serveren har et tak på 5 USD per døgn. Uten KI koster et hus ingenting.

## Forespørsler til hele-huset-arbeidet

Planbyggeren redigerer ingen eksisterende motorfiler. Det som manglet, er løst i planbyggerens egen kode med
omveier. Dette ville gjort omveiene unødvendige:

1. **`buildLayout` (`src/home/layout.js`) godtar et tomt `floor.polygon`.** Den tar i dag sentroiden av stuas gulv
   uten sjekk (`polygonCentroid` på en tom liste krasjer). Omveien er et gulv med null areal i husets første hjørne
   (`mergeOnto` i `export.js`).
2. **`validateHouse` får et valg for hus uten eierens stue**, for eksempel `{ generic: true }`. I dag gir den alltid
   «rommet «stue-kjokken» mangler». Omveien er at planbyggeren filtrerer akkurat den meldingen (`OWNER_ONLY_ERRORS`).
3. **`house.mjs` leser `node:fs`, `node:path` og `node:url` på modulnivå** (`HERE` og `ROOT`), så den kan ikke importeres
   i nettleseren. Omveien er erstatninger for akkurat den fila (`tools/planbygger-vite-plugin.mjs`,
   `src/planbygger/shims/`). Bedre ville vært å flytte stiene inn i funksjonene, eller å skille ut de rene delene.
4. **Ytterkledningen i `rooms.js` følger stuas tak**, med fallback til helningen 0,16216 fra x 3,22. På et kundehus blir
   kledningen derfor 3,35 m høy for x < 3,22 og lavere ellers. Et datafelt for taklinja, eller veggens høyde + 0,3 når
   det ikke finnes noe skrått stuetak, ville løst det.
5. **`createHome` (`src/home/index.js`) får en modus for et generisk hus.** Den ville hoppe over `shell`, `kitchen` og
   `exterior` når spesen ikke har noen stue, og gi lys per rom fra `lightGroups` og `builtInLights`. Da kan et
   planbyggerhus lastes inn i det ekte spillet med katalog, maling og design (punkt 1 i anslaget over).
6. **`stairs.js` gir en rett trapp ingen trinn.** `chains()` tar trappas ytterside som den lengste veien rundt
   fotavtrykket mellom toppen og foten. Det stemmer for den halvsvingte trappa langs sjaktveggene. For en rektangulær,
   rett trapp er det feil side, så alle trinnsnittene feiler, og trappa får verken trinn eller kollisjon.
   `stairLayout` gir 0 trinn. Omveien er at `viewer.js` (`straightStairFix`) gir `buildStairs` en kopi av trappa der
   fotavtrykket er én langside (2 punkter). Da blir det 13 trinn og 82 kolliderere. Husfila og validatoren beholder
   det ekte hullet. Rettingen er at `chains()` tar siden overfor den indre linja for `type: 'straight'`. Testet i
   `tools/test-planbygger.mjs` §9.
7. **Dobbeltdører og skyvedører** i dørbyggeren og `validateHouse`: `door.variant: 'double'` (to blad, `leaf` og
   `leaf2`, hengslet i hver sin karm) og `'sliding'` (blad som skyves langs veggen, uten slagområde). Omveien er at en
   dobbeltdør eksporteres som to dører side om side, og en skyvedør som en åpning. hus1, hus2, hus3 og hus5 har 13
   skyvedører og 2 dobbeltdører som i dag ikke blir dører i 3D.
8. **Takvinduer:** `rooms.js` bygger `ceilings[].skylights` (et hull i himlingen med glass og karm). I dag er de bare
   data, og `viewer.js` viser lyse felt som stedfortreder (hus1 har 4).
9. **Kvartsvingte trapper** (L-trapp med svingtrinn) i husformatet og `stairs.js`, og løp av ulik lengde. Omveien er en
   U-trapp med et notat (hus1; hus8 og hus9 har også kvartsvingte trapper i fasiten).
10. **Takform og skrå himling** i husformatet: saltak, pulttak, valm og ark, og en himling som følger taket
    («SKRÅ HIMLING 24°» på hus2, «Skråhiml.» på hus5, loftet i hus1). I dag står takformen bare i dokumentet
    (`doc.roof`), og himlingen er flat med én høyde per rom.
11. **Garasjeport** som egen åpningstype (leddport eller vippeport, bred og uten slagområde). Omveien er en åpning
    (hus7: én åpning på 5,2 m).
12. **Åpen romgrense:** en romkant uten vegg, for skillelinja mellom to soner i en åpen plan (TV-stue og entré i hus4,
    Hall i hus9). Det nærmeste i dag er en vegg med en åpning over hele lengden og høyden.

## Åpne oppgaver i planbyggeren

Det agentene i runde 1 ba eierne av andre planbyggerfiler om, og som ikke er gjort:

- **Skillelinjene i «Generer»:** `generate.js` (7 kall), `export.js` (`labelRooms`), `autoscale.js` (linje ca. 1155) og
  `tools/planbygger-ai-record.mjs` (linje ca. 65) bytter `findRooms(L.walls)` med `levelRooms(L)`. Da blir TV-stua
  (hus4) og Hall (hus9) egne rom med navn, og arealskalaen får ett rom til. Eksporten må ikke gjøre en romkant med
  `separator` om til en vegg (forespørsel 12).
- **`detect.js`:**
  - ikke slå sammen rom som har en vegg eller dør mellom seg (hus5 SOV + GANG, hus3 2. etasje Arbeidsrom + Gang og
    Bad + Bod, hus4 TV-stue + Entré). Det er dette som stopper målet «rom med navn»;
  - legg veggflatene på kanten av det grå båndet (hus4, +3,7 %);
  - les vegger tegnet som to tynne streker, og garasjeporter som åpninger (hus7);
  - ikke rapporter én strek som to parallelle vegger (hus9);
  - hus9 øvre etasje mister de fleste veggene over ca. 53 px/m med rydding (13 vegger ved 52 px/m, 5 ved 53,13).
- **`export.js` og `regions.js`:** hus2 har 11 feil (rom som øyer i stua), hus1 2 (flatene på loftet). To anslåtte
  passasjer i hus9 ble klemt til samme sted på en romvegg og overlappet.
- **`autoscale.js`:** sikkerhetsregelen (hus4: «høy» ved +3,8 %, testen feiler). Testen peker også på to Sonnet-opptak
  som er slettet, og hopper stille over dem.
- **`worker.js`, `app.js` og `guide.js`:** kjør `alignLevelTo` og kontrollen i arbeideren; kjør `generate(inputs, {
  answers })` på nytt når et svar om målestokk eller BRA flytter skalaen mer enn 4 % (i dag skaleres bare dokumentet,
  uten ny gjenkjenning); `KIND_TITLE.walls = 'Vegger'`.
- **Editoren:** la kunden slette, flytte og tegne skillelinjer. Gjennomgangen fant også at `leaf` og `leaf2` på en
  dobbeltdør ikke følger med når bredden endres i panelet.
- **`facade.js`**, før fasade-KI-en slås på igjen: ett KI-tak høyst en halv stemme og aldri avgjørende ved likt, og
  KI-ens dør- eller vindustype bare der omrisset ikke avgjør. Med vekt 0,5 blir hus1 riktig.
- **`generate.js`:** `askAi('readFacade')` får `null` med en gang (`aiLastError().error` er `'off'`). Kallet kan hoppes
  over, eller merkes som av i rapporten.
- **KI-opptakene:** ta opp de foreldede `readPlan`-opptakene når `detect.js` står stille (se «KI-laget»). Neste
  promptversjon bør beskrive skyvedørsymbolet (en pil langs veggen, ingen bue) og måles med plass-sjekkene.
- **Beslutninger for eieren:**
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
| `src/planbygger/regions.js` | rom fra vegger, med skillelinjer (`levelRooms`) |
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
| `tools/test-planbygger-browser.mjs` | siden ende til ende i hodeløs Edge (`--lock` tar GPU-låsen) |
| `tools/planbygger-measure.mjs` | målingene mot eierens hus (`--write` oppdaterer denne fila) |
| `tools/planbygger-measure-all.mjs` | målingene per hus (`--write` oppdaterer denne fila; `--record` tar opp KI-svar) |
| `tools/planbygger-ai-fixtures.mjs` | avspilling av KI-opptakene i Node og plass-sjekkene (`BY_EYE`) |
| `tools/planbygger-ai-record.mjs` | opptak av enkeltsvar fra KI-en (bare med nøkkel) |
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
