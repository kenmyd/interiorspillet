#!/usr/bin/env node
/**
 * Test of the touch / keyboard / touchpad controls (src/core/Input.js, Device.js, ui/TouchControls.js,
 * ui/ControlsIntro.js, player/AutoWalk.js) in emulated devices, with screenshots. Needs a dev server (`npm run dev`).
 *
 * Usage:
 *   node tools/test-touch.mjs [--only=iphone,ipad,pc] [--out=.shots/touch] [--port=5180] [--browser=msedge|chrome]
 *                             [--exe=<path to chrome / chromium>] [--fast=false]
 *
 *   iphone  iPhone 13 held sideways: start screen → «Slik styrer du» (Mobil, three touch layouts, the choice and
 *           «Ikke vis igjen» are saved) → the joystick walks, a drag looks around, a tap selects a piece of
 *           furniture, dragging it moves it, Meny → Styring → «Trykk for å gå dit», a tap on the floor walks there,
 *           quality «Lav» by default, upright: the turn-the-phone hint
 *   ipad    iPad held sideways: «Nettbrett», «To joysticker» (left walks, right looks), a tap selects, the catalogue
 *           and the «Plasser» button
 *   pc      a desktop window (with a touch screen, ?device=pc): «PC» with Mus / Tastatur / Touchpad; the keyboard
 *           profile (A/D turn, Q looks up, → steps sideways, Enter selects at the crosshair), the touchpad profile
 *           (two-finger scrolling looks around, a click selects), the mouse as before (right drag looks, the wheel does
 *           not), a touch shows the touch controls and the mouse hides them again
 * iPad and PC run with graphics quality «Lav» for speed (--fast=false: the device's default).
 * Every step prints PASS / FAIL; screenshots and results.json go to --out. Exit code 1 when a step failed.
 * Loading the house in a software-rendered headless browser takes a minute or two per device.
 */
import { chromium, devices } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, ROOT, settingsInit } from './lib/hus.mjs';

const { opt } = parseArgs();
const OUT = resolve(opt.out ?? join(ROOT, '.shots', 'touch'));
const PORT = Number(opt.port ?? 5180);
const ONLY = new Set((opt.only ?? 'iphone,ipad,pc').split(',').map((s) => s.trim()));
const BASE = `http://127.0.0.1:${PORT}/?nowarm=1&spawn=inside`;
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Difference of two angles, wrapped to −π … π. */
const dAng = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const shot = async (page, name) => {
  const path = join(OUT, name);
  await page.screenshot({ path });
  console.log(`      saved ${path}`);
};

const launch = { headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] };
if (opt.exe) launch.executablePath = opt.exe;
else launch.channel = opt.browser ?? 'msedge';
const browser = await chromium.launch(launch);

/** Game state for the checks. */
const state = (page) => page.evaluate(() => {
  const g = window.__game;
  if (!g?.player) return null;
  const p = g.player.position;
  return {
    x: p.x, y: p.y, z: p.z, yaw: g.player.yaw, pitch: g.player.pitch,
    selected: g.editor?.selected ?? null, touch: !!g.input.touchActive, captured: g.input.isCaptured,
    paused: g.paused, blocked: g.inputBlocked, autoWalk: !!g.autoWalk?.active,
  };
});
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('interiorspillet.settings.v1') || '{}'));

/** A touch gesture through CDP (real touch events → pointer events with pointerType 'touch'). */
async function touch(cdp, points, { holdMs = 0, steps = 8, stepMs = 30 } = {}) {
  // points: [{ id, from: [x, y], to: [x, y] }]
  const at = (t) => points.map((p) => ({ id: p.id ?? 1, x: p.from[0] + (p.to[0] - p.from[0]) * t, y: p.from[1] + (p.to[1] - p.from[1]) * t, radiusX: 4, radiusY: 4, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await sleep(stepMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
  }
  if (holdMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < holdMs) {
      await sleep(100);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(1) }); // keep the finger alive
    }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
/** A quick tap: both events are sent without waiting in between (a software-rendered page acknowledges each touch
 *  event only after a frame, which would make every tap a long press). */
async function tapAt(cdp, x, y) {
  const touchPoints = [{ id: 1, x, y, radiusX: 4, radiusY: 4, force: 1 }];
  await Promise.all([
    cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints }),
    cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  ]);
}

