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

import { addressIn } from './MachinePlacement.js';
import { MachineDrag } from './BuildDrag.js';
import { DragTrace } from './DragTrace.js';
import type { BuildRay, BuildTarget } from './FactoryGhost.js';
import { FOOTPRINT, type BuildKind, type Factory } from './Factory.js';
import { commitTarget, resolveTarget, type StructureTarget }
  from './StructurePlacement.js';
import { STRUCTURE_KINDS, type StructureKind } from './StructureGrid.js';
import { commitPad, resolvePadTarget, type PadTarget }
  from './LaunchPadPlacement.js';
import { FIXTURE_KINDS, PART_INFO, type FixtureKind, type PartKind }
  from './Hotbar.js';
import type { LaunchPads, PadPart } from './LaunchPad.js';
import type { LaunchPadView } from './LaunchPadView.js';
import type { Structures, StructurePart } from './Structures.js';
import type { StructureView } from './StructureView.js';
import type { FactoryView } from './FactoryView.js';
import type { Action } from '../player/Bindings.js';

export type { PartKind };
export type { BuildRay, BuildTarget };

function isStructure(k: PartKind | null): k is StructureKind {
  return k !== null && (STRUCTURE_KINDS as readonly string[]).includes(k);
}

function isFixture(k: PartKind | null): k is FixtureKind {
  return k !== null && (FIXTURE_KINDS as readonly string[]).includes(k);
}

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
  /** GP-57: the launch-pad ghost, when a pad is in hand, and the last pad laid. */
  padTarget: PadTarget | null = null;
  lastPad: PadPart | null = null;
  /**
   * WHY THE PAD'S RESEARCH REFUSAL ARRIVES AS A STRING RATHER THAN BEING ASKED
   * FOR HERE. The gate belongs to `ModeRules.researchGated` and its sentence is
   * composed from the tech's own name, both of which live in GameplayActions;
   * this file would have to learn what a game mode and a tech tree are to ask
   * the question, and it already knows enough. Empty means unlocked.
   */
  padLocked = '';
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
  private dragKey = '';
  /**
   * GP-59: the cell the structural ghost named on the PREVIOUS tick.
   *
   * A held drag places in a cell only once the aim has named it on TWO
   * CONSECUTIVE ticks. See `stepStructure` for the measurement that forced it.
   */
  private dragPrevKey = '';
  /** GP-59: the LOOK ANGLES the last placement of ANY kind was made at. A held
   *  button places again only once the player has turned away from them. */
  private dragAim: { yaw: number; pitch: number } | null = null;
  /** The machine/belt half, which owns its own drag state. See BuildDrag.ts. */
  private readonly drag: MachineDrag;
  /** Ticks a held button was refused because the crosshair had not moved since
   *  the last placement. Published, because a rule that swallowed every drag
   *  would otherwise look exactly like a rule that was working. */
  dragSettles = 0;

  constructor(private readonly factory: Factory, private readonly view: FactoryView,
              private readonly structures: Structures,
              private readonly structView: StructureView,
              /** GP-57. The pad's world and its batch. Ports rather than
               *  imports so a `?vab=0`-style boot with no pad content still
               *  builds everything else, and so this file keeps no opinion
               *  about what a launch pad is. */
              private readonly pads: LaunchPads | null = null,
              private readonly padView: LaunchPadView | null = null) {
    this.drag = new MachineDrag(this.factory, this.view, this.structures,
      this.structView, this.padView, this);
  }

  /** Put `kind` in hand, or nothing. The hotbar's one call into build mode. */
  arm(kind: PartKind | null): void {
    if (kind === this.selected) return;
    this.selected = kind;
    this.endDrag();
    if (kind === null) {
      this.view.hideGhost(); this.structView.hideGhost();
      this.padView?.hideGhost();
    }
  }

  get label(): string {
    return this.selected === null ? '' : PART_INFO[this.selected].label;
  }

  /** True while a hold-drag is laying a run. For the HUD and for the probe. */
  get dragging(): boolean { return this.drag.active || this.dragKey !== ''; }

  /**
   * One fixed tick of build mode. `act` is Input.act, so a driven tape and a
   * human are the same thing here (ARCHITECTURE 11.2). `use` is the left button
   * as a HELD state, because the press and the hold mean different things.
   *
   * Returns how many parts went down this tick.
   */
  step(act: (a: Action) => boolean, use: boolean, ray: BuildRay,
       /** GP-59: what the PLAYER is doing, as opposed to what the world is
        *  doing to them. `yaw`/`pitch` are the observer's own look angles and
        *  `moving` is whether a movement key is down this tick. Not derived
        *  from the aim ray, because the ray changes when the player is lifted
        *  onto their own new foundation and none of these three do. Optional,
        *  so a caller with no camera keeps the old behaviour exactly. */
       aim: { yaw: number; pitch: number; moving: boolean } | null = null): number {
    const rot = act('rotate');
    const turned = rot && !this.rotateHeld;
    this.rotateHeld = rot;
    if (this.selected === null) {
      this.target = null; this.structTarget = null; this.padTarget = null;
      this.view.hideGhost(); this.structView.hideGhost();
      this.padView?.hideGhost();
      this.useHeld = use;
      this.endDrag();
      // FS-27: WITH NOTHING IN HAND, R TURNS WHAT IS UNDER THE CROSSHAIR. This
      // is Factorio's own split and it is unambiguous in a way that "guess from
      // context" is not: a part in hand means the key is about the GHOST, an
      // empty hand means it is about the WORLD. It lives here rather than in
      // GameplayInput because BuildMode already owns every meaning the rotate
      // key has, and a second owner is how one of them goes stale.
      if (turned) this.drag.turnAimed(ray);
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

    // GP-59. HAS THE PLAYER MOVED THE CROSSHAIR SINCE THE LAST PLACEMENT?
    //
    // ONE answer, for both families, because it is one rule and Reid met it in
    // both: a foundation click placing several, and `probes/controls.js`
    // catching "one press, one tile: 2 in the first three ticks" for a belt. A
    // per-family fix would have been two rules to keep in step, and the second
    // one would have gone stale.
    //
    // THE SIGNAL IS PLAYER INPUT, and it has two halves because a player drives
    // a run two ways. TURNING changes the observer's own yaw and pitch, which
    // mouse look writes and nothing else does. WALKING with the button down is
    // the other way, and it is the one `probes/controls.js` uses to lay a
    // fifteen-tile belt run, so it has to count: a rule that only watched the
    // look angles killed that run dead and the probe said so within a minute.
    //
    // What neither half responds to is the WORLD moving under a player who is
    // doing nothing: a part appearing under the crosshair, the walker stepping
    // up onto it, and the aim ray's ORIGIN rising with it all leave the look
    // angles alone and set no movement key. That is the whole distinction, and
    // there is no threshold anywhere in it: the angles are compared against
    // their values at the last placement, and a mouse that did not move leaves
    // them identical.
    const moved = aim === null || this.dragAim === null || aim.moving
      || aim.yaw !== this.dragAim.yaw || aim.pitch !== this.dragAim.pitch;
    const n = isFixture(this.selected) ? this.stepPad(ray, pressed)
      : isStructure(this.selected)
        ? this.stepStructure(this.selected, ray, pressed, use, moved)
        : this.drag.stepMachine(this.selected, ray, this.rotation, pressed, use,
          moved);
    if (n > 0 && aim !== null) this.dragAim = { yaw: aim.yaw, pitch: aim.pitch };
    this.dragLength = use ? this.dragLength + n : 0;
    if (this.dragLength > this.longestDrag) this.longestDrag = this.dragLength;
    return n;
  }

  /**
   * FS-99. Arm, read or disarm the machine drag's per-tick decision trace.
   *
   * A pass-through rather than a public `drag` field: `MachineDrag` is this
   * file's own state and the reason it was split out (see BuildDrag.ts) is that
   * exactly one object knows whether a run is in progress. Handing the object
   * itself to the debug surface would make that two.
   */
  dragTrace(on?: boolean): DragTrace | null {
    if (on === false) { this.drag.trace = null; return null; }
    if (on === true) {
      if (this.drag.trace === null) this.drag.trace = new DragTrace();
      this.drag.trace.reset();
    }
    return this.drag.trace;
  }

  private endDrag(): void {
    this.drag.end();
    this.dragKey = '';
    this.dragPrevKey = '';
    this.dragAim = null;
    this.dragLength = 0;
  }

  /**
   * The structural half. A separate path rather than a branch inside `resolve`,
   * because the two grids share a FRAME but not an address space: a deck takes
   * the cell it is inside and a wall takes the nearest cell edge.
   */
  /**
   * The launch pad. NO DRAG, deliberately: a drag lays a RUN, and a run of
   * 24 m pads is not a thing anybody wants by accident. One press, one pad.
   */
  private stepPad(ray: BuildRay, pressed: boolean): number {
    this.target = null;
    this.structTarget = null;
    this.view.hideGhost();
    this.structView.hideGhost();
    if (this.pads === null || this.padView === null) return 0;
    const t = resolvePadTarget(this.pads, this.structures, ray, this.padLocked);
    this.padTarget = t;
    // GP-289. The preview is ALWAYS on the ground now, at every pitch: see
    // `StructurePlacement.fallbackOnGround`. `t.aimed` rides along as
    // information (false means the ray reached its full 24 m without touching
    // anything, which on a 600 km body is the ordinary case near the horizon)
    // and is deliberately NOT a gate: hiding the preview whenever the march
    // missed would hide it on flat open ground, which was the first version of
    // this fix and was worse than the bug.
    if (t.overhead) this.padView.hideGhost(); else this.padView.showGhost(t);
    if (!pressed) return 0;
    const made = commitPad(this.pads, t);
    if (made === null) { this.refusals++; return 0; }
    this.lastPad = made;
    this.placements++;
    return 1;
  }

  private stepStructure(kind: StructureKind, ray: BuildRay, pressed: boolean,
                        held: boolean, moved: boolean): number {
    this.target = null;
    this.padTarget = null;
    this.view.hideGhost();
    this.padView?.hideGhost();
    const t = resolveTarget(this.structures, kind, ray, this.rotation,
      this.freePlace);
    this.structTarget = t;
    // GP-289. Drawn everywhere except the narrow overhead cone, where every
    // position is a guess and the nearest guess is one the player is inside.
    if (t.overhead) this.structView.hideGhost();
    else this.structView.showGhost(t);
    const prev = this.dragPrevKey;
    this.dragPrevKey = t.key;
    if (!pressed && !held) return 0;
    // Dragging a wall line is the same gesture as dragging a belt: place when
    // the crosshair reaches a cell that is not the one just built on.
    if (!pressed && t.key === this.dragKey) return 0;
    // =====================================================================
    // GP-59. A HELD DRAG PLACES IN A CELL ONLY ONCE THE AIM HAS NAMED IT ON
    // TWO CONSECUTIVE TICKS. Reid: "when i click to place a foundation, it
    // typically places multiple."
    //
    // MEASURED, sampling the ghost's own cell key every tick through a real
    // pointerdown / pointerup pair on the canvas with the mouse held perfectly
    // still: the press commits in cell (0,0), the very NEXT tick names (0,-1),
    // and every tick after that names (0,0) again. One tick of excursion, one
    // cell wide, and a button that is still down places a second foundation in
    // it. A human click is 60 to 150 ms, which is 4 to 9 ticks at 60 Hz, so it
    // covers that tick essentially always: this is not an edge case, it is what
    // a click DOES.
    //
    // The excursion is caused by the placement itself. `aimPoint` marches
    // against what is already BUILT as well as against the ground, and it has
    // to (or no upper storey could ever be aimed at), so the new deck top face
    // and the walker stepping UP onto that deck both move the aim in the one
    // tick that follows the commit. The player never touched the mouse.
    //
    // TWO CONSECUTIVE TICKS rather than a minimum cursor travel, and that is
    // the point. A travel threshold needs a number, and the number would have
    // to exceed a transient whose size is deckH / tan(pitch) and is therefore
    // UNBOUNDED as the player looks flatter, so anything that worked today
    // would be a number tuned until the symptom stopped. A settle test has no
    // number in it at all: it rejects any excursion shorter than the dwell, and
    // a genuine sweep dwells in a 4 m cell for tens of ticks, so the cost to a
    // real drag is one tick of latency nobody can see.
    //
    // A PRESS IS EXEMPT and must be: a click has to place on the tick it
    // happens, or the game would feel like it was ignoring the button, which is
    // the complaint this project has spent a week removing.
    // =====================================================================
    if (!pressed && t.key !== prev) { this.dragSettles++; return 0; }
    // ...AND ONLY ONCE THE PLAYER HAS ACTUALLY TURNED. See `moved` in `step`.
    //
    // The settle test above rejects a ONE-tick excursion on its own, and the
    // excursion is sometimes TWO ticks: measured, a 60 ms click still laid two
    // foundations with the settle test alone, because the aim spent two
    // consecutive ticks in the neighbouring cell before coming back.
    // Lengthening the settle would be choosing a number to sit above however
    // long the transient happens to be today, which is exactly the failure this
    // comment exists to avoid. `moved` has no number in it.
    //
    // THE COST, stated rather than hidden: holding the button and WALKING
    // forward without turning no longer extends a run. That is the same rule
    // belts already follow (FS-26: a drag steers by the crosshair and by
    // nothing else), and it is what a player means by "drag".
    if (!pressed && !moved) { this.dragSettles++; return 0; }
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
      // GP-59: ticks a held button spent on a cell the aim had not settled on.
      // Published because a settle rule that swallowed EVERY drag would look
      // identical to one that was working, and this is what tells them apart.
      dragSettles: this.dragSettles,
      snaps: this.snaps, lastSnapped: this.lastSnapped,
      lastSnapGapM: this.lastSnapGapM,
      // GP-57. Everything a probe needs to judge a pad placement WITHOUT
      // reaching into the model: what it caught, why it was refused, and the
      // count that makes the refusal an instruction.
      padGhost: this.padTarget === null ? null : {
        ok: this.padTarget.ok, reason: this.padTarget.reason,
        key: this.padTarget.key, site: this.padTarget.site?.id ?? -1,
        addr: [this.padTarget.i, this.padTarget.j, this.padTarget.level],
        cells: this.padTarget.cells, missingCells: this.padTarget.missingCells,
        pos: [this.padTarget.pos.x, this.padTarget.pos.y, this.padTarget.pos.z],
        locked: this.padLocked,
      },
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
        // FS-45. WOULD THIS CONNECT, and if not why not, before the button goes
        // down. Published here because the probe that judges the port model has
        // to read the same sentence the player does; a probe that recomputed the
        // verdict would be checking its own arithmetic.
        ports: this.target.ports,
        footprint: this.selected === null || isStructure(this.selected)
          || isFixture(this.selected) ? 0 : FOOTPRINT[this.selected],
        site: this.target.addr.site.id,
        ij: [this.target.addr.i, this.target.addr.j],
        pos: [this.target.pos.x, this.target.pos.y, this.target.pos.z],
        fwd: [this.target.fwd.x, this.target.fwd.y, this.target.fwd.z],
        patch: this.target.patch,
        ratePerSec: +this.target.ratePerSec.toFixed(3),
      },
      visible: this.view.ghostVisible || this.structView.ghostVisible
        || (this.padView?.ghostVisible ?? false),
    };
  }
}

export { addressIn };
