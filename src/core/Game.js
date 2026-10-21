import * as THREE from 'three';
import { Emitter } from './Events.js';
import { CollisionWorld } from './Collision.js';
import { InteractionSystem } from './Interaction.js';
import { Input } from './Input.js';
import { PlayerController } from '../player/PlayerController.js';
import { Hud } from '../ui/Hud.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { setMaxAnisotropy } from '../world/proctex.js';

const _eye = new THREE.Vector3();

/**
 * One play session: renderer, scene, player, home, editor. Created by main.js when the player presses «Gå inn i
 * stua», disposed when they quit to the start screen.
 *
 * CONTRACT (used by main.js; window.__game is this instance):
 *   new Game({ gameRoot, uiRoot, settings, audio, onQuit, dev })
 *   await load(onProgress(fraction, text))   builds the home (src/home/index.js createHome(ctx)), collision, player,
 *                                             then the Editor (src/design/Editor.js)
 *   start()                                   starts the frame loop (sets window.__ready after 600 ms)
 *   pause() / resume() / quit() / dispose()
 *   blockInput(reason) → release()            hand the mouse/keyboard to a UI panel: while any block is active the
 *                                             player stands still, nothing is targeted and Esc does not pause (the
 *                                             panel handles its own Esc). The world keeps updating and rendering.
 *   inputBlocked: boolean
 *   scene, camera, renderer, collision, interaction, input, player, hud, events, settings, audio, home, roomId, time,
 *   design (= home.design), editor
 *
 * Frame order: input → Esc (editor.handleEscape, else pause) → (help, player [only when the editor's view is 'walk'
 * and editor.blocksGameInput() is false], interaction, click → editor.handleClick → else interaction, E: stand up
 * when seated, sit on Selection.hoverSeat() when nothing else is targeted, else interaction) →
 * editor.update → room → home.update → audio → hud → render (home.lighting.render(renderer, scene, camera) when the
 * LightManager provides it – post-processing hook – else renderer.render).
 *
 * Loading: home → collision/player → Editor (its materials belong to the scene too) → every shader program compiled
 * in parallel (KHR_parallel_shader_compile, «Forbereder grafikken») → first frame → a short GPU probe that picks the
 * start resolution. The material variants that are not in the room yet (SceneSync.warmUpGroup) compile in the same
 * step, so nothing compiles mid-interaction (on ANGLE/D3D11 a program costs seconds of GPU time).
 * fps (HUD, dynamic resolution) is measured on real elapsed time; only the simulation step is clamped to 50 ms.
 * Closing the tab never asks «Forlate nettstedet?» while the design is saved: a waiting autosave is written on
 * pagehide / when the tab is hidden / before unload; only changes that cannot be written (storage full or blocked)
 * make the browser ask.
 */
