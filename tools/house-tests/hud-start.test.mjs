#!/usr/bin/env node
/**
 * Node test for steg 9 + 26 (A3 + U2, notes/hele-huset-design.md §5.1 and §3.6, avstemming V32):
 *   node tools/house-tests/hud-start.test.mjs        (from the project root; exit code 1 on failure)
 *
 *   • home.rooms (houseRooms): one entry per room of layout.house.rooms, the living room «Stue/kjøkken», level names
 *     «1. etasje» / «Kjeller»; home.locate (createLocator): the HUD variant – the stair first – at the body centre,
 *     with the level, and the forecourt «Forplassen» / «Ute» outside (outdoorAreas; not the terrace deck above it);
 *   • spawnPoints: the dining area as before, the forecourt start (12.2, −2.87, 4.6), yaw 85°, pitch −6°;
 *   • LastPosition: validation, throttled writes, flush, blocked storage, read-only;
 *   • Game._updateRoom (on a stand-in game): pos 2.5,0,3.2 is «Gang» with eyebrow «1. etasje»; from the living room
 *     into the hall comes exactly one banner, 0.4 s after the room changed; a short gap in a doorway changes nothing;
 *     a teleport counts at once; outside the banner is «Forplassen» / «Ute» with roomId null; the stair's eyebrow is
 *     the level the body is on;
 *   • Game._placeAtStart (stand-in game, fake collision): the forecourt only once it can be stood on (else the dining
 *     area), the saved position first, «fresh» ignores it, ?pos= overrides, the first teleport is the reserve spawn.
 */
import { imp, check, section, near, done } from './_lib.mjs';

const THREE = await import('three');
const { layout } = await imp('src/home/layout.js');
const { houseRooms, outdoorAreas, createLocator, spawnPoints, BODY_CENTRE } = await imp('src/home/index.js');
const { LastPosition, parseLastPosition, LAST_POSITION_KEY } = await imp('src/core/LastPosition.js');
const { Game } = await imp('src/core/Game.js');

const DEG = Math.PI / 180;
const rooms = houseRooms(layout);
const outdoor = outdoorAreas(layout);
const locate = createLocator(layout, rooms, outdoor);
const at = (x, feetY, z, prev = null) => locate(x, feetY + BODY_CENTRE, z, { previousLevelId: prev });

section('home.rooms');
const ids = rooms.map((r) => r.id);
check('one entry per room of layout.house.rooms (with a plan)', rooms.length === layout.house.rooms.filter((r) => r.polygon.length >= 3).length && ids.length === new Set(ids).size, ids.join(','));
const living = rooms.find((r) => r.id === 'stue-kjokken');
check('the living room is «Stue/kjøkken» on «1. etasje»', living?.name === 'Stue/kjøkken' && living.levelName === '1. etasje' && living.levelId === 'hoved');
check('the stair is a hud room «Trappa»', rooms.find((r) => r.id === 'trapp')?.hud === true);
check('the basement rooms are on «Kjeller»', ['kjeller-gang', 'vaskerom', 'kjellerstue', 'entre-kjeller'].every((id) => rooms.find((r) => r.id === id)?.levelName === 'Kjeller'));
check('every entry has contains() and a Box3', rooms.every((r) => typeof r.contains === 'function' && r.box?.isBox3));
check('box covers the living room at body height (WindowPanel)', living.box.containsPoint(new THREE.Vector3(4.2, 0.5, 4.0)));

