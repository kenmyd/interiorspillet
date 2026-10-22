#!/usr/bin/env node
/**
 * Browser check of own pictures («egne bilder», design/upload.md §14.3, qa.md S6) on a running dev server:
 *   A (fresh browser context)
 *     store      a test picture (400 × 300: magenta left, cyan right, a yellow band on top) goes through
 *                home.images.addFile → IndexedDB; an own-picture item is added on the living room's west wall and
 *                saved as «Bildetest»; localStorage holds the id, never 'data:image'
 *     exif       a 300 × 200 JPEG with EXIF orientation 6 is stored upright (200 × 300)
 *     dialog     editor.ui.imageUpload.open({ file }) shows «Eget bilde» with the preview, the size / frame controls and
 *                «Plasser på veggen»; a frame style changes the preview; «Plasser på veggen» starts placing the
 *                picture (then cancelled)                                             → dialog.png
 *     catalog    the catalogue on «Kunst og bilder»: the pinned card «Last opp eget bilde» comes first, with
 *                «Nylig lastet opp»                                                    → catalog-card.png
 *     product    a catalogue product that takes a picture (the acoustic «eget motiv» panel): «Med eget bilde …» in
 *                its detail view; the dialog has no size / frame controls and places the product with the picture
 *     drop       a picture file dropped on the game window opens the dialog (the browser does not open the file)
 *     export     «Eksporter til fil» (Design panel) downloads the design with a toast
 *     reload     the page is reloaded with ?design=Bildetest: the item keeps its id, the bytes are in IndexedDB
 *                (hash = id), the picture decodes; the export embeds it                → after-reload.png
 *     wall       (P04: models/artcustom.js) the print texture holds the picture the right way up and it is visible
 *                on screen – reported as «pending» while the art builder has no own-picture texture yet
 *     inspector  selecting the item shows «Bilde» with «Bytt bilde …» / «Tilpass størrelse og ramme …»  → inspector.png
 *     swap       imageUpload.apply(imagePatch(…)) swaps to a second picture; undo brings the first one back
 *     edit       «Tilpass bildet» (open({ uid })): another frame, «Bruk» = one undo step
 *     convert    «Bytt til eget bilde» on today's painting (swapImage): an own picture in the same frame;
 *                «Tilbakestill» brings the painting back (source, name, motif)
 *     shopping   the shopping list has «Egne bilder» with «bestill selv»                → shopping.png
 *   B (new context: empty localStorage and IndexedDB)
 *     import     saves.importText(the export) + images.flush(): the picture is in this browser's IndexedDB, the
 *                design has it, localStorage has no 'data:image'; after a reload it is still there
 *   C (new context with A's localStorage only, no IndexedDB)
 *     missing    the item keeps its id, the store says 'missing', the Inspector shows «Bytt bilde …» and the
 *                «finnes ikke» warning, no console error                              → missing.png
 *
 *   node tools/imagecheck.mjs --port=5190 --lock --step=p05 [--out=<dir>] [--browser=msedge|chrome] [--w=1280 --h=720]
 *     default output .shots/<step>/imagecheck/ (result.json + the screenshots); the PID file is the hus.mjs default
 *     (.shots/hus/<step>/browser.pid – node tools/stop-browser.mjs --step=<step> stops a hung run)
 * Exit code 0 when every check passed (pending ones do not count), 1 otherwise, 3 when the server is down.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HUS = await import(process.env.HUS_LIB || new URL('./lib/hus.mjs', import.meta.url).href);
const { parseArgs, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS, settingsInit, ROOT } = HUS;

const { opt } = parseArgs();
const port = Number(opt.port ?? 5190);
const step = opt.step || 'imagecheck';
const outDir = resolve(ROOT, opt.out || join('.shots', step, 'imagecheck'));
const W = Number(opt.w ?? 1280);
const H = Number(opt.h ?? 720);
const GAME = '/?play=1&nowarm=1&nohelp=1';
mkdirSync(outDir, { recursive: true });

// The test picture hangs on the free stretch of the living room's west wall (w-vest-stue, x 3.22–6.92 at z 11.93):
// right of today's painting (x 4.85–5.85, centre 1.62 m), clear of the palm (x 4.15) that hid it before. Every 3D
// screenshot looks straight at it from 1.2 m, so the picture sits in the middle of the frame (the on-screen pixel
// check samples just left and right of the centre).
const PIC = [6.33, 1.6, 11.93];
const VIEW = { pos: [PIC[0], PIC[1], 10.73], look: PIC, fov: 50 };

const results = [];
const record = (name, status, detail = {}) => {
  results.push({ name, status, ...detail });
  const line = `[imagecheck] ${status === 'ok' ? 'OK' : status === 'pending' ? 'PENDING' : 'FAIL'} ${name}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`;
  console.log(line.length > 900 ? `${line.slice(0, 900)} …` : line);
};

// the server must answer before we take the GPU lock
try {
  const res = await fetch(pageUrl('/', port), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.log(`[imagecheck] server ${port} is down (${err.message}) – nothing checked`);
  process.exit(3);
}

const release = opt.lock === 'true' ? await acquireGpuLock({ label: `imagecheck ${step}` }) : null;
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor(opt, 'imagecheck') });
const t0 = Date.now();

/** A new context + page with the hus helpers; console errors are counted. */
async function newPage(init = null) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.addInitScript(PAGE_HELPERS);
  await page.addInitScript(settingsInit({ autoResolution: false }));
  if (init) await page.addInitScript(init);
  const watch = watchPage(page, { quiet: true });
  return { ctx, page, watch };
}

