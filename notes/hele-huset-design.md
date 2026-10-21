# Hele huset i Interiørspillet: design- og byggeplan

Endelig versjon 2026-10-21. Repo: `C:\Dev\Interiørspillet`, og alle stier under er relative til denne mappa.
Koordinater: meter, +x = sør (de store vinduene), +z = vest, y opp. Modellene vender mot lokal +z.
`yaw` i URL-en er i grader: 0 = øst (−z), 90 = nord (−x), −90 = sør (+x) og 180 = vest (+z) (src/main.js:123-124).

**Kilder, i prioritert rekkefølge:**
1. `notes/hele-huset-fakta.md` (eieren, 2026-10-20) er fasit.
2. Fotonotatene i `notes/hus-foto/` (8 filer, skrevet 23:35–23:48):
   - `bad-1etg.md`, `gang-1etg.md`, `soverom-1etg.md`
   - `entre-gang-kjeller.md`, `kjellerstue.md`, `soverom-kjeller.md`, `vaskerom.md`
   - `ytterdor-ute.md`
   
   De er hovedkilden for farger, innredning og plassering. Der et notat og planen er uenige, gjelder det som er målt på bildet.
3. `plantegning.png` (51,3 px/m) og `bilder_hus/plantegning_kjeller.png` (904 × 959 px, ca. 60,3 px/m).
4. Tre kritikker av utkastet. Det som holdt mot koden, er tatt inn. Det som ikke holdt, er forkastet og begrunnet der det
   hører hjemme.

---

## 0. Faste regler for natta

- **Fasit:** fakta-fila. Ingenting i planen går imot den. Der planen avviker fra et tall eieren har oppgitt (areal,
  mål), står avviket i beslutningstabellen og på målelista.
- **Port 5180 skal ingen røre.** Den er brukerens egen dev-server med HMR.
  - Port 5260 tilhører katalog-arbeidstreet.
  - Port 5250 er integratorens testserver.
  - Portene 5251–5259 brukes av agentene, én port hver.
  - Alle testservere kjører `vite` med `server.hmr: false` fra agentens eget arbeidstre (se §7.1).
- **Prosesser:**
  - Stopp bare PID-er du selv har startet, med `taskkill /PID <pid> /T /F`.
  - Drep aldri prosesser etter navn, og aldri `msedge.exe`.
  - Start nettlesere med `chromium.launchServer()` og skriv PID-en til `.shots/hus/<steg>/browser.pid`.
  - Bare én hodeløs nettleser rendrer om gangen. Det styres med låsekatalogen `.shots/hus/gpu.lock.d` i hovedtreet
    (`mkdir`; finnes den, vent 20 s og prøv igjen; eldre enn 15 min er foreldet). Verktøyene fra steg 2 tar den selv
    med `--lock`.
- **Hold maskinen våken** ved å be verten om keep-awake. Strøminnstillinger skal ikke endres.
- **Ingen git push og ingen Railway-deploy.**
  - Alt blir lokale commits på grenen `hele-huset`.
  - Hvert steg har ett commit, og bare med egne stier: `git commit -- <stier>`.
  - Integratoren fletter stegene inn i stegrekkefølge.
  - Milepælene A, B og C er sjekkpunkter, ikke stopp. Brukeren tester om morgenen.
- **Arbeidstrær:** hver agent har sitt eget tre.
  - Lag det med `git worktree add .claude/worktrees/hus-<steg> -b hus/<steg> hele-huset`.
  - Lag en `node_modules`-junction til hovedtreet.
  - `bilder_hus/` er gitignorert og finnes ikke i arbeidstrærne. Bruk absolutt sti: `C:\Dev\Interiørspillet\bilder_hus\`.
- **`src/data/room-spec.json` redigeres aldri for hånd.**
  - Data skrives bare i `research/house/NN-*.json`.
  - Fila genereres med `node src/data/scripts/normalize-data.mjs --only=room-spec`.
  - Ved flettekonflikt kjører du normaliseren på nytt. Resultatet er deterministisk.
- **Ingen eksisterende id får nytt navn.** Det gjelder vegger, åpninger, soner, lys, møbler, foto-kameraer og `'0_for'`.
  Lagrede design peker på dem.
- **Stua skal se og høres lik ut som før:**
  - etterklangstid 0,86 s, volum 138,57 m³ og gulv 53,78 m²;
  - samme LightManager-tall per foto-kamera (§7.1);
  - bildediff mot referansene fra steg 2.
  
  Unntak godkjennes bare i stegene L1, L2 og C3, og bare med begrunnelse.
- **Rot modelleres ikke.** Det gjelder klær, sokker, esker, ledninger, verktøy, plast og løse planker. Pynt som notatene
  merker «valgfri», tas med som `optional`.

## Beslutninger i planen

Beslutningene er tatt nå, så ingen står fast i natt. Alt som ikke er målt, er merket `estimated` i dataene (§8.6).

| # | Beslutning | Grunnlag |
|---|---|---|
| D1 | Veggen mellom gang og soverom ligger på **z 4,43–4,53**. Gangen er 3,12 × 2,11 og soverommet 3,12 × 3,67. | `door-gang` (z 3,36–4,43) er fotomålt helt ut til z 4,43. Notatene leser 4,40 og 4,51, som er 2–3 cm unna. |
| D2 | **Høyder:**<br>• kjellergulvet ligger på `floorY` **−2,55**;<br>• dekket er 0,30 (y −0,30–0);<br>• kjelleren har én felles takhøyde på **2,25**;<br>• trappa har **14 opptrinn à 0,182**;<br>• entréen ligger på **−2,85** (2 trinn à 0,15 ned fra gangen);<br>• forplassen ute ligger på **−2,87**. | Bildene gir 14–15 opptrinn à 0,18–0,19 (to uavhengige notater).<br>Kanten rundt hullet er 0,25–0,30.<br>Kjellertakene er 2,22–2,30.<br>Reposet ute er triangulert til ≈ −2,7 (−2,4…−3,0).<br>Himlingen ute ligger 2,40 over terskelen.<br>Utkastets −2,70 med 15 × 0,18 ga 0,40 dekke under et tak på 2,30. |
| D3 | **Kjellerplanen legges inn slik:**<br>• origo = det innvendige NØ-hjørnet, px (127, 120) = spill (0, 0);<br>• x = (px − 127)/60,3, uskalert;<br>• z = (py − 120)/56,8, det vil si strukket **6,1 %**, så vestre yttervegg flukter med 1. etasje (innvendig z 11,93);<br>• to vegger låses til trappesjakta: østveggen på **z 2,32** for x < 1,75 (nisjen ved boden) og vestveggen på **z 4,43** for x 0–2,91;<br>• for åpninger transformeres midtpunktet, mens bredden beholdes. | Med uskalert x havner kjellerstuas sørvegg (innvendig 6,32) på kjøkkenets fasadelinje, og hjørnesøylen i entréen bekrefter hjørnet.<br>Sjakta må være én: håndløperen og veggene går uten brudd ned (225331, 225349).<br>Arealene blir 4–7 % større enn eierens (advarsel, ikke feil).<br>Alternativet er planen uskalert med 0,36–0,5 m utkraging i vest. Målepunkt 7 avgjør. |
| D4 | **Trappa er halvsvingt med svingtrinn rundt en kort kjerne og har åpne opptrinn:**<br>• øverste trinnkant ligger på **x 1,50** på østsiden (z 2,32–3,10), og man går ned mot nord;<br>• kjernen ligger på x 1,20–1,50 · z 3,10–3,48;<br>• nederste trinnkant ligger på **x 1,60** på vestsiden (z 3,48–4,43), og man går ned mot sør inn i kjellergangen;<br>• det er 1 rett trinn øverst, 3 rette nederst og svingtrinn imellom;<br>• inntrinnet regnes ut fra ganglinja og blir ≈ 0,20–0,23. | `gang-1etg.md` og `entre-gang-kjeller.md` (225331–225344, 225349, 225639). Skraveringen i kjellerplanen slutter på x 1,59.<br>Utkastets nedre løp til x 2,29 sperret vaskeromsdøra (x 1,69–2,58). |
| D5 | **Hullet er trappeformet, slik bildene viser:**<br>• x 0–1,50 for z 2,32–3,48;<br>• x 0–1,85 for z 3,48–4,43 (rekkverk A/B/C). | Lest av bildene ±0,08, med plankeskjøter og karmer som målestokk. Eierens «1,54» er øverste trinn. Hullet er ikke utledet fra fri høyde. |
| D6 | **`door-gang` åpnes 180°** og legger seg flatt mot gangsiden av `w-gang` (z 2,50–3,43). `Door.js` får `openAngleDeg`. | På 225331 står bladet åpent inntil veggen. Med 90° ville det vært 0,34 m til rekkverk A, mens kapselen trenger 0,60, og gangen ville vært sperret. |
| D7 | **Hovedinngangen er ytterdøra i kjellerens entré.** Den er utadslående med hengsler i øst, og den er interaktiv. Første lasting (ingen lagret posisjon) starter **ute på forplassen**. 1. etasje har ingen ytterdør. | Fakta («Start ute»), `ytterdor-ute.md`, `gang-1etg.md`. Dette erstatter utkastets D7. |
| D8 | **Bakken ved inngangen ligger på inngangsnivå (−2,87):**<br>• repos, sti og «walk» fra TERRACE_FIT (−1,72) senkes til −2,87;<br>• plenen nær huset senkes også;<br>• terrassetrappa forlenges til 15–16 opptrinn. | Terskelen ligger 2–4 cm over bakken (225553).<br>Det er én flate fra døra rundt pilaren (225543).<br>Trianguleringen gir det samme, og `outside.groundBelowY` var −2,7.<br>C3 sjekker med fotoprojeksjon, og eieren teller trinn. |
| D9 | **Kjellerstuas sørvegg står som tegnet** (innvendig 6,32, utvendig 6,62). Stua kraget **0,60 m** ut over den (x 6,62–7,22). Grunnmursboksen under `w-sor` erstattes av kjellerveggen og en himling. | Hjørnesøylen 0,56 × 0,56 i entréen er kjellerstuas SØ-hjørne (x 6,01–6,57), og den er fotografert.<br>Linja er den samme som kjøkkenets fasade og terrassens start (6,62). |
| D10 | **Rommet under terrassen (bod-3) slutter på terrassekanten** (utvendig x 9,80). Det blir 3,25 × 3,02 i stedet for 3,70 × 2,84. Søylene under terrassekanten på z 0,25 og z ≈ 3,4 fjernes. | Terrassekanten er fototriangulert (TERRACE_FIT). 225543 viser kledd sidevegg og ingen søyle foran østre sidefelt. |
| D11 | **De tre bodene har lukkede dører som kan åpnes, med tomme rom bak.** | Fakta. Døra til den grå boden står ikke i planen, men er fotografert (225635). Døra til bod-3 er i entréen (225617). |
| D12 | **Stue, kjøkken og TV-stue er fortsatt ett akustisk rom og ett lysrom**, med nøyaktig dagens tall. Alle gamle felt i `layout` gjelder bare stua (§1.8). | Kalibreringen er tilpasset bildene. |
| D13 | **Der en ny romflate er baksiden av en eksisterende vegg, gjenbrukes veggskiva (`backOf`).** Gruppe 0 blir eget mesh med flatens id og maling. Det bygges aldri en ny flate oppå den gamle. | Ellers blir det z-fighting og dobbel kollisjon. |
| D14 | **Møbler bruker arketypene fra katalog-grenen:**<br>• `bed`, `bedside-table`, `wardrobe`, `wall-cabinet`, `mirror-cabinet`, `coat-rack`, `coat-stand` og `tv`;<br>• sanitær- og vaskeutstyr er `builtIns` og kan ikke flyttes;<br>• `src/models/bed.js` skrives ikke. | `.claude/worktrees/katalog-hele-huset` eier `src/models/`, `archetypes.json` og katalogdelene av normaliseren (91 arketyper). |
| D15 | **Badet i 1. etasje bygges fra bildene 225413–225429.** De ligger i mappa `vaskerom/`, men viser badet i 1. etasje. Der `bad-1etg.md` (som bare bygger på et glimt i 225333) er uenig, gjelder disse bildene: WC står på nordveggen, servant og høyskap på østveggen, speilet er rundt LED-speil, og det er ingen håndkletørker. | Tillegget i `vaskerom.md`. |

---

## 1. Datamodell

### 1.1 Prinsipper

- **Arrayene forblir flate** (`walls`, `ceilings`, `zones`, `furniture`, `fixtures`, `builtInLights`, `photoCameras`).
  - Nye oppføringer får `roomId`. Mangler den, betyr det `'stue-kjokken'` i nivået `'hoved'`.
  - Dagens data er byte-identiske, bortsett fra én regenerering (de 17 `notes`-tekstene, se steg 3).
- **All y i spesen er nivålokal**, regnet fra gulvet i rommets nivå. Det gjelder:
  - `sill`, `height`, `topProfile` og tak;
  - kasser, innebygde lys og fixtures;
  - møbler, `builtIns` og `photoCameras`.
  
  Bare `layout.js` legger til `floorY`. Unntakene er `outside`, som bruker verdens-y, og entréen i kjelleren, som ligger
  0,30 under nivåets gulv. Den får eget felt: `rooms[].floorOffset: -0.30`.
- **Hvert rom har sin egen veggsløyfe med klokka**, med rommet til høyre og normalen innover (`meta.conventions`).
  Gjæring og sokkel regnes per romsløyfe (shell.js:540-556).
- **Gamle `layout`-felt gjelder bare stua.** Hele huset ligger under `layout.house.*` (§1.8). Da kan ikke data fra et steg
  endre stua før steget som eier forbrukeren, tar det i bruk.
- **Usikre verdier merkes på hver oppføring.**
  - `estimated: ["felt", …]` lister de anslåtte feltene. `["*"]` betyr at hele oppføringen er anslått.
  - `source: "…"` peker på fotonotat, bilde, plan eller eier.

### 1.2 Nye nøkler på toppnivå

Disse legges bakerst, så nøkkelrekkefølgen er stabil:

| Nøkkel | Innhold |
|---|---|
| `levels[]` | `{ id, name, floorY, slabThickness, ceilingDefault, plan:{file, pxPerM, originPx}, estimated, source }`. `pxPerM` kan være `[x, z]`. `hoved` får `meta.planPxPerM`, `planOriginPx` og `planFile`, som beholdes som alias. |
| `rooms[]` | `{ id, name, levelId, kind, polygon, floorOffset?, floor:{material,color,boards?}, ceilingIds, acoustic:{mode:'calibrated'\|'estimate'}, autoLight?, closed? }`.<br>• `kind` er en av `living`, `bathroom`, `hall`, `bedroom`, `laundry`, `storage`, `entrance` eller `hud`.<br>• Polygonet har positiv shoelace i (x, z).<br>• `stue-kjokken` legges inn i `00-hus.json`, med `floor.polygon` som polygon. |
| `floorOpenings[]` | `{ id, levelId, roomId, polygon, stairId, edgeBand:{color, depth} }`. Hullet trekkes fra gulvet og dekket i rommet og fra taket i nivået under. |
| `stairs[]` | Parametrisk trapp (se §1.6). Trappa lagrer ingen absolutt y. Høyden er `floorY`-differansen. |
| `builtIns[]` | Faste innretninger: `{ id, roomId, type, mount:'floor'\|'wall', wallId?, position, dims:{w,d,h}, rotationDeg, colors, materials, params, collide, light? }`. Konvensjonen er som for møbler (meta.conventions), ikke kjøkkenets midt-i-boksen. Typene er `wc`, `vanity`, `shower`, `mirror-round`, `floor-drain`, `towel-radiator`, `laundry-bench`, `cabinet-row`, `washer`, `dryer` og `wardrobe-sliding`. |
| `lightGroups[]` | `{ id, label, roomId, dimmer, defaultDimmer, auto }`. Dagens seks grupper (layout.js:76-91) beholdes i koden. Nye grupper kommer fra data. |
| `facadeSegments[]` | `{ id, wallIds:[…], joinStart?, joinEnd?, material:'cladding'\|'plaster', yRange? }`. Bare nye yttervegger får dette. De eksisterende er fotomålt og røres ikke. |
| `outsideHouse` | `{ entranceLevelY, forecourt:{polygon,y}, terraceStair:{risers}, walkRects:[…], spawnOutside:{pos,yawDeg,pitchDeg} }`. Flettes inn i `outside` av C3. |

### 1.3 Nye felt på eksisterende typer

- **`walls[]`:**
  - `roomId`;
  - `backOf: "w-id" | ["w-id", …]` (tykkelse 0, ingen egen geometri, men egen id, maling, plukking og sokkel);
  - `exterior`;
  - `material` (`paint`, `stone-panel`, `wetroom-paint` eller `dark-panel`);
  - `topProfile` (finnes fra før). Sjaktveggene i kjelleren bruker det til å gå opp til 2,55, nivålokalt.
- **Dører:**
  - **Bare** formatet `door-gang` bruker: `door:{ hinge, swing, leaf:{w,h}, closed, handleSide, handleHeight, leafColor }`,
    `frame:{color,width,depth}` og `reveal`.
    - layout.js:310-319 gjenkjenner en dør bare når `o.door` finnes, så `hinge` og `swing` rett på åpningen gir et hull uten
      dør.
    - Validatoren avviser det formatet.
  - Nye felt i `door`:
    - `openAngleDeg` (standard 90);
    - `opensInto: '<romId>'`, som validatoren sjekker mot `swing` og eierveggens rom;
    - `casing: { front, back }` (standard `true`). `door-gang` får `back:false`, så den gangvendte geriktens karm ikke skjærer inn i
      `w-gang-sov`.
  - På åpningen:
    - `connects: [rom A, rom B]`;
    - `interactive` (standard `true` når begge rommene er modellert);
    - `locked`.
  - Hver åpning defineres én gang, på eierveggen. Layout avleder hullet i `backOf`-flaten.
- **`windows`:** `frosted`, `skyView` (0–1, for kjellervinduer) og `obstruction` (per vindu, standard som `OBSTRUCTION` i
  lighting.js:81).
- **`builtInLights[]`:**
  - Bruk `lightColorK` og `dims`. layout.js:506 leser `lightColorK`, så `kelvin` og `diameter` ignoreres stille.
  - Nye typer:
    - `plafond`: påbygd rund LED, `dims:{d,h}`;
    - `downlight`: innfelt, `dims:{d}`.
  
  Begge bygges i `rooms.js` og lyses i `lighting.js` (§4).
- **`fixtures[]`:** `mount` respekteres (rettes i layout.js:557). Fixtures kan sitte på `backOf`-flater.
- **`photoCameras[]`:** `roomId`.
  - id-en er fortsatt filnavnet, fordi `PhotoCompare.js:99` bygger `img/foto/${id}.jpg`. `'0_for'` er hardkodet i
    PhotoCompare.js:85, 98, 223, 242, 247 og WallPanel.js:494, 672, 1550.
  - Prefiks `<romId>-` brukes bare for nye kameraer, og bare ved kollisjon.

### 1.4 Rommene

**1. etasje** (nivå `hoved`, `floorY` 0, tak 2,40 flatt og anslått):

| id | Navn | Polygon (x, z) | Areal | Kilde |
|---|---|---|---|---|
| `bad` | Bad | x 0–2,53 · z 0–2,22 | 5,62 | plan, `vaskerom.md` (Tillegg), `bad-1etg.md` |
| `gang` | Gang | x 0–3,12 · z 2,32–4,43 | 6,58 brutto, ≈ 3,1 netto | plan, `gang-1etg.md` |
| `soverom` | Soverom | x 0–3,12 · z 4,53–8,20 | 11,45 | plan, `soverom-1etg.md` |
| `trapp` | Trappa (`kind:'hud'`) | hullpolygonet som prisme fra kjellergulvet til 1. etasjes gulv + 1 m | – | bare HUD, se §5.1 |

Banneret viser «Gang», ikke «Gang/entré», fordi entréen er i kjelleren. Navnet i data kan endres uten at id-en endres.

**Veggflatene.** Rommet ligger til høyre, og `backOf` peker på eksisterende skiver:

- **Bad:**
  - `w-bad-ost` `[0,0]→[2.53,0]`: yttervegg 0,30.
  - `w-bad-sor` `[2.53,0]→[2.53,2.22]`: `backOf: w-nisje-bak`.
  - `w-bad-gang` `[2.53,2.22]→[0,2.22]`: ny skillevegg 0,10, med `door-bad`.
  - `w-bad-nord` `[0,2.22]→[0,0]`: yttervegg, med `win-bad`.
- **Gang:**
  - `w-gang-ost` `[0,2.32]→[3.12,2.32]`: `backOf: ["w-bad-gang","w-nisje-side"]`.
  - `w-gang-hall` `[3.12,2.32]→[3.12,4.43]`: `backOf: w-gang`. `door-gang` finnes fra før og får `connects` og `openAngleDeg: 180`.
  - `w-gang-sov` `[3.12,4.43]→[0,4.43]`: ny skillevegg 0,10, med `door-soverom`.
  - `w-gang-nord` `[0,4.43]→[0,2.32]`: yttervegg, helt inne i hullet.
- **Soverom:**
  - `w-sov-ost` `[0,4.53]→[3.12,4.53]`: `backOf: w-gang-sov`.
  - `w-sov-sor` `[3.12,4.53]→[3.12,8.20]`: `backOf: w-hoy`.
  - `w-sov-vest` `[3.12,8.20]→[0,8.20]`: `backOf: w-sov-tv`.
  - `w-sov-nord` `[0,8.20]→[0,4.53]`: yttervegg, med `win-sov`.

**Åpningene:**

| Åpning | Vegg | Plassering | Detaljer |
|---|---|---|---|
| `door-bad` | `w-bad-gang` | x 1,52–2,45 (offset 0,08, bredde 0,93, høyde 2,15) | `hinge:"from"` (sør), `swing:"in"`, `opensInto:"bad"`, blad 0,79 × 2,08. Hullet starter 2 cm sør for hullkanten på x 1,50, så karmen ikke henger over hullet. |
| `door-soverom` | `w-gang-sov` | x 2,11–3,06 (offset 0,06, bredde 0,95, høyde 2,12) | `hinge:"from"` (sør), `swing:"out"` (veggen eies av gangen), `opensInto:"soverom"`. Legger seg mot sørveggen og har dørstopper (225316). |
| `win-bad` | `w-bad-nord` | z 0,99–1,47 (offset 0,75), 0,48 × 1,17 | Sålbenk 0,88 og topp 2,05, frostet glass, svart ramme og lys grå lysning (225417–225419). |
| `win-sov` | `w-sov-nord` | z 6,11–7,26 (offset 0,94), 1,15 × 1,10 | Sålbenk 0,95. Mørkleggingsrullegardin `#2a2b2d`, nede, via `shading` (225307). |

