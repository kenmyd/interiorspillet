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
