// The 4-pass compositor. Owns the clear order and ONLY the clear order
// (ARCHITECTURE.md section 3.1). Compositing is by clear order, never by depth
// merge, so each pass gets a fresh depth buffer and its own decade range.
//
// The post stack does not change that and is not a fifth pass. It brackets the
// four (bind a target first, resolve to the canvas last) and it interposes at
// exactly ONE point inside them: after the near pass, before its clearDepth().
// That point is not a preference. It is the only instant in the frame at which
// the depth attachment holds the near 1:1 scene and nothing else, and ambient
// occlusion computed from any other instant would be occlusion of the wrong
// world - the view model's arms against a buffer their occluders are not in.

import * as THREE from 'three';
import type { OFRenderer } from './Renderer.js';
import type { Scenes } from './Scenes.js';
import type { CameraRig } from './CameraRig.js';
import { ViewModelLight } from './ViewModelLight.js';

export interface PassTimings {
  sky: number; far: number; near: number; viewModel: number; total: number;
  /** CPU time submitting the post stack. See PostStack for what this is not. */
  post: number;
  /** Draw calls issued by the four scene passes, before any post pass. */
  sceneCalls: number;
  /** Draw calls issued by the post stack. Kept apart because the 150-call
   *  budget in ARCHITECTURE section 10 is about scene complexity, and a fixed
   *  full-screen cost folded into it would quietly consume another lane's
   *  headroom. */
  postCalls: number;
}

export class Frame {
  readonly timings: PassTimings = {
    sky: 0, far: 0, near: 0, viewModel: 0, total: 0,
    post: 0, sceneCalls: 0, postCalls: 0,
  };
  /**
   * The assembly bay REPLACES the four passes rather than adding a fifth. A
   * rocket on a stand and a planet at 600 km share no depth range, no lighting
   * and no camera, so compositing them would buy nothing but a way for one to
   * seam into the other. It also means `info().calls` in the VAB is the VAB's
   * own draw-call count and not the planet's plus a bit.
   */
  vabActive = false;
  /**
   * The 3D map (GP-208). Like the bay it REPLACES the four passes rather than
   * compositing over them: the map is a different world (FAR_SCALE units, its
   * own sun) and shares no depth range with the scene it depicts. A nullable
   * SLOT rather than a boolean, so "closed costs zero" is structural: while
   * this is null no map object can reach the renderer at all. MapMode writes
   * it on enter and clears it on leave; the bay wins when both are set,
   * because M is dead inside the bay and a stale map slot must not eat it.
   */
  mapScene: THREE.Scene | null = null;
  /**
   * The sun, resolved ONCE out of the near scene by the name `ShadowRig` gives
   * cascade 0, and handed to the post stack so the contact-shadow march knows
   * which way to walk.
   *
   * A name lookup rather than a constructor argument, and that is a constraint
   * rather than a preference: every wire into this class comes from `Boot.ts`,
   * which another lane owns this round. It is honest as well as expedient,
   * because cascade 0 IS the near scene's sun (ShadowRig's own comment: the two
   * were merged so that a stock `MeshStandardMaterial` is shadowed by the light
   * that lights it), so there is no second authority to disagree with.
   *
   * When the rig was built disabled there is no light at all and the vector
   * stays zero, which the post stack reads as "no sun" and skips on. That means
   * `?shadows=0` also removes contact shadows. That is correct rather than
   * incidental: it is a shadow.
   */
  private sun: THREE.DirectionalLight | null = null;
  private sunSearched = false;
  /**
   * RN-1990. Pass 4's shadow receive. It is owned HERE and driven from inside
   * `render()` for one reason that is structural rather than tidy: the term is
   * the world's cascade-0 map rebased into view-model space, so it is only
   * correct in the window between the near pass (which renders that map for
   * this frame's eye) and the view-model pass (which samples it). This class
   * owns that window. Anywhere else and the arms would sample last frame's
   * shadow, which on a 4.6 m/s walk is 77 mm of lag on a term whose whole job
   * is to change the instant the player steps under a tree.
   */
  readonly vmLight: ViewModelLight;

