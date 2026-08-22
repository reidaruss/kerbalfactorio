// RN-2645. THE CROWN'S ENVIRONMENT TERM, WITH THE FIRST LIVE HANDLE THIS
// PROJECT HAS EVER HAD ON IT, AND A DERIVED SCALAR TO PUT ON IT.
//
// ---------------------------------------------------------------------------
// 1. WHY THERE WAS NO HANDLE
// ---------------------------------------------------------------------------
// `WebGLRenderer.js:2694-2696`:
//
//     if ( ( material.isMeshStandardMaterial || ... )
//          && material.envMap === null && scene.environment !== null ) {
//       m_uniforms.envMapIntensity.value = scene.environmentIntensity;
//     }
//
// runs on EVERY draw, and `SkyIbl.ts:133` sets `scene.environment`. So
// `material.envMapIntensity` on `OF_Canopy` is written by
// `CanopySelfShadow.canopyEnvOverride` and erased before the triangle is drawn.
// RN-2590 swept it sixteen-fold, measured the `crowns` rectangle moving by
// exactly 0.000000, and concluded the environment contributes nothing; the
// control that settled it (`?ibldiag=noenv`, which removes the environment
// outright) moves the same rectangle **-37.48 per cent**. That is the trap in
// `docs/web/NUMBERS.md` under "a readback proves the query parsed".
//
// **THE ESCAPE IS ONE LINE: GIVE THE MATERIAL ITS OWN `envMap`.** The branch
// above is predicated on `material.envMap === null`. Assign the SAME texture
// `scene.environment` holds and the branch stops firing, the material's own
// scalar survives to the draw, and nothing else about the frame changes:
//
//   * NO NEW TEXTURE AND NO NEW MEMORY. It is the same PMREM object, assigned
//     by reference every frame from the scene the IBL just wrote.
//   * NO PROGRAM CHANGE. `WebGLRenderer` resolves `material.envMap ||
//     environment` (line 2344) and compares the RESULT against
//     `materialProperties.envMap`; with the same object on both sides the
//     comparison is equal and `needsProgramChange` stays false. `USE_ENVMAP`
//     was already defined, because `scene.environment` already defined it.
//   * IT IS RE-ASSIGNED PER FRAME because `SkyIbl` builds a NEW texture on each
//     refresh (240 frames, or an elevation or biome change). A stale assignment
//     would pin the crown to a sky from four seconds ago, which is the class of
//     defect `docs/web/NUMBERS.md` files under "a value derived from an object
//     that stops being updated reads as this frame's answer".
//
// **AND IT COSTS ONE THING THAT MUST BE PAID BACK EXPLICITLY, found by reading
// the renderer rather than by measuring:** the branch it escapes is also how
// `Headlamp.ts:401` dims every stock material's ambient underground
// (`this.near.environmentIntensity = lerp(CAVE_ENV, 1, k)`). A material with an
// own `envMap` stops tracking that global, so a crown card in a cave would stay
// lit by a sky it cannot see. The write below therefore multiplies the derived
// factor BY the scene's own live `environmentIntensity`, so the crown follows
// the cave ramp as it did and the lane's change is a strict scaling of what was
// there.
//
// **THAT COMPENSATION IS CORRECT BY READING AND IS NOT MEASURED, AND THE
// DIFFERENCE MATTERS ENOUGH TO SAY SO** (a fresh-context verifier's point).
// `sceneIntensity` reads exactly 1.0000 on every arm of every pose this project
// owns, because **there is no cave pose**: `Headlamp`'s ramp is driven by an
// occlusion the committed shot list never puts the observer under. So the
// readback below proves the multiply HAPPENS and cannot prove it is RIGHT, and
// the first frame that exercises it will be the first test of it. Two honest
// limits go with that:
//
//  1. **IT LAGS BY ONE FRAME.** `updateCanopyCardShade` runs at `Systems.ts:352`
//     and `headlamp.update` at `Systems.ts:373`, so the value read here is the
//     PREVIOUS frame's. On a ramp that moves over a walk into a cave that is
//     invisible; on a hard cut it would be one frame of a stale sky. Cheap to
//     fix by moving the call below the headlamp, and deliberately not moved
//     here, because reordering `Systems`'s update sequence is a change with a
//     blast radius this lane cannot measure.
//  2. **`rn2647untouched`'s OFF ARM DOES NOT COVER IT.** That probe's pair is
//     `?crownenv=off` against the shipped default, which isolates the ENV half
//     of this lane and says nothing about the card floor or about the cave
//     ramp. It is a scope test, not a coverage test.
//
// ---------------------------------------------------------------------------
// 2. THE SCALAR, DERIVED, AND IT IS THE SAME NUMBER `CROWN_SELF_FLOOR` GUESSED
// ---------------------------------------------------------------------------
// The crown card is a whole-crown impostor standing inside a stand, and three
// lights its environment term as though it were a lone plane in the open: the
// full hemisphere, unoccluded. It is not. A crown surface at the mean depth of
// its own stand sees the fraction of the sky its neighbours leave it, and that
// fraction is `CrownSkyView.crownSkyView(tau)`, the cosine-weighted mean over
// the hemisphere of the SAME beam transmittance `CanopySelfShadow`'s law takes
// along the sun ray. `tau = K * mu` is the same optical depth, from the same
// two constants, through the same `residentCanopyMu()`.
//
//     Forest  mu 0.6881  tau 2.2019  skyView 0.2849   (forestair*, read live)
//     Hills                          skyView 0.5068   (flyover*,   read live)
//
// **THOSE ARE READBACKS AND NOT CONSTANTS, and the first draft of this block got
// them wrong by retyping** (a fresh-context verifier's catch). It quoted
// 0.6918 / 2.2138 / 0.2821 and 0.5063, hand-computed off rendering.md 2.38.1's
// published `mu`, against what this file itself computes. The correction is the
// general point rather than the digits: `mu` is `residentCanopyMu()`, a
// canopy-area-weighted mean over the RESIDENT chunk set, so it moves with what
// has streamed in and these values wobble by about 0.15 per cent between runs of
// the same build. **Read them off `treeline().crownEnv`; never retype them, and
// never quote them to four decimals as though they were authored.**
//
// **`CROWN_SELF_FLOOR`'S OWN DERIVATION ALREADY NEEDED THIS NUMBER AND GUESSED
// IT.** That block ends "a canopy interior does not see the whole sky, and half
// of it is the honest reduction, so 0.08 is that share times a canopy sky-view
// factor of about 0.55". The derived value at the Hills stand is 0.507. The
// guess was good; it is now a derivation, and it is used HERE on the term it is
// literally about -- the sky -- rather than only inside an authored constant.
//
// WHY IT IS NOT GIVEN A FLOOR OF ITS OWN, and this is the one place the two
// handles of this lane could have double-counted. A crown surface deep in a
// stand is also lit by light that has scattered off its neighbours. That light
// is real and it is ALREADY IN THE MODEL: it is exactly what `CROWN_SELF_FLOOR`
// is, on the albedo side. Adding it again here would be the same photon
// counted twice, and it would be counted in the wrong place: the environment
// map is the SKY's radiance, and neighbour-scattered light is leaf-green and
// diffuse, not a sky reflection. So this factor is the sky-view factor bare.
//
// ---------------------------------------------------------------------------
// 3. THE ONE OVERLAP THIS TERM DOES HAVE, STATED AND MEASURED RATHER THAN
//    ARGUED AWAY
// ---------------------------------------------------------------------------
// `envMapIntensity` scales the environment's DIFFUSE irradiance as well as its
// specular. The diffuse half is multiplied by the albedo, which already carries
// the shade law's `S`, so that half is occluded twice: once by a sun-path
// factor it should not have taken at all, and once by the sky-view factor it
// should. The right fix is out of this lane's reach (the shade law is applied
// to the ALBEDO because a stock `MeshStandardMaterial` in three r185 exposes no
// shadow factor to a splice -- `CanopySelfShadow`'s own header), so the size of
// the error is MEASURED instead: `?propspec=0` deletes the specular, and the
// residual move of `D` between `?crownenv=1` and the shipped arm is the whole
// of the double count. rendering.md 2.43 carries the number.
//
// ---------------------------------------------------------------------------
// 4. FOUR STATES (RN-952, and `?propsky=`'s design: a VALUE control and a COST
//    control are different arms)
// ---------------------------------------------------------------------------
//   `?crownenv=off`  the own-`envMap` is NOT installed. The pre-RN-2645
//                    material state, back inside the renderer's overwrite
//                    branch. The arm the COST is measured against.
//   `?crownenv=1`    installed, intensity forced to 1 x the scene's own. Same
//                    material configuration, one scalar apart from shipped,
//                    and it must reproduce `off` TO THE DIGIT -- which is the
//                    proof that installing an own `envMap` is not itself a look
//                    change.
//   `?crownenv=0`    installed, intensity 0. The DELETING control: it must move
//                    the `crowns` rectangle, and by how much is the authority
//                    ceiling of this handle.
//   `?crownenv=`     absent: SHIPPED, the derived `crownSkyView(tau)`.
//   `?crownenv=<x>`  any 0..4, for the sweep.
//
// **AND EVERY ONE OF THOSE ARMS ALSO CARRIES A CARD FLOOR, WHICH IS A SECOND
// FLAG AND HAS TO BE WRITTEN DOWN OR THE ROW IS MISLABELLED.** `?crownenv=0`
// alone is the environment deleted with the card floor at its SHIPPED 0.137;
// `?crownenv=0&crowncardfloor=0.08` is the environment deleted with the card
// floor at its PRE-LANE value, which is the arm that isolates this handle from
// the other one; `?crownenv=0&crowncardfloor=0` is both handles at their floor
// and is the JOINT ceiling. Those are three different frames and a fresh-context
// verifier found rendering.md quoting one of them under the label of another.
// Any table that names one flag when two moved is wrong.
//
// The scope is one material and it is published rather than asserted:
// `treeline().crownEnv.materials` reads `["props:OF_Canopy:canopy"]` and
// nothing else. `OF_Canopy` is authored at `_LOD3` alone (RN-2247) and
// `PropLibrary.batchFor` clones one shared material per batch key, so this
// reaches every far crown card and CANNOT reach a near tree, an understorey
// batch, the avatar or the terrain -- the terrain has no `envMap` at all and
// reads its sky ambient from the scattering integral per fragment.

