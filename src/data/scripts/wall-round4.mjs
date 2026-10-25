#!/usr/bin/env node
/**
 * Runde 4 av forslagene til den høye veggen (N40–N52): flere spileløsninger, filt (plater, filtlameller,
 * sekskanter, oppslagstavle) og kombinasjoner av spiler og filt – i husets farger (SAND, MARRAKESH, røkt og naturell
 * eik, litt oliven og terrakotta). Retter også kategorien på tre eldre forslag (N4, N14, N32), så de havner i riktig
 * gruppe i veggpanelet (ui/wallCategories.js).
 *
 *   node src/data/scripts/wall-round4.mjs          skriver src/data/wall-proposals.json og research/wall-proposals-new.json
 *   node src/data/scripts/wall-round4.mjs --dry    viser bare demping og etterklang per forslag
 *
 * Idempotent: forslagene N40–N52 fjernes og legges til på nytt. Sekskantmønstrene regnes ut her (faste frø).
 * sabineAdded = Σ areal × alfa (samme modell som design/Acoustics.js), rt60 fra acousticModel (22,7 / (26,4 + ΔA)).
 * Mål i meter: u fra nisjehjørnet (venstre), v fra gulvet. Brytere/stikk på veggen: stikk u 1,11 / v 0,18, brytere
 * ved døra u 3,80 / v 1,18 og 1,58, stikk u 3,79 / v 0,18 – spiler og filt som dekker dem får påbyggsramme.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA = path.join(ROOT, 'src/data/wall-proposals.json');
const RESEARCH = path.join(ROOT, 'research/wall-proposals-new.json');
const DRY = process.argv.includes('--dry');

const W = 3.91, MID = W / 2, TOP = 2.35;
const r3 = (x) => Math.round(x * 1000) / 1000;
const SQ3 = Math.sqrt(3);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hexagon lattice cells (flat top) whose whole tile lies inside the box – the same spacing as wall-round3.mjs. */
function hexLattice({ size, u0, u1, v0, v1, pad = 0.008 }) {
  const R = size / SQ3;
  const out = [];
  const dx = 1.5 * R + pad, dy = size + pad;
  for (let q = 0; ; q++) {
    const cu = u0 + R + q * dx;
    if (cu + R > u1 + 1e-9) break;
    for (let r = -1; ; r++) {
      const cv = v0 + size / 2 + r * dy + (q % 2 ? dy / 2 : 0);
      if (cv - size / 2 < v0 - 1e-9) continue;
      if (cv + size / 2 > v1 + 1e-9) break;
      out.push({ cu, cv });
    }
  }
  return out;
}

const item = (c, color, extra = {}) => ({ cu: r3(c.cu), cv: r3(c.cv), color, ...extra });
function hexElement(cells, { size, surface, depth, colors, alpha }) {
  const us = cells.map((c) => c.cu), vs = cells.map((c) => c.cv);
  const u0 = Math.min(...us) - size / 2, u1 = Math.max(...us) + size / 2, v0 = Math.min(...vs) - size / 2, v1 = Math.max(...vs) + size / 2;
  return { type: 'hexagons', u: r3(u0), v: r3(v0), w: r3(u1 - u0), h: r3(v1 - v0), size, depth, colors, surface, orientation: 'flat-top', items: cells, alpha };
}

// colours (the felt / wood swatches in walldesigns.js, so the editor shows their names)
const FELT = { sand: '#cbbba2', lightSand: '#c9bca6', marrakesh: '#a39584', terracotta: '#b06f55', olive: '#6b6a47', warmGrey: '#7c766f', black: '#1b1b1b' };
const WOOD = { oak: '#b08b62', smoked: '#5f4936' };
const SAND_PAINT = '#cfc5b4';

/** Slat panel on battens + mineral wool and felt (as B): 27 mm slats, 13 mm gaps, 48 mm behind. */
const slats = (o) => ({ type: 'slats', u: 0, v: 0, w: W, h: TOP, slatW: 0.027, slatD: 0.012, gap: 0.013, orientation: 'vertical', wood: 'oak', slatColor: WOOD.oak, backing: 'felt', backingColor: FELT.black, standoff: 0.048, alpha: 0.76, ...o });
const smoked = (o) => slats({ wood: 'smoked-oak', slatColor: WOOD.smoked, ...o });
/** Felt board (PET felt on a 40 mm absorber / battens with mineral wool). */
const felt = (o) => ({ type: 'panel', depth: 0.04, surface: 'felt', color: FELT.sand, edge: 'square', frameColor: null, alpha: 0.8, ...o });

// ---------------------------------------------------------------------------------------------------------------
// Spiler