  constructor(
    private readonly r: OFRenderer,
    private readonly scenes: Scenes,
    private readonly rig: CameraRig,
  ) {
    this.vmLight = new ViewModelLight(scenes.near, scenes.viewModel);
  }

  /** Write the world-space sun direction into the post stack, or leave it zero. */
  private publishSun(): void {
    if (!this.sunSearched) {
      this.sunSearched = true;
      this.sun = (this.scenes.near.getObjectByName('shadowCascade0')
        ?? null) as THREE.DirectionalLight | null;
    }
    const s = this.sun;
    if (s === null) { this.r.post.sunWorld.set(0, 0, 0); return; }
    // ShadowRig places the light at `centre + sunDir * CASTER_BACKOFF_M` and
    // aims its target at `centre`, so the direction TOWARD the sun is exactly
    // the difference. Derived rather than stored, so it cannot go stale.
    this.r.post.sunWorld.copy(s.position).sub(s.target.position).normalize();
  }

  render(): void {
    const r = this.r;
    const post = r.post;
    const t = this.timings;
    const t0 = performance.now();

    r.resetInfo();
    // Binds the HDR target when post is on, the canvas when it is off. Either
    // way the clear below lands on whatever the frame is being drawn into.
    post.beginFrame();
    r.clearAll();
    const clear = r.depth.clearValue();
    this.publishSun();

    if (this.vabActive) {
      r.render(this.scenes.vab, this.rig.vabCam);
      // The bay is one pass and it writes depth, so the AO interpose point is
      // simply "after it". A rocket on a stand is exactly the subject AO helps.
      post.afterNear(this.rig.vabCam, clear, r.depth.logFC(this.rig.vabCam.far));
      const tv = performance.now();
      t.sceneCalls = r.info().calls - post.calls;
      post.finish();
      t.sky = 0; t.far = 0; t.near = tv - t0; t.viewModel = 0;
      t.post = post.timings.total;
      t.postCalls = post.calls;
      t.total = performance.now() - t0;
      return;
    }

    if (this.mapScene !== null) {
      // One pass, stock materials, no AO interpose: occlusion of a line chart
      // is occlusion of nothing. finish() still runs so tonemap/AA land the
      // frame on the canvas exactly as they do for the world.
      r.render(this.mapScene, this.rig.mapCam);
      const tm = performance.now();
      t.sceneCalls = r.info().calls - post.calls;
      post.finish();
      t.sky = 0; t.far = 0; t.near = tm - t0; t.viewModel = 0;
      t.post = post.timings.total;
      t.postCalls = post.calls;
      t.total = performance.now() - t0;
      return;
    }

    r.render(this.scenes.sky, this.rig.skyCam);
    const t1 = performance.now();
    r.clearDepth();

    r.render(this.scenes.far, this.rig.farCam);
    const t2 = performance.now();
    r.clearDepth();

    r.render(this.scenes.near, this.rig.nearCam);
    const t3 = performance.now();

    // BEFORE the clearDepth below. Moving this line one statement later would
    // hand the AO pass a cleared buffer, every pixel would read as background,
    // the effect would silently vanish and every frame-time number would still
    // look healthy. That is the failure class standing rule 11 names, so
    // probes/post.js asserts the occlusion CONTRAST rather than that it ran.
    post.afterNear(this.rig.nearCam, clear, r.depth.logFC(this.rig.nearCam.far));
    const t4 = performance.now();
    r.clearDepth();

    // RN-1990. AFTER the near pass, BEFORE pass 4. See `vmLight`.
    this.vmLight.sync(this.rig.nearCam.position);
    r.render(this.scenes.viewModel, this.rig.vmCam);
    const t5 = performance.now();

    t.sceneCalls = r.info().calls - post.calls;
    post.finish();

    t.sky = t1 - t0;
    t.far = t2 - t1;
    t.near = t3 - t2;
    t.viewModel = t5 - t4;
    t.post = post.timings.total;
    t.postCalls = post.calls;
    t.total = performance.now() - t0;
  }
}
