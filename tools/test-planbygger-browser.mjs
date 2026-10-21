#!/usr/bin/env node
/**
 * The planbygger end to end in a real browser (headless Edge, playwright-core): the page as a customer uses it.
 *
 *   node tools/test-planbygger-browser.mjs [--port=5272] [--lock] [--keep]
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
 * --lock takes the shared GPU lock of the house work (notes/hele-huset-design.md §0), --keep leaves the server running.
 * Exit code 1 when a check fails.
 */
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, check, section, done } from './planbygger-lib.mjs';
import { launchBrowser, watchPage, acquireGpuLock, parseArgs } from './lib/hus.mjs';

const { opt } = parseArgs();
const port = Number(opt.port ?? 5272);
const outDir = path.join(ROOT, '.shots', 'planbygger');
fs.mkdirSync(outDir, { recursive: true });
const release = opt.lock ? await acquireGpuLock({ label: 'planbygger-browser' }) : () => {};

process.env.PLANBYGGER_PORT = String(port);
const server = await createServer({ configFile: path.join(ROOT, 'tools', 'planbygger-vite.config.mjs'), server: { port, strictPort: true }, logLevel: 'warn' });
await server.listen();
const base = `http://127.0.0.1:${port}`;
const { browser, close } = await launchBrowser({ pidfile: path.join(outDir, 'browser.pid') });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const watch = watchPage(page, { quiet: true });
  await page.goto(`${base}/planbygger.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/planbygger.html`);
  await page.waitForFunction(() => !!window.__planbygger, null, { timeout: 60000 });

  section('1–2. Last opp og skala');
  await page.getByText('Prøv med eksempelplanen').click();
  await page.waitForFunction(() => window.__planbygger.level?.image?.width > 0, null, { timeout: 30000 });
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
  check('ingen feil i nettleserkonsollen', watch.errors === 0, `${watch.errors} feil`);
  await context.close();
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
