#!/usr/bin/env node
/**
 * Tests for the planbygger AI layer – no key, no network:
 *   1. marks.js: ids, placement (inside the room, off the label, beside the wall, no overlaps, leaders around discs,
 *      tiny rooms left unmarked), targetsFromLevel, and the real plans whose targets the record script froze
 *      (tools/fixtures/planbygger-ai/<hus>/<fil>.targets.json: hus1, hus2, hus3, hus5, hus8)
 *   2. ai.js: downscaleImage, roomKindOf, tidyResponse (mark linking, the label of an unnamed or unmarked room),
 *      aiRead / aiStatus never throw (no server, a throwing transport, a refused task)
 *   3. the recorded answers (tools/fixtures/planbygger-ai/<hus>/<fil>.<oppgave>.<modell>.json) replayed through
 *      setAiTransport and compared item by item with plantegninger/<hus>/fasit.json (rooms, labels, door variants,
 *      windows, skylights, stair type, title, scale text, dimensions, ceiling texts, roof, drawings on a sheet) and
 *      with what was checked by eye on the marked images (which mark is which room, the kind per opening letter).
 *      A deviation fails unless it is listed in KNOWN (the measured model errors); a known error that is now right
 *      fails too, so the list stays true. Plus a Haiku / Sonnet table with tokens, cost and time.
 *   4. the server (server/planbygger-ai/index.mjs) with a stubbed SDK client: the request shape, the cache, the quota
 *      per session, per IP and for the server (calls and USD), the last X-Forwarded-For entry, the model the client
 *      may not pick, the size limit, bad input, no key / no SDK → available: false, stop reasons, the SDK's typed
 *      errors, the deadline, the queue (at most 3 at a time), the Sonnet refusal fallback
 *   5. the Vite plugin: the middleware without a key, and a real Vite dev server on port 5276 (--no-vite skips it)
 *
 *   node tools/test-planbygger-ai.mjs [--no-vite]
 */
import { ROOT, imp, check, section, done } from './planbygger-lib.mjs';
import { readPng, encodePng } from './planbygger-png.mjs';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
// the tests must never reach the API, also when the owner's shell has the key
delete process.env.ANTHROPIC_API_KEY;

const { drawMarks, targetsFromLevel, markId } = await imp('src/planbygger/marks.js');
const AI = await imp('src/planbygger/ai.js');
const { pointInPolygon } = await imp('src/planbygger/geom.js');
const SERVER = await import(pathToFileURL(path.join(ROOT, 'server/planbygger-ai/index.mjs')).href);
const PROMPTS = await import(pathToFileURL(path.join(ROOT, 'server/planbygger-ai/prompts.mjs')).href);
const SDK = await import(pathToFileURL(path.join(ROOT, 'server/planbygger-ai/node_modules/@anthropic-ai/sdk/index.mjs')).href).catch(() => null);
const FIX = path.join(ROOT, 'tools/fixtures/planbygger-ai');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-ai-test-'));
const DEFAULT_MODEL = SERVER.DEFAULT_MODELS.readPlan;

const blank = (w, h, v = 255) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
function fillRect(img, x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4);
}
const px = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const luma = (img, x, y) => {
  const [r, g, b] = px(img, x, y);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
/** Darkest pixel of the original image under a disc. */
function darkestUnder(img, cx, cy, r) {
  let m = 255;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (x >= 0 && y >= 0 && x < img.width && y < img.height && Math.hypot(x - cx, y - cy) <= r) m = Math.min(m, luma(img, x, y));
  return m;
}

// geometry of a drawn mark, measured independently of marks.js' internals; DARK: the grey marks.js promises not to
// cover (grey room labels are 110–170, so 110 would miss most of hus3's text)
const DARK = 140;
const rimOf = (r) => r + Math.max(2, r * 0.18);
/** Half-length of the straight part of a mark's pill (0 for one character), as marks.js draws it. */
const pillHw = (label, r) => {
  const s = Math.max(2, Math.floor((r * 1.1) / 7));
  return Math.max(0, (label.length * 5 * s + (label.length - 1) * s) / 2 + s * 1.5 - r);
};
/** Dark pixels (grey < DARK) of the original under the pill of radius R; skip(x, y) leaves a pixel out. */
function darkUnderPill(img, cx, cy, hw, R, skip = null) {
  let n = 0;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(img.height - 1, cy + R); y++) {
    for (let x = Math.max(0, Math.floor(cx - hw - R)); x <= Math.min(img.width - 1, cx + hw + R); x++) {
      const dx = Math.max(0, Math.abs(x + 0.5 - cx) - hw);
      if (Math.hypot(dx, y + 0.5 - cy) > R || luma(img, x, y) >= DARK || skip?.(x + 0.5, y + 0.5)) continue;
      n++;
    }
  }
  return n;
}
const segPoint = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
/** Distance between two segments (0 when they cross). */
function segSeg(a, b, c, d) {
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cr(a, b, c);
  const d2 = cr(a, b, d);
  const d3 = cr(c, d, a);
  const d4 = cr(c, d, b);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(segPoint(a, c, d), segPoint(b, c, d), segPoint(c, a, b), segPoint(d, a, b));
}

// ---------------------------------------------------------------------------------------------------------------
section('marks.js – ids and drawing');
{
  check('rom får tall, åpninger bokstaver uten I og O, symboler s1', markId('room', 0) === '1' && markId('room', 11) === '12' && markId('opening', 0) === 'A' && markId('opening', 7) === 'H' && markId('opening', 8) === 'J' && markId('opening', 23) === 'Z' && markId('opening', 24) === 'AA' && markId('opening', 25) === 'AB' && markId('symbol', 2) === 's3');

  // a 400 × 300 «plan»: a room with walls, a black label in its middle, a window gap in the top wall
  const img = blank(400, 300);
  fillRect(img, 50, 50, 350, 60, [0, 0, 0]); // top wall, gap 180–220
  fillRect(img, 180, 50, 220, 60, [255, 255, 255]);
  fillRect(img, 50, 240, 350, 250, [0, 0, 0]);
  fillRect(img, 50, 50, 60, 250, [0, 0, 0]);
  fillRect(img, 340, 50, 350, 250, [0, 0, 0]);
  fillRect(img, 170, 140, 230, 160, [20, 20, 20]); // the «label» right where the interior point is
  const before = new Uint8ClampedArray(img.data);
  const room = { at: [200, 150], polygon: [[60, 60], [340, 60], [340, 240], [60, 240]], ref: 'r1' };
  const opening = { at: [200, 55], normal: [0, 1], t: 10, ref: 'o1' };
  const res = drawMarks(img, { rooms: [room], openings: [opening], symbols: [[300, 280]] });
  const [mr, mo, ms] = res.marks;
  check('drawMarks lager en kopi (originalen er urørt)', Buffer.compare(Buffer.from(before), Buffer.from(img.data)) === 0 && res.img !== img);
  check('tre merker: 1 (rom), A (åpning), s1 (symbol), ingen umerket', res.marks.length === 3 && mr.id === '1' && mr.kind === 'room' && mo.id === 'A' && mo.kind === 'opening' && ms.id === 's1' && res.unmarked.length === 0);
  const c = [mr.drawnAt[0] * 400, mr.drawnAt[1] * 300];
  check('rommerket ligger inne i rommet', pointInPolygon(c, room.polygon), `(${c.map(Math.round).join(', ')})`);
  check('rommerket dekker ikke etiketten', darkestUnder(img, c[0], c[1], rimOf(res.radius) + 1) > 200, `mørkeste piksel under skiva med kant ${Math.round(darkestUnder(img, c[0], c[1], rimOf(res.radius) + 1))}`);
  const red = px(res.img, Math.round(c[0] + res.radius * 0.7), Math.round(c[1]));
  check('rommerket er en rød skive', red[0] > 180 && red[1] < 60 && red[2] < 80, `piksel ${red.slice(0, 3)}`);
  check('rommerket har polygonet normalisert (for etiketter i ai.js)', Array.isArray(mr.polygon) && mr.polygon.length === 4 && Math.abs(mr.polygon[1][0] - 0.85) < 1e-6 && mr.ref === 'r1');
  const oc = [mo.drawnAt[0] * 400, mo.drawnAt[1] * 300];
  check('åpningsmerket står ved siden av veggen, ikke i hullet', Math.abs(oc[1] - 55) > res.radius + 5 && Math.abs(oc[0] - 200) < res.radius * 2, `(${oc.map(Math.round).join(', ')})`);
  check('åpningsmerkets at er hullets senter', Math.abs(mo.at[0] - 0.5) < 1e-3 && Math.abs(mo.at[1] - 55 / 300) < 1e-3);
  // the leader line: blue pixels between the gap and the disc
  const mid = [Math.round((oc[0] + 200) / 2), Math.round((oc[1] + 55) / 2)];
  const blue = px(res.img, mid[0], mid[1]);
  check('en blå linje går fra merket til åpningen', blue[2] > 150 && blue[0] < 120, `piksel ${blue.slice(0, 3)} ved (${mid})`);
  check('skiva er minst 13 px i radius og vokser med bildet', res.radius === 13 && drawMarks(blank(3200, 2000), { rooms: [[100, 100]] }).radius === 26);

  // a 1.3 m² cupboard filled by its label: no spot for a disc → unmarked, and the next room still gets number 1
  const tiny = blank(400, 300);
  fillRect(tiny, 40, 40, 44, 104, [0, 0, 0]);
  fillRect(tiny, 40, 40, 104, 44, [0, 0, 0]);
  fillRect(tiny, 100, 40, 104, 104, [0, 0, 0]);
  fillRect(tiny, 40, 100, 104, 104, [0, 0, 0]);
  for (let x = 50; x < 95; x += 6) fillRect(tiny, x, 55, x + 3, 90, [30, 30, 30]); // «WIC 1.3 m²»
  const big = { at: [250, 150], polygon: [[150, 60], [380, 60], [380, 280], [150, 280]], ref: 'stue' };
  const t1 = drawMarks(tiny, { rooms: [{ at: [72, 72], polygon: [[44, 44], [100, 44], [100, 100], [44, 100]], ref: 'wic' }, big] });
  check('et lite rom fylt av etiketten får ikke merke (unmarked), og numrene hopper ikke over', t1.marks.length === 1 && t1.marks[0].id === '1' && t1.marks[0].ref === 'stue' && t1.unmarked.length === 1 && t1.unmarked[0].ref === 'wic' && t1.unmarked[0].kind === 'room' && t1.unmarked[0].polygon?.length === 4, JSON.stringify(t1.unmarked));

  // a room whose blank spot is right in front of a window: the room mark leaves the spot to the opening mark, and the
  // opening's leader runs through no disc
  const win = blank(400, 300);
  fillRect(win, 50, 50, 350, 60, [0, 0, 0]);
  fillRect(win, 180, 50, 220, 60, [255, 255, 255]);
  fillRect(win, 60, 120, 340, 240, [0, 0, 0]); // only a strip under the top wall is blank
  const t2 = drawMarks(win, { rooms: [{ at: [200, 80], polygon: [[60, 60], [340, 60], [340, 240], [60, 240]], ref: 'r' }], openings: [{ at: [200, 55], normal: [0, 1], t: 10, ref: 'w' }] });
  const [r2, o2] = t2.marks;
  const R2 = [r2.drawnAt[0] * 400, r2.drawnAt[1] * 300];
  const O2 = [o2.drawnAt[0] * 400, o2.drawnAt[1] * 300];
  check('rommerket står ikke rett foran vinduet, og streken fra åpningsmerket går ikke gjennom rommerket', Math.abs(R2[0] - 200) > 2 * rimOf(t2.radius) && segPoint(R2, [200, 55], O2) > rimOf(t2.radius), `rom (${R2.map(Math.round)}), åpning (${O2.map(Math.round)})`);

  // three windows close together in a wall with ink on both sides: no disc on another disc, a leader or a gap
  const crowd = blank(300, 200);
  fillRect(crowd, 20, 95, 280, 105, [0, 0, 0]);
  const ops = [130, 150, 170].map((x, i) => ({ at: [x, 100], normal: [0, 1], t: 10, ref: `w${i}` }));
  for (const o of ops) fillRect(crowd, o.at[0] - 6, 95, o.at[0] + 6, 105, [255, 255, 255]);
  const t3 = drawMarks(crowd, { openings: ops });
  const C3 = t3.marks.map((m) => ({ c: [m.drawnAt[0] * 300, m.drawnAt[1] * 200], a: [m.at[0] * 300, m.at[1] * 200], hw: pillHw(m.id, t3.radius) }));
  let bad = 0;
  for (const p of C3) {
    for (const q of C3) {
      if (p === q) continue;
      if (Math.hypot(Math.max(0, Math.abs(p.c[0] - q.c[0]) - p.hw - q.hw), p.c[1] - q.c[1]) < 2 * rimOf(t3.radius)) bad++;
      if (segPoint(q.c, p.a, p.c) < rimOf(t3.radius)) bad++;
    }
  }
  check('tre vinduer tett i tett: alle får merke, ingen skiver oppå hverandre eller på en strek', t3.marks.length + t3.unmarked.length === 3 && bad === 0, `${t3.marks.length} merker, ${t3.unmarked.length} umerket, ${bad} kollisjoner`);
}

