// THE ENEMY SUBSYSTEM, COMPOSED: the cause, the creatures, the bodies and the
// two ends of combat. `Gameplay` holds one of these and calls two methods.
//
// It is its own file rather than fifteen more lines in `Gameplay` for the same
// reason `PersistLedger.ts` and `Gunnery.ts` are: that composition is ninety
// lines over the 400-line cap with four lanes inside it, and Admin's standing
// instruction is to extract rather than to grow it.
//
// GP-93. SANDBOX-SAFE MEANS NO NESTS AT ALL, AND THE REPORT SAYS SO. DW-31 makes
// sandbox a mode for playtesting without grind and GP-82 already decided that
// being killed while measuring a rocket is grind of the purest kind, so with
// `?combat=1` absent nothing is initialised, nothing is seeded and nothing walks.
// The report publishes `enabled: false` and the SENTENCE that says why, because
// DW-31's own lesson from `Structures.affordInCore` is that a mode which lifts a
// rule must publish the answer it is overriding: "0 waves" and "the wave path is
// broken" are otherwise the same picture.
//
// THE ORDER INSIDE `step` IS THE LOOP AND IT IS FIXED:
//   derive what the player owns -> hand it to /core -> /core dispatches ->
//   creatures spawn, walk and bite -> what is shootable is republished.
// `hurtSources` is rebuilt at the end of that, which is why `Gameplay.fixedStep`
// calls this BEFORE `vitals.step`: a tick where the two ran the other way round
// would spend damage against last tick's list, and the symptom would be a
// creature that keeps hurting you for one tick after it dies.

import { EnemyLoop, SYNC_TICKS, type EmitterRow, type Vec3, type WaveRow }
  from './EnemyLoop.js';
import { EnemyTypes } from './EnemyTypes.js';
import { EnemySwarm, type Creature, type SwarmContext } from './EnemySwarm.js';
import { EnemyView, NEST_KEY } from './EnemyView.js';
import { SpiderFlock } from './SpiderFlock.js';
import { killAll, setPeaceful } from './EnemyCheats.js';
import { spawnGarrison } from './EnemyGarrison.js';
import { emittersOf, targetsOf, type TargetPopulations, type TargetRow }
  from './EnemyTargets.js';
import type { Hittable } from './Weapon.js';
import type { HurtSource } from './PlayerHealth.js';
import type { HealthBook } from './Health.js';
import type { ModeRules } from './GameMode.js';
import type { OriginPort } from './EnemyView.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/** Everything this subsystem needs from the game, as ports. */
export interface EnemyHost extends TargetPopulations {
  seed: number;
  health: HealthBook;
  /**
   * D1. SPEND DAMAGE ON A BUILDING, through the host's own one door.
   *
   * This used to be `host.health.damage(...)` inlined in `context()` below, and
   * the reason it is a port now is the whole of D1: a building that reaches 0
   * has to actually FALL, and the removal needs four populations, two view
   * batches and a `GameCore` that this file has no business holding. The host
   * owns the consequence (`Gameplay.damage`); the swarm still only knows that
   * biting a key returns how much landed and whether that finished it.
   */
  damage(key: string, amount: number): { applied: number; destroyed: boolean };
  hud: { flash(text: string, secs?: number): void };
  /** GP-28: the LIVE surface, through the one call site that was always right. */
  structures: TargetPopulations['structures'] & {
    groundRadius(x: number, y: number, z: number): number;
  };
  walker: { body: { feet: { x: number; y: number; z: number } } };
  /** GP-287. /core's BodyParams::bodyId, so the life invariant can ask the
   *  atmosphere about THIS body. Gameplay already publishes it. */
  starterBodyId: number;
}

/** What a shot's `ref` is when it hit a nest rather than a creature. */
interface NestRef { nestId: number }

function isNestRef(r: unknown): r is NestRef {
  return typeof r === 'object' && r !== null && 'nestId' in r;
}

