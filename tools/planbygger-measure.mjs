#!/usr/bin/env node
/**
 * Planbygger: how close does the automatic detection get to the owner's hand-built house – before and after the
 * corrections a user makes in the editor (tools/planbygger-corrections.mjs)?
 *
 *   node tools/planbygger-measure.mjs            prints the tables
 *   node tools/planbygger-measure.mjs --write    and writes them into notes/planbygger.md (between the markers)
 *   node tools/planbygger-measure.mjs --json     the raw numbers
 *
 * The user's inputs are what the page asks for: the scale from one dimension line (snapped with traceLine, the
 * longest line of the plan: «12.21 m» on the ground floor, «10.50 m» in the basement) and north = left in the image.
 * The ground truth is src/data/room-spec.json (research/house/*.json merged). The basement data use the plan unscaled
 * (hele-huset-avstemming.md V1–V2: 60,25 px/m in x and z, the inner faces +0,13 m so the facades line up with the
 * ground floor): the comparison after the best translation takes that offset out.
 */
import { ROOT, imp, readJson, planPipeline, validateGenerated, KJELLER_PLAN } from './planbygger-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { readPng } from './planbygger-png.mjs';
import { truthLevel, generatedLevel, compare } from './planbygger-truth.mjs';
import { CORRECTIONS, ownerStair } from './planbygger-corrections.mjs';

const args = process.argv.slice(2);
const E = await imp('src/planbygger/export.js');
const S = await imp('src/planbygger/scale.js');
const I = await imp('src/planbygger/image.js');
const spec = readJson('src/data/room-spec.json');

/** The scale a user gets by clicking a dimension line and typing its number. */
function userScale(file, click, metres) {
  const grey = I.luma(readPng(file));
  const t = S.traceLine(grey, click[0], click[1]);
  if (!t) throw new Error(`fant ikke målelinja ved ${click}`);
  return { pxPerM: t.length / metres, px: t.length, metres };
}

/** Best translation of the generated faces onto the truth: medians of the signed errors along x and z. */
function bestShift(T, G, iterations = 3) {
  let shift = [0, 0];
  for (let it = 0; it < iterations; it++) {
    const ex = [];
    const ez = [];
    for (const t of T.walls) {
      for (let k = 0; k < Math.max(1, Math.round(t.L / 0.1)); k++) {
        const p = [t.a[0] + t.d[0] * (k + 0.5) * 0.1, t.a[1] + t.d[1] * (k + 0.5) * 0.1];
        let best = null;
        for (const g of G.walls) {
          if (Math.abs(g.d[0] * t.d[1] - g.d[1] * t.d[0]) > 0.05 || g.n[0] * t.n[0] + g.n[1] * t.n[1] < 0.9) continue;
          const ga = [g.a[0] + shift[0], g.a[1] + shift[1]];
          const u = (p[0] - ga[0]) * g.d[0] + (p[1] - ga[1]) * g.d[1];
          if (u < -0.02 || u > g.L + 0.02) continue;
          const e = (p[0] - ga[0]) * g.n[0] + (p[1] - ga[1]) * g.n[1];
          if (Math.abs(e) <= 0.15 && (!best || Math.abs(e) < Math.abs(best.e))) best = { e, n: g.n };
        }
        if (!best) continue;
        if (Math.abs(best.n[0]) > 0.9) ex.push(best.e * Math.sign(best.n[0]));
        if (Math.abs(best.n[1]) > 0.9) ez.push(best.e * Math.sign(best.n[1]));
      }
    }
    const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);
    shift = [shift[0] + med(ex), shift[1] + med(ez)];
  }
  return shift;
}
const shifted = (G, s) => ({
  walls: G.walls.map((w) => ({ ...w, a: [w.a[0] + s[0], w.a[1] + s[1]], b: [w.b[0] + s[0], w.b[1] + s[1]] })),
  openings: G.openings.map((o) => ({ ...o, centre: [o.centre[0] + s[0], o.centre[1] + s[1]] })),
  rooms: G.rooms.map((r) => ({ ...r, polygon: r.polygon.map((p) => [p[0] + s[0], p[1] + s[1]]) })),
});

