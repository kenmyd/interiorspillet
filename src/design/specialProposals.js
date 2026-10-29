// «Spesialforslag» for the high wall: one sideboard from the Spesialkatalog (BESTÅ 180 / 240, EKET) with one to three
// canvasbutik.no sound-absorbing pictures over it and a little decor on top. Unlike the wall proposals
// (data/wall-proposals.json, wall-design elements), these are ordinary catalogue items, so a picture can be clicked
// and switched between its store sizes in the inspector.
//
// CONTRACT
//   SPECIAL_PROPOSALS                         [{ id, name, description, bench, pictures, align, gap, decor, shift? }]
//   layoutSpecialProposal(proposal, catalog)  → [{ role, productId, variantIndex, u, v, w, h, d, spec }] wall coordinates
//                                              (u from the niche corner, v up from the floor; v = bottom edge)
//   specialItemSpecs(proposal, catalog, highWall) → item specs for DesignState.add (uid «spf-…», world positions)
//   applySpecialProposal(editor, id)          one undo step: removes the last special proposal and what hangs on the
//                                              high wall / stands against it, clears a wall design, adds the items
//   isSpecialUid(uid)
//
// Units: metres. The high wall (layout.highWall): x = 3.22, u runs along −z from z = 8.34, 3.91 wide, 3.0 high.
// Sideboards hang on the wall 25 cm over the floor (BESTÅ / EKET on the wall rail), the pictures start 25 cm over the
// sideboard top. Positions of the decor: `at` −1 … 1 along the sideboard (−1 = the end by the niche).

export const SPECIAL_PREFIX = 'spf-';
export const isSpecialUid = (uid) => typeof uid === 'string' && uid.startsWith(SPECIAL_PREFIX);

const B180 = 'ikea-besta-tv-benk-dorer-180-mork';
const B240 = 'ikea-besta-tv-benk-dorer-240-mork';
const EKET = 'ikea-eket-medieoppbevaring-210-valnott';
const ART = (slug) => `canvasbutik-lyddempende-bilde-${slug}`;

const TURNER = 'bohus-sindig-turner-bordlampe-h42';
const CERES = 'bohus-halvor-bakke-ceres-lysestake-h40';
const MARMI = 'bohus-halvor-bakke-marmi-lykt-h59';
const EUCA = 'bohus-viridis-eucalyptus-h78';
const ANTH = 'bohus-viridis-anthurium-h80';
const FERN = 'bohus-mr-plant-ormbunke-h70';
const IVY = 'bohus-mr-plant-gullranke-l70';
const PORCINI = 'bohus-sindig-porcini-oppladbar-bordlampe-o23';
const TILLER = 'bohus-sindig-tiller-oppladbar-bordlampe-o18';
const NOOR = 'bohus-sindig-noor-bordlampe-h24';
const ISHIDA = 'bohus-sindig-ishida-bordlampe-h55';
const MAGNOR = 'bohus-magnor-rocks-xo-bordlampe-h24-4';
const CETA = 'bohus-sindig-ceta-bordlampe-h43';
const TERRA = 'bohus-sindig-terra-bordlampe-h58';

// canvas size variants (tools/build-spesialkatalog.mjs SIZES): 0 = 50 × 70, 1 = 70 × 100, 2 = 80 × 120, 3 = 100 × 150,
// 4 = 120 × 180 (a landscape motif turns them: 70 × 50 … 180 × 120)
const S50 = 0, S70 = 1, S80 = 2, S100 = 3, S120 = 4;
const pic = (slug, size) => ({ id: ART(slug), v: size });
const dec = (id, at, v = 0) => ({ id, at, v });

