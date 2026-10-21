# Avstemming av byggeplanen mot de ferdige fotonotatene

**Denne fila OVERSTYRER `hele-huset-design.md` der de er uenige. Steg som bygges senere, skal følge den.**
Rekkefølgen er: `notes/hele-huset-fakta.md` (eieren, fasit), så denne fila, så fotonotatene i `notes/hus-foto/`, og til
slutt `hele-huset-design.md`. Fotonotatene og `oversikt.md` er ikke rettet. Der de er uenige med denne fila, gjelder
denne fila. Alt som ikke er målt, merkes `estimated` i dataene, som før (§8.6).

Akser som før: +x = sør, +z = vest, y opp, gulvet i 1. etasje er y 0. `yaw` i grader: 0 = øst, 90 = nord, −90 = sør,
180 = vest. Alle tall er spillkoordinater (meter) i den nye rammen fra V1–V2, hvis ikke annet står.

---

## 1. Kjellerens plassering

| # | Beslutning | Erstatter | Grunnlag | Sikkerhet |
|---|---|---|---|---|
| V1 | Kjellerplanen legges med **ytterflatene i flukt** med planen for 1. etasje: `x = (px − 127,0)/60,25 + 0,13` og `z = (py − 119,9)/60,25 + 0,13`. I data: `levels.kjeller.plan = { pxPerM: 60.25, originPx: [119.2, 112.1] }`. Kjellerens innvendige nordvegg står på x 0,13 og østveggen på z 0,13. | D3 (origo px (127, 120) = (0, 0)), §1.6 `levels.plan` | Kjellerplanen tegner nord- og østveggen 0,29 tykke, 1. etasje 0,16 (px 109,2–126,9 og 83,0–91,1). Med D3 får hylla i sjakta null dybde, men 225349 viser en tydelig avsats. Trinn 1 havner 1,58–1,60 fra kjellerens nordvegg i begge rammer. | høy |
| V2 | **Ingen strekk i z.** Samme skala, 60,25 px/m, i x og z. | D3 (z = (py − 120)/56,8, strekk 6,1 %) | Planen er isotrop: 10,50 = 632,7 px og 11,84 = 712,8–714,1 px. 3,70 / 2,84 / 2,32 / 3,40 / 2,51 stemmer på ±2 cm. Uskalert gir eierens arealer: kjellerstue 20,60 (eier 20,57), soverom 7,44 (7,41), bod 2 9,91 (9,93). Strekket ga 22,0 / 7,73 / 10,7. Takhøyden i soverommet stemmer bare uten strekk (225721 og 225723 gir begge 2,22–2,25), og termostaten blir 8,6 cm (standardmål). | middels |
| V3 | **Sjaktveggene låses til 1. etasje:** nisjeveggen ligger på z 2,22–2,32 for x 0,13–1,85 (rett under veggen bad/gang), og sjaktens vestvegg (= badveggen i kjelleren) på z 4,43–4,55 for x 0,13–3,05 (rett under veggen gang/soverom, D1 beholdes, se V54). Samme 4,43 brukes i hull, trapp, rekkverk og kjellervegg. | D3 (låsing for x < 1,75 og x 0–2,91), §2.7 Gang (nisje for x < 1,75), oversikt.md (4,40) | 1. etasje: veggen bad/gang ligger på z 2,22–2,32 (py 166,0–171,1). Nisjehjørnet følger veggen bod 1/bod 2 (x 1,79–2,06) og havner på x 1,85. Badveggen er tegnet 0,12 tykk (py 369,8–377,0), men tegnet 0,15 for langt øst. Sjakta krever gangflaten rett under veggen oppe. | høy (2,32), middels (4,43) |
| V4 | **Rett vestlinje på z 11,38** (innvendig) for kjellerstua og soverommet, med ytterflate z 11,68. Da krager 1. etasje 0,55 ut i modellen (0,41 i virkeligheten). En himling på y −0,30 lukker undersiden for z 11,68–12,23 og x −0,30 … 7,22. Grunnmursboksen under `w-vest-stue` fjernes uten erstatning. | D3 (vestvegg i flukt, z 11,93), §2.8 (boksen «erstattes av kjellerens vestvegg») | Tegningen: innerflate py 797,3–798,7, ytterflate 815,0–816,3. Kolonnen sjakt + badvegg + vaskerom + vegg + soverom + yttervegg når ikke 12,1 uten å strekke rom som er kontrollert mot bildene. En homografi i 225655 gir SV-hjørnet 6,0–6,2 fra østveggen. Vestfasaden er ikke fotografert. | middels |
| V5 | **Vaskerommet tar restkorreksjonen** i vestkolonnen: vaskerom z 4,55–8,45 (2,63 × 3,90), vegg z 8,45–8,55, soverom z 8,55–11,38 (2,63 × 2,83). Kjellerstua blir z 5,32–11,38 (3,40 × 6,06). Planteksten 4,08 for vaskerommet brukes ikke (se §7, punkt 4). | §1.4 vaskerom / soverom-kjeller / kjellerstue; oversikt.md-tabellen (vaskerom 4,55–8,63, soverom 8,75–11,57, kjellerstue 5,28–11,33) | Tegningen har én rett vestvegg (py 797,3 og 798,7), og døra måles 0,49 fra vesthjørnet fra begge sider (225702, 225723). oversikt.md får et sprang på 0,24 fordi den bygger kjeden av planteksten «1,83», som står på en strek tegnet 1,72. Eieren har oppgitt arealet for kjellerstua og soverommet, men ikke for vaskerommet. | middels |
| V6 | **Kjellerstuas sørvegg:** innerflate x 6,45, ytterflate 6,75. Stua krager 0,47 ut i modellen (0,33 i virkeligheten). Himling på y −0,30 for x 6,75–7,22 og z 6,75–11,68, i ett med himlingen i vest (V4). Grunnmursboksen under `w-sor` fjernes. Forslaget i ytterdor-ute.md om flukt med 7,22 forkastes. | D9 (innvendig 6,32 / utvendig 6,62, utkraging 0,60), §2.8 «Utkragingen» og grunnmursboksene | Tegningen: kjellerstua er px 303,1–508,0 (3,40) og sørveggen 508,0–525,6. 6,62 er modellens kjøkkenvegg (0,30 tykk), ikke en kjellerlinje. Flukt med 7,22 krever en stue på 3,87, og da ville TV-veggen i 225644 gitt ca. 2,5 i takhøyde mot målte 2,21–2,25. | middels |
| V7 | **Hjørnesøyla i entréen** er kjellerstuas SØ-hjørne: x 6,16–6,75 og z 5,23–6,05. Østflaten er veggen gang/kjellerstue (z 5,23), sørflaten er kjellerstuas ytterflate (x 6,75), og nordflaten er entréens nordvegg (x 6,16). Den bygges som hjørnet av kjellerstua, med vegger rundt og rommet bak, ikke som en massiv kloss. Den stikker ca. 0,35 fram foran garderobefronten. | D9 og §1.4 entré (søyle 0,56 × 0,56, x 6,01–6,57 · z 5,47–6,03); entre-gang-kjeller.md (0,56 × 0,78) | Planen tegner søyla som stuas hjørne bak veggstreken. «Gulvstripa» notatet ser i lokal x 0–0,30, er stuas eget hjørne. 225559, 225600 og 225621 viser søyla godt foran garderoben. | middels |
| V8 | **Entréen:** x 6,16–8,67 og z 3,12–6,05, altså 2,51 × 2,93 innvendig (eierens mål). Vestveggen settes på tegningens ytterflate, med ny ytterflate på z 6,26. Sørveggens ytterflate står på x 8,88. | §1.4 entré («2,51 × 2,93 → 2,50 × 2,88»), D3 | Den tegnede innerflaten er py 299,9–464,8 (2,74). Margmålet 2,93 går til ytterflaten av vestveggen. Med 2,73 ville garderoben bare vært 0,27 dyp (225559). | middels |
| V9 | **Rommet 3,70 × 2,84 (`bod-3`):** x 6,44–10,15 og z 0,13–2,97. Ytterflatene står på x 10,34 i sør (i flukt med pilaren) og z 3,18 i vest mot nisjen. Terrassedekket og himlingen går ut til x 10,35 over rommet og nisjen (z −0,30 … 6,0; −0,30 er østflaten fra V10). **D10 forkastes.** Søylene under terrassekanten (z 0,25, ≈ 3,4 og ≈ 6,55) fjernes fortsatt. | D10 (slutt på terrassekanten, 3,25 × 3,02), §1.4 bod-3, §8.4 pkt. 10; ytterdor-ute.md og oversikt.md (ytterflate 10,05) | Planen: innerflate px 730,5, ytterflate 741,9, altså 3,71 × 2,84 (eier 3,70 × 2,84). I 225543 går sideveggen ut av bildekanten, så 10,05 er bare et minimum. Kuttet på 9,80 strider både mot bildet og mot eieren. | middels |
| V10 | **Nord- og østfasaden:** innerflatene tas fra V1. Ytterlaget på kjellerens nord- og østvegger gjøres 0,13 tykkere enn tegningen, ut til x −0,30 og z −0,30, så modellens fasade går rett ned uten sprang. | D3 (implisitt flukt på −0,30), §2.8 ytterlag | Med V1 havner tegningens ytterflater på x −0,17 og z −0,16. room-spec: ytterveggene er tegnet 0,16 og modellert 0,30. Ingen rom påvirkes. | middels |
| V11 | **Alle kjeller- og utekoordinater** i `hele-huset-design.md` som er gitt i D3-rammen (§1.4, §2.6–2.9, §3.6, §7.4, §7.5 og `stairs.foot` i §1.6), erstattes av tallene i denne fila. Står det igjen et D3-tall uten erstatning, regnes det om med x_ny = x_D3 + 0,13 og z_ny = 0,943 · z_D3 + 0,13. Det gjelder ikke de låste sjaktveggene (V3). | §1.4, §2.6–2.9, §3.6, §7.4, §7.5, §1.6 | Følger av V1–V2. I D3 er alle x 0,13–0,15 for små, og z er feil overalt der strekket slår inn. | høy |

### 1.1 Romtabell, begge etasjer

Gulv og tak er verdens-y. Arealene er innvendige. «Eier» er fakta-fila.

| id | Rom | x | z | Gulv y | Tak y | Areal modell (eier) |
|---|---|---|---|---|---|---|
| `stue-kjokken` | Stue / kjøkken / TV-stue | som room-spec `floor.polygon` (x 0–6,92, L-form) | 0–11,93 | 0 | 2,40–3,00 (skrått) | 53,78 (uendret) |
| `bad` | Bad | 0–2,53 | 0–2,22 | 0 | 2,40 | 5,62 (2,53 × 2,22) |
| `gang` | Gang | 0–3,12 | 2,32–4,43 | 0 | 2,40 | 6,58 brutto, 3,14 uten hullet (3,11 × 2,07 = 6,44) |
| `soverom` | Soverom | 0–3,12 | 4,53–8,20 | 0 | 2,40 | 11,45 (3,11 × 3,69 = 11,48) |
| `trappehull` | Hullet (i `gang`) | `[[0,2.32],[1.45,2.32],[1.45,3.48],[1.85,3.48],[1.85,4.43],[0,4.43]]` | | 0 → −0,30 | – | 3,44 |
| `trapp` | Trappa (`kind:'hud'`) | fotavtrykket i §2.3 | | −2,55 → 1,0 | – | – |
| `kjeller-gang` | GANG | polygon (0,13; 2,32) (1,85; 2,32) (1,85; 2,56) (5,75; 2,56) (5,75; 5,23) (3,05; 5,23) (3,05; 4,43) (0,13; 4,43) | | −2,55 | −0,30 | 13,1 med nisjen, 12,7 uten (12,50) |
| `vaskerom` | Bad/vaskerom | 0,13–2,76 | 4,55–8,45 | −2,55 | −0,30 | 10,26 (planen 2,64 × 4,08, intet areal) |
| `soverom-kjeller` | Soverom (kjeller) | 0,13–2,76 | 8,55–11,38 | −2,55 | −0,30 | 7,44 (7,41) |
| `kjellerstue` | Kjellerstue | 3,05–6,45 | 5,32–11,38 | −2,55 | −0,30 | 20,60 (20,57) |
| `entre-kjeller` | Entré | 6,16–8,67, minus søyla x 6,16–6,75 · z 5,23–6,05 | 3,12–6,05 | −2,85 (`floorOffset −0,30`) | −0,50 | 6,87 netto, 7,35 brutto (2,51 × 2,93) |
| `bod-1` | Bod | 0,13–1,79 | 0,13–2,22 | −2,55 | −0,30 | 3,47 (1,64 × 2,32 = 3,80, −9 %, listes) |
| `bod-2` | Bod (grå) | 2,06–6,33 | 0,13–2,45 | −2,55 | −0,30 | 9,91 (4,28 × 2,32 = 9,93) |
| `bod-3` | Rommet 3,70 × 2,84 | 6,44–10,15 | 0,13–2,97 | −2,85 (`floorOffset −0,30`) | −0,50 | 10,54 (3,70 × 2,84 = 10,51) |
| ute | Forplass | 8,88–12,6 | 3,18–6,75 | −2,87 | – | – |
| ute | Nisjen (overdekt del av forplassen) | 8,88–10,35 for z 3,18–6,0, og 8,88–9,80 for z 6,0–6,75 (bak pilaren, under det gamle dekket) | 3,18–6,75 | −2,87 | −0,50 (himling over hele) | – |
| ute | Repos ved terrassetrappa | 11,37–12,4 | 6,75–8,3 | −2,87 | – | – |
| ute | Terrassedekket | som TERRACE_FIT, men ut til x 10,35 for z −0,30 … 6,0 (V9) | | −0,03 | – | – |

