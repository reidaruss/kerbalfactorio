// THE MACHINE'S OWN RESPONSE, ON THE ONE BATCH THE WHOLE FACTORY DRAWS WITH.
// RN-1200 to RN-1206. This file INHERITS RN-491 to RN-498 (the channel) and
// RN-731 (the same fix on the node batches): it writes no GLSL, declares no
// material, adds no uniform and installs NO `onBeforeCompile`.
//
// IT COSTS THE DW-10 LEDGER NOTHING, and that is the difference from
// `RockShader`. `MachineBatch` has owned a hook since DW-8, so the channel
// splices into an existing program exactly the way `FurShader` took it on the
// creature. The ledger stays where RN-731 left it.
//
// WHAT WAS WRONG, IN NUMBERS. `MachineBatch.makeMaterial` builds ONE
// MeshStandardMaterial for the factory, the structures, the launch pad, the
// belt cargo and the space station, and its entire material response was two
// literals: `metalness: 0.45, roughness: 0.55`. `MachineGeometry.normalize`
// bakes each source material's COLOUR into a vertex attribute and drops
// everything else, which is the merge limit RN-455 wrote down for the creature
// and RN-731 fixed for the rock. So every per-role number in every machine
// .glb was discarded at load:
//
//     role      authored metal / rough      drawn before this
//     Steel        0.85 / 0.45                 0.45 / 0.55
//     SteelDark    0.85 / 0.55                 0.45 / 0.55
//     Accent       0.00 / 0.50                 0.45 / 0.55
//     Hazard       0.00 / 0.60                 0.45 / 0.55
//     Rubber       0.00 / 0.85                 0.45 / 0.55
//     Rock         0.00 / 0.94                 0.45 / 0.55
//     Glass        0.00 / 0.05                 0.45 / 0.55
//     Plate        0.70 / 0.42                 0.45 / 0.55
//
// THE TWO PAINT ROLES ARE THE POINT AND THEY ARE THE MAJORITY OF THE COLOUR.
// `Accent` and `Hazard` are PAINT, authored dielectric at metalness 0.00, and
// they drew at 0.45: nearly half metal. An asset lane measured `panel`'s ORM
// green running 57..255, so the effective roughness was 0.55 x that = 0.123 to
// 0.55, and roughness 0.12 at metalness 0.43 IS POLISHED METAL. That pairing is
// the "glossy near-black plastic with chrome rivets" read on the factory, and
// no amount of re-authored COLOUR can answer it, because the defect is not in
// the channel colour lives in. Re-authoring colour to compensate is the
// boulder-albedo mistake ART-DIRECTION.md exists to prevent, at machine scale.
//
// THE THREE MODES, AND WHY THE MIDDLE ONE EXISTS.
//
//   ?machinemat=0      OFF. Nothing is baked and nothing is injected, so the
//                      batch compiles the program it compiled before this pass
//                      and carries no extra per-vertex buffer. Bit-exact rather
//                      than similar, which is what makes it a control.
//   ?machinemat=flat   THE POSITIVE CONTROL. Every part is baked at the
//                      batch's OWN base, so the injected GLSL evaluates
//                      `roughnessFactor * (0.55 / 0.55)`: an IDENTITY. The
//                      attribute is written, the program is recompiled, the
//                      varying is interpolated and the divide runs. A frame
//                      identical to `=0` therefore proves THE WHOLE PATH RAN,
//                      and any difference under the shipped default is
//                      attributable to THE AUTHORED TABLE rather than to the
//                      plumbing. NUMBERS.md: a control whose arming step
//                      silently fails is indistinguishable from a passing
//                      control, so the arming step here is the subject itself.
//   (absent) / =1      ON. The shipped default, published as its own fixture.
//
//   ?machinebare=0     The SECOND half, isolable on its own (standing rule 7).
//                      See `bareForRole` below.
//
// NAMED FAILURE MODES, BEFORE ANY MEASUREMENT (INSTRUMENTS.md):
//
//   (a) THE ANCHOR MISSES AND THE INJECTION IS A SILENT NO-OP. `String.replace`
//       with an absent needle returns the string unchanged and reports nothing,
//       so every machine would draw exactly as it does today, which is
//       indistinguishable from "the pass did nothing". `injectPartMat` counts
//       replacements against a named anchor list and publishes the misses in
//       `partMatState().missing`; nothing here swallows that. The FRAME-level
//       signature is `=1` matching `=0` while `=flat` ALSO matches `=0`, and
//       naming it in advance is what makes that pair of nulls readable instead
//       of reassuring.
//   (b) THE BAKE HAPPENS WITH NO CONSUMING HOOK AND COSTS A DEAD BUFFER. The
//       gate and the injection must be ONE predicate. `MachineGeometry` and
//       `MachineBatch` both ask this module rather than re-deriving it, so the
//       attribute is written exactly when a program that reads it compiles, and
//       `?machinemat=0` carries no orphaned per-vertex buffer.
//   (c) THE BASE BECOMES A SECOND AUTHORITY. See `assertMachineBase`.
//   (d) THE FLAT MODE IS NOT ACTUALLY AN IDENTITY. It is one only while no
//       machine role is authored `of_bare`, because bare drops the family maps
//       as well as the level. `of_lib.BARE_ROLES` is `{"Fang"}` today, which is
//       spider-only, and `machineMatState().bare` reports the count so the
//       claim is measured rather than remembered. If a machine role is ever
//       made bare, `=flat` stops matching `=0` and that is the control doing
//       its job rather than a regression.

