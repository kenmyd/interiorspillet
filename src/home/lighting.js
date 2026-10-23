// LIGHTING – sun, sky and time of day, built-in and item lights, shadows, exposure and post-processing for the home
// (ARCHITECTURE §10, §15). Owned by «lighting».
//
// Physical model (all light quantities are photometric SI units until the very last step):
//   sun           DirectionalLight, illuminance in lux (direct normal × glass transmission), crisp PCF shadows from a
//                 shadow camera fitted tightly around the room; shadow maps render only on request (autoUpdate off).
//                 The terrain horizon (HORIZON, measured on the photo backdrops) hides the low sun behind the hills
//                 and the trees west of the house dim it (TREES): no direct sun at the photo time (08:30, 18 Oct).
//   sky           one RectAreaLight per window/glass door at the glass, tilted WINDOW_TILT down (sky light goes down
//                 into the room), luminance in nits = vertical sky + ground illuminance on the outer pane / π × glass
//                 transmission × the shading's transmission; the ground-reflected part has the garden's green-grey
//                 colour (GROUND_TINT), the blue sky with the sun behind the hills ≈ 11 000 K. A window without a rect
//                 slot falls back to a soft far-field spot behind the glass.
//   lamps         SpotLight / PointLight in candela from lumens (spot: lumens / effective cone solid angle, point:
//                 lumens / 4π, ceiling rings: Lambertian lumens / π), LED strips as thin tilted RectAreaLights (wall
//                 washers). The four spots at the high wall get shadow-casting slots («middels»/«høy»), so wall
//                 designs cast shadows. A fixture that draws its up-light as ceiling decals (the molecule chandelier)
//                 lights the room below as a half-space spot.
//   sun patches   each wall's sunlit floor patch becomes a wide upward spot under the floor (its reflection lights the
//                 ceiling and the undersides of furniture nearby).
//   bounce        a tiny radiosity solve over the real room surfaces (floor and ceilings per zone, every wall, the
//                 glass) with the direct flux of every source landed on them (sun rays traced through each window, the
//                 sky part below the glass top, the ground part above the sill). The patch radiances become a
//                 low-poly copy of the room that is turned into a PMREM environment map (one reused render target) –
//                 it is the indirect light (diffuse irradiance) AND the reflections of every PBR material. Lamp flux
//                 enters it at LAMP_BOUNCE (one probe serves the whole open-plan room), daylight fully. Nothing in it
//                 depends on where the camera is, so a corner of the room looks the same from near and far.
//   emissive      lamp shades / bulbs / LED diffusers glow with the luminance their lumens give over their area,
//                 rolled off at EMISSIVE_DISPLAY_CAP so they keep the light's colour instead of clipping to white.
//   exposure      the photometric values are multiplied by one scene scale S (a camera with partial eye adaptation:
//                 S = key / (Lavg^0.72 · L0^0.28)) before they reach three.js, so toneMappingExposure stays ≈ 1 and
//                 unlit materials (photo backdrop, highlights, ghosts) keep their display brightness; evenings and
//                 nights a little darker (MODE_KEY). White balance like a phone camera's (WB): a diagonal matrix that
//                 maps the dominant light (daylight and lamps mixed in mired by the lamps' share) onto its partly
//                 adapted colour on the blackbody locus – daylit walls stay grey-cool and 2700 K pools amber in mixed
//                 light, a lamp-lit evening reads warm white, not orange-brown or olive. Eased like the exposure.
//                 Khronos PBR Neutral tone mapping (base colours stay true, saturated lamp light stays amber).
//   outside       the 3D exterior gets its own sky environment (exterior.js setDaylight(…, light)), not the room's.
//   budget        fixed pools of point / spot / rect lights (counts never change, so shaders never recompile), sized so
//                 every built-in lamp of the room has a real light at once (PROFILES); every 0.25 s / 0.5 m the sources
//                 with the largest contribution to the render camera get a slot, the rest (only when more lamps are
//                 placed than there are slots) are emissive only and their direct light near the camera is added to an
//                 ambient term (the bounce of every source is in the environment map regardless). LED strips weigh
//                 STRIP_SIGNATURE × their flux for a rect slot (their wash is what shows; a window's spot stand-in looks
//                 nearly the same).
//   AO            GTAO multiplied onto the frame on «høy» (lighting.render()).
//
// The whole house (notes/hele-huset-design.md §4, steg 13 L1 + 27 L2):
//   rooms         the living room (stue/kjøkken/TV-stue) is computed exactly as before (its model, windows, lamps,
//                 bounce lights). Every other room of layout.house gets its own small radiosity model (floor minus
//                 holes, ceilings, walls with their holes, glass, doors/holes as PORTALS), its own windows (sky, sun,
//                 skyView / obstruction / frosted from the data) and lamps (plafond = Lambertian disc, downlights
//                 grouped to at most two spots per room, LED strips with signature 1). Portals carry the neighbour's
//                 mean exitance × the door's opening into the room (stue → gang → … in one coupling pass + one more).
//   camera room   the room the camera is in (layout.house.roomAt, body height, level hysteresis; above the ceilings =
//                 the overview → the living room) drives exposure, white balance, ambient and the environment map
//                 (one PMREM per room, cached; ≤ 1 build per room change). A fragment in another room gets that
//                 room's flat irradiance (its mean exitance × S × wb, lightmask) instead of the map, and the map's
//                 reflections × its luminance relative to the camera's room. Lkey of a room other than the living room is at least
//                 min(2, the largest Lkey of the rooms the camera can reach); the change eases over ≈ 1.5 s.
//   masks         src/world/lightmask.js keeps every pooled light in its room: a slot lights its room fully (the
//                 living room's also OUTSIDE), other rooms only through an open portal. Slots go only to sources of
//                 the rooms the camera can reach (open portals, depth 2), so with the doors shut the living room has
//                 exactly today's candidates. With every portal of the camera's room shut the masks are off for the
//                 frame (_masksWanted: nothing they could change is seen).
//   auto          per group (data `auto`): 'on' (rooms without windows), 'dark' (the room's own daylight), 'evening'
//                 (entrance, outside), 'off' (storerooms); the six living-room groups follow the living room as before.
//   sun           the shadow box follows the camera's level (hoved exactly as before, kjeller y −2.9…0), the sun's map
//                 renders only when flagged (sun.shadow.autoUpdate off: a shadow slot changing hands no longer redraws
//                 it; an outside request – shading.js blinds – still does).
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { installLightMask, lightMask, buildRoomTable, portalRects, OUTSIDE_ID } from '../world/lightmask.js';
import { surfaceGeometry } from './wallkit.js';

// before the first compile of any lit material (the patch is inert until LightManager.render enables it)
installLightMask();

const LIVING_ID = 'stue-kjokken';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Where the house is: latitude from room-spec (outside.sun.latitude), longitude ≈ Sørlandet, the calendar year. */
export const SITE = Object.freeze({ latitude: 58.1, longitude: 8.0, year: 2026 });

/**
 * The light of the room photos and the photomontages (bilder_stue 08:27–08:30 on 18 October 2026; the montages are
 * built on the «Før» photo of the same morning): the sun 2° up but behind the eastern ridge, clear sky, the built-in
 * lamps on (auto). PhotoCompare and the «Som på bildene» preset use it.
 */
export const PHOTO_ENV = Object.freeze({ hour: 8.5, month: 10, day: 18, mode: 'auto' });

/** Visible transmittance of the windows (modern low-e double/triple glazing). */
const GLASS_T = 0.7;
/** Reflectance of the ground/garden/river in front of the windows (ground-reflected sky light). */
const GROUND_RHO = 0.18;
/** Colour of that reflection (linear, luminance 1): lawn and the trees round the house (#4d5a33, the south photo's
 *  lawn) mixed with the grey deck and stone – the light the windows let in is a little green-cyan, not lilac where it
 *  mixes with the lamps (add-lighting: the daylit walls of the photos measure ≈ (0.8, 1, 1.24) relative to green). */
const GROUND_TINT = (() => {
  const c = new THREE.Color(0.89, 1.07, 0.62);
  return c.multiplyScalar(1 / (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b));
})();
/** Light lost to nearby obstructions per window (terrace annex east of the kitchen, the building north of the TV window). */
const OBSTRUCTION = { 'win-k1': 0.85, 'win-k2': 0.85, 'win-tv': 0.8 };
/** Exposure: key value, adaptation exponent and reference luminance (nits) of the virtual camera/eye. */
const KEY = { mid: 0.26, p: 0.72, L0: 60 };
/** Room luminance (nits) below which the view out of the windows is not exposed brighter (see _recompute). */
const VIEW_LKEY_MIN = 10;
/** Key per (effective) light mode: lamp-lit evenings and nights are shown a little darker than they are adapted to,
 *  so the pools and coves stay warm instead of clipping to cream and the room reads as evening (add-lighting). */
const MODE_KEY = { day: 1, evening: 0.95, night: 0.85 };
/**
 * Camera white balance (add-lighting; replaces fix-lighting r1's partial von Kries adaptation toward an additive
 * day + 0.6 · lamp mix, which left every surface beige whenever the lamps had a fair share of the light). One diagonal
 * matrix maps the colour of the dominant light (srcM, in mired) onto the colour it is shown as (appM): both mix the
 * daylight and the lamps by the lamps' weight m = lampL · pull / (dayL + lampL · pull) (lampL, dayL = their light on
 * the room's surfaces, lamps at LAMP_BOUNCE); each part is moved toward D65 (= no correction) by:
 *   day       next to lamps: the sky/sun colour almost uncorrected – the 08:30 photos show the daylit Sand walls
 *             grey-blue (#a8c2d2, #c9d3d4) and the 2700 K pools amber (#da9765), i.e. a camera near D65;
 *   dayAlone  daylight without lamps: the measured colour on the surfaces (sun + its warm bounce) balanced more, like
 *             auto white balance in a sunlit room (the Sand ceilings were peach at noon);
 *   lamps / lampsEvening   the lamps' colour: by day 0.85 (2700 K pools stay amber next to the daylight); lamp-lit
 *             evenings and nights 0.9 on a colour halfway (lampsMeasured) between the lamps' own and that of their
 *             light on the surfaces (its bounce off Sand and oak is warmer): warm white, grey stays grey.
 * Blackbody to blackbody, so the lamp-lit evening stays on the locus (dividing by a 3200 K white point left it olive).
 * Dev overrides: &wbd= &wba= &wbl= &wbe= &wbp= (day, dayAlone, lamps, lampsEvening, pull).
 */
const WB = { day: 0.1, dayAlone: 0.6, lamps: 0.85, lampsEvening: 0.9, lampsMeasured: 0.5, pull: 0.7 };
/** Floor albedo factor for the furniture, rugs and things standing on it (radiosity only). */
const FLOOR_CLUTTER = 0.75;
/** Minimum ambient (lux) at night with every lamp off: moonlight / street light. */
const NIGHT_FLOOR_LUX = 0.25;
/** Indoor daylight (mean on the floor, lux) below which the built-in lamps switch on in mode 'auto'. */
const LAMPS_ON_BELOW_LUX = 160;
/** Emissive luminance (nits) per unit of a material's userData.baseIntensity (models tune glows for a night view). */
const EMISSIVE_NITS_PER_UNIT = 150;
/** Colour temperature of the light from a clear sky when the sun is hidden (shade under a blue sky ≈ 10–12 000 K;
 *  9000 K left the daylit walls of the 08:30 photos too neutral). */
const BLUE_SKY_K = 11000;
/** Outdoor sky light for the 3D exterior (see _recompute): display radiance cap of the sky dome (the deck and railing
 *  in shade read as in photo 082841: deck ≈ #5a6069, railing ≈ #595a5a), the ground's reflectance relative to the sky,
 *  and the warmest-blue colour temperature of the dome (horizon glow, facade and trees round the terrace included). */
const OUTDOOR = { cap: 0.9, ground: 0.2, maxK: 7000 };
/** Share of a flush ceiling ring's flux that leaves sideways/up (its opal ring – the halo round the kitchen ring in
 *  082937); bounce only. */
const RING_UP_SHARE = 0.15;
/**
 * Downward half-space emitter for fixtures whose up-light is drawn as ceiling decals (see _itemCandidate).
 * pointShare: the isotropic part (half of it goes up). The molecule chandelier's shades are opaque black: what reaches
 * the ceiling leaves through the openings of its upward/sideways shades, and those are the decals. 0.3 put 15 % of the
 * flux straight up from under the shades – a broad glow round the canopy that the decals then multiplied into a hot spot
 * (owner's change list 2026-10-21: «lyser litt kunstig mye opp i taket»); 0.1 keeps a faint scatter so the ceiling
 * is not a cave. decalGain: the decals' level over their nominal luminance (they are linear in the dimmer, _applyEmissive).
 */
const HALF_SPACE_SPOT = { angle: 84 * DEG, penumbra: 0.35, pointShare: 0.1, decalGain: 1.0 };
/**
 * Share of a lamp's flux that goes into the bounce (radiosity → environment map, exposure, white balance). A lamp's
 * first bounce lands near the lamp, and the single environment probe spreads every lamp's bounce over the whole
 * open-plan room (the 08:30 photos: lamp light stays in the pools and coves, the daylit walls and the TV-stue sofa stay
 * grey). add-lighting weighted each lamp by its distance to the camera (R² / (R² + d²), R = 3 m, ≥ 0.1) – a corner then
 * brightened as you walked toward it (its lamps' bounce grew, from ≈ 0.3 to ≈ 0.7). One constant instead: the mean of
 * that weight over the walkable room (≈ 0.45), so the calibrated balance of daylight and lamps stays.
 */
const LAMP_BOUNCE = 0.45;
/** Light-slot priority of an LED strip over its flux (see _score). */
const STRIP_SIGNATURE = 8;
/**
 * The rooms of the house besides the living room (§4.4, §4.5, §4.8, §4.11): an LED strip there weighs its flux only
 * (signature 1 – with 8 the handrail LED would take the living room's strip slots at night); downlights are grouped
 * into at most `maxDownlightSpots` spot candidates per room (the rest of a room's light is its bounce); a room's Lkey is
 * at least min(reachLkeyCap, the largest Lkey the camera can reach); exposure / white balance ease over roomEase s
 * after a room change; a door counts as a portal for the light budget above portalOpen; frosted glass lets frostedT
 * through, diffuse (no tilt).
 *   wbLocal     how far the light of another room (seen through a door / the stairwell) is shown with its own white
 *               balance instead of the camera room's (0 = the camera's, 1 = fully its own; per channel in log space,
 *               the ratio clamped to wbRelMax): the hall's 3800 K plafond under the living room's 2700 K night balance
 *               was lavender, photo 225331 shows it cream
 *   hop         light-slot weight of a source per portal on the way from the camera's room (× the door's opening):
 *               a lamp behind a door is seen through the doorway only, so it must not take the camera room's slots;
 *               slotDepth: light slots only for rooms this many portals away (the visibility keeps depth 2) – the
 *               basement hall's downlights two portals away (door + stairwell) took the living room's pendants' slots
 *   portalStep  a swinging door recomputes the rooms only per this step of its opening (and when it stops)
 */
const HOUSE = {
  stripSignature: 1, maxDownlightSpots: 2, reachLkeyCap: 2, roomEase: 1.5, portalOpen: 0.5, frostedT: 0.5,
  downlight: { angle: 50 * DEG, penumbra: 0.7 }, plafond: { angle: 82 * DEG }, pendant: { angle: 55 * DEG }, step: { angle: 60 * DEG },
  wbLocal: 0.9, wbRelMax: 4, hop: { door: 0.45, opening: 0.6, hole: 0.35 }, slotDepth: 1, portalStep: 0.2,
};
/** LAMP_BOUNCE of a house room: ≈ 1 for a small closed room (its lamps light all of it), less for a big one. */
const roomLampBounce = (area) => clamp(1.2 - area / 40, 0.6, 1);
/** Shadow box of the basement level (y): its floors up to the top of the slab above (the sun comes in at its windows). */
const BASEMENT_SHADOW_Y = [-2.9, 0];
/** Display level (brightest channel, × white) the glow of lamps and LED lines rolls off toward (see _applyEmissive). */
const EMISSIVE_DISPLAY_CAP = 1.8;
const TONE_MAPPING = THREE.NeutralToneMapping;
/** Ambient fallback for a source without a light slot: Φ·AMB_K / (d² + AMB_R2) lux at camera distance d (a point
 *  source's mean irradiance over all orientations ≈ Φ / (16π d²), softened near the camera). */
const AMB_K = 1 / (16 * Math.PI);
const AMB_R2 = 1.0;
/** Downward tilt of the windows' sky rect lights (see _buildWindows). */
const WINDOW_TILT = 45 * DEG;
/**
 * Beam of the four high-wall spots (group 'spots'), fitted to photos 082924 / 0_for with .shots/fix-lighting-r1/
 * spotfit.mjs + spotfit2.mjs: fully soft (penumbra 1 – the smoothstep falloff spans the whole cone, no hard rim), a
 * wider cone (half-angle 32° instead of beamDeg/2 · 1.3 ≈ 23° with penumbra 0.5) aimed 0.25 m below the fixture's
 * 2.25 m. A cone 0.38 m in front of the wall always peaks just under the ceiling (cos³ of the grazing incidence): this
 * one gives soft ovals ≈ 0.5 m wide at the 20 % contour (1.95–2.6 m, ≈ 0.6 m at 8 %) with a blurred top and ≈ 60 % of
 * the old peak brightness, so the tone mapper keeps them amber. Wider cones (36–45°) were rounder still, but their
 * lower half runs onto the floor in front of the wall; narrower ones are the old bullet shape.
 */
const HIGHWALL_SPOT = { angle: 32 * DEG, penumbra: 1, aimDrop: 0.25 };
/**
 * Beam of the three pendants over the kitchen island (group 'pendler'). The model's own cone (≈ 20° half-angle,
 * penumbra 0.55) drew pools ≈ 0.5 m across on the worktop 0.8 m below; the owner's pendants light a much larger part
 * of the island. 34° with a firmer edge (penumbra 0.3): pools ≈ 1 m across that still read as three on the dark
 * worktop (40–46° with a soft edge lit the island evenly – no pools left, and as much floor as worktop).
 */
const ISLAND_PENDANT = { angle: 34 * DEG, penumbra: 0.3 };

/**
 * Per quality level: light pool sizes, shadow and environment resolution, ambient occlusion.
 * three.js unrolls every light into every lit shader, so the pools set the compile time of each program (ANGLE/D3D11:
 * ≈ 0.12 s per RectAreaLight, ≈ 0.04 s per spot, ≈ 0.02 s per point, measured with .shots/fix-lighting-r1/cclen.mjs)
 * and the light uniforms uploaded at every program switch. fix-lighting r1: «middels» went from 4/10/8 (+4 shadowed
 * spots) to 2/6/4 (the four high-wall spots keep their shadows): ≈ 2× faster compiles, ≈ ½ the uniforms. Window sky
 * light without a rect slot falls back to a cheap spot (see _budget), sun-patch bounce lights are spots.
 * The room has 11 spot lamps (4 high-wall spots, 3 island pendants, 2 kitchen rings, the TV-stue ring, the stue
 * chandelier): with 6 spots on «middels» only two of the seven beside the high-wall spots had a light at a time – the
 * rest were a flat ambient term that faded in as you walked up to them (one pendant lit, the TV-stue darker from a
 * distance). «middels» has 12 now (one spare for a placed lamp): ≈ +4 s on the first load (16.6 → 20.5 s, headless
 * Edge/D3D11); the rect pool is unchanged (four more rects cost ≈ +11 s).
 */
const PROFILES = {
  low: { point: 2, spot: 8, spotShadows: 0, rect: 3, shadowMap: 1024, pcf: 1.6, spotShadowMap: 0, env: 64, ao: false },
  medium: { point: 2, spot: 12, spotShadows: 4, rect: 4, shadowMap: 2048, pcf: 2.2, spotShadowMap: 512, env: 64, ao: false },
  high: { point: 4, spot: 14, spotShadows: 4, rect: 8, shadowMap: 4096, pcf: 3.2, spotShadowMap: 1024, env: 128, ao: true },
};

/** Luminance of a linear RGB colour. */
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** target += c × s (THREE.Color has no addScaledColor). */
function addScaled(target, c, s) {
  target.r += c.r * s;
  target.g += c.g * s;
  target.b += c.b * s;
  return target;
}

// ---------------------------------------------------------------------------------------------------------------
// Colour temperature

/**
 * Approximate black-body colour for a colour temperature (K), sRGB-normalised (max channel 1), stored linear.
 * @param {number} k
 * @param {THREE.Color} [out]
 * @returns {THREE.Color}
 */
export function kelvinToColor(k, out = new THREE.Color()) {
  const t = Math.max(1000, Math.min(15000, k)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * (t - 60) ** -0.1332;
    g = 288.12 * (t - 60) ** -0.0755;
    b = 255;
  }
  return out.setRGB(clamp(r / 255), clamp(g / 255), clamp(b / 255), THREE.SRGBColorSpace);
}

/** ln(b / r) of the blackbody colours 1200–15000 K (monotonic), for cctOf(). */
const CCT_TABLE = (() => {
  const t = [];
  const c = new THREE.Color();
  for (let k = 1200; k <= 15000; k += k < 4000 ? 50 : 200) {
    kelvinToColor(k, c);
    t.push([Math.log(Math.max(1e-4, c.b) / Math.max(1e-4, c.r)), k]);
  }
  return t;
})();

/** Colour temperature (K) whose blackbody has the same blue/red ratio as a linear colour. */
function cctOf(c) {
  const x = Math.log(Math.max(1e-6, c.b) / Math.max(1e-6, c.r));
  const t = CCT_TABLE;
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) return lerp(t[i - 1][1], t[i][1], (x - t[i - 1][0]) / Math.max(1e-6, t[i][0] - t[i - 1][0]));
  return t[t.length - 1][1];
}

/** Light colour for a temperature, normalised to luminance 1 (so lumens stay lumens whatever the colour). */
function lightColor(k, out = new THREE.Color()) {
  kelvinToColor(k, out);
  return out.multiplyScalar(1 / Math.max(1e-4, lum(out)));
}

// ---------------------------------------------------------------------------------------------------------------
// Sun

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Day of the year (1 = 1 January). */
export function dayOfYear(month, day, year = SITE.year) {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000) + 1;
}

