import './style.css';
import './ui/ui.css';
import { Settings } from './core/Settings.js';
import { AudioSystem } from './core/Audio.js';
import { Menu } from './ui/Menu.js';
import { LoadingScreen } from './ui/Loading.js';
import { Game } from './core/Game.js';
import { Saves } from './design/Saves.js';
import { PLAYER } from './config.js';

/**
 * Start-up: start screen → loading screen → game. Quitting the game shows the start screen again.
 * While a last design exists (a named active design, or unnamed work with real changes) the primary start button
 * (Enter) is «Fortsett: <navn>» and «Start med stua slik den er i dag» starts fresh (the previous unnamed session is
 * then kept as «Forrige økt (dato)»). Without one there is only «Gå inn i stua». Re-evaluated every time the start
 * screen is shown (also after «Avslutt til hovedmeny»).
 * Where the player starts (Game._placeAtStart, notes/hele-huset-design.md §3.6): «Fortsett …» and «Gå inn i stua»
 * continue from the position this viewer stood at last time (src/core/LastPosition.js) – the first visit (nothing
 * saved) starts outside on the forecourt and walks in through the front door; «Start med stua slik den er i dag» is a
 * fresh start, outside again. ?play=1 (tests) starts in the dining area as before unless &spawn= says otherwise.
 */

const MENU_IMAGE = 'img/stue.jpg'; // relative: the build must work from any folder (e.g. kenmyd.no/stue/)

const gameRoot = document.getElementById('game-root');
const uiRoot = document.getElementById('ui-root');
const params = new URLSearchParams(location.search);
/** A dev flag is on unless it is 0 / false / no / nei (?nohelp, ?nohelp=1 …). */
const truthy = (v) => v != null && !['0', 'false', 'no', 'nei'].includes(String(v).trim().toLowerCase());

const settings = new Settings();
const audio = new AudioSystem(settings);
const menu = new Menu(uiRoot, { settings, audio, image: MENU_IMAGE });
let game = null;

menu.onPlay = (mode) => startGame(mode === 'continue' ? 'continue' : 'original', { menu: true });

/** What «Fortsett» would continue: { name } (null name = unnamed work), or null when there is nothing worth it. */
function lastDesign() {
  try {
    const probe = new Saves({ on: () => () => {}, meta: { name: 'Original' } }, { autosave: false });
    const active = probe.activeName;
    if (active && probe.has(active)) return { name: active };
    const store = probe._read();
    if (store.autosave && probe.isWork(store.autosave)) return { name: null };
  } catch {
    /* storage blocked – start fresh */
  }
  return null;
}

/** Shows the start screen with the right start buttons. */
function showMenu() {
  const last = lastDesign();
  menu.setContinue(last);
  menu.show();
  prefetch();
}

let prefetched = false;
/**
 * While the start screen is up: load the home modules and make the textures of today's room (and of the design
 * «Fortsett» would open) in idle time – from the IndexedDB cache after the first visit – so «Gå inn i stua» only has to
 * assemble the scene. Once per page.
 */
function prefetch() {
  if (prefetched) return;
  prefetched = true;
  const kinds = [];
  try {
    const store = new Saves({ on: () => () => {}, meta: { name: 'Original' } }, { autosave: false })._read();
    const json = store.active ? store.designs[store.active] : store.autosave;
    for (const it of json?.items || []) for (const k of Object.values(it?.materials || {})) if (typeof k === 'string') kinds.push(k);
  } catch {
    /* only a prefetch */
  }
  const run = () => {
    if (game) return; // the game is loading already – it prepares what it needs itself
    import('./home/index.js')
      .then((m) => m.prefetchHome?.({ quality: settings.quality, kinds }))
      .catch((err) => console.warn('[menu] prefetch failed', err));
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2500 });
  else setTimeout(run, 800);
}

/**
 * @param {'original'|'continue'} [mode]
 * @param {{ menu?: boolean }} [o]  started from the start screen (else ?play=1)
 */
async function startGame(mode = 'original', { menu: fromMenu = false } = {}) {
  if (game) return;
  const dev = devOverrides();
  // the start position (Game._placeAtStart): ?spawn= wins; the start screen starts at the saved position whichever
  // button was used – the buttons only choose the design (§3.6: «neste lasting starter der»; integrator, bølge 1
  // gruppe 2); ?play=1 keeps the dining area of the references, tours and walkmaps
  if (!dev.spawn) dev.spawn = !fromMenu ? 'inside' : 'saved';
  try {
    await audio.unlock();
  } catch {
    /* audio stays muted until the next user gesture */
  }
  menu.hide();

  const loading = new LoadingScreen(uiRoot, { settings });
  loading.show({ title: 'Stua', subtitle: 'Stue, spisestue og TV-stue', image: MENU_IMAGE });

  game = new Game({
    gameRoot,
    uiRoot,
    settings,
    audio,
    dev: { ...dev, start: params.get('start') || mode },
    onQuit: () => {
      game?.dispose();
      game = null;
      showMenu();
    },
  });

  try {
    await game.load((p, text) => loading.setProgress(p, text));
  } catch (err) {
    console.error(err);
    loading.setError?.(`Klarte ikke å laste stua: ${err.message}`);
    game.dispose();
    game = null;
    setTimeout(() => {
      loading.hide();
      showMenu();
    }, 4000);
    return;
  }
  loading.hide();
  applyDoorParam(game);
  game.start();
  // ?nohelp=1: no controls overview at the start (tests and screenshots; the setting itself is untouched)
  if (truthy(params.get('nohelp'))) game.hud?.showHelp?.(false);
}

