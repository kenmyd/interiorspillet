/**
 * Planbygger: the detection in a Web Worker, so a big plan (a 4000 × 3000 scan takes seconds) never freezes the page.
 *
 *   post { id, kind: 'detect', img: { width, height, data }, opts: { pxPerM, … } } → { id, ok, result: { walls, openings, stats } }
 *   post { id, kind: 'scale', img }                                                → { id, ok, result: suggestScale(img) }
 */
import { detectPlan } from './detect.js';
import { suggestScale } from './scale.js';

self.onmessage = (e) => {
  const { id, kind, img, opts } = e.data || {};
  try {
    if (kind === 'detect') {
      const r = detectPlan(img, opts);
      self.postMessage({ id, ok: true, result: { walls: r.walls, openings: r.openings, stats: r.stats } });
    } else if (kind === 'scale') {
      self.postMessage({ id, ok: true, result: suggestScale(img) });
    } else throw new Error(`ukjent oppgave ${kind}`);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
