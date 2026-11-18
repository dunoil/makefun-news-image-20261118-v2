// THE WORLD IN ONE IMAGE - Wednesday 18 November 2026 (v2)
// A dense one-page broadsheet of the day's world news, drawn entirely in
// code: no image assets, no network, Node standard library only. The
// picture is painted pixel by pixel onto a 2x supersampled canvas, given
// a whisper of newsprint grain, box-averaged down and written as a
// deterministic 1024x1024 PNG to $MAKEFUN_OUTPUT_DIR/entry.png.
//
// The day it sums up, in fourteen stories: APEC opens in Shenzhen with
// Xi and Putin on stage and Trump landing for the first-ever trilateral
// the next day; US jets strike Qeshm as Iran answers across the Gulf;
// Ukraine drops a span of the Kerch Bridge; Peltola's Alaska win hands
// Democrats the Senate 56-44; Ebola in DR Congo passes 11,000 cases;
// Nvidia doubles revenue in its first post-Huang quarter; Voyager 1
// crosses one light-day from Earth; COP31 deadlocks in Antalya; Cyclone
// Xavier, category 5, lashes the Cook Islands; a Russian military plane
// crashes in Siberia killing 19; the Gaza truce frays in the cold; the
// US loses its measles-free status; world markets slide; and a 6.0
// earthquake shakes Papua New Guinea.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;            // final image is W x W
const SS = 2;              // supersample factor while painting
const RW = W * SS;         // render width / height
const GRAIN = 1;           // newsprint grain amplitude (+/-), tuned for size
const GRAIN_COVER = 0.25;  // fraction of pixels the grain touches

type RGB = [number, number, number];

// ---------------------------------------------------------------- palette
const INK: RGB = [16, 22, 34];
const INK2: RGB = [46, 55, 71];
const PAPER: RGB = [243, 236, 223];
const PAPER2: RGB = [250, 246, 236];
const CARD: RGB = [255, 255, 255];
const CREAM: RGB = [255, 249, 235];
const RED: RGB = [178, 30, 42];
const RED2: RGB = [122, 18, 30];
const BLUE: RGB = [24, 66, 126];
const NAVY: RGB = [12, 28, 54];
const SKY: RGB = [168, 202, 232];
const GOLD: RGB = [196, 138, 30];
const GOLD2: RGB = [238, 192, 94];
const TEAL: RGB = [12, 100, 94];
const GREEN: RGB = [40, 108, 58];
const LEAF: RGB = [78, 162, 86];
const GREY: RGB = [94, 102, 112];
const GREY2: RGB = [170, 176, 182];
const SAND: RGB = [226, 198, 146];
const SMOKE: RGB = [106, 106, 112];
const SEA: RGB = [48, 102, 152];
const MAPDOT: RGB = [216, 200, 158];

// --------------------------------------------------------- deterministic rng
let seed = 20261118;
function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A second, position-based hash for grain: same value every run.
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// --------------------------------------------------------------- framebuffer
const buf = new Uint8ClampedArray(RW * RW * 3);

function put(x: number, y: number, c: RGB, a = 1): void {
  const rx = Math.round(x * SS), ry = Math.round(y * SS);
  if (rx < 0 || ry < 0 || rx >= RW || ry >= RW) return;
  const i = (ry * RW + rx) * 3;
  if (a >= 1) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; return; }
  buf[i] = buf[i] * (1 - a) + c[0] * a;
  buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
  buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function box(x: number, y: number, w: number, h: number, c: RGB): void {
  const xa = Math.max(0, Math.round(x * SS)), xb = Math.min(RW, Math.round((x + w) * SS));
  const ya = Math.max(0, Math.round(y * SS)), yb = Math.min(RW, Math.round((y + h) * SS));
  for (let j = ya; j < yb; j++) {
    let i = (j * RW + xa) * 3;
    for (let k = xa; k < xb; k++) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; i += 3; }
  }
}

// Vertical gradient with ordered dither so skies do not band.
function vGrad(x: number, y: number, w: number, h: number, top: RGB, bot: RGB, dith = 5): void {
  const xa = Math.max(0, Math.round(x * SS)), xb = Math.min(RW, Math.round((x + w) * SS));
  const ya = Math.max(0, Math.round(y * SS)), yb = Math.min(RW, Math.round((y + h) * SS));
  for (let j = ya; j < yb; j++) {
    const base = mix(top, bot, (j - ya) / Math.max(1, yb - ya - 1));
    let i = (j * RW + xa) * 3;
    for (let k = xa; k < xb; k++) {
      const d = ((BAYER4[j & 3][k & 3] / 15) - 0.5) * dith;
      buf[i] = base[0] + d; buf[i + 1] = base[1] + d; buf[i + 2] = base[2] + d;
      i += 3;
    }
  }
}

function outline(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  box(x, y, w, t, c); box(x, y + h - t, w, t, c);
  box(x, y, t, h, c); box(x + w - t, y, t, h, c);
}

// Soft disc: coverage falls across about one render pixel at the rim.
function dot(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const R = r * SS, CX = cx * SS, CY = cy * SS;
  const xa = Math.max(0, Math.floor(CX - R - 1)), xb = Math.min(RW - 1, Math.ceil(CX + R + 1));
  const ya = Math.max(0, Math.floor(CY - R - 1)), yb = Math.min(RW - 1, Math.ceil(CY + R + 1));
  for (let j = ya; j <= yb; j++) {
    for (let i = xa; i <= xb; i++) {
      const cov = Math.max(0, Math.min(1, R - Math.hypot(i - CX, j - CY) + 0.5));
      if (cov > 0) put(i / SS, j / SS, c, cov * a);
    }
  }
}

function oval(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const RX = rx * SS, RY = ry * SS, CX = cx * SS, CY = cy * SS;
  const xa = Math.max(0, Math.floor(CX - RX - 1)), xb = Math.min(RW - 1, Math.ceil(CX + RX + 1));
  const ya = Math.max(0, Math.floor(CY - RY - 1)), yb = Math.min(RW - 1, Math.ceil(CY + RY + 1));
  for (let j = ya; j <= yb; j++) {
    for (let i = xa; i <= xb; i++) {
      const d = Math.hypot((i - CX) / RX, (j - CY) / RY);
      const cov = Math.max(0, Math.min(1, (1 - d) * Math.min(RX, RY) + 0.5));
      if (cov > 0) put(i / SS, j / SS, c, cov * a);
    }
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB, a = 1): void {
  const R = r * SS, CX = cx * SS, CY = cy * SS, T = t * SS;
  const xa = Math.max(0, Math.floor(CX - R - 1)), xb = Math.min(RW - 1, Math.ceil(CX + R + 1));
  const ya = Math.max(0, Math.floor(CY - R - 1)), yb = Math.min(RW - 1, Math.ceil(CY + R + 1));
  for (let j = ya; j <= yb; j++) {
    for (let i = xa; i <= xb; i++) {
      const d = Math.hypot(i - CX, j - CY);
      if (d <= R && d >= R - T) put(i / SS, j / SS, c, a);
    }
  }
}

// Thick line drawn as a chain of soft dots along the segment.
function stroke(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB, a = 1): void {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * SS));
  for (let s = 0; s <= n; s++) {
    dot(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n, t / 2, c, a);
  }
}

