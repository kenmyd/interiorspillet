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

---

## Ideer: forbedringer og nye funksjoner

<!-- Mal:

### I1 – kort tittel
- **Hva:**
- **Hvorfor:**
- **Når:** nå / runde 2 / senere
- **Status:** ny
-->
