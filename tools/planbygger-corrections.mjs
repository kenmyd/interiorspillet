/**
 * Planbygger: the corrections a user makes in the editor after the automatic detection, for the two test plans –
 * written as editor actions (each entry of the returned list is one action in the UI: a room named in the Rom
 * dialog, a type chosen in the side panel, a door clicked in with the Dør tool, «Snu hengselen», «Snu slagretningen»,
 * a setting). tools/planbygger-measure.mjs measures the house before and after them.
 *
 * Targets are given in image pixels of the plan (stable against ids and the scale): plan metres = px / pxPerM.
 * What the owner knows from the house itself (the photos) and the plan does not show – the door to the grey storage
 * room, which way the hall door swings – is part of the corrections; what the night run decided from photos beyond
 * that (walls moved a few cm, the stairwell walls locked to the floor above, the sloping living-room ceiling, the
 * entrance 0,30 lower) is not, and stays a difference in the measurements.
 */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a) => {
  const l = Math.hypot(a[0], a[1]);
  return [a[0] / l, a[1] / l];
};

function toolkit(level, settings) {
  const ppm = level.image.pxPerM;
  const P = (px) => [px[0] / ppm, px[1] / ppm];
  const wallOf = (o) => level.walls.find((w) => w.id === o.wall);
  const centreOf = (o) => {
    const w = wallOf(o);
    const u = unit(sub(w.b, w.a));
    return [w.a[0] + u[0] * o.at, w.a[1] + u[1] * o.at];
  };
  const nearestOpening = (px) => {
    const p = P(px);
    return level.openings.map((o) => ({ o, d: dist(centreOf(o), p) })).sort((a, b) => a.d - b.d)[0]?.o ?? null;
  };
  const nearestWall = (px) => {
    const p = P(px);
    let best = null;
    for (const w of level.walls) {
      const d = sub(w.b, w.a);
      const L = Math.hypot(d[0], d[1]);
      const t = Math.max(0, Math.min(1, dot(sub(p, w.a), d) / (L * L)));
      const q = [w.a[0] + d[0] * t, w.a[1] + d[1] * t];
      const e = dist(p, q);
      if (!best || e < best.e) best = { w, s: t * L, e };
    }
    return best;
  };
  /** Hinge end and swing side so the leaf hangs at `hingePx` and swings toward `swingDir` (image directions). */
  const orient = (o, hingePx, swingDir) => {
    const w = wallOf(o);
    const u = unit(sub(w.b, w.a));
    const n = [-u[1], u[0]];
    const start = [w.a[0] + u[0] * (o.at - o.width / 2), w.a[1] + u[1] * (o.at - o.width / 2)];
    const end = [w.a[0] + u[0] * (o.at + o.width / 2), w.a[1] + u[1] * (o.at + o.width / 2)];
    const h = P(hingePx);
    const hinge = dist(h, start) <= dist(h, end) ? 'start' : 'end';
    const side = dot(n, swingDir) >= 0 ? 1 : -1;
    const flips = [];
    if ((o.hinge ?? 'start') !== hinge) flips.push('snu hengselen');
    if ((o.side ?? 1) !== side) flips.push('snu slagretningen');
    o.hinge = hinge;
    o.side = side;
    return flips;
  };
  const name = (px, nm, kind) => {
    level.rooms.push({ id: `r-${level.rooms.length + 1}`, name: nm, kind, seed: P(px) });
    return `rommet «${nm}» (${kind})`;
  };
  return { P, nearestOpening, nearestWall, orient, name, settings };
}

export const CORRECTIONS = {
  /** 1. etasje (plantegning.png). */
  hoved(doc, L = doc.levels[0]) {
    const T = toolkit(L, doc.settings);
    const edits = [];
    edits.push(T.name([150, 110], 'Bad', 'bathroom'));
    edits.push(T.name([170, 220], 'Gang', 'hall'));
    edits.push(T.name([170, 380], 'Soverom', 'bedroom'));
    edits.push(T.name([330, 500], 'Stue/kjøkken', 'living'));
    // the hall door is drawn like a window (two lines, no arc): an opening in an interior wall → a door, hung at its
    // north end, swinging into the hall (225331)
    const dg = T.nearestOpening([252, 250]);
    if (dg && dg.type !== 'door') {
      dg.type = 'door';
      dg.hinge = 'start';
      dg.side = 1;
      edits.push('åpningen gang/stue → dør');
    }
    if (dg) for (const f of T.orient(dg, [256, 224], [-1, 0])) edits.push(`døra gang/stue: ${f}`);
    // the plan draws the exterior walls 16 cm; they are 30 cm (outward – no room changes)
    doc.settings.exteriorMin = 0.3;
    edits.push('yttervegg minst 0,30 m');
    return edits;
  },

  /** Kjeller (bilder_hus/plantegning_kjeller.png). */
  kjeller(doc, L = doc.levels[0]) {
    const T = toolkit(L, doc.settings);
    const edits = [];
    edits.push(T.name([175, 190], 'Bod', 'storage'));
    edits.push(T.name([360, 190], 'Bod (grå)', 'storage'));
    edits.push(T.name([620, 200], 'Bod under terrassen', 'storage'));
    edits.push(T.name([330, 330], 'Gang', 'hall'));
    edits.push(T.name([570, 380], 'Entré', 'entrance'));
    edits.push(T.name([200, 500], 'Vaskerom', 'laundry'));
    edits.push(T.name([200, 700], 'Soverom', 'bedroom'));
    edits.push(T.name([400, 600], 'Kjellerstue', 'living'));
    // the grey storage room's door is not in the plan (225635): the Dør tool on the wall gang / bod 2
    const hit = T.nearestWall([433, 266]);
    if (hit) {
      const o = { id: `o-bod2`, wall: hit.w.id, type: 'door', at: Math.round(hit.s * 1000) / 1000, width: 0.95, hinge: 'start', side: 1 };
      L.openings.push(o);
      edits.push('ny dør gang/bod (grå)');
      edits.push('bredde 0,95');
      for (const f of T.orient(o, [461, 266], [0, -1])) edits.push(`døra til boden: ${f}`);
    }
    return edits;
  },
};
