# Gang/entré 1. etasje (3,11 × 2,07) – fra bildene

Kilder: `plantegning.png`, `bilder_hus/plantegning_kjeller.png`, `notes/hele-huset-fakta.md`, de 7 bildene i
`bilder_hus/_1600/gang 1etg/` og `src/data/room-spec.json` (stuedøra `door-gang`, maling, gulv, gulvlist).
I tillegg er brukt `bilder_hus/_1600/Soverom 1etg/20261020_225324.jpg` og `20261020_225327.jpg`. De er tatt fra
soveromsdøra ut i gangen mot øst.
Bad- og soveromsnotatene (`bad-1etg.md`, `soverom-1etg.md`) er brukt til å kryssjekke dørene.

Orientering som planen: nord = plan venstre (x = 0), sør = plan høyre (mot stua), øst = plan topp (mot badet),
vest = plan bunn (mot soverommet). Koordinater i spillets akser fra `room-spec.json`: x = meter sørover fra
innsiden av nordre yttervegg, z = meter vestover fra innsiden av østre yttervegg, y = opp.

**Kort svar på oppdraget:**
- **Gangen har ingen ytterdør.** Den har tre innvendige dører: til **badet** (øst), **soverommet** (vest) og
  **stua/kjøkkenet** (sør, `door-gang`). I tillegg går **trappa ned til kjellergangen** i nordenden.
- Nordveggen er yttervegg uten vindu og uten dør, og hele den står inne i trappeåpningen.
- 1. etasjes eneste dør til det fri er **terrassedøra i stua** (`door-terrasse` i `room-spec.json`), og den er ikke
  hovedinngangen. Hovedinngangen (ytterdøra) er derfor, slik fakta-fila sier, i kjelleren: rommet 2,51 × 2,93 med ytterdør.
  `20261020_225344.jpg` er tatt fra trappa og ser sørover langs kjellergangen mot et opplyst rom i enden.
  Ytterdøra er nå **bekreftet** i kjellerbildene (`entre-gang-kjeller.md`, `ytterdor-ute.md`): den sitter i sørveggen i
  entréen, og det opplyste rommet i 225344 er entréen.
- Et spill som skal starte ute, må altså sende spilleren inn gjennom ytterdøra i kjelleren og opp trappa
  (se `oversikt.md`).

## Rommet

- **Planmål:** 3,11 m nord–sør × 2,07 m øst–vest.
  - x 0–3,11. z ≈ 2,32–4,40: badet er z 0–2,22, pluss ca. 0,10 m vegg.
  - Soverommets østvegg ligger på z = 4,51 ifølge `soverom-1etg.md`, så gangens vestvegg har flate på ca. z 4,40–4,41.
  - `door-gang` i `room-spec.json` går helt til z 4,43, så karmen står i sørvesthjørnet. Avviket er bare 2–3 cm.
  - Planen tegner stueåpningen på ca. z 3,30–4,30, med ca. 0,10 m vegg inn til vesthjørnet. Bildene (225324, 225331)
    viser at den vestre karmen står helt inne i hjørnet og møter soveromsdøras karm. Bruk derfor `room-spec.json`, ikke planen.
- **Takhøyde:** 2,40 m, flatt tak over hele gangen, også over trappeåpningen (anslått, som kjøkkenet).
  - Bildene viser ikke noe skråtak. Taket går rett fram til nordveggen i 225331.
  - Badet og soverommet er også anslått til 2,40.
- **Tak:** glatt og lyst.
  - Ved lampa er det nær nøytralt i fargen. Bruk hvit **#ecebe8** (anslått).
  - Stua har SAND i taket. Hvis gangen skal se lik ut, kan SAND brukes her også.
  - Ingen taklist.
- **Gulv:** samme gulv som i stua og soverommet, `oak-plank` **#a59b8f**: hvitpigmentert/gråvasket eik med bord på ca. 22 cm.
  - **Bordene går øst–vest (langs z)**. Skjøtene er vannrette i 225331 og 225335.
  - Hvitbalansert fra 225335 blir gulvet ca. #c5b3a8 (det er sterkere opplyst), med samme fargetone som i stua.
- **Gulvareal uten trapp:** x 1,85–3,11 over hele bredden, pluss en «tunge» x ≈ 1,47–1,85 ved østveggen
  (z 2,32–3,48), fram til øverste trinn. Se trappeåpningen under.
