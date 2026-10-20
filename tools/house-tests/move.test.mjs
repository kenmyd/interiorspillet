#!/usr/bin/env node
/**
 * M1 – stepwise ground snap (notes/hele-huset-design.md §3.2, step 5). Node, no browser: the real CollisionWorld and
 * PlayerController (both DOM-free) on small hand-built worlds, driven with fake input at a fixed frame rate.
 *   node tools/house-tests/move.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Every scenario runs at 30, 60 and 144 Hz, walking and running:
 *   - ramp top: the invisible wedge under a stair (§3.1, 14 risers à 0.182, going 0.195 / 0.20 / 0.21 / 0.23, and
 *     steeper wedges of 44 / 45 / 48° for the winder's inner side) seen from the floor it tips over from. The player
 *     must stay on the ground over the edge and down the slope (0 % airborne frames, no 'land' event), descend
 *     smoothly, keep the horizontal speed and end on the lower floor (−2.548 ± 0.02); 51° is printed only (the
 *     limit: it still shoves). Also between side walls 0.90 and 0.78 m apart (the real shaft), entered at 10 / 20 /
 *     30°: the same checks, speed and |Δy| included (the snap must look past wall contacts, and beside a wall its
 *     edge push is not made vertical);
 *   - up the ramp: arrives on the upper floor, never airborne at the crest;
 *   - real steps down: the entrance steps (2 × 0.15, §3.11) and a terrace-like stair (9 × 0.188) – no air, no 'land';
 *     single drops of 0.20–0.26 are printed (the shove off the nose grows with the drop);
 *     up real risers is the step-up, not the snap: a 0.10 riser must stay climbable, the stairs are only printed
 *     (they stop at the first riser, as before M1);
 *   - the same stairs as a wedge, down at an even speed and up again;
 *   - thresholds: a 12 mm sill on a level floor and the terrace door (sill, then the deck 3 cm lower): no air, no
 *     'land', never faster than walking (before M1 the snap shoved the player forward off the sill);
 *   - what must NOT snap: a 0.6 m ledge is a fall (airborne, 'land' event), a jump keeps its full height;
 *   - standing still on the wedge: no sliding.
 *
 * The control lines «one-part snap» re-run the ramp top with the snap as it was before M1 (one move of snapDistance)
 * to show the test sees the air hops; they are printed, not counted. --controller=<path> runs everything with another
 * PlayerController module (e.g. a copy of the pre-M1 file) for a before/after comparison.
 */
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.json')) {
      const text = fs.readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${text};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (rel) => import(pathToFileURL(path.resolve(ROOT, rel)).href);
// --controller=<path>: run the same scenarios with another PlayerController module (e.g. a copy of the old one, for
// a before/after comparison; it must import the same three and config.js)
const ctlArg = process.argv.find((a) => a.startsWith('--controller='));
const THREE = await import('three');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PlayerController, MOVE } = await imp(ctlArg ? ctlArg.slice('--controller='.length) : 'src/player/PlayerController.js');
if (ctlArg) console.log(`(kontroller: ${ctlArg.slice('--controller='.length)})`);
const { PLAYER, WALKABLE_NORMAL_Y } = await imp('src/config.js');

let failures = 0;
let passes = 0;
const section = (name) => console.log(`\n— ${name}`);
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  → ${detail}` : ''}`);
  }
}
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const RATES = [30, 60, 144];
const GAITS = [
  { name: 'gange', running: false, speed: PLAYER.walkSpeed },
  { name: 'løp', running: true, speed: PLAYER.runSpeed },
];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(V(x0, y0, z0), V(x1, y1, z1));

// ---------------------------------------------------------------------------------------------------------------
// worlds (all walking runs along +x)

/**
 * Upper floor (top y = 0) for x < 0, a closed wedge from the edge (0, 0) down to (L, −H) with a vertical back and a flat
 * underside (as §3.1 describes the stair's collider), the lower floor (top y = −H) from x = 0 on. Optional side walls.
 */
