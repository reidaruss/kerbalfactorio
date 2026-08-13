// L7 (GP-546 to GP-549). WALKING INTO A RUIN AND PRESSING INTERACT AT THE
// INVESTIGATE POINT GRANTS THE MILESTONE THAT UNLOCKS ELECTRIFICATION.
//
// `story_line_outline_v1.txt`: "Investigate ruins (upon searching the ruins
// you gain the ability to research and build an antenna upgrade, as well as
// research electricity)". `RuinSites.ts` (world-gen) draws the ruin, makes it
// solid and garrisons it, and publishes `socket_investigate` in its report
// but deliberately reads it for nothing -- its own header says so, and names
// this file as the reader. This IS that reader: it picks the socket the same
// centre-and-radius way `Antennas.pick`/`ResearchStations.pick` already do
// (GameplayAim.ts's own ordering rule: machine, build, part, station,
// antenna, THEN this, then the pad last), and it is the one place
// `milestones::RuinInvestigated` is granted from live play, `grantMilestone`'s
// stated purpose (Research.ts) and Systems.ts's ReachedOrbit grant the
// precedent for calling it directly from a real player action.
//
// PER-RUIN, NOT GLOBAL. "Already investigated" is `Sites.visited`, poi.h's
// own per-site bit (WG-151), reused rather than re-invented: a second ruin
// still reads as un-investigated even after a first one already granted the
// (global, one-shot) milestone, because the player has not searched THAT one
// yet. `Sites.markVisited` returning true only the first time is the
// idempotence this file rides on rather than re-implements.

import * as THREE from 'three';
import { grantMilestone, MILESTONE, type Research } from './Research.js';
import type { PlacedRuin, RuinSites } from './RuinSites.js';
import type { Sites } from '../world/Sites.js';
import type { Vec3d } from '../world/PlanetBody.js';
import { labelOf } from '../player/Bindings.js';
import type { HudTarget } from '../ui/GameHud.js';

/** A design POINT, not a collision proxy, so the pick radius is a constant
 *  rather than a mesh half-extent -- `Antennas.ANTENNA_RADIUS_M`'s own shape. */
const INVESTIGATE_RADIUS_M = 1.5;

export interface AimedInvestigate {
  ruin: PlacedRuin;
  /** Read at PICK time, off the SAME `Sites` the press will use, so the
   *  prompt and the key can never disagree about which sentence is true. */
  alreadyVisited: boolean;
}

function worldSocket(ruin: PlacedRuin, local: THREE.Vector3): THREE.Vector3 {
  return local.clone().applyQuaternion(ruin.quat)
    .add(new THREE.Vector3(ruin.pos.x, ruin.pos.y, ruin.pos.z));
}

/**
 * `Antennas.pick`'s test, in shape: nearest centre inside a radius, along the
 * ray, within reach. Null when nothing is aimed at (out of range, or looking
 * away) -- the same "no prompt at all" refusal every other aimed target in
 * this file's neighbourhood uses, rather than a spoken sentence for a press
 * that has not happened.
 */
export function pickInvestigate(ruins: RuinSites, sites: Sites, eye: Vec3d,
                                dir: Vec3d, reachM: number): AimedInvestigate | null {
  const local = ruins.investigateLocal();
  if (local === null) return null;
  let best: PlacedRuin | null = null;
  let bestT = Infinity;
  for (const ruin of ruins.list) {
    const w = worldSocket(ruin, local);
    const ox = w.x - eye.x, oy = w.y - eye.y, oz = w.z - eye.z;
    const t = ox * dir.x + oy * dir.y + oz * dir.z;
    if (t < -INVESTIGATE_RADIUS_M || t > reachM || t >= bestT) continue;
    const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
    if (Math.hypot(cx, cy, cz) > INVESTIGATE_RADIUS_M) continue;
    best = ruin; bestT = Math.max(0, t);
  }
  if (best === null) return null;
  return { ruin: best, alreadyVisited: sites.visited(best) };
}

/** What the press did, so the caller can flash an honest sentence and a
 *  probe can assert the exact branch taken rather than inferring it from a
 *  side effect. */
export type InvestigateResult = 'already' | 'granted' | 'visited-no-grant';

/**
 * THE PRESS. Re-checks `markVisited` fresh rather than trusting the aim-time
 * `alreadyVisited` flag, because that is the one call whose return value is
 * authoritative ("true only the first time") and the two can only ever be
 * one frame apart in practice, not `investigate` shortcutting on stale data.
 */
export function investigate(sites: Sites, research: Research,
                            ruin: PlacedRuin): InvestigateResult {
  const first = sites.markVisited(ruin);
  if (!first) return 'already';
  // The MILESTONE is a single global bit (research.h), so a SECOND ruin's
  // own first visit still calls this -- the real idempotence lives in
  // `setMilestone`'s own no-op-once-earned rule, not in the per-ruin bit
  // above, which only ever gates the FEEDBACK ("already investigated").
  const granted = grantMilestone(research, MILESTONE.RuinInvestigated,
    'investigated a ruin');
  return granted ? 'granted' : 'visited-no-grant';
}

/**
 * WHAT THE CROSSHAIR SAYS, `ghostPrompt`/`aimPrompt`'s own precedent: the
 * reason is on screen WHILE the player is still aiming, not flashed only
 * after a press, so "already investigated" is discoverable by looking rather
 * than by trying. Null (no prompt at all) is out of range's own honest
 * refusal, matching every other aimed target in this neighbourhood.
 */
export function investigatePrompt(aimed: AimedInvestigate | null): HudTarget | null {
  if (aimed === null) return null;
  if (aimed.alreadyVisited) {
    return {
      name: 'ruin', fraction: 0, empty: false, distanceM: 0,
      action: 'already investigated',
    };
  }
  return {
    name: 'ancient device', fraction: 0, empty: false, distanceM: 0,
    action: `${labelOf('interact')} investigate`,
  };
}
