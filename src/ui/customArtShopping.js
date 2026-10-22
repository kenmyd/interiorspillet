import { h, svg } from './dom.js';
import { section } from './panelKit.js';
import { ICONS } from './icons.js';
import { getImageStore } from '../design/ImageStore.js';
import { hasImage, describe } from '../design/imageArt.js';

/**
 * «Egne bilder» in the shopping list (design/upload.md §12) – a ShoppingPanel section (addSection, MASTER §2.7)
 * registered by ui/ImageUpload.js. It lists every visible item with an own picture, grouped by picture, source,
 * product, size and frame look:
 *   own picture (uploaded / converted)  «bestill selv» – print and framing are ordered by the owner (photo shop, framer)
 *   catalogue frame with a picture      «i {product}» – the frame itself is a purchase and stays under its store
 * It never adds to the total.
 *
 *   customArtShoppingSection({ editor }) → { list(editor), render(data, panel), text(data), csv(data), print(data, esc) }
 *   list → { rows: [{ uid, name, imageId, imageName, qty, picText, outerText, frameText, product|null, unit|null,
 *                     store|null, url|null }] } | null
 */

const FOOTNOTE = 'Egne bilder er ikke med i totalen. Trykk og innramming bestiller du selv, for eksempel hos en fotobutikk eller et rammeverksted. Rammer fra katalogen står under butikken over.';

const qtyText = (n) => `${n} stk`;

/** The picture store the editor uses (the app's singleton when the home has none). */
function storeOf(editor) {
  try {
    return editor?.home?.images ?? (typeof document !== 'undefined' ? getImageStore() : null);
  } catch {
    return null;
  }
}

/** Price of a catalogue product's variant (catalog.priceOf, as the shopping list's own rows). */
function unitPrice(catalog, product, vi) {
  let p = null;
  try {
    const n = product?.variants?.length || 1;
    p = catalog?.priceOf ? catalog.priceOf(product, Math.max(0, Math.min(n - 1, vi | 0)))?.price : product?.priceNok;
  } catch {
    p = null;
  }
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
}

/**
 * @param {{ editor?: object }} [o]
 */
export function customArtShoppingSection({ editor } = {}) {
  return {
    list(e = editor) {
      const design = e?.design;
      if (!design?.list) return null;
      const images = storeOf(e);
      const groups = new Map();
      for (const it of design.list()) {
        if (it.hidden || !hasImage(it)) continue;
        const P = it.params;
        const key = JSON.stringify([P.imageId, it.source, it.refId, it.dims, P.frameStyle ?? null, P.mat ?? null, P.fit ?? null]);
        const g = groups.get(key);
        if (g) {
          g.qty++;
          continue;
        }
        const product = it.source === 'catalog' ? e.catalog?.getProduct?.(it.refId) ?? null : null;
        const d = describe(it);
        const vi = it.variantIndex ?? product?.defaultVariant ?? 0;
        groups.set(key, {
          uid: it.uid,
          name: it.name,
          imageId: P.imageId,
          imageName: images?.info?.(P.imageId)?.name || '',
          qty: 1,
          picText: d.picText,
          outerText: d.outerText,
          frameText: d.frameText,
          product,
          unit: product ? unitPrice(e.catalog, product, vi) : null,
          store: product?.store ?? null,
          url: product ? product.variants?.[vi]?.url || product.url || null : null,
        });
      }
      const rows = [...groups.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'nb'));
      return rows.length ? { rows } : null;
    },

    render(data, panel) {
      const images = storeOf(panel?.editor ?? editor);
      const rows = data.rows.map((r) => {
        const box = h('div.iph-row__img');
        const url = images?.objectUrl?.(r.imageId);
        if (url) box.append(h('img', { src: url, alt: '', draggable: false }));
        else {
          box.append(svg(ICONS.palette));
          // the bytes are not in memory yet: show the thumbnail when they are
          images?.load?.([r.imageId], { decode: false }).then(() => {
            const u = images.objectUrl(r.imageId);
            if (u && box.isConnected) box.replaceChildren(h('img', { src: u, alt: '', draggable: false }));
          }, () => {});
        }
        const sub = [r.picText, r.frameText].filter(Boolean).join(' · ');
        const right = r.product
          ? [h('span.iph-row__price.is-unknown', { text: `i ${r.product.name}`, title: r.product.name }), h('span.iph-row__qty', { text: `regnet med under ${r.store}` })]
          : [h('span.iph-row__price.is-unknown', { text: 'bestill selv' }), h('span.iph-row__qty', { text: qtyText(r.qty) })];
        return h('div.iph-row', {}, box,
          h('div.iph-row__main', {},
            h('div.iph-row__name', { text: r.name, title: r.imageName ? `${r.name} (${r.imageName})` : r.name }),
            h('div.iph-row__sub', { text: sub, title: `${sub} · ${r.outerText}` })),
          h('div.iph-row__right', {}, right));
      });
      return section('Egne bilder', h('div.iph-rows', {}, rows), h('p.iph-foot-note', { text: FOOTNOTE }));
    },

    text(data) {
      const lines = ['EGNE BILDER'];
      for (const r of data.rows) {
        const how = r.product ? `i ${r.product.name} (${r.store}, regnet med over)` : 'bestill selv';
        lines.push(`- ${r.name}: ${r.picText.toLowerCase()}, ${r.frameText.replace(/ · /g, ', ')}${r.qty > 1 ? ` – ${qtyText(r.qty)}` : ''} – ${how}`);
      }
      return lines;
    },

    csv(data) {
      return data.rows.map((r) => [
        'Egne bilder',
        r.name,
        `${r.picText}; ${r.frameText}`,
        r.qty,
        '',
        '',
        r.product ? `ramme: ${r.product.name} (${r.store}, regnet med over)` : 'bestill selv',
        r.url || '',
      ]);
    },

    print(data, esc = (s) => String(s)) {
      const row = (cells) => `<tr>${cells.map((c, i) => `<td${i >= 2 ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`;
      return `<h2>Egne bilder</h2><table>${data.rows.map((r) => row([
        `<b>${esc(r.name)}</b><br><small>${esc(`${r.picText} · ${r.frameText}`)}</small>`,
        r.product ? `<small>${esc(`ramme: ${r.product.name} (${r.store})`)}</small>` : '',
        esc(qtyText(r.qty)),
        r.product ? '<small>regnet med over</small>' : 'bestill selv',
      ])).join('')}</table><p><small>${esc(FOOTNOTE)}</small></p>`;
    },
  };
}

export default customArtShoppingSection;
