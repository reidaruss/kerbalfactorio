// THE DRAWN-RUIN HALF OF window.__of (WG-166 to WG-171), split out beside
// `DebugSites.ts` for the reason that file gives: one debug surface per domain
// concern, and `Debug.ts` gains a spread rather than forty lines.
//
// `of.sites()` NEXT DOOR ANSWERS A DIFFERENT QUESTION AND THAT IS THE POINT.
// It reports the site TABLE, which is a pure function of the seed and exists
// whether or not anything was ever drawn. This reports the INSTANCES: what is
// in the scene, what is in the walker's solid set, which LOD rung each one is
// on, and who is standing guard. A probe that reads only one of the two cannot
// tell "the generator placed a ruin" from "the world shows a ruin", and the
// whole of WG-166 is the gap between those two sentences.
//
// WHY THERE IS A SPAWN VERB HERE WHEN `EnemyDebug.ts` REFUSES TO HAVE ONE.
// That file's refusal is about conjuring a WAVE: an attack the player's own
// production did not cause. `of.ruins('garrison')` conjures nothing. It calls
// `RuinSites.garrison`, the shipped method, at the shipped post, with the
// shipped seed unless one is named, and it is the identical line `Gameplay.
// create` runs at world build. It exists because composition determinism is
// only assertable by spawning twice, and because the accepted model here is
// regeneration rather than persistence (`EnemyGarrison.ts`), so re-posting a
// garrison is a thing the design says happens rather than a thing this file
// invents. Naming a seed is the ONE thing it adds over the production call, so
// a probe can prove "same seed, same roster" and "different seed, different
// roster" from one page.
import type { Services } from './Services.js';

export function ruinsApi(s: Services) {
  return {
    /**
     * The drawn ruins, or a spawn.
     *
     *   of.ruins()                 the report (also inside `of.game().ruins`)
     *   of.ruins('garrison')       re-post every garrison at its own site seed
     *   of.ruins('garrison', 7)    re-post every garrison at seed 7
     *
     * Null with no character.
     */
    ruins: (op?: string, a?: number): unknown => {
      const g = s.gameplay;
      if (g === null) return null;
      if (op === 'garrison') {
        const spawned = g.ruins.garrison(g.enemies, g,
          a === undefined ? undefined : Number(a));
        // The ENEMY report comes back SPREAD, unasked, because the number that
        // matters is not how many this call made but how many are now alive: a
        // re-post on top of a live garrison is exactly the case where those two
        // disagree, and publishing only the first would hide it. Spread rather
        // than nested to match `of.enemies('advance')`'s shape exactly, which
        // is the shape `probes/garrison.js` already reads.
        return { spawned, ruins: g.ruins.report(),
          ...(g.enemies.report() as object) };
      }
      return g.ruins.report();
    },
  };
}
