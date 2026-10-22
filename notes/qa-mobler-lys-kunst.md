# QA – møbler, lys og kunst (runde 3)

Arbeidsnotat fra QA-pakken (P09) til integratoren. Det oppdateres underveis. Planen er i
`SP/design/MASTER.md` §4.2 P09 og §5, og testpolicyen er i `SP/design/qa.md`.

Siste sveip (P09): 2026-10-21 ca. kl. 23:36; §1–§5 gjelder det tidspunktet. Integrasjonen står i §6 (steg 1–7),
§7 (nettleserkontrollene, steg 8–9), §8 (tuning-runden og sluttintegrasjonen, steg 10–11) og §9 (sluttstatus og
«Mangler / kjente begrensninger»). **§9 er den gjeldende listen.**

## 1. Verktøy og tester (P09)

| Fil | Hva | Kjøres slik |
|---|---|---|
| `tools/lib/research-rules.mjs`, `tools/check-research.mjs` | Reglene for forskningsfiler (D20). Filen normaliseres i en temp-mappe, aldri i `src/data`. | `node tools/check-research.mjs research/runde3 --build --claims=<SP>/work/claims` · `--rules` lister reglene |
| `tools/check-build.mjs` | `npm run build`. Tillatt er bare de 2 kjente `estimateShading`-advarslene, og ingen JS-chunk over 2000 kB. | `node tools/check-build.mjs --out=.shots/<pkg>/dist` (uten `--out` skrives `dist/`, bare ved integrasjonen) · `--json=` |
| `tools/check-ui-text.mjs` | Engelske UI-strenger lagt til under `src/` siden c28070d | `node tools/check-ui-text.mjs` · `--all` = hele src |
| `tools/thumbcheck.mjs` + `tools/thumbcheck-allow.json` | Miniatyrkontroll med flaggene FAILED/FALLBACK/BLANK/BLACK/EDGE/DIMS/NOGLOW/CONSOLE, kontaktark og sammenligningsark mot butikkfoto | se §3 |
| `tools/perf.mjs --scene=stress\|grid\|ref` | Ytelse med rundens armaturer, mot en referanse uten dem | se §3 |
| `tools/house-tests/_qa.mjs` | Felles hjelpere: `PARTIAL`, `soft`, `pending`, `WAIVERS`, `syncedHome`, `spotSpec`, `pick`, PNG/JPEG/WebP-bytes, mem-lagring | importeres av testene |
| `tools/house-tests/models.test.mjs` | FURN §7 + QA §3.3: alle arketyper og alle valg bygger, ytterpunkter, alle produkter, mål, lys, budsjett, determinisme og omfarging | `node tools/house-tests/models.test.mjs [--arch=a,b] [--verbose]` |
| `tools/house-tests/catalog-round.test.mjs` | QA §3.4 A–C: forskningsfilene, målene i §4.3 og katalogen (ryddig hus, søk, hint, D46) | `… [--file=<forskningsfil>]` (lintmodus) |
| `tools/house-tests/lightbudget.test.mjs` | QA §3.1 B–G på SceneSync-nivå: 38 hoder, invarianten I1–I4, andre rom, skråtak (G1–G3), rutenett med gridOps, lagring | `… [--section=B,C,D,E,F,G]` |

Under `QA_PARTIAL=1` er det bare dette som er mykt: rundens mål, søketreff i den frosne katalogen, nye arketyper uten
bygger og kontraktvalg som ikke er deklarert ennå. (I4-rekkefølgen er streng fra integrasjonen, se §6.)

## 2. Status ved siste sveip

- `node tools/test-design.mjs`: 144 passed, 0 failed.
- `QA_PARTIAL=1 node tools/test-house.mjs`: 28 av 28 ok (de 20 fra før og art, catalog-round, downlights, image-art,
  images, lightbudget, models og spots-models). `wip/` er tom.
- `node tools/smoke-import.mjs`: OK.
- `node tools/check-build.mjs --out=.shots/p09/dist`: OK. 34 JS-chunker. Den største er `artImages` på 827 kB.
- `check-research research/runde3 --build --claims=…`: 0 FAIL og 31 WARN over 225 produkter i 15 filer. 220 av dem er
  verifisert, og alle bygger i Node (62 er bare canvas).
- Uten `QA_PARTIAL` (som ved integrasjonen):
  - `models.test` er grønn.
  - `catalog-round` har 6 FAIL. Alle er søketreff, og de går over når `research/runde3` er normalisert inn.
  - `lightbudget` har 1 FAIL, I4-rekkefølgen (§4).
