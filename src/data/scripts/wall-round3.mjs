#!/usr/bin/env node
/**
 * Runde 3 av forslagene til den høye veggen (N20–N39): sekskanter, sjakkbrett med liten skjenk, bildevegger og nye
 * retninger (tapet, listverk, bokvegg, bølgespiler, kanalpolstring, kalkmaling).
 *
 *   node src/data/scripts/wall-round3.mjs          skriver src/data/wall-proposals.json og research/wall-proposals-new.json
 *   node src/data/scripts/wall-round3.mjs --dry    viser bare antall elementer og demping per forslag
 *
 * Idempotent: forslagene N20–N39 fjernes og legges til på nytt (etter N19). Sekskantmønstrene regnes ut her (faste
 * frø), så de blir like hver gang. sabineAdded = Σ areal × alfa (samme modell som design/Acoustics.js), rt60 fra
 * acousticModel (22,7 / (26,4 + ΔA)). Mål i meter: u fra nisjehjørnet (venstre), v fra gulvet.
 * Brytere/stikk på veggen: stikk u 1,11 / v 0,18, brytere ved døra u 3,80 / v 1,18 og 1,58, stikk u 3,79 / v 0,18.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA = path.join(ROOT, 'src/data/wall-proposals.json');
const RESEARCH = path.join(ROOT, 'research/wall-proposals-new.json');
const DRY = process.argv.includes('--dry');

const W = 3.91, H = 3.0, MID = W / 2;
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

/** Hexagon lattice cells (centres) whose whole tile lies inside the box. Same spacing as walldesigns' honeycomb. */
function hexLattice({ size, orient = 'flat-top', u0, u1, v0, v1, pad = 0.008 }) {
  const R = size / SQ3;
  const out = [];
  if (orient !== 'pointy-top') {
    const dx = 1.5 * R + pad, dy = size + pad;
    for (let q = 0; ; q++) {
      const cu = u0 + R + q * dx;
      if (cu + R > u1 + 1e-9) break;
      for (let r = -1; ; r++) {
        const cv = v0 + size / 2 + r * dy + (q % 2 ? dy / 2 : 0);
        if (cv - size / 2 < v0 - 1e-9) continue;
        if (cv + size / 2 > v1 + 1e-9) break;
        out.push({ cu, cv, q, r });
      }
    }
  } else {
    const dx = size + pad, dy = 1.5 * R + pad;
    for (let r = 0; ; r++) {
      const cv = v0 + R + r * dy;
      if (cv + R > v1 + 1e-9) break;
      for (let q = -1; ; q++) {
        const cu = u0 + size / 2 + q * dx + (r % 2 ? dx / 2 : 0);
        if (cu - size / 2 < u0 - 1e-9) continue;
        if (cu + size / 2 > u1 + 1e-9) break;
        out.push({ cu, cv, q, r });
      }
    }
  }
  return out;
}

function segDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy)));
  return { t, d: Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)) };
}

const item = (c, color, extra = {}) => ({ cu: r3(c.cu), cv: r3(c.cv), color, ...extra });
function hexElement(cells, { size, orient = 'flat-top', surface, depth, colors, alpha }) {
  const us = cells.map((c) => c.cu), vs = cells.map((c) => c.cv);
  const u0 = Math.min(...us) - size / 2, u1 = Math.max(...us) + size / 2, v0 = Math.min(...vs) - size / 2, v1 = Math.max(...vs) + size / 2;
  return { type: 'hexagons', u: r3(u0), v: r3(v0), w: r3(u1 - u0), h: r3(v1 - v0), size, depth, colors, surface, orientation: orient, items: cells, alpha };
}

// colours (felt swatches in walldesigns.js, so the editor shows their names)
const FELT = { sand: '#cbbba2', lightSand: '#c9bca6', marrakesh: '#a39584', terracotta: '#b06f55', olive: '#6b6a47', green: '#6f8a6c', sage: '#8e9a7e', warmGrey: '#7c766f', charcoal: '#3c3d3f' };
const WOOD = { oak: '#b08b62', smoked: '#5f4936', walnut: '#6b4a33', white: '#d9ccb6', black: '#2a2725' };
const ART = {
  land: ['#ece5d8', '#b9c0b0', '#7d8a6a', '#566650', '#c98f6b'],
  land2: ['#e9dfcc', '#a9b3b0', '#6f846f', '#c97f5c'],
  bot1: ['#efe8dc', '#7d8a6a', '#3a3936'],
  bot2: ['#efe8dc', '#566650', '#b8a58a'],
  bot3: ['#ece5d8', '#8c6c55', '#3a3936'],
  line: ['#f1ece2', '#2b2b2b', '#c98f6b'],
  line2: ['#efe9de', '#2b2b2b', '#a9ae94'],
  abs1: ['#e9e0d0', '#c98f6b', '#b8a58a', '#3a3936'],
  abs2: ['#ece5d8', '#7d8a6a', '#c98f6b', '#2b2b2b'],
  abs3: ['#e9dfcc', '#566650', '#d9845f', '#b8a58a'],
};

const sideboard = (o) => ({ type: 'sideboard-floating', v: 0.25, h: 0.45, d: 0.4, frontStyle: 'flat', material: 'smoked-oak', color: WOOD.smoked, alpha: 0, ...o });
const art = (u, v, w, h, motif, palette, seed, frame, o = {}) => {
  const acoustic = o.acoustic ?? false;
  return { type: 'art', u: r3(u), v: r3(v), w, h, depth: acoustic ? 0.045 : 0.025, motif, palette, frame, acoustic, seed, alpha: acoustic ? 0.86 : 0.05, ...(o.sun === false ? { sun: false } : {}) };
};
const checker = (o) => {
  const e = { type: 'checker', tile: 0.6, depth: 0.021, fill: 'slats-alternating', gap: 0.003, startOrientation: 'vertical', slatW: 0.027, slatGap: 0.013, backingColor: '#1b1b1b', alpha: 0.77, ...o };
  e.w = r3(e.cols * e.tile);
  e.h = r3(e.rows * e.tile);
  return e;
};

// ---------------------------------------------------------------------------------------------------------------
// Sekskanter

