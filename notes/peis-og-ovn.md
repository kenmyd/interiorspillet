# Peis, peisovn og vedovn i husformatet

Husformatet har nå ildsteder: åpen peis, peisinnsats med murt eller platekledd omramming, frittstående vedovn (boks
eller rund) og peisovn. Et ildsted står på gulvet i rommet sitt, inntil en vegg, i et hjørne eller fritt, på en
gulvplate av glass, stein eller stål, og røyken går i en pipe fra `chimneys[]` (notes/tak.md «Piper»). Pipa legges inn
én gang: ildstedet bestemmer hvor den står og hvor den begynner. Ilden gløder og lyser (lighting.js) uten nye lyskilder
i shaderne, og figuren går ikke gjennom ildstedet.

Alt er valgfritt. Et hus uten `fireplaces` bygges som før. Eierens hus har ingen, og det er uendret: fingeravtrykket
(`node tools/house-tests/owner-fingerprint.mjs`) er `layout 9fd8f7a355b0f410`, `rooms a7cf211c026c6559`, 301 mesher,
likt før (98ff10c) og etter. Lystesten (`lighting.test.mjs`, stua alene mot hele huset) er grønn, og eierens hus får
ingen flimring og ingen ny lysgruppe.

**Kode:** modellen er `src/home/fireplacegeom.js` (uten three.js; brukes av `layout.js`, byggeren og validatoren),
byggeren `src/home/fireplace.js` (kalles fra `rooms.js` etter pipene). Pipene får plassen sin gjennom `seats` i
`src/home/chimneygeom.js`. Ilden i lyset: `src/home/lighting.js` (`HOUSE.fire`, `_flicker`). `layout.js` gir
`layout.house.fireplaces` og en lysgruppe per ild. **Se dem:** `dev/peis.html` (fire testhus i `src/dev/peis-hus.js`,
`peis-test` på port 5276 i `.claude/launch.json`; «Kveld» tar bort sola og lampene, «Ild» tenner og slukker, «Gå» går med
spillets figur, `__bump('ovn-a')` går figuren inn i et ildsted). **Test:** `node tools/house-tests/peis.test.mjs` (også med
i `node tools/test-house.mjs`).

Grenen bygger på `claude/hungry-mendeleev-b747e9` (pipene, 98ff10c), som ikke er flettet inn i master ennå.

## Testhusene

| Hus | Hva |
|---|---|
| A (x 0–10) | hus4: to etasjer, en rund vedovn i stua oppe ved soveromsveggen (det runde symbolet i `2etg.avif`) på en glassplate, stålpipa rett opp fra den gjennom pulttaket (fasade 1). I 1. etasje er det ingen pipe. |
| B (x 14–23) | åpen peis i tegl midt på nordveggen (hylle, steinplate), teglpipa inne i omrammingen og opp gjennom saltaket; en peisovn i sørvesthjørnet, vridd 45°, på en glassplate formet som en kvartsirkel, stålpipe opp gjennom taket ved takfoten. |
| C (x 28–36) | kjeller og 1. etasje under valmtak: en peisinnsats i pusset omramming mot vestveggen, den pussede pipa fra kjellergulvet (en kasse i kjelleren) opp gjennom taket. |
| D (x 42–50) | pulttak åpent inne: en peisinnsats i hvit platekledning (2,2 m høy) mot østveggen med stålpipe fra toppen av omrammingen; en vedovn på bein foran en teglpipe mot nordveggen, røykrør fra toppen og inn i pipa, stålplate under. |

## Ildstedet: `fireplaces[]`

`fireplaces` er en ny toppnøkkel (i `schema.topLevel`).

