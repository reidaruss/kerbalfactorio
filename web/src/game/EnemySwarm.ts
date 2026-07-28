// THE CREATURES: what /core's waves become once they are in the world.
//
// GP-89. A CREATURE IS A MARCH, NOT A PATHFINDER, and that is DW-12 restated
// rather than laziness. There is no physics engine and no navmesh in this game:
// the player is a kinematic capsule resolved against the surface oracle, and a
// creature is the same idea with a goal. It walks the great circle towards what
// the wave was aimed at, and its radius is read LIVE off the oracle every step
// (standing rule 1, GP-28's no-default port), so it climbs the hill the player
// dug and cannot float over a crater.
//
// WHAT THAT BUYS, AND WHAT IT COSTS. It buys a creature that can never disagree
// with the drawn ground, which is the class of bug this project has paid for five
// times. It costs walls: nothing here steers around a building. The design answer
// is that it does not need to, because a creature STOPS AND ATTACKS the first
// thing of the player's within its reach, so a wall in the way is chewed rather
// than walked past, which is Factorio's own behaviour and is why a wall is worth
// building. What is honestly missing is that a wall which is already RUBBLE
// (0 hp) is no longer a target and the creature walks through where it stands;
// see GP-94 in the controller file, where removal is named as the next step
// rather than half-done here.
//
// GP-92. A CREATURE KILL CREDITS NOTHING. `enemies.h` evolves on three inputs
// and one of them is NESTS destroyed, not creatures, so crediting a creature
// would mean inventing a fourth input in TypeScript: a second answer to "why is
// the difficulty rising", which is exactly the two-authority failure the whole
// enemy seam is arranged to avoid. Killing the wave saves your base and costs
// the nest its pollution; killing the NEST is what moves the number, and that is
// why a nest is a shootable thing in the world (`Enemies.ts`).

import type { EnemyType, EnemyTypes } from './EnemyTypes.js';
import type { Vec3, WaveRow } from './EnemyLoop.js';
import type { TargetRow } from './EnemyTargets.js';
import type { HurtSource } from './PlayerHealth.js';

/** One creature. The view keys its instance slot off `id`, so nothing here
 *  knows a renderer exists. */
export interface Creature {
  id: number;
  typeId: number;
  type: EnemyType;
  nest: number;
  waveId: number;
  pos: Vec3;
  /** Tangent heading, kept so a stopped creature still faces its meal. */
  facing: Vec3;
  hp: number;
  maxHp: number;
  /** Body-frame point it is walking to: what the wave was aimed at. */
  goal: Vec3;
  /** '' while marching, 'player', or the health key it is chewing. */
  biting: string;
  /** Ticks until this creature re-scans for something to bite. Staggered on
   *  spawn so a 100-strong wave never scans on one tick. */
  scanIn: number;
}

/** Ticks between a marching creature's target scans. Six is 0.1 s, far finer
 *  than anything a 6 m/s walker can cross, and it divides the O(creatures x
 *  buildings) scan cost by six. */
const SCAN_TICKS = 6;

/** Extra reach allowed against the PLAYER, because a player is a moving 1.8 m
 *  capsule and a building is a fixed box: without it a Skitterer at 1.5 m reach
 *  can never quite land a bite on somebody backing away. */
const PLAYER_REACH_BONUS_M = 0.8;

/** How far off the wave's aim point a creature is allowed to spawn, so 50 of
 *  them do not stand inside one another at the nest. */
const SPAWN_SCATTER_M = 14;

