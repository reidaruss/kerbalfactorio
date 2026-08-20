// SCREEN-SPACE CONTACT SHADOWS: the short, sharp shadow a blade of grass casts
// on the ground it is standing in, computed by marching the depth buffer toward
// the sun. Two full-screen passes, no scene geometry touched, no shadow map.
//
// WHY THIS EXISTS AT ALL, and it is a direct consequence of RN-15. Taking the
// understorey out of the shadow pass removed 1,003,112 triangles and 12.3 ms of
// an 18.0 ms frame, and it removed every grass shadow in the picture with them.
// The trade was right (a card was being drawn four times, once in the near pass
// and once in each of three cascades, to cast a few pixels of shadow under a
// tuft that was already casting one) but the ground went flat, and flat lighting
// is the largest remaining gap against the reference.
//
// WHY NOT JUST PUT THE UNDERSTOREY IN CASCADE 0. Because three.js cannot express
// it, and that was checked in three's own source rather than assumed.
// `WebGLShadowMap.renderObject` filters casters with
// `object.layers.test( camera.layers )` at r185 line 511, where `camera` is the
// VIEW camera handed to `shadowMap.render( shadowsArray, scene, camera )`, NOT
// the per-light shadow camera. So `light.shadow.camera.layers` is never
// consulted anywhere in the shadow pass and layers cannot select a cascade.
// `Object3D.onBeforeShadow` does fire per object per light, but at lines 535/549,
// i.e. AFTER the `castShadow` test, so it cannot veto a draw either. The only
// remaining lever is `_frustum.intersectsObject`, and the understorey is one
// BatchedMesh whose bound covers the whole ring, so every cascade intersects it.
// A per-cascade caster set needs a fork of three's shadow map, which is a much
// larger bill than two full-screen passes.
//
// (Note in passing, because it is a live defect in this lane's own code:
// `ShadowRig.ts:59-73` carries a comment asserting exactly the layer behaviour
// disproved above, and enables `LAYER_PLAYER_BODY`/`LAYER_PROPS` on cascade 0's
// shadow camera to buy a "cascade 0 only" restriction it does not buy. The props
// and the player reach the shadow map because `CameraRig` enables those layers
// on the NEAR camera. The comment is wrong, the code is harmless, and the 45-to-27
// draw-call measurement recorded next to it was real but had another cause.)
//
// WHAT MAKES IT A CONTACT SHADOW RATHER THAN A SHADOW. The march is bounded to
// `uLengthM` (about half a metre) of world distance. Past that the term fades to
// fully lit, so it can only ever darken the immediate neighbourhood of a
// contact and can never disagree with the cascaded shadow maps about a hill.
// The two divide by RANGE the same way the baked ORM map and the SSAO term
// divide by spatial frequency (PostConfig's note): cascade 0 is a +/-15.8 m box
// at 15.5 mm per texel and cannot resolve a 3-triangle blade against the soil
// under it; this term cannot see anything further away than a hand's breadth.
//
// WHY THE APPLY BLURS AND THE MARCH DOES NOT. A ray march with a dithered start
// is stipple at 1:1, and the project forbids temporal jitter outright (a settled
// frame must equal the previous one: FrameDiff's second difference, wires.js
// requiring five identical draw-call reads). So the dither is a pure function of
// gl_FragCoord with a period of exactly 4 px, and the resolve is SPATIAL, folded
// into the multiply pass as a 5-tap cross rather than bought as a third pass.
//
// WHY EVERY FETCH IS textureLod: the loop has a data-dependent exit, and an
// implicit-derivative fetch inside one is ANGLE's X3595, which the smoke runner
// correctly fails. See AoGlsl's note; this is the same rule, not a new one.

import { DEPTH_GLSL } from './DepthGlsl.js';

export const CONTACT_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform mat4 uProj;
/** Direction TOWARD the sun, in VIEW space, unit length. */
uniform vec3 uSunView;
/** How far the march reaches, in metres of world space. */
uniform float uLengthM;
/** How thick an occluder is assumed to be. Beyond this the hit is ignored. */
uniform float uThickM;
/** Hard cap on the march in UV, so a close-up surface cannot walk the frame. */
uniform float uMaxScreen;
/** Depth-slope bias in metres, to stop a lit surface shadowing itself. */
uniform float uBiasM;
/** RN-2220. 1 / the edge magnitude (metres) at which thin-geometry damping
 *  saturates. AoGlsl's own pattern (RN-2190), reused rather than shared: this
 *  pass has its own march scale and its own tunable, not AoGlsl's retuned. */