section('home.locate');
const cases = [
  [[2.5, 0, 3.2], 'gang', 'hoved'],
  [[1.2, 0, 1.1], 'bad', 'hoved'],
  [[1.5, 0, 5.7], 'soverom', 'hoved'],
  [[4.2, 0, 4.0], 'stue-kjokken', 'hoved'],
  [[3.5, -2.55, 3.8], 'kjeller-gang', 'kjeller'],
  [[7.4, -2.85, 4.4], 'entre-kjeller', 'kjeller'],
  [[3.5, -2.55, 6.2], 'kjellerstue', 'kjeller'],
  [[1.0, -1.3, 4.0], 'trapp', 'kjeller'],
];
for (const [p, id, lv] of cases) {
  const w = at(...p);
  check(`(${p.join(', ')}) → ${id} on ${lv}`, w.room?.id === id && w.level?.id === lv && !w.outside, JSON.stringify({ room: w.room?.id, level: w.level?.id }));
}
const top = at(1.0, -0.4, 4.0, 'hoved');
check('the stair near the top keeps «hoved» with hysteresis (body −0.4 + 0.9)', top.room?.id === 'trapp' && top.level?.id === 'hoved');
const ute = at(12.2, -2.87, 4.6);
check('the forecourt start is no room, but «Forplassen» outside', !ute.room && ute.outside?.name === 'Forplassen' && ute.outside.levelName === 'Ute');
check('the landing of the terrace stair is «Forplassen» too', at(11.8, -2.87, 7.5).outside?.id === 'forplass');
check('the terrace deck over the covered part is not «Forplassen»', !at(9.5, -0.03, 4.0).outside && !at(9.5, -0.03, 4.0).room);
check('the physical roomAt (lights, acoustics) never sees the stair', locate.roomAt(1.0, -0.4, 4.0, { physical: true })?.id !== 'trapp');

section('spawnPoints');
const sp = spawnPoints(layout);
check('inside = the dining area (4.2, 0, 4.0) as before', sp.inside.position.toArray().join() === '4.2,0,4' && near(sp.inside.yaw, Math.atan2(-2, -6.3), 1e-9) && sp.inside.where === 'inside');
check('outside = (12.2, −2.87, 4.6), yaw 85°, pitch −6° (V32)', sp.outside?.position.toArray().join() === '12.2,-2.87,4.6' && near(sp.outside.yaw, 85 * DEG, 1e-9) && near(sp.outside.pitch, -6 * DEG, 1e-9));
const look = new THREE.Vector3(-Math.sin(sp.outside.yaw), 0, -Math.cos(sp.outside.yaw));
const toDoor = new THREE.Vector3(8.88 - 12.2, 0, 4.31 - 4.6).normalize();
check('…looking at the front door (within 2°)', look.angleTo(toDoor) < 2 * DEG, `${(look.angleTo(toDoor) / DEG).toFixed(2)}°`);
check('without outsideHouse there is no outside start', spawnPoints({ ...layout, house: { ...layout.house, outsideHouse: null } }).outside === null);

section('LastPosition');
function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
check('parse: a good entry', parseLastPosition(JSON.stringify({ v: 1, pos: [1, -2.55, 3], yawDeg: 10, pitchDeg: -5, levelId: 'kjeller' }))?.levelId === 'kjeller');
check('parse: bad JSON, wrong version, NaN, far away → null', [
  '{', JSON.stringify({ v: 2, pos: [1, 0, 1] }), JSON.stringify({ v: 1, pos: [1, null, 1] }), JSON.stringify({ v: 1, pos: [1e4, 0, 0] }), JSON.stringify({ v: 1, pos: [1, 0] }),
].every((s) => parseLastPosition(s) === null));
{
  const st = memStorage();
  const lp = new LastPosition({ storage: st, interval: 2 });
  check('empty storage → load() null', lp.load() === null);
  const v = new THREE.Vector3(4.2, 0, 4.0);
  check('the first record is written at once', lp.record(v, 0.5, -0.1, { levelId: 'hoved', roomId: 'stue-kjokken' }, 0) && st.m.has(LAST_POSITION_KEY));
  v.set(5.2, 0, 4.0);
  check('…the next within the interval waits', !lp.record(v, 0.5, -0.1, {}, 1) && lp.pending);
  check('…and is written once the interval has passed', lp.record(v, 0.5, -0.1, {}, 2.1) && !lp.pending && JSON.parse(st.m.get(LAST_POSITION_KEY)).pos[0] === 5.2);
  v.set(5.3, 0, 4.0);
  check('a move under 0.25 m is not written again', !lp.record(v, 0.5, -0.1, {}, 10) && !lp.pending);
  v.set(6.0, 0, 4.0);
  lp.record(v, 1.0, 0, {}, 10.5);
  check('flush() writes what is pending', lp.flush() && JSON.parse(st.m.get(LAST_POSITION_KEY)).pos[0] === 6);
  const back = new LastPosition({ storage: st }).load();
  check('a new page loads it (yaw in degrees)', back && back.pos.join() === '6,0,4' && near(back.yawDeg, 57.3, 0.05));
  lp.clear();
  check('clear() forgets it', new LastPosition({ storage: st }).load() === null);
}
{
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  const lp = new LastPosition({ storage: throwing });
  let ok = true;
  try {
    ok = lp.load() === null && lp.record(new THREE.Vector3(1, 0, 1), 0, 0, {}, 0) === false && lp.flush() === false;
    lp.clear();
  } catch {
    ok = false;
  }
  check('blocked / full storage never throws', ok);
  const ro = new LastPosition({ storage: memStorage(), readOnly: true });
  check('readOnly never writes', ro.record(new THREE.Vector3(1, 0, 1), 0, 0, {}, 0) === false && ro.storage.m.size === 0);
  check('no storage at all → read-only', new LastPosition({ storage: null }).readOnly === true);
}