function n20() {
  const size = 0.4;
  const R = rng(2001);
  const A = [0.35, 0.72], B = [3.38, 2.62];
  const cells = [];
  for (const c of hexLattice({ size, u0: 0.12, u1: 3.62, v0: 0.42, v1: 2.94 })) {
    const { t, d } = segDist([c.cu, c.cv], A, B);
    const half = 0.16 + 0.44 * Math.sin(Math.PI * t) ** 0.8;
    const roll = R();
    if (d > half && !(d < half + 0.42 && roll < 0.2)) continue;
    const k = R();
    const color = t < 0.33 ? (k < 0.72 ? FELT.marrakesh : FELT.sand) : t < 0.7 ? (k < 0.68 ? FELT.sand : k < 0.88 ? FELT.marrakesh : FELT.terracotta) : (k < 0.62 ? FELT.sand : FELT.terracotta);
    cells.push(item(c, color));
  }
  return {
    id: 'N20', group: 'Runde 3 – sekskanter',
    name: 'Bikube i filt – diagonal flyt i Marrakesh, sand og terrakotta',
    description: 'Sekskantede akustikkpaneler i PET-filt (40 cm, 4 cm tykke) satt i et diagonalt bånd fra nisjehjørnet opp mot døra. Båndet er tettest på midten og løser seg opp i enkeltfliser i endene. Fargene går fra MARRAKESH ved TV-stua via sand til terrakotta mot kjøkkenet, så veggen binder de to rommene sammen.',
    pros: ['Leken og myk – tar opp rundingene i rommet', 'God demping per flis (filt 40 mm)', 'Fargene henter både TV-stua (Marrakesh) og stueveggen (sand)', 'Kan monteres og flyttes med dobbeltsidig tape eller små skruer'],
    cons: ['Mange fliser å sette opp nøyaktig – lag papirmal først', 'Mer uttrykk enn en rolig spilevegg', 'Filt samler noe støv – støvsug av og til'],
    products: ['Sekskantede akustikkpaneler i PET-filt, ca. 40 cm flat-til-flat, 40 mm – se tellingen i detaljene', 'Tre farger: Marrakesh-lik varmgrå, sand og terrakotta', 'Montering: lim/dobbeltsidig tape for filt eller skjulte skruer'],
    notes: 'Flate topp/bunn. Båndet går fra ca. (0,35; 0,72) til (3,38; 2,62) m, holder seg unna bryterne ved døra (u > 3,62).',
    elements: [hexElement(cells, { size, surface: 'felt', depth: 0.04, colors: [FELT.marrakesh, FELT.sand, FELT.terracotta], alpha: 0.8 })],
  };
}

function n21() {
  const size = 0.46;
  const R = rng(2101);
  const cells = [];
  const mossAt = [[1.15, 1.95], [2.75, 1.25]];
  for (const c of hexLattice({ size, u0: 0.15, u1: 3.62, v0: 0.5, v1: 2.92 })) {
    const e = ((c.cu - MID) / 1.62) ** 2 + ((c.cv - 1.68) / 0.9) ** 2 + (R() - 0.5) * 0.35;
    if (e > 1) continue;
    const moss = mossAt.some(([u, v]) => Math.hypot(c.cu - u, c.cv - v) < 0.5) || R() < 0.08;
    cells.push(moss ? item(c, '#557030', { surface: 'moss', depth: 0.042 }) : item(c, WOOD.smoked, { surface: 'smoked-oak', depth: 0.022 }));
  }
  const nMoss = cells.filter((c) => c.surface === 'moss').length;
  const alpha = r3((nMoss * 0.47 + (cells.length - nMoss) * 0.08) / cells.length);
  return {
    id: 'N21', group: 'Runde 3 – sekskanter',
    name: 'Sekskanter i røkt eik med mosefliser',
    description: 'En organisk klynge av sekskanter i røkt eik (finér på MDF, 22 mm) der noen fliser er byttet ut med preservert mose som står litt lenger ut. Røkt eik henter spisebordet og kjøkkenet, mosen gir liv og litt demping.',
    pros: ['Varmt og naturlig – tre og mose sammen', 'Røkt eik matcher bord og kjøkken', 'Mosen trenger ikke vann eller lys', 'Relieff: mosen står ut, eiken ligger flatere'],
    cons: ['Lite demping (eikeflisene er harde) – ca. +1 m² Sabine', 'Mose tåler ikke tørr luft over lang tid uten å bleke litt', 'Mange enkeltfliser å montere'],
    products: ['Sekskanter i røkt eik (finér/MDF), ca. 46 cm flat-til-flat', 'Sekskantede mosefliser (preservert ball-/flatmose) i samme størrelse', 'Monteringslim / skjulte skruer'],
    notes: 'Klyngen er midtstilt (u 0,3–3,6). Mosen samlet i to klumper: oppe til venstre og nede til høyre.',
    elements: [hexElement(cells, { size, surface: 'smoked-oak', depth: 0.022, colors: [WOOD.smoked, '#557030'], alpha })],
  };
}

function n22() {
  const size = 0.36;
  const R = rng(2201);
  const A = [0.3, 0.5];
  const cells = [];
  for (const c of hexLattice({ size, orient: 'pointy-top', u0: 0.1, u1: 3.62, v0: 0.32, v1: 2.95 })) {
    const d = Math.hypot((c.cu - A[0]) * 0.92, (c.cv - A[1]) * 1.15);
    const p = d < 0.95 ? 1 : Math.max(0, 1 - (d - 0.95) / 2.2) ** 1.7;
    if (R() > p) continue;
    const j = (R() - 0.5) * 0.35;
    const color = d + j < 0.75 ? FELT.olive : d + j < 1.45 ? FELT.green : d + j < 2.2 ? FELT.sage : FELT.sand;
    cells.push(item(c, color));
  }
  return {
    id: 'N22', group: 'Runde 3 – sekskanter',
    name: 'Sekskanter som drysser utover – grønn ombre',
    description: 'Spisse sekskanter i filt som står tett i hjørnet ved TV-stua og drysser utover veggen, mens fargen glir fra mørk oliven via grønn og salvie til sand. Et rolig «utsnitt av en eng» som tar opp grønnfargene fra stolene ved kjøkkenøya.',
    pros: ['Fargeovergangen gjør mønsteret mykt og ikke rotete', 'Demper godt der det er tettest', 'Grønt henter barkrakkene ved kjøkkenøya', 'Fritt rundt bryterne ved døra'],
    cons: ['Ujevn demping – mest i venstre del', 'Fire farger må bestilles', 'Krever nøyaktig utmåling'],
    products: ['Sekskantede filtpaneler, spiss topp, ca. 36 cm flat-til-flat, 40 mm', 'Farger: oliven, grønn, lys salvie og sand'],
    notes: 'Spiss topp (pointy-top). Tettest rundt (0,3; 0,5) m, sannsynligheten for en flis faller med avstanden.',
    elements: [hexElement(cells, { size, orient: 'pointy-top', surface: 'felt', depth: 0.04, colors: [FELT.olive, FELT.green, FELT.sage, FELT.sand], alpha: 0.8 })],
  };
}