### 1.2 Vegger og ytterflater i kjelleren

- **Innervegger:**
  - gang/entré: x 5,75–6,16 (0,41)
  - vaskerom og soverom mot kjellerstua: x 2,76–3,05
  - gang/kjellerstue: z 5,23–5,32
  - badveggen: z 4,43–4,55
  - nisjeveggen: z 2,22–2,32
  - gangens østvegg mot bod 2: z 2,45–2,56
  - vaskerom/soverom: z 8,45–8,55
  - bod 1/bod 2: x 1,79–2,06
  - bod 2/rom 3,70: x 6,33–6,44
  - entré/rom 3,70: z 2,97–3,12. Tegningen viser den tynnere (z 3,03–3,12). Det betyr ingenting for et lukket rom.
  - Lomma x 6,16–6,33 · z 2,56–2,97 ligger mellom gang/entré, bod 2, rom 3,70 og entréens østvegg. Den hører ikke til
    noe rom. Planen tegner den som et hvitt felt (x 6,18–6,35 · z 2,60–3,00). Den fylles som vegg, så det ikke blir et
    hulrom eller en åpen sprekk.
- **Yttervegger (ytterflater):**
  - nord: x −0,30 (tegnet −0,17, ytterlaget tykkes, V10)
  - øst: z −0,30 (tegnet −0,16)
  - vest: z 11,68 (utkraging, V4)
  - kjellerstuas sørvegg: x 6,75 (V6)
  - entré: sør x 8,88, vest z 6,26
  - rom 3,70: sør x 10,34, vest (mot nisjen) z 3,18

### 1.3 Omregning fra notatene

| Kilde | Til spillkoordinater |
|---|---|
| `hele-huset-design.md`, kjeller i D3-ramme | x + 0,13; z ≈ 0,943 · z + 0,13 (ikke låste sjaktvegger) |
| `oversikt.md`, `trapp.md`, `ytterdor-ute.md`, spill-tallene i `entre-gang-kjeller.md` | samme ramme innen ±0,02. Tall i denne fila går foran. |
| `vaskerom.md` (lokalt fra NØ-hjørnet) | x + 0,13. z + 4,55 for ting som henger på østveggen, z + 4,37 for ting som henger på vestveggen (V58). |
| `kjellerstue.md` (lokalt fra NØ-hjørnet) | x + 3,05; z + 5,32 |
| `soverom-kjeller.md` (lokalt fra NØ-hjørnet) | x + 0,13; z + 8,55 |
| `entre-gang-kjeller.md`, gang lokalt | x + 0,13; z + 2,56 (trappedelen er låst, V3) |
| `entre-gang-kjeller.md`, entré lokalt | x + 6,16; z + 3,12 |
| Notatene for 1. etasje | uendret (room-spec-ramme) |

---

## 2. Trappa

| # | Beslutning | Erstatter | Grunnlag | Sikkerhet |
|---|---|---|---|---|
| V12 | **13 opptrinn à 0,196** (12 inntrinn + gulvkanten), merket `estimated`. `risers` styrer alt: opptrinnet regnes alltid som −floorY / risers. Toppen av trinn k ligger på y −2,55 + 0,196 · k (trinn 12 på −0,196). | D2 (14 × 0,182), §1.6 `risers` og `source`, §1.8 (−0,18 / −0,36), §7.2 rad 18–19, steg 18–19; notatene (15 × 0,170) | Jeg talte nesene der de møter veggvangen: 2 på østveggen (225337, 225333), 5 på nordveggen (225337, 225339) og 5 på vestveggen (225342, 225339), pluss gulvkanten. Kontroll nedenfra (225631, 225349): 7 trinn nederst, og det øverste trinnet ligger rett under hullkanten. Det er ikke noe skjult trinn. Tre grove opptrinnsmål gir 0,17–0,20. Bare 13 gir 2r + g innenfor 0,60–0,64, men bare med ganglinja i V13. Med dagens `stairWalk` havner både 13 (0,647) og 14 (0,599) utenfor. | middels |
| V13 | **Inntrinn = ganglinjelengde / (risers − 1)** ≈ 2,87 / 12 ≈ **0,24**. De rette trinnene beholder 0,23 (V14), og de balanserte vangetrinnene deler resten (≈ 0,243). Det gir 2r + g ≈ 0,63 (vangetrinnene 0,635). **Ganglinja går midt i den frie bredden:** 0,69 rett i nedre løp (z 3,955), en kvartbue rundt øyets NV-hjørne (1,04; 3,48), en rett strekning over nordenden midt mellom øyet og nordveggen (x ≈ 0,585, fri bredde 0,91), en kvartbue rundt NØ-hjørnet (1,04; 3,10) og 0,41 rett i øvre løp (z 2,71). Svingen blir ca. 1,77 (trapp.md: 1,73). Trinntverrsnittet i svingen er den frie bredden mellom øyet og sjaktveggene. **`stairWalk` i `house.mjs` (steg 3, flettet) gjør ikke dette.** Den legger én halvsirkel rundt midten av øyets nordkant ((1,04; 3,29), r 0,58–0,665). Med §2.4 gir den ganglinje 3,06, inntrinn 0,255 og 2r + g 0,647, altså en advarsel. Tverrsnittene når x −0,02, og da kommer advarselen «trinnene går utenfor kjeller-gang». Den rettes i steg 18 (§6). | §1.6 («delt på 13»), D4 («0,20–0,23»); trapp.md (0,19 i svingen) | Både notatenes 15 × 0,17 og planens 14 × 0,182 gir advarsel på 2r + g og på inntrinn ≥ 0,22 (14: 2,87 / 13 = 0,221, 2r + g 0,585). Halvsirkelen er feil modell for et øye som er 0,38 bredt og 0,41 langt. Den bruker 0,62 som radius også midt i svingen, der halve den frie bredden er 0,455. Kontrollregnet med `stairWalk` på dataene i §2.4. | middels |
| V14 | **Trinnfordelingen:** trinn 1–3 er rette (neser på x 1,73 / 1,50 / 1,27, inntrinn 0,23). Trinn 4 er svakt kilet på vestveggen, 5 er NV-hjørnetrinnet, 6–9 går langs nordveggen (ytre inntrinn 0,33–0,43), 10 er NØ-hjørnetrinnet, 11 er et vangetrinn på østveggen og 12 er svakt kilet øverst. I data: `top.straightTreads 1`, `foot.straightTreads 3`, `winders "balanced"`. trapp.md-tabellens rette trinn 13 (nese x 1,04) bygges ikke. | D4 (1 + 3 bekreftes); trapp.md og oversikt.md («13–14 rette») | 225337 (kontrast): trinnet under neselista er bare svakt kilet, og det neste stråler allerede mot P2. 225349 og 225631 viser tre rette trinn langs en rett, fri vange. | middels |
| V15 | **Øverste trinnkant:** gulvkanten med neselist ligger på **x 1,45** for z 2,32–3,10. Nyestolpen P2 står på (1,45; 3,10), og rekkverk C går langs x 1,45. Baddørhullet starter på x 1,54, så det blir ca. 0,09 gulvlist mellom nesa og karmen (V49). | D4 og D5 (x 1,50), §1.6 `top.edge`, `well.newel`, `rekk-b/c`, §1.4 `door-bad` (x 1,52), §8.4 pkt. 4 | Gulvlista mellom nesa og baddørkarmen er 0,11–0,17: homografi i 225333 med karmen (1,50–2,45 × 2,15) som skala, og bordbredden i 225335. Eierens plan tegner baddøra på 1,535–2,43, og streken «1,54» slutter ved døra. | lav |
| V16 | **Hullet** i 1. etasje: `[[0,2.32],[1.45,2.32],[1.45,3.48],[1.85,3.48],[1.85,4.43],[0,4.43]]` (3,44 m²). Rekkverk A går langs x 1,85 (z 3,48–4,43), B langs z 3,48 (x 1,45–1,85) og C langs x 1,45 (z 3,10–3,48). Hvit kantflate #f2efe8, 0,30 dyp, bare på de frie kantene (x 1,45 under neselista og under C, z 3,48 under B, x 1,85 under A). Langs x 0, z 2,32 og z 4,43 går sjaktveggene rett gjennom etasjeskillet i veggfargen. En kantflate der ville blitt en hvit stripe i samme plan som veggen. I nord står veggflata x 0 ned til hylla (−0,27). Ingen rekkverk langs øverste trinnkant. | D5, §1.6 `floorOpenings` | Følger av V15 og D1. Vestdelen (1,85) er uendret. | lav (østdelen), middels (vestdelen) |
| V17 | **Nederste trinnkant:** nesa på trinn 1 står på **x 1,73** for z 3,48–4,43, 1,58–1,60 fra kjellerens nordvegg. Vaskeromsdøra flyttes med og får hull x 1,84–2,71. Det er minst 0,05 vegg mellom nesa (pluss 0,03 nosing) og nordkarmen, og validatoren sjekker trinnkanten mot dørkarmer. **Veggvangen langs z 4,43 kappes loddrett ved foten, senest på x 1,79.** Neselinja forlenget treffer gulvet på x 1,97, og en vange med overkant langs den ville gått over karmen og inn i døråpningen (x 1,84–2,71). Ved hullkanten (x 1,85) er marginen 0,12, ikke 0,25. Fri høyde ca. 2,16 > 1,98 holder. | D4 (x 1,60), §1.6 `foot.edge` og teksten om fri høyde, §1.4 vaskerom (dør x 1,69–2,58) | Det er samme fysiske punkt i begge rammer (skraveringen i kjellerplanen slutter på X 1,59). Planens blanding av rammer, foten i den nye og døra i den gamle, ville latt trinn 1 overlappe karmen med 0,07. 225631 og 225349: trinn 1 står rett nord for nordkarmen. | høy |
| V18 | **Øyet:** x 1,04–1,45 og z 3,10–3,48. Nordkanten er foten − 3 × 0,23, og sørkanten er linja for nesa og rekkverk C. Vangetrinnene stråler fra øyets NV- og NØ-hjørne. | D4 (kjerne x 1,20–1,50), §1.6 `well` | 225349 og 225631: tre rette trinn langs en rett, fri innervange. Svingskraveringen i kjellerplanen slutter på X 0,88 (x 1,01–1,03). Planens egne tall går ikke opp: 1,60 − 3 × 0,22 = 0,94. | middels |
| V19 | **Fotavtrykket**: `[[0.13,2.32],[1.45,2.32],[1.45,3.10],[1.04,3.10],[1.04,3.48],[1.76,3.48],[1.76,4.43],[0.13,4.43]]`. Kileflaten går fra y −2,55 til 0. HUD-rommet `trapp` bruker samme polygon, men fra −2,55 til 1,0, fordi layout.js legger 1 m over øvre gulv (§1.1). Det ligger helt inne i hullet og i `kjeller-gang`. | §1.4 `trapp`, §1.6 | Følger av V14–V18 (nese 1,73 + 0,03). | middels |
| V20 | **Bod-1-døra** under øvre løp: hull x 1,06–1,85 (0,79, planens bredde) i nisjeveggen (z 2,32). Søndre karm står i nisjehjørnet. Høyden er `min(2,05, trappeunderside − 0,05)`, og vangens underside ventes på 2,05–2,10 ved nordkarmen. Hengsler i **sør**, slår inn i boden, lukket. Kutter validatoren mer enn 0,05, er det trappedataene som er feil, ikke døra. | §1.4 bod-1 (x 0,84–1,63, «hengslet i nord»), §2.6; oversikt.md (x 1,10–1,85) | 225639 og 225349: vanlig dør i full høyde. Søndre karm står inntil det utspringende hjørnet, og toppen av nordre karm møter vangen akkurat. Planbuen har hengselet i sørenden. Med 13 × 0,196 og 0,4 ytre inntrinn langs østveggen ligger vangen ca. 2,05–2,10 over gulvet ved x 1,06–1,10. | middels |
| V21 | **Hylla** i sjakta er toppen av kjellerens nordvegg: x 0–0,13, topp y −0,27. Under den står kjellerens nordvegg (x 0,13) helt ned til gulvet. Ingen svevende kloss. Planten er valgfri og står på (0,07; −0,27; 4,30). | §1.6 `ledge` (x 0–0,17, y −0,22 … −0,02) | 225349: hylla ligger i høyde med kjellertaket. 225331 og 225337: den ligger tydelig under gulvnivå. Homografi i 225333: topp ca. −0,29. | middels |
| V22 | **Håndløperen:** øvre ende på x 1,40 ved østveggen, med endehøyde 0,70 over gangulvet og rett avkapping. Ellers 0,90 over neselinja langs veggen. LED under lista langs nord- og østveggen, ikke vestveggen. Langs nordveggen regnes `offset` fra kjellerveggen (x 0,13) hele veien, og lista ligger i ett plan (ca. x 0,21, trapp.md). Fra ca. trinn 7 går den over hyllehøyden (−0,27), og der blir brakettene 0,13 lengre inn til veggen x 0. | §1.6 `handrails` (0,90 også i enden, ca. 0,85 over gulvet ved x 1,40) | gang-1etg.md og trapp.md: ca. 0,63 mot baddørkarmen. Homografi i 225333: 0,7–0,8. | middels |
| V23 | **Trinnprofil:** plate 0,04 og en lys list på 0,04 trukket 0,025 inn, så fronten ser ca. 0,08 ut. Nesa stikker 0,03 ut. Farge #ada396. | §1.6 `tread` (0,045 / nese 0,02 / #bfab9b) | 225349 og 225631 viser den todelte fronten. Fargen er 4–7 % lysere enn gulvet #a59b8f (225335, 225337). | middels |