const PLANS = [
  { key: 'hoved', name: '1. etasje', file: path.join(ROOT, 'plantegning.png'), truthLevel: 'hoved', line: { click: [540, 300], metres: 12.21 }, zScale: [1] },
  { key: 'kjeller', name: 'Kjeller', file: KJELLER_PLAN, truthLevel: 'kjeller', line: { click: [300, 918], metres: 10.5 }, zScale: [1] },
];

const results = [];
for (const P of PLANS) {
  if (!P.file || !fs.existsSync(P.file)) {
    results.push({ key: P.key, skipped: 'planen finnes ikke (bilder_hus/ er gitignorert)' });
    continue;
  }
  const scale = userScale(P.file, P.line.click, P.line.metres);
  const t0 = Date.now();
  const { doc, det } = await planPipeline(P.file, { pxPerM: scale.pxPerM, north: 270, name: P.name });
  const detMs = Date.now() - t0;
  const variants = { auto: doc };
  const corr = CORRECTIONS[P.key];
  let edits = [];
  if (corr) {
    const fixed = JSON.parse(JSON.stringify(doc));
    edits = corr(fixed);
    variants.rettet = fixed;
  }
  const out = { key: P.key, name: P.name, scale, detMs, detected: { walls: det.walls.length, doors: det.openings.filter((o) => o.type === 'door').length, windows: det.openings.filter((o) => o.type === 'window').length, openings: det.openings.filter((o) => o.type === 'opening').length }, edits, variants: {} };
  for (const [vname, d] of Object.entries(variants)) {
    const ex = E.exportHouse(d);
    const val = await validateGenerated(ex);
    const G = generatedLevel(ex.house, 'hoved');
    const per = {};
    for (const zs of P.zScale) {
      const T = truthLevel(spec, P.truthLevel, { zScale: zs });
      const raw = compare(T, G);
      const s = bestShift(T, G);
      const fit = compare(T, shifted(G, s));
      per[zs === 1 ? 'data' : 'plan'] = { raw, fit, shift: s };
    }
    out.variants[vname] = { errors: val.errors, warnings: val.warnings.length, counts: ex.report.counts, area: E.summary(ex.house).area, cmp: per };
  }
  results.push(out);
}

