// «Spesialforslag» for the high wall: the wall-hung BESTÅ cabinet combination 180 × 22 × 38 from the Spesialkatalog
// (Hedeviken flat or Björköviken ribbed doors) with one to three canvasbutik.no sound-absorbing pictures over it, low
// decor and a small lamp on top and, beside it, a floor lamp, floor vase or plant. Unlike the wall proposals
// (data/wall-proposals.json, wall-design elements), these are ordinary catalogue items, so a picture can be clicked
// and switched between its store sizes in the inspector.
//
// CONTRACT
//   SPECIAL_PROPOSALS                         [{ id, name, description, bench: { v (door variant), u? }, pictures, align, gap,
//                                               decor, floor?, shift? }]
//   SPECIAL_BENCHES / getSpecialBench() / setSpecialBench(key) / activeSpecialBench(design)
//                                              the cabinet all proposals use: grunt 180×22×38, dypt 180×42×38, høyt 180×42×64
//   layoutSpecialProposal(proposal, catalog, benchKey?) → [{ role, productId, variantIndex, u, v, w, h, d, fromV? }] wall coordinates
//                                              (u from the niche corner, v up from the floor; v = bottom edge)
//                                              role: bench | picture | decor (on the cabinet) | floor (beside it)
//   specialItemSpecs(proposal, catalog, highWall) → item specs for DesignState.add (uid «spf-…», world positions)
//   applySpecialProposal(editor, id)          one undo step: removes the last special proposal and what hangs on the
//                                              high wall / stands against it, clears a wall design, adds the items
//   isSpecialUid(uid)
//
// Units: metres. The high wall (layout.highWall): x = 3.22, u runs along −z from z = 8.34, 3.91 wide, 3.0 high.
// The cabinet hangs on its wall rail 25 cm over the floor (product params.base 'wall', mountHeight 0.25 – the model
// lifts itself, the item stands at y = 0), the pictures start 25 cm over its top. Positions of the decor: `at` −1 … 1
// along the cabinet (−1 = the end by the niche). Floor items: `side` −1 (niche) or 1 (door), 12 cm from the cabinet.
//
// Composition rules (checked by tools/test-design.mjs): the cabinet is only 22 cm deep, so what stands on it is at
// most 23 cm deep; where a picture hangs over the cabinet the decor stays low (≤ 30 cm, it fits in the 25 cm gap and
// barely touches the frame), taller things (bordlampe, lysestake, plante) only where no picture is above them; a tall
// floor lamp or plant never stands in front of a picture. One style per wall – the photo series, the graphic pairs and
// the watercolours are never mixed.

export const SPECIAL_PREFIX = 'spf-';
export const isSpecialUid = (uid) => typeof uid === 'string' && uid.startsWith(SPECIAL_PREFIX);

const BESTA = 'ikea-besta-veggmontert-skapkombinasjon-180x22-mork';
const HEDE = 0; // Hedeviken, flat brunbeiset eik
const BJORK = 1; // Björköviken, riflet brunbeiset eik

/**
 * The cabinet every proposal uses – chosen at the top of the panel (the owner, 2026-11-18). All three have the same
 * door order (0 Hedeviken, 1 Björköviken) and hang 25 cm over the floor; a proposal names only the door variant.
 */
export const SPECIAL_BENCHES = Object.freeze([
  { key: 'grunt', id: BESTA, label: 'Grunt', size: '180 × 22 × 38' },
  { key: 'dypt', id: 'ikea-besta-tv-benk-dorer-180x42-veggmontert', label: 'Dypt', size: '180 × 42 × 38' },
  { key: 'hoyt', id: 'ikea-besta-veggmontert-skapkombinasjon-180x42x64-mork', label: 'Høyt', size: '180 × 42 × 64' },
]);
const benchOf = (key) => SPECIAL_BENCHES.find((b) => b.key === key) || SPECIAL_BENCHES[0];
let _bench = SPECIAL_BENCHES[0].key;
/** The chosen cabinet (key of SPECIAL_BENCHES). */
export const getSpecialBench = () => _bench;
export function setSpecialBench(key) {
  _bench = benchOf(key).key;
  return _bench;
}
const ART = (slug) => `canvasbutik-lyddempende-bilde-${slug}`;

