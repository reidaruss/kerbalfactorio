// THE THIRD DEGENERACY: HALF THE CANOPY IS LIT UPSIDE DOWN. RN-2605.
//
// `OF_Canopy` is `doubleSided` in the glTF (`of_lib.DOUBLE_SIDED` carries
// `Canopy`) and three's `normal_fragment_begin` does
//
//     float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
//     vec3 normal = normalize( vNormal );
//     #ifdef DOUBLE_SIDED
//       normal *= faceDirection;
//     #endif
//
// so the WHOLE shading normal is negated on a back face. That is correct for a
// surface whose two sides genuinely face opposite ways (a leaf, a sheet of
// paper). A crown impostor is not that surface. `CrownNormal.ts` bakes it the
// CANOPY LAYER's normal: outward and UP off a dome anchored below the crown
// base, which is the same normal whichever side of the card you stand on,
// because a canopy layer has one up and it is not a property of the viewer.
//
// A crossed quad is PLANAR, so from any camera each quad is entirely front- or
// entirely back-facing, and the per-instance yaw makes that a coin flip. About
// half of every stand's drawn card area therefore takes RN-2590's dome normal
// INVERTED, tops for bottoms. Post-RN-2590 those back faces carry ZERO
// up-pointing normals; pre-RN-2590 the sign tear accidentally left them one of
// four, which is why the sign fix taken alone measured as a 29 per cent
// REGRESSION (rendering.md 2.39.3 and 2.39.6: the three arms read -29 / -44 /
// -11 per cent alone and +1.8 per cent together). The two wrongs were making a
// partial right.
//
// ---------------------------------------------------------------------------
// A MATERIAL FLAG IS A LIGHTING DECISION, AND NOTHING THAT AUTHORS THE NORMAL
// CAN SEE IT
// ---------------------------------------------------------------------------
// Worth one paragraph before the derivation, because it is why this survived
// three lanes. `side` is authored in the ASSET as a CULLING choice ("do not
// cull this card's back"), it is carried by a name list in `of_lib`, and three
// silently promotes it to a per-fragment negation of the shading normal.
// `FoliageNormal.ts`, `CrownNormal.ts` and every readback either of them
// publishes measure the BAKED BYTES, and the negation happens strictly
// downstream of the last byte any of them can read. RN-2570 and RN-2590 each
// re-derived the crown's normal from the `glb` and each was reading a vector
// that half the drawn area never receives. Filed as a trap in
// `docs/web/NUMBERS.md`.
//
// ---------------------------------------------------------------------------
// TWO CANDIDATE CORRECTIONS, AND THEY DIFFER BY EXACTLY ONE SIGN
// ---------------------------------------------------------------------------
// Write the baked normal in the tree's own frame, where `y` is the local up the
// dome was built against:
//
//     N = ( a.x * sinT,  cosT,  a.z * sinT )        CrownNormal.ts's construction
//
// with `cosT > 0` at every vertex by construction (the anchor is BELOW the
// base, so `dy = (py - lo) + q` is strictly positive). Three hands a back-face
// fragment `n3 = -N`. There are exactly two ways to put the up component back,
// and they are the two signs of the horizontal part:
//
//   UNNEGATE   N                    = ( +N.x, +N.y, +N.z )   the bake, as baked
//   UPFOLD     n3 reflected in the
//              horizontal plane     = ( -N.x, +N.y, -N.z )
//
// `N`'s horizontal part points along the card's own authored normal, which on a
// BACK face points AWAY from the camera; the upfold turns it toward the camera.
//
// **RN-2590's OWN HEADER ARGUES FOR THE UPFOLD AND IT IS WRONG, AND THIS FILE
// SAYS SO RATHER THAN QUIETLY DISAGREEING.** That header's paragraph on `n`
// reads: "The arbitrary global sign of `n` costs nothing because `OF_Canopy` is
// `doubleSided` ... so `c * n` points toward the VIEWER on whichever side is
// visible. That is the property being bought: `c` raises `N . V` on the visible
// face monotonically and can never lower it." The property is real and it is a
// SPECULAR property, and buying it costs something the paragraph does not
// price: **a diffuse response that depends on where the camera is.** Lambertian
// reflectance is a function of `N . L`, and if `N` swings by `2 * sinT` when the
// eye crosses the card's plane then the crown's own diffuse brightens and dims
// as you fly past it, for no reason a canopy has. The upfold makes half of every
// stand's shading normals a function of the view direction. `UNNEGATE` leaves
// the field fixed in the world, which is what a leaf mass is.
//
// AND THE FRAME AGREES, WHICH IS WHY THIS IS A DECISION RATHER THAN AN OPINION.
// `rn2591ladder`, four poses, one build, a fresh process per arm, the crown's
// UNSHADED UNSPECULAR diffuse ratio `rho0` (the quantity 2.38.3's spread is a
// spread OF, and the one with no specular in it at all):
//
//   inert (three's negation)   5.20x   0.4199 / 1.5027 / 0.5331 / 2.1823
//   UPFOLD                     3.90x   0.8498 / 2.6601 / 0.9076 / 3.3129
//   UNNEGATE                   2.46x   0.9047 / 1.6565 / 0.9344 / 2.2276
//
// The pose-invariance the whole "it is a sample of the canopy LAYER" argument
// is measured by is BETTER under `UNNEGATE` by a wide margin, and it is better
// on the term that cannot be a specular artefact. On `rho` itself the two are
// close (2.64x against 2.77x) and `UNNEGATE` is the one that carries
// `forestairnoon` INTO the band (0.1906 against 0.1692 and a floor of 0.18).
// It also runs a consistently HIGHER specular share at all four poses
// (+0.023 to +0.033), which is the honest cost and is recorded in
// rendering.md 2.40.4 rather than buried: `UNNEGATE` lowers `N . V`, Fresnel
// rises, and the crown's known "too specular, too blue" defect is fed by it.
// The diffuse evidence outweighs it because the diffuse is the half of `rho`
// the band wants and the specular has its own routed lane with its own handle.
//
// **AND `UNNEGATE` IS THE CANDIDATE 2.39.12 ITEM 1 ALREADY CALLED THE EXACT
// ONE.** Its two routed fixes were an `abs()` in the shader ("one line") and
// "duplicate the four triangles with reversed winding and move the material to
// `FrontSide`. Exact rather than approximate." A reversed-winding duplicate
// carries the SAME baked normals and under `FrontSide` no negation is emitted
// at all, so that candidate's pixel IS `UNNEGATE`, to the digit. This file
// delivers it for one comparison and one negate per back-facing canopy
// fragment instead of 4 triangles and 8 vertices per impostor part on the
// densest instanced batch in the game, and without moving `side`, which would
// also move three's `shadowSide` default. **The geometry route is dominated on
// price at identical pixels and is not built.**
//
// ---------------------------------------------------------------------------
// FOUR STATES (RN-952: every term gets a switch, and this one adds a VALUE and
// a COST so it needs two controls, `?propsky=`'s own design)
// ---------------------------------------------------------------------------
//   `?crownface=off`  the splice is NOT INSTALLED and the crown falls back to
//                     the shared foliage hook, so this is the pre-RN-2605
//                     program SET, not merely the pre-RN-2605 program text.
//                     The arm the COST is measured against.
//   `?crownface=0`    installed and inert. Same program, one uniform apart, so
//                     the arm the VALUE is measured against and the only arm
//                     that is bit-comparable to the shipped one.
//   `?crownface=1`    SHIPPED. `UNNEGATE`.
//   `?crownface=2`    `UPFOLD`, the measured loser, kept because a refusal
//                     with no reachable arm is prose.
//
// ---------------------------------------------------------------------------
// THE FRONT FACE IS UNTOUCHED, AND THE CLAIM IS SOURCE-LEVEL
// ---------------------------------------------------------------------------
// The whole block is inside `faceDirection < 0.0`, so a front-face fragment
// does not execute one instruction of it and RN-2590's polar/azimuth
// construction reaches the front half through source that is character for
// character what it was. **That is a claim about the SOURCE and not about the
// emitted bits** (corrected on a fresh-context reviewer's reading, which is
// right: adding a branch and a varying can move a driver's register allocation
// and its mad contraction for the surrounding code, and GLSL promises nothing
// there). The arm that is bit-comparable is `?crownface=0`, one uniform apart
// on ONE program, and it is why that arm exists.
//
// ---------------------------------------------------------------------------
// WHERE `up` COMES FROM, AND WHY IT IS NOT THE PLANET RADIAL
// ---------------------------------------------------------------------------
// The axis being reflected about is the one `CrownNormal.ts` measured `cosT`
// against, which is the PART's own `+y`, not the planet's. For a placed tree
// the two agree to the tilt of the ground it stands on, and taking the radial
// would have needed `uBodyCenter` (a uniform this splice would then have to
// plumb, with `PropSkyAmbient`'s publish-order race attached) plus a
// per-fragment `normalize` of a 600 km vector.
//
// The instance's own up is CHEAPER AND EXACT: `batchingMatrix` is already in
// scope at `#include <defaultnormal_vertex>` (`#include <batching_vertex>` runs
// six lines earlier in `meshphysical`'s vertex main, and `PropWind`'s own
// `WIND_GLSL` already reads `batchingMatrix[3].xyz` further down), so the same
// matrix that orients the crown orients its up, through the same
// `normalMatrix`. One varying, no uniform, no publish order, and it is right on
// a slope as well as on the flat.
//
// **NOTE THAT THE SHIPPED MODE DOES NOT USE `up` AT ALL** (`UNNEGATE` is a
// negation), so on the shipped path the varying is carried for the `UPFOLD`
// arm's sake. It is kept rather than deleted because a refused candidate with
// no reachable arm cannot be re-judged by the next lane, and because a `vec3`
// varying is affordable here: WebGL2 gives 16 vectors and this program spends
// `vViewPosition`, `vNormal`, one UV set, `vColor` and three cascade shadow
// coordinates. That is a real resource cost and it is stated rather than
// assumed away.
//
// HONEST LIMITS ON `up`, both raised by a fresh-context reviewer:
//  1. `up` is transformed as a DIRECTION (`mat3(batchingMatrix) * y`) while
//     three transforms the normal by its inverse-transpose stand-in. For the
//     specific vector `(0,1,0)` the two agree after `normalize` under ANY
//     diagonal scale, because both are column 1 of `bm` up to a positive
//     scalar; they diverge only under a SHEAR, which three's own comment in
//     `defaultnormal_vertex` already declares unsupported.
//  2. `vOfCrownUp` goes through `normalMatrix`, which is an inverse transpose,
//     rather than through `mat3(modelViewMatrix)`. The two agree while the
//     mesh's own matrix is orthonormal times a uniform scale. A `BatchedMesh`'s
//     object matrix is the identity here, so `normalMatrix` is the view
//     rotation and it holds.
//  3. `V_TERM` sits AFTER three's `#ifdef FLIP_SIDED` negation, so if this
//     material's `side` ever became `BackSide` the normal would be negated and
//     the up would not, and `faceDirection` would be -1 on every visible
//     fragment. It is `DoubleSide` today and the readback below COUNTS that
//     rather than assuming it.

