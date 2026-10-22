/**
 * The AI layer for Node: replays the recorded answers in tools/fixtures/planbygger-ai/ through the interface
 * generate.js takes (opts.ai = { read(task, payload) }), and records new ones when that is explicitly allowed
 * (`node tools/planbygger-measure-all.mjs --record`).
 *
 *   import { fixtureAi } from './planbygger-ai-fixtures.mjs';
 *   const ai = fixtureAi({ house: 'hus1' });            // replay only (the default): never a network call, no key
 *   const { doc } = await generate(inputs, { ai });
 *   ai.calls  → [{ task, file, part, model, fixture | null, fresh, why, marksMatch, kept, dropped, recorded, cached,
 *                 cost, note }]   what was asked and answered
 *
 *   fixtureAi({ house, dir, model, fallbackModel, record = false, refresh = false, budget = 0, apiKey, tasks,
 *               verify = false }) → { read, calls, realCalls, cost, logged }
 *     model          the model per task: null (the server's DEFAULT_MODELS, what the page gets), one model for every
 *                    task ('haiku', 'sonnet' or a full id), or { classify, readPlan, readFacade } over the defaults
 *     fallbackModel  undefined: a task without a recording of its model replays another model's; null: never
 *     record         false | true (real calls, with a key and a budget) | 'dry' (no calls, no key: says which tasks
 *                    a recording would call, from the server's disk cache)
 *     refresh        with record: a recording that is not fresh (below) is made again
 *     verify         replay: compare each payload with its recording (fresh / why in calls); record implies it
 *     recordOnly     (task, file, part) → bool: record only these tasks (the rest is replayed as usual)
 *     tasks          only these tasks are answered at all (the rest get null)
 *     facadeAi       null: the readFacade parts ai.js uses (AI_FACADE_USE: none, so readFacade gets null like in the
 *                    browser, where aiRead does not send it; calls entry off: true); true: roof and kinds; or
 *                    { roof, kinds } – to measure (and record) the facade answers
 *
 * read(task, payload) answers like ai.js aiRead (tidied, or null when there is no recording):
 *   payload = { image, marks, unmarked, hints, source }
 *     source = { file: the uploaded file's name ('1etg.png', 'plantegning-3.jpg'), part: the drawing's index on a split
 *                sheet (or null),
 *                width, height: the uploaded image's size (px, as decoded),
 *                bbox: [x0, y0, x1, y1] | null: the crop of the (rectified) image that `image` is (sheet.js),
 *                photo: { quad, width, height } | null: the image was rectified from the upload (photo.js rectifyPhoto:
 *                       quad = where the output's corners lie in the upload, width × height the output) }
 *
 * A recording made through this module (`source` in the fixture) holds exactly what generate sent: the scaled-down
 * image's sha256, the marks, the unmarked targets, the hints and the source. It is fresh for a payload when all of
 * them and the prompt version are the same – then the answer is tidied with the payload's own marks, so `ref` points
 * at the caller's rooms and openings (marksMatch: true). When something moved (detect.js changed the marks, a crop
 * shifted), the recording still answers:
 *   - its normalised points and boxes are carried into the frame of `image`: upload px → (the photo's homography) →
 *     minus the crop → normalised; items that fall outside the crop are dropped (a readPlan of a sheet's main plan
 *     does not get the garage's rooms);
 *   - it is tidied with the recording's own marks, carried into the payload's frame, their refs removed
 *     (marksMatch: false): every `at` is still where the mark sat, and the caller links the answer by position.
 * A readFacade or classify recording is used only when the payload covers most of the recorded image (≥ 80 % of it):
 * the answer is about the whole drawing.
 *
 * Recording (record: true, a key in apiKey or ANTHROPIC_API_KEY, budget > 0): a task without a recording of its model
 * (or, with refresh, with a stale one) is sent to the AI service in-process (server/planbygger-ai/index.mjs, its disk
 * cache included: a cache hit costs nothing and is not a real call) with the payload's own image and marks, and
 * written as <dir>/<house>/<file>[.d<part>].<task>.<model>.json. Every real call is appended to
 * .shots/planbygger/ai-record-log.jsonl with its tokens and cost; no call is made once `budget` real calls are used in
 * this process. The key is never printed, logged or written.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, imp } from './planbygger-lib.mjs';
import { encodePng } from './planbygger-png.mjs';

export const FIXTURES = path.join(ROOT, 'tools/fixtures/planbygger-ai');
export const LOG = path.join(ROOT, '.shots/planbygger/ai-record-log.jsonl');
const VIA = 'tools/planbygger-ai-fixtures.mjs';

const AI = await imp('src/planbygger/ai.js');
const P = await imp('src/planbygger/photo.js');
const { pointInPolygon } = await imp('src/planbygger/geom.js');
const SERVER = await import(pathToFileURL(path.join(ROOT, 'server/planbygger-ai/index.mjs')).href);
export const { MODELS, DEFAULT_MODELS, PROMPT_VERSION } = SERVER;
export const TASKS = ['classify', 'readPlan', 'readFacade'];

const base = (file) => path.basename(file, path.extname(file));
/** <dir>/<house>/<file>[.d<part>].<task>.<model>.json – part: the drawing's index on a sheet that was split. */
export const fixtureFile = (dir, house, file, task, model, part = null) => path.join(dir, house, `${base(file)}${part != null ? `.d${part}` : ''}.${task}.${model}.json`);

/** A model name or id → the full id ('haiku' → claude-haiku-5-5). */
export const modelId = (m) => MODELS[m] ?? m;
export const shortModel = (m) => String(m ?? '').replace(/^claude-/, '').replace(/-\d+(-\d+)*$/, '');

/** The model per task: null → the server's defaults; a string → every task; an object → over the defaults. */
export function modelsByTask(model = null) {
  const out = {};
  for (const t of TASKS) out[t] = modelId(DEFAULT_MODELS[t] ?? DEFAULT_MODELS.default);
  if (typeof model === 'string') for (const t of TASKS) out[t] = modelId(model);
  else if (model && typeof model === 'object') for (const t of TASKS) if (model[t]) out[t] = modelId(model[t]);
  return out;
}

