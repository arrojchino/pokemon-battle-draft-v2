import * as THREE from 'three';

/**
 * Transform (Ditto's move and its Imposter ability) on the battle stage. The transforming Pokemon melts into a
 * purple blob, the blob reshapes to the target's height, and the target's model grows out of it. While transformed,
 * a faint purple rim shimmers on the body and a soft purple halo sits at its feet, so it still reads as Ditto.
 *
 * Self-contained: the stage hands over the side's hologram (`MorphHost`) and a `swap` callback that puts the target
 * species on that hologram. Everything here is pooled per side and made once (two blobs, two halos, two rim
 * materials); rim overlays share the body's geometry and skeleton, so nothing is downloaded or duplicated.
 */
export interface MorphHost {
  /** The side's group: its position is the Pokemon's position on the stage; its scale is ours to squash. */
  readonly group: THREE.Group;
  /** Body height in stage units (predicted until the model has loaded). */
  readonly height: number;
  readonly present: boolean;
  /** A brief colour flash on the body or projection. */
  pulse(color: string, amount?: number): void;
}

export const DITTO_PURPLE = '#b48cff';
const FLOOR_Y = 0.205;
/** Phase ends, in seconds: melt, reshape, reveal. */
const MELT = 0.55, SHAPE = 1.15, END = 1.7;
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const backOut = (x: number) => { const t = Math.min(1, Math.max(0, x)) - 1, c = 1.9; return 1 + (c + 1) * t * t * t + c * t * t; };

const NOISE = /* glsl */`
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

/** The goo: a noise-displaced sphere with a glossy purple shade, a bright fresnel edge and a dissolving fade. */
function blobMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uWobble: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(DITTO_PURPLE) } },
    vertexShader: /* glsl */`uniform float uTime, uWobble; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      ${NOISE}
      void main() {
        vec3 p = position;
        float n = vnoise(p * 2.2 + vec3(0.0, uTime * 1.7, uTime * 0.6)) - 0.5;
        float drip = max(0.0, -p.y) * 0.25 * sin(p.x * 7.0 + uTime * 3.0);
        p += normal * (n * 0.55 + drip) * uWobble;
        vP = position;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`uniform float uTime, uAlpha; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      ${NOISE}
      void main() {
        vec3 n = vN / max(length(vN), 1e-5);
        float fr = pow(clamp(1.0 - dot(n, vV), 0.0, 1.0), 2.2);
        vec3 L = normalize(vec3(0.3, 0.9, 0.5));
        float d = 0.45 + 0.55 * max(dot(n, L), 0.0);
        float spec = pow(max(dot(reflect(-L, n), vV), 0.0), 24.0);
        vec3 col = uColor * d * 0.9 + uColor * fr * 1.6 + vec3(spec * 0.8);
        // Fade out as an eroding dissolve rather than a flat crossfade.
        float e = vnoise(vP * 5.0 + uTime * 0.4);
        float a = uAlpha * smoothstep(1.0 - uAlpha - 0.05, 1.0 - uAlpha + 0.25, e) * (0.82 + 0.18 * fr);
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

/** A flat ring at the feet: a ripple during the morph, then a faint slow halo while transformed. */
function haloMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uColor: { value: new THREE.Color(DITTO_PURPLE) } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime, uAmt; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        vec2 q = vUv * 2.0 - 1.0; float r = length(q), a = atan(q.y, q.x);
        float band = smoothstep(0.55, 0.8, r) * smoothstep(1.0, 0.82, r);
        float dash = 0.6 + 0.4 * sin(a * 9.0 - uTime * 1.4);
        gl_FragColor = vec4(uColor * band * dash * uAmt, 1.0);
      }`,
  });
}

/**
 * Purple fresnel rim drawn over the body: the same geometry (and skeleton when skinned) with an additive shader,
 * pulled toward the camera by a polygon offset so it never fights the body's own depth.
 */
function rimMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uColor: { value: new THREE.Color(DITTO_PURPLE) } },
    vertexShader: /* glsl */`#include <common>
      #include <skinning_pars_vertex>
      varying float vRim; varying float vH;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vRim = 1.0 - abs(dot(transformedNormal / max(length(transformedNormal), 1e-5), normalize(-mv.xyz)));
        vH = (modelMatrix * vec4(transformed, 1.0)).y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`uniform float uTime, uAmt; uniform vec3 uColor; varying float vRim; varying float vH;
      void main() {
        // Clamped: pow of a tiny negative is NaN, and one NaN pixel spreads through the bloom to the whole screen.
        float rim = pow(clamp(vRim, 0.0, 1.0), 2.4);
        float shimmer = 0.55 + 0.45 * sin(vH * 14.0 - uTime * 2.6);
        gl_FragColor = vec4(uColor * rim * shimmer * uAmt, 1.0);
      }`,
  });
}

type Side = {
  host: MorphHost | null;
  /** Morph clock (seconds); >= END when no morph is running. */
  t: number;
  speed: number;
  swap: (() => void) | null;
  /** Height before (Ditto) and after (target) the swap. */
  h0: number;
  transformed: boolean;
  tell: number;
  blob: THREE.Mesh<THREE.IcosahedronGeometry, THREE.ShaderMaterial>;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  rim: THREE.ShaderMaterial;
  /** The body root the overlays were built for, and the overlays. */
  root: THREE.Object3D | null;
  overlays: THREE.Mesh[];
};

export class TransformFx {
  readonly group = new THREE.Group();
  private sides: [Side, Side];
  private time = 0;

  constructor(parent: THREE.Object3D, private reduced: () => boolean) {
    const geo = new THREE.IcosahedronGeometry(1, 5);
    const ring = new THREE.RingGeometry(0.2, 1, 64, 1);
    const make = (): Side => {
      const blob = new THREE.Mesh(geo, blobMaterial());
      blob.visible = false; blob.renderOrder = 7;
      const halo = new THREE.Mesh(ring, haloMaterial());
      halo.rotation.x = -Math.PI / 2; halo.visible = false; halo.renderOrder = 4;
      this.group.add(blob, halo);
      return { host: null, t: END, speed: 1, swap: null, h0: 0.5, transformed: false, tell: 0, blob, halo, rim: rimMaterial(), root: null, overlays: [] };
    };
    this.sides = [make(), make()];
    // Hidden stand-ins in both rim variants (rigid and skinned), so the stage's prewarm compiles the rim shaders.
    const dummy = new THREE.BufferGeometry();
    dummy.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.001, 0, 0, 0, 0.001, 0], 3));
    dummy.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    dummy.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
    dummy.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const rigid = new THREE.Mesh(dummy, this.sides[0].rim);
    const bone = new THREE.Bone();
    const skinned = new THREE.SkinnedMesh(dummy, this.sides[0].rim);
    skinned.add(bone); skinned.bind(new THREE.Skeleton([bone]));
    for (const d of [rigid, skinned]) { d.visible = false; d.frustumCulled = false; this.group.add(d); }
    parent.add(this.group);
  }

  /** True while `side` shows a transformed Pokemon (or is morphing into one). */
  isTransformed(side: 0 | 1) { return this.sides[side].transformed; }
  /** True while the morph animation runs on `side`. */
  isMorphing(side: 0 | 1) { return this.sides[side].t < END; }

  /**
   * Morph `host` into the target: `swap` puts the target species on the host and is called once, at the moment the
   * blob hides the body (at once when `instant`, for a reconnect or a replayed log).
   */
  start(side: 0 | 1, host: MorphHost, swap: () => void, instant: boolean) {
    const s = this.sides[side];
    this.finish(s);
    s.host = host; s.transformed = true;
    if (instant || !host.present) { swap(); s.tell = 1; s.t = END; return; }
    s.swap = swap; s.h0 = host.height; s.t = 0;
    s.speed = this.reduced() ? 2 : 1;
    host.pulse(DITTO_PURPLE, 0.8);
  }

  /** Back to normal: the morph stops, the body regains its scale, the rim and halo go. */
  revert(side: 0 | 1) {
    const s = this.sides[side];
    // A morph cut short before its swap leaves the original species on the host, which is what a revert wants.
    s.swap = null;
    this.finish(s);
    s.transformed = false; s.tell = 0;
    this.dropOverlays(s);
    s.halo.visible = false;
  }

  /** Drop every side at once (the stage is cleared). */
  clear() { this.revert(0); this.revert(1); }

  /** End a running morph at once: run a pending swap and put the body back at full scale. */
  private finish(s: Side) {
    if (s.t < END) { const sw = s.swap; s.swap = null; sw?.(); }
    s.t = END;
    s.blob.visible = false; s.blob.material.uniforms.uAlpha.value = 0;
    if (s.host) s.host.group.scale.set(1, 1, 1);
  }

  private dropOverlays(s: Side) {
    for (const o of s.overlays) o.removeFromParent();
    s.overlays.length = 0; s.root = null;
  }

  /** The body's root inside the host group: its one child that is neither a mesh nor a line. */
  private bodyRoot(host: MorphHost): THREE.Object3D | null {
    const c = host.group.children;
    for (let i = 0; i < c.length; i++) { const o = c[i] as THREE.Mesh & THREE.Line; if (!o.isMesh && !o.isLine) return o; }
    return null;
  }

  private buildOverlays(s: Side, root: THREE.Object3D) {
    this.dropOverlays(s);
    s.root = root;
    const found: THREE.Mesh[] = [];
    root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.dittoRim) found.push(m); });
    for (const m of found) {
      let o: THREE.Mesh;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = m as THREE.SkinnedMesh, k = new THREE.SkinnedMesh(sm.geometry, s.rim);
        k.bindMode = sm.bindMode; k.bind(sm.skeleton, sm.bindMatrix);
        o = k;
      } else o = new THREE.Mesh(m.geometry, s.rim);
      o.userData.dittoRim = true; o.frustumCulled = false; o.renderOrder = 3; o.raycast = () => {};
      // A child with no offset of its own follows the body's pose exactly.
      m.add(o);
      s.overlays.push(o);
    }
  }

  update(dt: number) {
    this.time += dt;
    for (const s of this.sides) {
      const host = s.host;
      s.rim.uniforms.uTime.value = this.time;
      s.halo.material.uniforms.uTime.value = this.time;
      if (!host) continue;
      const P = host.group.position;
      let ripple = 0;
      if (s.t < END) {
        s.t = Math.min(END, s.t + dt * s.speed);
        const t = s.t, calm = this.reduced();
        const b = s.blob, u = b.material.uniforms;
        u.uTime.value = this.time;
        b.visible = true;
        if (t < MELT) {
          // Melt: the body sinks and spreads while the goo wells up around it.
          const k = smooth(t / MELT), r = Math.max(0.28, s.h0 * 0.5);
          host.group.scale.set(1 + 0.35 * k, Math.max(0.12, 1 - 0.88 * k), 1 + 0.35 * k);
          u.uAlpha.value = smooth(t / (MELT * 0.6));
          u.uWobble.value = calm ? 0.15 : 0.25 + 0.35 * k;
          const sx = r * (0.45 + 0.75 * k), sy = r * (0.45 + 0.35 * k);
          b.scale.set(sx, sy, sx);
          b.position.set(P.x, FLOOR_Y + sy * 0.8, P.z);
          ripple = k;
        } else {
          if (s.swap) { const sw = s.swap; s.swap = null; sw(); host.group.scale.set(0.12, 0.12, 0.12); }
          const h1 = Math.max(0.3, host.height), r1 = Math.max(0.24, h1 * 0.36), r0 = Math.max(0.28, s.h0 * 0.5);
          if (t < SHAPE) {
            // Reshape: the puddle rises into a column the size of the target, wobbling as it settles.
            const v = (t - MELT) / (SHAPE - MELT), k = smooth(v);
            const bounce = calm ? 0 : Math.sin(v * Math.PI * 3) * (1 - v) * 0.18;
            const sx = THREE.MathUtils.lerp(r0 * 1.2, r1, k) * (1 - bounce * 0.5), sy = THREE.MathUtils.lerp(r0 * 0.8, h1 * 0.52, k) * (1 + bounce);
            b.scale.set(sx, sy, sx);
            b.position.set(P.x, FLOOR_Y + sy * 0.95, P.z);
            u.uWobble.value = calm ? 0.12 : 0.6 * (1 - k) + 0.15;
            u.uAlpha.value = 1;
          } else {
            // Reveal: the target grows out (with a little overshoot) as the goo dissolves away.
            const w = (t - SHAPE) / (END - SHAPE);
            const g = calm ? smooth(w) : backOut(w);
            host.group.scale.setScalar(Math.max(0.12, 0.12 + 0.88 * g));
            const sx = r1 * (1 + 0.12 * w), sy = h1 * 0.52 * (1 + 0.06 * w);
            b.scale.set(sx, sy, sx);
            b.position.set(P.x, FLOOR_Y + sy * 0.95, P.z);
            u.uWobble.value = 0.15 * (1 - w);
            u.uAlpha.value = 1 - smooth(w);
            ripple = 1 - w;
            s.tell = Math.max(s.tell, w);
          }
        }
        if (s.t >= END) { b.visible = false; host.group.scale.set(1, 1, 1); s.tell = 1; }
      }
      // The tell: rim overlays on the target's body (built once its model is in), and the halo at its feet.
      if (s.transformed && host.present) {
        const root = this.bodyRoot(host);
        if (root !== s.root) { if (root) this.buildOverlays(s, root); else this.dropOverlays(s); }
        s.rim.uniforms.uAmt.value = 1.1 * s.tell;
        const fp = Math.max(0.35, host.height * 0.55);
        s.halo.visible = true;
        s.halo.position.set(P.x, FLOOR_Y + 0.012, P.z);
        s.halo.scale.setScalar(fp * (1 + 0.25 * ripple));
        s.halo.material.uniforms.uAmt.value = 0.22 * s.tell + 0.9 * ripple;
      } else {
        if (s.overlays.length && !s.transformed) this.dropOverlays(s);
        s.halo.visible = s.t < END && ripple > 0;
        if (s.halo.visible) { s.halo.position.set(P.x, FLOOR_Y + 0.012, P.z); s.halo.material.uniforms.uAmt.value = 0.9 * ripple; }
      }
      if (!s.transformed && s.t >= END) s.host = null;
    }
  }

  dispose() {
    for (const s of this.sides) { this.dropOverlays(s); s.blob.material.dispose(); s.halo.material.dispose(); s.rim.dispose(); }
    this.sides[0].blob.geometry.dispose(); this.sides[0].halo.geometry.dispose();
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.getAttribute('skinIndex')) m.geometry.dispose(); });
    this.group.removeFromParent();
  }
}