/**
 * window.__setView (dev/test, the game page – like dev/sandbox's, so tools/shot.mjs --views works here too): puts the
 * player at a view, on any level, and updates the room / banner at once.
 *   __setView(pos, look, fov)  or  __setView({ pos, look, fov })   pos = the eye (camera) position, look = a point to
 *                                                                  look at, fov in degrees (optional)
 *   __setView({ feet: [x, y, z], yaw, pitch, fov })                feet + angles in degrees (as ?pos= &yaw= &pitch=)
 * Returns { roomId, levelId } after the move. The level follows from y (a jump of the feet resets its hysteresis).
 */
window.__setView = (a, b, c) => {
  const g = game;
  if (!g?.player) return null;
  const v = Array.isArray(a) ? { pos: a, look: b, fov: c } : a || {};
  const P = g.player;
  const feet = P.position.clone();
  let yaw = P.yaw, pitch = P.pitch;
  if (Array.isArray(v.feet)) {
    feet.set(...v.feet);
    if (Number.isFinite(v.yaw)) yaw = (v.yaw * Math.PI) / 180;
    if (Number.isFinite(v.pitch)) pitch = (v.pitch * Math.PI) / 180;
  } else if (Array.isArray(v.pos)) {
    feet.set(v.pos[0], v.pos[1] - PLAYER.eyeHeight, v.pos[2]);
    if (Array.isArray(v.look)) {
      const dx = v.look[0] - v.pos[0], dy = v.look[1] - v.pos[1], dz = v.look[2] - v.pos[2];
      yaw = Math.atan2(-dx, -dz);
      pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
  }
  P.teleport(feet, yaw, pitch);
  if (Number.isFinite(v.fov)) {
    g.camera.fov = v.fov;
    g.camera.updateProjectionMatrix();
  }
  g._roomFeet = null; // counts as a teleport: the new room and level at once, no hysteresis from the old place
  g._updateRoom();
  if (!g.running) {
    g.home?.update?.(0, g.time, { roomId: g.roomId, playerPosition: P.position, camera: g.camera, player: P, inputBlocked: g.inputBlocked });
    g._render();
  }
  return { roomId: g.roomId, levelId: g._levelId ?? null };
};

/**
 * ?doors=open | closed | <id>,<id>… (dev/test): every door of the home open (or closed) at once, without animation or
 * sound – a list of ids opens those doors only. Unknown ids are reported once. The shadow maps are re-rendered,
 * because they are static.
 */
function applyDoorParam(g) {
  const v = params.get('doors');
  if (!v) return;
  const doors = (g.home?.doors || []).filter((d) => d?.door?.setOpen);
  const all = v === 'open' || v === 'closed';
  const ids = all ? null : new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
  for (const d of doors) {
    if (all) d.door.setOpen(v === 'open', { instant: true });
    else if (ids.has(d.id)) d.door.setOpen(true, { instant: true });
  }
  if (ids) {
    const known = new Set(doors.map((d) => d.id));
    const missing = [...ids].filter((id) => !known.has(id));
    if (missing.length) console.warn(`[dev] ?doors=${v}: no door ${missing.join(', ')} (doors: ${[...known].join(', ') || 'none'})`);
  }
  g.home?.lighting?.requestShadowUpdate?.();
}

/**
 * Dev/test URL params: ?play=1 skips the start screen; &pos=x,y,z (feet, metres) &yaw=deg &pitch=deg set the start
 * view (yaw 0 looks along −z = east, 90 = north/−x, −90 = south/+x toward the big windows); &view=walk|orbit|plan
 * (Editor); &design=<saved name>; &start=continue (last session instead of today's room); &doors=open|closed|<ids>
 * (every door open / closed, or the listed ones open – applyDoorParam); &nohelp=1 (no controls overview at the start);
 * &nowarm=1 (Game: skip compiling the catalogue's material variants); &spawn=saved|outside|inside|fresh (Game: the
 * saved position (else outside) / the forecourt by the front door / the dining area / outside ignoring the saved
 * position – also ute, lagret, inne, stua; ?play=1 alone = inside, the start screen = saved). With &pos= y may be any
 * level's floor (the room and its level follow from y).
 * dev.params carries every URL parameter, so later modules can read their own (game.dev.params.get('view')).
 */
function devOverrides() {
  const dev = { params };
  if (params.has('spawn')) {
    const v = String(params.get('spawn')).trim().toLowerCase();
    const spawn = { saved: 'saved', lagret: 'saved', outside: 'outside', ute: 'outside', inside: 'inside', inne: 'inside', stua: 'inside', fresh: 'fresh', ny: 'fresh' }[v];
    if (spawn) dev.spawn = spawn;
    else console.warn(`[dev] ?spawn=${params.get('spawn')} ignored – expected saved, outside, inside or fresh`);
  }
  // only well-formed values are used (a NaN position breaks the camera and the audio listener)
  const finite = (s) => (s != null && String(s).trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
  if (params.has('pos')) {
    const parts = String(params.get('pos')).split(',').map(finite);
    if (parts.length === 3 && parts.every((v) => v !== null)) dev.pos = parts;
    else console.warn(`[dev] ?pos=${params.get('pos')} ignored – expected three numbers x,y,z`);
  }
  for (const key of ['yaw', 'pitch']) {
    if (!params.has(key)) continue;
    const v = finite(params.get(key));
    if (v !== null) dev[key] = (v * Math.PI) / 180;
    else console.warn(`[dev] ?${key}=${params.get(key)} ignored – expected a number (degrees)`);
  }
  return dev;
}

if (params.has('play')) {
  startGame();
} else {
  showMenu();
}
