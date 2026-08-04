// THE LAUNCH PAD: a 24 x 24 m piece of launch infrastructure that a rocket
// actually rolls out onto, and the anchor that retires physics R12's stand-in.
//
// WHY THIS IS NOT A `StructureKind` IN THE CLIENT, THOUGH IT IS ONE IN /core.
// `gameplay.h` §S.6 carries the pad as the fifth `survival::StructureKind`, and
// that is right there: /core's enum is a cost-and-identity tag over
// {item, typeId, name, cost} with no geometry in it at all, so the pad joins for
// free and the whole `of_gp_structure_*` bridge (count, info, can_afford, pay)
// serves it with NO ABI CHANGE. The CLIENT's `StructureKind` is a different
// thing wearing the same four names: it is the 4 m tiling module, and every
// function that switches on it — `isDeck`, `addressAt`, `anchorOf`,
// `footprintOf`, `supported`, `addrKey` — asks a question a 24 m monolith
// cannot answer. A fifth member there would be six branches that all say "not
// this one", which is exactly the argument §S.6 already makes for keeping a
// foundation out of `automation.h`'s `BuildKind`, one level down. So the pad has
// this module, and the two enums are joined by `StructureDef.kind` as a FIELD
// rather than by array position.
//
// WHY IT STANDS ON DECKS AND NEVER ON SOIL (GP-58). MEASURED, over the same 81
// origins out to 6.4 km that GP-36 scored, in one run of `probes/padground.js`:
// a 24 x 24 m footprint judged as ONE plane under DW-33's fitted budget is
// accepted at **3.7%**, median spread **6.956 m** against a FLOAT + BURY budget
// of 1.40 m and a p95 of 17.5 m. The same terrain, same run, gives a 4 m deck
// **59.3%**, which reproduces GP-36's published 58.0% and is what says the
// instrument is sound rather than the answer convenient. Judged CELL BY CELL as
// 36 independent 4 m decks — which is what "lay foundations, then the pad" faces
// — the same ground gives **50.6%**. So the pad is not a bigger foundation and
// could not have been made one by widening a tolerance: admitting a 6.96 m
// median spread into a rule written for 1.40 m is not a tolerance, it is the
// absence of one. It is laid on prepared ground, which is also what a real pad
// is, and DW-24 is then satisfied 36 times at the scale it was measured at.
//
// The consequence is DW-29's gate made literal: a launch pad needs 36
// foundations (1,440 Stone) under it before its own bill is paid at all, so the
// rocket programme cannot start until the base exists. That is the tie between
// the two halves of the game, in one placement rule.
//
// EVERY NUMBER HERE IS MEASURED OFF THE SHIPPED .glb, exactly as StructureGrid
// measures the structural module off its four files. Nothing retypes 24 or 2.00
// or 1.90: change the Blender build and this follows.

import * as THREE from 'three';
import { costText } from './CostText.js';
import { orient } from './Grid.js';
import { PAD_FALLBACK, PAD_KIND, clampProxies, measurePad,
  padKey, padProxies, type PadModule } from './LaunchPadModule.js';
import { boundOf, type LocalBox, type Solid, type StructureBodies }
  from './StructureBody.js';
import { loadGlb } from '../assets/Loaders.js';
import { SURVIVAL, type ModeRules } from './GameMode.js';
import type { GameCore, StructureDef } from './GameCore.js';
import type { Vec3d } from '../world/PlanetBody.js';

const FILE = 'assets/rocket/launch_pad.glb';

export interface PadPart {
  id: number;
  def: StructureDef;
  siteId: number;
  /** SW corner cell of the 6 x 6 deck block, and the level it stands on. */
  i: number; j: number; level: number;
  key: string;
  /** The pad's own origin: the top face of the decks it stands on. */
  pos: Vec3d;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  quat: THREE.Quaternion;
  solid: Solid;
  /**
   * 0 holding, 1 fully swung back. Driven off the authored clip's own keys and
   * never by an `AnimationMixer` (DW-8), exactly as the door's swing is.
   */
  clampT: number;
  /** What the clamps are being told to do. The flight clamp writes this. */
  releasing: boolean;
  /** The fixed tick on which `release()` was called, or -1. This is the number
   *  the acceptance compares against the flight clamp's own release tick: two
   *  independently recorded ticks, not one call asserted against itself. */
  releasedAtTick: number;
  /** Rollouts anchored on this pad. Published so a probe can tell a pad that is
   *  being used from a pad that merely exists. */
  rollouts: number;
}

/** The world's pads. Deliberately shaped like `Structures`, because it is the
 *  same job at a different scale and a second manner would be a second thing to
 *  keep correct. */