export class Game {
  /**
   * @param {object} o
   * @param {HTMLElement} o.gameRoot   container for the WebGL canvas
   * @param {HTMLElement} o.uiRoot     container for HUD / menus (DOM overlays)
   * @param {import('./Settings.js').Settings} o.settings
   * @param {import('./Audio.js').AudioSystem} [o.audio]
   * @param {() => void} o.onQuit      called when the player chooses «Avslutt»
   * @param {object} [o.dev]           { pos:[x,y,z], yaw, pitch, params: URLSearchParams } (URL params, radians)
   * @param {() => Promise<{createHome: Function}>} [o.loadHome]  module loader (default: import('../home/index.js'))
   */
  constructor({ gameRoot, uiRoot, settings, audio, onQuit, dev = {}, loadHome }) {
    this.gameRoot = gameRoot;
    this.uiRoot = uiRoot;
    this.settings = settings;
    this.audio = audio;
    this.onQuit = onQuit;
    this.dev = dev;
    this.loadHome = loadHome ?? (() => import('../home/index.js'));

    this.events = new Emitter();
    this.timer = new THREE.Timer();
    this.time = 0;
    this.running = false;
    this.paused = false;
    this.roomId = null;
    this.home = null;
    this.design = null;
    this.editor = null;
    this._blocks = new Set();
    this._raf = 0;
    this._fps = { frames: 0, time: 0 };
    this._disposers = [];

    const q = settings.quality;
    const renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
    renderer.setPixelRatio(this._basePixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral: the LightManager's calibrated tone mapping (set here too so no shader compiles twice)
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap; // soft edges come from light.shadow.radius
    // production: skip getProgramInfoLog after every shader compile (faster start, no driver warning spam)
    renderer.debug.checkShaderErrors = !import.meta.env?.PROD;
    renderer.domElement.className = 'game-canvas';
    renderer.domElement.tabIndex = 0;
    gameRoot.appendChild(renderer.domElement);
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), window.innerWidth / window.innerHeight, 0.05, q.drawDistance);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.collision = new CollisionWorld();
    this.collision.ghostFurniture = !settings.get('physicalBody');
    this.interaction = new InteractionSystem({ camera: this.camera, collision: this.collision, events: this.events });
    this.input = new Input(renderer.domElement, settings);
    this.hud = new Hud(uiRoot, settings, { placeName: 'Hjemme' });
    this.pauseMenu = new PauseMenu(uiRoot, settings, {
      onResume: () => this.resume(),
      onQuit: () => this.quit(),
      audio,
    });

    // events → audio / hud
    this._disposers.push(
      this.events.on('sfx', (e) => this.audio?.play?.(e.name, e)),
      // footsteps / jump / landing only when you are a physical person (Innstillinger → Fysisk person)
      this.events.on('footstep', (e) => this.settings.get('physicalBody') && this.audio?.play?.('footstep', e)),
      this.events.on('jump', (e) => this.settings.get('physicalBody') && this.audio?.play?.('jump', e)),
      this.events.on('land', (e) => this.settings.get('physicalBody') && this.audio?.play?.('land', e)),
      this.events.on('toast', (e) => this.hud.toast(e.text, e.seconds)),
    );

    const onSettings = ({ key, value }) => {
      if (key === 'physicalBody') {
        this.collision.ghostFurniture = !value;
      } else if (key === 'fov') {
        this.camera.fov = value;
        this.camera.updateProjectionMatrix();
      } else if (key === 'quality') {
        this.renderer.setPixelRatio(this._basePixelRatio() * (this._dyn?.scale ?? 1));
        this.hud.toast('Noen grafikkvalg trer i kraft neste gang du starter spillet.', 4);
      }
      this.events.emit('settings', { key, value });
    };
    settings.on('change', onSettings);
    this._disposers.push(() => settings.off('change', onSettings));

