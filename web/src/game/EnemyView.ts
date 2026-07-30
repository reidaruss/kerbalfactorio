// DRAWING THE SWARM: one BatchedMesh, one material, and a pool that GROWS.
//
// GP-90 / DW-28 BINDING. This project has already shipped one silent instance
// cap. `MachineBatch` was fixed at 256, past it `acquire` returned -1, the view
// skipped, and a 900-machine base was byte-identical on screen to a 150-machine
// one while every budget indicator read `ok`. DW-28 made growth the rule and
// loudness the contract, and a swarm is the single most likely place to meet it
// again, because a wave is up to `maxWaveSize` (100) creatures and several waves
// can be alive at once with nobody having placed anything.
//
// So: the pool doubles from its start size up to the shared 16,384 ceiling, the
// refusal count is published through `registerPool` (which is what puts
// `POOL FULL: n NOT DRAWN` on the HUD for free), it prints once to the console,
// and `Enemies.ts` also FLASHES it on screen, because an enemy nobody can see is
// worse than a building nobody can see: a building that is not drawn is merely
// invisible, and a creature that is not drawn is invisible AND biting you.
//
// THE SECOND CEILING IS NOT MINE AND IS PUBLISHED ANYWAY. `of_en_waves_truncated`
// rises when /core capped a wave at `maxWaveSize` with pollution left to spend,
// at which point wave size is being set by a constant rather than by the
// player's own production and the design's headline proportionality is no longer
// what a player sees. It goes on the same report line as `refused` so the two
// are read together.

import * as THREE from 'three';
import { MAX_CAPACITY, registerPool, type PoolReport } from './InstancePools.js';
import { creatureGeometry, enemyMaterial, nestGeometry, NEST_RADIUS_M }
  from './EnemyArt.js';
import type { EnemyType } from './EnemyTypes.js';
import type { Vec3 } from './EnemyLoop.js';

/** The geometry key a nest is drawn with. Creature keys are their type names. */
export const NEST_KEY = 'nest';

/**
 * Build the stand-on-a-sphere rotation basis into `out`: the body's up is its
 * own radial, its forward the tangent heading, re-orthogonalised because a
 * heading one march step old is a fraction of a degree out of plane and a
 * non-orthogonal basis shears the mesh (RN-122: shared by the batch and the
 * skinned spider rigs so there is exactly ONE derivation of "standing").
 * Writes rotation and scale; the caller sets position.
 */
export function standBasis(out: THREE.Matrix4, up: Vec3, fwd: Vec3,
                           scale: number, tmpA: THREE.Vector3,
                           tmpB: THREE.Vector3, tmpC: THREE.Vector3): void {
  const uy = tmpA.set(up.x, up.y, up.z).normalize();
  const uz = tmpB.set(fwd.x, fwd.y, fwd.z);
  uz.addScaledVector(uy, -uz.dot(uy));
  if (uz.lengthSq() < 1e-12) uz.set(uy.z, uy.x, uy.y);
  uz.normalize();
  const ux = tmpC.crossVectors(uy, uz);
  out.makeBasis(ux, uy, uz);
  out.scale(tmpA.set(scale, scale, scale));
}

/**
 * Instances this pool STARTS with, and it is deliberately SMALLER than one
 * wave's maximum roster (`enemies.h`'s `maxWaveSize` is 100).
 *
 * That is the opposite of what looks prudent and it is the point. The shared
 * `InstancePools.CAPACITY` of 256 is comfortably above anything a single fight
 * produces, so a pool starting there would NEVER grow, the growth path would
 * never run outside a test written for it, and the first fight big enough to
 * need it would be the first time the code had ever executed. That is exactly
 * how the 256-machine wall of DW-28 survived: the path past the constant was
 * unreachable in normal play. Starting under one wave puts the doubling on the
 * ORDINARY path, so `grows` is above zero in every real fight and a probe can
 * assert it. The cost is a couple of `setInstanceCount` calls per wave.
 */
export const ENEMY_POOL_START = 32;

export interface OriginPort {
  toEngine(p: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3;
}

export class EnemyView {
  readonly group = new THREE.Group();
  readonly material = enemyMaterial();
  private mesh: THREE.BatchedMesh | null = null;
  private readonly geomId = new Map<string, number>();
  private readonly free: number[] = [];
  private live = 0;
  private cap: number;
  private grows = 0;
  private refused = 0;
  private warned = false;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly ta = new THREE.Vector3();
  private readonly tb = new THREE.Vector3();
  private readonly tc = new THREE.Vector3();

