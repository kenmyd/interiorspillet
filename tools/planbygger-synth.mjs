/**
 * Planbygger: synthetic floor plans with a known answer, for the tests (tools/test-planbygger.mjs). Draws a plan in
 * the style of the test plans – black walls, doors as a white bar with a dashed quarter arc and the leaf, windows as
 * a light bar with lines in the wall, thin dimension lines with tick marks and «text» (small dark glyph blocks), grey
 * furniture – supersampled 3× for antialiased edges, optionally with noise and a grey paper.
 *
 *   renderPlan(plan, { pxPerM = 50, margin = 1.5, ss = 3, noise = 0, paper = 240, furniture = true, dims = true,
 *                      seed = 1, wallGrey = 8 }) → { img: { width, height, data }, plan, origin: [px, px] }
 *   plan = { walls: [{ a: [x, y], b: [x, y], t }], openings: [{ wall: index, at, width, type, hinge, side, variant? }],
 *            skylights?: [{ x0, y0, x1, y1 }], stairs?: [{ rect, run, treads, kind }], extras?: { roofEdge, tiles,
 *            boards } }  (metres; variant 'double' | 'sliding' for doors; see variantPlans)
 *   samplePlans() → named test plans (a flat, an L-shaped house, a house with a long glass wall)
 *   variantPlans() → plans with double and sliding doors, skylights, stairs and things that are not walls
 */
