// GP-500 to GP-505. GO TO THE MOON, from the game menu.
//
// Reid's ask, verbatim: "add a teleport button so i can teleport to the moon in
// the cheats menu". The moon has been fully built for weeks -- terrain, biomes,
// craters, its own save world, an airless sky -- and reachable only by typing
// `?body=cinder` into the address bar, which is not a door a player has.
//
// ===========================================================================
// THE TRIP IS A PAGE RELOAD, AND THAT IS A MEASUREMENT AND NOT A PREFERENCE.
// ===========================================================================
//
// There is a runtime body switch: `of.reboot(bodyId)` (core-engine CE-20) tears
// the body scope down while the loop runs and rebuilds it in 88 ms, and Forge
// comes back bit-identical after a round trip. It was tempting. It is not this
// door, and the reason is three measurements taken before a line of this file
// was written, driven on an isolated build of HEAD:
//
//  1. `of.life().stale` after `of.reboot(1)` names SEVEN holders that still
//     believe in Forge, exactly the seven core-engine R7 predicted, against
//     three that are clean. Two are rendering's (`proxy.bodyName` still
//     `ForgeProxy`, `sky.uPlanetR` still 600000 against a live 200000). FIVE
//     ARE THIS DOMAIN'S SIDE OF THE HOUSE and they are not cosmetic:
//     `gameplay.bodyRadiusM` reads 600000 on a 200 km moon and
//     `gameplay.bodyHandle` reads 1 against a live 2, so every building, rock,
//     tree, health row and site-grid anchor would be placed against the wrong
//     planet through a handle that is not the live one.
//  2. Persistence R-BODY-2, and this is the one that decides it: `slot.body`
//     follows `Gameplay.bodyId`, which boot builds and `WorldSession.reboot`
//     deliberately does NOT rebuild. So a rebooted session saves the MOON's
//     world under body 0 and destroys the player's Forge world in the slot --
//     PS-40's defect, the one `twobody.mjs` exists to catch, reached through
//     the front door instead of through an autosave. A cheat that eats the
//     world it was pressed from is not shippable at any smoothness.
//  3. A reboot does not relocate the player (core-engine section 5c says so and
//     the same run confirms it): the walker keeps Forge's body-frame position,
//     which on a 200 km moon is 400 km up with no terrain under it, and falls.
//     So route 1 does not even do the thing without more work on top.
//
// A page reload into `?body=cinder` has none of that, because it is not a new
// path: it is the path Cinder has ALWAYS been reached by, so everything already
// built for it works unchanged and for free. PS-40's per-body save carries the
// other world through (`others`), GP-286 steps the checklist past objectives an
// airless moon cannot satisfy, GP-287 keeps it lifeless, RN-840 gives it the
// airless sky. Not one of those has to be re-proven, because not one of them
// is being reached differently.
//
// The cost is a seven-second black screen, and it is a CHEAT MENU. The row
// says so in its own note rather than surprising anybody, because a page that
// goes white without warning reads as a crash.
//
// ===========================================================================
// WHAT THE BUTTON DOES WHEN YOU ARE ALREADY ON THE MOON
// ===========================================================================
//
// It refuses by name, and the row for the world you are NOT on is the way back.
// That is one table with two rows and no special case: `blocked` is
// "you are already on Cinder" for whichever row is the body you are standing
// on. The alternative -- a single "go to the moon" button -- would have shipped
// a one-way trip, and would also have had no reachable refusing case anywhere
// in its own loop, which is the shape this project has been bitten by (GP-301:
// the first autopilot press a player ever made did nothing and said it worked,
// because every fixture moved the altitude first).
//
// ===========================================================================
// THE NUMBERS ARE /core's AND THE PROBE ASSERTS THEM
// ===========================================================================
//
// R-BODY-3: there is no live `PlanetBody` for a body nobody is standing on, so
// the row describing the world you are NOT on cannot read it live. The table
// below carries /core's own declared constants with the file and line they come
// from, and `probes/visitworld.js` asserts each one AFTER ARRIVING against the
// live body it then has. That is VisitSites' `groundM` rule: a digit mistyped
// here cannot certify itself, and the run that goes there catches it.
//
// The row for the body you ARE on is derived live from `PlanetBody` and never
// from this table, so the two never disagree about the world in front of you.

