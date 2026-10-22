/**
 * Tests for src/planbygger/generate.js («Generer»: all the drawings → a walkable house) and src/planbygger/questions.js.
 * Plain Node, no browser, no AI key – the AI answers are the recordings in tools/fixtures/planbygger-ai/, replayed by
 * tools/planbygger-ai-fixtures.mjs:
 *
 *   node tools/test-planbygger-generate.mjs [--quick] [--json file]   (--quick: hus1, hus3 and hus8 only; --json: the
 *                                                                       numbers, for planbygger-measure-all.mjs --from)
 *
 *   1. names, titles and levels; display names
 *   2. questions.js: every kind of answer changes the document as it says, and nothing else
 *   3. the fixture transport: frames (crop, rectified photo), marks matching, items outside a crop dropped
 *   4. the executor (opts.exec) and a synthetic plan without AI: only the named heavy steps go through it
 *   4b. when things go wrong: an AI that answers {} or throws, an executor that hands back null (an empty level is said,
 *      with a question), one drawing in two files (once – or twice when the names say two floors), and a scale
 *      inherited from another floor that leaves the level empty (measured again alone)
 *   5. every house of the test set with the recorded AI answers, against fasit.json (thresholds from what round 1
 *      reaches – a check that fails here is a regression; besides them every level has walls and a room, the
 *      skylights exact, and a scale more than 3 % off asked)
 *   6. every house without AI: it still works, in the right order, with more questions; a scale more than 15 % off or a
 *      level without a room is asked
 *   7. the round's «done means» targets on hus1, hus2, hus3 and hus5, as explicit goals: they may fail, and say so
 *      («MÅL … IKKE NÅDD» and a tally; they fail the run only with --strict-goals)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, imp, check, section, done } from './planbygger-lib.mjs';
import { readPng } from './planbygger-png.mjs';
import { fixtureAi, frameMap, marksHash } from './planbygger-ai-fixtures.mjs';
import { HOUSES, houseInputs, measureHouse, doneMeans, OPEN_PLANS } from './planbygger-measure-all.mjs';
import { renderPlan, samplePlans } from './planbygger-synth.mjs';

const G = await imp('src/planbygger/generate.js');
const Q = await imp('src/planbygger/questions.js');
const M = await imp('src/planbygger/model.js');
const E = await imp('src/planbygger/export.js');
const quick = process.argv.includes('--quick');
const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(2)} %`);

// ---------------------------------------------------------------------------------------------------------------
section('1. Navn, titler og etasjer');
{
  const L = (s) => G.levelWords(s);
  check('«1etg.png» → 0', L('1etg.png').level === 0);
  check('«2etg.avif» → 1', L('2etg.avif').level === 1);
  check('«plan-1etg-tilbygg.pdf» → 0', L('plan-1etg-tilbygg.pdf').level === 0);
  check('«Etasje 2» → 1', L('Etasje 2').level === 1);
  check('«Plan 1 etg.» → 0', L('Plan 1 etg.').level === 0);
  check('«2. etasje» → 1', L('2. etasje').level === 1);
  check('«underetasje.jpg», «Under etg», «Kjeller» → −1', [L('underetasje.jpg'), L('Under etg'), L('Kjeller')].every((x) => x.level === -1));
  check('«ovre-etasje.jpg», «Øvre etg» → over kjelleren', [L('ovre-etasje.jpg'), L('Øvre etg')].every((x) => x.tag === 'upper' && x.level == null));
  check('«plantegning-1.jpg», «garasje-plan-snitt-fasade.pdf» → ingenting', [L('plantegning-1.jpg'), L('garasje-plan-snitt-fasade.pdf')].every((x) => x.level == null && x.tag == null));
  check('«loft.png» → øverst', L('loft.png').tag === 'loft');
  check('visningsnavn: «KJØKKEN/STUE» → «Kjøkken/stue», «WC/D» blir stående, «TV-Stue» blir stående', G.displayName('KJØKKEN/STUE') === 'Kjøkken/stue' && G.displayName('WC/D') === 'WC/D' && G.displayName('TV-Stue') === 'TV-Stue', `${G.displayName('KJØKKEN/STUE')} ${G.displayName('WC/D')} ${G.displayName('SOV')}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('1b. Åpne planer (OPEN_PLANS i planbygger-measure-all.mjs) mot fasiten');
{
  // «rom med navn» counts a room with the labels of one open area as right only where the drawing shows that area open
  // (nothing drawn between the labels). The evidence per case is the fasit's own sentence, quoted in OPEN_PLANS with
  // what a crop showed: here the quote must still stand in that level's notes, and every room of the group must be a
  // fasit room of the level – so the list cannot grow into a blanket rule or outlive a corrected fasit.
  for (const [key, groups] of Object.entries(OPEN_PLANS)) {
    const [house, file] = key.split(' ');
    const lv = JSON.parse(fs.readFileSync(path.join(ROOT, 'plantegninger', house, 'fasit.json'), 'utf8')).levels.find((l) => l.file === file);
    for (const g of groups) {
      const all = g.rooms.every(([label, area]) => lv?.rooms.some((r) => r.label === label && (area == null ? r.area == null : Math.abs(r.area - area) < 0.05)));
      check(`${key}: ${g.rooms.map(([l, a]) => `${l}${a != null ? ` ${a}` : ''}`).join(' + ')} er en åpen plan i fasiten («${g.fasit}»)`, !!lv && (lv.notes ?? '').includes(g.fasit) && all && g.rooms.length >= 2);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('2. Svarene (questions.js applyAnswers)');
{
  const doc = M.createDoc('test');
  const L = M.createLevel(doc, { id: 'hoved', name: '1. etasje', image: { name: 'x.png', width: 500, height: 400, pxPerM: 50 } });
  // a 6 × 4 m box with a window, a door and a room label
  const a = M.addWall(L, [0, 0], [6, 0], 0.2);
  M.addWall(L, [6, 0], [6, 4], 0.2);
  M.addWall(L, [6, 4], [0, 4], 0.2);
  M.addWall(L, [0, 4], [0, 0], 0.2);
  const win = M.addOpening(L, a.id, 2, 'window');
  M.addOpening(L, a.id, 4.5, 'door');
  L.rooms.push({ id: 'r1', name: 'Rom', kind: 'living', seed: [3, 2], auto: true });
  const up = M.createLevel(doc, { id: 'etasje-2', name: '2. etasje', floorY: 2.7, image: { name: 'y.png', width: 500, height: 400, pxPerM: 50 } });
  up.stairs = [{ id: 't1', rect: [[1, 1], [2, 3]], axis: 'y', down: 1 }];
  const questions = [
    Q.scaleQuestion({ key: 'x.png', level: 'hoved', file: 'x.png', crop: null, outlinePx: 310, pxPerM: 50, method: 'standard', confidence: 'low', why: 'Test.' }),
    Q.ceilingQuestion({ level: 'hoved', levelName: '1. etasje', file: 'x.png', crop: null, value: 2.4 }),
    Q.windowsQuestion({ sill: 0.9, height: 1.2 }),
    Q.roomQuestion({ level: 'hoved', levelName: '1. etasje', file: 'x.png', crop: null, roomId: 'r1', seed: [3, 2], area: 24, name: 'Stue', kind: 'living', why: 'Test.' }),
    Q.stairQuestion({ level: 'etasje-2', levelName: '2. etasje', file: 'y.png', crop: null, value: 'straight', why: 'Test.', stairId: 't1' }),
    Q.orderQuestion({ levels: [{ id: 'hoved', name: '1. etasje', file: 'x.png' }, { id: 'etasje-2', name: '2. etasje', file: 'y.png' }], why: 'Test.' }),
    Q.braQuestion({ key: 'y.png', level: 'etasje-2', levelName: '2. etasje', file: 'y.png', crop: null, innerM2: 100, pxPerM: 50, confidence: 'low' }),
  ];
  check('alle spørsmålene har id, tekst på norsk og et standardsvar', questions.every((q) => q.id && /[a-zæøå]/i.test(q.text) && 'default' in q), questions.map((q) => q.id).join(', '));
  check('skalaspørsmålet foreslår husets bredde (310 px / 50 = 6,2 m)', questions[0].default === 6.2, String(questions[0].default));
  const before = JSON.stringify(doc);
  const same = Q.applyAnswers(doc, questions, {});
  check('ingen svar: dokumentet er det samme (en kopi)', JSON.stringify({ ...same, generated: undefined }) === JSON.stringify({ ...JSON.parse(before), generated: undefined }) && same !== doc);
  const out = Q.applyAnswers(doc, questions, {
    'scale:x.png': 3.1, // the house is half as wide: px/m doubles, every coordinate halves
    'ceiling:hoved': '2,6',
    'windows:hus': { sill: 1, height: 1.1 },
    'room:hoved:r1': { name: 'Kjøkken', kind: 'living' },
    'stair:etasje-2': 'u',
    'order:hus': ['etasje-2', 'hoved'],
    'bra:y.png': 25,
  });
  const H = out.levels.find((l) => l.id === 'hoved');
  const U = out.levels.find((l) => l.id === 'etasje-2');
  check('skala: 100 px/m, veggene halvparten så lange', Math.abs(H.image.pxPerM - 100) < 1e-6 && Math.abs(H.walls[0].b[0] - 3) < 1e-6, `${H.image.pxPerM} ${H.walls[0].b}`);
  check('takhøyde «2,6» → 2,6 m', H.ceiling === 2.6);
  check('vinduene: brystning 1,0, høyde 1,1', H.openings.filter((o) => o.type === 'window').every((o) => o.sill === 1 && o.height === 1.1));
  check('rommet heter «Kjøkken» og er ikke lenger et forslag', H.rooms[0].name === 'Kjøkken' && H.rooms[0].auto === false);
  check('trappa er en U-trapp', U.stairs[0].kind === 'u');
  check('rekkefølgen: 2. etasje under hovedetasjen (−2,7 m), hovedetasjen på 0', U.floorY === -2.7 && H.floorY === 0, `${U.floorY} ${H.floorY}`);
  check('BRA 25 m² mot 100 m² ved 50 px/m → 100 px/m', Math.abs(U.image.pxPerM - 100) < 1e-6, String(U.image.pxPerM));
  check('svarene står i doc.generated.answered', out.generated.answered.length === 7, out.generated.answered.join(', '));
  check('originalen er urørt', JSON.stringify(doc) === before);
  check('vinduet i originalen har standardhøyden', doc.levels[0].openings.find((o) => o.id === win.id).sill === 0.9);
  const none = Q.applyAnswers(doc, questions, { 'stair:etasje-2': 'none' });
  check('«ingen trapp» fjerner trappa', none.levels.find((l) => l.id === 'etasje-2').stairs.length === 0);
  // a stair taken out again (too steep for the player: generate.js) is asked with «no stair» as the default; a straight
  // or U answer puts it back as it was found – its way down and the side of its top flight
  const out2 = M.clone(doc);
  out2.levels.find((l) => l.id === 'etasje-2').stairs = [];
  const steepQ = Q.stairQuestion({ level: 'etasje-2', levelName: '2. etasje', file: 'y.png', crop: null, value: 'none', why: 'For bratt.', rect: [[1, 1], [3, 3]], axis: 'x', stair: { rect: [[1, 1], [3, 3]], axis: 'x', down: -1, side: 1 } });
  const kept = Q.applyAnswers(out2, [steepQ], { 'stair:etasje-2': steepQ.default });
  const back = Q.applyAnswers(out2, [steepQ], { 'stair:etasje-2': 'u' });
  const bs = back.levels.find((l) => l.id === 'etasje-2').stairs[0];
  // the lines of a stair symbol read as walls (generate.js dropTreadLines; hus9): thin, across the flight and inside the
  // stair's box they go; the line at the box's end, a parallel one, a thick wall and one with a door stay
  const TL = M.createLevel(M.createDoc('Trinn'), { id: 'hoved' });
  TL.walls = [
    { id: 'band-n', a: [0, 0], b: [4, 0], t: 0.2 },
    { id: 'band-s', a: [0, 1], b: [4, 1], t: 0.06 },
    { id: 'enden', a: [0.5, 0], b: [0.5, 1], t: 0.06 },
    { id: 'trinn-1', a: [1.5, 0], b: [1.5, 1], t: 0.06 },
    { id: 'trinn-2', a: [2.2, 0.05], b: [2.2, 0.95], t: 0.05 },
    { id: 'tykk', a: [3, 0], b: [3, 1], t: 0.15 },
    { id: 'med-dør', a: [3.4, 0], b: [3.4, 1], t: 0.06 },
  ];
  TL.openings = [{ id: 'd1', wall: 'med-dør', type: 'door', at: 0.5, width: 0.8 }];
  const treads = G._internal.dropTreadLines(TL, [0.5, 0.05, 4, 0.95]).sort();
  check('trappesymbolets streker på tvers inne i trappa tas bort, ikke enden, langsgående streker, tykke vegger eller en vegg med dør', treads.join() === 'trinn-1,trinn-2' && TL.walls.length === 5, treads.join(', '));
  check('en trapp som er tatt ut (for bratt): standardsvaret «ingen» lar den være ute, «U-trapp» setter den inn igjen som funnet', steepQ.default === 'none' && kept.levels.find((l) => l.id === 'etasje-2').stairs.length === 0 && bs?.kind === 'u' && bs.axis === 'x' && bs.down === -1 && bs.side === 1, JSON.stringify(bs));
  const bad = Q.applyAnswers(doc, questions, { 'ceiling:hoved': 'tja', 'scale:x.png': -2, 'ukjent:id': 3 });
  check('tull og ukjente id-er hoppes over', bad.generated.answered.length === 0);
  // window heights from facade readings
  const per = Q.windowsPerStorey([{ pxPerM: 100, floorYs: [500, 230], windows: [{ y0: 300, y1: 409, kind: 'window', storey: 0 }, { y0: 290, y1: 419, kind: 'window', storey: 0 }, { y0: 100, y1: 179, kind: 'window', storey: 1 }, { y0: 290, y1: 499, kind: 'door', storey: 0 }] }]);
  check('fasadevinduer per etasje: brystning og høyde i meter, dører telles ikke', per[0]?.n === 2 && Math.abs(per[0].sill - 0.85) < 1e-9 && Math.abs(per[0].height - 1.2) < 1e-9 && per[1]?.n === 1 && Math.abs(per[1].sill - 0.5) < 1e-9, JSON.stringify(per));
}

// ---------------------------------------------------------------------------------------------------------------
section('3. KI-opptakene (tools/planbygger-ai-fixtures.mjs)');
{
  const id = frameMap({ file: 'a.png', width: 1000, height: 800, bbox: null, photo: null }, 1000, 800);
  check('hele fila: punktene er de samme', id.identity && JSON.stringify(id.pt([0.25, 0.5])) === JSON.stringify([0.25, 0.5]) && id.cover === 1);
  const cr = frameMap({ file: 'a.png', width: 1000, height: 800, bbox: [500, 400, 1000, 800], photo: null }, 1000, 800);
  const p = cr.pt([0.75, 0.75]);
  check('utsnittet (høyre nedre fjerdedel): (0,75; 0,75) → (0,5; 0,5)', Math.abs(p[0] - 0.5) < 1e-9 && Math.abs(p[1] - 0.5) < 1e-9 && Math.abs(cr.cover - 0.25) < 1e-6, `${p} dekning ${cr.cover}`);
  check('et punkt utenfor utsnittet faller bort', cr.pt([0.2, 0.2]) === null);
  const ph = frameMap({ file: 'f.jpg', width: 1000, height: 1000, bbox: null, photo: { quad: [[100, 100], [900, 100], [900, 900], [100, 900]], width: 400, height: 400 } }, 1000, 1000);
  const q = ph.pt([0.5, 0.3]);
  check('rettet foto: arkets hjørner (100, 100)–(900, 900) → hele bildet; (0,5; 0,3) → (0,5; 0,25)', Math.abs(q[0] - 0.5) < 1e-6 && Math.abs(q[1] - 0.25) < 1e-6, String(q));
  check('merke-hash: samme merker gir samme hash, et flyttet merke en annen', marksHash([{ id: '1', kind: 'room', at: [0.1, 0.2] }]) === marksHash([{ id: '1', kind: 'room', at: [0.1, 0.2] }]) && marksHash([{ id: '1', kind: 'room', at: [0.1, 0.2] }]) !== marksHash([{ id: '1', kind: 'room', at: [0.1, 0.25] }]));
  // a recorded answer, replayed for the whole file and for a crop of it
  const img = readPng(path.join(ROOT, 'plantegninger/hus1/1etg.png'));
  const ai = fixtureAi({ house: 'hus1' });
  const whole = await ai.read('readPlan', { image: img, marks: [], unmarked: [], hints: { fileName: '1etg.png' }, source: { file: '1etg.png', part: null, width: img.width, height: img.height, bbox: null, photo: null } });
  check('hus1 1etg: opptaket spilles av (6 rom, 18 åpninger), merkene stemmer ikke med våre', whole?.rooms.length === 6 && whole.openings.length === 18 && whole.meta.marksMatch === false, `${whole?.rooms.length} rom, ${whole?.openings.length} åpninger`);
  const half = await ai.read('readPlan', { image: img, marks: [], unmarked: [], hints: { fileName: '1etg.png' }, source: { file: '1etg.png', part: 0, width: img.width, height: img.height, bbox: [0, 0, img.width / 2, img.height], photo: null } });
  const left = whole.rooms.filter((r) => r.at[0] < 0.5).length;
  check('venstre halvdel: bare rommene der (punktene ganget med 2 i x)', half && half.rooms.length === left && half.rooms.every((r) => r.at[0] <= 1), `${half?.rooms.length} av ${whole.rooms.length}, venstre ${left}`);
  const none = await ai.read('readFacade', { image: img, source: { file: 'ukjent.png', width: 10, height: 10 } });
  check('uten opptak: null (som en KI som ikke svarer)', none === null && ai.calls.length === 3);
}

// ---------------------------------------------------------------------------------------------------------------
section('4. Utføreren (opts.exec) og en syntetisk plan uten KI');
{
  const flat = samplePlans().flat ?? Object.values(samplePlans())[0];
  const { img } = renderPlan(flat, { pxPerM: 50 });
  const called = [];
  const D = {
    rectifyPhoto: (await imp('src/planbygger/photo.js')).rectifyPhoto,
    splitSheet: (await imp('src/planbygger/sheet.js')).splitSheet,
    cleanForWalls: (await imp('src/planbygger/clean.js')).cleanForWalls,
    detectPlan: (await imp('src/planbygger/detect.js')).detectPlan,
    autoScale: (await imp('src/planbygger/autoscale.js')).autoScale,
    readFacade: (await imp('src/planbygger/facade.js')).readFacade,
    findStairs: (await imp('src/planbygger/align.js')).findStairs,
  };
  let cloned = 0;
  const exec = async (name, ...args) => {
    called.push(name);
    if (!D[name]) throw new Error(`ukjent steg ${name}`);
    // what a worker gets and gives back: plain data (structuredClone fails on functions). autoScale's `rooms` holds a
    // function (findRooms' at): the worker posts the rest, and generate.js does not use it
    const sent = structuredClone(args);
    const out = await D[name](...sent);
    const back = structuredClone(name === 'autoScale' && out ? { ...out, rooms: null } : out);
    cloned++;
    return back;
  };
  const progress = [];
  const res = await G.generate([{ name: 'syntetisk.png', img }], { exec, onProgress: (p) => progress.push(p) });
  const allowed = new Set(Object.keys(D));
  check('bare de navngitte tunge stegene går gjennom utføreren', called.length > 0 && called.every((n) => allowed.has(n)), [...new Set(called)].join(', '));
  check(`argumenter og svar er rene data: structuredClone begge veier gikk for alle ${called.length} kallene`, cloned === called.length, `${cloned} av ${called.length}`);
  check('rectifyPhoto, splitSheet, autoScale og detectPlan ble brukt', ['rectifyPhoto', 'splitSheet', 'autoScale', 'detectPlan'].every((n) => called.includes(n)));
  const L = res.doc.levels[0];
  check('én etasje, «hoved», med vegger og rom', res.doc.levels.length === 1 && L.id === 'hoved' && L.walls.length >= 4, `${L?.walls.length} vegger`);
  check('skalaen fra standardmålene, med et spørsmål om husets bredde', /standard/.test(L.image.scaleFrom.method) && res.questions.some((q) => q.kind === 'scale'), `${L.image.scaleFrom.method} ${L.image.pxPerM} px/m (sann 50)`);
  check('skalaen er innen 15 % uten KI (standardmål)', Math.abs(L.image.pxPerM / 50 - 1) < 0.15, pct(L.image.pxPerM / 50 - 1));
  check('fremdriften får norsk tekst per steg', progress.length >= 5 && progress.every((p) => typeof p.text === 'string' && p.text.length > 3), `${progress.length} steg`);
  check('fremdriften går aldri over totalen, og ender på den', progress.every((p) => p.done <= p.total) && progress.at(-1).done === progress.at(-1).total, progress.map((p) => `${p.done}/${p.total}`).join(' '));
  check('rapporten har metode og sikkerhet per steg', res.report.steps.length >= 5 && res.report.steps.every((s) => s.step && 'confidence' in s));
  check('bildet etasjen ble lest på, er med (images.hoved)', res.images.hoved?.img?.width === img.width);
  const direct = await G.generate([{ name: 'syntetisk.png', img }], {});
  check('direkte kall gir det samme som utføreren', direct.doc.levels[0].walls.length === L.walls.length && direct.doc.levels[0].image.pxPerM === L.image.pxPerM, `${direct.doc.levels[0].walls.length} / ${L.walls.length}`);
  const ex = E.exportHouse(res.doc);
  check('husfila eksporteres', ex.house.rooms.length >= 1, `${ex.house.rooms.length} rom`);
  const again = await G.generate([{ name: 'syntetisk.png', img }], { answers: { [res.questions.find((q) => q.kind === 'scale').id]: res.questions.find((q) => q.kind === 'scale').default * (L.image.pxPerM / 50) } });
  check('på nytt med svaret på skalaspørsmålet: skalaen er gitt (innen 2 %)', again.doc.levels[0].image.scaleFrom.method === 'given' && Math.abs(again.doc.levels[0].image.pxPerM / 50 - 1) < 0.02, `${again.doc.levels[0].image.pxPerM}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('4b. Når noe går galt: rare svar, tomme etasjer, like tegninger, en arvet skala som ikke passer');
{
  const flat = samplePlans().flat ?? Object.values(samplePlans())[0];
  const { img } = renderPlan(flat, { pxPerM: 50 });
  const one = [{ name: 'syntetisk.png', img }];
  // an AI transport that answers {} to everything, and one that throws: like no AI
  const junk = await G.generate(one, { ai: { read: async () => ({}) } });
  check('KI som svarer {} på alt: ingen krasj, etasjen har vegger og rom', junk.doc.levels.length === 1 && junk.doc.levels[0].walls.length >= 4 && junk.doc.levels[0].rooms.length + junk.questions.filter((q) => q.kind === 'room').length >= 1, `${junk.doc.levels[0]?.walls.length} vegger`);
  const thrown = await G.generate(one, { ai: { read: async () => { throw new Error('nede'); } } });
  check('KI som kaster: som uten KI (samme vegger)', thrown.doc.levels[0]?.walls.length === junk.doc.levels[0].walls.length && thrown.report.ai.every((a) => !a.ok));
  // an executor that hands back null for the detection and the scale step
  const D = { rectifyPhoto: (await imp('src/planbygger/photo.js')).rectifyPhoto, splitSheet: (await imp('src/planbygger/sheet.js')).splitSheet, cleanForWalls: (await imp('src/planbygger/clean.js')).cleanForWalls, readFacade: (await imp('src/planbygger/facade.js')).readFacade, findStairs: (await imp('src/planbygger/align.js')).findStairs };
  const empty = await G.generate(one, { exec: async (name, ...args) => (D[name] ? D[name](...args) : null) });
  const eq = empty.questions.find((q) => q.kind === 'walls');
  check('utføreren gir null for detectPlan og autoScale: ingen krasj, etasjen er tom og det sies (spørsmålet «walls» og et notat)', empty.doc.levels.length === 1 && empty.doc.levels[0].walls.length === 0 && !!eq && eq.input === 'none' && /ingen vegger/i.test(eq.text) && empty.report.notes.some((n) => /ingen vegger/.test(n)), eq?.text ?? JSON.stringify(empty.questions.map((q) => q.id)));
  check('svaret på «walls» endrer ingenting', JSON.stringify(Q.applyAnswers(empty.doc, empty.questions, { [eq?.id]: 'ok' }).levels) === JSON.stringify(empty.doc.levels));
  // nothing to build from: said in a note, no empty house in silence (and no validator noise about a missing level)
  const none = await G.generate([], {});
  check('ingen filer: ingen etasjer, og et notat', none.doc.levels.length === 0 && none.report.notes.some((n) => /Ingen tegninger/.test(n)), none.report.notes.join(' | '));
  const facOnly = await G.generate(houseInputs('hus1').filter((i) => i.name === 'fasade1.avif'), {});
  check('bare en fasade: ingen etasjer, et notat om plantegningen som mangler, ingen feil fra kontrollen', facOnly.doc.levels.length === 0 && facOnly.report.notes.some((n) => /ingen plantegning/i.test(n)) && !facOnly.report.notes.some((n) => /Kontrollen fant/.test(n)), facOnly.report.notes.join(' | '));
  // two uploads with one name: each its own name, so no two questions share an id
  const dupNames = await G.generate([{ name: 'plan.png', img }, { name: 'plan.png', img: renderPlan(samplePlans().lhus, { pxPerM: 50 }).img }], {});
  const ids = dupNames.questions.map((q) => q.id);
  check('to filer med samme navn: hver sitt navn («plan (2).png»), ingen spørsmål med samme id', ids.length === new Set(ids).size && dupNames.report.steps.some((s) => s.file === 'plan (2).png'), ids.join(', '));
  // one drawing in two files: the same floor once, unless the names say two floors (drawn alike)
  const twice = await G.generate([{ name: 'plan.png', img }, { name: 'plan-kopi.png', img }], {});
  check('samme tegning i «plan.png» og «plan-kopi.png»: én etasje, og et notat om det', twice.doc.levels.length === 1 && twice.report.notes.some((n) => /samme tegning/.test(n) && /én gang/.test(n)), twice.report.notes.join(' | '));
  const floors = await G.generate([{ name: '2etg.png', img }, { name: '3etg.png', img }], {});
  check('samme tegning i «2etg.png» og «3etg.png»: to etasjer (like etasjer), og et notat', floors.doc.levels.length === 2 && floors.report.notes.some((n) => /forskjellige etasjer/.test(n)), floors.doc.levels.map((l) => `${l.id} ${l.image.name}`).join(', '));
  // a scale inherited from another floor of the «same set» that leaves the floor without rooms: measured again alone.
  // hus9's upper floor on a sheet of the basement's size (so similarSource takes them for one set) at 45 px/m, the
  // basement at 54: the inherited 54 px/m leaves 5 walls and no room
  const h9 = houseInputs('hus9');
  const up = h9.find((i) => i.name === 'ovre-etasje.jpg');
  const base = h9.find((i) => i.name === 'underetasje.jpg');
  const W = base.img.width;
  const big = { width: W, height: base.img.height, data: new Uint8ClampedArray(W * base.img.height * 4).fill(255) };
  for (let y = 0; y < up.img.height; y++) big.data.set(up.img.data.subarray(y * up.img.width * 4, (y + 1) * up.img.width * 4), y * W * 4);
  const re = await G.generate([base, { name: '2etg.jpg', img: big }], { ai: fixtureAi({ house: 'hus9' }) });
  const again = re.report.steps.find((s) => s.step === 'scale' && s.file === '2etg.jpg' && s.method === 'own');
  const L2 = re.doc.levels.find((l) => l.image.name === '2etg.jpg');
  check('arvet skala som gir en tom etasje (hus9 øvre på et ark som kjellerens): målt på nytt alene, med vegger og rom', !!again && L2.walls.length >= 10 && re.questions.some((q) => q.id === 'scale:2etg.jpg') && re.report.notes.some((n) => /passet ikke/.test(n)), again?.detail ?? re.report.steps.filter((s) => s.file === '2etg.jpg').map((s) => `${s.step} ${s.method} ${s.detail}`).join(' | '));
  check('… og skalaen er etasjens egen (innen 15 % av fasitens 45,4 px/m uten KI), ikke kjellerens 54', Math.abs(L2.image.pxPerM / 45.4 - 1) <= 0.15 && Math.abs(L2.image.pxPerM / 54.1 - 1) > 0.05, `${L2.image.pxPerM} px/m`);
}

/**
 * Round 1's measured results with the recorded answers (notes/planbygger.md, «Runde 1: målinger per hus»), as the
 * limits a change must not fall below – what is achieved, not what is wanted (the goals are in section 7 and the notes).
 * errors: validator errors left – none since phase C (hus1's loft faces and hus2's WC/D + BOD island in the open living
 * room were export / regions defects). named: labels named in a room of their own (not one shared with another label;
 * the open plans of OPEN_PLANS are goals of section 7, not counted here). questions: hus8's sixth is the stair. stair:
 * true – a stair is exported; 'steep' (hus8) – the stair found is too steep for the player and the house format, so it
 * is not built but asked about with «Ingen trapp» as the default and the reason in the text (generate.js placeStair):
 * the fasit has a quarter-turn stair (an L) whose upper flight alone is drawn in the 1. etasje, in a shaft 0,94 × 1,8 m
 * (x 360–392, y 543–604 px) between two bedrooms with the stair door at its south end; the found box is 0,91 × 1,32 m
 * at 31,2 px/m, 64° for 2,7 m. No straight or U stair of the format fits there under 51,7° (a straight one needs
 * 2,1 m of walk line), so the basement is not reached on foot until the engine gets quarter-turn stairs (a request) –
 * tools/test-planbygger-build3d.mjs fails for it. doors / windows: the largest difference from the fasit per variant. estimate: hus8 has no
 * dimensions, areas or scale («ikke målbar»), only the fasit's estimate from standard sizes (34 px/m ± 6 %). outline:
 * hus3-foto's printed outer dimensions against the straightened photo's house.
 */