- **Hvitbalanse:** bildene er tatt om kvelden i varmt lys. Taket rett ved lampa leser nær nøytralt.
  - Veggene leser R/G ≈ 1,11, B/G ≈ 0,82.
  - Korrigert med taket som nøytral referanse blir veggene ca. **#cdc4b6**. Det passer med **SAND #cfc5b4**.
  - Hex-verdiene under er korrigert slik at gangveggen blir SAND (rå bildeverdi ganget med ca. R × 1,29, G × 1,37, B × 1,45, med noe variasjon fra bilde til bilde).

## Vegger

**Felles:** malt glatt gips i **SAND** (#cfc5b4). Fargen er anslått, men ser lik ut som i stua og soverommet.
- Ingen radiatorer.
- Gulvlist ca. 6–7 cm. På bildene ser den lys rosa-beige ut (korrigert ca. #cbb9ac), nesten som gulvet.
  - Den kan være hvit (#e9e6df) som i stua og bare få farge av gulvet. Bruk stuas `baseboard` (anslått).
  - Kontroll: i rå bildeverdier er lista like rød som gulvet (R/G ≈ 1,18–1,21) og rødere enn veggen (≈ 1,11). Hvit list
    ville lest som veggen. Det taler for lys eik i gulvfarge. Soveroms- og kjellerstuenotatet sier det samme. Bør sjekkes.
- Alle dører har sort karm og gerikt, **#1d1e21**, ca. 7 cm, samme stil som `door-gang`.

### Nordvegg (plan venstre, x = 0, z 2,32 → 4,40) – yttervegg, står helt inne i trappeåpningen

- Yttervegg, modelleres 0,30 m som de andre ytterveggene. Bilder: 225331, 225335, 225337, 225339.
- **Ingen vindu og ingen dør.**
- Veggen fortsetter rett ned i trappesjakta til kjelleren.
- **Avsats/hylle langs foten av veggen** (225331, 225335, 225337, 225339):
  - Hvit/SAND-malt, ca. 0,15 m dyp. Går hele bredden fra NØ- til NV-hjørnet.
  - Toppen ligger ca. **0,25 m under gangulvet** (anslått 0,15–0,30), altså på undersiden av etasjeskillet, i høyde
    med kjellertaket. Ovenfra så den ut til å ligge 0–0,2 m under gulvet; nedenfra (225349, `trapp.md`) ligger den i
    høyde med kjellertaket. Samkjørt i krysskontrollen.
  - Fronten er en loddrett flate ned mot trappevangen.
  - Det er toppen av grunnmuren: kjellerplanen tegner nordveggen ca. 0,28 tykk mot 0,16 i 1. etasje, med samme
    ytterflate, så kjellerveggen står ca. 0,13–0,15 lenger inn (se `oversikt.md`). Kan være ført et lite stykke langs
    vestveggen (usikkert).
- **Veggmontert håndløper:** den nordre delen av den gjennomgående håndløperen (se Faste ting).
  - Den kommer fra NØ-hjørnet og faller vestover langs veggen til NV-hjørnet.
- Ingen stikkontakter eller brytere synes.

### Østvegg (plan topp, z ≈ 2,32, x 0 → 3,11) – mot badet (x 0–2,56) og kjøkkennisjen (x 2,56–3,11)

Bilder: 225333 (rett forfra), 225335, 225337, 225331 (delvis). Også `Soverom 1etg/20261020_225324.jpg` og
`20261020_225327.jpg`, som er tatt fra soveromsdøra rett mot østveggen.

| x | Hva |
|---|---|
| 0 – 1,47 | Trappesjakt. Veggen fortsetter ned. Trappas ytre vange (sort) ligger langs foten. **Håndløper med LED-list** fra NØ-hjørnet opp til x ≈ 1,40. |
| ≈ 1,45–1,47 | Øverste trinnkant (nese) møter veggen. |
| 1,47 – 1,50 | Bare en liten bit gulvlist (225333). |
| 1,50 – 2,45 | **Dør til badet.** Hull ca. 0,95 × 2,15 (planen tegner 1,535–2,43; tallene følger `bad-1etg.md`). |
| 2,45 – 3,11 | Glatt vegg med gulvlist. Ingen bryter og ingen stikkontakt synes (225333, 225324, 225327). Nederst i sørøsthjørnet står rot (en bøtte) som kan skjule en stikkontakt ved gulvet. |

Detaljer om baddøra:
- Den nordre karmen står helt inntil trappeåpningen.
- **Døra slår inn på badet** og henger i **sørkanten**.
  - Dørbladet ses i 225324 og 225327 (soveromsmappa). Det står åpent ca. 70–90° inn på badet, med hengslene til høyre (sør).
  - Bladet er sort #1d1e21, glatt, med ett innfelt felt, samme stil som `door-gang`. Det stemmer med planens dørbue.
- **Terskel:** mørk/sort topp med lys forkant mot gangen (225333, 225335). Badegulvet bak er mørkt grått (#66676a).

### Sørvegg (plan høyre, x = 3,11, z 2,32 → 4,40) – mot stua/kjøkkenet

- Dette er den andre siden av `w-gang` i `room-spec.json` (veggflaten mot stua ligger på x = 3,22; veggen er 0,10–0,11 m).
- **Stuedøra `door-gang`:** hull z 3,36–4,43, det vil si i sørvesthjørnet.
  - 1,07 × 2,15, sort karm, dørblad 0,93 × 2,08.
  - Hengsler i østkanten (z ≈ 3,36). **Døra slår ut i gangen.** Åpen legger den seg langs veggstykket z 2,32–3,36.
  - Lys terskel #cdbfae.
  - Bildet 225331 er tatt fra stua gjennom denne døra.
- **Veggen øst for døra** (z 2,32–3,36, ca. 1,04 m) ses fra gangsiden i 225324 og 225327 (soveromsmappa), skrått
  fra soveromsdøra. Den er glatt fra gulv til tak med gulvlist, uten bryter og uten stikkontakt.
- **Lysbryter:** ingen bryter ses på noen av gangveggene (225324, 225327, 225331, 225333, 225335).
  - Gangen styres trolig fra bryterpanelet ved stuedøra på stuesiden (det finnes allerede i `room-spec.json`), eller med en
    sensor (se takpunktene under Faste ting). Ikke modeller noen bryter på gangsiden (anslått).
- Varmepumpa og bryterne ved døra sitter på stuesiden. De er allerede i `room-spec.json`.

### Vestvegg (plan bunn, z ≈ 4,40, x 0 → 3,11) – mot soverommet

Bilder: 225331 (venstre side), 225335 (nede til venstre), 225333 (tatt fra soveromsdøra).

| x | Hva |
|---|---|
| 0 – 1,85 | Trappesjakt. Veggen fortsetter ned. **Nederste trappeløp går sørover langs denne veggen.** Håndløperen kommer fra NV-hjørnet og faller sørover ned mot kjelleren (225342). |
| ≈ 1,85 | Rekkverk A er festet til veggen med en sort stolpe. |
| ≈ 1,95 | **Stikkontakt**: sort #1c1a19, 0,084 × 0,084, senter ca. 0,18 m (225331, 225335). Den sitter rett sør for rekkverksstolpen. |
| 2,11 – 3,06 | **Dør til soverommet.** Hull ca. 0,95 × 2,12–2,15 (tallene følger `soverom-1etg.md`; planen tegner 2,13–3,01). |
| 3,06 – 3,11 | Kort veggstykke inn til hjørnet. |

Detaljer om soveromsdøra:
- Hengsler i sørkanten. **Døra slår inn i soverommet** og står åpen på bildene.
- Sort blad med ett innfelt felt.
- **Terskel** smal, sort/mørk metall (225335).

## Faste ting

### Trappeåpningen sett ovenfra (feltet «1,54 m»)

Eieren har merket feltet x 0–1,54 over hele dybden. Bildene viser at åpningen er **trappeformet**:

| Del | x | z | Kommentar |
|---|---|---|---|
| Øst-delen (øverste løp, der man går ned) | 0 – ≈1,47 | 2,32 – 3,10 | Øverste trinnkant ligger 5–10 cm nord for nordkarmen på baddøra. Dette tilsvarer eierens 1,54. |
| Midten (trappekjernen) | 0 – ≈1,50 | 3,10 – 3,48 | Kort rekkverk C på toppen av kjernen. |
| Vest-delen (over nederste løp) | 0 – **≈1,85** | 3,48 – 4,40 | Går ca. 0,3 m lenger sør enn 1,54, trolig for å gi hodehøyde over nederste løp. |

- Hvorfor 1,85 og ikke 1,54: plankeskjøtene i 225335 viser at rekkverk A står ca. 1,2 bordbredder (≈0,26 m) nord
  for soveromsdøras nordkarm. Det står samtidig ca. 0,3 m sør for baddøras nordkarm.
  - Begge målene gir x ≈ 1,85 ± 0,08.
- **Gulvkanten** langs åpningen har en hvit kantflate (bjelkelaget), ca. 0,25–0,30 m høy (anslått). Den ses fra trappa i
  225342.
- Langs øverste trinnkant ligger en lys trappeneselist i eik/hvit (225337).

### Trappa

**Type:** halvsvingt vangetrapp (U-trapp med vangetrinn). Den svinger ca. 180° rundt en kort kjerne ved sørenden av
sjakta (225337, 225339).

**Gangen nedover:**
1. Øverst ett trinn med nese ved x ≈ 1,47 på østsiden (z 2,32–3,10, ca. **0,78 m bredt**). Retning nord.
   - Nesa er selve gangkanten med neselista. Første inntrinn under den er nesten rett (225337). Vangetrinnene begynner
     på inntrinn nummer to.
2. Deretter ca. **9–11 vangetrinn** som vifter rundt kjernen. De går nordover langs østveggen, vestover langs
   nordveggen og sørover langs vestveggen. Trinnene er lange ytterst mot veggene, opptil ca. 1,3–1,5 m mot
   nordveggen, og spisse inne ved kjernen.
3. Nederst 2–3 rette trinn sørover langs vestveggen (z ≈ 3,48–4,40), ned i kjellergangen.
   - Kjellerplanen har trappefeltets vestre del helt ut til x ≈ 1,6, mens den østre delen bare går til x ≈ 0,9.
   - Ankomst i kjelleren mot sør (225342, 225344).

**Høyder:** **15 opptrinn à ca. 0,17 m** (14 inntrinn pluss gulvet oppe, `trapp.md`). Etasjehøyden er ikke målt;
modellverdien er **2,55 m** (kjellertak 2,25 + etasjeskille 0,30; spenn 2,50–2,65). Se `oversikt.md`.

**Materialer:**
- Inntrinn i lys, hvitpigmentert eik som gulvet, kanskje et hakk lysere: korrigert ca. **#b9a79a**, ca. 4 cm tykke.
- Opptrinnene ses ikke tydelig. De ser lukkede og lyse ut (anslått).
- **Vangene er sorte (#1d1e21):**
  - Ytre vange langs øst-, nord- og vestveggen, med sagtannprofil som følger trinnene (225331, 225333).
  - Indre vange og stolper rundt kjernen.
- **Indre rekkverk langs nederste løp** (225342, 225344):
  - Skrått, sort rekkverk i samme stil som rekkverket i gangen: topprekke og loddrette spiler.
  - Det står på innsiden (østsiden, z ≈ 3,48) av løpet som går sørover langs vestveggen.
  - Det går fra stolpen B/C ved kjernen ned til nederste trinn i kjellergangen, ca. 0,9–1,0 m over trinnlinja (anslått).

**Sett fra gangen (225331, 225335, 225337):**
- Gulvet går rett fram til neselista.
- Rett etter første trinn begynner trinnene å vifte mot venstre (vest).
- Til høyre ligger veggen med håndløperen og LED-lyset.
- Til venstre står den sorte nyestolpen.

### Rekkverk i gangnivå (sort, Z-formet rundt åpningen)

Bilder: 225331, 225333, 225335, 225337.
- Sortmalt, trolig tre med stålspiler, **#1d1e21**.
- Topp ca. **1,0 m** over gulvet (anslått; regnet ut fra 225331).
- Stolper ca. 6–7 × 6–7 cm. Flat topprekke ca. 7 × 5 cm. Bunnrekke ca. 5 × 4 cm rett på gulvkanten.
- Loddrette spiler ca. 2–2,5 × 2–2,5 cm, ca. 0,15 m c/c (anslått).

| Felt | Fra → til | Lengde | Spiler |
|---|---|---|---|
| **A** (øst–vest, langs sørkanten av vest-delen) | (x 1,85, z 4,40) ved vestveggen → hjørnestolpe (x 1,85, z ≈ 3,48) | ≈ 0,92–1,05 | 6 |
| **B** (nord–sør, kort retur) | hjørnestolpen (1,85, 3,48) → stolpe (≈1,50, 3,48) | ≈ 0,35 | 2–3 (ses på skrå i alle bildene) |
| **C** (øst–vest, over kjernen) | stolpe (1,50, 3,48) → **nyestolpe** (≈1,50, ≈3,10) ved øverste trinn | ≈ 0,35–0,40 | 2 |

- Nyestolpen og stolpen B/C er høye. De går ned til den indre vangen rundt kjernen.

### Veggmontert håndløper

Bilder: 225331, 225333, 225335, 225337, 225339, 225342.
- Sort #1d1e21, rektangulær ca. 5 × 4 cm.
- Sitter på sorte braketter ca. 4–6 cm fra veggen.
- Høyde ca. 0,9 m over trinnlinja.
- Går sammenhengende:
  - **Østveggen:** øvre ende ved x ≈ 1,40, ca. **0,6–0,7 m over gangulvet**, rett avkappet. Faller nordover til NØ-hjørnet.
    - Høyden er målt mot baddøras karm (hull 2,15) i 225324, 225327 og 225333. Det gir ca. 0,8–0,9 m over første inntrinn.
  - Gjæret hjørne, så **nordveggen** fallende vestover.
  - Hjørne, så **vestveggen** fallende sørover ned i kjelleren.
- **LED-list (varmhvit) under håndløperen** langs **østveggen** (ca. 1,3–1,4 m, fra øvre ende til NØ-hjørnet) **og
  nordveggen** (ca. 2,0 m). Den lyser ned på trappa og veggen.
  - Ovenfra ses lyset best på østveggen. Nedenfra lyser også nordveggen tydelig (225349, 225625, 225631; `trapp.md`).
  - Langs vestveggen synes ikke noe LED-lys (225342, 225625).

### Ellers

- **To små takpunkter:** runde, sorte og litt kuplede, Ø ca. 6–7 cm. Ingen av dem er tent. Begge plasseringene er anslått, ±0,3 m.
  - **P1, over trappesjakta:** nær nordveggen, ca. 0,3–0,4 m fra den, x ≈ 0,35, z ≈ 3,5–3,8.
    - Det er punktet som ses rett under lampa i 225331 og helt til venstre i 225333. Der står det lenger unna enn lampa.
  - **P2, over gangens gulvdel:** mellom baddøra og soveromsdøra, x ≈ 2,4, z ≈ 3,1.
    - Ses midt i bildet, sør for lampa, i 225324 og 225327 (soveromsmappa).
    - I 225331 skjules det bak overkarmen på stuedøra.
  - Punktene kan være små downlights, sensorer eller røykvarslere. Soverommet har to lignende punkter.
- Ingen radiator, ingen faste skap og ingen knagger i gangen.

## Møbler (ryddig)

- **Ingen møbler** i gangen.
- **Valgfri pynt:** liten grønn potteplante (eukalyptus-aktig) i flettet kurv-potte, Ø ca. 12 cm, ca. 30 cm høy.
  - Står på avsatsen i NV-hjørnet av trappesjakta (225335, 225337, 225339).
  - Den står pent og kan tas med, men kan også utelates.

## Lys

- **Taklampe:** rund, flat LED-plafond. Hvit kant (#f0f0ee) og opal diffuser.
  - Ø ca. **0,35–0,40 m**, ca. 6–7 cm høy (anslått). Trolig samme modell som på soverommet (Ø 0,40) og badet.
  - Lyser ned, og litt lys siver ut over kanten og gir en glorie i taket (225331).
  - Lyset er nøytralt til kaldt hvitt (ca. 3500–4000 K, anslått).
  - **Plassering:** over toppen av trappa, ikke over gulvdelen. Anslått **x ≈ 1,2 (1,0–1,4), z ≈ 3,1 (2,9–3,4)**.
    Det er omtrent over nyestolpen og de første vangetrinnene, ca. 0,3 m nord for øverste trinnkant.
    - 225324 og 225327 (fra soveromsdøra): lampa står langt til venstre (nord) for linja gjennom baddøras nordkarm (x 1,50).
    - 225331: lampa står ca. to tredeler av veien fra kameraet til nordveggen.
    - 225333: lampa ses i hjørnet oppe til venstre. Det hadde den ikke gjort hvis den satt på x ≈ 2,3.
- **LED-list under håndløperen** på øst- og nordveggen: varmhvit, ca. 2700–3000 K. Lyser opp trappa (225331, 225333,
  225335, og nedenfra 225349).
- Bryter: ingen på gangsiden (se Sørvegg). Lyset styres trolig fra stuesiden eller med en sensor.

## Utelatt rot

- Sort jakke/genser hengt over rekkverk A (225331, 225333, 225335).
- Hvit/sort plastsekk på gulvet ved baddøra (225331, 225333).
- Sort søppelbøtte i trådnett i sørøsthjørnet ved baddøra (225333).
- Fotografens sko og fot (225339, 225342, 225344).
- Gjennom døra og trappa ses rot som hører til andre rom:
  - Håndkle over dusjveggen og toalettsaker i hylla på badet (225333).
  - I kjellergangen (225342, 225344): klær, ledninger, verktøy og en lang plate på bukker, sokker og esker.

## Usikkert / anslått

- **Trappeåpningen er ikke målt.** 1,47 / 1,50 / 1,85 og z 3,10 / 3,48 er lest av bildene med plankeskjøter og
  dørkarmer som målestokk (±0,1 m).
  - Eierens «1,54 m» passer med øst-delen (øverste trinn).
  - Vest-delen, med rekkverk A, ser ut til å gå ca. 0,3 m lenger sør.
- **Antall trinn og opptrinnshøyde** (15 opptrinn à ca. 0,17) er anslått. Etasjehøyden 2,55 er en modellverdi.
  - Selve vifteformen er tydelig, men den nøyaktige delingen av vangetrinnene er ikke det.
- **Kjernen:** plassering x ≈ 1,2–1,5, z 3,10–3,48, og hvordan den ser ut under gangnivå (åpen eller lukket vange)
  er usikkert.
- **Avsatsen langs nordveggen:** høyden er usikker (0,15–0,30 under gulvet; modellverdi 0,25). Det er også usikkert om
  den fortsetter langs vestveggen.
- **Kjellerplanen og bildene:** kjellerplanen tegner den smale delen av GANG 1,83 m bred (gangen her er 2,07). Det er
  avklart i `trapp.md` og `entre-gang-kjeller.md`: ved trappa er sjakta 2,07 bred (døra under trappa sitter i en grunn
  nisje), og først sør for nisjen er GANG ca. 1,8 bred.
- **Gulvlist:** ser rosa-beige ut på bildene, men kan være hvit som i stua.
- **Tak:** hvitt eller SAND. Høyden 2,40 er ikke målt i gangen.
- **Baddør og soveromsdør:** hull, bredde og høyde er tatt fra planen og nabonotatene.
  - Begge dørbladene ses: baddøra i 225324 og 225327, soveromsdøra i soveromsbildene. Begge er sorte med ett innfelt felt.
- **Gangens lysbryter:** ingen ses. Veggen øst for stuedøra er fotografert (225324, 225327) og har ingen bryter.
- **Taklampas plassering** (x ≈ 1,2, z ≈ 3,1) er regnet ut fra perspektivet i 225324, 225327 og 225331, ±0,3 m.
  - Bildene er enige om at lampa henger over trappetoppen.
  - Den eksakte z-verdien varierer mellom bildene, fra 2,9 til 3,4.
- **Takpunktene P1 og P2:** usikkert hva de er. Plasseringen er ±0,3 m.
  - At det er to punkter, er regnet ut fordi lampa står sør for punktet i 225331, men nord for punktet i 225324 og 225327.
- **Planens grå felt utenfor nordveggen** (ved gangen og soverommet, ca. z 2,9–4,9): det ligner trappesymbolet fra
  kjellerplanen og er trolig et feilplassert planobjekt. Bildene viser ingen dør eller trapp i nordveggen. Ignoreres.

## Bilder

| Fil | Viser |
|---|---|
| `20261020_225331.jpg` | Fra stua gjennom stuedøra (SV-hjørnet), mot nord. Soveromsdøra på vestveggen til venstre, rekkverk A/B/C, øverste trinn til høyre, avsatsen med planten, håndløperen med LED, taklampa og takpunkt P1 nær nordveggen. Til høyre i døråpningen ses stuedøras sorte blad på skrå, med rund rosett. Rot: jakke på rekkverket, plastsekk. |
| `20261020_225333.jpg` | Fra soveromsdøra mot øst/nordøst. Den åpne baddøra med sort karm og terskel; badet innenfor (dusj i glass, sort høyskap, mørkt grått gulv). Øverste trinn og LED-håndløperen rett nord for baddøra, gulvlisten mellom. Rot: jakke, plastsekk, trådbøtte. |
| `20261020_225335.jpg` | Fra midt i gangen mot nord, ned i trappeåpningen. Rekkverket, nyestolpen, de første vangetrinnene, avsatsen med planten, LED-håndløperen på østveggen, stikkontakten på vestveggen og soveromsdøras terskel. Til høyre baddøras karm og terskel med lys forkant. Plankeskjøtene brukt som målestokk. |
| `20261020_225337.jpg` | Fra øverste trinn rett ned/nordover. Neselista, første trinn, vangetrinnene som vifter rundt nyestolpen, ytre sort vange, håndløperen øst → nord → vest, avsatsen i NV-hjørnet. Nede til høyre baddøras terskel. |
| `20261020_225339.jpg` | Bratt ned i sjakta (mot vest-nordvest). Vangetrinnene går ca. 180° rundt kjernen, håndløperen på nordveggen svinger ned langs vestveggen, planten på avsatsen i hjørnet. |
| `20261020_225342.jpg` | Fra trappa, halvveis nede, mot sør/ned. Gangens gulvkant med hvit kantflate og rekkverk A oppe til venstre, nederste trinn langs vestveggen, håndløperen på vestveggen (uten synlig LED), kjellergangen og døra til vaskerommet. Rot i kjellergangen. |
| `20261020_225344.jpg` | Fra nederste del av trappa, sørover langs kjellergangen. Siste trinn, sort indre rekkverk til venstre, håndløperen til høyre. Kjellergangen med dør på østsiden, mørk vaskeromsdør på vestsiden og et opplyst rom i sørenden (entréen med ytterdøra, bekreftet i kjellerbildene). Mye rot på gulvet. |
| `Soverom 1etg/20261020_225324.jpg` (liggende) | Fra soveromsdøra rett mot øst. Baddøra med sort dørblad, åpent inn på badet med hengsler i sør. Håndløperen med LED, rekkverket, taklampa oppe til venstre og takpunkt P2 midt oppe. Til høyre veggstykket øst for stuedøra (glatt, med gulvlist) og stuedøra med kjøkkenet bak. Rot: plastsekk og bøtte. |
| `Soverom 1etg/20261020_225327.jpg` | Som 225324, stående format. Viser mer av gangtaket med lampa og P2. |

## Kontrollert

Uavhengig kontroll (2026-10-21). Jeg har sett gjennom alle 7 bildene i `gang 1etg`, begge planene, fakta-fila og
`room-spec.json`. I tillegg har jeg brukt `Soverom 1etg/20261020_225324.jpg` og `225327.jpg`, som viser gangen fra
soveromsdøra. Dette er endret:

1. **Taklampas plassering er flyttet** fra x ≈ 2,3 (over gulvdelen) til **x ≈ 1,2, z ≈ 3,1**, over trappetoppen.
   - Fra soveromsdøra (225324, 225327) står lampa langt nord for linja gjennom baddøras nordkarm (x 1,50).
   - I 225331 står den ca. to tredeler av veien inn mot nordveggen.
   - Med x ≈ 2,3 hadde den ikke vært synlig i 225333.
2. **Taklampas størrelse** er endret fra Ø 0,28–0,30 til **0,35–0,40**. Det følger av at lampa står lenger unna
   kameraet, og det stemmer med soverommets lampe (Ø 0,40), som trolig er samme modell.
3. **Takpunktet er gjort om til to punkter, P1 og P2.**
   - Den gamle teksten la ett punkt «0,4–0,6 m nord for lampa» på x 1,0–1,4. Det passet ikke med dens egen lampe på x 2,3.
   - I 225331 står punktet bak (nord for) lampa, ved nordveggen. I 225324 og 225327 står et punkt sør for lampa, over gulvdelen.
     Ett og samme punkt kan ikke stå begge steder.
4. **Veggen øst for stuedøra** (z 2,32–3,36) var oppgitt som ikke fotografert. Den ses i 225324 og 225327: glatt vegg,
   med gulvlist, uten bryter og uten stikkontakt.
   - Ingen gangvegg har synlig bryter, så det står nå at det ikke skal modelleres bryter på gangsiden.
5. **Baddøras dørblad** var oppgitt som ikke synlig. Det ses i 225324 og 225327: sort, ett innfelt felt, åpent inn på
   badet med hengsler i sør. Det bekrefter planens slagretning.
6. **Håndløperens øvre ende** er endret fra 0,9 m til **0,6–0,7 m** over gangulvet. Høyden er målt mot baddøras karm i
   tre bilder, og det tilsvarer ca. 0,8–0,9 m over første inntrinn.
7. **Lagt til en fast ting som manglet:** det skrå, sorte indre rekkverket langs nederste løp (225342, 225344). Før sto
   det bare i bildelista.
8. **«Kort svar» er presisert.** 1. etasje har en ytterdør, terrassedøra i stua (`door-terrasse`), men den er ikke
   hovedinngangen. Ytterdøra er i kjelleren, som fakta-fila sier, og skal bekreftes i kjellernotatet.
9. **Avvik mot planen som ikke var nevnt:**
   - Planen tegner stueåpningen på z 3,30–4,30. Bildene og `room-spec` har den helt inne i sørvesthjørnet.
   - Planen har et grått felt utenfor nordveggen. Det er trolig et feilplassert trappesymbol og ignoreres.
10. **Gulvlist:** la til målte forholdstall. Lista leser like rød som gulvet, ikke som veggen, så den er trolig lys eik
    og ikke hvit. Den står fortsatt som usikker.
11. **Trappa:** presisert at øverste «trinn» er gangkanten med neselist, og at første inntrinn under den er nesten rett.

Dette er kontrollert og står som før:
- **Dører:** antall, vegg og retning stemmer for alle tre dørene. Bad på østveggen og soverom på vestveggen henger begge
  i sørkanten og slår inn i sine rom. Stuedøra er på sørveggen, som i `room-spec`.
- **Vegger og trappeåpning:** ingen vindu og ingen dør i nordveggen. Stikkontakten sitter på vestveggen rett sør for rekkverk A.
- **Rekkverk:** Z-formen A/B/C stemmer.
  - Egen perspektivberegning på 225335, med veggbredden 2,07 og dørkarmene som mål, gir A på x ≈ 1,75–1,85 og
    nyestolpen på z ≈ 3,1.
  - Øverste trinnkant ligger ca. 0,05–0,10 m nord for baddøras karm (225324, 225333). Begge deler er innenfor oppgitt ±0,1.
- **Farger:** hex-verdiene er hvitbalansert. Taket ved lampa leser rått R/G ≈ 1,02–1,05 og B/G ≈ 0,94. Veggene leser
  R/G ≈ 1,11 og B/G ≈ 0,85. Det gir SAND for veggene.
- **Rot:** ingen rot har sneket seg inn. Planten på avsatsen står fortsatt som valgfri pynt.

### Krysskontroll mellom rommene (2026-10-21)

Sjekket mot `bad-1etg.md`, `soverom-1etg.md`, `trapp.md`, `entre-gang-kjeller.md` og `ytterdor-ute.md`.

- **Dører fra begge sider stemmer:** baddøra (x 1,50–2,45, hengsler i sør, slår inn på badet) står likt i
  `bad-1etg.md` og ses innenfra i 225421. Soveromsdøra (x 2,11–3,06, hengsler i sør, slår inn) står likt i
  `soverom-1etg.md`. Stuedøra er `door-gang`.
- **Rettet: hovedinngangen** er bekreftet i kjellerbildene (ytterdøra i entréens sørvegg). «Må bekreftes» er strøket.
- **Rettet: høyder.** Trappa er satt til 15 opptrinn à ca. 0,17 og etasjehøyden til 2,55 (kjellertak 2,25 + dekke
  0,30), felles med `trapp.md` og `oversikt.md`. Før sto 14–15 à 0,18–0,19 og 2,6–2,75.
- **Rettet: avsatsen** ligger ca. 0,25 m under gangulvet (0,15–0,30), i høyde med kjellertaket. Før sto 0–0,2. Den er
  toppen av den tykkere grunnmuren.
- **Rettet: LED-lista** lyser langs øst- **og** nordveggen (sett nedenfra i 225349), ikke bare østveggen.
- **Rettet:** usikkerheten om sjaktbredden 1,83/2,07 er avklart (nisjen ved døra under trappa).
- **Står fast:** håndløperens øvre ende ca. 0,6–0,7 m over gangulvet. Jeg målte den på nytt mot baddøras karm i 225333
  (ca. 0,63). `trapp.md` hadde 0,9 og er rettet der.
- **Merk:** veggen mot soverommet har gangflate z 4,40 og soveromsflate z 4,51 her, mens `door-gang` går til z 4,43.
  Designplanen (D1) legger veggen på z 4,43–4,53. Forskjellen er 3 cm.
