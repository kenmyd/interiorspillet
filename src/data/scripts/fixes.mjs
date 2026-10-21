#!/usr/bin/env node
/**
 * Data fixes on top of the research files (fix-core r1). Idempotent: applying them twice gives the same result.
 *
 *   node src/data/scripts/fixes.mjs --apply      applies them to src/data/room-spec.json and src/data/catalog/*.json
 *   node src/data/scripts/fixes.mjs --apply --only=catalog      only the catalogue (room-spec.json untouched)
 *   normalize-data.mjs calls fixRoomSpec() / fixCatalog() itself, so re-running the normaliser keeps them.
 *
 * room-spec: colours/materials of existing items checked against the photos, and the tabletop / shelf decor that the
 *            photos show (jute mats, candlesticks, tealight globes, candles in glass, shelf plants and vases), the
 *            chandelier's shade sizes and the lamp lumens of add-lighting (builtInLights + chandelier).
 * catalog:   variant prices from the price notes (priceNok / salePriceNok per variant; a variant with its own
 *            priceNok and no salePriceNok is not on sale), one rule for campaign prices (below), priceConfidence,
 *            cushion covers' required inner cushion, pack sizes, fixed freight, slat panels' direct-mount absorption,
 *            names without one variant's colour (Norwegian, comma decimals), brands,
 *            default variants that match the product photo, misleading stock photos removed.
 *
 * Campaign rule: priceNok = the ordinary price, salePriceNok = the campaign price whenever the store showed one (product
 * page or category list). priceConfidence: 'checked' (the price paid was read on the product page), 'check' (it comes
 * from a category list / search result / price site, or the note says «sjekk» – the UI says «sjekk prisen ved kjøp»),
 * 'estimate' (calculated or estimated – the UI shows «ca.»). A variant may override priceConfidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------------------------
// room-spec

const note = (s) => `${s} (pynt fra bildene)`;
const DECOR = [
  // the large nesting table (top y 0.47): round jute mat with two black candlesticks and sage-green taper candles
  { id: 'f-pynt-jutematte-stor', name: 'Rund jutematte (stort settbord)', kind: 'rug', archetype: 'rug', position: [5.66, 0.47, 10.05], dims: { w: 0.4, d: 0.4, h: 0.006 }, params: { shape: 'round', pile: 'flat', weave: 'braided', pattern: 'solid' }, colors: { main: '#b39d78' }, materials: { main: 'linen' }, notes: note('Flettet jutematte på det store bordet (082827, 082829).') },
  { id: 'f-pynt-lysestake-1', name: 'Høy sort lysestake med salviegrønt kronelys', kind: 'candle', archetype: 'candle-holder', position: [5.68, 0.476, 9.97], dims: { w: 0.07, d: 0.07, h: 0.3 }, params: { kind: 'candlestick', lit: false, candleColor: '#a9b89a', candleH: 0.24, baseD: 0.07 }, colors: { main: '#1a1a1a' }, materials: { main: 'black-metal' }, notes: note('To sorte lysestaker på jutematta (082827).') },
  { id: 'f-pynt-lysestake-2', name: 'Lav sort lysestake med salviegrønt kronelys', kind: 'candle', archetype: 'candle-holder', position: [5.66, 0.476, 10.1], dims: { w: 0.07, d: 0.07, h: 0.22 }, params: { kind: 'candlestick', lit: false, candleColor: '#a9b89a', candleH: 0.24, baseD: 0.07 }, colors: { main: '#1a1a1a' }, materials: { main: 'black-metal' }, notes: note('To sorte lysestaker på jutematta (082827).') },
  // the small nesting table (top y 0.42, the part that sticks out): jute mat, two sage tealight glasses, round box
  { id: 'f-pynt-jutematte-liten', name: 'Rund jutematte (lite settbord)', kind: 'rug', archetype: 'rug', position: [4.92, 0.42, 10.06], dims: { w: 0.3, d: 0.3, h: 0.006 }, params: { shape: 'round', pile: 'flat', weave: 'braided', pattern: 'solid' }, colors: { main: '#b39d78' }, materials: { main: 'linen' }, notes: note('Jutematte på det lille bordet (082827).') },
  { id: 'f-pynt-telys-settbord', name: 'To salviegrønne telysglass', kind: 'candle', archetype: 'candle-holder', position: [4.9, 0.426, 10.02], dims: { w: 0.16, d: 0.07, h: 0.07 }, params: { kind: 'tealight', count: 2, spacing: 0.08, lit: false }, colors: { main: '#93a68e' }, materials: { main: 'glass-smoked' }, notes: note('Små grønne glass på det lille bordet (082827, 082819).') },
  { id: 'f-pynt-treboks', name: 'Rund treboks med rosa lokk', kind: 'decor', archetype: 'basket', position: [4.98, 0.426, 10.14], dims: { w: 0.09, d: 0.09, h: 0.05 }, params: { shape: 'cylinder', weave: 'none' }, colors: { main: '#b08d62', lid: '#d8a7a4' }, materials: { main: 'oak' }, notes: note('Liten rund boks på det lille bordet (082827).') },
  // TV coffee table (top y 0.445): two clear tealight globes and three small candles in glass (amber, sage, cream)
  { id: 'f-pynt-glasskule-1', name: 'Klar glasskule for telys', kind: 'decor', archetype: 'vase', position: [1.76, 0.445, 9.74], dims: { w: 0.1, d: 0.1, h: 0.1 }, params: { shape: 'bubble' }, colors: { main: '#e9efee' }, materials: { main: 'glass-clear' }, notes: note('To klare glasskuler på sofabordet (082736, 082726).') },
  { id: 'f-pynt-glasskule-2', name: 'Klar glasskule for telys', kind: 'decor', archetype: 'vase', position: [1.85, 0.445, 9.7], dims: { w: 0.09, d: 0.09, h: 0.09 }, params: { shape: 'bubble' }, colors: { main: '#e9efee' }, materials: { main: 'glass-clear' }, notes: note('To klare glasskuler på sofabordet (082736, 082726).') },
  { id: 'f-pynt-lys-rav', name: 'Lys i ravfarget glass', kind: 'candle', archetype: 'candle-holder', position: [2.05, 0.445, 9.86], dims: { w: 0.07, d: 0.07, h: 0.08 }, params: { kind: 'tealight', count: 1, lit: false }, colors: { main: '#a8743c' }, materials: { main: 'glass-smoked' }, notes: note('Tre små lys i glass (rav, salvie, krem) på sofabordet (082736).') },
  { id: 'f-pynt-lys-salvie', name: 'Lys i salviegrønt glass', kind: 'candle', archetype: 'candle-holder', position: [2.12, 0.445, 9.79], dims: { w: 0.07, d: 0.07, h: 0.07 }, params: { kind: 'tealight', count: 1, lit: false }, colors: { main: '#93a488' }, materials: { main: 'glass-smoked' }, notes: note('Tre små lys i glass (rav, salvie, krem) på sofabordet (082736).') },
  { id: 'f-pynt-lys-krem', name: 'Lys i kremfarget glass', kind: 'candle', archetype: 'candle-holder', position: [2.1, 0.445, 9.93], dims: { w: 0.07, d: 0.07, h: 0.06 }, params: { kind: 'tealight', count: 1, lit: false }, colors: { main: '#ece4d6' }, materials: { main: 'glass-opal' }, notes: note('Tre små lys i glass (rav, salvie, krem) på sofabordet (082736).') },
  // the black wall shelf over the sofa (boards: top y 1.822 x 1.37–1.84, right y 1.662 x 1.77–2.22, middle y 1.532
  // x 1.37–1.84, bottom-left y 1.382 x 1.03–1.41; board centre z 8.446)
  { id: 'f-pynt-hylle-lykt', name: 'Glasslykt med hvitt kubbelys', kind: 'candle', archetype: 'candle-holder', position: [1.52, 1.822, 8.45], dims: { w: 0.1, d: 0.1, h: 0.16 }, params: { kind: 'lantern', lit: false }, colors: { main: '#eef1f0', candle: '#f4f1ea' }, materials: { main: 'glass-clear' }, notes: note('Topphylla (082736).') },
  { id: 'f-pynt-hylle-steinstabel', name: 'Krem «steinstabel»-skulptur', kind: 'decor', archetype: 'vase', position: [1.7, 1.822, 8.45], dims: { w: 0.08, d: 0.08, h: 0.14 }, params: { shape: 'sculptural' }, colors: { main: '#e3d9c6' }, materials: { main: 'ceramic' }, notes: note('Topphylla (082736).') },
  { id: 'f-pynt-hylle-plante', name: 'Liten grønn plante i sjøgresskurv', kind: 'plant-small', archetype: 'plant-small', position: [2.1, 1.662, 8.45], dims: { w: 0.12, d: 0.12, h: 0.2 }, params: { species: 'kunstig grønn plante', pot: { d: 0.1, h: 0.08 } }, colors: { pot: '#a08a62', leaves: '#5f7d4c' }, materials: { pot: 'rattan', leaves: 'plant-leaf' }, notes: note('Øvre høyre hylle (082736).') },
  { id: 'f-pynt-hylle-flaske', name: 'Røykgrå glassflaske-vase', kind: 'decor', archetype: 'vase', position: [1.6, 1.532, 8.45], dims: { w: 0.07, d: 0.07, h: 0.2 }, params: { shape: 'bottle' }, colors: { main: '#6f7275' }, materials: { main: 'glass-smoked' }, notes: note('Midtre hylle (082736).') },
  { id: 'f-pynt-hylle-telys', name: 'Grå riflet telysholder i glass', kind: 'candle', archetype: 'candle-holder', position: [1.12, 1.382, 8.45], dims: { w: 0.08, d: 0.08, h: 0.09 }, params: { kind: 'tealight', count: 1, lit: false }, colors: { main: '#8c9093' }, materials: { main: 'glass-smoked' }, notes: note('Nederste hylle til venstre (082736).') },
  { id: 'f-pynt-hylle-aloe', name: 'Liten aloe i sjøgresskurv', kind: 'plant-small', archetype: 'plant-small', position: [1.3, 1.382, 8.45], dims: { w: 0.1, d: 0.1, h: 0.16 }, params: { species: 'aloe', pot: { d: 0.09, h: 0.07 } }, colors: { pot: '#a08a62', leaves: '#6f8a5a' }, materials: { pot: 'rattan', leaves: 'plant-leaf' }, notes: note('Nederste hylle til venstre (082736).') },
];

/** builtInLights lumens (add-lighting; the strips have lumensPerM, the rest lumens). */
const BUILT_IN_LUMENS = {
  'led-sor': { lumensPerM: 120 }, 'led-tvstue': { lumensPerM: 120 }, 'led-kjokken': { lumensPerM: 120 }, 'led-overskap': { lumensPerM: 120 },
  'spot-hoyvegg-1': { lumens: 250 }, 'spot-hoyvegg-2': { lumens: 250 }, 'spot-hoyvegg-3': { lumens: 250 }, 'spot-hoyvegg-4': { lumens: 250 },
  'tak-tvstue': { lumens: 400 },
  'pendel-oy-1': { lumens: 250 }, 'pendel-oy-2': { lumens: 250 }, 'pendel-oy-3': { lumens: 250 },
  'ring-kjokken-1': { lumens: 500 }, 'ring-kjokken-2': { lumens: 500 },
};