| Felt | Standard | Betydning |
|---|---|---|
| `id` | `peis-<n>` | Unik id (blant alle id-ene i huset). Lysgruppen og lyset heter `fire-<id>`. |
| `name` | `''` | Navnet (lysgruppens navn; uten: «Vedovn», «Peisovn», «Peis», «Åpen peis»). |
| `type` | `'stove'` | `'stove'` (vedovn), `'fireplace-stove'` (peisovn: høy, stort vindu, vedlager under brennkammeret), `'insert'` (peisinnsats i en omramming), `'open'` (åpen peis i en murt omramming med hylle). |
| `roomId`, `levelId` | rommet der `at` står (hovedetasjen først) | Rommet eller etasjen. Gi ett av dem i et hus med flere etasjer. |
| `at` | – | Midten av ildstedet i plan, `[x, z]` (symbolets midte). Kan utelates med `wall`, og når pipa har `at`: da står ildstedet foran en murt pipe eller under en stålpipe. |
| `wall`, `offset` | `offset`: midt på veggen | Inntil denne veggen (rommets egen side), midten `offset` m fra veggens `from`. |
| `placement` | fra veggene rundt | `'wall'`, `'corner'` eller `'free'`. Uten: et hjørne når to vegger møtes ved ildstedet, en vegg når én står innen 0,6 m (pluss `gap`), ellers fritt. |
| `facing` | ut fra veggen eller hjørnet, bort fra pipa, ellers mot rommets midte | Retningen fronten vender, `[x, z]`. I et hjørne 45° ut. |
| `gap` | ovner 0,1, innsats og åpen peis 0 | Fra veggen til baksiden. En ovn blir stående der den er tegnet (men minst `gap` fra veggen). En omramming flyttes inntil veggen. |
| `size` | se under | `[bredde, dybde, høyde]`. En omramming uten høyde går opp til taket (det laveste punktet over den). For en rund ovn er diameteren den minste av bredde og dybde. |
| `shape` | `'box'` | Ovner: `'box'` eller `'round'`. |
| `material` | `'steel'` | Ovner: `'steel'` (sortlakkert stål) eller `'soapstone'` (kleberstein). |
| `color` | stål `#1d1e20`, kleberstein `#6d706a` | Ovnens farge. |
| `surround` | innsats `{ kind: 'masonry', material: 'render' }`, åpen peis `{ kind: 'masonry', material: 'brick' }` | Omrammingen: `kind` er `'masonry'` (murt: `material` `'brick'`, `'render'` eller `'stone'`) eller `'panel'` (platekledd, glatt malt), og `color` (tegl `#8a4b3c`, puss `#ece9e3`, stein `#8d8a84`, plater `#f2f0eb`). |
| `opening` | innsats 0,68 × 0,5, brystning 0,45, dybde 0,42; åpen 0,8 × 0,62, 0,3, 0,45 | Åpningen i omrammingen: `{ width, height, sill, depth }`. |
| `mantel` | på en åpen peis | Hylla 0,28 over åpningen (`{ over, thickness, depth, color }`). `false` gir ingen. |
| `hearth` | se under | Gulvplata: `{ material, shape, front, side, size, thickness, color }`, eller `false`. |
| `chimney` | – | Id-en til pipa i `chimneys[]`. Uten pipe blir det en advarsel. |
| `outlet` | `'top'` | Røykstussen: `'top'`, eller `'back'` (bare for en ovn foran en murt pipe: røykrøret går rett bak inn i pipa). |
| `logStore` | på en peisovn | Vedlageret under brennkammeret. `false` gir ingen. |
| `fire` | se under | `{ lumens, colorK, on }`, eller `false` (et kaldt ildsted, uten lys og flammer). `on: false`: lysgruppen er av til den slås på. |

**Standardmål:** vedovn som boks 0,47 × 0,42 × 0,95 (på bein, 0,12), rund Ø 0,5 × 1,05 (på en sokkel); peisovn
0,6 × 0,46 × 1,4 (rund Ø 0,6 × 1,35); omrammingen til en innsats 1,2 × 0,6, til en åpen peis 1,3 × 0,65.

**Gulvplata:** glass under ovner, stein foran innsats og åpen peis. Den når 0,3 foran (åpen peis 0,5) og 0,1 til sidene
(åpen peis 0,3). Glass er 8 mm, stein 3 cm og stål 3 mm. En ovn står på plata, og plata går inn til veggen eller pipa bak
når de er nærmere enn 0,4 m. Foran en omramming går plata over hele bredden (minst åpningen og sidene). Formen er `rect`
inntil en vegg, `quarter` (kvartsirkel fra hjørnet) i et hjørne og `round` under en rund ovn som står fritt. Plata kuttes
der den ville gått inn i en vegg. `size: [bredde, dybde]` gir egne mål.

**Ilden:** vedovn 250 lm, peisovn og innsats 350 lm, åpen peis 500 lm, 1900 K.

```json
"fireplaces": [
  { "id": "ovn-a", "name": "Vedovn i stua", "type": "stove", "shape": "round", "roomId": "a-stue", "at": [4.2, 5.9], "chimney": "pipe-a" },
  { "id": "peis-b", "type": "open", "wall": "w-b1-n", "offset": 4.2, "chimney": "pipe-b1" },
  { "id": "peisovn-b", "type": "fireplace-stove", "at": [14.95, 0.95], "chimney": "pipe-b2" },
  { "id": "peis-d", "type": "insert", "wall": "w-d1-o", "offset": 2.2, "size": [1.0, 0.55, 2.2], "surround": { "kind": "panel" }, "chimney": "pipe-d1" },
  { "id": "ovn-d", "type": "stove", "chimney": "pipe-d2", "hearth": { "material": "steel" } }
],
"chimneys": [
  { "id": "pipe-a", "material": "steel" },
  { "id": "pipe-b1", "material": "brick" },
  { "id": "pipe-b2", "material": "steel" },
  { "id": "pipe-d1", "material": "steel" },
  { "id": "pipe-d2", "material": "brick", "at": [44.6, 6.45] }
]
```

