/**
 * Planbygger: the 2D correction editor – a canvas over the uploaded plan where the proposed walls, doors and windows are
 * moved, added and deleted and the rooms named. This is the part of the product that makes an automatic proposal into
 * a correct house: the detection is never perfect, so every correction must be a click or a drag.
 *
 *   const ed = new Editor(canvas, app)    app: { doc, level, image (ImageBitmap|HTMLImageElement|null), snapshot(),
 *                                               changed(), select(sel), status(text), askRoom(room) → Promise }
 *   ed.setTool('select'|'wall'|'door'|'window'|'opening'|'room'|'scale'|'pan')
 *   ed.fit(); ed.render(); ed.refresh()   (rooms recomputed after a model change)
 *   ed.key(event) → true when handled
 *
 * Tools (the side bar; keys in brackets):
 *   Velg (V)     click: a door / window, a wall or a room; drag a wall: it moves across itself and the walls that meet
 *                it follow (Shift: free); drag a wall end: snaps to ends, centre lines and 45° steps; drag an opening:
 *                slides along its wall, its ends change the width; Delete removes; arrow keys nudge 1 cm (Shift 10 cm)
 *   Vegg (W)     click – click – click …: a chain of walls (Esc / double click / right click ends it), snapping as above
 *   Dør (D), Vindu (F), Åpning (O)   click on a wall
 *   Rom (R)      click in a room: name, type, ceiling height
 *   Skala (S)    two clicks with a known distance between them, or one click on a dimension line (it snaps to its ends)
 *   Flytt (H / space / middle or right mouse button)   pan; the wheel zooms
 */
import { sub, add, mul, dot, dist, unit, perp, projectToSegment, round } from './geom.js';
import { wallBand, endExtensions } from './regions.js';
import { labelRooms } from './export.js';
import { wallLength, wallDir, wallPoint, openingsOf, moveWall, moveWallEnd, addWall, deleteWall, addOpening, deleteOpening } from './model.js';

const KIND_FILL = {
  living: 'rgba(255, 196, 96, 0.22)',
  bedroom: 'rgba(120, 170, 255, 0.2)',
  bathroom: 'rgba(90, 210, 200, 0.24)',
  hall: 'rgba(200, 200, 200, 0.28)',
  laundry: 'rgba(130, 220, 160, 0.24)',
  storage: 'rgba(170, 150, 130, 0.26)',
  entrance: 'rgba(230, 150, 200, 0.22)',
};
const ACCENT = '#f39c12';
const SNAP_PX = 10;

export class Editor {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.view = { k: 60, ox: 40, oy: 40 };
    this.tool = 'select';
    this.sel = null; // { kind: 'wall'|'opening'|'room', id }
    this.hover = null;
    this.drag = null;
    this.chain = null; // the wall tool's last point
    this.cursor = null; // plan point under the mouse
    this.snapMark = null;
    this.preview = null; // opening preview { wall, at }
    this.scaleLine = null; // { a, b } image pixels
    this.rooms = null;
    this.showImage = true;
    this.imageOpacity = 0.55;
    this.showRooms = true;
    this.showDims = true;
    this.ghost = null; // walls of another level (plan metres, already offset into this level's frame)
    this._dirty = true;
    this._bind();
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(canvas);
    this._ro = ro;
    this._resize();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Frame

