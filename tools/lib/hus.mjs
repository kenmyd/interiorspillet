/**
 * Shared helpers for the house test tools (tools/shot.mjs, walkmap.mjs, tour.mjs, dump-state.mjs, refcheck.mjs) –
 * notes/hele-huset-design.md §0 and §7.1.
 *
 *   parseArgs(argv)                 → { pos: string[], opt: { key: value } }   (--k=v, --flag → 'true')
 *   ROOT                            the worktree these tools live in (the folder above tools/)
 *   MAIN_ROOT                       the main tree (C:\Dev\Interiørspillet): ROOT itself, or the folder that holds
 *                                   .claude/worktrees/<name>
 *   GPU_LOCK                        <MAIN_ROOT>/.shots/hus/gpu.lock.d – only one headless browser renders at a time
 *   acquireGpuLock({ label })       mkdir-lock: waits HUS_LOCK_WAIT_MS (default 5 s) between tries, removes a lock
 *                                   older than 15 min (stale), keeps its own lock's mtime fresh every minute, releases
 *                                   on exit / Ctrl+C.
 *                                   → release()
 *   launchBrowser({ pidfile })      chromium.launchServer (msedge, headless, GPU flags) + connect; writes the browser's
 *                                   PID to pidfile (removed again by close()). → { browser, pid, close() }
 *   pageUrl(pathOrUrl, port)        '/…' → http://127.0.0.1:<port>/…
 *   watchPage(page)                 prints console errors / warnings / logs and page errors; → { errors: number }
 *   waitReady(page, timeout)        waits for window.__ready, reports window.__error
 *   PAGE_HELPERS                    init script: window.__hus = { kind(), stop(), step(n, h), depUrl(name) } –
 *                                   deterministic frames: stop the page's own loop, then n fixed steps of h seconds
 *                                   (game: editor → room → home.update → hud, sandbox: home.update), then one render
 *   settingsInit(patch)             init script that merges `patch` into the stored game settings
 *                                   (localStorage 'interiorspillet.settings.v1') before the page's scripts run
 *
 * The GPU lock is opt-in in every tool (--lock): agents that take it by hand
 * (`mkdir "C:\Dev\Interiørspillet\.shots\hus\gpu.lock.d"`) must not pass --lock, or the tool waits for their own lock.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, statSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const MAIN_ROOT = (() => {
  const parts = ROOT.split(/[\\/]\.claude[\\/]worktrees[\\/]/);
  return parts.length > 1 ? parts[0] : ROOT;
})();
export const GPU_LOCK = join(MAIN_ROOT, '.shots', 'hus', 'gpu.lock.d');

export function parseArgs(argv = process.argv.slice(2)) {
  const pos = argv.filter((a) => !a.startsWith('--'));
  const opt = Object.fromEntries(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const i = a.indexOf('=');
        return i < 0 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
      }),
  );
  return { pos, opt };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ensureDir = (p) => mkdirSync(dirname(resolve(p)), { recursive: true });

/**
 * Takes the shared GPU lock (a directory: mkdir is atomic). Waits `waitMs` between tries; a lock whose directory is
 * older than `staleMs` is removed as stale. Gives up after `timeoutMs` (default 60 min).
 * @returns {Promise<() => void>} release
 */
export async function acquireGpuLock({ label = 'tool', waitMs = Number(process.env.HUS_LOCK_WAIT_MS) || 5000, staleMs = 15 * 60 * 1000, timeoutMs = 60 * 60 * 1000, log = console.log } = {}) {
  mkdirSync(dirname(GPU_LOCK), { recursive: true });
  const t0 = Date.now();
  let said = false;
  for (;;) {
    try {
      mkdirSync(GPU_LOCK);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try {
        age = Date.now() - statSync(GPU_LOCK).mtimeMs;
      } catch {
        continue; // removed between mkdir and stat: try again at once
      }
      if (age > staleMs) {
        log(`[gpu-lock] removing a stale lock (${Math.round(age / 60000)} min old)`);
        rmSync(GPU_LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`gpu lock ${GPU_LOCK} still taken after ${Math.round(timeoutMs / 60000)} min`);
      if (!said) {
        log(`[gpu-lock] ${GPU_LOCK} is taken – waiting (${waitMs / 1000} s between tries)`);
        said = true;
      }
      await sleep(waitMs);
    }
  }
  // the owner line is also the token release() checks: a lock taken over as stale while we held it (the machine slept
  // past the heartbeat) belongs to someone else, and removing it would let two browsers render at once
  const token = `${label} pid ${process.pid} ${new Date().toISOString()} ${ROOT}`;
  let wrote = false;
  try {
    writeFileSync(join(GPU_LOCK, 'owner.txt'), `${token}\n`);
    wrote = true;
  } catch {
    /* without the owner file release() falls back to removing the lock */
  }
  // heartbeat: keep the lock's mtime fresh while we hold it, so a long run is never taken for a stale lock
  const beat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(GPU_LOCK, now, now);
    } catch {
      /* gone – nothing to keep fresh */
    }
  }, 60000);
  beat.unref();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(beat);
    if (wrote) {
      let owner = null;
      try {
        owner = readFileSync(join(GPU_LOCK, 'owner.txt'), 'utf8').trim();
      } catch {
        /* gone, or a new owner has not written its file yet */
      }
      if (owner !== token) {
        if (existsSync(GPU_LOCK)) log(`[gpu-lock] not removing ${GPU_LOCK}: it is no longer ours (owner: ${owner ?? '?'})`);
        return;
      }
    }
    rmSync(GPU_LOCK, { recursive: true, force: true });
  };
  process.once('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.once(sig, () => {
      release();
      process.exit(130);
    });
  }
  return release;
}

