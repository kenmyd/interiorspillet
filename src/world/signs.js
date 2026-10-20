import * as THREE from 'three';
import { textCanvas, canvasTexture, cached } from './proctex.js';

/**
 * Canvas-drawn signs (copied from Kraftverkspillet; Door.js uses signMaterial for door decals). Each function returns { texture, width, height } where width/height are
 * the physical sign size in metres. Textures are cached by content, so repeated signs share one texture.
 *
 *  - warningSign('hoyspenning' | 'adgang')  yellow door signs
 *  - exitSign()                             green "NØDUTGANG" with running man (use as emissiveMap too)
 *  - nameplate(text)                        engraved aluminium room/door plate
 *  - labelSign(text, opts)                  generic coloured label (e.g. crane capacity)
 *  - signMaterial(sign, opts)               MeshStandardMaterial for a sign (optionally self-lit)
 */

const FONT = '"Arial Narrow", Arial, Helvetica, sans-serif';
const BLACK = '#111111';
const YELLOW = '#f6c400';

function texOf(canvas) {
  const t = canvasTexture(canvas, { srgb: true, wrap: false, anisotropy: 4 });
  t.generateMipmaps = true;
  return t;
}

/** Fit text into maxWidth by shrinking the font. */
function fitText(ctx, text, x, y, maxWidth, size, weight = 'bold') {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    s -= 1;
  } while (ctx.measureText(text).width > maxWidth && s > 6);
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Black-bordered warning triangle with a lightning bolt, centred at (cx, cy), side s. */
function drawHighVoltageTriangle(ctx, cx, cy, s) {
  const h = (s * Math.sqrt(3)) / 2;
  const top = cy - h * 0.6, bottom = cy + h * 0.4;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + s / 2, bottom);
  ctx.lineTo(cx - s / 2, bottom);
  ctx.closePath();
  ctx.fillStyle = YELLOW;
  ctx.fill();
  ctx.lineWidth = s * 0.085;
  ctx.strokeStyle = BLACK;
  ctx.stroke();
  // bolt
  const k = s / 100;
  ctx.beginPath();
  ctx.moveTo(cx + 6 * k, top + 26 * k);
  ctx.lineTo(cx - 12 * k, top + 56 * k);
  ctx.lineTo(cx + 1 * k, top + 56 * k);
  ctx.lineTo(cx - 8 * k, top + 80 * k);
  ctx.lineTo(cx + 15 * k, top + 47 * k);
  ctx.lineTo(cx + 2 * k, top + 47 * k);
  ctx.closePath();
  ctx.fillStyle = BLACK;
  ctx.fill();
  // arrow head at the bolt tip
  ctx.beginPath();
  ctx.moveTo(cx - 8 * k, top + 80 * k);
  ctx.lineTo(cx - 13 * k, top + 66 * k);
  ctx.lineTo(cx - 1 * k, top + 70 * k);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Yellow door warning sign.
 * @param {'hoyspenning'|'adgang'} kind
 */
export function warningSign(kind) {
  return cached(`sign:warn:${kind}`, () => {
    const W = 256, H = 352;
    const canvas = textCanvas(W, H, (ctx) => {
      ctx.fillStyle = YELLOW;
      roundRect(ctx, 0, 0, W, H, 18);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = BLACK;
      roundRect(ctx, 10, 10, W - 20, H - 20, 12);
      ctx.stroke();
      ctx.fillStyle = BLACK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (kind === 'hoyspenning') {
        drawHighVoltageTriangle(ctx, W / 2, 128, 170);
        fitText(ctx, 'HØYSPENNING', W / 2, 238, W - 44, 40);
        ctx.fillRect(40, 266, W - 80, 4);
        fitText(ctx, 'LIVSFARE', W / 2, 302, W - 60, 46);
      } else {
        // prohibition pictogram: red ring + bar over a walking figure
        ctx.save();
        ctx.translate(W / 2, 112);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 70, 0, Math.PI * 2);
        ctx.fill();
        drawWalker(ctx, 0, 4, 1.05, BLACK);
        ctx.strokeStyle = '#d0121b';
        ctx.lineWidth = 15;
        ctx.beginPath();
        ctx.arc(0, 0, 63, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-44, -44);
        ctx.lineTo(44, 44);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = BLACK;
        fitText(ctx, 'ADGANG FORBUDT', W / 2, 222, W - 40, 34);
        fitText(ctx, 'FOR', W / 2, 260, W - 40, 30);
        fitText(ctx, 'UVEDKOMMENDE', W / 2, 298, W - 40, 34);
      }
    });
    return { texture: texOf(canvas), width: 0.2, height: 0.275 };
  });
}