const D0 = { single: 0, double: 0, sliding: 0 };
const THRESHOLDS = {
  hus1: { errors: 0, sides: { 'fasade1.avif': 'S', 'fasade2.avif': 'E', 'fasade3.avif': 'N', 'fasade4.avif': 'W' }, questions: 2, stair: true, roof: true, levels: { '1etg.png': { scale: 0.005, named: 6, windows: 0, doors: D0 }, '2etg.png': { scale: 0.005, named: 5, windows: 0, doors: D0 } } },
  hus2: { errors: 0, sides: { 'fasader.png#1': 'S', 'fasader.png#2': 'N', 'fasader.png#3': 'W', 'fasader.png#4': 'E' }, questions: 1, roof: true, levels: { '1etg.png': { scale: 0.005, named: 13, windows: 0, doors: D0 } } },
  hus3: { errors: 0, sides: { 'fasader.png#1': 'W', 'fasader.png#2': 'N', 'fasader.png#3': 'E', 'fasader.png#4': 'S' }, questions: 2, stair: true, roof: true, levels: { '1etg.png': { scale: 0.005, named: 2, windows: 1, doors: { single: 1, double: 0, sliding: 0 } }, '2etg.png': { scale: 0.005, named: 6, matched: 8, windows: 0, doors: { single: 2, double: 0, sliding: 0 } } } },
  'hus3-foto': { errors: 0, questions: 2, levels: { '1etg-foto.jpg': { outline: { m: [6.15, 14.95], tol: 0.03 }, named: 1, windows: 3, doors: { single: 2, double: 0, sliding: 1 } } } },
  hus4: { errors: 0, sides: { 'fasade1.avif': 'N', 'fasade2.avif': 'W', 'fasade3.avif': 'S', 'fasade4.avif': 'E' }, questions: 5, stair: true, roof: true, levels: { '1etg.avif': { scale: 0.01, named: 8, windows: 2, doors: { single: 1, double: 0, sliding: 1 } }, '2etg.avif': { scale: 0.01, named: 4, windows: 0, doors: { single: 1, double: 0, sliding: 0 } } } },
  hus5: { errors: 0, sides: { 'fasade1.avif': 'N', 'fasade2.avif': 'S', 'fasade3.avif': 'W', 'fasade4.avif': 'E' }, questions: 1, levels: { '1etg.avif': { scale: 0.005, named: 9, windows: 0, doors: D0 } } },
  // fase D (K12): measured 9 windows for 8 (the entrance's sidelight), doors 2/0/6 exact, 4 rooms named on their own
  hus6: { errors: 0, questions: 2, levels: { 'plan-1etg-tilbygg.pdf': { scale: 0.005, named: 4, windows: 2, doors: { single: 1, double: 0, sliding: 1 } } } },
  hus7: { errors: 0, questions: 2, roof: true, levels: { 'garasje-plan-snitt-fasade.pdf': { scale: 0.005, named: 1, windows: 0, doors: D0 } } },
  hus8: { errors: 0, questions: 6, stair: 'steep', levels: { 'plantegning-2.jpg': { estimate: { ppm: 34, tol: 0.1 }, named: 5, windows: 0, doors: D0 }, 'plantegning-3.jpg': { estimate: { ppm: 34, tol: 0.1 }, named: 7, windows: 0, doors: { single: 1, double: 0, sliding: 2 } } } },
  hus9: { errors: 0, questions: 5, stair: true, levels: { 'ovre-etasje.jpg': { scale: 0.02, named: 3, windows: 1, doors: { single: 1, double: 0, sliding: 0 } }, 'underetasje.jpg': { scale: 0.02, named: 7, windows: 1, doors: { single: 2, double: 0, sliding: 2 } } } },
};