section('marks.js – targetsFromLevel');
{
  const level = {
    walls: [{ id: 'w1', a: [0, 0], b: [4, 0], t: 0.2 }],
    openings: [{ id: 'o1', wall: 'w1', type: 'window', at: 1.5, width: 1 }, { id: 'o2', wall: 'mangler', type: 'door', at: 1, width: 0.9 }],
  };
  const rooms = [
    { index: 0, area: 12, inside: [2, 2], polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
    { index: 1, area: 0.4, inside: [5, 5], polygon: [[5, 5], [5.5, 5], [5.5, 5.8]] },
  ];
  const t = targetsFromLevel(level, rooms, 100);
  check('rom i piksler, glipper under 1 m² uten merke', t.rooms.length === 1 && t.rooms[0].at[0] === 200 && t.rooms[0].polygon[2][1] === 300 && t.rooms[0].ref === 0);
  check('åpning: senter, normal, tykkelse og bredde i piksler; åpninger uten vegg droppes', t.openings.length === 1 && t.openings[0].at[0] === 150 && t.openings[0].at[1] === 0 && Math.abs(Math.abs(t.openings[0].normal[1]) - 1) < 1e-9 && t.openings[0].t === 20 && t.openings[0].width === 100 && t.openings[0].ref === 'o1');
}

section('marks.js – de ekte planene (målene frosset av opptaksskriptet)');
{
  const frozenFiles = [];
  for (const house of fs.readdirSync(FIX)) {
    const dir = path.join(FIX, house);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.targets.json')) frozenFiles.push(path.join(dir, f));
  }
  check(`frosne mål for minst sju planer (${frozenFiles.length})`, frozenFiles.length >= 7);
  for (const tp of frozenFiles.sort()) {
    const frozen = JSON.parse(fs.readFileSync(tp, 'utf8'));
    const name = `${path.basename(path.dirname(tp))}/${path.basename(tp, '.targets.json')}`;
    const img = readPng(path.join(ROOT, frozen.file));
    const t0 = Date.now();
    const res = drawMarks(img, frozen.targets);
    const ms = Date.now() - t0;
    const r = res.radius;
    const rim = rimOf(r);
    const rooms = res.marks.filter((m) => m.kind === 'room');
    const opens = res.marks.filter((m) => m.kind === 'opening');
    const unRooms = res.unmarked.filter((u) => u.kind === 'room');
    const unOpens = res.unmarked.filter((u) => u.kind === 'opening');
    check(`${name}: hvert rom og hver åpning har et merke eller står i unmarked (${rooms.length} + ${unRooms.length} rom, ${opens.length} + ${unOpens.length} åpninger), ${ms} ms`, rooms.length + unRooms.length === frozen.targets.rooms.length && opens.length + unOpens.length === frozen.targets.openings.length && ms < 3000);
    const roomByRef = new Map(frozen.targets.rooms.map((t) => [t.ref, t]));
    const openByRef = new Map(frozen.targets.openings.map((t) => [t.ref, t]));
    const inside = rooms.filter((m) => pointInPolygon([m.drawnAt[0] * img.width, m.drawnAt[1] * img.height], roomByRef.get(m.ref).polygon)).length;
    check(`${name}: alle rommerkene ligger i sitt rom`, inside === rooms.length, `${inside}/${rooms.length}`);
    const P = res.marks.map((m) => ({ m, c: [m.drawnAt[0] * img.width, m.drawnAt[1] * img.height], a: [m.at[0] * img.width, m.at[1] * img.height], hw: pillHw(m.id, r) }));
    const pairs = [];
    let minClear = Infinity;
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const d = Math.hypot(Math.max(0, Math.abs(P[i].c[0] - P[j].c[0]) - P[i].hw - P[j].hw), P[i].c[1] - P[j].c[1]);
        minClear = Math.min(minClear, d - 2 * rim);
        if (d < 2 * rim) pairs.push(`${P[i].m.id}/${P[j].m.id}`);
      }
    }
    check(`${name}: ingen merker oppå hverandre, med den hvite kanten`, pairs.length === 0, pairs.length ? pairs.join(' ') : `minste klaring ${minClear.toFixed(1)} px`);
    const through = [];
    for (const p of P.filter((x) => x.m.kind === 'opening')) {
      for (const q of P) if (q !== p && segSeg(p.a, p.c, [q.c[0] - q.hw, q.c[1]], [q.c[0] + q.hw, q.c[1]]) < rim) through.push(`${p.m.id}→${q.m.id}`);
    }
    check(`${name}: ingen strek går gjennom et annet merke`, through.length === 0, through.join(' '));
    const roomOverText = P.filter((p) => p.m.kind === 'room' && darkUnderPill(img, p.c[0], p.c[1], p.hw, rim) > 0).map((p) => p.m.id);
    check(`${name}: ingen rommerker (med kant) over mørk tekst eller strek`, roomOverText.length === 0, roomOverText.join(' '));
    // an opening disc may touch its own wall (the detected thickness can be a little thin), and with the edge of its
    // rim a line where nothing is free (a door arc in a narrow corridor) – never text or a line under the disc itself
    const touch = [];
    const openOverText = P.filter((p) => {
      if (p.m.kind !== 'opening') return false;
      const o = openByRef.get(p.m.ref);
      const band = o.t / 2 + Math.max(3, r * 0.3);
      const skip = (x, y) => Math.abs((x - o.at[0]) * o.normal[0] + (y - o.at[1]) * o.normal[1]) < band;
      const edge = darkUnderPill(img, p.c[0], p.c[1], p.hw, rim, skip);
      const core = darkUnderPill(img, p.c[0], p.c[1], p.hw, r - 2, skip);
      if (edge && !core) touch.push(`${p.m.id} ${edge} px`);
      return core > 0;
    }).map((p) => p.m.id);
    check(`${name}: ingen åpningsmerker over mørk tekst eller strek utenfor sin egen vegg${touch.length ? ` (kanten berører en strek: ${touch.join(', ')})` : ''}`, openOverText.length === 0, openOverText.join(' '));
    // the recorded answers are about these marks: every mark drawn now has the recording's id on the same room or
    // opening (a disc may have moved inside its room, or along its wall, since the recording – the answer is about the
    // room or the opening); a recorded mark that is not drawn any more must be one marks.js now leaves unmarked
    for (const f of fs.readdirSync(path.dirname(tp)).filter((x) => x.startsWith(`${path.basename(tp, '.targets.json')}.readPlan.`))) {
      const fx = JSON.parse(fs.readFileSync(path.join(path.dirname(tp), f), 'utf8'));
      const short = fx.model.replace('claude-', '').replace(/-5-5$/, '');
      const rec = new Map(fx.marks.map((m) => [m.id, m]));
      const now = new Map(res.marks.map((m) => [m.id, m]));
      const wrong = res.marks.filter((m) => {
        const o = rec.get(m.id);
        if (!o || o.kind !== m.kind || o.ref !== m.ref) return true;
        if (m.kind === 'opening') return o.at.join() !== m.at.join();
        return m.kind === 'room' && !pointInPolygon([o.drawnAt[0] * img.width, o.drawnAt[1] * img.height], roomByRef.get(m.ref).polygon);
      }).map((m) => m.id);
      const gone = fx.marks.filter((o) => !now.has(o.id));
      const goneOk = gone.every((o) => res.unmarked.some((u) => u.kind === o.kind && u.ref === o.ref));
      const moved = res.marks.filter((m) => rec.get(m.id) && JSON.stringify(m.drawnAt) !== JSON.stringify(rec.get(m.id).drawnAt)).map((m) => m.id);
      const note = [moved.length ? `skiver flyttet siden opptaket: ${moved.join(' ')}` : 'samme plassering', gone.length ? `umerket nå: ${gone.map((o) => o.id).join(' ')}` : ''].filter(Boolean).join('; ');
      check(`${name}: opptaket (${short}) gjelder de samme merkene – id, rom og åpning (${note})`, !wrong.length && goneOk, wrong.join(' '));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('ai.js – nedskalering og romtyper');
{
  const big = blank(3200, 1000);
  for (let y = 0; y < 1000; y++) for (let x = 0; x < 3200; x++) if ((x + y) % 2) big.data.set([0, 0, 0, 255], (y * 3200 + x) * 4);
  const small = AI.downscaleImage(big);
  const c = px(small, 800, 250);
  check('3200 × 1000 → 1600 × 500, arealmiddel (sjakkbrett → grått)', small.width === 1600 && small.height === 500 && Math.abs(c[0] - 127.5) < 2, `piksel ${c}`);
  const tr = blank(10, 10, 0); // fully transparent black
  check('alfa flates ut på hvitt, små bilder beholder størrelsen', AI.downscaleImage(tr).width === 10 && px(AI.downscaleImage(tr), 5, 5).join() === '255,255,255,255');
  check('roomKindOf: kjøkken → stue, wc → bad, garderobe → bod, terrasse → null', AI.roomKindOf('kitchen') === 'living' && AI.roomKindOf('wc') === 'bathroom' && AI.roomKindOf('wardrobe') === 'storage' && AI.roomKindOf('terrace') === null && AI.roomKindOf('bedroom') === 'bedroom' && AI.roomKindOf('tull') === null);
}

section('ai.js – tidyResponse');
{
  const marks = [
    { id: '1', kind: 'room', at: [0.25, 0.5], drawnAt: [0.25, 0.5], ref: 4, polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] },
    { id: '2', kind: 'room', at: [0.75, 0.5], drawnAt: [0.75, 0.5], ref: 7, polygon: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] },
    { id: 'A', kind: 'opening', at: [0.5, 0.2], drawnAt: [0.55, 0.2], ref: 'o3' },
  ];
  const r = AI.tidyResponse('readPlan', {
    levelTitle: '  ', scaleText: '1:100',
    rooms: [{ mark: '1', at: [0.3, 0.45], name: 'SOV', area: 12.1, kind: 'bedroom' }, { mark: '2', at: [0.7, 0.5], name: '', area: null, kind: 'other' }],
    labels: [{ text: 'BOD', area: 4.4, kind: 'storage', at: [0.9, 0.4] }, { text: 'TERRASSE', area: null, kind: 'terrace', at: [1.4, -0.2] }],
    dimensions: [{ text: '12,21', value: 12.21, at: [0.5, 0.98], along: 'h', what: 'outer' }],
    openings: [{ mark: 'A', at: [0.51, 0.21], kind: 'window' }, { mark: null, at: [0.1, 0.9], kind: 'door' }],
    skylights: [], stair: { present: false, at: null, type: 'none', up: 'unknown' }, ceiling: ['SKRÅ HIMLING 24°', ''], furniture: [{ kind: 'bed', at: [0.2, 0.3] }], notes: '',
  }, marks);
  check('rom med merke: at = merkets egen posisjon, aiAt = modellens, ref = merkets', r.rooms[0].at.join() === '0.25,0.5' && r.rooms[0].aiAt.join() === '0.3,0.45' && r.rooms[0].roomKind === 'bedroom' && r.rooms[0].ref === 4);
  check('et rom uten navn får etiketten som ligger i polygonet', r.rooms[1].name === 'BOD' && r.rooms[1].area === 4.4 && r.rooms[1].roomKind === 'storage' && r.rooms[1].fromLabel === true && r.labels.length === 1);
  check('punkter klemmes til 0–1, tomme titler blir null, tomme himlingstekster ut', r.labels[0].at.join() === '1,0' && r.levelTitle === null && r.ceiling.length === 1);
  check('åpning med merke kobles (med ref), åpning uten merke beholder modellens punkt', r.openings[0].at.join() === '0.5,0.2' && r.openings[0].ref === 'o3' && r.openings[1].mark === null && r.openings[1].ref === null && r.openings[1].at.join() === '0.1,0.9');
  const f = AI.tidyResponse('readFacade', { title: null, roof: 'gable', storeys: 2, windows: [{ bbox: [0.6, 0.5, 0.4, 0.3], kind: 'window' }, { bbox: [0.1], kind: 'door' }], notes: '' });
  check('fasade: bokser ordnes, ugyldige ut', f.windows.length === 1 && f.windows[0].bbox.join() === '0.4,0.3,0.6,0.5');
  const cl = AI.tidyResponse('classify', { drawings: [{ kind: 'plan', bbox: [0, 0, 1, 1], title: null, levelName: '1. etasje', level: 0, detached: false }], scaleText: null, notes: 'x' });
  check('classify: formen beholdes', cl.drawings[0].level === 0 && cl.drawings[0].levelName === '1. etasje' && cl.notes === 'x');

  // rooms and openings marks.js left unmarked
  const unmarked = [
    { kind: 'room', ref: 9, at: [0.1, 0.1], polygon: [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]], reason: 'covered' },
    { kind: 'opening', ref: 'o8', at: [0.6, 0.9], reason: 'crowded' },
  ];
  const u = AI.tidyResponse('readPlan', {
    levelTitle: null, scaleText: null,
    rooms: [{ mark: '1', at: [0.3, 0.45], name: 'SOV', area: 12.1, kind: 'bedroom' }],
    labels: [{ text: 'WIC', area: 1.3, kind: 'wardrobe', at: [0.12, 0.08] }, { text: 'TERRASSE', area: null, kind: 'terrace', at: [0.9, 0.9] }],
    dimensions: [], skylights: [], stair: { present: false, at: null, type: 'none', up: 'unknown' }, ceiling: [], furniture: [], notes: '',
    openings: [{ mark: null, at: [0.61, 0.89], kind: 'window' }, { mark: null, at: [0.2, 0.9], kind: 'door' }],
  }, marks, unmarked);
  const wic = u.rooms.find((x) => x.ref === 9);
  check('et umerket rom får etiketten i polygonet sitt: et rom med mark null, ref og rommets eget punkt', wic && wic.mark === null && wic.unmarked === true && wic.name === 'WIC' && wic.area === 1.3 && wic.roomKind === 'storage' && wic.at.join() === '0.1,0.1' && wic.aiAt.join() === '0.12,0.08' && u.labels.length === 1 && u.labels[0].text === 'TERRASSE', JSON.stringify(wic));
  check('en umerket åpning kobles til modellens nærmeste åpning uten merke (innen 2,5 %), bare én gang', u.openings[0].ref === 'o8' && u.openings[0].unmarked === true && u.openings[0].at.join() === '0.6,0.9' && u.openings[1].ref === null);

  // a real Haiku answer that left room 2 unnamed (tools/fixtures/planbygger-ai/cases/hus1-bod-unnamed.json)
  const fx = JSON.parse(fs.readFileSync(path.join(FIX, 'cases/hus1-bod-unnamed.json'), 'utf8'));
  const t = AI.tidyResponse('readPlan', fx.response, fx.marks);
  check('ekte Haiku-svar: «BOD 4.4» som egen etikett havner i rom 2', t.rooms[1].name === 'BOD' && t.rooms[1].area === 4.4 && !t.labels.some((l) => l.text === 'BOD'), `${t.rooms[1].name} ${t.rooms[1].area}`);
}