uniform float uThinEdgeInv;
/** RN-2220. How far the OCCLUSION is pulled toward 0 (no contact shadow) at
 *  full thin-geometry saturation. 0.0 is the exact pre-RN-2220 expression
 *  (csthin=0's target). */
uniform float uThinAmount;
/** RN-2220. View-space metres: full strength inside uThinNearM, zero beyond
 *  uThinFarM. MEASURED, not assumed, on meadowfield's rangeRects: an UNGATED
 *  damp closes r4's excess (carpet contact share 16.80% against a 12.63% bare
 *  control) but ALSO pulls r10/r25/r55 -- which already ran UNDER their own
 *  bare share before this term touched anything -- further under it by MORE
 *  than their pre-existing gap (r10's own deficit widens from 6.2 points to
 *  8.7), the identical shape of conflict AoGlsl's own near/far gate exists to
 *  solve. Set tight because the excess itself is tight: gone by r10 (10 m).
 */
uniform float uThinNearM;
uniform float uThinFarM;

${DEPTH_GLSL}

float depthAt(vec2 uv) { return textureLod(tDepth, uv, 0.0).x; }

/** Period exactly 4 px in both axes, so the 4-tap cross in the apply resolves it. */
float dither(vec2 p) {
  vec2 c = floor(mod(p, 4.0));
  float i = c.y * 4.0 + c.x;
  return mod(i * 5.0 + floor(i / 4.0) * 3.0, 16.0) / 16.0;
}

/**
 * The geometric normal, from two depth taps per axis, picking the neighbour on
 * the CONTINUOUS side of any silhouette, PLUS (in .w) the mean absolute view-
 * space depth deviation of those same four neighbours -- AoGlsl's
 * normalAndEdgeFromDepth (RN-2190), reused here rather than shared, because the
 * two passes have no common module to hold it and each already owns its own
 * DEPTH_GLSL-based reconstruction.
 *
 * The normal is here for one specific job: refusing to shade a surface that
 * already faces away from the sun. That surface is dark because the LIGHTING
 * made it dark, and multiplying a second darkness into it is the double-
 * darkening failure that PostConfig's occlusion note is about. The edge term is
 * here for RN-2220: a grass-blade silhouette a texel wide puts one or two of the
 * four taps past the blade onto the ground metres behind it, which is exactly
 * the thin-geometry signal AoGlsl measured overcounts occlusion, and the same
 * shape of overcount applies to a hard-edged screen-space march walking through
 * a field of them -- the carpet's own translucency term (GrassGlsl's trans)
 * already stands for a blade's soft self-shadowing, so a hard contact-shadow
 * multiply on top double-darkens it the same way thin AO did.
 */
vec4 normalAndEdgeFromDepth(vec2 uv, vec3 P) {
  vec2 ul = uv - vec2(uTexel.x, 0.0);
  vec2 ur = uv + vec2(uTexel.x, 0.0);
  vec2 ud = uv - vec2(0.0, uTexel.y);
  vec2 uu = uv + vec2(0.0, uTexel.y);
  vec3 Pl = viewFromDepth(ul, depthAt(ul));
  vec3 Pr = viewFromDepth(ur, depthAt(ur));
  vec3 Pd = viewFromDepth(ud, depthAt(ud));
  vec3 Pu = viewFromDepth(uu, depthAt(uu));
  vec3 dx = abs(Pl.z - P.z) < abs(Pr.z - P.z) ? (P - Pl) : (Pr - P);
  vec3 dy = abs(Pd.z - P.z) < abs(Pu.z - P.z) ? (P - Pd) : (Pu - P);
  vec3 n = cross(dx, dy);
  float l = length(n);
  vec3 normal = l < 1e-12 ? vec3(0.0, 0.0, 1.0) : n / l;
  float edge = 0.25 * (abs(Pl.z - P.z) + abs(Pr.z - P.z) + abs(Pd.z - P.z) + abs(Pu.z - P.z));
  return vec4(normal, edge);
}

