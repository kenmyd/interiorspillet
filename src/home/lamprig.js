import * as THREE from 'three';

/**
 * The lamps of a house in a view without the game's LightManager (the planbygger's 3D view, dev/belysning.html): a FIXED
 * pool of three.js lights – the shaders never recompile when lamps switch on and off, and a house with 80 lamps costs
 * what one with 8 does – handed out 4 × a second (or when the camera moves 0.5 m) to the lamps that matter most where
 * the camera is; every lamp's glow follows its group's on/off and dimmer. No light casts a shadow unless `shadows`
 * asks for it (the best spots, 512² maps). notes/belysning-genererte-hus.md.
 *
 *   const rig = new LampRig({ scene, layout, lights: rooms.builtInLights, pools: { point: 4, spot: 4 }, shadows: 0 });
 *   rig.update(camera)                    every frame
 *   rig.setMode('evening' | 'day')        evening: every group on but the 'off' ones; day: only the 'on' ones
 *   rig.setGroup(id, { on, dimmer })      rig.groups → [{ id, label, roomId, on, dimmer, lamps }]
 *   rig.setExposure(k)                    scales every lamp (1 = the default level for a dim evening scene)
 *   rig.stats → { lamps, candidates, pool, lit, shadowed }
 *   rig.dispose()
 *
 * `lights` are the builders' entries (rooms.js / lampfittings.js: position, direction, lightType, fitting, lumens,
 * colorK, group, roomId, levelId, emissiveMeshes). The spots of one room and group become at most two candidates (their
 * flux summed, the cone widened over them – as lighting.js does it).
 */

const DEG = Math.PI / 180;
/** Scene units per candela (the views are lit for the eye with a sun of ~2.5: a 400 lm downlight 2 m up ≈ 1.6 on the floor). */
const SCALE = 0.03;
const REASSIGN_S = 0.25;
const MOVE_M = 0.5;

