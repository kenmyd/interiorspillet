/**
 * The AI recordings of the planbygger tests (notes/planbygger-runde1-design.md, «Opptak og testoppsett»): compare the
 * models, sum up what the calls cost, and freeze detection targets for the marks test. Recording itself goes through
 * «Generer», so each recording holds exactly what generate sends:
 *
 *   node tools/planbygger-measure-all.mjs --record --budget 20 [--only hus1] [--model sonnet | readPlan=sonnet]
 *                                         [--facade-ai]   (the facades too: the page does not send them, ai.js)
 *
 * (tools/planbygger-ai-fixtures.mjs; the key from ANTHROPIC_API_KEY or the Windows user variable, never printed).
 *
 *   node tools/planbygger-ai-record.mjs --compare [--only hus1]   Haiku and Sonnet side by side on the same drawings,
 *                                                                 with the points against fasit.json (places included;
 *                                                                 a facade as the model read it), tokens and cost.
 *                                                                 The model choice itself rests on what «Generer»
 *                                                                 builds: measure-all --model … against the fasit
 *   node tools/planbygger-ai-record.mjs --log [--since 61]       tokens and cost per model and task from
 *                                                                 .shots/planbygger/ai-record-log.jsonl (from line N)
 *   node tools/planbygger-ai-record.mjs --freeze [--redetect]     writes the frozen detection targets of CASES that
 *                                                                 have none (tools/fixtures/planbygger-ai/<hus>/<fil>.targets.json)
 *
 * The frozen targets are what tools/test-planbygger-ai.mjs checks marks.js against on real plans (placement, no
 * overlaps, nothing dark under a disc); they do not change when detect.js does (--redetect makes them anew).
 */
import { ROOT, imp } from './planbygger-lib.mjs';
import { readPng } from './planbygger-png.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { listFixtures, scoreAnswer, loggedCalls, shortModel } from './planbygger-ai-fixtures.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const FIXTURES = path.join(ROOT, 'tools/fixtures/planbygger-ai');

/** The plans whose detection targets are frozen for the marks test (pxPerM: the fasit's scale). */
export const CASES = [
  { house: 'hus1', file: 'plantegninger/hus1/1etg.png', pxPerM: 97.3 },
  { house: 'hus1', file: 'plantegninger/hus1/2etg.png', pxPerM: 94 },
  { house: 'hus2', file: 'plantegninger/hus2/1etg.png', pxPerM: 55.6 },
  { house: 'hus3', file: 'plantegninger/hus3/1etg.png', pxPerM: 47.6 },
  { house: 'hus5', file: 'plantegninger/_png/hus5/1etg.png', pxPerM: 46.9 },
  { house: 'hus8', file: 'plantegninger/_png/hus8/plantegning-2.png', pxPerM: 34 },
  { house: 'hus8', file: 'plantegninger/_png/hus8/plantegning-3.png', pxPerM: 34 },
];

export const targetsPath = (house, file) => path.join(FIXTURES, house, `${path.basename(file, path.extname(file))}.targets.json`);

