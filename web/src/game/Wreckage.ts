// D1. WHAT IS LEFT WHERE A BUILDING USED TO STAND.
//
// THE INCOHERENCE THIS CLOSES, stated first because it is the whole reason the
// file exists. Until now `EnemySwarm.step` counted a kill (`buildingsDestroyed`)
// and nothing else happened: the part stayed in its population, its `Solid`
// stayed in `structures.bodies`, its factory row stayed in the plan, its mesh
// stayed drawn and its health row stayed at exactly 0. A wall the swarm had
// "destroyed" still blocked the walker, still had to be demolished by hand, and
// still read as a wall to every report in the game. `EnemySwarm.ts`'s own header
// said so in as many words and named removal as the next step; the D-020 scope
// (docs/scope/SE-MECHANICS-SCOPE-2026-08-13.md §1, D1) put a lane-week on it and
// Reid's answer to Q5 was (c): vanish, plus a rubble prop. This is that.
//
// WHAT D1 IS AND IS NOT. It is: the part removed through the population's OWN
// removal path, a rubble prop standing at the footprint, and a scavenge yield
// when the player clears the rubble. It is NOT a repair verb (D3), NOT a
// collapse cascade over a support graph (D5, which needs the occupancy raster
// F3 first), and NOT a new save row (see SAVE below).
//
// ---------------------------------------------------------------------------
// WHY DESTRUCTION GOES THROUGH `remove()` AND THEN TAKES THE REFUND BACK.
//
// Every population already has exactly one removal path, and it is the one
// `Demolition.ts` drives: `Structures.remove`, `Factory.remove`,
// `Machines.remove`, `LaunchPads.remove`. Each of them drops the row, drops the
// `Solid`, tears down whatever /core handle the thing owned, and CREDITS THE
// PACK, because the only caller until today was a player pulling their own
// building back up. Destruction wants the first three and not the fourth.
//
// Three ways to get that, and the one taken:
//
//   (a) A `credit: boolean` parameter threaded through all four populations and
//       into `FactoryHand.collectOutput`. Five or six files, a widened signature
//       on four published methods, and a second branch inside each removal that
//       only one caller ever takes.
//   (b) A second, destruction-only removal path per population. That is four new
//       copies of the most order-sensitive code in the client, which is the
//       "two authorities for one quantity" defect this project has now paid for
//       repeatedly.
//   (c) THIS: call the population's own `remove()` unchanged and immediately
//       debit exactly what it says it credited.
//
// (c) is chosen because the net effect on the pack is PROVABLY zero and a probe
// can assert it. Each `remove()` returns what ACTUALLY LANDED (`count - over`
// after `GameCore.add`, which reports its own overflow), so taking that exact
// ledger back out cannot over- or under-shoot, whether the pack was empty or
// full. There is one arithmetic definition of "what this building was worth"
// and it is still the population's; nothing here re-derives a cost. `unrecovered`
// counts any unit `GameCore.remove` could not find, which must be 0 and is
// published rather than assumed.
//
// WHAT IS LOST OUTRIGHT is what the population's own removal already loses and
// already names: ore in a furnace pool (`oreLost`, gameplay.h has no unloadOre),
// items riding a belt when the plan is rebuilt (`lostInFlight`). Destruction
// inherits both unchanged and reports them in the same `lost` shape a
// `DemolishResult` uses, so the toast a player reads says the same kind of thing
// either way.
//
// ---------------------------------------------------------------------------
// THE SCAVENGE FRACTION IS ONE THIRD, ROUNDED DOWN, and here is the defence.
//
// A demolition returns 100 per cent. If a destruction returned the same, letting
// the wall die would cost nothing but the walk, and the entire point of a wall
// is that losing it should hurt. If it returned nothing, rubble would be pure
// chore: the player would clear it for the footprint, never for the payout.
// A third is far enough below a half that the gap is FELT on the small ledgers
// this game actually deals in (a 5-unit cost pays 2 at a half and 1 at a third),
// and rounding DOWN means the cheapest things -- a belt tile, a power pole --
// leave nothing worth picking up, which is the right answer for a belt tile.
// The remainder is not silently swallowed: it is booked as `lost` and the toast
// says so.
//
// One numerator, one denominator, exported, so a rebalance is two numbers here
// and nothing else in the game moves.
//
// ---------------------------------------------------------------------------
// SAVE: RUBBLE IS NOT SAVED, AND THAT IS THE HONEST ANSWER RATHER THAN A GAP.
//
// The scope's D1 line says "no save of rubble beyond what the existing
// populations give free", so what a reload does is worth stating exactly. The
// destroyed building is already GONE from its population by the time the next
// autosave is written, so the save carries no part, no factory row and no health
// row for it: a reload gives a CLEAN SITE. The rubble pile itself, and any
// salvage still sitting in it, is not written and does not come back.
//
// That is honest in the direction that matters. The failure mode a save row
// would prevent is losing a few units of salvage across a reload; the failure
// mode a save row would RISK is the building coming back standing, which is the
// exact incoherence this file exists to remove. Given one of the two, D1 takes
// the one that cannot resurrect a wall. A rubble row is a `SaveGame` schema bump
// and belongs with D3's repairable-wreck state, where the row has to exist
// anyway.
//
// ---------------------------------------------------------------------------
// THE MESH IS BORROWED AND THE ART WAVE OWES A REAL ONE.
//
// `assets/nodes/boulder_stone.glb` is a shipped, honest asset (NodeArt.ts, 1.0 m
// nominal radius) squashed to 0.45 of its height and scaled to the footprint of
// whatever fell. It reads as a low pile of broken material at the right size,
// which is what a rubble prop has to do; it does not read as a broken SMELTER.
// `report().mesh` publishes the file so nobody has to guess whether the art
// landed, exactly as `Antennas.report` did while it was borrowing the power
// pole. ASSET-SPECS owes `rubble_pile.glb` in three footprint sizes.
//
// RUBBLE HAS NO `Solid`, DELIBERATELY. A pile of broken wall is ankle height and
// a walker steps over it; more to the point, "the part is gone" is only a real
// claim if the walker can now cross where it stood, and a rubble collider would
// make that claim untestable and the feature indistinguishable from the bug.
// `probes/destruction.js` inverts the CE-50 occupancy technique on exactly this.

