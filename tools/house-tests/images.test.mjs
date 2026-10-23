#!/usr/bin/env node
/**
 * Uploaded pictures (no browser): ImageStore helpers, the store on a Map backend, Saves (ids only in localStorage,
 * export embeds, import re-hydrates), missing pictures, import validation, garbage collection
 * (design/upload.md §14.1 checks 1–15 + qa.md §3.2 checks 12–15 and 17).
 *   node tools/house-tests/wip/images.test.mjs     (later: node tools/test-house.mjs images; exit code 1 on failure)
 */
const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
const { imp, check, section, done } = L;
import { deflateSync, crc32 } from 'node:zlib';

const t0 = Date.now();
const { DesignState } = await imp('src/design/DesignState.js');
const { Saves, STORAGE_KEY, BACKUP_KEY, MAX_DESIGN_FILE_BYTES } = await imp('src/design/Saves.js');
const IS = await imp('src/design/ImageStore.js');

const memStorage = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, c]);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A real, decodable PNG (w × h, one colour). */
function makePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + 3 * w);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + 3 * x);
  return new Uint8Array(Buffer.concat([PNG_SIG, chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]));
}
/** A PNG whose header says w × h with `n` bytes of noise as IDAT (no decoder in Node: size and hash only). */
function bigPng(w, h, n, seed = 1) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const noise = Buffer.alloc(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    noise[i] = s >>> 24;
  }
  return new Uint8Array(Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', noise), chunk('IEND', Buffer.alloc(0))]));
}
const JPEG_HDR = (w, h) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const WEBP_VP8X = (w, h) => {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0], 8);
  b[24] = (w - 1) & 255; b[25] = ((w - 1) >> 8) & 255; b[26] = (w - 1) >> 16;
  b[27] = (h - 1) & 255; b[28] = ((h - 1) >> 8) & 255; b[29] = (h - 1) >> 16;
  return b;
};
const PNG = makePng(3, 2, [200, 40, 160]);
const OTHER = makePng(4, 4, [20, 180, 220]);
const sameBytes = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** The item of upload.md §1.1 on the west wall of the living room. */
const SPEC = (imageId) => ({
  source: 'custom', refId: 'custom-image', name: 'Eget bilde – Ferie i Lofoten', category: 'kunst',
  archetype: 'art-frame', mount: 'wall', rotationDeg: 0, position: [4.3, 1.5, 11.93],
  attach: { wallId: 'w-vest-stue', normal: [0, 0, -1] },
  dims: { w: 0.6, d: 0.025, h: 0.48 },
  params: {
    motif: 'custom', imageId, imageAspect: 1.3333, fit: 'cover', frameStyle: 'svart', frame: 'black', frameW: 0.015,
    mat: true, matW: 0.05, matColor: '#f3f0e9', texture: 'photo', depth: 0.025, edge: 'white',
  },
  colors: { print: '#e6e2da', frame: '#151515' },
  materials: { print: 'paper', frame: 'black-metal' },
});

// ---------------------------------------------------------------------------------------------------------------
section('1. Hjelpefunksjoner');
const h1 = IS.hashBytes(PNG);
check('hashBytes gir img- + 28 hex', IS.IMAGE_ID.test(h1) && h1.length === 32, h1);
check('hashBytes er deterministisk og skiller bilder', IS.hashBytes(PNG) === h1 && IS.hashBytes(OTHER) !== h1);
check('sniffMime png / jpeg / webp', IS.sniffMime(PNG) === 'image/png' && IS.sniffMime(JPEG_HDR(640, 480)) === 'image/jpeg' && IS.sniffMime(WEBP_VP8X(1600, 900)) === 'image/webp');
check('sniffKind gif / heic / svg / avif', IS.sniffKind(ascii('GIF89a\0\0\0\0')) === 'gif' && IS.sniffKind(ascii('\0\0\0\x18ftypheic\0\0\0\0')) === 'heic'
  && IS.sniffKind(ascii('  <svg xmlns="x"/>')) === 'svg' && IS.sniffKind(ascii('\0\0\0\x18ftypavif\0\0\0\0')) === 'avif');
check('sniffMime nekter gif og svg', IS.sniffMime(ascii('GIF89a\0\0')) === null && IS.sniffMime(ascii('<svg/>')) === null);
const szP = IS.imageSize(PNG), szJ = IS.imageSize(JPEG_HDR(640, 480)), szW = IS.imageSize(WEBP_VP8X(1600, 900));
check('imageSize png 3×2, jpeg 640×480, webp 1600×900', szP?.w === 3 && szP?.h === 2 && szJ?.w === 640 && szJ?.h === 480 && szW?.w === 1600 && szW?.h === 900,
  JSON.stringify([szP, szJ, szW]));
