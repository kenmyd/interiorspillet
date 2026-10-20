#!/usr/bin/env node
/**
 * Web server for Railway: serves the built game (dist/) behind a password (HTTP Basic Auth). No dependencies.
 *
 *   npm run build && STUE_BRUKER=… STUE_PASSORD=… node server.mjs      (PORT defaults to 8080)
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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 8080;
const USER = process.env.STUE_BRUKER || '';
const PASS = process.env.STUE_PASSORD || '';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const COMPRESS = /^(text\/|application\/json|image\/svg)/;
const gzCache = new Map();

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function authorised(req) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const [u, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  return safeEqual(u, USER) & safeEqual(rest.join(':'), PASS);
}

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
  if (!authorised(req)) {
    return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Interiorspillet", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Logg inn for å åpne Interiørspillet.');
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
    const headers = {
      'Content-Type': type, 'Cache-Control': cacheControl(rel), 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Accept-Encoding',
    };
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
