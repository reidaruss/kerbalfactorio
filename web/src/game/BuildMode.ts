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

import * as THREE from 'three';
import { addressIn, headingIn, stepToward, type MachineAddr }
  from './MachinePlacement.js';
import { FOOTPRINT, type BuildKind, type Factory, type Placed } from './Factory.js';
import { commitTarget, resolveTarget, type StructureTarget }
  from './StructurePlacement.js';
import { STRUCTURE_KINDS, type StructureKind } from './StructureGrid.js';
import { PART_INFO, type PartKind } from './Hotbar.js';
import type { Structures, StructurePart } from './Structures.js';
import type { StructureView } from './StructureView.js';
import type { FactoryView } from './FactoryView.js';
import type { Action } from '../player/Bindings.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';

export type { PartKind };

function isStructure(k: PartKind | null): k is StructureKind {
  return k !== null && (STRUCTURE_KINDS as readonly string[]).includes(k);
}

/** Aim march: step and reach, in metres. */
const STEP_M = 0.35;
const REACH_M = 9.0;
/** Where the ghost falls back to when the aim never meets the ground. */
const FALLBACK_M = 2.6;
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

/** An aim ray, as the player's own view produces it. */
export interface BuildRay {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

export interface BuildTarget {
  pos: { x: number; y: number; z: number };
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  cell: string;
  addr: MachineAddr;
  ok: boolean;
  reason: string;
  /** Drill only: the ore patch under the ghost, or -1. */
  patch: number;
  /** Drill only: what it would mine here, units per second. Richness varies
   * across a deposit, so WHERE on the patch a drill goes is a real decision and
   * the ghost has to answer it before the button is pressed. */
  ratePerSec: number;
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
  /** Rate of the LAST accepted placement, for the confirmation message. */
  lastRate = 0;
  /** Tiles laid by the CURRENT drag, and the longest drag ever run. */
  dragLength = 0;
  longestDrag = 0;
  private rotateHeld = false;
  private freeHeld = false;
  private useHeld = false;
  private dragLast: { addr: MachineAddr; placed: Placed;
                      step: { di: number; dj: number } | null } | null = null;
  private dragKey = '';

  constructor(private readonly M: OfCoreModule, private readonly body: number,
              private readonly factory: Factory, private readonly view: FactoryView,
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
    if (this.selected === null) {
      this.target = null; this.structTarget = null;
      this.view.hideGhost(); this.structView.hideGhost();
      this.useHeld = use;
      this.endDrag();
      return 0;
    }
    const rot = act('rotate');
    if (rot && !this.rotateHeld) this.rotation = (this.rotation + 1) % 4;
    this.rotateHeld = rot;
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

  /** Machines and belts: the ghost, the press, and the hold that lays a run. */
  private stepMachine(kind: BuildKind, ray: BuildRay, pressed: boolean,
                      held: boolean): number {
    this.structTarget = null;
    this.structView.hideGhost();
    const t = this.resolve(ray, kind);
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
      this.factory.adoptSite(t.addr);
      this.lastRate = t.ratePerSec;
      this.placements++;
      this.dragLast = { addr: t.addr, placed: made, step: null };
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

  /**
   * March the aim ray until it is below the ground, then snap the hit to the
   * site grid and answer whether the placement would be accepted.
   */
  private resolve(ray: BuildRay, kind: BuildKind): BuildTarget | null {
    const o = ray.origin, d = ray.dir;
    let hitT = -1;
    for (let t = 0.6; t <= REACH_M; t += STEP_M) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const r = Math.hypot(x, y, z) || 1;
      if (r <= this.M._of_surface_radius(this.body, 0, x / r, y / r, z / r)) {
        hitT = t; break;
      }
    }
    const t = hitT < 0 ? FALLBACK_M : hitT;
    const s = this.factory.snap(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    // The flow axis is one of the site's FOUR tangent axes, shared by every tile
    // of the run: the grid is square, so a belt at 37 degrees has no cell ahead
    // of it to chain to.
    const fwd = headingIn(s.addr.site, d, this.rotation);

    let ok = true;
    let reason = '';
    let patch = -1;
    let ratePerSec = 0;
    if (this.factory.occupied(s.cell)) { ok = false; reason = 'cell taken'; }
    else if (kind === 'miner') {
      // THE SENTENCE THAT TEACHES THE MECHANIC. A drill eats the ground under
      // itself, so the only question is whether there is ore in that ground, and
      // the answer is on the ghost before the button is pressed rather than in
      // an error message after it. Several drills on one patch are fine: a
      // deposit is a piece of ground, not a socket.
      patch = this.factory.patchUnder(s.pos);
      if (patch < 0) {
        ok = false; reason = 'you cannot place a drill here, there is no ore';
      } else {
        ratePerSec = this.factory.ore.drillRate(patch, s.pos.x, s.pos.y, s.pos.z);
        reason = `${ratePerSec.toFixed(1)} ore/s here`;
      }
    }
    return { pos: s.pos, up: s.up, fwd, cell: s.cell, addr: s.addr, ok, reason,
      patch, ratePerSec };
  }

  report(): unknown {
    return {
      selected: this.selected, label: this.label, rotation: this.rotation,
      freePlace: this.freePlace, dragging: this.dragging,
      dragLength: this.dragLength, longestDrag: this.longestDrag,
      placements: this.placements, refusals: this.refusals,
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
      },
      ghost: this.target === null ? null : {
        cell: this.target.cell, ok: this.target.ok, reason: this.target.reason,
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