/**
 * The recording for one task of one file, or null: the models in order, a recording of this very drawing of a split
 * sheet (part) before one of the whole file.
 */
export function findFixture({ dir = FIXTURES, house, file, task, models, part = null }) {
  for (const model of models) {
    for (const pt of part != null ? [part, null] : [null]) {
      const p = fixtureFile(dir, house, file, task, model, pt);
      if (fs.existsSync(p)) return { path: p, fx: JSON.parse(fs.readFileSync(p, 'utf8')), part: pt, model };
    }
  }
  return null;
}

/** Two payload sources describe the same image (same file, crop and rectification). */
const sameSource = (a, b) => JSON.stringify([a?.file, a?.bbox ?? null, a?.photo?.quad ?? null]) === JSON.stringify([b?.file, b?.bbox ?? null, b?.photo?.quad ?? null]);

/** sha256 of the marks that matter for linking: id, kind and position (3 decimals). */
export function marksHash(marks) {
  const h = crypto.createHash('sha256');
  for (const m of marks ?? []) h.update(`${m.id}|${m.kind}|${(m.at?.[0] ?? 0).toFixed(3)}|${(m.at?.[1] ?? 0).toFixed(3)}\n`);
  return h.digest('hex');
}

const sameMarks = (a = [], b = []) =>
  a.length === b.length && a.every((m, i) => b[i] && m.id === b[i].id && m.kind === b[i].kind && Math.abs(m.at[0] - b[i].at[0]) <= 0.002 && Math.abs(m.at[1] - b[i].at[1]) <= 0.002);
/** The hints the server sends (its cleanHints: these keys, in this order). */
const hintsKey = (h = {}) => JSON.stringify(['fileName', 'levelName', 'sheet', 'note'].map((k) => (h?.[k] == null || h[k] === '' ? null : String(h[k]).slice(0, 200))));

/** The image the model sees for a payload (ai.js scales it down to 1600 px) and its sha256. */
function signature(payload) {
  const small = AI.downscaleImage(payload.image);
  return { small, sha: crypto.createHash('sha256').update(small.data).digest('hex') };
}

/**
 * Whether a recording holds exactly what this payload would send: → { fresh, why: [Norwegian reasons] }.
 * sig: signature(payload) (the image check is skipped without it).
 */
export function freshness(fx, task, payload, sig = null) {
  const why = [];
  // a recording of the record script (no source): the whole uploaded file, unrectified – fresh too when the image,
  // the marks and the hints are the same (the model saw the same pixels and the same text)
  const src = fx.source ?? { file: fx.hints?.fileName ?? path.basename(fx.file ?? ''), bbox: null, photo: null };
  if (fx.promptVersion !== PROMPT_VERSION) why.push(`promptversjon ${fx.promptVersion}`);
  if (!sameSource(src, payload.source)) why.push('annet utsnitt');
  if (!sig && !fx.source) why.push('tatt opp utenfor generate');
  if (sig && fx.image?.sha256 !== sig.sha) why.push('annet bilde');
  if (task === 'readPlan' && !sameMarks(fx.marks, payload.marks)) why.push('andre merker');
  if (hintsKey(fx.hints) !== hintsKey(payload.hints)) why.push('andre hint');
  return { fresh: !why.length, why };
}

/**
 * The map from the recording's normalised frame (the whole upload) into the payload's (the crop of the rectified
 * image): → { pt(p) → [nx, ny] | null (outside), box(b) → [x0, y0, x1, y1] | null, cover } where cover is the share of
 * the recorded image the payload shows.
 */
export function frameMap(source, recW, recH) {
  const W = source?.width || recW;
  const H = source?.height || recH;
  const ph = source?.photo?.quad ? source.photo : null;
  const Hm = ph ? P.solveHomography(ph.quad, [[0, 0], [ph.width, 0], [ph.width, ph.height], [0, ph.height]]) : null;
  const outW = ph ? ph.width : W;
  const outH = ph ? ph.height : H;
  const bb = source?.bbox ?? [0, 0, outW, outH];
  const bw = bb[2] - bb[0];
  const bh = bb[3] - bb[1];
  const toPx = (p) => {
    const q = [p[0] * W, p[1] * H];
    return Hm ? P.mapPoint(Hm, q) : q;
  };
  const pt = (p, margin = 0.02) => {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const q = toPx(p);
    const n = [(q[0] - bb[0]) / bw, (q[1] - bb[1]) / bh];
    if (n[0] < -margin || n[1] < -margin || n[0] > 1 + margin || n[1] > 1 + margin) return null;
    return [Math.max(0, Math.min(1, n[0])), Math.max(0, Math.min(1, n[1]))];
  };
  const box = (b) => {
    if (!Array.isArray(b) || b.length < 4) return null;
    const c = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map((p) => toPx(p)).map((q) => [(q[0] - bb[0]) / bw, (q[1] - bb[1]) / bh]);
    const xs = c.map((p) => p[0]);
    const ys = c.map((p) => p[1]);
    const r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // the part inside the payload; nothing of it inside → null
    const k = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(1, r[2]), Math.min(1, r[3])];
    if (k[2] - k[0] <= 0.005 || k[3] - k[1] <= 0.005) return null;
    const area = (r[2] - r[0]) * (r[3] - r[1]);
    return (k[2] - k[0]) * (k[3] - k[1]) >= 0.5 * area ? k : null;
  };
  // the share of the recorded image (its box in the payload's frame) that the payload shows
  const all = (() => {
    const c = [[0, 0], [1, 0], [1, 1], [0, 1]].map(toPx).map((q) => [(q[0] - bb[0]) / bw, (q[1] - bb[1]) / bh]);
    const xs = c.map((p) => p[0]);
    const ys = c.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  })();
  const iw = Math.max(0, Math.min(1, all[2]) - Math.max(0, all[0]));
  const ih = Math.max(0, Math.min(1, all[3]) - Math.max(0, all[1]));
  const cover = (iw * ih) / Math.max(1e-9, (all[2] - all[0]) * (all[3] - all[1]));
  const identity = !Hm && !source?.bbox;
  return { pt, box, cover, identity };
}

