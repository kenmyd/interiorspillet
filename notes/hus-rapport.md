# Hele huset – nattrapport

## Bølge 0 «Grunnmur»

**Status:** Alle seks stegene i bølge 0 er flettet inn i `hele-huset` (HEAD 5e06ba9, 19 commits over master). Ingenting er
pushet eller deployet, og ingen arbeidstrær er slettet. Testene ble kjørt på nytt da rapporten ble skrevet, og alle er grønne:
- `node tools/test-design.mjs`: 99 bestått. Planen sa 98, men steg 3 la til testen for byte-identisk regenerering.
- `node tools/test-house.mjs`: 5 av 5 testfiler bestått (data, fixture-v1, layout, move og stub).
- `vite build` til en mappe utenfor repoet går gjennom.

Etter siste fletting var 12 av 12 referansebilder av stua innenfor støyen, og dumpen av lys og akustikk var identisk.
GPU-låsen er ledig.

Spillet viser fortsatt bare stua. Bølge 0 er grunnmuren under det nye, og de nye rommene kommer i bølge 1.

### Hva som virker nå
1. **S0-git:** grenen, planen, fakta-fila, fotonotatene (c4ee266) og avstemmingen (b0fac4e) er committet.
2. **S0-test:**
   - testserver uten HMR (`tools/vite.test.config.mjs`, med egen cache i `.shots/.vite`);
   - felles GPU-lås og skjermbilder med faste steg;
   - `tools/refcheck.mjs`, som kjører hele regresjonen for stua i én kommando;
   - referansene ligger i `.shots/hus/ref/`;
   - v1-fixture for lagring;
   - nye dev-parametre: `?doors=open|closed|<id>` og `?nohelp=1`.
3. **S0-data:** normaliser og validator for hele huset (`src/data/scripts/house.mjs` og `research/house/00-*.json`).
   `room-spec.json` regenereres byte-identisk.
4. **S0-layout:** `layout.house` med nivåer, rom, `levelAt` (med hysterese) og `roomAt`. De gamle feltene gjelder bare stua.
5. **M1:** snap ned skjer nå i tolv deler. Node-testene ga 381 bestått og 0 bilder i lufta på 30, 60 og 144 Hz. I
   nettleseren ga terskelen til terrassedøra heller ingen bilder i lufta.
6. **S0-stub:** tomme byggere (`rooms.js`, `stairs.js`, `builtins.js` og `visibility.js`) med en felles returkontrakt,
   slått inn i `home.*`.

### Ikke flettet
- Alle stegene i bølge 0 er flettet.
- Katalogen (`worktree-katalog-hele-huset`) hører ikke til bølge 0. Den har nå to commits (93c323d og 5652930) og et rent
  arbeidstre, men er ikke flettet inn i `hele-huset`. Den venter på at katalogsesjonen blir ferdig.

### Avvik fra planen
1. **Snap i 12 deler, ikke 4 (§3.2).** Med 4 eller 8 deler kom det et dytt framover langs sidevegger og på kiler fra 48°,
   opptil 5,5× fart på 144 Hz. Nå er grensen 49°.
2. **Romlys går til `home.house.builtInLights`.** Lysene fra de nye byggerne havner der, ikke i `home.builtInLights`, fram
   til steg 13 (L1). Ellers ville lys fra nye rom startet på full dimmer i lyspuljen til stua.
3. **D6 er alltid feil.** For lite fri bredde forbi et åpent dørblad gir feil i validatoren, ikke bare for målte dører.
4. **Hjelpefiler utenfor fillista:** `tools/lib/hus.mjs`, `tools/refcheck.mjs`, `tools/house-tests/_lib.mjs` og
   `tools/house-tests/fixture-v1.test.mjs`.
5. **`house-mini.json` er et overlegg** på `room-spec.json`, ikke en hel spec.
6. **To commits per steg for steg 3 og 5.** De ble flettet med `--no-ff` og ikke slått sammen, mens §0 sier «én commit per
   steg».