import * as THREE from 'three';
import { bakePartMat, partMatEnabled, partMatState } from './PartMaterial.js';
import { familyForRole } from '../instancing/Surfaces.js';

/**
 * THE BASE THE PER-PART ATTRIBUTE DIVIDES AGAINST, and the batch's fallback
 * response when the channel is off. It must equal the literals
 * `MachineBatch.makeMaterial` constructs with; `assertMachineBase` is what
 * makes that a check rather than a hope.
 */
export const MACHINE_BASE_ROUGHNESS = 0.55;
export const MACHINE_BASE_METALNESS = 0.45;

/**
 * FAILURE MODE (c), AND THE REASON THIS IS AN ASSERT RATHER THAN AN IMPORT.
 *
 * The obvious design is for `MachineBatch` to construct with these constants,
 * so there is one authority and the flat mode's identity is structural. That
 * design breaks an instrument in ANOTHER LANE'S TREE.
 * `tools/blender/render_machines.py:326` regex-matches
 * `new THREE.MeshStandardMaterial({...})` in `MachineBatch.ts` and reads
 * `roughness:` and `metalness:` as NUMERIC LITERALS, raising `SystemExit` if
 * either is missing, precisely so the studio rig cannot guess a client
 * constant. Replacing the literals with identifiers would hard-fail every
 * machine render the asset lane takes, on the same day this pass exists to
 * unblock them.
 *
 * So the literals stay literal and this asserts the equality at boot instead.
 * NUMBERS.md's rule for a relationship between two authored values is "derive
 * one from the other OR assert it in the build"; the first option is closed by
 * a consumer outside this repo's type system, so this is the second. The
 * refusing case is reachable: change either literal and the client throws at
 * boot naming both files.
 */
export function assertMachineBase(mat: THREE.MeshStandardMaterial): void {
  if (mat.roughness !== MACHINE_BASE_ROUGHNESS
    || mat.metalness !== MACHINE_BASE_METALNESS) {
    throw new Error(
      `${mat.name}: the machine batch's base is ${mat.roughness}/${mat.metalness}`
      + ` but MachineMat.ts says ${MACHINE_BASE_ROUGHNESS}/${MACHINE_BASE_METALNESS}.`
      + ' The per-part channel divides by this base and the flat-mode control'
      + ' bakes it, so a disagreement silently rescales every machine role.'
      + ' Keep them literals: tools/blender/render_machines.py parses them.');
  }
  // Non-zero is what makes the ratio carry at all, and a zero denominator is a
  // TOTAL and silent loss of the channel rather than a visible one.
  if (!(mat.roughness > 0) || !(mat.metalness > 0)) {
    throw new Error(`${mat.name}: the merged base roughness/metalness must both`
      + ' be > 0 for the per-part channel to carry');
  }
}

const params = new URLSearchParams(self.location.search);
const raw = params.get('machinemat');
/** Whether the parameter was present AT ALL, so the shipped boot default is
 *  assertable in its own right and not read back off `enabled` (RN-150). */
