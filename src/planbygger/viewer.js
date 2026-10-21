/**
 * Planbygger: the 3D house of a generated house file – built by the game's own builders (home/layout.js buildLayout,
 * home/rooms.js buildRooms, home/stairs.js buildStairs: walls with their faces and backOf, floors, ceilings, doors that
 * open, windows), walked with the game's player (PlayerController, Input, CollisionWorld, InteractionSystem).
 *
 *   const v = createViewer(container, { onInfo })
 *   await v.load(house)           house = exportHouse(doc).house
 *   v.setMode('walk' | 'orbit')   walk: first person (WASD, the mouse as in the game); orbit: dollhouse without ceilings
 *   v.showLevel(levelId | null)   orbit: only that level (and the ones under it)
 *   v.dispose()
 *
 * The game's living room (shell.js, kitchen.js, lighting.js, the design) is not used: a customer's house has none. The
 * light is simple (sky, sun from the south of the plan, one lamp per room), shadows only from the sun.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLayout } from '../home/layout.js';
import { buildRooms } from '../home/rooms.js';
import { buildStairs } from '../home/stairs.js';
import { configureMaterials, prepareMaterials } from '../home/materials.js';
import { CollisionWorld } from '../core/Collision.js';
import { InteractionSystem } from '../core/Interaction.js';
import { Input } from '../core/Input.js';
import { Settings, QUALITY } from '../core/Settings.js';
import { Emitter } from '../core/Events.js';
import { PlayerController } from '../player/PlayerController.js';
import { setMaxAnisotropy } from '../world/proctex.js';
import { baseSpec, mergeOnto } from './export.js';

const KINDS = ['white-oak', 'oak', 'painted', 'black-metal', 'glass-clear', 'steel', 'plastic'];

/** Scene roots like home/index.js createHouseRoots: one group per level, one per room (surfaces + contents). */
function houseRoots(layout) {
  const levels = {};
  for (const lv of layout.house.levels) {
    const g = new THREE.Group();
    g.name = `level:${lv.id}`;
    levels[lv.id] = g;
  }
  const rooms = {};
  for (const r of layout.house.rooms) {
    const lg = levels[r.levelId] ?? Object.values(levels)[0];
    const group = new THREE.Group();
    group.name = `room:${r.id}`;
    const surfaces = new THREE.Group();
    surfaces.name = `room:${r.id}:surfaces`;
    const contents = new THREE.Group();
    contents.name = `room:${r.id}:contents`;
    group.add(surfaces, contents);
    lg.add(group);
    rooms[r.id] = { id: r.id, name: r.name, levelId: r.levelId, kind: r.kind, hud: !!r.hud, group, surfaces, contents };
  }
  return { levels, rooms };
}

/** A minimal HUD for the interaction prompt («E Åpne døra»). */
function promptHud(container) {
  const el = document.createElement('div');
  el.className = 'pb-prompt';
  el.hidden = true;
  container.appendChild(el);
  return {
    el,
    setPrompt(text, key = 'E', status = null) {
      if (!text) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.innerHTML = '';
      const k = document.createElement('kbd');
      k.textContent = key ?? 'E';
      const t = document.createElement('span');
      t.textContent = text;
      el.append(k, t);
      if (status) {
        const s = document.createElement('small');
        s.textContent = status;
        el.append(s);
      }
    },
    setCursor(kind) {
      container.style.cursor = kind === 'pointer' ? 'pointer' : '';
    },
  };
}

