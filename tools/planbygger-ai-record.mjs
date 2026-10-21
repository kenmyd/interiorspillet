/**
 * Records real AI answers for the planbygger tests (notes/planbygger-runde1-design.md, «Opptak og testoppsett»).
 * Runs only with a key: ANTHROPIC_API_KEY from the environment, or on Windows the user variable of that name (read
 * through PowerShell into this process only – it is never printed, logged or written).
 *
 *   node tools/planbygger-ai-record.mjs [--model haiku|sonnet|both] [--only hus1] [--case hus3/1etg] [--task readPlan]
 *                                       [--no-cache] [--budget 60] [--dry] [--compare] [--freeze] [--redetect]
 *                                       [--out dir]
 *
 * Each case runs the client path of the page: marks from detectPlan + findRooms (marks.js), aiRead (ai.js) with a
 * transport that calls the AI service in-process (server/planbygger-ai/index.mjs, the disk cache included; the script
 * may pick the model, ctx.allowModel). Every answer is written to
 * tools/fixtures/planbygger-ai/<house>/<file>.<task>.<model>.json:
 *   { house, file, task, promptVersion, model, servedModel, effort, image, marks, unmarked, hints, response, usage,
 *     cost, ms }
 * Every real call (cache misses) is appended to .shots/planbygger/ai-record-log.jsonl with tokens and cost; the run
 * stops before the total in that log passes --budget (default 60 calls).
 *   --dry      no calls: draws the marks, prints the prompts' sizes and what would be called
 *   --compare  no calls: prints the recorded Haiku and Sonnet answers side by side with tokens and cost
 *   --freeze   no calls, no key: writes the frozen targets of every marked case (CASES and MARK_CASES) that has none
 *   --case     one case: <house>/<file without extension> (--only matches the house or any part of the path)
 * The detection's targets are frozen in <file>.targets.json beside the fixtures (--redetect makes them anew), so a
 * comparison between prompt versions or models sees the same marks while detect.js changes. --out writes the answers
 * to another folder (a repeat run for the variance). The marked, scaled-down images the model saw are written to
 * .shots/planbygger/ai-record/.
 */
import { ROOT, imp } from './planbygger-lib.mjs';
import { readPng, writePng, encodePng } from './planbygger-png.mjs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const FIXTURES = path.join(ROOT, 'tools/fixtures/planbygger-ai');
const SHOTS = path.join(ROOT, '.shots/planbygger/ai-record');
const LOG = path.join(ROOT, '.shots/planbygger/ai-record-log.jsonl');

/**
 * The recorded cases: the plan files of the test set (PNG copies in _png/ for AVIF / JPG / PDF originals). pxPerM: the
 * plan gets marks (detectPlan at that scale, the fasit's); without it the plan is read unmarked.
 */
export const CASES = [
  { house: 'hus1', file: 'plantegninger/hus1/1etg.png', original: '1etg.png', tasks: ['classify', 'readPlan'], pxPerM: 97.3 },
  // hus4: no marks – the detection finds 19 regions and 45 openings on its grey walls and hatched floors (most of
  // them slivers and false openings); the unmarked read tests the labels with decimal commas
  { house: 'hus4', file: 'plantegninger/_png/hus4/1etg.png', original: '1etg.avif', tasks: ['readPlan'] },
  { house: 'hus8', file: 'plantegninger/_png/hus8/plantegning-1.png', original: 'plantegning-1.jpg', tasks: ['classify'] },
  { house: 'hus3', file: 'plantegninger/hus3/1etg.png', original: '1etg.png', tasks: ['readPlan'], pxPerM: 47.6 },
  { house: 'hus4', file: 'plantegninger/_png/hus4/fasade1.png', original: 'fasade1.avif', tasks: ['readFacade'] },
  // the hard cases, Haiku only (the default model): skylights and a loft; outer dimensions and ceiling texts; sloped
  // ceilings and sliding doors; names without areas; mm chains, «1:100» and a scan; a sheet with plan, section and
  // facades; a phone photo; four facades on one sheet
  { house: 'hus1', file: 'plantegninger/hus1/2etg.png', original: '2etg.png', tasks: ['readPlan'], pxPerM: 94 },
  { house: 'hus2', file: 'plantegninger/hus2/1etg.png', original: '1etg.png', tasks: ['readPlan'], pxPerM: 55.6 },
  { house: 'hus5', file: 'plantegninger/_png/hus5/1etg.png', original: '1etg.avif', tasks: ['readPlan'], pxPerM: 46.9 },
  { house: 'hus8', file: 'plantegninger/_png/hus8/plantegning-3.png', original: 'plantegning-3.jpg', tasks: ['readPlan'], pxPerM: 34 },
  // hus6: unmarked – the detection finds no rooms on the scan
  { house: 'hus6', file: 'plantegninger/_png/hus6/plan-1etg-tilbygg.png', original: 'plan-1etg-tilbygg.pdf', tasks: ['readPlan'] },
  { house: 'hus7', file: 'plantegninger/_png/hus7/garasje-plan-snitt-fasade.png', original: 'garasje-plan-snitt-fasade.pdf', tasks: ['classify'] },
  { house: 'hus3-foto', file: 'plantegninger/_png/hus3-foto/1etg-foto.png', original: '1etg-foto.jpg', tasks: ['readPlan'] },
  { house: 'hus3', file: 'plantegninger/hus3/fasader.png', original: 'fasader.png', tasks: ['classify'] },
];
/** Plans whose marks the test checks without a recorded answer (--freeze writes their targets). */
export const MARK_CASES = [{ house: 'hus8', file: 'plantegninger/_png/hus8/plantegning-2.png', pxPerM: 34 }];

