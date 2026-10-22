/**
 * «Generer» on every house of the test set, measured against plantegninger/<hus>/fasit.json
 * (notes/planbygger-runde1-design.md, «Måling»):
 *
 *   node tools/planbygger-measure-all.mjs [--only hus1,hus3] [--mode ai|noai|both] [--write] [--json file] [--from file]
 *
 * Each house is generated the way a customer would upload it: every file in plantegninger/<hus>/ (not fasit.json or
 * info.txt), the non-PNG ones read from their PNG copy in plantegninger/_png/<hus>/, a PDF with its page size from the
 * PDF's MediaBox and the PNG's size as the rendered page. Once with the recorded AI answers
 * (tools/planbygger-ai-fixtures.mjs, Haiku) and once without AI. Measured per house:
 *   - scale: px/m against the fasit's pxPerM where it has one, and the scale error from the rooms: the median of
 *     generated / labelled area over the matched rooms → sqrt − 1 (an area error of 4 % is a scale error of 2 %)
 *   - rooms: matched (a generated room for the label: by name when the AI named it, else by area within 15 %), named
 *     (its name is the label, in a room of its own), open (in one room with the other labels of an open plan the drawing
 *     shows – OPEN_PLANS, per level with the fasit's words), shared (in a room with another label across a drawn wall, door
 *     or separator line), kind right (hall and entrance both count for the room with the front door)
 *   - doors per variant (single / double / sliding), windows, skylights against the fasit counts per level
 *   - the stair between two levels (built as straight / U, or none) against the fasit's type, and whether the player
 *     walks it (walkStairs: its slope against src/config.js WALKABLE_NORMAL_Y, and the game's PlayerController walked up
 *     and down it in a CollisionWorld with the house's colliders, as viewer.js and tools/test-planbygger-build3d.mjs)
 *   - levels: how many, and whether each fasit level got its level number
 *   - facades: the house roof against the fasit's (majority of its facades), windows and doors per facade
 *   - questions: how many, by kind
 *   - exportHouse warnings and validateGenerated errors (the 3D house must be valid)
 * --write puts the table into notes/planbygger.md between <!-- hus:start --> and <!-- hus:slutt --> (the section
 * «Runde 1: målinger per hus»); --json writes all numbers, and --from makes the table again from such a file.
 * --model haiku|sonnet|readPlan=sonnet,… replays that model's recordings (default: the server's model per task).
 * --facade-ai replays the readFacade recordings too, with their roof and door/window kinds (src/planbygger/ai.js sends
 * no readFacade while AI_FACADE_USE has both off, so by default the facades are read without the AI, as on the page).
 *
 * Record mode: «Generer» on every house with a recording transport, so each recording holds exactly the image, marks
 * and hints generate sends (tools/planbygger-ai-fixtures.mjs):
 *
 *   node tools/planbygger-measure-all.mjs --record [--only hus1,hus3] [--model …] [--budget 20] [--dry]
 *                                         [--files a.png,fasader.png#2] [--tasks readPlan] [--keep-stale] [--prune]
 *                                         [--facade-ai] [--json file]
 *   (--facade-ai: the facades are recorded too; without it --prune keeps the readFacade recordings)
 *   (--files / --tasks: record only those tasks; «#n» is the n-th drawing of a split sheet)
 *
 *   Real calls only for a task without a recording of its model, or with a stale one (another image, other marks,
 *   hints, source or prompt version; --keep-stale replays those instead); a hit in the AI service's disk cache is no
 *   real call. --budget: at most this many real calls in this run (default 0: nothing is called – say how many).
 *   --dry: no calls and no key – lists what would be called. The key comes from ANTHROPIC_API_KEY or, on Windows, the
 *   user variable (read through PowerShell into this process only; never printed, logged or written). Every real call
 *   is logged with its tokens and cost in .shots/planbygger/ai-record-log.jsonl, and the run ends with the totals.
 *   --prune deletes the recordings of the run's houses and models that no task used. The measurements of the run
 *   (with the answers as they were recorded) are printed as in the normal mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, imp, readJson, validateGenerated } from './planbygger-lib.mjs';
import { readPng } from './planbygger-png.mjs';
import { fixtureAi, FIXTURES, TASKS, modelsByTask, shortModel, PROMPT_VERSION } from './planbygger-ai-fixtures.mjs';

const G = await imp('src/planbygger/generate.js');
const E = await imp('src/planbygger/export.js');
const geom = await imp('src/planbygger/geom.js');
const THREE = await import('three');
const { buildLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const St = await imp('src/home/stairs.js');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PlayerController } = await imp('src/player/PlayerController.js');
const { PLAYER, WALKABLE_NORMAL_Y } = await imp('src/config.js');

export const HOUSES = ['hus1', 'hus2', 'hus3', 'hus3-foto', 'hus4', 'hus5', 'hus6', 'hus7', 'hus8', 'hus9'];

// ---------------------------------------------------------------------------------------------------------------
// Walking the stairs: the game's player in the house's collision (also tools/test-planbygger-build3d.mjs)

/** The steepest ground the player walks on (degrees): normal.y under WALKABLE_NORMAL_Y is a wall to it. */
export const MAX_SLOPE = (Math.acos(WALKABLE_NORMAL_Y) * 180) / Math.PI;

/** viewer.js straightStairFix: a straight stair's footprint as one long side (stairs.js chains() takes the wrong side). */
export function straightStairFix(st) {
  if (st.type !== 'straight' || !st.top?.edge || !st.foot?.edge) return st;
  const a = st.top.edge[0];
  const d = st.top.down;
  const L = Math.abs((st.foot.edge[0][0] - a[0]) * d[0] + (st.foot.edge[0][1] - a[1]) * d[1]);
  const tip = [a[0] + d[0] * L, a[1] + d[1] * L];
  const b = st.foot.edge.reduce((best, p) => (Math.hypot(p[0] - tip[0], p[1] - tip[1]) < Math.hypot(best[0] - tip[0], best[1] - tip[1]) ? p : best));
  return { ...st, footprint: [[a[0], a[1]], [b[0], b[1]]] };
}

