/**
 * Polite fetch for the research tools (tools/research/bohus-probe.mjs, pageprobe.mjs, fetch.mjs): a shared per-host
 * throttle across every process on this machine, a back-off on rate limits and bot challenges, and a response cache.
 * Several research agents run at the same time; this keeps them from hammering one store.
 *
 *   import { politeFetch } from './net.mjs';
 *   const res = await politeFetch(url, init, { minGapMs = 2000, cache = true, ttlH = 12, timeoutMs = 60000, quiet = false });
 *   → a Response (status, headers, text(), json(), arrayBuffer()); res.url = the final URL, res.fromCache = true|false
 *
 * Shared per-host throttle (all files under <ROOT>/.shots/net/, git-ignored; <host> without a leading «www.»):
 *   <host>.lock     a lock directory (mkdir is atomic); one older than 60 s is stale and removed
 *   <host>.last     the time (ms) of the last request to the host; written under the lock, so requests to one host
 *                   from all processes start ≥ minGapMs apart
 *   <host>.backoff  written on HTTP 429, or 403/503 with a bot challenge (Cloudflare, Vercel checkpoint): until that
 *                   time (now + 60 s) every request to the host throws at once. There is no retry loop – never try to
 *                   get around a challenge.
 * Cache: GET responses (and POSTs to the Bohus GraphQL endpoint, keyed on the body) with a 2xx status are stored in
 * <ROOT>/.shots/net/cache/<sha1>.json for ttlH hours; a hit makes no request. `cache: false` skips reading and
 * writing it. Each call prints one line to stderr («[net] …», `quiet: true` silences it).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const NET_DIR = join(ROOT, '.shots', 'net');
export const CACHE_DIR = join(NET_DIR, 'cache');

const LOCK_STALE_MS = 60 * 1000;
const BACKOFF_MS = 60 * 1000;
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostKey = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '_');
const log = (quiet, ...m) => {
  if (!quiet) console.error('[net]', ...m);
};

/** Body of a request init as a string (for the cache key), or null when it is not a plain string/buffer. */
function bodyText(init) {
  const b = init?.body;
  if (b == null) return '';
  if (typeof b === 'string') return b;
  if (b instanceof URLSearchParams) return b.toString();
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('utf8');
  if (b instanceof ArrayBuffer) return Buffer.from(b).toString('utf8');
  return null;
}

/** Cache file of a request, or null when the request is not cacheable (only GET and the Bohus GraphQL POST are). */
function cacheFile(url, init) {
  const method = String(init?.method || 'GET').toUpperCase();
  const u = new URL(url);
  let key = null;
  if (method === 'GET') key = `GET ${u.href}`;
  else if (method === 'POST' && /(^|\.)bohus\.no$/i.test(u.hostname) && u.pathname === '/graphql') {
    const body = bodyText(init);
    if (body != null) key = `POST ${u.href}\n${body}`;
  }
  return key ? join(CACHE_DIR, `${createHash('sha1').update(key).digest('hex')}.json`) : null;
}

function toResponse(rec, fromCache) {
  const buf = Buffer.from(rec.body, 'base64');
  const res = new Response(NULL_BODY.has(rec.status) ? null : buf, { status: rec.status, statusText: rec.statusText, headers: rec.headers });
  Object.defineProperty(res, 'url', { value: rec.url, enumerable: true });
  Object.defineProperty(res, 'fromCache', { value: fromCache, enumerable: true });
  return res;
}

function readCache(file, ttlH) {
  try {
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - rec.time <= ttlH * 3600 * 1000) return rec;
  } catch {
    /* no cache entry, or a broken one: fetch again */
  }
  return null;
}

function writeCache(file, rec) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec));
  renameSync(tmp, file); // atomic: a parallel reader never sees half a file
}

/** Throws while the host's back-off file lies in the future. */
function checkBackoff(host) {
  let until = 0;
  try {
    until = Number(readFileSync(join(NET_DIR, `${host}.backoff`), 'utf8')) || 0;
  } catch {
    return;
  }
  if (until > Date.now()) {
    throw new Error(`${host} is in back-off for ${Math.ceil((until - Date.now()) / 1000)} s more (rate limit / bot challenge) – no retry, try later`);
  }
}

/** Waits for the host's turn: under the host lock, sleeps until minGapMs after the last request, then stamps now. */
async function takeTurn(host, minGapMs) {
  mkdirSync(NET_DIR, { recursive: true });
  const lock = join(NET_DIR, `${host}.lock`);
  const last = join(NET_DIR, `${host}.last`);
  for (;;) {
    checkBackoff(host);
    try {
      mkdirSync(lock);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // released between mkdir and stat: try again at once
      }
      if (age > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
      else await sleep(150 + Math.random() * 150);
      continue;
    }
    try {
      let t = 0;
      try {
        t = Number(readFileSync(last, 'utf8')) || 0;
      } catch {
        /* first request to this host */
      }
      const wait = t + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      checkBackoff(host); // another process may have hit a 429 while we waited
      writeFileSync(last, String(Date.now()));
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
    return;
  }
}

/** A 403/503 page that is a bot challenge (Cloudflare «Just a moment», Vercel Security Checkpoint, captcha). */
function isChallenge(res, text) {
  if (res.headers.get('cf-mitigated') || res.headers.get('x-vercel-mitigated')) return true;
  return /just a moment|challenge-platform|cf-chl|security checkpoint|captcha/i.test(text.slice(0, 200000));
}

/**
 * fetch() with the shared per-host throttle, back-off and cache described in the header.
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ minGapMs?: number, cache?: boolean, ttlH?: number, timeoutMs?: number, quiet?: boolean }} [o]
 * @returns {Promise<Response & { fromCache: boolean }>}
 */
export async function politeFetch(url, init = {}, { minGapMs = 2000, cache = true, ttlH = 12, timeoutMs = 60000, quiet = false } = {}) {
  url = String(url);
  const method = String(init.method || 'GET').toUpperCase();
  const file = cache ? cacheFile(url, init) : null;
  if (file) {
    const rec = readCache(file, ttlH);
    if (rec) {
      log(quiet, `cache ${method} ${url} (${rec.status}, ${new Date(rec.time).toISOString().slice(0, 16)})`);
      return toResponse(rec, true);
    }
  }
  const host = hostKey(url);
  await takeTurn(host, minGapMs);
  const t0 = Date.now();
  const res = await fetch(url, { redirect: 'follow', ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  const buf = Buffer.from(await res.arrayBuffer());
  log(quiet, `${method} ${url} → HTTP ${res.status} ${buf.length} B ${Date.now() - t0} ms`);
  if (res.status === 429 || ((res.status === 403 || res.status === 503) && isChallenge(res, buf.toString('utf8')))) {
    mkdirSync(NET_DIR, { recursive: true });
    writeFileSync(join(NET_DIR, `${host}.backoff`), String(Date.now() + BACKOFF_MS));
    throw new Error(`HTTP ${res.status} from ${host} (rate limit / bot challenge) – ${host} backs off for ${BACKOFF_MS / 1000} s; do not retry or try to get around it`);
  }
  // fetch() has decoded the body already: drop the transfer headers that describe the encoded one
  const headers = [...res.headers].filter(([k]) => !/^(content-encoding|content-length|transfer-encoding)$/i.test(k));
  const rec = { time: Date.now(), method, url: res.url || url, status: res.status, statusText: res.statusText, headers, body: buf.toString('base64') };
  if (file && res.ok) writeCache(file, { ...rec, request: url });
  return toResponse(rec, false);
}