export const BROWSER_ARGS = ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];

/**
 * Starts a headless Edge (or --browser=chrome) as a browser server (its PID is known, so a hung run can be stopped
 * with `taskkill /PID <pid> /T /F` – never by image name) and connects to it.
 * @param {{ pidfile?: string|null, channel?: string, args?: string[] }} [o]
 */
export async function launchBrowser({ pidfile = null, channel = 'msedge', args = BROWSER_ARGS } = {}) {
  const server = await chromium.launchServer({ channel, headless: true, args });
  const pid = server.process()?.pid ?? null;
  if (pidfile && pid) {
    ensureDir(pidfile);
    writeFileSync(pidfile, `${pid}\n`);
  }
  const browser = await chromium.connect(server.wsEndpoint());
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
    if (pidfile && existsSync(pidfile)) rmSync(pidfile, { force: true });
  };
  return { browser, pid, close };
}

/** Default PID file: <ROOT>/.shots/hus/<step>/browser.pid (--step=), else <ROOT>/.shots/hus/browser-<tool>.pid. */
export function pidfileFor(opt, tool) {
  if (opt.pidfile) return resolve(opt.pidfile);
  if (opt.step) return join(ROOT, '.shots', 'hus', opt.step, 'browser.pid');
  return join(ROOT, '.shots', 'hus', `browser-${tool}.pid`);
}

export function pageUrl(url, port = 5180) {
  return url.startsWith('/') ? `http://127.0.0.1:${port}${url}` : url;
}

/** Console / page errors → stdout (Vite's own "[vite] …" lines skipped). */
export function watchPage(page, { quiet = false } = {}) {
  const state = { errors: 0 };
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning' || t === 'log' || t === 'info') {
      if (t !== 'error' && m.text().startsWith('[vite]')) return;
      if (t === 'error') state.errors++;
      if (!quiet || t === 'error') console.log(`[console.${t}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => {
    state.errors++;
    console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`);
  });
  return state;
}

/** Waits for window.__ready; returns window.__error (string) or null. */
export async function waitReady(page, timeout = 180000) {
  await page.waitForFunction(() => window.__ready === true, null, { timeout, polling: 250 });
  return page.evaluate(() => window.__error ?? null);
}

/** Settings stored before the page's scripts run (Settings.js reads localStorage in its constructor). */
export function settingsInit(patch) {
  return `(() => { try {
    const k = 'interiorspillet.settings.v1';
    const cur = JSON.parse(localStorage.getItem(k) || '{}');
    localStorage.setItem(k, JSON.stringify(Object.assign(cur, ${JSON.stringify(patch)})));
  } catch (e) {} })();`;
}

/**
 * Page-side helpers (an init script, so every page of every tool has the same stepping semantics).
 *   __hus.kind()          'game' | 'sandbox' | null
 *   __hus.stop()          stops the page's own frame loop (game: running = false + cancelAnimationFrame;
 *                         sandbox: renderer.setAnimationLoop(null))
 *   __hus.step(n, h, o)   n fixed steps of h s (default 1/60) – game: time, editor.update, _updateRoom,
 *                         home.update(h, time, state), hud.update; sandbox: home.update(h, t, { camera,
 *                         playerPosition }) – then one render (o.render !== false). The player is not moved.
 *   __hus.depUrl(name)    URL of a prebundled dependency the page loaded ('three.js',
 *                         'three_addons_math_Capsule__js.js'), wherever the server's cacheDir is
 */
export const PAGE_HELPERS = `(() => {
  const hus = {
    stopped: false,
    t: 0,
    kind() {
      if (window.__sandbox && window.__sandbox.home) return 'sandbox';
      if (window.__game && window.__game.home) return 'game';
      return null;
    },
    stop() {
      const s = window.__sandbox, g = window.__game;
      if (s && s.renderer) s.renderer.setAnimationLoop(null);
      if (g) { g.running = false; cancelAnimationFrame(g._raf); }
      hus.stopped = true;
    },
    step(n = 1, h = 1 / 60, o = {}) {
      if (!hus.stopped) hus.stop();
      const s = window.__sandbox, g = window.__game;
      if (g && g.home) {
        for (let i = 0; i < n; i++) {
          g.time += h;
          if (g.editor) g.editor.update(h);
          g._updateRoom();
          g.home.update && g.home.update(h, g.time, { roomId: g.roomId, playerPosition: g.player.position, camera: g.camera, player: g.player, inputBlocked: g._blocks.size > 0 });
          g.hud.update(h);
        }
        if (o.render !== false) g._render();
      } else if (s && s.home) {
        for (let i = 0; i < n; i++) {
          hus.t += h;
          s.home.update(h, hus.t, { camera: s.camera, playerPosition: s.camera.position });
        }
        if (o.render !== false) s.render();
      }
      return n;
    },
    depUrl(name) {
      const re = new RegExp('/deps/' + name.replace(/[.]/g, '\\\\.') + '([?]|$)');
      const hit = performance.getEntriesByType('resource').map((e) => e.name).find((u) => re.test(u));
      return hit || null;
    },
  };
  window.__hus = hus;
})();`;
