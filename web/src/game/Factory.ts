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
import { FOOTPRINT, type BuildKind, type Placed } from './FactoryKinds.js';
import { AutoLine } from './AutoLine.js';
import { Power } from './Power.js';
import { orient, type Snapped } from './Grid.js';
import { addressIn, anchorIn, machineCellKey, siteAt,
  type MachineAddr, type SiteHost } from './MachinePlacement.js';
import { factoryReport } from './FactoryReport.js';
import { commitPlan, oreFedTo } from './FactoryCommit.js';
import { collectOutput, takeFromBelt, turnPlaced } from './FactoryHand.js';
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
  /**
   * Where connect() actually wired something, so an inserter can be drawn there
   * (DW-9: the player never places one, but a connection has to be legible).
   */
  links: { pos: { x: number; y: number; z: number };
           up: THREE.Vector3; fwd: THREE.Vector3;
           /** The two plan ids the inserter sits between. REPORTED, because
            *  "which building feeds which" is the one thing a wiring defect
            *  gets wrong and the only thing a screenshot cannot show. */
           from: number; to: number }[] = [];
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
   * Looking founds nothing (`siteAt`); PLACING founds. That is the whole rule,
   * and putting it here rather than in the caller is what stops a placement
   * being keyed `m~12,-4,7:0,0` and then persisted in a form nothing else
   * speaks. Idempotent, because `adoptSite` is.
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
  stage(kind: BuildKind, s: Snapped & { addr?: MachineAddr },
        fwd: THREE.Vector3): Placed | null {
    // The site is founded HERE, before the cell is keyed, so a placement is
    // never recorded under a prospective key (see `claim` and FS-19).
    const addr = s.addr === undefined ? undefined : this.claim(s.addr);
    const cell = addr === undefined ? s.cell : machineCellKey(addr);
    if (this.occupied(cell)) return null;
    let patch = -1;
    if (kind === 'miner') {
      patch = this.patchUnder(s.pos);
      if (patch < 0) return null;
      // SEVERAL DRILLS ON ONE PATCH IS ALLOWED, and that is the point of a
      // patch: it is a piece of ground, not a socket. They share the one pool,
      // so covering a deposit in drills only makes it run out sooner.
    }
    const p: Placed = {
      id: this.nextId++, kind, pos: s.pos, cell, up: s.up.clone(),
      fwd: fwd.clone(), quat: orient(s.up, fwd), patch, lastRemaining: 0,
      build: -1, entity: -1, run: -1, grid: -1, fuel: 0,
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

  /**
   * Rebuild the whole plan from saved records and commit ONCE.
   *
   * One commit, not one per building, because a commit throws the network away
   * and rebuilds it: doing that per record would count N-1 spurious rebuilds
   * and, worse, would wire partial plans on the way. Returns what was restored.
   */
  restore(rows: readonly { kind: BuildKind; pos: [number, number, number];
                           cell: string; up: [number, number, number];
                           fwd: [number, number, number]; patch: number;
                           /** Generators only. Absent on a slot written before
                            *  ABI 9, which restores an empty generator: the
                            *  honest answer, and the same one a reload has
                            *  always given a furnace mid-burn. */
                           fuel?: number }[]): number {
    this.placed.length = 0;
    for (const r of rows) {
      const up = new THREE.Vector3(r.up[0], r.up[1], r.up[2]);
      const fwd = new THREE.Vector3(r.fwd[0], r.fwd[1], r.fwd[2]);
      this.placed.push({
        id: this.nextId++, kind: r.kind,
        pos: { x: r.pos[0], y: r.pos[1], z: r.pos[2] },
        cell: r.cell, up, fwd, quat: orient(up, fwd),
        patch: r.patch, lastRemaining: 0, build: -1, entity: -1, run: -1,
        grid: -1, fuel: r.fuel ?? 0,
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

  /** Empty a machine's output buffer into the pack. `FactoryHand` owns it. */
  collect(p: Placed, refund = false): number {
    return collectOutput(this, p, refund);
  }

  /** What a machine holds and EATS (/core's smelt table, never a JS list). */
  outputOf(p: Placed): number {
    return p.build < 0 || p.kind === 'belt' ? 0 : this.line.outputBuffer(p.build);
  }
  inputItemOf(p: Placed): number {
    return p.kind !== 'smelter' && p.kind !== 'esmelter' ? 0
      : oreFedTo(this, p) || this.core.ids.rawIron;
  }
  inputOf(p: Placed): number { return p.build < 0 ? 0 : this.line.inputBuffer(p.build); }
  feed(p: Placed, n: number): void { if (p.build >= 0) this.line.feed(p.build, n); }

  outputItemOf(p: Placed): number {
    if (p.kind === 'smelter' || p.kind === 'esmelter') {
      return this.M._of_gp_smelt_output_for(oreFedTo(this, p) || this.core.ids.rawIron)
        || this.core.ids.iron;
    }
    const n = p.patch >= 0 ? this.ore.patch(p.patch) : null;
    return n?.resource ?? 0;
  }

  /**
   * The building the aim ray is most nearly CENTRED on, within `reachM`.
   *
   * FS-28 CHANGED THE RANKING FROM NEAREST TO BEST-CENTRED, and it had to.
   * The old rule kept whichever candidate the ray entered FIRST, which is fine
   * while everything is the same size and wrong the moment they are not: a
   * smelter's interaction sphere is 1.6 m against a belt tile's 1.0 m, so a belt
   * standing just past a smelter is inside the smelter's sphere from almost
   * every angle and could not be aimed at AT ALL. Measured with the take verb
   * (`probes/autoline.js`): an aim **0.005 m** off a belt tile's centre resolved
   * to the smelter on every one of seven presses, from four different standing
   * positions, so "take what is on this belt" was unreachable for any belt near
   * a machine. That is a feature that exists and cannot be used.
   *
   * The score is the perpendicular miss as a FRACTION of the candidate's own
   * radius, so it asks "how centred is the crosshair on this thing" rather than
   * "which thing is nearest", and distance only breaks ties. A player pointing
   * at a smelter still gets the smelter, because a crosshair on a 2 m machine
   * scores near zero against it and poorly against anything beside it.
   */
  pick(eye: { x: number; y: number; z: number },
       dir: { x: number; y: number; z: number }, reachM: number,
       belts = false): Placed | null {
    let best: Placed | null = null;
    let bestScore = Infinity;
    let bestT = Infinity;
    for (const p of this.placed) {
      if (p.kind === 'belt' && !belts) continue;
      const r = FOOTPRINT[p.kind] * 0.6 + 0.4;
      const ox = p.pos.x + p.up.x * 0.7 - eye.x;
      const oy = p.pos.y + p.up.y * 0.7 - eye.y;
      const oz = p.pos.z + p.up.z * 0.7 - eye.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -r || t > reachM) continue;
      const miss = Math.hypot(ox - dir.x * t, oy - dir.y * t, oz - dir.z * t);
      if (miss > r) continue;
      const score = miss / r;
      if (score > bestScore + 1e-6) continue;
      if (score > bestScore - 1e-6 && t >= bestT) continue;
      best = p; bestScore = score; bestT = Math.max(0, t);
    }
    return best;
  }

  report(): unknown { return factoryReport(this); }
}