/**
 * The recorded raw response carried into the payload's frame (points and boxes; items outside are dropped). An item
 * the model tied to a recorded mark is kept or dropped by where that mark sat (the room or opening it is about); its
 * own point is carried along leniently.
 */
function carry(task, response, map, marks = []) {
  const byId = new Map((marks ?? []).map((m) => [String(m.id), m]));
  const r = JSON.parse(JSON.stringify(response ?? {}));
  let dropped = 0;
  const keep = (list, f) => (Array.isArray(list) ? list : []).filter((x) => {
    const ok = f(x);
    if (!ok) dropped++;
    return ok;
  });
  if (task === 'classify') {
    r.drawings = keep(r.drawings, (d) => (d.bbox = map.box(d.bbox)));
  } else if (task === 'readFacade') {
    r.windows = keep(r.windows, (w) => (w.bbox = map.box(w.bbox)));
  } else {
    const at = (x) => {
      if (x.at == null) return true;
      x.at = map.pt(x.at);
      return !!x.at;
    };
    const marked = (kind) => (x) => {
      const m = x.mark != null ? byId.get(String(x.mark)) : null;
      if (!m || m.kind !== kind) return at(x);
      if (!map.pt(m.at, 0)) return false;
      x.at = x.at != null ? map.pt(x.at, 1) : null;
      return true;
    };
    r.rooms = keep(r.rooms, marked('room'));
    r.labels = keep(r.labels, at);
    r.dimensions = keep(r.dimensions, at);
    r.openings = keep(r.openings, marked('opening'));
    r.skylights = keep(r.skylights, at);
    r.furniture = keep(r.furniture, at);
    if (r.stair && r.stair.at) {
      const p = map.pt(r.stair.at);
      if (p) r.stair.at = p;
      else r.stair = { present: false, at: null, type: 'none', up: 'unknown' };
    }
  }
  return { response: r, dropped };
}

/** The recorded marks (and unmarked targets) in the payload's frame, without their refs. */
function carryMarks(list, map) {
  const out = [];
  for (const m of list ?? []) {
    const at = map.pt(m.at, 0);
    if (!at) continue;
    const c = { ...m, at, drawnAt: m.drawnAt ? map.pt(m.drawnAt, 0.05) ?? at : at, ref: null, recordedRef: m.ref ?? null };
    if (Array.isArray(m.polygon)) c.polygon = m.polygon.map((p) => map.pt(p, 1) ?? p);
    out.push(c);
  }
  return out;
}

