#!/usr/bin/env node
/**
 * stop-browser.mjs – stops the headless browser that a house tool (shot, tour, perf, walkmap, dump-state, refcheck …)
 * started for one step, and nothing else. Use it for a hung run instead of taskkill (never kill by image name: the
 * owner's own Edge must survive).
 *
 *   node tools/stop-browser.mjs --step=<id> [--browser=chrome] [--pidfile=<file>]
 *
 * Reads <ROOT>/.shots/hus/<id>/browser.pid – the file tools/lib/hus.mjs launchBrowser writes for --step=<id>
 * (--pidfile=<file> reads another one) – and asks Windows about that PID (PowerShell
 * `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`). Only when
 *   - the process exists,
 *   - its Name is msedge.exe (chrome.exe with --browser=chrome),
 *   - its CommandLine contains --headless and --remote-debugging-pipe (a Playwright browser server, never a normal
 *     Edge window), and
 *   - it was started just before the pidfile was written (CreationDate within 120 s before the pidfile's mtime, 2 s
 *     clock slack after it) – so a newer process that reuses the PID is never hit,
 * it runs `taskkill /PID <pid> /T /F` (the browser and its child processes) and removes the pidfile. Otherwise it
 * deletes the stale pidfile and kills nothing.
 *
 * Exit code: 0 = stopped, or nothing to stop; 1 = taskkill failed; 2 = usage.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BEFORE_MS = 120 * 1000; // launchServer → pidfile written: a few seconds in practice
const AFTER_MS = 2000; // file-system / clock granularity

const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
    }),
);
const say = (m) => console.log(`[stop-browser] ${m}`);

if (!opt.pidfile && !/^[\w.-]+$/.test(opt.step || '')) {
  console.error('usage: node tools/stop-browser.mjs --step=<id> [--browser=chrome] [--pidfile=<file>]');
  process.exit(2);
}
const pidfile = opt.pidfile ? resolve(opt.pidfile) : join(ROOT, '.shots', 'hus', opt.step, 'browser.pid');
const image = opt.browser === 'chrome' ? 'chrome.exe' : 'msedge.exe';

const stale = (why) => {
  rmSync(pidfile, { force: true });
  say(`${why} – removed the stale pidfile ${pidfile}; nothing was killed`);
  process.exit(0);
};

if (!existsSync(pidfile)) {
  say(`no pidfile ${pidfile} – nothing to stop`);
  process.exit(0);
}
const raw = readFileSync(pidfile, 'utf8').trim();
const pid = Number(raw);
if (!/^\d+$/.test(raw) || !(pid > 0)) stale(`pidfile holds no PID («${raw.slice(0, 40)}»)`);
const written = statSync(pidfile).mtimeMs;

// One CIM query for exactly this PID: name, command line, start time (Unix ms).
const ps = [
  `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";`,
  'if ($p) { [pscustomobject]@{ Name = $p.Name; CommandLine = $p.CommandLine;',
  'Created = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }',
].join(' ');
const q = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
if (q.error || q.status !== 0) {
  say(`could not ask Windows about PID ${pid} (${q.error?.message || q.stderr.trim() || `exit ${q.status}`}) – nothing was killed`);
  process.exit(1);
}
const out = q.stdout.trim();
if (!out) stale(`PID ${pid} is not running`);
let info;
try {
  info = JSON.parse(out);
} catch {
  say(`unexpected answer for PID ${pid}: ${out.slice(0, 200)} – nothing was killed`);
  process.exit(1);
}
const name = String(info.Name || '');
const cmd = String(info.CommandLine || '');
const created = Number(info.Created);
if (name.toLowerCase() !== image) stale(`PID ${pid} is ${name || '?'}, not ${image}`);
if (!cmd.includes('--headless') || !cmd.includes('--remote-debugging-pipe')) {
  stale(`PID ${pid} (${name}) is not a headless Playwright browser (no --headless / --remote-debugging-pipe)`);
}
if (!(created >= written - BEFORE_MS && created <= written + AFTER_MS)) {
  stale(`PID ${pid} (${name}) started ${new Date(created).toISOString()}, not just before the pidfile (${new Date(written).toISOString()}) – the PID was reused`);
}

const k = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
const msg = `${k.stdout || ''}${k.stderr || ''}`.trim();
if (k.status !== 0) {
  say(`taskkill /PID ${pid} /T /F failed (exit ${k.status}): ${msg}`);
  process.exit(1);
}
rmSync(pidfile, { force: true });
say(`stopped headless ${name} PID ${pid} (step ${opt.step || pidfile})${msg ? `\n${msg}` : ''}`);