export function createViewer(container, { onInfo = () => {} } = {}) {
  const settings = new Settings();
  const quality = QUALITY[settings.get?.('quality') ?? 'medium'] ?? QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'pb-canvas3d';
  container.appendChild(renderer.domElement);
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
  const hud = promptHud(container);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfdbe6');
  const camera = new THREE.PerspectiveCamera(settings.get?.('fov') ?? 72, 1, 0.05, 400);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const events = new Emitter();
  let input = null;
  let state = null; // the built house
  let mode = 'orbit';
  let orbit = null;
  let raf = 0;
  let last = 0;
  let disposed = false;

  const resize = () => {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function clear() {
    if (!state) return;
    for (const p of state.parts) p.dispose?.();
    for (const o of state.extra) {
      o.removeFromParent();
      o.traverse?.((m) => {
        if (m.isMesh) {
          m.geometry?.dispose?.();
          if (!m.material?.userData?.cached) m.material?.dispose?.();
        }
      });
    }
    for (const g of Object.values(state.roots.levels)) g.removeFromParent();
    state.interaction?.dispose?.();
    hud.setPrompt(null);
    state = null;
  }

  async function load(house) {
    clear();
    onInfo('Bygger huset …');
    configureMaterials({ quality });
    await prepareMaterials(KINDS);
    const spec = mergeOnto(baseSpec(), house);
    const layout = buildLayout(spec, undefined, { devWarnings: false });
    const collision = new CollisionWorld();
    const interaction = new InteractionSystem({ camera, collision, events });
    const roots = houseRoots(layout);
    const ctx = { scene, camera, renderer, collision, interaction, events, settings, quality, roots, audio: null, lighting: null };
    const parts = [buildRooms(ctx, layout, null)];
    if (layout.house.stairs.length) parts.push(buildStairs(ctx, layout));
    scene.add(...Object.values(roots.levels));
    for (const p of parts) if (p.group && !p.group.parent) scene.add(p.group);
    for (const p of parts) {
      for (const c of p.colliders || []) {
        if (c?.isBox3) collision.addStaticBox(c);
        else if (c) collision.addStatic(c);
      }
    }
    const extra = [];
    // ---- ground, sky light, sun, one lamp per room
    const b = layout.house.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6);
    const mainY = layout.house.levelsById.hoved?.floorY ?? 0;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * 8, size * 8), new THREE.MeshStandardMaterial({ color: '#7f8f66', roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, mainY - 0.31, cz);
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);
    extra.push(ground);
    // the walkable ground outside (a thin box just under the main floor's slab top)
    collision.addStaticBox(new THREE.Box3(new THREE.Vector3(cx - size * 2, mainY - 0.6, cz - size * 2), new THREE.Vector3(cx + size * 2, mainY - 0.31, cz + size * 2)));
    const hemi = new THREE.HemisphereLight('#e8f0ff', '#8a7f6a', 1.1);
    scene.add(hemi);
    extra.push(hemi);
    const sun = new THREE.DirectionalLight('#fff3df', 2.4);
    // the sun from the south (+x) and a bit west, high in the sky
    sun.position.set(cx + size * 1.2, mainY + size * 1.4, cz + size * 0.5);
    sun.target.position.set(cx, mainY, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -size;
    sc.right = size;
    sc.top = size;
    sc.bottom = -size;
    sc.near = 0.5;
    sc.far = size * 5;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    extra.push(sun, sun.target);
    for (const l of layout.house.builtInLights) {
      if (!l.position) continue;
      const room = layout.house.roomsById[l.roomId];
      const pl = new THREE.PointLight('#ffe2bf', 1, 0, 2);
      pl.intensity = Math.max(4, Math.min(18, (room?.area ?? 10) * 1.1));
      pl.position.copy(l.position).add(new THREE.Vector3(0, -0.25, 0));
      (roots.rooms[l.roomId]?.contents ?? scene).add(pl);
      extra.push(pl);
    }
    collision.build();
    if (collision.setBounds) collision.setBounds(b.minX - size, b.maxX + size, b.minZ - size, b.maxZ + size);
    if (collision.setFloorField && layout.house.floorYAt) {
      collision.setFloorField((x, z, y) => layout.house.floorYAt(x, z, y));
    }
    // ---- the player
    if (!input) input = new Input(renderer.domElement, settings);
    const player = new PlayerController({ camera, collision, input, settings, events });
    const start = spawnPoint(layout);
    player.teleport(start.position, start.yaw, 0);
    state = { layout, collision, interaction, roots, parts, extra, player, start, bounds: b, center: new THREE.Vector3(cx, mainY, cz), size };
    setMode(mode);
    const realRooms = layout.house.rooms.filter((r) => !r.hud && r.area > 0.01 && r.id !== 'stue-kjokken');
    onInfo(`${realRooms.length} rom, ${layout.house.doors.length} dører, ${layout.house.windows.length} vinduer`);
    if (!raf) loop();
    return state;
  }

  /** Inside the largest room of the main level, at its freest point, looking at the room's centre. */
  function spawnPoint(layout) {
    const H = layout.house;
    const main = H.levelsById.hoved ?? H.levels[0];
    const rooms = H.rooms.filter((r) => !r.hud && r.polygon.length >= 3 && r.levelId === main.id).sort((a, b) => b.area - a.area);
    const r = rooms[0];
    const light = H.builtInLights.find((l) => l.roomId === r?.id && l.position);
    const p = light ? new THREE.Vector3(light.position.x, r.floorY, light.position.z) : r ? new THREE.Vector3(r.centroid.x, r.floorY, r.centroid.y) : new THREE.Vector3();
    // look across the room (toward its far corner from the spawn point)
    let far = null;
    let fd = -1;
    for (const q of r?.polygon ?? []) {
      const d = Math.hypot(q.x - p.x, q.y - p.z);
      if (d > fd) {
        fd = d;
        far = q;
      }
    }
    const yaw = far ? Math.atan2(-(far.x - p.x), -(far.y - p.z)) : 0;
    return { position: p, yaw };
  }

  function setMode(m) {
    mode = m;
    if (!state) return;
    const walk = m === 'walk';
    for (const mesh of state.parts.flatMap((p) => p.pickables?.ceilings || [])) mesh.visible = walk;
    if (walk) {
      orbit?.dispose();
      orbit = null;
      showLevel(null);
      input?.setEnabled?.(true);
      const p = state.player;
      camera.position.copy(p.position);
    } else {
      input?.setEnabled?.(false);
      hud.setPrompt(null);
      if (!orbit) {
        orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enableDamping = true;
        orbit.maxPolarAngle = Math.PI * 0.49;
      }
      const c = state.center;
      orbit.target.set(c.x, c.y + 0.5, c.z);
      camera.position.set(c.x + state.size * 0.9, c.y + state.size * 1.1, c.z + state.size * 0.6);
      camera.lookAt(orbit.target);
      orbit.update();
    }
  }

  /** Orbit view: show only this level and those under it (null = all). */
  function showLevel(levelId) {
    if (!state) return;
    const lv = levelId ? state.layout.house.levelsById[levelId] : null;
    for (const l of state.layout.house.levels) state.roots.levels[l.id].visible = !lv || l.floorY <= lv.floorY;
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    if (!state) {
      renderer.render(scene, camera);
      return;
    }
    if (mode === 'walk') {
      input.update(dt);
      state.player.update(dt);
      const captured = input.isCaptured || input.isMouseLook;
      state.interaction.update(input, hud, captured);
      const click = input.consumeClick?.();
      if (input.consumeAction?.('interact') || click) state.interaction.interact({});
      input.consumeAction?.('pause');
      input.consumeAction?.('help');
    } else orbit?.update();
    const pstate = { camera, playerPosition: state.player.position };
    for (const p of state.parts) {
      if (p.update) p.update(dt, pstate);
      else for (const d of p.doors || []) d.door?.update?.(dt, pstate);
    }
    renderer.render(scene, camera);
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    clear();
    orbit?.dispose();
    input?.dispose?.();
    ro.disconnect();
    renderer.dispose();
    renderer.domElement.remove();
    hud.el.remove();
  }

  return {
    load,
    setMode,
    showLevel,
    dispose,
    get mode() {
      return mode;
    },
    get state() {
      return state;
    },
    get disposed() {
      return disposed;
    },
    renderer,
    scene,
    camera,
  };
}
