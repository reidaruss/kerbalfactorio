// THE PLAN, and the one job a placement layer has that /core cannot do for it:
// deciding which buildings are next to which, and turning that into connect()
// calls. Every rule downstream of that is automation.h's.
//
// WHY A REBUILD RATHER THAN AN EDIT. FactorySim is append-only by design: the
// dense entity index IS the render key, so there is no removeEntity and there
// should not be one. A belt run therefore cannot grow a tile in place. So the
// PLAN lives here as plain records, and any topology change re-creates the
// network from it. That is cheap (a handful of entities, only ever on a
// placement) and it makes one property free: the network is always exactly what
// the plan says, so a wiring bug cannot survive one rebuild and hide.
//
// State is carried across a rebuild, not reset: a miner is re-placed with the
// ore it had LEFT, machine inputs are re-fed, and finished output goes to the
// pack. Items physically on a belt are lost, and that count is REPORTED rather
// than swallowed, because a silent loss is how a conservation claim rots.
//
// THE DEPOSIT IS ONE POOL. A drill is placed ON an ore patch (deposits.h S.P),
// seeded from that patch's remaining amount, and every tick the patch is drained
// by exactly what the drill extracted (of_gp_patch_drain). Two counters for the
// same ore is the five-surfaces failure in miniature, and it would show as a
// deposit standing full for ever while its ore rides away on a belt.
//
// AND THE RATE IS THE GROUND'S. A drill mines at /core's authored rate times the
// RICHNESS where it stands, so putting it in the middle of a patch is worth more
// than putting it on the rim. That is the same coverage number the ground is
// tinted with, which is what makes the tint an instruction rather than a decal.

import * as THREE from 'three';
import { AutoLine } from './AutoLine.js';
import { orient, type Snapped } from './Grid.js';
import { addressIn, anchorIn, machineCellKey, siteAt,
  type MachineAddr, type SiteHost } from './MachinePlacement.js';
import { factoryReport } from './FactoryReport.js';
import { commitPlan, oreFedTo } from './FactoryCommit.js';
import type { GameCore } from './GameCore.js';
import type { OrePatches } from './OrePatches.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

export type BuildKind = 'miner' | 'belt' | 'smelter';

/** TypeIds are ASSET-SPECS section 4's, so the stream keys the right mesh. */
export const TYPE_ID: Record<BuildKind, number> = {
  miner: 0x10, belt: 0x11, smelter: 0x12,
};
/** Footprint in whole metres (ASSET-SPECS), and the interaction bound. */
export const FOOTPRINT: Record<BuildKind, number> = { miner: 2, belt: 1, smelter: 2 };

export interface Placed {
  id: number;
  kind: BuildKind;
  /** Body-frame metres, snapped to the 1 m lattice and put on the ground. */
  pos: { x: number; y: number; z: number };
  cell: string;
  up: THREE.Vector3;
  /** Flow direction, in the tangent plane. Belts flow along it. */
  fwd: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Drill only: the ore PATCH it stands on, and what it had left last tick. */
  patch: number;
  lastRemaining: number;
  /** Filled by commit(): the /core build index, and the stream entity id. */
  build: number;
  entity: number;
  /** Belt only: which run it joined, so the flow row can find its tiles. */
  run: number;
}

export class Factory {
  readonly line: AutoLine;
  readonly placed: Placed[] = [];
  /** Belt runs, tail first, as they were committed. Index === run field. */
  runs: Placed[][] = [];
  /** Per-run /core build index, parallel to `runs`. */
  runBuilds: number[] = [];
  /**
   * Where connect() actually wired something, so an inserter can be drawn there
   * (DW-9: the player never places one, but a connection has to be legible).
   */
  links: { pos: { x: number; y: number; z: number };
           up: THREE.Vector3; fwd: THREE.Vector3 }[] = [];
  private nextId = 1;
  /** Ore drained out of world nodes by miners. The conservation counter. */
  minedFromNodes = 0;
  /** Ingots collected by hand into the pack, and what would not fit. */
  collected = 0;
  spilled = 0;
  /** Demolition: buildings pulled up, items handed back, items lost on belts. */
  removals = 0;
  refunded = 0;
  demolishedInFlight = 0;

  constructor(readonly M: OfCoreModule, readonly core: GameCore,
              readonly bodyHandle: number, fixedDt: number,
              readonly ore: OrePatches, private readonly host: SiteHost) {
    this.line = new AutoLine(M, fixedDt);
  }

  /**
   * Snap a body-frame point to the SITE grid and put it on the ground.
   *
   * Not `of_cell_for_pos` any more, and MachinePlacement.ts opens with the
   * measurement that says why: a unit step of the voxel cell key is 0.59 to
   * 1.02 m of ground depending on the axis, so 1.00 m belt tiles laid on it
   * cannot line up. A site's grid is metric and exact.
   */
  snap(x: number, y: number, z: number): Snapped & { addr: MachineAddr } {
    const p = { x, y, z };
    const site = siteAt(this.host, p);
    const addr = addressIn(site, this.host.module, p);
    const a = anchorIn(this.host, addr);
    return { pos: a.pos, up: a.up, cell: machineCellKey(addr), addr };
  }

