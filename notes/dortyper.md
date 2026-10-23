# Dørtyper i husformatet

2026-10-22. Dobbeltdør, skyvedør, glassfelt og sidefelt i spillets motor (planbyggerens forespørsel 7 og eierens
F17, F27, F31, F38, F39, F48, F49 og F50). Alt nytt er valgfrie felt i `door:{…}` på en åpning med `type: 'door'`.
Uten de nye feltene bygges døra nøyaktig som før, i den gamle koden.

**Kode**
- `src/world/Door.js`: slagdør. Ny dobbeltdør med ulike blad (`splitX`) og valgfritt aktivt blad (`activeLeaf`).
- `src/world/SlidingDoor.js` (ny): skyvedør med samme API som `Door` (E, lyd, kollisjon, stopper mot figuren).
- `src/world/FoldingDoor.js` (ny): foldedør. Den arver fra `SlidingDoor`, og hvert ledd dreies og flyttes.
- `src/home/doortypes.js` (ny): bygger de nye typene. `doors.js` `buildDoor` sender en dør hit bare når den har
  `variant: 'double' | 'sliding' | 'folding'`, `glass` eller `sidelights`.
- `src/data/scripts/house.mjs` `validateHouse`: sjekker feltene, plassen en skyvedør trenger, og at figuren kommer gjennom.
- `src/home/visibility.js`, `src/design/Placement.js`, `src/design/ViewModes.js`: skyvedører har ingen slagbue,
  dobbeltdører får to.

2026-10-23: garasjeport (leddport og vippeport, planbyggerens forespørsel 11), overlys over ytterdøra, smal glasstripe i
bladet, forbiløpende skyvedør (garderobe) og teleskop-skyvedør (eierens F138), flere sidefelt på samme side (dør i
glassvegg). Se 2, 4, 5 og 6. Bygget på grenen `claude/hungry-mendeleev-b747e9`, som ikke er godkjent inn i master ennå.
`src/world/GarageDoor.js` (ny) er garasjeporten; testhuset har fått en garderobe, og `dev/fasadetyper.html` viser
dørene i et hus med kledning (se `notes/vindusmodeller.md`, «Fasadetypene»).

**Test:** `node tools/house-tests/doortypes.test.mjs` (eller `node tools/test-house.mjs doortypes`). Testsiden
`/tools/dortyper/index.html` på en testserver viser testhuset (`tools/dortyper/testhus.mjs`) med alle typene. Der kan
du gå med WASD, åpne med E eller se huset i dukkehus.

---

## Felles regler

- **Hullet** (`offset`, `width`, `height`) og **karmen** (`frame.width`, `frame.depth`, `frame.color`) er som før.
  En ny dør får karmen 2,5 mm innenfor hullet på alle sider, så ingen flate ligger i samme plan som smygen.
- **`hinge`** (`'from'` | `'to'`): karmen ved veggens `from`- eller `to`-ende, som før.
- **`swing`** (`'in'` | `'out'`): `'in'` = inn i eierveggens rom (forsiden), `'out'` = mot det andre rommet eller ut.
  For en skyvedør på skinne betyr det hvilken veggflate bladet henger på. `opensInto` følger `swing` som før.
- **Bladhøyden** er `leaf.h` (standard: hullets høyde − `frame.width`).
- **Ytterdør**: en vegg med `exterior: true` og tykkelse ≥ 0,2. Den får ytterbladet (6 cm, antrasitt) og
  aluminiumsrammen ved ytterflaten.
- **Den frie åpningen** gjennom en åpen dør må være minst **0,62 m** (figuren har radius 0,3). Validatoren gir feil
  ellers. For en slagdør regnes karmene, sidefeltene og ca. 5 cm per åpent blad bort. En skyvedør på skinne gir hele
  bredden mellom karmene, og en lommedør den samme bredden minus grepet på 2,5 cm per blad. En patio gir halve
  åpningen.

---

## 1. Dobbeltdør – `variant: 'double'`

To blad i ett hull, hengslet i hver sin karm, uten midtstolpe.

| felt | standard | betydning |
|---|---|---|
| `leaf.w` | halve bredden | bladet på `hinge`-karmen |
| `leaf2.w` | som `leaf.w` | bladet på den andre karmen |
| `active` | det bredeste (likt: 1) | `1` = `leaf`, `2` = `leaf2`. Det aktive bladet har håndtaket og en dekklist over møtekanten. Det andre har kantskåter. |
| `swing`, `openAngleDeg` | `'in'`, 90 | gjelder begge bladene |

