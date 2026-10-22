/**
 * Planbygger: the heavy image work in a Web Worker, so a big plan (a 4000 × 3000 scan takes seconds) never freezes the
 * page.
 *
 *   post { id, kind: 'detect', img: { width, height, data }, opts: { pxPerM, … } }
 *        → { id, ok, result: { walls, openings, skylights, stairs, separators, stats } }
 *   post { id, kind: 'scale', img }                     → { id, ok, result: suggestScale(img) }
 *   post { id, kind: 'skew', img }                      → { id, ok, result: degrees (estimateSkew) }
 *   post { id, kind: 'rotate', img, opts: { deg } }     → { id, ok, result: rotateImage(img, deg) }
 *   post { id, kind: 'analyse', img }                   → { id, ok, result: { blocks, photo } }   the drawing stack's
 *        first look at an upload: splitSheet's blocks (plan / facade / section / text) and isPhoto
 *   post { id, kind: 'exec', name, args }               → { id, ok, result }   generate.js's executor (opts.exec): one
 *        of EXEC's functions with generate's own arguments. Results are cut down to plain data: a detection to the
 *        fields above (no debug rasters), autoScale without its rooms (they carry a function), rectifyPhoto without
 *        the image when nothing was straightened (generate uses its own then)
 *
 * The image arrays are copied by postMessage (structured clone); results with a fresh image transfer its buffer back.
 */
import { detectPlan, estimateSkew } from './detect.js';
import { suggestScale } from './scale.js';
import { rotateImage } from './image.js';
import { rectifyPhoto, isPhoto } from './photo.js';
import { splitSheet } from './sheet.js';
import { cleanForWalls } from './clean.js';
import { autoScale } from './autoscale.js';
import { readFacade } from './facade.js';
import { findStairs } from './align.js';

/** A detection as plain data: what the page and generate.js use, without the debug rasters. */
export function detectionData(r) {
  if (!r) return r;
  return { walls: r.walls ?? [], openings: r.openings ?? [], skylights: r.skylights ?? [], stairs: r.stairs ?? [], separators: r.separators ?? [], stats: r.stats ?? {} };
}

/** An image as plain data, with the marks a module put on it (cleanForWalls: cleanStats). */
const imageData = (img) => (img ? { width: img.width, height: img.height, data: img.data, ...(img.cleanStats ? { cleanStats: img.cleanStats } : {}) } : img);

/** generate.js's heavy steps: name → (args) → plain result. */
const EXEC = {
  rectifyPhoto: (img, opts) => {
    const r = rectifyPhoto(img, opts);
    return r?.applied ? { ...r, img: imageData(r.img) } : { ...r, img: null };
  },
  splitSheet: (img, opts) => {
    const r = splitSheet(img, opts);
    return { blocks: r?.blocks ?? [] };
  },
  cleanForWalls: (img, opts) => imageData(cleanForWalls(img, opts)),
  detectPlan: (img, opts) => detectionData(detectPlan(img, opts)),
  autoScale: (img, opts) => {
    const r = autoScale(img, opts);
    if (!r) return r;
    const { rooms, det, ...rest } = r;
    void rooms;
    return { ...rest, det: detectionData(det) };
  },
  readFacade: (img, opts) => {
    const r = readFacade(img, opts);
    if (r && r.debug) delete r.debug;
    return r;
  },
  findStairs: (img, opts) => findStairs(img, { ...(opts || {}), debug: null }),
};
export const EXEC_NAMES = Object.freeze(Object.keys(EXEC));

/** The transferable buffers of a result (a fresh image in it), so the copy back is free. */
function transfers(result, sent) {
  const out = [];
  const add = (img) => {
    const buf = img?.data?.buffer;
    if (buf && buf !== sent && !out.includes(buf)) out.push(buf);
  };
  add(result);
  add(result?.img);
  return out;
}

/** Runs one exec step as the worker does (also for Node tests: the result must survive a structured clone). */
export const runExec = (name, args) => {
  const fn = EXEC[name];
  if (!fn) throw new Error(`ukjent steg ${name}`);
  return fn(...(args || []));
};

// only in a worker (the page imports runExec as its fallback, the Node tests the whole module)
const inWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;
if (inWorker) self.onmessage = (e) => {
  const { id, kind, img, opts, name, args } = e.data || {};
  try {
    if (kind === 'detect') {
      self.postMessage({ id, ok: true, result: detectionData(detectPlan(img, opts)) });
    } else if (kind === 'scale') {
      self.postMessage({ id, ok: true, result: suggestScale(img) });
    } else if (kind === 'skew') {
      self.postMessage({ id, ok: true, result: estimateSkew(img) });
    } else if (kind === 'rotate') {
      const r = rotateImage(img, opts.deg);
      self.postMessage({ id, ok: true, result: r }, [r.data.buffer]);
    } else if (kind === 'analyse') {
      let blocks = [];
      try {
        blocks = splitSheet(img).blocks ?? [];
      } catch {
        blocks = [];
      }
      let photo = null;
      try {
        photo = isPhoto(img);
      } catch {
        photo = null;
      }
      self.postMessage({ id, ok: true, result: { blocks, photo } });
    } else if (kind === 'exec') {
      const result = runExec(name, args);
      const sent = args?.[0]?.data?.buffer;
      self.postMessage({ id, ok: true, result }, transfers(result, sent));
    } else throw new Error(`ukjent oppgave ${kind}`);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