// on the cabinet – low (≤ 30 cm)
const TILLER = 'bohus-sindig-tiller-oppladbar-bordlampe-o18'; // 0 lin natur, 1 lin brun
const BARESI = 'bohus-sindig-baresi-oppladbar-bordlampe-o15';
const PORCINI = 'bohus-sindig-porcini-oppladbar-bordlampe-o23'; // 0 beige, 1 grønn, 2 mørk brun, 3 rust brun
const MAGNOR = 'bohus-magnor-rocks-xo-bordlampe-h24-4'; // 1 caramel
const FLOWERPOT = 'nordicnest-tradition-flowerpot-portable-vp9'; // 0 grey beige
const IVY = 'bohus-mr-plant-gullranke-l70'; // 1 hvit potte – henger ned over kanten
// on the cabinet – tall, only beside a picture
const TURNER = 'bohus-sindig-turner-bordlampe-h42';
const CERES = 'bohus-halvor-bakke-ceres-lysestake-h40';
const MARMI = 'bohus-halvor-bakke-marmi-lykt-h59'; // 0 svart, 1 brun
const ANTH = 'bohus-viridis-anthurium-h80'; // 1 hvit potte
// on the floor beside the cabinet
const TURNER_GULV = 'bohus-sindig-turner-gulvlampe-h147';
const CETA_GULV = 'bohus-sindig-ceta-gulvlampe-h143'; // 0 travertin beige
const TORRANO = 'nordicnest-globen-torrano-gulvlampe-h145'; // 1 brun
const AUDE = 'bohus-sindig-aude-vase-h70'; // 0 brun, 1 hvit
const OLIVE = 'bohus-viridis-oliventre-h84'; // 1 beige potte
const FICUS = 'bohus-mr-plant-fiolficus-h150'; // 0 brun potte (bare mot nisjen – den er bred)

// canvas size variants (tools/build-spesialkatalog.mjs SIZES): 0 = 50 × 70, 1 = 70 × 100, 2 = 80 × 120, 3 = 100 × 150,
// 4 = 120 × 180 (a landscape motif turns them: 70 × 50 … 180 × 120)
const S50 = 0, S70 = 1, S80 = 2, S100 = 3, S120 = 4;
const pic = (slug, size) => ({ id: ART(slug), v: size });
const dec = (id, at, v = 0) => ({ id, at, v });
const flo = (id, side, v = 0) => ({ id, side, v });

