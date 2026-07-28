// THE UNDERWATER VIEW: what a submerged eye sees, computed as two full-screen
// blends off the depth buffer and nothing else.
//
// WHY THIS IS A POST PASS AND NOT A MATERIAL EDIT, which is the whole of the
// design and is settled rather than convenient:
//
// (1) IT REACHES EVERYTHING AT ONCE. Terrain, props, machines, the third-person
//     body and the scatter all go murky together. There is no per-material edit,
//     so there is no material that can be MISSED, which is the failure mode a
//     fog added to TerrainShader would have had on the day the next lane adds a
//     new opaque material and forgets.
// (2) IT SPENDS NONE OF DW-10's FIVE SCENE CUSTOM-SHADER SLOTS. Admin approved
//     spending one on water; building it here means it was not spent. RN-10
//     established why post programs do not count: they have no projection, no
//     depth test and no gl_FragDepth, so the depth policy cannot infect them
//     (Quad.ts's header states the same rule from the other side). The scene
//     ledger is unchanged at 3 ShaderMaterial plus 3 onBeforeCompile.
// (3) THE PHYSICS WANTS A PER-PIXEL DISTANCE TO GEOMETRY, which the depth
//     attachment already holds. A scene material would have to recompute it.
//
// THE MATHS MIRRORS ofAtmoAerial RATHER THAN INVENTING A SECOND MODEL. That
// function ends on `col * tr + haze * (1 - tr)`, and so does this: a
// transmittance along the path, and an equilibrium radiance the path fills in
// with. The only structural differences are that both quantities here are
// PER CHANNEL, and that the path is bounded by a plane rather than by a density
// profile.
//
// THE ONE PHYSICAL FACT THAT MAKES WATER READ AS WATER is that sigma is per
// channel with RED absorbed hardest. RN-30 recorded the same lesson pointing the
// other way for AIR: a blue-biased coefficient in air darkens rather than hazes,
// so the aerosol tint there is deliberately grey. In water the strong red
// absorption is not a stylisation, it is the dominant term, and it is the entire
// look. Coefficients are in PostConfig with their provenance.
//
// THE SURFACE IS A PLANE, and that is a measurement rather than an assumption.
// The pond is 22 m across on a 600 km body, so the sagitta of the spherical
// water surface across the whole pond is r^2 / 2R = 11^2 / 1.2e6 = 0.1 mm. A
// ray-sphere intersection would cost more and move nothing at four decimal
// places, so the plane sits `uHeadUnderM` above the eye along the local up and
// the curvature is spent here in this comment instead.
//
// WHY THREE DRAWS, AND THE TWO-DRAW VERSION THAT WAS BUILT FIRST AND MEASURED
// WRONG. The result is `dst * tr + tint * (1 - tr)` with tr per channel, and no
// fixed-function blend expresses a per-CHANNEL multiply and an add in one pass
// (SrcAlphaFactor is scalar; dual-source blending is not reachable through
// three). So it wants two blends, and the first attempt computed `tr` from the
// depth buffer INSIDE each of them, which needs no render target at all and
// looked like a free win.
//
// It is illegal, and the driver said so: 256 x `GL_INVALID_OPERATION:
// glDrawArrays: Feedback loop formed between Framebuffer and active Texture`,
// every draw silently discarded, `ran` true, two extra draw calls counted, and a
// measured pixel difference of EXACTLY ZERO on a term that was reported as
// running. RN-11's rule is not about colour, it is about ATTACHMENTS: the depth
// texture IS an attachment of the scene framebuffer, so a pass that writes scene
// colour may not sample it, whatever depthWrite says. That is precisely why AO
// applies from `aoFull` and the contact shadows apply from `contact`.
//
// So this follows the same shape as both of them: MARCH into a scratch buffer
// (reads depth, writes elsewhere), then two blends that read only the scratch.
// The scratch holds the per-channel transmittance directly rather than the path
// length, because 8 bits of a transmittance is worth at most one count of colour
// through a multiply, whereas 8 bits of a 60 m path is 0.24 m per step and about
// twenty counts of banding in red near the surface.

import { DEPTH_GLSL } from './DepthGlsl.js';

/**
 * THE MARCH, which is not a march: one depth tap, one unprojection and one
 * closed-form path length. Writes `exp(-sigma * path)` per channel.
 */
