#!/usr/bin/env node
/**
 * Runde 3 UI fixes that run without a browser (the DOM parts are checked in the game):
 *   1. imageInspector.fitEvenly – a picture too big for its wall shrinks evenly: «etter bildet» keeps the picture's shape
 *      (the Inspector's size slider and ImageUpload.apply on a short wall such as «Knekkvegg ved terrassedøra», 0,6 m)
 *   2. ImageUpload – a browser error is never shown in English (uploadErrorText); while «Før» is shown, apply() refuses
 *      and a dropped file never targets an item of the original; a drop over a panel is no item
 *   3. ShoppingPanel – pack products («3pk») add up in the row, the copied list and the CSV; the CSV has no float noise
 *      and uses a decimal comma
 *   node tools/test-house.mjs ui-image-shop
 */
import { registerHooks } from 'node:module';
import { imp, check, section, done, near } from './_lib.mjs';

// panelKit (ShoppingPanel, ImageUpload) imports a stylesheet: nothing to load in Node
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const t0 = Date.now();
const A = await imp('src/models/artlayout.js');
const IA = await imp('src/design/imageArt.js');
const { DesignState } = await imp('src/design/DesignState.js');
const catalog = await imp('src/catalog/index.js');
const IS = await imp('src/design/ImageStore.js');
const { fitEvenly } = await imp('src/ui/imageInspector.js');
const { ImageUpload, uploadErrorText } = await imp('src/ui/ImageUpload.js');
const { ShoppingPanel } = await imp('src/ui/ShoppingPanel.js');
const { gridSpec } = await imp('src/design/grid.js');

const ID1 = 'img-' + '1'.repeat(28);
const img = (id, aspect, name = 'Hytta.png') => ({ id, aspect, name, w: 1600, h: Math.round(1600 / aspect) });
/** A wall like «Knekkvegg ved terrassedøra»: 0,58 m wide at most, 2,3 m high (Inspector._fit caps w and h on their own). */
const wallFit = (maxW, maxH = 2.3) => {
  const calls = [];
  const fit = (p) => {
    calls.push(p);
    const dims = p.dims ? { ...p.dims } : null;
    const capped = [];
    if (dims && dims.w > maxW + 1e-4) {
      dims.w = Math.floor(maxW * 100) / 100;
      capped.push('w');
    }
    if (dims && dims.h > maxH + 1e-4) {
      dims.h = Math.floor(maxH * 100) / 100;
      capped.push('h');
    }
    return { patch: dims ? { ...p, dims } : p, capped, status: 'ok' };
  };
  fit.calls = calls;
  return fit;
};
const merged = (item, patch) => ({ ...item, ...patch, params: { ...item.params, ...(patch.params || {}) }, dims: { ...item.dims, ...(patch.dims || {}) } });

// ---------------------------------------------------------------------------------------------------------------
section('1. fitEvenly: et bilde som er for stort for veggen krympes likt');
const pic = { ...IA.choiceToSpec({ mode: 'image', long: 0.5, style: 'svart', mat: false, fit: 'cover' }, img(ID1, 4 / 3)), uid: 'u1', position: [0, 1.5, 0] };
const want100 = IA.choicePatch(pic, img(ID1, 4 / 3), { ...IA.specToChoice(pic), long: 1.0 });
const fit = wallFit(0.58);
const res = fitEvenly(fit, pic, want100);
const after = merged(pic, res.patch);
const L = A.artLayout(after.dims, after.params);
const ch = IA.specToChoice(after);
check('lengste side 100 cm på en 0,6 m vegg: ikke bredere enn veggen, ikke kappet i én retning', res.patch.dims.w <= 0.58 + 1e-9 && res.capped.length === 0 && res.shrunk === true, JSON.stringify(res.patch.dims));
check('bildet beholder formen (4:3, ikke beskåret) og «Størrelse (lengste side)» blir stående', near(L.openW / L.openH, 4 / 3, 1e-3) && ch.mode === 'image' && IA.describe(after).fitText === '',
  `${L.openW.toFixed(4)} × ${L.openH.toFixed(4)}, ${ch.mode}, «${IA.describe(after).fitText}»`);
