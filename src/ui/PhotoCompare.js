// Photo comparison (ARCHITECTURE §11/§12): looks through a photo camera (editor.views.setPhotoCamera) and lays the
// photo over the 3D view with a wipe divider and an opacity slider – «Sammenlign med fotomontasjen» for the
// wall proposals (montage camera 0_for) and the room photos in room-spec photoCameras.
import { BasePanel, slider, select, button, badge, assetUrl } from './panelKit.js';
import { h, svg } from './dom.js';
import { ICONS } from './icons.js';
import wallData from '../data/wall-proposals.json';
import * as LIGHTING from '../home/lighting.js';

/**
 * PhotoCompare(editor)
 *   open(photoCamera?, imageUrl?, { title, proposal, follow }?)   photoCamera = layout.photoCameras entry or its id;
 *        without arguments: the montage camera with the montage of the wall proposal in use (or «Bare 3D»)
 *   close()                restores the previous view mode (walk/orbit/plan) and the light
 *   followProposal(p)      WallPanel calls it while flipping: the montage follows the shown proposal
 *   setWipe(0..1), setOpacity(0..1), toggle(), isOpen, update(dt), dispose()
 *
 * The photo is drawn with the camera's vertical field of view over the canvas height (centred, cropped to the
 * photo part of the montage files: photoRect), so it lines up with the render whatever the window aspect. The
 * overlay only takes the mouse on the divider handle – clicks elsewhere still reach the 3D view.
 *
 * «Lys som på bildet» is a temporary override of the LightManager (time, mode, built-in lamps) – nothing is written
 * to the design (no undo step, no autosave); closing restores the design's light. It is on by default for the
 * montages: the montages are built on the «Før» photo (18 Oct, early morning, low daylight, spots on) –
 * home/lighting.js PHOTO_ENV; room-spec photoCameras[].env can override it per photo.
 * Proposals without a montage start as «Bare 3D» through the montage camera; «Vis før-bildet» lays today's wall over.
 * Custom proposals based on a montage proposal (basedOn) offer that montage.
 * The controls start as a slim bar (wipe slider, light, before/after) so the montage stays visible; the compass and
 * the key hints are hidden while comparing.
 */

const PROPOSALS = wallData.proposals || [];
/** The light of the «Før» photo the montages are built on (fallback when lighting.js does not export PHOTO_ENV). */
const PHOTO_ENV = LIGHTING.PHOTO_ENV || { hour: 8.5, month: 10, day: 18, mode: 'auto' };
/** Lamps lit in the montages (the four spots light pools on the wall, the LED strip in the TV niche glows). */
const MONTAGE_LAMPS = { spots: { on: true, dimmer: 1 }, led: { on: true, dimmer: 1 } };

