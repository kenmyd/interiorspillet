/**
 * Shared bits for tools/house-tests/*.test.mjs (not a test itself: tools/test-house.mjs only runs *.test.mjs).
 * Import it FIRST – it registers the JSON loader hook (like tools/test-design.mjs:16-31) before anything imports
 * src/data/*.json:
 *
 *   import { ROOT, imp, readJson, check, section, near, done } from './_lib.mjs';
 *   const { layout } = await imp('src/home/layout.js');
 *   section('Stua');
 *   check('volume', near(layout.volume, 138.57, 0.01), `got ${layout.volume}`);
 *   done();                       // prints "N passed, M failed" and exits 1 when something failed
 */
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.json')) {
      const text = fs.readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${text};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
export const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
export const near = (a, b, tol) => Math.abs(a - b) <= tol;

let passes = 0;
let failures = 0;
export const section = (name) => console.log(`\n— ${name}`);
export function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  → ${detail}` : ''}`);
  }
  return !!ok;
}
/** Prints the summary and exits (1 when a check failed). */
export function done() {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

/**
 * Faces facing the same way that overlap in one plane (they flicker) among the meshes under `root` (world space):
 * every triangle bucketed by facing + plane, then the overlap of each pair in a bucket. Glass (names /^glass:/,
 * double-sided) counts both ways. `skip(mesh)` leaves meshes out. Returns ['meshA / meshB (area mm², n, d)', …].
 * (The same check as tools/house-tests/vinduer.test.mjs, for any group.)
 */
export async function coplanarOverlaps(root, { skip = () => false, minArea = 1e-6 } = {}) {
  const THREE = await import('three');
  root.updateMatrixWorld(true);
  const tris = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  root.traverse((m) => {
    if (!m.isMesh || skip(m)) return;
    const p = m.geometry.attributes.position;
    const idx = m.geometry.index ? m.geometry.index.array : null;
    const n = idx ? idx.length : p.count;
    const glass = /^glass:/.test(m.name);
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, idx ? idx[i + k] : i + k).applyMatrix4(m.matrixWorld);
      const nrm = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      const a2 = nrm.length();
      if (a2 < 1e-10) continue;
      nrm.divideScalar(a2);
      tris.push({ mesh: m.name, glass, n: nrm, d: nrm.dot(v[0]), pts: v.map((x) => x.clone()) });
      if (glass) tris.push({ mesh: m.name, glass, n: nrm.clone().negate(), d: -nrm.dot(v[0]), pts: v.map((x) => x.clone()) });
    }
  });
  const key = (t) => `${Math.round(t.n.x * 1e3)},${Math.round(t.n.y * 1e3)},${Math.round(t.n.z * 1e3)}`;
  const buckets = new Map();
  for (const t of tris) {
    const k = `${key(t)}|${Math.round(t.d * 1e4)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)).push(t);
  }
  const to2 = (t, n) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    return t.pts.map((p) => (ax >= ay && ax >= az ? [p.y, p.z] : ay >= az ? [p.x, p.z] : [p.x, p.y]));
  };
  const area2 = (P) => {
    let s = 0;
    for (let i = 0; i < P.length; i++) s += P[i][0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * P[i][1];
    return s / 2;
  };
  const clip = (subject, clipper) => {
    let out = subject;
    const cw = area2(clipper) < 0;
    for (let i = 0; i < clipper.length && out.length; i++) {
      const a = clipper[i], b = clipper[(i + 1) % clipper.length];
      const side = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (cw ? -1 : 1);
      const inp = out;
      out = [];
      for (let j = 0; j < inp.length; j++) {
        const p = inp[j], q = inp[(j + 1) % inp.length];
        const sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if (sp * sq < 0) {
          const t = sp / (sp - sq);
          out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
    }
    return out;
  };
  const bad = [];
  const seen = new Set();
  for (const [k, list] of buckets) {
    const [nk, dk] = k.split('|');
    const nearL = [list, buckets.get(`${nk}|${Number(dk) + 1}`) || []];
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      const PA = to2(A, A.n);
      const bxA = [Math.min(...PA.map((p) => p[0])), Math.max(...PA.map((p) => p[0])), Math.min(...PA.map((p) => p[1])), Math.max(...PA.map((p) => p[1]))];
      for (const L2 of nearL) {
        for (let j = L2 === list ? i + 1 : 0; j < L2.length; j++) {
          const B = L2[j];
          if (Math.abs(A.d - B.d) > 1e-4) continue;
          if (A.glass && B.glass && A.mesh === B.mesh) continue;
          const PB = to2(B, A.n);
          if (Math.max(...PB.map((p) => p[0])) <= bxA[0] || Math.min(...PB.map((p) => p[0])) >= bxA[1] || Math.max(...PB.map((p) => p[1])) <= bxA[2] || Math.min(...PB.map((p) => p[1])) >= bxA[3]) continue;
          const c = clip(PA, PB);
          const ar = c.length >= 3 ? Math.abs(area2(c)) : 0;
          if (ar > minArea) {
            const pair = [A.mesh, B.mesh].sort().join(' / ');
            if (!seen.has(pair)) {
              seen.add(pair);
              bad.push(`${pair} (${(ar * 1e6).toFixed(0)} mm², n ${nk}, d ${A.d.toFixed(4)})`);
            }
          }
        }
      }
    }
  }
  return { bad, triangles: tris.length };
}
