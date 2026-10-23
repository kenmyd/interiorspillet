# Katalog runde 3 – møbler, lys og kunst

Runde 3 la til **225 nye produkter** (372 → 597) og to nye kategorier, **Spotter og downlights** og **Kunst og bilder**.
Alle prisene, målene og lenkene er hentet 2026-10-21 fra butikkenes egne produktsider. Plan og kontrakter:
`ARCHITECTURE.md` §2, §5, §6, §13; QA og integrasjon: `notes/qa-mobler-lys-kunst.md`.

## 1. Kategoriene

Rekkefølgen er `normalize-data.mjs CATEGORY_KEYS` (24): Sofaer · Lenestoler · Bord · **Stoler og krakker** · Skjenker ·
TV-benker · Vitrineskap · Hyller · Senger · Nattbord · Kommoder · Garderobeskap · Speil · Bad · Gang · Taklamper ·
**Spotter og downlights** · Små lamper · **Puter, pledd og puffer** · Tepper · Solskjerming · Akustikk ·
**Kunst og bilder** · Smått.

| Kategori | Undergrupper (nye produkter) → arketyper |
|---|---|
| Sofaer | 2-seter, 3-seter, 4-seter, hjørnesofa, sjeselong, sovesofa → `sofa-straight`, `sofa-modular-l`, `sofa-curved` |
| Bord | sofabord og salongbord, sidebord, skrivebord, konsollbord → `coffee-table`, `desk`, `side-table-round` |
| Stoler og krakker | spisestoler, barstoler og barkrakker, krakker, kontorstoler, spisebenker → `chair`, `shell-chair`, `bar-stool`, `stool`, `office-chair`, `bench` |
| TV-benker, Vitrineskap, Kommoder | → `tv-bench`, `display-cabinet`, `dresser` |
| Hyller | bokhyller, vegghyller → `bookcase`, `wall-shelf` |
| Nattbord | (vanlige), vegghengte → `bedside-table`; runde nattbord → `coffee-table` (`shape: 'round'`) |
| Gang | benker → `bench` |
| Puter, pledd og puffer | puffer → `pouf` |
| Små lamper | bordlamper, arbeidslamper, gulvlamper, vegglamper → `table-*`, `table-task`, `floor-*`, `wall-arm`, `wall-sconce` |
| Spotter og downlights | innfelte downlights, utenpåliggende downlights, takspotter, spotskinner, veggspotter, bildebelysning → `downlight`, `downlight-surface`, `spot-ceiling`, `spot-track`, `spot-wall`, `picture-light` |
| Kunst og bilder | lerret, malerier og glassbilder; innrammede bilder; plakater; bildevegger og sett; rammer (tomme, kan få eget bilde) → `art-frame`, `art-set` |

Flyttet ved runden (id-ene er de samme, lagrede design virker): de fire bildene fra Smått (Ramor, Mara, Gustin, Labyrint)
til Kunst og bilder → Lerret, de fire sidebordene fra Smått til Bord → Sidebord, og de åtte spisestolene til Stoler og
krakker → Spisestoler. Under brikkene i Spotter står «Vegglamper med skjerm finner du under Små lamper → Vegglamper», og
i Smått «Bilder og kunst har fått egen kategori».

## 2. Antall

| Kategori | Før → etter | Nye per butikk |
|---|---|---|
| sofa | 11 → 23 | Bohus 8, IKEA 2, Skeidar 1, Jysk 1 |
| bord | 14 → 35 | Bohus 14, IKEA 5, Skeidar 2 |
| stoler | 8 → 30 | Bohus 15, IKEA 5, Jysk 1, Skeidar 1 |
| tvbenk | 7 → 14 | Bohus 4, IKEA 2, Skeidar 1 |
| vitrineskap | 5 → 10 | Bohus 3, IKEA 1, Skeidar 1 |
| hylle | 11 → 22 | Bohus 6, IKEA 3, Jysk 2 |
| nattbord | 10 → 22 | Bohus 7, IKEA 4, Jysk 1 |
| kommode | 10 → 21 | Bohus 6, IKEA 2, Skeidar 2, Jysk 1 |
| gang | 14 → 17 | Bohus 2, IKEA 1 |
| spotter | 0 → 37 | Elektroimportøren 16, Lampehuset 9, Bohus 6, IKEA 4, Lampemesteren 2 |
| smalamper | 34 → 61 | Bohus 12, Lampehuset 7, IKEA 5, Nordic Nest 3 |
| tekstil | 24 → 31 | Bohus 4, IKEA 2, Jysk 1 |
| kunst | 4 → 54 | IKEA 22, Bohus 18, Nordic Nest 10 |
| **Totalt** | **372 → 597 (+225)** | **Bohus 105, IKEA 58, Elektroimportøren 16, Lampehuset 16, Nordic Nest 13, Skeidar 8, Jysk 7, Lampemesteren 2** |

