// LIGHT MASKS – keeps every light in its own room (notes/hele-huset-design.md §4.1, §4.3; steg 13 L1). Owned by «lighting».
//
// three.js lights go through walls and slabs: a RectAreaLight has no shadow and no range, the pooled spots and points
// have distance 0, so the kitchen rings would light the basement through the slab and the south windows the bedroom
// through `w-hoy`. A `distance` cut-off does not help (it does not protect a room 1–3 m away and dims the living room).
// Instead one shader patch, applied to every lit built-in material (standard, physical, lambert, phong, toon):
//
//   • ROOM TABLE   up to MAX_BOXES world boxes, each with a room index (rooms → bits). A fragment's rooms = the bits of
//                  every box it lies in (world position = geometryPosition · mat3(viewMatrix) + cameraPosition, no new
//                  varying). A fragment in no box is OUTSIDE (its own bit): the terrace, the facade, the exterior.
//   • PER SLOT     (pooled point / spot / rect light of the LightManager, in three's uniform order) a mask of the rooms
//                  it lights fully (its own room; the living room's lights also OUTSIDE, so the terrace stays as it
//                  is) and its home room. A fragment outside the mask is lit only through a PORTAL that connects the
//                  light's home room with the fragment's room (an open door, the open entrance, the stairwell): the
//                  segment fragment → light must pass through the portal rectangle (4 cm soft rim) – direct light
//                  through a doorway lands where the doorway lets it, never through the wall next to it.
//   • PER ROOM     the environment map is the camera room's. A fragment in another room gets that room's FLAT
//                  irradiance instead (its mean exitance × exposure × white balance, in place of ambient + the map:
//                  the map's colour at a given normal is the camera room's own, e.g. the living room's Marrakesh wall),
//                  and the map's reflections scaled to the room's brightness (§4.3).
//   • ONE PASS     every slot's factor is computed once per fragment before the light loops (lmLocate): a loop over
//                  the slots for their masks, then ONE flat loop over the (slot, portal of its room) pairs the CPU
//                  lists (flush), into two bit planes (factor 0, ⅓, ⅔ or 1); the unrolled light sites read two bits. A
//                  portal loop per light site made each program compile 3–4× slower; a loop nested in a loop, a byte
//                  store with a run-time index or a float array each still cost ~0.1–0.15 s of FXC time per program.
//   • SUN          the directional light lights only the rooms of the level whose shadow box it has (+ OUTSIDE): a room
//                  of the other level seen through the stairwell lies outside the sun's shadow camera and would get
//                  unshadowed sun.
//
// Inside the mask the factor is exactly 1.0 and the camera's room keeps its own environment: the living room renders
// bit-identically (with every door of the camera's room shut, LightManager turns the masks off for the frame). The
// patch is active only while LightManager.render() draws the home (setEnabled): other renders (catalogue previews,
// wall thumbnails) see the plain three.js lighting. All uniforms share one set of
// typed arrays (UniformsUtils.clone passes typed arrays by reference), so updating them reaches every material.
//
//   installLightMask()                 patches THREE.ShaderChunk / ShaderLib once (before the first compile)
//   lightMask.setEnabled(on)
//   lightMask.setRooms({ boxes, outside })          boxes: [{ min:[x,y,z], max:[x,y,z], room }] (room = index)
//   lightMask.setSlot(kind, index, mask, home, pos) kind 'point'|'spot'|'rect' (index = three's light order, pos world)
//   lightMask.setPortals(list)          [{ center:[x,y,z], u:[…], halfU, v:[…], halfV, bits, gain }] (v up, or +z for a hole)
//   lightMask.flush(priorityBits)       rebuilds the (slot, portal) pairs after setSlot / setPortals (before a render)
//   lightMask.setRoomAsIs(room, camera) / setRoomFlat(room, r, g, b, reflect)
//   lightMask.setSun(bits)              rooms the sun may light (0 = all)
//   lightMask.fits(renderer) / uninstall()   the uniform budget (VECTORS) against the GPU's fragment uniform limit; a
//                                       GPU that cannot take it (many mobiles: 256) gets the plain lighting back
// Pure (Node-testable): rectilinearBoxes(polygon), buildRoomTable(layout), portalRects(layout).
import * as THREE from 'three';

/** Sized to the house (39 boxes, 12 rooms + outside, 13 portals today) with a little room to spare. */
export const MAX_BOXES = 44;
export const MAX_ROOMS = 16;
export const MAX_PORTALS = 16;
/** Pool sizes of the largest profile («høy»: 4 points, 14 spots, 8 rects; &pools= past that is unmasked). One vec4 per slot. */
export const MAX_SLOTS = { point: 4, spot: 16, rect: 8 };
/** All slots in one array: the points, then the spots, then the rects (lmSlot; ≤ 32: one bit each in lmLo / lmHi). */
export const SLOTS = MAX_SLOTS.point + MAX_SLOTS.spot + MAX_SLOTS.rect;
const SLOT_OFFSET = { point: 0, spot: MAX_SLOTS.point, rect: MAX_SLOTS.point + MAX_SLOTS.spot };
/**
 * (slot, portal of the slot's room) pairs the shader tests (four per vec4): the house's worst case, the camera in the
 * hall with every door open, is ≈ 50 (the hall's lamps × its 5 portals, the living room's × door-gang, …).
 */