void main() {
  float d = depthAt(vUv);
  if (isBackground(d)) { gl_FragColor = vec4(1.0); return; }

  vec3 P = viewFromDepth(vUv, d);
  vec4 ne = normalAndEdgeFromDepth(vUv, P);
  vec3 N = ne.xyz;
  float ndl = dot(N, uSunView);
  // Already facing away from the sun: the shading model has handled it.
  if (ndl <= 0.02) { gl_FragColor = vec4(1.0); return; }
  // RN-2220. Saturates on the same high-frequency depth-edge density AoGlsl's
  // thin term reads, applied to the RESULT (occl, below) rather than to the
  // march, for the identical reason AoGlsl's own header gives: the march's step
  // count does not couple to this signal the way a search radius would, so
  // there is no "measured backwards" trap here, but damping the result is still
  // the minimal, march-independent change.
  float thin = clamp(ne.w * uThinEdgeInv, 0.0, 1.0);
  // RN-2220. DISTANCE-GATED, AoGlsl's own construction: see uThinNearM's note.
  thin *= 1.0 - smoothstep(uThinNearM, uThinFarM, -P.z);

  // Clamp the march so a surface right against the camera cannot walk the whole
  // framebuffer. uProj[0][0] survives both the reversed-Z flip and the log-depth
  // path untouched, because both rewrite only row 2.
  float lenM = uLengthM;
  float uvLen = 0.5 * uProj[0][0] * lenM / max(0.05, -P.z);
  if (uvLen > uMaxScreen) lenM *= uMaxScreen / uvLen;
  // Under a texel of travel there is nothing to march through.
  if (uvLen < uTexel.x * 0.5) { gl_FragColor = vec4(1.0); return; }

  float step = lenM / float(OF_CS_STEPS);
  // Offset the START by up to one step. Without it every pixel samples the same
  // ring of world distances and a low sun produces concentric banding.
  float t = step * (0.35 + 0.65 * dither(gl_FragCoord.xy));
  float occl = 0.0;

  for (int i = 0; i < OF_CS_STEPS; ++i) {
    vec3 R = P + uSunView * t;
    vec4 c = uProj * vec4(R, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float sd = depthAt(suv);
    if (!isBackground(sd)) {
      // View space is right-handed with -z into the screen, so a SMALLER -z is
      // nearer the eye. The ray is occluded when the surface the depth buffer
      // holds sits in FRONT of the ray point by more than the bias and by less
      // than the assumed occluder thickness. The upper bound is what stops a
      // distant hillside from casting a contact shadow through empty air.
      float dz = viewFromDepth(suv, sd).z - R.z;
      if (dz > uBiasM && dz < uThickM) {
        // Fade with distance along the ray, so the term dies out rather than
        // ending in a ring at exactly uLengthM.
        occl = max(occl, 1.0 - t / lenM);
      }
    }
    t += step;
  }

  // RN-2220. Pull the occlusion toward 0 (no contact shadow) for high-frequency
  // depth, by uThinAmount at full saturation. contactthin=0 sets uThinAmount to
  // 0.0 at the call site, the algebraic identity, making this line exactly the
  // pre-RN-2220 one.
  occl *= 1.0 - thin * uThinAmount;

  // Fade out as the surface turns away from the sun, so the term joins the
  // shading model's own terminator instead of ending on a line across it.
  gl_FragColor = vec4(vec3(1.0 - occl * clamp(ndl * 4.0, 0.0, 1.0)), 1.0);
}
`;

/**
 * The multiply pass. Reads the contact buffer with a 5-tap cross whose arms are
 * 1 px, which is exactly the resolve for a 4-px-period dither, and multiplies
 * the result into the scene colour through a blend state rather than a texture
 * read, so it never samples an attachment of the framebuffer it writes to
 * (RN-11).
 */
export const CONTACT_APPLY_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tContact;
uniform vec2 uTexel;
uniform float uStrength;

void main() {
  float s = textureLod(tContact, vUv, 0.0).x;
  s += textureLod(tContact, vUv + vec2(uTexel.x, 0.0), 0.0).x;
  s += textureLod(tContact, vUv - vec2(uTexel.x, 0.0), 0.0).x;
  s += textureLod(tContact, vUv + vec2(0.0, uTexel.y), 0.0).x;
  s += textureLod(tContact, vUv - vec2(0.0, uTexel.y), 0.0).x;
  s *= 0.2;
  gl_FragColor = vec4(vec3(mix(1.0, clamp(s, 0.0, 1.0), uStrength)), 1.0);
}
`;
