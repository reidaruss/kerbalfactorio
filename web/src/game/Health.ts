// HOW MUCH PUNISHMENT A PLACED THING CAN TAKE, and where that number lives.
//
// This lands BEFORE anything that can deal damage, deliberately. Adding a damage
// source to entities that already carry health is a small change; adding health
// to entities a combat system is already shooting at means touching every
// population, every save row and every restore path at the same time as the
// thing that made the bug visible. So: the numbers first, with no attacker
// anywhere in the client, and a reload that proves a wounded building is still
// wounded when the player comes back. The attacker arrived at GP-91 and the
// order paid off exactly as intended: the swarm needed no change here at all,
// it calls `damage(key, dps * dt)` and the reload proof already existed.
//
// WHY ONE BOOK KEYED BY A STRING RATHER THAN AN `hp` FIELD ON EACH ROW.
// The obvious design is `Placed.hp`, `StructurePart.hp`, `Machine.hp`,
// `PadPart.hp`, each saved in its own row, and it is the design this file would
// have if it could reach every population. It cannot: the launch pad lives in
// `LaunchPad*.ts` and a vessel part in `Vab*.ts`, both of which belong to other
// live lanes tonight. A per-row field would therefore have covered three
// populations out of five and left the launch pad, the single most valuable
// building in the game, with no health at all, which is precisely the silent gap
// this file exists to avoid. One book keyed by the identity each population
// ALREADY PERSISTS covers all of them, has one save path, one restore path and
// one place to look.
//
// THE PRICE OF THAT CHOICE IS PAID EXPLICITLY. A side table can drift from the
// population it describes: a new buildable whose spawn site forgets to call
// `register` would simply be immortal, and nothing would say so. That is the
// DW-28 failure class (a ceiling that reports success) wearing a different hat,
// so `audit()` compares the book against the live count of every population and
// the report publishes the difference. A probe asserts it is zero. A building
// with no health row is a LOUD condition, not an absent one.
//
// KEYS. Every key carries its population's prefix, because two populations
// numbering their own cells from zero is exactly how GP-60 happened.
//   s:  a structural part, by `StructurePart.key` (already site-qualified)
//   f:  a factory building, by `Placed.cell` (persisted verbatim, GP-27)
//   m:  a hand machine, by its snapped position (see `machineHealthKey`)
//   p:  a launch pad, by site and block address
// A vessel part has no key here yet and no row: see `VESSEL_HEALTH` below.

/** A row in the health catalogue. Authored as data, the gameplay.h pattern. */
export interface HealthRow {
  /** The kind string as its own population spells it. */
  kind: string;
  maxHp: number;
  note: string;
}

/**
 * EVERY BUILDABLE'S HEALTH, IN ONE TABLE.
 *
 * The scale is set against `enemies.h`'s own catalogue rather than invented: a
 * Skitterer deals 7 damage per second at 1.5 m reach, so a 350 hp wall holds one
 * of them for 50 seconds and a pack of ten for 5, and a 2,500 hp launch pad is
 * an objective rather than an ornament. Change these and nothing else moves.
 */
export const STRUCTURE_HEALTH: readonly HealthRow[] = [
  { kind: 'foundation', maxHp: 500, note: 'the slab: the thing everything else stands on' },
  { kind: 'floor', maxHp: 300, note: 'an upper deck carries less than the ground one' },
  { kind: 'wall', maxHp: 350, note: 'the defensive line, and the reason to build one' },
  { kind: 'door', maxHp: 200, note: 'the weak point in a wall, on purpose' },
];

export const FACTORY_HEALTH: readonly HealthRow[] = [
  { kind: 'miner', maxHp: 350, note: 'a drill is heavy and sits still' },
  { kind: 'belt', maxHp: 80, note: 'the cheapest thing to lose and the easiest to cut' },
  { kind: 'smelter', maxHp: 400, note: 'a mass of hot brick' },
  { kind: 'esmelter', maxHp: 400, note: 'the same machine on a different supply' },
  { kind: 'pole', maxHp: 100, note: 'a post: cutting one browns out a whole grid' },
  { kind: 'generator', maxHp: 300, note: 'the dominant polluter, so the thing they come for' },
];