const rt = IS.dataUrlToBytes(IS.bytesToDataUrl(PNG, 'image/png'));
check('dataURL fram og tilbake gir samme bytes', rt?.mime === 'image/png' && sameBytes(rt.bytes, PNG));
check('dataUrlToBytes(søppel) = null', IS.dataUrlToBytes('garbage') === null && IS.dataUrlToBytes('data:image/png,abc') === null);
check('cleanName fjerner sti og kontrolltegn', IS.cleanName('C:\\fakepath\\Ferie\u0001 2024.JPG') === 'Ferie 2024.JPG', IS.cleanName('C:\\fakepath\\Ferie\u0001 2024.JPG'));
const idA = 'img-' + 'a'.repeat(28), idB = 'img-' + 'b'.repeat(28), idC = 'img-' + 'c'.repeat(28);
const refItems = [
  { params: { imageId: idA } },
  { params: { imageId: 'img-xyz' } },
  { params: { imageId: idA } },
  { source: 'catalog', archetype: 'acoustic-art', params: { motif: 'custom', imageId: idB } },
  { params: { frames: [{ imageId: idC }, { imageId: 'nope' }] } },
];
const r1 = [...IS.imageRefs({ items: refItems })];
const r2 = [...IS.imageRefs({ items: Object.fromEntries(refItems.map((it, i) => [`u${i}`, it])) })];
const r3 = [...IS.imageRefs(refItems)];
check('imageRefs: samme mengde fra liste, objekt og tabell; dropper feil id; uten duplikater',
  JSON.stringify(r1) === JSON.stringify([idA, idB, idC]) && JSON.stringify(r2) === JSON.stringify(r1) && JSON.stringify(r3) === JSON.stringify(r1), JSON.stringify(r1));
check('imageRefs(null) er tom', IS.imageRefs(null).size === 0 && IS.imageRefs({}).size === 0);
check('itemImageId', IS.itemImageId({ params: { imageId: idA } }) === idA && IS.itemImageId({ params: { imageId: 'x' } }) === null);

// ---------------------------------------------------------------------------------------------------------------
section('2. Lageret på en Map');
const dbA = new Map();
const storeA = new IS.ImageStore({ backend: IS.memBackend(dbA, { persistent: true }) });
const id = await storeA.putBytes(PNG, { mime: 'image/png', w: 3, h: 2, name: 'katt.png' });
const infoA = storeA.info(id);
check('putBytes lagrer i bakenden', IS.IMAGE_ID.test(id) && dbA.has(id) && storeA.status(id) === 'loaded');
check('info: 3 × 2, aspect 1,5, lagret', infoA?.w === 3 && infoA?.h === 2 && infoA?.aspect === 1.5 && infoA?.persisted === true && infoA?.name === 'katt.png', JSON.stringify(infoA));
check('samme bytes igjen → samme id, én post', (await storeA.putBytes(PNG, { mime: 'image/png' })) === id && dbA.size === 1);
check('Node har ingen dekoder: getSync null, request null uten feil', storeA.getSync(id) === null && (await storeA.request(id)) === null && storeA.status(id) === 'loaded');
check('ArtImageSource-grensesnittet finnes', ['getSync', 'request', 'onReady', 'onMissing', 'status', 'info'].every((k) => typeof storeA[k] === 'function'));

// ---------------------------------------------------------------------------------------------------------------
section('3. Bildet overlever DesignState');
const dsA = new DesignState();
const uid = dsA.add(SPEC(id));
const got = dsA.get(uid);
const want = SPEC(id);
check('alle parametre fra §1.1 er like etter add → get', Object.entries(want.params).every(([k, v]) => JSON.stringify(got.params[k]) === JSON.stringify(v)), JSON.stringify(got.params));
check('refId custom-image, source custom, kategori kunst', got.refId === 'custom-image' && got.source === 'custom' && got.category === 'kunst' && got.archetype === 'art-frame');
check('mål, farger og materialer beholdes', JSON.stringify(got.dims) === JSON.stringify(want.dims) && got.colors.print === '#e6e2da' && got.materials.frame === 'black-metal');

