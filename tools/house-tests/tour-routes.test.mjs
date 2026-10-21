#!/usr/bin/env node
/**
 * The routes of tools/tour.mjs (tools/house-tests/_tours.mjs) against the house data, without a browser (steg 22 + 26,
 * notes/hele-huset-design.md §7.4). tools/tour.mjs walks them in the game with real physics; this test catches a route
 * that the data no longer supports before anyone opens a browser – a renamed room, a moved door, a wall in the way:
 *   - every tour's start lies on a floor (layout.house.floorYAt) – the outside tours start at
 *     outsideHouse.spawnOutside (V32), and _tours.mjs SPAWN_OUTSIDE is that point;
 *   - walking the route (sampled every 2 cm, the floor height followed with floorYAt, stair surfaces included) never
 *     crosses a wall of its level except through a door or an opening, with the body (≥ 0.25 m) clear of the hole's
 *     frames, never crosses a stair guard (rekk-a/b/c) on the upper floor, and stays out of the stair's well;
 *   - the rooms passed – roomAt as the HUD asks it (physical:false, level hysteresis), a new room counting after
 *     0.4 s at walking speed like Game._updateRoom – are the tour's expected sequence;
 *   - the expected banners are the rooms' names (and their levels' names) in the data;
 *   - every door a tour opens exists, is interactive, and the player stands outside the leaf's swing when opening it;
 *   - the stair part of the routes follows the walk line (V13): no point closer to a well corner than the walk line
 *     minus 5 cm (the inside of the winders is too steep to walk up).
 *   node tools/house-tests/tour-routes.test.mjs
 */
import { imp, check, section, near, done } from './_lib.mjs';
import { TOURS, SPAWN_OUTSIDE } from './_tours.mjs';

const { layout } = await imp('src/home/layout.js');
const house = await imp('src/data/scripts/house.mjs');
const H = layout.house;
const R = 0.3; // PLAYER.radius
const DRIFT = 0.25; // how far a running player slides past the waypoint before it stands (tour.mjs --run)
const BODY = 0.9; // the HUD tests the body centre (feet + 0.9)
const SETTLE = 0.4; // Game ROOM_SETTLE (s)
const DS = 0.02;
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));

const outside = H.outsideHouse ?? {};
/**
 * Floor (world y) under (x, z) near y: the house's floor (stair surfaces included), else – outside the house, on the
 * terrace or the forecourt – the height the walker already has (the routes take no outside stair). A floor far below
 * (the entrance under the terrace deck) is not the walker's: a 2 cm step never drops more than a few centimetres.
 */
const floorAt = (x, z, y) => {
  const f = H.floorYAt(x, z, y);
  return f != null && Math.abs(f - y) < 0.5 ? f : y;
};

// ---------------------------------------------------------------------------------------------------------------
// obstacles: wall slabs (one owner per slab – backOf faces reuse the slab of another wall) with their passable holes,
// and the stair's guards on the upper floor

const obstacles = [];
for (const w of H.walls) {
  if (w.backOf) continue;
  const n = w.normal, t = w.thickness ?? 0.1;
  // the slab's mid-line: the face moved half the thickness behind it
  const a = { x: w.start.x - (n.x * t) / 2, z: w.start.y - (n.y * t) / 2 };
  const b = { x: w.end.x - (n.x * t) / 2, z: w.end.y - (n.y * t) / 2 };
  const holes = (w.openings || [])
    .filter((o) => o.type !== 'window')
    .map((o) => {
      // a door's karm stands inside the hole (avstemming §5.1); an opening without a door has none
      const fw = o.type === 'opening' ? 0 : o.frame?.width ?? 0.07;
      return { id: o.id, u0: o.u0 + fw, u1: o.u1 - fw };
    });
  obstacles.push({ id: w.id, levelId: w.levelId, floorY: w.floorY, a, b, len: w.length, half: t / 2, holes });
}
const stair = H.stairs?.[0] ?? null;
for (const g of stair?.guards || []) {
  if (!Array.isArray(g.line)) continue;
  const [p, q] = g.line.map((v) => (Array.isArray(v) ? { x: v[0], z: v[1] } : { x: v.x, z: v.y }));
  obstacles.push({ id: g.id, levelId: stair.toLevel, floorY: H.levelsById[stair.toLevel].floorY, a: p, b: q, len: Math.hypot(q.x - p.x, q.z - p.z), half: 0.035, holes: [], guard: true });
}
const wellPoly = stair?.well?.polygon ? stair.well.polygon.map((p) => (Array.isArray(p) ? p : [p.x, p.y])) : null;

/** Intersection of segment p→q with segment a→b: { t (along p→q), u (along a→b, metres) } or null. */
function cross(p, q, a, b, len) {
  const rx = q.x - p.x, rz = q.z - p.z, sx = b.x - a.x, sz = b.z - a.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a.x - p.x) * sz - (a.z - p.z) * sx) / den;
  const s = ((a.x - p.x) * rz - (a.z - p.z) * rx) / den;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return { t, u: s * len };
}