/** The two hand machines, keyed by `Machine.tier` the way `Machines.FILES` is. */
export const MACHINE_HEALTH: readonly HealthRow[] = [
  { kind: 'furnace', maxHp: 300, note: 'tier 0, the stone furnace' },
  { kind: 'smelter', maxHp: 400, note: 'tier 1, the faster hand smelter' },
];

export const PAD_HEALTH: readonly HealthRow[] = [
  { kind: 'launchpad', maxHp: 2500, note: '24 x 24 m and the only way off the planet' },
];

/**
 * ROCKET COMPONENTS, AUTHORED AND NOT YET INSTANCED, and said out loud rather
 * than left absent.
 *
 * A vessel part exists in two places: as a row in a design (`Vab*.ts`) and as a
 * body in flight (`Flight*.ts`). Both belong to other live lanes tonight, so
 * there is no spawn site here to call `register` from and no key that would
 * survive a roll-out. The NUMBERS are authored anyway, because the catalogue is
 * the part that has to be complete for balance to be iterable, and because an
 * empty table is indistinguishable from a table nobody wrote. Wiring is one
 * `register` call per part at roll-out when that lane is free.
 */
export const VESSEL_HEALTH: readonly HealthRow[] = [
  { kind: 'vessel:S', maxHp: 120, note: 'class S part, per DW-29 tiering' },
  { kind: 'vessel:M', maxHp: 260, note: 'class M part' },
  { kind: 'vessel:L', maxHp: 480, note: 'class L part' },
];

function tableOf(rows: readonly HealthRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.kind, r.maxHp);
  return m;
}

const STRUCTURE_MAX = tableOf(STRUCTURE_HEALTH);
const FACTORY_MAX = tableOf(FACTORY_HEALTH);
const MACHINE_MAX = tableOf(MACHINE_HEALTH);
const PAD_MAX = tableOf(PAD_HEALTH);

/** Fallback for a kind the table has never heard of. Deliberately NOT zero: a
 *  zero would make an unlisted building die to the first hit and read as a
 *  balance decision. It is a visible, obviously-placeholder number instead, and
 *  `unknownKinds` counts every time it is used. */
export const UNKNOWN_MAX_HP = 100;

export function structureMaxHp(kind: string): number {
  return STRUCTURE_MAX.get(kind) ?? UNKNOWN_MAX_HP;
}
export function factoryMaxHp(kind: string): number {
  return FACTORY_MAX.get(kind) ?? UNKNOWN_MAX_HP;
}
export function machineMaxHp(tier: number): number {
  return MACHINE_MAX.get(tier === 1 ? 'smelter' : 'furnace') ?? UNKNOWN_MAX_HP;
}
export function padMaxHp(): number {
  return PAD_MAX.get('launchpad') ?? UNKNOWN_MAX_HP;
}

// --- keys --------------------------------------------------------------------

export function structureHealthKey(partKey: string): string {
  return `s:${partKey}`;
}

export function factoryHealthKey(cell: string): string {
  return `f:${cell}`;
}

/**
 * A hand machine's key, DERIVED FROM ITS POSITION and not minted.
 *
 * `Machine` carries no id that survives a reload: the /core handle is re-created
 * by `furnaceCreate` on every spawn and the array index shifts the moment
 * anything is demolished. The saved POSITION, though, is written verbatim and
 * handed back to `Machines.restore` verbatim, so it is the one field that is
 * already stable, and a machine may not be placed inside a neighbour's footprint
 * (GP-52), so quantising it cannot collide. A centimetre grid on a metre module
 * is three orders of margin.
 *
 * Deriving beats minting here for the reason `StructureSave` rebuilds a key
 * rather than reading it back: a derived key cannot be carried forward wrong by
 * a slot written before the scheme existed.
 */
