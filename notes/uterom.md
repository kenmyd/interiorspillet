# Uterom: carport, åpen garasje og overbygd inngang

Et rom kan nå være ute. Det gjelder en carport, en åpen garasje og en overbygd inngang eller veranda under en etasje
(planbygger-forespørsel 18, F149). Feltet er `rooms[].outdoor`. Et uterom er fortsatt et rom i huset, med vegger,
gulv, himling, kollisjon og dører, men motoren bygger det som ute:

- **Veggene mot rommet har kledning, ikke maling.** De følger `cladding`-sonene (`notes/kledning.md`), med sokkel,
  beslag og omramming rundt dører og vinduer i dørens eller vinduets karmfarge. Det gjelder uterommets egne vegger og
  baksiden av en skillevegg der uterommet har en `backOf`-flate. Smygene, for eksempel stolpene og bjelken ved den
  åpne siden, er i `trim.color`. Det er ingen fotlist, og ingen flate i uterommet kan males.
- **En dør mellom et uterom og et innerom er en ytterdør.** Den har ytterdørblad, karm og ramme ytterst, uansett hva
  slags vegg den står i. Eier uterommet veggen, bygges døra fra innerommets side, slik at yttersiden vender mot
  uterommet.
- **Gulvet er betong eller belegning.** `floor.material` `'concrete'` gir støpt betong med tekstur, som på dekkene.
  `'paving'` gir belegningsstein (`floor.size`, standard `[0.21, 0.14]`). Fottrinnene høres ut som belegningen ute.
- **Det er ingen innvendig himling.** Himlingen er undersiden av det som er over (`rooms[].soffit`, se under), uten
  taklist. Under et tak følger den taket, som før.
- **Lyset er utelys.** En `plafond` i et uterom blir en downlight i himlingen (350–800 lm), og validatoren varsler.
  Lysgruppa til et uterom er på når sola er nede (`auto: 'evening'`, som «ute» i eierens hus), med mindre gruppa sier
  noe annet.
- **Lyd og akustikk er som ute.** Møbler i et uterom teller ikke i noe rom, og et uterom har ingen etterklang.
  Akustikkmerket viser det siste rommet, slik det gjør ute.

Et hus uten `outdoor` bygges som før. Eierens hus er uendret: fingeravtrykket er `layout 9fd8f7a355b0f410`,
`rooms a7cf211c026c6559` og 301 mesher, likt før og etter. `uterom.test.mjs` sjekker det.

## Formatet

```json
{ "id": "r7", "name": "Carport", "kind": "storage", "outdoor": "carport", "levelId": "hoved",
  "polygon": [[7, 0.3], [12.7, 0.3], [12.7, 5.35], [7, 5.35]],
  "floor": { "material": "concrete", "color": "#a7a49e" }, "ceilingIds": ["c-r7"], "acoustic": { "mode": "estimate" },
  "soffit": { "type": "boards", "color": "#8a6a4f" } }
```

| Felt | Standard | Betydning |
|---|---|---|
| `rooms[].outdoor` | – | `'carport'`, `'garage'` (åpen garasje) eller `'porch'` (overbygd inngang eller veranda under en etasje). Uten: et vanlig rom. `kind` beholdes, for eksempel `'storage'`. |
| `rooms[].floor.material` | – | `'concrete'` (støpt) eller `'paving'` (belegning, `floor.size` i meter). Andre materialer bygges som inne, og validatoren varsler. |
| `rooms[].soffit.type` | `'boards'` | Undersiden over uterommet: `'boards'` (rett kledning), `'panels'` (plater, `soffit.module`), `'concrete'` eller `'paint'`. |
| `rooms[].soffit.color` | takets `soffitColor` under et tak, ellers `cladding.default.color` (uten `cladding` `#4a4642`) | `ceilings[].color` brukes ikke i et uterom. |

- **Kledningssoner:** En sone kan nevne uterommets vegg i `walls`, enten veggen uterommet eier eller `backOf`-flaten
  dets. Bodfronten i carporten er for eksempel carportens vegg mot boden. En innervegg som ikke vender mot et uterom, er
  fortsatt en feil («er ikke en yttervegg»).
- **Den åpne siden:** En vegg som er én åpning (`type: 'opening'`, `connects: [uterom, 'ute']`), slik planbyggeren
  lukker carporten i dag. Over åpningen blir det en bjelke med kledning på begge sider. En åpning uten dør eller vindu
  har ingen omramming (det gjelder alle hus med kledning), og smygen er i `trim.color`.

## Det som også er rettet

- **Ytterlaget under et dekk:** En yttervegg uten tak over, med et dekk fra etasjen over, har nå kledningen opp til
  undersiden av dekket. Før gikk den 0,3 m over veggen, og kledningen sto da inne i dekket eller i samme plan som
  dekkets kant (terrassen over hus4s carport).