function rampWorld({ rise = 0.182, risers = 14, going = 0.21, halfWidth = 1.5, walls = false } = {}) {
  const col = new CollisionWorld();
  const L = going * risers, H = rise * risers;
  col.addStaticBox(box(-6, -0.3, -halfWidth, 0, 0, halfWidth));
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, -H), new THREE.Vector2(L, -H)]);
  const wedge = new THREE.ExtrudeGeometry(shape, { depth: 2 * halfWidth, bevelEnabled: false });
  wedge.translate(0, 0, -halfWidth);
  col.addStatic(new THREE.Mesh(wedge));
  col.addStaticBox(box(0, -H - 0.3, -halfWidth, L + 8, -H, halfWidth));
  if (walls) {
    col.addStaticBox(box(-6, -H - 0.3, -halfWidth - 0.1, L + 8, 2.5, -halfWidth));
    col.addStaticBox(box(-6, -H - 0.3, halfWidth, L + 8, 2.5, halfWidth + 0.1));
  }
  col.build();
  return { col, L, H, slope: H / L, theta: Math.atan2(H, L), surfaceY: (x) => (x <= 0 ? 0 : x >= L ? -H : (-H * x) / L) };
}

/** Steps down along +x: floor y = 0 for x < 0, n treads (rise, going) as solid boxes, then the lower floor. */
function stepsWorld({ rise, n, going, top = 0 }) {
  const col = new CollisionWorld();
  const H = rise * n;
  col.addStaticBox(box(-6, top - 0.3, -1.5, 0, top, 1.5));
  for (let i = 1; i < n; i++) col.addStaticBox(box((i - 1) * going, top - H - 0.3, -1.5, i * going, top - i * rise, 1.5));
  col.addStaticBox(box((n - 1) * going, top - H - 0.3, -1.5, (n - 1) * going + 8, top - H, 1.5));
  col.build();
  return { col, L: (n - 1) * going, H, bottom: top - H };
}

/** A level floor with a sill box across it at x 0…depth (height h), optionally a lower deck from x = depth on. */
function sillWorld({ h = 0.012, depth = 0.1, deckDrop = 0 }) {
  const col = new CollisionWorld();
  col.addStaticBox(box(-6, -0.3, -1.5, depth, 0, 1.5));
  col.addStaticBox(box(0, 0, -1.5, depth, h, 1.5));
  col.addStaticBox(box(depth, -deckDrop - 0.3, -1.5, depth + 8, -deckDrop, 1.5));
  col.build();
  return { col };
}

// ---------------------------------------------------------------------------------------------------------------
// driver

/** The pre-M1 snap: one move of snapDistance, then one resolve (control runs only). */
class OnePartSnapPlayer extends PlayerController {
  _snapDown() {
    const cap = this.capsule;
    const save = cap.clone();
    const y0 = cap.start.y;
    cap.translate(V(0, -MOVE.snapDistance, 0));
    const before = cap.start.clone();
    const res = this.collision.resolveCapsule(cap);
    if (!res.onGround || res.groundNormal.y < WALKABLE_NORMAL_Y || cap.start.y > y0 + 0.001) {
      cap.copy(save);
      return false;
    }
    this.surface = res.surface;
    this._groundNormal.copy(res.groundNormal);
    this._verticalizeGroundPush(res, before);
    const drop = y0 - cap.start.y;
    if (drop > 0.04) this._stepSmooth = Math.min(0.35, this._stepSmooth + drop);
    return true;
  }
}

/**
 * Walk from `start` (feet) with W held (and Shift when running) at `hz` until x passes `untilX` (or `seconds`).
 * yawDeg turns the heading from +x towards −z. jumpAt: frame index that presses Space once.
 * @returns per-frame samples { x, y, z, dx, dy, onGround } and the events.
 */
