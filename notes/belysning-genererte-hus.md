# Belysning i genererte hus

Hus som planbyggeren lager, kan nå få belysning som i et ekte hus. Det gjelder spotter i kjøkken, bad, entré og gang,
pendler over spisebordet og kjøkkenøya, LED under overskapene, vegglamper, speil- og leselamper, taklamper og spotter
som følger en skrå himling, trinnlys i trappa og utelys ved ytterdørene, på terrassen og ved carporten. Lysene får
grupper med dimmer og en regel for når de tennes. Planbyggeren trenger ingen møbler. Reglene bruker det den alt har:
romtype, polygon, himlingstype og -høyde, dører, vinduer, trapper og dekk. I tillegg kan den sende hint om hvor
spisebordet, kjøkkenøya, overskapene, et speil, en seng eller carporten står.

Alt er valgfritt: én ny toppnøkkel, `lighting`, to nye romfelt, `use` og `lighting`, og tre nye lystyper. Et hus uten
`lighting` bygges som før. Eierens hus har ingen av delene og er uendret. Det er kontrollert med
`tools/house-tests/owner-fingerprint.mjs` (`layout 9fd8f7a355b0f410`, `rooms a7cf211c026c6559`) og med et nytt
fingeravtrykk av alle lysene, gruppene og byggerens lysliste (`tools/house-tests/fixtures/owner-lights.json`). Det ble tatt
før arbeidet og er byte for byte likt etter.

**Grunnlag:** grenen `claude/serene-babbage-e8bceb` bygger på planbyggergrenen `claude/planbygger-5d0fe3` (93d505f).
Takdetaljene (`claude/hungry-mendeleev-b747e9`: halvvalm, piper, vinduer med skrå overkant) er flettet inn. Ingen av
grenene er godkjent inn i master ennå.
**Kode:** reglene står i `src/home/lightplan.js` (uten three.js, ren data inn og ut). `layout.js` kjører dem når huset har
`lighting`, og resultatet tolkes som filens egne `builtInLights` og `lightGroups`. Armaturene bygges av
`src/home/lampfittings.js`, som kalles fra `rooms.js`. `src/home/lighting.js` (LightManager) har fått de nye typene og
utelys med `roomId: 'ute'`. `src/home/lamprig.js` er en lysrigg for visninger uten LightManager (planbyggerens
3D-visning). Validatoren (`src/data/scripts/house.mjs`) kjenner feltene, og `research/house/00-ids.json` har `lighting` i
`schema.topLevel` og typene `pendant`, `wall` og `step`.
**Se det:** `dev/belysning.html` viser testhuset i `src/dev/belysning-hus.js`. Det er tegnet som en planbyggerplan og
eksportert av planbyggeren selv. Knappene viser rommene, kveld og dag, himlingene og loftet, og panelet til høyre slår
gruppene av og på og dimmer dem. `?file=/.shots/<hus>.json` viser en annen husfil. Testserveren heter «belysning-test» i
`.claude/launch.json`.
**Test:** `node tools/house-tests/belysning.test.mjs` (også med i `node tools/test-house.mjs`) og
`node tools/test-planbygger-belysning.mjs [--mode both]` for planbyggerens ti testhus. Ytelse:
`node tools/belysning-perf.mjs --port=<testserver>`.

## Formatet

### `lighting` (ny toppnøkkel)

```json
"lighting": {
  "level": "standard",
  "hints": [
    { "type": "island", "outline": [[1.75, 7.9], [1.75, 10.1], [2.65, 10.1], [2.65, 7.9]] },
    { "type": "upper-cabinets", "from": [0, 10.5], "to": [0, 7.5] },
    { "type": "dining-table", "position": [3.6, 5.9], "size": [1.8, 0.9], "angle": 90 },
    { "type": "mirror", "position": [6.2, 4.8], "height": 1.6 },
    { "type": "bed", "outline": [[5.6, 10.75], [5.6, 8.75], [7.2, 8.75], [7.2, 10.75]] },
    { "type": "carport", "outline": [[-5.7, 4.5], [-5.7, -0.1], [-0.25, -0.1], [-0.25, 4.5]] }
  ]
}
```

`"lighting": true` er det samme som `{}`. Alle punkter er spillets `[x, z]`.

