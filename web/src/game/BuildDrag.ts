// THE MACHINE HALF OF BUILD MODE: the ghost that snaps, the press that lays a
// tile, and the run a held button walks out behind the crosshair.
//
// Split out of BuildMode.ts because ONE BUILD KEY DRIVES TWO BUILD SYSTEMS. The
// left button always means "put the thing in your hand down", and what that
// sentence actually does depends entirely on what the hand is holding.
//
// A MACHINE OR A BELT ADDRESSES NOTHING BY ITSELF. It asks the sockets the art
// lane published what it is allowed to attach to (FS-26), it lands where the aim
// ray meets the surface rather than at a fixed distance, and while the button
// stays down it steps cell by cell towards the crosshair, turning each tile to
// point at its successor so the run is chained by construction. Every one of
// those is a fact about a SOCKET GRAPH and a march.
//
// A DECK OR A WALL ADDRESSES A CELL. It names a cell of the structural site
// grid, is allowed or refused by that grid's own rules, and its hard problem is
// the opposite one: the aim moving when the player did not, because the deck it
// just laid rose under the walker's feet (GP-59). Nothing in that paragraph and
// nothing in the one above it share a line of code.
//
// So the seam is where the two systems stop agreeing, not where the file happened
// to get long. WHAT STAYS IN BuildMode is what both halves genuinely share: what
// is in hand, the rotation, the press and release edges, the single `moved` test
// both drags consult, and the counters the HUD and the probes read. WHAT LIVES
// HERE is the machine drag's own state, so that exactly one object knows whether
// a run is in progress and what its last tile and direction were.
//
// THE COUNTERS STAY ON BuildMode ON PURPOSE. `BuildMode.report()` is a published
// surface that the smoke probes read field by field, and it must not learn a new
// shape because a file was split. This class writes them through the `DragHost`
// reference below, so the probes cannot tell the difference and neither can the
// HUD.

import { headingIn, stepToward, type MachineAddr } from './MachinePlacement.js';
import { resolveGhost, type BuildRay, type BuildTarget } from './FactoryGhost.js';
import { axisStepOf, snapGapM, mateFor } from './FactorySnap.js';
import type { DragStep, DragTrace } from './DragTrace.js';
import type { BuildKind, Factory, Placed } from './Factory.js';
import type { StructureTarget } from './StructurePlacement.js';
import type { PadTarget } from './LaunchPadPlacement.js';
import type { Structures } from './Structures.js';
import type { StructureView } from './StructureView.js';
import type { LaunchPadView } from './LaunchPadView.js';
import type { FactoryView } from './FactoryView.js';

/**
 * The fields on `BuildMode` this drag writes to. Every one of them is already
 * published by `BuildMode.report()`, which is exactly why they stay declared
 * there and are only written from here: a probe's view of a placement must not
 * depend on which file made the placement.
 */
export interface DragHost {
  target: BuildTarget | null;
  structTarget: StructureTarget | null;
  padTarget: PadTarget | null;
  placements: number;
  refusals: number;
  turns: number;
  lastTurn: { id: number; kind: BuildKind } | null;
  snaps: number;
  lastSnapped: string;
  lastSnapGapM: number;
  lastRate: number;
  dragSettles: number;
}

/**
 * How far R reaches to turn a building that is already down (FS-27). The same
 * 3.5 m the interact and demolish keys use, so "what R will turn" and "what E
 * will open" can never be two different things under one crosshair.
 */
const TURN_REACH_M = 3.5;
/**
 * Cells a single drag tick may fill in.
 *
 * A drag is sampled once per fixed tick, and a player sweeping the crosshair
 * fast crosses several cells between samples. Filling the gap is what makes a
 * dragged run CONTINUOUS rather than a dotted line, which matters because a
 * dotted line of belts is exactly the "visually adjacent tiles that are not
 * chained" failure this work exists to remove. The cap stops a teleport, or a
 * frame that dropped a second, from carpeting the planet.
 */
const DRAG_FILL_MAX = 24;