// Curved stroke through three points (quadratic Bezier).
function arcStroke(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number, c: RGB, a = 1): void {
  const n = 42;
  let lx = x0, ly = y0;
  for (let s = 1; s <= n; s++) {
    const u = s / n, v = 1 - u;
    const px = v * v * x0 + 2 * v * u * cx + u * u * x1;
    const py = v * v * y0 + 2 * v * u * cy + u * u * y1;
    stroke(lx, ly, px, py, t, c, a);
    lx = px; ly = py;
  }
}

function wedge(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB, a = 1): void {
  const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (den === 0) return;
  const xa = Math.min(x0, x1, x2), xb = Math.max(x0, x1, x2);
  const ya = Math.min(y0, y1, y2), yb = Math.max(y0, y1, y2);
  for (let y = ya; y <= yb; y += 0.5) {
    for (let x = xa; x <= xb; x += 0.5) {
      const A = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
      const B = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
      if (A >= 0 && B >= 0 && 1 - A - B >= 0) put(x, y, c, a);
    }
  }
}

// Even-odd polygon fill on a half-pixel scanline grid.
function fillPoly(pts: Array<[number, number]>, c: RGB, a = 1): void {
  let ya = Infinity, yb = -Infinity;
  for (const p of pts) { ya = Math.min(ya, p[1]); yb = Math.max(yb, p[1]); }
  for (let y = ya; y <= yb; y += 0.5) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = xs[i]; x <= xs[i + 1]; x += 0.5) put(x, y, c, a);
    }
  }
}

function star5(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 10; k++) {
    const ang = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 === 0 ? r : r * 0.45;
    pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  fillPoly(pts, c, a);
}

// --------------------------------------------------------------------- font
// A 5x7 typeface: seven 5-bit rows per glyph, bit 4 = leftmost column.
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0f, 0x10, 0x10, 0x10, 0x10, 0x10, 0x0f],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0f, 0x10, 0x10, 0x17, 0x11, 0x11, 0x0e],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
  J: [0x07, 0x01, 0x01, 0x01, 0x01, 0x11, 0x0e],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x0a, 0x04, 0x04, 0x04, 0x0a, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x13, 0x15, 0x19, 0x11, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x14, 0x04, 0x04, 0x04, 0x1f],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x1f, 0x01, 0x02, 0x01, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ',': [0, 0, 0, 0, 0x0c, 0x0c, 0x08],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ';': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0x08],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x1f, 0, 0, 0],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '(': [0x03, 0x04, 0x08, 0x08, 0x08, 0x04, 0x03],
  ')': [0x18, 0x04, 0x02, 0x02, 0x02, 0x04, 0x18],
  '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  '$': [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
  '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03],
  '=': [0, 0, 0x1f, 0, 0x1f, 0, 0],
  '•': [0, 0, 0x0e, 0x0e, 0x0e, 0, 0],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

function txtW(s: string, sc: number): number {
  return s.length === 0 ? 0 : s.length * 6 * sc - sc;
}

// Draws text at scale sc (glyph cell 6x7 * sc). Unknown chars become spaces.
function txt(s: string, x: number, y: number, sc: number, c: RGB, bold = false): void {
  let cx = x;
  for (const raw of s.toUpperCase()) {
    const g = FONT[raw] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      const bits = g[row];
      for (let col = 0; col < 5; col++) {
        if ((bits >> (4 - col)) & 1) {
          box(cx + col * sc, y + row * sc, sc, sc, c);
          if (bold) box(cx + col * sc + Math.max(1, sc - 1), y + row * sc, sc, sc, c);
        }
      }
    }
    cx += 6 * sc;
  }
}

function txtC(s: string, y: number, sc: number, c: RGB, bold = false, cx = W / 2): void {
  txt(s, Math.round(cx - txtW(s, sc) / 2), y, sc, c, bold);
}

function txtR(s: string, rightX: number, y: number, sc: number, c: RGB, bold = false): void {
  txt(s, rightX - txtW(s, sc), y, sc, c, bold);
}

function wrap(s: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if (cur === '') cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur !== '') out.push(cur);
  return out;
}

function txtBlock(s: string, x: number, y: number, sc: number, maxChars: number, c: RGB, gap = 3): number {
  const lines = wrap(s, maxChars);
  lines.forEach((ln, i) => txt(ln, x, y + i * (7 * sc + gap), sc, c));
  return y + lines.length * (7 * sc + gap);
}

// ------------------------------------------------------------------ scenes
// Every scene paints inside the box (x, y, w, h) it is given. Panel scenes
// are small (about 96 x 102), so they are built from big bold shapes.

