# Legge Interiørspillet ut på kenmyd.no

Nettversjonen er bare vanlige filer (HTML, JavaScript, bilder). Den trenger ingen database eller PHP og virker fra
hvilken som helst mappe, f.eks. **https://kenmyd.no/stue/**. Med `.htaccess` ber siden om brukernavn og passord, så
bare de du gir passordet til kommer inn.

Alt du lagrer i spillet (designene dine) ligger i nettleseren til den som bruker det – ikke på serveren.

---------------------------------------------------------------------------------------------------------------

## 1. Bygg og pakk

I prosjektmappen (`C:\Dev\Interiørspillet`), i et terminalvindu:

```bash
npm install        # bare første gang
npm run pack
```

Det lager to ting:

- `dist/` – selve nettsiden (`index.html`, `assets/`, `img/`, `dev/`, `favicon.svg`)
- `deploy/interiorspillet-web.zip` – innholdet i `dist/` **pluss** `.htaccess`, klart til opplasting (ca. 11 MB)

(`npm run build` lager bare `dist/` uten zip-fila.)

Vil du prøve nettversjonen lokalt først: `npm run preview` og åpne http://127.0.0.1:4180.

---------------------------------------------------------------------------------------------------------------

## 2. Lag passordfila (.htpasswd)

Fila inneholder brukernavn og et kryptert passord, én bruker per linje, f.eks.
`stue:$apr1$Xq3…`. Velg én av måtene:

**a) Webhotellets kontrollpanel (enklest).** Mange webhotell (cPanel, Plesk, Domeneshop, one.com …) har en meny som
heter noe sånt som «Passordbeskyttede mapper» / «Directory Privacy». Velg mappa (f.eks. `stue`), lag en bruker, og
panelet lager både `.htpasswd` og passordlinjene i `.htaccess` for deg. Da kan du hoppe over del 1 av vår `.htaccess`
(se punkt 3).

**b) En htpasswd-generator på nett.** Søk etter «htpasswd generator», skriv brukernavn og passord, velg
**bcrypt** (eller «Apache MD5» hvis bcrypt ikke finnes), og kopier linja den gir deg inn i en tekstfil som du kaller
`.htpasswd`. (Bruk et passord du ikke bruker andre steder.)

**c) Med kommandoen `htpasswd`** (følger med Apache; på Mac/Linux finnes den ofte allerede):

```bash
htpasswd -c -B .htpasswd stue        # -c lager ny fil, -B = bcrypt; du blir spurt om passordet
htpasswd -B .htpasswd ola            # legg til en bruker til (uten -c, ellers slettes fila)
```

---------------------------------------------------------------------------------------------------------------

## 3. Rett stien i .htaccess

Åpne `deploy/.htaccess` i Notisblokk (eller VS Code) og bytt ut

```
AuthUserFile /FULL/STI/TIL/.htpasswd
```

med den **fulle stien på serveren** til passordfila, for eksempel

```
AuthUserFile /home/kenmyd/.htpasswd-stue
```

- Stien er ikke en nettadresse, men en mappe på serveren. Du finner hjemmemappa i kontrollpanelet («Home
  directory», «Hjemmekatalog»), eller spør webhotellets kundeservice.
- Legg helst `.htpasswd` **utenfor** `public_html`/`www` (da kan den aldri lastes ned). Ligger den i samme mappe som
  spillet, blokkerer `.htaccess` likevel filer som begynner med punktum.
- Har kontrollpanelet laget passordbeskyttelsen for deg (2a), sletter du de fire linjene `AuthType … Require
  valid-user` i vår fil (panelet har lagt inn sine egne) – resten (filtyper, komprimering, cache) beholder du.

Kjør `npm run pack` på nytt etter at du har endret `.htaccess`, så kommer den riktige versjonen med i zip-fila.

---------------------------------------------------------------------------------------------------------------

## 4. Last opp

Mappa på serveren heter som regel `public_html/` eller `www/`. Lag en undermappe, f.eks. `stue`. Adressen blir da
`https://kenmyd.no/stue/`.

**Med webhotellets filbehandler (enklest med zip-fila):**
1. Gå til `public_html/stue/` (lag mappa hvis den ikke finnes).
2. Last opp `deploy/interiorspillet-web.zip`.
3. Høyreklikk på zip-fila → «Extract» / «Pakk ut» (i den samme mappa). Slett zip-fila etterpå.
4. Last opp `.htpasswd` dit stien i `.htaccess` peker (helst utenfor `public_html`).

