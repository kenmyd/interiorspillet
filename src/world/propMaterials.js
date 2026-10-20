import * as THREE from 'three';
import { TileableNoise, mulberry32, createCanvas, canvasTexture, cached, clamp, lerp, smoothstep } from './proctex.js';

/**
 * Shared materials for outdoor props (procedural canvas textures, cached per page):
 *   getConcreteMaterial()      cast-in-place concrete (walls, outlet structure); UVs in metres
 *   getWeatheredWoodMaterial() silver-grey weathered timber (railings, sign posts, picnic table); UV u along the grain, metres
 * and geometry helpers that produce metric UVs so one texture scale fits every prop:
 *   metricBox(w, h, d)         BoxGeometry whose UVs are in metres on every face
 */

const CONCRETE_TILE = 2.4; // metres per concrete texture tile
const WOOD_TILE = 1.6; // metres along the grain per wood texture tile

/** BoxGeometry (centred) with UVs in metres on every face. */
export function metricBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const u = uv.getX(i), v = uv.getY(i);
    if (nx > 0.5) uv.setXY(i, u * d, v * h);
    else if (ny > 0.5) uv.setXY(i, u * w, v * d);
    else uv.setXY(i, u * w, v * h);
  }
  return g;
}

function concreteCanvases() {
  return cached('concrete-canvases-v1', () => {
    const S = 512;
    const n1 = new TileableNoise(311), n2 = new TileableNoise(312), n3 = new TileableNoise(313);
    const rnd = mulberry32(314);
    const col = createCanvas(S), rough = createCanvas(S), bump = createCanvas(S);
    const ci = col.getContext('2d').createImageData(S, S);
    const ri = rough.getContext('2d').createImageData(S, S);
    const bi = bump.getContext('2d').createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const big = n1.fbm(u, v, 3, 4, 0.55);
        const mid = n2.fbm(u, v, 12, 3, 0.5);
        const fine = n3.fbm(u, v, 64, 2, 0.5);
        // formwork board joints every 1/4 tile (0.6 m) and a faint tie-hole grid
        const board = 1 - smoothstep(0.0, 0.004, Math.abs(((v * 4) % 1) - 0.5) - 0.495);
        // rain streaks (vertical, from the top)
        const streak = smoothstep(0.25, 0.65, n2.fbm(u * 1, v * 0.08, 24, 2, 0.5) * 0.7 + 0.35) * 0.35;
        let g = 0.6 + big * 0.06 + mid * 0.035 + fine * 0.03 - streak * 0.18 - board * 0.08;
        // aggregate speckles
        if (rnd() < 0.02) g -= 0.12 * rnd();
        if (rnd() < 0.01) g += 0.08;
        const i = (y * S + x) * 4;
        ci.data[i] = clamp(g * 0.99) * 255;
        ci.data[i + 1] = clamp(g * 0.985) * 255;
        ci.data[i + 2] = clamp(g * 0.96) * 255;
        ci.data[i + 3] = 255;
        const r = clamp(0.86 + mid * 0.08 - streak * 0.2);
        ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = r * 255;
        ri.data[i + 3] = 255;
        const b = clamp(0.5 + fine * 0.3 + mid * 0.2 - board * 0.4);
        bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = b * 255;
        bi.data[i + 3] = 255;
      }
    }
    col.getContext('2d').putImageData(ci, 0, 0);
    rough.getContext('2d').putImageData(ri, 0, 0);
    bump.getContext('2d').putImageData(bi, 0, 0);
    return { col, rough, bump };
  });
}

/** Cast concrete (walls of the outlet etc.). Geometry UVs must be in metres (see metricBox). */
export function getConcreteMaterial() {
  return cached('concrete-mat-v1', () => {
    const c = concreteCanvases();
    const rep = [1 / CONCRETE_TILE, 1 / CONCRETE_TILE];
    const mat = new THREE.MeshStandardMaterial({
      map: canvasTexture(c.col, { repeat: rep }),
      roughnessMap: canvasTexture(c.rough, { repeat: rep, srgb: false }),
      bumpMap: canvasTexture(c.bump, { repeat: rep, srgb: false }),
      bumpScale: 1.2,
      roughness: 1,
      metalness: 0,
    });
    mat.name = 'Concrete';
    return mat;
  });
}

function woodCanvas() {
  return cached('wood-canvas-v2', () => {
    // u (x) along the grain; 512 × 128 covering WOOD_TILE × WOOD_TILE/4 metres
    const W = 512, H = 128;
    const n1 = new TileableNoise(411), n2 = new TileableNoise(412);
    const rnd = mulberry32(413);
    const col = createCanvas(W, H), bump = createCanvas(W, H);
    const ci = col.getContext('2d').createImageData(W, H);
    const bi = bump.getContext('2d').createImageData(W, H);
    const cracks = [];
    for (let i = 0; i < 26; i++) cracks.push({ y: rnd() * H, x0: rnd() * W, len: 40 + rnd() * 220, w: 0.6 + rnd() * 0.9 });
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        // grain: noise stretched along u
        const grain = n1.noise(u * 3, v * 40, 3, 40) * 0.5 + n1.noise(u * 6, v * 90, 6, 90) * 0.3;
        const blot = n2.fbm(u, v, 4, 3);
        let g = 0.5 + grain * 0.12 + blot * 0.08;
        let crack = 0;
        for (const c of cracks) {
          const dx = ((x - c.x0 + W) % W);
          if (dx < c.len && Math.abs(y - c.y - Math.sin(dx * 0.05) * 1.5) < c.w) crack = 1;
        }
        g -= crack * 0.12;
        // weathered timber: silver-grey with brown undertone and a hint of green algae
        const algae = smoothstep(0.2, 0.6, blot) * 0.3;
        const i = (y * W + x) * 4;
        ci.data[i] = clamp(g * 0.92 - algae * 0.04) * 255;
        ci.data[i + 1] = clamp(g * 0.88 + algae * 0.02) * 255;
        ci.data[i + 2] = clamp(g * 0.8 - algae * 0.03) * 255;
        ci.data[i + 3] = 255;
        const b = clamp(0.5 + grain * 0.4 - crack * 0.5);
        bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = b * 255;
        bi.data[i + 3] = 255;
      }
    }
    col.getContext('2d').putImageData(ci, 0, 0);
    bump.getContext('2d').putImageData(bi, 0, 0);
    return { col, bump };
  });
}

/**
 * Weathered timber. Geometry UVs: u along the grain in metres, v across in metres (metricBox does this for
 * boxes whose long axis is x; rotate geometry, not UVs, for other orientations).
 */
export function getWeatheredWoodMaterial() {
  return cached('wood-mat-v1', () => {
    const c = woodCanvas();
    const rep = [1 / WOOD_TILE, 4 / WOOD_TILE];
    const mat = new THREE.MeshStandardMaterial({
      map: canvasTexture(c.col, { repeat: rep }),
      bumpMap: canvasTexture(c.bump, { repeat: rep, srgb: false }),
      bumpScale: 1.5,
      roughness: 0.92,
      metalness: 0,
      color: 0xd8cfc4,
    });
    mat.name = 'WeatheredWood';
    return mat;
  });
}

/** Linear blend helper exported for prop builders that tint per instance. */
export const mixColor = (a, b, t) => new THREE.Color(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t));
