#!/usr/bin/env node
/**
 * Frame time of the lighting test house (notes/belysning-genererte-hus.md) in a headless Edge: dev/belysning.html on a
 * test server, per view the page's __bench – no lamps, the lamp rig (home/lamprig.js: a fixed pool of lights) and one
 * point light per lamp (what the planbygger's 3D view does today) – in that order, so each mode's first frame shows
 * what switching to it compiles.
 *
 *   node tools/belysning-perf.mjs --port=5275 [--views=kjokken,loft,dukkehus] [--frames=120] [--w=1280 --h=960]
 *                                 [--params=level=rich] [--out=<file.json>] [--lock]
 *
 * The browser runs as a server whose PID goes to .shots/hus/browser-belysning-perf.pid (stopped by that PID only).
 */
import { writeFileSync } from 'node:fs';
import { parseArgs, launchBrowser, pidfileFor, pageUrl, watchPage, waitReady, acquireGpuLock } from './lib/hus.mjs';

const { opt } = parseArgs();
const port = Number(opt.port) || 5275;
const views = (opt.views || 'kjokken,loft,trapp,dukkehus').split(',');
const frames = Number(opt.frames) || 120;
const w = Number(opt.w) || 1280, h = Number(opt.h) || 960;
const release = opt.lock ? await acquireGpuLock({ label: 'belysning-perf' }) : () => {};
const { browser, close } = await launchBrowser({ pidfile: pidfileFor(opt, 'belysning-perf') });
const rows = [];
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const watch = watchPage(page, { quiet: true });
  const t0 = Date.now();
  await page.goto(pageUrl(`/dev/belysning.html?mode=evening${opt.params ? `&${opt.params}` : ''}`, port));
  await waitReady(page, 180000);
  const loadMs = Date.now() - t0;
  const head = await page.evaluate(() => ({ info: document.getElementById('info').textContent, gpu: (() => {
    const gl = window.__belysning.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })() }));
  console.log(`${head.gpu}\n${head.info}\nlastet på ${loadMs} ms, ${w}×${h}`);
  for (const view of views) {
    for (const lamps of ['none', 'rig', 'naive']) {
      const r = await page.evaluate(async ([v, l, f]) => {
        window.__setView(v);
        return window.__bench({ lamps: l, frames: f });
      }, [view, lamps, frames]);
      rows.push({ view, ...r });
      console.log(`${view.padEnd(9)} ${lamps.padEnd(6)} ${String(r.ms).padStart(6)} ms/bilde  ${String(r.lights).padStart(3)} lys  ${String(r.calls).padStart(4)} tegnekall  ${String(r.triangles).padStart(6)} trekanter  første bilde ${r.compileMs} ms (${r.newPrograms} nye programmer)`);
    }
  }
  if (watch.errors) console.log(`${watch.errors} feil i konsollen`);
  if (opt.out) writeFileSync(opt.out, JSON.stringify({ gpu: head.gpu, info: head.info, loadMs, w, h, rows }, null, 2));
} finally {
  await close();
  release();
}
