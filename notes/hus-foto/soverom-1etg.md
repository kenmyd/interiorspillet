# Soverom 1. etasje – fra bildene

Kilde: 7 bilder i `bilder_hus/_1600/Soverom 1etg/` (Samsung ultravidvinkel, 13 mm ekv., f ≈ 601 px på 1600 px-bildene),
`plantegning.png` og `notes/hele-huset-fakta.md`. Orientering som planen: øst = plan topp (mot gang/entré),
sør = plan høyre (mot stua), vest = plan bunn (mot TV-stua), nord = plan venstre (yttervegg).
Spillkoordinater som i `src/data/room-spec.json` (+x = sør, +z = vest, origo i planens øverste venstre innerhjørne).

Fargene er hvitbalansert: rommet har en kald, hvit taklampe pluss varmt LED-lys fra garderoben og fra gangen.
Korreksjonen er kalibrert mot gulvet (samme eik som i stua, #a59b8f) og gangveggen (ser ut som SAND):
rå bildeverdier ganget med ca. G × 1,08 og B × 1,20.
Kontroll: de hvite linjene i dyna, som er lyst av taklampa, gir G × 1,08 og B × 1,16, så korreksjonen holder.

## Rommet

- **Mål (plan):** 3,11 m nord–sør × 3,69 m øst–vest ≈ 11,5 m². Fotoene stemmer med planen.
- **Plassering i spillet (anslått):** x 0 → 3,12, z 4,51 → 8,20.
  - x = 3,12 er innsiden av `w-hoy`: stuesiden ligger på x 3,22, og veggen er 0,10 tykk.
  - z = 8,20 er innsiden av `w-sov-tv`: TV-stuesiden ligger på z 8,34, og veggen er 0,14 tykk.
  - z = 4,51 er lest av planen (51,3 px/m). Veggen mot gangen er ca. 0,10 m (anslått).
- **Takhøyde: 2,40 m, flatt tak** (anslått). I 225304 ser østveggen nesten rett forfra. Der ligger skjøten mellom tak og vegg ca. 2,40 m over gulvet, og toppen av dørkarmen ca. 2,11–2,13 m.
  Garderoben går helt opp til taket. Stuesiden av sørveggen er 3,0 m høy (`w-hoy`), men soverommet har lavere tak.
  - Kontroll med kameramodell (225304 og 225308, telefonen er vippet ca. 10–15° ned) gir 2,33–2,40 m. Eieren har oppgitt 2,4 for de flate takene, så 2,40 beholdes.
- **Taket er malt i samme mørke farge som veggene** (rommet er helmalt). Rett ved lampa er taket like blågrått og like mørkt som veggene, både i 225259 og 225316. Gangtaket er derimot lyst (225324).
- **Gulv:** samme lyse, gråvaskede eikeparkett som i stua (`oak-plank` #a59b8f, bord ca. 22 cm). Bordene går øst–vest (langs z), og det ses i 225304, der skjøtene peker mot døra. Gulvet fortsetter likt inn i gangen.
- **Gulvlist:** lys, ca. 7 cm, langs alle vegger. Trolig **lys eik i gulvfargen, ca. #ada291** (anslått), ikke hvit som i stua (#e9e6df).
  - I 225304 har lista samme fargetone som gulvet (rå R:G:B 1 : 0,81 : 0,67 mot gulvets 1 : 0,81 : 0,65) og er bare litt lysere.
  - En hvit list ville vært mye mindre gul i samme lys; de hvite linjene i dyna er 1 : 0,93 : 0,86.
- **Terskel:** smal terskel i mørk grå/sort metall (#2b2b2d) i døråpningen. Den er ikke lys som ved `door-gang` (225304).

## Vegger

Alle vegger (og taket) har samme farge: **mørk blågrå skifer, #50575c** (anslått, hvitbalansert, matt). Fargekoden er ukjent.
På de rå kveldsbildene ser fargen grågrønn ut, men korrigert er den nøytralt blågrå (R:G:B ≈ 1 : 1,06 : 1,13).

### Nordvegg (plan venstre) – yttervegg, x = 0, z 4,51 → 8,20, 3,69 m

- **Vindu:** ett kvadratisk vindu, ca. **1,17 m bredt × 1,17 m høyt** (anslått).
  - Plassering: hullet går fra **1,60 til 2,77 m fra østhjørnet** (z ≈ 6,11 → 7,28). Brystning ca. **0,92 m**, overkant ca. **2,09 m** (anslått), omtrent i høyde med dørtoppen.
    - Planen viser vinduet på ca. 1,60–2,79 m fra østhjørnet og 1,17–1,19 m bredt (målt i piksler).
    - Perspektivberegning på 225307 ga 1,57–2,68 m (1,11 m bredt), altså litt lenger øst og litt smalere.
    - I 225307 er telefonen vippet ca. 16° ned. Korrigert for det er hullet like høyt som det er bredt (høyde/bredde ≈ 1,02).
    - Avstanden ned fra taket (2,40) gir da brystning 0,90–0,98 og overkant 2,07–2,10.
  - Dyp smyg (ca. 0,20 m, som stuevinduene) i veggfargen, uten gerikt. Nedre smyg/vinduspost er også i veggfargen.
  - Selve vinduskarmen er skjult bak gardinen.
  - Mørk grå/sort **mørkleggingsrullegardin** (#2a2b2d) er montert øverst inne i smygen og trukket helt ned. Den har hvit trekksnor (#e8e8e6) på østsiden, ned til ca. 2/3 av vindushøyden (225307).
- Garderobens nordside står inntil veggen fra østhjørnet og 0,60 m vestover.
- Ingen stikkontakter, brytere eller radiator/panelovn. I 225307 ses veggen under vinduet ned til ca. 0,3 m over gulv.
- I nordvesthjørnet står det et brannslukningsapparat på gulvet (utelatt, se nedenfor).

### Østvegg (plan topp) – mot gang/entré, z = 4,51, x 0 → 3,12

Fra nord mot sør:

- **0 → 1,88 m: garderobe** fra gulv til tak (se Faste ting).
  - Planen tegner den 2,00 × 0,60 m (102 × 31 px). Fotoene gir ca. 1,88 m (1,80–1,90): tre vanlige dører à ca. 0,53 m og én smal speildør à ca. 0,28 m (anslått).
- **1,88 → 2,11 m: ca. 0,23 m synlig vegg** (225304, 225308).
- **Bryter:** sort, kvadratisk (ca. 8,5 × 8,5 cm, #151515, som bryterne i stua). Senter ca. **2,04 m fra nordhjørnet**, ca. 6 cm nord for karmen, senterhøyde **ca. 1,15 m** (anslått 1,10–1,19; 225304, 225308, 225324).
  - Med telefonen vippet ca. 10–15° ned blir det 1,10–1,19, ikke 1,07 som en rett proporsjon mot karmen gir.
  - Det stemmer med bryterne i stua (y ≈ 1,18–1,20).
- **2,11 → 3,06 m: dør til gang/entré** (225304, 225308, 225316, 225324):
  - Hull (ytterkant av synlig karm) ca. **0,95 m × 2,12 m** (anslått; 9M-dør). Karm og gerikt (0,07) ligger innenfor hullet, så fri åpning blir ca. 0,81 × 2,05.
    - Planen har hullet på ca. 2,13–3,03 m (0,88–0,90 m, piksel 200–245) med 0,10 m vegg mot sørhjørnet. Dørbladet er tegnet ca. 0,72 m.
    - På fotoene står karmen nesten helt inne i sørhjørnet (ca. 5 cm vegg).
  - Karm og gerikt er sort som i stua: `#1d1e21`, gerikt ca. 7 cm, som `door-gang`.
  - Dørblad sort #1d1e21, ca. 0,84 × 2,04 m (anslått; samme forhold mellom hull og blad som `door-gang`, 1,07/0,93), samme stil som `door-gang`: glatt blad med ett innfelt felt (fresespor ca. 11 cm inn). Feltet ses tydelig i 225316.
  - **Hengsler på sørsiden. Døra slår inn i soverommet** og legger seg mot sørveggen når den står helt åpen (225316).
    - I 225304/225308 står den ca. 60° åpen.
    - Det stemmer med planens dørbue.
  - Vrider i sort/mørk metall med rund rosett på begge sider, senterhøyde ca. 1,05 m. Forstykket på dørkanten er i blank stål (225308).
  - Sort terskel, se Rommet.

### Sørvegg (plan høyre) – mot stua (baksiden av `w-hoy`), x = 3,12, z 4,51 → 8,20

- **Dørstopper:** liten rund veggstopper (mørk), ca. **0,85 m fra østhjørnet**, høyde ca. 1,0 m. Det er der vrideren treffer når døra står helt åpen (225304, 225308).
- **Knaggrekke:** sort/mørk grå metallskinne med 5 knagger, ca. 0,50 m lang. Den sitter ca. **1,0–1,5 m fra østhjørnet**, rett vest for det åpne dørbladet, med senterhøyde ca. **1,60 m** (anslått 1,50–1,70; 225259, 225304, 225316). Henger tom (jakken er utelatt).
- Ingen stikkontakter synlige. Den vestlige delen bak nattbordet ses dårlig.
- Ingen vinduer og ingen radiator.

### Vestvegg (plan bunn) – hodeveggen, mot TV-stua (baksiden av `w-sov-tv`), z = 8,20, x 0 → 3,12

- Hodeenden av senga står rett mot veggen. Det er ingen sengegavl.
- **To runde uttak:** lys ring (#d8d8d4) med mørkt hull i midten, Ø ca. 6–7 cm. Trolig kabelutløp/lampepunkt for sengelamper; det er ingen lamper montert.
  - De sitter ca. **0,50 m fra nordhjørnet og 0,50 m fra sørhjørnet** (x ≈ 0,50 og 2,60).
  - Høyde ca. **0,90 m** (anslått 0,85–0,97), ca. 0,2 m over madrassen (225259, 225307, 225316). Målt mellom gulv- og takskjøten på hodeveggen i 225259.
- **Lav stikkontakt (mulig):** sort, liggende dobbel, ca. 15 × 8 cm, ca. 0,18 m over gulvet, ved x ≈ 0,55. Den står delvis bak nordkanten av senga (225316).
  - I et forsterket utsnitt er den bare en mørk flekk i skyggen bak senga, så det kan like gjerne være skygge.
- Nattbordet står i sørvesthjørnet (se Møbler).

## Faste ting

- **Garderobe** i nordøsthjørnet, fra gulv til tak:
  - Mål og plassering: ca. **1,88 b × 0,60 d × 2,40 h**, x 0 → 1,88, z 4,51 → 5,11. Fronten vender mot vest (+z).
  - Fronter: matt nøytral mørk grå/antrasitt **#545656** (anslått, hvitbalansert), like mørk som veggene, men uten blåtonen. Sidepanelet har samme farge.
    - Korrigert (G × 1,08, B × 1,16–1,20) blir frontene R:G:B ≈ 1 : 1,04 : 1,03. #555350 fra førsteutkastet hadde fortsatt et varmt stikk.
  - Fire fronter fra nord til sør:
    1. Glatt dør, ca. 0,53 m.
    2. Glatt dør, ca. 0,53 m.
    3. Smal dør, ca. 0,28 m, med et høyt **speilfelt** (ca. 0,25 m bredt) i tynn aluminiumsramme (#b8bcbf). Speilet går fra ca. 0,65 m over gulvet til rett under toppen, ca. 2,35 m. Under speilet er døra glatt.
    4. Glatt dør, ca. 0,53 m.
  - **Tre stanggrep** i sort/mørk metall (#2a2a2a), ca. 0,32 m lange og loddrette, senterhøyde ca. 1,05 m. De sitter ved skjøtene 1/2, 2/3 og 3/4 (225304, 225307, 225308).
  - **LED-list** langs hele toppen av fronten (se Lys).
- **Mørkleggingsrullegardin** i vinduet (se Nordvegg).
- **Knaggrekke** og **dørstopper** på sørveggen.
- **Sort bryter** på østveggen, **to runde uttak** og kanskje en **lav sort stikkontakt** på vestveggen.
- **Taklampe** (se Lys).
- Ingen radiator, panelovn, varmepumpe eller røykvarsler synlig.

## Møbler (ryddig)

- **Seng (kontinental), 180 × 200 cm**:
  - Plassering: hodeenden mot vestveggen, midt i rommet nord–sør, x 0,65 → 2,45, z 6,20 → 8,20. Fotenden vender mot øst.
    - Planen tegner senga ca. 1,78 × 1,97 m, 0,66 m fra nordveggen. Fotoene viser ca. 0,65 m klaring på begge sider.
  - Avstand til garderobefronten: ca. 1,1 m fri gulvflate mellom fotenden og fronten (z 5,11 → 6,20).
  - Bunn og madrass: overtrukket bunn i lys beige/greige stoff (#c8b9a6) på korte, lyse treben (ca. 10 cm, #c4a583).
  - Høyde: madrassoverkant ca. **0,70 m** (anslått 0,62–0,77; målt på hodeveggen i 225259). Det er en høy kontinentalseng med overmadrass. Ingen sengegavl.
  - Sengetøy, ryddig oppredd:
    - Laken i lys beige (#dbcdbb, hvitbalansert mot de hvite linjene i dyna).
    - Dyne med mørk grå trekk (#4b4c4f) og et mønster av hvite linjer som danner store blader (#e9e7e2), lagt flatt.
    - To puter i samme trekk eller lyse.
- **Nattbord, ett stk.:** lite, sort (#1e1e1f) boksformet bord i sørvesthjørnet mellom senga og sørveggen, inntil hodeveggen.
  - Ca. 0,35 b × 0,38 d × **0,55 h** (anslått), senter x ≈ 2,78, z ≈ 8,01 (225259, 225316).
  - Fronten har en skuff eller et åpent rom i nedre halvdel (225259). Toppen står ca. 0,15 m under madrassen.
  - Planen tegner nattbord på begge sider, men på nordsiden står det ikke noe (bare brannslukkeren).
- Ingen bilder, speil (utenom garderobespeilet), hyller, stoler eller tepper på veggene eller gulvet.

## Lys

- **Taklampe:** rund, flat plafond med hvit opal diffuser (#f2f2f0) og lys kant, Ø ca. 0,40 m, høyde ca. 7 cm (anslått). Lyset siver ut rundt kanten og gir en glorie på taket, og ser ut som samme modell som i gangen.
  - Lyset er kaldt/nøytralt hvitt, ca. 4000 K (anslått): glorien på det mørke taket ser blåhvit ut.
  - Plassering ca. midt i rommet, x ≈ 1,50, z ≈ 6,40 (anslått fra 225259 og 225304).
- **LED-list over garderoben:** varmhvit, ca. 2700–3000 K, langs hele frontbredden (ca. 1,88 m) helt oppe ved taket. Den lyser ned over dørene.
  - Uklart om lista sitter i garderobens topplist eller i taket rett foran.
- **Små takpunkt:** to små mørke, innfelte punkter, Ø ca. 5 cm, ikke tent. Trolig små downlights/spotter av samme type som i gangtaket, men kan også være tomme lampepunkt.
  - A: ca. x 2,6, z 4,8 (225304, 225308). Det sitter rett innenfor døra, ca. 0,2–0,35 m fra østveggen, midt over døråpningen. Begge bildene gir samme plassering.
  - B: ca. x 1,1, z 6,7 (225316).
- Ingen vegg- eller nattbordlamper.

## Utelatt rot

- Tørkestativ med klær (mellom fotenden og garderoben, og ved senga).
- Klær, sokker og en svart genser på gulvet.
- Jakke på knaggrekka.
- Rotete dyne og laken (senga legges pent opp).
- Flaske på nattbordet.
- Klær som speiler seg i garderobespeilet.
- Et par tynne, løse ledninger som henger øverst i vestre hjørne av vindussmygen (225307).
- **Brannslukningsapparat** (rødt pulverapparat, ca. 6 kg) på gulvet i nordvesthjørnet ved hodeveggen. Det er en løs gjenstand, men kan tas med som detalj om ønskelig.
- I gangen (225304, 225324, 225327): hvit plastpose og sort søppelbøtte på gulvet, og en jakke over trapperekkverket.

## Usikkert / anslått

- Alle mål utenom romstørrelsen er anslått ut fra fotoene (perspektivberegninger med f ≈ 601 px og døra som målestokk). De bør kontrolleres med båndmål.
- **Vinduet:** bredde 1,11–1,19 m, høyde 1,10–1,20 m og brystning 0,90–1,00 m. Det er nesten kvadratisk. Fotoene plasserer det 0–10 cm lenger øst enn planen.
- **Garderobebredden:** 1,80–1,90 fra fotoene mot 2,00 i planen. Hvis 2,00 brukes, krymper veggstykket ved bryteren til ca. 0,13 m.
- **Dørhullet:** 0,95 fra fotoene mot 0,88–0,90 i planen. Posisjonen er 2,11–3,06 m fra nordhjørnet; planen sier 2,13–3,03.
- **Takhøyden:** 2,33–2,40 m. Det mørke taket gjør skjøten vanskelig å se.
- **Høyder på veggen** er regnet med kameramodell (telefonen vippet 10–16° ned):
  - bryter 1,10–1,19
  - knaggrekke 1,50–1,70
  - runde uttak 0,85–0,97
  - madrass 0,62–0,77
  - nattbord 0,45–0,60
- **Veggfargen #50575c:** både lysstyrken og blåtonen er usikre, siden rommet bare er lyst av taklampa. Veggen kan være litt lysere (opp mot ca. #5a6064).
- **Gulvlisten:** trolig lys eik (se Rommet), men hvit kan ikke helt utelukkes.
- **Takpunkt A:** plasseringen er grei. Funksjonen er uklar (spot eller lampepunkt), og det samme gjelder B, som også har usikker plassering.
- **Tynn mørk strek i taket** foran midten av garderoben (ca. 0,5 m lang, 225304 og 225308): skjøt, sprekk eller kabel. Den er ikke tatt med.
- **Den lave stikkontakten** på vestveggen kan være en skygge. Det er ukjent om det finnes en tilsvarende bak nattbordet.
- **Nederste ca. 0,35 m av nordveggen** bak senga og hjørnet bak tørkestativet er ikke synlige. En lav panelovn kan ikke helt utelukkes.
- **Taklampas plassering:** midten av rommet, ± 0,3 m.
- **Garderoben:** fordelingen av fronter og grep, og om LED-lista sitter i taket eller på garderoben.

## Bilder

- `20261020_225259.jpg`: tatt fra fotenden (foran garderoben), mot vest/hodeveggen.
  - Viser senga uten gavl, det sorte nattbordet i sørvesthjørnet og de to runde uttakene på hodeveggen.
  - Viser også knaggrekka med jakke på sørveggen (venstre) og taklampa.
  - Rot: klær på gulvet og tørkestativ i høyre kant.
- `20261020_225304.jpg` (stående): tatt fra sørsiden av senga, mot øst.
  - Viser garderoben (fire fronter, speilfelt, tre grep, LED-list), veggstykket med sort bryter og den sorte døra ca. 60° åpen inn mot sørveggen.
  - Viser også sort terskel, dørstopperen og knaggrekka på sørveggen, og takpunkt A.
  - Gjennom døra: gangen med baderomsdøra.
- `20261020_225307.jpg`: tatt fra sørsiden, mot nord.
  - Viser vinduet med mørkleggingsgardin og hvit snor, dyp smyg uten gerikt, garderoben i nordøsthjørnet (sett på skrå) og et rundt uttak på hodeveggen (venstre).
  - Toppen av brannslukkeren ses ved nordvesthjørnet.
  - Rot: dyne og tørkestativ.
- `20261020_225308.jpg`: samme retning som 225304, men bredere.
  - Vindussmygen ses i venstre kant (nordveggen). Viser garderoben, bryteren, døra ca. 60° åpen med vrider og forstykke, dørstopperen og knaggrekka.
- `20261020_225316.jpg`: tatt fra garderobens speildør, mot sørvest.
  - Viser døra helt åpen mot sørveggen (innfelt felt og vrider på gangsiden), knaggrekka, senga, nattbordet og de runde uttakene.
  - Viser også den mulige lave sorte stikkontakten, brannslukkeren, taklampa og takpunkt B.
  - Nederst til venstre: garderobens speilramme og grep.
- `20261020_225324.jpg`: tatt fra soveromsdøra, ut i gangen mot øst. Til nytte for gang- og badnotatet:
  - Til venstre: trapperekkverk med sorte firkantede spiler og sort håndlist på veggen. Rett fram: baderomsdøra, sort og åpen inn mot badet.
  - Til høyre: døra til stua, med kjøkkenet synlig bak.
  - Gangen har kremhvite vegger og tak, rund plafond, et lite innfelt takpunkt og samme eikegulv.
  - Soveromsbryteren ses til venstre i forgrunnen.
- `20261020_225327.jpg` (stående): samme som 225324, mer av gangtaket.
  - Badet ses gjennom døra: mørke grå gulvfliser, høyt sort skap med åpne hyller, rundt speil med baklys og vegghengt sort servantskap med hvit vask.
  - Mappa `Bad 1etg` er tom, men badet er fotografert innenfra i 225413–225429 i mappa `vaskerom/` (se `bad-1etg.md`).

## Kontrollert

Uavhengig kontroll (2026-10-21) mot alle 7 bildene, `plantegning.png` (pikselmålt, 51,3 px/m), kjellerplanen og `room-spec.json`.
Kameramodell: f ≈ 601 px. Kamerastillingen er tilpasset dørkarmen i 225304 og 225308, og hvitbalansen er sjekket mot de hvite linjene i dyna.

**Stemmer (uendret):**
- Orientering og vegger: vindu i nordveggen (yttervegg), garderobe i nordøsthjørnet, døra helt i sør på østveggen med hengsler i sør og slag inn mot sørveggen, knaggrekke på sørveggen, hodeende mot vest.
- Romstørrelse og koordinater: x 0 → 3,12 og z 4,51 → 8,20. Veggen mot gangen er 0,10 m (5 px) og veggen mot TV-stua 0,14 m.
- Taket er malt mørkt, og veggfargen #50575c er hvitbalansert. Dørstopperen sitter på ca. 1,0 m. Taklampas plassering og rotlista stemmer.

**Rettet:**
- **Plantall:**
  - Garderoben er 2,00 m i planen, ikke 2,04.
  - Dørhullet er 2,13–3,03 i planen, ikke 2,17–3,07.
  - Vinduet er 1,60–2,79 i planen, ikke 1,62–2,81.
- **Vindu:** 1,15 × 1,10, brystning 0,95 → **1,17 × 1,17, brystning 0,92, overkant 2,09**. I 225307 er telefonen vippet ca. 16° ned. Korrigert for det er hullet like høyt som det er bredt.
- **Bryter:** 1,07 → **ca. 1,15**. Tallet 1,07 kom fra en rett proporsjon i et bilde der telefonen er vippet ned. To bilder gir 1,10–1,19, og det passer med stuebryterne på ca. 1,18–1,20.
- **Knaggrekke:** 1,70 → **ca. 1,60**. Kameramodellen gir 1,52–1,65 i 225304 og 225308, og 225316 gir ca. 1,63. Plasseringen 1,0–1,5 m fra østhjørnet stemmer.
- **Runde uttak:** 0,75 → **ca. 0,90**. Madrass 0,62 → **ca. 0,70**. Nattbord 0,45 → **ca. 0,55** høyt. Alle er målt på hodeveggen mellom gulv- og takskjøten i 225259. Uttakene sitter ca. 0,2 m over madrassen, ikke rett over den. Nattbordet har en skuff eller et åpent rom i fronten.
- **Takpunkt A:** (x 2,4, z 5,8) → **(x 2,6, z 4,8)**. To bilder plasserer det samstemt rett innenfor døra, ca. 0,2–0,35 m fra østveggen. 225259 og 225316 viser ingenting på z 5,8.
- **Dørblad:** 0,86 → **0,84** og fri åpning 0,84 → **0,81**. Med hull 0,95 og karm 0,07 innenfor hullet går ikke 0,84 fri åpning opp. Bladet følger samme forhold som `door-gang`.
- **Farger:**
  - Garderoben #555350 hadde fortsatt et varmt stikk. Hvitbalansert er den nøytral, **#545656**.
  - Lakenet #ddd3c6 → **#dbcdbb**, med samme korreksjon som resten.
  - Gulvlista: fargetonen er lik gulvets, så den er trolig **lys eik #ada291**, ikke hvit.
- **Avstand fotende–garderobe:** 1,05 → 1,1 m, som stemmer med koordinatene.
- **Lav stikkontakt:** nedgradert fra «sannsynlig» til «mulig», fordi forsterket utsnitt bare viser en mørk flekk i skyggen.
- **Lagt til:** løse ledninger i vindussmygen under utelatt rot. Under usikkert: den tynne streken i taket og den skjulte nederste delen av nordveggen.

### Krysskontroll mellom rommene (2026-10-21)

Sjekket mot `gang-1etg.md`, `bad-1etg.md` og `trapp.md`.

- **Døra mot gangen stemmer fra begge sider:** x 2,11–3,06, hengsler i sør, slår inn i soverommet og legger seg mot
  sørveggen. `gang-1etg.md` har det samme. Bryteren sitter på soveromssida (x ≈ 2,04, h 1,15); gangsida har ingen.
- **Veggen mot gangen:** gangflate z 4,40 (`gang-1etg.md`) og soveromsflate z 4,51 gir en vegg på 0,11. Designplanen
  legger den på z 4,43–4,53 (3 cm vestligere) for å passe `door-gang`. Det påvirker ikke noe her.
- **Rettet:** 225327 er ikke det eneste bildet av badet. Badet er fotografert innenfra i 225413–225429 (mappa
  `vaskerom/`), og det rundt speilet og servantskapet som ses her, stemmer med de bildene.
- **Takhøyden** 2,40 er felles for de flate takene i 1. etasje (gang, bad og soverom). Ingen endring.
- Rommet ligger omtrent over kjellerens vaskerom (spill-z ca. 4,5–8,6); ingenting her avhenger av kjelleren.
