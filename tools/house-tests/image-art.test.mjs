#!/usr/bin/env node
/**
 * Own pictures – the pure UI side (design/upload.md §14.2): the frame geometry the dialog relies on
 * (models/artlayout.js through design/imageArt.js), choice ↔ spec, «Bytt bilde» patches, names, the shopping-list
 * section «Egne bilder», and the Inspector extension's / ImageUpload's non-DOM hooks. Node only, no browser.
 *   node tools/house-tests/wip/image-art.test.mjs      (later: node tools/test-house.mjs image-art)
 */
import { registerHooks } from 'node:module';
const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
const { imp, check, section, done } = L;

// panelKit (customArtShopping, imageInspector, ImageUpload) imports a stylesheet: nothing to load in Node
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
const { customArtShoppingSection } = await imp('src/ui/customArtShopping.js');
const { imageInspectorExtension } = await imp('src/ui/imageInspector.js');
const { ImageUpload } = await imp('src/ui/ImageUpload.js');

const near = (a, b, t = 1e-4) => Math.abs(a - b) <= t;
const ID1 = 'img-' + '1'.repeat(28);
const ID2 = 'img-' + '2'.repeat(28);
const img = (id, aspect, name = 'Ferie i Lofoten.jpg') => ({ id, aspect, name, w: 1600, h: Math.round(1600 / aspect) });

// ---------------------------------------------------------------------------------------------------------------
section('1. Rammegeometri (artlayout via imageArt)');
let bad = [];
for (const [key, st] of Object.entries(IA.FRAME_STYLES)) {
  for (const mat of [false, true]) {
    for (const a of [0.5, 0.75, 1, 1.5, 3]) {
      const spec = IA.choiceToSpec({ mode: 'image', long: 0.5, style: key, mat }, img(ID1, a));
      const Lo = A.artLayout(spec.dims, spec.params);
      const openW = a >= 1 ? 0.5 : 0.5 * a;
      const openH = a >= 1 ? 0.5 / a : 0.5;
      if (!near(Lo.openW, openW) || !near(Lo.openH, openH)) bad.push(`${key}/${mat}/${a}: ${Lo.openW.toFixed(4)}×${Lo.openH.toFixed(4)}`);
      if (st.mat === null && spec.params.mat) bad.push(`${key}: mat på lerret/plakat`);
    }
  }
}
check('åpningen = bildets mål for alle rammer × passepartout × formater (±0,1 mm)', !bad.length, bad.slice(0, 4).join('; '));
const tiny = IA.choiceToSpec({ mode: 'image', long: 0.15, style: 'bred', mat: false }, img(ID1, 1));
const Lt = A.artLayout(tiny.dims, tiny.params);
check('20 %-grensen inverteres: 15 cm bilde i «Bred hvit»', near(Lt.openW, 0.15) && near(Lt.openH, 0.15), `${Lt.openW} × ${Lt.openH}, fw ${Lt.fw}`);
const fr = IA.choiceToSpec({ mode: 'frame', frameSize: { w: 0.5, h: 0.7 }, style: 'svart', mat: true, fit: 'contain' }, img(ID1, 1.5));
const Lf = A.artLayout(fr.dims, fr.params);
check('Hele bildet + passepartout: vinduet har bildets format og ligger i åpningen', near(Lf.picW / Lf.picH, 1.5, 1e-3) && Lf.picW <= Lf.openW + 1e-9 && Lf.picH <= Lf.openH + 1e-9 && Lf.draw === 'cover', `${Lf.picW}×${Lf.picH}`);
const fr2 = IA.choiceToSpec({ mode: 'frame', frameSize: { w: 0.5, h: 0.7 }, style: 'svart', mat: false, fit: 'contain' }, img(ID1, 1.5));
check('Hele bildet uten passepartout: draw contain', A.artLayout(fr2.dims, fr2.params).draw === 'contain');
const legacy = A.artLayout({ w: 0.8, h: 1 }, { frame: 'white', frameW: 0.02, texture: 'relief', fit: 'contain' });
check('andre motiver ignorerer fit (som buildArt i dag: åpning 0,75 × 0,95)', near(legacy.openW, 0.75) && near(legacy.openH, 0.95) && legacy.draw === 'cover');
const cr = A.coverRect(400, 300, 1, 1);
const cn = A.containRect(400, 300, 1, 1);
check('coverRect / containRect for 4:3 i 1:1', near(cr.sw, 300) && near(cr.sh, 300) && near(cr.sx, 50) && near(cn.dw, 1) && near(cn.dh, 0.75) && near(cn.dy, 0.125));