import * as THREE from 'three';
import { loadGlb, selectLod } from '../assets/Loaders.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** The borrowed prop. See the header: the art wave owes `rubble_pile.glb`. */
const FILE = 'assets/nodes/boulder_stone.glb';

/** The nominal radius `NodeArt.ts` authors this asset at, so the scale below is
 *  a ratio against the asset's own number rather than a guess. */
const ASSET_RADIUS_M = 1.0;

/** How flat a pile is, as a fraction of its own span. Wreckage is wide and low. */
const SQUASH = 0.45;

/** THE SCAVENGE FRACTION. One third, rounded down. Header has the defence. */
export const SCAVENGE_NUM = 1;
export const SCAVENGE_DEN = 3;

/**
 * How wide a pile is, by the kind of thing that fell, in metres.
 *
 * Authored rather than read off a collision proxy because a WRECK is not the
 * same size as the thing that made it: a 4 m wall does not leave a 4 m wall
 * lying down, it leaves a heap roughly its own footprint across. The structural
 * kinds share the 4.00 m module's footprint; the machines are sized off their
 * own bite radii in `EnemyTargets.ts`, which are the only measured numbers this
 * game already has for "how big is this building".
 */
const SPAN_M: Record<string, number> = {
  foundation: 3.4, floor: 3.4, wall: 2.6, door: 2.2,
  miner: 2.0, belt: 0.9, smelter: 2.2, esmelter: 2.2, pole: 0.7, generator: 2.4,
  assembler: 3.0, furnace: 1.6, launchpad: 8.0,
};
const DEFAULT_SPAN_M = 1.6;

