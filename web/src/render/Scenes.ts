// The scene handles and the layer constants. Nothing else.
// ARCHITECTURE.md section 3.1: four passes, one canvas, depth cleared between.

import * as THREE from 'three';

/** Far-scene units per metre. Forge (R = 600 km) becomes a 6-unit sphere. */
export const FAR_SCALE = 1e-5;

export const LAYER_DEFAULT = 0;
export const LAYER_PLAYER_BODY = 1;
export const LAYER_SHADOW_ONLY = 2;
/**
 * Biome props. They live on their own layer for ONE reason: a shadow camera
 * tests layer 0 only unless told otherwise (section 15.2 item 24), so putting
 * them here lets cascade 0 see them and cascades 1 and 2 not. A 0.4 m rock
 * casting into a 300 m cascade is a texel.
 */
export const LAYER_PROPS = 3;

export class Scenes {
  /** Pass 1: stars, sun disc, atmosphere quad. Rotation-only camera. */
  readonly sky = new THREE.Scene();
  /** Pass 2: planet proxies and coarse terrain shells, scaled by FAR_SCALE. */
  readonly far = new THREE.Scene();
  /** Pass 3: metres, 1:1, floating origin. Fine terrain, factory, player. */
  readonly near = new THREE.Scene();
  /** Pass 4: FP arms and held tool. Its own depth range, so it cannot clip. */
  readonly viewModel = new THREE.Scene();
  /**
   * The assembly bay. NOT a fifth pass: it REPLACES all four when the player is
   * in the VAB (Frame.vabActive), because a rocket on a stand shares nothing
   * with a planet at 600 km and compositing the two would buy only a way for
   * one to seam into the other. Off, it costs one unrendered THREE.Scene.
   */
  readonly vab = new THREE.Scene();

  constructor() {
    this.sky.name = 'skyScene';
    this.far.name = 'farScene';
    this.near.name = 'nearScene';
    this.viewModel.name = 'vmScene';
    this.vab.name = 'vabScene';
    // Compositing is by clear order, never by depth merge, so no scene has a
    // background of its own: pass 1 paints every pixel.
    this.sky.background = null;
    this.far.background = null;
    this.near.background = null;
  }

  all(): THREE.Scene[] { return [this.sky, this.far, this.near, this.viewModel]; }
}