  /** The same snap, for a cell already named. The drag fill's path. */
  snapAddr(addr: MachineAddr): Snapped & { addr: MachineAddr } {
    const a = anchorIn(this.host, addr);
    return { pos: a.pos, up: a.up, cell: machineCellKey(addr), addr };
  }

  /** Adopt the site a placement landed in, so the next one snaps to it too. */
  adoptSite(addr: MachineAddr): void { this.host.adoptSite(addr.site); }

  /** Is this cell already taken? Placement refuses to stack. */
  occupied(cell: string): boolean {
    return this.placed.some((p) => p.cell === cell);
  }

  /**
   * The ore patch UNDER `pos`, or -1. This is /core's own containment test
   * (of_gp_patch_find over the lobed outline), not a distance to something.
   *
   * A drill without one is refused, and that refusal is where the mechanic
   * teaches itself: "you cannot place a drill here, there is no ore" is the one
   * sentence that tells a player the ground is what matters. A drill standing on
   * nothing would need a deposit invented for it right here, which is exactly
   * how a second source of ore gets born.
   */
  patchUnder(pos: { x: number; y: number; z: number }): number {
    const i = this.ore.find(pos.x, pos.y, pos.z);
    if (i < 0) return -1;
    const p = this.ore.patch(i);
    return p !== null && p.remaining > 0 ? i : -1;
  }

  /** Add one building to the PLAN and re-commit. Returns it, or null. */
  add(kind: BuildKind, s: Snapped, fwd: THREE.Vector3): Placed | null {
    const p = this.stage(kind, s, fwd);
    if (p !== null) this.commit();
    return p;
  }

  /**
   * Push a building into the plan WITHOUT committing.
   *
   * Drag-placing a belt run lays up to a couple of dozen tiles in one tick, and
   * `commit()` throws the whole /core network away and rebuilds it from the
   * plan. Doing that per tile would rebuild it twenty-four times for one drag,
   * and every rebuild loses the items riding the belts, so the drag would
   * silently eat ore as it was laid. Staging and committing once fixes both.
   */
  stage(kind: BuildKind, s: Snapped, fwd: THREE.Vector3): Placed | null {
    if (this.occupied(s.cell)) return null;
    let patch = -1;
    if (kind === 'miner') {
      patch = this.patchUnder(s.pos);
      if (patch < 0) return null;
      // SEVERAL DRILLS ON ONE PATCH IS ALLOWED, and that is the point of a
      // patch: it is a piece of ground, not a socket. They share the one pool,
      // so covering a deposit in drills only makes it run out sooner.
    }
    const p: Placed = {
      id: this.nextId++, kind, pos: s.pos, cell: s.cell, up: s.up.clone(),
      fwd: fwd.clone(), quat: orient(s.up, fwd), patch, lastRemaining: 0,
      build: -1, entity: -1, run: -1,
    };
    this.placed.push(p);
    return p;
  }

  /**
   * Turn an already-placed tile to face `fwd`.
   *
   * Factorio's drag lays the FIRST tile before the drag has a direction, so its
   * heading is the one the crosshair happened to have. The second tile is what
   * says which way the run goes, and the first is turned to match it. Without
   * this the head of every dragged run points somewhere else and the run is two
   * runs, which is precisely the bug being fixed.
   */
  reface(p: Placed, fwd: THREE.Vector3): void {
    p.fwd = fwd.clone();
    p.quat = orient(p.up, p.fwd);
  }

  /**
   * Rebuild the whole plan from saved records and commit ONCE.
   *
   * One commit, not one per building, because a commit throws the network away
   * and rebuilds it: doing that per record would count N-1 spurious rebuilds
   * and, worse, would wire partial plans on the way. Returns what was restored.
   */
  restore(rows: readonly { kind: BuildKind; pos: [number, number, number];
                           cell: string; up: [number, number, number];
                           fwd: [number, number, number]; patch: number }[]): number {
    this.placed.length = 0;
    for (const r of rows) {
      const up = new THREE.Vector3(r.up[0], r.up[1], r.up[2]);
      const fwd = new THREE.Vector3(r.fwd[0], r.fwd[1], r.fwd[2]);
      this.placed.push({
        id: this.nextId++, kind: r.kind,
        pos: { x: r.pos[0], y: r.pos[1], z: r.pos[2] },
        cell: r.cell, up, fwd, quat: orient(up, fwd),
        patch: r.patch, lastRemaining: 0, build: -1, entity: -1, run: -1,
      });
    }
    this.commit();
    return this.placed.length;
  }