export function spanOf(kind: string): number {
  return SPAN_M[kind] ?? DEFAULT_SPAN_M;
}

/** What a pile pays when it is cleared. One definition, used by nothing else. */
export function scavengeOf(ledger: readonly { item: number; count: number }[]):
    { item: number; count: number }[] {
  const out: { item: number; count: number }[] = [];
  for (const c of ledger) {
    const n = Math.floor((c.count * SCAVENGE_NUM) / SCAVENGE_DEN);
    if (n > 0) out.push({ item: c.item, count: n });
  }
  return out;
}

export interface RubbleRow {
  id: number;
  /** The health key of the thing that stood here. Never re-registered: rubble
   *  has no health, is not a target and cannot be attacked. */
  wasKey: string;
  /** The kind as its own population spelled it, for the toast and the report. */
  kind: string;
  pos: Vec3d;
  up: THREE.Vector3;
  quat: THREE.Quaternion;
  spanM: number;
  group: THREE.Group;
  /**
   * WHAT THE THING WAS WORTH INTACT: the ledger its own population's `remove`
   * reported, before the fraction was taken. Carried on the row rather than
   * thrown away, so `salvage` can be CHECKED against it: a probe that had only
   * the salvage would have to retype the fraction and would then agree with
   * itself whatever the constants said (standing rule 11).
   */
  ledger: { item: number; count: number }[];
  /** What clearing this pays. Computed ONCE, when it fell, off `ledger`. */
  salvage: { item: number; count: number }[];
  /** What the collapse ate: the scavenge remainder, plus whatever the removal
   *  could not save. Named, never hidden. */
  lost: { what: string; count: number }[];
}

/**
 * The rubble population. Shaped like `Antennas`/`ResearchStations` (a list, a
 * group, a centre-and-radius `pick`, a `remove` that returns a ledger) because
 * it is the same kind of object: one prop, snapped nowhere, picked by a ray
 * against its own list. It is deliberately SIMPLER than those two: no /core
 * `StructureDef`, no cost, no research gate, no save row and no `Solid`.
 */
export class Wreckage {
  readonly group = new THREE.Group();
  readonly list: RubbleRow[] = [];
  /** Ledger. Every one of these is a number a probe can hold this file to. */
  piles = 0;
  scavenged = 0;
  itemsScavenged = 0;
  itemsLostToCollapse = 0;
  /** Units `GameCore.remove` could not find when taking a refund back out of
   *  the pack. MUST be 0: see the header on why the net effect is provable. */
  unrecovered = 0;
  /** Zero-hp keys that resolved to no population row at all. MUST be 0, and is
   *  published rather than assumed for `HealthBook.audit`'s own reason: a
   *  building that could not be felled would go on standing at 0 hp and every
   *  other counter in the game would read healthy. */
  unresolved = 0;
  private template: THREE.Object3D | null = null;
  private nextId = 1;
  private readonly p = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(private readonly origin:
              { toEngine: (p: Vec3d, out: THREE.Vector3) => void }) {
    this.group.name = 'wreckage';
  }

  async load(): Promise<void> {
    this.template = (await loadGlb(FILE)).scene;
  }

  get ready(): boolean { return this.template !== null; }

