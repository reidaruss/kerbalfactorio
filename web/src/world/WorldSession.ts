// THE BODY-SCOPED LIFETIME (core-engine, CE-20). A world can be taken apart
// while the loop is running, and put back.
//
// The honest framing of what this file is for is NOT "switch to the moon". It is
// that this engine had exactly one answer to "change the world",
// `window.location.reload()`, and that answer is unavailable to multiplayer, to
// loading a save without dropping the GPU context, and to returning from orbit
// to a different body. A `switchToMoon()` would have to be deleted the first
// time any of those arrived.
//
// ---------------------------------------------------------------------------
// THE TWO LIFETIMES, and telling them apart is the whole design.
//
// PROCESS-SCOPED, built once and never rebuilt: the WASM module, the canvas and
// the WebGL context, `Scenes`, `CameraRig`, `Frame`, `Input`, `Hud`, `Events`
// itself, `PropLibrary`, the `Loop`. Nothing about these is body-shaped, and
// throwing away a GPU context to change planet would be absurd.
//
// BODY-SCOPED, torn down and rebuilt: the terrain worker and everything
// downstream of a chunk (the stream, the geometry pool's two BatchedMeshes, the
// terrain materials, the water surface), because every one of them holds state
// whose SHAPE is this body's.
//
// And a third category that is the interesting one, because it is the one that
// does not fall out of "rebuild everything":
//
// RE-SEATED, neither kept nor rebuilt: `SurfaceOracle`, `WaterOracle`,
// `FloatingOrigin`. These are long-lived by identity ("the thing that answers
// about the current body") while their CONTENTS are body-specific. Rebuilding
// them would invalidate a dozen references held all over the client for no gain;
// keeping them untouched would answer questions about a world that is gone.
//
// THE RULE, stated so the next subsystem does not have to rediscover it:
// re-seat an object whose IDENTITY outlives the body; rebuild an object whose
// STATE is a cache of the body. Everything here is one or the other, and which
// one it is is a property of the object, not a judgement call.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES NOT OWN, stated because a seam that quietly does half the job
// is worse than one that refuses. `reboot` rebuilds the body scope. It does NOT
// reach the roughly dozen gameplay, factory-sim and physics collaborators that
// copied `bodyHandle` / `bodyRadiusM` out at boot, the sky's atmosphere
// parameters (baked into a `ShaderMaterial` at creation), or the voxel edit set
// (one global with no body in it, which is a save-corruption bug and belongs to
// persistence). `staleHolders()` MEASURES that residue rather than papering over
// it, so the routing list is a number and not an opinion.

import { PlanetBody } from './PlanetBody.js';
import type { BodyId } from './PlanetBody.js';
import type { SurfaceOracle } from './SurfaceOracle.js';
import type { FloatingOrigin } from './FloatingOrigin.js';
import type { TerrainStream } from './TerrainStream.js';
import type { Scatter } from './Scatter.js';
import type { GrassCover } from '../render/grass/GrassCover.js';
import type { VegetationScope } from '../game/VegetationScope.js';
import type { Events, EventCensus } from '../app/Events.js';
import type { HandleCensus } from '../sim/wasm/HandleLedger.js';
import type { TeardownReport } from '../app/Lifetime.js';
import { Lifetime } from '../app/Lifetime.js';
import { HandleLedger } from '../sim/wasm/HandleLedger.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

/** Everything a body scope produces that the rest of the client reads. */
export interface BodyScope {
  readonly body: PlanetBody;
  readonly terrain: TerrainStream;
  /** Props placed against THIS scope's chunk keys and this body's radius. */
  readonly scatter: Scatter;
  /** RN-2145. The ground-cover carpet, on the same terms as the scatter: it
   *  holds instance buffers keyed on THIS scope's chunk keys, so it is scope
   *  state and not process state and it dies with the scope. */
  readonly grass: GrassCover;
  /** RN-2225. The wild rock and tree fields for a world with no character in
   *  it, or null when `Gameplay` owns them. Scope state on the scatter's own
   *  terms: /core node indices and instance slots keyed to THIS body. */
  readonly wild: VegetationScope | null;
  /**
   * CE-19. The terrain worker's OWN handle census at the moment it inited.
   *
   * A fresh instance reports `{ body: 1, streamer: 1 }`. This is the only
   * evidence the main thread can get that a rebuilt scope got a NEW heap: a
   * re-initialised worker would report 2, then 3, because handle ids are per
   * instance and `terrain.worker.ts` frees none of them.
   */
  readonly workerHandles: Readonly<Record<string, number>>;
}

/**
 * Build one body scope. Supplied by the composition root, because only the
 * composition root knows the wiring; this file must not, or it becomes a second
 * copy of `Boot.ts`.
 */
export type BuildBodyScope = (bodyId: BodyId, lt: Lifetime) => Promise<BodyScope>;

export interface SessionDeps {
  readonly core: OfCoreModule;
  readonly events: Events;
  readonly oracle: SurfaceOracle;
  readonly origin: FloatingOrigin;
  /** Where the observer is, in the NEW body's frame, so the origin can be seated. */
  readonly observerPos: () => { x: number; y: number; z: number };
  readonly build: BuildBodyScope;
  /** The world seed, so a new body can be minted on the same world. */
  readonly seedLo: number;
  readonly seedHi: number;
}

