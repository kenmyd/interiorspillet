#!/usr/bin/env node
/**
 * Performance and visibility measurements for the whole house (notes/hele-huset-design.md §4.12–4.13, steg 29 Y1).
 * Runs against a test server (the worktree's own, or a server for master – any build of the game: the page-side code
 * only uses what exists) and always with «Automatisk oppløsning» off, so dynamic resolution never hides a cost.
 *
 *   node tools/perf.mjs --port=525N [--label=hus] [--out=<file.json>] [--compare=<master.json>] [--lock] [--step=y1]
 *       [--only=load,frames,walk,check] [--loads=2] [--frames=40] [--poses=spawn,gang,…] [--vis=0]
 *       [--shots=<dir>] [--w=1280 --h=960] [--params=vistrim=0]
 *
 *   load    --loads fresh browsers (a new GPU process each: no program cache) load /?play=1&nohelp=1 – with the
 *           catalogue warm-up, like a real first visit – and the time to window.__ready is taken (median).
 *   frames  /?play=1&nowarm=1&nohelp=1 (&vis=0 with --vis=0): the page's loop is stopped and every pose (POSES) is
 *           measured with fixed steps (tools/lib/hus.mjs __hus.step): 90 steps to settle, two renders, then
 *           renderer.info over one frame (draw calls, triangles – shadow passes included when a map renders), the CPU
 *           time of a frame (step + render) and the frame time with the GPU waited for (render + a 1-pixel read),
 *           both medians over --frames frames; the resolution scale (game._dyn.scale), the pixel ratio and the
 *           visibility module's stats.
 *   walk    /?play=1&nowarm=1&nohelp=1&doors=open: walks routes with real physics (W held, the player steered to each
 *           waypoint, every frame rendered) and counts the room changes (game.roomId), environment builds
 *           (lighting.stats.envBuilds), sun shadow passes (lighting.stats.sunPasses where it exists) and shadow-map
 *           renders (renderer.shadowMap.render calls that drew). Routes: 'stue' (inside the living room – also on
 *           master), 'hus' (stue → gang → bad → gang → soverom) and 'trapp' (gang → down the stair → kjeller-gang;
 *           a level change re-renders the sun's map once, §4.6), the last two only where the house exists.
 *   check   (visibility only) for many poses – every room's centre in 8 directions at three pitches, both sides of
 *           every door, the stair, outside – with every door shut and then every door open: a render with the
 *           culling on, one with everything shown (vis.setEnabled(false)) and the culled one again; any pixel that
 *           differs between culled and full (beyond the culled/culled noise) is a visibility error. Failing poses
 *           are saved to --shots (default .shots/hus/<step>/check/) as <pose>-on.png / -off.png.
 *
 * Budgets (§4.13), checked with --compare=<json of a master run>: at most +20 % draw calls at the spawn in the living
 * room and in the hall (pos 2.6,0,3.2, yaw 90), at most 1 environment build per room change, 0 sun passes while
 * walking inside a level, first load at most 3 s longer. The check must find 0 failing poses.
 * Exit code: 0 ok, 1 a budget or the check failed, 2 the tool / page failed.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS, settingsInit, ROOT } from './lib/hus.mjs';

const { opt } = parseArgs();
const port = Number(opt.port ?? 5180);
const label = opt.label ?? 'run';
const width = Number(opt.w ?? 1280), height = Number(opt.h ?? 960);
const only = new Set((opt.only ?? 'load,frames,walk,check').split(',').map((s) => s.trim()));
const loads = Number(opt.loads ?? 2);
const nFrames = Number(opt.frames ?? 40);
const step = opt.step ?? 'y1';
const shotsDir = resolve(opt.shots ?? join(ROOT, '.shots', 'hus', step, 'check'));
const settings = { autoResolution: false, showHelpOnStart: false };
/** Extra URL parameters for every page (--vis=0 → &vis=0; --params=a=1&b=2). */
const extra = `${opt.vis === '0' ? '&vis=0' : ''}${opt.params ? `&${opt.params}` : ''}`;