/** @param {object} spec room-spec (mutated and returned) */
export function fixRoomSpec(spec) {
  const F = spec.furniture || (spec.furniture = []);
  const byId = (id) => F.find((x) => x.id === id);
  // dining chairs: cool light-grey fine bouclé/melange (0_for, 082909, 082901), not warm beige
  for (let i = 1; i <= 6; i++) {
    const c = byId(`f-spisestol-${i}`);
    if (c?.colors) c.colors.main = '#c8c8c6';
  }
  // the two dark cushions are charcoal grey (082736, 082726), not brown
  for (const id of ['f-pute-1', 'f-pute-3']) {
    const c = byId(id);
    if (c?.colors) c.colors.main = '#4c4c4f';
  }
  // TV coffee table: a near-black matte charcoal ceramic/concrete-look slab (082827, 082736) – not travertine
  const t = byId('f-sofabord-tv');
  if (t?.colors && t.materials) {
    t.colors.top = '#3f3f41';
    t.materials.top = 'ceramic';
  }
  // molecule chandelier: Ø16 / Ø10,5 cm shades – with Ø20 / Ø13 they are ≈ 20 % too big against the 1 m span in
  // 083012 (fix-lamps r1; the archetype default in lamps.js is Ø16 / Ø10,5 already)
  const ch = byId('f-pendel-stue');
  if (ch?.params) ch.params.shadeD = [0.16, 0.16, 0.16, 0.16, 0.105, 0.105, 0.105, 0.105];
  // lamp lumens calibrated against the photos with the add-lighting colour model (notes/add-lighting.md); the research
  // values (LED 400/300 lm/m, spots/island pendants 400, tak-tvstue 3000, kitchen rings and chandelier 2000) tinted the room
  const BL = spec.builtInLights || [];
  for (const l of BL) {
    const v = BUILT_IN_LUMENS[l.id];
    if (v) Object.assign(l, v);
  }
  if (ch?.light) ch.light.lumens = 800;
  // pampas vase on the island: in reality a ≈ 24 cm wavy vase with four short, fluffy plumes, ≈ 55 cm in all – not
  // 1 m (user's photo 2026-10-20)
  const pv = byId('f-pampas');
  if (pv) {
    pv.dims = { w: 0.32, d: 0.32, h: 0.55 };
    Object.assign((pv.params ||= {}), { vaseH: 0.24, vaseD: 0.13, plumes: 4, plumeWidth: 1.5, plumeLength: 0.72, plumeFan: 0.45 });
  }
  for (const d of DECOR) if (!byId(d.id)) F.push({ confidence: 'low', mount: 'surface', rotationDeg: 0, ...JSON.parse(JSON.stringify(d)) });
  return spec;
}

