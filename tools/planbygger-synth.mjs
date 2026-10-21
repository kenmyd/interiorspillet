/**
 * Planbygger: synthetic floor plans with a known answer, for the tests (tools/test-planbygger.mjs). Draws a plan in
 * the style of the test plans – black walls, doors as a white bar with a dashed quarter arc and the leaf, windows as
 * a light bar with lines in the wall, thin dimension lines with tick marks and «text» (small dark glyph blocks), grey
 * furniture – supersampled 3× for antialiased edges, optionally with noise and a grey paper.
 *
 *   renderPlan(plan, { pxPerM = 50, margin = 1.5, ss = 3, noise = 0, paper = 240, furniture = true, dims = true,
 *                      seed = 1 }) → { img: { width, height, data }, plan, origin: [px, px] }
 *   plan = { walls: [{ a: [x, y], b: [x, y], t }], openings: [{ wall: index, at, width, type, hinge, side }] }  (metres)
 *   samplePlans() → named test plans (a flat, an L-shaped house, a house with a long glass wall)
 */
const mulberry = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function renderPlan(plan, { pxPerM = 50, margin = 1.5, ss = 3, noise = 0, paper = 240, furniture = true, dims = true, seed = 1 } = {}) {
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
  for (const w of plan.walls) rect(w.a, w.b, w.t, 8, w.t / 2);
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
    if (o.type === 'door') {
      const hingeS = o.hinge === 'end' ? s1 : s0;
      const dir = o.hinge === 'end' ? -1 : 1;
      const r = o.width;
      const face = (o.side * w.t) / 2;
      let prev = null;
      for (let k = 0; k <= 60; k++) {
        const phi = (k / 60) * (Math.PI / 2);
        const p = P(hingeS + dir * r * Math.cos(phi), face + o.side * r * Math.sin(phi));
        if (prev && k % 2) line(prev, p, lw, 130);
        prev = p;
      }
      line(P(hingeS, face), P(hingeS, face + o.side * r), lw * 1.2, 110);
    }
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
