#!/usr/bin/env node
/**
 * The planbygger end to end in a real browser (headless Edge, playwright-core): the page as a customer uses it.
 *
 *   node tools/test-planbygger-browser.mjs [--port=5272] [--lock] [--keep] [--only=v1|generer] [--no-replay]
 *                                          [--replay=hook] [--no-pdf] [--houses[=hus1,hus7]] [--houses-ai=off|opptak]
 *                                          [--only=hus]   (only section 11)
 *
 * Starts its own Vite server (tools/planbygger-vite.config.mjs, port 5272 – the planbygger's ports are 5270–5279) and
 * a headless Edge (tools/lib/hus.mjs launchBrowser: the PID goes to .shots/planbygger/browser.pid, only that process is
 * ever stopped), then:
 *   1. «Prøv med eksempelplanen» → the scale step
 *   2. a click on the dimension line «12.21 m» (it snaps to its ends) + «12,21» + Enter → the detection
 *   3. checks the proposal (11 walls, 3 doors, 7 windows, 1 opening, 4 rooms)
 *   4. drags a wall with the mouse (the rooms change), Ctrl+Z (they are back)
 *   5. names a room with the Rom tool and its dialog
 *   6. «Gå rundt i 3D»: the game's validator has 0 errors, the house is built; a screenshot to .shots/planbygger/
 *   7. walks (W for a second: the player moves) and opens a door
 *   8. uploads the plan turned 2.5° (a crooked scan) through the file field: the skew is found and the plan straightened,
 *      and the same scale click gives the same proposal
 *   9. «Generer» (round 1): hus3's three files (1etg.png, 2etg.png, fasader.png) dropped on the start page → the
 *      drawing stack (2. etasje on top, the facade sheet beside; a floor dragged up and back) → «Generer» → every guide
 *      card answered with «Neste» → the 3D house: two levels, 0 errors in the validator, the player walks; «Finjuster»
 *      opens the editor on it. The AI is OFF: this test's server answers /api/planbygger/ai itself (status
 *      available: false, every read 503) before the planbygger plugin's handler, and ANTHROPIC_API_KEY is removed from
 *      the server's environment – no request can reach Claude
 *  10. the same with the recorded AI answers (tools/fixtures/planbygger-ai/hus3) replayed BY THIS TEST'S SERVER (aiRoute
 *      below): the page's own client runs as with the real server – ai.js aiStatus, aiRead (downscaleImage, the PNG,
 *      the POST, tidyResponse of the reply) – and the route answers from the recordings in the response shape of
 *      server/planbygger-ai/index.mjs. Still no call to Claude; fewer questions, the rooms named, the scale within 2 %.
 *      --replay=hook replays through the page's test hook window.__planbyggerAiOverride instead (the old way, kept as
 *      a fallback: it goes around ai.js)
 *  12. a PDF with several pages (made here from hus9's two scans): the pages are read lazily (a thumbnail and an analysis
 *      at 2000 px, no full page before «Generer»), «Generer» renders only the pages it uses and lets them go again,
 *      the 3D house has both floors; a PDF of 45 pages keeps 40 and says so; «Bare én plan» renders page 1 only.
 *      --no-pdf skips it (pdf.js comes from the CDN)
 * --lock takes the shared GPU lock of the house work (notes/hele-huset-design.md §0), --keep leaves the server running,
 * --only=v1 / --only=generer runs only sections 1–8 / 9–12, --no-replay skips 10. --houses (or --houses=hus1,hus7) adds
 * 11: «Generer» on the test set's original files (AVIF, JPG, PDF), «Hopp over resten», once without AI and once with
 * the recordings replayed by the server (--houses-ai=off|opptak: only one). Per house and mode: the levels of the
 * fasit, walls and rooms on every level (an empty house fails), validator errors within the ceiling below (with the
 * recordings: test-planbygger-generate.mjs's THRESHOLDS; without AI: what tools/planbygger-measure-all.mjs measures in
 * Node), and a PDF page rendered as the same image the Node tests read (plantegninger/_png). The numbers go to
 * .shots/planbygger/generer-hus.json. Exit code 1 when a check fails.
 */
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, imp, check, section, done } from './planbygger-lib.mjs';
import { readPng, writePng, decodePng } from './planbygger-png.mjs';
import { launchBrowser, watchPage, acquireGpuLock, parseArgs } from './lib/hus.mjs';

const { opt } = parseArgs();
const port = Number(opt.port ?? 5272);
const outDir = path.join(ROOT, '.shots', 'planbygger');
fs.mkdirSync(outDir, { recursive: true });
if (!opt.only || opt.only === 'generer') {
  // before the browser (and the GPU lock): the upload's EXIF reader, the stack's first order, the worker's plain data
  section('0. Opplastingen og arbeideren, uten nettleser');
  const St = await imp('src/planbygger/stack.js');
  const Wk = await imp('src/planbygger/worker.js');
  // a minimal JPEG: SOI, APP1 «Exif» with IFD0 → Exif IFD → FocalLengthIn35mmFilm = 26, EOI
  const tiff = Buffer.alloc(44);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0xa405, 28);
  tiff.writeUInt16LE(3, 30);
  tiff.writeUInt32LE(1, 32);
  tiff.writeUInt16LE(26, 36);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1.length + 2);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]);
  const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  const f35 = St.exifFocal35(ab(jpeg));
  const png = fs.readFileSync(path.join(ROOT, 'plantegninger', 'hus3', '2etg.png'));
  check('EXIF: brennvidden (35 mm) leses fra en JPEG, ingen fra en PNG', f35 === 26 && St.exifFocal35(ab(png)) === null && St.exifFocal35(ab(jpeg.subarray(0, 20))) === null, `${f35}`);
  const lv = (n) => St.nameLevel(n);
  check('stabelens første rekkefølge fra filnavnene', lv('2etg.png').key === 1 && lv('1etg.png').key === 0 && lv('kjeller.jpg').key === -1 && lv('underetasje-alternativ.jpg').key === -1 && lv('plantegning-1.jpg').key == null && /filnavnet/.test(lv('2etg.png').why), ['2etg.png', '1etg.png', 'kjeller.jpg', 'ovre-etasje.jpg', 'plantegning-1.jpg'].map((n) => `${n}: ${lv(n).key}`).join(', '));
  const det = Wk.runExec('detectPlan', [readPng(path.join(ROOT, 'plantegninger', 'hus3', '2etg.png')), { pxPerM: 47.8, clean: true }]);
  let cloned = null;
  try {
    cloned = structuredClone(det);
  } catch {
    cloned = null;
  }
  check('arbeideren sender vegger, åpninger, takvinduer, trapper og skiller som rene data', !!cloned && ['walls', 'openings', 'skylights', 'stairs', 'separators', 'stats'].every((k) => k in cloned) && !('debug' in cloned) && cloned.walls.length > 5 && cloned.stairs.length >= 1, cloned ? `${cloned.walls.length} vegger, ${cloned.openings.length} åpninger (${cloned.openings.filter((o) => o.variant === 'sliding').length} skyvedører), ${cloned.stairs.length} trapp` : 'kunne ikke klones');
  check('arbeideren kjenner stegene generate.js sender', ['rectifyPhoto', 'splitSheet', 'cleanForWalls', 'detectPlan', 'autoScale', 'readFacade', 'findStairs'].every((n) => Wk.EXEC_NAMES.includes(n)), Wk.EXEC_NAMES.join(', '));
}

const release = opt.lock ? await acquireGpuLock({ label: 'planbygger-browser' }) : () => {};

process.env.PLANBYGGER_PORT = String(port);
// never a real AI call from this test: no key in the server's environment, and the AI route is answered here (aiRoute)
delete process.env.ANTHROPIC_API_KEY;

