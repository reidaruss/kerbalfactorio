// THE MINERAL'S OWN RESPONSE, ON THE HARVEST NODE BATCHES. One shared
// `onBeforeCompile` whose entire body is `injectPartMat`, so the per-part
// roughness and metalness that `NodeBatch`'s merge throws away reach a pixel.
// This file INHERITS RN-491 to RN-498. It writes no GLSL, declares no
// material and adds no uniform.
//
// WHAT WAS WRONG, IN NUMBERS. `NodeBatch.makeBatch` builds ONE
// MeshStandardMaterial per `<family>:<shading>` bucket and its whole material
// response is two literals in a ternary:
//
//     metalness: ore ? 0.25 : metal ? 1.0 : 0.0
//     roughness: ore ? 0.72 : metal ? 0.38 : 0.88
//
// `normalize()` bakes each source material's COLOUR into a vertex attribute
// and drops everything else, which is the same merge limit RN-455 wrote down
// for the creature. So `OF_IronOre` (authored 0.55 / 0.25), `OF_CopperOre`
// (0.50 / 0.30) and `OF_CoalSeam` (0.30 / 0.10) all draw at exactly
// 0.72 / 0.25, and every host rock role (`OF_Rock` 0.90, `OF_RockDark` 0.92)
// draws at 0.88 / 0.0. FOUR MINERALS HAVE TWO MATERIAL RESPONSES BETWEEN
// THEM, and both of them are constants in this client rather than anything
// the asset authored.
//
// of_lib's PALETTE says the cost out loud in its own comment on CoalSeam:
// "near-black at LOW roughness: the vitreous glint is the entire
// coal-not-dark-rock signal". 0.72 is not low. That glint was authored,
// exported into the .glb, carried through the loader, and then discarded one
// line before it could be seen, which made every future per-mineral authoring
// decision unreachable rather than merely unused.
//
// WHY A NEW HOOK, AGAINST THE DW-10 LEDGER RATHER THAN AROUND IT. The ledger
// stands at 4 ShaderMaterial + 3 live `onBeforeCompile` (MachineBatch,
// PropWind, FurShader) against DW-10's cap of 5 custom shaders; this takes it
// to 4 + 4 with the flag on, and back to 4 + 3 with `?rockmat=0`. The spider
// paid nothing for the same channel because FurShader's hook already existed
// on the one material the creature draws with, and RN-491 spliced into it.
// The node path has NO existing hook to splice into: `PropWind.applyWind` is
// installed only on the `leaf:` and `grass:` batches, and it is deliberately
// not on the mineral ones, because a swaying boulder is the exact wrong-sway
// failure RN-181 removed. So the choice here is one new hook or no channel,
// and the argument for spending it is ART-DIRECTION.md's: the ledger is a
// budget with an argument attached, and what this buys is every per-mineral
// number in PALETTE becoming reachable at once, for four roles today and for
// every role a future node .glb picks, with no per-asset branch anywhere.
//
// NAMED FAILURE MODES, BEFORE ANY MEASUREMENT (INSTRUMENTS.md):
//
//   (a) THE ANCHOR MISSES AND THE INJECTION IS A SILENT NO-OP. `String.replace`
//       with an absent needle returns the string unchanged and reports
//       nothing, so every node would draw exactly as it does today. That is
//       indistinguishable from "the pass did nothing", which is the worst
//       signature a change can have. `injectPartMat` counts its replacements
//       against a named anchor list and publishes the misses in
//       `partMatState().missing`, so "no change" and "no effect" can be told
//       apart without a screenshot. Nothing here is allowed to swallow that.
//   (b) THE BAKE HAPPENS WITH NO CONSUMING HOOK AND COSTS A DEAD BUFFER.
//       `PartMaterial` does not know which hook reads its attribute, so the
//       CALLER is the only place that knows whether one will compile. Baking
//       with `?rockmat=0`, or baking for a `leaf:` batch that this file never
//       hooks, writes a per-vertex buffer that no program binds and quietly
//       breaks the bit-exactness claim `?rockmat=0` exists to make. The gate
//       and the hook must therefore be the SAME predicate, which is why
//       `NodeBatch` asks this module rather than re-deriving the answer.
//   (c) THE SHARED-HOOK RULE IS BROKEN AND THE PROGRAM COUNT DOUBLES. Three
//       stringifies `onBeforeCompile` into the program cache key, so a
//       per-material closure (`m.onBeforeCompile = (s) => inject(s)`) forks a
//       program per batch even though every one of them compiles identical
//       source. That is silent: it costs compile time and program memory and
//       looks perfectly correct on screen. ONE module-scope function object is
//       assigned to every material that takes it, exactly as PropWind and
//       FurShader do.
//
// THE FLAG. `?rockmat=0` removes the hook ENTIRELY rather than zeroing
// anything, so the batch materials compile the stock three program and the
// build is bit-exact with the one before this file existed. That is both the
// negative control and the performance isolator; a zeroed amplitude would be
// neither. `?partmat=0` is the finer isolator inherited from PartMaterial: the
// hook is still installed but injects nothing, which separates "this hook
// costs something" from "this channel changes something".
//
// The DEFAULT is published as its own fixture (`flagPresent`) rather than
// being inferred from `enabled`, which is RN-150 and which this codebase has
// been bitten by twice: `Number(null)` is 0, so a probe that always passes an
// explicit flag never exercises the shipped default at all.