const mulberry = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function renderPlan(plan, { pxPerM = 50, margin = 1.5, ss = 3, noise = 0, paper = 240, furniture = true, dims = true, seed = 1, wallGrey = 8 } = {}) {
  const rnd = mulberry(seed);
  const pts = plan.walls.flatMap((w) => [w.a, w.b]);
  const minX = Math.min(...pts.map((p) => p[0])) - margin;
  const minY = Math.min(...pts.map((p) => p[1])) - margin;
  const maxX = Math.max(...pts.map((p) => p[0])) + margin;
  const maxY = Math.max(...pts.map((p) => p[1])) + margin;
  const W = Math.ceil((maxX - minX) * pxPerM);
  const H = Math.ceil((maxY - minY) * pxPerM);
  const S = pxPerM * ss;
  const SW = W * ss;
  const SH = H * ss;
  const g = new Uint8Array(SW * SH).fill(paper);
  const X = (x) => (x - minX) * S;
  const Y = (y) => (y - minY) * S;
  const fillPoly = (poly, v) => {
    const P = poly.map((p) => [X(p[0]), Y(p[1])]);
    const y0 = Math.max(0, Math.floor(Math.min(...P.map((p) => p[1]))));
    const y1 = Math.min(SH - 1, Math.ceil(Math.max(...P.map((p) => p[1]))));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[i];
        const b = P[j];
        if (a[1] > yc !== b[1] > yc) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(SW - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) g[y * SW + x] = v;
      }
    }
  };
  const rect = (a, b, t, v, ext = 0) => {
    const d = [b[0] - a[0], b[1] - a[1]];
    const L = Math.hypot(d[0], d[1]);
    const u = [d[0] / L, d[1] / L];
    const n = [-u[1], u[0]];
    const h = t / 2;
    const A = [a[0] - u[0] * ext, a[1] - u[1] * ext];
    const B = [b[0] + u[0] * ext, b[1] + u[1] * ext];
    fillPoly([[A[0] + n[0] * h, A[1] + n[1] * h], [B[0] + n[0] * h, B[1] + n[1] * h], [B[0] - n[0] * h, B[1] - n[1] * h], [A[0] - n[0] * h, A[1] - n[1] * h]], v);
  };
  const line = (a, b, wPx, v, dash = 0) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(L * S));
    for (let k = 0; k <= steps; k++) {
      if (dash && Math.floor((k / S) * pxPerM / dash) % 2) continue;
      const x = X(a[0] + ((b[0] - a[0]) * k) / steps);
      const y = Y(a[1] + ((b[1] - a[1]) * k) / steps);
      const r = (wPx * ss) / 2;
      for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
        for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
          if (xx < 0 || yy < 0 || xx >= SW || yy >= SH) continue;
          if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r) g[yy * SW + xx] = Math.min(g[yy * SW + xx], v);
        }
      }
    }
  };
  // ---- furniture (grey blocks inside the rooms) under everything
  if (furniture) {
    for (let k = 0; k < 6; k++) {
      const cx = minX + margin + rnd() * (maxX - minX - 2 * margin);
      const cy = minY + margin + rnd() * (maxY - minY - 2 * margin);
      const w = 0.4 + rnd() * 1.2;
      const h = 0.4 + rnd() * 0.8;
      fillPoly([[cx, cy], [cx + w, cy], [cx + w, cy + h], [cx, cy + h]], 175 + Math.floor(rnd() * 40));
    }
  }
  // ---- walls (each end reaches half its thickness past the end point: closed corners)
  for (const w of plan.walls) rect(w.a, w.b, w.t, wallGrey, w.t / 2);
  // ---- openings
  for (const o of plan.openings) {
    const w = plan.walls[o.wall];
    const d = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
    const L = Math.hypot(d[0], d[1]);
    const u = [d[0] / L, d[1] / L];
    const n = [-u[1], u[0]];
    const P = (s, k = 0) => [w.a[0] + u[0] * s + n[0] * k, w.a[1] + u[1] * s + n[1] * k];
    const s0 = o.at - o.width / 2;
    const s1 = o.at + o.width / 2;
    rect(P(s0), P(s1), w.t + 2 / pxPerM, paper);
    // the light bar with its outline
    rect(P(s0), P(s1), w.t * 0.7, 252);
    const lw = Math.max(1, pxPerM / 50);
    for (const k of [-w.t * 0.35, w.t * 0.35]) line(P(s0, k), P(s1, k), lw, 120);
    line(P(s0, -w.t * 0.35), P(s0, w.t * 0.35), lw, 120);
    line(P(s1, -w.t * 0.35), P(s1, w.t * 0.35), lw, 120);
    if (o.type === 'window') line(P(s0), P(s1), lw, 110);
    // a hinged leaf: the dashed quarter arc and the open leaf
    const leafArc = (hingeS, dir, r) => {
      const face = (o.side * w.t) / 2;
      let prev = null;
      for (let k = 0; k <= 60; k++) {
        const phi = (k / 60) * (Math.PI / 2);
        const p = P(hingeS + dir * r * Math.cos(phi), face + o.side * r * Math.sin(phi));
        if (prev && k % 2) line(prev, p, lw, 130);
        prev = p;
      }
      line(P(hingeS, face), P(hingeS, face + o.side * r), lw * 1.2, 110);
    };
    if (o.type === 'door' && o.variant === 'double') {
      // two leaves from the jambs, each half the hole
      leafArc(s0, 1, o.width / 2);
      leafArc(s1, -1, o.width / 2);
    } else if (o.type === 'door' && o.variant === 'sliding') {
      // two leaves as dark bars off the centre line, one from each jamb, overlapping in the middle, and an arrow along
      // the wall beside it
      const bar = Math.max(1.5, 0.03 * pxPerM);
      line(P(s0, -w.t * 0.15), P(s0 + o.width * 0.55, -w.t * 0.15), bar, 60);
      line(P(s1 - o.width * 0.55, w.t * 0.15), P(s1, w.t * 0.15), bar, 60);
      const k = w.t / 2 + 0.15;
      line(P(o.at - o.width * 0.2, k), P(o.at + o.width * 0.2, k), lw, 90);
      line(P(o.at + o.width * 0.2, k), P(o.at + o.width * 0.2 - 0.06, k - 0.04), lw, 90);
      line(P(o.at + o.width * 0.2, k), P(o.at + o.width * 0.2 - 0.06, k + 0.04), lw, 90);
    } else if (o.type === 'door') {
      leafArc(o.hinge === 'end' ? s1 : s0, o.hinge === 'end' ? -1 : 1, o.width);
    }
  }
  // ---- symbols inside: skylights (dashed rectangles), stairs (outline, treads, winders, the walking line)
  const lwThin = Math.max(1, pxPerM / 50);
  const dashPx = 0.1 * pxPerM;
  for (const s of plan.skylights || []) {
    const c = [[s.x0, s.y0], [s.x1, s.y0], [s.x1, s.y1], [s.x0, s.y1]];
    for (let i = 0; i < 4; i++) line(c[i], c[(i + 1) % 4], lwThin * 1.3, 90, dashPx);
  }
  for (const st of plan.stairs || []) drawStair(st, line, lwThin);
  // ---- things that are not walls: a dashed roof edge around the house, a tile grid on a terrace outside, floor boards
  const ex = plan.extras || {};
  if (ex.roofEdge) {
    const e = ex.roofEdge;
    const c = [[minX + margin - e, minY + margin - e], [maxX - margin + e, minY + margin - e], [maxX - margin + e, maxY - margin + e], [minX + margin - e, maxY - margin + e]];
    for (let i = 0; i < 4; i++) line(c[i], c[(i + 1) % 4], lwThin * 1.5, 70, 0.15 * pxPerM);
  }
  for (const t of ex.tiles || []) {
    for (let x = t.x0; x <= t.x1 + 1e-9; x += t.size) line([x, t.y0], [x, t.y1], lwThin, 150);
    for (let y = t.y0; y <= t.y1 + 1e-9; y += t.size) line([t.x0, y], [t.x1, y], lwThin, 150);
  }
  for (const b of ex.boards || []) {
    for (let y = b.y0 + b.step / 2; y < b.y1; y += b.step) line([b.x0, y], [b.x1, y], lwThin, 170);
  }
  // ---- dimension lines with ticks and «text» outside the house and across the first room
  if (dims) {
    const lw = Math.max(1, pxPerM / 60);
    const yTop = minY + margin * 0.4;
    const x0 = minX + margin;
    const x1 = maxX - margin;
    line([x0, yTop], [x1, yTop], lw, 90);
    for (const x of [x0, x1]) line([x, yTop - 0.12], [x, yTop + 0.12], lw, 90);
    // text: a few glyph-like dark blocks on a white label
    const mid = (x0 + x1) / 2;
    fillPoly([[mid - 0.5, yTop - 0.15], [mid + 0.5, yTop - 0.15], [mid + 0.5, yTop + 0.15], [mid - 0.5, yTop + 0.15]], 250);
    for (let k = 0; k < 5; k++) {
      const gx = mid - 0.4 + k * 0.17;
      for (let s = 0; s < 3; s++) line([gx + rnd() * 0.08, yTop - 0.1 + rnd() * 0.06], [gx + rnd() * 0.08, yTop + 0.04 + rnd() * 0.06], lw * 1.4, 20);
    }
    const xl = minX + margin * 0.4;
    line([xl, minY + margin], [xl, maxY - margin], lw, 90);
  }
  // ---- downsample + noise
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let yy = 0; yy < ss; yy++) for (let xx = 0; xx < ss; xx++) s += g[(y * ss + yy) * SW + x * ss + xx];
      let v = s / (ss * ss);
      if (noise) v += (rnd() - 0.5) * 2 * noise;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, Math.round(v)));
      data[i + 3] = 255;
    }
  }
  return { img: { width: W, height: H, data }, plan, origin: [-minX * pxPerM, -minY * pxPerM], pxPerM };
}