export const MAX_PAIRS = 64;
/** Fragment uniform vectors the patch adds to every lit material (info + sun, boxes, room values, portals, slots, pairs). */
export const VECTORS = 2 + 2 * MAX_BOXES + MAX_ROOMS + 3 * MAX_PORTALS + SLOTS + MAX_PAIRS / 4;
/**
 * What three's standard material needs besides the patch with the largest pools (lights, shadows, material, maps):
 * ≈ 160 vectors, with margin. The masks are used only when VECTORS + this fit the GPU's MAX_FRAGMENT_UNIFORM_VECTORS.
 */
export const BASE_FRAGMENT_VECTORS = 224;
/** Boxes reach this far past the room's inner wall faces (the thinnest wall, gang/kjellerstue, is 0.09: the two sides never meet). */
export const BOX_MARGIN = 0.04;
/** Id of the pseudo-room outside every box. */
export const OUTSIDE_ID = 'ute';

const MAIN_LEVEL = 'hoved';
const LIVING = 'stue-kjokken';

// ---------------------------------------------------------------------------------------------------------------
// Shader patch

const PARS = /* glsl */ `
#define LM_BOXES ${MAX_BOXES}
#define LM_ROOMS ${MAX_ROOMS}
#define LM_PORTALS ${MAX_PORTALS}
#define LM_MAX_POINT ${MAX_SLOTS.point}
#define LM_MAX_SPOT ${MAX_SLOTS.spot}
#define LM_MAX_RECT ${MAX_SLOTS.rect}
#define LM_SLOTS ${SLOTS}
#define LM_PAIRS ${MAX_PAIRS}
uniform vec4 lmInfo; // x enabled, y boxes, z portals, w outside room
uniform vec4 lmSun; // x room bits the sun lights (0 = all), y slots in use, z pairs in use, w the camera's room + 1 (0: none)
uniform vec4 lmBoxMin[ LM_BOXES ]; // xyz, w = room bits
uniform vec4 lmBoxMax[ LM_BOXES ]; // xyz, w = its rooms for the indirect light: ( a + 1 ) + 32 * ( b + 1 ), 0 = none
uniform vec4 lmRoomF[ LM_ROOMS ]; // w 1: the camera's room (as is); w >= 2: another room, rgb its flat irradiance, w - 2 the reflection scale
uniform vec4 lmPortal[ LM_PORTALS * 3 ]; // centre + bits, u + halfU, (halfV, gain, hole, 0)
uniform vec4 lmSlot[ LM_SLOTS ]; // points, spots, rects: xyz light position (world), w = mask bits + 65536 * (home room + 1)
uniform vec4 lmPair[ LM_PAIRS / 4 ]; // (slot, portal of its room) pairs: slot + 32 * portal, four per vec4
vec3 lmWorld;
highp int lmBits;
vec4 lmInd; // the indirect light (lmIndirect), gathered in the box loop
// The slot factors in two bit planes, factor = ( 2 hi + lo ) / 3: a light site reads its two bits (constant shifts).
// Not a float array or bytes: a run-time indexed write costs ~0.15 s of FXC time per program, and so does a loop
// nested in a loop - hence the flat pair loop below.
highp uint lmLo;
highp uint lmHi;

// Once per fragment, before the light loops: its rooms, the slots whose mask covers them, then the other slots only
// through a portal of their own room into the fragment's room (the segment fragment -> light through the portal
// rectangle, 4 cm soft rim, x the door's opening).
void lmLocate( const in vec3 viewPos ) {
	lmLo = 0xFFFFFFFFu;
	lmHi = 0xFFFFFFFFu;
	lmBits = 0;
	lmInd = vec4( - 1.0 );
	if ( lmInfo.x < 0.5 ) return;
	lmWorld = viewPos * mat3( viewMatrix ) + cameraPosition;
	int nb = min( int( lmInfo.y + 0.5 ), LM_BOXES );
	// the rooms of every box the fragment lies in; its indirect light from the last box's rooms (at most two: a door's
	// hole), unless a box is the camera's room (its own environment, as is; no box: outside, as is). The loop body
	// stays small: code in it costs compile time
	// (lmBoxMax.w = ( a + 1 ) + 32 * ( b + 1 ), lmSun.w = the camera's room + 1)
	int cr = int( lmSun.w + 0.5 );
	int rr = 0;
	bool cam = false;
	for ( int k = 0; k < nb; k ++ ) {
		vec4 a = lmBoxMin[ k ];
		vec4 b = lmBoxMax[ k ];
		if ( all( greaterThanEqual( lmWorld, a.xyz ) ) && all( lessThanEqual( lmWorld, b.xyz ) ) ) {
			lmBits |= int( a.w + 0.5 );
			rr = int( b.w + 0.5 );
			cam = cam || ( cr > 0 && ( ( rr & 31 ) == cr || ( rr >> 5 ) == cr ) );
		}
	}
	if ( ! cam && rr > 0 ) {
		vec4 f0 = lmRoomF[ max( ( rr & 31 ) - 1, 0 ) ];
		vec4 f1 = lmRoomF[ max( ( rr >> 5 ) - 1, 0 ) ];
		float w0 = ( rr & 31 ) > 0 && f0.w > 1.5 ? 1.0 : 0.0;
		float w1 = ( rr >> 5 ) > 0 && f1.w > 1.5 ? 1.0 : 0.0;
		if ( w0 + w1 > 0.5 ) lmInd = ( w0 * vec4( f0.rgb, f0.w - 2.0 ) + w1 * vec4( f1.rgb, f1.w - 2.0 ) ) / ( w0 + w1 );
	}
	if ( lmBits == 0 ) lmBits = 1 << int( lmInfo.w + 0.5 );
	int ns = min( int( lmSun.y + 0.5 ), LM_SLOTS );
	highp uint lit = 0u;
	for ( int i = 0; i < ns; i ++ ) {
		if ( ( ( int( lmSlot[ i ].w + 0.5 ) & 65535 ) & lmBits ) != 0 ) lit |= 1u << uint( i );
	}
	// slots past ns are unmasked
	lit |= ~( ( 1u << uint( ns ) ) - 1u );
	lmLo = lit;
	lmHi = lit;
	int nq = min( int( lmSun.z + 0.5 ), LM_PAIRS );
	for ( int k = 0; k < nq; k ++ ) {
		vec4 e4 = lmPair[ k >> 2 ];
		int c4 = k & 3;
		int e = int( ( c4 == 0 ? e4.x : c4 == 1 ? e4.y : c4 == 2 ? e4.z : e4.w ) + 0.5 );
		highp uint b = 1u << uint( e & 31 );
		int p = ( e >> 5 ) * 3;
		vec4 c = lmPortal[ p ];
		if ( ( lit & b ) != 0u || ( int( c.w + 0.5 ) & lmBits ) == 0 ) continue;
		vec3 L = lmSlot[ e & 31 ].xyz;
		vec4 u = lmPortal[ p + 1 ];
		vec4 h = lmPortal[ p + 2 ];
		vec3 v = h.z > 0.5 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 0.0, 1.0, 0.0 );
		vec3 n = cross( u.xyz, v );
		float sF = dot( lmWorld - c.xyz, n );
		float sL = dot( L - c.xyz, n );
		float den = sF - sL;
		if ( sF * sL > 0.0 || abs( den ) < 1e-5 ) continue;
		vec3 d = lmWorld + ( L - lmWorld ) * ( sF / den ) - c.xyz;
		float eu = abs( dot( d, u.xyz ) ) - u.w;
		float ev = abs( dot( d, v ) ) - h.x;
		// 1 - smoothstep( -0.04, 0.04, e ) written out: FXC folds the intrinsic with constant edges and warns (X4122)
		vec2 st = clamp( 0.5 - vec2( eu, ev ) * 12.5, 0.0, 1.0 );
		st = st * st * ( 3.0 - 2.0 * st );
		float pass = st.x * st.y;
		highp uint q = uint( clamp( pass * h.y, 0.0, 1.0 ) * 3.0 + 0.5 );
		highp uint cur = ( ( lmHi & b ) != 0u ? 2u : 0u ) + ( ( lmLo & b ) != 0u ? 1u : 0u );
		if ( q > cur ) {
			lmLo = ( q & 1u ) != 0u ? lmLo | b : lmLo & ~ b;
			lmHi = ( q & 2u ) != 0u ? lmHi | b : lmHi & ~ b;
		}
	}
}

float lmSunLit() {
	if ( lmInfo.x < 0.5 || lmSun.x < 0.5 ) return 1.0;
	return ( lmBits & int( lmSun.x + 0.5 ) ) != 0 ? 1.0 : 0.0;
}

// Indirect light of a fragment in another room than the camera's: that room's flat irradiance (rgb) and the scale of
// the camera room's reflections (w). w < 0: as is (the camera's room, outside, masks off).
vec4 lmIndirect() {
	return lmInd;
}
`;