- thumbcheck på hele den frosne katalogen: 372 miniatyrer, 0 flagget etter allow-listen (2 speil og den flate
  takabsorbenten), 0 konsollfeil.
- thumbcheck på spotterforskningen (`--research`, alle varianter): 56 miniatyrer, 0 flagget og 8 advarsler (tynne
  skinner og mørke spotter). Arkene er i `.shots/p09/thumbcheck-spotter/sheets/`.
- perf `--scene=stress` mot `--scene=ref` (spawn, stue-tv, kjøkken, 20 bilder):
  - frame ms: spawn 10 mot 8,8, stue-tv 9,3 mot 9,6, kjøkken 6,4 mot 6,4;
  - ingen skyggepass og ingen miljøbygg;
  - **draw calls ved spawn er 283 mot 227**. Budsjettet er +3 per armatur (+42), mens målt er +56, dvs. om lag
    4,7 kall per synlig armatur. Se §4, P02.
- Referansekjøringen kl. 21 uten nye ting gir nøyaktig QA-baselinens tall: 227/216 685, 263/121 473 og 80/27 835.

## 3. Kommandoer for integratoren (MASTER §5)

```
node tools/check-research.mjs research/runde3 --build --claims=<SP>/work/claims          # steg 2: 0 FAIL
node tools/thumbcheck.mjs --port=5190 --lock --step=integration --sheets                   # steg 8a, standardvarianter
node tools/thumbcheck.mjs --port=5190 --lock --step=integration --new-since=c28070d --variants=all --sheets --photos
node tools/thumbcheck.mjs --port=5190 --lock --step=<id>-tune --research=<fil> --photos    # steg 10, tuning per forsker
node tools/perf.mjs --port=5190 --lock --step=integration --only=frames --poses=spawn,stue-tv,kjokken --scene=ref --label=ref --out=.shots/integration/perf-ref.json
node tools/perf.mjs --port=5190 --lock --step=integration --only=frames --poses=spawn,stue-tv,kjokken --scene=stress --label=stress --compare=.shots/integration/perf-ref.json
node tools/check-ui-text.mjs                                                               # steg 9
node tools/check-build.mjs                                                                 # steg 7 (skriver dist/)
```

- `WAIVERS` i `tools/house-tests/_qa.mjs` fylles bare av integratoren (D43). Nøkkelen er f.eks. `'bildebelysning>=2'`
  eller `'<arketype> brukt'`.
- `thumbcheck-allow.json` godtar bare produkter fra før runden. Hvis du legger til et nytt produkt der, feiler
  verktøyet.

## 4. Funn til eierne (ikke rettet av QA)

- **P01 (lighting.js), I4-rekkefølgen.**
  - Hva som skjer: når de nye lampene i stua slås **av** (de står fortsatt i designet), får lampen som vek
    (`builtin:pendel-oy-3`) plassen tilbake, men i plass 4 og ikke i plass 10 som før.
  - Det som er likt: de samme lysene har plass, og Lkey, S, hvitbalanse og omgivelseslys er identiske. Fjerner man
    lampene (i stedet for å slå dem av), blir rekkefølgen lik.
  - Konsekvens: ingen synlig forskjell, men MASTER §2.5 I4 sier «ids in slot-index order».
  - I testen: `lightbudget.test` C, «I4 … og i samme plassrekkefølge». **Løst ved integrasjonen:** med P01s endelige
    versjon består sjekken, og den er nå streng (§6).
- **P01 (gridOps.distributeGrid), «Fordel jevnt».**
  - Veggavstanden er spacing/2 + 5 cm (`EDGE = 0.05`). Kontrakten (§2.6) sier spacing/2.
  - Testen F4 godtar opptil +6 cm.
  - Integratoren avgjør: behold (dokumentert i gridOps.js) eller sett `EDGE = 0`.
- **P02 (spots.js), veggspot.**
  - Hva som skjer: `spot-wall` bruker ikke dims.w/d/h til størrelsen. Hode, arm og plate følger bare `headD`, `headL`
    og `armLen`. Størrelsesglidebryterne i Inspector gjør derfor nesten ingenting, og et produkt med butikkens mål blir
    feil hvis RF ikke har satt hodeparametrene.
  - Hvor det slår ut: forhåndsvisningen av models.test seksjon 5 viser `nova-life-bino` w 0,70 ×,
    `nova-life-noor-ii` d 0,83 × og `ikea-nymane-vegglampe-dobbel` h 1,16 ×.
  - Det samme gjelder `elektroimportoren-slv-plastra-downlight-firkantet` (dims 0,13 m, modellen 0,099 m).