7. **Rettet av integratoren etter flettingen:**
   - arketype-alias og nye oppføringer uten `roomId` gir nå feil;
   - kjellerens `floorY` er −2,55 (D2);
   - GPU-låsen fjernes bare av eieren;
   - `buildShell` returnerer `materials`.
8. **Avstemmingen kom etter bølge 0.** `notes/hele-huset-avstemming.md` (V1–V70) overstyrer planen der de er uenige. Det
   meste den krever av steg 3 og 4, virker allerede: opptrinnet regnes fra `risers`, `floorOffset` virker per rom, og
   `pxPerM` kan være et tall. To ting står igjen og må gjøres før trappa bygges (steg 18–19):
   - sjekken i validatoren om at trinn og vange står minst 0,05 fra dørkarmen, med en dårlig fixture;
   - layout-testen bruker fortsatt føttene på −0,18, ikke −0,20.

**Kjente svakheter:**
- **Orbit-bildene** rammes av og til inn annerledes (30–44 % endrede piksler). Det gjaldt også før bølge 0. Steg 15 skal
  gjøre innrammingen fast.
- **Terrassetrappa** er en solid boks i dag, så M1 er ikke testet over den i nettleseren. Det gjøres i steg 25.
- **Gangen** kan ikke nås fra stua før gulvstripa i dørhullet kommer i steg 8. I `door-gang` synker kapselen 0,134 m.

### Hva du bør teste og måle
1. **Stua på 5180.** Hovedmappa står på `hele-huset`, så siden viser bølge 0 etter en omlasting.
   - Gå rundt. Føles gangen som før, og er det ingen dunk eller rykk ved terskelen til terrassedøra?
   - Etterklangen skal fortsatt være RT60 0,86 s (volum 138,57 m³ og gulv 53,78 m²), og lyset skal være som før.
   - Lagrede design skal laste som før, og foto-sammenligningen skal se lik ut.
2. **Dev-parametrene:** prøv `?doors=open`, `?doors=closed` og `?nohelp=1`.
3. **De fem viktigste målene** fra avstemmingen §7, som avgjør flest tall:
   1. Den innvendige trappa: antall opptrinn (nå 13) og høyden på ett.
   2. Antall trinn i terrassetrappa.
   3. Bredden på ytterdørelementet (nå 2,0) og bladbredden.
   4. Kjelleren øst–vest: kjellerstua (nå 6,06) og vaskerommet (nå 3,90, planen sier 4,08).
   5. Står sørveggen i kjellerstua ca. 0,33 inn under stua, eller i flukt? Ta gjerne et bilde.

**Neste:** bølge 1 (steg 7–10), med data og bygging av bad, gang og soverom.

## Bølge 1 «Hele huset: data, bygg og helhet»

**Status:** Spillet viser nå hele huset. Planens steg 7–29 ble slått sammen til 15 leveranser, og alle 15 er flettet inn i
`hele-huset` i stegrekkefølge, i tre grupper. Etter hver gruppe rettet integratoren det som dukket opp (e529895, f246311,
94989fd, 9f4409a, 697d06f og 99fc3fd). Siste kode-commit er 99fc3fd, som er tagget `hus-milepael-natt`. Grenen ligger 70
commits over master. Ingenting er pushet eller deployet, og ingen arbeidstrær er slettet. 14 av stegene er helt ferdige.
Lyssteget (13+27) er flettet, men holder ikke hele ytelsesbudsjettet (se avvik 2).

Testene ble kjørt på nytt da rapporten ble skrevet, og alle er grønne:
- `node tools/test-design.mjs`: 111 bestått (99 etter bølge 0).
- `node tools/test-house.mjs`: 20 av 20 testfiler bestått.
- Normaliseren lager `room-spec.json` byte-identisk. Validatoren gir 0 feil og 2 advarsler: hullene til `door-bod-1` og
  `door-bod-3` går litt utenfor baksideflatene.
