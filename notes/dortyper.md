# Dørtyper i husformatet

2026-10-22. Dobbeltdør, skyvedør, glassfelt og sidefelt i spillets motor (planbyggerens forespørsel 7 og eierens
F17, F27, F31, F38, F39, F48, F49 og F50). Alt nytt er valgfrie felt i `door:{…}` på en åpning med `type: 'door'`.
Uten de nye feltene bygges døra nøyaktig som før, i den gamle koden.

**Kode**
- `src/world/Door.js`: slagdør. Ny dobbeltdør med ulike blad (`splitX`) og valgfritt aktivt blad (`activeLeaf`).
- `src/world/SlidingDoor.js` (ny): skyvedør med samme API som `Door` (E, lyd, kollisjon, stopper mot figuren).
- `src/home/doortypes.js` (ny): bygger de nye typene. `doors.js` `buildDoor` sender en dør hit bare når den har
  `variant: 'double' | 'sliding'`, `glass` eller `sidelights`.
- `src/data/scripts/house.mjs` `validateHouse`: sjekker feltene, plassen en skyvedør trenger, og at figuren kommer gjennom.
- `src/home/visibility.js`, `src/design/Placement.js`, `src/design/ViewModes.js`: skyvedører har ingen slagbue,
  dobbeltdører får to.

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
| `mount` | `'surface'` i innervegg, `'patio'` i yttervegg | `'surface'`: utenpåliggende på skinne. `'pocket'`: inn i veggen. `'patio'`: glass-skyvedør i ramme. |
| `slide` | `'from'` | retningen bladet går når det åpnes: mot veggens `from`- eller `to`-ende, eller `'both'` (to blad som går fra hverandre; ikke for patio) |
| `swing` | `'in'` | `'surface'`: veggflaten bladet henger på |
| `glass` | ingen (patio: `true`) | glassfelt i bladet/bladene, se 4 |

- **`surface`**: Bladet dekker karmen og 2 cm til. Det henger 3 cm ut fra veggen, i en skinne over hullet (til
  hullets topp + 0,1). Åpent står det på veggen ved siden av hullet. Veggen trenger hullets bredde + 0,08 fri på den
  siden. Hvis det går over en annen åpning eller forbi veggens ende, gir validatoren en advarsel, og den advarer også
  hvis skinna går over veggen.
- **`pocket`**: Bladet går midt i veggen og forsvinner inn i den gjennom en spalte i karmen. 2,5 cm blir stående igjen
  som grep. Validatoren gir **feil** når lommen (hullets bredde + 0,04) går over en annen åpning eller forbi veggens
  ende, og når veggen er tynnere enn 0,08.
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
{ "id": "door-stue-ute", "type": "door", "offset": 1.0, "width": 2.4, "height": 2.15, "sill": 0,
  "frame": { "color": "#25272b", "width": 0.05, "depth": 0.06 }, "reveal": { "depth": 0.2, "color": "#1d1e21" },
  "connects": ["stue", "ute"], "door": { "variant": "sliding", "mount": "patio", "slide": "from" } }
```

## 3. Terrasse- og balkongdør (ytterdør med glass og sidefelt)

En vanlig slagdør eller dobbeltdør i en yttervegg, med `glass` og eventuelt `sidelights`:

| felt | standard | betydning |
|---|---|---|
| `sidelights` | ingen | `[{ "side": "from" \| "to", "w": 0.4, "glass": … }]`, høyst ett felt per side |

Et sidefelt er et fast glassfelt med ramme, i bladets plan og med glass helt ned (fra 0,1 over gulvet). Det står
mellom karmen og en midtpost (`frame.width` bred). Bladet fyller resten, og `leaf.w` brukes ikke da. Sidefeltet tar
`glass` fra døra (samme ruter), eller sitt eget `glass`.

```json
{ "id": "door-stue-terrasse", "type": "door", "offset": 5.0, "width": 1.45, "height": 2.15, "sill": 0,
  "frame": { "color": "#25272b", "width": 0.05, "depth": 0.06 }, "reveal": { "depth": 0.2, "color": "#1d1e21" },
  "connects": ["stue", "ute"],
  "door": { "hinge": "from", "swing": "out", "opensInto": "ute", "leafColor": "#2b2c2e",
            "glass": { "cols": 2, "rows": 3 }, "sidelights": [{ "side": "to", "w": 0.4 }] } }
```

Dobbel terrassedør med sprosser (F38): `"variant": "double"` og `"glass": { "cols": 2, "rows": 4 }` i en yttervegg.

## 4. Glassfelt – `glass` (alle typer)

`glass: true`, eller et objekt der alle felt er valgfrie:

| felt | standard (innerdør / ytterdør / sidefelt / patio) | betydning |
|---|---|---|
| `from` | 0,30 / 0,25 / 0,10 / 0,11 | glassets underkant, m over gulvet |
| `to` | bladtopp − 0,15 / − 0,12 / − 0,05 / − 0,06 | glassets overkant, m over gulvet |
| `margin` | 0,12 / 0,10 / 0,05 / 0,06 | bredden på karmtrestykkene ved siden av glasset |
| `cols`, `rows` | 1, 1 | antall ruter (heltall 1–8). Sprossene står mellom rutene. |
| `bar` | 0,03 | sprossebredde |
| `frosted` | false | matt glass (bad) |

Innerdør med ett glassfelt: `"glass": true`. Med tre ruter over hverandre: `"glass": { "rows": 3 }`.

---

## Til planbyggeren

- Dobbeltdør: `variant: 'double'`. `hinge` er karmen til bladet med radius `leaf`, og `leaf2` er det andre. Radiusene
  kan sendes rett inn, for de gir bare forholdet.
- Skyvedør: `variant: 'sliding'`, og `slide` er siden bladet ligger på når det er åpent (der bladlinjene på tegningen
  ligger utenfor hullet). `symbol.pocket` gir `mount: 'pocket'`. En glass-skyvedør i yttervegg gir `mount: 'patio'`
  (det er standard i yttervegg). Den gamle omveien (`source` «bygget som slagdør», to dører side om side) kan fjernes.
- Terrassedør eller glassdør: `glass` med `cols` og `rows` fra fasaden, og `sidelights` for glassfelt helt ned ved siden
  av døra (F48).
- Hullet for en dobbeltdør eller en dør med sidefelt er **hele** åpningen. Karmen kommer fra `frame`.
