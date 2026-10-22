import { artLayout, outerDims, containRect } from '../models/artlayout.js';
import { isImageId } from '../models/artImages.js';

/**
 * Own pictures («egne bilder», design/upload.md §10): pure helpers shared by the upload dialog (ui/ImageUpload.js),
 * the Inspector's «Bilde» section (ui/imageInspector.js), the shopping list (ui/customArtShopping.js) and the tests.
 * No DOM, no three.js – Node-testable. Geometry comes from models/artlayout.js (the builder's own numbers).
 *
 * An uploaded picture is an art-frame item with source 'custom', refId CUSTOM_REF, category 'kunst' and
 *   params { motif: 'custom', imageId, imageAspect, fit, sizeMode, frameStyle, frame, frameW, mat, matW, matColor,
 *            texture, depth (= dims.d), edge: 'white' }   (dims = the OUTER size incl. frame and mat; sizeMode = the
 *            dialog's mode 'image'|'frame', so a later edit keeps the frame size the user chose).
 * A catalogue frame that accepts a picture (params.acceptsImage, or an «eget motiv» product with motif 'custom') keeps
 * source 'catalog', its size and price, and only gains motif 'custom', imageId, imageAspect and fit.
 *
 * Choice = what the dialog edits:
 *   { mode: 'image'|'frame', long?: m, frameSize?: { key, label, w, h }, fit: 'cover'|'contain', style, mat: bool,
 *     texture?: 'photo'|'paper' }
 *   image mode: the picture's long edge (`long`); the frame follows the picture's aspect (nothing is cropped)
 *   frame mode: a standard frame size = the frame's opening (the glass, oriented); a mat lies inside it; `fit` decides
 *               between cropping (cover) and showing the whole picture (contain)
 */

export const ART_CATEGORY = 'kunst';
/** Non-null refId of uploaded pictures (Inspector._original matches by refId). */
export const CUSTOM_REF = 'custom-image';
export const NAME_PREFIX = 'Eget bilde';
/** m, the «Lengste side» slider. */
export const LONG_EDGE_RANGE = Object.freeze([0.15, 1.5]);
/** m – the short outer side never gets smaller (UI clamps). */
export const MIN_OUTER_SIDE = 0.12;
/** «Etter bildet» presets: the picture's long edge. */
export const IMAGE_SIZES = Object.freeze([
  { key: 'liten', label: 'Liten', long: 0.3 },
  { key: 'medium', label: 'Medium', long: 0.5 },
  { key: 'stor', label: 'Stor', long: 0.7 },
  { key: 'ekstra', label: 'Ekstra stor', long: 1.0 },
]);
/** Standard frame openings, portrait w × h (m). */
export const FRAME_SIZES = Object.freeze([[0.21, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.7], [0.61, 0.91], [0.7, 1.0]]);
export const SQUARE_SIZES = Object.freeze([0.3, 0.4, 0.5, 0.7]);
export const MAT_COLOR = '#f3f0e9';
/** Frame looks of own pictures: frame profile + material/colour + print surface (mat: null = never a mat). */
export const FRAME_STYLES = Object.freeze({
  svart: { label: 'Smal svart', text: 'smal svart ramme', frame: 'black', frameW: 0.015, material: 'black-metal', color: '#151515', texture: 'photo', depth: 0.025, mat: true },
  hvit: { label: 'Smal hvit', text: 'smal hvit ramme', frame: 'black', frameW: 0.015, material: 'painted', color: '#f2f0eb', texture: 'photo', depth: 0.025, mat: true },
  eik: { label: 'Eik', text: 'eikeramme', frame: 'oak', frameW: 0.022, material: 'oak', color: '#b8935f', texture: 'photo', depth: 0.03, mat: true },
  valnott: { label: 'Valnøtt', text: 'valnøttramme', frame: 'oak', frameW: 0.022, material: 'walnut', color: '#5b3f2c', texture: 'photo', depth: 0.03, mat: true },
  messing: { label: 'Messing', text: 'messingramme', frame: 'black', frameW: 0.012, material: 'brass', color: '#b08d57', texture: 'photo', depth: 0.022, mat: true },
  bred: { label: 'Bred hvit', text: 'bred hvit ramme', frame: 'white', frameW: 0.035, material: 'painted', color: '#f2f0eb', texture: 'paper', depth: 0.035, mat: false },
  lerret: { label: 'Lerret', text: 'lerret', frame: 'none', frameW: 0, material: null, color: null, texture: 'canvas', depth: 0.03, mat: null, canvas: true },
  skyggefuge: { label: 'Lerret i skyggefugeramme', text: 'lerret i skyggefugeramme', frame: 'floater', frameW: 0.012, material: 'black-metal', color: '#1a1a1a', texture: 'canvas', depth: 0.04, mat: null, canvas: true },
  plakat: { label: 'Plakat uten ramme', text: 'plakat uten ramme', frame: 'none', frameW: 0, material: null, color: null, texture: 'paper', depth: 0.005, mat: null },
});
export const DEFAULT_STYLE = 'svart';

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
/** Centimetres as shown: 0.375 → '38'. */
export const cm = (m) => String(Math.round(m * 100));
/** «50 × 38 cm». */
export const sizeText = (w, h) => `${cm(w)} × ${cm(h)} cm`;

