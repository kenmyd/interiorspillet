# Hovedinngang og ute ved ytterdøra – fra bildene (2026-10-20)

Kilder:
- 17 bilder i `bilder_hus/_1600/Entre og gang kjeller/`. 225543, 225553 og 225619 viser utsiden. 225621 (gjennom
  vestre sidefelt: pilaren, benken og hellene) og 225617 (gjennom østre sidefelt: potta) viser litt.
- `bilder_hus/_1600/plantegning_kjeller.png` og `plantegning.png`.
- Utsiktsbildene i `bilder_stue/`: 082838–082855, 082901 og 082916.
- `outside` i `src/data/room-spec.json`, og `TERRACE_FIT` i `src/home/exterior.js` (se `notes/fix-shell.md`).

**Hvitbalanse.** Kveldsbildene ute er lyst opp av tre varme downlights. Betonghellene antas nøytrale. De gir
R/B ≈ 1,27 og G/B ≈ 1,16, så korreksjonen er R × 0,79, G × 0,86, B × 1. Morgenbildene fra stua er tatt i skygge og
har blåstikk. Der gir betongen R/B ≈ 0,83, så korreksjonen er R × 1,21, G × 1,11.

**Konklusjon.** Hovedinngangen er ytterdøra i kjelleren. Den sitter i **sørveggen (plan høyre)** i «rommet med
ytterdør» (2,51 × 2,93). Døra ligger i en grunn, overdekt nisje **under terrassen**, mot elva. Huset har ingen annen
ytterdør enn terrassedøra i stua. Gangen i 1. etasje har bare trapp, baddør og soveromsdør (`gang 1etg`, 225331–225344).
Den grå figuren utenfor nordveggen på planen for 1. etasje er en løs trappefigur, ikke en dør.

**Koordinater** (som room-spec):
- `x` går mot sør (plan høyre), `z` mot vest (plan ned) og `y` er høyde. 1. etasjes gulv er y = 0.
- Origo er 1. etasjes indre nordøstre hjørne.
- Kjellerplanen har ca. 60 px/m. Den er lagt slik at nord- og østre ytterflate flukter med 1. etasjes ytterflater i
  planen (−0,15): x = (px − 110)/60 − 0,15 og z = (py − 103)/60 − 0,15.
- Modellen har 0,30 m tykke yttervegger. Skal kjelleren flukte med modellens ytterflate (−0,30), trekker du 0,15 fra
  begge.

## Rommet (inngangsnisjen ute)

- **Form.** Dørveggen er entréens sørvegg. Ytterflaten ligger i **x ≈ 8,90**. Kledningen går fra østre sidevegg
  (z 3,17) til minst z ≈ 6,7 (bak pilaren), altså **ca. 3,6 m bred**.
  - **Dybde:** østre sidevegg ses ut til ca. x 10,0–10,1 i 225543, og pilaren står ca. i x 10,0–10,35. Nisjen er
    altså ca. **1,1–1,45 m** dyp (anslått). Planen sier 1,45 (bodrommet går ut til x 10,35). TERRACE_FIT har
    terrassekanten i x 9,80, altså bare 0,9 m.
  - Nisjen er åpen mot sør mellom østre sidevegg og pilaren (z 3,17–5,65), og mot sørvest forbi pilaren.
  - Pilaren står **ikke** i hjørnet ved terrassens vestside. Den står rett sør for benken, ca. z 5,65–6,0 (se
    Vestsiden).
- **Entréen i planen:** innvendig x 6,18–8,73 og z 3,12–5,85, altså 2,55 × 2,73. Eieren oppgir 2,51 × 2,93; de 2,93
  er målt med vegger.
- **Himling (soffit):** ca. **2,35 m over terskelen** (anslått, 2,2–2,4), altså **y ≈ −0,52**, i samme plan som
  entrétaket inne. Dørelementet er ca. 2,1 m høyt. Over toppkarmen er det ca. 0,25–0,28 m kledning, i 225543 ca.
  70 px mot elementets ca. 520 px. Himlingen er undersiden av terrassen (dekketopp −0,03, så terrassen er ca. 0,5 m
  tykk med bjelker og himling).
- **Inngangsnivå: forplassen på y ≈ −2,90** (anslått, ±0,15; rettet i krysskontrollen fra −2,75). Grunnlaget er dette:
  1. **Etasjehøyden:** kjellertaket er ca. 2,25 i alle kjellerrommene og etasjeskillet ca. 0,30, så GANG ligger på
     **−2,55**. Trappa har 15 opptrinn à ca. 0,17 (`trapp.md`), og det går opp.
  2. **Entréen** ligger to trinn à ca. 0,17 under GANG (`entre-gang-kjeller.md`, 225553, 225559): **−2,89**.
     Terskelen står 2–4 cm over uteflaten (225553), så forplassen ligger på ca. **−2,90**.
  3. Jeg triangulerte reposets sørvestre hjørne i 082841 og 082852. Kameraene er fra fix-shell.md, og f ≈ 1503 px
     tilsvarer 13 mm-ekv. (EXIF) og vfov 89,9 som i photoCameras. Strålene får samme z først når y ≈ −2,7, og
     hele spennet med roll ±2° er −2,4 … −3,0. −2,90 ligger innenfor. Med y = −1,72 bommer de med 0,5–0,7 m i z.
  4. Den første versjonen regnet GANG = −2,45 ut fra kjellerstuas tak 2,22 og bare 0,23 m dekke. Det var for tynt.
