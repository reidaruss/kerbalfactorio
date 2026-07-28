// The underwater pass: its two blits, its uniforms, its draw, and the ONE
// question it has to answer before any of that, which is "is the eye wet".
//
// Split from PostStack on the ContactPass boundary: PostStack owns the ORDER,
// this owns one effect. The GLSL and the argument for the whole shape of the
// effect live in UnderwaterGlsl.ts.
//
// THE NEGATIVE CONTROL IS STRUCTURAL, NOT ARITHMETIC. Above the water this pass
// is SKIPPED (`run` returns 0 before touching a target), rather than running and
// multiplying by a transmittance that happens to be 1.0. A term that runs and
// cancels is a term that will one day not cancel: `exp(-sigma * 0)` is exactly 1
// only while nothing rounds, and the moment someone adds a constant to the path
// the whole dry world tints by a count nobody attributes. Skipping makes "the
// pass does nothing on dry land" a property of the call graph, which is the same
// confinement-by-call-site argument RN-30 had to retreat to for the aerosol.
//
// WHERE THE TWO INPUTS COME FROM, and this is a SEAM rather than a design.
// `headUnderM` and `upWorld` are public fields on the `ContactPass.sunWorld`
// precedent, so a one-line wire in Frame.ts can write them and `sample()` can go
// away. Until then `sample()` resolves them itself out of the client's own
// published state, for exactly the reason `Frame.publishSun` resolves the sun by
// a name lookup: every wire into the render seam comes from Boot.ts, which
// another lane owns this round. It is honest as well as expedient, because
// `__of.swim()` returns the object THE CAPSULE ACTED ON this tick rather than a
// value re-derived for the renderer, so there is no second authority on how deep
// the eye is and no way for the picture to disagree with the physics.
//
// The cost of the lookup is one small object per frame from `swim()`, plus one
// more from `aim()` on the frames the eye is actually under water. That is a
// real violation of ARCHITECTURE 2.2 rule 6 and it is written down here rather
// than hidden; the Frame.ts wire removes both.

import * as THREE from 'three';
import { Blit, postMaterial } from './Quad.js';
import type { DepthDefines } from './DepthGlsl.js';
import { UNDERWATER_APPLY_FS, UNDERWATER_FS } from './UnderwaterGlsl.js';
import type { PostFlags, PostTuning } from './PostConfig.js';
// TYPE-only, so it is erased and there is no import cycle at runtime.
import type { PostHost } from './PostStack.js';
import type { PostTargets } from './Targets.js';

/**
 * The narrow slice of `window.__of` this pass reads. Deliberately typed as two
 * functions and nothing else, so it cannot grow into a second route by which
 * the renderer reaches into the simulation.
 */
interface WorldSource {
  /** The walker's own water state. `headUnderM` is metres of EYE submersion. */
  swim(): { headUnderM: number } | null;
  /** The aim ray, whose `origin` is the eye in BODY-FRAME metres. */
  aim(): { origin: number[] } | null;
}

export class UnderwaterPass {
  private readonly march: Blit;
  private readonly absorb: Blit;
  private readonly inscatter: Blit;
  /**
   * The transmittance buffer, full resolution RGBA8. Owned HERE and not in
   * Targets.ts, which is a deliberate exception to that file's "every target in
   * one place" rule and is why `bytes` below is published and added into
   * `PostStack.vram`: Targets.ts belongs to the same lane as PostStack's wiring
   * and is not this change's to edit. Allocated LAZILY, on the first frame the
   * eye is actually under water, so a dry planet pays nothing at all.
   */
  private water: THREE.WebGLRenderTarget | null = null;
  private waterW = 0;
  private waterH = 0;
  /** Metres the EYE is below the water surface. Zero or negative means dry. */
  headUnderM = 0;
  /**
   * Local up, WORLD space, unit length. The near scene is the body frame minus
   * the floating origin, which is a PURE TRANSLATION (Debug.ts's `eyeRel`), so a
   * body-frame direction is already a render-space direction and there is
   * nothing to rotate.
   */
  readonly upWorld = new THREE.Vector3(0, 1, 0);
  ran = false;
  private readonly upView = new THREE.Vector3();
  private world: WorldSource | null = null;