export class MachineDrag {
  private dragLast: { addr: MachineAddr; placed: Placed;
                      step: { di: number; dj: number } | null } | null = null;
  /** GP-59: set on the tick a PRESS lays a machine, cleared on the next held
   *  tick. See `stepMachine` for why that one tick has to be skipped. */
  private dragFresh = false;
  /**
   * FS-99. The per-tick decision trace, OFF unless a probe armed it. See
   * DragTrace.ts: it exists because a tile count taken from outside cannot say
   * which of several hundred per-tick choices differed between two runs.
   */
  trace: DragTrace | null = null;
  /** Cells the fill loop looked at THIS tick, collected by `dragRun` and
   *  written out by `stepMachine`. Reused rather than reallocated. */
  private steps: DragStep[] = [];
  /** Which of `machineTick`'s returns the last tick took. FS-99. */
  private gate = 'idle';

  constructor(private readonly factory: Factory,
              private readonly view: FactoryView,
              private readonly structures: Structures,
              private readonly structView: StructureView,
              private readonly padView: LaunchPadView | null,
              private readonly host: DragHost) {}

  /** True while a run is in progress. `BuildMode.dragging` is built on it. */
  get active(): boolean { return this.dragLast !== null; }

  /** Forget the run. The button came up, or the hand changed. */
  end(): void { this.dragLast = null; this.dragFresh = false; }

  /**
   * FS-27: turn whatever is under the crosshair one quarter turn, and re-commit.
   *
   * Belts are INCLUDED in the pick (`belts` true), which is the whole point: a
   * belt is the thing a player most wants to turn and the only thing the pick
   * normally hides, because a 1 m tile under the crosshair otherwise steals the
   * interact prompt from the machine behind it. Turning is not interacting, so
   * the exclusion does not apply here.
   */
  turnAimed(ray: BuildRay): void {
    const b = this.factory.pick(ray.origin, ray.dir, TURN_REACH_M, true);
    if (b === null) return;
    if (!this.factory.turn(b)) return;
    this.host.turns++;
    this.host.lastTurn = { id: b.id, kind: b.kind };
  }

  /**
   * Machines and belts: the ghost, the press, and the hold that lays a run.
   *
   * FS-99: with no trace armed this is one null test and a direct call, so the
   * shipped path is the one that was always here.
   */
  stepMachine(kind: BuildKind, ray: BuildRay, rotation: number, pressed: boolean,
              held: boolean, moved: boolean): number {
    if (this.trace === null) {
      return this.machineTick(kind, ray, rotation, pressed, held, moved);
    }
    this.steps = [];
    const tip = this.dragLast;
    const n = this.machineTick(kind, ray, rotation, pressed, held, moved);
    const t = this.host.target;
    this.trace.push({
      seq: this.trace.total,
      ox: ray.origin.x, oy: ray.origin.y, oz: ray.origin.z,
      dx: ray.dir.x, dy: ray.dir.y, dz: ray.dir.z,
      cell: t?.cell ?? '', ci: t?.addr.i ?? 0, cj: t?.addr.j ?? 0,
      aimed: t?.aimed ?? false, ok: t?.ok ?? false, reason: t?.reason ?? '',
      pressed, held, moved,
      ti: tip?.addr.i ?? null, tj: tip?.addr.j ?? null,
      si: tip?.step?.di ?? null, sj: tip?.step?.dj ?? null,
      steps: this.steps, gate: this.gate,
    });
    return n;
  }

