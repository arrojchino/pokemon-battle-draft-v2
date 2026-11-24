import * as THREE from 'three';

/** Small canvas textures for the town: cloth atlas (noren and banners), flower and grass cards, baked light maps. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

export type ShopIcon = 'potion' | 'ball' | 'berry';

function drawIcon(g: CanvasRenderingContext2D, kind: ShopIcon | 'banner', cx: number, cy: number, s: number, fg: string, bg: string): void {
  g.save(); g.translate(cx, cy); g.scale(s, s);
  g.fillStyle = fg; g.strokeStyle = fg;
  if (kind === 'potion') {
    g.beginPath(); g.arc(0, 14, 30, 0, Math.PI * 2); g.fill();
    g.fillRect(-11, -32, 22, 24);
    g.fillRect(-16, -42, 32, 12);
    g.fillStyle = bg; g.beginPath(); g.arc(0, 18, 18, 0.15 * Math.PI, 0.85 * Math.PI); g.fill();
    g.fillStyle = fg; g.beginPath(); g.ellipse(-10, 4, 5, 9, -0.5, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  } else if (kind === 'ball' || kind === 'banner') {
    g.lineWidth = 7;
    g.beginPath(); g.arc(0, 0, 34, Math.PI, 0); g.fill();
    g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.stroke();
    g.fillRect(-34, -4, 68, 8);
    g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.fillStyle = fg; g.fill();
    g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  } else {
    g.beginPath();
    g.moveTo(0, -18);
    g.bezierCurveTo(30, -36, 44, 6, 0, 36);
    g.bezierCurveTo(-44, 6, -30, -36, 0, -18);
    g.fill();
    g.beginPath(); g.moveTo(0, -18); g.quadraticCurveTo(8, -40, 26, -42); g.quadraticCurveTo(14, -26, 0, -18); g.fill();
    g.fillStyle = bg; g.beginPath(); g.ellipse(-10, 0, 5, 9, 0.4, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

/**
 * Cloth atlas, 2 x 2 cells: potion noren (indigo), ball noren (red), berry noren (green), gate banner (navy and gold).
 * Cell order matches `CLOTH_CELL`.
 */
export const CLOTH_CELL = { potion: [0, 0], ball: [1, 0], berry: [0, 1], banner: [1, 1] } as const;

