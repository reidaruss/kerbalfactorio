// The pack, the report and the tech tree: the six entries that answer "what
// does the player HAVE" (GP-1075, split out of DebugGameplay.ts under the
// 400-line cap; the composed `gameplayApi` is unchanged in shape and order).
//
// `game()` is the whole gameplay report and every other file here reports a
// slice of it; this module holds the report itself plus the four verbs that
// read or move what is IN the pack. `research` sits here rather than with the
// buildings because a tech row is a thing the player has earned, not a thing
// standing in the world.
import type { Services } from './Services.js';

export function packApi(s: Services) {
  return {
    game: () => s.gameplay?.report() ?? null,
    nodes: () => s.gameplay?.nodes() ?? [],
    /** GP-530. THE TECH TREE, full rows (`Research.list()`), not the summary
     *  counts `game().progress.research` already carries: a probe asking
     *  "is FlightAutopilot researchable yet" needs the one row's own
     *  `canResearch`/`block`/`milestone`, which no existing debug surface
     *  published before the milestone bus needed proving. */
    research: () => s.gameplay?.progress.research.list() ?? [],
    panel(open: boolean) { s.gameplay?.setPanel(open); return s.gameplay?.report() ?? null; },
    craft: (index: number) => s.gameplay?.game.craft(index) ?? false,
    lamp(on?: boolean) {
      if (on !== undefined && on !== s.headlamp.enabled) s.headlamp.toggle();
      return s.headlamp.stats();
    },
  };
}
