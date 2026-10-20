#!/usr/bin/env node
/**
 * Packs the web version for upload: dist/ (from `vite build`) + deploy/.htaccess → deploy/interiorspillet-web.zip.
 * `npm run pack` runs the build first and then this script. No dependencies: a small ZIP writer (deflate via
 * node:zlib, CRC-32, UTF-8 names) so it works the same on Windows, macOS and Linux.
 *
 * usage: node tools/pack.mjs [--out=deploy/interiorspillet-web.zip] [--no-htaccess]
 * The zip has the CONTENTS of dist/ at its root (index.html, assets/, img/ …) plus .htaccess, so it can be unpacked
 * straight into the folder on the web server (e.g. public_html/stue/).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const dist = join(root, 'dist');
const out = resolve(root, args.out || 'deploy/interiorspillet-web.zip');
const htaccess = join(root, 'deploy', '.htaccess');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[pack] fant ikke dist/index.html – kjør «npm run build» først (eller bruk «npm run pack»).');
  process.exit(1);
}

/** All files below dir (sorted, forward-slash relative paths). */
function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

const entries = walk(dist).map((p) => ({ name: relative(dist, p).split('\\').join('/'), path: p }));
if (!args['no-htaccess']) {
  if (existsSync(htaccess)) entries.push({ name: '.htaccess', path: htaccess });
  else console.warn('[pack] deploy/.htaccess mangler – pakker uten den');
}

// ---- CRC-32 (IEEE) ----------------------------------------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time of a Date. */
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 31);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// already-compressed formats are stored, everything else deflated
const STORE = /\.(jpe?g|png|webp|gif|zip|gz|br|woff2?)$/i;
const chunks = [];
const central = [];
let offset = 0;
let rawTotal = 0;
for (const e of entries) {
  const data = readFileSync(e.path);
  rawTotal += data.length;
  const nameBuf = Buffer.from(e.name, 'utf8');
  const crc = crc32(data);
  let method = 0;
  let body = data;
  if (!STORE.test(e.name)) {
    const z = deflateRawSync(data, { level: 9 });
    if (z.length < data.length) {
      method = 8;
      body = z;
    }
  }
  const { time, date } = dosTime(statSync(e.path).mtime);
  const flags = 0x0800; // UTF-8 names
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, nameBuf, body);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(0x031e, 4); // made by: UNIX, spec 3.0 (keeps names/permissions sane everywhere)
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(flags, 8);
  cen.writeUInt16LE(method, 10);
  cen.writeUInt16LE(time, 12);
  cen.writeUInt16LE(date, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(body.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt16LE(0, 30);
  cen.writeUInt16LE(0, 32);
  cen.writeUInt16LE(0, 34);
  cen.writeUInt16LE(0, 36);
  cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
  cen.writeUInt32LE(offset, 42);
  central.push(cen, nameBuf);
  offset += local.length + nameBuf.length + body.length;
}
const cenStart = offset;
const cenSize = central.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cenSize, 12);
end.writeUInt32LE(cenStart, 16);
end.writeUInt16LE(0, 20);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([...chunks, ...central, end]));
const mb = (n) => (n / 1048576).toFixed(1).replace('.', ',');
console.log(`[pack] ${entries.length} filer (${mb(rawTotal)} MB) → ${relative(root, out)} (${mb(statSync(out).size)} MB)`);
console.log('[pack] Pakk ut innholdet i mappen på webserveren (f.eks. public_html/stue/). Se deploy/LES_MEG_OPPLASTING.md.');
