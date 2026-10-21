# Planbygger: fra plantegning til 3D-hus, uten KI

Skrevet 2026-10-21 på grenen `claude/planbygger-5d0fe3` (kuttet fra `hele-huset`). Siden er `planbygger.html` (egen
vite-inngang), koden ligger i `src/planbygger/`, verktøy og tester i `tools/planbygger-*` og `tools/test-planbygger.mjs`.

Planbyggeren gjør én ting: en kunde laster opp sin egen plantegning, og får et 3D-hus hen kan gå rundt i. Alt skjer i
nettleseren, uten server og uten KI. Det er ingen nevrale nett, ingen KI-tjeneste og ingen OCR. Gjenkjenningen er
klassisk bildebehandling med faste regler, og det viktigste i produktet er editoren der kunden retter forslaget.

## Prøv den

```
npx vite --config tools/planbygger-vite.config.mjs --port 5270
```

Åpne `http://127.0.0.1:5270/planbygger.html` og trykk «Prøv med eksempelplanen» (det er `plantegning.png`). Klikk på
målelinja «12.21 m» til høyre, skriv `12,21`, og trykk Enter. Etter et halvt sekund står forslaget der. Rett det, og
trykk «Gå rundt i 3D».

`npm run build` tar med siden (`dist/planbygger.html`), og `server.mjs` serverer den bak samme innlogging som spillet.

## Flyten

1. **Last opp.** PNG, JPG eller WebP. PDF går også: første side tegnes med pdf.js, som hentes fra jsDelivr bare når
   noen faktisk åpner en PDF, så bygget får ingen ny avhengighet. Siden har en slippsone og en eksempelknapp.
2. **Skala.** Kunden klikker på en målelinje. Linja festes til endene sine, også over den hvite tekstboksen midt på
   (`scale.js traceLine`), og kunden skriver bare inn tallet som står på den. Det går også an å klikke to vilkårlige
   punkter. «Foreslå automatisk» gir et forslag uten OCR. Først antas den tynneste vanlige veggen å være 10 cm. Så
   antas medianen av dørhullene gjenkjenningen finner, å være 90 cm (9M-døra). Forslaget bommet med +1,8 % på
   1. etasje og −0,5 % på kjelleren. Det vises som en 2 m lang linje kunden kan sjekke mot en målelinje.
3. **Gjenkjenning** (`detect.js`, i en Web Worker). Den tar 0,3–0,5 s på testplanene.
4. **Retting** i 2D-editoren (`editor.js`). Rommene regnes ut på nytt etter hver endring.
5. **3D** (`viewer.js`). Huset bygges med spillets egne byggere og kan sees ovenfra som et dukkehus eller gås rundt i.
   Dørene åpnes med E eller et klikk.
6. **Last ned.** «Husfil» er formatet i `research/house/NN-*.json`. «Prosjektet» er dokumentet med plantegningene,
   og kan åpnes igjen. Dokumentet lagres også i nettleseren mens kunden jobber (localStorage, og bildene i IndexedDB).

## Gjenkjenningen: klassisk bildebehandling

Alle konstantene står i `DETECT_DEFAULTS` i `src/planbygger/detect.js`. Et mål i meter blir piksler gjennom skalaen.

1. **Gråtoner og blekkmaske.** Terskelen ligger midt i den bredeste dalen etter det svarte toppunktet i histogrammet.
   Den ble 26 på 1. etasje og 38 i kjelleren. Grå møbler, benker og skravur blir dermed ikke vegg.
2. **Åpning med et lite kvadrat** (3×3 ved 50 px/m). Strøk som er tynnere enn den tynneste veggen, forsvinner: tekst,
   mållinjer, dørbuer og vinduslinjer. Små klumper under 12 cm (pilspisser, fet tekst) fjernes.
   Planer under 50 px/m tolkes på en bilineært oppskalert kopi (2–3×). Ellers ville en vegg på 10 cm (3,5 px) også
   forsvunnet.
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
   - **Tomme hull:** et tomt hull under 1,3 m blir en åpning. Lengre tomme hull er ikke åpninger. Et hull med linjer kan
     være opptil 14 m (glassvegger og vindusrekker).
7. **Nettverk og ytterside.** Vegger som ikke henger sammen med hovednettverket, fjernes (møbler, tekst). Yttervegger
   finnes ved å flomfylle papiret fra bildekanten med veggene lukket.

Romnavn kan ikke leses uten OCR, så romtypen gjettes med regler
(`guessKind` i `export.js`):

| Regel | Romtype |
|---|---|
| Det største rommet | stue |
| Lite rom med ytterdør | entré |
| Minst tre dører eller åpninger | gang |
| Uten vindu og under 12 m² | bod |
| Under 7 m² | bad |
| Resten | soverom |

