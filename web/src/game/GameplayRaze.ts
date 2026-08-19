// TAKING SOMETHING DOWN: what the crosshair is on, what it is called, removing
// it, and the one door into a building's health (GP-1076, split out of
// Gameplay.ts under the 400-line cap).
//
// THE FOUR ARE ONE LIST READ FOUR WAYS, which is the whole argument for them
// sitting together. GP-605's point is that two lists of "what counts as a
// demolish target" agree today and disagree the first time a fifth buildable
// kind arrives, and the failure mode is a right click that offers to remove a
// thing X will not remove. `hasRazeTarget` and `razeTargetName` are derived
// from the same seven fields `razeAimed` hands to `raze`, in one file, so a
// new kind is added in one place or in none.
//
// `applyDamage` closes the file because it is the OTHER way a building comes
// down and D1's argument for it is the same shape: the swarm is not the only
// caller (`__of.damage` drives the identical path, a weapon that can hit a
// building would be a third), so the consequence of a health number reaching
// zero lives at one door rather than inside whichever source got there first.
import { raze } from './GameplayActions.js';
import { fell } from './Collapse.js';
import type { Gameplay } from './Gameplay.js';

/**
 * GP-605. IS THERE ANYTHING UNDER THE CROSSHAIR THAT `razeAimed` WOULD TAKE?
 *
 * DERIVED FROM THE SAME FIELDS `razeAimed` PASSES TO `raze`, and that is the
 * point of it existing at all rather than the caller testing them.
 */
export function hasRazeTarget(g: Gameplay): boolean {
  return g.aimedMachine !== null || g.aimedBuild !== null
    || g.aimedPart !== null || g.aimedStation !== null
    || g.aimedAntenna !== null || g.aimedRubble !== null
    || g.aimedPad !== null;
}

/** What that thing is CALLED, for the sentence. '' when there is none. */
export function razeTargetName(g: Gameplay): string {
  if (g.aimedMachine !== null) {
    return g.aimedMachine.tier === 1 ? 'smelter' : 'furnace';
  }
  if (g.aimedBuild !== null) return g.aimedBuild.kind;
  if (g.aimedPart !== null) return g.aimedPart.kind;
  if (g.aimedStation !== null) return 'research station';
  if (g.aimedAntenna !== null) return 'scanning antenna';
  if (g.aimedRubble !== null) return `${g.aimedRubble.kind} rubble`;
  return g.aimedPad !== null ? 'launch pad' : '';
}

/** Remove whatever the crosshair is on. Returns true if something went. */
export function razeAimed(g: Gameplay): boolean {
  const gone = raze(g, g.aimedMachine, g.aimedBuild, g.aimedPart,
    g.aimedPad, g.aimedStation, g.aimedAntenna, g.aimedRubble);
  if (gone) {
    g.aimedMachine = null; g.aimedBuild = null; g.aimedPart = null;
    g.aimedStation = null; g.aimedAntenna = null; g.aimedRubble = null;
  }
  return gone;
}

/**
 * D1. THE ONE DOOR INTO A BUILDING'S HEALTH, and therefore the one place a
 * building can fall down.
 *
 * `HealthBook.damage` is still the only thing that moves the number; what this
 * adds is the CONSEQUENCE, and it is here rather than in `Enemies.context`
 * deliberately. The swarm is the only damage source today, but it is not the
 * only CALLER: `__of.damage` drives the identical path from a probe, a weapon
 * that can hit a building would be a third, and D5's collapse cascade will be
 * a fourth. A hook living in the swarm would mean a wall taken to 0 by any of
 * the others went on standing, which is exactly the incoherence D1 exists to
 * close, reintroduced through a side door. One door, one consequence.
 *
 * The health ROW is not forgotten here: `reconcile` runs on the next fixed
 * tick and drops every key whose population no longer holds it, which is the
 * path that already exists. See Collapse.ts.
 */
export function applyDamage(g: Gameplay, key: string,
                            amount: number): { applied: number; destroyed: boolean } {
  const r = g.health.damage(key, amount);
  if (r.destroyed && fell(g, key) === null) g.wreckage.unresolved++;
  return { applied: r.applied, destroyed: r.destroyed };
}