/** Colour of a blackbody at K (approximation, linear sRGB). */
export function kelvinColor(K) {
  const t = K / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

export class LampRig {
  constructor({ scene, layout, lights = [], pools = { point: 4, spot: 4 }, shadows = 0, exposure = 1 }) {
    this.scene = scene;
    this.layout = layout;
    this.exposure = exposure;
    this.group = new THREE.Group();
    this.group.name = 'lamp-rig';
    scene.add(this.group);
    const groups = layout?.house?.lightGroups ?? [];
    this._groups = new Map(groups.map((g) => [g.id, { id: g.id, label: g.label ?? g.id, roomId: g.roomId ?? null, auto: g.auto ?? 'dark', on: true, dimmer: Number.isFinite(g.dimmer) ? g.dimmer : 1, lamps: 0 }]));
    this._candidates = candidatesOf(lights, (roomId) => layout?.house?.roomsById?.[roomId]?.floorY ?? null);
    for (const c of this._candidates) {
      if (!this._groups.has(c.group)) this._groups.set(c.group, { id: c.group, label: c.group, roomId: c.roomId, auto: 'dark', on: true, dimmer: 1, lamps: 0 });
      this._groups.get(c.group).lamps += c.members;
    }
    // the glowing materials of each group (shared by its lamps)
    this._glow = new Map();
    for (const l of lights) {
      for (const m of l.emissiveMeshes || []) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of mats) if (mt && 'emissiveIntensity' in mt) this._glow.set(mt, l.group);
      }
    }
    // the pool
    this._slots = [];
    for (let i = 0; i < (pools.point ?? 4); i++) this._slots.push(this._slot('point'));
    for (let i = 0; i < (pools.spot ?? 4); i++) this._slots.push(this._slot('spot', i < shadows));
    this._at = -Infinity;
    this._from = new THREE.Vector3(Infinity, 0, 0);
    this._clock = 0;
    this.setMode('evening');
  }

  _slot(kind, shadow = false) {
    const light = kind === 'spot' ? new THREE.SpotLight(0xffffff, 0, 9, 1, 0.8, 2) : new THREE.PointLight(0xffffff, 0, 7, 2);
    light.castShadow = !!shadow;
    if (shadow) {
      light.shadow.mapSize.set(512, 512);
      light.shadow.camera.near = 0.05;
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 0.02;
    }
    this.group.add(light);
    if (light.target) this.group.add(light.target);
    return { kind, light, cand: null };
  }

  get groups() {
    return [...this._groups.values()].map((g) => ({ ...g }));
  }

  setMode(mode) {
    this.mode = mode;
    for (const g of this._groups.values()) g.on = mode === 'day' ? g.auto === 'on' : g.auto !== 'off';
    this._dirty();
  }

  setGroup(id, { on, dimmer } = {}) {
    const g = this._groups.get(id);
    if (!g) return;
    if (on != null) g.on = !!on;
    if (dimmer != null) g.dimmer = Math.max(0, Math.min(1, dimmer));
    this._dirty();
  }

  setAll(on) {
    for (const g of this._groups.values()) g.on = !!on;
    this._dirty();
  }

  setExposure(k) {
    this.exposure = k;
    this._dirty();
  }

  _dirty() {
    this._at = -Infinity;
    this._applyGlow();
  }

  _level(c) {
    const g = this._groups.get(c.group);
    return g && g.on ? g.dimmer : 0;
  }

  _applyGlow() {
    for (const [m, gid] of this._glow) {
      const g = this._groups.get(gid);
      const base = m.userData?.baseIntensity ?? 1.5;
      m.emissiveIntensity = g && g.on ? base * (0.25 + 0.75 * g.dimmer) * Math.min(2, this.exposure) : 0;
    }
  }

  /** Hand the pool to the lamps that matter most at the camera. */
  update(camera, dt = 1 / 60) {
    this._clock += dt;
    const p = camera.position;
    if (this._clock - this._at < REASSIGN_S && p.distanceTo(this._from) < MOVE_M) return;
    this._at = this._clock;
    this._from.copy(p);
    const H = this.layout?.house;
    const here = H?.roomAt?.(p.x, p.y, p.z) ?? null;
    const levelId = here?.levelId ?? H?.levelAt?.(p.y)?.id ?? null;
    const score = (c) => {
      const lv = this._level(c);
      if (lv <= 0) return 0;
      const d2 = c.position.distanceToSquared(p);
      const near = here ? (c.roomId === here.id ? 3 : c.levelId === levelId ? 1 : 0.1) : 1;
      return (c.lumens * lv * near) / (1 + d2);
    };
    const ranked = this._candidates.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    for (const s of this._slots) s.cand = null;
    const free = { point: this._slots.filter((s) => s.kind === 'point'), spot: this._slots.filter((s) => s.kind === 'spot') };
    // the shadowed spot slots first to the best spots
    free.spot.sort((a, b) => b.light.castShadow - a.light.castShadow);
    for (const { c } of ranked) {
      const slot = free[c.kind].shift();
      if (!slot) continue;
      slot.cand = c;
    }
    for (const s of this._slots) {
      const L = s.light;
      const c = s.cand;
      if (!c) {
        L.intensity = 0; // stays visible: the light count (the shaders) never changes
        continue;
      }
      L.color.copy(c.color);
      L.position.copy(c.position);
      L.intensity = c.lumens * this._level(c) * c.cdPerLm * SCALE * this.exposure;
      if (s.kind === 'spot') {
        L.angle = c.angle;
        L.penumbra = c.penumbra;
        L.target.position.copy(c.position).add(c.direction);
        L.target.updateMatrixWorld();
      }
    }
  }

  get stats() {
    const lit = this._slots.filter((s) => s.cand).length;
    return {
      lamps: this._candidates.reduce((n, c) => n + c.members, 0),
      candidates: this._candidates.length,
      pool: this._slots.length,
      lit,
      shadowed: this._slots.filter((s) => s.light.castShadow).length,
    };
  }

  dispose() {
    for (const s of this._slots) s.light.dispose?.();
    this.group.removeFromParent();
  }
}