function walk(col, { hz, running, start, untilX = Infinity, seconds = 6, yawDeg = 0, forward = 1, jumpAt = -1, Player = PlayerController }) {
  const input = { move: { forward, right: 0 }, running, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const events = [];
  const player = new Player({
    camera: new THREE.PerspectiveCamera(),
    collision: col,
    input,
    settings: { get: () => undefined },
    events: { emit: (name, data) => events.push({ name, data }) },
  });
  const yaw = -Math.PI / 2 + THREE.MathUtils.degToRad(yawDeg);
  // +1 when the walk goes along +x (stop once x > untilX), −1 along −x (stop once x < untilX)
  const heading = forward * Math.cos(THREE.MathUtils.degToRad(yawDeg)) >= 0 ? 1 : -1;
  player.teleport(V(...start), yaw, 0);
  // settle on the floor (a few frames standing still)
  input.move.forward = 0;
  for (let i = 0; i < 10; i++) player.update(1 / hz);
  events.length = 0;
  input.move.forward = forward;
  const dt = 1 / hz;
  const frames = [];
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    input.jumpPressed = i === jumpAt;
    const x0 = player.position.x, y0 = player.position.y, z0 = player.position.z;
    player.update(dt);
    const p = player.position;
    frames.push({ i, x: p.x, y: p.y, z: p.z, dx: p.x - x0, dy: p.y - y0, dz: p.z - z0, onGround: player.onGround });
    if (heading * (p.x - untilX) > 0) break;
  }
  return { player, frames, events };
}

const lands = (r) => r.events.filter((e) => e.name === 'land');
const toasts = (r) => r.events.filter((e) => e.name === 'toast');
const airborne = (frames) => frames.filter((f) => !f.onGround);
/** Horizontal speed per frame (m/s) relative to `nominal`: [min, max]. */
function speedBand(frames, hz, nominal) {
  const s = frames.map((f) => Math.hypot(f.dx, f.dz) * hz / nominal);
  return [Math.min(...s), Math.max(...s)];
}

// ---------------------------------------------------------------------------------------------------------------
section('Rampetoppen: ned kilen under trappa (14 × 0,182), og brattere kiler (44, 45, 48°)');
// 0.195: one straight wedge from the top nose to the foot of the bottom riser with going 0.21 (slope 14r / 13g, 43°).
// 44–48°: the inner side of the winder treads (helicoid, §3.1) is steeper than the straight flight; with 6.5 cm snap
// parts the edge contact there dipped under WALKABLE_NORMAL_Y and the walk shoved (1.75× at 60 Hz, 2.96× at 144 Hz).
// Keep the wedge and the helicoid at or below 48° on the walking line: 51° still shoves (printed below).
const goingFor = (deg) => 0.182 / Math.tan(THREE.MathUtils.degToRad(deg));
const RAMPS = [
  ...[0.195, 0.2, 0.21, 0.23].map((going) => ({ going, name: `inntrinn ${String(going).replace('.', ',')}` })),
  ...[44, 45, 48].map((deg) => ({ going: goingFor(deg), name: `kile ${deg}°` })),
];
for (const { going, name } of RAMPS) {
  for (const hz of RATES) {
    for (const g of GAITS) {
      const w = rampWorld({ going });
      const r = walk(w.col, { hz, running: g.running, start: [-2.5, 0, 0], untilX: w.L + 1.2 });
      const label = `${name}, ${hz} Hz, ${g.name}`;
      // steady speed reached on the flat before the edge; look at the edge region and the whole slope
      const region = r.frames.filter((f) => f.x - f.dx > -0.6 && f.x < w.L);
      const air = airborne(region);
      const gap = Math.max(...region.map((f) => f.y - w.surfaceY(f.x)));
      // smooth descent: |Δy| per frame ≤ 1.3 · v · dt · tan θ (§7.3), + 2 mm: rolling over the edge the feet trail the
      // ideal arc by a few mm (the snap's vertical push over-lifts a little on an edge contact) and catch up where
      // the slope begins – at 144 Hz that one frame is ~0.3 mm over the bare formula
      const dyMax = 1.3 * g.speed * (1 / hz) * Math.tan(w.theta) + 0.002;
      const worstDy = Math.max(...region.map((f) => Math.abs(f.dy)));
      const top = region.filter((f) => f.x < 1.0);
      const [smin, smax] = speedBand(top, hz, g.speed);
      const last = r.frames.at(-1);
      check(
        `${label}: 0 % i lufta over kanten og ned kilen, ingen «land»`,
        region.length > 0 && air.length === 0 && lands(r).length === 0,
        `${air.length}/${region.length} bilder i lufta, ${lands(r).length} land, høyeste føtter over kilen ${f3(gap)} m`,
      );
      check(`${label}: jevn nedstigning (|Δy| ≤ 1,3·v·dt·tan θ = ${f3(dyMax)})`, worstDy <= dyMax, `største |Δy| ${f3(worstDy)}`);
      check(`${label}: farten endres ikke over kanten (0,97–1,03)`, smin >= 0.97 && smax <= 1.03, `${smin.toFixed(3)}–${smax.toFixed(3)}`);
      check(`${label}: ender på kjellergulvet (−2,548 ± 0,02)`, Math.abs(last.y + w.H) <= 0.02 && last.x > w.L && !toasts(r).length, `y ${f3(last.y)}`);
    }
  }
}
// the limit: at 51° the ramp top still shoves for a frame (printed, not counted)
{
  const res = RATES.map((hz) => {
    const w = rampWorld({ going: goingFor(51) });
    const r = walk(w.col, { hz, running: false, start: [-2.5, 0, 0], untilX: w.L + 1.2 });
    const region = r.frames.filter((f) => f.x - f.dx > -0.6 && f.x < 1.0);
    const [, smax] = speedBand(region, hz, PLAYER.walkSpeed);
    return `${hz} Hz fart opptil ${smax.toFixed(2)}, ${airborne(region).length} i lufta`;
  });
  console.log(`  info kile 51°, gange (over grensen på 48°): ${res.join(' · ')}`);
}
// control: the snap as it was (one part) does hop here
for (const hz of RATES) {
  for (const g of GAITS) {
    const w = rampWorld({ going: 0.21 });
    const r = walk(w.col, { hz, running: g.running, start: [-2.5, 0, 0], untilX: w.L + 1.2, Player: OnePartSnapPlayer });
    const region = r.frames.filter((f) => f.x - f.dx > -0.6 && f.x < w.L);
    const air = airborne(region);
    const airDist = air.reduce((s, f) => s + Math.hypot(f.dx, f.dz), 0);
    const gap = Math.max(...region.map((f) => f.y - w.surfaceY(f.x)));
    console.log(`  info kontroll, ettdelt snap (før M1), ${hz} Hz, ${g.name}: ${air.length}/${region.length} bilder i lufta, ${f3(airDist)} m gjennom lufta, føtter opptil ${f3(gap)} m over kilen, ${lands(r).length} land`);
  }
}