- `vite build` til en mappe utenfor repoet går gjennom. Den eneste advarselen (ShoppingPanel.js) finnes også på master.
- `tools/refcheck.mjs` etter siste fletting (kjørt av integratoren): 9 av 9 bilder av stua er innenfor støyen, og dumpen
  av lys og akustikk er identisk. Orbit og plan er ikke med, fordi de nå viser hele etasjen (§7.1).

GPU-låsen er ledig, og integratorens testserver på 5250 er stoppet.

### Hva som virker nå
1. **Data (steg 7, 12+31i og 18+23):** 13 rom på to nivåer i `research/house/`. Avstemmingen V1–V70 er fulgt.
   - 1. etasje: stue/kjøkken som før, bad, gang og soverom.
   - Kjeller: kjellergang, vaskerom, soverom, kjellerstue, entré og tre boder.
   - Trappa og hullet ligger i `20-trapp.json`, og ute ligger i `35-ute.json`.
   - Arealene er innenfor ±5 % av eierens tall, unntatt entréen (−6,5 %) og bod-1 (−8,7 %).
   - Alt som ikke er målt, er merket `estimated` og står på den genererte målelista i `research/room-spec-notes.md`.
2. **Bygg (steg 8+21+24, 10+24b og 19):**
   - Vegger, gulv, tak og vinduer bygges for alle rom. Dekket har trappehullet, og kjelleren har sine egne tak. Baksidene
     av stuas vegger gjenbrukes (D13).
   - Alle innerdørene er med. Bodene er lukket, men kan åpnes. Ytterdøra er interaktiv og slår ut, og `door-gang` åpner
     180°.
   - Badet har steinplater, femkantdusj, vegghengt WC, servant og rundt LED-speil. Vaskerommet har benk, skaprad,
     vaskemaskin og tørketrommel.
   - Trappa er halvsvingt med 13 opptrinn à 0,196. Den har åpne opptrinn, eiketrinn, svarte vanger, rekkverk og
     håndløper med LED.
3. **Innredning (steg 12+31i):**
   - Soverommet oppe har seng, nattbord, garderobe og knaggrekke.
   - Kjellerstua har TV og to lenestoler, og soverommet i kjelleren har bokhylle.
   - Entréen har stumtjener og matte, og vaskerommet har speilskap.
   - Gangen oppe er tom, slik notatet sier. Rot er ikke modellert.
4. **Ute (steg 25):**
   - Forplassen, reposet, stien og gangveien ligger på −2,87, med heller og grus.
   - Terrassetrappa har 16 opptrinn og kan gås.
   - Nisjen ved ytterdøra har himling, downlights og pilar.
5. **Bevegelse og start (steg 20 og 9+26):**
   - Kollisjonen har nivåer. Trappa kan gås opp og ned på 30, 60 og 144 Hz, og respawn og trygt punkt virker på alle
     nivåer.
   - HUD-en viser rommet og etasjen («1. etasje», «Kjeller» eller «Ute»).
   - Første besøk starter ute på forplassen foran ytterdøra, og det gjør også «Start med stua slik den er i dag».
     «Fortsett» og «Gå inn i stua» starter der du sist sto.
6. **Lys (steg 13+27):**
   - Hvert rom har sitt eget lys. Lysmasker hindrer lys i å lekke gjennom vegger, og lyset går bare gjennom åpne dører
     og trappehullet.
   - Hvitbalanse og eksponering følger rommet kameraet står i, og sol og skygge virker i begge etasjer.
   - Lyspanelet er gruppert per rom. Stua regnes nøyaktig som før.
7. **Editor og paneler (steg 14+15+28+17):**
   - Oversikt og plan viser én etasje om gangen. Du bytter med knappen «Etasje», PgUp/PgDn eller
     `?view=plan&floor=kjeller`.
   - Møbler kan plasseres i alle rom. Trappehullet, trappefoten og dørslagene er sperret.
   - Vinduslista og fotosammenligningen er gruppert per rom. Rom med samme navn får etasjen bak («Soverom (kjeller)»).