// ---------------------------------------------------------------------------------------------------------------
section('4. Saves lagrer bare id-en');
const lsA = memStorage();
const savesA = new Saves(dsA, { storage: lsA, images: storeA, autosave: false });
check('Saves får bildelageret', savesA.images === storeA && savesA.lastImport === null && Array.isArray(savesA.lastExportMissing));
check('lagret som «Med bilde»', savesA.save('Med bilde') === 'Med bilde');
const stored1 = lsA.getItem(STORAGE_KEY) || '';
check('localStorage har id-en, ingen data:image, < 150 kB', stored1.includes(id) && !stored1.includes('data:image') && stored1.length < 150000, `${stored1.length} tegn`);
savesA.enableAutosave();
dsA.update(uid, { position: [4.5, 1.5, 11.93] });
savesA.autosaveNow();
const stored2 = lsA.getItem(STORAGE_KEY) || '';
check('autosave: fortsatt ingen data:image', stored2.includes(id) && !stored2.includes('data:image'));
check('list() teller egne bilder', savesA.list().find((r) => r.name === 'Med bilde')?.imageCount === 1);

// ---------------------------------------------------------------------------------------------------------------
section('5. Historikken holder seg liten');
for (let i = 0; i < 50; i++) dsA.update(uid, { position: [4.3 + (i % 10) * 0.01, 1.5, 11.93] });
const undoLen = JSON.stringify(dsA._undo).length;
check('50 flyttinger: angre-historikken < 200 000 tegn', undoLen < 200000, `${undoLen}`);
dsA.remove(uid);
dsA.undo();
check('fjern + angre gir imageId tilbake', dsA.get(uid)?.params.imageId === id);
savesA.disableAutosave();

// ---------------------------------------------------------------------------------------------------------------
section('6. Ny innlasting i samme nettleser');
const storeB = new IS.ImageStore({ backend: IS.memBackend(dbA, { persistent: true }) });
const dsB = new DesignState();
const savesB = new Saves(dsB, { storage: lsA, images: storeB, autosave: false });
check('«Med bilde» åpnes', savesB.load('Med bilde'));
const frameB = dsB.list().find((it) => it.params?.imageId);
check('rammen har samme imageId', frameB?.params.imageId === id);
const ldB = await storeB.load([id]);
check('load → ready [id], ingen mangler', JSON.stringify(ldB) === JSON.stringify({ ready: [id], missing: [] }), JSON.stringify(ldB));
check('bytene er identiske', sameBytes(storeB.bytesOf(id), PNG));

// ---------------------------------------------------------------------------------------------------------------
section('7. Eksport');
const text = savesA.exportText();
const ej = JSON.parse(text);
const emb = ej.images?.[id];
check('eksporten har images[id] som PNG-dataURL', typeof emb?.data === 'string' && emb.data.startsWith('data:image/png;base64,'));
check('dekodede bytes er like', sameBytes(IS.dataUrlToBytes(emb?.data)?.bytes, PNG));
check('w, h og navn følger med', emb?.w === 3 && emb?.h === 2 && emb?.name === 'katt.png' && emb?.mime === 'image/png');
check('images er siste nøkkel', Object.keys(ej).at(-1) === 'images', Object.keys(ej).join(','));
check('ingen mangler i eksporten', savesA.lastExportMissing.length === 0);
const noStore = new Saves(dsA, { storage: memStorage(), autosave: false }).exportText();
check('uten lager: ingen images-nøkkel, lik eksport med images:false', !('images' in JSON.parse(noStore)) && noStore === savesA.exportText(undefined, { images: false }));
const plainDs = new DesignState();
const withStore = new Saves(plainDs, { storage: memStorage(), images: storeA, autosave: false }).exportText();
const withoutStore = new Saves(plainDs, { storage: memStorage(), autosave: false }).exportText();
check('design uten bilder: eksporten er lik med og uten lager', withStore === withoutStore);

// ---------------------------------------------------------------------------------------------------------------
section('8. Eksport laster først');
const storeC0 = new IS.ImageStore({ backend: IS.memBackend(dbA, { persistent: true }) });
check('exportSync uten bytes i minnet: mangler [id]', JSON.stringify(storeC0.exportSync([id]).missing) === JSON.stringify([id]));
check('export() henter bytene fra bakenden', !!(await storeC0.export([id])).images[id]);

