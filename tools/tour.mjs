#!/usr/bin/env node
/**
 * Walking test in the browser (notes/hele-huset-design.md §7.4): loads /?play=1&nowarm=1&nohelp=1 (&doors=… &spawn=…)
 * on a test server, stops the game's frame loop and walks a route with fixed steps – each step: steer the player
 * toward the next waypoint, hold W (and Shift with --run), input.update → player.update(h) → editor.update →
 * game._updateRoom() → home.update(h, time, state) → hud.update – with real physics and collision. A door on the way
 * is opened like a player does it: look at it, the interaction system must target it (its HUD prompt is reported),
 * press E (interaction.interact), wait for the leaf.
 *
 *   node tools/tour.mjs --port=525N --tour=<name>[,<name>…|all] [--hz=60|30,60,144] [--run] [--doors=…] [--shots=<dir>]
 *   node tools/tour.mjs --port=525N --start=x,y,z --route="x,z;open:<door>;x,z;…" [--expect-rooms=a,b,…] [--expect-names=…]
 *   node tools/tour.mjs --list
 *     --tour           tours from tools/house-tests/_tours.mjs (start or spawn, route, expected rooms / banners), several
 *                      separated by commas, or `all`
 *     --start --route  an ad-hoc route (feet start x,y,z; waypoints x,z; `open:<door id>` opens a door); --yaw=deg start
 *                      heading (default: toward the first waypoint)
 *     --hz             fixed step rate (30, 60, 144 …; default 60); several separated by commas run the tour once per
 *                      rate, each in a fresh browser context (empty storage)
 *     --run            hold Shift (run speed)
 *     --furniture=solid  the furniture blocks (Innstillinger «Fysisk person»; default: the game's default, ghost)
 *     --doors          ?doors= for every tour (default: the tour's own `doors`, else open)
 *     --expect-rooms   expected room sequence (game.roomId, consecutive repeats collapsed, '-' = outside every room)
 *     --expect-names   expected banner texts (.kv-room__name), in the order they are shown
 *     --expect-eyebrows expected eyebrow texts (.kv-room__eyebrow) at those banners
 *     --shots=<dir>    a 1280×960 screenshot (HUD visible) at every waypoint, and before / after every door
 *                      (<dir>/<tour>-<nn>-<what>.png); with several rates only for the first one
 *     --leg-s=25       give up a leg after this many simulated seconds (stuck)
 *     --lock / --pidfile / --step-name   GPU lock and browser PID file, as in tools/shot.mjs
 *
 * A tour with `spawn` (ute-inn) is not teleported: the page is loaded with &spawn=<spawn> in a fresh context (nothing
 * saved), and where the game put the player is checked against `expectStart` (Game.startedFrom, the feet, the yaw, the
 * room). A tour with `resume` ends by writing the remembered position (LastPosition.flush), reloading the page with
 * &spawn=saved and checking that the game starts there again (Game.startedFrom 'saved', the feet within 0.3 m, the
 * room and its banner). The game's own loop stays stopped, but `game.running` is kept true while the tour steps, so
 * the game remembers the position as it does for a player (Game._recordPosition).
 *
 * Reported (and checked): the room sequence and the banners against the expectation, every leg reached, every door
 * targeted and opened, no respawn toast, no 'land' event faster than 1.5 m/s, share of frames in the air (< 2 %), the
 * largest |Δy| in one frame, the walking speed per leg (median / lowest / highest; the first 0.5 s of the tour –
 * accelerating – left out), the time per leg, and no console error on the page.
 * Exit codes: 0 ok, 1 an expectation failed, 2 the page or the tool failed.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS, settingsInit } from './lib/hus.mjs';
import { TOURS, ALL } from './house-tests/_tours.mjs';

const { opt } = parseArgs();
if (opt.list === 'true') {
  const step = (s) => (Array.isArray(s) ? '' : ` [open ${s.open}]`);
  for (const [name, t] of Object.entries(TOURS)) {
    const from = t.spawn ? `spawn=${t.spawn}` : `start ${t.start.join(',')}`;
    const doors = t.route.filter((s) => !Array.isArray(s)).map(step).join('');
    console.log(`${name.padEnd(14)} ${from} · ${t.route.filter(Array.isArray).length} waypoints${doors} · rooms ${(t.rooms || []).join(' → ')}${t.resume ? ' · resume' : ''}`);
  }
  process.exit(0);
}
const listOf = (s) => (s == null ? null : s.split(',').map((v) => v.trim()));
/** 'x,z' → [x, z]; 'open:<id>' → { open: id } */
const parseStep = (p) => (p.startsWith('open:') ? { open: p.slice(5).trim() } : p.split(',').map(Number));

