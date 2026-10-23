/**
 * Planbygger AI layer, server side (notes/planbygger-runde1-design.md, «KI-laget»): a Connect-style middleware that
 * sends one drawing to Claude and answers with structured JSON. The browser never sees the API key.
 *
 *   createAiHandler({ apiKey = process.env.ANTHROPIC_API_KEY, models, limits, client, log }) → (req, res, next)
 *     GET  /api/planbygger/ai/status → { available, model, models, remaining, promptVersion }
 *     POST /api/planbygger/ai        { task, image: { mediaType, data (base64) }, marks, hints }
 *                                    readHouse: images: [{ mediaType, data, kind: 'plan'|'facade', label }] (1–8) in
 *                                    place of image, marks with their image number (1-based)
 *                                    → { ok: true, task, model, promptVersion, response, usage, cached, remaining }
 *                                    | { ok: false, error, message }   (message in Norwegian, for the page)
 *   createAiService(same options) → { status(ctx), run(input, ctx), peek(input, ctx) }   the same without HTTP (record
 *                                    script, tests); peek: the disk cache's answer for that input, never a call
 *
 * Guards, in a sliding 24 h window:
 * - a quota per session (cookie pb_ai) and per IP, and a cap for the whole server in calls (perServer) and in USD
 *   (maxCostPerWindow). The session quota only spreads one browser's share: a client without the cookie gets a new
 *   session, so the IP quota and the server cap are the real limits. Behind a proxy (Railway) the IP is the LAST
 *   X-Forwarded-For entry, the one the proxy added – the earlier ones come from the client (trustProxy, on by default
 *   when RAILWAY_ENVIRONMENT_NAME or RAILWAY_ENVIRONMENT is set; server.mjs reads the IP the same way);
 * - the model is the server's choice per task: input.model is honoured only for in-process callers that pass
 *   ctx.allowModel (the record script) or with limits.allowModelOverride (a dev flag) – Sonnet costs 20 × Haiku;
 * - images at most 1600 px on the long side (the client scales down, the server only checks the PNG / JPEG / WebP
 *   header); at most 3 calls at a time, the rest wait in a queue; a 60 s deadline per call (the SDK's own retries run
 *   inside it);
 * - a disk cache keyed by sha256(task, promptVersion, model, effort, image, marks, hints) under
 *   .shots/planbygger/ai-cache/ – a hit costs nothing and does not count against the quota.
 *
 * The SDK (@anthropic-ai/sdk, installed only in server/planbygger-ai/node_modules) is imported lazily: without it, or
 * without a key, the status says available: false and every POST answers 503 – the page then works without AI.
 * Requests: messages.create with an image block (base64) and a text block, output_config.format = the task's JSON
 * schema (prompts.mjs), adaptive thinking (the default) with an effort per task, no sampling parameters. stop_reason
 * is checked (refusal, max_tokens) before the content is read. Sonnet requests go through the beta endpoint with the
 * server-side refusal fallback (fallbacks: 'default'); Haiku 5.5 has none.
 *
 * Mount in server.mjs later with one line (not done yet): see notes/planbygger.md.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_VERSION, TASKS, SYSTEM, buildUserText, promptVersionOf, imageLabel } from './prompts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export { PROMPT_VERSION, promptVersionOf };
export const MODELS = Object.freeze({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' });
/** USD per million tokens (input, output) – prompts here stay far below Haiku's 100K-token price step. */
export const PRICES = Object.freeze({
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-sonnet-5': { in: 2, out: 10 },
});
/**
 * The model per task, chosen from what «Generer» builds with each model's recordings, measured against the fasit files
 * (`node tools/planbygger-measure-all.mjs --model readPlan=sonnet` etc.; notes/planbygger.md, «KI-laget»). Sonnet was
 * recorded on the hard cases only (17 drawings, the same image and marks as Haiku's), at about 10 × Haiku's cost per
 * call ($0.272 against $0.027 for those 17):
 * - readPlan (7 plans: hus2, hus3 1. and 2. etasje, hus6, hus8, hus9 both floors) – Haiku. With Sonnet «Generer» named
 *   16 of hus2's 17 rooms against 17, got one room kind less right on hus3 2. etasje and added a skylight hus3 does not
 *   have; it did better on hus6's scan (doors 5/0/4 against 7/0/3, fasit 2/0/6; windows 15 against 17, fasit 8). The
 *   rest was the same, «Ferdig betyr» too. Neither model reads the sliding doors on a marked plan: by the place
 *   checks both got 0 of the 8 on hus2 and hus3 2. etasje right («Generer» gets them from detect.js);
 * - classify (hus1 1. etasje, hus8 plantegning-1, hus9 øvre etasje) – Haiku: both models give the same drawings and
 *   levels (both read «Øvre etg» as level 1); «Generer» came out the same on hus1, with one question less on hus8
 *   (the stair) and underetasje's door counts closer on hus9 (5/0/3 against 3/0/2, fasit 5/0/0) with Sonnet – too
 *   little on 3 sheets for about 12 × the price ($0.0086 against $0.0007 on hus1);
 * - readFacade – Haiku if it is ever asked, but the page does not ask: no part of the answer did better than the
 *   drawing alone (src/planbygger/ai.js, AI_FACADE_USE; Sonnet on 7 facades: house roof 4 of 6 against 5 of 6 without
 *   the AI, door counts error 10 against 5).
 */