// ---------------------------------------------------------------------------------------------------------------
section('9. Import i en annen nettleser');
const dbC = new Map();
const storeC = new IS.ImageStore({ backend: IS.memBackend(dbC, { persistent: true }) });
const lsC = memStorage();
const dsC = new DesignState();
const savesC = new Saves(dsC, { storage: lsC, images: storeC, autosave: false });
const nameC = savesC.importText(text);
const flC = await storeC.flush();
check('importText gir et navn og flush er ok', typeof nameC === 'string' && nameC.length > 0 && flC.ok, JSON.stringify(flC));
check('bakenden har bildet', dbC.has(id));
check('lastImport.added = [id]', JSON.stringify(savesC.lastImport?.added) === JSON.stringify([id]), JSON.stringify(savesC.lastImport));
const storedC = JSON.parse(lsC.getItem(STORAGE_KEY) || '{}');
check('lagret design har ingen images-nøkkel og ingen data:image', !('images' in (storedC.designs?.[nameC] || { images: 1 })) && !(lsC.getItem(STORAGE_KEY) || '').includes('data:image'));
check('tingene er identiske', JSON.stringify(dsC.toJSON().items) === JSON.stringify(dsA.toJSON().items));
savesC.importText(text);
check('samme fil igjen: existing [id], ingenting avvist', JSON.stringify(savesC.lastImport.existing) === JSON.stringify([id]) && savesC.lastImport.rejected.length === 0 && savesC.lastImport.added.length === 0);
const nameC3 = await savesC.importFile(new Blob([text]));
check('importFile(Blob) gir et navn, unsaved = []', typeof nameC3 === 'string' && Array.isArray(savesC.lastImport.unsaved) && savesC.lastImport.unsaved.length === 0);

// ---------------------------------------------------------------------------------------------------------------
section('10. Bilde som mangler');
const storeD = new IS.ImageStore({ backend: IS.memBackend(new Map(), { persistent: true }) });
const dsD = new DesignState();
const savesD = new Saves(dsD, { storage: memStorage(), images: storeD, autosave: false });
let missCalls = 0;
const offMiss = storeD.onMissing(id, () => missCalls++);
const jNo = JSON.parse(text);
delete jNo.images;
savesD.importText(JSON.stringify(jNo));
const ldD = await storeD.load([id]);
check('load → missing [id], status missing', JSON.stringify(ldD.missing) === JSON.stringify([id]) && storeD.status(id) === 'missing', JSON.stringify(ldD));
check('onMissing kalt én gang', missCalls === 1, `${missCalls}`);
offMiss();
const itD = dsD.list().find((it) => it.params?.imageId);
check('tingen beholder imageId', itD?.params.imageId === id);
const histD = dsD.historySize;
const impD = storeD.import({ [id]: IS.bytesToDataUrl(PNG, 'image/png') });
check('senere import med bar dataURL: added [id], status loaded', JSON.stringify(impD.added) === JSON.stringify([id]) && storeD.status(id) === 'loaded', JSON.stringify(impD));
check('designet er urørt', dsD.historySize === histD && dsD.list().find((it) => it.params?.imageId)?.params.imageId === id);

// ---------------------------------------------------------------------------------------------------------------
section('11. Kontroll av importerte bilder');
const storeE = new IS.ImageStore({ backend: IS.memBackend(new Map(), { persistent: true }) });
const reasonOf = (res, key) => res.rejected.find((r) => r.id === key)?.reason;
const patched = new Uint8Array(PNG);
new DataView(patched.buffer).setUint32(16, 5000);
new DataView(patched.buffer).setUint32(20, 10);
const big = new Uint8Array(9 * 1024 * 1024);
big.set(PNG_SIG, 0);
const fakeId = 'img-' + '0'.repeat(28);
const badMap = {
  'img-123': IS.bytesToDataUrl(PNG, 'image/png'),
  [IS.hashBytes(ascii('<svg/>'))]: 'data:image/svg+xml;base64,PHN2Zy8+',
  [IS.hashBytes(OTHER)]: IS.bytesToDataUrl(OTHER, 'image/jpeg'),
  [fakeId]: IS.bytesToDataUrl(PNG, 'image/png'),
  [IS.hashBytes(big)]: IS.bytesToDataUrl(big, 'image/png'),
  [IS.hashBytes(patched)]: IS.bytesToDataUrl(patched, 'image/png'),
};
const resE = storeE.import(badMap);
check('feil id → id', reasonOf(resE, 'img-123') === 'id');
check('svg → mime', reasonOf(resE, IS.hashBytes(ascii('<svg/>'))) === 'mime');
check('PNG oppgitt som JPEG → mime', reasonOf(resE, IS.hashBytes(OTHER)) === 'mime');
check('id som ikke er hashen → hash', reasonOf(resE, fakeId) === 'hash');
check('9 MB → size', reasonOf(resE, IS.hashBytes(big)) === 'size');
check('5000 × 10 px → pixels', reasonOf(resE, IS.hashBytes(patched)) === 'pixels');
check('ingenting lagt til', resE.added.length === 0 && resE.rejected.length === 6, JSON.stringify(resE.rejected));
const many = {};
for (let i = 0; i < 201; i++) {
  const p = makePng(1, 1, [i % 256, (i * 7) % 256, Math.floor(i / 256) + 1]);
  many[IS.hashBytes(p)] = IS.bytesToDataUrl(p, 'image/png');
}
const resMany = new IS.ImageStore({ backend: IS.memBackend(new Map()) }).import(many);
check('201 bilder: 200 lagt til, 1 count', resMany.added.length === 200 && resMany.rejected.length === 1 && resMany.rejected[0].reason === 'count');
const jBad = JSON.parse(text);
jBad.images = { ...jBad.images, ...badMap };
const savesE = new Saves(new DesignState(), { storage: memStorage(), images: storeE, autosave: false });
const nameE = savesE.importText(JSON.stringify(jBad));
check('importText med dårlige bilder gir likevel et navn', typeof nameE === 'string' && savesE.lastImport.rejected.length === 6 && savesE.lastImport.added.length === 1);

