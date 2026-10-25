#!/usr/bin/env node
/**
 * The Inspector's hooks into the models and the catalogue (runde 3 gate), without a browser:
 *   1. paramDisplayValues – an unset param with `defaultFor` shows what the builder draws (a frame's matW: 9 % of the
 *      short side), and `defaultFrom` (matH) follows it
 *   2. Inspector._paramPatch – an archetype's paramPatch hook (a bench or stool that gets a back keeps its seat) goes
 *      into the same patch, and a size change from it is fitted like any size change
 *   3. Inspector.rotate – a 15° turn that does not fit (a long grid through a wall) is refused with a toast, unless the
 *      item was stuck before the turn
 *   4. productToItemSpec – a coffee-table set carries setRef = the product's own size, so a resized set scales
 *   node tools/test-house.mjs inspector-hooks
 */
import { registerHooks } from 'node:module';
import { imp, check, section, done } from './_lib.mjs';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { Inspector, paramDisplayValues } = await imp('src/ui/Inspector.js');
const reg = await imp('src/models/registry.js');
const cat = await imp('src/catalog/index.js');
const { artLayout } = await imp('src/models/artlayout.js');
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

// ---------------------------------------------------------------------------------------------------------------
section('1. «Form og detaljer» viser bredden som tegnes (defaultFor)');
{
  const def = reg.getArchetype('art-frame');
  const schema = def?.params || {};
  const bad = [];
  for (const dims of [{ w: 0.43, d: 0.03, h: 0.53 }, { w: 0.8, d: 0.04, h: 1.0 }, { w: 1.2, d: 0.03, h: 0.6 }]) {
    const item = { archetype: 'art-frame', dims, params: { ...def.defaults.params, mat: true } };
    const v = paramDisplayValues(schema, item, def);
    const drawn = artLayout(dims, { ...def.defaults.params, mat: true }).matW;
    if (!(Math.abs(v.matW - drawn) < 1e-9)) bad.push(`${dims.w}×${dims.h}: viser matW ${fmt(v.matW)}, tegner ${fmt(drawn)}`);
    if (!(Math.abs(v.matH - v.matW) < 1e-9)) bad.push(`${dims.w}×${dims.h}: matH ${fmt(v.matH)} følger ikke matW ${fmt(v.matW)}`);
  }
  const set = paramDisplayValues(schema, { archetype: 'art-frame', dims: { w: 0.5, d: 0.03, h: 0.7 }, params: { mat: true, matW: 0.04 } }, def);
  if (set.matW !== 0.04 || set.matH !== 0.04) bad.push(`satt matW 0.04: viser matW ${set.matW}, matH ${set.matH}`);
  check('passepartoutbredden i Inspektøren er den som tegnes, og «over og under» følger den', !bad.length, bad.join(' | '));
  const plain = paramDisplayValues({ a: { type: 'number', default: 1 } }, { params: { a: 2 } }, { defaults: { params: { a: 3, b: 4 } } });
  check('vanlige parametre: produktets verdi over arketypens standard', plain.a === 2 && plain.b === 4, JSON.stringify(plain));
}