export class Enemies {
  readonly loop: EnemyLoop;
  readonly types = new EnemyTypes();
  readonly swarm = new EnemySwarm();
  readonly view: EnemyView;
  readonly spiders: SpiderFlock;
  /** Rebuilt every tick: creatures and nests, in that order. Passed to
   *  `Weapon.fire` per shot so it can never go stale (see Weapon.ts). */
  readonly shootables: Hittable[] = [];
  /** True once `init` has run and the mode allows danger. */
  enabled = false;
  /**
   * GP-106. PEACEFUL MODE, at RUNTIME, and a flag of its OWN rather than a
   * mutation of anything that already exists. The verbs are in EnemyCheats.ts.
   *
   * Not `ModeRules.hostile`: that is derived from an immutable mode and an
   * immutable boot flag, and `GameMode.ts` argues at length that neither may
   * move mid-session. That argument is still right and this does not contradict
   * it, because this does not claim the world is SAFE. It claims a cheat has
   * switched the CAUSE off, which in survival is recorded on the save (GP-102).
   *
   * Not `enabled` either. That means "the loop came up", and reusing it would
   * make `report().enabled` disagree with `report().hostile`, which
   * `probes/enemies.js` asserts are equal. Two facts, two fields (GP-29).
   */
  peaceful = false;
  /** The sentence a disabled subsystem publishes. See GP-93. */
  disabledWhy = 'not initialised';
  nestsKilled = 0;
  shotsIntoNests = 0;
  /** The last wave /core dispatched, WITH the emitter row it was aimed at and
   *  how far off that row's own direction it landed. This is the assertion the
   *  whole causal chain rests on: a wave timer would produce a wave with no
   *  emitter anywhere near its target, and every other counter in this report
   *  would look identical. */
  lastWave: {
    id: number; sourceNest: number; targetEmitter: number; totalCount: number;
    aimedAtKey: string; aimErrM: number;
  } | null = null;
  /** Whether the DW-28 pool refusal has already been shouted at the player. */
  private shouted = false;
  private targets: TargetRow[] = [];
  private emitters: EmitterRow[] = [];
  private sinceDerive = 0;
  /** Not `private`: the same reason `context` is not private either. It was
   *  also read by `EnemyGarrison.ts`'s debug spawn, which WG-169 deleted. */
  bodyRadiusM = 600000;
  private readonly nestSlots = new Map<number, number>();
  private readonly creatureSlots = new Map<number, number>();

  constructor(private readonly M: OfCoreModule,
              private readonly bodyHandle: number,
              origin: OriginPort,
              private readonly mode: ModeRules) {
    this.bodyRadiusM = M._of_body_radius(bodyHandle) || 600000;
    this.loop = new EnemyLoop(M, this.bodyRadiusM);
    this.view = new EnemyView(origin);
    // RN-122/RN-123: the skinned near-creature pool (view only, no sim
    // knowledge). Its group rides inside the view's group so the scene
    // wiring in Gameplay is untouched.
    this.spiders = new SpiderFlock(origin);
    this.view.group.add(this.spiders.group);
  }

  /**
   * Bring the loop up, read the catalogue, build the bodies and put the first
   * nests on the ring. Idempotent, and a no-op in a safe world.
   */
  init(host: EnemyHost, spawnDir: Vec3): boolean {
    if (!this.mode.hostile) {
      this.enabled = false;
      // GP-551. The decision IDs came off the sentence: this string is drawn on
      // the player's own menu, and a reason that cites a ticket number is a
      // reason written for the lane that wrote it. The wording a probe reads
      // ("sandbox is safe by default") is unchanged, deliberately.
      this.disabledWhy = 'sandbox is safe by default; '
        + 'add ?combat=1 to the address to make this world dangerous';
      return false;
    }
    if (!this.loop.init(this.bodyHandle, host.seed)) {
      this.enabled = false;
      this.disabledWhy = 'of_en_init refused: no such body handle';
      return false;
    }
    this.types.load(this.M);
    this.view.build(this.types.all);
    this.loop.seedNests(spawnDir, host.seed, host.starterBodyId);
    this.enabled = true;
    this.disabledWhy = '';
    return true;
  }

  get hurtSources(): readonly HurtSource[] { return this.swarm.hurtSources; }

