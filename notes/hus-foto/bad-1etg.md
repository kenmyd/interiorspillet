# Bad, 1. etasje

Kilder: `notes/hele-huset-fakta.md` (fasit), `plantegning.png` (planmål), de 8 bildene **20261020_225413–225429** som
ligger i `bilder_hus/_1600/vaskerom/` men er tatt inne på **dette** badet (se *Bilder*), og glimtet gjennom baddøra i
`gang 1etg/20261020_225333.jpg` (pluss `Soverom 1etg/20261020_225327.jpg`). Mappa `Bad 1etg` er tom.

Hvorfor 225413–225429 er Bad 1. etg og ikke vaskerommet i kjelleren: høyt smalt frostet vindu ca. 48 × 117 i
nordveggen (planteksten «Vindu mål 48x117»), femkantet dusj i NØ-hjørnet, sort høyskap sør for dusjen, rund påbygd
LED-plafond, svart taklist og lyse steinplater, akkurat som i 225333. Døra sitter i vestveggen nær SV-hjørnet med
hengsler i sør, som i planen. Kjellervaskerommet har dør i østveggen, bred svart vindusnisje og skaprad, og ser helt
annerledes ut. Tidsrekkefølgen passer: 225349 (22.53.49, kjellertrappa nedenfra), så badet oppe 22.54.13–22.54.29, så
vaskeromsdøra i kjelleren 22.54.43.

**Koordinater:** samme system som `src/data/room-spec.json` (meter; +x = sør/plan høyre, +z = vest/plan ned,
+y = opp). Badets innvendige nordøsthjørne (planens øverste venstre innerhjørne) er nøyaktig origo `[0, 0, 0]` i
room-spec. Badet dekker **x 0–2,53, z 0–2,22**. Koordinater står med punktum som i JSON, ellers står tall med komma.

```
               ØST – yttervegg (plan topp), z = 0
        x=0                                                  x=2,53
        ┌─────────────────┬──────┬──────────────────┬──────────┐
        │ DUSJ femkant    │ høy- │ servant 0,80     │ ▫stikk   │
        │o 0,90 × 0,95    │ skap │ + rundt LED-speil│          │
        │               ╱ └──────┴──────────────────┘          │
        ├────────────╱ diagonal front, 2 dører                 │  SØR – innervegg
  NORD  ║ vindu z 0,99–1,47                               ∩ knagg  mot kjøkkennisjen
  yttervegg                                                    │  (blank)
        ├───────┐                                       ┃      │
        │WC-kasse│ WC                           dørblad  ┃      │
        │z1,50–2,15        ⌐ dopapir   ▪ bryter          ┃      │
        └─────────────────────────────────────┤ DØR ca. 0,95  ├┘
               VEST – mot gangen (plan bunn), z = 2,22
```
Skissen viser planens retning: øst øverst, nord til venstre. «o» = dusjsett på nordveggen, «╱» = dusjens diagonale
glassfront, «▪» = lysbryter, «⌐» = dopapirholder, «∩» = vegg-knagg, «┃» = åpent dørblad langs sørveggen.

## Rommet

- **Planmål:** 2,53 m nord–sør (planens bredde, x) × 2,22 m øst–vest (planens høyde, z), altså 5,6 m² innvendig.
- **Naboer:**
  - øst (plan topp): yttervegg
  - nord (plan venstre): yttervegg med vindu
  - sør (plan høyre): innervegg 0,10 m mot kjøkkenets nisje bak høyskapene (`w-nisje-bak` på x = 2,63 i room-spec)
  - vest (plan bunn): innervegg ca. 0,10 m mot gangen (gangens veggflate på z ≈ 2,32), med døra
- **Takhøyde:** 2,40 m flatt (anslått, samme som kjøkken, gang og soverom). I 225419 ligger overkanten av vinduet
  (2,05) ca. 0,35 m under taklista, og i 225333 ligger badetaket på samme nivå som gangtaket.
- **Tak:** glatt og hvitt, ca. **#efefed** (anslått). Rundt hele taket går en **svart taklist/avslutningsprofil**,
  ca. 3–4 cm høy, #1d1e21 (alle bildene). Gangen har ikke en slik list.
