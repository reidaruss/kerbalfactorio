// =============================================================================
// StarterContent.ts - WHAT IS LYING AROUND WHERE THE PLAYER STARTS, per body.
//
// GP-268 / R16. Routed here by Admin from the world-gen lane, which landed
// Cinder and found the defect while proving its own work: the starter spiral
// placed 14 trees on an AIRLESS MOON. The streaming fields were correct and
// said so (`trees.live` 0, `rocks.live` 0, 5,984 `biomeZeroCells`); it was
// `NodeField.plan()` returning a fixed 14 trees for every body there is.
//
// IT IS A PROGRESSION BUG AND NOT A TERRAIN ONE, which is why it is here. The
// spiral exists for one reason: a new player must have something to harvest
// within walking distance of where they wake up. Wood is one half of every
// starting tool. That reasoning is entirely about Forge being the SPAWN, and
// nobody noticed it had never been written down as a condition.
//
// TWO MECHANISMS, DELIBERATELY, AND THE SECOND IS THE ONE THAT MATTERS.
//
//  1. A per-body TABLE (data). Forge's is the shipped spiral. Cinder's is
//     EMPTY, and empty is not the same as absent: `STARTER` has a row for
//     Cinder that says what it is for, so moon-specific starter content is a
//     table edit rather than a rewrite. Admin's constraint verbatim: do not
//     hardcode "Cinder has nothing" in a way that makes adding moon resources
//     a rewrite.
//
//  2. An INVARIANT that no table can override: a plant may not be placed on a
//     body with no air. If the table alone were the fix, the next person to
//     fill Cinder's row could put a tree back on the moon and nothing would
//     stop them, and it would look exactly as correct as it does now. So a
//     plant asked for on an airless body is REFUSED AND NAMED, never silently
//     dropped: `refused` is published, and something that is loudly wrong can
//     be fixed while something quietly absent cannot.
//
// The airless test is /core's own `of_atmo_density(bodyId, 0)` and never
// `kind === 'moon'`. A moon with an atmosphere is a thing this project may well
// build, and it would want its trees; what a tree cannot live in is vacuum.
// =============================================================================
import { NODE_KIND } from './GameCore.js';
import { vesselAbi } from '../sim/wasm/vesselabi.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/**
 * GP-286. DOES THIS BODY HAVE AIR. /core's own answer, and now the ONLY copy
 * of the question.
 *
 * It was already the rule here and it was written a SECOND time inline in
 * `Gameplay.reset`, which is how this project has lost an afternoon before: two
 * expressions of one fact, correct together until somebody changes one. Both
 * readers now call this, so a body that grows an atmosphere changes its trees
 * and its tutorial in the same breath.
 *
 * Deliberately NOT `kind === 'moon'`. A moon with an atmosphere is a thing this
 * project may well build and it would want its trees; what a plant cannot live
 * in is vacuum.
 */
export function bodyIsAirless(M: OfCoreModule, bodyId: number): boolean {
  return vesselAbi(M)._of_atmo_density(bodyId, 0) === 0;
}

/** Which node kinds are PLANTS, and therefore need air. Data, so a new plant
 *  kind joins the invariant by being listed rather than by being remembered. */
export const PLANT_KINDS: readonly number[] = [NODE_KIND.Tree];

/** One body's starter spiral, as a list of node kinds to place. */
export interface StarterTable {
  readonly bodyId: number;
  readonly name: string;
  readonly why: string;
  readonly kinds: readonly number[];
}

/**
 * THE TABLE. `bodyId` is /core's own `BodyParams::bodyId` (0 Forge, 1 Cinder),
 * the same numbering `PlanetBody` reads, so nothing here is transcribed.
 */
export const STARTER: readonly StarterTable[] = [
  {
    bodyId: 0, name: 'Forge',
    why: 'the spawn: wood is one half of every starting tool, and the clearing '
      + 'is what puts it within walking distance',
    kinds: new Array<number>(14).fill(NODE_KIND.Tree),
  },
  {
    bodyId: 1, name: 'Cinder',
    why: 'no starter content authored yet. Cinder is somewhere you ARRIVE, not '
      + 'somewhere you wake up, so it needs no tutorial affordance; moon '
      + 'resources belong in the ground (ore patches, world-gen) rather than '
      + 'in this spiral. If Cinder ever becomes a spawn, its list goes here.',
    kinds: [],
  },
];

export function starterTableFor(bodyId: number): StarterTable | null {
  return STARTER.find((t) => t.bodyId === bodyId) ?? null;
}

export interface StarterPlan {
  /** The kinds actually to be placed, in order. */
  kinds: number[];
  /** Every entry the invariant threw out, with the reason. NEVER silent. */
  refused: string[];
  /** '' when a table exists for this body. */
  unknownBody: string;
}

/**
 * The plan for one body.
 *
 * @param airless true when /core says the sea-level density is zero. Passed in
 *   rather than queried here so this stays a pure function that a probe can
 *   drive with either answer, including the one no shipped body produces.
 */
export function starterPlanFor(bodyId: number, airless: boolean,
                               table?: readonly number[]): StarterPlan {
  const t = table ?? starterTableFor(bodyId)?.kinds;
  if (t === undefined) {
    // AN UNKNOWN BODY PLACES NOTHING AND SAYS SO. Falling back to Forge's list
    // is how this defect happened in the first place.
    return {
      kinds: [], refused: [],
      unknownBody: `body ${bodyId} has no starter table, so nothing is placed. `
        + 'Add a row to STARTER in StarterContent.ts.',
    };
  }
  const kinds: number[] = [];
  const refused: string[] = [];
  for (const k of t) {
    if (airless && PLANT_KINDS.includes(k)) {
      refused.push(`node kind ${k} is a plant and body ${bodyId} has no air, `
        + 'so it is refused. A starter table may not put a plant in vacuum.');
      continue;
    }
    kinds.push(k);
  }
  return { kinds, refused, unknownBody: '' };
}