export class LaunchPads {
  readonly list: PadPart[] = [];
  /** The loaded root, kept so the view and the measurement share one parse. */
  scene: THREE.Object3D | null = null;
  module: PadModule = PAD_FALLBACK;
  placements = 0;
  refusals = 0;
  removals = 0;
  /** Refusals attributable to "there is no platform under this", the number
   *  that says GP-58's rule is the one doing the teaching. */
  noDeckRefusals = 0;
  private def: StructureDef | null = null;
  private boxes: LocalBox[] = [];
  /** The four clamp proxies, present only while the clamps are HOLDING. Same
   *  present-or-absent mechanism the door leaf uses (GP-24): a kinematic walker
   *  cannot honestly resolve a moving panel, so a swinging collider is not on
   *  offer and a box that exists or does not is. */
  private clampBoxes: LocalBox[] = [];
  private nextId = 1;

  /**
   * `bodies` is the SAME `StructureBodies` the base uses, handed in rather than
   * created. That is what makes a pad's deck, its tower and its launch table
   * walkable with no walker change at all, and more to the point it keeps
   * exactly ONE answer to "what is holding the player up" (DW-26). A second
   * solid set would be the fifth definition of the surface this project has
   * already paid four multi-hour bugs for.
   */
  constructor(private readonly core: GameCore,
              private readonly mode: ModeRules = SURVIVAL,
              private readonly bodies: StructureBodies | null = null) {}

  async load(): Promise<void> {
    const g = await loadGlb(FILE);
    this.scene = g.scene;
    this.module = measurePad(g.scene, g.animations);
    this.boxes = padProxies(g.scene);
    this.clampBoxes = clampProxies(g.scene, this.module);
    // BY `kind`, NEVER BY INDEX. `Structures` used to index `structureDefs()`
    // by `STRUCTURE_KINDS.indexOf(kind)`, which is only right while the two
    // enums agree member for member, and GP-57 is the day they stopped.
    this.def = this.core.structures().find((d) => d.kind === PAD_KIND) ?? null;
  }

  get ready(): boolean { return this.def !== null && this.scene !== null; }
  get definition(): StructureDef | null { return this.def; }

  /** How many structural cells across the pad is. 6 at the shipped 24 m span
   *  and 4 m module, and DERIVED so a module change moves both together. */
  cells(cellM: number): number {
    return Math.max(1, Math.round(this.module.spanM / cellM));
  }

  /** GP-600: sandbox quotes the survival price and names who is paying it,
   *  rather than deleting the number Reid opened sandbox to read. */
  costText(): string {
    if (this.def === null) return '';
    return costText(this.def.cost.map((c) => (
      { count: c.count, name: this.core.itemName(c.item) })), this.mode.freeBuild);
  }

  canAfford(): boolean {
    return this.def !== null
      && (this.mode.freeBuild || this.core.structureAfford(this.def.index));
  }

  /** /core's own answer with the mode taken back out, DW-31's in-page negative
   *  control. In sandbox a pad goes down while this still reads false. */
  affordInCore(): boolean {
    return this.def !== null && this.core.structureAfford(this.def.index);
  }

  pay(): boolean {
    if (this.def === null) return false;
    return this.mode.freeBuild || this.core.structurePay(this.def.index);
  }

  at(key: string): PadPart | undefined {
    return this.list.find((p) => p.key === key);
  }

  /** Bring a pad into the world. A placement and a restore both land here, so a
   *  loaded pad and a built one are the same object. */
  adopt(def: StructureDef, siteId: number, i: number, j: number, level: number,
        pos: Vec3d, up: THREE.Vector3, fwd: THREE.Vector3): PadPart {
    const id = this.nextId++;
    const quat = orient(up, fwd);
    const boxes = [...this.boxes, ...this.clampBoxes];
    const solid: Solid = {
      // NEGATIVE, so one `StructureBodies` can carry both families and
      // `Structures.pick` and `LaunchPads.pick` can never answer each other's
      // question by id collision. A structural part's id counts up from 1.
      id: -id, pos, quat, boxes, cx: pos.x, cy: pos.y, cz: pos.z,
      cr: boundOf(boxes),
      // `shut` means CLAMPS HOLDING here. The field is `StructureBodies`' own
      // and it means "the leaf boxes are live"; a pad reuses it verbatim rather
      // than adding a parallel flag, because the walker's `inside` already
      // reads exactly this and a second flag would be a second authority.
      shut: true,
    };
    const p: PadPart = {
      id, def, siteId, i, j, level, key: padKey(siteId, i, j, level),
      pos, up: up.clone(), fwd: fwd.clone(), quat, solid,
      clampT: 0, releasing: false, releasedAtTick: -1, rollouts: 0,
    };
    this.list.push(p);
    this.bodies?.add(solid);
    return p;
  }

  remove(p: PadPart): { refunded: { item: number; count: number }[] } | null {
    const at = this.list.indexOf(p);
    if (at < 0) return null;
    this.list.splice(at, 1);
    this.bodies?.remove((q) => q.id === p.solid.id);
    const back: { item: number; count: number }[] = [];
    for (const c of p.def.cost) {
      const over = this.core.add(c.item, c.count);
      if (c.count - over > 0) back.push({ item: c.item, count: c.count - over });
    }
    this.removals++;
    return { refunded: back };
  }

