// THE FAR-FIELD COVER CONVERGENCE: GLSL half. See TerrainCoverFar.ts for the
// constants, the live-import of GrassPalette's own table, and the cross-check
// that proves this file's baked rotation agrees with `coverAlbedo`.
//
// RN-2195, fidelity lane A3 phase 1.5.

import { FAR_GREEN, FAR_ROT_R, FAR_ROT_G, FAR_ROT_B, COVER_VALUE }
  from './TerrainCoverFar.js';

const f = (n: number): string => n.toFixed(5);

/** GENERATED from TerrainCoverFar.ts's constants rather than typed here, the
 *  same discipline TERRAIN_SPLAT_PARS uses for the splat's own hue table: the
 *  numbers the shader multiplies by are literally the ones
 *  `assertFarCoverMatchesGrass` proved agree with GrassPalette.coverAlbedo. */
export const TERRAIN_COVER_FAR_PARS =
  `#define OF_COVER_ROT vec3(${f(FAR_ROT_R)}, ${f(FAR_ROT_G)}, ${f(FAR_ROT_B)})\n`
  + `#define OF_COVER_GREEN ${f(FAR_GREEN)}\n`
  + `#define OF_COVER_VALUE ${f(COVER_VALUE)}\n`;

export const TERRAIN_COVER_FAR = /* glsl */`
  // THE ROTATION, closed-form, mirroring GrassPalette.coverAlbedo's own body:
  // r *= 1 - 0.45k, g *= 1 + 0.30k, b *= 1 - 0.15k, then renormalised so
  // Rec.709 luminance is exactly what it was. Chroma-only by the same
  // arithmetic clause C3 relies on (TerrainSplat.ts): the renormalisation
  // divides by the ROTATED luminance and multiplies by the SOURCE luminance,
  // so the result's luminance is the source's, scaled only by OF_COVER_VALUE
  // (1 at the shipped default, GrassTuning.COVER_VALUE's own identity).
  vec3 ofFarCoverRotate(vec3 c, float k) {
    float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 rot = c * (vec3(1.0) + k * OF_COVER_ROT);
    float l1 = dot(rot, vec3(0.2126, 0.7152, 0.0722));
    float s = (l1 > 1.0e-6 ? l0 / l1 : 1.0) * OF_COVER_VALUE;
    return rot * s;
  }
`;