import * as THREE from 'three';

/**
 * RN-150-safe. `Number(null)` is 0 and 0 is a MEANINGFUL setting here, so the
 * four states are read off the raw string and an unparseable ask returns the
 * SHIPPED mode rather than a silent clamp (RN-2268's scar: a clamped ask reports
 * the clamp and the table then describes the clamp as the request).
 */
const RAW = new URLSearchParams(self.location.search).get('crownface');

/** `UNNEGATE`. See the header for the measurement that chose it over `UPFOLD`. */
export const CROWN_FACE_MODE_SHIPPED = 1;

/** `?crownface=off` removes the splice AND the crown's own hook: the COST arm. */
export const CROWN_FACE_INSTALLED = RAW !== 'off';

const MODE = ((): number => {
  if (RAW === null || RAW === 'off') return CROWN_FACE_MODE_SHIPPED;
  const v = Number(RAW);
  return Number.isFinite(v) && v >= 0 && v <= 2 ? v : CROWN_FACE_MODE_SHIPPED;
})();

/**
 * THE ONE UNIFORM OBJECT, shared by reference into every program this splice
 * reaches, exactly as `PropWind` and `PropSkyAmbient` share theirs.
 *
 * IT IS A CUSTOM UNIFORM AND NOT A MATERIAL PROPERTY, and after RN-2590 that
 * distinction is worth one sentence rather than none. `envMapIntensity` is a
 * MATERIAL property and `WebGLRenderer.js:2694-2696` overwrites it from
 * `scene.environmentIntensity` every frame, which is why that switch was dead
 * while its request readback looked healthy. A uniform installed into
 * `shader.uniforms` by an `onBeforeCompile` has no such branch anywhere in the
 * renderer: three uploads `materialProperties.uniforms`, which IS this object,
 * on every draw. The value cannot be erased between the write and the draw.
 */
