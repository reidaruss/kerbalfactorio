// THE WASM HANDLE CENSUS (core-engine). Counts every opaque `/core` handle this
// thread mints and every one it frees, by kind, so "the teardown leaked nothing"
// is a measurement instead of a claim.
//
// WHY IT EXISTS. WASM-BRIDGE section 3.1 makes the rule ("every `*_create` needs
// its `*_destroy`") and nothing enforced it, so the rule lost: at the time this
// was written the client minted three body handles per boot and freed one,
// `_of_streamer_destroy` had been declared for a year with no call site, and
// `terrain.worker.ts` freed none of the three handles it owns. None of that is
// visible from JS. A leaked handle keeps a live C++ object in a heap that only
// grows, and the symptom arrives much later as memory or as a stale object
// answering a question, which is exactly the failure class this seam exists to
// prevent. R6 in core-engine.md, stated once more: a rule with no executable
// guard does not hold.
//
// HOW. `loadOfCore` is the ONLY place a module is constructed (main thread and
// every worker), so wrapping the exports there catches every caller in the
// process by construction. There is no opt-in, nothing to remember, and a lane
// that adds a handle kind gets counted without knowing this file exists. The
// exports are plain writable own properties on the Emscripten module object
// (verified: 388 `_of_*` own properties, all `{value: function, writable: true,
// configurable: true}`), so the wrap is an assignment and costs one call frame.
//
// WHAT IT CANNOT SEE, stated because an instrument that hides its blind spot is
// worse than no instrument:
//   - Handles minted inside C++ and never returned to JS. Out of scope; JS
//     cannot leak what it never held.
//   - A creator whose name does not contain `_create`. There is exactly one
//     today (`of_quadmesh_generate`) and it is named below. The `selfCheck`
//     REFUSES if any `_destroy` export has no known creator, so the next one
//     fails loudly here rather than being silently uncounted.
//   - Another thread's handles. Ids are per instance (WASM-BRIDGE 3.1), so each
//     thread has its own ledger. The terrain worker's handles are proven
//     released by TERMINATING the worker, not by counting them.

import type { OfCoreModule } from './heap.js';

/** Creators whose name does not follow `_of_<kind>_create*`. Keep exhaustive. */
const EXTRA_CREATORS: Readonly<Record<string, string>> = {
  // `of_core_api.cpp:1077` — `g_meshes.add(r)`, freed by `of_quadmesh_destroy`.
  of_quadmesh_generate: 'quadmesh',
};

/**
 * Destroy exports that do NOT free a handle. `of_en_destroy_nest` removes a nest
 * from inside an enemy world; the world itself is not a handle kind. Matched by
 * exact name because the shape (`_destroy` not at the end) is a naming accident
 * and not something to pattern-match on.
 */
const NOT_A_HANDLE_DESTROY: ReadonlySet<string> = new Set(['of_en_destroy_nest']);

export interface KindCensus {
  readonly created: number;
  readonly destroyed: number;
  /** created - destroyed. Non-zero after a scope ends is a leak, by definition. */
  readonly live: number;
}

export interface HandleCensus {
  readonly thread: string;
  readonly created: number;
  readonly destroyed: number;
  readonly live: number;
  /** Only kinds that have been touched. An untouched kind is not interesting. */
  readonly byKind: Readonly<Record<string, KindCensus>>;
  /** Every export name the ledger wrapped. Published so a probe can assert it. */
  readonly wrapped: readonly string[];
}

interface Counter { created: number; destroyed: number; }

export class HandleLedger {
  private readonly kinds = new Map<string, Counter>();
  private readonly wrappedNames: string[] = [];

  private constructor(readonly thread: string) {}

