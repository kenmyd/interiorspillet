/**
 * «Spesialkatalog» (the owner's own pick, 2026-10-29): writes
 *   research/catalog-new/spesialkatalog.json  – the products (normalised into src/data/catalog/* by normalize-data.mjs)
 *   src/data/spesialkatalog.json              – { ids } in the order the panel shows them
 *   src/data/bundledImages.js                 – the canvas motifs under public/img/spesial/ as bundled pictures
 * Run: node tools/build-spesialkatalog.mjs && node src/data/scripts/normalize-data.mjs --only=catalog
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes, sniffMime, imageSize } from '../src/design/ImageStore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKED = '2026-10-29';

// ---- lenestoler ------------------------------------------------------------------------------------------------
const regal = {
  id: 'hjort-knudsen-regal-lenestol-fothviler',
  category: 'lenestol', subcategory: 'hvilestol',
  name: 'Regal lenestol med integrert fothviler',
  brand: 'Hjort Knudsen', store: 'Møbelringen',
  url: 'https://www.mobelringen.no/search?q=Regal+lenestol',
  priceNok: 22999, salePriceNok: 10999,
  priceNote: `Fra skjermbildet til eieren ${CHECKED}: 10 999 kr (førpris 22 999 kr, -52 %), tilbudet gjelder t.o.m. 30.11.2026. Ikke på lager i nettbutikken, kan bestilles i butikk (klikk og hent). Butikk: Møbelringen (oppgitt av eieren) – lenken er et søk i nettbutikken. Fargen Lodge hazel er målt i produktbildet (snitt #4b2e22).`,
  dims: { w: 0.8, d: 0.88, h: 1.1 },
  archetype: 'recliner', mount: 'floor',
  params: {
    seatH: 0.46, seatD: 0.5, backH: 1.1, armH: 0.6, armW: 0.16, armTuck: 0.03, legStyle: 'swivel-star', legH: 0.15,
    backShape: 'high', cushion: 'tight', body: 'box', sides: 'fabric', headStyle: 'integrated', backSeams: 'cross',
    footrest: 'integrated', footrestOpen: false, star: 'spider', starArms: 5, lever: false, footstool: false, headrest: true,
    armStyle: 'petal', armFlare: 0.07, armLip: 0.04, armTopR: 0.06, armBottom: 0.19, armFrontR: 0.18, armRearR: 0.08,
    armFrontTopR: 0.1, seatNose: 0, backW: 0.5, backTopR: 0.07, starR: 0.36, footTaper: 0.95, footR: 0.08, footBottom: 0.18,
    basePlate: 0.12, armSplay: 0.03, starBend: 1, starBar: 0.012, starHub: 0.13, armFlarePow: 0.5, armWelt: 'edge', backPuff: 0.04,
    notes: 'Høy hvilestol i bouclé (Lodge) med integrert fothviler som felles ut fra setefronten. Ryggen er delt i to polstrede felt med en tverrsøm, øverste felt er nakkestøtten. Brede, avrundede armlener som buer utover og smalner mot foten. Polaris-sokkel: tynn, svart femarmet stjernefot med søyle og sving. Mål anslått fra bildet (ikke bekreftet).',
  },
  variants: [
    { name: 'Tekstil Lodge hazel, Polaris sort sokkel', colors: { upholstery: '#4b2e22', legs: '#1c1c1c' }, materials: { upholstery: 'boucle', legs: 'black-metal' } },
    { name: 'Tekstil Lodge hunter, Polaris sort sokkel', colors: { upholstery: '#454b45', legs: '#1c1c1c' }, materials: { upholstery: 'boucle', legs: 'black-metal' } },
  ],
  defaultVariant: 0, absorption: 0.5,
  description: 'Høy hvilestol fra Hjort Knudsen med integrert fothviler, kraftig bouclé (Lodge) og svart Polaris svingfot.',
  why: 'Lodge hazel gjentar de varme rustbrune tonene i akustikkbildene, Lodge hunter gir en mørk grønn kontrast.',
  imageUrl: '',
  verified: false,
  verifiedNote: `Fra eierens skjermbilde ${CHECKED}. Fant ikke produktsiden i norske nettbutikker (Bohus, Skeidar, Fagmøbler, Møbelringen sjekket); mål og butikk er anslått.`,
  priceConfidence: 'check',
  shapeNote: 'Mål anslått fra produktbildet.',
};

const timeout = {
  id: 'bohus-conform-timeout-large-nanda-umber-fotskammel',
  category: 'lenestol', subcategory: 'hvilestol',
  name: 'Timeout hvilestol large med fotskammel, Nanda 65 Umber',
  brand: 'Conform', store: 'Bohus',
  url: 'https://www.bohus.no/stoler/lenestol/hvilestol/timeout-hvilestol-large-1',
  priceNok: 38198, salePriceNok: 30558,
  priceNote: `Pris sjekket ${CHECKED} på bohus.no: stolen (varenr. 318067) 24 879 kr (før 31 099) og fotskammelen large med pikering (varenr. 318068, bohus.no/timeout-fotskammel-large-1) 5 679 kr (før 7 099), til sammen 30 558 kr (før 38 198). 20 % rabatt på Timeout i Nanda og fåreskinn. Kjøpes hver for seg.`,
  dims: { w: 0.84, d: 0.89, h: 1.14 },
  archetype: 'recliner', mount: 'floor',
  params: {
    seatH: 0.42, seatD: 0.52, backH: 1.14, armH: 0.56, armW: 0.14, legStyle: 'swivel-star', legH: 0.16, backShape: 'high',
    cushion: 'loose', footstool: true, headrest: true, body: 'shell', headStyle: 'roll', stoolW: 0.51, stoolD: 0.38, stoolH: 0.39,
    armPad: 'lid', shellTaper: 0.62, shellBottom: 0.18, seatT: 0.15, seatNose: 0.03, backW: 0.5, backFlare: 0,
    shellFront: 0.35, backSeams: 'tufted', tuftCols: 3, tuftRows: 3, armStraight: 1, armDrop: 0.012, armPadH: 0.065, headW: 0.6, armTilt: 0, armCurl: 0, shellDisc: 0.05, starArms: 4,
    notes: 'Large-utgaven av Timeout: skall i svart eik, sete og rygg med pikering i Nanda 65 Umber (brun, nuppete tweed), regulerbar rygg, quattro svingfot i svart aluminium (4 armer). Fotskammelen large (51 × 38 × 39 cm) har samme stoff, svart skrog og x-fot quattro. Stolens mål er Large-målene (84 × 89 × 114 cm, ikke i tabell på Bohus-siden).',
  },
  variants: [
    { name: 'Nanda 65 Umber med pikering, skrog svart eik, quattro svart aluminium', colors: { upholstery: '#4a362c', legs: '#1a1a1a', frame: '#1e1b19' }, materials: { upholstery: 'tweed', legs: 'black-metal', frame: 'black-oak' } },
  ],
  defaultVariant: 0, absorption: 0.6,
  description: 'Conform Timeout large med svart eikeskall, pikert sete og rygg i Nanda 65 Umber og matchende fotskammel med pikering.',
  why: 'Den mørke umbra-tweeden og det svarte skallet passer til de brune akustikkbildene og en mørk BESTÅ-benk.',
  imageUrl: 'https://www.bohus.no/pimcorecdn/Leverand%C3%B8rer/Conform%20Collection%20AB/Produkter/TIMEOUT/348109/image-thumb__348109__PDP-Product/318067%20-%20Timeout%20Svart%20hvilestol%20large%20med%20pikering%20Nanda%2065%20Umber%20svingfot%20quattro%20svart%20aluminium%20-%201.4a179343.jpg',
  verified: true,
  verifiedNote: `Sjekket ${CHECKED} på bohus.no: navn, varenr., priser og fotskammelens mål. Stolens mål er Large-målene (ikke i tabell på siden).`,
  priceConfidence: 'checked',
  shapeNote: 'Formen rettet 2026-10-29 etter eierens bilder: skallet slutter rett over armene bak (ryggen er stoppet helt ned bak), seteputa er tykk og står ut over skallets lave framkant, som faller bratt under armen. Rette, parallelle armlener med flat overside (armStraight). Pikering 3 × 3 knapper i ryggen. Stoffet er melert tweed (mørk sjokoladebrun bunn med kobberfargede nupper) etter eierens bilde av den ekte fotskammelen; fargen #4a362c er snittet.',
};

// ---- TV-benker -------------------------------------------------------------------------------------------------
const ikea = (slug) => `https://www.ikea.com/no/no/p/${slug}/`;
const bestaV = (name, front, frontMat, url, priceNok, salePriceNok, over) => ({
  name, colors: { body: '#2b2421', front, top: '#2b2421', legs: '#2b2421', handle: front },
  materials: { body: 'black-oak', front: frontMat, top: 'black-oak', legs: 'black-oak', handle: frontMat },
  priceNok, salePriceNok, url, ...(over ? { paramsOverride: over } : {}),
});
const bestaParams = (n) => ({
  base: 'none', legH: 0, legStyle: 'block', fronts: Array(n).fill('door'), frontStyle: 'flat', handle: 'none', top: 'same', corners: 'square',
  notes: 'Står rett på gulvet (ben eller veggopphenging kjøpes separat); grepsfrie dører med trykk-og-åpne-hengsler.',
});
const besta180 = {
  id: 'ikea-besta-tv-benk-dorer-180-mork', category: 'tvbenk', name: 'BESTÅ TV-benk med dører 180x42x38 – mørke farger',
  brand: 'IKEA', store: 'IKEA', url: ikea('besta-tv-benk-med-dorer-brunsvart-hedeviken-brunbeiset-eikefiner-s39622908'),
  priceNok: 3595, salePriceNok: 3195,
  priceNote: `Priser sjekket ${CHECKED} på ikea.com/no («Ny lavere pris»), per variant. Ben eller veggopphenging kjøpes separat.`,
  dims: { w: 1.8, d: 0.42, h: 0.38 }, archetype: 'tv-bench', mount: 'floor', params: bestaParams(3),
  variants: [
    bestaV('Brunsvart / Hedeviken brunbeiset eikefiner', '#5a4232', 'smoked-oak', ikea('besta-tv-benk-med-dorer-brunsvart-hedeviken-brunbeiset-eikefiner-s39622908'), 3595, 3195),
    bestaV('Brunsvart / Björköviken brun beiset eikefiner', '#5a4232', 'smoked-oak', ikea('besta-tv-benk-med-dorer-brunsvart-bjoerkoeviken-brun-beiset-eikefiner-s69422187'), 3745, 3345, { frontStyle: 'ribbed' }),
    bestaV('Brunsvart / Lappviken brunsvart', '#2e2925', 'painted', ikea('besta-tv-benk-m-dorer-brunsvart-lappviken-brunsvart-s79330663'), 2995, 2445),
    bestaV('Brunsvart / Lappviken brun valnøttmønstret', '#5c4030', 'walnut', ikea('besta-tv-benk-med-dorer-brunsvart-lappviken-brun-valnottmonstret-s09612171'), 2995, 2445),
    bestaV('Brunsvart / Timmerviken svart', '#1f1f1f', 'black-oak', ikea('besta-tv-benk-m-dorer-brunsvart-timmerviken-svart-s39330679'), 3295, 2595),
    bestaV('Brunsvart / Glassvik røkfarget glass', '#3a3632', 'glass-smoked', ikea('besta-tv-benk-m-dorer-brunsvart-glassvik-rokfarget-glass-s99330657'), 3595, 3195, { fronts: ['glass', 'glass', 'glass'] }),
  ],
  defaultVariant: 0, absorption: 0.02,
  description: 'BESTÅ TV-benk 180 cm med tre grepsfrie dører i mørke farger: brunbeiset eik (Hedeviken, Björköviken), brunsvart, valnøtt, svart eller røkfarget glass.',
  why: 'En mørk, lav benk under TV-en gjør veggen rolig og lar akustikkbildene og lenestolene ta oppmerksomheten.',
  imageUrl: 'https://www.ikea.com/no/no/images/products/besta-tv-benk-med-dorer-brunsvart-hedeviken-brunbeiset-eikefiner__1531465_pe1015646_s5.jpg',
  verified: true, verifiedNote: `Varianter og priser sjekket ${CHECKED} på ikea.com/no.`, priceConfidence: 'checked',
};
const besta240 = {
  ...besta180,
  id: 'ikea-besta-tv-benk-dorer-240-mork', name: 'BESTÅ TV-benk med dører 240x42x38 – mørke farger',
  url: ikea('besta-tv-benk-med-dorer-brunsvart-lappviken-brunsvart-s09603572'), priceNok: 4985, salePriceNok: 4085,
  dims: { w: 2.4, d: 0.42, h: 0.38 }, params: bestaParams(4),
  variants: [
    bestaV('Brunsvart / Lappviken brunsvart', '#2e2925', 'painted', ikea('besta-tv-benk-med-dorer-brunsvart-lappviken-brunsvart-s09603572'), 4985, 4085),
    bestaV('Brunsvart / Lappviken brun valnøttmønstret', '#5c4030', 'walnut', ikea('besta-tv-benk-med-dorer-brunsvart-lappviken-brun-valnottmonstret-s39612155'), 4985, 4085),
    bestaV('Brunsvart / Krukmakare mørk grågrønn', '#4b5a50', 'painted', ikea('besta-tv-benk-med-dorer-brunsvart-krukmakare-mork-gragronn-s79612163'), 5585, 4885),
  ],
  description: 'BESTÅ TV-benk 240 cm med fire grepsfrie dører i mørke farger: brunsvart, valnøtt eller mørk grågrønn (Krukmakare).',
  imageUrl: 'https://www.ikea.com/no/no/images/products/besta-tv-benk-med-dorer-brunsvart-lappviken-brunsvart__1420623_pe977289_s5.jpg',
  verifiedNote: `Varianter og priser sjekket ${CHECKED} på ikea.com/no. 240 cm fant vi bare med Lappviken- og Krukmakare-dører (ikke Hedeviken, Björköviken eller Timmerviken).`,
};
const eket = {
  id: 'ikea-eket-medieoppbevaring-210-valnott', category: 'tvbenk', name: 'EKET medieoppbevaring 210x35x35, brun valnøttmønstret',
  brand: 'IKEA', store: 'IKEA', url: ikea('eket-medieoppbevaring-kombinasjon-brun-valnottmonstret-s69580983'), priceNok: 3585,
  priceNote: `Pris sjekket ${CHECKED} på ikea.com/no: 3 585 kr (ikke på tilbud). Kan veggmonteres eller stå på ben.`,
  dims: { w: 2.1, d: 0.35, h: 0.35 }, archetype: 'tv-bench', mount: 'floor',
  params: {
    base: 'none', legH: 0, legStyle: 'block', fronts: ['drawers:2', 'open', 'drawers:2'], frontStyle: 'flat', handle: 'none', top: 'same', corners: 'square',
    notes: 'Tre skap à 70 cm: to skuffer til venstre, åpen hylle i midten (med kabelhull), to skuffer til høyre. Grepsfrie fronter.',
  },
  variants: [{ name: 'Brun valnøttmønstret', colors: { body: '#5c3f2b', front: '#5c3f2b', top: '#5c3f2b', legs: '#5c3f2b', handle: '#5c3f2b' }, materials: { body: 'walnut', front: 'walnut', top: 'walnut', legs: 'walnut', handle: 'walnut' } }],
  defaultVariant: 0, absorption: 0.02,
  description: 'Lang og lav EKET-kombinasjon i brun valnøttmønstret: skuffer på sidene og en åpen hylle i midten for TV-boks og høyttaler.',
  why: 'Valnøtten gir varme under TV-en og matcher Lodge hazel og de brune bildene; kan henges på veggen så gulvet blir fritt.',
  imageUrl: 'https://www.ikea.com/no/no/images/products/eket-medieoppbevaring-kombinasjon-brun-valnottmonstret__1389132_pe965106_s5.jpg',
  verified: true, verifiedNote: `Navn, mål og pris sjekket ${CHECKED} på ikea.com/no; skuffeoppsettet er tatt fra produktbildet.`, priceConfidence: 'checked',
};

// ---- lamper ----------------------------------------------------------------------------------------------------
const turnerBord = {
  id: 'bohus-sindig-turner-bordlampe-h42', category: 'smalamper', subcategory: 'bordlampe', name: 'Turner bordlampe H42',
  brand: 'Sindig', store: 'Bohus', url: 'https://www.bohus.no/lamper/bordlampe/turner-bordlampe-h42', priceNok: 1599,
  priceNote: `Pris sjekket ${CHECKED} på bohus.no (varenr. 320639): 1 599 kr. E27, pære følger ikke med.`,
  dims: { w: 0.32, d: 0.15, h: 0.42 }, archetype: 'table-shade', mount: 'surface',
  params: { shadeShape: 'rect', shadeD: 0.32, shadeH: 0.15, shadeDepth: 0.15, baseShape: 'rect', baseD: 0.24, baseH: 0.03, translucent: 0.55 },
  variants: [{ name: 'Svart/natur', colors: { shade: '#ddd2bf', inner: '#ddd2bf', base: '#1c1c1c', metal: '#1c1c1c', cord: '#1a1a1a' }, materials: { shade: 'linen', inner: 'linen', base: 'black-metal', metal: 'black-metal', cord: 'cotton' } }],
  defaultVariant: 0, absorption: 0.02,
  light: { lumens: 470, colorK: 2700, dimmable: false, kind: 'table', bulb: 'E27 LED ca. 470 lm (anbefalt, ikke inkludert)' },
  description: 'Bordlampe med to tynne, svarte stenger på en rektangulær svart fot og en avlang tekstilskjerm i naturfarge – lillesøster til Turner gulvlampe.',
  why: 'Samme uttrykk som Turner gulvlampe; passer på EKET eller BESTÅ ved TV-en.',
  imageUrl: 'https://www.bohus.no/pimcorecdn/Leverand%C3%B8rer/K%26A%20International/Produkter/TURNER/603053/image-thumb__603053__PDP-Product/320639%20-%20Turner%20bordlampe%20H42%20E27%20metall%20svart-natur%20inkl.%20skjerm%20-%206.d2b99e63.jpg',
  verified: true, verifiedNote: `Navn, varenr., høyde og pris sjekket ${CHECKED} på bohus.no; bredde og skjermmål er anslått fra bildet.`, priceConfidence: 'checked',
  shapeNote: 'De to stengene er tegnet som én fot; skjermmålene er anslått.',
};
const double = {
  id: 'bohus-sindig-double-leselampe-gulv-h137', category: 'smalamper', subcategory: 'gulvlampe', name: 'Double leselampe gulv H137',
  brand: 'Sindig', store: 'Bohus', url: 'https://www.bohus.no/double-gulvlampe-h137', priceNok: 1999,
  priceNote: `Pris sjekket ${CHECKED} på bohus.no (varenr. 234856): 1 999 kr. Siden har valget «Lampeskjerm» – sjekk om den grå-beige skjermen er med i prisen.`,
  dims: { w: 0.4, d: 0.4, h: 1.37 }, archetype: 'floor-pole-shade', mount: 'floor',
  params: { shadeShape: 'drum', shadeD: 0.4, shadeTopD: 0.34, shadeH: 0.27, baseShape: 'disc', baseD: 0.28, baseH: 0.03, poleCount: 1, poleD: 0.02, translucent: 0.4 },
  variants: [{ name: 'Svart med grå-beige skjerm', colors: { shade: '#b9afa2', inner: '#d8d0c4', base: '#1c1c1c', metal: '#1c1c1c', cord: '#1a1a1a' }, materials: { shade: 'linen', inner: 'linen', base: 'black-metal', metal: 'black-metal', cord: 'cotton' } }],
  defaultVariant: 0, absorption: 0.04,
  light: { lumens: 806, colorK: 2700, dimmable: false, kind: 'floor', bulb: 'E27 LED ca. 806 lm + liten leselampe (anbefalt, ikke inkludert)' },
  description: 'Svart gulvlampe med konisk tekstilskjerm i grå-beige og en liten, svart lesespot på svingarm.',
  why: 'Gir både stemningslys og leselys ved lenestolen.',
  imageUrl: 'https://www.bohus.no/pimcorecdn/Leverand%C3%B8rer/K%26A%20International/Produkter/DOUBLE/277138/image-thumb__277138__PDP-Environment/234856%20-%20Double%20gulvlampe%20H137%20E27%20metall%20svart%20-%201.3fc57441.jpg',
  verified: true, verifiedNote: `Navn, varenr., høyde og pris sjekket ${CHECKED} på bohus.no; skjermmål anslått fra bildet.`, priceConfidence: 'checked',
  shapeNote: 'Lesespoten på svingarmen er ikke modellert.',
};
const TURNER_GULV = 'bohus-sindig-turner-gulvlampe-h147';

// ---- akustikkbilder fra canvasbutik.no -------------------------------------------------------------------------
// [short side, long side, list price, sale price] (m, kr) – the same for every motif
const SIZES = [[0.5, 0.7, 3000, 1999], [0.7, 1.0, 3499, 2498], [0.8, 1.2, 4499, 3498], [1.0, 1.5, 6999, 5998], [1.2, 1.8, 8999, 7998]];
const MOTIFS = [
  ['soft-leaves', 'Soft Leaves'], ['dual-profile', 'Dual Profile'], ['earth-leaves', 'Earth Leaves'], ['when-we-break', 'When We Break'],
  ['the-heat-between', 'The Heat Between'], ['abstract-oval', 'Abstract Oval'], ['brown-balance', 'Brown Balance'],
  ['circles-in-brown', 'Circles In Brown'], ['brown-forms', 'Brown Forms'], ['brown-circles', 'Brown Circles'], ['brown-shapes', 'Brown Shapes'],
  ['abstract-in-brown', 'Abstract In Brown'], ['brown-layers', 'Brown Layers'], ['amber-flow', 'Amber Flow'], ['ethereal-strata', 'Ethereal Strata'],
  ['framed-stillness', 'Framed Stillness'], ['timeless-peaks', 'Timeless Peaks'],
];
const DEPTH = 0.055;
const DEFAULT_SIZE = 2; // 80 × 120
const sabine = (d) => Math.round(d.w * d.h * 0.95 * 100) / 100; // α ≈ 1,0 at 500–2000 Hz, a little edge loss
const bundled = {};
const art = MOTIFS.map(([slug, title]) => {
  const file = `img/spesial/${slug}.jpg`;
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'public', file)));
  const mime = sniffMime(bytes);
  const { w, h } = imageSize(bytes, mime);
  const id = hashBytes(bytes);
  bundled[id] = { url: file, mime, w, h, name: `${title} (canvasbutik.no)` };
  const land = w > h;
  const dims = ([a, b]) => (land ? { w: b, d: DEPTH, h: a } : { w: a, d: DEPTH, h: b });
  const cm = (s) => (land ? `${Math.round(s[1] * 100)} × ${Math.round(s[0] * 100)} cm` : `${Math.round(s[0] * 100)} × ${Math.round(s[1] * 100)} cm`);
  return {
    id: `canvasbutik-lyddempende-bilde-${slug}`, category: 'akustikk', subcategory: 'akustikkbilde',
    name: `Lyddempende bilde – ${title}`, brand: 'Canvasbutik', store: 'canvasbutik.no',
    url: `https://canvasbutik.no/products/lyddempende-bilde-${slug}`,
    priceNok: SIZES[DEFAULT_SIZE][2], salePriceNok: SIZES[DEFAULT_SIZE][3],
    priceNote: `Pris sjekket ${CHECKED} på canvasbutik.no (salg, samme pris for alle motiver): 50×70 1 999 (før 3 000), 70×100 2 498 (før 3 499), 80×120 3 498 (før 4 499), 100×150 5 998 (før 6 999), 120×180 7 998 (før 8 999). Valgfri eikeramme koster ekstra.`,
    dims: dims(SIZES[DEFAULT_SIZE]), archetype: 'acoustic-art', mount: 'wall',
    params: { thickness: DEPTH, motif: 'custom', imageId: id, imageAspect: w / h, fit: 'cover' },
    variants: SIZES.map((s) => ({
      name: cm(s),
      colors: { panel: '#8c7a68', slats: '#8c7a68', backing: '#545049', frame: '#eceae4' },
      materials: { panel: 'woven', slats: 'woven', backing: 'felt', frame: 'woven' },
      priceNok: s[2], salePriceNok: s[3], dims: dims(s), absorption: sabine(dims(s)),
    })),
    defaultVariant: DEFAULT_SIZE,
    absorption: sabine(dims(SIZES[DEFAULT_SIZE])),
    description: `Lyddempende canvasbilde «${title}» i brune og beige toner: 35 mm glassullplate bak lydåpent lerret, 55 mm dypt. Klasse B (αw 0,80), α 1,0 ved 500–2000 Hz.`,
    why: 'Kunst og demping i ett – de varme brune tonene passer til Lodge hazel, Timeout Umber og valnøtt.',
    imageUrl: '',
    verified: true,
    verifiedNote: `Motiv, størrelser, priser og lydmåling (ISO 354 / 11654) sjekket ${CHECKED} på canvasbutik.no. Motivbildet ligger i spillet (public/${file}).`,
    priceConfidence: 'checked',
  };
});

const products = [regal, timeout, besta180, besta240, eket, turnerBord, double, ...art];
fs.writeFileSync(path.join(ROOT, 'research/catalog-new/spesialkatalog.json'), `${JSON.stringify(products, null, 2)}\n`);
const ids = [regal.id, timeout.id, besta180.id, besta240.id, eket.id, ...art.map((p) => p.id), turnerBord.id, TURNER_GULV, double.id];
fs.writeFileSync(path.join(ROOT, 'src/data/spesialkatalog.json'), `${JSON.stringify({ ids }, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, 'src/data/bundledImages.js'), `/**
 * Pictures that ship with the game (generated by tools/build-spesialkatalog.mjs – do not edit by hand): picture id
 * (design/ImageStore.js hashBytes of the file) → { url (relative, under public/), mime, w, h, name }. ImageStore fetches
 * one of these when no backend has the id, so catalogue products can carry params.imageId.
 */
export const BUNDLED_IMAGES = Object.freeze(${JSON.stringify(bundled, null, 2)});
`);
console.log(`${products.length} products, ${ids.length} ids, ${Object.keys(bundled).length} pictures`);
