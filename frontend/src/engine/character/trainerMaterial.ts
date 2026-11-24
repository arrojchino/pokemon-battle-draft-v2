// Per-instance materials for plaza trainers. All of them share the atlas, the tint mask and one compiled
// program per kind; only uniforms differ. Two small injections into three-vrm's MToon shader:
//  * tint: texels under the mask are recoloured to the trainer's outfit / accent / hair / legwear colours,
//    keeping the painted shading (luminance ratio against the region's mean), and the shade colour follows;
//  * pooled skinning: bone matrices are read at `boneOffset` in the shared bone pool texture;
// plus an ordered-dither fade (no blending, so no sorting trouble) and an alpha cut-out done in the shader, so
// the shadow pass uses our own depth material (with the same pooled skinning) instead of an internal clone.
import * as THREE from 'three';
import { MToonMaterial } from '@pixiv/three-vrm';
import type { TrainerAsset } from './trainerAsset.js';

export interface TrainerUniforms {
  tintOutfit: { value: THREE.Color };
  tintAccent: { value: THREE.Color };
  tintHair: { value: THREE.Color };
  tintLegs: { value: THREE.Color };
  tintRef: { value: THREE.Vector4 };
  tintMask: { value: THREE.Texture };
  uFade: { value: number };
  boneOffset: { value: number };
}

export function trainerUniforms(asset: TrainerAsset): TrainerUniforms {
  return {
    tintOutfit: { value: new THREE.Color(1, 1, 1) },
    tintAccent: { value: new THREE.Color(1, 0, 0) },
    tintHair: { value: new THREE.Color(0.3, 0.2, 0.1) },
    tintLegs: { value: new THREE.Color(0.05, 0.05, 0.06) },
    tintRef: { value: asset.ref },
    tintMask: { value: asset.mask },
    uFade: { value: 1 },
    boneOffset: { value: 0 },
  };
}

const SKIN = THREE.ShaderChunk.skinning_pars_vertex.replace('int j = int( i ) * 4;', 'int j = int( i + boneOffset ) * 4;');
const SKIN_PARS = `#ifdef USE_SKINNING\nuniform float boneOffset;\n#endif\n${SKIN}`;
if (SKIN === THREE.ShaderChunk.skinning_pars_vertex) console.warn('Trainer: skinning chunk changed, pooled bones will not work');

const DITHER = /* glsl */`
  if ( uFade < 0.999 ) {
    vec2 a = floor( gl_FragCoord.xy );
    vec2 h = floor( a * 0.5 );
    float b2a = fract( dot( a, vec2( 0.5, a.y * 0.75 ) ) );
    float b2h = fract( dot( h, vec2( 0.5, h.y * 0.75 ) ) );
    float d = b2h * 0.25 + b2a + 1.0 / 32.0;   // 4x4 Bayer threshold in (0, 1)
    if ( d > uFade ) discard;
  }`;

const TINT_PARS = /* glsl */`
uniform sampler2D tintMask;
uniform vec3 tintOutfit, tintAccent, tintHair, tintLegs;
uniform vec4 tintRef;
uniform float uFade, uCutoff;
vec3 trainerTint( vec3 c, vec2 uv ) {
  vec4 m = texture2D( tintMask, uv );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec4 k = clamp( vec4( l ) / max( tintRef, vec4( 1e-3 ) ), 0.0, 1.45 );
  vec3 o = c;
  o = mix( o, tintOutfit * pow( k.x, 0.8 ), m.r );
  o = mix( o, tintAccent * pow( k.y, 0.5 ), m.g );
  o = mix( o, tintHair * pow( k.z, 1.1 ), m.b );
  o = mix( o, tintLegs * pow( k.w, 0.6 ), m.a );
  return o;
}
`;

export type TrainerMatKind = 'body' | 'outline' | 'face' | 'faceAlpha';

function inject(mat: MToonMaterial, u: TrainerUniforms, cutoff: number, tag: string) {
  const uni = mat.uniforms as Record<string, THREE.IUniform>;
  Object.assign(uni, u, { uCutoff: { value: cutoff } });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    const rep = (src: string, a: string, b: string) => { if (!src.includes(a)) console.warn(`Trainer: MToon shader is missing "${a}"`); return src.replace(a, b); };
    shader.vertexShader = rep(shader.vertexShader, '#include <skinning_pars_vertex>', SKIN_PARS);
    let fs = shader.fragmentShader;
    fs = rep(fs, '#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${TINT_PARS}`);
    fs = rep(fs, 'diffuseColor *= sampledDiffuseColor;', 'diffuseColor *= sampledDiffuseColor;\n    diffuseColor.rgb = trainerTint( diffuseColor.rgb, mapUv );\n    if ( diffuseColor.a < uCutoff ) discard;');
    fs = rep(fs, 'material.shadeColor = shadeColorFactor;', 'material.shadeColor = shadeColorFactor * diffuseColor.rgb;');
    fs = rep(fs, '#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${DITHER}`);
    shader.fragmentShader = fs;
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|trainer:${tag}`;
}

export function trainerMaterial(asset: TrainerAsset, u: TrainerUniforms, kind: TrainerMatKind): MToonMaterial {
  const face = kind === 'face' || kind === 'faceAlpha';
  const mat = new MToonMaterial({
    map: asset.atlas,
    color: new THREE.Color(1, 1, 1),
    shadeColorFactor: face ? new THREE.Color(0.86, 0.8, 0.88) : new THREE.Color(0.74, 0.7, 0.86),
    shadingToonyFactor: 0.82,
    shadingShiftFactor: face ? 0.12 : -0.08,
    giEqualizationFactor: 0.85,
    parametricRimColorFactor: face ? new THREE.Color(0.12, 0.14, 0.22) : new THREE.Color(0.3, 0.36, 0.58),
    parametricRimFresnelPowerFactor: 4.2,
    parametricRimLiftFactor: 0.04,
    rimLightingMixFactor: 0.6,
    side: kind === 'outline' ? THREE.BackSide : face ? THREE.FrontSide : THREE.DoubleSide,
    transparent: kind === 'faceAlpha',
    depthWrite: kind !== 'faceAlpha',
  });
  if (kind === 'outline') {
    mat.isOutline = true;
    mat.outlineWidthMode = 'worldCoordinates';
    mat.outlineWidthFactor = 0.0019;
    mat.outlineColorFactor = new THREE.Color(0.09, 0.08, 0.15);
    mat.outlineLightingMixFactor = 0.55;
  }
  mat.name = `Trainer_${kind}`;
  inject(mat, u, kind === 'faceAlpha' ? 0.0 : 0.5, kind);
  return mat;
}

/** Shadow caster material: pooled skinning, atlas alpha cut-out. */
export function trainerDepthMaterial(asset: TrainerAsset, u: TrainerUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: asset.atlas, alphaTest: 0.5, side: THREE.DoubleSide });
  mat.name = 'Trainer_depth';
  mat.onBeforeCompile = shader => {
    shader.uniforms.boneOffset = u.boneOffset;
    shader.vertexShader = shader.vertexShader.replace('#include <skinning_pars_vertex>', SKIN_PARS);
  };
  mat.customProgramCacheKey = () => 'trainer:depth';
  return mat;
}