// ---------------------------------------------------------------------------------------------------------------
section('12. Full lagringsplass');
// the store logs failed writes with console.warn – expected here
const warn0 = console.warn;
console.warn = () => {};
const quota = () => Promise.reject(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
const fullMap = new Map();
const fullBe = { ...IS.memBackend(fullMap, { persistent: true }), put: quota };
const storeF = new IS.ImageStore({ backend: fullBe });
const idF = await storeF.putBytes(PNG, { mime: 'image/png' });
check('putBytes gir id selv om skrivingen feiler', idF === id && storeF.has(idF) && storeF.info(idF)?.persisted === false && !fullMap.has(idF));
const storeG = new IS.ImageStore({ backend: { ...IS.memBackend(new Map(), { persistent: true }), put: quota } });
const errs = [];
storeG.on('error', (e) => errs.push(e));
storeG.import({ [id]: IS.bytesToDataUrl(PNG, 'image/png') });
const flG = await storeG.flush();
check('import i fullt lager: flush ok false, failed [id]', flG.ok === false && JSON.stringify(flG.failed) === JSON.stringify([id]), JSON.stringify(flG));
check('error-hendelse med norsk tekst', errs.length === 1 && typeof errs[0].message === 'string' && errs[0].message.length > 10 && storeG.info(id)?.persisted === false);
const savesG = new Saves(new DesignState(), { storage: memStorage(), images: new IS.ImageStore({ backend: { ...IS.memBackend(new Map(), { persistent: true }), put: quota } }), autosave: false });
await savesG.importFile(new Blob([text]));
check('importFile: unsaved = [id] når lagringen feiler', JSON.stringify(savesG.lastImport.unsaved) === JSON.stringify([id]), JSON.stringify(savesG.lastImport));
check('… med grunnen «quota» (lagringsplassen er full)', savesG.lastImport.unsavedReason === 'quota' && /full/.test(IS.MSG.importUnsaved));
console.warn = warn0;
// a browser that keeps no pictures at all (IndexedDB blocked, private window): the reason is not «full»
const savesMem = new Saves(new DesignState(), { storage: memStorage(), images: new IS.ImageStore({ backend: 'memory' }), autosave: false });
await savesMem.importFile(new Blob([text]));
check('importFile uten IndexedDB: unsaved = [id], grunn «memory», teksten sier ikke «full»', JSON.stringify(savesMem.lastImport.unsaved) === JSON.stringify([id])
  && savesMem.lastImport.unsavedReason === 'memory' && !/full/.test(IS.MSG.importMemory) && /privat vindu/.test(IS.MSG.importMemory), JSON.stringify(savesMem.lastImport));
check('vellykket import har ingen grunn', savesC.lastImport.unsavedReason === undefined);

// ---------------------------------------------------------------------------------------------------------------
section('13. Opprydding (GC)');
const idO = await storeA.putBytes(OTHER, { mime: 'image/png', name: 'annet.png' });
const roots = new Set([id]);
check('innenfor fristen slettes ingenting', (await storeA.gc(roots)).length === 0 && dbA.has(idO));
const before = dbA.get(id).lastUsedAt;
const del = await storeA.gc(roots, 14, { now: Date.now() + 30 * 864e5 });
check('etter 30 dager slettes bare det ubrukte', JSON.stringify(del) === JSON.stringify([idO]) && dbA.has(id) && !dbA.has(idO) && !storeA.has(idO), JSON.stringify(del));
check('lastUsedAt for bildet i bruk er oppdatert', dbA.get(id).lastUsedAt > before);
await storeA.putBytes(OTHER, { mime: 'image/png' });
const ro = new IS.ImageStore({ backend: IS.memBackend(dbA, { persistent: true }), readOnly: true });
check('readOnly sletter ingenting', (await ro.gc(new Set(), 14, { now: Date.now() + 90 * 864e5 })).length === 0 && dbA.has(idO));
check('gc(null) = []', (await storeA.gc(null)).length === 0 && dbA.has(idO));

section('13b. Samme bilde lastet opp igjen');
const DAY = 864e5;
const T_OLD = Date.now() - 30 * DAY;
const dbU = new Map();
const oldStore = new IS.ImageStore({ backend: IS.memBackend(dbU, { persistent: true }), now: () => T_OLD });
const idU = await oldStore.putBytes(OTHER, { mime: 'image/png', name: 'gammel.png' });
await oldStore.putBytes(PNG, { mime: 'image/png', name: 'nyere.png' });
dbU.get(id).createdAt = dbU.get(id).lastUsedAt = T_OLD + DAY; // newer than idU, still old
// next session: the old picture is only in the backend
const storeU = new IS.ImageStore({ backend: IS.memBackend(dbU, { persistent: true }) });
const tU = Date.now();
check('samme bytes (kun i bakenden) → samme id', (await storeU.putBytes(OTHER, { mime: 'image/png', name: 'ny.png' })) === idU);
const infoU = storeU.info(idU);
check('… teller som lastet opp nå: createdAt, lastUsedAt og det nye navnet, også i bakenden', infoU?.createdAt >= tU && infoU?.lastUsedAt >= tU && infoU?.name === 'ny.png'
  && dbU.get(idU).lastUsedAt >= tU && dbU.get(idU).createdAt >= tU && dbU.get(idU).name === 'ny.png' && infoU.persisted === true, JSON.stringify(infoU));
check('… og står øverst i «Nylig lastet opp»', (await storeU.list())[0]?.id === idU);
const delU = await storeU.gc(new Set());
check('… og ryddes ikke bort (det andre gamle bildet gjør det)', JSON.stringify(delU) === JSON.stringify([id]) && dbU.has(idU), JSON.stringify(delU));
// the same in memory (listed under «Nylig lastet opp», never used): a re-upload is a new upload too
const storeU2 = new IS.ImageStore({ backend: IS.memBackend(dbU, { persistent: true }) });
dbU.get(idU).createdAt = dbU.get(idU).lastUsedAt = T_OLD;
await storeU2.list();
check('i minnet fra listen med gammel dato', storeU2.has(idU) && storeU2.info(idU).lastUsedAt === T_OLD);
await storeU2.putBytes(OTHER, { mime: 'image/png' });
check('samme bytes (i minnet) → oppdatert, navnet beholdes uten nytt navn', storeU2.info(idU).lastUsedAt >= tU && dbU.get(idU).lastUsedAt >= tU && storeU2.info(idU).name === 'ny.png');
check('… og ryddes ikke bort', !(await storeU2.gc(new Set())).includes(idU) && dbU.has(idU));

section('13c. Opprydding mens bildet brukes igjen');
/** A backend whose writes take a few ms (gc's root bumps keep it inside its loop) on a fresh map. */
const slowDb = () => {
  const m = new Map();
  const be = IS.memBackend(m, { persistent: true });
  return { m, be: { ...be, put: (rec) => new Promise((r) => setTimeout(() => be.put(rec).then(r), 4)) } };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Five roots unused for more than a day, then one picture unused for 30 days (in the backend only). */
async function staleSetup(m) {
  const seed = new IS.ImageStore({ backend: IS.memBackend(m, { persistent: true }), now: () => T_OLD });
  const rootIds = [];
  for (let i = 0; i < 5; i++) rootIds.push(await seed.putBytes(makePng(2, 2, [i * 40, 90, 200]), { mime: 'image/png' }));
  const stale = await seed.putBytes(makePng(5, 3, [250, 200, 10]), { mime: 'image/png', name: 'gammel.png' });
  return { roots: new Set(rootIds), stale, bytes: makePng(5, 3, [250, 200, 10]) };
}
{
  const { m, be } = slowDb();
  const { roots: rs, stale, bytes } = await staleSetup(m);
  const st = new IS.ImageStore({ backend: be });
  const run = st.gc(rs);
  await wait(6); // gc has its snapshot and bumps the roots
  const res = st.import({ [stale]: IS.bytesToDataUrl(bytes, 'image/png') });
  const delG = await run;
  await st.flush();
  check('import mens gc går: bildet slettes ikke (minne og bakende)', res.added.includes(stale) && !delG.includes(stale) && st.has(stale) && m.has(stale), JSON.stringify({ added: res.added, delG }));
}
{
  const { m, be } = slowDb();
  const { roots: rs, stale, bytes } = await staleSetup(m);
  const st = new IS.ImageStore({ backend: be });
  await st.list(); // «Nylig lastet opp»: the old record is in memory with its old date
  const run = st.gc(rs);
  await wait(6);
  const res = st.import({ [stale]: IS.bytesToDataUrl(bytes, 'image/png') });
  const delG = await run;
  await st.flush();
  check('import av et bilde som alt er i minnet: brukt igjen, ikke slettet', res.existing.includes(stale) && !delG.includes(stale) && st.has(stale) && m.has(stale)
    && Date.now() - m.get(stale).lastUsedAt < DAY, JSON.stringify({ existing: res.existing, delG }));
}
{
  const { m, be } = slowDb();
  const { roots: rs, stale } = await staleSetup(m);
  const st = new IS.ImageStore({ backend: be });
  const run = st.gc(rs);
  await wait(6);
  m.get(stale).lastUsedAt = Date.now(); // another tab used it after the snapshot
  const delG = await run;
  check('brukt i en annen fane etter øyeblikksbildet: ikke slettet', !delG.includes(stale) && m.has(stale), JSON.stringify(delG));
}
{
  const { m, be } = slowDb();
  const { roots: rs, stale } = await staleSetup(m);
  const st = new IS.ImageStore({ backend: be });
  const delG = await st.gc(rs);
  check('uten ny bruk: det gamle bildet slettes fortsatt, røttene blir', JSON.stringify(delG) === JSON.stringify([stale]) && !m.has(stale) && [...rs].every((x) => m.has(x)));
}

// ---------------------------------------------------------------------------------------------------------------
section('14. Saves.imageRoots');
const design = (iid) => ({ version: 2, items: [{ uid: 'x', params: { imageId: iid } }] });
const lsR = memStorage();
lsR.setItem(STORAGE_KEY, JSON.stringify({ version: 1, active: null, designs: { Navngitt: design(idA), 'Forrige økt (01.10. 12:00)': design(idB) }, autosave: design(idC) }));
const idBk = 'img-' + 'd'.repeat(28);
lsR.setItem(BACKUP_KEY, JSON.stringify({ version: 1, designs: { Gammel: design(idBk) } }));
const rootsR = new Saves(new DesignState(), { storage: lsR, autosave: false }).imageRoots();
check('samler navngitt, Forrige økt, autosave og backup', rootsR instanceof Set && [idA, idB, idC, idBk].every((x) => rootsR.has(x)) && rootsR.size === 4, JSON.stringify([...(rootsR || [])]));
const throwing = { getItem: () => { throw new Error('blocked'); }, setItem() {}, removeItem() {} };
check('null når lesingen feiler', new Saves(new DesignState(), { storage: throwing, autosave: false }).imageRoots() === null);
const lsBad = memStorage();
lsBad.setItem(STORAGE_KEY, '{ikke json');
check('null når teksten ikke er JSON', new Saves(new DesignState(), { storage: lsBad, autosave: false }).imageRoots() === null);
const rNull = new Saves(dsA, { storage: null, autosave: false }).imageRoots();
check('uten lagring: tom mengde', rNull instanceof Set && rNull.size === 0);

// ---------------------------------------------------------------------------------------------------------------
section('15. Gamle kall virker som før');
const probe = new Saves({ on: () => () => {}, meta: { name: 'Original' } }, { autosave: false });
check('main.js-proben konstruerer, images = null', probe.images === null);
const et = savesA.exportText();
check('exportText er synkron', typeof et === 'string');
const it2 = new Saves(new DesignState(), { storage: memStorage(), autosave: false }).importText(text);
check('importText er synkron og gir en streng (uten lager: bildene ignoreres)', typeof it2 === 'string');

// ---------------------------------------------------------------------------------------------------------------
section('QA 12. importFile venter på lagringen; for stor fil');
const slowMap = new Map();
const slowBe = { ...IS.memBackend(slowMap, { persistent: true }), put: (rec) => new Promise((r) => setTimeout(() => { slowMap.set(rec.id, rec); r(); }, 40)) };
const savesS = new Saves(new DesignState(), { storage: memStorage(), images: new IS.ImageStore({ backend: slowBe }), autosave: false });
const nmS = await savesS.importFile({ text: async () => text, size: text.length });
check('importFile løses først etter skrivingen', typeof nmS === 'string' && slowMap.has(id));
let bigErr = null;
try {
  await savesS.importFile({ text: async () => text, size: MAX_DESIGN_FILE_BYTES + 1 });
} catch (err) {
  bigErr = err;
}
check('fil over grensen avvises med norsk tekst', /for stor/.test(bigErr?.message || ''), bigErr?.message);

section('QA 13. Duplikat deler bildet');
const dupUid = dsA.duplicate(uid);
check('duplikatet har samme imageId', dsA.get(dupUid)?.params.imageId === id);
const dupJ = JSON.parse(savesA.exportText());
check('eksporten har bildet én gang', Object.keys(dupJ.images || {}).length === 1);
dsA.remove(dupUid);

section('QA 14. Katalogens akustikkbilde med eget motiv');
check('imageRefs finner imageId på et acoustic-art fra katalogen', IS.imageRefs({ items: [{ source: 'catalog', archetype: 'acoustic-art', params: { motif: 'custom', imageId: id } }] }).has(id));

section('QA 15. Eksportstørrelse');
const BIG = bigPng(1600, 1067, 300 * 1024);
const storeH = new IS.ImageStore({ backend: IS.memBackend(new Map(), { persistent: true }) });
const idH = await storeH.putBytes(BIG, { mime: 'image/png', name: 'stor.png' });
const dsH = new DesignState();
const savesH = new Saves(dsH, { storage: memStorage(), images: storeH, autosave: false });
const lenNo = savesH.exportText().length;
dsH.add({ ...SPEC(idH), params: { ...SPEC(idH).params, imageAspect: 1.4996 } });
const lenWith = savesH.exportText().length;
check('et bilde på 1600 × 1067 (300 kB) legger til ≤ 600 kB', lenWith - lenNo <= 600 * 1024 && lenWith - lenNo > 300 * 1024, `${Math.round((lenWith - lenNo) / 1024)} kB`);

section('QA 17. DesignState.add beholder alle felt');
const dsQ = new DesignState();
const uq = dsQ.add(SPEC(id));
const gq = dsQ.get(uq);
check('kilde, refId, navn, kategori, arketype, montering og params', gq.source === 'custom' && gq.refId === 'custom-image' && gq.name === 'Eget bilde – Ferie i Lofoten'
  && gq.category === 'kunst' && gq.archetype === 'art-frame' && gq.mount === 'wall' && JSON.stringify(gq.params) === JSON.stringify(SPEC(id).params));

section('16. Autosave fra forrige versjon (maleriet var «smatt»)');
/** FNV-1a as DesignState's meta.specRevision. */
const fnv = (s) => {
  let hh = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hh ^= s.charCodeAt(i);
    hh = Math.imul(hh, 0x01000193);
  }
  return (hh >>> 0).toString(16).padStart(8, '0');
};
/** Today's untouched room (only light / time changed) as the previous version saved it: the painting in 'smatt'. */
const oldAutosave = (change) => {
  const j = new DesignState().toJSON();
  const p = j.items.find((it) => it.uid === 'ex-f-maleri');
  p.category = 'smatt';
  j.meta.specRevision['ex-f-maleri'] = fnv(JSON.stringify(p));
  change?.(p);
  j.env = { ...j.env, hour: 20 };
  return j;
};
const lsW = memStorage();
const savesW = new Saves(new DesignState(), { storage: lsW, autosave: false });
check('maleriet finnes og er «kunst» i dag', new DesignState().get('ex-f-maleri')?.category === 'kunst');
check('urørt rom fra forrige versjon er ikke «arbeid»', !savesW.isWork(oldAutosave()));
check('… men et flyttet maleri er det', savesW.isWork(oldAutosave((p) => { p.position = [p.position[0] + 0.3, p.position[1], p.position[2]]; })));
lsW.setItem(STORAGE_KEY, JSON.stringify({ version: 1, active: null, designs: {}, autosave: oldAutosave() }));
const probeW = new Saves({ on: () => () => {}, meta: { name: 'Original' } }, { storage: lsW, autosave: false });
check('main.js-proben: ingen «Fortsett siste design»', !probeW.isWork(probeW._read().autosave));
check('«Start med stua» lager ingen «Forrige økt»', savesW.archiveSession() === null && savesW.list().length === 1, JSON.stringify(savesW.list().map((r) => r.name)));
check('et ekte endret design er fortsatt arbeid', savesW.isWork({ ...new DesignState().toJSON(), paints: { 'w-hoy': '#7d8a80' } }) && !savesW.isWork(new DesignState().toJSON()));

const ms = Date.now() - t0;
console.log(`\n(${ms} ms)`);
done();