  /** ONE fixed tick. See the header for why the order inside it is fixed. */
  step(dt: number, host: EnemyHost): void {
    if (!this.enabled) return;
    if (this.sinceDerive <= 0) {
      this.sinceDerive = SYNC_TICKS;
      this.targets = this.biteable(host);
      this.emitters = emittersOf(this.M, host);
      this.loop.sync(this.emitters);
      this.loop.readNests();
    }
    this.sinceDerive--;
    const ctx = this.context(host);
    // GP-106. PEACEFUL STOPS THE CAUSE AND NOT THE CONSEQUENCES. /core's clock
    // stops advancing and no wave is drained, so nothing new is ever dispatched;
    // everything below still runs, and that is the whole design rather than an
    // oversight. `EnemySwarm.step` is the only thing that CLEARS `hurtSources`
    // (it empties the list at its own top), and `Gameplay.fixedStep` spends that
    // list against the player unconditionally, so an early return here would
    // freeze the array populated and go on biting the player for ever in the
    // mode whose entire purpose is that nothing bites them. It is also what
    // reaps the creatures `setPeaceful` just killed and what lets `frame`
    // release their instanced slots, instead of parking corpses mid-stride.
    if (!this.peaceful) for (const w of this.loop.step()) this.take(w, ctx);
    this.swarm.step(dt, ctx);
    // The rig mixers advance HERE, on the fixed sim dt, never on a wall
    // clock: a headless capture must reproduce (same argument as
    // Avatar.animate on loop.simSecs). Which creature each rig shows is a
    // per-frame choice and stays in frame().
    this.spiders.update(dt);
    this.publishShootables(ctx);
    this.watchPool(host);
  }

  /** GP-106 / GP-107. The two cheat verbs, in EnemyCheats.ts so this file stays
   *  under its cap; the reasoning for both is over there beside them. */
  setPeaceful(on: boolean): number { return setPeaceful(this, on); }
  killAll(): { creatures: number; nests: number } { return killAll(this); }

  /**
   * Advance the CAUSE by `ticks` in one call, and spawn whatever it dispatched.
   *
   * The compression argument is in `EnemyLoop.stepMany`, and the thing worth
   * restating here is what is NOT compressed: the creatures still walk in real
   * sim time, still have to arrive, and still have to get within reach. This
   * moves the clock on the pollution field, nothing else.
   */
  advance(host: EnemyHost, ticks: number): number {
    if (!this.enabled) return 0;
    this.targets = this.biteable(host);
    this.emitters = emittersOf(this.M, host);
    this.loop.sync(this.emitters);
    const ctx = this.context(host);
    let made = 0;
    for (const w of this.loop.stepMany(ticks)) made += this.take(w, ctx);
    this.loop.readNests();
    this.publishShootables(ctx);
    return made;
  }

  /** A GARRISON: creatures posted at `postPos` rather than dispatched by
   *  /core's wave loop. In EnemyGarrison.ts, beside `EnemyCheats.ts`'s two for
   *  the same reason: this file is already near its 400-line cap.
   *
   *  WG-169: `RuinSites.garrison` is now the caller, with a real site position
   *  and the site id's low half as the seed. `spawnGarrisonDebug`, the synthetic
   *  post 45 m east of the player that stood in for it, is DELETED, exactly as
   *  its own header said it would be the day the POI bridge could place one. */
  spawnGarrison(host: EnemyHost, postPos: Vec3, seed: number): number {
    return spawnGarrison(this, host, postPos, seed);
  }

  /**
   * What is standing AND still has health.
   *
   * RUBBLE IS NOT A TARGET, and the filter is here rather than in
   * `EnemyTargets.ts` because that file derives from the populations and knows
   * nothing about the health book. Without it a creature that finished a
   * building goes on chewing the corpse for ever: `HealthBook.damage` on a
   * zero-hp key returns `applied: 0`, so the swarm would stall at the first
   * thing it broke and every counter would read healthy.
   *
   * D1 (GP-745 to GP-759) CLOSED THE OTHER HALF, and this filter is now a
   * belt-and-braces rather than the whole answer: a building that reaches 0 is
   * removed from its population the same tick (`Gameplay.damage` -> `fell`), so
   * it leaves `targetsOf` on the next derive anyway. The filter stays because
   * the derive is only every `SYNC_TICKS`, so for a few ticks the snapshot still
   * holds a row whose building is gone.
   */
  private biteable(host: EnemyHost): TargetRow[] {
    return targetsOf(host).filter((t) => host.health.hpOf(t.key) > 0);
  }

