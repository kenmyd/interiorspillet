import * as THREE from 'three';

/**
 * Hover highlight for interactables: an amber outline around the target plus a soft pulsing glow on its surface.
 *
 * Both are extra meshes per highlighted mesh (same geometry, children of it), so the target's own materials are never
 * touched – they are shared by many objects (atlases, merged batches), and tinting them would light up everything that
 * uses them.
 *  - outline: the back faces pushed out along the normals by a constant on-screen width ("inverted hull"); the target
 *    hides it everywhere except around its silhouette. Depth-tested, so walls in front still cover it.
 *  - glow: additive fill + fresnel rim on the front faces (keeps the canvas alpha, so CssLayer holes stay holes).
 * Overlays are invisible to raycasts and never collide.
 *
 * CONTRACT (used by InteractionSystem; usable on its own, e.g. to point at something in a task):
 *   const hl = new Highlighter({ color = 0xffb52e, glow = 1 })   glow scales the surface fill (0.3 = mostly outline,
 *                              so a selected object keeps its true colour)
 *   hl.set(roots | null)       Object3D | Object3D[] – every visible mesh below is highlighted; null clears.
 *                              Skipped: meshes with userData.noHighlight, invisible / fully transparent materials,
 *                              skinned meshes and points/lines. Double-sided meshes (planes) get the glow only.
 *   hl.update()                pulse (every frame while something may be highlighted)
 *   hl.warm(renderer, camera)  compile the shaders up front (no hitch on the first hover)
 *   hl.dispose()
 */

/** Outline width as a fraction of the view distance (≈ 3–4 px at a 70° field of view). */
const OUTLINE_WIDTH = 0.006;

const VERT_GLOW = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  vec4 mv = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mv = instanceMatrix * mv;
  #endif
  mv = modelViewMatrix * mv;
  vNormalV = normalize(normalMatrix * normal);
  vViewV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FRAG_GLOW = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uStrength;
uniform float uGlow;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  #include <logdepthbuf_fragment>
  float ndv = abs(dot(normalize(vNormalV), normalize(vViewV)));
  float rim = pow(1.0 - ndv, 2.0);
  float a = (0.13 + 0.55 * rim) * uStrength * uGlow;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const VERT_OUTLINE = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uWidth;
void main() {
  vec4 mv = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mv = instanceMatrix * mv;
  #endif
  mv = modelViewMatrix * mv;
  vec3 n = normalize(normalMatrix * normal);
  // constant on-screen width: push out in proportion to the view distance (perspective) or to the visible height
  // (orthographic plan view, projectionMatrix[3][3] == 1) – so zooming the plan does not fatten the outline
  bool ortho = projectionMatrix[3][3] == 1.0;
  float w = ortho ? 1.4 * uWidth / projectionMatrix[1][1] : -mv.z * uWidth;
  mv.xyz += n * max(ortho ? 0.0005 : 0.002, w);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FRAG_OUTLINE = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uStrength;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(uColor, 0.55 + 0.45 * uStrength);
}`;

export class Highlighter {
  constructor({ color = 0xffb52e, glow = 1 } = {}) {
    this.uniforms = {
      uColor: { value: new THREE.Color(color) },
      uGlow: { value: glow },
      uStrength: { value: 1 },
      uWidth: { value: OUTLINE_WIDTH },
    };
    this._mats = new Map(); // 'glow:<side>' | 'outline' → material
    this._overlays = [];
    this._roots = null;
    this._t0 = 0;
  }

  set(roots) {
    const list = roots == null ? null : Array.isArray(roots) ? roots : [roots];
    if (sameList(list, this._roots)) return;
    this._clear();
    this._roots = list;
    if (!list) return;
    const meshes = [];
    for (const root of list) {
      root?.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh || o.userData.noHighlight || o.userData.isHighlight) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m || m.visible === false || m.colorWrite === false || (m.transparent && m.opacity < 0.05)) return;
        if (!o.geometry?.attributes?.position || !o.geometry.attributes.normal) return;
        meshes.push([o, m]);
      });
    }
    for (const [o, m] of meshes) {
      this._overlay(o, this._material(`glow:${m.side}`), 1);
      if (m.side !== THREE.DoubleSide) this._overlay(o, this._material('outline'), 2);
    }
    this._t0 = performance.now();
    this.update();
  }

  update() {
    if (!this._overlays.length) return;
    const t = (performance.now() - this._t0) / 1000;
    // quick fade in, then a slow breathing pulse
    const fade = Math.min(1, t / 0.12);
    this.uniforms.uStrength.value = fade * (0.8 + 0.2 * Math.cos(t * 4.2));
  }

  warm(renderer, camera) {
    const scene = new THREE.Scene();
    const geo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    for (const key of ['glow:0', 'glow:2', 'outline']) {
      const mesh = new THREE.Mesh(geo, this._material(key));
      mesh.position.set(0, 0, -1).applyMatrix4(camera.matrixWorld);
      scene.add(mesh);
    }
    try {
      renderer.compile(scene, camera);
    } catch (err) {
      console.warn('[highlight] warm-up failed', err);
    }
    geo.dispose();
  }

  dispose() {
    this._clear();
    for (const m of this._mats.values()) m.dispose();
    this._mats.clear();
  }

  _overlay(o, material, order) {
    const overlay = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, material, o.count) : new THREE.Mesh(o.geometry, material);
    if (o.isInstancedMesh) overlay.instanceMatrix = o.instanceMatrix;
    overlay.name = 'highlight';
    overlay.userData.isHighlight = true;
    overlay.userData.noCollide = true;
    overlay.castShadow = false;
    overlay.receiveShadow = false;
    overlay.renderOrder = (o.renderOrder ?? 0) + order;
    overlay.frustumCulled = false; // the outline reaches past the mesh's bounds
    overlay.raycast = noRaycast;
    o.add(overlay);
    overlay.updateMatrixWorld(true);
    this._overlays.push(overlay);
  }

  _clear() {
    for (const o of this._overlays) o.removeFromParent();
    this._overlays.length = 0;
    this._roots = null;
  }

  _material(key) {
    let m = this._mats.get(key);
    if (m) return m;
    if (key === 'outline') {
      m = new THREE.ShaderMaterial({
        name: 'highlight:outline',
        uniforms: this.uniforms,
        vertexShader: VERT_OUTLINE,
        fragmentShader: FRAG_OUTLINE,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
    } else {
      m = new THREE.ShaderMaterial({
        name: 'highlight:glow',
        uniforms: this.uniforms,
        vertexShader: VERT_GLOW,
        fragmentShader: FRAG_GLOW,
        side: Number(key.split(':')[1]),
        transparent: true,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
        // add light to the colour, leave the canvas alpha alone (CssLayer holes stay transparent)
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
        toneMapped: false,
        fog: false,
      });
    }
    this._mats.set(key, m);
    return m;
  }
}

function noRaycast() {}

function sameList(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