let installed = false;
const U = {
  // typed arrays only: UniformsUtils.clone copies three objects (a Vector4 would be one per material) but shares these
  lmInfo: { value: new Float32Array([0, 0, 0, MAX_ROOMS - 1]) },
  lmSun: { value: new Float32Array(4) },
  lmBoxMin: { value: new Float32Array(MAX_BOXES * 4) },
  lmBoxMax: { value: new Float32Array(MAX_BOXES * 4) },
  lmRoomF: { value: new Float32Array(MAX_ROOMS * 4) },
  lmPortal: { value: new Float32Array(MAX_PORTALS * 12) },
  lmSlot: { value: new Float32Array(SLOTS * 4) },
  lmPair: { value: new Float32Array(MAX_PAIRS) },
};
/** CPU side of the pairs: each slot's home bit, each written portal's room bits (lmPortal order), rebuilt on flush(). */
const PAIRS = { home: new Array(SLOTS).fill(0), portalBits: [], dirty: true, warned: false };
/** The chunks as three shipped them (uninstall) and the lit ShaderLib entries the uniforms went into. */
const ORIGINAL = {};
const LIBS = ['standard', 'physical', 'lambert', 'phong', 'toon'];

/** Replaces `from` in a chunk once; warns (and leaves the chunk) when three changed it. */
function patchChunk(name, from, to) {
  const src = THREE.ShaderChunk[name];
  if (typeof src !== 'string' || !src.includes(from)) {
    console.warn(`[lightmask] three.js chunk ${name} changed – light masks off for it`);
    return false;
  }
  if (!(name in ORIGINAL)) ORIGINAL[name] = src;
  THREE.ShaderChunk[name] = src.replace(from, to);
  return true;
}