| Felt | Standard | Betydning |
| --- | --- | --- |
| `auto` | `true` | `false` slår reglene av (huset får bare filens egne lys) |
| `level` | `'standard'` | `'basic'`: én taklampe eller flere per rom og lampene ved ytterdørene. `'standard'`: alle reglene under. `'rich'`: også vegglamper i soverom, kontor, gang og spisestue, og trinnlys på hvert andre trinn |
| `outdoor` | `true` | `false`: ingen utelys |
| `stairs` | `true` | `false`: ingen trappelys |
| `colorK` | per rom (tabellen) | én fargetemperatur for alle lysene |
| `maxLights` | 220 | taket for hele huset. Over det tynnes spottene ut |
| `hints` | `[]` | hvor ting står (under) |

Reglene gjelder bare rom **uten egne lys** i fila. Et rom som allerede har `builtInLights`, beholder dem og får ingen
regellys. Planbyggeren må derfor slutte å sende sin egen taklampe per rom når den sender `lighting` (se «Til
planbyggeren»).

### Hint

| `type` | Felt | Hva det gir |
| --- | --- | --- |
| `dining-table` | `position` + `size` [lengde, bredde] (1,8 × 0,9) + `angle` (grader, lengderetningen fra +x), eller `outline` (fire hjørner); `round`, `height` (0,74) | 1 pendel (bord ≤ 1,4 m eller rundt), 2 (≤ 2,2 m) eller 3, underkant 0,65 m over bordet |
| `island` | som over (2,4 × 0,9), `height` (0,9) | 2–4 pendler (én per ~0,8 m), underkant 0,75 m over benken. I et kjøkken med stue blir det tette spotter rundt øya og overskapene og taklamper i stuedelen |
| `upper-cabinets` | `from`, `to` (langs veggen under skapene), `bottom` (1,45 over gulvet), `depth` (0,35) | LED-list under skapene, nær forkanten, 250 lm/m |
| `mirror` | `position` (på veggen), `height` (midten, 1,6), `size` | speillampe over speilet |
| `bed` | som `dining-table` (2,0 × 1,6) | to leselamper på veggen ved hodeenden, 1,2 m over gulvet (i stedet for vegglamper) |
| `carport` | `outline` | lampe på husveggen carporten står inntil, 2,0 m over gulvet (to når veggen er over 4 m) |

Et hint finner rommet sitt fra punktet. `roomId` kan sendes, men er ikke nødvendig. Validatoren varsler om et hint
som ikke står i noe rom. Bare carporten kan stå ute. En carport som ikke står inntil huset, får ingen lampe (den
trenger sitt eget tak i formatet), og regelen legger igjen et notat om det.

### Romfelt

- `use`: hva rommet brukes til, fordi formatets `kind` ikke har kjøkken, spisestue, kontor, WC og så videre. Én av
  `living`, `kitchen`, `kitchen-living`, `dining`, `bedroom`, `office`, `bathroom`, `wc`, `hall`, `entrance`,
  `laundry`, `storage`, `wardrobe`, `technical`, `garage`, `stair`. Uten `use` leses det av navnet («Kjøkken/stue» →
  `kitchen-living`, «Kontor», «WC», «Garderobe», «Vaskerom», «Trapperom» …), ellers av `kind`.
- `lighting: false` (eller `'none'`): rommet får ingen regellys. `'auto'` er standard.

### Lysene reglene lager (vanlige `builtInLights`)

Lysene har `id` `l-auto-…`, `source: 'lysregler: …'` (hvorfor) og `estimated: ['*']`. Høyder er over rommets gulv, slik
som i resten av formatet. Planbyggeren kan skrive dem inn i fila selv (`layout.house.lightPlan.builtInLights` og
`lightGroups`). Da må den ta med gruppene og fjerne `lighting`. De bygges likt, og testen sjekker det.

| `type` | Nytt | Felt |
| --- | --- | --- |
| `downlight`, `plafond` | `ceilingNormal: [x, y, z]` | festet på himlingen. På skrå himling er armaturen vippet med den (normalen peker ned i rommet), mens lyset går rett ned |
| `pendant` | ny | `position` = festet i taket, `dims: { d, h, drop }` (`drop` = fra taket til underkanten av skjermen) |
| `wall` | ny | `position` = midt i armaturen, `normal: [x, z]` = ut av veggen, `wallId`, `dims: { w, h, depth }`, `style`: `'sconce'` (lys opp og ned), `'reading'` (arm og skjerm), `'bar'` (speillampe), `'outdoor'` (lykt) |
| `step` | ny | trinnlys i veggen: `position`, `normal`, `wallId`, `dims: { w, h }` |
| `led-strip` | `mount: 'under-cabinet'` | lista ligger i egen høyde, ikke under himlingen |
| alle ute | `roomId: 'ute'` + `levelId` + `outdoor: true` | utelys på yttersiden av en yttervegg (`position` = midt i armaturen) |

