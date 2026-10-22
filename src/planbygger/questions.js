/**
 * Planbygger: the questions «Generer» asks (generate.js) and how the answers change the plan document. The wizard
 * (guide.js) shows each with its crop of the drawing and the filled-in answer; «Hopp over resten» keeps the defaults,
 * which the document already holds – an answer only changes what differs from its default.
 *
 *   question = {
 *     id,                       stable between runs on the same files: '<kind>:<drawing key | level id | file>[:<n>]'
 *                               (a drawing key is its file name, plus '#<n>' for the n-th drawing of a split sheet)
 *     kind: 'scale'|'bra'|'ceiling'|'windows'|'room'|'stair'|'order'|'alternative'|'photo'|'shape'|'facade'|'walls',
 *     level: level id | null,   the level it is about (null: the house, or a file before it became a level)
 *     file,                     the drawing's file name
 *     crop: { file, level, bbox: [x0, y0, x1, y1] | null },   bbox in the px of images[level] (generate's result), or of
 *                               the uploaded file when level is null; null bbox = the whole image
 *     text, help?,              Norwegian
 *     input: 'number'|'choice'|'text'|'room'|'window'|'order'|'none',
 *     unit?: 'm'|'m²',  options?: [{ value, label }],  default,  confidence: 'high'|'medium'|'low',
 *     rerun?: true              the answer needs generate() again (generate(inputs, { answers })): a new photo, the other
 *                               alternative drawing; applyAnswers leaves the document as it is for those
 *     data: { … }               what applyAnswers needs (px lengths, room ids, …), plain JSON
 *   }
 *
 *   applyAnswers(doc, questions, answers) → doc     answers = { [question id]: value }; a copy of doc is changed and
 *                                                   returned. Values per kind:
 *     scale        metres: the house's outer width as drawn left–right (data.px) → the level's px/m
 *     bra          m²: the level's BRA (data.innerPx2) → px/m
 *     ceiling      metres: the level's ceiling height
 *     windows      { sill, height } metres: every window of the house (level null) or of the level
 *     room         { name, kind } (or a name): the room's label
 *     stair        'straight'|'u'|'none'
 *     order        [level ids from the bottom up]: the floor heights follow, the main level stays at 0
 *     facade       metres: the wall's height from the ground to the eave on that facade → the window heights again
 *     alternative, photo, shape   no change here (rerun / a new upload)
 *     walls        no change: a level without walls or rooms to walk in – the customer draws them in «Finjuster»
 *
 * Pure functions on plain JSON, like model.js.
 */
import { clone, rescaleLevel, setRoomLabel, ROOM_KINDS } from './model.js';

const KINDS = new Set(ROOM_KINDS.map(([k]) => k));
const fmt = (v, d = 2) => (Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',') : '–');
const levelOf = (doc, id) => doc.levels.find((l) => l.id === id) ?? null;
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.')) : NaN);

