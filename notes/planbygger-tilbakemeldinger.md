# Planbygger: tilbakemeldinger fra testingen

**Enklest:** trykk «Meld feil» øverst til høyre i planbyggeren (den lokale testserveren). Velg Feil eller Idé og skriv
én setning. Skjermbildet av 2D- eller 3D-visningen og tilstanden (planen, filene og rapporten fra «Generer») lagres i
`.shots/planbygger/tilbakemeldinger/`, og meldingen havner nederst under riktig overskrift her, med neste nummer.

Det går også an å skrive rett i fila, eller lime skjermbilder inn i chatten med nummeret («F7»). Claude sorterer og
krysser av.

**Status:** ny · rettes nå · fase D · runde 2 · senere · rettet (commit) · trenger mer info

**Kjent og satt av til eksteriør-runden** (trenger ikke meldes):
- **Tak:** flatt eller feil taktype og takvinkel, ingen takutstikk, ark, takvinduer i taket eller pipe.
- **Kledning:** type, retning (vannrett eller loddrett), farge og hvor høyt den går, per fasade og per etasje (F1).
- **Vinduer og dører utvendig:** rammer, sprosser, farger og høyden over bakken fra fasadetegningene.
- **Utvendig:** terrasser, balkonger, rekkverk, takterrasse, carport og garasjeport, trapper og terreng.
- **Grunnmur:** sokkel og husets høyde over bakken.

Meld det likevel hvis noe gjør det vanskelig å teste innvendig: du kommer ikke inn døra, går gjennom en vegg, svever
eller faller, eller huset står på feil sted.

---

## Feil

<!-- Mal – kopier for hver feil, og øk nummeret:

### F1 – kort tittel
- **Hus/filer:** hus3 (1etg.png, 2etg.png, fasader.png) – eller «egen plan»
- **Hvor:** opplasting / stabel / Generer / veiviser / 3D / Finjuster / annet
- **Hva skjedde:**
- **Hva du ventet:**
- **Hvor ille:** stopper meg / irriterende / småting
- **Status:** delvis rettet (fase D) – kledningen i 1. etasje stopper nå ved gulvet i etasjen over (den gikk 0,35 m over taket og inn i vinduene der). Kledning i 2. etasje, type og retning per fasade: eksteriør-runden.
-->

### F1 – kledningen går opp i vinduene i 2. etasje, og 2. etasje mangler kledning
- **Tekst:** Kledningen ser ut til å gå opp i vinduene i 2. etasje, og hele 2. etasje mangler kledning. Retningen er også feil mot fasadetegningene (noe er vannrett, noe loddrett).
- **Hvor:** 3D (utsiden) – trolig hus4
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F1.webp`
- **Status:** runde 2 (eksteriør: tak, fasader og kledning som på tegningene). Delen «kledning opp i vinduene / mangler i 2. etasje» kan komme fra omveien for taklinja i viewer.js – sjekkes i fase D, rettes der hvis den er billig.

### F2 – svarte rundinger i gulvet i 2. etasje
- **Tekst:** Svarte, runde flekker i gulvet i 2. etasje.
- **Hvor:** 3D (inne, 2. etasje)
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F2.webp`
- **Status:** rettet (fase D) – etasjen over flyttes opp når takhøyden endres (takhøyde + 0,3 m etasjeskille). Med 2,6 m tak lå gulvet i 2. etasje bare 0,1 m over taket, og taklampene stakk opp.

### F3 – Ser på det øverste vinduet til venstre så flimerer det veldig, usikker
- **Tekst:** Ser på det øverste vinduet til venstre så flimerer det veldig, usikker på hva det er, Dette vinduet er også tegnet feil i forhold til fasadetegningen. Ser også at ytterdøre til venstre flimere litt av og til.
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F3.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F3.json`
- **Status:** flimringen rettet (fase D) – vindusrammen lå i samme plan som veggen i hullet; 3D-visningen gir nå rammer og foringer forrang. Vindusformen mot fasaden: eksteriør-runden.

### F4 – Er er det også flimring på høyre side av øverste vindu, sikkert samme 
- **Tekst:** Er er det også flimring på høyre side av øverste vindu, sikkert samme feil som den andre. Og så ser det ut som det mangler kledning på høyre side av vinduene.
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F4.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F4.json`
- **Status:** flimringen rettet (fase D, som F3). Kledning ved vinduene: eksteriør-runden (F1).

### F5 – Vinduene som går helt til gulvet mangler gulv. De fleste slike vinduer
- **Tekst:** Vinduene som går helt til gulvet mangler gulv. De fleste slike vinduer har som regel gulvet ut til vindu istedet for vinduskarm nede.
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F5.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F5.json`
- **Status:** rettet (fase D) – gulvet går ut til glasset i vinduer som står på gulvet.

### F6 – Vindu. Det er noe rart her. Det er nok derfor det flimret på utsiden o
- **Tekst:** Vindu. Det er noe rart her. Det er nok derfor det flimret på utsiden også
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F6.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F6.json`
- **Status:** rettet (fase D, som F3).

### F7 – Denne trappa skal helst sikkert være en trapp med tette trappetrinn og
- **Tekst:** Denne trappa skal helst sikkert være en trapp med tette trappetrinn og så er dette rommet en bod, her hadde det også vært naturlig og hatt et vegglys for eksempel
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F7.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F7.json`
- **Status:** tette trinn: forespørsel til motoren (stairs.js bygger alltid åpne opptrinn). «ÅPENT OPP» på tegningen betyr åpning i dekket over, ikke åpen trapp. Vegglys i boden: idé til lys-runden.

### F8 – Det er akkurat som jeg ser igjennom ytterdørene av og til på begge sid
- **Tekst:** Det er akkurat som jeg ser igjennom ytterdørene av og til på begge sider og så flimerer kantene på ytterdørene av og til
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F8.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F8.json`
- **Status:** rettet (fase D, som F3 – dørkarm og foring i samme plan som veggen).

### F9 – Hva er dette på veggen
- **Tekst:** Hva er dette på veggen
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F9.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F9.json`
- **Status:** trenger mer info – hvilket rom, og hvor på veggen? (Ta gjerne et nytt bilde litt lenger unna.)

### F10 – her mangler det en vegg rett ved siden av trappa.
- **Tekst:** her mangler det en vegg rett ved siden av trappa.
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F10.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F10.json`
- **Status:** trenger mer info – veggen mellom høyskapene og trappa finnes og bygges. Mener du veggen på den andre siden av trappa, eller ved foten av den (mot kjøkkenet er trappa åpen på tegningen)?

### F11 – Mangler dør venstre side i 1etg. og så skulle nok dette vært terrasse 
- **Tekst:** Mangler dør venstre side i 1etg. og så skulle nok dette vært terrasse dør med glassfelt over hele døre. Opp skulle de to vinduene vært todelt slik som fasadetegning viser
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F11.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F11.json`
- **Status:** døra rettet (fase D) – glassveggen har en dør i hver ende, nå finnes begge. Terrassedør med glass og todelte vinduer: eksteriør-runden.

### F12 – Stolpe på rekkverk er generert langt ned på vegg
- **Tekst:** Stolpe på rekkverk er generert langt ned på vegg
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F12.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F12.json`
- **Status:** forespørsel til motoren – stairs.js lar stolpene over trappehullet henge 0,45 m ned (en detalj fra eierens hus). Trenger et valg i husformatet.

### F13 – jeg bør kunne gå inn i huset uten og måtte hoppe
- **Tekst:** jeg bør kunne gå inn i huset uten og måtte hoppe
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F13.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F13.json`
- **Status:** rettet (fase D) – bakken ligger 15 cm under gulvet (var 31 cm; figuren går opp 30 cm).

### F14 – flimring på venstre side av dør, spesielt når jeg holde nede museknapp
- **Tekst:** flimring på venstre side av dør, spesielt når jeg holde nede museknapp og beveger kamera
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F14.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F14.json`
- **Status:** rettet (fase D, som F8).

### F15 – Vinduet er ikke fikset, det flimrer fortsatt og har den innvendige skr
- **Tekst:** Vinduet er ikke fikset, det flimrer fortsatt og har den innvendige skråen, det gjelder nok mange vinduer
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F15.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F15.json`
- **Status:** rettet (fase D2, sett i 3D) – vinduet sto helt inntil et hjørne: hullet fikk ingen rett side mot hjørnet (den skrå gjæringen synes) og to flater i samme plan. Nå 5 cm karm mot hjørnet.

### F16 – Flimring på venstre side av dør fortsatt
- **Tekst:** Flimring på venstre side av dør fortsatt
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F16.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F16.json`
- **Status:** rettet (fase D2) – samme årsak som F15 (dør inntil hjørnet), og 10 cm post mellom døra og sidefeltet.

### F17 – Kan fortsatt se ut ytterdør
- **Tekst:** Kan fortsatt se ut ytterdør
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F17.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F17.json`
- **Status:** rettet (fase D2, sett i 3D) – dørenheten var 2,4 cm smalere enn hullet, så dagslyset synes langs karmen. Nå fyller den hullet.

### F18 – er mangler det fortsatt dører
- **Tekst:** er mangler det fortsatt dører
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F18.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F18.json`
- **Status:** rettet (fase D2) – skyvedørene på tegningen ble tomme hull; nå bygges de som dører med blad til spillet får skyvedører.

### F19 – Kan fortsatt ikke gå igjennom denne døra
- **Tekst:** Kan fortsatt ikke gå igjennom denne døra
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F19.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F19.json`
- **Status:** rettet (fase D2) – døra var 0,69 m, figuren (radius 0,3) trenger mer; dører under 0,82 m gjøres bredere der veggen har plass.

### F20 – se innvendige feilem med vinduene
- **Tekst:** se innvendige feilem med vinduene
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F20.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F20.json`
- **Status:** rettet (fase D2, sett i 3D) – som F15.

