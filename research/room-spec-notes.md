# Romspesifikasjon – notater (room-spec.json)

Sammenslått fra de seks målegruppene (`research/survey/group-1…6.md`), plantegningen, `LES_MEG.txt`, tegning 08/09, montasjen `0_for.jpg` og egne kontroller i bildene. Brukerens egne opplysninger (sørvendte vinduer, takhøyder, Sand/Marrakesh, ca. 390 × 300 cm høy vegg) er lagt inn som fasit.

Koordinater: meter. +x = sør (mot vinduene/elva), +z = vest (mot TV-stua), +y = opp. Origo er gulvet i det øverste venstre innerhjørnet av plantegningen. `rotationDeg` = three.js `rotation.y`, og front = lokal +z.

## Hovedmål

| Hva | Verdi |
| --- | --- |
| Innvendig bredde i stua (nord–sør) | 6,92 m (x 0 → 6,92) |
| Innvendig bredde i kjøkkenet | 6,32 m (sørveggen står 0,60 m lenger inn, knekk ved z 5,38) |
| Innvendig lengde (øst–vest) | 11,93 m (3,33 + 2,05 + 6,54 på planen) |
| Den høye veggen | x = 3,22, fra nisjehjørnet (z 8,34) til ytterkant av dørkarmen (z 4,43): **3,91 × 3,00 m** |
| TV-stua (nisjen) | x 0 → 3,22, z 8,34 → 11,93 (3,22 × 3,59 m), flatt tak 2,40 |
| Kjøkkentak | flatt 2,40 for z < 3,32, inkludert høyskapnisjen x 2,63–3,22 |
| Skråtak (spisestue + stue) | 3,00 ved x 3,22 → 2,40 ved x 6,92, dvs. `y = 3,00 − 0,16216·(x − 3,22)` (9,2°) |
| Nedforinger | over TV-stueåpningen (x 3,22, 2,40 → 3,00) og mellom kjøkken og spisestue (z 3,32, 0,60 m høy ved høy vegg, ca. 0,10 m ved sørveggen) |
| Gulvflate / volum | ca. 53,8 m² / 138,5 m³ (Acoustics regner med ca. 141 m³) |
| Planens skala | **51,3 px/m**, origo i px (90,5; 51,5). Ikke 50,5. |

Åpninger (hull i veggflaten, z-spenn for sørveggene):

| Id | Vegg | Spenn | Brystning → overkant | Type |
| --- | --- | --- | --- | --- |
| win-k1 | kjøkken sør (x 6,32) | z 0,62 → 3,04 (2,42) | 0,96 → 2,12 | topphengslet, ett felt |
| win-k2 | kjøkken sør | z 3,66 → 4,78 (1,12) | 0,98 → 2,12 | topphengslet |
| door-terrasse | stue sør (x 6,92) | z 5,45 → 6,33 (0,88) | 0 → 2,10 | glassdør, slår ut, hengslet mot vest |
| win-s1 | stue sør | z 6,54 → 8,90 (2,36) | 0,29 → 2,10 | fast glass |
| win-s2 | stue sør | z 9,11 → 11,47 (2,36) | 0,29 → 2,10 | fast glass |
| win-tv | TV-stue nord (x 0) | z 9,22 → 10,97 (1,75) | 1,64 → 2,12 | fast overlysvindu |
| door-gang | x 3,22 | z 3,36 → 4,43 (1,07 med karm) | 0 → 2,15 | sort dør, slår inn i gangen |