section('ai.js – kaster aldri');
{
  AI.resetAiTransport();
  const s = await AI.aiStatus(); // Node: fetch of a relative URL fails → available false
  check('uten server: aiStatus gir available: false', s.available === false && s.remaining === 0);
  const r0 = await AI.aiRead('readPlan', { image: blank(20, 20) });
  check('uten server: aiRead gir null', r0 === null && AI.aiLastError() !== null);
  AI.setAiTransport(() => {
    throw new Error('boom');
  });
  check('transport som kaster: null', (await AI.aiRead('classify', { image: blank(20, 20) })) === null && (await AI.aiStatus()).available === false);
  AI.setAiTransport(async () => ({ ok: false, error: 'quota', message: 'Du har brukt opp KI-kvoten for i dag.' }));
  const r1 = await AI.aiRead('classify', { image: blank(20, 20) });
  check('serveren sier nei: null, og grunnen på norsk', r1 === null && AI.aiLastError()?.error === 'quota' && /kvoten/.test(AI.aiLastError().message));
  check('ukjent oppgave og manglende bilde: null', (await AI.aiRead('tull', { image: blank(20, 20) })) === null && (await AI.aiRead('classify', {})) === null);
  let seen = null;
  AI.setAiTransport(async (req) => {
    seen = req;
    return req.op === 'status' ? { available: true, model: 'claude-haiku-5-5', remaining: 7 } : { ok: true, response: { roof: 'flat', storeys: 1, windows: [], notes: '', title: null }, model: 'claude-haiku-5-5', promptVersion: 'x', cached: true };
  });
  const st = await AI.aiStatus();
  check('aiStatus med server: { available, model, remaining }', st.available === true && st.model === 'claude-haiku-5-5' && st.remaining === 7);
  const big = await AI.aiRead('readFacade', { image: blank(2400, 1200), marks: [{ id: '1', kind: 'room', at: [0.5, 0.5], polygon: [[0, 0], [1, 0], [1, 1]] }], unmarked: [{ kind: 'room', ref: 2, at: [0.1, 0.1], polygon: [[0, 0], [0.2, 0], [0.2, 0.2]] }] });
  check('aiRead skalerer til 1600 px og sender merkene uten polygon, og ikke de umerkede', seen.image.width === 1600 && seen.image.height === 800 && seen.marks.length === 1 && seen.marks[0].polygon === undefined && seen.marks[0].drawnAt.join() === '0.5,0.5' && !('unmarked' in seen) && !JSON.stringify(seen.marks).includes('ref'));
  check('svaret får meta { model, promptVersion, cached }', big?.roof === 'flat' && big.meta.model === 'claude-haiku-5-5' && big.meta.cached === true);
  AI.resetAiTransport();
}

