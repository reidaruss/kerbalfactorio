// WHICH .glb IS WHICH MACHINE, and nothing else.
//
// Split out of FactoryView at FS-56, when the assembler's row pushed that file
// past its 400-line cap. The seam is real rather than arithmetic: everything
// else in FactoryView is about DRAWING (batches, LOD, belt flow bands, cargo,
// wires, the floating origin), and this is the one table that says which file
// on disk backs which `BuildKind`. It is also the table another lane is most
// likely to need to read without dragging three.js in behind it.

import type { MachineTemplate } from './MachineBatch.js';

/**
 * KEYED BY TEMPLATE KEY, NOT BY BuildKind, and the difference is load-bearing:
 * `belt_l` and `belt_r` are corner tiles the view DERIVES (a turn is a property
 * of a run, not a thing to make somebody choose from a menu), and `inserter` is
 * drawn on a link rather than placed. `FactorySnap.readMachineSockets` reads its
 * sockets under these same keys, which is why `esmelter` needs its own row even
 * though it points at the smelter's file.
 */
export const TEMPLATES: Record<string, MachineTemplate> = {
  miner: { url: 'assets/machines/miner.glb', root: 'Miner' },
  // OF_Rubber is the deck, and the deck is what the flow band scrolls along.
  belt: { url: 'assets/machines/belt_segment.glb', root: 'BeltSegment',
          flowMaterial: 'Rubber' },
  // W7. The curve tiles shipped at Tier 0 and nothing drew them, so a line that
  // turned a corner was two straight tiles meeting at a right angle with a notch
  // in the deck. They are DERIVED, never placed: the player lays belts and the
  // view works out which tiles are corners, because a turn is a property of a
  // run and not a thing to make somebody choose from a menu.
  belt_l: { url: 'assets/machines/belt_curve_l.glb', root: 'BeltCurveL',
            flowMaterial: 'Rubber', arc: 'l' },
  belt_r: { url: 'assets/machines/belt_curve_r.glb', root: 'BeltCurveR',
            flowMaterial: 'Rubber', arc: 'r' },
  smelter: { url: 'assets/machines/smelter.glb', root: 'Smelter' },
  inserter: { url: 'assets/machines/inserter.glb', root: 'Inserter' },
  // ABI 9. The pole and the generator shipped at Tier 0 (0x16 and 0x15) and
  // nothing drew them, because until tonight nothing could place one. The
  // ELECTRIC smelter deliberately reuses the smelter's own asset: it is the
  // same machine with a different power source, and inventing a second mesh
  // for it would be this lane authoring the art lane's content.
  pole: { url: 'assets/machines/power_pole.glb', root: 'PowerPole' },
  generator: { url: 'assets/machines/generator.glb', root: 'Generator' },
  esmelter: { url: 'assets/machines/smelter.glb', root: 'Smelter' },
  // FS-56/57. `assembler.glb` shipped at Tier 0 against the pinned TypeId 0x13
  // and nothing ever drew it, because no `BuildKind` could place one.
  assembler: { url: 'assets/machines/assembler.glb', root: 'Assembler' },
  /**
   * FS-81: THE CHEST'S ROW WAS MISSING, AND IT UNWIRED THE ENTIRE FACTORY.
   *
   * FS-70 added `chest` to `BuildKind`, to `FOOTPRINT`, to the hotbar, to the
   * panel, to the save format and to `FactoryPorts.PORT_NAMES`, and did not add
   * it here. This table is the ONLY thing `FactoryView.load` reads, and
   * `FactorySnap.readMachineSockets` is keyed by these same keys, so `box.glb`
   * was never opened and the chest delivered no sockets.
   *
   * AND THAT DID NOT BREAK THE CHEST, IT BROKE EVERYTHING ELSE. `PORT_NAMES` is
   * a CLAIM (see `portsLoaded`): a kind listed there that produces no ports is a
   * broken asset, so `portsMissing` read `['chest']`, `portsLoaded()` read false,
   * and `FactoryWiring.wire` returns early on exactly that condition. Every belt,
   * every smelter, every drill and every assembler in every world stopped being
   * wired, in the shipped build, from the moment the chest landed. `probes/
   * rescale.js` walked into it on its first green migration: the geometry was
   * measured correct to the millimetre and the link list was empty.
   *
   * THE GUARD IS NOT THE BUG AND MUST NOT BE LOOSENED. Refusing to wire on a
   * half-loaded table is DW-28 working exactly as written, and `portsMissing`
   * named the culprit the whole time. What was missing was anything that LOOKED:
   * FS-70's own reload proof measured a chest's CONTENTS through the panel, which
   * is a path that needs no port at all, so a probe suite of ninety files went
   * green over a factory that could not connect two parts together. That is
   * standing rule 11 verbatim, and the closing fix is structural rather than a
   * row: `probes/rescale.js` now asserts `portsLoaded` and prints `portsMissing`,
   * so a kind added to `PORT_NAMES` without a row here fails by name.
   */
  chest: { url: 'assets/machines/box.glb', root: 'Box' },
};
