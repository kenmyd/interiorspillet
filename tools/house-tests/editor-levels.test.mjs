/**
 * Steg 14 + 28 (E1 / E4, notes/hele-huset-design.md §5.3): the plan Placement places furniture on, per level – the
 * rooms of the level (a footprint must lie in ONE room, never over the stairwell or through a wall), the swing of a
 * door the player opens, the stair's footprint in the basement, the built-ins – and the living room's plan as before.
 * Pure: Placement's buildRoom / footprintIssue / resolveWalls with layout.house's walls as the home's walls.
 * (The browser side – placing in the basement living room and the bedroom, sitting on it – is checked with the game.)
 */
import { registerHooks } from 'node:module';
import { imp, check, section, done } from './_lib.mjs';

// Placement → Selection → panelKit imports a stylesheet: nothing to load in Node
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { layout } = await imp('src/home/layout.js');
const P = await imp('src/design/Placement.js');
const S = await imp('src/design/SceneSync.js');

const H = layout.house;
const editor = { layout, home: { walls: H.walls } };
const main = P.buildRoom(editor, 'hoved');
const base = P.buildRoom(editor, 'kjeller');
/** A footprint w × d at (x, z), square to the plan. */
const fp = (x, z, w = 0.6, d = 0.6) => ({ cx: x, cz: z, hw: w / 2, hd: d / 2, theta: 0, ax: [1, 0], az: [0, 1] });

section('Plan per etasje');
check('1. etasje: stua, bad, gang og soverom', ['stue-kjokken', 'bad', 'gang', 'soverom'].every((id) => main.rooms.some((r) => r.id === id)) && main.rooms.length === 4, main.rooms.map((r) => r.id).join(','));
check('kjelleren: åtte rom', base.rooms.length === 8, base.rooms.map((r) => r.id).join(','));
check('kjellerens gulv på −2,55', Math.abs(base.floorY + 2.55) < 1e-9);
check('stuas plan som før: polygonet er gulvet', main.poly.length === layout.floor.polygon.length && main.poly.every((p, i) => p.x === layout.floor.polygon[i].x && p.z === layout.floor.polygon[i].y));
check('stuas vegger er med (skallets)', layout.walls.every((w) => main.walls.some((x) => x.id === w.id)));
check('ingen kjellervegg i 1. etasjes plan', !main.walls.some((w) => H.wall(w.id)?.levelId === 'kjeller'));
check('baksideflater (backOf) har hullene fra veggen bak', main.walls.some((w) => H.wall(w.id)?.backOf?.length && w.openings.length));
check('entréens vegger står på entréens gulv (−2,85)', base.walls.filter((w) => H.wall(w.id)?.roomId === 'entre-kjeller').every((w) => Math.abs(w.fy + 2.85) < 1e-6));

section('Fotavtrykk');
check('kjellerstua: et møbel står fritt', P.footprintIssue(base, fp(4.7, 8.4)) === null);
check('soverommet: et møbel står fritt', P.footprintIssue(main, fp(1.5, 6.3)) === null);
check('over trappehullet: nei', P.footprintIssue(main, fp(0.7, 3.3)) === 'Over trappehullet');
check('gjennom veggen mellom gang og soverom: nei', P.footprintIssue(main, fp(1.5, 4.48)) === 'Utenfor rommet');
check('utenfor huset: nei', P.footprintIssue(main, fp(8.5, 5)) === 'Utenfor rommet');
check('1. etasje bruker ikke kjellerens rom (kjellerstua under stua er stua)', P.footprintIssue(main, fp(4.7, 8.4)) === null && main.rooms.find((r) => r.id === 'stue-kjokken'));
const into = fp(1.5, 4.6);
P.resolveWalls(main, into, 0.006);
check('skjøvet ut av veggen inn i soverommet', into.cz >= 4.53 + 0.3 - 1e-6 && P.footprintIssue(main, into) === null, `cz ${into.cz.toFixed(3)}`);

section('Dører, trapp og innredning');
const sw = main.doors.find((d) => d.kind === 'swing' && d.cz > 4.53 && d.cx < 3.12 && d.cx > 2);
check('dørslaget til door-soverom ligger i soverommet og sperrer', !!sw && sw.block === true, sw ? `(${sw.cx.toFixed(2)}, ${sw.cz.toFixed(2)})` : 'mangler');
const sg = main.doors.find((d) => d.kind === 'swing' && d.hw > 0.8);
check('door-gang slår 180°: halvsirkelen i gangen', !!sg && sg.cx < 3.12, sg ? `hw ${sg.hw.toFixed(2)}` : 'mangler');
{
  // the plan's mark (ViewModes' overlay draws each opening of its owner wall: layout.house.wallsById[..].openings)
  const { planSwingAngle } = await imp('src/design/ViewModes.js');
  const og = (H.wallsById[H.opening('door-gang')?.wallId]?.openings || []).find((o) => o.id === 'door-gang') ?? H.opening('door-gang');
  const os = H.opening('door-soverom');
  check('planen tegner door-gang med 180° slag (D6)', planSwingAngle(og, H) === 180, `${planSwingAngle(og, H)}°`);
  check('planen tegner door-soverom med 90°', planSwingAngle(os, H) === 90, `${planSwingAngle(os, H)}°`);
}
check('terrassedøra har bare klaringen foran (som før)', main.doors.filter((d) => d.name === 'terrassedøra').length === 1);
check('trappa sperrer i kjellergangen', base.fixed.some((f) => f.kind === 'stair' && f.block && Math.abs(0.6 - f.cx) <= f.hw && Math.abs(3.0 - f.cz) <= f.hd));
check('trappa er ikke en hindring i 1. etasje (der er hullet)', !main.fixed.some((f) => f.kind === 'stair'));
check('servanten er en hindring på badet', main.fixed.some((f) => f.kind === 'builtin' && /servant/.test(f.name)));
check('vaskemaskinen er en hindring i vaskerommet', base.fixed.some((f) => f.kind === 'builtin' && /vaskemaskin/.test(f.name)));
check('kjøkkenet bare i 1. etasje', main.fixed.some((f) => f.kind === 'kitchen') && !base.fixed.some((f) => f.kind === 'kitchen'));
check('vinduskarmene i kjelleren på verdens-y', base.sills.every((s) => s.y < -1));

section('Nivå på møbler (SceneSync)');
check('level vinner', S.itemLevel({ level: 'kjeller', position: [1, 0, 1] }, layout) === 'kjeller');
check('uten level: nivået y ligger i', S.itemLevel({ position: [4.7, -2.55, 8.4], mount: 'floor' }, layout) === 'kjeller' && S.itemLevel({ position: [4.7, 0, 8.4] }, layout) === 'hoved');
check('taklampe i kjelleren', S.itemLevel({ position: [4.7, -0.3, 8.4], mount: 'ceiling' }, layout) === 'kjeller');
check('kjellerens gulv', S.levelFloorY(layout, 'kjeller') === -2.55 && S.levelFloorY(layout, 'hoved') === 0);

done();
