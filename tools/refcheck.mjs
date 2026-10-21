#!/usr/bin/env node
/**
 * The living room's regression check against the references of steg 2 (notes/hele-huset-design.md §0, §7.1, §7.5):
 * the same 12 screenshots and the same light/acoustics dump, compared with .shots/hus/ref/.
 *
 *   node tools/refcheck.mjs --port=525N --step=<step> [--lock] [--only=spawn,0_for,…] [--no-state] [--no-shots]
 *   node tools/refcheck.mjs --port=525N --make [--publish] [--lock]          (steg 2 / the integrator only)
 *
 * Views (1280×960, tools/shot.mjs --steps=120, so every frame is deterministic):
 *   the 8 photo cameras   /dev/sandbox.html?photo=<id>&orbit=0          --hide=#info,#labels
 *   spawn                 /?play=1&nowarm=1&nohelp=1                    --hide=#ui-root (the 3D view only)
 *   orbit-sor / orbit-nord   … &view=orbit&yaw=90 / &yaw=-90  (the dollhouse from the south-west / north-east)
 *   plan                  … &view=plan
 * Never with &doors=open (the references have every door as the room has it).
 *
 * Check (default): shots go to <worktree>/.shots/hus/<step>/ref-check/<name>.png and are compared with the reference by
 * tools/imgdiff.mjs (--tol=6, --max from ref/noise.json); a failed image also gets <name>.diff.png. Then
 * tools/dump-state.mjs --compare=<ref>/state.json. Exit code 1 when an image or the dump differs, 2 when a tool failed.
 * The reference folder: --ref=<dir>, else <worktree>/.shots/hus/ref when it holds noise.json, else the main tree's
 * C:\Dev\Interiørspillet\.shots\hus\ref (gitignored – steg 2 copied it there).
 *
 * Make (--make): every view twice (two separate browser runs) into <worktree>/.shots/hus/ref/<name>.png and
 * ref/take2/<name>.png; noise.json gets the diff between the takes per view and the limit max = 2 × the measured noise
 * (changed %, at least MIN_MAX = 0.005 % ≈ 61 px, so a few odd shadow-edge pixels cannot fail a check); state.json from dump-state (run twice, the
 * two dumps must be identical). --publish copies the finished folder to the main tree's .shots/hus/ref, file by file
 * over the old set, and only a full set (all 12 views + state.json; --only with --publish is refused). A worktree
 * without references is first seeded from the published ones, so --make --only=… re-makes just those views locally.
 * In a check without --only a view or state.json without a reference fails (exit 2) instead of being skipped.
 * Orbit and plan show the whole floor: from wave 1 on, steps check with --only=<the 8 photos>,spawn (§7.1) and the
 * integrator re-makes the full set after each approved wave.
 *
 * --lock passes --lock to every child run (the GPU lock is taken and released per screenshot / dump, never held for the
 * whole check, so other agents get their turn). Leave it out when you hold the lock yourself.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, ROOT, MAIN_ROOT } from './lib/hus.mjs';
import { diffFiles } from './imgdiff.mjs';

const { opt } = parseArgs();
const port = opt.port;
if (!port) {
  console.error('[refcheck] --port=525N is required (your own test server, never 5180)');
  process.exit(2);
}
const TOL = 6;
/**
 * Smallest limit (changed %): 0.005 % of 1280×960 ≈ 61 pixels. Two takes differed by up to 7 pixels (shadow edges in
 * 082827 / 082829), so 2 × that alone would make a check flaky; a real change (an object moved, a wall repainted, light
 * leaking in) changes thousands of pixels.
 */
const MIN_MAX = 0.005;
const PHOTOS = ['0_for', '20261018_082806', '20261018_082827', '20261018_082829', '20261018_082909', '20261018_082924', '20261018_083012', '20261018_083019'];
const GAME = '/?play=1&nowarm=1&nohelp=1';
const VIEWS = [
  ...PHOTOS.map((id) => ({ name: id, url: `/dev/sandbox.html?photo=${id}&orbit=0`, hide: '#info,#labels' })),
  { name: 'spawn', url: GAME, hide: '#ui-root' },
  { name: 'orbit-sor', url: `${GAME}&view=orbit&yaw=90`, hide: '#ui-root' },
  { name: 'orbit-nord', url: `${GAME}&view=orbit&yaw=-90`, hide: '#ui-root' },
  { name: 'plan', url: `${GAME}&view=plan`, hide: '#ui-root' },
];
const only = opt.only ? new Set(opt.only.split(',')) : null;
const views = VIEWS.filter((v) => !only || only.has(v.name));
const lock = opt.lock === 'true' ? ['--lock'] : [];
const step = opt.step ?? (opt.make === 'true' ? 's0-test' : null);
if (!step) {
  console.error('[refcheck] --step=<your step> is required (output goes to .shots/hus/<step>/ref-check/)');
  process.exit(2);
}