/** Simple walking pictogram (for prohibition signs). */
function drawWalker(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(2, -42, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(1, -28);
  ctx.lineTo(-2, 4);
  ctx.stroke();
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(-2, 4);
  ctx.lineTo(-14, 22);
  ctx.lineTo(-18, 42);
  ctx.moveTo(-2, 4);
  ctx.lineTo(10, 24);
  ctx.lineTo(16, 42);
  ctx.moveTo(1, -22);
  ctx.lineTo(-16, -6);
  ctx.moveTo(1, -22);
  ctx.lineTo(16, -8);
  ctx.stroke();
  ctx.restore();
}

/** Running man (ISO 7010 E001 style, simplified), drawn in `color`, figure ~120 px tall at scale 1. */
function drawRunningMan(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(14, -50, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 15;
  ctx.beginPath(); // torso, leaning forward
  ctx.moveTo(6, -32);
  ctx.lineTo(-6, 4);
  ctx.stroke();
  ctx.lineWidth = 11;
  ctx.beginPath(); // arms
  ctx.moveTo(4, -26);
  ctx.lineTo(24, -16);
  ctx.lineTo(36, -26);
  ctx.moveTo(4, -26);
  ctx.lineTo(-14, -18);
  ctx.lineTo(-26, -30);
  ctx.stroke();
  ctx.beginPath(); // legs
  ctx.moveTo(-6, 4);
  ctx.lineTo(16, 18);
  ctx.lineTo(14, 44);
  ctx.moveTo(-6, 4);
  ctx.lineTo(-18, 26);
  ctx.lineTo(-40, 30);
  ctx.stroke();
  ctx.restore();
}

/** Green emergency exit sign: door + running man + arrow + "NØDUTGANG". */
export function exitSign({ arrow = 'none' } = {}) {
  return cached(`sign:exit:${arrow}`, () => {
    const W = 512, H = 192;
    const canvas = textCanvas(W, H, (ctx) => {
      ctx.fillStyle = '#0a8a3c';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#f4fff6';
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, W - 16, H - 16);
      // pictogram block (left)
      ctx.fillStyle = '#f4fff6';
      ctx.fillRect(28, 26, 130, 140);
      ctx.fillStyle = '#0a8a3c';
      ctx.fillRect(98, 36, 50, 120); // door opening
      drawRunningMan(ctx, 72, 104, 0.95, '#0a8a3c');
      ctx.fillStyle = '#f4fff6';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, 'NØDUTGANG', 335, 98, 300, 70);
      if (arrow !== 'none') {
        ctx.save();
        ctx.translate(335, 160);
        if (arrow === 'left') ctx.scale(-1, 1);
        ctx.beginPath();
        ctx.moveTo(-30, -6);
        ctx.lineTo(16, -6);
        ctx.lineTo(16, -16);
        ctx.lineTo(36, 0);
        ctx.lineTo(16, 16);
        ctx.lineTo(16, 6);
        ctx.lineTo(-30, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    return { texture: texOf(canvas), width: 0.4, height: 0.15 };
  });
}

/** Engraved aluminium nameplate with dark text (room names on doors). */
export function nameplate(text) {
  return cached(`sign:plate:${text}`, () => {
    const W = 512, H = 128;
    const canvas = textCanvas(W, H, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#d9dcde');
      g.addColorStop(0.5, '#c4c8cb');
      g.addColorStop(1, '#b8bcbf');
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, W, H, 14);
      ctx.fill();
      // brushed lines
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#ffffff';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1d2226';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, text.toUpperCase(), W / 2, H / 2 + 3, W - 50, 72);
    });
    return { texture: texOf(canvas), width: 0.3, height: 0.075 };
  });
}

/**
 * Generic rectangular label.
 * @param {string} text
 * @param {{bg?:string, fg?:string, width?:number, height?:number, px?:number}} [o]
 */
export function labelSign(text, { bg = YELLOW, fg = BLACK, width = 0.4, height = 0.12, px = 512 } = {}) {
  return cached(`sign:label:${text}:${bg}:${fg}:${width}:${height}`, () => {
    const W = px, H = Math.round((px * height) / width);
    const canvas = textCanvas(W, H, (ctx) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(3, H * 0.05);
      ctx.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12);
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, text, W / 2, H / 2 + 2, W - H * 0.4, H * 0.62);
    });
    return { texture: texOf(canvas), width, height };
  });
}

/**
 * Material for a sign plane. `emissive` > 0 makes it self-lit (exit signs) using the same texture as emissiveMap.
 */
export function signMaterial(sign, { emissive = 0, roughness = 0.5, metalness = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: sign.texture, roughness, metalness });
  if (emissive > 0) {
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveMap = sign.texture;
    m.emissiveIntensity = emissive;
  }
  m.name = 'sign';
  return m;
}