/** The lamps as pool candidates: spots of one room and group as ≤ 2 clusters, strips as a point at their middle
 *  (floorOf(roomId) → the room's floor, world y: how wide a cluster's cone must be to reach its floor). */
export function candidatesOf(lights, floorOf = () => null) {
  const out = [];
  const clusters = new Map();
  const base = (l) => ({ group: l.group, roomId: l.roomId, levelId: l.levelId, lumens: Math.max(0, l.lumens || 0), color: kelvinColor(l.colorK || 2700), members: 1, ids: [l.id] });
  for (const l of lights) {
    if (l.emits === false) continue;
    if (l.type === 'led-strip' && l.from && l.to) {
      out.push({ ...base(l), kind: 'point', position: l.from.clone().add(l.to).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.05, 0)), cdPerLm: 1 / (4 * Math.PI) });
      continue;
    }
    if (!l.position) continue;
    if (l.fitting === 'downlight' || (l.type === 'spot' && l.fitting == null)) {
      const k = `${l.roomId}|${l.group}`;
      if (!clusters.has(k)) clusters.set(k, []);
      clusters.get(k).push(l);
      continue;
    }
    if (l.lightType === 'spot') {
      const angle = l.angle ?? 50 * DEG;
      out.push({ ...base(l), kind: 'spot', position: l.position.clone(), direction: (l.direction ?? new THREE.Vector3(0, -1, 0)).clone().normalize(), angle, penumbra: l.penumbra ?? 0.8, cdPerLm: 1 / coneSolidAngle(angle) });
    } else if (l.fitting === 'plafond' || l.type === 'ceiling') {
      // a ceiling lamp: a Lambertian disc (peak lm / π) as a wide spot down
      out.push({ ...base(l), kind: 'spot', position: l.position.clone(), direction: new THREE.Vector3(0, -1, 0), angle: 85 * DEG, penumbra: 1, cdPerLm: 1 / Math.PI });
    } else {
      out.push({ ...base(l), kind: 'point', position: l.position.clone(), cdPerLm: 1 / (4 * Math.PI) });
    }
  }
  for (const list of clusters.values()) {
    const xs = list.map((l) => l.position.x), zs = list.map((l) => l.position.z);
    const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
    list.sort((a, b) => (alongX ? a.position.x - b.position.x : a.position.z - b.position.z));
    const parts = Math.min(2, list.length);
    for (let k = 0; k < parts; k++) {
      const part = list.slice(Math.floor((k * list.length) / parts), Math.floor(((k + 1) * list.length) / parts));
      const c = new THREE.Vector3();
      let lm = 0;
      for (const l of part) {
        c.add(l.position);
        lm += Math.max(0, l.lumens || 0);
      }
      c.multiplyScalar(1 / part.length);
      let r = 0;
      for (const l of part) r = Math.max(r, Math.hypot(l.position.x - c.x, l.position.z - c.z));
      const floorY = floorOf(part[0].roomId) ?? part[0].position.y - 2.4;
      const h = Math.max(0.5, c.y - floorY);
      const angle = Math.min(80 * DEG, Math.max(45 * DEG, Math.atan((r + h * Math.tan(45 * DEG)) / h)));
      out.push({ ...base(part[0]), lumens: lm, members: part.length, ids: part.map((l) => l.id), kind: 'spot', position: c, direction: new THREE.Vector3(0, -1, 0), angle, penumbra: 0.7, cdPerLm: 1 / coneSolidAngle(angle) });
    }
  }
  return out;
}

/** Solid angle of a cone of half-angle a (sr). */
function coneSolidAngle(a) {
  return 2 * Math.PI * (1 - Math.cos(a));
}