Bladene **fyller alltid** bredden mellom karmene. `leaf.w` og `leaf2.w` gir bare forholdet mellom dem, så tall rett fra
tegningen (radiusene på slagbuene) kan brukes. Validatoren varsler når summen avviker mer enn 5 cm fra bredden mellom
karmene, og gir feil når den er bredere enn hullet.

```json
{ "id": "door-stue-1", "type": "door", "offset": 1.8, "width": 1.5, "height": 2.1, "sill": 0,
  "frame": { "color": "#1d1e21", "width": 0.06, "depth": 0.02 }, "connects": ["gang", "stue"],
  "door": { "variant": "double", "hinge": "from", "swing": "out", "opensInto": "stue",
            "leaf": { "w": 0.69, "h": 2.03 }, "leaf2": { "w": 0.69 }, "glass": { "cols": 2, "rows": 4 } } }
```

En 1,5-fløyet dør: `"leaf": { "w": 0.8 }, "leaf2": { "w": 0.4 }`.

## 2. Skyvedør – `variant: 'sliding'`

Blad som skyves langs veggen, uten slagområde. Åpnes med E som de andre. `hinge` trengs ikke.

| felt | standard | betydning |
|---|---|---|
| `mount` | `'surface'` i innervegg, `'patio'` i yttervegg | `'surface'`: utenpåliggende på skinne. `'pocket'`: inn i veggen. `'bypass'`: forbiløpende (garderobe), to blad foran hullet. `'patio'`: glass-skyvedør i ramme. |
| `leaves` | 1 | `'surface'`: 2 eller 3 gir en teleskop-skyvedør (bladene på hver sin skinne, stablet ved siden av hullet når den er åpen). |
| `slide` | `'from'` | retningen bladet går når det åpnes: mot veggens `from`- eller `to`-ende, eller `'both'` (to blad som går fra hverandre; ikke for patio) |
| `swing` | `'in'` | `'surface'`: veggflaten bladet henger på |
| `glass` | ingen (patio: `true`) | glassfelt i bladet/bladene, se 5 |

- **`surface`**: Bladet dekker karmen og 2 cm til. Det henger 3 cm ut fra veggen, i en skinne over hullet (til
  hullets topp + 0,1). Åpent står det på veggen ved siden av hullet. Veggen trenger hullets bredde + 0,08 fri på den
  siden. Hvis det går over en annen åpning eller forbi veggens ende, gir validatoren en advarsel, og den advarer også
  hvis skinna går over veggen.
- **`pocket`** (lommedør): Bladet går midt i veggen og forsvinner inn i den gjennom en spalte i karmen. 2,5 cm blir
  stående igjen som grep. **Hullet er bare passasjen. Lomma er vanlig, tett vegg i dataene**: ingen åpning der, bare
  veggstykket ved siden av hullet på `slide`-siden. Motoren legger bladet inn i det veggstykket. På en tegning der
  lomma ser ut som et hull nummer to (F65), skal det hullet bli vegg. Validatoren gir **feil** når lomma (hullets
  bredde + 0,04) går over en annen åpning eller forbi veggens ende, og når veggen er tynnere enn 0,08.
- **`bypass`** (forbiløpende, garderobe): To blad på to spor foran hullet på `swing`-siden, under en skinne over
  hullet. Åpen går det ene bladet foran det andre, så veggen ved siden av hullet trengs ikke. `slide: 'from'`: bladet
  i `to`-enden går mot `from`. Åpningen blir halve hullet (`width / 2 − frame.width − 0,02`), så figuren trenger et hull
  på minst ca. 1,4 m. `slide: 'both'` gir feil.
- **Teleskop** (`mount: 'surface'`, `leaves: 2` eller `3`): bladene overlapper 4 cm og går på hver sin skinne. Åpen
  står de stablet ved siden av hullet. Veggen trenger bare (hullets bredde + 0,04 + 0,04 · (n − 1)) / n − `frame.width`
  + 0,04 ved siden av hullet, altså litt over halvparten (to blad) eller en tredel (tre blad) av det et vanlig skinneblad
  trenger. Hele åpningen blir fri.
- **Når veggen er for kort** for skinnebladet, varsler validatoren og sier hva som får plass: en teleskop-skyvedør (med
  lengden den trenger) eller, når hullet er bredt nok, en forbiløpende.
- **`patio`**: Aluminiumsramme ved ytterflaten med lav terskel. Et fast glassfelt står på det ytre sporet, og et
  skyvbart felt på det indre sporet (romsiden) går foran det faste. `slide: 'from'` betyr at feltet i `to`-enden går
  mot `from`. Åpningen blir halve rammen − 3,5 cm.

