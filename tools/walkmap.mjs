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
 *                          [--rooms] [--png=map.png] [--preset=hus] [--furniture=solid|ghost] [--lock]
 *                          [--step-name=<step>|--pidfile=<path>]
 *     --x / --z    area (world metres)          --step   grid spacing
 *     --y          floor height of the test (one level; --levels replaces it)
 *     --levels     several floor heights: one grid per level, printed one after the other
 *     --auto-y     the floor of each cell is found by a ray down from 1.0 m above the level instead of being the level's
 *                  height: stairs, ramps, steps and sunken floors get their real height. The ray of a level reaches
 *                  0.3 m below where the next lower level's ray starts (at least 2.5 m), so a stair between two levels
 *                  is seen from both in an overlap band. Two cells next to each other are connected when their floors
 *                  differ by at most the step height (+5 cm), and a cell found from two levels at the same height
 *                  (± 5 cm: a stair tread in the overlap band, the floor under the stair hole) is one cell – so the
 *                  fill can walk from one level to the other.
 *     --from       start cell x,z (on the first level) or x,y,z (on the level nearest y), inside the area; default
 *                  the spawn in the dining area (4.2, 4.0) – the old default 5,7.5 lies inside the dining table
 *     --furniture  solid (default): the furniture's boxes block, as for «Fysisk person»; ghost: they do not (the
 *                  game's default, CollisionWorld.ghostFurniture) – doors, walls and fixtures still block
 *     --expect     targets x,y,z separated by ';' that must be reachable from --from (the level nearest y, the
 *                  cell under x,z): prints ok / FAIL per target, exit code 2 if one is not reachable. A target whose
 *                  own cell is blocked (a piece of furniture on the spot) is moved to the nearest free cell within
 *                  0.3 m on the same floor (± 0.1 m), and the report says so
 *     --rooms      one more check per room of layout.house.rooms (every room of every level, not the stair's HUD
 *                  room) and for the forecourt (outsideHouse.forecourt): its free cells (cell centre inside the room's
 *                  polygon, floor within 0.4 m of the room's floor) and how many of them are reachable – FAIL (exit
 *                  code 2) when a room has none reachable
 *     --png        also writes the maps as a picture (one panel per level, rooms outlined and named, targets marked:
 *                  light = reachable, amber = reachable over a step, red = free but unreachable, dark = blocked)
 *     --preset=hus the whole house (steg 22 / 26, notes/hele-huset-design.md §7.4 with the avstemming's §6 points):
 *                  --levels=0,-2.55 --auto-y --x=0,13 --z=0,12 --doors=open --from=4.2,0,4.0 --rooms and the targets
 *                  gang 2.5,0,3.2 · bad 1.5,0,1.3 · soverom 1.5,0,5.7 · kjeller-gang 3.5,-2.55,3.8 · kjellerstue
 *                  3.5,-2.55,6.2 · vaskerom 1.3,-2.55,6.4 · soverom-kjeller 1.3,-2.55,10.2 · entré 7.4,-2.85,4.4 ·
 *                  ute 12.2,-2.87,4.6; with --step-name also --out / --png in .shots/hus/<step>/. Options given on the
 *                  command line win over the preset's
 *     --doors      passed on as ?doors= (main.js): open / closed / the listed doors open
 *     --lock       take the shared GPU lock around the run (leave it out when you hold it yourself)
 *     --pidfile / --step-name   where the browser PID is written (default .shots/hus/<step>/browser.pid)
 * Rows run −z (top) → +z, columns −x → +x – the same orientation as plantegning.png (top = east / kitchen,
 * bottom = west / TV-stue, left = north, right = south / big windows).
 * Exit codes: 0 ok, 2 error, an --expect target not reachable or (--rooms) a room with no reachable cell.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, pageUrl, launchBrowser, pidfileFor, acquireGpuLock, PAGE_HELPERS, ROOT } from './lib/hus.mjs';

/** The whole house (steg 22 + 26): both levels, the entrance and the forecourt, every door open. */
const PRESETS = {
  hus: {
    levels: '0,-2.55',
    'auto-y': 'true',
    x: '0,13',
    z: '0,12',
    doors: 'open',
    from: '4.2,0,4.0',
    rooms: 'true',
    expect: [
      '2.5,0,3.2', // gang
      '1.5,0,1.3', // bad
      '1.5,0,5.7', // soverom
      '3.5,-2.55,3.8', // kjeller-gang
      '3.5,-2.55,6.2', // kjellerstue
      '1.3,-2.55,6.4', // vaskerom
      '1.3,-2.55,10.2', // soverom-kjeller
      '7.4,-2.85,4.4', // entré
      '12.2,-2.87,4.6', // ute (spawnOutside, avstemming V32)
    ].join(';'),
  },
};