function n40() {
  return {
    id: 'N40', group: 'Runde 4 – spiler',
    name: 'Naturell eik på lys filt – spilevegg uten sorte striper',
    description: 'Samme spilevegg som B (naturell eik, gulv til 235 cm), men med lys sandfarget filt bak spilene i stedet for sort. Fugene leses som fine, lyse linjer i treverket, så veggen blir lysere og roligere og glir bedre inn i SAND-veggene rundt. Dempingen er den samme.',
    pros: ['Like mye demping som B (ca. +7 m² Sabine)', 'Lysere og roligere enn sort filt – passer SAND-veggene', 'Naturell eik holder stua lys', 'Finnes ferdig: Akupanel og Lundbergs leveres på beige filt'],
    cons: ['Lys filt viser støv og merker litt mer enn sort', 'Mindre kontrast og «dybde» enn sort filt', 'Må stå på lekter med mineralull for å dempe så mye (rett på veggen bare klasse D)'],
    products: ['WoodUpp Akupanel klassisk eik på beige filt, 240 × 60 cm – 7 stk (ca. 1 300–2 100 kr/stk, f.eks. Fjordglott Trevare)', 'Alternativ: Lundbergs Harmony på beige akustikkfilt, 259 × 61,5 cm (ca. 1 590 kr/stk veil.)', 'Lekter 45–48 mm med mineralull bak – gir klasse A (αw ≈ 0,9) mot 0,35 rett på veggen', 'Påbyggsrammer for brytere og stikk'],
    notes: 'Som B, men med beige/sand filt bak (backingColor #cbbba2). Prøv filtfargen mot SAND-veggen – litt mørkere enn veggen gjør at fugene ikke forsvinner helt. Priser sjekket 25.10.2026, pris per størrelse ikke bekreftet.',
    priceText: 'ca. 11–16 000 kr inkl. lekter og mineralull (estimat)', priceMin: 11000, priceMax: 16000,
    elements: [slats({ backingColor: FELT.sand })],
  };
}

function n41() {
  return {
    id: 'N41', group: 'Runde 4 – spiler',
    name: 'Liggende spiler i røkt eik – gulv til 235 cm',
    description: 'Spilevegg i røkt eik der spilene ligger vannrett. Liggende linjer får veggen til å virke bredere og roligere, og de følger bordplaten og vinduskarmene i stua. Bygget som B med lekter og Glava bak, så den demper like mye.',
    pros: ['Mye demping (ca. +7 m² Sabine)', 'Liggende linjer gir ro og gjør veggen bredere', 'Røkt eik henter spisebordet og kjøkkenet', 'Tåler stolrygger godt'],
    cons: ['Ferdige akupaneler må snus 90° – sjekk at produsenten tillater det', 'Støv legger seg litt lettere på liggende spiler', 'Dyrere enn maling og bilder'],
    products: ['Akustikkpaneler i røkt eik, 60 × 240 cm, montert liggende (eller løse spiler 27 × 12 mm på sort filt)', 'Lekter 48 mm med Glava bak', 'Endelister i eik på sidene', 'Påbyggsrammer for brytere og stikk'],
    notes: 'Liggende spiler hele bredden, 0–235 cm.',
    priceText: 'ca. 12–14 000 kr (estimat, som B2)', priceMin: 12000, priceMax: 14000,
    elements: [smoked({ orientation: 'horizontal' })],
  };
}

function n42() {
  const hs = [1.65, 2.0, 2.35, 2.0, 1.65];
  const w = 0.6, gap = 0.12, u0 = r3((W - (hs.length * w + (hs.length - 1) * gap)) / 2);
  return {
    id: 'N42', group: 'Runde 4 – spiler',
    name: 'Spilefelt i trinn – fem felt i røkt eik, høyest på midten',
    description: 'Fem spilefelt på 60 cm i røkt eik som står på gulvet og stiger i trinn mot midten (165, 200 og 235 cm). Mellom feltene og over dem vises SAND-veggen. Trinnene rammer inn spisebordet og gir veggen en rolig «skyline» uten at den blir tung.',
    pros: ['Mer luft og lys enn en heldekkende spilevegg', 'Rammer inn spisebordet midt på veggen', 'Ferdige paneler på 60 cm kan kappes til høydene', 'Fritt rundt bryterne ved døra'],
    cons: ['Mindre demping enn heldekkende spiler (ca. +4,4 m² Sabine)', 'Mellomrommene må males pent – de synes', 'Stikkontakten ved gulvet får påbyggsramme'],
    products: ['5 akustikkpaneler i røkt eik 60 × 240 cm (f.eks. WoodUpp Akupanel), kappet til 165 / 200 / 235 cm', 'Lekter med mineralull bak (45–48 mm) – rett på veggen demper de bare en tredjedel så mye', 'Endelister i eik'],
    notes: `Feltene står fra u ${String(u0).replace('.', ',')} med 12 cm mellomrom: 165 / 200 / 235 / 200 / 165 cm høye.`,
    priceText: 'ca. 6–8 000 kr (estimat)', priceMin: 6000, priceMax: 8000,
    elements: hs.map((h, i) => smoked({ u: r3(u0 + i * (w + gap)), w, h })),
  };
}

