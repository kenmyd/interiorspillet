#!/usr/bin/env node
/**
 * Walkability map: loads the game headless (/?play=1&nowarm=1&nohelp=1), tests the player capsule (config.js PLAYER) on
 * a grid of floor positions against the collision world and prints a top-down ASCII map per level plus reachability
 * from a start point (flood fill over free cells). Requires a dev server (`npm run dev` on 5180, or the house test
 * server – then pass --port=525N).
 *
 * A cell is blocked ('#') when the player may not stand there (CollisionWorld.isWalkable: world bounds, deep water),
 * when the capsule – lifted by the step height (PlayerController MOVE.stepHeight), so the floor and steps up to it are
 * no obstacle – touches a static triangle or an enabled dynamic box, when its axis lies inside a static box collider
 * (deep inside a big box no face is within reach), or when there is no ground within 0.3 m below. A second test with
 * the capsule standing on the floor marks free cells that only the step-up makes free ('_': low obstacle or step).
 *
 * Usage:
 *   node tools/walkmap.mjs [--x=0,7] [--z=0,12] [--step=0.1] [--y=0] [--from=4.2,4.0] [--out=map.txt] [--port=5180]
 *                          [--doors=open|closed|<id>,<id>] [--levels=0,-2.55] [--auto-y] [--expect=x,y,z;x,y,z]
 *                          [--furniture=solid|ghost] [--lock] [--step-name=<step>|--pidfile=<path>]
 *     --x / --z    area (world metres)          --step   grid spacing
 *     --y          floor height of the test (one level; --levels replaces it)
 *     --levels     several floor heights: one grid per level, printed one after the other
 *     --auto-y     the floor of each cell is found by a ray down from 1.0 m above the level (to 1.5 m below it) instead
 *                  of being the level's height: stairs, ramps, steps and sunken floors get their real height. Two cells
 *                  next to each other are connected when their floors differ by at most the step height (+5 cm), and a
 *                  cell found from two levels at the same height (± 5 cm, e.g. a stair tread or the floor under the
 *                  stair hole) is one cell – so the fill can walk from one level to the other.
 *     --from       start cell x,z (on the first level) or x,y,z (on the level nearest y), inside the area; default
 *                  the spawn in the dining area (4.2, 4.0) – the old default 5,7.5 lies inside the dining table
 *     --furniture  solid (default): the furniture's boxes block, as for «Fysisk person»; ghost: they do not (the
 *                  game's default, CollisionWorld.ghostFurniture) – doors, walls and fixtures still block
 *     --expect     targets x,y,z separated by ';' that must be reachable from --from (the level nearest y, the
 *                  cell under x,z): prints ok / FAIL per target, exit code 2 if one is not reachable
 *     --doors      passed on as ?doors= (main.js): open / closed / the listed doors open
 *     --lock       take the shared GPU lock around the run (leave it out when you hold it yourself)
 *     --pidfile / --step-name   where the browser PID is written (default .shots/hus/<step>/browser.pid)
 * Rows run −z (top) → +z, columns −x → +x – the same orientation as plantegning.png (top = east / kitchen,
 * bottom = west / TV-stue, left = north, right = south / big windows).
 * Exit codes: 0 ok, 2 error or an --expect target not reachable.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs, pageUrl, launchBrowser, pidfileFor, acquireGpuLock, PAGE_HELPERS } from './lib/hus.mjs';

const { opt } = parseArgs();
const nums = (s, d) => (s ? s.split(',').map(Number) : d);
const levels = opt.levels ? nums(opt.levels) : [Number(opt.y ?? 0)];
const fromRaw = nums(opt.from, [4.2, 4.0]);
const from = fromRaw.length >= 3 ? { x: fromRaw[0], y: fromRaw[1], z: fromRaw[2] } : { x: fromRaw[0], y: levels[0], z: fromRaw[1] };
const expect = opt.expect
  ? opt.expect.split(';').filter(Boolean).map((t) => {
      const [x, y, z] = t.split(',').map(Number);
      return { x, y, z, label: t };
    })
  : [];
const area = { x: nums(opt.x, [0, 7]), z: nums(opt.z, [0, 12]), step: Number(opt.step ?? 0.1), levels, autoY: opt['auto-y'] === 'true', from, expect, ghost: opt.furniture === 'ghost' };
const inside = (v, [a, b]) => v >= Math.min(a, b) - 1e-9 && v <= Math.max(a, b) + 1e-9;
for (const p of [from, ...expect]) {
  if (!inside(p.x, area.x) || !inside(p.z, area.z)) {
    console.error(`[walkmap] point ${p.x},${p.z} lies outside the area x ${area.x.join('..')} z ${area.z.join('..')}`);
    process.exit(2);
  }
}

const qs = ['play=1', 'nowarm=1', 'nohelp=1'];
if (opt.doors) qs.push(`doors=${encodeURIComponent(opt.doors)}`);
const release = opt.lock === 'true' ? await acquireGpuLock({ label: 'walkmap' }) : null;
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor({ ...opt, step: opt['step-name'] ?? opt.stepname }, 'walkmap') });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.addInitScript(PAGE_HELPERS);
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(pageUrl(`/?${qs.join('&')}`, opt.port ?? 5180), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000, polling: 250 });
  const result = await page.evaluate(async (area) => {
    // import three from the exact URL the app loaded (same module instance as the collision world), wherever the
    // server keeps its deps cache (node_modules/.vite on 5180, .shots/.vite on the house test servers)
    const dep = (name) => window.__hus?.depUrl(name) ?? '/node_modules/.vite/deps/' + name;
    const THREE = await import(dep('three.js')).catch(() => null);
    const { Capsule } = await import(dep('three_addons_math_Capsule__js.js')).catch(() => ({}));
    const { PLAYER } = await import('/src/config.js');
    const { MOVE } = await import('/src/player/PlayerController.js');
    const col = window.__game.collision;
    if (!THREE || !Capsule) return { error: 'could not import three / Capsule from the vite deps cache' };
    const r = PLAYER.radius;
    const STEP = MOVE.stepHeight;
    const nx = Math.round((area.x[1] - area.x[0]) / area.step) + 1;
    const nz = Math.round((area.z[1] - area.z[0]) / area.step) + 1;
    const cap = new Capsule();
    const box = new THREE.Box3();
    const down = new THREE.Vector3(0, -1, 0);
    const ray = new THREE.Ray(new THREE.Vector3(), down);
    /** Is the capsule standing with its bottom at yFeet (head at floor + height) at (x, z) blocked? */
    const blockedAt = (x, z, yFeet, floor) => {
      const top = floor + PLAYER.height;
      cap.start.set(x, yFeet + r, z);
      cap.end.set(x, top - r, z);
      cap.radius = r;
      const hit = col.octree.capsuleIntersect(cap);
      if (hit && hit.depth > 0.01) return true;
      // capsule axis inside a box collider (no face within reach of the capsule deep inside a big box)
      if (col._staticBoxes.some((b) => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y > yFeet && b.min.y < top)) return true;
      box.min.set(x - r, yFeet, z - r);
      box.max.set(x + r, top, z + r);
      return col.dynamic.some((d) => d.enabled && !(area.ghost && d.furniture) && d.box.intersectsBox(box));
    };
    // per level: state 0 blocked, 1 free, 2 free only thanks to the step-up; gy = floor height of the cell
    const grids = area.levels.map((ly) => {
      const free = new Uint8Array(nx * nz);
      const gy = new Float32Array(nx * nz).fill(NaN);
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x = area.x[0] + i * area.step, z = area.z[0] + j * area.step;
          const k = j * nx + i;
          let floor = ly;
          if (area.autoY) {
            ray.origin.set(x, ly + 1.0, z);
            const hit = col.raycast(ray, 2.5, { includeDynamic: false, includeTerrain: true });
            if (!hit) continue;
            floor = hit.point.y;
          }
          if (!col.isWalkable(x, z, floor)) continue;
          if (blockedAt(x, z, floor + STEP + 0.01, floor)) continue;
          // ground present below? (pit / outside the building – it must be within 0.3 m)
          ray.origin.set(x, floor + 0.3, z);
          const g = col.raycast(ray, 0.6, { includeTerrain: true });
          if (!g || (area.ghost && g.dynamic?.furniture && !col.raycast(ray, 0.6, { includeTerrain: true, includeDynamic: false }))) continue;
          free[k] = blockedAt(x, z, floor + 0.01, floor) ? 2 : 1;
          gy[k] = floor;
        }
      }
      return { y: ly, free, gy };
    });
    const L = grids.length, N = nx * nz;
    const linkY = STEP + 0.05;
    const cellOf = (p) => {
      const i = Math.round((p.x - area.x[0]) / area.step), j = Math.round((p.z - area.z[0]) / area.step);
      let best = -1, bd = Infinity;
      for (let l = 0; l < L; l++) {
        const k = j * nx + i;
        if (!grids[l].free[k]) continue;
        const d = Math.abs(grids[l].gy[k] - p.y);
        if (d < bd) {
          bd = d;
          best = l;
        }
      }
      // nothing free under the point: report it on the nearest level
      if (best < 0) best = grids.reduce((b, g, l) => (Math.abs(g.y - p.y) < Math.abs(grids[b].y - p.y) ? l : b), 0);
      return { l: best, k: j * nx + i };
    };
    // flood fill from the start cell over (level, cell)
    const seen = grids.map(() => new Uint8Array(N));
    const s = cellOf(area.from);
    const q = [];
    const visit = (l, k) => {
      if (seen[l][k]) return;
      seen[l][k] = 1;
      q.push(l * N + k);
      // the same floor found from another level is the same place
      for (let m = 0; m < L; m++) {
        if (m !== l && !seen[m][k] && grids[m].free[k] && Math.abs(grids[m].gy[k] - grids[l].gy[k]) <= 0.05) {
          seen[m][k] = 1;
          q.push(m * N + k);
        }
      }
    };
    if (grids[s.l].free[s.k]) visit(s.l, s.k);
    while (q.length) {
      const v = q.pop();
      const l = Math.floor(v / N), k = v % N;
      const i = k % nx, j = (k - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const kk = b * nx + a;
        if (!grids[l].free[kk] || seen[l][kk]) continue;
        if (Math.abs(grids[l].gy[kk] - grids[l].gy[k]) > linkY) continue;
        visit(l, kk);
      }
    }
    const maps = grids.map((g, l) => {
      const rows = [];
      for (let j = 0; j < nz; j++) {
        let line = '';
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          line += !g.free[k] ? '#' : !seen[l][k] ? 'o' : g.free[k] === 2 ? '_' : '.';
        }
        rows.push(line);
      }
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < N; k++) if (g.free[k]) {
        lo = Math.min(lo, g.gy[k]);
        hi = Math.max(hi, g.gy[k]);
      }
      return { y: g.y, rows, floorRange: Number.isFinite(lo) ? [Math.round(lo * 1000) / 1000, Math.round(hi * 1000) / 1000] : null };
    });
    const targets = area.expect.map((t) => {
      const c = cellOf(t);
      return { label: t.label, level: grids[c.l].y, free: !!grids[c.l].free[c.k], floor: grids[c.l].free[c.k] ? Math.round(grids[c.l].gy[c.k] * 1000) / 1000 : null, reached: !!seen[c.l][c.k] };
    });
    return { maps, nx, nz, step: STEP, start: { level: grids[s.l].y, free: !!grids[s.l].free[s.k] }, targets };
  }, area);
  if (result.error) {
    console.error(result.error);
    code = 2;
  } else {
    const out = [];
    for (const m of result.maps) {
      out.push(`walkmap x ${area.x.join('..')} z ${area.z.join('..')} step ${area.step} level y ${m.y}${area.ghost ? ' (furniture ghost)' : ''}${area.autoY ? ` (auto-y, floors ${m.floorRange ? m.floorRange.join('..') : '-'})` : ''} (rows: −z → +z, like the plan)  '.' reachable from ${from.x},${from.y},${from.z}  '_' reachable over a step ≤ ${result.step} m  'o' free but unreachable  '#' blocked`);
      out.push(...m.rows);
    }
    if (!result.start.free) out.push(`[walkmap] the start cell ${from.x},${from.y},${from.z} is not free (level ${result.start.level})`);
    for (const t of result.targets) {
      out.push(`${t.reached ? 'ok  ' : 'FAIL'} target ${t.label} (level ${t.level}${t.free ? `, floor ${t.floor}` : ', cell blocked'})`);
      if (!t.reached) code = 2;
    }
    const text = out.join('\n');
    if (opt.out) writeFileSync(opt.out, text + '\n');
    console.log(text);
  }
} catch (e) {
  console.error(`[walkmap] ${e.message}`);
  code = 2;
} finally {
  await close();
  release?.();
}
process.exit(code);