// ---------------------------------------------------------------------------------------------------------------
// catalog

/** Inner cushions for covers sold without one (Bohus: Norsk Dun, prices from the price notes). */
const INSERT = {
  '50x50': { name: 'Innerpute Norsk Dun 50x50', priceNok: 329, store: 'Bohus' },
  '40x60': { name: 'Innerpute Norsk Dun 40x60', priceNok: 299, store: 'Bohus' },
  '60x60': { name: 'Innerpute Norsk Dun 60x60', priceNok: 449, store: 'Bohus' },
  kid: { name: 'Innerpute 50x50 (selges separat hos Kid)', priceNok: null, store: 'Kid' },
  hm: { name: 'Innerpute 50x50 (selges separat hos H&M)', priceNok: null, store: 'H&M' },
};

const ABS_NOTE = (flat, batten) => `Regnet som montert rett på veggen (som i spillet): ca. ${flat} m² Sabine per panel. På lekter med mineralull bak gir panelet mer (klasse A, ca. ${batten} m²).`;

/**
 * Per product: fields to set (`set`), `dims` / `params` merged into the product's (measured sizes, model shape), variant
 * fixes by name substring (`variants`: [[match, fields]]), variant names
 * (`variantNames`: [[from, to]]), required extras, default variant by name, etc.
 */
