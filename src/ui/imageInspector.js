import { h, svg } from './dom.js';
import { section, button, badge, slider, select, toggle } from './panelKit.js';
import { ICONS } from './icons.js';
import { throttle, seg } from './inspectorKit.js';
import { itemImageId } from '../design/ImageStore.js';
import {
  FRAME_STYLES, LONG_EDGE_RANGE, hasImage, isUploadedImage, acceptsImage, canHoldImage, specToChoice, choicePatch, describe, cm,
} from '../design/imageArt.js';

/**
 * The Inspector's «Bilde» section for own pictures (design/upload.md §11.5) – an Inspector extension (MASTER §2.7)
 * registered by ui/ImageUpload.js:
 *   head        uploaded pictures: «Eget bilde» badge + «Bilde du har lastet opp – lagret i denne nettleseren»
 *   afterHead   «Bilde» for art-frame / acoustic-art items: thumbnail, name and pixels, size and frame text,
 *               «Bytt bilde …», «Tilpass størrelse og ramme …»; for uploaded pictures also «Størrelse (lengste side)»,
 *               «Ramme», «Passepartout» and «Tilpasning»; warnings for a missing or unsaved picture. Without a picture:
 *               «Bruk eget bilde i rammen …» (catalogue frames that take one) or «Bytt til eget bilde …»
 *   hide        uploaded: size, params and the print colour live in «Bilde»; a catalogue frame with a picture hides the
 *               motif params and the print colour
 *   candidates  an item with a picture swaps only between catalogue frames that take one (the picture moves along)
 *   carry       a swap / «Tilbakestill» to a frame that takes a picture keeps the picture; «Tilbakestill» of today's
 *               painting that became an own picture brings the painting back with its own source and name
 *
 *   imageInspectorExtension(editor, upload) → ext (ext.dispose() drops the store listeners)
 */

const FIT_OPTIONS = [['cover', 'Beskjær'], ['contain', 'Hele bildet']];

/** «Eget bilde – …» items made from an upload or a converted painting: the art-frame look is edited in «Bilde». */
const ownFrame = (item) => isUploadedImage(item) && item.archetype === 'art-frame';

function warn(text) {
  return h('p.ipi-warn', {}, svg(ICONS.warning), h('span', { text }));
}

/**
 * @param {import('../design/Editor.js').Editor} editor
 * @param {import('./ImageUpload.js').ImageUpload} upload
 */
