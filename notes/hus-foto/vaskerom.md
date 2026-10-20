# Vaskerom / bad i kjelleren

Kilder: `notes/hele-huset-fakta.md` (fasit), `bilder_hus/_1600/plantegning_kjeller.png` (904 × 959 px, ca. 60,2 px/m)
og bildene i `bilder_hus/_1600/vaskerom/`.

**Viktig om bildemappa:** bare de 12 siste bildene (225443–225525) er fra vaskerommet i kjelleren. De 8 første
(225413–225429) viser et **annet bad**: beige steinplater, rundt LED-speil, femkantet dusj og høyt smalt vindu.
Det er **Bad 1. etg** (se *Tillegg* nederst, og `bad-1etg.md`, som nå bygger på dem). Alt i hoveddelen gjelder bare
kjellerens vaskerom.

**Lokale koordinater (meter):** origo i rommets innvendige **nordøsthjørne**, det vil si planens øverste venstre
innerhjørne (plan-px ≈ 126, 377).
- **x** = avstand sørover fra nordveggen, 0 → 2,64 (planens bredde, mot høyre)
- **z** = avstand vestover fra østveggen, 0 → 4,08 (planens høyde, nedover)
- Retningene er de samme som spillets +x (sør) og +z (vest).
- Andre innerhjørner i plan-px: SØ (285, 377), NV (126, 620), SV (285, 620).

```
                 ØST – mot GANG (plan topp), z = 0
      x=0                                                  x=2,64
      ┌────────────────────┬───────────────────────┬─────────────┐
      │ DUSJ 1,08 × 1,17   │ ║håndkletørker  ▪bryter│  DØR 0,87   │
      │ mørke panel N+Ø    │                       │  ↙ slår inn │
      │ o batteri på N     ├─┘ (glass)             └──── blad ───┤
      │                                                          │ z 1,68
 NORD │  [WC-kasse 0,78]   z 1,46–2,24            skittentøyskap  │ SØR
 yttervegg  WC                                     høyt skap (VB?) │ mot
      ║                                            vask+tørk stablet│ KJELLER-
      ║ vindusnisje 1,28 bred, z 2,54–3,82         (alle 0,60 dype)│ STUE
      ║ (h 1,50–2,22)                                              │
      ├──────────── benk 0,62 dyp, kum + speilskap ────────────────┤ z 3,46
      └────────────────────────────────────────────────────────────┘ z 4,08
                 VEST – mot SOVEROM (plan bunn)
```

## Rommet

- **Plan:** «2,03 × 4,08 m». **Tegningen og bildene gir ca. 2,64 × 4,08 m** (se *Usikkert*). Innvendig flate
  ca. 10,8 m².
  - Lengden 4,08 (øst–vest) stemmer med tegningen.
  - Bredden (nord–sør) er tegnet 157 px ≈ 2,61 m. Det er samme bredde som SOVEROM rett under, som har teksten
    2,63 m (7,41 m² = 2,63 × 2,82).
  - Langs vestveggen viser bildene en benk med standardmoduler: 0,30 + 0,60 + 0,60 + en dørmodul på ca. 0,55–0,70
    (225443, 225501). I tillegg kommer benkehjørnet under maskinsøylas overskap (0,60). Til sammen blir det ca.
    2,6–2,8 m, ikke 2,0. En 50 cm kum får ikke plass i en 40-modul, så rommet kan ikke være 2,03 m bredt.
  - Østveggen er bare planmål lagt sammen: dusj 1,08 + vegg 0,62 + dør 0,87 + stubb 0,06 = 2,63. Bildene viser en
    litt annen fordeling (se *Usikkert*).
  - **Bruk 2,64 m.**
- **Naboer:**
  - nord (plan venstre): yttervegg, ca. 0,27 m i planen, med vindu
  - øst (plan topp): innervegg ca. 0,15 m mot GANG. Døra sitter like sør for trappefoten.
  - sør (plan høyre): innervegg mot KJELLERSTUE (tegnet tykk, ca. 0,25)
  - vest (plan bunn): innervegg ca. 0,12 mot SOVEROM
- **Takhøyde: ca. 2,30 m** (anslått, mulig 2,22–2,35). **Felles modellverdi for hele kjelleren: 2,25**
  (krysskontrollen, `oversikt.md`; karmmålingen her gir 2,23–2,26). Gulvet ligger på verdens-y −2,55.
  - Kontrollmålt i 225508, der østveggen ses nesten rett forfra. Gulv–tak og gulv–gerikttopp er ca. 460 og 438 px.
    Med gerikttopp på 2,15 som `door-gang` gir det 2,23–2,26.
  - Maskinsøyla i 225505/225512 gir ca. 2,30: vaskemaskin 0,85 + tørketrommel 0,85 + glipe + overskap ca. 0,34 +
    toppanel ca. 0,16.
  - **Bruk én takhøyde for hele kjelleren.** kjellerstue.md har 2,22 og entre-gang-kjeller.md har 2,30.