/** @type {Array<[string, object]>} */
let runs;
if (opt.tour) {
  const names = opt.tour === 'all' ? ALL : listOf(opt.tour);
  const unknown = names.filter((n) => !TOURS[n]);
  if (unknown.length) {
    console.error(`[tour] unknown tour ${unknown.map((n) => `"${n}"`).join(', ')} – known: ${ALL.join(', ')}`);
    process.exit(2);
  }
  runs = names.map((n) => [n, TOURS[n]]);
} else if (opt.start && opt.route) {
  runs = [['route', { start: opt.start.split(',').map(Number), route: opt.route.split(';').filter(Boolean).map(parseStep) }]];
} else {
  console.error('usage: node tools/tour.mjs --port=525N --tour=<name>[,…|all] | --start=x,y,z --route="x,z;open:<door>;x,z" [--hz=60|30,60,144] [--run] [--expect-rooms=] [--shots=dir] (--list)');
  process.exit(2);
}
const rates = (opt.hz ?? '60').split(',').map(Number).filter((v) => v > 0);
const legS = Number(opt['leg-s'] ?? 25);
const port = opt.port ?? 5180;
const DEG = 180 / Math.PI;

/**
 * Page side (evaluated once per page after the game is ready): stops the loop, (optionally) teleports to the start,
 * hooks the events and the banner, and puts the stepping helpers on window.__tour.
 */