  /** The tick itself. `gate` names which of its returns was taken (FS-99). */
  private machineTick(kind: BuildKind, ray: BuildRay, rotation: number,
                      pressed: boolean, held: boolean, moved: boolean): number {
    this.gate = 'idle';
    this.host.structTarget = null;
    this.host.padTarget = null;
    this.structView.hideGhost();
    this.padView?.hideGhost();
    // FS-26: a drag steers by the CROSSHAIR and never by a socket. See
    // `resolveGhost`; letting the snap move the ghost mid-drag laid the first
    // tile of a run in the cell behind the one it started from.
    const t = resolveGhost(this.factory, kind, ray, rotation,
      (x, y, z) => this.structures.groundRadius(x, y, z), this.view.sockets,
      !(held && this.dragLast !== null));
    this.host.target = t;
    // GP-289. The machine half of the same rule, and its fallback is the
    // WORST of the three: `FactoryGhost.FALLBACK_M` is 2.6 m, so a machine
    // preview aimed at the sky sits 2.6 m above the player's own head, closer
    // in than a building's 6 m. Found by sweeping the class (WG-144) rather
    // than by a second report.
    if (t !== null) this.view.showGhost(kind, t.pos, t.up, t.fwd, t.ok);
    else this.view.hideGhost();
    if (t === null) { this.gate = 'ghost'; return 0; }

    if (pressed) {
      // PRESSING ON A TILE THAT IS ALREADY THERE STARTS A DRAG FROM IT rather
      // than doing nothing. Continuing an existing run by grabbing its end is
      // the most natural way to extend one, and refusing the press outright
      // left the player holding the button with nothing happening.
      const standing = this.factory.at(t.cell);
      if (standing !== null && standing.kind === kind) {
        this.dragLast = { addr: t.addr, placed: standing, step: null };
        this.gate = 'standing';
        return 0;
      }
      if (!t.ok) { this.host.refusals++; this.gate = 'refused'; return 0; }
      const made = this.factory.add(kind, t, t.fwd);
      if (made === null) { this.host.refusals++; this.gate = 'refused'; return 0; }
      // The site is founded by `Factory.stage` (FS-19), so this is now only a
      // belt and braces: `adoptSite` is idempotent by id.
      this.factory.adoptSite(t.addr);
      this.host.lastRate = t.ratePerSec;
      // FS-26: MEASURE THE SNAP AT THE MOMENT IT HAPPENS, against the socket the
      // ghost SAID it caught, not against the nearest one afterwards. Those are
      // the same number only if the snap actually drove the placement, which is
      // exactly the claim being made.
      this.host.lastSnapped = t.snapped;
      this.host.lastSnapGapM = t.hit === null ? -1
        : snapGapM(t.hit, made, this.view.sockets, mateFor(kind, t.hit));
      if (t.hit !== null) this.host.snaps++;
      this.host.placements++;
      // FS-26: A SNAPPED PLACEMENT SEEDS THE DRAG WITH THE DIRECTION IT WENT.
      //
      // The reversal guard in `dragRun` refuses a step that undoes the last one,
      // and on the first step of a fresh drag there was no last one to compare
      // against. That was harmless while a placement always landed under the
      // crosshair, and it stopped being harmless the moment a snap could put the
      // tile a cell or two BEYOND the crosshair: holding the button after a
      // snapped press then walked the run straight back to the cell the player
      // was pointing at. Measured (`probes/autoline.js`): a drill's belt line
      // laid its second tile between the drill and its own first tile, and the
      // run reversed into a two-tile stub. Seeding the step closes it, and the
      // direction is the real one (owner to placed), not the tile's heading,
      // because a tile snapped onto a run's TAIL faces forward while the run
      // grows backward.
      let step: { di: number; dj: number } | null = null;
      if (t.hit !== null) {
        const owner = this.factory.snap(t.hit.build.pos.x, t.hit.build.pos.y,
          t.hit.build.pos.z).addr;
        const [di, dj] = axisStepOf(t.addr.site, {
          x: made.pos.x - t.hit.build.pos.x, y: made.pos.y - t.hit.build.pos.y,
          z: made.pos.z - t.hit.build.pos.z });
        if (owner.site.id === t.addr.site.id) step = { di, dj };
      }
      this.dragLast = { addr: { ...t.addr, prospective: false }, placed: made,
        step };
      this.dragFresh = true;
      this.gate = 'placed';
      return 1;
    }
    if (!held || this.dragLast === null) { this.gate = 'idle'; return 0; }
    if (t.addr.site.id !== this.dragLast.addr.site.id) {
      this.gate = 'site';
      return 0;
    }
    // GP-59, the machine half, and it needs a second guard the structural half
    // does not.
    //
    // `moved` alone does not cover it, because a belt run is laid by holding the
    // button and WALKING (probes/controls.js lays fifteen tiles that way), so
    // the gate is open from the very first tick of the press. And on that first
    // held tick the ghost's address legitimately moves for a reason that has
    // nothing to do with the player: `resolveGhost` runs with the socket SNAP
    // ON during a press and OFF during a drag (FS-26, and for a good reason of
    // its own), so a press that snapped lays its tile at one address and the
    // very next tick resolves the crosshair to another. `dragRun` then walks
    // one cell towards it and lays a second tile. Measured by controls.js as
    // "one press, one tile: 2 in the first three ticks".
    //
    // So the tick immediately after a pressed placement is skipped, once. That
    // is not a tuned settle: it is exactly the one tick on which the snap is
    // known to change under the drag, and it costs a run 16 ms of its start.
    if (this.dragFresh) {
      this.dragFresh = false; this.host.dragSettles++; this.gate = 'fresh';
      return 0;
    }
    if (!moved) { this.host.dragSettles++; this.gate = 'still'; return 0; }
    this.gate = 'run';
    return this.dragRun(kind, t);
  }

