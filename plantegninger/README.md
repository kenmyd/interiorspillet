# Testplaner for planbyggeren

Én mappe per hus. Mappen inneholder filene slik en kunde ville lastet dem opp: plantegningene og eventuelle
fasadetegninger, med originalnavn og originalformat. Tegninger hentet utenfra har en `info.txt` med kilden.

**Kun til interne tester i det private repoet.** Tegningene tilhører husleverandørene, meglerne og forfatterne.
Ikke del dem videre, og ikke bruk dem i markedsføring.

| Mappe | Hva | Hvorfor den er med |
|---|---|---|
| `hus1` | 1½ etasje med saltak, ark og takvinduer, svarte vegger, bare romarealer, 4 fasader (AVIF) | skala fra arealer, trapp som svinger 90°, skråtak på loftet, dobbeltdører, skyvedør |
| `hus2` | én etasje, grå vegger, ytre mål på tegningen, «SKRÅ HIMLING 24°», fasader på ett ark | skala fra ytre mål, takhøyde som tekst, terrassefliser og parasoll utenfor |
| `hus3` | to etasjer med titlene «Etasje 1»/«Etasje 2», ytre mål, rett åpen trapp, fasader på ett ark | rekkefølge fra titlene, et «normalt» hus |
| `hus3-foto` | hus3 1. etasje skrevet ut og fotografert skrått med mobil | finne arket, rette opp perspektivet, ujevnt lys og skygge – fasiten er hus3 |
| `hus4` | moderne, stue/kjøkken i 2. etasje, carport, takterrasse, pulttak, lysegrå vegger, tregulv-skravur, komma i arealene, 4 fasader (AVIF) | den vanskeligste stilen, trapp som svinger 180° |
| `hus5` | én etasje med pulttak, «Skråhiml.»-linjer, skyvedører, arealer, 4 fasader (AVIF) | skråtak inne, skyvedører |
| `hus6` | Oslo kommune: arkitekttegning for byggesøknad (PDF, skannet), 1:100, målekjeder i mm, skrå vegg | målekjeder, målestokk, skrå vegg, skravur, forklaringstekster oppå |
| `hus7` | Oslo kommune: garasje med plan, snitt og fasader på ett ark (PDF, skannet) | flere tegninger på ett ark, kotehøyder |
| `hus8` | FINN-meglertegning: kjeller + 1. etasje + garasje på ett ark, og hver for seg; bare romnavn | ingen arealer eller mål → skala fra standardmål eller BRA |
| `hus9` | Byggebolig.no: hobbytegning av sokkelhus, øvre etasje og underetasje, lav oppløsning | lav oppløsning, teksturgulv, fargede møbler |
| `hus10` | ferdighus i én etasje, saltak, «Mønt himling» og «Skrå himling» langs stiplede linjer, 2 fasader (gavlene, AVIF) | himling som følger taket etter tekst, skyvedører, bare to fasader |
| `hus11` | toetasjes ferdighus med valmtak, U-trapp med svingtrinn, skråvegg ved soverommet, «Loftstue» i full 2. etasje, 4 fasader (AVIF) | valm sett fra langsiden, skrå vegg med dør, en stiplet kanal over et åpent rom |
| `hus12` | halvannenetasjes ferdighus med saltak og bred ark over balkongen, kvartsvingt trapp, 2. etasje tegnet i en annen målestokk, 4 fasader (AVIF) | loft uten egne knevegger (takfoten 1 m over gulvet), sprosser og overlys, ulik målestokk per etasje |

## `_png/`

Node-testene leser bare PNG (`tools/planbygger-png.mjs`). `_png/<hus>/<fil>.png` er PNG-kopier av filene som ikke
er PNG fra før:

- AVIF og JPG er konvertert med ffmpeg (RGB, full oppløsning).
- PDF-ene er skannede bilder inni en PDF. Bildet på side 1 er trukket ut i full oppløsning, i gråtoner.

Nettleseren skal få originalene: opplastingen må tåle AVIF, JPG og PDF.