export const UNDERWATER_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
/** Local up (away from the planet centre) in VIEW space, unit length. */
uniform vec3 uUpView;
/** Metres the EYE is below the water surface. The pass is SKIPPED when <= 0. */
uniform float uHeadUnderM;
/** Extinction per metre, per channel. Red hardest. See PostConfig. */
uniform vec3 uSigma;
/** Hard cap on the path in metres, so a background pixel is a number. */
uniform float uMaxPathM;

${DEPTH_GLSL}

// The NEAR plane's NDC z, which is the one z that is never the projective point
// at infinity and therefore the one that always unprojects to a finite ray.
// Reversed-Z is ZERO_TO_ONE with near = 1; plain and log are both [-1, 1] with
// near = -1, which is exactly the z DepthGlsl's log branch already builds its
// ray from.
#if defined(OF_DEPTH_REVERSED)
  #define OF_NEAR_NDC 1.0
#else
  #define OF_NEAR_NDC -1.0
#endif

/** The view ray through this pixel, unit length, pointing away from the eye. */
vec3 viewRay(vec2 uv) {
  vec4 r = uProjInv * vec4(uv * 2.0 - 1.0, OF_NEAR_NDC, 1.0);
  return normalize(r.xyz / r.w);
}

void main() {
  float d = textureLod(tDepth, vUv, 0.0).x;
  vec3 rd = viewRay(vUv);

  // Distance to geometry, UNPROJECTED rather than linearised by hand. DepthGlsl
  // inverts whatever DepthPolicy built, which is what makes reversed-Z and the
  // log branch both correct here without this file knowing which one ran.
  //
  // A background pixel is one the near pass wrote no depth to, which per RN-10
  // is the sky and (because depth is cleared between passes) the far scaled
  // scene as well. Infinity is the honest distance for it: looking UP the ray
  // then terminates at the surface, and looking down or level it saturates,
  // which is exactly right. You cannot see out of a pond sideways.
  float toGeomM = isBackground(d) ? 1.0e9 : length(viewFromDepth(vUv, d));

  // Where the ray leaves the water. The plane is uHeadUnderM above the eye
  // along uUpView, so a ray with an upward component exits at
  // uHeadUnderM / cos, and a ray pointing down or along the surface never does.
  float up = dot(rd, uUpView);
  float tExitM = up > 1.0e-4 ? uHeadUnderM / up : 1.0e9;

  float pathM = clamp(min(toGeomM, tExitM), 0.0, uMaxPathM);
  gl_FragColor = vec4(exp(-uSigma * pathM), 1.0);
}
`;

/**
 * THE TWO BLENDS. `OF_UW_INSCATTER` selects the additive half, on the
 * BLOOM_DOWN_FS precedent, so there is one file and one uniform block and the
 * two halves cannot come to disagree about the transmittance they share.
 *
 * `uScatterFrac` pulls the in-scatter rate away from the extinction rate. It is
 * an EXPONENT here rather than a second sigma, and that is exact rather than an
 * approximation: exp(-sigma * f * path) is exp(-sigma * path) to the power f, so
 * the scratch buffer serves both terms and there is no second path length to
 * keep in step. At the default f = 1 this is the radiative-transfer equilibrium
 * form `col * tr + tint * (1 - tr)`, which is the line `ofAtmoAerial` ends on.
 */
export const UNDERWATER_APPLY_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
/** Per-channel transmittance, written by the pass above. */
uniform sampler2D tWater;
uniform vec3 uTint;
uniform float uScatterFrac;

void main() {
  vec3 tr = textureLod(tWater, vUv, 0.0).rgb;
  #if defined(OF_UW_INSCATTER)
    // Alpha 0 so the additive blend leaves the scene target's alpha alone; the
    // multiply half is protected the same way by Quad.ts's separate alpha
    // factors. Alpha is not a quantity anything downstream reads, and moving it
    // would show up as transparency in a toBlob() capture.
    vec3 trS = pow(max(tr, vec3(1e-6)), vec3(uScatterFrac));
    gl_FragColor = vec4(uTint * (1.0 - trS), 0.0);
  #else
    gl_FragColor = vec4(tr, 1.0);
  #endif
}
`;
