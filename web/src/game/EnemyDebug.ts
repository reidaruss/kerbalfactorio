// THE ENEMY HALF OF `window.__of`, kept in this lane rather than in
// `app/DebugGameplay.ts`, so the surface a probe drives and the reasoning behind
// it sit in the same directory and that file gains six lines rather than forty.
//
// EVERY ENTRY GOES THROUGH THE GAME'S OWN PATH, which is `DebugGameplay.ts`'s
// stated rule and the only thing that keeps a driven run meaningful. There is
// deliberately NO `spawn`, NO `wave` and NO `kill`: a probe that could conjure a
// wave would be verifying a path no player can take, and worse, it would be
// verifying the exact thing this whole design is built to avoid, which is an
// attack that was not caused by the player's own production. The one thing that
// IS offered is TIME, through the same `of_en_step` the fixed tick calls, and a
// world with nothing polluting advances through it and dispatches nothing.

import type { Enemies, EnemyHost } from './Enemies.js';

export interface LatLonPort {
  latLonFromDir(dx: number, dy: number, dz: number): { lat: number; lon: number };
}

const DEG = 180 / Math.PI;

/** Nests as a probe needs them: where to STAND, not just which way to look. A
 *  nest is 5 m across, so a probe that teleports onto one is inside its own
 *  bounding sphere and any shot at all reaches it. */
function nestRows(e: Enemies, ll: LatLonPort): unknown[] {
  return e.loop.nests.map((n) => {
    const p = ll.latLonFromDir(n.dir.x, n.dir.y, n.dir.z);
    return {
      id: n.id, generation: n.generation,
      latDeg: +(p.lat * DEG).toFixed(6), lonDeg: +(p.lon * DEG).toFixed(6),
      health: +n.health.toFixed(2), maxHealth: n.maxHealth,
      absorbed: +n.absorbedLifetime.toFixed(3),
      readiness: +n.fractionOfThreshold.toFixed(5),
      waves: n.wavesDispatched,
    };
  });
}

/** The creatures closest to the player, with the distance that decides whether
 *  they can bite. `hurtSources` counts the ones already in reach; this says how
 *  far the rest still have to come, which is the difference between "the wave
 *  has not arrived" and "the wave arrived and cannot reach". */
function nearest(e: Enemies, host: EnemyHost, ll: LatLonPort,
                 n: number): unknown[] {
  const f = host.walker.body.feet;
  const rows = e.swarm.live.map((c) => {
    // WHERE TO STAND, not just how far away: a probe proving that a wave can
    // reach the PLAYER has to be able to put the player in front of one, and
    // walking a kilometre in a driven run costs three minutes of wall clock.
    const r = Math.hypot(c.pos.x, c.pos.y, c.pos.z) || 1;
    const p = ll.latLonFromDir(c.pos.x / r, c.pos.y / r, c.pos.z / r);
    return {
      id: c.id, name: c.type.name, hp: +c.hp.toFixed(1), maxHp: c.maxHp,
      biting: c.biting, radiusM: c.type.radiusM,
      // Body frame, so a probe can check a shot's geometry against the same
      // sphere `Weapon.fire` tests rather than against a second copy of it.
      pos: [c.pos.x, c.pos.y, c.pos.z],
      latDeg: +(p.lat * DEG).toFixed(6), lonDeg: +(p.lon * DEG).toFixed(6),
      distM: +Math.hypot(c.pos.x - f.x, c.pos.y - f.y, c.pos.z - f.z).toFixed(3),
      reachM: c.type.reachM, dps: c.type.damagePerSecond,
    };
  });
  rows.sort((a, b) => a.distM - b.distM);
  return rows.slice(0, n);
}

export function enemyDebug(e: Enemies, host: EnemyHost, ll: LatLonPort,
                           op?: string | number, a?: number): unknown {
  if (op === 'advance') {
    // Ticks, at the 60 UPS SimClock, exactly as `of_en_step` defines them.
    return { spawned: e.advance(host, Number(a ?? 3600)),
      ...(e.report() as object) };
  }
  if (op === 'nests') return nestRows(e, ll);
  if (op === 'near') return nearest(e, host, ll, Number(a ?? 8));
  return {
    ...(e.report() as object),
    nestRows: nestRows(e, ll),
    near: nearest(e, host, ll, 6),
  };
}
