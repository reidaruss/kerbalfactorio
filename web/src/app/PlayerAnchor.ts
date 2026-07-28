// PH-68. WHAT THE PLAYER'S BODY DOES WHEN THE PLAYER IS SOMEWHERE ELSE.
//
// THE DECISION: the body PARKS COHERENTLY. It is not stepped, it is not
// integrated, and its position is RECORDED as an anchor that survives a reload.
// It is not kept simulating.
//
// The alternative was live: keep stepping the walking capsule while the camera
// is in orbit. It was rejected on three counts, in order of weight.
//
//   (1) It is a second answer to "where is the player". A stepped body can fall,
//       slide, be ejected out of rock (PH-61), drown or be moved by a structure
//       while NOBODY IS LOOKING AT IT, and the first anyone would learn of it is
//       on coming back. This project has paid for the two-authority failure five
//       times and every one of them was invisible until it was expensive.
//   (2) Nothing observes it, so nothing can catch it going wrong. R20 is exactly
//       this shape already: a player embedded in a wall reads healthy on every
//       instrument. An unwatched simulated body is that with no camera on it.
//   (3) It costs a full collision step per tick for a body whose only job is to
//       be somewhere when you get back.
//
// The client was ALREADY doing the parking half by accident: `ViewRouter.step`
// delegates only to the active source, so while the vessel is the observer the
// walking `Controller` is simply never stepped, and `Systems.ts` gates the dig
// and level rays off `aboard` because its aim ray is stale. That behaviour was
// never decided, only inherited, which is exactly the state this brief said not
// to leave it in. What this file adds is the half that was missing: the parked
// position is WRITTEN DOWN, so coming back to the body is a recorded fact and
// not a hope that a frozen object survived.
//
// AND IT CLOSES R13 AS A SIDE EFFECT. `SaveSlot` had no player key at all, so
// `Boot.ts` teleported to `cfg.scenario` on every load: a reload put you at the
// spawn point whatever you were doing. Measured before this: went in at lat
// 1.613 lon 107.822, came back at lat 2.000 lon 144.000. With a vessel now
// persisting, that gap stops being an annoyance and becomes an incoherence, a
// rocket in orbit above a player who has been teleported half a planet away.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: put the player back inside a vessel.
// A save written in orbit restores the body at its anchor, on foot, and the
// vessel at its own record. Re-entering a vessel is the CONTROL HANDOFF and it
// is a later lane's; this one only makes sure both ends still exist.
import type { SavePlayerAnchor } from '../game/VesselSave.js';
import { setPlayerAnchorHook, takeStashedAnchor } from '../game/VesselSave.js';
import { registry } from '../sim/VesselRegistry.js';
import type { ViewRouter } from '../player/ViewRouter.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

let restored: SavePlayerAnchor | null = null;
let applied = false;

/**
 * The anchor is read off the WALKER, never off the active view source.
 *
 * `ViewRouter.state()` reports whichever source is live, so calling it while the
 * player is strapped in returns the ROCKET's latitude and altitude, and saving
 * in orbit would record a body 80 km up. `ViewRouter.walker` is the base source
 * the router was constructed with and is the body regardless of where the camera
 * is, which is precisely the distinction this decision is about.
 */
export function installPlayerAnchor(router: ViewRouter,
                                    aboard: () => boolean): void {
  setPlayerAnchorHook((): SavePlayerAnchor | null => {
    const w = router.walker.state();
    if (!Number.isFinite(w.latDeg) || !Number.isFinite(w.lonDeg)) return null;
    return {
      lat: w.latDeg, lon: w.lonDeg, alt: w.altM,
      aboard: aboard(),
      vesselId: aboard() ? registry.promotedId : 0,
    };
  });
}

/**
 * Put the body back. Called once, after the slot has been applied.
 *
 * The rebase is not optional: `Boot.ts` runs `origin.step(observer.position)`
 * immediately after its own teleport, because the floating origin is the one
 * authority for what "near" means and a teleport that does not rebase leaves
 * every near-scene position expressed around a point the player is no longer
 * anywhere near.
 */
export function applyPlayerAnchor(router: ViewRouter,
                                  origin: FloatingOrigin): SavePlayerAnchor | null {
  applied = true;
  const a = takeStashedAnchor();
  if (a === null) return null;
  router.walker.teleport(a.lat, a.lon, a.alt);
  origin.step(router.position);
  restored = a;
  return a;
}

export function playerAnchorReport(): Record<string, unknown> {
  return { applied, restored };
}