/** Distance from a point to a polygon's edges (0 inside). */
function distToPoly(x, z, poly) {
  if (house.pointInPolygon([x, z], poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const vx = bx - ax, vz = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    d = Math.min(d, Math.hypot(x - (ax + k * vx), z - (az + k * vz)));
  }
  return d;
}

/** The walk line's distance from the well corners per stair section (V13), for the «not on the inside» check. */
const walk = stair ? house.stairWalk(stair.spec ?? stair, { bound: (stair.spec ?? stair).footprint }) : null;

// ---------------------------------------------------------------------------------------------------------------

section('Turene finnes og starter på et gulv');
check('spawnOutside i dataene er SPAWN_OUTSIDE i _tours.mjs (V32)', !!outside.spawnOutside && outside.spawnOutside.pos.every((v, i) => near(v, SPAWN_OUTSIDE.pos[i], 1e-9)) && near(outside.spawnOutside.yawDeg, SPAWN_OUTSIDE.yawDeg, 1e-9), JSON.stringify(outside.spawnOutside?.pos));
for (const [name, t] of Object.entries(TOURS)) {
  const s = t.spawn ? SPAWN_OUTSIDE.pos : t.start;
  const fy = floorAt(s[0], s[2], s[1]);
  check(`${name}: start ${s.join(',')} står på gulvet (${f2(fy)})`, near(fy, s[1], 0.03));
}

section('Rutene går gjennom dører og åpninger, ikke gjennom vegger');
const walked = {};
for (const [name, t] of Object.entries(TOURS)) {
  const s = t.spawn ? SPAWN_OUTSIDE.pos : t.start;
  let p = { x: s[0], z: s[2] }, y = s[1];
  const samples = [{ x: p.x, z: p.z, y, leg: 0 }];
  const problems = [];
  const doorChecks = [];
  t.route.forEach((st, leg) => {
    if (!Array.isArray(st)) {
      doorChecks.push({ id: st.open, at: { ...p }, y, leg });
      return;
    }
    const q = { x: st[0], z: st[1] };
    const L = Math.hypot(q.x - p.x, q.z - p.z);
    const n = Math.max(1, Math.ceil(L / DS));
    let prev = { ...p };
    for (let i = 1; i <= n; i++) {
      const c = { x: p.x + ((q.x - p.x) * i) / n, z: p.z + ((q.z - p.z) * i) / n };
      y = floorAt(c.x, c.z, y);
      for (const o of obstacles) {
        // the walls of the level the feet are on (the stair's middle crosses no wall); guards only on the upper floor
        if (Math.abs(y - o.floorY) > (o.guard ? 0.5 : 1.0)) continue;
        const hit = cross(prev, c, o.a, o.b, o.len);
        if (!hit) continue;
        const hole = o.holes.find((hl) => hit.u >= hl.u0 + 0.25 - 1e-9 && hit.u <= hl.u1 - 0.25 + 1e-9);
        if (!hole) {
          const near0 = o.holes.find((hl) => hit.u >= hl.u0 - 0.3 && hit.u <= hl.u1 + 0.3);
          problems.push(`leg ${leg + 1}: crosses ${o.guard ? 'the guard' : 'wall'} ${o.id} at (${f2(c.x)}, ${f2(c.z)})${near0 ? ` – ${f2(Math.min(hit.u - near0.u0, near0.u1 - hit.u))} m from the edge of ${near0.id} (clear ${f2(near0.u0)}–${f2(near0.u1)}, the body needs 0.25)` : ''}`);
        }
      }
      if (wellPoly && y < -0.05 && y > H.levelsById[stair.fromLevel].floorY + 0.05 && distToPoly(c.x, c.z, wellPoly) < 0.2) problems.push(`leg ${leg + 1}: within 0.2 m of the stair's well at (${f2(c.x)}, ${f2(c.z)})`);
      samples.push({ x: c.x, z: c.z, y, leg: leg + 1 });
      prev = c;
    }
    p = q;
  });
  walked[name] = { samples, doorChecks };
  check(`${name}: ingen vegg, rekkverk eller trappeøye i veien`, !problems.length, problems.slice(0, 4).join('; '));
}

section('Dørene på rutene');
for (const [name, t] of Object.entries(TOURS)) {
  for (const dc of walked[name].doorChecks) {
    const d = H.doors.find((x) => x.id === dc.id);
    if (!check(`${name}: ${dc.id} finnes og kan åpnes`, !!d && d.interactive !== false, d ? 'not interactive' : 'no such door')) continue;
    // hinge jamb and the leaf's swing side (Door.js: swing 'out' = toward the wall's back, away from the owner room)
    const w = H.wallsById[d.wallId];
    const along = { x: (w.end.x - w.start.x) / w.length, z: (w.end.y - w.start.y) / w.length };
    const uh = d.hinge === 'to' ? d.u1 : d.u0;
    const face = { x: w.start.x + along.x * uh, z: w.start.y + along.z * uh };
    const side = d.swing === 'in' ? 1 : -1; // +1: into the owner room (the normal's side)
    const leafW = d.leaf?.w ?? d.width - 0.14;
    const hinge = { x: face.x + (side < 0 ? -w.normal.x * w.thickness : 0), z: face.z + (side < 0 ? -w.normal.y * w.thickness : 0) };
    const onSwingSide = ((dc.at.x - face.x) * w.normal.x + (dc.at.z - face.z) * w.normal.y) * side > -w.thickness / 2;
    const dist = Math.hypot(dc.at.x - hinge.x, dc.at.z - hinge.z);
    // the walker stops within 0.2 m of the waypoint and, running, slides on ~0.25 m: DRIFT more than leaf + body
    const clear = !onSwingSide || dist >= leafW + R + DRIFT;
    check(`${name}: står klar av bladet til ${dc.id} når den åpnes (${onSwingSide ? `${f2(dist)} m fra hengslet, bladet ${f2(leafW)} + kroppen ${R} + ${DRIFT} for å skli forbi stoppet` : 'på den andre siden'})`, clear);
  }
}

section('Rommene underveis (som HUD-en: roomAt physical:false, 0,4 s før skifte)');
for (const [name, t] of Object.entries(TOURS)) {
  if (!t.rooms) continue;
  const { samples } = walked[name];
  // Game._updateRoom with time = path length / speed (2.2 m/s flat, 1.6 m/s on the stair), the level's hysteresis
  let levelId = null, placeKey, candidate, since = 0, time = 0;
  const seq = [];
  let roomId;
  const stepTo = (s, dt) => {
    time += dt;
    const room = H.roomAt(s.x, s.y + BODY, s.z, { physical: false, previousLevelId: levelId });
    const lv = H.levelAt(s.y + BODY, levelId);
    levelId = lv?.id ?? levelId;
    const key = room ? room.id : null;
    if (key !== candidate) {
      candidate = key;
      since = time;
    }
    const settled = placeKey === undefined || time - since >= SETTLE - 1e-9;
    if (key !== placeKey && settled) {
      placeKey = key;
      if (key !== roomId) {
        roomId = key;
        seq.push(key ?? '-');
      }
    }
  };
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], q = samples[i - 1];
    const ds = q ? Math.hypot(s.x - q.x, s.z - q.z) : 0;
    const v = q && Math.abs(s.y - q.y) > 0.002 ? 1.6 : 2.2;
    stepTo(s, ds / v);
  }
  stepTo(samples[samples.length - 1], 0.6); // the tour stands still at the end
  check(`${name}: ${t.rooms.join(' → ')}`, seq.join(',') === t.rooms.join(','), `got ${seq.join(' → ')}`);
}

