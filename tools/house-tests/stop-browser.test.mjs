#!/usr/bin/env node
/**
 * Node test for tools/stop-browser.mjs and its rule tools/lib/browser-pid.mjs (no browser is started, nothing but this
 * test's own child process is ever stopped):
 *   node tools/house-tests/stop-browser.test.mjs        (from the project root; exit code 1 on failure)
 *
 *   • judgeBrowserPid: a headless msedge.exe AND chrome.exe (a --browser=chrome run, stopped without --browser) started
 *     just before the pidfile → kill; a reused PID (start time outside −120 s … +2 s) → stale; a live process that
 *     started with the pidfile but is no browser, or the owner's own Edge (no --headless / pipe), or no start time →
 *     keep (the pidfile must survive);
 *   • the tool itself (Windows only) against a harmless live `node` child: exit 1, the pidfile is KEPT, the child still
 *     runs (also with --browser=chrome); the same pidfile with a far-off mtime (PID reused) → exit 0, pidfile removed,
 *     child still runs; a dead PID / a pidfile without a PID → exit 0, removed; no pidfile → exit 0; no args → exit 2.
 */
import { check, section, done, ROOT } from './_lib.mjs';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judgeBrowserPid, BEFORE_MS, AFTER_MS } from '../lib/browser-pid.mjs';

// ---------------------------------------------------------------------------------------------------------------------
section('judgeBrowserPid');
const W = Date.UTC(2026, 9, 22, 12, 0, 0);
const HEADLESS = '"C:\\x\\msedge.exe" --headless --remote-debugging-pipe --no-startup-window --user-data-dir=C:\\tmp\\pw';
const j = (name, cmd, created) => judgeBrowserPid({ name, cmd, created, written: W }).verdict;
check('headless msedge.exe started 3 s before the pidfile → kill', j('msedge.exe', HEADLESS, W - 3000) === 'kill');
check('headless chrome.exe (a --browser=chrome run) → kill, no --browser needed', j('chrome.exe', HEADLESS, W - 3000) === 'kill');
check('image name case does not matter (CHROME.EXE) → kill', j('CHROME.EXE', HEADLESS, W - 3000) === 'kill');
check("Playwright's own chrome-headless-shell.exe → kill", j('chrome-headless-shell.exe', HEADLESS, W - 3000) === 'kill');
check(`started exactly ${AFTER_MS} ms after the pidfile → kill`, j('msedge.exe', HEADLESS, W + AFTER_MS) === 'kill');
check(`started ${AFTER_MS + 1} ms after the pidfile (PID reused) → stale`, j('msedge.exe', HEADLESS, W + AFTER_MS + 1) === 'stale');
check(`started ${BEFORE_MS / 1000 + 1} s before the pidfile (PID reused) → stale`, j('chrome.exe', HEADLESS, W - BEFORE_MS - 1000) === 'stale');
check("the owner's own Edge reusing the PID later → stale (never kill)", j('msedge.exe', '"C:\\x\\msedge.exe" --profile-directory=Default', W + 3600e3) === 'stale');
check("the owner's own Edge with a matching start time (no --headless) → keep", j('msedge.exe', '"C:\\x\\msedge.exe" --profile-directory=Default', W - 1000) === 'keep');
check('headless but no --remote-debugging-pipe → keep', j('msedge.exe', '"C:\\x\\msedge.exe" --headless', W - 1000) === 'keep');
check('a live node.exe that started with the pidfile → keep (not stale: the pidfile stays)', j('node.exe', 'node -e x', W - 10) === 'keep');
check('no start time from Windows → keep', j('msedge.exe', HEADLESS, NaN) === 'keep');
check('empty name / command line → keep', judgeBrowserPid({ created: W - 10, written: W }).verdict === 'keep');

// ---------------------------------------------------------------------------------------------------------------------
section('tools/stop-browser.mjs (live, harmless child)');
const run = (...args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'stop-browser.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

{
  const r = run();
  check('no --step / --pidfile → exit 2 (usage)', r.code === 2, `exit ${r.code}: ${r.out}`);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-browser-test-'));
const pidfile = path.join(dir, 'browser.pid');
try {
  {
    const r = run(`--pidfile=${pidfile}`);
    check('no pidfile → exit 0, nothing to stop', r.code === 0 && /no pidfile/.test(r.out), `exit ${r.code}: ${r.out}`);
  }
  {
    fs.writeFileSync(pidfile, 'not a pid\n');
    const r = run(`--pidfile=${pidfile}`);
    check('a pidfile without a PID → exit 0, removed', r.code === 0 && !fs.existsSync(pidfile), `exit ${r.code}: ${r.out}`);
  }
  if (process.platform !== 'win32') {
    console.log('  skip the live cases (Windows only: Get-CimInstance / taskkill)');
  } else {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true });
    const exited = new Promise((res) => child.once('exit', res));
    try {
      const pid = child.pid;
      fs.writeFileSync(pidfile, `${pid}\n`); // written just after the child started, like launchBrowser does
      {
        const r = run(`--pidfile=${pidfile}`);
        check('live node child that started with the pidfile → exit 1', r.code === 1, `exit ${r.code}: ${r.out}`);
        check('… the pidfile is kept', fs.existsSync(pidfile), r.out);
        check('… and the child still runs (nothing killed)', alive(pid));
        check('… the message says so', /nothing was killed/.test(r.out) && /kept the pidfile/.test(r.out), r.out);
      }
      {
        const r = run(`--pidfile=${pidfile}`, '--browser=chrome');
        check('same with --browser=chrome → exit 1, pidfile kept, child runs', r.code === 1 && fs.existsSync(pidfile) && alive(pid), `exit ${r.code}: ${r.out}`);
      }
      {
        const later = new Date(Date.now() + 10 * 60e3);
        fs.utimesSync(pidfile, later, later); // the child started 10 min "before" → its PID counts as reused
        const r = run(`--pidfile=${pidfile}`);
        check('pidfile written long after the process started (PID reused) → exit 0, pidfile removed', r.code === 0 && !fs.existsSync(pidfile), `exit ${r.code}: ${r.out}`);
        check('… and the child still runs (nothing killed)', alive(pid));
      }
      child.kill();
      await exited;
      {
        fs.writeFileSync(pidfile, `${pid}\n`);
        const r = run(`--pidfile=${pidfile}`);
        check('a PID that is not running → exit 0, pidfile removed', r.code === 0 && !fs.existsSync(pidfile), `exit ${r.code}: ${r.out}`);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

done();