import type * as THREE from 'three';
import { crownSkyView } from './CrownSkyView.js';

/**
 * RN-150-safe, and `Number(null)` is 0 while 0 is a MEANINGFUL setting here, so
 * the states are read off the raw string. An unparseable or out-of-range ask
 * returns the SHIPPED behaviour rather than a silent clamp, which is RN-2268's
 * scar: a clamped ask reports the clamp and the table then describes the clamp
 * as the request.
 */
const RAW = new URLSearchParams(self.location.search).get('crownenv');

/** `?crownenv=off` leaves the material exactly as RN-2605 left it. */
export const CROWN_ENV_INSTALLED = RAW !== 'off';

/** The forced intensity, or `null` for the derived sky-view factor. */
const FORCED: number | null = ((): number | null => {
  if (RAW === null || RAW === 'off') return null;
  const v = Number(RAW);
  return Number.isFinite(v) && v >= 0 && v <= 4 ? v : null;
})();

const mats: { tag: string; m: THREE.MeshStandardMaterial }[] = [];

/** The live state, for the readback. Every field is what the LAST frame
 *  actually wrote, never what a query asked for. */
const live = {
  tau: 0, skyView: 1, sceneIntensity: 1, applied: 1, ownEnv: false,
  sameTexture: false, writes: 0,
};