/**
 * Patches the light chunks and adds the uniforms to the lit ShaderLib entries. Idempotent; call before the first
 * compile (lighting.js does it at import). Returns lightMask.
 */
export function installLightMask() {
  if (installed) return lightMask;
  installed = true;
  try {
    let ok = patchChunk('lights_pars_begin', 'uniform vec3 ambientLightColor;', `uniform vec3 ambientLightColor;\n${PARS}`);
    // the point tested is nudged 1.5 cm along the (view-space, camera-facing) normal into the room the surface faces: a
    // wall lying exactly on a box face (the shaft's north wall at x 0, down through the slab) flipped room per pixel and
    // showed thin stripes of the other room's light (integrator, bølge 1 gruppe 3, from steg 22+26t)
    ok = ok && patchChunk('lights_fragment_begin', 'IncidentLight directLight;', 'IncidentLight directLight;\nlmLocate( geometryPosition + geometryNormal * 0.015 );');
    ok = ok && patchChunk('lights_fragment_begin', 'getPointLightInfo( pointLight, geometryPosition, directLight );',
      `getPointLightInfo( pointLight, geometryPosition, directLight );\n${slotLine('point', 'directLight.color')}`);
    ok = ok && patchChunk('lights_fragment_begin', 'getSpotLightInfo( spotLight, geometryPosition, directLight );',
      `getSpotLightInfo( spotLight, geometryPosition, directLight );\n${slotLine('spot', 'directLight.color')}`);
    ok = ok && patchChunk('lights_fragment_begin', 'rectAreaLight = rectAreaLights[ i ];',
      `rectAreaLight = rectAreaLights[ i ];\n${slotLine('rect', 'rectAreaLight.color')}`);
    ok = ok && patchChunk('lights_fragment_begin', 'getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= lmSunLit();');
    // another room's fragment: its own flat irradiance instead of the camera room's direction-dependent map (whose
    // colour at a given normal is the camera room's, e.g. its Marrakesh wall), the map's reflections scaled to the
    // room's brightness and, the rougher the surface, the more replaced by the flat value (a uniform field reflects
    // exactly that). Lambert / phong add iblIrradiance to irradiance below, toon has no iblIrradiance.
    ok = ok && patchChunk('lights_fragment_end', '#if defined( RE_IndirectDiffuse )',
      '{\n\tvec4 lmF = lmIndirect();\n\tif ( lmF.w >= 0.0 ) {\n'
      + '\t\t#if defined( RE_IndirectDiffuse )\n\t\t#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )\n'
      + '\t\tirradiance = vec3( 0.0 );\n\t\tiblIrradiance = lmF.rgb;\n\t\t#else\n\t\tirradiance = lmF.rgb;\n\t\t#endif\n\t\t#endif\n'
      + '\t\t#if defined( RE_IndirectSpecular )\n\t\tradiance = mix( radiance * lmF.w, lmF.rgb * RECIPROCAL_PI, material.roughness );\n'
      + '\t\tclearcoatRadiance *= lmF.w;\n\t\t#endif\n\t}\n}\n#if defined( RE_IndirectDiffuse )');
    if (!ok) {
      uninstall();
      return lightMask;
    }
    for (const id of LIBS) {
      const lib = THREE.ShaderLib[id];
      if (lib?.uniforms) Object.assign(lib.uniforms, U);
    }
    lightMask.available = true;
  } catch (err) {
    console.warn('[lightmask] patch failed – lights are not masked', err);
  }
  return lightMask;
}

