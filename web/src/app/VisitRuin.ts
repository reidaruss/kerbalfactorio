// GP-1060 to GP-1064. TELEPORT TO RUIN, the cheat panel's eighth-ish door and
// the same shape "Teleport to orbit" (Cheats.toOrbit) already uses: the
// arithmetic lives HERE, the state write goes through the ONE ground
// teleport authority (`ports.teleport`, GP-167's own rule, and this file adds
// no second one), and the answer comes back as a GP-231 receipt rather than a
// bare boolean.
//
// -------------------------------------------------------------------------
// WHY THIS IS ITS OWN FILE AND NOT A METHOD ON RuinSites.ts
// -------------------------------------------------------------------------
// RuinSites.ts's own header says it in capitals: "NO INTERACT, NO INVESTIGATE
// ... world-gen's own charter line". GP-547 already drew this exact line once
// (RuinInteract.ts, not RuinSites.ts, for the L7 pick), and a teleport button
// is the same shape of thing: a GAMEPLAY door onto world-gen's placement data,
// not a placement decision itself. This file reads `RuinSites.list` (public)
// and the one small geometry accessor RuinSites gained for it
// (`entryLocal()`, sibling of the already-public `investigateLocal()`) and
// writes nothing back.
//
// -------------------------------------------------------------------------
// "NEAREST", WRITTEN THAT WAY WHILE THERE IS ONLY ONE
// -------------------------------------------------------------------------
// The shipped world has one ruin, spawn-adjacent (WG-166/WG-211). This picks
// the CLOSEST entry in `RuinSites.list` to the player's own feet rather than
// `list[0]`, so the day a second ruin is scattered (the roadmap's own stated
// plan, CLAUDE.md) this button keeps doing the sensible thing with no edit
// here.
//
// -------------------------------------------------------------------------
// THE LANDING SPOT: OUTSIDE THE FOOTPRINT, OUTSIDE THE GARRISON'S ACQUIRE
// RADIUS, AND GROUNDED THROUGH THE SAME DOOR EVERY OTHER SITE ROW USES
// -------------------------------------------------------------------------
// Two numbers set the standoff, and both are READ off their own authorities
// rather than restated:
//
//   1. `ruin.footprintM` (WG-201/WG-203's own footprint radius, published per
//      site) -- landing inside it is landing on the ground WG-166 built the
//      ruin to sit on, which is "inside the ruin" for every purpose that
//      matters here.
//   2. `AGGRO_RADIUS_M + GARRISON_SCATTER_M` (EnemyGarrison.ts) -- a garrison
//      creature can spawn up to `GARRISON_SCATTER_M` (8 m) off the post in
//      ANY direction, so the closest a guard can ever be to a player standing
//      `standoffM` from the post is `standoffM - GARRISON_SCATTER_M`. For that
//      to clear `AGGRO_RADIUS_M` (30 m, the `hold`-to-`engage` acquire
//      distance) the standoff has to exceed their SUM, 38 m. Reading both
//      constants from EnemyGarrison.ts rather than copying the numbers means
//      a future tuning pass there moves this door with it.
//
// The bigger of the two, plus a flat safety margin, is the standoff. Reid's
// ruling that "enemies enter at or on the way to the ruins" (CLAUDE.md) and
// that arriving into danger is the point stands: this clears the INSTANT
// aggro-on-materialise case only, exactly as asked, and does nothing about a
// player who then walks closer.
//
// THE DIRECTION FACES THE DOOR WHEN THE ASSET PUBLISHES ONE. `entryLocal()`
// is the doorway socket in the ruin's own unrotated local space; rotated by
// the ruin's placement quaternion and flattened into the tangent plane it
// becomes "which way is the entrance, horizontally, from here". Landing
// standoffM further out along that same ray and then facing back down it
// puts the player looking at the door they would otherwise have to walk
// around to find. With no entry socket (an asset that never shipped one) the
// direction falls back to the tangent frame's own `east`, which is still a
// safe, deterministic, outside-the-footprint spot -- just not aimed at a door
// this file cannot locate.
//
// GROUNDING GOES THROUGH `ports.teleport`, THE LAT/LON DOOR, NOT
// `ports.standAt`. VisitSites.ts's own header explains why `standAt` leaves
// `grounded` FALSE by design ("whether there is a floor here is exactly what
// the caller is asking"): it is the right door for a deck this project
// already knows is there, and the wrong one for a patch of open terrain nobody
// has measured out to 45 m from a POI's centre. `Controller.teleport` calls
// `KinematicBody.spawn`, which snaps the feet to the REAL heightfield and
// sets `grounded = true` unconditionally, so this reuses the exact spawn path
// every VISIT_SITES row and every walking probe already depends on rather
// than re-deriving ground height from the /core surface-radius query by hand.

import * as THREE from 'three';
import { tangentFrame } from '../player/ViewSource.js';
import { AGGRO_RADIUS_M, GARRISON_SCATTER_M } from '../game/EnemyGarrison.js';
import { visitBlocked, VISIT_EYE_ALT_M } from './VisitSites.js';
import type { RuinSites, PlacedRuin } from '../game/RuinSites.js';
import type { CheatRow } from '../ui/PauseMenu.js';
import type { FlightMode } from './FlightMode.js';
import type { Vec3d } from '../world/PlanetBody.js';

const DEG = 180 / Math.PI;

/** Metres, flat margin on top of whichever requirement (footprint clearance
 *  or garrison acquire clearance) is larger, so a measurement that lands
 *  exactly on the boundary still reads comfortably outside it rather than on
 *  a coin flip. */
const SAFETY_MARGIN_M = 6;