## Reglene

| Rom (`use`) | Grunnlys | lm/m² | K | Mer |
| --- | --- | --- | --- | --- |
| `kitchen` | spotter i rutenett, 1,2 m | 300 | 3000 | pendler over øya, LED under overskap |
| `kitchen-living` | spotter 1,6 m. Med øy eller overskap: spotter 1,2 m rundt kjøkkenet og taklampe i stuedelen | 160 | 2700 | pendler, LED, to vegglamper |
| `living` | taklampe, én per ~15 m² langs rommet (høyst 3) | 120 | 2700 | to vegglamper på den lengste ledige veggen (én hvis den er under 2,4 m) |
| `dining` | pendel midt i rommet (eller over bordet) + spotter rundt | 100 | 2700 | |
| `bedroom` | taklampe | 100 | 2700 | leselamper ved senga (hint) |
| `office` | taklampe | 250 | 3000 | |
| `bathroom`, `wc` | spotter 1,2 / 1,1 m | 200 / 220 | 3000 | speillampe (hint). Gruppa er på i auto (rommet har lite dagslys) |
| `hall`, `entrance` | spotter 1,4 / 1,3 m | 150 / 170 | 2700 | entréen tennes om kvelden |
| `laundry` | spotter 1,2 m | 250 | 3500 | |
| `storage`, `wardrobe`, `technical` | taklampe (garderobe: spotter) | 120–200 | 3500–4000 | av i auto. Kan sitte under himling ned til 1,0 m (knevegg-boder) |
| `garage` | taklamper | 150 | 4000 | |
| `stair` (trapperom) | taklampe | 120 | 2700 | |

- **Spottene:** et rutenett langs rommets lengste vegg, 0,45 m fra veggene, bare der himlingen er minst 2,0 m og ikke over
  et trappehull. Det blir aldri flere spotter enn rommets lysmengde trenger (én per 300 lm) og aldri over 16 per rom.
  Lumen per spot er 250–600.
- **Piper** (`chimneys`, notes/tak.md): ingen spot eller taklampe står i en pipe eller nærmere den enn 0,15 m, i noen
  av etasjene den går gjennom. Pendler følger hintet sitt.
- **Taklamper:** settes på det friste punktet i hver del av rommet. På skrå himling legges de der himlingen er flat
  (hanebjelken) og minst 2,1 m.
- **Skrå himling (himlingen følger taket):** har mindre enn en fjerdedel av rommet en flat himling på minst 2,1 m (helning
  under ~10°), får stue, soverom og kontor spotter på skråflaten i stedet (1,6 m mellom). Armaturen vippes med
  himlingen. Vegglamper settes bare der veggen når 0,25 m over lampen (gavlen, ikke kneveggen).
- **Vegglamper:** 1,75 m over gulvet på den lengste veggstrekningen uten vinduer og dører (0,3 m fra åpninger og 0,35 m
  fra hjørner, minst 1,2 m lang).
- **Trappa:** trinnlys i veggen langs løpet, på samme side hele veien, 0,3 m over trinnene, hvert tredje trinn (`rich`:
  hvert andre), høyst 10. Veggen må gå langs løpet og ligge innen 0,8 m fra ganglinja. En åpen trapp uten vegg får en
  pendel i trapperommet fra himlingen i etasjen over. Trappelys lages ikke i `basic`.
- **Ute:** en lykt ved hver ytterdør, 0,3 m fra karmen på den siden som er ledig, ellers over døra, i høyde med
  dørtoppen − 0,15 (minst 1,8 m). Står vinduer eller sidefelt tett på begge sider og det ikke er plass over, settes
  lykta på det nærmeste ledige stedet på en yttervegg innen 1,5 m (lenger bort langs veggen eller rundt hjørnet). Finnes
  ikke det heller (en dør i en lav knevegg), legger regelen igjen et notat. Langs husveggen ved terrasser og balkonger kommer én lykt per ~3 m, utenom vinduer og
  dører. Ved carporten (hint) kommer lamper på husveggen. To utelamper på samme vegg står minst 1,2 m fra hverandre.
  Terrassedører (`terrace-door`, eller en ytterdør fra stue, kjøkken eller soverom) hører til terrassegruppa.

## Grupper og dimming

Hver gruppe er en vanlig `lightGroups`-oppføring, og LightManager og lyspanelet viser dem som før.