// LEAD - Shenzhen at dawn: skyline over the bay, three flags, three
// presidents at the long table, hours before the first trilateral.
function sceneSummit(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [56, 84, 128], [238, 176, 110], 6);
  for (const [fy, fw, fa] of [[0.13, 0.24, 0.16], [0.22, 0.18, 0.12], [0.07, 0.15, 0.09]] as Array<[number, number, number]>) {
    oval(x + w * (0.12 + fw / 2), y + h * fy, (w * fw) / 2, h * 0.026, [252, 228, 198], fa);
    oval(x + w * (0.88 - fw / 2), y + h * (fy + 0.05), (w * fw) / 2, h * 0.022, [252, 228, 198], fa);
  }
  const sx = x + w * 0.8, sy = y + h * 0.38;
  dot(sx, sy, 28, GOLD2, 0.16);
  dot(sx, sy, 19, GOLD2, 0.3);
  dot(sx, sy, 12, [252, 216, 134], 0.95);
  const horizon = y + h * 0.62;
  let fx = x + 4;
  while (fx < x + w - 8) {
    const tw = 10 + rnd() * 18, th = 12 + rnd() * 24;
    box(fx, horizon - th, tw, th, [88, 102, 130]);
    fx += tw + 3 + rnd() * 8;
  }
  const towerC: RGB = [22, 34, 56];
  const towers: Array<[number, number, number]> = [
    [0.02, 0.26, 0.05], [0.09, 0.38, 0.045], [0.16, 0.22, 0.06], [0.24, 0.34, 0.04],
    [0.86, 0.3, 0.05], [0.93, 0.4, 0.045], [0.4, 0.26, 0.05], [0.31, 0.18, 0.05],
  ];
  for (const [tx, th, tw] of towers) {
    const X = x + tx * w, TW = tw * w, TH = th * h;
    box(X, horizon - TH, TW, TH, towerC);
    for (let wy = horizon - TH + 4; wy < horizon - 4; wy += 6) {
      for (let wx = X + 3; wx < X + TW - 3; wx += 5) {
        if (rnd() < 0.4) box(wx, wy, 2.4, 3, GOLD2);
      }
    }
  }
  const pxX = x + w * 0.62, pW = w * 0.07, pH = h * 0.52;
  box(pxX, horizon - pH, pW, pH, towerC);
  stroke(pxX + pW / 2, horizon - pH, pxX + pW / 2, horizon - pH - h * 0.09, 2.2, towerC);
  for (let wy = horizon - pH + 5; wy < horizon - 5; wy += 6) {
    for (let wx = pxX + 3; wx < pxX + pW - 3; wx += 5) {
      if (rnd() < 0.5) box(wx, wy, 2.4, 3, GOLD2);
    }
  }
  vGrad(x, horizon, w, h - (horizon - y), [36, 60, 94], [15, 27, 48], 4);
  for (let i = 0; i < 42; i++) {
    box(x + rnd() * w, horizon + 3 + rnd() * (h - (horizon - y) - 8), 4 + rnd() * 9, 1.4, [150, 180, 210]);
  }
  // three flag poles: China, the United States, Russia
  const plazaY = y + h * 0.99;
  const poleTop = y + h * 0.26;
  const flagW = w * 0.1, flagH = h * 0.15;
  const poles = [0.29, 0.45, 0.61];
  for (const pf of poles) {
    const X = x + pf * w;
    stroke(X, poleTop, X, plazaY, 2.4, [28, 32, 42]);
    dot(X, poleTop - 2, 2.4, GOLD2);
  }
  { // China: red field, one big gold star, four small ones
    const X = x + poles[0] * w + 2, Y = poleTop + 2;
    box(X, Y, flagW, flagH, [204, 40, 44]);
    star5(X + flagW * 0.24, Y + flagH * 0.3, flagH * 0.17, GOLD2);
    for (const [ox, oy] of [[0.44, 0.16], [0.5, 0.34], [0.5, 0.52], [0.44, 0.68]] as Array<[number, number]>) {
      star5(X + flagW * ox, Y + flagH * oy, flagH * 0.07, GOLD2);
    }
  }
  { // United States: stripes, blue canton, dot stars
    const X = x + poles[1] * w + 2, Y = poleTop + 2;
    box(X, Y, flagW, flagH, CARD);
    const sh = flagH / 7;
    for (let i = 0; i < 7; i += 2) box(X, Y + i * sh, flagW, sh, [176, 32, 50]);
    box(X, Y, flagW * 0.44, flagH * 0.54, [36, 50, 108]);
    for (let rI = 0; rI < 3; rI++) {
      for (let cI = 0; cI < 4; cI++) {
        dot(X + 4 + cI * (flagW * 0.1), Y + 3.5 + rI * (flagH * 0.16), 1.1, CARD);
      }
    }
  }
  { // Russia: white, blue, red
    const X = x + poles[2] * w + 2, Y = poleTop + 2;
    box(X, Y, flagW, flagH / 3, CARD);
    box(X, Y + flagH / 3, flagW, flagH / 3, [34, 70, 158]);
    box(X, Y + (2 * flagH) / 3, flagW, flagH / 3 + 1, [204, 40, 44]);
  }
  // the long table with three seated figures
  const tableTop = y + h * 0.79, tableBot = y + h * 0.96;
  const figC: RGB = [17, 23, 36];
  for (const pf of [0.34, 0.5, 0.66]) {
    const cx = x + pf * w;
    dot(cx, tableTop - h * 0.08, h * 0.05, figC);
    oval(cx, tableTop - h * 0.005, w * 0.025, h * 0.052, figC);
    wedge(cx - 3, tableTop - h * 0.042, cx + 3, tableTop - h * 0.042, cx, tableTop - h * 0.004, CREAM);
  }
  fillPoly(
    [[x + w * 0.15, tableTop], [x + w * 0.85, tableTop], [x + w * 0.89, tableBot], [x + w * 0.11, tableBot]],
    [25, 29, 40],
  );
  box(x + w * 0.15, tableTop, w * 0.7, 3, [72, 82, 102]);
  box(x + w * 0.42, tableTop + (tableBot - tableTop) * 0.32, w * 0.16, (tableBot - tableTop) * 0.3, CREAM);
}

// GULF - Qeshm Island under fire: missile arcs over the strait, a drone
// answering toward the Gulf states, a tanker standing off.
function sceneStrait(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h * 0.6, [196, 120, 84], [236, 186, 128], 6);
  vGrad(x, y + h * 0.6, w, h * 0.4, [44, 92, 128], [22, 54, 88], 5);
  dot(x + w * 0.88, y + h * 0.2, 8, [250, 214, 130], 0.9);
  dot(x + w * 0.88, y + h * 0.2, 14, [250, 214, 130], 0.25);
  fillPoly(
    [[x + 2, y + h * 0.62], [x + w * 0.1, y + h * 0.52], [x + w * 0.3, y + h * 0.5],
     [x + w * 0.44, y + h * 0.56], [x + w * 0.48, y + h * 0.62]],
    [58, 48, 44],
  );
  box(x + w * 0.2, y + h * 0.44, w * 0.05, h * 0.07, INK);           // launcher block
  stroke(x + w * 0.225, y + h * 0.44, x + w * 0.27, y + h * 0.36, 2.4, INK);
  const bx = x + w * 0.33, bb = y + h * 0.51;
  wedge(bx - 10, bb, bx + 10, bb, bx + 1, bb - h * 0.24, RED);
  wedge(bx - 6.5, bb, bx + 6.5, bb, bx - 1, bb - h * 0.17, [240, 120, 28]);
  wedge(bx - 3.5, bb, bx + 3.5, bb, bx, bb - h * 0.1, GOLD2);
  dot(x + w * 0.4, y + h * 0.22, 9, SMOKE, 0.4);
  dot(x + w * 0.48, y + h * 0.15, 12, SMOKE, 0.3);
  dot(x + w * 0.58, y + h * 0.1, 14, [86, 86, 92], 0.24);
  arcStroke(x + w * 0.26, y + h * 0.38, x + w * 0.5, y + h * 0.02, x + w * 0.36, y + h * 0.47, 2, [255, 226, 170], 0.95);
  arcStroke(x + w * 0.9, y + h * 0.34, x + w * 0.66, y + h * 0.06, x + w * 0.42, y + h * 0.44, 1.8, CARD, 0.85);
  const dx = x + w * 0.68, dy = y + h * 0.3;
  box(dx - 7, dy - 2.5, 14, 5, INK);
  for (const [ox, oy] of [[-11, -6], [11, -6], [-11, 5], [11, 5]] as Array<[number, number]>) {
    stroke(dx, dy, dx + ox, dy + oy, 1.4, INK);
    oval(dx + ox, dy + oy, 4.4, 1.5, INK);
  }
  dot(dx, dy + 4, 1.8, RED);
  fillPoly(
    [[x + w * 0.56, y + h * 0.8], [x + w * 0.97, y + h * 0.8], [x + w * 0.92, y + h * 0.9], [x + w * 0.62, y + h * 0.9]],
    INK,
  );
  box(x + w * 0.6, y + h * 0.72, w * 0.2, h * 0.08, [150, 52, 44]);
  box(x + w * 0.83, y + h * 0.66, w * 0.06, h * 0.14, GREY2);
  for (let i = 0; i < 10; i++) {
    box(x + rnd() * w * 0.94, y + h * 0.93 + rnd() * h * 0.05, 4 + rnd() * 6, 1.3, [170, 200, 225]);
  }
}