/** Freezes the targets of one case (detectPlan + findRooms at the fasit's scale), unless they are there already. */
async function freeze(c) {
  const tp = targetsPath(c.house, c.file);
  if (!flag('redetect') && fs.existsSync(tp)) return JSON.parse(fs.readFileSync(tp, 'utf8'));
  const img = readPng(path.join(ROOT, c.file));
  const { targetsFromLevel } = await imp('src/planbygger/marks.js');
  const { detectPlan } = await imp('src/planbygger/detect.js');
  const M = await imp('src/planbygger/model.js');
  const { findRooms } = await imp('src/planbygger/regions.js');
  const det = detectPlan(img, { pxPerM: c.pxPerM });
  const doc = M.createDoc('opptak');
  const level = M.createLevel(doc, { id: 'l', image: { name: 'x', width: img.width, height: img.height, pxPerM: c.pxPerM } });
  M.applyDetection(level, det, c.pxPerM, doc.settings);
  const rooms = findRooms(level.walls).rooms;
  const round1 = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
  const t = targetsFromLevel(level, rooms, c.pxPerM);
  const frozen = {
    file: c.file,
    pxPerM: c.pxPerM,
    detected: new Date().toISOString(),
    found: { walls: det.walls.length, openings: det.openings.length, rooms: rooms.map((r) => Math.round(r.area * 10) / 10) },
    targets: {
      rooms: t.rooms.map((r) => ({ at: round1(r.at), polygon: r.polygon.map(round1), ref: r.ref })),
      openings: t.openings.map((o) => ({ at: round1(o.at), normal: o.normal.map((v) => Math.round(v * 1e4) / 1e4), t: Math.round(o.t * 10) / 10, width: Math.round(o.width * 10) / 10, ref: o.ref, type: o.type })),
    },
  };
  fs.mkdirSync(path.dirname(tp), { recursive: true });
  fs.writeFileSync(tp, `${JSON.stringify(frozen)}\n`);
  return frozen;
}

// ---------------------------------------------------------------------------------------------------------------
// Summaries

const f1 = (v) => (v == null ? '–' : String(Math.round(v * 100) / 100));
export function summarize(task, r) {
  if (!r) return '(intet svar)';
  if (task === 'classify') {
    return [
      ...r.drawings.map((d) => `  ${d.kind}${d.detached ? ' (frittstående)' : ''} [${d.bbox.map((v) => v.toFixed(2)).join(', ')}] tittel=${JSON.stringify(d.title)} etasje=${JSON.stringify(d.levelName)} nivå=${d.level}`),
      `  målestokk=${JSON.stringify(r.scaleText)} notat=${JSON.stringify(r.notes)}`,
    ].join('\n');
  }
  if (task === 'readFacade') {
    const doors = r.windows.filter((w) => w.kind === 'door').length;
    return `  tittel=${JSON.stringify(r.title)} tak=${r.roof} etasjer=${r.storeys} vinduer=${r.windows.length - doors} dører=${doors}\n  notat=${JSON.stringify(r.notes)}`;
  }
  const lines = [];
  lines.push(`  tittel=${JSON.stringify(r.levelTitle)} målestokk=${JSON.stringify(r.scaleText)}`);
  lines.push(`  rom: ${r.rooms.map((x) => `${x.mark ?? '·'}=${x.name || '«»'} ${f1(x.area)} ${x.kind}`).join(' | ')}`);
  if (r.labels.length) lines.push(`  etiketter: ${r.labels.map((x) => `${x.text} ${f1(x.area)} ${x.kind}`).join(' | ')}`);
  const counts = {};
  for (const o of r.openings) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
  lines.push(`  åpninger: ${r.openings.map((o) => `${o.mark ?? '·'}=${o.kind}`).join(' ')}  ${JSON.stringify(counts)}`);
  if (r.dimensions.length) lines.push(`  mål: ${r.dimensions.map((d) => `${d.text}→${f1(d.value)} ${d.along} ${d.what}`).join(' | ')}`);
  lines.push(`  trapp: ${r.stair.present ? `${r.stair.type}, opp=${r.stair.up}` : 'ingen'}  takvinduer=${r.skylights.length}  himling=${JSON.stringify(r.ceiling)}`);
  lines.push(`  møbler: ${r.furniture.length}  notat=${JSON.stringify(r.notes)}`);
  return lines.join('\n');
}

/** Tokens and cost per model and task from the log lines (1-based, from line `since`). */
export function costTable(log, since = 1) {
  const rows = log.slice(Math.max(0, since - 1));
  const by = {};
  let total = 0;
  for (const e of rows) {
    const k = `${shortModel(e.model)} ${e.task}`;
    by[k] ??= { n: 0, in: 0, out: 0, think: 0, cost: 0, ms: 0, failed: 0 };
    by[k].n++;
    by[k].in += e.usage?.input_tokens ?? 0;
    by[k].out += e.usage?.output_tokens ?? 0;
    by[k].think += e.usage?.output_tokens_details?.thinking_tokens ?? 0;
    by[k].cost += e.cost ?? 0;
    by[k].ms += e.ms ?? 0;
    if (!e.ok) by[k].failed++;
    total += e.cost ?? 0;
  }
  return { rows, by, total };
}

