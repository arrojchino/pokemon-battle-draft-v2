/**
 * Walkable ground height for the town: a sparse heightfield baked once from the town's merged static geometry.
 *
 * The town floor is a flat disc at FLOOR_Y; a few walkable things stand a little above it (the shrine stage's
 * deck and stone rim, low kerbs). Every upward-facing triangle whose top lies between the floor and a step
 * height is rasterised into 4 cm cells; cells nothing raised covers stay at the floor and cost no memory
 * (16 x 16 cell tiles are allocated only where something is raised). `heightAt` is a bilinear lookup with no
 * allocation, cheap enough for every foot of every trainer each frame.
 */
import type * as THREE from 'three';

export interface GroundField {
  /** Ground height (world y) at a point; the floor height outside every raised surface. */
  heightAt(x: number, z: number): number;
  /** Raised cells and tiles (for QA and tests). */
  readonly stats: { cells: number; tiles: number; maxRise: number };
}

const CELL = 0.04;
const TILE = 16;

/**
 * Bake a ground field from world-space geometries (non-indexed or indexed). Triangles count when their normal
 * points up (y >= minUp) and all three corners lie within [floor - 0.005, floor + maxStep]; anything taller is
 * an obstacle the colliders already keep walkers off. Parts below the floor are clipped (a rim's outer slope
 * that starts underground still counts where it rises above the floor).
 */
export function bakeGroundField(geos: readonly THREE.BufferGeometry[], opts: { floor: number; radius: number; maxStep?: number; minUp?: number }): GroundField {
  const floor = opts.floor, maxStep = opts.maxStep ?? 0.08, minUp = opts.minUp ?? 0.3;
  const half = opts.radius + 0.5;
  const n = Math.ceil((half * 2) / CELL);              // cells per side
  const nt = Math.ceil(n / TILE);                      // tiles per side
  const tiles: (Float32Array | null)[] = new Array(nt * nt).fill(null);
  const x0 = -half, z0 = -half;
  let cells = 0, tilesUsed = 0, maxRise = 0;

  const put = (ix: number, iz: number, h: number) => {
    const t = (iz >> 4) * nt + (ix >> 4);
    let tile = tiles[t];
    if (!tile) { tile = tiles[t] = new Float32Array(TILE * TILE); tilesUsed++; }
    const k = (iz & 15) * TILE + (ix & 15);
    if (tile[k] === 0) cells++;
    if (h > tile[k]) { tile[k] = h; if (h > maxRise) maxRise = h; }
  };

  for (const geo of geos) {
    const pos = geo.getAttribute('position');
    if (!pos) continue;
    const idx = geo.getIndex();
    const tris = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const ay = pos.getY(a) - floor, by = pos.getY(b) - floor, cy = pos.getY(c) - floor;
      if (Math.max(ay, by, cy) > maxStep || Math.min(ay, by, cy) < -0.1) continue;   // parts below the floor clip at it
      if (Math.max(ay, by, cy) < 0.001) continue;      // flush with the floor: nothing to add
      const ax = pos.getX(a), az = pos.getZ(a), bx = pos.getX(b), bz = pos.getZ(b), cx = pos.getX(c), cz = pos.getZ(c);
      // face normal (y share): (b - a) x (c - a)
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12 || Math.abs(ny) / len < minUp) continue;
      // rasterise: cell centres inside the triangle, height from barycentrics
      const minX = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / CELL)), maxX = Math.min(n - 1, Math.floor((Math.max(ax, bx, cx) - x0) / CELL));
      const minZ = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / CELL)), maxZ = Math.min(n - 1, Math.floor((Math.max(az, bz, cz) - z0) / CELL));
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      for (let iz = minZ; iz <= maxZ; iz++) {
        const pz = z0 + (iz + 0.5) * CELL;
        for (let ix = minX; ix <= maxX; ix++) {
          const px = x0 + (ix + 0.5) * CELL;
          const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
          const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const h = w0 * ay + w1 * by + w2 * cy;
          if (h > 0.0005) put(ix, iz, h);
        }
      }
    }
  }

  const cell = (ix: number, iz: number): number => {
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return 0;
    const tile = tiles[(iz >> 4) * nt + (ix >> 4)];
    return tile ? tile[(iz & 15) * TILE + (ix & 15)] : 0;
  };

  return {
    heightAt(x: number, z: number): number {
      const fx = (x - x0) / CELL - 0.5, fz = (z - z0) / CELL - 0.5;
      const ix = Math.floor(fx), iz = Math.floor(fz);
      // fast path: the whole 2x2 neighbourhood sits in tiles with nothing raised
      if (ix >= 0 && iz >= 0 && ix + 1 < n && iz + 1 < n) {
        const t00 = tiles[(iz >> 4) * nt + (ix >> 4)], t11 = tiles[((iz + 1) >> 4) * nt + ((ix + 1) >> 4)];
        if (!t00 && !t11 && !tiles[(iz >> 4) * nt + ((ix + 1) >> 4)] && !tiles[((iz + 1) >> 4) * nt + (ix >> 4)]) return floor;
      }
      const tx = fx - ix, tz = fz - iz;
      const h00 = cell(ix, iz), h10 = cell(ix + 1, iz), h01 = cell(ix, iz + 1), h11 = cell(ix + 1, iz + 1);
      // bilinear inside a surface, but a raised cell next to a floor cell keeps its full height up to the
      // cell boundary (an edge, not a ramp: a sole on a kerb edge must not read half the kerb)
      const hi = Math.max(h00, h10, h01, h11);
      const bil = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
      const near = tx < 0.5 ? (tz < 0.5 ? h00 : h01) : (tz < 0.5 ? h10 : h11);
      return floor + (Math.abs(hi - Math.min(h00, h10, h01, h11)) > 0.012 ? Math.max(near, bil) : bil);
    },
    stats: { get cells() { return cells; }, get tiles() { return tilesUsed; }, get maxRise() { return maxRise; } } as GroundField['stats'],
  };
}
