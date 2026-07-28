// THE PLAN, and the one job a placement layer has that /core cannot do for it:
// deciding which buildings are next to which, and turning that into connect()
// calls. Every rule downstream of that is automation.h's.
// WHY A REBUILD RATHER THAN AN EDIT. FactorySim is append-only by design: the
// dense entity index IS the render key, so there is no removeEntity and there
// should not be one. So the PLAN lives here as plain records and any topology
// change re-creates the network from it. That is cheap, and it makes one
// property free: the network is always exactly what the plan says, so a wiring
// bug cannot survive one rebuild and hide.
//
// State is carried across a rebuild, not reset: a miner is re-placed with the
// ore it had LEFT, machine inputs are re-fed, and finished output goes to the
// pack. Items physically on a belt are lost, and that count is REPORTED rather
// than swallowed, because a silent loss is how a conservation claim rots.
//
// THE DEPOSIT IS ONE POOL. A drill is placed ON an ore patch (deposits.h S.P),
// seeded from that patch's remaining amount, and every tick the patch is drained
// by exactly what the drill extracted (of_gp_patch_drain). Two counters for the
// same ore is the five-surfaces failure in miniature. The RATE is the ground's
// too: /core's authored rate times the RICHNESS where the drill stands, which is
// the same coverage number the ground is tinted with, so the tint is an
// instruction rather than a decal.

import * as THREE from 'three';
import { type BuildKind, type Placed } from './FactoryKinds.js';
import { AutoLine } from './AutoLine.js';
import { Power } from './Power.js';
import { orient, type Snapped } from './Grid.js';
import { addressIn, anchorIn, machineCellKey, machineClash, siteAt,
  type MachineAddr, type SiteHost } from './MachinePlacement.js';
import { factoryReport } from './FactoryReport.js';
import { commitPlan, smeltPairFor } from './FactoryCommit.js';
import { collectOutput, pickAimed, takeFromBelt,
  turnPlaced } from './FactoryHand.js';
import { NO_MIGRATION, type PortMigration } from './FactoryMigrate.js';
import { menuOf, recipeOfPlaced, setPlacedRecipe, NO_RECIPE,
  type AssemblerRecipe, type RecipeMenu } from './FactoryRecipes.js';
import { restorePlan, type SavedBuilding } from './FactoryRestore.js';
import type { WiredLink } from './FactoryPorts.js';
import type { PortRefusal } from './FactoryRefusal.js';
import type { GameCore } from './GameCore.js';
import type { OrePatches } from './OrePatches.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

export { FOOTPRINT, GATED_BY_ITEM, TYPE_ID, type BuildKind,
  type Placed } from './FactoryKinds.js';

export class Factory {
  readonly line: AutoLine;
  readonly placed: Placed[] = [];
  /** Belt runs, tail first, as they were committed. Index === run field. */
  runs: Placed[][] = [];
  /** Per-run /core build index, parallel to `runs`. */
  runBuilds: number[] = [];
  /** FS-44: every connection, as a PAIR OF PORTS. `FactoryWiring` builds these
   *  and argues what changed; `WiredLink` is the row. */
  links: WiredLink[] = [];
  /** FS-45: every belt end that ran into a housing instead of a port, with the
   *  reason and the fix. Empty is a base whose lines all land. */
  refusals: PortRefusal[] = [];
  /** Was the port table published before this commit wired anything? Reported
   *  rather than assumed: an empty table connects nothing (FactoryWiring). */
  portsLoaded = false;
  /** FS-46: how the last restore fared against the port model. */
  migration: Readonly<PortMigration> = NO_MIGRATION;
  private nextId = 1;
  /** Ore drained out of world nodes by miners. The conservation counter. */
  minedFromNodes = 0;
  /** Ingots collected by hand into the pack, and what would not fit. */
  collected = 0;
  spilled = 0;
  /** FS-28: items lifted off a belt by hand. Its own counter, because "took it
   *  off a belt" and "emptied a machine" are different events and a probe that
   *  cannot tell them apart cannot check either. */
  takenFromBelts = 0;
  /** DW-20: how many times the take verb REACHED a belt at all. Without it, a
   *  zero take count cannot be told from never having aimed at one, and a probe
   *  that cannot tell those apart is measuring nothing. */
  beltTakeAttempts = 0;
  /** Demolition: buildings pulled up, items handed back, items lost on belts. */
  removals = 0;
  refunded = 0;
  demolishedInFlight = 0;