export const PRODUCTS = {
  // ---- lenestoler
  'fagmobler-conform-daisy-lenestol': { variants: [['Ito Stone', { priceNok: 13799 }], ['Benson Bronze', { priceNok: 13799 }]] },
  'bohus-dominari-beetle-loungestol': { params: { seatD: 0.53 }, variants: [['Lincoln', { priceNok: 13845, salePriceNok: 8999 }], ['Golden 68', { priceNok: 14666, salePriceNok: 9499 }], ['Golden 29', { priceNok: 14666 }]] },
  'bohus-actona-meno-loungestol': { variants: [['Bay creme', { priceNok: 5999 }]] },
  'bohus-signature-920-loungestol': { set: { brand: 'Signature Collection by Halvor Bakke (Vilmers)' }, variants: [['Jesper', { priceNok: 17332 }], ['Sebastian Forest', { priceNok: 17332, salePriceNok: 12999 }]] },
  'bohus-scapa-avila-hvilestol': { variants: [['Ager', { priceNok: 11248, salePriceNok: 4499 }]] },
  // Stressless product sheet: footstool 54 × 40 × 39 cm
  'bohus-stressless-opal-hvilestol-med-fotskammel': { params: { stoolW: 0.54, stoolD: 0.4, stoolH: 0.39 }, variants: [['Daisy 12', { priceNok: 27099 }]] },
  'bohus-castle-mark-bern-hvilestol-med-fotskammel': { variants: [['Loft 19', { priceNok: 7999, salePriceNok: 5599 }]] },
  'bohus-vilmers-nordal-loungestol': { variants: [['Adore', { priceNok: 9332, salePriceNok: 6999 }], ['Dolomite', { priceNok: 9999, salePriceNok: 5999 }], ['Marble Ash', { priceNok: 7999 }]] },
  // armless, low and deep with puffy tufts in seat and back (product photos) – not a tub back
  'bohus-jakobsen-cooper-loungestol': { params: { backShape: 'tufted' }, variants: [['Lamb 05', { priceNok: 7832, salePriceNok: 5399 }], ['Perfect Harmony', { priceNok: 7415, salePriceNok: 5550 }], ['Seven 18', { priceNok: 7415 }]] },
  // IKEA: footstool 60 × 40 × 44 cm
  'ikea-strandmon-orelappstol-med-fotskammel': { params: { stoolW: 0.6, stoolD: 0.4, stoolH: 0.44 }, variants: [['Talliden', { priceNok: 5290 }], ['Tommaboda', { priceConfidence: 'check' }], ['Sulviken', { priceConfidence: 'check' }], ['Tibbleby', { priceConfidence: 'check' }]] },
  'ikea-ekenaset-lenestol': { variants: [['Axvall', { priceNok: 2495 }], ['Grann', { priceNok: 3495 }]], defaultVariant: 'eikemønstret/Kilanda' },
  'ikea-saltsjobaden-gynge-og-svingstol': { params: { seatD: 0.65 }, defaultVariant: 'Fridtuna lys beige' },
  // hvilestoler (research/catalog-new/lenestol-ny.json): the research guessed 0,55–0,8 m²; a high upholstered back,
  // headrest and footstool/footrest give ≈ 0,7–0,9 m² Sabine (500–1000 Hz) – the swivel chairs in the room are 0,6
  'bohus-actona-chicago-hvilestol-med-fotskammel': { set: { absorption: 0.8, absorptionNote: 'Anslått ca. 0,8 m² Sabine med fotskammelen: høy, polstret rygg og stoffkledde sider. I kunstskinn demper den litt mindre.' } },
  // Timeout: thick side panels whose arm tops flare out (petal), the column showing under them, a separate head
  // cushion; wooden-shell variants show veneer on the outer faces, the arm tops stay upholstered
  'bohus-conform-timeout-hvilestol-med-fotskammel': { params: { body: 'box', headStyle: 'block', armW: 0.13, armH: 0.55, armTuck: 0.045, armBottom: 0.27, armCap: false, stoolW: 0.51, stoolD: 0.38, stoolH: 0.39 }, set: { absorption: 0.85, absorptionNote: 'Anslått ca. 0,85 m² Sabine med fotskammelen: tykke sete- og ryggputer og nakkepute. Et skall i finér demper lite.' } },
  'bohus-castle-mark-zermatt-hvilestol-med-fotskammel': { set: { absorption: 0.9, absorptionNote: 'Anslått ca. 0,9 m² Sabine med fotskammelen: luvrikt fåreskinn på sete, rygg og skammel demper mest av hvilestolene.' } },
  // Grande with footrest: the page shows no measurements now; same frame as Zermatt med fothviler (109 cm high). Oak side
  // panels with the arm roll wrapped over the top and down the front, arms flaring out a little
  'bohus-castle-mark-grande-hvilestol-med-fothviler': { dims: { h: 1.09 }, params: { backH: 1.09, armH: 0.6, armTuck: 0.03 }, set: { absorption: 0.75, absorptionNote: 'Anslått ca. 0,75 m² Sabine: høy, polstret rygg og innebygd fothviler, men sidene er finert eik.' } },
  'bohus-img-taycan-hvilestol-med-fothviler': { set: { absorption: 0.7, absorptionNote: 'Anslått ca. 0,7 m² Sabine: polstret rygg og fothviler, men tynne armlener og ingen skammel.' } },
  // ---- skjenker
  'bohus-nola-skjenk-180x45': { variants: [['Hvitoljet', { priceNok: 10329, salePriceNok: 5164 }]] },
  'bohus-nola-skjenk-140x45': { set: { salePriceNok: 4664, priceConfidence: 'check' } },
  'bohus-wolin-skjenk-180x40': { variants: [['Hvitoljet', { priceNok: 11699, salePriceNok: 6999 }]] },
  'bohus-oland-skjenk-160x40': { set: { salePriceNok: 5799, priceConfidence: 'check' }, variants: [['Hvitoljet', { priceNok: 9199, salePriceNok: 5499 }]] },
  'bohus-storm-acro-skjenk-192x45': { set: { brand: 'Storm (Bohus Exclusive)' }, variants: [['Hvitoljet', { priceNok: 21999, salePriceNok: 15399 }]] },
  'bohus-kontur-skjenk-201x45': { set: { salePriceNok: 17779, priceConfidence: 'check' } },
  'bohus-honey-skjenk-170x45': { set: { salePriceNok: 17999, priceConfidence: 'check' }, variants: [['mocca', { priceNok: 23499 }], ['Nordic White', { priceNok: 23499, salePriceNok: 16449, priceConfidence: 'checked' }]] },
  'bohus-signature-1850-skjenk-180x43-5': { set: { brand: 'Signature Collection by Halvor Bakke', priceConfidence: 'check' } },
  'bohus-scandi-skjenk-180x45': { set: { salePriceNok: 18999, priceConfidence: 'check' } },
  'bohus-ullern-skjenk-180x45': { set: { salePriceNok: 14399, priceConfidence: 'check' } },
  'ikea-besta-veggmontert-180x42x64-bjorkoviken': { set: { name: 'BESTÅ veggmontert skapkombinasjon 180x42x64' }, variants: [['Lappviken', { priceConfidence: 'check' }], ['Hedeviken', { priceConfidence: 'check' }], ['Studsviken', { priceConfidence: 'check' }]] },
  'skeidar-a-line-skjenk': { variants: [['Walnut', { priceNok: 22399, priceConfidence: 'check' }]] },
  // ---- små lamper (Bohus: category list showed the campaign, the product page the ordinary price → check)
  'bohus-sindig-turner-gulvlampe-h147': { set: { priceConfidence: 'check' } },
  'bohus-sindig-avery-gulvlampe-h155': { set: { priceConfidence: 'check' } },
  'bohus-sindig-ceta-gulvlampe-h143': { set: { priceConfidence: 'check' }, variants: [['Marmor', { priceNok: 3499, salePriceNok: 1749 }]] },
  'bohus-aneta-valencia-gulvlampe-h150': { set: { priceConfidence: 'check' } },
  'bohus-sindig-blom-gulvlampe-h120': { set: { priceConfidence: 'check' } },
  'bohus-jakobsdals-liora-gulvlampe-h160': { set: { priceConfidence: 'check' } },
  'bohus-aneta-nice-uplight-h179': { set: { priceConfidence: 'check' } },
  'bohus-sindig-swop-gulvlampe-h150': { set: { priceConfidence: 'check' } },
  'bohus-magnor-rocks-xo-bordlampe-h24-4': { set: { priceConfidence: 'check' } },
  'bohus-sindig-porcini-oppladbar-bordlampe-o23': { set: { priceConfidence: 'check' } },
  'bohus-sindig-morris-bordlampe-h67': { set: { priceConfidence: 'check' } },
  'bohus-sindig-terra-bordlampe-h58': { set: { priceConfidence: 'check' } },
  'bohus-sindig-tiller-oppladbar-bordlampe-o18': { set: { priceConfidence: 'check' } },
  'bohus-aneta-valencia-bordlampe-h37': { set: { priceConfidence: 'check' } },
  'bohus-charge-oppladbar-vegglampe-h10': { set: { priceConfidence: 'check' } },
  'bohus-aneta-august-vegglampe-h25': { set: { priceConfidence: 'check' } },
  'nordicnest-northern-oslo-wood-gulvlampe': { variants: [['Stål stativ', { priceNok: 6290, salePriceNok: 4958 }], ['Lysegrå stativ', { priceNok: 6290, salePriceNok: 4193 }], ['Beige stativ', { priceNok: 6290, salePriceNok: 4558 }]] },
  'nordicnest-tradition-flowerpot-portable-vp9': { variants: [['Vermilion', { priceNok: 2269, salePriceNok: 1496 }]] },
  // ---- puter, pledd, puffer
  'bohus-boucle-moment-pynteputetrekk-50x50': { variants: [['Rosa', { priceNok: 749, salePriceNok: 375 }]], insert: '50x50' },
  'bohus-georgia-pynteputetrekk-50x50': { insert: '50x50' },
  'bohus-thomas-pynteputetrekk-50x50': { insert: '50x50' },
  'bohus-thomas-pynteputetrekk-40x60': { insert: '40x60' },
  'bohus-asima-pynteputetrekk-50x50': { insert: '50x50' },
  'bohus-zayla-pynteputetrekk-50x50': { insert: '50x50' },
  'bohus-sturla-pynteputetrekk-60x60': { insert: '60x60' },
  'bohus-sondre-pynteputetrekk-50x50': { insert: '50x50' },
  'bohus-bogstad-pynteputetrekk-40x60': { insert: '40x60' },
  'bohus-curl-pynteputetrekk-50x50': { set: { brand: 'Bohus' }, insert: '50x50' },
  'kid-andrea-velour-pynteputetrekk-50x50': { insert: 'kid' },
  'kid-verbier-pynteputetrekk-50x50': { insert: 'kid' },
  'hm-putetrekk-i-boucle-50x50': { set: { priceConfidence: 'check', verified: false }, insert: 'hm' },
  'bohus-asima-pledd-frynser-120x200': { variants: [['Rust', { priceNok: 1399, salePriceNok: 699 }]] },
  'bohus-bello-pledd-140x200': { variants: [['Brun-oker', { priceNok: 1299 }]] },
  'bohus-shaun-puff-o55': { set: { priceConfidence: 'check' } },
  'bohus-dani-puff-med-oppbevaring-o41': { set: { priceConfidence: 'check' } },
  'bohus-west-puff-o42': { set: { priceConfidence: 'check' } },
  'bohus-olea-puff-40x35': { set: { priceConfidence: 'check' } },
  // ---- tepper
  'bohus-lone-tepper-vila-teppe-240x340': { variants: [['115', { priceNok: 8999, salePriceNok: 6299 }], ['125', { priceNok: 8999, salePriceNok: 6299 }]] },
  'bohus-halvor-bakke-gabel-teppe-240x340': { set: { priceConfidence: 'check' } },
  'bohus-halvor-bakke-gabel-rundt-teppe-o240': { set: { priceConfidence: 'check' } },
  'bohus-frigg-teppe-200x290': { set: { priceConfidence: 'check' } },
  'bohus-lotus-teppe-240x340': { set: { priceConfidence: 'check' } },
  'bohus-lone-tepper-linde-teppe-200x290': { set: { priceConfidence: 'check' } },
  'bohus-rival-frise-teppe-200x290': { set: { priceConfidence: 'check' } },
  'rugvista-core-melange-200x300-gra': { set: { name: 'Melange teppe 200x300' } },
  'bolia-dalvik-teppe-200x300': {
    // the «listepris» 33 379 kr looks like a data error on the page; 8 344 kr is shown as the price paid
    set: { priceNok: 8344, salePriceNok: null, priceConfidence: 'check', verified: false },
    noteAppend: 'Spillet bruker 8 344 kr som pris (uten «tilbud»), fordi listeprisen ser ut som en feil på siden.',
  },
  // ---- solskjerming
  'bohus-debel-line-lamellsett-240x250': { variants: [['Grå', { priceNok: 1449, salePriceNok: 725 }]] },
  'ikea-vecklarfly-persienne-140x155': { set: { name: 'VECKLARFLY persienne 140x155' }, variants: [['Hvit', { priceNok: 699 }]] },
  'kid-leah-oppned-lysfiltrerende-plissegardin': { set: { name: 'Leah opp&ned lysfiltrerende plisségardin 80x160' }, variants: [['Hvit', { priceNok: 899.9, priceConfidence: 'check' }], ['Svart', { priceConfidence: 'check' }]] },
  'jysk-femris-duo-rullegardin-140x180': { set: { name: 'FEMRIS duo-rullegardin 140x180' } },
  'ikea-hoppvals-plissegardin-dobbel-140x155': { set: { name: 'HOPPVALS dobbel plisségardin 140x155' } },
  'gardinmaker-alu-persienner-25-mm': { set: { imageUrl: '', shippingNok: 390 }, variants: [['Matt stein', { priceNok: 4531 }], ['Macchiato', { priceNok: 4531 }]] },
  'gardinmaker-tre-persienner-50-mm': { set: { imageUrl: '', shippingNok: 390 }, variants: [['Valnøtt', { priceNok: 8787 }], ['Sort', { priceNok: 8787 }], ['Varm lin', { priceNok: 7105 }]] },
  'gardinmaker-gardinhoyde-med-wavefold': { set: { shippingNok: 390 } },
  'myscreens-zipscreen-95-comfort-eco': {
    // the campaign (−40 %) applies to the base price too: 14 390 → 8 634 kr minimum for a small window
    set: { priceFromNok: 8634, priceConfidence: 'estimate' },
    noteAppend: 'Fra-pris 8 634 kr med kampanjen (grunnpris 14 390 kr − 40 %).',
  },
  'luxaflex-duette-batiste': { set: { priceConfidence: 'estimate', verified: false } },
  // ---- akustikk
  'woodupp-akupanel-240x60': { set: { name: 'Akupanel akustikkpanel 60x240', absorption: 0.86, absorptionNote: ABS_NOTE('0,86', '1,22') }, variants: [['koksgrå', { salePriceNok: 1224 }]] },
  'woodupp-akupanel-300x60': { set: { name: 'Akupanel akustikkpanel 60x300', absorption: 1.1, absorptionNote: ABS_NOTE('1,1', '1,53') } },
  'woodupp-akupixel-60x60': { set: { name: 'Akupixel akustikkpanel 60x60', absorption: 0.22, absorptionNote: ABS_NOTE('0,22', '0,31') } },
  'woodupp-akupixel-mose-60x60': { set: { name: 'Akupixel mose 60x60' } },
  'maxbo-protre-spilepanel-ro-21x600x2400': { set: { name: 'Protre Ro spilepanel 21x600x2400', absorption: 0.86, absorptionNote: ABS_NOTE('0,86', '1,22'), priceConfidence: 'check', verified: false } },
  'monter-opus-spilepanel-mdf-600x2400': { set: { name: 'Opus spilepanel MDF 600x2400' } },
  'byggmax-fibrotech-quanti-2440': { set: { name: 'Quanti akustikkpanel 18x520x2440' } },
  'clasohlson-fibrotech-quanti-mini-118x36': { set: { name: 'Quanti Mini akustikkpanel 118x36 (2-pakning)', priceNok: 149.95, packSize: 2, packPriceNok: 299.9 } },
  'akustikksenter-loke-oval-flate-40': { variants: [['Mørk grå', { priceNok: 5847, salePriceNok: 4970 }]] },
  // ---- hele huset: model params tuned against the store photos (notes/katalog-hele-huset.md)
  'bohus-wood-sengegavl-260x120': { params: { slatPitch: 0.045 } },
  'bohus-sando-sengebenk-150x51': { params: { legH: 0.1 } },
  'bohus-vinstra-nattbord-46x40': { params: { legFrame: true } },
  'bohus-nola-nattbord-50x40': { params: { legFrame: true } },
  'bohus-vinstra-kommode-158x40': { params: { legFrame: true } },
  'bohus-sandnes-kommode-157x40': { params: { legFrame: true } },
  'bohus-bodo-kommode-156x40': { params: { midLegs: true } },
  // a sliding door over the left column, a hinged door over three drawers on the right
  'bohus-naia-garderobeskap-118x60': { params: { fronts: ['door', 'door+drawers:3'], slidingDoors: false, cellDrawerH: 0.55 } },
  // the low door pair under the tall doors
  'bohus-vinstra-garderobeskap-99x60': { params: { drawerRow: 2, drawerRowDoors: true } },
  'bohus-vinstra-garderobeskap-smal-51x60': { params: { drawerRowDoors: true } },
  // mirror versions: the right door sits over two drawers
  'bohus-madrid-garderobeskap-150x60': { params: { fronts: ['door', 'mirror', 'door+drawers:2'], cellDrawerH: 0.43 } },
  'bohus-madrid-garderobeskap-103x60': { params: { cellDrawerH: 0.43 } },
  // the store photos show bare racks: no coats (the Inspector can hang some)
  'bohus-frikk-stumtjener-h169': { params: { coats: 0, levels: 6 } },
  'bohus-butler-stumtjener-h177': { params: { coats: 0, levels: 6, pegStyle: 'flat' } },
  'bohus-frikk-vegghylle-knagger-80x10': { params: { coats: 0 } },
  'bohus-stord-knaggrekke-b50': { params: { coats: 0 } },
  'bohus-mondo-knagger-sett-o7-o9-o13': { params: { coats: 0, hookStyle: 'disc', sizes: [0.07, 0.13, 0.09] } },
  'bohus-nola-ovalt-spisebord-95x180': { params: { legs: 'column' } },
  'bohus-bastia-rundt-spisebord-o130': { params: { legs: 'spider' } },
  'bohus-signature-1800-spisebord-100x220': { params: { legs: 'panel', legInset: 0.3 } },
  'bohus-palma-rundt-spisebord-o130': { params: { legs: 'cross' } },
  'ikea-krylbo-stol': { params: { back: 'pad' } },
  'bohus-noni-spisestol': { params: { hoop: true, spindles: 5 } },
  'bohus-avanna-gulvspeil-80x198': { params: { shape: 'rounded' } },
  'ikea-ikornnes-gulvspeil-52x167': { params: { shape: 'rounded' } },
  'bohus-lazio-speil-med-hylle-o80': { params: { shelf: true, shelfAt: 0.16 } },
  'ikea-stockholm-speil-o80': { params: { shelf: true, shelfAt: 0.12, shelfD: 0.07 } },
  'bohus-manhattan-speil-med-sprosser-80x120': { params: { mullionLayout: 'border' } },
  'ikea-hemnes-speilskap-med-2-dorer-83x98': { params: { doorFrame: true, cornice: true } },
  'bohus-linus-sapedispenser-8x8': { params: { squareBody: true } },
  'bohus-frikk-vegghylle-60x20': { params: { brackets: 'straps' } },
  'bohus-tamara-vegghylle-60x49': { params: { brackets: 'battens' } },
  'jysk-cirkelhuse-stumtjener-h174': { params: { coats: 0 } },
  'jysk-hejsager-vegghylle-3-hyller-65x20': { params: { brackets: 'battens' } },
  // ---- speil (moved from Smått, CATEGORY_MOVES)
  'bohus-applewood-speil-o90': { set: { subcategory: 'veggspeil' } },
  'bohus-othilie-speil-90x93': { set: { subcategory: 'veggspeil' } },
  'bohus-holmen-cape-speil-med-sprosser-h200': { set: { subcategory: 'veggspeil' } },
};