// ---------------------------------------------------------------------------------------------------------------
section('2. Valg → spec og tilbake');
const s43 = IA.choiceToSpec({ mode: 'image', long: 0.5, style: 'svart', mat: true }, img(ID1, 4 / 3));
const L43 = A.artLayout(s43.dims, s43.params);
check('etter bildet, 50 cm, 4:3 → åpning 50 × 37,5 cm, beskåret', near(L43.openW, 0.5) && near(L43.openH, 0.375) && s43.params.fit === 'cover');
check('spec-felt: custom, custom-image, kunst, art-frame, vegg, imageId, kant hvit', s43.source === 'custom' && s43.refId === 'custom-image' && s43.category === 'kunst'
  && s43.archetype === 'art-frame' && s43.mount === 'wall' && s43.params.imageId === ID1 && s43.params.motif === 'custom' && s43.params.edge === 'white' && s43.params.depth === s43.dims.d);
check('ingen dataURL i spec-en', !JSON.stringify(s43).includes('data:'));
const land = IA.frameSizesFor(1.5);
check('liggende bilde → liggende rammer (70 × 50 finnes)', land.some((f) => f.key === '70x50' && f.w === 0.7 && f.h === 0.5) && land.every((f) => f.w >= f.h));
check('Snu → stående rammer', IA.frameSizesFor(1.5, { flip: true }).every((f) => f.h >= f.w));
check('kvadratisk bilde → kvadratiske rammer', IA.frameSizesFor(1.01).every((f) => f.w === f.h));
const s70 = IA.choiceToSpec({ mode: 'frame', frameSize: land.find((f) => f.key === '70x50'), style: 'svart', mat: true }, img(ID1, 1.5));
check('rammemål 70 × 50: utvendig 0,7 + 2 × 0,015', near(s70.dims.w, 0.73) && near(s70.dims.h, 0.53), JSON.stringify(s70.dims));
const canv = ['lerret', 'skyggefuge'].map((k) => IA.choiceToSpec({ mode: 'frame', frameSize: { w: 0.5, h: 0.7 }, style: k, mat: true, fit: 'contain' }, img(ID1, 1.5)));
check('lerret får aldri passepartout eller «hele bildet»', canv.every((s) => !s.params.mat && s.params.fit === 'cover' && s.params.texture === 'canvas'));
const choices = [
  { mode: 'image', long: 0.5, style: 'svart', mat: true, fit: 'cover' },
  { mode: 'image', long: 0.85, style: 'eik', mat: false, fit: 'cover' },
  { mode: 'image', long: 0.3, style: 'lerret', mat: false, fit: 'cover' },
  { mode: 'frame', frameSize: land[3], style: 'hvit', mat: true, fit: 'contain' },
  { mode: 'frame', frameSize: land[1], style: 'messing', mat: false, fit: 'cover' },
];
bad = [];
const same = (x, y) => JSON.stringify([x.dims, x.params]) === JSON.stringify([y.dims, y.params]);
for (const c of choices) {
  const spec = IA.choiceToSpec(c, img(ID1, 4 / 3));
  const back = IA.specToChoice(spec);
  // a standard frame whose opening has the picture's own shape reads back as «etter bildet» – the same item
  const ambiguous = c.mode === 'frame' && near(c.frameSize.w / c.frameSize.h, 4 / 3, 1e-3);
  const ok = same(IA.choiceToSpec(back, img(ID1, 4 / 3)), spec) && back.style === c.style && back.mat === c.mat && back.fit === c.fit
    && (ambiguous || back.mode === c.mode) && (c.mode === 'image' ? near(back.long, c.long) : ambiguous || back.frameSize?.key === c.frameSize.key);
  if (!ok) bad.push(`${JSON.stringify(c)} → ${JSON.stringify(back)}`);
}
check('specToChoice(choiceToSpec(c)) gir samme valg (og samme ting)', !bad.length, bad.join(' | '));
const ds = new DesignState();
const uid = ds.add({ ...s43, position: [4.3, 1.5, 11.93], attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] } });
check('spec-en går uendret gjennom DesignState', JSON.stringify(ds.get(uid).params) === JSON.stringify(s43.params) && JSON.stringify(ds.get(uid).dims) === JSON.stringify(s43.dims));
const d43 = IA.describe(ds.get(uid));
check('describe: «Bilde 50 × 38 cm», utvendig, ramme', d43.picText === 'Bilde 50 × 38 cm' && /^utvendig \d+ × \d+ cm$/.test(d43.outerText) && d43.frameText === 'smal svart ramme · passepartout', JSON.stringify(d43));
check('skarphet: 4032 px på 50 cm er skarpt, 640 px på 1 m er uskarpt', IA.sharpness(4032, 0.5).ppi >= 150 && !IA.sharpness(4032, 0.5).warn && IA.sharpness(640, 1).warn);