/**
 * The slot line in an unrolled light loop: the factor lmLocate computed for it, ( lo + 2 hi ) / 3 from its two bits
 * (UNROLLED_LOOP_INDEX is a literal there: constant shifts, no run-time indexing; ⅓ + ⅔ is exactly 1.0 in float32, so a
 * slot inside its mask is untouched). Slots past the kind's share of the slots are unmasked.
 */
function slotLine(kind, color) {
  const max = kind === 'point' ? 'LM_MAX_POINT' : kind === 'spot' ? 'LM_MAX_SPOT' : 'LM_MAX_RECT';
  const sh = `uint( ${SLOT_OFFSET[kind]} + UNROLLED_LOOP_INDEX )`;
  return `\t\t#if ( UNROLLED_LOOP_INDEX < ${max} )\n\t\t${color} *= float( ( lmLo >> ${sh} ) & 1u ) * ( 1.0 / 3.0 ) + float( ( lmHi >> ${sh} ) & 1u ) * ( 2.0 / 3.0 );\n\t\t#endif`;
}

/** Puts three's chunks and ShaderLib uniforms back (before the first compile: nothing has the patch then). */
function uninstall() {
  for (const [name, src] of Object.entries(ORIGINAL)) THREE.ShaderChunk[name] = src;
  for (const id of LIBS) {
    const u = THREE.ShaderLib[id]?.uniforms;
    if (u) for (const k of Object.keys(U)) if (u[k] === U[k]) delete u[k];
  }
  lightMask.available = false;
  U.lmInfo.value[0] = 0;
}

/** The (at most two) rooms of a box's bits for the indirect light: ( a + 1 ) + 32 · ( b + 1 ). */
function roomPair(bits) {
  const idx = [];
  for (let r = 0; r < MAX_ROOMS && idx.length < 2; r++) if (bits & (1 << r)) idx.push(r);
  return (idx[0] ?? -1) + 1 + 32 * ((idx[1] ?? -1) + 1);
}

