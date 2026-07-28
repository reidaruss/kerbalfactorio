// WHAT THE PLAYER CANNOT WALK THROUGH IN THE FACTORY, and nothing else.
//
// R33: `Machines` and `Factory` never put anything into a solid set, so a
// smelter, a drill, an assembler and a chest were all scenery. The player walked
// straight through every one of them, in every world, since machines existed.
// The physics lane measured it: the solid set went 5 to 5 across a placed
// machine, which is a count that cannot distinguish "the adoption ran and found
// nothing" from "there is no adoption".
//
// THIS FILE ADDS TO THE EXISTING SOLID SET AND DOES NOT CREATE A SECOND ONE.
// `StructureBodies` already owns the walker's collision (`Gameplay.create`:
// `d.player.body.solids = g.structures.bodies`), the base's parts and the launch
// pads' decks. A machine collider of our own would be a sixth definition of
// where the world is, which is the ambiguity DW-26 was written about and which
// this project has already paid five multi-hour bugs for. So a machine becomes a
// `Solid` in exactly the same shape a foundation does, out of the same `col_*`
// proxies the same `proxiesOf` reads, and joins the same list.
//
// A LAUNCH PAD ALREADY DID THIS AND ITS ID TRICK IS THE PRECEDENT (LaunchPad.ts
// line 175). Three owners now share one `StructureBodies`, and two of them
// resolve a ray hit back to their own object by comparing `Solid.id`:
//
//   structural parts   ids  1, 2, 3, ...   (`Structures.nextId` counts up from 1)
//   launch pads        ids -1, -2, -3, ... (`LaunchPads` negates its own counter)
//   the factory        id   0, always
//
// ZERO IS MINTED BY NEITHER OF THE OTHER TWO, BY CONSTRUCTION, so `Structures.
// pick`, `Structures.remove`, `LaunchPad.pick` and `LaunchPads.remove` cannot
// match a factory solid however many of them exist. It is deliberately NOT an
// offset like `-(1_000_000 + n)`: an offset is a bet on how many pads a world
// will ever hold, and a bound that encodes today's counts is exactly the hidden
// assumption INSTRUMENTS.md opens its constants section with. Zero is a claim
// about the id space rather than about its size.
//
// AND NOTHING HERE REMOVES BY ID. Removal is by OBJECT IDENTITY
// (`bodies.remove((q) => q === s)`), so the shared id costs nothing and a future
// lane that wants to resolve a factory solid from a ray hit has to add a real
// discriminator rather than quietly reusing this one. The honest class-closer is
// for all three owners to compare identity instead of ids, which is four
// one-line edits in two files this lane does not own; it is carried up rather
// than taken.

import * as THREE from 'three';
import { boundOf, proxiesOf, type LocalBox, type Solid, type StructureBodies }
  from './StructureBody.js';
import { ASSETS } from './FactoryTemplates.js';
import type { Placed } from './FactoryKinds.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** See the header. A factory solid is not addressed by id by anybody. */
const NOT_ADDRESSED_BY_ID = 0;

/**
 * The `col_*` proxies of every asset this domain draws, keyed by whatever the
 * caller files it under: an `AssetKey` for the factory, a `.glb` url for the two
 * hand machines. Read ONCE at load, off the SAME scene the batch was built from,
 * which is the same rule `FactoryView.load` already applies to sockets and ports.
 *
 * Module level, because it is immutable asset data rather than world state, and
 * because threading it would mean a new argument through `Gameplay`, `Factory`
 * and `Machines` for a value none of them has an opinion about. The world state
 * (which solids are currently in the set) is per-instance below and is NOT here,
 * because a second world must not inherit the first one's colliders.
 */
const PROXIES = new Map<string, readonly LocalBox[]>();

/** Take an asset's collision proxies out of its loaded root. */
export function learnProxies(key: string, root: THREE.Object3D | null): void {
  if (root === null) return;
  PROXIES.set(key, proxiesOf(root));
}

/** What was learned for a key, or an empty list. An asset with no `col_*` node
 *  yields NOTHING rather than a guessed box: a collider invented here would be a
 *  second opinion about a shape the .glb already states. */
export function proxiesFor(key: string): readonly LocalBox[] {
  return PROXIES.get(key) ?? [];
}

/**
 * How far this asset's collision hull reaches from its own origin in the
 * TANGENT plane, in metres, or 0 if it has no proxy.
 *
 * FS-93 uses it as the half-extent a centre-based picker adds to a reach that is
 * specified past the SURFACE. It is deliberately the proxy's number and not a
 * table: the hand furnace and the survival smelter have no `FOOTPRINT` row and
 * inventing one for them would be a fourth copy of a dimension the asset already
 * publishes, which is the failure INSTRUMENTS.md catalogues under "the asset is
 * part of the measurement".
 *
 * Tangent rather than radial because a reach is a horizontal question: the eye
 * is 1.6 m up and the machine's origin is on the ground, so including the height
 * would hand a tall thin machine reach it has not earned.
 */