- **Bakke foran døra:** ingen trinn. Terskelen ligger 2–4 cm over uteflaten (225553). Fra terskelen og utover:
  - en grusstripe (ca. 0,15–0,25 m),
  - en stor **skiferhelle** med dørmatte,
  - **betongheller** med grusfuger, som fortsetter sørover og som en sti mot sørvest rundt pilaren.

## Vegger

### Dørveggen (sør, plan høyre) – x ≈ 8,90, z 3,17 → 6,75

**Flate.** Stående kledning med bord på ca. 12–16 cm og smale skyggefuger. Den ser lik ut som `claddingMaterial` i
shell.js (boardCC 0,16). Fargen er mørk grå-brun beis. **Bruk #4a4642**, samme som `LOOK.cladding` og annekset. Det
stemmer med to målinger:
- dagslys under terrassehjørnet i 082850 gir hvitbalansert #4c4541,
- spotlyset i 225543 gir #5f5a57.

Kledningen går fra grusstripa og opp til himlingen. Den fortsetter **minst ca. 1,4 m vest for dørelementet**, til
z ≈ 6,7 bak pilaren (pilaren står foran veggen, ikke i enden av den). Bordene står like tett hele veien, så det er ett
plant felt. Planen viser derimot entréens vestvegg i z 6,05 (utvendig). Hva som står bak kledningen i z ≈ 6,0–6,7 er
ukjent (lukket rom under terrassen eller en innfelt garderobe). Bygg det som lukket.

**Dørelement (hovedinngang).**
- **Planen:** utvendig karm z ≈ 3,36–5,22 (1,85 m). Fra øst: østre sidefelt z 3,36–3,80 (0,44), dørblad
  z 3,80–4,72 (0,92), vestre sidefelt z 4,72–5,22 (0,50).
- **Bildet (225543):** dørbladet er halve elementbredden (ca. 255 av 510 px), som i planen. Men bladet er ca. 1,97
  ganger så høyt som det er bredt, og hele elementet ca. 1,07 ganger.
  - Med planens 0,92 m blir bladet bare ca. 1,8 m høyt. Det er for lavt for en ytterdør.
  - Med et vanlig blad på ca. 2,0 m blir elementet ca. **2,0 m bredt og 2,1 m høyt**. Da får også vrideren (0,96),
    ringeklokka (1,05) og benken (0,42) vanlige høyder i samme bilde.
- **Bruk (anslått):** element **z ≈ 3,29–5,29 (2,0 m) × 2,10 m**, med samme midtpunkt som planen.
  - østre sidefelt z 3,29–3,79 (0,50 med hengselposten),
  - **dørblad z 3,79–4,79 (ca. 1,0 × 2,05)**,
  - vestre sidefelt z 4,79–5,29 (0,50).
  - Sidefeltene er omtrent like brede i bildene. Om noe er den østre delen litt bredere; planen har den vestre
    bredest.
  - Vil man holde seg til planens 1,85, må høyden ned til ca. 1,95. Ellers stemmer ikke proporsjonene.
- Østre sidefelt står ca. 0,1–0,2 m fra hjørnet mot østre sidevegg.

**Dørbladet.**
- Glatt og uten fyllinger. Matt antrasitt/sort, hvitbalansert ca. **#2b2c2e**.
- Tre hengsler i stål på **østsiden**.
- Døra **slår UT**. I 225553 står bladet åpent ute, foran fotografen til høyre. Planen tegner også slaget utenfor,
  med hengsel øverst (øst).
- Åpnet 90° ligger bladet langs x fra (8,90; 3,79) til (9,90; 3,79). Potta med bartreet (se Møbler) stopper det ved
  ca. 100°. Uten potta kan det slå ca. 125° før det treffer østre sidevegg.

**Lås og håndtak.**
- Utvendig: sort digital kodelås, en smal plate på ca. 7 × 30 cm med tastatur, og sort vrider. Den sitter på
  **vestkanten** av bladet. Vrideren står ca. h 0,95–1,0 (anslått).
- Innvendig: sort vrider og låsmodul (225619).

**Sidefeltene.** Klart glass i nesten full høyde, ca. 0,05–2,0 over terskelen. Smale sorte aluminiumsrammer,
**#25272b** (= `LOOK.frame`).

**Terskel.** Lav og lys aluminiumsterskel, 3–4 cm.

**Ringeklokke.** Liten rund sort knapp, Ø ca. 3 cm, på kledningen ca. 0,1–0,15 m vest for elementet
(z ≈ 5,40, **h ≈ 1,05**, anslått). Den ses i 225543 under kransen, nesten på bildets midtlinje. Midtlinja treffer
veggen ca. 1,0–1,07 over terskelen.

Det synes ingen stikkontakt, vegglampe, postkasse eller husnummer på veggen.

### Østre sidevegg (bodrommets vestside) – z ≈ 3,17, x 8,90 → ca. 10,05

