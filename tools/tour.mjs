#!/usr/bin/env node
/**
 * Walking test in the browser (notes/hele-huset-design.md §7.4): loads /?play=1&nowarm=1&nohelp=1&doors=open on a test
 * server, stops the game's frame loop and walks a route with fixed steps – each step: steer the player toward the next
 * waypoint, hold W (and Shift with --run), input.update → player.update(h) → editor.update → game._updateRoom() →
 * home.update(h, time, state) → hud.update – with real physics and collision.
 *
 *   node tools/tour.mjs --port=525N --tour=<name> [--hz=60] [--run] [--doors=open|closed|<ids>] [--shots=<dir>]
 *   node tools/tour.mjs --port=525N --start=x,y,z --route="x,z;x,z;…" [--expect-rooms=a,b,…] [--expect-names=…]
 *   node tools/tour.mjs --list
 *     --tour           a route from TOURS below (start, waypoints, expected rooms / banner names)
 *     --start --route  an ad-hoc route (feet start x,y,z; waypoints x,z); --yaw=deg start heading (default: toward the
 *                      first waypoint)
 *     --hz             fixed step rate (30, 60, 144 …; default 60)
 *     --run            hold Shift (run speed)
 *     --furniture=solid  the furniture blocks (Innstillinger «Fysisk person»; default: the game's default, ghost)
 *     --expect-rooms   expected room sequence (game.roomId, consecutive repeats collapsed, '-' = outside every room)
 *     --expect-names   expected banner texts (.kv-room__name), in the order they are shown
 *     --expect-eyebrows expected eyebrow texts (.kv-room__eyebrow) at those banners
 *     --shots=<dir>    a 1280×960 screenshot at every waypoint (<dir>/<tour>-<n>.png, HUD visible)
 *     --leg-s=25       give up a leg after this many simulated seconds (stuck)
 *     --lock / --pidfile / --step-name   GPU lock and browser PID file, as in tools/shot.mjs
 *
 * Reported (and checked): the room sequence and the banners against the expectation, every leg reached, no respawn
 * toast, no 'land' event faster than 1.5 m/s, share of frames in the air (< 2 %), the largest |Δy| in one frame, the
 * walking speed per leg (median / lowest / highest; the first 0.5 s of the tour – accelerating – left out) and the time
 * per leg.
 * Exit codes: 0 ok, 1 an expectation failed, 2 the page or the tool failed.
 *
 * Tours marked `draft` use coordinates from the plan for parts of the house that are not built yet: the step that
 * builds them (8, 22, 26) corrects the waypoints and expectations.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS, settingsInit } from './lib/hus.mjs';

/** '-' in a room sequence = outside every room (game.roomId null). */
const TOURS = {
  // steg 5 (M1): over the terrace door's threshold onto the deck and back (the terrace stair has no collision yet)
  terrasse: {
    start: [5.6, 0, 5.9],
    route: [[6.5, 5.89], [7.5, 5.89], [8.6, 3.2], [7.5, 5.89], [6.0, 5.89]],
    rooms: ['stue-kjokken', '-', 'stue-kjokken'],
    names: ['Stue/kjøkken'],
  },
  // steg 5 / 8: through door-gang into the hall and back (until step 8 the hall is the small stub behind the door and
  // the doorway has no floor – the capsule sinks a few centimetres there)
  'gang-terskel': {
    start: [4.2, 0, 4.0],
    route: [[3.6, 3.95], [2.6, 3.95], [3.6, 3.95], [4.4, 4.0]],
    rooms: ['stue-kjokken', '-', 'stue-kjokken'],
    names: ['Stue/kjøkken'],
  },
  // steg 8: stua → gangen → badet
  'stua-bad': {
    draft: true,
    start: [4.2, 0, 4.0],
    route: [[3.6, 3.95], [2.6, 3.9], [2.05, 2.9], [1.98, 2.27], [1.5, 1.3]],
    rooms: ['stue-kjokken', 'gang', 'bad'],
    names: ['Stue/kjøkken', 'Gang', 'Bad'],
    eyebrows: ['1. etasje', '1. etasje', '1. etasje'],
  },
  // steg 8: stua → gangen → soverommet
  'stua-soverom': {
    draft: true,
    start: [4.2, 0, 4.0],
    route: [[3.6, 3.95], [2.6, 3.95], [2.58, 4.48], [2.3, 5.4], [1.5, 5.7]],
    rooms: ['stue-kjokken', 'gang', 'soverom'],
    names: ['Stue/kjøkken', 'Gang', 'Soverom'],
    eyebrows: ['1. etasje', '1. etasje', '1. etasje'],
  },
  // steg 22: stua → gangen → trappa → kjellergangen (D4: top step edge x 1.50 on the east side, down toward north,
  // winders round the core x 1.20–1.50 · z 3.10–3.48, bottom edge x 1.60 on the west side going south)
  trapp: {
    draft: true,
    start: [4.2, 0, 4.0],
    route: [[3.6, 3.95], [2.6, 3.4], [2.0, 2.71], [1.0, 2.71], [0.6, 3.3], [0.9, 3.95], [2.2, 3.95], [3.5, 3.8]],
    rooms: ['stue-kjokken', 'gang', 'trapp', 'kjeller-gang'],
    names: ['Stue/kjøkken', 'Gang', 'Trapp', 'Gang (kjeller)'],
  },
  // steg 26: ute → ytterdøra → entréen → gangen → trappa → stua (§3.6: start 12.0, −2.87, 4.6; the door's swing
  // x 8.74–9.66 · z 3.88–4.80)
  'ute-inn': {
    draft: true,
    start: [12.0, -2.87, 4.6],
    route: [[10.2, 4.34], [8.0, 4.4], [6.6, 4.4], [5.0, 4.4], [3.5, 3.8], [2.2, 3.95], [0.9, 3.95], [0.6, 3.3], [1.0, 2.71], [2.0, 2.71], [2.6, 3.4], [3.6, 3.95], [4.4, 4.0]],
    rooms: ['-', 'entre-kjeller', 'kjeller-gang', 'trapp', 'gang', 'stue-kjokken'],
  },
};