section('Rampetoppen mellom sidevegger (0,90 og 0,78 m), skrå inngang (10, 20, 30°)');
// The real shaft is 0.78 m between the walls, so walking along a side wall over the ramp top is the normal case.
// Beside a wall _verticalizeGroundPush keeps the push as it is (wallCount > 0), so the forward part of the snap's
// edge push stays in: with snap parts of 6.5 cm (snapParts 4) that was a one-frame shove of 1.65–2.78× the walking
// speed at 60 Hz and 5.5× at 144 Hz, |Δy| up to 5× the §7.3 bound. Hence the speed and |Δy| checks here.
for (const width of [0.9, 0.78]) {
  for (const yawDeg of [10, 20, 30]) {
    for (const hz of RATES) {
      for (const g of GAITS) {
        const w = rampWorld({ going: 0.21, halfWidth: width / 2, walls: true });
        // heading yawDeg towards −z: the player meets the wall at z −width/2 before the edge and slides along it
        const r = walk(w.col, { hz, running: g.running, start: [-2.0, 0, 0], yawDeg, untilX: w.L + 1.2 });
        const label = `${width.toFixed(2).replace('.', ',')} m, ${yawDeg}°, ${hz} Hz, ${g.name}`;
        const region = r.frames.filter((f) => f.x - f.dx > -0.6 && f.x < w.L);
        const air = airborne(region);
        const last = r.frames.at(-1);
        const hugging = region.filter((f) => f.z < -width / 2 + PLAYER.radius + 0.01).length / Math.max(1, region.length);
        // the same bounds as on the open ramp (sliding along the wall the horizontal speed is ≈ cos(yaw), never more)
        const dyMax = 1.3 * g.speed * (1 / hz) * Math.tan(w.theta) + 0.002;
        const worstDy = Math.max(...region.map((f) => Math.abs(f.dy)));
        const [, smax] = speedBand(region, hz, g.speed);
        check(
          `${label}: langs veggen over kanten, 0 % i lufta, ingen «land»`,
          region.length > 0 && air.length === 0 && lands(r).length === 0 && hugging > 0.8,
          `${air.length}/${region.length} i lufta, ${lands(r).length} land, ${Math.round(hugging * 100)} % inntil veggen`,
        );
        check(`${label}: aldri raskere over kanten (≤ 1,03)`, smax <= 1.03, `fart opptil ${smax.toFixed(3)}`);
        check(`${label}: jevn nedstigning (|Δy| ≤ ${f3(dyMax)})`, worstDy <= dyMax, `største |Δy| ${f3(worstDy)}`);
        check(`${label}: ender på kjellergulvet`, Math.abs(last.y + w.H) <= 0.02 && last.x > w.L && !toasts(r).length, `y ${f3(last.y)}`);
      }
    }
  }
}