| Gruppe | `id` | `defaultDimmer` | `auto` |
| --- | --- | --- | --- |
| rommets grunnlys | rommets egen gruppe hvis fila har en (planbyggerens `id` = rom-id), ellers rom-id-en | per rom: stue 0,6, kjøkken 0,8, bad 0,8, gang 0,5, soverom 0,5, bod 1 | per rom: `dark` (rommets dagslys), bad og WC `on`, entré `evening`, bod, garderobe og teknisk `off` |
| stuedelen av kjøkken/stue | `<rom>-stue` | 0,6 | `dark` |
| pendler over spisebordet | `<rom>-spisebord` | 0,6 | `dark` |
| pendler over kjøkkenøya | `<rom>-oy` | 0,6 | `dark` |
| LED under overskapene | `<rom>-benk` | 0,8 | `dark` |
| vegglamper | `<rom>-vegg` | 0,5 | `dark` |
| leselamper | `<rom>-seng` | 0,6 | `dark` |
| speillampe | `<rom>-speil` | 0,9 | som rommet |
| trappa | `trapp` (`trapp-<id>` med flere trapper), `roomId: null` | 0,5 | `dark` |
| utelys ved inngangen | `ute-inngang`, `roomId: null` | 0,7 | `evening` |
| utelys på terrassen | `ute-terrasse` | 0,6 | `evening` |
| lys ved carporten | `ute-carport` | 0,8 | `evening` |

Lysene i en gruppe har samme bryter og dimmer. Gløden til armaturene i en gruppe er slått sammen til ett mesh og ett
materiale per rom, gruppe og armaturtype, så gruppa tennes og dimmes som én lampe.

## Ytelse

- **LightManager (spillet)** har faste pooler (`lav` 2/4/3, `middels` 2/6/4 punkt/spot/rect). Flere lamper betyr derfor
  ikke flere three.js-lys eller nye shadere. Spottene i et rom og en gruppe blir høyst to kandidater. Ingen regellys
  kaster skygge (`noShadow`), og ingen lampemesh kaster skygge.
- **Planbyggerens 3D-visning** lager i dag ett `PointLight` per lys. Med regellysene blir det 30–70 lys. Målt med
  `tools/belysning-perf.mjs` i hodeløs Edge (RTX 2060 SUPER, 1280 × 960) på testhuset med 62 lys, i fire visninger:

  | | ms per bilde | første bilde etter byttet |
  | --- | --- | --- |
  | uten lamper | 1,7–2,3 | |
  | lysriggen (8 lys) | 2,0–2,9 (+0,2–0,6) | 3–4 ms, ingen nye shaderprogrammer |
  | ett `PointLight` per lys (62) | 4,5–6,2 (+2,6–3,9) | 11,6 s (6 nye programmer med 62 lys hver) |

  `src/home/lamprig.js` gir 8 faste lys (4 punkt og 4 spot) til lampene nær kameraet, 4 ganger i sekundet eller når
  kameraet flytter seg 0,5 m. Antallet lys er alltid det samme, så ingen shader kompileres på nytt når lamper tennes og
  slukkes. Ingen lys kaster skygge (`shadows: n` gir de n beste spottene skygge, 512²).
- **Tegnekall:** husene bygges i rommets armaturbatch (ett tegnekall per materiale og rom), og gløden én per rom, gruppe
  og type. I testhuset ble 62 lys til 40 lampemesher med 8 400 trekanter. Byggetiden (buildLayout + buildRooms) gikk fra
  ~65 til ~95 ms, og selve reglene tar ~7 ms.
- **Planbyggerens ti testhus** (`node tools/test-planbygger-belysning.mjs --mode both`, 180 av 180 sjekker grønne):
  0 feil i validatoren, alle rom på 1 m² eller mer har lys, alle ytterdører har lampe (to loftsdører i lave knevegger i
  hus1 har bare et notat), trappene har lys, armaturene sitter i taket og på veggflater, og dørene, vinduene og
  `viewer.js`' startpunkt er som før. Med KI-svarene ble det 34–67 lys per hus (uten hus7, som har ett rom), 6–20
  grupper, 13–36 kandidater i lysriggen og 11–39 lampemesher. Uten KI blir det færre lys, fordi rommene da får
  gjettede navn og typer (oftest taklamper). Byggetiden endret seg innenfor støyen (+0–50 ms).