export const SPECIAL_PROPOSALS = Object.freeze([
  // ---- tørkede blader (foto) ----------------------------------------------------------------------------------
  {
    id: 'S1', name: 'Bladveggen – Whispering Leaves i midten',
    description: '«Whispering Leaves» 80 × 120 midt mellom «Rust» og «Gaiety» i 50 × 70, midtstilt. Kobber, rosa og sepia – tre nærbilder av tørkede blader. De riflede Björköviken-dørene gjentar årene i bladene; lav linlampe og gullranke på skapet, brun gulvvase ved siden av.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('rust', S50), pic('whispering-leaves', S80), pic('gaiety', S50)], align: 'center', gap: 0.1,
    decor: [dec(TILLER, -0.85, 1), dec(IVY, 0.8, 1)], floor: [flo(AUDE, 1, 0)],
  },
  {
    id: 'S2', name: 'Whispering Leaves alene – 100 × 150',
    description: 'Favorittbildet alene i 100 × 150 over Hedeviken. Bildet er litt over halvparten så bredt som skapet, så det blir plass til Turner-lampen og en anthurium på hver side – klassisk og rolig.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('whispering-leaves', S100)], align: 'bottom',
    decor: [dec(TURNER, -1), dec(ANTH, 1, 1)],
  },
  {
    id: 'S3', name: 'Bladparet – Rust og Whispering Leaves',
    description: 'To 80 × 120 side om side, til sammen like brede som skapet. Rust er varmest, Whispering Leaves kjøligst – de balanserer hverandre. Rustbrun Porcini og gullranke på skapet, Turner gulvlampe mot nisjen.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('rust', S80), pic('whispering-leaves', S80)], align: 'bottom', gap: 0.1,
    decor: [dec(PORCINI, -0.85, 3), dec(IVY, 0.8, 1)], floor: [flo(TURNER_GULV, -1)],
  },
  {
    id: 'S4', name: 'Petal liggende – 150 × 100',
    description: 'Det liggende «Petal» følger det lange skapet. Bladene i kobber mot rispapir passer de riflede Björköviken-dørene. Lave lamper på skapet, brun Torrano-globe på gulvet mot døra.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('petal', S100)], align: 'bottom',
    decor: [dec(TILLER, -0.85, 1), dec(BARESI, 0.85)], floor: [flo(TORRANO, 1, 1)],
  },
  // ---- beige naturfoto ----------------------------------------------------------------------------------------
  {
    id: 'S5', name: 'Beige-serien – tre i rekke',
    description: '«Nature Petals», «Beige Botanics» og «Beigeflor» i 70 × 100 – samme lyse, varme fotostil, så de leses som én serie. Bredere enn skapet, et rolig bånd over hele veggen. Linlampe og beige Porcini på skapet, hvit gulvvase ved døra.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('nature-petals', S70), pic('beige-botanics', S70), pic('beigeflor', S70)], align: 'bottom', gap: 0.08,
    decor: [dec(TILLER, -0.85, 0), dec(PORCINI, 0.85, 0)], floor: [flo(AUDE, 1, 1)],
  },
  {
    id: 'S6', name: 'Bokeh-paret – Serenebeige og Beigeflor',
    description: 'To 80 × 120 med strå i motlys og myke lysprikker. De mørke bakgrunnene henter opp den brunsvarte skapkroppen. Caramel-lampe og mørkebrun Porcini på skapet, fiolfiken i brun potte mot nisjen.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('serenebeige', S80), pic('beigeflor', S80)], align: 'bottom', gap: 0.1,
    decor: [dec(MAGNOR, -0.85, 1), dec(PORCINI, 0.85, 2)], floor: [flo(FICUS, -1)],
  },
  {
    id: 'S7', name: 'Beigeblossom stort – 120 × 180',
    description: 'Ett stort «Beigeblossom» – de hvite blomstene lyser opp hele veggen og demper mest av enkeltbildene. Lysestake og Marmi-lykt ved kantene der bildet slutter, hvit gulvvase ved døra.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('beigeblossom', S120)], align: 'bottom',
    decor: [dec(CERES, -1), dec(MARMI, 1)], floor: [flo(AUDE, 1, 1)],
  },
  {
    id: 'S8', name: 'Stort og lite – Central Flower og Quiet Elegance',
    description: '«Central Flower» 100 × 150 og «Nature\'s Quiet Elegance» 50 × 70 med felles underkant. Det store bildet bærer, det lille gir rytme. Ceta gulvlampe i travertin mot døra.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('central-flower', S100), pic('natures-quiet-elegance', S50)], align: 'bottom', gap: 0.12,
    decor: [dec(TILLER, -0.85, 0), dec(IVY, 0.8, 1)], floor: [flo(CETA_GULV, 1)],
  },
  {
    id: 'S9', name: 'Tørre strå – tre fra samme fotoserie',
    description: '«Burdocks», «Grass In Light» og «Sunlight In The Mountains» er tatt i samme serie: tørre strå i gyllent motlys. Tre 70 × 100 over Björköviken, der de vertikale riflene gjentar stråene.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('burdocks', S70), pic('grass-in-light', S70), pic('sunlight-in-the-mountains', S70)], align: 'bottom', gap: 0.08,
    decor: [dec(BARESI, -0.85), dec(PORCINI, 0.85, 3)],
  },
  {
    id: 'S10', name: 'Markblomster – Fall Flowers, Finery og Inflorescence',
    description: 'Tre 70 × 100 fra samme fotoserie med tørkede markblomster og pampas. Finery med buketten står i midten. Lyst og luftig over Björköviken; Flowerpot-lampe og linlampe på skapet.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('fall-flowers', S70), pic('finery', S70), pic('inflorescence', S70)], align: 'bottom', gap: 0.08,
    decor: [dec(FLOWERPOT, -0.85, 0), dec(TILLER, 0.85, 0)],
  },
  // ---- malte fjell ----------------------------------------------------------------------------------------------
  {
    id: 'S11', name: 'Fjellparet – Golden Horizons og Timeless Peaks',
    description: 'To 80 × 120 fra samme serie med malte fjellag. Lagene gjentar de vannrette linjene i Hedeviken-skapet. Caramel-lampe og Flowerpot på skapet, Turner gulvlampe mot nisjen.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('golden-horizons', S80), pic('timeless-peaks', S80)], align: 'bottom', gap: 0.1,
    decor: [dec(FLOWERPOT, -0.85, 0), dec(MAGNOR, 0.85, 1)], floor: [flo(TURNER_GULV, -1)],
  },
  {
    id: 'S12', name: 'Golden Horizons alene – 120 × 180',
    description: 'Fjellagene i største størrelse – nesten som et vindu mot fjellet. Brun Marmi-lykt og lysestake ved kantene, fiolfiken mot nisjen.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('golden-horizons', S120)], align: 'bottom',
    decor: [dec(MARMI, -1, 1), dec(CERES, 1)], floor: [flo(FICUS, -1)],
  },
  // ---- blekk og marmor ------------------------------------------------------------------------------------------
  {
    id: 'S13', name: 'Blekk og marmor – Sands Of Time og Rust And Flow',
    description: 'To 80 × 120 i mørk brun, rust og hvitt – de kraftigste fargene i utvalget. Mørkebrun Porcini og brun linlampe på skapet, brun Torrano-globe ved døra.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('sands-of-time', S80), pic('rust-and-flow', S80)], align: 'bottom', gap: 0.1,
    decor: [dec(PORCINI, -0.85, 2), dec(TILLER, 0.85, 1)], floor: [flo(TORRANO, 1, 1)],
  },
  {
    id: 'S14', name: 'Amber Waves liggende – 180 × 120',
    description: 'Det liggende «Amber Waves» er like bredt som skapet – ett stort, gyllent felt over hele møbelet. Caramel-lampe og gullranke under, Turner gulvlampe ved døra.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('amber-waves', S120)], align: 'bottom',
    decor: [dec(MAGNOR, -0.85, 1), dec(IVY, 0.8, 1)], floor: [flo(TURNER_GULV, 1)],
  },
  {
    id: 'S15', name: 'Veins Of Terra og Whispers Of Earth – stående og liggende',
    description: '«Veins Of Terra» 80 × 120 og det liggende «Whispers Of Earth» 70 × 50 med felles overkant – det lille bildet henger som en «fortsettelse» av det store. Lyse blekkmotiver med gull.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('veins-of-terra', S80), pic('whispers-of-earth', S50)], align: 'top', gap: 0.12,
    decor: [dec(BARESI, -0.85), dec(PORCINI, 0.85, 0)], floor: [flo(CETA_GULV, 1)],
  },
  // ---- landskapsfoto --------------------------------------------------------------------------------------------
  {
    id: 'S16', name: 'Høsttåke – Hazy Mountains og Colorful Autumn',
    description: 'To 80 × 120 med høstbrune lerkeskoger i tåke. Fotoene har samme brunfarge som skapet og gir dybde i veggen. Brun linlampe og mørkebrun Porcini på skapet, oliventre ved døra.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('hazy-mountains', S80), pic('colorful-autumn', S80)], align: 'bottom', gap: 0.1,
    decor: [dec(TILLER, -0.85, 1), dec(PORCINI, 0.85, 2)], floor: [flo(OLIVE, 1, 1)],
  },
  {
    id: 'S17', name: 'Grønn kontrast – Secrecy og Connection',
    description: 'To 80 × 120 i blågrønt og tåke – et bevisst brudd med alt det brune. Grønn Porcini, gullranke og oliventre binder det grønne sammen med rommet.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('secrecy', S80), pic('connection', S80)], align: 'bottom', gap: 0.1,
    decor: [dec(PORCINI, -0.85, 1), dec(IVY, 0.8, 1)], floor: [flo(OLIVE, -1, 1)],
  },
  {
    id: 'S18', name: 'Dolomites alene – 100 × 150',
    description: 'Fjellet som speiler seg i vannet, alene i 100 × 150 over de riflede Björköviken-dørene. Turner-lampe og anthurium ved siden av bildet.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('dolomites', S100)], align: 'bottom',
    decor: [dec(TURNER, -1), dec(ANTH, 1, 1)],
  },
  // ---- grafisk og akvarell --------------------------------------------------------------------------------------
  {
    id: 'S19', name: 'Grafisk par – Nature Graphic No1 og No2',
    description: 'To 80 × 120 fra samme serie: buer og sirkler i mørk brun, rust og dempet grønt på en ru, beige bakgrunn. Grønn Porcini henter opp det grønne, Turner gulvlampe mot nisjen.',
    bench: { id: BESTA, v: BJORK }, pictures: [pic('nature-graphic-no1', S80), pic('nature-graphic-no2', S80)], align: 'bottom', gap: 0.1,
    decor: [dec(PORCINI, -0.85, 1), dec(TILLER, 0.85, 1)], floor: [flo(TURNER_GULV, -1)],
  },
  {
    id: 'S20', name: 'Myke former – Graphic Art No1 og No2',
    description: 'To 70 × 100 med enkle, organiske former i brunt og beige – det roligste og mest luftige av forslagene. Lave lamper på skapet og brun gulvvase ved døra.',
    bench: { id: BESTA, v: HEDE }, pictures: [pic('graphic-art-no1', S70), pic('graphic-art-no2', S70)], align: 'bottom', gap: 0.1,
    decor: [dec(BARESI, -0.85), dec(FLOWERPOT, 0.85, 0)], floor: [flo(AUDE, 1, 0)],
  },
]);