/** The real calls in the log: [{ at, house, file, task, model, usage, cost, … }]. */
export function loggedCalls() {
  try {
    return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** The AI service in-process, for recording (the SDK is imported lazily, from server/planbygger-ai/node_modules). */
const services = new Map();
function service(apiKey) {
  const k = apiKey ? 'key' : 'none';
  if (!services.has(k)) services.set(k, SERVER.createAiService({ apiKey: apiKey ?? null, log: () => {} }));
  return services.get(k);
}

/** The readFacade parts in use: fixtureAi's facadeAi option over ai.js's (see the top of the file). */
export function facadeUseOf(facadeAi = null) {
  if (facadeAi === true) return { roof: true, kinds: true };
  if (facadeAi && typeof facadeAi === 'object') return { ...AI.AI_FACADE_USE, ...facadeAi };
  return AI.aiFacadeUse();
}

/** The answer of one recording for one payload (see the top of the file); entry gets marksMatch, kept and dropped. */
function replay(task, payload, found, entry, fresh, facadeUse = AI.aiFacadeUse()) {
  const { fx } = found;
  entry.fixture = path.relative(ROOT, found.path).replace(/\\/g, '/');
  entry.model = fx.model ?? found.model;
  // a recording made through this module carries its source: the same source is the same frame (the identity map, so
  // marks that moved since are still carried over as they are)
  const map = fx.source && sameSource(fx.source, payload.source) ? frameMap({ width: 1, height: 1, bbox: null, photo: null }, 1, 1) : frameMap(payload.source, fx.image?.width, fx.image?.height);
  if (task !== 'readPlan' && map.cover < 0.8) {
    entry.note = `opptaket gjelder hele fila, utsnittet viser ${Math.round(map.cover * 100)} %`;
    entry.fixture = null;
    return null;
  }
  const { response, dropped } = map.identity ? { response: fx.response, dropped: 0 } : carry(task, fx.response, map, fx.marks);
  entry.dropped = dropped;
  let marks;
  let unmarked;
  if (task === 'readPlan' && fx.marks?.length && map.identity && (fresh || sameMarks(fx.marks, payload.marks))) {
    marks = payload.marks;
    unmarked = payload.unmarked ?? [];
    entry.marksMatch = true;
  } else {
    marks = carryMarks(fx.marks, map);
    unmarked = carryMarks(fx.unmarked, map);
    entry.marksMatch = task === 'readPlan' && fx.marks?.length ? false : null;
  }
  const out = AI.tidyResponse(task, response, marks, unmarked, { facadeUse });
  out.meta = { model: fx.model ?? null, promptVersion: fx.promptVersion ?? null, cached: true, fixture: entry.fixture, marksMatch: entry.marksMatch, fresh: entry.fresh };
  entry.kept = task === 'readPlan' ? out.rooms.length + out.labels.length + out.openings.length : task === 'classify' ? out.drawings.length : out.windows.length;
  return out;
}

/**
 * The AI for generate.js in Node (see the top of the file).
 * @param {{ house: string, dir?: string, model?: string|object|null, fallbackModel?: string|null, record?: boolean|'dry', refresh?: boolean, budget?: number, apiKey?: string, tasks?: string[], verify?: boolean, facadeAi?: boolean|object|null }} o
 */
export function fixtureAi({ house, dir = FIXTURES, model = null, fallbackModel = undefined, record = false, refresh = false, budget = 0, apiKey = null, tasks = null, verify = false, recordOnly = null, facadeAi = null } = {}) {
  const calls = [];
  const byTask = modelsByTask(model);
  const facadeUse = facadeUseOf(facadeAi);
  const others = Object.values(MODELS);
  const modelsFor = (task) => [byTask[task], ...(fallbackModel === null ? [] : fallbackModel ? [modelId(fallbackModel)] : others).filter((m) => m !== byTask[task])];
  let realCalls = 0;
  let cost = 0;

  async function read(task, payload = {}) {
    const file = payload.source?.file ?? payload.hints?.fileName ?? null;
    const part = payload.source?.bbox ? payload.source?.part ?? null : null;
    const entry = { task, file, part, model: null, fixture: null, fresh: null, why: null, marksMatch: null, kept: 0, dropped: 0, recorded: false, cached: false, cost: 0 };
    calls.push(entry);
    if (!file || (tasks && !tasks.includes(task))) return null;
    // a task the page does not send (ai.js aiTaskInUse): no answer here either, so Node measures what the page gets
    if (!AI.aiTaskInUse(task, facadeUse)) {
      entry.off = true;
      entry.note = 'av: ingen del av svaret brukes (ai.js AI_FACADE_USE)';
      return null;
    }
    const want = byTask[task];
    const found = findFixture({ dir, house, file, task, models: modelsFor(task), part: payload.source?.part ?? null });
    const sig = record || verify ? signature(payload) : null;
    if (found) Object.assign(entry, freshness(found.fx, task, payload, sig));
    const needs = record && (!recordOnly || recordOnly(task, file, part)) && (!found || found.model !== want || (refresh && !entry.fresh));
    if (needs) {
      const out = await recordOne(task, payload, entry, want, sig, part);
      if (out) return out;
    }
    if (!found) return null;
    // a fresh recording of the record script: written again in this module's shape (no call), so every recording
    // carries its source and the test can check it
    if (record === true && entry.fresh && found.model === want && found.fx.via !== VIA) {
      const { fx } = found;
      const up = { house, file, part, task, promptVersion: fx.promptVersion, model: want, servedModel: fx.servedModel ?? want, effort: fx.effort ?? null, image: { width: sig.small.width, height: sig.small.height, sha256: sig.sha }, marks: payload.marks ?? [], unmarked: payload.unmarked ?? [], hints: payload.hints ?? {}, source: payload.source ?? null, response: fx.response, usage: fx.usage ?? null, cost: fx.cost ?? null, ms: fx.ms ?? null, stopReason: fx.stopReason ?? null, recorded: fx.recorded ?? null, via: VIA, upgraded: new Date().toISOString() };
      const p = fixtureFile(dir, house, file, task, want, part);
      fs.writeFileSync(p, `${JSON.stringify(up, null, 1)}\n`);
      found.path = p;
      found.fx = up;
      entry.note = 'skrevet om til den nye formen (samme bilde og merker)';
    }
    return replay(task, payload, found, entry, entry.fresh === true, facadeUse);
  }

  async function recordOne(task, payload, entry, want, sig, part) {
    const small = sig?.small ?? AI.downscaleImage(payload.image);
    const sent = { task, image: { mediaType: 'image/png', data: encodePng(small).toString('base64') }, marks: (payload.marks ?? []).map((m) => ({ id: m.id, kind: m.kind, at: m.at, drawnAt: m.drawnAt ?? m.at })), hints: payload.hints ?? {}, model: want };
    if (record === 'dry') {
      const hit = service(null).peek(sent, { allowModel: true });
      entry.wouldCall = !hit;
      entry.note = hit ? `i hurtigbufferen (${shortModel(want)})` : `ville kalt ${shortModel(want)}`;
      return null;
    }
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
    const s = service(key);
    const hit = s.peek(sent, { allowModel: true });
    if (!hit && (!key || !(budget > 0) || realCalls >= budget)) {
      entry.note = !key ? 'ingen nøkkel: ikke tatt opp' : `budsjettet (${budget} kall) er brukt: ikke tatt opp`;
      return null;
    }
    let reply = null;
    AI.setAiTransport(async (req) => {
      if (req.op === 'status') return s.status();
      // without a key the service answers nothing, not even from its cache: the cached answer peek found is the reply
      if (!key) {
        reply = { ok: true, task, model: hit.model, servedModel: hit.servedModel ?? hit.model, promptVersion: PROMPT_VERSION, response: hit.response, usage: hit.usage ?? null, cost: 0, cached: true, ms: 0, stopReason: hit.stopReason ?? 'end_turn', first: { cost: hit.cost ?? null, ms: hit.ms ?? null } };
        return reply;
      }
      reply = await s.run({ task: req.task, image: { mediaType: 'image/png', data: encodePng(req.image).toString('base64') }, marks: req.marks, hints: req.hints, model: req.model ?? want }, { noQuota: true, allowModel: true });
      return reply;
    });
    // aiRead sends a task only while ai.js uses it: this fixtureAi's facade parts for the call
    const pageUse = AI.aiFacadeUse();
    AI.setAiFacadeUse(facadeUse);
    try {
      const out = await AI.aiRead(task, { image: payload.image, marks: payload.marks, unmarked: payload.unmarked, hints: payload.hints, model: want });
      if (reply && !reply.cached) {
        realCalls++;
        cost += reply.cost ?? 0;
        fs.mkdirSync(path.dirname(LOG), { recursive: true });
        fs.appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), house, file: base(entry.file), part, task, model: want, servedModel: reply.servedModel ?? null, effort: s.limits.effort[task], promptVersion: PROMPT_VERSION, via: 'generate', ok: reply.ok, error: reply.error ?? null, usage: reply.usage ?? null, cost: reply.cost ?? null, ms: reply.ms ?? null })}\n`);
      }
      entry.cached = !!reply?.cached;
      entry.cost = reply?.cached ? 0 : reply?.cost ?? 0;
      if (!out || !reply?.ok) {
        entry.note = `KI-feil: ${reply?.error ?? AI.aiLastError()?.error ?? 'ukjent'}`;
        return null;
      }
      const fx = {
        house,
        file: entry.file,
        part,
        task,
        promptVersion: PROMPT_VERSION,
        model: want,
        servedModel: reply.servedModel ?? want,
        effort: s.limits.effort[task],
        image: { width: small.width, height: small.height, sha256: sig?.sha ?? crypto.createHash('sha256').update(small.data).digest('hex') },
        marks: payload.marks ?? [],
        unmarked: payload.unmarked ?? [],
        hints: payload.hints ?? {},
        source: payload.source ?? null,
        response: reply.response,
        usage: reply.usage,
        // a disk-cache hit: what the call that filled the cache cost
        cost: reply.cached ? reply.first?.cost ?? null : reply.cost ?? null,
        ms: reply.cached ? reply.first?.ms ?? null : reply.ms ?? null,
        stopReason: reply.stopReason ?? null,
        recorded: new Date().toISOString(),
        via: VIA,
      };
      const p = fixtureFile(dir, house, entry.file, task, want, part);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(fx, null, 1)}\n`);
      Object.assign(entry, { fixture: path.relative(ROOT, p).replace(/\\/g, '/'), model: want, recorded: true, fresh: true, why: [] });
      out.meta = { ...out.meta, fixture: entry.fixture, marksMatch: task === 'readPlan' && fx.marks.length ? true : null, fresh: true };
      entry.marksMatch = out.meta.marksMatch;
      entry.kept = task === 'readPlan' ? out.rooms.length + out.labels.length + out.openings.length : task === 'classify' ? out.drawings.length : out.windows.length;
      return out;
    } finally {
      AI.resetAiTransport();
      AI.setAiFacadeUse(pageUse);
    }
  }

  return {
    read,
    calls,
    models: byTask,
    facadeUse,
    get realCalls() {
      return realCalls;
    },
    get cost() {
      return cost;
    },
    logged: () => loggedCalls().length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One recorded answer against the truth (the AI test and the record script's comparison)

/**
 * What the fasit leaves out, read off the drawings by eye – nothing here depends on the marks (they move with
 * detect.js): outer dimensions with their direction, ceiling texts, scale texts, drawing titles on a sheet, and
 * where each room and opening is (`at`, in the uploaded file's px):
 *   rooms:    [label, area | null (the label is unique), [x, y] a point inside the room]
 *   openings: [kind, [x, y] the middle of the gap]
 * The places come from phase A's checked maps (which mark was which room, the kind of each opening letter, on the
 * marked images the model saw) joined with that recording's marks, plus the sliding doors, hus3 2. etasje and the
 * labels in merged rooms read off the drawings and the fasit notes; every point was checked on an overlay of the
 * drawing. scoreAnswer checks with them that the room the model named sits where the fasit room is, and that the
 * opening marked nearest each place got its kind – a swap of two readings, or a name on the wrong mark, fails.
 */
const HUS1_1 = {
  rooms: [['SOV', null, [225, 265]], ['BOD', null, [868, 117]], ['HALL/TRAPP', null, [577, 332]], ['VASK', null, [1030, 243]], ['KJØKKEN', null, [982, 586]], ['STUE', null, [248, 635]]],
  openings: [
    ['window', [955, 50]], ['window', [218, 50]], ['window', [512, 109]], ['door', [715, 109]], ['door', [962, 187]], ['double-door', [650, 469]],
    ['double-door', [600, 831]], ['window', [158, 890]], ['window', [277, 890]], ['window', [921, 890]], ['window', [1040, 890]], ['window', [33, 331]],
    ['window', [33, 610]], ['door', [404, 410]], ['sliding-door', [800, 617]], ['door', [903, 272]], ['window', [1165, 332]], ['window', [1165, 625]],
  ],
};
const HUS1_2 = {
  rooms: [['SOV', 11.8, [231, 255]], ['BAD', null, [965, 257]], ['GANG/TRAPP', null, [600, 529]], ['BOD', null, [749, 229]], ['SOV', 11.9, [954, 632]], ['SOV', 10, [228, 699]], ['LOFTSTUE', null, [560, 700]]],
  openings: [
    ['door', [662, 328]], ['window', [524, 826]], ['door', [605, 826]], ['window', [682, 826]], ['window', [57, 382]], ['window', [57, 574]],
    ['door', [421, 583]], ['door', [422, 452]], ['door', [786, 380]], ['door', [786, 563]], ['window', [1150, 364]], ['window', [1150, 574]],
  ],
};
const HUS2 = {
  rooms: [
    ['SOVEROM', 10, [146, 92]], ['KONTOR', null, [363, 79]], ['STUE', 10.7, [369, 283]], ['SOVEROM', 9.9, [159, 380]], ['SOVEROM', 11.7, [153, 519]],
    ['STUE', 32.9, [658, 626]], ['WC/D', null, [410, 573]], ['BAD', null, [94, 691]], ['WIC', 4.6, [199, 639]], ['VASK', null, [200, 793]],
    ['HALL', null, [240, 237]], ['WIC', 1.3, [96, 237]], ['WIC', 1.3, [165, 237]], ['GANG', null, [323, 560]], ['KJØKKEN', null, [520, 600]],
    ['ENTRÉ', null, [330, 770]], ['BOD', null, [395, 660]],
  ],
  // the five sliding doors (fasit notes): no arc, an arrow along the wall
  openings: [['sliding-door', [96, 199]], ['sliding-door', [166, 275]], ['sliding-door', [323, 198]], ['sliding-door', [322, 428]], ['sliding-door', [276, 678]]],
};
const HUS3_1 = {
  rooms: [['KJØKKEN/STUE', null, [457, 283]], ['VASK', null, [456, 691]], ['WC/D', null, [545, 796]], ['ENTRÉ', null, [350, 770]]],
  // the west glass wall: the north and the south terrace door (fasit notes); not its two fixed panels – the detection
  // finds one gap over a panel, the post and the next panel, and any reading of that is right
  openings: [
    ['window', [367, 148]], ['door', [566, 383]], ['door', [353, 848]], ['window', [389, 848]], ['door', [323, 398]], ['door', [397, 682]],
    ['door', [465, 810]], ['window', [599, 193]], ['window', [599, 583]], ['door', [599, 678]], ['door', [323, 597]],
  ],
};
const HUS3_2 = {
  rooms: [['SOVEROM', 12.7, [140, 290]], ['ARBEIDSROM', null, [300, 260]], ['SOVEROM', 8.7, [110, 450]], ['SOVEROM', 8.7, [110, 590]], ['GANG', null, [262, 540]], ['BOD/BADSTUE', null, [200, 700]], ['BOD', null, [325, 700]], ['BAD', null, [240, 830]]],
  openings: [
    ['sliding-door', [233, 292]], ['sliding-door', [233, 416]], ['sliding-door', [233, 575]], ['door', [233, 687]],
    ['window', [118, 141]], ['window', [357, 191]], ['window', [357, 580]], ['window', [68, 432]], ['window', [68, 558]], ['window', [118, 851]],
  ],
};
const HUS5 = {
  rooms: [
    ['SPORTSBOD', null, [226, 50]], ['VASK/TEK', null, [530, 113]], ['SOV', 14.4, [659, 152]], ['STUE/KJØKKEN', null, [169, 437]], ['GARD/BOD', null, [287, 177]],
    ['VF', null, [378, 203]], ['GANG', 9.7, [536, 333]], ['SOV', 11.9, [691, 348]], ['SOV', 18.5, [595, 669]], ['BAD', 7.7, [667, 514]], ['BAD', 5, [456, 186]],
    ['SPISESTUE', null, [330, 340]], ['GANG', 4.8, [530, 580]],
  ],
  openings: [['sliding-door', [313, 246]], ['sliding-door', [379, 295]], ['sliding-door', [497, 376]], ['sliding-door', [380, 493]]],
};
const HUS8_3 = { rooms: [['SOVEROM', null, [308, 579]], ['GANG', null, [389, 755]], ['SOVEROM', null, [459, 612]], ['BAD', null, [478, 682]], ['SOVEROM', null, [288, 770]], ['ENTRÉ', null, [494, 735]], ['STUE', null, [334, 972]], ['KJØKKEN', null, [459, 869]]] };
export const BY_EYE = {
  'hus1/1etg.png readPlan': { at: HUS1_1 },
  'hus1/2etg.png readPlan': { at: HUS1_2 },
  'hus2/1etg.png readPlan': { at: HUS2 },
  'hus3/1etg.png readPlan': { outer: [['6.15', 'h'], ['14.95', 'v']], ceiling: ['ÅPENT OPP'], at: HUS3_1 },
  'hus3/2etg.png readPlan': { at: HUS3_2 },
  'hus5/1etg.avif readPlan': { at: HUS5 },
  'hus8/plantegning-3.jpg readPlan': { at: HUS8_3 },
  'hus3-foto/1etg-foto.jpg readPlan': { outer: [['6.15', 'h'], ['14.95', 'v']], ceiling: ['ÅPENT OPP'] },
  'hus6/plan-1etg-tilbygg.pdf readPlan': { scaleText: '1:100' },
  'hus6/plan-1etg-tilbygg.pdf classify': { scaleText: '1:100' },
  'hus7/garasje-plan-snitt-fasade.pdf classify': { titles: ['PLAN', 'SNITT', 'VEST', 'SØR', 'ØST', 'NORD'], scaleText: '1:100' },
};

const fasitCache = {};
export const fasitOf = (house) => (fasitCache[house] ??= JSON.parse(fs.readFileSync(path.join(ROOT, 'plantegninger', house, 'fasit.json'), 'utf8')));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const sameArea = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.051);
export const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy;
  return u > 0 ? (ix * iy) / u : 0;
};
const ENTRY = new Set(['hall', 'entrance']);