### F21 – Stolpe på rekkverk går unaturlig langt ned på vegg. bør stoppe slik so
- **Tekst:** Stolpe på rekkverk går unaturlig langt ned på vegg. bør stoppe slik som de andre
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F21.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F21.json`
- **Status:** forespørsel til motoren (som F12) – stairs.js lar stolpene over trappehullet henge 0,45 m ned.

### F22 – Her skal det være vegg det du ser bakken(grønt)
- **Tekst:** Her skal det være vegg det du ser bakken(grønt)
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F22.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F22.json`
- **Status:** trolig rettet (fase D2) – en dør inntil et hjørne ga en sprekk ut mot bakken (som F15/F16). Meld igjen om den er der; «Meld feil» lagrer nå også hvor kameraet står.

### F23 – Her har genereringen bommet på vinduet til høyre, og vinduet i midten 
- **Tekst:** Her har genereringen bommet på vinduet til høyre, og vinduet i midten som egentlig er todelt vindu
- **Hvor:** 3D (dukkehus) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F23.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F23.json`
- **Status:** satt av til fasade-runden – vinduene får bredde og plass fra plantegningen og høyde fra fasadene, men ikke inndeling (todelt, sprosser) eller form (lite firkantet). Fasadene må leses per vindu og kobles til vinduet på planen (som F24–F26).

### F24 – Her er også vinduene feil, det til venstre skal være smalt todelt vind
- **Tekst:** Her er også vinduene feil, det til venstre skal være smalt todelt vindu og det til høyre skal være et lite firkantet
- **Hvor:** 3D (dukkehus) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F24.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F24.json`
- **Status:** satt av til fasade-runden (som F23).

### F25 – Feil med alle disse vinduer.
- **Tekst:** Feil med alle disse vinduer.
- **Hvor:** 3D (dukkehus) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F25.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F25.json`
- **Status:** satt av til fasade-runden (som F23).

### F26 – feil med vinduer, det skal være smalt vindu veldig oppdelt.
- **Tekst:** feil med vinduer, det skal være smalt vindu veldig oppdelt.
- **Hvor:** 3D (dukkehus) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F26.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F26.json`
- **Status:** satt av til fasade-runden (som F23) – «smalt og veldig oppdelt» trenger sprosser fra fasaden.

### F27 – Skyvedører skal det være her på disse to plassene
- **Tekst:** Skyvedører skal det være her på disse to plassene
- **Hvor:** 3D (går rundt) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F27.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F27.json`
- **Status:** venter på motoren – skyvedørene er funnet på tegningen, men spillet har ingen skyvedør ennå; de bygges som vanlige dører med blad (fase D2, forespørsel 7).

### F28 – Er faktisk usikker på hva dette åpne rommet er i virkeligheten. det er
- **Tekst:** Er faktisk usikker på hva dette åpne rommet er i virkeligheten. det er på vask/tek rommet
- **Hvor:** 3D (går rundt) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F28.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F28.json`
- **Status:** rettet (D3, sett i 3D) – åpningen uten dør (0,62 m mellom vask/tek og soverommet) hadde ikke gulv gjennom veggen, så gresset synes. Nå går gulvet gjennom. Hva rommet er i virkeligheten må du svare på selv; i editoren kan åpningen gjøres om til dør eller vegg.

### F29 – svart stripe på vegger, usikker på hvorfor
- **Tekst:** svart stripe på vegger, usikker på hvorfor
- **Hvor:** 3D (går rundt) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F29.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F29.json`
- **Status:** trolig rettet (D4, som F40) – fant ikke stedet uten kameraposisjon; mistanken er en skjøt mellom to veggstykker der enden av en yttervegg ligger i rommets vegg. Meld den igjen hvis den fortsatt er der (nå lagres posisjonen).

### F30 – her skulle det ihenhold til tegning vært skråtak, den funksjonen er ik
- **Tekst:** her skulle det ihenhold til tegning vært skråtak, den funksjonen er ikke laget enda tror jeg
- **Hvor:** 3D (går rundt) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F30.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F30.json`
- **Status:** venter på motoren – skrå himling (forespørsel 10); planbyggeren leser heller ikke takvinkelen inn i rommene ennå.

### F31 – Her skulle det vært skyvedør
- **Tekst:** Her skulle det vært skyvedør
- **Hvor:** 3D (går rundt) – 1etg.avif, fasade1.avif, fasade4.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F31.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F31.json`
- **Status:** venter på motoren (som F27).

### F32 – Når jeg drar filer inn i feltet så blir den gul outlina slik den skal 
- **Tekst:** Når jeg drar filer inn i feltet så blir den gul outlina slik den skal men det går bort når jeg fører musepekeren inn i firkanten, muligens noe med teksten og gjøre
- **Hvor:** startside
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F32.json`
- **Status:** rettet (D3) – rammen gikk bort når pekeren kom over teksten inni feltet (nettleseren melder «forlatt» når man går inn i en tekst); nå bare når pekeren forlater feltet.

### F33 – Det bør ikke være mulig og gå under bakken slik jeg har gjort her. Kam
- **Tekst:** Det bør ikke være mulig og gå under bakken slik jeg har gjort her. Kamera bør stoppe ved bakken
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F33.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F33.json`
- **Status:** rettet (D3, prøvd i 3D) – kameraet stopper 30 cm over bakken, og høyre knapp flytter langs bakken i stedet for opp og ned.

### F34 – Kan vi implementere slik at jeg også kan bruke WASD for og styre kamer
- **Tekst:** Kan vi implementere slik at jeg også kan bruke WASD for og styre kameraet i denne visningen. er litt vanselig og bruke kun mus
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F34.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F34.json`
- **Status:** rettet (D3, prøvd i 3D) – WASD og piltastene flytter dukkehuset fram, tilbake og til sidene (fortere jo lenger ute kameraet er).

### F35 – Vindueene skulle egentlig hatt veldig mangen sprosser/spiler, også dør
- **Tekst:** Vindueene skulle egentlig hatt veldig mangen sprosser/spiler, også dørene skulle hatt det. Dette er også balkongdør begge to tror jeg er det.
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F35.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F35.json`
- **Status:** satt av til fasade-runden (som F23) – sprosser i vinduer og dører, og balkongdører, må leses fra fasadene.

### F36 – vinduet i midten skulle vært smalt slik ikke trappevange syntes. Og så
- **Tekst:** vinduet i midten skulle vært smalt slik ikke trappevange syntes. Og så skulle vinduene hatt sprosser
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F36.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F36.json`
- **Status:** satt av til fasade-runden (som F23) – bredden på vinduet foran trappa og sprossene.

### F37 – Exteriør skulle egentlig ha bygget skråtak med takstein istedet for sl
- **Tekst:** Exteriør skulle egentlig ha bygget skråtak med takstein istedet for slik det er nå, se fasade3 tegning 3
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F37.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F37.json`
- **Status:** satt av til eksteriør-runden – taket fra fasadene (saltak med takstein); motoren mangler takform og skrå himling (forespørsel 10).

### F38 – Terrassedør bygges som to enkle dører istedet for en dobbeldør med gla
- **Tekst:** Terrassedør bygges som to enkle dører istedet for en dobbeldør med glassfelt med sprosser slik det egentlig skulle vært
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F38.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F38.json`
- **Status:** venter på motoren – spillet har ingen dobbeltdør ennå (forespørsel 7), så den bygges som to enkle dører; glassfelt og sprosser i dører finnes heller ikke ennå.

### F39 – Skulle vært dobbeldør uten midtstolpe. Er også naturlig at disse døren
- **Tekst:** Skulle vært dobbeldør uten midtstolpe. Er også naturlig at disse dørene er med vindusfelt så det må også være mulig på innerdører
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F39.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F39.json`
- **Status:** venter på motoren (som F38) – midtstolpen er de to karmene til de to enkle dørene; innerdører med glassfelt må også inn i dørbyggeren.

### F40 – Det er noe feil ved høyre side av denne døra
- **Tekst:** Det er noe feil ved høyre side av denne døra
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F40.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F40.json`
- **Status:** rettet (D4, sett i 3D på samme sted) – enden av ytterveggen til boden lå i samme plan som gangens vegg, og fase D-dybdejusteringen hadde flyttet malingen til begge like langt, så den mørke kanten vant. Nå får hver rolle sin egen kopi av materialet, og yttersiden ligger lengst bak.

### F41 – Trappa er ikke slik som på plantegning
- **Tekst:** Trappa er ikke slik som på plantegning
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F41.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F41.json`
- **Status:** kjent – hus1 har en kvartsvingt trapp; spillet har bare rette og U-trapper (forespørsel 9), så den bygges som U-trapp.

### F42 – rekkverkstolpe går helt ned i etasjen under istedet for å stoppe der d
- **Tekst:** rekkverkstolpe går helt ned i etasjen under istedet for å stoppe der de andre stopper
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F42.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F42.json`
- **Status:** venter på motoren (som F12 og F21) – stairs.js lar stolpene over trappehullet henge ned.

### F43 – Rom i 2.etg skal ha skråtak med takvindu og knevegg slik som på plante
- **Tekst:** Rom i 2.etg skal ha skråtak med takvindu og knevegg slik som på plantegning. Det gjelder de fleste rommene her.
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F43.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F43.json`
- **Status:** venter på motoren – skrå himling og knevegg (forespørsel 10); takvinduene vises som glass i taket, men følger ikke skråtaket før motoren kan det.

### F44 – Her er det en åpning i veggen
- **Tekst:** Her er det en åpning i veggen
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F44.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F44.json`
- **Status:** rettet (D5, sett i 3D på samme sted) – 0,6 m av soverommets yttervegg ble regnet som enden av gangveggen ved siden av og aldri bygd. Nå blir et stykke over 35 cm med friluft bak en yttervegg. Ytterveggstykker med nesten lik tykkelse slås også sammen, så det blir ingen skjøt i veggen.