const { opt: cli } = parseArgs();
const preset = cli.preset ? PRESETS[cli.preset] : null;
if (cli.preset && !preset) {
  console.error(`[walkmap] unknown preset "${cli.preset}" – known: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(2);
}
const opt = { ...(preset ?? {}), ...cli };
const stepName = opt['step-name'] ?? opt.stepname ?? null;
if (preset && stepName) {
  opt.out ??= join(ROOT, '.shots', 'hus', stepName, `walkmap-${cli.preset}.txt`);
  opt.png ??= join(ROOT, '.shots', 'hus', stepName, `walkmap-${cli.preset}.png`);
}
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
const area = {
  x: nums(opt.x, [0, 7]),
  z: nums(opt.z, [0, 12]),
  step: Number(opt.step ?? 0.1),
  levels,
  autoY: opt['auto-y'] === 'true',
  from,
  expect,
  ghost: opt.furniture === 'ghost',
  rooms: opt.rooms === 'true',
  png: !!opt.png,
};
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
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor({ ...opt, step: stepName }, 'walkmap') });
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
    const H = window.__game.home?.layout?.house ?? null;
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
    // the auto-y ray of each level: from 1.0 above it down to 0.3 below the start of the next lower level's ray (at
    // least 2.5 m), so a stair between the two is seen from both levels in an overlap band (steg 22: with a fixed
    // 2.5 m the band −1.50 … −1.55 of the stair between 0 and −2.55 was seen from neither, and the fill never got down)
    const sorted = [...area.levels].sort((a, b) => b - a);
    const rayLen = (ly) => {
      const below = sorted.find((v) => v < ly - 1e-6);
      return below == null ? 2.5 : Math.max(2.5, ly + 1.0 - (below + 1.0) + 0.3);
    };
    // per level: state 0 blocked, 1 free, 2 free only thanks to the step-up; gy = floor height of the cell
    const grids = area.levels.map((ly) => {
      const free = new Uint8Array(nx * nz);
      const gy = new Float32Array(nx * nz).fill(NaN);
      const far = rayLen(ly);
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x = area.x[0] + i * area.step, z = area.z[0] + j * area.step;
          const k = j * nx + i;
          let floor = ly;
          if (area.autoY) {
            ray.origin.set(x, ly + 1.0, z);
            const hit = col.raycast(ray, far, { includeDynamic: false, includeTerrain: true });
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
    const cellIndex = (x, z) => ({ i: Math.round((x - area.x[0]) / area.step), j: Math.round((z - area.z[0]) / area.step) });
    const inGrid = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz;
    /** The (level, cell) under a point: the level whose floor there is nearest the point's y. */
    const cellOf = (p) => {
      const { i, j } = cellIndex(p.x, p.z);
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
      return { l: best, k: j * nx + i, dy: bd };
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
        if (!inGrid(a, b)) continue;
        const kk = b * nx + a;
        if (!grids[l].free[kk] || seen[l][kk]) continue;
        if (Math.abs(grids[l].gy[kk] - grids[l].gy[k]) > linkY) continue;
        visit(l, kk);
      }
    }
    const round = (v) => Math.round(v * 1000) / 1000;
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
      return { y: g.y, rows, floorRange: Number.isFinite(lo) ? [round(lo), round(hi)] : null, ray: area.autoY ? round(rayLen(g.y)) : null };
    });

    /**
     * A target: its own cell, or – when that is blocked (furniture on the spot) – the nearest free cell within 0.3 m
     * whose floor is within 0.1 m of the target's y.
     */
    const SNAP = 0.3;
    const targets = area.expect.map((t) => {
      let c = cellOf(t);
      let snapped = null;
      const usable = (cc) => grids[cc.l].free[cc.k] && Math.abs(grids[cc.l].gy[cc.k] - t.y) <= 0.1 + 1e-6;
      if (!usable(c)) {
        const { i, j } = cellIndex(t.x, t.z);
        const R = Math.ceil(SNAP / area.step);
        let best = null;
        for (let dj = -R; dj <= R; dj++) {
          for (let di = -R; di <= R; di++) {
            const a = i + di, b = j + dj;
            const d = Math.hypot(di, dj) * area.step;
            if (!inGrid(a, b) || d > SNAP + 1e-9) continue;
            const kk = b * nx + a;
            for (let l = 0; l < L; l++) {
              const cc = { l, k: kk };
              if (!usable(cc)) continue;
              const score = d + (seen[l][kk] ? 0 : 1000);
              if (!best || score < best.score) best = { ...cc, score, d, x: area.x[0] + a * area.step, z: area.z[0] + b * area.step };
            }
          }
        }
        if (best) {
          c = best;
          snapped = { x: round(best.x), z: round(best.z), d: round(best.d) };
        }
      }
      const g = grids[c.l];
      return { label: t.label, level: g.y, free: !!g.free[c.k], floor: g.free[c.k] ? round(g.gy[c.k]) : null, reached: !!seen[c.l][c.k], snapped };
    });

    // per room (and the forecourt): free cells inside its polygon on its floor, and how many of them are reachable
    const places = [];
    if (area.rooms && H) {
      for (const rm of H.rooms || []) {
        if (rm.hud || !rm.polygon || rm.polygon.length < 3) continue;
        places.push({ id: rm.id, name: rm.name, levelName: rm.levelName, floorY: rm.floorY, poly: rm.polygon.map((p) => [p.x, p.y]), contains: (x, z) => rm.contains(x, z) });
      }
      const oh = H.outsideHouse ?? null;
      const fc = oh?.forecourt?.polygon;
      if (Array.isArray(fc) && fc.length >= 3) {
        const poly = fc.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y ?? p.z]));
        const inPoly = (x, z) => {
          let c = false;
          for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
            const [xa, za] = poly[a], [xb, zb] = poly[b];
            if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) c = !c;
          }
          return c;
        };
        places.push({ id: 'forplass', name: 'Forplassen', levelName: 'Ute', floorY: oh.forecourt.y ?? oh.entranceLevelY ?? -2.87, poly, contains: inPoly });
      }
    }
    const rooms = places.map((p) => {
      let free = 0, reached = 0;
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x = area.x[0] + i * area.step, z = area.z[0] + j * area.step;
          if (!p.contains(x, z)) continue;
          const k = j * nx + i;
          let isFree = false, isSeen = false;
          for (let l = 0; l < L; l++) {
            if (!grids[l].free[k] || Math.abs(grids[l].gy[k] - p.floorY) > 0.4) continue;
            isFree = true;
            if (seen[l][k]) isSeen = true;
          }
          if (isFree) free++;
          if (isSeen) reached++;
        }
      }
      return { id: p.id, name: p.name, levelName: p.levelName, floorY: round(p.floorY), free, reached };
    });

    // the picture: one panel per level, rows −z → +z and columns −x → +x like the ASCII map
    let png = null;
    if (area.png) {
      const S = 5, M = 34, GAP = 30;
      const pw = nx * S, ph = nz * S;
      const cv = document.createElement('canvas');
      cv.width = M + L * pw + (L - 1) * GAP + 16;
      cv.height = M + ph + 74;
      const c2 = cv.getContext('2d');
      c2.fillStyle = '#f7f5f0';
      c2.fillRect(0, 0, cv.width, cv.height);
      const COL = { 0: '#3a3a3e', 1: '#e9e3d6', 2: '#e2b04a', o: '#c8504a' };
      const levelOf = (y) => (H?.levelAt ? H.levelAt(y + 0.9) : null);
      grids.forEach((g, l) => {
        const ox = M + l * (pw + GAP), oy = M;
        for (let j = 0; j < nz; j++) {
          for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            c2.fillStyle = !g.free[k] ? COL[0] : !seen[l][k] ? COL.o : COL[g.free[k]];
            c2.fillRect(ox + i * S, oy + j * S, S, S);
          }
        }
        const px = (x) => ox + ((x - area.x[0]) / area.step + 0.5) * S;
        const pz = (z) => oy + ((z - area.z[0]) / area.step + 0.5) * S;
        const lv = levelOf(g.y);
        c2.lineWidth = 1.5;
        c2.font = '11px sans-serif';
        c2.textAlign = 'center';
        for (const p of places) {
          const pl = levelOf(p.floorY);
          if (p.id !== 'forplass' && lv && pl && pl.id !== lv.id) continue;
          if (p.id === 'forplass' && Math.abs(g.y - p.floorY) > 1.0) continue;
          c2.strokeStyle = '#2f6fb0';
          c2.beginPath();
          p.poly.forEach(([x, z], n) => (n ? c2.lineTo(px(x), pz(z)) : c2.moveTo(px(x), pz(z))));
          c2.closePath();
          c2.stroke();
          const cx = p.poly.reduce((s2, q2) => s2 + q2[0], 0) / p.poly.length, cz = p.poly.reduce((s2, q2) => s2 + q2[1], 0) / p.poly.length;
          c2.fillStyle = '#123a63';
          c2.fillText(p.name, px(cx), pz(cz));
        }
        const mark = (x, z, colr, rad) => {
          c2.strokeStyle = colr;
          c2.lineWidth = 2.5;
          c2.beginPath();
          c2.arc(px(x), pz(z), rad, 0, Math.PI * 2);
          c2.stroke();
        };
        if (s.l === l) mark(area.from.x, area.from.z, '#1d8a3a', 7);
        area.expect.forEach((t, n) => {
          const tr = targets[n];
          if (Math.abs(tr.level - g.y) > 1e-6) return;
          mark(tr.snapped?.x ?? t.x, tr.snapped?.z ?? t.z, tr.reached ? '#1d6fd1' : '#d11d1d', 5);
        });
        c2.fillStyle = '#222';
        c2.textAlign = 'left';
        c2.font = 'bold 13px sans-serif';
        c2.fillText(`${lv?.name ?? 'nivå'} (y ${g.y}${area.autoY ? ', auto-y' : ''})`, ox, oy - 18);
        c2.font = '11px sans-serif';
        c2.fillText(`x ${area.x[0]} → ${area.x[1]} (nord → sør), z ${area.z[0]} ↓ ${area.z[1]} (øst → vest)`, ox, oy - 5);
      });
      c2.font = '12px sans-serif';
      c2.textAlign = 'left';
      const ly = M + ph + 22;
      const legend = [[COL[1], 'nåbar'], [COL[2], 'nåbar over et trinn'], [COL.o, 'fri, men ikke nåbar'], [COL[0], 'sperret']];
      let lx = M;
      for (const [cl, txt] of legend) {
        c2.fillStyle = cl;
        c2.fillRect(lx, ly - 10, 14, 14);
        c2.fillStyle = '#222';
        c2.fillText(txt, lx + 19, ly + 2);
        lx += 40 + c2.measureText(txt).width;
      }
      c2.fillText(`grønn ring = start ${area.from.x},${area.from.y},${area.from.z} · blå ring = mål nådd · rød ring = mål ikke nådd · rutenett ${area.step} m · møbler ${area.ghost ? 'spøkelse' : 'faste'}`, M, ly + 24);
      png = cv.toDataURL('image/png').split(',')[1];
    }
    return { maps, nx, nz, step: STEP, start: { level: grids[s.l].y, free: !!grids[s.l].free[s.k] }, targets, rooms, png };
  }, area);
  if (result.error) {
    console.error(result.error);
    code = 2;
  } else {
    const out = [];
    for (const m of result.maps) {
      out.push(`walkmap x ${area.x.join('..')} z ${area.z.join('..')} step ${area.step} level y ${m.y}${area.ghost ? ' (furniture ghost)' : ''}${area.autoY ? ` (auto-y, ray ${m.ray} m, floors ${m.floorRange ? m.floorRange.join('..') : '-'})` : ''} (rows: −z → +z, like the plan)  '.' reachable from ${from.x},${from.y},${from.z}  '_' reachable over a step ≤ ${result.step} m  'o' free but unreachable  '#' blocked`);
      out.push(...m.rows);
    }
    if (!result.start.free) {
      out.push(`[walkmap] the start cell ${from.x},${from.y},${from.z} is not free (level ${result.start.level})`);
      code = 2;
    }
    for (const t of result.targets) {
      const snap = t.snapped ? `, own cell blocked – nearest free cell ${t.snapped.x},${t.snapped.z} (${t.snapped.d} m away)` : '';
      out.push(`${t.reached ? 'ok  ' : 'FAIL'} target ${t.label} (level ${t.level}${t.free ? `, floor ${t.floor}` : ', cell blocked'}${snap})`);
      if (!t.reached) code = 2;
    }
    if (area.rooms) {
      if (!result.rooms.length) out.push('[walkmap] --rooms: no rooms in layout.house');
      for (const rm of result.rooms) {
        const ok = rm.reached > 0;
        const pct = rm.free ? Math.round((100 * rm.reached) / rm.free) : 0;
        out.push(`${ok ? 'ok  ' : 'FAIL'} room ${rm.id.padEnd(16)} ${`${rm.name} (${rm.levelName})`.padEnd(28)} floor ${rm.floorY.toFixed(2).padStart(5)}  free cells ${String(rm.free).padStart(4)}  reachable ${String(rm.reached).padStart(4)} (${pct} %)`);
        if (!ok) code = 2;
      }
    }
    const text = out.join('\n');
    if (opt.out) {
      mkdirSync(dirname(resolve(opt.out)), { recursive: true });
      writeFileSync(opt.out, text + '\n');
    }
    if (opt.png && result.png) {
      mkdirSync(dirname(resolve(opt.png)), { recursive: true });
      writeFileSync(opt.png, Buffer.from(result.png, 'base64'));
      out.push(`saved ${opt.png}`);
    }
    // with --out the maps are in the file: print only the report lines
    console.log(opt.out ? out.filter((l) => !/^[#._o]+$/.test(l)).join('\n') + `\nsaved ${opt.out}` : out.join('\n'));
  }
} catch (e) {
  console.error(`[walkmap] ${e.message}`);
  code = 2;
} finally {
  await close();
  release?.();
}
process.exit(code);