// ---------------------------------------------------------------------------------------------------------------
section('3. «Bytt bilde»');
const own = ds.get(uid);
const p1 = IA.imagePatch(own, img(ID2, 0.75, 'Portrett.png'));
const Lp = A.artLayout(p1.dims, p1.params);
check('eget bilde, etter bildet: rammen følger nytt format, lengste side beholdes', near(Math.max(Lp.openW, Lp.openH), 0.5) && near(Lp.openW / Lp.openH, 0.75, 1e-3) && p1.params.imageId === ID2 && p1.name === 'Eget bilde – Portrett');
const ufr = ds.add({ ...s70, position: [5.3, 1.5, 11.93], attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] } });
const p2 = IA.imagePatch(ds.get(ufr), img(ID2, 1));
check('eget bilde i rammemål: rammen beholder målene', near(p2.dims.w, ds.get(ufr).dims.w) && near(p2.dims.h, ds.get(ufr).dims.h) && p2.params.imageId === ID2);
const acu = catalog.getProduct('akustikksenter-akustikkbilde-180x120');
const acuSpec = acu && catalog.productToItemSpec(acu, 0);
check('akustikkbilde med «eget motiv» tar imot bilde', !!acuSpec && IA.acceptsImage(acuSpec));
const p3 = acuSpec && IA.imagePatch({ ...acuSpec, uid: 'x' }, img(ID2, 1.5));
check('katalogprodukt: bare bildeparametre, kilde og mål blir', !!p3 && !('source' in p3) && !('dims' in p3) && p3.params.motif === 'custom' && p3.params.imageId === ID2 && p3.params.fit === 'cover');
const orig = new DesignState().get('ex-f-maleri');
const p4 = orig && IA.imagePatch(orig, img(ID2, 1.5, 'Hytta.jpg'));
check('maleriet i stua blir eget bilde i samme ramme', !!p4 && p4.source === 'custom' && p4.refId === 'custom-image' && p4.name === 'Eget bilde – Hytta' && !('dims' in p4) && p4.params.motif === 'custom' && p4.params.frameStyle === 'lerret');
const dsM = new DesignState();
dsM.update('ex-f-maleri', p4);
const conv = dsM.get('ex-f-maleri');
check('det konverterte maleriet beholder mål og farger', JSON.stringify(conv.dims) === JSON.stringify(orig.dims) && conv.colors.frame === orig.colors.frame && IA.isUploadedImage(conv) && IA.hasImage(conv));
const cp = IA.choicePatch(own, img(ID1, 4 / 3), { ...IA.specToChoice(own), style: 'eik', mat: false });
check('«Tilpass»: ny ramme, navnet beholdes', cp.name === own.name && cp.params.frameStyle === 'eik' && cp.materials.frame === 'oak' && cp.params.mat === false);

// ---------------------------------------------------------------------------------------------------------------
section('4. Navn');
check('IMG_2024.JPG → «Eget bilde – IMG_2024»', IA.uploadedName('IMG_2024.JPG') === 'Eget bilde – IMG_2024', IA.uploadedName('IMG_2024.JPG'));
check('tomt navn → «Eget bilde»', IA.uploadedName('') === 'Eget bilde' && IA.uploadedName(null) === 'Eget bilde');
check('120 tegn → høyst 63', IA.uploadedName('x'.repeat(120) + '.png').length <= 63);
check('sti og mellomrom ryddes', IA.uploadedName('C:\\fakepath\\Ferie   i  Lofoten.jpeg') === 'Eget bilde – Ferie i Lofoten');

// ---------------------------------------------------------------------------------------------------------------
section('5. Handlelisten «Egne bilder»');
const dsS = new DesignState({ original: false });
dsS.add({ ...s43, position: [4.3, 1.5, 11.93], attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] } });
dsS.add({ ...s43, position: [4.9, 1.5, 11.93], attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] } });
dsS.add({ ...acuSpec, ...p3, params: { ...acuSpec.params, ...p3.params }, position: [3.0, 1.5, 11.93], attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] } });
dsS.add({ ...s70, hidden: true, position: [6.0, 1.5, 11.93] });
const store = new IS.ImageStore({ backend: IS.memBackend(new Map()) });
const fakeEditor = { design: dsS, catalog, home: { images: store } };
const secS = customArtShoppingSection({ editor: fakeEditor });
const dataS = secS.list(fakeEditor);
check('to rader: to like egne bilder slås sammen, akustikkbildet har produkt', dataS?.rows.length === 2 && dataS.rows.some((r) => r.product?.id === acu.id && r.store) && dataS.rows.some((r) => !r.product && r.qty === 2), JSON.stringify(dataS?.rows.map((r) => [r.name, r.qty, r.product?.id])));
check('skjulte ting er ikke med', dataS.rows.reduce((s, r) => s + r.qty, 0) === 3);
const txt = secS.text(dataS);
check('text() starter med EGNE BILDER og sier «bestill selv»', txt[0] === 'EGNE BILDER' && txt.some((l) => /bestill selv/.test(l)), txt.join(' | '));
const csv = secS.csv(dataS);
check('csv(): 8 celler per rad', csv.length === 2 && csv.every((r) => r.length === 8 && r[0] === 'Egne bilder'));
check('print() lager en tabell med overskrift', /^<h2>Egne bilder<\/h2><table>/.test(secS.print(dataS, (s) => String(s))));
check('ingen rader → null', secS.list({ design: new DesignState({ original: false }), catalog }) === null);