// ---- a stand-in game for the Game methods (no renderer, no DOM)
function fakeGame({ collision = null, dev = {}, storage = memStorage() } = {}) {
  const banners = [];
  const events = [];
  const teleports = [];
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    home: {
      layout,
      rooms,
      locate: (x, y, z, o) => locate(x, y, z, o),
      roomAt: (x, y, z, o) => locate.roomAt(x, y, z, o),
      spawn: sp.inside,
      spawnOutside: sp.outside,
    },
    dev: { lastPositionStorage: storage, ...dev },
    time: 0,
    roomId: null,
    running: false,
    collision,
    camera: new THREE.PerspectiveCamera(),
    hud: { showRoom: (name, o) => banners.push({ name, eyebrow: o?.eyebrow ?? 'Hjemme' }) },
    events: { emit: (n, e) => events.push({ n, e }) },
    _disposers: [],
    player: {
      position: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      onGround: true,
      teleport(p, yaw, pitch) {
        this.position.copy(p);
        this.yaw = yaw;
        this.pitch = pitch;
        teleports.push({ p: p.toArray(), yaw, pitch });
      },
    },
  });
  return { g, banners, events, teleports, storage };
}
/** Walks the stand-in player in a straight line at `speed` m/s, 60 Hz, running _updateRoom every step. */
function walk(g, to, speed = 1.6) {
  const P = g.player.position;
  const target = new THREE.Vector3(...to);
  const h = 1 / 60;
  const trace = [];
  for (let i = 0; i < 2000 && P.distanceTo(target) > 1e-6; i++) {
    const d = target.clone().sub(P);
    const step = Math.min(d.length(), speed * h);
    P.addScaledVector(d.normalize(), step);
    g.time += h;
    g._updateRoom();
    trace.push({ t: g.time, roomId: g.roomId });
  }
  return trace;
}
/** n idle steps of 1/60 s. */
function idle(g, n) {
  for (let i = 0; i < n; i++) {
    g.time += 1 / 60;
    g._updateRoom();
  }
}