- **Dekk i flukt med to fasader:** Dekket regner nå husveggens ytterflate helt ut til hjørnet (over gjæringen). Før fikk
  et dekk som går helt ut til hjørnet, et kort stykke rekkverk langs husveggen. Rekkverket slutter 1,2 cm fra
  hjørnekassa, ikke fra veggen, når huset har `trim.corners`.

## Validatoren

- **Feil:** `outdoor` som ikke er `carport`, `garage` eller `porch` (enum i `research/house/00-ids.json`), og
  `soffit` med ukjent `type`, ugyldig `color` eller `module`.
- **Advarsler:** et uterom med et annet gulv enn `concrete` eller `paving`, et uterom uten åpning eller dør ut
  (`connects` med `'ute'`), en `plafond` i et uterom (den blir en downlight), `soffit` på et rom som ikke er ute, og
  ukjente felt i `soffit`.

## Testhuset

`dev/uterom.html` (`src/dev/uterom-hus.js`) er bygd etter hus4. Det har to etasjer med en overbygd inngang under
2. etasje: belegning, hvite himlingsbord, to åpne sider med en hjørnestolpe og ytterdøra inn til gangen. Ved siden av
står et tilbygg med carport og bod under en terrasse fra 2. etasje. Carporten har betonggulv, er åpen mot sør og har
en bjelke over åpningen. Bodfronten har grå plater og en grå dør (F149). Døra eies av carportens vegg og bygges derfor
snudd. Carporten har også en ytterdør inn til stua. Knappene viser visningene. «Tak» skjuler himlingene, «Kveld» viser
lampene, og «Gå» lar deg gå med spillets figur. Testserveren er «uterom-test» i `.claude/launch.json`, port 5274.
Testen er `node tools/house-tests/uterom.test.mjs` (også i `node tools/test-house.mjs`).

## Til planbyggeren

Planbyggeren har allerede `outdoor: main.kind` på rommene i dokumentet (`generate.js`). Dette må `export.js` sende:

1. **`outdoor` på rommet:** `'carport'` eller `'garage'` for en carport eller garasje, og `'porch'` for en overbygd
   inngang eller veranda under en etasje. `'terrace'` og `'balcony'` er dekk, ikke rom. Behold `kind` (`'storage'`).
2. **Gulvet:** `{ material: 'concrete', color: '#a7a49e' }`, eller `'paving'` for belegning. Ikke `LOOK.floor.storage`
   (`'concrete'` `#8a8580` virker, men er mørkere).
3. **Himlingen:** Send `ceilings[]` som før (høyden er der undersiden er). Fargen sendes i `soffit`, ikke i `color`,
   for eksempel `soffit: { type: 'boards', color: <kledningens farge> }`. Uten `soffit` velger motoren selv.
4. **Lyset:** én eller flere `type: 'downlight'` (`dims: { d: 0.09 }`, 350 lm, `lightColorK: 2800`) i himlingen, ikke
   en `plafond`. Lysgruppa trenger ingen `auto`, for motoren setter `'evening'`.
5. **Dørene:** en dør mellom uterommet og et innerom blir ytterdør av seg selv. Den slår normalt ut i uterommet.
   F149 sier at døra og bodfronten skal være grå i samme farge, og da må dette sendes:
   - `door.leafColor` og `frame.color` i platefargen;
   - `door.lining.color` i samme farge, ellers blir foringen i karmen antrasitt (`#1d1e21`);
   - en kledningssone med `walls: [<carportens vegg mot boden>]`, `type: 'panels'`, `color` som over og eventuelt
     `module`.
6. **Den åpne siden:** fortsett med veggen som er én åpning (`closeAround`), med `connects: [uterommet, 'ute']`.
   Validatoren varsler hvis et uterom ikke har noen åpning ut.
7. **Terrassen over:** legg dekkets kanter på ytterflatene til tilbygget. Kanter i flukt med fasaden er nå i orden, og
   kledningen stopper under dekket. Et eget flatt tak under dekket trengs ikke.
8. **3D-visningen** trenger ingenting nytt. `buildRooms` gjør alt dette.

## Kjente begrensninger

- **Vinduer:** Et vindu i en vegg som uterommet eier, mot et innerom, bygges med yttersiden mot innerommet. Det
  gjelder ikke dører. Vinduer i innerommets vegg og i uterommets yttervegger er riktige.
- **Hjørner:** Innvendige hjørner i uterommet har ingen hjørnelist. Beslagene der stopper 2,5 cm før hjørnet, så de
  ikke møtes i samme plan.
- **Lys:** `lighting.js` behandler et uterom som et rom med en stor åpning ut. Kameraet i carporten eksponeres etter
  carportens egen modell, ikke som ute. Det kan økta for belysning i genererte hus se på.
- **Port:** En garasjeport (forespørsel 11) finnes ikke ennå. En åpen garasje er en vegg med en åpning.
