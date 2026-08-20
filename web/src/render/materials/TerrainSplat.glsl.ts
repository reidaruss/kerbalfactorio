// THE SPLAT: the near-field layer blend. GLSL text and the defines the six
// layer textures are sampled through. A leaf module on TerrainFine's precedent
// (2.2 rule 1); TerrainArt.glsl.ts imports and re-exports it so there is still
// one place to look for "what surface-art terms exist".
//
// RN-2160. This is the TENTH surface-art term and the first one that is a
// MATERIAL rather than a modulation. Everything before it answers "how does
// this ground vary"; this answers "what is this ground made of", by blending
// six authored layers (grass, dirt, rock, cliff, scree, snow) with weights
// taken from slope, altitude and biome. tools/blender/terraintex.py generates
// the layers; TerrainSplat.ts holds the table and states the convergence rule
// in full. Read that file first: this one is its shader half.
//
// ---------------------------------------------------------------------------
// SIX UNCONDITIONAL FETCHES, AND WHY THERE IS NO BRANCH TO SAVE THEM
// ---------------------------------------------------------------------------
// At any one fragment at most three of the six weights are meaningfully
// non-zero, so the obvious optimisation is to skip the rest. It is not
// available and the reason is measured, not theoretical: inside NON-UNIFORM
// control flow a texture fetch has UNDEFINED LOD (RN-78 paid a full hunt for
// exactly this, and photographed it as mip-0 speckle at 40 m plus deep-mip mush
// at 3 m, immune to every anisotropy setting). Every weight here is per-pixel,
// so every branch on one would be non-uniform. The fetches are therefore
// unconditional and the SELECTION IS BY BLENDING, which is also what lets the
// weights interpolate across a biome edge the way vMatW already does.
//
// The one branch that IS taken is on `uSplatAmp`, a bare uniform, which is how
// `?splat=0` and the low quality tier cost nothing at all rather than costing
// six fetches multiplied by zero.
//
// ---------------------------------------------------------------------------
// THE WEIGHT RULES, AND WHICH GATE EACH ONE SHARES
// ---------------------------------------------------------------------------
// Not one of these introduces a new selector. Every gate below is either one
// the material already computes for another term, or is derived from one, and
// that is deliberate: a splat with its own opinion about where a cliff starts
// would disagree with the albedo, the grain and the relief, which all ride
// `coverSel` today.
//
//   cover  = coverSel, the shipped smoothstep(0.55, 0.88, dot(n, up)). ONE
//            authority for "is this ground gentle enough to hold cover".
//   vert   = 1 - smoothstep(0.16, 0.42, flat_), i.e. near-vertical. The band
//            sits BELOW coverSel's own lower edge so cliff and cover never
//            both claim a fragment; what is between them is `steep`.
//   steep  = max((1 - cover) - vert, 0), the rock/scree domain.
//   apron  = smoothstep(0.30, 0.62, band), where band is vRelief / maxRelief,
//            the SAME altitude coordinate the snowline is expressed in. It
//            splits `steep` between rock low down and scree up on the apron,
//            which is where a talus slope actually is.
//   veg    = clamp(vMatW.x * 3, 0, 1). vMatW.x is BiomeMaterial's grass-clump
//            weight and is already the game's answer to "how vegetated is this
//            biome" (Plains 0.33, Forest 0.34, Hills 0.21, Mountains 0.02,
//            every other biome 0). Reusing it is worth stating as a decision:
//            the alternative was a seventh per-biome table, which would have
//            been a second answer to a question BiomeMaterial has already
//            answered and would have cost a varying, and varyings are the
//            scarce resource in this material.
//   patch  = a chunk-periodic value noise at 3 repeats per quad, about 9.6 m.
//            It moves the grass/dirt split so a meadow is patchy rather than
//            uniform, and it is INCOMMENSURATE with the 2.07 m layer tile,
//            which is half of the anti-tiling story.
//   snow   = the shipped snow scalar, unchanged. It DISPLACES the other five
//            rather than adding to them, so a snowfield is snow and not snow
//            over a ghost of the rock underneath.
//
// The five terrain weights are normalised to sum to 1 and then scaled by
// (1 - snow), with snow taking the remainder. The sum is therefore EXACTLY 1
// at every fragment, which is the precondition the convergence rule's clause
// C3 needs: a convex combination of unit-luminance hue vectors has unit
// luminance, so the chroma term cannot move value.

import { SPLAT_LAYERS, SPLAT_WARP_UV, SPLAT_WARP_REPEATS, SPLAT_PATCH_REPEATS }
  from './TerrainSplat.js';

