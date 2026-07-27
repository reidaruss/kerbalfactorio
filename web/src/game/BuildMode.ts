// BUILD MODE: what is in your hand, where it would go, and putting it there.
//
// The whole design goal is that the answer to "will this work?" is visible
// BEFORE the button is pressed. The ghost is red when the placement would be
// refused (cell taken, no deposit under a drill, ground too uneven) and blue
// when it would succeed, so a player learns the rules by moving the crosshair
// rather than by collecting error messages.
//
// WHAT CHANGED (GP-26, GP-27). The part in hand comes from the HOTBAR, not from
// a private digit menu, and the place key is the LEFT MOUSE BUTTON, not G.
// Holding it DRAGS: a belt run is laid by pressing once and sweeping the
// crosshair, which is the single most tedious thing this game asked of a player
// and the reason belts were being laid one keypress at a time.
//
// WHERE THE GHOST LANDS is a march of the aim ray against the surface oracle,
// not a fixed distance ahead of the eye. A fixed offset is fine for one object
// and wrong for a line, because laying belts means putting the next tile exactly
// where you are looking. WHICH CELL that hit belongs to is MachinePlacement's,
// and it is a metric site grid rather than /core's voxel lattice: see that
// file's header for the measurement that forced the change.

import { addressIn, headingIn, stepToward, type MachineAddr }
  from './MachinePlacement.js';
import { resolveGhost, type BuildRay, type BuildTarget } from './FactoryGhost.js';
import { axisStepOf, snapGapM, mateFor } from './FactorySnap.js';
import { FOOTPRINT, type BuildKind, type Factory, type Placed } from './Factory.js';
import { commitTarget, resolveTarget, type StructureTarget }
  from './StructurePlacement.js';
import { STRUCTURE_KINDS, type StructureKind } from './StructureGrid.js';
import { PART_INFO, type PartKind } from './Hotbar.js';
import type { Structures, StructurePart } from './Structures.js';
import type { StructureView } from './StructureView.js';
import type { FactoryView } from './FactoryView.js';
import type { Action } from '../player/Bindings.js';

export type { PartKind };
export type { BuildRay, BuildTarget };