/** The house's collision as viewer.js sets it up: every builder's colliders, the bounds and the floor field. */
export function collisionWorld(layout, parts) {
  const col = new CollisionWorld();
  for (const p of parts) for (const c of p?.colliders || []) (c?.isBox3 ? col.addStaticBox(c) : c && col.addStatic(c));
  col.build();
  const b = layout.house.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6);
  col.setBounds(b.minX - size, b.maxX + size, b.minZ - size, b.maxZ + size);
  col.setFloorField((x, z, y) => layout.house.floorYAt(x, z, y));
  return col;
}

/**
 * The game's player walks a line (a stair's walk line, stairs.js stairLayout): from 0,8 m in front of one end to 0,6 m
 * beyond the other, steering along it (0,3 m ahead plus the cross-track error, as tools/test-stairs.mjs), at 60 Hz for
 * at most (length + 2) / (0,35 · walking speed) seconds. up: from the far end (u = length) to the near one.
 * → { ok (got there, feet on endY), u (where it stopped), y (its feet), t (s) }
 */
export function walkStair(col, walk, L, { up, startY, endY, hz = 60 }) {
  const input = { move: { forward: 0, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const player = new PlayerController({ camera: new THREE.PerspectiveCamera(), collision: col, input, settings: { get: () => undefined }, events: { emit() {} } });
  const sign = up ? -1 : 1;
  const u0 = up ? L + 0.8 : -0.8;
  const goal = up ? -0.6 : L + 0.6;
  const samples = [];
  for (let u = -2; u <= L + 2 + 1e-9; u += 0.01) samples.push({ u, p: walk.at(u).p });
  const nearestU = (x, z, around) => {
    let best = around;
    let bd = Infinity;
    for (const s of samples) {
      if (Math.abs(s.u - around) > 0.6) continue;
      const d = (s.p[0] - x) ** 2 + (s.p[1] - z) ** 2;
      if (d < bd) (bd = d), (best = s.u);
    }
    return best;
  };
  const yawToward = (dx, dz) => Math.atan2(-dx, -dz);
  const p0 = walk.at(u0).p;
  const look = walk.at(u0 + sign * 0.3).p;
  player.teleport(new THREE.Vector3(p0[0], startY, p0[1]), yawToward(look[0] - p0[0], look[1] - p0[1]), 0);
  for (let i = 0; i < 12; i++) player.update(1 / hz);
  input.move.forward = 1;
  let u = u0;
  let i = 0;
  const frames = Math.round(((L + 2) / (PLAYER.walkSpeed * 0.35)) * hz);
  for (; i < frames && sign * (u - goal) < 0; i++) {
    const p = player.position;
    u = nearestU(p.x, p.z, u);
    const tgt = walk.at(u + sign * 0.3).p;
    const on = walk.at(u).p;
    player.yaw = yawToward(tgt[0] + (on[0] - p.x) - p.x, tgt[1] + (on[1] - p.z) - p.z);
    player.update(1 / hz);
  }
  u = nearestU(player.position.x, player.position.z, u);
  const y = player.position.y;
  return { ok: sign * (u - goal) >= 0 && Math.abs(y - endY) < 0.05, u: Math.round(u * 100) / 100, y: Math.round(y * 1000) / 1000, t: Math.round((i / hz) * 10) / 10 };
}

/**
 * Every stair of an exported house, built with the game's builders and walked by its player.
 * → [{ id, type, from, to, walk (m), slope (°), up, down, ok }]
 */
export function walkStairs(ex) {
  if (!ex?.house?.stairs?.length) return [];
  const layout = buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
  const H = layout.house;
  const built = buildRooms({ quality: { level: 'low' } }, layout, null);
  const sb = St.buildStairs({ quality: { level: 'low' } }, { ...layout, house: { ...H, stairs: H.stairs.map(straightStairFix) } });
  const col = collisionWorld(layout, [built, sb]);
  const out = [];
  for (const st of H.stairs) {
    const lo = H.levels.find((l) => l.id === st.fromLevel);
    const hi = H.levels.find((l) => l.id === st.toLevel);
    const lay = St.stairLayout(straightStairFix(st), H.levels);
    const L = lay.walk?.length ?? 0;
    const slope = (Math.atan2(hi.floorY - lo.floorY, L) * 180) / Math.PI;
    const up = L > 0 ? walkStair(col, lay.walk, L, { up: true, startY: lo.floorY, endY: hi.floorY }) : { ok: false };
    const down = L > 0 ? walkStair(col, lay.walk, L, { up: false, startY: hi.floorY, endY: lo.floorY }) : { ok: false };
    out.push({ id: st.id, type: st.type, from: lo.id, to: hi.id, walk: Math.round(L * 100) / 100, slope: Math.round(slope * 10) / 10, up: up.ok, down: down.ok, upAt: up.u, downAt: down.u, ok: slope <= MAX_SLOPE && up.ok && down.ok });
  }
  built.dispose?.();
  sb.dispose?.();
  return out;
}

/** The PDF page size from the file itself (the /MediaBox of its page). */
export function pdfMediaBox(file) {
  const text = fs.readFileSync(file).toString('latin1');
  const m = text.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  if (!m) return null;
  const [x0, y0, x1, y1] = m.slice(1).map(Number);
  return { widthPt: x1 - x0, heightPt: y1 - y0 };
}

/** A house's files as the customer would upload them: [{ name, img, pdfPage? }]. */
export function houseInputs(house) {
  const dir = path.join(ROOT, 'plantegninger', house);
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (/\.(json|txt|md)$/i.test(f)) continue;
    const png = /\.png$/i.test(f) ? path.join(dir, f) : path.join(ROOT, 'plantegninger/_png', house, f.replace(/\.[^.]+$/, '.png'));
    const img = readPng(png);
    let pdfPage;
    if (/\.pdf$/i.test(f)) {
      const mb = pdfMediaBox(path.join(dir, f));
      if (mb) pdfPage = { ...mb, widthPx: img.width, heightPx: img.height };
    }
    out.push({ name: f, img, ...(pdfPage ? { pdfPage } : {}) });
  }
  return out;
}

const fold = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/[^a-z0-9]/g, '');
const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const kindOf = (o) => (o.type === 'door' ? o.variant ?? 'single' : o.type);
const ENTRY = new Set(['hall', 'entrance']);