  /**
   * Put a pile down where something fell.
   *
   * The YAW IS DERIVED FROM THE KEY, not random and not fixed: a row of five
   * destroyed walls all wearing the same boulder at the same angle reads as a
   * bug, and a random one cannot be reproduced by a probe or a replay.
   */
  pile(wasKey: string, kind: string, pos: Vec3d,
       ledger: { item: number; count: number }[],
       salvage: { item: number; count: number }[],
       lost: { what: string; count: number }[]): RubbleRow {
    const up = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    const stand = new THREE.Quaternion().setFromUnitVectors(this.yAxis, up);
    const yaw = (hash(wasKey) % 3600) / 3600 * Math.PI * 2;
    const quat = new THREE.Quaternion().setFromAxisAngle(up, yaw).multiply(stand);
    const spanM = spanOf(kind);
    const g = new THREE.Group();
    if (this.template !== null) {
      const clone = this.template.clone(true);
      selectLod(clone, '_LOD0');
      const s = (spanM * 0.5) / ASSET_RADIUS_M;
      clone.scale.set(s, s * SQUASH, s);
      clone.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh !== true) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      g.add(clone);
    }
    this.group.add(g);
    const row: RubbleRow = {
      id: this.nextId++, wasKey, kind, pos: { x: pos.x, y: pos.y, z: pos.z },
      up, quat, spanM, group: g, ledger, salvage, lost,
    };
    this.list.push(row);
    this.piles++;
    for (const l of lost) this.itemsLostToCollapse += l.count;
    return row;
  }

  /** Clear a pile. Returns the salvage, or null if it is already gone. The
   *  CREDIT is the caller's (Demolition.ts), for `Antennas.remove`'s reason
   *  inverted: this class has no `GameCore` and should not grow one. */
  remove(r: RubbleRow): { salvage: { item: number; count: number }[];
                          lost: { what: string; count: number }[] } | null {
    const i = this.list.indexOf(r);
    if (i < 0) return null;
    this.list.splice(i, 1);
    this.group.remove(r.group);
    this.scavenged++;
    for (const c of r.salvage) this.itemsScavenged += c.count;
    return { salvage: r.salvage, lost: r.lost };
  }

  /** Throw it all away. A restore replaces a world rather than merging into
   *  one, the rule `Structures.reset` already follows. */
  reset(): void {
    for (const r of this.list) this.group.remove(r.group);
    this.list.length = 0;
  }

  update(): void {
    for (const r of this.list) {
      this.origin.toEngine(r.pos, this.p);
      r.group.position.copy(this.p);
      r.group.quaternion.copy(r.quat);
      r.group.updateMatrixWorld(true);
    }
  }

  /** `Antennas.pick`'s centre-and-radius test, at the pile's own half-span and
   *  at half its height, because a pile is wide and flat rather than a mast. */
  pick(eye: Vec3d, dir: Vec3d, reachM: number): RubbleRow | null {
    let best: RubbleRow | null = null;
    let bestT = Infinity;
    for (const r of this.list) {
      const rad = r.spanM * 0.5;
      const u = rad * SQUASH * 0.5;
      const ox = r.pos.x + r.up.x * u - eye.x;
      const oy = r.pos.y + r.up.y * u - eye.y;
      const oz = r.pos.z + r.up.z * u - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -rad || t > reachM + rad || t >= bestT) continue;
      const cx = ox - dir.x * t, cy = oy - dir.y * t, cz = oz - dir.z * t;
      if (Math.hypot(cx, cy, cz) > rad + 0.5) continue;
      best = r; bestT = Math.max(0, t);
    }
    return best;
  }

  report(): unknown {
    return {
      count: this.list.length,
      piles: this.piles, scavenged: this.scavenged,
      itemsScavenged: this.itemsScavenged,
      itemsLostToCollapse: this.itemsLostToCollapse,
      /** Both MUST be 0. See the fields for what a non-zero one means. */
      unrecovered: this.unrecovered, unresolved: this.unresolved,
      scavengeFraction: `${SCAVENGE_NUM}/${SCAVENGE_DEN}`,
      /** Which mesh the world actually drew, `Antennas.report`'s own field and
       *  its own reason: this one is BORROWED and the art wave owes a real one. */
      mesh: FILE, meshIsPlaceholder: true,
      list: this.list.map((r) => ({
        id: r.id, wasKey: r.wasKey, kind: r.kind,
        pos: [r.pos.x, r.pos.y, r.pos.z], spanM: r.spanM,
        ledger: r.ledger.map((c) => ({ item: c.item, count: c.count })),
        salvage: r.salvage.map((c) => ({ item: c.item, count: c.count })),
        lost: r.lost,
      })),
    };
  }
}

/** FNV-1a over the key. Deterministic, so a replay puts the same boulder at the
 *  same angle. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