  get level() {
    return this.app.level;
  }
  /** Image pixels per plan metre for drawing (before the scale is set: a provisional 100). */
  get ppm() {
    return this.level?.image?.pxPerM || 100;
  }
  toScreen(p) {
    return [this.view.ox + p[0] * this.view.k, this.view.oy + p[1] * this.view.k];
  }
  toPlan(s) {
    return [(s[0] - this.view.ox) / this.view.k, (s[1] - this.view.oy) / this.view.k];
  }
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.render();
  }

  /** Zoom and centre on the plan (the image, or the walls). */
  fit() {
    const r = this.canvas.getBoundingClientRect();
    let w = 10;
    let h = 10;
    let x0 = 0;
    let y0 = 0;
    const img = this.level?.image;
    if (img?.width) {
      w = img.width / this.ppm;
      h = img.height / this.ppm;
    } else if (this.level?.walls.length) {
      const pts = this.level.walls.flatMap((x) => [x.a, x.b]);
      x0 = Math.min(...pts.map((p) => p[0])) - 1;
      y0 = Math.min(...pts.map((p) => p[1])) - 1;
      w = Math.max(...pts.map((p) => p[0])) + 1 - x0;
      h = Math.max(...pts.map((p) => p[1])) + 1 - y0;
    }
    const k = Math.min((r.width - 40) / w, (r.height - 40) / h);
    this.view.k = Math.max(5, k);
    this.view.ox = (r.width - w * this.view.k) / 2 - x0 * this.view.k;
    this.view.oy = (r.height - h * this.view.k) / 2 - y0 * this.view.k;
    this.render();
  }

  /** After a model change: rooms again, then draw. */
  refresh() {
    this.rooms = null;
    if (this.level?.walls.length) {
      try {
        this.rooms = labelRooms(this.level, this.app.doc.settings);
      } catch (err) {
        console.warn('[planbygger] romsøket feilet', err);
      }
    }
    if (this.sel && !this._selObject()) this.sel = null;
    this.render();
  }

  setTool(t) {
    this.tool = t;
    this.chain = null;
    this.preview = null;
    this.snapMark = null;
    if (t !== 'scale') this.scaleLine = this.scaleLine?.fixed ? this.scaleLine : null;
    this.canvas.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
    this.app.status?.(TOOL_HINT[t] ?? '');
    this.render();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Selection

  select(sel) {
    this.sel = sel;
    this.app.select?.(sel);
    this.render();
  }
  _selObject() {
    const s = this.sel;
    if (!s || !this.level) return null;
    if (s.kind === 'wall') return this.level.walls.find((w) => w.id === s.id) ?? null;
    if (s.kind === 'opening') return this.level.openings.find((o) => o.id === s.id) ?? null;
    if (s.kind === 'room') return this.rooms?.rooms[s.index] ?? null;
    return null;
  }

  /** Top-most thing under a plan point: an end handle of the selected wall, an opening, a wall, a room. */
  hit(p) {
    const L = this.level;
    if (!L) return null;
    const px = 1 / this.view.k; // one screen pixel in metres
    const sw = this.sel?.kind === 'wall' ? L.walls.find((w) => w.id === this.sel.id) : null;
    if (sw) {
      for (const end of ['a', 'b']) if (dist(p, sw[end]) <= 9 * px) return { kind: 'end', id: sw.id, end };
    }
    const so = this.sel?.kind === 'opening' ? L.openings.find((o) => o.id === this.sel.id) : null;
    if (so) {
      const w = L.walls.find((x) => x.id === so.wall);
      if (w) {
        for (const [edge, s] of [['from', so.at - so.width / 2], ['to', so.at + so.width / 2]]) {
          if (dist(p, wallPoint(w, s)) <= 8 * px) return { kind: 'oend', id: so.id, edge };
        }
      }
    }
    for (const o of L.openings) {
      const w = L.walls.find((x) => x.id === o.wall);
      if (!w) continue;
      const pr = projectToSegment(p, w.a, w.b);
      const s = pr.t * wallLength(w);
      if (pr.d <= w.t / 2 + 4 * px && Math.abs(s - o.at) <= o.width / 2) return { kind: 'opening', id: o.id };
    }
    let best = null;
    for (const w of L.walls) {
      const pr = projectToSegment(p, w.a, w.b);
      const tol = w.t / 2 + 3 * px;
      if (pr.d <= tol && (!best || pr.d < best.d)) best = { kind: 'wall', id: w.id, d: pr.d, s: pr.t * wallLength(w) };
    }
    if (best) return best;
    const idx = this.rooms?.found.at(p[0], p[1]) ?? -1;
    if (idx >= 0) return { kind: 'room', index: idx };
    return null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Snapping

  /**
   * Snaps a plan point: wall ends, then wall centre lines, then 45° steps from `from`, then 1 cm.
   * @returns {{ p: number[], mark: { p, kind } | null }}
   */
  snap(p, { from = null, exclude = null, free = false } = {}) {
    const L = this.level;
    const tol = SNAP_PX / this.view.k;
    if (!free && L) {
      let best = null;
      for (const w of L.walls) {
        if (w.id === exclude?.id) continue;
        for (const e of [w.a, w.b]) {
          const d = dist(p, e);
          if (d <= tol && (!best || d < best.d)) best = { d, p: [...e], kind: 'ende' };
        }
      }
      if (best) return { p: best.p, mark: best };
      // a centre line (a T joint), combined with the angle step when both are near
      for (const w of L.walls) {
        if (w.id === exclude?.id) continue;
        const pr = projectToSegment(p, w.a, w.b);
        if (pr.d <= tol * 0.8 && (!best || pr.d < best.d)) best = { d: pr.d, p: pr.point, kind: 'vegg', w };
      }
      if (best) {
        if (from) {
          const a = this._angleSnap(from, best.p);
          if (a) {
            // where the angle ray meets the wall line
            const u = unit(sub(a, from));
            const wu = unit(sub(best.w.b, best.w.a));
            const den = u[0] * wu[1] - u[1] * wu[0];
            if (Math.abs(den) > 1e-6) {
              const q = sub(best.w.a, from);
              const t = (q[0] * wu[1] - q[1] * wu[0]) / den;
              const x = add(from, mul(u, t));
              if (dist(x, best.p) <= tol) return { p: x, mark: { p: x, kind: 'vegg' } };
            }
          }
        }
        return { p: best.p, mark: best };
      }
    }
    if (from && !free) {
      const a = this._angleSnap(from, p);
      if (a) return { p: a, mark: null };
    }
    return { p: [round(p[0], 2), round(p[1], 2)], mark: null };
  }
  _angleSnap(from, p) {
    const d = sub(p, from);
    const len = Math.hypot(d[0], d[1]);
    if (len < 1e-6) return null;
    const ang = Math.atan2(d[1], d[0]);
    const step = Math.PI / 4;
    const k = Math.round(ang / step);
    if (Math.abs(ang - k * step) > (5 * Math.PI) / 180) return null;
    const L = round(len, 2);
    return [from[0] + Math.cos(k * step) * L, from[1] + Math.sin(k * step) * L];
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Input

  _bind() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const s = pos(e);
      const before = this.toPlan(s);
      const f = Math.pow(1.0015, -e.deltaY);
      this.view.k = Math.max(4, Math.min(2000, this.view.k * f));
      const after = this.toScreen(before);
      this.view.ox += s[0] - after[0];
      this.view.oy += s[1] - after[1];
      this.render();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const s = pos(e);
      const p = this.toPlan(s);
      const pan = e.button === 1 || e.button === 2 || this.tool === 'pan' || this._space;
      if (e.button === 2 && this.tool === 'wall' && this.chain) {
        this.chain = null;
        this.render();
        return;
      }
      if (pan) {
        this.drag = { kind: 'pan', s0: s, ox: this.view.ox, oy: this.view.oy, moved: false };
        c.style.cursor = 'grabbing';
        return;
      }
      if (e.button !== 0) return;
      this._down(p, s, e);
    });
    c.addEventListener('pointermove', (e) => {
      const s = pos(e);
      const p = this.toPlan(s);
      this.cursor = p;
      if (this.drag?.kind === 'pan') {
        this.view.ox = this.drag.ox + s[0] - this.drag.s0[0];
        this.view.oy = this.drag.oy + s[1] - this.drag.s0[1];
        this.drag.moved = true;
        this.render();
        return;
      }
      if (this.drag) this._dragMove(p, s, e);
      else this._hoverMove(p, e);
      this.app.status?.(`${round(p[0], 2).toFixed(2)} ; ${round(p[1], 2).toFixed(2)} m`, 'pos');
    });
    c.addEventListener('pointerup', (e) => {
      if (this.drag?.kind === 'pan') {
        const wasClick = !this.drag.moved;
        this.drag = null;
        this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair';
        if (wasClick && e.button === 0 && this.tool === 'select') this.select(null);
        return;
      }
      if (this.drag) this._dragEnd();
    });
    c.addEventListener('dblclick', () => {
      if (this.tool === 'wall') {
        this.chain = null;
        this.render();
      } else if (this.tool === 'select' && this.sel?.kind === 'room') this._nameRoom(this.sel.index);
    });
    c.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.preview = null;
      this.render();
    });
  }

  _down(p, s, e) {
    const L = this.level;
    if (!L) return;
    const t = this.tool;
    if (t === 'scale') {
      this._scaleClick(p);
      return;
    }
    if (t === 'wall') {
      const sp = this.snap(p, { from: this.chain, free: e.altKey }).p;
      if (!this.chain) {
        this.chain = sp;
      } else if (dist(sp, this.chain) > 0.05) {
        this.app.snapshot();
        addWall(L, this.chain, sp, this.app.wallThickness?.() ?? 0.1);
        this.app.changed('Ny vegg');
        this.chain = sp;
      }
      this.render();
      return;
    }
    if (t === 'door' || t === 'window' || t === 'opening') {
      const h = this._wallAt(p, 0.5);
      if (!h) {
        this.app.toast?.('Klikk på en vegg for å sette inn en åpning.');
        return;
      }
      this.app.snapshot();
      const o = addOpening(L, h.wall.id, h.s, t, this.app.doc.settings);
      if (o && t === 'door') {
        // swing into the side the click came from
        const k = dot(sub(p, wallPoint(h.wall, h.s)), perp(wallDir(h.wall)));
        o.side = k >= 0 ? 1 : -1;
      }
      this.app.changed(t === 'door' ? 'Ny dør' : t === 'window' ? 'Nytt vindu' : 'Ny åpning');
      this.select({ kind: 'opening', id: o.id });
      return;
    }
    if (t === 'room') {
      const idx = this.rooms?.found.at(p[0], p[1]) ?? -1;
      if (idx >= 0) {
        this.select({ kind: 'room', index: idx });
        this._nameRoom(idx);
      }
      return;
    }
    // select
    const h = this.hit(p);
    if (!h) {
      this.drag = { kind: 'pan', s0: s, ox: this.view.ox, oy: this.view.oy, moved: false };
      return;
    }
    if (h.kind === 'end') {
      this.drag = { kind: 'end', id: h.id, end: h.end, started: false, p0: p };
      return;
    }
    if (h.kind === 'oend') {
      this.drag = { kind: 'oend', id: h.id, edge: h.edge, started: false, p0: p };
      return;
    }
    if (h.kind === 'opening') {
      this.select({ kind: 'opening', id: h.id });
      this.drag = { kind: 'opening', id: h.id, started: false, p0: p };
      return;
    }
    if (h.kind === 'wall') {
      this.select({ kind: 'wall', id: h.id });
      const w = L.walls.find((x) => x.id === h.id);
      this.drag = { kind: 'wall', id: h.id, started: false, p0: p, a0: [...w.a], b0: [...w.b], snap: JSON.stringify(L.walls), free: e.shiftKey };
      return;
    }
    if (h.kind === 'room') {
      this.select({ kind: 'room', index: h.index });
    }
  }

  _dragMove(p, s, e) {
    const d = this.drag;
    const L = this.level;
    if (!d.started) {
      if (dist(p, d.p0) * this.view.k < 3) return;
      d.started = true;
      this.app.snapshot();
    }
    if (d.kind === 'end') {
      const w = L.walls.find((x) => x.id === d.id);
      const other = d.end === 'a' ? w.b : w.a;
      const sp = this.snap(p, { from: other, exclude: w, free: e.altKey });
      this.snapMark = sp.mark;
      moveWallEnd(L, d.id, d.end, sp.p);
    } else if (d.kind === 'wall') {
      // back to the walls as they were, then the whole move again (joined ends follow)
      const saved = JSON.parse(d.snap);
      for (const w of L.walls) {
        const o = saved.find((x) => x.id === w.id);
        if (o) {
          w.a = o.a;
          w.b = o.b;
        }
      }
      const w = L.walls.find((x) => x.id === d.id);
      let delta = sub(p, d.p0);
      if (!(d.free || e.shiftKey)) {
        const n = perp(unit(sub(w.b, w.a)));
        delta = mul(n, round(dot(delta, n), 3));
      }
      moveWall(L, d.id, delta);
    } else if (d.kind === 'opening' || d.kind === 'oend') {
      const o = L.openings.find((x) => x.id === d.id);
      const w = L.walls.find((x) => x.id === o.wall);
      const Lw = wallLength(w);
      const sAt = projectToSegment(p, w.a, w.b).t * Lw;
      if (d.kind === 'opening') {
        o.at = round(Math.max(o.width / 2, Math.min(Lw - o.width / 2, sAt)), 3);
      } else {
        const lo = o.at - o.width / 2;
        const hi = o.at + o.width / 2;
        let a = d.edge === 'from' ? Math.max(0, Math.min(sAt, hi - 0.2)) : lo;
        let b = d.edge === 'to' ? Math.min(Lw, Math.max(sAt, lo + 0.2)) : hi;
        a = round(a, 3);
        b = round(b, 3);
        o.at = round((a + b) / 2, 4);
        o.width = round(b - a, 4);
        if (o.leaf) o.leaf = Math.min(o.leaf, o.width);
      }
    }
    this.app.selectionChanged?.();
    this.render();
  }

  _dragEnd() {
    const d = this.drag;
    this.drag = null;
    this.snapMark = null;
    if (d.started) this.app.changed(d.kind === 'wall' ? 'Flyttet vegg' : d.kind === 'end' ? 'Flyttet veggende' : 'Flyttet åpning');
    this.render();
  }

  _hoverMove(p, e) {
    const t = this.tool;
    if (t === 'wall') {
      const sp = this.snap(p, { from: this.chain, free: e.altKey });
      this.snapMark = sp.mark;
      this.cursorSnap = sp.p;
    } else if (t === 'door' || t === 'window' || t === 'opening') {
      const h = this._wallAt(p, 0.5);
      this.preview = h ? { wall: h.wall, at: h.s, type: t, side: dot(sub(p, wallPoint(h.wall, h.s)), perp(wallDir(h.wall))) >= 0 ? 1 : -1 } : null;
    } else if (t === 'select') {
      const h = this.hit(p);
      const key = h ? `${h.kind}:${h.id ?? h.index}:${h.end ?? h.edge ?? ''}` : null;
      if (key !== this._hoverKey) {
        this._hoverKey = key;
        this.hover = h;
        this.canvas.style.cursor = !h ? 'default' : h.kind === 'end' || h.kind === 'oend' ? 'crosshair' : h.kind === 'room' ? 'pointer' : 'move';
      }
    } else if (t === 'scale') {
      this.cursorSnap = p;
    }
    this.render();
  }

  _wallAt(p, maxDist) {
    let best = null;
    for (const w of this.level.walls) {
      const pr = projectToSegment(p, w.a, w.b);
      if (pr.d <= Math.max(maxDist, w.t) && (!best || pr.d < best.d)) best = { wall: w, s: pr.t * wallLength(w), d: pr.d };
    }
    return best;
  }

  async _nameRoom(index) {
    const r = this.rooms?.rooms[index];
    if (!r) return;
    const res = await this.app.askRoom?.(r);
    if (!res) return;
    this.app.snapshot();
    const L = this.level;
    const existing = r.label ? L.rooms.find((x) => x.id === r.label.id) : null;
    const entry = existing ?? { id: `r${Date.now().toString(36)}`, seed: [round(r.region.inside[0], 3), round(r.region.inside[1], 3)] };
    entry.name = res.name;
    entry.kind = res.kind;
    if (res.ceiling) entry.ceiling = res.ceiling;
    else delete entry.ceiling;
    if (!existing) L.rooms.push(entry);
    this.app.changed('Navnga rom');
    this.select({ kind: 'room', index });
  }

  _scaleClick(p) {
    const ppm = this.ppm;
    const imgP = [p[0] * ppm, p[1] * ppm];
    const s = this.scaleLine;
    if (!s || s.b) {
      // one click on a dimension line snaps to its ends
      const traced = this.app.traceLine?.(imgP);
      if (traced) {
        this.scaleLine = { a: traced.a, b: traced.b, traced: true };
        this.app.scaleLineChanged?.(this.scaleLine);
      } else {
        this.scaleLine = { a: imgP, b: null };
      }
    } else {
      let b = imgP;
      // nearly horizontal / vertical: exactly
      const d = sub(b, s.a);
      if (Math.abs(d[1]) < Math.abs(d[0]) * 0.03) b = [b[0], s.a[1]];
      else if (Math.abs(d[0]) < Math.abs(d[1]) * 0.03) b = [s.a[0], b[1]];
      this.scaleLine = { a: s.a, b };
      this.app.scaleLineChanged?.(this.scaleLine);
    }
    this.render();
  }

  /** Keyboard (from the page): returns true when the key was used. */
  key(e) {
    const L = this.level;
    if (!L) return false;
    if (e.type === 'keyup') {
      if (e.code === 'Space') this._space = false;
      return false;
    }
    if (e.code === 'Space') {
      this._space = true;
      return true;
    }
    if (e.key === 'Escape') {
      if (this.chain) this.chain = null;
      else if (this.tool !== 'select') this.app.setTool?.('select');
      else this.select(null);
      this.render();
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) {
      this.deleteSelection();
      return true;
    }
    if (this.sel?.kind === 'wall' && e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 0.1 : 0.01;
      const v = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      this.app.snapshot();
      const w = L.walls.find((x) => x.id === this.sel.id);
      const n = perp(unit(sub(w.b, w.a)));
      moveWall(L, w.id, mul(n, dot(v, n)) );
      this.app.changed('Flyttet vegg');
      return true;
    }
    if (this.sel?.kind === 'opening') {
      const o = L.openings.find((x) => x.id === this.sel.id);
      if (o?.type === 'door' && (e.key === 'h' || e.key === 'H')) {
        this.app.snapshot();
        o.hinge = o.hinge === 'end' ? 'start' : 'end';
        this.app.changed('Snudde hengsel');
        return true;
      }
      if (o?.type === 'door' && (e.key === 'g' || e.key === 'G')) {
        this.app.snapshot();
        o.side = -(o.side || 1);
        this.app.changed('Snudde slagretning');
        return true;
      }
    }
    return false;
  }

  deleteSelection() {
    const L = this.level;
    const s = this.sel;
    if (!s) return;
    this.app.snapshot();
    if (s.kind === 'wall') deleteWall(L, s.id);
    else if (s.kind === 'opening') deleteOpening(L, s.id);
    else if (s.kind === 'room') {
      const r = this.rooms?.rooms[s.index];
      if (r?.label) L.rooms = L.rooms.filter((x) => x.id !== r.label.id);
    }
    this.sel = null;
    this.app.select?.(null);
    this.app.changed('Slettet');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Drawing

  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._draw();
    });
  }

  _draw() {
    const g = this.ctx;
    const dpr = this.dpr || 1;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#e9e7e2';
    g.fillRect(0, 0, W, H);
    const L = this.level;
    if (!L) return;
    const k = this.view.k;
    // ---- the plan image
    const img = this.app.image;
    if (img && this.showImage) {
      g.save();
      g.globalAlpha = this.imageOpacity;
      g.imageSmoothingEnabled = k / this.ppm < 2.5;
      const [x, y] = this.toScreen([0, 0]);
      g.drawImage(img, x, y, (img.width / this.ppm) * k, (img.height / this.ppm) * k);
      g.restore();
    }
    const scale = !!L.image?.pxPerM;
    if (!scale) {
      this._drawScaleLine(g);
      return;
    }
    // ---- another level, for alignment
    if (this.ghost?.length) {
      g.save();
      g.strokeStyle = 'rgba(40, 90, 200, 0.55)';
      g.setLineDash([6, 4]);
      g.lineWidth = 1.5;
      for (const w of this.ghost) this._polyPath(g, wallBand(w, this.ghost), true);
      g.restore();
    }
    // ---- rooms
    if (this.showRooms && this.rooms) {
      for (const r of this.rooms.rooms) {
        const P = r.region.polygon;
        g.beginPath();
        P.forEach((p, i) => {
          const [x, y] = this.toScreen(p);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.closePath();
        const sel = this.sel?.kind === 'room' && this.sel.index === r.region.index;
        g.fillStyle = sel ? 'rgba(243, 156, 18, 0.28)' : KIND_FILL[r.kind] ?? 'rgba(200,200,200,0.2)';
        g.fill();
      }
    }
    // ---- walls
    const walls = L.walls;
    for (const w of walls) {
      const band = wallBand(w, walls);
      const sel = this.sel?.kind === 'wall' && this.sel.id === w.id;
      const hov = this.hover?.kind === 'wall' && this.hover.id === w.id;
      g.beginPath();
      this._polyPath(g, band, false);
      g.fillStyle = sel ? 'rgba(243, 156, 18, 0.92)' : hov ? 'rgba(70, 70, 76, 0.92)' : w.exterior ? 'rgba(25, 27, 31, 0.9)' : 'rgba(45, 47, 53, 0.86)';
      g.fill();
    }
    // ---- openings
    for (const o of L.openings) this._drawOpening(g, o);
    if (this.preview) this._drawOpening(g, { id: '_preview', wall: this.preview.wall.id, type: this.preview.type, at: this.preview.at, width: this.preview.type === 'door' ? 0.9 : this.preview.type === 'window' ? 1.2 : 1.0, hinge: 'start', side: this.preview.side }, true);
    // ---- room names
    if (this.showRooms && this.rooms) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const r of this.rooms.rooms) {
        const [x, y] = this.toScreen(r.region.inside);
        const area = r.region.area;
        if (k * Math.sqrt(area) < 40) continue;
        g.font = `${r.auto ? 'italic ' : ''}600 ${Math.max(11, Math.min(16, k * 0.25))}px system-ui, sans-serif`;
        g.fillStyle = 'rgba(20, 24, 30, 0.92)';
        g.fillText(r.name + (r.auto ? ' ?' : ''), x, y - 8);
        g.font = `${Math.max(10, Math.min(13, k * 0.2))}px system-ui, sans-serif`;
        g.fillStyle = 'rgba(20, 24, 30, 0.7)';
        g.fillText(`${area.toFixed(2).replace('.', ',')} m²`, x, y + 9);
      }
    }
    // ---- the selected wall: ends and its length
    const sw = this.sel?.kind === 'wall' ? walls.find((w) => w.id === this.sel.id) : null;
    if (sw) {
      for (const e of [sw.a, sw.b]) {
        const [x, y] = this.toScreen(e);
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = ACCENT;
        g.stroke();
      }
      if (this.showDims) this._dimLabel(g, sw.a, sw.b, `${wallLength(sw).toFixed(2).replace('.', ',')} m · ${(sw.t * 100).toFixed(0)} cm`, sw.t / 2 + 14 / k);
    }
    const so = this.sel?.kind === 'opening' ? L.openings.find((o) => o.id === this.sel.id) : null;
    if (so) {
      const w = walls.find((x) => x.id === so.wall);
      if (w) {
        for (const s of [so.at - so.width / 2, so.at + so.width / 2]) {
          const [x, y] = this.toScreen(wallPoint(w, s));
          g.beginPath();
          g.arc(x, y, 5, 0, Math.PI * 2);
          g.fillStyle = '#fff';
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = ACCENT;
          g.stroke();
        }
        this._dimLabel(g, wallPoint(w, so.at - so.width / 2), wallPoint(w, so.at + so.width / 2), `${so.width.toFixed(2).replace('.', ',')} m`, -(w.t / 2 + 14 / k));
      }
    }
    // ---- the wall tool's rubber band
    if (this.tool === 'wall' && this.chain && this.cursorSnap) {
      g.save();
      g.strokeStyle = ACCENT;
      g.lineWidth = Math.max(2, (this.app.wallThickness?.() ?? 0.1) * k);
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(...this.toScreen(this.chain));
      g.lineTo(...this.toScreen(this.cursorSnap));
      g.stroke();
      g.restore();
      this._dimLabel(g, this.chain, this.cursorSnap, `${dist(this.chain, this.cursorSnap).toFixed(2).replace('.', ',')} m`, 16 / k);
    }
    if (this.snapMark) {
      const [x, y] = this.toScreen(this.snapMark.p);
      g.strokeStyle = '#1e8bff';
      g.lineWidth = 2;
      g.beginPath();
      if (this.snapMark.kind === 'ende') g.rect(x - 6, y - 6, 12, 12);
      else {
        g.moveTo(x - 7, y);
        g.lineTo(x + 7, y);
        g.moveTo(x, y - 7);
        g.lineTo(x, y + 7);
      }
      g.stroke();
    }
    if (this.tool === 'scale' || this.scaleLine?.fixed) this._drawScaleLine(g);
  }

  _polyPath(g, poly, stroke) {
    g.beginPath();
    poly.forEach((p, i) => {
      const [x, y] = this.toScreen(p);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.closePath();
    if (stroke) g.stroke();
  }

  _drawOpening(g, o, preview = false) {
    const L = this.level;
    const w = L.walls.find((x) => x.id === o.wall);
    if (!w) return;
    const k = this.view.k;
    const u = wallDir(w);
    const n = perp(u);
    const s0 = o.at - o.width / 2;
    const s1 = o.at + o.width / 2;
    const h = w.t / 2;
    const P = (s, off) => this.toScreen(add(add(w.a, mul(u, s)), mul(n, off)));
    const sel = !preview && this.sel?.kind === 'opening' && this.sel.id === o.id;
    const col = preview ? 'rgba(243,156,18,0.8)' : sel ? ACCENT : o.type === 'door' ? '#0f7a3a' : o.type === 'window' ? '#1561c7' : '#c0601a';
    // the hole: paper in the wall
    g.beginPath();
    for (const [s, off] of [[s0, -h], [s1, -h], [s1, h], [s0, h]]) g.lineTo(...P(s, off));
    g.closePath();
    g.fillStyle = preview ? 'rgba(255,255,255,0.6)' : '#fbfaf7';
    g.fill();
    g.lineWidth = sel ? 2.5 : 1.5;
    g.strokeStyle = col;
    g.stroke();
    if (o.type === 'window') {
      g.beginPath();
      g.moveTo(...P(s0, 0));
      g.lineTo(...P(s1, 0));
      g.moveTo(...P(s0, h * 0.45));
      g.lineTo(...P(s1, h * 0.45));
      g.moveTo(...P(s0, -h * 0.45));
      g.lineTo(...P(s1, -h * 0.45));
      g.lineWidth = 1.2;
      g.strokeStyle = col;
      g.stroke();
    } else if (o.type === 'door') {
      const hingeAt = o.hinge === 'end' ? s1 : s0;
      const dir = o.hinge === 'end' ? -1 : 1;
      const r = Math.min(o.leaf ?? o.width - 0.12, o.width);
      const side = o.side || 1;
      const face = side * h;
      g.beginPath();
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const phi = (i / steps) * (Math.PI / 2);
        const pt = P(hingeAt + dir * r * Math.cos(phi), face + side * r * Math.sin(phi));
        if (i) g.lineTo(...pt);
        else g.moveTo(...pt);
      }
      g.setLineDash([4, 3]);
      g.lineWidth = 1.3;
      g.strokeStyle = col;
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(...P(hingeAt, face));
      g.lineTo(...P(hingeAt, face + side * r));
      g.lineWidth = 2.2;
      g.stroke();
    } else {
      g.save();
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(...P(s0, -h));
      g.lineTo(...P(s1, h));
      g.moveTo(...P(s0, h));
      g.lineTo(...P(s1, -h));
      g.lineWidth = 1;
      g.strokeStyle = col;
      g.stroke();
      g.restore();
    }
    void k;
  }

  _dimLabel(g, a, b, text, off) {
    const u = unit(sub(b, a));
    const n = perp(u);
    const m = add(mul(add(a, b), 0.5), mul(n, off));
    const [x, y] = this.toScreen(m);
    g.font = '600 12px system-ui, sans-serif';
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(13, 20, 28, 0.88)';
    g.beginPath();
    g.roundRect?.(x - tw / 2 - 6, y - 10, tw + 12, 20, 5);
    if (!g.roundRect) g.rect(x - tw / 2 - 6, y - 10, tw + 12, 20);
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x, y + 0.5);
  }

  _drawScaleLine(g) {
    const s = this.scaleLine;
    if (!s?.a) return;
    const ppm = this.ppm;
    const A = this.toScreen([s.a[0] / ppm, s.a[1] / ppm]);
    const Bp = s.b ?? (this.cursorSnap ? [this.cursorSnap[0] * ppm, this.cursorSnap[1] * ppm] : null);
    g.save();
    g.strokeStyle = '#e8340c';
    g.fillStyle = '#e8340c';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(A[0], A[1], 4, 0, Math.PI * 2);
    g.fill();
    if (Bp) {
      const B = this.toScreen([Bp[0] / ppm, Bp[1] / ppm]);
      g.beginPath();
      g.moveTo(...A);
      g.lineTo(...B);
      g.stroke();
      g.beginPath();
      g.arc(B[0], B[1], 4, 0, Math.PI * 2);
      g.fill();
      const px = Math.hypot(Bp[0] - s.a[0], Bp[1] - s.a[1]);
      g.restore();
      this._dimLabel(g, [s.a[0] / ppm, s.a[1] / ppm], [Bp[0] / ppm, Bp[1] / ppm], `${px.toFixed(0)} px`, 18 / this.view.k);
      return;
    }
    g.restore();
  }

  dispose() {
    this._ro.disconnect();
  }
}

const TOOL_HINT = {
  select: 'Velg: klikk en vegg, dør eller et vindu. Dra en vegg for å flytte den (Shift: fritt), dra endene for å forlenge. Delete sletter.',
  wall: 'Ny vegg: klikk startpunkt og klikk videre for hver vegg. Esc eller dobbeltklikk avslutter. Alt: uten festing.',
  door: 'Dør: klikk på veggen der døra skal stå (på den siden den skal slå inn mot). H snur hengselen, G slagretningen.',
  window: 'Vindu: klikk på veggen der vinduet skal stå.',
  opening: 'Åpning: klikk på veggen der det skal være en åpning uten dør.',
  room: 'Rom: klikk i et rom for å gi det navn, type og takhøyde.',
  scale: 'Skala: klikk på en målelinje i planen (den festes til endene), eller klikk to punkter med kjent avstand.',
  pan: 'Flytt: dra for å flytte planen. Hjulet zoomer.',
};
export { TOOL_HINT, endExtensions };