/**
 * Products that moved to another category (normalize-data.mjs moves them before normalising): the three mirrors of the
 * first round lived in Smått until the Speil category came with the rest of the house.
 */
export const CATEGORY_MOVES = {
  'bohus-applewood-speil-o90': 'speil',
  'bohus-othilie-speil-90x93': 'speil',
  'bohus-holmen-cape-speil-med-sprosser-h200': 'speil',
};

/** English / one-colour variant names → Norwegian (WoodUpp, Fibrotech). */
const VARIANT_NAMES = [
  ['Natural Wood, Rustic Smoked Oak, Black Felt', 'Rustikk røkt eik, sort filt'],
  ['Natural Wood, Classic Oak, Black Felt', 'Klassisk eik, sort filt'],
  ['Natural Wood, Walnut, Black Felt', 'Valnøtt, sort filt'],
  ['Natural Wood, TONAL, Black Ash, Black Felt', 'Sort ask (Tonal), sort filt'],
  ['Natural Wood, Black Ash, Black Felt', 'Sort ask, sort filt'],
  ['Natural Wood, Rustic Grey Oak, Warm Grey Felt', 'Rustikk grå eik, varm grå filt'],
  ['Natural Wood, Rustic Grey Oak, Black Felt', 'Rustikk grå eik, sort filt'],
  ['Colored, Dark Cashmere, Dark Beige Felt', 'Farget: mørk kasjmir, mørk beige filt'],
  ['Colored, Soft Linen, Light Beige Felt', 'Farget: myk lin, lys beige filt'],
  ['Colored, Charcoal, Black Felt', 'Farget: koksgrå, sort filt'],
  ['Mosegrønn (Moss Green)', 'Mosegrønn'],
  ['Eplegrønn (Apple Green)', 'Eplegrønn'],
  ['Smoked Oak', 'Røkt eik'],
  ['Oiled oak', 'Oljet eik'],
];

