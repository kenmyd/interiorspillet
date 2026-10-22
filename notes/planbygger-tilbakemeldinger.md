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
- **Status:** trenger ny melding – fant ikke stedet uten kameraposisjon. Meld den igjen på samme sted: nå lagres posisjonen i meldingen. (Mistanke: skjøten mellom to veggstykker på samme linje med ulik tykkelse, f.eks. ved badet og «Sov + Gang».)

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
- **Status:** ny

### F39 – Skulle vært dobbeldør uten midtstolpe. Er også naturlig at disse døren
- **Tekst:** Skulle vært dobbeldør uten midtstolpe. Er også naturlig at disse dørene er med vindusfelt så det må også være mulig på innerdører
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F39.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F39.json`
- **Status:** ny

### F40 – Det er noe feil ved høyre side av denne døra
- **Tekst:** Det er noe feil ved høyre side av denne døra
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F40.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F40.json`
- **Status:** ny

### F41 – Trappa er ikke slik som på plantegning
- **Tekst:** Trappa er ikke slik som på plantegning
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F41.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F41.json`
- **Status:** ny

### F42 – rekkverkstolpe går helt ned i etasjen under istedet for å stoppe der d
- **Tekst:** rekkverkstolpe går helt ned i etasjen under istedet for å stoppe der de andre stopper
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F42.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F42.json`
- **Status:** ny

### F43 – Rom i 2.etg skal ha skråtak med takvindu og knevegg slik som på plante
- **Tekst:** Rom i 2.etg skal ha skråtak med takvindu og knevegg slik som på plantegning. Det gjelder de fleste rommene her.
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasade3.avif, fasade4.avif, fasade1.avif, fasade2.avif
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F43.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F43.json`
- **Status:** ny

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
- **Status:** neste runde – den eneste røde sjekken i generate-testen (305 av 306).

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
- **Status:** motoren (nattarbeidet, `stairs.js`) – forespørsel; trinnmålene i fase D

### K9 – hus7 uten KI blir et tomt hus
- **Hvorfor:** veggene er tegnet med to tynne streker, og målestokken bommer med 60 %.
- **Status:** senere

### K10 – loftet (hus1 2. etasje): rommene tar med gulvet utenfor knevegg
- **Hvorfor:** skrå himling finnes ikke i motoren ennå.
- **Status:** eksteriør- eller tak-runden

### K11 – KI-en virker bare lokalt
- **Hvorfor:** KI-ruta er ikke montert i `server.mjs` (bak innloggingen). Det besluttes ved deploy.
- **Status:** når du vil legge det ut

### K12 – noen testgrenser er for slappe etter rettingene i fase C
- **Hvorfor:** for eksempel tillatte valideringsfeil i nettlesertesten og toleransene for hus6.
- **Status:** rettet (fase D) – nettlesertesten krever 0 feil i validatoren for alle hus, og hus6 sine grenser er strammet til det som måles.

---

## Ideer: forbedringer og nye funksjoner

<!-- Mal:

### I1 – kort tittel
- **Hva:**
- **Hvorfor:**
- **Når:** nå / runde 2 / senere
- **Status:** ny
-->