- **Gulv:** mørk grå vinyl med skyet betongmønster og uten fuger, samme belegg inn i dusjen uten kant
  (225419, 225429).
  - Hvitbalansert ca. **#5a5759** i innebildene (WC-porselenet som hvitreferanse), med skyer ca. #4d4b4d–#6e6c6e.
    Glimtet i 225333 ga #66676a. Bruk #5a5759.
  - **Ingen gulvlist i tre:** belegget er brettet opp med en smal mørk avslutning, ca. 3–5 cm, #2a2a2c (225413,
    225429).
- **Hvitbalanse:** taklampa er kjølig hvit, så rommet trenger lite fargekorreksjon. Porselenet i 225419 og taket ved
  lampa leser nesten nøytralt (R/G ≈ 1,00–1,04, B/G ≈ 0,94–1,07).

## Vegger

**Felles for alle fire veggene:** samme overflate fra gulv til tak, også inne i dusjen (225419). Det er **lyse
beige-grå steinlook-baderomsplater** med mykt, skyet mønster og **synlige loddrette skjøter ca. hver 0,6 m**
(225423, 225413).
- Hvitbalansert ca. **#c8c5bf**, med mørkere skyer ca. #b2afa9. Rå bildeverdi ca. #a39487 i lampelys.
- **Forslag for spillet:** én stein-tekstur på alle veggene med et svakt, loddrett skjøtenett hver 0,60 m
  (#bcb9b3). Ingen vannrette fuger.
- Ingen gulvlist og ingen maling (Sand/Marrakesh brukes ikke på badet).

### Østvegg (plan topp, yttervegg): from `[0, 0]` to `[2.53, 0]`, normal `[0, 1]`, lengde 2,53

Bilder: 225425 (rett forfra), 225413, 225417, 225427, 225429, og 225333 fra gangen.

- Yttervegg, modelleres 0,30 m tykk som kjøkkenets østvegg (`w-kjokken-ost`). Ingen åpninger.
- **x 0 – ca. 0,95:** dusjens østre retur møter veggen her (se Faste ting).
- **x ≈ 1,05–1,45:** **svart høyskap** (se Møbler).
- **x ≈ 1,50–2,30:** **vegghengt servantskap** med hvit integrert servant, og **rundt LED-speil** over (se Faste
  ting og Møbler). Skapet står inntil høyskapet uten glipe (225425).
- **Stikkontakt:** dobbel, sort, ca. 0,084 × 0,084 (#1c1a19), **x ≈ 2,40, senter ca. 1,05**, rett sør for speilet og
  like over servantens bakkant (225413, 225417, 225423, 225425).
- **x 2,30–2,53:** fri vegg inn til sørhjørnet.
- Ingen radiator.

### Sørvegg (plan høyre, mot kjøkkennisjen): from `[2.53, 0]` to `[2.53, 2.22]`, normal `[-1, 0]`, lengde 2,22

Bilder: 225413 og 225423 (rett forfra), 225425 og 225429 (på skrå).

- Innervegg 0,10 m. På den andre siden står kjøkkenets høyskap (`w-nisje-bak`). Ingen åpninger.
- **Blank vegg.** Bare én liten **sort vegg-knagg** (ca. 3 × 5 cm) ved **z ≈ 0,80, h ≈ 1,15** (anslått). Håndkleet på
  den er rot.
- z ≈ 1,40–2,22: her står dørbladet når døra er åpen. Hold dette feltet fritt.
- Ingen stikkontakter eller brytere.

### Vestvegg (plan bunn, mot gangen): from `[2.53, 2.22]` to `[0, 2.22]`, normal `[0, -1]`, lengde 2,53

Bilder: 225421 (rett forfra), 225419 og speilbildet i 225417.

- Innervegg ca. 0,10 m. På gangsiden ligger trappeåpningen langs x 0–1,47/1,50.
- **Dør:**
  - **Hull** (ytterkant av synlig karm): x ≈ 1,50–2,45, det vil si `offset` ≈ 0,08 fra `from` (x = 2,53) og
    `width` ≈ 0,95, `sill` 0, `height` 2,15. Karmen står ca. 5–8 cm fra sørveggen (225421).
    - Planen tegner åpningen ca. 0,88–0,92 m (x ≈ 1,50–2,42). Bredden 0,95 er anslått med samme forhold som
      `door-gang` (planen 1,00 m mot 1,07 m hull).
  - **Karm/gerikt:** svart #1d1e21, ca. 0,07 m bred, samme stil som `door-gang`.
  - **Dørblad:** svart #1d1e21, ca. 0,83 × 2,08 (anslått), glatt med **ett innfelt felt** (225421, sett innenfra).
  - **Hengsler** på sørkanten (`hinge: "from"`), og døra slår **inn** på badet (`swing: "in"`). Åpent står bladet
    langs sørveggen fra z 2,22 til ca. z 1,40. Det ses i 225421 (hengsler til venstre = sør, vrider til høyre = nord)
    og fra gangen i 225324/225327, og planen tegner det likt.
  - **Vrider** på nordkanten (`handleSide: "to"`), ca. 1,02 m: sort vrider på rosett med vri/WC-lås under.
  - **Terskel:** mørk/svart topp ca. 0,08–0,10 m dyp, med lys forkant mot gangen i samme farge som `door-gang`,
    **#cdbfae** (225333, 225335).
- **Lysbryter:** sort, kvadratisk ca. 0,086 × 0,086 (#151515), **rett nord for karmen, x ≈ 1,42, senter ca. 1,15**
  (225421, og speilbildet i 225417). Det er den eneste bryteren på badet; det er ingen termostat på veggen.
- **Dopapirholder:** sort, vegghengt, **x ≈ 0,85, h ≈ 0,80** (anslått, 225419, 225421), sør for WC-en.
- **Ingen håndkletørker** og ingen radiator (225421 viser hele veggen fra døra til NV-hjørnet).

### Nordvegg (plan venstre, yttervegg): from `[0, 2.22]` to `[0, 0]`, normal `[1, 0]`, lengde 2,22

Bilder: 225419 (rett forfra), 225417, 225413.

- Yttervegg, modelleres 0,30 m som de andre ytterveggene.
- **z 2,22–2,15:** smal veggstripe (ca. 0,07) mellom vestveggen og WC-kassen.
- **z ≈ 1,50–2,15: WC-kasse** (innkasset sisterne), ca. 0,65 bred, 0,20 dyp (x 0–0,20) og ca. 1,10 høy, kledd med
  samme steinplater. Toppen er en flat hylle med lys grå aluminiumskant (#a7a9a8). **Sort trykkplate** ca.
  0,25 × 0,16, senter ca. 0,95 (225419, 225421). Vegghengt WC foran, se Faste ting.
- **Vindu z 0,99–1,47** (fra planen: 0,99 m fra østhjørnet, 0,48 bredt, 0,75 videre til vesthjørnet;
  0,99 + 0,48 + 0,75 = 2,22 ✓). I 225419 måles det til z ca. 1,00–1,44.
  - `offset` 0,75 fra `from` (z = 2,22), `width` 0,48, høyde 1,17.
  - **Sill ca. 0,88, topp ca. 2,05** (225419: overkanten ligger ca. 0,35 m under taket på 2,40). Sillen ligger litt
    lavere enn toppen av WC-kassen.
  - **Frostet glass**, sort ramme #25272b (ca. 0,07), ett sidehengslet/vippbart ramme (åpningsmåte ses ikke).
  - Lysningen er kledd med veggplatene og har en **lys grå kantlist** (#c9cac8, ca. 2 cm) rundt ytterkanten. Liten
    dyp vinduskarm i bunnen, ca. 0,15.
- **z 0–0,90 (inne i dusjen):** dusjsett på veggen ved z ≈ 0,40 (se Faste ting). Dusjens vestre retur møter veggen
  ved z ≈ 0,90, rett øst for vinduet.
- Ingen stikkontakter og ingen radiator.

## Faste ting

- **Dusj** i nordøsthjørnet (225417, 225419, 225425, 225429, 225333).
  - **Form: femkant med avskåret, diagonal front.** To korte faste glassreturer fra veggene og en diagonal front med
    **to svingdører** (rett stanghåndtak på den ene, D-bøyle på den andre, ca. 1,0–1,1 m). Bekreftet i 225419 og
    225429; i 225333 ses det samme.
  - **Mål (anslått):** ca. **0,90 langs nordveggen (z 0–0,90) × ca. 0,95 langs østveggen (x 0–0,95)**. Hjørnepunkter
    ca. `[0, 0.90]` → `[0.37, 0.90]` → diagonal → `[0.95, 0.37]` → `[0.95, 0]`. 225425 antyder at returen langs
    østveggen kan være opp mot 1,0.
  - Klart herdet glass med matt svarte vertikalprofiler #1a1a1a, høyde ca. 2,0. Ingen topprofil.
  - **Dusjsett i matt svart** #1c1c1c på nordveggen, z ≈ 0,40: termostatbatteri ca. 1,0 m med liten hylle, stang opp
    til en **kvadratisk takdusj** (ca. 0,25 × 0,25) på arm ved ca. 2,20, hånddusj på slange i glider (225417, 225419,
    225425).
  - **Sluk:** rundt, børstet stål, Ø ca. 0,15, ca. `[0.50, 0, 0.50]` innenfor diagonalen (225419, 225429).
  - Inne i dusjen er veggene de **samme lyse platene** som resten av badet (ingen mørke plater, i motsetning til
    vaskerommet i kjelleren).
- **WC:**
  - Vegghengt hvitt toalett #f2f2f0, uten skyllekant, ca. 0,36 × 0,54, rim ca. 0,42. **Senter z ≈ 1,83**, fronten mot
    sør, så skålens front står ca. på x 0,74 (225419, 225421). Lokket modelleres lukket.
  - Kassen og trykkplata: se Nordvegg.
- **Servant:**
  - Vegghengt servantskap i matt svart #1f1f22, **0,80 × 0,46**, overkant ca. 0,85, underkant ca. 0,35, med **to
    skuffer** (225413, 225425, 225429).
  - **Hvit integrert servantplate med kum** #f2f2f0 (helstøpt, avrundet) og **matt svart ettgreps batteri**.
  - `mount` wall, `position` `[1.90, 0.35, 0]` (midt på baksiden), `rotationDeg` 0 (fronten mot vest).
- **Rundt LED-speil** over servanten: **Ø ca. 0,80** (0,70–0,90), senter ca. x 1,90, h ca. 1,48 (underkant ca. 1,08),
  med varmhvit bakbelysning som gir en lys ring på veggen (225413, 225417, 225425). Ikke speilskap.
- **Avtrekksventil:** rund, mørk grå, Ø ca. 0,15, i taket nær nordveggen over vinduet, ca. `[0.35, 2.40, 1.20]`
  (225417, 225419).
- **Varmekabler i gulvet** (anslått, usynlige). Ingen termostat synes.
- **Taklist** svart #1d1e21, 3–4 cm, rundt hele taket.
- **Knagg** på sørveggen og **dopapirholder** på vestveggen (se Vegger).
- **Terskel og dør:** se Vestvegg.

## Møbler (ryddig)

- **Høyskap, svart** (225413, 225417, 225425, 225333):
  - Står på østveggen like sør for dusjen, **x ≈ 1,05–1,45**. Bredde ca. 0,40 og dybde ca. 0,30 (anslått).
  - Vegghengt, underkant ca. 0,15, topp ca. 2,05 (ca. 0,35 under taklista).
  - Matt svart #1f1f22, **to glatte dører** (øvre ca. 1,05–2,05, nedre ca. 0,15–1,05) **uten synlige håndtak**
    (trykklås). I 225333 står den øvre døra åpen med toalettsaker; den modelleres **lukket**.
  - `mount` wall, `position` `[1.25, 0.15, 0]`, dims w 0,40 / d 0,30 / h 1,90, `rotationDeg` 0.
- Ingen løse møbler (ingen krakk eller kurv) og ingen tekstiler (håndkle eller baderomsmatte). Slike ting er rot.

## Lys

- **Taklampe:** rund, påbygd LED-plafond med opal front og **mørk grå kant**, Ø ca. **0,40–0,45**, ca. 0,07 høy
  (225413, 225417, 225419, 225427). Midt i taket, ca. `[1.25, 2.40, 1.10]`. Kjølig/nøytralt hvitt, ca. **4000 K**
  (anslått), ca. 1500 lm.
- **Én innfelt downlight** med sort ring, Ø ca. 0,08, i taket nær døra, ca. `[2.20, 2.40, 1.85]` (225413 øverst til
  høyre, 225421 øverst til venstre). Varmhvit, ca. 3000 K (anslått).
- **LED-speilets bakbelysning:** varmhvit ring, ca. 3000 K og ca. 400 lm (anslått).
- **Vindu:** nordvendt med frostet glass. Om dagen gir det svakt, kjølig dagslys.

## Utelatt rot

- Håndklær: på knaggen på sørveggen (225413, 225423) og over dusjglasset (225417, 225419, 225333).
- Såpeflaske på servanten (225413, 225417).
- Badevekt på gulvet foran dusjen (225417, 225419, 225429).
- Liten sort pedalbøtte ved foten av høyskapet (225425, 225429, 225333).
- Plante i vinduskarmen og duftpinner/lys på WC-hylla (225417, 225419).
- Toalettsaker i høyskapet (225333). Skapet modelleres lukket.
- Fotografens føtter og bein (225429) og speilbildet av fotografen (225417).
- Fra gangbildene, utenfor badet: hvit plastpose foran baddøra, nettingbøtte i gangens SØ-hjørne og jakke over
  trapperekkverket (225331, 225333, 225335).

## Usikkert / anslått

- **Målene langs østveggen** er lest av ett nesten rett bilde (225425) med vidvinkel: dusj 0,95 (0,90–1,05),
  høyskap 0,40 og servant 0,80. De ligger ±0,1 m.
- **Dusjens form** er sikker (femkant). Målet 0,90 × 0,95 er anslått.
- **Speilet:** diameter 0,70–0,90 og senterhøyde ±0,1.
- **WC-kassen:** bredde 0,65 og høyde ca. 1,10 er anslått. Den står nesten helt inntil vestveggen (ca. 0,07 luft).
- **Høyder** på bryter (1,15), stikkontakt (1,05), knagg (1,15) og dopapirholder (0,80) er anslått fra bildene.
- **Vinduet:** sill 0,88 og topp 2,05 er målt mot taket i 225419; åpningsmåten ses ikke.
- **Vegg- og gulvfarger** er hvitbalansert mot porselenet. Gulvet kan være litt lysere (#66676a fra 225333).
- **Takhøyden** 2,40 er anslått.
- **Døra:** hullbredden 0,95 og bladet 0,83 × 2,08 er anslått. Planen tegner åpningen ca. 0,88–0,92 m og slagbuen med
  radius ca. 0,76, så det kan være en 8M-dør.
- **Plan mot plan:** det utvendige målet i venstre marg står som «2,06 m» for badets del av nordveggen. Det er mindre
  enn innvendig 2,22, mens 0,99 + 0,48 + 0,75 = 2,22 stemmer, så 2,22 er brukt.
- **Eieren bør bekrefte** at 225413–225429 er badet i 1. etasje. Alt i bildene peker dit (se øverst).

## Bilder

Badbildene ligger i mappa `vaskerom/`:

| Fil | Viser |
|---|---|
| `vaskerom/20261020_225413.jpg` | Fra nordre del mot **sør**. Høyskapet tett til venstre, servant med rundt LED-speil og stikkontakt på østveggen, den blanke sørveggen med knagg og håndkle, døra på vestveggen til høyre (åpen, sett på skrå). Plafond og downlighten ved døra i taket, svart taklist. |
| `vaskerom/20261020_225417.jpg` | Fra SV-delen mot **nordøst**. WC-kasse med trykkplate og WC til venstre, det høye frostede vinduet, femkantdusjen med takdusj og termostat, høyskapet, servanten og LED-speilet. Ventilen i taket over vinduet. I speilet: døra og bryteren nord for den, og fotografen. Rot: badevekt, plante, håndkle. |
| `vaskerom/20261020_225419.jpg` | Fra søndre del mot **nord**, nordveggen rett forfra. Dopapirholder på vestveggen, WC-kasse og WC, vinduet (målt z ca. 1,00–1,44, topp 0,35 under taket), dusjen med diagonalfront, dusjsett og stålsluk. Høyskapet tett til høyre. |
| `vaskerom/20261020_225421.jpg` | Mot **vest**, vestveggen rett forfra. Døra lukket (ett innfelt felt, hengsler i sør, vrider i nord), bryteren rett nord for karmen, dopapirholder, WC-kassen til høyre. Downlight med sort ring i taket nær døra. |
| `vaskerom/20261020_225423.jpg` | Mot **sør**/sørøst. Servant og LED-speil med stikkontakt til venstre, den blanke sørveggen med knagg og loddrette plateskjøter, døra (åpen) til høyre. |
| `vaskerom/20261020_225425.jpg` | Mot **øst**, østveggen rett forfra. Dusjen til venstre, høyskapet, servanten med LED-speilet og stikkontakten, sørveggen med knagg til høyre. Brukt til målene langs østveggen. |
| `vaskerom/20261020_225427.jpg` | Taket mot øst: plafonden, svart taklist, takdusjen, høyskapets topp og LED-speilet. |
| `vaskerom/20261020_225429.jpg` | Rett ned mot gulvet, blikk mot øst: dusjens femkantfotavtrykk med sluk, høyskapet, servanten, WC-en nederst til venstre, gulvbelegget og den mørke oppbrettkanten. Rot: vekt, pedalbøtte, håndkle, fotografens føtter. |
| `gang 1etg/20261020_225333.jpg` | Fra stuedøra mot nordøst inn gjennom den åpne baddøra: dusjhjørnet, takdusjen, høyskapet med åpen øvre dør (rot), plafonden, taklista og gulvet. |
| `gang 1etg/20261020_225335.jpg` | Baddørens nordre karm og terskelen med lys forkant, nede til høyre. |
| `gang 1etg/20261020_225337.jpg` | En flik av baddørens karm og badegulvet nede til høyre. |
| `Soverom 1etg/20261020_225327.jpg` | Fra soveromsdøra: badet gjennom døra med mørkt gulv, høyskap, rundt speil med baklys og sort servantskap. |
| `gang 1etg/20261020_225331, 225339, 225342, 225344` | Viser ikke badet. Den sorte døra i 225344 er vaskeromsdøra i kjelleren. |

## Kontrollert

### Første kontroll (2026-10-20, bare 225333)

Den første versjonen bygde bare på glimtet i 225333. Kontrollen da bekreftet rommets mål og orientering, vinduet,
døras plass og slagretning, dusjhjørnet og høyskapet, endret dusjen til femkant, terskelfargen til #cdbfae,
taklampas diameter, ventilplassen, hånddusjhøyden og kameraet for 225333. Resten av innredningen var anslått som et
typisk norsk bad.

### Krysskontroll mellom rommene og retting med 225413–225429 (2026-10-21)

Jeg har sett alle 8 badbildene i `vaskerom/` (225413–225429), 225333/225335/225337 og 225324/225327, planen og
`vaskerom.md` (Tillegg). Det anslåtte innholdet var feil på flere punkter og er erstattet med det bildene viser:

1. **WC** står på **nordveggen** vest for vinduet (kasse z ca. 1,50–2,15, WC senter z ≈ 1,83), ikke på sørveggen.
2. **Servanten** er 0,80 med hvit integrert kum og står på x ca. 1,50–2,30, rett sør for høyskapet. Over den henger et
   **rundt LED-speil** (Ø ca. 0,80), ikke et speilskap. Speilskapet er strøket.
3. **Håndkletørkeren** og **termostaten** finnes ikke (225421 viser hele vestveggen). De er strøket.
4. **Lagt til:** dopapirholder på vestveggen, sort knagg på sørveggen, én downlight med sort ring ved døra,
   den mørke oppbrettkanten på gulvet og de loddrette plateskjøtene.
5. **Flyttet:** stikkontakten til x ≈ 2,40, h ≈ 1,05 (sør for speilet), bryteren til x ≈ 1,42, h ≈ 1,15, ventilen
   til ca. `[0.35, 2.40, 1.20]` over vinduet og høyskapet til x ca. 1,05–1,45 (0,40 bredt, uten håndtak).
6. **Vinduet:** sill 0,97 → **0,88**, topp 2,14 → **2,05** (målt mot taket i 225419). Frostet glass og lys grå
   kantlist er bekreftet.
7. **Gulvfarge:** #66676a → **#5a5759** (innebildene, porselen som hvitreferanse).
8. **Dusjen:** femkanten er bekreftet; sluket er rundt og av stål; veggene inne er de samme lyse platene.
9. **Dører fra begge sider:** baddøra er den samme fra gangen (`gang-1etg.md`: x 1,50–2,45, hengsler i sør, slår inn)
   og fra badet (225421). Ingen andre åpninger. Det stemmer.
10. Bildetabellen er utvidet med de 8 badbildene. `soverom-1etg.md` sa at 225327 var «det eneste» bildet av badet; det
    er rettet der.