export const SPECIAL_PROPOSALS = Object.freeze([
  {
    id: 'S1', name: 'Paret fra skissen – stor og liten over BESTÅ',
    description: 'Som i ditt eget forsøk: et stort «Soft Leaves» og et mindre «Timeless Peaks» midtstilt over en vegghengt BESTÅ 180 i Lappviken brunsvart. Turner-lampen gir lys på skjenken.',
    bench: { id: B180, v: 2 }, pictures: [pic('soft-leaves', S100), pic('timeless-peaks', S70)], align: 'center',
    decor: [dec(CERES, -0.82), dec(TURNER, 0.8)],
  },
  {
    id: 'S2', name: 'Ett stort bilde – The Heat Between 120 × 180',
    description: 'Ett stort lerret midt på veggen over en lang BESTÅ 240 i valnøtt. Rolig og tydelig, og det største bildet demper mest.',
    bench: { id: B240, v: 1 }, pictures: [pic('the-heat-between', S120)], align: 'bottom',
    decor: [dec(MARMI, -0.8), dec(EUCA, 0.82)],
  },
  {
    id: 'S3', name: 'Liggende panorama – Brown Layers 180 × 120',
    description: 'Ett bredt, liggende bilde som følger den lange skjenken. Lagene i motivet gjentar de vannrette linjene i BESTÅ 240 brunsvart.',
    bench: { id: B240, v: 0 }, pictures: [pic('brown-layers', S120)], align: 'bottom',
    decor: [dec(PORCINI, -0.82, 3), dec(FERN, 0.84)],
  },
  {
    id: 'S4', name: 'Tre i rekke – sirkler, former og balanse',
    description: 'Tre like store bilder (70 × 100) i rekke over BESTÅ 240. En rolig rytme med tre beslektede motiver i brunt.',
    bench: { id: B240, v: 0 }, pictures: [pic('brown-circles', S70), pic('brown-shapes', S70), pic('brown-balance', S70)], align: 'bottom', gap: 0.1,
    decor: [dec(CERES, -0.86), dec(TILLER, 0.84, 1)],
  },
  {
    id: 'S5', name: 'To like – Ethereal Strata og Framed Stillness',
    description: 'To 80 × 120 side om side over BESTÅ 180 med Hedeviken-dører i brunbeiset eik. Symmetrisk og rolig.',
    bench: { id: B180, v: 0 }, pictures: [pic('ethereal-strata', S80), pic('framed-stillness', S80)], align: 'bottom',
    decor: [dec(TURNER, -0.8), dec(ANTH, 0.84)],
  },
  {
    id: 'S6', name: 'EKET i valnøtt med Amber Flow',
    description: 'Lav EKET i brun valnøtt med ett liggende «Amber Flow» (150 × 100). Ishida-lampen i valnøtt henter fargen fra skapet.',
    bench: { id: EKET, v: 0 }, pictures: [pic('amber-flow', S100)], align: 'bottom',
    decor: [dec(ISHIDA, -0.8, 1), dec(CERES, 0.84)],
  },
  {
    id: 'S7', name: 'Stor og liten – toppjustert',
    description: '«Dual Profile» i 100 × 150 og et lite «Abstract Oval» med felles overkant over BESTÅ 180 Björköviken. Litt mer leken enn midtstilt.',
    bench: { id: B180, v: 1 }, pictures: [pic('dual-profile', S100), pic('abstract-oval', S50)], align: 'top',
    decor: [dec(IVY, -0.78), dec(NOOR, 0.84, 1)],
  },
  {
    id: 'S8', name: 'Triptyk – høyt i midten',
    description: 'Et 80 × 120 i midten med to små 50 × 70 på sidene, midtstilt. Over BESTÅ 240 i Krukmakare mørk grågrønn, som spiller fint mot de varme brunfargene.',
    bench: { id: B240, v: 2 }, pictures: [pic('earth-leaves', S50), pic('soft-leaves', S80), pic('timeless-peaks', S50)], align: 'center', gap: 0.1,
    decor: [dec(MARMI, -0.84), dec(PORCINI, 0.84, 2)],
  },
  {
    id: 'S9', name: 'Røkt glass og sirkler',
    description: 'BESTÅ 180 med Glassvik-dører i røkfarget glass og et liggende «Circles In Brown» (120 × 80). Glasset gir litt glans mellom alt det matte.',
    bench: { id: B180, v: 5 }, pictures: [pic('circles-in-brown', S80)], align: 'bottom',
    decor: [dec(MAGNOR, -0.78, 1), dec(EUCA, 0.82)],
  },
  {
    id: 'S10', name: 'Liggende par over valnøtt',
    description: 'To liggende 100 × 70 – «Brown Forms» og «Abstract In Brown» – over BESTÅ 240 i valnøtt. Bred og lav komposisjon som gjør veggen roligere.',
    bench: { id: B240, v: 1 }, pictures: [pic('brown-forms', S70), pic('abstract-in-brown', S70)], align: 'center',
    decor: [dec(TURNER, -0.84), dec(CERES, 0.86)],
  },
  {
    id: 'S11', name: 'Timmerviken og When We Break',
    description: 'Sort BESTÅ 180 med Timmerviken-dører og ett 80 × 120 «When We Break». Den sorte skjenken gir tyngde, bildet varme.',
    bench: { id: B180, v: 4 }, pictures: [pic('when-we-break', S80)], align: 'bottom',
    decor: [dec(CERES, -0.82), dec(TERRA, 0.8)],
  },
  {
    id: 'S12', name: 'Asymmetrisk – stor mot nisjen, plante mot døra',
    description: '«Brown Balance» 100 × 150 og «Abstract Oval» 70 × 100 forskjøvet mot nisjen over EKET, med en høy anthurium i den åpne enden mot døra.',
    bench: { id: EKET, v: 0 }, pictures: [pic('brown-balance', S100), pic('abstract-oval', S70)], align: 'bottom', shift: -0.25,
    decor: [dec(ANTH, 0.84)],
  },
  {
    id: 'S13', name: 'Tre store – 80 × 120 i rekke',
    description: 'Tre 80 × 120 – «The Heat Between», «When We Break» og «Dual Profile» – over BESTÅ 240 brunsvart. Mest bilde og mest demping av treerne.',
    bench: { id: B240, v: 0 }, pictures: [pic('the-heat-between', S80), pic('when-we-break', S80), pic('dual-profile', S80)], align: 'bottom', gap: 0.1,
    decor: [dec(TILLER, -0.86, 1), dec(FERN, 0.86)],
  },
  {
    id: 'S14', name: 'Rolig valnøtt – Timeless Peaks 100 × 150',
    description: 'BESTÅ 180 i Lappviken valnøtt med ett 100 × 150 «Timeless Peaks». Fjellene i motivet gir dybde til veggen.',
    bench: { id: B180, v: 3 }, pictures: [pic('timeless-peaks', S100)], align: 'bottom',
    decor: [dec(TILLER, -0.8, 1), dec(FERN, 0.82)],
  },
  {
    id: 'S15', name: 'Panorama over EKET',
    description: 'Det store, liggende «Brown Layers» (180 × 120) over EKET i valnøtt. Bildet er nesten like bredt som skapet.',
    bench: { id: EKET, v: 0 }, pictures: [pic('brown-layers', S120)], align: 'bottom',
    decor: [dec(PORCINI, -0.84, 3), dec(MARMI, 0.84)],
  },
  {
    id: 'S16', name: 'To store – 120 × 180 side om side',
    description: '«Soft Leaves» og «Earth Leaves» i største størrelse over BESTÅ 240 valnøtt. Dekker nesten hele veggen og demper mest av alle forslagene.',
    bench: { id: B240, v: 1 }, pictures: [pic('soft-leaves', S120), pic('earth-leaves', S120)], align: 'bottom',
    decor: [dec(CERES, -0.86), dec(TURNER, 0.84)],
  },
  {
    id: 'S17', name: 'Grågrønt og brunt – to 100 × 150',
    description: 'BESTÅ 240 i Krukmakare mørk grågrønn med «Ethereal Strata» og «Framed Stillness» i 100 × 150. Eukalyptusen binder det grønne og det brune sammen.',
    bench: { id: B240, v: 2 }, pictures: [pic('ethereal-strata', S100), pic('framed-stillness', S100)], align: 'bottom',
    decor: [dec(EUCA, -0.84), dec(CETA, 0.84)],
  },
  {
    id: 'S18', name: 'Lite og stort – bunnjustert',
    description: 'Et lite, liggende «Amber Flow» (70 × 50) ved siden av «Abstract Oval» 80 × 120, med felles underkant over BESTÅ 180 Hedeviken.',
    bench: { id: B180, v: 0 }, pictures: [pic('amber-flow', S50), pic('abstract-oval', S80)], align: 'bottom',
    decor: [dec(NOOR, -0.82, 0), dec(IVY, 0.8)],
  },
  {
    id: 'S19', name: 'Tre liggende – sirkler, former, abstrakt',
    description: 'Tre liggende 100 × 70 over BESTÅ 240 brunsvart. Et bredt bånd av bilder i øyehøyde fra spisebordet.',
    bench: { id: B240, v: 0 }, pictures: [pic('circles-in-brown', S70), pic('brown-forms', S70), pic('abstract-in-brown', S70)], align: 'center', gap: 0.1,
    decor: [dec(CERES, -0.86), dec(MAGNOR, 0.82, 1)],
  },
  {
    id: 'S20', name: 'Forskjøvet mot nisjen – Brown Balance 120 × 180',
    description: 'BESTÅ 180 Björköviken og ett stort «Brown Balance» flyttet mot nisjehjørnet, så det blir luft mot døra og bryterne.',
    bench: { id: B180, v: 1, u: 1.45 }, pictures: [pic('brown-balance', S120)], align: 'bottom',
    decor: [dec(MARMI, -0.82), dec(ANTH, 0.84)],
  },
]);