// ---------------------------------------------------------------------------------------------------------------
section('opptakene spilt av gjennom setAiTransport, mot fasiten');

const fasitCache = {};
const fasit = (house) => (fasitCache[house] ??= JSON.parse(fs.readFileSync(path.join(ROOT, 'plantegninger', house, 'fasit.json'), 'utf8')));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const sameArea = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.051);
const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy;
  return u > 0 ? (ix * iy) / u : 0;
};

/**
 * What the fasit cannot say, checked by eye on the marked images the model saw (.shots/planbygger/ai-record/):
 * which mark is which room (a label, or [label, area] when the label repeats; the area and the kind come from the
 * fasit), the rooms marks.js left unmarked, the labels outside marked rooms, the kind per opening letter, outer
 * dimensions with their direction, and texts the fasit leaves out.
 */
const BY_EYE = {
  'hus1/1etg.readPlan': {
    rooms: { 1: 'SOV', 2: 'BOD', 3: 'HALL/TRAPP', 4: 'VASK', 5: 'KJØKKEN', 6: 'STUE' },
    openings: { A: 'window', B: 'window', C: 'window', D: 'door', E: 'door', F: 'double-door', G: 'double-door', H: 'window', J: 'window', K: 'window', L: 'window', M: 'window', N: 'window', P: 'door', Q: 'sliding-door', R: 'door', S: 'window', T: 'window' },
  },
  'hus1/2etg.readPlan': {
    rooms: { 1: ['SOV', 11.8], 2: 'BAD', 3: 'GANG/TRAPP', 4: 'BOD', 5: ['SOV', 11.9], 6: ['SOV', 10] },
    labels: ['LOFTSTUE'],
    openings: { A: 'door', B: 'window', C: 'door', D: 'window', E: 'window', F: 'window', G: 'door', H: 'door', J: 'door', K: 'door', L: 'window', M: 'window' },
  },
  'hus2/1etg.readPlan': {
    // 6: STUE 32.9 shares its region with GANG, KJØKKEN and ENTRÉ (walls the detection missed); 9: WIC 4.6 with «(G)»
    rooms: { 1: ['SOVEROM', 10], 2: 'KONTOR', 3: ['STUE', 10.7], 4: ['SOVEROM', 9.9], 5: ['SOVEROM', 11.7], 6: ['STUE', 32.9], 7: 'WC/D', 8: 'BAD', 9: ['WIC', 4.6], 10: 'VASK' },
    unmarked: [['HALL', 1.7], ['WIC', 1.3], ['WIC', 1.3]],
    labels: ['GANG', 'KJØKKEN', 'ENTRÉ', 'BOD'],
  },
  'hus3/1etg.readPlan': {
    rooms: { 1: 'KJØKKEN/STUE', 2: 'VASK', 3: 'WC/D' },
    labels: ['ENTRÉ'],
    // F: the detection cut the glass wall so F holds glazing and the lower terrace door – every reading is right
    openings: { A: 'window', B: 'door', C: 'door', D: 'window', E: 'door', G: 'door', H: 'door', J: 'window', K: 'window', L: 'door' },
    outer: [['6.15', 'h'], ['14.95', 'v']],
    ceiling: ['ÅPENT OPP'],
  },
  'hus3-foto/1etg-foto.readPlan': { labels: ['KJØKKEN/STUE', 'VASK', 'ENTRÉ', 'WC/D'], outer: [['6.15', 'h'], ['14.95', 'v']], ceiling: ['ÅPENT OPP'] },
  'hus4/1etg.readPlan': { labels: 'all' },
  'hus5/1etg.readPlan': {
    // 4: STUE/KJØKKEN shares its region with SPISESTUE; 9: SOV 18.5 with GANG 4.8
    rooms: { 1: 'SPORTSBOD', 2: 'VASK/TEK', 3: ['SOV', 14.4], 4: 'STUE/KJØKKEN', 5: 'GARD/BOD', 6: 'VF', 7: ['GANG', 9.7], 8: ['SOV', 11.9], 9: ['SOV', 18.5], 10: ['BAD', 7.7] },
    unmarked: [['BAD', 5]],
    labels: ['SPISESTUE', ['GANG', 4.8]],
  },
  'hus6/plan-1etg-tilbygg.readPlan': { labels: 'all', scaleText: '1:100' },
  // 8: STUE shares its region with SPISESTUE; 7: the detached garage (not in the fasit's rooms)
  'hus8/plantegning-3.readPlan': { rooms: { 1: 'SOVEROM', 2: 'GANG', 3: 'SOVEROM', 4: 'BAD', 5: 'SOVEROM', 6: 'ENTRÉ', 8: 'STUE', 9: 'KJØKKEN' }, labels: ['SPISESTUE', 'TERRASSE'] },
  'hus7/garasje-plan-snitt-fasade.classify': { titles: ['PLAN', 'SNITT', 'VEST', 'SØR', 'ØST', 'NORD'], scaleText: '1:100' },
};

/**
 * The measured model errors: `<house>/<file>.<task> <model>` → the items that differ from the truth. Every one was
 * looked at: these are the model's mistakes, not the truth's (notes/planbygger.md).
 */
const KNOWN = {
  // rom 3: the prompt maps HALL/TRAPP to hall, the fasit says entrance (the front door opens into it): owner decides
  'hus1/1etg.readPlan haiku': ['rom 3', 'trapp'],
  // enkeltdører: Sonnet adds an unmarked door (the cupboard door in the kitchen corner, not a door in the fasit)
  'hus1/1etg.readPlan sonnet': ['rom 3', 'enkeltdører'],
  'hus1/2etg.readPlan haiku': ['trapp'],
  // rom 9: «(G)» instead of «WIC 4.6 m²» in the same region; sliding doors read as doors; PLANTAK (rotated) missed
  'hus2/1etg.readPlan haiku': ['rom 9', 'enkeltdører', 'skyvedører', 'vinduer', 'himling PLANTAK'],
  // the unmarked photo: only 5 of 7 doors and none of the 6 windows listed
  'hus3-foto/1etg-foto.readPlan haiku': ['enkeltdører', 'vinduer'],
  // B a door read as an opening, C (door) and D (window) swapped; F read as a sliding door
  'hus3/1etg.readPlan haiku': ['åpning B', 'åpning C', 'åpning D', 'enkeltdører', 'skyvedører', 'vinduer'],
  'hus3/1etg.readPlan sonnet': ['vinduer', 'takvinduer'],
  // the sliding door, an extra window, and the U stair read as an L
  'hus4/1etg.readPlan haiku': ['skyvedører', 'vinduer', 'trapp'],
  'hus4/1etg.readPlan sonnet': ['skyvedører', 'vinduer', 'trapp'],
  'hus4/fasade1.readFacade sonnet': ['tak'],
  'hus5/1etg.readPlan haiku': ['enkeltdører', 'skyvedører', 'vinduer'],
  // the unmarked scan: no doors or windows listed at all; the module sizes M10 / M8 and one chain dimension missed
  'hus6/plan-1etg-tilbygg.readPlan haiku': ['enkeltdører', 'skyvedører', 'vinduer', 'trapp', 'mål 1170', 'mål M10', 'mål M8'],
  // rough boxes on the 4771 × 3332 scan (IoU 0.66–0.80)
  'hus7/garasje-plan-snitt-fasade.classify haiku': ['plass section SNITT', 'plass facade VEST', 'plass facade SØR'],
  // rom 6: «ENTRE» without the accent; the garage port read as a double door; 1 of 3 sliding doors
  'hus8/plantegning-3.readPlan haiku': ['rom 6', 'dobbeltdører', 'skyvedører'],
};