check('… og så stort som veggen tillater (minst 52 cm bredt)', res.patch.dims.w > 0.52, `${res.patch.dims.w}`);
const plain = fitEvenly(wallFit(3), pic, want100);
check('uten tak på veggen: patchen går uendret gjennom', plain.patch === want100 || JSON.stringify(plain.patch) === JSON.stringify(want100) && !plain.shrunk);
const framed = { ...IA.choiceToSpec({ mode: 'frame', frameSize: { key: '70x50', label: '70 × 50 cm', w: 0.7, h: 0.5 }, style: 'svart', mat: true, fit: 'cover' }, img(ID1, 1.5)), uid: 'u2', position: [0, 1.5, 0] };
const fr = fitEvenly(wallFit(0.58), framed, { dims: { ...framed.dims } });
check('rammemål: begge sider krympes likt (formen på rammen beholdes)', near(fr.patch.dims.w / fr.patch.dims.h, framed.dims.w / framed.dims.h, 1e-3) && fr.patch.dims.w <= 0.58, JSON.stringify(fr.patch.dims));
const blocked = fitEvenly(() => ({ patch: {}, capped: [], status: 'blocked' }), pic, want100);
check('blokkert: status blocked kommer tilbake', blocked.status === 'blocked');

// ---------------------------------------------------------------------------------------------------------------
section('2. ImageUpload: norske feilmeldinger, «Før» og slipp over panel');
check('ImageError: butikkens egen melding', uploadErrorText(new IS.ImageError('type', IS.MSG.type)) === IS.MSG.type);
const nr = typeof DOMException === 'function' ? new DOMException('The requested file could not be read, typically due to permission problems', 'NotReadableError') : Object.assign(new Error('x'), { name: 'NotReadableError' });
check('NotReadableError (fil flyttet / OneDrive): norsk tekst, ikke nettleserens engelske', /^Klarte ikke å lese filen/.test(uploadErrorText(nr)) && !/requested/.test(uploadErrorText(nr)));
check('annen feil: «Klarte ikke å lese bildet …»', uploadErrorText(new TypeError('Failed to fetch')) === IS.MSG.decode && uploadErrorText(null) === IS.MSG.decode);

const toasts = [];
const dsU = new DesignState();
const uidU = dsU.add({ ...pic, uid: undefined, attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] } });
const canvas = { tag: 'canvas' };
const toolbar = { compareActive: false };
const editorU = {
  design: dsU,
  catalog,
  events: { emit: (n, p) => n === 'toast' && toasts.push(p?.text || '') },
  home: { images: { on: () => () => {} } },
  renderer: { domElement: canvas },
  ui: { toolbar, inspector: { _fit: wallFit(0.58) } },
};
const up = new ImageUpload(editorU);
const big = IA.choicePatch(dsU.get(uidU), img(ID1, 4 / 3), { ...IA.specToChoice(dsU.get(uidU)), long: 1.0 });
check('apply på en smal vegg: bildet beholder formen (samme som i Inspector)', up.apply(uidU, big, 'Endre') && IA.specToChoice(dsU.get(uidU)).mode === 'image' && dsU.get(uidU).dims.w <= 0.58);
toolbar.compareActive = true;
const hist = dsU.historySize;
check('«Før»: apply nekter og sier hvorfor (ellers forsvinner endringen med originalen)', up.apply(uidU, { dims: { w: 0.3, h: 0.3 } }, 'Endre') === false && dsU.historySize === hist && toasts.some((t) => /slik det er i dag/.test(t)));
check('«Før»: et slipp treffer aldri et bilde i originalen', up._itemAt(10, 10, { force: true, target: canvas }) === null);
toolbar.compareActive = false;
check('slipp over et panel (ikke 3D-visningen) er ikke et bilde', up._itemAt(10, 10, { force: true, target: { tag: 'div' } }) === null);
up.dispose();

