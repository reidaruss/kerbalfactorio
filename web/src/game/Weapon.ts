// THE GUN. Hitscan, infinite ammo, and the rule with none of the pictures in it.
//
// HITSCAN AND NOT A PROJECTILE, and the reason is not that it is cheaper (it is,
// but that would be a weak argument on its own). Four reasons in order of
// weight:
//
//   1. A PROJECTILE IS A SECOND PHYSICS MODEL. DW-12 says there is no physics
//      engine: the player is a kinematic walker resolved against a surface
//      oracle. A bullet would need its own per-tick integration in the body
//      frame, its own broadphase against moving enemies, and its own answer to
//      "where is the ground", which is standing rule 1's exact trap. That is a
//      second authority on motion for the sake of one verb.
//   2. HITSCAN CANNOT MISS FOR A REASON THE PLAYER CANNOT SEE. The shot is the
//      SAME ray `Gameplay.aim` already builds for the crosshair, so what the
//      crosshair is on and what the shot hits are one computation. With a
//      projectile they are two, and the day they disagree the player is told
//      they missed a thing they were looking at.
//   3. THE ENEMIES DO NOT ARGUE FOR LEAD. `enemies.h`'s roster runs 3.4 to
//      6.0 m/s with reaches of 1.5 to 12 m. At a base fight's ranges the lead a
//      projectile would demand is under one frame, so the skill it adds is not
//      a skill, it is a latency.
//   4. THE TRACER IS A RENDERING CHOICE, NOT A SIMULATION ONE. A beam drawn
//      from the muzzle to the hit point and faded over 60 ms reads exactly like
//      a projectile and costs one instanced quad. The thing a player actually
//      wants from a bullet is the picture, and the picture is free.
//
// INFINITE AMMO, per Reid, and it is stated here rather than implied by the
// absence of a counter: `shotsFired` still rises, so "the gun is not firing" and
// "the gun fired and nothing happened" are different pictures. An absent counter
// would make them the same one.
//
// WHAT IS NOT HERE. No muzzle flash, no tracer, no sound: those are `WeaponFx`.
// This file is a cooldown, a ray and a damage number, and it is testable with no
// renderer and no audio context.

/** Anything a shot can hit. Supplied by whoever owns the population, so this
 *  file never learns what an enemy is. */
export interface Hittable {
  /** Body-frame centre, metres. */
  pos: { x: number; y: number; z: number };
  /** Bounding sphere. A miss inside this is a miss the player will dispute. */
  radiusM: number;
  /** Opaque to this file. The caller uses it to find the thing again. */
  ref: unknown;
}

export interface ShotHit {
  ref: unknown;
  /** Body-frame point the ray met the sphere. */
  point: { x: number; y: number; z: number };
  distM: number;
  damage: number;
}

export interface ShotResult {
  fired: boolean;
  /** Why not, when `fired` is false. Empty when it fired. A refusal that says
   *  nothing is indistinguishable from a gun that is not wired. */
  refusal: string;
  /** Where the shot ended: the target, the ground, or the end of its range. */
  end: { x: number; y: number; z: number };
  hit: ShotHit | null;
  /** True when the shot ended on terrain rather than in the air or on a target.
   *  Drives which impact the effects layer plays. */
  ground: boolean;
}

/** Every balance number for the gun, in one place, authored as data. */
export interface WeaponTuning {
  damage: number;
  /** Rounds per minute. 400 is a measured, readable cadence: fast enough to
   *  feel automatic, slow enough that each report is a separate sound. */
  rpm: number;
  rangeM: number;
  /** Metres of ground stepped per march sample when looking for terrain. 0.35 m
   *  over 120 m is 343 samples, which is one oracle call each and cheap. */
  marchStepM: number;
}

export const GUN: WeaponTuning = {
  damage: 22,
  rpm: 400,
  rangeM: 120,
  marchStepM: 0.35,
};

/** The live ground, as a port. Standing rule 1: this file never decides where
 *  the surface is, it asks, and GP-28 is the reason there is no default. */
export type GroundRadius = (x: number, y: number, z: number) => number;

function sub(a: { x: number; y: number; z: number },
             b: { x: number; y: number; z: number }) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Nearest ray/sphere intersection in front of the origin, or -1.
 *
 * The `t < 0` rejection is what stops a shot hitting something BEHIND the
 * player: without it a target one metre back scores a perfect hit at the same
 * distance as one a metre ahead, and the symptom is enemies dying while the
 * player faces away from them.
 */