/** Poses: feet x, y, z, yaw°, pitch° (yaw 0 = east/−z, 90 = north/−x, −90 = south/+x, 180 = west/+z). */
const POSES = {
  spawn: null, // the game's own start (?play=1 → the dining area)
  gang: [2.6, 0, 3.2, 90, 0], // §4.13
  'gang-sor': [2.6, 0, 3.2, -90, 0],
  'stue-tv': [3.0, 0, 9.0, 0, -5],
  kjokken: [4.5, 0, 2.0, 0, -10],
  bad: [1.5, 0, 1.3, 0, 0],
  soverom: [1.5, 0, 5.6, 180, 0],
  'kjeller-gang': [3.5, -2.55, 3.8, 90, 8],
  kjellerstue: [3.5, -2.55, 6.2, 180, 0],
  entre: [8.0, -2.85, 4.4, 90, 0],
  ute: [12.2, -2.87, 4.6, 85, -6],
  terrasse: [8.6, 0, 3.2, -90, -10],
};
const ROUTES = {
  stue: { start: [4.2, 0, 4.0], route: [[5.5, 2.2], [4.0, 7.5], [3.0, 9.5], [5.5, 9.0], [4.4, 4.2]] },
  hus: { house: true, start: [4.2, 0, 4.0], route: [[3.6, 3.95], [2.6, 3.9], [2.05, 2.9], [1.98, 2.27], [1.5, 1.3], [1.98, 2.27], [2.4, 3.6], [2.58, 4.48], [2.3, 5.4], [1.5, 5.7]] },
  trapp: { house: true, levelChange: true, start: [2.6, 0, 3.4], route: [[2.0, 2.71], [1.0, 2.71], [0.6, 3.3], [0.9, 3.95], [2.2, 3.95], [3.5, 3.8]] },
};
const poseList = opt.poses ? opt.poses.split(',').map((s) => s.trim()) : Object.keys(POSES);

const out = { label, port, when: new Date().toISOString(), w: width, h: height };
let failed = false;
const release = opt.lock === 'true' ? await acquireGpuLock({ label: `perf ${label}` }) : null;

async function withPage(path, fn, { quiet = true } = {}) {
  const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor({ ...opt, step }, 'perf') });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript(PAGE_HELPERS);
    await page.addInitScript(settingsInit(settings));
    const watch = watchPage(page, { quiet });
    const t0 = Date.now();
    await page.goto(pageUrl(path, port), { waitUntil: 'domcontentloaded' });
    const err = await waitReady(page, 240000);
    const readyMs = Date.now() - t0;
    if (err) throw new Error(`page error: ${err}`);
    return await fn(page, { readyMs, watch });
  } finally {
    await close();
  }
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// ---- page-side helpers (strings: evaluated in the page) -------------------------------------------------------------
const SETUP = `(() => {
  const g = window.__game;
  window.__hus.stop();
  const r = g.renderer;
  r.info.autoReset = false;
  // count the shadow-map renders that draw (any build of the game)
  const sm = r.shadowMap;
  if (!sm.__perfWrapped) {
    const inner = sm.render;
    window.__perf = { shadowPasses: 0 };
    sm.render = function (lights, scene, camera) {
      if (sm.enabled !== false && (sm.autoUpdate !== false || sm.needsUpdate) && lights && lights.length) window.__perf.shadowPasses++;
      return inner.call(this, lights, scene, camera);
    };
    sm.__perfWrapped = true;
  }
  return { hasVis: !!(g.home && g.home.visibility && g.home.visibility.enabled), house: !!(g.home && g.home.layout && g.home.layout.house && g.home.layout.house.rooms && g.home.layout.house.rooms.length > 1) };
})()`;