// ---------------------------------------------------------------------------------------------------------------
section('3. Handlelisten: pakker og CSV-tall');
const dsS = new DesignState({ original: false });
const p3 = catalog.getProduct('lampehuset-malmbergs-downlight-led-md-99-ip44-3pk');
const aura = catalog.getProduct('elektroimportoren-j-el-aura-downlight-9w');
check('katalogen har MD-99 3pk (pakke à 3) og J&EL Aura (desimalpris)', !!p3 && p3.packSize === 3 && !!aura && aura.priceNok % 1 !== 0, `${p3?.packSize} ${aura?.priceNok}`);
const pur = catalog.purchaseOf(p3, p3.defaultVariant ?? 0, 4);
check('purchaseOf: packPrice = prisen for én pakke', pur.packs === 2 && near(pur.packPrice * pur.packs, pur.total, 1e-6) && catalog.purchaseOf(aura, 0, 2).packPrice === null, JSON.stringify({ packs: pur.packs, packPrice: pur.packPrice, total: pur.total }));
const addGrid = (p, rows, cols) => {
  const spec = catalog.productToItemSpec(p, p.defaultVariant ?? 0);
  const g = gridSpec({ ...spec.dims }, { rows, cols, dx: 1.2, dz: 1.2 });
  dsS.add({ ...spec, params: { ...spec.params, ...g.params }, dims: g.dims, position: [5, 2.3, 6] });
};
addGrid(p3, 2, 2);
addGrid(aura, 2, 3);
const shop = Object.create(ShoppingPanel.prototype);
shop.editor = { design: dsS, catalog, ui: {}, events: { emit() {} } };
shop._sections = [];
const data = shop.list();
const rows = data.stores.flatMap((s) => s.rows);
const r3 = rows.find((r) => r.product.id === p3.id);
check('raden: 4 stk = 2 pakker, sum = 2 × pakkepris', r3 && r3.qty === 4 && r3.packs === 2 && near(r3.sum, 2 * r3.packPrice, 1e-6), JSON.stringify(r3 && { qty: r3.qty, packs: r3.packs, sum: r3.sum, packPrice: r3.packPrice }));
const txt = shop.text().split('\n').filter((l) => l.includes(p3.name));
check('«Kopier liste»: «4 stk = 2 pakker à 3»', txt.length === 1 && txt[0].includes('4 stk = 2 pakker à 3'), txt.join(' | '));
const csv = shop.csv().split('\r\n');
const c3 = csv.find((l) => l.includes(p3.name))?.split(';') || [];
const cAura = csv.find((l) => l.includes(aura.name))?.split(';') || [];
const num = (s) => Number(String(s).replace(',', '.'));
check('CSV, pakke: antall pakker × pakkepris = sum, stykkene i «Merknad»', c3[3] === '2' && near(num(c3[4]) * 2, num(c3[5]), 0.011) && /4 stk = 2 pakker à 3/.test(c3[6]), c3.join(';'));
check('CSV, desimalpris × 6: øre-avrundet med komma (ingen 2399.3999999999996)', cAura[3] === '6' && cAura[4] === String(aura.priceNok).replace('.', ',') && /^\d+(,\d{1,2})?$/.test(cAura[5]) && near(num(cAura[5]), aura.priceNok * 6, 0.006), cAura.join(';'));
const tot = csv.find((l) => l.startsWith(';Totalt'))?.split(';') || [];
check('CSV «Totalt»: ingen flyttallsstøy', /^\d+(,\d{1,2})?(–\d+(,\d{1,2})?)?$/.test(tot[5] || ''), tot.join(';'));

console.log(`\n(${Date.now() - t0} ms)`);
done();
