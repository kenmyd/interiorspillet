#!/usr/bin/env node
/**
 * Walkability map: loads the game headless (/?play=1), tests the player capsule (config.js PLAYER) on a grid of floor
 * positions against the collision world and prints a top-down ASCII map plus reachability from a start point (flood
 * fill over free cells). Requires the dev server (`npm run dev`, port 5180; --port= for another).
 *
 * A cell is blocked ('#') when the player may not stand there (CollisionWorld.isWalkable: world bounds, deep water),
 * when the capsule – lifted by the step height (PlayerController MOVE.stepHeight), so the floor and steps up to it are
 * no obstacle – touches a static triangle or an enabled dynamic box, when its axis lies inside a static box collider
 * (deep inside a big box no face is within reach), or when there is no ground within 0.3 m below. A second test with
 * the capsule standing on the floor marks free cells that only the step-up makes free ('_': low obstacle or step).
 *
 * Usage:
 *   node tools/walkmap.mjs [--x=0,7] [--z=0,12] [--step=0.1] [--y=0] [--from=5,7.5] [--out=map.txt] [--port=5180]
 *     --x / --z   area (world metres)          --step   grid spacing
 *     --y         floor height of the test     --from   start cell for the reachability fill (x,z), inside the area
 * Rows run −z (top) → +z, columns −x → +x – the same orientation as plantegning.png (top = east / kitchen,
 * bottom = west / TV-stue, left = north, right = south / big windows).
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const opt = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const pair = (s, d) => (s ? s.split(',').map(Number) : d);
const area = { x: pair(opt.x, [0, 7]), z: pair(opt.z, [0, 12]), step: Number(opt.step ?? 0.1), y: Number(opt.y ?? 0), from: pair(opt.from, [5, 7.5]) };
const inside = (v, [a, b]) => v >= Math.min(a, b) - 1e-9 && v <= Math.max(a, b) + 1e-9;
if (!inside(area.from[0], area.x) || !inside(area.from[1], area.z)) {
  console.error(`[walkmap] --from=${area.from} lies outside the area x ${area.x.join('..')} z ${area.z.join('..')}`);
  process.exit(2);
}

const browser = await chromium.launch({ channel: opt.browser ?? 'msedge', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${opt.port ?? 5180}/?play=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000, polling: 250 });
  const result = await page.evaluate(async (area) => {
    // import three from the exact URL the app loaded (same module instance as the collision world)
    const depUrl = (name) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/.vite/deps/' + name));
    const THREE = await import(depUrl('three.js') ?? '/node_modules/.vite/deps/three.js').catch(() => null);
    const { Capsule } = await import(depUrl('three_addons_math_Capsule__js.js') ?? '/node_modules/.vite/deps/three_addons_math_Capsule__js.js').catch(() => ({}));
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
    /** Is the capsule standing with its bottom at yFeet at (x, z) blocked by static / dynamic colliders? */
    const blockedAt = (x, z, yFeet) => {
      cap.start.set(x, yFeet + r, z);
      cap.end.set(x, area.y + PLAYER.height - r, z);
      cap.radius = r;
      const hit = col.octree.capsuleIntersect(cap);
      if (hit && hit.depth > 0.01) return true;
      // capsule axis inside a box collider (no face within reach of the capsule deep inside a big box)
      if (col._staticBoxes.some((b) => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y > yFeet && b.min.y < area.y + PLAYER.height)) return true;
      box.min.set(x - r, yFeet, z - r);
      box.max.set(x + r, area.y + PLAYER.height, z + r);
      return col.dynamic.some((d) => d.enabled && d.box.intersectsBox(box));
    };
    // 0 blocked, 1 free, 2 free only thanks to the step-up
    const free = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = area.x[0] + i * area.step, z = area.z[0] + j * area.step;
        let state = col.isWalkable(x, z) && !blockedAt(x, z, area.y + STEP + 0.01) ? 1 : 0;
        // ground present below? (pit / outside the building – it must be within 0.3 m)
        if (state && !col.raycast(new THREE.Ray(new THREE.Vector3(x, area.y + 0.3, z), down), 0.6, { includeTerrain: true })) state = 0;
        if (state && blockedAt(x, z, area.y + 0.01)) state = 2;
        free[j * nx + i] = state;
      }
    }
    // flood fill from the start cell
    const si = Math.round((area.from[0] - area.x[0]) / area.step), sj = Math.round((area.from[1] - area.z[0]) / area.step);
    const seen = new Uint8Array(nx * nz);
    const q = [];
    if (free[sj * nx + si]) { seen[sj * nx + si] = 1; q.push(sj * nx + si); }
    while (q.length) {
      const k = q.pop();
      const i = k % nx, j = (k - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const kk = b * nx + a;
        if (free[kk] && !seen[kk]) { seen[kk] = 1; q.push(kk); }
      }
    }
    const rows = [];
    for (let j = 0; j < nz; j++) {
      let s = '';
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        s += !free[k] ? '#' : !seen[k] ? 'o' : free[k] === 2 ? '_' : '.';
      }
      rows.push(s);
    }
    return { rows, nx, nz, step: STEP };
  }, area);
  if (result.error) {
    console.error(result.error);
    code = 2;
  } else {
    const header = `walkmap x ${area.x.join('..')} z ${area.z.join('..')} step ${area.step} (rows: −z → +z, like the plan)  '.' reachable from ${area.from}  '_' reachable over a step ≤ ${result.step} m  'o' free but unreachable  '#' blocked`;
    const text = [header, ...result.rows].join('\n');
    if (opt.out) writeFileSync(opt.out, text);
    console.log(text);
  }
} catch (e) {
  console.error(`[walkmap] ${e.message}`);
  code = 2;
} finally {
  await browser.close();
}
process.exit(code);