// KERCH - the Crimea bridge at first light, its middle road span down
// in the strait, spray where it fell.
function sceneBridge(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h * 0.66, [30, 44, 72], [120, 132, 150], 5);
  vGrad(x, y + h * 0.66, w, h * 0.34, [26, 52, 84], [12, 26, 48], 5);
  dot(x + w * 0.14, y + h * 0.16, 5.5, [236, 240, 244], 0.95);
  dot(x + w * 0.14, y + h * 0.16, 9, [236, 240, 244], 0.18);
  const deckY = y + h * 0.6;
  const deckC: RGB = [58, 70, 92];
  box(x + w * 0.2, deckY - h * 0.3, 4.5, h * 0.42, deckC);
  box(x + w * 0.76, deckY - h * 0.3, 4.5, h * 0.42, deckC);
  for (const fx of [0.3, 0.42, 0.58, 0.7]) {
    stroke(x + w * fx, deckY - h * 0.3 + (Math.abs(fx - 0.5) * h * 0.34), x + w * fx, deckY, 1.1, [110, 126, 152], 0.8);
  }
  arcStroke(x + w * 0.21, deckY - h * 0.3, x + w * 0.5, deckY - h * 0.52, x + w * 0.79, deckY - h * 0.3, 2.4, deckC);
  box(x + 2, deckY, w * 0.4, 3.4, deckC);
  box(x + w * 0.62, deckY, w * 0.36, 3.4, deckC);
  box(x + 2, deckY + 5, w * 0.4, 1.6, [40, 50, 68]);
  box(x + w * 0.62, deckY + 5, w * 0.36, 1.6, [40, 50, 68]);
  fillPoly(
    [[x + w * 0.42, deckY + 1], [x + w * 0.62, deckY + 1], [x + w * 0.6, deckY + h * 0.2], [x + w * 0.47, deckY + h * 0.24]],
    [46, 56, 76],
  );
  for (let i = 0; i < 16; i++) {
    dot(x + w * (0.44 + rnd() * 0.18), deckY + h * (0.16 + rnd() * 0.1), 1 + rnd() * 1.8, [210, 226, 238], 0.85);
  }
  for (let i = 0; i < 10; i++) {
    box(x + rnd() * w * 0.92, y + h * 0.8 + rnd() * h * 0.14, 3 + rnd() * 6, 1.2, [130, 156, 186]);
  }
  dot(x + w * 0.52, y + h * 0.3, 8, SMOKE, 0.35);
  dot(x + w * 0.58, y + h * 0.22, 11, SMOKE, 0.26);
}

// SENATE - the Capitol under a flag, and the new count: 56 against 44.
function sceneSenate(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [24, 52, 96], [96, 130, 170], 5);
  for (let i = 0; i < 22; i++) put(x + rnd() * w, y + rnd() * h * 0.34, CARD, 0.3 + rnd() * 0.5);
  const base = y + h * 0.8;
  const domeC: RGB = [226, 232, 238];
  const shadeC: RGB = [168, 180, 196];
  box(x + w * 0.04, base - h * 0.16, w * 0.52, h * 0.16, domeC);
  for (let i = 0; i < 6; i++) box(x + w * (0.07 + i * 0.082), base - h * 0.155, w * 0.03, h * 0.13, shadeC);
  box(x + w * 0.04, base - h * 0.19, w * 0.52, h * 0.03, shadeC);
  box(x + w * 0.17, base - h * 0.3, w * 0.26, h * 0.11, domeC);
  for (let i = 0; i < 4; i++) box(x + w * (0.195 + i * 0.06), base - h * 0.295, w * 0.024, h * 0.09, shadeC);
  {
    const dcx = x + w * 0.3, dby = base - h * 0.3;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= 20; k++) {
      const ang = Math.PI - (k * Math.PI) / 20;
      pts.push([dcx + Math.cos(ang) * w * 0.185, dby - Math.sin(ang) * h * 0.21]);
    }
    pts.push([dcx + w * 0.185, dby], [dcx - w * 0.185, dby]);
    fillPoly(pts, domeC);
    box(dcx - w * 0.185, dby - 1.5, w * 0.37, 3, shadeC);
  }
  box(x + w * 0.285, base - h * 0.545, w * 0.03, h * 0.045, domeC);
  stroke(x + w * 0.3, base - h * 0.545, x + w * 0.3, base - h * 0.62, 1.6, domeC);
  box(x + w * 0.3, base - h * 0.62, w * 0.13, h * 0.07, [176, 32, 50]);
  box(x + w * 0.3, base - h * 0.62, w * 0.055, h * 0.038, [36, 50, 108]);
  box(x + 2, base, w * 0.56, 2.4, shadeC);
  // the count: a tall blue bar of 56 against a red bar of 44 (the
  // numbers are in the headline beside this scene, so the bars stay bare)
  const barBase = base;
  box(x + w * 0.68, barBase - h * 0.4, w * 0.11, h * 0.4, BLUE);
  box(x + w * 0.84, barBase - h * 0.32, w * 0.11, h * 0.32, RED);
  box(x + w * 0.64, barBase, w * 0.35, 2, CREAM);
}

// EBOLA - the virus, big and spiked, over a treatment tent in the bush.
function sceneEbola(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [70, 20, 26], [34, 10, 15], 5);
  const tx = x + w * 0.58, ty = y + h * 0.62;
  fillPoly([[tx, ty + h * 0.3], [tx + w * 0.2, ty], [tx + w * 0.4, ty + h * 0.3]], [238, 240, 238]);
  box(tx + w * 0.03, ty + h * 0.3, w * 0.34, h * 0.12, [214, 216, 214]);
  box(tx + w * 0.185, ty + h * 0.1, w * 0.03, h * 0.11, RED);
  box(tx + w * 0.155, ty + h * 0.125, w * 0.09, h * 0.06, RED);
  box(x, y + h * 0.94, w, h * 0.06, [20, 8, 10]);
  const cx = x + w * 0.36, cy = y + h * 0.46, r = h * 0.26;
  for (let k = 0; k < 14; k++) {
    const ang = (k * Math.PI) / 7 + 0.2;
    const x1 = cx + (r - 2) * Math.cos(ang), y1 = cy + (r - 2) * Math.sin(ang);
    const x2 = cx + (r + 8) * Math.cos(ang), y2 = cy + (r + 8) * Math.sin(ang);
    stroke(x1, y1, x2, y2, 2.8, RED2);
    dot(x2, y2, 3.4, [196, 60, 70]);
  }
  dot(cx, cy, r, [188, 52, 62]);
  dot(cx - r * 0.2, cy - r * 0.2, r * 0.78, [206, 84, 92], 0.7);
  for (let i = 0; i < 13; i++) {
    const ang = rnd() * Math.PI * 2, rr = rnd() * r * 0.76;
    dot(cx + rr * Math.cos(ang), cy + rr * Math.sin(ang), 1.7 + rnd() * 1.7, [248, 200, 188], 0.9);
  }
  for (let i = 0; i < 12; i++) {
    dot(x + rnd() * w, y + rnd() * h * 0.9, 1 + rnd() * 1.4, [240, 140, 90], 0.5);
  }
}