  /** Throw the pads away. The pack is NOT credited, for `Structures.reset`'s own
   *  reason: a restore replaces a world rather than demolishing one, and
   *  refunding here would mint 60 iron on every load. */
  reset(): void {
    for (const p of this.list) this.bodies?.remove((q) => q.id === p.solid.id);
    this.list.length = 0;
  }

  /** The pad an aim ray enters, within reach, or null. The solid ids are
   *  NEGATIVE (see `adopt`) precisely so this and `Structures.pick` can share
   *  one body set and never answer each other's question. */
  pick(o: Vec3d, d: Vec3d, reachM: number): PadPart | null {
    if (this.bodies === null) return null;
    const hit = this.bodies.rayPick(o, d, reachM, 0.2);
    if (hit === null) return null;
    return this.list.find((p) => p.solid.id === hit.solid.id) ?? null;
  }

  // --- the clamps -----------------------------------------------------------

  /**
   * Swing the clamps back. Called at the instant the FLIGHT clamp releases, and
   * `tick` is that same fixed tick, recorded so the two can be compared.
   *
   * `releasedAtTick` is deliberately a tick and not a wall clock: the flight
   * clamp releases inside `FlightSession.stepClamped` on the fixed step, and a
   * frame carries one to three fixed ticks, so a per-frame timestamp cannot tell
   * "the same instant" from "within 50 ms" and would make the assertion a
   * coincidence detector.
   */
  release(p: PadPart, tick: number): boolean {
    if (p.releasing) return false;
    p.releasing = true;
    p.releasedAtTick = tick;
    return true;
  }

  /** Put the clamps back on the stack. What a fresh roll-out does. */
  reclamp(p: PadPart): void {
    p.releasing = false;
    p.releasedAtTick = -1;
    p.clampT = 0;
    p.solid.shut = true;
  }

  /** Advance every pad's clamps. Same shape as `Structures.step` for doors, and
   *  the collision follows at the halfway point for the same reason: the moment
   *  it visibly reads as open is the moment it stops blocking. */
  step(dt: number): void {
    const rate = dt / Math.max(1e-3, this.module.swingSecs);
    for (const p of this.list) {
      const want = p.releasing ? 1 : 0;
      if (p.clampT === want) continue;
      p.clampT = want > p.clampT ? Math.min(want, p.clampT + rate)
        : Math.max(want, p.clampT - rate);
      p.solid.shut = p.clampT < 0.5;
    }
  }

  // --- where a rocket stands ------------------------------------------------

  /**
   * `socket_vessel` in body-frame metres: where the BASE of a rolled-out stack
   * goes. The pad's own up rather than the radial, because the pad is a rigid
   * object standing on a plane and its socket is fixed in ITS frame; over a
   * 24 m part the two differ by 24/600000 rad, and taking the pad's own is both
   * exact and the thing that would still be right on a 6 km asteroid.
   */
  vesselAnchor(p: PadPart, out: Vec3d): Vec3d {
    out.x = p.pos.x + p.up.x * this.module.standM;
    out.y = p.pos.y + p.up.y * this.module.standM;
    out.z = p.pos.z + p.up.z * this.module.standM;
    return out;
  }

  /** The pad nearest a body-frame point within `reachM`, or null. */
  nearest(p: Vec3d, reachM: number): PadPart | null {
    let best: PadPart | null = null;
    let bestD = reachM;
    for (const q of this.list) {
      const d = Math.hypot(p.x - q.pos.x, p.y - q.pos.y, p.z - q.pos.z);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best;
  }

  report(): unknown {
    return {
      ready: this.ready,
      module: this.module,
      cost: this.costText(),
      afford: this.canAfford(),
      affordInCore: this.affordInCore(),
      item: this.def?.item ?? 0,
      typeId: this.def?.typeId ?? 0,
      placements: this.placements,
      refusals: this.refusals,
      noDeckRefusals: this.noDeckRefusals,
      removals: this.removals,
      pads: this.list.map((p) => ({
        id: p.id, site: p.siteId, key: p.key,
        cell: [p.i, p.j, p.level],
        pos: [p.pos.x, p.pos.y, p.pos.z],
        clampT: +p.clampT.toFixed(4),
        releasing: p.releasing,
        releasedAtTick: p.releasedAtTick,
        holding: p.solid.shut,
        rollouts: p.rollouts,
      })),
    };
  }
}

/**
 * The asset's own half of this domain lives in LaunchPadModule.ts. It is
 * re-exported here because the placement rules, the view and three probes
 * already name this module, and moving a published name to make room in a file
 * is a worse trade than one line of forwarding (the same call Structures.ts
 * makes for the DW-24 tolerances).
 */
export { CLAMP_COUNT, PAD_FALLBACK, PAD_KIND, clampMatrix, clampProxies,
  measurePad, padAnchor, padBlockAt, padKey, padProxies,
  type PadModule } from './LaunchPadModule.js';