Det ga riktig type for 11 av 12 rom (vaskerommet ble soverom). Navnene vises med «?» til kunden har bekreftet dem.

## Rommene og eksporten

**Rom** (`regions.js`). Veggene i editormodellen (senterlinjer med tykkelse) tegnes i et raster på 2 cm. Hver ende
forlenges med halve tykkelsen til den tykkeste veggen den møter, så L-hjørner lukkes uten at en tykk vegg stikker inn
i rommet ved en T-skjøt. De frie cellene flomfylles, og omrisset av hvert rom følges langs cellekantene. Omrisset
forenkles (Douglas–Peucker, så en skrå vegg blir én kant), og hver kant festes til flaten av veggen den går langs.
Polygonene blir dermed eksakte på veggflatene, ikke på rasteret, og hver kant vet hvilken vegg og hvilken side den
ligger på.

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

**Kontroll.** Huset valideres med spillets egen `validateHouse` (`src/data/scripts/house.mjs`), også i nettleseren
(«Kontroller huset»). Den eneste feilen som filtreres bort, er at «stue-kjokken» mangler: den gjelder bare eierens hus.
Begge testplanene og alle de syntetiske planene gir 0 feil og 0 advarsler.

## 3D

`viewer.js` setter sammen `baseSpec()` og husfila og bygger `layout.js` med `buildLayout`, `rooms.js` med `buildRooms`
og `stairs.js` med `buildStairs`. Det er de samme byggerne som spillet bruker: vegger med flater og `backOf`, gulv, tak,
vinduer og dører som åpnes. Spilleren går med `PlayerController`, `Input`, `CollisionWorld` og `InteractionSystem`.

Lyset er enkelt: himmel, sol fra sør og én lampe per rom. Stua i spillet (`shell.js`, `kitchen.js`, `LightManager`,
designet) brukes ikke, siden et kundehus ikke har den.

## Målinger mot eierens hus

Fasiten er huset som ble bygd for hånd i natt (`research/house/10-hoved-rom.json`, `30-kjeller.json` og stua i
`research/room-spec.json`, flettet i `src/data/room-spec.json`). Brukerens valg er det siden ber om: skala fra den lengste
målelinja, og nord til venstre.

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

Skala fra målelinja «12,21 m» (628 px): 51,43 px/m. Gjenkjenningen tok 500 ms og fant 11 vegger, 3 dører, 7 vinduer og 1 åpninger.

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

Rettingene (6 handlinger i editoren): rommet «Bad» (bathroom); rommet «Gang» (hall); rommet «Soverom» (bedroom); rommet «Stue/kjøkken» (living); åpningen gang/stue → dør; yttervegg minst 0,30 m.

### Kjeller

Skala fra målelinja «10,50 m» (633 px): 60,29 px/m. Gjenkjenningen tok 391 ms og fant 17 vegger, 6 dører, 6 vinduer og 1 åpninger.

**Vegger mot dataene slik de er bygd**

| | Automatisk | Etter retting |
|---|---|---|
| Veggflater funnet (innen 15 cm, av lengden) | 89 % | 89 % |
| Snittavvik, rå | 13,2 cm | 13,2 cm |
| Median / p90 / maks, rå | 13,5 / 14,0 / 14,5 cm | 13,5 / 14,0 / 14,5 cm |
| Beste parallellforskyvning (x, z) | 13,6, 13,1 cm | 13,6, 13,1 cm |
| Snittavvik etter forskyvning | 0,5 cm | 0,5 cm |
| Median / p90 / maks etter forskyvning | 0,3 / 0,8 / 6,4 cm | 0,3 / 0,8 / 6,4 cm |
| Veggflater funnet etter forskyvning | 89 % | 89 % |
| Ekstra veggflate (ikke i fasiten) | 11,42 m av 104,5 m | 11,42 m av 104,5 m |

**Dører, vinduer og åpninger** (mot dataene, etter forskyvning; funnet = senteret innen 60 cm på en parallell vegg)

| | Fasit | Automatisk | Etter retting |
|---|---|---|---|
| Dører | 7 | 6 funnet, 6 riktig type, 6 slår riktig vei (6 foreslått) | 7 funnet, 7 riktig type, 7 slår riktig vei (7 foreslått) |
| Vinduer | 6 | 6 funnet, 6 riktig type (6 foreslått) | 6 funnet, 6 riktig type (6 foreslått) |
| Åpninger uten dør | 1 | 1 funnet, 1 riktig type (1 foreslått) | 1 funnet, 1 riktig type (1 foreslått) |
| Senteravvik, snitt | | 8,2 cm | 8,4 cm |
| Breddeavvik, snitt | | 7,5 cm | 6,9 cm |
| Ikke funnet | | `door-bod-2` | – |
| Ekstra | | 0 | 0 |