  /** One dispatched wave: spawn it, and record WHAT IT WAS AIMED AT. */
  private take(w: WaveRow, ctx: SwarmContext): number {
    let key = '';
    let err = Infinity;
    for (const e of this.emitters) {
      const d = Math.hypot(e.dir.x - w.targetDir.x, e.dir.y - w.targetDir.y,
        e.dir.z - w.targetDir.z) * this.bodyRadiusM;
      if (d >= err) continue;
      err = d;
      key = e.key;
    }
    this.lastWave = { id: w.id, sourceNest: w.sourceNest,
      targetEmitter: w.targetEmitter, totalCount: w.totalCount,
      aimedAtKey: key, aimErrM: err };
    return this.swarm.spawn(w, this.types, ctx);
  }

  /** Not `private`: `EnemyGarrison.ts`'s `spawnGarrison` builds the identical
   *  context a wave spawn does, for the identical reason `EnemyCheats.ts`
   *  reaches `swarm`/`loop` rather than duplicating them. */
  context(host: EnemyHost): SwarmContext {
    const f = host.walker.body.feet;
    return {
      groundRadius: (x, y, z) => host.structures.groundRadius(x, y, z),
      playerPos: { x: f.x, y: f.y, z: f.z },
      targets: this.targets,
      // D1. THE HOST'S DOOR, not the book's. `Gameplay.damage` moves the number
      // AND fells what the number finished; a call straight into the book here
      // would leave a "destroyed" wall standing, which is precisely the state
      // this file's own header spent two paragraphs apologising for.
      damageBuilding: (key, amount) => host.damage(key, amount),
      bodyRadiusM: this.bodyRadiusM,
    };
  }

  /**
   * Creatures first, then nests. Order is not decoration: `Weapon.fire` picks
   * the NEAREST hit rather than the first, so it does not matter for the shot,
   * and it does matter for a probe reading the list.
   */
  /** Not `private`, for the same reason `context` above is not. */
  publishShootables(ctx: SwarmContext): void {
    this.shootables.length = 0;
    for (const c of this.swarm.live) {
      this.shootables.push({ pos: c.pos, radiusM: c.type.radiusM, ref: c });
    }
    for (const n of this.loop.nests) {
      if (!(n.health > 0)) continue;
      const r = ctx.groundRadius(n.dir.x, n.dir.y, n.dir.z);
      this.shootables.push({
        pos: { x: n.dir.x * r, y: n.dir.y * r, z: n.dir.z * r },
        radiusM: this.view.nestScaleM, ref: { nestId: n.id } as NestRef,
      });
    }
  }

  /**
   * GP-86's seam, filled. A round arriving on a creature kills it; a round
   * arriving on a NEST is reported to /core, which is the only thing in this
   * whole subsystem that moves the evolution factor (GP-92).
   */
  onShotHit(ref: unknown, damage: number): void {
    if (isNestRef(ref)) {
      this.shotsIntoNests++;
      if (this.loop.damageNest(ref.nestId, damage)) this.nestsKilled++;
      return;
    }
    const c = ref as Creature;
    if (c === null || typeof c !== 'object' || typeof c.hp !== 'number') return;
    this.swarm.hit(c, damage);
  }

  /** DW-28. The shared HUD line already carries `POOL FULL`; this puts it in
   *  front of the player as well, once, because an undrawn creature is not
   *  merely invisible, it is invisible and biting. */
  private watchPool(host: EnemyHost): void {
    if (this.shouted || this.view.stats().refused === 0) return;
    this.shouted = true;
    host.hud.flash('ENEMY POOL FULL: creatures are alive and NOT DRAWN', 8);
  }