**Kjeller** (nivå `kjeller`, `floorY` −2,55, tak 2,25). Alt er anslått og plassert etter D3.

| id | Navn | Polygon (x, z) | Areal (eier/plan → modell) | Merknad |
|---|---|---|---|---|
| `kjeller-gang` | Gang (kjeller) | Sjakt og nisje x 0–1,75 · z 2,32–4,43. Smal del x 1,75–2,91 · z 2,56–4,43. Sørdel x 2,91–5,60 · z 2,56–5,36. | 12,50 → 13,4 | Trappa står her. Ingen vinduer. Ca. 5 downlights. |
| `vaskerom` | Bad/vaskerom | x 0–2,64 · z 4,55–8,84 | 2,64 × 4,08 → 2,64 × 4,29 | Dør fra gangen på x 1,69–2,58. Nordvindu z 7,25–8,53, sålbenk 1,50. |
| `soverom-kjeller` | Soverom (kjeller) | x 0–2,63 · z 8,99–11,93 | 7,41 → 7,73 | Dør fra kjellerstua. Vestvindu x 0,59–1,90, sålbenk 0,87. Ingen seng på bildene. |
| `kjellerstue` | Kjellerstue | x 2,92–6,32 · z 5,45–11,93 | 20,57 → 22,0 | Dør fra gangen på x 3,07–4,02. Sørvinduene V1 (z 7,72–9,07) og V2 (z 9,94–11,29), sålbenk 0,85, topp 2,15. Tak 2,22. |
| `entre-kjeller` | Entré | x 6,01–8,51 · z 3,15–6,03, minus søylen x 6,01–6,57 · z 5,47–6,03 | 2,51 × 2,93 → 2,50 × 2,88 | `floorOffset −0,30`, tak på y −0,45. Ytterdør i sør. Åpning med 2 trinn opp til gangen. Garderobe på vestveggen. |
| `bod-1` | Bod | x 0–1,68 · z 0–2,22 | 1,64 × 2,32 → 1,68 × 2,22 | Dør x 0,84–1,63 i nisjeveggen (z 2,32), hengslet i nord. Høyden kuttes under trappa (§2.6). |
| `bod-2` | Bod (grå) | x 1,88–6,22 · z 0–2,46 | 4,28 × 2,32 → 4,34 × 2,46 | Dør x 4,60–5,55 (ikke i planen, 225635), hengslet i sør. Betonggulv `#8a8580`. |
| `bod-3` | Rom under terrassen | x 6,32–9,57 · z 0–3,02 | 3,70 × 2,84 → 3,25 × 3,02 | Dør fra entréen på x 6,11–7,09, hengslet i nord. Oransjebrunt parkettgulv. Lukket (D10). |

- Bodenes navn er anslått.
- Veggene mellom rommene følger av polygonene: 0,10–0,12 innvendig, 0,41 mellom gang og entré, 0,23–0,30 ute.
- I et strukket rom skaleres plasseringer langs z fra fotonotatet med romlengden, mens tingenes egne mål beholdes.

### 1.5 Eksempel: badet

Fila er `research/house/10-hoved-rom.json` (utdrag). Innredningen ligger i `11-hoved-innredning.json`, men er tatt med her
for å vise formatet.

```json
{
  "levelId": "hoved",
  "rooms": [{
    "id": "bad", "name": "Bad", "levelId": "hoved", "kind": "bathroom",
    "polygon": [[0,0],[2.53,0],[2.53,2.22],[0,2.22]],
    "floor": { "material": "vinyl", "color": "#5a5759", "pattern": "cloudy" },
    "ceilingIds": ["c-bad"], "acoustic": { "mode": "estimate" },
    "estimated": ["floor.color"],
    "source": "vaskerom.md (Tillegg: 225413–225429 = Bad 1. etg), bad-1etg.md, 225333"
  }],
  "walls": [
    { "id": "w-bad-ost", "roomId": "bad", "from": [0,0], "to": [2.53,0], "normal": [0,1],
      "thickness": 0.30, "exterior": true, "height": 2.40, "material": "stone-panel", "color": "#c6c1b9" },
    { "id": "w-bad-sor", "roomId": "bad", "from": [2.53,0], "to": [2.53,2.22], "normal": [-1,0],
      "backOf": "w-nisje-bak", "material": "stone-panel", "color": "#c6c1b9" },
    { "id": "w-bad-gang", "roomId": "bad", "from": [2.53,2.22], "to": [0,2.22], "normal": [0,-1],
      "thickness": 0.10, "height": 2.40, "material": "stone-panel", "color": "#c6c1b9",
      "openings": [{ "id": "door-bad", "type": "door", "offset": 0.08, "width": 0.93, "height": 2.15, "sill": 0,
        "frame": { "color": "#1d1e21", "width": 0.07, "depth": 0.02 }, "reveal": { "depth": 0.10, "color": "#1d1e21" },
        "door": { "leafColor": "#1d1e21", "hinge": "from", "swing": "in", "opensInto": "bad",
                  "leaf": { "w": 0.79, "h": 2.08 }, "handleSide": "to", "handleHeight": 1.05, "closed": true,
                  "threshold": "#d6cfc4" },
        "connects": ["bad","gang"], "interactive": true,
        "estimated": ["width","height","door.leaf"], "source": "gang-1etg.md, bad-1etg.md, 225333" }] },
    { "id": "w-bad-nord", "roomId": "bad", "from": [0,2.22], "to": [0,0], "normal": [1,0],
      "thickness": 0.30, "exterior": true, "height": 2.40, "material": "stone-panel", "color": "#c6c1b9",
      "openings": [{ "id": "win-bad", "type": "window", "offset": 0.75, "width": 0.48, "height": 1.17,
        "sill": 0.88, "frosted": true, "obstruction": 0.8, "estimated": ["sill"] }] }
  ],
  "ceilings": [{ "id": "c-bad", "roomId": "bad", "polygon": [[0,0],[2.53,0],[2.53,2.22],[0,2.22]],
                 "height": 2.40, "color": "#efefed", "trim": "#1d1e21", "estimated": ["height"] }],
  "facadeSegments": [
    { "id": "f-nord-hoved", "wallIds": ["w-bad-nord","w-gang-nord","w-sov-nord"], "joinEnd": "w-nord-tv", "material": "cladding" },
    { "id": "f-ost-bad", "wallIds": ["w-bad-ost"], "joinEnd": "w-kjokken-ost", "material": "cladding" }
  ],
  "builtIns": [
    { "id": "bi-bad-dusj", "roomId": "bad", "type": "shower", "mount": "floor", "position": [0.45, 0, 0.45],
      "dims": { "w": 0.90, "d": 0.90, "h": 2.00 }, "rotationDeg": 0,
      "params": { "shape": "pentagon", "cut": 0.35, "doors": 2, "profile": "#151515", "set": "black-rain", "drain": "round-steel" },
      "estimated": ["dims","params.cut"] },
    { "id": "bi-bad-wc", "roomId": "bad", "type": "wc", "mount": "wall", "wallId": "w-bad-nord",
      "position": [0, 0, 1.85], "dims": { "w": 0.70, "d": 0.20, "h": 1.10 }, "rotationDeg": 90,
      "params": { "bowl": { "w": 0.36, "d": 0.54, "rimH": 0.42 }, "flushPlate": "#1d1e21", "shelfEdge": "#a7a9a8" },
      "estimated": ["position","dims"] },
    { "id": "bi-bad-servant", "roomId": "bad", "type": "vanity", "mount": "wall", "wallId": "w-bad-ost",
      "position": [1.75, 0.35, 0], "dims": { "w": 0.80, "d": 0.46, "h": 0.50 }, "rotationDeg": 0,
      "colors": { "cabinet": "#1f1f22", "basin": "#f2f2f0" }, "params": { "drawers": 2, "tap": "black-metal" },
      "estimated": ["position"] },
    { "id": "bi-bad-speil", "roomId": "bad", "type": "mirror-round", "mount": "wall", "wallId": "w-bad-ost",
      "position": [1.75, 1.05, 0], "dims": { "w": 0.70, "d": 0.04, "h": 0.70 },
      "light": { "lumens": 300, "lightColorK": 4000, "group": "bad" }, "estimated": ["*"] }
  ],
  "builtInLights": [
    { "id": "l-bad-tak", "roomId": "bad", "group": "bad", "type": "plafond", "position": [1.26, 2.40, 1.11],
      "dims": { "d": 0.42, "h": 0.07 }, "lumens": 1400, "lightColorK": 4000, "estimated": ["lumens","lightColorK"] },
    { "id": "l-bad-spot", "roomId": "bad", "group": "bad", "type": "downlight", "position": [2.05, 2.40, 1.85],
      "dims": { "d": 0.09 }, "lumens": 300, "lightColorK": 3000, "estimated": ["*"] }
  ],
  "lightGroups": [{ "id": "bad", "label": "Bad", "roomId": "bad", "dimmer": true, "defaultDimmer": 0.6 }]
}
```

- `offset` regnes langs veggen fra `from`. For `w-bad-gang` blir det 2,53 − 2,45 = 0,08, og for `w-bad-nord` 2,22 − 1,47 = 0,75.
- Høyskapet (svart, 0,35 bredt, x 0,95–1,30) er et møbel med `archetype: "wall-cabinet"`. Det ligger i
  `11-hoved-innredning.json`.

### 1.6 Eksempel: nivå, hull og trapp

Fila er `research/house/20-trapp.json`.