function setupPage({ start, first, yawDeg }) {
  const g = window.__game;
  const P = g.player;
  window.__hus.stop();
  // the loop stays stopped, but the game must think it runs: Game._recordPosition (the remembered position) and the
  // interaction only work while running
  g.running = true;
  const T = (window.__tour = { events: [], rooms: [], banners: [], frame: 0, roomId: undefined });
  const startedAt = { from: g.startedFrom ?? null, pos: [P.position.x, P.position.y, P.position.z], yawDeg: (P.yaw * 180) / Math.PI, room: g.roomId ?? null };
  if (start) {
    const p = P.position.clone().set(...start);
    const yaw = yawDeg != null ? (yawDeg * Math.PI) / 180 : Math.atan2(-(first[0] - start[0]), -(first[1] - start[2]));
    P.teleport(p, yaw, 0);
    // a teleport, and a fresh start for the banner: the first step names the start room at once (no hysteresis from
    // the old place), even when the game itself started in the same room
    g._roomFeet = null;
    g._placeKey = undefined;
    g._announcedRoom = undefined;
  }
  const on = (n) => g.events.on(n, (e) => T.events.push({ n, frame: T.frame, e: e ? JSON.parse(JSON.stringify(e, (k, v) => (v && v.isVector3 ? [v.x, v.y, v.z] : v))) : null }));
  for (const n of ['land', 'toast', 'room', 'jump', 'respawn']) on(n);
  const roomEl = document.querySelector('.kv-room__name'), browEl = document.querySelector('.kv-room__eyebrow');
  T.readBanner = () => ({ name: roomEl?.textContent || null, eyebrow: browEl && !browEl.hidden ? browEl.textContent : null });
  // the banner shown when the game started (not when the tour teleported away from it), then every hud.showRoom call
  const atStart = T.readBanner();
  if (atStart.name && !start) T.banners.push(atStart);
  const show = g.hud.showRoom.bind(g.hud);
  g.hud.showRoom = (...a) => {
    show(...a);
    T.banners.push(T.readBanner());
  };

  /** One fixed step of the game (as Game._frame does it, without the RAF and the audio). */
  T.step = (h) => {
    g.time += h;
    g.input.update(h);
    P.update(h);
    g.hud.setHeading?.(P.yaw);
    g.editor?.update(h);
    g._updateRoom();
    g.home.update?.(h, g.time, { roomId: g.roomId, playerPosition: P.position, camera: g.camera, player: P, inputBlocked: g._blocks.size > 0 });
    g.hud.update(h);
    T.frame++;
    if (g.roomId !== T.roomId) {
      T.roomId = g.roomId;
      T.rooms.push(g.roomId ?? '-');
    }
  };

  /** Walk to target [x, z]: steer every frame, hold W (and Shift). */
  T.walk = (target, h, maxS, run, skip) => {
    const keys = g.input.keys;
    const trace = [];
    const start0 = P.position.clone();
    let reached = false, frames = 0, air = 0, maxDy = 0;
    keys.add('KeyW');
    if (run) keys.add('ShiftLeft');
    const maxFrames = Math.ceil(maxS / h);
    while (frames < maxFrames) {
      const dx = target[0] - P.position.x, dz = target[1] - P.position.z;
      if (Math.hypot(dx, dz) < 0.2) {
        reached = true;
        break;
      }
      P.yaw = Math.atan2(-dx, -dz);
      const y0 = P.position.y, x0 = P.position.x, z0 = P.position.z;
      T.step(h);
      frames++;
      if (!P.onGround) air++;
      maxDy = Math.max(maxDy, Math.abs(P.position.y - y0));
      const speed = Math.hypot(P.position.x - x0, P.position.z - z0) / h;
      trace.push([+(frames * h).toFixed(4), +speed.toFixed(4)]);
    }
    keys.delete('KeyW');
    keys.delete('ShiftLeft');
    g._render();
    const steady = trace.filter((t) => t[0] > skip).map((t) => t[1]).sort((a, b) => a - b);
    const med = steady.length ? steady[Math.floor(steady.length / 2)] : null;
    return {
      kind: 'walk', target, reached, seconds: +(frames * h).toFixed(3), frames, air, maxDy: +maxDy.toFixed(4),
      from: [start0.x, start0.y, start0.z].map((v) => +v.toFixed(3)),
      to: [P.position.x, P.position.y, P.position.z].map((v) => +v.toFixed(3)),
      room: g.roomId ?? '-',
      speed: { median: med != null ? +med.toFixed(3) : null, min: steady.length ? +steady[0].toFixed(3) : null, max: steady.length ? +steady[steady.length - 1].toFixed(3) : null },
    };
  };

  /** Stand still for s seconds (the player settles, doors move). */
  T.idle = (s, h) => {
    const n = Math.ceil(s / h);
    let air = 0;
    for (let i = 0; i < n; i++) {
      T.step(h);
      if (!P.onGround) air++;
    }
    return { frames: n, air };
  };

  /** Look at door `id` and ask the interaction system what it targets (centre of the screen, as with mouse look). */
  T.aim = (id, h) => {
    const d = (g.home.doors || []).find((x) => x.id === id);
    if (!d?.door) return { error: `no door ${id} in home.doors` };
    const settle = T.idle(0.25, h);
    const look = () => {
      const c = g.camera.position, t = d.door.position;
      const dx = t.x - c.x, dy = t.y - c.y, dz = t.z - c.z;
      P.yaw = Math.atan2(-dx, -dz);
      P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      return Math.hypot(dx, dy, dz);
    };
    look();
    T.step(h); // the camera follows the new heading
    const dist = look();
    P._placeCamera?.(0);
    g.camera.updateMatrixWorld(true);
    const hit = g.interaction.update(g.input, g.hud, true);
    g._render();
    const item = hit?.item ?? null;
    const prompt = item ? (typeof item.prompt === 'function' ? item.prompt() : item.prompt) : null;
    return { kind: 'aim', door: id, target: item?.id ?? null, prompt, distance: +dist.toFixed(2), open: d.door.isOpen, air: settle.air, frames: settle.frames + 1 };
  };

  /** Press E on what is targeted and wait (≤ maxS) until door `id` is fully open. */
  T.use = (id, h, maxS) => {
    const d = (g.home.doors || []).find((x) => x.id === id);
    const used = g.interaction.interact({ game: g });
    let frames = 0, air = 0;
    const max = Math.ceil(maxS / h);
    while (frames < max && d?.door && d.door.t < 1) {
      T.step(h);
      frames++;
      if (!P.onGround) air++;
    }
    // a few frames more: the open leaf's collider is in place and the player stands
    const more = T.idle(0.15, h);
    g.interaction.clear(g.hud);
    g._render();
    return { kind: 'open', door: id, used, opened: !!d?.door && d.door.t >= 1, isOpen: !!d?.door?.isOpen, blocked: !!d?.door?.blocked, seconds: +(frames * h).toFixed(3), frames: frames + more.frames, air: air + more.air };
  };

  /** Remember the position as the game does it, and write it now (LastPosition.flush, as on pagehide). */
  T.remember = (h) => {
    T.idle(0.3, h);
    g._recordPosition?.(g._levelId ?? null);
    const flushed = g.lastPosition?.flush?.() ?? false;
    let raw = null;
    try {
      raw = localStorage.getItem('interiorspillet.player.v1');
    } catch {
      /* storage blocked */
    }
    g.running = false; // no «leave the page?» question when the tour reloads
    return { flushed, raw, pos: [P.position.x, P.position.y, P.position.z], room: g.roomId ?? null };
  };
  return startedAt;
}