/**
 * A stair symbol: the outline, evenly spaced treads and the walking line with its arrow. kind 'straight': one flight
 * over the rect, running along `run` ('x' | 'y'); kind 'quarter': an L – a flight down the left side (along y), a square
 * of winders in the top-left corner radiating from the inner corner, a flight along the top (along x).
 */
function drawStair(st, line, lw) {
  const [[x0, y0], [x1, y1]] = st.rect;
  const v = 100;
  const box = (a, b) => {
    line([a[0], a[1]], [b[0], a[1]], lw, v);
    line([b[0], a[1]], [b[0], b[1]], lw, v);
    line([b[0], b[1]], [a[0], b[1]], lw, v);
    line([a[0], b[1]], [a[0], a[1]], lw, v);
  };
  if (st.kind === 'quarter') {
    const w = st.width;
    box([x0, y0], [x1, y1]);
    // flight 1: down the left side (x0 … x0 + w), from y0 + w to y1
    const n1 = st.treads1;
    for (let k = 0; k <= n1; k++) {
      const y = y0 + w + ((y1 - y0 - w) * k) / n1;
      line([x0, y], [x0 + w, y], lw, v);
    }
    // flight 2: along the top (y0 … y0 + w), from x0 + w to x1
    const n2 = st.treads2;
    for (let k = 0; k <= n2; k++) {
      const x = x0 + w + ((x1 - x0 - w) * k) / n2;
      line([x, y0], [x, y0 + w], lw, v);
    }
    line([x0 + w, y0 + w], [x1, y0 + w], lw, v);
    line([x0 + w, y0 + w], [x0 + w, y1], lw, v);
    // winders: from the inner corner to the outer sides of the corner square
    const P = [x0 + w, y0 + w];
    for (let k = 1; k < st.winders + 1; k++) {
      const a = Math.PI + (Math.PI / 2) * (k / (st.winders + 1));
      const d = [Math.cos(a), Math.sin(a)];
      const t = Math.min(Math.abs(w / d[0]), Math.abs(w / d[1]));
      line(P, [P[0] + d[0] * t, P[1] + d[1] * t], lw, v);
    }
    return;
  }
  box([x0, y0], [x1, y1]);
  const n = st.treads;
  for (let k = 1; k < n; k++) {
    if (st.run === 'y') {
      const y = y0 + ((y1 - y0) * k) / n;
      line([x0, y], [x1, y], lw, v);
    } else {
      const x = x0 + ((x1 - x0) * k) / n;
      line([x, y0], [x, y1], lw, v);
    }
  }
  // the walking line and its arrow
  if (st.run === 'y') {
    const xm = (x0 + x1) / 2;
    line([xm, y0 + 0.1], [xm, y1 - 0.1], lw, 120);
    line([xm, y1 - 0.1], [xm - 0.06, y1 - 0.2], lw, 120);
    line([xm, y1 - 0.1], [xm + 0.06, y1 - 0.2], lw, 120);
  } else {
    const ym = (y0 + y1) / 2;
    line([x0 + 0.1, ym], [x1 - 0.1, ym], lw, 120);
    line([x1 - 0.1, ym], [x1 - 0.2, ym - 0.06], lw, 120);
    line([x1 - 0.1, ym], [x1 - 0.2, ym + 0.06], lw, 120);
  }
}