section('Game._updateRoom');
{
  const { g, banners, events } = fakeGame();
  g.player.position.set(2.5, 0, 3.2);
  g._updateRoom();
  check('pos 2.5,0,3.2 → «Gang» with eyebrow «1. etasje» at once (the first update)', g.roomId === 'gang' && banners.length === 1 && banners[0].name === 'Gang' && banners[0].eyebrow === '1. etasje', JSON.stringify(banners));
  check('…and a room event { id, name, levelId, levelName }', events.at(-1)?.e?.id === 'gang' && events.at(-1).e.levelId === 'hoved' && events.at(-1).e.levelName === '1. etasje');
}
{
  const { g, banners, events } = fakeGame();
  g.player.position.set(4.2, 0, 4.0);
  g._updateRoom();
  check('the start in the dining area: «Stue/kjøkken» / «1. etasje»', banners.length === 1 && banners[0].name === 'Stue/kjøkken' && banners[0].eyebrow === '1. etasje');
  // through door-gang (w-gang, x ≈ 3.12–3.22) into the hall
  const trace = walk(g, [3.6, 0, 3.95]).concat(walk(g, [2.4, 0, 3.9]));
  idle(g, 30);
  const hallBanners = banners.slice(1);
  check('from the living room into the hall comes exactly one banner, «Gang»', hallBanners.length === 1 && hallBanners[0].name === 'Gang' && hallBanners[0].eyebrow === '1. etasje', JSON.stringify(banners));
  const firstGang = trace.findIndex((s) => s.roomId === 'gang');
  // the body crossed into the hall polygon at (the same walk, without the game):
  let crossT = null;
  {
    const P = new THREE.Vector3(4.2, 0, 4.0);
    let t = 0;
    for (const to of [[3.6, 0, 3.95], [2.4, 0, 3.9]]) {
      const target = new THREE.Vector3(...to);
      for (let i = 0; i < 2000 && P.distanceTo(target) > 1e-6; i++) {
        const d = target.clone().sub(P);
        const step = Math.min(d.length(), 1.6 / 60);
        P.addScaledVector(d.normalize(), step);
        t += 1 / 60;
        if (crossT === null && locate(P.x, P.y + BODY_CENTRE, P.z).room?.id === 'gang') crossT = t;
      }
    }
  }
  const delay = firstGang >= 0 && crossT !== null ? trace[firstGang].t - crossT : null;
  check('…0.4 s after the body entered the hall (± one frame)', delay !== null && Math.abs(delay - 0.4) <= 1 / 60 + 1e-9, `delay ${delay}`);
  check('the room sequence is stue-kjokken → (null in the doorway?) → gang, ending in gang', g.roomId === 'gang' && events.filter((e) => e.n === 'room').every((e) => e.e === null || ['gang', 'stue-kjokken'].includes(e.e.id)));
  // back into the living room: a new banner «Stue/kjøkken»
  walk(g, [3.6, 0, 3.95]);
  walk(g, [4.4, 0, 4.0]);
  idle(g, 30);
  check('back into the living room: «Stue/kjøkken» again (one banner)', banners.length === 3 && banners[2].name === 'Stue/kjøkken');
}
{
  const { g, banners } = fakeGame();
  g.player.position.set(4.2, 0, 4.0);
  g._updateRoom();
  // a short excursion into the doorway wall zone (no room) for 0.2 s: nothing changes
  g.player.position.set(3.17, 0, 3.95); // inside w-gang's thickness: no room
  const wasNull = !locate(3.17, BODY_CENTRE, 3.95).room;
  idle(g, 12); // 0.2 s
  g.player.position.set(3.4, 0, 3.95);
  idle(g, 60);
  check('a 0.2 s gap (no room) changes neither the room nor the banner', wasNull && g.roomId === 'stue-kjokken' && banners.length === 1);
}
{
  const { g, banners, events } = fakeGame();
  g.player.position.set(4.2, 0, 4.0);
  g._updateRoom();
  g.player.position.set(12.2, -2.87, 4.6); // a teleport
  g.time += 1 / 60;
  g._updateRoom();
  check('a teleport counts at once: outside → roomId null, banner «Forplassen» / «Ute»', g.roomId === null && banners.at(-1)?.name === 'Forplassen' && banners.at(-1).eyebrow === 'Ute' && events.at(-1)?.e === null);
  g.player.position.set(3.5, -2.55, 3.8);
  g.time += 1 / 60;
  g._updateRoom();
  check('…into the basement hall: «Gang» / «Kjeller»', g.roomId === 'kjeller-gang' && banners.at(-1)?.name === 'Gang' && banners.at(-1).eyebrow === 'Kjeller');
  g.player.position.set(1.0, -1.3, 4.0);
  g.time += 1 / 60;
  g._updateRoom();
  check('…on the stair half way down: «Trappa» with the level the body is on («Kjeller»)', g.roomId === 'trapp' && banners.at(-1)?.name === 'Trappa' && banners.at(-1).eyebrow === 'Kjeller');
  g.player.position.set(2.5, 0, 3.2);
  g.time += 1 / 60;
  g._updateRoom();
  check('…and up in the hall (level hysteresis reset by the jump): «Gang» / «1. etasje»', g.roomId === 'gang' && banners.at(-1)?.eyebrow === '1. etasje');
}
{
  // the terrace: no named place – leaving the living room onto it and back is no new banner
  const { g, banners } = fakeGame();
  g.player.position.set(5.6, 0, 5.9);
  g._updateRoom();
  walk(g, [7.4, -0.03, 5.9]);
  idle(g, 60);
  const outRoom = g.roomId;
  walk(g, [5.6, 0, 5.9]);
  idle(g, 60);
  check('out onto the terrace and back: roomId null there, still one banner', outRoom === null && g.roomId === 'stue-kjokken' && banners.length === 1, JSON.stringify(banners));
  // from no place at all a room counts at once (the tour «terrasse» ends 0.34 s after the doorway)
  walk(g, [7.4, -0.03, 5.9]);
  idle(g, 60);
  g.player.position.set(6.8, 0, 5.9);
  g.time += 1 / 60;
  g._updateRoom();
  check('…arriving from the terrace (no place) counts at once', g.roomId === 'stue-kjokken');
}