«Før» er tallene etter at grunnarbeidet flyttet bildene, sidebordene og stolene (kunst 4 = de fire flyttede bildene).
Gulvlamper 22 → 27. `EXPECT` i `tools/test-design.mjs` har tallene. Bohus har flertallet i alle møbelkategoriene; i
spotter selger Bohus bare 6 armaturer (alle er med), og i kunst har Bohus bare 10 modellerbare bilder i salg, så IKEA
fyller opp.

## 3. Slik ble katalogen laget

1. **Forskning** (RA–RG, én eier per fil): `research/catalog-new/*-runde3*.json` (15 filer). Produktene er skrevet
   i normalisert form, med `shapeNote` (hva modellen forenkler) og `verifiedNote` (hva som er bekreftet og hva som er
   anslått). Duplikater på tvers av filer ble stoppet med «claims» per butikk og varenummer.
2. **Sjekk**: `node tools/check-research.mjs research/catalog-new/*-runde3*.json --build` (reglene i
   `tools/lib/research-rules.mjs`, normalisering i en temp-mappe og bygging av hvert produkt i Node). Ved slutten:
   0 FAIL og 19 WARN etter regenereringen: butikkmål utenfor glidebryterne (8), byggergrenser (4), runde nattbord
   som `coffee-table` (2, riktig) og de 5 ikke verifiserte. (Før regenereringen er det flere: en ny parameter er
   «ukjent» til den finnes i katalogen.)
3. **Ærlighetssjekk**: 30 tilfeldige `verified: true`-produkter (2 per fil) sjekket på nytt mot butikkene uten cache:
   pris, kampanjepris, mål og URL stemte for alle.
4. **Regenerering**: `node src/data/scripts/normalize-data.mjs --only=catalog` (eneste vei inn i `src/data/catalog`).
   Rettelser på eldre produkter står i `src/data/scripts/fixes.mjs`. En ny kjøring gir ingen endring.
5. **Miniatyrer og tuning**: `thumbcheck --new-since=c28070d --variants=all --sheets --photos` ga sammenligningsark mot
   butikkfotoene. Produkter som så feil ut, ble rettet i en tuning-runde: forskerne justerte data, og modelleierne la
   til nye (skjulte) parametre i byggerne, f.eks. Ritz' kryssfot, Stords rør og knagger, Rangoons forskjøvne rom,
   JANINGEs skallrygg, Ella pall' meier, Arum arched' avrundede steinfot, Trysils to skjermer og motivvarianter for
   Hjort, Tay, Menor og Birds.

## 4. Ikke verifisert (5)

`verified: false` betyr at butikken mangler et mål, og at det er anslått fra produktbildet (står i `verifiedNote`).

| Produkt | Butikk | Hva mangler |
|---|---|---|
| Stave vegglampe H30 | Bohus | bredde/diameter (Ø12 anslått) |
| ÅRSTID vegglampe | IKEA | høyde (H30 anslått) |
| BÄVE LED takskinne, 3 spotter | IKEA | høyde (9 cm anslått) |
| Namron Pluto 3-spot skinne GU10 | Elektroimportøren | høyde |
| Namron Rock skinnesett 3 spot | Elektroimportøren | høyde (15 cm anslått) |

Andre anslag som står i dataene: Plejd-downlightene har `colorK` 2700 (de kan stilles), Philips Hue Centura har anslått
350 lm, og Unex-driveren er med som tilbehør med `perUnit` 0,5 (én driver per to spotter).

## 5. Kjente hull i utvalget

- Ingen utenpåliggende downlight-sylinder i sort eller messing hos butikkene vi bruker (bare Valerie i opalglass).
- Ingen takspot med 2 hoder på plate eller stang.
- Ingen bordlampe med opalrør og ingen klassisk vegglampe med svingarm og tekstilskjerm i salg.
- Gulvlampe med flere hoder dekkes bare av Cannes uplight (uplight og lesearm).
- Bankerlampen fra Lampehuset er ikke på lager i nettbutikken (står i prisnotatet).
- Bohus har ikke noe 100×150-lerret i salg, og de fleste innrammede trykkene deres er utgående; glassbildene Earn og
  Afterparty kan ikke modelleres.
- Nordic Nest selger ikke par eller triptyk som sett, så bildeveggene er IKEA-sett.
- Ikke modellert: leselamper med flere spothoder på gulvlampe, vegglampe med egen lesearm, rektangulære LED-plafonder.