**Med FileZilla eller WinSCP (SFTP/FTP):**
1. Koble til med adressen, brukernavnet og passordet fra webhotellet (SFTP, port 22, er tryggere enn FTP, port 21).
2. Til høyre: gå til `public_html/` og lag mappa `stue`.
3. Til venstre: åpne `C:\Dev\Interiørspillet\dist\` og dra **innholdet** (`index.html`, `assets`, `img`, `dev`,
   `favicon.svg`) over til `public_html/stue/` – ikke selve `dist`-mappa.
4. Last også opp `deploy\.htaccess` til `public_html/stue/` og `.htpasswd` dit stien peker.
   - FileZilla: vis skjulte filer med *Tjener → Tving visning av skjulte filer*.
   - WinSCP: *Innstillinger → Panel → Vis skjulte filer* (Ctrl+Alt+H).
5. Ved en ny versjon: last opp alt på nytt og slett gamle filer i `assets/` (de har nye navn hver gang, så gamle
   filer ligger ellers igjen – de gjør ingen skade, men tar plass).

---------------------------------------------------------------------------------------------------------------

## 5. Test

1. Åpne `https://kenmyd.no/stue/` i et privat/inkognito-vindu.
2. Nettleseren skal be om brukernavn og passord. Riktig passord → startskjermen «Interiørspillet».
3. Trykk «Gå inn i stua». Stua skal lastes på 5–20 sekunder (første gang; senere går det fortere fordi filene
   mellomlagres).
4. Sjekk at utsikten vises i vinduene og at veggforslagene har bilder (V). Får du en svart utsikt eller manglende
   bilder: se feilsøking under.

**Feilsøking**

| Problem | Løsning |
| --- | --- |
| «500 Internal Server Error» | Stien i `AuthUserFile` er feil, eller serveren tillater ikke `.htaccess`. Rett stien; spør ellers webhotellet om `AllowOverride` er på. Test ved å fjerne linjer bit for bit. |
| Ber aldri om passord | `.htaccess` ble ikke lastet opp (skjult fil!) eller ligger i feil mappe – den skal ligge ved siden av `index.html`. |
| Hvit side | Du lastet opp `dist`-mappa i stedet for innholdet (adressen blir da `…/stue/dist/`), eller filene ble lastet opp som «ASCII» i FTP – velg «Binær». |
| Utsikten eller bildene mangler | Mappa `img/` mangler eller er ufullstendig – last den opp på nytt. |
| Feil passord hele tiden | Lag `.htpasswd` på nytt (bcrypt eller Apache MD5; ikke «crypt»/SHA uten salt), og sjekk at det ikke er mellomrom på slutten av linja. |

---------------------------------------------------------------------------------------------------------------

## 6. Hvis webhotellet bruker nginx (ikke Apache)

nginx leser ikke `.htaccess`. Da må den som drifter serveren (eller du, i kontrollpanelet) legge inn tilsvarende i
nginx-oppsettet. Passordfila (`.htpasswd`) er den samme.

```nginx
location /stue/ {
    auth_basic           "Interiorspillet";
    auth_basic_user_file /etc/nginx/.htpasswd-stue;   # full sti til passordfila

    # filtyper (vanligvis allerede riktige i mime.types): .js, .json, .svg
    gzip on;
    gzip_types text/css text/javascript application/javascript application/json image/svg+xml;

    location ~* /assets/.*-[A-Za-z0-9_-]{8}\.(js|css)$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
    location ~* \.(jpe?g|png|webp|svg)$                 { add_header Cache-Control "public, max-age=2592000"; }
    location ~* \.html$                                 { add_header Cache-Control "no-cache"; }
    location ~ /\.                                      { deny all; }
}
```

Mange webhotell med nginx (f.eks. noen med «Nginx + Apache») bruker likevel `.htaccess` fordi Apache står bak – prøv
den først. Hvis `.htaccess` ikke har noen virkning, finner du ofte «Passordbeskyttelse» i kontrollpanelet i stedet.

---------------------------------------------------------------------------------------------------------------

## 7. Godt å vite

- Siden virker i nye versjoner av Chrome, Edge, Firefox og Safari. På mobil og nettbrett fungerer den, men er laget
  for mus og tastatur.
- Sidene `…/stue/dev/sandbox.html` og `…/stue/dev/models.html` er testsider (fri kamera og modellgalleri); de er
  beskyttet av det samme passordet.
- Lagrede design ligger i nettleseren på den maskinen de ble laget. Bruk «Design → Eksporter til fil» for å flytte
  et design mellom maskiner (eller mellom den lokale versjonen og kenmyd.no).
