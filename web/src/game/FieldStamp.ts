// PS-53. WHICH GENERATION OF THE HEIGHT FIELD A BODY'S WORLD WAS AUTHORED
// AGAINST, so a save cannot silently describe a planet that no longer exists.
//
// WHAT WENT WRONG, AND WHY `SAVE_VERSION` IS NOT THE ANSWER. WG-275 added the
// lowland swell to `sampleHeightFieldPlanet` and moved Forge's ground by up to
// 281 m. The ENCODING did not change, so `SAVE_VERSION` was deliberately left
// at 5, and that call was right: the check at `SaveGame.readSlot` is a `!==`
// REFUSAL, so a bump destroys the whole slot including the GLOBAL half (pack,
// research, milestones, vessels, day, station power), which is about no place
// at all and is still exactly correct. But the BODY-SCOPED half is keyed to
// absolute body-frame metres, so every voxel edit, building, structure and pad
// in a pre-swell save now sits buried where the ground rose or floating where
// it fell, a replayed carve into what is now air is a no-op, nothing errors,
// nothing warns, AND THE NEXT AUTOSAVE WRITES THE MISPLACED SET BACK as the
// world's own state, which is what turns a one-time misread into a permanent
// one. PS-40 and PS-49 separated the two halves precisely so a surgical answer
// exists here (world-gen.md 6.14.11 item 7 records the decision and owes it to
// this domain). This file is that answer.
//
// THE STAMP IS A FINGERPRINT OF THE FIELD, NOT A LIST OF THE CONSTANTS, and
// that is the whole design decision. The obvious build is to hash the
// generation constants: the seed, `kLowlandSwellCoef`, `kLowlandSwellFreq`,
// `kLowlandSwellOct`, `kLowlandSwellChan`, the two gate edges, the four octave
// tables above them, the biome relief modulation, the pad and the pond. That
// list is wrong in both directions at once and cannot be made right:
//   * TOO NARROW is the failure that matters. The list has to be maintained by
//     the next person who edits the field, in another domain's file, and the
//     defect this exists to close was created by a lane that had no reason to
//     think about saves at all. A constant added to the stack and not added to
//     the list is the next WG-275, silently.
//   * TOO WIDE is the cheaper failure and still real. Hashing every constant
//     `biome.h` declares invalidates worlds on a change that moves no ground:
//     a renamed channel, a re-derived-but-equal coefficient, a term whose gate
//     is zero on this body.
// Sampling the field itself has neither problem: it enumerates nothing, so it
// cannot miss a constant, and it is blind by construction to anything that does
// not move the ground. It is read through `of_base_height`, which /core
// documents as `sampleDesignedHeight` itself (`surface_field.h`: baseHeight is
// a thin intentional alias so there is ONE surface authority), so the stamp is
// taken from the same function the world is built from rather than from a
// second description of it.
//
// IT IS THE DESIGNED SURFACE AND NEVER THE DEFORMED ONE. `of_base_height` takes
// no edits handle. If this sampled `of_surface_height` the stamp would move
// every time the player dug, which would invalidate the world on every save.
//
// THE SAMPLE SET IS FIXED FOREVER AND MUST NOT BE TIDIED. Changing the
// directions, the count, the quantum or the hash changes every stamp, which
// invalidates every body-scoped world in existence exactly as surely as a
// height-field change does. If a future lane needs a better sample set, it is
// a deliberate one-time invalidation and it belongs in the epoch below with the
// same argument a `SAVE_VERSION` bump needs.
//
// NO TRIG AT RUNTIME, WHICH IS DW-14's RULE AND IT BITES HARDER HERE THAN
// ANYWHERE. Height is position-hashed from the raw bits of the direction, so a
// 1-ULP difference in a sample direction hashes to an unrelated height and the
// stamp would differ between two machines running the same build. The
// directions below are built from `+ - * /` and `sqrt` only, every one of which
// IEEE-754 specifies exactly, so the table is bit-identical on every platform
// without a literal table to transcribe.

import { emptyWorld, slotWithWorld } from './SaveWorlds.js';
import type { SaveSlot } from './SaveGameTypes.js';

/**
 * THE HAND-BUMPED HALF, AND IT IS DELIBERATELY NARROW.
 *
 * The sample set below is quasi-uniform over the whole body, so it sees any
 * change that moves the ground broadly and CANNOT see one confined to a patch
 * smaller than the COVERING RADIUS: about 117 km on Forge, measured over
 * 200,000 random directions as the worst distance from a direction to its
 * nearest sample. This said "about 72 km" until the fresh-context verifier
 * measured it, and 72 km is half the naive sqrt(4*pi*R^2/216) spacing, which is
 * wrong in the UNSAFE direction by between 1.6x and 3x: the blind spot is
 * larger than the first draft claimed, not smaller. The argument survives the
 * correction untouched, because the things it is about are four orders of
 * magnitude below either number. The pad
 * (`homeFlatRadiusM` 300 m), the pond (tens of metres) and a move of `homeDir`
 * itself are all exactly that kind of change, and they are the ones a player's
 * base actually stands on. No uniform sample set reaches them: covering a 600 m
 * disc on a 600 km sphere needs about a million samples.
 *
 * So this integer covers the residue and nothing else, and the criterion lives
 * beside it in the SaveGame.ts:68-76 precedent's own form:
 *
 *   BUMP THIS when a change moves the designed surface in a region SMALLER
 *   than the sample spacing and a player's structures could stand in it: the
 *   home pad's radii or blend, the pond's basin, or `homeDir` / `pondDir`
 *   moving. DO NOT BUMP IT for anything the samples already see, which is
 *   every global term in the height stack, because the mechanical half is
 *   strictly better at that job and a bump there only widens the blast radius.
 *
 * Its honest limit, stated because a discipline nobody states is a discipline
 * nobody keeps: this is the one part of the stamp that depends on somebody
 * remembering, which is why it covers the narrow residue rather than the main
 * case. 1 is the value at introduction and means nothing on its own.
 */