    // closing the tab / reloading: write a waiting autosave right away; ask only when changes cannot be saved
    this._onBeforeUnload = (e) => {
      if (!this.running || this._flushSaves()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    this._onPageHide = () => this._flushSaves();
    this._onVisibility = () => {
      if (document.visibilityState === 'hidden') this._flushSaves();
    };
    window.addEventListener('beforeunload', this._onBeforeUnload);
    window.addEventListener('pagehide', this._onPageHide);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._disposers.push(() => {
      window.removeEventListener('beforeunload', this._onBeforeUnload);
      window.removeEventListener('pagehide', this._onPageHide);
      document.removeEventListener('visibilitychange', this._onVisibility);
    });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._disposers.push(() => window.removeEventListener('resize', this._onResize));

    this._frame = this._frame.bind(this);
    window.__game = this;
  }

  /** Build the world. onProgress(fraction 0..1, text). */
  async load(onProgress = () => {}) {
    const ctx = {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      collision: this.collision,
      interaction: this.interaction,
      events: this.events,
      audio: this.audio,
      settings: this.settings,
      quality: this.settings.quality,
      input: this.input,
      hud: this.hud,
      uiRoot: this.uiRoot,
      game: this,
      dev: this.dev,
      progress: (p, text) => onProgress(Math.min(0.9, p), text),
    };
    onProgress(0.02, 'Laster stua');
    const mod = await this.loadHome();
    this.home = await mod.createHome(ctx);

    onProgress(0.92, 'Bygger kollisjon');
    await new Promise((r) => setTimeout(r, 0));
    this.collision.build();
    this._setupLevels();

    this.player = new PlayerController({
      camera: this.camera,
      collision: this.collision,
      input: this.input,
      settings: this.settings,
      events: this.events,
    });
    const spawn = this.home.spawn;
    const pos = this.dev.pos ? this._freeFloor(new THREE.Vector3(...this.dev.pos)) : spawn.position.clone();
    this.player.teleport(pos, this.dev.yaw ?? spawn.yaw ?? 0, this.dev.pitch ?? spawn.pitch ?? 0);
    this.design = this.home.design ?? null;

    // the editor first: its highlight, footprint and gizmo materials are part of the scene that gets compiled
    onProgress(0.93, 'Starter verktøyene');
    await new Promise((r) => setTimeout(r, 0));
    try {
      const { Editor } = await import('../design/Editor.js');
      this.editor = new Editor(this, this.home);
    } catch (err) {
      console.error('[game] editor failed to start', err);
      this.editor = null;
    }
    this.interaction.warm(this.renderer);
    this._setupRespawn();

    // every program compiles in parallel while the loading screen keeps animating; the first frame then only links
    await this._precompile((f) => onProgress(0.95 + 0.04 * f, 'Forbereder grafikken'));
    this._render();
    this._probeGpu();
    onProgress(1, 'Klar');
  }

  /**
   * Compiles the scene's shader programs without blocking (KHR_parallel_shader_compile) and waits until the GPU is
   * done (max 90 s), reporting the share of finished programs.
   * @param {(fraction: number) => void} onProgress
   */
  async _precompile(onProgress) {
    const r = this.renderer;
    const cams = [this.camera];
    const extra = this.editor?.activeCamera;
    if (extra && extra !== this.camera) cams.push(extra);
    const waiting = new Set();
    try {
      for (const cam of cams) for (const m of r.compile(this.scene, cam)) waiting.add(m);
      // every material variant the catalogue / wall proposals / ghosts can bring (compiled now, not mid-interaction)
      const warm = this.dev?.params?.has?.('nowarm') ? null : this.home?.sync?.warmUpGroup?.();
      if (warm) for (const m of r.compile(warm, this.camera, this.scene)) waiting.add(m);
    } catch (err) {
      console.warn('[game] precompile failed', err);
      return;
    }
    const total = waiting.size || 1;
    const t0 = performance.now();
    while (waiting.size && performance.now() - t0 < 90000) {
      for (const m of [...waiting]) {
        const p = r.properties.get(m)?.currentProgram;
        if (!p || typeof p.isReady !== 'function' || p.isReady()) waiting.delete(m);
      }
      onProgress(1 - waiting.size / total);
      if (waiting.size) await new Promise((res) => setTimeout(res, 30));
    }
  }

  /**
   * Times a few frames (render + a 1-pixel read, which waits for the GPU) and lowers the start resolution on a slow
   * GPU, so the first seconds are smooth instead of waiting for dynamic resolution to step down.
   */
  _probeGpu() {
    if (!this.settings.get('autoResolution')) return;
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    try {
      this._render(); // shadow maps, environment: not part of the steady cost
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      const n = 5;
      for (let i = 0; i < n; i++) {
        this._render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      const ms = (performance.now() - t0) / n;
      this.gpuProbeMs = ms;
      // the frame cost is per pixel: scale² ≈ budget / cost (14 ms leaves room for the rest of a 60 Hz frame)
      if (ms > 16) {
        const scale = Math.max(0.55, Math.min(1, Math.sqrt(14 / ms)));
        this._setResolutionScale(scale);
        console.info('[game] GPU probe ' + ms.toFixed(1) + ' ms per frame → start resolution ' + Math.round(scale * 100) + ' %');
      }
    } catch (err) {
      console.warn('[game] GPU probe failed', err);
    }
  }

  /**
   * A dev start point (?pos=) inside furniture (the kitchen island …) would put the player on top of it with the
   * camera near the ceiling: move it to the nearest free floor point instead (rings of 0.25 m, up to 3 m).
   * On every level (§3.7, steg 20): the ray starts under the ceiling of pos's level (layout.house.ceilingHeightAt(x, z,
   * y) – in the stairwell the ceiling of the floor above) and a hit within ±0.3 m of pos.y is floor; the ring points
   * stay in pos's room on pos's level, so the search never goes through a wall or onto the other level. Points outside
   * the house (the terrace, the forecourt) are taken as they are.
   * @param {THREE.Vector3} pos  feet
   * @returns {THREE.Vector3}
   */
  _freeFloor(pos) {
    const c = this.collision;
    const layout = this.home?.layout;
    const house = layout?.house ?? null;
    if (!c?.raycast) return pos;
    const y0 = Number.isFinite(pos.y) ? pos.y : 0;
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    // the room of pos on its level (body centre, like the HUD); without the house the living room's polygon
    const room = house?.roomAt?.(pos.x, y0 + 0.9, pos.z) ?? null;
    const inside = (x, z) => {
      if (house?.isInside) return house.isInside(x, z, y0) && (!room || room.contains(x, z));
      return !layout?.isInside || layout.isInside(x, z);
    };
    const ceilingAt = (x, z) => (house?.ceilingHeightAt ? house.ceilingHeightAt(x, z, y0) : layout?.ceilingHeightAt?.(x, z));
    const floorAt = (x, z) => {
      const ceil = ceilingAt(x, z);
      const top = (Number.isFinite(ceil) ? ceil : y0 + 2.4) - 0.05;
      ray.origin.set(x, top, z);
      const hit = c.raycast(ray, top - y0 + 0.5);
      return hit ? hit.point.y : -Infinity;
    };
    // free = no furniture top under the point higher than a step (rugs and thresholds are fine; the capsule pushes
    // itself out of anything it merely touches)
    let hitY = -Infinity;
    const free = (x, z) => {
      if (!inside(x, z)) return false;
      hitY = floorAt(x, z);
      return hitY > y0 - 0.3 && hitY < y0 + 0.3;
    };
    if (!inside(pos.x, pos.z) || free(pos.x, pos.z)) return pos; // outside (terrace tests) or already free
    for (let r = 0.25; r <= 3; r += 0.25) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
        if (free(x, z)) {
          const y = Math.abs(hitY) < 1e-6 ? 0 : hitY;
          console.warn('[dev] ?pos=' + [pos.x, pos.y, pos.z].join(',') + ' is inside furniture – starting at ' + [x.toFixed(2), +y.toFixed(3), z.toFixed(2)].join(','));
          return new THREE.Vector3(x, y, z);
        }
      }
    }
    return pos;
  }