export const DEFAULT_MODELS = Object.freeze({
  default: MODELS.haiku,
  classify: MODELS.haiku,
  readPlan: MODELS.haiku,
  readFacade: MODELS.haiku,
  // one call per house that reads all its drawings together (the roof of each wing, the ceilings, the cladding): the
  // reasoning across views is what Haiku did not manage on single facades
  readHouse: MODELS.sonnet,
});
export const DEFAULT_LIMITS = Object.freeze({
  /** calls that reach the API (cache misses) per session cookie / per IP / for the whole server in the window */
  perSession: 40,
  perIp: 150,
  perServer: 1000,
  /** USD for the whole server in the window (what the calls cost, from their usage) */
  maxCostPerWindow: 5,
  windowMs: 24 * 3600 * 1000,
  maxConcurrent: 3,
  maxQueue: 30,
  queueTimeoutMs: 120_000,
  /** the deadline of one call, the SDK's retries included */
  timeoutMs: 60_000,
  maxRetries: 2,
  maxSide: 1600,
  /** decoded image bytes / request body bytes */
  maxImageBytes: 6 * 1024 * 1024,
  maxBodyBytes: 9 * 1024 * 1024,
  maxMarks: 300,
  maxTokens: 16000,
  effort: { classify: 'medium', readPlan: 'medium', readFacade: 'medium', readHouse: 'medium' },
  /** readHouse: at most this many images in one request */
  maxImages: 8,
  /** server-side refusal fallback on the models that have one */
  fallback: true,
  cacheDir: path.join(ROOT, '.shots', 'planbygger', 'ai-cache'),
  /** behind a proxy (Railway): the client IP is the last X-Forwarded-For entry, the one the proxy appended */
  trustProxy: Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT),
  /** honour input.model from any caller (a dev flag; off: only ctx.allowModel callers may pick the model) */
  allowModelOverride: false,
  cookie: 'pb_ai',
});

const MESSAGES = {
  no_key: 'KI er ikke satt opp på denne serveren.',
  no_sdk: 'KI-pakken er ikke installert på serveren.',
  auth: 'KI-nøkkelen ble avvist.',
  quota: 'Du har brukt opp KI-kvoten for i dag.',
  quota_server: 'KI-kvoten for denne serveren er brukt opp for i dag.',
  busy: 'KI-en er opptatt. Prøv igjen om litt.',
  too_large: 'Bildet er for stort (høyst 1600 piksler på den lengste siden).',
  bad_image: 'Bildet kunne ikke leses (PNG, JPEG eller WebP).',
  bad_request: 'Ugyldig forespørsel til KI-en.',
  timeout: 'KI-en svarte ikke i tide.',
  network: 'Fikk ikke kontakt med KI-tjenesten.',
  rate_limited: 'KI-tjenesten er overbelastet. Prøv igjen om litt.',
  refusal: 'KI-en ville ikke lese denne tegningen.',
  truncated: 'Svaret fra KI-en ble avbrutt.',
  bad_json: 'Svaret fra KI-en kunne ikke leses.',
  upstream: 'KI-tjenesten svarte med en feil.',
};
const fail = (status, error, extra = {}) => ({ ok: false, status, error, message: MESSAGES[error] ?? error, ...extra });

