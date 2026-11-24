import * as THREE from 'three';
import { fbm, ramp, smax, smooth } from './shared.js';

/**
 * The intro's geography, in world units (a partner is about 1 tall, a trainer 1.45).
 * A shrine path climbs gently along +z toward a crest at the origin; the partner's stone dais sits on the crest,
 * right above a cliff that drops ~30 units into a valley. The town fills the valley ahead (-z), a lake lies under
 * the moon to the left, the stadium glows to the right, and mountains ring the basin.
 */

export const FLOOR_Y = 0.205;
export const BASIN_Y = -30;
export const WATER_Y = -30.55;
/** The cliff starts at z = EDGE_Z on the axis and curls back toward +z at the sides. */
export const EDGE_Z = -2.7;
export const DAIS_R = 1.75;

const DEG = Math.PI / 180;
/** The moon in the sky: azimuth -36 degrees (left of -z), 8.5 degrees up. */
export const MOON_AZ = -36 * DEG, MOON_EL = 8.5 * DEG;
export function moonDir(el = MOON_EL): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(MOON_AZ) * Math.cos(el), Math.sin(el), -Math.cos(MOON_AZ) * Math.cos(el)).normalize();
}

/** Polar helper: azimuth (radians, + is +x) and distance from the crest, ahead of the crest (-z). */
export const polar = (az: number, d: number): [number, number] => [Math.sin(az) * d, -Math.cos(az) * d];

/** The lake: an ellipse along the moon's azimuth so the moon's reflection runs down it. */
export const LAKE = (() => {
  const [x, z] = polar(MOON_AZ - 2 * DEG, 182);
  return { x, z, a: 78, b: 40, ux: Math.sin(MOON_AZ), uz: -Math.cos(MOON_AZ) };
})();
/** Normalised elliptical distance from the lake centre (1 on the shore). */
export function lakeE(x: number, z: number): number {
  const dx = x - LAKE.x, dz = z - LAKE.z;
  const u = dx * LAKE.ux + dz * LAKE.uz, v = -dx * LAKE.uz + dz * LAKE.ux;
  return Math.hypot(u / LAKE.a, v / LAKE.b);
}

export const STADIUM = (() => { const [x, z] = polar(15 * DEG, 178); return { x, z, r: 15 }; })();
export const TOWN_CENTRE = (() => { const [x, z] = polar(3 * DEG, 125); return { x, z }; })();

export function pathX(z: number): number { return 1.3 * Math.sin(z * 0.075) * smooth(6, 16, z); }
export function pathY(z: number): number { return -0.105 * ramp(z - 4, 2); }
export function pathYaw(z: number): number {
  const e = 0.05;
  return Math.atan2(pathX(z + e) - pathX(z - e), 2 * e);
}

function hillY(x: number, z: number): number {
  const a = Math.abs(x - pathX(z));
  const r0 = Math.hypot(x, z);
  let y = pathY(z);
  // grassy banks either side of the path
  y += 0.75 * smooth(3, 10, z) * smooth(1.6, 4.6, a) * (1 - smooth(8.5, 13.5, a));
  // the spur falls away to both sides
  y -= Math.max(a - 9.5, 0) ** 2 * 0.034;
  // the cliff past the crest (curling back at the sides so the crest is a promontory)
  const c = ramp(EDGE_Z - z + x * x * 0.016, 0.35);
  y -= c * c * 0.085 + c * 0.8;
  // natural undulation away from the path and the dais
  y += (fbm(x * 0.11 + 5.2, z * 0.11 - 1.7) - 0.5) * 1.3 * smooth(1.8, 6, a) * smooth(2.6, 6, r0);
  return y;
}

function basinY(x: number, z: number): number {
  const dC = Math.hypot(x - TOWN_CENTRE.x * 0.3, z + 150);
  let b = BASIN_Y + (fbm(x * 0.025, z * 0.025) - 0.5) * 1.6;
  const m = smooth(122, 270, dC);
  // a low gap in the ring of mountains under the moon, so it hangs over open water and far hills
  const az = Math.atan2(x, -z) - MOON_AZ;
  const gap = z < 0 ? Math.exp(-(az * az) / (0.3 * 0.3)) : 0;
  b += m * Math.sqrt(m) * (22 + 44 * fbm(x * 0.0105 + 3.1, z * 0.0105 - 7.4, 5)) * (1 - 0.78 * gap);
  const e = lakeE(x, z);
  b = b + (WATER_Y - 3.4 - b) * smooth(1.0, 0.86, e);
  return b;
}

export function heightAt(x: number, z: number): number {
  return smax(hillY(x, z), basinY(x, z), 3);
}

/** Terrain normal (y component) by finite differences: 1 is flat. */
export function slopeAt(x: number, z: number): THREE.Vector3 {
  const e = 0.25;
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  return new THREE.Vector3(-hx, 2 * e, -hz).normalize();
}

/** Gates along the path (z of each arch) and the lanterns between and beyond them. */
export const GATE_Z = [36.5, 33, 29.5, 26, 22.5, 19];
export const PAIR_Z = [34.75, 31.25, 27.75, 24.25, 20.75, 15.2, 10.6, 6.4];
export const LANTERN_SIDE = 1.62;
export const DAIS_LANTERNS: Array<[number, number]> = [[-2.55, 0.55], [2.55, 0.55]];
export const TREE_POS: [number, number] = [4.5, -1.7];