  /**
   * The levels of the house in the collision (§3.4, steg 20), after collision.build(): the walkable area becomes one
   * rectangle per level – the ground floor's is the one the shell and the exterior set (the living room and the
   * terrace, as before), the others are layout.house.walkRects – plus the forecourt's (outsideHouse.walkRects), each
   * for its band of feet heights; and groundHeight falls back to the house's floors (layout.house.floorYAt). A house
   * with one level and no outside keeps the plain rectangle.
   */
  _setupLevels() {
    const c = this.collision;
    const house = this.home?.layout?.house;
    if (!c?.setBoundsList || !house?.walkRects) return;
    const outside = house.outsideHouse?.walkRects ?? [];
    if (house.levels.length < 2 && !outside.length) return;
    const b = c.bounds;
    const rects = [];
    for (const r of house.walkRects) {
      // the ground floor: the bounds the builders set (they hold the terrace), and the level's own rectangle
      if (r.levelId === house.levels[0]?.id && Number.isFinite(b.minX + b.maxX + b.minZ + b.maxZ)) rects.push({ ...b, minY: r.minY, maxY: r.maxY, levelId: r.levelId });
      rects.push(r);
    }
    for (const r of outside) rects.push({ ...r, levelId: r.levelId ?? 'ute' });
    c.setBoundsList(rects);
    if (house.floorYAt) c.setFloorField((x, z, y) => house.floorYAt(x, z, y));
  }

