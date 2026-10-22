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
- **Status:** ny
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
- **Status:** fase D. Trolig taklampene i etasjen under som stikker opp gjennom gulvet (taket i 1. etasje = gulvet i 2. etasje).

### F3 – Ser på det øverste vinduet til venstre så flimerer det veldig, usikker
- **Tekst:** Ser på det øverste vinduet til venstre så flimerer det veldig, usikker på hva det er, Dette vinduet er også tegnet feil i forhold til fasadetegningen. Ser også at ytterdøre til venstre flimere litt av og til.
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F3.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F3.json`
- **Status:** fase D – flimring = to flater i samme plan (vindu/vegg). Vindusformen mot fasaden: eksteriør-runden.

### F4 – Er er det også flimring på høyre side av øverste vindu, sikkert samme 
- **Tekst:** Er er det også flimring på høyre side av øverste vindu, sikkert samme feil som den andre. Og så ser det ut som det mangler kledning på høyre side av vinduene.
- **Hvor:** 3D (dukkehus) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F4.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F4.json`
- **Status:** fase D (flimringen, samme som F3). Kledning ved siden av vinduene: eksteriør-runden (F1).

### F5 – Vinduene som går helt til gulvet mangler gulv. De fleste slike vinduer
- **Tekst:** Vinduene som går helt til gulvet mangler gulv. De fleste slike vinduer har som regel gulvet ut til vindu istedet for vinduskarm nede.
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F5.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F5.json`
- **Status:** fase D – gulvet skal gå ut til glasset når vinduet står på gulvet.

### F6 – Vindu. Det er noe rart her. Det er nok derfor det flimret på utsiden o
- **Tekst:** Vindu. Det er noe rart her. Det er nok derfor det flimret på utsiden også
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F6.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F6.json`
- **Status:** fase D – samme som F3.

### F7 – Denne trappa skal helst sikkert være en trapp med tette trappetrinn og
- **Tekst:** Denne trappa skal helst sikkert være en trapp med tette trappetrinn og så er dette rommet en bod, her hadde det også vært naturlig og hatt et vegglys for eksempel
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F7.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F7.json`
- **Status:** trappa: fase D (tegningen sier «ÅPENT OPP»; tette trinn som standard eller et valg i veiviseren). Vegglys i boden: idé til lys-runden (lys per romtype).

### F8 – Det er akkurat som jeg ser igjennom ytterdørene av og til på begge sid
- **Tekst:** Det er akkurat som jeg ser igjennom ytterdørene av og til på begge sider og så flimerer kantene på ytterdørene av og til
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F8.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F8.json`
- **Status:** fase D – samme som F3 (dørene).

### F9 – Hva er dette på veggen
- **Tekst:** Hva er dette på veggen
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F9.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F9.json`
- **Status:** fase D – trolig en tynn veggbit eller list som er til overs.

### F10 – her mangler det en vegg rett ved siden av trappa.
- **Tekst:** her mangler det en vegg rett ved siden av trappa.
- **Hvor:** 3D (går rundt) – 2etg.png, 1etg.png, fasader.png
- **Skjermbilde:** `.shots/planbygger/tilbakemeldinger/F10.jpg`
- **Tilstand:** `.shots/planbygger/tilbakemeldinger/F10.json`
- **Status:** fase D – vegg som ikke ble funnet ved trappa.

---

## Kjent fra sluttkontrollen (Claude)

Feil Claude vet om fra testene og sluttkontrollen etter fase C. De trenger ikke meldes.

### K1 – hus6: navnet ENTRE havner i vaskerommet
- **Hvorfor:** `generate.js` kobler KI-svaret til rommet via det foreløpige rommets midtpunkt, som ligger i vaskerommet.
- **Status:** fase D

### K2 – hus1: ett trappespørsmål for mye
- **Hvorfor:** KI sier «rett», gjenkjenningen sier kvartsvingt. Uenighet gir spørsmål, også når tegningen er tydelig.
- **Status:** fase D

### K3 – hus2: boden i nisjen slås sammen med gangen og entreen
- **Hvorfor:** strek-prikk-linja mot entreen blir ikke funnet.
- **Status:** fase D

### K4 – takhøyden spørres om i hver etasje
- **Hvorfor:** 15 av 29 spørsmål er takhøyden. Den bør spørres én gang for huset, med valg per etasje.
- **Status:** fase D

### K5 – KI-svarene varierer fra gang til gang
- **Hvorfor:** ett nytt opptak flyttet tre resultater. Tre svar med flertallsavgjørelse gjør det stabilt, til ca. 3× prisen
  (fortsatt øre per hus).
- **Status:** fase D

### K6 – hus3 mangler noen enkeltdører
- **Hvorfor:** 6 av 7 og 2 av 4 dører finnes. Henger trolig sammen med F10 (veggen ved trappa).
- **Status:** fase D

### K7 – hus3-foto: rommet heter «WC/D + WC/D»
- **Hvorfor:** gjenkjenningen deler WC/D i to, og KI navngir begge.
- **Status:** fase D

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
- **Status:** fase D

---

## Ideer: forbedringer og nye funksjoner

<!-- Mal:

### I1 – kort tittel
- **Hva:**
- **Hvorfor:**
- **Når:** nå / runde 2 / senere
- **Status:** ny
-->