export function createClothAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const cells: Array<{ key: keyof typeof CLOTH_CELL; base: string; dark: string; fg: string }> = [
    { key: 'potion', base: '#27346e', dark: '#18204a', fg: '#f1ecdf' },
    { key: 'ball', base: '#b8202c', dark: '#7c141c', fg: '#fff3e6' },
    { key: 'berry', base: '#2f6b3e', dark: '#1d4528', fg: '#f6eed8' },
    { key: 'banner', base: '#1b2a63', dark: '#101a40', fg: '#ffc94a' },
  ];
  for (const cell of cells) {
    const [cx, cy] = CLOTH_CELL[cell.key];
    const x0 = cx * 256, y0 = cy * 256;
    const gr = g.createLinearGradient(0, y0, 0, y0 + 256);
    gr.addColorStop(0, cell.dark); gr.addColorStop(0.18, cell.base); gr.addColorStop(1, cell.base);
    g.fillStyle = gr; g.fillRect(x0, y0, 256, 256);
    // woven texture
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + Math.random() * 0.04})`;
      g.fillRect(x0 + Math.random() * 256, y0 + Math.random() * 256, 1 + Math.random() * 3, 1);
    }
    g.fillStyle = cell.dark; g.fillRect(x0, y0 + 240, 256, 16);
    if (cell.key === 'banner') {
      g.fillStyle = '#ff3b4a'; g.fillRect(x0 + 18, y0, 22, 256); g.fillRect(x0 + 216, y0, 22, 256);
      g.fillStyle = cell.fg; g.fillRect(x0 + 44, y0, 6, 256); g.fillRect(x0 + 206, y0, 6, 256);
      drawIcon(g, 'banner', x0 + 128, y0 + 100, 1.45, cell.fg, cell.base);
      g.fillStyle = cell.fg;
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x0 + 98 + k * 30, y0 + 190); g.lineTo(x0 + 113 + k * 30, y0 + 210); g.lineTo(x0 + 128 + k * 30, y0 + 190); g.closePath(); g.fill(); }
    } else {
      g.strokeStyle = cell.fg; g.globalAlpha = 0.55; g.lineWidth = 3;
      g.strokeRect(x0 + 10, y0 + 30, 236, 200);
      g.globalAlpha = 1;
      g.beginPath(); g.arc(x0 + 128, y0 + 118, 62, 0, Math.PI * 2); g.fillStyle = cell.fg; g.fill();
      drawIcon(g, cell.key as ShopIcon, x0 + 128, y0 + 120, 1.25, cell.base, cell.fg);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Card atlas, 2 x 2 cells: grass tuft, pink cosmos, golden marigolds, blue hydrangeas. Alpha cut-out. */
export function createCardAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const rnd = mulberry(7);
  const blade = (x0: number, y0: number, col: string) => {
    const bx = x0 + 128 + (rnd() - 0.5) * 200, h = 120 + rnd() * 120, lean = (rnd() - 0.5) * 70, w = 4 + rnd() * 6;
    g.fillStyle = col; g.beginPath();
    g.moveTo(bx - w, y0 + 256); g.quadraticCurveTo(bx + lean * 0.3, y0 + 256 - h * 0.6, bx + lean, y0 + 256 - h);
    g.quadraticCurveTo(bx + lean * 0.3 + w * 0.5, y0 + 256 - h * 0.55, bx + w, y0 + 256); g.fill();
  };
  // grass
  for (let i = 0; i < 70; i++) blade(0, 0, ['#3d6b2e', '#4e7f37', '#2f5a28', '#5d8c3c'][i % 4]);
  // flowers: leaves first, then heads
  const flowers = (cx: number, cy: number, petals: string[], center: string, size: number, n: number, style: 'daisy' | 'ball') => {
    for (let i = 0; i < 26; i++) blade(cx * 256, cy * 256, ['#2e5a2a', '#3c6c30', '#28502a'][i % 3]);
    for (let i = 0; i < n; i++) {
      const x = cx * 256 + 40 + rnd() * 176, y = cy * 256 + 30 + rnd() * 120;
      g.strokeStyle = '#2f5a28'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 20, cy * 256 + 256); g.stroke();
      const s = size * (0.75 + rnd() * 0.5);
      g.fillStyle = petals[i % petals.length];
      if (style === 'daisy') {
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + rnd(); g.beginPath(); g.ellipse(x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6, s * 0.55, s * 0.28, a, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = center; g.beginPath(); g.arc(x, y, s * 0.3, 0, Math.PI * 2); g.fill();
      } else {
        for (let k = 0; k < 14; k++) { g.fillStyle = petals[(i + k) % petals.length]; g.beginPath(); g.arc(x + (rnd() - 0.5) * s * 1.4, y + (rnd() - 0.5) * s * 1.1, s * 0.32, 0, Math.PI * 2); g.fill(); }
      }
    }
  };
  flowers(1, 0, ['#ff8fbf', '#ffd2e6', '#f05a9a'], '#ffd23f', 22, 9, 'daisy');
  flowers(0, 1, ['#ffb52e', '#ffd84a', '#ff7a1e'], '#8a3b12', 20, 10, 'daisy');
  flowers(1, 1, ['#7aa8ff', '#a98bff', '#5d7bf0', '#c4b6ff'], '#ffffff', 26, 6, 'ball');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return t;
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type LightPool = { x: number; z: number; r: number; color: THREE.ColorRepresentation; i: number };
export type AOBlob = { x: number; z: number; r: number; a: number } | { x: number; z: number; hw: number; hd: number; rot: number; a: number; blur: number };

/** Light map scale: decoded light = texel^2 * LM_SCALE (sqrt encoding keeps dim falloffs smooth in 8 bits). */
export const LM_SCALE = 4;

/** Bake lantern light pools and ground contact occlusion into two 512^2 maps covering `rect` (minX, minZ, size). */
export function bakeLightMaps(pools: LightPool[], blobs: AOBlob[], rect: { minX: number; minZ: number; size: number }): { lm: THREE.CanvasTexture; ao: THREE.CanvasTexture } {
  const N = 512;
  const k = N / rect.size;
  const toPx = (x: number, z: number) => [(x - rect.minX) * k, (z - rect.minZ) * k] as const;
  const [lc, lg] = canvas(N, N);
  lg.fillStyle = '#000'; lg.fillRect(0, 0, N, N);
  lg.globalCompositeOperation = 'lighter';
  const col = new THREE.Color();
  for (const p of pools) {
    col.set(p.color);
    const [px, pz] = toPx(p.x, p.z);
    const enc = (v: number) => Math.round(255 * Math.min(1, Math.sqrt(Math.max(0, v * p.i) / LM_SCALE)));
    const gr = lg.createRadialGradient(px, pz, 0, px, pz, p.r * k);
    gr.addColorStop(0, `rgb(${enc(col.r)},${enc(col.g)},${enc(col.b)})`);
    gr.addColorStop(0.35, `rgb(${Math.round(enc(col.r) * 0.62)},${Math.round(enc(col.g) * 0.62)},${Math.round(enc(col.b) * 0.62)})`);
    gr.addColorStop(1, 'rgb(0,0,0)');
    lg.fillStyle = gr; lg.beginPath(); lg.arc(px, pz, p.r * k, 0, Math.PI * 2); lg.fill();
  }
  const [ac, ag] = canvas(N, N);
  ag.fillStyle = '#fff'; ag.fillRect(0, 0, N, N);
  for (const b of blobs) {
    const [px, pz] = toPx(b.x, b.z);
    if ('r' in b) {
      const gr = ag.createRadialGradient(px, pz, 0, px, pz, b.r * k);
      gr.addColorStop(0, `rgba(0,0,0,${b.a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ag.fillStyle = gr; ag.beginPath(); ag.arc(px, pz, b.r * k, 0, Math.PI * 2); ag.fill();
    } else {
      ag.save();
      ag.filter = `blur(${Math.max(1, b.blur * k)}px)`;
      ag.translate(px, pz); ag.rotate(-b.rot);
      ag.fillStyle = `rgba(0,0,0,${b.a})`;
      ag.fillRect(-b.hw * k, -b.hd * k, b.hw * 2 * k, b.hd * 2 * k);
      ag.restore();
    }
  }
  const mk = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.flipY = false; t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  return { lm: mk(lc), ao: mk(ac) };
}