const { opt } = parseArgs();
if (opt.list === 'true') {
  for (const [name, t] of Object.entries(TOURS)) console.log(`${name.padEnd(14)} ${t.draft ? '(draft) ' : ''}start ${t.start.join(',')} · ${t.route.length} waypoints · rooms ${(t.rooms || []).join(' → ')}`);
  process.exit(0);
}
const listOf = (s) => (s == null ? null : s.split(',').map((v) => v.trim()));
let tour;
if (opt.tour) {
  tour = TOURS[opt.tour];
  if (!tour) {
    console.error(`[tour] unknown tour "${opt.tour}" – known: ${Object.keys(TOURS).join(', ')}`);
    process.exit(2);
  }
  if (tour.draft) console.log(`[tour] "${opt.tour}" is a draft (coordinates from the plan, not checked against the built house yet)`);
} else if (opt.start && opt.route) {
  tour = { start: opt.start.split(',').map(Number), route: opt.route.split(';').filter(Boolean).map((p) => p.split(',').map(Number)) };
} else {
  console.error('usage: node tools/tour.mjs --port=525N --tour=<name> | --start=x,y,z --route="x,z;x,z" [--hz=60] [--run] [--expect-rooms=] [--shots=dir] (--list)');
  process.exit(2);
}
const name = opt.tour ?? 'route';
const expectRooms = listOf(opt['expect-rooms']) ?? tour.rooms ?? null;
const expectNames = listOf(opt['expect-names']) ?? tour.names ?? null;
const expectEyebrows = listOf(opt['expect-eyebrows']) ?? tour.eyebrows ?? null;
const hz = Number(opt.hz ?? 60);
const legS = Number(opt['leg-s'] ?? 25);