// ---- the whole house: the basement under the ground floor, placed only by the alignment rule (the NE outer corner,
//      avstemming V1) – no best translation: how far is the basement from the hand-placed data?
let whole = null;
if (KJELLER_PLAN && fs.existsSync(KJELLER_PLAN)) {
  const M = await imp('src/planbygger/model.js');
  const D = await imp('src/planbygger/detect.js');
  const hs = userScale(path.join(ROOT, 'plantegning.png'), PLANS[0].line.click, PLANS[0].line.metres);
  const ks = userScale(KJELLER_PLAN, PLANS[1].line.click, PLANS[1].line.metres);
  const { doc } = await planPipeline(path.join(ROOT, 'plantegning.png'), { pxPerM: hs.pxPerM, north: 270, name: 'Hele huset' });
  const img = readPng(KJELLER_PLAN);
  const kj = M.createLevel(doc, { id: 'kjeller', name: 'Kjeller', floorY: -2.55, image: { name: 'plantegning_kjeller.png', width: img.width, height: img.height, pxPerM: ks.pxPerM } });
  M.applyDetection(kj, D.detectPlan(img, { pxPerM: ks.pxPerM }), ks.pxPerM, doc.settings);
  E.alignLevel(doc, kj, doc.levels[0], 'ne');
  const fixed = JSON.parse(JSON.stringify(doc));
  const edits = [...CORRECTIONS.hoved(fixed, fixed.levels[0]), ...CORRECTIONS.kjeller(fixed, fixed.levels[1]), ...ownerStair(fixed.levels[0])];
  whole = { edits, variants: {} };
  for (const [name, d] of Object.entries({ auto: doc, rettet: fixed })) {
    const ex = E.exportHouse(d);
    const val = await validateGenerated(ex);
    const T = truthLevel(spec, 'kjeller');
    const G = generatedLevel(ex.house, 'kjeller');
    const raw = compare(T, G);
    const Th = truthLevel(spec, 'hoved');
    const Gh = generatedLevel(ex.house, 'hoved');
    // the stair against 20-trapp.json: risers, going on the validator's walk line, the footprint overlap
    let stair = null;
    const gs = ex.house.stairs?.[0];
    const ts = spec.stairs?.[0];
    if (gs && ts) {
      const H = await imp('src/data/scripts/house.mjs');
      const walkG = H.stairWalk(gs, { bound: gs.footprint }).length;
      const walkT = H.stairWalk(ts, { bound: ts.footprint }).length;
      const { overlapArea } = await import('./planbygger-truth.mjs');
      const fpT = ts.footprint;
      const fpG = gs.footprint ?? ex.house.floorOpenings[0].polygon;
      const areaOf = (P) => Math.abs(P.reduce((s, p, i) => s + p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1], 0) / 2);
      const ov = overlapArea(fpT, fpG);
      const topT = ts.top.edge;
      const topG = gs.top.edge;
      stair = {
        type: gs.type,
        risers: [ts.risers, gs.risers],
        going: [walkT / (ts.risers - 1), walkG / (gs.risers - 1)],
        footprintIoU: ov / (areaOf(fpT) + areaOf(fpG) - ov),
        topEdgeCm: Math.hypot((topT[0][0] + topT[1][0]) / 2 - (topG[0][0] + topG[1][0]) / 2, (topT[0][1] + topT[1][1]) / 2 - (topG[0][1] + topG[1][1]) / 2) * 100,
        warnings: val.warnings.filter((w) => w.startsWith('stairs/')),
      };
    }
    whole.variants[name] = { errors: val.errors.length, warnings: val.warnings.length, counts: ex.report.counts, kjeller: raw, hoved: compare(Th, Gh), shift: bestShift(T, G), stair };
  }
}

