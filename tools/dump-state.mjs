#!/usr/bin/env node
/**
 * The living room's light and acoustics as JSON (notes/hele-huset-design.md §0, §7.1): LightManager numbers per photo
 * camera and time of day, plus the acoustics – so every step can show that the living room is unchanged.
 *
 *   node tools/dump-state.mjs --port=525N [--out=state.json] [--compare=ref.json] [--tol=1e-6]
 *                             [--cams=all|<id>,<id>] [--hours=8.5,12,20,23] [--date=10,18] [--steps=120] [--lock]
 *
 * Loads dev/sandbox.html?orbit=0 (today's design, saves read-only), stops its frame loop and, for every photo camera of
 * the layout (layout.photoCameras – the living room's 8) and every hour (default 08:30, 12, 20, 23 on 18 October, mode
 * auto): puts the camera there, sets the time, frees every light slot and lets exposure, white balance and ambient
 * snap to the new solve (so a sample never depends on the one before), runs --steps fixed steps of 1/60 s
 * (home.update, a render every 10 steps so the environment map is rebuilt as in the game) plus one, and records
 * (under cameras.<id>.hours["08:30"] …)
 *   Lkey, S, Starget, whiteBalance [r,g,b], whiteK, wbInfo, info() (daylight, lamps on, lumens, sun …), ambient,
 *   environmentIntensity, the light pools (slot → candidate id + intensity, the selected light places), rt60.
 * Top level: acoustics (rt60, absorption, volume, baseline), layout volume / floorArea / zones / walls / windows, and
 * stats (env builds).
 *
 * --compare=ref.json  compares with an earlier dump: numbers within --tol (relative, default 1e-6; |a−b| ≤ tol·max(1,|a|)),
 *                     strings / booleans / slot ids exactly. Prints every difference; exit code 1 when there is one.
 * Exit codes: 0 ok, 1 differences, 2 the page failed.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { parseArgs, ensureDir, pageUrl, launchBrowser, pidfileFor, watchPage, waitReady, acquireGpuLock, PAGE_HELPERS } from './lib/hus.mjs';

const { opt } = parseArgs();
const port = opt.port ?? 5180;
const hours = (opt.hours ?? '8.5,12,20,23').split(',').map(Number);
const [month, day] = (opt.date ?? '10,18').split(',').map(Number);
const steps = Number(opt.steps ?? 120);
const tol = Number(opt.tol ?? 1e-6);

const release = opt.lock === 'true' ? await acquireGpuLock({ label: 'dump-state' }) : null;
const { browser, close } = await launchBrowser({ channel: opt.browser ?? 'msedge', pidfile: pidfileFor(opt, 'dump-state') });
let code = 0;
let dump = null;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.addInitScript(PAGE_HELPERS);
  const watch = watchPage(page, { quiet: true });
  await page.goto(pageUrl('/dev/sandbox.html?orbit=0', port), { waitUntil: 'domcontentloaded' });
  const err = await waitReady(page);
  if (err) throw new Error(`page error: ${err}`);
  dump = await page.evaluate(async ({ hours, month, day, steps, cams }) => {
    const sb = window.__sandbox;
    const { home, camera } = sb;
    const L = home.lighting;
    const layout = home.layout;
    window.__hus.stop();
    const r6 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(9)) : v);
    const { computeAcoustics } = await import('/src/design/Acoustics.js');
    const acoustics = () => {
      const a = computeAcoustics(home.design, home);
      return { rt60: r6(a.rt60), absorption: r6(a.absorption), volume: r6(a.volume), baseline: r6(a.baseline), roomAbsorption: r6(a.roomAbsorption) };
    };
    const list = cams === 'all' ? layout.photoCameras : layout.photoCameras.filter((c) => cams.split(',').includes(c.id));
    const freeSlots = () => {
      for (const kind of ['point', 'spot', 'rect']) {
        for (const s of L._pool[kind]) {
          if (s.cand) s.cand.slot = null;
          s.cand = null;
          s.light.intensity = 0;
        }
      }
      L._selectAt = -1e9;
    };
    const slots = () => {
      const out = {};
      for (const kind of ['point', 'spot', 'rect']) {
        out[kind] = L._pool[kind].map((s) => (s.cand && s.light.intensity > 0 ? { id: s.cand.id, I: r6(s.light.intensity) } : null));
      }
      return out;
    };
    const sample = () => {
      const info = L.info();
      const wb = L._wb;
      return {
        Lkey: r6(L._Lkey),
        S: r6(L.stats.S),
        Starget: r6(L._Starget),
        whiteBalance: [r6(wb.r), r6(wb.g), r6(wb.b)],
        whiteK: L._wbK ? [...L._wbK] : null,
        wbInfo: L._wbInfo ? { dayShare: r6(L._wbInfo.dayShare), lampShare: r6(L._wbInfo.lampShare), lampWeight: r6(L._wbInfo.lampWeight) } : null,
        info: {
          effective: info.effective,
          sunAltitudeDeg: r6(info.sunAltitudeDeg),
          sunInRoom: info.sunInRoom,
          indoorDaylightLux: info.indoorDaylightLux,
          outdoorLux: info.outdoorLux,
          lampsOnByDefault: info.lampsOnByDefault,
          lampLumens: info.lampLumens,
        },
        ambient: r6(L.ambient?.intensity),
        environmentIntensity: r6(sb.scene.environmentIntensity),
        sun: r6(L.sun?.intensity),
        slots: slots(),
        rt60: acoustics().rt60,
      };
    };
    const cameras = {};
    for (const pc of list) {
      camera.position.copy(pc.pos);
      camera.rotation.set(pc.rotation.x, pc.rotation.y, pc.rotation.z, 'YXZ');
      camera.fov = pc.vfovDeg;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const perHour = {};
      for (const hour of hours) {
        home.design.setEnv({ hour, month, day, mode: 'auto' });
        freeSlots();
        // no easing from the previous sample: exposure, white balance and ambient snap to the new solve
        L._S = null;
        L._ambNow = null;
        window.__hus.step(1, 1 / 60, { render: false });
        L._wb.copy(L._wbTarget);
        L._applyDirty = true;
        // a render every 10 steps, like frames: the environment map is rebuilt (throttled) as in the game
        for (let i = 1; i < steps; i += 10) window.__hus.step(Math.min(10, steps - i), 1 / 60, { render: true });
        window.__hus.step(1, 1 / 60, { render: false });
        const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60);
        perHour[`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`] = sample();
      }
      cameras[pc.id] = { pos: pc.pos.toArray().map(r6), hours: perHour };
    }
    window.__hus.step(1);
    return {
      version: 1,
      date: { month, day },
      hours,
      steps,
      acoustics: acoustics(),
      layout: {
        volume: r6(layout.volume),
        floorArea: r6(layout.floorArea),
        zones: layout.zones.length,
        walls: layout.walls.length,
        windows: layout.windows.length,
        doors: layout.doors.length,
        photoCameras: layout.photoCameras.length,
        lightGroups: (layout.lightGroups || []).map((g) => g.id),
      },
      pools: { point: L._pool.point.length, spot: L._pool.spot.length, rect: L._pool.rect.length },
      cameras,
    };
  }, { hours, month, day, steps, cams: opt.cams ?? 'all' });
  if (watch.errors) console.log(`[dump-state] ${watch.errors} console error(s) on the page`);
} catch (e) {
  console.error(`[dump-state] ${e.message}`);
  code = 2;
} finally {
  await close();
  release?.();
}

if (dump) {
  const text = JSON.stringify(dump, null, 1) + '\n';
  if (opt.out) {
    ensureDir(opt.out);
    writeFileSync(opt.out, text);
    console.log(`saved ${opt.out}`);
  }
  const c0 = Object.values(dump.cameras)[0];
  const h0 = c0 ? Object.values(c0.hours)[0] : null;
  console.log(`rt60 ${dump.acoustics.rt60} · volume ${dump.layout.volume} · floor ${dump.layout.floorArea} · ${Object.keys(dump.cameras).length} cameras × ${dump.hours.length} hours${h0 ? ` · first: Lkey ${h0.Lkey} S ${h0.S}` : ''}`);
  if (opt.compare) {
    const ref = JSON.parse(readFileSync(opt.compare, 'utf8'));
    const diffs = [];
    const walk = (a, b, path) => {
      if (typeof a === 'number' && typeof b === 'number') {
        if (Math.abs(a - b) > tol * Math.max(1, Math.abs(a))) diffs.push(`${path}: ${a} → ${b}`);
      } else if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
        if (a.length !== b.length) diffs.push(`${path}: length ${a.length} → ${b.length}`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`);
      } else if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (!(k in b)) diffs.push(`${path}.${k}: missing in the new dump`);
          else if (!(k in a)) diffs.push(`${path}.${k}: new (${JSON.stringify(b[k]).slice(0, 80)})`);
          else walk(a[k], b[k], `${path}.${k}`);
        }
      } else if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    };
    walk(ref, dump, 'state');
    if (diffs.length) {
      console.log(`DIFF ${diffs.length} difference(s) against ${opt.compare}:`);
      for (const d of diffs.slice(0, 200)) console.log('  ' + d);
      if (diffs.length > 200) console.log(`  … ${diffs.length - 200} more`);
      if (code === 0) code = 1;
    } else console.log(`same as ${opt.compare} (tol ${tol})`);
  }
}
process.exit(code);
