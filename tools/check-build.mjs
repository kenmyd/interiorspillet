#!/usr/bin/env node
/**
 * Production build with a warning gate (design/qa.md §2.5, §7; MASTER §4.0 rule 7):
 *
 *   node tools/check-build.mjs [--out=<dir>] [--json=<file>] [--quiet]
 *     --out    build into this folder (`npm run build -- --outDir <dir> --emptyOutDir`) – agents in the parallel phase
 *              always pass their own folder (e.g. .shots/p09/dist); without it the build writes dist/ (integration only)
 *     --json   writes { exit, ms, warnings, allowed, chunks: [{ file, kB, gzipKB }] } (to compare before and after)
 *     --quiet  only the summary (no chunk table)
 *     --from-log=<file>  check a saved build log instead of building (exit status 0 assumed; the tool's self-test)
 *
 *   exit 0 = vite exited 0, no warning except the known ones, no JS chunk over 2000 kB
 *   exit 1 = a build error, an unknown warning, or a chunk over the limit · exit 2 = the tool itself failed
 *
 * Known (allowed) warnings: exactly two `[IMPORT_IS_UNDEFINED] … estimateShading` (ShoppingPanel.js – known since
 * before this round), plus Rolldown's info line about `debugName` in codeSplitting groups. Anything else that looks like
 * a warning – a `[CODE]` line, «(!)», «Some chunks are larger», a line with «warn» – fails the check.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.CR_ROOT ? path.resolve(process.env.CR_ROOT) : path.resolve(import.meta.dirname, '..');
const LIMIT_KB = 2000;
const ALLOWED = [{ re: /\[IMPORT_IS_UNDEFINED\].*estimateShading/, count: 2, label: 'IMPORT_IS_UNDEFINED estimateShading (ShoppingPanel.js)' }];
const INFO = [/debugName/i];

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
}));
const unknown = Object.keys(opt).filter((k) => !['out', 'json', 'quiet', 'help', 'from-log'].includes(k));
if (opt.help || unknown.length) {
  if (unknown.length) console.error(`check-build: ukjent valg --${unknown.join(' --')}`);
  console.log('bruk: node tools/check-build.mjs [--out=<mappe>] [--json=<fil>] [--quiet]');
  process.exit(unknown.length ? 2 : 0);
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

const t0 = Date.now();
let res;
if (opt['from-log']) res = { status: 0, stdout: fs.readFileSync(path.resolve(opt['from-log']), 'utf8'), stderr: '' };
else try {
  const extra = opt.out ? ` -- --outDir ${quote(path.resolve(ROOT, opt.out))} --emptyOutDir` : '';
  // npm is a .cmd on Windows: run it through the shell (the only argument is our own quoted path)
  res = spawnSync(`npm run build${extra}`, {
    cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
} catch (err) {
  console.error(`check-build: kunne ikke starte npm: ${err.message}`);
  process.exit(2);
}
if (res.error) {
  console.error(`check-build: kunne ikke starte npm: ${res.error.message}`);
  process.exit(2);
}
const ms = Date.now() - t0;
const text = stripAnsi(`${res.stdout ?? ''}\n${res.stderr ?? ''}`);
const lines = text.split(/\r?\n/);

// chunk table: «<file>   1,942.95 kB │ gzip: 463.05 kB»
const UNIT = { B: 1 / 1000, kB: 1, MB: 1000 };
const chunks = [];
const seen = new Set();
for (const l of lines) {
  const m = /^\s*(\S+\.(?:js|css|html|json|wasm|png|jpg|svg|woff2?))\s+([\d,.]+)\s*(B|kB|MB)\b(?:.*gzip:\s*([\d,.]+)\s*(B|kB|MB))?/.exec(l);
  if (!m || seen.has(m[1])) continue;
  seen.add(m[1]);
  const kB = Number(m[2].replace(/,/g, '')) * UNIT[m[3]];
  chunks.push({ file: m[1].replace(/\\/g, '/'), kB: +kB.toFixed(2), gzipKB: m[4] ? +(Number(m[4].replace(/,/g, '')) * UNIT[m[5]]).toFixed(2) : null });
}

// warnings: every «[CODE] …» line (one per warning), «(!)», «Some chunks are larger», «warn»
const warnings = [];
for (const l of lines) {
  const s = l.trim();
  // the source excerpt under a warning («╭─[ file ]», «238 │ code», «│», «╰──»)
  if (!s || /^[│╭╰─┬]/.test(s) || /^\d+\s*│/.test(s)) continue;
  if (/^\[[A-Z][A-Z0-9_]+\]/.test(s) || /\(!\)/.test(s) || /Some chunks are larger/i.test(s) || /\bwarn(ing)?\b/i.test(s)) warnings.push(s);
}
const allowedUsed = ALLOWED.map((a) => ({ ...a, got: 0 }));
const info = [];
const bad = [];
for (const w of warnings) {
  if (INFO.some((re) => re.test(w))) {
    info.push(w);
    continue;
  }
  const a = allowedUsed.find((x) => x.re.test(w));
  if (a && a.got < a.count) {
    a.got++;
    continue;
  }
  bad.push(w);
}
const big = chunks.filter((c) => c.file.endsWith('.js') && c.kB > LIMIT_KB);
const largest = [...chunks].filter((c) => c.file.endsWith('.js')).sort((a, b) => b.kB - a.kB)[0];

if (!opt.quiet) {
  console.log('chunk'.padEnd(64), 'kB'.padStart(10), 'gzip kB'.padStart(10));
  for (const c of [...chunks].sort((a, b) => a.kB - b.kB)) {
    console.log(`${c.file.length > 63 ? `…${c.file.slice(-62)}` : c.file}`.padEnd(64), c.kB.toFixed(2).padStart(10), (c.gzipKB ?? '').toString().padStart(10), c.file.endsWith('.js') && c.kB > LIMIT_KB ? '  ← over 2000 kB' : '');
  }
}
for (const w of info) console.log(`info  ${w}`);
for (const a of allowedUsed) console.log(`kjent ${a.label}: ${a.got} av ${a.count}`);
for (const w of bad) console.log(`FEIL  ny advarsel: ${w}`);
for (const c of big) console.log(`FEIL  ${c.file} er ${c.kB} kB (grense ${LIMIT_KB} kB)`);
if (res.status !== 0) {
  const tail = lines.filter((l) => l.trim()).slice(-15).join('\n');
  console.log(`FEIL  vite build avsluttet med ${res.status}\n${tail}`);
}
if (!chunks.length && res.status === 0) console.log('FEIL  fant ingen chunk-tabell i utskriften (har vite endret formatet?)');

const ok = res.status === 0 && !bad.length && !big.length && chunks.length > 0;
if (opt.json) {
  const out = path.resolve(ROOT, opt.json);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ exit: res.status, ok, ms, outDir: opt.out ?? 'dist', warnings: bad, allowed: allowedUsed.map(({ label, got }) => ({ label, got })), info, chunks }, null, 1)}\n`);
  console.log(`json: ${out}`);
}
console.log(`${ok ? 'check-build OK' : 'check-build FEILET'} – vite exit ${res.status}, ${chunks.filter((c) => c.file.endsWith('.js')).length} js-chunker, største ${largest ? `${largest.file.split('/').pop()} ${largest.kB} kB` : '–'}, ${bad.length} nye advarsler, ${(ms / 1000).toFixed(1)} s`);
process.exit(ok ? 0 : 1);