/** The row's id. Deliberately NOT `visit:`-prefixed: `Cheats.press` tries
 *  `pressVisit` (VisitSites.ts) first on any `visit:` id and that function
 *  returns a non-null (refusing) outcome for an id it does not recognise,
 *  which would swallow this press before it ever reached this file. It is a
 *  plain top-level verb, the same shape as `orbit`/`fuel`/`peaceful`. */
export const RUIN_ROW_ID = 'ruin';

export interface RuinPorts {
  teleport: (latDeg: number, lonDeg: number, altM: number) => void;
  /** The /core-backed direction-to-lat/lon oracle (`SurfaceOracle.
   *  latLonFromDir`), so the offset point this file computes in body-frame
   *  Cartesian metres can go through the SAME ground door every site row
   *  uses. Not reimplemented by hand: the WASM side owns the one conversion. */
  latLonFromDir: (dx: number, dy: number, dz: number) => { lat: number; lon: number };
  /** Face the player at a compass yaw (radians, 0 = north, positive toward
   *  east -- `ViewMode.update`'s own convention) after the teleport has
   *  already placed the feet. Optional and a no-op with no walker, like the
   *  other doors in this neighbourhood. */
  faceYaw: (yawRad: number) => void;
}

export interface RuinOutcome {
  done: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

/** Why the ruin cannot be reached right now, or ''. Mirrors `visitBlocked`'s
 *  shape (VisitSites.ts) for the vessel guard, plus the one reason unique to
 *  this door: no ruin exists in this world's site catalogue at all. */
export function ruinBlocked(f: FlightMode | null, ruins: RuinSites | null): string {
  if (ruins === null) return 'no world';
  if (ruins.list.length === 0) {
    return `this world has no ruin to teleport to (${ruins.why || 'none placed'})`;
  }
  return visitBlocked(f);
}

/** The row the panel draws. Blocked reason is live, like every other row. */
export function ruinRow(f: FlightMode | null, ruins: RuinSites | null): CheatRow {
  return {
    id: RUIN_ROW_ID, label: 'Teleport to ruin', kind: 'button',
    blocked: ruinBlocked(f, ruins),
    note: 'the nearest surveyed ruin, landing outside its garrison\'s watch',
  };
}

/** Closest ruin to `feet`, or the only one, or the first with no feet to
 *  measure from. `ruins.list` is never empty here: callers check
 *  `ruinBlocked` first. */
function nearestRuin(ruins: RuinSites, feet: Vec3d | null): PlacedRuin {
  if (feet === null || ruins.list.length === 1) return ruins.list[0];
  let best = ruins.list[0];
  let bestD = Infinity;
  for (const r of ruins.list) {
    const d = Math.hypot(r.sitePos.x - feet.x, r.sitePos.y - feet.y, r.sitePos.z - feet.z);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** Horizontal (tangent-plane) unit direction from the ruin's centre toward
 *  its own doorway, or `east` with no entry socket. See the header for why
 *  this is the direction the player lands ALONG and then faces back down. */
function outwardDir(ruin: PlacedRuin, entryLocal: THREE.Vector3 | null): THREE.Vector3 {
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  tangentFrame(ruin.up, east, north);
  if (entryLocal !== null) {
    const world = entryLocal.clone().applyQuaternion(ruin.quat);
    const alongUp = world.dot(ruin.up);
    const horiz = world.addScaledVector(ruin.up, -alongUp);
    if (horiz.lengthSq() > 1e-6) return horiz.normalize();
  }
  return east;
}

/**
 * Handle the `ruin` press, or the blocked outcome. Terminal, not pending
 * (GP-155's rule, checked): `ports.teleport` writes the feet synchronously.
 */
export function pressRuin(f: FlightMode | null, ruins: RuinSites | null,
                          feet: Vec3d | null, ports: RuinPorts): RuinOutcome {
  const blocked = ruinBlocked(f, ruins);
  if (blocked !== '' || ruins === null) {
    return { done: false, message: `refused: ${blocked || 'no world'}` };
  }
  const ruin = nearestRuin(ruins, feet);
  const aggroClearM = AGGRO_RADIUS_M + GARRISON_SCATTER_M;
  const standoffM = Math.max(ruin.footprintM, aggroClearM) + SAFETY_MARGIN_M;
  const dir = outwardDir(ruin, ruins.entryLocal());
  const landing: Vec3d = {
    x: ruin.sitePos.x + dir.x * standoffM,
    y: ruin.sitePos.y + dir.y * standoffM,
    z: ruin.sitePos.z + dir.z * standoffM,
  };
  const r = Math.hypot(landing.x, landing.y, landing.z) || 1;
  const { lat, lon } = ports.latLonFromDir(landing.x / r, landing.y / r, landing.z / r);
  const latDeg = lat * DEG;
  const lonDeg = lon * DEG;
  ports.teleport(latDeg, lonDeg, VISIT_EYE_ALT_M);
  // Face back down the same ray, at the SAME tangent frame (the curvature
  // over a few dozen metres is WG-201's own 0.00027 m/18 m figure, one scale
  // up: not worth a second oracle call to re-derive at the landing point).
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  tangentFrame(ruin.up, east, north);
  const faceDir = dir.clone().multiplyScalar(-1);
  ports.faceYaw(Math.atan2(faceDir.dot(east), faceDir.dot(north)));
  return {
    done: true,
    message: `standing ${standoffM.toFixed(1)} m outside the ruin `
      + `(footprint ${ruin.footprintM.toFixed(1)} m, clear of its garrison's `
      + `${aggroClearM.toFixed(0)} m worst-case acquire), facing it`,
    detail: {
      idLo: ruin.idLo, idHi: ruin.idHi, ordinal: ruin.ordinal,
      latDeg, lonDeg, standoffM, footprintM: ruin.footprintM,
      aggroClearM, garrison: ruin.garrison,
    },
  };
}