let stylesAdded = false;
function addStyles() {
  if (stylesAdded) return;
  stylesAdded = true;
  const css = `
.pc-overlay { position: absolute; inset: 0; z-index: 6; pointer-events: none; overflow: hidden; }
.pc-photo { position: absolute; background-repeat: no-repeat; will-change: clip-path, opacity; }
.pc-frame { position: absolute; border: 1px dashed rgba(255, 255, 255, 0.28); pointer-events: none; }
.pc-line { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px solid rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0.6em rgba(0, 0, 0, 0.55); pointer-events: none; }
.pc-knob { position: absolute; top: 50%; left: 0; width: 2.6em; height: 2.6em; margin: -1.3em 0 0 -1.3em; border-radius: 50%;
  display: grid; place-items: center; pointer-events: auto; cursor: ew-resize; touch-action: none;
  background: rgba(14, 21, 30, 0.9); border: 2px solid #fff; color: #fff; box-shadow: 0 0.3em 1em rgba(0, 0, 0, 0.45); }
.pc-knob .kv-icon { width: 1.2em; height: 1.2em; }
.pc-tag { position: absolute; top: 0.8em; padding: 0.3em 0.7em; border-radius: 1em; font-size: 0.78em; font-weight: 700;
  background: rgba(10, 14, 20, 0.78); color: #fff; white-space: nowrap; pointer-events: none; }
.pc-panel .ip-panel__head { gap: 0.5em; padding-top: 0.5em; padding-bottom: 0.5em; }
.pc-panel .ip-panel__title { flex: 0 1 auto; font-size: 0.98em; }
.pc-mini { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 0.5em; }
.pc-mini .kv-range { flex: 1 1 6em; min-width: 4em; max-width: 13em; }
.pc-mini .kv-btn { height: 2em; font-size: 0.8em; padding: 0 0.7em; white-space: nowrap; }
.pc-mini .pc-light.is-on { color: var(--kv-accent-2); border-color: var(--kv-accent); }
.pc-panel .ip-panel__body { padding-top: 0.7em; padding-bottom: 0.8em; }
.pc-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.1em 1.2em; }
.pc-grid > .ip-field { grid-column: 1 / -1; }
.pc-sliders { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.1em 1.2em; }
.pc-sliders .ip-field { grid-template-columns: auto minmax(0, 1fr); }
.pc-row { display: flex; flex-wrap: wrap; gap: 0.45em; align-items: center; margin-top: 0.4em; }
.pc-row .kv-btn { height: 2.15em; font-size: 0.84em; }
.pc-note { margin: 0.5em 0 0; font-size: 0.78em; line-height: 1.4; color: var(--kv-ink-3); }
.pc-panel.is-min .ip-panel__body, .pc-panel.is-min .ip-panel__foot { display: none; }
.pc-min { width: 2.1em; height: 2.1em; flex: none; }
/* while comparing: no compass over the photo's top edge, no room banner over the photo, no key bar behind the bar */
#ui-root.pc-active .kv-compass, #ui-root.pc-active .kv-room, #ui-root.pc-active .ix-keys { visibility: hidden !important; }
`;
  document.head.append(h('style', { id: 'pc-styles', text: css }));
}

const ICON_SWAP = ICONS.back.replace('<path d="M15 5l-7 7 7 7"/>', '<path d="M9 7l-4 5 4 5M15 7l4 5-4 5"/>');
const ICON_MIN = ICONS.back.replace('<path d="M15 5l-7 7 7 7"/>', '<path d="M6 12h12"/>');
const ICON_MORE = ICONS.back.replace('<path d="M15 5l-7 7 7 7"/>', '<path d="M6 15l6-6 6 6"/>');

/** Short Norwegian label of a photo camera from its notes. */
function photoLabel(pc) {
  if (pc.montage || pc.id === '0_for') return 'Montasjevinkelen (mot nordøst)';
  const n = String(pc.notes || pc.id).split(/[:.(]/)[0].trim();
  return n.length > 58 ? `${n.slice(0, 56)}…` : n;
}

/** Time of a room photo from its file name (20261018_082806 → 18.10. kl. 08:28). */
function photoTime(pc) {
  const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/.exec(pc.id || '');
  if (!m) return null;
  return { month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]) + Number(m[5]) / 60 };
}

function imageFor(pc) {
  if (pc.montage || pc.id === '0_for') return 'img/forslag/0.jpg';
  return `img/foto/${pc.id}.jpg`;
}