  constructor(
    private readonly flags: PostFlags,
    private readonly tune: PostTuning,
    dd: DepthDefines,
  ) {
    this.march = new Blit(postMaterial('of.water', UNDERWATER_FS, {
      tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() },
      uLogFC: { value: 1 }, uDepthClear: { value: 0 },
      uUpView: { value: new THREE.Vector3(0, 1, 0) }, uHeadUnderM: { value: 0 },
      uSigma: { value: new THREE.Vector3() },
      uMaxPathM: { value: tune.uwMaxPathM },
    }, { defines: dd }));
    const applyUniforms = (): Record<string, THREE.IUniform> => ({
      tWater: { value: null }, uTint: { value: new THREE.Vector3() },
      uScatterFrac: { value: tune.uwScatterFrac },
    });
    this.absorb = new Blit(postMaterial('of.water.absorb', UNDERWATER_APPLY_FS,
      applyUniforms(), { multiply: true }));
    this.inscatter = new Blit(postMaterial('of.water.inscatter', UNDERWATER_APPLY_FS,
      applyUniforms(), { defines: { OF_UW_INSCATTER: 1 }, add: true }));

    // The runtime handle, on the `__ofSurfaces` / `__ofAtmos` / `__ofTerrainArt`
    // precedent, and it is a runtime toggle for the reason SkyPass gives for
    // `setAerial`: the claim is a MATCHED PAIR, and two page loads cannot hold
    // the camera, the sun, the resident chunk set and the swimmer's own depth
    // equal. `?underwater=0` is the same switch reached at boot.
    (window as unknown as { __ofUnderwater: unknown }).__ofUnderwater = {
      set: (on: boolean): boolean => { this.flags.underwater = on; return on; },
      state: (): unknown => ({
        on: this.flags.underwater, ran: this.ran, headUnderM: this.headUnderM,
        upWorld: this.upWorld.toArray(),
        sigma: this.sigmaAt(), tint: this.tintAt(),
        scatter: this.scatterAt(),
        extinction: this.tune.uwExtinction, tintScale: this.tune.uwTintScale,
        scatterFrac: this.tune.uwScatterFrac, maxPathM: this.tune.uwMaxPathM,
        wired: this.world !== null, bytes: this.bytes,
      }),
      /** The scalar tuners, live, so a sweep is one binary and not five. */
      setTune: (t: Partial<PostTuning>): PostTuning =>
        Object.assign(this.tune, t) as PostTuning,
    };
  }

  /** Bytes of VRAM this pass owns. Zero until the eye first goes under. */
  get bytes(): number { return this.water === null ? 0 : this.waterW * this.waterH * 4; }

  /**
   * RGBA8 rather than half float. The buffer holds a transmittance in [0, 1]
   * that is then MULTIPLIED into the scene colour, so one part in 255 of it is
   * at most one count of the result, and 4 B/px is half what a half-float target
   * would cost. Nearest filtering because it is sampled 1:1 and a linear tap
   * across a silhouette would bleed the far pixel's path onto the near one.
   */
  private ensureTarget(w: number, h: number): THREE.WebGLRenderTarget {
    if (this.water !== null && this.waterW === w && this.waterH === h) return this.water;
    this.water?.dispose();
    this.water = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.water.texture.name = 'post:water';
    this.waterW = w;
    this.waterH = h;
    return this.water;
  }

  private sigmaAt(): [number, number, number] {
    const s = this.tune.uwSigma;
    const k = this.tune.uwExtinction;
    return [s[0] * k, s[1] * k, s[2] * k];
  }

  private scatterAt(): [number, number, number] {
    const s = this.sigmaAt();
    const f = this.tune.uwScatterFrac;
    return [s[0] * f, s[1] * f, s[2] * f];
  }

  private tintAt(): [number, number, number] {
    const t = this.tune.uwTint;
    const k = this.tune.uwTintScale;
    return [t[0] * k, t[1] * k, t[2] * k];
  }

  /**
   * Read the eye's submersion and the local up. Returns `headUnderM`, so the
   * caller can skip without a second read. See the header for why this is a
   * lookup; replacing it with a Frame.ts wire is deleting the call.
   */
  sample(): number {
    if (this.world === null) {
      const g = (window as unknown as { __of?: Partial<WorldSource> }).__of;
      if (g === undefined || typeof g.swim !== 'function' || typeof g.aim !== 'function') {
        this.headUnderM = 0;
        return 0;
      }
      this.world = g as WorldSource;
    }
    const sw = this.world.swim();
    // No player (the free camera, the bay, a flight session) means nobody is
    // swimming. Reported as dry rather than guessed at, which is why a free
    // camera flown under the pond surface is NOT tinted: see the report.
    this.headUnderM = sw === null ? 0 : sw.headUnderM;
    if (this.headUnderM <= 0) return this.headUnderM;
    const aim = this.world.aim();
    if (aim === null || aim.origin.length < 3) { this.headUnderM = 0; return 0; }
    this.upWorld.set(aim.origin[0], aim.origin[1], aim.origin[2]);
    const l = this.upWorld.length();
    if (l < 1e-6) { this.headUnderM = 0; return 0; }
    this.upWorld.multiplyScalar(1 / l);
    return this.headUnderM;
  }

  /**
   * Attenuate and fill in. Runs at the same instant as AO and the contact
   * shadows and off the same depth attachment, because that instant is the only
   * one in the frame at which the buffer holds exactly the near 1:1 scene, and
   * it runs AFTER both of them so occlusion is computed on DRY radiance and then
   * attenuated. That order is physical: the shadow under a rock is a property of
   * the rock, not of the water between the rock and the eye.
   *
   * Returns the draw calls issued: 0 when the eye is dry, 3 otherwise.
   */
  run(
    host: PostHost, t: PostTargets, camera: THREE.PerspectiveCamera,
    depth: THREE.DepthTexture | null, projInv: THREE.Matrix4,
    depthClear: number, logFC: number,
  ): number {
    this.ran = false;
    if (this.sample() <= 0) return 0;
    // World to VIEW, as a DIRECTION: the upper 3x3 and a renormalise, never a
    // full multiply, which would add the camera's translation to a unit vector.
    this.upView.copy(this.upWorld).transformDirection(camera.matrixWorldInverse);

    const m = this.march.u;
    m.tDepth.value = depth;
    (m.uProjInv.value as THREE.Matrix4).copy(projInv);
    m.uLogFC.value = logFC;
    m.uDepthClear.value = depthClear;
    (m.uUpView.value as THREE.Vector3).copy(this.upView);
    m.uHeadUnderM.value = this.headUnderM;
    (m.uSigma.value as THREE.Vector3).set(...this.sigmaAt());
    m.uMaxPathM.value = this.tune.uwMaxPathM;
    const water = this.ensureTarget(t.sizes.w, t.sizes.h);
    host.setTarget(water);
    host.drawFullScreen(this.march.mesh);

    const tint = this.tintAt();
    for (const blit of [this.absorb, this.inscatter]) {
      blit.u.tWater.value = water.texture;
      (blit.u.uTint.value as THREE.Vector3).set(...tint);
      blit.u.uScatterFrac.value = this.tune.uwScatterFrac;
    }

    // Multiply FIRST, then add. Both read ONLY the scratch above, which is not
    // an attachment of the framebuffer they write to, which is RN-11's rule and
    // is what the two-draw version got wrong (see UnderwaterGlsl's header).
    host.setTarget(t.scene);
    host.drawFullScreen(this.absorb.mesh);
    host.drawFullScreen(this.inscatter.mesh);

    this.ran = true;
    return 3;
  }

  dispose(): void {
    this.march.dispose();
    this.absorb.dispose();
    this.inscatter.dispose();
    this.water?.dispose();
    this.water = null;
  }
}