Alle vinduer har sort ramme (#25272b, ca. 7 cm synlig), lys lysning ca. 0,20 m dyp og vindusbrett i samme dybde.

## Avgjørelser der gruppene var uenige

1. **Planskala 51,3 px/m.** Gruppe 1–5 og min egen skanning av veggpikslene er enige. Gruppe 6 brukte 50,6, og koordinatene deres er derfor 1–2 % for store. Tallene deres er regnet om (de forankret seg i veggene sine, så jeg skalerte mellom ankrene) før jeg brukte dem.

2. **Vinduene i sørveggen er smalere enn i planen, og pilarene er bredere** (revidert, se «Korrigeringer»).
   * Kontrollert med 1D-projektive tilpasninger av veggkantene i 082806 (fra TV-stua) og 082914 (fra spisestua), med knekkhjørnet (5,38) og sørvesthjørnet (11,93) som ankre og like brede vinduer.
   * I 082914 er x ≈ 295 (rad 1350) det ytre hjørnet av knekken og x ≈ 364 det indre. Den lyse flaten mellom dem er knekkveggen, som går helt opp til taket. Dørhullets østkant ligger ved x ≈ 432.
   * Resultat: stripe 0,07, dør 5,45–6,33, V1 6,54–8,90, V2 9,11–11,47, pilarer 0,21 / 0,21 og endepilar 0,46. Restavviket er 2–5 mm i begge bildene, mot 3–4 cm med planens mål.
   * Gruppe 4 fikk nesten de samme breddene (dør 0,88, vinduer 2,35–2,37), og gruppe 6 fant en endepilar på ca. 0,5 m. Den gamle vurderingen om at gruppe 4 hadde et dårlig forsvinningspunkt er trukket tilbake.
   * De absolutte breddene er usikre med ca. ±3 cm, fordi de henger på planens 6,55 m for sørveggen. Mål med båndmål før persienner bestilles.

3. **Vindushøyder.** Vindusbrettet ligger på 0,29 (gruppe 2, 3 og 6), og hodet på 2,10 (gruppe 2, 4 og 6; samme linje som terrassedøra). Gruppe 4s «0,42» er underkant glass/ramme. Glasset går ca. 0,36 → 2,03.

4. **Lysningsdybde 0,20 m.** Gruppe 1, 2, 4 og 5 er enige. Gruppe 3 (0,30) og gruppe 6 (0,14) ligger utenfor. Ytterveggene er modellert 0,30 tykke (utover fra innvendig flate). Planens 0,16 er for tynt.

5. **Terrassedøra.** Det er ca. 0,07 m vegg mellom knekkhjørnet og døra. Gruppe 2 og 6 og mitt eget bilde 082914 viser en smal stripe, så gruppe 4s «helt inntil» er forkastet. Døra slår ut, er hengslet mot vest (+z) og har håndtak på østsiden.

6. **Spisebordets langakse går langs z**, parallelt med vindusveggen.
   * Gruppe 2 mente x. I 082914 står to stoler langs vindussiden og én i hver ende, så det er z (som gruppe 3, 4 og 6 sa).
   * Bordet er en stadionoval på 2,00 × 1,05 m (sannsynligvis med innleggsplate), sentrert i (5,37; 6,81).
   * Det kan stå 5–10° skjevt (gruppe 4).

7. **Sittegruppas bord er to runde settbord** (Ø 0,90 / h 0,45 og Ø 0,75 / h 0,40, målt i 082806), ikke ett «peanøttbord» (gruppe 3). De to overlapper i bildet.

8. **Vestveggen i stua (bak sofaen) er MARRAKESH.** Gruppe 6 sa Sand. Men 082914, 082823 og 082806 viser at veggen har samme taupe som TV-veggen og er tydelig mørkere enn vinduspilarene, og det finnes ikke noe fargeskille ved x 3,22. Veggen er delt i `w-vest-stue` og `w-vest-tv` så de kan males hver for seg.

9. **Gulvlisten er hvit overalt** (7 cm). Gruppe 6s «mørk på Marrakesh» er forkastet, fordi 082806 viser hvit list langs TV-veggen.

10. **Det finnes ingen TV-benk.** Gruppe 5 så en gjennom åpningen, men 082806 viser bart gulv under TV-en (som gruppe 1, 2 og 6 sa).

11. **Spottene ved den høye veggen** står på z 7,58 / 6,72 / 5,86 / 5,00 (0,86 m c/c).
    * Det er gjennomsnittet av fire gruppers målinger og min løsning av montasjebildet (7,60 / 6,70 / 5,82 / 4,95).
    * Tegning 08 sier 0,90 / 1,90 / 2,90 / 3,85 m fra nisjehjørnet. Det er et estimat, og det bommer med 0,15–0,5 m.
    * Spottene står ca. 0,38 m ut fra veggen (x 3,60) på skråtaket.
    * Hver spot er en egen påbygd, justerbar sylinder. Det er ingen skinne, selv om `palette.json` skriver «takskinne».

12. **Nedforingen over TV-stua har underkant 2,40** (brukerens tall). Gruppe 5 målte 2,33, og tegning 08 sier 2,35.

13. **Kjøkkennedforingen står på z 3,32.** Gruppe 4, 5 og 6 fant 3,30–3,35, og det stemmer med planens «3,33 m»-mål. Varmepumpa sitter rett vest for den, over gangdøra.

14. **Høyskapene er grafittgrå trestruktur** (#55575a, 082937), ikke helt sorte. Benk og øy har matt antrasitt (#2a2b2d). Benkeplata er mørk stein-look med lyse årer.

15. **Kjøkkenøya** dekker x 4,38–6,32 og z 1,90–3,02, med toppen på 0,91. Den har fossefall i nordenden, 0,30 m overheng mot vest med tre barkrakker, og induksjonstopp med ventilator i midten. Det er ingen vifte i taket.

16. **Døra på x 3,22 går til gang/entré.** Det er det lille rommet, som også har døra til bad og soverom. Planens vindussymbol der er feil. Døra slår inn i gangen; den har bare rosetter og ingen vrider.

## Usikre punkter

* **Varmepumpa:** underkant 2,50–2,62 og topp 2,85–2,96 (bruker 2,55–2,88). Bredden er 0,89–1,0.
* **TV-stua:**
  * Lengden på kortsiden av hjørnesofaen: 10,38 eller 10,51, brukt 10,42.
  * Senterhøyttaleren kan være en medieplate.
* **Stolene:** svingstolenes retning (±20°) og spisestolenes nøyaktige plass er usikre.
* **Maleriet:** 1,00 × 0,70 m. Ett bilde antyder 1,20 × 0,80.
* **Uteområdet (lav sikkerhet):**
  * Terrassen er ca. 3,2 m dyp foran kjøkkenet og 2,6 m foran stua, og går til ca. z 7,4.
  * Trappa går vestover ned ca. 2,7 m til en betongrepos.
  * Annekset/uthuset ligger øst for terrassen (z < 0).
  * Geometrien er bare ment som kulisse.
* **Farger:** alle hex-verdier for møbler, gulv og tekstiler er hvitbalanserte anslag fra undereksponerte morgenbilder. Malingen bruker Jotuns hex (SAND #cfc5b4, MARRAKESH #aea191).
* **Fotokameraer:**
  * 082806 og 082924 er godt bestemt (rms 4–10 px).
  * De andre har ca. ±0,2 m og ±3° usikkerhet.
  * Montasjens vinkel (0_for.jpg) har jeg løst selv. Kameraet står i (6,52; 1,79; 9,48), ser mot nordøst (yaw −133°, pitch −9°, roll −2,7°), vfov ca. 83° på fotodelen 1270 × 952, og rms er 7–11 px. Alle 1288 × 1030-montasjene deler denne vinkelen.

## Sjekk med målebånd (viktigst først)

1. **Den høye veggen:** lengde fra nisjehjørnet til ytterkant av dørkarmen (forventet 3,91), og takhøyde helt inntil veggen i begge ender (forventet 3,00).
2. **Skråtaket:** høyde ved vindusveggen (2,40), og over midten av spisebordet (forventet ca. 2,65). Det sier om taket er en rett flate, og er viktig for pendellengden over spisebordet.
3. **Vinduene, for solskjerming.** Mål innvendig lysning (bredde × høyde) på hvert vindu. Forventet:
   * stuevinduene: ca. 2,36 × 1,81
   * langt kjøkkenvindu: 2,42 × 1,16
   * kvadratisk kjøkkenvindu: ca. 1,12 × 1,14
   * overlysvinduet: 1,75 × 0,48
   * terrassedøra: ca. 0,88 × 2,10

   Mål også lysningsdybden (0,20), om det er plass til persienne innenfor glasslisten, og avstanden fra overkant lysning til taket (0,30).
4. **Underkant av nedforingen over TV-stua** (2,40, 2,35 eller 2,33?).
5. **Posisjon langs sørveggen:** avstand fra knekkhjørnet til terrassedøra (0,07) og pilarbreddene (0,21 / 0,21 / 0,46).
6. **Spottene:** avstand fra nisjehjørnet og ut fra veggen.
7. **Spisebordet:** lengde × bredde (uttrukket?) og senter fra vindusveggen.
8. **Varmepumpa:** høyde over gulv og bredde.
9. **Kjøkkennedforingen:** avstand fra kjøkkenets bakvegg (3,32).
10. **Plassen til ny lenestol:** fritt gulv mellom TV-stua og sittegruppa er ca. x 3,2–4,4, z 8,4–11,3. Det er strimmelen langs åpningen, mellom sofaarmen (x 2,95), palmen (4,15; 11,62) og svingstolen (4,92; 8,82).

## Om feltene i JSON-filen

* **`walls`:**
  * Veggene går med klokka rundt rommet, så romsiden er alltid til høyre. Feltet `normal` peker inn i rommet.
  * Der toppen ikke er rett, oppgir `topProfile` [u, høyde] langs veggen.
  * `w-hoy` er nøyaktig den høye veggen. Gangdøra ligger i `w-gang` med offset 0.
  * Ytterhjørnene må fylles av vegg-byggeren (forleng med tykkelsen).
* **`highWall`** gir `start` = nisjehjørnet (venstre sett fra rommet), `uDir` = (0, −1), `normal` = (1, 0) og hindringer (`obstacles`) i u/v.
* **`fixtures`** inneholder stikkontakter, brytere, røykvarslere og varmepumpa. Det er nytt felt utenfor skjemaet.
* **`furniture`** har `mount` (floor/wall/ceiling/surface/soft/rug) og `archetype` (tilpasset `models/`-arketypene). For veggting gir `center` også vertikal midte.
* **`meta.conventions`** forklarer offset, hengsel/slagretning og kameraformatet.

## Korrigeringer

To uavhengige kontrollører foreslo 13 rettelser. Hver av dem er sjekket mot bildene. 12 er lagt inn (5 med justerte tall og 1 bare delvis) og 1 er forkastet.

### Lagt inn

* **win-s1** (justert): offset 1,16, bredde 2,36 (z 6,54–8,90). Pilaren dør–V1 er ca. 0,21 og ikke 0,13 (bekreftet i 082806 og 082914), men kontrolløren leste knekken feil i 082914, så 2,33 ble for smalt.
* **win-s2** (justert): offset 3,73, bredde 2,36 (z 9,11–11,47), endepilar 0,46. Samme tilpasning som for win-s1, og den stemmer med gruppe 4 og 6.
* **door-terrasse** (delvis): offset 0,07 er godtatt. Bredden 0,95 er forkastet, fordi den bygde på feillesingen av knekken. Med riktig lesing blir bredden ca. 0,88 (z 5,45–6,33).
* **win-k2**: offset 3,66, bredde 1,12 (z 3,66–4,78). 082916 og 082901 gir hver for seg 3,655–4,78.
* **w-sor.notes** (justert): oppdatert til stripe 0,07 og pilarer 0,21 / 0,21 / 0,46.
* **meta.notes[3] og dette notatet** (justert): beslutning 2 og 5, åpningstabellen og målebåndpunkt 3 og 5 er oppdatert.
* **f-dekor-overlys** (justert): rekkefølgen var speilvendt (082800, 082726). Z-verdiene er målt på nytt: bunke 10,81, boblevase 10,59, kremvase 10,20, terrakottavase 10,12, kurv 9,56.
* **f-settbord**: Ø 0,90 og Ø 0,75 stemmer med kanten på bordplatene i 082806. Avstanden fra midten er satt til 0,29 og −0,36, og dims.w til 1,48 slik at det passer med disse.
* **f-hoyttaler-v/-h**: venstre og høyre var byttet sett fra sofaen (082755). Posisjonene er byttet slik at id og navn stemmer.
* **f-sylinder**: det er en stående sort skumrulle med knotter og hul kjerne (082736, 082726). Material er satt til foam, sikkerhet til med, og subwoofer-teorien er fjernet.
* **f-pendel-stue.notes**: skjermene er 8 dype, nesten hele kuler i to størrelser, ikke grunne kupler (083006).
* **f-hjornesofa.params.modules**: den smale setemodulen (0,81) står i midten og den brede (0,93) ved armlenet. 082732 er tatt rett forfra og viser forholdet ca. 1,16.

### Forkastet

* **f-maleri.params.frame**: ingen tydelig lys sidekant i 082815 (forsiden går rett over i veggskyggen). I 082806, det eneste bildet som ser nordsiden av lerretet, er kanten mørk, så endringen er ikke dokumentert.

## Målelista

<!-- målelista:start -->
_Generert av `node src/data/scripts/normalize-data.mjs` (validateHouse i `src/data/scripts/house.mjs`) fra `research/house/*.json`. Ikke rediger avsnittet for hånd. Når et mål kommer inn: fjern feltet fra `estimated`, sett `source` til «målt <dato>» og kjør normaliseren på nytt._

**Rommene**

| Rom | Nivå | Type | Areal i modellen | Kontrollareal | Avvik |
|---|---|---|---|---|---|
| Stue/kjøkken (`stue-kjokken`) | 1. etasje | living | 53,78 m² | 53,78 m² | 0,0 % |
| Bad (`bad`) | 1. etasje | bathroom | 5,62 m² | 5,62 m² | -0,1 % |
| Gang (`gang`) | 1. etasje | hall | 6,58 m² | 6,44 m² | +2,2 % |
| Soverom (`soverom`) | 1. etasje | bedroom | 11,45 m² | 11,48 m² | -0,3 % |

**Anslått, sortert etter rom**

- **Nivåer**
  - 1. etasje (`levels/hoved`): `slabThickness`, `ceilingDefault`. Kilde: Planen og skalaen er meta.planFile, planPxPerM og planOriginPx (fotomålt, beholdes som alias). Dekket på 0,30 er anslått (D2, målelista punkt 1). Standardtaket 2,40 gjelder de nye rommene og er anslått (§1.4, målelista punkt 9).
- **Stue/kjøkken (`stue-kjokken`)**
  - `openings/door-gang`: `door.openAngleDeg`. Kilde: D6 og hele-huset-avstemming.md V55: 180° (bladet flatt mot gangsiden av w-gang, z 2,50–3,43) er et spillvalg – 225331 viser bladet ca. 90° åpent, men 90° ville sperret veien til badet. casing.back false: geriktens karm på gangsiden ville skåret inn i w-gang-sov (hullet går helt til z 4,43). V47: bare runde rosetter, ingen vrider.
- **Bad (`bad`)**
  - `rooms/bad`: `floor.color`, `baseboard`. Kilde: eier 2026-10-20 (2,53 × 2,22); bad-1etg.md (225413–225429 i mappa vaskerom/, 225333); hele-huset-avstemming.md V37, V42 (mørkt oppbrett i stedet for gulvlist)
  - `walls/w-bad-ost`: `thickness`, `height`. Kilde: bad-1etg.md (225425 rett forfra); hele-huset-avstemming.md V41 (steinplater #c8c5bf, bare loddrette skjøter hver 0,60)
  - `walls/w-bad-sor`: `height`. Kilde: bad-1etg.md (225413, 225423); D13 (baksiden av w-nisje-bak)
  - `walls/w-bad-gang`: `thickness`, `height`. Kilde: bad-1etg.md (225421 rett forfra); gang-1etg.md (225333); plantegning.png
  - `walls/w-bad-nord`: `thickness`, `height`. Kilde: bad-1etg.md (225419 rett forfra); plantegning.png («Vindu mål 48x117», 0,99 + 0,48 + 0,75 = 2,22)
  - `openings/door-bad`: `width`, `height`, `door.leaf`, `door.handleHeight`, `door.threshold`. Kilde: hele-huset-avstemming.md V15 (gulvkanten på x 1,45, 0,09 list til karmen), V47 (vrider med WC-vri), V48 (mørk topp med lys forkant mot gangen), V49 (hull x 1,54–2,45, blad 0,77 × 2,08 = hull − 2 × karm 0,07); bad-1etg.md, gang-1etg.md; 225333, 225335, 225421
  - `openings/win-bad`: `sill`, `obstruction`, `sashes`, `reveal.depth`. Kilde: eier 2026-10-20 (48 × 117); plantegning.png (0,99 fra østhjørnet); bad-1etg.md (225419: sill 0,88, topp 2,05, lys grå kantlist, frostet glass)
  - `ceilings/c-bad`: `height`, `paint`. Kilde: bad-1etg.md (glatt hvitt tak med svart taklist 3–4 cm rundt hele taket, 225413–225427); takhøyden 2,40 er anslått (eier: 2,4 for de flate takene)
  - `builtInLights/l-bad-tak`: `position`, `dims`, `lumens`, `lightColorK`. Kilde: bad-1etg.md (rund påbygd LED-plafond med opal front og mørk grå kant, Ø 0,40–0,45, midt i taket; 225413, 225417, 225419, 225427); hele-huset-avstemming.md V45 (mørk kant, 1500 lm)
  - `builtInLights/l-bad-spot`: hele oppføringen. Kilde: bad-1etg.md (innfelt, sort ring, nær døra; 225413, 225421); hele-huset-avstemming.md V45
  - `fixtures/fx-ventil-bad`: hele oppføringen. Kilde: bad-1etg.md (rund, mørk grå, Ø ca. 0,15, i taket over vinduet; 225417, 225419); design §2.3 (Lys: «en mørk ventil ved vindusveggen»)
- **Gang (`gang`)**
  - `rooms/gang`: `baseboard`. Kilde: eier 2026-10-20 (3,11 × 2,07); gang-1etg.md; hele-huset-avstemming.md V50 (gulvlist i lys eik), V54 (D1: vestveggen på z 4,43–4,53, sørveggen x 3,12 = baksiden av w-gang)
  - `walls/w-gang-ost`: `height`. Kilde: gang-1etg.md (225333, 225324); D13 (baksiden av w-bad-gang og w-nisje-side)
  - `walls/w-gang-hall`: `height`. Kilde: gang-1etg.md (225324, 225327, 225331); hele-huset-avstemming.md V54 (x 3,12 = baksiden av w-gang); D13
  - `walls/w-gang-sov`: `thickness`, `height`. Kilde: gang-1etg.md (225331, 225335); soverom-1etg.md; D1 og hele-huset-avstemming.md V54 (z 4,43–4,53)
  - `walls/w-gang-nord`: `thickness`, `height`. Kilde: gang-1etg.md (225331, 225335, 225337, 225339): yttervegg uten vindu og dør
  - `openings/door-soverom`: `width`, `height`, `door.leaf`, `door.threshold.depth`. Kilde: soverom-1etg.md (225304, 225308, 225316: hengsler i sør, slår inn i soverommet og legger seg mot sørveggen; vrider med rund rosett på begge sider og sluttstykke i blank stål); hele-huset-avstemming.md V47, V48 (smal metallterskel #2b2b2d), V49 (hull x 2,11–3,06, blad 0,81 × 2,05)
  - `ceilings/c-gang`: `height`, `paint`. Kilde: gang-1etg.md (lyst, nær nøytralt ved lampa, uten taklist; 225331); design §2.4. Flatt også over trappehullet.
  - `builtInLights/l-gang-tak`: `position`, `dims`, `lumens`, `lightColorK`. Kilde: hele-huset-avstemming.md V46 (Ø 0,38 på (1,2; 2,40; 3,1), 3500–4000 K, hvit kant #f0f0ee); gang-1etg.md (225324, 225327, 225331, 225333)
  - `fixtures/fx-takpunkt-gang-p1`: hele oppføringen. Kilde: hele-huset-avstemming.md V46; gang-1etg.md (225331, 225333): rundt, sort, litt kuplet, ikke tent
  - `fixtures/fx-takpunkt-gang-p2`: hele oppføringen. Kilde: hele-huset-avstemming.md V46; gang-1etg.md (225324, 225327)
  - `fixtures/fx-stikk-gang`: `position`. Kilde: gang-1etg.md (225331, 225335): sort, rett sør for rekkverksstolpen på x 1,85, senter ca. 0,18; design §2.4
- **Soverom (`soverom`)**
  - `rooms/soverom`: `baseboard`. Kilde: eier 2026-10-20 (3,11 × 3,69); soverom-1etg.md; hele-huset-avstemming.md V50, V54 (D1: østveggen på z 4,53)
  - `walls/w-sov-ost`: `height`, `paint`. Kilde: soverom-1etg.md (225304, 225308); D13 (baksiden av w-gang-sov)
  - `walls/w-sov-sor`: `height`, `paint`. Kilde: soverom-1etg.md (225259, 225304, 225316); D13 (baksiden av w-hoy, som er 3,00 høy på stuesiden)
  - `walls/w-sov-vest`: `height`, `paint`. Kilde: soverom-1etg.md (225259, 225307, 225316); D13 (baksiden av w-sov-tv, 0,14 tykk)
  - `walls/w-sov-nord`: `thickness`, `height`, `paint`. Kilde: soverom-1etg.md (225307); plantegning.png
  - `openings/win-sov`: `frame`, `sashes`, `obstruction`, `sillBoard`. Kilde: hele-huset-avstemming.md V51 (z 6,11–7,28, 1,17 × 1,17, sill 0,92, topp 2,09, smyg 0,20 i veggfargen uten gerikt, mørkleggingsgardin #2a2b2d nede med hvit snor på østsiden); soverom-1etg.md (225307); plantegning.png (z 6,10–7,30)
  - `ceilings/c-soverom`: `height`, `paint`. Kilde: soverom-1etg.md (helmalt: taket i samme mørke blågrå som veggene, 225259, 225316)
  - `builtInLights/l-sov-tak`: `position`, `dims`, `lumens`, `lightColorK`. Kilde: soverom-1etg.md (rund flat plafond med opal diffuser og lys kant, Ø 0,40, ca. midt i rommet, kjølig hvitt; 225259, 225304); design §2.5
  - `builtInLights/l-sov-garderobe`: hele oppføringen. Kilde: soverom-1etg.md (varmhvit LED-list langs hele toppen av garderobefronten, ca. 1,88 m, 225304, 225308); design §2.5 og §4.10 (gruppa soverom: plafond og garderobe-LED)
  - `fixtures/fx-takpunkt-sov-a`: hele oppføringen. Kilde: soverom-1etg.md (lite mørkt innfelt punkt, ikke tent; 225304, 225308)
  - `fixtures/fx-takpunkt-sov-b`: hele oppføringen. Kilde: soverom-1etg.md (225316; plasseringen er usikker)
<!-- målelista:slutt -->
