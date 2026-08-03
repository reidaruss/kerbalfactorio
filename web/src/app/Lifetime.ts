// THE TEARDOWN CONTRACT (core-engine). What `dispose()` means, who calls it,
// and in what order.
//
// Until this file existed, nothing in this client had ever taken anything apart
// while the loop was running. The only answer to "change the world" was
// `window.location.reload()`, and the consequence is visible in the code:
// `TerrainStream.dispose()` was written and never called, `PlanetBody.dispose()`
// likewise, `_of_streamer_destroy` was declared and never invoked, and
// `terrain.worker.ts` destroys none of the three handles it mints. None of that
// is carelessness. A `dispose` with no caller has no way to be wrong, so it
// rots exactly like a probe that has never been seen to fail.
//
// ---------------------------------------------------------------------------
// WHAT `dispose()` MEANS. Five clauses, and a class that cannot honour all five
// should not have the method.
//
//  1. RELEASE WHAT THE GARBAGE COLLECTOR CANNOT SEE. WASM handles, Workers,
//     three.js geometries / materials / textures / render targets, timers, DOM
//     listeners, event subscriptions. A JS field going out of scope frees none
//     of those. Anything the GC *can* see is not this method's business.
//
//  2. RELEASE ONLY WHAT YOU OWN, and ownership is decided by CONSTRUCTION, not
//     by reachability. Five objects hold the same `ShaderMaterial`; if dispose
//     meant "release what I can reach", the first of the five to be torn down
//     would take the other four's material with it. Whoever built it releases
//     it.
//
//  3. BE IDEMPOTENT. A second call is a no-op, never a second free. A double
//     `_of_*_destroy` is heap corruption in a module whose handle ids are
//     recycled, which is the worst possible failure to introduce in the name of
//     tidying up.
//
//  4. LEAVE THE OBJECT UNUSABLE, AND LOUD. A disposed object that keeps
//     answering with the state it had is precisely the "phantom collider hours
//     later" this whole seam exists to prevent. Prefer throwing to answering.
//
//  5. NEVER THROW PAST THE SCOPE. See `Lifetime.end` below: one failing
//     disposer must not strand the twenty that were going to run after it.
//
// ---------------------------------------------------------------------------
// WHO CALLS IT: the `Lifetime` the object was registered with, and nobody else.
// Not a peer, not a consumer, not the object itself. A consumer calling dispose
// on something handed to it is clause 2 violated from the other side.
//
// IN WHAT ORDER: the exact reverse of registration.
//
// That is not a preference, it is the only order that is correct by
// construction. Registration happens at construction, and you cannot construct
// B out of A before A exists, so registration order IS dependency order and its
// reverse is a safe teardown order for free. Every alternative (a hand-written
// ordered list, a priority number, a dependency graph declared twice) is a
// second copy of the wiring that can drift from the first, which is the
// second-authority failure this project has paid for repeatedly.

/** A teardown step. Must be idempotent and must not assume it runs. */
export type Teardown = () => void;

/** Anything with the five-clause `dispose()` contract described above. */
export interface Disposable { dispose(): void; }

interface Step { readonly label: string; readonly fn: Teardown; }

/** One failed teardown step. The scope keeps going and reports these. */
export interface TeardownFailure { readonly label: string; readonly message: string; }

export interface TeardownReport {
  /** The scope's own label, for a log line that says which scope ended. */
  readonly scope: string;
  /** Steps that ran, in the order they ran (i.e. reverse registration). */
  readonly ran: readonly string[];
  /** Steps that threw. `end()` never throws; the CALLER asserts this is empty. */
  readonly failed: readonly TeardownFailure[];
  readonly ms: number;
}

/**
 * A scope with an end. Collect teardown steps as you construct; call `end()`
 * once to run them all in reverse.
 *
 * Deliberately NOT a `Set` of `Disposable`: a set has no order, and order is
 * the whole point (INSTRUMENTS.md, "a set comparison cannot check an
 * ordering"). Deliberately not `Symbol.dispose`/`using` either: the body-scoped
 * lifetime outlives every block it is created in, so lexical scoping is the
 * wrong shape.
 */