```json
{
  "levels": [
    { "id": "kjeller", "name": "Kjeller", "floorY": -2.55, "slabThickness": 0.30, "ceilingDefault": 2.25,
      "plan": { "file": "bilder_hus/plantegning_kjeller.png", "pxPerM": [60.3, 56.8], "originPx": [127, 120] },
      "estimated": ["floorY","ceilingDefault","plan.pxPerM"],
      "source": "14 × 0,182 (gang-1etg.md, entre-gang-kjeller.md); tak 2,22–2,30; z strukket 6,1 % (D3)" }
  ],
  "floorOpenings": [{
    "id": "trappehull", "levelId": "hoved", "roomId": "gang", "stairId": "trapp-kjeller",
    "polygon": [[0,2.32],[1.50,2.32],[1.50,3.48],[1.85,3.48],[1.85,4.43],[0,4.43]],
    "edgeBand": { "color": "#f2efe8", "depth": 0.30 },
    "estimated": ["polygon"], "source": "gang-1etg.md (rekkverk A/B/C, øverste nese 1,47); eier 1,54"
  }],
  "stairs": [{
    "id": "trapp-kjeller", "name": "Trappa", "type": "half-turn-winder",
    "fromLevel": "kjeller", "toLevel": "hoved", "openingId": "trappehull", "roomIds": ["kjeller-gang","gang"],
    "risers": 14,
    "top":  { "edge": [[1.50,2.32],[1.50,3.10]], "down": [-1,0], "straightTreads": 1 },
    "foot": { "edge": [[1.60,3.48],[1.60,4.43]], "down": [1,0], "straightTreads": 3 },
    "well": { "polygon": [[1.20,3.10],[1.50,3.10],[1.50,3.48],[1.20,3.48]], "newel": [1.50,3.10] },
    "walkLine": "flight-centre", "going": null,
    "tread": { "thickness": 0.045, "nosing": 0.02, "material": "oak", "color": "#bfab9b" },
    "openRisers": true,
    "stringers": { "color": "#1d1e21", "thickness": 0.05, "depth": 0.28 },
    "ledge": { "x": [0, 0.17], "y": [-0.22, -0.02], "color": "sand" },
    "guards": [
      { "id": "rekk-a", "level": "hoved", "line": [[1.85,4.43],[1.85,3.48]] },
      { "id": "rekk-b", "level": "hoved", "line": [[1.85,3.48],[1.50,3.48]] },
      { "id": "rekk-c", "level": "hoved", "line": [[1.50,3.48],[1.50,3.10]] },
      { "id": "rekk-oye", "on": "well" }
    ],
    "guardStyle": { "height": 1.00, "stairHeight": 0.90, "post": 0.065, "baluster": 0.022, "spacing": 0.13,
                    "topRail": [0.07, 0.05], "color": "#1d1e21" },
    "handrails": [{ "side": "outer", "start": [1.40, 2.32], "walls": ["øst","nord","vest"], "height": 0.90,
                    "profile": [0.05, 0.04], "offset": 0.05, "color": "#1d1e21",
                    "led": { "walls": ["øst","nord"], "lumensPerM": 120, "lightColorK": 2900, "group": "gang" } }],
    "decor": [{ "type": "plant-small", "on": "ledge", "at": [0.10, 4.30], "optional": true }],
    "estimated": ["risers","top","foot","well","tread.color","guards","handrails[0].led"],
    "source": "gang-1etg.md, entre-gang-kjeller.md; 225331, 225333, 225335, 225337, 225339, 225342, 225349, 225639"
  }]
}
```

- **Inntrinnet (`going`) regnes ut:** lengden av ganglinja (midt i hvert løp, rundt kjernen) delt på 13. Det gir
  ≈ 0,20–0,23.
- **Trinnene:** de rette trinnene står vinkelrett på løpet. Svingtrinnene stråler ut fra kjernens midtlinje.
- **Rekkverket:**
  - A/B/C står på gangnivå, med topp 1,00.
  - `rekk-oye` følger den indre vangen fra nederste trinn, rundt svingen og langs det øvre løpet, med topp 0,90.
- **Håndløperen** begynner på x 1,40 på østveggen, går rundt hjørnene og ned langs vestveggen. Delen under y 0 monteres på
  kjellerens sjaktvegger.
- **Avsatsen** (`ledge`) er toppen av grunnmuren langs nordveggen i sjakta (225331, 225337). Den er pynt og har ingen
  kollisjon.
- **Fri høyde:** hele trappa ligger innenfor hullets fotavtrykk. Det nederste trinnet på x 1,60 ligger under hullkanten
  på x 1,85, så det er nok fri høyde overalt.

`validateHouse` regner ut og logger:

- opptrinn, som skal være mellom 0,15 og 0,22;
- 2·opptrinn + inntrinn, som skal være mellom 0,60 og 0,64;
- inntrinn på ganglinja, som skal være minst 0,22;
- fri høyde langs neselinja under alle dekkekanter, med varsel under 2,0 og spillgrense 1,95;
- at fotavtrykket ligger inne i hullet og i `kjeller-gang`;
- at ingen dør slår inn over trappa eller over feltet 0,9 m foran nederste trinn;
- at dørhøyder under trappeundersiden ikke er for store. Kollisjon gir et varsel, og builderen kutter dørhøyden. Det
  gjelder `bod-1`.

Er verdien merket `estimated`, blir brudd en advarsel. Er den målt, kaster validatoren en feil.

### 1.7 Normaliseren og validatoren

- **`src/data/scripts/house.mjs` (ny)** inneholder `mergeHouse` og `validateHouse`.
  - Normaliseren endres bare i `main()`, linje 521-525: `fixRoomSpec(mergeHouse(readJson(…), RESEARCH))`.
    Katalog-grenen eier resten av normaliseren og `fixes.mjs`.
  - Endringen med `Object.assign` i `fixes.mjs:104` droppes. `research/room-spec.json` har ingen `f-pynt`-oppføringer,
    så DECOR legges alltid til fra nytt. Diffen på 17 `notes` forsvinner av seg selv ved én regenerering.
- **`mergeHouse()`:**
  - Den leser bare filer som matcher `^\d\d-.+\.json$` i `research/house/`, i sortert rekkefølge. Fotoindeksen ligger
    derfor i `research/house-photos.json`, utenfor mappa.
  - `levelId` og `roomId` satt på filnivå stemples på oppføringer som mangler dem.
  - Arrayene erstattes eller utvides etter id. `kitchen.items` slås sammen etter id, og `outside` dypflettes.
  - `wallOpenings: [{ wallId, openings }]` lapper åpninger på eksisterende vegger uten å kopiere veggen.
  - Nye toppnøkler legges bakerst.
  - Filnavnene følger `NN-navn.json`:
    - 00: hus, ids og stua som rom;
    - 10–11: 1. etasje;
    - 20: trappa;
    - 30–31: kjelleren;
    - 35: ute;
    - 40–49: fototilpasning per rom.
- **`validateHouse()`** kaster ved feil, som `mapArchetype`. Den sjekker:
  - at id-ene er unike på tvers av alt, og at id-ene og skjemaet i `00-ids.json` overholdes;
  - at hver `roomId` og `levelId` finnes;
  - at hvert roms vegger lukker polygonet med normalen innover;
  - at **ingen rompolygoner, med veggtykkelse, overlapper**. `trapp` (`kind:'hud'`) er unntatt;
  - at åpninger passer i veggen sin, at dører har `door:{…}`, og at `swing` stemmer med `opensInto`;
  - at det er **minst 0,75 m fri bredde** mellom ethvert åpent dørblad (med `openAngleDeg`) og rekkverk eller vegger;
  - at dørens frie åpning ligger på gulv, ikke over et hull;
  - at `backOf`-par er parallelle og ligger nøyaktig én tykkelse fra hverandre;
  - at hull ligger inne i rommet;
  - trappetallene fra §1.6;
  - kontrollarealene (over 10 % avvik gir advarsel, se tabellen i §1.4);
  - at møblenes `archetype` finnes i `src/data/archetypes.json`. I dag blir ukjente arketyper stille `'vase'`
    (existing.js:478-479).
  
  Med `--verbose` skriver den ut romtabell, arealer og **målelista**, det vil si alle `estimated`-felt sortert etter rom.
  Den teksten blir avsnittet «Målelista» i `research/room-spec-notes.md`, som genereres og ikke redigeres for hånd.

### 1.8 Utvidelser i `src/home/layout.js`

**Gamle felt gjelder bare stua.** Disse feltene tar bare med oppføringer uten `roomId` eller med `'stue-kjokken'`:

- `walls`, `wallsById`, `openings`, `windows`, `doors`
- `ceilings`, `bulkheads`, `builtInLights`, `fixtures`, `furniture`, `zones`, `photoCameras`
- `floor`, `floorArea`, `volume`, `bounds`, `highWall`, `isInside`
- `ceilingHeightAt(x, z)`

Grunnen er at alle forbrukere i dag leser de flate arrayene uten filter:

- volumet (layout.js:453);
- radiositet og vinduer (lighting.js:529, 556, 861, 1107);
- veggløkka, takene og dørene (shell.js:538-556, 632, 720-730, 855);
- sokkelen (shell.js:1021);
- sol og probe (lighting.js:507, 1772, 2239);
- ViewModes.js:877.

**Hele huset ligger under `layout.house`:**

- `levels`, `levelsById`, `levelAt(y)`
- `rooms`, `roomsById`, `room(id)`, `roomAt(x, y, z, { physical = true })`. `physical` hopper over `kind:'hud'`.
- `walls`, `windows`, `doors`, `openings`, `ceilings`, `builtInLights`, `fixtures`, `furniture`, `builtIns`
- `stairs`, `floorOpenings`, `lightGroups`
- `floorYAt(x, z, y)`, som tar med trappeflaten langs ganglinja
- `isInside(x, z, y)`: unionen av nivåets rom, pluss dørterskler og trappefotavtrykket, minus hull
- `ceilingHeightAt(x, z, y)`, som returnerer verdens-y. Inne i et hull gjelder taket i etasjen over.
- `bounds`, `levelBounds(id)`, `walkRects`
- `wall.prevId` og `wall.nextId` per romsløyfe, `opening.connects`

**`levelAt` og hysterese.** Nivået velges etter kroppssenteret (føttene + 0,9). Det byttes først når senteret er
0,15 m forbi grensa, som er dekkets underside (−0,30). Øverst i trappa (y −0,18 / −0,36) gir det fortsatt `hoved`, og
`ceilingHeightAt` blir aldri lavere enn hodet.

**Unntak som leser `house.*` fra starten (steg 4):** `DesignState` `windowIds` og `paintIds` (DesignState.js:335-347,
brukt i `_replaceAll` 865-875). Ellers ville lagret skjerming og maling på nye flater blitt droppet stille.

**Rettinger:**

- `lightGroupOf` faller ikke lenger stille tilbake til `'kjokken'` (layout.js:87-91), men varsler. Det er testet.
- Sonebokser går fra `floorY` til `floorY + 3.1` (layout.js:342).
- Fallbacken til nærmeste tak filtreres på nivå (layout.js:436-449).
- Kall til `ceilingHeightAt` med to argumenter gir stuas verdi som før. I dev logges ett varsel per kallsted når punktet
  ligger utenfor stua. Disse kallstedene flyttes til tre argumenter i steg 28 (E4), Acoustics.js i steg 16:
  - models/lamps.js:525 og models/shading.js:509;
  - Inspector.js:399, SceneSync.js:232, Placement.js:996 og 1686;
  - Acoustics.js:178 og ViewModes.js:878.

---

## 2. Geometri og bygg

### 2.1 Nye moduler

| Fil | Funksjoner | Innhold |
|---|---|---|
| `src/home/wallkit.js` (ny) | `wallMatrix(wall, floorY)`, `openingMatrix`, `wallLayer`, `floorGeometry(poly, y, holes)`, `ceilingGeometry`, `skirtingFor`, `ledStrip` | Ren geometri flyttet ut av shell.js (125-213, 419-445, 1012-1059, 1462). Oppførselen er uendret, og `floorGeometry` får `THREE.Shape.holes`. |
| `src/home/rooms.js` (ny) | `buildRooms(ctx, layout, M)` → `{ group, walls, windows, doors, pickables, builtInLights, colliders, dispose }` | Alle rom unntatt `stue-kjokken`:<br>• vegger med `(0, floorY, 0)`, sokkel, gulv per rom med hull og tak;<br>• lysarmaturer av typene `plafond` og `downlight`;<br>• fasadesegmenter;<br>• dekkeboks og himling (§2.8). |
| `src/home/doors.js` (ny) | `buildDoor(ctx, opening, layout)` | Generalisert fra shell.js:852-933:<br>• etiketter fra romnavnene i `connects`;<br>• `openAngleDeg` og `casing` per side;<br>• gulvstripe med kollisjon under hver dørterskel (§3.10);<br>• terskel etter gulvtype;<br>• `onChange` sender en strupet `requestShadowUpdate` (Door.js:246). |
| `src/home/stairs.js` (ny) | rent: `stairLayout(stair, levels)`, `stairColliders(lay)`, `slabColliders(layout, levelId)`. Med three: `buildStairs(ctx, layout)` | Den rene delen kan testes i Node og committes først.<br>• Trinn i eik, åpne opptrinn og svarte vanger.<br>• Spilerekkverk A/B/C, øyerekkverk og håndløper med LED (§4.11).<br>• Avsats og pynt. |
| `src/home/builtins.js` (ny) | `buildBuiltIns(ctx, layout)` | Fordeler etter `type` og legger inn statiske kollisjonsbokser (som kitchen.js:645-657). |
| `src/home/bathroom.js` (ny) | `buildWC`, `buildVanity`, `buildShower` (rett og femkantet, skyve- og svingdør, mørke paneler), `buildRoundLedMirror`, `buildTowelRadiator`, `buildFloorDrain` | Bruker MeshBatcher (buildKit.js:189-307), `mat('ceramic')`, `'black-metal'`, `'glass-clear'` og lathe/tube fra `models/kit.js`. Speilet får eget materiale med ruhet 0,1 og miljøkart på 128 på badene (§4.17). |
| `src/home/laundry.js` (ny) | `buildLaundryBench`, `buildCabinetRow`, `buildWasher`, `buildDryer` | Vaskerommet i kjelleren (§2.7). |
| `src/home/fittings.js` (ny) | `makeSink`, `makeTap`, `makeWorktop`, `baseRun` | Trukket ut av closure-ene i kitchen.js:449-531. Kjøkkenet importerer dem uten visuell endring, og det sjekkes med bildediff. |
| `src/home/visibility.js` (ny, stubb i steg 6) | `createVisibility(home, layout)` | Skjuler nivåer og rominnhold (§4.12). |
| `src/world/lightmask.js` (ny) | `installLightMask(renderer)`, `setRoomBoxes`, `setSlotMask(slot, bits)`, `setRoomFactor(roomBit, scale, tint)` | Shader-patch for lys per rom (§4.1). |
| `src/world/surfaces.js` | `tiles(…)`, `stonePanel({size:[0.6,1.2], joint, color})` | Lages etter mønster av `ceilingTiles` (297-325). Kartene er fargenøytrale og tones med `material.color`, ett sett per mønster. Fugene får u-forskyvning i UV-ene, ikke i `texture.offset`. |

Senger, nattbord, garderober, knaggrekker, stumtjener, speilskap og TV kommer fra katalog-arketypene (D14).
`src/models/bed.js` utgår.

### 2.2 Endringer i shell.js, kitchen.js og Door.js

- **shell.js** ser bare stua, fordi alle løkker leser gamle `layout`-felt (§1.8). Det gjelder vegger, vinduer
  (720-730), dører (855), sokkel (1021-1023), tak (632) og innebygde lys (1072).
- **shell.js:585-586 (`M.back`):** skiver med en `backOf`-partner får gruppe 0 som eget mesh med
  `{kind:'wall', wallId:<backOf-flatens id>}` og flatens maling (D13).
- **shell.js:852-933 (dører):** flyttes til `doors.js`. Linje 900 (`interactive:false`) og 897-898 («Gangen»/«Stua»)
  forsvinner. `door-gang` får `openAngleDeg: 180` og `casing.back: false`.
- **shell.js:1275-1330 (`buildHall`):** slettes. Stubben kolliderer med den ekte gangen.
- **shell.js:1338 (grenser):** `if (collision.setBoundsList) collision.setBoundsList(layout.house.walkRects); else collision.setBounds(…)`.
  Utkastets `?.() ?? …` kalte begge. Exterior.js:569 legger til i lista i stedet for å skrive over.
- **shell.js:519-521 (stuegulvet):** endres ikke. `castShadow` på et enkeltsidig gulv har ingen effekt, fordi
  skyggepasset tegner FrontSide som BackSide. Kjellertakene og dekkeboksen kaster skyggen (§2.8).
- **kitchen.js:** bare uttrekket til `fittings.js`.
- **Door.js:155:** `this.openAngle = THREE.MathUtils.degToRad(o.openAngleDeg ?? 90)`.
  - Ved 180° står kollideren fortsatt aksejustert (kommentaren i 102-104).
  - `_limitByBody` (580-605) bruker `openAngle` generelt.

### 2.3 Bad (1. etasje)

Kilder: `vaskerom.md` (Tillegg, 225413–225429), 225333 og 225327.

- **Overflater:**
  - Veggene har lyse beige-grå steinplater, `#c4bdb3`–`#c8c5bf`, med stående skjøter ca. hver 0,6 m. Platene går fra gulv til tak, også i dusjen.
  - Gulvet er mørk grå, skyet vinyl, `#5a5759`, uten gulvlist.
  - Taket er hvitt, med svart taklist `#1d1e21`.