### 2.1 Ett tallsett

| Størrelse | Verdi |
|---|---|
| Etasjehøyde | 2,55 (dekke 0,30 + kjellertak 2,25), `estimated` |
| Opptrinn | 13 × 0,196 |
| Inntrinn | 0,23 på de rette trinnene, ≈ 0,24 i snitt på ganglinja (2,87 / 12, V13) |
| 2r + g | ≈ 0,63 (vangetrinnene ≈ 0,635) |
| Stigningsvinkel θ | ≈ 39–40°. Fri høyde kapselen trenger: 1,2 + 0,6/cos θ ≈ 1,97–1,98. |
| Trinn 1 (nese) | x 1,73, z 3,48–4,43, topp y −2,354 |
| Trinn 12 | topp y −0,196, svakt kilet, ender ved gulvkanten |
| Gulvkant / neselist | x 1,45, z 2,32–3,10, y 0 |
| Øye / nyestolpe P2 | x 1,04–1,45 · z 3,10–3,48 / (1,45; 3,10) |
| Nedre løp | z 3,48–4,43 (0,95), opp mot nord |
| Øvre løp | z 2,32–3,10 (0,78), opp mot sør. Øverst går man ned mot nord. |
| Sjaktvegger | nord x 0 oppe og x 0,13 nede (hylla imellom), øst z 2,32, vest z 4,43 |
| Hylla | x 0–0,13, topp y −0,27 |
| Lagerplass under svingen | x 0,13–1,04 · z 2,32–3,10, åpen og tom |
| Nivåbytte øverst (§1.8) | trinn 12 og 11 står på y −0,20 og −0,39 (var −0,18 og −0,36). `levelAt` gir fortsatt `hoved`. |

### 2.2 Hullet

`trappehull`: `[[0,2.32],[1.45,2.32],[1.45,3.48],[1.85,3.48],[1.85,4.43],[0,4.43]]`. Vestdelen (x 0–1,85) ligger over nedre
løp og østdelen (x 0–1,45) over øvre løp og øyet. Avstanden fra nesa på trinn 1 (1,73) til hullkanten (1,85) er 0,12.

### 2.3 Fotavtrykket

`[[0.13,2.32],[1.45,2.32],[1.45,3.10],[1.04,3.10],[1.04,3.48],[1.76,3.48],[1.76,4.43],[0.13,4.43]]`. Kileflaten går fra
y −2,55 til 0, og HUD-prismet `trapp` til 1,0. Øyet er utelatt. Feltet x 1,45–1,85 · z 2,32–3,48 i kjelleren er gulv under gangen oppe (2,25 under tak), og der går man til
bod-1-døra.

### 2.4 Erstatning for trappedelen av §1.6

```json
"levels": [
  { "id": "kjeller", "name": "Kjeller", "floorY": -2.55, "slabThickness": 0.30, "ceilingDefault": 2.25,
    "plan": { "file": "bilder_hus/plantegning_kjeller.png", "pxPerM": 60.25, "originPx": [119.2, 112.1] },
    "estimated": ["floorY","ceilingDefault"],
    "source": "13 opptrinn (egen telling 2 + 5 + 5 neser + gulvkanten: 225333, 225337, 225339, 225342, 225349, 225631); tak 2,25; plan uskalert, ytterflater i flukt (+0,13) (hele-huset-avstemming.md V1–V2)" }
],
"floorOpenings": [{
  "id": "trappehull", "levelId": "hoved", "roomId": "gang", "stairId": "trapp-kjeller",
  "polygon": [[0,2.32],[1.45,2.32],[1.45,3.48],[1.85,3.48],[1.85,4.43],[0,4.43]],
  "edgeBand": { "color": "#f2efe8", "depth": 0.30 },
  "estimated": ["polygon"], "source": "hele-huset-avstemming.md V15–V16; 225333, 225335; eier 1,54 = til baddøra"
}],
"stairs": [{
  "id": "trapp-kjeller", "name": "Trappa", "type": "half-turn-winder",
  "fromLevel": "kjeller", "toLevel": "hoved", "openingId": "trappehull", "roomIds": ["kjeller-gang","gang"],
  "risers": 13,
  "top":  { "edge": [[1.45,2.32],[1.45,3.10]], "down": [-1,0], "straightTreads": 1 },
  "foot": { "edge": [[1.73,3.48],[1.73,4.43]], "down": [1,0], "straightTreads": 3 },
  "well": { "polygon": [[1.04,3.10],[1.45,3.10],[1.45,3.48],[1.04,3.48]], "newel": [1.45,3.10] },
  "walkLine": "flight-centre", "going": null, "winders": "balanced",
  "tread": { "thickness": 0.04, "nosing": 0.03, "batten": { "h": 0.04, "inset": 0.025 }, "material": "oak", "color": "#ada396" },
  "openRisers": true,
  "stringers": { "color": "#1d1e21", "thickness": 0.05, "depth": 0.28 },
  "ledge": { "x": [0, 0.13], "top": -0.27, "color": "sand" },
  "guards": [
    { "id": "rekk-a", "level": "hoved", "line": [[1.85,4.43],[1.85,3.48]] },
    { "id": "rekk-b", "level": "hoved", "line": [[1.85,3.48],[1.45,3.48]] },
    { "id": "rekk-c", "level": "hoved", "line": [[1.45,3.48],[1.45,3.10]] },
    { "id": "rekk-oye", "on": "well" }
  ],
  "guardStyle": { "height": 1.00, "stairHeight": 0.90, "post": 0.065, "baluster": 0.022, "spacing": 0.13,
                  "topRail": [0.07, 0.05], "color": "#1d1e21" },
  "handrails": [{ "side": "outer", "start": [1.40, 2.32], "startHeight": 0.70, "walls": ["øst","nord","vest"], "height": 0.90,
                  "profile": [0.05, 0.04], "offset": 0.05, "color": "#1d1e21",
                  "led": { "walls": ["øst","nord"], "lumensPerM": 120, "lightColorK": 2900, "group": "gang" } }],
  "decor": [{ "type": "plant-small", "on": "ledge", "at": [0.07, 4.30], "optional": true }],
  "estimated": ["risers","top","foot","well","tread","guards","handrails[0].startHeight","handrails[0].led","ledge"],
  "source": "hele-huset-avstemming.md V12–V23; gang-1etg.md, trapp.md, entre-gang-kjeller.md; 225331, 225333, 225335, 225337, 225339, 225342, 225349, 225631, 225639"
}]
```

`validateHouse` regner opptrinnet ut som −floorY / risers og inntrinnet som ganglinja / (risers − 1). Ingen test eller
validator hardkoder 0,182 eller 14. Validatoren sjekker også at trinnkanten (med nosing) og vangefoten står minst 0,05 fra
hver dørkarm. Ganglinja følger V13, ikke dagens halvsirkel i `stairWalk`.

---

## 3. Inngangen og ute

