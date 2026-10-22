/**
 * Planbygger: the guide after «Generer» – one card per question generate.js could not answer itself
 * (questions.js), each with a crop of the drawing, the question, a filled-in answer, «Neste», «Tilbake» and «Hopp over
 * resten». Then the page goes straight into 3D.
 *
 *   const g = new Guide(el, { questions, imageFor, onDone, onNewFile })
 *     imageFor(crop) → { source: CanvasImageSource, width, height } | null   crop = question.crop: the level's image
 *                      (crop.level) or the uploaded file (crop.file)
 *     onDone({ answers, values, seen, skipped })   answers: what applyAnswers should get – the answers that differ
 *                      from their defaults, plus the rooms the customer saw and kept (their names are then confirmed);
 *                      values: every answer as it stood; seen: the ids of the cards shown; skipped: «Hopp over resten»
 *     onNewFile(question)   a photo question: «Velg et nytt bilde …» (the page replaces the file and generates again)
 *   g.index, g.values, g.next(), g.back(), g.skip()
 *
 * Text on the page is Norwegian.
 */
import { ROOM_KINDS } from './model.js';

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmtNum = (v) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000).replace('.', ',') : '');
const parseNum = (s) => {
  const v = parseFloat(String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const CONFIDENCE = { high: 'Sikker', medium: 'Ganske sikker', low: 'Usikker' };
const KIND_TITLE = {
  scale: 'Målestokk',
  bra: 'Målestokk',
  ceiling: 'Takhøyde',
  windows: 'Vinduer',
  room: 'Rom',
  stair: 'Trapp',
  order: 'Etasjene',
  alternative: 'Tegning',
  photo: 'Foto',
  shape: 'Foto',
  facade: 'Fasade',
};
const NAMES = ['Stue', 'Kjøkken', 'Stue/kjøkken', 'Spisestue', 'Soverom', 'Hovedsoverom', 'Barnerom', 'Bad', 'Toalett', 'Vaskerom', 'Gang', 'Entré', 'Bod', 'Kontor', 'Kjellerstue', 'Garderobe', 'Trapperom', 'Loftstue', 'Teknisk rom'];

export class Guide {
  constructor(el, { questions = [], imageFor = () => null, onDone = () => {}, onNewFile = null } = {}) {
    this.el = el;
    this.questions = questions;
    this.imageFor = imageFor;
    this.onDone = onDone;
    this.onNewFile = onNewFile;
    this.values = Object.fromEntries(questions.map((q) => [q.id, copy(q.default)]));
    this.seen = new Set();
    this.index = 0;
    this.finished = false;
    this._onKey = (e) => {
      if (this.finished || !this.el.isConnected) return;
      if (e.key === 'Enter' && e.target?.tagName !== 'SELECT' && e.target?.tagName !== 'BUTTON') {
        e.preventDefault();
        this.next();
      }
    };
    window.addEventListener('keydown', this._onKey);
    if (!questions.length) this._finish(false);
    else this.render();
  }

  get question() {
    return this.questions[this.index] ?? null;
  }

  /** Reads the card's input into values; false (with a message) when it does not parse. */
  _read() {
    const q = this.question;
    if (!q || !this._input) return true;
    const v = this._input.read();
    if (v === undefined) return false;
    this.values[q.id] = v;
    return true;
  }

  next() {
    if (this.finished) return;
    if (!this._read()) return;
    if (this.index >= this.questions.length - 1) this._finish(false);
    else {
      this.index++;
      this.render();
    }
  }
  back() {
    if (this.finished || this.index === 0) return;
    this._read();
    this.index--;
    this.render();
  }
  skip() {
    if (this.finished) return;
    this._read();
    this._finish(true);
  }

  _finish(skipped) {
    this.finished = true;
    window.removeEventListener('keydown', this._onKey);
    const answers = {};
    for (const q of this.questions) {
      const v = this.values[q.id];
      if (v == null || v === '') continue;
      if (!same(v, q.default) || (q.kind === 'room' && this.seen.has(q.id))) answers[q.id] = v;
    }
    this.onDone({ answers, values: { ...this.values }, seen: [...this.seen], skipped });
  }

  dispose() {
    this.finished = true;
    window.removeEventListener('keydown', this._onKey);
  }

  render() {
    const q = this.question;
    if (!q) return;
    this.seen.add(q.id);
    const n = this.questions.length;
    this._input = this._inputFor(q);
    const crop = this._cropCanvas(q);
    const conf = CONFIDENCE[q.confidence];
    const card = h('div', { class: 'pb-guide-card', 'data-question': q.id, 'data-kind': q.kind },
      h('div', { class: 'pb-guide-crop' }, crop ?? h('div', { class: 'pb-guide-nocrop' }, 'Ingen tegning å vise'), h('small', {}, q.crop?.file ?? q.file ?? '')),
      h('div', { class: 'pb-guide-main' },
        h('div', { class: 'pb-guide-count' }, h('span', {}, `Spørsmål ${this.index + 1} av ${n}`), h('span', { class: 'pb-guide-kind' }, KIND_TITLE[q.kind] ?? ''), conf ? h('span', { class: `pb-guide-conf is-${q.confidence}` }, conf) : null),
        h('h2', {}, q.text),
        q.help ? h('p', { class: 'pb-note' }, q.help) : null,
        h('div', { class: 'pb-guide-input' }, this._input.el),
        h('div', { class: 'pb-guide-dots', 'aria-hidden': 'true' }, this.questions.map((x, i) => h('span', { class: i === this.index ? 'is-on' : i < this.index ? 'is-done' : '' }))),
        h('div', { class: 'pb-guide-actions' },
          h('button', { class: 'pb-btn', disabled: this.index === 0, onclick: () => this.back() }, 'Tilbake'),
          h('span', { class: 'pb-guide-gap' }),
          h('button', { class: 'pb-btn', title: 'Bruk de ferdig utfylte svarene på resten og gå rett til 3D', onclick: () => this.skip() }, 'Hopp over resten'),
          h('button', { class: 'pb-btn is-primary pb-guide-next', onclick: () => this.next() }, this.index === n - 1 ? 'Neste – vis huset' : 'Neste'))));
    this.el.innerHTML = '';
    this.el.append(h('div', { class: 'pb-guide' }, card));
    setTimeout(() => this._input?.focus?.(), 0);
  }

  // ---- the inputs per question.input; read() → the value, or undefined when it does not parse

  _inputFor(q) {
    const v = this.values[q.id];
    const err = h('div', { class: 'pb-guide-err', hidden: true });
    const fail = (text) => {
      err.textContent = text;
      err.hidden = false;
      return undefined;
    };
    const number = (value, unit, label = null) => {
      const input = h('input', { type: 'text', inputmode: 'decimal', value: fmtNum(value), 'aria-label': label ?? q.text });
      return { input, el: h('label', { class: 'pb-guide-num' }, label ? h('span', {}, label) : null, input, unit ? h('span', { class: 'pb-unit' }, unit) : null) };
    };
    switch (q.input) {
      case 'number': {
        const f = number(v, q.unit);
        return {
          el: h('div', {}, f.el, err),
          focus: () => f.input.select(),
          read: () => {
            if (!f.input.value.trim()) return null;
            const x = parseNum(f.input.value);
            if (x == null || x <= 0) return fail('Skriv et tall, for eksempel 2,4.');
            return x;
          },
        };
      }
      case 'window': {
        const s = number(v?.sill, 'm', 'Brystning');
        const t = number(v?.height, 'm', 'Høyde');
        return {
          el: h('div', { class: 'pb-guide-pair' }, s.el, t.el, err),
          focus: () => s.input.select(),
          read: () => {
            const sill = parseNum(s.input.value);
            const height = parseNum(t.input.value);
            if (sill == null || sill < 0 || height == null || height <= 0) return fail('Skriv brystning og høyde i meter.');
            return { sill, height };
          },
        };
      }
      case 'text': {
        const input = h('input', { type: 'text', value: v ?? '', 'aria-label': q.text });
        return { el: h('div', {}, input), focus: () => input.select(), read: () => input.value.trim() || null };
      }
      case 'room': {
        const name = h('input', { type: 'text', value: v?.name ?? '', list: 'pb-guide-names', 'aria-label': 'Navn på rommet' });
        const kinds = q.options?.length ? q.options : ROOM_KINDS.map(([value, label]) => ({ value, label }));
        const kind = h('select', { 'aria-label': 'Romtype' }, kinds.map((o) => h('option', { value: o.value, selected: o.value === v?.kind }, o.label)));
        return {
          el: h('div', { class: 'pb-guide-pair' },
            h('label', { class: 'pb-guide-num' }, h('span', {}, 'Navn'), name),
            h('label', { class: 'pb-guide-num' }, h('span', {}, 'Type'), kind),
            h('datalist', { id: 'pb-guide-names' }, NAMES.map((x) => h('option', { value: x })))),
          focus: () => name.select(),
          read: () => ({ name: name.value.trim() || v?.name || '', kind: kind.value }),
        };
      }
      case 'choice': {
        let cur = v;
        const opts = q.options ?? [];
        const btns = opts.map((o) => h('button', { class: `pb-guide-opt${o.value === cur ? ' is-on' : ''}`, role: 'radio', 'aria-checked': String(o.value === cur), 'data-value': String(o.value), onclick: () => {
          cur = o.value;
          for (const b of btns) {
            const on = b.dataset.value === String(cur);
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-checked', String(on));
          }
          if (q.kind === 'shape' && cur === 'new' && this.onNewFile) this.onNewFile(q);
        } }, o.label));
        return { el: h('div', { class: 'pb-guide-opts', role: 'radiogroup' }, btns), focus: () => btns.find((b) => b.classList.contains('is-on'))?.focus(), read: () => cur };
      }
      case 'order': {
        let order = Array.isArray(v) ? [...v] : (q.options ?? []).map((o) => o.value);
        const label = new Map((q.options ?? []).map((o) => [o.value, o.label]));
        const list = h('ol', { class: 'pb-guide-order' });
        const draw = () => {
          list.innerHTML = '';
          // shown top floor first, like the stack; the value is bottom up
          const top = [...order].reverse();
          top.forEach((id, i) => list.append(h('li', {}, h('span', {}, label.get(id) ?? id),
            h('button', { class: 'pb-btn is-small', disabled: i === 0, title: 'Opp', onclick: () => {
              const k = order.indexOf(id);
              [order[k], order[k + 1]] = [order[k + 1], order[k]];
              draw();
            } }, '▲'),
            h('button', { class: 'pb-btn is-small', disabled: i === top.length - 1, title: 'Ned', onclick: () => {
              const k = order.indexOf(id);
              [order[k], order[k - 1]] = [order[k - 1], order[k]];
              draw();
            } }, '▼'))));
        };
        draw();
        return { el: h('div', {}, h('p', { class: 'pb-note' }, 'Øverste etasje øverst.'), list), read: () => [...order] };
      }
      case 'none':
      default: {
        const kids = [];
        if ((q.kind === 'photo' || q.kind === 'shape') && this.onNewFile) kids.push(h('button', { class: 'pb-btn', onclick: () => this.onNewFile(q) }, 'Velg et nytt bilde …'));
        return { el: h('div', { class: 'pb-row' }, kids), read: () => v ?? null };
      }
    }
  }

  /** The crop: the drawing around the question's box, the box outlined (the whole drawing when it has none). */
  _cropCanvas(q) {
    const src = q.crop ? this.imageFor(q.crop) : null;
    if (!src?.source) return null;
    const W = src.width;
    const H = src.height;
    const bb = q.crop.bbox;
    let x0 = 0;
    let y0 = 0;
    let x1 = W;
    let y1 = H;
    if (bb) {
      const m = Math.max(24, 0.3 * Math.max(bb[2] - bb[0], bb[3] - bb[1]));
      x0 = Math.max(0, bb[0] - m);
      y0 = Math.max(0, bb[1] - m);
      x1 = Math.min(W, bb[2] + m);
      y1 = Math.min(H, bb[3] + m);
    }
    const maxW = 460;
    const maxH = 420;
    const k = Math.min(maxW / (x1 - x0), maxH / (y1 - y0), 4);
    const cw = Math.max(1, Math.round((x1 - x0) * k));
    const ch = Math.max(1, Math.round((y1 - y0) * k));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = h('canvas', { class: 'pb-guide-canvas', width: Math.round(cw * dpr), height: Math.round(ch * dpr), style: `width:${cw}px;height:${ch}px` });
    const g = c.getContext('2d');
    g.setTransform(dpr * k, 0, 0, dpr * k, -x0 * dpr * k, -y0 * dpr * k);
    g.fillStyle = '#fff';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.imageSmoothingEnabled = k < 2;
    g.drawImage(src.source, 0, 0, W, H);
    if (bb) {
      // the rest a little darker, the box itself outlined
      g.fillStyle = 'rgba(13, 20, 28, 0.28)';
      g.beginPath();
      g.rect(x0, y0, x1 - x0, y1 - y0);
      g.rect(bb[2], bb[1], bb[0] - bb[2], bb[3] - bb[1]);
      g.fill('evenodd');
      g.strokeStyle = '#ffb52e';
      g.lineWidth = 3 / k;
      g.strokeRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]);
    }
    return c;
  }
}