/** --out <dir>: answers go there instead (a repeat run to measure the variance keeps the fixtures). */
const OUT = opt('out', null) ? path.resolve(opt('out')) : FIXTURES;
export const fixturePath = (house, file, task, model, base = FIXTURES) => path.join(base, house, `${path.basename(file, path.extname(file))}.${task}.${model}.json`);

/** The key without printing it: the environment, else (Windows) the user variable via PowerShell. */
function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export const targetsPath = (house, file) => path.join(FIXTURES, house, `${path.basename(file, path.extname(file))}.targets.json`);

/**
 * Marks from the classical detection (the same chain as the page): { img (marked), marks, found }. The detection's
 * targets are frozen in <file>.targets.json the first time (detect.js keeps improving, and a comparison between
 * prompt versions or models needs the same marks); --redetect makes them anew.
 */
async function marksFor(c) {
  const img = readPng(path.join(ROOT, c.file));
  const { drawMarks, targetsFromLevel } = await imp('src/planbygger/marks.js');
  const tp = targetsPath(c.house, c.file);
  let frozen = !flag('redetect') && fs.existsSync(tp) ? JSON.parse(fs.readFileSync(tp, 'utf8')) : null;
  if (!frozen) {
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
    frozen = {
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
  }
  return { ...drawMarks(img, frozen.targets), found: frozen.found };
}

const logged = () => {
  try {
    return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------------------------------------------
// Summaries (also for --compare)

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

function compare() {
  const { tidyResponse } = globalThis.__ai;
  let total = { calls: 0, cost: 0 };
  for (const c of CASES) {
    for (const task of c.tasks) {
      console.log(`\n=== ${c.house}/${path.basename(c.file)} ${task}`);
      for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5']) {
        const p = fixturePath(c.house, c.file, task, model);
        if (!fs.existsSync(p)) {
          console.log(`--- ${model}: (ikke tatt opp)`);
          continue;
        }
        const fx = JSON.parse(fs.readFileSync(p, 'utf8'));
        const u = fx.usage ?? {};
        console.log(`--- ${model} (${fx.promptVersion}, ${u.input_tokens} inn / ${u.output_tokens} ut, $${fx.cost?.toFixed(4)}, ${(fx.ms / 1000).toFixed(1)} s)`);
        console.log(summarize(task, tidyResponse(task, fx.response, fx.marks, fx.unmarked)));
      }
    }
  }
  const log = logged();
  for (const e of log) {
    total.calls++;
    total.cost += e.cost ?? 0;
  }
  console.log(`\nLogg: ${total.calls} ekte kall, $${total.cost.toFixed(4)} i alt`);
  const by = {};
  for (const e of log) {
    const k = `${e.model} ${e.task}`;
    by[k] ??= { n: 0, in: 0, out: 0, cost: 0, ms: 0 };
    by[k].n++;
    by[k].in += e.usage?.input_tokens ?? 0;
    by[k].out += e.usage?.output_tokens ?? 0;
    by[k].cost += e.cost ?? 0;
    by[k].ms += e.ms ?? 0;
  }
  for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v.n} kall, snitt ${Math.round(v.in / v.n)} inn / ${Math.round(v.out / v.n)} ut, $${(v.cost / v.n).toFixed(4)} per kall, ${(v.ms / v.n / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const ai = await imp('src/planbygger/ai.js');
  globalThis.__ai = ai;
  if (flag('compare')) return compare();
  const { createAiService, MODELS, PROMPT_VERSION } = await import(pathToFileURL(path.join(ROOT, 'server/planbygger-ai/index.mjs')).href);
  const { buildUserText } = await import(pathToFileURL(path.join(ROOT, 'server/planbygger-ai/prompts.mjs')).href);
  if (flag('freeze')) {
    for (const c of [...CASES, ...MARK_CASES].filter((x) => x.pxPerM)) {
      const m = await marksFor(c);
      const rooms = m.marks.filter((x) => x.kind === 'room').length;
      console.log(`${c.house}/${path.basename(c.file)}: ${rooms} rom- og ${m.marks.length - rooms} åpningsmerker, ${m.unmarked.length} umerket (${path.relative(ROOT, targetsPath(c.house, c.file))})`);
    }
    return;
  }
  const which = opt('model', 'haiku');
  const models = which === 'both' ? [MODELS.haiku, MODELS.sonnet] : [MODELS[which] ?? which];
  const only = opt('only', null);
  const oneCase = opt('case', null);
  const onlyTask = opt('task', null);
  const budget = Number(opt('budget', 60));
  const dry = flag('dry');
  const key = dry ? 'dry' : apiKey();
  if (!key) {
    console.log('Ingen ANTHROPIC_API_KEY (miljøet eller Windows-brukervariabelen): ingenting tatt opp.');
    process.exit(2);
  }
  // --effort low|medium|high: one effort for every task (an experiment: write it elsewhere with --out)
  const effort = opt('effort', null);
  const service = createAiService({ apiKey: key, log: () => {}, limits: effort ? { effort: { classify: effort, readPlan: effort, readFacade: effort } } : {} });
  fs.mkdirSync(SHOTS, { recursive: true });
  let used = logged().length;
  console.log(`Promptversjon ${PROMPT_VERSION}, modeller ${models.join(', ')}; ${used} ekte kall i loggen, budsjett ${budget}`);

  for (const c of CASES) {
    if (only && c.house !== only && !c.file.includes(only)) continue;
    const base = path.basename(c.file, '.png');
    if (oneCase && oneCase !== `${c.house}/${base}`) continue;
    const img = readPng(path.join(ROOT, c.file));
    for (const task of c.tasks) {
      if (onlyTask && task !== onlyTask) continue;
      let sent = img;
      let marks = [];
      let unmarked = [];
      if (task === 'readPlan' && c.pxPerM) {
        const m = await marksFor(c);
        sent = m.img;
        marks = m.marks;
        unmarked = m.unmarked;
        console.log(`\n${c.house}/${base} ${task}: gjenkjenningen fant ${m.found.walls} vegger, ${m.found.openings} åpninger, rom ${m.found.rooms.join(' ')} m² → ${marks.length} merker, ${unmarked.length} umerket`);
      } else console.log(`\n${c.house}/${base} ${task}`);
      const hints = { fileName: c.original };
      const small = ai.downscaleImage(sent);
      writePng(path.join(SHOTS, `${c.house}-${base}.${task}.png`), small);
      if (dry) {
        const text = buildUserText(task, { marks, hints, width: small.width, height: small.height });
        console.log(`  (tørt) bilde ${small.width}×${small.height}, tekst ${text.length} tegn${marks.length ? `, merker ${marks.map((m) => `${m.id}@${m.drawnAt.map((v) => v.toFixed(3)).join(',')}`).join(' ')}` : ''}`);
        continue;
      }
      for (const model of models) {
        let reply = null;
        const transport = async (req) => {
          if (req.op === 'status') return service.status();
          const data = encodePng(req.image).toString('base64');
          reply = await service.run({ task: req.task, image: { mediaType: 'image/png', data }, marks: req.marks, hints: req.hints, model: req.model }, { noQuota: true, allowModel: true, noCache: flag('no-cache') });
          return reply;
        };
        ai.setAiTransport(transport);
        if (used >= budget) {
          console.log(`  ${model}: budsjettet på ${budget} kall er brukt – stopper`);
          process.exit(1);
        }
        const out = await ai.aiRead(task, { image: sent, marks, unmarked, hints, model });
        if (reply && !reply.cached) {
          used++;
          fs.mkdirSync(path.dirname(LOG), { recursive: true });
          fs.appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), house: c.house, file: base, task, model, servedModel: reply.servedModel ?? null, promptVersion: PROMPT_VERSION, ok: reply.ok, error: reply.error ?? null, usage: reply.usage ?? null, cost: reply.cost ?? null, ms: reply.ms ?? null })}\n`);
        }
        if (!out) {
          console.log(`  ${model}: FEIL ${JSON.stringify(ai.aiLastError())}`);
          continue;
        }
        const u = reply.usage ?? {};
        console.log(`  ${model}${reply.cached ? ' (fra hurtigbufferen)' : ''}: ${u.input_tokens} inn / ${u.output_tokens} ut, $${(reply.cost ?? 0).toFixed(4)}, ${((reply.ms ?? 0) / 1000).toFixed(1)} s`);
        console.log(summarize(task, out));
        const fx = {
          house: c.house,
          file: c.file,
          task,
          promptVersion: PROMPT_VERSION,
          model,
          servedModel: reply.servedModel ?? model,
          effort: service.limits.effort[task],
          image: { width: small.width, height: small.height, sha256: crypto.createHash('sha256').update(small.data).digest('hex') },
          marks,
          unmarked,
          hints,
          response: reply.response,
          usage: reply.usage,
          cost: reply.cached ? reply.first?.cost ?? null : reply.cost,
          ms: reply.cached ? reply.first?.ms ?? null : reply.ms,
          stopReason: reply.stopReason,
          recorded: new Date().toISOString(),
        };
        const p = fixturePath(c.house, c.file, task, model, OUT);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, `${JSON.stringify(fx, null, 1)}\n`);
      }
    }
  }
  ai.resetAiTransport();
  console.log(`\n${used} ekte kall i loggen nå`);
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