- **Nordveggen:** dusj i NØ-hjørnet, vinduet og WC-kasse med topphylle og vegghengt WC vest for vinduet, mot NV-hjørnet.
- **Østveggen:** dusj, svart høyskap (0,35, to dører), svart vegghengt servantskap (0,8, 2 skuffer) med hvit integrert
  vask og svart kran. Over servanten henger et rundt LED-speil (Ø 0,7), og sør for speilet sitter en dobbel stikkontakt
  på 1,15.
- **Sørveggen:** blank, med én svart krok. Dørbladet ligger her når døra står åpen.
- **Vestveggen:** døra, svart bryter nord for døra (ca. 1,1) og dopapirholder (ca. 0,75).
- **Dusjen:** femkantet, 0,9 × 0,9, med svarte profiler og to svingdører. Svart termostat med takdusj og hånddusj på
  nordveggen, rundt stålsluk.
- **Lys:** plafond Ø 0,42, én downlight ved døra og en mørk ventil ved vindusveggen.
- **Fotsteg:** sonen `'tile'` via `Collision.addSurfaceZone`.

### 2.4 Gang (1. etasje)

Kilde: `gang-1etg.md`.

- Veggene er SAND. Taket er lyst `#ecebe8` (anslått), uten taklist.
- Gulvet er stuas `oak-plank`, med bordene øst–vest. Det deler materiale med stua (§4.18).
- Gulvlisten er som stuas `baseboard`.
- Rund plafond Ø 0,30 på (2,3; 2,40; 3,4), 3 500–4 000 K. Et lite takpunkt på (1,2; 2,40; 3,4) er valgfritt.
- Hullet, rekkverket A/B/C, håndløperen med LED og avsatsen med plante (valgfri).
- Tre svarte dører med ett innfelt felt og runde rosetter: `door-gang`, `door-bad` og `door-soverom`.
- Svart stikkontakt på vestveggen ved x 1,95, h 0,18.
- Ingen møbler.

### 2.5 Soverom (1. etasje)

Kilde: `soverom-1etg.md`.

- **Vegger og tak:** mørk blågrå `#50575c` (anslått, fargekoden er ukjent). Rommet er helmalt, også taket.
- **Gulv:** stuas eik. Gulvlisten er lys.
- **Garderobe:** `wardrobe`, 1,88 × 0,60 × 2,40, på x 0–1,88 · z 4,53–5,13. Fronten vender mot vest.
  - Matt antrasitt `#555350`.
  - Fire fronter, den tredje smal med speilfelt.
  - Tre stanggrep.
  - LED-list øverst (varmhvit, gruppe `soverom`).
- **Seng:** `bed` kontinental 180 × 200 på x 0,65–2,45 · z 6,20–8,20, uten gavl, med hodeenden mot vest.
  - Madrassen har topp 0,62.
  - Bunnen er `#c8b9a6` og bena `#c4a583`.
  - Dyna er mørk grå `#4b4c4f` med hvite blader.
- **Nattbord:** `bedside-table`, svart kube 0,35 på (2,78; 8,02). Bildet viser bare ett, selv om planen har to.
- **Knaggrekke:** `coat-rack` med 5 knagger på sørveggen, z 5,53–6,03, h 1,70.
- **Dørstopper** på sørveggen ved z 5,38.
- **Hodeveggen:** to runde uttak og en lav stikkontakt.
- **Bryter:** sort, på østveggen ved x 2,04, h 1,07.
- **Lys:** plafond Ø 0,40 på (1,50; 2,40; 6,40), 4 000 K.
- **Vinduet** får mørkleggingsrullegardinen gjennom `shading`.

### 2.6 Trappa

Kilder: §1.6, D4 og D5.

- `stairLayout` lager trinnpolygoner, neselinje, ganglinje, vangekurver, rekkverkslinjer og kileflaten for kollisjon.
  Alt er rent og deterministisk.
- **Bod-1-døra** (x 0,84–1,63) står under det øverste løpet. Høyden blir `min(2,10, trappeunderside − 0,05)`, og validatoren
  flagger det. Den sitter i en grunn nisje (225639).
- **Lagerplassen under svingen** (x 0–0,85 · z 2,32–3,1) er åpen og tom.
- **Kanten rundt hullet** er hvit, `#f2efe8`, og går fra 0 til −0,30. Langs øverste trinnkant ligger en lys neselist.

### 2.7 Kjelleren

Kilder: `entre-gang-kjeller.md`, `vaskerom.md`, `kjellerstue.md`, `soverom-kjeller.md` og `ytterdor-ute.md`.

- **Felles:**
  - Veggene er SAND (bortsett fra vaskerommet), og taket er brukket hvitt `#e8e4dc` (anslått).
  - Gulvet er lys hvitpigmentert eik i hele kjelleren, med én felles verdi `#cbbfb0`. Bordene går nord–sør i gang og entré og øst–vest i kjellerstua og soverommet.
  - Gulvlisten er beige `#cbbba7`, ikke hvit.
  - Kjellerstua, soverommet og vaskerommet har svart taklist. Gang og entré har ingen.
  - Innerdørene er som oppe, men med svart vrider på rund rosett og nøkkelskilt.
- **Gang:**
  - Østveggen får nisjen ved bod-1 (z 2,32 for x < 1,75, z 2,56 for x ≥ 1,75).
  - Langs østveggen er det 3 downlights ved x 2,0 / 3,2 / 4,4 (z 2,91). I sørdelen sitter 2 på x 3,8 / 4,9 (z 5,01).
  - Sorte stikkontakter.
  - Kunstig oliventre i SV-hjørnet (valgfritt).
- **Entré:**
  - Gulvet ligger 0,30 lavere. Åpningen mot gangen er z 3,50–4,43 i veggen på 0,41, uten dør og karm. Den har 2 trinn med svart trinnkantprofil, og mellomtrinnet fyller lysningen.
  - Ytterdørelementet er 1,85 bredt, sentrert på z 4,38: østre sidefelt, et glatt antrasitt blad `#2b2c2e` på 0,92 og vestre sidefelt.
  - Døra slår ut og har hengsler i øst. Den har kodelås, aluterskel og bred sort foring.
  - Garderoben er `wardrobe-sliding`, x 6,57–8,51 · z 5,58–6,03, med to speilskyvedører og svarte skinner.
  - Stumtjener (`coat-stand`) i SØ-hjørnet og oval jutematte. Vase med pampas er valgfri.
  - 4 downlights.
- **Vaskerom:**
  - Veggene er malt dempet salviegrå `#b8bfb5`, taket er hvitt og taklisten svart.
  - Gulvet er grått vinylbelegg `#8c8789` med oppbrett.
  - Dusj i NØ-hjørnet (x 0–1,08, de første 1,17 m av z), med mørke paneler `#5a5657` på nord- og østveggen. Fronten har skyvedør og fast felt.
  - WC-kasse på nordveggen.
  - Benk på vestveggen med svart komposittkum og speilskap med LED-skinne.
  - Skaprad på sørveggen i greige `#b0a89f`: skittentøyskap, høyt skap (VB), vaskemaskin med tørketrommel stablet oppå og overskap.
  - Håndkletørker på østveggen.
  - 8 downlights.
  - Ventilen er svart.
- **Kjellerstue:**
  - Sørvinduene har dyp, sort lysning og plissé `#a39588` nede.
  - TV 1,70 × 0,98 på vestveggen, sentrert på x 1,92 (lokalt), h 1,07–2,07.
  - Ca. 10 downlights.
  - Møbler: bare det katalogen kan vise (TV og to stoler). Pult, tredemølle og spinningsykkel er et spørsmål til eieren (§8.7).
- **Soverom (kjeller):**
  - Vestvinduet har dyp, sort nisje.
  - Bokhylle i NV-hjørnet og to bouclé-stoler (samme modell som spisestolene).
  - 5 downlights og en termostat.
  - Ingen seng, slik bildene viser (spørsmål til eieren).
- **Bodene:** lukkede dører, tomme rom og én pære hver (av).

### 2.8 Dekket og skallet

Dette lukker glippene mellom −0,30 og 0.

- **Massiv dekkeboks** (`addStaticBox`, y −0,30–0) under alle rom i 1. etasje, minus hullet. Den hindrer at hodet går
  gjennom gulvet nedenfra (Collision.js:211). Den er også tak i kjelleren (2,25 + 0,30 = 2,55), så det trengs ingen egne
  takbokser.
- **Kjellertakene** (y −0,30) kaster skygge. Hullkanten er en hvit kantflate på 0,30.
- **Under terrassen** (entré og bod-3):
  - Taket står på −0,45.
  - Veggene går opp til dekkets underside på −0,23. Det lukker spalten på 7 cm.
  - Nisjen ute har mørk himling `#35312e` på −0,35.
- **Utkragingen** (D9): himling under stua fra x 6,62 til 7,22 på y −0,30. Kledningen i 1. etasje slutter der som i dag
  (shell.js:601).
- **Kjellerens yttervegger** har to lag i `wallLayer`. Ytterlaget er lys puss `#a9a7a1`–`#d9d6cf` opp til −0,30. Unntaket
  er dørveggen og østre sidevegg i nisjen ved inngangen, som får kledning `#4a4642`.
- **Grunnmursboksene** (exterior.js:330-342) fjernes etter rommenes fotavtrykk:
  - boksen under kjøkkenets sørvegg (x 6,37–6,62), som ellers står inne i entré og bod-3;
  - boksen under `w-sor`, som erstattes av himling og kjellerens sørvegg;
  - boksen under `w-vest-stue`, som erstattes av kjellerens vestvegg.

### 2.9 Eksteriør og inngang (steg 25, C3)

Kilde: `ytterdor-ute.md`, med D8–D10.

- **Forplassen** ligger på −2,87, x 8,74–12,6 · z 3,15–6,75:
  - grusstripe `#b4afa6` langs veggen;
  - skiferhelle `#5f656b` med dørmatte;
  - betongheller `#a7a49e` med grusfuger.
  
  Benk, krans og potte med bartre er valgfrie. Det samme gjelder ringeklokka og 3 downlights i himlingen (x ≈ 9,3,
  z ≈ 3,9 / 4,7 / 5,5).
- **TERRACE_FIT** (exterior.js:40-65):
  - `nearGroundY` og y for repos, sti og «walk» blir `outsideHouse.entranceLevelY`.
  - Trappa får 15–16 opptrinn (0,17–0,19), fra x 7,62 til ca. 11,4.
  - Hjørnepilaren og terrassens vestside går ned til −2,87, og pilaren får grå spritputs `#a9a7a1`.
  - Der trappa går forbi pilaren, får den lukket vange eller rekkverk på østsiden.
- **Søyler under terrassekanten:** de på z 0,25 og z ≈ 3,4 fjernes. Søylen på z ≈ 6,55 dobler hjørnepilaren og fjernes også.
- **Annekset** (x 6,8–10, z −3…0) får en pusset støttemur eller skrånende bank ned til forplassen. Ellers svever det.
- **Plenen** er en projisert matte (GROUND_FRAG). Fra midten av stua ser den lik ut uansett geometri. Derfor er det
  trygt å senke den nær huset.
- **Gangbart ute:**
  - statisk kollisjon for forplass, repos, sti, trapp og terrasse (som i dag);
  - en åpen terrassetrapp i stedet for den lukkede boksen (exterior.js:455-462);
  - usynlige grenser i `outsideHouse.walkRects`, for eksempel x 6,62–14 · z −0,2…9.
- **Bakteppe:** `win-vask` (nord) legges i bakteppet «nord». `soverom-kjeller` sitt vestvindu får himmel og terreng som
  reserve. `rect0`/`rect1` blir et array på seks (743-754).
- **Taket** bruker fortsatt hovedetasjens `bounds`.

---

## 3. Bevegelse

1. **Rampe, ikke trinn.** I dag stopper spilleren ved trinn over ca. 0,12 m. `_tryStepUp` prøver ett delsteg på ca. 1 cm,
   mens kapselen trenger 0,27 (PlayerController.js:51, 771-794). Derfor:
   - En **usynlig, lukket kile** følger neselinja fra hullkanten til kjellergulvet. Den har loddrett bakflate og underside.
     - Kilen **slutter på gulvet ved nederste opptrinn**: siste segment senkes ett opptrinn, så det ikke blir noen usynlig
       kul foran trappa.
     - Den lages som prisme langs **z**. `buildKit.prismX` (buildKit.js:618-625) ekstruderer langs x, så den roteres 90°
       eller får en egen `prismZ`.
   - **Svingtrinnene** blir en triangulert skrueflate der høyden er en funksjon av vinkelen langs ganglinja.
   - Synlige trinn, vanger og spiler får `collide:false`, samme mønster som kitchen.js:289. Kilen ligger i `stairColliders()`.
2. **Trinnvis snap ned (steg 5, M1).**
   - `_snapDown` (PlayerController.js:797) flytter i **tolv deler (2,17 cm)** og stopper ved første gangbare kontakt,
     med de samme sjekkene. *(Integrator W0: ikke fire som i utkastet. Med fire eller åtte deler ga en 48°-kile fortsatt
     et dytt på 144 Hz; grensen flytter seg ca. 1° per to ekstra deler, og 12 gir 49°, én grad over rådet til steg 19.
     Se commit b074972.)*
   - Snapen når i praksis ca. 0,33 m ned fra en firkantet kant (snapDistance 0,26 + kapselbunnen), ikke 0,26. En kant på
     0,27–0,32 m tas derfor i ett bilde i stedet for et fall. Det er godtatt i natt, fordi grepet som stopper det
     (`_levelY`, `.shots/hus/m1-rev2/PC.fixC.js` i arbeidstreet hus-m1) gjør ekte trinn til korte fall. Velges det
     senere, må det komme sammen med kilene i steg 24 og 25.
   - I hodeløs test fjernet dette lufthoppene på rampetoppen. Der hoppet spilleren ellers 0,25 m i gange og fløy 1,7 m i løp.
   - `snapDistance` heves ikke før dette er på plass.
   - Steget må også gåes i nettleseren på terrassetrappa og over terskler (§7.4).
3. **Hode og dekke.**
   - Dekkeboksen (§2.8) og kollisjonen på rekkverk og vangesider i 0,9–1,0 m høyde gjør at ingen faller ned i hullet.
   - Den frie høyden kapselen trenger, er 1,2 + 0,6/cos θ. Med inntrinn på 0,20–0,23 blir θ 38–42° og høyden 1,96–2,01.
     - Hele trappa ligger under hullet, så kravet er oppfylt.
     - Viser målingene noe annet, løftes dekkekant-kollideren noen centimeter. Under 1,8 m vises «Dukk deg» (crouch er 1,3 m).
   - **Kjelleren er 2,25 under tak**, mens hoppets toppunkt er føttene + 2,338. Dekkeboksen stopper hodet. Under trappa,
     ved bod-1, trengs en egen takkolliderer.
4. **Nivåer i kollisjonen (steg 20, M2).**
   - `Collision.setBounds` (109) får følge av `setBoundsList([{minX,maxX,minZ,maxZ,minY,maxY}])`, og `isWalkable(x, z, y)`
     tester mot unionen.
   - `groundHeight(x, z)` faller tilbake til `layout.house.floorYAt(x, z, y)`.
   - `_keepWalkable` og `_isSafeSpot` sender med kapselens y.
5. **Respawn.** `respawnY −30` og `_isSafeSpot y > −29` virker for −2,87. Det siste trygge punktet lagres på alle nivåer.
   Reservespawn blir forplassen (U2), og spisestua brukes når `outsideHouse` mangler.
6. **Start ute og lagret posisjon (steg 26, U2).**
   - Første lasting starter med føttene på (12,0; −2,87; 4,6), yaw ≈ 85 og pitch −6, ca. 3,3 m fra dørbladet. Det er
     nesten samme bilde som 225543.
   - Posisjonen lagres per seer i `localStorage` (`interiorspillet.player.v1`, i try/catch), og neste lasting starter der.
   - Uten lagring (privat vindu) starter man ute hver gang.
   - `?pos=` overstyrer som før.
   - Spawnen holdes klar av dørslaget (x 8,74–9,66 · z 3,88–4,80), bod-3 og trappa.
7. **Andre steder som antar y = 0:**
   - `Game._freeFloor` (Game.js:291-322) kaster fra `pos.y + 1.7` og godtar treff innen ±0,3 m av `pos.y` (steg 20).
   - `SceneSync._collide` (622) klemmer til nivåets `floorY` (steg 14 og 28).
   - `_rugZone` (643) legges rundt teppets egen y.
   - `WindowPanel._viewpoint` (660, 670) bruker vinduets `floorY`.
   - `WallPanel` teleporterer i stedet for å tweene gjennom dekket.