section('Opp kilen (ingen sprett ved toppen)');
for (const hz of RATES) {
  for (const g of GAITS) {
    const w = rampWorld({ going: 0.21 });
    const r = walk(w.col, { hz, running: g.running, start: [w.L + 1.5, -w.H, 0], yawDeg: 180, untilX: -1.0, seconds: 10 });
    const crest = r.frames.filter((f) => f.x > -0.8 && f.x < w.L);
    const air = airborne(crest);
    const last = r.frames.at(-1);
    check(
      `${hz} Hz, ${g.name}: opp på gangnivå, 0 % i lufta, ingen «land»`,
      Math.abs(last.y) <= 0.02 && last.x < -0.9 && air.length === 0 && lands(r).length === 0 && !toasts(r).length,
      `y ${f3(last.y)}, ${air.length}/${crest.length} i lufta, ${lands(r).length} land`,
    );
  }
}

section('Ekte trinn ned: entrétrinnene (2 × 0,15) og en terrassetrapp (9 × 0,188)');
const STAIRS = [
  { name: 'entré 2 × 0,15', rise: 0.15, n: 2, going: 0.28 },
  { name: 'terrasse 9 × 0,188', rise: 0.188, n: 9, going: 0.241, top: -0.03 },
];
for (const s of STAIRS) {
  for (const hz of RATES) {
    for (const g of GAITS) {
      const w = stepsWorld(s);
      const top = s.top ?? 0;
      const down = walk(w.col, { hz, running: g.running, start: [-1.5, top, 0], untilX: w.L + 1.0 });
      const region = down.frames.filter((f) => f.x - f.dx > -0.6 && f.x < w.L + 0.4);
      const air = airborne(region);
      const lastD = down.frames.at(-1);
      // the speed is only printed: off each nose the round bottom (r 0.3) has to clear the nose before it can stand on
      // the tread below – a shove forward of ≥ 2.6 cm (0.15) / 4.3 cm (0.188) in one frame, 6–9 cm off drops of
      // 0.20–0.28 (printed below). Before M1 the same noses gave air time and a 'land' instead. Stairs and any other
      // real height step of 0.15–0.26 get a wedge or a floor strip (next section: steady speed).
      const [smin, smax] = speedBand(region, hz, g.speed);
      check(
        `${s.name}, ${hz} Hz, ${g.name}: ned uten luft og uten «land»`,
        air.length === 0 && lands(down).length === 0 && Math.abs(lastD.y - w.bottom) <= 0.02 && !toasts(down).length,
        `${air.length}/${region.length} i lufta, ${lands(down).length} land, y ${f3(lastD.y)}; fart per bilde ${smin.toFixed(2)}–${smax.toFixed(2)} (dytt ved nesene)`,
      );
    }
  }
}
// single drops: the shove off the nose grows with the drop (the geometry of the round bottom, not the part size)
for (const rise of [0.2, 0.24, 0.26]) {
  const res = RATES.map((hz) => {
    const w = stepsWorld({ rise, n: 1, going: 0.3 });
    const r = walk(w.col, { hz, running: false, start: [-1.5, 0, 0], untilX: 1.5 });
    const region = r.frames.filter((f) => f.x - f.dx > -0.6 && f.x < 0.8);
    const shove = Math.max(...region.map((f) => Math.hypot(f.dx, f.dz)));
    return `${hz} Hz ${(shove * 100).toFixed(1)} cm (${((shove * hz) / PLAYER.walkSpeed).toFixed(2)}×), ${airborne(region).length} i lufta, ${lands(r).length} land`;
  });
  console.log(`  info ned ett ekte trinn på ${String(rise).replace('.', ',')}, gange, største steg i ett bilde: ${res.join(' · ')}`);
}
// Up real risers is the step-up (_tryStepUp), not the snap: the round bottom of the capsule first meets a riser edge
// higher than ~0.14 m at a contact too steep to stand on, so the player stops there (before M1 already from ~0.14).
// A riser of 0.10 must stay climbable; the stairs above are printed, and climbing them needs a wedge (next section).
for (const hz of RATES) {
  for (const g of GAITS) {
    const w = stepsWorld({ rise: 0.1, n: 1, going: 0.3 });
    const up = walk(w.col, { hz, running: g.running, start: [1.0, -0.1, 0], yawDeg: 180, untilX: -1.0 });
    const last = up.frames.at(-1);
    check(`opp ett trinn på 0,10, ${hz} Hz, ${g.name}: kommer opp, ingen «land»`, Math.abs(last.y) <= 0.02 && last.x < -0.9 && lands(up).length === 0, `y ${f3(last.y)}, x ${f3(last.x)}`);
  }
}
for (const s of STAIRS) {
  const res = RATES.map((hz) => {
    const w = stepsWorld(s);
    const up = walk(w.col, { hz, running: false, start: [w.L + 1.0, w.bottom, 0], yawDeg: 180, untilX: -1.0 });
    const last = up.frames.at(-1);
    return `${hz} Hz ${last.x < -0.9 ? 'oppe' : `stopper på x ${f3(last.x)}, y ${f3(last.y)}`}`;
  });
  console.log(`  info opp ${s.name} med ekte trinn (step-up, ikke snap): ${res.join(' · ')}`);
}