function n43() {
  // the gap widens toward the door in four steps: 13 → 27 → 54 → 100 mm
  const parts = [[0, 1.4, 0.013], [1.4, 1.0, 0.027], [2.4, 0.8, 0.054], [3.2, r3(W - 3.2), 0.1]];
  return {
    id: 'N43', group: 'Runde 4 – spiler',
    name: 'Spiler som løser seg opp – tett ved nisjen, luftig mot døra',
    description: 'Eikespiler på sandfarget filt der avstanden mellom spilene øker i fire trinn fra nisjehjørnet mot døra (1,3 – 2,7 – 5,4 – 10 cm). Veggen går fra en tett spilevegg til enkeltspiler som nesten forsvinner i den lyse filten. Et rolig, arkitektonisk grep som gir bevegelse uten farger.',
    pros: ['Mye demping over hele veggen (filten bak demper også i de åpne partiene)', 'Unik – ser spesialtegnet ut', 'Lys filt bak gjør overgangen myk', 'Løse spiler er billige'],
    cons: ['Må bygges av løse spiler på filt – ikke ferdige paneler', 'Krever nøyaktig utmåling av avstandene', 'Bryterne ved døra må på påbyggsramme'],
    products: ['Eikespiler 27 × 12 mm (ca. 70 stk à 240 cm)', 'Sandfarget PET-filt 9–12 mm på lekter med Glava (48 mm)', 'Avstandsmaler for 13 / 27 / 54 / 100 mm'],
    notes: 'Fire felt: u 0–1,4 (13 mm fuge), 1,4–2,4 (27 mm), 2,4–3,2 (54 mm), 3,2–3,91 (100 mm). Gulv til 235 cm.',
    priceText: 'ca. 8–11 000 kr som gjør-det-selv (estimat)', priceMin: 8000, priceMax: 11000,
    elements: parts.map(([u, w, gap]) => slats({ u, w, gap, backingColor: FELT.sand })),
  };
}