  /**
   * Reserve respawn points (§3.5, steg 20), after the player exists: the forecourt (outsideHouse.spawnOutside), then
   * the home's spawn (the dining room). PlayerController.respawn() takes the first safe one when neither the last safe
   * point nor the first teleport target (?pos=) is safe.
   */
  _setupRespawn() {
    const p = this.player;
    if (!p?.setReserveSpawns) return;
    const list = [];
    const out = this.home?.layout?.house?.outsideHouse?.spawnOutside;
    if (Array.isArray(out?.pos) && out.pos.length === 3) list.push({ position: new THREE.Vector3(...out.pos), yaw: THREE.MathUtils.degToRad(out.yawDeg ?? 0) });
    const sp = this.home?.spawn;
    if (sp?.position) list.push({ position: sp.position.clone(), yaw: sp.yaw ?? 0 });
    p.setReserveSpawns(list);
  }

  /** Writes a waiting autosave now. @returns {boolean} true when nothing unsaved is left */
  _flushSaves() {
    const saves = this.home?.saves;
    if (!saves) return true;
    try {
      return saves.flush?.() !== false;
    } catch {
      return false;
    }
  }

  start() {
    this.running = true;
    this.timer.connect(document);
    this.timer.reset();
    this.input.setEnabled(this._blocks.size === 0);
    this.renderer.domElement.focus();
    if (this.settings.get('showHelpOnStart')) this.hud.showHelp(true, 12);
    this._raf = requestAnimationFrame(this._frame);
    setTimeout(() => (window.__ready = true), 600);
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.input.setEnabled(false);
    this.interaction.clear(this.hud);
    this.pauseMenu.open();
    this.audio?.setPaused?.(true);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.pauseMenu.close();
    if (this._blocks.size === 0) this.input.setEnabled(true);
    this.timer.reset();
    this._fps.t0 = null; // the pause is not a slow frame
    this.audio?.setPaused?.(false);
    this.renderer.domElement.focus();
  }

  quit() {
    this.running = false;
    this.onQuit?.();
  }

  get inputBlocked() {
    return this._blocks.size > 0;
  }

  /**
   * Give mouse and keyboard to a UI panel (catalogue, colour picker …). Returns release(); call it when the panel
   * closes. Several blocks can be active at once (a Set of tokens); input comes back when the last one is released.
   * @param {string} [reason]  for debugging (shown in the 'input-block' event)
   * @returns {() => void}
   */
  blockInput(reason = 'ui') {
    const token = { reason };
    this._blocks.add(token);
    this.input.setEnabled(false);
    this.interaction.clear(this.hud);
    this.hud.setCrosshair(false);
    this.hud.setCursor('default');
    this.events.emit('input-block', { blocked: true, reasons: [...this._blocks].map((b) => b.reason) });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._blocks.delete(token);
      if (this._blocks.size === 0 && this.running && !this.paused) {
        this.input.setEnabled(true);
        this.renderer.domElement.focus({ preventScroll: true });
      }
      this.events.emit('input-block', { blocked: this._blocks.size > 0, reasons: [...this._blocks].map((b) => b.reason) });
    };
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _frame(timestamp) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    this.timer.update(timestamp);
    // the first rAF timestamp after timer.reset() can lie before the reset → a negative delta; never run time backwards
    const dt = Math.max(0, Math.min(this.timer.getDelta(), 0.05));
    this.time += dt;