const uCrownFace: THREE.IUniform<number> = { value: MODE };

const V_COMMON = '#include <common>';
const V_NORMAL = '#include <defaultnormal_vertex>';
const F_NORMAL = '#include <normal_fragment_begin>';

/**
 * SENTINEL TOKENS, one per spliced TERM, and they exist because the obvious
 * miss check does not work.
 *
 * A first version tested the fragment for `uCrownFace`, which the DECLARATION
 * also contains, so the test passed whenever the `#include <common>` anchor was
 * found and could never report a lost `normal_fragment_begin` anchor: the one
 * anchor whose loss makes the whole lane inert was the one the miss list could
 * not see (found by a fresh-context reviewer before this shipped). The tokens
 * below appear ONLY in the term bodies, so each anchor has a check that
 * isolates it and a rename cannot silently disarm one.
 */
const V_MARK = 'OF_CROWNFACE_V';
const F_MARK = 'OF_CROWNFACE_F';

/** The instance's own up, in VIEW space, which is the space `normal` is in. */
const V_DECL = /* glsl */`
varying vec3 vOfCrownUp;
`;

const V_TERM = /* glsl */`
{
  // ${V_MARK}
  #ifdef USE_BATCHING
    vec3 ofCfUp = mat3( batchingMatrix ) * vec3( 0.0, 1.0, 0.0 );
  #else
    vec3 ofCfUp = vec3( 0.0, 1.0, 0.0 );
  #endif
  vOfCrownUp = normalize( normalMatrix * ofCfUp );
}
`;