// ---------------------------------------------------------------------------------------------------------------
const houses = quick ? ['hus1', 'hus3', 'hus8'] : HOUSES;
const withAi = [];
section(`5. Husene med de lagrede KI-svarene (${houses.length})`);
for (const h of houses) {
  let r;
  try {
    r = await measureHouse(h, { ai: true });
  } catch (err) {
    check(`${h}: generate krasjer ikke`, false, String(err?.stack ?? err));
    continue;
  }
  withAi.push(r);
  houseChecks(r);
}

const noAi = [];
section(`6. Husene uten KI (${houses.length})`);
for (const h of houses) {
  let r;
  try {
    r = await measureHouse(h, { ai: false });
  } catch (err) {
    check(`${h} uten KI: generate krasjer ikke`, false, String(err?.stack ?? err));
    continue;
  }
  noAi.push(r);
  const a = withAi.find((x) => x.house === h);
  check(`${h} uten KI: alle etasjene bygd (${r.levelsGen})`, r.levelsGen === (a?.levelsGen ?? r.levelsGen) && r.levelsGen >= 1);
  const built = r.levels.filter((l) => l.built);
  check(`${h} uten KI: etasjene i riktig rekkefølge`, built.every((l) => l.orderOk), built.map((l) => `${l.file}: ${l.levelNo} (${l.level})`).join(', '));
  check(`${h} uten KI: minst like mange spørsmål som med KI (${r.questions} mot ${a?.questions ?? '?'})`, !a || r.questions >= a.questions);
  check(`${h} uten KI: huset eksporteres`, !r.exportError, r.exportError ?? '');
  // without the AI the scale may be far off (standard sizes only), but then it is asked; a level without a room says so
  for (const l of built) {
    const err = l.ppmErr ?? l.areaScaleErr;
    check(`${h} uten KI ${l.file}: skalaen innen 15 % (${pct(err)}, ${l.scaleMethod}) eller spurt om`, (err != null && Math.abs(err) <= 0.15) || askedScale(r, l));
    check(`${h} uten KI ${l.file}: rom å gå i (${l.rooms.gen} rom i 3D, ${l.walls} vegger) eller spurt om veggene`, l.rooms.gen >= 1 || r.questionList.some((q) => q.kind === 'walls'));
  }
}