/**
 * Registered from `SurfaceBind.apply`, which is the one place the `canopy`
 * family's material is reachable and the same statement group
 * `publishCanopyCardBase` already sits in.
 *
 * DEDUPED BY MATERIAL IDENTITY, because `apply` re-runs on a late texture load
 * and a list that grew each time would report a scope leak that is not there
 * and would write the same scalar twice a frame.
 */
export function noteCrownEnvMaterial(m: THREE.MeshStandardMaterial, tag: string): void {
  if (mats.some((e) => e.m === m)) return;
  mats.push({ tag, m });
}

/**
 * Per frame, from `updateCanopyCardShade`, which already holds `mu` and `K` and
 * is already called from `Systems` one line after `SkyIbl.update`, so the
 * texture read here is the one this frame's IBL just wrote.
 *
 * `env` is `scene.environment` and `sceneIntensity` is
 * `scene.environmentIntensity`; both come from the NEAR scene, which is the one
 * the crown batches are in.
 */
export function updateCrownEnv(
  env: THREE.Texture | null, sceneIntensity: number, tau: number,
): void {
  const sv = crownSkyView(tau);
  const applied = sceneIntensity * (FORCED ?? sv);
  live.tau = tau;
  live.skyView = sv;
  live.sceneIntensity = sceneIntensity;
  live.applied = applied;
  if (!CROWN_ENV_INSTALLED || mats.length === 0) {
    live.ownEnv = false; live.sameTexture = false;
    return;
  }
  for (const { m } of mats) {
    // ASSIGNED EVERY FRAME rather than once: `SkyIbl` builds a new PMREM on
    // each refresh and assigns it to `scene.environment`, so a one-shot
    // assignment here would pin the crown to a stale sky.
    m.envMap = env;
    m.envMapIntensity = applied;
  }
  live.ownEnv = mats[0].m.envMap !== null;
  live.sameTexture = mats[0].m.envMap === env;
  live.writes++;
}