// ---------------------------------------------------------------------------------------------------------------

const WALL_W = 3.91;
const WALL_H = 3.0;
const PIC_TOP_MAX = WALL_H - 0.25; // a picture's top edge stays 25 cm under the ceiling
const BENCH_U = 1.95; // the middle of the wall
const BENCH_Y = 0.25; // wall-hung, 25 cm over the floor
const PIC_GAP_OVER = 0.25; // from the sideboard top to the lowest picture
const FLOOR_GAP = 0.12; // from the cabinet end to a floor item
const r3 = (x) => Math.round(x * 1000) / 1000;

function dimsOf(catalog, id, v) {
  const p = catalog.getProduct(id);
  if (!p) throw new Error(`[specialProposals] ukjent produkt ${id}`);
  const vv = p.variants?.[v];
  return { product: p, dims: vv?.dims ? { ...p.dims, ...vv.dims } : p.dims };
}

/**
 * Wall coordinates of everything in a proposal (v = bottom edge, u = centre). The cabinet is the chosen one
 * (SPECIAL_BENCHES, `benchKey`) with the proposal's door variant; over the tall cabinet a picture that would reach
 * closer than 25 cm to the ceiling steps down one store size at a time (`fromV` = the size the proposal names).
 * @param {object} proposal  one of SPECIAL_PROPOSALS
 * @param {{ getProduct: (id: string) => object }} catalog  catalog/index.js
 * @param {string} [benchKey]  SPECIAL_BENCHES key (default: the chosen one)
 */