// NVIDIA - the chip at the centre of the AI trade, and the chart its
// numbers sent up after hours.
function sceneChip(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [18, 25, 36], [9, 13, 21], 4);
  const traces: Array<Array<[number, number]>> = [
    [[0.32, 0.28], [0.32, 0.1], [0.14, 0.1]], [[0.5, 0.28], [0.5, 0.05]],
    [[0.68, 0.28], [0.68, 0.12], [0.86, 0.12]], [[0.32, 0.72], [0.32, 0.9], [0.15, 0.9]],
    [[0.68, 0.72], [0.68, 0.93]], [[0.28, 0.5], [0.07, 0.5]], [[0.72, 0.5], [0.92, 0.5], [0.92, 0.3]],
  ];
  for (const path of traces) {
    for (let i = 0; i + 1 < path.length; i++) {
      stroke(x + path[i][0] * w, y + path[i][1] * h, x + path[i + 1][0] * w, y + path[i + 1][1] * h, 1.4, TEAL, 0.85);
    }
    const [ex, ey] = path[path.length - 1];
    dot(x + ex * w, y + ey * h, 2.2, GOLD2);
  }
  for (let i = 0; i < 4; i++) {
    box(x + w * 0.265, y + h * (0.34 + i * 0.11), w * 0.05, h * 0.045, GREY2);
    box(x + w * 0.685, y + h * (0.34 + i * 0.11), w * 0.05, h * 0.045, GREY2);
    box(x + w * (0.34 + i * 0.11), y + h * 0.265, w * 0.045, h * 0.05, GREY2);
    box(x + w * (0.34 + i * 0.11), y + h * 0.685, w * 0.045, h * 0.05, GREY2);
  }
  box(x + w * 0.315, y + h * 0.315, w * 0.37, h * 0.37, [32, 42, 58]);
  outline(x + w * 0.315, y + h * 0.315, w * 0.37, h * 0.37, 2, [92, 106, 130]);
  box(x + w * 0.4, y + h * 0.4, w * 0.2, h * 0.2, GOLD);
  txt('AI', x + w * 0.435, y + h * 0.435, 3, INK, true);
  const ax = x + w * 0.62, ay = y + h * 0.95;
  stroke(ax, ay - h * 0.2, ax, ay, 1.1, GREY);
  stroke(ax, ay, ax + w * 0.34, ay, 1.1, GREY);
  const pts: Array<[number, number]> = [[0, 0.05], [0.08, 0.03], [0.15, 0.07], [0.22, 0.06], [0.28, 0.13], [0.34, 0.19]];
  for (let i = 0; i + 1 < pts.length; i++) {
    stroke(ax + pts[i][0] * w, ay - pts[i][1] * h, ax + pts[i + 1][0] * w, ay - pts[i + 1][1] * h, 2, LEAF);
  }
  wedge(ax + w * 0.315, ay - h * 0.215, ax + w * 0.365, ay - h * 0.175, ax + w * 0.3, ay - h * 0.155, LEAF);
}

// VOYAGER - the little probe in the black, its dish turned home, signal
// rings on the day-long road back to a pale blue dot.
function sceneVoyager(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [4, 6, 14], [2, 3, 8], 2);
  for (let i = 0; i < 60; i++) {
    put(x + rnd() * w, y + rnd() * h, CARD, 0.25 + rnd() * 0.65);
  }
  for (let i = 0; i < 5; i++) star5(x + rnd() * w, y + rnd() * h, 2.2, CARD, 0.7);
  const ex = x + w * 0.18, ey = y + h * 0.84;
  dot(ex, ey, 4.6, [110, 170, 240]);
  dot(ex, ey, 8, [110, 170, 240], 0.3);
  dot(ex - 1.4, ey - 1.2, 1.6, [140, 210, 170], 0.9);
  txt('EARTH', ex - 13, ey + 9, 1, [150, 180, 220]);
  const px2 = x + w * 0.66, py2 = y + h * 0.36;
  for (const rr of [10, 19, 28]) {
    const t = rr / 34;
    const cxr = px2 - (px2 - ex) * t * 0.55, cyr = py2 + (ey - py2) * t * 0.55;
    ring(cxr, cyr, rr * 0.55, 1.1, [140, 190, 240], 0.35);
  }
  stroke(px2, py2, px2 + w * 0.2, py2 + h * 0.3, 2, GREY2);
  dot(px2 + w * 0.2, py2 + h * 0.3, 2.6, GREY2);
  stroke(px2, py2, px2 + w * 0.16, py2 - h * 0.1, 2.4, GREY2);
  box(px2 + w * 0.15, py2 - h * 0.16, w * 0.07, h * 0.09, [120, 90, 70]);
  box(px2 - w * 0.045, py2 - h * 0.05, w * 0.09, h * 0.1, [196, 200, 208]);
  oval(px2 - w * 0.1, py2 - h * 0.02, w * 0.085, h * 0.13, [226, 230, 236]);
  oval(px2 - w * 0.088, py2 - h * 0.02, w * 0.07, h * 0.105, [168, 176, 190]);
  dot(px2 - w * 0.055, py2 - h * 0.02, 2.4, GOLD2);
  stroke(px2 - w * 0.05, py2 - h * 0.02, px2 - w * 0.01, py2 - h * 0.02, 1.4, GREY2);
  txt('24H', px2 - w * 0.02, py2 + h * 0.14, 2, [150, 180, 220], true);
}

// COP31 - the talks in Antalya: a warming globe, a rising thermometer,
// and waves at the foot of the table.
function sceneCop(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [196, 214, 226], [238, 226, 198], 5);
  dot(x + w * 0.82, y + h * 0.2, 7, [240, 190, 90], 0.95);
  dot(x + w * 0.82, y + h * 0.2, 12, [240, 190, 90], 0.25);
  // the globe: blue sea, green land, white caps
  const gx = x + w * 0.38, gy = y + h * 0.46, gr = h * 0.32;
  dot(gx, gy, gr, SEA);
  oval(gx - gr * 0.3, gy - gr * 0.35, gr * 0.34, gr * 0.22, GREEN);
  oval(gx + gr * 0.42, gy + gr * 0.1, gr * 0.3, gr * 0.34, GREEN);
  oval(gx - gr * 0.45, gy + gr * 0.45, gr * 0.26, gr * 0.2, GREEN);
  dot(gx - gr * 0.32, gy - gr * 0.3, gr * 0.12, [220, 232, 240], 0.9);
  ring(gx, gy, gr, 1.6, NAVY, 0.9);
  // the thermometer, mercury climbing
  const tx = x + w * 0.78, ty = y + h * 0.18, th = h * 0.56;
  box(tx - 3, ty, 6, th, CARD);
  outline(tx - 3, ty, 6, th, 1.4, INK);
  box(tx - 1.6, ty + th * 0.3, 3.2, th * 0.7, RED);
  dot(tx, ty + th, 6.5, RED);
  dot(tx, ty + th, 4, [240, 120, 90]);
  // the sea at the bottom, three wave lines
  box(x, y + h * 0.82, w, h * 0.18, TEAL);
  for (const wy of [0.86, 0.91, 0.96]) {
    for (let wx = 4; wx < w - 4; wx += 12) {
      arcStroke(x + wx, y + h * wy, x + wx + 6, y + h * wy - 3, x + wx + 12, y + h * wy, 1.4, [190, 226, 220], 0.9);
    }
  }
}

