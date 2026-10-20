import * as THREE from 'three';
import { INTERACT } from '../config.js';
import { Highlighter } from './Highlight.js';

const _ndc = new THREE.Vector2();
const _center = new THREE.Vector2(0, 0);

/**
 * Interactable registry + targeting.
 *
 * Usage (from world builders):
 *   ctx.interaction.register(doorLeafGroup, {
 *     id: 'door-main',
 *     prompt: () => door.isOpen ? 'Lukk dør' : 'Åpne dør',
 *     onInteract: ({ game }) => door.toggle(),
 *     range: 2.6,                // optional, metres from the eye
 *     enabled: () => true,       // optional
 *     status: () => 'Åpen',      // optional second line under the prompt (state, reading …)
 *     highlight: true,           // optional hover glow: true = the registered object, false = none,
 *                                //   Object3D | Object3D[] | () => Object3D[] = those parts only
 *   });
 *
 * Hover feedback: the target gets a rim glow (Highlight.js) besides the prompt; `interaction.highlightEnabled = false`
 * turns it off. `interaction.clear()` drops the target (pause, UI panels).
 *
 * Targeting: when the mouse is captured (mouse-look / FPS mode) the ray goes through the screen centre,
 * otherwise through the cursor (WoW style). Static collision geometry occludes targets.
 */
export class InteractionSystem {
  constructor({ camera, collision, events }) {
    this.camera = camera;
    this.collision = collision;
    this.events = events;
    this.items = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 6;
    this.target = null;
    this._objects = [];
    this._dirty = true;
    this.highlighter = new Highlighter();
    this.highlightEnabled = true;
    // a close-up takes over the mouse: no target, no glow behind the device
    this._offFocus = events?.on?.('focus', ({ active }) => active && this.clear());
  }

  register(object3D, opts) {
    const item = {
      id: opts.id ?? object3D.name ?? `item-${this.items.length}`,
      object: object3D,
      prompt: opts.prompt ?? 'Bruk',
      key: opts.key ?? 'E',
      onInteract: opts.onInteract ?? (() => {}),
      range: opts.range ?? INTERACT.range,
      enabled: opts.enabled ?? (() => true),
      status: opts.status ?? null,
      highlight: opts.highlight ?? true,
    };
    object3D.userData.interactItem = item;
    this.items.push(item);
    this._dirty = true;
    return {
      item,
      unregister: () => {
        const i = this.items.indexOf(item);
        if (i >= 0) this.items.splice(i, 1);
        if (object3D.userData.interactItem === item) delete object3D.userData.interactItem;
        this._dirty = true;
        if (this.target?.item === item) this.target = null;
      },
    };
  }

  /**
   * @param {object} input  Input instance (uses isMouseLook / getPointerNDC)
   * @param {object} hud    Hud instance (setPrompt / setCursor), optional
   * @param {boolean} captured  true when the mouse is captured (centre-screen targeting)
   */
  update(input, hud, captured) {
    let ndc = null;
    if (captured) ndc = _center;
    else if (input && input.getPointerNDC) ndc = input.getPointerNDC(_ndc);

    let found = null;
    if (ndc) {
      if (this._dirty) {
        this._objects = this.items.map((i) => i.object);
        this._dirty = false;
      }
      this.raycaster.setFromCamera(ndc, this.camera);
      const hits = this.raycaster.intersectObjects(this._objects, true);
      for (const hit of hits) {
        if (!isVisible(hit.object)) continue;
        const item = findItem(hit.object);
        if (!item) continue;
        if (!item.enabled()) continue;
        if (hit.distance > item.range) break;
        const occluder = this.collision?.raycast(this.raycaster.ray, hit.distance - 0.08, { includeDynamic: false });
        if (occluder) break;
        found = { item, hit };
        break;
      }
    }

    this.target = found;
    this.highlighter.set(found && this.highlightEnabled ? highlightRoots(found.item) : null);
    this.highlighter.update();
    if (hud) {
      if (found) {
        const text = typeof found.item.prompt === 'function' ? found.item.prompt() : found.item.prompt;
        const status = typeof found.item.status === 'function' ? found.item.status() : found.item.status;
        hud.setPrompt(text, found.item.key, status);
      } else {
        hud.setPrompt(null);
      }
      if (!captured) hud.setCursor(found ? 'pointer' : 'default');
    }
    return found;
  }

  /** Drop the current target and its glow (and the prompt, when a hud is given). */
  clear(hud = null) {
    this.target = null;
    this.highlighter.set(null);
    hud?.setPrompt(null);
  }

  /** Compile the glow shader up front so the first hover does not stutter. */
  warm(renderer) {
    this.highlighter.warm(renderer, this.camera);
  }

  dispose() {
    this._offFocus?.();
    this.highlighter.dispose();
    this.items.length = 0;
    this._objects = [];
    this.target = null;
  }

  /** Use the current target. Returns true if something was used. */
  interact(extra = {}) {
    const t = this.target;
    if (!t) return false;
    try {
      t.item.onInteract({ hit: t.hit, item: t.item, ...extra });
    } catch (err) {
      console.error('[interaction] onInteract failed', err);
    }
    this.events?.emit('interact', { id: t.item.id });
    return true;
  }
}

function highlightRoots(item) {
  const h = item.highlight;
  if (h === false || h == null) return null;
  if (h === true) return item.object;
  return typeof h === 'function' ? h() : h;
}

function findItem(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData.interactItem) return o.userData.interactItem;
  return null;
}

function isVisible(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}