const F_DECL = /* glsl */`
varying vec3 vOfCrownUp;
uniform float uCrownFace;
`;

/**
 * ANCHORED AT `normal_fragment_begin` BECAUSE THAT IS WHERE THE DEFECT IS. The
 * negation this corrects is emitted by that chunk's own `DOUBLE_SIDED` branch,
 * so the correction sits one line after it and before anything reads `normal`.
 *
 * `nonPerturbedNormal` is re-assigned because the chunk's last line sets it from
 * the pre-correction `normal` and `lights_physical_fragment`'s geometry
 * roughness plus the clearcoat path both read it.
 *
 * WHAT IS NOT REACHED, enumerated rather than waved at (a fresh-context
 * reviewer's list). `tbn` and `tbn2` are built INSIDE `normal_fragment_begin`
 * from the pre-splice normal and are themselves multiplied by `faceDirection`,
 * so five features would compose badly with this term: a tangent-space normal
 * map and an object-space one would OVERWRITE the fold outright, a bump map
 * would take the folded normal and re-apply `faceDirection` (a double flip),
 * and anisotropy and a clearcoat normal map would keep an uncorrected frame.
 * `OF_Canopy` has none of the five. That is COUNTED LIVE in the readback below
 * rather than asserted here, because a texture can land late (`SurfaceBind`'s
 * apply re-runs on a late load) and a snapshot taken at hook-install time would
 * report a healthy zero for the rest of the session.
 *
 * `#ifndef FLAT_SHADED` is not defensive noise. Under `FLAT_SHADED` three does
 * not read `vNormal` at all, it takes the geometric normal off `dFdx`/`dFdy` of
 * the view position, which ALWAYS faces the viewer and which the whole
 * `CrownNormal` bake is invisible to. Correcting that vector would be a term
 * with no defect to correct, applied to a normal nobody authored. The canopy
 * material is not flat-shaded today (if it were, RN-2590's bake could not have
 * moved a pixel and it moved several), so the guard costs nothing and closes
 * the one way this splice could silently start meaning something else.
 */