section('Bannerne er rommenes navn i dataene');
for (const [name, t] of Object.entries(TOURS)) {
  if (!t.names || !t.rooms) continue;
  const want = [];
  for (const id of t.rooms) {
    if (id === '-') continue;
    want.push(H.roomsById[id]?.name ?? `?${id}`);
  }
  // the HUD names a place once: out onto the terrace (no named place) and back is no new banner
  const collapse = (a) => a.filter((v, i) => i === 0 || v !== a[i - 1]);
  const got = collapse(t.names.filter((n) => n !== 'Forplassen'));
  check(`${name}: ${t.names.join(', ')}`, got.join(',') === collapse(want).join(','), `the data names ${want.join(', ')}`);
  if (t.eyebrows) {
    const levels = new Set(H.levels.map((l) => l.name).concat('Ute'));
    check(`${name}: etasjenavnene finnes (${[...new Set(t.eyebrows)].join(', ')})`, t.eyebrows.every((e) => levels.has(e)));
  }
}

section('Trappa: rutene følger ganglinja (V13), ikke innsiden av svingtrinnene');
if (walk?.A && walk?.B) {
  const corners = [walk.A, walk.B];
  // the walk line's own radius round each corner, at its smallest (r1 / r3 at the ends of the turns, r2 between)
  const rMin = Math.min(walk.r1, walk.r2, walk.r3);
  for (const [name] of Object.entries(TOURS)) {
    let worst = Infinity;
    for (const s of walked[name].samples) {
      if (s.y > -0.05 || s.y < H.levelsById[stair.fromLevel].floorY + 0.05) continue; // not on the stair
      for (const c of corners) {
        // only the turn round this corner: the quadrant away from the flights
        const dx = s.x - c[0], dz = s.z - c[1];
        if (dx > 0.01) continue;
        worst = Math.min(worst, Math.hypot(dx, dz));
      }
    }
    if (worst === Infinity) continue;
    check(`${name}: nærmest et hjørne av øyet ${f2(worst)} m (ganglinja ${f2(rMin)} m)`, worst >= rMin - 0.05);
  }
} else check('trappa har en ganglinje med to svinger (stairWalk)', false, 'no A / B in stairWalk');

done();