import type * as THREE from 'three';
import { injectPartMat } from './PartMaterial.js';

const raw = new URLSearchParams(self.location.search).get('rockmat');
/** Whether the parameter was present AT ALL, so the shipped boot default is
 *  assertable in its own right and not read back off `enabled` (RN-150). */
const flagPresent = raw !== null;
const enabled = raw !== '0';

const hooked: string[] = [];

/**
 * THE ONE SHARED FUNCTION OBJECT. Failure mode (c) above is the whole reason
 * this is a named module-scope declaration and not a closure built per
 * material: three's program cache key stringifies `onBeforeCompile`, so one
 * object keeps every hooked batch on one program.
 *
 * Its entire body is the inherited injection. Anything this file added of its
 * own would be a second authority on mineral response, which is exactly the
 * shape the merge already got wrong once.
 */
function hook(shader: { vertexShader: string; fragmentShader: string }): void {
  injectPartMat(shader);
}

/** Whether the hook will be installed at all. The BAKE GATE reads this too:
 *  see failure mode (b), the caller is the only place that can know. */
export function rockMatEnabled(): boolean { return enabled; }

/**
 * Install the shared hook on one node batch material.
 *
 * The caller does not need to check the return: with `?rockmat=0` this is a
 * no-op and the material keeps its stock program. `needsUpdate` is set on
 * PropWind's and FurShader's precedent, because a material that has already
 * compiled would otherwise keep its old program.
 */
export function applyRockMat(mat: THREE.MeshStandardMaterial,
                             label: string): void {
  if (!enabled) return;
  mat.onBeforeCompile = hook;
  mat.needsUpdate = true;
  hooked.push(label);
}

export function rockMatState(): {
  enabled: boolean; flagPresent: boolean; hooked: string[];
} {
  return { enabled, flagPresent, hooked: [...hooked] };
}

// THE HANDLE, AND IT IS REGISTERED HERE FOR RN-514'S REASON. `furStats()` was
// published on the flock and wired to nothing, so no probe could read one
// field of it: "a tool that reports nothing may not be running", except the
// tool had never been started. `hooked` is the positive statement that the
// install matched some materials rather than none, which is the difference
// between a measurement over this pass and a measurement over an effect that
// never ran. It costs no program, no draw call and no uniform.
(self as unknown as Record<string, unknown>).__ofRockMat = {
  state: (): unknown => rockMatState(),
};