- Samme kledning (#4a4642). Den ses til høyre i 225543 og gjennom østre sidefelt i 225619.
- Veggen vender mot vest og har ingen åpninger.
- I 225543 ses kledningen ut til ca. x 10,0–10,1 ved høyre bildekant. Utenfor det er bildet svart: enten slutter
  veggen der, eller den er ubelyst. Planen sier 10,35.
- Ved foten: smalt bed med lav grønn bunndekke, og potta med bartreet (se Møbler).

### Bodrommets sørvegg – x ≈ 9,8–10,35, z −0,15 → 3,17 (ikke sett)

- Rommet øverst til høyre på kjellerplanen (3,70 × 2,84) er det lukkede bodrommet. Døra til det er inne fra
  entréens østvegg, i nordre ende. Planen viser ingen vinduer eller dører i sørveggen.
- Anslått: samme kledning, uten åpninger.
- Terrassekanten er triangulert til x ≈ 9,80 (TERRACE_FIT). Planen legger bodrommet 0,55 m lenger ut. Bildene ved
  døra ligger imellom: sideveggen ses til ca. 10,05, og pilarens sørflate står ca. i 10,35.
- **Anbefaling:** bodrommets sørflate i x ≈ 10,05. La terrassedekket og himlingen gå ut til minst samme linje over
  nisjen og bodrommet, og ut over pilaren (se Vestsiden). Da hviler terrassen på veggen og pilaren og får ingen trapp i
  fasaden. Dette må avklares med eieren, siden det flytter terrassekanten fra TERRACE_FIT.

### Vestsiden – pilaren og terrassens kledde vestside (z ≈ 6,75)

- exterior.js tegner allerede vestsiden som en kledd flate i z 6,75, fra x 7,22 til 9,8. I dag går den bare ned til
  −1,75. **Den må gå ned til inngangsnivå.** Den vender mot trappa, og nisjen ligger på innsiden.
- **Pilaren ved inngangen (spritputs).**
  - Grov spritputs i lys **nøytral grå, #a8a9aa**. Hvitbalansert er den nøytral til litt kald, ikke beige. Dagslyset
    fra stua gir ≈ #a4a6a7. Den er ikke hvit; exterior.js har #d9d6cf.
  - Ca. 0,30–0,40 m kvadratisk (anslått). Den går fra bakken opp til himlingen; minst 2,1 m ses i 225543.
  - **Plassering: ca. x 10,0–10,35, z 5,65–6,0** (midt ≈ (10,17; 5,82), anslått ±0,25).
    - Den står rett sør for benkens ytre ende.
    - Vestflaten flukter da omtrent med entréens vestvegg i planen (z ≈ 6,0). Sørflaten flukter med planens bodrom
      (x ≈ 10,35).
  - **Slik er den plassert:**
    - I 225543 ligger pilarens nordøstre hjørne ca. 46° til venstre for blikket (px 160–245).
    - I 225619 og 225621 ses pilaren gjennom **vestre sidefelt**, rett bak benkeenden. Det går bare hvis østflaten
      står ca. 0,35 m vest for sidefeltet og ca. 1,1 m ut fra veggen.
    - De to strålene krysser hverandre der.
  - **exterior.js har hjørnepilaren i (9,65; 6,60).** Der passer den ikke med bildene ved døra:
    - Innenfra ville den vært skjult bak veggen vest for vestre sidefelt.
    - I 225543 ville den bare vært en smal stripe helt ytterst til venstre.
  - I dagslysbildene 082841 og 082852 ses en hvit pilar der terrassens kledde vestside slutter. Det kan være samme
    pilar; da er hjørnet i TERRACE_FIT ca. 0,5–0,8 m feil. Det kan også være en egen hjørnepilar som ikke ses fra
    døra. Eieren kan avgjøre det.
- Liten sort boks, ca. 6 × 10 cm, på pilarens **østflate** (mot døra), h ≈ 1,4. Den er synlig i 225543 og 225619. Den
  kan være en bryter for utelyset eller en sensor (anslått).

### Kjellerfasaden vest for nisjen (bak terrassetrappa)

- Ikke sett fra bakken. Dette er kjellerstuas sørvegg med to vinduer (se `kjellerstue.md`). Fra stua ses en lys
  pusset grunnmur der; exterior.js har hvit grunnmur.
- Planen legger veggens ytterflate i x ≈ 6,75. Det er 0,3–0,45 m innenfor fasaden i 1. etasje, trolig en
  unøyaktighet i planen. La den flukte med grunnmuren (x 7,22).

### Fasaden i 1. etasje over terrassen, og taket (ikke fotografert utenfra)

- **Fasade:**
  - Anslått: hele huset har samme mørke grå-brune stående kledning (#4a4642) og sorte vindusrammer (#25272b).
    Fargen er bekreftet i dagslys på annekset (082916, 082843) og ved inngangen. shell.js bygger det slik allerede.
  - Fra starten ser man: terrassens sørkant med mørk kant (#3f4246), spilerekkverket (#7c776f, 1,05 høyt), og over
    det kjøkkenvinduene k1/k2 og knekken mot stua.
- **Tak:**
  - shell.js bygger et mørkt tak (#2e2d2c). Det er flatt over nordre del og faller ca. 9° mot sør, slik himlingen
    inne går fra 3,00 til 2,40. Takutstikket er 0,5–0,55 m, og det er takrenne langs stuas takfot.
  - Det er anslått, men rimelig. Takfoten ligger ca. 2,6 over 1. etasjes gulv, altså ca. 5,3 m over forplassen.
  - Annekset har torvtak (finnes allerede).

### Innsiden av ytterdøra (entréen) – bare kort, detaljene hører til gang/entré

Detaljene inne står i `entre-gang-kjeller.md`, og den fila gjelder for entréen der de to er uenige.

- Vegger og gulv:
  - Vegger trolig SAND (#cfc5b4, anslått).
  - Gulv i lys hvitpigmentert eik (#d4c9bb, som i kjellerstua). Bordene går nord–sør.
  - Lys gulvlist (#cbbba7).
- Dørelementet har en bred sort karm/gerikt (ca. 8–10 cm) rundt hele seg innvendig (225619).
- **Vestveggen (plan bunn):**
  - Innebygd garderobe med to speil-skyvedører i sorte aluminiumsrammer, hver ca. 0,95 × 2,2.
  - Sort skinne oppe ved taket.
  - Den går helt fram til sørveggen.
  - Mellom ytterdørkarmen og garderobefronten er det en ca. 0,15–0,2 m bred veggstripe. På den sitter en **sort
    lysbryter**, ca. 8 × 8 cm, h ≈ 1,0–1,1 (225619, 225621; speilbilde i garderobedøra).
  - Nord for den: en utstikkende kasse, ca. 0,35 m bred, og så nordvestre hjørne.
- **Nordveggen (plan venstre):** åpning til GANG, ca. 0,9 m bred, i en tykk vegg (ca. 0,4).
  - Åpningen har **to trinn opp**, med sorte neselister.
  - Planen legger den i z 3,43–4,35, rett overfor døra og ca. 0,35 m østligere. 225553 viser det samme.
- **Østveggen (plan topp):** sort fyllingsdør til det lukkede bodrommet i nordre ende (225617, 225558). Stumtjeneren
  står i søndre ende.
- **Himling:** fire til seks innfelte downlights med sort ring.

## Faste ting

Ute:
- Dørelementet med dørblad, to sidefelt, kodelås og terskel.
- Ringeklokke.
- Kledning på dørveggen og østre sidevegg.
- Himlingen: liggende bord på ca. 10 cm, parallelt med dørveggen (øst–vest).
  - I bildet er den nesten sort (ca. #0d0d0d), men den ubelyste øvre delen av veggen er like mørk. Mørket kommer av
    lyset, ikke av fargen.
  - Bruk **samme beis som kledningen, #4a4642** (anslått).
  - Den ligger på y ≈ −0,52, altså 2,35 over terskelen (ca. −2,87).
- Tre innfelte downlights (se Lys).
- Pilaren med den lille sorte boksen.
- Ingen nedløpsrør, utekran eller stikkontakt synes i nisjen.

Inne:
- Garderobe med speil-skyvedører.
- Sort lysbryter ved karmen.
- Trinnene opp til GANG.
- Den lukkede døra til bodrommet.

## Møbler (ryddig)

Ute:
- **Benk.**
  - Spilebenk uten rygg, med fem til seks liggende spiler. Gråbeiset, værbitt tre, **#77736c** (som rekkverket).
  - Ca. 0,85–0,9 × 0,35, h ca. 0,42–0,45 (anslått).
  - Den står **vinkelrett på dørveggen**, vest for døra, fra veggen ut til pilaren: x ≈ 9,1–9,95, z ≈ 5,5–5,85
    (anslått). Den ytre enden står like nord for pilaren.
  - I bildet står den litt skjevt. I spillet settes den rett.
  - Den står fritt, ca. 0,2 m fra dørveggen (225543).
- **Krans** av tørre kvister, Ø ca. 0,5. Den henger på kledningen med senter ca. 0,35 m vest for elementet
  (z ≈ 5,65), h ≈ 1,3. Den er pynt og kan tas med.
  - Fargen er grå-brun, hvitbalansert **#5f564e**. Den varme brunfargen i bildet kommer av lampelyset.
- **Potte med dvergbartre** (sypress/einer) i hjørnet øst for døra, foran østre sidefelt, ca. 0,15 m fra østre
  sidevegg (x ≈ 9,5, z ≈ 3,5).
  - Potta er sort og riflet (**#2a2a2b**), Ø 0,32 × 0,30.
  - Planten er 0,55–0,6 m høy, olivengrønn med gulbrune skudd, hvitbalansert ca. **#5a5a3a**.
  - Det står én potte til bak den, inntil dørveggen. Ta med bare den med bartreet.
- **Dørmatte** på skiferhella foran døra: mellomgrå, hvitbalansert ca. **#7f8083**, ca. 0,8 × 0,5. I begge bildene
  er den ca. 0,8 ganger så lys som skiferen rundt. Lengden går langs z, midt for dørbladet.

Inne (for helhetsinntrykket når man går inn):
- Stumtjener i sort metall, ryddig og uten klær, i sørøstre hjørne.
- Oval jutematte rett innenfor døra, ca. 1,2 × 0,75 (som `entre-gang-kjeller.md`).
- Høy grå keramikkvase med tørket pampas i nordvestre hjørne.

## Lys

- **Tre innfelte downlights i himlingen.**
  - Runde, ca. Ø 8–9 cm, med lys ring (krom/hvit).
  - Varmhvitt lys, ca. 2700–3000 K, med smal kjegle (ca. 40–60°). De lager skarpe lysbuer på kledningen, slik
    225543 viser.
  - Plassering: på rad ca. **0,55–0,6 m ut fra dørveggen (x ≈ 9,5)**, i **z ≈ 3,7 / 4,65 / 5,6**. Det er ca. 0,95 m
    mellom dem (anslått, regnet ut fra 225543 med kameraet ca. 2,2–2,4 m fra veggen).
  - Lysene er på om kvelden og natta.
- Om kvelden lyser entréens downlights ut gjennom sidefeltene, og det ses tydelig utenfra.
- Om dagen ligger nisjen i skygge under terrassen, også når solen står lavt i østsørøst.

## Startposisjon (første innlasting)

Gjelder bare når det ikke finnes noen lagret posisjon.

- **Sted:** sørsiden (plan høyre), på forplassen foran kjellerinngangen. Spilleren står like utenfor terrassekanten,
  mellom bodrommet (øst) og terrassetrappa/pilaren (vest).
- **Føtter:** (x **12,2**; y = inngangsnivå ≈ **−2,90**; z **4,6**). Øyehøyden 1,66 gir y ≈ −1,24.
- **Ser mot** midten av dørbladet, (8,90; −1,85; 4,29).
  - yaw = atan2(−dx, −dz) = atan2(3,30; 0,31) ≈ **1,48 rad (85°)**. I PlayerController er 0 = −z, og pluss er mot
    venstre.
  - pitch ≈ **−0,10 rad**. Med −0,18 sikter man rett på dørmidten. Med −0,10 er også downlightene og terrassekanten i
    bildet.
- **Avstand** til døra: 3,3 m. Kameraet i 225543 sto ca. ved x 11,1–11,3 og z 4,45, ca. 1,25–1,35 over bakken.
  Startbildet blir altså nesten som det bildet, bare litt lenger unna og litt høyere.
- **Klar av hindringer:**
  - dørslaget (x 8,90–9,90, z 3,79–4,79),
  - bodrommet (z < 3,17),
  - pilaren (x 10,0–10,35, z 5,65–6,0),
  - trappa (z > 6,75).
- Snur man seg, ser man plenen ned mot elva, eikene og naustene.
- Fotobakgrunnen i sør er stilt inn for stuevinduene, 2,7 m høyere. Den kan derfor se litt rar ut herfra (se under).

## Dette må bygges ute

1. **Kjellerens sørfasade ved inngangen.** Dette er nytt:
   - dørveggen (x 8,90, z 3,17–6,75) med kledning,
   - dørelementet: utadslående med hengsel i øst, ca. 2,0 m bredt med sidefelt (planen 1,85),
   - himlingen på y ≈ −0,52 over nisjen (fra x 8,90 ut til nisjefronten ved ca. 10,05–10,35, z 3,17–6,75),
   - tre downlights og ringeklokke.
2. **Bodrommet (3,70 × 2,84) som lukket kasse.** Kledd vest- og sørflate. Sørflaten står i x ≈ 10,05 (se Bodrommets
   sørvegg).
3. **Terrassens vestside og pilarene** skal gå helt ned til inngangsnivå. I dag stopper de på −1,75.
   - **Inngangspilaren** bygges i ca. (10,17; 5,82), 0,35 × 0,35, i grå spritputs (#a8a9aa).
   - Hjørnepilaren i (9,65; 6,60) beholdes bare hvis eieren bekrefter at det er to pilarer. Den får også grå
     spritputs i stedet for hvit.
4. **Rydd i exterior.js:**
   - Fjern pilarene under terrassekanten i z 0,25 og z 3,375 (x 9,5). Pilaren i z 3,375 ville stått midt foran
     østre sidefelt, 0,6 m fra døra, og bildet viser ingen pilar der, bare kledd sidevegg. Pilaren i z 6,55 dobler
     hjørnepilaren.
   - Fjern den hvite grunnmuren under kjøkkenets sørvegg (x ≈ 6,37–6,62, ned til groundY). Den ville stått inne i
     entréen og bodrommet. Det samme gjelder den delen av grunnmuren under stuas sørvegg (x ≈ 6,97–7,22) som ligger
     i z < 5,85, inne i entréen.
5. **Forplass på inngangsnivå (≈ −2,90).**
   - Flat fra dørveggen ut til x ≈ 12,6, z ≈ 3,2–6,75. Den går sammen med reposet ved trappefoten.
   - Belegg:
     - grusstripe langs veggen (**#aeafb0**, nøytral lys grå),
     - skiferhelle ca. 1,5 × 0,7 foran døra, lys blågrå **#9da4a8**. I 225543 er den like lys som betonghellene ved
       siden av, bare blåere,
     - betongheller ca. 0,5 × 0,5 / 0,6 × 0,4 (**#a7a49e**) med grusfuger,
     - lav bunndekke (**#4e6b3a**) langs østveggen.
   - Utenfor forplassen begynner plenen, som faller svakt mot elva.
6. **Terrengnivået langs sørsiden.** Dette er den største konflikten (se Usikkert):
   - exterior.js (TERRACE_FIT) har repos, sti og plen på −1,72/−1,75 og en trapp med 9 opptrinn til x 9,55.
   - Bildene ved døra viser én flate fra døra og rundt pilaren mot trappa, uten trinn. Trianguleringen gir reposet
     ≈ −2,7 (−2,4 … −3,0).
   - **Anbefaling:** senk `nearGround` og repos/sti/gangvei til inngangsnivå (−2,90). Forleng trappa til ca. **16
     opptrinn** (stigning ca. 0,18 fra dekket på −0,03, inntrinn 0,25, løp ca. 3,75 m), slik at den går fra x 7,62
     til ca. 11,4.
   - Reposet blir da ca. x 11,4–12,4, z 6,75–8,3. Trianguleringen gir sørvestre hjørne ca. x 11,5–12,0, z ≈ 8,3.
   - Der trappa går forbi pilaren (x > 9,8), trenger den en lukket vange eller et rekkverk på østsiden mot
     forplassen (anslått).
   - Hvis TERRACE_FIT beholdes, må det inn ca. seks trinn ned fra reposet til forplassen vest for pilaren. Ingen
     bilder viser slike trinn.
7. **Under annekset** (x 6,8–10, z −3…0) skal det være terreng eller pusset grunnmur ned til forplassen. I dag starter
   annekset på −0,33 og ville sveve 2,4 m over den. Anslått: skrående terrengbank med stein og busker, eller en
   pusset støttemur i forlengelsen av bodrommets sørflate.
8. **Gåbart ute:**
   - Gulvkollisjon på forplassen, reposet og stien.
   - Usynlige grenser, f.eks. x ≤ 14, z −0,2…9, og trappa sperret som i dag eller gåbar.
   - Ytterdøra må kunne åpnes med E: ca. 1,0 m blad (planen 0,92), hengsel øst, slår ut.
   - Entrégulvet ligger på inngangsnivå (+2–3 cm terskel), og så går to trinn opp til GANG.
9. **1. etasje og tak** finnes i shell.js (kledning #4a4642, mørkt tak med takrenne). Det holder for utsikten fra
   forplassen.

## Utelatt rot

Ute:
- Jakker sett gjennom sidefeltene.
- Plastbiter og løv ved benken.
- Ugress mellom hellene.
- Jord og kvist i bedet ved benken. Det erstattes med grus.

Inne (entréen):
- Klær på stumtjeneren.
- Sko, crocs og innleggssåler.
- Pappeske.
- Kurver, sko, vesker og hatter på garderobehyllene. Speildørene vises lukket.
- Skohorn.

I GANG (bildene bak trappa):
- Gulvpakker, poser, skjøteledning, ruter/elektronikk på gulvet og sokker.

## Usikkert / anslått

- **Inngangsnivået (−2,90 ± 0,15)** står mot TERRACE_FIT, som har repos og plen på −1,72/−1,75. Bildene ved døra,
  trianguleringen og høydene inne (GANG −2,55, entré −2,89) peker mot ca. −2,9, ikke langt fra room-specs gamle
  `groundBelowY` (−2,7).
  - Eieren kan avgjøre det ved å telle trinnene i terrassetrappa. Ni trinn betyr −1,7; ca. 16 trinn betyr ca. −2,9.
  - Trinnene inne fra entré til GANG bør også måles; anslått to à ca. 0,17.
- **Terrassekanten** (x 9,80, triangulert) og planens bodrom (ut til x 10,35) er uenige med 0,55 m. Bildene ved
  døra ligger imellom: østre sidevegg ses til ca. 10,05, og pilaren til ca. 10,35.
- **Dørveggens lengde:** bildet viser kledning til minst z ≈ 6,7. Planens entré slutter i z 6,05. Hva som står bak
  kledningen i mellomrommet er ukjent.
- **Pilarens plass:** ca. (10,17; 5,82) ± 0,25, fra 225543 sammen med 225619/225621 (to kameraer). TERRACE_FIT har
  hjørnepilaren i (9,65; 6,60). Det er uklart om det er én eller to pilarer (se Vestsiden). Benken (0,85–0,9 m) får
  plass mellom dørveggen og pilaren.
- **Mål på dørelementet:** planen sier 1,85 m. Bildets proporsjoner (bladet er ca. 1,97 ganger så høyt som det er
  bredt) passer med ca. 2,0 × 2,1, med blad ca. 1,0 × 2,05. Alle avstander regnet fra 225543 skalerer med denne
  bredden (±8 %).
- **Himlingshøyden** (2,35; mellom 2,2 og 2,4) og downlightenes plass er anslått fra ett vidvinkelbilde.
  - Kameraet: EXIF 13 mm-ekv., f ≈ 601 px i 1600 px-kopien. Pitch ca. −6°, ut fra hvor mye karmkantene heller.
    Kamerahøyden er ca. 1,25–1,35.
- **Farger:**
  - Kledningen er målt både om kvelden og i dagslys og stemmer med #4a4642.
  - Dørbladet (#2b2c2e) er tatt fra en mørk kveldsflate, så det er usikkert.
  - Himlingen er satt lik kledningen (#4a4642), fordi den ubelyste veggen er like mørk i bildet.
  - Skifer, dørmatte og grus er målt mot betonghellene i samme lys. Hellene er antatt nøytrale og satt til #a7a49e.
  - Pilaren (#a8a9aa) er målt både i dagslys og i kveldslys.
- **Ikke sett:** bodrommets sørvegg, fasaden og taket i 1. etasje utenfra, terrenget øst for bodrommet og under
  annekset, og veien inn fra vei/parkering (sannsynligvis fra nord eller øst, rundt huset). Alt dette er anslått.
- **Den lille sorte boksen** på pilaren kan være bryter, sensor eller stikkontakt.

## Bilder

| Fil | Viser |
|---|---|
| 20261020_225543 | **Inngangen utenfra om kvelden**, ca. 2,2 m fra døra mot nord. Dørelement med sidefelt, kodelås og hengsler øst. Kledning, mørk himling med tre downlights, krans og ringeklokke, spilebenk vinkelrett på veggen, spritputset pilar til venstre, skifer, betongheller og grus, potte med bartre til høyre. |
| 20261020_225553 | Fra utsiden med døra åpen. Bladet slår **ut** til høyre (øst). Lav aluminiumsterskel, grusstripe, skiferhelle og dørmatte. Gjennom døra ses entréen, åpningen med to trinn opp og trappa i GANG langt inne. |
| 20261020_225619 | Ytterdøra innenfra: sort blad, sidefelt, bred sort karm og innvendig lås. Gjennom vestre sidefelt ses pilaren (spritputs, liten sort boks), benkeenden og hellestien mot sørvest. Gjennom østre sidefelt ses kledd sidevegg og potta. |
| 20261020_225556 | Entréens østvegg ved søndre ende: stumtjener og ytterdørkarmen med hengsler. Døra til bodrommet til venstre. |
| 20261020_225558 | Døra til bodrommet (østvegg), åpen mot tregulv. Til venstre åpningen med to trinn opp til GANG. |
| 20261020_225559 | Mot nord fra døra: garderobe (vestvegg), utstikkende kasse, vase i hjørnet, åpningen med to trinn og trappa bak. Døra til bodrommet til høyre. |
| 20261020_225600 | Garderoben med speil-skyvedører (åpen), kassen og hjørnet med vasen. |
| 20261020_225609 | Garderoben lukket. Speilet viser entréen med døra til bodrommet og trinnene. |
| 20261020_225617 | Entréens østvegg: sort fyllingsdør til bodrommet, stumtjeneren og ytterdørkarmen helt til høyre. Gjennom østre sidefelt ses potta ute. |
| 20261020_225621 | Garderoben forfra. Ytterdøras vestre sidefelt til venstre; gjennom det ses pilaren, benken og hellene. Lysbryteren sitter på stripa mellom karmen og garderoben. |
| 20261020_225256 | **1. etasje**, ikke kjelleren: soverommet i 1. etg (mørk blågrå vegger, seng) sett fra gangen øverst i trappa. Det sorte spilerekkverket rundt trappeåpningen ses nede til høyre (se `soverom-1etg.md`). |
| 20261020_225349 | GANG: trappa opp til 1. etasje, åpen trapp med vange, LED-håndløper og nisje med plante. |
| 20261020_225625, 225631 | GANG mot trappa, med dører på venstre side (for GANG-fila). |
| 20261020_225630 | GANG, sørvest-hjørnet: oliventre, stikkontakt og kjellerstuedøra åpen (GANG-fila). |
| 20261020_225635 | Dør til uinnredet bod fra GANG (GANG-fila). |
| 20261020_225639 | Trappa fra siden, og døra til boden 1,64 × 2,32 ved det utvendige hjørnet ved trappa, ikke under den (GANG-fila). |
| bilder_stue 082841, 082843, 082850, 082852 | Terrassen, spileskjermen langs vestkanten, trappa sørover med rekkverk, lyst betongrepos med kantstein, spritputset pilar og kledd vestside under terrassens sørvesthjørne. Brukt til triangulering av reposet. |
| bilder_stue 082901, 082916 | Terrassedøra og annekset (kledning i dagslys, #4a4642). |
| gang 1etg 225331–225344 | Ingen ytterdør i 1. etasje. |

## Kontrollert

Uavhengig kontroll 2026-10-21. Jeg så gjennom alle 17 bildene, begge planene og 082841/082850/082852. Fargene er
målt med pikselsnitt og hvitbalansert med R × 0,79, G × 0,86, som før. Bildegeometrien er regnet med f ≈ 601 px
(13 mm-ekv. fra EXIF). Retningene var riktige: døra sitter i sørveggen, hengslene er i øst, døra slår ut, låsen
sitter i vest, bodrommet ligger i øst og åpningen til GANG i nord. Disse tingene er endret:

1. **Pilarens plass.** Den var satt til (9,65; 6,60) med begrunnelsen at det «passer med 225543». Det stemmer ikke.
   - Fra kameraet i 225543 ville den pilaren bare vært en smal stripe helt ytterst til venstre (px ≈ 0–45). I
     bildet går den til px 245.
   - I 225619 og 225621 ses pilaren gjennom **vestre sidefelt**. Det er umulig hvis den står i z ≥ 6,4 nær veggen.
   - De to kameraene gir sammen ca. x 10,0–10,35, z 5,65–6,0, rett sør for benken. Dette er rettet i Rommet,
     Vestsiden, Møbler, Startposisjon, Bygges ute og Usikkert.
   - Jeg peker også på uenigheten med TERRACE_FIT: én eller to pilarer?
2. **Nisjens dybde og bodrommets sørflate.**
   - Før: anbefalt 9,9.
   - Nå: ca. 10,05. Sideveggen ses til ca. 10,0–10,1, og pilaren står ut til ca. 10,35.
   - Dekket og himlingen må gå ut over pilaren.
3. **Dørelementets mål.** 1,85 m bredde og 2,15 m høyde passer ikke med bildets proporsjoner. Bladet er ca. 1,97
   ganger så høyt som det er bredt, og elementet ca. 1,07 ganger.
   - Anbefalt nå: ca. 2,0 × 2,1, med blad ca. 1,0 × 2,05. Alternativet er planens 1,85 × ca. 1,95.
   - Påstanden om at vestre sidefelt er bredest «både i plan og bilde» er fjernet. I bildene er de omtrent like
     brede.
4. **Høyder rettet:**
   - ringeklokke h 1,35 → ca. 1,05 (den sitter på bildets midtlinje),
   - krans h 1,45 / Ø 0,45 → ca. 1,3 / 0,5,
   - himling 2,40 → ca. 2,35 (2,2–2,4).
5. **Downlights:** z 3,8 / 4,6 / 5,4 → ca. 3,7 / 4,65 / 5,6. Det er ca. 0,95 m mellom dem, ikke 0,8.
6. **Benk og potte flyttet:**
   - benk x 8,95–9,80 / z 5,60–5,95 → x 9,1–9,95 / z 5,5–5,85 (fra veggen ut til pilaren),
   - potte med bartre (9,15; 3,40) → (9,5; 3,5). Den stopper døra ved ca. 100°; det sto før «130°».
7. **Farger som ikke var hvitbalansert, eller var gjettet mørkere enn bildet viser:**
   - skifer #5f656b → #9da4a8 (like lys som betongen ved siden av),
   - dørmatte #3e3e3c → #7f8083,
   - grus #b4afa6 → #aeafb0 (den varme tonen var lampelys),
   - krans #6b4f3a → #5f564e,
   - bartre #56703f → #5a5a3a,
   - pilar #a9a7a1 → #a8a9aa (nøytral, ikke beige),
   - himling #35312e → #4a4642. Den er like mørk som den ubelyste veggen, altså er mørket lys, ikke farge.
8. **Inne:**
   - «Garderoben begynner 0,15 m nord for ytterdørkarmen» var feil retning. Garderoben går til sørveggen, og mellom
     karmen og garderobefronten er det en smal veggstripe.
   - Den **sorte lysbryteren** på den stripa manglet, og er lagt til under Faste ting.
   - Jutematta er satt til 1,2 × 0,75, som i `entre-gang-kjeller.md`.
9. **Bildetabellen:**
   - 225256 er 1. etasje (blågrått soverom sett fra trappa), ikke en dør til soverommet i kjelleren.
   - 225639 viser døra til boden 1,64 ved trappa, ikke under den.
   - 225630 er gangens sørvest-hjørne.
   - 225617 og 225621 viser også litt av utsiden.
10. **Ikke endret, men bør vites:**
    - Inngangsnivået (−2,75) og trianguleringen mot TERRACE_FIT (−1,72) har jeg ikke kunnet avgjøre. Det står
      fortsatt som det største spørsmålet.
    - `entre-gang-kjeller.md` bruker et litt annet koordinatopphav for kjellerplanen. Den legger planens innvendige
      hjørne i 0, mot ca. 0,13 her. Den har også dørelementet 1,85 × 2,15–2,2 og entrétaket 2,40. Dette må samkjøres
      når entréen bygges.
    - Ingen rot hadde sneket seg inn i Faste ting eller Møbler.

### Krysskontroll mellom rommene (2026-10-21)

Sjekket mot `entre-gang-kjeller.md`, `trapp.md`, `gang-1etg.md`, `kjellerstue.md` og `vaskerom.md`.

- **Hovedinngangen er entydig:** én ytterdør i entréens sørvegg; 1. etasje har bare terrassedøra. Retningene
  (hengsler øst, slår ut, lås vest, åpning til GANG i nord, døra til rommet 3,70 i øst) er like i begge notatene.
- **Rettet: inngangsnivået** −2,75 → **−2,90**. Etasjehøyden er nå satt til 2,55 (kjellertak 2,25 + dekke 0,30), så
  GANG ligger på −2,55 og entréen to trinn à 0,17 lavere, på −2,89. Utregningen her brukte et dekke på bare 0,23 m og
  trinn à 0,15.
- **Rettet: himlingen** y −0,40 → **−0,52** (2,35 over terskelen). Den ligger da i samme plan som entrétaket inne.
- **Rettet: startposisjonen** y −2,75 → −2,90 og blikkpunktet til dørbladets midte i den anbefalte bredden (z 4,29).
  Yaw blir 1,48 rad.
- **Rettet: terrassetrappa** må ha ca. 16 opptrinn (ikke 15) for å nå −2,90.
- **Samkjørt:** `entre-gang-kjeller.md` bruker nå samme koordinatramme som her (kjellerplanen med ytterflatene i flukt,
  +0,13 i x og z), samme dørelement (ca. 2,0 m, blad ca. 1,0) og samme verdier ute. Den fila gjelder inne, denne ute.