8. **Akustikk (steg 16):** etterklangen regnes per rom, og stua beholder 0,86 s. Designet er nå versjon 2, med høyde
   per etasje. Gamle lagringer lastes som før.
9. **Synlighet (steg 29):** den andre etasjen og innholdet i rom du ikke ser inn i, skjules. I gangen er det 76
   tegnekall, mot 212 ved spawn i master.
10. **Testverktøy (steg 22+26t):**
    - `tools/tour.mjs --tour=all --hz=30,60,144` kjører ni turer. Én av dem er ute-inn: forplassen → ytterdøra →
      entréen → trinnene → kjellergangen → trappa → `door-gang` → stua.
    - `tools/walkmap.mjs --preset=hus` dekker begge etasjene.
11. **Katalogen (steg 11):** katalog-grenen er flettet inn. Den har 338 produkter i 22 kategorier og 18 nye modeller.

### Ikke flettet
- Alle stegene i bølge 1 er flettet.
- Bølge 5 er ikke startet. Det gjelder steg 30 (P0, fotoindeks) og steg 31 (P1–P7, fototilpasning). Bare innredningen
  (31i) ble tatt med i steg 12.
- Katalog-grenen har fått to nye commits etter flettingen i steg 11: 2bac3bf og 3be94bf, med nye lenestoler og en
  fargerevisjon. De er ikke i `hele-huset`. Katalogsesjonen jobber fortsatt i sitt arbeidstre, så de bør flettes senere.
- `tools/prep-images.py` er oppdatert, men ikke kjørt, fordi python ikke finnes på maskinen. Fotosammenligningen
  mangler derfor bildene av de nye rommene i `public/img/foto-hus/` (gitignorert).

### Avvik fra planen
1. **Avstemmingen styrer tallene.** Trappa har 13 opptrinn à 0,196 (V12–V23), ikke planens 14 à 0,182 (D2).
   Ganglinja er 2,87 m, stigningen er 39,3°, og minste frie høyde er 2,25.
2. **Ytelsen holder ikke helt (steg 13+27, delvis):**
   - Med warm-up av katalogen tar første lasting +5,1 s mot `lm=0`, og grensen er +3 s. Før rettingen var det +57 s.
     Uten warm-up er det +2,6 s.
   - Hele huset laster på ca. 25 s, mot 19,7 s i master. Det er det samme med `?vis=0`, så årsaken er flere programmer
     og byggere, ikke synligheten. Det er ikke rettet. `Game._precompile` og byggerne bør profileres.
3. **`?play=1` starter fortsatt i spisestua, ikke ute.** Referansebildene, turene, walkmap og dumpen bruker den. Bruk
   `?spawn=outside|saved|inside|fresh` for å velge start.
4. **Oversikten i 1. etasje** får ikke `setOverviewLevel('hoved')`, men null. Med 'hoved' ble soverommet og badet nesten
   svarte.
5. **Smale dører** (smalere enn 0,85, i dag bare `door-bod-1`): de synlige sidekarmene kolliderer ikke. Bare de
   ytterste 2 cm har usynlige bokser, så du kommer inn i boden med bladet åpent.
6. **Terrassedekket** går ut til x 10,35 over hele bredden, helt til z 6,75. Dataene og V9 sier z −0,30 … 6,0, men
   fotoprojeksjonen viser at skjermen og rekkverket går helt til hjørnet.
7. **Kollisjonen:**
   - `Collision.faceGround` (ny i M2) gir skrå, gangbare flater sin egen normal. Uten den dyttet trappekilen spilleren
     i svingtrinnene.
   - Etter flettingen av gruppe 2 hang spillet på «Møblerer», fordi kollisjonsoktreet delte seg nesten uendelig.
     94989fd stopper delingen ved 4 cm og hopper over trekanter med null areal. Kollisjonen for hele huset bygges nå på 0,3 s.
8. **Validatoren:** et rom som er registrert, men ikke modellert ennå, ga advarsel mens stegene gikk parallelt. Nå krever
   `data.test` at ingenting står igjen som ventende.