  /** `capacity` is a STARTING size and never a limit; see `ENEMY_POOL_START`.
   *  The argument order matches `MachineBatch` so the two pools read alike. */
  constructor(private readonly origin: OriginPort,
              capacity = ENEMY_POOL_START,
              private readonly name = 'enemies',
              private readonly ceiling = MAX_CAPACITY) {
    this.group.name = name;
    this.cap = Math.max(1, Math.min(capacity, ceiling));
    registerPool(this);
  }

  /** Build one geometry per catalogue row plus the nest. Two passes, for the
   *  reason `NodeBatch` documents: a BatchedMesh sizes its vertex and index
   *  pools at construction, so the totals must be known before it exists. */
  build(types: readonly EnemyType[]): void {
    if (this.mesh !== null) return;
    const per = new Map<string, THREE.BufferGeometry>();
    for (const t of types) per.set(t.name, creatureGeometry(t.tint));
    per.set(NEST_KEY, nestGeometry());
    let verts = 0;
    let idx = 0;
    for (const g of per.values()) {
      verts += (g.getAttribute('position') as THREE.BufferAttribute).count;
      idx += g.getIndex()?.count ?? 0;
    }
    if (verts === 0) return;
    const mesh = new THREE.BatchedMesh(this.cap, verts, idx, this.material);
    mesh.name = this.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A wave arrives from up to a kilometre away, so unlike the factory this one
    // genuinely wants per-object culling: most of the swarm is behind the player
    // most of the time.
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = false;
    for (const [key, g] of per) this.geomId.set(key, mesh.addGeometry(g));
    this.mesh = mesh;
    this.group.add(mesh);
  }

  get capacity(): number { return this.cap; }
  get ready(): boolean { return this.mesh !== null; }

  /** A slot drawing `key`, or -1 at the ceiling (counted, never silent). */
  acquire(key: string): number {
    const g = this.geomId.get(key);
    if (this.mesh === null || g === undefined) return -1;
    const reuse = this.free.pop();
    if (reuse !== undefined) {
      this.live++;
      this.mesh.setGeometryIdAt(reuse, g);
      return reuse;
    }
    if (this.live >= this.cap && !this.grow()) return -1;
    this.live++;
    const slot = this.mesh.addInstance(g);
    this.mesh.setGeometryIdAt(slot, g);
    return slot;
  }

  private grow(): boolean {
    if (this.mesh === null) return false;
    const next = Math.min(this.ceiling, this.cap * 2);
    if (next <= this.cap) {
      this.refused++;
      if (!this.warned) {
        this.warned = true;
        console.error(`[of] instance pool '${this.name}' is FULL at ${this.cap}`
          + ' instances: creatures past this are alive and BITING but NOT DRAWN');
      }
      return false;
    }
    this.mesh.setInstanceCount(next);
    this.cap = next;
    this.grows++;
    return true;
  }

  release(slot: number): void {
    if (this.mesh === null || slot < 0 || this.free.includes(slot)) return;
    this.mesh.setVisibleAt(slot, false);
    this.free.push(slot);
    this.live = Math.max(0, this.live - 1);
  }

  /**
   * Stand one body on the ground, facing where it is going.
   *
   * The basis is built from the creature's OWN up (its radial) and its own
   * tangent heading, so on a 600 km sphere a creature a kilometre away leans
   * with the horizon instead of standing at the player's angle.
   */
  place(slot: number, pos: Vec3, up: Vec3, fwd: Vec3, scale: number): void {
    if (this.mesh === null || slot < 0) return;
    standBasis(this.m, up, fwd, scale, this.ta, this.tb, this.tc);
    this.origin.toEngine(pos, this.p);
    this.m.setPosition(this.p);
    this.mesh.setMatrixAt(slot, this.m);
    this.mesh.setVisibleAt(slot, true);
  }

  /** The nest scale, so the caller does not need the art module. */
  get nestScaleM(): number { return NEST_RADIUS_M; }

  stats(): PoolReport {
    return {
      name: this.name, batches: this.mesh === null ? 0 : 1,
      instances: this.live, capacity: this.cap, ceiling: this.ceiling,
      grows: this.grows, refused: this.refused,
    };
  }
}
