// The player's own body in the near 1:1 scene, and the first-person arms in the
// view-model pass. Both are real rigged assets from W4 onward; the W2 capsule
// placeholder is gone.
//
// It sits on LAYER_PLAYER_BODY and the FIRST-PERSON camera disables that layer
// (ARCHITECTURE.md 3.4), so the M3.1b "FP black slab self-shadow" bug is fixed by
// construction rather than by a workaround, and the shadow camera keeps the layer
// ENABLED so the player still casts (section 15.2 item 24).
//
// It is world-anchored: it re-derives from the 64-bit feet position every frame
// and needs no rebase subscription of its own.

import * as THREE from 'three';
import { LAYER_PLAYER_BODY } from '../render/Scenes.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Vec3d } from '../world/PlanetBody.js';
import { ASSETS } from '../assets/Registry.js';
import { PlayerRig } from './PlayerRig.js';
import {
  BODY_CLIPS, FP_CLIPS, resolveAnim, swingSecs, type AnimInput, type SwingKind,
} from './AnimGraph.js';

/**
 * Assets are authored Blender -Y forward, which the exporter turns into three.js
 * **+Z** forward (ASSET-SPECS 2.1). Matrix4.lookAt aims **-Z** at its target, so
 * the target is the aim NEGATED. Getting this backwards is silent: the character
 * walks correctly and moonwalks while doing it.
 */
const MODEL_FORWARD_IS_PLUS_Z = true;

/** See PlayerRig.holdTool. Swings the haft down and out of the frame centre. */
const FP_CARRY_TILT = new THREE.Euler(-1.15, 0.0, 0.35);

/**
 * The four armour slots, matching `of::progression::EquipSlot` value for value
 * and `armour_set.glb`'s four node names character for character. /core's
 * `armourNode(EquipSlot)` returns exactly these, so a slot index on either side
 * of the bridge indexes this array and nothing concatenates a node name.
 */
export const EQUIP_SLOTS = ['Head', 'Chest', 'Legs', 'Feet'] as const;
export type EquipSlotName = (typeof EQUIP_SLOTS)[number];

export class Avatar {
  readonly group = new THREE.Group();
  readonly viewModel = new THREE.Group();
  body: PlayerRig | null = null;
  arms: PlayerRig | null = null;
  private readonly basis = new THREE.Matrix4();
  private readonly zero = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private swingLeft = 0;
  private swingKind: SwingKind = 'pickaxe';
  private toolSwaps = 0;

  constructor() {
    this.group.name = 'playerBody';
    this.group.matrixAutoUpdate = false;
    this.viewModel.name = 'playerViewModel';
  }

  /**
   * Load both rigs. The tools go in at the same time because a character holding
   * nothing is a different silhouette, and the FP arms with an empty fist read as
   * a bug rather than as an unarmed state.
   */
  async load(): Promise<void> {
    const [body, arms] = await Promise.all([
      PlayerRig.create({
        url: ASSETS.playerBody, clips: BODY_CLIPS, layer: LAYER_PLAYER_BODY,
        castShadow: true, receiveShadow: true, lod: '_LOD0',
      }),
      PlayerRig.create({
        url: ASSETS.playerFpArms, clips: FP_CLIPS, layer: null,
        castShadow: false, receiveShadow: false, lod: '_LOD0',
      }),
    ]);
    this.body = body;
    this.arms = arms;
    await Promise.all([
      body.holdTool(ASSETS.crudePickaxe),
      arms.holdTool(ASSETS.crudePickaxe, '_LOD0', FP_CARRY_TILT),
    ]);
    this.group.add(body.group);
    this.viewModel.add(arms.group);
  }

  /**
   * Start a swing. Both rigs play their own clip; the impact frames match.
   *
   * `kind` also swaps the tool in the hand, which is what made `Swing_Axe`,
   * `FP_Swing_Axe` and `crude_axe.glb` reachable at all: all three shipped and
   * validated, and `holdTool` had only ever been called with the pickaxe, so a
   * player chopping a tree swung a pickaxe at it (blocker A-6). The load is a
   * no-op when the tool is already in hand, so this is safe to call per swing.
   */
  swing(kind: SwingKind = 'pickaxe'): void {
    this.swingKind = kind;
    this.swingLeft = swingSecs(kind);
    const url = kind === 'axe' ? ASSETS.crudeAxe : ASSETS.crudePickaxe;
    if (this.body?.holding !== url) {
      this.toolSwaps++;
      void this.body?.holdTool(url);
      void this.arms?.holdTool(url, '_LOD0', FP_CARRY_TILT);
    }
  }