const fixtures = [];
for (const house of fs.readdirSync(FIX)) {
  const dir = path.join(FIX, house);
  if (!fs.statSync(dir).isDirectory() || house === 'cases') continue;
  for (const f of fs.readdirSync(dir)) if (/\.(classify|readPlan|readFacade)\.[\w.-]+\.json$/.test(f)) fixtures.push(path.join(dir, f));
}
const folders = new Set(fixtures.map((f) => path.basename(path.dirname(f)))).size;
check(`opptak finnes (${fixtures.length}), fra ${folders} av de 10 husmappene`, fixtures.length >= 20 && folders >= 9);

/** The items of one replayed answer: [{ id, ok, detail }]. */
function itemsOf(fx, out, img) {
  const items = [];
  const add = (id, ok, detail = '') => {
    // a repeated item (the same dimension twice) gets a number
    const n = items.filter((i) => i.id === id || i.id.startsWith(`${id} #`)).length;
    items.push({ id: n ? `${id} #${n + 1}` : id, ok: !!ok, detail });
  };
  const base = path.basename(fx.file, '.png');
  const key = `${fx.house}/${base}.${fx.task}`;
  const E = BY_EYE[key] ?? {};
  const F = fasit(fx.house);
  const original = fx.hints?.fileName;
  if (fx.task === 'readPlan') {
    const L = F.levels.find((l) => l.file === original);
    const fasitRoom = (spec) => {
      const [label, area] = Array.isArray(spec) ? spec : [spec, undefined];
      return L.rooms.find((x) => norm(x.label) === norm(label) && (area === undefined || sameArea(x.area, area))) ?? { label, area: area ?? null, kind: null };
    };
    const show = (x) => (x ? `${x.name ?? x.text} ${x.area ?? '–'} ${x.roomKind}` : 'mangler');
    for (const [mark, spec] of Object.entries(E.rooms ?? {})) {
      const t = fasitRoom(spec);
      const got = out.rooms.find((x) => x.mark === mark);
      add(`rom ${mark}`, got && norm(got.name) === norm(t.label) && sameArea(got.area, t.area) && got.roomKind === t.kind, `${show(got)} (fasit ${t.label} ${t.area ?? '–'} ${t.kind})`);
    }
    for (const spec of E.unmarked ?? []) {
      const t = fasitRoom(spec);
      const got = out.rooms.find((x) => x.unmarked && norm(x.name) === norm(t.label) && sameArea(x.area, t.area));
      add(`umerket rom ${t.label} ${t.area}`, got && got.roomKind === t.kind && got.ref != null, `${show(got)} (fasit ${t.kind})`);
    }
    const labels = E.labels === 'all' ? L.rooms.map((x) => [x.label, x.area]) : E.labels ?? [];
    const pool = [...out.labels];
    for (const spec of labels) {
      const t = fasitRoom(spec);
      const k = pool.findIndex((x) => norm(x.text) === norm(t.label) && sameArea(x.area, t.area));
      const got = k >= 0 ? pool.splice(k, 1)[0] : null;
      add(`etikett ${t.label}${t.area != null ? ` ${t.area}` : ''}`, got && got.roomKind === t.kind && !/m²|m2/.test(got.text), `${show(got)} (fasit ${t.kind})`);
    }
    for (const [letter, kind] of Object.entries(E.openings ?? {})) {
      const got = out.openings.find((o) => o.mark === letter)?.kind;
      add(`åpning ${letter}`, got === kind, `${got ?? 'mangler'} (${kind})`);
    }
    const count = (k) => out.openings.filter((o) => o.kind === k).length;
    add('enkeltdører', count('door') === L.doors.single, `${count('door')} (fasit ${L.doors.single})`);
    add('dobbeltdører', count('double-door') === L.doors.double, `${count('double-door')} (fasit ${L.doors.double})`);
    add('skyvedører', count('sliding-door') === L.doors.sliding, `${count('sliding-door')} (fasit ${L.doors.sliding})`);
    add('vinduer', count('window') === L.windows, `${count('window')} (fasit ${L.windows})`);
    add('takvinduer', out.skylights.length === L.skylights, `${out.skylights.length} (fasit ${L.skylights})`);
    const stair = L.stair?.type ?? L.stair ?? 'none';
    add('trapp', stair === 'none' ? !out.stair.present : out.stair.present && out.stair.type === stair, `${out.stair.present ? out.stair.type : 'ingen'} (fasit ${stair})`);
    add('tittel', out.levelTitle === L.title, `${JSON.stringify(out.levelTitle)} (fasit ${JSON.stringify(L.title)})`);
    add('målestokk', out.scaleText === (E.scaleText ?? null), `${JSON.stringify(out.scaleText)} (${JSON.stringify(E.scaleText ?? null)})`);
    const dims = [...out.dimensions];
    for (const d of L.dimensions ?? []) {
      const k = dims.findIndex((x) => x.text === d.text && x.value != null && Math.abs(x.value - d.m) < 0.005);
      const got = k >= 0 ? dims.splice(k, 1)[0] : null;
      add(`mål ${d.text}`, got, got ? `${got.value} ${got.along} ${got.what}` : 'mangler');
    }
    for (const [text, along] of E.outer ?? []) {
      const got = out.dimensions.find((x) => x.text === text);
      add(`ytre mål ${text}`, got && got.along === along && got.what === 'outer', got ? `${got.along} ${got.what}` : 'mangler');
    }
    for (const text of new Set([...(L.ceiling ?? []), ...(E.ceiling ?? [])].map(norm))) add(`himling ${text}`, out.ceiling.some((c) => norm(c) === text), JSON.stringify(out.ceiling));
  } else if (fx.task === 'classify') {
    const file = F.files[original];
    const W = img.width;
    const H = img.height;
    const expected = file.drawings ?? (file.kind === 'facade' ? F.facades.filter((f) => f.file === original).map(() => ({ kind: 'facade' })) : [{ kind: file.kind, level: file.level }]);
    for (const kind of ['plan', 'facade', 'section']) {
      const want = expected.filter((d) => d.kind === kind).length;
      const got = out.drawings.filter((d) => d.kind === kind).length;
      add(`antall ${kind}`, got === want, `${got} (fasit ${want})`);
    }
    expected.forEach((d, i) => {
      if (!['plan', 'facade', 'section'].includes(d.kind)) return;
      const same = out.drawings.filter((x) => x.kind === d.kind);
      const box = d.bbox ? [d.bbox[0] / W, d.bbox[1] / H, d.bbox[2] / W, d.bbox[3] / H] : null;
      // the drawing the model meant: the best overlap, or the same place in reading order
      const k = box ? same.reduce((b, x, j) => (iou(x.bbox, box) > (b < 0 ? -1 : iou(same[b].bbox, box)) ? j : b), -1) : expected.filter((x) => x.kind === d.kind).indexOf(d);
      const got = same[k];
      const name = d.title && d.title.length <= 12 ? d.title : i;
      if (box) add(`plass ${d.kind} ${name}`, got && iou(got.bbox, box) >= 0.8, got ? `IoU ${iou(got.bbox, box).toFixed(2)}` : 'mangler');
      if (d.kind === 'plan') {
        // level null in the fasit: a separate building (the garage) – the model says detached; beside one, the
        // house's floors are not detached
        const mixed = expected.some((x) => x.kind === 'plan' && x.level == null);
        const ok = got && (d.level == null ? got.detached : got.level === d.level && !(mixed && got.detached));
        add(`etasje plan ${name}`, ok, got ? `${got.level}${got.detached ? ' frittstående' : ''} (fasit ${d.level ?? 'frittstående'})` : 'mangler');
      }
    });
    if (expected.some((d) => d.kind === 'text')) add('tekstblokk', out.drawings.some((d) => d.kind === 'text'));
    for (const t of E.titles ?? []) add(`tittel ${t}`, out.drawings.some((d) => d.title === t), out.drawings.map((d) => d.title).join(' '));
    add('målestokk', out.scaleText === (E.scaleText ?? null), `${JSON.stringify(out.scaleText)} (${JSON.stringify(E.scaleText ?? null)})`);
  } else if (fx.task === 'readFacade') {
    const T = F.facades.find((f) => f.file === original);
    const doors = out.windows.filter((w) => w.kind === 'door').length;
    add('tak', out.roof === T.roof, `${out.roof} (fasit ${T.roof})`);
    add('etasjer', out.storeys === T.storeys, `${out.storeys} (fasit ${T.storeys})`);
    add('fasadevinduer', out.windows.length - doors === T.windows, `${out.windows.length - doors} (fasit ${T.windows})`);
    add('fasadedører', doors === T.doors, `${doors} (fasit ${T.doors})`);
  }
  return items;
}

