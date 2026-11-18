// SpecialProposalPanel – «Spesialforslag» (N), the owner's design 2026-11-18: at the top the cabinet (grunt / dypt /
// høyt), its width (180 / 240) and its doors (Hedeviken / Björköviken); then the kind of proposal (stort bilde / to
// bilder / tre bilder) and, for two or three pictures, their size. Below, the proposals of that kind as picture-only
// cards to flick through – a click puts cabinet, lamp, plant and pictures on the high wall (one undo step). Changing a
// choice while a proposal is in the room sets it up again with the new choice (design/specialProposals.js).
//
//   new SpecialProposalPanel(editor) – open() / close() / toggle() / isOpen / update() / dispose()
import { BasePanel, fmtNok } from './panelKit.js';
import { h } from './dom.js';
import { assetUrl } from '../home/materials.js';
import { BUNDLED_IMAGES } from '../data/bundledImages.js';
import {
  SPECIAL_BENCHES, SPECIAL_WIDTHS, SPECIAL_FRONTS, SPECIAL_KINDS, SIZE_NAMES, specialProposals, specialProposalById,
  specialProposalTotals, proposalName, applySpecialProposal, activeSpecialProposal, activeSpecialSettings,
  getSpecialSettings, setSpecialSettings,
} from '../design/specialProposals.js';

const STORE_KEY = 'interiorspillet.spesialforslag';
function readStored() {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function store(settings) {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* private window – the choices just aren't remembered */
  }
}

const CSS = `
.spp-top { position: sticky; top: 0; z-index: 1; background: var(--kv-surface-2, var(--kv-surface)); padding: 0 0 0.6em; margin: 0 0 0.6em; border-bottom: 1px solid var(--kv-line); display: flex; flex-direction: column; gap: 0.45em; }
.spp-row { display: grid; grid-template-columns: 4.6em 1fr; align-items: center; gap: 0.5em; }
.spp-row-label { font-size: 0.76em; color: var(--kv-ink-3); font-weight: 600; }
.spp-seg { display: flex; gap: 0.3em; }
.spp-seg button { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 0.05em; padding: 0.38em 0.25em; border-radius: var(--kv-r-sm); border: 1px solid var(--kv-line); background: var(--kv-surface); color: var(--kv-ink); font-size: 0.8em; line-height: 1.15; }
.spp-seg button:hover { background: var(--kv-surface-3); }
.spp-seg button.is-on { border-color: rgba(255, 181, 46, 0.7); background: var(--kv-accent-soft); }
.spp-seg button b { font-weight: 650; }
.spp-seg button span { font-size: 0.84em; color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }
.spp-kinds { margin-top: 0.2em; }
.spp-kinds button { font-size: 0.86em; padding: 0.5em 0.25em; }
.spp-sum { font-size: 0.74em; color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }
.spp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5em; }
.spp-card { display: flex; flex-direction: column; gap: 0.3em; padding: 0.45em; border-radius: var(--kv-r-sm); border: 1px solid var(--kv-line); background: var(--kv-surface); color: var(--kv-ink); text-align: left; width: 100%; }
.spp-card:hover { background: var(--kv-surface-3); border-color: var(--kv-line-2); }
.spp-card.is-active { border-color: rgba(255, 181, 46, 0.75); background: var(--kv-accent-soft); }
.spp-pics { display: flex; gap: 0.25em; align-items: flex-end; }
.spp-pics img { display: block; flex: 1 1 0; width: 0; height: auto; object-fit: cover; border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.35); background: #8c7a68; }
.spp-id { font-size: 0.7em; color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }
.spp-card.is-active .spp-id { color: var(--kv-accent-2); }
`;
let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  document.head.append(h('style', { dataset: { owner: 'SpecialProposalPanel' }, text: CSS }));
}

/** A row of segmented buttons. */
function seg(label, options, current, onPick) {
  return h('div.spp-row', {},
    h('span.spp-row-label', { text: label }),
    h('div.spp-seg', { role: 'radiogroup', 'aria-label': label }, options.map((o) => h(`button${o.value === current ? '.is-on' : ''}`, {
      type: 'button', role: 'radio', 'aria-checked': o.value === current ? 'true' : 'false', title: o.title || '',
      on: { click: () => onPick(o.value) },
    }, h('b', { text: o.label }), o.sub ? h('span', { text: o.sub }) : null))),
  );
}