const f = (n: number): string => n.toFixed(5);
const v3 = (v: { x: number; y: number; z: number }): string =>
  `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;

/**
 * The defines. GENERATED from TerrainSplat.ts's table rather than typed here,
 * so the hue vectors the shader multiplies by are literally the ones
 * `assertHueLuminance` proved. A transcribed copy would be a second authority
 * on a number whose whole property is an exact identity (standing rule 11).
 */
export const TERRAIN_SPLAT_PARS = SPLAT_LAYERS
  .map((l, i) => `#define OF_SPLAT_REP${i} ${l.repeats.toFixed(1)}\n`).join('')
  + `#define OF_SPLAT_HUE_A mat3(${v3(SPLAT_LAYERS[0].hue)}, `
  + `${v3(SPLAT_LAYERS[1].hue)}, ${v3(SPLAT_LAYERS[2].hue)})\n`
  + `#define OF_SPLAT_HUE_B mat3(${v3(SPLAT_LAYERS[3].hue)}, `
  + `${v3(SPLAT_LAYERS[4].hue)}, ${v3(SPLAT_LAYERS[5].hue)})\n`
  + `#define OF_SPLAT_RB_A vec3(${f(SPLAT_LAYERS[0].roughBase)}, `
  + `${f(SPLAT_LAYERS[1].roughBase)}, ${f(SPLAT_LAYERS[2].roughBase)})\n`
  + `#define OF_SPLAT_RB_B vec3(${f(SPLAT_LAYERS[3].roughBase)}, `
  + `${f(SPLAT_LAYERS[4].roughBase)}, ${f(SPLAT_LAYERS[5].roughBase)})\n`
  + `#define OF_SPLAT_WARP ${f(SPLAT_WARP_UV)}\n`
  + `#define OF_SPLAT_WARPP ${SPLAT_WARP_REPEATS.toFixed(1)}\n`
  + `#define OF_SPLAT_PATCHP ${SPLAT_PATCH_REPEATS.toFixed(1)}\n`;