const table = [];
const knownSeen = [];
for (const file of fixtures.sort()) {
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = path.basename(fx.file, '.png');
  const key = `${fx.house}/${base}.${fx.task}`;
  const short = fx.model.replace('claude-', '').replace(/-5-5$/, '');
  const tag = `${key} ${short}`;
  let req = null;
  AI.setAiTransport(async (r) => {
    req = r;
    return { ok: true, response: fx.response, model: fx.servedModel ?? fx.model, promptVersion: fx.promptVersion, cached: false };
  });
  const img = readPng(path.join(ROOT, fx.file));
  const out = await AI.aiRead(fx.task, { image: img, marks: fx.marks, unmarked: fx.unmarked, hints: fx.hints });
  AI.resetAiTransport();
  check(`${tag}: spilt av (${fx.promptVersion}), bildet sendt i ${req?.image.width} × ${req?.image.height} som i opptaket`, out && req.task === fx.task && req.image.width === fx.image.width && req.image.height === fx.image.height && Math.max(req.image.width, req.image.height) <= 1600);
  if (!out) continue;
  if (fx.task === 'readPlan' && fx.marks.length) {
    const linked = out.rooms.filter((r) => r.mark && fx.marks.find((m) => m.id === r.mark)?.at.join() === r.at.join()).length;
    check(`${tag}: rommenes at er merkenes egne posisjoner`, linked === out.rooms.filter((r) => r.mark).length);
  }
  const items = itemsOf(fx, out, img);
  const known = new Set(KNOWN[tag] ?? []);
  const ids = new Set(items.map((i) => i.id));
  const unexpected = items.filter((i) => !i.ok && !known.has(i.id));
  const fixed = items.filter((i) => i.ok && known.has(i.id));
  const stale = [...known].filter((k) => !ids.has(k));
  for (const i of items.filter((x) => !x.ok && known.has(x.id))) knownSeen.push(`${tag}: ${i.id} – ${i.detail}`);
  const okN = items.filter((i) => i.ok).length;
  check(
    `${tag}: ${okN}/${items.length} punkter som fasiten, ${known.size} kjente feil`,
    !unexpected.length && !fixed.length && !stale.length,
    [...unexpected.map((i) => `NY FEIL ${i.id}: ${i.detail}`), ...fixed.map((i) => `RETTET ${i.id}: ${i.detail} – ta den ut av KNOWN`), ...stale.map((k) => `UKJENT PUNKT I KNOWN: ${k}`)].join('; '),
  );
  // the score per group, for the table
  const groups = {};
  for (const i of items) {
    const g = i.id.replace(/ .*$/, '');
    groups[g] ??= [0, 0];
    groups[g][0] += i.ok ? 1 : 0;
    groups[g][1]++;
  }
  table.push({ key, model: fx.model, in: fx.usage?.input_tokens, out: fx.usage?.output_tokens, cost: fx.cost, ms: fx.ms, score: Object.entries(groups).map(([g, [a, n]]) => (n > 1 ? `${g} ${a}/${n}` : `${g} ${a ? '✓' : '✗'}`)).join(', ') });
}
check('hver oppføring i KNOWN hører til et opptak', Object.keys(KNOWN).every((k) => table.some((t) => `${t.key} ${t.model.replace('claude-', '').replace(/-5-5$/, '')}` === k)), Object.keys(KNOWN).join(', '));
console.log('\n  Opptakene (tokens inn / ut, pris, tid, punkter som fasiten):');
for (const r of table) console.log(`    ${r.key.padEnd(40)} ${r.model.padEnd(18)} ${String(r.in).padStart(5)} / ${String(r.out).padStart(5)}  $${(r.cost ?? 0).toFixed(4)}  ${((r.ms ?? 0) / 1000).toFixed(1).padStart(5)} s  ${r.score}`);
console.log(`\n  Kjente feil (${knownSeen.length}):`);
for (const k of knownSeen) console.log(`    ${k}`);

// ---------------------------------------------------------------------------------------------------------------
section('serveren med en stubbet SDK-klient');

/** A tiny PNG; seed makes a distinct image. */
const png = (w, h, seed = 0) => {
  const img = blank(w, h);
  img.data[0] = seed % 256;
  img.data[1] = Math.floor(seed / 256) % 256;
  return encodePng(img).toString('base64');
};
const message = (params, obj, extra = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: params.model,
  content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: JSON.stringify(obj) }],
  stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1200, output_tokens: 300 }, ...extra,
});
const FACADE = { title: null, roof: 'gable', storeys: 2, windows: [{ bbox: [0.1, 0.5, 0.2, 0.6], kind: 'window' }], notes: '' };
function stub(behaviour = (p) => message(p, FACADE)) {
  const calls = [];
  const make = (beta) => async (params, opts) => {
    calls.push({ params, opts, beta });
    return behaviour(params, opts);
  };
  return { calls, messages: { create: make(false) }, beta: { messages: { create: make(true) } } };
}
/** A fake Connect request / response pair. */
async function call(handler, { method = 'GET', url, body = null, cookie = '', ip = '10.0.0.1', headers = {} }) {
  const buf = body == null ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from(buf.length ? [buf] : []);
  Object.assign(req, { method, url, headers: { cookie, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: ip } });
  let nexted = false;
  const res = await new Promise((resolve) => {
    const r = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(text) {
        resolve({ status: this.statusCode, headers: this.headers, json: text ? JSON.parse(text) : null });
      },
    };
    handler(req, r, () => {
      nexted = true;
      resolve({ status: 0, next: true });
    });
  });
  return { ...res, nexted };
}
const cacheDir = (name) => path.join(TMP, name);
const quiet = () => {};

{
  const api = stub();
  const h = SERVER.createAiHandler({ apiKey: 'test-key', client: api, sdk: SDK, log: quiet, limits: { perSession: 2, perIp: 3, cacheDir: cacheDir('a') } });
  const other = await call(h, { url: '/planbygger.html' });
  check('andre adresser går videre (next)', other.nexted === true);
  const st = await call(h, { url: '/api/planbygger/ai/status' });
  const cookie = String(st.headers['set-cookie'] ?? '').split(';')[0];
  check('status: available, modell, kvote, og en øktkapsel', st.status === 200 && st.json.available === true && st.json.model === 'claude-haiku-5-5' && st.json.remaining === 2 && /^pb_ai=[\w-]{16,}$/.test(cookie) && /HttpOnly/.test(st.headers['set-cookie']));
  const body = { task: 'readFacade', image: { mediaType: 'image/png', data: png(64, 48, 1) }, hints: { fileName: 'fasade1.avif' } };
  const r1 = await call(h, { method: 'POST', url: '/api/planbygger/ai', body, cookie });
  check('POST: 200 med svaret fra modellen', r1.status === 200 && r1.json.ok === true && r1.json.response.roof === 'gable' && r1.json.cached === false && r1.json.remaining === 1, JSON.stringify(r1.json).slice(0, 120));
  const p = api.calls[0]?.params;
  const content = p?.messages?.[0]?.content ?? [];
  check('forespørselen: modell, max_tokens, system, bilde (base64) + tekst', p.model === 'claude-haiku-5-5' && p.max_tokens === 16000 && typeof p.system === 'string' && content[0]?.type === 'image' && content[0].source.type === 'base64' && content[0].source.media_type === 'image/png' && content[1]?.type === 'text' && /facade/.test(content[1].text) && /fasade1\.avif/.test(content[1].text));
  check('strukturert svar: output_config.format = oppgavens JSON-skjema, innsats per oppgave', p.output_config?.format?.type === 'json_schema' && p.output_config.format.schema === PROMPTS.TASKS.readFacade.schema && p.output_config.effort === 'medium');
  check('ingen temperature / top_p / top_k, ingen thinking-budsjett, Haiku uten fallback', !('temperature' in p) && !('top_p' in p) && !('top_k' in p) && !('thinking' in p) && !('fallbacks' in p) && api.calls[0].beta === false);
  check('SDK-kallet får en signal og en tidsgrense på 60 s', api.calls[0].opts?.signal && api.calls[0].opts.timeout === 60000);
  const r2 = await call(h, { method: 'POST', url: '/api/planbygger/ai', body, cookie });
  const files = fs.readdirSync(cacheDir('a')).filter((f) => f.endsWith('.json'));
  check('samme bilde igjen: fra hurtigbufferen, ingen nytt kall, ingen kvote brukt', r2.status === 200 && r2.json.cached === true && api.calls.length === 1 && r2.json.remaining === 1 && files.length === 1);
  const r3 = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, image: { data: png(64, 48, 2) } }, cookie });
  const r4 = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, image: { data: png(64, 48, 3) } }, cookie });
  check('kvote per økt: 2 kall, så 429', r3.status === 200 && r3.json.remaining === 0 && r4.status === 429 && r4.json.error === 'quota' && /kvoten/.test(r4.json.message));
  const r5 = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, image: { data: png(64, 48, 4) } } }); // a new session, same IP
  const r6 = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, image: { data: png(64, 48, 5) } } });
  check('kvote per IP: en ny økt på samme IP får 1 til (3 i alt), så 429', r5.status === 200 && r6.status === 429 && r6.json.error === 'quota');
  const r7 = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, image: { data: png(64, 48, 6) } }, ip: '10.0.0.2' });
  check('en annen IP har sin egen kvote', r7.status === 200);
  const big = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, image: { data: png(1700, 4) } }, ip: '10.0.0.3' });
  check('bilde over 1600 px: 413, ingen modellkall', big.status === 413 && big.json.error === 'too_large' && api.calls.length === 4, `${big.status} ${big.json?.error}, ${api.calls.length} kall`);
  const bad = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, image: { data: Buffer.from('ikke et bilde').toString('base64') } }, ip: '10.0.0.3' });
  const task = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, task: 'tull' }, ip: '10.0.0.3' });
  const json = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: '{ikke json', ip: '10.0.0.3' });
  const get = await call(h, { method: 'GET', url: '/api/planbygger/ai', ip: '10.0.0.3' });
  check('ugyldig bilde 400, ukjent oppgave 400, ugyldig JSON 400, GET 405', bad.status === 400 && bad.json.error === 'bad_image' && task.status === 400 && json.status === 400 && get.status === 405);
  const tiny = SERVER.createAiHandler({ apiKey: 'test-key', client: stub(), log: quiet, limits: { maxBodyBytes: 500, cacheDir: cacheDir('b') } });
  const huge = await call(tiny, { method: 'POST', url: '/api/planbygger/ai', body: { ...body, image: { data: png(200, 200, 9) } } });
  check('for stor forespørsel: 413', huge.status === 413 && huge.json.error === 'too_large');
}