export function layoutSpecialProposal(proposal, catalog, benchKey = _bench) {
  const out = [];
  const b = dimsOf(catalog, benchOf(benchKey).id, proposal.bench.v);
  const bu = proposal.bench.u ?? BENCH_U;
  const top = BENCH_Y + b.dims.h;
  out.push({ role: 'bench', productId: b.product.id, variantIndex: proposal.bench.v, u: bu, v: BENCH_Y, w: b.dims.w, h: b.dims.h, d: b.dims.d });

  const gap = proposal.gap ?? 0.12;
  const base0 = top + PIC_GAP_OVER;
  const pics = proposal.pictures.map((p) => {
    let v = p.v, x = dimsOf(catalog, p.id, v);
    while (v > 0 && base0 + x.dims.h > PIC_TOP_MAX + 1e-9) x = dimsOf(catalog, p.id, --v);
    return { p: { ...p, v }, fromV: v === p.v ? undefined : p.v, ...x };
  });
  const total = pics.reduce((s, x) => s + x.dims.w, 0) + gap * (pics.length - 1);
  const maxH = Math.max(...pics.map((x) => x.dims.h));
  const base = top + PIC_GAP_OVER;
  let u = bu + (proposal.shift ?? 0) - total / 2;
  for (const x of pics) {
    const hh = x.dims.h;
    const v = proposal.align === 'top' ? base + maxH - hh : proposal.align === 'center' ? base + (maxH - hh) / 2 : base;
    out.push({ role: 'picture', productId: x.product.id, variantIndex: x.p.v, u: r3(u + x.dims.w / 2), v: r3(v), w: x.dims.w, h: hh, d: x.dims.d, ...(x.fromV !== undefined ? { fromV: x.fromV } : {}) });
    u += x.dims.w + gap;
  }

  for (const d of proposal.decor || []) {
    const x = dimsOf(catalog, d.id, d.v);
    const half = b.dims.w / 2 - x.dims.w / 2 - 0.04;
    out.push({ role: 'decor', productId: x.product.id, variantIndex: d.v, u: r3(bu + d.at * half), v: r3(top), w: x.dims.w, h: x.dims.h, d: x.dims.d, benchD: b.dims.d });
  }
  for (const f of proposal.floor || []) {
    const x = dimsOf(catalog, f.id, f.v);
    const s = f.side < 0 ? -1 : 1;
    out.push({ role: 'floor', productId: x.product.id, variantIndex: f.v, u: r3(bu + s * (b.dims.w / 2 + FLOOR_GAP + x.dims.w / 2)), v: 0, w: x.dims.w, h: x.dims.h, d: x.dims.d });
  }
  return out;
}

