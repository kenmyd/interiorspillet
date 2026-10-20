# Kjellerstue – fra bildene (2026-10-20)

Kilde: 10 bilder i `bilder_hus/_1600/Kjellerstue/` + `bilder_hus/_1600/plantegning_kjeller.png`.
Bildene er tatt om kvelden i varmt downlight-lys med persiennene nede. Farger er hvitbalansert mot de hvite
skumvingene på modellflyene (225655), som under samme lys gir R/B ≈ 1,11 og G/B ≈ 1,07. Korreksjonen er da
R × 0,90, G × 0,935, B × 1.

Rommet brukes i dag som trenings- og kontorrom: hjørnepult, tredemølle, spinningsykkel og TV på veggen.

**Lokale koordinater i denne fila:** origo i rommets **nordøstre innerhjørne** (planens øvre venstre hjørne av
KJELLERSTUE). `x` = meter fra nordveggen mot sør (spillets +x), `z` = meter fra østveggen mot vest (spillets +z),
`h` = høyde over gulv. På `plantegning_kjeller.png` (ca. 60 px/m) ligger innerflatene ved px x 302→508 og
y 430→795.

## Rommet

- **Planmål:** 3,40 m (nord–sør, `x`) × 6,05 m (øst–vest, `z`) = 20,57 m². Rommet er rektangulært uten nisjer.
  Mål i planen: 205 × 365 px ved ca. 60 px/m, altså 3,42 × 6,08 m.
- **Takhøyde:** ca. **2,22 m**, flatt tak (anslått, sannsynlig 2,20–2,25). **Felles modellverdi for hele kjelleren:
  2,25** (krysskontrollen, `oversikt.md`). Gulvet ligger på verdens-y −2,55. TV-veggen er nesten rett forfra i 225644, og
  der er høyde/bredde ≈ 0,65 × 3,40 m ≈ 2,21 m. Kontrollmålt mellom hjørnene: 228 px høy mot 345 px bred, altså 2,25 m.
  Dørkarmene (ca. 2,10 m) går nesten helt opp til taklista, og det stemmer med ca. 2,2 m. Ingen bjelker eller
  nedforinger synes.
- **Gulv:** lys **hvitpigmentert eik** i bord, hvitbalansert ca. **#d4c9bb**, med årer/skjøter litt mørkere
  (**#bdb0a0**). Bordene er ca. 0,20 m brede og ca. 2,0–2,2 m lange (anslått) og ligger **øst–vest** (langs rommet,
  langs `z`), med forskjøvne endeskjøter. Direkte belyste gulvflater gir etter hvitbalanse en litt kaldere, grårosa
  tone, ca. **#d4c8c0**. Bruk derfor **#d4c9bb–#d4c8c0**. Gulvet ser ut som samme type som i stua oppe (hvitpigmentert
  eik, bord på 0,20–0,22 m, samme retning). Stueverdien #a59b8f er målt fra andre, undereksponerte bilder, så det er
  ikke sikkert at gulvene er ulike. Det er eierens valg om begge etasjene skal få samme gulvfarge. Mot GANG og soverom
  er det en smal mørk terskel.
- **Tak:** lyst og matt, trolig hvitt eller brukket hvitt, ca. **#e8e4dc** (anslått). Taket får bare indirekte lys og
  ser derfor mørkere og varmere ut på bildene. Det kan også være malt SAND.
- **Taklist:** smal **sort** list rundt hele rommet, ca. 4 cm høy med enkel rett profil, ca. **#1d1e21** (sett tydelig i
  225651, 225702, 225704).
- **Gulvlist:** lys eik/beige, litt varmere og mørkere enn gulvet, **ikke hvit** som oppe. Ca. **#cbbba7**, ca. 6–7 cm
  høy, rett firkantet profil med lys fas øverst (225657).