const qs = ['play=1', 'nowarm=1', 'nohelp=1', `doors=${encodeURIComponent(opt.doors ?? 'open')}`];
const release = opt.lock === 'true' ? await acquireGpuLock({ label: `tour ${name}` }) : null;
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor({ ...opt, step: opt['step-name'] ?? opt.step }, 'tour') });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  await page.addInitScript(PAGE_HELPERS);
  await page.addInitScript(settingsInit({ autoResolution: false, physicalBody: opt.furniture === 'solid', showHelpOnStart: false }));
  const watch = watchPage(page, { quiet: true });
  await page.goto(pageUrl(`/?${qs.join('&')}`, opt.port ?? 5180), { waitUntil: 'domcontentloaded' });
  const err = await waitReady(page);
  if (err) throw new Error(`page error: ${err}`);

  // set up: stop the loop, teleport to the start, listen to the game's events
  await page.evaluate(({ start, first, yawDeg }) => {
    const g = window.__game;
    window.__hus.stop();
    const p = g.player.position.clone().set(...start);
    const yaw = yawDeg != null ? (yawDeg * Math.PI) / 180 : Math.atan2(-(first[0] - start[0]), -(first[1] - start[2]));
    g.player.teleport(p, yaw, 0);
    const T = (window.__tour = { events: [], rooms: [], banners: [], frame: 0 });
    const on = (n) => g.events.on(n, (e) => T.events.push({ n, frame: T.frame, e: e ? JSON.parse(JSON.stringify(e, (k, v) => (v && v.isVector3 ? [v.x, v.y, v.z] : v))) : null }));
    for (const n of ['land', 'toast', 'room', 'jump']) on(n);
    const roomEl = document.querySelector('.kv-room__name'), browEl = document.querySelector('.kv-room__eyebrow');
    T.readBanner = () => ({ name: roomEl?.textContent || null, eyebrow: browEl && !browEl.hidden ? browEl.textContent : null });
    // the banner shown when the game started, then every hud.showRoom call (with the texts it put on the screen)
    const atStart = T.readBanner();
    if (atStart.name) T.banners.push(atStart);
    const show = g.hud.showRoom.bind(g.hud);
    g.hud.showRoom = (...a) => {
      show(...a);
      T.banners.push(T.readBanner());
    };
    T.roomId = undefined;
  }, { start: tour.start, first: tour.route[0], yawDeg: opt.yaw != null ? Number(opt.yaw) : null });

  const legs = [];
  for (let n = 0; n < tour.route.length; n++) {
    const leg = await page.evaluate(({ target, h, maxS, run, skip }) => {
      const g = window.__game, T = window.__tour, P = g.player, keys = g.input.keys;
      const trace = [];
      const start = P.position.clone();
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
        g.time += h;
        g.input.update(h);
        P.update(h);
        g.editor?.update(h);
        g._updateRoom();
        g.home.update?.(h, g.time, { roomId: g.roomId, playerPosition: P.position, camera: g.camera, player: P, inputBlocked: g._blocks.size > 0 });
        g.hud.update(h);
        T.frame++;
        frames++;
        if (!P.onGround) air++;
        maxDy = Math.max(maxDy, Math.abs(P.position.y - y0));
        const speed = Math.hypot(P.position.x - x0, P.position.z - z0) / h;
        trace.push([+(frames * h).toFixed(4), +speed.toFixed(4), +P.position.y.toFixed(4)]);
        if (g.roomId !== T.roomId) {
          T.roomId = g.roomId;
          T.rooms.push(g.roomId ?? '-');
        }
      }
      keys.delete('KeyW');
      keys.delete('ShiftLeft');
      g._render();
      // walking speed once up to speed (the first 0.5 s of the tour accelerate from standing)
      const steady = trace.filter((t) => t[0] > skip).map((t) => t[1]).sort((a, b) => a - b);
      const med = steady.length ? steady[Math.floor(steady.length / 2)] : null;
      return {
        target, reached, seconds: +(frames * h).toFixed(3), frames, air, maxDy: +maxDy.toFixed(4),
        from: [start.x, start.y, start.z].map((v) => +v.toFixed(3)),
        to: [P.position.x, P.position.y, P.position.z].map((v) => +v.toFixed(3)),
        speed: { median: med != null ? +med.toFixed(3) : null, min: steady.length ? +steady[0].toFixed(3) : null, max: steady.length ? +steady[steady.length - 1].toFixed(3) : null },
      };
    }, { target: tour.route[n], h: 1 / hz, maxS: legS, run: opt.run === 'true', skip: n === 0 ? 0.5 : 0 });
    legs.push(leg);
    console.log(`${leg.reached ? 'leg ' : 'STUCK'} ${n + 1}/${tour.route.length} → ${leg.target.join(',')}  ${leg.seconds} s  at ${leg.to.join(',')}  speed med ${leg.speed.median} min ${leg.speed.min}  air ${leg.air}/${leg.frames}  max|Δy| ${leg.maxDy}`);
    if (opt.shots) {
      mkdirSync(opt.shots, { recursive: true });
      const out = join(opt.shots, `${name}-${n + 1}.png`);
      await page.waitForTimeout(80);
      await page.screenshot({ path: out });
      console.log(`  saved ${out}`);
    }
    if (!leg.reached) break;
  }

  const T = await page.evaluate(() => ({ rooms: window.__tour.rooms, banners: window.__tour.banners, events: window.__tour.events }));
  const collapse = (a) => a.filter((v, i) => i === 0 || v !== a[i - 1]);
  const rooms = collapse(T.rooms);
  const lands = T.events.filter((e) => e.n === 'land');
  const hardLands = lands.filter((e) => (e.e?.speed ?? 0) > 1.5);
  const toasts = T.events.filter((e) => e.n === 'toast');
  const frames = legs.reduce((s, l) => s + l.frames, 0);
  const air = legs.reduce((s, l) => s + l.air, 0);
  const fails = [];
  if (legs.some((l) => !l.reached)) fails.push('a waypoint was not reached');
  if (expectRooms && rooms.join(',') !== expectRooms.join(',')) fails.push(`rooms ${rooms.join(' → ')} ≠ expected ${expectRooms.join(' → ')}`);
  if (expectNames && T.banners.map((b) => b.name).join(',') !== expectNames.join(',')) fails.push(`banners ${T.banners.map((b) => b.name).join(', ')} ≠ expected ${expectNames.join(', ')}`);
  if (expectEyebrows && T.banners.map((b) => b.eyebrow ?? '').join(',') !== expectEyebrows.join(',')) fails.push(`eyebrows ${T.banners.map((b) => b.eyebrow ?? '').join(', ')} ≠ expected ${expectEyebrows.join(', ')}`);
  if (hardLands.length) fails.push(`${hardLands.length} landing(s) over 1.5 m/s (${hardLands.map((e) => e.e.speed.toFixed(2)).join(', ')})`);
  if (toasts.length) fails.push(`toast(s): ${toasts.map((e) => e.e?.text).join(' | ')}`);
  if (frames && air / frames >= 0.02) fails.push(`in the air ${((100 * air) / frames).toFixed(1)} % of the frames (≥ 2 %)`);
  console.log(`rooms ${rooms.join(' → ') || '-'}${expectRooms ? `  (expected ${expectRooms.join(' → ')})` : ''}`);
  console.log(`banners ${T.banners.map((b) => `${b.name}${b.eyebrow ? ` [${b.eyebrow}]` : ''}`).join(', ') || '-'}`);
  console.log(`lands ${lands.length}${lands.length ? ` (max ${Math.max(...lands.map((e) => e.e?.speed ?? 0)).toFixed(2)} m/s)` : ''} · air ${air}/${frames} frames · max|Δy| ${Math.max(0, ...legs.map((l) => l.maxDy))} · ${hz} Hz${opt.run === 'true' ? ' run' : ''}`);
  if (watch.errors) fails.push(`${watch.errors} console error(s) on the page`);
  if (fails.length) {
    for (const f of fails) console.log(`FAIL ${f}`);
    code = 1;
  } else console.log(`ok   tour ${name}`);
} catch (e) {
  console.error(`[tour] ${e.message}`);
  code = 2;
} finally {
  await close();
  release?.();
}
process.exit(code);