/** { month, day } of a day of the year. */
export function dateFromDayOfYear(doy, year = SITE.year) {
  const d = new Date(Date.UTC(year, 0, Math.max(1, Math.round(doy))));
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function lastSunday(year, month) {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/**
 * Norwegian clock offset from UTC (hours): +1 normal time (CET), +2 summer time (CEST, last Sunday of March 02:00
 * to last Sunday of October 03:00).
 */
export function utcOffset(month, day, hour = 12, year = SITE.year) {
  if (month < 3 || month > 10) return 1;
  if (month > 3 && month < 10) return 2;
  const ls = lastSunday(year, month);
  if (month === 3) return day > ls || (day === ls && hour >= 2) ? 2 : 1;
  return day < ls || (day === ls && hour < 3) ? 2 : 1;
}

/**
 * Solar position (NOAA algorithm + refraction) for a local clock time in Norway.
 * Azimuth A from north, clockwise; the direction toward the sun in the home's frame (+x south, −z east) is
 * (−cos A·cos h, sin h, −sin A·cos h) (ARCHITECTURE §10).
 * @param {{ hour?: number, month?: number, day?: number, latitude?: number, longitude?: number, year?: number }} [o]
 * @returns {{ dir: THREE.Vector3, altitude: number, azimuth: number, altitudeDeg: number, azimuthDeg: number,
 *   declination: number, eqTime: number, utcOffset: number }}  angles in radians unless named …Deg
 */
export function solarPosition({ hour = 13, month = 6, day = 15, latitude = SITE.latitude, longitude = SITE.longitude, year = SITE.year } = {}) {
  const tz = utcOffset(month, day, hour, year);
  const n = isLeap(year) ? 366 : 365;
  const utc = hour - tz;
  const g = ((2 * Math.PI) / n) * (dayOfYear(month, day, year) - 1 + (utc - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = utc * 60 + eqTime + 4 * longitude;
  const H = (tst / 4 - 180) * DEG;
  const lat = latitude * DEG;
  let alt = Math.asin(clamp(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H), -1, 1));
  let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  az = ((az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a = alt / DEG;
  if (a > -1) alt += (1.02 / Math.tan((a + 10.3 / (a + 5.11)) * DEG) / 60) * DEG; // Saemundsson refraction
  const dir = new THREE.Vector3(-Math.cos(az) * Math.cos(alt), Math.sin(alt), -Math.sin(az) * Math.cos(alt)).normalize();
  return { dir, altitude: alt, azimuth: az, altitudeDeg: alt / DEG, azimuthDeg: az / DEG, declination: decl, eqTime, utcOffset: tz };
}

/**
 * Sun direction and altitude (kept from the stub API): solarPosition at 58.1° N.
 * @returns {{ dir: THREE.Vector3, altitude: number, azimuth: number }}
 */
export function sunPosition({ hour = 13, month = 6, day = 15 } = {}) {
  return solarPosition({ hour, month, day });
}

/**
 * Sunrise, sunset and solar noon (local clock hours, decimal) for a date. Sunrise/sunset at −0.833° (upper limb +
 * refraction). polarDay / polarNight at high latitudes.
 */
export function sunTimes({ month = 6, day = 15, latitude = SITE.latitude, longitude = SITE.longitude, year = SITE.year } = {}) {
  const tz = utcOffset(month, day, 12, year);
  const p = solarPosition({ hour: 12.5, month, day, latitude, longitude, year });
  const lat = latitude * DEG;
  const noon = (720 - 4 * longitude - p.eqTime + 60 * tz) / 60;
  const maxAltitudeDeg = 90 - Math.abs(latitude - p.declination / DEG);
  const cosH0 = (Math.sin(-0.833 * DEG) - Math.sin(lat) * Math.sin(p.declination)) / (Math.cos(lat) * Math.cos(p.declination));
  if (cosH0 <= -1) return { noon, sunrise: null, sunset: null, dayLength: 24, polarDay: true, polarNight: false, maxAltitudeDeg };
  if (cosH0 >= 1) return { noon, sunrise: null, sunset: null, dayLength: 0, polarDay: false, polarNight: true, maxAltitudeDeg };
  const H0 = Math.acos(cosH0) / DEG;
  return { noon, sunrise: noon - H0 / 15, sunset: noon + H0 / 15, dayLength: (2 * H0) / 15, polarDay: false, polarNight: false, maxAltitudeDeg };
}

/** Kasten–Young air mass. */
function airMass(hDeg) {
  const h = Math.max(0, hDeg);
  return 1 / (Math.sin(h * DEG) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/**
 * Outdoor daylight for a sun altitude (degrees): direct normal and diffuse horizontal illuminance (lux), colour
 * temperatures and the sky colour. Clear sky: Kasten–Young air mass extinction and a fitted diffuse curve;
 * overcast: Krochmann-like diffuse only. Twilight decays one decade per ~2.4°.
 */
export function daylight(hDeg, weather = 'clear') {
  const clear = weather !== 'overcast';
  let Edn = 0;
  let Edh;
  if (clear) {
    if (hDeg > -0.8) Edn = 127500 * Math.exp(-0.23 * airMass(hDeg)) * smoothstep(-0.8, 1.2, hDeg);
    Edh = hDeg >= 0 ? 600 + 15000 * Math.pow(Math.sin(hDeg * DEG), 0.6) : 600 * Math.pow(10, 0.42 * hDeg);
  } else {
    Edh = hDeg >= 0 ? 350 + 17000 * Math.sin(hDeg * DEG) : 350 * Math.pow(10, 0.42 * hDeg);
  }
  const Eglobal = Edh + Edn * Math.max(0, Math.sin(hDeg * DEG));
  const sunK = 1900 + 3600 * (1 - Math.exp(-Math.max(0, hDeg) / 9));
  let skyK;
  if (hDeg >= 12) skyK = clear ? 7400 : 6600;
  else if (hDeg >= 0) skyK = lerp(clear ? 5600 : 6200, clear ? 7400 : 6600, hDeg / 12);
  else skyK = lerp(clear ? 5600 : 6200, 11500, clamp(-hDeg / 6));
  return { Edn, Edh, Eglobal, sunK, skyK, clear };
}

// ---------------------------------------------------------------------------------------------------------------
// Terrain horizon: the hills around the river valley hide the low sun (fix-lighting r1: the photos at 08:27–08:30 on
// 18 October show no direct sun – it rises behind the ridge to the ESE, 082841/082843)

/**
 * Skyline seen from the windows, [compass azimuth°, terrain elevation°], measured on the photo backdrops
 * (public/img/utsikt sor.jpg and ost.jpg, .shots/fix-lighting-r1/skyline.mjs; the lower of the two where both see the
 * same hills). East ridge ≈ 10–12°, the valley gap toward SSE ≈ 2.5°, the far bank to the SW ≈ 5–6.5° (beyond
 * 200° the near trees hide the hills in both photos – they are TREES below). North of the east/west line nothing is
 * measured (the house itself and the hill behind it); 3° there.
 * room-spec `outside.horizon` (same format) overrides it.
 */
export const HORIZON = Object.freeze([
  [0, 3], [40, 3], [60, 6], [80, 10.1], [90, 10.2], [100, 11], [110, 11.8], [120, 11.3], [130, 10.3], [140, 8.8],
  [145, 8], [150, 5.7], [155, 4.1], [160, 3.1], [165, 3], [170, 2.5], [175, 2.4], [180, 4.3], [185, 4.6],
  [190, 4.9], [195, 5.6], [200, 6], [210, 6.5], [225, 6.5], [240, 6], [260, 5.5], [280, 4.5], [310, 3.5],
  [360, 3],
].map((p) => Object.freeze(p)));

/** The trees just west of the house (sor backdrop az +15..+66 ≈ compass 195–246, crowns up to ≈ 18–21°): the sun
 *  shines through their crowns, dimmed (deciduous, gaps), instead of being hidden. room-spec `outside.trees` overrides. */
export const TREES = Object.freeze({ from: 197, to: 248, top: 18, edgeDeg: 5, transmission: 0.5 });

/** Terrain elevation (degrees) toward a compass azimuth (degrees from north, clockwise). */
export function horizonElevation(azDeg, profile = HORIZON) {
  const p = profile?.length ? profile : HORIZON;
  const a = ((azDeg % 360) + 360) % 360;
  for (let i = 0; i < p.length - 1; i++) {
    const [a0, e0] = p[i], [a1, e1] = p[i + 1];
    if (a >= a0 && a <= a1) return a1 > a0 ? lerp(e0, e1, (a - a0) / (a1 - a0)) : e0;
  }
  // wrap between the last and the first entry
  const [aL, eL] = p[p.length - 1], [aF, eF] = p[0];
  const span = aF + 360 - aL;
  const t = span > 0 ? (((a - aL + 360) % 360) / span) : 0;
  return lerp(eL, eF, clamp(t));
}

/**
 * Share of the sun disc that reaches the house (0..1): 0 behind the hills, the tree transmission behind the trees west
 * of the house, 1 in the open sky. Soft over the sun's diameter and the ragged tree line of the ridge.
 */
export function sunVisibility(altDeg, azDeg, { horizon = HORIZON, trees = TREES } = {}) {
  const h = horizonElevation(azDeg, horizon);
  let v = smoothstep(h - 0.45, h + 0.75, altDeg);
  if (trees && v > 0) {
    const a = ((azDeg % 360) + 360) % 360;
    const e = trees.edgeDeg ?? 5;
    const inAz = smoothstep(trees.from - e, trees.from + e, a) * (1 - smoothstep(trees.to - e, trees.to + e, a));
    const below = 1 - smoothstep(trees.top - 2.5, trees.top + 1.5, altDeg);
    v *= 1 - inAz * below * (1 - (trees.transmission ?? 0.5));
  }
  return v;
}

const SKY_KEYS = [
  [-14, '#060b18'],
  [-8, '#0c1730'],
  [-4, '#283f69'],
  [-1, '#5b6f96'],
  [2, '#d9b48e'],
  [7, '#c3d1df'],
  [20, '#bcd1e6'],
];

/** Background sky colour (display hex) for a sun altitude. */
function skyHexFor(hDeg, clear) {
  const c = new THREE.Color();
  const keys = SKY_KEYS;
  if (hDeg <= keys[0][0]) c.set(keys[0][1]);
  else if (hDeg >= keys[keys.length - 1][0]) c.set(keys[keys.length - 1][1]);
  else {
    for (let i = 0; i < keys.length - 1; i++) {
      if (hDeg <= keys[i + 1][0]) {
        const t = (hDeg - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
        c.set(keys[i][1]).lerp(new THREE.Color(keys[i + 1][1]), t);
        break;
      }
    }
  }
  if (!clear) c.lerp(new THREE.Color(hDeg > 0 ? '#c4c9ce' : c.getHex()), 0.7);
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The room as radiosity patches + its low-poly copy for the environment map

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();

/** Point-in-polygon (even–odd) for plan points {x, y}. */
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function hexLinear(hex, fallback = '#bbbbbb') {
  const c = new THREE.Color();
  try {
    c.set(hex || fallback);
  } catch {
    c.set(fallback);
  }
  return c; // THREE.Color.set() converts sRGB hex to the linear working space
}

/**
 * Builds the room's patches (floor, ceilings, walls without their openings, glass, bulkheads) from the layout, the
 * patch-to-patch form factors (simple view-factor estimate, rows normalised in a closed room) and a scene of
 * unlit meshes (one per patch) for the PMREM environment.
 */
function buildRoomModel(layout) {
  const patches = [];
  const envScene = new THREE.Scene();
  envScene.name = 'lighting-env';
  const owned = [];
  const addMesh = (geo, patch) => {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, m);
    envScene.add(mesh);
    owned.push(geo, m);
    patch.meshes.push(mesh);
    return mesh;
  };
  const newPatch = (o) => {
    const p = { meshes: [], E: new THREE.Color(), Eday: new THREE.Color(), Esun: new THREE.Color(), B: new THREE.Color(), Bday: new THREE.Color(), L: new THREE.Color(), ...o };
    patches.push(p);
    return p;
  };

  // floor and ceilings: one patch per zone (kitchen, dining, sitting area, TV-stue) – with one floor patch the
  // kitchen and TV-stue lamps lit the whole floor of the environment map, so their light reached every wall as
  // bounce (fix-lighting r1). Albedo of the floor boards darkened by the furniture and rugs standing on them.
  const floorRho = hexLinear(layout.floor.color || '#b4a99c').multiplyScalar(FLOOR_CLUTTER);
  const zones = (layout.zones || []).filter((z) => z.polygon?.length >= 3 && z.area > 0.5);
  const zoneTotal = zones.reduce((t, z) => t + z.area, 0);
  const floorParts = zones.length && Math.abs(zoneTotal - layout.floor.area) < 0.15 * layout.floor.area
    ? zones.map((z) => ({ id: `floor:${z.id}`, polygon: z.polygon, area: z.area, centroid: z.centroid, contains: (x, zz) => pointInPoly(x, zz, z.polygon) }))
    : [{ id: 'floor', polygon: layout.floor.polygon, area: layout.floor.area, centroid: layout.floor.centroid, contains: (x, zz) => layout.isInside(x, zz) }];
  const floors = [];
  for (const part of floorParts) {
    const fp = newPatch({
      id: part.id, kind: 'floor', normal: new THREE.Vector3(0, 1, 0), area: part.area,
      center: new THREE.Vector3(part.centroid.x, 0, part.centroid.y), rho: floorRho.clone(),
      hit(o, d) {
        if (d.y > -1e-4) return null;
        const t = -o.y / d.y;
        const x = o.x + d.x * t, z = o.z + d.z * t;
        return part.contains(x, z) ? t : null;
      },
    });
    const shape = new THREE.Shape(part.polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    addMesh(g, fp);
    floors.push(fp);
  }
  const floor = floors[0];

  // ceilings (flat and sloped), split by the zones under them
  for (const c of layout.ceilings) {
    const under = zones.filter((z) => pointInPoly(z.centroid.x, z.centroid.y, c.polygon));
    const parts = under.length > 1 && Math.abs(under.reduce((t, z) => t + z.area, 0) - c.area) < 0.1 * c.area
      ? under.map((z) => ({ id: `ceiling:${c.id}:${z.id}`, polygon: z.polygon, area: z.area, centroid: z.centroid }))
      : [{ id: `ceiling:${c.id}`, polygon: c.polygon, area: c.area, centroid: c.centroid }];
    for (const part of parts) {
      const cx = part.centroid.x, cz = part.centroid.y;
      const e = 0.05;
      const dhdx = (c.heightAt(cx + e, cz) - c.heightAt(cx - e, cz)) / (2 * e);
      const dhdz = (c.heightAt(cx, cz + e) - c.heightAt(cx, cz - e)) / (2 * e);
      const normal = new THREE.Vector3(dhdx, -1, dhdz).normalize();
      const p = newPatch({
        id: part.id, kind: 'ceiling', normal, area: part.area / Math.abs(normal.y),
        center: new THREE.Vector3(cx, c.heightAt(cx, cz), cz), rho: hexLinear(c.paintHex), hit: () => null,
      });
      const shape = new THREE.Shape(part.polygon.map((q) => new THREE.Vector2(q.x, q.y)));
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(Math.PI / 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, c.heightAt(pos.getX(i), pos.getZ(i)));
      addMesh(g, p);
    }
  }
  const ceilingPatches = patches.filter((p) => p.kind === 'ceiling');

  // walls: room-side faces without their openings; dark cabinets in front of some walls
  const cabinet = hexLinear('#3a3b3d');
  for (const w of layout.walls) {
    const L = w.length;
    const prof = w.topProfile;
    let full = 0;
    for (let i = 0; i < prof.length - 1; i++) full += ((prof[i][1] + prof[i + 1][1]) / 2) * Math.max(0, prof[i + 1][0] - prof[i][0]);
    const holes = w.openings.reduce((s, o) => s + o.area, 0);
    let rho = hexLinear(w.paintHex);
    if (w.hiddenBehindCabinets) rho = cabinet.clone();
    else if (/kjokken/.test(w.id)) rho.lerp(cabinet, w.id === 'w-kjokken-ost' ? 0.55 : 0.2);
    const avgH = full / Math.max(1e-3, L);
    const start = new THREE.Vector3(w.start.x, 0, w.start.y);
    const p = newPatch({
      id: `wall:${w.id}`, kind: 'wall', wallId: w.id, normal: w.normal3.clone(), area: Math.max(0.05, full - holes),
      center: start.clone().addScaledVector(w.dir3, L / 2).setY(avgH / 2), rho,
      hit(o, d) {
        const dn = d.dot(w.normal3);
        if (dn > -1e-4) return null;
        const t = _v1.copy(start).sub(o).dot(w.normal3) / dn;
        if (t <= 0) return null;
        _v2.copy(o).addScaledVector(d, t);
        const u = _v3.copy(_v2).sub(start).dot(w.dir3);
        if (u < 0 || u > L || _v2.y < 0 || _v2.y > w.heightAt(u)) return null;
        for (const op of w.openings) if (u > op.u0 && u < op.u1 && _v2.y > op.sill && _v2.y < op.top) return null;
        return t;
      },
    });
    // env mesh: the wall outline (sloped top) in wall-local coordinates
    const outline = [new THREE.Vector2(0, 0), new THREE.Vector2(L, 0)];
    for (let i = prof.length - 1; i >= 0; i--) outline.push(new THREE.Vector2(Math.min(L, prof[i][0]), prof[i][1]));
    const shape = new THREE.Shape(outline);
    const g = new THREE.ShapeGeometry(shape);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(w.dir3, new THREE.Vector3(0, 1, 0), w.normal3).setPosition(start));
    addMesh(g, p);
    // openings: glass (dark, absorbs most of what reaches it) or the black hall door
    for (const op of w.openings) {
      const isGlass = op.type === 'window' || op.type === 'terrace-door';
      const gp = newPatch({
        id: `${isGlass ? 'glass' : 'door'}:${op.id}`, kind: isGlass ? 'glass' : 'door', openingId: op.id, normal: w.normal3.clone(),
        area: op.area, center: op.center.clone(), halfHeight: (op.height ?? 1) / 2, rho: isGlass ? new THREE.Color(0.06, 0.06, 0.06) : hexLinear(op.frame?.color || '#1d1e21'),
        hit(o, d) {
          const dn = d.dot(w.normal3);
          if (dn > -1e-4) return null;
          const t = _v1.copy(start).sub(o).dot(w.normal3) / dn;
          if (t <= 0) return null;
          _v2.copy(o).addScaledVector(d, t);
          const u = _v3.copy(_v2).sub(start).dot(w.dir3);
          return u > op.u0 && u < op.u1 && _v2.y > op.sill && _v2.y < op.top ? t : null;
        },
      });
      const q = new THREE.PlaneGeometry(op.width, op.height);
      q.applyMatrix4(new THREE.Matrix4().makeBasis(w.dir3, new THREE.Vector3(0, 1, 0), w.normal3).setPosition(op.center.clone().addScaledVector(w.normal3, 0.01)));
      addMesh(q, gp);
    }
  }

  // bulkheads close the gaps between the flat and the sloped ceilings (same radiance as the nearest ceiling)
  for (const b of layout.bulkheads) {
    const dir = new THREE.Vector3(b.end.x - b.start.x, 0, b.end.y - b.start.y);
    const len = dir.length();
    if (len < 0.05) continue;
    dir.normalize();
    const pts = [new THREE.Vector2(0, b.bottom), new THREE.Vector2(len, b.bottom), new THREE.Vector2(len, b.topAt(1) + 0.03), new THREE.Vector2(0, b.topAt(0) + 0.03)];
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
    g.applyMatrix4(new THREE.Matrix4().makeBasis(dir, new THREE.Vector3(0, 1, 0), b.faceNormal).setPosition(new THREE.Vector3(b.start.x, 0, b.start.y)));
    const mid = new THREE.Vector3((b.start.x + b.end.x) / 2, b.bottom, (b.start.y + b.end.y) / 2);
    let best = ceilingPatches[0];
    for (const c of ceilingPatches) if (c.center.distanceToSquared(mid) < best.center.distanceToSquared(mid)) best = c;
    if (best) addMesh(g, best);
  }

  // form factors: F[i][j] ∝ A_j cos_i cos_j / (r² + A_j/π), rows normalised (closed room)
  const n = patches.length;
  const F = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const pi = patches[i];
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const pj = patches[j];
      _v1.copy(pj.center).sub(pi.center);
      const r2 = _v1.lengthSq();
      if (r2 < 1e-6) continue;
      _v1.multiplyScalar(1 / Math.sqrt(r2));
      const ci = pi.normal.dot(_v1);
      const cj = -pj.normal.dot(_v1);
      if (ci <= 0.02 || cj <= 0.02) continue;
      const w = (pj.area * ci * cj) / (r2 + pj.area / Math.PI);
      F[i * n + j] = w;
      sum += w;
    }
    if (sum > 0) for (let j = 0; j < n; j++) F[i * n + j] /= sum;
  }
  const totalArea = patches.reduce((s, p) => s + p.area, 0);
  return { patches, F, envScene, owned, totalArea, floor, floors, floorArea: floors.reduce((t, p) => t + p.area, 0) };
}

/** Form factors F[i][j] ∝ A_j cos_i cos_j / (r² + A_j/π), rows normalised (closed room) – as in buildRoomModel. */
function formFactors(patches) {
  const n = patches.length;
  const F = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const pi = patches[i];
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const pj = patches[j];
      _v1.copy(pj.center).sub(pi.center);
      const r2 = _v1.lengthSq();
      if (r2 < 1e-6) continue;
      _v1.multiplyScalar(1 / Math.sqrt(r2));
      const ci = pi.normal.dot(_v1);
      const cj = -pj.normal.dot(_v1);
      if (ci <= 0.02 || cj <= 0.02) continue;
      const w = (pj.area * ci * cj) / (r2 + pj.area / Math.PI);
      F[i * n + j] = w;
      sum += w;
    }
    if (sum > 0) for (let j = 0; j < n; j++) F[i * n + j] /= sum;
  }
  return F;
}

/**
 * The radiosity model of a house room other than the living room (§4.4): its floor (minus the holes in it), its
 * ceilings (minus the stairwell cut-outs), its walls without their holes (own openings and those of their backOf
 * partner), the glass of its windows, and PORTALS – the doorways / openings to its neighbours and the stairwell – that
 * absorb what reaches them (ρ 0) and send in the neighbour's light (LightManager._recomputeRooms). Same patch shape as
 * buildRoomModel, world y (the room's floorY).
 * @param {object} layout
 * @param {object} room   layout.house room
 * @param {object[]} portalDefs  lightmask.portalRects(layout)
 */
function buildHouseRoomModel(layout, room, portalDefs) {
  const h = layout.house;
  const patches = [];
  const envScene = new THREE.Scene();
  envScene.name = `lighting-env:${room.id}`;
  const owned = [];
  const addMesh = (geo, patch) => {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, m);
    envScene.add(mesh);
    owned.push(geo, m);
    patch.meshes.push(mesh);
    return mesh;
  };
  const newPatch = (o) => {
    const p = { meshes: [], E: new THREE.Color(), Eday: new THREE.Color(), Esun: new THREE.Color(), B: new THREE.Color(), Bday: new THREE.Color(), L: new THREE.Color(), ...o };
    patches.push(p);
    return p;
  };
  const fy = room.floorY;
  const holes = (h.floorOpenings || []).filter((fo) => fo.levelId === room.levelId && fo.roomId === room.id);
  const holeArea = holes.reduce((s, fo) => s + fo.area, 0);
  const inHole = (x, z) => holes.some((fo) => fo.contains(x, z));

  // floor
  const floorHex = room.floor?.color || '#b4a99c';
  const floorRho = hexLinear(floorHex).multiplyScalar(FLOOR_CLUTTER);
  const fArea = Math.max(0.2, room.area - holeArea);
  const fc = room.centroid;
  const floor = newPatch({
    id: `floor:${room.id}`, kind: 'floor', normal: new THREE.Vector3(0, 1, 0), area: fArea,
    center: new THREE.Vector3(fc.x, fy, fc.y), rho: floorRho,
    hit(o, d) {
      if (d.y > -1e-4) return null;
      const t = (fy - o.y) / d.y;
      if (t <= 0) return null;
      const x = o.x + d.x * t, z = o.z + d.z * t;
      return room.contains(x, z) && !inHole(x, z) ? t : null;
    },
  });
  {
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
    for (const fo of holes) shape.holes.push(new THREE.Path(fo.polygon.map((p) => new THREE.Vector2(p.x, -p.y))));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, fy, 0);
    addMesh(g, floor);
  }

  // ceilings (flat or sloped, world y), minus the stairwell cut-outs
  const ceilings = (h.ceilings || []).filter((c) => c.roomId === room.id);
  const level = h.levelsById?.[room.levelId];
  const ceilList = ceilings.length ? ceilings : [{
    id: `c-${room.id}`, polygon: room.polygon, area: room.area, centroid: room.centroid, paintHex: '#e8e4dc',
    heightAt: () => level?.ceilingDefault ?? 2.4, floorY: fy, holes: [],
  }];
  for (const c of ceilList) {
    const cut = (c.holes || []).reduce((s, poly) => s + Math.abs(polyArea(poly)), 0);
    const cx = c.centroid.x, cz = c.centroid.y;
    const top = (x, z) => c.floorY + c.heightAt(x, z);
    const p = newPatch({
      id: `ceiling:${c.id}`, kind: 'ceiling', normal: new THREE.Vector3(0, -1, 0), area: Math.max(0.2, c.area - cut),
      center: new THREE.Vector3(cx, top(cx, cz), cz), rho: hexLinear(c.paintHex), hit: () => null,
    });
    // a ceiling under a roof (notes/tak.md) is cut along its folds, one plane per piece (wallkit surfaceGeometry)
    if (c.surface) {
      addMesh(surfaceGeometry(c.polygon, c.holes || [], c.surface), p);
      continue;
    }
    const shape = new THREE.Shape(c.polygon.map((q) => new THREE.Vector2(q.x, q.y)));
    for (const poly of c.holes || []) shape.holes.push(new THREE.Path(poly.map((q) => new THREE.Vector2(q.x, q.y))));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, top(pos.getX(i), pos.getZ(i)));
    addMesh(g, p);
  }

  // walls: room-side faces without their holes; the holes are glass (own windows), doors (closed leaf) or portals
  const portalIds = new Set(portalDefs.filter((q) => q.connects.includes(room.id)).map((q) => q.id));
  for (const wid of room.wallIds || []) {
    const w = h.wallsById?.[wid];
    if (!w || w.length < 0.05) continue;
    const L = w.length;
    const prof = w.topProfile;
    let full = 0;
    for (let i = 0; i < prof.length - 1; i++) full += ((prof[i][1] + prof[i + 1][1]) / 2) * Math.max(0, prof[i + 1][0] - prof[i][0]);
    const holeList = w.holes || [];
    const holesA = holeList.reduce((s, o) => s + Math.max(0, o.u1 - o.u0) * Math.max(0, o.top - o.sill), 0);
    const start = new THREE.Vector3(w.start.x, fy, w.start.y);
    const avgH = full / Math.max(1e-3, L);
    const p = newPatch({
      id: `wall:${w.id}`, kind: 'wall', wallId: w.id, normal: w.normal3.clone(), area: Math.max(0.05, full - holesA),
      center: start.clone().addScaledVector(w.dir3, L / 2).setY(fy + avgH / 2), rho: hexLinear(w.paintHex), floorY: fy,
      hit(o, d) {
        const dn = d.dot(w.normal3);
        if (dn > -1e-4) return null;
        const t = _v1.copy(start).sub(o).dot(w.normal3) / dn;
        if (t <= 0) return null;
        _v2.copy(o).addScaledVector(d, t);
        const u = _v3.copy(_v2).sub(start).dot(w.dir3);
        const y = _v2.y - fy;
        if (u < 0 || u > L || y < 0 || y > w.heightAt(u)) return null;
        for (const op of holeList) if (u > op.u0 && u < op.u1 && y > op.sill && y < op.top) return null;
        return t;
      },
    });
    const outline = [new THREE.Vector2(0, 0), new THREE.Vector2(L, 0)];
    for (let i = prof.length - 1; i >= 0; i--) outline.push(new THREE.Vector2(Math.min(L, prof[i][0]), prof[i][1]));
    const g = new THREE.ShapeGeometry(new THREE.Shape(outline));
    g.applyMatrix4(new THREE.Matrix4().makeBasis(w.dir3, new THREE.Vector3(0, 1, 0), w.normal3).setPosition(start));
    addMesh(g, p);
    for (const op of holeList) {
      const o = h.openingsById?.[op.openingId];
      if (!o) continue;
      const isGlass = o.type === 'window' || o.type === 'terrace-door';
      const width = op.u1 - op.u0, height = op.top - op.sill;
      if (width < 0.05 || height < 0.05) continue;
      const center = start.clone().addScaledVector(w.dir3, (op.u0 + op.u1) / 2).setY(fy + (op.sill + op.top) / 2);
      const portal = !isGlass && portalIds.has(o.id);
      const kind = isGlass ? 'glass' : portal ? 'portal' : 'door';
      const gp = newPatch({
        id: `${kind}:${o.id}`, kind, openingId: o.id, normal: w.normal3.clone(), area: width * height, center, halfHeight: height / 2,
        rho: isGlass ? new THREE.Color(0.06, 0.06, 0.06) : portal ? new THREE.Color(0, 0, 0) : hexLinear(o.frame?.color || '#1d1e21'),
        leafRho: hexLinear(o.door?.leafColor || o.frame?.color || '#1d1e21'),
        hit(oo, d) {
          const dn = d.dot(w.normal3);
          if (dn > -1e-4) return null;
          const t = _v1.copy(start).sub(oo).dot(w.normal3) / dn;
          if (t <= 0) return null;
          _v2.copy(oo).addScaledVector(d, t);
          const u = _v3.copy(_v2).sub(start).dot(w.dir3);
          const y = _v2.y - fy;
          return u > op.u0 && u < op.u1 && y > op.sill && y < op.top ? t : null;
        },
      });
      const q = new THREE.PlaneGeometry(width, height);
      q.applyMatrix4(new THREE.Matrix4().makeBasis(w.dir3, new THREE.Vector3(0, 1, 0), w.normal3).setPosition(center.clone().addScaledVector(w.normal3, 0.01)));
      addMesh(q, gp);
    }
  }

  // the stairwell: a horizontal portal in the floor (upper room) or the ceiling (lower room)
  for (const def of portalDefs) {
    if (def.kind !== 'hole' || !def.connects.includes(room.id)) continue;
    const upper = def.connects[0] === room.id;
    const y = upper ? fy : (ceilList[0] ? ceilList[0].floorY + ceilList[0].heightAt(def.center[0], def.center[2]) : def.center[1]);
    const area = 4 * def.halfU * def.halfV;
    const p = newPatch({
      id: `portal:${def.id}`, kind: 'portal', openingId: def.id, normal: new THREE.Vector3(0, upper ? 1 : -1, 0), area,
      center: new THREE.Vector3(def.center[0], y, def.center[2]), halfHeight: 0, rho: new THREE.Color(0, 0, 0), hit: () => null,
    });
    const g = new THREE.PlaneGeometry(2 * def.halfU, 2 * def.halfV);
    g.rotateX(upper ? -Math.PI / 2 : Math.PI / 2);
    g.translate(def.center[0], y + (upper ? 0.005 : -0.005), def.center[2]);
    addMesh(g, p);
  }

  const F = formFactors(patches);
  const totalArea = patches.reduce((s, p) => s + p.area, 0);
  return { patches, F, envScene, owned, totalArea, floor, floors: [floor], floorArea: floor.area, roomId: room.id };
}

/** Shoelace area of a polygon of Vector2 (signed). */
function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return a / 2;
}