- **P02, bildelampe.**
  - Lyset peker «ned og ut» med kjeglekanten langs veggen. Lyset på bildet er lysflaten (wash-decal).
  - Dette avviker fra LIGHT §2 (dir ned og inn mot veggen) og QA E5. Testen E5 er tilpasset: kjeglen må nå veggen,
    og lysflaten må finnes.
  - Integratoren bør godkjenne avviket.
- **P02, draw calls.** Rundt 4–5 kall per synlig armatur, mot QA §5.2s 3. Frame-tiden holder seg innenfor (§2).
- **P06 / RC, `wall-shelf`.** `bohus-stord-hattehylle-med-hylle-b70` (h 0,10 mot 0,20) og
  `ikea-bergshult-sandshult-vegghylle-80x20` (h 0,10 mot 0,22) bygges med feil høyde. Enten bruker byggeren ikke
  dims.h for disse stilene, eller så må dataene endres.
- **RG, kunst.** `bohus-lorraine-canvas-bilde-90x120`: butikkbildet ser liggende ut, mens vår modell er stående
  (w 0,90, h 1,20). Sjekk w/h. Ellers er motivlikheten grov for flere lerreter (Blaze, Arian). Det er stoff for
  tuning-runden i §5 steg 10.
- **Data under glidebryterne (eldre produkter, bare info).**
  - `jysk-hemme-nattbord`, `bohus-nola-nattbord` og `ikea-tonstad-nattbord` har `legH` 0,40–0,47 over byggerens
    maks 0,35.
  - 2 loungestoler har `armH 0`, og 2 garderobeskap har `drawerH 0,6`.
  - Alt dette er fra før runden og uendret.
- **check-research WARN (31):**
  - `dims-range`: Celma sidebord Ø27,5, Bjørvik vegghylle d 0,11, Limotti vegglampe d 0,037, Vidja w 0,19, Fia
    2-seter d 0,79, Anillo Ø30 som downlight-surface, Rigel benk d 0,64, Vision TV-benk h 0,23;
  - `params`: `ikea-sandared-puff` har `chunky` (ukjent param);
  - 5 produkter er `verified: false` med begrunnelse;
  - 2 runde nattbord bruker coffee-table drum (dette er riktig etter D9).

## 5. Kjente begrensninger ved P09s sveip (erstattet av §9)

- ~~Miniatyren av den flate takabsorbenten (Loke oval flate) er tatt fra siden.~~ Rettet i tuning-runden (P04).
- ~~Speilene er svarte i miniatyrene.~~ Rettet ved sluttintegrasjonen (§8): studioet bruker matte kopier av metall og
  speilglass.
- «Fordel jevnt» holder 5 cm ekstra avstand til veggene. Beholdt med vilje (§8, P01).
- ~~En veggspot får størrelsen sin fra hodeparametrene og ikke fra målene.~~ Rettet i tuning-runden (P02).
- Den første spoten kan hakke et øyeblikk (D31: nye shaderprogrammer kompileres første gang).

## 6. Integrasjon, steg 1–7 (integrator A, 2026-10-21)

Planen er MASTER §5. Loggen ligger i `SP/work/integration/int-a.txt`.

### Steg 1 – eierskap og forespørsler

- Alle endrede og nye stier hører til §3 eller §4.1, pluss `research/runde3/`, `.shots/` og `.claude/launch.json`.
  Filene F fryste er like som i `SP/foundation/snapshot/`, bortsett fra pakkenes egne filer.