/** Screen point (client px) of a piece of furniture near the middle of the view, or null. */
const findItem = (page, { exclude = [] } = {}) => page.evaluate((exclude) => {
  const g = window.__game;
  const c = g.renderer.domElement.getBoundingClientRect();
  let best = null;
  for (let iy = -6; iy <= 6; iy++) {
    for (let ix = -8; ix <= 8; ix++) {
      const ndc = { x: ix / 10, y: iy / 10 - 0.1 };
      // the first thing under the point (a bed behind a wall does not count) – and not too far away
      const hit = g.editor.raycast(ndc, { items: true, walls: true, windows: true, floor: true, ceilings: true });
      if (hit?.kind === 'item' && hit.uid && hit.distance < 7 && !exclude.includes(hit.uid) && (!best || Math.hypot(ndc.x, ndc.y) < best.d)) best = { uid: hit.uid, ndc, d: Math.hypot(ndc.x, ndc.y), dist: hit.distance };
    }
  }
  if (!best) return null;
  return { uid: best.uid, x: c.left + (best.ndc.x + 1) / 2 * c.width, y: c.top + (1 - best.ndc.y) / 2 * c.height, dist: best.dist };
}, exclude);

/**
 * findItem, checked with the editor itself: a click there (editor.handleClick, without any input) selects that piece –
 * not a lamp fitting or a door in front of it. The probe's selection is cleared again.
 */
async function findSelectable(page) {
  const tried = [];
  for (let i = 0; i < 6; i++) {
    const it = await findItem(page, { exclude: tried });
    if (!it) return null;
    const ok = await page.evaluate(({ x, y, uid }) => {
      const g = window.__game;
      const c = g.renderer.domElement.getBoundingClientRect();
      const ndc = { x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 };
      g.editor.handleClick(ndc);
      const hit = g.editor.selected?.uid === uid;
      g.editor.select(null);
      return hit;
    }, it);
    if (ok) return it;
    tried.push(it.uid);
  }
  return null;
}

/** A floor point a tap may walk to (probed with AutoWalk itself, then cancelled), as client px. */
const findFloor = (page) => page.evaluate(() => {
  const g = window.__game;
  const c = g.renderer.domElement.getBoundingClientRect();
  for (const y of [-0.35, -0.45, -0.25, -0.55, -0.15, -0.65]) {
    for (const x of [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45, -0.6, 0.6]) {
      if (g.editor.raycast({ x, y }, { items: true, walls: true, windows: true })) continue;
      if (g.autoWalk.walkTo({ x, y })) {
        const t = g.autoWalk.target;
        const d = Math.hypot(t.x - g.player.position.x, t.z - g.player.position.z);
        g.autoWalk.cancel();
        if (d > 1) return { x: c.left + (x + 1) / 2 * c.width, y: c.top + (1 - y) / 2 * c.height, d };
      }
    }
  }
  return null;
});

