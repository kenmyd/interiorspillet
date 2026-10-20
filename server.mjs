#!/usr/bin/env node
/**
 * Web server for Railway: serves the built game (dist/) behind a login page. No dependencies.
 *
 *   npm run build && STUE_BRUKER=… STUE_PASSORD=… node server.mjs      (PORT defaults to 8080)
 *
 * Without a valid session cookie every page answers with login.html (self-contained, so nothing from dist/ loads).
 * The form posts username + password back to the same URL; on success the server sets a signed cookie (30 days) and
 * redirects back to that URL. The cookie is an HMAC keyed on STUE_BRUKER/STUE_PASSORD, so changing either logs
 * everyone out. /logg-ut deletes the cookie.
 *
 * Without STUE_BRUKER / STUE_PASSORD the server refuses to serve the game (the room photos and the 3D model of the
 * home must never go public by accident). /healthz answers without a password (Railway health check).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const USER = process.env.STUE_BRUKER || '';
const PASS = process.env.STUE_PASSORD || '';

const LOGIN_PAGE = fs.readFileSync(path.join(HERE, 'login.html'), 'utf8');
const COOKIE = 'stue_sesjon';
const SESSION_S = 30 * 24 * 3600;
const KEY = crypto.createHash('sha256').update(`interiorspillet-sesjon\0${USER}\0${PASS}`).digest();
const PUBLIC = new Set(['/favicon.svg']); // the login page's tab icon
// failed logins per IP: after MAX_FAILS the IP waits until LOCK_MS after its last miss (in memory, reset on restart)
const MAX_FAILS = 10;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN', 'X-Robots-Tag': 'noindex, nofollow',
};
const COMPRESS = /^(text\/|application\/json|image\/svg)/;
const gzCache = new Map();

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------ login */

const sign = (exp) => crypto.createHmac('sha256', KEY).update(String(exp)).digest('base64url');

function loggedIn(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([\\w-]+)`).exec(req.headers.cookie || '');
  return !!m && Number(m[1]) * 1000 > Date.now() && safeEqual(m[2], sign(m[1]));
}

function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function loginPage(res, status, { error = '', user = '' } = {}) {
  // replacer functions, so a «$&» typed as username is not read as a replacement pattern
  const html = LOGIN_PAGE
    .replace('{{FEIL}}', () => (error ? `<p class="error" role="alert">${esc(error)}</p>` : ''))
    .replace('{{BRUKER}}', () => esc(user));
  res.writeHead(status, { ...SECURITY, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
}

function clientIp(req) {
  // Railway's proxy appends the address it saw last; earlier entries could be made up by the client
  return (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
}

function login(req, res, url) {
  const ip = clientIp(req);
  const prev = fails.get(ip);
  const recent = prev && Date.now() - prev.t < LOCK_MS ? prev : null;
  if (recent && recent.n >= MAX_FAILS) {
    req.resume();
    return loginPage(res, 429, { error: 'For mange feil forsøk. Vent et kvarter og prøv igjen.' });
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on('end', () => {
    const form = new URLSearchParams(body);
    const user = form.get('bruker') || '';
    if (safeEqual(user, USER) & safeEqual(form.get('passord') || '', PASS)) {
      fails.delete(ip);
      const exp = Math.floor(Date.now() / 1000) + SESSION_S;
      // back to the page that was asked for («//host» would be read as another site)
      const back = (url.pathname + url.search).replace(/^\/+/, '/');
      return res.writeHead(303, { Location: back, 'Set-Cookie': sessionCookie(req, `${exp}.${sign(exp)}`, SESSION_S), 'Cache-Control': 'no-store' }).end();
    }
    const now = Date.now();
    if (fails.size > 1000) for (const [k, v] of fails) if (now - v.t > LOCK_MS) fails.delete(k);
    fails.set(ip, { n: (recent?.n || 0) + 1, t: now });
    setTimeout(() => loginPage(res, 401, { error: 'Feil brukernavn eller passord.', user }), 700);
  });
}

/* ------------------------------------------------------------------ files */

function cacheControl(rel) {
  if (/^assets\/.+-[A-Za-z0-9_-]{8}\.(js|css)$/.test(rel)) return 'public, max-age=31536000, immutable';
  if (/\.html$/.test(rel)) return 'no-cache';
  if (/\.(jpe?g|png|webp|svg|ico)$/.test(rel)) return 'public, max-age=2592000';
  return 'public, max-age=3600';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  if (!USER || !PASS) {
    return res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Passord er ikke satt opp. Legg inn STUE_BRUKER og STUE_PASSORD som variabler i Railway.');
  }
  if (url.pathname === '/logg-ut') return res.writeHead(303, { Location: '/', 'Set-Cookie': sessionCookie(req, '', 0) }).end();
  if (req.method === 'POST') return login(req, res, url);
  if (!loggedIn(req) && !PUBLIC.has(url.pathname)) {
    // page loads get the login form; anything else (a fetch after the cookie ran out) just a 401
    if (/text\/html/.test(req.headers.accept || '')) return loginPage(res, 200);
    return res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Logg inn for å åpne Interiørspillet.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();

  let rel;
  try {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return res.writeHead(400).end();
  }
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || rel.split('/').some((p) => p.startsWith('.'))) return res.writeHead(404).end();

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Finnes ikke');
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { ...SECURITY, 'Content-Type': type, 'Cache-Control': cacheControl(rel), Vary: 'Accept-Encoding' };
    const gzip = COMPRESS.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (!gzip) {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file).pipe(res);
    }
    const key = `${file}:${st.mtimeMs}`;
    let body = gzCache.get(key);
    if (!body) {
      body = zlib.gzipSync(fs.readFileSync(file), { level: 7 });
      gzCache.set(key, body);
    }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
});

server.listen(PORT, () => {
  console.log(`Interiørspillet på port ${PORT}${USER && PASS ? '' : ' – ADVARSEL: STUE_BRUKER/STUE_PASSORD mangler, siden er stengt'}`);
});