export interface RebootReport {
  readonly fromBodyId: BodyId;
  readonly toBodyId: BodyId;
  readonly epoch: number;
  readonly teardown: TeardownReport;
  readonly teardownMs: number;
  readonly rebuildMs: number;
  /** Main-thread WASM handles created minus destroyed ACROSS the reboot, by kind. */
  readonly handleDelta: Readonly<Record<string, number>>;
  /** Per-key subscriber counts before and after. Equal, or something leaked. */
  readonly subscribersBefore: Readonly<Record<string, number>>;
  readonly subscribersAfter: Readonly<Record<string, number>>;
}

export class WorldSession {
  private scope: BodyScope;
  private lt: Lifetime;
  private gen = 0;
  private busy = false;

  private constructor(private readonly d: SessionDeps, scope: BodyScope, lt: Lifetime) {
    this.scope = scope;
    this.lt = lt;
  }

  static async open(d: SessionDeps, bodyId: BodyId): Promise<WorldSession> {
    const lt = new Lifetime('body#0');
    const scope = await d.build(bodyId, lt);
    return new WorldSession(d, scope, lt);
  }

  /**
   * Adopt a scope the composition root already built, so boot does not pay for
   * the terrain twice. Epoch 0 is the scope boot made; every later one is a
   * reboot.
   */
  static adopt(d: SessionDeps, scope: BodyScope, lt: Lifetime): WorldSession {
    return new WorldSession(d, scope, lt);
  }

  get body(): PlanetBody { return this.scope.body; }
  get terrain(): TerrainStream { return this.scope.terrain; }
  get scatter(): Scatter { return this.scope.scatter; }
  get grass(): GrassCover { return this.scope.grass; }
  get wild(): VegetationScope | null { return this.scope.wild; }
  get workerHandles(): Readonly<Record<string, number>> { return this.scope.workerHandles; }
  get lifetime(): Lifetime { return this.lt; }

  /**
   * True from the first teardown step until the new scope is complete.
   *
   * Systems reads it and does nothing for the duration. It is not a nicety:
   * measured at NINE animation frames of rebuild, during which the outgoing
   * scope is a terminated worker and an emptied resident set, and the ordinary
   * per-frame reclaim was silently doing the prop release the teardown step is
   * supposed to do. See app/Systems.ts.
   */
  get isRebooting(): boolean { return this.busy; }

  /**
   * How many times the body scope has been rebuilt. 0 is boot.
   *
   * Published because it is the cheapest possible way for anything holding a
   * cached body-derived value to find out it is stale: compare the epoch you
   * copied at against this one. Nothing is forced to; the point is that a
   * subsystem that wants to be correct across a switch now CAN be, in one
   * comparison, without this file knowing it exists.
   */
  get epoch(): number { return this.gen; }

  /**
   * Tear the body scope down and build it again, optionally on a different body.
   *
   * Called with no argument this is a SAME-BODY reboot, which is not a
   * degenerate case, it is the negative control: the world after it must be
   * indistinguishable from the world before, so anything that differs is
   * something the teardown lost or the rebuild invented. It is also the only
   * form of this operation whose correctness can be checked without trusting
   * any of the numbers the switch itself reports.
   */
  async reboot(toBodyId?: BodyId): Promise<RebootReport> {
    if (this.busy) throw new Error('WorldSession.reboot: already rebooting');
    this.busy = true;
    try {
      const from = this.scope.body.bodyId;
      const to = toBodyId ?? from;
      const ledger = HandleLedger.of(this.d.core);
      const mark = ledger?.mark() ?? {};
      const before = this.d.events.census().subscribers;

      const t0 = performance.now();
      const teardown = this.lt.end();
      const t1 = performance.now();

      // ORDER MATTERS AND IT IS NOT OBVIOUS. The origin is seated BEFORE the new
      // scope is built, because building it streams chunks, and a chunk is
      // placed through `origin.toEngine`. Seat it afterwards and the first frame
      // of the new world is drawn against the previous world's origin, which on
      // a Forge-to-Cinder switch is 400 km of error in a float32 vertex buffer.
      this.gen += 1;
      const lt = new Lifetime(`body#${this.gen}`);
      if (to !== from) this.d.oracle.reseat(this.newBody(to));
      this.d.origin.reseat(this.d.observerPos());
      this.scope = await this.d.build(to, lt);
      this.lt = lt;
      const t2 = performance.now();

      return {
        fromBodyId: from, toBodyId: to, epoch: this.gen,
        teardown, teardownMs: t1 - t0, rebuildMs: t2 - t1,
        handleDelta: ledger?.since(mark) ?? {},
        subscribersBefore: before,
        subscribersAfter: this.d.events.census().subscribers,
      };
    } finally {
      this.busy = false;
    }
  }

  private newBody(to: BodyId): PlanetBody {
    const old = this.scope.body;
    const next = PlanetBody.create(this.d.core, to, this.d.seedLo, this.d.seedHi);
    // Free the OLD handle only once the new one exists. A `_of_body_create` can
    // fail and return 0, and a session that has destroyed its only body before
    // finding that out has nothing to fall back to. `PlanetBody.create` throws
    // on a bad handle, so the old body survives a failed switch.
    old.dispose();
    return next;
  }

  /** Both censuses in one object, for the debug surface and the probe. */
  audit(): { epoch: number; bodyId: BodyId; bodyName: string; scope: readonly string[];
             events: EventCensus; handles: HandleCensus | null } {
    const ledger = HandleLedger.of(this.d.core);
    return {
      epoch: this.gen,
      bodyId: this.scope.body.bodyId,
      bodyName: this.scope.body.name,
      scope: this.lt.labels,
      events: this.d.events.census(),
      handles: ledger?.census() ?? null,
    };
  }
}