async function load(page, path = GAME) {
  await page.goto(pageUrl(path, port), { waitUntil: 'domcontentloaded' });
  const err = await waitReady(page, 180000);
  if (err) console.log(`[page __error] ${err}`);
  // the first build and its pictures
  await page.waitForFunction(() => !!(window.__game?.home?.images && window.__game.editor), null, { timeout: 60000, polling: 250 });
  return err;
}

const shot = (page, name) => page.screenshot({ path: join(outDir, name) }).catch((e) => console.log(`[imagecheck] screenshot ${name} failed: ${e.message}`));
/** The 3D screenshot pose (__ic.pose, see HELPERS) – needs the HELPERS on the page. */
const posed = (page) => page.evaluate(() => window.__ic.pose()).catch((e) => console.log(`[imagecheck] pose failed: ${e.message}`));

/** Page helpers (installed per page with page.evaluate). */
const HELPERS = `(() => {
  window.__ic = {
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },
    async waitFor(sel, ms = 8000) { const t0 = Date.now(); while (!document.querySelector(sel) && Date.now() - t0 < ms) await this.sleep(100); return !!document.querySelector(sel); },
    canvasFile(w, h, paint, name, type = 'image/png', q) {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); paint(x, w, h);
      return new Promise((r) => c.toBlob((b) => r(new File([b], name, { type })), type, q));
    },
    testPicture() {
      return this.canvasFile(400, 300, (x) => { x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 200, 300); x.fillStyle = '#00c8ff'; x.fillRect(200, 0, 200, 300); x.fillStyle = '#ffd400'; x.fillRect(0, 0, 400, 45); }, 'Testbilde.png');
    },
    secondPicture() {
      return this.canvasFile(300, 400, (x) => { x.fillStyle = '#2f9e44'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#f2c94c'; x.fillRect(0, 200, 300, 200); }, 'Ferie i Lofoten.png');
    },
    idbGet(id) {
      return new Promise((res) => {
        let r;
        try { r = indexedDB.open('interiorspillet-images', 1); } catch { res(null); return; }
        r.onupgradeneeded = () => { try { r.result.createObjectStore('images', { keyPath: 'id' }); } catch {} };
        r.onsuccess = () => { const db = r.result; try { const g = db.transaction('images').objectStore('images').get(id); g.onsuccess = () => { res(g.result || null); db.close(); }; g.onerror = () => { res(null); db.close(); }; } catch { res(null); db.close(); } };
        r.onerror = () => res(null);
      });
    },
    async gates() { const H = window.__game.home; const t0 = Date.now(); while (H.sync._gates?.size && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50)); },
    printCanvas(uid) {
      let m = null;
      window.__game.home.sync.getObject(uid)?.traverse((o) => { if (o.isMesh && o.userData?.part === 'print') m = o.material; });
      const img = m?.map?.image;
      if (!img || !img.width) return null;
      const k = document.createElement('canvas'); k.width = img.width; k.height = img.height; const q = k.getContext('2d'); q.drawImage(img, 0, 0);
      const px = (fx, fy) => Array.from(q.getImageData(Math.floor(img.width * fx), Math.floor(img.height * fy), 1, 1).data);
      return { W: img.width, H: img.height, L: px(0.25, 0.6), R: px(0.75, 0.6), T: px(0.5, 0.05) };
    },
    /** The screenshot pose: the view on the test picture, the room banner and the toasts timed out, one frame drawn. */
    async pose() {
      window.__setView(${JSON.stringify(VIEW)});
      window.__hus.step(2);
      await this.sleep(1400); // late toasts land first (a low-resolution warning follows its swap after 1.2 s)
      window.__game.hud?.update?.(30); // the room banner and every toast time out
      window.__hus.step(1);
      await this.sleep(800); // their fade-out
    },
    screen() {
      const g = window.__game;
      window.__setView(${JSON.stringify(VIEW)});
      window.__hus.step(60);
      const s = document.createElement('canvas'); s.width = 160; s.height = 90; const sx = s.getContext('2d');
      sx.drawImage(g.renderer.domElement, 0, 0, 160, 90);
      const sp = (x, y) => Array.from(sx.getImageData(x, y, 1, 1).data);
      return { SL: sp(74, 48), SR: sp(86, 48) };
    },
    texOk(t) { return !!t && t.L[0] > 180 && t.L[2] > 180 && t.L[1] < 90 && t.R[1] > 140 && t.R[2] > 180 && t.R[0] < 80 && t.T[0] > 180 && t.T[1] > 160 && t.T[2] < 90; },
    screenOk(s) { return !!s && s.SL[0] > s.SL[1] + 40 && s.SL[2] > s.SL[1] + 40 && s.SR[1] > s.SR[0] + 30 && s.SR[2] > s.SR[0] + 40; },
    async artBuilder() { try { await import('/src/models/artcustom.js'); return true; } catch { return false; } },
    /** A JPEG with EXIF orientation 6 (APP1 inserted after SOI): stored upright? */
    async exif() {
      const f = await this.canvasFile(300, 200, (x) => { x.fillStyle = '#336699'; x.fillRect(0, 0, 300, 200); }, 'exif.jpg', 'image/jpeg', 0.9);
      const u8 = new Uint8Array(await f.arrayBuffer());
      const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
      const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
      const len = body.length + 2;
      const app1 = [0xff, 0xe1, len >> 8, len & 255, ...body];
      const out = new Uint8Array(u8.length + app1.length); out.set(u8.subarray(0, 2), 0); out.set(app1, 2); out.set(u8.subarray(2), 2 + app1.length);
      const res = await window.__game.home.images.addFile(new File([out], 'exif.jpg', { type: 'image/jpeg' }));
      return { w: res.w, h: res.h };
    },
  };
  return true;
})()`;

