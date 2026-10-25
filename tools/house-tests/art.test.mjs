#!/usr/bin/env node
/**
 * Art geometry, gallery walls, atlas packing and the art texture cache (design/art.md §3.6, §4.2, §5, §8.2;
 * design/upload.md §4, §14.2 item 1; MASTER §2.8). Node only (P04, ART-CORE):
 *   - artLayout reproduces the round-1 buildArt numbers (a verbatim copy of its formulas below = the back-compat fixture)
 *   - outerDims inverts artLayout; coverRect / containRect
 *   - galleryLayout / fitSet / spanRects / atlasUvRect / packAtlas / artResFor / canvasSize / quantAspect
 *   - ArtCache never disposes an entry in use
 *   - the motif registry (models/artmotifs.js) against the painter contract; the art-frame / art-set Defs of decor.js
 *   - geometry through a fake canvas (the builders need <canvas> only for the textures): the round-1 pictures keep the
 *     meshes, vertices, part boxes and material numbers of tools/fixtures/art-legacy-golden.json (the browser check of
 *     their pixels is tools/artcheck.mjs --mode=legacy); every frame profile, every gallery-wall layout, own pictures
 *   - the kunst catalogue data rules (art.md §7.1, MASTER D18/D50) and the «Fakta» rows (catalog/artfacts.js)
 *   - image params through DesignState save/load
 * Round targets (painter count, catalogue size) are info lines under QA_PARTIAL=1 and while their source has not
 * landed at all (no painters registered, the research not merged into src/data); everything else is strict.
 *
 *   node tools/house-tests/art.test.mjs   (or: node tools/test-house.mjs art)
 */
const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
const { ROOT, imp, check, section, near, done } = L;
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';

const t0 = Date.now();
const A = await imp('src/models/artlayout.js');
const { ArtCache, ART_BUDGET_PX } = await imp('src/models/artcache.js');
const {
  FRAME_W, FLOAT_GAP, ASPECT_RANGE, frameWidth, imageAspectOf, artLayout, outerDims, coverRect, containRect,
  FRAME_PROFILES, FRAME_OPTIONS, FRAME_PRESETS, PRINT_SIZES, LAYOUTS, LAYOUT_OPTIONS, DEFAULT_SET_MOTIFS,
  FRAME_W_MAX, MAT_W_RANGE, ART_DEPTH_MIN, BOX_LIP, HANGER_Z, SET_LIMITS, SET_LEDGE,
  galleryLayout, setBounds, fitSet, spanRects, atlasUvRect, PPM, ATLAS_MAX, artResFor, quantAspect, canvasSize, packAtlas,
} = A;

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------------------------------------------------------------------------------------------------------------
 * The round-1 builder (src/models/decor.js buildArt at c28070d, lines 2425-2475): the geometry numbers, copied verbatim.
 * This is the back-compat fixture – never "fix" it.
 * ------------------------------------------------------------------------------------------------------------------- */
const LEGACY_FRAME_W = { black: 0.015, oak: 0.022, white: 0.03, floater: 0.012 };
function legacyArt(spec) {
  const P = spec.params, M = spec.materials || {};
  const { w, h } = spec.dims;
  const depth = Math.max(0.008, num(P.depth, spec.dims.d));
  const style = P.frame ?? 'black';
  const fw0 = style === 'none' ? 0 : num(P.frameW, LEGACY_FRAME_W[style] ?? 0.02);
  const fw = clamp(fw0, 0, Math.min(w, h) * 0.2);
  const framed = fw > 0.001;
  const texture = P.texture || (P.mat ? 'paper' : 'canvas');
  const paperPrint = framed && (P.mat || texture === 'paper' || texture === 'photo');
  const matW = paperPrint && P.mat ? num(P.matW, Math.min(w, h) * 0.09) : 0;
  const innerW = w - 2 * fw, innerH = h - 2 * fw;
  const gap = framed && !paperPrint ? 0.005 : 0;
  const pw = Math.max(0.02, innerW - 2 * matW - 2 * gap), ph = Math.max(0.02, innerH - 2 * matW - 2 * gap);
  const o = { fw, framed, texture, paperPrint: !!paperPrint, matW, gap, innerW, innerH, openW: pw, openH: ph, aspect: pw / ph };
  if (!paperPrint) {
    const cd = framed ? Math.min(depth * 0.8, depth - 0.004) : depth;
    const z0 = framed ? depth - cd - 0.001 : 0;
    Object.assign(o, { cd, z0, planeW: pw - 0.001, planeH: ph - 0.001, printZ: z0 + cd + 0.0005 });
  } else {
    Object.assign(o, { planeW: pw + 0.004, planeH: ph + 0.004, printZ: Math.min(depth * 0.55, depth - 0.006) });
  }
  if (framed) {
    o.kind = M.frame || (style === 'oak' ? 'oak' : style === 'white' ? 'painted' : 'black-metal');
    o.step = style === 'oak' || style === 'white' ? 1 : 0;
  }
  return o;
}
/** Fields of `want` that differ from `got` (exact, or within tol). */
function diff(got, want, tol = 0) {
  const bad = [];
  for (const [k, v] of Object.entries(want)) {
    const g = got[k];
    const ok = typeof v === 'number' && tol > 0 ? Math.abs(g - v) <= tol : g === v;
    if (!ok) bad.push(`${k}: ${g} ≠ ${v}`);
  }
  return bad;
}
const spec = (dims, params, materials = {}) => ({ dims, params, materials });

