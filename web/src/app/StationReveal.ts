// =============================================================================
// StationReveal.ts (GP-717) — THE FULL MAP, WHEN YOU FIRST BOARD THE STATION.
//
// Reid, 2026-08-13: "the full map should reveal whenever you explore the space
// station." One rising edge, one milestone, one call into `/core`.
//
// -----------------------------------------------------------------------------
// WHY IT IS ITS OWN FILE AND NOT SIX LINES IN `Systems.ts`.
//
// `Systems.ts` is the natural home — it is where a flight fact meets a research
// fact already (GP-530's `ReachedOrbit` edge is thirty lines above where this
// would have gone) — and this lived there until it was measured. It is 399 lines
// against ARCHITECTURE.md §2.2 rule 1's 400-line hard cap, so the feature and
// the argument for it would have pushed the file to 462 and made it the 47th
// entry in `check-limits`. Systems keeps the two-line install; the reasoning
// lives here. That is the same trade `Systems.ts` itself records for RN-845
// ("here rather than in `Boot.ts` because that file is at its cap").
//
// -----------------------------------------------------------------------------
// THE TRIGGER IS MEMBERSHIP — `ride.carrier` — AND THE OTHER THREE CANDIDATES
// ARE WORSE FOR REASONS, NOT FOR TASTE.
//
//   * `BoardingRule.decide`'s returned `'board'` (Loop.ts's one call site) is
//     the per-tick DISTANCE rule, and it is only half the ways aboard:
//     `seatOnStationDeck` calls `seat.board(frame)` DIRECTLY, so the
//     `visit:station` press and the flight arrival never produce that decision
//     at all. Reading the FIELD that both writers write catches every route;
//     reading one writer's return value catches one route.
//   * The `visit:station` menu press is a MENU, not exploring. A player who
//     hand-flies up and walks in — which `story_line_outline_v1.txt` says is the
//     point, and says is hard on purpose — would get nothing for it.
//   * "First walks the deck" would need a SECOND definition of where the deck
//     is, next to the bound over 57 boxes that `CarrierMounts` already publishes
//     and that CE-39 already argued is the membership authority. Two answers to
//     "am I on the station" is the shape this project keeps paying for.
//
// So: the rising edge of "the thing carrying me is Anchorage".
//
// -----------------------------------------------------------------------------
// A RISING EDGE **AND** A MILESTONE, WHICH IS NOT BELT AND BRACES.
//
// The edge alone is not once-per-save. `WorldSession.reboot` releases the rider
// and CE-40's rule re-boards them a moment later (`StationMount.ts` says so in
// those words), so the edge fires again in a session where nothing new happened.
//
// The milestone is the latch, and it is the right latch rather than a `let`
// because the LOAD path restores milestones through `research.earn` and never
// through `grantMilestone` — `Research.ts` states that rule and
// `PersistProgress.ts` obeys it. So a reload comes back with the milestone HELD,
// `grantMilestone` returns false, and nothing re-runs over cells the save
// already carried. A boolean here would have to be persisted, migrated and kept
// honest by hand, and would be a second answer to "has this happened yet".
//
// -----------------------------------------------------------------------------
// THE FIELD IS FETCHED BEFORE THE LATCH IS SPENT, AND THE ORDER IS THE GUARD.
//
// `grantMilestone` is a ONE-WAY DOOR: it returns true exactly once in a save's
// life and there is deliberately no way to un-earn a milestone (research.h says
// so). Granting first and then discovering there is no discovery field to reveal
// — which is every `?flight=0` boot, where `Services.map` is null — would burn
// the only edge this feature has and leave the player permanently unable to earn
// a map they did the work for. `lastOnStation` still tracks the edge in that
// world, because the edge is a fact about the ride and not about whether
// anything used it.
//
// -----------------------------------------------------------------------------
// HOME BODY ONLY, and it is worth being precise about who enforces that.
//
// `revealSurvey` fills the field the `Discovery` driver is holding, and that
// field is cut by `of_disc_ensure(bodyId)` for one body. The moon's map belongs
// to the moon SCAN (`story_line_outline_v1.txt`), so revealing one body is the
// intended behaviour — but today it is also the ONLY behaviour the data model
// can express, because `Boot.ts:583` builds the map outside `buildBodyScope` and
// there is exactly one discovery field and one blob for it in the save. That is
// a defect in another lane's file (GP-725, measured in
// `probes/stationreveal.js` §8) and NOT something this file should be read as
// having designed around.
// =============================================================================
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';
import { MILESTONE, grantMilestone } from '../game/Research.js';
import { STATION_CARRIER_ID } from './StationMount.js';

/**
 * Watch for the player first boarding Anchorage, and hand them the map.
 *
 * Registered on `onPreRender` rather than `onFixedStep` for GP-530's reason:
 * this is a read of state two other systems already settled this tick, not a
 * step of anything, and `Systems.ts` puts the flight/research crossing in the
 * same list. Nothing here mutates the ride, the mounts or the research tree
 * except through their own published verbs.
 */
export function installStationReveal(s: Services, loop: Loop): void {
  /** Was the walker on Anchorage's frame last frame? The EDGE, not the latch. */
  let lastOnStation = false;
  loop.onPreRender.push(() => {
    // CE-20. A world mid-rebuild has emptied its mounts and released its rider,
    // and reading through that would report a spurious falling edge and then a
    // spurious rising one. `Systems.ts` guards every other per-frame read the
    // same way.
    if (s.session.isRebooting) return;
    const ride = s.ride;
    if (ride === null) return;
    const onStation = ride.carrier?.id === STATION_CARRIER_ID;
    const rs = s.gameplay?.progress.research ?? null;
    const disc = s.map?.discovery ?? null;
    if (onStation && !lastOnStation && rs !== null && disc !== null
        && grantMilestone(rs, MILESTONE.StationBoarded,
                          'boarded the space station')) {
      const added = disc.revealSurvey();
      console.info(`[of] station survey uplink: ${added} survey cells revealed`);
    }
    lastOnStation = onStation;
  });
}
