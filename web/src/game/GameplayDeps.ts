// WHAT A WORLD IS MADE OF: the argument `Gameplay.create` takes.
//
// GP-1076. Its own file because it is a CONTRACT and the class is a
// composition: every field here is something the boot sequence already owns
// and hands over, none of it is anything gameplay decides, and the four
// `compose*` phases in GameplayCompose.ts read it without touching the class.
// Nothing about the interface changed in the move; `Gameplay.ts` re-exports
// the name, so `import { type GameplayDeps } from './Gameplay.js'` still
// resolves.
import type * as THREE from 'three';
import type { GameMode } from './GameMode.js';
import type { WorldPorts } from './Persist.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { WaterOracle } from '../world/WaterOracle.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Controller } from '../player/Controller.js';
import type { Avatar } from '../player/Avatar.js';
import type { Input } from '../player/Input.js';

export interface GameplayDeps {
  core: OfCoreModule;
  origin: FloatingOrigin;
  player: Controller;
  avatar: Avatar | null;
  input: Input;
  host: HTMLElement;
  scene: THREE.Object3D;
  bodyHandle: number;
  /** GP-268. /core BodyParams::bodyId. Keys the starter table AND indexes
   *  the atmosphere (atmosphere.h section 2), so one id answers both. */
  bodyId: number;
  seed: number;
  /** DW-31: which mode created this world. Fixed for its whole lifetime. */
  mode: GameMode;
  /** DW-17: the voxel, mesh and terrain handles a whole-world save needs. */
  ports?: Partial<WorldPorts>;
  /** WG-69: body radius, the rock lattice's datum. READ from PlanetBody and
   *  never transcribed (the DW-18 rule that cost a walker a wrong gravity). */
  bodyRadiusM: number;
  /** WG-69: the water authority for the rocks' wet gate, or null when dry. */
  water: WaterOracle | null;
  /** WG-69: `?rocks=0` is the negative control; density is the measurement
   *  ladder's knob and 1 in play. */
  rocks?: { enabled: boolean; density: number };
  /** WG-116: `?trees=0` is the negative control; the radius is the measurement
   *  ladder's knob and the shipping reach in play. */
  trees?: { radiusM: number; density: number };
  /** WG-118: `?nodelod=0` draws every node at LOD0 as before, `?nodecull=0`
   *  turns per-instance frustum culling off. Two claims, two controls. */
  nodeArt?: { lod?: boolean; cull?: boolean };
}