**Rommene** (mot dataene, etter forskyvning)

| Rom (fasit) | Areal fasit | Automatisk: areal (IoU) | Etter retting: areal (IoU) |
|---|---|---|---|
| Gang | 13,08 m² | 12,21 m² (93 %), navn ✓, type ✓ | 12,21 m² (93 %), navn ✓, type ✓ |
| Vaskerom | 10,26 m² | 10,67 m² (95 %), «Soverom 1», type bedroom | 10,67 m² (95 %), navn ✓, type ✓ |
| Soverom | 7,44 m² | 7,40 m² (99 %), «Soverom 2», type ✓ | 7,40 m² (99 %), navn ✓, type ✓ |
| Kjellerstue | 20,60 m² | 20,59 m² (100 %), «Stue», type ✓ | 20,59 m² (100 %), navn ✓, type ✓ |
| Entré | 6,87 m² | 6,49 m² (94 %), navn ✓, type ✓ | 6,49 m² (94 %), navn ✓, type ✓ |
| Bod | 3,47 m² | 3,83 m² (88 %), «Bod 1», type ✓ | 3,83 m² (88 %), navn ✓, type ✓ |
| Bod (grå) | 9,91 m² | 9,89 m² (100 %), «Bod 2», type ✓ | 9,89 m² (100 %), navn ✓, type ✓ |
| Bod under terrassen | 10,54 m² | 10,67 m² (98 %), «Bod 3», type ✓ | 10,67 m² (98 %), navn ✓, type ✓ |

Validatoren (`validateHouse`): Automatisk: 0 feil, 0 advarsler; Etter retting: 0 feil, 0 advarsler.

Rettingene (12 handlinger i editoren): rommet «Bod» (storage); rommet «Bod (grå)» (storage); rommet «Bod under terrassen» (storage); rommet «Gang» (hall); rommet «Entré» (entrance); rommet «Vaskerom» (laundry); rommet «Soverom» (bedroom); rommet «Kjellerstue» (living); ny dør gang/bod (grå); bredde 0,95; døra til boden: snu hengselen; døra til boden: snu slagretningen.

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

## Begrensninger: hva som fungerer, og hva som må rettes

**Fungerer godt:**

- digitale planer fra tegneprogrammer og meglere i stilen til testplanene: Floorplanner, Planner 5D, magicplan, RoomSketcher og
  lignende eksporter med svarte eller nesten svarte vegger;
- fargede rom (kjelleren har beige gulv) og grå møbler;
- målelinjer, tekst og skravur i trappa;
- oppløsning fra ca. 35 px/m (oppskalert) og opp, også med pikselstøy (testet til ±10 grånivåer);
- dører med kvartsirkel (heltrukket eller stiplet);
- vinduer som linjer i veggen;
- ytterdør med sidefelt og glassvegger med søyler.

**Må rettes for hånd:**

- **Romnavn.** Det finnes ingen OCR. Typen gjettes (11 av 12 riktig), men navnet bør kunden skrive.
- **Dører uten bue.** Skyvedører, dører tegnet som et hull med to linjer (som gangdøra) og dobbeltdører med to små buer
  blir åpning eller vindu. Kunden bytter type med ett valg.
- **Ting som ikke står i planen.** Det gjelder dører som ikke er tegnet, takhøyder og brystningshøyder. Vinduene får
  standardhøyden (brystning 0,9 og høyde 1,2) til de rettes.
- **Trapper** gjenkjennes ikke. Kunden legger inn etasjer med egne plantegninger, gulvhøyde og forskyvning. Planbyggeren
  har ingen trapp i v1, og den må tegnes i data (`stairs`-formatet finnes).
- **Skrå tak, nivåforskjeller i et rom (entré-trinnene) og buede vegger** støttes ikke. Takene er flate med én høyde per
  rom.

**Fungerer ikke ennå:**

- **Skannede eller fotograferte planer.** Skjevhet, perspektiv, ujevnt lys og JPEG-støy rundt tynne linjer. Det ville
  krevd retting av perspektivet (fire hjørner) og en adaptiv terskel.
- **Arkitekttegninger med vegger som to tynne konturlinjer**, med eller uten skravur. Det ville krevd morfologisk
  lukking mellom parallelle linjer.
- **Grå vegger** som er lysere enn den mørkeste teksten. Terskelen velger det svarte. En «klikk på en vegg»-prøve av
  veggfargen er et naturlig neste steg.
- **Skrå vegger.** Gjenkjenningen finner bare vegger langs aksene. Editoren og eksporten støtter skrå vegger, så de kan
  tegnes inn.