const fmt = (a) => a.map((v) => (Number.isFinite(v) ? +v.toFixed(3) : v)).join(',');

/**
 * One tour at one rate in a fresh browser context. Returns { name, hz, fails: string[], summary }.
 */
async function runTour(browser, name, tour, hz, { shots }) {
  const h = 1 / hz;
  const doors = opt.doors ?? (tour.doors === undefined ? 'open' : tour.doors);
  const qs = ['play=1', 'nowarm=1', 'nohelp=1'];
  if (doors) qs.push(`doors=${encodeURIComponent(doors)}`);
  if (tour.spawn) qs.push(`spawn=${tour.spawn}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const fails = [];
  const label = `${name} @ ${hz} Hz${opt.run === 'true' ? ' run' : ''}`;
  console.log(`\n▶ ${label}`);
  try {
    const page = await context.newPage();
    await page.addInitScript(PAGE_HELPERS);
    await page.addInitScript(settingsInit({ autoResolution: false, physicalBody: opt.furniture === 'solid', showHelpOnStart: false }));
    const watch = watchPage(page, { quiet: true });
    await page.goto(pageUrl(`/?${qs.join('&')}`, port), { waitUntil: 'domcontentloaded' });
    const err = await waitReady(page);
    if (err) throw new Error(`page error: ${err}`);
    const first = tour.route.find(Array.isArray);
    const startedAt = await page.evaluate(setupPage, { start: tour.spawn ? null : tour.start, first, yawDeg: opt.yaw != null ? Number(opt.yaw) : null });

    if (tour.expectStart) {
      const e = tour.expectStart;
      const dPos = Math.hypot(startedAt.pos[0] - e.pos[0], startedAt.pos[1] - e.pos[1], startedAt.pos[2] - e.pos[2]);
      const dYaw = Math.abs((((startedAt.yawDeg - e.yawDeg) % 360) + 540) % 360 - 180);
      console.log(`start ${startedAt.from} at ${fmt(startedAt.pos)} yaw ${startedAt.yawDeg.toFixed(1)}° room ${startedAt.room ?? '-'}  (expected ${e.from} at ${fmt(e.pos)} yaw ${e.yawDeg}°)`);
      if (startedAt.from !== e.from) fails.push(`started from ${startedAt.from} ≠ expected ${e.from} (empty saved position)`);
      if (dPos > 0.05) fails.push(`start position ${fmt(startedAt.pos)} is ${dPos.toFixed(2)} m from ${fmt(e.pos)}`);
      if (dYaw > 1) fails.push(`start yaw ${startedAt.yawDeg.toFixed(1)}° ≠ ${e.yawDeg}°`);
      if ((startedAt.room ?? null) !== (e.room ?? null)) fails.push(`start room ${startedAt.room ?? '-'} ≠ ${e.room ?? '-'}`);
    }
    const shot = async (what) => {
      if (!shots) return;
      mkdirSync(shots, { recursive: true });
      const out = join(shots, `${name}-${String(++shot.n).padStart(2, '0')}-${what}.png`);
      await page.waitForTimeout(60);
      await page.screenshot({ path: out });
      console.log(`  saved ${out}`);
    };
    shot.n = 0;
    await shot('start');

    const legs = [];
    let walked = 0;
    for (let n = 0; n < tour.route.length; n++) {
      const st = tour.route[n];
      const tag = `${n + 1}/${tour.route.length}`;
      if (Array.isArray(st)) {
        const leg = await page.evaluate(({ target, h, maxS, run, skip }) => window.__tour.walk(target, h, maxS, run, skip), { target: st, h, maxS: legS, run: opt.run === 'true', skip: walked === 0 ? 0.5 : 0 });
        walked++;
        legs.push(leg);
        console.log(`${leg.reached ? 'leg ' : 'STUCK'} ${tag} → ${leg.target.join(',')}  ${leg.seconds} s  at ${leg.to.join(',')} (${leg.room})  speed med ${leg.speed.median} min ${leg.speed.min}  air ${leg.air}/${leg.frames}  max|Δy| ${leg.maxDy}`);
        await shot(leg.room === '-' ? 'ute' : leg.room);
        if (!leg.reached) {
          fails.push(`waypoint ${tag} (${st.join(',')}) not reached – stuck at ${leg.to.join(',')}`);
          break;
        }
      } else if (st.open) {
        const aim = await page.evaluate(({ id, h }) => window.__tour.aim(id, h), { id: st.open, h });
        legs.push(aim);
        if (aim.error) {
          fails.push(aim.error);
          break;
        }
        console.log(`aim  ${tag} → ${st.open}  target ${aim.target ?? '-'}  «${aim.prompt ?? ''}»  ${aim.distance} m to the door${aim.open ? ' (already open)' : ''}`);
        await shot(`${st.open}-lukket`);
        if (aim.target !== st.open) {
          fails.push(`door ${st.open}: the interaction targets ${aim.target ?? 'nothing'} (prompt «${aim.prompt ?? ''}»)`);
          break;
        }
        if (aim.open) {
          console.log(`  ${st.open} is open already – not pressing E`);
          continue;
        }
        const use = await page.evaluate(({ id, h, maxS }) => window.__tour.use(id, h, maxS), { id: st.open, h, maxS: 3 });
        legs.push(use);
        console.log(`${use.opened ? 'open' : 'SHUT'} ${tag} → ${st.open}  ${use.used ? 'E pressed' : 'E did nothing'}  open after ${use.seconds} s${use.blocked ? ' (blocked by the player)' : ''}`);
        await shot(`${st.open}-apen`);
        if (!use.opened) {
          fails.push(`door ${st.open} did not open (E ${use.used ? 'pressed' : 'did nothing'}, isOpen ${use.isOpen}, blocked ${use.blocked})`);
          break;
        }
      }
    }

    // stand still at the end, as a player stopping: the last room must hold the HUD's settle time (0.4 s) to count
    if (!fails.length) legs.push({ kind: 'idle', ...(await page.evaluate((h) => window.__tour.idle(0.6, h), h)) });
    const T = await page.evaluate(() => ({ rooms: window.__tour.rooms, banners: window.__tour.banners, events: window.__tour.events }));
    const collapse = (a) => a.filter((v, i) => i === 0 || v !== a[i - 1]);
    const rooms = collapse(T.rooms);
    const lands = T.events.filter((e) => e.n === 'land');
    const hardLands = lands.filter((e) => (e.e?.speed ?? 0) > 1.5);
    const toasts = T.events.filter((e) => e.n === 'toast');
    const frames = legs.reduce((s, l) => s + (l.frames ?? 0), 0);
    const air = legs.reduce((s, l) => s + (l.air ?? 0), 0);
    const expectRooms = listOf(opt['expect-rooms']) ?? tour.rooms ?? null;
    const expectNames = listOf(opt['expect-names']) ?? tour.names ?? null;
    const expectEyebrows = listOf(opt['expect-eyebrows']) ?? tour.eyebrows ?? null;
    if (expectRooms && rooms.join(',') !== expectRooms.join(',')) fails.push(`rooms ${rooms.join(' → ')} ≠ expected ${expectRooms.join(' → ')}`);
    if (expectNames && T.banners.map((b) => b.name).join(',') !== expectNames.join(',')) fails.push(`banners ${T.banners.map((b) => b.name).join(', ')} ≠ expected ${expectNames.join(', ')}`);
    if (expectEyebrows && T.banners.map((b) => b.eyebrow ?? '').join(',') !== expectEyebrows.join(',')) fails.push(`eyebrows ${T.banners.map((b) => b.eyebrow ?? '').join(', ')} ≠ expected ${expectEyebrows.join(', ')}`);
    if (hardLands.length) fails.push(`${hardLands.length} landing(s) over 1.5 m/s (${hardLands.map((e) => e.e.speed.toFixed(2)).join(', ')})`);
    if (toasts.length) fails.push(`toast(s): ${toasts.map((e) => e.e?.text ?? e.e?.message ?? JSON.stringify(e.e)).join(' | ')}`);
    if (frames && air / frames >= 0.02) fails.push(`in the air ${((100 * air) / frames).toFixed(1)} % of the frames (≥ 2 %)`);
    const maxDy = Math.max(0, ...legs.map((l) => l.maxDy ?? 0));
    const secs = legs.reduce((s, l) => s + (l.seconds ?? 0), 0);
    console.log(`rooms ${rooms.join(' → ') || '-'}${expectRooms ? `  (expected ${expectRooms.join(' → ')})` : ''}`);
    console.log(`banners ${T.banners.map((b) => `${b.name}${b.eyebrow ? ` [${b.eyebrow}]` : ''}`).join(', ') || '-'}`);
    console.log(`lands ${lands.length}${lands.length ? ` (max ${Math.max(...lands.map((e) => e.e?.speed ?? 0)).toFixed(2)} m/s)` : ''} · air ${air}/${frames} frames · max|Δy| ${maxDy} · ${secs.toFixed(1)} s walked · ${hz} Hz${opt.run === 'true' ? ' run' : ''}`);

    // the next visit: the remembered position brings the player back here
    let resumed = null;
    if (tour.resume && !fails.length) {
      const mem = await page.evaluate((h) => window.__tour.remember(h), h);
      const saved = mem.raw ? JSON.parse(mem.raw) : null;
      console.log(`remembered ${saved ? `${fmt(saved.pos)} (${saved.roomId ?? '-'}, ${saved.levelId ?? '-'})` : 'nothing'}  flush ${mem.flushed}`);
      if (!saved) fails.push('no position was remembered (localStorage interiorspillet.player.v1 is empty)');
      else {
        const url = `/?${qs.filter((q) => !q.startsWith('spawn=')).concat('spawn=saved').join('&')}`;
        await page.goto(pageUrl(url, port), { waitUntil: 'domcontentloaded' });
        const err2 = await waitReady(page);
        if (err2) throw new Error(`page error after the reload: ${err2}`);
        resumed = await page.evaluate(() => {
          const g = window.__game, P = g.player;
          window.__hus.stop();
          return { from: g.startedFrom ?? null, pos: [P.position.x, P.position.y, P.position.z], room: g.roomId ?? null, banner: document.querySelector('.kv-room__name')?.textContent ?? null };
        });
        const d = Math.hypot(resumed.pos[0] - saved.pos[0], resumed.pos[1] - saved.pos[1], resumed.pos[2] - saved.pos[2]);
        console.log(`reload with spawn=saved: started from ${resumed.from} at ${fmt(resumed.pos)} (${d.toFixed(2)} m from the remembered spot), room ${resumed.room ?? '-'}, banner «${resumed.banner ?? ''}»`);
        await shot('lagret-posisjon');
        if (resumed.from !== 'saved') fails.push(`after the reload the game started from ${resumed.from}, not the saved position`);
        if (d > 0.3) fails.push(`after the reload the player stands ${d.toFixed(2)} m from the remembered spot`);
        if (tour.resume.room !== undefined && resumed.room !== tour.resume.room) fails.push(`after the reload the room is ${resumed.room ?? '-'} ≠ ${tour.resume.room}`);
        if (tour.resume.name && resumed.banner !== tour.resume.name) fails.push(`after the reload the banner is «${resumed.banner}» ≠ «${tour.resume.name}»`);
      }
    }
    if (watch.errors) fails.push(`${watch.errors} console error(s) on the page`);
    for (const f of fails) console.log(`FAIL ${f}`);
    if (!fails.length) console.log(`ok   tour ${label}`);
    return { name, hz, fails, summary: { rooms, banners: T.banners, air, frames, maxDy, seconds: +secs.toFixed(2), lands: lands.length, resumed } };
  } finally {
    await context.close().catch(() => {});
  }
}

const release = opt.lock === 'true' ? await acquireGpuLock({ label: `tour ${runs.map(([n]) => n).join(',')}` }) : null;
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor({ ...opt, step: opt['step-name'] ?? opt.step }, 'tour') });
let code = 0;
const results = [];
try {
  for (const [name, tour] of runs) {
    for (const [i, hz] of rates.entries()) {
      try {
        results.push(await runTour(browser, name, tour, hz, { shots: i === 0 ? opt.shots : null }));
      } catch (e) {
        console.error(`[tour] ${name} @ ${hz} Hz: ${e.message}`);
        results.push({ name, hz, fails: [`tool: ${e.message}`], error: true });
        code = 2;
      }
    }
  }
} finally {
  await close();
  release?.();
}
if (results.length > 1) {
  console.log('\n— tours');
  for (const r of results) console.log(`  ${r.fails.length ? 'FAIL' : 'ok  '} ${r.name.padEnd(14)} ${String(r.hz).padStart(3)} Hz${r.summary ? `  ${r.summary.seconds} s · air ${r.summary.air}/${r.summary.frames} · max|Δy| ${r.summary.maxDy}` : ''}${r.fails.length ? `  – ${r.fails[0]}` : ''}`);
}
if (code === 0 && results.some((r) => r.fails.length)) code = 1;
process.exit(code);