- `SP/work/requests/p05/` var tom: ingen forespørsler om hook-rørleggingen.
- Godkjent og lagt inn:
  - **P05, `ShoppingPanel.js`:** «Ut av stua» nevner nå også et maleri som er byttet ut med eget bilde. `text`, `csv`
    og `print` i ekstraseksjonene er pakket i try/catch, som `list()` og `_render()` allerede var.
  - **P02, rund takplate (avvik fra D2):** platen er 0,78 × spennet, og spottene sitter på korte stammer under den.
    Det ligner Bohus Hugin, Flint og Avenir.
  - **P02, bildelampe (avvik fra LIGHT §2):** lysflaten (wash-decalen) lyser opp bildet. Selve spotlyset peker ned og
    ut i rommet. `lightbudget` E5 tester dette.
  - **I4-rekkefølgen:** P01s endelige seteplan gir den returnerende lampen den gamle plassen. Sjekken
    «I4 … og i samme plassrekkefølge» er nå **streng**, også under `QA_PARTIAL`.
  - **`itemSpots` er fortsatt `{ low: 2, medium: 2, high: 3 }` (D5).** Dette skal med i overleveringen: i den åpne stua
    deler kjøkken, spisestue, stue og TV-stue ett lysbudsjett. På «Middels» får bare de to beste gruppene med nye
    spotter ekte lys, og på «Høy» får tre. Belysning-panelet viser «Lyser via omgivelseslys nå …» når en lampe ikke
    har fått lysplass.
  - **`models.test`:**
    - en `chair` med `back: 'pad'` kan være opptil 1,25 × dims i bredden (P07; Zed);
    - en `desk` med overbygg kan være opptil h + hutchH høy (P06; ingen produkt bruker det ennå);
    - en `downlight` med `trim: 'flush'` (trimless/gips) kan være ned til 0,6 × dims i bredden. Butikkens mål er
      gipskroppen, som ligger skjult i taket (SLV Plastra, Namron Alfa).
    - FURN §7-unntakene fra P08 fantes allerede.
  - **`research-rules`:**
    - `chair.armStyle` tillater bare `frame|pad|loop` i data (P07); byggerens «Automatisk» (`auto`) er bare for UI;
    - nye skjulte parametre: `coffee-table.hubH`, `floor-arc.baseH` og `spot-wall.plateD`.
  - **`check-research`:** når en runde 3-fil er flyttet til `research/catalog-new`, regnes ikke produktenes egne kopier i
    `src/data/catalog` som duplikater lenger. Uten dette feilet catalog-round A etter regenereringen.
- Data og byggere, de billige rettingene:
  - **Celma:** `hubH: 0.12` (RA/P06): foten sitter nå lavt på søylen, som på bildet.
  - **Arum arched:** `baseH: 0.26` (RE/P08). Blokken er nå ca. Ø17 × H26 som på bildet, ikke 12 cm lav. Den avrundede
    toppen er ikke modellert.
  - **`tables.js` `buildWallShelf`:** én hylle på `brackets` legger nå hylla øverst, og konsollene fyller dims.h
    (Stord og BERGSHULT/SANDSHULT, 0,10 → 0,20/0,22 m). Ingen produkter fra før bruker denne kombinasjonen.
  - **`spots.js` `buildSpotWall`:** ny skjult `plateD` for veggplaten på én spot; standarden er fortsatt 7 cm.
    - Bino har `plateD` 0,10, så bredden er 1,00 × dims.
    - Noor II har `armLen` 0,05 og `plateD` 0,08, så dybden og bredden er 1,00 × dims.
    - NYMÅNE dobbel har `tilt` 65 i stedet for 60, så høyden er 1,12 × dims.
  - **Lorraine 90x120:** beholdt stående. Bohus' produktdata sier bredde 90 og høyde 120, selv om fotoet er liggende,
    og shapeNote forklarer dette. Til tuning hos RG.

### Steg 2–4 – forskningen flyttet inn, ærlighetssjekk, regenerering

- `check-research research/runde3 --build --claims=…` ga 0 FAIL og 28 WARN over 225 produkter i 15 filer. 220 av dem
  er verifisert.
- De 15 filene er flyttet til `research/catalog-new/`, og `research/runde3/` er fjernet.
- Ærlighetssjekk: to tilfeldige `verified: true` per fil, 30 produkter i alt, sjekket på nytt mot butikkene uten cache.
  - Bohus (15) med `bohus-probe --sku`, og IKEA, Jysk, Skeidar, Nordic Nest, Elektroimportøren og Lampehuset (15) med
    `pageprobe`.
  - Pris, kampanjepris, mål og URL stemte for alle 30. Ingen falsk `verified`.
- `normalize-data.mjs --only=catalog`: 597 produkter og 76 merknader, alle om produkter fra før (flytt, solskjerming,
  deler). Ingen arketype ble byttet og ingen montering endret for nye produkter. En ny kjøring ga ingen endring.

### Steg 5–7 – tall, tester og bygg