    this.input.update(dt);
    if (this.input.consumeAction('pause')) {
      if (this.paused) this.resume();
      else if (!this.editor?.handleEscape?.()) this.pause();
    }

    if (!this.paused) {
      const editor = this.editor;
      if (this._blocks.size === 0) {
        if (this.input.consumeAction('help')) this.hud.toggleHelp();

        // the player stands still outside walk mode and while a panel field / modal owns the keyboard
        const walking = !editor || ((editor.views?.isWalking ?? true) && !editor.blocksGameInput());
        if (walking) {
          this.player.update(dt);
          this.hud.setHeading(this.player.yaw);
        }

        const captured = this.input.isCaptured;
        // sitting: E on the chair / sofa under the cursor (Selection's hover) sits down, E again stands up; while
        // seated nothing else is targeted
        const seated = walking && !!this.player.seated;
        let seat = null;
        if (seated) {
          this.interaction.clear();
          this.hud.setPrompt('Reis deg', 'E', 'eller gå med WASD');
        } else {
          seat = walking ? editor?.selection?.hoverSeat?.() ?? null : null;
          this.interaction.update(this.input, this.hud, captured, seat && { text: 'Sett deg', key: 'E', status: seat.name });
          if (this.interaction.target) seat = null;
        }
        this.hud.setCrosshair(captured);
        const clicked = this.input.consumeClick();
        let used = false;
        if (clicked && editor) used = editor.handleClick(clicked);
        const interactKey = this.input.consumeAction('interact');
        if (interactKey && seated) this.player.standUp();
        else if (interactKey && seat) this.player.sit(seat);
        else if (interactKey || (clicked && !used)) this.interaction.interact({ game: this });
      }
      editor?.update(dt);
      this._updateRoom();

      const state = {
        roomId: this.roomId,
        playerPosition: this.player.position,
        camera: this.camera,
        player: this.player,
        inputBlocked: this._blocks.size > 0,
      };
      this.home.update?.(dt, this.time, state);
      this.audio?.update?.(dt, this.camera);
    }

