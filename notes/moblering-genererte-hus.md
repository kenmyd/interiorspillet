# Møblering av genererte hus

Et hus som planbyggeren lager, får nå møbler fra spillets katalog. Hvert rom møbleres etter hva det brukes til og hvor
stort det er. Møbelsymbolene på plantegningen («hint») bestemmer hvor møblene står, så langt reglene tillater det.
Møblene står aldri i en døråpning, der et dørblad slår, foran et vindu som går ned til gulvet eller under en himling de
ikke får plass under. Figuren kommer seg alltid inn og ut av rommet og fram til hvert møbel.

Dette er bygd på grenen `claude/hungry-mendeleev-b747e9`, som har den nyeste motoren og planbyggeren, men som ikke er
godkjent inn i master ennå.

Alt er valgfritt: én ny toppnøkkel, `furnishing`. Et hus uten den bygges som før. Eierens hus har den ikke og er
uendret. `node tools/house-tests/owner-fingerprint.mjs` gir `layout 9fd8f7a355b0f410`, `rooms a7cf211c026c6559` og 301
mesher, likt med og uten denne grenens endringer. Originaldesignet i spillet (`DesignState`, 81 møbler,
`originalItems(layout, { rooms: 'all' })`) er byte for byte likt.

**Kode:**
- Modulen: `src/home/furnishgeom.js`, uten three.js.
- Byggeren: `src/home/furnish.js`, kalt fra `rooms.js`.
- `layout.js` gir `layout.house.furnishing`.
- `existing.js` har `furnishedItems`, og `DesignState` (`originalsOf`) tar dem med.
- Validatoren er `src/data/scripts/house.mjs`, og `furnishing` er lagt til i `schema.topLevel` i `research/house/00-ids.json`.

**Se det:** `dev/moblering.html`. Testhuset er `src/dev/moblering-hus.js`: et planbygger-dokument som planbyggerens
egen `exportHouse` gjør om til husfil, pluss `furnishing`. Knappene viser rommene. «Tak» skjuler himlingene, «Navn»
viser romnavnene og «Gå (WASD)» lar deg gå med spillets figur, der møblene stopper deg. Testserveren er
«moblering-test» i `.claude/launch.json`, port 5274.

**Test:** `node tools/house-tests/moblering.test.mjs` (51 sjekker; også med i `node tools/test-house.mjs`).

## Formatet: `furnishing`

```json
"furnishing": {
  "auto": true,
  "rooms": { "kontor": { "use": "office" }, "bod": { "off": true } },
  "hints": [
    { "kind": "bed", "at": [1.78, 9.28], "levelId": "hoved" },
    { "kind": "kitchen", "at": [6.48, 3.08], "levelId": "hoved" },
    { "kind": "toilet", "at": [0.38, 6.48], "levelId": "hoved" }
  ]
}
```

| Felt | Standard | Betydning |
| --- | --- | --- |
| `auto` | `true` | `false`: bare møblene hintene gir (med det som hører til: stoler, nattbord …) |
| `rooms[id].use` | fra navn og type | hva rommet møbleres som (tabellen under) |
| `rooms[id].off` | – | `true`: rommet får ingen møbler |
| `hints[]` | `[]` | planens symboler: `kind`, `at: [x, z]` i husets meter, `levelId` (anbefalt), valgfritt `roomId`, `rotationDeg` |
| `seed` | `1` | et annet tall gir andre valg blant like gode produkter |

Et hint hører til rommet det står i (`roomId` vinner, ellers rommet på `levelId` som har punktet). Validatoren sier fra
om et ukjent rom, en ukjent bruk eller et hint uten punkt (feil), og om et ukjent møbel eller et hint som ikke står i
noe rom (advarsel; det brukes ikke).

**Møbelhint** gir et møbel der planen tegnet det: `bed`, `sofa`, `table` / `dining-table` (et spisebord med stoler),
`coffee-table`, `desk`, `wardrobe`, `dresser`, `bookcase`, `armchair` og `tv` (en TV-benk).
**Hint for faste installasjoner** gir ingen møbler. De holder gulvet fritt der installasjonen står (mot nærmeste vegg) og
foran den:

| `kind` | bredde × dybde + fritt foran |
| --- | --- |
| `kitchen` | 2,4 × 0,62 + 1,0 |
| `stove`, `fridge` | 0,6 × 0,62–0,65 + 1,0 |
| `toilet` | 0,4 × 0,7 + 0,6 |
| `shower` | 0,9 × 0,9 + 0,6 |
| `bathtub` | 1,7 × 0,75 + 0,6 |
| `washbasin` | 0,6 × 0,5 + 0,7 |
| `washer` | 0,6 × 0,62 + 0,7 |
| `fireplace` | 1,0 × 0,6 + 0,8 |
| `car` | 2,5 × 5,0 + 0,6 |