section('7. «Ferdig betyr» (hus1, hus2, hus3 og hus5 med KI) – kan feile, og sier det');
{
  // the round's goals: printed and counted on their own; a goal not reached fails the run only with --strict-goals
  const strict = process.argv.includes('--strict-goals');
  const goals = doneMeans(withAi);
  let reached = 0;
  for (const d of goals) {
    if (strict) check(`MÅL ${d.house} ${d.level}: ${d.what}`, d.ok, d.value);
    else console.log(`  MÅL ${d.ok ? 'nådd      ' : 'IKKE NÅDD '} ${d.house} ${d.level}: ${d.what}  (${d.value})`);
    if (d.ok) reached++;
  }
  console.log(`  → ${reached} av ${goals.length} mål nådd${reached < goals.length ? ' (med --strict-goals teller de som feil)' : ''}`);
}

// --json file: every number, for `node tools/planbygger-measure-all.mjs --from file --write`
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0 && process.argv[jsonAt + 1]) fs.writeFileSync(path.resolve(process.argv[jsonAt + 1]), `${JSON.stringify([...withAi, ...noAi], null, 1)}
`);

done();

/** Whether a level's scale is asked: a scale or BRA question for its file (or a part of it). */
function askedScale(r, l) {
  return r.questionList.some((q) => (q.kind === 'scale' || q.kind === 'bra') && (q.id === `${q.kind}:${l.file}` || q.id.startsWith(`${q.kind}:${l.file}#`)));
}