// ---------------------------------------------------------------------------------------------------------------
section('2. Rygg på benk og krakk: setet blir der det var (paramPatch i Inspektøren)');
{
  const bad = [];
  for (const [id, key, on] of [['bohus-sando-sengebenk-150x51', 'back', 'rail'], ['bohus-sm-840-krakk', 'back', 'spindles']]) {
    const spec = cat.productToItemSpec(id);
    if (!spec) {
      bad.push(`fant ikke ${id}`);
      continue;
    }
    const item = { ...spec, uid: 'u1', position: [0, 0, 0] };
    const fits = [];
    const fake = {
      design: { get: () => item },
      _fit: (uid, patch) => {
        fits.push(patch);
        return { patch: { ...patch, dims: { ...patch.dims, h: Math.min(patch.dims.h, 2.38) } }, capped: [], status: 'ok' };
      },
    };
    const def = reg.getArchetype(spec.archetype);
    const p = Inspector.prototype._paramPatch.call(fake, 'u1', def, key, on);
    const want = def.paramPatch(item, key, on);
    if (!want) bad.push(`${id}: paramPatch ga ingenting for ${key}=${on}`);
    else {
      if (p.params?.[key] !== on) bad.push(`${id}: ${key} mangler i patchen`);
      if (!(Math.abs((p.params?.seatH ?? -1) - want.params.seatH) < 1e-9)) bad.push(`${id}: seatH ${p.params?.seatH}, ventet ${want.params.seatH}`);
      if (!(p.dims?.h > spec.dims.h)) bad.push(`${id}: høyden ${spec.dims.h} → ${p.dims?.h} (skulle øke)`);
      if (fits.length !== 1) bad.push(`${id}: størrelsen ble ikke tilpasset rommet (${fits.length} _fit-kall)`);
    }
    const plain = Inspector.prototype._paramPatch.call(fake, 'u1', def, 'seatT', 0.05);
    if (JSON.stringify(plain) !== JSON.stringify({ params: { seatT: 0.05 } })) bad.push(`${id}: annen parameter gir ${JSON.stringify(plain)}`);
  }
  const none = Inspector.prototype._paramPatch.call({ design: { get: () => ({ uid: 'x', params: {} }) } }, 'x', { params: {} }, 'shape', 'round');
  if (JSON.stringify(none) !== JSON.stringify({ params: { shape: 'round' } })) bad.push(`uten krok: ${JSON.stringify(none)}`);
  check('Inspektøren sender rygg/armlener med sete og høyde i samme endring', !bad.length, bad.join(' | '));
}

// ---------------------------------------------------------------------------------------------------------------
section('3. «Roter 15°» som ikke får plass blir avvist');
{
  const run = (blockedNow) => {
    const toasts = [];
    const applied = [];
    const item = { uid: 'g1', name: 'Downlights', rotationDeg: 0 };
    const fake = {
      target: { uid: 'g1' },
      design: { get: () => item },
      editor: { events: { emit: (n, e) => n === 'toast' && toasts.push(e.text) } },
      _fit: (uid, patch) => ({ patch, capped: [], status: patch.rotationDeg != null || blockedNow ? 'blocked' : 'ok' }),
      _apply: (patch) => applied.push(patch),
      _render: () => {},
    };
    Inspector.prototype.rotate.call(fake, 15);
    return { toasts, applied };
  };
  const a = run(false);
  check('en vending som ikke får plass endrer ingenting og sier fra', !a.applied.length && a.toasts.some((t) => /rotert/.test(t)), `${a.applied.length} endringer, toast: ${a.toasts.join(', ') || '–'}`);
  const b = run(true);
  check('en ting som allerede står fast kan fortsatt vendes', b.applied.length === 1 && b.applied[0].rotationDeg === 15, JSON.stringify(b.applied));
}

// ---------------------------------------------------------------------------------------------------------------
section('4. Sofabordsett: settbordene følger størrelsen (setRef)');
{
  const bad = [];
  const sets = cat.allProducts().filter((p) => Array.isArray(p.params?.set));
  if (!sets.length) bad.push('ingen sofabordsett i katalogen');
  for (const p of sets) {
    const s = cat.productToItemSpec(p);
    const r = s?.params?.setRef;
    if (!r || r.w !== p.dims.w || r.d !== p.dims.d || r.h !== p.dims.h) bad.push(`${p.id}: setRef ${JSON.stringify(r)}`);
  }
  const other = cat.allProducts().filter((p) => p.archetype === 'coffee-table' && !Array.isArray(p.params?.set)).slice(0, 5);
  for (const p of other) if (cat.productToItemSpec(p)?.params?.setRef != null) bad.push(`${p.id}: setRef uten sett`);
  check(`sofabordsett (${sets.map((p) => p.name).join(', ')}): setRef = produktets mål`, !bad.length, bad.join(' | '));
}

done();