const flagPresent = raw !== null;
const mode: 'off' | 'flat' | 'on' = raw === '0' ? 'off'
  : raw === 'flat' ? 'flat' : 'on';

const bareRaw = params.get('machinebare');
const bareFlagPresent = bareRaw !== null;
const bareOn = bareRaw !== '0';

/**
 * Whether the channel is LIVE, asked once at module load from BOTH flags.
 *
 * `?partmat=0` leaves this module's own answer alone but makes `bakePartMat`
 * and `injectPartMat` no-ops, so in that state nothing divides the base back
 * out and the base must stay at its literal value. Folding it in here is what
 * stops the bake gate and the injection gate disagreeing about it mid-build,
 * which is `RockShader` failure mode (b).
 */
const enabled = mode !== 'off' && partMatEnabled();

export function machineMatEnabled(): boolean { return enabled; }

/**
 * THE SECOND DEFECT, AND THIS IS THE HALF OF IT THAT COSTS NOTHING.
 *
 * `MachineBatch` CALLED `attachSurface(m, 'panel', ...)` UNCONDITIONALLY, so a
 * machine's authored role never reached `familyForRole` and every part wore
 * `panel`, which encodes MANUFACTURE OUT OF PLATE: seams, rivet rows, a weld
 * bead. The smelter's `Rock` hearth, the launch pad's `RockDark` trench and
 * every belt deck's `Rubber` therefore wore rivets they should not.
 *
 * THE GENERAL FIX IS NOT ONE EXTRA FETCH, and measuring the assets is what
 * said so. `MachineBatch.ts`'s own comment proposed "option (b): select per
 * family off aRole for one extra fetch", which was true of the two roles that
 * comment had in mind. The shipped machine, structure, pad, station and item
 * assets between them authorise **six** non-`panel` families: `coarse`
 * (Rubber, Iron, Coal, Copper), `stone` (Rock, RockDark), `suitplate` (the
 * station deck's Plate), `bark`, `leaf` and `flat`. Carrying all of them is
 * five extra tiling surfaces and ten extra samplers on the one material the
 * whole factory draws with, which is a real piece of work and was NOT this.
 *
 * IT LANDED AS RN-1478 (2026-08-13) AND NOT AS OPTION (b): the sampler budget
 * refuses one material carrying every family (`MAX_TEXTURE_IMAGE_UNITS` is 16
 * on the real D3D11 path and one machine program already spends 9 of them), so
 * the batch now builds one `BatchedMesh` PER FAMILY, each with its own ordinary
 * `attachSurface`. `leaf` alone stays folded into `panel`, structurally rather
 * than as an omission: it is a unit-UV card family and this path's UVs are
 * metres. What follows is untouched by that and still load bearing, because
 * `flat` is not a family any layer can wear.
 *
 * WHAT IS DONE HERE IS THE `flat` FAMILY, AND ONLY IT, BECAUSE `flat` IS NOT A
 * MAP. `Surfaces.ts` says it out loud: "`flat` is not a third texture set. It
 * is the recorded decision NOT to map a role, one reason per entry in the
 * manifest's `flat_roles`." So a machine part authored `Glass` or
 * `EmissiveState` is a part the texture pass DECIDED must carry no map, and
 * `panel` is overriding that decision. `PartMaterial`'s `bare` flag means
 * exactly "this part is not a member of the family": it drops the family
 * normal, its ORM variation and its AO, and takes the authored colour and
 * level flat. For a `flat` role that is not a loss of detail, because there
 * was never a map to lose; it is the recorded decision finally reaching a
 * pixel. A chest's sight window and the station's viewports stop wearing rivet
 * rows, and the status chips stop wearing them under the emissive.
 *
 * IT DELIBERATELY DOES NOT BARE THE OTHERS. Making `Rock` and `Rubber` bare
 * would remove the wrong map and leave nothing, and the smelter hearth, the
 * foundation body and the launch pad's blast slab are large areas. Under
 * ART-DIRECTION.md a large flat region that resolves into nothing is itself a
 * defect, so trading a wrong texture for no texture is not obviously a gain and
 * must be measured against the real families rather than assumed. That work is
 * named in the report rather than smuggled in here.
 *
 * NO SECOND TABLE. The rule reads `familyForRole(role) === 'flat'` straight off
 * `Surfaces.ts`, which is already the one authority on role-to-family, and
 * which already checks itself against the shipped `surfaces.json`.
 */