/** Distance from the wall to the centre of an item (m). */
function outOf(e) {
  if (e.role === 'picture') return 0;
  if (e.role === 'bench') return e.d / 2;
  // decor: in the middle of the cabinet top, a wide plant a little forward so its leaves clear the wall
  if (e.role === 'decor') return Math.max(e.benchD / 2, Math.min(e.d / 2, e.benchD / 2 + 0.03));
  return e.d / 2 + 0.03;
}

/**
 * Item specs (world positions) for DesignState.add.
 * @param {object} proposal
 * @param {object} catalog  catalog/index.js (getProduct, productToItemSpec)
 * @param {{ wallId: string, origin: {x:number,z:number}, uDir: {x:number,z:number}, normal: {x:number,z:number} }} hw  layout.highWall
 */
export function specialItemSpecs(proposal, catalog, hw, benchKey = _bench) {
  const n = [hw.normal.x, 0, hw.normal.z];
  const yaw = Math.round((Math.atan2(n[0], n[2]) * 180) / Math.PI);
  const at = (u, out) => [r3(hw.origin.x + hw.uDir.x * u + n[0] * out), null, r3(hw.origin.z + hw.uDir.z * u + n[2] * out)];
  return layoutSpecialProposal(proposal, catalog, benchKey).map((e, i) => {
    const spec = catalog.productToItemSpec(e.productId, e.variantIndex);
    const pos = at(e.u, outOf(e));
    // wall items: origin at the back centre, vertical middle; floor / surface items: bottom centre (models/kit.js).
    // A wall-hung cabinet (params.base 'wall') lifts itself by its mountHeight, so it stands that much lower.
    const lift = e.role === 'bench' && spec.params?.base === 'wall' ? Number(spec.params.mountHeight) || 0 : 0;
    pos[1] = r3(e.role === 'picture' ? e.v + e.h / 2 : e.v - lift);
    const extra = e.role === 'picture' ? { attach: { wallId: hw.wallId, normal: n } } : {};
    const note = { bench: 'Vegghengt 25 cm over gulvet.', decor: 'På skapet.', floor: 'På gulvet ved skapet.' }[e.role] || '';
    return {
      ...spec, ...extra, uid: `${SPECIAL_PREFIX}${proposal.id.toLowerCase()}-${i + 1}`, position: pos, rotationDeg: yaw, level: 'hoved',
      notes: `Spesialforslag ${proposal.id}: ${proposal.name}.${note ? ` ${note}` : ''}`,
    };
  });
}