/**
 * The AI route of this test's server, first in the middleware stack, ahead of tools/planbygger-vite-plugin.mjs's real
 * handler: it answers every /api/planbygger/ai request itself and never passes one on.
 *   off     the status says available: false, every read is 503 – a server without a key
 *   replay  the recordings of aiRoute.house (tools/fixtures/planbygger-ai/<house>), in the response shape of
 *           server/planbygger-ai/index.mjs, so the page's own client runs unchanged (ai.js aiStatus, aiRead:
 *           downscaleImage, the PNG, the POST, tidyResponse). A read takes the recording of its task and file
 *           (hints.fileName) whose image is the very image posted (sha256 of the decoded pixels, as the recordings store
 *           it: 'exact'); else one of the same size – with the same marks its answer as it is ('marks'), with other marks
 *           tidied with its own marks and unlinked, so the page links it by position like tools/planbygger-ai-fixtures.mjs
 *           does for a stale recording ('position'); else 503 ('none'). The server's model per task is tried first.
 */
const aiRoute = { mode: 'off', house: null };
const aiHits = { status: 0, post: 0, log: [] };
let FX = null; // tools/planbygger-ai-fixtures.mjs, loaded for the first replay
let AIc = null; // src/planbygger/ai.js in Node (tidyResponse for a stale recording)
const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/[^a-z0-9]/g, '');
const sameMarks = (a = [], b = []) => a.length === b.length && a.every((m, i) => b[i] && String(m.id) === String(b[i].id) && m.kind === b[i].kind && Math.abs(m.at[0] - b[i].at[0]) <= 0.002 && Math.abs(m.at[1] - b[i].at[1]) <= 0.002);
async function replayRead(body) {
  FX ??= await import(pathToFileURL(path.join(ROOT, 'tools', 'planbygger-ai-fixtures.mjs')).href);
  AIc ??= await imp('src/planbygger/ai.js');
  const { task } = body;
  const file = body.hints?.fileName ?? null;
  const entry = { house: aiRoute.house, task, file, outcome: 'none', fixture: null };
  aiHits.log.push(entry);
  const dir = path.join(FX.FIXTURES, aiRoute.house ?? '');
  if (!file || !fs.existsSync(dir)) return null;
  const img = decodePng(Buffer.from(body.image?.data ?? '', 'base64'));
  const sha = crypto.createHash('sha256').update(img.data).digest('hex');
  const stem = path.basename(file, path.extname(file)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${stem}(\\.d\\d+)?\\.${task}\\.(.+)\\.json$`);
  const want = FX.modelsByTask(null)[task];
  const found = fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => ({ f, fx: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) })).sort((a, b) => (b.fx.model === want) - (a.fx.model === want));
  let hit = found.find((c) => c.fx.image?.sha256 === sha && c.fx.promptVersion === FX.PROMPT_VERSION);
  let response = hit?.fx.response;
  if (hit) entry.outcome = 'exact';
  else {
    hit = found.find((c) => c.fx.image?.width === img.width && c.fx.image?.height === img.height);
    if (!hit) return null;
    if (task !== 'readPlan' || !hit.fx.marks?.length || sameMarks(hit.fx.marks, body.marks)) {
      entry.outcome = 'marks';
      response = hit.fx.response;
    } else {
      entry.outcome = 'position';
      const t = AIc.tidyResponse('readPlan', hit.fx.response, hit.fx.marks ?? [], hit.fx.unmarked ?? []);
      response = { ...t, rooms: t.rooms.map((r) => ({ ...r, mark: null })), openings: t.openings.map((o) => ({ ...o, mark: null })) };
    }
  }
  entry.fixture = hit.f;
  return { ok: true, status: 200, task, model: hit.fx.model, servedModel: hit.fx.servedModel ?? hit.fx.model, promptVersion: hit.fx.promptVersion, response, usage: null, cost: 0, cached: true, remaining: 999, ms: 0, stopReason: 'end_turn' };
}
const aiTest = {
  name: 'planbygger-test-ai',
  configureServer(server) {
    server.middlewares.stack.unshift({
      route: '',
      handle: (req, res, next) => {
        const p = (req.url ?? '').split('?')[0];
        if (!p.startsWith('/api/planbygger/ai')) return next();
        const send = (code, body) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        const status = p.replace(/\/+$/, '').endsWith('/status');
        if (status) {
          aiHits.status++;
          if (aiRoute.mode !== 'replay') return send(200, { available: false, model: null, remaining: 0, reason: 'test' });
          return import(pathToFileURL(path.join(ROOT, 'tools', 'planbygger-ai-fixtures.mjs')).href).then((m) => {
            const models = m.modelsByTask(null);
            send(200, { available: true, model: models.readPlan, models, remaining: 999, promptVersion: m.PROMPT_VERSION, replay: true });
          });
        }
        aiHits.post++;
        if (aiRoute.mode !== 'replay') return send(503, { ok: false, error: 'off', message: 'KI er slått av i testen.' });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', async () => {
          let reply = null;
          try {
            reply = await replayRead(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            console.log(`  (avspillingen feilet: ${err?.message ?? err})`);
          }
          if (reply) send(200, reply);
          else send(503, { ok: false, error: 'no_recording', message: 'Ingen opptak for denne tegningen.' });
        });
      },
    });
  },
};
const server = await createServer({ configFile: path.join(ROOT, 'tools', 'planbygger-vite.config.mjs'), server: { port, strictPort: true }, logLevel: 'warn', plugins: [aiTest] });
await server.listen();
const base = `http://127.0.0.1:${port}`;
const { browser, close } = await launchBrowser({ pidfile: path.join(outDir, 'browser.pid') });
let failed = false;
try {
  if (!opt.only || opt.only === 'v1') {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const watch = watchPage(page, { quiet: true });
    await page.goto(`${base}/planbygger.html`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/planbygger.html`);
    await page.waitForFunction(() => !!window.__planbygger, null, { timeout: 60000 });

    section('1–2. Last opp og skala');
    await page.getByText('Prøv med eksempelplanen').click();
    // the image is read, its skew estimated in the worker, and then the scale step begins
    await page.waitForFunction(() => window.__planbygger.level?.image?.width > 0 && window.__planbygger.tool === 'scale', null, { timeout: 30000 });
    check('planen er lastet og skala-steget er aktivt', await page.evaluate(() => window.__planbygger.tool === 'scale'));
    // where the dimension line «12.21 m» (image px 541, 300) is on the screen
    const click = await page.evaluate(() => {
      const ed = window.__planbygger.editor;
      const r = ed.canvas.getBoundingClientRect();
      const s = ed.toScreen([541 / ed.ppm, 300 / ed.ppm]);
      return [r.left + s[0], r.top + s[1]];
    });
    await page.mouse.click(click[0], click[1]);
    const snapped = await page.evaluate(() => window.__planbygger.editor.scaleLine);
    check('klikket festes til målelinjas ender (628 px)', snapped?.b && Math.abs(Math.hypot(snapped.b[0] - snapped.a[0], snapped.b[1] - snapped.a[1]) - 628) < 2, JSON.stringify(snapped));
    await page.locator('.pb-scalebox input').fill('12,21');
    await page.locator('.pb-scalebox input').press('Enter');
    await page.waitForFunction(() => window.__planbygger.level.walls.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(300);

    section('3. Forslaget');
    const prop = await page.evaluate(() => {
      const a = window.__planbygger;
      const L = a.level;
      const c = (t) => L.openings.filter((o) => o.type === t).length;
      return { ppm: L.image.pxPerM, walls: L.walls.length, doors: c('door'), windows: c('window'), openings: c('opening'), rooms: a.editor.rooms.rooms.map((r) => [r.name, +r.region.area.toFixed(2)]) };
    });
    check('skala 51,4 px/m', Math.abs(prop.ppm - 51.43) < 0.05, prop.ppm.toFixed(2));
    check('11 vegger, 3 dører, 7 vinduer, 1 åpning', prop.walls === 11 && prop.doors === 3 && prop.windows === 7 && prop.openings === 1, JSON.stringify(prop));
    check('4 rom med foreslått navn', prop.rooms.length === 4, JSON.stringify(prop.rooms));

    section('4. Flytt en vegg med musa, angre');
    const wallDrag = await page.evaluate(() => {
      const a = window.__planbygger;
      const ed = a.editor;
      const r = ed.canvas.getBoundingClientRect();
      // the inner wall between the hall/bedroom and the living room: the vertical wall with the opening
      const w = a.level.walls.find((x) => Math.abs(x.a[0] - x.b[0]) < 1e-6 && a.level.openings.some((o) => o.wall === x.id && o.type === 'opening'));
      const m = [w.a[0], (w.a[1] + w.b[1]) / 2 + 0.8];
      const s = ed.toScreen(m);
      return { id: w.id, x: r.left + s[0], y: r.top + s[1], k: ed.view.k, area: a.editor.rooms.rooms.find((x) => x.kind === 'living').region.area };
    });
    await page.mouse.move(wallDrag.x, wallDrag.y);
    await page.mouse.down();
    await page.mouse.move(wallDrag.x + 10, wallDrag.y, { steps: 5 });
    await page.mouse.move(wallDrag.x + 0.3 * wallDrag.k, wallDrag.y, { steps: 5 });
    await page.mouse.up();
    const after = await page.evaluate((id) => {
      const a = window.__planbygger;
      return { x: a.level.walls.find((w) => w.id === id).a[0], area: a.editor.rooms.rooms.find((x) => x.kind === 'living').region.area };
    }, wallDrag.id);
    check('veggen flyttet 0,3 m, stua ble mindre', Math.abs(after.area - (wallDrag.area - 0.3 * 6.05)) < 0.4, `${wallDrag.area.toFixed(2)} → ${after.area.toFixed(2)} m²`);
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(() => window.__planbygger.editor.rooms.rooms.find((x) => x.kind === 'living').region.area);
    check('Ctrl+Z gir stua tilbake', Math.abs(undone - wallDrag.area) < 1e-6, `${undone.toFixed(2)} m²`);

    section('5. Navngi et rom');
    await page.keyboard.press('r');
    const roomAt = await page.evaluate(() => {
      const a = window.__planbygger;
      const ed = a.editor;
      const r = ed.canvas.getBoundingClientRect();
      const bath = ed.rooms.rooms.find((x) => x.kind === 'bathroom');
      const s = ed.toScreen(bath.region.inside);
      return [r.left + s[0], r.top + s[1]];
    });
    await page.mouse.click(roomAt[0], roomAt[1]);
    await page.locator('.pb-dialog input').first().waitFor({ timeout: 5000 });
    await page.locator('.pb-dialog input').first().fill('Baderom');
    await page.locator('.pb-dialog .pb-btn.is-primary').click();
    const named = await page.evaluate(() => window.__planbygger.editor.rooms.rooms.map((r) => r.name));
    check('rommet heter «Baderom»', named.includes('Baderom'), named.join(', '));

    section('6. 3D');
    await page.getByRole('button', { name: 'Gå rundt i 3D' }).click();
    await page.waitForFunction(() => window.__planbygger.viewer?.state?.layout, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const v3 = await page.evaluate(() => {
      const a = window.__planbygger;
      const st = a.viewer.state;
      return { errors: a._lastCheck.errors, rooms: st.layout.house.rooms.filter((r) => r.area > 0.01 && r.id !== 'stue-kjokken').length, doors: st.parts[0].doors.length, windows: st.parts[0].windows.length, colliders: st.parts.reduce((n, p) => n + (p.colliders || []).length, 0) };
    });
    check('validatoren: 0 feil', v3.errors.length === 0, v3.errors.slice(0, 3).join(' | '));
    check('3D: 4 rom, 3 dører, 7 vinduer, kollisjon', v3.rooms === 4 && v3.doors === 3 && v3.windows === 7 && v3.colliders > 0, JSON.stringify(v3));
    await page.screenshot({ path: path.join(outDir, '3d-dukkehus.png') });

    section('7. Gå rundt og åpne en dør');
    await page.getByRole('button', { name: 'Gå inn i huset' }).click();
    await page.waitForTimeout(500);
    const p0 = await page.evaluate(() => window.__planbygger.viewer.state.player.position.toArray());
    await page.mouse.move(720, 450);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
    const p1 = await page.evaluate(() => window.__planbygger.viewer.state.player.position.toArray());
    const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    check('W flytter spilleren', moved > 0.8, `${moved.toFixed(2)} m`);
    await page.screenshot({ path: path.join(outDir, '3d-inne.png') });
    const door = await page.evaluate(async () => {
      const v = window.__planbygger.viewer;
      const st = v.state;
      const d = st.layout.house.doors[0];
      const o = d.basis.origin;
      const n = d.basis.zAxis;
      const p = o.clone().addScaledVector(n, 1.3);
      p.y = d.floorY;
      st.player.teleport(p, Math.atan2(n.x, n.z), -0.1);
      await new Promise((r) => setTimeout(r, 300));
      st.interaction.update(null, null, true);
      const ok = st.interaction.interact({});
      await new Promise((r) => setTimeout(r, 1500));
      const built = st.parts[0].doors.find((x) => x.id === d.id || x.openingId === d.id) ?? st.parts[0].doors[0];
      return { ok, open: !!built.door?.isOpen, id: d.id };
    });
    check('E på en dør åpner den', door.ok && door.open, JSON.stringify(door));
    await page.screenshot({ path: path.join(outDir, '3d-dor.png') });

    section('8. En skjev plan rettes opp');
    const I = await imp('src/planbygger/image.js');
    const crooked = path.join(outDir, 'skjev-plan.png');
    writePng(crooked, I.rotateImage(readPng(path.join(ROOT, 'plantegning.png')), 2.5));
    await page.evaluate(() => window.__planbygger.close3d());
    await page.locator('input.pb-file-one').setInputFiles(crooked);
    await page.waitForFunction(() => window.__planbygger.level?.image?.name === 'skjev-plan.png' && window.__planbygger.tool === 'scale', null, { timeout: 30000 });
    const rot = await page.evaluate(() => window.__planbygger.level.image.rotation);
    check('vinkelen finnes ved opplastingen (2,5° ± 0,1°)', Math.abs(rot - 2.5) <= 0.1, `${rot}°`);
    const click2 = await page.evaluate(() => {
      const ed = window.__planbygger.editor;
      ed.fit();
      const r = ed.canvas.getBoundingClientRect();
      const s = ed.toScreen([541 / ed.ppm, 300 / ed.ppm]);
      return [r.left + s[0], r.top + s[1]];
    });
    await page.mouse.click(click2[0], click2[1]);
    await page.locator('.pb-scalebox input').fill('12,21');
    await page.locator('.pb-scalebox input').press('Enter');
    await page.waitForFunction(() => window.__planbygger.level.walls.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    const prop2 = await page.evaluate(() => {
      const L = window.__planbygger.level;
      const c = (t) => L.openings.filter((o) => o.type === t).length;
      const skew = L.walls.filter((w) => Math.abs(w.a[0] - w.b[0]) > 0.005 && Math.abs(w.a[1] - w.b[1]) > 0.005).length;
      return { ppm: L.image.pxPerM, walls: L.walls.length, doors: c('door'), windows: c('window'), openings: c('opening'), skew };
    });
    check('den opprettede planen: 11 rette vegger, 3 dører, 7 vinduer, 1 åpning (skala 51,4 ± 0,3)', prop2.walls === 11 && prop2.skew === 0 && prop2.doors === 3 && prop2.windows === 7 && prop2.openings === 1 && Math.abs(prop2.ppm - 51.43) < 0.3, JSON.stringify(prop2));
    await page.screenshot({ path: path.join(outDir, 'skjev-rettet.png') });
    check('ingen feil i nettleserkonsollen', watch.errors === 0, `${watch.errors} feil`);
    await context.close();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // «Generer»: hus3's three files dropped on the start page, every guide card answered with «Neste», the 3D house

  const HUS3 = ['1etg.png', '2etg.png', 'fasader.png'].map((f) => path.join(ROOT, 'plantegninger', 'hus3', f));

  /** Drops files on an element as a customer would (a DataTransfer with File objects, the drop event). */
  async function dropFiles(page, selector, files) {
    const payload = files.map((f) => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64'), type: 'image/png' }));
    const dt = await page.evaluateHandle((list) => {
      const dt = new DataTransfer();
      for (const f of list) {
        const bin = atob(f.b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        dt.items.add(new File([u], f.name, { type: f.type }));
      }
      return dt;
    }, payload);
    await page.dispatchEvent(selector, 'dragenter', { dataTransfer: dt });
    await page.dispatchEvent(selector, 'drop', { dataTransfer: dt });
  }

  /** The floors in the stack, top first, and the other cards: [[name, kind], …]. */
  const stackState = (page) => page.evaluate(() => {
    const s = window.__planbygger.stack;
    // the reason as the card shows it: the level badge and the reason
    const why = [...document.querySelectorAll('.pb-stack-list.is-floors .pb-card')].map((c) => [...(c.querySelector('.pb-card-why')?.childNodes ?? [])].map((n) => n.textContent.trim()).join(' '));
    return { floors: s.floors.map((x) => x.name), kinds: s.items.map((x) => [x.name, x.kind]), why, ready: s.items.length > 0 && s.items.every((x) => !x.loading && !x.analysing), userOrdered: s.userOrdered };
  });

  /**
   * Per fasit level: the rooms named as on the drawing (each label once, by name) and the scale error from their areas:
   * the median of generated / labelled area → sqrt − 1, as tools/planbygger-measure-all.mjs measures it.
   * levelFiles: [[level id, file]], rooms: [[level id, name, area]] (the 3D house's rooms)
   */
  function roomScale(house, levelFiles, rooms) {
    const fasit = JSON.parse(fs.readFileSync(path.join(ROOT, 'plantegninger', house, 'fasit.json'), 'utf8'));
    const median = (a) => {
      const v = [...a].sort((x, y) => x - y);
      return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
    };
    return fasit.levels.filter((l) => !fasit.files?.[l.file]?.alternativeOf).map((fl) => {
      const id = levelFiles.find((x) => x[1] === fl.file)?.[0];
      const gen = rooms.filter((r) => r[0] === id);
      const used = new Set();
      const ratios = [];
      let named = 0;
      for (const r of fl.rooms ?? []) {
        const k = gen.findIndex((g, i) => !used.has(i) && fold(g[1]) === fold(r.label));
        if (k < 0) continue;
        used.add(k);
        named++;
        if (r.area > 0 && gen[k][2] > 0) ratios.push(gen[k][2] / r.area);
      }
      const m = median(ratios);
      return { file: fl.file, named, of: (fl.rooms ?? []).length, err: m == null ? null : Math.sqrt(m) - 1 };
    });
  }

  /**
   * One «Generer» run on hus3 in a fresh context. replay: the recorded AI answers (tools/fixtures/planbygger-ai/hus3),
   * served by this test's AI route (aiRoute: the page's own ai.js client, never the network), or with --replay=hook
   * through the page's override hook; otherwise the AI is off (the route says so).
   */
  async function generateHus3({ label, replay }) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const watch = watchPage(page, { quiet: true });
    let replayer = null;
    const hook = replay && opt.replay === 'hook';
    if (hook) {
      const { fixtureAi } = await import(pathToFileURL(path.join(ROOT, 'tools', 'planbygger-ai-fixtures.mjs')).href);
      replayer = fixtureAi({ house: 'hus3' });
      await page.exposeFunction('__pbReplay', (task, p) => replayer.read(task, p));
      await page.addInitScript(() => {
        window.__planbyggerAiOverride = (task, p) => window.__pbReplay(task, p);
      });
    }
    Object.assign(aiRoute, replay && !hook ? { mode: 'replay', house: 'hus3' } : { mode: 'off', house: null });
    const tag = replay ? 'opptak' : 'uten-ki';
    const aiBefore = { status: aiHits.status, post: aiHits.post, log: aiHits.log.length };
    await page.goto(`${base}/planbygger.html`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/planbygger.html`);
    await page.waitForFunction(() => !!window.__planbygger, null, { timeout: 60000 });
    await page.locator('.pb-drop').waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(outDir, `generer-start.png`) });

    await dropFiles(page, '.pb-drop', HUS3);
    await page.waitForFunction(() => {
      const s = window.__planbygger.stack;
      return s && s.items.length === 3 && s.items.every((x) => !x.loading && !x.analysing);
    }, null, { timeout: 60000 });
    const st = await stackState(page);
    check(`${label}: stabelen har 2. etasje øverst, 1. etasje under og fasadearket ved siden av`, JSON.stringify(st.floors) === JSON.stringify(['2etg.png', '1etg.png']) && st.kinds.find((k) => k[0] === 'fasader.png')?.[1] === 'facade', JSON.stringify(st));
    check(`${label}: etasjen og grunnen til rekkefølgen står på kortene`, st.why[0] === '2. etasje fra filnavnet' && st.why[1] === '1. etasje fra filnavnet', st.why.join(' | '));
    if (!replay) {
      // drag 1. etasje above 2. etasje by its grip, then back: the order follows the pointer
      const drag = async (name, to) => {
        const g = page.locator(`.pb-card[data-name="${name}"] .pb-card-grip`);
        const t = page.locator(`.pb-card[data-name="${to}"]`);
        const a = await g.boundingBox();
        const b = await t.boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + (b.y < a.y ? -12 : 12), { steps: 3 });
        await page.mouse.move(a.x + a.width / 2, b.y + (b.y < a.y ? 6 : b.height - 6), { steps: 8 });
        await page.mouse.up();
      };
      await drag('1etg.png', '2etg.png');
      const st1 = await stackState(page);
      await page.screenshot({ path: path.join(outDir, 'generer-stabel-dratt.png') });
      await drag('1etg.png', '2etg.png');
      const st2 = await stackState(page);
      check(`${label}: dra et kort flytter etasjen (og tilbake igjen)`, JSON.stringify(st1.floors) === JSON.stringify(['1etg.png', '2etg.png']) && st1.userOrdered && st1.why[0] === '2. etasje plassert av deg' && JSON.stringify(st2.floors) === JSON.stringify(['2etg.png', '1etg.png']) && st2.why[1] === '1. etasje plassert av deg', `${st1.floors.join(',')} (${st1.why.join(' | ')}) → ${st2.floors.join(',')}`);
    }
    await page.screenshot({ path: path.join(outDir, `generer-stabel-${tag}.png`) });

    const t0 = Date.now();
    await page.locator('.pb-generate').click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(outDir, `generer-fremdrift-${tag}.png`) });
    await page.waitForFunction(() => window.__planbygger.guide || !window.__planbygger.view3d.hidden, null, { timeout: 240000, polling: 500 });
    const genMs = Date.now() - t0;
    const asked = await page.evaluate(() => window.__planbyggerLastGenerate);
    // every card: «Neste» (the filled-in answers)
    let cards = 0;
    const kinds = [];
    for (let i = 0; i < 60; i++) {
      const open = await page.evaluate(() => !!window.__planbygger.guide && !window.__planbygger.guide.finished);
      if (!open) break;
      const q = await page.evaluate(() => {
        const g = window.__planbygger.guide;
        return { id: g.question?.id, kind: g.question?.kind, crop: !!document.querySelector('.pb-guide-canvas') };
      });
      kinds.push(`${q.kind}${q.crop ? '' : '(uten utsnitt)'}`);
      if (cards === 0 || q.kind !== kinds[kinds.length - 2]?.replace(/\(.*$/, '')) await page.screenshot({ path: path.join(outDir, `generer-kort-${tag}-${cards + 1}-${q.kind}.png`) });
      await page.locator('.pb-guide-next').click();
      cards++;
      await page.waitForTimeout(80);
    }
    check(`${label}: veiviseren viste ${cards} kort og hvert kort hadde et utsnitt`, cards === asked.questions.length && kinds.every((k) => !k.includes('uten')), `${cards} kort: ${kinds.join(', ')}; «Generer» ${(genMs / 1000).toFixed(1)} s`);
    await page.waitForFunction(() => window.__planbygger.viewer?.state?.layout && !window.__planbygger.view3d.hidden, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const v3 = await page.evaluate(() => {
      const a = window.__planbygger;
      const st = a.viewer.state;
      const H = st.layout.house;
      return {
        levels: H.levels.map((l) => [l.id, l.floorY]),
        errors: a._lastCheck?.errors ?? null,
        warnings: a._lastCheck?.warnings?.length ?? null,
        rooms: H.rooms.filter((r) => r.area > 0.01 && r.id !== 'stue-kjokken').map((r) => [r.levelId, r.name, r.area]),
        levelFiles: a.doc.levels.map((l) => [l.id, l.image?.name ?? null]),
        override: typeof window.__planbyggerAiOverride === 'function',
        stairs: H.stairs?.length ?? 0,
        doors: st.parts.reduce((n, p) => n + (p.doors?.length ?? 0), 0),
        colliders: st.parts.reduce((n, p) => n + (p.colliders || []).length, 0),
        finetune: document.querySelector('.pb-finetune')?.textContent ?? null,
        generated: a.doc.generated?.guide ?? null,
      };
    });
    check(`${label}: 3D-huset har to etasjer`, v3.levels.length === 2, JSON.stringify(v3.levels));
    check(`${label}: validatoren: 0 feil`, Array.isArray(v3.errors) && v3.errors.length === 0, `${(v3.errors || []).slice(0, 3).join(' | ')} (${v3.warnings} adv.)`);
    // the rooms named as on the drawing, and the scale from their areas (round 1's goal on hus3: within 2 %)
    const rs = roomScale('hus3', v3.levelFiles, v3.rooms);
    const rsText = rs.map((r) => `${r.file}: ${r.named} av ${r.of} rom med navnet fra tegningen, skala ${r.err == null ? '–' : `${(r.err * 100).toFixed(1)} %`}`).join('; ');
    if (replay) check(`${label}: rommene får navnene fra tegningen, og skalaen er innen 2 % i begge etasjer`, rs.length === 2 && rs.every((r) => r.named >= (r.file === '1etg.png' ? 2 : 4) && r.err != null && Math.abs(r.err) <= 0.02), rsText);
    else console.log(`  (uten KI: ${rsText})`);
    await page.screenshot({ path: path.join(outDir, `generer-3d-${tag}.png`) });
    await page.getByRole('button', { name: 'Gå inn i huset' }).click();
    await page.waitForTimeout(500);
    const p0 = await page.evaluate(() => window.__planbygger.viewer.state.player.position.toArray());
    await page.mouse.move(720, 450);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
    const p1 = await page.evaluate(() => window.__planbygger.viewer.state.player.position.toArray());
    const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    check(`${label}: spilleren går (W)`, moved > 0.8 && v3.colliders > 0, `${moved.toFixed(2)} m, ${v3.colliders} kolliderere, ${v3.rooms.length} rom, ${v3.doors} dører, ${v3.stairs} trapp`);
    await page.screenshot({ path: path.join(outDir, `generer-inne-${tag}.png`) });
    // «Finjuster»: the editor on the generated document
    await page.getByRole('button', { name: 'Se huset ovenfra' }).click();
    await page.locator('.pb-finetune').click();
    await page.waitForTimeout(600);
    const ed = await page.evaluate(() => {
      const a = window.__planbygger;
      return { hidden3d: a.view3d.hidden, levels: a.doc.levels.map((l) => [l.name, l.walls.length, l.openings.length]), rooms: a.editor.rooms?.rooms.map((r) => r.name) ?? [], image: !!a.image };
    });
    check(`${label}: «Finjuster» åpner editoren på det genererte huset`, v3.finetune === 'Finjuster' && ed.hidden3d && ed.image && ed.levels.every((l) => l[1] > 0) && ed.rooms.length > 0, JSON.stringify(ed));
    await page.screenshot({ path: path.join(outDir, `generer-finjuster-${tag}.png`) });
    if (!replay) {
      // the editor on 2. etasje: a sliding door is drawn without an arc, its panel has no opening angle and no hinge;
      // the type menu (model.js OPENING_KINDS / setOpeningKind) makes it a double door, Ctrl+Z back
      await page.locator('.pb-tabs button', { hasText: '2. etasje' }).click();
      await page.waitForTimeout(300);
      const at = await page.evaluate(() => {
        const a = window.__planbygger;
        const L = a.level;
        const o = L.openings.find((x) => x.type === 'door' && x.variant === 'sliding');
        if (!o) return null;
        const w = L.walls.find((x) => x.id === o.wall);
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        const p = [w.a[0] + ((w.b[0] - w.a[0]) * o.at) / len, w.a[1] + ((w.b[1] - w.a[1]) * o.at) / len];
        const ed = a.editor;
        ed.view.k = 120;
        ed.view.ox = ed.canvas.clientWidth / 2 - p[0] * 120;
        ed.view.oy = ed.canvas.clientHeight / 2 - p[1] * 120;
        ed.render();
        const r = ed.canvas.getBoundingClientRect();
        const s = ed.toScreen(p);
        return { id: o.id, x: r.left + s[0], y: r.top + s[1], n: L.openings.filter((x) => x.variant === 'sliding').length };
      });
      let panel = null;
      if (at) {
        await page.waitForTimeout(200);
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(200);
        panel = await page.evaluate(() => {
          const side = document.querySelector('.pb-side');
          return { sel: window.__planbygger.sel, head: [...side.querySelectorAll('h3')].map((x) => x.textContent).find((t) => ['Dør', 'Dobbeltdør', 'Skyvedør', 'Vindu', 'Åpning uten dør'].includes(t)) ?? null, type: side.querySelector('.pb-field select')?.value, angle: side.textContent.includes('Åpningsvinkel'), hinge: side.textContent.includes('Snu hengselen') };
        });
        await page.screenshot({ path: path.join(outDir, 'generer-skyvedor.png'), clip: { x: at.x - 260, y: at.y - 170, width: 520, height: 340 } });
      }
      check(`${label}: en skyvedør i editoren: uten bue, uten åpningsvinkel og hengsel i panelet`, at && panel?.sel?.id === at.id && panel.head === 'Skyvedør' && panel.type === 'sliding' && !panel.angle && !panel.hinge, JSON.stringify({ at, panel }));
      if (at && panel?.sel?.id === at.id) {
        await page.locator('.pb-side .pb-field select').first().selectOption('double');
        await page.waitForTimeout(200);
        const dbl = await page.evaluate((id) => {
          const o = window.__planbygger.level.openings.find((x) => x.id === id);
          const side = document.querySelector('.pb-side');
          return { variant: o.variant, leaf: o.leaf, leaf2: o.leaf2, width: o.width, head: [...side.querySelectorAll('h3')].map((x) => x.textContent).find((t) => ['Dør', 'Dobbeltdør', 'Skyvedør', 'Vindu', 'Åpning uten dør'].includes(t)) ?? null, angle: side.textContent.includes('Åpningsvinkel') };
        }, at.id);
        await page.screenshot({ path: path.join(outDir, 'generer-dobbeltdor.png'), clip: { x: at.x - 260, y: at.y - 170, width: 520, height: 340 } });
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(200);
        const back =await page.evaluate((id) => window.__planbygger.level.openings.find((x) => x.id === id)?.variant, at.id);
        check(`${label}: typemenyen gjør skyvedøra til en dobbeltdør med to blad, Ctrl+Z tilbake`, dbl.variant === 'double' && Math.abs(dbl.leaf + dbl.leaf2 - dbl.width) < 0.01 && dbl.head === 'Dobbeltdør' && dbl.angle && back === 'sliding', `${JSON.stringify(dbl)} → ${back}`);
      }
    }
    const posts = aiHits.post - aiBefore.post;
    Object.assign(aiRoute, { mode: 'off', house: null });
    if (!replay) check(`${label}: ingen KI-kall (KI er av)`, posts === 0 && asked.ai === false, `${aiHits.status - aiBefore.status} statusspørsmål, ${posts} kall`);
    else if (hook) {
      const answered = replayer.calls.filter((c) => c.fixture).length;
      check(`${label}: KI-svarene kom fra opptakene (sidens krok), ikke nettet`, posts === 0 && asked.ai === true && answered > 0, `${answered} av ${replayer.calls.length} oppgaver hadde opptak; ${posts} kall til serveren`);
    } else {
      // the page's own client (ai.js) posted every read to this test's route, and every one had a recording
      const log = aiHits.log.slice(aiBefore.log);
      const by = (o) => log.filter((x) => x.outcome === o).length;
      const aiCalls = asked.aiCalls ?? [];
      check(`${label}: sidens egen KI-klient (ai.js) fikk svarene fra opptakene gjennom testserveren, ikke fra nettet`, !v3.override && asked.ai === true && posts > 0 && posts === log.length && by('none') === 0, `${posts} kall: ${by('exact')} med nøyaktig samme bilde, ${by('marks')} samme merker, ${by('position')} koblet etter plass, ${by('none')} uten opptak (${log.map((x) => `${x.task} ${x.file}: ${x.outcome}`).join(', ')}); generate: ${aiCalls.filter((c) => c.ok).length} av ${aiCalls.length} KI-oppgaver besvart (${aiCalls.filter((c) => !c.ok).map((c) => c.task).join(', ') || 'alle'}${aiCalls.some((c) => !c.ok) ? ' ikke sendt eller uten svar' : ''})`);
    }
    check(`${label}: ingen feil i nettleserkonsollen`, watch.errors === 0, `${watch.errors} feil`);
    await context.close();
    return { questions: asked.questions.length, cards, genMs, rooms: v3.rooms, levels: v3.levels };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 11 and 12: the test set's houses, PDFs

  const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', webp: 'image/webp', pdf: 'application/pdf' };
  /**
   * Validator errors allowed per house in section 11 (every other house: 0). With the recordings: the THRESHOLDS of
   * tools/test-planbygger-generate.mjs (round 1's measured numbers – hus1: face snapping in the loft, hus2: rooms as
   * islands in the open living room); without AI: what tools/planbygger-measure-all.mjs --mode noai measures in Node.
   */
  // every house is valid since fase C (hus1 had 2 and hus2 11 errors in fase B): 0 everywhere (K12)
  const MAX_ERRORS = { opptak: {}, off: {} };

  /** The mean grey of a 64 × 48 grid over an RGBA image (self-contained: it also runs in the page, from its source). */
  function greyGrid(img) {
    const gw = 64;
    const gh = 48;
    const sum = new Float64Array(gw * gh);
    const n = new Float64Array(gw * gh);
    for (let y = 0; y < img.height; y += 2) {
      const row = Math.min(gh - 1, Math.floor((y * gh) / img.height)) * gw;
      for (let x = 0; x < img.width; x += 2) {
        const i = (y * img.width + x) * 4;
        const k = row + Math.min(gw - 1, Math.floor((x * gw) / img.width));
        sum[k] += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        n[k]++;
      }
    }
    return Array.from(sum, (v, k) => (n[k] ? v / n[k] : 255));
  }

  /** Drops files given as { name, type, buffer } on an element (a DataTransfer with File objects, the drop event). */
  async function dropBuffers(page, selector, list) {
    const payload = list.map((f) => ({ name: f.name, type: f.type, b64: f.buffer.toString('base64') }));
    const dt = await page.evaluateHandle((items) => {
      const dt = new DataTransfer();
      for (const f of items) {
        const bin = atob(f.b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        dt.items.add(new File([u], f.name, { type: f.type }));
      }
      return dt;
    }, payload);
    await page.dispatchEvent(selector, 'drop', { dataTransfer: dt });
  }

  /** A fresh page on the start screen. → { context, page, watch } */
  async function freshPage() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const watch = watchPage(page, { quiet: true });
    await page.goto(`${base}/planbygger.html`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/planbygger.html`);
    await page.waitForFunction(() => !!window.__planbygger, null, { timeout: 60000 });
    await page.locator('.pb-drop').waitFor({ timeout: 10000 });
    return { context, page, watch };
  }
  const stackReady = (page, n, timeout = 180000) => page.waitForFunction((k) => {
    const s = window.__planbygger.stack;
    return s && s.items.length >= k && s.items.every((x) => !x.loading && !x.analysing);
  }, n, { timeout, polling: 250 });

  /** «Generer» on the stack, «Hopp over resten» when the guide opens, then the 3D house. → { ms, asked } */
  async function generateAndSkip(page) {
    const t0 = Date.now();
    await page.locator('.pb-generate').click();
    await page.waitForFunction(() => window.__planbygger.guide || !window.__planbygger.view3d.hidden || window.__planbyggerLastGenerate?.error, null, { timeout: 400000, polling: 500 });
    const ms = Date.now() - t0;
    const asked = await page.evaluate(() => window.__planbyggerLastGenerate);
    if (asked?.error) throw new Error(`«Generer» feilet: ${asked.error}`);
    if (await page.evaluate(() => !!window.__planbygger.guide)) await page.getByRole('button', { name: 'Hopp over resten' }).click();
    await page.waitForFunction(() => window.__planbygger.viewer?.state?.layout && !window.__planbygger.view3d.hidden, null, { timeout: 120000 });
    await page.waitForTimeout(800);
    return { ms, asked };
  }

  /** The 3D house as the page has it: levels with their walls and rooms, the validator, the scales. */
  const houseState = (page) => page.evaluate(() => {
    const a = window.__planbygger;
    const H = a.viewer.state.layout.house;
    const rooms = H.rooms.filter((r) => r.area > 0.01 && r.id !== 'stue-kjokken');
    return {
      levels: H.levels.length,
      levelList: a.doc.levels.map((l) => ({ id: l.id, name: l.name, file: l.image?.name ?? null, walls: l.walls.length, rooms: rooms.filter((r) => r.levelId === l.id).length })),
      rooms: rooms.length,
      roomList: rooms.map((r) => [r.levelId, r.name, r.area]),
      doors: H.doors.length,
      windows: H.windows.length,
      skylights: a.viewer.state.skylights?.length ?? 0,
      errors: a._lastCheck?.errors?.length ?? null,
      warnings: a._lastCheck?.warnings?.length ?? null,
      firstError: a._lastCheck?.errors?.[0] ?? null,
      scales: a.doc.levels.map((l) => `${l.name} ${l.image?.pxPerM?.toFixed(1)} (${l.image?.scaleFrom?.method})`).join('; '),
    };
  });

  /** Section 11: one house in one mode ('off' | 'opptak'), with its checks. → the row for generer-hus.json */
  async function houseRow(house, mode, { pdfCheck = true } = {}) {
    const dir = path.join(ROOT, 'plantegninger', house);
    const files = fs.readdirSync(dir).filter((f) => TYPES[f.split('.').pop().toLowerCase()]).sort().map((f) => path.join(dir, f));
    const fasit = JSON.parse(fs.readFileSync(path.join(dir, 'fasit.json'), 'utf8'));
    const truthLevels = fasit.levels.filter((l) => !fasit.files?.[l.file]?.alternativeOf).length;
    const label = `${house} ${mode === 'off' ? 'uten KI' : 'med opptakene'}`;
    Object.assign(aiRoute, mode === 'opptak' ? { mode: 'replay', house } : { mode: 'off', house: null });
    const logAt = aiHits.log.length;
    const postAt = aiHits.post;
    const row = { house, mode, files: files.length };
    let context = null;
    let watch = { errors: 0 };
    try {
      let page;
      ({ context, page, watch } = await freshPage());
      const t0 = Date.now();
      await dropBuffers(page, '.pb-drop', files.map((f) => ({ name: path.basename(f), type: TYPES[f.split('.').pop().toLowerCase()], buffer: fs.readFileSync(f) })));
      await stackReady(page, files.length);
      row.readMs = Date.now() - t0;
      row.stack = await page.evaluate(() => window.__planbygger.stack.items.map((x) => `${x.name}:${x.kind}${x.size ? `@${x.size.width}×${x.size.height}` : ''}${x.pdfPage ? `(pdf ${Math.round(x.pdfPage.widthPt)}×${Math.round(x.pdfPage.heightPt)} pt, ${x.render})` : ''}${x.focal ? ` f${x.focal}` : ''}${x.error ? ` FEIL ${x.error}` : ''}`));
      // a PDF page (and, for the record, a JPG or AVIF as the browser decodes it): the very image the Node tests read
      // (plantegninger/_png/<house>/<name>.png)?
      row.decode = [];
      for (const f of pdfCheck ? files.filter((x) => !/\.png$/i.test(x)) : []) {
        const name = path.basename(f);
        const copy = path.join(ROOT, 'plantegninger', '_png', house, name.replace(/\.[^.]+$/, '.png'));
        if (!fs.existsSync(copy)) continue;
        const got = await page.evaluate(([src, n]) => {
          const grid = new Function(`return (${src})`)();
          const it = window.__planbygger.stack.items.find((x) => x.name === n);
          return it?.img ? { width: it.img.width, height: it.img.height, render: it.render, grid: grid(it.img) } : null;
        }, [greyGrid.toString(), name]);
        const ref = readPng(copy);
        const g2 = greyGrid(ref);
        const d = got ? got.grid.map((v, i) => Math.abs(v - g2[i])) : null;
        row.decode.push({ name, pdf: /\.pdf$/i.test(name), width: got?.width ?? null, height: got?.height ?? null, nodeWidth: ref.width, nodeHeight: ref.height, render: got?.render ?? null, meanDiff: d ? d.reduce((s, v) => s + v, 0) / d.length : null, maxDiff: d ? Math.max(...d) : null });
      }
      const { ms, asked } = await generateAndSkip(page);
      row.genMs = ms;
      row.questions = asked?.questions?.length ?? null;
      row.kinds = [...new Set((asked?.questions ?? []).map((q) => q.kind))].join(',');
      row.wallsAsked = (asked?.questions ?? []).some((q) => q.kind === 'walls');
      Object.assign(row, await houseState(page));
      await page.screenshot({ path: path.join(outDir, `generer-hus-${house}${mode === 'off' ? '' : '-opptak'}.png`) });
    } catch (err) {
      row.error = String(err?.message ?? err).split('\n')[0];
    }
    row.consoleErrors = watch.errors;
    const log = aiHits.log.slice(logAt);
    row.ai = mode === 'opptak' ? { posts: aiHits.post - postAt, exact: log.filter((x) => x.outcome === 'exact').length, marks: log.filter((x) => x.outcome === 'marks').length, position: log.filter((x) => x.outcome === 'position').length, none: log.filter((x) => x.outcome === 'none').map((x) => `${x.task} ${x.file}`), calls: log.map((x) => `${x.task} ${x.file}: ${x.outcome}`) } : { posts: aiHits.post - postAt };
    Object.assign(aiRoute, { mode: 'off', house: null });
    await context?.close();
    const levelText = (row.levelList ?? []).map((l) => `${l.file ?? l.name}: ${l.walls} vegger, ${l.rooms} rom`).join('; ');
    const full = !row.error && row.levels === truthLevels && row.levelList?.length === truthLevels && row.levelList.every((l) => l.walls > 0 && l.rooms > 0);
    check(`${label}: ${truthLevels} etasje${truthLevels === 1 ? '' : 'r'} som i fasiten, hver med vegger og rom (ikke et tomt hus)`, full, row.error ?? `${row.levels} etasjer – ${levelText}${row.wallsAsked ? ' (spurte om veggene)' : ''}; ${row.doors} dører, ${row.windows} vinduer, ${row.skylights} takvinduer; ${row.questions} spørsmål (${row.kinds}); lest på ${(row.readMs / 1000).toFixed(1)} s, generert på ${(row.genMs / 1000).toFixed(1)} s; ${row.scales}`);
    const max = MAX_ERRORS[mode][house] ?? 0;
    check(`${label}: høyst ${max} feil i validatoren`, !row.error && row.errors != null && row.errors <= max, `${row.errors} feil / ${row.warnings} adv.${row.firstError ? ` – ${row.firstError}` : ''}`);
    if (mode === 'opptak') check(`${label}: KI-svarene kom fra opptakene, gjennom sidens egen klient`, !row.error && row.ai.posts > 0 && row.ai.none.length === 0, `${row.ai.posts} kall: ${row.ai.exact} med samme bilde, ${row.ai.marks} samme merker, ${row.ai.position} koblet etter plass${row.ai.none.length ? `, uten opptak: ${row.ai.none.join(', ')}` : ''} (${row.ai.calls.join(', ')})`);
    else check(`${label}: ingen KI-kall`, row.ai.posts === 0, `${row.ai.posts} kall`);
    for (const p of row.decode ?? []) {
      const text = `nettleseren ${p.width}×${p.height} px${p.render ? ` (${p.render})` : ''}, Node ${p.nodeWidth}×${p.nodeHeight} px; gråtoneavvik i 64×48 ruter: snitt ${p.meanDiff?.toFixed(2)}, størst ${p.maxDiff?.toFixed(1)}`;
      // a JPG or AVIF: the browser's decoder is not the one that made the Node copy – said, not checked
      if (!p.pdf) {
        console.log(`  (${house}: «${p.name}» i nettleseren mot Node-kopien: ${text})`);
        continue;
      }
      check(`${house}: PDF-siden «${p.name}» blir det samme bildet som Node-testene leser (plantegninger/_png)`, p.width === p.nodeWidth && p.height === p.nodeHeight && p.meanDiff != null && p.meanDiff <= 2 && p.maxDiff <= 24, text);
    }
    return row;
  }

  /** A JPEG's size and colour components (its SOF marker), or null. */
  function jpegInfo(buf) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) {
        p++;
        continue;
      }
      const m = buf[p + 1];
      if (m === 0xd8 || m === 0x01 || m === 0xff || (m >= 0xd0 && m <= 0xd7)) {
        p += m === 0xff ? 1 : 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7), comps: buf[p + 9] };
      p += 2 + buf.readUInt16BE(p + 2);
    }
    return null;
  }

  /**
   * A PDF made here (no library): per page either { jpeg, dpi } – a JPEG filling the page as a scan at that resolution
   * (pdf.js renders it at the JPEG's own pixels) – or { vector: [w, h] } – a page of w × h pt with a frame and a cross.
   */
  function makePdf(pages) {
    const objs = [null, null]; // 1: the catalog, 2: the page tree
    const kids = [];
    for (const pg of pages) {
      let w;
      let h;
      let res = '';
      let content;
      if (pg.jpeg) {
        const info = jpegInfo(pg.jpeg);
        w = (info.width * 72) / pg.dpi;
        h = (info.height * 72) / pg.dpi;
        const im = objs.push([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /${info.comps === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`), pg.jpeg, Buffer.from('\nendstream')]);
        res = `/XObject << /Im0 ${im} 0 R >>`;
        content = `q ${w.toFixed(3)} 0 0 ${h.toFixed(3)} 0 0 cm /Im0 Do Q`;
      } else {
        [w, h] = pg.vector;
        content = `0 0 0 RG 2 w 10 10 ${w - 20} ${h - 20} re S 10 10 m ${w - 10} ${h - 10} l S 10 ${h - 10} m ${w - 10} 10 l S`;
      }
      const c = objs.push([Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)]);
      kids.push(objs.push([Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(3)} ${h.toFixed(3)}] /Resources << ${res} >> /Contents ${c} 0 R >>`)]));
    }
    objs[0] = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')];
    objs[1] = [Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`)];
    const out = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let at = out[0].length;
    const xref = [];
    objs.forEach((parts, i) => {
      xref.push(at);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), ...parts, Buffer.from('\nendobj\n')]);
      out.push(b);
      at += b.length;
    });
    out.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`));
    return Buffer.concat(out);
  }

  /** Section 12 (see the top of the file). */
  async function multiPagePdf() {
    // 45 vector pages of 144 × 108 pt (400 × 300 px at 200 dpi)
    const many = makePdf(Array.from({ length: 45 }, () => ({ vector: [144, 108] })));
    {
      const { context, page, watch } = await freshPage();
      // «Bare én plan»: page 1 only, and the toast says the PDF has more
      await page.locator('input.pb-file-one').setInputFiles({ name: 'mange-sider.pdf', mimeType: 'application/pdf', buffer: many });
      await page.waitForFunction(() => window.__planbygger.level?.image?.width > 0, null, { timeout: 60000 });
      const one = await page.evaluate(() => ({ name: window.__planbygger.level.image.name, width: window.__planbygger.level.image.width, height: window.__planbygger.level.image.height, levels: window.__planbygger.doc.levels.length, toast: document.querySelector('.pb-toast')?.textContent ?? null }));
      check('«Bare én plan» med en PDF på 45 sider: bare side 1 gjengis (400 × 300 px), og det sies at resten ikke er brukt', one.width === 400 && one.height === 300 && one.levels === 1 && /45 sider/.test(one.toast ?? ''), JSON.stringify(one));
      await context.close();
      check('ingen feil i nettleserkonsollen («Bare én plan» med PDF)', watch.errors === 0, `${watch.errors} feil`);
    }
    {
      const { context, page, watch } = await freshPage();
      await dropBuffers(page, '.pb-drop', [{ name: 'mange-sider.pdf', type: 'application/pdf', buffer: many }]);
      await stackReady(page, 40);
      const st = await page.evaluate(() => {
        const s = window.__planbygger.stack;
        return { n: s.items.length, lazy: s.items.filter((x) => x.lazy && !x.img).length, thumb: Math.max(...s.items.map((x) => Math.max(x.bitmap?.width ?? 0, x.bitmap?.height ?? 0))), size: s.items[0]?.size, notice: document.querySelector('.pb-stack-notices:not([hidden])')?.textContent ?? null, names: [s.items[0]?.name, s.items[39]?.name] };
      });
      await page.screenshot({ path: path.join(outDir, 'generer-pdf-mange-sider.png') });
      check('en PDF på 45 sider: 40 sider i stabelen, og stabelen sier at resten er utelatt', st.n === 40 && /45 sider/.test(st.notice ?? '') && /40 første/.test(st.notice ?? ''), `${st.n} kort; «${st.notice}»`);
      check('… sidene leses lat: et miniatyrbilde (≤ 280 px) og en analyse, ingen side i full størrelse før «Generer»', st.lazy === 40 && st.thumb <= 280 && st.size?.width === 400 && st.size?.height === 300, JSON.stringify(st));
      await context.close();
      check('ingen feil i nettleserkonsollen (45 sider)', watch.errors === 0, `${watch.errors} feil`);
    }
    {
      // hus9's two scans in one PDF (150 dpi): two floors, read lazily, «Generer» renders exactly those two pages
      const jpgs = ['ovre-etasje.jpg', 'underetasje.jpg'].map((f) => fs.readFileSync(path.join(ROOT, 'plantegninger', 'hus9', f)));
      const sizes = jpgs.map(jpegInfo);
      const pdf = makePdf(jpgs.map((jpeg) => ({ jpeg, dpi: 150 })));
      const { context, page, watch } = await freshPage();
      await dropBuffers(page, '.pb-drop', [{ name: 'hus9-tegninger.pdf', type: 'application/pdf', buffer: pdf }]);
      await stackReady(page, 2);
      const before = await page.evaluate(() => {
        const s = window.__planbygger.stack;
        window.__pdfLoads = 0;
        for (const x of s.items) {
          if (!x.lazy) continue;
          const load = x.lazy.load;
          x.lazy.load = async () => {
            window.__pdfLoads++;
            return load();
          };
        }
        return s.items.map((x) => ({ name: x.name, kind: x.kind, lazy: !!x.lazy, img: !!x.img, size: x.size, render: x.render, pdfPage: x.pdfPage }));
      });
      await page.screenshot({ path: path.join(outDir, 'generer-pdf-to-sider.png') });
      check('to skannede sider i én PDF: to etasjekort, lest lat, i skannets egen oppløsning', before.length === 2 && before.every((x, i) => x.kind === 'plan' && x.lazy && !x.img && x.render === 'scan' && x.size?.width === sizes[i].width && x.size?.height === sizes[i].height && x.pdfPage?.widthPx === sizes[i].width), JSON.stringify(before));
      let gen = null;
      let after = null;
      let house = null;
      try {
        gen = await generateAndSkip(page);
        house = await houseState(page);
        after = await page.evaluate(() => ({ loads: window.__pdfLoads, imgs: window.__planbygger.stack.items.filter((x) => x.img).length, inputsFreed: window.__planbygger.gen?.inputs == null, imagesFreed: window.__planbygger.gen?.res?.images == null }));
        await page.screenshot({ path: path.join(outDir, 'generer-pdf-to-sider-3d.png') });
      } catch (err) {
        house = { error: String(err?.message ?? err).split('\n')[0] };
      }
      check('«Generer» gjengir bare de to sidene den bruker, i full størrelse, og slipper dem etterpå', after?.loads === 2 && after.imgs === 0 && after.inputsFreed && after.imagesFreed, JSON.stringify(after));
      check('… og 3D-huset har to etasjer, hver med vegger og rom', !house.error && house.levels === 2 && house.levelList.every((l) => l.walls > 0 && l.rooms > 0), house.error ?? `${house.levelList.map((l) => `${l.file}: ${l.walls} vegger, ${l.rooms} rom`).join('; ')}; ${house.errors} feil / ${house.warnings} adv.; «Generer» ${((gen?.ms ?? 0) / 1000).toFixed(1)} s; ${house.scales}`);
      await context.close();
      check('ingen feil i nettleserkonsollen (to sider)', watch.errors === 0, `${watch.errors} feil`);
    }
  }

  if (!opt.only || opt.only === 'generer') {
    section('9. «Generer»: hus3 uten KI');
    const off = await generateHus3({ label: 'uten KI', replay: false });
    if (!opt['no-replay']) {
      section('10. «Generer»: hus3 med de lagrede KI-svarene');
      const rec = await generateHus3({ label: 'med opptak', replay: true });
      check('opptakene gir færre spørsmål enn uten KI', rec.questions < off.questions, `${rec.questions} mot ${off.questions}`);
    }
  }
  // ---- 11 (opt-in, --houses or --houses=hus1,hus7): «Generer» in the browser on the test set's original files (AVIF, JPG,
  //      PDF as the customer has them), «Hopp over resten», without AI and with the recordings – what the page itself
  //      makes of every house, checked per house (see the top of the file)
  const housesOpt = opt.houses ?? (opt.only === 'hus' ? 'true' : null);
  if (housesOpt) {
    const all = ['hus1', 'hus2', 'hus3', 'hus3-foto', 'hus4', 'hus5', 'hus6', 'hus7', 'hus8', 'hus9'];
    const want = housesOpt === 'true' ? all : housesOpt.split(',');
    const modes = opt['houses-ai'] === 'off' ? ['off'] : opt['houses-ai'] === 'opptak' ? ['opptak'] : ['off', 'opptak'];
    const rows = [];
    for (const mode of modes) {
      section(`11${modes.length > 1 ? (mode === 'off' ? 'a' : 'b') : ''}. «Generer» i nettleseren på testhusene (${mode === 'off' ? 'uten KI' : 'med opptakene'}, «Hopp over resten»)`);
      for (const house of want) rows.push(await houseRow(house, mode, { pdfCheck: mode === modes[0] }));
    }
    fs.writeFileSync(path.join(outDir, 'generer-hus.json'), JSON.stringify(rows, null, 2));
    console.log(`  (tabellen: ${path.relative(ROOT, path.join(outDir, 'generer-hus.json'))})`);
  }

  // ---- 12: a PDF with several pages (see the top of the file)
  if ((!opt.only || opt.only === 'generer') && !opt['no-pdf']) {
    section('12. En PDF med flere sider');
    await multiPagePdf();
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await close();
  if (!opt.keep) await server.close();
  release();
}
if (failed) check('kjøringen fullførte', false);
done();