| # | Beslutning | Erstatter | Grunnlag | Sikkerhet |
|---|---|---|---|---|
| V24 | **Entrétrinnene:** 2 opptrinn à 0,15. Entréen beholder `floorOffset −0,30`, gulv y −2,85. Mellomtrinnet fyller lysningen i veggen x 5,75–6,16 (topp y −2,70), med sorte trinnkantprofiler. Alle høyder avledes: entrégulvet = kjellerens `floorY` + `floorOffset`. Ingenting hardkodes. Notatenes 0,17 og −2,89 brukes ikke. | D2 og §3.11 bekreftes; oversikt.md og entre-gang-kjeller.md (2 × 0,17, −2,89) | Egen måling med lysningen 0,93 som skala og korreksjon for kamerahelling: 225553 gir 0,159 og 0,148, 225559 gir 0,155 og 0,164 (snitt 0,157, sum 0,31 ± 0,03). Forkantene står 0,41–0,43 fra hverandre, som lysningens dybde. 0,17 ble valgt bare for å passe med trappas gamle 0,17. §3.11-testen er laget for 0,15. | middels |
| V25 | **Inngangsnivået:** `outsideHouse.entranceLevelY` = entrégulvet − 0,02 = **−2,87**. Det styrer forplassen, reposet, stien, «walk», foten av pilaren og terrassens vestside, foten av terrassetrappa, spawnens y og posisjonene i walkmap og skjermbildene. | D2 og D8 bekreftes (−2,87); notatene (−2,90) | 225553: aluterskelen ligger 2–4 cm over grusen og i flukt med entrégulvet. Sålbenken i kjellerstuas sørvinduer ligger på −1,70, så bakken der kan ikke ligge på TERRACE_FITs −1,72. Usikkerheten er ±0,15 til terrassetrinnene er telt. | middels |
| V26 | **Forplassen** er flat på y −2,87, x 8,88–12,6 og z 3,18–6,75. De usynlige grensene (`walkRects`) er ca. x 6,75–14 og z −0,2 … 9. | §2.9 (x 8,74–12,6 · z 3,15–6,75, grenser fra x 6,62) | V1-rammen. | høy |
| V27 | **Ytterdøra:** elementet er 2,0 × 2,1, med østre sidefelt 0,50, blad 1,0 × 2,05 og vestre sidefelt 0,50. Det står i entréens sørvegg (ytterflate x 8,88). Målt fra entréens innvendige østhjørne ligger elementet på 0,19–2,19 og bladet på 0,69–1,69, altså element z 3,31–5,31 og blad z 3,81–4,81 (midt 4,31). Hengsler i øst, slår ut, `openAngleDeg 95` (stopper før potta). Dørslaget er x 8,88–9,88 og z 3,81–4,81. Vrider og kodelås sitter på vestkanten, h ca. 1,0. Glatt matt antrasitt blad #2b2c2e, sorte rammer #25272b, aluterskel og bred sort foring inne. | §2.7 («1,85 bredt, sentrert på z 4,38», blad 0,92), §3.6 (dørslag x 8,74–9,66 · z 3,88–4,80), §1.3 (90°) | 225543, rett forfra: elementet er 1,045 ganger så høyt som bredt, bladet tar 48 % av bredden, og vrideren sitter på 0,47 av bladhøyden. 2,0 gir element 2,09, blad 0,96–1,0 × 2,02 og vrider på 0,95. 1,85 gir blad 1,87 høyt og vrider på 0,88. Plansymbolet er 1,87. 225553 viser bladet åpent mot øst, foran potta. | middels |
| V28 | **Himlingen:** entrétaket, taket i rom 3,70 og himlingen i nisjen ute er én flate på entrégulvet + 2,35 = **y −0,50**, farge #4a4642 (samme beis som kledningen; den ser mørk ut fordi den er ubelyst). Veggene går fortsatt opp til dekkets underside (−0,23), skjult bak himlingen. | D2 («2,40 over terskelen»), §1.4 entré (tak −0,45), §2.8 (−0,45 og «mørk himling #35312e på −0,35»), §8.5 (#35312e) | 225543: kledningen mellom himlingen og elementets topp er ca. 0,24 m. Med et element på 2,1 gir det 2,34 over terskelen. 225619: den sorte foringen går nesten opp til taket. Planen var uenig med seg selv (−0,45, −0,35 og 2,40). | middels |
| V29 | **Rom 3,70 (`bod-3`)** får samme gulv som entréen, `floorOffset −0,30` (y −2,85), og tak på −0,50. Oransjebrun parkett, lukket og tomt. | §1.4 bod-3 (kjellernivå −2,55, ingen offset) | 225558 og 225556: parketten ligger i flukt med entrégulvet bak en flat, sort terskel. −2,55 ville gitt et trinn på 0,30 opp i døra. | middels |
| V30 | **Inngangspilaren:** x 10,0–10,35 og z 5,65–6,0 (midt (10,17; 5,82)), 0,35 × 0,35, grå spritputs #a8a9aa, fra bakken (−2,87) opp til himlingen. Den lille sorte boksen sitter på østflaten, h 1,4. Hjørnepilaren i TERRACE_FIT (9,65; 6,60) bygges bare hvis eieren bekrefter at det er to pilarer. | §2.9 («Hjørnepilaren … grå spritputs #a9a7a1»), §8.5 | 225619 og 225621: pilaren ses gjennom det vestre sidefeltet, rett bak benkeenden. Det er umulig fra (9,65; 6,60). 225543: NØ-hjørnet ved bakken ligger på x 10,0–10,15 og z 5,63. Hvitbalansert er fargen nøytral grå (111/111/114). | høy |
| V31 | **Fasaden i nisjen:** dørveggen (x 8,88) kles med stående kledning #4a4642 fra z 3,18 til 6,75, med et lukket fyllvolum bak for x 6,75–8,88 og z 6,26–6,75. Østre sidevegg (= vestflaten av rom 3,70, z 3,18) og sørflaten av rom 3,70 (x 10,34) kles også med #4a4642 (anslått). | §2.8 (kledning bare på dørveggen og østre sidevegg, puss ellers) | 225543: de stående bordene går uten brudd fra kransen og bak pilaren, med lik bordavstand. Sørflaten av rom 3,70 er ikke fotografert. | middels |
| V32 | **Startposisjon ute** (bare uten lagret posisjon): føttene på (12,2; −2,87; 4,6), yaw 85°, pitch −6°. Den lagres relativt til døra: ytterflaten + 3,3 m mot sør, bladets midte + 0,3 m mot vest, y = `entranceLevelY`, og yaw regnes ut mot bladets midte. Pos-strengene blir `12.2,-2.87,4.6&yaw=85&pitch=-6` (ute) og `7.4,-2.85,4.4` / `8.0,-2.85,4.4` (entré, uendret). | §3.6 (12,0; −2,87; 4,6), §7.4, §7.5 | Samme sted som i planen og notatene, bare i V1-rammen. Kameraet i 225543 sto på ca. (11,2; 4,45), h 1,3, så startbildet blir litt lenger unna. | høy |
| V33 | **Terrassetrappa:** 16 opptrinn à 0,1775 (fra −0,03 til −2,87), inntrinn 0,25, løp fra x 7,62 til 11,37 langs terrassens vestside (z 6,75–7,50). Reposet ligger på x 11,37–12,4 og z 6,75–8,3, på −2,87. Det begynner der trappa slutter, som landingen i TERRACE_FIT (`to` = landingens start). TERRACE_FITs gamle landing (x 9,55–10,5) utgår. Stien langs trappas ytterside (`path`, z 7,50–8,10) forlenges fra x 9,55 til 11,37, så den møter reposet. Der trappa går forbi pilaren (x > 9,8), får den lukket vange eller rekkverk på østsiden. Sett `outside.groundBelowY`, `terrain.nearHouseY` og `nearGround.y` til −2,95 og `nearGround.toX` til 12,8, så plenen faller fra kanten av forplassen. `nearGround.y` må stå eksplisitt. Ellers bruker exterior.js TERRACE_FITs −1,75 så lenge fitten gjelder, og da ligger plenen ved huset 1,1 over forplassen. Terrassens kledde vestside (z 6,75) stopper også på `nearGroundY`. | D8 («15–16 opptrinn»), §2.9 (TERRACE_FIT og plenen), §8.4 pkt. 2 | Høyden er 2,84. Med inntrinn 0,25 ender 15 × 0,19 på x 11,1 og 16 × 0,178 på 11,4, så bare 16 passer med planens «til ca. 11,4». exterior.js lar bakken gå fra `nearGroundY` til `groundBelowY` (i dag −2,7) mellom `nearGroundToX` og 3 m lenger ut. Med inngangsnivå −2,87 ville plenen ellers steget 0,2 m sør for huset. | middels |
| V34 | **Belegg ute:** grusstripe #aeafb0 (0,15–0,25 langs veggen), skiferhelle 1,5 × 0,7 i #9da4a8 foran døra, dørmatte 0,8 × 0,5 i #7f8083 midt for bladet (langs z), betongheller #a7a49e med grusfuger, bunndekke #4e6b3a. | §2.9 (grus #b4afa6, skifer #5f656b), §8.5 | Hvitbalanserte pikselsnitt i 225543: skiferen er ca. 6 % lysere og blåere enn betongen, ikke mørk. Dørmatta er 0,82 ganger så lys som skiferen. | høy |
| V35 | **Faste ting ute:** de 3 downlightene i himlingen er faste `builtInLights` i gruppe `ute` (på om kvelden og natta), på x 9,46 og z 3,78 / 4,66 / 5,54 (0,88 mellom, den midterste 0,35 vest for elementets midte). Ringeklokka er en fast fixture (z 5,41, h 1,05). Benken (x 9,1–9,95 · z 5,5–5,85, #77736c), potta med bartre ((9,5; 3,5), Ø 0,32) og dørmatta er vanlige møbler. Bare kransen (z 5,66, h 1,3) er `optional`. | §2.9 («Benk, krans og potte … valgfrie. Det samme gjelder ringeklokka og 3 downlights») | I 225543 er de tre downlightene det eneste lyset ute. Posisjonen er regnet ut fra bildet. Planens egen regel i §0: bare det notatene merker «valgfri», blir `optional`. | middels |
| V36 | **Kjellerfasaden vest for nisjen** følger V6: pusset sørvegg på x 6,75 under utkragingen. Delen av grunnmursboksene under `w-sor` og under kjøkkenets sørvegg (x 6,37–6,62) som står inne i entréen og rom 3,70, fjernes uansett. Viser bildet av sørfasaden (§8.3) puss i flukt med 7,22, byttes det til det. | D9, §2.8; ytterdor-ute.md («flukt med 7,22») | Fasaden er ikke sett fra bakken. Fra stua (082829, 082841, 082852) er det uklart om veggen under ses. | lav |

### 3.1 Høyder (verdens-y)

| Hva | y | Grunnlag |
|---|---|---|
| Tak i gang, bad og soverom i 1. etasje | 2,40 | eier, anslått |
| Gulv i 1. etasje | 0 | room-spec |
| Terrassedekke | −0,03 | exterior.js |
| Dekkets underside under terrassen | −0,23 | §2.8 |
| Hylla i sjakta (topp) | −0,27 | V21 |
| Kjellertak (dekkets underside) | −0,30 | D2 |
| Entrétak, tak i rom 3,70, himling ute | −0,50 | V28 |
| Sålbenk, sørvinduene i kjellerstua | −1,70 | 0,85 over kjellergulvet |
| Toppen av trinn k i trappa | −2,55 + 0,196 · k | V12 |
| Kjellergulv (GANG, vaskerom, kjellerstue, soverom, bod 1–2) | −2,55 | D2 |
| Mellomtrinn mellom GANG og entré | −2,70 | V24 |
| Entrégulv og gulv i rom 3,70 | −2,85 | V24, V29 |
| Forplass, repos, sti, «walk» (`entranceLevelY`) | −2,87 | V25 |
| Bakken nær huset (`groundBelowY`, `terrain.nearHouseY`, `nearGround.y`) | −2,95 | V33 |

---

## 4. Rommene i 1. etasje

| # | Beslutning | Erstatter | Grunnlag | Sikkerhet |
|---|---|---|---|---|
| V37 | **D15 skrives om:** `bad-1etg.md` (skrevet om etter alle de 8 bildene 225413–225429) er kilden for badet. Tillegget i `vaskerom.md` er bare historikk. A4 og A5 får «Bilder: via notat (`bad-1etg.md`)». Tallene i V38–V45 erstatter §1.5 og §2.3. | D15, §1.4 og §1.5 `source`, §2.3 «Kilder», steg 7, 10 og 12 «Bilder» | vaskerom.md sier selv at Tillegget er tatt inn i bad-1etg.md med justerte tall. oversikt.md pkt. 12 («D15 stemmer») holder ikke tall for tall. | høy |
| V38 | **Servanten** `bi-bad-servant`: position [1,90; 0,35; 0], altså x 1,50–2,30, dims 0,80 × 0,46 × 0,50 (overkant 0,85). **Høyskapet** (`wall-cabinet`) står rett inntil: x 1,10–1,50, 0,40 × 0,30 × 1,90, underkant 0,15 og topp 2,05. Det er matt svart #1f1f22, med to glatte dører uten grep (trykklås), lukket. | §1.5 (servant [1,75; 0,35; 0], x 1,35–2,15), notatet under §1.5 og §2.3 (høyskap 0,35, x 0,95–1,30) | 225425, rett mot østveggen: fra servantens bakkant til SØ-hjørnet er det bare ca. 0,16. Høyskapets front måler 0,40–0,42 når den korrigeres for at den står 0,30 foran veggen. Det er en liten luke mot dusjreturen (225425, 225429). | høy (servant), middels (høyskap) |
| V39 | **Rundt LED-speil** `bi-bad-speil`: Ø 0,80, position [1,90; 1,08; 0] (underkant 1,08, midt 1,48), lys 400 lm og 3000 K i gruppe `bad`. Ikke speilskap. | §1.5 (Ø 0,70 på [1,75; 1,05; 0], 300 lm, 4000 K), §2.3 (Ø 0,7) | 225425: speilet er ca. 320 × 330 px mot servantens 305 px for 0,80. 225413 og 225425: ringen er tydelig varmere enn den kjølige plafonden. | høy |
| V40 | **Dobbel sort stikkontakt** #1c1a19 på `w-bad-ost`, x 2,30 og senter h 1,03, over servantens sørende og under speilets underkant. | §2.3 («sør for speilet … på 1,15», uten x) | 225425, rett forfra: senteret ligger 0,10–0,15 over servantplata og under speilet. Med 1,15 ville den stått over speilets underkant. | middels |
| V41 | **Steinplatene på badet:** farge #c8c5bf, skjøt #bcb9b3, bare loddrette skjøter hver 0,60 i full høyde, også i dusjen. `stonePanel({ size: [0.6, 2.4] })` eller uten vannrett fuge. | §1.5 og §8.5 (#c6c1b9), §2.1 (`stonePanel({size:[0.6,1.2]})`), §2.3 | 225423 (sørveggen rett forfra) og 225413: ingen vannrett fuge på 1,2. | høy |
| V42 | **Avslutning mot gulvet på badet:** egen sokkel som oppbrett, h 0,04, tykkelse 0,005, #2a2a2c, rundt hele rommet. Badet arver ikke stuas hvite `baseboard` #e9e6df. | §2.3 («uten gulvlist»), A2 (sokkel per romsløyfe fra `baseboard`) | 225429 og 225423 viser en mørk stripe der gulv og vegg møtes. | middels |
| V43 | **Femkantdusjen:** hjørnene (x; z) er (0; 0,90) → (0,37; 0,90) → (0,95; 0,37) → (0,95; 0). Returene er 0,37, glasset 2,0 høyt uten topprofil, svarte profiler #1a1a1a og to svingdører. I data: `position [0.475, 0, 0.45]`, dims 0,95 (x) × 0,90 (z), `params.returns 0.37` i stedet for `cut`. Sluk Ø 0,15 på [0,50; 0; 0,50]. Dusjsettet sitter på nordveggen ved z 0,40, med termostat på h 1,0 og kvadratisk takdusj 0,25 på h 2,20. Samme lyse steinplater inne i dusjen, ingen mørke plater. | §1.5 `bi-bad-dusj` (0,90 × 0,90, `cut 0.35`), §2.3 | 225419: vestre retur ved z ≈ 0,92 (målt mot vinduet og hjørnet). 225429: østre retur ved x ≈ 0,9. «cut 0,35» kan leses som returer på 0,55. | lav |
| V44 | **WC** `bi-bad-wc`: position [0; 0; 1,83]. Kassen er 0,65 × 0,20 × 1,10 (z 1,50–2,15, med 0,07 vegg mot vestveggen) og har hyllekant #a7a9a8. Skålens front står på x 0,74. Sort trykkplate 0,25 × 0,16, senter h 0,95, legges i `params`. | §1.5 (z 1,85, w 0,70) | 225419: synlig veggstripe mellom NV-hjørnet og kassen. Kassens østkant flukter nesten med vinduets vestre lysning (z 1,47). | lav |
| V45 | **Småting på badet** (fixtures, `estimated`): bryter #151515 på `w-bad-gang`, x 1,45 (rett nord for karmen), senter h 1,15. Dopapirholder på `w-bad-gang`, x 0,85, h 0,80. Én svart knagg på sørveggen, z 0,80, h 1,15. Plafonden `l-bad-tak` får mørk grå kant og 1500 lm. Downlighten `l-bad-spot` står på (2,20; 2,40; 1,85), d 0,08, med sort ring. | §2.3 (bryter «ca. 1,1», dopapir «ca. 0,75», krok uten plass), §1.5 `l-bad-tak` (1400 lm, uten kant) og `l-bad-spot` (2,05, d 0,09) | 225421 (vestveggen rett forfra): bryteren sitter ca. 0,1 over vrideren. 225423: kroken. 225419 og 225413: plafonden har mørk kant, mens plafondene i gangen og soverommet er lyse. Bryterens x følger baddøra (V49). | lav |
| V46 | **Taklampa i gangen** `l-gang-tak`: plafond Ø 0,38 på (1,2; 2,40; 3,1), over trappetoppen, 3500–4000 K, hvit kant #f0f0ee. To små sorte takpunkter uten lys (Ø 0,065), som `fixtures` (`smoke-detector`, `estimated`): P1 på (0,35; 2,40; 3,65) ved nordveggen og P2 på (2,4; 2,40; 3,1) over gulvet. «Takpunkt (1,2; 3,4)» utgår. Proben (2,6; 1,45; 3,4) står. | §2.4 (plafond Ø 0,30 på (2,3; 2,40; 3,4), valgfritt takpunkt på (1,2; 2,40; 3,4)) | 225331 (fra stua, kamera vippet 15° ned): lampa ligger ca. 2,4 m nord for kameraet, altså x ≈ 1,2. 225324: lampa står langt til venstre for baddørkarmen (x 1,50), og P2 står nær bildeaksen over gulvet. Planen hadde byttet om lampa og P2. | høy |
| V47 | **Beslag:** `door-bad` får sort vrider på rund rosett med WC-vri under, `handleHeight 1.03`. `door-soverom` får sort vrider på rund rosett på begge sider, `handleHeight 1.05`, `handleSide "to"` (nord), med sluttstykke i blank stål. Bare `door-gang` beholder runde rosetter uten vrider. Kjellerdørene følger tabellen i §5.1. Nytt felt: `door.hardware { type: "lever" \| "rose-only", rose: "round" \| "oblong", finish, escutcheon?, wcTurn? }`. | §2.4 («Tre svarte dører … runde rosetter»), §2.7 («som oppe, men med svart vrider …») | 225421 og 225413 (baddøra), 225304 og 225308 (soveromsdøra). | middels |
| V48 | **Terskler:** `door-bad` får mørk topp (ca. #2a2a2c, 0,08–0,10 dyp) med lys forkant #cdbfae mot gangen. `door-soverom` får en smal metallterskel #2b2b2d. `door.threshold` blir `{ top, front?, depth }`; en ren fargestreng betyr `top`. | §1.5 `door-bad` (`"threshold": "#d6cfc4"`), ingenting for `door-soverom` | 225333 og 225335 (baddøra), 225304 og 225335 (soveromsdøra). `door-gang` har #cdbfae. | middels |
| V49 | **Dørhull og blad:** `door-bad` får hull x 1,54–2,45 (`offset 0.08`, `width 0.91`, h 2,15) og blad 0,77 × 2,08 (hullet − 2 × karm 0,07). `door-soverom` beholder hullet x 2,11–3,06 (0,95 × 2,12) og får blad 0,81 × 2,05. | §1.4 `door-bad` (x 1,52–2,45, blad 0,79), `door-soverom` (uten blad); bad-1etg.md (blad 0,83) og soverom-1etg.md (0,84) | Room-spec-konvensjonen tegner karmen innenfor hullet (`door-gang`: 1,07 − 2 × 0,07 = 0,93). Blad på 0,83–0,84 ville overlappet karmen. Nordkarmen på baddøra flyttes 2 cm for gulvlista ved trappa (V15). Bildene skiller ikke 2 cm. | lav |
| V50 | **Gulvlist i gang og soverom:** egen sokkel #ada291 (lys eik i gulvfargen), h 0,07, `estimated`. Ikke stuas #e9e6df. | §2.4 («Gulvlisten er som stuas `baseboard`»), §2.5 («Gulvlisten er lys») | 225304 og 225324: lista har samme beige-rosa tone som eikegulvet (R/G 1,18–1,21 mot veggens 1,11). Usikkert, spør eieren. | middels |
| V51 | **`win-sov`:** `offset 0.92` fra `from` (z 8,20), altså z 6,11–7,28, med width 1,17, height 1,17 og sill 0,92 (topp 2,09). Dyp smyg ca. 0,20 i veggfargen #50575c, uten gerikt. Den svarte mørkleggingsrullegardinen #2a2b2d sitter i smygen og er nede, med hvit snor på østsiden. | §1.4 `win-sov` (offset 0,94, 1,15 × 1,10, sålbenk 0,95) | 225307: hullet er kvadratisk (285 × 293 px), og det er ca. 0,3 til taket. Planen pikselmåles til z 6,10–7,30. | høy |
| V52 | **Seng og nattbord:** madrassoverkanten ligger på 0,70 (kontinentalseng). Nattbordet er 0,35 b × 0,38 d × 0,55 h, #1e1e1f, med skuff eller åpent rom nede, senter (2,78; 8,01). Lakenet er #dbcdbb. | §2.5 (madrass topp 0,62, «svart kube 0,35» på (2,78; 8,02)) | 225259: nattbordets topp ligger like under madrassens overkant. | middels |
| V53 | **Småting i soverommet:** bryteren på østveggen (x 2,04) har senter h 1,15. Knaggrekka på sørveggen (z 5,53–6,03, 5 knagger) har senter h 1,60. Garderoben er #545656. De runde uttakene på hodeveggen sitter på x 0,50 og 2,60, h 0,90 (lys ring #d8d8d4, Ø 0,065). Den lave stikkontakten utgår (eller `optional`). | §2.5 (bryter 1,07, knaggrekke 1,70, garderobe #555350, uttak og stikkontakt uten plass) | Kameraet var vippet 10–16° ned i 225304 og 225308. Fargen er hvitbalansert mot de hvite linjene i dyna. 225259 og 225316 (stikkontakten er bare en mørk flekk). | lav |
| V54 | **D1 beholdes:** veggen gang/soverom ligger på z 4,43–4,53. Gangen er 3,12 × 2,11 og soverommet 3,12 × 3,67. Ting i soverommet som er målt fra østveggen, regnes fra z 4,53. Vinduet beholder sin absolutte z (V51). Gangens sørvegg står på x 3,12 (baksiden av `w-gang`, 3,22 − 0,10), ikke 3,11. oversikt.md («4,40, slik D3 gjør», «x 3,11») gjelder ikke. | D1 og §1.4 bekreftes; oversikt.md, gang-1etg.md, soverom-1etg.md | room-spec: `w-gang` går z 2,22 → 4,43, og `door-gang` har hull z 3,36–4,43, fotomålt helt inn i hjørnet (225324, 225331). Planen pikselmåles til 4,40–4,50, men 3 cm skilles ikke på bildene. `backOf` krever nøyaktig én tykkelse. | middels |
| V55 | **D6:** `door-gang` åpnes fortsatt 180° som spillvalg, med `openAngleDeg` merket `estimated`. Grunnlaget rettes: 225331 viser bladet ca. 90° åpent, ikke inntil veggen. | D6 (grunnlaget) | Lysnet utsnitt av 225331: bladet ses nesten på kant i åpningen, med rosetten nede. 90° ville sperret veien til badet. | lav |

---

## 5. Kjellerrommene

| # | Beslutning | Erstatter | Grunnlag | Sikkerhet |
|---|---|---|---|---|
| V56 | **Takhøyden** er 2,25 (tak y −0,30) i GANG, vaskerommet, kjellerstua, soverommet og bod 1–2. Entré og rom 3,70 har tak på −0,50 (V28). «Tak 2,22» i kjellerstue-raden strykes. | §1.4 kjellerstue («Tak 2,22») | 225644: TV-veggen rett forfra, 228 / 345 px × 3,40 = 2,25. 225721 og 225723: 2,22–2,25. 225508: 2,23–2,26. Det blir ingen sprang over dørene. | høy |
| V57 | **GANG** (`kjeller-gang`): polygon (0,13; 2,32) (1,85; 2,32) (1,85; 2,56) (5,75; 2,56) (5,75; 5,23) (3,05; 5,23) (3,05; 4,43) (0,13; 4,43). Sørdelen er 2,67 bred (tegningen; planteksten 2,07 er feil). Arealet er 13,1 med nisjen og 12,7 uten (eier 12,50), og listes. 5 downlights: østraden på x 2,13 / 3,33 / 4,53 og z 2,91, sørdelen på x 3,93 / 5,03 og z 4,88. Ingen vinduer, ingen taklist, ingen møbler. Sorte stikkontakter etter entre-gang-kjeller.md (omregning §1.3). Oliventreet i SV-hjørnet er valgfritt. | §1.4 `kjeller-gang` (sørdel x 2,91–5,60 · z 2,56–5,36, 13,4), §2.7 Gang (spotter x 2,0 / 3,2 / 4,4 på z 2,91 og 3,8 / 4,9 på z 5,01) | Tegningen: 161 px = 2,67. Eierens areal gir (12,50 − 2,91 · 1,83) / 2,70 = 2,66. 225631 viser knekken. | høy |
| V58 | **Vaskerommet** (`vaskerom`) er x 0,13–2,76 og z 4,55–8,45 (V5). Innredningen ankres slik: <br>• **Fra østveggen** (z = 4,55 + z_lokal): dusjen (x 0,13–1,21 · z 4,55–5,72), håndkletørkeren, bryteren, døra, knaggen (z 5,90) og spottene foran dusjen og innenfor døra: (1,38; 4,90), (1,38; 5,35), (2,23; 5,10). <br>• **Fra vestveggen** (z = 4,37 + z_lokal): skapraden (z 6,05–8,45, fronter på x 2,17), benken (z 7,83–8,45, overkant 0,90), vinduet (z 6,91–8,19), speilskapet (x 0,35–1,15), ventilen (1,13; 8,22) og spottene (1,88; 6,37), (1,88; 7,22), (1,88; 7,97), (1,18; 7,97) og (0,53; 7,97). <br>• **WC-kassen** sentreres mellom dusjglasset og vindusnisjen: kasse z 5,93–6,71, WC midt z 6,32. <br>Den frie sørveggen er z 4,55–6,05 (1,50), og der legger dørbladet (0,73, §5.1) seg. | §1.4 vaskerom (nordvindu z 7,25–8,53), §2.7 Vaskerom; vaskerom.md (lokale z for et rom på 4,08) | Følger av V5. Dørbladet trenger ca. z 4,55–5,35 med vrideren. Vinduet sitter 0,26 fra NV-hjørnet som i notatet. | middels |
| V59 | **Dusjen i vaskerommet** har to glassider, h 2,00, med matt svarte profiler #151515: fronten mot sør (x 1,21, z 4,55–5,72) med fast felt og skyvefelt med stanghåndtak, og et fast sidefelt mot vest (z 5,72, x 0,13–1,21). Mørke plater #5a5657 går til taket på nord- og østveggen. Kvadratisk takdusj 0,25 på h 2,15, sluk Ø 0,15 på (0,73; 5,25), dusjsett på nordveggen ved z 5,05. | §2.7 («Fronten har skyvedør og fast felt», uten sidefelt) | 225450 viser et glassfelt med svarte profiler mellom WC-en og dusjen, i tillegg til fronten. | høy |
| V60 | **Håndkletørkeren** er ett loddrett, matt svart rør, Ø 0,03, fra h 0,05 til 1,80 (veggfeste på 0,30, krok øverst), på østveggen ved x 1,31. Det er builtIn `towel-radiator` med `params.form: "single-tube"`, ikke stige eller panel. | §2.7 («Håndkletørker på østveggen»), typelista i §1.2 | vaskerom.md (Kontrollert 2), målt rett forfra i 225508. | middels |
| V61 | **Innerdørene i kjelleren** får egne mål og beslag etter tabellen i §5.1, ikke en kopi av `door-gang` (1,07 / 0,93). | §2.7 («som oppe, men med svart vrider på rund rosett og nøkkelskilt»), §1.4 (døra til kjellerstua x 3,07–4,02) | Tegningen gir 0,88 for døra GANG ↔ kjellerstue og for vaskeromsdøra. 225723 (stålvrider, grå terskel), 225704 og 225630 (svart vrider), 225617. | høy |
| V62 | **Døra kjellerstue ↔ soverom:** 8M, hull 0,88 × 2,12 på z 10,01–10,89 (0,49–1,37 fra vestveggen på z 11,38), i veggen x 2,76–3,05. Hengsler i vest, slår inn i soverommet, `openAngleDeg 130`. D3-regelen («midtpunktet transformeres, bredden beholdes») gjelder ikke her. | D3 (regelen for åpninger), §1.4 soverom-kjeller («Dør fra kjellerstua», uten plass) | Tegningen har hullet 0,98 bredt, 0,53–1,51 fra vestveggen. 225723, rett forfra, gir 0,87. Hengselet i vest er bekreftet i både tegningen og bildet. | høy |
| V63 | **Vestvinduet i soverommet i kjelleren:** x 0,76–2,06 (lokalt 0,63–1,93), sill 0,88, topp 2,19, vinduskarmplate på h 0,95. Nisjen er 0,35–0,40 dyp med sort foring #25272b, og vinduet er topphengslet. | §1.4 («Vestvindu x 0,59–1,90, sålbenk 0,87») | 225721 rett forfra. Tegningen gir lokalt 0,68–1,96. | høy |
| V64 | **Sørvinduene i kjellerstua:** V1 på z 7,41–8,76 og V2 på z 9,50–10,85 (1,35 inkl. lista), sill 0,85, topp 2,15. Dyp sort lysning og plissé #a39588 nede. | §1.4 (V1 z 7,72–9,07, V2 9,94–11,29) | kjellerstue.md (lokalt z 2,09–3,44 og 4,18–5,53) i V1-rammen. Tegningen gir hullene 7,44–8,74 og 9,50–10,80. | høy |
| V65 | **Møblene i kjellerstua nå:** TV 1,70 × 0,98 × 0,06 på vestveggen, midt x 4,97, h 1,07–2,07. To armlenestoler (`chair`, sort metallramme #1c1c1c, skifergrå pute #5a5c64): stol A på (4,00; 11,02) med fronten mot sørøst, stol B på (4,80; 5,67) med fronten mot vest. Soveromsdøra og en gangsone på 0,8 m foran den holdes fri. Pult, skuffeseksjon, kontorstol, tredemølle og spinningsykkel er faste møbler, ikke rot. De tas med etter eierens svar på §8.7.4, som nye modeller eller `optional`. Steg 23 («møbler i kjellerstua … etter bildene») rettes til dette. | §2.7 Kjellerstue («TV og to stoler»), steg 23 | kjellerstue.md (Møbler, ryddig). 225647, 225651, 225655 og 225700. Katalogen har `tv` og `chair`, men ikke pult, kontorstol, tredemølle eller sykkel. | middels |
| V66 | **Møblene i soverommet i kjelleren:** bokhylla (`bookcase`, PAX uten dører) er 1,00 × 0,58 × 2,01, #2b2522, tom, og står mot nordveggen på x 0,13–0,71 og z 10,37–11,37 med `rotationDeg 90` (fronten mot sør). Én bouclé-stol (`dining-chair`, `optional`) på (2,43; 9,50) med `rotationDeg −90`. De to sorte plasthyllene (0,92 × 0,45 × 1,85–1,90, mot østveggen på x 0,85–2,73) er lagerhyller og blir `optional` eller utelates. Ingen seng før eieren har svart. Sort termostatpanel 0,086 × 0,086 på sørveggen, z 9,93, h 1,10. | §2.7 Soverom («Bokhylle i NV-hjørnet og to bouclé-stoler») | 225715, 225717 og 225723: mellom hyllefronten og dørgerikten er det bare ca. 1,0 m, altså plass til én stol. | middels |
| V67 | **Takfarger:** GANG og entré får SAND #cfc5b4. Kjellerstua og soverommet får #e8e4dc (`estimated`, kan være SAND). Vaskerommet får #ebeae6. | §2.7 Felles («brukket hvitt #e8e4dc» i alle rom unntatt vaskerommet) | 225630 (GANG) og 225723 (soverommet): taket har samme varme greige tone som veggene. Ikke målt i dagslys. | lav |
| V68 | **Bod 2 og rom 3,70:** bod 2 er x 2,06–6,33 og z 0,13–2,45, med dør x 4,73–5,68 i GANGs østvegg (z 2,45–2,56), hengsler i sør, slår inn. Rom 3,70 får dør x 6,40–7,40 i entréens østvegg (z 2,97–3,12), med hengsler i nord, og slår inn. Nordkarmen ligger rett ved rommets NV-hjørne (x 6,44). Begge er lukket og tomme, med én pære som er av. | §1.4 bod-2 (x 1,88–6,22, dør x 4,60–5,55), bod-3 (dør x 6,11–7,09) | Døra til bod 2 er fotografert (225635). Døra til rom 3,70: bildene gir lokalt 0,12–1,12 (x 6,28–7,28), planen 0,43–1,26 (x 6,59–7,42). Rommet begynner på x 6,44, så hengselsiden må stå der. | middels |
| V69 | **Skjermbildet av vaskerommet i §7.5:** `pos=0.75,-2.55,7.2&yaw=-90&pitch=-5` mot 225505 (sørveggen med skapraden). Alternativt fra døra: `pos=2.2,-2.55,4.9&yaw=135` mot 225446. | §7.5 steg 24 (`pos=2.2,-2.55,5.0&yaw=75`) | 225505 ser mot sør. Yaw 75 peker nesten mot nord. | høy |
| V70 | **§8.2:** mappa `vaskerom/` har 8 badbilder (225413, 417, 419, 421, 423, 425, 427, 429) og 12 vaskeromsbilder (225443–225525). P0 kobler de 8 til `bad` i `house-photos.json`. | §8.2 («9 bilder») | Mappelista i `bilder_hus/_1600/vaskerom/`. | høy |

### 5.1 Dørene i kjelleren og entréen

| Dør | Vegg | Hull (b × h) | Blad | Hengsler → slag | Beslag og terskel |
|---|---|---|---|---|---|
| GANG ↔ vaskerom | badveggen z 4,43–4,55 | x 1,84–2,71 (0,87) × 2,15 | 0,73 × 2,08 | sør → inn i vaskerommet, bladet legger seg mot sørveggen | Sort vrider med liten sort rosett/lås, h 1,05, på nordkanten. Terskel i kjellergulvets eik (#cbbfb0), smal mørk list mot vinylen. |
| GANG ↔ kjellerstue | z 5,23–5,32 | x 3,21–4,10 (0,89) × 2,10 | 0,75 × 2,03 | nord → inn i stua, bladet parkerer langs østenden av stuas nordvegg | Sort L-vrider på avlang rosett med eget avlangt nøkkelskilt. Rosettformen avklares (entre-gang-kjeller.md sier rund). Smal mørk terskel. |
| Kjellerstue ↔ soverom kj. | x 2,76–3,05 | z 10,01–10,89 (0,88) × 2,12 | 0,74 × 2,05 | vest → inn i soverommet, 130° | Vrider i børstet stål på rund rosett med rundt nøkkelskilt. Grå terskel #5a5e63. |
| GANG ↔ bod 1 | nisjeveggen z 2,22–2,32 | x 1,06–1,85 (0,79) × 2,05 | 0,65 × 1,98 | sør → inn i boden, lukket | Sort vrider på rund rosett (anslått). |
| GANG ↔ bod 2 | z 2,45–2,56 | x 4,73–5,68 (0,95) × 2,10 | 0,81 × 2,03 | sør → inn i boden, lukket | Sort vrider (anslått). |
| Entré ↔ rom 3,70 | z 2,97–3,12 | x 6,40–7,40 (1,00) × 2,10 | 0,86 × 2,03 | nord → inn i rommet, lukket | Sort fyllingsdør med ett innfelt felt, sort vrider på rund rosett med nøkkelskilt, flat sort terskel. |
| Entré ↔ GANG | x 5,75–6,16 | z 3,42–4,35 (0,93), topp y −0,50 (som entréhimlingen, 0,20 nedforing på gangsida), uten dør og karm | – | – | 2 trinn à 0,15, sorte trinnkantprofiler, mellomtrinnet i lysningen (V24). |
| Ytterdør | x 8,67–8,88 | element z 3,31–5,31 × 2,10 | 1,0 × 2,05 (z 3,81–4,81) | øst → ut, 95° | V27. |

Høydene på bod-dørene og døra til rom 3,70 er anslått. Alle innerdører har sort blad #1d1e21 med ett innfelt felt og sort
karm og gerikt på 0,07. Karmen står innenfor hullet, så bladet er hull − 2 × 0,07, som i V49 (rettet i Kontrollert (2)).
Bladhøyden er hull − 0,07 (toppkarmen), ellers blir det en sprekk under toppkarmen (rettet i Kontrollert (1)).

---

## 6. Steg som berøres (§6)

- **Steg 3 (S0-data):**
  - `validateHouse` regner opptrinnet ut som −floorY / risers og inntrinnet som ganglinje / (risers − 1). Ingen
    konstant 0,182 eller 14.
  - Ny sjekk: trinnkanten (med nosing) og vangefoten skal stå minst 0,05 fra hver dørkarm.
  - Kutter builderen en dør under trappa mer enn 0,05, gir det advarsel om at trappedataene er feil.
  - Kontrollarealene er modellens tall fra §1.1. Bod 1 (−9 %) og GANG (+5 %) står på lista.
  - `floorOffset` er lov på `bod-3` (ikke bare entréen).
  - Ny dårlig fixture: et trinn som overlapper en dørkarm.
- **Steg 4 (S0-layout):**
  - `levels[].plan.pxPerM` kan være et tall.
  - `floorOffset` virker per rom.
  - Testen i §7.2 bruker føttene på −0,20 + 0,9 (ikke −0,18).
- **Steg 7 (A1):**
  - Data etter V37–V55: `door-bad` (hull x 1,54–2,45, blad 0,77 × 2,08, vrider med WC-vri, todelt terskel),
    `door-soverom` (blad 0,81 × 2,05, vrider på 1,05, terskel #2b2b2d), `win-sov` (V51).
  - Badveggene #c8c5bf. Sokkel per rom: badet mørk 0,04, gang og soverom #ada291.
  - `l-gang-tak` på (1,2; 2,40; 3,1), Ø 0,38, og P1/P2 som fixtures. `l-bad-tak` med mørk kant og 1500 lm, `l-bad-spot` på x 2,20.
  - `source` peker på `bad-1etg.md`.
  - Arealtesten (5,62 / 6,58 / 11,45) er uendret, fordi D1 står.
- **Steg 8 (A2):**
  - `rooms.js` legger sokkel per romsløyfe med egen farge og høyde, og badet får oppbrett.
  - `doors.js` tegner `door.hardware` (vrider/rosett, WC-vri, nøkkelskilt) og todelt terskel `{ top, front, depth }`.
  - Vindussmyg uten gerikt (`win-sov`).
- **Steg 10 (A4):**
  - `stonePanel` med size [0,6; 2,4], uten vannrett fuge.
  - `buildShower` lager femkanten fra hjørnepunkter eller `returns` (0,37), uten topprofil, og en rett variant med to
    glassider (fast felt + skyvefelt foran, fast sidefelt) til vaskerommet.
  - `buildRoundLedMirror` Ø 0,80, 3000 K.
  - `buildTowelRadiator` med `form: "single-tube"`.
  - «Bilder: via notat (`bad-1etg.md`)».
- **Steg 12 (A5):**
  - Innredningen på badet etter V38–V45 (servant, høyskap 0,40 på x 1,10–1,50, speil, WC, stikkontakt, bryter,
    dopapirholder, knagg).
  - Soverommet etter V52–V53 (seng 0,70, nattbord 0,35 × 0,38 × 0,55, laken, bryter 1,15, knaggrekke 1,60, garderobe
    #545656, uttak).
  - «Bilder: via notat (`bad-1etg.md`, `soverom-1etg.md`)».
- **Steg 13 (L1):** gangens plafond står på (1,2; 3,1) over hullet, mens proben står fast på (2,6; 1,45; 3,4).
  Speilringen er 3000 K og 400 lm. P1/P2 er ikke lyskilder.
- **Steg 18 (B1):**
  - §1.6 byttes med §2.4 i denne fila: 13 opptrinn, foten på 1,73, toppen på 1,45, øyet x 1,04–1,45, hullet med 1,45,
    hylla x 0–0,13 med topp −0,27, håndløperen med `startHeight 0.70`, trinnprofil og farge.
  - `levels.plan` = 60,25 / [119,2; 112,1].
  - Forenklet `kjeller-gang` etter polygonet i §1.1.
  - `stairWalk` (`house.mjs`) lages om etter V13. Ganglinja går midt i den frie bredden, med kvartbuer rundt øyets to
    hjørner og en rett strekning over nordenden. Tverrsnittet i svingen er den frie bredden mellom øyet og sjaktveggene.
    Ganglinja skal bli ca. 2,87 lang.
  - Testen: «validatoren rapporterer opptrinn 0,196», inntrinn ≈ 0,24 og 2r + g ≈ 0,63, uten advarsel. Ingen
    «trinnene går utenfor kjeller-gang». Med dagens halvsirkel feiler den: 0,255 / 0,647, og tverrsnittet når x −0,02.
- **Steg 19 (B2):**
  - `stairLayout` leser `risers`, balanserer vangetrinnene og lager trinnprofilen med list.
  - Håndløperen starter i `startHeight`.
  - Hylla er topp av veggen, ikke en kloss.
  - Geometritesten: `risers × opptrinn = 2,55` (ikke `14 ×`), og ingen trinn eller vange innenfor 0,05 av en dørkarm.
    Veggvangen langs z 4,43 kappes loddrett ved foten, senest på x 1,79 (V17).
  - Skjermbildet `pos=1.9,0,2.9` står fortsatt på gulvet (x 1,9 > 1,45).
- **Steg 20 (M2):** θ ≈ 39–40° og fri høyde ≈ 1,97–1,98 kommer fra validatoren. Ingen andre endringer.
- **Steg 21 (A2′):**
  - Hullet med x 1,45.
  - Sjaktveggene i kjelleren: nord x 0,13 opp til −0,27 (hylla x 0–0,13), øst z 2,32 for x 0,13–1,85 og z 2,56 for
    x ≥ 1,85, vest z 4,43.
  - Kantflata 0,30 bare på de frie kantene. Langs sjaktveggene (x 0, z 2,32, z 4,43) går veggflata gjennom (V16).
- **Steg 22 (B-test):** walkmap-målene er uendret.
- **Steg 23 (C1):**
  - Alle kjellerdata i V1-rammen etter §1.1, §1.2, §5.1 og V56–V68.
  - Vaskerommet ankres etter V58.
  - Møblene etter V65–V66. Ikke «etter bildene» for pult, tredemølle og sykkel.
  - `outsideHouse`: `entranceLevelY` avledet (−2,87), forplassen x 8,88–12,6 · z 3,18–6,75, `terraceStair.risers 16`,
    og spawnen avledet fra døra (V32).
  - Faste ting ute og gruppa `ute` etter V35.
  - Kontrollarealene etter §1.1.
- **Steg 24 (C2):**
  - Himling på −0,50 i #4a4642 i entréen, rom 3,70 og nisjen (V28).
  - Himlinger på −0,30 under utkragingene (V4, V6).
  - Ytterlaget i nord og øst ut til −0,30 (V10).
  - Søyla som kjellerstuas hjørne (V7) og fyllvolumet bak dørveggen (V31).
  - `bod-3` med `floorOffset` (V29), entrétrinn 2 × 0,15, ytterdørelementet 2,0 med 95° (V27).
  - Vaskerommets dusj med to glassider og ett rør i håndkletørkeren.
  - Skjermbildet av vaskerommet etter V69.
  - «Ingen kjellervegg i eksteriørets bokser» testes med de nye ytterflatene.
- **Steg 25 (C3):**
  - Grunnmursboksene: under `w-vest-stue` fjernes helt, under `w-sor` og kjøkkenet (der de står i entré og rom 3,70)
    fjernes.
  - Inngangspilaren (V30). Hjørnepilaren bare på bekreftelse.
  - Terrassetrappa 16 × 0,1775 til x 11,37 og reposet x 11,37–12,4 (V33).
  - `groundBelowY` / `terrain.nearHouseY` / `nearGround.y` −2,95 og `nearGround.toX` 12,8.
  - Dekket ut til x 10,35 for z −0,30 … 6,0 (V9). Himlingen på −0,50 dekker hele den overdekte delen: også
    x 8,88–9,80 · z 6,0–6,75 bak pilaren (§1.1).
  - Kledningen z 3,18–6,75 og sørflaten av rom 3,70 i #4a4642 (V31). Beleggfargene etter V34.
  - Fotoprojeksjonen i 082841 og 082852 prøver i tillegg terrassekanten på 9,80 mot 10,35 og om den hvite pilaren er
    inngangspilaren. Passer 9,80 klart best, får rom 3,70 eget flatt tak for x 9,80–10,34, flagget.
- **Steg 26 (U2):**
  - Spawnen regnes ut fra dørdata (V32): (12,2; −2,87; 4,6), yaw 85°, pitch −6°.
  - Dørslaget er x 8,88–9,88 · z 3,81–4,81.
  - Walkmap-målet ute er `12.2,-2.87,4.6`.
- **Steg 27 (L2):** `skyView` på V1/V2 med de nye z-ene (V64) og soveromsvinduet (V63). Gruppa `ute` er på om kvelden.
- **Steg 30 (P0):** de 8 badbildene kobles til `bad` (V70).
- **§7.2:**
  - Rad 4: «føttene −0,20 + 0,9».
  - Rad 18–19: «Opptrinn = −floorY / risers (0,196)», «risers × opptrinn = 2,55».
  - Rad 23: kontrollarealene etter §1.1.
- **§7.4:** ute `12.2,-2.87,4.6`. Kjellerstua `3.5,-2.55,6.2`, vaskerommet `1.3,-2.55,6.4`, soverommet i kjelleren
  `1.3,-2.55,10.2` og entréen `7.4,-2.85,4.4` ligger fortsatt inne i sine rom.
- **§7.5:** startbildet `pos=12.2,-2.87,4.6&yaw=85&pitch=-6`, og vaskerommet etter V69. De andre er uendret.

## 7. Til målelista

I prioritert rekkefølge. Punkt 1–5 avgjør flest tall.

1. **Den innvendige trappa:** antall opptrinn (nå 13; 14 gir 0,182 og 15 gir 0,170) og høyden på ett opptrinn.
   Bare fordelingen av vangetrinn endres.
2. **Terrassetrappa:** antall trinn. Med 16 står forplassen på −2,87, med 9 på −1,72.
3. **Ytterdørelementet:** bredden (nå 2,0, planen 1,85) og bladbredden. Det skalerer også alle avstander ute som er målt i
   225543.
4. **Kjelleren øst–vest:** kjellerstua (nå 6,06) og vaskerommet (nå 3,90, planen 4,08). Er vaskerommet 4,08, flyttes
   vestlinja til z 11,53 og kjellerstua blir 6,21 (21,1 m²). Se etter et sprang på ca. 0,4 m i vestfasaden.
5. **Sørfasaden under stua:** står kjellerstuas sørvegg ca. 0,33 inn under stua, eller i flukt? Ta gjerne et bilde.
6. **Hullet oppe:** fra nordveggen til neselista (nå 1,45), til nordkarmen på baddøra (nå 1,54) og til rekkverk A
   (nå 1,85). z for rekkverk B (nå 3,48) og nyestolpen (nå 3,10).
7. **Trappefoten:** fra kjellerens nordvegg til nesa på trinn 1 (nå 1,60) og til nordkarmen på vaskeromsdøra (nå 1,71).
8. **Entrétrinnene:** høyden på hvert trinn (nå 0,15).
9. **Rom 3,70 og terrassekanten:** hvor sørveggen står (ytterflate nå 10,34), hvor terrassekanten står målt fra husveggen
   (nå 9,80 i TERRACE_FIT), og om det er én eller to pilarer.
10. **Takhøyder:** ett kjellerrom (nå 2,25) og gang, bad og soverom oppe (nå 2,40).
11. **Fra karmen på `door-gang` (gangsiden) til veggen mot soverommet:** 4,40 eller 4,43 (D1).
12. **Bod 1:** dybden øst–vest (eieren 2,32, modellen 2,09 med nisjen) og hvor dyp nisjen ved døra er.
13. **Innerdørene:** bredden på hver dør. Kjelleren: 0,87 / 0,88 / 0,89 / 0,95 / 1,00. Oppe: baddøra (nå 0,91) og
    soveromsdøra (0,95).
14. **Vinduene:** badet 48 × 117 (er 48 bredden?) med sålbenk, soverommet oppe (nå 1,17 × 1,17, sålbenk 0,92) og
    soverommet i kjelleren (nå 1,30, sålbenk 0,88).
15. **Håndløperen:** høyden på den øvre enden over gangulvet (nå 0,70).
16. **Hylla i sjakta:** dybde og hvor langt under gulvet toppen ligger (nå 0,13 og −0,27).

Spørsmål som ikke er mål, står fortsatt i §8.7. Nye: er gulvlistene oppe i gang og soverom lys eik eller hvite (V50)? Er
taket i kjelleren hvitt eller SAND (V67)?

## Kontrollert (2)

Gjennomgang 2026-10-21 med ett spørsmål: støtter bildene og planene beslutningene? Jeg sjekket trinntallet, dørene og
inngangen. Bildene er åpnet som utsnitt av originalene (4000 × 3000, 13 mm-ekv., f ≈ 601 px i 1600-rammen). Planene er
pikselmålt: kjelleren med V1, og 1. etasje med 51,3 px/m og origo (90,5; 51,5) fra room-spec. Alle px-tall under er i
1600-rammen.

**Endret:**
- **§5.1, bladbreddene.** Tre rader brøt regelen i V49 (blad = hull − 2 × karm 0,07). `shell.js` tegner karmen innenfor
  hullet, så bladet ville gått inn i karmen med 0,015–0,035 på hver side:
  - vaskerommet: 0,80 i et hull på 0,87, rettet til **0,73**
  - kjellerstua: 0,82 i 0,89, rettet til **0,75**
  - soverommet i kjelleren: 0,77 i 0,88, rettet til **0,74**

  Planen støtter dette: karmsymbolet på kjellerstuedøra er 0,76 innvendig (kjellerstue.md). Vil man heller ha
  notatenes blad (9M 0,82, 8M 0,77), må hullet økes til bladet + 0,14. Det går ikke for vaskeromsdøra. Mot nord kommer
  nordkarmen da nærmere enn 0,05 til trinn 1, og mot sør går hullet forbi hjørnet på x 2,76. Merknaden under §5.1 og
  V58 (bladet 0,73) er rettet tilsvarende. Validatoren sjekker bare blad ≤ hull og ville ikke fanget feilen.

**Kontrollert uten endring:**
- **V12, 13 opptrinn.** Jeg talte nesene der de møter veggvangen:
  - 225337: 2 på østveggen (px (777; 1121) og (755; 1000)) og 5 på nordveggen (x 653, 546, 463, 391 og 313, y 950–990).
    Den vestligste nesa står like øst for NV-hjørnet (px ≈ 285).
  - 225342: 5 på vestveggen ((567; 853) ved vangefoten, så (603; 891), (649; 928), (703; 976) og (784; 1043)). Etter
    dem kommer NV-hjørnet (939; 1171), og trinn 5 dekker hjørnet.
  - 225339 gir 5 på nordveggen og 5 på vestveggen. 225333 gir 2 på østveggen.
  - Til sammen er det 12 neser pluss gulvkanten, altså 13. trapp.md kom til 14 inntrinn fordi hjørnetrinnene ble talt i
    tillegg til nesene på veggene.
  - **Kontrollen nedenfra er svak.** 225349 og 225631 viser 7 trinn i nedre løp. I øvre løp blir plate, list og
    underside til hvert sitt bånd, så man ser 4–6 bånd. At det ikke finnes noe skjult trinn, hviler derfor på tellingen
    ovenfra. Sikkerheten «middels» står.
- **V14:** I 225349 og 225631 er nesene på trinn 1–3 parallelle, og trinn 4 står svakt på skrå. Trinn 5 og 10 er
  hjørnetrinnene: nesa på trinn 5 står på vestveggen og nesa på trinn 6 like rundt hjørnet. Det samme gjelder trinn 10
  og 11 i NØ-hjørnet.
- **V17 og V18:** Skraveringen i kjellerplanen slutter på px 223 (x 1,72) i nedre løp og på px 179 (x 1,00) i
  svingen. Vaskeromsdøra er tegnet på x 1,81–2,70, og den slår inn med hengselen i sør. I 225631 står trinn 1 rett ved
  nordkarmen.
- **V15 og V49:** 1. etasjes plan tegner baddøra på px 170–215, altså x 1,54–2,43, og «1,54»-streken ender ved døra. I
  225333 og 225335 ender neselista en kort gulvlist nord for karmen.
- **V20:** Planen tegner bod-1-døra på x 0,96–1,77, med hengselen i sørenden. 225639 viser søndre karm ved
  nisjehjørnet og nordre karm opp mot vangen. Flyttingen på 0,08–0,10 mot sør har altså støtte i bildet.
- **De andre dørene i §5.1**, målt i planen:
  - Kjellerstuedøra er x 3,25–4,10, med hengsel i nord.
  - Åpningen entré ↔ GANG er z 3,42–4,35.
  - Soveromsdøra i kjelleren er tegnet z 9,87–10,85. I 225723 har den hengsler i vest og slår inn i soverommet.
  - Døra til rom 3,70 er tegnet x 6,55–7,47, med hengsel i nord. 225617 har håndtaket i sør. V68 (x 6,40) er et
    kompromiss mellom bildene (6,28) og rommets NV-hjørne (6,44) og er ikke målt direkte.
  - Bod-2-døra finnes ikke i planen. 225635 viser den ved SØ-hjørnet, med hengsler i sør, og den slår inn.
- **V24:** De to trinnene ses i 225553 og 225559. Jeg målte 225559 med lysningen (0,93) som skala:
  - Rått gir det 0,145 og 0,147.
  - Kameraet er vippet ca. 10° ned. Korrigert for det blir trinnene 0,157–0,160.
  - Det støtter 0,15–0,16, ikke 0,17.
- **V27:** Hengslene sitter på østkanten (225543), og bladet står åpent ute mot øst (225553). Bladet tar ca. 51 % av
  elementbredden. Planen har elementet 1,89 bredt. Elementets østkant står 27° fra kameraet, og det gir ca. 0,09 til
  sideveggen. Det stemmer med z 3,31 innen 0,05.
- **V8 og V9:**
  - Planen gir entréen x 6,15–8,68 og rom 3,70 x 6,44–10,15, med ytterflate på 10,34.
  - Entréens vestvegg er tegnet på z 5,86–6,06.
  - I 225543 ses kledningen på sideveggen til px ≈ 1570 av 1600. Med kameraet i V32 tilsvarer det minst x ≈ 10,1–10,2,
    så 10,05 er et minimum.
- **V64:** Vindushullene i kjellerstua er tegnet på z 7,43–8,75 og 9,49–10,80.

## Kontrollert (1)

Gjennomgang 2026-10-21 med ett spørsmål: henger geometrien sammen? Jeg sjekket fire ting:
- at rommene går opp uten overlapp og hull,
- at veggene står over hverandre mellom etasjene (sjakta og ytterveggene),
- at trappa passer i hullet og i GANG uten å sperre dører,
- at opptrinn × antall = etasjehøyden.

Grunnlaget er tallene i fila, room-spec.json og koden som er flettet (`house.mjs` steg 3, `shell.js`, `exterior.js`).
Jeg kjørte `stairWalk` på dataene i §2.4 og pikselmålte kjellerplanen.

**Endret:**
1. **V13, §2.1, V12 og §6 steg 18–20: ganglinja.** `stairWalk` i `house.mjs` legger én halvsirkel rundt midten av
   øyets nordkant ((1,04; 3,29), r 0,58–0,665). Med §2.4 gir det:
   - ganglinje 3,06, inntrinn 0,255 og 2r + g 0,647, altså en advarsel;
   - trinntverrsnitt helt ut til x −0,02, altså «trinnene går utenfor kjeller-gang».

   V12 sier at bare 13 opptrinn gir 2r + g innenfor 0,60–0,64. Det holdt ikke med denne koden: 14 gir 0,599, og ingen
   antall mellom 12 og 15 havner innenfor. Midt i den frie bredden (to kvartbuer rundt øyets hjørner og en rett strekning
   over nordenden på x ≈ 0,585) blir det:
   - ganglinje 2,88, inntrinn 0,240 og 2r + g 0,632 (vangetrinnene 0,635);
   - tverrsnitt innenfor x ≥ 0,13 og z 2,32–4,43;
   - for 14 opptrinn 2r + g 0,586, så bare 13 holder.

   Det stemmer med trapp.md (svingen 1,73). V13 sier nå hvordan ganglinja skal gå, og steg 18 retter `stairWalk` og
   testen. Tallsettet er justert: inntrinn ≈ 0,24, 2r + g ≈ 0,63, θ ≈ 39–40° og kapselhøyde ≈ 1,97–1,98.
2. **V17, tekstavsnittet etter §2.4 og steg 3 og 19: vangefoten.** Forlenget treffer neselinja gulvet på x 1,97. Det er
   inne i vaskeromsdøra (x 1,84–2,71). En veggvange med overkant langs neselinja ville gått over nordkarmen. Vangen
   kappes derfor loddrett ved foten, senest på x 1,79, og validatoren sjekker vangefoten mot dørkarmer, ikke bare
   trinnkanten.
3. **V16 og steg 21: kantflata.** Den hvite kantflata på 0,30 legges bare på de frie kantene: x 1,45 under neselista og
   under C, z 3,48 under B og x 1,85 under A. Langs x 0, z 2,32 og z 4,43 går sjaktveggene i samme plan gjennom
   etasjeskillet. Der ville kantflata blitt en hvit stripe med z-fighting.
4. **§1.1 `bod-1` og steg 3:** x 0,15 → **0,13**. Kjellerens nordvegg står på 0,13 (V1), så 0,15 ga en sprekk på 2 cm
   mot veggen. Planen tegner boden på x 0,13–1,79 (px 127–226). Arealet blir 1,66 × 2,09 = 3,47 (−9 %).
5. **V9 og §1.1: dekket over rom 3,70** går fra z −0,30, ikke −0,16. Østflaten står på −0,30 (V10), og med −0,16 ville
   toppen av østveggen vært åpen for x 10,0–10,35, øst for annekset.
6. **§1.1 nisjen og steg 25: himlingen.** Den overdekte delen er også x 8,88–9,80 · z 6,0–6,75, bak pilaren og under det
   gamle dekket. Kledningen går dit (V31, ytterdor-ute.md: «himlingen … z 3,17–6,75»). Himlingen på −0,50 dekker derfor
   hele L-en. Ellers blir det et sprang på 0,27 i taket på z 6,0.
7. **V33, §1.1, §3.1 og steg 25:**
   - Reposet går fra x 11,37, ikke 11,4. Trappa slutter på 11,37 (7,62 + 15 × 0,25), og i TERRACE_FIT begynner landingen
     der trappa slutter.
   - Den gamle landingen utgår, og stien `path` forlenges til 11,37.
   - `nearGround.y` −2,95 settes eksplisitt. Mens TERRACE_FIT gjelder, bruker exterior.js ellers −1,75, og da ligger
     plenen og foten av terrassens kledde vestside 1,1 m over forplassen.
8. **§5.1: bladhøydene** følger samme regel som bredden i Kontrollert (2): hull − 0,07 for toppkarmen. Vaskerommet får
   2,05 → **2,08** og soverommet i kjelleren 2,04 → **2,05**. Ellers står det en sprekk på 1–3 cm under toppkarmen
   (`shell.js`: lh = leaf.h − 0,008 under karmen på H − 0,07). V58 er justert til at bladet med vrider trenger z 4,55–5,35.
9. **§5.1 entré ↔ GANG:** lysningen får toppen på y −0,50, i flukt med entréhimlingen og med 0,20 nedforing på gangsida
   (entre-gang-kjeller.md).
10. **§1.2:** Lomma x 6,16–6,33 · z 2,56–2,97 hører ikke til noe rom. Planen viser den som et hvitt felt. Den fylles som
    vegg.
11. **V19 og §2.3:** Kileflaten går fra −2,55 til 0, og HUD-rommet `trapp` bruker samme polygon opp til 1,0, som i layout.js
    og §1.1. Før sto «trapp-prismet … til 0», og det motsa §1.1.
12. **V22:** Håndløperen langs nordveggen regner `offset` fra kjellerveggen (x 0,13) hele veien. Fra ca. trinn 7 går den
    over hyllehøyden (trapp.md: x ≈ 0,21 i ett plan).

**Kontrollert uten endring:**
- **Opptrinn × antall:** 13 × 0,19615 = 2,55 (0,30 + 2,25). Trinn 1 ligger på −2,354, trinn 11 på −0,392 og trinn 12 på
  −0,196. Entréen har 2 × 0,15 = 0,30 (−2,55 → −2,70 → −2,85), og terskelen er −2,87. Terrassetrappa har
  16 × 0,1775 = 2,84 (−0,03 → −2,87) og 15 × 0,25 = 3,75 (7,62 → 11,37). exterior.js runder 2,84 / 0,18 til 16.
- **Rommene i kjelleren går opp:**
  - Nord–sør fra x 0: hylla 0,13 + vaskerom/soverom 2,63 + vegg 0,29 + kjellerstue 3,40 + vegg 0,30 = 6,75.
  - Øst–vest i vest: GANG til 4,43, vegg 0,12, vaskerom 3,90, vegg 0,10, soverom 2,83 og vegg 0,30, til 11,68.
  - Nordrekka: bod 1 1,66 + 0,27 + bod 2 4,27 + 0,11 + rom 3,70 3,71 + 0,19, til 10,34.
  - Østrekka: z 2,22 / 2,32, 2,45 / 2,56 og 2,97 / 3,12 mot GANG og entré.

  Ingen polygoner overlapper. Entréen må være L-formet (minus søyla), for som rektangel overlapper den kjellerstua med
  0,21 m², og validatoren gir da feil. GANG-polygonet er 13,08 m² og hullet 3,44 m².
- **Veggene står over hverandre:**
  - Sjaktas østvegg ligger på z 2,32 og vestveggen på 4,43 i begge etasjer.
  - Nordveggen står på x 0 oppe og 0,13 nede, med hylla på −0,27 imellom (inne i dekket på −0,30 … 0).
  - Ytterflatene i nord og øst er −0,30 i begge etasjer.
  - I vest og sør krager 1. etasje ut, med himling på −0,30. Den dekker x 6,75–7,22 fra z 6,75 og hele z 11,68–12,23.
  - Knekken i 1. etasje ligger på z 5,08, med kjøkkenet ytterst på 6,62 og stua på 7,22. Undersiden mellom z 5,08 og 6,75
    lukkes av entréhimlingen, entréens vestvegg og fyllvolumet (V31), så det er ingen åpning.
  - Rom 3,70 dekkes av kjøkkendekket, terrassen og utvidelsen.
- **Trappa i hullet og i GANG:**
  - Fotavtrykket ligger inne i hullet og i `kjeller-gang`.
  - Fri høyde ved hullkanten er 2,15 (pitchlinja under dekket på −0,30). Validatoren måler 2,25, fordi den regner gulv
    utenfor foten.
  - Ingen dør slår inn over trappa, hullet eller feltet 0,9 foran trinn 1. Baddøra og soveromsdøra oppe slår inn i rommene
    sine, og vaskeromsdøra slår inn i vaskerommet.
  - `door-gang` på 90° gir 0,34 forbi hjørnet av rekkverk B, under FREE_WIDTH 0,75. Det bekrefter V55.
  - Nesa på trinn 1 med nosing står på 1,76, og nordkarmen på vaskeromsdøra på 1,84. Avstanden er 0,08.
  - Validatorens høydesjekk for døra under trappa kutter ikke bod-1-døra. Toppen er −0,50, og trinn 11 minus platen er
    −0,43.
- **Merknader (ikke endret, fordi beslutningen står):**
  - **Bod-1 kan åpnes, men man kommer ikke inn.** Den lukkede kilen under øvre løp (design §3 pkt. 1) dekker x 1,06–1,45 foran
    døra. Bare x 1,45–1,78 er fri, altså 0,33 m, og kapselen trenger 0,60 (radius 0,3). Det passer med «lukket». Skal man
    kunne gå inn, må kilen få underside under trinn 11–12, der det er ca. 2,0 m under vangen.
  - **Validatoren vil advare** om at «hullet havner ikke helt innenfor baksideflaten» for to dører:
    - bod-1-døra går til x 1,85, mens bod 1 slutter på 1,79 (0,06);
    - døra til rom 3,70 begynner på x 6,40, mens rommet begynner på 6,44 (0,04).

    Karmen på 0,07 fyller lomma i begge, så det synes ikke. Advarselen forsvinner om hullet til rom 3,70 settes på
    6,44–7,44, eller om bod 1 gjøres 1,85 dyp. Begge er innenfor målespriket, men jeg har ikke endret beslutningene.
  - **Sprekken mellom kjøkkenhjørnet og annekset** (x 6,62–6,80 · z −0,30 … 0) står fortsatt åpen ned mot toppen av
    østveggen til rom 3,70. Den kan lukkes i steg 25 med en dekkstripe fra z −0,30.