`other` brukes ikke. Listen er KI-ens `FURNITURE_KINDS` (`server/planbygger-ai/prompts.mjs`) pluss de møblene katalogen har.

**Bruken av rommet** (`roomUse`) er `furnishing.rooms[id].use`, ellers navnet, ellers typen:
- Navnene «Stue», «Allrom», «TV-stue» og «Stue/kjøkken» gir stue. «Kjøkken» gir kjøkken, «Spisestue» spisestue, «Kontor»
  og «Arbeidsrom» kontor, «WC» og «Toalett» wc, «Vask» vaskerom, «Bad» bad, «Sov» soverom, «Entré» og «Vindfang» entré.
- «Gang», «Hall» og «Trapperom» gir gang. «Bod» og «Lager» gir bod, «Garderobe», «WIC» og «Walk-in» garderobe.
- Bruken kan være `living`, `kitchen`, `dining`, `bedroom`, `office`, `hall`, `entrance`, `bathroom`, `wc`, `laundry`,
  `storage`, `wardrobe`, `technical`, `garage` eller `other`. De to siste og `technical` får ingen møbler.

## Modulen

`furnishRoom(room, products)` er kjernen. Den tar inn ett rom som rene data og gir ut plasserte møbler.
`roomInput(layout, roomId)` lager rommet fra `layout.house`. `furnishHouse(layout, catalog)` gjør hele huset og gir
DesignState-elementer, og resultatet lagres per layout.

Inndata (plan `[x, z]` i meter, høyder over rommets gulv):
- `polygon`: romsiden av veggene.
- `walls`: rommets vegger med retning inn i rommet og alle hullene (egne og backOf-veggenes). `walk` betyr at spilleren
  går gjennom: dører, passasjer, terrassedører.
- `swings`: slagområdet til hvert dørblad som slår inn i rommet (som `Placement.js` `swingBox`, 5 cm større).
- `ceilingAt(x, z)`: himlingens høyde, så en skrå himling er lavere ved veggen.
- `keepOut`: trapp og trappefot, trappehull og innredning (`house.builtIns`).
- `hints`: hintene i rommet.

Utdata per møbel: `role`, `product` (katalog-id), `archetype`, `mount`, `dims`, `at`, `y`, `rotationDeg`, og for
veggmøbler `wallId` og `normal`.
I tillegg `use`, `reserved` (gulv som holdes fritt), `notes` og `walk`: hvor mange dører figuren når, og hvor stor andel
av det åpne gulvet den når.

**Felles regler for alle møbler:**
- En dør eller passasje har gulvet 0,9 m foran seg fritt, og 10 cm på hver side. Dørbladets slag holdes også fritt.
- Et vindu som går ned til gulvet (brystning under 0,3 m), eller en terrassedør, har 0,7 m fritt foran seg. Bare et
  teppe kan ligge der.
- Foran et vanlig vindu står ingenting som er høyere enn brystningen nærmere enn 0,35 m.
- Himlingen må være minst møbelhøyden + 5 cm over hele fotavtrykket. Testet: en 2 m høy garderobe under en
  skrå himling står ved den høye veggen.
- Hvert møbel har ryddesoner som andre møbler holder seg unna:
  - foran garderoben: 0,75 m;
  - foran kommoder, skjenker og bokhyller: 0,6 m;
  - på begge sider av en dobbeltseng: 0,6 m;
  - rundt spisebordet: 0,65–0,7 m;
  - foran skrivebordet: 0,85 m.
  
  Ryddesonene ligger inne i rommet. Stoler og nattbord hører til sitt møbel og kan stå i møbelets egen sone.
- Etter hvert møbel sjekker et gangrutenett med 5 cm celler, med spillerens radius 0,3 m og møblene 2 cm mindre slik
  SceneSync lager kolliderne, at hver dør i rommet fortsatt når de andre, og at figuren kommer fram til hvert møbel:
  - foran skap og sofa;
  - på begge sider av en dobbeltseng;
  - på siden eller ved fotenden av en enkeltseng.

  Et møbel får heller ikke stenge av mer enn 0,5 m² av det åpne gulvet, selv uten dør der. Et hjørne bak et nattbord er
  greit, men ikke en vegg av møbler tvers over en stue.
  Et møbel som stenger, prøves et annet sted, i mindre størrelse, eller utelates.