export interface SwarmContext {
  /** GP-28: the LIVE surface, as a port with no default. */
  groundRadius(x: number, y: number, z: number): number;
  /** Body-frame feet position. */
  playerPos: Vec3;
  /** Everything of the player's still standing, with its health key. */
  targets: readonly TargetRow[];
  /** Spend damage on a building. Returns what actually landed. */
  damageBuilding(key: string, amount: number): { applied: number; destroyed: boolean };
  bodyRadiusM: number;
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export class EnemySwarm {
  readonly live: Creature[] = [];
  /** Rebuilt every tick from whatever is in reach of the player. `PlayerHealth`
   *  spends `dt` against these and knows nothing else about an enemy. */
  readonly hurtSources: HurtSource[] = [];
  private nextId = 1;
  /** Ledger. Every one of these is a number a probe can hold this file to. */
  spawned = 0;
  killed = 0;
  /** Spawns refused because the catalogue had no row for the type id. Must be
   *  0; see `EnemyTypes.byId` for why this is not a silent default. */
  spawnsRefused = 0;
  damageToBuildings = 0;
  buildingsDestroyed = 0;
  attacksOnPlayer = 0;

  /**
   * Turn one `AttackWave` into creatures.
   *
   * The roster is /core's, the count is /core's and the aim is /core's. What is
   * decided here is only WHERE each body stands at the moment it appears, and it
   * is scattered around the nest rather than stacked on it because 50 spheres at
   * one point is one sphere as far as a shot is concerned.
   */
  spawn(w: WaveRow, types: EnemyTypes, ctx: SwarmContext): number {
    const goal = onGround(w.targetDir, ctx);
    let made = 0;
    for (const m of w.members) {
      const t = types.byId(m.typeId);
      if (t === null) { this.spawnsRefused += m.count; continue; }
      for (let k = 0; k < m.count; k++) {
        const a = (made * 2.399963) % (Math.PI * 2);
        const r = SPAWN_SCATTER_M * Math.sqrt(((made * 7 + 3) % 23) / 23);
        const pos = scatter(w.originDir, a, r, ctx);
        this.live.push({
          id: this.nextId++, typeId: t.id, type: t, nest: w.sourceNest,
          waveId: w.id, pos, facing: norm({ x: goal.x - pos.x, y: goal.y - pos.y,
            z: goal.z - pos.z }),
          hp: t.health, maxHp: t.health, goal, biting: '',
          scanIn: made % SCAN_TICKS,
        });
        made++;
        this.spawned++;
      }
    }
    return made;
  }

  /**
   * ONE fixed tick for every creature: engage, or walk.
   *
   * THE PLAYER WINS EVERY TIE, and that is a design decision rather than an
   * ordering accident: a swarm that preferred the nearest belt would be a
   * spectacle rather than a threat, and the whole reason player health exists
   * (GP-79) is that the fight has to be able to reach you.
   */
  step(dt: number, ctx: SwarmContext): void {
    this.hurtSources.length = 0;
    const playerReach = PLAYER_REACH_BONUS_M;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      if (c.hp <= 0) { this.live.splice(i, 1); this.killed++; continue; }

      const dPlayer = dist(c.pos, ctx.playerPos);
      if (dPlayer <= c.type.reachM + playerReach) {
        c.biting = 'player';
        this.attacksOnPlayer++;
        this.face(c, ctx.playerPos);
        // The DAMAGE is not applied here. `PlayerHealth.step` spends `dt`
        // against this list, so there is exactly one place the player's health
        // changes and exactly one place invulnerability is honoured (GP-79).
        this.hurtSources.push({ name: c.type.name, dps: c.type.damagePerSecond,
          reachM: c.type.reachM + playerReach, distM: dPlayer });
        continue;
      }

      const held = c.biting !== '' && c.biting !== 'player'
        ? ctx.targets.find((t) => t.key === c.biting) : undefined;
      let bite = held !== undefined
        && dist(c.pos, held.pos) <= c.type.reachM + held.radiusM ? held : undefined;
      if (bite === undefined) {
        if (c.scanIn > 0) { c.scanIn--; } else {
          c.scanIn = SCAN_TICKS;
          bite = nearestInReach(c, ctx.targets);
        }
      }
      if (bite !== undefined) {
        c.biting = bite.key;
        this.face(c, bite.pos);
        const r = ctx.damageBuilding(bite.key, c.type.damagePerSecond * dt);
        this.damageToBuildings += r.applied;
        if (r.destroyed) { this.buildingsDestroyed++; c.biting = ''; }
        continue;
      }
      c.biting = '';
      this.march(c, dt, ctx);
    }
  }

  /** Turn towards a point, in the tangent plane at the creature's own feet. */
  private face(c: Creature, at: Vec3): void {
    const d = tangentTowards(c.pos, at);
    if (d !== null) c.facing = d;
  }