- Antall produkter per kategori, før → etter (+225, som summen av forskernes «+n»):

  | Kategori | Før → etter |
  |---|---|
  | sofa | 11 → 23 |
  | bord | 14 → 35 |
  | stoler | 8 → 30 |
  | tvbenk | 7 → 14 |
  | vitrineskap | 5 → 10 |
  | hylle | 11 → 22 |
  | nattbord | 10 → 22 |
  | kommode | 10 → 21 |
  | gang | 14 → 17 |
  | spotter | 0 → 37 |
  | smalamper | 34 → 61 |
  | tekstil | 24 → 31 |
  | kunst | 4 → 54 |
  | **Totalt** | **372 → 597** |

  Gulvlamper: 22 → 27.
- `EXPECT` i `tools/test-design.mjs` er oppdatert. `test-design`: 144 passed, 0 failed.
- `test-house` uten `QA_PARTIAL`: 28 av 28 filer ok, 1 625 enkeltsjekker og 0 feil. `wip/` er tom.
- `npm run build` ga exit 0. `check-build` ga exit 0 med 34 JS-chunker. Den største er `artImages` på 827 kB. Det er
  ingen nye advarsler, bare de 2 kjente `estimateShading`.
- Røyktest i spillet (5190): `allProducts().length` = 597, 24 kategorier, ingen konsollfeil.
- `check-ui-text`: ingen engelske UI-tekster. `smoke-import`: OK.

## 7. Nettleserkontrollene, steg 8–9 (før tuning-runden)

Alle på testserveren 5190 med `--lock`. Loggene ligger i `SP/work/integration/thumbs-8a.txt` og
`SP/work/integration/checks/checks-summary.txt`.

- **8a thumbcheck:** alle 24 kategorier (597 miniatyrer) og alle varianter av de 225 nye (377 miniatyrer, med
  butikkfoto) ga exit 0 og 0 harde flagg. Gjennomgangen av arkene fant likhetsfeil som tallene ikke fanger. Den viktigste
  var at miniatyrstudioet viste alt metall og speilglass nesten svart (42 av de 225 nye produktene, alle speil).
- **8b spotcheck** (alle steg, (e) med en ekte innfelt downlight på 40 %): 32 ok. Spottene lyser rommet sitt, ligger
  flatt i skråtaket og henger i riktig tak i bad, gang, soverom og kjellerstue. Antall shaderprogrammer er fortsatt 43.
- **8c artcheck** (alle moduser): OK. De 15 gamle bildene er piksel for piksel som før.
- **8d imagecheck:** 19 ok (last opp → last på nytt → eksport/import → bytt → angre → mangler).
- **8e pristine referanser:** `git archive c28070d` på egen server (5192, stoppet med sin PID). Golden-fila for de gamle
  bildene har samme sha256 (`1fabf836…5c80`) som `tools/fixtures/art-legacy-golden.json`. refcheck på 5190: 12 av 12
  innenfor støyen.
- **8f perf** (3 lastinger, 6 posisjoner, mot `SP/qa/perf-baseline.json`): draw calls og trekanter er identiske i alle
  6, frame-tiden er lik eller lavere, og første lasting har median 25,6 s mot 32,5 s. QA §5.2: bestått.
  Stresstesten (valgfri) hadde 283 draw calls ved spawn mot budsjettet 269. Rettet i tuning-runden (P02): nå 269.
- **8g dist-røyktest** (`vite preview` på 4191): 597 produkter, 24 kategorier, ingen konsollfeil.
- **9 check-ui-text:** ingen engelske UI-tekster.

## 8. Tuning-runden og sluttintegrasjonen (steg 10–11, integrator B, 2026-10-22)

**Tuning (steg 10).** Alle flaggede produkter gikk tilbake til eierne. Modelleierne la til nye, for det meste skjulte
parametre (standardverdiene gir samme modell som før), og forskerne justerte dataene sine:

| Eier | Resultat |
|---|---|
| P01 | «Fordel jevnt»: 5 cm-kanten er beholdt (LIGHT §5.1; den gjør at et fordelt rutenett aldri blokkeres av veggene), og kommentaren er presisert. Anillo Ø30: størrelsesglideren tar nå alltid med produktets egen størrelse. |
| P02 | 12 av 13 flagg rettet: veggspoten følger målene, deler med samme materiale tegnes som én mesh (stress 283 → 269 draw calls), bildelampens lys er en 57°-kjegle ut fra veggen, hvite dype reflektorer er lyse, firkantet trim rundt rund åpning, takkopp, skinnens tverrsnitt, to armer tett sammen. |
| P03 | Nye motivvarianter: hjort forfra, «drops» (Birds), sjø med strand, frie penselstrøk (Tay), spiralrosetter (Menor); strektegninger synes i bildevegger. |
| P04 | `matH` (passepartout oppe og nede), mattere malte rammer, Mittzon og Loke vises riktig i miniatyrene. |
| P05 | imagecheck tar bildene uten noe foran. |
| P06 | 35 flagg: bl.a. kryssfot (Ritz), dråpe- og V-form, brett-kant, skuffeenhet på føtter, delt rygg (Fia), kort sjeselongarm, rør og knagger på vegghylle (Stord, BERGSHULT), forskjøvne rom og dører (Rangoon, GADEHUSE), høye dører (HÖGBO, OXBERG), sprosser, liggende spiler, puteryggs-barkrakk (Zed) og «parsons»-rygg (Ella M). |
| P07 | Skallrygg på krakk (JANINGE, Sm 808), ny lounge-kontorstol (Vanilla, Nora), avrundede nettrygger, kraftige skallstolben, kafestolens rygg, Fontas, Bjerke. |
| P08 | Puffer med meier, ben utenfor trommelen, rundere firkantpuff, langhåret pels, flettet rotting; benk med rette ben; vegglamper (Noor, Kalle, Limotti, Stave/Abelone, Torino, Arum, Trysil med to skjermer, Milo, ÅRSTID) og Tolomeo. |
| P09 | Speilregel i thumbcheck, allow-liste per variant, raskere `models.test`, lampeledningen telles ikke med i målene. |
| RA–RG | Data rettet i egne filer (Lorraine liggende, 17 kunstflagg, Vanilla, Ella pall, Gotland, Vandborg, Wolin, Sandnes/Atmore, Signature, Isak, Charon, IDANÄS, Abelone, Ishida, Banker, Valencia, Flint …). |

**Sluttintegrasjonen (steg 4–9 og 11 på nytt):**
- **Dataene fra tuning-svarene** er lagt inn i forskningsfilene med ett idempotent skript
  (`SP/work/integration/final/apply-data.mjs`, sikkerhetskopier i `final/backup/`): 61 produkter. Det gjelder P02s
  verdier for RF, P06s for RA/RC/RD (Stord med rør og knagger som `wall-shelf`, ikke som knaggrekke), P07s og P08s for
  RB/RE, P03s motivvarianter og P04s `matH` for Rødalm, Lomviken og Helsinki (målt fra butikkenes åpning 39 × 49 /
  40 × 50 / 60 × 80 cm). Vanilla er tilbake på `lounge` (P07s nye bygger ligner mer enn RBs nødløsning).
- **`research-rules`:** alle de nye nøklene og verdiene er lagt inn i `CONTRACT`/`EXTENSIONS` (bl.a. `coffee-table.base
  'cross'`, `bar-stool.back 'pad'|'upholstered'`, `stool.back 'shell'`, `legMaxFrac` for kommode og nattbord, `matH`,
  `lensShape`, `canopyD`, `railW`, `armGap`, `plinthInset`).