export class Lifetime {
  private readonly steps: Step[] = [];
  private state: 'open' | 'ending' | 'ended' = 'open';

  constructor(readonly label: string) {}

  get size(): number { return this.steps.length; }
  get isOpen(): boolean { return this.state === 'open'; }
  get isEnded(): boolean { return this.state === 'ended'; }

  /** The registered labels in CONSTRUCTION order. Teardown runs them backwards. */
  get labels(): readonly string[] { return this.steps.map((s) => s.label); }

  /**
   * Register a teardown step.
   *
   * THROWS if the scope has already ended. That is not pedantry: registering a
   * teardown into a dead scope means the resource it releases will never be
   * released, and the caller has no other way to find out. A silent no-op here
   * is a leak with no symptom, which is the shape of every entry in
   * INSTRUMENTS.md.
   */
  add(label: string, fn: Teardown): void {
    if (this.state !== 'open') {
      throw new Error(
        `Lifetime(${this.label}): cannot register '${label}' into a scope that is `
        + `'${this.state}'. Whatever it would have released will leak. Register it `
        + `before the scope ends, or give it a scope of its own.`);
    }
    this.steps.push({ label, fn });
  }

  /** `add` for the common case. Returns the object so it can be used inline. */
  own<T extends Disposable>(label: string, obj: T): T {
    this.add(label, () => { obj.dispose(); });
    return obj;
  }

  /**
   * `Events.on` already returns its own unsubscribe closure; this is the one
   * line that stops it being thrown away. Named separately from `add` so a
   * subscription leak is greppable rather than hidden inside a lambda.
   */
  addUnsubscribe(label: string, off: Teardown): void { this.add(`sub:${label}`, off); }

  /**
   * Run every step in reverse registration order, exactly once.
   *
   * NEVER THROWS. Each step gets its own try/catch, because the whole reason a
   * scope exists is that step 12 failing must not strand steps 11 down to 1: a
   * half-released scope is worse than an unreleased one, since the surviving
   * half is now unreachable and unnameable. Failures come back in the report
   * and it is the CALLER's job to assert the list is empty, which is the same
   * shape as `parity.mjs` asserting a count rather than trusting an exit code.
   */
  end(): TeardownReport {
    if (this.state !== 'open') {
      return { scope: this.label, ran: [], failed: [], ms: 0 };
    }
    this.state = 'ending';
    const t0 = performance.now();
    const ran: string[] = [];
    const failed: TeardownFailure[] = [];
    for (let i = this.steps.length - 1; i >= 0; --i) {
      const s = this.steps[i];
      try {
        s.fn();
        ran.push(s.label);
      } catch (e) {
        failed.push({ label: s.label, message: e instanceof Error ? e.message : String(e) });
      }
    }
    this.steps.length = 0;
    this.state = 'ended';
    return { scope: this.label, ran, failed, ms: performance.now() - t0 };
  }
}

/**
 * Clause 3 and clause 4 in three lines, so a class does not have to reinvent
 * them and get one of them wrong.
 *
 *   private readonly gate = new DisposeGate('TerrainStream');
 *   dispose() { if (!this.gate.close()) return; ...release... }
 *   someQuery() { this.gate.assertOpen(); ... }
 */
export class DisposeGate {
  private closed = false;
  constructor(private readonly owner: string) {}

  /** True the FIRST time only. `if (!gate.close()) return;` is the idiom. */
  close(): boolean {
    if (this.closed) return false;
    this.closed = true;
    return true;
  }

  get isClosed(): boolean { return this.closed; }

  /** Clause 4: answering after disposal is the bug this exists to make loud. */
  assertOpen(what = 'use'): void {
    if (this.closed) {
      throw new Error(`${this.owner}: ${what} after dispose(). The object is released; `
        + `whoever is holding it kept a reference across a teardown.`);
    }
  }
}