function bareForRole(role: string): boolean {
  return bareOn && familyForRole(role) === 'flat';
}

/**
 * The stand-in baked in flat mode: the batch's own base, no `of_bare`.
 *
 * ONE shared object, because by definition it carries no per-part information.
 * `bakePartMat` reads only `roughness`, `metalness` and `userData.of_bare`, so
 * a bare `MeshStandardMaterial` at the base IS the identity input.
 */
const FLAT = new THREE.MeshStandardMaterial({
  roughness: MACHINE_BASE_ROUGHNESS, metalness: MACHINE_BASE_METALNESS,
});
FLAT.name = 'machines:flatControl';

const baked: string[] = [];
let bareCount = 0;

/**
 * Write one machine primitive's authored response into the per-vertex channel.
 *
 * Called from `MachineGeometry.normalize`, beside the colour bake that has
 * always been there. `label` carries the ROLE rather than the material object,
 * so `partMatState().wrote` reads as a per-role table: in flat mode every row
 * is the base BY DESIGN, and that is the control's own evidence that it was
 * armed rather than skipped.
 */
export function bakeMachineMat(g: THREE.BufferGeometry, count: number,
                               src: THREE.MeshStandardMaterial,
                               role: string): void {
  if (!enabled) return;
  const bare = mode === 'flat' ? false : bareForRole(role);
  bakePartMat(g, count, mode === 'flat' ? FLAT : src, `machines:${role}`, bare);
  baked.push(role);
  if (bare) bareCount++;
}

export function machineMatState(): {
  enabled: boolean; flagPresent: boolean; mode: string;
  bareOn: boolean; bareFlagPresent: boolean; bare: number;
  baseRoughness: number; baseMetalness: number;
  baked: number; roles: string[];
} {
  return {
    enabled, flagPresent, mode, bareOn, bareFlagPresent, bare: bareCount,
    baseRoughness: MACHINE_BASE_ROUGHNESS,
    baseMetalness: MACHINE_BASE_METALNESS,
    baked: baked.length,
    roles: [...new Set(baked)].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * The per-ROLE table the channel actually wrote, off `PartMaterial`'s own
 * record rather than off the palette or the .glb.
 *
 * `distinct` is the assertion that matters and it is a PROPERTY, not a
 * magnitude: a per-role channel must produce SEVERAL (roughness, metalness)
 * pairs across the machine roles. One pair means the bake read the merged
 * material instead of the source, which is the exact defect this pass exists to
 * remove, wearing a green light. `machinemat=flat` must report exactly 1, and
 * `machinemat=0` exactly 0, so all three states are told apart by one number.
 */
export function machineMatTable(): {
  rows: { role: string; roughness: number; metalness: number; bare: number;
    verts: number }[];
  distinct: number; injections: number; missing: string[];
} {
  const s = partMatState();
  const rows = s.wrote.filter((w) => w.label.startsWith('machines:'))
    .map((w) => ({ role: w.label.slice('machines:'.length),
      roughness: w.roughness, metalness: w.metalness, bare: w.bare,
      verts: w.verts }));
  const seen = new Set(rows.map((r) => `${r.roughness}/${r.metalness}/${r.bare}`));
  return { rows, distinct: seen.size, injections: s.injections,
    missing: [...s.missing] };
}

// THE HANDLE, on `RockShader`'s precedent and for RN-514's reason: a report
// nothing is wired to cannot tell "the tool found nothing" from "the tool never
// ran". `baked` is the positive statement that the bake matched some primitives
// rather than none, and `table()` is the only reachable read of
// `partMatState()` on this path: `SpiderFlock.partMatStats` needs a flock, so
// without this, failure mode (a) would have no read-out in a machine frame at
// all. It costs no program, no draw call and no uniform.
(self as unknown as Record<string, unknown>).__ofMachineMat = {
  state: (): unknown => machineMatState(),
  table: (): unknown => machineMatTable(),
};