section('serveren: IP bak proxy, modellvalg, tak for hele serveren');
{
  // behind a proxy: the last X-Forwarded-For entry is the one the proxy added; the first ones are the client's
  const api = stub();
  const h = SERVER.createAiHandler({ apiKey: 'test-key', client: api, log: quiet, limits: { perSession: 1, perIp: 2, trustProxy: true, cacheDir: cacheDir('xff') } });
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const r = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { task: 'readFacade', image: { data: png(16, 16, 100 + i) } }, ip: '10.0.0.9', headers: { 'x-forwarded-for': `203.0.113.${i}, 198.51.100.7` } });
    statuses.push(r.status);
  }
  check('trustProxy: en falsk første X-Forwarded-For per kall og ingen kapsel gir ikke ny kvote (2 kall, så 429)', statuses.join(' ') === '200 200 429 429 429 429' && api.calls.length === 2, `${statuses.join(' ')}, ${api.calls.length} modellkall`);
  const other = await call(h, { method: 'POST', url: '/api/planbygger/ai', body: { task: 'readFacade', image: { data: png(16, 16, 120) } }, headers: { 'x-forwarded-for': '198.51.100.8' } });
  check('trustProxy: en annen klient (siste oppføring) har sin egen kvote', other.status === 200);
  const plain = SERVER.createAiHandler({ apiKey: 'test-key', client: stub(), log: quiet, limits: { perSession: 5, perIp: 1, trustProxy: false, cacheDir: cacheDir('noxff') } });
  const p1 = await call(plain, { method: 'POST', url: '/api/planbygger/ai', body: { task: 'readFacade', image: { data: png(16, 16, 130) } }, headers: { 'x-forwarded-for': '203.0.113.1' } });
  const p2 = await call(plain, { method: 'POST', url: '/api/planbygger/ai', body: { task: 'readFacade', image: { data: png(16, 16, 131) } }, headers: { 'x-forwarded-for': '203.0.113.2' } });
  check('uten trustProxy: X-Forwarded-For telles ikke, socket-adressen gjelder', p1.status === 200 && p2.status === 429);
  check('trustProxy er av som standard utenfor Railway', SERVER.DEFAULT_LIMITS.trustProxy === Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT));

  // the client may not pick the model
  const m = stub();
  const hm = SERVER.createAiHandler({ apiKey: 'test-key', client: m, log: quiet, limits: { cacheDir: cacheDir('model') } });
  const sonnet = await call(hm, { method: 'POST', url: '/api/planbygger/ai', body: { task: 'readFacade', image: { data: png(16, 16, 140) }, model: 'sonnet' } });
  const full = await call(hm, { method: 'POST', url: '/api/planbygger/ai', body: { task: 'readFacade', image: { data: png(16, 16, 141) }, model: 'claude-sonnet-5-5' } });
  check('over HTTP: model «sonnet» fra klienten overses, oppgavens modell (Haiku) brukes', sonnet.status === 200 && full.status === 200 && m.calls.every((c) => c.params.model === 'claude-haiku-5-5' && c.beta === false) && sonnet.json.model === 'claude-haiku-5-5');
  const dev = stub();
  const hd = SERVER.createAiHandler({ apiKey: 'test-key', client: dev, log: quiet, limits: { allowModelOverride: true, cacheDir: cacheDir('model-dev') } });
  await call(hd, { method: 'POST', url: '/api/planbygger/ai', body: { task: 'readFacade', image: { data: png(16, 16, 142) }, model: 'sonnet' } });
  check('med utviklerflagget allowModelOverride: klienten kan velge Sonnet', dev.calls[0]?.params.model === 'claude-sonnet-5-5');

  // a cap for the whole server: calls, and USD from the usage
  const cap = SERVER.createAiService({ apiKey: 'test-key', client: stub(), log: quiet, limits: { perServer: 3, cacheDir: cacheDir('cap') } });
  const capped = [];
  for (let i = 0; i < 4; i++) capped.push(await cap.run({ task: 'readFacade', image: { data: png(16, 16, 150 + i) } }, { session: `s${i}`, ip: `ip${i}` }));
  check('tak for hele serveren: 3 kall fra fire klienter, så 429 quota_server med norsk tekst', capped.slice(0, 3).every((r) => r.ok) && capped[3].status === 429 && capped[3].error === 'quota_server' && /serveren/.test(capped[3].message) && (await cap.status({ session: 'ny', ip: 'ny' })).remaining === 0);
  // 1200 in / 300 out Haiku tokens = $0.00027 per call: a cap of $0.0005 stops the third
  const usd = SERVER.createAiService({ apiKey: 'test-key', client: stub(), log: quiet, limits: { maxCostPerWindow: 0.0005, cacheDir: cacheDir('usd') } });
  const spent = [];
  for (let i = 0; i < 3; i++) spent.push(await usd.run({ task: 'readFacade', image: { data: png(16, 16, 160 + i) } }, { session: `s${i}`, ip: `ip${i}` }));
  check('kostnadstak for hele serveren: stopper når USD-summen er nådd', spent[0].ok && spent[1].ok && spent[2].error === 'quota_server' && Math.abs(usd.stats().spent - 0.00054) < 1e-9, `${spent.map((r) => r.ok || r.error).join(' ')}, brukt $${usd.stats().spent}`);
}

section('serveren uten nøkkel og uten SDK');
{
  const noKey = SERVER.createAiHandler({ log: quiet, limits: { cacheDir: cacheDir('c') } });
  const st = await call(noKey, { url: '/api/planbygger/ai/status' });
  const post = await call(noKey, { method: 'POST', url: '/api/planbygger/ai', body: { task: 'classify', image: { data: png(10, 10) } } });
  check('ingen nøkkel: available false (no_key), POST 503', st.status === 200 && st.json.available === false && st.json.reason === 'no_key' && st.json.remaining === 0 && post.status === 503 && post.json.error === 'no_key');
  const noSdk = SERVER.createAiService({ apiKey: 'test-key', importSdk: () => import('@anthropic-ai/finnes-ikke'), log: quiet, limits: { cacheDir: cacheDir('d') } });
  const s2 = await noSdk.status();
  const r2 = await noSdk.run({ task: 'classify', image: { data: png(10, 10) } });
  check('ingen SDK: available false (no_sdk), kallet 503', s2.available === false && s2.reason === 'no_sdk' && r2.ok === false && r2.status === 503 && r2.error === 'no_sdk');
  if (SDK) {
    const real = SERVER.createAiService({ apiKey: 'test-key', log: quiet, limits: { cacheDir: cacheDir('e') } });
    check('med nøkkel og SDK-en installert i server/planbygger-ai: available true', (await real.status()).available === true);
  } else check('SDK-en er installert i server/planbygger-ai/node_modules', false);
}