| Hus (med KI) | Rom | m² | Lys | Grupper | Riggkandidater | Lampemesher |
| --- | --- | --- | --- | --- | --- | --- |
| hus1 | 15 | 174 | 57 | 19 | 29 | 37 |
| hus2 | 16 | 137 | 56 | 20 | 30 | 39 |
| hus3 | 10 | 147 | 58 | 14 | 29 | 27 |
| hus3-foto | 3 | 74 | 34 | 6 | 13 | 11 |
| hus4 | 13 | 133 | 60 | 18 | 36 | 37 |
| hus5 | 11 | 157 | 65 | 14 | 28 | 27 |
| hus6 | 5 | 130 | 40 | 8 | 16 | 15 |
| hus8 | 14 | 249 | 67 | 17 | 27 | 33 |
| hus9 | 14 | 188 | 58 | 17 | 33 | 36 |

## Til planbyggeren

Endre ikke `src/home/*`. Dette er det planbyggerøkta kobler inn:

1. **`export.js`:** når `idsRegistry.schema?.topLevel?.includes('lighting')` (samme mønster som `cladding` og `decks`):
   - slutt å lage `house.builtInLights` (plafonden per rom) og `house.lightGroups` (gruppa per rom). Rommets grunnlys
     får da `id` = rom-id-en, som i dag. Behold dem bare hvis kunden har lagt inn egne lys.
   - send `house.lighting = { level: 'standard' }`, og `hints` når du vet noe. Kjøkkenbenken du finner i planen
     (generate.js) kan gi `upper-cabinets` langs veggen bak den. Øya og spisebordet kan komme fra møbelsymbolene på
     planen, og carporten fra KI-ens `carport` (i dag `null` i `roomKindOf`).
   - send `rooms[].use` fra KI-ens romtype når den er mer enn `kind`: `kitchen`, `dining`, `office`, `wc`, `wardrobe`,
     `technical`, `garage` (`ai.js` `KIND_FALLBACK` gjør dem i dag til `living`, `bedroom`, `bathroom` og `storage`). Et
     kjøkken og en stue i samme rom er `kitchen-living`.
   - `registryFor(house)` trenger ingen endring. Gruppene lages i motoren og står ikke i fila (skriver du lysene inn i
     fila selv, tar `registryFor` med gruppene derfra).
2. **`viewer.js`:** bytt løkka som lager ett `PointLight` per lys (`for (const l of layout.house.builtInLights) …`) med
   lysriggen:
   ```js
   import { LampRig } from '../home/lamprig.js';
   const rig = new LampRig({ scene, layout, lights: parts[0].builtInLights }); // buildRooms' liste, ikke layoutens
   // i loop(): rig.update(camera); når visningen bygges om: rig.dispose()
   ```
   `rig.setMode('day' | 'evening')` følger tiden på døgnet, og `rig.setGroup(id, { on, dimmer })` og `rig.groups` er
   for et lyspanel. Uten riggen lyser lampene ikke (gløden står på 0 til noe tenner den).
3. **`viewer.js` `spawnPoint`** tar det første lyset i det største rommet. Med `lighting` er det rommets grunnlys
   (en spot eller taklampe minst 0,45 m fra veggene), så det virker fortsatt. Testen sjekker det for alle husene.
4. **Utvendige dører og dekk:** lampen ved en ytterdør krever at døra kobler til `'ute'` (`connects`), eller står i en
   yttervegg. Dekkskanten må ligge på yttersiden av veggen (som før, `notes/kledning.md`).

## Kjent og ikke gjort

- **Ildens gruppe (23.10, planbyggerøkta):** `planLighting` tar rommets første datagruppe som grunnlysgruppe
  (`dataGroupOfRoom`). I et rom med et ildsted er det ildens gruppe (`fire-<id>`, laget i `layout.js`), så taklampene
  havner på ildens bryter, og `lightGroupOf` varsler om en ukjent gruppe. Planbyggeren sender derfor en egen lysgruppe
  for rom med ild. Forespørsel: hopp over `fire-`-grupper i `dataGroupOfRoom`.

- LightManager er ikke prøvd med et generert hus i nettleseren, fordi spillet ikke laster kundehus ennå (det trenger
  eierens stue). De nye typene er lagt inn i `_buildHouseLamps` på samme måte som de gamle, men den første gangen et
  generert hus lastes i spillet, må det ses på.
- Lysriggen har ingen lysmaske per rom. Uten skygger kan lys lekke gjennom vegger til rom ved siden av. Riggen gir
  derfor lysene i kamerarommet tre ganger så høy vekt og begrenser rekkevidden (punkt 7 m, spot 9 m).
- Overskap, øy, spisebord og seng tegnes ikke (formatet har ingen møbler fra planbyggeren). LED-lista og pendlene henger
  der hintet sier.
- En frittstående carport og hager eller stier har ikke lys.