- **Byggere, små rettinger:** `bookcase` frame-stil har nå skjult `brace: false` og `dividers: 'posts'` (Gotland: ingen
  kryss, stolper i midten); `floor-arc` har `baseShape: 'bullet'` (Arum arched' avrundede steinfot).
- **Husets egen hjørnesofa:** P06s 6 cm innrykk under sokkelen (for Tampa) endret hjørnesofaen i stua, og refcheck viste
  forskjeller i 9 av 12 visninger. Innrykket er nå en skjult `plinthInset` (standard 2,5 cm som før; Tampa 0,06), og
  refcheck er igjen 12 av 12 innenfor støyen. P06 nevnte også en mørk hyllebunn i husets nattbord (`f-sov-nattbord`);
  den er i samme svarte farge og synes ikke i noen referansevisning.
- **Miniatyrstudioet (`CatalogPanel.js`):** metall (metalness ≥ 0,5) og speilglass får en matt kopi av materialet bare
  mens miniatyren tegnes. Krom, stål, messing og speil ser nå ut som fargene sine i katalog, Inspector og handleliste;
  rommet er uendret. De 16 speil-oppføringene og Valencia «Krom» er fjernet fra `thumbcheck-allow.json`; der står nå
  bare det hvite berberteppet (v3).
- **Eldre kunst (`fixes.mjs`):** Ramor fikk mørk bakgrunn (som Bohus-fotoet), og Mara er nå vannrette penselstrøk
  (`brush-abstract` / `horizon`). `test-design` forventer det nye motivet for Mara.
- **Flint:** `spread` 28 (RF valgte 16, men da ble modellen 0,86 × bredden, og `models.test` krever 0,9–1,1 for skinner).
- **Inspector:** et param med `defaultFrom` viser verdien det følger når det ikke er satt (rammens `matH` viser `matW`).

**Revisjonstabell (hva er sjekket, og hvordan):**

| Område | Sjekk | Resultat |
|---|---|---|
| Eierskap | `git status` mot MASTER §3/§4.1 og F-øyeblikksbildet | alle stier hører hjemme (§6) |
| Forskningsdata | `check-research --build` over de 15 filene | 0 FAIL, 19 WARN (§9) |
| Ærlighet | 30 tilfeldige `verified: true` mot butikkene uten cache | 30 av 30 stemmer, 0 falske |
| Regenerering | `normalize-data --only=catalog` to ganger | 597 produkter, ingen endring ved ny kjøring |
| Antall | `QA_PRINT_EXPECT=1 test-design` mot forskernes «+n» | 372 → 597 (+225) |
| Husets stue | refcheck mot pristine c28070d | 12 av 12 innenfor støy, `state.json` lik |
| Gamle bilder | artcheck legacy mot golden (sha256 lik pristine) | 15 av 15 uendret |
| Ytelse | perf mot QA-baselinen | bestått (§7) |

## 9. Sluttstatus og overlevering (2026-10-22)

**Porten (alt grønt):**
- `node tools/test-design.mjs`: 144 passed, 0 failed.
- `node tools/test-house.mjs` (uten `QA_PARTIAL`): 28 av 28 filer ok, 0 feil. `wip/` er tom.
- `node tools/smoke-import.mjs`: OK.
- `npm run build`: exit 0. `node tools/check-build.mjs`: exit 0, 34 JS-chunker, største `registry` 866 kB, bare de 2
  kjente advarslene.
- `node tools/check-ui-text.mjs`: ingen engelske UI-tekster.
- `check-research` over de 15 filene etter regenereringen: 0 FAIL og 19 WARN: 8 butikkmål utenfor glidebryterne (Celma,
  Limotti, VIDJA, Fia, Anillo, Rigel), 4 byggergrenser (Drape- og Josh-settene, NYMÅNE 4 og Pluto med takkopp), 2 runde
  nattbord som coffee-table (riktig etter D9) og 5 `verified: false`.

**Nettleserkontrollene etter tuningen** (5190, `--lock --step=final`, alle exit 0):
- thumbcheck, alle 24 kategorier: 597 miniatyrer, 0 flagget, 0 konsollfeil (`.shots/final/thumbs-all/sheets/`).
- thumbcheck, de 225 nye med alle varianter og butikkfoto: 377 miniatyrer, 0 flagget (`.shots/final/thumbs-new/sheets/`).
- thumbcheck, speil, bad, taklamper, akustikk og tepper med alle varianter: 217, 0 flagget; sofa: 100, 0 flagget.
- spotcheck: 32 ok, 0 feilet (`.shots/final/spotcheck/`). artcheck legacy + catalog: OK. imagecheck: 19 ok
  (`.shots/final/imagecheck/`). refcheck: 12 av 12 innenfor støyen.

**Mangler / kjente begrensninger**
- Ingen unntak fra minstekravene (D43): alle nye arketyper er i bruk, og det er 3 bildelamper (minst 2).
- Lysbudsjett: i den åpne stua deler kjøkken, spisestue, stue og TV-stue ett budsjett. På «Middels» får de to beste
  spotgruppene ekte lys, på «Høy» tre; resten lyser som omgivelseslys, og Belysning sier ifra.
- Den første spoten eller det første bildet du legger inn, kan hakke et øyeblikk (nye shaderprogrammer, D31).
- Ingen lysflekker på gulvet under downlights.
- Spotter gjennom et spilepanel i taket støttes ikke.
- Spottene på en skinne kan ikke vinkles hver for seg, og enkeltspotter kan ikke samles til et rutenett igjen.
- «Fordel jevnt» holder 5 cm ekstra avstand til veggene (med vilje).
- Bildelampens lys på bildet er en jevn «vask»; spotlyset fra lampen lyser ned i rommet, og setet under kan bli
  litt lysere.
- Egne bilder: ingen «Slett bilde» (ubrukte bilder ryddes etter 14 dager), utsnittet kan ikke flyttes (beskjæres fra
  midten), egne bilder i enkeltrammer i en bildevegg kan bare settes i data, et privat vindu husker bildene bare til fanen
  lukkes, HEIC fra iPhone avvises, og eksportfila blir ca. 0,5 MB større per bilde.
- Bildevegger: struktur/relieff vises som lerret, og ny farge endrer bare bildene som følger settets palett.
- Plakatheng: snoren går 12 cm over bildet og er ikke med i målene.
- Byggergrenser som gjør at noen produkter ligner mindre: Nola sofabord har for lang fot, Fia har runde armlener (ikke
  utsvingte), Ishida mangler ribbene og de tre kulefotene, bankerlampens fot er
  rektangulær, Valencia vegglampe mangler ringene, Flint-platen er litt mindre enn
  butikkens.
- Stoler og bord (fra pakkene): armlener på barkrakk er et bredere skall, firkantede bord har alltid fire ben, hev-senk-
  skrivebord vises i én høyde, en krakk uten rygg har setet på full høyde, stoler med tynne metallben og trerygg har
  ingen bakstolper (gammel feil).
- Spotter sett fra siden i katalogbildene viser ofte ikke linsen; hvite skinner og tynne gulvlamper blir små i
  miniatyrene.
- Ikke modellert: U-sofa, hjul på hvilestoler, leselamper med flere spothoder, vegglampe med egen lesearm.
- Ikke verifisert (butikken mangler et mål, anslått fra bildet): Stave vegglampe, ÅRSTID, BÄVE, Namron Pluto og Namron
  Rock. Anslått: Plejd 2700 K, Hue Centura 350 lm.

## 10. Gjennomgangen og rettingene (port-agenten, 2026-10-22)

Motgjennomgangen fant 35 funn; alle er rettet av områdeeierne (lys, spotter/rutenett, bilder, UI, kunst, møbler, data,
verktøy). Port-agenten koblet inn det som gikk på tvers:
- **Inspektøren:** «Rygg» og «Armlener» på benk, krakk og barkrakk holder setet der det var og gjør møbelet høyere
  (modellenes `paramPatch`, i samme angresteg). «Passepartoutbredde» viser bredden som faktisk tegnes (9 % av korteste
  side når den ikke er satt; `defaultFor`), og «over og under» følger den.
- **Roter 15° og R / Shift+R:** en vending som ikke får plass (et langt rutenett gjennom veggen) avvises med «Får ikke
  plass rotert her», slik rotasjonshåndtaket alltid har gjort. En ting som allerede står fast kan fortsatt vendes.
- **Sofabordsett** (Dråpe, Josh): nye får `setRef` = produktets mål, så settbordene følger med når hovedbordet endres.
- Nye tester: `inspector-hooks.test`, ALEX- og Gustin-sjekker i `catalog-round.test`.

**Porten etter rettingene:** test-design 144/0, test-house 31/31 filer (strengt), smoke-import OK, check-build OK
(34 chunker, største 868 kB, bare de 2 kjente advarslene), check-ui-text ren, check-research over research/catalog-new
0 FAIL / 25 WARN, normaliseringen på nytt gir ingen forskjell (24 filer). Nettleser på 5190: thumbcheck 597/0 flagget,
spotcheck 32/0, artcheck legacy+catalog+custom OK, imagecheck 19/0, refcheck 12/12 innenfor støy og `state.json` lik.

**Kjent etter gjennomgangen:**
- Underkategorien «Takspotter» har både enkeltspotter og spotplater (som MASTER §2.1 sier); ◀ ▶ på et rutenett viser
  bare produkter som kan bli rutenett.
- Tak over trappehullet i 1. etasje er fortsatt sperret for takting («Over trappehullet»), selv om gangens tak er der.
- Gustin er en labyrint, ikke butikkens rutenett av små firkanter, og mangler den hvite kanten.
- LISABO stol har førpris i notatet, men ikke «Tilbud»-merket (gammelt produkt, ikke endret).
- Skap: rammede fronter, grepsspor i korpusfarge, knotter på skyvedører og rotting på dype skuffer er bevisste endringer
  fra tuningen – eieren bør se på dem.
- Et bilde lagret på denne grenen med motiv «Eget bilde» uten bilde viser «Tåkete trær» i motivlisten.
- «Passepartoutbredde» vises også på lerret uten ramme, der det ikke tegnes noe passepartout (som før).