const clock = (hour) => `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;

export class PhotoCompare extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'photo', title: 'Sammenlign med bilde', icon: 'monitor', side: 'bottom', width: 46, className: 'pc-panel' });
    addStyles();
    this.cams = editor.layout?.photoCameras || [];
    this.cam = null;
    this.url = null;
    this.mode = 'photo'; // 'montage' (follows the wall proposal) | 'photo'
    this.kind = 'photo'; // montage mode: 'own' (the proposal's montage) | 'base' (the montage it is based on) | 'none'
    this.wipe = 0.5;
    this.opacity = 1;
    this.photoLeft = true;
    this._prevMode = null;
    this._lightOn = true; // «Lys som på bildet» wanted (on by default)
    this._lightApplied = null; // the env currently applied as override
    this._showBefore = false; // proposals without a montage: lay the «Før» photo over
    this._wipeMontage = 0.5;
    this._minimised = true;
    this._imgSize = new Map();

    // overlay
    this.photoEl = h('div.pc-photo');
    this.frameEl = h('div.pc-frame');
    this.lineEl = h('div.pc-line');
    this.knob = h('div.pc-knob', { title: 'Dra for å flytte skillelinjen', role: 'slider', 'aria-label': 'Skillelinje', tabIndex: -1 }, svg(ICON_SWAP));
    this.lineEl.append(this.knob);
    this.tagPhoto = h('div.pc-tag', { text: 'Bilde' });
    this.tag3d = h('div.pc-tag', { text: '3D' });
    this.overlay = h('div.pc-overlay.kv-scale', { hidden: true }, this.photoEl, this.frameEl, this.lineEl, this.tagPhoto, this.tag3d);
    (editor.uiRoot || document.body).prepend(this.overlay);
    this._bindKnob();

    // full controls (body)
    this.select = select({ label: 'Bilde', options: this._options(), value: 'montage', onChange: (v) => this._choose(v) });
    this.wipeCtl = slider({ label: 'Skillelinje', min: 0, max: 100, step: 1, value: 50, unit: '%', onInput: (v) => this.setWipe(v / 100, true), onChange: (v) => this.setWipe(v / 100, true) });
    this.opCtl = slider({ label: 'Synlighet', min: 0, max: 100, step: 1, value: 100, unit: '%', onInput: (v) => this.setOpacity(v / 100), onChange: (v) => this.setOpacity(v / 100) });
    this.lightBtn = button({ label: 'Lys som på bildet', icon: 'bulb', variant: 'ghost', onClick: () => this._toggleLight() });
    this.swapBtn = button({ label: 'Bytt side', variant: 'ghost', onClick: () => this.swap() });
    this.noteEl = h('p.pc-note');
    this.stateEl = h('span');
    this.body.append(
      this.select.el,
      h('div.pc-sliders', {}, this.wipeCtl.el, this.opCtl.el),
      h('div.pc-row', {},
        this.swapBtn,
        button({ label: 'Bare bildet', variant: 'ghost', onClick: () => this._setBoth(1, 1) }),
        button({ label: 'Bare 3D', variant: 'ghost', onClick: () => this._setBoth(0, 1) }),
        button({ label: '50 % gjennomsiktig', variant: 'ghost', onClick: () => this._setBoth(1, 0.5) }),
        this.lightBtn,
        this.stateEl,
      ),
      this.noteEl,
    );
    // the slim bar in the header: wipe slider, «Vis før-bildet», light, more/less, close
    this.miniWipe = h('input.kv-range', { type: 'range', min: 0, max: 100, step: 1, value: 50, title: 'Skillelinje: dra mot venstre for mer 3D, mot høyre for mer bilde', 'aria-label': 'Skillelinje', on: { input: () => this.setWipe(Number(this.miniWipe.value) / 100, true) } });
    this.beforeBtn = button({ label: 'Vis før-bildet', variant: 'ghost', title: 'Legg bildet av veggen i dag over 3D-bildet', onClick: () => this._toggleBefore() });
    this.miniLight = button({ label: 'Lys som på bildet', icon: 'bulb', variant: 'ghost', title: 'Lyset da bildet ble tatt (endrer ikke designet)', onClick: () => this._toggleLight() });
    this.miniLight.classList.add('pc-light');
    this.mini = h('div.pc-mini', {}, this.miniWipe, this.beforeBtn, this.miniLight);
    this.minBtn = h('button.kv-iconbtn.pc-min', { type: 'button', title: 'Flere valg', 'aria-label': 'Flere valg', on: { click: () => this._toggleMin() } }, svg(ICON_MORE));
    const close = this.panel.head.querySelector('.ip-panel__close');
    this.panel.head.insertBefore(this.mini, close);
    this.panel.head.insertBefore(this.minBtn, close);
    this._applyMin();

    this._offView = editor.events?.on?.('view', ({ mode } = {}) => {
      if (this.isOpen && mode && mode !== 'photo' && !this._switching) {
        this._prevMode = null; // the user switched view themselves
        this.close();
      }
    });
    // the user changed the light (Lys og sol): the design's light wins, the override is dropped
    this._offEnv = editor.design?.on?.('env', () => {
      if (this._lightApplied) {
        this._lightApplied = null;
        this._lightOn = false;
        this._lightState();
      }
    });
    this._onResize = () => this._layout();
    window.addEventListener('resize', this._onResize);
  }

  // ------------------------------------------------------------------------------------------------- choices

  _options() {
    const opts = [['montage', this._montageLabel()]];
    for (const pc of this.cams) if (!pc.montage) opts.push([pc.id, `Foto: ${photoLabel(pc)}`]);
    return opts;
  }

  _montageLabel(p = this._montageProposal()) {
    const m = this._montageFor(p);
    if (!p) return 'Fotomontasje: Før – dagens vegg';
    if (m.kind === 'base') return `Fotomontasje: ${m.base.code} (ditt forslag bygger på den)`;
    if (m.kind === 'none') return `Montasjevinkelen: «${p.custom ? p.name : p.code}» har ingen fotomontasje`;
    return `Fotomontasje: ${p.code} – ${p.name}`;
  }

  /** The proposal the montage follows: the one the wall panel shows, else the design's. */
  _montageProposal() {
    if (this._followed) return this._followed;
    const wp = this.editor.ui?.wall;
    const id = wp?.shown?.().proposalId ?? this.editor.design?.wall?.proposalId;
    return wp?.proposal?.(id) || PROPOSALS.find((p) => p.id === String(id)) || null;
  }

  /** Which photo the montage camera shows for a proposal: its montage, the one it is based on, or «Før» (none). */
  _montageFor(p) {
    if (!p || p.id === '0') return { kind: 'own', url: 'img/forslag/0.jpg' };
    if (p.image) return { kind: 'own', url: p.image };
    const base = p.basedOn ? PROPOSALS.find((x) => x.id === String(p.basedOn)) : null;
    if (base?.image) return { kind: 'base', url: base.image, base };
    return { kind: 'none', url: 'img/forslag/0.jpg' };
  }

  _choose(v) {
    if (v === 'montage') {
      const pc = this.editor.layout?.photoCamera?.('0_for') || this.cams.find((c) => c.montage);
      this._show(pc, null, 'montage');
    } else {
      const pc = this.cams.find((c) => c.id === v);
      if (pc) this._show(pc, imageFor(pc), 'photo');
    }
  }

  // ------------------------------------------------------------------------------------------------- open/close

  /**
   * Opens the comparison.
   * @param {object|string} [photoCamera]  layout.photoCameras entry or id (default: the montage camera)
   * @param {string|null} [imageUrl]        relative 'img/…' URL (default: the camera's photo / the proposal montage)
   * @param {{ proposal?: object, follow?: boolean, title?: string }} [opts]
   */
  open(photoCamera, imageUrl, opts = {}) {
    let pc = typeof photoCamera === 'string' ? this.editor.layout?.photoCamera?.(photoCamera) : photoCamera;
    if (pc && !pc.pos && pc.id) pc = this.editor.layout?.photoCamera?.(pc.id) || pc;
    if (!pc || !pc.pos) pc = this.editor.layout?.photoCamera?.('0_for') || this.cams[0];
    if (!pc) {
      this.editor.events?.emit?.('toast', { text: 'Fant ingen fotovinkler i rom-dataene' });
      return;
    }
    const montage = !!(pc.montage || pc.id === '0_for');
    this._followed = opts.proposal || null;
    if (!this.isOpen) {
      const v = this.editor.views;
      this._prevMode = v && v.mode && v.mode !== 'photo' ? v.mode : this._prevMode;
      this._minimised = true;
      this._applyMin();
    }
    this._show(pc, montage && opts.follow !== false ? null : imageUrl || imageFor(pc), montage && opts.follow !== false ? 'montage' : 'photo', imageUrl);
    if (!this.isOpen) {
      this.overlay.hidden = false;
      super.open();
      // the wall panel shrinks to its proposal switcher while comparing (panels.css #ui-root.pc-active)
      this.editor.uiRoot?.classList?.add('pc-active');
      this.editor.ui?.wall?._updateHighlight?.();
    }
    this._syncLight();
    this._layout();
  }

  /**
   * @param {object} pc     photo camera
   * @param {string|null} url  photo URL (montage mode: null = follow the proposal)
   * @param {'montage'|'photo'} mode
   * @param {string} [forced]  an explicit image for montage mode (callers passing their own picture)
   */
  _show(pc, url, mode, forced) {
    const prevKind = this.kind;
    this.cam = pc;
    this.mode = mode;
    let note = '';
    if (mode === 'montage') {
      const p = this._montageProposal();
      const m = forced ? { kind: 'own', url: forced } : this._montageFor(p);
      this.kind = m.kind;
      url = m.url;
      if (m.kind === 'none') {
        // nothing to compare with: start as «Bare 3D»; «Vis før-bildet» lays today's wall over
        if (prevKind !== 'none') this._wipeMontage = this.wipe > 0.001 ? this.wipe : this._wipeMontage;
        this.setWipe(this._showBefore ? Math.max(0.5, this.wipe) : 0);
        note = `${p?.custom ? `«${p.name}»` : `Forslag ${p?.code}`} har ingen fotomontasje: du ser 3D-bildet fra montasjevinkelen. «Vis før-bildet» legger bildet av veggen i dag over.`;
      } else {
        if (prevKind === 'none' && !this._showBefore) this.setWipe(this._wipeMontage || 0.5);
        if (m.kind === 'base') note = `Montasjen viser forslag ${m.base.code} (${m.base.name}), som ditt forslag bygger på.`;
      }
    } else this.kind = 'photo';
    this.url = url;
    this.select.setOptions(this._options());
    this.select.set(mode === 'montage' ? 'montage' : pc.id);
    this._switching = true;
    try {
      this.editor.views?.setPhotoCamera?.(pc);
    } catch (err) {
      console.warn('[PhotoCompare] setPhotoCamera failed', err);
    } finally {
      this._switching = false;
    }
    this._loadImage(url);
    const conf = { high: 'sikker', med: 'middels sikker', low: 'usikker' }[pc.confidence] || 'middels sikker';
    const time = photoTime(pc);
    const env = this._photoEnv();
    const when = mode === 'montage'
      ? `Montasjene er laget på «Før»-bildet (${PHOTO_ENV.day}.${PHOTO_ENV.month}. kl. ${clock(env?.hour ?? PHOTO_ENV.hour)}, spottene på).`
      : time ? `Tatt ${time.day}.${time.month}. kl. ${clock(time.hour)}.` : '';
    this.noteEl.textContent = `${when}${note ? ` ${note}` : ''} Kameravinkelen er regnet ut fra bildet (${conf}); møbler som er flyttet eller endret i designet vil ikke stemme. Dra den hvite skillelinjen eller bruk glidebryterne. Esc går tilbake.`;
    this.panel.setTitle(mode === 'montage' && this.kind !== 'none' ? 'Sammenlign med fotomontasjen' : 'Sammenlign med bildet');
    this.beforeBtn.hidden = !(mode === 'montage' && this.kind === 'none');
    this.beforeBtn.querySelector('span').textContent = this._showBefore ? 'Skjul før-bildet' : 'Vis før-bildet';
    this._syncLight();
    this._lightState();
  }

  _loadImage(url) {
    const src = /^(https?:|data:|blob:)/.test(url) ? url : assetUrl(url);
    this.photoEl.style.backgroundImage = `url("${src}")`;
    if (this._imgSize.has(src)) {
      this._layout();
      return;
    }
    const img = new Image();
    img.onload = () => {
      this._imgSize.set(src, [img.naturalWidth, img.naturalHeight]);
      this._layout();
    };
    img.onerror = () => this.editor.events?.emit?.('toast', { text: 'Fant ikke bildet' });
    img.src = src;
    this._src = src;
  }

  close() {
    if (!this.isOpen) return;
    super.close();
  }

  onClose() {
    this.overlay.hidden = true;
    this.editor.uiRoot?.classList?.remove('pc-active');
    this._followed = null;
    this._restoreLight();
    const v = this.editor.views;
    if (v?.mode === 'photo') {
      this._switching = true;
      try {
        if (this._prevMode && this._prevMode !== 'walk' && this._prevMode !== 'photo') v.set?.(this._prevMode);
        else v.exitPhoto?.();
      } finally {
        this._switching = false;
      }
    }
    this._prevMode = null;
    this.editor.ui?.wall?._updateHighlight?.();
  }

  /** WallPanel: the shown proposal changed – follow it with the montage. */
  followProposal(p) {
    if (!this.isOpen || this.mode !== 'montage') return;
    this._followed = p || null;
    this._show(this.cam, null, 'montage');
    this._layout();
  }

  _toggleBefore() {
    this._showBefore = !this._showBefore;
    if (this.mode === 'montage' && this.kind === 'none') this.setWipe(this._showBefore ? 0.5 : 0);
    this.beforeBtn.querySelector('span').textContent = this._showBefore ? 'Skjul før-bildet' : 'Vis før-bildet';
  }

  // ------------------------------------------------------------------------------------------------- wipe / opacity

  /** @param {number} t  0 = only 3D … 1 = only the photo; user = moved by the user (remembered) */
  setWipe(t, user = false) {
    this.wipe = Math.max(0, Math.min(1, t));
    this.wipeCtl.set(Math.round(this.wipe * 100));
    if (this.miniWipe) {
      this.miniWipe.value = String(Math.round(this.wipe * 100));
      this.miniWipe.style.setProperty('--p', `${Math.round(this.wipe * 100)}%`);
    }
    if (user && this.mode === 'montage' && this.kind === 'none' && this.wipe > 0.01 && !this._showBefore) {
      this._showBefore = true;
      this.beforeBtn.querySelector('span').textContent = 'Skjul før-bildet';
    }
    this._layout();
  }

  setOpacity(t) {
    this.opacity = Math.max(0, Math.min(1, t));
    this.opCtl.set(Math.round(this.opacity * 100));
    this.photoEl.style.opacity = String(this.opacity);
  }

  swap() {
    this.photoLeft = !this.photoLeft;
    this._layout();
  }

  _setBoth(wipe, opacity) {
    this.setWipe(this.photoLeft ? wipe : 1 - wipe, true);
    this.setOpacity(opacity);
  }

  _bindKnob() {
    let dragging = false;
    const move = (e) => {
      const r = this._rect;
      if (!r) return;
      const t = (e.clientX - r.left) / Math.max(1, r.width);
      this.setWipe(this.photoLeft ? t : 1 - t, true);
    };
    this.knob.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      this.knob.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    this.knob.addEventListener('pointermove', (e) => {
      if (dragging) move(e);
    });
    const up = (e) => {
      if (!dragging) return;
      dragging = false;
      try {
        this.knob.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    this.knob.addEventListener('pointerup', up);
    this.knob.addEventListener('pointercancel', up);
  }

  /** Horizontal range of the overlay root (px, root coordinates) not covered by the docked side panels. */
  _freeX(rr) {
    let x0 = 0, x1 = rr.width;
    for (const el of document.querySelectorAll('.ip-panel--right.is-open, .ip-panel--left.is-open')) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.top > rr.top + rr.height * 0.5) continue;
      if (el.classList.contains('ip-panel--right')) x1 = Math.min(x1, r.left - rr.left - 8);
      else x0 = Math.max(x0, r.right - rr.left + 8);
    }
    return [x0, x1];
  }

  /** Positions the photo over the canvas: vertical FOV of the photo camera vs the render camera. */
  _layout() {
    if (!this.isOpen && this.overlay.hidden) return;
    const canvas = this.editor.renderer?.domElement;
    const root = this.overlay.parentElement;
    if (!canvas || !root || !this.cam) return;
    const cr = canvas.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const cam = this.editor.activeCamera || this.editor.camera;
    const fovCam = cam?.isPerspectiveCamera ? cam.fov : this.cam.vfovDeg;
    const k = Math.tan((this.cam.vfovDeg * Math.PI) / 360) / Math.tan((fovCam * Math.PI) / 360);
    const dispH = cr.height * k;
    const [px, py, pw, ph] = this.cam.photoRect || [0, 0, ...(this.cam.imageSize || [4, 3])];
    const aspect = pw / ph;
    const dispW = dispH * aspect;
    const left = cr.left - rr.left + (cr.width - dispW) / 2;
    const top = cr.top - rr.top + (cr.height - dispH) / 2;
    // the image file may be a downscaled copy: map the photo rectangle by fractions of the original size
    const [iw, ih] = this.cam.imageSize || [pw, ph];
    const bgW = dispW / (pw / iw), bgH = dispH / (ph / ih);
    Object.assign(this.photoEl.style, {
      left: `${left}px`, top: `${top}px`, width: `${dispW}px`, height: `${dispH}px`,
      backgroundSize: `${bgW}px ${bgH}px`, backgroundPosition: `${-(px / iw) * bgW}px ${-(py / ih) * bgH}px`,
      opacity: String(this.opacity),
    });
    Object.assign(this.frameEl.style, { left: `${left}px`, top: `${top}px`, width: `${dispW}px`, height: `${dispH}px` });
    const x = left + dispW * (this.photoLeft ? this.wipe : 1 - this.wipe);
    const clip = this.photoLeft ? `inset(0 ${(1 - this.wipe) * 100}% 0 0)` : `inset(0 0 0 ${(1 - this.wipe) * 100}%)`;
    this.photoEl.style.clipPath = clip;
    this.lineEl.style.left = `${Math.max(left, Math.min(left + dispW, x))}px`;
    this.lineEl.hidden = this.wipe <= 0.001 || this.wipe >= 0.999;
    this.knob.style.top = `${top + dispH * 0.42}px`;
    this._rect = { left: cr.left + (left - (cr.left - rr.left)), width: dispW };
    // tags: inside their half of the photo AND inside the part the side panels leave visible
    this.tagPhoto.textContent = this.mode === 'montage' && this.kind !== 'none' ? 'Fotomontasje' : 'Foto';
    const [fx0, fx1] = this._freeX(rr);
    const tagY = `${Math.max(top, cr.top - rr.top) + 12}px`;
    const place = (tag, a, b, atStart) => {
      const lo = Math.max(a, fx0), hi = Math.min(b, fx1);
      const w = tag.offsetWidth || (tag === this.tag3d ? 40 : 100);
      if (hi - lo < w + 24) {
        tag.hidden = true;
        return;
      }
      tag.hidden = false;
      tag.style.top = tagY;
      tag.style.left = `${atStart ? lo + 12 : hi - 12 - w}px`;
    };
    this.tagPhoto.hidden = false;
    this.tag3d.hidden = false;
    if (this.wipe <= 0.04 || this.wipe >= 0.96) {
      this.tagPhoto.hidden = true;
      this.tag3d.hidden = true;
    } else if (this.photoLeft) {
      place(this.tagPhoto, left, x, true);
      place(this.tag3d, x, left + dispW, false);
    } else {
      place(this.tag3d, left, x, true);
      place(this.tagPhoto, x, left + dispW, false);
    }
  }

  // ------------------------------------------------------------------------------------------------- light like the photo

  _lighting() {
    return this.editor.home?.lighting || this.editor.lighting || null;
  }

  /** The light of the shown photo: { hour, month, day, mode, builtIn } (montages: the «Før» photo, spots on). */
  _photoEnv() {
    if (!this.cam) return null;
    if (this.mode === 'montage' || this.cam.montage) {
      const own = this.cam.env || null; // room-spec may store the montage light per camera
      return { ...PHOTO_ENV, builtIn: MONTAGE_LAMPS, ...(own || {}) };
    }
    const t = photoTime(this.cam);
    return t ? { ...t, mode: 'auto', builtIn: null, ...(this.cam.env || {}) } : null;
  }

  /** Applies / removes the temporary light override (nothing is stored in the design). */
  _syncLight() {
    if (!this.isOpen && !this._opening) {
      if (this._lightApplied) this._restoreLight();
      return;
    }
    const env = this._lightOn ? this._photoEnv() : null;
    if (!env) {
      this._restoreLight();
      return;
    }
    const key = JSON.stringify(env);
    if (this._lightApplied === key) return;
    const L = this._lighting();
    if (!L) return;
    L.setTime?.({ hour: env.hour, month: env.month, day: env.day });
    L.setMode?.(env.mode || 'auto');
    for (const g of L.builtInGroups || []) L.setBuiltIn?.(g.id, env.builtIn?.[g.id] ?? null);
    L.requestShadowUpdate?.();
    this._lightApplied = key;
    this._lightState();
  }

  /** Back to the design's own light (what SceneSync applies from design.env). */
  _restoreLight() {
    if (!this._lightApplied) return;
    this._lightApplied = null;
    const L = this._lighting();
    const env = this.editor.design?.env;
    if (L && env) {
      L.setTime?.({ hour: env.hour, month: env.month, day: env.day });
      L.setMode?.(env.mode);
      for (const g of L.builtInGroups || []) L.setBuiltIn?.(g.id, env.builtIn?.[g.id] ?? null);
      L.requestShadowUpdate?.();
    }
    this._lightState();
  }

  _toggleLight(on = !this._lightApplied) {
    this._lightOn = !!on;
    this._syncLight();
    if (!on) this._restoreLight();
    this._lightState();
  }

  _lightState() {
    const on = !!this._lightApplied;
    for (const b of [this.lightBtn, this.miniLight]) {
      b.classList.toggle('ip-btn--primary', on && b === this.lightBtn);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const env = this._photoEnv();
    this.lightBtn.querySelector('span').textContent = on ? 'Lys som på bildet (på)' : 'Lys som på bildet';
    this.miniLight.title = env ? `${on ? 'Lyset er som på bildet' : 'Sett lyset som på bildet'}: ${env.day}.${env.month}. kl. ${clock(env.hour)} (endrer ikke designet)` : 'Lys som på bildet';
    this.stateEl.replaceChildren(this.mode === 'montage' ? badge('Følger veggforslaget', 'info') : badge('Romfoto', 'neutral'));
  }

  _applyMin() {
    this.el.classList.toggle('is-min', this._minimised);
    this.minBtn.title = this._minimised ? 'Flere valg' : 'Færre valg';
    this.minBtn.setAttribute('aria-label', this.minBtn.title);
    this.minBtn.replaceChildren(svg(this._minimised ? ICON_MORE : ICON_MIN));
  }

  _toggleMin() {
    this._minimised = !this._minimised;
    this._applyMin();
  }

  // ------------------------------------------------------------------------------------------------- frame

  update() {
    if (!this.isOpen) return;
    // keep aligned (window resize, fov transitions of the view modes, side panels opening/closing)
    const cam = this.editor.activeCamera;
    const panels = document.querySelectorAll('.ip-panel--right.is-open, .ip-panel--left.is-open').length;
    const key = `${cam?.fov}|${this.editor.renderer?.domElement?.clientWidth}|${this.editor.renderer?.domElement?.clientHeight}|${panels}`;
    if (key !== this._key) {
      this._key = key;
      this._layout();
    }
  }

  dispose() {
    this._offView?.();
    this._offEnv?.();
    this._restoreLight();
    window.removeEventListener('resize', this._onResize);
    this.overlay.remove();
    super.dispose();
  }
}

export default PhotoCompare;
