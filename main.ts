import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

// ---------- deterministic PRNG (mulberry32, fixed seed) ----------
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20261118);

// ---------- canvas ----------
const W = 1024;
const H = 1024;
const buf = new Uint8Array(W * H * 3);

type RGB = [number, number, number];
const PAPER: RGB = [247, 243, 232];
const PANEL: RGB = [253, 251, 243];
const INK: RGB = [17, 17, 17];
const RED: RGB = [193, 39, 45];
const BLUE: RGB = [27, 58, 92];
const BLUE2: RGB = [46, 92, 138];
const SKY: RGB = [176, 196, 210];
const GREY: RGB = [120, 124, 128];
const ORANGE: RGB = [232, 116, 24];
const YELLOW: RGB = [244, 196, 48];
const GREEN: RGB = [46, 125, 70];
const BROWN: RGB = [122, 84, 52];
const WHITE: RGB = [255, 255, 255];
const LIGHTBLUE: RGB = [140, 180, 210];

function fillAll(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = c[0];
    buf[i * 3 + 1] = c[1];
    buf[i * 3 + 2] = c[2];
  }
}
function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}
function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
  }
}
function drawLine(x0: number, y0: number, x1: number, y1: number, c: RGB, th: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (dx * i) / steps);
    const y = Math.round(y0 + (dy * i) / steps);
    const r = Math.floor(th / 2);
    fillRect(x - r, y - r, th, th, c);
  }
}
function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) setPx(cx + x, cy + y, c);
    }
  }
}
function fillPolygon(pts: Array<[number, number]>, c: RGB): void {
  let minY = 1e9;
  let maxY = -1e9;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      fillRect(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]), 1, c);
    }
  }
}
function burst(cx: number, cy: number, r: number, c1: RGB, c2: RGB): void {
  fillCircle(cx, cy, r, c1);
  fillCircle(cx, cy, Math.floor(r * 0.55), c2);
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + 0.3;
    const x2 = cx + Math.cos(ang) * r * 1.5;
    const y2 = cy + Math.sin(ang) * r * 1.5;
    drawLine(cx, cy, Math.round(x2), Math.round(y2), c1, 5);
  }
  fillCircle(cx, cy, Math.floor(r * 0.4), c2);
}

// ---------- bitmap font: 5x7 glyphs, rows as 5-bit numbers ----------
const FONT: Record<string, number[]> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ".": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  ",": [0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b00100, 0b01000],
  "-": [0b00000, 0b00000, 0b00000, 0b01110, 0b00000, 0b00000, 0b00000],
  "'": [0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000],
  ":": [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000],
  ";": [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b00100, 0b01000],
  "!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  "?": [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0b00000, 0b00100],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  " ": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
};
const GLYPH_W = 5;
const GLYPH_H = 7;
function charWidth(scale: number): number {
  return (GLYPH_W + 1) * scale;
}
function textWidth(s: string, scale: number): number {
  return s.length * charWidth(scale) - scale;
}
function drawGlyph(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if ((g[row] >> (GLYPH_W - 1 - col)) & 1) {
        fillRect(x + col * scale, y + row * scale, scale, scale, c);
      }
    }
  }
}
function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  const up = s.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    drawGlyph(up[i], x + i * charWidth(scale), y, scale, c);
  }
}
function drawTextCentered(s: string, cx: number, y: number, scale: number, c: RGB): void {
  const w = textWidth(s.toUpperCase(), scale);
  drawText(s, Math.round(cx - w / 2), y, scale, c);
}
function wrapText(s: string, maxW: number, scale: number): string[] {
  const words = s.toUpperCase().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}
function drawWrapped(s: string, x: number, y: number, maxW: number, scale: number, c: RGB, lineH: number): number {
  const lines = wrapText(s, maxW, scale);
  for (let i = 0; i < lines.length; i++) {
    drawText(lines[i], x, y + i * lineH, scale, c);
  }
  return y + lines.length * lineH;
}

