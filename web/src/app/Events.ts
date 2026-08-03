// Typed pub/sub. Deliberately imports nothing: it is the seam that lets
// world/ and sim/ push data at render/ without render/ importing them back
// (ARCHITECTURE.md section 2.2 rule 3).

export interface EventMap {
  /** ARCHITECTURE.md section 3.6: the ONE rebase broadcast. Metres, engine space. */
  OriginRebased: { dx: number; dy: number; dz: number };
  ChunkReady: { key: string; depth: number; near: boolean };
  ChunkEvicted: { key: string };
  StreamUpdate: { resident: number; generated: number; converged: boolean };
  RegimeChanged: { band: 'SURFACE' | 'ASCENT' | 'ORBIT' };
}

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

/** Per-key subscriber and emit counts. See `Events.census`. */
export interface EventCensus {
  readonly subscribers: Readonly<Record<string, number>>;
  readonly emits: Readonly<Record<string, number>>;
  readonly totalSubscribers: number;
}

export class Events {
  private readonly map = new Map<keyof EventMap, Set<Handler<never>>>();
  private readonly emitted = new Map<keyof EventMap, number>();

  /**
   * Subscribe. RETURNS THE UNSUBSCRIBE, and it has always returned it: the
   * defect this bus was accused of was never a missing mechanism, it was four
   * call sites throwing the closure away. Hand it to a `Lifetime`
   * (`lt.addUnsubscribe(...)`) rather than discarding it, or the handler
   * outlives whatever it was written to serve and fires into a torn-down world.
   */
  on<K extends keyof EventMap>(key: K, fn: Handler<K>): () => void {
    let set = this.map.get(key);
    if (set === undefined) { set = new Set(); this.map.set(key, set); }
    set.add(fn as Handler<never>);
    return () => { set!.delete(fn as Handler<never>); };
  }

  emit<K extends keyof EventMap>(key: K, payload: EventMap[K]): void {
    this.emitted.set(key, (this.emitted.get(key) ?? 0) + 1);
    const set = this.map.get(key);
    if (set === undefined) return;
    for (const fn of set) (fn as Handler<K>)(payload);
  }

  /**
   * CE-19. What is listening, and what has been shouted at nobody.
   *
   * The subscriber counts are the leak instrument: tear a scope down and put it
   * back, and every count must return to what it was. A count that grows is a
   * handler that survived its owner, which is the mechanism behind a hitch or a
   * phantom that shows up hours after the switch that caused it.
   *
   * The emit counts are here because they cost one map write and they answered
   * a question nobody had asked: four of the five keys on this bus have never
   * had a subscriber, and two of those four are emitted PER CHUNK.
   */
  census(): EventCensus {
    const subscribers: Record<string, number> = {};
    const emits: Record<string, number> = {};
    let total = 0;
    for (const key of KEYS) {
      const n = this.map.get(key)?.size ?? 0;
      subscribers[key] = n;
      emits[key] = this.emitted.get(key) ?? 0;
      total += n;
    }
    return { subscribers, emits, totalSubscribers: total };
  }
}

/**
 * Every key, listed so the census reports a zero rather than omitting the key.
 * An absent row and a row reading 0 are the same picture to a reader and very
 * different to a probe: `Object.keys(census.subscribers).length` is a fixture,
 * and a key that vanishes because nothing subscribed is a silent hole.
 */
const KEYS: readonly (keyof EventMap)[] = [
  'OriginRebased', 'ChunkReady', 'ChunkEvicted', 'StreamUpdate', 'RegimeChanged',
];
