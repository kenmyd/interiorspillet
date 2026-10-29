// SpecialProposalPanel – «Spesialforslag» (N): 20 ready-made looks for the high wall from the Spesialkatalog – one
// sideboard (BESTÅ 180 / 240, EKET), one to three canvasbutik.no pictures and a little decor (design/specialProposals.js).
// A click puts the proposal in the room as ordinary catalogue items (one undo step); the pictures can then be clicked
// and switched between their store sizes in the inspector.
//
//   new SpecialProposalPanel(editor) – open() / close() / toggle() / isOpen / update() / dispose()
import { BasePanel, fmtNok } from './panelKit.js';
import { h } from './dom.js';
import { assetUrl } from '../home/materials.js';
import { BUNDLED_IMAGES } from '../data/bundledImages.js';
import {
  SPECIAL_PROPOSALS, SPECIAL_WALL, layoutSpecialProposal, specialProposalTotals, applySpecialProposal, activeSpecialProposal,
} from '../design/specialProposals.js';

const CSS = `
.spp-intro { font-size: 0.82em; color: var(--kv-ink-3); margin: 0 0 0.8em; line-height: 1.4; }
.spp-list { display: flex; flex-direction: column; gap: 0.6em; }
.spp-card { display: flex; gap: 0.7em; padding: 0.55em; border-radius: var(--kv-r-sm); border: 1px solid var(--kv-line); background: var(--kv-surface); color: var(--kv-ink); text-align: left; width: 100%; }
.spp-card:hover { background: var(--kv-surface-3); border-color: var(--kv-line-2); }
.spp-card.is-active { border-color: rgba(255, 181, 46, 0.6); background: var(--kv-accent-soft); }
.spp-thumb { flex: none; width: 7.4em; aspect-ratio: 3.91 / 3; border-radius: 4px; overflow: hidden; background: #cfc5b4; }
.spp-thumb svg { display: block; width: 100%; height: 100%; }
.spp-text { min-width: 0; display: flex; flex-direction: column; gap: 0.2em; }
.spp-name { font-weight: 650; font-size: 0.9em; line-height: 1.25; }
.spp-name b { color: var(--kv-accent-2); margin-right: 0.35em; }
.spp-desc { font-size: 0.76em; color: var(--kv-ink-3); line-height: 1.35; }
.spp-meta { font-size: 0.76em; color: var(--kv-ink-2); font-variant-numeric: tabular-nums; margin-top: auto; }
`;
let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  document.head.append(h('style', { dataset: { owner: 'SpecialProposalPanel' }, text: CSS }));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Front view of a proposal: the SAND wall, the sideboard, the pictures (their real motif) and the decor. */
function previewSvg(proposal, catalog) {
  const W = SPECIAL_WALL.width, H = SPECIAL_WALL.height;
  const y = (v, hh) => (H - v - hh).toFixed(3);
  const parts = [];
  for (const e of layoutSpecialProposal(proposal, catalog)) {
    const x = (e.u - e.w / 2).toFixed(3);
    const p = catalog.getProduct(e.productId);
    if (e.role === 'bench') {
      const c = p.variants?.[e.variantIndex]?.colors || {};
      parts.push(`<rect x="${x}" y="${y(e.v, e.h)}" width="${e.w}" height="${e.h}" fill="${esc(c.front || c.body || '#3a2e27')}" stroke="rgba(0,0,0,.35)" stroke-width="0.01"/>`);
    } else if (e.role === 'picture') {
      const img = BUNDLED_IMAGES[p.params?.imageId];
      parts.push(img
        ? `<image href="${esc(assetUrl(img.url))}" x="${x}" y="${y(e.v, e.h)}" width="${e.w}" height="${e.h}" preserveAspectRatio="xMidYMid slice"/>`
        : `<rect x="${x}" y="${y(e.v, e.h)}" width="${e.w}" height="${e.h}" fill="#8c7a68"/>`);
    } else {
      const c = p.variants?.[e.variantIndex]?.colors || {};
      const fill = c.leaves || c.shade || c.body || c.glass || '#6f6253';
      parts.push(`<rect x="${x}" y="${y(e.v, e.h)}" width="${e.w}" height="${e.h}" rx="0.03" fill="${esc(fill)}" opacity="0.9"/>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="${W}" height="${H}" fill="#cfc5b4"/>${parts.join('')}</svg>`;
}

export class SpecialProposalPanel extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'specialProposals', title: 'Spesialforslag', icon: 'palette', side: 'right', width: 26 });
    injectCss();
    this.design = editor.design;
    this.catalog = editor.catalog;
    this._dirty = true;
    this._offs = [];
    const mark = () => (this._dirty = true);
    if (this.design?.on) for (const ev of ['item:add', 'item:remove', 'load']) this._offs.push(this.design.on(ev, mark));
  }

  onOpen() {
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

  _render() {
    this._dirty = false;
    const active = activeSpecialProposal(this.design);
    const cards = SPECIAL_PROPOSALS.map((p) => {
      let thumb = '', meta = '';
      try {
        thumb = previewSvg(p, this.catalog);
        const t = specialProposalTotals(p, this.catalog);
        meta = `${fmtNok(t.price)} · bildene demper ca. ${String(t.m2).replace('.', ',')} m²`;
      } catch (err) {
        console.warn(`[spesialforslag] ${p.id}`, err);
      }
      const thumbEl = h('span.spp-thumb');
      thumbEl.innerHTML = thumb;
      return h(`button.spp-card${p.id === active ? '.is-active' : ''}`, {
        type: 'button', title: `Bruk ${p.id} på den høye veggen`, 'aria-pressed': p.id === active ? 'true' : 'false',
        on: { click: () => this._apply(p) },
      },
      thumbEl,
      h('span.spp-text', {},
        h('span.spp-name', {}, h('b', { text: p.id }), p.name),
        h('span.spp-desc', { text: p.description }),
        h('span.spp-meta', { text: meta }),
      ));
    });
    this.body.replaceChildren(
      h('p.spp-intro', { text: 'Skjenk, bilder og pynt fra Spesialkatalogen til den høye veggen. Trykk på et forslag for å sette det opp – det erstatter det som henger på veggen og skjenken under (angre med Ctrl+Z). Klikk på et bilde etterpå for å bytte størrelse.' }),
      h('div.spp-list', {}, cards),
    );
  }

  _apply(p) {
    const e = this.editor;
    try {
      if (e.placement?.isActive) e.placement.cancel();
      e.select?.(null);
      applySpecialProposal(e, p.id);
      e.events?.emit?.('toast', { text: `Spesialforslag ${p.id}: ${p.name}`, seconds: 2.4 });
    } catch (err) {
      console.error('[spesialforslag] kunne ikke bruke forslaget', err);
      e.events?.emit?.('toast', { text: 'Klarte ikke å sette opp forslaget', seconds: 2.4 });
    }
    this._render();
  }
}