### F45 – det ser ut på fasadetegning at vinduet til venstre skal være smalere o
- **Tekst:** det ser ut på fasadetegning at vinduet til venstre skal være smalere og helt ned til bakken. Og de to vinduene på høyre side skal være smalere i høyden
- **Hvor:** 3D (dukkehus) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F45.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F45.json`
- **Status:** satt av til fasade-runden (som F23) – bredde og høyde per vindu fra fasadene.

### F46 – her skulle også vinduer vært smalere iht fasadetegning. og det store v
- **Tekst:** her skulle også vinduer vært smalere iht fasadetegning. og det store vinduet til venstre skulle vært todelt
- **Hvor:** 3D (dukkehus) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F46.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F46.json`
- **Status:** satt av til fasade-runden (som F23).

### F47 – Ja det er mye som går igjen, men her er også vinduene feil, spesielt v
- **Tekst:** Ja det er mye som går igjen, men her er også vinduene feil, spesielt vindu 3 og 4 fra venstre. se fasadetegning
- **Hvor:** 3D (dukkehus) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F47.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F47.json`
- **Status:** satt av til fasade-runden (som F23).

### F48 – Vindu til hlyre skulle vørt todelt. den ene døra skulle vært terrassed
- **Tekst:** Vindu til hlyre skulle vørt todelt. den ene døra skulle vært terrassedør med glassfelt. den andre døre skulle også vært glassdør med integrert vindusfelt på siden av døra som også går helt ned til bakken. Vinduet til venstre skulle vært mindre
- **Hvor:** 3D (dukkehus) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F48.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F48.json`
- **Status:** satt av til fasade-runden (som F23) og motoren – inndeling og størrelse fra fasaden; terrassedør og glassdør med sidefelt helt ned trenger dører med glassfelt i dørbyggeren (som F38).

### F49 – i rom stue på 10,7 m2 er begge vanlige dører, mens de er tegnet som sk
- **Tekst:** i rom stue på 10,7 m2 er begge vanlige dører, mens de er tegnet som skyvedører
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F49.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F49.json`
- **Status:** venter på motoren (som F27) – skyvedørene er funnet, men bygges som vanlige dører til spillet har skyvedører.

### F50 – skulle vært skyvedør
- **Tekst:** skulle vært skyvedør
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F50.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F50.json`
- **Status:** venter på motoren (som F27).

### F51 – Her er det noe rart i overgangen mellom veggene tror jeg, se i midten 
- **Tekst:** Her er det noe rart i overgangen mellom veggene tror jeg, se i midten av bildet
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F51.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F51.json`
- **Status:** kjent (K13) – hårfin strek der to veggstykker møtes i samme plan.

### F52 – noe har skjedd i dette hjørnet. se strekene
- **Tekst:** noe har skjedd i dette hjørnet. se strekene
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F52.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F52.json`
- **Status:** kjent (K13) – som F51.

### F53 – det er åpning i vegg som egentlig skulle vært tett
- **Tekst:** det er åpning i vegg som egentlig skulle vært tett
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F53.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F53.json`
- **Status:** til gjenkjenningen (K3-familien) – hus2-øya med WC/D, bod og kjøkkenskap: veggen over skapsøylen mangler, og stykket blir en åpning. Ikke rettet.

### F54 – mangler del på yttervegg, jeg kan se rett ut
- **Tekst:** mangler del på yttervegg, jeg kan se rett ut
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F54.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F54.json`
- **Status:** trolig rettet (D5, som F44) – meldt før D5; med stråler fra samme kamera ses ikke lenger ut.

### F55 – her er det også to streker på veggen midt i bildet
- **Tekst:** her er det også to streker på veggen midt i bildet
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F55.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F55.json`
- **Status:** kjent (K13) – som F51, ved enden av hus2-øya.

### F56 – den spør hva dette rommet er og så er det bare trappa som kommer opp i
- **Tekst:** den spør hva dette rommet er og så er det bare trappa som kommer opp i stue/kjøkken. Det er ikke et eget rom
- **Hvor:** veiviser – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F56.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F56.json`
- **Status:** til gjenkjenningen (K14) – trappa som kommer opp i stue/kjøkken ble et eget «rom» (3,8 m², gjettet bad).

### F57 – Dette er jo en del av rommet stue/kjøkken. Men jeg er usikker på hva d
- **Tekst:** Dette er jo en del av rommet stue/kjøkken. Men jeg er usikker på hva de stipla linjene betyr. Det vet nok du. Kanskje en drager i taket?
- **Hvor:** veiviser – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F57.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F57.json`
- **Status:** til gjenkjenningen (K14) – strek-prikk-linja med søyler (⊠) er en drager i taket, ikke en vegg; stykket ble et eget «rom» (6,6 m², gjettet bad).

### F58 – se fasadetegnigne til dette huse mot det som er generert. Her trenger 
- **Tekst:** se fasadetegnigne til dette huse mot det som er generert. Her trenger vi virkelig smarte metoder for og generere skråvinduer og slikt
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F58.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F58.json`
- **Status:** satt av til fasade-runden (som F23) – skråvinduer og vindusformer fra fasadene.

### F59 – Det blinker og flimrer i midten på huset mellom etasjene
- **Tekst:** Det blinker og flimrer i midten på huset mellom etasjene
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F59.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F59.json`
- **Status:** rettet (D6) – kledningen fra 1. etasje og ytterflaten fra 2. etasje lå i samme plan fra 2,55 til 3,05 m (funnet med stråler). Nå ligger ytterflaten til etasjene over lenger bak, så 1. etasjes kledning vinner. Flimring er bevegelse, så den er ikke sett i stillbilder.

### F60 – Kan ikke gå inn i huset uten og måtte hoppe med space
- **Tekst:** Kan ikke gå inn i huset uten og måtte hoppe med space
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F60.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F60.json`
- **Status:** rettet (D6, prøvd ved å gå) – figuren (en kapsel med rund fot) klarer ikke den skarpe kanten på 15 cm fra bakken opp til terskelen. Nå ligger en usynlig rampe foran hver ytterdør i hovedetasjen, som trinnene i spillet. Figuren går inn gjennom terrassedøra og inngangsdøra i hus4 uten å hoppe.

### F61 – jeg ser at den stipla linje her i 1.etg nok er en synlig drager. Det k
- **Tekst:** jeg ser at den stipla linje her i 1.etg nok er en synlig drager. Det kan stemme siden veggene er slikt som de er
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F61.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F61.json`
- **Status:** notert – strek-prikk-linja i 1. etasje er en synlig drager; det støtter tanken i K14 (drager med søyler er ikke en romgrense).

### F62 – Dette er egentlig en dør, men er generert som vindu
- **Tekst:** Dette er egentlig en dør, men er generert som vindu
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F62.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F62.json`
- **Status:** til gjenkjenningen – døra er lest som vindu på tegningen. Ikke rettet.

### F63 – etasjeskillet er synlig i trapperom, det stikker lengre ut i rommet en
- **Tekst:** etasjeskillet er synlig i trapperom, det stikker lengre ut i rommet enn veggen
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F63.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F63.json`
- **Status:** rettet (D7) – trappehullet stoppet 3 cm før veggen, så gulvkanten stakk ut over trapperommet. Nå går hullets sider ut til veggen når den er innen 6 cm.

### F64 – det er noe rart med avslutningen av den drageren som går inn i veggen
- **Tekst:** det er noe rart med avslutningen av den drageren som går inn i veggen
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F64.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F64.json`
- **Status:** ikke sett på ennå – drageren er overkanten av en åpning over hele veggen mellom trapperommet og stua; enden mot veggen må sjekkes i 3D.