/** params.motif 'custom' with a well-formed picture id. */
export function hasImage(item) {
  return item?.params?.motif === 'custom' && isImageId(item?.params?.imageId);
}

/** An own picture that is not a catalogue product (uploaded, or a painting converted to one). */
export function isUploadedImage(item) {
  return hasImage(item) && item.source !== 'catalog';
}

/** A catalogue product (or its item) whose frame takes an own picture. */
export function acceptsImage(p) {
  return p?.params?.acceptsImage === true || (p?.params?.motif === 'custom' && (p?.archetype === 'art-frame' || p?.archetype === 'acoustic-art'));
}

/** Archetypes a picture can be put into. */
export function canHoldImage(item) {
  return item?.archetype === 'art-frame' || item?.archetype === 'acoustic-art';
}

/** 'portrait' | 'landscape' | 'square' (|ln a| < 0.06 → square). */
export function orientationOf(aspect) {
  const a = num(aspect, 1);
  if (!(a > 0) || Math.abs(Math.log(a)) < 0.06) return 'square';
  return a > 1 ? 'landscape' : 'portrait';
}

const sizeEntry = (w, h) => ({ key: `${cm(w)}x${cm(h)}`, label: sizeText(w, h), w, h });

/**
 * Standard frame sizes for a picture's aspect (oriented like the picture; flip = the other orientation; a square
 * picture gets square frames, flipped the portrait ones).
 * @returns {Array<{ key: string, label: string, w: number, h: number }>}
 */
export function frameSizesFor(aspect, { flip = false } = {}) {
  let o = orientationOf(aspect);
  if (flip) o = o === 'landscape' ? 'portrait' : o === 'portrait' ? 'landscape' : 'portrait';
  if (o === 'square') return SQUARE_SIZES.map((s) => sizeEntry(s, s));
  return FRAME_SIZES.map(([w, h]) => (o === 'landscape' ? sizeEntry(h, w) : sizeEntry(w, h)));
}

/** The default frame chip: 50 × 70 (70 × 50, 50 × 50). */
function defaultFrameSize(aspect) {
  const list = frameSizesFor(aspect);
  return list.find((s) => Math.abs(Math.max(s.w, s.h) - (orientationOf(aspect) === 'square' ? 0.5 : 0.7)) < 1e-6) || list[0];
}

/** Passepartout width for an opening's long side. */
export function matWFor(longOpen) {
  return longOpen < 0.35 ? 0.035 : longOpen < 0.6 ? 0.05 : 0.07;
}

/** The dialog's first choice for a new picture. */
export function defaultChoice(image) {
  return { mode: 'image', long: 0.5, frameSize: defaultFrameSize(image?.aspect), fit: 'cover', style: DEFAULT_STYLE, mat: true };
}

/**
 * «Eget bilde – Ferie i Lofoten» from a file name (extension stripped, spaces collapsed, ≤ 50 characters + «…»).
 * @param {string} fileName
 */
export function uploadedName(fileName) {
  let base = String(fileName ?? '').split(/[\\/]/).pop() || '';
  base = base.replace(/\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i, '');
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!base) return NAME_PREFIX;
  if (base.length > 50) base = `${base.slice(0, 49).trimEnd()}…`;
  return `${NAME_PREFIX} – ${base}`;
}

/**
 * The item spec of a picture (upload.md §1.1) from a dialog choice.
 * @param {object} choice
 * @param {{ id: string, aspect: number, name?: string }} image   an UploadResult or ImageStore info
 * @param {{ category?: string }} [o]
 */
