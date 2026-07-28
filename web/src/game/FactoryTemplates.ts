// WHICH .glb IS WHICH MACHINE, AND WHICH OF ITS SOCKETS MEAN ANYTHING.
//
// Split out of FactoryView at FS-56, when the assembler's row pushed that file
// past its 400-line cap. The seam is real rather than arithmetic: everything
// else in FactoryView is about DRAWING (batches, LOD, belt flow bands, cargo,
// wires, the floating origin), and this is the one table that says which file on
// disk backs which kind. It is also the table another lane is most likely to
// need to read without dragging three.js in behind it.
//
// FS-85: IT IS NOW ONE TABLE INSTEAD OF THREE, AND THAT IS A DEFECT FIX RATHER
// THAN TIDYING UP. Read the whole of this comment before adding a kind.
//
// There used to be three tables, keyed the same way, in three files, edited
// separately:
//
//   FactoryTemplates.TEMPLATES   which FILE to open, and which node in it
//   FactorySnap.WANT             which SOCKETS to take out of that file
//   FactoryPorts.PORT_NAMES      which of those sockets are ITEM PORTS, and
//                                which way each one runs
//
// The three are not independent. A socket cannot be an item port unless it was
// read, and it cannot be read unless the file was opened, so the third implies
// the second and the second implies the first. Encoding an implication as three
// hand-maintained tables means the implication can be violated, and on
// 2026-07-28 it was, in the shipped build, for days.
//
// WHAT IT COST, because this is the most expensive defect this project has had.
// FS-70 added `chest` to `PORT_NAMES` and to neither of the other two. `box.glb`
// was therefore never opened, the chest delivered no sockets, and
// `FactoryPorts.portsLoaded()` correctly reported that a kind CLAIMING item
// ports had produced none. `FactoryWiring.wire` returns early on exactly that
// condition, by design, because a wiring layer running on a half-loaded table
// would connect belts to belts and silently refuse every machine (DW-28).
//
// So: NOTHING IN THE FACTORY WAS WIRED, IN ANY WORLD, IN THE BUILD REID WAS
// PLAYING. Not one belt fed one smelter. He would have placed a drill, run a
// line into a furnace and watched nothing happen, with no message.
//
// AND EVERY GUARD WORKED. `portsLoaded` was false. `portsMissing` said `chest`.
// The report published both. What was missing was anything that LOOKED, and the
// reason it was missing is the sharp part: FS-70's own proof was a REAL browser
// reload asserting that a chest's contents survived it, which is a correct proof
// of a property that needs no port at all. A correct test of the wrong thing.
//
// THE FIX IS THAT THE MISSING ROW IS NOW UNREPRESENTABLE, not merely detectable.
// `ASSETS` is typed `Record<AssetKey, MachineAsset>`, which is EXHAUSTIVE: add a
// member to `BuildKind` and this file stops compiling until it has a row. And
// `ports` is REQUIRED rather than optional, so "this thing has no item IO" has
// to be SAID, as `NO_ITEM_PORTS`, rather than being the same shape as forgetting.
// A pole and a generator are grid citizens with no item ports at all
// (FactoryKinds argues why), and that is a claim somebody made, not a row
// somebody skipped.
//
// THE RUNTIME DETECTOR STAYS, and keeping it is not belt and braces. The type
// system can guarantee a ROW exists; it cannot guarantee the `.glb` on disk
// actually contains a node with that name. A renamed or deleted socket in an
// asset produces exactly the failure above and is invisible to `tsc`, so
// `portsLoaded` and `portsMissing` remain the guard for the half this file
// cannot prove. The two together cover authoring and content; neither covers
// both, and saying which is which is the point.

import type { MachineTemplate } from './MachineBatch.js';
import type { BuildKind } from './FactoryKinds.js';
import type { PortDir } from './FactoryPorts.js';

/**
 * Every key an asset is filed under, which is every `BuildKind` PLUS the three
 * that are not buildable.
 *
 * `belt_l` and `belt_r` are corner tiles the view DERIVES, because a turn is a
 * property of a run and not a thing to make somebody choose from a menu, and
 * `inserter` is drawn on a link rather than placed (DW-9). None of the three is
 * ever in a player's hand, so none is a `BuildKind`, and they are named here
 * rather than let in by a loose `string` index so that this union is the
 * complete list of files this system can open.
 */
