#!/usr/bin/env node
/**
 * The v1 save fixture (tools/house-tests/fixtures/design-v1.json, made in steg 2 with today's DesignState: today's
 * room, the curtain «Rebell Sondre» on win-s1, w-hoy painted #7d8a80) still loads as it was saved – the guard for the
 * save format change in steg 16 (DESIGN_VERSION 2, level, meta.originalRooms) and for new rooms and surfaces:
 *   - the file itself is a version 1 design (it is never rewritten);
 *   - after load: w-hoy keeps its paint, win-s1 its curtain, every saved item is there with its position;
 *   - the living room's reverberation for the fixture stays 0.825 s (curtain on win-s1) and today's room 0.86 s.
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';

const FIXTURE = 'tools/house-tests/fixtures/design-v1.json';
/** computeAcoustics(fixture) with today's code (steg 2): the curtain on win-s1 absorbs ≈ 1.09 m² more. */
const FIXTURE_RT60 = 0.8254;

const fx = readJson(FIXTURE);
const { DesignState } = await imp('src/design/DesignState.js');
const { layout } = await imp('src/home/layout.js');
const { computeAcoustics } = await imp('src/design/Acoustics.js');

section('The fixture file');
check('version 1', fx.version === 1, `version ${fx.version}`);
check('curtain on win-s1', fx.windows?.['win-s1']?.archetype === 'curtain' && fx.windows['win-s1'].productId === 'bohus-rebell-sondre-gardinlengde-140x220');
check('w-hoy painted #7d8a80', fx.paints?.['w-hoy'] === '#7d8a80');
check('66 items, all existing furniture (uid ex-…)', fx.items.length === 66 && fx.items.every((it) => it.source === 'existing' && it.uid.startsWith('ex-')), `${fx.items.length} items`);

section('Loading it');
const d = new DesignState({ layout, original: false });
d.load(JSON.stringify(fx));
check('w-hoy keeps its paint', d.paints['w-hoy'] === '#7d8a80', JSON.stringify(d.paints));
check('win-s1 keeps its curtain', d.windows['win-s1']?.archetype === 'curtain' && d.windows['win-s1']?.productId === 'bohus-rebell-sondre-gardinlengde-140x220' && d.windows['win-s1']?.open === 1);
const missing = fx.items.filter((it) => {
  const got = d.get(it.uid);
  return !got || got.position.some((v, i) => !near(v, it.position[i], 1e-9));
});
check('every saved item is there, at its saved position', !missing.length, missing.map((it) => it.uid).join(', '));
check('the name is kept', d.meta.name === fx.meta.name, d.meta.name);

section('Reverberation (stua)');
const rt = computeAcoustics(d, { layout }).rt60;
check(`fixture RT60 ≈ ${FIXTURE_RT60} s`, near(rt, FIXTURE_RT60, 0.002), `rt60 ${rt}`);
const today = computeAcoustics(new DesignState({ layout }), { layout }).rt60;
check("today's room RT60 0.86 s", near(today, 0.86, 0.005), `rt60 ${today}`);

done();