/** The median of numbers (null for none). */
export function median(arr) {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------------------------------------------
// Window heights from facades (shared by generate.js and the facade answer)

/**
 * Sill and height per storey from facade readings: the median over the windows (not doors) of every facade that is
 * trusted, in metres above the storey's floor. readings: [{ pxPerM, floorYs: [px], windows: [{ y0, y1, kind, storey }] }]
 * → { [storey]: { sill, height, n } }
 */
export function windowsPerStorey(readings) {
  const by = new Map();
  for (const r of readings) {
    if (!(r?.pxPerM > 0) || !Array.isArray(r.floorYs)) continue;
    for (const w of r.windows || []) {
      if (w.kind !== 'window' || !Number.isInteger(w.storey)) continue;
      const floor = r.floorYs[w.storey];
      if (!Number.isFinite(floor)) continue;
      const sill = (floor - (w.y1 + 1)) / r.pxPerM;
      const height = (w.y1 + 1 - w.y0) / r.pxPerM;
      if (!(sill >= -0.05 && sill <= 2.2 && height >= 0.3 && height <= 2.8)) continue;
      if (!by.has(w.storey)) by.set(w.storey, { sills: [], heights: [] });
      by.get(w.storey).sills.push(Math.max(0, sill));
      by.get(w.storey).heights.push(height);
    }
  }
  const out = {};
  for (const [k, v] of by) out[k] = { sill: Math.round(median(v.sills) * 100) / 100, height: Math.round(median(v.heights) * 100) / 100, n: v.sills.length };
  return out;
}

/** Sets sill / height on a level's windows (the automatic ones, or all), within its ceiling. */
export function setWindowHeights(level, { sill, height }, { all = false, ceiling = 2.4 } = {}) {
  let n = 0;
  const top = (level.ceiling ?? ceiling) - 0.05;
  for (const o of level.openings || []) {
    if (o.type !== 'window' || (!all && o.fixed)) continue;
    const s = Math.max(0, Math.min(sill, top - 0.3));
    o.sill = Math.round(s * 100) / 100;
    o.height = Math.round(Math.max(0.3, Math.min(height, top - s)) * 100) / 100;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Builders (generate.js calls these; every text is Norwegian)

const q = (o) => ({ level: null, file: null, crop: null, help: null, options: null, unit: null, rerun: false, data: {}, ...o });

export function scaleQuestion({ key, level, file, crop, outlinePx, pxPerM, method, confidence, why }) {
  const width = outlinePx > 0 && pxPerM > 0 ? Math.round((outlinePx / pxPerM) * 100) / 100 : null;
  return q({
    id: `scale:${key ?? level}`,
    kind: 'scale',
    level,
    file,
    crop,
    input: 'number',
    unit: 'm',
    text: `Hvor bredt er huset på tegningen «${file}», målt utvendig fra venstre til høyre?`,
    help: `${why} Forslaget ${width != null ? `(${fmt(width)} m) ` : ''}kommer fra ${method === 'standard' ? 'vanlige mål på dører og vegger' : 'tegningen'}, men er usikkert.`,
    default: width,
    confidence,
    data: { px: outlinePx, pxPerM },
  });
}

export function braQuestion({ key, level, levelName, file, crop, innerM2, pxPerM, confidence }) {
  return q({
    id: `bra:${key ?? level}`,
    kind: 'bra',
    level,
    file,
    crop,
    input: 'number',
    unit: 'm²',
    text: `Hvor stor er BRA for ${levelName.toLowerCase()} (fra salgsoppgaven eller takstrapporten)?`,
    help: 'Tegningen har ingen mål eller arealer. Med BRA kan målestokken regnes ut. Forslaget er regnet fra vanlige dørbredder.',
    default: innerM2 > 0 ? Math.round(innerM2) : null,
    confidence,
    data: { innerPx2: innerM2 > 0 ? innerM2 * pxPerM * pxPerM : null, pxPerM },
  });
}

export function ceilingQuestion({ level, levelName, file, crop, value, texts = [], loft = false }) {
  const said = texts.length ? ` Tegningen sier: ${texts.map((t) => `«${t}»`).join(', ')}.` : '';
  return q({
    id: `ceiling:${level}`,
    kind: 'ceiling',
    level,
    file,
    crop,
    input: 'number',
    unit: 'm',
    text: `Hvor høyt er det under taket i ${levelName.toLowerCase()}?`,
    help: `${loft ? 'Etasjen ligger under taket og har skråtak; taket i planbyggeren er flatt, så skriv høyden der det er fullt opp.' : 'Vanlig takhøyde er 2,4 m.'}${said}`,
    default: value,
    confidence: texts.length ? 'medium' : 'low',
  });
}

export function windowsQuestion({ sill, height }) {
  return q({
    id: 'windows:hus',
    kind: 'windows',
    input: 'window',
    unit: 'm',
    text: 'Hvor høyt sitter vinduene?',
    help: 'Vi fant ingen fasadetegninger. Brystningen er høyden fra gulvet til underkanten av vinduet. Bad og vaskerom har fått høyere brystning.',
    default: { sill, height },
    confidence: 'low',
  });
}

export function roomQuestion({ level, levelName, file, crop, roomId, seed, area, name, kind, why }) {
  return q({
    id: `room:${level}:${roomId}`,
    kind: 'room',
    level,
    file,
    crop,
    input: 'room',
    options: ROOM_KINDS.map(([value, label]) => ({ value, label })),
    text: `Hva er dette rommet i ${levelName.toLowerCase()} (${fmt(area, 1)} m²)?`,
    help: why,
    default: { name, kind },
    confidence: 'low',
    data: { roomId, seed },
  });
}

export function stairQuestion({ level, levelName, file, crop, value, why, stairId = null, rect = null, axis = null }) {
  return q({
    id: `stair:${level}`,
    kind: 'stair',
    level,
    file,
    crop,
    input: 'choice',
    options: [
      { value: 'straight', label: 'Rett trapp' },
      { value: 'u', label: 'U-trapp (svinger 180°)' },
      { value: 'none', label: 'Ingen trapp her' },
    ],
    text: `Hvilken trapp går ned fra ${levelName.toLowerCase()}?`,
    help: why,
    default: value,
    confidence: 'low',
    data: { stairId, rect, axis },
  });
}

export function orderQuestion({ levels, why }) {
  return q({
    id: 'order:hus',
    kind: 'order',
    input: 'order',
    options: levels.map((l) => ({ value: l.id, label: `${l.name} («${l.file}»)` })),
    text: 'Stemmer rekkefølgen på etasjene (nederst først)?',
    help: why,
    default: levels.map((l) => l.id),
    confidence: 'low',
  });
}

export function alternativeQuestion({ file, alternative, levelName }) {
  return q({
    id: `alternative:${file}`,
    kind: 'alternative',
    file,
    crop: { file: alternative, level: null, bbox: null },
    input: 'choice',
    options: [
      { value: file, label: `«${file}»` },
      { value: alternative, label: `«${alternative}»` },
    ],
    text: `To tegninger viser ${levelName.toLowerCase()}. Hvilken skal brukes?`,
    help: `«${alternative}» ser ut til å være et alternativ til «${file}». Huset bygges med den ene.`,
    default: file,
    confidence: 'medium',
    rerun: true,
  });
}

export function photoQuestion({ file, reason }) {
  return q({
    id: `photo:${file}`,
    kind: 'photo',
    file,
    crop: { file, level: null, bbox: null },
    input: 'none',
    text: 'Ta bildet på nytt med hele arket synlig.',
    help: `Vi fant ikke kantene på arket i «${file}» sikkert nok til å rette opp bildet${reason ? ` (${reason})` : ''}. Legg arket på et mørkt bord, hold telefonen rett over det og få med alle fire hjørnene.`,
    default: null,
    confidence: 'low',
    rerun: true,
  });
}

const SIDE = { top: 'øverst', bottom: 'nederst', left: 'til venstre', right: 'til høyre' };
export function shapeQuestion({ file, cut, level }) {
  return q({
    id: `shape:${file}`,
    kind: 'shape',
    level,
    file,
    crop: { file, level, bbox: null },
    input: 'choice',
    options: [
      { value: 'ok', label: 'Ja, formen stemmer' },
      { value: 'new', label: 'Nei, jeg tar et nytt bilde' },
    ],
    text: `Arket går ut av bildet (${cut.map((c) => SIDE[c] ?? c).join(' og ')}). Stemmer formen på planen?`,
    help: 'Den delen av arket som ikke er med, er gjettet. Mål og vinkler kan bli litt feil.',
    default: 'ok',
    confidence: 'medium',
    rerun: true,
  });
}

export function facadeQuestion({ file, part, crop, wallPx, pxPerM, reading, storeyLevels, title }) {
  const value = wallPx > 0 && pxPerM > 0 ? Math.round((wallPx / pxPerM) * 100) / 100 : null;
  return q({
    id: `facade:${file}${part != null ? `:${part}` : ''}`,
    kind: 'facade',
    file,
    crop,
    input: 'number',
    unit: 'm',
    text: `Hvor høy er veggen${title ? ` på fasaden «${title}»` : ''}?`,
    help: 'Fra bakken til der taket begynner (raftet). Fasaden har ingen dør eller mål vi kunne måle etter; med veggens høyde blir vindushøydene riktige.',
    default: value,
    confidence: 'low',
    data: { wallPx, pxPerM, reading, storeyLevels },
  });
}

/** A level «Generer» could not find walls or rooms in: said, not guessed (the editor is the way on). */
export function wallsQuestion({ level, levelName, file, crop, walls = 0 }) {
  return q({
    id: `walls:${level}`,
    kind: 'walls',
    level,
    file,
    crop,
    input: 'none',
    text: walls ? `Vi fant vegger, men ingen rom å gå i, i ${levelName.toLowerCase()} («${file}»).` : `Vi fant ingen vegger i ${levelName.toLowerCase()} («${file}»).`,
    help: 'Veggene på tegningen kunne ikke leses sikkert. Tegn dem i «Finjuster» etter veiviseren, eller last opp en tydeligere tegning av etasjen.',
    default: null,
    confidence: 'low',
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Answers

/**
 * Applies the answers (see the top of the file) to a copy of doc. Unknown ids and empty answers are skipped.
 * @returns the changed copy; doc.generated.answered lists what changed
 */
export function applyAnswers(doc, questions, answers = {}) {
  const out = clone(doc);
  const done = [];
  const byId = new Map((questions || []).map((x) => [x.id, x]));
  for (const [id, value] of Object.entries(answers || {})) {
    const Q = byId.get(id);
    if (!Q || value == null || value === '') continue;
    const L = Q.level ? levelOf(out, Q.level) : null;
    switch (Q.kind) {
      case 'scale': {
        const m = num(value);
        if (!L || !(m > 0) || !(Q.data?.px > 0)) break;
        const ppm = Q.data.px / m;
        if (Math.abs(ppm / L.image.pxPerM - 1) > 1e-4) {
          rescaleLevel(L, ppm);
          L.image.scaleFrom = { method: 'given', confidence: 'high', detail: `husets bredde ${fmt(m)} m (svar)` };
          done.push(id);
        }
        break;
      }
      case 'bra': {
        const a = num(value);
        if (!L || !(a > 5) || !(Q.data?.innerPx2 > 0)) break;
        const ppm = Math.sqrt(Q.data.innerPx2 / a);
        if (Math.abs(ppm / L.image.pxPerM - 1) > 1e-4) {
          rescaleLevel(L, ppm);
          L.image.scaleFrom = { method: 'bra', confidence: 'medium', detail: `BRA ${fmt(a, 1)} m² (svar)` };
          done.push(id);
        }
        break;
      }
      case 'ceiling': {
        const m = num(value);
        if (!L || !(m >= 1.8 && m <= 6)) break;
        L.ceiling = Math.round(m * 100) / 100;
        for (const r of L.rooms || []) if (r.auto) delete r.ceiling;
        done.push(id);
        break;
      }
      case 'windows': {
        const sill = num(value?.sill);
        const height = num(value?.height);
        if (!(sill >= 0) || !(height > 0)) break;
        for (const lv of L ? [L] : out.levels) setWindowHeights(lv, { sill, height }, { all: true, ceiling: out.settings?.ceiling ?? 2.4 });
        done.push(id);
        break;
      }
      case 'room': {
        if (!L) break;
        const v = typeof value === 'string' ? { name: value } : value;
        const props = {};
        if (typeof v?.name === 'string' && v.name.trim()) props.name = v.name.trim();
        if (KINDS.has(v?.kind)) props.kind = v.kind;
        if (!Object.keys(props).length) break;
        const existing = (L.rooms || []).find((r) => r.id === Q.data?.roomId);
        setRoomLabel(L, existing?.seed ?? Q.data?.seed, { id: Q.data?.roomId, ...props, auto: false });
        done.push(id);
        break;
      }
      case 'stair': {
        if (!L) break;
        const st = (L.stairs || []).find((s) => s.id === Q.data?.stairId) ?? null;
        if (value === 'none') {
          if (st) L.stairs = L.stairs.filter((s) => s !== st);
        } else if (value === 'straight' || value === 'u') {
          if (st) {
            if (value === 'u') st.kind = 'u';
            else delete st.kind;
          } else if (Q.data?.rect) {
            const [[x0, y0], [x1, y1]] = Q.data.rect;
            const s = { id: `t-svar-${(L.stairs || []).length + 1}`, rect: Q.data.rect, axis: Q.data.axis ?? (x1 - x0 >= y1 - y0 ? 'x' : 'y'), down: 1, ...(value === 'u' ? { kind: 'u' } : {}) };
            (L.stairs ||= []).push(s);
          }
        } else break;
        done.push(id);
        break;
      }
      case 'order': {
        if (!Array.isArray(value)) break;
        const ids = value.filter((x) => levelOf(out, x));
        if (ids.length !== out.levels.length) break;
        const mainIdx = Math.max(0, ids.indexOf('hoved'));
        const h = out.generated?.floorHeight ?? 2.7;
        ids.forEach((lid, i) => {
          const lv = levelOf(out, lid);
          lv.floorY = Math.round((i - mainIdx) * h * 1000) / 1000;
        });
        out.levels.sort((a, b) => a.floorY - b.floorY);
        done.push(id);
        break;
      }
      case 'facade': {
        const m = num(value);
        const d = Q.data || {};
        if (!(m > 0.5) || !(d.wallPx > 0) || !d.reading) break;
        const reading = { ...d.reading, pxPerM: d.wallPx / m };
        const per = windowsPerStorey([reading]);
        for (const [storey, w] of Object.entries(per)) {
          const lid = d.storeyLevels?.[storey];
          const lv = lid ? levelOf(out, lid) : null;
          if (lv) setWindowHeights(lv, w, { ceiling: out.settings?.ceiling ?? 2.4 });
        }
        done.push(id);
        break;
      }
      default:
        break;
    }
  }
  out.generated = { ...(out.generated || {}), answered: [...(out.generated?.answered || []), ...done] };
  return out;
}