function n23() {
  const size = 0.6;
  const R = rng(2301);
  const cells = [];
  for (const c of hexLattice({ size, u0: 0.2, u1: 3.62, v0: 0.5, v1: 2.94 })) {
    const e = ((c.cu - MID) / 1.62) ** 2 + ((c.cv - 1.72) / 1.0) ** 2 + (R() - 0.5) * 0.25;
    if (e > 1) continue;
    const wave = 0.5 + 0.5 * Math.sin(c.cu * 2.3 + c.cv * 1.6);
    const depth = wave < 0.33 ? 0.02 : wave < 0.66 ? 0.045 : 0.07;
    cells.push(item(c, FELT.lightSand, { depth }));
  }
  return {
    id: 'N23', group: 'Runde 3 – sekskanter',
    name: 'Store sekskanter i tre dybder – ton i ton',
    description: 'Store sekskanter (60 cm) i lys sandfarget filt, nesten samme farge som veggen, men i tre tykkelser: 2, 4,5 og 7 cm. Mønsteret kommer fram som skygger når spottene og sollyset treffer veggen – rolig på dagtid, skulpturelt om kvelden.',
    pros: ['Veldig rolig – passer om du ikke vil ha flere farger', 'Tykke fliser demper godt, også litt lavere frekvenser', 'Spottene over veggen gir et levende skyggespill', 'Få og store fliser – enkel montering'],
    cons: ['Kan bli for anonymt i flatt lys', 'Tre tykkelser må bestilles / bygges opp med avstandsklosser', 'Lyse filtkanter blir fort skitne ved spisebordet'],
    products: ['Sekskantede filtpaneler ca. 60 cm i lys sand – 20, 45 og 70 mm (eller 20 mm-fliser på avstandsklosser)', 'Fargen bør prøves mot SAND-veggen før bestilling'],
    notes: 'Flate topp/bunn. Dybden følger en bølge over veggen (2 / 4,5 / 7 cm).',
    elements: [hexElement(cells, { size, surface: 'felt', depth: 0.045, colors: [FELT.lightSand], alpha: 0.8 })],
  };
}