export function choiceToSpec(choice, image, { category = ART_CATEGORY } = {}) {
  const key = FRAME_STYLES[choice?.style] ? choice.style : DEFAULT_STYLE;
  const st = FRAME_STYLES[key];
  const a = clamp(num(image?.aspect, 1), 0.2, 5);
  const matOk = st.mat !== null; // canvas / poster styles never have a mat
  const mat = matOk && !!choice?.mat;
  const texture = st.canvas ? 'canvas' : choice?.texture === 'paper' || choice?.texture === 'photo' ? choice.texture : st.texture;
  let dims;
  let fit = st.canvas || (!mat && st.frame === 'none') ? 'cover' : choice?.fit === 'contain' ? 'contain' : 'cover';
  let matW = 0;
  const sizeMode = choice?.mode === 'frame' && choice.frameSize ? 'frame' : 'image';
  if (sizeMode === 'frame') {
    // the nominal size is the frame's opening (the glass); a mat lies inside it
    const { w: iw, h: ih } = choice.frameSize;
    const fw = st.frame === 'none' ? 0 : st.frameW;
    matW = mat ? matWFor(Math.max(iw, ih)) : 0;
    dims = { w: r4(iw + 2 * fw), d: st.depth, h: r4(ih + 2 * fw) };
  } else {
    const long = clamp(num(choice?.long, 0.5), LONG_EDGE_RANGE[0], LONG_EDGE_RANGE[1]);
    const openW = a >= 1 ? long : long * a;
    const openH = a >= 1 ? long / a : long;
    matW = mat ? matWFor(long) : 0;
    dims = outerDims({ openW, openH, frame: st.frame, frameW: st.frameW, mat, matW, texture, depth: st.depth });
    fit = 'cover'; // exact aspect: nothing is cropped
  }
  return {
    source: 'custom',
    refId: CUSTOM_REF,
    name: uploadedName(image?.name),
    category,
    archetype: 'art-frame',
    mount: 'wall',
    rotationDeg: 0,
    dims,
    params: {
      motif: 'custom', imageId: image?.id, imageAspect: r4(a), fit, sizeMode, frameStyle: key, frame: st.frame,
      frameW: st.frameW, mat, matW, matColor: MAT_COLOR, texture, depth: st.depth, edge: 'white',
    },
    colors: { print: '#e6e2da', frame: st.color || '#151515' },
    materials: { print: texture === 'canvas' ? 'cotton' : 'paper', frame: st.material || 'black-metal' },
  };
}

/**
 * The FRAME_STYLES key that looks most like an item's frame (params.frame + materials.frame + texture).
 * @param {object} item
 */
export function guessStyle(item) {
  const P = item?.params || {};
  if (FRAME_STYLES[P.frameStyle]) return P.frameStyle;
  const frame = P.frame ?? 'black';
  const mat = String(item?.materials?.frame || '');
  const col = String(item?.colors?.frame || '').toLowerCase();
  const light = /^#(?:[ef][0-9a-f]|d[89a-f])/.test(col) || /white|hvit|painted/.test(mat);
  if (frame === 'none') {
    const depth = num(P.depth, num(item?.dims?.d, 0.03));
    return P.texture === 'paper' && depth < 0.012 ? 'plakat' : 'lerret';
  }
  if (frame === 'floater') return 'skyggefuge';
  if (frame === 'oak') return /walnut|valn/.test(mat) ? 'valnott' : 'eik';
  if (frame === 'white') return 'bred';
  if (/brass|messing|gold/.test(mat)) return 'messing';
  if (/oak|eik|wood|tre/.test(mat)) return /walnut|valn/.test(mat) ? 'valnott' : 'eik';
  return light ? 'hvit' : 'svart';
}

/**
 * The dialog choice that reproduces an item (edit mode) – the inverse of choiceToSpec.
 * The mode is the stored params.sizeMode: «Etter bildet» only while the opening still has the picture's shape (else
 * the frame keeps its size). An item without one (placed before it was stored, a converted painting): a glass of a
 * standard frame size is a frame, else «Etter bildet» when the opening has the picture's shape.
 * @param {object} item
 */
export function specToChoice(item) {
  const P = item?.params || {};
  const L = artLayout(item?.dims, P);
  const style = FRAME_STYLES[P.frameStyle] ? P.frameStyle : guessStyle(item);
  const ia = num(P.imageAspect, L.openW / L.openH);
  const fit = P.fit === 'contain' ? 'contain' : 'cover';
  const base = { fit, style, mat: !!P.mat, texture: P.texture };
  const iw = r4(L.innerW);
  const ih = r4(L.innerH);
  const std = [...frameSizesFor(ia), ...frameSizesFor(ia, { flip: true })].find((s) => Math.abs(s.w - iw) < 0.0015 && Math.abs(s.h - ih) < 0.0015);
  const shaped = fit !== 'contain' && Math.abs(Math.log(ia / (L.openW / L.openH))) < 0.01;
  const image = P.sizeMode === 'image' ? shaped : P.sizeMode === 'frame' ? false : shaped && !std;
  if (image) return { mode: 'image', long: r4(Math.max(L.openW, L.openH)), frameSize: defaultFrameSize(ia), ...base };
  return { mode: 'frame', frameSize: std || { key: 'egen', label: sizeText(iw, ih), w: iw, h: ih }, ...base };
}