const FRAMES = `(async ({ poses, nFrames }) => {
  const g = window.__game, r = g.renderer, gl = r.getContext(), px = new Uint8Array(4), DEG = Math.PI / 180;
  const L = g.home.lighting, vis = g.home.visibility;
  const start = { p: g.player.position.clone(), yaw: g.player.yaw, pitch: g.player.pitch };
  const res = {};
  for (const [name, p] of poses) {
    if (p) g.player.teleport(g.player.position.clone().set(p[0], p[1], p[2]), p[3] * DEG, p[4] * DEG);
    else g.player.teleport(start.p, start.yaw, start.pitch);
    window.__hus.step(90);
    g._render();
    r.info.reset();
    g._render();
    const info = { calls: r.info.render.calls, triangles: r.info.render.triangles };
    const cpu = [], gpu = [];
    for (let i = 0; i < nFrames; i++) {
      const t0 = performance.now();
      window.__hus.step(1);
      cpu.push(performance.now() - t0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t1 = performance.now();
      g._render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gpu.push(performance.now() - t1);
      await new Promise((ok) => setTimeout(ok, 0));
    }
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
    res[name] = {
      ...info, cpuMs: med(cpu), frameMs: med(gpu), room: g.roomId ?? null,
      feet: g.player.position.toArray().map((v) => +v.toFixed(2)),
      scale: g._dyn ? g._dyn.scale : 1, pixelRatio: r.getPixelRatio(),
      vis: vis && vis.stats ? { active: vis.stats.active, seen: vis.stats.seen, surfaces: vis.stats.surfaces, outside: vis.stats.outside, hidden: vis.stats.hidden, items: vis.stats.items, ms: +(vis.stats.ms || 0).toFixed(3) } : null,
    };
  }
  res.__stats = { envBuilds: L && L.stats ? L.stats.envBuilds ?? null : null, sunPasses: L && L.stats ? L.stats.sunPasses ?? null : null, shadowPasses: window.__perf.shadowPasses };
  return res;
})`;

const WALK = `(async ({ route, start, h, maxS }) => {
  const g = window.__game, P = g.player, keys = g.input.keys, L = g.home.lighting;
  const st = () => ({ env: L && L.stats ? L.stats.envBuilds || 0 : 0, sun: L && L.stats ? L.stats.sunPasses || 0 : 0, shadow: window.__perf.shadowPasses });
  P.teleport(P.position.clone().set(...start), Math.atan2(-(route[0][0] - start[0]), -(route[0][1] - start[2])), 0);
  // settle where we stand (the first room, its environment and shadow maps), then count
  for (let i = 0; i < 90; i++) { window.__hus.step(1, h, { render: false }); }
  g._render(); g._render();
  const s0 = st();
  const rooms = [g.roomId ?? '-'];
  let frames = 0, reached = 0;
  const perLeg = [];
  for (const target of route) {
    const l0 = st();
    keys.add('KeyW');
    const maxFrames = Math.ceil(maxS / h);
    let ok = false, f = 0;
    while (f < maxFrames) {
      const dx = target[0] - P.position.x, dz = target[1] - P.position.z;
      if (Math.hypot(dx, dz) < 0.2) { ok = true; break; }
      P.yaw = Math.atan2(-dx, -dz);
      g.time += h;
      g.input.update(h);
      P.update(h);
      g.editor && g.editor.update(h);
      g._updateRoom();
      g.home.update && g.home.update(h, g.time, { roomId: g.roomId, playerPosition: P.position, camera: g.camera, player: P, inputBlocked: g._blocks.size > 0 });
      g.hud.update(h);
      g._render();
      if ((g.roomId ?? '-') !== rooms[rooms.length - 1]) rooms.push(g.roomId ?? '-');
      f++;
      if (f % 30 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    keys.delete('KeyW');
    frames += f;
    if (ok) reached++;
    const l1 = st();
    perLeg.push({ target, ok, frames: f, env: l1.env - l0.env, sun: l1.sun - l0.sun, shadow: l1.shadow - l0.shadow, room: g.roomId ?? '-' });
    if (!ok) break;
  }
  const s1 = st();
  return { rooms, roomChanges: rooms.length - 1, frames, reached, legs: route.length, envBuilds: s1.env - s0.env, sunPasses: s1.sun - s0.sun, shadowPasses: s1.shadow - s0.shadow, perLeg, hasSunStat: !!(L && L.stats && 'sunPasses' in L.stats) || s1.sun > 0 };
})`;