export class SpecialProposalPanel extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'specialProposals', title: 'Spesialforslag', icon: 'palette', side: 'right', width: 26 });
    injectCss();
    this.design = editor.design;
    this.catalog = editor.catalog;
    const saved = readStored();
    if (saved) setSpecialSettings(saved);
    this._dirty = true;
    this._offs = [];
    const mark = () => (this._dirty = true);
    if (this.design?.on) for (const ev of ['item:add', 'item:remove', 'load']) this._offs.push(this.design.on(ev, mark));
  }

  onOpen() {
    // the cabinet of the proposal in the room wins, so the choices show what is on the wall
    const inRoom = activeSpecialSettings(this.design);
    if (inRoom) setSpecialSettings(inRoom);
    const active = specialProposalById(activeSpecialProposal(this.design));
    if (active) setSpecialSettings({ kind: active.kind });
    this._render();
  }

  update() {
    if (this.isOpen && this._dirty) this._render();
  }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs = [];
    super.dispose();
  }

  /** Changes a choice; a proposal in the room is set up again with it (one undo step). */
  _set(patch) {
    const before = getSpecialSettings();
    const s = setSpecialSettings(patch);
    store(s);
    const active = specialProposalById(activeSpecialProposal(this.design));
    const affects = active && (s.bench !== before.bench || s.width !== before.width || s.front !== before.front
      || (active.kind === 'to' && s.size2 !== before.size2) || (active.kind === 'tre' && s.size3 !== before.size3));
    if (affects) this._apply(active);
    else this._render();
  }

  _render() {
    this._dirty = false;
    const s = getSpecialSettings();
    const kind = SPECIAL_KINDS.find((k) => k.key === s.kind);
    const activeId = activeSpecialProposal(this.design);
    const size = s.kind === 'tre' ? s.size3 : s.size2;

    const top = h('div.spp-top', {},
      seg('Skap', SPECIAL_BENCHES.map((b) => ({ value: b.key, label: b.label, sub: b.depth, title: `BESTÅ ${s.width} × ${b.depth} cm` })), s.bench, (v) => this._set({ bench: v })),
      seg('Bredde', SPECIAL_WIDTHS.map((w) => ({ value: w, label: `${w} cm` })), s.width, (v) => this._set({ width: v })),
      seg('Front', SPECIAL_FRONTS.map((f) => ({ value: f.v, label: f.label })), s.front, (v) => this._set({ front: v })),
      h('div.spp-seg.spp-kinds', { role: 'tablist', 'aria-label': 'Type forslag' }, SPECIAL_KINDS.map((k) => h(`button${k.key === s.kind ? '.is-on' : ''}`, {
        type: 'button', role: 'tab', 'aria-selected': k.key === s.kind ? 'true' : 'false',
        on: { click: () => this._set({ kind: k.key }) },
      }, h('b', { text: k.label }), h('span', { text: k.key === 'stort' ? k.sizeLabel : k.key === 'to' ? '2 like' : '3 like' })))),
      kind.sizes.length > 1
        ? seg('Størrelse', kind.sizes.map((v) => ({ value: v, label: SIZE_NAMES[v] })), size, (v) => this._set(s.kind === 'tre' ? { size3: v } : { size2: v }))
        : null,
    );

    const list = specialProposals(s.kind);
    let sum = '';
    try {
      const t = specialProposalTotals(list[0], this.catalog, s);
      const pics = t.price - specialProposalTotals({ ...list[0], pictures: [] }, this.catalog, s).price;
      sum = `Skap, lampe og plante ${fmtNok(t.price - pics)} · bildene ${fmtNok(pics)} · demper ca. ${String(t.m2).replace('.', ',')} m²`;
    } catch (err) {
      console.warn('[spesialforslag] pris', err);
    }

    const cards = list.map((p) => {
      const name = proposalName(p, this.catalog);
      const imgs = p.pictures.map((slug) => {
        const prod = this.catalog.getProduct(`canvasbutik-lyddempende-bilde-${slug}`);
        const img = BUNDLED_IMAGES[prod?.params?.imageId];
        const aspect = prod?.params?.imageAspect || (prod ? prod.dims.w / prod.dims.h : 0.7);
        // equal heights: each picture's share of the row is its aspect
        return h('img', { src: img ? assetUrl(img.url) : '', alt: '', loading: 'lazy', style: { aspectRatio: String(aspect), flexGrow: String(aspect) } });
      });
      return h(`button.spp-card${p.id === activeId ? '.is-active' : ''}`, {
        type: 'button', title: `${p.id}: ${name}`, 'aria-label': `${p.id}: ${name}`, 'aria-pressed': p.id === activeId ? 'true' : 'false',
        on: { click: () => this._apply(p) },
      }, h('span.spp-pics', {}, imgs), h('span.spp-id', { text: p.id }));
    });

    this.body.replaceChildren(top, sum ? h('p.spp-sum', { text: sum }) : null, h('div.spp-grid', {}, cards));
  }

  _apply(p) {
    const e = this.editor;
    try {
      if (e.placement?.isActive) e.placement.cancel();
      e.select?.(null);
      applySpecialProposal(e, p.id);
      e.events?.emit?.('toast', { text: `Spesialforslag ${p.id}: ${proposalName(p, this.catalog)}`, seconds: 2.4 });
    } catch (err) {
      console.error('[spesialforslag] kunne ikke bruke forslaget', err);
      e.events?.emit?.('toast', { text: 'Klarte ikke å sette opp forslaget', seconds: 2.4 });
    }
    this._render();
  }
}