// ---------- PNG encoder (filter 0, zlib deflate, CRC32) ----------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc32(crcData));
  return out;
}
function encodePng(): Uint8Array {
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(buf.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const comp = deflateSync(raw, { level: 9 });
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", comp), chunk("IEND", new Uint8Array(0))];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------- layout ----------
function panel(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, PANEL);
  fillRect(x, y, w, 3, INK);
  fillRect(x, y + h - 3, w, 3, INK);
  fillRect(x, y, 3, h, INK);
  fillRect(x + w - 3, y, 3, h, INK);
}
function kicker(s: string, x: number, y: number): void {
  drawText(s, x, y, 2, RED);
}
function drawShip(x: number, y: number, w: number, c: RGB): void {
  // hull
  fillPolygon(
    [
      [x, y],
      [x + w, y],
      [x + w - 14, y + 22],
      [x + 14, y + 22],
    ],
    c
  );
  // deck house + funnel
  fillRect(x + Math.floor(w * 0.55), y - 18, 26, 18, c);
  fillRect(x + Math.floor(w * 0.2), y - 12, 14, 12, c);
  drawLine(x + Math.floor(w * 0.35), y - 30, x + Math.floor(w * 0.35), y, INK, 3);
  fillRect(x + Math.floor(w * 0.35) - 8, y - 34, 16, 6, RED);
}
function drawSmoke(cx: number, cy: number): void {
  const g1: RGB = [90, 90, 90];
  const g2: RGB = [140, 140, 140];
  fillCircle(cx, cy, 16, g2);
  fillCircle(cx - 12, cy + 8, 12, g1);
  fillCircle(cx + 12, cy + 6, 13, g1);
  fillCircle(cx, cy - 12, 11, g2);
}

function main(): void {
  fillAll(PAPER);
  const M = 28;
  const innerW = W - 2 * M;

  // ===== masthead =====
  fillRect(M, 18, innerW, 4, INK);
  drawTextCentered("WORLD NEWS", W / 2, 30, 10, INK);
  fillRect(M, 112, innerW, 6, RED);
  drawTextCentered("WEDNESDAY 18 NOVEMBER 2026", W / 2, 128, 4, INK);
  fillRect(M, 164, innerW, 4, INK);

  // ===== lead story =====
  const leadY = 178;
  const leadH = 296;
  panel(M, leadY, innerW, leadH);
  const lx = M + 18;
  kicker("LEAD STORY - U.S. - IRAN", lx, leadY + 16);
  drawText("U.S. SINKS FIVE", lx, leadY + 40, 5, INK);
  drawText("IRANIAN TANKERS", lx, leadY + 82, 5, INK);
  drawText("IRAN HITS BACK AT SHIPS AND A U.S. BASE IN JORDAN", lx, leadY + 128, 2, INK);
  // sea scene, bottom of lead panel
  const seaY = leadY + 158;
  const seaH = leadH - 158 - 12;
  const seaX = M + 12;
  const seaW = innerW - 24;
  fillRect(seaX, seaY, seaW, seaH, BLUE);
  // horizon + waves
  fillRect(seaX, seaY, seaW, 4, BLUE2);
  for (let i = 0; i < 14; i++) {
    const wx = seaX + 20 + Math.floor(rng() * (seaW - 60));
    const wy = seaY + 18 + Math.floor(rng() * (seaH - 30));
    drawLine(wx, wy, wx + 34, wy, LIGHTBLUE, 2);
  }
  drawShip(seaX + 60, seaY + 62, 150, INK);
  drawShip(seaX + 330, seaY + 70, 130, [40, 40, 40]);
  drawShip(seaX + 640, seaY + 58, 160, INK);
  burst(seaX + 300, seaY + 34, 22, ORANGE, YELLOW);
  burst(seaX + 700, seaY + 28, 18, ORANGE, YELLOW);
  burst(seaX + 520, seaY + 44, 14, ORANGE, YELLOW);
  drawSmoke(seaX + 300, seaY + 8);
  drawSmoke(seaX + 700, seaY + 4);

  // ===== second row: three panels =====
  const row2Y = 490;
  const row2H = 258;
  const pw = 314;
  const gap = 13;
  const x1 = M;
  const x2 = M + pw + gap;
  const x3 = M + 2 * (pw + gap);

  // 1 Ukraine
  panel(x1, row2Y, pw, row2H);
  kicker("UKRAINE", x1 + 14, row2Y + 14);
  drawWrapped("KYIV HITS KERCH BRIDGE AGAIN", x1 + 14, row2Y + 38, pw - 28, 3, INK, 26);
  drawWrapped("SECOND NIGHT OF STRIKES ON THE CRIMEA LINK", x1 + 14, row2Y + 122, pw - 28, 2, INK, 18);
  const artY = row2Y + 168;
  fillRect(x1 + 12, artY, pw - 24, row2H - 180, SKY);
  // bridge deck with broken span
  drawLine(x1 + 22, artY + 34, x1 + 150, artY + 34, INK, 6);
  drawLine(x1 + 210, artY + 34, x1 + pw - 22, artY + 34, INK, 6);
  drawLine(x1 + 150, artY + 34, x1 + 190, artY + 58, INK, 6);
  drawLine(x1 + 60, artY + 34, x1 + 60, artY + 8, INK, 4);
  drawLine(x1 + 250, artY + 34, x1 + 250, artY + 8, INK, 4);
  drawLine(x1 + 22, artY + 34, x1 + 22, artY + 62, INK, 4);
  drawLine(x1 + pw - 22, artY + 34, x1 + pw - 22, artY + 62, INK, 4);
  burst(x1 + 182, artY + 32, 13, ORANGE, YELLOW);
  drawSmoke(x1 + 182, artY + 20);

  // 2 Gaza
  panel(x2, row2Y, pw, row2H);
  kicker("GAZA", x2 + 14, row2Y + 14);
  drawWrapped("U.N. WARNS OF WINTER DEATHS IN GAZA", x2 + 14, row2Y + 38, pw - 28, 3, INK, 26);
  drawWrapped("1.7 MILLION DISPLACED AS COLD SETS IN", x2 + 14, row2Y + 122, pw - 28, 2, INK, 18);
  fillRect(x2 + 12, artY, pw - 24, row2H - 180, SKY);
  // tents
  fillPolygon(
    [
      [x2 + 30, artY + 62],
      [x2 + 80, artY + 18],
      [x2 + 130, artY + 62],
    ],
    [210, 205, 190]
  );
  fillPolygon(
    [
      [x2 + 120, artY + 62],
      [x2 + 175, artY + 10],
      [x2 + 230, artY + 62],
    ],
    WHITE
  );
  fillPolygon(
    [
      [x2 + 220, artY + 62],
      [x2 + 262, artY + 26],
      [x2 + 300, artY + 62],
    ],
    [210, 205, 190]
  );
  fillRect(x2 + 12, artY + 62, pw - 24, 4, INK);
  // rain
  for (let i = 0; i < 16; i++) {
    const rx = x2 + 22 + Math.floor(rng() * (pw - 50));
    const ry = artY + 4 + Math.floor(rng() * 30);
    drawLine(rx, ry, rx - 5, ry + 12, BLUE2, 2);
  }
  // snow dots
  for (let i = 0; i < 12; i++) {
    const sx = x2 + 22 + Math.floor(rng() * (pw - 50));
    const sy = artY + 4 + Math.floor(rng() * 40);
    fillRect(sx, sy, 3, 3, WHITE);
  }

  // 3 Climate
  panel(x3, row2Y, pw, row2H);
  kicker("CLIMATE - COP31", x3 + 14, row2Y + 14);
  drawWrapped("COP31 TALKS ENTER FINAL DAYS", x3 + 14, row2Y + 38, pw - 28, 3, INK, 26);
  drawWrapped("144 DISPUTED ITEMS IN ANTALYA DRAFT", x3 + 14, row2Y + 122, pw - 28, 2, INK, 18);
  fillRect(x3 + 12, artY, pw - 24, row2H - 180, PANEL);
  // globe
  const gx = x3 + 78;
  const gy = artY + 36;
  fillCircle(gx, gy, 32, BLUE2);
  fillCircle(gx - 10, gy - 8, 12, GREEN);
  fillCircle(gx + 12, gy + 10, 10, GREEN);
  fillCircle(gx + 8, gy - 14, 7, GREEN);
  // thermometer
  fillRect(x3 + 190, artY + 10, 12, 44, WHITE);
  fillRect(x3 + 190, artY + 10, 12, 44, INK);
  fillRect(x3 + 193, artY + 13, 6, 38, WHITE);
  fillRect(x3 + 193, artY + 30, 6, 21, RED);
  fillCircle(x3 + 196, artY + 56, 10, RED);
  // sun
  fillCircle(x3 + 252, artY + 16, 11, YELLOW);
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    drawLine(
      x3 + 252 + Math.round(Math.cos(ang) * 15),
      artY + 16 + Math.round(Math.sin(ang) * 15),
      x3 + 252 + Math.round(Math.cos(ang) * 21),
      artY + 16 + Math.round(Math.sin(ang) * 21),
      YELLOW,
      3
    );
  }

  // ===== third row: two panels =====
  const row3Y = 764;
  const row3H = 232;
  const pw2 = 477;
  const y1 = M;
  const y2 = M + pw2 + 14;
  // 1 Asia
  panel(y1, row3Y, pw2, row3H);
  kicker("ASIA - QUAD", y1 + 14, row3Y + 14);
  drawWrapped("TRUMP IN MANILA FOR QUAD TALKS", y1 + 14, row3Y + 38, pw2 - 28, 3, INK, 26);
  drawWrapped("AHEAD OF APEC SUMMIT IN CHINA", y1 + 14, row3Y + 96, pw2 - 28, 2, INK, 18);
  const art3Y = row3Y + 130;
  fillRect(y1 + 12, art3Y, pw2 - 24, row3H - 142, PANEL);
  // summit table
  fillRect(y1 + 70, art3Y + 52, pw2 - 140, 10, BROWN);
  fillRect(y1 + 80, art3Y + 62, 8, 26, BROWN);
  fillRect(y1 + pw2 - 100, art3Y + 62, 8, 26, BROWN);
  // four seats
  const seatCols: RGB[] = [RED, BLUE2, GREEN, YELLOW];
  for (let i = 0; i < 4; i++) {
    const sx = y1 + 78 + i * 88;
    fillRect(sx, art3Y + 18, 44, 34, seatCols[i]);
    fillRect(sx + 6, art3Y + 6, 32, 12, INK);
    // flag pole
    drawLine(sx + 22, art3Y + 6, sx + 22, art3Y - 14, INK, 2);
    fillRect(sx + 22, art3Y - 14, 20, 12, seatCols[i]);
  }
  // 2 Lighter note
  panel(y2, row3Y, pw2, row3H);
  kicker("LIGHTER NOTE", y2 + 14, row3Y + 14);
  drawWrapped("PATTINSON IS THE NEW JAMES BOND", y2 + 14, row3Y + 38, pw2 - 28, 3, INK, 26);
  drawWrapped("PLUS: NORTH KOREA FIRES MISSILE TO SEA; VOYAGER 1 NEARS ONE LIGHT-DAY", y2 + 14, row3Y + 96, pw2 - 28, 2, INK, 18);
  fillRect(y2 + 12, art3Y, pw2 - 24, row3H - 142, PANEL);
  // tuxedo silhouette
  const tx = y2 + 70;
  const ty = art3Y + 8;
  fillRect(tx, ty, 90, 76, INK);
  fillPolygon(
    [
      [tx + 45, ty + 6],
      [tx + 62, ty + 26],
      [tx + 45, ty + 46],
      [tx + 28, ty + 26],
    ],
    WHITE
  );
  fillRect(tx + 32, ty + 14, 26, 10, RED);
  fillRect(tx + 24, ty + 30, 42, 4, WHITE);
  // clapperboard
  const cx = y2 + 250;
  const cy = art3Y + 14;
  fillRect(cx, cy, 150, 58, INK);
  fillRect(cx + 4, cy + 4, 142, 14, WHITE);
  for (let i = 0; i < 6; i++) {
    fillPolygon(
      [
        [cx + 8 + i * 24, cy + 4],
        [cx + 24 + i * 24, cy + 4],
        [cx + 12 + i * 24, cy + 18],
        [cx - 4 + i * 24, cy + 18],
      ],
      INK
    );
  }
  fillRect(cx + 4, cy + 24, 142, 30, WHITE);
  drawText("007", cx + 52, cy + 30, 2, INK);

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const png = encodePng();
  writeFileSync(join(outDir, "entry.png"), png);
}

main();