- **Tak:** glatt, hvitt, matt, ca. **#ebeae6** (anslått; leser grått fordi spottene lyser nedover).
  - **Svart taklist** #1d1e21, ca. 4–5 cm høy, rundt hele rommet på de malte veggene.
  - Taklista går ikke over dusjpanelene (de går helt opp til taket), og ikke over skapraden (toppanelet går til
    taket).
- **Gulv:** grått våtromsbelegg (vinyl) med skyet betong-/steinmønster, uten fuger. Samme belegg går inn i dusjen
  uten kant eller terskel.
  - Hvitbalansert grunnfarge ca. **#8c8789** (svakt kjølig grå), med skyer ca. #737072 og #a3a0a1.
  - **Ingen fotlist:** belegget er brettet opp på veggen (hulkil, ca. 5–8 cm, anslått) med en smal mørk
    avslutning (225450, 225451).
- **Hvitbalanse:** WC-porselenet er referanse (225450: rå #d8cfbe, 225451: #dfd2c5).
  - Faktor R × 0,95, G × 1, B × 1,08. Taket gir det samme. Alle hex under er korrigert.
  - Tørketrommelen leser blåhvit etter korreksjon (optisk hvitt plast) og er ikke brukt som referanse.

## Vegger

**Felles:** malte, glatte, matte vegger (våtromsmaling) i **lys, dempet grågrønn (salvie)**, ca. **#b8bfb5**
(anslått).
- Korrigert måling i spottlys: #a7aaa8 / #a5aaa8. I de rå bildene ser veggene tydelig grønnlige ut ved siden av de
  varme skapene. Kan justeres mot #bfc4bb.
- WC-kassen har samme farge.
- **Unntak:** dusjens to vegger, se Faste ting.
- Ingen radiator noe sted. Varmen kommer fra håndkletørkeren og trolig varmekabler (se under).

### Nordvegg (plan venstre, yttervegg), z 0 → 4,08

- **z 0–1,17:** bakveggen i dusjen, kledd med mørke panel (se Faste ting). Termostatbatteriet sitter her.
- **z ≈ 1,46–2,24:** **innkasset sisterne / WC-kasse**, 0,78 bred, ca. 1,15 høy og ca. 0,20 dyp. Vegghengt WC midt
  på, z ≈ 1,85.
  - Planen tegner kassen 0,8 bred på z 1,56–2,36. Bildene viser ca. 0,3 m luft til dusjglasset og ca. 0,3 m til
    vindusnisja, derfor er den flyttet ca. 0,1 m østover.
- **Vindu (vindusnisje):**
  - **z ≈ 2,54–3,82** (bredde 1,28 som i planen; planen har z 2,46–3,75). Nisjas vestkant er ca. 0,26 m fra
    nordvesthjørnet, så nisja går litt inn over benkeenden (benken starter på z 3,46).
  - **Sill (nisjebunn) ca. 1,50 m, topp ca. 2,22 m** (rett under taklista), altså ca. 0,72 m høy (anslått,
    225446/225450/225451).
  - Dyp nisje (ca. 0,25 m), kledd helt i **svart/mørk antrasitt** (#1f1f20) med dyp, flat bunnhylle.
  - Vinduet står innerst med svart ramme. Glasset ser klart ut og er mørkt om kvelden. Åpningsmåten ses ikke.
- **Håndklekrok:** liten, sort, under vinduet, z ≈ 3,30, høyde ca. 0,95–1,0 (anslått). Det henger håndklær på den
  (rot).
- Ingen stikkontakter eller brytere.

### Østvegg (plan topp, mot GANG), x 0 → 2,64

- **x 0–1,08:** sideveggen i dusjen, kledd med mørke panel helt til taket.
- **x ≈ 1,18:** **håndkletørker / håndklestang**, ett loddrett rør i matt svart (Ø ca. 3 cm) fra ca. 0,05 til
  ca. 1,80 m over gulvet. Rundt veggfeste nede ved ca. 0,30 og krok øverst (anslått, 225508 rett forfra og 225446).
  Står ca. 0,10–0,15 sør for dusjglasset.
- **x ≈ 1,65, høyde ca. 1,05:** **lysbryter**, enkel, sort, ca. 8 × 8 cm. Den sitter **rett inntil geriktens nordkant**
  (225508, 225510, 225446).
- **Dør:** hull **x 1,71–2,58** (0,87 m inkl. karm, fra planen og bekreftet i 225508). Høyde **ca. 2,15** inkl.
  karm (anslått, samme som `door-gang`). x 2,58–2,64 er en smal veggstubb mot sørøsthjørnet. Planen har 0,06;
  225508 antyder ca. 0,1.
  - **Hengsler på sørkanten.** Døra slår **inn** i vaskerommet og legger seg mot sørveggens østre del, z ≈ 0–0,85.
    Det stemmer med planens bue (225443, 225508, 225510).
  - **Dørblad:** mørk antrasitt/sort, ca. #1d1e21 (målt #454547 i ganglys), ca. 0,80 × 2,05 (anslått). Glatt blad
    med **ett innfelt felt** (fresespor ca. 8–10 cm inn), samme stil som `door-gang`.
  - **Karm/gerikt** i samme mørke farge, ca. 6–7 cm, profilert.
  - **Vrider:** sort, med liten sort rosett/lås, ca. 1,05 m. Den sitter på nordkanten (fri kant).
  - **Terskel / overgang:** Gangens lyse eikegulv, eller en eiketerskel i samme farge, går gjennom hele
    veggtykkelsen (225443). Bruk kjellergangens gulvfarge **#bdb2a3** (entre-gang-kjeller.md), ikke #cdbfae fra 1. etg.
    - Mot vinylen inne er det en smal mørk overgangslist, ca. 3–4 cm (225508). Ingen tydelig forhøyning.
    - Trappa har åpne trinn i lys eik, svart vange og svart håndløper på veggen, rett nord for døra (225443).
- Ingen stikkontakter.

### Sørvegg (plan høyre, mot KJELLERSTUE), z 0 → 4,08

- **z 0–1,68:** fri vegg. Dørbladet slår inn her.
  - **Sort dobbel knagg** ved z ≈ 1,35, høyde ca. 1,65 (anslått, 225505). Jakke på knaggen = rot.
- **z 1,68–4,08 (2,40 m, som planens «2,40 m»): innebygd skaprad fra gulv til tak, 0,60 dyp** (fronter på x 2,04).
  Detaljer under Faste ting. Fra øst:
  - skittentøyskap z 1,68–2,28
  - høyt skap z 2,28–2,88
  - vaskemaskin + tørketrommel stablet z 2,88–3,48
  - benkens hjørne z 3,48–4,08
- **Stikkontakt** på sørveggen i nisja over benkehjørnet, z ≈ 3,65, høyde ca. 1,05. Sort, enkel (225505).

### Vestvegg (plan bunn, mot SOVEROM), x 0 → 2,64

- **Benk langs hele veggen**, x 0–2,64, 0,62 dyp (z 3,46–4,08), overkant 0,90. Se Faste ting.
- **Speilskap** over kummen (se Møbler), x ≈ 0,22–1,02.
- **Stikkontakter**, doble og sorte, ca. 15 × 8 cm (225501, 225505):
  - nord for speilskapet, x ≈ 0,18, høyde ca. 1,12
  - sør for speilskapet, x ≈ 1,50, høyde ca. 1,10
- **Overskap** og toppanel i sørenden (x 2,04–2,64) hører til skapraden på sørveggen.

## Faste ting

- **Dusj** i nordøsthjørnet, **x 0–1,08 × z 0–1,17** (planens grå felt; bildene stemmer).
  - **Vegger:** nord- og østveggen inne i dusjen er kledd med **mørke våtromsplater**, fra gulv til tak, med
    skifer-/betongimitasjon. Grunnfarge ca. **#5a5657**, lysere skyer ca. #77726f og mørkere ca. #3f3c3c
    (225450, 225525). Platene går også opp over glasset til taket.
  - **Glass:** klart herdet glass med **matt svarte profiler** (#151515), høyde ca. 2,00 m (anslått; toppen står ca.
    0,3 m under taket).
    - Front mot sør (langs x = 1,08, z 0–1,17): ett fast felt og ett **skyvedørsfelt** med sort stanghåndtak.
    - Fast sidefelt mot vest (langs z = 1,17, x 0–1,08).
  - **Dusjsett i matt svart** på nordveggen, z ≈ 0,5 (anslått):
    - termostatbatteri med liten hylle ved ca. 1,05 m
    - stang opp til en kvadratisk takdusj (ca. 0,25 × 0,25) på arm ved ca. 2,15 m
    - hånddusj på slange i glider
  - **Sluk:** rundt, hvitt/stål, Ø ca. 0,15, ca. x 0,60 / z 0,70 (anslått). Det er det eneste synlige sluket, men et
    sluk under maskinene kan ikke utelukkes.
- **WC:**
  - **Kasse:** z 1,46–2,24 på nordveggen, ca. 1,15 høy og 0,20 dyp, malt i veggfargen. Flat topphylle med lys
    grå/aluminium kantlist (#a7a9a8).
  - **Trykkplate:** sort, ca. 0,24 × 0,16, midt på kassen, senter ca. 0,95 m.
  - **Toalett:** vegghengt, hvitt (#f2f2f0), uten skyllekant, ca. 0,36 × 0,54, rim ca. 0,42. Senter z ≈ 1,85,
    fronten mot sør. Lokket modelleres **lukket** (det står åpent på bildene).
- **Håndkletørker** på østveggen, se Østvegg.
- **Benk på vestveggen**, x 0–2,64, z 3,46–4,08:
  - **Benkeplate:** laminat i varm grå betonglook, ca. **#938b85** med lysere og mørkere skyer, ca. 3 cm tykk, med
    overkant 0,90.
  - **Kum:** svart kompositt-kjøkkenkum (enkel, kvadratisk), ca. 0,50 × 0,42, nedfelt med senter x ≈ 0,60. Sort
    ettgreps kjøkkenbatteri bak kummen.
  - **Fronter:** matt lys greige, ca. **#b0a89f**, med svarte stanghåndtak (ca. 16–20 cm, #1a1a1a). Innfelt sokkel
    ca. 0,08 m i samme farge, litt mørkere. Fra nord (anslått):
    - smal modul med 2 skuffer, x 0–0,30, håndtak vannrett øverst på hver skuff
    - kummodul med 2 skuffer, x 0,30–0,90
    - skuffemodul med 2 skuffer, x 0,90–1,50
    - dørmodul med én dør, x 1,50–2,04: hengslet i sør, loddrett håndtak øverst ved nordkanten
  - Bak dørmodulen er sørvesthjørnet blindt. Fronten møter maskinsøylas side i x 2,04.
- **Innebygd skaprad på sørveggen**, z 1,68–4,08 (fronter på x 2,04), i samme greige #b0a89f:
  - **Toppanel/fyllstykke:** fra ca. 2,13 m til taket langs hele raden, i flukt med frontene.
  - **Skittentøyskap**, z 1,68–2,28: øverst et fast frontpanel (ca. 0,30 høyt), under det **3 vippefronter**
    (skittentøyskuffer), uten synlige håndtak (trykk-åpning). Modelleres **lukket**; alle tre står åpne med klær på
    bildene. Østre sidevange er synlig fra døra.
  - **Høyt skap**, z 2,28–2,88: én glatt dør fra sokkel til toppanel, uten håndtak. **Varmtvannsberederen (VB)
    står trolig her**. Den synes ikke; planen skriver «VB» i østenden av raden. Modelleres som lukket skap.
  - **Vaskemaskin + tørketrommel, stablet**, z 2,88–3,48:
    - vaskemaskin nederst på gulvet, 0,60 × 0,60 × 0,85, hvit ca. #e6e2dc (eldre Whirlpool-type)
    - tørketrommel på toppen (Bosch med varmepumpe), hvit ca. #eceeef, topp ca. 1,72
    - lukk vaskemaskindøra (den står åpen på bildene)
    - over dem et **overskap**, 0,60 bredt, ca. 1,80–2,13, med sort loddrett håndtak nede ved østkanten
  - **Benkehjørnet**, z 3,48–4,08: benkeplata går inn hit. Over den er det en åpen nisje, og så et **overskap** (0,60,
    ca. 1,80–2,13) med sort loddrett håndtak nede ved østkanten. Stikkontakten sitter i nisja.
- **Taklist** svart #1d1e21, se Rommet.
- **Avtrekksventil:** rund, sort, Ø ca. 0,13, i taket nær vestenden, ca. x 1,00 / z 3,85 (225501, 225513).
- **Varmekabler i gulvet:** trolig, men ingen termostat synes (anslått).

## Møbler (ryddig)

- **Speilskap** over kummen på vestveggen:
  - to speildører, ca. 0,80 B × 0,70 H × 0,14 D, tynn aluminiumskant
  - underkant ca. 1,25, senter x ≈ 0,62 (x 0,22–1,02)
  - **LED-lysskinne** (aluminium, ca. 0,55 lang) på toppen, ca. 1,97 m (225501, 225513)
- Ellers er det ingen frittstående møbler. Alt annet er innebygd (se Faste ting).
- Ingen håndklær, planter eller pynt. Det er løse ting og regnes som rot (se *Utelatt rot*). Benk, WC-hylle og
  nisjebunn står tomme.

## Lys

- **Innfelte downlights**, ca. 8 stk, med sort ring, Ø ca. 0,09, i nøytralt varmhvitt lys (ca. 3000–3500 K,
  anslått). Bildene herfra har mye mindre gulstikk enn bildene fra gangen, så lyset er trolig litt kaldere enn der.
  Plassering (x, z) anslått fra 225446, 225501, 225505, 225510, 225512, 225513 og 225517:
  - foran dusjglasset: (1,25, 0,35) og (1,25, 0,80) (225517 viser to spotter rett foran dusjen)
  - innenfor døra: (2,10, 0,55)
  - rad foran skapraden: (1,75, 2,00), (1,75, 2,85) og (1,75, 3,60) (225505 og 225512: tre på rad over skapene)
  - over benken (vestraden sammen med (1,75, 3,60)): (1,05, 3,60) og (0,40, 3,60) (225501 og 225513: tre på tvers)
  - avtrekksventilen sitter like vest for den midterste i vestraden
- **Speilskapets LED-list:** kjølig hvitt, ca. 4000–5000 K (leser blåhvitt). Ca. 400 lm (anslått).
- Ingen taklampe, ingen dusjlampe og ingen benkebelysning under overskapene. Spottene lager tydelige lyskjegler på
  skapfrontene (225505, 225512).
- **Vindu:** nordvendt kjellervindu, høyt på veggen. Om dagen gir det lite, kjølig dagslys.

## Utelatt rot

- Klær og håndklær overalt:
  - på benkeplata
  - i og over de åpne skittentøyskuffene og på gulvet foran dem
  - på knaggene (sør- og nordvegg) og på håndkletørkeren
  - over dusjglasset (håndkle)
  - svart bag/genser på gulvet ved WC-en
- Løst på benkeplata: proteinpose, plastflasker, sprayflasker, tannkrem/tannbørster, saks, pakker, kopper, såpe og
  kluter.
- I dusjen: sjampo- og dusjsåpeflasker.
- Pedalbøtte (sort) ved WC-en og frittstående dopapirstativ med toalettbørste (sort).
- Pynt: potteplanter og duftpinner på WC-kassen og i vindusnisja, hengende kunstplante ved nisja, plastposer på
  krokene.
- Åpne fronter: skittentøyskuffene, vaskemaskindøra og WC-lokket (lukkes).
- I gangen sett gjennom døra: benk/kasse med verktøy og ledninger. Det hører til GANG og er rot der også.

## Usikkert / anslått

- **Bredden 2,03 m i planen er trolig feil** (skrivefeil for ca. 2,63?):
  - Tegningen viser 2,61 m med samme skala som resten av huset (5,60 og 2,91 + 2,70 stemmer med tegningen).
  - SOVEROM i samme kolonne er 2,63 (arealet stemmer).
  - Dusj + vegg + dør langs østveggen og benkemodulene langs vestveggen gir begge ca. 2,6 m.
  - Hele beskrivelsen bruker 2,64. Bør måles.
- **«1,18 m»** i planen (østveggen → skapraden) stemmer ikke med tegningen (ca. 1,5 m) eller med 4,08 − 2,40 = 1,68.
  Brukt 1,68 (mulig skrivefeil for 1,68).
- **Takhøyden** 2,30 er anslått (2,22–2,35). Nisjetopp, overskap og toppanel er satt i forhold til den. Bruk samme
  verdi som resten av kjelleren (se Rommet).
- **Østveggen, plan mot bilde:**
  - Planen har dusj 1,08, vegg 0,62, dør 0,87 og stubb 0,06.
  - I 225508 og 225510 ses østveggen nesten rett forfra. Der er veggstykket fra dusjglasset til geriktens nordkant
    omtrent **like bredt som døra** (forhold ca. 1 : 1, ikke 0,62 : 0,87). Stubben mot sørøsthjørnet er ca. 0,1.
  - Innenfor 2,64 m betyr det enten en grunnere dusj (ca. 0,85–0,95 nord–sør) eller en smalere dør (ca. 0,75 inkl.
    gerikt). Planens tall er brukt. Bør måles.
- **Skapraden** kan være litt lengre enn 2,40, ca. 2,45–2,50 med start på z ≈ 1,6. Tegningen starter den på z 1,58,
  og 225505 gir ca. 2,5 m (skittentøyskapet ser bredere ut enn 0,60).
- **VB synes ikke.** Den står trolig bak det høye skapet z 2,28–2,88, men kan stå bak skittentøyskapet eller et annet
  sted.
- **Vaskemaskin og tørketrommel** står i planen som tre separate merkelapper (VB, Vaskemaskin, Tørkemaskin). På
  bildene står maskinene **stablet** i én søyle.
- **Vinduet:** bredden 1,28 er fra planen, sill 1,50 og høyde 0,72 er anslått. Bildene antyder at det sitter ca. 0,1 m
  lenger vest enn i planen. Åpningsmåte og glass ses ikke (kveld).
- **WC-kassen** er flyttet ca. 0,1 m østover fra planen etter bildene. Bredde 0,78 og høyde 1,15 er anslått.
- **Dusjens mål** 1,08 × 1,17 er fra planen. Bildene passer, men er ikke målt. Plassering av sluk og dusjsett er
  anslått.
- **Benkemodulenes bredder** er anslått (sum 2,04 mellom nordveggen og maskinsøyla).
- **Spottenes antall og plass** er anslått (7–9 stk).
- **Veggfargen** er anslått (ingen fargekode kjent). Den svært dempede grågrønne kan avvike en del.
- **Gulvet:** det er usikkert om belegget er brettet opp eller om det er en smal mørk list.
- **Ekstra sluk** under maskinene og **varmekabler** er ukjent.
- **Døra:** høyde 2,15 og blad 0,80 × 2,05 er anslått. Bredden 0,87 er fra planen. Bildene kan tyde på en litt
  smalere dør (se *Østveggen*).
- **Bildene 225413–225429 hører ikke til vaskerommet** (se Tillegg). `bad-1etg.md` er nå skrevet om etter dem. Bør
  bekreftes av eieren.

## Bilder

- **20261020_225443.jpg** (stående): fra GANG ved trappefoten, gjennom døra mot vest. Viser:
  - døra som slår inn mot sør, med karm og eiketerskel
  - benk, kum og speilskap på vestveggen, vindusnisja og WC-kassen
  - trapp med eiketrinn og sort håndløper til høyre
  - rot: klær på gulvet og benken
- **20261020_225446.jpg** (stående): fra døråpningen mot nordvest. Viser:
  - benk og speilskap (vest), vindusnisje og WC (nord)
  - dusjen med skyvedør (forgrunn, høyre) og håndkletørkeren med håndklær
  - spotter i taket
- **20261020_225450.jpg:** nordveggen rett fram. Viser:
  - vindusnisje, WC-kasse med trykkplate og WC
  - dusj med mørke panel, termostat, takdusj og sluk
  - to spotter
- **20261020_225451.jpg:** nordvestre hjørne. Viser benk med kum, speilskap, vindusnisje, krok med håndklær,
  WC-kasse, WC og dusjen.
- **20261020_225501.jpg:** vestveggen. Viser:
  - benk med svart kum, fronter og håndtak
  - speilskap med LED-list og to stikkontakter
  - overskap og tørketrommel/vaskemaskin (venstre), vindusnisje (høyre)
  - tre spotter og avtrekksventilen
  - mye rot på benken
- **20261020_225505.jpg:** sørveggen. Viser:
  - skaprad: skittentøyskap (åpne), høyt skap, stablet vask/tørk, overskap og toppanel
  - benkehjørnet med nisje og stikkontakt, stikkontakt på vestveggen
  - knagg øst for skapene, tre spotter
- **20261020_225508.jpg:** mot øst, østveggen nesten rett forfra (best for østveggens mål). Viser:
  - dusjen (venstre), håndkletørker, og bryteren rett inntil dørkarmen
  - døra, som står åpen og slår inn mot sør
  - skapradens østende (høyre) og WC (forgrunn)
  - gjennom døra: gangen med eikegulv
- **20261020_225510.jpg:** tak og øvre del mot øst. Viser spotter, dusjen med panel til taket, døra og
  skittentøyskapet.
- **20261020_225512.jpg:** tak over skapraden. Viser tre spotter, toppanel, overskap og tørketrommel.
- **20261020_225513.jpg:** tak mot vest. Viser tre spotter, avtrekksventilen, speilskap med LED-list og vindusnisja
  (svart foring, dyp bunnhylle).
- **20261020_225517.jpg:** tak over dusjen. Viser to spotter foran dusjen, takdusjen og de mørke panelene opp til taket
  på nord- og østveggen.
- **20261020_225525.jpg** (stående): inn i dusjen. Viser mørke panel på nord- og østveggen, svart termostatbatteri med
  hylle, takdusj og hånddusj.
- **20261020_225413–225429.jpg:** se Tillegg (annet bad).

## Tillegg: bildene 225413–225429 viser trolig Bad 1. etg (ikke vaskerommet)

`notes/hus-foto/bad-1etg.md` var først skrevet uten disse bildene (bare et glimt i 225333). I krysskontrollen er den
skrevet om etter dem, og den gjelder nå for badet. Disse 8 bildene passer med det glimtet:
- dusjhjørne i nordøst med svartrammet glass og to dører i hjørnet
- svart høyskap sør for dusjen
- rund LED-plafond, mørk grå gulv, lys greige steinlook og svart taklist

Det høye, smale frostede vinduet har forholdet ca. 2,4 : 1, altså 48 × 117. Bildene er tatt 14 s før det første
kjellerbildet (225443 ved trappefoten). Dette bør brukes til å rette bad-1etg-notatet. Kort oppsummert, med
retninger som i 1.-etg-planen:

- **Nordvegg (vindusveggen):** dusj i nordøsthjørnet, vindu 48 × 117 (sill ca. 0,85, topp ca. 2,05, anslått) og
  **WC-kasse med topphylle og vegghengt WC vest for vinduet**, inn mot nordvesthjørnet (ikke på sørveggen).
  - Vinduet har frostet glass, svart ramme og lys grå kantlist i lysningen.
  - Kassen er ca. 0,7 bred og 1,1 høy, med sort trykkplate (225417, 225419).
- **Østvegg:** dusj, så et **svart høyskap** (ca. 0,35 bredt, to dører, uten synlige håndtak), så et **vegghengt
  sort servantskap** med 2 skuffer og hvit integrert servant (ca. 0,8 bred), med sort batteri.
  - Over servanten: **rundt LED-speil med bakbelysning** (Ø ca. 0,7), ikke speilskap.
  - Dobbel sort stikkontakt sør for speilet, ca. 1,15 m (225413, 225417, 225425).
- **Sørvegg:** blank, med én sort håndklekrok ca. midt på (225413, 225423).
- **Vestvegg:** svart dør med ett innfelt felt nær sørvesthjørnet, sort lysbryter like nord for døra (ca. 1,1 m) og
  sort dopapirholder (ca. 0,75 m) mellom døra og nordvesthjørnet (225421). Ingen håndkletørker er synlig.
- **Dusj:** **femkantet** (avskåret front med to svingdører), svarte profiler, ca. 0,9 × 0,9. Svart termostat med
  takdusj og hånddusj på nordveggen og rundt stålsluk i dusjen (225417, 225419, 225429). Samme lyse steinplater
  inne i dusjen (ingen mørke panel).
- **Vegger:** lys beige-grå steinlook-plater, med synlige loddrette skjøter ca. hver 0,6 m (225423). Rå #a39487;
  hvitbalansert (porselen 225419 som referanse) ca. #9a948f i lampelys, ekte farge ca. #c4bdb3–#c8c5bf.
- **Gulv:** mørk grå, skyet vinyl (ca. #5a5759).
- **Tak og lys:** hvitt tak, svart taklist og **rund påbygd LED-plafond** (Ø ca. 0,40–0,45, mørk kant) midt i taket.
  I tillegg én innfelt spot med sort ring nær døra og en rund mørk avtrekksventil ved vindusveggen.
- **Rot der:** håndkle på kroken og over dusjen, såpeflaske, bøtte, badevekt, plante og pynt på WC-hylla.

## Kontrollert

Uavhengig kontroll (2026-10-21). Jeg har sett gjennom alle 20 bildene i `_1600/vaskerom`, kjellerplanen, planen for
1. etg og `hele-huset-fakta.md`. Jeg har gjort pikselmålinger og fargeprøver i 225443, 225446, 225450, 225451, 225501,
225505, 225508 og 225525.

**Dette stemmer, og er ikke endret:**
- **Orientering:**
  - nordveggen (planens venstre) er yttervegg med vindusnisje og WC
  - østveggen (planens topp) har døra mot GANG
  - sørveggen (planens høyre) har skapraden mot KJELLERSTUE
  - vestveggen (planens bunn) har benken mot SOVEROM
  - dusjen står i nordøsthjørnet
- **Åpninger:** én dør, med hengsler i sør og slag inn mot sørveggen (225443, 225508, og buen i planen). Ett vindu.
  Ingen dør mot kjellerstua eller soverommet.
- **Bredden 2,64:**
  - Planteksten 2,03 er feil. Tegningen er 2,6 m, og SOVEROM i samme kolonne har arealet 7,41 = 2,63 × 2,82.
  - Benkemodulene og kummen bekrefter også ca. 2,6 m.
- **Hvitbalansen:** kontrollmålt på WC-porselenet (rå #e4d7c8 og #e1d4c8, faktor R × 0,94, B × 1,07). Det er samme
  korreksjon som i notatet.
- **Fargene:**
  - Vegg, tak, gulv, fronter, benkeplate og dusjplater ligger innenfor målingene etter korreksjon.
  - Dusjplatene er litt varmere i 225450, men nøytrale i 225525. #5a5657 er beholdt.
- **Rot og faste ting:** Rotlista er fullstendig. Ingen faste ting mangler: sluk, ventil, spotter, bryter,
  stikkontakter, kroker, taklist, nisje, speilskap og skaprad er med.
- **Bad 1. etg:** Bildene 225413–225429 viser badet i 1. etg. Tillegget stemmer med planen for 1. etg: vindu i nord,
  dør nær sørvesthjørnet i vestveggen.

**Endret:**
1. **Lysbryteren** er flyttet fra x ≈ 1,38 til x ≈ 1,65, rett inntil geriktens nordkant. Den sitter helt inntil
   karmen i 225508, 225510 og 225446. Det var ikke 0,3 m vegg mellom dem.
2. **Håndkletørkeren** har ett rør fra ca. 0,05 til 1,80, med veggfeste ved 0,30. Notatet hadde to rør fra 0,20 til
   1,70. Målt i 225508 rett forfra.
3. **Rommet:**
   - Fjernet påstanden om at bildene viser «vegg 0,62» langs østveggen. Tallet var bare en rest av planmålene.
   - Bildene viser veggstykket omtrent like bredt som døra. Avviket er nå beskrevet under *Usikkert*.
   - Ny begrunnelse for 2,64 bygger på benkemodulene.
4. **Takhøyden:**
   - Ny kontrollmåling gir 2,23–2,26 fra dørkarmen og ca. 2,30 fra maskinsøyla.
   - Strøk påstanden om at maskinsøyla gir 2,4–2,5.
   - Spennet er nå 2,22–2,35, med beskjed om å bruke én verdi for hele kjelleren. Kjellerstua har 2,22, gangen 2,30.
5. **Terskelen** bruker nå kjellergangens eikefarge #bdb2a3 og en smal mørk overgangslist (225443, 225508). Før stod
   #cdbfae fra 1. etg.
6. **Møbler:** Strøk det valgfrie håndkleet og planten. Begge er løse ting og rot etter reglene.
7. **Usikkert:** La til avviket på østveggen, at døra kan være smalere, og at skapraden kan være ca. 2,45–2,50 lang
   med start på z ≈ 1,6.
8. **Lys:** Fargetemperaturen er nå 3000–3500 K. Bildene herfra har mye mindre gulstikk enn gangbildene.

### Krysskontroll mellom rommene (2026-10-21)

Sjekket mot `entre-gang-kjeller.md`, `trapp.md`, `kjellerstue.md`, `soverom-kjeller.md` og `bad-1etg.md`.

- **Døra mot GANG stemmer fra begge sider:** x 1,71–2,58 her, x 1,69–2,58 i `entre-gang-kjeller.md` og x 1,84–2,67 i
  `trapp.md` (samme dør, `trapp.md` regner fra 1. etasjes nordvegg, 0,13–0,15 lenger nord). Hengsler i sør, slår inn.
  Trinn 1 i trappa står like nord for karmen, som 225443 viser.
- **Ingen dør mot kjellerstua eller soverommet** stemmer med de to notatene.
- **Rettet: bildetallet.** Mappa har 8 badbilder (225413, 417, 419, 421, 423, 425, 427, 429) og 12 vaskeromsbilder
  (225443–225525), ikke 9 og 11.
- **Rettet: Bad 1. etg.** Tillegget er tatt inn i `bad-1etg.md`, som nå bygger på de 8 bildene. Der er også noen tall
  justert etter egen måling (vindu sill 0,88, servant 0,80 på x 1,50–2,30, LED-speil Ø ca. 0,80).
- **Takhøyden:** felles kjellerverdi 2,25. Gulvet ligger på verdens-y −2,55.
- **Bredden 2,64** (ikke planteksten 2,03) støttes også av soverommet under (2,63) og av at sjakta og GANG får plass
  i planen.