8. **Fotsteg:** `'wood'` over trappa og i kjelleren, `'tile'` på badene og `'gravel'`/`'tile'` ute.
9. **Dørene:**
   - `door-gang` åpnes 180° og legger seg langs veggen (D6).
   - `door-bad` og `door-soverom` slår inn i rommene sine.
   - Ingen dør slår inn over trappa.
   - Ytterdøra slår ut mot forplassen.
10. **Gulv under dørhull.** Dørhull har ikke gulv i dag, og terskelboksen har `collide:false` (shell.js:917). I tykke vegger
    synker kapselen 4–8 cm, for eksempel i ytterdøra (0,23–0,30) og i åpningen gang ↔ entré (0,41). `doors.js` legger en
    gulvstripe med kollisjon i hvert dørhull.
11. **Entrétrinnene** er to trinn à 0,15. *(Integrator W0, rettet etter M1:)* snap og trinn klarer **ikke** 0,15. Å gå
    opp et ekte trinn på 0,15 eller mer feiler både før og etter M1, og ned gir et dytt fremover ved hver nese (opptil
    2,9× på 144 Hz mellom veggene 0,9 m fra hverandre; enkeltfall på 0,20–0,26 gir opptil 5,3×). Derfor: **en usynlig
    kile over trinnene, og synlige trinn med `collide:false`** (steg 24). Det samme gjelder **alle ekte høydetrinn på
    0,15–0,26 i huset**, også terrassetrappa (steg 25). Testen er en gangtur gjennom åpningen begge veier.

---

## 4. Lys og ytelse

**Én `LightManager` med faste lyspuljer.** Profilen «middels» har 2 punktlys, 12 spotter (4 med skygge, 512²) og
4 rektangellys. Puljestørrelsen endres aldri. Det nye er at lyset holdes inne i rommet sitt, og at det finnes lystilstand
per rom.

1. **Lysmasker per rom (steg 13, L1, `lightmask.js`).** I dag går lys gjennom vegger og dekker:
   - RectAreaLight har verken `distance` eller skygge (lighting.js:1095-1101, vinklet ved 1119). Sørvinduene lyser derfor
     opp soverommets gulv gjennom `w-hoy`.
   - Spotter og punktlys har `distance = 0`. Ringene og pendlene på kjøkkenet lyser opp kjellergangen gjennom dekket.
   
   Utkastets `distance`-grense er forkastet. Den beskytter ikke et rom 1–3 m unna, og med falloff `(1-(d/c)^4)^2` demper den
   stuelysene (−27 % ved 8 m). Løsningen er dette:
   - **Romtabell:** inntil 24 bokser i verdensrom, hver med et rom-bit. Stua trenger 4 bokser (L-form med nisje), og
     trapperommet får sin egen søyle.
   - **Per lysplass:** en bitmaske over rommene plassen får lyse i. Den dekker eget rom, rom bak portaler som er mer enn
     halvåpne (`Door.t` > 0,5) og trappesjakta for `gang` og `kjeller-gang`.
   - **I fragmentet:**
     - verdensposisjonen regnes ut som `geometryPosition * mat3(viewMatrix) + cameraPosition`, så det trengs ingen ny
       varying;
     - rom-biten slås opp, og bidraget fra lyset ganges med `(mask & bit) != 0` med 5 cm myk kant;
     - utenfor husets fotavtrykk lyser stueplassene som i dag, så terrassen er uendret.
   - **Uniformene** legges inn i `ShaderLib.standard/physical` før første kompilering: én delt `Float32Array` og omtrent
     55 vektorer. `UniformsUtils.clone` deler typed arrays, så den samme matrisen tjener alle materialer.
   - Stuelysene får stuas bokser, så stua blir piksel-lik. Det dokumenteres med LightManager-dump og bildediff.
2. **Stua uendret i bølge 1.** Dette følger av §1.8. `buildRoomModel`, `_buildWindows` og lampene ser bare stua til L1 tar
   inn `house.*`.
3. **Indirekte lys per rom.**
   - `scene.environment`, `environmentIntensity` og `AmbientLight` gjelder hele scenen (2261, 2156, 1055). Et mørkt
     soverom sett fra stua ville fått stuas dagslys.
   - I samme patch får hvert rom en faktor for skala og fargetone. Faktoren er rommets radians delt på radiansen i
     kameraets rom, og den virker på env og ambient.
   - Miljøet bygges for alle rom kameraet kan nå, ikke bare kameraets eget. Det bygges på nytt når hvitbalansen glir.
   - Oversiktene bruker en samlet verdi per nivå.
4. **Radiositet per rom.**
   - `buildRoomModel(layout, room)` (lighting.js:480) får `floorY` og rompolygonet. I dag antar 511-523, 566-587, 689-695 og
     1764-1772 at y = 0 og at rommet er stuas omriss.
   - Proben står over fast gulv, ikke i hullet. For gangen er det (2,6; 1,45; 3,4).
   - Lkey, S, hvitbalanse, `dayFloorLux` og `autoOn` holdes per rom og glir over ca. 1,5 s ved romskifte, med hysterese i
     døråpninger. I trappa blandes gang og kjellergang etter kamerahøyden.
   - Glidetidene for skyvebryterne (0,25/0,4 s) beholdes, adskilt fra romskiftet.
   - **Portaler:** åpne dører og trappesjakta er portal-patcher med refleksjon ≈ 0. De sender ut naborommets midlere lys
     ganget med døråpningen `t`. Rekkefølgen er stue → gang → kjellergang (ett koblingspass). Uten dette blir gangen svart
     ved middagstid og for flat med lys på, fordi hullet er 58 % av gulvet.
   - `NIGHT_FLOOR_LUX * 100` (1619) og `A = totalArea ?? 200` (2116) skaleres med `model.totalArea`.
   - **Stua beregnes nøyaktig som i dag.**
5. **Mørke rom forblir mørke.** Utkastets eksponeringsgulv på 2 nits er forkastet, fordi stua om natta ligger på ca. 0,5 nits.
   - Stua beholder `max(0.02, …)` (1577).
   - Andre rom får `Lkey_eff = max(Lkey, min(2, største Lkey i rom kameraet kan nå))`.
   - `LAMP_BOUNCE` (134) settes per rom: ≈ 1,0 for små lukkede rom og 0,45 for stua.
   - **Auto:** rom uten vinduer (`gang`, `kjeller-gang`) har lys på i auto. Entré og ute er på om kvelden. Bodene er av.
6. **Sol og skygge (steg 27, L2).**
   - `_shadowBox` (1059-1060, tilpasset i 1898-1931) tilpasses **kameraets nivå**. Boksen for `hoved` er nøyaktig som i dag,
     og kjellerens dekker y −2,9…0. Den tilpasses og rendres på nytt ved nivåskifte. Det samme gjelder GTAO-boksen (2288).
   - `sun.shadow.autoUpdate = false`, og bare `sun.shadow.needsUpdate` flagges. I dag rendrer bytte av ledig skyggeplass
     (2027, 2059 → 950-953) og persiennanimasjonen (shading.js:1012-1014) hele solkartet.
   - Skyggene kastes av kjellertakene og dekkeboksen, ikke av gulvene (§2.2).
   - Lyset fra solflekken (1806-1810) blir stående der det er. Maskene holder det ute av kjellertaket.
7. **Vinduer.** `OBSTRUCTION` og `GROUND_TINT` (76, 81) leses per vindu fra data, med dagens konstanter som standard.
   - Frostet glass på badet sender diffust lys uten 45° vinkling, med T ≈ 0,5, og glasset gløder med `w.L·S`.
   - Kjellervinduene får `skyView` på leddet 0,42 (1487).
8. **Data som må stemme.** Felt som ikke stemmer, ignoreres stille:
   - Bruk `lightColorK` og `dims`.
   - `plafond` og `downlight` legges inn både i `rooms.js` og i lighting.js:1199-1217. Ellers blir de punktlys som stjeler
     punktplassene.
   - Downlights grupperes, så hvert rom har høyst 2 spotkandidater. Resten bidrar bare med gjenkast.
   - Nye grupper har `defaultDimmer` (tabellen under). 1 400 lm på 100 % ved siden av stuas 7–35 % ville lyse ut gjennom
     hver dør.
9. **Skyggeplassene** går bare til spotter med kjegle ≤ 50° eller `wantsShadow`, ikke til takarmaturer med 82° kjegle
   (2035-2064, 1085-1090).
10. **LightPanel og grupper** (steg 13). Panelet grupperes etter rom, med gjeldende rom øverst. «Alle på/av» gjelder hele
    huset som i dag, og hvert rom får sin egen bryter. Teksten «Vinduene står mot sør» vises bare for sørrom.

    | Gruppe | Innhold | Standard dimmer |
    |---|---|---|
    | `gang` | «Gang og trapp»: plafond og LED-håndløper | 0,5 |
    | `bad` | plafond, downlight og speilring | 0,6 |
    | `soverom` | plafond og garderobe-LED | 0,5 |
    | `kjeller-gang` | 5 downlights | 0,5 |
    | `entre` | 4 downlights | 0,5 |
    | `vaskerom` | 8 downlights og LED i speilskapet | 0,6 |
    | `kjellerstue` | ca. 10 downlights | 0,4 |
    | `soverom-kjeller` | 5 downlights | 0,4 |
    | `boder` | én pære per bod | av |
    | `ute` | 3 downlights i himlingen | 0,6, på om kvelden |

11. **LED i håndløperen.** `ledStrip` er en flat taklist (shell.js:1462-1476), så den kan ikke følge en skrå eller svingende
    løper.
    - Lista bygges som en egen selvlysende stripe langs løperen, med gjenkast inn i gangens modell.
    - Den får høyst ett rektangellys per rett løp, med signatur 1. Med `STRIP_SIGNATURE` 8 (136, 2008) ville den tatt stuas
      LED-plasser om natta.
12. **Synlighet (steg 29, Y1, `visibility.js`).**
    - Frustumet stopper ikke ved gulvet. Ugjennomsiktige objekter sorteres etter materiale før dybde
      (WebGLRenderLists.js:1-21), så skjulte kjellerpiksler får hele shaderen.
    - Derfor skjules **hele det andre nivået, også vegger**, unntatt når kameraet er i `gang`, `trapp` eller
      `kjeller-gang`, eller i oversikt.
    - Innholdet i rom som ikke kan nås gjennom åpne portaler (bredde-først, dybde 2), skjules også.
    - Skjulingen starter først etter `Game._precompile`. `compile` hopper over usynlige objekter (WebGLRenderer.js:1408,
      1426), og ett program koster sekunder på ANGLE.
    - `requestShadowUpdate` kalles ved hver endring i synlighet.
13. **Ytelsesbudsjett.**
    - Mål med `autoResolution` av. Dynamisk oppløsning (Game.js:259-279, 559-592) skjuler ellers kostnaden.
    - Logg mot master: `renderer.info.render.calls` og triangler, ms per bilde, `_dyn.scale`, `stats.envBuilds` og
      solpass.
    - **Grenser:**
      - høyst +20 % tegnekall ved spawn i stua og i gangen (`pos=2.6,0,3.2&yaw=90`);
      - høyst 1 miljøbygg per romskifte;
      - 0 solpass mens man går;
      - første lasting høyst 3 s lenger enn i dag.
    - «50 fps i hodeløs Edge» brukes ikke som krav, fordi det ikke er pålitelig.
14. **Miljøbygg.** Én env-scene per rom (egne patcher og portaler), slått sammen til ett mesh med vertex-farger, og én
    PMREM cachet per rom. Alle kart har samme størrelse, fordi kubehøyden er del av shader-nøkkelen (WebGLPrograms.js:64).
    Det blir ca. 9 MB på «middels».
15. **Speil** på badene får ruhet ≈ 0,1 og env 128 (`mirror` har 0,02 og 64 i materials.js:124). Det brukes ingen
    Reflector.
16. **Teksturer.**
    - Gang og soverom deler stuas eikemateriale. `floorMaterial` (shell.js:264-356) er ikke cachet og baker inn fargen.
    - Fliser og steinplater bruker fargenøytrale kart og samme kartsett (map, normalMap, roughnessMap), og ingen clearcoat
      eller transmission. Dermed blir det ingen nye programmer.
17. **Dørskygger.** `Door.onChange` sender en strupet `requestShadowUpdate` (doors.js, steg 8).

---

## 5. Editor og UI

1. **Rom og banner** (steg 9, A3):
   - `home.rooms` bygges fra `layout.house.rooms` (`id`, `name`, `levelId`, `levelName`, `contains(x,y,z)`) og erstatter
     `OPEN_ROOM` (index.js:16, 131). Stua heter fortsatt «Stue/kjøkken».
   - `Game._updateRoom` (484-502) bruker HUD-varianten av `roomAt`, der `trapp` testes først. Testen bruker kroppssenteret
     (føttene + 0,9) og venter ca. 0,4 s før skifte.
   - Lys og akustikk bruker `physical:true` og ser aldri `trapp`.
   - Kallet blir `hud.showRoom(name, { eyebrow: level.name })` (Hud.js:176), med eyebrow «1. etasje», «Kjeller» eller
     «Ute».
   - `'room'`-eventen sender `{ id, name, levelId }`.
   - `?pos=x,y,z` med y ≠ 0 virker etter steg 20, og `__setView` tar nivået.
2. **Oversikt og plan:**
   - **Flere rom på ett nivå (steg 15, E2):**
     - `_shellSig`/`_prepareCut` (ViewModes.js:853-879) går også gjennom `roots.rooms` (kontrakten fra steg 6).
     - `inPoly` bruker rompolygonene, `slabOf` får y-område (892) og `ceilAt` nivå (877-878).
     - `backOf`-flater kobles til eierveggen i alle kuttvalg (`slabOf` 892-900, veggkapper 1245-1260).
     - Kappene regnes fra endepunktnaboer, ikke fra rekkefølgen i arrayet (1253).
     - Planen viser én etikett per rom med navn og areal (1382), og dørsving tegnes én gang per `connects`.
     - Dukkehusregelen er **uendret** i dag: ingen ny «innervegger hele»-regel uten referansebilder. Referansene for orbit og
       plan fra steg 2 må holde.
   - **Per etasje (steg 28, E4):**
     - `views.level` og `setLevel(id)`, med PageUp/PageDown og knappen «Etasje» i Toolbar, som vises utenfor gangmodus.
     - `view=plan&floor=kjeller` (Editor.js:120).
     - Ortokameraet står på `ceilingTop + 1` og ser mot `floorY` (75, 380, 621).
     - `_fitOrbit`, `_clampOrbit`, `_focus` og `_bounds` regnes per nivå (102, 325, 565).
     - Nivåer over, tak og øvre deler av eksteriøret skjules.
     - Fra gangmodus åpnes visningen på spillerens etasje.
3. **Plassering** (steg 14, E1 for ett nivå, og steg 28, E4 for flere):
   - `buildRoom(editor, levelId)` (Placement.js:84-119) får som hindringer: nivåets flater, rompolygoner med hull,
     `builtIns`, trappefotavtrykket og dører på `floorY..floorY+2`.
   - `footprintInside` (268) tester mot ett rom.
   - Gulv 0 byttes med `level.floorY` i `_solveFloor`, `_dropY`, `_dragPlaneY`, teppenes `baseY` og `_supportAt` (807,
     996-998, 1385, 1465, 1717).
   - Veggens v og åpninger måles i vegglokal høyde (1080).
   - `_wallFor` og `_tableUnder` filtreres på nivå, og nye møbler stemples med `level`.
   - `Selection.underlayY(…, level)` (775) og sjekken av `visibleChain` i `_dropHit`.
4. **Akustikk per rom** (steg 16, E3):
   - `computeAcoustics(design, home, { roomId = 'stue-kjokken' })` bruker `V = room.volume`.
   - Møblene fordeles med `roomAt` (physical), og veggmøbler via `attach.wallId`.
   - Skjerming regnes bare for rommets egne vinduer. Den høye veggen hører bare til stua.
   - Stua beholder 0,86-kalibreringen, med bare sine egne originalmøbler.
   - Andre rom får en grunnverdi fra flater × standard α (gips 0,05, tregulv 0,07, flis/vinyl 0,03, glass 0,04), merket
     «anslått».
   - `Editor.acoustics(roomId)` får en Map-cache, og widgeten viser kameraets rom eller rommet til det valgte møbelet.
