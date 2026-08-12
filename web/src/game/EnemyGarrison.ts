// THE GARRISON: creatures whose provenance is a POSITION, not a wave.
//
// Scanning spine L4, Reid's ruling: enemies enter at or on the way to the
// ruins. Everything in EnemySwarm.ts up to this file is GP-89's march: a
// creature `goal` set once from an AttackWave and walked at for ever, with no
// idle state, no aggro and no leash. A guard standing watch over a place needs
// the opposite of a march: it must do NOTHING until provoked, come back when
// it is provoked too far from what it is guarding, and its roster must be a
// property of the SITE rather than of /core's evolving threat curve.
//
// THIS FILE NEVER CALLS INTO /core AND NEVER WILL. GP-87's own boundary is
// that /core owns WHY an attack happens; a garrison is not an attack, it is
// terrain content (the ruin-placement lane's POI bridge will place a post the
// same way it places anything else static), so there is no AttackWave to ask
// for here and nothing in this file reads or writes enemies.h's
// pollution/evolution loop. A GARRISON KILL CREDITS NOTHING TO EVOLUTION,
// exactly as a creature kill from a wave credits nothing (GP-92) — the
// difference is that a wave creature at least came from the loop the header
// owns, and a garrison creature never does, by construction.
//
// COMPOSITION IS DETERMINISTIC AND SEED-OWNED, DELIBERATELY NOT WEIGHTED BY
// EVOLUTION. A wave's roster is /core's own answer to "how dangerous is the
// world right now"; a garrison's roster is "who lives here", which is a
// property of the SITE and must read the same on day one and day one hundred,
// or a returning player would find the ruin they cleared had re-armed itself
// with the current threat curve instead of regrowing its own guards. The hash
// below is the identical two-line technique `EnemyLoop.ts` already uses to
// seed the nest ring: not a physical quantity, so it owes nothing to the
// determinism rules that bind an actual simulated value.
//
// SEAM LEFT NAMED FOR THE LANE THAT WIRES A REAL RUIN SITE: a per-site
// "cleared" bit (so a garrison a player already killed does not simply
// regenerate the moment they walk away and back) is NOT built here.
// Regeneration-on-approach is the accepted model for now — a garrison is
// re-spawned wherever `spawnGarrison` is called with no memory of an earlier
// visit — and a cleared bit is later work that rides on the POI bridge's own
// site records, not on anything this file owns.

import { offsetDir, type Vec3 } from './EnemyLoop.js';
import type { Creature } from './EnemySwarm.js';
import type { EnemyCatalogue } from './EnemyTypes.js';
import type { Enemies, EnemyHost } from './Enemies.js';

export type GarrisonState = 'hold' | 'engage' | 'return';

export interface GarrisonMember { typeId: number; count: number }

export interface GarrisonParams {
  /** Body-frame position (or bare direction — only its direction is used, see
   *  `onGround` in EnemySwarm.ts) of the post. The ruin-placement lane wires
   *  this from an FSite once the POI bridge lands; a plain fixture position is
   *  what exists to pass until then. */
  postPos: Vec3;
  /** Deterministic composition. The POI bridge lane's site id is the natural
   *  seed once it exists; a numeric seed is what is offered today. */
  seed: number;
}

/** Metres: acquire the player from `hold`. Half the leash, so a guard
 *  reliably notices someone standing at the edge of its own territory rather
 *  than only someone who has already walked in past it. */
export const AGGRO_RADIUS_M = 30;
/** Metres FROM THE POST, not from wherever the creature started chasing:
 *  past this the fight is abandoned regardless of how close the player still
 *  is, which is what makes a garrison a GARRISON rather than a wave that
 *  happens to start close to home. */
export const LEASH_M = 60;
/** Metres: close enough to the post to call itself home again and drop back
 *  to `hold`. Not zero: `march`'s own step size (EnemySwarm.ts) means a
 *  creature at rest still moves a few centimetres a tick, so zero would leave
 *  it labelled `return` for ever, oscillating around a point it can never
 *  exactly land on. */
export const ARRIVE_M = 2;
/** Metres: how far apart a garrison's own bodies spawn around the post,
 *  tighter than a wave's `SPAWN_SCATTER_M` (14) because a handful of guards
 *  holding one post reads as a position, not a landing zone. */
export const GARRISON_SCATTER_M = 8;
const MIN_GUARDS = 3;
const MAX_GUARDS = 6;

/** 32-bit hash, for composition only — the identical two-line technique
 *  `EnemyLoop.ts` uses for the nest ring. Deliberately NOT used for any
 *  physical quantity: /core owns every number that matters, and this only
 *  decides which of its catalogue rows stand watch. */
function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
function unit01(a: number, b: number): number { return hash32(a, b) / 4294967296; }

/**
 * Who stands at a post, deterministic from `seed`.
 *
 * Uniform over whatever the catalogue currently holds, rather than weighted
 * by `weightNow`: a garrison is not the evolving threat curve, it is a fixed
 * cast for a fixed place, and reading `weightNow` here would make two players
 * who visit the same ruin a week apart meet a different garrison for a reason
 * that has nothing to do with the ruin.
 */