export function imageInspectorExtension(editor, upload) {
  const asked = new Set(); // ids whose bytes were requested once (thumbnail, info)
  const offs = [];
  const insp = () => editor.ui?.inspector;
  const shownId = () => {
    const t = insp()?.target;
    return t?.kind === 'item' ? itemImageId(editor.design.get(t.uid)) : null;
  };
  // an import, a late load or a missing picture refreshes the section of the item on screen
  const refresh = (e) => {
    const id = shownId();
    if (id && (!e?.id || e.id === id)) {
      const i = insp();
      if (i) i._dirty = true;
    }
  };
  const images = upload.images;
  if (images?.on) for (const ev of ['ready', 'missing', 'added', 'deleted']) offs.push(images.on(ev, ev === 'deleted' ? () => refresh() : refresh));

  /** Loads the picture's bytes once (thumbnail, info) and refreshes the section when they are there. */
  const ensure = (id) => {
    if (!id || asked.has(id) || !images?.load) return;
    if (images.status(id) === 'ready' || images.status(id) === 'loaded') return;
    asked.add(id);
    images.load([id], { decode: false }).then(() => refresh({ id }), () => {});
  };

  /** A design.update patch made to fit the wall, applied as one (coalescing) undo step of the Inspector. */
  const applyFit = (ins, item, patch, opts) => {
    const res = ins._fit ? ins._fit(item.uid, patch) : { patch, capped: [], status: 'ok' };
    if (res.status === 'blocked') {
      editor.events?.emit?.('toast', { text: 'Bildet får ikke plass på veggen her i den størrelsen – prøv en mindre størrelse.', seconds: 3 });
      return null;
    }
    return ins._apply(res.patch, opts);
  };

  const pictureInfo = (id) => {
    const info = images?.info?.(id);
    if (!info) return null;
    const px = `${info.w} × ${info.h} px`;
    const orig = info.origW > info.w || info.origH > info.h ? `, original ${info.origW} × ${info.origH}` : '';
    return { info, text: `${info.name || 'Bilde'} · ${px}${orig}` };
  };

  /** The controls of an uploaded picture (size, frame, mat, fit) – each change is a «Tilpass» patch. */
  function ownControls(ins, item) {
    const id = item.params.imageId;
    const info = images?.info?.(id);
    const image = { id, aspect: item.params.imageAspect || info?.aspect || 1, name: info?.name || '' };
    const choice = specToChoice(item);
    const kids = [];
    const change = (next, label, opts = {}) => {
      const patch = choicePatch(item, image, { ...choice, ...next });
      // the name stays (choicePatch keeps it) – only size and look change
      return applyFit(ins, item, patch, { label, ...opts });
    };
    if (choice.mode === 'image') {
      const live = throttle((v) => change({ long: v }, 'Endre bildestørrelse', { coalesce: 'imgsize' }), 90);
      const s = slider({
        label: 'Størrelse (lengste side)',
        min: LONG_EDGE_RANGE[0],
        max: LONG_EDGE_RANGE[1],
        step: 0.01,
        value: choice.long,
        format: (v) => `${cm(v)} cm`,
        onInput: (v) => live(v),
        onChange: (v) => {
          live.cancel();
          change({ long: v }, 'Endre bildestørrelse', { coalesce: 'imgsize' });
          ins._dirty = true;
        },
      });
      kids.push(s.el);
    }
    const styles = Object.entries(FRAME_STYLES).map(([k, st]) => [k, st.label]);
    kids.push(select({
      label: 'Ramme',
      options: styles,
      value: choice.style,
      onChange: (v) => {
        const st = FRAME_STYLES[v];
        change({ style: v, mat: st?.mat === true, texture: st?.texture }, 'Endre ramme');
        ins._dirty = true;
      },
    }).el);
    const st = FRAME_STYLES[choice.style];
    if (st && st.mat !== null) {
      kids.push(toggle({
        label: 'Passepartout',
        value: !!choice.mat,
        onChange: (v) => {
          change({ mat: v }, v ? 'Legg til passepartout' : 'Fjern passepartout');
          ins._dirty = true;
        },
      }).el);
    }
    // crop or show the whole picture: only when the frame's opening has another shape than the picture
    if (choice.mode === 'frame' && st && !st.canvas && !(st.frame === 'none' && !choice.mat)) {
      kids.push(h('div.ipu-field-label', { text: 'Tilpasning' }), seg(FIT_OPTIONS, choice.fit, (v) => {
        change({ fit: v }, v === 'contain' ? 'Vis hele bildet' : 'Beskjær bildet');
        ins._dirty = true;
      }));
    }
    return kids;
  }

  function imageSection(ins, item, product) {
    if (!canHoldImage(item)) return null;
    const P = item.params || {};
    const kids = [];
    if (hasImage(item)) {
      const id = P.imageId;
      ensure(id);
      const url = images?.objectUrl?.(id) || null;
      const status = images?.status?.(id) || 'unknown';
      const pi = pictureInfo(id);
      const d = describe(item);
      const thumb = h('div.ipu-ithumb', { title: pi?.info?.name || '' });
      if (url) thumb.append(h('img', { src: url, alt: '', draggable: false }));
      else thumb.append(svg(ICONS.palette));
      kids.push(h('div.ipu-irow', {}, thumb, h('div.ipu-itext', {},
        h('div.ipu-iname', { text: pi?.text || (status === 'missing' ? 'Bildet mangler' : 'Eget bilde'), title: pi?.text || '' }),
        h('div.ipu-isub', { text: [d.picText, d.outerText].join(' · ') }),
        h('div.ipu-isub', { text: [d.frameText, d.fitText].filter(Boolean).join(' · ') }))));
      if (status === 'missing') kids.push(warn('Bildefilen finnes ikke i denne nettleseren – rammen vises tom. Last opp bildet på nytt med «Bytt bilde», eller importer designfilen bildet ble eksportert med.'));
      else if (pi?.info && pi.info.persisted === false) kids.push(warn('Bildet er bare lagret til fanen lukkes. Eksporter designet til fil (Design → Eksporter) for å ta vare på det.'));
      const swap = button({ label: 'Bytt bilde …', size: 'sm', title: 'Velg et annet bilde til denne rammen', onClick: () => upload.swapImage(item.uid) });
      const fit = button({ label: 'Tilpass størrelse og ramme …', size: 'sm', title: 'Endre størrelse, ramme og passepartout', onClick: () => upload.open({ uid: item.uid }) });
      kids.push(h('div.ipu-ibtns', {}, swap, fit));
      if (ownFrame(item)) kids.push(...ownControls(ins, item));
      else if (item.source === 'catalog' && product) kids.push(h('p.ipi-hint', { text: `Rammen fra ${product.store} står i handlelisten. Trykk og bilde bestiller du selv.` }));
    } else {
      const accepts = item.source === 'catalog' && acceptsImage(product || item);
      const label = accepts ? 'Bruk eget bilde i rammen …' : 'Bytt til eget bilde …';
      const hint = accepts
        ? `Rammen fra ${product?.store || 'butikken'} blir stående i handlelisten.`
        : `Rammen beholder størrelse og farge${item.source === 'catalog' ? ` – ${item.name} tas ut av handlelisten` : ''}.`;
      kids.push(h('div.ipu-ibtns', {}, button({ label, size: 'sm', variant: 'primary', title: 'Velg et bilde fra maskinen din', onClick: () => upload.swapImage(item.uid) })),
        h('p.ipi-hint', { text: hint }));
    }
    return section('Bilde', ...kids);
  }

  const ext = {
    head(ins, item) {
      if (!isUploadedImage(item)) return null;
      const label = editor.catalog?.categoryLabel?.(ins._category ? ins._category(item, null) : item.category);
      const badges = [label ? badge(label) : null, badge('Eget bilde', 'info')].filter(Boolean);
      return h('div.ipi-head', {}, h('div.ipi-badges', {}, badges), h('div.ipi-store', { text: 'Bilde du har lastet opp – lagret i denne nettleseren' }));
    },
    sections: {
      afterHead: (ins, item, product) => imageSection(ins, item, product),
    },
    hide(ins, item) {
      if (ownFrame(item)) return { size: true, params: true, parts: ['print'], reset: !ins._original?.(item) };
      if (hasImage(item)) return { parts: ['print'], params: ['motif', 'seed', 'texture'] };
      return null;
    },
    candidates(ins, item, product, list) {
      return hasImage(item) ? list.filter((p) => acceptsImage(p)) : list;
    },
    carry(ins, item, spec) {
      // «Tilbakestill» of today's painting that became an own picture: the painting comes back as it was (the Inspector
      // keeps a custom item's source and name on a reset – right for copies, not for a converted original)
      if (isUploadedImage(item) && !acceptsImage(spec)) {
        let orig = null;
        try {
          orig = ins._original?.(item) || null;
        } catch {
          orig = null;
        }
        if (orig && spec && spec.refId === orig.refId && spec.archetype === orig.archetype && orig.source !== 'custom') {
          return { ...spec, source: orig.source, name: orig.name, category: orig.category ?? spec.category };
        }
        return spec;
      }
      if (!hasImage(item) || !acceptsImage(spec)) return spec;
      const P = item.params;
      return { ...spec, params: { ...(spec.params || {}), motif: 'custom', imageId: P.imageId, imageAspect: P.imageAspect, fit: P.fit === 'contain' ? 'contain' : 'cover' } };
    },
    dispose() {
      for (const off of offs.splice(0)) off?.();
    },
  };
  return ext;
}

export default imageInspectorExtension;