5. **Lagringen** (steg 16, E3):
   - `DESIGN_VERSION = 2` (DesignState.js:27) og `level` i `ITEM_FIELDS` (37). Testen `json.version === 1`
     (tools/test-design.mjs:310) oppdateres i samme steg.
   - **Y lagres nivålokalt** sammen med `level`, og konverteres i `normaliseItem` (185). Da overlever lagrede møbler at
     `floorY` blir målt. `LIMITS.y` (56, 185) blir nivålokal [−0,5; 4].
   - **`meta.originalRooms: [romId…]`** i hver lagring. Ved lasting legges originalene til fra rom som ikke står i lista.
     uid er fortsatt `'ex-<spec-id>'` (existing.js), uten romprefiks.
     - Utkastets versjonsbaserte migrering er forkastet. Den ville mistet kjellermøblene hvis brukeren lagret v2 etter
       milepæl A.
     - Stuemøbler brukeren har fjernet, kommer ikke tilbake.
   - **Datarevisjon:** `meta.specRevision` per original. Originaler brukeren ikke har flyttet, får nye fotoposisjoner fra
     P-stegene (`_replaceAll` 824-850 lapper i dag bare lumen og pampas).
   - **Sikring:** før første v2-autolagring kopieres v1-blobben til `interiorspillet.designs.v1.backup` (Saves.js). Det
     finnes ekte v1-data på 5180 og på Railway-adressen.
   - Maling og skjerming beholdes (872), og nye flater som `w-gang-hall` får standardfarge.
6. **Paneler** (steg 17, U1):
   - **WindowPanel:** gruppert etter etasje og rom (424-455). `_viewpoint` og `_orbitTo` bruker vinduets `floorY` (660, 670,
     742). «Etterklang nå» gjelder vinduets rom.
   - **PhotoCompare:** `optgroup` per rom (190). Testes på en fixture, fordi husets kameraer kommer i steg 31.
   - **Toolbar:** «Før/etter» og bildenavnet endres fra «stua» til «huset». PauseMenu.js:104 «Tilbake til stua» blir
     «Tilbake til huset».
   - **`tools/prep-images.py`:** leser den flettede `src/data/room-spec.json`, ikke `research/room-spec.json` (190-195), og
     godtar `bilder_hus/` (205).
     - Utdata går til en gitignorert mappe som bare serveres i dev (`public/img/foto-hus/`, lagt til i `.gitignore`).
     - Grunnen er at `public/img/foto/` ligger i git og blir deployet. Om soverom- og badebilder skal publiseres, avgjør eieren
       (§8.7).

---

## 6. Byggerekkefølge og fil-eierskap

**Regler:**
- Hver fil har én eier per bølge. Trenger et steg endring i en fil det ikke eier, skrives det som en forespørsel i
  sluttrapporten, ikke som en redigering.
- Data går bare i egne `research/house/NN-*.json`-filer.
- Hvert steg kjører i sitt eget arbeidstre og testes på sin egen port (§0, §7.1). Integratoren fletter i nummerrekkefølge
  på slutten av hver bølge, regenererer `room-spec.json`, kjører alle tester og committer.
- «Bilder» sier om steget trenger `bilder_hus/`. «Via notat» betyr at fotonotatet i `notes/hus-foto/` er nok, og at
  originalbildet bare åpnes ved tvil.

### Bølge 0: grunnmur
Steg 1 kjøres først, deretter 2–5 parallelt og 6 til slutt.

1. **S0-git: klargjøring.**
   - *Mål:* commite `notes/hus-foto/*.md` (de er usporet og må med i arbeidstrærne) og denne planen. Lage arbeidstrær og
     porttabell. Be katalog-agenten committe grenen `worktree-katalog-hele-huset` (den er låst og har ucommittede
     endringer).
   - *Filer:* bare git (integratoren).
   - *Avhenger av:* –
   - *Test:* `git worktree list` viser trærne, og `git status` er rent.
   - *Bilder:* nei.
2. **S0-test: testoppsett og referanser.**
   - *Mål:*
     - en server uten HMR;
     - dev-parametrene `?doors=open` og `?nohelp=1`, som ikke finnes i dag;
     - deterministiske skjermbilder;
     - referanser og dumper fra dagens kode;
     - en v1-fixture for lagring.
   - *Filer:*
     - `tools/vite.test.config.mjs` (ny, `server.hmr:false`);
     - `tools/test-house.mjs` (ny kjører: hver `tools/house-tests/*.test.mjs` er et frittstående skript som avslutter med
       kode ≠ 0 ved feil og laster JSON med `registerHooks` som test-design.mjs:16-31);
     - `tools/tour.mjs` (ny), `tools/imgdiff.mjs` (ny, uten nye pakker) og `tools/dump-state.mjs` (ny: LightManager-tall
       per kamera og akustikk til JSON);
     - `tools/shot.mjs` (`--hide=#info,#labels`, `--steps=N` med fast `home.update(1/60)`);
     - `tools/walkmap.mjs` (`--doors`, `--levels`, `--auto-y`);
     - `tools/house-tests/fixtures/design-v1.json` (gardin på `win-s1`, maling på `w-hoy`);
     - `.claude/launch.json` (oppføringen «hus-test»);
     - `src/main.js` (bare parsing av dev-parametre).
   - *Avhenger av:* 1.
   - *Test:*
     - referansebildene i `.shots/hus/ref/` er tatt to ganger hver, og `--max` = 2 × målt støy;
     - stuas 8 `photoCameras` via `dev/sandbox.html?photo=<id>&orbit=0`, spawn, `view=orbit` fra sør og nord og `view=plan`;
     - dumpen ligger i `.shots/hus/ref/state.json`;
     - `node tools/test-design.mjs` gir 98 bestått.
   - *Bilder:* nei.
3. **S0-data: normaliser og validator.**
   - *Mål:* `mergeHouse` og `validateHouse` (§1.7), `00-hus.json` (nivået `hoved`, rommet `stue-kjokken`) og
     `00-ids.json` (id-er og skjema). Én regenerering, der bare de 17 notes endres.
   - *Filer:*
     - `src/data/scripts/house.mjs` (ny);
     - `src/data/scripts/normalize-data.mjs` (bare `main()` 521-525);
     - `src/data/room-spec.json` og `research/house/00-*.json`;
     - `tools/test-design.mjs` (test for byte-identisk ny kjøring; linje 58 teller vegger og møbler uten `roomId` eller med
       `stue-kjokken`);
     - `tools/house-tests/data.test.mjs` og `research/room-spec-notes.md` (generert avsnitt).
   - *Avhenger av:* 1.
   - *Test:* ny kjøring er byte-identisk, og validatoren er grønn på dagens data. En fixture med en dør i feil format,
     overlappende rom eller ukjent arketype gir feil.
   - *Bilder:* nei.
4. **S0-layout: nivå- og rom-API, med stua som før.**
   - *Mål:* gamle felt bare for stua, og `layout.house.*` (§1.8). `DesignState` `windowIds`/`paintIds` leser
     `house.*`.
   - *Filer:* `src/home/layout.js`, `src/design/DesignState.js` (bare 335-347), `tools/house-tests/layout.test.mjs` og
     `tools/house-tests/fixtures/house-mini.json`.
   - *Avhenger av:* 1, og skjemaet i §1.
   - *Test:*
     - `buildLayout(house-mini)` med ett ekstra rom, vegg, vindu, tak, lys og et nivå på −2,55 gir uendret `volume`,
       `floorArea`, `windows`, `walls.length`, `lightGroups` og `ceilingHeightAt(x,z)` for stua;
     - `levelAt` har hysterese;
     - `lightGroupOf` på en ukjent gruppe varsler.
   - *Bilder:* nei.
5. **M1: trinnvis snap ned.**
   - *Mål:* §3.2.
   - *Filer:* `src/player/PlayerController.js`, `tools/house-tests/move.test.mjs`.
   - *Avhenger av:* 1. Nettlesersjekken avhenger av 2.
   - *Test:* 0 % lufthopp på rampetoppen i Node på 30, 60 og 144 Hz. Gangtur i nettleseren over terrassetrappa og
     terskelen til `door-gang`, uten «land»-dunk og uten endret fart.
   - *Integrator W0:* terrassetrappa er stengt i dag (`exterior.js` 455-462, en solid boks; trinnene har
     `collide:false`). Nettleserdelen ble derfor bare gjort over terskelen til `door-terrasse`. Steg 25 kjører
     `tools/tour.mjs` over trappa på 30/60/144 Hz når den kan gås (med kile). Fra stua når man heller ikke gangen før
     gulvstripa i dørhullet (§3.10, `doors.js`) er på plass: kapselen synker 0,134 m i `door-gang`.
   - *Bilder:* nei.
6. **S0-stub: modulskjelett og returkontrakt.**
   - *Mål:*
     - `buildRooms`, `buildStairs`, `buildBuiltIns` og `createVisibility` som stubber;
     - returformen `{group, walls, windows, doors, pickables, builtInLights, colliders, dispose}` slås inn i `home.*`;
     - `roots.levels[id]` og `roots.rooms[id].contents`;
     - `home.ceilingHeightAt` sender `y` videre.
   - *Filer:* `src/home/index.js`, og stubbene `rooms.js`, `builtins.js`, `stairs.js` og `visibility.js`.
   - *Avhenger av:* 4.
   - *Test:* bildediff av stua = 0 og dumpen er identisk.
   - *Bilder:* nei.
   - *Integrator W0 (flettet):* kontrakten står øverst i `src/home/index.js`. Avvik og tillegg som nå gjelder:
     - **`builtInLights` fra byggerne går til `home.house.builtInLights`, ikke til `home.builtInLights`.**
       `home.builtInLights` er fortsatt bare skall + kjøkken. LightManager (`lighting.js` `_buildBuiltIns`) leser
       `home.builtInLights`, og en ukjent gruppe starter på dimmer 1, så romlys fra A2 ville ellers lyst opp stua før
       L1 (§4.2, D12). Steg 13 bytter kilden.
     - Kontrakten har i tillegg `update?(dt, state)`, `setPaint?(id, color)`, `ctx.roots`, `roots.rooms[id].group` og
       `.surfaces` (ikke bare `.contents`), og `home.house` og `home.parts`. `stairs.js` har stubbene `stairLayout`,
       `stairColliders` og `slabColliders`.
     - **Det returnerte `group` legges på sceneroten, utenfor alle nivåer.** Alt som hører til ett nivå, legges i
       `ctx.roots.rooms[id].surfaces`/`.contents` eller `ctx.roots.levels[id]`, ellers kan ikke Y1 skjule det (§4.12).
       `group` er bare for det som ikke hører til ett nivå.
     - **Listene leses én gang**, når byggeren returnerer. Fyll dem før `return`, for det som legges til senere, når
       aldri `home.*`.
     - `buildShell` returnerer nå `materials: M` (felles materialer). index.js sender dem til `buildRooms`.
     - Testen er `tools/house-tests/stub.test.mjs`. Etter flettingen var bildediffen 0 px i 9–10 av 12 bilder og 3–4 px
       i støyvisningene (082806, 082827, 082829), under grensen på 61 px. Dumpen var identisk (12/12 og `state` i
       `.shots/hus/w0-int-g2-post/`).
     - **Orbit-bildene er ustabile** (gjelder også før steg 6): av og til rammes `orbit-sor` eller `orbit-nord` inn
       annerledes, med 30–44 % endrede piksler og samme tall hver gang. Det kommer trolig fra `_fitOrbit`
       (`ViewModes.js` 319, `hint.freeRect` og `cachedRect` leses før oppsettet har satt seg). Kjør en orbit som
       feiler, på nytt med `--only=orbit-sor,orbit-nord` før du konkluderer. Steg 15 (E2) bør gjøre innrammingen
       deterministisk før referansene lages på nytt etter bølge 1.

### Bølge 1: skallet i 1. etasje
Steg 7 kjøres først (30–60 min), deretter 8–10 parallelt.

7. **A1: data for bad, gang og soverom.**
   - *Mål:* vegger, åpninger (dørformat), tak, lys (`plafond`/`downlight`), fasadesegmenter og `lightGroups` (§1.4,
     §1.5). Hullet er ikke med ennå.
   - *Filer:* `research/house/10-hoved-rom.json`.
   - *Avhenger av:* 3.
   - *Test:* validatoren er grønn, arealene er 5,62 / 6,58 / 11,45 (±0,05), og `door-gang` har 0,75 m fri bredde ved 180°.
   - *Bilder:* via notat (`bad-1etg.md`, Tillegget i `vaskerom.md`, `gang-1etg.md`, `soverom-1etg.md`).
8. **A2: rombygger, dører og dekke.**
   - *Mål:*
     - `rooms.js`, `wallkit.js` og `doors.js`;
     - `backOf`-mesh i shell.js, og `buildHall` fjernes;
     - `Door.js` får `openAngleDeg`;
     - gulvstripe i dørhull;
     - dekkeboksen under rommene i 1. etasje (uten hull);
     - fasadesegmentene.
     
     Veggmaterialene faller tilbake til maling til steg 10 er flettet.
   - *Filer:* `src/home/shell.js`, `wallkit.js` (ny), `rooms.js`, `doors.js` (ny) og `src/world/Door.js`.
   - *Avhenger av:* 4, 6 og 7.
   - *Test:*
     - walkmap fra spawn til bad, gang og soverom med dørene åpne og lukket;
     - bildediff av stua = 0 med `door-gang` lukket;
     - skjermbildene fra A2 i §7.5;
     - `door-gang` kan åpnes og lukkes fra begge sider, også når spilleren står i gangen.
   - *Bilder:* nei (skjermbildene sammenlignes med 225331 og 225259).
   - *Integrator W0 (fra steg 6):*
     - `shell.materials` (M) finnes allerede og sendes til `buildRooms` som tredje argument.
     - Romflatene (vegger, gulv, tak, gulvstripe) legges i `ctx.roots.rooms[id].surfaces`, og lampene og fittings i
       `.contents`. Dekkeboksen legges i `ctx.roots.levels['hoved']`. Bruk ikke det returnerte `group` for nivåets
       geometri.
     - Dørene returneres i `doors`, så de flettes inn i `home.doors` og `?doors=open` virker. `update()` må kalle
       `door.update`.
     - Statisk kollisjon returneres i `colliders` og registreres ikke i tillegg med `ctx.collision.addStatic`, ellers
       blir den registrert to ganger. Dørblad registreres fortsatt av `Door.js` (`addDynamicBox`).
     - Romlys i `builtInLights` havner i `home.house.builtInLights` og er ikke med i LightManager før steg 13.
     - Nye romflater ligger ikke under `roots.shell`: Selection, Placement og kuttet i ViewModes ser dem først etter
       steg 14 og 15. Skjermbilder av oversikt og plan fra A2 viser derfor de nye rommene uten kutt.
9. **A3: rom i HUD og dev-parametre.**
   - *Mål:* §5.1 (`home.rooms`, banner med eyebrow, `'room'`-event og `__setView`).
   - *Filer:* `src/home/index.js`, `src/core/Game.js`, `src/ui/Hud.js` og `src/main.js`.
   - *Avhenger av:* 4 og 6. Nettlesersjekken krever 8, fordi `_freeFloor` trenger gulvet.
   - *Test:* `pos=2.5,0,3.2` viser «Gang» med eyebrow «1. etasje». Fra stua til gangen kommer ett banner.
   - *Bilder:* nei.
10. **A4: overflater, fittings og baderomsmodeller.**
    - *Mål:* `stonePanel` og `tiles`, uttrekk av `fittings.js`, `bathroom.js` (WC, servant, femkantet dusj, rundt LED-speil,
      sluk) og `builtins.js` som fordeler etter type.
    - *Filer:* `src/world/surfaces.js`, `src/home/fittings.js` (ny), `src/home/kitchen.js`, `src/home/bathroom.js` (ny)
      og `src/home/builtins.js`.
    - *Avhenger av:* 6.
    - *Test:* bildediff av kjøkkenet = 0. Node-test av `bathroom.js` med bokser og antall verteks for hver type. Nye
      materialer gir ingen nye programmer (`renderer.info.programs`).
    - *Bilder:* via notat (Tillegget i `vaskerom.md`). 225413–225429 åpnes ved tvil om form.
    - *Integrator W0 (fra steg 6):* meshene for innebygd utstyr legges i `ctx.roots.rooms[roomId].contents`, ikke i det
      returnerte `group` (det ligger utenfor alle nivåer). Kollisjonsboksene returneres i `colliders` (THREE.Box3), og
      lyset (LED-ringen i speilet) i `builtInLights`. Det havner i `home.house.builtInLights`. Fyll listene før `return`.

### Bølge 2: 1. etasje ferdig
Steg 11 kjøres først, deretter 12–17 parallelt.

