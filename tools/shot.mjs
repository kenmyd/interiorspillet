#!/usr/bin/env node
/**
 * Headless screenshot tool (Microsoft Edge / Chrome via playwright-core – no browser download needed).
 * Requires a dev server: `npm run dev` (http://127.0.0.1:5180) or the house test server
 * (`npx vite --config tools/vite.test.config.mjs --port 525N --strictPort`, then always pass --port=525N).
 *
 * Usage:
 *   node tools/shot.mjs <url-or-path> <out.png> [options]
 *     url-or-path: full URL, or a path like "/?play=1&pos=5,0,7.5&yaw=0"
 *   Options:
 *     --w=1280 --h=720        viewport
 *     --wait=500              extra ms after window.__ready
 *     --timeout=180000        max ms to wait for window.__ready
 *     --eval="js"             run JS in the page after ready (before --keys and the shot)
 *     --post-eval="js"        run JS after --keys (e.g. log the player position after walking), before the shot
 *     --views='[{"pos":[x,y,z],"look":[x,y,z],"fov":60,"out":"a.png"}, ...]'
 *                             needs a page that defines window.__setView(pos, look, fov) (dev/sandbox.html)
 *     --steps=N               deterministic frame: stop the page's own loop, then N fixed steps of 1/60 s
 *                             (game: editor → room → home.update → hud; sandbox: home.update) and one render before
 *                             the shot (tools/lib/hus.mjs __hus.step). Also turns «Automatisk oppløsning» off
 *                             (unless --settings says otherwise), so the resolution never depends on the GPU's speed.
 *     --steps='[{"js":"...","wait":300,"out":"a.png"}, ...]'
 *                             generic: run js, wait, screenshot – in sequence
 *     --keys='[["KeyW",1500],["KeyD",500]]'   hold keys (ms) on the page before the shot (game page)
 *     --hide=#info,#labels    hide these elements (and everything inside them) in the shot – visibility, so the layout
 *                             (and the framing of the overview, which reads the HUD's rects) does not change.
 *                             Game page: --hide=#ui-root hides the whole HUD.
 *     --settings='{"autoResolution":false}'   game settings stored before the page loads (localStorage)
 *     --browser=msedge|chrome
 *     --port=5180             dev server port for path URLs
 *     --lock                  take the shared GPU lock (C:\Dev\Interiørspillet\.shots\hus\gpu.lock.d) around the run
 *                             – leave it out when you hold the lock yourself
 *     --pidfile=path | --step=<name>   where the browser's PID is written (default .shots/hus/<step>/browser.pid,
 *                             without --step .shots/hus/browser-shot.pid); removed again when the browser closes
 *
 * Prints page console errors / warnings / logs (except Vite's own "[vite] …" lines) and page exceptions, plus the
 * return value of --eval / --post-eval when it is not undefined. Exit code 2 if the page reported an error.
 */
import { parseArgs, ensureDir, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS, settingsInit } from './lib/hus.mjs';

const { pos, opt } = parseArgs();

let [url, out = 'shot.png'] = pos;
if (!url) {
  console.error('usage: node tools/shot.mjs <url-or-path> <out.png> [--w= --h= --wait= --eval= --post-eval= --views= --steps= --keys= --hide= --settings= --port= --lock]');
  process.exit(1);
}
url = pageUrl(url, opt.port ?? 5180);
const width = Number(opt.w ?? 1280);
const height = Number(opt.h ?? 720);
const wait = Number(opt.wait ?? 500);
const timeout = Number(opt.timeout ?? 180000);
const fixedSteps = opt.steps != null && /^\d+$/.test(opt.steps) ? Number(opt.steps) : null;
const stepList = opt.steps != null && fixedSteps == null ? JSON.parse(opt.steps) : null;
const settings = { ...(fixedSteps != null ? { autoResolution: false } : {}), ...(opt.settings ? JSON.parse(opt.settings) : {}) };
const hide = opt.hide ? opt.hide.split(',').map((s) => s.trim()).filter(Boolean) : [];

const release = opt.lock === 'true' ? await acquireGpuLock({ label: `shot ${out}` }) : null;
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor(opt, 'shot') });
let hadError = false;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(PAGE_HELPERS);
  if (Object.keys(settings).length) await page.addInitScript(settingsInit(settings));
  const watch = watchPage(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const err = await waitReady(page, timeout);
  if (err) {
    hadError = true;
    console.log(`[page __error] ${err}`);
  }
  await page.waitForTimeout(wait);

  const show = (label, v) => {
    if (v !== undefined) console.log(`[${label}] ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  };
  if (opt.eval) show('eval', await page.evaluate(opt.eval));

  if (opt.keys) {
    await page.mouse.click(width / 2, height / 2, { button: 'left' }).catch(() => {});
    for (const [code, ms] of JSON.parse(opt.keys)) {
      await page.keyboard.down(code);
      await page.waitForTimeout(Number(ms));
      await page.keyboard.up(code);
    }
    await page.waitForTimeout(200);
  }
  if (opt['post-eval']) show('post-eval', await page.evaluate(opt['post-eval']));

  if (hide.length) {
    await page.addStyleTag({ content: hide.map((s) => `${s}, ${s} * { visibility: hidden !important; }`).join('\n') });
  }
  if (fixedSteps != null) {
    // nothing still on its way over the network (a late texture would make the frame depend on timing)
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => console.log('[shot] --steps: the network did not go idle within 30 s'));
    const kind = await page.evaluate((n) => {
      const k = window.__hus.kind();
      window.__hus.step(n);
      return k;
    }, fixedSteps);
    if (!kind) console.log('[shot] --steps: neither window.__game nor window.__sandbox – the page was not stepped');
    // let the compositor present the stepped frame (no rAF of our own runs any more)
    await page.waitForTimeout(100);
  }

  if (opt.views) {
    for (const v of JSON.parse(opt.views)) {
      await page.evaluate((v) => window.__setView(v.pos, v.look, v.fov), v);
      await page.waitForTimeout(Number(v.wait ?? 250));
      ensureDir(v.out);
      await page.screenshot({ path: v.out });
      console.log(`saved ${v.out}`);
    }
  } else if (stepList) {
    for (const s of stepList) {
      if (s.js) await page.evaluate(s.js);
      await page.waitForTimeout(Number(s.wait ?? 250));
      if (s.out) {
        ensureDir(s.out);
        await page.screenshot({ path: s.out });
        console.log(`saved ${s.out}`);
      }
    }
  } else {
    ensureDir(out);
    await page.screenshot({ path: out });
    console.log(`saved ${out}`);
  }
  const gl = await page.evaluate(() => {
    try {
      const c = document.createElement('canvas').getContext('webgl2');
      const ext = c.getExtension('WEBGL_debug_renderer_info');
      return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    } catch {
      return 'n/a';
    }
  });
  console.log(`[gpu] ${gl}`);
  if (watch.errors) hadError = true;
} catch (e) {
  hadError = true;
  console.error(`[shot] ${e.message}`);
} finally {
  await close();
  release?.();
}
process.exit(hadError ? 2 : 0);