const CHECK = `(async ({ doorsOpen, extra, save }) => {
  const g = window.__game, r = g.renderer, gl = r.getContext(), DEG = Math.PI / 180;
  const home = g.home, vis = home.visibility, h = home.layout.house;
  for (const d of home.doors || []) d.door && d.door.setOpen && d.door.setOpen(doorsOpen, { instant: true });
  const W = r.domElement.width, H = r.domElement.height;
  const read = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
  const diff = (a, b) => { let n = 0, big = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d > 6) n++; if (d > 24) big++; } return { n, big }; };
  const poses = [];
  for (const rm of h.rooms) {
    if (rm.hud || !rm.polygon || rm.polygon.length < 3) continue;
    // a point well inside the room: the centroid, or the middle of its largest rectangle when the centroid is outside
    let cx = rm.centroid.x, cz = rm.centroid.y;
    if (!rm.contains(cx, cz)) { cx = (rm.bounds.minX + rm.bounds.maxX) / 2; cz = (rm.bounds.minZ + rm.bounds.maxZ) / 2; }
    if (!rm.contains(cx, cz)) continue;
    for (let yaw = 0; yaw < 360; yaw += 45) for (const pitch of [0, -35, 25]) poses.push({ name: rm.id + '@' + yaw + '/' + pitch, p: [cx, rm.floorY, cz, yaw, pitch] });
  }
  for (const d of h.doors || h.openings.filter((o) => o.door)) {
    const c = d.center, n = d.normal;
    if (!c || !n) continue;
    const yawIn = Math.atan2(-n.x, -n.z) / DEG; // facing into the owner room
    for (const s of [0.6, -0.7]) {
      const x = c.x + n.x * s, z = c.z + n.z * s;
      const yaw = s > 0 ? yawIn + 180 : yawIn;
      for (const pitch of [0, -20]) poses.push({ name: d.id + (s > 0 ? ':in' : ':out') + '/' + pitch, p: [x, d.floorY, z, yaw, pitch] });
    }
  }
  for (const e of extra) poses.push(e);
  const fails = [];
  let worstNoise = 0, n = 0;
  for (const ps of poses) {
    const p = ps.p;
    g.player.teleport(g.player.position.clone().set(p[0], p[1], p[2]), p[3] * DEG, p[4] * DEG);
    window.__hus.step(3, 1 / 60, { render: false });
    g._render();
    g._render();
    const A = read();
    const stats = { seen: vis.stats.seen, surfaces: vis.stats.surfaces, outside: vis.stats.outside, cells: vis.stats.cells, hidden: vis.stats.hidden, items: vis.stats.items };
    vis.setEnabled(false);
    g._render();
    const B = read();
    const on = () => {
      vis.setEnabled(true);
      vis.update(0, { camera: g.camera, player: g.player, playerPosition: g.player.position });
      g._render();
    };
    on();
    const C = read();
    const noise = diff(A, C), err = diff(C, B);
    worstNoise = Math.max(worstNoise, noise.n);
    n++;
    if (err.n > noise.n + 4) {
      // which hidden object makes the difference: show one at a time and see how many pixels it gives back
      const culprits = [];
      for (const hdn of vis.hiddenObjects()) {
        hdn.show();
        g._render();
        const D = read();
        hdn.hide();
        const left = diff(D, B);
        if (left.n < err.n) culprits.push({ name: hdn.name, kind: hdn.kind, gives: err.n - left.n });
      }
      culprits.sort((a, b) => b.gives - a.gives);
      stats.culprits = culprits.slice(0, 6);
      // the two images of a failing pose (rendered again: a canvas is only readable right after its render)
      let imgOn = null, imgOff = null;
      if (save) {
        vis.setEnabled(false);
        g._render();
        imgOff = r.domElement.toDataURL('image/png');
        on();
        imgOn = r.domElement.toDataURL('image/png');
      }
      fails.push({ name: ps.name, pose: p, px: err.n, big: err.big, noise: noise.n, stats, on: imgOn, off: imgOff });
    }
    if (n % 10 === 0) await new Promise((ok) => setTimeout(ok, 0));
  }
  return { poses: n, worstNoise, fails };
})`;