// ---------------------------------------------------------------------------------------------------------------
// Image header: type and size without decoding

/** { mediaType, width, height } of a PNG, JPEG or WebP buffer, or null. */
export function imageInfo(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { mediaType: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mediaType: 'image/jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return { mediaType: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { mediaType: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { mediaType: 'image/webp', width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Quota, queue, cache

function quotaStore(limits) {
  const hits = new Map(); // key → timestamps
  const costs = []; // { t, cost } of every billed call, all clients
  const live = (key, now) => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < limits.windowMs);
    if (arr.length) hits.set(key, arr);
    else hits.delete(key);
    return arr;
  };
  const spent = (now) => {
    while (costs.length && now - costs[0].t >= limits.windowMs) costs.shift();
    return costs.reduce((sum, c) => sum + c.cost, 0);
  };
  const keys = ({ session, ip }) => [session && `s:${session}`, ip && `ip:${ip}`, 'all'].filter(Boolean);
  const left = ({ session, ip }, now) => ({
    client: Math.min(session ? limits.perSession - live(`s:${session}`, now).length : limits.perSession, ip ? limits.perIp - live(`ip:${ip}`, now).length : limits.perIp),
    server: spent(now) >= limits.maxCostPerWindow ? 0 : limits.perServer - live('all', now).length,
  });
  return {
    remaining(ctx, now = Date.now()) {
      const l = left(ctx, now);
      return Math.max(0, Math.min(l.client, l.server));
    },
    /** Why a new call may not run: 'quota' (this client), 'quota_server' (every client together), or null. */
    blocked(ctx, now = Date.now()) {
      const l = left(ctx, now);
      return l.client <= 0 ? 'quota' : l.server <= 0 ? 'quota_server' : null;
    },
    take(ctx, now = Date.now()) {
      for (const key of keys(ctx)) hits.set(key, [...live(key, now), now]);
      return now;
    },
    refund(ctx, stamp) {
      for (const key of keys(ctx)) {
        const arr = hits.get(key) ?? [];
        const k = arr.lastIndexOf(stamp);
        if (k >= 0) arr.splice(k, 1);
      }
    },
    /** A call's cost in USD, for the server cap. */
    spend(cost, now = Date.now()) {
      if (Number.isFinite(cost) && cost > 0) costs.push({ t: now, cost });
    },
    spent: (now = Date.now()) => spent(now),
  };
}

function semaphore(max, maxQueue) {
  let active = 0;
  const queue = [];
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) {
      clearTimeout(next.timer);
      active++;
      next.resolve(release);
    }
  };
  return {
    acquire(timeoutMs) {
      if (active < max) {
        active++;
        return Promise.resolve(release);
      }
      if (queue.length >= maxQueue) return Promise.reject(Object.assign(new Error('busy'), { code: 'busy' }));
      return new Promise((resolve, reject) => {
        const item = { resolve };
        item.timer = setTimeout(() => {
          const k = queue.indexOf(item);
          if (k >= 0) queue.splice(k, 1);
          reject(Object.assign(new Error('busy'), { code: 'busy' }));
        }, timeoutMs);
        queue.push(item);
      });
    },
    stats: () => ({ active, queued: queue.length }),
  };
}

/** The cache key: task, prompt version, model and image – plus the effort, marks and hints, which change the request too. */
export function cacheKey({ task, model, data, marks, hints, effort = 'medium' }) {
  const h = crypto.createHash('sha256');
  h.update(`${task}\n${promptVersionOf(task)}\n${model}\n${effort}\n`);
  h.update(data);
  h.update(`\n${JSON.stringify(marks ?? [])}\n${JSON.stringify(hints ?? {})}`);
  return h.digest('hex');
}