/**
 * «Bytt bilde»: the design.update patch that puts another picture into an item (keeps its look).
 *   catalogue frame that accepts a picture → only the picture params (size, source and price stay)
 *   uploaded picture → image mode: same long edge, the frame follows the new aspect; frame mode: same frame, fit kept
 *   anything else (a painting, a poster, an acoustic panel) → converted to an own picture in the same frame
 * @param {object} item
 * @param {{ id: string, aspect: number, name?: string }} image
 * @param {{ accepts?: boolean }} [o]
 */
export function imagePatch(item, image, { accepts = acceptsImage(item) } = {}) {
  const P = item?.params || {};
  const imageAspect = r4(clamp(num(image?.aspect, 1), 0.2, 5));
  if (accepts && item?.source === 'catalog') {
    return { params: { motif: 'custom', imageId: image.id, imageAspect, fit: P.fit === 'contain' ? 'contain' : 'cover' } };
  }
  if (isUploadedImage(item) && item.archetype === 'art-frame') {
    const s = choiceToSpec(specToChoice(item), image, { category: item.category || ART_CATEGORY });
    return { name: s.name, dims: s.dims, params: s.params };
  }
  const w = num(item?.dims?.w, 0.5);
  const h = num(item?.dims?.h, 0.5);
  return {
    source: 'custom',
    refId: CUSTOM_REF,
    name: uploadedName(image?.name),
    // an acoustic panel stays an acoustic panel; pictures go to «Kunst og bilder»
    category: item?.archetype === 'acoustic-art' ? item.category ?? ART_CATEGORY : ART_CATEGORY,
    params: {
      motif: 'custom', imageId: image.id, imageAspect, fit: 'cover', sizeMode: 'frame', frameStyle: guessStyle(item),
      ...(P.mat ? { matW: num(P.matW, Math.min(w, h) * 0.09) } : {}),
    },
  };
}

/**
 * «Tilpass størrelse og ramme»: the patch of a new dialog choice (uploaded pictures; keeps the item's name).
 * @param {object} item
 * @param {{ id: string, aspect: number, name?: string }} image
 * @param {object} choice
 */
export function choicePatch(item, image, choice) {
  const s = choiceToSpec(choice, image, { category: item?.category || ART_CATEGORY });
  return { name: item?.name || s.name, dims: s.dims, params: s.params, colors: s.colors, materials: s.materials };
}

/**
 * Text for the dialog, the Inspector and the shopping list.
 * @returns {{ picText: string, outerText: string, frameText: string, fitText: string, picW: number, picH: number }}
 */
export function describe(item) {
  const P = item?.params || {};
  const L = artLayout(item?.dims, P);
  let picW = L.picW;
  let picH = L.picH;
  const ia = num(P.imageAspect, 0);
  if (L.draw === 'contain' && ia > 0) {
    const r = containRect(ia, 1, L.openW, L.openH);
    picW = r.dw;
    picH = r.dh;
  }
  const style = FRAME_STYLES[P.frameStyle] ? P.frameStyle : guessStyle(item);
  const st = FRAME_STYLES[style];
  const frameText = [st.text, P.mat && L.matW > 0 ? 'passepartout' : null].filter(Boolean).join(' · ');
  let fitText = '';
  if (hasImage(item) && ia > 0) {
    if (P.fit === 'contain') fitText = Math.abs(Math.log(ia / (L.openW / L.openH))) > 0.01 ? 'hele bildet' : '';
    else if (Math.abs(Math.log(ia / (L.openW / L.openH))) > 0.01) fitText = 'beskåret';
  }
  return {
    picText: `Bilde ${sizeText(picW, picH)}`,
    outerText: `utvendig ${sizeText(num(item?.dims?.w, 0), num(item?.dims?.h, 0))}`,
    frameText,
    fitText,
    picW,
    picH,
  };
}

/** Print sharpness: pixels per inch of the picture's long edge at its printed long side (m). */
export function ppiOf(origLongPx, picLongM) {
  return picLongM > 0 ? Math.round(origLongPx / (picLongM / 0.0254)) : 0;
}

/**
 * The sharpness line of the dialog: { text, warn }.
 *   ≥ 150 «Skarpt (ca. N ppi)» · 75–149 «Fint på litt avstand (ca. N ppi)» · < 75 «Kan se uskarpt ut i denne størrelsen …»
 */
export function sharpness(origLongPx, picLongM) {
  const ppi = ppiOf(origLongPx, picLongM);
  if (ppi >= 150) return { ppi, warn: false, text: `Skarpt (ca. ${ppi} ppi)` };
  if (ppi >= 75) return { ppi, warn: false, text: `Fint på litt avstand (ca. ${ppi} ppi)` };
  return { ppi, warn: true, text: `Kan se uskarpt ut i denne størrelsen (ca. ${ppi} ppi)` };
}