section('serveren: stoppgrunner, SDK-feil, tidsgrense, kø, Sonnet');
{
  const run = async (behaviour, limits = {}, input = {}, ctx = {}) => {
    const api = stub(behaviour);
    const svc = SERVER.createAiService({ apiKey: 'test-key', client: api, sdk: SDK, log: quiet, limits: { cacheDir: cacheDir(`s${Math.random().toString(36).slice(2)}`), ...limits } });
    const r = await svc.run({ task: 'readFacade', image: { data: png(32, 32, 7) }, ...input }, { session: 's', ip: 'i', ...ctx });
    return { r, api, svc };
  };
  const refusal = await run((p) => message(p, {}, { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms', explanation: '' }, content: [] }));
  check('stop_reason refusal: 422 refusal (før innholdet leses), ikke bufret', refusal.r.status === 422 && refusal.r.error === 'refusal' && refusal.r.category === 'general_harms' && !fs.existsSync(path.join(refusal.svc.limits.cacheDir)));
  const cut = await run((p) => message(p, FACADE, { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"roof": "ga' }] }));
  check('stop_reason max_tokens: 502 truncated', cut.r.status === 502 && cut.r.error === 'truncated');
  const junk = await run((p) => message(p, FACADE, { content: [{ type: 'text', text: 'ikke json' }] }));
  check('svar som ikke er JSON: 502 bad_json', junk.r.status === 502 && junk.r.error === 'bad_json');
  if (SDK) {
    const A = SDK.default;
    const err = (C, status, type) => new C(status, { type: 'error', error: { type, message: 'x' } }, 'x', new Headers());
    const rate = await run(() => {
      throw err(A.RateLimitError, 429, 'rate_limit_error');
    });
    check('RateLimitError: 503 rate_limited, kvoten gis tilbake', rate.r.status === 503 && rate.r.error === 'rate_limited' && rate.svc.limits && rate.r.remaining === 40);
    const auth = await run(() => {
      throw err(A.AuthenticationError, 401, 'authentication_error');
    });
    check('AuthenticationError: 503 auth, og status sier available false etterpå', auth.r.error === 'auth' && (await auth.svc.status()).available === false && (await auth.svc.status()).reason === 'auth');
    const badreq = await run(() => {
      throw err(A.BadRequestError, 400, 'invalid_request_error');
    });
    const server = await run(() => {
      throw err(A.InternalServerError, 529, 'overloaded_error');
    });
    const conn = await run(() => {
      throw new A.APIConnectionError({ message: 'nett' });
    });
    const ctimeout = await run(() => {
      throw new A.APIConnectionTimeoutError();
    });
    check('BadRequestError 502 bad_request, InternalServerError 502 upstream, APIConnectionError 502 network, APIConnectionTimeoutError 504 timeout', badreq.r.error === 'bad_request' && server.r.error === 'upstream' && conn.r.error === 'network' && ctimeout.r.status === 504 && ctimeout.r.error === 'timeout');
  } else check('SDK-en finnes for feilklassene', false);
  const t0 = Date.now();
  const slow = await run(
    (p, opts) =>
      new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(SDK ? new SDK.default.APIUserAbortError() : Object.assign(new Error('abort'), { name: 'AbortError' })));
      }),
    { timeoutMs: 150 },
  );
  check('tidsgrensen: et kall som henger avbrytes med 504 timeout', slow.r.status === 504 && slow.r.error === 'timeout' && Date.now() - t0 < 2000, `${Date.now() - t0} ms`);

  // the queue: 7 calls, at most 3 at a time
  let active = 0;
  let peak = 0;
  const api = stub(async (p) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 60));
    active--;
    return message(p, FACADE);
  });
  const svc = SERVER.createAiService({ apiKey: 'test-key', client: api, log: quiet, limits: { cacheDir: cacheDir('q') } });
  const all = await Promise.all(Array.from({ length: 7 }, (_, i) => svc.run({ task: 'readFacade', image: { data: png(16, 16, 20 + i) } }, { noQuota: true })));
  check('køen: 7 samtidige kall, høyst 3 i gang om gangen, alle svarer', peak === 3 && all.every((r) => r.ok), `topp ${peak}`);
  const one = SERVER.createAiService({ apiKey: 'test-key', client: stub(async (p) => (await new Promise((r) => setTimeout(r, 80)), message(p, FACADE))), log: quiet, limits: { maxConcurrent: 1, maxQueue: 1, cacheDir: cacheDir('q1') } });
  const three = await Promise.all([0, 1, 2].map((i) => one.run({ task: 'readFacade', image: { data: png(16, 16, 40 + i) } }, { session: 'x', ip: 'y' })));
  check('full kø: 503 busy, og kvoten gis tilbake', three.filter((r) => r.ok).length === 2 && three.some((r) => r.error === 'busy') && three.find((r) => r.error === 'busy').remaining === 38);

  // the record script (ctx.allowModel) may pick Sonnet
  const son = await run((p) => message(p, FACADE), {}, { model: 'sonnet' }, { allowModel: true });
  const sp = son.api.calls[0];
  check('Sonnet (opptaksskriptet, ctx.allowModel): beta-endepunktet med fallbacks «default» og beta-headeren', son.r.ok && sp.beta === true && sp.params.model === 'claude-sonnet-5-5' && sp.params.fallbacks === 'default' && sp.params.betas?.includes('server-side-fallback-2026-07-01'));
  const noPick = await run((p) => message(p, FACADE), {}, { model: 'sonnet' });
  check('uten ctx.allowModel: model «sonnet» overses', noPick.api.calls[0].params.model === 'claude-haiku-5-5');
  const opus = await run((p) => message(p, FACADE), {}, { model: 'claude-opus-5-5' }, { allowModel: true });
  check('en modell utenfor listen gir oppgavens standardmodell', opus.api.calls[0].params.model === 'claude-haiku-5-5');
  const marked = await run((p) => message(p, { levelTitle: null, scaleText: null, rooms: [], labels: [], dimensions: [], openings: [], skylights: [], stair: { present: false, at: null, type: 'none', up: 'unknown' }, ceiling: [], furniture: [], notes: '' }), {}, { task: 'readPlan', marks: [{ id: '1', kind: 'room', at: [0.2, 0.3] }, { id: 'A', kind: 'opening', at: [0.5, 0.1], drawnAt: [0.52, 0.12] }, { id: 'x', kind: 'tull', at: [0, 0] }] });
  const text = marked.api.calls[0].params.messages[0].content[1].text;
  check('readPlan: merkene står i teksten (rom og åpninger), ugyldige merker ut', /Red room marks \(1\).*1 \[0\.200, 0\.300\]/.test(text) && /Blue opening marks \(1\).*A \[0\.520, 0\.120\]/.test(text) && !/tull/.test(text));
}

section('serveren: bildehoder');
{
  const pngInfo = SERVER.imageInfo(Buffer.from(png(123, 45), 'base64'));
  const jpeg = Buffer.alloc(64);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(jpeg, 0);
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20]).copy(jpeg, 20);
  const webp = Buffer.alloc(40);
  webp.write('RIFF', 0, 'latin1');
  webp.write('WEBP', 8, 'latin1');
  webp.write('VP8L', 12, 'latin1');
  webp[20] = 0x2f;
  webp.writeUInt32LE((1000 - 1) | ((500 - 1) << 14), 21);
  const j = SERVER.imageInfo(jpeg);
  const w = SERVER.imageInfo(webp);
  check('PNG-, JPEG- og WebP-hodet gir type og størrelse', pngInfo.mediaType === 'image/png' && pngInfo.width === 123 && pngInfo.height === 45 && j?.mediaType === 'image/jpeg' && j.width === 800 && j.height === 600 && w?.mediaType === 'image/webp' && w.width === 1000 && w.height === 500, JSON.stringify([pngInfo, j, w]));
  check('noe annet gir null', SERVER.imageInfo(Buffer.from('GIF89a...........................')) === null);
  check('prisen: Haiku $0,10 / $0,50, Sonnet $2 / $10 per million tokens', SERVER.costOf('claude-haiku-5-5', { input_tokens: 1e6, output_tokens: 1e6 }) === 0.6 && SERVER.costOf('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e5 }) === 3);
  const schemaUnions = (s) => (s && typeof s === 'object' ? (s.anyOf ? 1 : 0) + Object.values(s).reduce((n, v) => n + schemaUnions(v), 0) : 0);
  const closed = (s) => !s || typeof s !== 'object' || ((s.type !== 'object' || (s.additionalProperties === false && JSON.stringify(Object.keys(s.properties).sort()) === JSON.stringify([...s.required].sort()))) && Object.values(s).every(closed));
  check('skjemaene: høyst 16 nullbare felt, alle objekter lukket og alle felt påkrevd', Object.values(PROMPTS.TASKS).every((t) => schemaUnions(t.schema) <= 16 && closed(t.schema)), Object.entries(PROMPTS.TASKS).map(([k, t]) => `${k} ${schemaUnions(t.schema)}`).join(', '));
}

// ---------------------------------------------------------------------------------------------------------------
section('Vite-tillegget');
{
  const plugin = (await import(pathToFileURL(path.join(ROOT, 'tools/planbygger-vite-plugin.mjs')).href)).default();
  let mw = null;
  plugin.configureServer({ middlewares: { use: (fn) => (mw = fn) } });
  check('configureServer monterer en mellomvare', typeof mw === 'function' && typeof plugin.resolveId === 'function');
  const st = await call(mw, { url: '/api/planbygger/ai/status' });
  check('uten nøkkel: /api/planbygger/ai/status sier available false', st.status === 200 && st.json?.available === false, JSON.stringify(st.json));
  const other = await call(mw, { url: '/src/planbygger/app.js' });
  check('andre adresser går videre', other.nexted === true);

  if (!args.includes('--no-vite')) {
    const { createServer } = await import('vite');
    let server = null;
    try {
      server = await createServer({ configFile: path.join(ROOT, 'tools/planbygger-vite.config.mjs'), cacheDir: path.join(TMP, 'vite'), logLevel: 'silent', server: { port: 5276, strictPort: true } });
      await server.listen();
      const base = 'http://127.0.0.1:5276';
      const s = await fetch(`${base}/api/planbygger/ai/status`).then((r) => r.json());
      const page = await fetch(`${base}/planbygger.html`);
      const html = await page.text();
      check('Vite (port 5276) uten nøkkel: status available false', s.available === false && s.reason === 'no_key', JSON.stringify(s));
      check('Vite serverer fortsatt planbygger.html', page.status === 200 && /planbygger/i.test(html));
    } catch (e) {
      check('Vite startet', false, e.message);
    } finally {
      await server?.close();
      // let the watcher's handles finish closing: process.exit while they close aborts Node on Windows
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
done();