// ---------------------------------------------------------------------------------------------------------------

const WALL_W = 3.91;
const BENCH_U = 1.95; // the middle of the wall
const BENCH_Y = 0.25; // wall-hung, 25 cm over the floor
const PIC_GAP_OVER = 0.25; // from the sideboard top to the lowest picture
const r3 = (x) => Math.round(x * 1000) / 1000;

function dimsOf(catalog, id, v) {
  const p = catalog.getProduct(id);
  if (!p) throw new Error(`[specialProposals] ukjent produkt ${id}`);
  const vv = p.variants?.[v];
  return { product: p, dims: vv?.dims ? { ...p.dims, ...vv.dims } : p.dims };
}

/**
 * Wall coordinates of everything in a proposal (v = bottom edge, u = centre).
 * @param {object} proposal  one of SPECIAL_PROPOSALS
 * @param {{ getProduct: (id: string) => object }} catalog  catalog/index.js
 */
export function layoutSpecialProposal(proposal, catalog) {
  const out = [];
  const b = dimsOf(catalog, proposal.bench.id, proposal.bench.v);
  const bu = proposal.bench.u ?? BENCH_U;
  const top = BENCH_Y + b.dims.h;
  out.push({ role: 'bench', productId: b.product.id, variantIndex: proposal.bench.v, u: bu, v: BENCH_Y, w: b.dims.w, h: b.dims.h, d: b.dims.d });

  const gap = proposal.gap ?? 0.12;
  const pics = proposal.pictures.map((p) => ({ p, ...dimsOf(catalog, p.id, p.v) }));
  const total = pics.reduce((s, x) => s + x.dims.w, 0) + gap * (pics.length - 1);
  const maxH = Math.max(...pics.map((x) => x.dims.h));
  const base = top + PIC_GAP_OVER;
  let u = bu + (proposal.shift ?? 0) - total / 2;
  for (const x of pics) {
    const hh = x.dims.h;
    const v = proposal.align === 'top' ? base + maxH - hh : proposal.align === 'center' ? base + (maxH - hh) / 2 : base;
    out.push({ role: 'picture', productId: x.product.id, variantIndex: x.p.v, u: r3(u + x.dims.w / 2), v: r3(v), w: x.dims.w, h: hh, d: x.dims.d });
    u += x.dims.w + gap;
  }

  for (const d of proposal.decor || []) {
    const x = dimsOf(catalog, d.id, d.v);
    const half = b.dims.w / 2 - x.dims.w / 2 - 0.04;
    out.push({ role: 'decor', productId: x.product.id, variantIndex: d.v, u: r3(bu + d.at * half), v: r3(top), w: x.dims.w, h: x.dims.h, d: x.dims.d, benchD: b.dims.d });
  }
  return out;
}