```json
{ "id": "door-gang-2", "type": "door", "offset": 5.0, "width": 0.95, "height": 2.1, "sill": 0,
  "frame": { "color": "#1d1e21", "width": 0.06, "depth": 0.02 }, "connects": ["gang", "stue"],
  "door": { "variant": "sliding", "mount": "surface", "slide": "from", "swing": "in", "opensInto": "gang" } }
```
```json
"door": { "variant": "sliding", "mount": "pocket", "slide": "to" }
```
```json
"door": { "variant": "sliding", "mount": "surface", "slide": "both", "swing": "out", "opensInto": "stue", "glass": { "rows": 3 } }
```
```json
"door": { "variant": "sliding", "mount": "bypass", "slide": "from", "leafColor": "#e9e6df" }
```
```json
"door": { "variant": "sliding", "mount": "surface", "slide": "from", "leaves": 2 }
```
```json
{ "id": "door-stue-ute", "type": "door", "offset": 1.0, "width": 2.4, "height": 2.15, "sill": 0,
  "frame": { "color": "#25272b", "width": 0.05, "depth": 0.06 }, "reveal": { "depth": 0.2, "color": "#1d1e21" },
  "connects": ["stue", "ute"], "door": { "variant": "sliding", "mount": "patio", "slide": "from" } }
```

**F138 (hus2, WIC):** veggen ved døra er 1,14 m med en 0,88 m dør, og den andre WIC-ens skyvedør står rett ved, så det
er 0,26 m vegg i alt ved siden av hullet. Med karm 0,05 trenger et vanlig skinneblad 0,86 m, en teleskopdør med to blad
0,47 m og med tre blad 0,32 m. En lommedør får ikke plass, og en forbiløpende dør gir for smal åpning (0,37 m). Ingen av
dem får plass uten å gå over naboåpningen. Det nærmeste er skinnebladet som i dag (validatoren varsler), eller en
teleskopdør med tre blad som går minst 6 cm over naboåpningen. Eieren bør bekrefte hva tegningen mener; planbyggeren
velger `leaves` etter det veggen har plass til.

## 3. Foldedør – `variant: 'folding'`

Mange smale ledd (foldedør eller harmonikadør) som henger i en skinne under overkarmen. Når døra åpnes, foldes leddene
i sikksakk inn mot karmen. Ingen slagområde, og døra åpnes med E. `hinge` trengs ikke.

| felt | standard | betydning |
|---|---|---|
| `panels` | bredden mellom karmene / 0,3 | antall ledd i alt (heltall 2–24). Motoren runder av til et partall per pakke, så den frie enden går i skinna. |
| `slide` | `'from'` | karmen leddene foldes mot: `'from'`, `'to'` eller `'both'` (to pakker, én mot hver karm) |
| `swing` | `'in'` | siden foldene står ut mot: `'in'` = eierveggens rom |
| `glass` | ingen | glass i hvert ledd, se 5 |

Lukket står leddene rett innenfor veggflaten på `swing`-siden. Helt åpen står pakken ved karmen. Den tar
(bredden per pakke · cos 84° + 3 cm) av åpningen og stikker ut én leddbredde (~0,3 m) fra veggen. Hvis for lite blir
igjen til figuren, gir validatoren feil.

```json
{ "id": "door-gang-folde", "type": "door", "offset": 14.2, "width": 2.4, "height": 2.1, "sill": 0,
  "frame": { "color": "#1d1e21", "width": 0.06, "depth": 0.02 }, "connects": ["gang", "stue"],
  "door": { "variant": "folding", "slide": "to", "panels": 8, "swing": "in", "opensInto": "gang" } }
```
Glass-foldedør mot terrassen: `"door": { "variant": "folding", "slide": "both", "swing": "out", "glass": true }` i en
yttervegg (med `"interactive": true`).

## 4. Terrasse- og balkongdør (ytterdør med glass og sidefelt)

En vanlig slagdør eller dobbeltdør i en yttervegg, med `glass` og eventuelt `sidelights`:

| felt | standard | betydning |
|---|---|---|
| `sidelights` | ingen | `[{ "side": "from" \| "to", "w": 0.4, "glass": … }]`, høyst ett felt per side |

Et sidefelt er et fast glassfelt med ramme, i bladets plan og med glass helt ned (fra 0,1 over gulvet). Det står
mellom karmen og en midtpost (`frame.width` bred). Bladet fyller resten, og `leaf.w` brukes ikke da. Sidefeltet tar
`glass` fra døra (samme ruter, men ikke en glasstripes bredde), eller sitt eget `glass`.