/**
 * Splits a source's flux over the patches it can see: weight = approximate solid angle × emission lobe.
 * @param {THREE.Vector3} pos
 * @param {THREE.Vector3|null} dir   emission axis (null = isotropic)
 * @param {number} k                 lobe exponent: dot(dir, ω)^k (1 = Lambertian)
 * @param {(ω: THREE.Vector3) => number} [bias]
 * @returns {Float32Array} fractions summing to 1
 */
function fluxWeights(model, pos, dir, k = 1, bias = null, patchBias = null) {
  const n = model.patches.length;
  const w = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = model.patches[i];
    const pb = patchBias ? patchBias(p) : 1;
    if (!(pb > 0)) continue;
    _v1.copy(p.center).sub(pos);
    const r2 = Math.max(1e-4, _v1.lengthSq());
    _v1.multiplyScalar(1 / Math.sqrt(r2));
    const cosP = -p.normal.dot(_v1);
    if (cosP <= 0.01) continue;
    const omega = (p.area * cosP) / (r2 + p.area / (2 * Math.PI));
    let lobe = 1;
    if (dir) {
      const c = dir.dot(_v1);
      if (c <= 0) continue;
      lobe = Math.pow(c, k);
    }
    if (bias) lobe *= bias(_v1);
    w[i] = omega * lobe * pb;
    sum += w[i];
  }
  if (sum > 0) for (let i = 0; i < n; i++) w[i] /= sum;
  return w;
}

/** Share (0..1) of a patch's area that lies below the height y (floor 1, ceilings 0, walls by their height range). */
function patchShareBelow(p, y) {
  if (p.kind === 'floor') return 1;
  if (p.kind === 'ceiling') return 0;
  const top = p.kind === 'wall' ? 2 * p.center.y : p.center.y + (p.halfHeight ?? 0.5);
  const bottom = p.kind === 'wall' ? 0 : p.center.y - (p.halfHeight ?? 0.5);
  return clamp((y - bottom) / Math.max(1e-3, top - bottom));
}

/** Lobe exponent whose half-intensity angle is `halfAngle` (radians). */
function lobeExponent(halfAngle) {
  const c = Math.cos(clamp(halfAngle, 0.05, 1.45));
  return Math.max(1, Math.log(0.5) / Math.log(c));
}

/** Gauss–Seidel radiosity in RGB: B = ρ ⊙ (E + F·B). Writes p[outKey] (exitance, lux). */
function solveRadiosity(model, inKey, outKey, iterations = 10) {
  const { patches, F } = model;
  const n = patches.length;
  for (const p of patches) p[outKey].copy(p[inKey]).multiply(p.rho);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < n; j++) {
        const f = F[i * n + j];
        if (!f) continue;
        const B = patches[j][outKey];
        r += f * B.r;
        g += f * B.g;
        b += f * B.b;
      }
      const p = patches[i];
      p[outKey].setRGB((p[inKey].r + r) * p.rho.r, (p[inKey].g + g) * p.rho.g, (p[inKey].b + b) * p.rho.b);
    }
  }
}

/** Surface area of a mesh in world units (cached), for emissive luminance. */
function meshArea(mesh) {
  if (mesh.userData.__lightArea != null) return mesh.userData.__lightArea;
  const g = mesh.geometry;
  const pos = g?.attributes?.position;
  if (!pos) return 0.01;
  mesh.updateWorldMatrix(true, false);
  const s = Math.cbrt(Math.abs(mesh.matrixWorld.determinant())) || 1;
  const idx = g.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  const tri = (i0, i1, i2) => {
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1).sub(a);
    c.fromBufferAttribute(pos, i2).sub(a);
    area += b.cross(c).length() / 2;
  };
  if (idx) for (let i = 0; i + 2 < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  else for (let i = 0; i + 2 < pos.count; i += 3) tri(i, i + 1, i + 2);
  area *= s * s;
  if (mesh.isInstancedMesh) area *= mesh.count;
  mesh.userData.__lightArea = Math.max(1e-4, area);
  return mesh.userData.__lightArea;
}

/**
 * Effective solid angle of a three.js SpotLight (∫ attenuation dΩ): full inside angle·(1 − penumbra), then
 * smoothstep in cos θ out to the cone (which integrates to half of that band), so lumens stay lumens at any penumbra.
 */
function spotSolidAngle(angle, penumbra = 0) {
  const a = clamp(angle, 0.01, Math.PI / 2);
  const inner = Math.cos(a * (1 - clamp(penumbra)));
  const outer = Math.cos(a);
  return 2 * Math.PI * ((1 - inner) + 0.5 * (inner - outer));
}

// ---------------------------------------------------------------------------------------------------------------
// LightManager

/**
 * All lighting of the home (ARCHITECTURE §10). createHome makes one; SceneSync drives it from the design.
 *
 *   new LightManager({ scene, renderer, camera, home, settings, quality })
 *   setTime({ hour, month, day })   setMode('auto'|'day'|'evening'|'night')   setExposure(multiplier)
 *   setItemLights(uid, lights|null) setBuiltIn(groupId, { on, dimmer } | null)  setWindowTransmission(windowId, t)
 *   builtInGroups: [{ id, label, lumens }]   requestShadowUpdate()   update(dt, camera)   render(renderer, scene, camera)
 *   info() → sun / daylight / lamp numbers for the UI   groupState(id) → { on, dimmer, auto }   itemLightUids()
 *   cameraRoomId   roomsInfo()   setOverviewLevel('hoved'|'kjeller'|null) (orbit / plan: one value per level, §4.3)
 *   slotColor(candidate) → the colour its light slot gets (white balance incl. its room's relative balance)
 *   events: on('change', fn) → off   (after every recompute; LightPanel listens)
 *
 * Settings read (persisted, not part of the design): 'sunLatitude' (default 58.1), 'lightWeather' ('clear'|'overcast').
 */
export class LightManager {
  /**
   * @param {{ scene: THREE.Scene, renderer?: THREE.WebGLRenderer, camera?: THREE.Camera, home?: object, settings?: object, quality?: object }} o
   */
  constructor({ scene, renderer, camera, home, settings, quality }) {
    this.scene = scene;
    this.renderer = renderer || null;
    this.camera = camera || null;
    this.home = home || null;
    this.settings = settings || null;
    this.quality = quality || {};
    const level = PROFILES[this.quality.level] ? this.quality.level : 'medium';
    this.profile = { ...PROFILES[level], shadowMap: this.quality.shadowMapSize ?? PROFILES[level].shadowMap };
    this.level = level;
    this.root = new THREE.Group();
    this.root.name = 'lighting';
    this.root.userData.noCollide = true;
    scene.add(this.root);

    this.time = { hour: 13, month: 6, day: 15 };
    this.mode = 'auto';
    this.exposure = 1;
    this._transmission = {};
    this._builtInState = new Map(); // groupId → { on, dimmer }
    this._items = new Map(); // uid → candidates[]
    this._listeners = new Set();
    this._dirty = true;
    this._envDirty = true;
    this._envAt = -1e9;
    this._clock = 0;
    this._S = null; // current scene scale (null = not yet set → snap)
    this._Starget = 1;
    this._Senv = 1;
    this._wb = new THREE.Color(1, 1, 1);
    this._wbTarget = new THREE.Color(1, 1, 1);
    this._wbReady = false;
    this._selectAt = -1e9;
    this._lastCamPos = new THREE.Vector3(1e9, 0, 0);
    this._renderCamera = camera || null;
    this._defaultLampsOn = false;
    this._camRoomId = LIVING_ID;
    this._camLevelId = 'hoved';
    this._camOutside = false; // walking outside the house (forecourt, terrace): the outdoor lamps compete for slots
    this._overview = null; // setOverviewLevel: the level an overview (orbit / plan) shows, else null
    this._wbRel = new Map(); // roomId → white balance of that room relative to the camera's (HOUSE.wbLocal)
    this._worlds = new Map();
    this._roomWindows = [];
    this._houseLamps = [];
    this._sunPassPending = false;
    this._slotShadowOnly = false;
    this._roomEaseUntil = -1e9;
    this._traceDir = new THREE.Vector3();
    this._ambCol = new THREE.Color();
    this.stats = {};

    const layout = home?.layout;
    this.layout = layout || null;
    // every group of the house: the living room's six (layout.lightGroups, same order and dimmers as before), then the
    // data groups (§4.10) with their room, start dimmer and auto rule
    const groupList = layout?.house?.lightGroups?.length ? layout.house.lightGroups : layout?.lightGroups || [];
    this.builtInGroups = groupList.map((g) => ({
      id: g.id, label: g.label, lumens: 0, dimmer: clamp(g.dimmer ?? 1), roomId: g.roomId === undefined ? LIVING_ID : g.roomId,
      levelId: g.levelId ?? null, dimmable: g.dimmable !== false, auto: g.auto ?? null,
    }));
    this._groupsById = Object.fromEntries(this.builtInGroups.map((g) => [g.id, g]));
    this._livingGroupIds = new Set((layout?.lightGroups || []).map((g) => g.id));
    this._defaultDimmer = Object.fromEntries(this.builtInGroups.map((g) => [g.id, g.dimmer]));
    this.center = new THREE.Vector3(3.5, 1.2, 6);
    if (layout?.bounds) {
      const b = layout.bounds;
      this.center.set((b.minX + b.maxX) / 2, 1.2, (b.minZ + b.maxZ) / 2);
    }

    // renderer: physical lights, PBR Neutral tone mapping (true base colours, amber lamp light), exposure folded into the light values
    // dev URL params (sandbox/game): &tm=neutral|agx|aces  &key=0.21  &ao=0|1
    let dev = null;
    try {
      dev = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    } catch {
      dev = null;
    }
    this._key = Number(dev?.get('key')) || KEY.mid;
    const devNum = (k, d) => (dev?.has(k) && Number.isFinite(Number(dev.get(k))) ? Number(dev.get(k)) : d);
    this._wbParams = { day: devNum('wbd', WB.day), dayAlone: devNum('wba', WB.dayAlone), lamps: devNum('wbl', WB.lamps), lampsEvening: devNum('wbe', WB.lampsEvening), pull: devNum('wbp', WB.pull) };
    if (dev?.has('ao')) this.profile.ao = dev.get('ao') === '1';
    if (dev?.has('pools')) {
      // &pools=point,spot,rect,spotShadows (performance tests)
      const [pp, sp, rp, ss] = dev.get('pools').split(',').map(Number);
      Object.assign(this.profile, { point: pp ?? this.profile.point, spot: sp ?? this.profile.spot, rect: rp ?? this.profile.rect, spotShadows: ss ?? this.profile.spotShadows });
    }
    const tm = { neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping }[dev?.get('tm')] ?? TONE_MAPPING;
    if (renderer) {
      renderer.toneMapping = tm;
      renderer.toneMappingExposure = 1;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      // the light masks add ~200 fragment uniform vectors to every lit material: a GPU with too few (many mobiles have
      // 256) would fail to compile them and draw black – it gets three's plain lighting instead (before the first
      // compile: the home's scene is compiled after this). &lm=0 does the same (comparisons).
      if (lightMask.available && dev?.get('lm') === '0') lightMask.uninstall('lm=0');
      else if (lightMask.available && !lightMask.fits(renderer)) lightMask.uninstall('gpu');
    }
    if (!rectAreaReady) {
      RectAreaLightUniformsLib.init(); // LTC tables, once per page
      rectAreaReady = true;
    }

    this._buildSun();
    this._buildPools();
    this._model = layout ? buildRoomModel(layout) : null;
    if (this._model) this._model.roomId = LIVING_ID;
    this._buildHouse();
    this._buildWindows();
    this._buildBuiltIns();
    this._buildHouseLamps();
    this._initEnvironment();

    this._onSettings = ({ key }) => {
      if (key === 'sunLatitude' || key === 'lightWeather') this._markDirty();
    };
    settings?.on?.('change', this._onSettings);
    this._recompute();
  }

  // ---- public API ------------------------------------------------------------------------------------------

  /** Sun for a date/hour (local clock time). */
  setTime({ hour, month, day } = {}) {
    if (hour != null && Number.isFinite(+hour)) this.time.hour = clamp(+hour, 0, 24);
    if (month != null && Number.isFinite(+month)) this.time.month = clamp(Math.round(+month), 1, 12);
    if (day != null && Number.isFinite(+day)) this.time.day = clamp(Math.round(+day), 1, 31);
    this._markDirty();
  }

  /** 'auto' (from the clock) | 'day' (daylight, the sun within the day) | 'evening' (blue hour) | 'night'. */
  setMode(mode) {
    this.mode = ['auto', 'day', 'evening', 'night'].includes(mode) ? mode : 'auto';
    this._markDirty();
  }

  /** Exposure multiplier (design env.exposure; 1 = automatic exposure). */
  setExposure(v) {
    this.exposure = clamp(Number.isFinite(+v) ? +v : 1, 0.05, 8);
    this._markDirty();
  }

  /**
   * Item lights in world coordinates (SceneSync converts the model's local lights).
   * @param {string} uid
   * @param {Array<{ type: 'point'|'spot', position: THREE.Vector3, direction?: THREE.Vector3, angle?: number, penumbra?: number,
   *   colorK: number, lumens: number, on: boolean, dimmer: number, emissiveMeshes?: THREE.Mesh[] }>|null} lights
   */
  setItemLights(uid, lights) {
    const old = this._items.get(uid);
    if (old) for (const c of old) this._releaseCandidate(c);
    this._items.delete(uid);
    if (lights?.length) {
      const list = lights.flatMap((l, i) => this._itemCandidate(uid, i, l));
      this._items.set(uid, list);
    }
    this._markDirty();
  }

  /**
   * Built-in group on/off and dimmer; null = back to the default (on/off by the time of day, the group's own dimmer).
   * `{ auto: true, dimmer }` keeps on/off by the time of day at another dimmer (PhotoCompare: the photos' lamps).
   */
  setBuiltIn(groupId, state) {
    if (!state) this._builtInState.delete(groupId);
    else {
      const cur = this._builtInState.get(groupId) || { on: this._autoOnFor(groupId), dimmer: this._groupDimmer(groupId) };
      this._builtInState.set(groupId, { on: state.on ?? cur.on, dimmer: clamp(state.dimmer ?? cur.dimmer), auto: state.auto === true });
    }
    this._markDirty();
  }

  /** Effective state of a built-in group: { on, dimmer, auto } (auto = on/off follows the time of day). */
  groupState(groupId) {
    const s = this._builtInState.get(groupId);
    if (!s) return { on: this._autoOnFor(groupId), dimmer: this._groupDimmer(groupId), auto: true };
    return { on: s.auto ? this._autoOnFor(groupId) : s.on, dimmer: s.dimmer, auto: s.auto };
  }

  /**
   * On/off of a group by the time of day (§4.5). The living room's groups follow the living room's daylight as before;
   * a data group follows its `auto`: 'on' (rooms without windows: on in auto), 'off' (storerooms), 'evening' (entrance,
   * outside: when the sun is down), 'dark' / none (its room's own daylight on the floor). «Dagslys» turns all of them
   * off, «Kveldslys» / «Natt» all on but the 'off' ones.
   */
  _autoOnFor(groupId) {
    const g = this._groupsById?.[groupId];
    if (!g || this._livingGroupIds.has(groupId) || g.roomId === LIVING_ID) return this._defaultLampsOn;
    const rule = g.auto ?? 'dark';
    if (rule === 'off') return false;
    if (this.mode === 'day') return false;
    if (this.mode === 'evening' || this.mode === 'night') return true;
    if (rule === 'on') return true;
    if (rule === 'evening') return this._outdoorDark ?? false;
    const w = g.roomId ? this._worlds.get(g.roomId) : null;
    return w ? !!w.autoOn : this._defaultLampsOn;
  }

  /** The room the camera is in (drives exposure, white balance and the environment map). */
  get cameraRoomId() {
    return this._camRoomId;
  }

  /** Rooms and their numbers for the UI: [{ id, name, levelId, groups: [groupId], south, Lkey, daylightLux, autoOn }]. */
  roomsInfo() {
    const out = [];
    for (const [id, w] of this._worlds) {
      out.push({
        id, name: w.room?.name ?? id, levelId: w.room?.levelId ?? 'hoved', south: !!w.south,
        groups: this.builtInGroups.filter((g) => (g.roomId ?? null) === id).map((g) => g.id),
        Lkey: w.living ? this._livingRes?.Lkey ?? null : w.Lkey ?? null, daylightLux: Math.round(w.living ? this._livingRes?.dayFloorLux ?? 0 : w.dayFloorLux ?? 0),
        autoOn: w.living ? this._defaultLampsOn : !!w.autoOn,
      });
    }
    return out;
  }

  /** The dimmer a built-in group starts at (layout LIGHT_GROUPS). */
  _groupDimmer(groupId) {
    return this._defaultDimmer[groupId] ?? 1;
  }

  /** Daylight share let through a window (0..1) by its shading. */
  setWindowTransmission(windowId, t) {
    this._transmission[windowId] = clamp(Number.isFinite(+t) ? +t : 1);
    this._markDirty();
  }

  /** Re-render the shadow maps on the next frame (they are static otherwise). */
  requestShadowUpdate() {
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    if (this.sun) this.sun.shadow.needsUpdate = true;
    this._slotShadowOnly = false;
    for (const s of this._pool?.spot || []) if (s.shadowed) s.light.shadow.needsUpdate = true;
  }

  /**
   * The sun's shadow map (the sun moved: slot = null), or only a spot slot's map (it got another lamp) – the sun's
   * map is not redrawn for that any more (sun.shadow.autoUpdate is off, §4.6).
   */
  _requestSunShadow(slot = null) {
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    if (slot) {
      if (slot.shadowed) slot.light.shadow.needsUpdate = true;
      if (!this.sun.shadow.needsUpdate) this._slotShadowOnly = true;
    } else {
      this.sun.shadow.needsUpdate = true;
      this._slotShadowOnly = false;
    }
  }

  /** Uids of design items that currently have lights. */
  itemLightUids() {
    return [...this._items.keys()].filter((u) => u !== '__wall');
  }

