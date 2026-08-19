// THE FIRST MINUTE: the starter table's gate, and the checklist over it
// (GP-1075, split out of DebugGameplay.ts under the 400-line cap).
//
// `starterPlan` is the pure function that decides WHAT the world starts with
// and `goals` is the checklist that watches the player use it, and the two
// belong together because they share an authority: `bodyIsAirless` is what
// refuses a tree on an airless body in the first, and what tells "this world
// refused it" from "the player has not done it yet" in the second. A probe
// reading only one of them cannot tell those apart.
import {
  bodyIsAirless, PLANT_KINDS, STARTER, starterPlanFor,
} from '../game/StarterContent.js';
import { showGoals } from '../game/Objectives.js';
import type { Services } from './Services.js';

export function goalsApi(s: Services) {
  return {
    /**
     * GP-268 / R16. THE STARTER GATE AS A PURE FUNCTION, so the invariant can
     * be driven with an answer no shipped body produces. A READ and never a
     * mutation (the allowlist rule): it places nothing and changes nothing.
     *
     * This exists because the shipped tables cannot exercise the rule. Forge
     * has air and Cinder has an empty list, so on the two bodies that exist
     * the refusal branch is never taken, and a rule that is never taken is a
     * rule nobody knows is there. `kinds` lets a probe hand it the case that
     * matters: a table that ASKS for a tree on an airless body.
     */
    starterPlan(bodyId: unknown, airless: unknown, kinds?: unknown) {
      const t = Array.isArray(kinds) ? kinds.map(Number) : undefined;
      return {
        plan: starterPlanFor(Number(bodyId), airless === true, t),
        tables: STARTER.map((x) => ({ bodyId: x.bodyId, name: x.name,
                                      count: x.kinds.length, why: x.why })),
        plantKinds: [...PLANT_KINDS],
      };
    },

    // W7. The H key's own handler, so a probe cannot hide the checklist by a
    // path a player has no access to.
    goals(show?: boolean) {
      const g = s.gameplay;
      if (g === undefined || g === null) return null;
      if (show !== undefined) showGoals(g, show);
      // GP-165: the resolved hints ride along so a probe can assert the
      // derivation for rows the panel is not currently drawing.
      // GP-286. THE DRAWN ROWS, not just the counters, plus the two facts a
      // probe needs to tell "this world refused it" from "the player has not
      // done it yet". `airless` and `woodPlaceable` come off the same
      // authority the card and the tree placement share, so a probe cannot
      // agree with a second copy of the rule.
      const v = g.goals.view(g);
      return {
        ...(g.goals.report() as object), hints: g.goals.allHints(g),
        bodyId: g.starterBodyId,
        airless: bodyIsAirless(g.core, g.starterBodyId),
        woodPlaceable: !bodyIsAirless(g.core, g.starterBodyId),
        mootCount: g.goals.mootCount(g),
        doneCount: v.doneCount,
        rows: v.rows,
        // GP-350. EVERY ROW'S PREDICATE EVALUATED NOW, which is a different
        // question from `rows[i].done` (a POSITION in the walk). It is what
        // lets a fixture test a row without first driving the ten in front of
        // it, and in particular test it at its DEFAULT.
        satisfied: g.goals.satisfied(g),
        // Whether the CHECKLIST is holding the panel up, as opposed to the
        // world HUD leaving it up. Both read `isVisible` the same.
        panelPinned: g.goalPanel.isPinned,
        panelVisible: g.goalPanel.isVisible,
      };
    },
  };
}