/** Total price (sale prices) and absorption of a proposal. */
export function specialProposalTotals(proposal, catalog, benchKey = _bench) {
  let price = 0, m2 = 0;
  for (const e of layoutSpecialProposal(proposal, catalog, benchKey)) {
    const p = catalog.getProduct(e.productId);
    price += catalog.priceOf ? (catalog.priceOf(p, e.variantIndex)?.price ?? 0) : (p.salePriceNok ?? p.priceNok ?? 0);
    if (e.role === 'picture') m2 += p.variants?.[e.variantIndex]?.absorption ?? p.absorption ?? 0;
  }
  return { price, m2: Math.round(m2 * 100) / 100 };
}

/** Does an item hang on the high wall or stand / sit against it (what a new special proposal replaces)? */
function againstHighWall(item, hw) {
  if (item.locked || (item.level && item.level !== 'hoved')) return false;
  if (item.attach?.wallId === hw.wallId) return true;
  if (!(item.mount === 'floor' || item.mount === 'surface')) return false;
  if (!['tvbenk', 'skjenk', 'kommode', 'smalamper', 'smatt', 'kunst'].includes(item.category)) return false;
  const p = item.position;
  const out = (p[0] - hw.origin.x) * hw.normal.x + (p[2] - hw.origin.z) * hw.normal.z;
  const u = (p[0] - hw.origin.x) * hw.uDir.x + (p[2] - hw.origin.z) * hw.uDir.z;
  // floor: only sideboards in a 60 cm strip; surface: things up to 60 cm out (on the sideboard)
  if (item.mount === 'floor' && !['tvbenk', 'skjenk', 'kommode'].includes(item.category)) return false;
  return out > -0.01 && out < 0.6 && u > -0.05 && u < hw.width + 0.05;
}

/**
 * Applies a special proposal as one undo step.
 * @param {object} editor  design/Editor.js (design, catalog, home)
 * @param {string} id
 * @param {string} [benchKey]  SPECIAL_BENCHES key (default: the chosen one)
 * @returns {string[]} the new uids
 */
export function applySpecialProposal(editor, id, benchKey = _bench) {
  const proposal = SPECIAL_PROPOSALS.find((p) => p.id === id);
  const design = editor.design;
  const catalog = editor.catalog;
  const hw = editor.home?.layout?.highWall ?? editor.home?.highWall;
  if (!proposal || !design || !catalog || !hw) return [];
  const specs = specialItemSpecs(proposal, catalog, hw, benchKey);
  const uids = [];
  design.transaction(`Spesialforslag ${proposal.id}`, () => {
    for (const item of design.list()) if (isSpecialUid(item.uid) || againstHighWall(item, hw)) design.remove(item.uid);
    if (design.wall?.elements?.length) design.setWallProposal('0');
    for (const s of specs) uids.push(design.add(s));
  });
  return uids;
}

/** The proposal currently in the design (its items still there), or null. */
export function activeSpecialProposal(design) {
  for (const item of design?.list?.() || []) {
    const m = isSpecialUid(item.uid) && /^spf-(s\d+)-/.exec(item.uid);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** The cabinet of the proposal currently in the design (SPECIAL_BENCHES key), or null. */
export function activeSpecialBench(design) {
  for (const item of design?.list?.() || []) {
    if (!isSpecialUid(item.uid)) continue;
    const b = SPECIAL_BENCHES.find((x) => x.id === item.refId);
    if (b) return b.key;
  }
  return null;
}

export const SPECIAL_WALL = { width: WALL_W, height: WALL_H };
