#!/usr/bin/env node
/**
 * Runner for the house tests (notes/hele-huset-design.md §6 steg 2, §7.1):
 *
 *   node tools/test-house.mjs [filter …]        (from anywhere; exit code 1 when a test fails)
 *
 * Every tools/house-tests/*.test.mjs is a standalone Node script (no browser): it exits with code 0 when it passes and
 * ≠ 0 when it fails, and loads JSON with registerHooks like tools/test-design.mjs (import './_lib.mjs' first – it
 * registers the hook and gives check()/section()/done()). Each runs in its own process with the repo root as working
 * directory, one after the other, sorted by name; its output is indented under its name. Arguments filter by file
 * name (substring), e.g. `node tools/test-house.mjs layout data`.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'tools', 'house-tests');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filters.length || filters.some((s) => f.includes(s)))
  .sort();

if (!files.length) {
  console.log(`no tests${filters.length ? ` matching ${filters.join(' ')}` : ''} in tools/house-tests`);
  process.exit(filters.length ? 1 : 0);
}
const results = [];
for (const f of files) {
  const t0 = Date.now();
  console.log(`\n▶ ${f}`);
  const r = spawnSync(process.execPath, [join(DIR, f)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\s+$/, '');
  if (out) console.log(out.split('\n').map((l) => `  ${l}`).join('\n'));
  const ok = r.status === 0 && !r.error;
  results.push({ f, ok, ms: Date.now() - t0, status: r.error ? r.error.message : r.status });
}
console.log('\n— house tests');
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.f}  (${r.ms} ms${r.ok ? '' : `, exit ${r.status}`})`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