- **Svarte møbler inntil vegger** kan bli vegg (de fjernes bare når de står fritt).
- **Planer med flere etasjer på ett ark** må beskjæres først.

## Hvor langt er det til noe som kan selges?

Ærlig vurdering.

**Teknisk kjerne for rene digitale planer: nær ferdig.**

- 1–2 cm nøyaktighet mot planen og alle tegnede dører og vinduer på de to testplanene og tre syntetiske hus.
- 0 feil i spillets validator.
- Et halvt sekund i nettleseren.
- 6–12 rettinger per etasje, og de fleste er romnavn.

**Det som gjenstår, grovt anslått for én utvikler:**

1. **Spillet må ta imot et kundehus** (2–4 uker). Dette er den største biten. I dag viser planbyggeren huset med sin
   egen enkle 3D-visning. Spillets `createHome` (`src/home/index.js`) bygger alltid eierens stue: `shell.js`,
   `kitchen.js`, `exterior.js`, en `LightManager` kalibrert mot stua og et design med stuas møbler. For at en kunde skal
   kunne møblere med katalogen, male og bruke lys, må spillet ha en modus for et generisk hus: ingen stue, lys per rom
   fra data, designet uten de opprinnelige møblene og en uteplass uten eierens terreng. Forespørslene under er
   begynnelsen.
2. **Kontoer og lagring** (1–2 uker): én innlogging per kunde (`server.mjs` har bare ett felles passord), lagring av
   prosjekt og husfil på serveren, og sletting (en plantegning er personopplysninger etter GDPR).
3. **Flere plantyper** (2–4 uker). Det trengs et testsett på 30–50 ekte kundeplaner. Dette må fungere:
   - rette opp skannede planer;
   - prøve veggfargen;
   - vegger tegnet som konturlinjer;
   - skrå vegger i gjenkjenningen;
   - dobbeltdører og skyvedører.

   Uten testsettet er tallene over bare gyldige for to planer fra samme tegneverktøy.
4. **Trapp og etasjer i editoren** (1 uke): et trappeverktøy (rektangel og retning) og automatisk justering av
   etasjene mot hverandre.
5. **Finpuss** (1–2 uker): mobil og nettbrett (editoren er for mus i dag), hjelp i selve verktøyet, bedre feilmeldinger
   og ytelse på store skann (en plan på 9 megapiksler bør testes).

Samlet blir det 7–13 uker til en første betalbar versjon for rene digitale planer. Med skannede håndtegninger tar det
klart lengre tid.

Det som taler for planbyggeren er at den er billig å drifte: ingen server-CPU, ingen KI-kostnad og ingen opplasting.
Rettingen tar et par minutter per etasje på planer som testplanene.

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

## Filene

| Fil | Innhold |
|---|---|
| `planbygger.html` | siden (egen inngang i `vite.config.js`) |
| `src/planbygger/app.js` | sideflyten, sidepanelet, lagring, filer, PDF |
| `src/planbygger/detect.js` | gjenkjenningen |
| `src/planbygger/image.js` | rasteroperasjoner (terskel, morfologi, løpelengder, komponenter, avstandskart) |
| `src/planbygger/scale.js` | skalaforslag og festing til målelinjer |
| `src/planbygger/model.js` | plandokumentet og redigeringsoperasjonene |
| `src/planbygger/regions.js` | rom fra vegger |
| `src/planbygger/export.js` | husformatet, registeret og rammen |
| `src/planbygger/editor.js` | 2D-editoren |
| `src/planbygger/viewer.js` | 3D med spillets byggere |
| `src/planbygger/worker.js` | gjenkjenningen i en Web Worker |
| `src/planbygger/shims/` | nettleserutgaver av `node:fs`, `path` og `url`, bare for `house.mjs` |
| `tools/test-planbygger.mjs` | testene (`node tools/test-planbygger.mjs`) |
| `tools/planbygger-measure.mjs` | målingene over (`--write` oppdaterer denne fila) |
| `tools/planbygger-truth.mjs` | sammenligningen med fasiten |
| `tools/planbygger-corrections.mjs` | rettingene som editorhandlinger |
| `tools/planbygger-synth.mjs` | syntetiske planer med fasit |
| `tools/planbygger-debug.mjs` | tegner gjenkjenningen over en plan |
| `tools/planbygger-png.mjs` | PNG-lesing og -skriving for Node |
| `tools/planbygger-lib.mjs` | felles testkode |
| `tools/planbygger-vite.config.mjs` | testserveren (port 5270–5279) |
| `tools/planbygger-vite-plugin.mjs` | erstatningene for `house.mjs` i nettleseren |