/**
 * Item specs (world positions) for DesignState.add.
 * @param {object} proposal
 * @param {object} catalog  catalog/index.js (getProduct, productToItemSpec)
 * @param {{ wallId: string, origin: {x:number,z:number}, uDir: {x:number,z:number}, normal: {x:number,z:number} }} hw  layout.highWall
 */
export function specialItemSpecs(proposal, catalog, hw) {
  const n = [hw.normal.x, 0, hw.normal.z];
  const yaw = Math.round((Math.atan2(n[0], n[2]) * 180) / Math.PI);
  const at = (u, out) => [r3(hw.origin.x + hw.uDir.x * u + n[0] * out), null, r3(hw.origin.z + hw.uDir.z * u + n[2] * out)];
  return layoutSpecialProposal(proposal, catalog).map((e, i) => {
    const spec = catalog.productToItemSpec(e.productId, e.variantIndex);
    const pos = at(e.u, e.role === 'picture' ? 0 : e.role === 'bench' ? e.d / 2 : e.benchD / 2);
    // wall items: origin at the back centre, vertical middle; floor / surface items: bottom centre (models/kit.js)
    pos[1] = r3(e.role === 'picture' ? e.v + e.h / 2 : e.v);
    const extra = e.role === 'picture' ? { attach: { wallId: hw.wallId, normal: n } } : {};
    const note = e.role === 'bench' ? 'Vegghengt 25 cm over gulvet (BESTÅ/EKET-skinne).' : e.role === 'decor' ? 'På skjenken.' : '';
    return {
      ...spec, ...extra, uid: `${SPECIAL_PREFIX}${proposal.id.toLowerCase()}-${i + 1}`, position: pos, rotationDeg: yaw, level: 'hoved',
      notes: `Spesialforslag ${proposal.id}: ${proposal.name}.${note ? ` ${note}` : ''}`,
    };
  });
}

/** Total price (sale prices) and absorption of a proposal. */
export function specialProposalTotals(proposal, catalog) {
  let price = 0, m2 = 0;
  for (const e of layoutSpecialProposal(proposal, catalog)) {
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
 * @returns {string[]} the new uids
 */
export function applySpecialProposal(editor, id) {
  const proposal = SPECIAL_PROPOSALS.find((p) => p.id === id);
  const design = editor.design;
  const catalog = editor.catalog;
  const hw = editor.home?.layout?.highWall ?? editor.home?.highWall;
  if (!proposal || !design || !catalog || !hw) return [];
  const specs = specialItemSpecs(proposal, catalog, hw);
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

export const SPECIAL_WALL = { width: WALL_W, height: 3 };