**Flere sidefelt på samme side** (en dør i en glassvegg): de står etter hverandre fra karmen og inn, med en midtpost
mellom hvert. Validatoren gir feil når sidefeltene tar hele hullet.

**Overlys** (`transom`): et fast glassfelt over bladet og sidefeltene, under overkarmen, med et losholt (`frame.width`)
under. Midtpostene går gjennom overlyset, så det deles i ett felt over hvert sidefelt og ett over bladet. Hullet er
hele elementet med overlyset.

| felt | standard | betydning |
|---|---|---|
| `transom` | ingen | `true` eller `{ h, glass }` |
| `transom.h` | 0,4 | glassfeltets høyde (0,12–1,2 m), fra losholtet til overkarmen |
| `transom.glass` | `true` | `true`, `false` (tett felt) eller `{ cols, rows, margin, bar, frosted }` |

Bladet blir `height − 2 · frame.width − transom.h` høyt. Validatoren gir feil når det blir under 1,85 m (figuren er 1,8).
Overlys bygges på slagdører og dobbeltdører. På skyve-, folde- og garasjeporter varsler validatoren og ber om et eget
vindu over døra (`notes/vindusmodeller.md`).

```json
{ "id": "door-inngang", "type": "door", "offset": 0.4, "width": 1.5, "height": 2.45, "sill": 0, "interactive": true,
  "connects": ["entre", "ute"],
  "door": { "hinge": "to", "swing": "in", "opensInto": "entre", "glass": { "width": 0.18, "align": "lock", "from": 0.3, "to": 1.85 },
            "sidelights": [{ "side": "from", "w": 0.35 }], "transom": { "h": 0.4 }, "hardware": { "type": "lever", "lock": "keypad" } } }
```

```json
{ "id": "door-stue-terrasse", "type": "door", "offset": 5.0, "width": 1.45, "height": 2.15, "sill": 0,
  "frame": { "color": "#25272b", "width": 0.05, "depth": 0.06 }, "reveal": { "depth": 0.2, "color": "#1d1e21" },
  "connects": ["stue", "ute"],
  "door": { "hinge": "from", "swing": "out", "opensInto": "ute", "leafColor": "#2b2c2e",
            "glass": { "cols": 2, "rows": 3 }, "sidelights": [{ "side": "to", "w": 0.4 }] } }
```

Dobbel terrassedør med sprosser (F38): `"variant": "double"` og `"glass": { "cols": 2, "rows": 4 }` i en yttervegg.

## 5. Glassfelt – `glass` (alle typer)

`glass: true`, eller et objekt der alle felt er valgfrie:

| felt | standard (innerdør / ytterdør / sidefelt / patio) | betydning |
|---|---|---|
| `from` | 0,30 / 0,25 / 0,10 / 0,11 | glassets underkant, m over gulvet |
| `to` | bladtopp − 0,15 / − 0,12 / − 0,05 / − 0,06 | glassets overkant, m over gulvet |
| `margin` | 0,12 / 0,10 / 0,05 / 0,06 | bredden på karmtrestykkene ved siden av glasset |
| `cols`, `rows` | 1, 1 | antall ruter (heltall 1–8). Sprossene står mellom rutene. |
| `bar` | 0,03 | sprossebredde |
| `frosted` | false | matt glass (bad) |
| `width` | – | en smal glasstripe: glassets bredde i m (minst 0,06), i stedet for `margin` på begge sider |
| `align` | `'center'` | glasstripas plass: `'lock'` (ved låskanten, minst 17 cm inn så håndtaket og låsen går fri), `'hinge'` (ved hengslene) eller `'center'` |

Innerdør med ett glassfelt: `"glass": true`. Med tre ruter over hverandre: `"glass": { "rows": 3 }`. Ytterdør med smal
glasstripe ved låsen: `"glass": { "width": 0.16, "align": "lock", "from": 0.3, "to": 1.9 }`.

## 6. Garasjeport – `variant: 'garage'`

Bred port uten slagområde (planbyggerens forespørsel 11). Åpnes med E (`interactive: true` i yttervegg). Garasjen er
eierveggens rom (`swing: 'in'`); `swing: 'out'` legger skinnene på den andre siden.