  /**
   * Take one building out of the PLAN and re-commit. Returns what came back.
   *
   * REMOVAL IS THE SAME PATH AS PLACEMENT, deliberately: the plan is edited and
   * the network is rebuilt from it. FactorySim is append-only, so there is no
   * removeEntity to get subtly wrong, and the property that a placement gets for
   * free is the one a removal needs most: after the rebuild the network is
   * EXACTLY what the plan says, so a half-unwired line cannot survive.
   *
   * WHAT COMES BACK is only what physically existed. A machine's finished stock
   * and a smelter's un-smelted input are real units and go to the pack; a
   * drill's `remaining` is a claim on the patch, which never left it, so a
   * pulled drill refunds nothing and the deposit is untouched. Items riding a belt
   * ARE lost, and they are counted (`demolishedInFlight`), because that is the
   * one number a silent implementation would swallow.
   *
   * Placement is still free (build costs are W7), so nothing else is owed back.
   */
  remove(p: Placed): { refunded: { item: number; count: number }[];
                       lostInFlight: number } | null {
    const at = this.placed.indexOf(p);
    if (at < 0) return null;
    const back: { item: number; count: number }[] = [];
    // Its OWN output first: commit() empties the survivors, not this one.
    const out = this.collect(p, true);
    if (out > 0) back.push({ item: this.outputItemOf(p), count: out });
    if (p.kind === 'smelter' && p.build >= 0) {
      const held = this.line.inputBuffer(p.build);
      const ore = oreFedTo(this, p) || this.core.ids.rawIron;
      if (held > 0) {
        const over = this.core.add(ore, held);
        this.spilled += over;
        this.refunded += held - over;
        if (held - over > 0) back.push({ item: ore, count: held - over });
      }
    }
    const lost0 = this.line.itemsLostToRebuild;
    this.placed.splice(at, 1);
    this.commit();
    const lost = this.line.itemsLostToRebuild - lost0;
    this.removals++;
    this.demolishedInFlight += lost;
    return { refunded: back, lostInFlight: lost };
  }

  /**
   * Rebuild the /core network from the plan. The work is `FactoryCommit`'s;
   * what lives here is the plan and its lifecycle.
   */
  commit(): void { commitPlan(this); }

  anchor(): { x: number; y: number; z: number } {
    return this.placed.length > 0 ? this.placed[0].pos : { x: 0, y: 0, z: 0 };
  }

  /**
   * Advance the network and keep the world nodes honest.
   *
   * The drain is the delta of the MINER's own remaining, so the node loses
   * exactly what the sim extracted, no more and no less, whatever the rate is.
   */
  tick(ticks: number): void {
    this.line.step(ticks);
    for (const p of this.placed) {
      if (p.kind !== 'miner' || p.build < 0 || p.patch < 0) continue;
      const now = this.line.minerRemaining(p.build);
      const took = p.lastRemaining - now;
      if (took > 0) {
        this.minedFromNodes += this.ore.drain(p.patch, took);
        p.lastRemaining = now;
      }
    }
  }

  /**
   * Empty a building's output buffer into the pack. Returns what moved.
   * `refund` only chooses which ledger it lands in: taking stock by hand and
   * getting stock back off a demolished machine are different events and a
   * probe that cannot tell them apart cannot check either.
   */
  collect(p: Placed, refund = false): number {
    if (p.build < 0) return 0;
    const have = this.line.outputBuffer(p.build);
    if (have <= 0) return 0;
    const took = this.line.takeOutput(p.build, have);
    if (took <= 0) return 0;
    const item = this.outputItemOf(p);
    const over = item > 0 ? this.core.add(item, took) : took;
    if (refund) this.refunded += took - over; else this.collected += took - over;
    this.spilled += over;
    return took - over;
  }

  outputItemOf(p: Placed): number {
    if (p.kind === 'smelter') {
      return this.M._of_gp_smelt_output_for(oreFedTo(this, p) || this.core.ids.rawIron)
        || this.core.ids.iron;
    }
    const n = p.patch >= 0 ? this.ore.patch(p.patch) : null;
    return n?.resource ?? 0;
  }

  /** Nearest building the aim ray enters, within `reachM`. */
  pick(eye: { x: number; y: number; z: number },
       dir: { x: number; y: number; z: number }, reachM: number,
       belts = false): Placed | null {
    let best: Placed | null = null;
    let bestT = reachM;
    for (const p of this.placed) {
      // Belts are not interactive: there is nothing to take out of one, and a
      // 1 m tile under the crosshair otherwise steals the prompt from the
      // machine behind it every time the player looks down the line. They ARE
      // demolishable, which is the one caller that passes `belts`.
      if (p.kind === 'belt' && !belts) continue;
      const r = FOOTPRINT[p.kind] * 0.6 + 0.4;
      const ox = p.pos.x + p.up.x * 0.7 - eye.x;
      const oy = p.pos.y + p.up.y * 0.7 - eye.y;
      const oz = p.pos.z + p.up.z * 0.7 - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -r || t > bestT) continue;
      if (Math.hypot(ox - dir.x * t, oy - dir.y * t, oz - dir.z * t) > r) continue;
      best = p; bestT = Math.max(0, t);
    }
    return best;
  }

  report(): unknown { return factoryReport(this); }
}