    this.hud.update(dt);
    this._countFps(timestamp);
    this._render();
  }

  _render() {
    const camera = this.editor?.activeCamera ?? this.camera;
    const lighting = this.home?.lighting;
    if (lighting?.render) lighting.render(this.renderer, this.scene, camera);
    else this.renderer.render(this.scene, camera);
  }

  _updateRoom() {
    this.camera.getWorldPosition(_eye);
    let room = null;
    for (const r of this.home.rooms ?? []) {
      if (r.box.containsPoint(_eye)) {
        room = r;
        break;
      }
    }
    const id = room ? room.id : null;
    if (id !== this.roomId) {
      this.roomId = id;
      this.events.emit('room', room ? { id: room.id, name: room.name } : null);
      // the banner names a room once: a gap between two zone boxes or a step out onto the terrace is no new room
      if (room && room.id !== this._announcedRoom) {
        this._announcedRoom = room.id;
        this.hud.showRoom(room.name);
      }
    }
  }

  /**
   * Frames per second over real elapsed time (rAF timestamps – not the clamped simulation dt, which hid stalls: a
   * 200 ms frame counted as 50 ms). Windows of ≥ 0.5 s; the longest frame of the window goes to dynamic resolution.
   * @param {number} [now] rAF timestamp (ms)
   */
  _countFps(now = performance.now()) {
    const f = this._fps;
    if (!Number.isFinite(now)) now = performance.now();
    if (f.t0 == null || document.hidden) {
      f.t0 = now;
      f.last = now;
      f.frames = 0;
      f.maxDt = 0;
      return;
    }
    f.frames++;
    f.maxDt = Math.max(f.maxDt || 0, now - (f.last ?? now));
    f.last = now;
    const elapsed = (now - f.t0) / 1000;
    if (elapsed >= 0.5) {
      this.fps = f.frames / elapsed;
      if (this.settings.get('showFps')) this.hud.setFps(this.fps);
      else this.hud.setFps(null);
      this._adaptResolution(this.fps, f.maxDt);
      f.t0 = now;
      f.frames = 0;
      f.maxDt = 0;
    }
  }

  /**
   * Base pixel ratio of the quality preset (before dynamic resolution). «Middels» starts at most at 1.25 (per-pixel
   * lighting with 22 pooled lights is the frame cost; a 1.5 DPR laptop would otherwise render at full physical
   * resolution) – dynamic resolution may scale it up to the preset's 1.5 when the GPU has room (_maxScale).
   */
  _basePixelRatio() {
    const q = this.settings.quality;
    const cap = q.level === 'medium' ? Math.min(1.25, q.pixelRatio) : q.pixelRatio;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  /** Highest dynamic-resolution factor: up to the preset's own pixel ratio (never above the screen's). */
  _maxScale() {
    const q = this.settings.quality;
    return Math.max(1, Math.min(window.devicePixelRatio || 1, q.pixelRatio) / this._basePixelRatio());
  }

  /**
   * Dynamic resolution (setting «Automatisk oppløsning»): the frame cost is dominated by per-pixel lighting, so on a
   * slow GPU the render scale steps down (×0.85, never below 55 %) after 2 s under 47 fps, and up (to _maxScale)
   * after 12 s over 57 fps. Called every 0.5 s from _countFps with the real fps; a window with one frame over 250 ms
   * (a shader compile, a tab switch) is ignored, as are the first seconds and paused time.
   * `resolutionScale` is the current factor (1 = the base pixel ratio).
   */
  _adaptResolution(fps, maxFrameMs = 0) {
    const d = (this._dyn ||= { scale: 1, below: 0, above: 0, since: performance.now() });
    this.resolutionScale = d.scale;
    if (!this.settings.get('autoResolution')) {
      if (d.scale !== 1) this._setResolutionScale(1);
      return;
    }
    if (this.paused || document.hidden || performance.now() - d.since < 6000) return;
    if (maxFrameMs > 250) return; // a single stall says nothing about the steady frame rate
    if (fps < 47) {
      d.below++;
      d.above = 0;
    } else if (fps > 57) {
      d.above++;
      d.below = 0;
    } else {
      d.below = 0;
      d.above = 0;
    }
    const max = this._maxScale();
    if (d.below >= 4 && d.scale > 0.56) {
      this._setResolutionScale(Math.max(0.55, d.scale * 0.85));
    } else if (d.above >= 24 && d.scale < max - 0.001) {
      this._setResolutionScale(Math.min(max, d.scale / 0.85));
    }
  }

  _setResolutionScale(scale) {
    const d = (this._dyn ||= { scale: 1, below: 0, above: 0, since: performance.now() });
    d.scale = scale;
    d.below = 0;
    d.above = 0;
    d.since = performance.now() - 4000; // let the new size settle for 2 s before judging again
    this.resolutionScale = scale;
    this.renderer.setPixelRatio(this._basePixelRatio() * scale);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.timer.disconnect();
    for (const d of this._disposers) d?.();
    this._disposers = [];
    this.input.dispose();
    this.hud.dispose();
    this.pauseMenu.dispose();
    try {
      this.editor?.dispose();
    } catch (err) {
      console.warn('[game] editor dispose failed', err);
    }
    this.editor = null;
    this.home?.dispose?.();
    this.interaction.dispose();
    this.audio?.stopAll?.();
    this.events.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
    if (window.__game === this) window.__game = null;
    window.__ready = false;
  }
}