// ---- report
const f1 = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d).replace('.', ','));
const pct = (v) => `${f1(v * 100, 0)} %`;
const lines = [];
for (const r of results) {
  if (r.skipped) {
    lines.push(`### ${r.key}\n\nHoppet over: ${r.skipped}.\n`);
    continue;
  }
  lines.push(`### ${r.name}`);
  lines.push('');
  lines.push(`Skala fra målelinja «${f1(r.scale.metres, 2)} m» (${f1(r.scale.px, 0)} px): ${f1(r.scale.pxPerM, 2)} px/m. Gjenkjenningen tok ${r.detMs} ms og fant ${r.detected.walls} vegger, ${r.detected.doors} dører, ${r.detected.windows} vinduer og ${r.detected.openings} åpninger.`);
  lines.push('');
  const cols = Object.keys(r.variants);
  const label = { auto: 'Automatisk', rettet: 'Etter retting' };
  for (const which of Object.keys(r.variants.auto.cmp)) {
    const title = which === 'data' ? 'mot dataene slik de er bygd' : 'mot planens egen geometri (strekkingen på 6,1 % i z tatt bort)';
    lines.push(`**Vegger ${title}**`);
    lines.push('');
    lines.push(`| | ${cols.map((c) => label[c]).join(' | ')} |`);
    lines.push(`|---|${cols.map(() => '---').join('|')}|`);
    const row = (name, fn) => lines.push(`| ${name} | ${cols.map((c) => fn(r.variants[c].cmp[which])).join(' | ')} |`);
    row('Veggflater funnet (innen 15 cm, av lengden)', (x) => pct(x.raw.walls.coverage));
    row('Snittavvik, rå', (x) => `${f1(x.raw.walls.meanCm)} cm`);
    row('Median / p90 / maks, rå', (x) => `${f1(x.raw.walls.medianCm)} / ${f1(x.raw.walls.p90Cm)} / ${f1(x.raw.walls.maxCm)} cm`);
    row('Beste parallellforskyvning (x, z)', (x) => `${f1(x.shift[0] * 100)}, ${f1(x.shift[1] * 100)} cm`);
    row('Snittavvik etter forskyvning', (x) => `${f1(x.fit.walls.meanCm)} cm`);
    row('Median / p90 / maks etter forskyvning', (x) => `${f1(x.fit.walls.medianCm)} / ${f1(x.fit.walls.p90Cm)} / ${f1(x.fit.walls.maxCm)} cm`);
    row('Veggflater funnet etter forskyvning', (x) => pct(x.fit.walls.coverage));
    row('Ekstra veggflate (ikke i fasiten)', (x) => `${f1(x.fit.walls.extraLength, 2)} m av ${f1(x.fit.walls.generatedLength, 1)} m`);
    lines.push('');
  }
  const which = 'plan' in r.variants.auto.cmp ? 'plan' : 'data';
  lines.push(`**Dører, vinduer og åpninger** (${which === 'plan' ? 'mot planens geometri' : 'mot dataene'}, etter forskyvning; funnet = senteret innen 60 cm på en parallell vegg)`);
  lines.push('');
  lines.push(`| | Fasit | ${cols.map((c) => label[c]).join(' | ')} |`);
  lines.push(`|---|---|${cols.map(() => '---').join('|')}|`);
  for (const ty of ['door', 'window', 'opening']) {
    const nm = { door: 'Dører', window: 'Vinduer', opening: 'Åpninger uten dør' }[ty];
    const t = r.variants.auto.cmp[which].fit.openings.byType[ty].truth;
    lines.push(`| ${nm} | ${t} | ${cols.map((c) => {
      const b = r.variants[c].cmp[which].fit.openings.byType[ty];
      return `${b.found} funnet, ${b.typeOk} riktig type${ty === 'door' ? `, ${b.oriented} slår riktig vei` : ''} (${b.generated} foreslått)`;
    }).join(' | ')} |`);
  }
  lines.push(`| Senteravvik, snitt | | ${cols.map((c) => `${f1(r.variants[c].cmp[which].fit.openings.centreMeanCm)} cm`).join(' | ')} |`);
  lines.push(`| Breddeavvik, snitt | | ${cols.map((c) => `${f1(r.variants[c].cmp[which].fit.openings.widthMeanAbsCm)} cm`).join(' | ')} |`);
  lines.push(`| Ikke funnet | | ${cols.map((c) => r.variants[c].cmp[which].fit.openings.missed.map((m) => `\`${m.id}\``).join(', ') || '–').join(' | ')} |`);
  lines.push(`| Ekstra | | ${cols.map((c) => r.variants[c].cmp[which].fit.openings.extra.length).join(' | ')} |`);
  lines.push('');
  lines.push(`**Rommene** (${which === 'plan' ? 'mot planens geometri' : 'mot dataene'}, etter forskyvning)`);
  lines.push('');
  lines.push(`| Rom (fasit) | Areal fasit | ${cols.map((c) => `${label[c]}: areal (IoU)`).join(' | ')} |`);
  lines.push(`|---|---|${cols.map(() => '---').join('|')}|`);
  for (let i = 0; i < r.variants.auto.cmp[which].fit.rooms.length; i++) {
    const t = r.variants.auto.cmp[which].fit.rooms[i];
    lines.push(`| ${t.name} | ${f1(t.truthArea, 2)} m² | ${cols.map((c) => {
      const x = r.variants[c].cmp[which].fit.rooms[i];
      return x.genArea == null ? 'ikke funnet' : `${f1(x.genArea, 2)} m² (${f1(x.iou * 100, 0)} %)${x.nameOk ? ', navn ✓' : `, «${x.genName}»`}${x.kindOk ? ', type ✓' : `, type ${x.genKind}`}`;
    }).join(' | ')} |`);
  }
  lines.push('');
  lines.push(`Validatoren (\`validateHouse\`): ${cols.map((c) => `${label[c]}: ${r.variants[c].errors.length} feil, ${r.variants[c].warnings} advarsler`).join('; ')}.`);
  if (r.edits.length) {
    lines.push('');
    lines.push(`Rettingene (${r.edits.length} handlinger i editoren): ${r.edits.map((e) => e).join('; ')}.`);
  }
  lines.push('');
}
if (whole) {
  const cols = Object.keys(whole.variants);
  const label = { auto: 'Automatisk', rettet: 'Etter retting' };
  lines.push('### Hele huset: kjelleren under 1. etasje');
  lines.push('');
  lines.push('Kjelleren er plassert bare med justeringsregelen «ytterhjørnet NØ mot hovedetasjen», uten noen beste forskyvning. Tallene viser hvor nær regelen kommer eierens håndplasserte kjeller (avstemming V1: ytterflatene i flukt).');
  lines.push('');
  lines.push(`| | ${cols.map((c) => label[c]).join(' | ')} |`);
  lines.push(`|---|${cols.map(() => '---').join('|')}|`);
  const row = (name, fn) => lines.push(`| ${name} | ${cols.map((c) => fn(whole.variants[c])).join(' | ')} |`);
  row('Kjelleren: veggflater funnet (innen 15 cm)', (x) => pct(x.kjeller.walls.coverage));
  row('Kjelleren: snittavvik / median / p90', (x) => `${f1(x.kjeller.walls.meanCm)} / ${f1(x.kjeller.walls.medianCm)} / ${f1(x.kjeller.walls.p90Cm)} cm`);
  row('Kjelleren: rest-forskyvning (x, z) som regelen ikke fanget', (x) => `${f1(x.shift[0] * 100)}, ${f1(x.shift[1] * 100)} cm`);
  row('1. etasje: snittavvik', (x) => `${f1(x.hoved.walls.meanCm)} cm`);
  row('Dører i hele huset (fasit 11)', (x) => `${x.hoved.openings.byType.door.found + x.kjeller.openings.byType.door.found} funnet, ${x.hoved.openings.byType.door.oriented + x.kjeller.openings.byType.door.oriented} slår riktig vei`);
  row('Vinduer i hele huset (fasit 13)', (x) => `${x.hoved.openings.byType.window.found + x.kjeller.openings.byType.window.found} funnet`);
  row('Trappa (fasit: halvsvingt, 13 opptrinn)', (x) => (x.stair ? `${x.stair.type === 'half-turn-winder' ? 'U-trapp' : x.stair.type}, ${x.stair.risers[1]} opptrinn, inntrinn ${f1(x.stair.going[1], 3)} (fasit ${f1(x.stair.going[0], 3)}), fotavtrykk ${f1(x.stair.footprintIoU * 100, 0)} % IoU, øverste trinnkant ${f1(x.stair.topEdgeCm, 0)} cm unna` : 'ingen'));
  row('Validatoren', (x) => `${x.errors} feil, ${x.warnings} advarsler`);
  lines.push('');
  lines.push(`Rettingene i hele huset er de to listene over pluss trappa (${whole.edits.length} handlinger): ${whole.edits.slice(-4).join('; ')}. Trappa er tegnet som U-trapp over trapperommet. Eierens trapp har et kort øvre løp (1 rett trinn) og et lengre nedre løp, mens planbyggerens U-trapp har like lange løp. Derfor ligger den øverste trinnkanten litt lenger øst. ${whole.variants.rettet?.stair?.warnings?.length ? `Validatoren advarer: ${whole.variants.rettet.stair.warnings.map((w) => w.replace(/ \(anslått.*$/, '')).join('; ')}.` : ''}`);
  lines.push('');
}
const text = lines.join('\n');
if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
else console.log(text);
if (args.includes('--write')) {
  const file = path.join(ROOT, 'notes', 'planbygger.md');
  const START = '<!-- målinger:start -->';
  const END = '<!-- målinger:slutt -->';
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const i = cur.indexOf(START);
  const j = cur.indexOf(END);
  const block = `${START}\n_Generert av \`node tools/planbygger-measure.mjs --write\`._\n\n${text}\n${END}`;
  const next = i >= 0 && j > i ? cur.slice(0, i) + block + cur.slice(j + END.length) : `${cur}\n\n${block}\n`;
  fs.writeFileSync(file, next);
  console.log(`skrev ${path.relative(ROOT, file)}`);
}