try {
  // ---- load ---------------------------------------------------------------------------------------------------------
  if (only.has('load')) {
    const times = [];
    for (let i = 0; i < loads; i++) {
      const ms = await withPage(`/?play=1&nohelp=1${extra}`, async (page, { readyMs }) => readyMs);
      times.push(ms);
      console.log(`[load ${i + 1}/${loads}] ${(ms / 1000).toFixed(1)} s to ready`);
    }
    out.load = { times, medianMs: median(times) };
  }

  // ---- frames -------------------------------------------------------------------------------------------------------
  if (only.has('frames')) {
    await withPage(`/?play=1&nowarm=1&nohelp=1${extra}`, async (page) => {
      const env = await page.evaluate(SETUP);
      out.house = env.house;
      out.visibility = env.hasVis;
      const poses = poseList.filter((k) => k in POSES && (env.house || !POSES[k] || POSES[k][1] === 0)).map((k) => [k, POSES[k]]);
      const res = await page.evaluate(`${FRAMES}(${JSON.stringify({ poses, nFrames })})`);
      out.stats = res.__stats;
      delete res.__stats;
      out.frames = res;
      console.log(`\n[frames] ${label}${env.hasVis ? ' (visibility on)' : ''}`);
      console.log('  pose            calls   triangles  cpu ms  frame ms  room              hidden/items');
      for (const [k, v] of Object.entries(res)) {
        console.log(`  ${k.padEnd(14)} ${String(v.calls).padStart(6)} ${String(v.triangles).padStart(11)} ${String(v.cpuMs).padStart(7)} ${String(v.frameMs).padStart(9)}  ${String(v.room ?? '-').padEnd(16)} ${v.vis ? `${v.vis.hidden}/${v.vis.items}` : ''}`);
      }
    });
  }

  // ---- walk ---------------------------------------------------------------------------------------------------------
  if (only.has('walk')) {
    out.walk = {};
    await withPage(`/?play=1&nowarm=1&nohelp=1&doors=open${extra}`, async (page) => {
      const env = await page.evaluate(SETUP);
      for (const [name, R] of Object.entries(ROUTES)) {
        if (R.house && !env.house) continue;
        const w = await page.evaluate(`${WALK}(${JSON.stringify({ route: R.route, start: R.start, h: 1 / 60, maxS: 25 })})`);
        w.levelChange = !!R.levelChange;
        out.walk[name] = w;
        console.log(`\n[walk ${name}] rooms ${w.rooms.join(' → ')}  ${w.reached}/${w.legs} legs, ${w.frames} frames`);
        console.log(`  room changes ${w.roomChanges}, env builds ${w.envBuilds}, sun passes ${w.hasSunStat ? w.sunPasses : 'n/a'}, shadow-map renders ${w.shadowPasses}`);
      }
    });
  }

  // ---- check --------------------------------------------------------------------------------------------------------
  if (only.has('check')) {
    await withPage('/?play=1&nowarm=1&nohelp=1', async (page) => {
      const env = await page.evaluate(SETUP);
      if (!env.hasVis) {
        console.log('\n[check] no visibility module on this page – skipped');
        return;
      }
      const extra = [
        { name: 'trapp-topp', p: [1.9, 0, 2.9, 90, -45] },
        { name: 'trapp-midt', p: [0.9, -1.2, 3.3, -90, 0] },
        { name: 'trapp-fra-kjeller', p: [3.4, -2.55, 3.5, 90, 8] },
        { name: 'trapp-opp', p: [2.4, -2.55, 3.9, 90, 40] },
        { name: 'stue-mot-gang', p: [3.6, 0, 3.9, 90, -20] },
        { name: 'forplass', p: [12.2, -2.87, 4.6, 85, -6] },
        { name: 'forplass-opp', p: [12.0, -2.87, 2.0, 60, 25] },
        { name: 'terrasse', p: [8.6, 0, 3.2, -90, -10] },
        { name: 'terrasse-ned', p: [9.8, 0, 5.0, -90, -50] },
        { name: 'terrasse-hus', p: [9.6, 0, 5.0, 90, 0] },
        { name: 'hage-vest', p: [5.0, -2.95, 15.0, 180, 10] },
        { name: 'hage-vest-hus', p: [5.0, -2.95, 15.0, 0, 15] },
      ];
      out.check = {};
      for (const doorsOpen of [false, true]) {
        const key = doorsOpen ? 'open' : 'closed';
        const res = await page.evaluate(`${CHECK}(${JSON.stringify({ doorsOpen, extra, save: true })})`);
        mkdirSync(shotsDir, { recursive: true });
        for (const f of res.fails) {
          const base = join(shotsDir, `${key}-${f.name.replace(/[^\w.-]+/g, '_')}`);
          if (f.on) writeFileSync(`${base}-on.png`, Buffer.from(f.on.split(',')[1], 'base64'));
          if (f.off) writeFileSync(`${base}-off.png`, Buffer.from(f.off.split(',')[1], 'base64'));
          delete f.on;
          delete f.off;
        }
        out.check[key] = res;
        console.log(`\n[check doors ${key}] ${res.poses} poses, ${res.fails.length} with hidden pixels (worst culled/culled noise ${res.worstNoise} px)`);
        for (const f of res.fails.slice(0, 40)) console.log(`  FAIL ${f.name}  ${f.px} px (${f.big} strong, noise ${f.noise})  seen ${JSON.stringify(f.stats.seen)} cells ${JSON.stringify(f.stats.cells)}
       culprits ${(f.stats.culprits || []).map((c) => `${c.kind} ${c.name} (${c.gives} px)`).join('; ') || '-'}`);
        if (res.fails.length) failed = true;
      }
    });
  }

  // ---- budgets ------------------------------------------------------------------------------------------------------
  if (opt.compare) {
    const ref = JSON.parse(readFileSync(resolve(opt.compare), 'utf8'));
    const rows = [];
    const budget = (name, ok, detail) => {
      rows.push({ name, ok, detail });
      if (!ok) failed = true;
    };
    for (const k of ['spawn', 'gang']) {
      const a = out.frames?.[k], b = ref.frames?.[k];
      if (a && b) budget(`draw calls ${k} ≤ +20 %`, a.calls <= b.calls * 1.2 + 1e-9, `${a.calls} vs ${b.calls} (${(((a.calls - b.calls) / b.calls) * 100).toFixed(0)} %)`);
    }
    const spawnRef = ref.frames?.spawn;
    if (spawnRef && out.frames?.gang) rows.push({ name: 'draw calls gang vs master spawn (info)', ok: true, detail: `${out.frames.gang.calls} vs ${spawnRef.calls}` });
    for (const [k, w] of Object.entries(out.walk || {})) {
      if (w.roomChanges) budget(`env builds per room change (${k}) ≤ 1`, w.envBuilds <= w.roomChanges, `${w.envBuilds} builds / ${w.roomChanges} changes`);
      if (!w.levelChange) budget(`sun passes walking (${k}) = 0`, (w.hasSunStat ? w.sunPasses : 0) === 0, `${w.hasSunStat ? w.sunPasses : 'n/a'} (shadow-map renders ${w.shadowPasses})`);
    }
    if (out.load && ref.load) budget('first load ≤ +3 s', out.load.medianMs <= ref.load.medianMs + 3000, `${(out.load.medianMs / 1000).toFixed(1)} s vs ${(ref.load.medianMs / 1000).toFixed(1)} s`);
    out.budgets = rows;
    console.log(`\n[budgets] ${label} vs ${ref.label}`);
    for (const r of rows) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
    if (out.frames && ref.frames) {
      console.log('\n  pose            calls (ref)        frame ms (ref)');
      for (const [k, v] of Object.entries(out.frames)) {
        const b = ref.frames[k];
        console.log(`  ${k.padEnd(14)} ${String(v.calls).padStart(5)} (${b ? String(b.calls).padStart(5) : '    -'})     ${String(v.frameMs).padStart(6)} (${b ? String(b.frameMs).padStart(6) : '     -'})`);
      }
    }
  }
  if (opt.out) {
    mkdirSync(resolve(opt.out, '..'), { recursive: true });
    writeFileSync(resolve(opt.out), JSON.stringify(out, null, 1));
    console.log(`\nsaved ${resolve(opt.out)}`);
  }
} catch (err) {
  console.error(`[perf] ${err.stack ?? err}`);
  process.exitCode = 2;
} finally {
  release?.();
}
if (!process.exitCode && failed) process.exitCode = 1;
