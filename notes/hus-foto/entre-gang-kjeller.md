# Entré og gang i kjelleren (GANG + rommet med ytterdør)

Kilder:
- 17 bilder i `bilder_hus/_1600/Entre og gang kjeller/`, tatt 20.10.2026 kl. 22.52–22.56 i varmt kveldslys
- kjellerplanen `bilder_hus/_1600/plantegning_kjeller.png`
- `notes/hele-huset-fakta.md` (fasit)

Ett bilde (225256) er tatt i 1. etasje, se «Bilder».

**Hovedinngangen er bekreftet.** Ytterdøra sitter i sørveggen (planens høyre) i rommet på 2,51 × 2,93. Fra døra går man
rett fram gjennom en åpning med **to trinn opp** til GANG, og trappa ses i nordenden (225543, 225553, 225619).

**Retninger og koordinater**
- Retninger i planen: venstre = nord, topp = øst, høyre = sør (elva), bunn = vest.
- **Lokale koordinater** i hvert rom, med samme akser som spillet:
  - `x` = meter sørover fra rommets nordvegg
  - `z` = meter vestover fra rommets østvegg
  - `y` = høyde over **gangens** gulv
- **Kjellerplan-koordinater `K(X, Z)`**:
  - Origo er det innvendige hjørnet øverst til venstre på kjellerplanen (px 126,5 | 120), der nordre og østre
    yttervegg møtes ved boden på 1,64 × 2,32.
  - Skala 60,5 px/m. Den er kontrollert mot målene 5,60 / 2,70 / 2,91 / 2,51 / 2,32 / 3,40 / 6,05 og 11,84.
  - Omregning fra lokale koordinater:
    - Gang: `X = x`, `Z = 2,41 + z`
    - Entré: `X = 6,01 + x`, `Z = 2,97 + z`
- **Til spillets koordinater (rettet i krysskontrollen):** legg kjellerplanen med **ytterflatene i flukt** med
  1. etasje. Kjellerplanen tegner nord- og østveggen ca. 0,28 tykke, 1. etasje ca. 0,16, så kjellerens innerflater står
  ca. 0,13 lenger inn. Da blir spillets **x = X + 0,13** og **z = Z + 0,13** (samme ramme som `ytterdor-ute.md` og
  `trapp.md`):
  - Gang: spill-x = x + 0,13, spill-z = z + 2,54. Entré: spill-x = x + 6,14, spill-z = z + 3,10.
  - Sjakta havner da på z ≈ 2,29 (nisjeveggen) til 4,37 (badveggen). Oppe er den 2,32–4,40. Kjellerens nordvegg
    havner på x 0,13, og det er nettopp hylla (0,15 dyp) langs nordveggen i sjakta. Trinn 1 havner på x 1,73, som i
    `trapp.md`.
  - Den første versjonen la origo oppå origo (uten 0,13). Da får hylla ingen dybde.
- **Høyder i verdens-y** (1. etasje = 0): gangens gulv ligger på **−2,55**, entréens på **−2,89** (se `oversikt.md`).

## Rommet

### Gang (GANG, 12,50 m² med trappa)
- **L-form, 5,60 m lang (nord–sør):**
  - **Nordre del (trappedelen):** x 0–2,91, bredde z 0–1,83. Planmålene er 2,91 × 1,83; tegningen måler 1,72.
    Trappa ligger her, og badet/vaskerommet ligger vest for den.
    - Ved trappa (x 0 til ca. 1,75) går sjakta ca. 0,25 m lenger øst, til z ≈ −0,25 (nisjen ved boddøra, se Østvegg).
      Der er sjakta ca. 2,07 bred, like bred som gangen i 1. etg (`trapp.md`). Anslått, planen viser rett vegg.
  - **Søndre del:** x 2,91–5,60 (2,70 m), bredde z 0 til ca. **2,64**. Kjellerstua ligger vest for den, og
    entréen ligger sør for den.
  - **Knekken** i x = 2,91 er sørflaten av muren i vaskerommets sørøstre hjørne, der kjellerstua begynner. Den er
    ca. 0,8–0,95 m bred og vender mot sør.
- **Planmålet «2,07» stemmer ikke.**
  - Pila spenner over 2,64 m på tegningen.
  - 5,60 × 2,07 gir bare 11,6 m².
  - 2,91 × 1,83 + 2,70 × 2,64 = 12,46 m² ≈ 12,50.
  - Bildene viser også at søndre del er ca. 0,9–1,0 m bredere enn trappedelen (225631).
  - **Bruk ca. 2,64 m.** 2,07 er trolig kopiert fra gangen i 1. etg.
- **Takhøyde:** **2,25 m** (felles modellverdi for hele kjelleren, rettet i krysskontrollen). Anslått til 2,25–2,35
  ut fra dørkarmene i 225630 og 225635.
  - Kjellerstua (2,22, kontroll 2,25), soverommet (2,25) og vaskerommet (2,23–2,30) ligger i samme spenn. Ett tak for
  alle gir ingen sprang over dørene.
  - Taket er flatt og glatt, uten bjelker. I verdens-y ligger det på −0,30, rett under etasjeskillet.
  - **Ingen taklist**, i motsetning til kjellerstua.
- **Tak:** lyst og matt, i samme tone som veggene. Bruk SAND som takene i 1. etg, eller brukket hvit ca. #e8e4dc som
  kjellerstue.md (usikkert).