/**
 * Plans with the round 1 symbols and a known answer (metres): double and sliding doors, skylights, a straight stair
 * and a quarter-turn stair with winders, and things that must not become walls (a dashed roof edge, a tile grid on a
 * terrace, floor boards). Kept apart from samplePlans (their doors are all single).
 */
export function variantPlans() {
  const ext = 0.25;
  const int = 0.1;
  return {
    // 12 × 8 m: a living room (west), a hall with a straight stair (middle), a bedroom (north-east) and a bathroom
    // (south-east); double doors hall → living room and to the terrace, a sliding door living room → bedroom
    varianter: {
      walls: [
        { a: [0, 0], b: [12, 0], t: ext },
        { a: [12, 0], b: [12, 8], t: ext },
        { a: [12, 8], b: [0, 8], t: ext },
        { a: [0, 8], b: [0, 0], t: ext },
        { a: [5, 0], b: [5, 8], t: int },
        { a: [8, 0], b: [8, 8], t: int },
        { a: [8, 4.5], b: [12, 4.5], t: int },
      ],
      openings: [
        { wall: 4, at: 5.6, width: 1.6, type: 'door', variant: 'double', hinge: 'start', side: 1 },
        { wall: 2, at: 9.5, width: 1.8, type: 'door', variant: 'double', hinge: 'start', side: -1 },
        { wall: 5, at: 2.4, width: 1.4, type: 'door', variant: 'sliding', hinge: 'start', side: 1 },
        { wall: 6, at: 1.3, width: 0.9, type: 'door', hinge: 'start', side: 1 },
        { wall: 0, at: 2.5, width: 1.6, type: 'window' },
        { wall: 0, at: 10, width: 1.2, type: 'window' },
        { wall: 1, at: 6.2, width: 1.0, type: 'window' },
        { wall: 3, at: 4.0, width: 1.6, type: 'window' },
        { wall: 0, at: 6.5, width: 0.9, type: 'door', hinge: 'start', side: -1 },
      ],
      skylights: [
        { x0: 9.3, y0: 1.0, x1: 10.08, y1: 2.18 },
        { x0: 1.6, y0: 5.4, x1: 2.38, y1: 6.58 },
      ],
      stairs: [{ rect: [[5.6, 4.2], [6.6, 7.2]], run: 'y', treads: 12, kind: 'straight' }],
      extras: {
        roofEdge: 0.5,
        tiles: [{ x0: 4.2, y0: 8.6, x1: 10.6, y1: 10.4, size: 0.4 }],
        boards: [{ x0: 8.1, y0: 0.15, x1: 11.85, y1: 4.4, step: 0.12 }],
      },
    },
    // 9 × 7 m: a quarter-turn stair with winders in the north-west corner of a hall, a single door
    kvarttrapp: {
      walls: [
        { a: [0, 0], b: [9, 0], t: ext },
        { a: [9, 0], b: [9, 7], t: ext },
        { a: [9, 7], b: [0, 7], t: ext },
        { a: [0, 7], b: [0, 0], t: ext },
        { a: [5, 0], b: [5, 7], t: int },
      ],
      openings: [
        { wall: 4, at: 5.5, width: 0.9, type: 'door', hinge: 'start', side: 1 },
        { wall: 0, at: 7.0, width: 1.4, type: 'window' },
        { wall: 2, at: 2.5, width: 1.4, type: 'window' },
      ],
      skylights: [],
      stairs: [{ rect: [[0.3, 0.3], [2.6, 3.4]], kind: 'quarter', width: 0.9, treads1: 6, treads2: 5, winders: 5 }],
    },
  };
}