let lsA = null;
let exported = null;
let picId = null;
let itemUid = null;
try {
  // ------------------------------------------------------------------------------------------------- context A
  const A = await newPage();
  await load(A.page);
  await A.page.evaluate(HELPERS);
  const st = await A.page.evaluate(async (pic) => {
    const g = window.__game, Hm = g.home, S = Hm.images;
    const IA = await import('/src/design/imageArt.js');
    await S.ready();
    const file = await window.__ic.testPicture();
    const img = await S.addFile(file);
    const rec = await window.__ic.idbGet(img.id);
    const spec = IA.choiceToSpec({ mode: 'image', long: 0.6, style: 'svart', mat: false, fit: 'cover' }, img);
    const uid = g.design.add({ ...spec, position: pic, attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] } });
    Hm.sync.flush();
    const name = Hm.saves.save('Bildetest');
    const ls = localStorage.getItem('interiorspillet.designs.v1') || '';
    return { id: img.id, uid, w: img.w, h: img.h, mime: img.mime, persisted: img.persisted, persistent: S.persistent, inIdb: !!rec && rec.bytes === img.bytes, name, lsHasId: ls.includes(img.id), lsHasData: ls.includes('data:image'), lsLen: ls.length, status: S.status(img.id) };
  }, PIC);
  picId = st.id;
  itemUid = st.uid;
  const storeOk = st.persisted && st.persistent && st.inIdb && st.name === 'Bildetest' && st.lsHasId && !st.lsHasData && st.w === 400 && st.h === 300;
  record('store', storeOk ? 'ok' : 'fail', st);

  const ex = await A.page.evaluate(() => window.__ic.exif()).catch((e) => ({ error: e.message }));
  record('exif', ex?.w === 200 && ex?.h === 300 ? 'ok' : 'fail', ex);

  // the dialog
  const dlg = await A.page.evaluate(async () => {
    const up = window.__game.editor.ui.imageUpload;
    const file = await window.__ic.secondPicture();
    window.__icDialog = up.open({ file });
    const t0 = Date.now();
    while (!document.querySelector('.ipu-pic') && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
    const q = (s) => document.querySelector(s);
    const text = (q('.kv-dialog')?.textContent || '').replace(/­/g, '');
    const pic = q('.ipu-pic');
    const before = q('.ipu-frame')?.style.background || '';
    return {
      open: !!q('.kv-dialog'),
      title: q('.kv-dialog__title')?.textContent || '',
      preview: !!pic && /url\("blob:/.test(pic.style.backgroundImage),
      texts: ['Plasser på veggen', 'Etter bildet', 'Standard rammestørrelse', 'Lengste side', 'Smal svart', 'Lerret i skyggefugeramme', 'Passepartout', 'Velg et annet bilde …', 'Avbryt', 'Bildet lagres i denne nettleseren'].filter((t) => !text.includes(t)),
      before,
    };
  });
  await A.page.waitForTimeout(400);
  await shot(A.page, 'dialog.png');
  const dlg2 = await A.page.evaluate(async () => {
    const q = (s) => document.querySelector(s);
    const eik = [...document.querySelectorAll('.ipu-style')].find((b) => b.textContent.includes('Eik'));
    eik?.click();
    await new Promise((r) => setTimeout(r, 150));
    const after = q('.ipu-frame')?.style.background || '';
    // «Standard rammestørrelse» → the frame chips
    [...document.querySelectorAll('.ipi-seg button')].find((b) => b.textContent === 'Standard rammestørrelse')?.click();
    await new Promise((r) => setTimeout(r, 150));
    const chips = [...document.querySelectorAll('.ipu-chip')].map((b) => b.textContent);
    const primary = [...document.querySelectorAll('.ipu-foot button')].find((b) => b.textContent.includes('Plasser på veggen'));
    primary?.click();
    const res = await window.__icDialog;
    const pl = window.__game.editor.placement;
    const placing = !!pl?.isActive && /^img-/.test(pl.spec?.params?.imageId || '');
    const frameStyle = pl.spec?.params?.frameStyle;
    const dims = pl.spec?.dims;
    pl?.cancel?.();
    return { after, chips, res, placing, frameStyle, dims };
  });
  const dialogOk = dlg.open && dlg.title === 'Eget bilde' && dlg.preview && !dlg.texts.length && dlg2.after !== dlg.before && dlg2.chips.some((c) => /50 × 70|70 × 50/.test(c)) && dlg2.res === 'placed' && dlg2.placing && dlg2.frameStyle === 'eik';
  record('dialog', dialogOk ? 'ok' : 'fail', { ...dlg, ...dlg2 });

  // the catalogue card
  const cat = await A.page.evaluate(async () => {
    const c = window.__game.editor.ui.catalog;
    c.open('kunst');
    const t0 = Date.now();
    while (!document.querySelector('.ipu-recent button') && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 100));
    const grid = document.querySelector('.ipc-grid');
    const first = grid?.firstElementChild;
    const searchCard = (() => { c.open({ query: 'eget bilde' }); return !!document.querySelector('.ipc-grid > .ipu-card'); })();
    c.open('kunst');
    await new Promise((r) => setTimeout(r, 300));
    return { first: first?.className || '', text: first?.textContent || '', recent: document.querySelectorAll('.ipu-recent button').length, searchCard };
  });
  await A.page.waitForTimeout(800);
  await shot(A.page, 'catalog-card.png');
  const catOk = /ipu-card/.test(cat.first) && cat.text.includes('Last opp eget bilde') && cat.text.includes('Velg bilde …') && cat.recent >= 1 && cat.searchCard;
  record('catalog', catOk ? 'ok' : 'fail', { first: cat.first, recent: cat.recent, searchCard: cat.searchCard });
  await A.page.evaluate(() => window.__game.editor.ui.catalog.close());

  // a catalogue product that takes a picture
  const pm = await A.page.evaluate(async () => {
    const e = window.__game.editor, up = e.ui.imageUpload, cat = e.catalog, ic = window.__ic;
    const p = cat.getProduct('akustikksenter-akustikkbilde-180x120');
    if (!p) return { error: 'no product' };
    e.ui.catalog.open({ category: p.category, productId: p.id });
    await ic.sleep(400);
    const action = [...(e.ui.catalog.foot?.querySelectorAll('button') || [])].some((b) => b.textContent.includes('Med eget bilde'));
    e.ui.catalog.close();
    const pr = up.open({ file: await ic.testPicture(), productSpec: cat.productToItemSpec(p, 0) });
    await ic.waitFor('.ipu-pic');
    const text = document.querySelector('.kv-dialog')?.textContent || '';
    [...document.querySelectorAll('.ipu-foot button')].find((b) => b.textContent.includes('Plasser på veggen'))?.click();
    const res = await pr;
    const pl = e.placement;
    const spec = pl.spec;
    pl.cancel?.();
    return { action, res, source: spec?.source, refId: spec?.refId, motif: spec?.params?.motif, hasId: /^img-/.test(spec?.params?.imageId || ''), noSize: !text.includes('Etter bildet'), store: text.includes('står i handlelisten') };
  });
  record('product', pm.action && pm.res === 'placed' && pm.source === 'catalog' && pm.refId === 'akustikksenter-akustikkbilde-180x120' && pm.motif === 'custom' && pm.hasId && pm.noSize && pm.store ? 'ok' : 'fail', pm);

  // drag and drop on the window
  const dr = await A.page.evaluate(async () => {
    const ic = window.__ic;
    const f = await ic.testPicture();
    const dt = new DataTransfer();
    dt.items.add(f);
    const over = new DragEvent('dragover', { dataTransfer: dt, clientX: 640, clientY: 300, bubbles: true, cancelable: true });
    window.dispatchEvent(over);
    const overlay = !!document.querySelector('.ipu-drop.is-on');
    const drop = new DragEvent('drop', { dataTransfer: dt, clientX: 640, clientY: 300, bubbles: true, cancelable: true });
    window.dispatchEvent(drop);
    const open = await ic.waitFor('.ipu-pic');
    const title = document.querySelector('.kv-dialog__title')?.textContent || '';
    [...document.querySelectorAll('.ipu-foot button')].find((b) => b.textContent === 'Avbryt')?.click();
    await ic.sleep(300);
    return { overlayShown: overlay, prevented: over.defaultPrevented && drop.defaultPrevented, open, title, overlayGone: !document.querySelector('.ipu-drop.is-on') };
  });
  record('drop', dr.overlayShown && dr.prevented && dr.open && /Eget bilde|Tilpass bildet/.test(dr.title) && dr.overlayGone ? 'ok' : 'fail', dr);

  // «Eksporter til fil» in the Design panel
  const ef = await A.page.evaluate(async () => {
    const e = window.__game.editor;
    let toast = null;
    const off = e.events.on('toast', (t) => {
      toast = t?.text || null;
    });
    await e.ui.saves.exportFile();
    off();
    return { toast, missing: e.saves.lastExportMissing.length };
  });
  record('export', /^Lastet ned interiorspillet-/.test(ef.toast || '') && ef.missing === 0 ? 'ok' : 'fail', ef);

  // ---- reload with the saved design
  await load(A.page, `${GAME}&design=Bildetest`);
  await A.page.evaluate(HELPERS);
  const rl = await A.page.evaluate(async (id) => {
    const g = window.__game, Hm = g.home, S = Hm.images;
    const it = g.design.list().find((i) => i.params?.imageId === id);
    const statusAtStart = S.status(id);
    const src = await S.request(id);
    const { hashBytes } = await import('/src/design/ImageStore.js');
    const bytes = S.bytesOf(id);
    await window.__ic.gates();
    const exportedText = Hm.saves.exportText();
    const ex = JSON.parse(exportedText).images || {};
    return { found: !!it, uid: it?.uid, statusAtStart, decoded: !!src, statusNow: S.status(id), hashOk: !!bytes && hashBytes(bytes) === id, exported: !!ex[id], exportedText, ls: localStorage.getItem('interiorspillet.designs.v1') };
  }, picId);
  exported = rl.exportedText;
  lsA = rl.ls;
  itemUid = rl.uid || itemUid;
  const reloadOk = rl.found && ['ready', 'loaded'].includes(rl.statusAtStart) && rl.decoded && rl.statusNow === 'ready' && rl.hashOk && rl.exported;
  record('reload', reloadOk ? 'ok' : 'fail', { found: rl.found, statusAtStart: rl.statusAtStart, decoded: rl.decoded, statusNow: rl.statusNow, hashOk: rl.hashOk, exported: rl.exported });

  // ---- the picture on the wall (P04's own-picture texture)
  const wall = await A.page.evaluate(async (uid) => {
    const builder = await window.__ic.artBuilder();
    await window.__ic.gates();
    const tex = window.__ic.printCanvas(uid);
    const scr = window.__ic.screen();
    return { builder, tex, scr, texOk: window.__ic.texOk(tex), scrOk: window.__ic.screenOk(scr) };
  }, itemUid);
  await posed(A.page);
  await shot(A.page, 'after-reload.png');
  if (wall.texOk && wall.scrOk) record('wall', 'ok', { tex: wall.tex, scr: wall.scr });
  else record('wall', wall.builder ? 'fail' : 'pending', { builder: wall.builder, texOk: wall.texOk, scrOk: wall.scrOk, tex: wall.tex, scr: wall.scr, note: wall.builder ? '' : 'models/artcustom.js (P04) not in the tree yet' });

  // ---- the Inspector
  const insp = await A.page.evaluate(async (uid) => {
    const e = window.__game.editor;
    e.select({ kind: 'item', uid });
    await new Promise((r) => setTimeout(r, 400));
    e.ui.inspector._render();
    const el = e.ui.inspector.body;
    const t = el?.textContent || '';
    return { bilde: t.includes('Bilde'), swap: t.includes('Bytt bilde …'), fit: t.includes('Tilpass størrelse og ramme …'), size: t.includes('Størrelse (lengste side)'), own: t.includes('Bilde du har lastet opp'), thumb: !!el?.querySelector('.ipu-ithumb img') };
  }, itemUid);
  await posed(A.page);
  await shot(A.page, 'inspector.png');
  record('inspector', insp.bilde && insp.swap && insp.fit && insp.size && insp.own && insp.thumb ? 'ok' : 'fail', insp);

  // ---- swap + undo
  const sw = await A.page.evaluate(async ({ uid, id }) => {
    const g = window.__game, up = g.editor.ui.imageUpload;
    const IA = await import('/src/design/imageArt.js');
    const img2 = await g.home.images.addFile(await window.__ic.secondPicture());
    const ok = up.apply(uid, IA.imagePatch(g.design.get(uid), img2), 'Bytt bilde');
    const after = g.design.get(uid).params.imageId;
    const aspect = g.design.get(uid).dims.w / g.design.get(uid).dims.h;
    g.design.undo();
    return { ok, swapped: after === img2.id, portrait: aspect < 1, back: g.design.get(uid).params.imageId === id };
  }, { uid: itemUid, id: picId });
  record('swap', sw.ok && sw.swapped && sw.portrait && sw.back ? 'ok' : 'fail', sw);

  // «Tilpass bildet»
  const ed = await A.page.evaluate(async (uid) => {
    const e = window.__game.editor, up = e.ui.imageUpload, d = e.design, ic = window.__ic;
    const pr = up.open({ uid });
    await ic.waitFor('.ipu-pic');
    const title = document.querySelector('.kv-dialog__title')?.textContent || '';
    [...document.querySelectorAll('.ipu-style')].find((b) => b.textContent.includes('Bred hvit'))?.click();
    await ic.sleep(150);
    const h0 = d.historySize;
    [...document.querySelectorAll('.ipu-foot button')].find((b) => b.textContent === 'Bruk')?.click();
    const res = await pr;
    const style = d.get(uid).params.frameStyle;
    const steps = d.historySize - h0;
    d.undo();
    return { title, res, style, steps, back: d.get(uid).params.frameStyle };
  }, itemUid);
  record('edit', ed.title === 'Tilpass bildet' && ed.res === 'applied' && ed.style === 'bred' && ed.steps === 1 && ed.back === 'svart' ? 'ok' : 'fail', ed);

  // today's painting → own picture → «Tilbakestill»
  const cv = await A.page.evaluate(async () => {
    const e = window.__game.editor, up = e.ui.imageUpload, d = e.design, ic = window.__ic;
    const o = d.get('ex-f-maleri');
    if (!o) return { error: 'no painting' };
    const ok = await up.swapImage('ex-f-maleri', await ic.secondPicture());
    const it = d.get('ex-f-maleri');
    const conv = { ok, source: it.source, refId: it.refId, name: it.name, motif: it.params.motif, sameDims: JSON.stringify(it.dims) === JSON.stringify(o.dims) };
    e.select({ kind: 'item', uid: 'ex-f-maleri' });
    await ic.sleep(300);
    e.ui.inspector._render();
    const resetBtn = [...e.ui.inspector.foot.querySelectorAll('button')].some((b) => b.textContent.includes('Tilbakestill'));
    e.ui.inspector.reset();
    const b = d.get('ex-f-maleri');
    e.select(null);
    return { ...conv, resetBtn, backSource: b.source, backName: b.name === o.name, backMotif: b.params.motif === o.params.motif, noPicture: !b.params.imageId };
  });
  record('convert', cv.ok && cv.source === 'custom' && cv.refId === 'custom-image' && /^Eget bilde – /.test(cv.name || '') && cv.motif === 'custom' && cv.sameDims && cv.resetBtn
    && cv.backSource === 'existing' && cv.backName && cv.backMotif && cv.noPicture ? 'ok' : 'fail', cv);

  // ---- shopping list
  const shop = await A.page.evaluate(async () => {
    const e = window.__game.editor;
    e.select(null);
    e.ui.shopping.open();
    await new Promise((r) => setTimeout(r, 500));
    const t = e.ui.shopping.body?.textContent || '';
    const txt = e.ui.shopping.text();
    return { section: t.includes('Egne bilder'), order: t.includes('bestill selv'), text: txt.includes('EGNE BILDER'), csv: e.ui.shopping.csv().includes('Egne bilder') };
  });
  await posed(A.page);
  await shot(A.page, 'shopping.png');
  record('shopping', shop.section && shop.order && shop.text && shop.csv ? 'ok' : 'fail', shop);
  record('console A', A.watch.errors === 0 ? 'ok' : 'fail', { errors: A.watch.errors });
  await A.ctx.close();

  // ------------------------------------------------------------------------------------------------- context B
  const B = await newPage();
  await load(B.page);
  const im = await B.page.evaluate(async ({ text, id }) => {
    const g = window.__game, Hm = g.home, S = Hm.images;
    const before = S.status(id);
    const name = Hm.saves.importText(text);
    const fl = await S.flush();
    const li = Hm.saves.lastImport;
    const r = await new Promise((res) => {
      const q = indexedDB.open('interiorspillet-images', 1);
      q.onsuccess = () => { const db = q.result; const t = db.transaction('images').objectStore('images').get(id); t.onsuccess = () => { res(!!t.result); db.close(); }; t.onerror = () => res(false); };
      q.onerror = () => res(false);
    });
    const ls = localStorage.getItem('interiorspillet.designs.v1') || '';
    return { before, name, ok: fl.ok, added: li?.added || [], inIdb: r, hasItem: g.design.list().some((i) => i.params?.imageId === id), lsData: ls.includes('data:image') };
  }, { text: exported, id: picId });
  let reloadB = null;
  if (im.name) {
    await load(B.page, `${GAME}&design=${encodeURIComponent(im.name)}`);
    reloadB = await B.page.evaluate(async (id) => {
      const S = window.__game.home.images;
      const src = await S.request(id);
      return { has: window.__game.design.list().some((i) => i.params?.imageId === id), decoded: !!src, status: S.status(id) };
    }, picId);
  }
  const importOk = im.before !== 'ready' && im.ok && im.added.includes(picId) && im.inIdb && im.hasItem && !im.lsData && reloadB?.has && reloadB?.decoded;
  record('import', importOk ? 'ok' : 'fail', { ...im, reloadB });
  record('console B', B.watch.errors === 0 ? 'ok' : 'fail', { errors: B.watch.errors });
  await B.ctx.close();

  // ------------------------------------------------------------------------------------------------- context C
  const C = await newPage(`(() => { try { if (!sessionStorage.getItem('ic-seeded')) { localStorage.setItem('interiorspillet.designs.v1', ${JSON.stringify(lsA || '')}); sessionStorage.setItem('ic-seeded', '1'); } } catch (e) {} })();`);
  await load(C.page, `${GAME}&design=Bildetest`);
  const ms = await C.page.evaluate(async ({ id }) => {
    const g = window.__game, S = g.home.images, e = g.editor;
    const it = g.design.list().find((i) => i.params?.imageId === id);
    await S.load([id]);
    const status = S.status(id);
    if (it) e.select({ kind: 'item', uid: it.uid });
    await new Promise((r) => setTimeout(r, 500));
    e.ui.inspector._render();
    const t = e.ui.inspector.body?.textContent || '';
    return { found: !!it, keepsId: it?.params?.imageId === id, status, swap: t.includes('Bytt bilde …'), warn: t.includes('finnes ikke i denne nettleseren') };
  }, { id: picId });
  await C.page.evaluate(HELPERS);
  await posed(C.page);
  await shot(C.page, 'missing.png');
  record('missing', ms.found && ms.keepsId && ms.status === 'missing' && ms.swap && ms.warn ? 'ok' : 'fail', ms);
  record('console C', C.watch.errors === 0 ? 'ok' : 'fail', { errors: C.watch.errors });
  await C.ctx.close();
} catch (err) {
  record('run', 'fail', { error: String(err?.stack || err).slice(0, 600) });
} finally {
  await close();
  release?.();
}

const failed = results.filter((r) => r.status === 'fail');
const pending = results.filter((r) => r.status === 'pending');
const summary = { ok: !failed.length, failed: failed.map((r) => r.name), pending: pending.map((r) => r.name), seconds: Math.round((Date.now() - t0) / 1000), outDir, results };
writeFileSync(join(outDir, 'result.json'), JSON.stringify(summary, null, 2));
console.log(`[imagecheck] ${failed.length ? 'FAILED' : 'DONE'} – ${results.length - failed.length - pending.length} ok, ${failed.length} failed, ${pending.length} pending (${summary.seconds} s) → ${outDir}`);
process.exit(failed.length ? 1 : 0);