- **Gulv:** lys **hvitpigmentert eik** i bord, ca. 0,20 m brede og over 2 m lange, med forskjøvne endeskjøter.
  - Bordene går **nord–sør**, langs gangen og videre inn i entréen (225625, 225559).
  - Hvitbalansert ca. **#bdb2a3**. Målingene spriker fra #b6aca0 til #cac8c2 avhengig av spottene.
  - Gulvet går trolig rett over i kjellerstua. Der er det anslått til #d4c9bb, så bruk én felles verdi i hele kjelleren.
  - Gulvet er lysere enn stuegulvet i 1. etg (#a59b8f).
- **Vegger:** **SAND #cfc5b4** på alle flater. Hvitbalansert måler de ca. #ccc4b6, og fargetonen er den samme som
  SAND (r/g ≈ 1,07, b/g ≈ 0,91 i bildene).
- **Gulvlist:** ca. 6 cm høy, rett firkantet med liten fas.
  - **Beige i veggfargen, ikke hvit** som i 1. etg. Ca. #c9bfae (nærbilde av 225617; 225630).
  - Kjellerstue.md har #cbbba7, så bruk gjerne den samme.
- **Gulvnivå:** gangen er referansen, `y = 0` (verdens-y −2,55: 15 opptrinn à 0,17 under 1. etasje).
- **Varme:** ingen radiatorer eller termostat er synlige, trolig varmekabler.
- **Vinduer:** ingen.

### Entré (rommet med ytterdøra, 2,51 × 2,93)
- **Mål:** 2,51 m nord–sør (x) × **2,93 m** øst–vest (z). Det er eierens mål (fasit) og målet i planmargen.
  - Tegningen måler bare **2,50 × 2,73** innvendig. Pilmålet inne i rommet er delvis skjult av 2,51-teksten.
  - **Bildene passer best med 2,93**, ikke 2,71:
    - Hjørnesøyla stikker ca. **0,3 m** fram foran garderobefronten (225559, 225600, 225621). `ytterdor-ute.md` fant
      det samme («utstikkende kasse, ca. 0,35 m»).
    - Den svarte foringen rundt dørelementet går helt inn til sørøst-hjørnet (225617, 225619, 225556).
    - Med 2,71 er det ikke plass til foringen, bryterstripa og en vanlig garderobe på ca. 0,45–0,5 m.
    - `ytterdor-ute.md` så også at kledningen ute går lenger vest enn planens entré.
  - **Bruk 2,50 × 2,93** til bakveggen bak garderoben. Fri gulvflate foran garderoben er z 0–ca. 2,46.
- **Hjørnesøyle i nordvest:** x 0–0,56, z 2,15–2,93 (0,56 × 0,78). Det er hjørnet av kjellerstua som stikker inn:
  østflaten ligger i linje med veggen mellom gang og kjellerstue, og sørflaten er utsiden av kjellerstuas sørvegg.
  - Den er malt SAND og har gulvlist (225559, 225600, 225621).
  - Planen tegner gulv i x 0–0,30 og en tynn dobbel veggstrek i x 0,30–0,56. Bildene viser en massiv søyle.
- **Gulvnivå:** ca. **y = −0,34**, to opptrinn à ca. 17 cm ned fra gangen (anslått). Verdens-y **−2,89**.
- **Takhøyde:** ca. **2,35–2,40 m** over entrégulvet, anslått ut fra karmen i 225617 og dørelementet i 225619.
  - Det gir y ≈ +2,01–2,06 (verdens-y ca. −0,52), altså ca. 0,2 m lavere tak enn i gangen (2,25).
  - Himlingen ute ligger 2,35 over terskelen (`ytterdor-ute.md`), altså i samme plan. Entrétaket og himlingen ute
    kan bygges som én flate gjennom dørveggen.
  - Ingen taklist.
- **Gulv, vegger, tak og gulvlist** er som i gangen. Bordene går nord–sør.
- **Innredning:** ytterdøra er i sør, garderoben på vestveggen og døra til rommet 3,70 × 2,84 i øst. Åpningen opp
  til gangen er i nord.
- **Vinduer:** ingen, bortsett fra sidelysene ved ytterdøra.

## Vegger

### Gang – nordvegg (planens venstre, x = 0), z −0,25 → 1,83
- Yttervegg, tegnet tykk i planen. SAND, ingen vinduer.
- Trappas **sving** (vangetrinn rundt et smalt trappeøye) går langs hele veggen, fra nedre løp i vest til øvre løp i
  øst. Den veggmonterte håndlista med LED under følger veggen og stiger østover (225349, 225631).
- På toppen av grunnmuren, i ca. y 2,30, går det en ca. 0,15 m dyp hylle/avsats langs hele veggen. Plantekurven står på
  den i NV-hjørnet (225349; `trapp.md`).
- I nordøst-hjørnet, under den lave delen av øvre løp, er det en åpen lagerplass (se Faste ting).
- Ingen stikkontakter eller brytere er synlige nedenfra. `trapp.md` har en sort bryter/kontakt like over hylla ved
  vestveggen.

### Gang – østvegg (planens topp, z = 0; ved trappa z ≈ −0,25), x 0 → 5,60
- **x 0–0,84:** lagerplassen under øvre løp.
- **x 0,84–1,63: dør til boden 1,64 × 2,32** (planen). Den står under den høye sørenden av øvre løp.
  - Sort dør, **hengsler mot sør**: i planbuen sitter hengselet ved søndre karm. Den slår inn i boden. **Lukket** i
    spillet.
  - Bildene viser at døra sitter i en grunn **nisje**. Søndre karm står helt inntil et utvendig hjørne, og veggen sør
    for døra (x > ca. 1,75) stikker anslått **0,2–0,3 m** lenger inn i gangen (225639, 225349).
    - Tolkning: sørdelens østvegg ligger i z = 0. Sjaktveggen med døra og lagerplassen ligger i z ≈ −0,25.
    - Da blir trappesjakta ca. 2,07 bred, som i 1. etg. `trapp.md` tolker det likt.
  - Derfor kan døra ikke ses fra søndre del av gangen (225625, 225631).
  - Planen viser rett vegg. Nisjen er anslått.
  - Ifølge `trapp.md` møter toppen av nordre karm undersiden av veggvangen. Flytt døra 0,1–0,15 m sørover hvis karmen
    kolliderer med vangen.
- **x ≈ 1,75–4,6:** glatt vegg med 3 lyskjegler fra downlights (225625, 225635).
- **x ≈ 4,45:** sort dobbel stikkontakt, liggende, ca. 15 × 8 cm, rett over gulvlista (midt h ≈ 0,12–0,15).
  Den sitter ca. 5–10 cm nord for karmen (225635, 225625).
- **x ≈ 4,60–5,55: dør til den grå boden 4,28 × 2,32.**
  - **Døra står ikke i planen.**
  - Hullet er ca. 0,95 m inkl. karm. Søndre karm står ca. 0,05 m fra sørøst-hjørnet.
  - Hengsler mot sør, slår inn i boden (østover).
  - Bladet er sort på gangsida, med lys grå kant, sort vrider og vri.
  - Bak døra er det en uinnredet bod med betonggulv (#8a8580). **Lukket** i spillet, tomt rom bak (225635).

### Gang – sørvegg (planens høyre, x = 5,60), z 0 → 2,64
- Tykk vegg, ca. 0,41 m. SAND.
- **z 0–0,86:** glatt vegg.
- **z 0,86–1,79: åpning ned til entréen**, 0,93 m bred (planen).
  - Fra entrésida (225553, 225559) ser åpningen ut til å ligge ca. 0,1 m lenger vest, altså ca. z 0,98–1,91 her.
    Avviket er lite, så planverdien er beholdt (anslått).
  - Ingen dør og ingen karm. Lysningen er pusset i veggfargen.
  - To trinn ned (se Faste ting).
  - Overkanten ligger trolig i entréens takhøyde (y ≈ 2,01–2,06). Da blir det en ca. 0,2 m nedforing over åpningen på
    gangsida (anslått).
- **z 1,79–2,64:** glatt vegg. I sørvest-hjørnet står et kunstig oliventre (pynt) (225630).

### Gang – vestvegg, søndre del (mot kjellerstua, z = 2,64), x 2,91 → 5,60
- **x 3,08–3,95: dør til kjellerstua** (planen, 0,18 m fra knekken).
  - Hengsler mot nord. Slår **inn i kjellerstua** (225630, 225631; kjellerstue.md sier det samme).
  - Sort blad med ett innfelt felt og sort vrider.
  - Gjennom døra ses en gråere vegg og lyst gulv.
- **x ≈ 5,50:** sort dobbel stikkontakt, liggende, helt nede ved gulvlista, ca. 0,1 m fra sørvest-hjørnet (225630).
- 2 lyskjegler fra downlights, ved ca. x 3,8 og 4,9 (225630).

### Gang – knekken (sørflaten av vaskerommets sørøstre hjørne, x = 2,91), z 1,83 → 2,64
- Glatt flate på ca. 0,8–0,95 m som vender mot sør. Den ses rett forfra i 225631 og 225625.
- Ingen stikkontakter eller brytere er synlige.

### Gang – vestvegg, trappedelen (badveggen, z = 1,83), x 0 → 2,91
- **x 0–1,60:** trappas nedre løp langs veggen, med veggmontert håndlist (225349).
- **x 1,69–2,58: dør til bad/vaskerom.**
  - Hengsler mot sør, slår inn i vaskerommet (planen og vaskerom.md).
  - I 225349 står den åpen. Gjennom døra skimtes grått flisgulv og glassvegg med sorte profiler.
- **x 2,58–2,91:** smal veggstubb fram til knekken.

### Entré – nordvegg (mot gangen, x = 0), z 0 → 2,93
- **z 0–0,30:** vegg.
- **z 0,30–1,23: åpning opp til gangen**, 0,93 m bred (planen).
  - Dyp lysning, ca. 0,41 m, uten karm.
  - Lysningen er like tykk som veggen. Hele dybden er det nederste trinnet.
  - De to rette bildene (225553 utenfra, 225559 innenfra) gir vegg : åpning : vegg ≈ 0,42 : 0,93 : 0,75. Det betyr ca.
    z 0,42–1,35, altså ca. 0,1 m lenger vest enn planen. Summen (åpningen til søyla ved z ≈ 2,10–2,15) stemmer med
    planen, så planverdien er beholdt (anslått).
- **z 1,23–2,15:** glatt vegg, 0,92 m (bildene: ca. 0,75–0,8). I innerhjørnet mot søyla står en gulvvase med tørket
  pampas (pynt) (225559).
- **z 2,15–2,93:** hjørnesøyla.

### Entré – østvegg (planens topp, z = 0), x 0 → 2,50
- **Dør til rommet 3,70 × 2,84**, med lukket rom bak:
  - **Bildene:** hull inkl. karm ca. x 0,10–1,08. Karmen begynner nesten i nordøst-hjørnet (225559, 225617, og
    speilbildet i 225600/225609).
  - **Planen:** x 0,43–1,26.
  - **Kontroll i speilet (225621):** østveggen speilet gir 1,33 m fra sørøst-hjørnet til søndre karm, 1,00 m dør og
    0,17 m til nordøst-hjørnet. Det betyr ca. x 0,17–1,17.
  - **Bruk bildene**, ca. x 0,12–1,12 (midt mellom de to bildeanslagene).
  - Hengsler mot nord, håndtak mot sør. Slår inn i rommet (østover), og planen er enig.
  - Sort blad med ett innfelt felt. Sort vrider på rund rosett, nøkkelskilt under.
  - Bak døra er det oransjebrunt parkettgulv (225556, 225558). **Lukket** i spillet.
- **x ≈ 1,1–2,50:** glatt vegg med 2 lyskjegler. Stumtjeneren står i sørøst-hjørnet (225617).
- Ingen stikkontakter eller brytere er synlige.

### Entré – sørvegg (yttervegg, x = 2,50), z 0 → 2,93
- Ytterveggen er ca. 0,23 m i planen. Innvendig er hele elementet omrammet av en bred sort foring/list.
- **z 0–0,19: ingen synlig beige vegg.** Den svarte foringen/gerikten er ca. 0,15 m bred sett innenfra og går helt
  inn til sørøst-hjørnet (225617, 225619, 225556). Den dekker altså ca. z 0,04–2,34 rundt elementet.
- **z 0,19–2,19: ytterdør-element**, ca. **2,0 m** bredt (rettet i krysskontrollen, se Faste ting). Fra øst mot vest:
  - østre sidelys z 0,19–0,69
  - **dørblad z 0,69–1,69** (ca. 1,0 m)
  - vestre sidelys z 1,69–2,19
  - Planen tegner elementet 1,85 (z 0,23–2,08) med blad z 0,69–1,55. Bildets proporsjoner passer ikke med det.
- Detaljer om døra står under Faste ting.
- **z ≈ 2,40: lysbryter.** Sort, enkel og flat, ca. 8 × 8 cm. Midt h ≈ 1,0 over entrégulvet. Den sitter på den
  smale beige stripa (ca. z 2,34–2,46, ca. 0,12 m) mellom den svarte foringen og garderoben, nesten inntil
  garderoben (225619, 225621, med speilbilde i garderobedøra).
- **z 2,46–2,93:** garderobens sørende.

### Entré – vestvegg (planens bunn, z = 2,93), x 0 → 2,50
- **x 0–0,56:** søyla.
- **x 0,56–2,50:** garderobe med speilskyvedører fra gulv til tak (se Faste ting).

## Faste ting

### Ytterdøra (hovedinngangen)
- **Plassering:** entréens sørvegg. Den vender mot sør, mot elva.
- **Element:** én dør med **ett fast sidelys på hver side**, med klart glass i full høyde.
  - Rammene er sorte (aluminium, ca. #1f2022).
  - Elementet er ca. **2,0 m bredt og 2,1 m høyt** (anslått; rettet i krysskontrollen). I 225543 er bladet ca.
    2,16 ganger så høyt som det er bredt og tar ca. 48 % av elementbredden, og sidelysene er like brede. Med et vanlig
    blad på ca. 2,05 m blir bladet ca. 0,95–1,0 og elementet ca. 2,0. Planen sier 1,85; da ville bladet bare blitt
    ca. 1,9 m høyt. `ytterdor-ute.md` kom til det samme.
  - Innvendig foring går nesten opp til taket og ca. 0,15 m ut på hver side, helt inn til sørøst-hjørnet (225619,
    225617). Med 2,0 m element, 2 × 0,15 foring, 0,12 bryterstripe og 0,47 garderobe blir summen 2,89–2,93, altså
    rommets bredde.
- **Dørblad:** **glatt og helt flatt, uten glass**, matt antrasitt/sort, hvitbalansert ca. **#28292b**.
  - Ca. 1,0 × 2,05 m (anslått).
  - **Hengsler på østsiden.** Utenfra ses 3 sølvfargede hengsler på høyre kant.
  - **Slår utover** mot sør (225553, og buen i planen).
- **Lås:** sort elektronisk lås.
  - Utvendig: høyt smalt skilt med tastatur, og sort vrider.
  - Innvendig: smalt skilt med vri, og sort vrider.
  - Den sitter på vestkanten (venstre utenfra) i h ≈ 1,05 (225543, 225619).
- **Terskel:** aluminium, ca. #b8b8b4, lav.
- **Glass:** klart. Utenfra ses garderobespeilet i vestre sidelys og stumtjeneren i østre (225543).

### Trappa (sett fra GANG)
Trinntabell, rekkverk og åpningen i 1. etg står i `trapp.md`. Her er bare det som gjelder kjellergangen.

- **Type: halvsvingt trapp (U-trapp, 180°)** med vangetrinn langs nordveggen rundt et smalt trappeøye.
  - **Kjellerplanen tegner en L-trapp (kvartsving), men bildene viser U-trapp.** I 225349 ses øvre løps trinn som
    tverrliggende trinn som kommer mot kameraet over lagerplassen. Den frie vangen synker fra øvre høyre hjørne inn mot
    svingen. 225337 (fra toppen i 1. etg) viser svingen rundt øyet.
- **Nederste trinn:**
  - Forkanten er ved ca. **x 1,60**. Planens skravur slutter der, og i 225349 står den rett nord for badedørens
    nordre karm.
  - Trinnet ligger i nedre løp, inntil badveggen: ca. **z 0,91–1,83**, ca. 0,9 m bredt. Planen har z 0,81–1,72
    (den tegner badveggen i 1,72).
- **Gangretning opp:**
  1. Man går **nordover** langs badveggen (vest).
  2. Langs **nordveggen** svinger trappa 180° **mot høyre** med vangetrinn.
  3. Det **øvre løpet** går **sørover langs østveggen** i sjakta (ca. z −0,25–0,53, ca. 0,78 bredt), over
     lagerplassen. Man kommer opp i gangen i 1. etg med ansiktet mot sør. Øverste trinnkant ligger ved ca. x 1,45.
  - Det passer med trappefeltet i 1. etg: den venstre 1,54 m av gangen, i hele dybden (2,07).
  - Trappeøyet ligger mellom løpene, ca. z 0,53–0,91.
- **Trinn:**
  - Ca. **15 opptrinn à ca. 0,17** (14 inntrinn pluss gulvet oppe, etasjehøyde 2,55; `trapp.md`). Inntrinn ca.
    0,22 på de rette trinnene (anslått).
  - **Åpne trinn uten opptrinn.** Man ser gjennom mellom trinnene (225639).
  - Trinnene er heltre eik, ca. 4–5 cm tykke, hvitoljet, ca. **#c3ae9c** (litt varmere enn gulvet).
- **Vanger:** sorte (ca. #1c1c1e), ca. 25–30 cm brede plater.
  - Veggvangen går langs vest-, nord- og østveggen.
  - Innervangen på nedre løp er fri og synlig boltet.
- **Håndlist mot vegg:** sort, firkantet, ca. 4 × 5 cm, på runde sorte braketter, ca. 0,9 m over trinnforkant.
  - Den går langs **vestveggen** fra nederste trinn til hjørnet. Der har den ikke LED.
  - Derfra går den rundt NV-hjørnet, langs **nordveggen** og videre langs **østveggen** opp til 1. etg.
  - Langs nord- og østveggen har den **LED-list på undersiden**, i varmhvitt (225349, 225631, 225337).
- **Rekkverk på innsiden:** sort spilerekkverk på den frie innsiden av nedre løp og rundt trappeøyet.
  - Sort håndlist, ca. 5 × 5 cm, på sorte loddrette spiler (ca. 2 cm, c/c ca. 11 cm) festet i innervangen
    (225639, 225349).
  - Sett forfra ser rekkverket ut som en høy sort stolpe (225625, 225631).
- **Under trappa:** åpen lagerplass i nordøst-hjørnet, under den lave delen av øvre løp, ca. x 0–0,85 × z −0,25–0,55.
  - Gulv som i gangen, vegger i SAND.
  - **Tom i spillet.** Den er full av rot på bildene.
  - Døra til boden 1,64 står under den høye sørenden av øvre løp (se Østvegg).
- **Øverst:**
  - På hylla langs nordveggen (y ≈ 2,30, ca. 0,15 dyp) står en potteplante i kurv i NV-hjørnet. Det er pynt og
    valgfritt.
  - I 1. etg har trappeåpningen sort rekkverk med loddrette spiler (225256).

### Trinnene i åpningen mellom gang og entré
- Trappa har 2 opptrinn à ca. 17 cm, til sammen ca. 0,34 m (anslått).
- **Nederste opptrinn** står i flukt med entréens nordvegg.
- **Mellomtrinnet** fyller lysningen, ca. 0,41 m dypt.
- **Øverste trinnkant** står i flukt med gangens sørvegg.
- Trinnene har samme eik som gulvet, med **sort trinnkantprofil** (ca. 3 cm, #1a1a1a) på begge forkantene
  (225559, 225558, 225553).

### Garderobe (entréens vestvegg)
- Skyvedørsgarderobe fra gulv til tak, x 0,56–2,50 (ca. 1,94 m), dybde ca. 0,47 m (z 2,46–2,93, anslått).
- Søyla stikker ca. **0,3 m** lenger fram enn garderoben (225559, 225600, 225621).
- **To speildører**, ca. 0,97 m brede hver, i smale sorte aluprofiler. Sort topp-skinne i taket og sort bunnskinne.
- Innsiden er sort/mørk grå (#262626).
  - Sørenden har hylle og kleshengerstang.
  - Nordenden har en smal reol med sorte hyller.
- **I spillet:** begge dørene lukket side om side, med speilflate (225609, 225621). Innsiden er full av rot på
  bildene (225600).

### Innerdører (felles stil)
- Stilen er som `door-gang` i `room-spec.json`:
  - sort **#1d1e21**
  - glatt blad med **ett innfelt felt**
  - sort karm/list ca. 7 cm
- **Hull** ca. 0,95–1,07 × 2,15 inkl. karm, med blad ca. 0,85–0,93 × 2,05 (anslått). Sentrer hullet på planens
  dørsymbol.
- Forskjell fra 1. etg: her er det **sort vrider på rund rosett med nøkkelskilt** (225617, 225630, 225635). I 1. etg
  er det bare rosetter.
- Terskel: lys eik eller smal mørk (se vaskerom.md og kjellerstue.md).

| Dør / åpning | Vegg | Posisjon (lokal) | Hengsler | Slår | I spillet | Bilder |
|---|---|---|---|---|---|---|
| Ytterdør | Entré sør | z 0,69–1,69 (element z 0,19–2,19; planen 0,69–1,55 / 0,23–2,08) | øst | ut (sør) | fungerende dør | 225543, 225553, 225619 |
| Åpning gang ↔ entré | Gang sør / entré nord | gang z 0,86–1,79 / entré z 0,30–1,23 (bildene: ca. 0,1 lenger vest) | – | – | åpen, 2 trinn | 225553, 225559, 225558 |
| Kjellerstue | Gang vest (sørdel) | x 3,08–3,95 | nord | inn i stua | åpen/lukket | 225630, 225631, 225625 |
| Bad/vaskerom | Gang vest (trappedel) | x 1,69–2,58 | sør | inn i badet | åpen/lukket | 225349, 225631 |
| Bod 1,64 × 2,32 | Gang øst (sjaktveggen, z ≈ −0,25) | x 0,84–1,63 (i nisje, under øvre løp) | **sør** (plan) | inn i boden | **lukket**, tomt rom | 225349, 225639 |
| Grå bod 4,28 × 2,32 | Gang øst (sørenden) | x ≈ 4,60–5,55 (**ikke i planen**) | sør | inn i boden | **lukket**, tomt rom | 225635, 225625 |
| Rom 3,70 × 2,84 | Entré øst | x ≈ 0,12–1,12 (plan 0,43–1,26) | nord | inn i rommet | **lukket**, tomt rom | 225617, 225558, 225556, 225621 |
| Soverom (kjeller) | – | **ingen dør fra gang eller entré**. Planen har døra fra kjellerstua. | – | – | – | – |

### Elektrisk
- **Stikkontakter:** sorte, doble og liggende (#1c1a19 som i 1. etg).
  - Gang øst ved x ≈ 4,45.
  - Gang vest ved x ≈ 5,50.
  - Begge sitter rett over gulvlista.
  - Ingen er synlige i entréen.
- **Bryter:** én sort i entréen, på sørveggen ved z ≈ 2,38, h ≈ 1,0. Ingen brytere er synlige i gangen.

### Inngangsparti ute (startpunkt)
**Ute gjelder `ytterdor-ute.md`.** Tallene her er samkjørt med den i krysskontrollen (de gamle verdiene var ikke
hvitbalansert eller var målt før kontrollen der).
- **Overbygd nisje foran ytterdøra.**
  - **Bakveggen** er entréens sørvegg utvendig (spill-x ≈ 8,90).
  - **Østre sidevegg** er vestsida av rommet 3,70 × 2,84, ut til ca. spill-x 10,05 (planen 10,35).
  - Mot sør og sørvest er nisjen åpen. Foran til venstre står en grovpusset **lys nøytral grå pilar**, **#a8a9aa**,
    ca. 0,35 × 0,35, midt ca. spill (x 10,17; z 5,82).
- **Fasade:** stående trekledning, bord ca. 12–16 cm, mørk gråbrun beis, **#4a4642** (dagslysmålt, som `LOOK.cladding`).
- **Himling:** liggende bord i **samme beis, #4a4642**. Den ser nesten sort ut i 225543 bare fordi den er ubelyst.
  Ca. **2,35 m over terskelen**, i samme plan som entrétaket (verdens-y ca. −0,52). Undersiden av terrassen.
- **Bakke:**
  - lys blågrå skiferhelle ca. 1,5 × 0,7 (**#9da4a8**) foran døra, med mellomgrå dørmatte ca. 0,8 × 0,5 (**#7f8083**)
  - rundt: grusstripe (**#aeafb0**) og betongheller (**#a7a49e**) som danner en sti mot sør og rundt pilaren
- **Ringeknapp:** sort og rund, på kledningen ca. 0,1–0,15 m vest for dørelementet, h ≈ 1,05.
- **Liten sort boks** på pilarens østflate, h ≈ 1,4 (bryter eller sensor).
- **Startpunkt:** se `ytterdor-ute.md` og `oversikt.md`: føtter i spill (x 12,2; z 4,6) på forplassen, ca. 3,3 m fra
  døra, blikket mot døra (nord). Det gamle forslaget her (K ≈ X 10,6, Z 4,1, 1,8 m fra veggen) stod inne under
  himlingen og for nær dørslaget; døra slår **utover mot spilleren** med hengsler i øst.

## Møbler (ryddig)

### Entré
- **Stumtjener** i sørøst-hjørnet, midt ca. x 2,15, z 0,30.
  - Sort metall (#1c1c1e), rund fotplate ca. Ø 0,38, stang ca. 1,75 m med kroker øverst.
  - **Uten klær.**
- **Oval jutematte** foran ytterdøra, ca. 1,2 × 0,75 m med langsiden øst–vest, midt ca. x 1,85, z 1,10.
  Naturjute, hvitbalansert ca. #b39a7c.
- **Pynt (valgfritt):** gulvvase i rustikk grå-brun keramikk (#6e625a), Ø ca. 0,28 og h ca. 0,5, med tørket pampas og
  greiner til ca. 1,2 m (#c9b9a3). Den står i innerhjørnet ved søyla, ca. x 0,2, z 1,95 (225559, 225600).

### Gang
- **Ingen møbler.** Gangen og lagerplassen under trappa skal være tomme.
- **Pynt (valgfritt):** kunstig oliventre, ca. 1,3 m, i sort riflet potte (#262626, Ø ca. 0,3, blader #5d6b45). Det
  står i sørvest-hjørnet, ca. x 5,40, z 2,45 (225630).
- **Pynt (valgfritt):** potteplante i kurv på kanten øverst i trappa (225349).

### Ute
Samkjørt med `ytterdor-ute.md` (som gjelder ute):
- **Benk:** spilebenk uten rygg i gråbeiset, værbitt tre, **#77736c**, ca. 0,85–0,9 L × 0,35 D × 0,42–0,45 H. Den står
  vinkelrett på dørveggen vest for døra, fra ca. 0,2 m ut fra veggen til pilaren (spill x 9,1–9,95, z 5,5–5,85).
- **Potte:** én sort riflet potte (#2a2a2b) med en liten bartrebusk (#5a5a3a) øst for døra, foran østre sidelys.
- **Dørmatte** på skiferhella (se over).
- **Pynt (valgfritt):** kvistkrans på fasaden vest for døra, Ø ca. 0,5, midt h ca. 1,3 (**#5f564e**).

## Lys

Alt er varmhvitt, ca. 2700–3000 K (anslått).

- **Gang:** ca. 5 innfelte downlights, alle posisjoner anslått.
  - Armaturene har **sort/mørk grå ring**, ca. Ø 9 cm (nærbilde fra 225630). Kjellerstue.md har hvit/sølv ring der.
  - 3 sitter på rekke ca. 0,35 m fra østveggen, ved x ≈ 2,0 / 3,2 / 4,4. De lager lyskjegler på østveggen.
  - 2 sitter ca. 0,35 m fra vestveggen i søndre del, ved x ≈ 3,8 og 4,9.
  - Det er ingen egen spot over trappa.
- **Trappa:** LED-list under håndlista langs nord- og østveggen (ikke langs vestveggen). Den gir en lys stripe på
  veggen.
- **Entré:** ca. 4 downlights i et rutenett på 2 × 2, med samme armatur som i gangen (anslått).
  - x ≈ 0,9 og 1,9
  - z ≈ 0,45 (lyskjegler på østveggen) og z ≈ 2,0 (rett foran garderobespeilet)
- **Ute:** 3 downlights med lys ring i himlingen, på rekke parallelt med fasaden ca. 0,55–0,6 m ut, ca. 0,95 m mellom
  dem (spill-z ≈ 3,7 / 4,65 / 5,6, som `ytterdor-ute.md`).
- Ingen taklamper, vegglamper eller lamper som står.

## Utelatt rot

- **Entré:**
  - jakker og klær på stumtjeneren
  - sko, crocs og innleggssåler på matta og gulvet
  - langt skohorn
  - pappeske
  - veske/pose ved stumtjeneren
  - sko, kurver, luer, hjelm og poser i garderobens åpne ender
- **Gang:**
  - pakker med nye gulvbord, plastposer, ruller og sekker under trappa
  - gulvbord på lekter langs østveggen
  - laptop/lader, verktøykasse og skål
  - skjøteledninger og kabler
  - hettegensere, sokker og skjorte på gulvet
  - blå malertape på terskelen til den grå boden
- **Bodene:** malingsspann og søppelsekker i den grå boden. Den holdes lukket og tom uansett.
- **Ute:** ugress og løse småting på bakken.

## Usikkert / anslått

- **Bredden på søndre del av gangen:** planmålet 2,07 er i strid med tegningen (2,64), arealet (12,50) og
  bildene. Bruk ca. 2,64.
- **Trappedelens bredde:** 1,83 (planmål) eller 1,72 (tegning).
- **Entréens øst–vest-mål:** 2,93 (eieren og planmargen) eller 2,73 (tegningen). Bildene støtter 2,93, fordi søyla
  stikker ca. 0,3 m fram foran garderoben og foringen går helt inn til sørøst-hjørnet. Garderobedybden (0,47) og
  bryterstripa er derfor anslått ut fra 2,93. Er rommet likevel 2,73, blir garderoben bare ca. 0,27 dyp.
- **Åpningen mellom entré og gang:** planen har entré z 0,30–1,23. De to rette bildene gir ca. 0,1 m lenger vest
  (z 0,42–1,35). Planverdien er beholdt.
- **Døra til rommet 3,70 × 2,84:** bildene viser den nesten i nordøst-hjørnet, planen har x 0,43. Direkte anslag
  x ≈ 0,10, speilbildet i 225621 gir ca. 0,17. Brukt ca. x 0,12–1,12.
- **Døra til den grå boden** står ikke i planen. Posisjonen er fra bildene.
- **Nisjen ved døra til boden 1,64 × 2,32** (0,2–0,3 m) er avledet fra bildene. Planen viser rett vegg.
- **Nivåer:** nivåforskjellen mellom gang og entré (0,34 m) og alle takhøyder er anslått:
  - gang 2,25 (felles kjellerverdi; bildene 2,25–2,35)
  - entré ca. 2,35–2,40 over eget gulv
  - nedforing ca. 0,2 over åpningen på gangsida
  - himling ute ca. 2,35 over terskelen
  - verdens-y: gang −2,55, entré −2,89 (`oversikt.md`)
- **Trappa:**
  - kjellerplanen tegner L-trapp, men bildene (225349, og 225337 fra 1. etg) viser U-trapp med øvre løp sørover
    langs østveggen. Bildene er fulgt, som i `trapp.md`.
  - antall trinn (ca. 15 opptrinn à 0,18), inntrinn og løpsbreddene (ca. 0,9 / 0,78, øye ca. 0,38) er anslått
  - nederste trinn ved x 1,60 er fra planen
  - sjaktbredden på ca. 2,07 (østveggen i z ≈ −0,25 ved trappa) er avledet fra nisjen og 1. etg
- **Garderoben:** dybde (0,47) og dørbredder er anslått.
- **Dørblader:** størrelse på ytterdøra (ca. 1,0 × 2,05, element ca. 2,0; planen 1,85) og innerdørenes hull er
  anslått.
- **Hengsler:** hengselsiden for badet og boden 1,64 er tatt fra planbuene. Begge har hengslene mot sør.
- **Farger:**
  - tak (SAND eller brukket hvit). Taket er like varmt som eller varmere enn veggene i alle bildene, og det passer
    best med SAND, som i 1. etg.
  - gulvets nøyaktige hex
  - gulvlist i veggfarge
  - veggene: målt som SAND her, men både denne fila (225630) og `kjellerstue.md` ser kjellerstua som gråere enn
    gangen. Det kan være ulik maling eller bare at kjellerstua var mørk.
  - fasadekledningen er satt til husets #4a4642 (dagslysmålt), ikke kveldsbildets brunere tone
- **Elektrisk og lys:** høyden på stikkontakter og bryter, og antall og plassering av downlights.
- **Inngangspartiet:** hvor langt fasaden går vest for døra, hvor betongsøyla står og hvor dyp nisjen er (ca. 1,4 m
  fra planen).
- **225256** er tolket som 1. etg: blått soverom sett fra gangen øverst i trappa. Begrunnelsen er tidsrekkefølgen
  (først oppe, 53 s senere trappa nedenfra) og innholdet (seng). Badedøra i kjelleren ville stått på samme sted.

## Bilder

| Fil | Viser |
|---|---|
| `20261020_225256.jpg` | **1. etg:** soverommet med blå vegger og seng, sett fra gangen øverst i trappa. Sort dør slår inn med hengsler til venstre. Nede til høyre det sorte spilerekkverket rundt trappeåpningen og en sort stikkontakt. Rot på soverommet. |
| `20261020_225349.jpg` | Trappa nedenfra (blikk mot nord): nedre løp langs badveggen, vangetrinn langs nordveggen, øvre løp som kommer sørover langs østveggen over lagerplassen (U-trapp), veggmontert håndlist med LED, rekkverk med spiler, lagerplassen under trappa (rot), døra til boden 1,64 i nisjen til høyre, badedørens karm til venstre og potteplante på hylla øverst. |
| `20261020_225543.jpg` | Ute om kvelden: nisjen med ytterdør og to sidelys, tastaturlås, hengsler i øst, trekledning, himling med 3 downlights, benk, krans, ringeknapp, potte med busk, skiferhelle med dørmatte, heller og grus, betongsøyle til venstre. |
| `20261020_225553.jpg` | Ytterdøra åpen sett utenfra: bladet slått ut mot øst, jutematta, entréen, trinnene opp og gangen med trappa i enden, garderobespeil bak vestre sidelys, vase, karmen til rommet 3,70. Sko og eske er rot. |
| `20261020_225556.jpg` | Sørøst-hjørnet i entréen: stumtjener med jakker (rot), ytterdørelementets østkant og døra til rommet 3,70 på gløtt (oransjebrunt gulv). |
| `20261020_225558.jpg` | Entréen mot nordøst: døra til rommet 3,70 på gløtt, åpningen med to trinn og sorte trinnkanter, gangen og trappa langt borte. Jakke og eske er rot. |
| `20261020_225559.jpg` | Entréen mot nord: garderobe (venstre), hjørnesøyle, vase i hjørnet, åpningen med trinn, gangen og trappa, karm til rommet 3,70 (høyre). Best for bredder på nordveggen. |
| `20261020_225600.jpg` | Garderoben mot nordvest med speildørene skjøvet sammen på midten, åpne ender med hylle og stang (rot), søylas frontflate og vase. Speilet viser døra til rommet 3,70. |
| `20261020_225609.jpg` | Garderoben med begge speildørene lukket. Speilbilde av entréen: stumtjener, døra til rommet 3,70, åpningen, matta og fotografen. |
| `20261020_225617.jpg` | Østveggen: døra til rommet 3,70 lukket (innfelt felt, vrider og nøkkelskilt), stumtjener i sørøst-hjørnet, østre sidelys med potte ute. Gulvlist i nærbilde. Best for karmhøyde og takhøyde i entréen. |
| `20261020_225619.jpg` | Ytterdøra innenfra: glatt sort blad, lås og vrider på vestkanten, to sidelys, bred sort foring, aluterskel, jutematte, bryter og garderobespeil til høyre. Skohorn er rot. |
| `20261020_225621.jpg` | Garderoben fra øst med begge dørene lukket: bryteren ved dørkarmen, søyla med vase og speilbilde av østveggen og dørelementet. Best for garderobens bredde, bryterstripa, hvor langt søyla stikker fram og (i speilet) posisjonen til døra til rommet 3,70. |
| `20261020_225625.jpg` | Gangen mot nord fra åpningen: lang østvegg med downlights og lyskjegler, døra til den grå boden (kanten nede til høyre, blå tape), stikkontakt, kjellerstuedøra åpen (venstre), knekken og trappa. Mye rot. |
| `20261020_225630.jpg` | Gangens sørvest-hjørne: oliventre, dobbel stikkontakt, vestveggen med to lyskjegler og kjellerstuedøra åpen inn med hengsler i nord. Skjorte er rot. Best for downlight-ring og dørhøyde. |
| `20261020_225631.jpg` | Gangen mot nord: kjellerstuedøra (venstre, slått inn), knekken rett forfra (sørflaten av vaskerommets sørøstre hjørne), badedøra ved trappefoten, trappa og østveggen. Gulvbord, laptop og kabler er rot. Best for bredden på knekken. |
| `20261020_225635.jpg` | Gangens østvegg mot øst: 3 downlights og lyskjegler, døra til den grå boden åpen (betonggulv, malingsspann), dobbel stikkontakt ved karmen. Arbeidsbenk med gulvbord og kabler er rot. |
| `20261020_225639.jpg` | Fra siden av trappefoten mot nordøst: rekkverket med spiler, åpne trinn, undersiden av det øvre løpet, lagerplassen (rot), døra til boden 1,64 ved det utvendige hjørnet og østveggen. |

## Kontrollert

Uavhengig kontroll 2026-10-21. Alle 17 bildene, begge planene, `hele-huset-fakta.md` og nabofilene `trapp.md`,
`ytterdor-ute.md` og `kjellerstue.md` er sett gjennom. Utsnitt av planen og bildene er forstørret, og fargene er
målt i pikselverdier. EXIF viser 13 mm-ekv. ultravidvinkel, ca. 600 px brennvidde i 1600 px-kopiene. Det er brukt til
avstands- og målanslag.

Endret:

1. **Trappa er en U-trapp (180°), ikke en L-trapp (90°).**
   - Øvre løp går **sørover langs østveggen**, over lagerplassen, ikke østover langs nordveggen.
   - Svingen med vangetrinn går langs hele nordveggen.
   - Bevis: i 225349 ligger øvre løps trinn på tvers og kommer mot kameraet, og den frie vangen synker inn mot
     svingen. 225337 fra toppen viser svingen rundt øyet. `trapp.md` kom til det samme.
   - Rettet i Faste ting, Nordvegg, Lys og Bilder. Kjellerplanens L-symbol er notert som avvik.
   - Trinntallet er justert til ca. 15 opptrinn à 0,18, som i `trapp.md`.
2. **Døra til boden 1,64 × 2,32 har hengsler mot sør, ikke nord.** I planbuen sitter hengselet ved søndre karm (plan
   px x ≈ 221, y ≈ 262). Rettet i Østvegg og i dørtabellen.
3. **Entréen er 2,93 bred (øst–vest), ikke 2,71.**
   - 2,93 er eierens mål i fasitfila. Tegningen viser 2,73.
   - Bildene viser at søyla stikker ca. 0,3 m fram foran garderoben, ikke 0,1. Det er målt i 225559 (rett forfra mot
     nordveggen) og med strålegeometri i 225621. `ytterdor-ute.md` fant det samme.
   - Med 2,71 blir garderoben urimelig grunn. Garderoben er flyttet til z 2,46–2,93, søyla til z 2,15–2,93 og bryteren
     til z ≈ 2,38.
   - Det første anslaget («bare en smal stripe», 225621) stemmer fortsatt. Stripa er smal fordi den svarte foringen
     rundt elementet er bred.
4. **Sørveggen øst for dørelementet er ikke beige vegg.** Den svarte foringen/gerikten (ca. 0,15–0,2 m) går helt inn
   til sørøst-hjørnet (225617, 225619, 225556).
5. **Nisjen ved boddøra er presisert.**
   - Sjaktveggen ligger i z ≈ −0,25 og sørdelens østvegg i z = 0. Da blir sjakta ca. 2,07 bred, som i 1. etg.
   - Lagerplassen og nordveggen er utvidet tilsvarende.
   - Hylla på toppen av grunnmuren (y ≈ 2,30), der plantekurven står, er lagt inn.
6. **Plan mot bilde, nå notert:**
   - Åpningen mellom entré og gang ligger ca. 0,1 m lenger vest i bildene, med vegg : åpning : vegg ≈
     0,42 : 0,93 : 0,75 i 225553 og 225559. Planverdien er beholdt.
   - Døra til rommet 3,70 er kontrollert i speilet i 225621: x ca. 0,17–1,17. Brukt x 0,12–1,12.
   - Planen tegner gulv og dobbel veggstrek der bildene viser en massiv søyle.
7. **Farger som ikke var hvitbalansert:**
   - Fasadekledningen er endret fra #5a4f44 (for brun i kveldslyset) til husets dagslysmålte **#4a4642**, som i
     `LOOK.cladding` og `ytterdor-ute.md`.
   - Betongsøyla er endret fra #9e988e til #a9a7a1.
   - Benken er endret fra #4a4239 til #57554f. Den gamle verdien var varmere enn selve råpikslene.
8. **Mindre rettelser:**
   - «Knekken» er sørflaten av vaskerommets sørøstre hjørne, ikke badets østvegg.
   - Takhøydene er kontrollert mot karmene: gang ca. 2,25 (kjellerstue.md 2,22) og entré ca. 2,35. De opprinnelige
     verdiene (2,30 / 2,40) står fortsatt, med merknad.
   - Taket heller mot SAND.
   - Avviket mellom gangens og kjellerstuas veggfarge er notert.

Sjekket uten funn:
- Ytterdøras plassering i sørveggen, hengsler i øst, slag utover og lås på vestkanten.
- Hengsler og slag for kjellerstuedøra, badedøra og døra til rommet 3,70.
- Den grå bodens dør, som mangler i planen.
- Stikkontaktene.
- Downlights inne og ute.
- Rotlista: ingen løse ting har sneket seg inn. Stumtjeneren er tom, og vase, oliventre og plante er merket som valgfri
  pynt.
- 225256 er riktig tolket som 1. etasje.

### Krysskontroll mellom rommene (2026-10-21)

Sjekket mot `trapp.md`, `ytterdor-ute.md`, `vaskerom.md`, `kjellerstue.md`, `soverom-kjeller.md` og planene.

- **Dører fra begge sider stemmer:** vaskeromsdøra (x 1,69–2,58, hengsler i sør, slår inn) er lik i `vaskerom.md`
  (1,71–2,58). Kjellerstuedøra (x 3,08–3,95, hengsler i nord, slår inn i stua) er lik i `kjellerstue.md` (x 0,16–1,05
  fra stuas nordvegg, som ligger på gangens x 2,92). Bod-dørene og døra til rommet 3,70 × 2,84 har bare én side.
  Hengslene på boden 1,64 sitter i sør; planbuen er sjekket på nytt (`hele-huset-design.md` skriver «nord», og det er
  feil).
- **Trappas bunn stemmer** med `trapp.md`: trinn 1 på x 1,60 her = spill-x 1,73 der.
- **Rettet: koordinatene.** Kjellerplanen legges med ytterflatene i flukt med 1. etasje (+0,13 i x og z). Da står
  sjakta innenfor 3 cm av sjakta oppe, og hylla får sin dybde. Se *Retninger og koordinater*.
- **Rettet: takhøyden** i gangen 2,30 → felles **2,25**. Entrétaket 2,40 → 2,35–2,40 over eget gulv, ca. 0,2 lavere
  enn gangtaket og i samme plan som himlingen ute.
- **Rettet: høyder i verdens-y.** Gang −2,55 og entré −2,89. Trappa har 15 opptrinn à 0,17 (ikke 0,18).
- **Rettet: ytterdør-elementet** 1,85 → ca. **2,0 m** (blad ca. 1,0), etter proporsjonene i 225543, som
  `ytterdor-ute.md`. Foringen, bryterstripa (z 2,34–2,46, bryter z ≈ 2,40) og garderoben går fortsatt opp i 2,93.
- **Rettet: inngangspartiet ute** er samkjørt med `ytterdor-ute.md`: pilarens plass og farge, himlingens farge
  (#4a4642) og høyde, skifer/matte/grus/heller, benkens farge og plass, én potte, kransens farge og downlightene.
  Startpunktet er flyttet til det kontrollerte i `ytterdor-ute.md`.