async function compare() {
  const AI = await imp('src/planbygger/ai.js');
  const only = opt('only', null);
  const all = listFixtures(FIXTURES).filter((f) => !only || f.fx.house === only);
  const keys = [...new Set(all.map((f) => f.key))];
  const sum = {};
  for (const key of keys) {
    const mates = all.filter((f) => f.key === key);
    if (mates.length < 2 && !flag('all')) continue;
    console.log(`\n=== ${key}`);
    for (const f of mates) {
      const { fx } = f;
      const out = AI.tidyResponse(fx.task, fx.response, fx.marks, fx.unmarked);
      const items = scoreAnswer(fx, out, { facadeIndex: f.facadeIndex });
      const ok = items.filter((i) => i.ok).length;
      const m = shortModel(fx.model);
      sum[m] ??= { ok: 0, n: 0, cost: 0, calls: 0 };
      if (mates.length >= 2) Object.assign(sum[m], { ok: sum[m].ok + ok, n: sum[m].n + items.length, cost: sum[m].cost + (fx.cost ?? 0), calls: sum[m].calls + 1 });
      const u = fx.usage ?? {};
      console.log(`--- ${m} (${u.input_tokens} inn / ${u.output_tokens} ut, $${(fx.cost ?? 0).toFixed(4)}, ${((fx.ms ?? 0) / 1000).toFixed(1)} s): ${ok}/${items.length} som fasiten`);
      console.log(summarize(fx.task, out));
      const wrong = items.filter((i) => !i.ok);
      if (wrong.length) console.log(`  avvik: ${wrong.map((i) => `${i.id} (${i.detail})`).join('; ')}`);
    }
  }
  console.log('\nPå de samme tegningene:');
  for (const [m, s] of Object.entries(sum)) console.log(`  ${m}: ${s.ok}/${s.n} punkter som fasiten, ${s.calls} opptak, $${s.cost.toFixed(4)}`);
}

function logReport() {
  const log = loggedCalls();
  const since = Number(opt('since', 1)) || 1;
  const { rows, by, total } = costTable(log, since);
  console.log(`Loggen: ${log.length} ekte kall i alt; fra linje ${since}: ${rows.length} kall, $${total.toFixed(4)}`);
  for (const [k, v] of Object.entries(by)) console.log(`  ${k.padEnd(20)} ${String(v.n).padStart(3)} kall, snitt ${Math.round(v.in / v.n)} inn / ${Math.round(v.out / v.n)} ut (${Math.round(v.think / v.n)} tenking), $${(v.cost / v.n).toFixed(4)} per kall, $${v.cost.toFixed(4)} i alt, ${(v.ms / v.n / 1000).toFixed(1)} s${v.failed ? `, ${v.failed} feilet` : ''}`);
}

async function main() {
  if (flag('compare')) return compare();
  if (flag('log')) return logReport();
  if (flag('freeze')) {
    const { drawMarks } = await imp('src/planbygger/marks.js');
    for (const c of CASES) {
      const frozen = await freeze(c);
      const m = drawMarks(readPng(path.join(ROOT, c.file)), frozen.targets);
      const rooms = m.marks.filter((x) => x.kind === 'room').length;
      console.log(`${c.house}/${path.basename(c.file)}: ${rooms} rom- og ${m.marks.length - rooms} åpningsmerker, ${m.unmarked.length} umerket (${path.relative(ROOT, targetsPath(c.house, c.file))})`);
    }
    return;
  }
  console.log('Opptakene tas gjennom «Generer»: node tools/planbygger-measure-all.mjs --record --budget N [--only hus1] [--model sonnet]');
  console.log('Her: --compare (Haiku mot Sonnet), --log [--since N] (tokens og pris), --freeze (frosne mål for merketesten).');
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