  /** Drive both animation graphs from ONE state, computed from the capsule. */
  animate(dt: number, input: Omit<AnimInput, 'swingLeft' | 'swingKind'>): void {
    if (this.swingLeft > 0) this.swingLeft = Math.max(0, this.swingLeft - dt);
    const state = resolveAnim({
      ...input, swingLeft: this.swingLeft, swingKind: this.swingKind,
    });
    this.body?.setAnim(state, input.speedMps);
    this.arms?.setAnim(state, input.speedMps);
    this.body?.update(dt);
    this.arms?.update(dt);
  }

  /**
   * The view model is fixed in CAMERA space: same origin, same rotation, so its
   * transform relative to the camera is constant. Its own origin is the camera
   * point (ASSET-SPECS 4.2), which is why there is no offset here either.
   */
  placeViewModel(cameraQuat: THREE.Quaternion): void {
    this.viewModel.quaternion.copy(cameraQuat);
    if (MODEL_FORWARD_IS_PLUS_Z) this.viewModel.rotateY(Math.PI);
    this.viewModel.updateMatrixWorld(true);
  }

  /** Stand the body on `feet`, facing `aim` projected into the tangent plane. */
  place(origin: FloatingOrigin, feet: Vec3d, up: THREE.Vector3, aim: THREE.Vector3): void {
    const g = this.group;
    origin.toEngine(feet, g.position);
    const fx = aim.x - up.x * aim.dot(up);
    const fy = aim.y - up.y * aim.dot(up);
    const fz = aim.z - up.z * aim.dot(up);
    const l = Math.hypot(fx, fy, fz);
    if (l > 1e-6) {
      const s = MODEL_FORWARD_IS_PLUS_Z ? -1 / l : 1 / l;
      this.basis.lookAt(this.zero, this.fwd.set(fx * s, fy * s, fz * s), up);
      g.quaternion.setFromRotationMatrix(this.basis);
    }
    g.updateMatrix();
    g.updateMatrixWorld(true);
  }

  /**
   * A-10 / GP-42. Four slots, and the slot name IS the node name in
   * `armour_set.glb`, so the lookup is never a string built at runtime.
   *
   * BODY ONLY, and that is A-11 rather than an oversight: `armour_set` carries
   * the third-person 44-bone rig, while the view model is a different 27-bone
   * rig with a different bind pose, so the same mesh cannot be bound to both.
   * An armoured player currently sees unarmoured arms in first person. Fixing
   * it needs a second armour file authored against `FP_BONES`, which is an art
   * decision; until then the gap is stated here rather than hidden by silently
   * skipping the call.
   */
  async equip(slot: EquipSlotName, url: string = ASSETS.armourSet,
              node?: string): Promise<boolean> {
    return (await this.body?.equip(slot, url, node)) ?? false;
  }

  unequip(slot: EquipSlotName): boolean { return this.body?.unequip(slot) ?? false; }

  get wornSlots(): string[] { return this.body?.wornSlots ?? []; }

  report(): unknown {
    return {
      bodyLoaded: this.body?.loaded ?? false,
      armsLoaded: this.arms?.loaded ?? false,
      bodyBones: this.body?.boneCount ?? 0,
      armBones: this.arms?.boneCount ?? 0,
      bodyClips: this.body?.clipCount ?? 0,
      armClips: this.arms?.clipCount ?? 0,
      sockets: this.body?.socketNames ?? [],
      holding: this.body?.holding ?? '',
      playing: this.body?.playing ?? '',
      playingFp: this.arms?.playing ?? '',
      holdingFp: this.arms?.holding ?? '',
      swingKind: this.swingKind,
      // PH-77. WHERE THE BODY IS ACTUALLY DRAWN, in engine metres, read off the
      // group's own transform rather than recomputed. `place` writes it through
      // `origin.toEngine` from the f64 feet every frame, so differencing it
      // against that same f64 read is a HARD ZERO or a real defect; there is no
      // tolerance to tune. It is here because a body left behind by a
      // floating-origin rebase is not a wrong-looking body, it is an absent one,
      // and "the avatar vanished" is equally consistent with the FP culling
      // layer, a failed skin load and a shadow-only draw.
      drawnEngineM: [this.group.position.x, this.group.position.y,
                     this.group.position.z],
      worn: this.wornSlots,
      toolSwaps: this.toolSwaps,
      swingLeft: Math.round(this.swingLeft * 1000) / 1000,
    };
  }
}