/** Test plans (metres; walls as centre lines). */
export function samplePlans() {
  const ext = 0.25;
  const int = 0.1;
  return {
    // a flat: 9 × 7 m, three rooms and a hall
    leilighet: {
      walls: [
        { a: [0, 0], b: [9, 0], t: ext },
        { a: [9, 0], b: [9, 7], t: ext },
        { a: [9, 7], b: [0, 7], t: ext },
        { a: [0, 7], b: [0, 0], t: ext },
        { a: [4, 0], b: [4, 7], t: int },
        { a: [0, 3.5], b: [4, 3.5], t: int },
        { a: [4, 4.2], b: [9, 4.2], t: int },
      ],
      openings: [
        { wall: 4, at: 1.8, width: 0.9, type: 'door', hinge: 'start', side: 1 },
        { wall: 4, at: 5.6, width: 0.9, type: 'door', hinge: 'end', side: -1 },
        { wall: 6, at: 2.2, width: 0.9, type: 'door', hinge: 'start', side: -1 },
        { wall: 0, at: 2.0, width: 1.4, type: 'window' },
        { wall: 0, at: 6.5, width: 2.0, type: 'window' },
        { wall: 2, at: 2.5, width: 1.2, type: 'window' },
        { wall: 3, at: 5.2, width: 1.0, type: 'door', hinge: 'start', side: -1 },
        { wall: 1, at: 5.8, width: 1.6, type: 'window' },
      ],
    },
    // an L-shaped house with a T joint and a door next to a corner
    lhus: {
      walls: [
        { a: [0, 0], b: [10, 0], t: ext },
        { a: [10, 0], b: [10, 5], t: ext },
        { a: [10, 5], b: [5, 5], t: ext },
        { a: [5, 5], b: [5, 9], t: ext },
        { a: [5, 9], b: [0, 9], t: ext },
        { a: [0, 9], b: [0, 0], t: ext },
        { a: [5, 0], b: [5, 5], t: int },
        { a: [0, 5], b: [5, 5], t: int },
        { a: [2.5, 5], b: [2.5, 9], t: int },
      ],
      openings: [
        { wall: 6, at: 3.8, width: 0.9, type: 'door', hinge: 'end', side: 1 },
        { wall: 7, at: 1.2, width: 0.9, type: 'door', hinge: 'start', side: 1 },
        { wall: 7, at: 3.8, width: 0.9, type: 'door', hinge: 'end', side: 1 },
        { wall: 0, at: 7.5, width: 1.8, type: 'window' },
        { wall: 4, at: 1.2, width: 1.0, type: 'window' },
        { wall: 4, at: 3.8, width: 1.0, type: 'window' },
        { wall: 1, at: 2.5, width: 1.0, type: 'door', hinge: 'start', side: -1 },
      ],
    },
    // a glass wall: three windows and a door in a row with short posts between them
    glassvegg: {
      walls: [
        { a: [0, 0], b: [8, 0], t: ext },
        { a: [8, 0], b: [8, 6], t: ext },
        { a: [8, 6], b: [0, 6], t: ext },
        { a: [0, 6], b: [0, 0], t: ext },
        { a: [3, 0], b: [3, 6], t: int },
      ],
      openings: [
        { wall: 1, at: 1.2, width: 2.0, type: 'window' },
        { wall: 1, at: 2.95, width: 0.9, type: 'door', hinge: 'end', side: -1 },
        { wall: 1, at: 4.6, width: 2.0, type: 'window' },
        { wall: 4, at: 3.0, width: 0.9, type: 'door', hinge: 'start', side: 1 },
      ],
    },
  };
}