function n24() {
  const size = 0.42;
  const R = rng(2401);
  const cells = [];
  for (const c of hexLattice({ size, u0: 0.18, u1: 3.62, v0: 1.1, v1: 2.62 })) {
    if (c.cu < 0.5 && R() < 0.5) continue;
    if (c.cu > 3.3 && R() < 0.4) continue;
    const dark = R() < 0.12 + 0.5 * (c.cu / 3.6);
    cells.push(item(c, dark ? '#4b3b30' : '#b8996f'));
  }
  return {
    id: 'N24', group: 'Runde 3 – sekskanter',
    name: 'Korksekskanter over svevende skjenk',
    description: 'Et bredt bånd av sekskanter i kork over en vegghengt skjenk i røkt eik. Lys naturkork går over i mørk, varmebehandlet kork mot kjøkkenenden. Kork er varm å ta på, demper litt og tåler at stoler og hender kommer borti.',
    pros: ['Varm, naturlig overflate som tåler slitasje', 'Skjenken gir oppbevaring og en flate til lampe og pynt', 'Fargeovergangen gir bevegelse uten å bli urolig', 'Stikkontakten ved gulvet havner under skjenken'],
    cons: ['Kork demper mindre enn filt (ca. +1,1 m² Sabine)', 'Mørk kork kan oppleves tungt i kveldslys', 'Skjenken må festes godt i stendere'],
    products: ['Sekskantede korkfliser ca. 42 cm, 25 mm – natur og mørk (ekspandert) kork', 'Vegghengt skjenk ca. 220 × 40 × 45 cm i røkt eik', 'Bordlampe med opalskjerm på skjenken'],
    notes: 'Båndet ligger mellom 1,10 og 2,62 m. Skjenken henger 25 cm over gulvet (25–70 cm), u 0,86–3,06.',
    elements: [
      hexElement(cells, { size, surface: 'cork', depth: 0.025, colors: ['#b8996f', '#4b3b30'], alpha: 0.3 }),
      sideboard({ u: 0.855, w: 2.2, lamp: true }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Sjakkbrett med liten skjenk

function n25() {
  return {
    id: 'N25', group: 'Runde 3 – sjakkbrett med skjenk',
    name: 'Sjakkbrett i røkt eik over liten svart skjenk',
    description: 'Et mindre sjakkbrett i røkt eik (4 × 3 ruter à 50 cm) midt på veggen, over en kort, vegghengt skjenk i sort eik med riflede fronter. Ruteflaten blir som et stort bilde over skjenken – roligere enn sjakkbrett over hele veggen.',
    pros: ['Røkt eik passer med bord og kjøkken', 'Skjenken gir en flate til lampe og pynt', 'Mye sand-vegg rundt – rommet føles ikke tyngre', 'Rimeligere enn full vegg'],
    cons: ['Halv demping av P2 (ca. +2,3 m² Sabine)', 'Skjenken må festes i stendere', 'Bryterne ved døra er fri, men stikket ved gulvet blir synlig under skjenken'],
    products: ['Akupixel/akustikkfliser 50 × 50 cm i røkt eik med vekslende spileretning – 12 stk', 'Vegghengt skjenk ca. 140 × 40 × 45 cm, sort eik med riflet front'],
    notes: 'Sjakkbrettet u 0,96–2,96, v 1,00–2,50. Skjenken u 1,26–2,66, v 0,25–0,70.',
    elements: [
      checker({ u: 0.955, v: 1.0, cols: 4, rows: 3, tile: 0.5, colors: [WOOD.smoked, WOOD.smoked], woods: ['smoked-oak', 'smoked-oak'] }),
      sideboard({ u: 1.255, w: 1.4, doors: 3, frontStyle: 'ribbed', material: 'black-oak', color: WOOD.black, lamp: true }),
    ],
  };
}

function n26() {
  return {
    id: 'N26', group: 'Runde 3 – sjakkbrett med skjenk',
    name: 'Høyt tofarget sjakkbrett ved siden av skjenk og bilde',
    description: 'En asymmetrisk løsning: et smalt, høyt sjakkbrett (3 × 5 ruter à 45 cm) i røkt og naturell eik mot døra, og til venstre en lav skjenk med et akustikkbilde over. Sjakkbrettet trekker blikket oppover og viser fram takhøyden på 3 meter.',
    pros: ['Viser fram den høye veggen', 'To eikefarger gir et tydelig, men varmt mønster', 'Bildet over skjenken kan byttes ut over tid', 'Skjenken står ved spisebordet der den trengs'],
    cons: ['Asymmetri passer ikke alle', 'Demping ca. +3,0 m² Sabine', 'Sjakkbrettet går nær bryterne ved døra (8 cm klaring)'],
    products: ['Akustikkfliser 45 × 45 cm med spiler – 8 røkt eik + 7 naturell eik', 'Vegghengt skjenk ca. 160 × 40 × 50 cm i røkt eik, riflet front', 'Akustikkbilde ca. 80 × 100 cm i eikeramme'],
    notes: 'Sjakkbrett u 2,35–3,70, v 0,60–2,85. Skjenk u 0,30–1,90. Bildet u 0,70–1,50, v 1,15–2,15.',
    elements: [
      checker({ u: 2.35, v: 0.6, cols: 3, rows: 5, tile: 0.45, colors: [WOOD.smoked, WOOD.oak], woods: ['smoked-oak', 'oak'] }),
      sideboard({ u: 0.3, w: 1.6, h: 0.5, doors: 3, frontStyle: 'ribbed', lamp: true }),
      art(0.7, 1.15, 0.8, 1.0, 'botanical', ART.bot2, 61, 'oak', { acoustic: true }),
    ],
  };
}

function n27() {
  return {
    id: 'N27', group: 'Runde 3 – sjakkbrett med skjenk',
    name: 'Sjakkbrett i eik og olivenfilt over valnøttskjenk',
    description: 'Sjakkbrettet er her laget av to materialer: annenhver rute med eikespiler og annenhver med olivengrønn filt. Båndet (6 × 2 ruter à 60 cm) ligger øverst på veggen, over en kort vegghengt skjenk i valnøtt.',
    pros: ['Tre og tekstil gir en mykere variant av sjakkbrettet', 'Filtrutene demper litt bedre enn spilene', 'Oliven passer med grønnfargene ved kjøkkenøya', 'Skjenken gir en flate ved spisebordet'],
    cons: ['Demping ca. +3,4 m² Sabine (bare båndet)', 'To produkter som må passe sammen i tykkelse', 'Valnøtt er en fjerde tretone i rommet'],
    products: ['Akustikkfliser 60 × 60 cm med eikespiler – 6 stk', 'Akustikkfliser 60 × 60 cm i olivengrønn filt, samme tykkelse – 6 stk', 'Vegghengt skjenk ca. 160 × 40 × 42 cm i valnøtt'],
    notes: 'Båndet u 0,16–3,76, v 1,15–2,35. Skjenk u 1,16–2,76, v 0,30–0,72.',
    elements: [
      checker({ u: 0.155, v: 1.15, cols: 6, rows: 2, tile: 0.6, fill: 'wood-felt', colors: [WOOD.oak, FELT.olive], woods: ['oak', 'oak'], alpha: 0.78 }),
      sideboard({ u: 1.155, w: 1.6, v: 0.3, h: 0.42, doors: 3, material: 'walnut', color: WOOD.walnut, lamp: true }),
    ],
  };
}

function n28() {
  return {
    id: 'N28', group: 'Runde 3 – sjakkbrett med skjenk',
    name: 'Mini-sjakkbrett i valnøtt (40 cm ruter) + sort skjenk',
    description: 'Mindre ruter (40 cm) gir et finere, mer tekstilaktig mønster. Feltet (7 × 4 ruter) i valnøtt henger midt på veggen, med en kort skjenk i sort eik under. Mørk og elegant – mest «kveld» av sjakkbrettene.',
    pros: ['Små ruter gir et roligere, finere mønster', 'Valnøtt er varm og eksklusiv', 'Sort skjenk binder sammen med kjøkkenfrontene', 'God demping for feltets størrelse (ca. +3,4 m² Sabine)'],
    cons: ['Mørkt felt – trenger spottene på om kvelden', 'Flere fliser å montere (28 stk)', 'Sort eik viser støv – tørk av jevnlig'],
    products: ['Akustikkfliser 40 × 40 cm i valnøtt med vekslende spileretning – 28 stk', 'Vegghengt skjenk ca. 120 × 40 × 40 cm i sort eik'],
    notes: 'Feltet u 0,56–3,36, v 0,95–2,55. Skjenk u 1,36–2,56, v 0,30–0,70.',
    elements: [
      checker({ u: 0.555, v: 0.95, cols: 7, rows: 4, tile: 0.4, colors: [WOOD.walnut, WOOD.walnut], woods: ['walnut', 'walnut'], slatW: 0.022, slatGap: 0.01 }),
      sideboard({ u: 1.355, w: 1.2, v: 0.3, h: 0.4, doors: 2, material: 'black-oak', color: WOOD.black, lamp: true }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Flere bilder

function n29() {
  const els = [
    art(0.35, 2.15, 0.5, 0.7, 'botanical', ART.bot1, 71, 'black'),
    art(0.35, 1.45, 0.5, 0.62, 'line-art', ART.line, 72, 'oak'),
    art(0.35, 0.95, 0.5, 0.42, 'abstract-shapes', ART.abs1, 73, 'walnut'),
    art(0.93, 2.25, 0.8, 0.6, 'landscape-hills', ART.land2, 74, 'oak', { acoustic: true }),
    art(0.93, 0.95, 0.8, 1.22, 'abstract-shapes', ART.abs2, 75, 'black', { acoustic: true }),
    art(1.81, 1.6, 0.9, 1.25, 'landscape-hills', ART.land, 76, 'oak', { acoustic: true }),
    art(1.81, 0.95, 0.42, 0.57, 'botanical', ART.bot2, 77, 'black'),
    art(2.29, 0.95, 0.42, 0.57, 'line-art', ART.line2, 78, 'oak'),
    art(2.79, 2.27, 0.76, 0.58, 'abstract-shapes', ART.abs3, 79, 'walnut'),
    art(2.79, 1.6, 0.76, 0.6, 'botanical', ART.bot3, 80, 'oak'),
    art(2.79, 0.95, 0.76, 0.57, 'landscape-hills', ART.land2, 81, 'black', { sun: false }),
  ];
  return {
    id: 'N29', group: 'Runde 3 – bildevegger',
    name: 'Salongvegg til taket – 11 bilder i blandede rammer',
    description: 'En tett «salongvegg» som bruker hele høyden: elleve bilder i sort, eik og valnøtt, fra like over stolryggene (95 cm) og nesten opp til taket (2,85 m). De tre største er akustikkbilder, resten vanlige trykk med passepartout. Motivene holder seg i rommets farger – sand, grønt, terrakotta og sort strek.',
    pros: ['Personlig og levende – kan bygges ut og byttes over tid', 'Bruker takhøyden og gjør veggen til et blikkfang', 'De store akustikkbildene demper der det trengs', 'Ingen flytting av brytere eller stikk'],
    cons: ['Moderat demping (ca. +2,4 m² Sabine)', 'Krever planlegging – legg ut papirmaler på gulvet først', 'Mange festepunkter'],
    products: ['3 akustikkbilder: 80 × 60, 80 × 122 og 90 × 125 cm', '8 trykk med passepartout i rammer: 50 × 70, 50 × 62, 50 × 42, 2 × 42 × 57, 2 × 76 × 58, 76 × 60 cm', 'Rammer i sort, eik og valnøtt'],
    notes: 'Fire kolonner (u 0,35–0,85 / 0,93–1,73 / 1,81–2,71 / 2,79–3,55) med 6–8 cm mellomrom, bunnlinje 95 cm, topp 2,85 m.',
    elements: els,
  };
}

function n30() {
  const it = (cu, w, h, motif, palette, seed, frame, layer = 0, o = {}) => ({ cu, w, h, motif, palette, seed, frame, layer, ...o });
  return {
    id: 'N30', group: 'Runde 3 – bildevegger',
    name: 'To bildehyller med lente bilder',
    description: 'To smale bildehyller i røkt eik med bilder som står lent mot veggen, noen litt foran andre. Uttrykket er avslappet og lett å endre – bytt bilder etter årstid uten nye hull i veggen.',
    pros: ['Superenkelt å bytte og flytte bilder', 'Bare to monteringer i veggen', 'Røkt eik binder sammen med bordet', 'Lagdelingen gir dybde'],
    cons: ['Nesten ingen demping', 'Kan se rotete ut hvis det blir for mange ting', 'Hyllene må sitte over stolryggene (her 1,05 og 1,90 m)'],
    products: ['2 bildehyller ca. 300 × 9 cm i røkt eik med kant', '9 trykk i rammer (sort, eik, valnøtt, hvit) i størrelser fra 35 × 45 til 70 × 50 cm'],
    notes: 'Nedre hylle v 1,05, øvre v 1,90, begge u 0,45–3,45. Bildene står lent ca. 3–4° mot veggen.',
    elements: [
      { type: 'ledge', u: 0.45, v: 1.05, w: 3.0, d: 0.09, material: 'smoked-oak', color: WOOD.smoked, lip: true, alpha: 0, items: [
        it(0.8, 0.5, 0.7, 'botanical', ART.bot1, 91, 'black'),
        it(1.32, 0.42, 0.55, 'line-art', ART.line, 92, 'oak', 1),
        it(1.95, 0.7, 0.5, 'landscape-hills', ART.land, 93, 'white'),
        it(2.58, 0.4, 0.6, 'abstract-shapes', ART.abs1, 94, 'black', 1),
        it(3.1, 0.5, 0.65, 'botanical', ART.bot3, 95, 'walnut'),
      ] },
      { type: 'ledge', u: 0.45, v: 1.9, w: 3.0, d: 0.09, material: 'smoked-oak', color: WOOD.smoked, lip: true, alpha: 0, items: [
        it(0.9, 0.45, 0.55, 'abstract-shapes', ART.abs3, 96, 'oak'),
        it(1.55, 0.6, 0.8, 'landscape-hills', ART.land2, 97, 'black'),
        it(2.12, 0.35, 0.45, 'line-art', ART.line2, 98, 'white', 1),
        it(2.78, 0.55, 0.7, 'botanical', ART.bot2, 99, 'black'),
      ] },
    ],
  };
}

function n31() {
  const els = [];
  const w = 0.5, h = 0.62, g = 0.06;
  const u0 = MID - (3 * w + 2 * g) / 2, v0 = 0.86;
  const pals = [ART.bot1, ART.bot2, ART.bot3];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    els.push(art(u0 + c * (w + g), v0 + r * (h + g), w, h, 'botanical', pals[(r + c) % 3], 101 + r * 3 + c, 'oak', { acoustic: true }));
  }
  return {
    id: 'N31', group: 'Runde 3 – bildevegger',
    name: 'Rutenett 3 × 3 – botanisk serie i eikerammer',
    description: 'Ni like store akustikkbilder (50 × 62 cm) med botaniske motiver i et stramt rutenett midt på veggen, i smale eikerammer. Strengt og rolig, som en plansje-samling – og bildene demper fordi de har filt bak trykket.',
    pros: ['Ryddig og tidløst', 'Ni like formater er enkle å henge rett', 'Demper litt (ca. +2,4 m² Sabine)', 'Grønt og sand passer med resten av rommet'],
    cons: ['Lite plass til personlige bilder', 'Rutenettet må henges millimeterpresist', 'Mye vegg står fortsatt bar'],
    products: ['9 akustikkbilder 50 × 62 cm, 45 mm, botaniske motiver', 'Smale eikerammer', 'Opphengsskinne eller nivellerte kroker'],
    notes: `Rutenettet u ${(u0).toFixed(2).replace('.', ',')}–${(u0 + 3 * w + 2 * g).toFixed(2).replace('.', ',')}, v 0,86–2,84, 6 cm mellomrom.`,
    elements: els,
  };
}

function n32() {
  return {
    id: 'N32', group: 'Runde 3 – bildevegger',
    name: 'Spilevegg i røkt eik med tre innrammede bilder',
    description: 'Full spilevegg i røkt eik (0–235 cm) som i B2, men med tre sorte rammer med strektegninger hengt rett på spilene. Bildene bryter opp de lange linjene og gjør veggen mer personlig, mens spileveggen står for dempingen.',
    pros: ['Mest demping av bildeveggene (ca. +7 m² Sabine)', 'Lyse trykk lyser opp den mørke eiken', 'Bildene kan byttes uten å røre panelet', 'Røkt eik matcher bord og kjøkken'],
    cons: ['Bryterne ved døra må på påbyggsramme (som i B)', 'Bildene henger på skruer mellom spilene', 'Mørk flate på 9 m²'],
    products: ['Akupanel røkt eik på filt med lekter og Glava bak – ca. 9,2 m²', '3 trykk 60 × 80 cm med passepartout i sorte rammer', 'Påbyggsrammer for bryter/stikk'],
    notes: 'Bildene: u 0,91–1,51, 1,66–2,26 og 2,41–3,01, v 1,15–1,95, hengt på forsiden av spilene.',
    elements: [
      { type: 'slats', u: 0, v: 0, w: W, h: 2.35, slatW: 0.027, slatD: 0.012, gap: 0.013, orientation: 'vertical', wood: 'smoked-oak', slatColor: WOOD.smoked, backing: 'felt', backingColor: '#1b1b1b', standoff: 0.048, alpha: 0.76 },
      art(0.905, 1.15, 0.6, 0.8, 'line-art', ART.line, 111, 'black'),
      art(1.655, 1.15, 0.6, 0.8, 'line-art', ART.line2, 112, 'black'),
      art(2.405, 1.15, 0.6, 0.8, 'line-art', ART.line, 113, 'black'),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Nye retninger

function n33() {
  return {
    id: 'N33', group: 'Runde 3 – nye retninger',
    name: 'Panoramatapet – fjell i morgendis',
    description: 'Hele veggen tapetsert med et panoramamotiv: lag på lag med åser i dempede salvie- og grågrønne toner som blir lysere mot en disig himmel. Veggen blir et vindu ut mot landskapet og gir rommet dybde – særlig fint sett fra sofaen.',
    pros: ['Et stort uttrykk for en lav pris', 'Gir følelse av dybde og utsikt', 'Fargene passer med grønt ved kjøkkenøya og SAND', 'Ingenting stikker ut fra veggen'],
    cons: ['Ingen demping – må kombineres med teppe, gardiner eller takabsorbenter', 'Lettere å gå lei av et motiv', 'Krever nøye tapetsering (store baner)'],
    products: ['Panoramatapet ca. 390 × 300 cm, eget motiv eller ferdig landskapsmotiv i dempede grønntoner', 'Tapetlim og evt. hjelp av tapetserer'],
    notes: 'Dekker hele veggen u 0–3,91, v 0–3,00.',
    elements: [{ type: 'wallpaper', u: 0, v: 0, w: W, h: H, pattern: 'mural', colors: ['#e4e1d8', '#c6cbbf', '#a5b0a1', '#87958a', '#66746a'], sun: false, seed: 33, alpha: 0 }],
  };
}

function n34() {
  const panelColor = '#b9ac98';
  const upper = { u: 0.25, v: 1.1, w: 3.41, h: 1.8, cols: 3, gap: 0.08, profile: 0.035 };
  const bw = (upper.w - upper.gap * (upper.cols + 1)) / upper.cols, bh = upper.h - 2 * upper.gap;
  const inset = upper.profile + 0.035;
  const linen = [];
  for (let c = 0; c < upper.cols; c++) {
    linen.push({ type: 'panel', u: r3(upper.u + upper.gap + c * (bw + upper.gap) + inset), v: r3(upper.v + upper.gap + inset), w: r3(bw - 2 * inset), h: r3(bh - 2 * inset), depth: 0.03, surface: 'linen', color: panelColor, edge: 'square', frameColor: null, alpha: 0.65 });
  }
  return {
    id: 'N34', group: 'Runde 3 – nye retninger',
    name: 'Fyllingspanel i MARRAKESH med linfelt',
    description: 'Klassiske kassettlister (fyllingspanel) over hele veggen, malt i MARRAKESH som veggene i TV-stua, med en brystlist i 95 cm høyde. I de tre store feltene øverst sitter tynne, stofftrukne akustikkplater i lin i en lys Marrakesh-tone – det ser ut som innrammede stoffpaneler i en gammel bygård.',
    pros: ['Tidløst og elegant – passer med høyden på veggen', 'MARRAKESH binder stua og TV-stua sammen', 'Linfeltene demper (ca. +2,6 m² Sabine) uten å synes som «akustikk»', 'Listverk er rimelig og enkelt å male om'],
    cons: ['Mye presist snekkerarbeid med gjæringer', 'Hele veggen må males (helst halvblank på listene)', 'Mer klassisk enn resten av rommet'],
    products: ['Profilerte lister ca. 35 × 18 mm (fyllingslister) og brystlist ca. 60 mm', 'Maling: MARRAKESH (Jotun 1623), helmatt på vegg og halvblank på lister', '3 stofftrukne akustikkplater 30 mm i lin (lys Marrakesh-tone), ca. 95 × 157 cm'],
    notes: 'Nedre kassetter u 0,25–3,66, v 0,20–0,95 (over stikkontaktene). Brystlist v 0,95–1,01 over hele bredden. Øvre kassetter v 1,10–2,90.',
    wallPaint: 'marrakesh',
    wallPaintLabel: 'MARRAKESH (Jotun 1623)',
    elements: [
      { type: 'moulding', u: 0.25, v: 0.2, w: 3.41, h: 0.75, style: 'boxes', cols: 4, rows: 1, gap: 0.08, profile: 0.035, relief: 0.018, color: 'marrakesh', rail: false, alpha: 0 },
      { type: 'moulding', u: 0, v: 0.85, w: W, h: 0.1, style: 'rail', cols: 1, rows: 1, gap: 0, profile: 0.035, relief: 0.018, color: 'marrakesh', rail: true, railH: 0.06, alpha: 0 },
      { type: 'moulding', ...upper, rows: 1, relief: 0.018, style: 'boxes', color: 'marrakesh', rail: false, alpha: 0 },
      ...linen,
    ],
  };
}

function n35() {
  return {
    id: 'N35', group: 'Runde 3 – nye retninger',
    name: 'Bokvegg i eik til taket',
    description: 'En innebygd bokhylle i naturell eik fra nisjehjørnet nesten til døra og helt opp under taket, med bakvegg i MARRAKESH. Fem seksjoner og åtte hyller gir plass til bøker, vaser og bilder – og en full bokvegg sprer og demper lyden overraskende godt.',
    pros: ['Enormt med oppbevaring', 'Bøker sprer lyden og demper etterklangen (ca. +3,0 m² Sabine)', 'Gjør stua lun og personlig', 'Bakveggen i MARRAKESH gir dybde'],
    cons: ['Tar 30 cm av gulvet – ca. 87 cm igjen bak stolene ved bordet', 'Stikkontakten havner inne i hylla (flyttes eller brukes til lys)', 'De øverste hyllene trenger en liten gardintrapp'],
    products: ['Innebygd bokhylle ca. 362 × 292 × 30 cm i eik (snekker eller hyllesystem med eikefronter)', 'Maling: MARRAKESH i bakveggen', 'Evt. LED-list i underkant av hyllene'],
    notes: 'Hylla går fra u 0 (nisjehjørnet) til 3,62 (fri for bryterne ved døra), høyde 2,92 m – taket skrår ned fra veggen (2,95 m 30 cm ut).',
    elements: [{ type: 'bookcase', u: 0, v: 0, w: 3.62, h: 2.92, d: 0.3, cols: 5, rows: 8, material: 'oak', color: WOOD.oak, backColor: 'marrakesh', fill: 0.72, plinth: 0.08, seed: 35, alpha: 0.28 }],
  };
}

function n36() {
  return {
    id: 'N36', group: 'Runde 3 – nye retninger',
    name: 'Bølgevegg – spiler som bølger seg, naturell eik',
    description: 'En spilevegg der hver spile er litt tykkere eller tynnere enn naboen, slik at veggen bølger seg sakte tre ganger over bredden. Når spottene lyser ned langs veggen, kommer bølgen fram som myke skygger. Samme demping som en vanlig spilevegg.',
    pros: ['God demping (ca. +7 m² Sabine)', 'Skulpturelt og helt annerledes enn vanlige spilevegger', 'Naturell eik holder rommet lyst', 'Bølgen er subtil på dagtid og tydelig om kvelden'],
    cons: ['Må lages på mål (spiler i ulike tykkelser)', 'Dyrere enn ferdige akupaneler', 'Bryterne ved døra må på påbyggsramme'],
    products: ['Massive eikespiler 27 mm brede i tykkelser 12–82 mm, på sort filt', 'Lekter og Glava bak (48 mm)', 'Påbyggsrammer for bryter/stikk'],
    notes: 'Bølgehøyde 7 cm, bølgelengde 1,30 m (tre bølger over veggen). 0–235 cm som B.',
    elements: [{ type: 'slats', u: 0, v: 0, w: W, h: 2.35, slatW: 0.027, slatD: 0.012, gap: 0.013, orientation: 'vertical', wood: 'oak', slatColor: WOOD.oak, backing: 'felt', backingColor: '#1b1b1b', standoff: 0.048, waveAmp: 0.07, wavePeriod: 1.3, wavePhase: 0, alpha: 0.76 }],
  };
}

function n37() {
  const n = 13, cw = W / n;
  const channels = Array.from({ length: n }, (_, i) => ({ type: 'panel', u: r3(i * cw), v: 0, w: r3(cw), h: 2.35, depth: 0.06, surface: 'velvet', color: '#cbbca3', edge: 'channel', frameColor: null, alpha: 0.9 }));
  return {
    id: 'N37', group: 'Runde 3 – nye retninger',
    name: 'Kanalpolstret vegg i sandfarget fløyel med eikelist',
    description: 'Veggen polstret fra gulvet til 235 cm i vertikale kanaler (30 cm) med sandfarget fløyel, avsluttet med en smal eikelist på toppen. Som en stor sengegavl – ekstremt mykt og lunt, og den beste dempingen av alle forslagene i denne runden.',
    pros: ['Best demping i runden (ca. +8 m² Sabine)', 'Mykt og hotell-lunt', 'Sandfargen er nesten lik veggen – rolig og lyst', 'Eikelista binder til gulvet og bordet'],
    cons: ['Tekstil ved spisebordet – kan få flekker (velg avtakbart / flekkbehandlet stoff)', 'Må lages på mål av møbeltapetserer', 'Bryterne ved døra må på påbyggsramme'],
    products: ['13 polstrede kanalpaneler 30 × 235 cm, 60 mm, i sandfarget møbelfløyel', 'Eikelist 8 × 3 cm over hele bredden', 'Påbyggsrammer for bryter/stikk'],
    notes: 'Kanalene står kant i kant (u 0–3,91). Lista ligger på 2,35 m.',
    elements: [
      ...channels,
      { type: 'shelf', u: 0, v: 2.35, w: W, d: 0.08, thickness: 0.03, color: WOOD.oak, material: 'oak', decor: false, alpha: 0 },
    ],
  };
}

function n38() {
  return {
    id: 'N38', group: 'Runde 3 – nye retninger',
    name: 'Kalkmaling med terrakotta-sol over skjenken',
    description: 'Veggen kalkmalt i en varm, lys leirtone med skyet, levende overflate, og en stor halvsirkel i terrakotta-kalk som en soloppgang bak en vegghengt skjenk. Middelhavsaktig og varmt – særlig når kveldssola treffer veggen.',
    pros: ['Varmt og stemningsfullt for liten innsats', 'Kalkmaling gir en levende, matt overflate', 'Skjenken gir oppbevaring og flate til lampe', 'Kan males om når du vil'],
    cons: ['Ingen demping – kombiner med teppe/gardiner/takabsorbenter', 'Kalkmaling krever riktig grunning og teknikk', 'Terrakotta er en ny farge i rommet'],
    products: ['Kalkmaling i lys leire (ca. 7 m²) og terrakotta (ca. 2,5 m²) med grunning', 'Vegghengt skjenk ca. 220 × 40 × 45 cm i røkt eik med riflet front', 'Bordlampe på skjenken'],
    notes: 'Halvsirkelen har radius 1,2 m med flat side på 0,70 m (skjenkens topp), midt på veggen.',
    elements: [
      { type: 'paint-block', u: 0, v: 0, w: W, h: H, color: '#d4bea5', shape: 'rect', finish: 'limewash', alpha: 0 },
      { type: 'paint-block', u: r3(MID - 1.2), v: 0.7, w: 2.4, h: 1.2, color: '#b8775b', shape: 'half-circle', finish: 'limewash', alpha: 0 },
      sideboard({ u: 0.855, w: 2.2, frontStyle: 'ribbed', lamp: true }),
    ],
  };
}

function n39() {
  const green = '#5d6450';
  return {
    id: 'N39', group: 'Runde 3 – nye retninger',
    name: 'Botanisk tapet over mørkegrønt brystpanel',
    description: 'Nedre del av veggen (opp til 95 cm) malt mørk grønn med kassettlister og brystlist i samme farge, og et botanisk tapet med grener og bær i salvie, oliven og terrakotta over. Engelsk landsted møter norsk stue – grønt som henger sammen med stolene ved kjøkkenøya.',
    pros: ['Varmt og personlig', 'Brystpanelet tåler stoler og hender', 'Tapetet tar opp grønt og terrakotta fra resten av rommet', 'Rimelig i forhold til uttrykket'],
    cons: ['Ingen demping – kombiner med andre tiltak', 'Mønstret tapet passer ikke alle', 'Tapetsering rundt bryterne ved døra'],
    products: ['Botanisk tapet (ca. 8 m² + passing av mønster)', 'Fyllingslister og brystlist, malt i mørk grønn (halvblank)', 'Maling: dyp grønn på nedre del (ca. 4 m²)'],
    notes: 'Brystpanel 0–0,95 m, brystlist 0,95–1,01 m, tapet fra 1,01 m til taket.',
    elements: [
      { type: 'paint-block', u: 0, v: 0, w: W, h: 0.96, color: green, shape: 'rect', alpha: 0 },
      { type: 'moulding', u: 0.25, v: 0.2, w: 3.41, h: 0.68, style: 'boxes', cols: 4, rows: 1, gap: 0.08, profile: 0.035, relief: 0.018, color: green, rail: false, alpha: 0 },
      { type: 'moulding', u: 0, v: 0.85, w: W, h: 0.1, style: 'rail', cols: 1, rows: 1, gap: 0, profile: 0.035, relief: 0.018, color: green, rail: true, railH: 0.06, alpha: 0 },
      { type: 'wallpaper', u: 0, v: 1.01, w: W, h: r3(H - 1.01), pattern: 'botanical', colors: ['#ebe4d6', '#8e9a7e', '#566650', '#c97f5c'], scale: 1, seed: 39, alpha: 0 },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------

const ELEMENT_ALPHA = { slats: 0.76, panel: 0.94, art: 0.56, tapestry: 0.45, checker: 0.77, circles: 0.8, hexagons: 0.45, curtain: 0.45, moss: 0.47, bookcase: 0.25 };

/** Same model as design/Acoustics.js elementAbsorption. */
function absorption(el) {
  const alpha = typeof el.alpha === 'number' ? el.alpha : ELEMENT_ALPHA[el.type] ?? 0;
  if (!alpha) return 0;
  if (el.type === 'hexagons' && el.items?.length) return el.items.length * (SQ3 / 2) * el.size * el.size * alpha;
  return (el.w ?? 0) * (el.h ?? 0) * Math.max(1, el.count ?? 1) * alpha;
}

const builders = [n20, n21, n22, n23, n24, n25, n26, n27, n28, n29, n30, n31, n32, n33, n34, n35, n36, n37, n38, n39];
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const { k, baseAbsorption } = data.acousticModel;
const fresh = builders.map((fn) => {
  const p = fn();
  const sabine = Math.round(p.elements.reduce((s, e) => s + absorption(e), 0) * 10) / 10;
  return {
    id: p.id,
    code: p.id,
    name: p.name,
    group: p.group,
    priceText: 'Pris ikke beregnet',
    priceMin: null,
    priceMax: null,
    sabineAdded: sabine,
    rt60: Math.round((k / (baseAbsorption + sabine)) * 100) / 100,
    rank: null,
    recommended: false,
    badge: null,
    description: p.description,
    pros: p.pros,
    cons: p.cons,
    products: p.products,
    notes: p.notes ?? null,
    wallPaint: p.wallPaint ?? null,
    ...(p.wallPaintLabel ? { wallPaintLabel: p.wallPaintLabel } : {}),
    elements: p.elements,
    image: null,
    thumb: null,
    imageSource: null,
    drawingsSource: [],
  };
});

for (const p of fresh) {
  const hex = p.elements.find((e) => e.type === 'hexagons');
  console.log(`${p.id.padEnd(4)} ${p.name.slice(0, 64).padEnd(64)} ΔA ${String(p.sabineAdded).padStart(4)}  RT60 ${p.rt60}${hex ? `  (${hex.items.length} sekskanter)` : ''}`);
}

if (!DRY) {
  const ids = new Set(fresh.map((p) => p.id));
  data.proposals = [...data.proposals.filter((p) => !ids.has(p.id)), ...fresh];
  fs.writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  // keep the normaliser's source in step (normalize-data.mjs merges research/wall-proposals-new.json by code)
  const research = JSON.parse(fs.readFileSync(RESEARCH, 'utf8'));
  const list = Array.isArray(research) ? research : research.proposals;
  const asResearch = fresh.map(({ image, thumb, imageSource, drawingsSource, ...rest }) => ({ ...rest, image: null, drawings: [] }));
  const kept = list.filter((p) => !ids.has(String(p.code ?? p.id)));
  if (Array.isArray(research)) fs.writeFileSync(RESEARCH, `${JSON.stringify([...kept, ...asResearch], null, 2)}\n`, 'utf8');
  else fs.writeFileSync(RESEARCH, `${JSON.stringify({ ...research, proposals: [...kept, ...asResearch] }, null, 2)}\n`, 'utf8');
  console.log(`skrev ${fresh.length} forslag → ${path.relative(ROOT, DATA)} (${data.proposals.length} totalt) og ${path.relative(ROOT, RESEARCH)}`);
}
