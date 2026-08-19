// BRING-UP AND REGROWTH: the two things that happen to a world rather than
// inside it (GP-1076, split out of Gameplay.ts under the 400-line cap).
//
// `bringUp` is everything `Gameplay.create` did after `new Gameplay(d)`: the
// parallel asset load, the batches, the scene graph, the walker's port onto
// the base, the clearing, the enemy loop, the ruins and the restore. Its body
// is VERBATIM out of the static method, which it could be because that method
// already spoke `g` and `d` rather than `this`.
//
// `growClearing` is `populate`, and the two belong in one file because
// bring-up calls it and DW-17's model is why: a save is a diff over a freshly
// generated world, so the regrow is the only way back to a state a real boot
// can be in.
//
// THE ORDER INSIDE `bringUp` IS LOAD-BEARING and the two comments below say
// exactly how (ruins after `enemies.init`, before `load`). Nothing about it
// moved; the lines are in the sequence the static method ran them.
import * as THREE from 'three';
import { bodyIsAirless } from './StarterContent.js';
import { Sites } from '../world/Sites.js';
import { attachProgress } from './GameplayChrome.js';
import type { Gameplay } from './Gameplay.js';
import type { GameplayDeps } from './GameplayDeps.js';

/** Everything `Gameplay.create` does once the instance exists. */
export async function bringUp(g: Gameplay, d: GameplayDeps): Promise<void> {
  await Promise.all([g.field.load(), g.machines.load(), g.factoryView.load(),
    g.structures.load(), g.pads.load(), g.stations.load(), g.antennas.load(),
    g.structures.load(), g.pads.load(), g.stations.load(), g.ruins.load(),
    g.wreckage.load(), g.icons.load()]);
  g.structView.build(g.structures);
  g.padView.build(g.pads);
  g.progress = attachProgress(g);
  g.hotbarBar.invalidate();
  d.scene.add(g.structView.group);
  d.scene.add(g.padView.group);
  // The walker learns about the base through a PORT and not an import: a
  // structure rests on the terrain and must never become a second definition
  // of it (DW-24, plus DW-26's lesson about what a fifth surface costs).
  // A PAD JOINS THAT SAME SET rather than getting a walker port of its own,
  // which is what makes its deck, its tower and its launch table walkable for
  // free and, more to the point, means there is still exactly one answer to
  // "what is holding the player up".
  d.player.body.solids = g.structures.bodies;
  d.scene.add(g.machines.group);
  d.scene.add(g.stations.group);
  d.scene.add(g.antennas.group);
  d.scene.add(g.ruins.group);
  d.scene.add(g.wreckage.group);
  d.scene.add(g.field.group);
  d.scene.add(g.oreField.group);
  d.scene.add(g.fx.debris.mesh);
  d.scene.add(g.gun.fx.group);
  d.scene.add(g.enemies.view.group);
  d.scene.add(g.factoryView.group);
  // Browsers refuse audio until the player has interacted; the listener arms
  // itself on the first pointer or key event and then removes itself.
  g.sfx.attach();
  g.populate();
  g.enemies.init(g, g.walker.body.feet);
  // WG-166 / WG-168. THE RUINS, AFTER `enemies.init` AND BEFORE `load`, AND
  // BOTH HALVES OF THAT ORDER ARE LOAD-BEARING.
  //
  // After init, because `spawnGarrison` is gated by `Enemies.enabled` and a
  // garrison posted before the loop came up would be silently refused with
  // every counter still reading healthy.
  //
  // Before `load`, because `restoreStructures` calls `Structures.reset()`,
  // which calls `bodies.clear()` and throws away every solid in the world
  // including this one. `Persist.apply` puts it back through `ruins.reseat`
  // the moment the restore is done. Placing AFTER the load would work today
  // and would leave that reseat unexercised on the ordinary boot, so the
  // first person to hit it would be a player loading a save.
  g.ruins.build(new Sites(d.core, d.bodyHandle), g.structures.bodies);
  g.ruins.garrison(g.enemies, g);
  // DW-17. The clearing is grown from the seed FIRST and then the diff is
  // applied on top, because the layout is regenerated and only what the
  // player changed is saved.
  await g.load();
  // pagehide, not beforeunload: a mobile browser may never fire beforeunload
  // and the tab that gets frozen is exactly the one whose save matters.
  window.addEventListener('pagehide', () => { void g.save(); });
}

/**
 * Grow the clearing around wherever the player currently stands.
 *
 * The edits handle is 0 on purpose: nodes are placed before anything has been
 * dug, so the oracle's designed base IS the surface at that moment, and
 * passing an empty edit set would say the same thing more expensively.
 */
export function growClearing(g: Gameplay, d: GameplayDeps): void {
  // THE CLEARING DOES NOT FOLLOW THE PLAYER. The direction is remembered from
  // the first call, so regrowing from the seed reproduces the SAME world
  // rather than a new one centred wherever the player happens to be standing.
  if (g.spawnDir === null) {
    const p = d.player.body.feet;
    g.spawnDir = new THREE.Vector3(p.x, p.y, p.z).normalize();
  }
  const dir = g.spawnDir;
  // NodeField FIRST: it clears the whole node array, and the ore field's
  // outcrops are nodes in that same array.
  // GP-268 / R16. AIRLESS IS /core's ANSWER, not "is it a moon": of_atmo_*
  // is indexed by the same BodyParams::bodyId, and atmosphere.h says a body
  // that is not Forge returns exactly 0. A moon WITH air would keep its
  // trees, which `kind === 'moon'` could never express.
  const airless = bodyIsAirless(d.core, d.bodyId);
  g.nodesPlaced = g.field.populate(d.bodyHandle, 0, dir, d.seed,
                                         d.bodyId, airless);
  g.patchesPlaced = g.oreField.populate(dir, 0);
  // The rocks LAST: populate cleared the whole /core node array, so every
  // index the rock stream held is stale. Everything regrows from seed on the
  // next update, which is the same regenerate-then-diff order the load uses.
  g.rocks.reset();
  // The trees AFTER the rocks, for the same staleness reason, and after
  // `field.populate` because `TreeField.reset` snapshots the clearing's own
  // spiral to keep streamed trees out of it.
  g.trees.reset();
  g.nodesPlaced = g.field.placed.length;
}