section('Kile over trinnene (som §3.1): opp og ned entrétrinnene og terrassetrappa');
const WEDGES = [
  { name: 'entré 2 × 0,15', rise: 0.15, risers: 2, going: 0.28 },
  { name: 'terrasse 9 × 0,188', rise: 0.188, risers: 9, going: 0.241 },
];
for (const s of WEDGES) {
  for (const hz of RATES) {
    for (const g of GAITS) {
      const w = rampWorld(s);
      const down = walk(w.col, { hz, running: g.running, start: [-1.5, 0, 0], untilX: w.L + 1.0 });
      const up = walk(w.col, { hz, running: g.running, start: [w.L + 1.0, -w.H, 0], yawDeg: 180, untilX: -1.0 });
      const regionD = down.frames.filter((f) => f.x - f.dx > -0.6 && f.x < w.L + 0.4);
      const airD = airborne(regionD).length;
      const airU = airborne(up.frames.filter((f) => f.x > -0.8 && f.x < w.L + 0.4)).length;
      const lD = down.frames.at(-1), lU = up.frames.at(-1);
      // down at an even speed (up is slower by design: uphillSlowdown). In the concave corner at the foot the
      // horizontal pass pushes a residual overlap with the slope out along its normal: ≤ 2 mm extra per frame
      // (≤ 1.12 at 144 Hz for a few frames), not the snap.
      const [smin, smax] = speedBand(regionD, hz, g.speed);
      check(
        `${s.name}, ${hz} Hz, ${g.name}: ned (jevn fart 0,97–1,12) og opp, 0 % i lufta, ingen «land»`,
        !airD && !airU && !lands(down).length && !lands(up).length && Math.abs(lD.y + w.H) <= 0.02 && Math.abs(lU.y) <= 0.02 && lU.x < -0.9 && smin >= 0.97 && smax <= 1.12,
        `ned ${airD} / opp ${airU} i lufta, ${lands(down).length + lands(up).length} land, y ${f3(lD.y)} / ${f3(lU.y)}, fart ned ${smin.toFixed(3)}–${smax.toFixed(3)}`,
      );
    }
  }
}