function isStructure(k: PartKind | null): k is StructureKind {
  return k !== null && (STRUCTURE_KINDS as readonly string[]).includes(k);
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

export class BuildMode {
  /** Mirrors the hotbar. Set by `arm` every tick, never guessed here. */
  selected: PartKind | null = null;
  rotation = 0;
  placements = 0;
  refusals = 0;
  target: BuildTarget | null = null;
  /** The structural ghost, when a structural part is in hand. */
  structTarget: StructureTarget | null = null;
  /** B takes the snap off. Free placement is the same parts without rounding. */
  freePlace = false;
  /** The last structural part put down, for the confirmation message. */
  lastPart: StructurePart | null = null;
  /** Rate of the LAST accepted placement, for the confirmation message. */
  lastRate = 0;
  /** Tiles laid by the CURRENT drag, and the longest drag ever run. */
  dragLength = 0;
  longestDrag = 0;
  /** FS-27: buildings turned in place by R, and the last one, for the toast. */
  turns = 0;
  lastTurn: { id: number; kind: BuildKind } | null = null;
  /**
   * FS-26: the gap between the socket the last placement caught and the socket
   * the placed part presented back to it, in metres. -1 when the last placement
   * did not snap. THE number this feature is judged on.
   */
  lastSnapGapM = -1;
  lastSnapped = '';
  snaps = 0;
  private rotateHeld = false;
  private freeHeld = false;
  private useHeld = false;
  private dragLast: { addr: MachineAddr; placed: Placed;
                      step: { di: number; dj: number } | null } | null = null;
  private dragKey = '';

  constructor(private readonly factory: Factory, private readonly view: FactoryView,
              private readonly structures: Structures,
              private readonly structView: StructureView) {}

  /** Put `kind` in hand, or nothing. The hotbar's one call into build mode. */
  arm(kind: PartKind | null): void {
    if (kind === this.selected) return;
    this.selected = kind;
    this.endDrag();
    if (kind === null) { this.view.hideGhost(); this.structView.hideGhost(); }
  }

  get label(): string {
    return this.selected === null ? '' : PART_INFO[this.selected].label;
  }

  /** True while a hold-drag is laying a run. For the HUD and for the probe. */
  get dragging(): boolean { return this.dragLast !== null || this.dragKey !== ''; }

  /**
   * One fixed tick of build mode. `act` is Input.act, so a driven tape and a
   * human are the same thing here (ARCHITECTURE 11.2). `use` is the left button
   * as a HELD state, because the press and the hold mean different things.
   *
   * Returns how many parts went down this tick.
   */
  step(act: (a: Action) => boolean, use: boolean, ray: BuildRay): number {
    const rot = act('rotate');
    const turned = rot && !this.rotateHeld;
    this.rotateHeld = rot;
    if (this.selected === null) {
      this.target = null; this.structTarget = null;
      this.view.hideGhost(); this.structView.hideGhost();
      this.useHeld = use;
      this.endDrag();
      // FS-27: WITH NOTHING IN HAND, R TURNS WHAT IS UNDER THE CROSSHAIR. This
      // is Factorio's own split and it is unambiguous in a way that "guess from
      // context" is not: a part in hand means the key is about the GHOST, an
      // empty hand means it is about the WORLD. It lives here rather than in
      // GameplayInput because BuildMode already owns every meaning the rotate
      // key has, and a second owner is how one of them goes stale.
      if (turned) this.turnAimed(ray);
      return 0;
    }
    if (turned) this.rotation = (this.rotation + 1) % 4;
    // B TAKES THE SNAP OFF. Free placement is the same parts with the rounding
    // removed, which is why it is a modifier on this mode and not a second one.
    const free = act('freeSnap');
    if (free && !this.freeHeld) this.freePlace = !this.freePlace;
    this.freeHeld = free;

    const pressed = use && !this.useHeld;
    const released = !use && this.useHeld;
    this.useHeld = use;
    if (released) this.endDrag();

    const n = isStructure(this.selected)
      ? this.stepStructure(this.selected, ray, pressed, use)
      : this.stepMachine(this.selected, ray, pressed, use);
    this.dragLength = use ? this.dragLength + n : 0;
    if (this.dragLength > this.longestDrag) this.longestDrag = this.dragLength;
    return n;
  }

  private endDrag(): void {
    this.dragLast = null;
    this.dragKey = '';
    this.dragLength = 0;
  }

  /**
   * FS-27: turn whatever is under the crosshair one quarter turn, and re-commit.
   *
   * Belts are INCLUDED in the pick (`belts` true), which is the whole point: a
   * belt is the thing a player most wants to turn and the only thing the pick
   * normally hides, because a 1 m tile under the crosshair otherwise steals the
   * interact prompt from the machine behind it. Turning is not interacting, so
   * the exclusion does not apply here.
   */
  private turnAimed(ray: BuildRay): void {
    const b = this.factory.pick(ray.origin, ray.dir, TURN_REACH_M, true);
    if (b === null) return;
    if (!this.factory.turn(b)) return;
    this.turns++;
    this.lastTurn = { id: b.id, kind: b.kind };
  }

  /** Machines and belts: the ghost, the press, and the hold that lays a run. */
  private stepMachine(kind: BuildKind, ray: BuildRay, pressed: boolean,
                      held: boolean): number {
    this.structTarget = null;
    this.structView.hideGhost();
    // FS-26: a drag steers by the CROSSHAIR and never by a socket. See
    // `resolveGhost`; letting the snap move the ghost mid-drag laid the first
    // tile of a run in the cell behind the one it started from.
    const t = resolveGhost(this.factory, kind, ray, this.rotation,
      (x, y, z) => this.structures.groundRadius(x, y, z), this.view.sockets,
      !(held && this.dragLast !== null));
    this.target = t;
    if (t !== null) this.view.showGhost(kind, t.pos, t.up, t.fwd, t.ok);
    else this.view.hideGhost();
    if (t === null) return 0;

    if (pressed) {
      // PRESSING ON A TILE THAT IS ALREADY THERE STARTS A DRAG FROM IT rather
      // than doing nothing. Continuing an existing run by grabbing its end is
      // the most natural way to extend one, and refusing the press outright
      // left the player holding the button with nothing happening.
      const standing = this.factory.at(t.cell);
      if (standing !== null && standing.kind === kind) {
        this.dragLast = { addr: t.addr, placed: standing, step: null };
        return 0;
      }
      if (!t.ok) { this.refusals++; return 0; }
      const made = this.factory.add(kind, t, t.fwd);
      if (made === null) { this.refusals++; return 0; }
      // The site is founded by `Factory.stage` (FS-19), so this is now only a
      // belt and braces: `adoptSite` is idempotent by id.
      this.factory.adoptSite(t.addr);
      this.lastRate = t.ratePerSec;
      // FS-26: MEASURE THE SNAP AT THE MOMENT IT HAPPENS, against the socket the
      // ghost SAID it caught, not against the nearest one afterwards. Those are
      // the same number only if the snap actually drove the placement, which is
      // exactly the claim being made.
      this.lastSnapped = t.snapped;
      this.lastSnapGapM = t.hit === null ? -1
        : snapGapM(t.hit, made, this.view.sockets, mateFor(kind, t.hit));
      if (t.hit !== null) this.snaps++;
      this.placements++;
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
      return 1;
    }
    if (!held || this.dragLast === null || t.addr.site.id !== this.dragLast.addr.site.id) {
      return 0;
    }
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
      if (step !== null && now.di === -step.di && now.dj === -step.dj) break;
      const anchor = this.factory.snapAddr(next);
      const dir = { x: anchor.pos.x - last.pos.x, y: anchor.pos.y - last.pos.y,
        z: anchor.pos.z - last.pos.z };
      const fwd = headingIn(next.site, dir, 0);
      const made = this.factory.stage(kind, anchor, fwd);
      // A refused cell ENDS the drag rather than being stepped over: a run with
      // a hole in it is not a run, and jumping the hole would leave two tiles
      // 2 m apart claiming to be neighbours.
      if (made === null) break;
      this.factory.reface(last, fwd);
      from = next;
      step = now;
      last = made;
      this.placements++;
      n++;
    }
    if (n > 0) {
      this.factory.commit();
      this.dragLast = { addr: from, placed: last, step };
    }
    return n;
  }

  /**
   * The structural half. A separate path rather than a branch inside `resolve`,
   * because the two grids share a FRAME but not an address space: a deck takes
   * the cell it is inside and a wall takes the nearest cell edge.
   */
  private stepStructure(kind: StructureKind, ray: BuildRay, pressed: boolean,
                        held: boolean): number {
    this.target = null;
    this.view.hideGhost();
    const t = resolveTarget(this.structures, kind, ray, this.rotation, this.freePlace);
    this.structTarget = t;
    this.structView.showGhost(t);
    if (!pressed && !held) return 0;
    // Dragging a wall line is the same gesture as dragging a belt: place when
    // the crosshair reaches a cell that is not the one just built on.
    if (!pressed && t.key === this.dragKey) return 0;
    const made = commitTarget(this.structures, t);
    if (made === null) { if (pressed) this.refusals++; return 0; }
    this.dragKey = t.key;
    this.lastPart = made;
    this.placements++;
    return 1;
  }

  report(): unknown {
    return {
      selected: this.selected, label: this.label, rotation: this.rotation,
      freePlace: this.freePlace, dragging: this.dragging,
      dragLength: this.dragLength, longestDrag: this.longestDrag,
      placements: this.placements, refusals: this.refusals,
      // FS-27 / FS-26: the two numbers this pass is judged on.
      turns: this.turns, lastTurn: this.lastTurn,
      snaps: this.snaps, lastSnapped: this.lastSnapped,
      lastSnapGapM: this.lastSnapGapM,
      structGhost: this.structTarget === null ? null : {
        kind: this.structTarget.kind, ok: this.structTarget.ok,
        reason: this.structTarget.reason, key: this.structTarget.key,
        site: this.structTarget.site?.id ?? -1,
        addr: this.structTarget.addr === null ? null
          : [this.structTarget.addr.i, this.structTarget.addr.j,
            this.structTarget.addr.level, this.structTarget.addr.axis],
        pos: [this.structTarget.pos.x, this.structTarget.pos.y,
          this.structTarget.pos.z],
        unevennessM: +this.structTarget.unevennessM.toFixed(4),
        free: this.structTarget.freePlaced,
        // GP-37 / GP-38: WHAT it caught, and how far out over nothing it is.
        snapped: this.structTarget.snapped, carryRun: this.structTarget.carryRun,
      },
      ghost: this.target === null ? null : {
        cell: this.target.cell, ok: this.target.ok, reason: this.target.reason,
        // FS-19. `cell`, `site` and `ij` above are PLACEHOLDERS while this is
        // true: no site has been adopted, so the address was derived in a frame
        // centred on the aim point itself and two aims metres apart agree.
        prospective: this.target.prospective,
        // FS-26 / FS-27. `snapped` names the socket the ghost caught; `chains`
        // says a run would flow into this cell, which since FS-27 is a fact
        // about the RUN and no longer a claim that R is inert here.
        snapped: this.target.snapped, chains: this.target.chains,
        footprint: this.selected === null || isStructure(this.selected) ? 0
          : FOOTPRINT[this.selected],
        site: this.target.addr.site.id,
        ij: [this.target.addr.i, this.target.addr.j],
        pos: [this.target.pos.x, this.target.pos.y, this.target.pos.z],
        fwd: [this.target.fwd.x, this.target.fwd.y, this.target.fwd.z],
        patch: this.target.patch,
        ratePerSec: +this.target.ratePerSec.toFixed(3),
      },
      visible: this.view.ghostVisible || this.structView.ghostVisible,
    };
  }
}

export { addressIn };