  /**
   * One step along the great circle towards the goal, then back onto the ground.
   *
   * THE RADIUS IS RE-READ EVERY STEP rather than carried. Carrying it is how a
   * creature ends up walking at the height it spawned at, across a crater the
   * player dug an hour later, and it is the same defect `Machines`/`Grid` shipped
   * with a literal 0 for the edit set until GP-28.
   */
  private march(c: Creature, dt: number, ctx: SwarmContext): void {
    const d = tangentTowards(c.pos, c.goal);
    if (d === null) return;
    c.facing = d;
    const s = c.type.speedMps * dt;
    const p = { x: c.pos.x + d.x * s, y: c.pos.y + d.y * s, z: c.pos.z + d.z * s };
    c.pos = onGround(p, ctx, c.type.radiusM);
  }

  /** A shot landing. Returns the creature if this killed it. */
  hit(c: Creature, damage: number): boolean {
    if (!(damage > 0) || c.hp <= 0) return false;
    c.hp = Math.max(0, c.hp - damage);
    return c.hp <= 0;
  }

  /** Everything gone, for a world reload. */
  clear(): void {
    this.live.length = 0;
    this.hurtSources.length = 0;
  }

  report(): unknown {
    const byType = new Map<string, number>();
    for (const c of this.live) byType.set(c.type.name, (byType.get(c.type.name) ?? 0) + 1);
    let biting = 0;
    let onPlayer = 0;
    for (const c of this.live) {
      if (c.biting === 'player') onPlayer++;
      else if (c.biting !== '') biting++;
    }
    return {
      live: this.live.length,
      byType: Object.fromEntries(byType),
      spawned: this.spawned, killed: this.killed,
      spawnsRefused: this.spawnsRefused,
      bitingBuildings: biting, bitingPlayer: onPlayer,
      damageToBuildings: +this.damageToBuildings.toFixed(2),
      buildingsDestroyed: this.buildingsDestroyed,
      attacksOnPlayer: this.attacksOnPlayer,
      // The list `PlayerHealth` is about to spend `dt` against, and the worst
      // rate in it. Zero sources while `live` is high is the picture of a swarm
      // that has arrived and cannot reach, which is a different defect from a
      // swarm that never arrived, and both read as "no damage taken".
      hurtSources: this.hurtSources.length,
      worstDps: this.hurtSources.reduce((a, s) => Math.max(a, s.dps), 0),
    };
  }
}

/** The tangent-plane direction from `from` towards `to`, or null when they are
 *  the same point or one is straight above the other. */
export function tangentTowards(from: Vec3, to: Vec3): Vec3 | null {
  const up = norm(from);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const radial = dx * up.x + dy * up.y + dz * up.z;
  const tx = dx - radial * up.x;
  const ty = dy - radial * up.y;
  const tz = dz - radial * up.z;
  const l = Math.hypot(tx, ty, tz);
  if (!(l > 1e-6)) return null;
  return { x: tx / l, y: ty / l, z: tz / l };
}

/** Put a body-frame point (or a direction) on the ground, `lift` metres up. */
export function onGround(p: Vec3, ctx: SwarmContext, lift = 0): Vec3 {
  const d = norm(p);
  const r = ctx.groundRadius(d.x, d.y, d.z) + lift;
  return { x: d.x * r, y: d.y * r, z: d.z * r };
}

function scatter(dir: Vec3, bearing: number, distM: number,
                 ctx: SwarmContext): Vec3 {
  const d = norm(dir);
  const a = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const e = norm({ x: a.y * d.z - a.z * d.y, y: a.z * d.x - a.x * d.z,
    z: a.x * d.y - a.y * d.x });
  const n = { x: d.y * e.z - d.z * e.y, y: d.z * e.x - d.x * e.z,
    z: d.x * e.y - d.y * e.x };
  const t = distM / ctx.bodyRadiusM;
  const bx = e.x * Math.cos(bearing) + n.x * Math.sin(bearing);
  const by = e.y * Math.cos(bearing) + n.y * Math.sin(bearing);
  const bz = e.z * Math.cos(bearing) + n.z * Math.sin(bearing);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return onGround({ x: d.x * c + bx * s, y: d.y * c + by * s, z: d.z * c + bz * s },
    ctx, 0.6);
}

function nearestInReach(c: Creature, targets: readonly TargetRow[]):
    TargetRow | undefined {
  let best: TargetRow | undefined;
  let bestD = Infinity;
  for (const t of targets) {
    const d = dist(c.pos, t.pos);
    if (d > c.type.reachM + t.radiusM || d >= bestD) continue;
    bestD = d;
    best = t;
  }
  return best;
}
