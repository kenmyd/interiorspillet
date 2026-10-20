# Hele huset – oversikt fra fotonotatene

Krysskontroll 2026-10-21 av de ni romnotatene i `notes/hus-foto/` mot hverandre, mot `notes/hele-huset-fakta.md`
(fasit), `plantegning.png` og `bilder_hus/_1600/plantegning_kjeller.png`. Detaljene står i romnotatene. Der de var
uenige, er de rettet og samkjørt (se «## Kontrollert → Krysskontroll» i hvert notat). Alt som ikke er målt, er anslått.

## Koordinater

- Spillets akser som `room-spec.json`: **x** = meter sørover (plan høyre), **z** = meter vestover (plan ned), **y** =
  opp. Origo er 1. etasjes innvendige NØ-hjørne (badets NØ-hjørne). **Verdens-y 0 = gulvet i 1. etasje.**
- **Kjellerplanen legges med ytterflatene i flukt med 1. etasje.** Kjellerplanen tegner nord- og østveggen ca. 0,28
  tykke, 1. etasje ca. 0,16. Da blir **spill-x = X + 0,13** og **spill-z = Z + 0,13**, der (X, Z) er meter fra
  kjellerplanens innvendige NØ-hjørne (ved boden 1,64).
  - Kontroll: sjakta havner da på z ≈ 2,29–4,37 i kjelleren mot 2,32–4,40 oppe (innenfor 3 cm), og kjellerens nordvegg
    på x ≈ 0,13. Det er hylla (toppen av grunnmuren, 0,15 dyp) som ses langs nordveggen i sjakta. Trinn 1 havner på
    x 1,73 i begge notatene.
  - Lås likevel sjaktveggene til 1. etasje (z 2,32 og 4,40), slik designplanen D3 gjør.
- Tallene under er i denne rammen og avrundet («ca.»).

## Rommene

**1. etasje (gulv y 0)**

| Rom | Planmål | Plass i spillet | Gulv | Tak | Notat |
|---|---|---|---|---|---|
| Stue/kjøkken/TV-stue | som i dag | som `room-spec.json` | `oak-plank` #a59b8f | 2,40–3,00 (skrått) | – |
| Gang | 3,11 × 2,07 | x 0–3,11 · z 2,32–4,40 | `oak-plank` #a59b8f, bord øst–vest | 2,40 flatt, lyst (#ecebe8 eller SAND) | `gang-1etg.md` |
| Bad | 2,53 × 2,22 | x 0–2,53 · z 0–2,22 | mørk grå skyet vinyl #5a5759 | 2,40 flatt, hvitt, sort taklist | `bad-1etg.md` |
| Soverom | 3,11 × 3,69 | x 0–3,12 · z 4,51–8,20 | `oak-plank` #a59b8f, bord øst–vest | 2,40 flatt, malt som veggene #50575c | `soverom-1etg.md` |
| Trapp (hull) | «1,54» × 2,07 | x 0–1,47/1,85 · z 2,32–4,40 | eiketrinn #ada396 | gangtaket, y 2,40 | `trapp.md` |

**Kjeller (gulv y −2,55, tak 2,25 over gulvet = y −0,30, der ikke annet står)**

| Rom | Planmål | Plass i spillet (ca.) | Gulv | Tak | Notat |
|---|---|---|---|---|---|
| GANG | 12,50 m², L-form: trappedel 2,91 × 1,83 (2,07 ved trappa), sørdel 2,70 × 2,64 | x 0,13–5,73 · z 2,32–5,18 | hvitpigmentert eik, bord nord–sør | 2,25, ingen taklist | `entre-gang-kjeller.md` |
| Entré (rommet med ytterdør) | 2,51 × 2,93 (tegnet 2,50 × 2,73) | x 6,14–8,64 · z 3,10–6,03, søyle i NV x 6,14–6,70 · z 5,25–6,03 | som GANG, **y −2,89** | 2,35–2,40 over eget gulv (y ca. −0,52) | `entre-gang-kjeller.md` |
| Vaskerom/bad | 2,64 × 4,08 (planteksten «2,03» er feil) | x 0,13–2,77 · z 4,55–8,63 | grå skyet vinyl #8c8789 | 2,25, hvitt #ebeae6, sort taklist | `vaskerom.md` |
| Kjellerstue | 3,40 × 6,05 = 20,57 m² | x 3,04–6,44 · z 5,28–11,33 | hvitpigmentert eik, bord øst–vest | 2,25 (målt 2,22), sort taklist | `kjellerstue.md` |
| Soverom kjeller | 2,63 × 2,82 = 7,41 m² | x 0,13–2,76 · z 8,75–11,57 | hvitpigmentert eik | 2,25, sort taklist | `soverom-kjeller.md` |
| Bod 1 | 1,64 × 2,32 | x 0,13–1,77 · z 0,13–2,2 | – | lukket, tomt rom (under trappa) | fakta |
| Bod 2 (grå) | 4,28 × 2,32 | x ca. 2,0–6,3 · z 0,13–2,45 | betong #8a8580 | lukket, tomt rom | fakta, 225635 |
| Rom 3,70 × 2,84 | 3,70 × 2,84 | x ca. 6,42–10,05 · z 0,13–2,94 | oransjebrun parkett, trolig y −2,89 | lukket, tomt rom | fakta, 225556 |

- **Kjellergulvet:** målingene spriker (#bdb2a3 i GANG, #d4c9bb i kjellerstua, #d0c9bd på soverommet). Det er trolig
  samme gulv. Bruk én verdi, f.eks. ca. #c9bfb1 midt i spennet (anslått).
- **Vegger:** SAND #cfc5b4 i gangene, trappa, entréen, kjellerstua og kjellersoverommet; stua som i dag; mørk blågrå
  #50575c på soverommet oppe; lyse steinplater #c8c5bf på badet oppe; dempet grågrønn #b8bfb5 i vaskerommet.
- **Gulvlister:** lys eik/beige ca. #cbbba7 (6–7 cm) i hele kjelleren. Oppe i gangen og soverommet er de trolig lys eik
  i gulvfargen (ca. #ada291), ikke hvite som i stua (usikkert). Badene har oppbrett, ikke list.

## Dører mellom rommene

```
                        [Terrasse y −0,03] ──terrassetrapp, ca. 16 opptrinn── [Ute / forplass y −2,90]
                              │ door-terrasse                                        │
 1. etg:  [Bad] ─door-bad─ [Gang 1. etg] ─door-gang─ [Stue / kjøkken / TV-stue]       │
                              │  └─door-soverom─ [Soverom 1. etg]                      │ YTTERDØR
                              │                                                      │ (hovedinngang)
                              │ trapp, 15 opptrinn                                   │
 Kjeller: [Bod 1] ─ [GANG] ─ [Vaskerom]                                              │
                     │  ├─ [Bod 2 grå]                                               │
                     │  ├─ [Kjellerstue] ─ [Soverom kjeller]                         │
                     │  └─ åpning, 2 trinn ned ─ [Entré] ───────────────────────────┘
                     │                            └─ [Rom 3,70 × 2,84]
```

Ingen dør mellom vaskerommet og kjellerstua eller soverommet i kjelleren, og ingen ytterdør i 1. etasje utenom
terrassedøra (bekreftet fra begge sider).

| Dør / åpning | Mellom | Vegg og plass (spill, ca.) | Hengsler → slag | Begge sider |
|---|---|---|---|---|
| `door-gang` | stue ↔ gang | gangens sørvegg (x 3,11), z 3,36–4,43, 1,07 × 2,15 | øst → ut i gangen | room-spec ↔ `gang-1etg` ✓ |
| Baddør | gang ↔ bad | z 2,22–2,32, x 1,50–2,45 | sør → inn på badet | `gang-1etg` ↔ `bad-1etg` (225421) ✓ |
| Soveromsdør | gang ↔ soverom | z 4,40–4,51, x 2,11–3,06 | sør → inn i soverommet | ✓ |
| `door-terrasse` | stue ↔ terrasse | som `room-spec.json` | – | ikke en del av notatene |
| Trapp | gang 1. etg ↔ GANG | hull x 0–1,47/1,85 · z 2,32–4,40 | – | topp og bunn ✓ |
| **Ytterdør** | entré ↔ ute | entréens sørvegg, ytterflate x ≈ 8,90. Element z 3,29–5,29 (ca. 2,0 × 2,1), blad z 3,79–4,79 (ca. 1,0 × 2,05) | øst → ut mot sør | `entre-gang-kjeller` ↔ `ytterdor-ute` ✓ (samkjørt) |
| Åpning | entré ↔ GANG | vegg x 5,73–6,14 (0,41), z ca. 3,40–4,33, ingen karm, 2 trinn à 0,17 | – | ✓ |
| Dør | entré ↔ rom 3,70 | entréens østvegg (z 3,10), x ca. 6,26–7,26 | nord → inn i rommet | én side, lukket |
| Dør | GANG ↔ bod 1 | i nisje (z ≈ 2,32), planen x 0,97–1,76; anbefalt ca. 1,10–1,85 inntil nisjehjørnet | **sør** → inn i boden | én side, lukket |
| Dør | GANG ↔ bod 2 | GANGs østvegg (z 2,54), x ca. 4,73–5,68. Ikke i planen | sør → inn i boden | én side, lukket |
| Dør | GANG ↔ vaskerom | badveggen (z 4,40–4,55), x ca. 1,82–2,71, rett sør for trappefoten | sør → inn | ✓ |
| Dør | GANG ↔ kjellerstue | z ca. 5,18–5,28, x ca. 3,21–4,08 | nord → inn i stua | ✓ |
| Dør (8M) | kjellerstue ↔ soverom kj. | stuas nordvegg, 0,49–1,37 m fra vesthjørnet (0,88 bred) | vest → inn i soverommet | ✓ (rettet i `kjellerstue.md`) |

## Trappa

- **Type:** halvsvingt U-trapp (180°) med vangetrinn rundt et smalt trappeøye, uten repos. Åpne opptrinn, eiketrinn
  #ada396, sorte vanger og rekkverk #1d1e21.
- **Trinn:** 14 inntrinn pluss gulvet oppe = **15 opptrinn à ca. 0,170** (2,55 / 15). Inntrinn ca. 0,22–0,23 på de
  rette trinnene og ca. 0,19–0,20 i ganglinja gjennom svingen. 2 · opptrinn + inntrinn ≈ 0,56–0,57.
- **Retning opp:** nordover langs vestveggen (nedre løp z 3,48–4,40, ca. 0,92 bredt), høyresving med vangetrinn langs
  nordveggen, så sørover langs østveggen (øvre løp z 2,32–3,10, ca. 0,78 bredt). Øyet ligger ca. x 1,04–1,50 ·
  z 3,10–3,48.
- **Oppbygging (modell):** trinn 1–3 rette (nese x 1,73 / 1,50 / 1,27), 4–12 vangetrinn rundt øyet, 13–14 rette (nese
  x 1,04 / 1,25), gulvkanten oppe på x 1,47.
- **Bunnen:** trinn 1 har forkant på x ≈ 1,73 (1,58–1,60 fra kjellerens nordvegg), rett nord for vaskeromsdøra. Man
  går ut mot sør i GANG. Under øvre løp er det en åpen lagerplass (tom i spillet) og døra til bod 1.
- **Toppen:** gulvkanten med neselist på x 1,47 (eieren: «1,54»). Man kommer opp med ansiktet mot sør, baddøra til
  venstre, soveromsdøra til høyre og stuedøra rett fram i SV-hjørnet.
- **Hullet i 1. etasje** er trappeformet: x 0–1,47/1,50 for z 2,32–3,48 og x 0–1,85 for z 3,48–4,40. Sort
  spilerekkverk A/B/C, 1,0 høyt. Kantflate (etasjeskillet) ca. 0,30.
- **Håndløper** på veggene vest → nord → øst med varmhvit LED under langs nord- og østveggen. Øvre ende på x ≈ 1,40,
  ca. 0,65 over gangulvet. Innerrekkverk langs nedre løp og rundt øyet, ca. 0,9 over trinnlinja.
- **Fri høyde:** minst ca. 2,57 over trinn 14. Ved foten går man under hullkanten, der kjellertaket er 2,25.
- **Hylla** (toppen av grunnmuren) langs nordveggen i sjakta: topp y ca. −0,27, ca. 0,15 dyp, med en valgfri plante.

## Hovedinngangen og start ute

- **Hovedinngangen er ytterdøra i kjellerens entré**, i sørveggen mot elva, i en overdekt nisje under terrassen. Den er
  bekreftet i 225543, 225553 og 225619. 1. etasje har ingen annen ytterdør enn terrassedøra i stua.
- **Døra:** glatt matt antrasitt blad (#2b2c2e), ca. 1,0 × 2,05, med ett klart sidelys på hver side (element ca. 2,0 ×
  2,1, sorte rammer #25272b). Hengsler i øst, slår **ut**, digital kodelås og vrider på vestkanten (h ca. 1,0).
  Planen tegner elementet 1,85; bildets proporsjoner passer med ca. 2,0.
- **Ute:** kledning #4a4642, himling i samme beis 2,35 over terskelen (y ca. −0,52), tre downlights (z 3,7 / 4,65 /
  5,6), grå pilar #a8a9aa ved ca. (10,17; 5,82), benk, én potte med bartre, skiferhelle med dørmatte, grus og
  betongheller. Detaljer i `ytterdor-ute.md` (gjelder ute) og `entre-gang-kjeller.md` (gjelder inne).
- **Startposisjon** (bare når det ikke finnes lagret posisjon):
  - føtter **(x 12,2; y −2,90; z 4,6)** på forplassen, ca. 3,3 m sør for døra og utenfor himlingen
  - blikk mot midten av dørbladet: **yaw ≈ 1,48 rad (85°)** i PlayerController (0 = −z, pluss mot venstre),
    **pitch ≈ −0,10 rad** (ca. −6°)
  - klar av dørslaget (x 8,90–9,90 · z 3,79–4,79), rommet 3,70 (z < 3,17), pilaren og terrassetrappa (z > 6,75)
  - i designplanens D3-ramme (kjellerens origo i 0) blir x ca. 0,15 mindre
- **Veien inn:** nordover til døra (den slår ut mot spilleren, så stå litt vest for midten), inn i entréen, to trinn
  opp gjennom åpningen (ca. 0,35 m øst for dørmidten), ca. 4 m nordover i GANG, opp trappa med høyresving og ut i
  gangen i 1. etasje mot sør, til stua.

## Etasjehøyder

Regel: etasjehøyde = kjellertak + etasjeskille = antall opptrinn × opptrinn. **2,25 + 0,30 = 2,55 = 15 × 0,17.**

| Hva | Verdens-y | Grunnlag |
|---|---|---|
| Tak, flate rom i 1. etg (gang, bad, soverom) | +2,40 | eieren |
| Gulv 1. etg | **0** | room-spec |
| Terrassedekke, topp | −0,03 | exterior.js |
| Kjellertak = underkant av etasjeskillet | −0,30 | dekke 0,30 (kantflata i hullet 0,25–0,35) |
| Hylla i sjakta (toppen av grunnmuren) | ca. −0,27 | sett ovenfra og nedenfra |
| Entrétak og himling ute (samme plan) | ca. −0,52 | 2,35–2,40 over entrégulvet / terskelen |
| **Kjellergulv** (GANG, vaskerom, kjellerstue, soverom kj., bod 1 og 2) | **−2,55** | 2,25 + 0,30; 15 × 0,170 |
| Entrégulv (og trolig rommet 3,70) | **−2,89** | 2 trinn à 0,17 ned fra GANG |
| Forplass ute | **ca. −2,90** | terskelen 2–4 cm over; trianguleringen gir −2,7 (−2,4 … −3,0) |

- Kjellertakene ble anslått til 2,22 (kjellerstue), 2,25 (soverom), 2,23–2,30 (vaskerom) og 2,25–2,35 (GANG). Felles
  verdi 2,25 gir ingen sprang over dørene.
- Den gamle modellverdien i `trapp.md` (2,70, opptrinn 0,18) ville krevd et dekke på 0,40–0,45 og lagt hylla 0,4 m
  under gulvet oppe. Det passer ikke med bildene.
- Terrassetrappa må da ha ca. 16 opptrinn à 0,18 fra −0,03 ned til −2,90. TERRACE_FIT har 9 opptrinn til −1,72.

## Avvik mot `hele-huset-design.md`

Designplanen er skrevet før krysskontrollen. Dette bør justeres der:

1. **D2 trappa:** 14 opptrinn à 0,182 → bildene gir 14 inntrinn = **15 opptrinn à 0,170**. `floorY −2,55` holder.
2. **D2 entré og forplass:** −2,85 / −2,87 (trinn à 0,15) → **−2,89 / ca. −2,90** (trinn à 0,17). Det er innenfor
   usikkerheten.
3. **§1.4 entréens tak** «y −0,45» → ca. **−0,52**. **Kjellerstuas tak** «2,22» → felles **2,25** (som `ceilingDefault`).
4. **D3 registrering:** kjellerens innvendige NØ-hjørne i (0, 0) gir hylla null dybde. Med ytterflatene i flukt
   (+0,13 i x og z) passer sjakta uten strekk. I vest blir kjelleren da ca. 0,37 m kortere enn 1. etasje (11,84 mot
   12,21 utvendig; planens egne mål går opp i 11,84). Det er D3s alternativ «uskalert med utkraging i vest».
   Kjellerplanens egne mål taler for det, men eierens målepunkt 7 avgjør.
5. **§1.4 bod-1** «hengslet i nord» → planbuen viser hengsler i **sør**.
6. **§1.6 `ledge.y [-0.22, -0.02]`** → topp ca. **−0,27** (−0,30 … −0,15).
7. **Håndløperen:** `start [1.40, 2.32]` med høyde 0,90 → den øvre enden står bare ca. 0,65 over gulvet oppe.
8. **Ytterdøra:** element ca. 2,0 m med blad ca. 1,0, ikke planens 1,85 / 0,92.
9. **win-sov** 1,15 × 1,10, sålbenk 0,95 → 1,17 × 1,17, sålbenk 0,92 (`soverom-1etg.md`). **Vinduet i soverommet i
   kjelleren** x 0,59–1,90 → 0,63–1,93.
10. **Døra kjellerstue ↔ soverom kjeller:** 0,88 bred (8M), 0,49–1,37 m fra vesthjørnet, hengsler i vest.
11. **Bod-1-døra mot vangen:** med opptrinn 0,17 når vangens underkant 2,15 først ved x ≈ 1,3. Sett døra inntil
    nisjehjørnet og kutt høyden ved nordre karm (planen gjør allerede det).
12. **D15 badet** stemmer nå med `bad-1etg.md`, som er skrevet om etter 225413–225429.

## Viktigste usikkerheter

1. **Etasjehøyden 2,55** (2,50–2,65) er ikke målt. Det enkleste målet for eieren: tell trinnene og mål ett opptrinn,
   eller mål takhøyden i GANG. Døra under trappa passer best med den øvre delen av spennet (2,60–2,65).
2. **Terrenget ved inngangen:** −2,90 fra bildene ved døra og høydene inne, mot TERRACE_FIT −1,72. Tell trinnene i
   terrassetrappa: ca. 16 betyr −2,9, 9 betyr −1,7.
3. **Kjellerplanen mot 1. etasje:** forskyvningen +0,13 og om 1. etasje krager ca. 0,37 m ut i vest (eller planen må
   strekkes). Kjellerstuas sørvegg havner da ca. 0,12 sør for kjøkkenets fasadelinje.
4. **Pilaren og terrassekanten:** pilaren ved inngangen på ca. (10,17; 5,82) mot TERRACE_FIT (9,65; 6,60), og
   terrassekanten 9,80 mot planens 10,35. Én eller to pilarer?
5. **Ytterdør-elementet:** ca. 2,0 m (bildet) mot 1,85 (planen).
6. **Tvilsomme planmål:** entréen 2,93 (eier, bildene) mot tegnet 2,73; GANG sørdel 2,64 mot planteksten 2,07;
   vaskerommet 2,64 mot planteksten 2,03; skapraden i vaskerommet 2,40–2,50.
7. **Badet i 1. etasje** er fotografert i mappa `vaskerom/` (225413–225429). Eieren bør bekrefte det. Målene langs
   østveggen er ±0,1.
8. **Farger:** kjellergulvet (én verdi), om GANG er gulere enn kjellerstua, taket (hvitt eller SAND) og om gulvlistene
   oppe er lys eik eller hvite.
9. **Veggen mellom gang og soverom** oppe: z 4,40/4,51 i notatene, 4,43/4,53 i designplanen (3 cm).
10. **Rom uten bilder:** bod 1, bod 2 (bare sett gjennom døra) og rommet 3,70 × 2,84 lages som lukkede dører med tomme
    rom bak (fakta).

## Rettet i romnotatene

| Notat | Rettet |
|---|---|
| `bad-1etg.md` | Skrevet om etter 225413–225429: WC på nordveggen, servant 0,80 og rundt LED-speil på østveggen, ingen håndkletørker og ingen termostat, dopapirholder, knagg, downlight ved døra, vindussill 0,88, gulv #5a5759. |
| `gang-1etg.md` | Ytterdøra er bekreftet. Etasjehøyde 2,55 og 15 × 0,17. Hylla ca. 0,25 under gulvet. LED også langs nordveggen. Usikkerheten om sjaktbredden er avklart. |
| `trapp.md` | Etasjehøyde 2,70 → 2,55, opptrinn 0,18 → 0,17, ny trinntabell og fri høyde. Kjellertak 2,25. Håndlistens øvre ende 0,9 → 0,6–0,7. Taklampas plass. Konflikten med døra under trappa. |
| `entre-gang-kjeller.md` | Koordinatramme (+0,13). Tak 2,25, entrétak ca. −0,52. Verdens-y. Ytterdør-elementet 1,85 → ca. 2,0. Inngangspartiet ute og startpunktet samkjørt med `ytterdor-ute.md`. |
| `ytterdor-ute.md` | Inngangsnivå −2,75 → −2,90, himling −0,40 → −0,52, startens y og yaw, terrassetrappa ca. 16 opptrinn. |
| `kjellerstue.md` | Soveromsdøra z 4,55–5,55 → 4,68–5,56 (0,88, 8M, vrider i stål). Stol A flyttet bort fra døra. Felles tak 2,25. |
| `soverom-kjeller.md` | Døra er samkjørt med kjellerstua. Felles tak 2,25. |
| `vaskerom.md` | 8 badbilder og 12 vaskeromsbilder (ikke 9 og 11). Tillegget er tatt inn i `bad-1etg.md`. Felles tak 2,25. |
| `soverom-1etg.md` | 225327 er ikke det eneste bildet av badet. |