const F_TERM = /* glsl */`
#ifndef FLAT_SHADED
{
  // ${F_MARK}
  // BACK FACES ONLY, so the front half of every stand keeps RN-2590's
  // construction. See the header on what that claim does and does not cover.
  if ( faceDirection < 0.0 && uCrownFace > 0.5 ) {
    // mode 1 UNNEGATE (shipped): undo three's DOUBLE_SIDED negation, so the
    // card carries the normal the bake wrote on both of its faces.
    // mode 2 UPFOLD: keep the negation and reflect the result in the tree's own
    // horizontal plane, which turns the azimuth toward the viewer. Refused.
    vec3 ofCfUp = normalize( vOfCrownUp );
    normal = uCrownFace < 1.5
      ? - normal
      : normal - 2.0 * min( dot( normal, ofCfUp ), 0.0 ) * ofCfUp;
    nonPerturbedNormal = normal;
  }
}
#endif
`;

/** Anchors that went missing, so a three upgrade that renames or rewrites a
 *  chunk is a REPORTED number rather than a term that quietly stopped
 *  existing. Deduplicated, because `needsUpdate` forces recompiles and an
 *  accumulating list would report one lost anchor as twenty. */
const misses: string[] = [];
const miss = (s: string): void => { if (!misses.includes(s)) misses.push(s); };
/** The materials the crown hook was chosen for, and the objects themselves so
 *  the hazard counts below can be read LIVE rather than at install time. */
const crownMats: { tag: string; m: THREE.Material }[] = [];
/** COMPILES, not programs. `needsUpdate` recompiles, so this counts splice
 *  calls and reads above one for a single material after a late texture load.
 *  Zero with a nonzero mode is still the vacuous green, which is what it is
 *  for; `materials` below is the count that answers "how many materials". */
let compiles = 0;