11. **K: katalogen inn.**
    - *Mål:* flette `worktree-katalog-hele-huset` inn i `hele-huset`. Den gir arketypene `bed`, `bedside-table`, `wardrobe`,
      `wall-cabinet`, `coat-rack`, `coat-stand` og `mirror-cabinet`.
    - *Filer:* integratoren løser konflikter i `normalize-data.mjs`, `fixes.mjs`, `test-design.mjs` og `launch.json`.
    - *Avhenger av:* at katalog-agenten har committet, og steg 1.
    - *Test:* alle tester er grønne, og `dev/models` viser de nye arketypene.
    - *Bilder:* nei.
12. **A5: innredning i 1. etasje.**
    - *Mål:* §2.3 og §2.5 som data:
      - seng, nattbord, garderobe, knaggrekke og høyskap som møbler med `roomId`;
      - innebygd utstyr på badet;
      - `existing.js` mapper nye arketyper og kategorier (`CATEGORY_BY_ARCHETYPE`, :29), uten fallback til `'vase'`.
    - *Filer:* `research/house/11-hoved-innredning.json` og `src/home/existing.js`.
    - *Avhenger av:* 8, 10 og 11.
    - *Test:* validatoren er grønn. Skjermbildene av soverom og bad (§7.5). Ingen møbler kolliderer med dørslag.
    - *Bilder:* via notat (`soverom-1etg.md`, Tillegget i `vaskerom.md`).
13. **L1: lys per rom.**
    - *Mål:* §4.1, 4.3, 4.4, 4.5, 4.7–4.11 og 4.14–4.15. Lysmasker, faktor per rom, portaler, nye lystyper, standardverdier
      og LightPanel.
    - *Filer:* `src/home/lighting.js`, `src/world/lightmask.js` (ny) og `src/ui/LightPanel.js`.
    - *Avhenger av:* 4 og 8.
    - *Test:*
      - dumpen for stuas kameraer er identisk, og bildediffen ligger innenfor støyen;
      - **lekkasjetest:** middels luminans i en fast flate på soveromsgulvet med soveromslyset av kl. 20 og alle stuelys på er
        ≤ terskel. Terskelen settes fra en referanse uten stuelys;
      - gangen er ikke svart kl. 12 med lysene av, så lenge `door-gang` er åpen.
    - *Bilder:* nei.
    - *Integrator W0 (fra steg 6):* `_buildBuiltIns` (`lighting.js` 1151–1155) leser `home.builtInLights`, som bare har
      stuas lys. Bytt til `this.home?.house?.builtInLights ?? this.home?.builtInLights`. `home.house.builtInLights` har stuas
      lys først, deretter byggernes. Bytt først når romlysene har egen faktor og maske, for en ukjent gruppe starter på
      dimmer 1.
14. **E1: plassering per rom.**
    - *Mål:* §5.3 for ett nivå.
    - *Filer:* `src/design/Placement.js`, `SceneSync.js` og `Selection.js`.
    - *Avhenger av:* 8.
    - *Test:* et møbel kan settes i soverommet, men ikke gjennom vegg eller i dørslag.
    - *Bilder:* nei.
    - *Integrator W0 (fra steg 6):* røttene for raycast (`Selection.js` 458 og `Placement.js` 1399) tar bare `shell`,
      `kitchen`, `wall` (og `shading`). De nye romflatene ligger i `home.roots.rooms[*].surfaces` under
      `home.roots.levels`. Ta med `roots.rooms[*].surfaces` (og `.contents` for innebygd utstyr). Stuas `group` er tom,
      så ingenting telles to ganger. Ta ikke med hele `roots.levels[id]`, for `roots.shell` og `roots.kitchen` ligger
      også der. Steg 28 (E4) gjør det samme per etasje.
15. **E2: kutt i oversikt og plan.**
    - *Mål:* §5.2 for flere rom.
    - *Filer:* `src/design/ViewModes.js`.
    - *Avhenger av:* 8.
    - *Test:* referansene for orbit og plan er uendret for stua. Planen viser fire rom med etiketter.
    - *Bilder:* nei.
    - *Integrator W0 (fra steg 6):*
      - `_shellSig` (855) og `_prepareCut` (931) går bare gjennom `roots.shell`. De må også gå gjennom
        `roots.rooms[id].surfaces`. Stuas `group` er tom, så stua telles ikke to ganger.
      - Gjør innrammingen i `_fitOrbit` deterministisk (se steg 6: `orbit-sor`/`orbit-nord` rammes av og til inn
        annerledes), slik at referansene etter bølge 1 og 2 er stabile.
16. **E3: akustikk per rom og design v2.**
    - *Mål:* §5.4 og §5.5.
    - *Filer:* `src/design/Acoustics.js`, `DesignState.js`, `Saves.js` og `Editor.js`, `src/ui/AcousticsWidget.js`, `Inspector.js` og
      `CatalogPanel.js` (`rt60For`), og `tools/test-design.mjs` (versjonstesten).
    - *Avhenger av:* 4, og fixturen fra 2.
    - *Test:*
      - v1-fixturen lastes, `win-s1` og `w-hoy` beholdes, og RT60 for stua er 0,86;
      - et møbel på kjellernivå overlever lasting;
      - `originalRooms` legger til nye rom uten å gjenopplive fjernede stuemøbler;
      - backup-nøkkelen skrives.
    - *Bilder:* nei.
17. **U1: panelene.**
    - *Mål:* §5.6.
    - *Filer:* `src/ui/WindowPanel.js`, `PhotoCompare.js`, `Toolbar.js` og `PauseMenu.js`, `tools/prep-images.py`
      og `.gitignore` (`public/img/foto-hus/`).
    - *Avhenger av:* 9.
    - *Test:* vinduslista er gruppert, og fixturen med `optgroup` virker.
    - *Bilder:* nei.

**Milepæl A, «1. etasje»:** integratoren tagger `hus-milepael-a`. Brukeren kan teste den om morgenen.

### Bølge 3: trappa
Steg 18 kjøres først. Deretter kommer den rene delen av 19, så 19–21 parallelt, og 22 til slutt.

18. **B1: data for nivå, kjellergang, trapp og hull.**
    - *Mål:* §1.6, med nivået `kjeller` og et forenklet `kjeller-gang` (sjakt, smal del og sørdel, uten nabodører).
    - *Filer:* `research/house/20-trapp.json`.
    - *Avhenger av:* milepæl A.
    - *Test:* validatoren rapporterer opptrinn 0,182, inntrinn, 2r + g, fri høyde og at fotavtrykket ligger i hullet.
    - *Bilder:* via notat (`gang-1etg.md`, `entre-gang-kjeller.md`).
19. **B2: trappebygger.**
    - *Mål:* først et rent commit med `stairLayout`, `stairColliders` og `slabColliders`. Deretter `buildStairs` (§2.6) med
      LED i håndløperen.
    - *Filer:* `src/home/stairs.js`, `tools/house-tests/stair-geom.test.mjs`.
    - *Avhenger av:* 18.
    - *Test:*
      - geometritest: antall trinn × opptrinn = 2,55, ganglinja er monoton, ingen trinn ligger utenfor hullet, og kilen
        slutter på gulvet ved nederste opptrinn;
      - skjermbilder ned trappa og fra kjellergangen.
    - *Bilder:* nei (sammenlignes med 225337 og 225349).
    - *Integrator W0 (fra steg 6):* signaturene til `stairLayout`, `stairColliders` og `slabColliders` er stubbet i
      `stairs.js`. Trappas mesh legges i `ctx.roots.rooms['trapp']` eller fordelt på `ctx.roots.levels[id]`. Det
      returnerte `group` ligger utenfor alle nivåer og er bare for det som skal vises fra begge. Kollisjonen returneres
      i `colliders`, og LED-lista i `builtInLights`.
20. **M2: nivåer i kollisjonen, respawn og `_freeFloor`.**
    - *Mål:* §3.3–3.5 og §3.7 (Game.js).
    - *Filer:* `src/core/Collision.js`, `src/player/PlayerController.js`, `src/core/Game.js` og `tools/test-stairs.mjs`.
    - *Avhenger av:* 18, og den rene delen av 19.
    - *Test:* §7.3 er grønn, og `?pos=3.5,-2.55,3.8` lander i kjellergangen.
    - *Bilder:* nei.
21. **A2′: hull, dekkekant og kjellertak.**
    - *Mål:* gulv og dekkeboks med hull, hvit kantflate, kjellertak med hull og sjaktvegger med `topProfile`.
    - *Filer:* `src/home/rooms.js`, `src/home/shell.js`.
    - *Avhenger av:* 18.
    - *Test:* ingen glipper mellom 0 og −0,30, sett fra trappa og fra kjellergangen.
    - *Bilder:* nei.
22. **B-test: trappetur.**
    - *Mål:* §7.4 og walkmap over to nivåer.
    - *Filer:* `tools/tour.mjs`, `tools/walkmap.mjs`.
    - *Avhenger av:* 19, 20 og 21.
    - *Test:* romrekkefølgen er `stue-kjokken → gang → trapp → kjeller-gang`, og alle mål i kjellergangen kan nås.
    - *Bilder:* nei.

**Milepæl B, «trappa»:** taggen er `hus-milepael-b`.

### Bølge 4: kjeller og inngang
Steg 23 kjøres først, deretter 24–29 parallelt.

23. **C1: data for kjellerrom og innredning.**
    - *Mål:* §1.4 (kjeller) og §2.7:
      - alle rom, vegger, åpninger, tak, lys og grupper;
      - innebygd utstyr på vaskerommet;
      - garderobe og stumtjener i entréen;
      - møbler i kjellerstua og soverommet etter bildene;
      - `outsideHouse` (§1.2, spawn og forplass).
    - *Filer:* `research/house/30-kjeller.json`, `31-kjeller-innredning.json` og `35-ute.json`.
    - *Avhenger av:* 22.
    - *Test:* validatoren er grønn, og arealene ligger innenfor ±10 % eller er listet (§1.4). Ingen overlapp. Alle dører
      kan nås (walkmap etter 24).
    - *Bilder:* via notat (`entre-gang-kjeller.md`, `vaskerom.md`, `kjellerstue.md`, `soverom-kjeller.md`, `ytterdor-ute.md`).
24. **C2: kjellerbygg og vaskerom.**
    - *Mål:* rommene i kjelleren med ytterlag, entrétrinn, ytterdør (interaktiv), himling og utkraging (§2.8), og
      `laundry.js` med dusjvarianten fra vaskerommet.
    - *Filer:* `src/home/rooms.js`, `shell.js`, `builtins.js`, `bathroom.js` og `laundry.js` (ny).
    - *Avhenger av:* 23.
    - *Test:* walkmap til alle kjellerrom og entréen. Skjermbildene i §7.5. Ingen kjellervegg står inne i eksteriørets
      kollisjonsbokser.
    - *Bilder:* nei (skjermbildene sammenlignes med 225349, 225559, 225644, 225721 og 225505).
25. **C3: eksteriør og inngangsparti.**
    - *Mål:* §2.9.
    - *Filer:* `src/home/exterior.js`, `public/img/utsikt/backdrops.json`.
    - *Avhenger av:* 23. Godkjenningen tas sammen med 24.
    - *Test:*
      - **Fotoprojeksjon** som i `notes/fix-shell.md` («Terrace photo fit»): modellen projiseres inn i 082841 og 082852 for
        −2,87 og for −1,72, og feilen i piksler logges. Hvis −2,87 passer dårligere, beholdes TERRACE_FIT og forplassen
        senkes med trinn vest for pilaren, flagget.
      - Stråler fra punkter inne i hvert rom slipper ikke ut gjennom glipper.
      - Bildediffen av stua er 0 utenfor glassflatene. Endringer gjennom glasset godkjennes med projeksjonen.
    - *Bilder:* ja (225543, 225553, 225619 og `bilder_stue/` 082841, 082852 for projeksjonen).
26. **U2: start ute og lagret posisjon.**
    - *Mål:* §3.6.
    - *Filer:* `src/home/index.js` (`spawnPoint`, 253-262), `src/core/Game.js` (spawn, 199-201) og `src/core/LastPosition.js`
      (ny).
    - *Avhenger av:* 20, 24 og 25.
    - *Test:* tom lagring gir start ute og banner «Ute». Gangtur inn ytterdøra, opp trinnene, gjennom gangen og opp trappa til
      stua. Lagret posisjon gjenopprettes etter omlasting.
    - *Bilder:* nei.
27. **L2: sol, skygge og eksponering for begge nivåer.**
    - *Mål:* §4.5–4.7 for kjelleren: skyggeboks per nivå, `autoUpdate` av, `skyView` og auto per rom.
    - *Filer:* `src/home/lighting.js`, `src/world/lightmask.js`.
    - *Avhenger av:* 23 og 24.
    - *Test:* kjellergangen er mørk med lys av kl. 12 og ikke solbelyst. Kjellerstua får dagslys gjennom V1 og V2. Dumpen
      for stua er identisk. 0 solpass mens man går.
    - *Bilder:* nei.
28. **E4: editor per etasje.**
    - *Mål:* §5.2 (per etasje) og §5.3 (flere nivåer). Kallstedene med to argumenter flyttes til tre (§1.8).
    - *Filer:*
      - `src/design/ViewModes.js`, `Placement.js`, `SceneSync.js`, `Selection.js` og `Editor.js`;
      - `src/ui/Toolbar.js`, `WindowPanel.js`, `WallPanel.js` og `Inspector.js`;
      - `src/models/lamps.js` og `shading.js` (bare `ceilingHeightAt`).
    - *Avhenger av:* 23 og 24.
    - *Test:* `view=plan&floor=kjeller` og orbit for kjelleren virker, og et møbel kan settes i kjellerstua. Gardinhøyden
      stemmer for kjellervinduene.
    - *Bilder:* nei.
    - *Integrator W0 (fra steg 6):* røttene for raycast og kutt per etasje er `home.roots.rooms[id].surfaces` og
      `.contents` (se steg 14 og 15). Ta ikke med hele `roots.levels[id]`, for der ligger også `roots.shell` og
      `roots.kitchen`.
29. **Y1: synlighet og ytelse.**
    - *Mål:* §4.12–4.13.
    - *Filer:* `src/home/visibility.js` og `tools/perf.mjs` (ny).
    - *Avhenger av:* 24 og 27.
    - *Test:* budsjettene i §4.13 holder mot master, målt med `autoResolution` av.
    - *Bilder:* nei.
    - *Integrator W0 (fra steg 6):* API-et er stubbet i `visibility.js` (`update`, `setOverview`, `refresh`,
      `levelVisible`, `contentsVisible` og `dispose`). `home.update` kaller `visibility.update(dt, state)` etter design
      og før lys, første gang etter `Game._precompile`. Y1 trenger derfor ingen endring i `index.js`. Det byggerne
      returnerer i `group`, ligger utenfor nivåene og kan ikke skjules med dem.

**Milepæl C, «hele huset»:** taggen er `hus-milepael-c`.

### Bølge 5: foto og morgen
Disse stegene trenger brukeren. I natt lages bare forslag.

30. **P0: fotoindeks og bildeprep.**
    - *Mål:* `research/house-photos.json` kobler hvert bilde til rom, retning og bruk, også feilsorterte bilder (§8.2). Deretter kjøres
      `prep-images` til den gitignorerte mappa. Steget kjøres sist, når mappenavnene er stabile, og sjekker at hver sti
      finnes.
    - *Filer:* `research/house-photos.json`, `public/img/foto-hus/` (gitignorert).
    - *Avhenger av:* 17.
    - *Test:* alle filer i `bilder_hus/` er koblet til et rom, og ingen stier mangler.
    - *Bilder:* ja.
31. **P1–P7: fototilpasning per rom.**
    - *Mål:* `photoCameras` og overlegg per rom, med justering av farger, posisjoner og lysnivåer.
      - Resultatet er **forslag** med før/etter-bilder i `.shots/hus/foto/<rom>/`.
      - Brukeren godkjenner om morgenen.
    - *Filer:* `research/house/40-bad.json`, `41-gang.json`, `42-soverom.json`, `43-vaskerom.json`, `44-kjellerstue.json`,
      `45-soverom-kjeller.json` og `46-kjeller-gang-entre.json`. Én agent per rom.
    - *Avhenger av:* 30, og alle byggesteg.
    - *Test:* overlegg mot bildet med kantfeil ≤ 2 % av bildebredden på dører og vinduer.
    - *Bilder:* ja.

---

## 7. Testplan

### 7.1 Felles for alle steg

