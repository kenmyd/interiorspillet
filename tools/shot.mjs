#!/usr/bin/env node
/**
 * Headless screenshot tool (Microsoft Edge / Chrome via playwright-core – no browser download needed).
 * Requires the dev server: `npm run dev` (http://127.0.0.1:5180).
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
 *                             needs a page that defines window.__setView(pos, look, fov) (none yet in this game)
 *     --steps='[{"js":"...","wait":300,"out":"a.png"}, ...]'
 *                             generic: run js, wait, screenshot – in sequence
 *     --keys='[["KeyW",1500],["KeyD",500]]'   hold keys (ms) on the page before the shot (game page)
 *     --browser=msedge|chrome
 *     --port=5180             dev server port for path URLs
 *
 * Prints page console errors / warnings / logs (except Vite's own "[vite] …" lines) and page exceptions, plus the
 * return value of --eval / --post-eval when it is not undefined. Exit code 2 if the page reported an error.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
    }),
);

let [url, out = 'shot.png'] = pos;
if (!url) {
  console.error('usage: node tools/shot.mjs <url-or-path> <out.png> [--w= --h= --wait= --eval= --post-eval= --views= --steps= --keys=]');
  process.exit(1);
}
if (url.startsWith('/')) url = `http://127.0.0.1:${opt.port ?? 5180}${url}`;
const width = Number(opt.w ?? 1280);
const height = Number(opt.h ?? 720);
const wait = Number(opt.wait ?? 500);
const timeout = Number(opt.timeout ?? 180000);

const ensureDir = (p) => mkdirSync(dirname(resolve(p)), { recursive: true });

const browser = await chromium.launch({
  channel: opt.browser ?? 'msedge',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
let hadError = false;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning' || t === 'log' || t === 'info') {
      if (t !== 'error' && m.text().startsWith('[vite]')) return;
      if (t === 'error') hadError = true;
      console.log(`[console.${t}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => {
    hadError = true;
    console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout, polling: 250 });
  const err = await page.evaluate(() => window.__error ?? null);
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

  if (opt.views) {
    for (const v of JSON.parse(opt.views)) {
      await page.evaluate((v) => window.__setView(v.pos, v.look, v.fov), v);
      await page.waitForTimeout(Number(v.wait ?? 250));
      ensureDir(v.out);
      await page.screenshot({ path: v.out });
      console.log(`saved ${v.out}`);
    }
  } else if (opt.steps) {
    for (const s of JSON.parse(opt.steps)) {
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
} catch (e) {
  hadError = true;
  console.error(`[shot] ${e.message}`);
} finally {
  await browser.close();
}
process.exit(hadError ? 2 : 0);
