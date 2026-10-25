#!/usr/bin/env node
/**
 * Static thumbnails for the high-wall proposals (public/img/forslag/thumb/<id>.jpg), so the proposal list does not
 * have to render them in the game: headless Edge on the game page, each proposal previewed on the wall
 * (WallPanel.previewProposal), then WallPanel's own thumbnail render (the montage camera, 400 × 320 JPEG).
 * Requires a dev server (`npm run dev`, or pass --port).
 *
 *   node tools/wall-thumbs.mjs [--ids=N40,N41] [--force] [--port=5180] [--browser=msedge] [--wait=900]
 *
 * Without --ids: every built-in proposal that has no montage image and no thumbnail file yet. --force renders the
 * listed ids even when the file exists. The browser runs with its own PID file (stopped by PID, never by name).
 */
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, parseArgs, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, PAGE_HELPERS } from './lib/hus.mjs';

const { opt } = parseArgs();
const port = opt.port ?? 5180;
const wait = Number(opt.wait ?? 900);
const THUMBS = join(ROOT, 'public', 'img', 'forslag', 'thumb');
const proposals = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'wall-proposals.json'), 'utf8')).proposals;
const wanted = opt.ids ? String(opt.ids).split(',') : null;
const ids = proposals
  .filter((p) => !p.image && (wanted ? wanted.includes(p.id) : true))
  .filter((p) => opt.force === 'true' || !existsSync(join(THUMBS, `${p.id}.jpg`)))
  .map((p) => p.id);
if (!ids.length) {
  console.log('ingen miniatyrbilder å lage');
  process.exit(0);
}

const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor(opt, 'wall-thumbs') });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(PAGE_HELPERS);
  const watch = watchPage(page, { quiet: true });
  await page.goto(pageUrl('/?play=1', port), { waitUntil: 'domcontentloaded' });
  const err = await waitReady(page);
  if (err) throw new Error(`page error: ${err}`);
  await page.waitForFunction(() => !!window.__game?.editor?.ui?.wall, null, { timeout: 60000 });
  await page.evaluate(() => window.__game.editor.select({ kind: 'wall', wallId: 'w-hoy' }));
  await page.waitForTimeout(1500);
  for (const id of ids) {
    const url = await page.evaluate(async ({ id, wait }) => {
      const wp = window.__game.editor.ui.wall;
      wp.previewProposal(id);
      await new Promise((r) => setTimeout(r, wait));
      return wp._renderThumb(null, undefined, 0.86);
    }, { id, wait });
    if (!url?.startsWith('data:image/jpeg;base64,')) {
      console.log(`${id}: ingen bilde`);
      code = 1;
      continue;
    }
    writeFileSync(join(THUMBS, `${id}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`${id}: img/forslag/thumb/${id}.jpg`);
  }
  if (watch.errors) code = 2;
} finally {
  await close();
}
process.exit(code);