export function garrisonRoster(seed: number, catalogue: EnemyCatalogue): GarrisonMember[] {
  const rows = [...catalogue.all].sort((a, b) => a.id - b.id);
  if (rows.length === 0) return [];
  const n = MIN_GUARDS + Math.floor(unit01(seed, 1) * (MAX_GUARDS - MIN_GUARDS + 1));
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const t = rows[Math.floor(unit01(seed, i * 2 + 2) * rows.length) % rows.length];
    counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([typeId, count]) => ({ typeId, count }));
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * ONE tick of a garrison creature's own state machine, run BEFORE the shared
 * bite-or-march step in `EnemySwarm.step` so that generic step does the
 * actual moving and biting: `hold` and `return` both point `goal` at the
 * post, which is what makes a garrison creature stop near it (`march`'s own
 * direction-to-goal collapses to nothing once it arrives); `engage` points
 * `goal` at the player, so the existing reach check bites and the existing
 * march closes the distance, with NOTHING about combat reimplemented here.
 *
 * `return` DELIBERATELY IGNORES AGGRO UNTIL IT ARRIVES. A leash that
 * re-checked the player's distance every tick would re-trigger the instant it
 * fired whenever the player is still standing next to the creature when the
 * post crosses `LEASH_M` away, which is the ordinary case (a player who has
 * been fighting it at arm's length), and the leash would never actually
 * disengage anything. Ignoring aggro for the whole walk home is what makes
 * "beyond 60 m, disengage and return" a real return rather than a flicker.
 *
 * A creature already fighting at the wire — `hold` or `return`, with the
 * player in reach — still bites, through the ordinary top-of-step check in
 * `EnemySwarm.step` regardless of what this function decides. That is GP-89's
 * own rule ("the player wins every tie") applied with no garrison-shaped
 * exception carved into it.
 */
export function updateGarrisonState(c: Creature, playerPos: Vec3): void {
  if (c.post === null) return;
  if (c.garrisonState === 'engage') {
    if (dist(c.pos, c.post) > LEASH_M) c.garrisonState = 'return';
  } else if (c.garrisonState === 'hold') {
    if (dist(c.pos, playerPos) <= AGGRO_RADIUS_M) c.garrisonState = 'engage';
  } else if (c.garrisonState === 'return') {
    if (dist(c.pos, c.post) <= ARRIVE_M) c.garrisonState = 'hold';
  }
  c.goal = c.garrisonState === 'engage' ? playerPos : c.post;
}

// ---------------------------------------------------------------------------
// Wired into `Enemies` as two one-line methods, beside `EnemyCheats.ts`'s two
// for the identical reason: `Enemies.ts` is already near its 400-line cap.
// ---------------------------------------------------------------------------

/**
 * A GARRISON: creatures posted at `postPos` rather than dispatched by
 * /core's wave loop. Every CREATURE it produces is still built from /core's
 * own `EnemyType` row (health, dps, speed, reach are never re-authored here);
 * what is this file's own is only WHO stands there and WHEN they fight, and
 * neither one is a read of or a write to enemies.h (see the header above).
 *
 * Gated by `e.enabled` exactly like everything else `Enemies.ts` does: a
 * garrison in a SAFE world would be the one hole in GP-93's own claim that
 * sandbox-safe means no nests AT ALL — a placed guard that still bites is a
 * nest wearing a different name.
 */
export function spawnGarrison(e: Enemies, host: EnemyHost, postPos: Vec3,
                              seed: number): number {
  if (!e.enabled) return 0;
  const ctx = e.context(host);
  const made = e.swarm.spawnGarrison({ postPos, seed }, e.types, ctx);
  e.publishShootables(ctx);
  return made;
}

/** Metres east of the player's own feet a debug garrison is posted: clear of
 *  `AGGRO_RADIUS_M` even for a guard scattered `GARRISON_SCATTER_M` towards
 *  the player (45 - 8 = 37 m > 30 m), so a probe controls exactly when a
 *  walk-in triggers it, and close enough to `LEASH_M` that a retreat of a
 *  hundred-odd metres clears both the aggro radius and the leash in one
 *  move. */
const DEBUG_POST_OFFSET_M = 45;

/**
 * DEBUG ONLY, AND NAMED AS SUCH. `EnemyDebug.ts`'s header states the rule
 * this breaks and why every OTHER entry on that surface refuses to: a probe
 * that could conjure a WAVE would be proving a path no player can take. A
 * garrison is not a wave — it credits nothing to evolution and is never
 * dispatched by /core, as this whole file's header argues — so there is no
 * "attack that was not caused by the player's own production" for this to
 * fake. It exists only because the POI bridge that will call `spawnGarrison`
 * with a real ruin site has not landed; the day it has, this function is
 * deleted exactly as `EnemyLoop.seedNests` says its own client-side nest
 * seeding will be.
 */
export function spawnGarrisonDebug(e: Enemies, host: EnemyHost, seed: number): number {
  const f = host.walker.body.feet;
  const l = Math.hypot(f.x, f.y, f.z) || 1;
  const dir = { x: f.x / l, y: f.y / l, z: f.z / l };
  const postDir = offsetDir(dir, 0, DEBUG_POST_OFFSET_M, e.bodyRadiusM);
  return spawnGarrison(e, host, postDir, seed);
}