  /**
   * Wrap every handle-minting and handle-freeing export on `M`, in place.
   *
   * Idempotent: a module already wrapped keeps its first ledger, because
   * double-wrapping would double-count and a double count reads exactly like a
   * leak.
   */
  static install(M: OfCoreModule, thread: string): HandleLedger {
    const holder = M as unknown as { __ofHandleLedger?: HandleLedger };
    const already = holder.__ofHandleLedger;
    if (already !== undefined) return already;

    const led = new HandleLedger(thread);
    const bag = M as unknown as Record<string, unknown>;
    const creators = new Map<string, string>();
    const destroyers = new Map<string, string>();

    for (const name of Object.getOwnPropertyNames(bag)) {
      if (!name.startsWith('_of_')) continue;
      if (typeof bag[name] !== 'function') continue;
      const bare = name.slice(1);
      const extra = EXTRA_CREATORS[bare];
      if (extra !== undefined) { creators.set(name, extra); continue; }
      const c = /^_of_(.+?)_create(?:_[a-z0-9_]+)?$/.exec(name);
      if (c !== null) { creators.set(name, c[1]); continue; }
      if (NOT_A_HANDLE_DESTROY.has(bare)) continue;
      const d = /^_of_(.+?)_destroy$/.exec(name);
      if (d !== null) destroyers.set(name, d[1]);
    }

    for (const [name, kind] of creators) led.wrap(bag, name, kind, +1);
    for (const [name, kind] of destroyers) led.wrap(bag, name, kind, -1);

    led.selfCheck([...creators.values()], destroyers);
    holder.__ofHandleLedger = led;
    return led;
  }

  /** The ledger installed on `M`, or null if `loadOfCore` did not run. */
  static of(M: OfCoreModule): HandleLedger | null {
    return (M as unknown as { __ofHandleLedger?: HandleLedger }).__ofHandleLedger ?? null;
  }

  private wrap(bag: Record<string, unknown>, name: string, kind: string, delta: 1 | -1): void {
    const inner = bag[name] as (...a: number[]) => number;
    const ctr = this.counter(kind);
    bag[name] = (...a: number[]): number => {
      const r = inner(...a);
      // A creator that FAILED returns 0 or a negative id and owns nothing, so
      // counting it would manufacture a leak the caller cannot free. Freeing is
      // counted unconditionally: a destroy of a bad handle is a different bug
      // and hiding it here would be the wrong place to find out.
      if (delta === 1) { if (r > 0) ctr.created += 1; } else ctr.destroyed += 1;
      return r;
    };
    this.wrappedNames.push(name);
  }

  private counter(kind: string): Counter {
    let c = this.kinds.get(kind);
    if (c === undefined) { c = { created: 0, destroyed: 0 }; this.kinds.set(kind, c); }
    return c;
  }

  /**
   * REFUSE rather than under-count. A `*_destroy` whose kind has no creator the
   * ledger recognises means a handle is being minted by an export this file has
   * never heard of, so `live` for that kind would go negative and every other
   * number would be quietly wrong. Throwing at load is the cheapest possible
   * moment to learn it, and it is the reachable refusing case for this file:
   * add `of_thing_destroy` with a `of_thing_make` beside it and the client
   * refuses to boot until `EXTRA_CREATORS` names it.
   */
  private selfCheck(created: string[], destroyers: Map<string, string>): void {
    const known = new Set(created);
    const orphans: string[] = [];
    for (const [name, kind] of destroyers) if (!known.has(kind)) orphans.push(`${name} (kind '${kind}')`);
    if (orphans.length > 0) {
      throw new Error(
        `HandleLedger: ${orphans.length} destroy export(s) with no creator this ledger `
        + `can see: ${orphans.join(', ')}. Whatever mints that handle is not named `
        + `'_of_<kind>_create*', so every count for that kind would be wrong. Add it to `
        + `EXTRA_CREATORS in sim/wasm/HandleLedger.ts.`);
    }
  }

  census(): HandleCensus {
    const byKind: Record<string, KindCensus> = {};
    let created = 0;
    let destroyed = 0;
    for (const [kind, c] of this.kinds) {
      if (c.created === 0 && c.destroyed === 0) continue;
      byKind[kind] = { created: c.created, destroyed: c.destroyed, live: c.created - c.destroyed };
      created += c.created;
      destroyed += c.destroyed;
    }
    return {
      thread: this.thread, created, destroyed, live: created - destroyed,
      byKind, wrapped: [...this.wrappedNames].sort(),
    };
  }

  /**
   * A census snapshot to subtract a later one from, so a probe can ask "what did
   * THIS operation leak" rather than "what has the process leaked since boot",
   * which is a different and much less useful question.
   */
  mark(): Readonly<Record<string, number>> {
    const m: Record<string, number> = {};
    for (const [kind, c] of this.kinds) m[kind] = c.created - c.destroyed;
    return m;
  }

  /** `live(now) - live(mark)` per kind, omitting kinds that did not move. */
  since(mark: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
    const d: Record<string, number> = {};
    for (const [kind, c] of this.kinds) {
      const delta = (c.created - c.destroyed) - (mark[kind] ?? 0);
      if (delta !== 0) d[kind] = delta;
    }
    return d;
  }
}