// CYCLONE - Xavier over the Pacific: a great spiral, rain streaks, and
// a palm tree bent double by the wind.
function sceneCyclone(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [26, 52, 92], [120, 150, 178], 5);
  const cx = x + w * 0.42, cy = y + h * 0.42;
  let px = cx, py = cy;
  for (let t = 0.2; t < Math.PI * 5.4; t += 0.3) {
    const r = 1.6 + t * 2.1;
    const nx = cx + r * Math.cos(t), ny = cy + r * Math.sin(t) * 0.92;
    stroke(px, py, nx, ny, 2.6, CARD);
    px = nx; py = ny;
  }
  dot(cx, cy, 5, [20, 38, 66]);
  ring(cx, cy, 5, 1.4, CARD, 0.9);
  // rain slanting across the sky
  for (let i = 0; i < 18; i++) {
    const rx = x + rnd() * w, ry = y + rnd() * h * 0.6;
    stroke(rx, ry, rx - 3, ry + 7, 1.2, [200, 220, 236], 0.7);
  }
  // the sea and a palm bent by the wind
  box(x, y + h * 0.8, w, h * 0.2, [16, 44, 76]);
  const bx = x + w * 0.78, by = y + h * 0.98;
  arcStroke(bx, by, bx + 4, by - h * 0.2, bx - w * 0.08, by - h * 0.34, 2.6, [60, 46, 34]);
  for (const [fx, fy] of [[-0.16, -0.4], [-0.06, -0.44], [0.04, -0.4], [-0.2, -0.3], [0.1, -0.32]] as Array<[number, number]>) {
    stroke(bx - w * 0.08, by - h * 0.34, bx + w * fx, by + h * fy, 1.8, GREEN);
  }
  for (let i = 0; i < 8; i++) {
    box(x + rnd() * w * 0.9, y + h * 0.86 + rnd() * h * 0.1, 4 + rnd() * 6, 1.2, [150, 180, 205]);
  }
}

// MEASLES - the shield of elimination cracked: red spots spreading
// across a pale map of the United States.
function sceneMeasles(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [238, 230, 214], [226, 210, 186], 4);
  // a rough map of the lower 48, drawn as a dotted block
  const mx = x + w * 0.08, my = y + h * 0.3, mw = w * 0.84, mh = h * 0.42;
  for (let rI = 0; rI < 7; rI++) {
    for (let cI = 0; cI < 14; cI++) {
      const cx = mx + (cI + 0.5) * (mw / 14), cy = my + (rI + 0.5) * (mh / 7);
      const edge = (rI === 0 && cI < 3) || (rI === 0 && cI > 10) || (rI === 6 && (cI < 4 || cI > 9));
      if (!edge) dot(cx, cy, 2.2, [150, 158, 168], 0.9);
    }
  }
  // red spots of the outbreak, clustered and spreading
  const spots: Array<[number, number, number]> = [
    [0.3, 0.42, 4.5], [0.42, 0.38, 3.2], [0.55, 0.5, 4], [0.66, 0.44, 3],
    [0.24, 0.55, 3], [0.48, 0.58, 3.6], [0.72, 0.58, 2.6], [0.58, 0.34, 2.4],
    [0.36, 0.62, 2.6], [0.78, 0.42, 2.2],
  ];
  for (const [fx, fy, fr] of spots) dot(x + fx * w, y + fy * h, fr, RED, 0.95);
  // the cracked shield of elimination status, top right
  const sx = x + w * 0.74, sy = y + h * 0.14;
  fillPoly([[sx - 9, sy], [sx + 9, sy], [sx + 8, sy + 12], [sx, sy + 20], [sx - 8, sy + 12]], CARD);
  outline(sx - 9, sy, 18, 20, 1.2, INK);
  box(sx - 1.4, sy + 3, 2.8, 10, RED);
  box(sx - 5, sy + 6.5, 10, 2.8, RED);
  stroke(sx - 2, sy + 2, sx + 3, sy + 9, 1.4, INK);
  stroke(sx + 3, sy + 9, sx - 1, sy + 15, 1.4, INK);
  txt('26 YRS', x + w * 0.06, y + h * 0.82, 2, RED2, true);
}

// -------------------------------------------------------------- world map
// Continents as unions of ellipses in lon/lat space, dotted onto the box.
const LANDMASS: Array<[number, number, number, number]> = [
  // North America and Greenland
  [-100, 48, 29, 12], [-85, 38, 16, 8], [-97, 30, 12, 5], [-104, 22, 8, 5],
  [-150, 64, 12, 5], [-80, 50, 12, 7], [-42, 73, 9, 4], [-118, 34, 7, 4], [-125, 40, 5, 6],
  // South America
  [-62, -9, 9, 12], [-70, -25, 5, 10], [-53, -3, 6, 5], [-75, -39, 3, 7], [-66, 3, 6, 4],
  // Europe
  [15, 50, 14, 6], [9, 45, 7, 3.5], [-3, 44, 5, 3], [17, 63, 7, 5],
  [29, 56, 9, 5], [-2, 54, 2.8, 3.2], [13, 43, 2.8, 4.5], [22, 40, 4, 3.5],
  // Africa and Madagascar
  [18, 10, 18, 13], [22, -12, 13, 11], [47, 6, 5, 4], [47, -19, 2.2, 4.5], [9, 5, 7, 5],
  // Asia
  [52, 41, 15, 8], [84, 53, 25, 9], [114, 48, 23, 10], [140, 57, 19, 10],
  [46, 31, 10, 6], [79, 22, 6.5, 8], [102, 16, 5.5, 6], [114, 32, 10, 8],
  [128, 39, 3.2, 3.5], [139, 38, 3.2, 3.5], [142, 42, 2.2, 3], [134, 35, 2.2, 2.2],
  [61, 34, 6, 5], [90, 24, 5, 4],
  // South-east Asia, Indonesia, Papua
  [99, 0, 4.5, 1.8], [107, -6, 4, 1.6], [114, -1, 3.6, 1.8], [120, -2, 3.2, 1.8],
  [132, -3, 3.6, 1.8], [142, -4, 4.5, 2.2], [121, 14, 2.5, 3], [147, -6, 4, 2.4],
  // Oceania
  [135, -25, 11, 6.5], [147, -33, 4.5, 4], [173, -42, 2.2, 3.2], [168, -46, 1.8, 2],
];

function onLand(lon: number, lat: number): boolean {
  for (const [clon, clat, rx, ry] of LANDMASS) {
    const du = (lon - clon) / rx, dv = (lat - clat) / ry;
    if (du * du + dv * dv <= 1) return true;
  }
  return false;
}

// The day's twelve places, numbered as they are told on the page.
const PLACES: Array<[number, number, number]> = [
  [1, 114.1, 22.5],   // Shenzhen - the summit
  [2, 56.3, 26.8],    // Qeshm, Strait of Hormuz
  [3, 36.6, 45.3],    // Kerch Bridge, Crimea
  [4, -152, 64],      // Alaska - Peltola's win
  [5, 29.5, 0.5],     // Beni, DR Congo - Ebola
  [6, -122, 37.4],    // Santa Clara - Nvidia
  [7, 30.7, 36.9],    // Antalya - COP31
  [8, -161, -10.4],   // Manihiki, Cook Islands - Xavier
  [9, 86.1, 54.8],    // Kemerovo, Siberia - the crash
  [10, 34.3, 31.4],   // Gaza - the truce warning
  [11, 147.2, -9.5],  // Port Moresby - the 6.0 quake
  [12, -74, 40.7],    // New York - the markets slide
];