| felt | standard | betydning |
|---|---|---|
| `style` | `'sectional'` | `'sectional'` (leddport) eller `'tilt'` (vippeport) |
| `sections` | (hullets høyde + 0,05) / 0,55 | leddport: antall seksjoner (heltall 2–10) |
| `headroom` | 0,35 | leddport: plassen skinnene trenger over hullet under himlingen (0,15–0,8 m) |
| `pattern` | `'ribbed'` | `'ribbed'` (liggende spor på leddporten, stående på vippeporten) eller `'flat'` |
| `glass` | ingen | leddport: `true` eller `{ cols }` gir en rad vinduer i seksjon nummer to ovenfra |
| `leafColor` | `'#ecebe7'` | portens farge. Karmen har `frame.color`. |
| `threshold` | betong | en farge gir gulvstripa i hullet den fargen |

- **Leddport:** seksjonene henger bak hullet på garasjesiden og dekker 6 cm vegg på hver side og 5 cm over. Åpen har
  de gått opp de loddrette skinnene, rundt bøyen og inn under himlingen. Den nederste seksjonen står rett over hullet.
  Med skinner, åpner og motor. Validatoren varsler når himlingen i garasjen er lavere enn hullets topp + `headroom`.
- **Vippeport:** ett blad i hullet nær ytterflaten. Toppen går inn langs skinner under overkarmen mens bunnen svinger
  ut og opp, så bladet står vannrett under overkarmen med en tredel ute over innkjørselen.
- Porten stopper over hodet på figuren i åpningen og mot figuren utenfor. Den frie åpningen er hele bredden mellom
  karmene. Under 1,85 m høyde gir validatoren feil, og den varsler under 2,0 m bredde, i en innervegg og uten
  `interactive: true` i en yttervegg.

```json
{ "id": "door-garasje", "type": "door", "offset": 0.5, "width": 2.6, "height": 2.1, "sill": 0, "interactive": true,
  "frame": { "color": "#ecebe7", "width": 0.06, "depth": 0.06 }, "connects": ["garasje", "ute"],
  "door": { "variant": "garage", "style": "sectional", "glass": { "cols": 4 } } }
```
```json
"door": { "variant": "garage", "style": "tilt", "leafColor": "#4a4f55" }
```

---

## Til planbyggeren

- Dobbeltdør: `variant: 'double'`. `hinge` er karmen til bladet med radius `leaf`, og `leaf2` er det andre. Radiusene
  kan sendes rett inn, for de gir bare forholdet.
- Skyvedør: `variant: 'sliding'`, og `slide` er siden bladet ligger på når det er åpent (der bladlinjene på tegningen
  ligger utenfor hullet). `symbol.pocket` gir `mount: 'pocket'`. En glass-skyvedør i yttervegg gir `mount: 'patio'`
  (det er standard i yttervegg). Den gamle omveien (`source` «bygget som slagdør», to dører side om side) kan fjernes.
- Lommedør (F65): hullet er bare passasjen, og veggstykket der bladet går inn skal være vegg uten åpning, med
  `mount: 'pocket'` og `slide` mot den siden.
- Foldedør (F70): `variant: 'folding'`, `slide` mot karmen pakken står ved, `panels` hvis tegningen viser leddene.
- Ytterdører må ha `interactive: true` for å kunne åpnes med E (som før).
- Terrassedør eller glassdør: `glass` med `cols` og `rows` fra fasaden, og `sidelights` for glassfelt helt ned ved siden
  av døra (F48).
- Hullet for en dobbeltdør eller en dør med sidefelt er **hele** åpningen. Karmen kommer fra `frame`.
- Garasjeport (forespørsel 11, hus7): `variant: 'garage'`, `style: 'sectional'` (leddport, vanligst) eller `'tilt'`
  (vippeport) etter fasaden: liggende seksjonsfuger er en leddport, ett felt med stående spor en vippeport. En rad små
  vinduer gir `glass: { cols }`. Omveien (en åpning på 5,2 m) kan fjernes. `interactive: true` trengs.
- Ytterdør med sidefelt og/eller overlys (F141, F144): sidefeltene i `sidelights` (bredden fra fasaden), overlyset i
  `transom: { h }` når ett glassfelt går over døra og sidefeltene under samme overkarm. Er overlyset et eget vindu med
  vegg imellom, er det et eget vindu over døra (`notes/vindusmodeller.md`).
- Dør med glassfelt og sprosser: `glass: { cols, rows }` som før; en smal glasstripe: `glass: { width, align }`.
- Dør i glassvegg: én dør med flere `sidelights` på samme side. Glassvegg uten dør er et vindu.
- Foldedør (F70): `variant: 'folding'` (se 3).
- Skyvedør utenpå veggen der veggen er for kort (F138): `mount: 'surface'` med `leaves: 2` eller `3` (teleskop), eller
  `mount: 'bypass'` når hullet er minst ca. 1,4 m. Validatoren sier hva som får plass.