async function startFromMenu(page, label) {
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kv-play', { state: 'visible', timeout: 60000 });
  await sleep(800);
  await shot(page, `${label}-1-startside.png`);
  await page.tap('.kv-play', { timeout: 180000, noWaitAfter: true });
  await page.waitForSelector('.kci-host .kv-dialog.is-open', { timeout: 300000 });
  await sleep(1200);
  console.log(`      ${label}: the game and the popup are up after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

async function landscape(name) {
  const d = devices[name];
  const vp = { width: Math.max(d.viewport.width, d.viewport.height), height: Math.min(d.viewport.width, d.viewport.height) };
  const sc = d.screen ? { width: Math.max(d.screen.width, d.screen.height), height: Math.min(d.screen.width, d.screen.height) } : vp;
  return browser.newContext({ ...d, viewport: vp, screen: sc });
}

function watch(page, label) {
  // a software-rendered page answers slowly (seconds per frame): generous timeouts for every step
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => console.log(`[${label} pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${label} console.error] ${m.text().slice(0, 300)}`);
  });
}

/* ------------------------------------------------------------------ iPhone */

async function testIphone() {
  const ctx = await landscape('iPhone 13');
  const page = await ctx.newPage();
  watch(page, 'iphone');
  const cdp = await ctx.newCDPSession(page);
  await startFromMenu(page, 'iphone');
  const vp = page.viewportSize();

  const dev = await page.evaluate(() => ({ kind: document.documentElement.dataset.device, chip: document.querySelector('.kci-device__chip')?.textContent, cards: [...document.querySelectorAll('.kci-card .kci-card__title')].map((e) => e.textContent) }));
  check('iPhone: oppdaget som mobil, popupen viser touch-valgene', dev.kind === 'phone' && dev.chip === 'Mobil' && dev.cards.length === 3 && dev.cards.includes('To joysticker'), JSON.stringify(dev));
  await shot(page, 'iphone-2-popup.png');

  const card = (title) => page.locator('.kci-card', { hasText: title });
  await card('To joysticker').tap();
  await sleep(300);
  check('iPhone: valget «To joysticker» lagres', (await stored(page)).touchLayout === 'dual');
  await card('Joystick + dra for å se').tap();
  await page.locator('.kci-check input').tap();
  await sleep(300);
  const s1 = await stored(page);
  check('iPhone: «Joystick» og «Ikke vis igjen» lagres', s1.touchLayout === 'joystick' && s1.showHelpOnStart === false, JSON.stringify({ touchLayout: s1.touchLayout, showHelpOnStart: s1.showHelpOnStart }));
  check('iPhone: grafikkvalitet «Lav» som standard', s1.quality === 'low' || (await page.evaluate(() => window.__game.settings.get('quality'))) === 'low');
  await shot(page, 'iphone-3-popup-valgt.png');
  await page.locator('.kci-start').tap();
  await page.waitForFunction(() => !document.querySelector('.kci-host') && !window.__game.inputBlocked);
  await sleep(1000);

  let st = await state(page);
  const yaw0 = st.yaw;
  const ui = await page.evaluate(() => ({ ptc: !document.querySelector('.ptc')?.hidden, stick: !document.querySelector('.ptc-stick--move')?.hidden, popup: !!document.querySelector('.kci-host') }));
  check('iPhone: popupen lukket, joystick og knapper vises, touch aktiv', ui.ptc && ui.stick && !ui.popup && st.touch && !st.blocked, JSON.stringify({ ...ui, touch: st.touch }));
  await shot(page, 'iphone-4-touchkontroller.png');

  // joystick: push forward for 3 s
  const base = await page.locator('.ptc-stick--move .ptc-stick__base').boundingBox();
  const cx = base.x + base.width / 2, cy = base.y + base.height / 2;
  st = await state(page);
  await touch(cdp, [{ from: [cx, cy], to: [cx, cy - base.height * 0.42] }], { holdMs: 3000 });
  let st2 = await state(page);
  const walked = Math.hypot(st2.x - st.x, st2.z - st.z);
  check('iPhone: joysticken går', walked > 0.15, `${walked.toFixed(2)} m`);
  await sleep(1200); // let the player come to a stop

  // drag on the picture: look around
  st = await state(page);
  await touch(cdp, [{ from: [vp.width * 0.62, vp.height * 0.4], to: [vp.width * 0.62 + 160, vp.height * 0.4 - 40] }], { steps: 12, stepMs: 40 });
  await sleep(400);
  st2 = await state(page);
  check('iPhone: dra ser rundt (yaw og pitch endres, ingen forflytning)', Math.abs(dAng(st2.yaw, st.yaw)) > 0.2 && Math.abs(st2.pitch - st.pitch) > 0.05 && Math.hypot(st2.x - st.x, st2.z - st.z) < 0.05, `yaw ${dAng(st2.yaw, st.yaw).toFixed(2)}, pitch ${(st2.pitch - st.pitch).toFixed(2)}`);

  // turn back toward the room and tap a piece of furniture
  await page.evaluate((yaw) => { const g = window.__game; g.player.teleport(g.player.position.clone(), yaw, -0.25); }, yaw0);
  await sleep(500);
  const item = await findSelectable(page);
  if (!item) check('iPhone: fant et møbel å trykke på', false);
  else {
    await tapAt(cdp, item.x, item.y);
    await sleep(900);
    st = await state(page);
    check('iPhone: trykk velger møbelet', st.selected?.kind === 'item' && st.selected.uid === item.uid, `${item.uid} → ${JSON.stringify(st.selected)}`);
    await shot(page, 'iphone-5-mobel-valgt.png');

    // drag the selected piece with a finger
    const before = await page.evaluate((uid) => [...window.__game.editor.design.get(uid).position], item.uid);
    await touch(cdp, [{ from: [item.x, item.y], to: [item.x + 70, item.y + 25] }], { steps: 14, stepMs: 60 });
    await sleep(800);
    const after = await page.evaluate((uid) => [...window.__game.editor.design.get(uid).position], item.uid);
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
    check('iPhone: dra valgt møbel flytter det (setPointerClaim)', moved > 0.05, `${moved.toFixed(2)} m`);
    await page.evaluate(() => window.__game.editor.design.undo?.());
  }

  // Meny → Styring → «Trykk for å gå dit»
  await page.locator('.ptc-menu').tap();
  await sleep(700);
  check('iPhone: meny-knappen pauser', (await state(page)).paused);
  await page.locator('.kv-menubtn', { hasText: 'Styring' }).tap();
  await sleep(500);
  await page.locator('.kci-card', { hasText: 'Trykk for å gå dit' }).tap();
  await sleep(300);
  check('iPhone: Meny → Styring lagrer «Trykk for å gå dit»', (await stored(page)).touchLayout === 'tapwalk');
  await shot(page, 'iphone-6-meny-styring.png');
  await page.locator('.kv-pause__subhead .kv-iconbtn').tap();
  await sleep(300);
  await page.locator('.kv-menubtn', { hasText: 'Fortsett' }).tap();
  await page.waitForFunction(() => !window.__game.paused && !window.__game.inputBlocked);
  await sleep(800);
  await page.evaluate((yaw) => {
    const g = window.__game;
    g.editor.select(null);
    g.player.teleport(g.player.position.clone(), yaw + Math.PI, -0.35); // away from the table, a little down
  }, yaw0);
  await sleep(800);

  const floor = await findFloor(page);
  if (!floor) check('iPhone: fant gulv å trykke på', false);
  else {
    await page.waitForFunction(() => !window.__game.paused && !window.__game.inputBlocked);
    st = await state(page);
    await tapAt(cdp, floor.x, floor.y);
    // a frame or two later the goal is set (the ring on the floor)
    await page.waitForFunction(() => window.__game.autoWalk.active, null, { timeout: 15000 }).catch(() => {});
    const mid = await state(page);
    await shot(page, 'iphone-7-trykk-for-a-ga.png');
    await sleep(3000);
    st2 = await state(page);
    const d = Math.hypot(st2.x - st.x, st2.z - st.z);
    check('iPhone: trykk på gulvet går dit', (mid.autoWalk || d > 0.3) && d > 0.2, `gikk ${d.toFixed(2)} m av ${floor.d.toFixed(2)} m`);
  }

  // held upright: the hint
  await page.setViewportSize({ width: vp.height, height: vp.width });
  // the hint is set in the next frame (TouchControls.update)
  const upright = await page.waitForFunction(() => !document.querySelector('.ptc-rotate')?.hidden, null, { timeout: 15000 }).then(() => true, () => false);
  check('iPhone på høykant: hint om å snu telefonen', upright);
  await shot(page, 'iphone-8-hoykant.png');
  await ctx.close();
}

/* ------------------------------------------------------------------ iPad */

async function testIpad() {
  const ctx = await landscape('iPad (gen 7)');
  const page = await ctx.newPage();
  watch(page, 'ipad');
  if (opt.fast !== 'false') await page.addInitScript(settingsInit({ quality: 'low' })); // speed; the default is checked below
  const cdp = await ctx.newCDPSession(page);
  await startFromMenu(page, 'ipad');
  const dev = await page.evaluate(() => ({ kind: document.documentElement.dataset.device, chip: document.querySelector('.kci-device__chip')?.textContent }));
  check('iPad: oppdaget som nettbrett', dev.kind === 'tablet' && dev.chip === 'Nettbrett', JSON.stringify(dev));
  await page.locator('.kci-card', { hasText: 'To joysticker' }).tap();
  await sleep(300);
  await shot(page, 'ipad-2-popup.png');
  check('iPad: valget «To joysticker» lagres', (await stored(page)).touchLayout === 'dual');
  await page.locator('.kci-start').tap();
  await page.waitForFunction(() => !document.querySelector('.kci-host') && !window.__game.inputBlocked);
  await sleep(1000);
  check('iPad: standard grafikkvalitet er «Middels» på nettbrett', (await page.evaluate(() => window.__game.settings.defaults.quality)) === 'medium');

  const look = await page.locator('.ptc-stick--look .ptc-stick__base').boundingBox();
  const move = await page.locator('.ptc-stick--move .ptc-stick__base').boundingBox();
  let st = await state(page);
  await touch(cdp, [{ id: 2, from: [look.x + look.width / 2, look.y + look.height / 2], to: [look.x + look.width * 0.95, look.y + look.height / 2] }], { holdMs: 1500 });
  let st2 = await state(page);
  check('iPad: høyre joystick ser rundt', Math.abs(dAng(st2.yaw, st.yaw)) > 0.15 && Math.hypot(st2.x - st.x, st2.z - st.z) < 0.05, `yaw ${dAng(st2.yaw, st.yaw).toFixed(2)}`);
  st = st2;
  // both sticks at once: walk and turn
  await touch(cdp, [
    { id: 1, from: [move.x + move.width / 2, move.y + move.height / 2], to: [move.x + move.width / 2, move.y + move.height * 0.1] },
    { id: 2, from: [look.x + look.width / 2, look.y + look.height / 2], to: [look.x + look.width * 0.2, look.y + look.height / 2] },
  ], { holdMs: 2500 });
  st2 = await state(page);
  check('iPad: begge joystickene samtidig (gå + snu)', Math.hypot(st2.x - st.x, st2.z - st.z) > 0.15 && Math.abs(dAng(st2.yaw, st.yaw)) > 0.1, `${Math.hypot(st2.x - st.x, st2.z - st.z).toFixed(2)} m, yaw ${dAng(st2.yaw, st.yaw).toFixed(2)}`);
  await shot(page, 'ipad-3-to-joysticker.png');

  await page.evaluate(() => { const g = window.__game; g.player.teleport(g.player.position.clone(), g.player.yaw, -0.2); });
  await sleep(500);
  const item = await findSelectable(page);
  if (item) {
    await tapAt(cdp, item.x, item.y);
    await sleep(900);
    st = await state(page);
    check('iPad: trykk velger møbelet', st.selected?.uid === item.uid, `${item.uid} → ${JSON.stringify(st.selected)}`);
    await shot(page, 'ipad-4-mobel-valgt.png');
    await page.evaluate(() => window.__game.editor.select(null));
  } else check('iPad: fant et møbel å trykke på', false);

  // the catalogue: open it from the toolbar, start placing a piece, «Plasser»
  await page.locator('.ipt-bar .ip-toolbtn', { hasText: 'Katalog' }).tap();
  await sleep(1200);
  const open = await page.evaluate(() => !!window.__game.editor.ui.catalog?.isOpen);
  check('iPad: katalogen åpnes med et trykk', open);
  await shot(page, 'ipad-5-katalog.png');
  const cardEl = page.locator('.ipc-card .ipc-foot button').first();
  if (await cardEl.count()) {
    const n0 = await page.evaluate(() => window.__game.editor.design.list().length);
    // a finger tap on the card's «Plasser» (sent without waiting: building the piece blocks a software-rendered page)
    const box = await cardEl.boundingBox();
    await tapAt(cdp, box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => !!window.__game.editor.placement?.isPlacing, null, { timeout: 180000 }).catch(() => {});
    await sleep(1500);
    const placing = await page.evaluate(() => !!window.__game.editor.placement?.isPlacing);
    const bar = await page.evaluate(() => !document.querySelector('.ptc-place')?.hidden);
    await shot(page, 'ipad-6-plasserer.png');
    check('iPad: et trykk på «Plasser» i katalogen starter plassering, «Plasser / Roter / Avbryt» vises', placing && bar, JSON.stringify({ placing, bar }));
    if (placing) {
      await page.locator('.ptc-place .ptc-pill', { hasText: 'Roter' }).tap({ timeout: 120000 });
      await sleep(300);
      await page.locator('.ptc-place .ptc-pill', { hasText: 'Plasser' }).tap({ timeout: 120000 });
      await page.waitForFunction(() => !window.__game.editor.placement?.isPlacing || document.querySelector('.kv-toast'), null, { timeout: 120000 }).catch(() => {});
      await sleep(1500);
      const n1 = await page.evaluate(() => window.__game.editor.design.list().length);
      const msg = await page.evaluate(() => [...document.querySelectorAll('.kv-toast span')].map((e) => e.textContent).join(' | '));
      check('iPad: «Plasser» plasserer møbelet (eller sier hvorfor ikke)', n1 === n0 + 1 || /Kan ikke|Pek på/.test(msg), `${n0} → ${n1} ${msg}`);
      if (await page.evaluate(() => !!window.__game.editor.placement?.isPlacing)) await page.locator('.ptc-place .ptc-pill', { hasText: 'Avbryt' }).tap();
      await shot(page, 'ipad-7-plassert.png');
    }
  } else check('iPad: katalogen har kort', false);
  await ctx.close();
}

/* ------------------------------------------------------------------ PC */

async function testPc() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'pc');
  if (opt.fast !== 'false') await page.addInitScript(settingsInit({ quality: 'low' })); // speed only
  const cdp = await ctx.newCDPSession(page);
  const t0 = Date.now();
  await page.goto(`${BASE}&device=pc`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kv-play', { state: 'visible', timeout: 60000 });
  await page.mouse.click(10, 10);
  await page.click('.kv-play', { timeout: 180000, noWaitAfter: true });
  await page.waitForSelector('.kci-host .kv-dialog.is-open', { timeout: 300000 });
  await sleep(1200);
  console.log(`      pc: the game and the popup are up after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.kci-card .kci-card__title')].map((e) => e.textContent));
  check('PC: popupen viser Mus / Tastatur / Touchpad', cards.join('|') === 'Mus|Tastatur (A/D snur)|Touchpad', cards.join('|'));
  await shot(page, 'pc-1-popup.png');
  await page.click('.kci-card:has-text("Tastatur")');
  await sleep(300);
  check('PC: valget «Tastatur» lagres', (await stored(page)).controlScheme === 'keyboard');
  await shot(page, 'pc-2-popup-tastatur.png');
  await page.click('.kci-start');
  await page.waitForFunction(() => !document.querySelector('.kci-host') && !window.__game.inputBlocked);
  await sleep(1000);
  await page.mouse.move(640, 600);
  const yaw0 = (await state(page)).yaw;
  /** Back to the start view (toward the dining table), a little down. */
  const faceRoom = () => page.evaluate((yaw) => { const g = window.__game; g.player.teleport(g.player.position.clone(), yaw, -0.2); }, yaw0);

  const hold = async (code, ms) => {
    await page.keyboard.down(code);
    await sleep(ms);
    await page.keyboard.up(code);
    await sleep(150);
  };
  let st = await state(page);
  check('PC tastatur: krysset er sikte (sentrert)', st.captured === true && !st.touch);
  // (a software-rendered page draws few frames per second and every frame counts at most 50 ms: hold the keys long
  // and look for a clear turn in the right direction, not for a set angle)
  await hold('KeyA', 3000);
  let st2 = await state(page);
  check('PC tastatur: A snur til venstre (går ikke sidelengs)', dAng(st2.yaw, st.yaw) > 0.05 && Math.hypot(st2.x - st.x, st2.z - st.z) < 0.05, `yaw ${dAng(st2.yaw, st.yaw).toFixed(2)}`);
  st = st2;
  await hold('KeyQ', 2000);
  st2 = await state(page);
  check('PC tastatur: Q ser opp', st2.pitch - st.pitch > 0.03, `pitch ${(st2.pitch - st.pitch).toFixed(2)}`);
  await hold('KeyZ', 2000);
  st = await state(page);
  await hold('ArrowRight', 1500);
  st2 = await state(page);
  check('PC tastatur: → går sidelengs uten å snu', Math.hypot(st2.x - st.x, st2.z - st.z) > 0.1 && Math.abs(dAng(st2.yaw, st.yaw)) < 0.01, `${Math.hypot(st2.x - st.x, st2.z - st.z).toFixed(2)} m`);

  // Enter selects what the crosshair points at: turn so a piece of furniture is right in the middle
  await page.evaluate(() => { const g = window.__game; g.player.teleport(g.player.position.clone(), g.player.yaw, -0.25); });
  await sleep(400);
  const target = await findSelectable(page);
  const centre = target && await page.evaluate(({ x, y }) => {
    const g = window.__game;
    const c = g.renderer.domElement.getBoundingClientRect();
    const hit = g.editor.raycast({ x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 }, { items: true });
    const eye = g.camera.getWorldPosition(hit.point.clone());
    const d = hit.point.clone().sub(eye);
    g.player.teleport(g.player.position.clone(), Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    return hit.uid;
  }, target);
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(900);
  st = await state(page);
  check('PC tastatur: Enter velger det krysset peker på', !!centre && st.selected?.uid === centre, `${centre} → ${JSON.stringify(st.selected)}`);
  await page.keyboard.press('KeyH');
  await sleep(500);
  await shot(page, 'pc-3-tastatur.png');
  await page.keyboard.press('KeyH');
  await page.evaluate(() => window.__game.editor.select(null));

  // Esc → Styring → Touchpad
  await page.keyboard.press('Escape');
  await sleep(600);
  await page.click('.kv-menubtn:has-text("Styring")');
  await sleep(400);
  await page.click('.kci-card:has-text("Touchpad")');
  await sleep(300);
  check('PC: Esc → Styring lagrer «Touchpad»', (await stored(page)).controlScheme === 'touchpad');
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(800);
  st = await state(page);
  check('PC touchpad: ikke pauset, fri peker', !st.paused && !st.captured, JSON.stringify({ paused: st.paused, captured: st.captured }));
  await page.mouse.move(640, 300);
  await page.mouse.wheel(260, 0);
  await sleep(500);
  st2 = await state(page);
  check('PC touchpad: tofinger-sveip sideveis snur', Math.abs(dAng(st2.yaw, st.yaw)) > 0.4, `yaw ${dAng(st2.yaw, st.yaw).toFixed(2)}`);
  st = st2;
  await page.mouse.wheel(0, -150);
  await sleep(500);
  st2 = await state(page);
  check('PC touchpad: tofinger-sveip opp/ned ser opp/ned', Math.abs(st2.pitch - st.pitch) > 0.2, `pitch ${(st2.pitch - st.pitch).toFixed(2)}`);
  await faceRoom();
  await sleep(600);
  const item = await findSelectable(page);
  if (item) {
    await page.mouse.click(item.x, item.y);
    await sleep(900);
    check('PC touchpad: trykk/klikk velger møbel', (await state(page)).selected?.uid === item.uid, item.uid);
    await shot(page, 'pc-4-touchpad.png');
    await page.evaluate(() => window.__game.editor.select(null));
  } else check('PC touchpad: fant et møbel å klikke på', false);

  // a finger on the screen: touch controls; the mouse: back
  const vp = page.viewportSize();
  await touch(cdp, [{ from: [vp.width * 0.6, vp.height * 0.4], to: [vp.width * 0.6 + 60, vp.height * 0.4] }]);
  await sleep(600);
  const touchOn = await page.evaluate(() => ({ mode: window.__game.input.touchActive, ui: !document.querySelector('.ptc')?.hidden }));
  check('PC med berøringsskjerm: et trykk viser touch-kontrollene', touchOn.mode && touchOn.ui, JSON.stringify(touchOn));
  await shot(page, 'pc-5-hybrid-touch.png');
  await page.mouse.move(300, 300);
  await page.mouse.move(340, 320);
  await sleep(500);
  const touchOff = await page.evaluate(() => ({ mode: window.__game.input.touchActive, ui: !document.querySelector('.ptc')?.hidden }));
  check('PC med berøringsskjerm: musa skjuler dem igjen', !touchOff.mode && !touchOff.ui, JSON.stringify(touchOff));

  // the mouse as before: right drag looks, the wheel does not
  await page.evaluate(() => window.__game.settings.set('controlScheme', 'mouse'));
  await sleep(300);
  st = await state(page);
  await page.mouse.wheel(260, 0);
  await sleep(400);
  st2 = await state(page);
  check('PC mus: hjulet snur ikke i musemodus', Math.abs(dAng(st2.yaw, st.yaw)) < 0.01 && !st2.captured);
  st = st2;
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 20, 360);
  await page.mouse.up({ button: 'right' });
  await sleep(500);
  st2 = await state(page);
  check('PC mus: høyre dra ser rundt som før', Math.abs(dAng(st2.yaw, st.yaw)) > 0.1, `yaw ${dAng(st2.yaw, st.yaw).toFixed(2)}`);
  await faceRoom();
  await sleep(600);
  const item2 = await findSelectable(page);
  if (item2) {
    await page.mouse.click(item2.x, item2.y);
    await sleep(900);
    check('PC mus: venstreklikk velger møbel som før', (await state(page)).selected?.uid === item2.uid, item2.uid);
    await shot(page, 'pc-6-mus.png');
  } else check('PC mus: fant et møbel å klikke på', false);
  await ctx.close();
}

try {
  if (ONLY.has('iphone')) await testIphone().catch((e) => check('iPhone: testen kjørte ferdig', false, e.message));
  if (ONLY.has('ipad')) await testIpad().catch((e) => check('iPad: testen kjørte ferdig', false, e.message));
  if (ONLY.has('pc')) await testPc().catch((e) => check('PC: testen kjørte ferdig', false, e.message));
} finally {
  await browser.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} av ${results.length} steg OK${failed.length ? ` – feilet: ${failed.map((r) => r.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