/**
 * The per-house checks with the recorded answers: thresholds from what round 1 measures (see notes/planbygger.md), as
 * the limits a change must not fall below; besides them, for every built level: walls and a room to walk in, the
 * skylights exact (also where the fasit has none), and a scale more than 3 % off is asked.
 */
function houseChecks(r) {
  const T = THRESHOLDS[r.house] ?? {};
  const built = r.levels.filter((l) => l.built);
  check(`${r.house}: ${r.levelsGen} etasje${r.levelsGen === 1 ? '' : 'r'} bygd (fasit ${r.levelsTruth})`, r.levelsGen === r.levelsTruth);
  check(`${r.house}: etasjene i riktig rekkefølge`, built.every((l) => l.orderOk), built.map((l) => `${l.file}: ${l.levelNo} (${l.level})`).join(', '));
  check(`${r.house}: huset eksporteres`, !r.exportError, r.exportError ?? '');
  if (T.errors != null) check(`${r.house}: høyst ${T.errors} feil i validatoren (${r.errors})`, r.errors <= T.errors, r.errorList.join(' | '));
  if (T.questions != null) check(`${r.house}: høyst ${T.questions} spørsmål (${r.questions})`, r.questions <= T.questions, JSON.stringify(r.qByKind));
  for (const l of built) {
    const t = T.levels?.[l.file] ?? {};
    const err = l.ppmErr ?? l.areaScaleErr;
    check(`${r.house} ${l.file}: minst ${t.walls ?? 4} vegger (${l.walls}) og ${t.rooms3d ?? 1} rom å gå i (${l.rooms.gen})`, l.walls >= (t.walls ?? 4) && l.rooms.gen >= (t.rooms3d ?? 1));
    if (t.scale != null) check(`${r.house} ${l.file}: skalaen innen ${t.scale * 100} % (${pct(err)}, ${l.scaleMethod})`, err != null && Math.abs(err) <= t.scale);
    if (t.estimate) check(`${r.house} ${l.file}: skalaen innen ${t.estimate.tol * 100} % av fasitens anslag ${t.estimate.ppm} px/m (${l.ppm})`, Math.abs(l.ppm / t.estimate.ppm - 1) <= t.estimate.tol);
    if (t.outline) {
      const got = [l.outline?.w, l.outline?.h].sort((a, b) => a - b);
      const want = [...t.outline.m].sort((a, b) => a - b);
      check(`${r.house} ${l.file}: husets ytre mål ${got.join(' × ')} m mot tegningens ${want.join(' × ')} m (innen ${t.outline.tol * 100} %)`, got.every((v, i) => v > 0 && Math.abs(v / want[i] - 1) <= t.outline.tol));
    }
    // no exceptions: a scale more than 3 % off that is not asked is a defect (hus4's ground floor was +3.7 % at 'high'
    // until the separators reached the scale step and the grey walls' faces were found)
    const off = err != null && Math.abs(err) > 0.03;
    check(`${r.house} ${l.file}: en skala mer enn 3 % feil blir spurt om (${pct(err)}, ${l.scaleMethod}/${l.scaleConf})`, !off || askedScale(r, l));
    if (t.named != null) check(`${r.house} ${l.file}: minst ${t.named} rom med navnet fra tegningen i et eget rom (${l.rooms.named} av ${l.rooms.fasit}, ${l.rooms.shared ?? 0} delt)`, l.rooms.named >= t.named);
    if (t.matched != null) check(`${r.house} ${l.file}: minst ${t.matched} rom funnet (${l.rooms.matched} av ${l.rooms.fasit})`, l.rooms.matched >= t.matched);
    if (t.doors) check(`${r.house} ${l.file}: dørene ${l.doors.single}/${l.doors.double}/${l.doors.sliding} (fasit ${l.doorsTruth.single}/${l.doorsTruth.double}/${l.doorsTruth.sliding}, avvik høyst ${t.doors.single}/${t.doors.double}/${t.doors.sliding})`, ['single', 'double', 'sliding'].every((k) => Math.abs(l.doors[k] - l.doorsTruth[k]) <= t.doors[k]));
    if (t.windows != null && l.windowsTruth != null) check(`${r.house} ${l.file}: ${l.windows} vinduer (fasit ${l.windowsTruth}, avvik høyst ${t.windows})`, Math.abs(l.windows - l.windowsTruth) <= t.windows);
    if (l.skylightsTruth != null) check(`${r.house} ${l.file}: ${l.skylights} takvinduer (fasit ${l.skylightsTruth})`, Math.abs(l.skylights - l.skylightsTruth) <= (t.skylights ?? 0));
  }
  if (T.stair === true) check(`${r.house}: trapp bygd (${r.stairs.map((s) => s.kind).join(', ') || 'ingen'}; eksportert ${r.exportedStairs})`, r.exportedStairs >= 1);
  if (T.stair === 'steep') {
    const q = r.questionList.find((x) => x.kind === 'stair');
    check(`${r.house}: trappa som ble funnet, er for bratt å gå i – ikke bygd, men spurt om med «ingen trapp» som standard og grunnen i teksten (eksportert ${r.exportedStairs})`, r.exportedStairs === 0 && q?.default === 'none' && /for bratt/.test(q?.help ?? ''), q?.help ?? 'ingen trappespørsmål');
  }
  if (T.roof) check(`${r.house}: taket ${r.roof} (fasit ${r.roofTruth})`, r.roof === r.roofTruth);
  // each facade drawing on the side the fasit's notes give it (facadematch.js, from the positions of its openings)
  if (T.sides) for (const [file, side] of Object.entries(T.sides)) check(`${r.house}: ${file} er fasaden mot ${side} (${r.facadeSides?.[file] ?? 'ingen side'})`, r.facadeSides?.[file] === side, JSON.stringify(r.facadeSides));
}