/** The shared uniform state (see the top of this file). */
export const lightMask = {
  available: false,
  uniforms: U,
  setEnabled(on) {
    U.lmInfo.value[0] = on && this.available ? 1 : 0;
  },
  get enabled() {
    return U.lmInfo.value[0] > 0.5;
  },
  /** @param {{ boxes: { min: number[], max: number[], room: number }[], outside: number }} t */
  setRooms({ boxes, outside }) {
    const a = U.lmBoxMin.value, b = U.lmBoxMax.value;
    a.fill(0);
    b.fill(0);
    const n = Math.min(MAX_BOXES, boxes.length);
    for (let i = 0; i < n; i++) {
      const bx = boxes[i];
      a.set([bx.min[0], bx.min[1], bx.min[2], bx.bits ?? 2 ** bx.room], i * 4);
      b.set([bx.max[0], bx.max[1], bx.max[2], roomPair(bx.bits ?? 2 ** bx.room)], i * 4);
    }
    U.lmInfo.value[1] = n;
    U.lmInfo.value[3] = outside;
  },
  /**
   * A light slot: the rooms it lights fully (mask bits), its home room (bit, 0 = none: lit nowhere outside the mask)
   * and the light's world position (the portal test). index = three's order within the kind.
   */
  setSlot(kind, index, mask, home, pos = null) {
    const off = SLOT_OFFSET[kind];
    if (off == null || !(index >= 0) || index >= MAX_SLOTS[kind]) return;
    const i = off + index;
    const a = U.lmSlot.value;
    const h = home > 0 ? Math.round(Math.log2(home)) + 1 : 0;
    if (pos) {
      a[i * 4] = pos.x;
      a[i * 4 + 1] = pos.y;
      a[i * 4 + 2] = pos.z;
    }
    a[i * 4 + 3] = (mask & 0xffff) + 65536 * h;
    if (i + 1 > U.lmSun.value[1]) U.lmSun.value[1] = i + 1;
    const hb = home > 0 ? home : 0;
    if (PAIRS.home[i] !== hb) {
      PAIRS.home[i] = hb;
      PAIRS.dirty = true;
    }
  },
  /**
   * Rebuilds the (slot, portal) pairs after setSlot / setPortals: every portal of each slot's home room (call before a
   * render; cheap, and only when something changed). Past MAX_PAIRS, pairs of portals that touch `priorityBits` (the
   * camera's room) go first.
   */
  flush(priorityBits = 0) {
    if (!PAIRS.dirty && PAIRS.priority === priorityBits) return;
    PAIRS.dirty = false;
    PAIRS.priority = priorityBits;
    const first = [], rest = [];
    for (let i = 0; i < SLOTS; i++) {
      const hb = PAIRS.home[i];
      if (!hb) continue;
      PAIRS.portalBits.forEach((bits, p) => {
        if (bits & hb) ((bits & priorityBits) ? first : rest).push(i + 32 * p);
      });
    }
    const all = [...first, ...rest];
    if (all.length > MAX_PAIRS && !PAIRS.warned) {
      PAIRS.warned = true;
      console.warn(`[lightmask] ${all.length} slot/portal pairs, only ${MAX_PAIRS} fit – the rest light only their own room`);
    }
    const v = U.lmPair.value;
    v.fill(0);
    const n = Math.min(MAX_PAIRS, all.length);
    for (let k = 0; k < n; k++) v[k] = all[k];
    U.lmSun.value[2] = n;
  },
  /** The pairs the shader tests (Node tests): [{ slot, portal }]. */
  get pairs() {
    const v = U.lmPair.value, out = [];
    for (let k = 0; k < U.lmSun.value[2]; k++) out.push({ slot: v[k] & 31, portal: v[k] >> 5 });
    return out;
  },
  /** Room bits the sun (directional light) lights; 0 = every fragment (no mask). */
  setSun(bits) {
    U.lmSun.value[0] = bits || 0;
  },
  /**
   * Whether the patch fits a renderer's fragment uniform budget (VECTORS + BASE_FRAGMENT_VECTORS ≤
   * MAX_FRAGMENT_UNIFORM_VECTORS). A renderer that does not tell: true.
   */
  fits(renderer) {
    const max = renderer?.capabilities?.maxFragmentUniforms;
    return !(Number.isFinite(max) && max > 0) || VECTORS + BASE_FRAGMENT_VECTORS <= max;
  },
  /**
   * Back to three's lighting for good (lighting.js, before the first compile): a GPU that does not fit (warned), or
   * `reason` 'lm=0' (the dev comparison, silent).
   */
  uninstall(reason = 'gpu') {
    if (this.available && reason === 'gpu') console.warn(`[lightmask] the GPU takes too few fragment uniforms for the light masks (${VECTORS} + ${BASE_FRAGMENT_VECTORS}) – lights are not masked`);
    uninstall();
  },
  /** @param {{ center: number[], u: number[], halfU: number, v: number[], halfV: number, bits: number, gain: number }[]} list */
  setPortals(list) {
    const p = U.lmPortal.value;
    p.fill(0);
    let n = 0;
    const bits = [];
    for (const q of list) {
      if (n >= MAX_PORTALS) break;
      if (!(q.gain > 0) || !q.bits) continue;
      // v is up (a hole in a wall) or +z (the stairwell, u = +x): the third row only says which
      const hole = Math.abs(q.v?.[2] ?? 0) > 0.5 ? 1 : 0;
      p.set([q.center[0], q.center[1], q.center[2], q.bits, q.u[0], q.u[1], q.u[2], q.halfU, q.halfV, q.gain, hole, 0], n * 12);
      bits.push(q.bits);
      n++;
    }
    U.lmInfo.value[2] = n;
    if (bits.join() !== PAIRS.portalBits.join()) PAIRS.dirty = true;
    PAIRS.portalBits = bits;
  },
  /** The camera's room (its own environment, as is) or a room without its own value (as is): no flat irradiance. */
  setRoomAsIs(room, camera = false) {
    if (!(room >= 0 && room < MAX_ROOMS)) return;
    U.lmRoomF.value.set([0, 0, 0, camera ? 1 : 0], room * 4);
    if (camera) U.lmSun.value[3] = room + 1;
    else if (U.lmSun.value[3] === room + 1) U.lmSun.value[3] = 0;
  },
  /**
   * Another room's indirect light: its flat irradiance (rgb, display units – what the camera room's map gives as
   * iblIrradiance: exitance × S × white balance) and the scale of the camera room's reflections (luminance ratio).
   */
  setRoomFlat(room, r, g, b, reflect) {
    if (!(room >= 0 && room < MAX_ROOMS)) return;
    U.lmRoomF.value.set([r, g, b, 2 + Math.max(0, reflect)], room * 4);
    if (U.lmSun.value[3] === room + 1) U.lmSun.value[3] = 0;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Room table (pure)

/**
 * Splits a rectilinear polygon ([[x, z], …] or Vector2-likes) into axis-aligned rectangles: vertical slabs between
 * the distinct x of its corners, the z intervals inside each slab, merged across neighbouring slabs with the same
 * interval. The living room's L with the niche gives 4. A polygon with a slanted edge gives its bounding box.
 * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number }[]}
 */
export function rectilinearBoxes(polygon) {
  const pts = (polygon || []).map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.y ?? p.z }));
  if (pts.length < 3) return [];
  const n = pts.length;
  const rectilinear = pts.every((p, i) => {
    const q = pts[(i + 1) % n];
    return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.z - q.z) < 1e-6;
  });
  if (!rectilinear) {
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
    return [{ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }];
  }
  const xs = [...new Set(pts.map((p) => +p.x.toFixed(6)))].sort((a, b) => a - b);
  const slabs = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x = (xs[i] + xs[i + 1]) / 2;
    // crossings of the horizontal edges (constant z) that span x
    const zc = [];
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      if (Math.abs(a.z - b.z) > 1e-6) continue;
      if ((a.x - x) * (b.x - x) < 0) zc.push(a.z);
    }
    zc.sort((a, b) => a - b);
    const iv = [];
    for (let k = 0; k + 1 < zc.length; k += 2) iv.push([zc[k], zc[k + 1]]);
    slabs.push({ x0: xs[i], x1: xs[i + 1], iv });
  }
  const out = [];
  const open = new Map(); // "z0,z1" → rect still growing in x
  for (const s of slabs) {
    const seen = new Set();
    for (const [z0, z1] of s.iv) {
      const key = `${z0.toFixed(6)},${z1.toFixed(6)}`;
      seen.add(key);
      const r = open.get(key);
      if (r && Math.abs(r.maxX - s.x0) < 1e-6) r.maxX = s.x1;
      else {
        const nr = { minX: s.x0, maxX: s.x1, minZ: z0, maxZ: z1 };
        out.push(nr);
        open.set(key, nr);
      }
    }
    for (const k of [...open.keys()]) if (!seen.has(k)) open.delete(k);
  }
  return out;
}