  /** THE GRID, over the SAME network the machines are on. Handed the handle as
   *  a port because `recreate()` replaces it on every commit (Power.ts has the
   *  argument), and held here rather than on Gameplay so there is exactly one
   *  Power object in the client and the panel cannot end up reading a second,
   *  always-correct, always-empty grid. */
  readonly power: Power;

  constructor(readonly M: OfCoreModule, readonly core: GameCore,
              readonly bodyHandle: number, fixedDt: number,
              readonly ore: OrePatches, readonly host: SiteHost) {
    this.line = new AutoLine(M, fixedDt);
    this.power = new Power(M, () => this.line.net);
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
    const s = siteAt(this.host, p);
    const addr = addressIn(s.site, this.host.module, p, s.prospective);
    const a = anchorIn(this.host, addr);
    return { pos: a.pos, up: a.up, cell: machineCellKey(addr), addr };
  }

  /**
   * Turn a PROSPECTIVE address into a real one by founding its site.
   *
   * Looking founds nothing (`siteAt`); PLACING founds. Putting it here rather
   * than in the caller is what stops a placement being keyed `m~12,-4,7:0,0`
   * and persisted in a form nothing else speaks. Idempotent, as `adoptSite` is.
   */
  private claim(a: MachineAddr): MachineAddr {
    if (!a.prospective) return a;
    this.host.adoptSite(a.site);
    return { site: a.site, i: a.i, j: a.j, prospective: false };
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

  /** Whatever stands in this cell, or null. */
  at(cell: string): Placed | null {
    return this.placed.find((p) => p.cell === cell) ?? null;
  }

  /** GP-49: what this placement would stand INSIDE, or null. Rule in
   *  `MachinePlacement.machineClash`. */
  clash(kind: BuildKind, addr?: MachineAddr): Placed | null {
    return machineClash(this.placed, kind, addr);
  }

  /**
   * The ore patch UNDER `pos`, or -1. This is /core's own containment test
   * (of_gp_patch_find over the lobed outline), not a distance to something.
   *
   * A drill without one is refused, and that refusal is where the mechanic
   * teaches itself: "you cannot place a drill here, there is no ore" is the one
   * sentence that tells a player the ground is what matters. A drill on nothing
   * would need a deposit invented for it here, which is how a second ore source
   * gets born.
   */
  patchUnder(pos: { x: number; y: number; z: number }): number {
    const i = this.ore.find(pos.x, pos.y, pos.z);
    if (i < 0) return -1;
    const p = this.ore.patch(i);
    return p !== null && p.remaining > 0 ? i : -1;
  }

  /** Push a fully formed record onto the plan and mint its id. The ONE place an
   *  id is issued, so a restored building and a placed one cannot collide.
   *  `FactoryRestore` is the only caller; `stage` builds its own record. */
  push(p: Omit<Placed, 'id'>): Placed {
    const row = { id: this.nextId++, ...p } as Placed;
    this.placed.push(row);
    return row;
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
   * plan. Per tile that is twenty-four rebuilds for one drag, and every rebuild
   * loses the items riding the belts, so the drag would silently eat ore as it
   * was laid.
   */
  stage(kind: BuildKind, s: Snapped & { addr?: MachineAddr },
        fwd: THREE.Vector3): Placed | null {
    // The site is founded HERE, before the cell is keyed, so a placement is
    // never recorded under a prospective key (see `claim` and FS-19).
    const addr = s.addr === undefined ? undefined : this.claim(s.addr);
    const cell = addr === undefined ? s.cell : machineCellKey(addr);
    if (this.occupied(cell)) return null;
    // GP-49. The ghost refused this and said why; asserted again because a red
    // ghost is a suggestion and a drag can reach `stage` without one.
    if (this.clash(kind, addr) !== null) return null;
    let patch = -1;
    if (kind === 'miner') {
      patch = this.patchUnder(s.pos);
      if (patch < 0) return null;
      // SEVERAL DRILLS ON ONE PATCH IS ALLOWED: a patch is a piece of ground,
      // not a socket, and they share the one pool.
    }
    const p: Placed = {
      id: this.nextId++, kind, pos: s.pos, cell, up: s.up.clone(),
      fwd: fwd.clone(), quat: orient(s.up, fwd), patch, lastRemaining: 0,
      build: -1, entity: -1, run: -1, grid: -1, fuel: 0,
      // FS-56. A fresh assembler is set to NOTHING: see NO_RECIPE.
      recipe: NO_RECIPE,
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

  /** FS-27: turn a placed building one quarter turn. `FactoryHand` owns it. */
  turn(p: Placed): boolean { return turnPlaced(this, p); }

  /** FS-28: take one item off the aimed belt tile. `FactoryHand` owns it. */
  takeFromBelt(p: Placed): { item: number; count: number } | null {
    return takeFromBelt(this, p);
  }

  /** Rebuild the plan from saved records and commit. `FactoryRestore` owns it,
   *  because a save is a seam and not a lifecycle. Returns what was restored. */
  restore(rows: readonly SavedBuilding[]): number { return restorePlan(this, rows); }

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
      // FS-41: the refund must not invent an item the smelter never held.
      const ore = smeltPairFor(this, p).ore;
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

  /** Empty a machine's output buffer into the pack. `FactoryHand` owns it. */
  collect(p: Placed, refund = false): number {
    return collectOutput(this, p, refund);
  }

  /** What a machine holds and EATS (/core's smelt table, never a JS list). */
  outputOf(p: Placed): number {
    return p.build < 0 || p.kind === 'belt' ? 0 : this.line.outputBuffer(p.build);
  }
  /** FS-41: the SAME pair the machine was built with. Asking the two halves
   *  separately is what let a coal-to-iron smelter exist. */
  /**
   * FS-64: AND AN ASSEMBLER'S FIRST INGREDIENT IS AN INPUT ITEM TOO.
   *
   * This returned 0 for every kind but the two smelters, which was complete
   * until a machine existed whose input is a recipe field rather than a smelt
   * pair. The cost was not a wrong number, it was a MISSING one:
   * `FactoryReport.row` publishes `input` only when `inputItemOf(p) > 0`, so an
   * assembler's slot-1 count read `null` however full it was, and
   * `probes/assembler.js` measured a peak of 0 in slot 1 on a machine that had
   * just manufactured twelve buildables out of it. A report that says null for a
   * hopper the sim is visibly draining is worse than one that says nothing,
   * because a probe cannot tell it from an empty machine.
   */
  inputItemOf(p: Placed): number {
    if (p.kind === 'assembler') return this.recipeOf(p)?.a.item ?? 0;
    return p.kind !== 'smelter' && p.kind !== 'esmelter' ? 0
      : smeltPairFor(this, p).ore;
  }
  inputOf(p: Placed): number { return p.build < 0 ? 0 : this.line.inputBuffer(p.build); }
  feed(p: Placed, n: number): void { if (p.build >= 0) this.line.feed(p.build, n); }

  outputItemOf(p: Placed): number {
    if (p.kind === 'smelter' || p.kind === 'esmelter') return smeltPairFor(this, p).ingot;
    // FS-56. An assembler's output is its RECIPE's: a choice the plan carries,
    // not a function of what feeds it.
    if (p.kind === 'assembler') return this.recipeOf(p)?.output ?? 0;
    const n = p.patch >= 0 ? this.ore.patch(p.patch) : null;
    return n?.resource ?? 0;
  }

  // FS-56: assembler recipes. `FactoryRecipes` owns all three, for the reason
  // `FactoryHand` owns `turn`: this class is the PLAN and its lifecycle.
  recipeMenu(): RecipeMenu { return menuOf(this); }
  recipeOf(p: Placed): AssemblerRecipe | null { return recipeOfPlaced(this, p); }
  setRecipe(p: Placed, out: number): boolean { return setPlacedRecipe(this, p, out); }

  /** The building the aim ray is most nearly CENTRED on, within `reachM`.
   *  `FactoryHand` owns the rule and argues it, because "what the crosshair
   *  resolved to" is a question about the hand and not about the plan. */
  pick(eye: { x: number; y: number; z: number },
       dir: { x: number; y: number; z: number }, reachM: number,
       belts = false): Placed | null {
    return pickAimed(this, eye, dir, reachM, belts);
  }

  report(): unknown { return factoryReport(this); }
}
