// The terrain VERTEX shader, moved out of TerrainShader.ts at RN-148 purely
// for the 400-line cap (the relief term put that file 19 lines over), on
// RN-78's CASCADE_GLSL precedent: the GLSL is unchanged to the character
// except the two RN-148 lines (uBiomeRelief / vRelW), and TerrainShader.ts
// re-exports this function so its published import site holds.

import type { DepthPolicy } from '../DepthPolicy.js';
import { BIOME_COUNT } from './BiomePalette.js';

export function terrainVertexShader(depth: DepthPolicy): string {
  return /* glsl */`
    #include <common>
    ${depth.vertexPars}
    // BatchedMesh (DW-11): three declares the matrix textures and the multi-draw
    // index lookup here, and sets USE_BATCHING itself from object.isBatchedMesh.
    // A ShaderMaterial does its own vertex transform, so applying batchingMatrix
    // is OUR job; the stock <project_vertex> path is not in play.
    #include <batching_pars_vertex>
    #include <shadowmap_pars_vertex>
    attribute vec4 aBiome;
    attribute float aHeight;
    attribute float aFadeT0;
    uniform vec3 uBiomeColor[${BIOME_COUNT}];
    uniform vec4 uBiomeMat[${BIOME_COUNT}];
    uniform vec4 uBiomeRelief[${BIOME_COUNT}];
    uniform float uTime;
    uniform float uFadeDur;
    varying vec3 vBiomeColor;
    varying vec4 vMatW;
    varying vec4 vRelW;
    varying vec3 vNormalW;
    varying vec3 vWorld;
    varying float vRelief;
    varying float vFade;
    varying float vViewZ;
    varying vec2 vChunkUv;

    void main() {
      #include <batching_vertex>
      // The per-chunk placement now lives in the batch's matrix texture rather
      // than in an object matrix, so the model matrix is the product of the two.
      // Both are translation plus uniform scale, so the upper 3x3 still
      // preserves direction after a normalize.
      mat4 ofModel = modelMatrix;
      mat3 ofNormalRot = mat3(modelMatrix);
      #ifdef USE_BATCHING
        ofModel = modelMatrix * batchingMatrix;
        ofNormalRot = mat3(ofModel);
      #endif
      // aBiome.x is the /core Biome enum as an unnormalized uint8.
      int bi = int(aBiome.x + 0.5);
      vBiomeColor = uBiomeColor[bi];
      // RN-78: texture weights, interpolated across biome edges as vBiomeColor is.
      vMatW = uBiomeMat[bi];
      // RN-148: relief weights ride the same interpolation, same argument.
      vRelW = uBiomeRelief[bi];
      vNormalW = normalize(ofNormalRot * normal);
      vec4 worldPosition = ofModel * vec4(position, 1.0);
      vWorld = worldPosition.xyz;
      vRelief = aHeight;
      // The chunk-LOCAL surface coordinate, normalized over the quad, uploaded
      // as uint16 by /core since W2 and read by this shader ZERO times until
      // RN-50 (WG-56 found it). It is the well-conditioned coordinate pM is
      // not: one uint16 step is 0.883 mm on a depth-14 chunk, which is a
      // quarter of a ground pixel at 2 m, against pM's quantum of nearly nine
      // pixels there. No new attribute, no upload, no CPU work.
      vChunkUv = uv;
      // The SIGN of aFadeT0 selects the half of the dissolve: positive is the
      // incoming chunk fading in, negative is the outgoing one fading out. One
      // attribute, written once, carries both.
      //
      // The outgoing ramp is offset to [-2,-1] rather than negated into [-1,0]
      // because a negated zero is -0.0, and in GLSL -0.0 >= 0.0 is TRUE. That
      // put the outgoing chunk on the INCOMING branch for exactly the first
      // frame of every dissolve, both halves discarded everything, and the
      // bright far-scene terrain showed through the ground for one frame.
      // Measured as a 191-unit tile impulse on a driven walk.
      float fadeT = uFadeDur <= 0.0 ? 1.0
        : clamp((uTime - abs(aFadeT0)) / uFadeDur, 0.0, 1.0);
      vFade = aFadeT0 < 0.0 ? -1.0 - fadeT : fadeT;
      vec4 mv = viewMatrix * worldPosition;
      vViewZ = -mv.z;
      // Only <shadowmap_vertex>'s normal-bias offset reads this, and the bias is
      // in world units, so the batch rotation has to be in it or a chunk's
      // contact shadow detaches from its caster.
      vec3 transformedNormal = normalize(normalMatrix * normal);
      #include <shadowmap_vertex>
      gl_Position = projectionMatrix * mv;
      ${depth.vertexBody}
    }
  `;
}