/** Generated rooms of one level (exportHouse's labelled regions): { name, kind, area, labels }. */
function levelRooms(ex, levelId) {
  const lv = ex.rooms.find((r) => r.levelId === levelId);
  return (lv?.rooms ?? []).map((r) => ({ name: r.name, kind: r.kind, area: r.region.area, labels: r.label?.labels ?? null, auto: r.auto }));
}

/**
 * Open plans: per level, the labels the drawing puts in one open area – no wall, door or separator line drawn between
 * them – each group with the fasit's own words for it (`fasit`, a quote from the level's notes in fasit.json;
 * test-planbygger-generate checks it is still there) and what a crop of the drawing showed (round 1, phase C). A
 * generated room holding the labels of one such group, and no other label, is right with its combined name («Gang +
 * Entré»): nothing is drawn to split it along. Not a blanket rule: labels not listed here that share a room are a merge
 * the detection made across a drawn wall or door, and they keep failing «rom med navn» (hus8's basement, two BODs: a
 * wall with an opening and the chimney between them).
 */
export const OPEN_PLANS = {
  // the gang with the stair and the loft living room: one floor, no line between the two labels
  'hus1 2etg.png': [{ rooms: [['GANG/TRAPP', 15.1], ['LOFTSTUE', 8.2]], fasit: 'GANG/TRAPP 15.1 og LOFTSTUE 8.2 er ett sammenhengende rom uten vegg eller dør mellom seg' }],
  // around the WC/D + BOD core (cut out as an island, regions.js): gang and entré west of it, kitchen and living room
  // east of it; the dash-dot line at y ≈ 617 px is the ridge of the sloping ceiling («SKRÅ HIMLING 24°»), no zone line.
  // BOD is not part of it: the fasit takes it for the hanger niche under WC/D (x 373–443, y 696–728 px), «åpen mot ENTRÉ
  // langs en strek-prikk-linje» – a line is drawn there (y ≈ 729, x ≈ 374–444 px; crop x 350–470, y 680–745), so BOD in
  // the gang/entré room counts as shared until detect.js returns that line as a separator
  'hus2 1etg.png': [{ rooms: [['GANG', 8.6], ['ENTRÉ', 8.6], ['KJØKKEN', 14], ['STUE', 32.9]], fasit: 'GANG, ENTRÉ, KJØKKEN og STUE 32.9 er ett åpent areal rundt WC-kjernen, uten vegger mellom etikettene' }],
  // the entrance opens north into the kitchen / living room beside the laundry: no wall, no line (crop x 300–620,
  // y 560–870 px)
  'hus3 1etg.png': [{ rooms: [['KJØKKEN/STUE', 53.4], ['ENTRÉ', 8.5]], fasit: 'ENTRÉ er åpen mot KJØKKEN/STUE uten dør' }],
  // the photo of that print: the same open passage
  'hus3-foto 1etg-foto.jpg': [{ rooms: [['KJØKKEN/STUE', 53.4], ['ENTRÉ', 8.5]], fasit: 'Grensen mellom rommene er altså ikke tegnet' }],
  // one corridor along the stair with the study at its north end: nothing drawn across it (crop x 220–360, y 130–680 px)
  'hus3 2etg.png': [{ rooms: [['ARBEIDSROM', 10.1], ['GANG', 7.8]], fasit: 'ARBEIDSROM har ingen vegg eller dør mot GANG' }],
  'hus5 1etg.avif': [
    { rooms: [['STUE/KJØKKEN', 46], ['SPISESTUE', 19.7]], fasit: 'Åpne løsninger uten vegg: STUE/KJØKKEN + SPISESTUE' },
    // the small hall is part of the main bedroom (with BAD 7.7), open towards it
    { rooms: [['GANG', 4.8], ['SOV', 18.5]], fasit: 'GANG 4.8 + SOV 18.5 (23,3 m² samlet; gangen er en del av hovedsoverommet' },
  ],
  'hus6 plan-1etg-tilbygg.pdf': [{ rooms: [['KJØKKEN', 18.5], ['SPISESTUE', 21.5], ['STUE', 43]], fasit: 'KJØKKEN, SPISESTUE og STUE er ett åpent rom uten dører' }],
  'hus8 plantegning-3.jpg': [{ rooms: [['STUE', null], ['SPISESTUE', null]], fasit: 'STUE og SPISESTUE er ett åpent, L-formet rom' }],
};

/** Whether fasit room f is the room [label, area] of an OPEN_PLANS group. */
const inGroup = (f, [label, area]) => fold(label) === fold(f.label) && (area == null ? f.area == null : f.area != null && Math.abs(area - f.area) < 0.05);

/**
 * Fasit rooms ↔ generated rooms of a level. By the label the AI put in the room (also one of several in a merged
 * region), else by area (±15 %, the nearest first). open: the level's OPEN_PLANS groups.
 * → { rows, matched, named, open, shared, kinds, ratios }
 */