**Rommene:**

| Bruk | Møbler |
| --- | --- |
| stue | sofa mot en vegg, helst lang og med plass til TV-en rett overfor (2,6 m fra 14 m², ellers 2,25 m, under 10 m² 1,7 m); sofabord 0,42 m foran og teppe under; TV-benk på veggen rett overfor og TV over den (når veggen er hel); bilde over sofaen; lenestol ved sofabordet fra 14 m²; gulvlampe ved sofaenden; bokhylle eller skjenk fra 16 m²; plante i et hjørne. «Stue/kjøkken» (eller et kjøkkenhint) og minst 20 m², eller fra 28 m²: spisebord med stoler foran lenestolen |
| kjøkken | uten kjøkkenhint holdes den lengste hele veggen (minst 1,8 m) fri til benken (0,62 m + 1,0 m arbeidsgulv); spisebord med stoler der det er plass, ellers et bord for to mot en vegg |
| spisestue | spisebord med stoler midt i rommet, skjenk, plante |
| soverom | seng etter rommet: 180 når den korte siden er minst 3,0 m og rommet minst 11 m²; 160 fra 2,7 m og 9 m²; 140 fra 2,4 m og 7 m²; ellers 120. Er det ikke plass til begge sidene, blir senga mindre. Nattbord ved hodeenden, garderobe (opptil 1,8 m fra 12 m²) i et hjørne der himlingen er høy nok, kommode fra 11 m², teppe på tvers under fotenden fra 9 m², bilde over senga, plante fra 13 m² |
| kontor | skrivebord mot veggen nærmest et vindu, stol, gulvlampe, bokhylle (to fra 10 m²), lenestol fra 11 m², plante |
| gang, entré | benk eller skoskap når gangen er minst 1,25 m bred (benk fra 1,6 m); knagger over, eller nær ytterdøra; speil; stumtjener i en entré fra 1,7 m bredde; løper når gangen er minst 1,0 m bred og 2,4 m lang |
| bad | badematte, skittentøykurv i et hjørne, håndklestige (fra 4 m²) |
| wc | badematte (og kurv fra 2,5 m²) |
| vaskerom | skittentøykurv |
| bod, garderobe | bokhylle eller garderobeskap langs veggene (ett til, når rommet er minst 2,4 m langt) |

Badene og vaskerommene får bare løst inventar. De faste installasjonene er en egen oppgave. Når de kommer som
`house.builtIns`, er de keep-outs, og møblene flytter seg av seg selv.

**Katalogen:** hver rolle tar katalogens produkter i rekkefølge (Bohus først), for eksempel `bed` per madrassbredde
(`params.mattressW`), `sofa` (`sofa-straight`, ikke sovesofa), `rug` (ikke løpere eller runde tepper) og `desk`
(underkategori `skrivebord` eller arketypen `desk`). Blant de tre beste som passer, velges det med en generator med
frø per rom: det samme huset gir de samme møblene. Katalogen har ennå ikke skrivebord eller kontorstoler. Da står
IKEA LISABO 140 × 78 som skrivebord med en spisestol. TV-en finnes ikke i katalogen og blir en egen 55″ (`source:
'custom'`, arketype `tv`).

## I 3D og i spillet

- **Planbyggerens visning og dev-sidene** (`buildLayout` + `buildRooms`, ingen `ctx.design`): `rooms.js` kaller
  `buildFurnishing` når huset har `furnishing`.
  - Modellene legges i rommets `contents`.
  - Kolliderne kommer i `colliders` som `Box3`: én per gulvmøbel over 0,3 m, eller modellens egne bokser, 2 cm mindre på
    hver side som SceneSync sine.
  - Resultatet ligger i `rooms.furniture`.
  - Visningen trenger ingen endring, fordi `viewer.js` allerede legger `colliders` inn som statiske bokser.
  - Kolliderne er statiske, så møblene stopper figuren alltid (som «Fysisk person»).
- **Spillet:** `existing.js` `furnishedItems(layout)` gir de samme møblene som originale designelementer. Det er
  katalogelementer med uid `mb-<rom>-<n>` og y over rommets gulv. `originalItems(layout, { rooms })` tar dem med, og
  `DesignState` regner rommene som møblerte. Da bygger SceneSync dem som dynamiske møbelbokser, med `ghostFurniture`
  som før, og `buildRooms` lar være (fordi `ctx.design` finnes). Spillet laster i dag bare eierens hus. Veien er
  testet i Node.