9. **Akustikk i andre rom** er anslått ut fra flatene og ikke kalibrert mot bilder, slik stua er. `acousticsFor` ligger i
   `Acoustics.js`, fordi `Editor.js` ikke var stegets fil.
10. **Testfiler utenfor fillistene:** `hud-start`, `design-v2`, `collision-build` og `tour-routes` (`*.test.mjs`) og
    `_tours.mjs`. `layout.test` og `stub.test` er justert, slik at de tåler rom og trapp fra de andre stegene.
11. **Ingen tagger for milepælene A, B og C.** Stegene ble slått sammen, så det er bare én tagg: `hus-milepael-natt`.

**Kjente svakheter:**
- **Tynne sprekker** på 5–6 px i noen vinkler i kjellergangen og ved den åpne entrédøra. De hører hjemme i
  `stairs.js` og `rooms.js`.
- **Lastetiden** er ca. 25 s (se avvik 2).
- **Orbit- og plan-referansene** viser fortsatt bare stua. De må lages på nytt når du har godkjent bølgen (§7.1).

### Hva du bør teste og måle
1. **Last siden på 5180 på nytt.** Hovedmappa står på `hele-huset`.
   - Velg «Start med stua slik den er i dag», eller bruk `?play=1&spawn=outside`, så starter du ute.
2. **Gå ute-inn-ruta selv:** forplassen → ytterdøra (E) → entréen → de to trinnene → kjellergangen → trappa opp →
   `door-gang` → stua.
   - Føles trappa riktig?
   - Står du fast noe sted, eller rykker det i svingtrinnene?
   - Gå også ned terrassetrappa.
3. **Rommene:** se på badet og soverommet oppe, kjellerstua, soverommet i kjelleren, vaskerommet og de tre bodene.
   - Stemmer farger og overflater?
   - Mangler noe, eller står noe feil?
4. **Lyset:**
   - Prøv kveld og natt, og lyspanelet per rom.
   - Lekker lys gjennom vegger eller dekket?
   - Er kjelleren mørk når lyset er av?
5. **Editoren:**
   - Bytt etasje i oversikt og plan.
   - Sett et møbel på soverommet og i kjellerstua, og se på etterklangen der.
6. **Stua uendret:**
   - RT60 skal være 0,86 s, og lyset og bildene skal være som før.
   - Lagrede design skal laste som før.
7. **Lagret posisjon:** stå i kjelleren og last på nytt. Starter du der?
8. **Lastetiden:** føles 25 s for lenge?
9. **Mål (avstemmingen §7).** Punkt 1–5 avgjør flest tall:
   1. Den innvendige trappa: antall opptrinn (nå 13) og høyden på ett.
   2. Terrassetrappa: antall trinn (nå 16).
   3. Ytterdørelementet: bredden (nå 2,0) og bladbredden.
   4. Kjelleren øst–vest: kjellerstua (nå 6,06) og vaskerommet (nå 3,90, planen sier 4,08).
   5. Sørfasaden under stua: står kjellerstuas sørvegg ca. 0,33 inn under stua, eller i flukt?

   Deretter følger hullet oppe (nå 1,45, 1,54 og 1,85), trappefoten (nå 1,60), entrétrinnene (nå 0,15), takhøydene
   (nå 2,25 og 2,40) og dørbreddene. Hele lista står i avstemmingen §7 og i `research/room-spec-notes.md`.
10. **Spørsmål:**
    - Hva heter de tre bodene?
    - Skal «Alle på/av» gjelde hele huset eller bare rommet du står i?
    - Kan bildene fra soverom og bad ligge i `public/img/foto/`? Da havner de i git og på Railway.
    - Er gulvlistene oppe lys eik eller hvite (V50)?
    - Er kjellertaket hvitt eller SAND (V67)?

**Det som står igjen:**
- Mål og svar fra deg.
- Fletting av katalogens to nye commits.
- Profilering av lastetiden.
- Nye referanser for orbit og plan.
- Bølge 5 (fotoindeks og fototilpasning per rom).