  /** Listen to recomputes (time, lamps, shading …). @returns {() => void} */
  on(name, fn) {
    if (name !== 'change') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * Numbers for the UI: sun, daylight, sunrise/sunset, lamps.
   * @returns {object}
   */
  info() {
    return { ...this._info };
  }

  /** Every frame: exposure easing, the light budget, light values. */
  update(dt = 0, camera = this.camera) {
    this._clock += dt;
    const camNow = this._renderCamera || camera;
    if (this._worlds.size > 1) {
      this._updatePortals();
      this._trackCamera(camNow);
    }
    if (this._dirty) this._recompute();
    // ease the scene scale (eye adaptation): ~0.25 s; slower for HOUSE.roomEase after a room change
    const easing = this._clock < this._roomEaseUntil;
    if (this._S == null) this._S = this._Starget;
    else if (dt > 0) {
      const k = 1 - Math.exp(-dt / (easing ? 0.5 : 0.25));
      const ls = Math.log(this._S) + (Math.log(this._Starget) - Math.log(this._S)) * k;
      this._S = Math.exp(ls);
      if (Math.abs(Math.log(this._S / this._Starget)) < 1e-3) this._S = this._Starget;
    }
    if (this._sunShadowPending && (this._clock - (this._sunShadowAt ?? -1e9) >= SUN_SHADOW_INTERVAL || dt === 0)) {
      this._sunShadowPending = false;
      this._sunShadowAt = this._clock;
      this._requestSunShadow();
    }
    // ease the white balance like the exposure (~0.4 s)
    if (dt > 0 && this._wbReady) {
      const w = this._wb, t = this._wbTarget;
      const d = Math.abs(w.r - t.r) + Math.abs(w.g - t.g) + Math.abs(w.b - t.b);
      if (d > 1e-4) {
        w.lerp(t, d < 2e-3 ? 1 : 1 - Math.exp(-dt / (easing ? 0.6 : 0.4)));
        this._applyDirty = true;
      }
    } else if (dt === 0 && this._wbReady) this._wb.copy(this._wbTarget);
    const cam = this._renderCamera || camera;
    this._budget(cam, dt);
    if (this._ambTarget != null && this._ambNow != null && Math.abs(this._ambNow - this._ambTarget) > 0.005 * (this._ambTarget + 0.01)) {
      this._ambNow += (this._ambTarget - this._ambNow) * (dt > 0 ? 1 - Math.exp(-dt / 0.3) : 1);
      this._applyDirty = true;
    } else if (this._ambTarget != null) this._ambNow = this._ambTarget;
    this._apply(dt);
  }

  /**
   * Renders a frame (Game and the sandbox call this instead of renderer.render): environment refresh when needed,
   * then the scene straight to the screen, with GTAO multiplied on top on «høy».
   */
  render(renderer, scene, camera) {
    this._renderCamera = camera;
    if (this._S == null) this.update(0, camera);
    this._maybeBuildEnv(renderer);
    // the sun's map renders only when flagged (autoUpdate off): an outside request (shading.js blinds set
    // renderer.shadowMap.needsUpdate) still redraws it, a spot slot that only changed lamp does not
    const sm = renderer.shadowMap;
    if (sm?.needsUpdate && !this._slotShadowOnly) this.sun.shadow.needsUpdate = true;
    if (sm?.enabled && sm.needsUpdate && this.sun.castShadow && this.sun.shadow.needsUpdate) this.stats.sunPasses = (this.stats.sunPasses || 0) + 1;
    this._slotShadowOnly = false;
    // the scene goes straight to the screen (tone mapping in the materials, so the unlit photo backdrops stay
    // untouched); ambient occlusion is multiplied on top afterwards. The light masks only for this render, and only
    // when they can change something (_masksWanted)
    const masks = !!this._table && this._masksWanted();
    this.stats.masks = masks;
    if (masks) lightMask.flush(this._table.byId[this._camRoomId]?.bit ?? 0);
    lightMask.setEnabled(masks);
    try {
      renderer.render(scene, camera);
    } finally {
      lightMask.setEnabled(false);
    }
    if (this.profile.ao && camera?.isPerspectiveCamera) this._renderAO(renderer, scene, camera);
  }

  /**
   * Whether the light masks can change what is seen. Not with the camera's room closed (every door of it shut, no open
   * opening): all that is seen then lies in that room or outside, where every slot passes anyway (only that room's
   * lamps compete for slots), so the frame is identical without them – and the box and slot loops cost ~30 % of it.
   * On in an overview, outside the house and as soon as a portal of the camera's room opens (a crack is enough).
   */
  _masksWanted() {
    if (this._overview || this._camOutside) return true;
    const id = this._camRoomId;
    const g = this._gainsNow;
    if (!this._worlds.has(id) || !this._portalDefs?.length || !g) return true;
    for (let i = 0; i < this._portalDefs.length; i++) if (g[i] > 1e-4 && this._portalDefs[i].connects.includes(id)) return true;
    return false;
  }

  dispose() {
    this.settings?.off?.('change', this._onSettings);
    this.root.removeFromParent();
    if (this.scene.environment === this._envRT?.texture) this.scene.environment = null;
    this._envRT?.dispose();
    for (const w of this._worlds.values()) {
      if (w.env.rt && w.env.rt !== this._envRT) w.env.rt.dispose();
      if (!w.living) for (const o of w.model?.owned || []) o.dispose?.();
    }
    this._envCube?.dispose();
    this._pmrem?.dispose();
    for (const o of this._model?.owned || []) o.dispose?.();
    this.sun.shadow.map?.dispose();
    for (const s of this._pool.spot) s.light.shadow?.map?.dispose();
    for (const r of this._pool.rect) r.light.dispose?.();
    this._gtao?.dispose?.();
    this._listeners.clear();
  }

  // ---- construction ----------------------------------------------------------------------------------------

  _buildSun() {
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.name = 'sun';
    const r = this.renderer;
    sun.castShadow = !!(r ? r.shadowMap.enabled : true) && this.quality.shadows !== false;
    const sm = this.profile.shadowMap;
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.012;
    sun.shadow.radius = this.profile.pcf;
    // rendered only when flagged (render(): the sun moved, the scene changed, an outside request such as a blind)
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    sun.position.set(20, 20, 0);
    sun.target.position.copy(this.center);
    this.root.add(sun, sun.target);
    this.sun = sun;
    this.ambient = new THREE.AmbientLight(0xffffff, 0);
    this.ambient.name = 'ambient-fill';
    this.root.add(this.ambient);
    // the room box the shadow camera must cover (receivers + the walls/ceiling between them and the sun): per level of
    // the camera (§4.6) – the ground floor's is the living room's box as before
    this._shadowBox = this._shadowBoxFor('hoved');
    this._sunKey = '';
  }

  /** Shadow-camera box of a level: 'hoved' = the living room's bounds as before; the basement its rooms, y −2.9…0. */
  _shadowBoxFor(levelId) {
    const lb = levelId !== 'hoved' ? this.layout?.house?.levelBounds?.(levelId) : null;
    if (lb && Number.isFinite(lb.minX) && lb.maxX > lb.minX) {
      return new THREE.Box3(new THREE.Vector3(lb.minX - 0.35, BASEMENT_SHADOW_Y[0], lb.minZ - 0.35), new THREE.Vector3(lb.maxX + 0.35, BASEMENT_SHADOW_Y[1], lb.maxZ + 0.35));
    }
    const b = this.layout?.bounds ?? { minX: 0, maxX: 7, minZ: 0, maxZ: 12 };
    return new THREE.Box3(new THREE.Vector3(b.minX - 0.35, -0.05, b.minZ - 0.35), new THREE.Vector3(b.maxX + 0.35, 3.15, b.maxZ + 0.35));
  }

  /** The camera changed level: refit the sun's shadow camera (and GTAO's box) to that level and redraw the map. */
  _setShadowLevel(levelId) {
    this._shadowBox = this._shadowBoxFor(levelId);
    this._sunKey = '';
    this._setSunMask(levelId);
    if (this._sunPhys > 0 && this._sunDir) this._placeSun(this._sunDir);
    if (this._gtao) this._gtao.setSceneClipBox(this._aoBoxFor(levelId));
  }

  /**
   * The sun lights only the rooms of the level its shadow box covers (+ OUTSIDE, and the stairwell's box that belongs
   * to both levels): a basement room seen from the hall through the stairwell (or the hall from the basement stair)
   * lies outside the shadow camera and would get unshadowed sun. The living room keeps its bit: unchanged.
   */
  _setSunMask(levelId) {
    const t = this._table;
    if (!t) return;
    let bits = t.outsideBit;
    for (const r of t.rooms) if ((r.levelId ?? 'hoved') === levelId && r.index !== t.outside) bits |= r.bit;
    this._sunBits = bits;
    lightMask.setSun(bits);
  }

  /** GTAO's clip box: the living room's as before on the ground floor, the basement's below. */
  _aoBoxFor(levelId) {
    const lb = levelId !== 'hoved' ? this.layout?.house?.levelBounds?.(levelId) : null;
    if (lb && Number.isFinite(lb.minX) && lb.maxX > lb.minX) return new THREE.Box3(new THREE.Vector3(lb.minX - 0.4, lb.minY - 0.2, lb.minZ - 0.4), new THREE.Vector3(lb.maxX + 0.4, lb.maxY + 0.3, lb.maxZ + 0.4));
    const bb = this.layout?.bounds;
    return bb ? new THREE.Box3(new THREE.Vector3(bb.minX - 0.4, -0.2, bb.minZ - 0.4), new THREE.Vector3(bb.maxX + 0.4, 3.3, bb.maxZ + 0.4)) : null;
  }

  /** Fixed light pools (counts never change → no shader recompiles when lamps go on/off). */
  _buildPools() {
    const P = this.profile;
    const shadowsOn = !!(this.renderer ? this.renderer.shadowMap.enabled : true) && this.quality.shadows !== false;
    this._pool = { point: [], spot: [], rect: [] };
    for (let i = 0; i < P.point; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 0, 2);
      l.name = `pool-point-${i}`;
      this.root.add(l);
      this._pool.point.push({ light: l, cand: null, kind: 'point' });
    }
    for (let i = 0; i < P.spot; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.5, 2);
      l.name = `pool-spot-${i}`;
      const shadowed = shadowsOn && i < P.spotShadows;
      l.castShadow = shadowed;
      if (shadowed) {
        // static: re-rendered only when the scene changes (requestShadowUpdate) or the slot gets another lamp – not
        // when the sun moves (the clock slider) or a blind animates (shading.js sets the global flag for the sun)
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = true;
        l.shadow.mapSize.set(P.spotShadowMap, P.spotShadowMap);
        l.shadow.camera.near = 0.05;
        l.shadow.camera.far = 7;
        l.shadow.bias = -0.0006;
        l.shadow.normalBias = 0.008;
        l.shadow.radius = 2.5;
      }
      this.root.add(l, l.target);
      this._pool.spot.push({ light: l, cand: null, kind: 'spot', shadowed });
    }
    for (let i = 0; i < P.rect; i++) {
      const l = new THREE.RectAreaLight(0xffffff, 0, 0.1, 0.1);
      l.name = `pool-rect-${i}`;
      l.position.set(this.center.x, -50, this.center.z);
      this.root.add(l);
      this._pool.rect.push({ light: l, cand: null, kind: 'rect' });
    }
    // three's uniform order of the lights of one kind (WebGLLights: shadow-casting first, stable otherwise) = the index
    // of the slot's mask in lightmask.js
    for (const kind of ['point', 'spot', 'rect']) {
      const list = this._pool[kind];
      [...list.filter((s) => s.light.castShadow), ...list.filter((s) => !s.light.castShadow)].forEach((s, i) => (s.shaderIndex = i));
    }
  }

  // ---- the house (§4): room table, portals, the models of the other rooms --------------------------------------

  _buildHouse() {
    const h = this.layout?.house;
    if (!h || !this._model || !lightMask.available) return;
    this._table = buildRoomTable(this.layout);
    this._portalDefs = portalRects(this.layout);
    lightMask.setRooms(this._table);
    for (let i = 0; i < 16; i++) lightMask.setRoomAsIs(i);
    this._roomFlat = [];
    this._setSunMask(this._camLevelId);
    const living = h.roomsById?.[LIVING_ID] ?? { id: LIVING_ID, name: 'Stue/kjøkken', levelId: 'hoved' };
    this._worlds.set(LIVING_ID, {
      id: LIVING_ID, living: true, room: living, model: this._model, windows: [], lamps: [], lampBounce: LAMP_BOUNCE,
      env: { rt: null, Senv: 1, dirty: true }, south: true,
    });
    for (const room of h.rooms || []) {
      if (room.hud || room.id === LIVING_ID || !(room.polygon?.length >= 3) || !this._table.byId[room.id]) continue;
      let model;
      try {
        model = buildHouseRoomModel(this.layout, room, this._portalDefs);
      } catch (err) {
        console.warn(`[lighting] room ${room.id}: no light model`, err);
        continue;
      }
      // portal patches: their neighbour and the Lambertian weights of what they send into the room
      for (const p of model.patches) {
        if (p.kind !== 'portal') continue;
        const def = this._portalDefs.find((q) => q.id === p.openingId);
        p.portal = def ?? null;
        p.neighbour = def ? def.connects.find((id) => id !== room.id) ?? null : null;
        p.portalWeights = fluxWeights(model, p.center.clone().addScaledVector(p.normal, 0.05), p.normal, 1);
      }
      this._worlds.set(room.id, {
        id: room.id, living: false, room, model, windows: [], lamps: [], lampBounce: roomLampBounce(room.area),
        probe: this._probeFor(room), env: { rt: null, Senv: 1, dirty: true }, south: false,
        M: new THREE.Color(), Mday: new THREE.Color(), Lkey: 0.02, dayFloorLux: 0, autoOn: false, lampFlux: 0,
        wbT: new THREE.Color(1, 1, 1), wbK: null, wbInfo: null,
      });
    }
    // coupling order: breadth-first from the living room over the portals (stue → gang → bad, soverom, kjellergang → …)
    const order = [];
    const seen = new Set([LIVING_ID]);
    let front = [LIVING_ID];
    while (front.length) {
      const next = [];
      for (const id of front) {
        for (const q of this._portalDefs) {
          if (!q.connects.includes(id)) continue;
          const o = q.connects.find((x) => x !== id);
          if (!o || seen.has(o) || !this._worlds.has(o)) continue;
          seen.add(o);
          order.push(o);
          next.push(o);
        }
      }
      front = next;
    }
    for (const id of this._worlds.keys()) if (id !== LIVING_ID && !seen.has(id)) order.push(id);
    this._roomOrder = order;
    this._doorsById = null;
    this._portalState = '';
  }

  /** Probe of a room's environment map: its centroid at 1.45 m, the gang's fixed spot (2.6; 1.45; 3.4), off any hole. */
  _probeFor(room) {
    const y = room.floorY + 1.45;
    if (room.id === 'gang') return new THREE.Vector3(2.6, y, 3.4);
    const holes = (this.layout.house.floorOpenings || []).filter((fo) => fo.roomId === room.id);
    const ok = (x, z) => room.contains(x, z) && !holes.some((fo) => fo.contains(x, z));
    if (ok(room.centroid.x, room.centroid.y)) return new THREE.Vector3(room.centroid.x, y, room.centroid.y);
    let best = null, bestA = 0;
    for (const p of room.polygon) for (const q of room.polygon) {
      const x = (p.x + q.x) / 2, z = (p.y + q.y) / 2;
      const a = Math.abs((p.x - q.x) * (p.y - q.y));
      if (a > bestA && ok(x, z)) {
        bestA = a;
        best = [x, z];
      }
    }
    return best ? new THREE.Vector3(best[0], y, best[1]) : new THREE.Vector3(room.centroid.x, y, room.centroid.y);
  }

  /** Room of a world point (physical rooms; outside the house: the living room, whose lights also light outside). */
  _roomIdAt(p) {
    const r = this.layout?.house?.roomAt?.(p.x, p.y, p.z);
    return r && this._worlds.has(r.id) ? r.id : LIVING_ID;
  }

  /** Model a source of a room deposits its bounce into (the living room's for the living room and outside). */
  _modelOf(roomId) {
    return this._worlds.get(roomId)?.model ?? (roomId === OUTSIDE_ID ? null : this._model);
  }

  /** Opening (0..1) of a portal: a door's leaf (Door.t), an open opening or the stairwell 1. */
  _portalGain(def) {
    if (def.kind !== 'door') return 1;
    if (!this._doorsById) {
      this._doorsById = new Map();
      for (const d of this.home?.doors || []) if (d?.door) this._doorsById.set(d.id, d.door);
    }
    const door = this._doorsById.get(def.id);
    if (!door) return 0;
    return clamp(door.t ?? (door.isOpen ? 1 : 0));
  }

  /** The rooms the camera can reach (open portals, breadth-first, depth 2), the camera's room first. */
  _reachable() {
    return new Set(this._reachWeights(2).keys());
  }

  /**
   * The rooms the camera can reach with their light-slot weight: the camera's room 1 (outside the house also OUTSIDE,
   * and the search goes on from there instead: door-ute → entre-kjeller), then breadth-first over the open portals
   * (`maxDepth` portals), × HOUSE.hop per portal (× the door's opening). An overview: every room of its level (and
   * OUTSIDE) at 1. With the doors shut inside the living room: just { living room: 1 }.
   * @param {number} [maxDepth=2]
   * @returns {Map<string, number>}
   */
  _reachWeights(maxDepth = 2) {
    const out = new Map();
    if (this._overview) {
      for (const [rid, R] of this._worlds) if ((R.room?.levelId ?? 'hoved') === this._overview) out.set(rid, 1);
      out.set(this._camRoomId, 1);
      out.set(OUTSIDE_ID, 1);
      return out;
    }
    out.set(this._camRoomId, 1);
    // outside the house the camera's room is the living room only for its exposure: the search starts outside
    if (this._camOutside) out.set(OUTSIDE_ID, 1);
    if (!this._portalDefs?.length) return out;
    let front = [this._camOutside ? OUTSIDE_ID : this._camRoomId];
    for (let depth = 0; depth < maxDepth && front.length; depth++) {
      const next = [];
      const found = new Map();
      for (const id of front) {
        for (const q of this._portalDefs) {
          if (!q.connects.includes(id)) continue;
          const g = this._portalGain(q);
          if (g <= HOUSE.portalOpen) continue;
          const o = q.connects.find((x) => x !== id);
          if (!o || out.has(o)) continue;
          const w = out.get(id) * (HOUSE.hop[q.kind] ?? HOUSE.hop.door) * (q.kind === 'door' ? g : 1);
          if (!found.has(o)) next.push(o);
          found.set(o, Math.max(found.get(o) ?? 0, w));
        }
      }
      for (const [o, w] of found) out.set(o, w);
      front = next;
    }
    return out;
  }

  /**
   * An overview camera (orbit / plan, steg 28) shows a level: its shadow and GTAO box, one exposure and white balance
   * for the level (area-weighted over its rooms, _levelAggregate), and every room of the level competes for the light
   * slots. The environment map is the level's main room's (the living room / the largest room). null: back to following
   * the camera (the next update finds its room and level again).
   * @param {string|null} levelId  'hoved' | 'kjeller' | null
   */
  setOverviewLevel(levelId) {
    const h = this.layout?.house;
    const id = levelId && h?.levelsById?.[levelId] ? levelId : null;
    if (id === this._overview) return;
    this._overview = id;
    if (id) {
      let main = id === 'hoved' && this._worlds.has(LIVING_ID) ? LIVING_ID : null;
      if (!main) {
        let best = 0;
        for (const [rid, R] of this._worlds) {
          const a = (R.room?.levelId ?? 'hoved') === id ? R.room?.area ?? 0 : 0;
          if (a > best) {
            best = a;
            main = rid;
          }
        }
      }
      if (id !== this._camLevelId) {
        this._camLevelId = id;
        this._setShadowLevel(id);
      }
      this._camOutside = false;
      this._camRoomId = main ?? LIVING_ID;
      const W = this._worlds.get(this._camRoomId);
      if (W) W.env.dirty = W.env.dirty || !W.env.rt;
    }
    this._selectRoom(true);
  }

  /** The level an overview shows (setOverviewLevel), else null. */
  get overviewLevel() {
    return this._overview;
  }

  /**
   * The camera's level (shadow box) and room (exposure …): layout.house at body height (eye − 0.7) with the level's
   * hysteresis. In a doorway / wall the room stays; outside the house and above the ceilings (orbit, plan) it is the
   * living room (its light is what the terrace and the overviews were always shown with). Outside the house at walking
   * height (below the roof: the forecourt, the terrace) _camOutside: the outdoor lamps can get light slots. An overview
   * (setOverviewLevel) fixes level and room.
   */
  _trackCamera(cam) {
    const p = cam?.position;
    const h = this.layout?.house;
    if (!p || !h?.levelAt || this._overview) return;
    const body = p.y - 0.7;
    const lv = h.levelAt(body, this._camLevelId);
    if (lv && lv.id !== this._camLevelId) {
      this._camLevelId = lv.id;
      this._setShadowLevel(lv.id);
    }
    let id = this._camRoomId;
    const r = lv ? h.roomAt(p.x, body, p.z, { levelId: lv.id }) : null;
    let outside = false;
    if (r && this._worlds.has(r.id)) {
      if (p.y <= r.ceilingTop + 0.05) id = r.id;
      else if (p.y > (h.bounds?.maxY ?? 3) + 0.5) id = LIVING_ID; // an overview camera above the house
      else {
        // the eye is above this room's ceiling but inside the house: in the stairwell (the stair's upper part, the
        // body already on the basement's level) it is in the room above – not the living room (integrator, bølge 1
        // gruppe 2: gang → stue-kjokken → kjeller-gang on the stair made S jump 4–5×)
        const upId = lv?.aboveId ?? null;
        const up = upId ? h.roomAt(p.x, p.y, p.z, { levelId: upId }) : null;
        id = up && this._worlds.has(up.id) ? up.id : r.id;
      }
    } else if (!r || !this._worlds.has(r.id)) {
      const inside = !!h.isInside?.(p.x, p.z, body, lv?.id);
      id = inside ? this._camRoomId : LIVING_ID;
      outside = !r && !inside && p.y < (h.bounds?.maxY ?? 3) + 0.5;
    }
    if (outside !== this._camOutside) {
      this._camOutside = outside;
      this._selectAt = -1e9;
    }
    if (id !== this._camRoomId) {
      this._camRoomId = id;
      const W = this._worlds.get(id);
      if (W) W.env.dirty = W.env.dirty || !W.env.rt;
      this._selectRoom(true);
    }
  }

  /**
   * Portal rectangles with their current opening → lightmask (only when something changed; cheap, every frame of a
   * swing). The rooms are solved again (a full recompute, ~2 ms) only per HOUSE.portalStep of a door's opening, when a
   * door crosses half open, and once when the doors stop.
   */
  _updatePortals() {
    if (!this._table || !this._portalDefs?.length) return;
    const gains = this._portalDefs.map((q) => this._portalGain(q));
    this._gainsNow = gains;
    const key = gains.map((g) => g.toFixed(3)).join(',');
    if (key === this._portalState) {
      if (this._portalSolved !== key) {
        // stopped between two steps: solve at the final opening
        this._portalSolved = key;
        this._portalSolvedGains = gains;
        this._markDirty();
      }
      return;
    }
    this._portalState = key;
    const bit = (id) => this._table.byId[id]?.bit ?? 0;
    lightMask.setPortals(this._portalDefs.map((q, i) => ({
      center: q.center, u: q.u, halfU: q.halfU, v: q.v, halfV: q.halfV, bits: bit(q.connects[0]) | bit(q.connects[1]),
      // direct light through a door: full from half open (the leaf no longer stands in the way of most of it)
      gain: q.kind === 'door' ? clamp(gains[i] / HOUSE.portalOpen) : 1,
    })));
    // the portals feed the rooms' bounce, and a door crossing half open changes what the camera can reach
    const solved = this._portalSolvedGains;
    const opened = !solved || solved.some((g, i) => (g > HOUSE.portalOpen) !== (gains[i] > HOUSE.portalOpen));
    if (opened || solved.some((g, i) => Math.abs(g - gains[i]) >= HOUSE.portalStep - 1e-9)) {
      this._portalSolved = key;
      this._portalSolvedGains = gains;
      this._markDirty();
    }
  }

  /** Mask bits of a source: its room (the living room's – and outside's – also OUTSIDE), home = its room. */
  _maskOf(c) {
    const t = this._table;
    if (!t) return [0, 0];
    const roomId = c.roomId ?? LIVING_ID;
    const e = t.byId[roomId] ?? t.byId[LIVING_ID];
    const bits = e.bit | (roomId === LIVING_ID || roomId === OUTSIDE_ID ? t.outsideBit : 0);
    return [bits, e.bit];
  }

  /** Windows/glass doors: sky RectAreaLight candidates + data for the sun flux. */
  _buildWindows() {
    this._windows = [];
    this._roomWindows = [];
    // the living room's windows (this._windows, as before), then those of the other rooms (their world's model)
    const living = this.layout?.windows || [];
    const others = (this.layout?.house?.windows || []).filter((o) => o.roomId !== LIVING_ID && this._worlds.has(o.roomId));
    for (const o of [...living, ...others]) {
      const own = (o.roomId ?? LIVING_ID) === LIVING_ID;
      const world = own ? null : this._worlds.get(o.roomId);
      const model = own ? this._model : world.model;
      const frosted = !own && !!o.frosted;
      const fw = o.frame?.width ?? 0.07;
      const gw = Math.max(0.2, o.width - 2 * fw);
      const gh = Math.max(0.2, o.height - 2 * fw);
      const glassDepth = Math.max(0.05, (o.revealDepth ?? 0.2) - (o.frame?.depth ?? 0.07) / 2);
      const normal = o.normal.clone();
      const center = o.center.clone().addScaledVector(normal, -(glassDepth - 0.03));
      const right = o.right.clone();
      const up = new THREE.Vector3(0, 1, 0);
      // the sky light comes in from above the horizon and goes DOWN into the room (only the dimmer ground-reflected
      // light goes up): the window's rect light faces WINDOW_TILT below horizontal, so the ceiling next to the glass
      // stays dark as in the photos (fix-lighting r1: at 15° the windows lit the ceiling almost as much as the floor)
      // frosted glass (the bathroom): diffuse, straight into the room
      const tilted = frosted ? normal.clone() : normal.clone().multiplyScalar(Math.cos(WINDOW_TILT)).add(new THREE.Vector3(0, -Math.sin(WINDOW_TILT), 0)).normalize();
      const roomId = own ? LIVING_ID : o.roomId;
      const cand = {
        id: `window:${o.id}`, kind: 'rect', source: 'window', windowId: o.id, roomId,
        position: center, normal: tilted, right, width: gw, height: gh, area: gw * gh,
        color: new THREE.Color(1, 1, 1), phys: 0, flux: 0, on: true, emissive: [], fade: 0, slot: null,
        quat: rectQuaternion(tilted, right),
      };
      // far-field stand-in when the window gets no rect slot: a soft wide spot a little behind the glass (a Lambertian
      // window seen from a few metres is a cos-lobe point source, I = L·A·cosθ); costs a cheap spot slot, not a rect
      const back = 0.35 + 0.25 * Math.sqrt(gw * gh);
      const spotCand = {
        id: `windowspot:${o.id}`, kind: 'spot', source: 'window-spot', windowId: o.id, roomId,
        position: center.clone().addScaledVector(normal, -back), direction: tilted.clone(), angle: 86 * DEG, penumbra: 1,
        color: new THREE.Color(1, 1, 1), phys: 0, flux: 0, on: false, emissive: [], fade: 0, slot: null,
        // the point sits `back` behind the glass: compensate the 1/d² loss at a typical 3 m into the room
        gain: ((3 + back) / 3) ** 2,
      };
      cand.spotCand = spotCand;
      const sampleUV = [];
      for (const su of [-0.35, 0, 0.35]) for (const sv of [-0.35, 0, 0.35]) sampleUV.push([su, sv]);
      const entry = {
        id: o.id, type: o.type, opening: o, normal, outward: normal.clone().negate(), right, up, center, glassDepth,
        width: gw, height: gh, area: gw * gh, cand, spotCand, samples: sampleUV, roomId, frosted,
        // radiosity: the sky part lands on what lies below the glass top (floor, the lower walls), the ground part on
        // what lies above the sill (upper walls, the ceilings) – both Lambertian about the window normal
        skyWeights: model ? fluxWeights(model, center.clone().addScaledVector(normal, 0.25), normal, 1, null, (p) => patchShareBelow(p, center.y + gh / 2)) : null,
        groundWeights: model ? fluxWeights(model, center.clone().addScaledVector(normal, 0.25), normal, 1, null, (p) => 1 - patchShareBelow(p, center.y - gh / 2)) : null,
        L: 0, sunFlux: 0, skyFlux: 0,
      };
      if (own) this._windows.push(entry);
      else {
        // the rooms' models are in world y: patchShareBelow measures from the room's floor
        if (model && world.room.floorY) {
          const fy = world.room.floorY;
          const below = (p, y) => (p.kind === 'wall' ? patchShareBelow({ ...p, center: p.center.clone().setY(p.center.y - fy) }, y - fy) : patchShareBelow(p, y));
          const at = center.clone().addScaledVector(normal, 0.25);
          entry.skyWeights = fluxWeights(model, at, normal, 1, null, (p) => below(p, center.y + gh / 2));
          entry.groundWeights = fluxWeights(model, at, normal, 1, null, (p) => 1 - below(p, center.y - gh / 2));
        }
        if (frosted) entry.diffuseWeights = fluxWeights(model, center.clone().addScaledVector(normal, 0.25), normal, 1);
        // glass under the soffit of the covered forecourt (the side panels of the entrance door) sees half the sky
        const cov = this.layout.house.outsideHouse?.covered?.polygon;
        if (Array.isArray(cov) && cov.length >= 3) {
          const out = center.clone().addScaledVector(normal, -0.4);
          let inside = false;
          for (let i = 0, j = cov.length - 1; i < cov.length; j = i++) {
            const a = cov[i], b = cov[j];
            if ((a[1] > out.z) !== (b[1] > out.z) && out.x < ((b[0] - a[0]) * (out.z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
          }
          if (inside) entry.coveredSky = 0.5;
        }
        // the soffits above the glass (outsideHouse.soffits, world y) shade the sun too: _soffitSun traces toward it
        const top = center.y + gh / 2;
        entry.soffits = (this.layout.house.outsideHouse?.soffits || [])
          .filter((s) => Array.isArray(s.polygon) && s.polygon.length >= 3 && Number.isFinite(s.y) && s.y > top - 0.01)
          .map((s) => ({ y: s.y, poly: s.polygon.map((p) => ({ x: p[0], y: p[1] })) }));
        world.windows.push(entry);
        this._roomWindows.push(entry);
        if (normal.x < -0.7) world.south = true; // the glass looks south (+x)
      }
    }
    const lw = this._worlds.get(LIVING_ID);
    if (lw) lw.windows = this._windows;
  }

  /** Built-in fixtures of the shell/kitchen (§15) → light candidates. */
  _buildBuiltIns() {
    this._builtIns = [];
    const groupLumens = {};
    const specById = Object.fromEntries((this.layout?.builtInLights || []).map((x) => [x.id, x]));
    for (const l of this.home?.builtInLights || []) {
      const lm = Math.max(0, l.lumens || 0);
      const dims = l.dims ?? specById[l.id]?.dims ?? {};
      groupLumens[l.group] = (groupLumens[l.group] || 0) + lm;
      const base = { source: 'builtin', group: l.group, builtInId: l.id, colorK: l.colorK || 2700, lumens: lm, emissive: l.emissiveMeshes || [], fade: 0, slot: null, roomId: LIVING_ID };
      let c = null;
      if (l.type === 'led-strip' && l.from && l.to) {
        const from = l.from.clone(), to = l.to.clone();
        const len = from.distanceTo(to);
        const along = to.clone().sub(from).normalize();
        const mid = from.clone().add(to).multiplyScalar(0.5);
        // a strip with its own normal (the LED strips inside the glass cabinet: down and back onto its back panel) shines
        // as given, from where it is; else aim it at its wall (wall washer) – the nearest parallel wall within 0.4 m
        const own = l.normal?.isVector3 ? l.normal.clone().normalize() : null;
        const toward = own ? null : this._nearestWallNormal(mid, along);
        const normal = own ?? new THREE.Vector3(0, -1, 0);
        let pos = own ? mid.clone() : mid.clone().setY(mid.y - 0.015);
        if (toward) {
          normal.multiplyScalar(Math.cos(38 * DEG)).addScaledVector(toward, -Math.sin(38 * DEG)).normalize();
          pos.addScaledVector(toward, 0.06); // a little away from the wall so the wash starts just below the ceiling
        }
        const height = l.rectHeight ?? 0.05;
        c = {
          ...base, id: `builtin:${l.id}`, kind: 'rect', position: pos, normal, right: along, width: len, height, area: len * height,
          quat: rectQuaternion(normal, along), strip: true,
        };
        // light-slot weight of the strip over its flux (_score; default STRIP_SIGNATURE)
        if (Number.isFinite(l.stripSignature)) c.stripSignature = l.stripSignature;
      } else if (l.position) {
        const dir = (l.direction?.clone() ?? new THREE.Vector3(0, -1, 0)).normalize();
        // old-style entries carry the mount point of room-spec; new ones (§15) the emission point of the model's light
        const spec = specById[l.id.split(':')[0]];
        const atMount = !!spec?.position && spec.position.distanceTo(l.position) < 0.005;
        const id = `builtin:${l.id}`;
        const lt = l.lightType;
        if (l.type === 'spot') {
          const half = l.angle ?? ((l.beamDeg ?? 36) * DEG) / 2;
          const position = atMount ? l.position.clone().addScaledVector(dir, 0.11) : l.position.clone();
          if (l.group === 'spots') {
            // the high-wall spots (fix-lighting r1, photos 082924/0_for): soft pools without the hard rim of the old
            // cone (beam·1.3, penumbra 0.5 – it grazed the wall down to the floor); see HIGHWALL_SPOT
            const beam = (l.beamDeg ?? 36) * DEG;
            c = { ...base, id, kind: 'spot', position, direction: this._lowerAim(position, dir, HIGHWALL_SPOT.aimDrop),
              angle: Math.max(HIGHWALL_SPOT.angle, beam / 2), penumbra: HIGHWALL_SPOT.penumbra, wantsShadow: true };
          } else {
            c = { ...base, id, kind: 'spot', position, direction: dir, angle: Math.min(1.3, half * 1.3), penumbra: 0.5 };
          }
        } else if ((l.type === 'ceiling' || l.type === 'ceiling-ring') && lt !== 'spot') {
          // flush ring/ceiling lamps light downward like a Lambertian disc (no hot spot on the ceiling above them)
          const drop = atMount ? (dims.drop ?? 0.1) + 0.02 : 0;
          c = { ...base, id, kind: 'spot', position: l.position.clone().setY(l.position.y - drop), direction: new THREE.Vector3(0, -1, 0),
            angle: 82 * DEG, penumbra: 1, lambert: true };
        } else if (l.type === 'pendant-cylinder' || (l.type === 'pendant' && lt !== 'point') || lt === 'spot') {
          const pos = l.type === 'pendant-cylinder' && atMount
            ? new THREE.Vector3(l.position.x, (dims.bottomY ?? l.position.y - 0.7) - 0.01, l.position.z)
            : l.position.clone();
          if (l.group === 'pendler') {
            // the island pendants: wide pools on the worktop (see ISLAND_PENDANT)
            c = { ...base, id, kind: 'spot', position: pos, direction: dir, angle: ISLAND_PENDANT.angle, penumbra: ISLAND_PENDANT.penumbra };
          } else {
            const angle = l.angle != null ? clamp(l.angle, 0.15, 1.3) : 34 * DEG;
            c = { ...base, id, kind: 'spot', position: pos, direction: dir, angle, penumbra: clamp(l.penumbra ?? 0.6) };
          }
        } else {
          c = { ...base, id, kind: 'point', position: atMount ? l.position.clone().setY(l.position.y - 0.15) : l.position.clone() };
        }
      }
      if (!c) continue;
      this._initCandidate(c);
      this._builtIns.push(c);
    }
    this._groupLumens = groupLumens;
    for (const g of this.builtInGroups) g.lumens = Math.round(groupLumens[g.id] || 0);
  }

  /**
   * The lamps of the other rooms and outside (§4.8): layout.house.builtInLights outside the living room and
   * outsideHouse.lights (world y), with the glowing meshes of the builders' entries of the same id
   * (home.house.builtInLights after the living room's); builder lights without data (the mirror ring, the handrail
   * LED …) as they come. plafond → Lambertian disc downward; downlights → at most two spots per room and group (the
   * nearest along the room's long axis, their flux summed, the cone widened over the group); led-strip → a thin rect
   * (signature 1); the lighting rules' fittings (notes/belysning-genererte-hus.md): pendant → a soft cone down from the
   * shade, step → a spot down and out of the wall, wall → a point in front of the wall (their outdoor lamps: roomId
   * 'ute'); anything else a point. Their bounce goes into their room's model.
   */
  _buildHouseLamps() {
    this._houseLamps = [];
    const h = this.layout?.house;
    if (!h || !this._table) return;
    const living = new Set(this.home?.builtInLights || []);
    // builder entries by their data id (a builder may split one fixture into 'l-x:0', 'l-x:1' like the shell)
    const fromBuilders = new Map();
    for (const l of this.home?.house?.builtInLights || []) {
      if (living.has(l) || l?.id == null) continue;
      const key = String(l.id).split(':')[0];
      if (!fromBuilders.has(key)) fromBuilders.set(key, []);
      fromBuilders.get(key).push(l);
    }
    const entries = [];
    const take = (id) => {
      const list = fromBuilders.get(String(id)) || [];
      fromBuilders.delete(String(id));
      return list.flatMap((b) => b.emissiveMeshes || []);
    };
    for (const l of h.builtInLights || []) {
      // (outdoor lamps of the lighting rules come as roomId 'ute' – notes/belysning-genererte-hus.md)
      if (l.roomId === LIVING_ID || l.emits === false || (!this._worlds.has(l.roomId) && l.roomId !== OUTSIDE_ID)) continue;
      entries.push({ ...l, emissiveMeshes: take(l.id) });
    }
    for (const l of h.outsideHouse?.lights || []) {
      if (!Array.isArray(l.position)) continue;
      entries.push({
        id: l.id, roomId: OUTSIDE_ID, group: l.group || 'ute', type: l.type, colorK: l.lightColorK ?? 2700, lumens: l.lumens ?? 0,
        dims: l.dims || {}, position: new THREE.Vector3(...l.position), direction: new THREE.Vector3(0, -1, 0), emissiveMeshes: take(l.id),
      });
    }
    for (const b of [...fromBuilders.values()].flat()) {
      const p = b.position ?? (b.from && b.to ? b.from.clone().add(b.to).multiplyScalar(0.5) : null);
      if (!p) continue;
      const roomId = b.roomId && (this._worlds.has(b.roomId) || b.roomId === OUTSIDE_ID) ? b.roomId : this._roomIdAt(p);
      if (roomId === LIVING_ID) continue; // the living room's lights come from home.builtInLights only
      entries.push({ ...b, roomId, colorK: b.colorK ?? b.lightColorK ?? 2700, lumens: b.lumens ?? 0, emissiveMeshes: b.emissiveMeshes || [] });
    }
    const groupLumens = this._groupLumens || {};
    const push = (c) => {
      if (!c) return;
      this._initCandidate(c, this._modelOf(c.roomId));
      this._houseLamps.push(c);
      this._worlds.get(c.roomId)?.lamps.push(c);
    };
    // downlights per room and group → at most HOUSE.maxDownlightSpots spots
    const clusters = new Map();
    for (const l of entries) {
      groupLumens[l.group] = (groupLumens[l.group] || 0) + Math.max(0, l.lumens || 0);
      const base = {
        source: 'builtin', group: l.group, builtInId: l.id, colorK: l.colorK || 2700, lumens: Math.max(0, l.lumens || 0),
        emissive: l.emissiveMeshes || [], fade: 0, slot: null, roomId: l.roomId, house: true,
      };
      if (l.type === 'downlight' && l.position) {
        const key = `${l.roomId}|${l.group}`;
        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key).push({ l, base });
      } else if (l.type === 'led-strip' && l.from && l.to) {
        const from = l.from.clone(), to = l.to.clone();
        const len = from.distanceTo(to);
        if (len < 0.02) continue;
        const along = to.clone().sub(from).normalize();
        const mid = from.clone().add(to).multiplyScalar(0.5);
        const toward = this._nearestWallNormal(mid, along, l.roomId);
        const normal = new THREE.Vector3(0, -1, 0);
        const pos = mid.clone().setY(mid.y - 0.015);
        if (toward) {
          normal.multiplyScalar(Math.cos(38 * DEG)).addScaledVector(toward, -Math.sin(38 * DEG)).normalize();
          pos.addScaledVector(toward, 0.06);
        }
        push({ ...base, id: `builtin:${l.id}`, kind: 'rect', position: pos, normal, right: along, width: len, height: 0.05, area: len * 0.05,
          quat: rectQuaternion(normal, along), strip: true, stripSignature: HOUSE.stripSignature, noShadow: true });
      } else if (l.position) {
        const dims = l.dims || {};
        if (l.type === 'plafond' || l.type === 'ceiling' || l.type === 'ceiling-ring') {
          const drop = (dims.h ?? 0.07) + 0.01;
          push({ ...base, id: `builtin:${l.id}`, kind: 'spot', position: l.position.clone().setY(l.position.y - drop), direction: new THREE.Vector3(0, -1, 0),
            angle: HOUSE.plafond.angle, penumbra: 1, lambert: true, noShadow: true });
        } else if (l.type === 'pendant') {
          // the lighting rules' pendants (home/lampfittings.js): a soft downward cone from the opal bottom of the shade
          push({ ...base, id: `builtin:${l.id}`, kind: 'spot', position: l.position.clone().setY(l.position.y - (dims.drop ?? 0.7) + 0.02), direction: new THREE.Vector3(0, -1, 0),
            angle: HOUSE.pendant.angle, penumbra: 0.8, noShadow: true });
        } else if (l.type === 'step' && l.normal) {
          // step lights: low in the wall, aimed down and out over the treads
          push({ ...base, id: `builtin:${l.id}`, kind: 'spot', position: l.position.clone().addScaledVector(l.normal, 0.03), direction: l.normal.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, -1, 0)).normalize(),
            angle: HOUSE.step.angle, penumbra: 0.9, noShadow: true });
        } else if (l.type === 'wall' && l.normal) {
          // wall lamps (inside and out): a point a little in front of the wall
          push({ ...base, id: `builtin:${l.id}`, kind: 'point', position: l.position.clone().addScaledVector(l.normal, (dims.depth ?? 0.1) / 2 + 0.06), noShadow: true });
        } else {
          push({ ...base, id: `builtin:${l.id}`, kind: 'point', position: l.position.clone(), noShadow: true });
        }
      }
    }
    for (const [key, list] of clusters) {
      const [roomId] = key.split('|');
      const floorY = this._worlds.get(roomId)?.room?.floorY ?? (roomId === OUTSIDE_ID ? (h.outsideHouse?.entranceLevelY ?? list[0].l.position.y - 2.3) : 0);
      // split along the axis the lights spread most over, at most maxDownlightSpots parts
      const xs = list.map((e) => e.l.position.x), zs = list.map((e) => e.l.position.z);
      const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
      list.sort((a, b) => (alongX ? a.l.position.x - b.l.position.x : a.l.position.z - b.l.position.z));
      const parts = Math.min(HOUSE.maxDownlightSpots, list.length);
      for (let k = 0; k < parts; k++) {
        const part = list.slice(Math.floor((k * list.length) / parts), Math.floor(((k + 1) * list.length) / parts));
        const c = new THREE.Vector3();
        let lm = 0;
        for (const e of part) {
          c.add(e.l.position);
          lm += e.base.lumens;
        }
        c.multiplyScalar(1 / part.length);
        let r = 0;
        for (const e of part) r = Math.max(r, Math.hypot(e.l.position.x - c.x, e.l.position.z - c.z));
        const H = Math.max(0.5, c.y - floorY);
        const angle = clamp(Math.atan((r + H * Math.tan(HOUSE.downlight.angle)) / H), HOUSE.downlight.angle, 80 * DEG);
        const first = part[0];
        push({
          ...first.base, id: `builtin:${first.l.id}`, builtInId: `downlights.${roomId}.${first.l.group}.${k}`, lumens: lm,
          emissive: part.flatMap((e) => e.base.emissive), members: part.map((e) => e.l.id),
          kind: 'spot', position: c.setY(c.y - 0.02), direction: new THREE.Vector3(0, -1, 0), angle, penumbra: HOUSE.downlight.penumbra,
          noShadow: angle > 50 * DEG + 1e-6,
        });
      }
    }
    for (const g of this.builtInGroups) g.lumens = Math.round(groupLumens[g.id] || 0);
  }

  /** Direction from `pos` to the point `drop` m below where `dir` meets the nearest wall (unchanged without a hit). */
  _lowerAim(pos, dir, drop) {
    let bestT = Infinity;
    for (const p of this._model?.patches || []) {
      if (p.kind !== 'wall') continue;
      const t = p.hit(pos, dir);
      if (t != null && t < bestT) bestT = t;
    }
    if (!Number.isFinite(bestT) || bestT > 4) return dir.clone();
    const hit = pos.clone().addScaledVector(dir, bestT);
    hit.y = Math.max(0.3, hit.y - drop);
    return hit.sub(pos).normalize();
  }

  /** Inward normal of the wall the point lies along (parallel within 0.4 m), or null. */
  _nearestWallNormal(p, along, roomId = LIVING_ID) {
    let best = null, bestD = 0.4;
    const walls = roomId === LIVING_ID ? this.layout?.walls || [] : (this.layout?.house?.walls || []).filter((w) => w.roomId === roomId);
    for (const w of walls) {
      if (Math.abs(w.dir3.dot(along)) < 0.95) continue;
      const d = (p.x - w.start.x) * w.normal3.x + (p.z - w.start.y) * w.normal3.z;
      const u = (p.x - w.start.x) * w.dir3.x + (p.z - w.start.y) * w.dir3.z;
      if (d < -0.05 || d > bestD || u < -0.3 || u > w.length + 0.3) continue;
      bestD = d;
      best = w.normal3;
    }
    return best ? best.clone() : null;
  }

  /** Candidate from an item light (SceneSync, world space). */
  _itemCandidate(uid, i, l) {
    let type = l.type === 'spot' ? 'spot' : 'point';
    const emissive = l.emissiveMeshes || [];
    let direction = l.direction ? (l.direction.isVector3 ? l.direction.clone() : new THREE.Vector3(...l.direction)).normalize() : new THREE.Vector3(0, -1, 0);
    let angle = clamp(l.angle ?? 0.6, 0.05, 1.45), penumbra = clamp(l.penumbra ?? 0.5);
    // a fixture that draws its up-light as ceiling-glow decals (custom-blended glow meshes – the molecule chandelier's
    // opaque shades) sends most of its light down: its point light, isotropic, lit the whole ceiling round it amber
    // (083012: grey there, the warm glow only above the two upward shades). A downward half-space spot with most of
    // the flux plus a weaker point light (HALF_SPACE_SPOT.pointShare: half of it goes up), so the ceiling still gets
    // some direct light – without any the lamp-lit evening ceiling was a dark brown cave
    let split = false;
    if (type === 'point' && emissive.some((m) => m?.material?.blending === THREE.CustomBlending)) {
      type = 'spot';
      direction = new THREE.Vector3(0, -1, 0);
      angle = HALF_SPACE_SPOT.angle;
      penumbra = HALF_SPACE_SPOT.penumbra;
      split = true;
    }
    const c = {
      id: `item:${uid}:${i}`, kind: type, source: 'item', uid,
      position: (l.position?.isVector3 ? l.position.clone() : new THREE.Vector3(...(l.position || [0, 0, 0]))),
      direction, angle, penumbra,
      colorK: l.colorK ?? 2700, lumens: Math.max(0, l.lumens ?? 800), itemOn: l.on !== false, itemDimmer: clamp(l.dimmer ?? 1),
      emissive, fade: 0, slot: null, halfSpace: split,
    };
    // the room the lamp stands in (its bounce goes into that room's model; outside the house: the living room's)
    c.roomId = this._worlds.size ? this._roomIdAt(c.position) : LIVING_ID;
    const model = this._modelOf(c.roomId);
    if (!split) {
      this._initCandidate(c, model);
      return [c];
    }
    const lm = c.lumens, k = HALF_SPACE_SPOT.pointShare;
    c.lumens = lm * (1 - k);
    const up = { ...c, id: `${c.id}:up`, kind: 'point', position: c.position.clone(), direction: c.direction.clone(), lumens: lm * k, emissive: [] };
    this._initCandidate(c, model);
    this._initCandidate(up, model);
    return [c, up];
  }

  /** Physical intensity per lumen, colour and flux weights of a lamp candidate. */
  _initCandidate(c, model = this._model) {
    c.color = lightColor(c.colorK);
    if (c.kind === 'point') c.cdPerLm = 1 / (4 * Math.PI);
    else if (c.kind === 'spot') c.cdPerLm = c.lambert ? 1 / Math.PI : 1 / spotSolidAngle(c.angle, c.penumbra);
    else c.cdPerLm = 1 / (Math.PI * c.area); // rect: nits per lumen
    c.weights = null;
    if (model) {
      if (c.kind === 'point') c.weights = fluxWeights(model, c.position, null);
      else if (c.kind === 'spot') c.weights = fluxWeights(model, c.position, c.direction, c.lambert ? 1 : lobeExponent(c.angle * 0.8));
      else c.weights = fluxWeights(model, c.position, c.normal, 1);
      const upShare = c.lambert ? RING_UP_SHARE : 0;
      if (upShare > 0) {
        // the up-light of a downward fixture (upward shades and their glowing insides; the sides of a ring's opal
        // diffuser) still reaches the ceiling – in the bounce only (decals, where a model has them, draw where it lands)
        const up = fluxWeights(model, c.position, null);
        for (let i = 0; i < c.weights.length; i++) c.weights[i] = c.weights[i] * (1 - upShare) + up[i] * upShare;
      }
    }
    this._emissiveDirty = true;
  }

  _releaseCandidate(c) {
    if (c.slot) {
      c.slot.cand = null;
      c.slot.light.intensity = 0;
      c.slot = null;
    }
    this._emissiveDirty = true;
  }

  /** Emissive materials → the lamps that light them and the glowing area (a material may be shared by meshes/lamps). */
  _rebuildEmissiveIndex() {
    const idx = new Map();
    // a lamp's glowing parts are often listed on its first light only: they glow with all lights of the lamp
    const fixture = (c) => (c.source === 'item' ? `item:${c.uid}` : String(c.builtInId ?? c.id).split(':')[0]);
    const byFixture = new Map();
    const all = this._allLampCandidates();
    for (const c of all) {
      const k = fixture(c);
      if (!byFixture.has(k)) byFixture.set(k, []);
      byFixture.get(k).push(c);
    }
    for (const c of all) {
      for (const m of c.emissive) {
        if (!m?.isMesh) continue;
        const mat = m.material;
        if (!mat || Array.isArray(mat) || !('emissiveIntensity' in mat)) continue;
        if (mat.userData?.cached === true) continue; // shared cached material (mat()): never mutate
        let e = idx.get(mat);
        if (!e) idx.set(mat, (e = { mat, area: 0, meshes: new Set(), cands: new Set() }));
        if (!e.meshes.has(m)) {
          e.meshes.add(m);
          e.area += meshArea(m);
        }
        for (const f of byFixture.get(fixture(c))) e.cands.add(f);
      }
    }
    this._emissive = [...idx.values()];
    for (const e of this._emissive) e.halfSpace = [...e.cands].some((c) => c.halfSpace);
    this._emissiveDirty = false;
  }

  _initEnvironment() {
    const r = this.renderer;
    if (!r || !this._model) return;
    try {
      this._pmrem = new THREE.PMREMGenerator(r);
      // a first (black) environment of the final size so programs compile with the env map from the start
      this._buildEnv(r, true);
    } catch (err) {
      console.warn('[lighting] environment map failed', err);
      this._pmrem = null;
    }
  }

  // ---- the model -------------------------------------------------------------------------------------------

  _markDirty() {
    this._dirty = true;
    this._envDirty = true;
    for (const w of this._worlds.values()) w.env.dirty = true;
  }

  get latitude() {
    const v = Number(this.settings?.get?.('sunLatitude'));
    return Number.isFinite(v) && v > 30 && v < 80 ? v : SITE.latitude;
  }

  get weather() {
    return this.settings?.get?.('lightWeather') === 'overcast' ? 'overcast' : 'clear';
  }

  /** Terrain profile and trees (room-spec outside.horizon / outside.trees override the measured defaults). */
  get _terrain() {
    if (!this.__terrain) {
      const o = this.layout?.outside || {};
      const hz = Array.isArray(o.horizon) && o.horizon.length > 1 ? o.horizon.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [+p[0], +p[1]]).sort((a, b) => a[0] - b[0]) : HORIZON;
      const trees = o.trees === null ? null : o.trees && typeof o.trees === 'object' ? { ...TREES, ...o.trees } : TREES;
      this.__terrain = { horizon: hz.length > 1 ? hz : HORIZON, trees };
    }
    return this.__terrain;
  }

  /** Earliest (morning) or latest (evening) clock time of the day when the sun stands clear above the hills. */
  _clearSunHour(times, morning) {
    const { month, day } = this.time;
    const latitude = this.latitude;
    const t0 = times.polarDay ? times.noon - 12 : times.sunrise;
    const t1 = times.polarDay ? times.noon + 12 : times.sunset;
    if (t0 == null || t1 == null) return times.noon;
    const ok = (hh) => {
      const s = solarPosition({ hour: hh, month, day, latitude });
      return s.altitudeDeg >= 1 && sunVisibility(s.altitudeDeg - 1, s.azimuthDeg, this._terrain) > 0.5;
    };
    const step = 1 / 12; // 5 min
    if (morning) {
      for (let hh = Math.max(0, t0); hh <= Math.min(24, times.noon); hh += step) if (ok(hh)) return hh;
    } else {
      for (let hh = Math.min(24, t1); hh >= Math.max(0, times.noon); hh -= step) if (ok(hh)) return hh;
    }
    return times.noon;
  }

  /** Adaptation of the camera white point to the lamps' colour (see WB). */
  _lampAdapt(effective) {
    return effective === 'evening' || effective === 'night' ? this._wbParams.lampsEvening : this._wbParams.lamps;
  }

  /** Sun state for the current time and mode. */
  _effectiveSun() {
    const { month, day } = this.time;
    const latitude = this.latitude;
    const times = sunTimes({ month, day, latitude });
    let hour = this.time.hour;
    let sun = solarPosition({ hour, month, day, latitude });
    let altDeg = sun.altitudeDeg;
    let effective = altDeg > 0 ? 'day' : altDeg > -6 ? 'evening' : 'night';
    if (this.mode === 'day') {
      // «Dagslys»: the chosen clock time as long as it is light (sun ≥ 1° – behind the hills or not); when it is dark
      // or nearly so, the sun stands as it does at the nearest time of the day when it is clear above the hills
      if (times.polarNight) hour = times.noon;
      else if (sun.altitudeDeg < 1) hour = this._clearSunHour(times, hour < times.noon);
      sun = solarPosition({ hour, month, day, latitude });
      if (sun.altitudeDeg < 1) sun = solarPosition({ hour: (hour = times.noon), month, day, latitude });
      altDeg = sun.altitudeDeg;
      effective = 'day';
    } else if (this.mode === 'evening' || this.mode === 'night') {
      // a sky as at the blue hour / the dark night, the sun's bearing as at sunset
      const set = times.sunset ?? 21;
      sun = solarPosition({ hour: set, month, day, latitude });
      altDeg = this.mode === 'evening' ? -4 : -16;
      effective = this.mode;
    }
    return { sun, altDeg, times, effective, hour };
  }

  /** Everything that depends on time, mode, lamps and shading. Cheap (≈ 0.2 ms). */
  _recompute() {
    this._dirty = false;
    const model = this._model;
    const weather = this.weather;
    const { sun, altDeg, times, effective, hour: effHour } = this._effectiveSun();
    const dl = daylight(altDeg, weather);
    // the hills (and the trees west of the house) hide or dim the direct sun; the sky stays as bright as the sun's
    // altitude says, but loses its circumsolar glow and turns bluer (only the blue sky lights the windows then)
    const vis = this.mode === 'evening' || this.mode === 'night' ? 0 : sunVisibility(altDeg, sun.azimuthDeg, this._terrain);
    const blocked = dl.clear && altDeg > -0.8 && vis < 0.98 && dl.Edn > 1;
    if (blocked) {
      dl.Edn *= vis;
      dl.circum = vis;
      dl.Eglobal = dl.Edh + dl.Edn * Math.max(0, Math.sin(altDeg * DEG));
      dl.skyK = lerp(dl.skyK, Math.max(dl.skyK, BLUE_SKY_K), (1 - vis) * smoothstep(-2, 2, altDeg));
    }
    const sunDir = sun.dir.clone();
    const sunUp = altDeg > -0.8 && dl.Edn > 1;
    this._sunDir = sunDir;
    this._daylight = dl;
    const sunColor = lightColor(dl.sunK);
    const skyColor = lightColor(dl.skyK);

    // ---- windows: sky luminance and sun flux
    if (model) for (const p of model.patches) {
      p.E.setRGB(0, 0, 0);
      p.Eday.setRGB(0, 0, 0);
      p.Esun.setRGB(0, 0, 0);
    }
    let dayFlux = 0;
    // the ground-reflected part: the global light (sky + sun) off the garden (GROUND_TINT)
    const groundColor = addScaled(addScaled(new THREE.Color(0, 0, 0), skyColor, dl.Edh), sunColor, dl.Edn * Math.max(0, Math.sin(altDeg * DEG)));
    groundColor.multiplyScalar(1 / Math.max(1e-6, lum(groundColor))).multiply(GROUND_TINT);
    groundColor.multiplyScalar(1 / Math.max(1e-6, lum(groundColor)));
    this._groundColor = groundColor;
    for (const w of this._windows) {
      const t = this._transmission[w.id] ?? 1;
      // per window from the data (§4.7), today's constants by default
      const obstruction = w.opening.obstruction ?? OBSTRUCTION[w.id] ?? 1;
      const cosSun = Math.max(0, sunDir.dot(w.outward));
      const circum = dl.clear ? 0.45 * (0.25 + 0.75 * (dl.circum ?? 1)) : 0.05;
      // skyView (data, 0–1): the share of an open facade's sky the glass sees (basement windows) – scales the 0.42
      const skyView = w.opening.skyView != null ? 0.42 * w.opening.skyView : 0.42;
      const EvSky = dl.Edh * (skyView + circum * cosSun);
      const EvGround = 0.5 * GROUND_RHO * dl.Eglobal;
      const Ev = EvSky + EvGround;
      w.L = (Ev * GLASS_T * obstruction * t) / Math.PI;
      w.skyFlux = w.L * Math.PI * w.area;
      w.groundShare = EvGround / Math.max(1e-6, Ev);
      const winColor = addScaled(_c1.copy(skyColor).multiplyScalar(1 - w.groundShare), groundColor, w.groundShare);
      winColor.multiplyScalar(1 / Math.max(1e-6, lum(winColor)));
      w.cand.phys = w.L;
      w.cand.flux = w.skyFlux;
      w.cand.color.copy(winColor);
      w.cand.on = w.skyFlux > 1;
      w.spotCand.phys = w.L * w.area * w.spotCand.gain;
      w.spotCand.flux = w.skyFlux;
      w.spotCand.color.copy(winColor);
      dayFlux += w.skyFlux;
      if (model && w.skyWeights) {
        this._deposit(w.skyWeights, w.skyFlux * (1 - w.groundShare), skyColor, true);
        this._deposit(w.groundWeights, w.skyFlux * w.groundShare, groundColor, true);
      }
      // direct sun through this window (reveal shading of the oblique beam, then traced onto the room surfaces)
      w.sunFlux = 0;
      w.floorFrac = 0;
      if (sunUp && cosSun > 0.01) {
        const sr = sunDir.dot(w.right), sy = sunDir.y;
        const reveal = Math.max(0, 1 - (w.glassDepth * Math.abs(sr)) / (cosSun * w.width)) * Math.max(0, 1 - (w.glassDepth * Math.abs(sy)) / (cosSun * w.height));
        w.sunFlux = dl.Edn * cosSun * GLASS_T * w.area * reveal * t;
        dayFlux += w.sunFlux;
        if (model && w.sunFlux > 0) w.floorFrac = this._traceSun(w, sunDir, sunColor);
      }
    }

    this._bounces = model && sunUp ? this._sunBounces(sunDir, sunColor) : this._dropBounces();

    // ---- daylight-only bounce → indoor daylight level → automatic lamps
    let dayFloorLux = 0;
    if (model) {
      solveRadiosity(model, 'Eday', 'Bday', 8);
      // diffuse daylight on the floor (sky through the windows + all bounce, without the sun patches themselves)
      let skyDirect = 0, indirect = 0;
      for (const fp of model.floors) {
        const fi = model.patches.indexOf(fp);
        for (const w of this._windows) if (w.skyWeights) skyDirect += w.skyFlux * (1 - w.groundShare) * w.skyWeights[fi];
        indirect += this._indirectAt(fi, 'Bday') * fp.area;
      }
      dayFloorLux = (skyDirect + indirect) / Math.max(1, model.floorArea);
    }
    const autoOn = this.mode === 'evening' || this.mode === 'night' ? true : this.mode === 'day' ? false : dayFloorLux < LAMPS_ON_BELOW_LUX;
    this._defaultLampsOn = autoOn;
    // the other rooms' daylight (their own windows) → their automatic lamps; outside: dark below ≈ 800 lux
    this._outdoorDark = dl.Eglobal < 800;
    if (this._worlds.size > 1) this._roomsDaylight(dl, sunDir, sunUp, sunColor, skyColor, groundColor);

    // ---- lamps (the living room's into its model as before; the other rooms' into theirs)
    let lampFlux = 0, lampMired = 0, lampMiredW = 0;
    const lampColorSum = new THREE.Color();
    const all = this._allLampCandidates();
    for (const c of all) {
      let on, dimmer;
      if (c.source === 'builtin') {
        const s = this._builtInState.get(c.group);
        on = s && !s.auto ? s.on : c.house ? this._autoOnFor(c.group) : autoOn;
        dimmer = s ? s.dimmer : this._groupDimmer(c.group);
      } else {
        on = c.itemOn;
        dimmer = c.itemDimmer;
      }
      c.on = on && dimmer > 0.001 && c.lumens > 0;
      c.dimmer = dimmer;
      c.flux = c.on ? c.lumens * dimmer : 0;
      c.phys = c.flux * c.cdPerLm;
      if (c.flux > 0) {
        if (c.roomId && c.roomId !== LIVING_ID) {
          const w = this._worlds.get(c.roomId);
          if (w) {
            w.lampFlux += c.flux;
            w.lampMired += (c.flux * 1e6) / Math.max(1000, c.colorK || 2700);
            w.lampMiredW += c.flux;
            if (c.weights) this._depositIn(w.model, c.weights, c.flux * w.lampBounce, c.color, 'E');
          }
          continue;
        }
        lampFlux += c.flux;
        addScaled(lampColorSum, c.color, c.flux);
        lampMired += (c.flux * 1e6) / Math.max(1000, c.colorK || 2700);
        lampMiredW += c.flux;
        if (model && c.weights) this._deposit(c.weights, c.flux * LAMP_BOUNCE, c.color, false);
      }
    }

    // ---- full bounce, key luminance, white balance
    let Lkey = 0.05;
    const illum = new THREE.Color(0, 0, 0);
    if (model) {
      // daylight direct went into Eday; add it to E (lamps are already there)
      for (const p of model.patches) p.E.add(p.Eday);
      solveRadiosity(model, 'E', 'B', 10);
      let la = 0, aa = 0;
      for (const p of model.patches) {
        if (p.kind === 'glass') continue;
        la += (lum(p.B) / Math.PI) * p.area;
        aa += p.area;
      }
      Lkey = Math.max(0.02, la / Math.max(1, aa));
    } else {
      const E = (dayFlux + lampFlux) / 110;
      Lkey = Math.max(0.02, (0.45 * E) / Math.PI);
    }
    // colour of the light that actually falls on the room's surfaces (direct + bounce, area weighted), daylight and
    // lamps apart → the camera's white point (WB): 2700 K pools and LED coves stay amber and the daylit walls
    // grey-cool as in the photos; with no daylight the lamps set the white point, so an evening room is not orange-brown.
    const illumDay = new THREE.Color(0, 0, 0);
    if (model) {
      const { patches, F } = model;
      const n = patches.length;
      for (let i = 0; i < n; i++) {
        const p = patches[i];
        if (p.kind === 'glass') continue;
        let r = p.E.r, g = p.E.g, b = p.E.b;
        let rd = p.Eday.r, gd = p.Eday.g, bd = p.Eday.b;
        for (let j = 0; j < n; j++) {
          const f = F[i * n + j];
          if (!f) continue;
          const q = patches[j];
          r += f * q.B.r;
          g += f * q.B.g;
          b += f * q.B.b;
          rd += f * q.Bday.r;
          gd += f * q.Bday.g;
          bd += f * q.Bday.b;
        }
        illum.r += r * p.area;
        illum.g += g * p.area;
        illum.b += b * p.area;
        illumDay.r += rd * p.area;
        illumDay.g += gd * p.area;
        illumDay.b += bd * p.area;
      }
    } else {
      const sunTot = this._windows.reduce((s, w) => s + w.sunFlux, 0);
      const skyTot = this._windows.reduce((s, w) => s + w.skyFlux, 0);
      addScaled(addScaled(illumDay, sunColor, sunTot), skyColor, skyTot);
      illum.copy(illumDay).add(lampColorSum);
    }
    const illumLamp = new THREE.Color(Math.max(0, illum.r - illumDay.r), Math.max(0, illum.g - illumDay.g), Math.max(0, illum.b - illumDay.b));
    addScaled(illumDay, NIGHT_COLOR, NIGHT_FLOOR_LUX * 100);
    const dayL = lum(illumDay), lampL = lum(illumLamp);
    const dayShare = dayL / Math.max(1e-6, dayL + lampL);
    // camera white balance (see WB): the lamps' weight in the white point
    const wbp = this._wbParams;
    const m = (lampL * wbp.pull) / Math.max(1e-6, dayL + lampL * wbp.pull);
    // the daylight's colour: next to lamps the sky and sun themselves (the photos keep the sky's blue); daylight alone
    // is balanced on the colour of the light on the surfaces – sky, sun and their bounce off the warm floor and Sand
    // walls – the way a camera's auto white balance does in a sunlit room
    const alone = 1 - smoothstep(0, 0.08, m);
    const skyTot = this._windows.reduce((t, w) => t + w.skyFlux, 0), sunTot = this._windows.reduce((t, w) => t + w.sunFlux, 0);
    const srcDayMired = skyTot + sunTot > 1e-6 ? (skyTot * 1e6 / dl.skyK + sunTot * 1e6 / dl.sunK) / (skyTot + sunTot) : 1e6 / 7000;
    const dayMired = lerp(srcDayMired, 1e6 / cctOf(illumDay), alone);
    // the lamps' colour: their own colour temperature, and in a room lit by lamps alone partly the colour of their
    // light on the surfaces – its bounce off Sand and oak is warmer still, and a camera's auto white balance sees that
    // (with the lamps' own colour only, a grey sofa read brown in the evening)
    const lampSrcMired = lampMiredW > 1e-6 ? lampMired / lampMiredW : 1e6 / 2700;
    const lampMiredAvg = lampL > 1e-6 ? lerp(lampSrcMired, 1e6 / cctOf(illumLamp), WB.lampsMeasured * smoothstep(0.5, 0.95, m)) : lampSrcMired;
    // the white balance maps the light of the dominant source(s) (srcM) onto the colour it should show as (appM, moved
    // toward D65 by the adaptation) – one diagonal matrix between two blackbody colours, so a lamp-lit room reads as
    // warm white on the locus (a von Kries division by a 3200 K white point left 2700 K light yellow-olive)
    const M65 = 1e6 / 6500;
    const al = this._lampAdapt(effective);
    const srcM = lerp(dayMired, lampMiredAvg, m);
    const aD = lerp(wbp.day, wbp.dayAlone, alone);
    const appM = lerp(dayMired + aD * (M65 - dayMired), lampMiredAvg + al * (M65 - lampMiredAvg), m);
    const kOf = (mired) => 1e6 / clamp(mired, 1e6 / 15000, 1e6 / 1200);
    const A = kelvinToColor(kOf(appM), _c2), Sc = kelvinToColor(kOf(srcM), _c3);
    const wbT = this._wbTarget;
    wbT.setRGB(A.r / Math.max(1e-4, Sc.r), A.g / Math.max(1e-4, Sc.g), A.b / Math.max(1e-4, Sc.b));
    this._wbK = [Math.round(kOf(srcM)), Math.round(kOf(appM))];
    // keep the luminance of the light on the surfaces (the exposure is S's job)
    const ref = _c1.copy(illumDay).add(illumLamp).multiplyScalar(1 / Math.max(1e-6, dayL + lampL));
    const wbRef = ref.clone(); // the room's light colour (the other rooms' white balance relative to this one, _wbRelOf)
    ref.multiply(wbT);
    wbT.multiplyScalar(1 / Math.max(1e-4, lum(ref)));
    // eased in update() (a dimmer or the clock slider moves it); snapped on the first solve
    if (!this._wbReady) {
      this._wb.copy(wbT);
      this._wbReady = true;
    }
    const lampShare = lampFlux / Math.max(1, lampFlux + dayFlux);
    this._wbInfo = { dayShare, lampShare, lampWeight: m, whiteK: this._wbK };

    this._Lkey = Lkey;
    this._Starget = (this._key * (MODE_KEY[effective] ?? 1) * this.exposure) / (Math.pow(Lkey, KEY.p) * Math.pow(KEY.L0, 1 - KEY.p));

    // ---- sun light and its shadow camera
    this._sunPhys = sunUp ? dl.Edn * GLASS_T : 0;
    this._sunColor = sunColor;
    if (sunUp) this._placeSun(sunDir);

    // ---- outside: the photo backdrop and the sky colour
    const Lout = (dl.Eglobal * 0.35) / Math.PI;
    // the view is exposed as for a room of at least VIEW_LKEY_MIN nits: a dim lamp-lit room (photo-like lamp lumens,
    // add-lighting) would otherwise brighten the blue-hour view back toward the day photo
    const Sview = this._Starget * Math.pow(Math.min(1, Lkey / VIEW_LKEY_MIN), KEY.p);
    const view = clamp((Lout * Sview) / 0.5);
    this._exteriorLevel = Math.max(0.03, Math.sqrt(view));
    this._skyHex = skyHexFor(altDeg, dl.clear);
    // the 3D exterior (deck, railing, stair, annex) has its own sky light (add-lighting): the room's environment map
    // and ambient – warm lamp bounce – made it tan in the shade at 08:30. Display radiance of the sky dome with the
    // indoor exposure, soft-capped where the photo backdrops are shown as photographed (a camera indoors would clip
    // the view; the photos are HDR); like the backdrops it keeps the photos' own white balance (the room's evening
    // balance turned the deck violet); the ground (garden, deck) reflects OUTDOOR.ground.
    const skyPhys = (dl.Edh * Sview) / Math.PI;
    const skyRad = OUTDOOR.cap * (1 - Math.exp(-skyPhys / OUTDOOR.cap));
    // the dome's colour, not the deep blue of the zenith alone: the horizon glow, the facade and the trees round the
    // terrace (082841: the deck in shade reads neutral grey)
    const skyLight = lightColor(Math.min(dl.skyK, OUTDOOR.maxK));
    const groundLight = groundColor.clone().multiplyScalar(OUTDOOR.ground * (dl.Eglobal / Math.max(1e-6, dl.Edh)));
    this._outdoor = { sky: skyLight.multiplyScalar(skyRad), ground: groundLight.multiplyScalar(skyRad), envSize: this.profile.env };
    // (with the camera in another room _selectRoom sets it from that room's exposure instead)
    if (this._camRoomId === LIVING_ID || !this._worlds.has(this._camRoomId)) {
      this._exteriorFor = LIVING_ID;
      try {
        this.home?.exterior?.setDaylight?.(this._exteriorLevel, this._skyHex, this._outdoor);
      } catch (err) {
        console.warn('[lighting] exterior.setDaylight failed', err);
      }
    } else this._exteriorFor = null;

    this._info = {
      hour: this.time.hour, month: this.time.month, day: this.time.day, mode: this.mode, effective,
      weather, latitude: this.latitude,
      sunAltitudeDeg: this.mode === 'evening' || this.mode === 'night' ? altDeg : sun.altitudeDeg, sunAzimuthDeg: sun.azimuthDeg,
      sunUsedAltitudeDeg: altDeg,
      effectiveHour: effHour,
      horizonDeg: horizonElevation(sun.azimuthDeg, this._terrain.horizon),
      sunVisibility: vis,
      sunBlocked: this.mode !== 'evening' && this.mode !== 'night' && altDeg > -0.8 && vis < 0.05,
      sunFiltered: vis >= 0.05 && vis < 0.9,
      sunrise: times.sunrise, sunset: times.sunset, noon: times.noon, dayLength: times.dayLength,
      polarDay: times.polarDay, polarNight: times.polarNight, maxAltitudeDeg: times.maxAltitudeDeg,
      sunInRoom: this._windows.some((w) => w.sunFlux > 50),
      indoorDaylightLux: Math.round(dayFloorLux),
      outdoorLux: Math.round(dl.Eglobal),
      lampsOnByDefault: autoOn,
      lampLumens: Math.round(lampFlux),
      keyLuminance: Lkey,
    };
    // the living room's result; the other rooms are solved from it (portals) and the camera's room is selected
    this._livingRes = {
      Lkey, Starget: this._Starget, wbT: this._wbTarget.clone(), wbK: this._wbK, wbInfo: this._wbInfo, info: this._info,
      dayFloorLux, exteriorLevel: this._exteriorLevel, effective, wbRef,
    };
    if (this._worlds.size > 1) {
      this._livingExitance();
      this._recomputeRooms(dl, effective);
      this._selectRoom(false);
    }
    this.stats.recomputes = (this.stats.recomputes || 0) + 1;
    this._applyDirty = true;
    this._selectAt = -1e9;
    for (const fn of this._listeners) {
      try {
        fn(this._info);
      } catch (err) {
        console.warn('[lighting] listener failed', err);
      }
    }
  }

  /** Sky lights of the windows (rect): the living room's, then the other rooms'. */
  _extraRects() {
    const list = this._windows.map((w) => w.cand);
    for (const w of this._roomWindows) list.push(w.cand);
    return list;
  }

  /** Spot stand-ins: the sun-patch bounce lights and the windows' far-field spots. */
  _extraSpots() {
    const list = this._windows.map((w) => w.spotCand);
    for (const w of this._roomWindows) list.push(w.spotCand);
    if (this._bounces?.length) list.push(...this._bounces);
    return list;
  }

  /** Frees the slots of the previous bounce lights. @returns {[]} */
  _dropBounces() {
    for (const old of this._bounces || []) {
      if (old.slot && old.slot.cand === old) {
        old.slot.cand = null;
        old.slot.light.intensity = 0;
      }
      old.slot = null;
    }
    return [];
  }

  /**
   * Sun patches on the floor act as big upward-facing area lights (the light they reflect brightens the ceiling and
   * the undersides of furniture near them). One RectAreaLight per wall's group of windows; their first bounce is
   * taken out of the environment map's floor so nothing is counted twice.
   */
  _sunBounces(sunDir, sunColor) {
    const model = this._model;
    if (sunDir.y < 0.03) return this._dropBounces();
    const k = 1 / sunDir.y;
    const byWall = new Map();
    const pt = new THREE.Vector3();
    for (const w of this._windows) {
      if (!(w.sunFlux > 0) || !(w.floorFrac > 0)) continue;
      const bottom = w.center.clone().addScaledVector(w.up, -w.height / 2);
      const b0 = new THREE.Vector3(bottom.x - sunDir.x * bottom.y * k, 0, bottom.z - sunDir.z * bottom.y * k);
      const e2 = new THREE.Vector3(-sunDir.x * k * w.height, 0, -sunDir.z * k * w.height);
      // clip the patch where it leaves the floor (walls, the hall)
      let tMax = 0;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pt.copy(b0).addScaledVector(e2, t);
        if (this.layout.isInside(pt.x, pt.z)) tMax = t;
        else if (i > 0) break;
      }
      if (tMax <= 0) continue;
      const e2c = e2.clone().multiplyScalar(tMax);
      const center = b0.clone().addScaledVector(e2c, 0.5);
      const perp = e2c.clone().addScaledVector(w.right, -e2c.dot(w.right));
      const entry = { w, center, height: perp.length(), flux: w.sunFlux * w.floorFrac };
      const key = w.opening.wallId;
      if (!byWall.has(key)) byWall.set(key, []);
      byWall.get(key).push(entry);
    }
    const out = [];
    const col = sunColor.clone().multiply(model.floor.rho);
    const rhoLum = lum(col);
    col.multiplyScalar(1 / Math.max(1e-4, rhoLum));
    for (const [wallId, list] of byWall) {
      const right = list[0].w.right;
      let umin = Infinity, umax = -Infinity, flux = 0, hSum = 0, aSum = 0;
      const perpC = new THREE.Vector3();
      for (const e of list) {
        const u = e.center.dot(right);
        umin = Math.min(umin, u - e.w.width / 2);
        umax = Math.max(umax, u + e.w.width / 2);
        const ar = e.w.width * e.height;
        flux += e.flux;
        hSum += e.height * ar;
        aSum += ar;
        perpC.addScaledVector(e.center.clone().addScaledVector(right, -u), ar);
      }
      if (aSum < 0.05 || flux <= 0) continue;
      perpC.multiplyScalar(1 / aSum);
      const width = umax - umin;
      const height = Math.max(0.05, hSum / aSum);
      // a Lambertian disc facing up = a wide upward spot (I = Φ/π · cosθ); it sits a little under the floor so the
      // patch reads as an area source on the furniture right above it (and the floor itself, facing away, stays unlit)
      const area = width * height;
      const below = 0.25 + 0.3 * Math.sqrt(area);
      const position = perpC.addScaledVector(right, (umin + umax) / 2).setY(-below);
      const bounceFlux = flux * rhoLum;
      const up = new THREE.Vector3(0, 1, 0);
      out.push({
        id: `bounce:${wallId}`, kind: 'spot', source: 'bounce', position, direction: up, angle: 86 * DEG, penumbra: 1, lambert: true,
        width, height, area, gain: ((2.4 + below) / 2.4) ** 2,
        color: col.clone(), phys: 0, flux: bounceFlux, on: bounceFlux > 1, emissive: [], fade: 1, slot: null,
      });
      const b = out[out.length - 1];
      b.phys = (bounceFlux / Math.PI) * b.gain;
    }
    // keep the slots of bounce lights that still exist (same id), free the rest
    for (const c of out) {
      const old = this._bounces?.find((x) => x.id === c.id);
      if (old?.slot && old.slot.cand === old) {
        old.slot.cand = c;
        c.slot = old.slot;
        c.fade = old.fade;
        old.slot = null;
        this._configureSlot(c.slot, c);
      }
    }
    this._dropBounces();
    return out;
  }

  _allLampCandidates() {
    const list = [...this._builtIns];
    for (const l of this._items.values()) list.push(...l);
    if (this._houseLamps?.length) list.push(...this._houseLamps);
    return list;
  }

  /** Adds flux (lm) with a colour to the patches by precomputed weights (E in lux). */
  _deposit(weights, flux, color, day) {
    const P = this._model.patches;
    const key = day ? 'Eday' : 'E';
    for (let i = 0; i < P.length; i++) {
      const w = weights[i];
      if (!w) continue;
      const e = (flux * w) / P[i].area;
      P[i][key].r += e * color.r;
      P[i][key].g += e * color.g;
      P[i][key].b += e * color.b;
    }
  }

  /** _deposit into any model (key 'E' | 'Eday'). */
  _depositIn(model, weights, flux, color, key) {
    const P = model.patches;
    for (let i = 0; i < P.length; i++) {
      const w = weights[i];
      if (!w) continue;
      const e = (flux * w) / P[i].area;
      P[i][key].r += e * color.r;
      P[i][key].g += e * color.g;
      P[i][key].b += e * color.b;
    }
  }

  // ---- the other rooms (§4.3–4.5, §4.7) ----------------------------------------------------------------------

  /**
   * Daylight in every room but the living room: sky and ground light through its own windows (skyView, obstruction,
   * frosted glass from the data), the sun traced onto its patches, the daylight-only solve → its floor daylight and
   * its automatic lamps. Resets the rooms' lamp sums (the lamp loop of _recompute fills them).
   */
  _roomsDaylight(dl, sunDir, sunUp, sunColor, skyColor, groundColor) {
    const effOff = this.mode === 'day', effOn = this.mode === 'evening' || this.mode === 'night';
    for (const [id, W] of this._worlds) {
      if (W.living) continue;
      for (const p of W.model.patches) {
        p.E.setRGB(0, 0, 0);
        p.Eday.setRGB(0, 0, 0);
        p.Esun.setRGB(0, 0, 0);
      }
      W.lampFlux = 0;
      W.lampMired = 0;
      W.lampMiredW = 0;
      W.dayFlux = 0;
      W.skyTot = 0;
      W.sunTot = 0;
      for (const w of W.windows) {
        const t = this._transmission[w.id] ?? 1;
        const obstruction = w.opening.obstruction ?? OBSTRUCTION[w.id] ?? 1;
        const cosSun = Math.max(0, sunDir.dot(w.outward));
        const circum = dl.clear ? 0.45 * (0.25 + 0.75 * (dl.circum ?? 1)) : 0.05;
        // skyView (data, 0–1): the share of an open facade's sky a basement window sees over the terrain – the 0.42
        // and the circumsolar part shrink with it
        const sv = w.opening.skyView != null ? clamp(w.opening.skyView) : (w.coveredSky ?? 1);
        const EvSky = dl.Edh * sv * (0.42 + circum * cosSun);
        const EvGround = 0.5 * GROUND_RHO * dl.Eglobal;
        const Ev = EvSky + EvGround;
        const glassT = w.frosted ? HOUSE.frostedT : GLASS_T;
        w.L = (Ev * glassT * obstruction * t) / Math.PI;
        w.skyFlux = w.L * Math.PI * w.area;
        w.groundShare = EvGround / Math.max(1e-6, Ev);
        const winColor = addScaled(_c1.copy(skyColor).multiplyScalar(1 - w.groundShare), groundColor, w.groundShare);
        winColor.multiplyScalar(1 / Math.max(1e-6, lum(winColor)));
        w.cand.phys = w.L;
        w.cand.flux = w.skyFlux;
        w.cand.color.copy(winColor);
        w.cand.on = w.skyFlux > 1;
        w.spotCand.phys = w.L * w.area * w.spotCand.gain;
        w.spotCand.flux = w.skyFlux;
        w.spotCand.color.copy(winColor);
        W.dayFlux += w.skyFlux;
        W.skyTot += w.skyFlux;
        if (w.frosted && w.diffuseWeights) this._depositIn(W.model, w.diffuseWeights, w.skyFlux, winColor, 'Eday');
        else if (w.skyWeights) {
          this._depositIn(W.model, w.skyWeights, w.skyFlux * (1 - w.groundShare), skyColor, 'Eday');
          this._depositIn(W.model, w.groundWeights, w.skyFlux * w.groundShare, groundColor, 'Eday');
        }
        w.sunFlux = 0;
        w.floorFrac = 0;
        if (sunUp && cosSun > 0.01) {
          const sr = sunDir.dot(w.right), sy = sunDir.y;
          const reveal = Math.max(0, 1 - (w.glassDepth * Math.abs(sr)) / (cosSun * w.width)) * Math.max(0, 1 - (w.glassDepth * Math.abs(sy)) / (cosSun * w.height));
          w.sunFlux = dl.Edn * cosSun * glassT * w.area * reveal * t * obstruction * this._soffitSun(w, sunDir);
          W.dayFlux += w.sunFlux;
          W.sunTot += w.sunFlux;
          if (w.sunFlux > 0) {
            // frosted glass scatters the beam; clear glass lands it where it shines
            if (w.frosted && w.diffuseWeights) this._depositIn(W.model, w.diffuseWeights, w.sunFlux, sunColor, 'Eday');
            else w.floorFrac = this._traceSun(w, sunDir, sunColor, W.model);
          }
        }
      }
      // the room's own daylight (portals come in _recomputeRooms): the automatic lamps follow it
      solveRadiosity(W.model, 'Eday', 'Bday', 8);
      let skyDirect = 0, indirect = 0;
      const fi = W.model.patches.indexOf(W.model.floor);
      for (const w of W.windows) {
        const ww = w.frosted ? w.diffuseWeights : w.skyWeights;
        if (ww) skyDirect += w.skyFlux * (w.frosted ? 1 : 1 - w.groundShare) * ww[fi];
      }
      indirect = this._indirectAtIn(W.model, fi, 'Bday') * W.model.floor.area;
      W.ownDayLux = (skyDirect + indirect) / Math.max(1, W.model.floorArea);
      W.autoOn = effOn ? true : effOff ? false : W.ownDayLux < LAMPS_ON_BELOW_LUX;
      W.dayFloorLux = W.ownDayLux;
      // what the lamp loop and the portals add on top
      for (const p of W.model.patches) {
        p.E0 = (p.E0 || new THREE.Color()).setRGB(0, 0, 0);
        p.Eday0 = (p.Eday0 || new THREE.Color()).copy(p.Eday);
      }
    }
  }

  /**
   * Share of a window's glass the sun reaches past the soffits above it (the covered forecourt's ceiling over the
   * entrance's side panels): 3 × 5 points on the glass, each ray toward the sun against every soffit's polygon at its
   * height. 1 without soffits (every window but the entrance's).
   */
  _soffitSun(w, sunDir) {
    if (!w.soffits?.length || !(sunDir.y > 1e-3)) return 1;
    let lit = 0, n = 0;
    for (const su of [-0.4, 0, 0.4]) {
      for (const sv of [-0.45, -0.25, 0, 0.25, 0.45]) {
        n++;
        const x = w.center.x + w.right.x * su * w.width + w.outward.x * 0.05;
        const y = w.center.y + sv * w.height;
        const z = w.center.z + w.right.z * su * w.width + w.outward.z * 0.05;
        const blocked = w.soffits.some((s) => {
          const k = (s.y - y) / sunDir.y;
          return k > 0 && pointInPoly(x + sunDir.x * k, z + sunDir.z * k, s.poly);
        });
        if (!blocked) lit++;
      }
    }
    return lit / n;
  }

  /** The living room's mean exitance (lux, rgb; daylight part apart) – what its portals send into the hall. */
  _livingExitance() {
    const W = this._worlds.get(LIVING_ID);
    if (!W || !this._model) return;
    const M = (W.M ||= new THREE.Color()).setRGB(0, 0, 0);
    const Md = (W.Mday ||= new THREE.Color()).setRGB(0, 0, 0);
    let a = 0;
    for (const p of this._model.patches) {
      if (p.kind === 'glass') continue;
      addScaled(M, p.B, p.area);
      addScaled(Md, p.Bday, p.area);
      a += p.area;
    }
    M.multiplyScalar(1 / Math.max(1, a));
    Md.multiplyScalar(1 / Math.max(1, a));
  }

  /**
   * The full solve of every other room: its lamps (deposited by _recompute) + daylight + the PORTALS – each open door,
   * opening and the stairwell sends the neighbour's mean exitance × its opening into the room (Lambertian about the
   * portal), its daylight part apart. In coupling order from the living room, twice (a room solved later can feed one
   * solved before it: kjellerstue → kjellergang). Then Lkey, the colour of the light and the white balance per room.
   */
  _recomputeRooms(dl, effective) {
    const ute = this._outsideExitance(dl);
    const gains = new Map(this._portalDefs.map((q) => [q.id, this._portalGain(q)]));
    // no light from the last solve: pass 0 couples forward only, pass 1 adds what comes back (deterministic)
    for (const W of this._worlds.values()) {
      if (W.living) continue;
      W.M.setRGB(0, 0, 0);
      W.Mday.setRGB(0, 0, 0);
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const id of this._roomOrder) {
        const W = this._worlds.get(id);
        if (!W) continue;
        const P = W.model.patches;
        // lamps (E, deposited by the lamp loop – keep them in E0 on the first pass) + daylight + portals
        for (const p of P) {
          if (pass === 0) p.E0.copy(p.E);
          p.E.copy(p.E0);
          p.Eday.copy(p.Eday0);
        }
        for (const p of P) {
          if (p.kind !== 'portal' || !p.portal) continue;
          const g = gains.get(p.portal.id) ?? 0;
          const N = p.neighbour === OUTSIDE_ID ? ute : this._worlds.get(p.neighbour);
          // the door leaf (closed part) reflects like the leaf; the open part absorbs and lets the neighbour in
          p.rho.copy(p.leafRho || _c3.setRGB(0.05, 0.05, 0.05)).multiplyScalar(p.portal.kind === 'door' ? 1 - g : 0);
          p.inM = (p.inM || new THREE.Color()).setRGB(0, 0, 0);
          p.inMday = (p.inMday || new THREE.Color()).setRGB(0, 0, 0);
          if (!N?.M || g <= 0) continue;
          p.inM.copy(N.M).multiplyScalar(g);
          p.inMday.copy(N.Mday).multiplyScalar(g);
          const fluxL = lum(p.inM) * p.area, fluxD = lum(p.inMday) * p.area;
          if (fluxL > 1e-6) this._depositIn(W.model, p.portalWeights, fluxL, _c1.copy(p.inM).multiplyScalar(1 / Math.max(1e-9, lum(p.inM))), 'E');
          if (fluxD > 1e-6) this._depositIn(W.model, p.portalWeights, fluxD, _c2.copy(p.inMday).multiplyScalar(1 / Math.max(1e-9, lum(p.inMday))), 'Eday');
        }
        solveRadiosity(W.model, 'Eday', 'Bday', 8);
        for (const p of P) p.E.add(p.Eday);
        solveRadiosity(W.model, 'E', 'B', 10);
        // the portals show what comes through them (environment map), the leaf what it reflects
        for (const p of P) {
          if (p.kind !== 'portal') continue;
          p.B.add(p.inM);
          p.Bday.add(p.inMday);
        }
        // mean exitance (what this room sends on) and the key luminance
        const M = W.M.setRGB(0, 0, 0), Md = W.Mday.setRGB(0, 0, 0);
        let a = 0, la = 0;
        for (const p of P) {
          if (p.kind === 'glass' || p.kind === 'portal') continue;
          addScaled(M, p.B, p.area);
          addScaled(Md, p.Bday, p.area);
          la += (lum(p.B) / Math.PI) * p.area;
          a += p.area;
        }
        M.multiplyScalar(1 / Math.max(1e-3, a));
        Md.multiplyScalar(1 / Math.max(1e-3, a));
        W.Lkey = Math.max(0.02, la / Math.max(1e-3, a));
        if (pass === 1) {
          // floor daylight incl. what the portals bring (the UI's number; the lamps follow the room's own windows):
          // the sky through its windows + all daylight bounce, as in the living room
          const fi = P.indexOf(W.model.floor);
          let skyDirect = 0;
          for (const w of W.windows) {
            const ww = w.frosted ? w.diffuseWeights : w.skyWeights;
            if (ww) skyDirect += w.skyFlux * (w.frosted ? 1 : 1 - w.groundShare) * ww[fi];
          }
          W.dayFloorLux = (skyDirect + this._indirectAtIn(W.model, fi, 'Bday') * W.model.floor.area) / Math.max(1, W.model.floorArea);
          this._whiteBalanceFor(W, dl, effective);
        }
      }
    }
  }

  /** The «room» outside the entrance door: daylight off the ground and the forecourt's lamps (mean exitance, lux). */
  _outsideExitance(dl) {
    const o = this._ute ||= { M: new THREE.Color(), Mday: new THREE.Color() };
    const sky = lightColor(dl.skyK);
    o.Mday.copy(sky).multiplyScalar(GROUND_RHO * dl.Eglobal);
    let lamp = 0;
    const col = _c1.setRGB(0, 0, 0);
    for (const c of this._houseLamps) {
      if (c.roomId !== OUTSIDE_ID || !(c.flux > 0)) continue;
      lamp += c.flux;
      addScaled(col, c.color, c.flux);
    }
    o.M.copy(o.Mday);
    if (lamp > 0) addScaled(o.M, col.multiplyScalar(1 / lamp), (lamp * 0.25) / 12); // ≈ 12 m² under the soffit, ρ 0.25
    return o;
  }

  /** _indirectAt for any model. */
  _indirectAtIn(model, i, key) {
    const { patches, F } = model;
    const n = patches.length;
    let s = 0;
    for (let j = 0; j < n; j++) {
      const f = F[i * n + j];
      if (f) s += f * lum(patches[j][key]);
    }
    return s;
  }

  /** White balance of a room (the living room's rule, see WB and _recompute) → W.wbT, W.wbK, W.wbInfo. */
  _whiteBalanceFor(W, dl, effective) {
    const { patches, F } = W.model;
    const n = patches.length;
    const illum = new THREE.Color(0, 0, 0), illumDay = new THREE.Color(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const p = patches[i];
      if (p.kind === 'glass' || p.kind === 'portal') continue;
      let r = p.E.r, g = p.E.g, b = p.E.b;
      let rd = p.Eday.r, gd = p.Eday.g, bd = p.Eday.b;
      for (let j = 0; j < n; j++) {
        const f = F[i * n + j];
        if (!f) continue;
        const q = patches[j];
        r += f * q.B.r;
        g += f * q.B.g;
        b += f * q.B.b;
        rd += f * q.Bday.r;
        gd += f * q.Bday.g;
        bd += f * q.Bday.b;
      }
      illum.r += r * p.area;
      illum.g += g * p.area;
      illum.b += b * p.area;
      illumDay.r += rd * p.area;
      illumDay.g += gd * p.area;
      illumDay.b += bd * p.area;
    }
    const illumLamp = new THREE.Color(Math.max(0, illum.r - illumDay.r), Math.max(0, illum.g - illumDay.g), Math.max(0, illum.b - illumDay.b));
    const nightScale = W.model.totalArea / Math.max(1, this._model?.totalArea ?? 200);
    addScaled(illumDay, NIGHT_COLOR, NIGHT_FLOOR_LUX * 100 * nightScale);
    const dayL = lum(illumDay), lampL = lum(illumLamp);
    const wbp = this._wbParams;
    const m = (lampL * wbp.pull) / Math.max(1e-6, dayL + lampL * wbp.pull);
    const alone = 1 - smoothstep(0, 0.08, m);
    const skyTot = W.skyTot || 0, sunTot = W.sunTot || 0;
    // a room without windows of its own gets its daylight through the portals, already warm from the rooms it passed:
    // balance on that light's own colour, not on 7000 K (the hall seen from the living room at 12:00 read dark orange;
    // the review of steg 13+27, integrator bølge 1 gruppe 2)
    const srcDayMired = skyTot + sunTot > 1e-6 ? (skyTot * 1e6 / dl.skyK + sunTot * 1e6 / dl.sunK) / (skyTot + sunTot) : 1e6 / cctOf(illumDay);
    const dayMired = lerp(srcDayMired, 1e6 / cctOf(illumDay), alone);
    const lampSrcMired = W.lampMiredW > 1e-6 ? W.lampMired / W.lampMiredW : 1e6 / 2700;
    const lampMiredAvg = lampL > 1e-6 ? lerp(lampSrcMired, 1e6 / cctOf(illumLamp), WB.lampsMeasured * smoothstep(0.5, 0.95, m)) : lampSrcMired;
    const M65 = 1e6 / 6500;
    const al = this._lampAdapt(effective);
    const srcM = lerp(dayMired, lampMiredAvg, m);
    const aD = lerp(wbp.day, wbp.dayAlone, alone);
    const appM = lerp(dayMired + aD * (M65 - dayMired), lampMiredAvg + al * (M65 - lampMiredAvg), m);
    const kOf = (mired) => 1e6 / clamp(mired, 1e6 / 15000, 1e6 / 1200);
    const A = kelvinToColor(kOf(appM), new THREE.Color()), Sc = kelvinToColor(kOf(srcM), new THREE.Color());
    const wbT = W.wbT;
    wbT.setRGB(A.r / Math.max(1e-4, Sc.r), A.g / Math.max(1e-4, Sc.g), A.b / Math.max(1e-4, Sc.b));
    W.wbK = [Math.round(kOf(srcM)), Math.round(kOf(appM))];
    const ref = new THREE.Color().copy(illumDay).add(illumLamp).multiplyScalar(1 / Math.max(1e-6, dayL + lampL));
    W.wbRef = ref.clone();
    ref.multiply(wbT);
    wbT.multiplyScalar(1 / Math.max(1e-4, lum(ref)));
    const dayShare = dayL / Math.max(1e-6, dayL + lampL);
    W.wbInfo = { dayShare, lampShare: W.lampFlux / Math.max(1, W.lampFlux + W.dayFlux), lampWeight: m, whiteK: W.wbK };
  }

  /**
   * Drives exposure, white balance, the info numbers, the environment map and the other rooms' indirect light from the
   * camera's room. The living room: exactly its own solve (as before). Another room: its Lkey, at least min(2, the
   * largest Lkey the camera can reach) (§4.5), its white balance; every other room its own flat irradiance.
   * @param {boolean} changed  the camera just changed room (ease over HOUSE.roomEase)
   */
  _selectRoom(changed) {
    const L = this._livingRes;
    if (!L) return;
    const id = this._camRoomId;
    const W = this._worlds.get(id);
    const reach = this._reachable();
    const ov = this._overview ? this._levelAggregate(this._overview) : null;
    if (ov) {
      // an overview (orbit / plan, setOverviewLevel): one exposure and white balance for the level, area-weighted over
      // its rooms; the environment map stays the level's main room's (id), the other rooms scaled relative to it
      this._Lkey = ov.Lkey;
      this._Starget = (this._key * (MODE_KEY[L.effective] ?? 1) * this.exposure) / (Math.pow(ov.Lkey, KEY.p) * Math.pow(KEY.L0, 1 - KEY.p));
      this._wbTarget.copy(ov.wbT);
      this._wbK = W && !W.living ? W.wbK : L.wbK;
      this._wbInfo = W && !W.living ? W.wbInfo : L.wbInfo;
      this._info = {
        ...L.info, room: id, overview: this._overview, indoorDaylightLux: Math.round(ov.dayFloorLux), lampLumens: Math.round(ov.lampFlux),
        keyLuminance: ov.Lkey, sunInRoom: ov.sunInRoom,
      };
      this._applyExterior(this._Starget, ov.Lkey, `overview:${this._overview}`);
    } else if (!W || W.living) {
      this._Lkey = L.Lkey;
      this._Starget = L.Starget;
      this._wbTarget.copy(L.wbT);
      this._wbK = L.wbK;
      this._wbInfo = L.wbInfo;
      this._info = L.info;
      if (this._exteriorFor !== LIVING_ID) this._applyExterior(L.Starget, L.Lkey, LIVING_ID);
    } else {
      let reachMax = 0;
      for (const r of reach) {
        if (r === id) continue;
        const o = this._worlds.get(r);
        if (o) reachMax = Math.max(reachMax, o.living ? L.Lkey : o.Lkey);
      }
      const Lkey = Math.max(W.Lkey, Math.min(HOUSE.reachLkeyCap, reachMax));
      this._Lkey = Lkey;
      this._Starget = (this._key * (MODE_KEY[L.effective] ?? 1) * this.exposure) / (Math.pow(Lkey, KEY.p) * Math.pow(KEY.L0, 1 - KEY.p));
      this._wbTarget.copy(W.wbT);
      this._wbK = W.wbK;
      this._wbInfo = W.wbInfo;
      this._info = {
        ...L.info, room: id, indoorDaylightLux: Math.round(W.dayFloorLux), lampsOnByDefault: !!W.autoOn,
        lampLumens: Math.round(W.lampFlux), keyLuminance: Lkey, sunInRoom: W.windows.some((w) => w.sunFlux > 50),
      };
      this._applyExterior(this._Starget, Lkey, id);
    }
    this._info.room = id;
    // white balance of every other room relative to the camera's (its light seen through a doorway in its own colour,
    // HOUSE.wbLocal): used for its light slots and glowing lamps (_apply) and its flat irradiance below
    this._wbRel.clear();
    if (this._worlds.size > 1) {
      for (const [rid, R] of this._worlds) {
        if (rid === id && !ov) continue;
        this._wbRel.set(rid, this._wbRelOf(R, this._wbTarget, new THREE.Color()));
      }
    }
    // indirect light of the other rooms (lightmask): each its own FLAT irradiance – its mean exitance in its relative
    // white balance (+ the night floor of the ambient), × S × wb in _apply – instead of the camera room's map, whose
    // colour at a given normal is the camera room's (from the living room the hall's wall faced the Marrakesh wall and
    // went lavender / pink); the map's reflections × the room's luminance relative to the camera room's. The camera's
    // room (a fragment also in it: the closed door leaf, the reveal) and outside as is: the living room looks as before
    const t = this._table;
    this._roomFlat = [];
    if (t) {
      const C = W && !W.living ? W.M : this._worlds.get(LIVING_ID)?.M;
      const lc = C ? lum(C) : 0;
      for (const [rid, R] of this._worlds) {
        const e = t.byId[rid];
        if (!e) continue;
        if (rid === id || !R.M) {
          lightMask.setRoomAsIs(e.index, rid === id);
          continue;
        }
        const base = R.M.clone();
        const rel = this._wbRel.get(rid);
        if (rel) base.multiply(rel);
        addScaled(base, NIGHT_COLOR, NIGHT_FLOOR_LUX);
        this._roomFlat.push({ id: rid, index: e.index, base, reflect: lc > 1e-6 ? clamp(lum(base) / lc, 0, 50) : 1 });
      }
      if (!this._worlds.has(id)) lightMask.setRoomAsIs(t.byId[LIVING_ID].index, true);
      lightMask.setRoomAsIs(t.outside, false);
      this._applyDirty = true;
    }
    if (changed) {
      this._roomEaseUntil = this._clock + HOUSE.roomEase;
      this._selectAt = -1e9;
      this._applyDirty = true;
      for (const fn of this._listeners) {
        try {
          fn(this._info);
        } catch (err) {
          console.warn('[lighting] listener failed', err);
        }
      }
    }
  }

  /**
   * White balance of room R relative to the camera's (cam = the camera room's target): (R.wbT / cam)^wbLocal per
   * channel (ratio clamped to 1/wbRelMax…wbRelMax), scaled so R's own light keeps the luminance it has under the
   * camera's balance – only its colour adapts toward how it looks from inside R.
   */
  _wbRelOf(R, cam, out) {
    const wbT = R.living ? this._livingRes?.wbT : R.wbT;
    const ref = R.living ? this._livingRes?.wbRef : R.wbRef;
    out.setRGB(1, 1, 1);
    if (!wbT || !ref) return out;
    const k = HOUSE.wbLocal, m = HOUSE.wbRelMax;
    const ch = (a, b) => Math.pow(clamp(a / Math.max(1e-4, b), 1 / m, m), k);
    out.setRGB(ch(wbT.r, cam.r), ch(wbT.g, cam.g), ch(wbT.b, cam.b));
    const a = lum(_c2.copy(ref).multiply(cam)), b = lum(_c3.copy(ref).multiply(cam).multiply(out));
    if (a > 1e-6 && b > 1e-6) out.multiplyScalar(a / b);
    return out;
  }

  /**
   * One value for a level (the overviews, §4.3): Lkey, white balance, daylight and lamp lumens of its rooms,
   * area-weighted (the living room with its own solve). null when the level has no lit room.
   */
  _levelAggregate(levelId) {
    const L = this._livingRes;
    let A = 0, Lk = 0, day = 0, lamps = 0, sun = false;
    const wb = new THREE.Color(0, 0, 0);
    for (const R of this._worlds.values()) {
      if ((R.room?.levelId ?? 'hoved') !== levelId) continue;
      const a = R.living ? this.layout?.floorArea ?? R.model?.totalArea ?? 50 : R.room?.area ?? 0;
      if (!(a > 0)) continue;
      const wbT = R.living ? L?.wbT : R.wbT;
      A += a;
      Lk += a * (R.living ? L?.Lkey ?? 0.02 : R.Lkey ?? 0.02);
      day += a * (R.living ? L?.dayFloorLux ?? 0 : R.dayFloorLux ?? 0);
      lamps += R.living ? L?.info?.lampLumens ?? 0 : R.lampFlux ?? 0;
      if (wbT) addScaled(wb, wbT, a);
      sun = sun || (R.living ? !!L?.info?.sunInRoom : R.windows.some((w) => w.sunFlux > 50));
    }
    if (!(A > 0)) return null;
    return { Lkey: Math.max(0.02, Lk / A), wbT: wb.multiplyScalar(1 / A), dayFloorLux: day / A, lampFlux: lamps, sunInRoom: sun };
  }

  /** The photo backdrop and the 3D exterior's sky light for an exposure (the same formula as in _recompute). */
  _applyExterior(Starget, Lkey, roomId) {
    this._exteriorFor = roomId;
    const dl = this._daylight;
    if (!dl) return;
    const Lout = (dl.Eglobal * 0.35) / Math.PI;
    const Sview = Starget * Math.pow(Math.min(1, Lkey / VIEW_LKEY_MIN), KEY.p);
    const view = clamp((Lout * Sview) / 0.5);
    this._exteriorLevel = Math.max(0.03, Math.sqrt(view));
    const skyPhys = (dl.Edh * Sview) / Math.PI;
    const skyRad = OUTDOOR.cap * (1 - Math.exp(-skyPhys / OUTDOOR.cap));
    const skyLight = lightColor(Math.min(dl.skyK, OUTDOOR.maxK));
    const groundLight = (this._groundColor || new THREE.Color(1, 1, 1)).clone().multiplyScalar(OUTDOOR.ground * (dl.Eglobal / Math.max(1e-6, dl.Edh)));
    this._outdoor = { sky: skyLight.multiplyScalar(skyRad), ground: groundLight.multiplyScalar(skyRad), envSize: this.profile.env };
    try {
      this.home?.exterior?.setDaylight?.(this._exteriorLevel, this._skyHex, this._outdoor);
    } catch (err) {
      console.warn('[lighting] exterior.setDaylight failed', err);
    }
  }

  /** Traces the sun beam through a window onto the room patches (9 rays). */
  _traceSun(w, sunDir, color, model = this._model) {
    const d = this._traceDir.copy(sunDir).negate(); // own vector: patch.hit() uses the shared temporaries
    const per = w.sunFlux / w.samples.length;
    let floorHits = 0;
    const o = new THREE.Vector3();
    for (const [su, sv] of w.samples) {
      o.copy(w.center).addScaledVector(w.right, su * w.width).addScaledVector(w.up, sv * w.height).addScaledVector(w.normal, 0.04);
      let best = null, bestT = Infinity;
      for (const p of model.patches) {
        const t = p.hit(o, d);
        if (t != null && t < bestT) {
          bestT = t;
          best = p;
        }
      }
      if (!best) continue;
      const onFloor = best.kind === 'floor';
      if (onFloor) floorHits++;
      const e = per / best.area;
      if (onFloor) addScaled(best.Esun, color, e);
      best.Eday.r += e * color.r;
      best.Eday.g += e * color.g;
      best.Eday.b += e * color.b;
    }
    return floorHits / w.samples.length;
  }

  /** Indirect illuminance (lux, luminance) arriving at patch i from the solved exitances. */
  _indirectAt(i, key) {
    const { patches, F } = this._model;
    const n = patches.length;
    let s = 0;
    for (let j = 0; j < n; j++) {
      const f = F[i * n + j];
      if (f) s += f * lum(patches[j][key]);
    }
    return s;
  }

  /** Points the sun at the room and fits the orthographic shadow camera tightly around it. */
  _placeSun(dir) {
    const key = `${dir.x.toFixed(4)},${dir.y.toFixed(4)},${dir.z.toFixed(4)}`;
    if (key === this._sunKey) return;
    this._sunKey = key;
    const sun = this.sun;
    const c = this._shadowBox.getCenter(new THREE.Vector3());
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(dir, 25);
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    const cam = sun.shadow.camera;
    cam.position.copy(sun.position);
    cam.lookAt(c);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const b = this._shadowBox;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
      _v1.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(inv);
      minX = Math.min(minX, _v1.x);
      maxX = Math.max(maxX, _v1.x);
      minY = Math.min(minY, _v1.y);
      maxY = Math.max(maxY, _v1.y);
      minZ = Math.min(minZ, _v1.z);
      maxZ = Math.max(maxZ, _v1.z);
    }
    const pad = 0.1;
    cam.left = minX - pad;
    cam.right = maxX + pad;
    cam.bottom = minY - pad;
    cam.top = maxY + pad;
    cam.near = Math.max(0.1, -maxZ - 4); // 4 m toward the sun: eaves, railings
    cam.far = -minZ + 0.5;
    cam.updateProjectionMatrix();
    // the sun's shadow map is a full scene pass: while the clock slider is dragged it is re-rendered at most every
    // SUN_SHADOW_INTERVAL s (update() sends the last one) instead of every frame
    this._sunShadowPending = true;
  }

  // ---- per frame -------------------------------------------------------------------------------------------

  /** Assigns pool slots to the sources that contribute most to the camera (with hysteresis). */
  _budget(camera, dt) {
    const cp = camera?.position;
    const moved = cp ? cp.distanceToSquared(this._lastCamPos) > 0.25 : false;
    if (!moved && this._clock - this._selectAt < 0.25) {
      this._fades(dt);
      return;
    }
    this._selectAt = this._clock;
    if (cp) this._lastCamPos.copy(cp);
    if (camera?.getWorldDirection) this._camFwd = camera.getWorldDirection(this._camFwd || new THREE.Vector3());
    const groups = { point: [], spot: [], rect: [] };
    // only the sources of the rooms the camera can reach (§4.1: with the doors shut, the living room's own), weighted
    // by the portals on the way (a lamp behind a door is seen through the doorway: it must not take the camera room's
    // own slots – HOUSE.hop; the camera's room and, outside the house, OUTSIDE weigh 1)
    const reach = this._worlds.size > 1 ? this._reachWeights(this._overview ? 2 : HOUSE.slotDepth) : null;
    const ok = (c) => !reach || reach.has(c.roomId ?? LIVING_ID);
    // the outdoor lamps hang under the forecourt's ceiling at the entrance level: from the terrace a storey higher
    // (round the corner) they weigh like a lamp behind the stairwell
    const weight = (c) => {
      if (!reach) return 1;
      const w = reach.get(c.roomId ?? LIVING_ID) ?? 0;
      return c.roomId === OUTSIDE_ID && !this._overview && cp && Math.abs(c.position.y - cp.y) > 2 ? w * HOUSE.hop.hole : w;
    };
    this._reach = reach;
    for (const c of this._allLampCandidates()) if (c.on && c.flux > 0 && ok(c)) groups[c.kind]?.push(c);
    for (const c of this._extraRects()) if (c.on && ok(c)) groups.rect.push(c);
    // rect slots first: windows without one compete for a plain spot slot with their far-field stand-in
    for (const kind of ['rect', 'point', 'spot']) {
      const slots = this._pool[kind];
      if (kind === 'spot') {
        for (const w of [...this._windows, ...this._roomWindows]) {
          const sc = w.spotCand;
          sc.on = w.cand.on && !(w.cand.slot && w.cand.slot.cand === w.cand);
          if (sc.on && ok(sc)) groups.spot.push(sc);
        }
        for (const b of this._bounces || []) if (b.on && ok(b)) groups.spot.push(b);
      }
      const list = groups[kind];
      for (const c of list) {
        c.score = this._score(c, cp);
        const w = weight(c);
        if (w !== 1) c.score *= w;
      }
      if (kind === 'spot') this._assignSpots(slots, list);
      else this._assign(slots, list);
    }
    // candidates that lost their slot
    for (const c of this._allLampCandidates()) if (c.slot && (!c.on || c.slot.cand !== c)) c.slot = null;
    for (const c of this._extraRects()) if (c.slot && (!c.on || c.slot.cand !== c)) c.slot = null;
    for (const c of this._extraSpots()) if (c.slot && (!c.on || c.slot.cand !== c)) c.slot = null;
    this._applyDirty = true;
    this._fades(dt);
  }

  _score(c, cp) {
    if (!cp) return c.flux;
    let d2;
    if (c.kind === 'rect') {
      // distance to the nearest point of the rectangle
      _v1.copy(cp).sub(c.position);
      const u = clamp(_v1.dot(c.right), -c.width / 2, c.width / 2);
      _v2.crossVectors(c.normal, c.right).normalize();
      const v = clamp(_v1.dot(_v2), -c.height / 2, c.height / 2);
      _v3.copy(c.position).addScaledVector(c.right, u).addScaledVector(_v2, v);
      d2 = _v3.distanceToSquared(cp);
    } else d2 = c.position.distanceToSquared(cp);
    // sources well behind the camera light less of what is seen
    let view = 1;
    if (this._camFwd && d2 > 6) {
      _v1.copy(c.position).sub(cp).normalize();
      const f = _v1.dot(this._camFwd);
      view = f > 0.1 ? 1 : f > -0.4 ? 0.7 : 0.35;
    }
    // direct light near the camera if this source ends up without a slot (ambient fallback): only the part of a
    // spot's / strip's / window's lobe that points toward the camera's surroundings
    let lobe = 1;
    const axis = c.kind === 'spot' ? c.direction : c.kind === 'rect' ? c.normal : null;
    if (axis) {
      _v1.copy(cp).sub(c.position).normalize();
      lobe = 0.15 + 0.85 * clamp(axis.dot(_v1));
    }
    c.ambLux = (c.flux * AMB_K * lobe) / (d2 + AMB_R2);
    // the high-wall spots draw visible scallops and the LED coves a warm wash under the ceiling: they matter more than
    // their flux says (add-lighting: at photo-like lumens the coves lost every rect slot to the windows, whose
    // far-field spot stand-in looks nearly the same from a few metres – the cove without its wash does not)
    const signature = c.wantsShadow ? 2.5 : c.strip ? (c.stripSignature ?? STRIP_SIGNATURE) : 1;
    return (c.flux * view * signature * (c.slot ? 1.3 : 1)) / (1 + d2);
  }

  _assign(slots, list) {
    list.sort((a, b) => b.score - a.score);
    const keep = new Set(list.slice(0, slots.length));
    for (const s of slots) if (s.cand && !keep.has(s.cand)) {
      s.cand.slot = null;
      s.cand = null;
    }
    for (const c of keep) {
      if (c.slot && c.slot.cand === c && slots.includes(c.slot)) continue;
      const free = slots.find((s) => !s.cand);
      if (!free) break;
      free.cand = c;
      c.slot = free;
      c.fade = this._S == null || this._clock < 0.5 ? 1 : 0;
      this._configureSlot(free, c);
      if (free.shadowed) this._requestSunShadow(free); // a spare shadow slot of the high-wall spots
    }
  }

  /**
   * Spots: shadow-casting slots go to the high-wall spots first; the ones they leave (spots off) light other lamps,
   * with shadows, like the plain slots.
   */
  _assignSpots(slots, list) {
    const shadowSlots = slots.filter((s) => s.shadowed);
    const plain = slots.filter((s) => !s.shadowed);
    const wants = list.filter((c) => c.wantsShadow).sort((a, b) => b.score - a.score);
    const shadowed = wants.slice(0, shadowSlots.length);
    const rest = list.filter((c) => !shadowed.includes(c));
    // shadowed slots: free those of lamps that are gone, then seat the high-wall spots (evicting a borrower if needed)
    for (const s of shadowSlots) if (s.cand && !list.includes(s.cand)) {
      s.cand.slot = null;
      s.cand = null;
    }
    for (const c of shadowed) {
      if (c.slot && c.slot.cand === c && c.slot.shadowed) continue;
      if (c.slot) {
        c.slot.cand = null;
        c.slot = null;
      }
      const free = shadowSlots.find((s) => !s.cand) ?? shadowSlots.find((s) => !s.cand.wantsShadow || !shadowed.includes(s.cand));
      if (!free) break;
      if (free.cand) free.cand.slot = null;
      free.cand = c;
      c.slot = free;
      c.fade = this._S == null || this._clock < 0.5 ? 1 : 0;
      this._configureSlot(free, c);
      this._requestSunShadow(free);
    }
    const spare = shadowSlots.filter((s) => !s.cand || !shadowed.includes(s.cand));
    for (const c of rest) if (c.slot?.shadowed && !spare.includes(c.slot)) c.slot = null;
    this._assign([...plain, ...spare], rest);
    // shadow slots only for cones ≤ 50° (§4.9): a wide house lamp (plafond, grouped downlights) that landed in a spare
    // shadow slot swaps with a lamp in a plain slot that may cast shadows (the living room's lamps never have noShadow)
    for (const s of spare) {
      if (!s.cand?.noShadow) continue;
      const p = plain.find((q) => q.cand && !q.cand.noShadow);
      if (!p) break;
      const a = s.cand, b = p.cand;
      s.cand = b;
      b.slot = s;
      p.cand = a;
      a.slot = p;
      this._configureSlot(s, b);
      this._configureSlot(p, a);
      this._requestSunShadow(s);
    }
  }

  /** Copies a candidate's geometry into a pool light. */
  _configureSlot(s, c) {
    const l = s.light;
    if (c.kind === 'rect') {
      l.position.copy(c.position);
      l.quaternion.copy(c.quat);
      l.width = c.width;
      l.height = c.height;
    } else if (c.kind === 'spot') {
      l.position.copy(c.position);
      l.target.position.copy(c.position).add(c.direction);
      l.angle = c.angle;
      l.penumbra = c.penumbra;
      l.target.updateMatrixWorld();
    } else {
      l.position.copy(c.position);
    }
    l.updateMatrixWorld();
  }

  _fades(dt) {
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.15) : 0;
    let changing = false;
    const step = (c) => {
      if (c.slot && c.fade < 1) {
        c.fade = Math.min(1, c.fade + (1 - c.fade) * k + (k > 0 ? 0.02 : 0));
        changing = true;
      }
    };
    for (const c of this._allLampCandidates()) step(c);
    for (const c of this._extraRects()) step(c);
    for (const c of this._extraSpots()) step(c);
    if (changing) this._applyDirty = true;
  }

  /** Writes the light values (× scene scale, × white balance) into three.js. */
  _apply() {
    const S = this._S ?? this._Starget;
    if (!this._applyDirty && S === this._appliedS) return;
    this._applyDirty = false;
    this._appliedS = S;
    const wb = this._wb;

    // sun
    this.sun.intensity = this._sunPhys * S;
    this.sun.color.copy(this._sunColor || _c1.setRGB(1, 1, 1)).multiply(wb);

    // pools + ambient for the sources without a slot
    let ambLux = NIGHT_FLOOR_LUX;
    const ambCol = this._ambCol.copy(NIGHT_COLOR).multiplyScalar(NIGHT_FLOOR_LUX);
    const A = this._model?.totalArea ?? 200;
    // the direct light of a source without a slot as ambient: what it gives the surfaces around the camera
    // (c.ambLux from _score), not its flux spread over the whole room – that made every surface equally lit
    const ambOf = (c) => c.ambLux ?? c.flux / A;
    const addAmbient = (c) => {
      const e = ambOf(c);
      ambLux += e;
      addScaled(ambCol, c.color, e);
    };
    const masks = !!this._table;
    for (const kind of ['point', 'spot', 'rect']) {
      for (const s of this._pool[kind]) {
        const c = s.cand;
        if (masks) {
          // the slot lights the room of its source (lightmask.js), through the portals from where the light is
          const [bits, home] = c ? this._maskOf(c) : [0, 0];
          lightMask.setSlot(kind, s.shaderIndex ?? 0, bits, home, c ? _v1.setFromMatrixPosition(s.light.matrixWorld) : null);
        }
        if (!c || !c.on) {
          s.light.intensity = 0;
          continue;
        }
        const f = c.fade ?? 1;
        s.light.intensity = c.phys * S * f;
        s.light.color.copy(c.color).multiply(wb);
        // another room's source in (mostly) its own white balance (HOUSE.wbLocal); the camera room's exactly as before
        const rel = masks ? this._wbRelFor(c.roomId) : null;
        if (rel) s.light.color.multiply(rel);
        if (f < 1) {
          ambLux += ambOf(c) * (1 - f);
          addScaled(ambCol, c.color, ambOf(c) * (1 - f));
        }
      }
    }
    // only the camera room's sources without a slot: the ambient term is the light round the camera (other rooms get
    // theirs through their flat irradiance, lightmask)
    const here = (c) => !masks || (c.roomId ?? LIVING_ID) === this._camRoomId;
    for (const c of this._allLampCandidates()) if (c.on && !c.slot && here(c)) addAmbient(c);
    // a window without a rect slot is lit by its far-field spot when that has a slot (its fade-in is ambient above)
    for (const c of this._extraRects()) if (c.on && !c.slot && !c.spotCand?.slot && here(c)) addAmbient(c);
    for (const c of this._bounces || []) if (c.on && !c.slot && here(c)) addAmbient(c);
    // eased (the budget re-runs every 0.25 s / 0.5 m of camera movement)
    this._ambTarget = ambLux;
    if (this._ambNow == null) this._ambNow = ambLux;
    this.ambient.intensity = this._ambNow * S;
    this.ambient.color.copy(ambCol.multiplyScalar(1 / Math.max(1e-6, lum(ambCol)))).multiply(wb);

    // the other rooms' flat irradiance in display units (what the camera room's map gives: exitance × S × wb)
    if (masks) {
      for (const f of this._roomFlat || []) {
        _c1.copy(f.base).multiply(wb).multiplyScalar(S);
        lightMask.setRoomFlat(f.index, _c1.r, _c1.g, _c1.b, f.reflect);
      }
    }

    // emissive meshes of every lamp (whether it has a slot or not)
    if (this._emissiveDirty || !this._emissive) this._rebuildEmissiveIndex();
    for (const e of this._emissive) this._applyEmissive(e, S, wb);

    // environment brightness follows the scale between rebuilds
    if (this.scene.environment && this._envRT) this.scene.environmentIntensity = this._Senv > 0 ? S / this._Senv : 1;
    this.stats.S = S;
  }

  /**
   * White balance of a source's room relative to the camera's (_wbRelOf, set in _selectRoom), or null for the camera's
   * own room (and outside): those are drawn exactly as before.
   */
  _wbRelFor(roomId) {
    const id = roomId ?? LIVING_ID;
    if (id === this._camRoomId && !this._overview) return null;
    return this._wbRel.get(id) ?? null;
  }

  /** The colour a source's light slot gets (its light × the white balance, × its room's relative balance). */
  slotColor(c, out = new THREE.Color()) {
    out.copy(c.color).multiply(this._wb);
    const rel = this._table ? this._wbRelFor(c.roomId) : null;
    return rel ? out.multiply(rel) : out;
  }

  /** Glowing parts: luminance = lumens of their lamps over their area (half of a closed mesh faces outward), capped. */
  _applyEmissive(e, S, wb) {
    let lm = 0, lmFull = 0;
    const col = _c1.setRGB(0, 0, 0);
    for (const c of e.cands) {
      if (!c.on) continue;
      const f = c.lumens * c.dimmer;
      lm += f;
      lmFull += c.lumens;
      addScaled(col, c.color, f);
    }
    const mat = e.mat;
    if (lm <= 0) {
      mat.emissiveIntensity = 0;
      return;
    }
    col.multiplyScalar(1 / lm);
    let L;
    const base = mat.userData?.baseIntensity;
    const blended = mat.blending === THREE.CustomBlending;
    // light ON a surface, not a glowing part: a ceiling pool decal (lamps.js ceilingPool) or an LED's wash on a cabinet's
    // back panel (kitchen.js, userData.lightWash)
    const wash = (blended || mat.userData?.lightWash === true) && Number.isFinite(base) && base > 0;
    if (wash) {
      // its nominal luminance is for the fixture at full power, so it follows the dimmer linearly – the bulbs' √ curve
      // with its 0.6 floor and the 20-nit minimum below kept the chandelier's ceiling pool at ≈ 80 % of full while the
      // lamp itself was at 29 %
      L = base * EMISSIVE_NITS_PER_UNIT * clamp(Math.sqrt(lmFull / 800), 0.6, 2.2) * (lm / Math.max(1e-6, lmFull));
    } else if (Number.isFinite(base) && base > 0) {
      // the model's own relative glow (bulb vs. shade vs. lit inside, tuned for a night view) in nits, louder for
      // stronger lamps – keeps translucent shades and shade insides coloured instead of white-hot
      L = base * EMISSIVE_NITS_PER_UNIT * clamp(Math.sqrt(lm / 800), 0.6, 2.2);
    } else {
      // no hint: lumens over the glowing area (half of a closed mesh faces outward)
      L = (0.8 * lm) / (Math.PI * Math.max(1e-4, e.area) * 0.5);
    }
    L = clamp(L, wash ? 0 : 20, 30000);
    mat.emissive.copy(col).multiply(wb);
    const rel = this._table ? this._wbRelFor(e.cands[0]?.roomId) : null;
    if (rel) mat.emissive.multiply(rel);
    const mapK = mat.emissiveMap ? 1.6 : 1;
    let D = L * S * mapK; // display level (1 ≈ white paper)
    if (!blended) {
      // soft cap on the brightest channel (add-lighting): an LED line or a bulb is thousands of nits – far past white –
      // and PBR Neutral then bleaches it to white (the LED coves and the kitchen ring read as cold white lines; photos:
      // amber lines with a pale core). Rolled off toward EMISSIVE_DISPLAY_CAP so the light's colour survives.
      const peak = Math.max(1e-4, mat.emissive.r, mat.emissive.g, mat.emissive.b);
      D = (EMISSIVE_DISPLAY_CAP * (1 - Math.exp(-(D * peak) / EMISSIVE_DISPLAY_CAP))) / peak;
    } else if (e.halfSpace) D *= HALF_SPACE_SPOT.decalGain; // glow decals: their level is set in their shader (× decalGain)
    mat.emissiveIntensity = D;
  }

  // ---- environment (indirect light + reflections) -----------------------------------------------------------

  _maybeBuildEnv(renderer) {
    if (!this._pmrem || !this._model) return;
    const S = this._S ?? this._Starget;
    // the camera room's own map (one PMREM per room, cached): a room change swaps to it, or builds it once
    const W = this._worlds.get(this._camRoomId) ?? null;
    const env = W?.env ?? null;
    if (env?.rt && !env.dirty && this.scene.environment !== env.rt.texture) {
      this.scene.environment = env.rt.texture;
      this._envRT = env.rt;
      this._Senv = env.Senv;
      this._applyDirty = true;
    }
    const dirty = env ? env.dirty || !env.rt : this._envDirty;
    const drift = Math.abs(Math.log(S / ((env ? env.Senv : this._Senv) || S)));
    // (while the eye eases after a room change the map was built for the target: environmentIntensity follows)
    if (!dirty && (drift < 0.7 || this._clock < this._roomEaseUntil)) return;
    // throttle while sliders are dragged: at most every ENV_MIN_INTERVAL s; the last change is built at most that long
    // after it (a single click rebuilds at once – the previous build is older than the interval)
    if (this._clock - this._envAt < ENV_MIN_INTERVAL && this._envBuilt) return;
    // right after a room change: built at the exposure the eye is easing toward (no second build for the drift)
    this._buildEnv(renderer, false, W, this._clock < this._roomEaseUntil);
  }

  /** Patch radiances → env meshes → PMREM (scene.environment). ≈ 1 ms. W = the room (default the living room). */
  _buildEnv(renderer, initial, W = null, atTarget = false) {
    const world = W ?? this._worlds.get(LIVING_ID) ?? null;
    const living = !world || world.living;
    const model = living ? this._model : world.model;
    const S = initial ? 1 : atTarget ? this._Starget : (this._S ?? this._Starget);
    const wb = this._wb;
    const windows = living ? this._windows : world.windows;
    for (const p of model.patches) {
      if (initial) p.L.setRGB(0.05, 0.05, 0.05);
      else {
        p.L.copy(p.B);
        if (living && p.kind === 'floor' && this._bounces?.length) {
          _c1.copy(p.Esun).multiply(p.rho);
          p.L.r = Math.max(0, p.L.r - _c1.r);
          p.L.g = Math.max(0, p.L.g - _c1.g);
          p.L.b = Math.max(0, p.L.b - _c1.b);
        }
        p.L.multiplyScalar(S / Math.PI).multiply(wb);
        if (p.kind === 'glass') {
          // a faint view through the glass in reflections (the sky itself comes from the window lights)
          const w = windows.find((x) => `glass:${x.id}` === p.id);
          if (w) p.L.add(_c1.copy(w.cand.color).multiply(wb).multiplyScalar(w.L * S * 0.12));
        }
      }
      for (const m of p.meshes) m.material.color.copy(p.L);
    }
    const size = this.profile.env;
    let probe;
    if (living) {
      probe = new THREE.Vector3(4.8, 1.45, 7.4);
      if (this.layout && !this.layout.isInside(probe.x, probe.z)) probe.set(this.center.x, 1.45, this.center.z);
    } else probe = world.probe;
    // the room copy → a cube render target → PMREM into the SAME target every time (fix-lighting r1: fromScene()
    // allocated and disposed a new target per rebuild – costly while the clock slider is dragged); one per room
    if (!this._envCube || this._envCube.width !== size) {
      this._envCube?.dispose();
      this._envCube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: true });
      this._envCubeCam = new THREE.CubeCamera(0.03, 40, this._envCube);
      this._envRT?.dispose();
      this._envRT = null;
      for (const w of this._worlds.values()) {
        if (w.env.rt && w.env.rt !== this._envRT) w.env.rt.dispose();
        w.env.rt = null;
      }
    }
    const target = world ? world.env.rt : this._envRT;
    const cc = renderer.getClearColor(_cc).getHex();
    const ca = renderer.getClearAlpha();
    const tm = renderer.toneMapping;
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    this._envCubeCam.position.copy(probe);
    this._envCubeCam.updateMatrixWorld(true);
    this._envCubeCam.update(renderer, model.envScene);
    renderer.setClearColor(cc, ca);
    renderer.toneMapping = tm;
    const rt = this._pmrem.fromCubemap(this._envCube.texture, target);
    this._envRT = rt;
    if (this.scene.environment !== rt.texture) this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 1;
    this._Senv = S;
    this._envAt = this._clock;
    if (world) {
      world.env.rt = rt;
      world.env.Senv = S;
      world.env.dirty = !!initial;
    }
    if (living) this._envDirty = false;
    this._envBuilt = !initial;
    this.stats.envBuilds = (this.stats.envBuilds || 0) + 1;
    if (!initial) this._applyDirty = true;
  }

  // ---- post-processing -------------------------------------------------------------------------------------

  /**
   * GTAO (three/addons) without EffectComposer: its own normal/depth pass, AO + denoise into its targets
   * (OUTPUT.Off), then a multiplicative blend onto the frame that is already on the screen. Only inside the room's
   * box (the photo backdrops and the sky get no AO).
   */
  _renderAO(renderer, scene, camera) {
    if (!this._gtao) {
      try {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const g = new GTAOPass(scene, camera, Math.max(1, size.x), Math.max(1, size.y));
        g.output = GTAOPass.OUTPUT.Off;
        g.blendIntensity = 0.7;
        g.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
        g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
        const box = this._aoBoxFor(this._camLevelId);
        if (box) g.setSceneClipBox(box);
        this._gtao = g;
        this._aoSize = size;
      } catch (err) {
        console.warn('[lighting] ambient occlusion unavailable', err);
        this.profile.ao = false;
        return;
      }
    }
    const g = this._gtao;
    const size = renderer.getDrawingBufferSize(_v2size);
    if (size.x !== this._aoSize.x || size.y !== this._aoSize.y) {
      g.setSize(size.x, size.y);
      this._aoSize.copy(size);
    }
    g.camera = camera;
    const autoClear = renderer.autoClear;
    try {
      g.render(renderer, null, null);
      g.blendMaterial.uniforms.intensity.value = g.blendIntensity;
      g.blendMaterial.uniforms.tDiffuse.value = g.pdRenderTarget.texture;
      g._renderPass(renderer, g.blendMaterial, null);
    } catch (err) {
      console.warn('[lighting] ambient occlusion failed – turned off', err);
      this.profile.ao = false;
    }
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(null);
  }
}

const _v2size = new THREE.Vector2();
const _cc = new THREE.Color();
/** Seconds between sun shadow-map renders while the sun keeps moving (clock slider). */
const SUN_SHADOW_INTERVAL = 0.1;
/** Seconds between environment (PMREM) rebuilds while something is being dragged. */
const ENV_MIN_INTERVAL = 0.35;
const NIGHT_COLOR = lightColor(6500);
let rectAreaReady = false;

/** Orientation of a RectAreaLight that emits along `normal` with its width along `right`. */
function rectQuaternion(normal, right) {
  const z = normal.clone().negate().normalize(); // RectAreaLight emits toward its local −z
  const x = right.clone().addScaledVector(z, -right.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export default LightManager;