/**
 * The place items of a readPlan answer (BY_EYE `at`): [{ id, ok, detail }].
 *   rooms:    the room the model named with the label (the area decides between repeated labels) must be a marked or
 *             unmarked room whose polygon holds the fasit point. Left out where no detected room holds the point (the
 *             model had nothing to name there) or where the room holding it was named after another fasit room whose
 *             point it also holds (the detection merged them: one name per region).
 *   openings: the opening mark (or unmarked opening) nearest the fasit point, within 0.4 m, must have been read as
 *             that kind. Left out where no opening was found there.
 * Points are carried into the recorded image's frame (the crop of a sheet, the rectified photo) with frameMap.
 */
export function placeItems(fx, out, at, pxPerM = null) {
  const items = [];
  const W = fx.source?.width ?? fx.image?.width;
  const H = fx.source?.height ?? fx.image?.height;
  const map = frameMap(fx.source, fx.image?.width, fx.image?.height);
  const toFrame = (xy, margin = 0) => map.pt([xy[0] / W, xy[1] / H], margin);
  const marks = fx.marks ?? [];
  const unmarked = fx.unmarked ?? [];
  const regions = [
    ...marks.filter((m) => m.kind === 'room' && m.polygon?.length >= 3).map((m) => ({ id: m.id, polygon: m.polygon })),
    ...unmarked.filter((u) => u.kind === 'room' && u.polygon?.length >= 3).map((u) => ({ id: null, ref: u.ref, polygon: u.polygon })),
  ];
  const polygonOf = (r) => (r.mark != null ? regions.find((g) => g.id === r.mark)?.polygon : r.unmarked ? regions.find((g) => g.id == null && g.ref === r.ref)?.polygon : null) ?? null;
  const roomOf = (g) => out.rooms.find((r) => (g.id != null ? r.mark === g.id : r.unmarked && r.ref === g.ref)) ?? null;
  const where = (r) => (r.mark != null ? `merke ${r.mark}` : r.unmarked ? 'et umerket rom' : 'intet merke');
  const expected = (at.rooms ?? []).map(([label, area, xy]) => ({ label, area, xy, p: toFrame(xy) }));
  for (const e of expected) {
    if (!e.p) continue;
    const holders = regions.filter((g) => pointInPolygon(e.p, g.polygon));
    if (!holders.length) continue;
    const repeated = expected.filter((o) => norm(o.label) === norm(e.label)).length > 1;
    const named = out.rooms.filter((r) => norm(r.name) === norm(e.label) && (!repeated || e.area == null || r.area == null || sameArea(r.area, e.area)));
    const hit = named.find((r) => {
      const poly = polygonOf(r);
      return poly && pointInPolygon(e.p, poly);
    });
    const id = `plass rom ${e.label}${repeated && e.area != null ? ` ${e.area}` : ''}`;
    if (hit) {
      items.push({ id, ok: true, detail: where(hit) });
      continue;
    }
    if (named.length) {
      items.push({ id, ok: false, detail: `«${e.label}» står på ${named.map(where).join(', ')}, som ikke dekker rommet (${holders.map((g) => (g.id != null ? `merke ${g.id}` : 'et umerket rom')).join(', ')} gjør)` });
      continue;
    }
    // nobody has the name: the region was named after another fasit room inside it (merged by the detection)
    const merged = holders.some((g) => {
      const r = roomOf(g);
      return r?.name && expected.some((o) => o !== e && o.p && norm(o.label) === norm(r.name) && pointInPolygon(o.p, g.polygon));
    });
    if (merged) continue;
    items.push({ id, ok: false, detail: holders.map((g) => `${g.id != null ? `merke ${g.id}` : 'et umerket rom'}: ${roomOf(g)?.name ? `«${roomOf(g).name}»` : 'uten navn'}`).join(', ') });
  }
  const targets = [
    ...marks.filter((m) => m.kind === 'opening' && m.at).map((m) => ({ id: m.id, at: m.at })),
    ...unmarked.filter((u) => u.kind === 'opening' && u.at).map((u) => ({ id: null, ref: u.ref, at: u.at })),
  ];
  const near = 0.4 * (pxPerM || 0.05 * Math.max(W, H));
  for (const [kind, xy] of at.openings ?? []) {
    const p = toFrame(xy);
    if (!p) continue;
    // 0.4 m in the recorded frame: the same step carried over
    const q = toFrame([xy[0] + near, xy[1]], 1) ?? toFrame([xy[0] - near, xy[1]], 1);
    const tol = q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : 0.02;
    let best = null;
    let bestD = tol;
    for (const t of targets) {
      const d = Math.hypot(t.at[0] - p[0], t.at[1] - p[1]);
      if (d <= bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) continue;
    const got = out.openings.find((o) => (best.id != null ? o.mark === best.id : o.unmarked && o.ref === best.ref));
    items.push({ id: `åpning ${xy[0]},${xy[1]}`, ok: got?.kind === kind, detail: `${got?.kind ?? 'ikke lest'} (fasit ${kind}), ${best.id != null ? `merke ${best.id}` : 'umerket'}` });
  }
  return items;
}

/**
 * The items of one recorded answer against plantegninger/<house>/fasit.json: [{ id, ok, detail }] (ids in Norwegian).
 *   fx: the recording ({ house, file, part, task, source, … }); out: its tidied answer (ai.js tidyResponse);
 *   facadeIndex: for readFacade, which of the file's facades (in the fasit's order) this drawing is.
 * readPlan: every fasit room (label and area, among the marked rooms and the other labels, with its kind – hall and
 * entrance both count for the room with the front door), door counts per variant, windows, skylights, the stair type,
 * the title, the scale text, the dimensions, the ceiling texts; classify: the drawings per kind, their boxes (IoU ≥
 * 0.8), the level of each plan, titles; readFacade: roof, storeys, windows and doors.
 */
export function scoreAnswer(fx, out, { facadeIndex = 0 } = {}) {
  const items = [];
  const add = (id, ok, detail = '') => {
    // a repeated item (the same label twice) gets a number
    const n = items.filter((i) => i.id === id || i.id.startsWith(`${id} #`)).length;
    items.push({ id: n ? `${id} #${n + 1}` : id, ok: !!ok, detail });
  };
  const F = fasitOf(fx.house);
  const file = fx.source?.file ?? fx.hints?.fileName;
  const E = BY_EYE[`${fx.house}/${file} ${fx.task}`] ?? {};
  if (fx.task === 'readPlan') {
    const L = F.levels.find((l) => l.file === file);
    if (!L) return items;
    const pool = [
      ...out.rooms.map((r) => ({ name: r.name, area: r.area, roomKind: r.roomKind, how: r.mark ? `rom ${r.mark}` : 'umerket rom' })),
      ...out.labels.map((l) => ({ name: l.text, area: l.area, roomKind: l.roomKind, how: 'etikett' })),
    ];
    for (const t of L.rooms) {
      const k = pool.findIndex((x) => norm(x.name) === norm(t.label) && sameArea(x.area, t.area));
      const got = k >= 0 ? pool.splice(k, 1)[0] : null;
      const kindOk = got && (got.roomKind === t.kind || (ENTRY.has(t.kind) && ENTRY.has(got.roomKind)));
      add(`rom ${t.label}${t.area != null ? ` ${t.area}` : ''}`, got && kindOk && !/m²|m2/.test(got.name), got ? `${got.how}: ${got.name} ${got.area ?? '–'} ${got.roomKind} (fasit ${t.kind})` : 'mangler');
    }
    if (E.at) for (const item of placeItems(fx, out, E.at, L.scale?.pxPerM)) add(item.id, item.ok, item.detail);
    const count = (k) => out.openings.filter((o) => o.kind === k).length;
    add('enkeltdører', count('door') === L.doors.single, `${count('door')} (fasit ${L.doors.single})`);
    add('dobbeltdører', count('double-door') === L.doors.double, `${count('double-door')} (fasit ${L.doors.double})`);
    add('skyvedører', count('sliding-door') === L.doors.sliding, `${count('sliding-door')} (fasit ${L.doors.sliding})`);
    add('vinduer', count('window') === L.windows, `${count('window')} (fasit ${L.windows})`);
    add('takvinduer', out.skylights.length === L.skylights, `${out.skylights.length} (fasit ${L.skylights})`);
    const stair = L.stair?.type ?? L.stair ?? 'none';
    add('trapp', stair === 'none' ? !out.stair.present : out.stair.present && out.stair.type === stair, `${out.stair.present ? out.stair.type : 'ingen'} (fasit ${stair})`);
    add('tittel', out.levelTitle === L.title, `${JSON.stringify(out.levelTitle)} (fasit ${JSON.stringify(L.title)})`);
    add('målestokk', out.scaleText === (E.scaleText ?? null), `${JSON.stringify(out.scaleText)} (${JSON.stringify(E.scaleText ?? null)})`);
    const dims = [...out.dimensions];
    for (const d of L.dimensions ?? []) {
      const k = dims.findIndex((x) => x.text === d.text && x.value != null && Math.abs(x.value - d.m) < 0.005);
      const got = k >= 0 ? dims.splice(k, 1)[0] : null;
      add(`mål ${d.text}`, got, got ? `${got.value} ${got.along} ${got.what}` : 'mangler');
    }
    for (const [text, along] of E.outer ?? []) {
      const got = out.dimensions.find((x) => x.text === text);
      add(`ytre mål ${text}`, got && got.along === along && got.what === 'outer', got ? `${got.along} ${got.what}` : 'mangler');
    }
    for (const text of new Set([...(L.ceiling ?? []), ...(E.ceiling ?? [])].map(norm))) add(`himling ${text}`, out.ceiling.some((c) => norm(c) === text), JSON.stringify(out.ceiling));
  } else if (fx.task === 'classify') {
    const f = F.files[file];
    if (!f) return items;
    // the fasit's boxes are in the upload's px; a rectified photo has another frame (no boxes there)
    const W = fx.source?.width ?? fx.image?.width;
    const H = fx.source?.height ?? fx.image?.height;
    const boxes = !fx.source?.photo;
    const expected = f.drawings ?? (f.kind === 'facade' ? F.facades.filter((x) => x.file === file).map(() => ({ kind: 'facade' })) : [{ kind: f.kind, level: f.level }]);
    for (const kind of ['plan', 'facade', 'section']) {
      const want = expected.filter((d) => d.kind === kind).length;
      const got = out.drawings.filter((d) => d.kind === kind).length;
      add(`antall ${kind}`, got === want, `${got} (fasit ${want})`);
    }
    expected.forEach((d, i) => {
      if (!['plan', 'facade', 'section'].includes(d.kind)) return;
      const same = out.drawings.filter((x) => x.kind === d.kind);
      const box = d.bbox && boxes ? [d.bbox[0] / W, d.bbox[1] / H, d.bbox[2] / W, d.bbox[3] / H] : null;
      // the drawing the model meant: the best overlap, or the same place in reading order
      const k = box ? same.reduce((b, x, j) => (iou(x.bbox, box) > (b < 0 ? -1 : iou(same[b].bbox, box)) ? j : b), -1) : expected.filter((x) => x.kind === d.kind).indexOf(d);
      const got = same[k];
      const name = d.title && d.title.length <= 12 ? d.title : i;
      if (box) add(`plass ${d.kind} ${name}`, got && iou(got.bbox, box) >= 0.8, got ? `IoU ${iou(got.bbox, box).toFixed(2)}` : 'mangler');
      if (d.kind === 'plan') {
        // level null in the fasit: a separate building (the garage) – the model says detached; beside one, the
        // house's floors are not detached
        const mixed = expected.some((x) => x.kind === 'plan' && x.level == null);
        const ok = got && (d.level == null ? got.detached : got.level === d.level && !(mixed && got.detached));
        add(`etasje plan ${name}`, ok, got ? `${got.level}${got.detached ? ' frittstående' : ''} (fasit ${d.level ?? 'frittstående'})` : 'mangler');
      }
    });
    if (expected.some((d) => d.kind === 'text')) add('tekstblokk', out.drawings.some((d) => d.kind === 'text'));
    for (const t of E.titles ?? []) add(`tittel ${t}`, out.drawings.some((d) => d.title === t), out.drawings.map((d) => d.title).join(' '));
    add('målestokk', out.scaleText === (E.scaleText ?? null), `${JSON.stringify(out.scaleText)} (${JSON.stringify(E.scaleText ?? null)})`);
  } else if (fx.task === 'readFacade') {
    const list = F.facades.filter((f) => f.file === file);
    // by title when both have one (hus7: VEST, SØR, ØST, NORD), else by the drawing's place on the sheet
    const T = (out.title && list.find((f) => f.title && norm(f.title) === norm(out.title))) || list[facadeIndex];
    if (!T) return items;
    // what the model said, also for the parts ai.js does not pass on (AI_FACADE_USE)
    const roof = out.seen ? out.seen.roof : out.roof;
    const windows = out.seen ? out.seen.windows : out.windows;
    const doors = windows.filter((w) => w.kind === 'door').length;
    add('tak', roof === T.roof, `${roof} (fasit ${T.roof})`);
    add('etasjer', out.storeys === T.storeys, `${out.storeys} (fasit ${T.storeys})`);
    add('fasadevinduer', windows.length - doors === T.windows, `${windows.length - doors} (fasit ${T.windows})`);
    add('fasadedører', doors === T.doors, `${doors} (fasit ${T.doors})`);
  }
  return items;
}

/** The recordings in dir: [{ path, fx, key, tag, facadeIndex }] – key «<house>/<file>[ del n] <task>», tag + model. */
export function listFixtures(dir = FIXTURES) {
  const out = [];
  for (const house of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const d = path.join(dir, house);
    if (house === 'cases' || !fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).sort()) {
      if (!/\.(classify|readPlan|readFacade)\.[\w.-]+\.json$/.test(f)) continue;
      const fx = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      const file = fx.source?.file ?? fx.hints?.fileName ?? path.basename(fx.file ?? f);
      const key = `${house}/${file}${fx.part != null ? ` del ${fx.part + 1}` : ''} ${fx.task}`;
      out.push({ path: path.join(d, f), fx, file, key, tag: `${key} ${shortModel(fx.model)}` });
    }
  }
  // the facade index per file and model: the parts in order
  for (const r of out.filter((x) => x.fx.task === 'readFacade')) {
    const mates = out.filter((x) => x.fx.task === 'readFacade' && x.fx.house === r.fx.house && x.file === r.file && x.fx.model === r.fx.model).sort((a, b) => (a.fx.part ?? 0) - (b.fx.part ?? 0));
    r.facadeIndex = mates.indexOf(r);
  }
  return out;
}