export function machineHealthKey(p: { x: number; y: number; z: number }): string {
  const q = (v: number): number => Math.round(v * 100);
  return `m:${q(p.x)},${q(p.y)},${q(p.z)}`;
}

export function padHealthKey(site: number, i: number, j: number,
                             level: number): string {
  return `p:${site}:${i},${j},${level}`;
}

// --- the book ----------------------------------------------------------------

export interface DamageResult {
  /** True if this call took the thing to zero. Only ever true once per key. */
  destroyed: boolean;
  hp: number;
  maxHp: number;
  /** Damage actually applied, which is less than asked for on the killing blow. */
  applied: number;
}

/** What a population has to tell `audit` so a missing row can be found. */
export interface PopulationCensus {
  name: string;
  /** The keys the population believes it has placed, live, this instant. */
  keys: readonly string[];
}

export interface HealthAudit {
  /** Live things with no health row at all. Must be zero. */
  missing: number;
  /** Rows in the book whose thing no longer exists. Must be zero. */
  stale: number;
  perPopulation: { name: string; live: number; covered: number }[];
}

/**
 * The one place a placed thing's condition is written down.
 *
 * `register` is IDEMPOTENT ON HP: registering a key that is already known keeps
 * whatever health it has and only refreshes the ceiling. That is what lets a
 * restore call it freely from the spawn path without healing a wounded base back
 * to full on every load, and it is the single behaviour the reload proof rests
 * on.
 */
export class HealthBook {
  private readonly hp = new Map<string, number>();
  private readonly max = new Map<string, number>();
  /** Ledger. Every one of these is a number a probe can hold this file to. */
  destroyed = 0;
  damageEvents = 0;
  totalDamage = 0;
  unknownKinds = 0;
  /** Saved rows that matched nothing on the last restore. See `restore`. */
  orphanRows = 0;

  register(key: string, maxHp: number): void {
    if (maxHp === UNKNOWN_MAX_HP) this.unknownKinds++;
    this.max.set(key, maxHp);
    if (!this.hp.has(key)) this.hp.set(key, maxHp);
    else {
      const cur = this.hp.get(key) as number;
      if (cur > maxHp) this.hp.set(key, maxHp);
    }
  }

  forget(key: string): void {
    this.hp.delete(key);
    this.max.delete(key);
  }

  has(key: string): boolean { return this.max.has(key); }
  /** MATERIALISED, not a live iterator: the one caller walks this while calling
   *  `forget`, and handing it the map's own generator would be a mutation during
   *  iteration in the exact loop whose job is to delete. */
  keys(): string[] { return [...this.max.keys()]; }
  hpOf(key: string): number { return this.hp.get(key) ?? 0; }
  maxOf(key: string): number { return this.max.get(key) ?? 0; }

  /** 1 for untouched, 0 for rubble. An unknown key reads 1 rather than 0, so a
   *  tint driven off this never paints an unregistered thing as destroyed. */
  fracOf(key: string): number {
    const m = this.max.get(key);
    if (m === undefined || !(m > 0)) return 1;
    return Math.max(0, Math.min(1, (this.hp.get(key) ?? m) / m));
  }