// ---------------------------------------------------------------------------------------------------------------
section('6. Inspector-utvidelsen og ImageUpload uten DOM');
const ext = imageInspectorExtension({ design: ds, ui: {}, events: null, catalog }, { images: store });
const fakeInsp = { _original: () => null };
const hOwn = ext.hide(fakeInsp, own);
check('eget bilde: størrelse og parametre i «Bilde», ingen Tilbakestill uten original', hOwn?.size === true && hOwn.params === true && hOwn.parts.includes('print') && hOwn.reset === true);
const hCat = ext.hide(fakeInsp, { ...acuSpec, ...p3, params: { ...acuSpec.params, ...p3.params } });
check('katalogramme med bilde: motivparametre skjules', !hCat?.size && hCat?.params?.includes('motif'));
check('uten bilde: ingenting skjules', ext.hide(fakeInsp, orig) === null);
const frames = [{ id: 'a', archetype: 'art-frame', params: { acceptsImage: true } }, { id: 'b', archetype: 'art-frame', params: { motif: 'abstract' } }];
check('«Bytt modell» med bilde: bare rammer som tar imot bilde', JSON.stringify(ext.candidates(fakeInsp, own, null, frames).map((p) => p.id)) === '["a"]' && ext.candidates(fakeInsp, orig, null, frames).length === 2);
const carried = ext.carry(fakeInsp, own, { archetype: 'art-frame', params: { acceptsImage: true, motif: 'abstract' } });
check('bildet følger med til en ramme som tar imot bilde', carried.params.imageId === ID1 && carried.params.motif === 'custom' && carried.params.acceptsImage === true);
check('… men ikke til et vanlig maleri', ext.carry(fakeInsp, own, { archetype: 'art-frame', params: { motif: 'abstract' } }).params.imageId === undefined);
const back = ext.carry({ _original: () => orig }, conv, { ...orig, source: conv.source, name: conv.name });
check('«Tilbakestill» av det konverterte maleriet gir maleriet tilbake med navn og kilde', back.source === 'existing' && back.name === orig.name && back.params.motif === orig.params.motif && back.params.imageId === undefined);
ext.dispose();

const hooks = [];
const events = { emit: (n, p) => hooks.push(['event', n, p?.text]) };
const dsU = new DesignState();
const uidU = dsU.add({ ...s43, position: [4.3, 1.5, 11.93], attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] } });
const editorU = {
  design: dsU,
  catalog,
  events,
  home: { images: store },
  ui: {
    catalog: { addPinned: () => (hooks.push('pinned'), () => {}), addDetailAction: () => (hooks.push('detail'), () => {}) },
    inspector: { addExtension: () => (hooks.push('ext'), () => {}), _fit: (u, p) => ({ patch: p, capped: [], status: 'ok' }) },
    shopping: { addSection: () => (hooks.push('section'), () => {}) },
  },
};
const up = new ImageUpload(editorU);
check('ImageUpload kobler seg på katalog, inspector og handleliste', ['pinned', 'detail', 'ext', 'section'].every((k) => hooks.includes(k)));
check('artCategory = kunst', up.artCategory === 'kunst' && up.images === store);
const hist = dsU.historySize;
const okU = up.apply(uidU, IA.imagePatch(dsU.get(uidU), img(ID2, 1, 'Kvadrat.png')), 'Bytt bilde');
check('apply: ett angresteg, nytt bilde', okU && dsU.historySize === hist + 1 && dsU.get(uidU).params.imageId === ID2 && dsU.undoLabel === 'Bytt bilde');
editorU.ui.inspector._fit = (u, p) => ({ patch: p, capped: [], status: 'blocked' });
check('apply: får ikke plass → false og en melding', up.apply(uidU, { dims: { w: 3, h: 3 } }, 'Endre') === false && hooks.some((x) => Array.isArray(x) && /får ikke plass/.test(x[2] || '')));
check('catalogCard: ikke i andre kategorier', up.catalogCard({ category: 'sofa', query: '' }) === null && up.catalogCard({ category: 'kunst', query: 'sofa' }) === null);
up.dispose();

console.log(`\n(${Date.now() - t0} ms)`);
done();