export const TERRAIN_SPLAT = /* glsl */`
  // THE WARP. Periodic on the chunk at an INTEGER repeat count, so it is
  // continuous across a chunk edge by the same arithmetic that makes the layer
  // tiles continuous: at a shared edge both sides evaluate the field at an
  // integer coordinate. A warp that was not periodic here would trade the
  // tiling artifact this term exists to fix for a seam on every chunk boundary,
  // which is a strictly worse artifact because it is straight.
  //
  // Two components off ONE lattice at two fractional offsets, rather than two
  // lattices. ofArtVnoise2P wraps with mod(), so a constant offset shifts where
  // the field is READ and leaves its period alone; a second lattice would cost
  // four more hashes to buy decorrelation the offsets already give.
  vec2 ofSplatWarp(vec2 uv) {
    float wx = ofArtVnoise2P(uv * OF_SPLAT_WARPP, OF_SPLAT_WARPP) - 0.5;
    float wy = ofArtVnoise2P(uv * OF_SPLAT_WARPP + vec2(0.37, 0.71),
                             OF_SPLAT_WARPP) - 0.5;
    return vec2(wx, wy) * OF_SPLAT_WARP;
  }

  // THE WEIGHTS. Two vec3 out-parameters rather than a struct or six floats,
  // because every consumer below wants them as vectors for a dot product and
  // GLSL ES 1.00 has no way to return two of anything.
  //
  //   wA = (grass, dirt, rock)     wB = (cliff, scree, snow)
  //
  // The order is of_terrain.json's "order" and TerrainSplat.ts's table order,
  // which is the same order, asserted by terraintex's own check.
  void ofSplatW(float cover, float flat_, float band, float snowF,
                float veg, float patch01, out vec3 wA, out vec3 wB) {
    // BELOW coverSel's lower edge (0.55) on purpose: between 0.42 and 0.55 the
    // ground is neither cliff nor cover and is rock, which is what a real
    // hillside does between a meadow and a crag.
    float vert = 1.0 - smoothstep(0.16, 0.42, flat_);
    float steep = max((1.0 - cover) - vert, 0.0);
    float apron = smoothstep(0.30, 0.62, band);
    // The patch field moves the split by a factor of about two either way. It
    // is clamped rather than allowed to saturate, because a biome with veg 1.0
    // must be able to reach FULL grass somewhere or the layer never shows at
    // its authored strength anywhere in the world.
    float lush = clamp(veg * (0.55 + 0.90 * patch01), 0.0, 1.0);
    wA = vec3(cover * lush, cover * (1.0 - lush), steep * (1.0 - apron));
    wB = vec3(vert, steep * apron, 0.0);
    // The floor is load-bearing and not defensive: at a fragment where cover,
    // vert and steep all round to zero (they cannot analytically, but they can
    // in float32 at a grazing normal) an unfloored divide is a NaN, and one NaN
    // in an albedo multiply is a black pixel that survives every later term.
    float s = max(wA.x + wA.y + wA.z + wB.x + wB.y, 1e-3);
    wA /= s;
    wB /= s;
    // SNOW DISPLACES. Scaling the five and handing snow the remainder keeps the
    // total at exactly 1, which clause C3 of the convergence rule needs.
    float k = 1.0 - snowF;
    wA *= k;
    wB *= k;
    wB.z = snowF;
  }

  // The four combiners. Each takes the six samples already in hand and the two
  // weight vectors, and each is a pair of dot products, so the whole blend is
  // eight multiply-adds per channel group and no branches.
  //
  // THE R, G, B AND A CHANNELS ARE ALL CENTRED ON 0.5 IN THE ASSET, so every
  // one of these subtracts 0.5 and doubles: the decode is the same for all
  // four and there is no channel with its own convention to get wrong.
  float ofSplatVal(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 g,
                   vec3 wA, vec3 wB) {
    return 2.0 * (dot(vec3(a.r, b.r, c.r) - vec3(0.5), wA)
                + dot(vec3(d.r, e.r, g.r) - vec3(0.5), wB));
  }

  // The tangent-space normal's xy, blended. Blending the ENCODED xy (rather
  // than reconstructing six normals and averaging them) is the standard linear
  // blend and it is the right one here: the weights are a partition of the
  // surface, so what is being asked is "what is the average slope of this
  // patch", not "which of six surfaces won".
  vec2 ofSplatNrm(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 g,
                  vec3 wA, vec3 wB) {
    vec2 s = (a.gb - vec2(0.5)) * wA.x + (b.gb - vec2(0.5)) * wA.y
           + (c.gb - vec2(0.5)) * wA.z + (d.gb - vec2(0.5)) * wB.x
           + (e.gb - vec2(0.5)) * wB.y + (g.gb - vec2(0.5)) * wB.z;
    return 2.0 * s;
  }

  // Roughness: a per-layer BASE from the client table, modulated by the
  // asset's centred detail channel. Multiplicative, so a minified sample (mean
  // 0.5, detail 0) converges to the base rather than to grey, which is the
  // same direction texgen's ORM note argues for ("ORM IS A MULTIPLIER, NOT AN
  // ABSOLUTE").
  //
  // The 0.15 floor is section 2.1's and TerrainTex's, shared rather than
  // re-chosen: a GGX denominator at roughness 0 is a delta function and one
  // texel of it under a moving sun is a firefly no temporal filter removes.
  float ofSplatRough(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 g,
                     vec3 wA, vec3 wB) {
    float base = dot(OF_SPLAT_RB_A, wA) + dot(OF_SPLAT_RB_B, wB);
    float det = 2.0 * (dot(vec3(a.a, b.a, c.a) - vec3(0.5), wA)
                     + dot(vec3(d.a, e.a, g.a) - vec3(0.5), wB));
    return clamp(base * (1.0 + det), 0.15, 1.0);
  }

  // The hue, as a convex combination. mat3 * vec3 is exactly the weighted sum
  // of the three columns, so this is six multiply-adds and it is the whole of
  // clause C3: each column has Rec.709 luminance 1 (asserted in TypeScript at
  // module load), the weights sum to 1, luminance is linear, therefore the
  // result has luminance 1 and the term cannot move value.
  vec3 ofSplatHue(vec3 wA, vec3 wB) {
    return OF_SPLAT_HUE_A * wA + OF_SPLAT_HUE_B * wB;
  }

  // THE TANGENT FRAME, derived per pixel from the screen derivatives of the
  // position and the chunk UV. Mikkelsen's cotangent frame.
  //
  // WHY IT HAS TO BE DERIVED AT ALL: the terrain is a cubed-sphere quadtree
  // with no surface parameterisation and no tangent attribute, which is the
  // same fact that stops it from using three's stock normal-map slot and is
  // why terraintex exists as a separate module. Without a frame there is no
  // way to orient a tangent-space normal, and an arbitrarily oriented one
  // lights every chunk from a different direction.
  //
  // IT IS CALLED IN UNIFORM CONTROL FLOW, at the top level of the bump chunk
  // inside a bare-uniform branch, for the reason every derivative in this
  // material is: dFdx inside non-uniform control flow is undefined by the same
  // rule that makes a texture fetch there undefined-LOD.
  //
  // The uv passed in is the UNWARPED chunk UV. Differentiating the warped one
  // would fold the warp's own gradient into the frame, which is RN-961's
  // finding in a third place: a difference of a blended or perturbed quantity
  // carries a term belonging to the perturbation and not to the ground.
  vec3 ofSplatFrame(vec3 n, vec3 p, vec2 uv, vec2 nxy, float amp) {
    vec3 dp1 = dFdx(p);
    vec3 dp2 = dFdy(p);
    vec2 du1 = dFdx(uv);
    vec2 du2 = dFdy(uv);
    vec3 dp2p = cross(dp2, n);
    vec3 dp1p = cross(n, dp1);
    vec3 T = dp2p * du1.x + dp1p * du2.x;
    vec3 B = dp2p * du1.y + dp1p * du2.y;
    float m = max(dot(T, T), dot(B, B));
    if (m < 1e-20) return n;
    float inv = 1.0 / sqrt(m);
    vec2 t = nxy * amp;
    // Reconstructed rather than stored, which is what freed the blue channel
    // for the normal's y. The max() is not defensive: a BLEND of six unit
    // normals is shorter than unit, so x^2 + y^2 can exceed 1 only through the
    // amplitude scale above, and a negative under a sqrt is a NaN.
    float nz = sqrt(max(1.0 - dot(t, t), 0.0));
    return normalize(T * inv * t.x + B * inv * t.y + n * nz);
  }
`;