function diskCache(dir) {
  const file = (key) => path.join(dir, `${key}.json`);
  return {
    get(key) {
      if (!dir) return null;
      try {
        return JSON.parse(fs.readFileSync(file(key), 'utf8'));
      } catch {
        return null;
      }
    },
    set(key, value) {
      if (!dir) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file(key)}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(value));
        fs.renameSync(tmp, file(key));
      } catch {
        // a cache that cannot be written is only slower
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Input checks

const TASK_NAMES = Object.keys(TASKS);
const clipStr = (v, n) => (typeof v === 'string' ? v.slice(0, n) : v == null ? undefined : String(v).slice(0, n));
const finite01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Marks as the prompt needs them: { id, kind, at, drawnAt }, nothing else. */
function cleanMarks(marks, max) {
  if (!Array.isArray(marks)) return [];
  return marks.slice(0, max).flatMap((m) => {
    if (!m || typeof m.id !== 'string' || !['room', 'opening', 'symbol'].includes(m.kind) || !Array.isArray(m.at)) return [];
    const at = [finite01(m.at[0]), finite01(m.at[1])];
    const drawnAt = Array.isArray(m.drawnAt) ? [finite01(m.drawnAt[0]), finite01(m.drawnAt[1])] : at;
    // readHouse: the image the mark is on (1-based)
    const image = Number.isInteger(m.image) && m.image >= 1 && m.image <= 16 ? { image: m.image } : {};
    return [{ id: m.id.slice(0, 6), kind: m.kind, at, drawnAt, ...image }];
  });
}

/**
 * The images of a request, checked: { ok: true, list: [{ data, info, kind, label }], many, key } (key: what the cache
 * keys on) or a fail(). A readHouse request has input.images (1 … limits.maxImages, each { data, mediaType?, kind:
 * 'plan'|'facade', label }); every other task one input.image.
 */
function imagesOf(input, L) {
  const many = input?.task === 'readHouse';
  const raw = many ? (Array.isArray(input.images) ? input.images : []) : input?.image ? [input.image] : [];
  if (!raw.length || raw.length > (many ? L.maxImages : 1)) return fail(400, 'bad_image');
  const list = [];
  let bytes = 0;
  for (const im of raw) {
    const data = typeof im?.data === 'string' ? im.data.replace(/^data:[^,]*,/, '') : null;
    if (!data) return fail(400, 'bad_image');
    if (data.length > (L.maxImageBytes * 4) / 3 + 4) return fail(413, 'too_large');
    bytes += data.length;
    const info = imageInfo(Buffer.from(data, 'base64'));
    if (!info) return fail(400, 'bad_image');
    if (Math.max(info.width, info.height) > L.maxSide) return fail(413, 'too_large', { width: info.width, height: info.height });
    list.push({ data, info, kind: im.kind === 'plan' || im.kind === 'facade' ? im.kind : null, label: clipStr(im.label, 120) ?? '' });
  }
  if (bytes > (L.maxBodyBytes * 4) / 3) return fail(413, 'too_large');
  const key = many ? list.map((im) => `${im.kind}|${im.label}|${im.data}`).join('\n') : list[0].data;
  return { ok: true, list, many, key };
}

function cleanHints(hints) {
  if (!hints || typeof hints !== 'object') return {};
  const out = {};
  for (const k of ['fileName', 'levelName', 'sheet', 'note']) {
    const v = clipStr(hints[k], 200);
    if (v) out[k] = v;
  }
  return out;
}

const round2 = (v) => Math.round(v * 1e6) / 1e6;
export function costOf(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  const inTok = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return round2((inTok * p.in + (usage.output_tokens ?? 0) * p.out) / 1e6);
}

// ---------------------------------------------------------------------------------------------------------------
// The service

/**
 * @param {{ apiKey?: string, models?: object, limits?: object, client?: object, sdk?: object, log?: Function }} [options]
 *   client: an object with messages.create / beta.messages.create (tests pass a stub); sdk: the SDK module (for the
 *   typed errors; imported lazily otherwise); importSdk: how to import it (tests: a failing import = no SDK)
 */
export function createAiService({ apiKey = process.env.ANTHROPIC_API_KEY, models = {}, limits = {}, client = null, sdk = null, importSdk = () => import('@anthropic-ai/sdk'), log = (s) => console.log(s) } = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits, effort: { ...DEFAULT_LIMITS.effort, ...(limits.effort ?? {}) } };
  const M = { ...DEFAULT_MODELS, ...models };
  const allowed = new Set([...Object.values(MODELS), ...Object.values(M)]);
  const quota = quotaStore(L);
  const gate = semaphore(L.maxConcurrent, L.maxQueue);
  const cache = diskCache(L.cacheDir);
  let authFailed = false;
  let sdkPromise = null;

  /** The SDK module, or null when it is not installed. */
  const loadSdk = () => {
    if (sdk) return Promise.resolve(sdk);
    sdkPromise ??= Promise.resolve().then(importSdk).catch(() => null);
    return sdkPromise;
  };
  let clientPromise = null;
  const getClient = () => {
    if (client) return Promise.resolve(client);
    clientPromise ??= loadSdk().then((mod) => {
      const Anthropic = mod?.default ?? mod?.Anthropic;
      if (!Anthropic || !apiKey) return null;
      return new Anthropic({ apiKey, timeout: L.timeoutMs, maxRetries: L.maxRetries });
    });
    return clientPromise;
  };
  const why = async () => {
    if (!apiKey) return 'no_key';
    if (authFailed) return 'auth';
    if (!client && !(await loadSdk())) return 'no_sdk';
    return null;
  };
  /** The task's model; a requested one only for callers allowed to pick (see the top of the file). */
  const modelFor = (task, requested, mayPick) => {
    if (requested && mayPick) {
      const id = MODELS[requested] ?? requested;
      if (allowed.has(id)) return id;
    }
    return M[task] ?? M.default;
  };

  /** Maps an SDK error to { status, error } with the SDK's typed error classes (most specific first). */
  async function mapError(err, timedOut) {
    const mod = await loadSdk();
    const E = mod ? (mod.default ?? mod) : null;
    const is = (name) => {
      const C = E?.[name] ?? mod?.[name];
      return typeof C === 'function' && err instanceof C;
    };
    if (timedOut || is('APIUserAbortError') || is('APIConnectionTimeoutError')) return { status: 504, error: 'timeout', refund: true };
    if (is('APIConnectionError')) return { status: 502, error: 'network', refund: true };
    if (is('AuthenticationError') || is('PermissionDeniedError')) return { status: 503, error: 'auth', refund: true, auth: true };
    if (is('RateLimitError')) return { status: 503, error: 'rate_limited', refund: true };
    if (is('BadRequestError') || is('NotFoundError') || is('UnprocessableEntityError')) return { status: 502, error: 'bad_request', refund: true };
    if (is('InternalServerError')) return { status: 502, error: 'upstream', refund: true };
    if (is('APIError')) return { status: 502, error: 'upstream', refund: true };
    return { status: 502, error: 'upstream', refund: true };
  }

  return {
    limits: L,
    models: M,
    stats: () => ({ ...gate.stats(), spent: quota.spent() }),

    async status(ctx = {}) {
      const reason = await why();
      return {
        available: !reason,
        model: M.readPlan ?? M.default,
        models: { classify: M.classify ?? M.default, readPlan: M.readPlan ?? M.default, readFacade: M.readFacade ?? M.default, readHouse: M.readHouse ?? M.default },
        remaining: reason ? 0 : quota.remaining(ctx),
        promptVersion: PROMPT_VERSION,
        ...(reason ? { reason } : {}),
      };
    },

    /**
     * What run(input, ctx) would answer from the disk cache, without a call (and without a key): the cached entry
     * { response, usage, cost, ms, servedModel, … } with the model and effort it would use, or null. The record
     * script's dry run uses it to count the real calls a recording would make.
     */
    peek(input, ctx = {}) {
      const task = input?.task;
      if (!TASK_NAMES.includes(task)) return null;
      const imgs = imagesOf(input, L);
      if (!imgs.ok) return null;
      const data = imgs.key;
      const model = modelFor(task, input.model, ctx.allowModel === true || L.allowModelOverride === true);
      const effort = L.effort[task] ?? 'medium';
      const key = cacheKey({ task, model, data, marks: cleanMarks(input.marks, L.maxMarks), hints: cleanHints(input.hints), effort });
      const hit = cache.get(key);
      return hit?.response ? { ...hit, model, effort } : null;
    },

    /**
     * One task on one image.
     * @param {{ task, image: { mediaType?, data }, marks?, hints?, model? }} input
     * @param {{ session?, ip?, noCache?, noQuota?, allowModel? }} [ctx]  noQuota / allowModel: in-process callers only
     */
    async run(input, ctx = {}) {
      const t0 = Date.now();
      const task = input?.task;
      if (!TASK_NAMES.includes(task)) return fail(400, 'bad_request', { detail: 'task' });
      const reason = await why();
      if (reason) return fail(503, reason);
      const imgs = imagesOf(input, L);
      if (!imgs.ok) return imgs;
      const data = imgs.key;
      const marks = cleanMarks(input.marks, L.maxMarks);
      const hints = cleanHints(input.hints);
      const model = modelFor(task, input.model, ctx.allowModel === true || L.allowModelOverride === true);
      const effort = L.effort[task] ?? 'medium';
      const key = cacheKey({ task, model, data, marks, hints, effort });

      if (!ctx.noCache) {
        const hit = cache.get(key);
        if (hit?.response) {
          // cost 0 (nothing is billed now); first: what the call that filled the cache cost
          return { ok: true, status: 200, task, model, servedModel: hit.servedModel ?? model, promptVersion: promptVersionOf(task), response: hit.response, usage: hit.usage ?? null, cost: 0, cached: true, remaining: quota.remaining(ctx), ms: Date.now() - t0, stopReason: hit.stopReason ?? 'end_turn', first: { cost: hit.cost ?? null, ms: hit.ms ?? null } };
        }
      }
      const api = await getClient();
      if (!api) return fail(503, 'no_sdk');
      const blocked = ctx.noQuota ? null : quota.blocked(ctx);
      if (blocked) return fail(429, blocked, { remaining: 0 });
      // the quota is taken before the queue, so waiting calls cannot overrun it; given back if the call never runs
      const stamp = ctx.noQuota ? null : quota.take(ctx);

      let release;
      try {
        release = await gate.acquire(L.queueTimeoutMs);
      } catch {
        if (stamp != null) quota.refund(ctx, stamp);
        return fail(503, 'busy', { remaining: quota.remaining(ctx) });
      }
      const ac = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, L.timeoutMs);
      const params = {
        model,
        max_tokens: L.maxTokens,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: imgs.many
              ? [
                  // readHouse: each image after a line that says what it is, then the instructions
                  ...imgs.list.flatMap((im, i) => [
                    { type: 'text', text: `Image ${i + 1}: ${imageLabel({ ...im, width: im.info.width, height: im.info.height })}` },
                    { type: 'image', source: { type: 'base64', media_type: im.info.mediaType, data: im.data } },
                  ]),
                  { type: 'text', text: buildUserText(task, { marks, hints, images: imgs.list.map((im) => ({ kind: im.kind, label: im.label, width: im.info.width, height: im.info.height })) }) },
                ]
              : [
                  { type: 'image', source: { type: 'base64', media_type: imgs.list[0].info.mediaType, data: imgs.list[0].data } },
                  { type: 'text', text: buildUserText(task, { marks, hints, width: imgs.list[0].info.width, height: imgs.list[0].info.height }) },
                ],
          },
        ],
        output_config: { effort, format: { type: 'json_schema', schema: TASKS[task].schema } },
      };
      const withFallback = L.fallback && model === MODELS.sonnet;
      let msg;
      try {
        msg = withFallback
          ? await api.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: ac.signal, timeout: L.timeoutMs })
          : await api.messages.create(params, { signal: ac.signal, timeout: L.timeoutMs });
      } catch (err) {
        const m = await mapError(err, timedOut);
        if (m.auth) authFailed = true;
        if (m.refund && stamp != null) quota.refund(ctx, stamp);
        log(`[planbygger-ai] ${task} ${model}: ${m.error} (${err?.status ?? err?.name ?? 'error'}) after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return fail(m.status, m.error, { remaining: quota.remaining(ctx) });
      } finally {
        clearTimeout(timer);
        release();
      }

      const servedModel = msg.model ?? model;
      const usage = msg.usage ?? null;
      const cost = costOf(servedModel, usage) ?? costOf(model, usage);
      const ms = Date.now() - t0;
      quota.spend(cost);
      log(`[planbygger-ai] ${task} ${servedModel}: ${usage?.input_tokens ?? '?'} in / ${usage?.output_tokens ?? '?'} out, $${cost?.toFixed(5) ?? '?'}, ${(ms / 1000).toFixed(1)} s, ${msg.stop_reason}`);
      // the stop reason first: a refusal or a cut-off answer does not match the schema
      if (msg.stop_reason === 'refusal') return fail(422, 'refusal', { category: msg.stop_details?.category ?? null, usage, cost, remaining: quota.remaining(ctx) });
      if (msg.stop_reason === 'max_tokens') return fail(502, 'truncated', { usage, cost, remaining: quota.remaining(ctx) });
      const text = (msg.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      let response;
      try {
        response = JSON.parse(text);
      } catch {
        return fail(502, 'bad_json', { usage, cost, remaining: quota.remaining(ctx) });
      }
      if (!response || typeof response !== 'object') return fail(502, 'bad_json', { usage, cost });
      cache.set(key, { task, model, servedModel, promptVersion: promptVersionOf(task), response, usage, cost, ms, stopReason: msg.stop_reason, created: new Date().toISOString() });
      return { ok: true, status: 200, task, model, servedModel, promptVersion: promptVersionOf(task), response, usage, cost, cached: false, remaining: quota.remaining(ctx), ms, stopReason: msg.stop_reason };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP

const ROUTE = '/api/planbygger/ai';

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(text);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('too large'), { code: 'too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The session id from the cookie, or a new one (and the Set-Cookie header for it). */
function session(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{16,64})`).exec(req.headers.cookie || '');
  if (m) return { id: m[1], header: null };
  const id = crypto.randomBytes(18).toString('base64url');
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted ? '; Secure' : '';
  return { id, header: `${name}=${id}; Path=${ROUTE}; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}` };
}