const CONFIDENCE = ['checked', 'check', 'estimate'];

/**
 * Applies the catalogue fixes to one category's products (mutated and returned).
 * @param {string} key  category key
 * @param {object[]} products
 */
export function fixCatalog(key, products) {
  for (const p of products) {
    const f = PRODUCTS[p.id];
    if (f?.set) {
      for (const [k, v] of Object.entries(f.set)) {
        if (v === null) delete p[k];
        else p[k] = v;
      }
    }
    // model fixes: measured dims and shape params are merged in (null removes a key)
    for (const k of ['dims', 'params']) {
      if (!f?.[k]) continue;
      p[k] = { ...(p[k] || {}) };
      for (const [kk, v] of Object.entries(f[k])) {
        if (v === null) delete p[k][kk];
        else p[k][kk] = v;
      }
    }
    if (f?.noteAppend && !String(p.priceNote || '').includes(f.noteAppend)) p.priceNote = `${p.priceNote ? `${p.priceNote} ` : ''}${f.noteAppend}`;
    for (const v of p.variants || []) {
      for (const [from, to] of VARIANT_NAMES) if (v.name === from) v.name = to;
      for (const [match, fields] of f?.variants || []) {
        if (!String(v.name).includes(match)) continue;
        for (const [k, val] of Object.entries(fields)) {
          if (val === null) delete v[k];
          else v[k] = val;
        }
      }
    }
    if (typeof f?.defaultVariant === 'string') {
      const i = p.variants.findIndex((v) => v.name.includes(f.defaultVariant));
      if (i >= 0) p.defaultVariant = i;
    }
    if (f?.insert) {
      const ins = INSERT[f.insert];
      p.requiredExtras = [{ ...ins, perUnit: 1 }];
      const hint = ins.priceNok != null
        ? `Kun trekk – husk innerpute (${ins.name.replace('Innerpute ', '')}, ${ins.priceNok} kr hos ${ins.store}).`
        : `Kun trekk – husk innerpute (${ins.name.replace(/^Innerpute /, '').replace(/\s*\(.*\)$/, '')}, selges separat).`;
      if (!/innerpute/i.test(p.description || '')) p.description = `${p.description ? `${p.description} ` : ''}${hint}`;
    }
    // names: Norwegian decimal comma («H24.4» → «H24,4»)
    if (typeof p.name === 'string') p.name = p.name.replace(/(\d)\.(\d)/g, '$1,$2');
    // every product has a price confidence: estimates from the old verified flag, the rest checked
    if (!CONFIDENCE.includes(p.priceConfidence)) p.priceConfidence = p.verified === false ? 'estimate' : 'checked';
  }
  return products;
}