export type AssetKey = BuildKind | 'belt_l' | 'belt_r' | 'inserter';

/** One item port: the socket's name in the shipped file, and which way items
 *  cross it. `dir` is authored rather than derived from the name, because
 *  `FactoryPorts` derives the FACE from the socket's own position on purpose,
 *  and a direction of travel is not a position. */
export interface PortSpec { readonly name: string; readonly dir: PortDir }

/**
 * A kind with no item IO whatsoever, said out loud.
 *
 * Poles, generators, the derived corner tiles and the inserter mesh all have
 * this, and it is a shared frozen constant rather than a fresh `[]` at each site
 * so the four read identically and a reader can grep for the claim. An empty
 * list is NOT the same as a missing row: this one says "asked and answered", and
 * `portsLoaded` treats it as such.
 */
export const NO_ITEM_PORTS: readonly PortSpec[] = Object.freeze([]);

export interface MachineAsset extends MachineTemplate {
  /**
   * The sockets that MEAN something, and nothing else.
   *
   * `socket_status`, `socket_power_in`, `socket_smoke`, `socket_fuel_in`,
   * `socket_drill_tip`, `socket_wire_a` and `socket_wire_b` are deliberately
   * absent from every row. Some are render anchors and some are other systems'
   * contracts, and offering to belt ore into a smelter's chimney is how a port
   * model stops being trusted.
   */
  readonly ports: readonly PortSpec[];
}

/**
 * THE table. Exhaustive over `AssetKey`, so a new kind cannot be half-added.
 *
 * A BELT'S TWO ENDS ARE PORTS TOO, and treating them as such is what makes the
 * whole model one rule instead of two. A run's tail presents `socket_belt_in`
 * and its head presents `socket_belt_out`, so "does this belt feed this smelter"
 * and "does this smelter feed this belt" are the same question asked twice.
 */
