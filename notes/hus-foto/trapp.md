# Trappa mellom gang 1. etasje og GANG i kjelleren – fra bildene

Kilder:
- `notes/hele-huset-fakta.md` (fasit), `plantegning.png`, `bilder_hus/_1600/plantegning_kjeller.png`.
- `src/data/room-spec.json` (gulv `oak-plank` #a59b8f, SAND #cfc5b4, sort karm #1d1e21 fra `door-gang`).
- Alle 7 bildene i `_1600/gang 1etg/` og alle 17 i `_1600/Entre og gang kjeller/`. Utsnitt er forstørret fra originalene.
- Kryssjekket mot `notes/hus-foto/gang-1etg.md`, som har rekkverket og åpningen sett fra gangen. Tallene for rekkverk og
  åpning er samordnet med det notatet.

**Orientering som planene:** nord = plan venstre, øst = plan topp (kjøkkenenden), sør = plan høyre (elva) og
vest = plan bunn.

**Koordinater i spillets akser** (`room-spec.json`):
- x = meter sørover fra innsiden av nordveggen i 1. etasje.
- z = meter vestover fra innsiden av østveggen.
- Gangen i 1. etasje er x 0–3,11, z 2,32–4,40.
- **Høyder (y) er meter over kjellergulvet i GANG**, der ikke annet står. Gulvet i 1. etasje ligger på y ≈ 2,55
  (anslått modellverdi, se `oversikt.md`). I spillets verdens-y (1. etasje = 0) ligger kjellergulvet altså på −2,55.
- Kjellerens nordvegg står på x ≈ 0,13–0,15 i denne rammen. Kjellerplanen er lagt med ytterflatene i flukt med
  1. etasje, og da blir spillets x = kjellerplanens X + 0,13 og z = Z + 0,13 (som `ytterdor-ute.md`).

## Kort svar

- **Type:** halvsvingt trapp (U-trapp, 180°) med vangetrinn (vridde trinn) i svingen og uten repos.
  - Opptrinnene er **åpne**, uten setteplater. Man ser gjennom trappa (225349, 225631).
  - Vangene er sorte og inntrinnene er lys eik.
- **Gangretning opp:**
  1. Start i nordenden av GANG i kjelleren og gå **nordover langs vestveggen** (plan bunn).
  2. Sving **mot høyre** (med klokka sett ovenfra) rundt nordveggen (plan venstre).
  3. Gå **sørover langs østveggen** (plan topp).
  - Man kommer opp i gangen i 1. etasje med ansiktet mot sør og baddøra rett til venstre.
- **Trinn:** **14 inntrinn pluss gulvet oppe, altså 15 opptrinn** (telt i bildene, ±1).
  - Opptrinnet er ca. **0,17 m** (anslått: 2,55 m / 15).
  - Inntrinnet er ca. 0,22–0,23 m på de rette trinnene og ca. 0,19 m i ganglinja gjennom svingen (anslått).
- **Bredde:**
  - Nedre løp ca. **0,92 m** (z 3,48–4,40).
  - Øvre løp ca. **0,78 m** (z 2,32–3,10).
  - Mellom løpene er det et smalt trappeøye på ca. 0,38 m.
  - Trappa fyller hele dybden av gangen, 2,07 m.
- **Åpningen i gulvet i 1. etasje er trappeformet, ikke et rektangel:**
  - x 0–1,47/1,50 over z 2,32–3,48.
  - x 0–1,85 over z 3,48–4,40.
- **Fri høyde:** hele trappa ligger inne i åpningen, så over trinnene er det fritt opp til taket i 1. etasje
  (y ≈ 4,95). Det minste er over øverste trinn: ca. 2,57 m.

## Rommet (trappesjakta)

**Fotavtrykk:**
- **I 1. etasje:** nordenden av gangen, x 0 → 1,47–1,85 og z 2,32–4,40. Se «Åpningen i 1. etasje».
- **I kjelleren:** nordenden av den smale delen av GANG.
  - Nordveggen står her ca. **0,15 m lenger sør (x ≈ 0,15)** enn nordveggen oppe. Toppen av dette fremspringet er
    hylla langs nordveggen. Det stemmer med planene: kjellerplanen tegner nordveggen ca. 0,28 tykk, 1. etasje ca.
    0,16, med samme ytterflate.
  - Trinn 1 har forkant **1,58 m fra kjellerens nordvegg** (planen), altså x ≈ 1,73.
  - Sjakta er 2,07 m bred (z 2,32–4,40). **Sør for døra under trappa stikker østveggen ca. 0,2–0,3 m lenger inn i
    GANG** (utvendig hjørne ved x ≈ 1,8–1,9, anslått). Der er GANG bare ca. 1,8 m bred, som planens 1,83. Se Østvegg.
- Innenfor sjakta (x < ca. 1,8) går vest- og østveggen i samme plan hele veien fra kjellergulvet til taket i 1. etasje.
  - Vangen og håndlista følger dem uten sprang (225337, 225339, 225342, 225349, 225639).
  - Bare nordveggen har et sprang (hylla).

**Høyder:**
- **Etasjehøyde (gulv til gulv): ca. 2,55 m** (anslått modellverdi, ikke målt; mulig spenn 2,50–2,65).
  - Den er satt som kjellertak + etasjeskille: **2,25 + 0,30**.
  - Kjellertaket er anslått i fem rom: kjellerstue 2,22 (kontroll 2,25), soverom 2,25, vaskerom 2,23–2,30, GANG
    2,25–2,35 (225635). Felles modellverdi **2,25** (`oversikt.md`).
  - 225617 er tatt i entréen, som ligger ca. 0,34 m lavere enn GANG. Den egner seg ikke til å lese takhøyden i GANG.
  - Etasjeskillet er ca. 0,25–0,35 m. Kantflata i åpningen ses i 225342 og 225349. Modellverdi 0,30.
  - Kontroll: hylla (toppen av grunnmuren, y ≈ 2,25–2,30) ligger da like under etasjeskillet, slik den skal. Med den
    gamle verdien 2,70 ville den ligget 0,4 m under gulvet oppe, og det passet ikke med bildene ovenfra.
- **Tak over trappa:** taket i gangen i 1. etasje, flatt, 2,40 m over gulvet der (anslått, se `gang-1etg.md`), altså
  y ≈ 4,95. Det er lyst, hvitt (#ecebe8) eller SAND (anslått).
  - I 225331 ser taket mer nøytralt ut enn veggene, så hvitt er mest sannsynlig.
  - `gang-1etg.md` foreslår SAND som i stua. Bruk samme tak som gangen.
  - I kjelleren slutter kjellertaket ved åpningskanten. Kanten har et tydelig hakk (se «Åpningen i 1. etasje»).

**Gulv:** trappa har ikke eget gulv.
- Oppe slutter gangens eikegulv (#a59b8f) i en lys trappeneselist langs øverste trinnkant (225337).
- Nede står trinn 1 rett på kjellergulvet i GANG.

## Vegger

**Felles:** malt glatt flate i samme farge som gangene, trolig **SAND #cfc5b4** (anslått, som i `gang-1etg.md`).
- Hvitbalansert ser veggene i sjakta like ut i alle bildene, både oppe og nede.
- Ingen radiatorer og ingen vinduer i sjakta.

### Nordvegg (plan venstre) – yttervegg, hele sjaktas bredde z 2,32 → 4,40

- **Over hylla (y > 2,28):** flaten ligger i x = 0 (ytterveggen i 1. etasje).
- **Hylle/avsats** langs hele veggen fra NV- til NØ-hjørnet:
  - Topp ca. **y 2,28** (2,25–2,30), det vil si ca. 0,27 m under gulvet i 1. etasje, i høyde med kjellertaket.
  - Kontroll i 225349: hyllekanten ligger ca. 0,25–0,3 m over håndlista i NV-hjørnet (håndlista ca. y 2,0 der).
    Det gir y ≈ 2,25–2,30.
  - Dybde ca. **0,15 m**. Kurven (Ø ca. 16 cm) får akkurat plass.
  - Malt som veggen.
  - Under hylla står veggen i x ≈ 0,15 (grunnmuren) helt ned til kjellergulvet.
  - Bilder: 225349, 225631 og 225625 (nedenfra), 225331, 225335, 225337 og 225339 (ovenfra).
  - `gang-1etg.md` anslo toppen til 0–0,2 m under gulvet oppe. Med etasjehøyde 2,55 blir det ca. 0,27 m, og de to
    anslagene møtes (samkjørt i krysskontrollen).
- **Stikkontakt eller bryter, sort, enkel, ca. 8 × 8 cm**, på flaten x = 0 like over hylla.
  - Senter ca. 0,10 m fra vestveggen, det vil si z ≈ 4,30 og y ≈ 2,36.
  - Den står delvis bak plantekurven (225349, 225331).
- Vangen ligger langs foten av veggen (under hylla), og håndlista går langs den (se Faste ting).
- Ingen dør og ingen vindu.

### Østvegg (plan topp, z = 2,32) – mot badet oppe og rommet 1,64 × 2,32 nede

- Vangen til øvre løp ligger langs veggen, med håndlist og LED over (225331, 225333, 225337).
- **Håndlista slutter oppe ved x ≈ 1,40**, ca. **0,6–0,7 m over gulvet i 1. etasje** (målt mot baddøras karm i
  225333, 225324 og 225327, som `gang-1etg.md`), med rett avkapping.
- **1. etasje:** baddøra x 1,50–2,45 ligger rett sør for øverste trinnkant (x 1,47). Det står bare en liten bit gulvlist
  imellom (225333). Døra hører til `gang-1etg.md`.
- **Kjeller:** døra til rommet 1,64 × 2,32 står **under sørenden av øvre løp**.
  - Planen tegner den 0,86–1,61 m fra kjellerens nordvegg, altså x ≈ 1,01–1,76.
  - Toppen av nordre karm møter undersiden av veggvangen (225349, 225639).
    - Med trinnhøydene i tabellen under (opptrinn 0,17) og en vange på 0,25–0,30 m når vangens underkant 2,15 m først
      ved x ≈ 1,3. Med en 0,75 m dør (planen) inntil nisjehjørnet ved x ≈ 1,8–1,9 begynner nordre karm på x ≈ 1,1.
    - Det er en konflikt på ca. 0,2 m, innenfor usikkerheten i trinnplasseringen, vangedybden og etasjehøyden (med
      etasjehøyde 2,65 forsvinner den). **I modellen:** sett døra på x ≈ 1,10–1,85 inntil nisjehjørnet og kutt
      dørhøyden ved nordre karm der vangen er lavere (ca. 2,0), eller løft øvre løp litt. Ikke flytt døra lenger sør
      enn hjørnet.
  - **Nisje:** døra sitter i en grunn nisje. Søndre karm står helt inntil et utvendig hjørne. Sør for det stikker
    østveggen ca. 0,2–0,3 m lenger inn i GANG (z ≈ 2,55, anslått).
    - Derfor ses døra ikke fra søndre del av GANG. I 225625 og 225631 ender østveggen i et rent, loddrett hjørne, og
      det er ingen sort karm bak det.
    - `entre-gang-kjeller.md` har funnet den samme nisjen.
  - Døra hører til kjellergangen.

### Vestvegg (plan bunn, z = 4,40) – mot vaskerommet nede og soverommet oppe

- Vangen til nedre løp ligger langs veggen, med håndlist fra trinn 1–2 opp til NV-hjørnet. Her er det ikke noe synlig
  LED-lys (225342, 225344, 225625).
- **Kjeller:** vaskeromsdøra står rett sør for nederste trinn.
  - Planen tegner den 1,69–2,52 m fra kjellerens nordvegg, altså x ≈ 1,84–2,67.
  - Trinn 1 begynner like ved den nordre karmen (225631).
- **1. etasje:**
  - Rekkverk A er festet med en stolpe ved x ≈ 1,85.
  - Stikkontakten står ved x ≈ 1,95.
  - Soveromsdøra står på x 2,11–3,06 (225256; se `gang-1etg.md`).

### Sørsiden – åpen

- **Kjeller:** helt åpen mot GANG. Det er her man går inn i trappa.
- **1. etasje:** gulvkanten rundt åpningen med rekkverk A/B/C og øverste trinnkant (se under).

## Faste ting

### Trappa – oppbygging

- **Type:** halvsvingt vangetrapp. Den har to korte rette løp side om side, nedre løp mot vest og øvre løp mot øst, og en
  180° sving med vangetrinn langs nordveggen rundt et smalt trappeøye.
  - Eierens tegning i kjellerplanen er en L-trapp (kvartsving). Bildene viser U-trapp, se «Sammenligning med planene».
- **Telling av trinn:**
  - 225349 nedenfra: 7 trinn nederst (1–7) og 6 trinn i øvre del sett nedenfra (8–13). Trinn 14 er skjult bak kanten
    av etasjeskillet.
  - Ovenfra i 225337 og 225339: 2 nesten rette trinn øverst (14, 13), hjørnetrinnet i NØ (12), 5 trinn langs nordveggen
    (7–11), hjørnetrinnet i NV (6) og 4 trinn langs vestveggen (2–5). Det siste er skjult under rekkverket.
  - 225342: 5 trinn fra NV-hjørnet ned til gulvet i GANG.
  - Til sammen 14 inntrinn, 15 opptrinn.

**Trinn for trinn (forslag til modell, anslått; R = 0,17):**

| Trinn | Hvor | Form | Nese (forkant) | Topp y |
|---|---|---|---|---|
| 1 | nedre løp, z 3,48–4,40, går nordover | rett | x 1,73 (mot sør) | 0,17 |
| 2 | samme | rett | x 1,50 | 0,34 |
| 3 | samme | rett, bakkant x ≈ 1,04 | x 1,27 | 0,51 |
| 4–7 | sving rundt NV-hjørnet av øyet (x 1,04 / z 3,48) | vangetrinn, ca. 22,5° hver. Ytterendene: 4–5 mot vestveggen, 6 i NV-hjørnet, 7 mot nordveggen | – | 0,68–1,19 |
| 8 | langs nordveggen, tvers over nordenden av øyet | nesten rett trinn som går østover | – | 1,36 |
| 9–12 | sving rundt NØ-hjørnet av øyet (x 1,04 / z 3,10) | vangetrinn, ca. 22,5° hver. 12 er hjørnetrinnet i NØ | – | 1,53–2,04 |
| 13 | øvre løp, z 2,32–3,10, går sørover | rett | x 1,04 (mot nord) | 2,21 |
| 14 | samme | rett | x 1,25 | 2,38 |
| (gulv) | gangen i 1. etasje | neselist | x 1,47 | 2,55 |

- 2 · opptrinn + inntrinn blir ca. 0,34 + 0,22 = 0,56–0,57 på de rette trinnene. Det er litt under den vanlige
  komfortregelen (0,60–0,64), men typisk for en kompakt vangetrapp i et smalt sjakt. Bildene gir ikke plass til
  lengre inntrinn.

- **Trappeøyet** ligger på ca. x 1,04–1,50, z 3,10–3,48 (ca. 0,45 × 0,38 m). Gjennom det ser man nedre løp fra
  1. etasje (225337). Rekkverk C står på kanten av det.
- **Ganglinja** er ca. 2,8 m lang: 3 × 0,23 + svingen ca. 1,73 + 2 × 0,21.
- I virkeligheten er overgangen gradvis («balansert»): trinn 4–5 og 12–13 er bare svakt kilede, og 6–11 er sterkt kilede
  (225349, 225337, 225339).

### Inntrinn

- Heltre eik i limte lameller. Lameller og skjøter ses på 225349.
- Platen er ca. **4 cm tykk**. Under forkanten sitter en ca. 4 cm høy forsterkningslist, trukket ca. 2–3 cm inn, så
  forkanten ser ca. 8 cm tykk ut (225349 nærbilde).
- Lett avrundet nese med ca. 3 cm overheng (anslått).
- Trinnlengde ca. 0,86 m på nedre løp og ca. 0,74 m på øvre løp. Da er vangene trukket fra.
- **Farge: #ada396** (anslått, hvitbalansert). Det er samme fargetone som gulvet (#a59b8f), bare ca. 5 % lysere.
  - Målt mot gulvet i samme bilde: 225337 og 225335 gir lik R/G og B/G, og trinnet er 5–7 % lysere.
  - `gang-1etg.md` har #b9a79a. Bruk én av dem; forskjellen er liten.
- Matt, hvitoljet eller hvitpigmentert flate.

### Vanger

- **Veggvange** langs vest-, nord- og østveggen er én sammenhengende sort vange med sagtannprofil som følger trinnene
  (225337, 225339, 225342).
  - Ca. 4 cm tykk og ca. 25–30 cm høy (anslått).
- **Fri vange** på innersiden av nedre løp: sort, rett, fra gulvet ved trinn 1 opp til svingen (225349, 225639).
- **Innervange rundt øyet:** en bred, sort plate som vrir seg bratt oppover rundt nordenden av øyet og opp til
  stolpene under rekkverket i 1. etasje (225349, 225631, 225639).
- **Farge:** matt sort **#1d1e21**, samme som dørkarmene i huset.

### Rekkverk langs trappa (innersiden, mot øyet)

- **Startstolpe** ved trinn 1 på innersiden (x ≈ 1,73, z ≈ 3,48): ca. 7 × 7 cm, ca. 1,0 m over gulvet (225639).
- **Håndlist** på innersiden av nedre løp: sort, firkantet, ca. 5 × 5 cm, ca. 0,9 m over trinnlinja. Den går fra
  startstolpen opp til svingen (225349, 225639).
- **Spiler** under håndlista: sorte, ca. 2 × 2 cm, omtrent én per trinn (6–7 stk.).
- **I svingen:** innervangen og spiler går opp rundt øyet til stolpene P1′ og P2.
  - P1′ og P2 er høye. De går fra rekkverkshøyde i 1. etasje ned under gulvnivå.
  - Nedenfra ses en stolpe som henger ned under hakket i åpningskanten (225349).
  - Nøyaktig hvordan svingen er bygd, er usikkert (se Usikkert).
- Farge: #1d1e21.

### Rekkverk i 1. etasje (rundt åpningen)

Samordnet med `gang-1etg.md` og sjekket på 225331, 225333 og 225335:
- Sort, flat topprekke ca. 7 × 5 cm.
- Bunnrekke ca. 5 × 4 cm rett på gulvkanten.
- Stolper ca. 7 × 7 cm.
- Spiler ca. 2 × 2 cm.
- Topp ca. **1,0 m** over gulvet.

| Felt | Fra → til | Lengde | Spiler |
|---|---|---|---|
| **A** (øst–vest) | vestveggen (x 1,85, z 4,40) → hjørnestolpe **P1** (x 1,85, z 3,48) | ca. 0,92 | 6 (225331) |
| **B** (nord–sør, kort retur) | P1 → stolpe **P1′** (x 1,50, z 3,48) | ca. 0,35 | 2. Ses rett forfra i 225335, der P1′ står rett bak P1 |
| **C** (øst–vest, over trappeøyet) | P1′ → **nyestolpe P2** (x 1,50, z 3,10) | ca. 0,38 | 2 (225335) |

- Fra P2 og østover til østveggen (z 3,10 → 2,32) er det **ikke rekkverk**. Der er øverste trinnkant og inngangen til trappa.

### Veggmontert håndlist med LED

- Sort, rektangulær, ca. 5 × 4 cm, på sorte runde braketter ca. 5 cm fra veggen. Ca. 0,9 m over trinnlinja.
- **Sammenhengende rundt tre vegger:**
  - **Vestveggen:** starter over trinn 1–2 og stiger nordover.
  - **NV-hjørnet:** gjæret. Deretter går den langs **nordveggen**, stigende østover.
  - **NØ-hjørnet:** gjæret. Deretter går den langs **østveggen**, stigende sørover, opp til x ≈ 1,40, der den er rett
    avkappet ca. 0,6–0,7 m over gulvet i 1. etasje.
  - Bilder: 225331, 225333, 225335, 225337, 225339, 225342, 225349 og 225625.
- **Mot hylla:** på nordveggen ligger lista i ett plan ca. 5–6 cm foran hyllekanten (x ≈ 0,21).
  - I vestenden går den under hylla, og i østenden går den over hyllehøyden. Den krysser hyllehøyden ved ca. trinn 8.
  - I 225337 ligger lista rett langs hyllekanten.
- **LED-list** i undersiden av håndlista. Den lyser i bildene langs **nordveggen** (225349, 225625, 225631) og
  **østveggen** (225331, 225333, 225335).
  - Langs vestveggen ses ikke noe lys (225342, 225625).

### Åpningen i 1. etasje (hullet i etasjeskillet)

| Del | x | z | Kant |
|---|---|---|---|
| Øst (øvre løp, inngangen) | 0 – 1,47 | 2,32 – 3,10 | øverste trinnkant med neselist, ikke rekkverk |
| Midten (over øyet) | 0 – 1,50 | 3,10 – 3,48 | rekkverk C |
| Vest (over nedre løp) | 0 – **1,85** | 3,48 – 4,40 | rekkverk A, og B på hakket ved z 3,48 |

- Til sammen ca. 3,4 m².
- Kanten har en hvit kantflate (etasjeskillet), ca. 0,30–0,35 m høy (225342).
- **Nedenfra ses hakket tydelig i 225349.** Over vestre del slutter kjellertaket nærmere kameraet enn over østre del.
- Vest-delen rekker ca. 0,12 m sør for trinn 1 (x 1,73).

### Fri høyde

- **Over trappa:** hele trappa ligger innenfor åpningen. Det er fritt opp til taket i 1. etasje (y ≈ 4,95).
  - Over trinn 14 er det ca. 2,57 m og over trinn 13 ca. 2,74 m. Lenger ned er det mer.
- **Ved foten:** før trinn 1 går man under kanten av åpningen (x 1,85). Der er kjellertaket ca. 2,25 m.
- **Under øvre løp** (fra kjellergangen, øst for nedre løp) er det lavt. Undersiden av trinnene ligger ca. 0,08 m under
  trinntoppen:

| Under trinn | x | Underside y |
|---|---|---|
| 13–14 | 1,04–1,47 | ca. 2,13–2,30 |
| 12 (NØ-hjørnet) | – | ca. 1,96 |
| 9–11 | – | ca. 1,45–1,8 |
| 7–8 | – | ca. 1,1–1,3 |

- Det er bare ≥ 2,0 m under trinn 13–14 (x ≳ 1,04). Vangen henger lavere enn trinnene; se døra under trappa
  (Østvegg).
- **Hylla** er ingen hindring. Den ligger på ca. hoftehøyde over trinnene langs nordveggen.

### Sammenligning med planene og de røde markeringene

**1. etasje («1,54 m», hele dybden 2,07):**
- Øst-delen stemmer: øverste trinnkant ligger på x 1,47–1,54. Planens målestrek ligger da også langs østveggen.
- Vest-delen er ca. 0,3 m lengre (x 1,85). Det ses både ovenfra (225331, 225335, 225256) og nedenfra (225349).
- Hele dybden 2,07 stemmer.

**Kjeller (det skraverte feltet):**
- Planen tegner en **L-trapp**:
  - en lys del langs vestveggen (z ≈ 3,5–4,4) fra nordveggen til 1,58 m;
  - vangetrinn i NV-hjørnet;
  - en mørk del langs nordveggen mot østveggen, bare 0,88 m ut fra nordveggen.
- Bildene viser en **U-trapp**. Øvre løp fortsetter sørover langs østveggen til ca. 1,32 m fra kjellerens nordvegg.
  - Planen viser trolig bare den delen som går lavt over gulvet. Der den mørke delen slutter, er trappa ca. 2 m over gulvet.
  - 1,58 m for trinn 1 stemmer med bildene: trinn 1 ligger ved nordkarmen til vaskeromsdøra (225631).
  - Den mørke delen er 0,88–0,89 m dyp fra kjellerens nordvegg. Det passer med nordkanten av trappeøyet
    (x 1,04 − 0,15 = 0,89), altså svingsonen langs nordveggen.
  - Nedre løp er 0,90 m bredt i planen og ca. 0,92 m i bildene.
- Målene **«2,91 m» og «1,83 m»** gjelder ikke selve trappefeltet:
  - 2,91 er lengden på den smale delen av GANG, fra nordveggen til hjørnet ved vaskerommet.
  - 1,83 er bredden av den smale delen. Tegnet er den bare ca. 1,70.
- **Avvik:** trappa trenger 2,07 m, og innenfor sjakta går vest- og østveggen rett fra kjelleren opp til 1. etasje.
  - **Ved trappa (x < ca. 1,8) er GANG derfor 2,07 m bred (z 2,32–4,40)**, ikke 1,83.
  - Sør for nisjen ved døra under trappa stikker østveggen 0,2–0,3 m inn. Der er GANG ca. 1,8 m, og planens 1,83 kan
    stemme (se Østvegg).

### Til spillet

- **Veien fra ytterdøra:**
  1. Ytterdøra står i entréen (2,51 × 2,93) sør for GANG.
  2. Derfra går man **to trinn opp** til GANG (sorte neselister, 2 × ca. 0,17 = 0,34 m; 225553, 225558, 225559).
     Trinnene hører til entré- og gangnotatet, ikke til denne trappa.
  3. Så går man ca. 4 m nordover langs GANG og opp trappa.
- Opptrinn på 0,17 m. Hvis spillerens maks steghøyde er under 0,17, trengs en usynlig rampe langs ganglinja.

## Møbler (ryddig)

- Ingen møbler i trappa.
- **Valgfri pynt:** grønn kunstig eukalyptus i flettet kurv, Ø ca. 16 cm, ca. 35 cm høy. Den står på hylla i NV-hjørnet
  (x ≈ 0,08, z ≈ 4,25, y 2,30).
  - Bilder: 225331, 225335, 225337, 225339, 225349 og 225631.
  - Det er samme plante som i `gang-1etg.md`. Den må bare modelleres én gang.

## Lys

- **LED-list i håndlista** (fast lys i trappa) langs nordveggen (ca. 2,0 m) og østveggen (ca. 1,25 m, fra NØ-hjørnet
  til x ≈ 1,40), ca. 3,3 m til sammen.
  - Hvit, nøytral til varm, ca. 3000–4000 K (anslått). Den lyser ned på veggen under lista og på trinnene.
  - Ingen LED synes langs vestveggen.
- Trappa har ingen egen lampe. Sjakta får lys fra disse:
  - Taklampa i gangen i 1. etasje: rund LED-plafond, ca. x 1,2 og z 3,1, rett over trappetoppen (se `gang-1etg.md`).
  - Innfelte downlights i taket i GANG i kjelleren, med sort ring (se kjellernotatene).
- Det er ikke sett noen bryter for LED-lista.

## Utelatt rot

- Sort jakke eller genser hengt over rekkverk A (225331, 225333, 225335).
- **Under øvre løp i kjelleren:** stabler med gulvpakker (laminat), oransje og hvite plastposer, sorte bager, sammenrullede
  matter og sko (225349, 225631, 225639).
- **Foran trappa i GANG:** en lang plate på bukker med verktøy, lader, krus og klær, ledninger, sokker og løse lister
  (225344, 225349, 225625, 225631, 225635). Også gulvpakker og en sort pose på gulvet ved trappefoten (225349, 225639).
  Dette hører til GANG.
- Fotografens føtter og bein (225339, 225342, 225344).
- I 1. etasje: plastsekk og søppelbøtte ved baddøra (225331, 225333). Dette hører til gangen.

## Usikkert / anslått

- **Etasjehøyden (2,55) og opptrinnet (0,17) er ikke målt.** De er regnet som kjellertak 2,25 + dekke 0,30, delt på
  15 opptrinn. Spennet er 2,50–2,65 (opptrinn 0,167–0,177).
  - Er det 15 inntrinn (16 opptrinn), blir opptrinnet ca. 0,16. Er det 13 (14 opptrinn), ca. 0,18.
  - Det enkleste målet for eieren: tell trinnene og mål ett opptrinn, eller mål takhøyden i GANG.
- **Antall trinn:** 14 er telt fra flere vinkler og stemmer når tellingene settes sammen. Grensa mellom vangetrinnene i
  svingen er likevel uskarp, så tallet er ±1.
- **Delingen av svingen** i 4 + 1 + 4 vangetrinn er en modellforenkling. I virkeligheten er overgangen gradvis.
- **Bredder og øye:** nedre løp 0,92, øvre løp 0,78 og øye 0,38 kommer fra rekkverket i 1. etasje
  (`gang-1etg.md`, plankeskjøter som målestokk).
  - Mitt eget perspektivanslag ga et noe bredere øvre løp (ca. 0,85–0,9) og et smalere øye (ca. 0,2).
  - Under gulvnivå kan løpene ha samme bredde.
- **Åpningen i 1. etasje:** x 1,47 / 1,50 / 1,85 og z 3,10 / 3,48 er ±0,05–0,10 m.
  - Mitt eget anslag for rekkverk A var x ≈ 1,92, ut fra perspektivet i 225331 og veggstykket med stikkontakt
    ved soveromsdøra i 225256.
- **Hylla:**
  - Høyden y 2,30 er ±0,1. `gang-1etg.md` anslo den høyere.
  - Dybden 0,15 er ±0,05.
  - At den er toppen av grunnmuren (og at nordveggen nede står 0,15 lenger inn), er en tolkning.
- **x for trinn 1 (1,73)** forutsetter at kjellerens nordvegg står på x 0,15. Settes kjellerens nordvegg på x = 0, blir
  det 1,58.
- **Svingen på innersiden:** hvordan håndlista går fra nedre løp rundt øyet til P1′ og P2, og hvor mange spiler det er der,
  ses ikke tydelig.
- **LED langs vestveggen:** kan finnes, men ses ikke på bildene. Fargetemperaturen er anslått.
- **Tykkelse på trinn og vanger** og **trinnfarge** er anslått. Fargen er hvitbalansert mot gulvet i samme bilde.
- **Stikkontakten eller bryteren over hylla:** bare en del av den synes bak kurven.
- **Bredden av den smale delen av GANG:** planen sier 1,83 (tegnet 1,70), men bildene krever 2,07 ved trappa.
  - Nisjen forklarer trolig forskjellen: 2,07 i sjakta, ca. 1,8 sør for hjørnet.
  - Hvor hjørnet står (x ≈ 1,8–1,9) og hvor dypt fremspringet er (0,2–0,3), er anslått. Det ses bare på skrå.
- **Døra under trappa:** plasseringen (x ≈ 1,01–1,76) er hentet fra planen.
  - Bildene viser at nordre karm møter undersiden av vangen og at søndre karm står inntil nisjehjørnet.
  - Ut fra trinnhøydene (0,17) når vangen 2,15 først ved x ≈ 1,3. Se Østvegg for hvordan det løses i modellen.

## Bilder

| Fil | Viser |
|---|---|
| `gang 1etg/20261020_225331.jpg` | Fra stua gjennom stuedøra mot nord. Rekkverk A/B/C, øverste trinnkant til høyre, hylla med planten og stikkontakten bak kurven, håndlista med LED på nord- og østveggen. Rot: jakke. |
| `gang 1etg/20261020_225333.jpg` | Mot øst/nordøst. Øverste trinn og LED-håndlista på østveggen rett nord for baddøra, NØ-enden av hylla og stolpene P1, P1′ og P2. |
| `gang 1etg/20261020_225335.jpg` | Fra midt i gangen ned i åpningen. Tydeligst bilde av A, B og C: P1′ står rett bak P1, og C har 2 spiler. Første trinn, hylla, nordre håndlist bak P2. |
| `gang 1etg/20261020_225337.jpg` | Fra øverste trinn rett ned. Neselista, trinn 14 og 13, vifta av vangetrinn rundt øyet, sort veggvange og håndlista øst → nord. Gjennom øyet ses nedre løp. |
| `gang 1etg/20261020_225339.jpg` | Bratt ned i sjakta (rotert bilde). Hele vifta, tellbar fra trinn 12 til 2: langs nordveggen og ned langs vestveggen. Hylla og planten. |
| `gang 1etg/20261020_225342.jpg` | Fra svingen mot sør, ned langs nedre løp. Trinn 5 → 1, vestre håndlist uten LED, GANG og vaskeromsdøra. Rot i GANG. |
| `gang 1etg/20261020_225344.jpg` | Fra nedre løp mot sør. Innerrekkverket med spiler til venstre, vestre håndlist og vange til høyre, gulvet i GANG. Rot. |
| `Entre og gang kjeller/20261020_225256.jpg` | **Tatt i 1. etasje**, selv om det ligger i kjellermappa (tidsstempelet ligger rett før soverombildene). Viser soveromsdøra fra gangen og vestenden av rekkverk A til høyre, med veggstykket og stikkontakten imellom. |
| `Entre og gang kjeller/20261020_225349.jpg` | **Beste oversiktsbilde nedenfra.** Fra GANG mot nord: trinn 1–7, åpne opptrinn, fri vange med spiler, den vridde innervangen, trinn 8–13 nedenfra, hylla med planten og stikkontakten, LED-håndlista, hakket i åpningskanten, døra under trappa. Rot under trappa. |
| `Entre og gang kjeller/20261020_225543.jpg` | Inngangen utenfra (ytterdør med sidefelt). Viser ikke trappa. |
| `Entre og gang kjeller/20261020_225553.jpg` | Fra ytterdøra inn: entréen, to trinn opp til GANG og trappa langt inne. |
| `Entre og gang kjeller/20261020_225556.jpg` | Knaggstativ i entréen. Viser ikke trappa. |
| `Entre og gang kjeller/20261020_225558.jpg` | Entréen mot GANG med de to trinnene. Trappa langt inne til venstre. |
| `Entre og gang kjeller/20261020_225559.jpg` | De to trinnene opp fra entréen til GANG, sett rett forfra. Trappa i enden. |
| `Entre og gang kjeller/20261020_225600.jpg` | Speilgarderobe i entréen. Viser ikke trappa. |
| `Entre og gang kjeller/20261020_225609.jpg` | Speilgarderobe med speilbilde av entréen. Viser ikke trappa. |
| `Entre og gang kjeller/20261020_225617.jpg` | Dør og knaggstativ i entréen. Viser ikke trappa. Entréen ligger ca. 0,33 m lavere enn GANG, så karmen her gir ikke takhøyden i GANG. |
| `Entre og gang kjeller/20261020_225619.jpg` | Ytterdøra innenfra. Viser ikke trappa. |
| `Entre og gang kjeller/20261020_225621.jpg` | Speilgarderobe. Viser ikke trappa. |
| `Entre og gang kjeller/20261020_225625.jpg` | GANG fra sør mot trappa. Nedre løp, vestre håndlist uten lys, LED langs nordveggen, vaskeromsdøra til venstre. Østveggen ender i et utvendig hjørne (nisjen), og døra under trappa ses ikke. Rot. |
| `Entre og gang kjeller/20261020_225630.jpg` | Hjørne med oliventre og dør. Viser ikke trappa. |
| `Entre og gang kjeller/20261020_225631.jpg` | GANG mot trappa, fra søndre del av GANG omtrent rett sør for nedre løp (knekken til venstre). Trinn 1–7, øvre trinn nedenfra, hylla med planten omtrent i høyde med kjellertaket. Trinn 1 ligger ved vaskeromsdørkarmen. Østveggen ender i nisjehjørnet, og døra under trappa ses ikke. |
| `Entre og gang kjeller/20261020_225635.jpg` | Østveggen i GANG med åpen bodør (den grå boden i sørøst), og dørkarmen brukt til takhøyden (ca. 2,25–2,35; felles modellverdi 2,25). Viser ikke trappa. Rot. |
| `Entre og gang kjeller/20261020_225639.jpg` | Trappa fra GANG, mot nordøst. Innerrekkverket langs nedre løp, startstolpen, undersiden av øvre løp og døra under trappa. Toppen av nordre karm møter vangen, og søndre karm står inntil nisjehjørnet. Rot under trappa. |

## Kontrollert

Uavhengig gjennomgang 2026-10-21. Jeg har sett på alle 7 bildene i `gang 1etg` og alle 17 i `Entre og gang kjeller`
(utsnitt fra originalene), begge planene og `hele-huset-fakta.md`.

**Endret:**
- **Nisje i østveggen nede (manglet).** I 225625 og 225631 ender østveggen i GANG i et rent, loddrett utvendig hjørne
  ved trappa, og det er ingen sort karm bak det. I 225349 og 225639 står søndre karm på døra under trappa helt inntil
  dette hjørnet. Døra sitter altså i en grunn nisje, og veggen sør for den stikker 0,2–0,3 m inn i GANG.
  `entre-gang-kjeller.md` fant det samme. Lagt inn under Rommet og Østvegg.
- **Breddeavviket 2,07 / 1,83 er presisert.** Sjakta er 2,07 m (som 1. etasje), men sør for nisjen er GANG ca. 1,8 m.
  Planens 1,83 kan derfor stemme der. Før sto det at hele den smale delen burde være 2,07.
- **Takhøyden i kjelleren er senket fra 2,35–2,40 til 2,30–2,35.** 225617 er tatt i entréen, som ligger to trinn
  (ca. 0,33 m) lavere enn GANG, og kan ikke brukes til takhøyden i GANG. 225635 gir ca. 2,33. Det samsvarer med
  `entre-gang-kjeller.md` og `vaskerom.md` (2,30). Etasjehøyden 2,70 står som modellverdi, med 2,60–2,70 som mulig spenn.
  *(Erstattet i krysskontrollen: felles kjellertak 2,25, etasjehøyde 2,55.)*
- **Døra under trappa:** lagt til at nordre karm må stå på x ≈ 1,1–1,2 for å gå klar av veggvangen. Planens 1,01 er
  litt for langt nord.
- **Hylla** står nå «omtrent i høyde med kjellertaket», ikke «like under». Høyden y ≈ 2,25–2,30 er kontrollert mot
  håndlista i 225349.
- **Takfargen over trappa:** før sto det bare hvitt #ecebe8. `gang-1etg.md` sier hvitt eller SAND. Nå står begge, med
  henvisning til gangen.
- **Sammenligning med kjellerplanen:** lagt til at planens mørke felt, 0,89 m fra nordveggen, er svingsonen fram til
  nordkanten av trappeøyet (x 1,04 − 0,15). Det støtter tolkningen av planen.
- **Bildetabellen:** retting for 225617 (entré, ikke brukbar til takhøyde), 225631 (tatt omtrent rett sør for nedre løp,
  ikke «litt fra øst»), 225625, 225635 og 225639 (nisjen).
- **Rot:** lagt til gulvpakker og en sort pose ved trappefoten (225349, 225639).

**Kontrollert uten endring:**
- U-trapp med vangetrinn og uten repos, og retningen opp (nord langs vestveggen, høyre langs nordveggen, sør langs
  østveggen). Det ses tydelig i 225333, 225335, 225337, 225342 og 225349. Orienteringen nord/øst/sør/vest stemmer.
- Antall trinn er ca. 14. Jeg telte 7 i nedre del (225349, 225631) og 5–6 fra NV-hjørnet ned (225342). Ovenfra ses 14
  og 13, hjørnetrinnet i NØ og 4–5 langs nordveggen (225337).
- Rekkverk A/B/C i 1. etasje og det trappeformede hullet (x 1,85 / 1,50 / 1,47). B går nordover fra P1, og C går østover
  til P2 (225335). Bredden 0,92 / 0,38 / 0,78 er i samsvar med 225335.
- *(Rettet i krysskontrollen til 0,6–0,7 m over gulvet oppe.)* Håndlisthøyden ved enden på østveggen er ca. 0,8–0,9 m over gulvet oppe. Den er perspektivkorrigert mot karmen på
  baddøra i 225333.
- LED-lista lyser langs nord- og østveggen, ikke langs vestveggen (225349, 225625, 225631, 225333). `gang-1etg.md` nevner
  bare østveggen, men nordveggen lyser også.
- Farger: trinnene er 4–7 % lysere enn gulvet oppe og har nesten samme fargetone (225335, 225337). #ada396 står.
  Sort #1d1e21 og SAND på veggene står.
- Dørene oppe (bad, soverom, stue) og nede (vaskerom, bod) står på riktig vegg. Ruta fra ytterdøra gjennom entréen og to
  trinn opp til GANG stemmer med 225543, 225553 og 225559.

**Avvik i andre notater:**
- `entre-gang-kjeller.md` beskrev først en L-trapp. Det er rettet der (U-trapp med øvre løp sørover langs østveggen).

### Krysskontroll mellom rommene (2026-10-21)

Sjekket mot `gang-1etg.md`, `entre-gang-kjeller.md`, `vaskerom.md`, `kjellerstue.md`, `soverom-kjeller.md` og
`ytterdor-ute.md`.

- **Topp og bunn stemmer med begge etasjene.** Oppe: øverste trinnkant x 1,47 og hullet x 1,47/1,50/1,85 er likt i
  `gang-1etg.md`. Nede: trinn 1 på x 1,73 her er det samme som x 1,60 fra kjellerens nordvegg i
  `entre-gang-kjeller.md` (kjellerens nordvegg står på x 0,13–0,15). Vaskeromsdøra x 1,84–2,67 her = 1,69–2,58 i
  `vaskerom.md` og `entre-gang-kjeller.md`, i samme forskyvning.
- **Sjakta stemmer:** med kjellerplanen lagt med ytterflatene i flukt (+0,13 i x og z) havner nisjeveggen ved døra
  under trappa på z ≈ 2,29 og vestveggen (badveggen) på z ≈ 4,37. Oppe er de 2,32 og 4,40. Det er innenfor 3 cm.
- **Rettet: etasjehøyden** 2,70 → **2,55** og opptrinnet 0,18 → **0,17** (15 opptrinn). Grunnen: kjellertakene i alle
  rommene er 2,22–2,30 og dekket 0,25–0,35. 2,70 ville krevd et dekke på 0,40–0,45, og hylla ville ligget 0,4 m under
  gulvet oppe, mens den ovenfra ser ut til å ligge like under. Trinntabellen, fri høyde og undersidene er regnet om.
- **Rettet: kjellertaket** 2,30–2,35 → felles **2,25** for hele kjelleren.
- **Rettet: håndlistas øvre ende** 0,9 → **0,6–0,7 m** over gulvet oppe, som `gang-1etg.md` (målt på nytt i 225333).
- **Rettet: taklampa i gangen** står på x ≈ 1,2, z ≈ 3,1 (ikke 2,3 / 3,4), som `gang-1etg.md` ble rettet til.
- **Rettet: døra under trappa.** Med lavere trinn kolliderer en 2,1 m dør på planens plass med vangen. Løsningen står
  under Østvegg.
- **Rettet:** entrétrinnene er 2 × 0,17 = 0,34 (som `entre-gang-kjeller.md`), ikke 0,33.
