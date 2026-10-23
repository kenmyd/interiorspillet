/**
 * Extra «Fakta» rows of spotter products (design/lighting.md §5.6; MASTER §4.2 P02): «Montering», «Hulltaking»,
 * «Innfellingsdybde», «Spredning», «Vippbar», «Kapsling», «Driver» / «Lyskilde», «Tilkobling», «Selges».
 *   spotFacts(product, params, { catalog, vi }) → Array<[label, value]> (Norwegian)
 * Rows come only from what the product states (params = the product's params with the variant's on top); nothing is
 * shown from the archetype defaults. Pure: no DOM, no three.js.
 */

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
/** Decimal comma, at most `dec` decimals, no trailing zeros: 2.4, 6, 0.75 → «2,4», «6», «0,75». */
const dec = (v, n = 1) => String(Number(v.toFixed(n))).replace('.', ',');
const cm = (m) => `${dec(m * 100, 1)} cm`;
const mm = (m) => `${Math.round(m * 1000)}`;

/** The bulb socket named in the product's bulb text (GU10, E27 …), or null. */
function socketOf(bulb) {
  const m = /\b(GU10|GU5[.,]3|MR16|E27|E14|G9|G4|GX53)\b/i.exec(String(bulb || ''));
  return m ? m[1].toUpperCase().replace('.', ',') : null;
}

function mounting(p, P) {
  const n = fin(P.heads) ? Math.round(P.heads) : null;
  const spots = (k) => `${k} ${k === 1 ? 'spot' : 'spotter'}`;
  switch (p.archetype) {
    case 'downlight':
      return 'Innfelt i taket (monteres av elektriker)';
    case 'downlight-surface':
      return 'Utenpåliggende, skrus rett i taket';
    case 'spot-ceiling':
      return 'Takspot med takkopp';
    case 'spot-track': {
      const k = n ?? 3;
      if (P.railKind === 'plate') return `Rund takplate med ${spots(k)}`;
      if (P.railKind === 'bar') return `Takstang med ${spots(k)}`;
      return `${P.trackShape === 'L' ? 'L-formet skinne' : 'Skinne'} med ${spots(k)}`;
    }
    case 'spot-wall': {
      const where = fin(P.mountHeight) ? ` (forslag: underkant ${cm(P.mountHeight)} over gulvet)` : '';
      return `På veggen${n === 2 ? `, ${spots(2)}` : ''}${where}`;
    }
    case 'picture-light':
      return 'På veggen, over bildet';
    default:
      return null;
  }
}

/**
 * @param {Object} p  product
 * @param {Object} [P]  its params with the variant's on top
 * @returns {Array<[string, string]>}
 */
export function spotFacts(p, P = {}) {
  if (!p || p.category !== 'spotter') return [];
  P = P || {};
  const out = [];
  const a = p.archetype;
  const m = mounting(p, P);
  if (m) out.push(['Montering', m]);
  if (a === 'downlight' && fin(P.cutout) && P.cutout > 0) {
    out.push(['Hulltaking', P.shape === 'square' ? `${mm(P.cutout)} × ${mm(P.cutout)} mm` : `Ø ${mm(P.cutout)} mm`]);
  }
  if (fin(P.recessDepth) && P.recessDepth > 0) out.push(['Innfellingsdybde', `min. ${cm(P.recessDepth)}`]);
  if (fin(P.beamDeg) && P.beamDeg > 0) out.push(['Spredning', `${Math.round(P.beamDeg)}°`]);
  if (a === 'downlight' && typeof P.tiltable === 'boolean') {
    out.push(['Vippbar', P.tiltable ? `Ja, ca. ±${fin(P.tiltMax) ? Math.round(P.tiltMax) : 30}°` : 'Nei']);
  } else if (a === 'spot-ceiling' || a === 'spot-track' || a === 'spot-wall') {
    out.push(['Vippbar', 'Ja, spothodene kan rettes']);
  }
  if (fin(P.ip) && P.ip > 0) {
    const ip = Math.round(P.ip);
    out.push(['Kapsling', ip >= 44 ? `IP${ip} – tåler fukt (kan brukes på bad)` : `IP${ip} – for tørre rom`]);
  }
  if (P.driver === 'integrated') out.push(['Driver', 'Integrert LED (driver følger med)']);
  else if (P.driver === 'separate') out.push(['Driver', 'Egen driver trengs (sjekk om den følger med)']);
  else if (P.driver === 'socket') {
    const bulb = p.light?.bulb || '';
    const s = socketOf(bulb);
    const separate = /ikke inkludert|anbefalt|kjøpes separat/i.test(bulb);
    out.push(['Lyskilde', `${s ? `${s}-sokkel` : 'Sokkel for lyspære'}${separate ? ' – pære kjøpes separat' : ''}`]);
  }
  if (P.powered === 'cord') out.push(['Tilkobling', 'Ledning med støpsel']);
  else if (P.powered === 'battery') out.push(['Tilkobling', 'Batteri (ingen ledning)']);
  else if (P.powered === 'wired') out.push(['Tilkobling', 'Fast tilkobling (elektriker)']);
  const pack = fin(p.packSize) && p.packSize > 1 ? Math.round(p.packSize) : 0;
  if (pack) out.push(['Selges', `${pack}-pakning (prisen er per stk.; handlelista regner hele pakker)`]);
  return out;
}