export const FIELD_EPOCH = 1;

/**
 * Samples per cube-face axis. 6 faces x 6 x 6 = 216 directions, which costs
 * about 0.6 ms per save (measured, `wasm/test/fieldstamp.mjs` prints it on every
 * run and read 0.576 ms on the verifier's) and is paid once per 20 s autosave
 * and once per load.
 *
 * The count is chosen against the SMALL-BIOME case rather than the cost case: a
 * term that moves only 5 per cent of the sphere is caught with probability
 * 1 - 0.95^n, which is 94 per cent at 54 samples and 99.99 per cent at 216.
 */
const SAMPLE_K = 6;

/**
 * 216 directions spread over the sphere, arithmetic only.
 *
 * The face mapping does not have to agree with `cubed_sphere.h`'s `unitDir`
 * numbering and deliberately does not claim to: nothing here addresses a face,
 * this is only a fixed well-spread set of unit vectors. Interior lattice points
 * only (`i` from 1 to K), so no sample lands on a face edge or a cube corner
 * where two faces meet and a rounding difference could pick a different one.
 */
function sampleDirs(): Float64Array {
  const out = new Float64Array(6 * SAMPLE_K * SAMPLE_K * 3);
  let n = 0;
  for (let f = 0; f < 6; ++f) {
    for (let i = 1; i <= SAMPLE_K; ++i) {
      for (let j = 1; j <= SAMPLE_K; ++j) {
        const u = -1 + (2 * i) / (SAMPLE_K + 1);
        const v = -1 + (2 * j) / (SAMPLE_K + 1);
        let x = 0, y = 0, z = 0;
        if (f === 0) { x = 1; y = v; z = -u; } else if (f === 1) { x = -1; y = v; z = u; } else if (f === 2) { x = u; y = 1; z = -v; } else if (f === 3) { x = u; y = -1; z = v; } else if (f === 4) { x = u; y = v; z = 1; } else { x = -u; y = v; z = -1; }
        const s = Math.sqrt(x * x + y * y + z * z);
        out[n++] = x / s; out[n++] = y / s; out[n++] = z / s;
      }
    }
  }
  return out;
}

const DIRS = sampleDirs();

/** How many directions the stamp reads. Exported for the fixture, which has to
 *  be able to say how big a sample the claim rests on. */
export const FIELD_SAMPLES = DIRS.length / 3;

/**
 * The quantum, in metres of relief per hashed unit: 1/64 m.
 *
 * COARSE ENOUGH TO BE IMMUNE TO ARITHMETIC NOISE AND FINE ENOUGH TO BE IMMUNE
 * TO NOTHING ELSE. A recompile of the same source with a different optimiser
 * may reassociate double arithmetic, which perturbs a ~1e3 m height by ~1e-13
 * m; quantising at 1.5625e-2 m is ten orders of magnitude clear of that, so a
 * rebuild that changes no source cannot invalidate a world. The residual is a
 * sample sitting exactly on a quantum boundary, which needs a coincidence of
 * about 1e-11 per sample and is named here rather than pretended away. It is
 * still small enough that any real change to the field moves it: the WG-275
 * swell moves 202 of the 216 samples, worst 208.023 m. (That read "45 of 54 by
 * up to 120 m" until this was corrected: those are the numbers of a SAMPLE_K=3
 * draft, left behind when the count went to 216, and a stale measurement beside
 * a live constant is how a comment stops describing the code.)
 */
const QUANTUM = 64;

/**
 * A height that is not a number is a broken build, and it must not hash to the
 * same thing as a flat sea. Counted as well as marked, so `fieldGenReport`
 * can say it happened instead of the stamp quietly being wrong.
 */
const NON_FINITE_MARK = 0x7ff00001;
let lastNonFinite = 0;

/**
 * FNV-1a over the epoch and the quantised samples. FNV-1a because PS-48's
 * `saveHash` already uses it for the discovery stream, so a reader of one
 * recognises the other; nothing here needs a cryptographic hash, only a stable
 * one that changes when its input does.
 *
 * TAKES THE SAMPLER RATHER THAN THE WASM MODULE, which is what makes the whole
 * mechanism testable without a browser and without a planet: the fixture can
 * hand it a synthetic field, move one term of that field, and prove the stamp
 * moves. A function that reached for `of_base_height` itself could only ever be
 * tested against the one field that happens to ship.
 */