## Pipa, én gang

Ildstedet nevner pipa med `chimney`. Pipa står i `chimneys[]` som før, men `at` kan utelates når et ildsted nevner den.
`resolveFireplaces` gir `seats` til `resolveChimneys`, og pipa får `fireplaceIds`.

| Ildsted | Pipe | Hvor pipa står | Hvor den begynner |
|---|---|---|---|
| vedovn, peisovn | stål | over røykstussen (en `at` innen 0,5 m flyttes dit, med en advarsel) | på toppen av ovnen. Ingenting av den i etasjene under. |
| vedovn, peisovn | murt eller pusset | bak ovnen: pipas `at`, eller inntil veggen bak ovnen når pipa ikke har `at`. Ovnen står 0,25 foran pipa. | på gulvet i det nederste rommet under den, som før. Et røykrør går 0,35 opp fra stussen og vannrett inn i pipas side, med en rosett der det går inn. |
| innsats, åpen peis | murt eller pusset | inne i omrammingen, bak inntil veggen. Uten ildstedets `at` står omrammingen rundt pipa. | på gulvet i det nederste rommet under den (en kasse i kjelleren). I ildstedets rom begynner den på toppen av omrammingen. |
| innsats, åpen peis | stål | midt over omrammingen | på toppen av omrammingen. |

`seats[pipeId]` er `{ fireplaceId, mode, levelId, roomId, y, at }`: `'base'` (pipa begynner i y), `'cut'` (biten i etasjen
begynner i y) og `'flue'` (et røykrør går inn i den). En pipe som står i et hus fra et gulv, har `inHouse`, så delen ute
begynner ved taket også når omrammingen skjuler hele pipa inne.

## I 3D

- **Navn:** gruppen `fireplace:<id>` i etasjens rot (`roots.levels`), med `fireplace-body`, `-trim`, `-firebox`, `-glass`,
  `-logstore`, `-surround`, `-mantel`, `-embers`, `-logs` og `fireplace-flame:<id>:<0–2>`. På gulvet `fireplace-hearth`
  og `fireplace-hearth-edge`, røykrøret `fireplace-flue` og (en ovn uten pipe) `fireplace-collar`.
- **Ovnene:** en vedovn på bein med toppplate, dørramme med håndtak og glass inn til brennkammeret. Den runde står på en
  sokkel, og glasset følger runden. Peisovnen har et åpent vedlager med kubber under brennkammeret. **Omrammingen** er
  murt (tegl, puss eller stein fra `facadeFinish`) eller platekledd (malt). Åpningen går inn til brennkammeret. En innsats
  har stålramme og glass, en åpen peis har hylle. I et hjørne fyller toppen trekanten mot hjørnet.
- **Ilden:** glør (en emissiv flate med glødekart, lampas glødende del i lyset), tre kubber og flammer (tre kryssede plan
  med et flammeatlas på fire bilder, additivt, uten skygge). Flammene følger glørnes glød, så de slukner med lysgruppen,
  og bildene, høyden og svaien endres i `update(dt)` (rooms.js kaller den). Brennkammeret gløder svakt med ilden.
- **Kollisjon:** en `Box3` per ildsted fra gulvet til toppen (ovn eller omramming). Står det vridd (i et hjørne), er
  kollideren et usynlig, vridd boksmesh (`fireplace-collider:<id>`, ikke i scenen), så hjørnet foran ikke blir sperret.
  Røykrøret og gulvplata har ingen kollider.
- **Ytelse:** ingen nye lys i shaderne og ingen nye passeringer. Ildens lys bruker en av de faste spot-plassene (budsjettet
  velger, som for lampene), og flimringen setter bare intensiteten på den plassen hvert bilde (`_flicker`, ingen
  omregning). Et ildsted har 1300–3000 trekanter. Flammeteksturen (256 × 128) og glødekartet (64 × 64) lages én gang i JS
  og deles (`texture.clone()` deler kilden). Byggingen av alle fire testhusene tar under et sekund i Node.

## Lyset (lighting.js)

- Byggeren legger en oppføring av typen `'fire'` per ild i `builtInLights` (→ `home.house.builtInLights`): id og gruppe
  `fire-<id>`, lumen og farge fra `fire`, plassert 0,12 m foran vinduet eller åpningen, retning ut av fronten og 15° ned.
  Id-en har ikke `:`, fordi lighting.js samler glødende deler per armatur etter id-en foran `:`.