  /**
   * The hold-drag itself, and the reason it is worth its own method.
   *
   * EVERY TILE IS TURNED TO POINT AT ITS SUCCESSOR. When a tile goes down there
   * is no successor yet, so its heading is whatever the crosshair had; the next
   * tile is what says which way the run actually goes, and `reface` turns the
   * one behind it to match. Do that at every step and the run is chained BY
   * CONSTRUCTION rather than by the aim happening to stay on axis, corners
   * included: a heading that changes between two tiles is exactly what the belt
   * curve renderer already reads.
   *
   * Then ONE commit for the whole tick, because a commit rebuilds the /core
   * network and loses whatever is riding the belts.
   */
  /**
   * FS-99: record one cell the fill loop considered, with the heading it was
   * about to be given, reduced to the site's own tangent axes.
   *
   * THE HEADING IS RECORDED HERE AND NOT READ BACK OFF THE PLACEMENT because
   * `reface` turns the previous tile on the very next iteration. A run read
   * after the fact therefore reports every tile's SECOND heading, and the only
   * tile that keeps its first one is the tip, which is precisely the tile the
   * reported symptom is about.
   */
  private mark(next: MachineAddr, how: DragStep['how'],
               fwd: { x: number; y: number; z: number } | null): void {
    if (this.trace === null) return;
    const s = next.site;
    const e = fwd === null ? 0
      : Math.round(fwd.x * s.east.x + fwd.y * s.east.y + fwd.z * s.east.z);
    const n = fwd === null ? 0
      : Math.round(fwd.x * s.north.x + fwd.y * s.north.y + fwd.z * s.north.z);
    this.steps.push({ i: next.i, j: next.j, how, e, n });
  }

  private dragRun(kind: BuildKind, t: BuildTarget): number {
    const start = this.dragLast;
    if (start === null) return 0;
    let from = start.addr;
    let last: Placed = start.placed;
    let step = start.step;
    let n = 0;
    for (let i = 0; i < DRAG_FILL_MAX; ++i) {
      const next = stepToward(from, t.addr);
      if (next === null) break;
      const now = { di: next.i - from.i, dj: next.j - from.j };
      // A REVERSAL ENDS THE DRAG. Sweeping the crosshair back over the run just
      // laid would otherwise turn the tail around to face the way it came, and
      // a tile pointing at its own predecessor is exactly the break that makes
      // one visible line into two transport lines. A ninety-degree turn is
      // fine and is what a corner is.
      if (step !== null && now.di === -step.di && now.dj === -step.dj) {
        this.mark(next, 'reversal', null);
        break;
      }
      const anchor = this.factory.snapAddr(next);
      const dir = { x: anchor.pos.x - last.pos.x, y: anchor.pos.y - last.pos.y,
        z: anchor.pos.z - last.pos.z };
      const fwd = headingIn(next.site, dir, 0);
      const made = this.factory.stage(kind, anchor, fwd);
      // A refused cell ENDS the drag rather than being stepped over: a run with
      // a hole in it is not a run, and jumping the hole would leave two tiles
      // 2 m apart claiming to be neighbours.
      if (made === null) { this.mark(next, 'refused', fwd); break; }
      this.mark(next, 'laid', fwd);
      this.factory.reface(last, fwd);
      from = next;
      step = now;
      last = made;
      this.host.placements++;
      n++;
    }
    if (n > 0) {
      this.factory.commit();
      this.dragLast = { addr: from, placed: last, step };
    }
    return n;
  }
}