const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
function shot(v, out) {
  const r = node(['tools/shot.mjs', v.url, out, '--w=1280', '--h=960', `--port=${port}`, `--hide=${v.hide}`, '--steps=120', `--step=${step}`, ...lock]);
  const text = `${r.stdout}${r.stderr}`;
  const errors = text.split('\n').filter((l) => /^\[(console\.error|pageerror|page __error|shot)\]/.test(l));
  return { ok: r.status === 0 && existsSync(out), status: r.status, errors, text };
}
function dump(out, compare = null) {
  const args = ['tools/dump-state.mjs', `--port=${port}`, `--out=${out}`, `--step=${step}`, ...lock];
  if (compare) args.push(`--compare=${compare}`);
  const r = node(args);
  return { status: r.status, text: `${r.stdout}${r.stderr}`.trim() };
}

let code = 0;
const t0 = Date.now();
if (opt.make === 'true') {
  const REF = join(ROOT, '.shots', 'hus', 'ref');
  const MAIN_REF = join(MAIN_ROOT, '.shots', 'hus', 'ref');
  // a partial set must never replace the published one (later checks would only «skip» the missing views)
  if (only && opt.publish === 'true') {
    console.error('[refcheck] --make --only=… --publish is refused: publish only a full set (all 12 views and state.json)');
    process.exit(2);
  }
  // a worktree without references starts from the published ones, so --make --only=… re-makes just those views
  if (REF !== MAIN_REF && !existsSync(join(REF, 'noise.json')) && existsSync(join(MAIN_REF, 'noise.json'))) {
    cpSync(MAIN_REF, REF, { recursive: true });
    console.log(`seeded ${REF} from ${MAIN_REF}`);
  }
  mkdirSync(join(REF, 'take2'), { recursive: true });
  const noise = existsSync(join(REF, 'noise.json')) ? JSON.parse(readFileSync(join(REF, 'noise.json'), 'utf8')) : { views: {} };
  noise.made = new Date().toISOString();
  noise.tol = TOL;
  noise.minMax = MIN_MAX;
  noise.size = [1280, 960];
  noise.note = 'max = max(2 × changed between two takes, minMax) in percent of the pixels (imgdiff --tol=6); use: node tools/imgdiff.mjs ref.png new.png --tol=6 --max=<max>';
  if (!opt['no-shots']) {
    for (const v of views) {
      const a = join(REF, `${v.name}.png`), b = join(REF, 'take2', `${v.name}.png`);
      const ra = shot(v, a);
      const rb = ra.ok ? shot(v, b) : ra;
      if (!ra.ok || !rb.ok) {
        console.log(`FAIL ${v.name}: shot failed (exit ${ra.ok ? rb.status : ra.status})\n${(ra.ok ? rb : ra).text}`);
        code = 2;
        continue;
      }
      const d = diffFiles(a, b, { tol: TOL });
      const max = Math.max(MIN_MAX, Number((2 * d.changed).toFixed(4)));
      noise.views[v.name] = { url: v.url, hide: v.hide, changed: Number(d.changed.toFixed(5)), changedPixels: d.changedPixels, mean: Number(d.mean.toFixed(5)), rms: Number(d.rms.toFixed(4)), maxd: d.maxd, max, maxMean: Number(Math.max(0.01, 2 * d.mean).toFixed(4)) };
      console.log(`ref  ${v.name.padEnd(16)} noise changed ${d.changed.toFixed(4)} % (${d.changedPixels} px)  mean ${d.mean.toFixed(4)}  maxd ${d.maxd}  → max ${max}${ra.errors.length ? `  [${ra.errors.length} page error line(s)]` : ''}`);
      for (const e of [...ra.errors, ...rb.errors]) console.log(`     ${e}`);
    }
    writeFileSync(join(REF, 'noise.json'), JSON.stringify(noise, null, 1) + '\n');
  }
  if (!opt['no-state']) {
    const s1 = dump(join(REF, 'state.json'));
    const s2 = s1.status === 0 ? dump(join(REF, 'take2', 'state.json'), join(REF, 'state.json')) : s1;
    console.log(s1.text.split('\n').slice(-1)[0]);
    console.log(s2.text.split('\n').slice(-1)[0]);
    if (s1.status !== 0 || s2.status !== 0) {
      console.log(`FAIL state dump (exit ${s1.status}/${s2.status})\n${s2.text}`);
      code = code || 2;
    }
  }
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() || '?';
  writeFileSync(join(REF, 'README.txt'), [
    'Referanser for stua (notes/hele-huset-design.md §0, §7.1). Første sett: steg 2 (S0-test), fra koden på hele-huset før',
    'de andre stegene. Integratoren lager hele settet på nytt etter hver godkjent bølge (orbit og plan viser hele etasjen):',
    '  node tools/refcheck.mjs --port=5250 --make --publish --lock      (fra hovedtreet, aldri med --only)',
    `Sist laget ${new Date().toISOString()} fra ${ROOT} (git ${head})${only ? `, bare ${[...only].join(', ')}` : ''}.`,
    '',
    '<navn>.png        referansebildet (1280×960, tools/shot.mjs --steps=120)',
    'take2/<navn>.png  andre opptak av det samme (støymåling)',
    'noise.json        støy per bilde og grensen --max (2 × støy, minst 0,005 % ≈ 61 px), URL og --hide per bilde',
    'state.json        node tools/dump-state.mjs (LightManager-tall per foto-kamera kl. 08:30, 12, 20, 23 og akustikk)',
    '',
    'Sjekk et steg:  node tools/refcheck.mjs --port=525N --step=<steg> --lock',
    '',
  ].join('\n'));
  if (opt.publish === 'true' && code === 0) {
    const dst = MAIN_REF;
    const made = JSON.parse(readFileSync(join(REF, 'noise.json'), 'utf8'));
    const missing = [...VIEWS.filter((v) => !existsSync(join(REF, `${v.name}.png`)) || !made.views?.[v.name]).map((v) => v.name), ...(existsSync(join(REF, 'state.json')) ? [] : ['state.json'])];
    if (missing.length) {
      console.log(`FAIL publish refused: ${REF} lacks ${missing.join(', ')}`);
      code = 2;
    } else if (dst !== REF) {
      // file by file over the published folder (never rm first: an interrupted copy leaves the old set, not none)
      mkdirSync(dst, { recursive: true });
      cpSync(REF, dst, { recursive: true, force: true });
      console.log(`published → ${dst}`);
    }
  }
} else {
  const REF = opt.ref ?? (existsSync(join(ROOT, '.shots', 'hus', 'ref', 'noise.json')) ? join(ROOT, '.shots', 'hus', 'ref') : join(MAIN_ROOT, '.shots', 'hus', 'ref'));
  if (!existsSync(join(REF, 'noise.json'))) {
    console.error(`[refcheck] no references in ${REF} (noise.json missing)`);
    process.exit(2);
  }
  const noise = JSON.parse(readFileSync(join(REF, 'noise.json'), 'utf8'));
  const OUT = join(ROOT, '.shots', 'hus', step, 'ref-check');
  mkdirSync(OUT, { recursive: true });
  console.log(`references ${REF}`);
  const rows = [];
  if (!opt['no-shots']) {
    for (const v of views) {
      const ref = join(REF, `${v.name}.png`);
      const lim = noise.views?.[v.name];
      if (!existsSync(ref) || !lim) {
        // without --only every view must have a reference: a missing one would quietly weaken the regression
        if (only) console.log(`skip ${v.name}: no reference`);
        else {
          console.log(`FAIL ${v.name}: no reference in ${REF} (make the full set: refcheck --make --publish)`);
          code = 2;
        }
        continue;
      }
      const out = join(OUT, `${v.name}.png`);
      rmSync(out, { force: true });
      const r = shot({ ...v, url: lim.url ?? v.url, hide: lim.hide ?? v.hide }, out);
      if (!r.ok) {
        console.log(`FAIL ${v.name}: shot failed (exit ${r.status})\n${r.text}`);
        code = 2;
        continue;
      }
      const diffOut = join(OUT, `${v.name}.diff.png`);
      const d = diffFiles(ref, out, { tol: noise.tol ?? TOL, out: diffOut });
      const ok = d.changed <= lim.max + 1e-12;
      if (ok) rmSync(diffOut, { force: true });
      if (!ok && code === 0) code = 1;
      rows.push({ name: v.name, ok, d });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${v.name.padEnd(16)} changed ${d.changed.toFixed(4)} % (${d.changedPixels} px, max ${lim.max})  mean ${d.mean.toFixed(4)}  maxd ${d.maxd}  bbox ${d.bbox ? d.bbox.join(',') : '-'}${ok ? '' : `  → ${diffOut}`}`);
      for (const e of r.errors) console.log(`     ${e}`);
    }
  }
  if (!opt['no-state']) {
    if (!existsSync(join(REF, 'state.json'))) {
      console.log(`${only ? 'skip' : 'FAIL'} state: no state.json in the references`);
      if (!only) code = 2;
    } else {
      const s = dump(join(OUT, 'state.json'), join(REF, 'state.json'));
      const lines = s.text.split('\n');
      const diffAt = lines.findIndex((l) => l.startsWith('DIFF') || l.startsWith('same as'));
      console.log(`${s.status === 0 ? 'ok  ' : s.status === 1 ? 'FAIL' : 'ERR '} state            ${diffAt >= 0 ? lines.slice(diffAt, diffAt + 40).join('\n') : lines.slice(-3).join('\n')}`);
      if (s.status !== 0 && code !== 2) code = s.status === 1 ? 1 : 2;
    }
  }
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} images within the noise · ${code === 0 ? 'the living room is unchanged' : 'DIFFERENCES – see above'} · ${Math.round((Date.now() - t0) / 1000)} s`);
}
process.exit(code);