import { labelOf } from '../player/Bindings.js';
import type { CheatRow } from '../ui/PauseMenu.js';
import type { BodyId } from '../world/PlanetBody.js';
import type { FlightMode } from './FlightMode.js';

/** One world you can be standing on. */
export interface WorldDest {
  /** /core's own `BodyParams::bodyId`. */
  bodyId: BodyId;
  label: string;
  /** The value of `?body=` that boots it. '' means the flag is REMOVED, which
   *  is how Forge is spelled: `Config.ts` reads any other value as Forge, so
   *  deleting the flag is the one spelling with no second meaning. */
  param: string;
  /** `BodyParams::radiusM`, m. cubed_sphere.h (Forge 6.0e5, Cinder 2.0e5). */
  radiusM: number;
  /** Surface gravity, m/s2: `mu / R^2` off the same two declarations
   *  (Forge mu 9.81 * 6.0e5^2, Cinder mu 1.63 * 2.0e5^2). */
  gravityMs2: number;
  /** What makes it a different WORLD, in one line. The Visit-site rule. */
  what: string;
}

/**
 * The two worlds, in /core's own bodyId order.
 *
 * `what` deliberately does not repeat the radius or the gravity: those are
 * fields, and the row sentence is composed from them below so that a table edit
 * moves the screen. GP-165's rule, which this project has broken enough times
 * to have counted.
 */
export const WORLDS: readonly WorldDest[] = [
  { bodyId: 0, label: 'Forge: the home planet', param: '',
    radiusM: 600000, gravityMs2: 9.81,
    what: 'air, oceans, forests, ore patches and everything you have built' },
  { bodyId: 1, label: 'Cinder: the moon', param: 'cinder',
    radiusM: 200000, gravityMs2: 1.63,
    what: 'airless grey rock and craters, with 5 km of relief on a body a '
      + 'third of Forge\'s size. NOTHING LIVES THERE: no trees, no rocks to '
      + 'swing at and no nests, by ruling and not by omission (GP-287)' },
];

export const WORLD_ROW_PREFIX = 'world:';

/** The row id for a destination. */
export function worldRowId(d: WorldDest): string {
  return `${WORLD_ROW_PREFIX}${d.param === '' ? 'forge' : d.param}`;
}

/**
 * The URL that boots `d`, derived from the one the player is on.
 *
 * EVERY OTHER FLAG IS KEPT. A player in sandbox with `?combat=1` who presses
 * this must arrive in sandbox with combat on, or the button is silently a mode
 * switch as well as a trip. Forge is spelled by DELETING the flag rather than
 * by writing one of the three values that mean it, so the address bar of a
 * player at home looks like a fresh game and there is exactly one spelling.
 *
 * Pure and exported so it can be asserted without a browser: it is the one
 * piece of arithmetic in this file and it decides where the player ends up.
 */
export function worldUrl(href: string, d: WorldDest): string {
  const u = new URL(href);
  if (d.param === '') u.searchParams.delete('body');
  else u.searchParams.set('body', d.param);
  return u.toString();
}

/** The one port a press needs. Navigation is NOT written here for the reason a
 *  teleport is not written in VisitSites: the client already has exactly one
 *  place that takes the world away and brings it back (`restart` in
 *  MenuBoot.ts), and the save that must happen first belongs beside it. */
export interface WorldPorts {
  /** Save the world being left, then navigate. Suppressible by `norestart`,
   *  which is what lets a driven probe press the real button and live. */
  goTo: (url: string, d: WorldDest) => void;
}

/**
 * Why no world can be travelled to right now, or ''.
 *
 * The same guard the Visit-site rows carry and for the same reason: aboard a
 * vessel the walker is not the view source, and the trip would strand a flying
 * craft in a world that has no pad under it. It is a sentence naming the keys
 * that fix it, off the binding table and never a literal (GP-140).
 */
export function worldsBlocked(f: FlightMode | null): string {
  return f !== null && f.aboard
    ? `you are aboard a vessel: get out first (${labelOf('board')} to `
      + `disembark, ${labelOf('recover')} clears the pad)`
    : '';
}