function n44() {
  return {
    id: 'N44', group: 'Runde 4 – spiler',
    name: 'Ton i ton – spiler malt i SAND helt til taket',
    description: 'Spiler malt i samme SAND som veggene, på sandfarget filt, fra gulv til tak. Veggen får struktur og skyggespill i stedet for farge – den føles som en del av huset, ikke et møbel. Til taket gir mest demping av alle spileløsningene.',
    pros: ['Mest demping av spilene (ca. +8,9 m² Sabine)', 'Helt i stil med huset – samme farge som veggene', 'Rolig – blir aldri «for mye»', 'Kan males om senere'],
    cons: ['Mister treets varme', 'Malte spiler må lages eller males før montering', 'Krever stillas/høy stige opp til 3 m'],
    products: ['Spilepaneler i MDF/furu malt i Jotun SAND 1140 (eller løse spiler malt på forhånd)', 'Sandfarget filt bak, lekter med Glava (48 mm)', 'Påbyggsrammer for brytere og stikk'],
    notes: 'Gulv til tak (0–300 cm), hele bredden.',
    priceText: 'ca. 12–16 000 kr (estimat)', priceMin: 12000, priceMax: 16000,
    elements: [slats({ h: 3.0, wood: 'painted', slatColor: SAND_PAINT, backingColor: FELT.sand })],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Filt

function n45() {
  return {
    id: 'N45', group: 'Runde 4 – filt',
    name: 'Filtlameller i MARRAKESH – myk spilevegg i filt',
    description: 'En spilevegg der lamellene er av PET-filt i stedet for tre: 35 mm brede filtlameller med smale fuger, i en varm gråbrun tone som ligger tett på MARRAKESH i TV-stua. Den har samme rytme som en spilevegg, men er myk å ta på, demper på hele flaten og binder stua til TV-stua.',
    pros: ['Mye demping (ca. +7,5 m² Sabine)', 'Myk og stille – tåler stolrygger og barnehender', 'Henter MARRAKESH fra TV-stua', 'Lett – limes eller skrus på lekter'],
    cons: ['Vanskelig å kjøpe ferdig i Norge – import eller gjør-det-selv', 'Ikke tre – mindre varm enn eik', 'Filt samler noe støv (støvsug med børste)'],
    products: ['Ferdige filtlameller / PET-filtplater med V-spor fant vi ikke i norske nettbutikker (25.10.2026) – bare utenlandske og B2B-leverandører (f.eks. Decormania, Texfel), uten bekreftet pris og frakt', 'Gjør-det-selv: 35 mm brede strimler skåret av 20 mm PET-filt i varm gråbrun, limt på mørk filt', 'Lekter 20 mm, utsparinger for brytere og stikk'],
    notes: 'Filtlameller 35 mm, fuge 12 mm, 20 mm ut fra veggen på mørk filt. Gulv til 235 cm. Dempingen er et anslag (αw ≈ 0,8 for PET-filt på lekter) – ingen målte tall funnet.',
    priceText: 'pris ukjent (import eller gjør-det-selv)', priceMin: null, priceMax: null,
    elements: [slats({ wood: 'felt', slatColor: FELT.marrakesh, slatW: 0.035, slatD: 0.02, gap: 0.012, backingColor: '#5e554b', standoff: 0.02, alpha: 0.82 })],
  };
}

function n46() {
  // real plate sizes (Akustikmiljö Single 600 × 600 and 1200 × 600, 50 mm) inside 3 cm oak frames, five columns
  const cols = 5, w = 0.66, g = 0.05, u0 = r3((W - (cols * w + (cols - 1) * g)) / 2 - 0.05);
  const rows = [[0.3, 0.66, FELT.marrakesh], [1.01, 1.26, FELT.sand]];
  const els = [];
  for (const [v, h, color] of rows) for (let i = 0; i < cols; i++) els.push(felt({ u: r3(u0 + i * (w + g)), v, w, h, depth: 0.05, color, edge: 'frame', frameColor: WOOD.oak, frameMaterial: 'oak' }));
  return {
    id: 'N46', group: 'Runde 4 – filt',
    name: 'Filtplater i eikerammer – beige over brun',
    description: 'Ti akustikkplater (50 mm, PET-filt med tekstil) i smale rammer av naturell eik, i fem kolonner: kvadratiske plater i en brun MARRAKESH-tone nederst, der stolryggene treffer, og høye plater i beige over. Rammene gir et ryddig, nesten snekret uttrykk som passer eikegulvet.',
    pros: ['God demping (ca. +§SABINE m² Sabine)', 'Mørkere plater nederst skjuler merker fra stolene', 'Eikerammene binder veggen til gulvet', 'Ferdige plater i standardmål – bare rammene lages selv'],
    cons: ['Ti rammer å lage og montere i lodd', 'Lys tekstil øverst kan bli skitten ved påsmøring', 'Mindre «wow» enn spiler'],
    products: ['Akustikmiljö «Lydabsorbent Single» 50 mm (resirkulert PET, αw 0,90): 5 stk 600 × 600 i Hush brun og 5 stk 1200 × 600 i Hush beige (Lydglede.no, ca. 799 kr/stk – pris per størrelse ikke bekreftet)', 'Alternativ: Frigg 40 mm tekstil i beige (Norsk Akustikksenter, αw 0,95)', 'Rammelist i eik ca. 30 × 55 mm, skjulte vegghengere'],
    notes: 'Rader: 30–96 cm og 101–227 cm, fem kolonner fra u ≈ 0,15. Holder seg unna bryterne ved døra. Priser sjekket 25.10.2026.',
    priceText: 'ca. 8–11 000 kr inkl. eikelister (estimat)', priceMin: 8000, priceMax: 11000,
    elements: els,
  };
}

function n47() {
  const R = rng(4701);
  const pins = [[0.35, 1.45, 0.3, 0.4, 'botanical'], [0.75, 1.62, 0.21, 0.3, 'line-art'], [0.48, 1.0, 0.3, 0.21, 'abstract-shapes'], [3.05, 1.5, 0.3, 0.4, 'line-art'], [3.4, 1.1, 0.21, 0.3, 'botanical']];
  const PAL = [['#efe8dc', '#7d8a6a', '#3a3936'], ['#f1ece2', '#2b2b2b', '#c98f6b'], ['#e9e0d0', '#c98f6b', '#b8a58a', '#3a3936']];
  return {
    id: 'N47', group: 'Runde 4 – filt',
    name: 'Heldekkende filtvegg i MARRAKESH med eikelist – også oppslagstavle',
    description: 'Hele veggen kles med PET-filt i en varm gråbrun tone, fra gulv til 235 cm, med en smal eikelist på toppen som bildehylle. Filten demper godt, og fordi man kan feste ting med nåler blir veggen også en stor oppslagstavle for tegninger, kort og bilder – her med noen få kort ved sidene.',
    pros: ['Mye demping (ca. +7,4 m² Sabine)', 'Praktisk: tegninger og kort festes med nåler', 'Rolig, ensfarget – henter MARRAKESH fra TV-stua', 'Eikelisten på toppen gir en ren avslutning'],
    cons: ['Filt på hele flaten må monteres nøyaktig i skjøtene', 'Mye pynt kan gjøre veggen rotete – hold det til noen få ting', 'Utsparinger for brytere og stikk'],
    products: ['WoodUpp Akustikk filt 2400 × 600 × 9 mm i beige (ca. 499 kr/stk, 7 stk) – eller brun PET-filt fra Trebutikken (ca. 1 890 kr/stk)', 'Under filten: 30–40 mm mineralullplate eller lekter med Glava – 9 mm filt rett på veggen alene demper lite', 'Eikelist 90 × 30 mm som bildehylle på 235 cm, tegnestifter med eikehode', 'Ferdig alternativ i mindre format: Götessons Collage EcoSUND oppslagstavle 50 mm (Beltton.no, fra ca. 3 200 kr, 4–6 ukers levering)'],
    notes: 'Filt 0–235 cm over hele bredden; eikelist på 235 cm. Kortene er bare eksempler. Fargen er vist i MARRAKESH-tonen – WoodUpp-beige er trolig lysere, så bestill vareprøve. Priser sjekket 25.10.2026.',
    priceText: 'ca. 6–9 000 kr med WoodUpp-filt (brun filt: ca. 16 000 kr)', priceMin: 6000, priceMax: 9000,
    elements: [
      felt({ u: 0, v: 0, w: W, h: TOP, depth: 0.03, color: FELT.marrakesh }),
      { type: 'shelf', u: 0, v: TOP, w: W, d: 0.09, thickness: 0.03, color: WOOD.oak, material: 'oak', decor: false, alpha: 0 },
      ...pins.map(([u, v, w, h, motif], i) => ({ type: 'art', u, v, w, h, depth: 0.004, motif, palette: PAL[i % PAL.length], frame: 'none', acoustic: false, seed: Math.floor(R() * 90) + 10, alpha: 0, sun: false })),
    ],
  };
}

function n48() {
  const size = 0.52; // Frigg Hex / Akustikmiljö Honey: 600 × 520 mm
  const R = rng(4801);
  const cells = [];
  for (const c of hexLattice({ size, u0: 0.15, u1: 3.62, v0: 0.55, v1: 2.95 })) {
    const e = ((c.cu - MID) / 1.72) ** 2 + ((c.cv - 1.75) / 1.02) ** 2 + (R() - 0.5) * 0.4;
    if (e > 1) continue;
    const k = R();
    if (k < 0.16) cells.push(item(c, WOOD.oak, { surface: 'oak', depth: 0.02 }));
    else cells.push(item(c, k < 0.55 ? FELT.sand : k < 0.85 ? FELT.lightSand : FELT.marrakesh));
  }
  const nOak = cells.filter((c) => c.surface === 'oak').length;
  const alpha = r3((nOak * 0.08 + (cells.length - nOak) * 0.8) / cells.length);
  return {
    id: 'N48', group: 'Runde 4 – filt',
    name: 'Sekskanter i filt og eik – rolig klynge i sand',
    description: 'En myk, avrundet klynge av store sekskanter (60 × 52 cm, standardmålet for akustiske sekskanter) over spisebordet: de fleste i filt/tekstil i beige, lys sand og brun, og omtrent hver sjette i naturell eik som ligger litt flatere. Fargene er så nær veggen at klyngen leses som et relieff – eiken gir varme lyspunkter.',
    pros: ['Demper der folk sitter og prater (ca. +§SABINE m² Sabine)', 'Ton i ton med SAND/MARRAKESH – rolig', 'Eikeflisene henter gulvet og stolbena', 'Ferdige sekskanter i standardmål – kan bygges ut senere'],
    cons: ['Lag papirmal på veggen før du skrur/limer', 'Eikeflisene demper nesten ingenting (må lages selv)', 'Kantene på lys filt blir fort skitne nederst'],
    products: ['Akustikmiljö «Honey» 600 × 520 mm, 40–50 mm (αw 0,75 / 0,90) i Hush beige og brun – Lydglede.no, ca. 469 kr/stk (min. 5 stk, pris per tykkelse ikke bekreftet)', 'Alternativ: Frigg Hex 40 mm i beige (Norsk Akustikksenter, αw 0,95, ca. 726 kr/stk)', 'Eikesekskanter: kapp selv av 18–20 mm eikefinert MDF i samme mål', 'Monteringslim eller borrelås'],
    notes: 'Flate topp/bunn, §COUNT sekskanter. Klyngen er midtstilt rundt (1,95; 1,75) m. Priser sjekket 25.10.2026.',
    priceText: 'ca. 9–14 000 kr (filtsekskanter à ca. 470–730 kr + eik, estimat)', priceMin: 9000, priceMax: 14000,
    elements: [hexElement(cells, { size, surface: 'felt', depth: 0.04, colors: [FELT.sand, FELT.lightSand, FELT.marrakesh, WOOD.oak], alpha })],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Spiler + filt

function n49() {
  const n = 7, w = 0.5, u0 = r3((W - n * w) / 2 - 0.05);
  return {
    id: 'N49', group: 'Runde 4 – kombinert',
    name: 'Spiler og filt i rytme – røkt eik og MARRAKESH-filt',
    description: 'Sju felt på 50 cm fra gulv til 235 cm, annenhver spilepanel i røkt eik og glatt filtplate i en varm gråbrun MARRAKESH-tone. Rytmen gir veggen et rolig, skreddersydd uttrykk – litt som en fullhøyde garderobefront – og både spilene og filten demper.',
    pros: ['God demping over hele veggen (ca. +6,4 m² Sabine)', 'Røkt eik + MARRAKESH-filt: varmt og henter TV-stua', 'Mindre «stripete» enn heldekkende spiler', 'Ferdige paneler kan kappes til 50 cm'],
    cons: ['Krever presis montering så feltene står i lodd', 'Filtfeltene ligger litt bak spilene – støv i kanten', 'Stikkontakten ved gulvet får påbyggsramme'],
    products: ['4 spilepaneler i røkt eik (f.eks. WoodUpp Akupanel), kappet til 50 cm, på lekter med mineralull', '3 akustikkplater 50 × 235 cm, 40–50 mm, i brun/beige tekstil (f.eks. Frigg 40 mm tekstil, som finnes opp til 120 × 270 cm – spør om 50 cm bredde)', 'Eikelister i overgangene'],
    notes: `Felt fra u ${String(u0).replace('.', ',')}: spiler – filt – spiler – filt – spiler – filt – spiler. Gulv til 235 cm.`,
    priceText: 'ca. 9–12 000 kr (estimat)', priceMin: 9000, priceMax: 12000,
    elements: Array.from({ length: n }, (_, i) => (i % 2 ? felt({ u: r3(u0 + i * w), v: 0, w, h: TOP, color: FELT.marrakesh }) : smoked({ u: r3(u0 + i * w), w }))),
  };
}

function n50() {
  // the field is the size of a real felt pinboard (Götessons Collage 240 × 120), centred over the table
  const f = { u0: 0.755, u1: 3.155, v0: 0.95, v1: 2.15 };
  return {
    id: 'N50', group: 'Runde 4 – kombinert',
    name: 'Spilevegg med innfelt filtfelt i skogsgrønn over spisebordet',
    description: 'En spilevegg i naturell eik fra gulv til 235 cm med et innfelt felt i skogsgrønn filt (2,4 × 1,2 m) over spisebordet – et rolig «bilde» uten motiv, som også kan brukes som oppslagstavle. Feltet samler blikket over bordet og henter de grønne tonene i rommet, mens spilene rundt demper mest.',
    pros: ['Mye demping (ca. +§SABINE m² Sabine)', 'Et blikkfang uten at man må velge et motiv', 'Filtfeltet kan byttes til en annen farge eller et akustikkbilde senere', 'Naturell eik holder rommet lyst'],
    cons: ['Spilene må kappes rundt feltet – mer snekkerarbeid', 'Grønt er en ny farge på veggen – prøv den mot SAND', 'Bryterne ved døra må på påbyggsramme'],
    products: ['Akustikkpaneler i naturell eik 60 × 240 cm (f.eks. WoodUpp Akupanel), kappet rundt feltet, på lekter med mineralull', 'Götessons Collage EcoSUND 50 mm, 240 × 120 cm i skogsgrønn (Beltton.no, 4–6 ukers levering; pris for denne størrelsen ikke bekreftet – minste størrelse fra ca. 3 200 kr)', 'Alternativ: to Akustikmiljö Single 1200 × 900 i Hush grønn side om side', 'Eikelister rundt feltet'],
    notes: 'Filtfeltet: u 0,76–3,16, v 0,95–2,15 m (midt over bordet). Spilene ligger rundt i fire deler. Priser sjekket 25.10.2026.',
    priceText: 'ca. 14–20 000 kr (estimat – filtfeltet er usikkert)', priceMin: 14000, priceMax: 20000,
    elements: [
      slats({ u: 0, w: f.u0 }),
      slats({ u: f.u1, w: r3(W - f.u1) }),
      slats({ u: f.u0, w: r3(f.u1 - f.u0), h: f.v0 }),
      slats({ u: f.u0, v: f.v1, w: r3(f.u1 - f.u0), h: r3(TOP - f.v1) }),
      felt({ u: f.u0 + 0.01, v: f.v0 + 0.01, w: r3(f.u1 - f.u0 - 0.02), h: r3(f.v1 - f.v0 - 0.02), depth: 0.05, color: '#4f5a44', alpha: 0.9 }),
    ],
  };
}

function n51() {
  const size = 0.26; // AURA HEX 30 × 26 cm
  const brown = '#5e4a3a';
  const R = rng(5101);
  const cells = [];
  for (const c of hexLattice({ size, u0: 1.46, u1: 3.62, v0: 0.12, v1: TOP })) {
    // dense next to the slats, scattering out toward the door
    const t = (c.cu - 1.46) / (3.62 - 1.46);
    if (R() > Math.max(0.08, 1 - t * 0.8) ** 1.1) continue;
    const k = R();
    cells.push(item(c, k < 0.55 ? FELT.sand : k < 0.85 ? FELT.marrakesh : brown));
  }
  return {
    id: 'N51', group: 'Runde 4 – kombinert',
    name: 'Spiler som går over i små filtsekskanter',
    description: 'Et spilefelt i røkt eik fra nisjehjørnet (150 cm bredt, gulv til 235 cm) som «går i oppløsning» i små sekskanter av PET-filt (30 × 26 cm) i beige, gråbrunt og litt mørkebrunt. Tettest inntil spilene, så stadig glissere mot døra. Leken, men rolig fordi fargene er dempet og henter den røkte eiken.',
    pros: ['Middels demping (ca. +§SABINE m² Sabine)', 'Kombinerer tre og filt på en ny måte', 'Fritt rundt bryterne ved døra', 'Små fliser – kan flyttes og bygges ut'],
    cons: ['Mange sekskanter å plassere (§COUNT stk) – papirmal anbefales', 'Asymmetrisk – må like det', 'De små flisene kommer fra Danmark – frakt og dempetall ikke bekreftet'],
    products: ['Akustikkpaneler i røkt eik 60 × 240 cm (2,5 stk, 150 cm bredt felt) på lekter med mineralull', 'AURA HEX 30 × 26 cm, 25 mm PET-filt i beige, lysegrå og mørkebrun (Dansk Lydisolering, ca. 1 295 DKK per 15 stk)', 'Monteringslim/borrelås for filten'],
    notes: 'Spilefelt u 0–1,46. Sekskantene fra u 1,46 til 3,62, sannsynligheten faller mot døra. Dempingen for 25 mm filt er et anslag (αw ≈ 0,55). Priser sjekket 25.10.2026.',
    priceText: 'ca. 8–11 000 kr (estimat)', priceMin: 8000, priceMax: 11000,
    elements: [
      smoked({ w: 1.46 }),
      hexElement(cells, { size, surface: 'felt', depth: 0.025, colors: [FELT.sand, FELT.marrakesh, brown], alpha: 0.55 }),
    ],
  };
}

function n52() {
  const rail = 1.0;
  return {
    id: 'N52', group: 'Runde 4 – kombinert',
    name: 'Liggende eikespiler nede, MARRAKESH-filt oppe – brystpanel som tåler stolrygger',
    description: 'Et brystpanel av liggende spiler i røkt eik fra gulvet til 100 cm, der stolryggene treffer veggen, med en smal eikelist på toppen. Over listen er veggen kledd med glatt filt i en varm gråbrun MARRAKESH-tone opp til 235 cm. Hardt og slitesterkt der det trengs, mykt og dempende der det er plass.',
    pros: ['God demping (ca. +7 m² Sabine)', 'Spilene tåler stoler og støvsuger', 'Filten i MARRAKESH-tonen binder stua til TV-stua', 'Listen kan brukes som smal bildehylle'],
    cons: ['To materialer og en list – mer arbeid', 'Brystpanel deler veggen på tvers (rommet kan virke lavere)', 'Stikkontakten ved gulvet får påbyggsramme'],
    products: ['Spilepaneler i røkt eik montert liggende, 0–100 cm, på lekter med mineralull', 'Akustikkplater 40–50 mm i brun/beige tekstil, 103–235 cm (f.eks. Akustikmiljö Single i Hush brun, eller Frigg 40 mm tekstil)', 'Eikelist 70 × 25 mm på 100 cm'],
    notes: 'Spiler 0–100 cm, list på 100 cm, filt 103–235 cm, hele bredden.',
    priceText: 'ca. 10–13 000 kr (estimat)', priceMin: 10000, priceMax: 13000,
    elements: [
      smoked({ h: rail, orientation: 'horizontal' }),
      { type: 'shelf', u: 0, v: rail, w: W, d: 0.075, thickness: 0.025, color: WOOD.oak, material: 'oak', decor: false, alpha: 0 },
      felt({ u: 0, v: r3(rail + 0.03), w: W, h: r3(TOP - rail - 0.03), color: FELT.marrakesh }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------

/** Older proposals whose elements say something else than the idea (ui/wallCategories.js). */
const CATEGORY_FIXES = { N4: 'diverse', N14: 'diverse', N32: 'kombinert' };

const ELEMENT_ALPHA = { slats: 0.76, panel: 0.94, art: 0.56, tapestry: 0.45, checker: 0.77, circles: 0.8, hexagons: 0.45, curtain: 0.45, moss: 0.47, bookcase: 0.25 };

/** Same model as design/Acoustics.js elementAbsorption. */
function absorption(el) {
  const alpha = typeof el.alpha === 'number' ? el.alpha : ELEMENT_ALPHA[el.type] ?? 0;
  if (!alpha) return 0;
  if (el.type === 'hexagons' && el.items?.length) return el.items.length * (SQ3 / 2) * el.size * el.size * alpha;
  return (el.w ?? 0) * (el.h ?? 0) * Math.max(1, el.count ?? 1) * alpha;
}

const builders = [n40, n41, n42, n43, n44, n45, n46, n47, n48, n49, n50, n51, n52];
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const { k, baseAbsorption } = data.acousticModel;
const fresh = builders.map((fn) => {
  const raw = fn();
  const sabine = Math.round(raw.elements.reduce((s, e) => s + absorption(e), 0) * 10) / 10;
  // §SABINE / §COUNT in the texts: the computed damping (Norwegian decimal comma) and the number of hexagons
  const count = raw.elements.find((e) => e.type === 'hexagons')?.items?.length ?? 0;
  const fill = (v) => (typeof v === 'string' ? v.replaceAll('§SABINE', String(sabine).replace('.', ',')).replaceAll('§COUNT', String(count)) : Array.isArray(v) ? v.map(fill) : v);
  const p = Object.fromEntries(Object.entries(raw).map(([key, v]) => [key, key === 'elements' ? v : fill(v)]));
  return {
    id: p.id,
    code: p.id,
    name: p.name,
    group: p.group,
    priceText: p.priceText,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    sabineAdded: sabine,
    rt60: Math.round((k / (baseAbsorption + sabine)) * 100) / 100,
    rank: null,
    recommended: false,
    badge: 'Ny',
    description: p.description,
    pros: p.pros,
    cons: p.cons,
    products: p.products,
    notes: p.notes ?? null,
    wallPaint: p.wallPaint ?? null,
    elements: p.elements,
    image: null,
    thumb: null,
    imageSource: null,
    drawingsSource: [],
  };
});

for (const p of fresh) {
  const hex = p.elements.find((e) => e.type === 'hexagons');
  console.log(`${p.id.padEnd(4)} ${p.name.slice(0, 66).padEnd(66)} ΔA ${String(p.sabineAdded).padStart(4)}  RT60 ${p.rt60}${hex ? `  (${hex.items.length} sekskanter)` : ''}`);
}

if (!DRY) {
  const ids = new Set(fresh.map((p) => p.id));
  const fix = (p) => (CATEGORY_FIXES[p.code ?? p.id] ? { ...p, category: CATEGORY_FIXES[p.code ?? p.id] } : p);
  data.proposals = [...data.proposals.filter((p) => !ids.has(p.id)).map(fix), ...fresh];
  fs.writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  // keep the normaliser's source in step (normalize-data.mjs merges research/wall-proposals-new.json by code)
  const research = JSON.parse(fs.readFileSync(RESEARCH, 'utf8'));
  const list = Array.isArray(research) ? research : research.proposals;
  const asResearch = fresh.map(({ image, thumb, imageSource, drawingsSource, ...rest }) => ({ ...rest, image: null, drawings: [] }));
  const kept = list.filter((p) => !ids.has(String(p.code ?? p.id))).map(fix);
  if (Array.isArray(research)) fs.writeFileSync(RESEARCH, `${JSON.stringify([...kept, ...asResearch], null, 2)}\n`, 'utf8');
  else fs.writeFileSync(RESEARCH, `${JSON.stringify({ ...research, proposals: [...kept, ...asResearch] }, null, 2)}\n`, 'utf8');
  console.log(`skrev ${fresh.length} forslag → ${path.relative(ROOT, DATA)} (${data.proposals.length} totalt) og ${path.relative(ROOT, RESEARCH)}`);
}