- **Veggfarge:** lys greige.
  - Halvbelyste veggflater gir etter hvitbalanse R/B ≈ 1,15 og G/B ≈ 1,07, og det treffer **SAND (#cfc5b4)**.
  - Flater som får downlight-lyset direkte (lyskjeglene i 225702, 225704 og 225657, med flyvingene som hvitreferanse)
    gir derimot R/B ≈ 1,05–1,11 og G/B ≈ 1,00–1,05. Det er en litt kaldere, grårosa greige, ca. **#cec4bf**.
  - Skyggesidene ser varmere ut fordi lyset der har blitt reflektert av de varme flatene i rommet.
  - SAND er den nærmeste fargen i paletten. Bruk `paint: "sand"` på alle fire veggene til eieren har bekreftet fargen.
  - GANG-veggene (sett gjennom døra i 225704) er tydelig gulere/kremere enn veggene her, så GANG har trolig en annen
    farge.
- **Varme:** ingen radiator eller panelovn synes. Det er sannsynligvis varmekabler i gulvet, men ingen termostat synes
  i stua (det er en termostat inne på soverommet).

## Vegger

### Østveggen (plan topp, `z = 0`) – mot GANG

Innvendig vegg, SAND. I planen grenser den mot GANG de første ca. 2,7 m fra nordhjørnet og deretter mot en mur og
hjørnet av rommet med ytterdør. Det er ingen åpning mot det rommet.

- **Dør til GANG:** helt i nordenden.
  - **Hull** (karmens ytterkant) ca. **x 0,16–1,05** (ca. 0,89 m, en vanlig 9M-dør). Høyde ca. **2,10 m** (anslått).
    Målt i planen ligger karmsymbolet ved 0,16–1,05 m ytterst og 0,23–0,99 m innerst. Planen og bildene er derfor
    enige. Hullet er **smalere** enn `door-gang` oppe (1,07 m).
  - **Hengsler** på nordre karm (mot nordhjørnet). Døra **slår inn i kjellerstua**, og helt åpen står dørbladet nesten
    parallelt med nordveggen, ca. 0,1–0,2 m fra den (225644, 225704; planen tegner det likt).
  - **Dørblad** sort **#1d1e21**, glatt med ett innfelt felt (samme bladstil som `door-gang`). Ca. 0,82 × 2,03 m
    (anslått). Karmen er sort, ca. 7 cm. Sluttstykket sitter på søndre karm (225647).
  - **Vrider:** sort L-vrider på smal, avlang rosett, med et eget avlangt sort nøkkelskilt rett under. Den sitter ca.
    h 1,05 m, på sørsida av bladet (motsatt hengslene), og kanten av bladet har en sølv låskiste. Se 225644 og 225704.
    Oppe har `door-gang` bare runde rosetter og ingen vrider, så her er beslaget ulikt. Smal mørk terskel.
  - Gjennom døra ses GANG med lysere krem vegger og samme lyse gulv.
- **Bryter:** sort, ca. 8 × 8 cm, 5–10 cm sør for dørkarmen (ca. x 1,12, h ≈ 1,05). Den ses i 225647 og 225704.
- **Stikkontakt:** sort dobbel, liggende, ca. 15 × 8 cm, rett sør for dørkarmen nede ved gulvlista (ca. x 1,15,
  h ≈ 0,18). Den ses i 225647 og 225704.
- Resten av veggen (x 1,2–3,40) er glatt og har to lyskjegler fra downlights (225647, 225651). Pulten står i
  sørenden.

### Sørveggen (plan høyre, `x = 3,40`) – yttervegg mot elva, to vinduer

Yttervegg (kjellermur), SAND. Veggen er tykk, med dype lysninger.

- **Vindu V1:** hull ca. **z 2,09–3,44** (bredde ca. 1,35).
- **Vindu V2:** hull ca. **z 4,18–5,53** (bredde ca. 1,35).
- Planen viser 1,29 m brede vinduer ved z 2,12–3,41 og 4,21–5,51 og en pilar på 0,81 m. På bildene (225655, 225651)
  ser vinduene litt bredere ut, og den nakne veggen mellom de mørke listene er bare ca. 0,6–0,7 m. Grunnen er at den
  mørke lista legger ca. 3–5 cm til på hver side. Midtlinjene fra planen (z 2,77 og 4,86) er beholdt (anslått).
- **Høyde:** underkant ca. **0,85 m**, overkant ca. **2,15 m**, altså noen cm under taklista (hull ca. 1,30 m høyt,
  anslått). Vinduene er nesten kvadratiske, litt bredere enn høye.
- **Utforming:**
  - Dyp lysning, ca. 0,22 m, **malt sort/antrasitt** på alle fire sider, også bunnen. Rundt hullet går en smal
    sort ytterlist på 3–4 cm. Bruk **#25272b** (som vindusrammene oppe).
  - Vindusramma står innerst ved glasset, mørk antrasitt.
  - Trolig samme topphengslede type som soveromsvinduet (225721 i `Soverom kjeller`), med håndtak midt på bunnramma.
    Her er håndtaket skjult bak persiennen.
  - Ingen hvit vinduskarm eller hvit lysning (oppe er de hvite).
- **Plissé-gardiner** i begge vinduene, helt nede, festet innerst ved glasset. Varm taupe/greige, ca. **#a39588**
  (anslått). Lamellene er ca. 2–3 cm.
- **Utsikt:** ukjent (kveld og gardinene nede). Ifølge planen ligger elva i sør.
- **Stikkontakter** (sorte, doble, liggende, h ≈ 0,20):
  - (a) ca. z 2,2, helt i østkanten under V1 og rett vest for skuffeseksjonen (225655). Målt langs V1s østre kant
    forlenget ned til gulvet: kontakten sitter ca. 0,1 m inn under vinduet.
  - (b) ca. z 3,75, under pilaren mellom V1 og V2, bak tredemølla (225651, 225647, 225648, 225700).

### Vestveggen (plan bunn, `z = 6,05`) – TV-veggen, yttervegg

Yttervegg, SAND, uten vinduer (planen og bildene er enige).

- **TV**, veggmontert og sort:
  - Ca. **1,70 × 0,98 m** (75–77″, anslått), ca. 6 cm dyp på flat brakett.
  - Underkant ca. h 1,07, overkant ca. h 2,07.
  - Den står **litt mot sør**: x ≈ 1,07–2,78, altså midt på x ≈ 1,92, ca. 0,2 m sør for veggens midtlinje. Målt i
    225644, der veggen er rett forfra.
  - I dag henger strømledningen løst ned til gulvet, og den skal ikke med.
- **Stikkontakter** (sorte, nede ved lista, h ≈ 0,20):
  - en dobbel ca. 0,2 m fra nordhjørnet (x ≈ 0,2), synlig i 225657 og 225644;
  - en dobbel (ev. to enkle side om side) ca. 0,25 m fra sørhjørnet (x ≈ 3,15), bak modellflyene i 225657 og 225655.
- To lyskjegler fra downlights flankerer TV-en (225657, 225700).

### Nordveggen (plan venstre, `x = 0`) – mot vaskerom og soverom

Innvendig vegg, SAND. Ifølge planen ligger vaskerommet bak de første ca. 3,15 m fra østhjørnet og soverommet bak
resten. Det er **ingen dør til vaskerommet** fra stua (bekreftet: veggen er glatt i 225702 og 225704).

- **Dør til SOVEROM:** nær vestenden.
  - **Hull** ca. **z 4,68–5,56** (0,88 m inkl. gerikt), altså ca. **0,49–1,37 m fra vesthjørnet**. Rettet i
    krysskontrollen etter `soverom-kjeller.md`, som målte karmen rett forfra i 225723. Vestkanten (ca. 0,5 fra
    hjørnet) stemmer med planen og 225702; planen tegner hullet ca. 0,98 bredt. Høyde ca. 2,12 m.
  - **Hengsler** på vestre karm. Døra **slår inn i soverommet** og står åpen inne på soverommet (225710: sett fra
    stua med hengslene på venstre karm; 225721 i `Soverom kjeller`).
  - **8M-dør**: blad ca. 0,77 × 2,04, sort #1d1e21 med ett innfelt felt, sort karm. Smalere enn GANG-døra (9M).
  - **Vrider** i børstet stål på rund rosett med rundt nøkkelskilt (sett fra soverommet i 225721/225723), ikke sort
    som på GANG-døra. Terskelen er kald grå (#5a5e63).
- **Stikkontakt:** sort dobbel ca. 0,5 m øst for soveromskarmen (z ≈ 4,05, h ≈ 0,20), synlig i 225702 og 225700.
- Resten av veggen er glatt med 3–4 lyskjegler (225702, 225704). Når GANG-døra står åpen, parkerer dørbladet langs
  østenden av denne veggen.

## Faste ting

- **Innfelte downlights**, ca. 10 stk (se Lys).
- **Takenhet:** rund, sort/mørk grå, ca. ⌀ 0,14 m og 4 cm tykk, omtrent midt i rommet (x ≈ 1,7, z ≈ 2,7–2,9,
  anslått). Farge **#2a2b2d**. Nærbildet i 225648 viser en skål med en smal ringspalte rundt, altså mest sannsynlig en
  **tallerkenventil** (avtrekk) og ikke en røykvarsler. Se også 225644.
- **Stikkontakter:** 6 stk, alle sorte doble **#1c1a19** (samme som oppe):
  - ved GANG-døra;
  - sørvegg (a) og (b);
  - vestveggen ved begge hjørner;
  - nordveggen øst for soveromsdøra.
- **Bryter:** 1 stk sort **#151515** ved GANG-døra.
- **Plissé-gardiner** i begge vinduene (se Sørveggen).
- **TV** på vestveggen. Den er ikke fast installasjon, men henger fast på veggen.
- **Taklist og gulvlist** rundt hele rommet. Sorte terskler i begge dørene.
- Ingen radiator, varmepumpe, hyller eller innebygde skap.

## Møbler (ryddig)

Plasseres slik de står i dag, men ryddet. Retningen «mot vest» betyr spillets rotationDeg 0, altså fronten mot +z.

1. **Hjørneskrivebord** i **sørøstre hjørne** (IKEA Galant-type, 225651 og 225647).
   - Plate i **bøkefinér**, ca. **#c89f72**, med buet innerkant.
   - Én vinge langs sørveggen fra hjørnet til z ≈ 1,60. Én vinge langs østveggen fra hjørnet til x ≈ 2,20, altså ca.
     1,20 m lang.
   - Dybde ca. 0,80 m i hjørnet og ca. 0,60 m i endene. Høyde 0,72 (anslått).
   - Mørk grå runde søyleben, **#3b3d40**.
2. **Skuffeseksjon** i bøk (samme **#c89f72**).
   - Ca. 0,45 B × 0,60 D × 0,65 H, med 3 skuffer, liggende stanghåndtak i metall (**#9a9a9a**) og hjul.
   - Står inntil sørveggen rett vest for pulten: z 1,62–2,07, x 2,80–3,40.
3. **Kontorstol:** Herman Miller Aeron-type i grafitt mesh, **#2a2b2d**, med svart fotkryss på hjul. Står skjøvet inn
   foran pulthjørnet, ca. x 2,45, z 0,85, og ser mot sørøst.
4. **Pulten står tom.** Skjermer, tastatur og alt annet på pulten er ting på en flate, og etter rotregelen skal de ut.
   De er flyttet til Utelatt rot som et valgfritt tillegg.
5. **Tredemølle** (ProForm Carbon TLX, sort **#1a1a1a**, grå detaljer).
   - Ca. 1,85 × 0,86 m, konsollhøyde ca. 1,45 m.
   - Står langs sørveggen med langsiden ca. 0,35 m fra veggen: x 2,19–3,05, z 3,00–4,85.
   - Konsollen er i vestenden, slik at brukeren ser mot TV-en (vest). Den ses i 225700, 225655 og 225648.
6. **Spinningsykkel** (Merida, sort/sølv med limegrønne føtter **#7ccf2a**).
   - Ca. 1,10 × 0,55 m, h ≈ 1,20.
   - Står nord for tredemølla, midt i rommet: x ≈ 1,75, z 3,40–4,50.
   - Styret er mot vest, mot TV-en (225700, 225655).
7. **To like armlenestoler**: sort buet metallramme og ryggbøyle (**#1c1c1c**), sort netting i ryggen og løs
   **skifergrå** setepute **#5a5c64**. Ca. 0,60 × 0,55 m, setehøyde 0,45.
   - Stol A: i dag i **nordvestre hjørne**, foran nordenden av TV-veggen, rett vest for soveromsdøra (225657,
     225700). Vest for døra er det bare ca. 0,49 m vegg, så en 0,6 m stol på x 0,60 ville stått delvis foran
     døråpningen (z 4,68–5,56). **Ryddig plassering:** ca. x 0,95, z 5,70, med fronten mot sørøst, så døra og en
     gangsone på ca. 0,8 m foran den er fri.
   - Stol B: står i dag med klær på seg mellom GANG-døra og pulten, og har ingen pute. Den store sorte puta på gulvet
     (225647) er mye mørkere enn puta på stol A, så den hører ikke til stolen. Ryddig plassering: inntil østveggen ca.
     x 1,75, z 0,35, med fronten mot vest og samme skifergrå pute som stol A (anslått).
8. **TV** (se Vestveggen).

Ingen tepper, bilder, speil, hyller, sofa eller lamper står i rommet.

## Lys

Det finnes bare **innfelte downlights**. Det er ingen taklampe, gulvlampe eller LED-list.

- **Armatur:** liten innfelt spot, ca. ⌀ 8 cm, med hvit/sølv ring (**#d9d9d6**) og mørk innside.
- **Lys:** varmhvitt ca. 2700–3000 K, smal stråle (ca. 35–40°).
- **Plassering:** ca. 0,35 m fra veggene. Spottene lager skarpe «scallops» (lyskjegler) på veggene fra like under
  taket ned til ca. h 1,2–1,4. Over selve vinduene er det ingen spotter.
- **Ca. 10 stk (anslått):**
  - Langs **nordveggen** (x ≈ 0,3): **3 stk**, z ≈ 2,4 / 3,2 / 4,0. Ingen over soveromsdøra. Lest ut fra
    dybdeplasseringen i 225644; 225702 viser at den vestligste lyskjegla ligger like øst for soveromskarmen.
  - **Rekke ved vestveggen** (z ≈ 5,75, ca. 0,3 m fra TV-veggen): **4 stk i to par**. Hvert par har ca. 0,20 m mellom
    spottene: x ≈ 0,55 og 0,75 (nordre par) og x ≈ 2,73 og 2,93 (søndre par).
    - Rekka er symmetrisk om veggens midtlinje (x 1,70). TV-en henger 0,2 m mot sør, så det søndre paret står helt ved
      TV-ens sørkant.
    - Parene ses tydelig i 225644, 225657 og 225700. Til sammen gir de én lyskjegle på hver side av TV-en og lys inn
      mot nord- og sørveggen ved vesthjørnene.
  - Langs **sørveggen** (x ≈ 3,05): **2 stk**, z ≈ 0,45 (pulthjørnet, lyser både sør- og østveggen) og z ≈ 1,30 (over
    pulten). Ingen over vinduene.
  - Langs **østveggen** (z ≈ 0,35): **1 stk**, x ≈ 1,8 (mellom døra og pulten).
- **Bryter:** alle spottene styres trolig av bryteren ved GANG-døra (én gruppe).
- På bildene lyser i tillegg dataskjermene, mens TV-en er av. Ingenting slipper inn utenfra (kveld, gardinene nede).

## Utelatt rot

- Vektskiver (blå/svarte), vektstang, låseklemmer og sorte «pucker» spredt på gulvet.
- Korkmatte (Casall-yogamatte) og to sorte skumrulle-/treningsmatter bak tredemølla.
- Tre RC-modellfly som står i sørvestre hjørne.
- Plastkasse med klær, klær og tøy på stol B, og sort løs pute på gulvet.
- Joggesko og et brunt treningsbånd på gulvet.
- Pappesker, papirer, plastposer, vannflaske, hodetelefoner, småelektronikk og ledninger på pulten.
- Dataskjermene og tastaturet: en buet ultrawide på ca. 1,15 m midt i pulthjørnet og en ca. 27″ (0,61 m) vest for den,
  begge sorte. De står på en flate og er derfor utelatt. Valgfritt: legg dem til hvis eieren vil ha en «ferdig»
  arbeidsplass.
- HP-skriver og papirbunke på skuffeseksjonen, og grå papirkurv/bøtte under pulten.
- Hvite skjøteledninger på gulvet (ved døra og ved pulten).
- Løs TV-ledning som henger ned under TV-en, og en løs kabel ved sørvesthjørnet.
- Liten oransje eske ved sykkelen.
- Det som ses inne på soverommet (hyller, esker, Powerline-kartonger) hører ikke til stua.

## Usikkert / anslått

- **Takhøyde** 2,22 m: beregnet fra bildene, ikke målt. Kan være 2,20–2,25.
- **Vindusmål og -plassering:**
  - Hull ca. 1,35 × 1,30 m med underkant 0,85 og overkant 2,15 (anslått).
  - Planen sier 1,29 m bredde og 0,81 m pilar. Bildene antyder bredere mørk innramming og smalere naken pilar
    (ca. 0,6–0,7 m).
  - Lysningsdybden er anslått til ca. 0,22 m.
- **GANG-døra:** x 0,16–1,05 er tatt fra planen (karmsymbolets ytterkant). Dørbladet på ca. 0,82 m og høyden på 2,10
  er anslått. Bildene står for skrått til at bredden kan måles nøyaktig, men de stemmer med en 9M-dør.
- **Soveromsdøra:** z 4,68–5,56 (0,88) er målt fra soverommet i 225723. Planen tegner 0,98.
- **Farger:**
  - Veggene er trolig SAND, men det er ikke bekreftet av eieren. Etter hvitbalanse er de direkte belyste flatene litt
    kaldere (#cec4bf) enn SAND, så veggfargen kan være en lysere/kaldere greige. Skyggesider ser for varme ut på grunn
    av lyset som er reflektert fra veggene og gulvet.
  - Vinduslysninger og dørblad er nesten sorte på bildene (#120e0b etter korreksjon, i skygge). #25272b og #1d1e21 er
    valgt for å passe med 1. etasje.
  - Taket er antatt hvitt eller brukket hvitt.
  - Gulvlista er antatt lys eik/beige (den er i hvert fall ikke hvit).
  - Gardinfargen er usikker, fordi gardinene står i skygge i lysningen.
- **Downlights:** antall (ca. 10) og posisjoner er lest ut fra lyskjeglene. Avstanden mellom spottene kan være feil
  med ±0,3 m.
- **Takenheten** midt i rommet er trolig en tallerkenventil, men det kan også være en sort røykvarsler. Posisjonen er
  anslått.
- **Rund, grå og uskarp ting** øverst på nordre karm i 225644, helt inntil kameraet. Det kan være en dørholder, en
  dempeknapp eller en flekk på linsen. Den er utelatt.
- **Planens sørvegg** har en dobbel strek i østenden (z 0–0,55, px y 432–465 ved x 514–520). På 225651 og 225647 er
  SØ-hjørnet glatt, så dette er trolig en tegnefeil. Modeller veggen rett.
- **TV-størrelsen** (ca. 1,70 × 0,98) og høyden er anslått fra 225644.
- **Møbelmål** (pult 1,60 × 1,20, skuffeseksjon, tredemølle, sykkel og stoler) er anslått. Plasseringen er slik den er
  i dag.
- **Gulvvarme** er antatt (ingen radiator synes).
- **Planen og bildene er uenige** bare om vinduspilaren (se over). Ellers er de enige: GANG-døra ligger helt i
  nordenden av østveggen og er ca. 0,89 m bred. Det er ingen dør til vaskerommet og ingen vinduer i vestveggen, og
  soveromsdøra står nær vesthjørnet.

## Bilder

| Fil | Viser |
|---|---|
| `20261020_225644.jpg` | Fra GANG-døra i østveggen, mot vest langs hele rommet. Sørveggen med V1 og V2 til venstre, TV-veggen i enden og nordveggen til høyre med det åpne GANG-dørbladet. Soveromskarmen helt innerst til høyre. Takenheten, tre downlights langs nordveggen og de to spot-parene ved vestveggen. Vrider og nøkkelskilt på GANG-dørbladet. Gulvbordene går mot vest. Best for TV-mål, takhøyde og spotrekka ved vestveggen. |
| `20261020_225647.jpg` | Fra GANG-døra, mot sør inn i SØ-hjørnet: pulten, kontorstolen, stol B og V1. Bryter og stikk ved sørre dørkarm, lyskjegler på østveggen. GANG-gulvet nederst til venstre. |
| `20261020_225648.jpg` | Fra østenden, mot SV: pult, V1, V2, tredemølle, sykkel, TV-veggen og stol A. Takenheten midt i taket, sett nært nok til å se ringspalten (tallerkenventil). |
| `20261020_225651.jpg` | SØ-hjørnet nærmere: hjørnepult i bøk med buet kant, skjermer, Aeron-stol, skuffeseksjon med skriver, V1 og stikk (b) under pilaren. |
| `20261020_225655.jpg` | Sørveggen nesten rett forfra: begge vinduene med plissé og mørke lysninger, tredemølla, sykkelen, modellfly i SV-hjørnet og stikk (a) ved skuffeseksjonen. Hvitbalanse-referanse (hvite flyvinger). |
| `20261020_225657.jpg` | Vestveggen (TV-veggen) forfra: TV, stikk ved begge hjørner, stol A og soveromsdøra til høyre. Gulvlistprofilen ses tydelig. |
| `20261020_225700.jpg` | Fra midten mot vest: tredemølle, sykkel, korkmatte, stol A, TV, soveromsdøra åpen og stikk på nordveggen. |
| `20261020_225702.jpg` | Nordveggen mot NV: soveromsdøra (åpen innover), stikk øst for døra og 3 lyskjegler. Vesthjørnet til venstre. Brukt til dørposisjonen. |
| `20261020_225704.jpg` | Nordveggen mot øst: GANG-døra åpen inn i stua (bladet parallelt med nordveggen), bryter og stikk sør for karmen, og glimt inn i GANG. Taklista i nærbilde. |
| `20261020_225710.jpg` | Gjennom soveromsdøra (blikk mot nord) inn i soverommet: dørbladet slått inn med hengsler på venstre (vestre) karm. Innholdet er soverommets rot. |

## Kontrollert

En uavhengig kontroll 2026-10-20 gikk gjennom alle 10 bildene, `plantegning_kjeller.png` (forstørret) og
`plantegning.png`.

**Bekreftet uten endring:**
- Retningene stemmer: vinduene er i sørveggen (planens høyre side), TV-en er på vestveggen, GANG-døra er i østveggen
  helt mot nord, og soveromsdøra er i nordveggen nær vest.
- Hengsler og slagretning stemmer for begge dørene.
- Det er ingen dør til vaskerommet og ingen vinduer i vestveggen.
- TV-målene stemmer: x 1,04–2,74 i ny måling.
- Planen er 3,40 × 6,05 m.
- Vinduene ligger ved z 2,15–3,41 og 4,17–5,47 i ny planmåling.
- Bildene viser en pilar på ca. 0,63 m mellom de sorte listene. Det stemmer med pilaren på 0,76 m mellom hullene i
  planen hvis lista er ca. 6 cm per side. Førsteagentens tolkning holder.
- Rotlista er komplett.

**Endret:**
1. **GANG-dørens bredde:** Fila sa at planen viste en åpning på 0,81 m, og at bildene viste et hull på ca. 0,95 m. I den
   forstørrede planen ligger karmsymbolet ved 0,16–1,05 m ytterst (0,89 m). Det er en vanlig 9M-dør, og bildene er
   ikke i strid med det. Hullet er satt til x 0,16–1,05, bladet til ca. 0,82 × 2,03 og høyden til 2,10. Bryter og
   stikk er flyttet tilsvarende (x 1,12 / 1,15). Påstanden om uenighet mellom plan og bilder er fjernet.
2. **Dørbeslag:** Fila sa «sort vrider på rund rosett». Nærbilder (225644, 225704) viser en sort L-vrider på smal,
   avlang rosett, et eget nøkkelskilt under og en sølv låskiste i kanten av bladet. Det er også notert at beslaget er
   ulikt det på `door-gang` oppe, som bare har rosetter.
3. **Stikkontakt (a) på sørveggen:** flyttet fra z 2,45 til ca. z 2,2. I 225655 heller vinduskantene kraftig fordi
   kameraet er vippet. Når V1s østkant forlenges ned til gulvet, ligger kontakten ca. 0,1 m inn under vinduet, rett
   vest for skuffeseksjonen.
4. **Downlights ved vestveggen:** Fila hadde én spot ved NV-hjørnet (0,35; 5,6), én ved SV (3,05; 5,75) og to midt
   på vestveggen. I 225644, 225657 og 225700 ses det i stedet **én rekke med 4 spotter** ca. 0,3 m fra TV-veggen, i to
   par med 0,20 m mellom: x ≈ 0,55 / 0,75 og 2,73 / 2,93. Rekka er symmetrisk om veggens midtlinje. Nordveggens tre
   spotter er justert til z ≈ 2,4 / 3,2 / 4,0. Totalt er det fortsatt ca. 10.
5. **Skjermer og tastatur:** De var tatt med som møbler, men de er ting på en flate, og etter rotregelen skal de ut.
   De er flyttet til Utelatt rot som et valgfritt tillegg, og pulten står tom.
6. **Veggfargen var ikke hvitbalansert mot riktig lys:** Kontrollen med R/B 1,15 ble gjort på halvbelyste flater, og
   der er lyset varmet opp av refleksjoner fra rommet. Direkte belyste lyskjegler mot de hvite flyvingene gir en litt
   kaldere greige, ca. #cec4bf. SAND er beholdt som nærmeste palettfarge, men usikkerheten står nå i fila. Det er også
   notert at GANG-veggene er tydelig gulere.
7. **Gulvet:** Fila sa at gulvet var «tydelig lysere enn stua oppe». Det er myket opp, fordi gulvet ser ut som samme
   type og stueverdien kommer fra andre bilder. Fargeområdet er nå #d4c9bb–#d4c8c0.
8. **Takenheten:** Nærbildet i 225648 viser en skål med ringspalte, så den er nå beskrevet som en tallerkenventil.
   Røykvarsler står igjen som alternativ.
9. **Stol B og stol A:** Den sorte puta på gulvet er en løs pute og hører ikke til stol B (den er mye mørkere enn
   puta på stol A). Stol A er flyttet til z 5,6 slik at soveromsdøra er fri.
10. **Nye notater under Usikkert:** den doble streken i planens sørvegg ved SØ-hjørnet (trolig tegnefeil, hjørnet er
    glatt på bildene) og den runde, uskarpe tingen på nordre karm i 225644 (utelatt). Takhøyden er kontrollmålt til
    2,25 m, og 2,22 m er beholdt (2,20–2,25).

### Krysskontroll mellom rommene (2026-10-21)

Sjekket mot `entre-gang-kjeller.md`, `soverom-kjeller.md`, `vaskerom.md` og `trapp.md`.

- **GANG-døra stemmer fra begge sider:** x 0,16–1,05 her (hengsler i nord, slår inn i stua) = gangens x 3,08–3,95 i
  `entre-gang-kjeller.md`. Stuas nordvegg ligger på gangens x ≈ 2,92, i flukt med knekken (2,91).
- **Rettet: soveromsdøra.** Her sto z 4,55–5,55 (1,0 m, fra planen). `soverom-kjeller.md` målte den rett forfra til
  0,88 m, 0,49–1,37 m fra vesthjørnet. Begge notatene er nå like: **z 4,68–5,56**, 8M-blad ca. 0,77, hengsler i vest,
  slår inn i soverommet. Vrideren er børstet stål (sett fra soverommet), ikke «antatt som GANG-døra».
- **Rettet: stol A** er flyttet til ca. x 0,95, z 5,70, fordi den på x 0,60 ville stått foran den smale døråpningen.
- **Ingen dør til vaskerommet** stemmer med `vaskerom.md` (sørveggen der har skapraden).
- **Takhøyden:** felles kjellerverdi 2,25 (2,22 her ligger i spennet). Gulvet ligger på verdens-y −2,55.
- **Merk:** GANG-veggene ser gulere ut enn veggene her (225704). `entre-gang-kjeller.md` måler GANG som SAND. Det kan
  være ulik maling eller ulikt lys, og det står åpent for eieren.