- **Teksturer:** `furnishingKinds(layout)` (`furnish.js`) gir materialene møblene trenger, så de kan lages på forhånd
  med `prepareMaterials`. Uten det lages de når modellene bygges.

**Gangtesten** (i `moblering.test.mjs`, som `tools/walkmap.mjs`): spillerens kapsel, løftet med trinnhøyden, testes på
et rutenett med 10 cm celler i spillets `CollisionWorld` med alle kolliderne i huset. I testhuset når figuren alle ni
rom og alle ti dører og passasjer fra ytterdøra, med møblene som uten dem, og den når hele det åpne gulvet i hvert rom.
Møblene stenger faktisk: det frie gulvet i Soverom 1 går fra 891 til 303 celler. På `dev/moblering.html` går spillets
`PlayerController` (`__walkTo`) fra ytterdøra gjennom gangen og inn i soverommene, badet, kontoret og stua, rundt
spisebordet til terrassedøra.

## Til planbyggeren: dette skal sendes

1. **`furnishing.hints`** fra `readPlan` sin `furniture: [{ kind, at }]`. `at` er 0–1 i bildet KI-en fikk, og må gjøres om
   til planmeter slik romlabelene gjøres (`houseread.js`). Deretter går det til husets meter med
   `houseFrame(doc, found).toGame(p, levelId)`, som i `src/dev/moblering-hus.js`. Ta med `levelId`. `kind` sendes som
   KI-en ga den; `other` kan droppes.
2. **`furnishing.rooms[id].use`** når KI-en ga en romtype `ROOM_KINDS` ikke har: `kitchen`, `dining`, `office`, `wc`,
   `wardrobe`, `technical` eller `garage`. Det trengs ikke når romnavnet sier det («Kjøkken», «Kontor»).
   `rooms[id].off: true` brukes for et rom brukeren ikke vil ha møbler i. `auto: false` gir bare hintenes møbler.
3. Ingenting annet. `buildRooms` bygger møblene i visningen, og `colliders` har kolliderne. `registryFor`/`schema` har
   allerede `furnishing` i `topLevel`, og `validateHouse` sjekker feltet. Det koster 0,2–1,4 s per hus i Node (hus2
   0,3 s, hus1 0,6 s, hus9 1,4 s, testhuset 0,5 s), og resultatet lagres per layout. Vil dere unngå at teksturene lages
   midt i byggingen, kall `prepareMaterials(furnishingKinds(layout))` først.

Prøvd på alle planbyggerens testhus (hus1–hus9 med KI-opptakene og `furnishing: {}`):
- Ingen krasj, og 18–62 møbler per hus. hus7 har ingen rom, som er det kjente avviket i KI-testen.
- Alle rom med dører når dørene sine.
- I hvert rom når figuren minst 90 % av det åpne gulvet. Unntaket er hus4 «sov» (7,5 m²) med 69 %, fordi det er et
  hjørne på 0,5 m² bak garderoben.
- Tomme rom: bare de som er for små (garderober på 1,3 m²) eller uten dør (hus4 «bad-3»).

## Kjent og ikke gjort

- **Rettet 23.10 (planbyggerøkta):** `roomInput` holdt «foten» av trappa fri ved `walkLine[0]`, men layout går fra
  toppen til foten, og ved toppen oppe var ingenting fritt. hus3 uten KI fikk en sofa der trappa kommer opp, og figuren
  kom ikke av trappa. Nå holdes 1,6 × 1,6 m fritt foran foten nede og foran toppen oppe, 0,5 m ut langs ganglinja.

- **Trang stue/kjøkken:** i testhusets stue (24 m² med kjøkkenbenk, sofagruppe og passasje) får spisebordet tre stoler
  på én side. Bord og stoler prøves sammen, og plassen med flest stoler vinner.
- **TV-benken** står mot veggen rett overfor sofaen. Er midten av den veggen en dør eller et gulvvindu, flyttes den til
  siden. Er veggen over den et vindu, kommer det ingen TV.
- **Kjøkkenbenken** bygges ikke. Gulvet holdes fritt til den, og en annen oppgave må bygge den.
- **Gulvlampene** har ingen lyskilde i planbyggerens visning (lyset er belysningsøktas). I spillet får de lyset sitt som
  andre lamper fra katalogen (SceneSync).
- Tekstiler på sofa og seng (puter, pledd) og småting på bord er ikke med.