section('Game._placeAtStart');
/** Fake collision: floors at y 0 inside the house's ground floor plan, −2.55 in the basement, the forecourt when `ready`. */
function fakeCollision({ ready }) {
  return {
    isWalkable: (x, z) => x > -0.3 && x < (ready ? 14 : 9.8) && z > -0.3 && z < 12.2,
    raycast(ray, far) {
      const { x, y, z } = ray.origin;
      const floors = [];
      if (x >= 0 && x <= 6.92 && z >= 0 && z <= 11.93) floors.push(0);
      if (x >= 0.13 && x <= 6.45 && z >= 0.13 && z <= 11.38) floors.push(-2.55);
      if (ready && x >= 8.88 && x <= 12.6 && z >= 3.18 && z <= 6.75) floors.push(-2.87);
      const below = floors.filter((f) => f <= y && y - f <= far).sort((a, b) => b - a);
      return below.length ? { point: new THREE.Vector3(x, below[0], z), distance: y - below[0] } : null;
    },
  };
}
{
  const { g, teleports } = fakeGame({ collision: fakeCollision({ ready: false }) });
  const info = console.info;
  console.info = () => {};
  g._placeAtStart();
  console.info = info;
  check('the forecourt cannot be stood on yet → the dining area (and the reserve too)', g.startedFrom === 'inside' && teleports.length === 2 && teleports.every((t) => t.p.join() === '4.2,0,4'));
}
{
  const { g, teleports } = fakeGame({ collision: fakeCollision({ ready: true }) });
  g._placeAtStart();
  check('empty storage, forecourt ready → outside at (12.2, −2.87, 4.6), yaw 85°, pitch −6°', g.startedFrom === 'outside' && teleports.at(-1).p.join() === '12.2,-2.87,4.6' && near(teleports.at(-1).yaw, 85 * DEG, 1e-9) && near(teleports.at(-1).pitch, -6 * DEG, 1e-9));
  check('…the first teleport (the reserve spawn) is the forecourt', teleports[0].p.join() === '12.2,-2.87,4.6');
  check('…and the position watcher is registered (flushes on dispose)', g._disposers.length === 1 && g.lastPosition instanceof LastPosition);
}
{
  const storage = memStorage();
  storage.setItem(LAST_POSITION_KEY, JSON.stringify({ v: 1, pos: [3.5, -2.55, 6.2], yawDeg: 180, pitchDeg: -4, levelId: 'kjeller', roomId: 'kjellerstue' }));
  const { g, teleports } = fakeGame({ collision: fakeCollision({ ready: true }), storage });
  g._placeAtStart();
  check('a saved position (the basement living room) is restored, with its level and view', g.startedFrom === 'saved' && teleports.at(-1).p.join() === '3.5,-2.55,6.2' && near(teleports.at(-1).yaw, Math.PI, 1e-9) && teleports[0].p.join() === '12.2,-2.87,4.6');
  const fresh = fakeGame({ collision: fakeCollision({ ready: true }), storage, dev: { spawn: 'fresh' } });
  fresh.g._placeAtStart();
  check('«fresh» (Start med stua slik den er i dag) ignores it → outside', fresh.g.startedFrom === 'outside' && fresh.teleports.at(-1).p.join() === '12.2,-2.87,4.6');
  const inside = fakeGame({ collision: fakeCollision({ ready: true }), storage, dev: { spawn: 'inside' } });
  inside.g._placeAtStart();
  check('«inside» (?play=1) → the dining area', inside.g.startedFrom === 'inside' && inside.teleports.at(-1).p.join() === '4.2,0,4');
  const pos = fakeGame({ collision: fakeCollision({ ready: true }), storage, dev: { pos: [2.5, 0, 3.2], yaw: 90 * DEG } });
  pos.g._placeAtStart();
  check('?pos= overrides the saved position (and &yaw turns it)', pos.g.startedFrom === 'pos' && pos.teleports.at(-1).p.join() === '2.5,0,3.2' && near(pos.teleports.at(-1).yaw, 90 * DEG, 1e-9));
  const yawOnly = fakeGame({ collision: fakeCollision({ ready: true }), dev: { spawn: 'inside', yaw: 90 * DEG } });
  yawOnly.g._placeAtStart();
  check('&yaw without &pos turns the start (refcheck orbit views)', yawOnly.teleports.at(-1).p.join() === '4.2,0,4' && near(yawOnly.teleports.at(-1).yaw, 90 * DEG, 1e-9));
}
{
  const storage = memStorage();
  storage.setItem(LAST_POSITION_KEY, JSON.stringify({ v: 1, pos: [20, -2.55, 6.2], yawDeg: 0, pitchDeg: 0 }));
  const { g, teleports } = fakeGame({ collision: fakeCollision({ ready: true }), storage });
  const info = console.info;
  console.info = () => {};
  g._placeAtStart();
  console.info = info;
  check('a saved position that is no longer on a floor → outside', g.startedFrom === 'outside' && teleports.at(-1).p.join() === '12.2,-2.87,4.6');
}
{
  // recording: only while running, on the ground; written when due
  const storage = memStorage();
  const { g } = fakeGame({ collision: fakeCollision({ ready: true }), storage, dev: { spawn: 'inside' } });
  g._placeAtStart();
  g._updateRoom();
  check('nothing is recorded while the loop is stopped (tests, __hus.stop)', !storage.m.has(LAST_POSITION_KEY));
  g.running = true;
  g.time += 1 / 60;
  g._updateRoom();
  // the start point itself is never saved (LastPosition.markStart): only a spot the player moved to
  check('the start point is not written in the first frame (markStart)', !storage.m.has(LAST_POSITION_KEY));
  g.player.position.set(4.6, 0, 4.0);
  g.time += 1 / 60;
  g._updateRoom();
  const saved = parseLastPosition(storage.m.get(LAST_POSITION_KEY));
  check('running and on the ground, moved from the start → saved with level and room', saved?.pos.join() === '4.6,0,4' && saved.levelId === 'hoved' && saved.roomId === 'stue-kjokken');
  g.player.position.set(5.0, 0, 6.0);
  g.time += 0.1;
  g._updateRoom();
  for (const d of g._disposers) d();
  check('dispose (quit) flushes the latest spot', parseLastPosition(storage.m.get(LAST_POSITION_KEY))?.pos.join() === '5,0,6');
}

done();