function drawMap(x: number, y: number, w: number, h: number): void {
  vGrad(x, y, w, h, [17, 33, 56], [9, 19, 36], 4);
  const cols = 104, rows = 24;
  const cw = w / cols, ch = h / rows;
  for (let rI = 0; rI < rows; rI++) {
    const lat = 78 - ((rI + 0.5) * 138) / rows;
    for (let cI = 0; cI < cols; cI++) {
      const lon = -168 + ((cI + 0.5) * 336) / cols;
      if (onLand(lon, lat)) dot(x + (cI + 0.5) * cw, y + (rI + 0.5) * ch, cw * 0.34, MAPDOT, 0.95);
    }
  }
  for (const [n, lon, lat] of PLACES) {
    const mx = x + ((lon + 168) / 336) * w;
    const my = y + ((78 - lat) / 138) * h;
    dot(mx, my, 5.6, RED);
    ring(mx, my, 5.6, 1.3, CARD);
    const label = String(n);
    txt(label, mx - txtW(label, 1) / 2, my - 3.4, 1, CARD, true);
  }
}

// -------------------------------------------------------------- ticker icons
function iconWave(x: number, y: number): void {
  arcStroke(x + 2, y + 30, x + 12, y + 12, x + 22, y + 30, 3, TEAL);
  arcStroke(x + 16, y + 30, x + 26, y + 12, x + 36, y + 30, 3, TEAL);
  stroke(x + 4, y + 38, x + 36, y + 38, 2.2, TEAL);
}

function iconSpiral(x: number, y: number): void {
  let px2 = x + 20, py2 = y + 20;
  for (let t = 0.2; t < Math.PI * 5.2; t += 0.3) {
    const r = 1.6 + t * 1.15;
    const nx = x + 20 + r * Math.cos(t), ny = y + 20 + r * Math.sin(t) * 0.92;
    stroke(px2, py2, nx, ny, 2.4, BLUE);
    px2 = nx; py2 = ny;
  }
  dot(x + 20, y + 20, 2.6, BLUE);
}

function iconPlane(x: number, y: number): void {
  fillPoly([[x + 4, y + 26], [x + 30, y + 8], [x + 38, y + 10], [x + 37, y + 15], [x + 13, y + 28]], INK);
  fillPoly([[x + 17, y + 20], [x + 27, y + 30], [x + 15, y + 30]], INK);
  fillPoly([[x + 4, y + 26], [x + 2, y + 17], [x + 10, y + 18]], INK);
  arcStroke(x + 8, y + 30, x + 16, y + 36, x + 26, y + 33, 1.6, RED, 0.8);
}

function iconTent(x: number, y: number): void {
  fillPoly([[x + 3, y + 36], [x + 20, y + 10], [x + 37, y + 36]], SAND);
  fillPoly([[x + 14, y + 36], [x + 20, y + 22], [x + 26, y + 36]], [120, 92, 58]);
  stroke(x + 3, y + 36, x + 37, y + 36, 2, INK);
  box(x + 18.6, y + 13, 2.8, 8, RED);
  box(x + 16.2, y + 15.6, 7.6, 2.8, RED);
}

// A falling market chart: axes and a red line stepping down.
function iconChartDown(x: number, y: number): void {
  stroke(x + 4, y + 6, x + 4, y + 36, 1.6, GREY);
  stroke(x + 4, y + 36, x + 38, y + 36, 1.6, GREY);
  const pts: Array<[number, number]> = [[6, 10], [13, 16], [19, 13], [25, 22], [31, 27], [37, 33]];
  for (let i = 0; i + 1 < pts.length; i++) {
    stroke(x + pts[i][0], y + pts[i][1], x + pts[i + 1][0], y + pts[i + 1][1], 2.2, RED);
  }
  wedge(x + 34, y + 36, x + 40, y + 30, x + 36, y + 27, RED);
}

// A cracked ground: a jagged fissure with shaking lines above it.
function iconQuake(x: number, y: number): void {
  const pts: Array<[number, number]> = [[4, 34], [12, 26], [18, 30], [24, 20], [30, 26], [38, 16]];
  for (let i = 0; i + 1 < pts.length; i++) {
    stroke(x + pts[i][0], y + pts[i][1], x + pts[i + 1][0], y + pts[i + 1][1], 2.2, INK);
  }
  for (const [ox, oy] of [[10, 10], [22, 8], [32, 12]] as Array<[number, number]>) {
    stroke(x + ox - 3, y + oy, x + ox + 3, y + oy, 1.6, RED);
    stroke(x + ox, y + oy - 3, x + ox, y + oy + 3, 1.6, RED);
  }
}

// ------------------------------------------------------------------- layout
vGrad(0, 0, W, W, PAPER2, PAPER, 3);
outline(8, 8, W - 16, W - 16, 3, INK);

// Masthead
txt('NO. 323', 28, 40, 2, GREY, true);
txtR('ONE PAGE', W - 28, 40, 2, GREY, true);
txtC('THE WORLD IN ONE IMAGE', 24, 5, INK, true);
txtC("ALL THE DAY'S BIG STORIES - DRAWN, NOT PHOTOGRAPHED", 66, 2, GREY);
box(28, 88, W - 56, 3, INK);
box(28, 94, W - 56, 1.2, INK);

// The date band: the day, named as large as the page allows
box(16, 100, W - 32, 46, RED);
box(16, 142, W - 32, 4, RED2);
star5(30, 123, 7, GOLD2);
star5(W - 30, 123, 7, GOLD2);
txtC('WEDNESDAY 18 NOVEMBER 2026', 102, 6, CARD, true);

// --------------------------------------------------------------- lead story
txt('DIPLOMACY • APEC OPENS, SHENZHEN', 28, 158, 2, RED, true);
txt('XI & PUTIN OPEN', 28, 180, 4, INK, true);
txt('APEC, BLAST WEST', 28, 213, 4, INK, true);
txt('TRUMP LANDS', 28, 246, 4, INK, true);
txtBlock(
  'XI AND PUTIN MET IN SHENZHEN AND USED THE APEC SUMMIT TO ATTACK PROTECTIONISM AND WESTERN SANCTIONS. TRUMP LANDED HOURS LATER. TOMORROW: THE FIRST-EVER TRILATERAL SUMMIT.',
  28, 282, 2, 34, INK2,
);
txt('AT A GLANCE', 28, 396, 2, GREY, true);
{
  const chips: Array<[string, number]> = [['19 NOV', 82], ['21 ECONOMIES', 154], ['SHENZHEN', 106]];
  let chipX = 28;
  for (const [label, cw] of chips) {
    outline(chipX, 414, cw, 24, 1.6, INK2);
    txtC(label, 419, 2, INK, true, chipX + cw / 2);
    chipX += cw + 10;
  }
}
box(28, 452, 430, 1.6, GREY2);

// Right column: the scene, its caption, and the day on the map
sceneSummit(474, 158, 522, 162);
outline(474, 158, 522, 162, 2.4, INK);
txtC('THREE FLAGS OVER SHENZHEN BAY', 328, 2, GREY, false, 474 + 261);
outline(474, 348, 522, 114, 2, INK2);
txt('THE DAY ON THE MAP', 486, 355, 2, INK, true);
txtR('12 PLACES • 6 REGIONS', 984, 355, 2, GREY);
drawMap(486, 374, 498, 82);