/**
 * The rows the panel draws, derived per view.
 *
 * `hereId` is the LIVE body's id (`PlanetBody.bodyId`, CE-22's one identity),
 * so the refusal follows the world rather than a boot-time copy of it.
 *
 * THE ORDER OF THE TWO BLOCKED REASONS IS NOT ARBITRARY. "You are already
 * here" comes first because it is true of this row whatever else is true, and
 * telling a player to disembark so that they can press a button which would
 * refuse anyway is a worse sentence than the one that is about them.
 */
export function worldRows(f: FlightMode | null, hereId: BodyId): CheatRow[] {
  const aboard = worldsBlocked(f);
  const here = WORLDS.find((w) => w.bodyId === hereId) ?? WORLDS[0];
  return WORLDS.map((d) => ({
    id: worldRowId(d),
    label: d.label,
    note: noteFor(d, here),
    kind: 'button' as const,
    blocked: d.bodyId === hereId
      ? `you are already on ${nameOf(d)}` : aboard,
  }));
}

/** The bare body name out of the row label ('Cinder: the moon' -> 'Cinder'),
 *  so the label is the one place a world is named. */
function nameOf(d: WorldDest): string {
  return d.label.split(':')[0];
}

/**
 * The row's sentence. Composed from the table's own fields, so a number
 * corrected in one place moves the screen.
 *
 * THE JUMP RATIO IS ON THE ROW because it is the fact a player feels in the
 * first three seconds and would otherwise read as the game being broken --
 * `stationRows` puts it on its row for exactly that reason. Apex height goes as
 * 1/g at a fixed take-off speed, so it is `g_here / g_there`.
 *
 * AND IT IS SAID THE WAY ROUND THAT IS BIGGER THAN ONE, which the first driven
 * run is what caught: viewed from Cinder the Forge row read "a jump goes 0.2
 * times as high", which is arithmetically right and reads as a typo. The trip
 * has two directions and only one of them is the fun one, so the sentence has
 * to have two directions too.
 *
 * THE RELOAD IS ON THE ROW because it is a seven-second black screen, and a
 * player who was not told reads it as a crash. It also says the world being
 * left is saved first, which is the thing they will actually be worried about.
 */
function noteFor(d: WorldDest, here: WorldDest): string {
  const km = `${(d.radiusM / 1000).toFixed(0)} km radius, `
    + `${d.gravityMs2.toFixed(2)} m/s2`;
  if (d.bodyId === here.bodyId) return `where you are now: ${km}. ${d.what}`;
  const r = here.gravityMs2 / d.gravityMs2;
  const jump = r >= 1 ? `a jump goes ${r.toFixed(1)} times as high`
    : `a jump goes ${(1 / r).toFixed(1)} times LOWER`;
  return `${km} (${jump}): ${d.what}. THE TRIP RELOADS THE PAGE: your `
    + `${nameOf(here)} world is saved first and is kept in the same save slot, `
    + 'waiting for you';
}

export interface WorldOutcome {
  done: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Handle a `world:` press, or null for an id this file does not own.
 *
 * THE RECEIPT IS PENDING AND SAYS SO (GP-155). The save is two IndexedDB round
 * trips and the navigation is after it, so by the time this returns nothing has
 * happened yet except that it has been asked for. A receipt that claimed
 * arrival would be claiming it about a world that has not been built, on the
 * one verb here that takes the current one away.
 */
export function pressWorld(id: string, f: FlightMode | null, hereId: BodyId,
                           href: string, ports: WorldPorts): WorldOutcome | null {
  if (!id.startsWith(WORLD_ROW_PREFIX)) return null;
  const d = WORLDS.find((w) => worldRowId(w) === id) ?? null;
  if (d === null) {
    return { done: false, message: `no such world: ${id.slice(WORLD_ROW_PREFIX.length)}` };
  }
  if (d.bodyId === hereId) {
    return { done: false, message: `refused: you are already on ${nameOf(d)}` };
  }
  const blocked = worldsBlocked(f);
  if (blocked !== '') return { done: false, message: `refused: ${blocked}` };
  const url = worldUrl(href, d);
  ports.goTo(url, d);
  return {
    done: true,
    message: `saving this world, then going to ${nameOf(d)}`,
    detail: { pending: true, bodyId: d.bodyId, fromBodyId: hereId, url,
      radiusM: d.radiusM, gravityMs2: d.gravityMs2 },
  };
}