function matchRooms(fasitRooms, gen, open = []) {
  const rows = [];
  const usedGen = new Map(); // gen index → fasit rooms matched to it
  const free = fasitRooms.map((r, i) => ({ ...r, i }));
  // 1. by label: each label the AI put in a generated room is used once (hus8 has five «BOD» without areas)
  const genLabels = gen.flatMap((g, k) => (g.labels ?? []).map((l) => ({ k, text: fold(l.text), area: l.area, used: false })));
  for (const f of free) {
    const l = genLabels.find((x) => !x.used && x.text === fold(f.label) && (x.area == null || f.area == null || Math.abs(x.area - f.area) < 0.15)) ?? genLabels.find((x) => !x.used && x.text === fold(f.label));
    if (!l) continue;
    l.used = true;
    f.gen = l.k;
    f.how = 'navn';
    usedGen.set(l.k, [...(usedGen.get(l.k) ?? []), f]);
  }
  // 2. by area, for the rest
  const cands = [];
  for (const f of free) {
    if (f.gen != null || !(f.area > 0)) continue;
    gen.forEach((g, k) => {
      if (usedGen.has(k)) return;
      const r = g.area / f.area;
      if (r > 0.85 && r < 1.15) cands.push({ f, k, d: Math.abs(Math.log(r)) });
    });
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    if (c.f.gen != null || usedGen.has(c.k)) continue;
    c.f.gen = c.k;
    c.f.how = 'areal';
    usedGen.set(c.k, [c.f]);
  }
  let matched = 0;
  let named = 0;
  let openNamed = 0;
  let shared = 0;
  let kinds = 0;
  const ratios = [];
  for (const f of free) {
    const g = f.gen != null ? gen[f.gen] : null;
    // a label in a region with other labels (the detection merged SOV and GANG, or an open kitchen and living room) is
    // found, but it is not a room of its own in the 3D house: counted as shared, not named
    const merged = g ? usedGen.get(f.gen).length > 1 || (g.labels?.length ?? 0) > 1 : false;
    const isNamed = !!g && f.how === 'navn' && !merged;
    // a merged room that is an open plan of the drawing: its labels are all of one OPEN_PLANS group, and it holds no
    // other label
    const together = g ? usedGen.get(f.gen) ?? [] : [];
    const openPlan = merged && f.how === 'navn' && together.length > 1 && (g.labels?.length ?? 0) === together.length && open.some((grp) => together.every((x) => grp.rooms.some((r) => inGroup(x, r))));
    const kindOk = !!g && (f.kind == null ? true : g.kind === f.kind || (ENTRY.has(f.kind) && ENTRY.has(g.kind)) || (f.kind === 'entrance' && g.kind === 'hall'));
    if (g) matched++;
    if (isNamed) named++;
    if (openPlan) openNamed++;
    else if (g && f.how === 'navn' && merged) shared++;
    if (kindOk && g) kinds++;
    // the scale from single (not merged) rooms with a printed area
    if (g && !merged && f.area > 0) ratios.push(g.area / f.area);
    rows.push({ label: f.label, area: f.area, kind: f.kind, gen: g ? { name: g.name, kind: g.kind, area: Math.round(g.area * 100) / 100 } : null, how: f.how ?? null, merged, openPlan, named: isNamed, kindOk });
  }
  return { rows, matched, named, open: openNamed, shared, kinds, ratios };
}

/** The outer extent of a level's exterior walls (their outer faces), w × h metres, or null. */
function outlineOf(L) {
  const ext = (L.walls || []).filter((w) => w.exterior);
  if (!ext.length) return null;
  const xs = ext.flatMap((w) => [w.a[0] - w.t / 2, w.b[0] - w.t / 2, w.a[0] + w.t / 2, w.b[0] + w.t / 2]);
  const ys = ext.flatMap((w) => [w.a[1] - w.t / 2, w.b[1] - w.t / 2, w.a[1] + w.t / 2, w.b[1] + w.t / 2]);
  return { w: Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100, h: Math.round((Math.max(...ys) - Math.min(...ys)) * 100) / 100 };
}

const STAIR_KIND = { straight: 'rett', 'quarter-turn': 'kvartsvingt', 'half-turn': 'U', spiral: 'spiral', none: 'ingen' };