export function tangentHalfExtentM(key: string): number {
  let r = 0;
  for (const b of proxiesFor(key)) {
    r = Math.max(r, Math.abs(b.min[0]), Math.abs(b.max[0]),
      Math.abs(b.min[2]), Math.abs(b.max[2]));
  }
  return r;
}

/** One placed thing, as the walker sees it. `pos` and `quat` are held BY
 *  REFERENCE off the record that owns them, so a rebuild that re-points a
 *  building's transform cannot leave a collider behind at the old one. */
function makeSolid(boxes: readonly LocalBox[], pos: Vec3d,
                   quat: THREE.Quaternion): Solid {
  return {
    id: NOT_ADDRESSED_BY_ID, pos, quat, boxes,
    cx: pos.x, cy: pos.y, cz: pos.z, cr: boundOf(boxes),
    // `shut` is `StructureBodies`' door flag and only gates boxes marked `leaf`.
    // No machine proxy is one, so this is inert here and is set true rather than
    // false so that a future leaf-marked machine part defaults to PRESENT.
    shut: true,
  };
}

/**
 * A solid for a hand-placed machine (`Machines.ts`), or null when the asset
 * declares itself passable or ships no proxy. The caller owns the lifetime,
 * because `Machines.spawn` and `Machines.remove` are already the two funnels.
 */
export function handSolid(url: string, solid: string, pos: Vec3d,
                          quat: THREE.Quaternion): Solid | null {
  if (solid !== 'blocks') return null;
  const boxes = proxiesFor(url);
  return boxes.length === 0 ? null : makeSolid(boxes, pos, quat);
}

/**
 * The factory's colliders, reconciled against the PLAN.
 *
 * RECONCILED RATHER THAN HOOKED, and that is the whole design. `Factory.commit`
 * rebuilds the /core network from the plan on every topology change precisely so
 * that "the network is always exactly what the plan says" is free, and the
 * colliders buy the same property from the same call: place, drag, turn,
 * demolish, restore and the FS-78 rescale all end in `commit()`, so none of them
 * needs to know this file exists. A hook per mutation is how FS-81 happened, and
 * a hook per mutation is exactly what a restore path forgets.
 *
 * The cost is O(plan) per commit and zero per frame. It is NOT run per frame on
 * purpose: `FactoryView.sync` has to be, because it recomposes engine transforms
 * against a floating origin, and this holds BODY-frame positions by reference,
 * which a rebase does not touch (FS-89).
 */
export class FactorySolids {
  private readonly held = new Map<number, Solid>();
  /** Ledger, so a probe can tell "adopted nothing" from "never ran". DW-20. */
  adopted = 0;
  dropped = 0;
  get count(): number { return this.held.size; }

  /**
   * Make the solid set agree with the plan.
   *
   * A BELT IS NOT IN HERE AND THAT IS A DECLARED ANSWER, not a size test. See
   * `FactoryTemplates.Solidity`.
   */
  sync(placed: readonly Placed[], bodies: StructureBodies | null): void {
    if (bodies === null) return;
    const live = new Set<number>();
    for (const b of placed) {
      if (ASSETS[b.kind].solid !== 'blocks') continue;
      live.add(b.id);
      const have = this.held.get(b.id);
      if (have === undefined) {
        const boxes = proxiesFor(b.kind);
        if (boxes.length === 0) continue;
        const s = makeSolid(boxes, b.pos, b.quat);
        this.held.set(b.id, s);
        bodies.add(s);
        this.adopted++;
        continue;
      }
      // A turn or a rescale keeps the id and moves the record. Re-point rather
      // than re-add, so the set never holds two colliders for one building.
      have.pos = b.pos;
      have.quat = b.quat;
      have.cx = b.pos.x; have.cy = b.pos.y; have.cz = b.pos.z;
    }
    for (const [id, s] of this.held) {
      if (live.has(id)) continue;
      bodies.remove((q) => q === s);
      this.held.delete(id);
      this.dropped++;
    }
  }

  /** What a probe reads. `pending` is the count of blocking buildings in the
   *  plan that have NO collider, which is the one number that separates "this
   *  asset ships no proxy" from "the adoption never ran". */
  report(placed: readonly Placed[]): unknown {
    let blocking = 0;
    for (const b of placed) if (ASSETS[b.kind].solid === 'blocks') blocking++;
    return {
      solids: this.held.size, blocking, pending: blocking - this.held.size,
      adopted: this.adopted, dropped: this.dropped,
    };
  }
}