/**
 * Tileable 256^2 noise atlas so fragment shaders sample instead of hashing:
 * R value noise (8 lattice cells per tile), G value noise (32 cells), B Voronoi edge distance (8 x 8 cells, cell units x 2),
 * A Voronoi cell id. Shaders use p / 8 as texture coordinate for one lattice cell per world unit of p.
 */
export function createNoiseTexture(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number, s: number) => {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const value = (px: number, py: number, cells: number, seed: number) => {
    const x = (px / N) * cells, y = (py / N) * cells;
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const w = (a: number) => ((a % cells) + cells) % cells;
    const a = hash(w(ix), w(iy), seed), b = hash(w(ix + 1), w(iy), seed), c = hash(w(ix), w(iy + 1), seed), d = hash(w(ix + 1), w(iy + 1), seed);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
  const VC = 8;
  const feat = (cx: number, cy: number): [number, number] => {
    const wx = ((cx % VC) + VC) % VC, wy = ((cy % VC) + VC) % VC;
    return [0.15 + 0.7 * hash(wx, wy, 11), 0.15 + 0.7 * hash(wx, wy, 23)];
  };
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const i = (py * N + px) * 4;
    data[i] = Math.round(value(px + 0.5, py + 0.5, 8, 1) * 255);
    data[i + 1] = Math.round(value(px + 0.5, py + 0.5, 32, 2) * 255);
    const x = ((px + 0.5) / N) * VC, y = ((py + 0.5) / N) * VC;
    const nx = Math.floor(x), ny = Math.floor(y), fx = x - nx, fy = y - ny;
    let md = 8, mrx = 0, mry = 0, mgx = 0, mgy = 0;
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const o = feat(nx + k, ny + j);
      const rx = k + o[0] - fx, ry = j + o[1] - fy, d = rx * rx + ry * ry;
      if (d < md) { md = d; mrx = rx; mry = ry; mgx = k; mgy = j; }
    }
    let ed = 8;
    for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) {
      const gx = mgx + k, gy = mgy + j;
      const o = feat(nx + gx, ny + gy);
      const rx = gx + o[0] - fx, ry = gy + o[1] - fy;
      const dx = rx - mrx, dy = ry - mry, l = Math.hypot(dx, dy);
      if (l < 1e-5) continue;
      ed = Math.min(ed, ((mrx + rx) * 0.5 * dx + (mry + ry) * 0.5 * dy) / l);
    }
    data[i + 2] = Math.round(Math.min(1, ed * 2) * 255);
    const cx = (((nx + mgx) % VC) + VC) % VC, cy = (((ny + mgy) % VC) + VC) % VC;
    data[i + 3] = Math.round(hash(cx, cy, 37) * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