/**
 * THE READBACK, AND `appliedLive` IS AN OUTCOME READ RATHER THAN A REQUEST ONE.
 *
 * RN-2590's whole defect was that the request arrived and the renderer erased
 * it before the draw, so the only reading worth having is one taken where the
 * erasure would show. `appliedLive` is `material.envMapIntensity` read at PROBE
 * TIME, which is after the last frame's DRAW: if this material were still in
 * `WebGLRenderer.js:2694-2696`'s branch the renderer would have overwritten it
 * with `scene.environmentIntensity` and `appliedLive` would read that instead
 * of `applied`. The two disagreeing IS the dead switch, visible.
 *
 * `ownEnvMap` and `sameTexture` say why it survived, `writes` says the updater
 * ran at all (zero with an installed term is the vacuous green), and
 * `materials` is the scope claim.
 *
 * NONE OF THEM IS SUFFICIENT ON ITS OWN and the arm that settles it is
 * `?crownenv=0` against the shipped default MOVING the `crowns` rectangle. An
 * EXACT zero there would be the signature of a write that never arrived, which
 * is the third of RN-2590's three rules.
 */
export function crownEnvState(): {
  raw: string | null; installed: boolean; forced: number | null;
  tau: number; skyView: number; sceneIntensity: number;
  applied: number; appliedLive: number | null;
  ownEnvMap: boolean; sameTexture: boolean; writes: number; materials: string[];
} {
  return {
    raw: RAW, installed: CROWN_ENV_INSTALLED, forced: FORCED,
    tau: live.tau, skyView: live.skyView, sceneIntensity: live.sceneIntensity,
    applied: live.applied,
    appliedLive: mats.length > 0 ? mats[0].m.envMapIntensity : null,
    ownEnvMap: live.ownEnv, sameTexture: live.sameTexture,
    writes: live.writes, materials: mats.map((e) => e.tag),
  };
}