  /**
   * Per frame: put every body where it is, and give back the slots of the dead.
   *
   * SLOT OWNERSHIP IS A MAP KEYED BY IDENTITY, for creatures and for nests
   * alike, and the reap is a set difference against the live list rather than a
   * death event. That is the same argument `HealthCensus` makes: an event is a
   * thing a future call site can forget to raise, and a forgotten release here
   * leaks a pool slot per corpse, which walks straight into the DW-28 ceiling
   * this file exists to keep away from.
   */
  frame(host: EnemyHost): void {
    if (!this.enabled || !this.view.ready) return;
    // RN-123: the closest creatures are PROMOTED into skinned rigs and leave
    // the batch for as long as a rig holds them. A claimed creature's batch
    // slot is released here and lazily re-acquired the frame the claim
    // drops, which is the acquire path that already exists below.
    const f = host.walker.body.feet;
    const claimed = this.spiders.assign(this.swarm.live,
      { x: f.x, y: f.y, z: f.z });
    const liveIds = new Set<number>();
    for (const c of this.swarm.live) {
      liveIds.add(c.id);
      if (claimed.has(c.id)) {
        const held = this.creatureSlots.get(c.id);
        if (held !== undefined) {
          this.view.release(held);
          this.creatureSlots.delete(c.id);
        }
        continue;
      }
      let slot = this.creatureSlots.get(c.id);
      if (slot === undefined) {
        slot = this.view.acquire(c.type.name);
        if (slot < 0) continue;
        this.creatureSlots.set(c.id, slot);
      }
      const l = Math.hypot(c.pos.x, c.pos.y, c.pos.z) || 1;
      this.view.place(slot, c.pos,
        { x: c.pos.x / l, y: c.pos.y / l, z: c.pos.z / l }, c.facing,
        c.type.radiusM);
    }
    for (const [id, slot] of [...this.creatureSlots]) {
      if (liveIds.has(id)) continue;
      this.view.release(slot);
      this.creatureSlots.delete(id);
    }
    const scale = this.view.nestScaleM;
    const liveNests = new Set<number>();
    for (const n of this.loop.nests) {
      if (!(n.health > 0)) continue;
      liveNests.add(n.id);
      let slot = this.nestSlots.get(n.id);
      if (slot === undefined) {
        slot = this.view.acquire(NEST_KEY);
        if (slot < 0) continue;
        this.nestSlots.set(n.id, slot);
      }
      const r = host.structures.groundRadius(n.dir.x, n.dir.y, n.dir.z);
      const pos = { x: n.dir.x * r, y: n.dir.y * r, z: n.dir.z * r };
      const fwd = Math.abs(n.dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      this.view.place(slot, pos, n.dir, fwd, scale);
    }
    for (const [id, slot] of [...this.nestSlots]) {
      if (liveNests.has(id)) continue;
      this.view.release(slot);
      this.nestSlots.delete(id);
    }
  }

  report(): unknown {
    return {
      // FIRST, because it changes the meaning of every number below it.
      enabled: this.enabled,
      why: this.disabledWhy,
      hostile: this.mode.hostile,
      // GP-106. Beside `hostile` and never instead of it: one is what the world
      // IS and the other is what a cheat has done to it this session.
      peaceful: this.peaceful,
      nests: this.loop.nests.length,
      // GP-287. WHY there are none, when there are none. Beside the count
      // and never instead of it, the same way `why` sits beside `enabled`.
      lifeRefusedWhy: this.loop.lifeRefusedWhy,
      nestsSeeded: this.loop.nestsSeeded,
      nestsKilled: this.nestsKilled,
      shotsIntoNests: this.shotsIntoNests,
      wavesDispatched: this.loop.wavesDispatched,
      lastWave: this.lastWave,
      swarm: this.swarm.report(),
      shootables: this.shootables.length,
      emitters: { ...this.loop.emitterAudit(), refusals: this.loop.emitterRefusals,
        rows: this.emitters.map((e) => ({ key: e.key, rate: e.ratePerSec })) },
      targets: this.targets.length,
      pollution: this.loop.pollution(),
      evolution: this.loop.evolution(),
      // DW-28, both ceilings on one line so they are read together: the pool
      // that would stop DRAWING creatures, and /core's own cap on how many a
      // wave may contain.
      ceilings: { ...this.loop.ceilings(), pool: this.view.stats() },
      // RN-123. NOT a DW-28 ceiling: past MAX_RIGS a creature falls back to
      // the batch and is still drawn, so `claimed` at the cap is the design
      // working, not work being dropped.
      spiders: this.spiders.stats(),
      types: this.types.report(),
      nestRows: this.loop.nests.map((n) => ({ id: n.id, generation: n.generation,
        health: +n.health.toFixed(1), maxHealth: n.maxHealth,
        absorbed: +n.absorbedLifetime.toFixed(2),
        readiness: +n.fractionOfThreshold.toFixed(4), waves: n.wavesDispatched })),
    };
  }
}
