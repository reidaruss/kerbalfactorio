// GP-106 / GP-107. THE TWO ENEMY CHEATS: peaceful mode, and kill everything.
//
// They sit beside `Enemies` rather than inside it for the same reason
// `EnemyDebug.ts` does, which is that `Enemies.ts` is a composition already near
// its 400-line cap and neither of these is a rule the swarm needs to know about.
// What matters far more than where they live is that BOTH GO THROUGH THE GAME'S
// OWN DAMAGE PATHS: `EnemySwarm.hit` and `EnemyLoop.damageNest` are the exact
// two calls `Enemies.onShotHit` makes when a bullet lands, so a world these
// buttons have been pressed in is a world something KILLED everything in, not a
// world where things quietly stopped existing.
//
// That distinction is measurable and the probe measures it: `swarm.killed` and
// `nestsKilled` move by the right amounts, and /core's own evolution still gets
// its `fromKills` credit on the slow tick, exactly as it would from 23 rounds of
// rifle fire.

import type { Enemies } from './Enemies.js';

/**
 * Turn peaceful on or off. Returns how many live creatures it killed, which is
 * 0 when turning it off.
 *
 * Turning it ON kills the swarm, and does so through `hit` rather than through
 * `EnemySwarm.clear()`, which exists, is exported and has no caller. Two
 * reasons, and the second is the real one. `clear()` does not credit `killed`,
 * so a run that went peaceful would silently lose creatures out of the ledger
 * and the counters would stop adding up. And `clear()` empties the array in
 * place, which skips the reap at the top of `EnemySwarm.step` that the view's
 * instanced-slot release is keyed on, so the bodies would leave the simulation
 * and stay drawn, parked mid-stride where they died.
 */
export function setPeaceful(e: Enemies, on: boolean): number {
  e.peaceful = on;
  return on ? killCreatures(e) : 0;
}

/**
 * KILL ALL ENEMIES: every creature and every nest.
 *
 * THE NESTS ARE INCLUDED, and that is the decision rather than an over-reach. A
 * button that killed only the creatures is a button the player presses again in
 * ninety seconds, because the nests are the cause: they are still standing, they
 * are still absorbing the same pollution off the same base, and the next wave is
 * already on its way. Reid asked for "kill all enemies" and a nest is an enemy.
 *
 * The two counts come back separately so the toast can say which of them
 * actually did anything, and so a probe can tell "nothing was alive" apart from
 * "nothing happened", which are the two outcomes a single boolean would blur.
 */
export function killAll(e: Enemies): { creatures: number; nests: number } {
  const creatures = killCreatures(e);
  let nests = 0;
  // A COPY of the list, because `damageNest` re-reads the nest rows from /core
  // on every call and would otherwise be mutating the array being walked.
  for (const n of [...e.loop.nests]) {
    if (e.loop.damageNest(n.id, n.health)) { nests++; e.nestsKilled++; }
  }
  e.loop.readNests();
  return { creatures, nests };
}

/** `hit` only takes the hp to zero; the reap and the `killed` credit happen at
 *  the top of the next `EnemySwarm.step`, which is exactly what a shot does. */
function killCreatures(e: Enemies): number {
  let n = 0;
  for (const c of [...e.swarm.live]) if (e.swarm.hit(c, c.hp)) n++;
  return n;
}