interface Splicable {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

/**
 * Splice the correction into ONE program.
 *
 * EXPORTED AS A SPLICER rather than installed as a hook, on `FurShader`'s and
 * `PropSkyAmbient`'s precedent and for their reason: a material holds ONE
 * `onBeforeCompile` and the crown card has already spent its on `PropWind`. The
 * crown's hook calls this; every other foliage batch's hook does not, which is
 * the SCOPE. `OF_Canopy` gets a different program from the understorey because
 * a different module-scope function object is assigned to it, and three's
 * program cache key stringifies `onBeforeCompile`, so the understorey's program
 * is byte-identical to the pre-lane one BY CONSTRUCTION rather than by a
 * uniform that happens to be zero.
 */
export function injectCrownFaceFold(shader: Splicable): void {
  if (!CROWN_FACE_INSTALLED) return;
  shader.uniforms.uCrownFace = uCrownFace;
  shader.vertexShader = shader.vertexShader
    .replace(V_COMMON, `${V_COMMON}\n${V_DECL}`)
    .replace(V_NORMAL, `${V_NORMAL}\n${V_TERM}`);
  shader.fragmentShader = shader.fragmentShader
    .replace(V_COMMON, `${V_COMMON}\n${F_DECL}`)
    .replace(F_NORMAL, `${F_NORMAL}\n${F_TERM}`);
  // FOUR CHECKS, EACH ISOLATING ONE ANCHOR. The declaration tests look for the
  // varying, which only `V_DECL`/`F_DECL` emit; the term tests look for the
  // sentinel tokens, which only the term bodies carry. See `V_MARK`.
  if (!shader.vertexShader.includes('vOfCrownUp')) miss(`vertex:${V_COMMON}`);
  if (!shader.vertexShader.includes(V_MARK)) miss(V_NORMAL);
  if (!shader.fragmentShader.includes('uCrownFace')) miss(`fragment:${V_COMMON}`);
  if (!shader.fragmentShader.includes(F_MARK)) miss(F_NORMAL);
  compiles++;
}

/**
 * Record which materials the crown hook was chosen for. The hazard counts are
 * NOT taken here; see `crownFaceState`.
 */
export function noteCrownFaceMaterial(m: THREE.Material, tag: string): void {
  crownMats.push({ tag, m });
}

/**
 * THE READBACK, AND IT IS DELIBERATELY NOT A REQUEST READBACK.
 *
 * RN-2590's own scar (NUMBERS.md, "a readback proves the query parsed, not that
 * the uniform survived"): `treeline().self.envOverride` returned the parsed ask
 * and the term was dead. So this publishes, in order of strength:
 *
 *   `mode`      the live `.value` of the uniform OBJECT the draw reads, not the
 *               parsed query. It is the object installed into `shader.uniforms`,
 *               which is the one three uploads, so no renderer branch can erase
 *               it between the write and the draw.
 *   `compiles`  how many splice calls landed. Zero with a nonzero mode is the
 *               vacuous green: the term is configured and in no shader.
 *   `misses`    which anchor was not found, deduplicated. Empty is the claim.
 *   `materials` which batches took the crown hook. `props:canopy` alone is the
 *               scope claim and any second name is a scope leak.
 *   `hazards`   the five material features that would compose badly with the
 *               splice, COUNTED LIVE at call time rather than snapshotted at
 *               install, plus `notDoubleSided`, since three emits the negation
 *               this file corrects only while `side` is `DoubleSide` and emits
 *               `FLIP_SIDED` instead on `BackSide`. All six read 0 today.
 *
 * AND NONE OF THEM IS SUFFICIENT ON ITS OWN. The outcome that settles it is
 * that `?crownface=0` against the shipped default must MOVE PIXELS on a pose
 * with crowns in it, and an EXACT zero there is the signature of a write that
 * never arrived rather than of a term that does nothing (NUMBERS.md, RN-2590's
 * third rule). `rn2607untouched.mjs` asserts exactly that, with `forestairnoon`
 * carried as an arming pose that MUST move.
 */
export function crownFaceState(): {
  raw: string | null; mode: number; installed: boolean; compiles: number;
  misses: string[]; materials: string[];
  hazards: {
    normalMap: number; bumpMap: number; clearcoatNormalMap: number;
    anisotropy: number; notDoubleSided: number;
  };
} {
  const h = {
    normalMap: 0, bumpMap: 0, clearcoatNormalMap: 0, anisotropy: 0,
    notDoubleSided: 0,
  };
  for (const { m } of crownMats) {
    const s = m as THREE.MeshPhysicalMaterial;
    if (s.normalMap != null) h.normalMap++;
    if (s.bumpMap != null) h.bumpMap++;
    if (s.clearcoatNormalMap != null) h.clearcoatNormalMap++;
    if (typeof s.anisotropy === 'number' && s.anisotropy > 0) h.anisotropy++;
    if (m.side !== THREE.DoubleSide) h.notDoubleSided++;
  }
  return {
    raw: RAW, mode: uCrownFace.value, installed: CROWN_FACE_INSTALLED,
    compiles, misses: [...misses], materials: crownMats.map((c) => c.tag),
    hazards: h,
  };
}