export function fieldStampFrom(h: (dx: number, dy: number, dz: number) => number): number {
  let hash = 0x811c9dc5;
  let nonFinite = 0;
  const fold = (byte: number): void => {
    hash ^= byte & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const fold32 = (v: number): void => {
    fold(v & 0xff); fold((v >>> 8) & 0xff); fold((v >>> 16) & 0xff); fold((v >>> 24) & 0xff);
  };
  fold32(FIELD_EPOCH >>> 0);
  fold32(FIELD_SAMPLES >>> 0);
  for (let i = 0; i < DIRS.length; i += 3) {
    const m = h(DIRS[i], DIRS[i + 1], DIRS[i + 2]);
    if (!Number.isFinite(m)) { ++nonFinite; fold32(NON_FINITE_MARK); continue; }
    fold32(Math.round(m * QUANTUM) | 0);
  }
  lastNonFinite = nonFinite;
  return hash >>> 0;
}

/** The one thing this file needs from the WASM module. Typed as the one export
 *  rather than as `OfCoreModule` so nothing here can grow a second dependency
 *  on the heap by accident, and so the fixture can call it with a stub. */
export interface BaseHeightSource {
  _of_base_height(body: number, dx: number, dy: number, dz: number): number;
}

/** The stamp of the field a BODY HANDLE describes. The handle carries the
 *  body's own parameters, so Forge and Cinder stamp independently and a change
 *  gated to one body's stack does not invalidate the other's world. */
export function fieldStampFor(M: BaseHeightSource, bodyHandle: number): number {
  return fieldStampFrom((dx, dy, dz) => M._of_base_height(bodyHandle, dx, dy, dz));
}

export type FieldGenVerdict = 'match' | 'absent' | 'differs';

/**
 * AN ABSENT STAMP IS A MISMATCH, NOT AN UNKNOWN, and this is the migration of
 * the stamp itself.
 *
 * Every slot written before this lane has no `fieldGen`, and treating absence
 * as "assume it is fine" would make the mechanism protect nothing at all: the
 * pre-swell worlds this exists for are exactly the ones with no stamp. So
 * absent lands on the same branch as a difference, and it is reported under its
 * own name so the message and the probe can tell the two apart.
 *
 * WHAT THIS COSTS, SAID PLAINLY: a world saved in the window between WG-275
 * shipping and this landing was authored against the CURRENT field and is
 * cleared anyway, because it carries nothing that could say so. That window is
 * about one day, the alternative (assume absent means current) protects nobody,
 * and the rescue copy taken at the clear keeps the bytes either way.
 */
export function fieldGenVerdict(stored: number | undefined, live: number): FieldGenVerdict {
  if (stored === undefined) return 'absent';
  return stored === live ? 'match' : 'differs';
}

/**
 * The view with its BODY-SCOPED HALF EMPTIED and the global half untouched.
 *
 * Goes through `emptyWorld` and `slotWithWorld` rather than deleting keys,
 * which is PS-40 trap 4: `slotWithWorld` is the one loop that assigns every
 * `WORLD_KEYS` entry including the absent ones as an explicit `undefined`, and
 * a spread would leave the stale value standing. It also means a body-scoped
 * field added next month is cleared by this without this function being edited.
 *
 * The new world carries the LIVE stamp, so what is written back describes the
 * planet that exists.
 */
export function clearedBodyHalf(view: SaveSlot, bodyId: number, live: number): SaveSlot {
  return slotWithWorld(view, { ...emptyWorld(bodyId), fieldGen: live });
}

/**
 * WHAT THE LAST LOAD DECIDED, for the save receipt and for a probe.
 *
 * Module state for `PersistSlot.lastSlotRefusal`'s reason, verbatim: the
 * decision happens before anything is restored, so there is no ledger to hang
 * it on, and DW-20 says a harness must be able to prove its own setup. A probe
 * asserting "the pre-swell world was cleared and the pack was not" needs to see
 * the verdict, not just an absence.
 */
export interface FieldGenNote {
  verdict: FieldGenVerdict;
  /** The body the verdict is about. */
  body: number;
  stored: number | null;
  live: number;
  /** Whether the body-scoped half was emptied on this load. */
  cleared: boolean;
  /** FS-79's key for the copy taken before the clear, '' when none was taken. */
  rescue: string;
  /** Samples that came back non-finite. Never nonzero on a working build. */
  nonFinite: number;
}

let lastNote: FieldGenNote | null = null;

export function noteFieldGen(n: Omit<FieldGenNote, 'nonFinite'>): void {
  lastNote = { ...n, nonFinite: lastNonFinite };
}

export function fieldGenReport(): FieldGenNote | null { return lastNote; }

/** Cleared by the load path before it decides, so a boot that never got as far
 *  as the question cannot report the previous boot's answer. */
export function forgetFieldGen(): void { lastNote = null; }
