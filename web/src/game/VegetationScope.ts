// RN-2225. THE WILD VEGETATION SOURCE FOR A WORLD WITH NO CHARACTER IN IT.
//
// `Gameplay` is player-gated at `BootGameplay:80` (`player !== null &&
// cfg.gameplay`) and it owns the rock and tree fields, so every fly scenario
// -- `surface`, `ascent`, `orbit`, `space`, and therefore EVERY aerial probe
// pose this project judges its art on -- has run with no tree source at all.
// That is the finding in rendering.md section 2.12.6: the flyover read 188,081
// triangles before and after a whole vegetation lane because there was never a
// tree in it to draw, at any radius, with or without an impostor tier.
//
// This class is the other caller of `makeVegetationFields`. It holds the same
// four objects `composeGround` holds and none of the hands, pack, HUD or
// clearing that hang off them there, and it is ticked from the OBSERVER's own
// body-frame position -- the same `s.observer.position` the terrain streamer is
// requested with -- rather than from a capsule's feet.
//
// WHY IT IS NOT "MAKE GAMEPLAY WORK WITHOUT A PLAYER". `GameplayDeps` takes a
// `Controller`, an `Input` and an `Avatar`, and `composeGround` itself ends in
// `new Interact(game, field, d.player, d.avatar)`. Threading a null player
// through the pack, the swing, the objective list and the save slot to reach
// four objects that never wanted one would put a null branch in every one of
// them for the benefit of a scenario that has no hands. The four objects are
// the part that is player-free; this takes exactly them.
//
// IT IS DYNAMICALLY IMPORTED, for standing rule 7's reason and by
// `BootGameplay`'s own precedent: a static import would pull `GameCore`,
// `NodeField`, `NodeBatch` and both lattice streamers into the main chunk on
// every build, and `?gameplay=0` would stop isolating the slice it exists to
// isolate.

import type * as THREE from 'three';
import { makeVegetationFields, type VegetationDeps, type VegetationFields }
  from './VegetationFields.js';
import { VEG_ORIGIN_MAX_ALT_M } from '../world/ScatterTuning.js';
import type { RockField } from './RockField.js';
import type { TreeStats } from './TreeTuning.js';

export interface VegetationScopeStats {
  /** Whether this frame's origin was inside the altitude ceiling. */
  streaming: boolean;
  altM: number;
  rocks: ReturnType<RockField['stats']>;
  trees: TreeStats;
  nodes: number;
  /** WG-320. `NodeField.update`'s own mean cost in ms, and the two exemption
   *  gates' own outcomes. The fly poses answer through this object and not
   *  through `of.game()`, so anything published only on the walk path is
   *  invisible at exactly the poses that pay for it. */
  nodeMs: number;
  nodeSkips: number;
  /** Batches out of the shadow passes, of how many exist. */
  nodeShadowOff: number;
  nodeBatches: number;
  nodeAllTier3: boolean;
  nodeCascOk: boolean;
  /** `?nodefast=check`: node-frames compared, and disagreements. */
  nodeChecked: number;
  nodeMismatch: number;
}

export class VegetationScope {
  private readonly f: VegetationFields;
  private streaming = false;
  private altM = 0;

  private constructor(f: VegetationFields, private readonly bodyRadiusM: number,
                      private readonly scene: THREE.Object3D) {
    this.f = f;
    scene.add(f.field.group);
  }

  /** Build and preload the node atlases. Async for the same reason
   *  `Gameplay.create` is: `NodeField.load` fetches every node .glb once. */
  static async create(d: VegetationDeps, scene: THREE.Object3D):
      Promise<VegetationScope> {
    const f = makeVegetationFields(d);
    await f.field.load();
    return new VegetationScope(f, d.bodyRadiusM, scene);
  }

  /**
   * One frame, off the observer's own body-frame position.
   *
   * THE ORDER IS `GameplayFrame`'s AND NOT A NEW ONE: the rocks and the trees
   * before `field.update`, so a node added this frame is composed and drawn in
   * it rather than flashing in a frame late at the ring's edge. Two callers,
   * one order, and the comment saying why lives at both.
   */
  update(dt: number, eye: { x: number; y: number; z: number }): void {
    this.altM = Math.hypot(eye.x, eye.y, eye.z) - this.bodyRadiusM;
    // REPORTED HERE AND DECIDED IN THE RINGS. `RockField.update` and
    // `TreeField.update` each own the ceiling and each refuse for themselves;
    // this line only says which side of it the frame is on, so the counter and
    // the rule cannot disagree the way a second copy of the test would.
    this.streaming = this.altM <= VEG_ORIGIN_MAX_ALT_M;
    this.f.rocks.update(eye);
    this.f.trees.update(eye);
    // ALWAYS, and with the eye even when the rings are not growing: `update`
    // is where a node picks its LOD rung, and a field that stopped choosing
    // rungs the instant it stopped growing would leave every node it already
    // placed frozen at the tier it was born at.
    this.f.field.update(dt, eye);
  }

  /** Release every node slot and take the group out of the scene. The body
   *  scope's teardown step, on `Scatter.clearPlaced`'s terms. */
  dispose(): void {
    this.f.trees.reset();
    this.f.rocks.reset();
    this.scene.remove(this.f.field.group);
  }

  stats(): VegetationScopeStats {
    const f = this.f.field.fastStats();
    return {
      streaming: this.streaming,
      altM: Math.round(this.altM),
      rocks: this.f.rocks.stats(),
      trees: this.f.trees.stats(),
      nodes: this.f.field.placed.length,
      nodeMs: f.updateMs, nodeSkips: f.composeSkips, nodeShadowOff: f.shadowOff,
      nodeBatches: f.batches, nodeAllTier3: f.allTier3, nodeCascOk: f.cascOk,
      nodeChecked: f.checked, nodeMismatch: f.mismatch,
    };
  }
}
