// The screen-space contact-shadow pass: its two blits, its uniforms and its
// draw. The GLSL and the argument for why it exists live in ContactGlsl.ts.
//
// Split out of PostStack.ts at the 400-line cap, and the boundary is a real one:
// PostStack owns the ORDER (what runs after the near pass, what runs after the
// view model, and the one interpose point that makes depth-only effects legal),
// while this owns one effect's uniforms. AO stayed inline because it is four
// passes wired to each other and moving it would only move the wires.

import * as THREE from 'three';
import { Blit, postMaterial } from './Quad.js';
import type { DepthDefines } from './DepthGlsl.js';
import { CONTACT_APPLY_FS, CONTACT_FS } from './ContactGlsl.js';
import type { PostTuning } from './PostConfig.js';
// TYPE-only, so it is erased and there is no import cycle at runtime.
import type { PostHost } from './PostStack.js';
import type { PostTargets } from './Targets.js';

export class ContactPass {
  private readonly march: Blit;
  private readonly apply: Blit;
  private readonly sunView = new THREE.Vector3();
  /**
   * Direction TOWARD the sun in WORLD space, written by `Frame` every frame.
   * Zero length means "no sun in this scene", which is the honest state when the
   * shadow rig was built disabled, and the march skips rather than walking along
   * an arbitrary axis.
   */
  readonly sunWorld = new THREE.Vector3();
  ran = false;

  constructor(private readonly tune: PostTuning, dd: DepthDefines) {
    this.march = new Blit(postMaterial('of.contact', CONTACT_FS, {
      tDepth: { value: null }, uTexel: { value: new THREE.Vector2() },
      uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
      uLogFC: { value: 1 }, uDepthClear: { value: 0 },
      uSunView: { value: new THREE.Vector3(0, 1, 0) },
      uLengthM: { value: tune.csLengthM }, uThickM: { value: tune.csThickM },
      uMaxScreen: { value: tune.csMaxScreen }, uBiasM: { value: tune.csBiasM },
      uThinEdgeInv: { value: 1 / tune.csThinEdgeM }, uThinAmount: { value: tune.csThinAmount },
      uThinNearM: { value: tune.csThinNearM }, uThinFarM: { value: tune.csThinFarM },
    }, { defines: { ...dd, OF_CS_STEPS: tune.csSteps } }));

    this.apply = new Blit(postMaterial('of.contact.apply', CONTACT_APPLY_FS, {
      tContact: { value: null }, uTexel: { value: new THREE.Vector2() },
      uStrength: { value: tune.csStrength },
    }, { multiply: true }));
  }

  /**
   * March and multiply. Runs at the same instant as AO and off the same depth
   * attachment, because that instant is the only one in the frame at which the
   * buffer holds exactly the near 1:1 scene (Frame.ts's note), but it runs
   * INDEPENDENTLY of it so `?ao=0` and `?contact=0` isolate one effect each.
   *
   * Returns the draw calls issued: 0 when there is no sun, 2 otherwise.
   */
  run(
    host: PostHost, t: PostTargets, camera: THREE.PerspectiveCamera,
    depth: THREE.DepthTexture | null, projInv: THREE.Matrix4,
    depthClear: number, logFC: number,
  ): number {
    this.ran = false;
    if (this.sunWorld.lengthSq() < 0.25) return 0;
    // World to VIEW. `transformDirection` applies the upper 3x3 and renormalises,
    // which is what a direction wants and what a full matrix multiply would get
    // wrong by adding the camera's translation to a unit vector.
    this.sunView.copy(this.sunWorld).transformDirection(camera.matrixWorldInverse);

    const c = this.march.u;
    c.tDepth.value = depth;
    (c.uTexel.value as THREE.Vector2).set(1 / t.sizes.w, 1 / t.sizes.h);
    (c.uProj.value as THREE.Matrix4).copy(camera.projectionMatrix);
    (c.uProjInv.value as THREE.Matrix4).copy(projInv);
    c.uLogFC.value = logFC;
    c.uDepthClear.value = depthClear;
    (c.uSunView.value as THREE.Vector3).copy(this.sunView);
    c.uLengthM.value = this.tune.csLengthM;
    c.uThickM.value = this.tune.csThickM;
    c.uMaxScreen.value = this.tune.csMaxScreen;
    c.uBiasM.value = this.tune.csBiasM;
    c.uThinEdgeInv.value = 1 / this.tune.csThinEdgeM;
    c.uThinAmount.value = this.tune.csThinAmount;
    c.uThinNearM.value = this.tune.csThinNearM;
    c.uThinFarM.value = this.tune.csThinFarM;
    host.setTarget(t.contact);
    host.drawFullScreen(this.march.mesh);

    // Same rule as the AO apply: the one pass that touches scene colour samples
    // exactly one texture the scene framebuffer does not own (RN-11).
    const a = this.apply.u;
    a.tContact.value = t.contact.texture;
    (a.uTexel.value as THREE.Vector2).set(1 / t.sizes.w, 1 / t.sizes.h);
    a.uStrength.value = this.tune.csStrength;
    host.setTarget(t.scene);
    host.drawFullScreen(this.apply.mesh);

    this.ran = true;
    return 2;
  }

  dispose(): void {
    this.march.dispose();
    this.apply.dispose();
  }
}