section('Terskler: 12 mm terskel, og terrassedøra (terskel, så dekket 3 cm lavere)');
const SILLS = [
  { name: 'terskel 12 mm', h: 0.012, depth: 0.1, deckDrop: 0 },
  { name: 'terrassedør', h: 0.012, depth: 0.2, deckDrop: 0.03 },
];
for (const s of SILLS) {
  for (const hz of RATES) {
    for (const g of GAITS) {
      const w = sillWorld(s);
      for (const dir of [1, -1]) {
        const r = dir > 0
          ? walk(w.col, { hz, running: g.running, start: [-1.5, 0, 0], untilX: 1.5 })
          : walk(w.col, { hz, running: g.running, start: [1.5, -s.deckDrop, 0], yawDeg: 180, untilX: -1.5 });
        const region = r.frames.filter((f) => f.x > -0.6 && f.x < s.depth + 0.6);
        const air = airborne(region);
        // Never faster than walking: before M1 the snap off the sill shoved the player forward (up to 1.7× the speed
        // for a frame at 144 Hz). Slower for a frame or two is the climb onto the sill: its edge pushes the capsule
        // back (horizontal pass, not the snap) – ~6 % over 12 mm, 13–25 % from the deck up 4.2 cm, as before M1.
        const [smin, smax] = speedBand(region, hz, g.speed);
        const floor = s.deckDrop > 0 && dir < 0 ? 0.7 : 0.93;
        check(
          `${s.name}, ${hz} Hz, ${g.name}, ${dir > 0 ? 'ut' : 'inn'}: ingen luft, ingen «land», aldri raskere (≤ 1,02), bremser ikke under ${floor}`,
          region.length > 0 && air.length === 0 && lands(r).length === 0 && smin >= floor && smax <= 1.02,
          `${air.length} i lufta, ${lands(r).length} land, fart ${smin.toFixed(3)}–${smax.toFixed(3)}`,
        );
      }
    }
  }
}

section('Det som ikke skal snappe');
for (const hz of RATES) {
  // a 0.6 m ledge (more than snapDistance) is a fall
  const w = stepsWorld({ rise: 0.6, n: 1, going: 0.3 });
  const r = walk(w.col, { hz, running: false, start: [-1.5, 0, 0], untilX: 1.5 });
  const fell = airborne(r.frames).length;
  check(`${hz} Hz: en kant på 0,6 m er et fall (i lufta, «land» etterpå)`, fell >= 3 && lands(r).length === 1 && Math.abs(r.frames.at(-1).y + 0.6) <= 0.02, `${fell} bilder i lufta, ${lands(r).length} land`);
  // a jump on the flat keeps its full height (no snap while the jump lock is on, nor at the apex)
  const flat = sillWorld({ h: 0.001, depth: 0.001 });
  const j = walk(flat.col, { hz, running: false, start: [-3, 0, 0], forward: 0, seconds: 1.5, jumpAt: 5 });
  const apex = Math.max(...j.frames.map((f) => f.y));
  const want = (PLAYER.jumpSpeed * PLAYER.jumpSpeed) / (2 * PLAYER.gravity);
  check(`${hz} Hz: hopp på flatt gulv når full høyde (${f3(want)} m) og lander`, Math.abs(apex - want) <= 0.04 && j.frames.at(-1).onGround && Math.abs(j.frames.at(-1).y) < 0.01, `topp ${f3(apex)} m`);
}

section('Stå stille på kilen (ingen gliding på 2 s)');
for (const hz of RATES) {
  const w = rampWorld({ going: 0.21 });
  const x = 1.2;
  const r = walk(w.col, { hz, running: false, start: [x, w.surfaceY(x) + 0.12, 0], forward: 0, seconds: 2 });
  const a = r.frames[Math.min(r.frames.length - 1, Math.round(0.3 * hz))], b = r.frames.at(-1);
  const drift = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  check(`${hz} Hz: står på kilen`, drift < 0.02 && b.onGround, `drift ${f3(drift)} m`);
}

console.log(`\n${passes} bestått, ${failures} feilet  (snapParts ${MOVE.snapParts}, snapDistance ${MOVE.snapDistance})`);
process.exit(failures ? 1 : 0);