// ---------------------------------------------------------------------------------------------------------------------
section('artLayout: fasit fra dagens buildArt (art.md §3.6)');
{
  // case → [dims, params, expected]; expected cd/z0 only for stretched canvases
  const FIX = [
    ['Gustin', { w: 0.8, d: 0.045, h: 1 }, { depth: 0.045, frame: 'white', frameW: 0.02, texture: 'relief' },
      { fw: 0.02, paperPrint: false, matW: 0, gap: 0.005, openW: 0.75, openH: 0.95, cd: 0.036, z0: 0.008, planeW: 0.749, planeH: 0.949, printZ: 0.0445 }],
    ['Labyrint', { w: 0.8, d: 0.04, h: 1.2 }, { depth: 0.04, frame: 'oak', frameW: 0.02, texture: 'relief' },
      { fw: 0.02, paperPrint: false, matW: 0, gap: 0.005, openW: 0.75, openH: 1.15, cd: 0.032, z0: 0.007, planeW: 0.749, planeH: 1.149, printZ: 0.0395 }],
    ['Ramor', { w: 0.9, d: 0.05, h: 1.2 }, { depth: 0.05, frame: 'black', frameW: 0.025, texture: 'painted' },
      { fw: 0.025, paperPrint: false, matW: 0, gap: 0.005, openW: 0.84, openH: 1.14, cd: 0.04, z0: 0.009, planeW: 0.839, planeH: 1.139, printZ: 0.0495 }],
    ['Mara', { w: 1.2, d: 0.045, h: 0.6 }, { depth: 0.045, frame: 'oak', frameW: 0.02, texture: 'painted' },
      { fw: 0.02, paperPrint: false, matW: 0, gap: 0.005, openW: 1.15, openH: 0.55, cd: 0.036, z0: 0.008, planeW: 1.149, planeH: 0.549, printZ: 0.0445 }],
    ['f-maleri', { w: 1, d: 0.035, h: 0.7 }, { motif: 'misty-trees', frame: 'none', frameW: 0, depth: 0.035, texture: 'canvas' },
      { fw: 0, paperPrint: false, matW: 0, gap: 0, openW: 1, openH: 0.7, cd: 0.035, z0: 0, planeW: 0.999, planeH: 0.699, printZ: 0.0355 }],
    ['Def-standard (uten depth)', { w: 0.8, d: 0.04, h: 1 }, { motif: 'abstract', frame: 'black', texture: 'canvas', seed: 1 },
      { fw: 0.015, paperPrint: false, matW: 0, gap: 0.005, openW: 0.76, openH: 0.96, cd: 0.032, z0: 0.007, planeW: 0.759, planeH: 0.959, printZ: 0.0395 }],
    ['papirtrykk med passepartout', { w: 0.5, d: 0.025, h: 0.7 }, { depth: 0.025, frame: 'black', mat: true, texture: 'canvas' },
      { fw: 0.015, paperPrint: true, matW: 0.045, gap: 0, openW: 0.38, openH: 0.58, planeW: 0.384, planeH: 0.584, printZ: 0.01375 }],
  ];
  for (const [name, dims, P, want] of FIX) {
    const got = artLayout(dims, P);
    const bad = diff(got, want, 1e-9);
    check(`${name}: ${Object.keys(want).length} tall som i dag`, !bad.length, bad.join(', '));
    const leg = legacyArt(spec(dims, { ...P, ...(P.depth === undefined ? { depth: 0.04 } : {}) })); // the Def default depth of today
    const bad2 = diff(got, Object.fromEntries(Object.entries(leg).filter(([k]) => k !== 'kind')));
    check(`${name}: identisk med kopien av dagens formler`, !bad2.length, bad2.join(', '));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
section('artLayout: samme tall som dagens buildArt over et rutenett av gamle parametre');
{
  const FRAMES = [undefined, 'none', 'black', 'oak', 'white', 'floater', 'ukjent-profil'];
  const FRAME_WS = [undefined, 0, 0.012, 0.05, 0.08];
  const MATS = [undefined, false, true];
  const MAT_WS = [undefined, 0.03, 0.12];
  const TEXTURES = [undefined, 'canvas', 'painted', 'relief', 'paper', 'photo'];
  const DIMS = [[0.8, 1], [1.2, 0.6], [0.3, 0.3], [2.4, 0.2], [0.2, 2.4], [1, 0.7]];
  const DEPTHS = [[undefined, 0.02], [undefined, 0.045], [0.035, 0.04], [0.1, 0.01]]; // [params.depth, dims.d]
  const EXTRA = [{}, { motif: 'abstract', fit: 'contain', imageAspect: 2.5 }, { motif: 'custom', fit: 'cover', imageAspect: 2.5 }, { motif: 'custom', fit: 'contain' }];
  let n = 0, firstBad = null, kindBad = null;
  for (const frame of FRAMES) for (const frameW of FRAME_WS) for (const mat of MATS) for (const matW of MAT_WS)
    for (const texture of TEXTURES) for (const [w, h] of DIMS) for (const [depth, d] of DEPTHS) for (const ex of EXTRA) {
      const P = { frame, frameW, mat, matW, texture, depth, ...ex };
      for (const k of Object.keys(P)) if (P[k] === undefined) delete P[k];
      const dims = { w, d, h };
      const got = artLayout(dims, P);
      const leg = legacyArt(spec(dims, P));
      const { kind, ...rest } = leg;
      const bad = diff(got, rest);
      if (leg.framed && got.kind !== kind) kindBad ??= `${JSON.stringify(P)} ${w}×${h}: kind ${got.kind} ≠ ${kind}`;
      if (bad.length && !firstBad) firstBad = `${JSON.stringify(P)} ${w}×${h}: ${bad.join(', ')}`;
      n++;
    }
  check(`${n} kombinasjoner: alle tall bit-identiske med dagens buildArt`, !firstBad, firstBad || '');
  check('rammemateriale uten materials.frame som i dag (svart metall / eik / malt)', !kindBad, kindBad || '');
}

// ---------------------------------------------------------------------------------------------------------------------
section('artLayout: nye profiler, dybde og grenser');
{
  const base = { w: 0.5, d: 0.025, h: 0.7 };
  for (const k of ['thin', 'alu', 'ornate']) {
    const Lk = artLayout(base, { frame: k, texture: 'paper' });
    check(`${k}: rammebredde ${FRAME_W[k]}, fire lister uten trinn`, Lk.fw === FRAME_W[k] && Lk.step === 0 && Lk.lipW === 0 && near(Lk.innerW, 0.5 - 2 * FRAME_W[k], 1e-12),
      JSON.stringify(Lk));
    check(`${k}: rammemateriale ${FRAME_PROFILES[k].kind}`, Lk.kind === FRAME_PROFILES[k].kind);
  }
  const box = artLayout({ w: 0.5, d: 0.05, h: 0.7 }, { frame: 'box', texture: 'paper', mat: true, matW: 0.05 });
  check('box: frontleppe fw·0,45 innenfor listene, åpningen innenfor leppa',
    near(box.lipW, 0.02 * BOX_LIP, 1e-12) && near(box.innerW, 0.5 - 2 * 0.02 * (1 + BOX_LIP), 1e-12) && near(box.openW, box.innerW - 0.1, 1e-12), JSON.stringify(box));
  check('box: papirtrykket ligger tilbaketrukket på dybde·0,3', near(box.printZ, 0.05 * 0.3, 1e-12) && box.paperPrint);
  check('box: tynn boks – trykket ligger aldri bak bakplata (≥ 4,5 mm)', artLayout({ w: 0.5, d: 0.01, h: 0.7 }, { frame: 'box', texture: 'paper' }).printZ >= 0.0045);
  const hg = artLayout({ w: 0.5, d: 0.02, h: 0.7 }, { frame: 'hanger', mat: true, matW: 0.05, texture: 'canvas' });
  check('hanger: plakaten er hele w × h, papirtrykk tvunget, uten passepartout',
    hg.paperPrint && hg.matW === 0 && hg.gap === 0 && hg.openW === 0.5 && hg.openH === 0.7 && hg.planeW === 0.5 && hg.planeH === 0.7 && hg.printZ === HANGER_Z,
    JSON.stringify(hg));
  check('hanger: standard overflate er papir', artLayout(base, { frame: 'hanger' }).texture === 'paper');
  check('hanger: lister fw = 16 mm, ingen sidelister (border 0)', hg.fw === FRAME_W.hanger && hg.innerW === 0.5);
  const poster = artLayout({ w: 0.5, d: 0.005, h: 0.7 }, { frame: 'none', texture: 'paper', edge: 'white' });
  check('plakat uten ramme (d 0,005): lerretsblokk 5 mm, trykk 0,5 mm foran', !poster.framed && poster.depth === 0.005 && poster.cd === 0.005 && near(poster.printZ, 0.0055, 1e-12),
    JSON.stringify(poster));
  check(`dybde: params.depth vinner, ellers dims.d, aldri under ${ART_DEPTH_MIN}`,
    artLayout({ w: 1, d: 0.03, h: 1 }, { depth: 0.05 }).depth === 0.05 && artLayout({ w: 1, d: 0.03, h: 1 }, {}).depth === 0.03 &&
    artLayout({ w: 1, d: 0.001, h: 1 }, {}).depth === ART_DEPTH_MIN && artLayout({ w: 1, h: 1 }, {}).depth === 0.04);
  check('tynn innrammet lerretsblokk får aldri negativ tykkelse', artLayout({ w: 1, d: 0.003, h: 1 }, { frame: 'black', texture: 'canvas' }).cd > 0);
  check(`rammebredde klemmes til ${FRAME_W_MAX} (Inspector-grensen)`, frameWidth({ frame: 'black', frameW: 0.2 }) === FRAME_W_MAX && artLayout({ w: 2, h: 2 }, { frame: 'black', frameW: 0.2 }).fw === FRAME_W_MAX);
  check('rammebredde 0 eller negativ = uten ramme, som i dag', !artLayout({ w: 1, h: 1 }, { frame: 'black', frameW: 0 }).framed && !artLayout({ w: 1, h: 1 }, { frame: 'black', frameW: -1 }).framed);
  check(`passepartout: eksplisitt matW klemmes til ${MAT_W_RANGE.join('–')}, standard 9 % urørt`,
    artLayout({ w: 1, h: 1 }, { frame: 'black', mat: true, matW: 0.5 }).matW === MAT_W_RANGE[1] &&
    artLayout({ w: 1, h: 1 }, { frame: 'black', mat: true, matW: 0.001 }).matW === MAT_W_RANGE[0] &&
    near(artLayout({ w: 2.4, h: 2.4 }, { frame: 'black', mat: true }).matW, 0.216, 1e-12));
  {
    // params.matH: the mat over and under (a 50 × 70 frame with a 40 × 50 window), unset = matW all round
    const R50 = { frame: 'thin', frameW: 0.012, texture: 'paper', mat: true, matW: 0.05 };
    const a = artLayout({ w: 0.52, d: 0.03, h: 0.72 }, { ...R50, matH: 0.1 }), b = artLayout({ w: 0.52, d: 0.03, h: 0.72 }, R50);
    const back = outerDims({ openW: 0.4, openH: 0.5, ...R50, matH: 0.1, depth: 0.03 });
    const L2 = artLayout(back, { ...R50, matH: 0.1 });
    check('passepartout over/under (matH): åpning 39,6 × 49,6 i 52 × 72, uten matH lik matW, klemmes, outerDims snur den',
      near(a.openW, 0.396, 1e-9) && near(a.openH, 0.496, 1e-9) && a.matH === 0.1 && b.matH === 0.05 && near(b.openH, 0.596, 1e-9) &&
      artLayout({ w: 1, h: 1 }, { frame: 'black', mat: true, matW: 0.05, matH: 0.5 }).matH === MAT_W_RANGE[1] &&
      artLayout({ w: 1, h: 1 }, { frame: 'black', texture: 'canvas', matH: 0.1 }).matH === 0 &&
      near(L2.openW, 0.4, 1e-4) && near(L2.openH, 0.5, 1e-4) &&
      JSON.stringify(outerDims({ openW: 0.4, openH: 0.5, ...R50 })) === JSON.stringify(outerDims({ openW: 0.4, openH: 0.5, ...R50, matH: 0.05 })),
      `${a.openW}×${a.openH} / ${JSON.stringify(back)} → ${L2.openW}×${L2.openH}`);
  }
  check('ukjente nøkler (constructor/toString) gir standard ramme, ikke NaN',
    artLayout({ w: 1, h: 1 }, { frame: 'constructor' }).fw === 0.02 && artLayout({ w: 1, h: 1 }, { frame: 'toString' }).kind === 'black-metal');
  check('params null / dims mangler: tåles (0,8 × 1, svart ramme)', artLayout(null, null).fw === 0.015 && artLayout(undefined).openW > 0);
  check('aspect = bildets synlige del', near(artLayout({ w: 0.8, h: 1 }, {}).aspect, 0.76 / 0.96, 1e-12));
  check('imageAspectOf: klemmes til ASPECT_RANGE, ellers null',
    imageAspectOf({ imageAspect: 9 }) === ASPECT_RANGE[1] && imageAspectOf({ imageAspect: 0.01 }) === ASPECT_RANGE[0] && imageAspectOf({}) === null && imageAspectOf(null) === null);
}

// ---------------------------------------------------------------------------------------------------------------------
section('outerDims ↔ artLayout (art.md §8.2 punkt 4, upload.md §14.2 punkt 1)');
{
  // ART round trip: print presets × profiles → artLayout(outerDims(x)).open = the print (1e-9)
  const PRESETS = ['21x30', '50x70', '70x100'].map((k) => PRINT_SIZES.find((s) => s.key === k));
  const PROFILES = [
    ['tynn + passepartout 5 cm', { frame: 'thin', mat: true, matW: 0.05, texture: 'paper' }],
    ['eik uten passepartout (lerret)', { frame: 'oak', mat: false, texture: 'canvas' }],
    ['uten ramme', { frame: 'none', texture: 'canvas' }],
    ['skyggefuge', { frame: 'floater', texture: 'canvas' }],
    ['plakatheng', { frame: 'hanger', texture: 'paper' }],
    ['boks + passepartout', { frame: 'box', mat: true, matW: 0.05, texture: 'paper' }],
    ['klassisk gull', { frame: 'ornate', mat: true, matW: 0.07, texture: 'photo' }],
  ];
  let worst = 0, where = '';
  for (const s of PRESETS) for (const [name, P] of PROFILES) for (const [pw, ph] of [[s.w, s.h], [s.h, s.w]]) {
    const dims = outerDims({ openW: pw, openH: ph, depth: 0.03, ...P });
    const Lx = artLayout(dims, P);
    const e = Math.max(Math.abs(Lx.openW - pw), Math.abs(Lx.openH - ph));
    if (e > worst) { worst = e; where = `${s.key} ${name}`; }
  }
  check(`trykkstørrelse → ytre mål → trykkstørrelse: avvik ≤ 1e-9 (størst ${worst.toExponential(1)} ${where})`, worst <= 1e-9);

  // UPLOAD FRAME_STYLES (design/upload.md §10, copied: imageArt.js belongs to P05) × mat × aspects, long edge 0.5
  const STYLES = {
    svart: { frame: 'black', frameW: 0.015, texture: 'photo', depth: 0.025, mat: true },
    hvit: { frame: 'black', frameW: 0.015, texture: 'photo', depth: 0.025, mat: true },
    eik: { frame: 'oak', frameW: 0.022, texture: 'photo', depth: 0.03, mat: true },
    valnott: { frame: 'oak', frameW: 0.022, texture: 'photo', depth: 0.03, mat: true },
    messing: { frame: 'black', frameW: 0.012, texture: 'photo', depth: 0.022, mat: true },
    bred: { frame: 'white', frameW: 0.035, texture: 'paper', depth: 0.035, mat: false },
    lerret: { frame: 'none', frameW: 0, texture: 'canvas', depth: 0.03, mat: null },
    skyggefuge: { frame: 'floater', frameW: 0.012, texture: 'canvas', depth: 0.04, mat: null },
    plakat: { frame: 'none', frameW: 0, texture: 'paper', depth: 0.005, mat: null },
  };
  const matWFor = (long) => (long < 0.35 ? 0.035 : long < 0.6 ? 0.05 : 0.07);
  let worst2 = 0, where2 = '', count = 0;
  for (const [key, st] of Object.entries(STYLES)) for (const matOn of st.mat === null ? [false] : [false, true]) for (const a of [0.5, 0.75, 1, 1.5, 3]) {
    const openW = a >= 1 ? 0.5 : 0.5 * a, openH = a >= 1 ? 0.5 / a : 0.5;
    const matW = matOn ? matWFor(0.5) : 0;
    const P = { frame: st.frame, frameW: st.frameW, mat: matOn, matW, texture: st.texture, depth: st.depth, motif: 'custom', imageAspect: a, fit: 'cover' };
    const dims = outerDims({ openW, openH, ...P });
    const Lx = artLayout(dims, P);
    const e = Math.max(Math.abs(Lx.openW - openW), Math.abs(Lx.openH - openH), Math.abs(Lx.picW - openW), Math.abs(Lx.picH - openH));
    if (e > worst2) { worst2 = e; where2 = `${key} mat=${matOn} a=${a}`; }
    count++;
  }
  check(`${count} rammestiler × passepartout × formater: åpningen tilbake ±1e-4 (størst ${worst2.toExponential(1)} ${where2})`, worst2 <= 1e-4);

  const capP = { frame: 'white', frameW: 0.035, mat: false, texture: 'paper' };
  const capD = outerDims({ openW: 0.1, openH: 0.075, ...capP });
  const capL = artLayout(capD, capP);
  check('20 %-taket inverteres: 10 cm bilde i «Bred hvit»', capL.fw < 0.035 && near(capL.fw, Math.min(capD.w, capD.h) * 0.2, 1e-9) &&
    near(capL.openW, 0.1, 1e-4) && near(capL.openH, 0.075, 1e-4), `${JSON.stringify(capD)} fw ${capL.fw}`);
  const capB = outerDims({ openW: 0.1, openH: 0.1, frame: 'box', frameW: 0.05, texture: 'paper' });
  check('20 %-taket inverteres også for boksramme med leppe', near(artLayout(capB, { frame: 'box', frameW: 0.05, texture: 'paper' }).openW, 0.1, 1e-4), JSON.stringify(capB));
  check('outerDims runder til 0,1 mm og tar dybden med', outerDims({ openW: 0.33333, openH: 0.5, frame: 'none', depth: 0.02 }).w === 0.3333 &&
    outerDims({ openW: 0.3, openH: 0.4, depth: 0.02 }).d === 0.02);

  // fit: 'contain'
  const P1 = { frame: 'black', frameW: 0.015, mat: true, matW: 0.05, texture: 'photo', motif: 'custom', imageAspect: 1.5, fit: 'contain' };
  const D1 = outerDims({ openW: 0.4, openH: 0.6, ...P1 });
  const C1 = artLayout(D1, P1);
  check('contain + passepartout: vinduet får bildets format og ligger inni åpningen',
    near(C1.picW / C1.picH, 1.5, 1e-9) && C1.picW <= C1.openW + 1e-12 && C1.picH <= C1.openH + 1e-12 && C1.draw === 'cover' &&
    near(C1.planeW, C1.picW + 0.004, 1e-12) && near(C1.aspect, 1.5, 1e-9), JSON.stringify(C1));
  const P2 = { frame: 'white', frameW: 0.035, mat: false, texture: 'paper', motif: 'custom', imageAspect: 1.5, fit: 'contain' };
  const C2 = artLayout({ w: 0.5, h: 0.7 }, P2);
  check('contain uten passepartout: draw = contain, bildet tegnes helt i åpningen', C2.draw === 'contain' && C2.picW === C2.openW);
  check('contain med nesten likt format: ingen endring (|ln| ≤ 0,01)', artLayout({ w: 0.5, h: 0.7 }, { ...P1, imageAspect: (0.5 - 0.03 - 0.1) / (0.7 - 0.03 - 0.1) }).draw === 'cover');
  const G = artLayout({ w: 0.8, h: 1 }, { frame: 'white', frameW: 0.02, texture: 'relief', fit: 'contain', imageAspect: 2 });
  check('motiver som ikke er «custom» ignorerer fit (Gustin-tallene)', near(G.openW, 0.75, 1e-12) && near(G.openH, 0.95, 1e-12) && G.picW === G.openW && G.draw === 'cover');
}

// ---------------------------------------------------------------------------------------------------------------------
section('coverRect / containRect');
{
  const fr = (r, sw, sh) => ({ sx: r.sx / sw, sy: r.sy / sh, sw: r.sw / sw, sh: r.sh / sh });
  const eq = (a, b) => Object.keys(b).every((k) => near(a[k], b[k], 1e-12));
  check('cover 3:2 i 1:1 → midtre 2/3 av bredden', eq(fr(coverRect(600, 400, 100, 100), 600, 400), { sx: 1 / 6, sy: 0, sw: 2 / 3, sh: 1 }));
  check('cover 1:2 i 1:1 → midtre halvdel av høyden', eq(fr(coverRect(200, 400, 100, 100), 200, 400), { sx: 0, sy: 0.25, sw: 1, sh: 0.5 }));
  check('cover 4:3 i 1:1', eq(coverRect(400, 300, 50, 50), { sx: 50, sy: 0, sw: 300, sh: 300 }));
  check('cover med fokus: fx 0 → venstre kant, fx 1 → høyre, utenfor klemmes', coverRect(400, 300, 50, 50, 0).sx === 0 && coverRect(400, 300, 50, 50, 1).sx === 100 && coverRect(400, 300, 50, 50, 7).sx === 100);
  check('contain 4:3 i 1:1 → hele bredden, sentrert i høyden', eq(containRect(400, 300, 100, 100), { dx: 0, dy: 12.5, dw: 100, dh: 75 }));
  check('contain med likt format → hele flaten', eq(containRect(300, 200, 150, 100), { dx: 0, dy: 0, dw: 150, dh: 100 }));
}

// ---------------------------------------------------------------------------------------------------------------------
section('Bildevegger: galleryLayout (art.md §4.2)');
const BBOX = {
  'pair-h': [1.06, 0.70], 'pair-v': [0.40, 0.66], triptych: [1.47, 0.90], 'row-3': [1.02, 0.40], 'row-4': [1.02, 0.30],
  'grid-2x2': [0.86, 1.06], 'grid-2x3': [1.02, 0.86], 'grid-2x4': [1.38, 0.86], 'grid-3x3': [1.02, 1.02], 'salon-5': [1.32, 0.76],
  'salon-7': [1.86, 0.76], 'salon-9': [1.95, 0.96], stair: [1.94, 1.384], ledge: [1.126, 0.52],
};
const COUNT = {
  'pair-h': 2, 'pair-v': 2, triptych: 3, 'row-3': 3, 'row-4': 4, 'grid-2x2': 4, 'grid-2x3': 6, 'grid-2x4': 8, 'grid-3x3': 9,
  'salon-5': 5, 'salon-7': 7, 'salon-9': 9, stair: 5, ledge: 4,
};
const rect = (f) => ({ x0: f.x - f.w / 2, x1: f.x + f.w / 2, y0: f.y - f.h / 2, y1: f.y + f.h / 2 });
const overlaps = (a, b, e = 1e-9) => a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.y0 < b.y1 - e && b.y0 < a.y1 - e;
const sep = (a, b) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
{
  check('LAYOUT_OPTIONS = custom + alle LAYOUTS (15)', LAYOUT_OPTIONS.length === 15 &&
    JSON.stringify(LAYOUT_OPTIONS.map(([k]) => k)) === JSON.stringify(['custom', ...Object.keys(LAYOUTS)]) && LAYOUT_OPTIONS.every(([, l]) => l));
  check('fasitlista dekker alle oppsett', JSON.stringify(Object.keys(BBOX).sort()) === JSON.stringify(Object.keys(LAYOUTS).sort()));
  for (const key of Object.keys(LAYOUTS)) {
    const G = galleryLayout(key, { gap: 0.06 });
    const b = setBounds(G.frames, G.ledge);
    const probs = [];
    if (G.layout !== key) probs.push(`layout ${G.layout}`);
    if (G.frames.length !== COUNT[key]) probs.push(`antall ${G.frames.length}`);
    if (!G.frames.every((f) => f.w > 0 && f.h > 0)) probs.push('w/h ≤ 0');
    if (!near(b.w, BBOX[key][0], 1e-6) || !near(b.h, BBOX[key][1], 1e-6)) probs.push(`bbox ${b.w.toFixed(4)} × ${b.h.toFixed(4)}`);
    if (!near(b.cx, 0, 1e-12) || !near(b.cy, 0, 1e-12)) probs.push(`ikke sentrert ${b.cx}, ${b.cy}`);
    const R = G.frames.map(rect);
    if (key !== 'ledge') {
      for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
        if (overlaps(R[i], R[j])) probs.push(`overlapp ${i}/${j}`);
        else if (sep(R[i], R[j]) < 0.06 - 1e-9) probs.push(`avstand ${i}/${j} = ${sep(R[i], R[j]).toFixed(4)}`);
      }
      if (!G.frames.every((f) => f.z === 0 && f.tilt === 0)) probs.push('z/tilt ≠ 0');
      if (G.ledge !== null) probs.push('ledge');
    }
    const M = galleryLayout(key, { gap: 0.06, mirror: true });
    if (!M.frames.every((f, i) => near(f.x, -G.frames[i].x, 1e-12) && near(f.y, G.frames[i].y, 1e-12) && f.w === G.frames[i].w && f.h === G.frames[i].h)) probs.push('speiling');
    check(`${key}: ${COUNT[key]} rammer, ${BBOX[key].join(' × ')} m, ingen overlapp, ≥ mellomrom, speilbar`, !probs.length, probs.join(', '));
  }
  const S5 = galleryLayout('salon-5', { gap: 0.1 });
  const b5 = setBounds(S5.frames);
  check('mellomrom 0,10: salongvegg 5 blir 1,40 × 0,80', near(b5.w, 1.4, 1e-12) && near(b5.h, 0.8, 1e-12));
  check(`mellomrom klemmes til ${SET_LIMITS.gap.join('–')}`,
    JSON.stringify(galleryLayout('row-3', { gap: 5 })) === JSON.stringify(galleryLayout('row-3', { gap: SET_LIMITS.gap[1] })) &&
    JSON.stringify(galleryLayout('row-3', { gap: 0 })) === JSON.stringify(galleryLayout('row-3', { gap: SET_LIMITS.gap[0] })) &&
    JSON.stringify(galleryLayout('row-3', { gap: 'x' })) === JSON.stringify(galleryLayout('row-3')));
  check('ukjent oppsett og «custom» uten rammer → salongvegg 5', galleryLayout('finnes-ikke').layout === 'salon-5' && galleryLayout('custom').layout === 'salon-5' &&
    galleryLayout('custom', { frames: [] }).layout === 'salon-5' && galleryLayout('constructor').layout === 'salon-5');
  check('triptyk maler ett motiv over alle tre (span), de andre ikke', galleryLayout('triptych').span === true && Object.keys(LAYOUTS).filter((k) => galleryLayout(k).span).join() === 'triptych');
  const salon9 = galleryLayout('salon-9');
  const top = salon9.frames.slice(0, 5), bottom = salon9.frames.slice(5);
  const y0 = Math.min(...top.map((f) => f.y - f.h / 2)), y1 = Math.max(...bottom.map((f) => f.y + f.h / 2));
  check('salongvegg 9: øvre rad står på, nedre rad henger under en felles midtlinje', top.every((f) => near(f.y - f.h / 2, y0, 1e-12)) &&
    bottom.every((f) => near(f.y + f.h / 2, y1, 1e-12)) && near(y0 - y1, 0.06, 1e-12));
  const st = galleryLayout('stair', { rise: 0.6 });
  check('trappevegg: stiger med rise 0,6, speilet faller den andre veien', st.frames.every((f, i) => i === 0 || near((f.y - st.frames[i - 1].y) / (f.x - st.frames[i - 1].x), 0.6, 1e-12)) &&
    galleryLayout('stair', { mirror: true }).frames.at(-1).x < 0);
  const lg = galleryLayout('ledge');
  check('bildehylle: rammene står på hylla, lag z 0,035 / 0,06, toppen lener mot veggen',
    lg.ledge && lg.frames.every((f, i) => near(f.y - f.h / 2, lg.ledge.y, 1e-12) && f.z === SET_LEDGE.leanZ[i % 2] &&
      near(f.z - f.h * Math.sin(f.tilt), SET_LEDGE.top, 1e-12)), JSON.stringify(lg.frames));
  const span = Math.max(...lg.frames.map((f) => f.x + f.w / 2)) - Math.min(...lg.frames.map((f) => f.x - f.w / 2));
  check('bildehylle: hylla er 6 cm lengre enn rammene, 10 cm dyp, 2 cm tykk, sentrert', near(lg.ledge.w, span + 0.06, 1e-12) && lg.ledge.d === 0.1 &&
    lg.ledge.t === 0.02 && near(lg.ledge.x, 0, 1e-12));
  check('bildehylle: naboer overlapper i x med 20 % av den smaleste', lg.frames.every((f, i) => i === 0 ||
    near((lg.frames[i - 1].x + lg.frames[i - 1].w / 2) - (f.x - f.w / 2), 0.2 * Math.min(f.w, lg.frames[i - 1].w), 1e-12)));

  const custom = galleryLayout('custom', {
    frames: [
      { x: -0.3, y: 0.1, w: 0.3, h: 0.4, motif: 'fjord', seed: 3, imageId: 'img-' + 'a'.repeat(28) },
      { x: 0.3, y: 0, w: 5, h: 0.01 },
      { x: 0, y: 0, w: 'x', h: 0.3 },
      null,
      { x: 99, y: 0, w: 0.2, h: 0.2, z: 1, tilt: 3 },
    ],
  });
  check('«custom»: ugyldige rammer hoppes over, mål klemmes, egne felt følger med (data)', custom.layout === 'custom' && custom.frames.length === 3 &&
    custom.frames[0].data.motif === 'fjord' && custom.frames[0].data.imageId?.length === 32 && custom.frames[1].w === SET_LIMITS.side[1] &&
    custom.frames[1].h === SET_LIMITS.side[0] && custom.frames[2].z === SET_LIMITS.z[1] && custom.frames[2].tilt === SET_LIMITS.tilt[1], JSON.stringify(custom.frames));
  const many = galleryLayout('custom', { frames: Array.from({ length: 20 }, (_, i) => ({ x: i * 0.3, y: 0, w: 0.2, h: 0.3 })) });
  check(`«custom»: høyst ${SET_LIMITS.frames} rammer`, many.frames.length === SET_LIMITS.frames);
  const c2 = galleryLayout('custom', { frames: [{ x: 1, y: 1, w: 0.2, h: 0.2 }, { x: 2, y: 1, w: 0.2, h: 0.2 }], mirror: true });
  check('«custom»: sentreres og speiles som de andre', near(c2.frames[0].x, 0.5, 1e-12) && near(c2.frames[1].x, -0.5, 1e-12) && near(c2.frames[0].y, 0, 1e-12));
}

// ---------------------------------------------------------------------------------------------------------------------
section('fitSet: settet holder målene (art.md §4.2)');
{
  let firstBad = null;
  for (const key of Object.keys(LAYOUTS)) for (const [fx, fy] of [[0.7, 1.3], [1.3, 0.7], [1, 1], [2, 2]]) {
    const G = galleryLayout(key);
    const b = setBounds(G.frames, G.ledge);
    const dims = { w: b.w * fx, h: b.h * fy, d: 0.03 };
    const F = fitSet(G.frames, G.ledge, dims);
    const want = Math.min(fx, fy);
    const fb = setBounds(F.frames, F.ledge);
    const probs = [];
    if (!near(F.s, want, 1e-12)) probs.push(`s ${F.s}`);
    if (!F.frames.every((f) => f.x - f.w / 2 >= -dims.w / 2 - 1e-9 && f.x + f.w / 2 <= dims.w / 2 + 1e-9 && f.y - f.h / 2 >= -dims.h / 2 - 1e-9 && f.y + f.h / 2 <= dims.h / 2 + 1e-9)) probs.push('utenfor');
    if (!F.frames.every((f, i) => near(f.w / f.h, G.frames[i].w / G.frames[i].h, 1e-12))) probs.push('format');
    if (!near(fb.cx, 0, 1e-12) || !near(fb.cy, 0, 1e-12)) probs.push('ikke sentrert');
    if (!(near(fb.w, dims.w, 1e-9) || near(fb.h, dims.h, 1e-9))) probs.push(`fyller ikke ${fb.w}×${fb.h}`);
    if (fb.w > dims.w + 1e-9 || fb.h > dims.h + 1e-9) probs.push('bbox utenfor');
    // z is not scaled with s; a ledge deeper than the set (10 cm > d 3 cm) is squeezed into dims.d (kz)
    const kz = G.ledge ? dims.d / SET_LEDGE.d : 1;
    if (!near(F.kz, kz, 1e-12)) probs.push(`kz ${F.kz}`);
    if (F.ledge && !(near(F.ledge.t, SET_LEDGE.t * want, 1e-12) && near(F.ledge.d, dims.d, 1e-12))) probs.push('hylle');
    if (F.ledge && !F.frames.every((f) => near(f.z - f.h * Math.sin(f.tilt), SET_LEDGE.top * kz, 1e-12))) probs.push('lener ikke mot veggen');
    if (!F.frames.every((f, i) => (G.ledge ? near(f.z, G.frames[i].z * kz, 1e-15) : f.z === G.frames[i].z))) probs.push('z skalert');
    if (probs.length && !firstBad) firstBad = `${key} ×(${fx}, ${fy}): ${probs.join(', ')}`;
  }
  check('alle oppsett ×(0,7, 1,3), ×(1,3, 0,7), ×1, ×2: inni målene, samme format, sentrert, fyller den bindende siden', !firstBad, firstBad || '');
  {
    // a set at least as deep as the ledge (Frikk d 0.10, d 0.12, no d) keeps the natural ledge exactly
    const G = galleryLayout('ledge');
    const same = [0.1, 0.12, undefined].every((d) => {
      const F = fitSet(G.frames, G.ledge, { w: 1.2, h: 0.5, d });
      return F.kz === 1 && F.ledge.d === SET_LEDGE.d && F.frames.every((f, i) => f.z === G.frames[i].z && near(f.z - f.h * Math.sin(f.tilt), SET_LEDGE.top, 1e-12));
    });
    check('bildehylle i et sett med d ≥ 10 cm (eller uten d): hylla er 10 cm dyp, rammene står som før', same);
  }
  const G = galleryLayout('pair-h');
  const keep = JSON.stringify(G);
  fitSet(G.frames, G.ledge, { w: 0.5, h: 0.5 });
  check('fitSet endrer ikke inndata', JSON.stringify(G) === keep);
  check('fitSet uten dims: bare sentrering (s = 1)', fitSet(G.frames, null, {}).s === 1 && fitSet([], null, { w: 1, h: 1 }).frames.length === 0);
  const C = galleryLayout('custom', { frames: [{ x: 0, y: 0, w: 0.3, h: 0.4, motif: 'arches' }] });
  check('fitSet beholder data-feltet til «custom»-rammer', fitSet(C.frames, null, { w: 0.6, h: 0.8 }).frames[0].data.motif === 'arches');
}

// ---------------------------------------------------------------------------------------------------------------------
section('spanRects / atlasUvRect');
{
  const T = fitSet(galleryLayout('triptych').frames, null, { w: 1.47, h: 0.9 });
  const S = spanRects(T.frames);
  check('triptyk: ett motiv i bbox-formatet, panelene deler det fra venstre til høyre', near(S.aspect, 1.47 / 0.9, 1e-12) &&
    near(S.rects[0][0], 0, 1e-12) && near(S.rects[2][2], 1, 1e-12) && S.rects.every((r) => near(r[1], 0, 1e-12) && near(r[3], 1, 1e-12)));
  check('triptyk: mellomrommene «spiser» av bildet (0,06 / 1,47)', near(S.rects[1][0] - S.rects[0][2], 0.06 / 1.47, 1e-12));
  const uv = atlasUvRect({ x: 6, y: 6, w: 100, h: 50 }, 112, 62);
  check('atlas-uv: v opp (flipY), canvas-y ned', near(uv[0], 6 / 112, 1e-15) && near(uv[1], 1 - 56 / 62, 1e-15) && near(uv[2], 106 / 112, 1e-15) && near(uv[3], 1 - 6 / 62, 1e-15));
}

// ---------------------------------------------------------------------------------------------------------------------
section('packAtlas (art.md §4.4)');
{
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Problems of an atlas result for `cells`. */
  function verify(cells, res, maxSide, pad) {
    const probs = [];
    if (!res) return ['null'];
    if (res.W > maxSide || res.H > maxSide || res.W < 1 || res.H < 1) probs.push(`størrelse ${res.W}×${res.H}`);
    if (res.rects.length !== cells.length) probs.push('antall');
    const ex = res.rects.map((r) => ({ x0: r.x - pad, x1: r.x + r.w + pad, y0: r.y - pad, y1: r.y + r.h + pad }));
    res.rects.forEach((r, i) => {
      if (r.w !== Math.max(1, Math.round(cells[i].w * res.scale)) || r.h !== Math.max(1, Math.round(cells[i].h * res.scale))) probs.push(`celle ${i} har feil størrelse`);
      if (ex[i].x0 < 0 || ex[i].y0 < 0 || ex[i].x1 > res.W || ex[i].y1 > res.H) probs.push(`celle ${i} utenfor`);
      if (![r.x, r.y, r.w, r.h].every(Number.isInteger)) probs.push(`celle ${i} ikke heltall`);
    });
    for (let i = 0; i < ex.length; i++) for (let j = i + 1; j < ex.length; j++) if (overlaps(ex[i], ex[j], 0)) probs.push(`overlapp ${i}/${j}`);
    return probs;
  }
  const R = mulberry32(20261021);
  const cells9 = Array.from({ length: 9 }, () => ({ w: 120 + Math.floor(R() * 520), h: 120 + Math.floor(R() * 520) }));
  const a9 = packAtlas(cells9, 2048, 6);
  const p9 = verify(cells9, a9, 2048, 6);
  check(`9 tilfeldige celler (frø) får plass i 2048 med 6 px kant, uten overlapp (${a9 ? `${a9.W}×${a9.H}, skala ${a9.scale}` : 'null'})`, !p9.length, p9.join(', '));
  check('deterministisk', JSON.stringify(packAtlas(cells9, 2048, 6)) === JSON.stringify(a9));
  let bad = null;
  for (let t = 0; t < 200 && !bad; t++) {
    const n = 1 + Math.floor(R() * 16);
    const cells = Array.from({ length: n }, () => ({ w: 16 + Math.floor(R() * 900), h: 16 + Math.floor(R() * 900) }));
    const res = packAtlas(cells, 2048, 6);
    const probs = verify(cells, res, 2048, 6);
    if (probs.length) bad = `forsøk ${t}: ${probs.slice(0, 3).join(', ')}`;
  }
  check('200 tilfeldige sett (1–16 celler, 16–916 px): alltid gyldig', !bad, bad || '');
  const big = Array.from({ length: 9 }, () => ({ w: 1000, h: 1000 }));
  const ab = packAtlas(big, 2048, 6);
  check(`for stort: krymper med 0,85 til det får plass (skala ${ab?.scale.toFixed(4)})`, ab && ab.scale < 1 && ab.scale > 0.85 ** 9 && !verify(big, ab, 2048, 6).length);
  check('umulig (100 000 px bred) → null', packAtlas([{ w: 100000, h: 10 }], 2048, 6) === null);
  check('én celle bredere enn atlaset krymper', packAtlas([{ w: 2100, h: 100 }], 2048, 6)?.scale === 0.85);
  check('tom liste → tomt atlas', JSON.stringify(packAtlas([], 2048)) === JSON.stringify({ W: 1, H: 1, rects: [], scale: 1 }));
  // the real sets at every quality: cells = the paper prints of the default art-set (thin 12 mm, mat 35 mm)
  let setBad = null;
  for (const q of ['low', 'medium', 'high']) for (const key of Object.keys(LAYOUTS)) {
    const G = galleryLayout(key);
    const cells = G.frames.map((f) => {
      const Lf = artLayout({ w: f.w, h: f.h, d: 0.025 }, { frame: 'thin', frameW: 0.012, mat: true, matW: 0.035, texture: 'paper' });
      return { w: Math.round(Lf.planeW * PPM[q]), h: Math.round(Lf.planeH * PPM[q]) };
    });
    const res = packAtlas(cells, ATLAS_MAX[q], 6);
    const probs = verify(cells, res, ATLAS_MAX[q], 6);
    if (q !== 'low' && res && res.scale !== 1) probs.push(`skala ${res.scale}`);
    if (probs.length && !setBad) setBad = `${q} ${key}: ${probs.join(', ')}`;
  }
  check('alle oppsett får plass i atlaset (medium/høy i full oppløsning)', !setBad, setBad || '');
}

// ---------------------------------------------------------------------------------------------------------------------
section('Oppløsning: artResFor, canvasSize, quantAspect (art.md §5.2)');
{
  check('medium: 21×30 → 320, 30×40 → 384, 50×70 → 704, 90×120 → 1024', artResFor('medium', 0.21, 0.3) === 320 && artResFor('medium', 0.3, 0.4) === 384 &&
    artResFor('medium', 0.5, 0.7) === 704 && artResFor('medium', 0.9, 1.2) === 1024 && artResFor('medium', 1.2, 1.8) === 1024);
  check('legacy = dagens artRes: 512 / 1024 / 1536', artResFor('low', 0.1, 0.1, true) === 512 && artResFor('medium', 0.1, 0.1, true) === 1024 && artResFor('high', 0.1, 0.1, true) === 1536);
  check('lav: minst 256, høy: 70×100 → 1280, ukjent kvalitet = medium', artResFor('low', 0.1, 0.15) === 256 && artResFor('high', 0.7, 1) === 1280 &&
    artResFor(undefined, 0.5, 0.7) === 704 && artResFor('high', 3, 3) === 1536);
  check('alltid et multiplum av 64', [0.13, 0.27, 0.41, 0.66, 0.99].every((s) => artResFor('medium', s, s) % 64 === 0));
  check('canvasSize: langsiden = res, kortsiden avrundet, minst 16', JSON.stringify(canvasSize(1.5, 1024)) === JSON.stringify({ W: 1024, H: 683 }) &&
    JSON.stringify(canvasSize(0.5, 512)) === JSON.stringify({ W: 256, H: 512 }) && canvasSize(100, 512).H === 16 && canvasSize(NaN, 300).W === 300);
  const decorQuant = (a) => Math.exp(Math.round(Math.log(clamp(a, 0.2, 5)) / 0.04) * 0.04); // decor.js:2312
  check('quantAspect = decor.js sin (samme cache-nøkler)', [0.1, 0.2, 0.37, 0.5, 0.75, 1, 1.333, 1.5, 2.2, 5, 9].every((a) => quantAspect(a) === decorQuant(a)));
}

// ---------------------------------------------------------------------------------------------------------------------
section('ArtCache: kaster aldri noe som er i bruk (art.md §5.1)');
{
  const disposed = [];
  const mk = (name) => ({ name });
  const C = new ArtCache({ budgetPx: 250, maxEntries: 10, dispose: (e, key) => disposed.push(`${e.name}@${key}`) });
  const mats = []; // strong refs = live materials
  const a = C.set('a', mk('a'), 100);
  mats.push(C.use(a, { m: 'A' }));
  C.set('b', mk('b'), 100);
  check('set gir oppføringen tilbake med px og users', a.px === 100 && a.users instanceof Set && a.users.size === 1);
  C.set('c', mk('c'), 100);
  check('over budsjett: eldste ubrukte (b) kastes, den i bruk (a) blir', disposed.join() === 'b@b' && C.has('a') && !C.has('b') && C.has('c'));
  check('stats stemmer', JSON.stringify(C.stats()) === JSON.stringify({ entries: 2, px: 200, inUse: 1, budgetPx: 250, maxEntries: 10 }));
  check('use samme materiale to ganger = én bruker', C.use(a, mats[0]) === mats[0] && a.users.size === 1);
  check('get gir oppføringen og flytter den til nyeste', C.get('a') === a && [...C.map.keys()].join() === 'c,a' && C.get('x') === undefined);

  const D = new ArtCache({ budgetPx: 50, dispose: (e) => disposed.push(e.name) });
  disposed.length = 0;
  const d = D.set('d', mk('d'), 100);
  check('ny oppføring overlever sin egen opprydding selv over budsjett', D.has('d') && !disposed.length);
  mats.push(D.use(d, {}));
  D.set('e', mk('e'), 100);
  check('alle i bruk / nettopp lagt inn: budsjettet får sprekke, synlig kunst blir', D.size === 2 && !disposed.length && D.stats().px === 200);
  D.set('f', mk('f'), 100);
  check('oppføring som aldri fikk en bruker kastes ved neste opprydding', disposed.join() === 'e' && D.has('d') && D.has('f'));
  check('trim() kaster alle ubrukte, uansett budsjett', D.trim() === 1 && disposed.join() === 'e,f' && D.size === 1 && D.has('d'));

  const E = new ArtCache({ budgetPx: 1e9, maxEntries: 3, dispose: (e) => disposed.push(e.name) });
  disposed.length = 0;
  for (const k of ['1', '2', '3']) E.set(k, mk(k), 10);
  E.get('1');
  E.set('4', mk('4'), 10);
  E.set('5', mk('5'), 10);
  check('maxEntries: eldste først, get holder en oppføring ung', disposed.join() === '2,3' && [...E.map.keys()].join() === '1,4,5');

  const F = new ArtCache({ budgetPx: 1e9, dispose: (e) => disposed.push(e.name) });
  disposed.length = 0;
  const f1 = F.set('k', mk('f1'), 10);
  mats.push(F.use(f1, {}));
  F.set('k', mk('f2'), 20);
  check('ny oppføring på samme nøkkel: den gamle i bruk spores videre (ikke kastet)', F.size === 2 && !disposed.length && F.stats().px === 30 && F.get('k').name === 'f2');
  F.set('k', mk('f3'), 5);
  check('… og den gamle ubrukte kastes med en gang', disposed.join() === 'f2' && F.stats().px === 15);
  F.set('k', F.get('k'), 7);
  check('samme oppføring på nytt: px oppdateres, ikke dobbelt', F.stats().px === 17 && F.size === 2);

  const warn = console.warn;
  console.warn = () => {};
  const B = new ArtCache({ budgetPx: 0, dispose: () => { throw new Error('boom'); } });
  B.set('x', mk('x'), 1);
  B.set('y', mk('y'), 1);
  console.warn = warn;
  check('en dispose som kaster stopper ikke cachen', !B.has('x') && B.has('y') && B.stats().px === 1);
  check('raiseBudget holder det største budsjettet', B.raiseBudget(ART_BUDGET_PX.high) === 20e6 && B.raiseBudget(ART_BUDGET_PX.low) === 20e6);
  check('budsjetter: lav 6, medium 12, høy 20 millioner px', ART_BUDGET_PX.low === 6e6 && ART_BUDGET_PX.medium === 12e6 && ART_BUDGET_PX.high === 20e6);
  check('use/inUse tåler null', C.use(null, {}) !== undefined && C.use(a, null) === null && C.inUse(null) === false && C.inUse({}) === false);

  // WeakRef release (best effort: forcing GC is not guaranteed in every Node build)
  let gc = null;
  try {
    v8.setFlagsFromString('--expose-gc');
    gc = vm.runInNewContext('gc');
  } catch {
    gc = null;
  }
  const G = new ArtCache({ budgetPx: 0, dispose: (e) => disposed.push(e.name) });
  disposed.length = 0;
  const gEntry = G.set('g', mk('g'), 10);
  (() => G.use(gEntry, { temp: new Array(1000).fill(0) }))();
  const held = G.set('h', mk('h'), 10);
  mats.push(G.use(held, {}));
  check('materiale uten sterke referanser regnes som i bruk til GC har gått', G.inUse(gEntry) || !gc);
  if (gc) {
    await new Promise((r) => setTimeout(r, 0));
    gc();
    await new Promise((r) => setTimeout(r, 0));
    if (!G.inUse(gEntry)) {
      G.sweep();
      check('etter GC: oppføringen er fri og kastes, den som fortsatt brukes blir', disposed.join() === 'g' && G.has('h') && !G.has('g'));
    } else console.log('  info GC samlet ikke inn test-materialet – frigjøring ikke målt');
  } else console.log('  info gc() utilgjengelig – frigjøring ikke målt');
  check('materialer med sterke referanser holder oppføringene i bruk', mats.length === 4 && C.inUse(a) && D.inUse(d) && F.inUse(f1) && G.inUse(held));
}

// ---------------------------------------------------------------------------------------------------------------------
section('Data og renhet');
{
  const keys = ['none', 'thin', 'black', 'oak', 'white', 'box', 'floater', 'alu', 'ornate', 'hanger'];
  check('FRAME_OPTIONS = de 10 profilene i rekkefølge', JSON.stringify(FRAME_OPTIONS.map(([k]) => k)) === JSON.stringify(keys) &&
    FRAME_OPTIONS.every(([k, l]) => l === FRAME_PROFILES[k].label));
  check('FRAME_W = profilenes standardbredde', keys.every((k) => k === 'none' ? !(k in FRAME_W) && FRAME_PROFILES.none.fw === 0 : FRAME_W[k] === FRAME_PROFILES[k].fw));
  check('gamle profiler beholder nøyaktig dagens bredder', ['black', 'oak', 'white', 'floater'].every((k) => FRAME_W[k] === LEGACY_FRAME_W[k] && FRAME_PROFILES[k].legacy) &&
    FRAME_PROFILES.none.legacy && keys.filter((k) => FRAME_PROFILES[k].legacy).length === 5);
  check('FLOAT_GAP = 5 mm som i dag', FLOAT_GAP === 0.005);
  check('FRAME_PRESETS: unike nøkler, kjent profil, materiale + farge', new Set(FRAME_PRESETS.map((p) => p.key)).size === FRAME_PRESETS.length &&
    FRAME_PRESETS.every((p) => keys.includes(p.frame) && (p.frame === 'none' || (p.kind && /^#[0-9a-f]{6}$/.test(p.hex)))));
  check('PRINT_SIZES: 16 stående formater med unike nøkler', PRINT_SIZES.length === 16 && new Set(PRINT_SIZES.map((s) => s.key)).size === 16 &&
    PRINT_SIZES.every((s) => s.w > 0 && s.w <= s.h && s.label.includes('×')));
  check('DEFAULT_SET_MOTIFS: 9 unike', DEFAULT_SET_MOTIFS.length === 9 && new Set(DEFAULT_SET_MOTIFS).size === 9);
  for (const f of ['src/models/artlayout.js', 'src/models/artcache.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    check(`${f}: ingen import, ingen DOM`, !/^\s*import\s/m.test(src) && !/\b(document|window|indexedDB)\s*\./.test(src));
  }
}

// =====================================================================================================================
// Stage 2 (P04b): motif registry, decor defs, geometry through a fake canvas, the kunst catalogue, image params.
// «Round targets» (counts that grow while P03 and the research land) are soft: an info line under QA_PARTIAL=1, and
// also while their source has not landed at all (no painters registered / the research not merged into src/data).
// Everything about files that exist is strict.

const PARTIAL = process.env.QA_PARTIAL === '1';
const soft = (name, ok, detail = '', pending = false) => {
  if (ok || !(PARTIAL || pending)) return check(name, ok, detail);
  console.log(`  info ${name}${detail ? `  → ${detail}` : ''} (venter${pending ? ' på data/malere' : ''}, QA_PARTIAL)`);
  return false;
};
const HEX = /^#[0-9a-f]{6}$/i;
const AM = await imp('src/models/artmotifs.js');
const { ART_MOTIFS, ART_MOTIF_OPTIONS, LEGACY_MOTIFS, MOTIF_GROUPS, cleanMotifOpts, motifOptsKey, paintArt } = AM;
/** The motif keys of the contract (MASTER §2.3: graphic.js 16, painted.js 17). */
const CONTRACT_MOTIFS = [
  'bauhaus', 'mid-century', 'cutouts', 'arches', 'sunset', 'moon-phases', 'geometric-lines', 'stripes', 'dots', 'typography',
  'wave', 'blobs', 'line-face', 'kids-animals', 'city-map', 'topo-map',
  'color-field', 'brush-abstract', 'expressionist', 'texture-plaster', 'impression', 'still-life', 'stag', 'botanical-print',
  'big-leaf', 'fruit', 'fjord', 'mountain', 'ocean', 'forest', 'city-night', 'bw-photo', 'northern-lights',
];
const motifKeys = Object.keys(ART_MOTIFS);

// ---------------------------------------------------------------------------------------------------------------------
section('Motivregister: artmotifs.js (art.md §2.1, §8.2 punkt 1)');
{
  check('kontrakten har 33 nye motiver, ingen kolliderer med de gamle eller «custom»', CONTRACT_MOTIFS.length === 33 && new Set(CONTRACT_MOTIFS).size === 33 &&
    CONTRACT_MOTIFS.every((k) => !LEGACY_MOTIFS.includes(k) && k !== 'custom'));
  check('LEGACY_MOTIFS = de seks gamle', JSON.stringify(LEGACY_MOTIFS) === JSON.stringify(['misty-trees', 'abstract', 'landscape', 'botanical', 'line-art', 'photo']));
  soft('minst 26 nye motiver er registrert (P03)', motifKeys.length >= 26, `${motifKeys.length} registrert`, motifKeys.length === 0);
  check('registrerte motiver kolliderer ikke med de gamle eller «custom»', motifKeys.every((k) => !LEGACY_MOTIFS.includes(k) && k !== 'custom'));
  check('registrerte motiver hører til kontrakten (MASTER §2.3)', motifKeys.every((k) => CONTRACT_MOTIFS.includes(k)), motifKeys.filter((k) => !CONTRACT_MOTIFS.includes(k)).join(', '));
  const groups = MOTIF_GROUPS.map(([g]) => g);
  const bad = motifKeys.filter((k) => {
    const m = ART_MOTIFS[k];
    return !(typeof m.label === 'string' && m.label.trim() && groups.includes(m.group) && Array.isArray(m.palette) && m.palette.length === 5 &&
      m.palette.every((x) => HEX.test(x)) && ['S', 'M', 'L'].includes(m.cost) && typeof m.paint === 'function' && m.paint.length >= 5 &&
      (m.variants == null || (Array.isArray(m.variants) && m.variants.every((v) => Array.isArray(v) && v.length === 2 && v.every((s) => typeof s === 'string')))));
  });
  check('hvert motiv: navn, gruppe, 5 hex-farger, kost S/M/L, paint(c, W, H, R, p, o), varianter som [nøkkel, navn]', !bad.length, bad.join(', '));
  check('ART_MOTIF_OPTIONS = alle registrerte motiver, gruppert', ART_MOTIF_OPTIONS.length === motifKeys.length &&
    ART_MOTIF_OPTIONS.every(([k, l]) => ART_MOTIFS[k]?.label === l));
  check('cleanMotifOpts: ukjent motiv gir {}', JSON.stringify(cleanMotifOpts('finnes-ikke', { variant: 'x', text: 'y' })) === '{}');
  const withVar = motifKeys.find((k) => ART_MOTIFS[k].variants?.length);
  if (withVar) {
    const v0 = ART_MOTIFS[withVar].variants[0][0];
    check(`cleanMotifOpts: kjent variant beholdes, ukjent fjernes (${withVar})`, cleanMotifOpts(withVar, { variant: v0 }).variant === v0 && !('variant' in cleanMotifOpts(withVar, { variant: '§ukjent' })));
  } else console.log('  info ingen motiv med varianter registrert ennå (P03)');
  const withText = motifKeys.find((k) => ART_MOTIFS[k].opts?.includes('text'));
  if (withText) {
    check(`cleanMotifOpts: tekst kuttes ved 24 tegn (${withText})`, cleanMotifOpts(withText, { text: `  ${'x'.repeat(40)} ` }).text === 'x'.repeat(24));
    check('motifOptsKey er stabil (rekkefølgen på nøklene spiller ingen rolle)', motifOptsKey(withText, { text: 'Hei', variant: 'z' }) === motifOptsKey(withText, { variant: 'z', text: 'Hei' }));
  } else console.log('  info ingen motiv med tekst registrert ennå (P03)');
  check('motifOptsKey: tom streng uten valg (gamle nøkler i hurtiglageret er uendret)', motifOptsKey('abstract', { variant: 'x' }) === '' && motifOptsKey(motifKeys[0] ?? 'x', null) === '');
  check('paintArt: ukjent nøkkel gir false uten å tegne', paintArt(null, 10, 10, 'finnes-ikke', null, []) === false);
}

// ---------------------------------------------------------------------------------------------------------------------
section('Motivene følger trykkfargen: palette[1] = colors.print (artmotifs.js-kontrakten)');
{
  // every motif and variant painted twice through a recording fake canvas (all 2D calls and assignments, on every
  // canvas a painter makes): with its palette and with palette[1] swapped – a motif that paints the same both times
  // ignores the «Trykk» colour (recolouring would repaint an identical texture). bw-photo is black and white by design.
  const { createHash } = await import('node:crypto');
  const K = await imp('src/models/kit.js');
  let hash = null;
  const put = (s) => hash.update(`${s}\n`);
  const PROPS = new Set(['fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'filter', 'font', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'miterLimit', 'lineDashOffset']);
  const grad = (kind) => (...a) => (put(`${kind}(${a.join(',')})`), { addColorStop: (o, col) => put(`stop ${o} ${col}`) });
  const arg = (x) => (x && typeof x === 'object' ? (x.width != null ? `cv${x.width}x${x.height}` : 'o') : String(x));
  const ctx2d = (cv) => new Proxy({
    canvas: cv,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    createLinearGradient: grad('lin'), createRadialGradient: grad('rad'), createConicGradient: grad('con'),
    createPattern: () => ({ setTransform: () => {} }),
    measureText: (t) => ({ width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
  }, {
    get: (t, k) => (k in t || typeof k !== 'string' || PROPS.has(k) ? t[k] : (...a) => put(`${k}(${a.map(arg).join(',')})`)),
    set: (t, k, v) => ((t[k] = v), put(`${String(k)}=${arg(v)}`), true),
  });
  const had = 'document' in globalThis;
  const prevDoc = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 300, height: 150, style: {}, getContext() { return (this._c ||= ctx2d(this)); }, addEventListener: () => {} }) };
  const paintHash = (key, variant, p) => {
    hash = createHash('sha1');
    const cv = globalThis.document.createElement('canvas');
    cv.width = 120;
    cv.height = 90;
    paintArt(cv.getContext('2d'), 120, 90, key, K.rng(`motif:${key}:1`), p, { opts: variant ? { variant } : null });
    return hash.digest('hex');
  };
  const deaf = [];
  let n = 0;
  try {
    for (const key of motifKeys) {
      if (key === 'bw-photo') continue;
      const m = ART_MOTIFS[key];
      for (const variant of m.variants?.length ? m.variants.map(([v]) => v) : [null]) {
        const p0 = [...m.palette];
        const p1 = [...m.palette];
        p1[1] = p0[1].toLowerCase() === '#d0103a' ? '#1a7f3c' : '#d0103a';
        n++;
        if (paintHash(key, variant, p0) === paintHash(key, variant, p1)) deaf.push(variant ? `${key}/${variant}` : key);
      }
    }
  } finally {
    if (had) globalThis.document = prevDoc;
    else delete globalThis.document;
  }
  check(`alle ${n} motiv/varianter (utenom svart-hvitt foto) maler annerledes når trykkfargen endres`, n > 0 && !deaf.length, deaf.join(', '));
}

// ---------------------------------------------------------------------------------------------------------------------
section('decor.js: art-frame og art-set (art.md §3.1, §4.1, MASTER §2.3)');
const decor = await imp('src/models/decor.js');
const artImages = await imp('src/models/artImages.js');
const { archetypes } = decor;
{
  const af = archetypes['art-frame'], as = archetypes['art-set'];
  const keys = af.params.motif.options.map(([k]) => k);
  // no «Eget bilde» to pick for a picture: without a picture it painted the fjord photo («Bilde» → «Bytt til eget bilde …»)
  check('Motiv: de 6 gamle først, så alle nye – ikke «custom» (eget bilde kommer via «Bilde»)', JSON.stringify(keys.slice(0, 6)) === JSON.stringify(LEGACY_MOTIFS) &&
    !keys.includes('custom') && keys.length === 6 + motifKeys.length && motifKeys.every((k) => keys.includes(k)));
  check('Ramme = FRAME_OPTIONS (10 profiler)', JSON.stringify(af.params.frame.options) === JSON.stringify(FRAME_OPTIONS));
  check('art-frame har ingen standard-«depth» (dybden er dims.d)', !('depth' in af.defaults.params));
  check('art-frame: Passepartoutbredde krever passepartout, Glass er av/på', af.params.matW?.requires === 'mat' && af.params.matW.min === 0.015 && af.params.matW.max === 0.15 &&
    af.params.glass?.type === 'bool' && af.params.frameW.min === 0.005 && af.params.frameW.max === 0.08);
  check('art-frame dimsRange: d fra 0,005 m (plakater), w/h 0,1–3 m', JSON.stringify(af.dimsRange) === JSON.stringify({ w: [0.1, 3.0], d: [0.005, 0.1], h: [0.1, 3.0] }));
  check('art-set finnes, henger på veggen, Oppsett = alle 15', !!as && as.mount === 'wall' && JSON.stringify(as.params.layout.options) === JSON.stringify(LAYOUT_OPTIONS) && LAYOUT_OPTIONS.length === 15);
  check('art-set: mellomrom 0,02–0,25, passepartout og glass på som standard, speilvending', as.params.gap.min === 0.02 && as.params.gap.max === 0.25 &&
    as.defaults.params.mat === true && as.defaults.params.glass === true && as.params.mirror?.type === 'bool' && JSON.stringify(as.params.frame.options) === JSON.stringify(FRAME_OPTIONS));
  check('art-set dimsRange (MASTER §2.3)', JSON.stringify(as.dimsRange) === JSON.stringify({ w: [0.25, 3.6], d: [0.005, 0.12], h: [0.2, 2.4] }));
  const lay = galleryLayout(as.defaults.params.layout, { gap: as.defaults.params.gap });
  const b = setBounds(lay.frames, lay.ledge);
  check('art-set standardmål = salongvegg 5 i naturlig størrelse', near(b.w, as.defaults.dims.w, 1e-9) && near(b.h, as.defaults.dims.h, 1e-9));
  check('akustikkbilde: samme motivliste + «Eget motiv (eksempelbilde)» sist (katalogens «eget motiv»-plater viser riktig valg)',
    JSON.stringify(archetypes['acoustic-art'].params.motif.options) === JSON.stringify([...af.params.motif.options, ['custom', 'Eget motiv (eksempelbilde)']]));
  {
    // «Passepartoutbredde» shows what the builder draws while matW is unset (9 % of the short side), not the 0.06 default
    const s = af.params.matW;
    const shown = (dims, params) => s.defaultFor?.(dims, { ...af.defaults.params, ...params }) ?? s.default;
    const a3 = { w: 0.297, d: 0.02, h: 0.42 }, big = { w: 0.9, d: 0.03, h: 1.2 };
    const drawn = (dims, params) => artLayout(dims, { ...af.defaults.params, ...params }).matW;
    check('Passepartoutbredde uten matW: viser bredden byggeren tegner (9 % av korteste side), ikke 6 cm',
      typeof s.defaultFor === 'function' && near(shown(a3, { mat: true, frame: 'thin' }), 0.297 * 0.09, 1e-12) && near(shown(big, { mat: true }), 0.081, 1e-12) &&
      shown(a3, { mat: true, frame: 'thin' }) === drawn(a3, { mat: true, frame: 'thin' }) && shown(big, { mat: true, frame: 'none' }) === s.default,
      `${shown(a3, { mat: true, frame: 'thin' })} / ${shown(big, { mat: true })} / ${shown(big, { mat: true, frame: 'none' })}`);
  }
  check('decor.js eksporterer setArtImageSource (samme som artImages.js), buildMirror og _artDebug', decor.setArtImageSource === artImages.setArtImageSource &&
    typeof decor.buildMirror === 'function' && typeof decor._artDebug?.stats === 'function');
  const R = await imp('src/models/registry.js');
  const warn = console.warn;
  const msgs = [];
  console.warn = (...a) => msgs.push(a.map(String).join(' '));
  let g1, g2, g3;
  try {
    g1 = R.buildModel({ archetype: 'art-frame' });
    g2 = R.buildModel({ archetype: 'ceiling-absorber' });
    g3 = R.buildModel({ archetype: 'ceiling-absorber', dims: { w: 1.2, d: 0.8, h: 0.04 }, params: { shape: 'round' } });
  } finally {
    console.warn = warn;
  }
  check('Node: art-frame faller bare tilbake på manglende lerret («document is not defined»)', g1.userData.model.fallback === true && msgs.some((m) => /document is not defined/.test(m)));
  // a hanging baffle keeps the side view (wires visible); a flat raft is shot from below the front, without the
  // ceiling plate (a white raft against the plate read as blank)
  check('takabsorbent: hengende skjerm sett fra siden, flåte nedenfra uten takplate (thumbView under)',
    g2.userData.model.thumbView == null && !g2.userData.model.fallback && g3.userData.model.thumbView === 'under' && !g3.userData.model.fallback,
    `${g2.userData.model.thumbView} / ${g3.userData.model.thumbView}`);
}

// ---------------------------------------------------------------------------------------------------------------------
section('Geometri gjennom et falskt lerret: de gamle bildene er uendret, nye profiler og bildevegger');
{
  // a fake DOM canvas: every 2D call is a no-op, readbacks are zeros – enough for the geometry of the builders
  const noop = () => {};
  const PROPS = new Set(['fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'filter', 'font', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'shadowBlur', 'shadowColor', 'miterLimit', 'lineDashOffset']);
  const ctx2d = (cv) => new Proxy({
    canvas: cv,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }),
    createConicGradient: () => ({ addColorStop: noop }), createPattern: () => ({ setTransform: noop }),
    measureText: (t) => ({ width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
  }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && !PROPS.has(k) ? noop : t[k]), set: (t, k, v) => ((t[k] = v), true) });
  const had = 'document' in globalThis;
  globalThis.document = { createElement: () => ({ width: 300, height: 150, style: {}, getContext() { return (this._c ||= ctx2d(this)); }, addEventListener: noop }) };
  try {
    const R = await imp('src/models/registry.js');
    const E = await imp('src/home/existing.js');
    const { layout } = await imp('src/home/layout.js');
    const THREE = await import('three');
    const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/art-legacy-golden.json'), 'utf8')).items;
    const acSrc = fs.readFileSync(path.join(ROOT, 'tools/artcheck.mjs'), 'utf8');
    const i0 = acSrc.indexOf('const LEGACY_SPECS = [');
    const SPECS = vm.runInNewContext(acSrc.slice(i0 + 'const LEGACY_SPECS = '.length, acSrc.indexOf('\n];', i0) + 2));
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    const sig = (g) => {
      g.updateMatrixWorld(true);
      let meshes = 0, verts = 0;
      const parts = {};
      g.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        const n = o.geometry.attributes.position.count;
        verts += n;
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        const e = (parts[o.userData.part || '-'] ||= { n: 0, verts: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
        e.n++;
        e.verts += n;
        ['x', 'y', 'z'].forEach((k, i) => {
          e.min[i] = Math.min(e.min[i], bb.min[k]);
          e.max[i] = Math.max(e.max[i], bb.max[k]);
        });
      });
      for (const e of Object.values(parts)) {
        e.min = e.min.map(r6);
        e.max = e.max.map(r6);
      }
      return { meshes, verts, parts };
    };
    const matSig = (spec, g) => {
      let m = null;
      if (spec.archetype === 'tv') g.traverse((o) => { if (o.isMesh && o.material?.emissiveMap) m = o.material; });
      else m = g.userData.model?.parts?.[spec.archetype === 'acoustic-art' ? 'panel' : 'print']?.find((o) => o.material?.map)?.material ?? null;
      return m ? { type: m.type, roughness: r6(m.roughness), metalness: r6(m.metalness), normalScale: m.normalScale ? r6(m.normalScale.x) : null, normalChannel: m.normalMap ? m.normalMap.channel : null, emissiveIntensity: r6(m.emissiveIntensity ?? 0) } : null;
    };
    const diffs = [];
    for (const [name, s0] of SPECS) {
      let spec = s0;
      if (typeof s0 === 'string') {
        const it = E.originalItems(layout).find((i) => i.uid === s0);
        spec = { archetype: it.archetype, dims: it.dims, params: it.params, colors: it.colors, materials: it.materials };
      }
      const g = R.buildModel({ ...spec, quality: 'medium' });
      const got = sig(g), want = golden[name]?.geom;
      if (!want) {
        diffs.push(`${name}: ikke i fasiten`);
        continue;
      }
      let bad = g.userData.model.fallback || got.meshes !== want.meshes || got.verts !== want.verts || JSON.stringify(matSig(spec, g)) !== JSON.stringify(golden[name].mat);
      for (const k of new Set([...Object.keys(want.parts), ...Object.keys(got.parts)])) {
        const p = want.parts[k], q = got.parts[k];
        if (!p || !q || p.n !== q.n || p.verts !== q.verts || Math.max(...p.min.map((v, i) => Math.abs(v - q.min[i])), ...p.max.map((v, i) => Math.abs(v - q.max[i]))) > 1e-5) bad = true;
      }
      if (bad) diffs.push(name);
    }
    check(`de ${SPECS.length} gamle bildene: samme masker, hjørner, deler og materialtall som fasiten fra c28070d`, !diffs.length, diffs.join(', '));

    const parts = (g) => g.userData.model.parts;
    const inDims = (g, d, tol = 0.002, above = 0) => {
      g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      return bb.min.x >= -d.w / 2 - tol && bb.max.x <= d.w / 2 + tol && bb.min.y >= -d.h / 2 - tol && bb.max.y <= d.h / 2 + tol + above && bb.min.z >= -tol && bb.max.z <= d.d + tol;
    };
    const dims = { w: 0.5, d: 0.03, h: 0.7 };
    const prob = [];
    for (const [frame] of FRAME_OPTIONS) {
      for (const texture of ['canvas', 'paper']) {
        const g = R.buildModel({ archetype: 'art-frame', dims, params: { frame, texture, mat: texture === 'paper', matW: 0.04, glass: true } });
        const P = parts(g);
        if (g.userData.model.fallback) prob.push(`${frame}/${texture}: reserve`);
        else if (P.print?.length !== 1) prob.push(`${frame}/${texture}: ${P.print?.length ?? 0} trykk`);
        else if (frame !== 'none' && !P.frame?.length) prob.push(`${frame}/${texture}: ingen ramme`);
        else if (!inDims(g, dims, frame === 'hanger' ? 0.0055 : 0.002, frame === 'hanger' ? 0.125 : 0)) prob.push(`${frame}/${texture}: utenfor målene`); // the hanger's battens are 1 cm wider, its cord goes 12 cm up
        else if (P.print[0].material.roughness !== 0.22) prob.push(`${frame}/${texture}: glass mangler`);
      }
    }
    check('alle 10 profiler × lerret/papir bygger: ett trykk, ramme, innenfor målene, glass', !prob.length, prob.join('; '));
    {
      const g = R.buildModel({ archetype: 'art-frame', dims, params: { frame: 'hanger', texture: 'paper' } });
      g.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let mid = 0;
      for (const m of parts(g).frame || []) {
        const pos = m.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) if (Math.abs(v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld).y) < dims.h / 2 - 0.016 - 0.002) mid++;
      }
      const pb = new THREE.Box3().setFromObject(parts(g).print[0]);
      check('plakatheng: ingen sidelister, plakaten fyller hele w × h', mid === 0 && near(pb.max.x - pb.min.x, dims.w, 1e-6) && near(pb.max.y - pb.min.y, dims.h, 1e-6));
    }
    {
      const L = artLayout({ w: 0.5, h: 0.7, d: 0.04 }, { frame: 'box', texture: 'paper', mat: true, matW: 0.04 });
      const g = R.buildModel({ archetype: 'art-frame', dims: { w: 0.5, d: 0.04, h: 0.7 }, params: { frame: 'box', texture: 'paper', mat: true, matW: 0.04 } });
      const pb = new THREE.Box3().setFromObject(parts(g).print[0]);
      check('boksramme: papirtrykket ligger dypt (z = 0,3 · dybden), innenfor leppen', near(pb.max.z, 0.012, 1e-6) && pb.max.x - pb.min.x < L.innerW + 1e-9);
    }
    {
      // painted / black-metal frame bars: the orange peel at 0.3 × its tile (smooth matte up close); wood keeps its
      // grain, and a recolour onto wood drops the fine peel (finish optsMap)
      const fOpts = (g) => parts(g).frame?.[0]?.material?.userData?.opts?.scale ?? null;
      const black = R.buildModel({ archetype: 'art-frame', dims, params: { frame: 'thin', texture: 'paper', mat: true } });
      const oak = R.buildModel({ archetype: 'art-frame', dims, params: { frame: 'oak' }, materials: { frame: 'oak' }, colors: { frame: '#c39b6e' } });
      const set = R.buildModel({ archetype: 'art-set' });
      const s0 = fOpts(black);
      const toOak = black.userData.model.recolor('frame', '#c39b6e', 'oak');
      const s1 = fOpts(black), k1 = parts(black).frame[0].material.userData.kind;
      black.userData.model.recolor('frame', '#f1efea', 'painted');
      const s2 = fOpts(black);
      check('ramme i sort metall / malt: fin appelsinhud (scale 0,3), eik uendret, omfarging til eik dropper den',
        s0 === 0.3 && fOpts(oak) === null && fOpts(set) === 0.3 && toOak !== false && k1 === 'oak' && s1 === null && s2 === 0.3, `${s0} ${fOpts(oak)} ${fOpts(set)} ${k1}/${s1} ${s2}`);
    }
    // gallery walls
    const sp = [];
    for (const [layoutKey] of LAYOUT_OPTIONS) {
      const lay = galleryLayout(layoutKey);
      const bb = setBounds(lay.frames, lay.ledge);
      const d = { w: bb.w, d: lay.ledge ? 0.11 : 0.025, h: bb.h };
      for (const mirror of [false, true]) {
        const g = R.buildModel({ archetype: 'art-set', dims: d, params: { layout: layoutKey, mirror } });
        const P = parts(g);
        let meshes = 0;
        g.traverse((o) => o.isMesh && meshes++);
        const pm = P.print || [];
        if (g.userData.model.fallback) sp.push(`${layoutKey}: reserve`);
        else if (pm.length !== 1 || !pm[0].geometry.attributes.uv1) sp.push(`${layoutKey}: ${pm.length} trykk, uv1 ${!!pm[0]?.geometry.attributes.uv1}`);
        else if (meshes > 6) sp.push(`${layoutKey}: ${meshes} masker`);
        else if (pm[0].geometry.attributes.position.count !== 4 * lay.frames.length) sp.push(`${layoutKey}: ${pm[0].geometry.attributes.position.count / 4} trykkflater, ventet ${lay.frames.length}`);
        else if (!inDims(g, d, 0.003)) sp.push(`${layoutKey}${mirror ? ' speilvendt' : ''}: utenfor målene`);
      }
    }
    check('alle 15 oppsett (også speilvendt): ett sammenslått trykk med uv1, ≤ 6 masker, én flate per bilde, innenfor målene', !sp.length, sp.join('; '));
    {
      // «Oppsett: Bildehylle» picked on a gallery wall 2,5 cm deep (the Def and the catalogue sets): the ledge, its lip
      // and the leaning frames stay inside dims.d – placement, collisions and the selection box know only dims
      const lay = galleryLayout('ledge');
      const bb = setBounds(lay.frames, lay.ledge);
      const lp = [];
      for (const d of [0.025, 0.05]) {
        const dd = { w: bb.w, d, h: bb.h };
        const g = R.buildModel({ archetype: 'art-set', dims: dd, params: { layout: 'ledge' } });
        g.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(g);
        if (g.userData.model.fallback) lp.push(`d ${d}: reserve`);
        else if (!inDims(g, dd, 0.001)) lp.push(`d ${d}: z ${box.min.z.toFixed(4)} … ${box.max.z.toFixed(4)}`);
        else if (!(box.max.z > d * 0.9)) lp.push(`d ${d}: hylla bare ${box.max.z.toFixed(4)} dyp`);
      }
      check('bildehylle i et grunt sett (d 2,5 / 5 cm): hylla og rammene holder seg innenfor dybden', !lp.length, lp.join('; '));
    }
    {
      // an acoustic picture holding an own picture: the fabric sides are the same off-white whether the picture was
      // decoded when the panel was built (page load) or still pending (a rebuild after images.releaseDecoded())
      const AI = await imp('src/models/artImages.js');
      const prevSrc = AI.getArtImageSource();
      const id = `img-${'c'.repeat(28)}`;
      const spec = { archetype: 'acoustic-art', dims: { w: 1.8, d: 0.04, h: 1.2 }, params: { thickness: 0.04, motif: 'custom', imageId: id, imageAspect: 1.5 } };
      const sides = (g) => {
        const out = new Set();
        g.traverse((o) => o.isMesh && !o.userData.part && o.material?.userData?.kind === 'woven' && out.add(o.material.userData.hex));
        return [...out];
      };
      let pending, ready;
      try {
        AI.setArtImageSource(null);
        pending = sides(R.buildModel(spec));
        // a decoded picture (the fake canvas reads back black, so its «border colour» would be #000000)
        AI.setArtImageSource({ getSync: () => ({ width: 300, height: 200 }), request: async () => null, onReady: () => () => {}, onMissing: () => () => {}, status: () => 'ready', info: () => null });
        ready = sides(R.buildModel(spec));
      } finally {
        AI.setArtImageSource(prevSrc);
      }
      check('akustikkbilde med eget bilde: sidene er alltid #ece9e2 (lastet eller ikke)', JSON.stringify(pending) === '["#ece9e2"]' && JSON.stringify(ready) === '["#ece9e2"]',
        `${pending} / ${ready}`);
    }
    {
      const g = R.buildModel({ archetype: 'art-set', dims: { w: 1.47, d: 0.025, h: 0.9 }, params: { layout: 'triptych' } });
      const uv = parts(g).print[0].geometry.attributes.uv;
      const rs = [];
      for (let k = 0; k < uv.count; k += 4) {
        const us = [0, 1, 2, 3].map((j) => uv.getX(k + j));
        rs.push([Math.min(...us), Math.max(...us)]);
      }
      rs.sort((a, b2) => a[0] - b2[0]);
      check('triptyk: ett motiv over tre lerreter (uv 0 … 1 med mellomrom)', rs.length === 3 && near(rs[0][0], 0, 1e-6) && near(rs[2][1], 1, 1e-6) && rs[1][0] > rs[0][1] && rs[2][0] > rs[1][1] &&
        !/print set/.test(parts(g).print[0].material.name));
    }
    {
      const g = R.buildModel({ archetype: 'art-set', dims: { w: 1, d: 0.025, h: 0.5 }, params: { layout: 'custom', frames: [
        { x: -0.25, y: 0, w: 0.4, h: 0.5, motif: 'landscape', finish: 'gold' }, { x: 0.25, y: 0, w: 0.4, h: 0.5, imageId: `img-${'a'.repeat(28)}`, imageAspect: 1.5 }] } });
      const P = parts(g);
      const custom = P.print?.find((m) => /custom/.test(m.material.name));
      const gold = [];
      g.traverse((o) => o.isMesh && o.material?.userData?.kind === 'brass' && gold.push(o));
      check('egne rammer: fast gullfinish utenfor «Ramme»-delen, eget bilde som eget trykk med uv1', !g.userData.model.fallback && P.print?.length === 2 && !!custom?.geometry.attributes.uv1 &&
        gold.length === 1 && !gold[0].userData.part && (P.frame || []).every((m) => m.material.userData.kind === 'black-metal'));
    }
    {
      const id = `img-${'b'.repeat(28)}`;
      const g = R.buildModel({ archetype: 'art-frame', dims: { w: 0.6, d: 0.025, h: 0.45 }, params: { motif: 'custom', imageId: id, imageAspect: 1.5, frame: 'thin', mat: true, matW: 0.05, texture: 'photo', glass: true } });
      const m = parts(g).print?.[0]?.material;
      const L = artLayout({ w: 0.6, h: 0.45 }, { motif: 'custom', imageId: id, frame: 'thin', mat: true, matW: 0.05, texture: 'photo' });
      const cv = m?.map?.image;
      check('eget bilde: lerretet lages i endelig størrelse (bildeflatens forhold), kart + vevnormaler på kanal 1', !!cv && near(cv.width / cv.height, L.picW / L.picH, 0.05) &&
        Math.max(cv.width, cv.height) === Math.min(artResFor('medium', L.picW, L.picH), 1600) && m.normalMap?.channel === 1 && m.roughness === 0.22);
      const g2 = R.buildModel({ archetype: 'art-frame', params: { motif: 'custom' } });
      const m2 = parts(g2).print?.[0]?.material;
      check('«Eget bilde» uten bilde viser fjordfotoet som før (malt motiv, ikke et opplastet bilde)', m2?.name === 'print custom #c9cfcd' && !/^custom /.test(m2.map?.name ?? ''));
    }
  } finally {
    if (!had) delete globalThis.document;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
section('Katalog: kunst (art.md §7.1, MASTER D18, D50)');
{
  const C = await imp('src/catalog/index.js');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/house-tests/fixtures/catalog-baseline.json'), 'utf8'));
  const BASE_IDS = new Set(Object.values(base.products).flat());
  const kunst = C.products('kunst');
  const merged = kunst.some((p) => !BASE_IDS.has(p.id)); // the round's research is in src/data
  const known = new Set([...LEGACY_MOTIFS, ...CONTRACT_MOTIFS, 'custom']);
  const frames = FRAME_OPTIONS.map(([k]) => k), layouts = LAYOUT_OPTIONS.map(([k]) => k);
  const JUNK = ['w', 'h', 'orientation', 'accentColor', 'lineColor'];
  const problems = [];
  const combos = new Map();
  const motifs = new Set();
  for (const p of kunst) {
    const P = p.params || {};
    const bad = (m) => problems.push(`${p.id}: ${m}`);
    if (p.archetype !== 'art-frame' && p.archetype !== 'art-set') bad(`arketype ${p.archetype}`);
    const ms = p.archetype === 'art-set' ? [P.motif, ...(Array.isArray(P.motifs) ? P.motifs.map((m) => m?.motif) : [])].filter((x) => x != null) : [P.motif];
    for (const m of ms) {
      if (!known.has(m)) bad(`ukjent motiv ${m}`);
      else motifs.add(m);
    }
    if (P.seed != null && !(Number.isInteger(P.seed) && P.seed >= 1 && P.seed <= 20)) bad(`seed ${P.seed}`);
    // MASTER §2.3: palette = 3–6 '#rrggbb' (palette[1] = colors.print)
    if (P.palette != null && !(Array.isArray(P.palette) && P.palette.length >= 3 && P.palette.length <= 6 && P.palette.every((x) => HEX.test(x)))) bad('palette er ikke 3–6 hex');
    if (!BASE_IDS.has(p.id) && P.motif !== 'custom' && p.archetype === 'art-frame' && !Array.isArray(P.palette)) bad('mangler palette');
    for (const v of p.variants || []) {
      if (Array.isArray(P.palette) && String(v.colors?.print).toLowerCase() !== P.palette[1].toLowerCase()) bad(`variant «${v.name}»: colors.print ≠ palette[1]`);
      if (!v.materials?.frame || !HEX.test(v.colors?.frame ?? '')) bad(`variant «${v.name}»: materials.frame / colors.frame mangler`);
      if (!BASE_IDS.has(p.id) && JUNK.some((k) => v.params && k in v.params)) bad(`variant «${v.name}»: søppelparametre`);
    }
    if (!frames.includes(P.frame ?? 'black')) bad(`ramme ${P.frame}`);
    if (P.depth != null && P.depth !== p.dims?.d) bad(`params.depth ${P.depth} ≠ dims.d ${p.dims?.d}`);
    if (JUNK.some((k) => k in P)) bad('søppelparametre');
    if (P.imageId != null) bad('imageId i katalogdata');
    if (P.innerW != null || P.innerH != null) bad('innerW/innerH');
    if (typeof P.motifOpts?.text === 'string' && /^\s*[\d.,\s]+\s*$/.test(P.motifOpts.text)) bad('rent numerisk motivtekst');
    if (p.archetype === 'art-set' && !layouts.includes(P.layout ?? 'salon-5')) bad(`oppsett ${P.layout}`);
    const range = archetypes[p.archetype]?.dimsRange;
    if (range && ['w', 'd', 'h'].some((k) => !(p.dims?.[k] >= range[k][0] - 1e-9 && p.dims?.[k] <= range[k][1] + 1e-9))) bad(`mål ${JSON.stringify(p.dims)} utenfor ${JSON.stringify(range)}`);
    if (P.acceptsImage && p.subcategory !== 'ramme') bad('acceptsImage uten underkategori «ramme»');
    if (P.frame === 'none' && (P.texture === 'paper' || P.texture === 'photo') && !BASE_IDS.has(p.id) && !(p.dims?.d <= 0.006 && P.edge === 'white')) bad('plakat uten ramme: d 0,005 og edge white');
    const key = `${P.motif}|${P.seed}|${(P.palette || []).join(',')}`;
    if (p.archetype === 'art-frame' && P.motif !== 'custom') {
      if (combos.has(key)) bad(`samme motiv, seed og palett som ${combos.get(key)}`);
      combos.set(key, p.id);
    }
  }
  check(`alle ${kunst.length} kunstprodukter følger datareglene`, !problems.length, problems.slice(0, 8).join('; '));
  soft('minst 40 produkter i Kunst og bilder', kunst.length >= 40, `${kunst.length}`, !merged);
  soft('minst 20 forskjellige motiver', motifs.size >= 20, `${motifs.size}`, !merged);
  soft('minst 2 bildevegger og 5 tomme rammer', kunst.filter((p) => p.archetype === 'art-set').length >= 2 && kunst.filter((p) => p.params?.acceptsImage).length >= 5,
    `${kunst.filter((p) => p.archetype === 'art-set').length} sett, ${kunst.filter((p) => p.params?.acceptsImage).length} rammer`, !merged);
  const { artFacts } = await imp('src/catalog/artfacts.js');
  const rows = artFacts({ archetype: 'art-frame', dims: { w: 0.5, d: 0.02, h: 0.7 }, variants: [{ materials: { frame: 'oak' } }] }, { frame: 'thin', texture: 'paper', mat: true, matW: 0.05, glass: true, acceptsImage: true });
  check('Fakta: tom ramme – «Selges tom», ramme, passepartout, glass', JSON.stringify(rows) === JSON.stringify([['Selges tom', 'Ja – legg inn ditt eget bilde (Last opp eget bilde)'], ['Ramme', 'Tynn ramme, eik, 1 cm'], ['Passepartout', 'Ja, 5 cm'], ['Glass', 'Ja']]), JSON.stringify(rows));
  const poster = artFacts({ archetype: 'art-frame', dims: { w: 0.5, d: 0.005, h: 0.7 }, variants: [{}] }, { frame: 'none', texture: 'paper' });
  check('Fakta: plakat – «Selges uten ramme»', JSON.stringify(poster) === JSON.stringify([['Selges uten ramme', 'Ja – rammen kjøpes separat']]));
  const set = artFacts({ archetype: 'art-set', dims: { w: 1.32, d: 0.025, h: 0.76 }, variants: [{ materials: { frame: 'black-metal' } }] }, { layout: 'salon-5', frame: 'thin', mat: true, glass: true });
  check('Fakta: bildevegg – antall bilder og oppsett', set[0]?.[0] === 'Bildevegg' && set[0][1] === '5 bilder (salongvegg 5)');
  check('Fakta: andre produkter får ingen kunstrader', artFacts({ archetype: 'sofa' }, {}).length === 0);
}

// ---------------------------------------------------------------------------------------------------------------------
section('Bildeparametre overlever lagring og lasting (DesignState, art.md §8.2 punkt 11)');
{
  const { DesignState } = await imp('src/design/DesignState.js');
  const { layout } = await imp('src/home/layout.js');
  const d = new DesignState({ layout, original: false });
  const params = { motif: 'custom', imageId: `img-${'a'.repeat(28)}`, imageAspect: 1.5, fit: 'contain', focus: [0.3, 0.6], motifOpts: { variant: 'x', text: 'Hei' }, frame: 'thin', mat: true, matW: 0.05, glass: true, edge: 'white' };
  const uid = d.add({ source: 'custom', refId: 'custom-image', name: 'Eget bilde – test', category: 'kunst', archetype: 'art-frame', mount: 'wall', dims: { w: 0.6, d: 0.025, h: 0.45 }, params, colors: { print: '#e6e2da', frame: '#151515' }, materials: { print: 'paper', frame: 'black-metal' }, position: [4.3, 1.5, 11.93] });
  const frames = Array.from({ length: 16 }, (_, i) => ({ x: (i % 4) * 0.3 - 0.45, y: Math.floor(i / 4) * 0.3 - 0.45, w: 0.25, h: 0.25, motif: 'fjord', seed: i + 1, palette: ['#f3eee3', '#6f7d5c', '#a3a98a', '#2f3527', '#c9b48a'], motifOpts: { variant: 'a' } }));
  const uid2 = d.add({ source: 'catalog', refId: 'x', name: 'Bildevegg – test', category: 'kunst', archetype: 'art-set', mount: 'wall', dims: { w: 1.2, d: 0.025, h: 1.2 }, params: { layout: 'custom', frames }, position: [4.3, 1.5, 11.93] });
  const d2 = new DesignState({ layout, original: false });
  d2.load(JSON.parse(JSON.stringify(d.toJSON())));
  check('eget bilde: imageId, imageAspect, fit, focus, motifOpts og rammevalg er intakte', JSON.stringify(d2.get(uid)?.params) === JSON.stringify(d.get(uid)?.params) &&
    d2.get(uid).params.imageId === params.imageId && d2.get(uid).params.focus?.[1] === 0.6 && d2.get(uid).params.motifOpts?.text === 'Hei');
  check('bildevegg med 16 rammer (hver med palett) overlever nestingen', JSON.stringify(d2.get(uid2)?.params.frames) === JSON.stringify(frames));
}

console.log(`\n  (${Date.now() - t0} ms)`);
done();