// ---------------------------------------------------------------------------------------------------------------
// CLI: apply to src/data in place

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--apply')) {
  const DATA = path.resolve(HERE, '..');
  const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  // --only=catalog leaves room-spec.json alone (other people may be editing it)
  const catalogOnly = process.argv.includes('--only=catalog');
  const specFile = path.join(DATA, 'room-spec.json');
  if (!catalogOnly) write(specFile, fixRoomSpec(JSON.parse(fs.readFileSync(specFile, 'utf8'))));
  let n = 0;
  for (const file of fs.readdirSync(path.join(DATA, 'catalog'))) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(DATA, 'catalog', file);
    const list = JSON.parse(fs.readFileSync(full, 'utf8'));
    write(full, fixCatalog(file.replace(/\.json$/, ''), list));
    n += list.length;
  }
  const missing = Object.keys(PRODUCTS).filter((id) => {
    for (const file of fs.readdirSync(path.join(DATA, 'catalog'))) {
      if (JSON.parse(fs.readFileSync(path.join(DATA, 'catalog', file), 'utf8')).some((p) => p.id === id)) return false;
    }
    return true;
  });
  console.log(`fixes applied: ${catalogOnly ? '' : 'room-spec + '}${n} products${missing.length ? ` – unknown ids: ${missing.join(', ')}` : ''}`);
}