export function raySphere(o: { x: number; y: number; z: number },
                          d: { x: number; y: number; z: number },
                          c: { x: number; y: number; z: number },
                          r: number): number {
  const m = sub(o, c);
  const b = m.x * d.x + m.y * d.y + m.z * d.z;
  const cc = m.x * m.x + m.y * m.y + m.z * m.z - r * r;
  // Already inside the sphere: a hit at zero range, which is right for a muzzle
  // pressed against something.
  if (cc <= 0) return 0;
  if (b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? -1 : t;
}

export class Weapon {
  readonly tuning = GUN;
  /** Rises on every shot that LEAVES the barrel, whether or not it hits. */
  shotsFired = 0;
  shotsHit = 0;
  damageDealt = 0;
  /** Refusals, by reason, so a gun that will not fire says why. */
  refusals = 0;
  lastRefusal = '';
  private cooldown = 0;

  /** Seconds between rounds, derived from rpm so a rebalance is one number. */
  get shotIntervalSecs(): number {
    return this.tuning.rpm > 0 ? 60 / this.tuning.rpm : 0.15;
  }
  get ready(): boolean { return this.cooldown <= 0; }
  /** 0 just fired, 1 ready. The HUD draws this so the cadence is visible. */
  get charge(): number {
    const i = this.shotIntervalSecs;
    return i > 0 ? Math.max(0, Math.min(1, 1 - this.cooldown / i)) : 1;
  }

  step(dt: number): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /**
   * Pull the trigger.
   *
   * `targets` is whatever the caller currently believes is shootable. It is
   * passed per shot rather than held, deliberately: a weapon that cached a
   * target list would keep shooting things that had died between frames, and
   * this way the list cannot go stale by construction.
   */
  fire(origin: { x: number; y: number; z: number },
       dir: { x: number; y: number; z: number },
       targets: readonly Hittable[],
       ground: GroundRadius): ShotResult {
    const end = {
      x: origin.x + dir.x * this.tuning.rangeM,
      y: origin.y + dir.y * this.tuning.rangeM,
      z: origin.z + dir.z * this.tuning.rangeM,
    };
    if (this.cooldown > 0) {
      this.refusals++;
      this.lastRefusal = 'cycling';
      return { fired: false, refusal: 'cycling', end, hit: null, ground: false };
    }
    this.cooldown = this.shotIntervalSecs;
    this.shotsFired++;

    // 1. THE NEAREST TARGET IN FRONT. Nearest and not first, because a swarm
    //    arrives overlapping and hitting the one furthest back through the one
    //    in your face is the bug every naive pick has.
    let best: Hittable | null = null;
    let bestT = Infinity;
    for (const t of targets) {
      const d = raySphere(origin, dir, t.pos, t.radiusM);
      if (d < 0 || d > this.tuning.rangeM || d >= bestT) continue;
      bestT = d;
      best = t;
    }

    // 2. THE GROUND, marched with the LIVE oracle (GP-28). A shot that passed
    //    through a hillside to hit something on the far side would be a second
    //    definition of where the ground is, and this project has paid for that
    //    five times. The march stops at the first sample under the surface.
    let groundT = Infinity;
    const step = this.tuning.marchStepM > 0 ? this.tuning.marchStepM : 0.5;
    for (let s = step; s <= this.tuning.rangeM; s += step) {
      // Past a target there is nothing left to occlude, so stop early.
      if (s > bestT) break;
      const px = origin.x + dir.x * s;
      const py = origin.y + dir.y * s;
      const pz = origin.z + dir.z * s;
      const r = Math.hypot(px, py, pz);
      if (r <= ground(px, py, pz)) { groundT = s; break; }
    }

    if (best !== null && bestT <= groundT) {
      const point = {
        x: origin.x + dir.x * bestT,
        y: origin.y + dir.y * bestT,
        z: origin.z + dir.z * bestT,
      };
      this.shotsHit++;
      this.damageDealt += this.tuning.damage;
      return {
        fired: true, refusal: '', end: point, ground: false,
        hit: { ref: best.ref, point, distM: bestT, damage: this.tuning.damage },
      };
    }
    if (groundT < Infinity) {
      return {
        fired: true, refusal: '', ground: true, hit: null,
        end: { x: origin.x + dir.x * groundT, y: origin.y + dir.y * groundT,
          z: origin.z + dir.z * groundT },
      };
    }
    return { fired: true, refusal: '', end, hit: null, ground: false };
  }

  report(): unknown {
    return {
      damage: this.tuning.damage, rpm: this.tuning.rpm,
      rangeM: this.tuning.rangeM,
      shotIntervalSecs: +this.shotIntervalSecs.toFixed(5),
      shotsFired: this.shotsFired, shotsHit: this.shotsHit,
      damageDealt: +this.damageDealt.toFixed(2),
      // INFINITE AMMO IS A DESIGN DECISION AND IS PUBLISHED AS ONE. A missing
      // field would read as an unimplemented magazine.
      ammo: 'infinite',
      ready: this.ready, charge: +this.charge.toFixed(4),
      refusals: this.refusals, lastRefusal: this.lastRefusal,
    };
  }
}