- `_buildHouseLamps` gjør den til en Lambert-spot (85°, ingen skygge, som andre lamper i huset), så det ikke lyser bak
  ovnen. `HOUSE.fire.flicker` (±14 %) er flimringen. Glørne er lampas glødende del: de lyser med lysgruppen og eksponeringen.
- Lysgruppen er en datagruppe i rommet med `auto: 'evening'` (tent når sola er nede, i «Kveldslys» og «Natt», av i
  «Dagslys»), og den kan slås av og på i lyspanelet.
- Spillets LightManager brukes i dag bare med eierens hus. Det er testet med en ild lagt inn i et av eierens rom
  (`peis.test.mjs`: tent om natta i en lysplass, flimring rundt grunnverdien, slukket om dagen, kan tennes for hånd).
  Planbyggerens visning og testsidene har ingen LightManager: der gløder ilden med sin egen standard (glørne 1,2), og
  `dev/peis.html` legger en spot per ild.

## Feil og advarsler (validatoren)

- **Feil:** ukjent `type`, `placement`, `shape`, `material`, `outlet`, `surround.kind`, `surround.material`,
  `hearth.material` eller `hearth.shape`; `at` eller `facing` som ikke er punkter; en pipe som ikke finnes, som begynner i
  taket, eller en stålpipe med to ildsteder; en stålpipe mer enn 0,5 m fra røykstussen; et ildsted som ikke står i et rom
  (eller utenfor rommet det har); ingen `at`, `wall` eller pipe å stå ved; `placement: 'corner'` uten hjørne; `quarter`
  utenfor et hjørne; en åpning som ikke får plass i omrammingen; en ovn foran en murt pipe uten `at` når ovnen ikke står
  inntil en vegg; et røykrør som ikke når pipa; mål, lumen eller fargetemperatur utenfor grensene; en id brukt to ganger;
  en pipe uten `at` som ingen ildsteder nevner.
- **Advarsler:** ingen pipe; en stålpipe flyttet til røykstussen; et ildsted flyttet mer enn 0,3 m til veggen; høyere enn
  taket (kuttes); utenfor rommet; en murt pipe utenfor omrammingen, eller inn i brennkammeret; et røykrør over 1,6 m;
  `shape`, `surround` eller `outlet: 'back'` der de ikke gjelder.

## Til planbyggeren

Planbyggeren sender dette. Visningen bygger det med `buildRooms` uten noe nytt.

- **Ovnssymbolet i planen:** en liten sirkel er en rund vedovn, et lite kvadrat en vedovn eller peisovn. Send
  `{ id, type: 'stove', shape: 'round' | 'box', roomId, at: [x, z] }`. `at` er symbolets midte, og `roomId` er rommet
  (etasjen) det står i. Symbolets mål kan gå i `size` (diameteren eller bredden); uten `size` brukes standardmålene.
  Et avrundet kvadrat rundt sirkelen (hus4, `2etg.avif`) er glassplata; den kommer som standard.
- **En peis** (et større rektangel mot en vegg, gjerne med en U for åpningen): `type: 'insert'` (eller `'open'`), med
  `wall` (veggens id) og `offset`, eller `at`. `surround: { kind: 'masonry' | 'panel' }` når det er kjent.
- **Pipa fra fasaden:** `chimneys: [{ id, material, top? }]`, uten `at` når den hører til ildstedet: motoren setter den over
  ovnen (stål) eller bak den og inne i omrammingen (murt). Ildstedet får `chimney: '<pipe-id>'`. `top` er fra fasaden,
  over bakken. Har pipa en kjent plassering, kan `at` sendes; en stålpipe flyttes da til røykstussen hvis den står innen
  0,5 m.
- **hus4:** `{ id: 'ovn-stue', type: 'stove', shape: 'round', roomId: '<stua i 2. etasje>', at: <symbolet>, chimney: 'pipe-1' }`
  og `{ id: 'pipe-1', material: 'steel' }`.
- Send ikke `placement` eller `facing` hvis de ikke står i tegningen: motoren finner dem fra veggene rundt.
- **Visningen (`viewer.js`):** den kaller allerede `update(dt)` på delene hvert bilde, så flammene går. Den lager lys bare
  fra `layout.house.builtInLights` (dataene). For at ilden skal lyse på rommet, kan den legge en spot per oppføring med
  `type: 'fire'` i `buildRooms(...).builtInLights`, som `dev/peis.html` gjør: `SpotLight(farge, lumens / π · 0,03, 9,
  85°, 1, 2)` i `position`, rettet langs `direction`, med litt flimring. Uten det gløder ilden likevel.