// -------------------------------------------------------------- numbers band
box(16, 470, W - 32, 64, INK);
{
  const cells: Array<[string, string]> = [
    ['21', 'APEC ECONOMIES'],
    ['11,000+', 'EBOLA CASES'],
    ['$115.8B', 'NVIDIA REVENUE'],
    ['315', 'KM/H GUSTS'],
    ['24H', 'VOYAGER SIGNAL'],
  ];
  const cellW = (W - 32) / 5;
  cells.forEach(([num, label], i) => {
    const cx = 16 + cellW * (i + 0.5);
    txtC(num, 478, 4, GOLD2, true, cx);
    txtC(label, 512, 2, CREAM, false, cx);
    if (i > 0) box(16 + cellW * i, 480, 1.4, 44, [70, 78, 92]);
  });
}

// -------------------------------------------------------------- story grid
interface Panel {
  kicker: string;
  color: RGB;
  head1: string;
  head2: string;
  body: string;
  scene: (x: number, y: number, w: number, h: number) => void;
}

const panels: Panel[] = [
  {
    kicker: 'WAR IN THE GULF', color: RED,
    head1: 'US STRIKES', head2: 'QESHM',
    body: 'JETS HIT QESHM. IRAN HITS BACK.',
    scene: sceneStrait,
  },
  {
    kicker: 'UKRAINE WAR', color: BLUE,
    head1: 'KERCH SPAN', head2: 'DOWN',
    body: 'UKRAINE STRIKES AGAIN. SPAN DOWN.',
    scene: sceneBridge,
  },
  {
    kicker: 'US POLITICS', color: BLUE,
    head1: 'PELTOLA', head2: 'WINS ALASKA',
    body: 'DEMOCRATS TAKE SENATE 56-44.',
    scene: sceneSenate,
  },
  {
    kicker: 'HEALTH • DRC', color: RED,
    head1: 'EBOLA TOPS', head2: '11,000',
    body: '11,000 CASES. 5,400 DEAD.',
    scene: sceneEbola,
  },
  {
    kicker: 'MARKETS • NVIDIA', color: TEAL,
    head1: 'NVIDIA', head2: 'DOUBLES',
    body: '$115.8BN REVENUE. GUIDE $130BN.',
    scene: sceneChip,
  },
  {
    kicker: 'SPACE • NASA', color: NAVY,
    head1: 'LIGHT-DAY', head2: 'MILESTONE',
    body: 'SIGNAL NOW TAKES 24 HOURS HOME.',
    scene: sceneVoyager,
  },
  {
    kicker: 'CLIMATE • COP31', color: TEAL,
    head1: 'COP31 TALKS', head2: 'DEADLOCK',
    body: 'FINANCE + FUELS STALL THE DEAL.',
    scene: sceneCop,
  },
  {
    kicker: 'WEATHER', color: BLUE,
    head1: 'XAVIER', head2: 'CAT 5',
    body: 'GUSTS TO 315 KM/H COOK ISLANDS HIT',
    scene: sceneCyclone,
  },
  {
    kicker: 'HEALTH • USA', color: RED,
    head1: 'MEASLES', head2: 'STATUS LOST',
    body: '26 YEARS ENDED. 5,400+ CASES.',
    scene: sceneMeasles,
  },
];

const GRID_X = [28, 354, 680];
const GRID_Y = [542, 652, 762];
const PANEL_W = 316;
const PANEL_H = 104;

panels.forEach((p, i) => {
  const x = GRID_X[i % 3];
  const y = GRID_Y[Math.floor(i / 3)];
  box(x, y, PANEL_W, PANEL_H, CARD);
  p.scene(x, y, 96, PANEL_H);
  outline(x + 96, y, PANEL_W - 96, PANEL_H, 2, p.color);
  box(x, y, PANEL_W, 5, p.color);
  txt(p.kicker, x + 106, y + 9, 2, p.color, true);
  txt(p.head1, x + 106, y + 25, 3, INK, true);
  txt(p.head2, x + 106, y + 46, 3, INK, true);
  txtBlock(p.body, x + 106, y + 70, 2, 17, INK2, 2);
});

// ------------------------------------------------------------------- ticker
{
  const items: Array<{ color: RGB; tag: string; icon: (x: number, y: number) => void; text: string }> = [
    { color: RED, tag: 'DISASTER', icon: iconPlane, text: 'SIBERIA PLANE CRASH KILLS 19' },
    { color: GOLD, tag: 'MIDDLE EAST', icon: iconTent, text: 'GAZA TRUCE AT RISK AS COLD BITES' },
    { color: TEAL, tag: 'MARKETS', icon: iconChartDown, text: 'MARKETS SLIDE: S&P -1.0%' },
    { color: BLUE, tag: 'ASIA-PACIFIC', icon: iconQuake, text: '6.0 QUAKE HITS PAPUA NEW GUINEA' },
  ];
  items.forEach((it, i) => {
    const x = 28 + i * 244;
    const y = 874;
    box(x, y, 236, 92, CREAM);
    outline(x, y, 236, 92, 1.6, GREY2);
    box(x, y, 5, 92, it.color);
    it.icon(x + 10, y + 12);
    txtBlock(it.text, x + 56, y + 10, 2, 15, INK, 2);
    txt(it.tag, x + 56, y + 74, 1, GREY, true);
  });
}

// Footer
box(28, 976, W - 56, 1.6, INK);
txtC("FROM THE DAY'S REPORTING: REUTERS - AFP - AP - NASA - UN - BBC", 986, 2, GREY);

// ------------------------------------------------------- downsample + grain
const img = new Uint8Array(W * W * 3);
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * RW + (x * SS + dx)) * 3;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      }
    }
    const o = (y * W + x) * 3, n = SS * SS;
    // Newsprint grain: the same deterministic jitter every run, so the
    // bytes stay identical while flat areas stop compressing to nothing.
    // Only a share of pixels carries it, to keep the file near 500 KB.
    const covered = hash2(x + 31, y + 17) < GRAIN_COVER ? 1 : 0;
    const gr = covered * (hash2(x, y) - 0.5) * 2 * GRAIN;
    const gg = covered * (hash2(x + 7919, y + 104729) - 0.5) * 2 * GRAIN;
    const gb = covered * (hash2(x + 104729, y + 7919) - 0.5) * 2 * GRAIN;
    img[o] = Math.max(0, Math.min(255, Math.round(r / n + gr)));
    img[o + 1] = Math.max(0, Math.min(255, Math.round(g / n + gg)));
    img[o + 2] = Math.max(0, Math.min(255, Math.round(b / n + gb)));
  }
}

// ------------------------------------------------------------------ PNG out
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const signed = new Uint8Array(4 + data.length);
  signed.set(out.subarray(4, 8), 0);
  signed.set(data, 4);
  view.setUint32(8 + data.length, crc32(signed));
  return out;
}

function buildPNG(): Uint8Array {
  const raw = new Uint8Array((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter: none
    raw.set(img.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, W);
  v.setUint32(4, W);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png;
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = buildPNG();
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote entry.png: ${W}x${W}, ${png.length} bytes`);