/**
 * The room table of a layout: one index per physical room (the living room first, then layout.house.rooms in order;
 * hud rooms skipped), OUTSIDE last, and the world boxes of each room – its plan rectangles grown by BOX_MARGIN, in y
 * from the slab under its level (+2 cm) to its ceiling (+5 cm, at most the slab of the level above). Rooms past
 * MAX_ROOMS − 1 share the OUTSIDE index (warned).
 * @param {object} layout  home/layout.js
 * @returns {{ rooms: { id: string, index: number, bit: number, levelId: string }[], byId: Object<string, object>,
 *   boxes: { min: number[], max: number[], room: number, roomId: string }[], outside: number, outsideBit: number }}
 */
export function buildRoomTable(layout) {
  const h = layout?.house;
  const list = (h?.rooms || []).filter((r) => !r.hud && r.polygon?.length >= 3);
  if (!list.some((r) => r.id === LIVING)) {
    list.unshift({ id: LIVING, levelId: MAIN_LEVEL, polygon: layout?.floor?.polygon || [], floorY: 0, ceilingTop: 3.0 });
  } else list.sort((a, b) => (a.id === LIVING ? -1 : b.id === LIVING ? 1 : 0));
  const outside = Math.min(MAX_ROOMS - 1, list.length);
  const rooms = [];
  const byId = {};
  list.forEach((r, i) => {
    let index = i;
    if (i >= outside) {
      console.warn(`[lightmask] room ${r.id}: more than ${MAX_ROOMS - 1} rooms – lit as outside`);
      index = outside;
    }
    const e = { id: r.id, index, bit: 2 ** index, levelId: r.levelId ?? MAIN_LEVEL };
    rooms.push(e);
    byId[r.id] = e;
  });
  const ute = { id: OUTSIDE_ID, index: outside, bit: 2 ** outside, levelId: null };
  byId[OUTSIDE_ID] = ute;
  const levelOf = (id) => h?.levelsById?.[id] ?? null;
  const boxes = [];
  for (const r of list) {
    const e = byId[r.id];
    if (e.index === outside) continue;
    const lv = levelOf(r.levelId ?? MAIN_LEVEL);
    const above = lv?.aboveId ? levelOf(lv.aboveId) : null;
    // from 2 cm above the slab under the level (the ceiling of the level below, at its underside, is not in it); the
    // lowest level reaches 0.3 below its floor
    const y0 = lv ? (lv.belowId ? lv.bottomY + 0.02 : (r.floorY ?? lv.floorY) - 0.3) : -0.28;
    let y1 = (r.ceilingTop ?? (r.floorY ?? 0) + 3) + 0.05;
    if (above) y1 = Math.min(y1, above.bottomY + 0.02);
    for (const b of rectilinearBoxes(r.polygon)) {
      boxes.push({
        min: [b.minX - BOX_MARGIN, y0, b.minZ - BOX_MARGIN],
        max: [b.maxX + BOX_MARGIN, y1, b.maxZ + BOX_MARGIN],
        room: e.index,
        bits: e.bit,
        roomId: r.id,
      });
    }
  }
  // the holes through the walls belong to both sides: a door's reveal and its closed leaf (which stands inside the wall,
  // e.g. door-gang's on the hall side of the middle) are lit by the rooms on either side – a face turned away from a
  // lamp gets nothing from it anyway – and the stairwell's slab edge by the hall and the basement hall. The windows of
  // the other rooms (not the living room's: they stay OUTSIDE as before) belong to their room only, so a lamp of the
  // living room (which lights OUTSIDE) never lights a bedroom's window reveal.
  const bitOf = (id) => byId[id]?.bit ?? 0;
  for (const q of portalRects(layout)) {
    const bits = bitOf(q.connects[0]) | bitOf(q.connects[1]);
    if (!bits) continue;
    if (q.kind === 'hole') {
      const lv = levelOf(byId[q.connects[0]]?.levelId);
      const top = lv ? lv.floorY + 0.02 : 0.02, bottom = lv ? lv.bottomY - 0.02 : -0.32;
      boxes.push({ min: [q.center[0] - q.halfU, bottom, q.center[2] - q.halfV], max: [q.center[0] + q.halfU, top, q.center[2] + q.halfV], bits, roomId: q.id });
    } else boxes.push({ ...wallHoleBox(q.center, q.u, q.halfU, q.halfV, q.thickness ?? 0.1), bits, roomId: q.id });
  }
  for (const o of h?.windows || []) {
    if (o.roomId === LIVING || !byId[o.roomId] || byId[o.roomId].index === outside) continue;
    const t = h.wallsById?.[o.wallId]?.thickness ?? 0.3;
    const c = o.center.clone().addScaledVector(o.normal, -t / 2);
    boxes.push({ ...wallHoleBox([c.x, c.y, c.z], [o.right.x, o.right.y, o.right.z], o.width / 2, o.height / 2, t), bits: byId[o.roomId].bit, roomId: o.id });
  }
  if (boxes.length > MAX_BOXES) console.warn(`[lightmask] ${boxes.length} room boxes, only ${MAX_BOXES} fit – the rest are lit as outside`);
  return { rooms, byId, boxes: boxes.slice(0, MAX_BOXES), outside, outsideBit: ute.bit };
}

