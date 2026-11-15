// A small, dependency-free QR Code encoder (byte mode, error-correction L/M,
// versions 1-40). Used by the wallet to show share tokens as scannable codes.
// The algorithm follows the ISO/IEC 18004 structure: Reed-Solomon over GF(256),
// block interleaving, function patterns, eight masks scored by the standard penalty.

const ECC_PER_BLOCK: Record<'L' | 'M', number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
};
const NUM_BLOCKS: Record<'L' | 'M', number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
};
const FORMAT_BITS = { L: 1, M: 0 } as const;

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver: number, e: 'L' | 'M') => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
  }
  return r;
}

function addEcc(data: number[], ver: number, e: 'L' | 'M'): number[] {
  const nb = NUM_BLOCKS[e][ver];
  const eccLen = ECC_PER_BLOCK[e][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) out.push(b[i]); });
  }
  return out;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

export function qrMatrix(text: string, ecc: 'L' | 'M' = 'M'): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ; ver++) {
    if (ver > 40) throw new Error('QR: text too long');
    const countBits = ver < 10 ? 8 : 16;
    if (4 + countBits + 8 * bytes.length <= dataCodewords(ver, ecc) * 8) break;
  }
  const bits: number[] = [];
  const push = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const cap = dataCodewords(ver, ecc) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const words = addEcc(data, ver, ecc);

  const size = ver * 4 + 17;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFn = (x: number, y: number, v: boolean) => { mod[y][x] = v; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const pos: number[] = [];
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    pos.push(6);
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
  }
  pos.forEach((px, i) => pos.forEach((py, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask: number) => {
    const d = (FORMAT_BITS[ecc] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i));
    setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), c = Math.floor(i / 3);
      setFn(a, c, bit(b, i)); setFn(c, a, bit(b, i));
    }
  }
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && k < words.length * 8) { mod[y][x] = bit(words[k >>> 3], 7 - (k & 7)); k++; }
    }
  }
  const apply = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue;
      const inv = [
        (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
        (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0,
        (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
      ][mask];
      if (inv) mod[y][x] = !mod[y][x];
    }
  };
  const penalty = (): number => {
    let p = 0, dark = 0;
    const lines: string[] = [];
    for (let y = 0; y < size; y++) {
      let row = '', col = '';
      for (let x = 0; x < size; x++) { row += mod[y][x] ? '1' : '0'; col += mod[x][y] ? '1' : '0'; if (mod[y][x]) dark++; }
      lines.push(row, col);
    }
    for (const l of lines) {
      for (const m of l.matchAll(/(0{5,}|1{5,})/g)) p += 3 + m[0].length - 5;
      for (const m of l.matchAll(/(?=(10111010000|00001011101))/g)) { void m; p += 40; }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    const total = size * size;
    p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10 ; // N4 approximation
    return p;
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    apply(m); drawFormat(m);
    const s = penalty();
    if (s < bestScore) { bestScore = s; best = m; }
    apply(m); // undo
  }
  apply(best); drawFormat(best);
  return mod;
}

/** Builds an <svg> (one path) for the given text, with the mandatory 4-module quiet zone. */
export function qrSvg(text: string, px = 240): SVGElement {
  const m = qrMatrix(text);
  const n = m.length, quiet = 4, total = n + quiet * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(total)); bg.setAttribute('height', String(total)); bg.setAttribute('fill', '#fff');
  svg.appendChild(bg);
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + quiet},${y + quiet}h1v1h-1z`;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', '#000');
  svg.appendChild(path);
  return svg;
}