### F65 – de to hullene her er sikkert egentlig en skyvedør inn til W.I.C tror j
- **Tekst:** de to hullene her er sikkert egentlig en skyvedør inn til W.I.C tror jeg. Åpningen til venstre skulle nok vært lukket(at det er der skyvedøre er i veggen når den er åpen.
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F65.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F65.json`
- **Status:** venter på dørøkta og gjenkjenningen – en skyvedør som går inn i veggen (lommedør) er lest som to åpninger; den ene skal være vegg.

### F66 – syntes også generelt at husene virker litt små, men det er nok mest sa
- **Tekst:** syntes også generelt at husene virker litt små, men det er nok mest sannsynlig på grunn av at det ikke er møbler i rommene. Vi kan endre skaleringen senere dersom min antakelse skulle stemme
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F66.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F66.json`
- **Status:** notert som idé – målestokken er lest fra målene på tegningen (høy sikkerhet), så det er nok de tomme rommene; sjekkes igjen når møblene kommer.

### F67 – gulvet her burde vært likt overalt. og så mangler det rekkverk poå tra
- **Tekst:** gulvet her burde vært likt overalt. og så mangler det rekkverk poå trappa oppe
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F67.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F67.json`
- **Status:** delvis rettet (D7, sett i 3D) – rekkverket mangler ikke lenger: siden av trappehullet mot stua var en «vegg» med en åpning over hele lengden og fikk derfor ikke rekkverk. Gulvfargen kommer av K14 (trappestykket ble gjettet som bad).

### F68 – har meldt denne feilen før, men her ser du det bedre, med det feltet i
- **Tekst:** har meldt denne feilen før, men her ser du det bedre, med det feltet i midten mellom etasjene som flimrer og blinker
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade4.avif, fasade1.avif, fasade2.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F68.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F68.json`
- **Status:** rettet (D6, som F59) – meldt før rettingen.

### F69 – det er litt liten tekstskrift på der det står"vi fant ingen fasadetegn
- **Tekst:** det er litt liten tekstskrift på der det står"vi fant ingen fasadetegninger blablabla"
- **Hvor:** veiviser – plan-1etg-tilbygg.pdf
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F69.json`
- **Status:** rettet (D7) – forklaringen under spørsmålet i veiviseren er nå 14,5 px (var 12).

### F70 – dette rommet har en slik foldedør med mangen ledd som kan lukkes. her 
- **Tekst:** dette rommet har en slik foldedør med mangen ledd som kan lukkes. her har det blitt generert gigantisk dør
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F70.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F70.json`
- **Status:** venter på dørøkta – en foldedør (mange ledd) er sendt videre som ønsket dørtype; i dag blir den én stor dør.

### F71 – Disse to svarte har blitt generert som store dører istedet for vinduer
- **Tekst:** Disse to svarte har blitt generert som store dører istedet for vinduer
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F71.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F71.json`
- **Status:** til gjenkjenningen (som F62) – vinduer lest som dører på den skannede hus6-tegningen. Ikke rettet.

### F72 – Det som er inntegner på tegningen der det står 170 er antakelig en gla
- **Tekst:** Det som er inntegner på tegningen der det står 170 er antakelig en glasspeis med 3 glassfelt som stikker ut i rommet her.
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F72.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F72.json`
- **Status:** notert – en glasspeis med tre glassfelt finnes ikke i spillet; tegnet av den blir i dag tolket som noe annet. Til en senere runde (møbler/innredning).

### F73 – Det som er tegnet på tegning er nok skyvedør.
- **Tekst:** Det som er tegnet på tegning er nok skyvedør.
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F73.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F73.json`
- **Status:** venter på dørøkta (som F27) og gjenkjenningen – skyvedøra på tegningen.

### F74 – skulle vært skyvedør
- **Tekst:** skulle vært skyvedør
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F74.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F74.json`
- **Status:** venter på dørøkta (som F27).

### F75 – Her skulle det vært inntegnet en trapp selv om 2.etg tegningen ikke bl
- **Tekst:** Her skulle det vært inntegnet en trapp selv om 2.etg tegningen ikke ble lagt til i generatoren
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F75.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F75.json`
- **Status:** til gjenkjenningen – en trapp på den eneste planen bør bli en trapp opp til en etasje vi ikke har tegning av. I dag blir den ingenting.

### F76 – Her sorterte ikke tegningene seg i riktig rekkefølge, den bør iallfall
- **Tekst:** Her sorterte ikke tegningene seg i riktig rekkefølge, den bør iallfall gjenkjenne 1, 2 og 3 tallet.
- **Hvor:** stabel – plantegning-1.jpg, plantegning-2.jpg, plantegning-3.jpg
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F76.json`
- **Status:** rettet (D8) – kjelleren (gang, WC og fem boder, uten navn på arket) havnet oppå 1. etasje. Nå regnes en etasje der minst halvparten er boder, og der det ikke er stue, kjøkken eller soverom, som kjeller. Tallene i filnavnene brukes ikke: de betyr ikke alltid etasjer (plantegning-1 er alle tegningene på ett ark).

### F77 – Det er noe som blinker er midt i bildet
- **Tekst:** Det er noe som blinker er midt i bildet
- **Hvor:** 3D (går rundt) – plantegning-3.jpg, plantegning-2.jpg, plantegning-1.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F77.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F77.json`
- **Status:** trolig følge av F76 – kjelleren lå oppå 1. etasje. Meld igjen hvis det blinker etter ny generering.

### F78 – noe fra 2.etg vises i 1etg ser det ut som
- **Tekst:** noe fra 2.etg vises i 1etg ser det ut som
- **Hvor:** 3D (går rundt) – plantegning-3.jpg, plantegning-2.jpg, plantegning-1.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F78.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F78.json`
- **Status:** følge av F76 – det var kjelleren som lå over 1. etasje.

### F79 – noe feil med genereringen her
- **Tekst:** noe feil med genereringen her
- **Hvor:** 3D (går rundt) – plantegning-3.jpg, plantegning-2.jpg, plantegning-1.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F79.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F79.json`
- **Status:** trolig følge av F76 – meld igjen hvis det står etter ny generering.

### F80 – feil med genereringen
- **Tekst:** feil med genereringen
- **Hvor:** 3D (går rundt) – plantegning-3.jpg, plantegning-2.jpg, plantegning-1.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F80.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F80.json`
- **Status:** trolig følge av F76 – meld igjen hvis det står etter ny generering.

### F81 – noe merkelig på veggen
- **Tekst:** noe merkelig på veggen
- **Hvor:** 3D (går rundt) – plantegning-3.jpg, plantegning-2.jpg, plantegning-1.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F81.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F81.json`
- **Status:** trolig følge av F76 – meld igjen hvis det står etter ny generering.

### F82 – noe har skjedd med trappa, den skulle sikkert ikke vært vinkeltrapp, m
- **Tekst:** noe har skjedd med trappa, den skulle sikkert ikke vært vinkeltrapp, men en bratt rett trapp/stige
- **Hvor:** 3D (går rundt) – plantegning-3.jpg, plantegning-2.jpg, plantegning-1.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F82.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F82.json`
- **Status:** kjent (K8) – ifølge fasiten er det en kvartsvingt trapp i hjørnet av kjellergangen. Med kjelleren øverst ble den en U-trapp ned fra «2. etasje». Etter F76 skal den gå fra kjelleren og opp, men spillet har ikke kvartsvingte trapper, og en rett trapp eller U-trapp får ikke plass i sjakten.

### F83 – hvorfor har den ikke lest ordet kjøkken på denne delen
- **Tekst:** hvorfor har den ikke lest ordet kjøkken på denne delen
- **Hvor:** veiviser – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F83.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F83.json`
- **Status:** til gjenkjenningen – navnet KJØKKEN står i en annen del av det sammenslåtte rommet (som K1).

### F84 – Her er det åpning i veggen det burde vært vegg
- **Tekst:** Her er det åpning i veggen det burde vært vegg
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F84.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F84.json`
- **Status:** til gjenkjenningen – åpning der det skal være vegg.

### F85 – skulle nok vært skyvedør her tipper jeg
- **Tekst:** skulle nok vært skyvedør her tipper jeg
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F85.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F85.json`
- **Status:** til gjenkjenningen – skyvedørsymbolet er ikke funnet.

### F86 – vanlig dør har ikke blitt generert
- **Tekst:** vanlig dør har ikke blitt generert
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F86.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F86.json`
- **Status:** til gjenkjenningen – døra er ikke funnet.

### F87 – stripe midt på veggen
- **Tekst:** stripe midt på veggen
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F87.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F87.json`
- **Status:** kjent (K13) – hårfin strek der to veggstykker møtes.

### F88 – merkelig vinkler på vegg og så ser du opp og ut av huset
- **Tekst:** merkelig vinkler på vegg og så ser du opp og ut av huset
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F88.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F88.json`
- **Status:** ikke sett på ennå – skrå vegger og innsyn til himmelen; trolig en vegg fra et møbel eller et symbol.

### F89 – ser ut som to søyler eller noe som ikke er på tegningen
- **Tekst:** ser ut som to søyler eller noe som ikke er på tegningen
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F89.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F89.json`
- **Status:** til gjenkjenningen – kjent fra hus9: strekene i trappesymbolet blir tynne vegger.

### F90 – står i trappa. her er det hull i etasjeskillet
- **Tekst:** står i trappa. her er det hull i etasjeskillet
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F90.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F90.json`
- **Status:** ikke sett på ennå – hull i etasjeskillet ved trappa.

### F91 – her har det ikke blitt generert dør
- **Tekst:** her har det ikke blitt generert dør
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F91.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F91.json`
- **Status:** til gjenkjenningen – døra er ikke funnet.

### F92 – hva har skjedd på vokesnsov. Muligens på grunn av møblene som er tegne
- **Tekst:** hva har skjedd på vokesnsov. Muligens på grunn av møblene som er tegnet inn at det blir tull?
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F92.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F92.json`
- **Status:** til gjenkjenningen – møbler tegnet på planen blir vegger.

### F93 – mangler dør
- **Tekst:** mangler dør
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F93.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F93.json`
- **Status:** til gjenkjenningen – døra er ikke funnet.

### F94 – hva har skjedd her. muligens på grunn av tvbenken med tv som er tegnet
- **Tekst:** hva har skjedd her. muligens på grunn av tvbenken med tv som er tegnet inn på planskisse
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F94.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F94.json`
- **Status:** til gjenkjenningen – TV-benken på planen blir vegger (som F92).

### F95 – denne veggen skal ikke være der. altså den som stikker litt ut i romme
- **Tekst:** denne veggen skal ikke være der. altså den som stikker litt ut i rommet
- **Hvor:** 3D (går rundt) – ovre-etasje.jpg, underetasje.jpg
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F95.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F95.json`
- **Status:** til gjenkjenningen – en vegg som ikke finnes; trolig et møbel (som F92).

### F96 – feil med genering i hjørnet
- **Tekst:** feil med genering i hjørnet
- **Hvor:** 3D (går rundt) – garasje-plan-snitt-fasade.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F96.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F96.json`
- **Status:** rettet (K15, 23.10) – en merkestrek fra målsettingen var lest som en kort vegg; den fjernes nå. Generer huset på nytt.

### F97 – feil med generering, en stolpe eller noe som stikke ut av vegg
- **Tekst:** feil med generering, en stolpe eller noe som stikke ut av vegg
- **Hvor:** 3D (går rundt) – garasje-plan-snitt-fasade.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F97.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F97.json`
- **Status:** rettet (K15, 23.10) – «stolpen» var hjelpelinja fra målsettingen, lest som en vegg på 0,7 m; den fjernes nå. Generer huset på nytt.

### F98 – skyvedører skal være en del av veggen slik døre gå inn i veggen. når s
- **Tekst:** skyvedører skal være en del av veggen slik døre gå inn i veggen. når skyvedøre er lukke skal bare en liten del av døra syntes.
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade4.avif, fasade3.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F98.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F98.json`
- **Status:** rettet (D9) – en innvendig skyvedør går nå inn i veggen (lommedør) der veggen har plass til bladet ved siden av hullet, først på siden den glir mot. Ellers står den på skinne som før.

### F99 – dør skulle vært med vindusfelt og sprosser
- **Tekst:** dør skulle vært med vindusfelt og sprosser
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade4.avif, fasade3.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F99.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F99.json`
- **Status:** rettet (D9) – ytterdører fra stue, kjøkken og soverom (terrasse- og balkongdører) får glassfelt med sprosser (2 × 3 ruter fra 1,2 m, ellers 1 × 3). Inngangsdøra og boddører er tette. Riktig inndeling fra fasaden kommer i fasade-runden.

### F100 – dør skulle vært med vindusfelt og sprosser
- **Tekst:** dør skulle vært med vindusfelt og sprosser
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade4.avif, fasade3.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F100.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F100.json`
- **Status:** rettet (D9, som F99).

### F101 – inegn vindu ble generert med sprosser. er samme vinduer som før
- **Tekst:** inegn vindu ble generert med sprosser. er samme vinduer som før
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade4.avif, fasade3.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F101.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F101.json`
- **Status:** meldt rett før vinduene fikk inndeling (D9: todelt fra 0,8 m, tredelt fra 1,4 m, fast felt nederst i høye vinduer ned til gulvet). Sprosser per vindu kommer i fasade-runden.

### F102 – kan kun åpne dør når jeg hover over karmen, men må være nok og holde m
- **Tekst:** kan kun åpne dør når jeg hover over karmen, men må være nok og holde musepekern over glasset også på den delen som kan åpnes
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F102.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F102.json`
- **Status:** sendt til dørøkta – glasset i døra er ikke med i det som kan pekes på for å åpne den.

### F103 – Denne døra er egentlig en foldedør med flere ledd
- **Tekst:** Denne døra er egentlig en foldedør med flere ledd
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F103.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F103.json`
- **Status:** til gjenkjenningen (som F70) – foldedøra finnes i spillet nå, men symbolet på tegningen blir ikke kjent igjen ennå.

### F104 – skyvedør skal være inne i veggen
- **Tekst:** skyvedør skal være inne i veggen
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F104.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F104.json`
- **Status:** rettet (D9, som F98).

### F105 – er et blinkene felt her i midten
- **Tekst:** er et blinkene felt her i midten
- **Hvor:** 3D (går rundt) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F105.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F105.json`
- **Status:** rettet (D9) – enden av et veggstykke lå i samme plan som veggflaten ved siden av (funnet med stråler fra kameraet), og begge hadde samme dybde. Nå ligger endene og smygene litt bak veggflatene.

### F106 – skjødør er generert feil, det er egentlig sikkert bare en vanlig 90cm 
- **Tekst:** skjødør er generert feil, det er egentlig sikkert bare en vanlig 90cm dør som skal gå inn i veggen, så den må leses bedre
- **Hvor:** 3D (går rundt) – 1etg.avif, fasade1.avif, fasade2.avif, fasade3.avif, fasade4.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F106.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F106.json`
- **Status:** delvis (D9) – den blir nå en lommedør, men gjenkjenningen tok med lomma i hullet, så hullet er for bredt. Til gjenkjenningen (som F65).

### F107 – det er jo egentlig skåtak i virkeligheten og vinduene og dørene har en
- **Tekst:** det er jo egentlig skåtak i virkeligheten og vinduene og dørene har enda et  vindusfelt over
- **Hvor:** 3D (går rundt) – 1etg.avif, fasade1.avif, fasade2.avif, fasade3.avif, fasade4.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F107.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F107.json`
- **Status:** til fasade-runden og tak-økta – overlys over vinduer og dører leses fra fasadene; skråtaket bygges av tak-økta.

### F108 – flere dører skulle vært store glassfelt dører, men er istedet for vanl
- **Tekst:** flere dører skulle vært store glassfelt dører, men er istedet for vanlige dører
- **Hvor:** 3D (går rundt) – 1etg.avif, fasade1.avif, fasade2.avif, fasade3.avif, fasade4.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F108.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F108.json`
- **Status:** rettet (D9, som F99) – brede glassdører fra fasaden kommer i fasade-runden.

### F109 – her er trappa på tegningen tegnet inn på utsiden av bygget. kanskje je
- **Tekst:** her er trappa på tegningen tegnet inn på utsiden av bygget. kanskje jeg skulle hatt mulighet for å trykke i plantegning hvor trappa faktisk er. Men usikker for her er jo faktisk plantegningen feil
- **Hvor:** veiviser – plantegning.png, plantegning_kjeller.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F109.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F109.json`
- **Status:** rettet – «Trapp» i 3D-visningen (og av seg selv etter genereringen når etasjene mangler trapp) viser planen med etasjen under svakt under: dra trappa på plass fra toppen og nedover, flytt den, dra i hjørnene, velg rett eller halvsvingt, snu den, og se trinnene og stigningen.

### F110 – det er jo flere forskjellige vinduer så er vanskelig og sette standar 
- **Tekst:** det er jo flere forskjellige vinduer så er vanskelig og sette standar på alle
- **Hvor:** veiviser – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F110.json`
- **Status:** rettet – fasadesjekken: huset sett utenfra side for side, der hvert vindu og hver dør kan få egne mål og type.

### F111 – vet ikke hvordan det er best og gjøre det, men i virkeligheten så er j
- **Tekst:** vet ikke hvordan det er best og gjøre det, men i virkeligheten så er jo hele fronten på kjeller synlig, det er jo vinduer der. og bare bakveggen har jord helt opp til 1.etg. Kanskje vi bør begynne og også ha kjellere synlige slik vinduene kan sees
- **Hvor:** 3D (dukkehus) – plantegning.png, plantegning_kjeller.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F111.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F111.json`
- **Status:** god idé, neste – en kjeller med vinduer eller dør i en yttervegg skal stå fritt på den siden: bakken skrår ned dit, og bare veggene uten vinduer står i jord.

### F112 – her har alle vinduer blitt feil. de skulle egentlig vært store vindusf
- **Tekst:** her har alle vinduer blitt feil. de skulle egentlig vært store vindusfelt
- **Hvor:** 3D (går rundt) – plantegning.png, plantegning_kjeller.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F112.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F112.json`
- **Status:** rettet med F110 – sett store vindusfelt i fasadesjekken (bredde, høyde, type og sprosser).

### F113 – kommer ikke ned i trappa
- **Tekst:** kommer ikke ned i trappa
- **Hvor:** 3D (går rundt) – plantegning.png, plantegning_kjeller.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F113.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F113.json`
- **Status:** rettet med F109 – plasser trappa selv, så bygges den med hull i gulvet over.

### F114 – når jeg blar ned og tyrkker poå en vindu skroller den helt opp samme n
- **Tekst:** når jeg blar ned og tyrkker poå en vindu skroller den helt opp samme når jeg sklikker for å skrive inn tall så scroller den helt opp. Og så er jeg ikke helt fornøyd med visningen. vi bør ha alle fasadene i midten. og at en popup kommer frem når jeg trykker på et vindu eller dør
- **Hvor:** fasadesjekk – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F114.json`
- **Status:** rettet – tegningen står midt på, visningen hopper ikke til toppen, og et klikk på et vindu eller en dør åpner kortet ved siden av det.

### F115 – må være mulig og sette feks at alle vinduer har samme hlyde fra tak on
- **Tekst:** må være mulig og sette feks at alle vinduer har samme hlyde fra tak on ned til vindu. for eksempel med vinduet jeg holde på å redigere. det er et smart vindu på 40cm, men jeg må regne ut hvor mye brysningshøyde er for og få plassert det høyere. Det burde skjedd automatisk siden normalt er vinduene med samme avstand fra tak til vindu
- **Hvor:** fasadesjekk – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F115.json`
- **Status:** rettet – «Hold overkanten fast» (på som standard): ny høyde flytter brystningen, så overkanten blir stående. Knappen «Samme overkant på de andre vinduene i etasjen» retter inn resten.

### F116 – får ikke trykket på vinduene i kjeller.
- **Tekst:** får ikke trykket på vinduene i kjeller.
- **Hvor:** fasadesjekk – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F116.json`
- **Status:** rettet – bakken med skravur lå over kjellervinduene og tok klikkene; nå ligger den under vinduene og dørene.

### F117 – Her har jeg endret bredde på disse to vinduene ved siden av døre- da v
- **Tekst:** Her har jeg endret bredde på disse to vinduene ved siden av døre- da vil jeg ha mulighet og dra dem nærmere døre
- **Hvor:** fasadesjekk – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F117.json`
- **Status:** rettet – dra vinduet eller døra på tegningen for å flytte den langs veggen (stopper 10 cm fra naboen og ved veggens ende).

### F118 – vi må fikse terreng ute når det er kjeller slik det genereres etter hv
- **Tekst:** vi må fikse terreng ute når det er kjeller slik det genereres etter hvor det er vinduer. Når jeg går ut kjellerdøra nå detter jeg bare ned i ingenting
- **Hvor:** 3D (går rundt) – plantegning.png, plantegning_kjeller.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F118.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F118.json`
- **Status:** rettet (prøvd ved å gå) – kjelleren står fritt på siden med kjellerdøra (uten dør: der vinduene er lave): en senket uteplass i kjellerhøyde, skråning opp til bakken og støttemurer på sidene. Figuren går ut kjellerdøra og opp i hagen.

### F119 – Når jeg veler vindu i 1etg og så er jeg ferdig og trykker på vinduet p
- **Tekst:** Når jeg veler vindu i 1etg og så er jeg ferdig og trykker på vinduet på fasaden i kjeller for og velge det. det går ikke an må trykke på vinduet i høyre meny først. slik kan vi ikke ha det
- **Hvor:** fasadesjekk – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F119.json`
- **Status:** rettet – kortet står ved siden av tegningen når det er plass, så det dekker ikke vinduene under; ellers ved vinduet.

### F120 – Når jeg velger to vindu og trykker på fast glass feks så bør begge end
- **Tekst:** Når jeg velger to vindu og trykker på fast glass feks så bør begge endres og samme når jeg justerer målene så bør begges endres. det skjer ikke
- **Hvor:** fasadesjekk – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F120.json`
- **Status:** rettet – når vinduet du klikker er avkrysset sammen med andre, endrer kortet alle de valgte (mål, type, sprosser).

### F121 – bra med popup, men her burde det vært en neste knapp på selve popupen 
- **Tekst:** bra med popup, men her burde det vært en neste knapp på selve popupen og at den da velger vindu først øverste etasje fra venstre til høyre så etasjen under osv
- **Hvor:** fasadesjekk – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F121.json`
- **Status:** rettet – «‹ Forrige» og «Neste ›» i kortet, øverste etasje først fra venstre mot høyre, og «Neste fasade ›» etter det siste.

### F122 – får fotsatt ikke dratt disse vinduene sammen med døra. det er jo egent
- **Tekst:** får fotsatt ikke dratt disse vinduene sammen med døra. det er jo egentlig dør og vindusfelt i samme karm så jeg burde kunne dra dem nærme og kombinere vinduene med døra
- **Hvor:** fasadesjekk – plantegning.png, plantegning_kjeller.png
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F122.json`
- **Status:** rettet – et vindu inntil en dør i en yttervegg får knappen «Slå sammen med døra (sidefelt i samme karm)»; døra får et glassfelt helt ned på den siden.

### F123 – det var dette jeg meldte feil om i editoren at disse vinduene egentlig
- **Tekst:** det var dette jeg meldte feil om i editoren at disse vinduene egentlig skal henge sammen med døra
- **Hvor:** 3D (går rundt) – plantegning.png, plantegning_kjeller.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F123.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F123.json`
- **Status:** rettet med F122.

### F124 – taket vises ikke her
- **Tekst:** taket vises ikke her
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade2.avif, fasade4.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F124.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F124.json`
- **Status:** som forventet – dukkehuset viser rommene uten tak; «Vis taket» viser huset med tak.

### F125 – trappa ble generert feil vei
- **Tekst:** trappa ble generert feil vei
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade2.avif, fasade4.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F125.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F125.json`
- **Status:** rettet – en kvartsvingt trapp fra tegningen ble snudd feil; den blir U som før, og «Kvartsvingt» velges i «Trapp» der retningen ses.

### F126 – ble ikke generert innvednig skråtak
- **Tekst:** ble ikke generert innvednig skråtak
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade2.avif, fasade4.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F126.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F126.json`
- **Status:** rettet – loftet får skrå himling med knevegg 1,2 m, og arker over vinduene og dørene i langveggene.

### F127 – ble ikke generert knevegger slik som er tegnet inn
- **Tekst:** ble ikke generert knevegger slik som er tegnet inn
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade2.avif, fasade4.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F127.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F127.json`
- **Status:** rettet med F126.

### F128 – fasaden her stemmer ikke med fasade1.avif
- **Tekst:** fasaden her stemmer ikke med fasade1.avif
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade2.avif, fasade4.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F128.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F128.json`
- **Status:** trolig rettet med F126 (2. etasje fikk full takhøyde); meld igjen om fasaden fortsatt avviker.

### F129 – fasade stemmer ikke. det er på grunn av den har tatt full takhøyde i 2
- **Tekst:** fasade stemmer ikke. det er på grunn av den har tatt full takhøyde i 2.etg noe som ikke stemmer. der skal det være skråtak med knevegger
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade2.avif, fasade4.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F129.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F129.json`
- **Status:** rettet med F126.

### F130 – spør fortsatt hva dette rommet heter som bare er trappa som går til st
- **Tekst:** spør fortsatt hva dette rommet heter som bare er trappa som går til stue kjøkken
- **Hvor:** veiviser – 2etg.avif, 1etg.avif, fasade3.avif, fasade4.avif, fasade2.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F130.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F130.json`
- **Status:** kjent (K14) – trappestykket som eget rom; til neste runde med gjenkjenning.

### F131 – dette henger sammen med stue og kjøkkenså bør ikke spør om dette
- **Tekst:** dette henger sammen med stue og kjøkkenså bør ikke spør om dette
- **Hvor:** veiviser – 2etg.avif, 1etg.avif, fasade3.avif, fasade4.avif, fasade2.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F131.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F131.json`
- **Status:** kjent (K14).

### F132 – må få laget til flere typer kledning. for eksempel dette huset har lit
- **Tekst:** må få laget til flere typer kledning. for eksempel dette huset har litt forskjellig.
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade3.avif, fasade4.avif, fasade2.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F132.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F132.json`
- **Status:** forslag til egen økt – flere kledningstyper og fasadeplater i motoren.

### F133 – må få lagt inn genmerering av terrasser og rekkverk både i tre og glas
- **Tekst:** må få lagt inn genmerering av terrasser og rekkverk både i tre og glass
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade3.avif, fasade4.avif, fasade2.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F133.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F133.json`
- **Status:** forslag til egen økt – terrasser og rekkverk i tre og glass.

### F134 – denne delen er sikkert en form for fasadeplater
- **Tekst:** denne delen er sikkert en form for fasadeplater
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade3.avif, fasade4.avif, fasade2.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F134.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F134.json`
- **Status:** forslag til egen økt (som F132).

### F135 – ser taket på dette huset er veldig feil. Modellen sliter nok med og sk
- **Tekst:** ser taket på dette huset er veldig feil. Modellen sliter nok med og skjønne den type fasadetegning
- **Hvor:** 3D (dukkehus) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F135.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F135.json`
- **Status:** til fasade-runden – takformen leses feil fra hus2s fasadeark.

### F136 – ja dette taker er faktisk helt feil.
- **Tekst:** ja dette taker er faktisk helt feil.
- **Hvor:** 3D (dukkehus) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F136.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F136.json`
- **Status:** kjent (K16) – hus2 har en form med flere fløyer og innhakk; takdelene dekket ikke alle veggene, så det ble ett tak over hele rektangelet.

### F137 – dette taket klarte den bedre, men på fasadetegnignene ser det ut ikke 
- **Tekst:** dette taket klarte den bedre, men på fasadetegnignene ser det ut ikke ut som det er så store utstikk. Det ser nesten ikke ut som det er utstikk i det hele tatt
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F137.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F137.json`
- **Status:** rettet – utstikket er 25 cm ved takfoten og 10 cm ved gavlene (var 50 og 30).

### F138 – skyvedør som ikke er inne i vegg
- **Tekst:** skyvedør som ikke er inne i vegg
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F138.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F138.json`
- **Status:** delvis (venter på test) – en skyvedør på skinne med for lite vegg ved siden av går nå mot siden med plass, blir teleskopdør (2–3 blad) eller går forbi seg selv i et bredt hull; i hus2s WIC får ingen av dem plass (validatoren varsler), så den står fortsatt på skinne

### F139 – overgang mellom skråtak og flatt tak har feilet, men i dette huset er 
- **Tekst:** overgang mellom skråtak og flatt tak har feilet, men i dette huset er det egentlig skråtak helt ut til veggen til soverom 11,7m2 og WIC 4,6m2
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F139.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F139.json`
- **Status:** fikset – mønelinja er en tynn grå strek på hus2; den følges nå fra gangens vestvegg (houseread.js thinRows/thinRidge), så gang og entré blir skrå helt ut til veggene mot soverom 11,7 og WIC 4,6

### F140 – dette innhukket har feilet. den mangler del av vegg imelleom der du se
- **Tekst:** dette innhukket har feilet. den mangler del av vegg imelleom der du ser grønt nede
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F140.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F140.json`
- **Status:** fikset – en veggstubb inn i stua ble paret med en vegg på tvers av rommet, så begge sider fikk tykkelse 0 og det ble et hull ned til bakken; en side pares nå bare med kanten rett bak seg (export.js partnerOf; test i seksjon 12)

### F141 – vinduene og ytterdører stemmer generelt ikke med faseden. mener type v
- **Tekst:** vinduene og ytterdører stemmer generelt ikke med faseden. mener type vindu som er valgt.
- **Hvor:** 3D (går rundt) – 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F141.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F141.json`
- **Status:** delvis (venter på test) – ytterdørene får typen fra fasaden: tett blad (mørkt eller hvitt dørblad) eller glass med ruter, brystning og overlys, og et vindu ned til gulvet inntil døra blir sidefelt i karmen; vinduene på hus2 (fasadene for små) gjenstår

### F142 – hvorfor spør genereringen om dette egentlig? trappa er jo ikke tegnet 
- **Tekst:** hvorfor spør genereringen om dette egentlig? trappa er jo ikke tegnet noe utydelig
- **Hvor:** veiviser – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F142.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F142.json`
- **Status:** fikset – KI-ens «spiraltrapp» mot en tegning som svinger, gir ikke lenger spørsmål (husformatet har ingen spiraltrapp, svingen bygges uansett)

### F143 – dette må modellen vite av seg selv. dette er jo trappa og ikke et eget
- **Tekst:** dette må modellen vite av seg selv. dette er jo trappa og ikke et eget rom
- **Hvor:** veiviser – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F143.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F143.json`
- **Status:** fikset – et rom uten navn der trappa dekker minst 40 % av gulvet heter «Trapp» (gang), uten spørsmål (generate.js, etter at trappene er på plass)

### F144 – generert. vindu og dørtyper som blir valgt er feil
- **Tekst:** generert. vindu og dørtyper som blir valgt er feil
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F144.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F144.json`
- **Status:** fikset (venter på test) – vinduene får felt og sprosser, og dørene på hus4 typen fra fasadene: inngangsdøra tett, balkongdørene oppe glass med overlys, terrassedøra glass

### F145 – Fasaden på dette huset ser jeg at noe er veldig vanskelig og genereree
- **Tekst:** Fasaden på dette huset ser jeg at noe er veldig vanskelig og genereree. På fasadetegning 3 så set du at det er kledning i toppen på taket som går ned på høyre side og så fortsettte den rett under rekkverk på glassrekkverk bort til boden. Og boden skulle også hatt stående kledning
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F145.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F145.json`
- **Status:** ny

### F146 – her er det det samme som forrige feil der vi har den markerte kledning
- **Tekst:** her er det det samme som forrige feil der vi har den markerte kledningsen som går ifra taket og ned på høyre side og fortsetter på etasjeskillet bort til terrasse og ned
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F146.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F146.json`
- **Status:** ny

### F147 – under hele terrassen her skal det være kledning
- **Tekst:** under hele terrassen her skal det være kledning
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F147.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F147.json`
- **Status:** fikset – carporten under terrassen er et rom nå (en carport/garasje med vegger på tre sider lukkes med en vegg som er én åpning), så ytterveggene under hele terrassen får kledning

### F148 – det er to loddrette streker på fasaden på høyre del her.
- **Tekst:** det er to loddrette streker på fasaden på høyre del her.
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F148.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F148.json`
- **Status:** ny

### F149 – fronten på boden skulle vært med grå fasadeplater. og døre skulle også
- **Tekst:** fronten på boden skulle vært med grå fasadeplater. og døre skulle også vært grå i samme farge.
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F149.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F149.json`
- **Status:** fikset (venter på test) – carportens vegg mot boden får feltet fasaden inn i carporten viser (grå plater), og døra samme grå farge på blad, karm og foring (export.js frontZones); carporten er et uterom med betonggulv

### F150 – det er naturlig at det er en støpt betongplatting under terrassen her 
- **Tekst:** det er naturlig at det er en støpt betongplatting under terrassen her og bort til stoltene. Disse stoltene skulle helller ikke vært her visst du ser fasadetegning 1
- **Hvor:** 3D (dukkehus) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F150.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F150.json`
- **Status:** fikset – carporten har betonggulv, og terrassen over den står på huset uten stolper (et dekk oppe over rom i etasjen under eller høyst 1,6 m fra en vegg)

### F151 – hva skjer med gulvet her. hvorfor har det blitt delt
- **Tekst:** hva skjer med gulvet her. hvorfor har det blitt delt
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F151.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F151.json`
- **Status:** fikset – rom med åpen grense mellom seg (ingen vegg, her draglinja) får samme gulv: stuas, soverommets eller gangens før entréens og bodens; våtrom beholder sitt

### F152 – det er hull i etasjeskillet
- **Tekst:** det er hull i etasjeskillet
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F152.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F152.json`
- **Status:** fikset – trappehullet holdes 6 cm fra flaten på en yttervegg oppe, så veggens underkant ikke synes gjennom etasjeskillet (export.js exportStairs; test i seksjon 12)

### F153 – hva har skjedd her. 1. det er gjerde på tvers slik at jeg ikke kan gå 
- **Tekst:** hva har skjedd her. 1. det er gjerde på tvers slik at jeg ikke kan gå bortover terrassen. 2 det er forskjellig terrasse underlag. tre forskjellige typer.
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F153.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F153.json`
- **Status:** fikset – dekk på samme etasje som henger sammen, blir ett dekk med én flate og uten rekkverk på tvers, og bodtaket under terrassen er borte (det sto opp gjennom den)

### F154 – skyvedør generering har feilet her
- **Tekst:** skyvedør generering har feilet her
- **Hvor:** 3D (går rundt) – 2etg.avif, 1etg.avif, fasade2.avif, fasade1.avif, fasade4.avif, fasade3.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F154.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F154.json`
- **Status:** åpen – skyvedøra mellom W.I.C og badet er tegnet som to tynne linjer i veggen og leses som en åpning; trenger en klassisk regel for skyvedør i veggliv i detect.js

### F155 – her har taket blitt med helt feil takvinkel. det gjelder overalt. Noe 
- **Tekst:** her har taket blitt med helt feil takvinkel. det gjelder overalt. Noe skjer nok galt i genereringen
- **Hvor:** 3D (dukkehus) – 1etg.avif, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F155.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F155.json`
- **Status:** fikset – KI-ens fløy brukes for en takdel bare når minst 60 % av fløyens rom ligger i den delen (hus5 fikk saltak med 35° over alle tre delene); vinkelen fra fasadene

### F156 – Du må studere dette fordi jeg tror det har skjedd noe helt feil med ta
- **Tekst:** Du må studere dette fordi jeg tror det har skjedd noe helt feil med tak og takkonstruksjonen som gjør at jeg nesten ikke klarer og skjønne fasadetenignene mot genereringen
- **Hvor:** 3D (dukkehus) – 1etg.avif, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F156.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F156.json`
- **Status:** fikset – samme som F155: takdelene får typen og vinkelen fra fasadene og fløyene som hører til dem

### F157 – her er genereingen feil. 1 utstikk på taket er feil vei.tak er bygget 
- **Tekst:** her er genereingen feil. 1 utstikk på taket er feil vei.tak er bygget forbi i fronten på utstikk. Det er vinkel i mænet både på høyre og venstre side
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F157.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F157.json`
- **Status:** fikset (venter på test) – halvvalm fra fasadene (langsidenes skårne hjørner), valmens høyde fra tegningen, og pulttaksarken i veggliv med takfoten kuttet foran balkongen

### F158 – Mønet her har en vinkel ned. sammenlikn med fasadetegning
- **Tekst:** Mønet her har en vinkel ned. sammenlikn med fasadetegning
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F158.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F158.json`
- **Status:** fikset (venter på test) – taket er halvvalm 44° med rett møne, som fasadene viser

### F159 – Huset er mye høyere enn fasadetegningen. Visst du sammenlikner dem så 
- **Tekst:** Huset er mye høyere enn fasadetegningen. Visst du sammenlikner dem så ser du det. Tror 2.etg er blitt bygget som en full eteajse, men har ikke vært inne i huset enda
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F159.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F159.json`
- **Status:** fikset – takfoten fra fasadene (5 cm over loftsgulvet på hus1) i stedet for knevegger på 1,2 m i ytterveggene; huset er like høyt som fasadetegningen

### F160 – når jeg går i trappa så kan jeg se ut rett igjennom etasjeskillet
- **Tekst:** når jeg går i trappa så kan jeg se ut rett igjennom etasjeskillet
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F160.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F160.json`
- **Status:** fikset – hullet for en kvartsvingt trapp er L-formet (trappa og reposet), og rekkverket følger det (export.js exportStairs)

### F161 – det har blitt generert knevegger, men etter tegning så skulle den knev
- **Tekst:** det har blitt generert knevegger, men etter tegning så skulle den kneveggen vært helt ute ved takvinduet nesten
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F161.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F161.json`
- **Status:** fikset – kneveggen er den tynne linja planen tegner parallelt med ytterveggen 0,5–2,2 m inne, der taket over linja står 0,4–1,8 m over gulvet; stripen bak heter «Kneveggsbod» (generate.js addKneeWalls; test i seksjon 12)

### F162 – samme gjelder med kneveggen her og de andre plassene
- **Tekst:** samme gjelder med kneveggen her og de andre plassene
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F162.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F162.json`
- **Status:** fikset – samme regel som F161, på alle ytterveggene på loftet

### F163 – det ser ikke ut som dørene og veggene treffer 100% på de orginale tegn
- **Tekst:** det ser ikke ut som dørene og veggene treffer 100% på de orginale tegningene.
- **Hvor:** fasadesjekk – 2etg.avif, 1etg.avif, fasade4.avif, fasade3.avif, fasade2.avif, fasade1.avif
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F163.json`
- **Status:** ny

### F164 – Samme her ser du at vinduene er høyere og har det skråfeltet. Mulig at
- **Tekst:** Samme her ser du at vinduene er høyere og har det skråfeltet. Mulig at noe har skjedd feil når jeg skrev takhøyden. Kanskje det er høyere takhøyde her enn 2,4 meter det er det antagelig. men det kunne kanskje genereringen visst og måt av seg selv? det gjør den ikke idag. Feks her vet den jo ca høyde på vindu og vet at etasjeskille normalt er 20cm så kan sikkert modellen generere takhøydene automatisk. Må kanskje gjøre noe med vindugenerering slik de kan genereres med den vinkelen som er på vinduene i øverste etasje
- **Hvor:** fasadesjekk – 2etg.avif, 1etg.avif, fasade4.avif, fasade3.avif, fasade2.avif, fasade1.avif
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F164.json`
- **Status:** fikset (venter på test) – etasjehøyden fra fasadene, og vinduene som fasaden tegner opp under taket får skrå overkant langs takfallet i veggene der toppen skråner (export.js slopedTops)

### F165 – her er det fortsatt noe i hjørnet
- **Tekst:** her er det fortsatt noe i hjørnet
- **Hvor:** 3D (går rundt) – garasje-plan-snitt-fasade.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F165.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F165.json`
- **Status:** fikset – enden av målelinja i hjørnet (0,71 m med en «åpning» på 0,53 m, merket som yttervegg) fjernes nå som de andre stubbene (dropStubs); gjelder etter ny generering

### F166 – forrige feil med noe i hjørnet. det vises også her på plantegning, men
- **Tekst:** forrige feil med noe i hjørnet. det vises også her på plantegning, men det er ikke på den plantegning PDFen
- **Hvor:** 2D-editor – garasje-plan-snitt-fasade.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F166.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F166.json`
- **Status:** fikset – samme som F165: stubben og åpningen er borte fra planen etter ny generering

### F167 – midt i bildet her er pipa, den blir ikke generert. Samme med pipe på u
- **Tekst:** midt i bildet her er pipa, den blir ikke generert. Samme med pipe på utsiden. Vi må lage en plan på hvordan dette skal genereres og i hvilken fase vi skal gjøre det
- **Hvor:** 2D-editor – 2etg.png, 1etg.png, fasade4.avif, fasade3.avif, fasade2.avif, fasade1.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F167.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F167.json`
- **Status:** fikset (venter på test) – ovnssymbolet KI-en ser på planen blir en vedovn i stua med teglpipe opp gjennom taket (export.js fireplacesOf); et ildsted i en bod blir bare pipa

---

## Kjent fra sluttkontrollen (Claude)

Feil Claude vet om fra testene og sluttkontrollen etter fase C. De trenger ikke meldes.

### K1 – hus6: navnet ENTRE havner i vaskerommet
- **Hvorfor:** `generate.js` kobler KI-svaret til rommet via det foreløpige rommets midtpunkt, som ligger i vaskerommet.
- **Status:** rettet (fase D) – når et foreløpig rom deles, går etiketten til delen med riktig areal.

### K2 – hus1: ett trappespørsmål for mye
- **Hvorfor:** KI sier «rett», gjenkjenningen sier kvartsvingt. Uenighet gir spørsmål, også når tegningen er tydelig.
- **Status:** rettet (fase D) – en tegnet sving (svingtrinn) gir ikke spørsmål når KI-en sier «rett».

### K3 – hus2: boden i nisjen slås sammen med gangen og entreen
- **Hvorfor:** strek-prikk-linja mot entreen blir ikke funnet.
- **Status:** rettet (natt til 23.10) – detect.js gir strek-prikk-linjene foran grunne nisjer (`niches`), og «Generer» skiller nisjen ut med en når den har en romtekst alene (BOD, 0,65 m²). hus2 har 13 rom med eget navn, og generate-testen er grønn.

### K4 – takhøyden spørres om i hver etasje
- **Hvorfor:** 15 av 29 spørsmål er takhøyden. Den bør spørres én gang for huset, med valg per etasje.
- **Status:** rettet (fase D) – ett spørsmål for hele huset; loft og etasjer med egne takmål får sitt eget.

### K5 – KI-svarene varierer fra gang til gang
- **Hvorfor:** ett nytt opptak flyttet tre resultater. Tre svar med flertallsavgjørelse gjør det stabilt, til ca. 3× prisen
  (fortsatt øre per hus).
- **Status:** neste runde – krever nye opptak (ca. 3× kallene), venter til resten er stabilt.

### K6 – hus3 mangler noen enkeltdører
- **Hvorfor:** 6 av 7 og 2 av 4 dører finnes. Henger trolig sammen med F10 (veggen ved trappa).
- **Status:** delvis rettet (fase D) – 1. etasje har nå alle 7 dørene (F11). 2. etasje finner fortsatt 2 av 4 enkeltdører.

### K7 – hus3-foto: rommet heter «WC/D + WC/D»
- **Hvorfor:** gjenkjenningen deler WC/D i to, og KI navngir begge.
- **Status:** rettet (fase D) – samme navn to ganger blir ett.

### K8 – trappene: kvartsvingte bygges som U eller rett, og hus8 får ingen trapp (for bratt)
- **Hvorfor:** spillet har ikke kvartsvingte trapper. hus1-trappa har også dårlige trinnmål (2R+G 0,68).
- **Status:** motoren har nå kvartsvingte og bratte trapper (notes/trapper.md). Kvartsvingte trapper fra tegningen blir L når begge endene har gulv (hus1, 23.10); på hus8 og hus9 finner gjenkjenningen bare ett løp, og de blir fortsatt U eller rett; «Trapp» i 3D-visningen lager dem. hus8: den bratte trappa i sjakten har ikke gulv bak foten i kjelleren (det nedre løpet er ikke tegnet), så den legges ikke inn av seg selv, men spørsmålet har nå «Bratt trapp eller loftstige» (natt til 23.10).

### K9 – hus7 uten KI blir et tomt hus
- **Hvorfor:** veggene er tegnet med to tynne streker, og målestokken bommer med 60 %.
- **Status:** senere

### K10 – loftet (hus1 2. etasje): rommene tar med gulvet utenfor knevegg
- **Hvorfor:** skrå himling finnes ikke i motoren ennå.
- **Status:** eksteriør- eller tak-runden. Himlingene følger nå taket på loftet (type `roof`, knevegg 1,2 m), men rommene tar fortsatt med gulvet utenfor kneveggen.

### K11 – KI-en virker bare lokalt
- **Hvorfor:** KI-ruta er ikke montert i `server.mjs` (bak innloggingen). Det besluttes ved deploy.
- **Status:** når du vil legge det ut

### K12 – noen testgrenser er for slappe etter rettingene i fase C
- **Hvorfor:** for eksempel tillatte valideringsfeil i nettlesertesten og toleransene for hus6.
- **Status:** rettet (fase D) – nettlesertesten krever 0 feil i validatoren for alle hus, og hus6 sine grenser er strammet til det som måles.


### K13 – hårfine streker der to veggstykker møtes (F51, F52, F55)
- **Hvorfor:** en lys strek i full høyde der to stykker av samme veggflate møtes, ofte der rommet på baksiden skifter. Ikke en sprekk (forlenger flatene 1,5 mm: streken står), ikke skygge (solen uten skygge: streken står), ikke teksturen (uten tekstur: streken står).
- **Status:** ikke funnet ennå; neste mistanke er normalene eller lysberegningen i kanten av flatene.

### K14 – hus4 2. etasje: drager, trapp og kjøkkenøy blir egne rom (F56, F57)
- **Hvorfor:** strek-prikk-linja med søyler (⊠) i hver ende er en drager i taket, og trappa og kjøkkenøya er møbler/trapp; de skal ikke lukke rom. Nå blir to stykker av stue/kjøkken egne rom som veiviseren spør om (og gjetter bad).
- **Status:** til neste runde med gjenkjenning. Tanke: et rom uten etikett som bare skilles fra et navngitt rom av slike linjer, slås sammen med det, og spørsmålet får valget «del av rommet ved siden av». **Rettet (23.10):** drageren var én «vegg» (w2, 8,6 m × 0,17 m) med lys midte og stiplede kanter. `dropBeams` i generate.js tar bort de stiplede strekningene uten fyll (vegger tegnet med to heltrukne streker blir, og fylte biter i samme linje – badet og trapperommet – blir egne vegger). Kjøkkenbenken hører nå til stua; trapperommet er fortsatt et eget rom uten navn (ett romspørsmål, mot to).

### K15 – små hakk i romkanten blir stolper og trinn i veggen (F96, F97, hus7)
- **Hvorfor:** romkanten har et hakk på noen centimeter nær et hjørne (veggtykkelsen målt litt ulikt på to stykker), og byggeren lager et kort veggstykke som stikker ut.
- **Status:** rettet (23.10) – «hakkene» var korte veggbiter fra målsettingen (hjelpelinja og skråstreken inne i garasjen på hus7). Korte, tynne vegger med løs ende og samme rom på begge sider fjernes nå (`dropStubs` i generate.js).

### K16 – tak over hus med flere fløyer og innhakk (F135, F136)
- **Hvorfor:** taket deles i rektangler langs husets akse. Et rent L- eller T-hus får én takdel per fløy, men en form med innhakk (hus2) gir deler som ikke dekker alle veggene; da blir det ett tak over hele rektangelet, også over hjørnet der det ikke er hus.
- **Status:** rettet (natt til 23.10): en L eller U deles der halvdelene fyller rektanglene sine best (hus2: to saltak, hus5: tre pulttak), KI-ens fløyer brukes når de er tydelige, mønelinja på planen gir retningen, og lave deler uten etasje over får flatt tak (hus4). Se notes/planbygger.md «Takfløyene».
---

## Ideer: forbedringer og nye funksjoner

<!-- Mal:

### I1 – kort tittel
- **Hva:**
- **Hvorfor:**
- **Når:** nå / runde 2 / senere
- **Status:** ny
-->

### I1 – jeg fikk spørsmål om hvor høye vinduene var og brystningshøyde. Vi bør
- **Tekst:** jeg fikk spørsmål om hvor høye vinduene var og brystningshøyde. Vi bør ha samme plass vi sette vindushøyde bør vi ha dørhøyde også. Den kan jo også variere og så må vi ha et bilde av en dør og vindu på siden av hverande slik vi kan se at toppen på vindu og dør flykter slik det ikke blir seende ut slik som dette
- **Hvor:** 3D (dukkehus) – plan-1etg-tilbygg.pdf
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/I1.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/I1.json`
- **Status:** god idé, til fasade-runden – dørhøyde ved siden av vindushøyde i samme spørsmål, med en liten tegning der toppen av dør og vindu flukter. Inntil da: vinduets topp bør settes til dørhøyden når fasadene mangler.