export const ASSETS: Record<AssetKey, MachineAsset> = {
  miner: { url: 'assets/machines/miner.glb', root: 'Miner',
           ports: [{ name: 'socket_item_out', dir: 'out' }] },
  // OF_Rubber is the deck, and the deck is what the flow band scrolls along.
  belt: { url: 'assets/machines/belt_segment.glb', root: 'BeltSegment',
          flowMaterial: 'Rubber',
          ports: [{ name: 'socket_belt_in', dir: 'in' },
                  { name: 'socket_belt_out', dir: 'out' }] },
  // W7. The curve tiles shipped at Tier 0 and nothing drew them, so a line that
  // turned a corner was two straight tiles meeting at a right angle with a notch
  // in the deck. They are DERIVED, never placed, and a run's ENDS are always on
  // straight tiles, so a corner has nothing to present.
  belt_l: { url: 'assets/machines/belt_curve_l.glb', root: 'BeltCurveL',
            flowMaterial: 'Rubber', arc: 'l', ports: NO_ITEM_PORTS },
  belt_r: { url: 'assets/machines/belt_curve_r.glb', root: 'BeltCurveR',
            flowMaterial: 'Rubber', arc: 'r', ports: NO_ITEM_PORTS },
  smelter: { url: 'assets/machines/smelter.glb', root: 'Smelter',
             ports: [{ name: 'socket_item_in', dir: 'in' },
                     { name: 'socket_item_out', dir: 'out' }] },
  // DW-9 draws this on a connection rather than letting anybody place one, so it
  // has no ports of its own: it IS a port pair, rendered.
  inserter: { url: 'assets/machines/inserter.glb', root: 'Inserter',
              ports: NO_ITEM_PORTS },
  // ABI 9. Grid citizens: they never tick, hold nothing and have no item IO at
  // all, which is why this is `NO_ITEM_PORTS` and not an oversight. A player who
  // belts ore into the side of a generator gets a sentence saying so
  // (`FactoryRefusal`), and that sentence is reachable BECAUSE the row is here.
  pole: { url: 'assets/machines/power_pole.glb', root: 'PowerPole',
          ports: NO_ITEM_PORTS },
  generator: { url: 'assets/machines/generator.glb', root: 'Generator',
               ports: NO_ITEM_PORTS },
  // FS-43: THE ELECTRIC SMELTER USED TO BE MISSING FROM THE SOCKET HALF, and
  // until ports became the connection rule the omission cost nothing visible: an
  // esmelter simply never caught a snap, which reads as a stiff crosshair rather
  // than as a defect. It is a separate `BuildKind` deliberately reusing the
  // smelter's own asset (FactoryKinds says why), so it publishes the same pair
  // and has to be asked for it under its OWN key, because everything downstream
  // is keyed by kind and not by file. That duplication is the price of two kinds
  // sharing one mesh, and it is now one row rather than three.
  esmelter: { url: 'assets/machines/smelter.glb', root: 'Smelter',
              ports: [{ name: 'socket_item_in', dir: 'in' },
                      { name: 'socket_item_out', dir: 'out' }] },
  // FS-56/57. `assembler.glb` shipped at Tier 0 against the pinned TypeId 0x13
  // and nothing ever drew it, because no `BuildKind` could place one.
  //
  // TWO INLETS, ON TWO FACES, AND `_a` DOES NOT MEAN "FIRST INGREDIENT":
  // `connect` routes an arriving item to slot 1 or 2 BY ITEM TYPE against the
  // machine's own recipe, so either belt may carry either ingredient. They are
  // named `_a` and `_b` rather than publishing `socket_item_in` twice because a
  // glTF scene is looked up by name and a duplicate name is a node you cannot
  // address. Nothing downstream cares which suffix is which:
  // `FactoryPorts.faceOf` derives the housing face from the socket's own
  // position, so an author moving input B from the right face to the left needs
  // no code change anywhere.
  assembler: { url: 'assets/machines/assembler.glb', root: 'Assembler',
               ports: [{ name: 'socket_item_in_a', dir: 'in' },
                       { name: 'socket_item_in_b', dir: 'in' },
                       { name: 'socket_item_out', dir: 'out' }] },
  // FS-70 / FS-81. The pair `box.glb` has carried for months, at the smelter's
  // own two heights. A chest's in and out are the SAME pool, so unlike every
  // machine above these two do not bracket a transformation; they are the two
  // ends of one box. This is the row whose absence unwired the game.
  chest: { url: 'assets/machines/box.glb', root: 'Box',
           ports: [{ name: 'socket_item_in', dir: 'in' },
                   { name: 'socket_item_out', dir: 'out' }] },
};

/**
 * The drawing half, for `FactoryView.load` and `MachineBatch`.
 *
 * It is `ASSETS` ITSELF rather than a copy. `MachineAsset` extends
 * `MachineTemplate`, so every row already is one, and mapping across to strip
 * `ports` would allocate a second object per kind whose only distinguishing
 * property is that it can drift from the first. The view ignores the extra
 * field. Kept as a named export because every existing importer asks for this
 * name, so nothing downstream moved.
 */
export const TEMPLATES: Record<string, MachineTemplate> = ASSETS;

/**
 * Which socket names to look up in one asset's file, or `undefined` for a kind
 * that has none.
 *
 * DERIVED from the one table, which is the whole point: a port that is declared
 * is a socket that gets read, by construction rather than by two authors
 * agreeing. `undefined` and an empty list are collapsed here on purpose, because
 * `readMachineSockets` has one thing to do with both, and the DISTINCTION that
 * matters (claimed versus delivered) is `FactoryPorts.portsMissing`'s to make.
 */
export function socketNamesFor(key: string): readonly string[] | undefined {
  const a = (ASSETS as Record<string, MachineAsset | undefined>)[key];
  return a === undefined || a.ports.length === 0
    ? undefined : a.ports.map((p) => p.name);
}

/** Every kind that CLAIMS item ports, as the port table itself. Read by
 *  `FactoryPorts`, which owns what a claim means and what happens when an asset
 *  does not honour one. */
export function itemPortKinds(): [string, readonly PortSpec[]][] {
  return (Object.entries(ASSETS) as [string, MachineAsset][])
    .filter(([, a]) => a.ports.length > 0)
    .map(([k, a]) => [k, a.ports]);
}