/** Measures one generated house against its fasit. */
export async function measureHouse(house, { ai = true, model = null, fixtures = null, facadeAi = null } = {}) {
  const fasit = readJson(`plantegninger/${house}/fasit.json`);
  const inputs = houseInputs(house);
  const t0 = Date.now();
  // fixtures: a ready fixtureAi (the record mode); model: whose recordings to replay (default: the server's per task);
  // facadeAi: the readFacade parts to use (null: ai.js's AI_FACADE_USE, as on the page)
  const fx = ai ? fixtures ?? fixtureAi({ house, model, facadeAi }) : null;
  // a recording transport (record mode) sets the page's AI transport per call: one call at a time
  const res = await G.generate(inputs, { ai: fx, aiConcurrency: fixtures ? 1 : undefined });
  const ms = Date.now() - t0;
  const { doc, questions, report } = res;
  let ex = null;
  let exportError = null;
  try {
    ex = E.exportHouse(doc);
  } catch (err) {
    exportError = String(err?.message ?? err);
  }
  let val = null;
  if (ex) {
    try {
      val = await validateGenerated(ex);
    } catch (err) {
      exportError = `validator: ${err?.message ?? err}`;
    }
  }
  const levels = [];
  for (const fl of fasit.levels) {
    const L = doc.levels.find((l) => l.image?.source?.file === fl.file) ?? null;
    const alt = !!fasit.files?.[fl.file]?.alternativeOf;
    const row = { level: fl.level, name: fl.name, file: fl.file, alternative: alt, built: !!L };
    if (!L) {
      levels.push(row);
      continue;
    }
    const no = Math.round((L.floorY ?? 0) / (doc.generated?.floorHeight ?? 2.7));
    row.levelId = L.id;
    row.levelNo = L.id === 'hoved' ? 0 : no;
    row.orderOk = row.levelNo === fl.level;
    row.ppm = L.image.pxPerM;
    row.truthPpm = fl.scale?.pxPerM ?? null;
    row.ppmErr = row.truthPpm && !L.image?.source?.rectified ? row.ppm / row.truthPpm - 1 : null;
    row.scaleMethod = L.image.scaleFrom?.method ?? null;
    row.scaleConf = L.image.scaleFrom?.confidence ?? null;
    const gen = ex ? levelRooms(ex, L.id) : [];
    const m = matchRooms(fl.rooms, gen, OPEN_PLANS[`${house} ${fl.file}`] ?? []);
    row.rooms = { fasit: fl.rooms.length, gen: gen.length, matched: m.matched, named: m.named, open: m.open, shared: m.shared, kinds: m.kinds, rows: m.rows };
    const ratio = median(m.ratios);
    row.areaScaleErr = ratio ? Math.sqrt(ratio) - 1 : null;
    row.areaRooms = m.ratios.length;
    const v = { single: 0, double: 0, sliding: 0, window: 0, opening: 0 };
    for (const op of L.openings) v[kindOf(op)]++;
    row.doors = { single: v.single, double: v.double, sliding: v.sliding };
    row.doorsTruth = { single: fl.doors?.single ?? null, double: fl.doors?.double ?? null, sliding: fl.doors?.sliding ?? null };
    row.windows = v.window;
    row.windowsTruth = fl.windows;
    row.walls = L.walls.length;
    row.outline = outlineOf(L);
    row.openings = v.opening;
    row.skylights = L.skylights?.length ?? 0;
    row.skylightsTruth = fl.skylights;
    row.stairTruth = fl.stair?.type ?? null;
    levels.push(row);
  }
  // the stairs: on the upper level of each pair
  const stairs = doc.levels.flatMap((L) => (L.stairs || []).map((s) => ({ level: L.id, kind: s.kind === 'u' ? 'U' : 'rett', type: s.from?.type ?? null, w: Math.round((s.rect[1][0] - s.rect[0][0]) * 100) / 100, h: Math.round((s.rect[1][1] - s.rect[0][1]) * 100) / 100 })));
  const exportedStairs = ex?.house?.stairs?.length ?? 0;
  let stairWalk = [];
  try {
    stairWalk = val && !val.errors.length ? walkStairs(ex) : [];
  } catch (err) {
    stairWalk = [{ error: String(err?.message ?? err), ok: false }];
  }
  const stairQ = questions.find((q) => q.kind === 'stair');
  const truthStairs = fasit.levels.filter((l) => l.stair && l.stair.type !== 'none' && !fasit.files?.[l.file]?.alternativeOf);
  const stairTruth = truthStairs.length >= 2 ? truthStairs[0].stair.type : truthStairs.length === 1 && fasit.levels.length > 1 ? truthStairs[0].stair.type : 'none';
  // facades
  const fasitFacades = fasit.facades ?? [];
  const votes = {};
  for (const f of fasitFacades) votes[f.roof] = (votes[f.roof] ?? 0) + 1;
  const roofTruth = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const fac = (doc.facades ?? []).map((f) => ({ file: f.file, part: f.part, roof: f.roof, windows: f.windows, doors: f.doors, method: f.method, conf: f.confidence }));
  // per facade against the fasit, in order per file
  const facRows = [];
  const byFile = new Map();
  for (const f of fasitFacades) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    const gens = fac.filter((g) => g.file === file).sort((a, b) => (a.part ?? 0) - (b.part ?? 0));
    list.forEach((f, k) => facRows.push({ file, truth: f, gen: gens.length === list.length ? gens[k] : gens.length === 1 && list.length === 1 ? gens[0] : null, found: gens.length, expected: list.length }));
  }
  const qByKind = {};
  for (const q of questions) qByKind[q.kind] = (qByKind[q.kind] ?? 0) + 1;
  return {
    house,
    ai,
    ms,
    levelsTruth: fasit.levels.filter((l) => !fasit.files?.[l.file]?.alternativeOf).length,
    levelsGen: doc.levels.length,
    levels,
    stairs,
    exportedStairs,
    stairWalk,
    stairAsked: stairQ ? { default: stairQ.default, steep: /for bratt/.test(stairQ.help ?? '') } : null,
    stairTruth,
    roof: doc.roof?.type ?? null,
    roofTruth,
    facadesTruth: fasitFacades.length,
    facadesGen: fac.length,
    facRows,
    questions: questions.length,
    qByKind,
    questionList: questions.map((q) => ({ id: q.id, kind: q.kind, text: q.text, default: q.default, help: q.help ?? null })),
    exportError,
    exportWarnings: ex?.report.warnings.length ?? null,
    errors: val ? val.errors.length : null,
    errorList: val ? val.errors.slice(0, 5) : [],
    validatorWarnings: val ? val.warnings.length : null,
    steps: report.steps.map((s) => `${s.step} ${s.file ?? s.level ?? ''}: ${s.method ?? '–'}/${s.confidence ?? '–'} ${s.detail ?? ''}`),
    aiCalls: report.ai.length,
    aiAnswered: report.ai.filter((a) => a.ok).length,
    // tasks the page does not send (ai.js: readFacade while AI_FACADE_USE has nothing on)
    aiOff: fx ? fx.calls.filter((c) => c.off).length : 0,
    notes: report.notes,
    requests: report.requests,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The table (Norwegian)

const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d).replace('.', ',')} %`);
const nf = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d).replace('.', ','));
const counts = (g, t) => `${g.single}/${g.double}/${g.sliding} (${t.single ?? '?'}/${t.double ?? '?'}/${t.sliding ?? '?'})`;

export function tableRows(results) {
  const lines = [];
  lines.push('| Hus | KI | Etasjer (rekkefølge) | Skala px/m (feil) | Skala fra rommene | Rom: funnet / navn / type | Vegger / rom i 3D | Dører enkel/dobbel/skyve (fasit) | Vinduer | Takvinduer | Trapp | Tak | Fasadevinduer | Spørsmål | Feil i 3D-huset |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const built = r.levels.filter((l) => l.built);
    const per = (f) => built.map(f).join(' · ') || '–';
    const ordOk = built.filter((l) => l.orderOk).length;
    const lvl = `${r.levelsGen} av ${r.levelsTruth} (${ordOk}/${built.length} rett)`;
    const scale = per((l) => (l.truthPpm ? `${nf(l.ppm, 1)} (${pct(l.ppmErr)})` : `${nf(l.ppm, 1)} (–)`) + ` ${l.scaleMethod ?? ''}`);
    const areaS = per((l) => (l.areaScaleErr != null ? `${pct(l.areaScaleErr)} (${l.areaRooms} rom)` : '–'));
    const rooms = per((l) => `${l.rooms.matched}/${l.rooms.named}${l.rooms.open ? ` (+${l.rooms.open} åpen)` : ''}${l.rooms.shared ? ` (+${l.rooms.shared} delt)` : ''}/${l.rooms.kinds} av ${l.rooms.fasit}`);
    const walls3d = per((l) => `${l.walls ?? '?'} / ${l.rooms.gen}`);
    const doors = per((l) => counts(l.doors, l.doorsTruth));
    const win = per((l) => `${l.windows} (${l.windowsTruth ?? '?'})`);
    const sky = per((l) => `${l.skylights} (${l.skylightsTruth ?? '?'})`);
    const walked = (r.stairWalk ?? []).map((w) => (w.error ? 'gangtesten feilet' : `${nf(w.slope, 0)}°, ${w.ok ? 'gås opp og ned' : `IKKE GANGBAR (${w.slope > MAX_SLOPE ? 'for bratt' : `opp ${w.up ? 'ja' : 'nei'}, ned ${w.down ? 'ja' : 'nei'}`})`}`));
    const unlinked = r.levelsGen > 1 && !r.exportedStairs ? `${r.stairAsked?.steep ? ', den som ble funnet er for bratt (spurt, «ingen trapp»)' : ''}; etasjene henger ikke sammen` : '';
    const stair = `${r.stairs.length ? r.stairs.map((s) => `${s.kind}${s.type ? ` fra ${STAIR_KIND[s.type] ?? s.type}` : ''}`).join(', ') : 'ingen'}${r.exportedStairs < r.stairs.length ? ' (ikke eksportert)' : ''} (${STAIR_KIND[r.stairTruth] ?? r.stairTruth})${walked.length ? `, ${walked.join(', ')}` : ''}${unlinked}`;
    const roof = r.facadesTruth ? `${r.roof ?? '–'} (${r.roofTruth})` : r.roof ?? '–';
    const facW = r.facadesTruth ? `${r.facadesGen} av ${r.facadesTruth} fasader; ${r.facRows.map((f) => (f.gen ? `${f.gen.windows}/${f.truth.windows}` : '–')).join(' ')}` : '–';
    const q = `${r.questions} (${Object.entries(r.qByKind).map(([k, v]) => `${k} ${v}`).join(', ')})`;
    const errs = r.exportError ? `eksport: ${r.exportError}` : `${r.errors} feil, ${r.validatorWarnings} adv.`;
    lines.push(`| ${r.house} | ${r.ai ? 'ja' : 'nei'} | ${lvl} | ${scale} | ${areaS} | ${rooms} | ${walls3d} | ${doors} | ${win} | ${sky} | ${stair} | ${roof} | ${facW} | ${q} | ${errs} |`);
  }
  return lines;
}

/** The done-means targets (hus1, hus2, hus3, hus5 with AI): scale within 2 %, rooms named, variants and skylights. */
export function doneMeans(results) {
  const out = [];
  for (const h of ['hus1', 'hus2', 'hus3', 'hus5']) {
    const r = results.find((x) => x.house === h && x.ai);
    if (!r) continue;
    for (const l of r.levels.filter((x) => x.built)) {
      const err = l.ppmErr ?? l.areaScaleErr;
      out.push({ house: h, level: l.name, what: 'skala innen 2 %', ok: err != null && Math.abs(err) <= 0.02, value: pct(err) });
      // every labelled room is a room of its own with its name – or, where the drawing has an open plan (OPEN_PLANS, in
      // the fasit's words), one room with the open area's labels in its name; a label sharing a room across a drawn wall
      // or door (the detection merged them) does not count
      const merges = l.rooms.rows.filter((x) => x.merged && !x.openPlan && x.how === 'navn').map((x) => x.label);
      const opens = l.rooms.rows.filter((x) => x.openPlan).map((x) => x.label);
      out.push({ house: h, level: l.name, what: 'rom med navn (eget rom, eller samlet navn i en åpen plan)', ok: l.rooms.named + (l.rooms.open ?? 0) === l.rooms.fasit, value: `${l.rooms.named} av ${l.rooms.fasit} i eget rom${opens.length ? `, ${opens.length} i åpen plan (${opens.join(' + ')})` : ''}${merges.length ? `, ${merges.length} slått sammen over en tegnet vegg, dør eller skillelinje (${merges.join(', ')})` : ''}` });
      // the variants and skylights against the fasit, also where it has none (a false sliding door counts)
      if (l.doorsTruth.double != null) out.push({ house: h, level: l.name, what: 'dobbeltdører', ok: l.doors.double === l.doorsTruth.double, value: `${l.doors.double} (fasit ${l.doorsTruth.double})` });
      if (l.doorsTruth.sliding != null) out.push({ house: h, level: l.name, what: 'skyvedører', ok: l.doors.sliding === l.doorsTruth.sliding, value: `${l.doors.sliding} (fasit ${l.doorsTruth.sliding})` });
      if (l.skylightsTruth != null) out.push({ house: h, level: l.name, what: 'takvinduer', ok: l.skylights === l.skylightsTruth, value: `${l.skylights} (fasit ${l.skylightsTruth})` });
    }
  }
  return out;
}

function markdown(results) {
  const lines = [];
  lines.push('_Generert av `node tools/planbygger-measure-all.mjs --write`: «Generer» på alle husene, med de lagrede KI-svarene (Haiku) og uten KI, mot `plantegninger/<hus>/fasit.json`._');
  lines.push('');
  lines.push('Kolonnene: per etasje skilt med «·». Skala: px/m og feilen mot fasitens px/m (– der fasiten ikke har noen, og på fotoet, som rettes opp til et annet rutenett), og metoden. «Skala fra rommene»: medianen av generert areal / etikettareal over rommene som ble funnet, som skalafeil. Rom: funnet (en generert region for etiketten: etter navn, ellers areal innen 15 %), med navnet fra tegningen i et eget rom («+n åpen»: etiketter i ett rom med samlet navn der tegningen har en åpen plan uten noe tegnet mellom dem, slik fasiten sier; «+n delt»: etiketter som deler rom fordi gjenkjenningen slo dem sammen over en tegnet vegg, dør eller skillelinje), med riktig type (gang og entré godtas begge for rommet med inngangsdøra). Vegger / rom i 3D: veggene i etasjen og rommene eksporten lager. Dører: enkle/doble/skyve, fasiten i parentes. Trapp: bygd som rett eller U, typen tegningen viste, fasitens type i parentes, så stigningen og om spillerens figur går den opp og ned i 3D-huset (PlayerController med husets kollisjon; brattere enn 51,7° er en vegg for den). «Ingen» i et hus med to etasjer betyr at etasjene ikke henger sammen. Fasadevinduer: generert/fasit per fasade.');
  lines.push('');
  lines.push(...tableRows(results));
  lines.push('');
  // per house (with the recorded answers): what the validator still finds, and what generate itself noted
  const withAi = results.filter((r) => r.ai);
  if (withAi.length) {
    lines.push('**Per hus, med KI** (validatorens gjenstående feil, de første to, og det «Generer» selv noterte):');
    lines.push('');
    for (const r of withAi) {
      const parts = [];
      parts.push(`${(r.ms / 1000).toFixed(1).replace('.', ',')} s, ${r.aiAnswered} av ${r.aiCalls - (r.aiOff ?? 0)} KI-oppgaver hadde et opptak${r.aiOff ? ` (${r.aiOff} fasadeoppgaver sendes ikke)` : ''}`);
      if (r.errors) parts.push(`${r.errors} feil: ${r.errorList.slice(0, 2).map((e) => `«${e}»`).join('; ')}`);
      const notes = (r.notes || []).filter((n) => !/^Kontrollen fant/.test(n));
      if (notes.length) parts.push(notes.join(' '));
      lines.push(`- **${r.house}:** ${parts.join('. ')}`);
    }
    lines.push('');
  }
  const dm = doneMeans(results);
  if (dm.length) {
    lines.push('**«Ferdig betyr» (hus1, hus2, hus3 og hus5 med KI):**');
    lines.push('');
    lines.push('| Hus | Etasje | Mål | Resultat | |');
    lines.push('|---|---|---|---|---|');
    for (const d of dm) lines.push(`| ${d.house} | ${d.level} | ${d.what} | ${d.value} | ${d.ok ? '✓' : '✗'} |`);
    lines.push('');
  }
  return lines.join('\n');
}

function writeNotes(md) {
  const file = path.join(ROOT, 'notes/planbygger.md');
  let text = fs.readFileSync(file, 'utf8');
  const start = '<!-- hus:start -->';
  const end = '<!-- hus:slutt -->';
  if (!text.includes(start)) {
    // a new section at the end of the measurements part: after the v1 measurements' «Hva tallene betyr» list, before
    // «Begrensninger»
    const anchor = '\n## Begrensninger';
    const block = `\n## Runde 1: målinger per hus\n\n${start}\n${end}\n`;
    text = text.includes(anchor) ? text.replace(anchor, `${block}${anchor}`) : `${text.trimEnd()}\n${block}`;
  }
  const a = text.indexOf(start) + start.length;
  const b = text.indexOf(end);
  text = `${text.slice(0, a)}\n${md}\n${text.slice(b)}`;
  fs.writeFileSync(file, text);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };
  const only = opt('only', null)?.split(',');
  const mode = opt('mode', 'both');
  const houses = only ?? HOUSES;
  const model = parseModel(opt('model', null));
  if (args.includes('--record')) return recordMain(args, opt, houses, model);
  const results = [];
  // --from file: the numbers of an earlier --json run (only the table is made again)
  const from = opt('from', null);
  if (from) results.push(...JSON.parse(fs.readFileSync(path.resolve(from), 'utf8')));
  for (const h of from ? [] : houses) {
    for (const ai of mode === 'both' ? [true, false] : [mode === 'ai']) {
      process.stdout.write(`${h} ${ai ? 'med KI' : 'uten KI'} … `);
      try {
        const r = await measureHouse(h, { ai, model, facadeAi: args.includes('--facade-ai') || null });
        results.push(r);
        console.log(`${(r.ms / 1000).toFixed(1)} s, ${r.questions} spørsmål, ${r.errors ?? '?'} feil`);
      } catch (err) {
        console.log(`FEIL: ${err?.stack ?? err}`);
        results.push({ house: h, ai, crashed: String(err?.message ?? err), levels: [], stairs: [], facRows: [], qByKind: {}, questions: 0 });
      }
    }
  }
  const ok = results.filter((r) => !r.crashed);
  const md = markdown(ok);
  console.log(`\n${md}`);
  for (const r of results.filter((x) => x.crashed)) console.log(`\n${r.house} (${r.ai ? 'KI' : 'uten KI'}) krasjet: ${r.crashed}`);
  const jsonOut = opt('json', null);
  if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), `${JSON.stringify(results, null, 1)}\n`);
  if (args.includes('--write')) {
    writeNotes(md);
    console.log('\nnotes/planbygger.md oppdatert.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Record mode

/** --model haiku | sonnet | readPlan=sonnet,readFacade=haiku → what fixtureAi takes (null: the server's defaults). */
export function parseModel(spec) {
  if (!spec) return null;
  if (!spec.includes('=')) return spec;
  const out = {};
  for (const part of spec.split(',')) {
    const [task, m] = part.split('=').map((s) => s.trim());
    if (TASKS.includes(task) && m) out[task] = m;
  }
  return out;
}

/** The key without printing it: the environment, else (Windows) the user variable via PowerShell. */
function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

const usd = (v) => `$${(v ?? 0).toFixed(4)}`;

/** One task as a line: what it was answered with. */
function callLine(c) {
  const what = `${c.task} ${c.file ?? '?'}${c.part != null ? ` (del ${c.part + 1})` : ''}`;
  let how;
  if (c.recorded) how = c.cached ? `tatt opp fra hurtigbufferen (${shortModel(c.model)})` : `TATT OPP (${shortModel(c.model)}, ${usd(c.cost)})`;
  else if (c.wouldCall) how = `${c.fixture ? `foreldet (${c.why?.length ? c.why.join(', ') : `et opptak av ${shortModel(c.model)}`})` : 'mangler'} → ${c.note}`;
  else if (c.fixture) how = `${c.fresh ? 'fersk' : `foreldet (${(c.why ?? []).join(', ')})`} (${shortModel(c.model)})${c.note ? ` – ${c.note}` : ''}`;
  else how = c.note ?? 'intet opptak';
  return `    ${what.padEnd(46)} ${how}`;
}

async function recordMain(args, opt, houses, model) {
  const dry = args.includes('--dry');
  const refresh = !args.includes('--keep-stale');
  const budget = Math.max(0, Number(opt('budget', 0)) || 0);
  const key = dry ? null : apiKey();
  const models = modelsByTask(model);
  // --files a.png,b.avif / --tasks readPlan: record only those (the rest is replayed); a file may carry «#n» for part n
  const files = opt('files', null)?.split(',');
  const tasks = opt('tasks', null)?.split(',');
  const recordOnly = files || tasks ? (task, file, part) => (!tasks || tasks.includes(task)) && (!files || files.includes(file) || files.includes(`${file}#${(part ?? 0) + 1}`)) : null;
  console.log(`Opptak gjennom «Generer» (${PROMPT_VERSION}): ${TASKS.map((t) => `${t} ${shortModel(models[t])}`).join(', ')}; ${dry ? 'tørt (ingen kall)' : `budsjett ${budget} ekte kall${key ? '' : ', INGEN NØKKEL'}`}${refresh ? '' : ', foreldede beholdes'}`);
  if (!dry && !key) console.log('Ingen ANTHROPIC_API_KEY (miljøet eller Windows-brukervariabelen): bare det som finnes, spilles av.');
  const results = [];
  const used = new Set();
  let real = 0;
  let cost = 0;
  const rows = [];
  for (const h of houses) {
    const fx = fixtureAi({ house: h, model, record: dry ? 'dry' : true, refresh, budget: budget - real, apiKey: key, recordOnly, facadeAi: args.includes('--facade-ai') || null });
    process.stdout.write(`${h} … `);
    let r;
    try {
      r = await measureHouse(h, { ai: true, fixtures: fx });
      results.push(r);
      console.log(`${(r.ms / 1000).toFixed(1)} s, ${r.questions} spørsmål, ${r.errors ?? '?'} feil; ${fx.realCalls} ekte kall, ${usd(fx.cost)}`);
    } catch (err) {
      console.log(`FEIL: ${err?.stack ?? err}`);
      results.push({ house: h, ai: true, crashed: String(err?.message ?? err), levels: [], stairs: [], facRows: [], qByKind: {}, questions: 0 });
    }
    real += fx.realCalls;
    cost += fx.cost;
    for (const c of fx.calls) {
      console.log(callLine(c));
      if (c.fixture) used.add(path.resolve(ROOT, c.fixture));
      rows.push({ house: h, ...c });
    }
  }
  // the recordings of these houses that no task used, of the model each task asked for
  const unused = [];
  for (const h of houses) {
    const dir = path.join(FIXTURES, h);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/\.(classify|readPlan|readFacade)\.([\w.-]+)\.json$/);
      if (!m || models[m[1]] !== m[2]) continue;
      // readFacade is not asked while ai.js uses no part of it: its recordings stay (they are what that was measured on)
      if (m[1] === 'readFacade' && !args.includes('--facade-ai')) continue;
      const p = path.join(dir, f);
      if (!used.has(p)) unused.push(p);
    }
  }
  const by = {};
  for (const c of rows.filter((x) => x.recorded && !x.cached)) {
    const k = `${shortModel(c.model)} ${c.task}`;
    by[k] ??= { n: 0, cost: 0 };
    by[k].n++;
    by[k].cost += c.cost;
  }
  const n = (f) => rows.filter(f).length;
  console.log(`\n${rows.length} KI-oppgaver: ${n((c) => c.fixture && c.fresh && !c.recorded)} ferske opptak, ${n((c) => c.recorded && !c.cached)} tatt opp med ekte kall, ${n((c) => c.recorded && c.cached)} fra hurtigbufferen, ${n((c) => c.fixture && !c.fresh && !c.recorded)} foreldede spilt av, ${n((c) => !c.fixture && !c.off)} uten opptak${n((c) => c.off) ? `, ${n((c) => c.off)} sendes ikke (ai.js: readFacade av)` : ''}${dry ? `; tørt: ${n((c) => c.wouldCall)} ville blitt kalt` : ''}`);
  console.log(`Ekte kall i denne kjøringen: ${real}, ${usd(cost)}${Object.keys(by).length ? ` (${Object.entries(by).map(([k, v]) => `${k} ${v.n} for ${usd(v.cost)}`).join(', ')})` : ''}`);
  if (unused.length) {
    console.log(`\nOpptak som ingen oppgave brukte (${unused.length})${args.includes('--prune') ? ', slettet' : ' (--prune sletter dem)'}:`);
    for (const p of unused) {
      console.log(`    ${path.relative(ROOT, p).replace(/\\/g, '/')}`);
      if (args.includes('--prune')) fs.rmSync(p);
    }
  }
  const ok = results.filter((r) => !r.crashed);
  console.log(`\n${tableRows(ok).join('\n')}`);
  const jsonOut = opt('json', null);
  if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), `${JSON.stringify(results.map((r, i) => ({ ...r, aiCallsDetail: rows.filter((c) => c.house === r.house) })), null, 1)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  });
}
