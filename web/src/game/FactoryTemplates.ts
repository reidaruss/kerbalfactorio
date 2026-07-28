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
};