/** The client's IP: behind a trusted proxy the last X-Forwarded-For entry (the proxy appends the address it saw; the
 *  earlier entries come from the client and can be made up), else the socket's address. */
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * The middleware (see the top of the file). Requests outside /api/planbygger/ai go to next().
 * @param {Parameters<typeof createAiService>[0]} [options]
 */
export function createAiHandler(options = {}) {
  const service = createAiService(options);
  const L = service.limits;
  const handler = async (req, res, next) => {
    const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://x');
    const p = url.pathname.replace(/\/+$/, '');
    if (p !== ROUTE && p !== `${ROUTE}/status`) return next ? next() : sendJson(res, 404, { ok: false, error: 'not_found' });
    const sess = session(req, L.cookie);
    const headers = sess.header ? { 'Set-Cookie': sess.header } : {};
    const ctx = { session: sess.id, ip: clientIp(req, L.trustProxy) };
    try {
      if (p === `${ROUTE}/status`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false, error: 'method' }, headers);
        return sendJson(res, 200, await service.status(ctx), headers);
      }
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' }, headers);
      let body;
      try {
        body = JSON.parse((await readBody(req, L.maxBodyBytes)).toString('utf8'));
      } catch (err) {
        const r = fail(err?.code === 'too_large' ? 413 : 400, err?.code === 'too_large' ? 'too_large' : 'bad_request');
        return sendJson(res, r.status, { ok: false, error: r.error, message: r.message }, headers);
      }
      const r = await service.run(body, ctx);
      if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error, message: r.message, remaining: r.remaining ?? null }, headers);
      return sendJson(res, 200, { ok: true, task: r.task, model: r.servedModel ?? r.model, promptVersion: r.promptVersion, response: r.response, usage: r.usage ? { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens } : null, cached: r.cached, remaining: r.remaining }, headers);
    } catch {
      return sendJson(res, 500, { ok: false, error: 'internal', message: 'Intern feil i KI-laget.' }, headers);
    }
  };
  handler.service = service;
  return handler;
}

export default createAiHandler;