/** World box of a hole through a wall: centre in the middle of the wall, u along it (axis-aligned walls), 2 cm extra. */
function wallHoleBox(center, u, halfU, halfV, thickness) {
  const ux = Math.abs(u[0]), uz = Math.abs(u[2]);
  const hx = ux * halfU + uz * (thickness / 2 + 0.02);
  const hz = uz * halfU + ux * (thickness / 2 + 0.02);
  return {
    min: [center[0] - hx, center[1] - halfV - 0.02, center[2] - hz],
    max: [center[0] + hx, center[1] + halfV + 0.02, center[2] + hz],
  };
}

/**
 * Portal rectangles of the house (world): every door and open opening between two rooms (rect in the middle of its
 * wall, u along the wall, v up) and the stairwell (its floor-opening polygon split into rectangles, horizontal, at the
 * middle of the slab). `connects` holds room ids (a door to outside names 'ute').
 * @returns {{ id: string, kind: 'door'|'opening'|'hole', connects: string[], center: number[], u: number[], halfU: number,
 *   v: number[], halfV: number }[]}
 */
export function portalRects(layout) {
  const h = layout?.house;
  if (!h) return [];
  const out = [];
  for (const o of h.openings || []) {
    if (o.type === 'window') continue;
    const conn = (o.connects || []).filter(Boolean);
    if (conn.length !== 2 || conn[0] === conn[1]) continue;
    const w = h.wallsById?.[o.wallId];
    const t = w?.thickness ?? 0.1;
    const c = o.center.clone().addScaledVector(o.normal, -t / 2);
    out.push({
      id: o.id, kind: o.door ? 'door' : 'opening', connects: [...conn], door: !!o.door,
      center: [c.x, c.y, c.z], u: [o.right.x, o.right.y, o.right.z], halfU: o.width / 2, v: [0, 1, 0], halfV: o.height / 2, thickness: t,
    });
  }
  for (const fo of h.floorOpenings || []) {
    const st = (h.stairs || []).find((s) => s.id === fo.stairId || s.openingId === fo.id);
    const lv = h.levelsById?.[fo.levelId];
    const below = st ? (h.rooms || []).find((r) => st.roomIds?.includes(r.id) && r.levelId !== fo.levelId && !r.hud) : null;
    if (!below || !lv) continue;
    const y = lv.floorY - (lv.slabThickness ?? 0.3) / 2;
    rectilinearBoxes(fo.polygon).forEach((b, i) => {
      out.push({
        id: `${fo.id}:${i}`, kind: 'hole', connects: [fo.roomId, below.id], door: false,
        center: [(b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2], u: [1, 0, 0], halfU: (b.maxX - b.minX) / 2, v: [0, 0, 1], halfV: (b.maxZ - b.minZ) / 2,
      });
    });
  }
  return out;
}

export default lightMask;