- **Server:** i eget arbeidstre kjøres `npx vite --config tools/vite.test.config.mjs --port 525N --strictPort` i
  bakgrunnen, og PID-en noteres.
  - `walkmap.mjs` importerer fra `/node_modules/.vite/deps/…` og `/src/…` (46-50). Den trenger derfor en dev-server, ikke
    `vite preview`.
  - Hvert arbeidstre er bare ditt, så ingen endrer siden midt i et skjermbilde.
- **shot.mjs:** sett alltid `--port=525N`, fordi standardporten er 5180. Bruk `--hide=#info,#labels`, `--steps=120` og
  `--eval="__game.hud.showHelp(false)"`. Rendringen tas med GPU-låsen.
- **Automatiske tester:**
  - `node tools/test-design.mjs`: stuas regresjon (0,86 s, 138,57, 53,78, 4 soner og forslagene i wall-proposals);
  - `node tools/test-house.mjs`: alle `tools/house-tests/*.test.mjs`;
  - `node src/data/scripts/normalize-data.mjs --only=room-spec --out=<tmp>`, med bytesammenligning mot `src/data/room-spec.json`.
- **Stuas regresjon etter hvert steg:**
  - `node tools/dump-state.mjs --port=525N`, sammenlignet med `.shots/hus/ref/state.json`: Lkey, S, hvitbalanse, valgte
    lysplasser og RT60 per foto-kamera, kl. 08:30, 12, 20 og 23;
  - `node tools/imgdiff.mjs ref.png ny.png --max=<2 × støy>` for de 8 foto-kameraene, spawn, orbit og plan.
  
  Bare L1, L2 og C3 (gjennom glasset) kan få et avvik godkjent, og bare med begrunnelse i sluttrapporten.
  - Alt i én kommando: `node tools/refcheck.mjs --port=525N --step=<steg> --lock` (12 bilder og dumpen mot
    `C:\Dev\Interiørspillet\.shots\hus\ref\`).
  - **Orbit og plan viser hele etasjen.** Når bølge 1 bygger bad, gang og soverom (steg 8 og senere), endrer
    `orbit-sor`, `orbit-nord` og `plan` seg selv om stua er lik. Steg i bølge 1 og senere kjører derfor
    `--only=0_for,20261018_082806,20261018_082827,20261018_082829,20261018_082909,20261018_082924,20261018_083012,20261018_083019,spawn`
    pluss dumpen, og ser på orbit og plan med øynene. Integratoren lager referansene på nytt etter hver godkjent bølge
    (alle 12 bildene, fra hovedtreet med den flettede koden): `node tools/refcheck.mjs --port=5250 --make --publish --lock`.
    Lag aldri referanser med `--only` og `--publish` samtidig (refcheck nekter nå).

### 7.2 Tester per steg

| Steg | Tester |
|---|---|
| 3 | Ny kjøring er byte-identisk. Telleren i test-design.mjs:58 gir 12 vegger og 62 møbler i stua. Validatoren feiler på dårlige fixtures (dørformat, overlapp, arketype, åpent dørblad mot rekkverk). |
| 4 | Med `house-mini` er stuas tall dypt like i dag. `ceilingHeightAt(x,z)` er lik `house.ceilingHeightAt(x,z,0)` i stua. `levelAt(-1.0)` er `kjeller`. `levelAt` på føttene −0,18 + 0,9 er `hoved`. |
| 7–8 | Arealene er bad 5,62, gang 6,58 og soverom 11,45. `roomAt(1.2,0,1.1)` gir `bad`, `(2.5,0,3.2)` gir `gang` og `(1.5,0,5.7)` gir `soverom`. Hver dør har `connects` til to rom. Ingen lysgruppe havner i `kjokken`. `backOf`-par ligger én tykkelse fra hverandre. |
| 16 | Rundtur i DesignState for v1-fixturen. Et møbel på `level:'kjeller'`, y 0 overlever lasting. `w-hoy`, `win-s1` og RT60 0,86 holder. `originalRooms` virker. |
| 18–19 | Opptrinn 0,182 (0,15–0,22). 2r + g ligger i 0,60–0,64 eller gir advarsel (anslått). Inntrinn på ganglinja er minst 0,22, ellers advarsel. 14 × opptrinn = 2,55. Fri høyde er minst 1,95. Fotavtrykket ligger i hullet og i `kjeller-gang`. `house.ceilingHeightAt(3.5, 3.8, -2.55)` er −0,30. |
| 23 | Kontrollarealene (12,50 / 20,57 / 7,41 / 2,51 × 2,93) ligger innenfor ±10 % eller er listet. Ingen rom overlapper. Ingen kjellervegg står inne i eksteriørets bokser. |

### 7.3 Gangtest i trappa: `tools/test-stairs.mjs` (steg 20)

Testen kjører i Node uten nettleser, med ekte fysikk. Collision.js og PlayerController.js er DOM-frie.

- **Oppsett:**
  - `CollisionWorld` bygges av `stairColliders(stairLayout(…))` og `slabColliders(layout,'hoved')` (dekkeboks og rekkverk), pluss kjellergulvet.
  - `PlayerController` får falsk input, falske innstillinger og en spion på events.
- **Scenarier:** ned fra toppen, opp fra bunnen, i løp, med skrå inngang (30°), stopp midt i trappa (ingen gliding på 2 s),
  hopp i trappa (ingen dytt gjennom dekket) og huk. Alle kjøres på **30, 60 og 144 Hz**.
- **Krav:**
  - Slutt-y er −2,55 ± 0,02, eller 0 ± 0,02 på vei opp.
  - |Δy| per bilde er høyst 1,3 · v · dt · tan θ, med θ fra validatoren. En fast grense på 0,1 feiler på 30 Hz i løp.
  - Spilleren er i lufta mindre enn 2 % av bildene, og det kommer ingen «land»-event over 1,5 m/s.
  - Ingen toast om respawn.
  - Hodet er aldri over dekkets underside utenfor hullet.
  - Tiden ligger innenfor 0,7–1,3 × lengden / (2,2 m/s × 0,78).

### 7.4 Gangtest i nettleseren: `tools/tour.mjs`

- Last `/?play=1&nowarm=1&doors=open&nohelp=1` på 525N og stopp RAF-løkka.
- Kjør med fast steg: `input.keys.add('KeyW')`, så `player.update(1/60)`, `home.update(…)` og `game._updateRoom()`.
- **Turer:**
  - steg 5: over terrassetrappa;
  - steg 8: stua → gangen → badet, og stua → soverommet;
  - steg 22: stua → gangen → trappa → kjellergangen;
  - steg 26: ute → ytterdøra → entréen → gangen → trappa → stua.
- **Krav:** romrekkefølgen stemmer, og HUD-ens `.kv-room__name` og eyebrow har riktig tekst.

**Walkmap:**

- Steg 22:
  `node tools/walkmap.mjs --port=525N --doors=open --auto-y --levels=0,-2.55 --from=4.2,0,4.0 --expect=2.5,0,3.2;1.5,0,1.3;1.5,0,5.7;3.5,-2.55,3.8`
- Steg 24 og 26 legger til:
  - kjellerstua `3.5,-2.55,6.2`;
  - vaskerommet `1.3,-2.55,6.4`;
  - soverommet i kjelleren `1.3,-2.55,10.2`;
  - entréen `7.4,-2.85,4.4`;
  - ute `12.0,-2.87,4.6`.

Avslutter med kode 2 hvis et mål ikke kan nås. Smale striper, som stripa nord for senga på 0,65 m, brukes ikke som mål.

### 7.5 Skjermbilder

`pos` er føttene, og vinklene er i grader. Alle kjøres med `--w=1280 --h=960 --port=525N` og `&nowarm=1&nohelp=1`. Der
det står «åpne», brukes også `&doors=open`, men aldri for stuas referanser.

| Steg | URL-utdrag | Sjekk mot |
|---|---|---|
| 8 | `pos=3.6,0,3.9&yaw=90&pitch=-20` (åpne) | Fra stua gjennom `door-gang` mot nord, som 225331 |
| 8 | `pos=2.6,0,4.0&yaw=180&pitch=-8` (åpne) | Inn i soverommet, som 225256 |
| 8, 12 | `pos=1.5,0,5.6&yaw=180` og `pos=2.8,0,6.5&yaw=0` | Soverommet mot hodeveggen (225259) og mot garderoben og døra (225304) |
| 10, 12 | `pos=2.0,0,1.8&yaw=45&pitch=-10` | Badet mot dusjen og servanten (225413–225425) |
| 8 og alle | spawn og de 8 foto-kameraene i sandkassen | Stuas bildediff |
| 19, 21 | `pos=1.9,0,2.9&yaw=90&pitch=-45` | Ned trappa, som 225337 |
| 19 | `pos=3.4,-2.55,3.5&yaw=90&pitch=8` | Trappa fra kjellergangen, som 225349 |
| 24 | `pos=3.5,-2.55,6.2&yaw=180` og `pos=2.2,-2.55,5.0&yaw=75` | Kjellerstua (225644) og vaskerommet (225505) |
| 24 | `pos=1.3,-2.55,10.2&yaw=180` og `pos=8.0,-2.85,4.4&yaw=90` | Soverommet i kjelleren (225721) og entréen mot gangen (225559) |
| 25, 26 | `pos=12.0,-2.87,4.6&yaw=85&pitch=-6` | Startbildet ute (225543) |
| 25 | `view=orbit` fra sør, nord og vest | Fasade, utkraging, ingen glipper |
| 15, 28 | `view=plan&floor=hoved` og `view=plan&floor=kjeller` | Etiketter og dørsving |
| 13, 27 | gangen, soverommet og kjellergangen kl. 12 og 20, med lys av og på | Lekkasje og mørk kjeller |

---

## 8. Bilder, anslått og målelista

### 8.1 Status kl. 23:48

| Mappe | Antall | Notat |
|---|---|---|
| `Bad 1etg` | 0 | – (badet er i `vaskerom/`, se 8.2) |
| `gang 1etg` | 7 | `gang-1etg.md` |
| `Soverom 1etg` | 7 | `soverom-1etg.md` |
| `Entre og gang kjeller` | 17 | `entre-gang-kjeller.md`, `ytterdor-ute.md` |
| `Kjellerstue` | 10 | `kjellerstue.md` |
| `Soverom kjeller` | 5 | `soverom-kjeller.md` |
| `vaskerom` | 20 | `vaskerom.md` |

`plantegning_kjeller.png` og kopier på 1600 px ligger i `bilder_hus/_1600/`. Bildene er tatt om kvelden i varmt lys, og
notatene har hvitbalansert fargene.

### 8.2 Bilder som ligger i feil mappe

Mappenavnene er bare hint, og P0 skriver dette inn i fotoindeksen:

- `vaskerom/20261020_225413–225429` (9 bilder) viser **badet i 1. etasje** (D15). Bare 225443–225525 viser vaskerommet.
- `Entre og gang kjeller/20261020_225256` viser **soverommet i 1. etasje**, sett fra gangen øverst i trappa.
- `gang 1etg/20261020_225342` og `225344` viser **kjellergangen**, sett fra trappa.
- `Soverom 1etg/20261020_225324` og `225327` viser gangen og badet gjennom døra.
- `ytterdor-ute.md` bruker også `bilder_stue/` 082841, 082843, 082850, 082852, 082901 og 082916.

### 8.3 Hva som fortsatt mangler (bilder)

| Rom | Mangler |
|---|---|
| Bad, 1. etasje | Ett bilde rett mot østveggen og ett av gulvet ved sluket. Resten er dekket av 225413–225429. |
| Gang, 1. etasje | Ett bilde rett mot rekkverket fra baddøra, for hullformen, og veggen øst for `door-gang` (z 2,32–3,36). |
| Trappa | Ett bilde rett fra siden av hvert løp, så trinnene kan telles, og et bilde av svingen ovenfra mot NØ-hjørnet. Overgangen til 1. etasje på østsiden er ikke sett fra kjelleren. |
| Kjellergang og entré | Hele gangen sørover i dagslys. Et bilde av nisjen ved bod-1-døra fra siden. |
| Kjellerstue og soverom i kjelleren | Vindusveggene i dagslys med gardinene oppe, så utsikt og terreng kan avgjøres. |
| Ute | Sørfasaden under stua (D9: utkraging eller flukt?), terrassetrappa fra siden (antall trinn) og kjellerens nord- og vestfasade. |

### 8.4 Målelista (tommestokk), i prioritert rekkefølge

1. **Den innvendige trappa:** antall opptrinn og høyden på ett opptrinn. Det gir `floorY` (nå −2,55) og bekrefter dekket på 0,30.
2. **Terrassetrappa:** antall trinn. 9 betyr bakke på −1,7, og 15–16 betyr ca. −2,8 (D8).
3. **Takhøyde i ett kjellerrom** (nå 2,25) og høyden på de to trinnene fra entréen til gangen (nå 2 × 0,15).
4. **Hullet:**
   - fra nordveggen til rekkverk A (nå 1,85) og til øverste trinnkant (nå 1,50, eieren sa 1,54);
   - z for rekkverk B (3,48) og nyestolpen (3,10).
5. **Trappefoten:** fra nordveggen i kjelleren til nederste trinnkant (nå 1,60). Er det 3 rette trinn nederst?
6. **Fra karmen på `door-gang` (gangsiden) til veggen mot soverommet.** Det avgjør D1: 4,40 eller 4,43.
7. **Kjellerstua øst–vest** (planen sier 6,05, modellen bruker 6,48) og om sørveggen står i flukt med stua over eller er
   trukket inn (D3, D9).
8. **Vinduene:** sålbenk og høyde for vinduet på badet (48 × 117: er 48 bredden?) og vinduet på soverommet.
9. **Takhøyde på bad, gang og soverom** (anslått 2,40 og flatt).
10. **Bod-3:** hvor langt sørveggen går forbi terrassekanten (9,80 eller 10,2).
11. **Innerdørene:** bredde. Er de som `door-gang`, med blad 0,93 × 2,08?

### 8.5 Hva bildene sier om farger (kort)

Detaljene står i notatene. Disse verdiene er brukt i planen:

- **1. etasje:**
  - Gangen er SAND med lyst tak og stuas eik.
  - Soverommet er `#50575c` på vegger og tak.
  - Badet har steinplater `#c6c1b9` og gulv `#5a5759`.
  - Alle innerdører og karmer er `#1d1e21`.
- **Kjeller:**
  - SAND og gulv `#cbbfb0`, med beige gulvlist `#cbbba7`.
  - Vaskerommet er salviegrå `#b8bfb5`, med vinyl `#8c8789` og skaprad `#b0a89f`.
- **Ute:**
  - Kledningen er `#4a4642`, himlingen `#35312e` og pilaren `#a9a7a1`.
  - Ytterdørbladet er `#2b2c2e`.

### 8.6 Slik merkes manglende informasjon

- **I data:** hver oppføring har `estimated: [felt…]` og `source`. `["*"]` betyr at hele oppføringen er anslått.
  - `source` peker på et fotonotat, et bilde, en plan eller «eier 2026-10-20».
  - Fritekst forklarer hvordan verdien er utledet, for eksempel «z strukket 6,1 % (D3)».
  - Målte verdier har ingen `estimated`.
- **I validatoren:** `--verbose` skriver målelista sortert etter rom. For anslåtte felt blir brudd advarsler, for målte
  felt feil.
- **I dokumentasjonen:** målelista genereres inn i `research/room-spec-notes.md`. Fakta-fila er fortsatt fasit.
- **I spillet (valgfritt):** med `?anslatt=1` får anslått geometri en tynn gul kontur, og planen viser «(anslått)» bak
  romnavnet.
- **Når et mål kommer inn:** fjern feltet fra `estimated`, sett `source` til «målt <dato>», og kjør normaliseren og alle
  testene på nytt. `floorY` endrer ikke lagrede møbler, fordi y lagres nivålokalt (§5.5).

### 8.7 Spørsmål til eieren i morgen

1. Trappetallene fra 8.4, punkt 1–3: den innvendige trappa, terrassetrappa og entrétrinnene.
2. Står kjellerstuas sørvegg i flukt med stua over, eller under en utkraging? Hvor lang er kjellerstua?
3. Er bildene 225413–225429 i `vaskerom/` fra badet i 1. etasje?
4. Skal soverommet i kjelleren ha seng? Skal pult, tredemølle og spinningsykkel med i kjellerstua?
5. Hva heter de tre bodene?
6. Skal «Alle på/av» i lyspanelet gjelde hele huset (som i dag) eller bare rommet du står i?
7. Skal bad og soverom ha en egen etterklangsverdi (anslått)?
8. Kan bilder fra soverom og bad legges i `public/img/foto/`? Da havner de i git og på Railway. Ellers blir de bare i dev.
9. Skal oversikten vise én etasje om gangen, slik planen legger opp til?