  /** Everything currently below full, which is the only interesting set. */
  wounded(): { key: string; hp: number; maxHp: number }[] {
    const out: { key: string; hp: number; maxHp: number }[] = [];
    for (const [key, m] of this.max) {
      const h = this.hp.get(key) ?? m;
      if (h < m) out.push({ key, hp: h, maxHp: m });
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  }

  damage(key: string, amount: number): DamageResult {
    const m = this.max.get(key);
    if (m === undefined || !(amount > 0)) {
      return { destroyed: false, hp: this.hp.get(key) ?? 0, maxHp: m ?? 0, applied: 0 };
    }
    const before = this.hp.get(key) ?? m;
    if (before <= 0) return { destroyed: false, hp: 0, maxHp: m, applied: 0 };
    const after = Math.max(0, before - amount);
    this.hp.set(key, after);
    this.damageEvents++;
    this.totalDamage += before - after;
    const destroyed = after <= 0;
    if (destroyed) this.destroyed++;
    return { destroyed, hp: after, maxHp: m, applied: before - after };
  }

  repair(key: string, amount: number): number {
    const m = this.max.get(key);
    if (m === undefined || !(amount > 0)) return 0;
    const before = this.hp.get(key) ?? m;
    const after = Math.min(m, before + amount);
    this.hp.set(key, after);
    return after - before;
  }

  /** Wipe the book. A restore replaces a world rather than merging into one,
   *  exactly as `Structures.reset` does, or a reload would carry the previous
   *  world's wounds onto identically-keyed cells in the new one. */
  reset(): void {
    this.hp.clear();
    this.max.clear();
    this.orphanRows = 0;
  }

  /**
   * ONLY THE WOUNDED ARE WRITTEN.
   *
   * A base nobody has attacked serialises to an empty array, which keeps the
   * slot the size it was and makes the reload assertion sharp: anything in this
   * list is, by construction, a building that has taken damage. The ceiling is
   * NOT written, because it is catalogue data and re-reading it from the table
   * is what lets a rebalance reach worlds that already exist.
   */
  serialize(): [string, number][] {
    return this.wounded().map((w) => [w.key, w.hp] as [string, number]);
  }

  /**
   * Put the wounds back, AFTER every population has re-registered its things.
   *
   * A row whose key matches nothing is an ORPHAN and is counted rather than
   * dropped. That is the assertion that catches a key scheme which has quietly
   * stopped being stable: the building would come back at full health and every
   * other check in the game would pass.
   */
  restore(rows: readonly [string, number][] | undefined):
      { applied: number; orphans: number } {
    let applied = 0;
    let orphans = 0;
    for (const [key, hp] of rows ?? []) {
      const m = this.max.get(key);
      if (m === undefined) { orphans++; continue; }
      this.hp.set(key, Math.max(0, Math.min(m, hp)));
      applied++;
    }
    this.orphanRows = orphans;
    return { applied, orphans };
  }

  /** Compare the book against what is actually standing. See the header. */
  audit(pops: readonly PopulationCensus[]): HealthAudit {
    const seen = new Set<string>();
    const perPopulation: { name: string; live: number; covered: number }[] = [];
    let missing = 0;
    for (const p of pops) {
      let covered = 0;
      for (const k of p.keys) {
        seen.add(k);
        if (this.max.has(k)) covered++;
        else missing++;
      }
      perPopulation.push({ name: p.name, live: p.keys.length, covered });
    }
    let stale = 0;
    for (const k of this.max.keys()) if (!seen.has(k)) stale++;
    return { missing, stale, perPopulation };
  }

  /** Everything a probe needs, without reaching into the maps. */
  report(pops: readonly PopulationCensus[]): unknown {
    const a = this.audit(pops);
    const w = this.wounded();
    return {
      tracked: this.max.size,
      wounded: w.length,
      destroyed: this.destroyed,
      damageEvents: this.damageEvents,
      totalDamage: +this.totalDamage.toFixed(3),
      unknownKinds: this.unknownKinds,
      orphanRows: this.orphanRows,
      audit: a,
      // Capped, because a besieged base could have hundreds and a probe only
      // ever reads a handful. The COUNT above is the complete answer.
      sample: w.slice(0, 24).map((r) => ({ key: r.key, hp: +r.hp.toFixed(2),
        maxHp: r.maxHp })),
      catalogue: {
        structures: STRUCTURE_HEALTH, factory: FACTORY_HEALTH,
        machines: MACHINE_HEALTH, pads: PAD_HEALTH, vessel: VESSEL_HEALTH,
      },
    };
  }
}
