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

export class Events {
  private readonly map = new Map<keyof EventMap, Set<Handler<never>>>();

  on<K extends keyof EventMap>(key: K, fn: Handler<K>): () => void {
    let set = this.map.get(key);
    if (set === undefined) { set = new Set(); this.map.set(key, set); }
    set.add(fn as Handler<never>);
    return () => { set!.delete(fn as Handler<never>); };
  }

  emit<K extends keyof EventMap>(key: K, payload: EventMap[K]): void {
    const set = this.map.get(key);
    if (set === undefined) return;
    for (const fn of set) (fn as Handler<K>)(payload);
  }
}
