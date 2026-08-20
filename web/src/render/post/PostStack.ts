// The post-processing stack, and its ONE structural constraint.
//
// This is NOT a fifth pass and it is NOT an EffectComposer. ARCHITECTURE
// section 3.1 composites by CLEAR ORDER, never by depth merge: four scenes, one
// canvas, depth cleared between them so each pass owns its own decade range. A
// composer that assumes one scene and one depth buffer would read the VIEW
// MODEL's depth (the last pass to write) and compute ambient occlusion for the
// player's forearms against a world that is no longer in the buffer.
//
// So the stack splits in two around the near pass:
//
//   beginFrame()  bind the HDR scene target, depth attachment included
//   pass 1 sky . clearDepth . pass 2 far . clearDepth . pass 3 NEAR
//   afterNear()   <- AO computed here, from a depth buffer that holds EXACTLY
//                    the near 1:1 scene, and MULTIPLIED into the colour target
//                    before anything else draws over it
//   clearDepth . pass 4 view model
//   finish()      bloom pyramid, composite (ACES + grade), FXAA, to the canvas
//
// Consequences worth stating because they are choices:
// - AO never touches the sky, the far scaled planet, or the FP view model. The
//   first two because their depth is gone by the time AO runs and background
//   depth is skipped explicitly; the third because it has not been drawn yet.
//   All three are correct: a planet 600 km away has no contact shadow, and the
//   arms are a separate depth range whose occluders are not in the same buffer.
// - Bloom and the grade DO see all four passes, which is what makes the sun
//   disc and the engine plume bloom.
// - The final image lands on the DEFAULT framebuffer, so Loop.frameHash's
//   readPixels and ZFightProbe keep reading what was presented.

import * as THREE from 'three';
import type { DepthMode } from '../DepthPolicy.js';
import { PostTargets } from './Targets.js';
import { Blit, postMaterial } from './Quad.js';
import { depthDefines } from './DepthGlsl.js';
import { AO_APPLY_FS, AO_BLUR_FS, AO_FS, AO_UPSAMPLE_FS } from './AoGlsl.js';
import { ContactPass } from './ContactPass.js';
import { UnderwaterPass } from './UnderwaterPass.js';
import { BLOOM_DOWN_FS, BLOOM_UP_FS } from './BloomGlsl.js';
import { COMPOSITE_FS } from './CompositeGlsl.js';
import { TONE, writeToneUniforms } from './ToneDrive.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { PostFlags, PostTuning } from './PostConfig.js';

/** What the stack needs from the renderer seam. No three.js renderer escapes. */
export interface PostHost {
  setTarget(rt: THREE.WebGLRenderTarget | null): void;
  drawFullScreen(mesh: THREE.Mesh): void;
  bufferSize(): { w: number; h: number };
  readonly depthMode: DepthMode;
}

export interface PostTimings {
  ao: number; contact: number; underwater: number; bloom: number;
  composite: number; aa: number; total: number;
}

const ZERO: PostTimings = {
  ao: 0, contact: 0, underwater: 0, bloom: 0, composite: 0, aa: 0, total: 0,
};

export class PostStack {
  readonly timings: PostTimings = { ...ZERO };
  /** Draw calls the stack itself issued last frame. Reported apart from scene. */
  calls = 0;
  private targets: PostTargets;
  private readonly ao: Blit;
  private readonly aoBlur: Blit;
  private readonly aoUpsample: Blit;
  private readonly aoApply: Blit;
  readonly contactPass: ContactPass;
  readonly underwaterPass: UnderwaterPass;
  private readonly bloomDown: Blit;
  private readonly bloomDownFirst: Blit;
  private readonly bloomUp: Blit;
  private readonly composite: Blit;
  private aa: Blit;
  private readonly black: THREE.Texture;
  private aoRan = false;
  /** Hoisted: ARCHITECTURE 2.2 rule 6, no allocation in the steady-state path. */
  private readonly projInv = new THREE.Matrix4();

  constructor(
    private readonly host: PostHost,
    readonly flags: PostFlags,
    readonly tune: PostTuning,
  ) {
    const size = host.bufferSize();
    this.targets = new PostTargets(size.w, size.h, tune.aoScale, tune.bloomLevels, tune.samples);
    const dd = depthDefines(host.depthMode);

    this.ao = new Blit(postMaterial('of.ao', AO_FS, {
      tDepth: { value: null }, uFullTexel: { value: new THREE.Vector2() },
      uTexel: { value: new THREE.Vector2() }, uProj: { value: new THREE.Matrix4() },
      uProjInv: { value: new THREE.Matrix4() }, uLogFC: { value: 1 },
      uDepthClear: { value: 0 }, uRadius: { value: tune.aoRadiusM },
      uMaxScreen: { value: tune.aoMaxScreen }, uFalloffInv: { value: 1 },
    }, { defines: { ...dd, OF_AO_SLICES: tune.aoSlices, OF_AO_STEPS: tune.aoSteps } }));

    this.aoBlur = new Blit(postMaterial('of.ao.blur', AO_BLUR_FS, {
      tAo: { value: null }, tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() }, uDepthSigma: { value: tune.aoDepthSigma },
      uProjInv: { value: new THREE.Matrix4() }, uLogFC: { value: 1 },
      uDepthClear: { value: 0 },
    }, { defines: dd }));

    this.aoUpsample = new Blit(postMaterial('of.ao.upsample', AO_UPSAMPLE_FS, {
      tAo: { value: null }, tDepth: { value: null },
      uAoTexel: { value: new THREE.Vector2() }, uDepthSigma: { value: tune.aoDepthSigma },
      uProjInv: { value: new THREE.Matrix4() }, uLogFC: { value: 1 },
      uDepthClear: { value: 0 },
    }, { defines: dd }));

    this.aoApply = new Blit(postMaterial('of.ao.apply', AO_APPLY_FS, {
      tAo: { value: null }, uStrength: { value: new THREE.Vector3() },
      uPower: { value: tune.aoPower },
    }, { multiply: true }));

    this.contactPass = new ContactPass(tune, dd);
    this.underwaterPass = new UnderwaterPass(flags, tune, dd);

    const downUniforms = (): Record<string, THREE.IUniform> => ({
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: tune.bloomThreshold }, uKnee: { value: tune.bloomKnee },
    });
    this.bloomDownFirst = new Blit(postMaterial('of.bloom.down0', BLOOM_DOWN_FS,
      downUniforms(), { defines: { OF_BLOOM_FIRST: 1 } }));
    this.bloomDown = new Blit(postMaterial('of.bloom.down', BLOOM_DOWN_FS, downUniforms()));
    this.bloomUp = new Blit(postMaterial('of.bloom.up', BLOOM_UP_FS, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
      uScatter: { value: tune.bloomScatter },
    }, { add: true }));

    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;

    // The probe surface, on the `Surfaces.ts` precedent. Every flag here is read
    // once per frame in `afterNear`/`finish`, so flipping one takes effect on
    // the NEXT frame and a matched pair can be taken inside one settled camera,
    // one streamed chunk set and one sun, which two page loads cannot promise.
    // `?contact=0` does the same thing at boot; this is the same switch reached
    // from a probe rather than from a URL.
    (window as unknown as { __ofPost: unknown }).__ofPost = {
      setContact: (on: boolean): boolean => { this.flags.contact = on; return on; },
      setAo: (on: boolean): boolean => { this.flags.ao = on; return on; },
      setUnderwater: (on: boolean): boolean => { this.flags.underwater = on; return on; },
      state: (): unknown => ({
        ...this.flags, contactRan: this.contactPass.ran,
        underwaterRan: this.underwaterPass.ran,
        headUnderM: this.underwaterPass.headUnderM,
        sun: this.contactPass.sunWorld.toArray(),
        csLengthM: this.tune.csLengthM, csSteps: this.tune.csSteps,
        csStrength: this.tune.csStrength,
      }),
    };

    this.composite = new Blit(postMaterial('of.composite', COMPOSITE_FS, {
      tScene: { value: null }, tBloom: { value: this.black },
      uBloomStrength: { value: 0 }, uExposure: { value: tune.exposure },
      uGradeMix: { value: 0 }, uContrast: { value: tune.contrast },
      uCurveMix: { value: tune.curveMix },
      uSaturation: { value: tune.saturation },
      uShadowTint: { value: new THREE.Vector3(...tune.shadowTint) },
      uHighlightTint: { value: new THREE.Vector3(...tune.highlightTint) },
      uLift: { value: tune.lift }, uVignette: { value: tune.vignette },
      uVignetteSoft: { value: tune.vignetteSoft },
      // RN-2130, the fidelity lane's tone response and palette. ToneDrive.ts
      // owns every value that goes into these four and states why.
      uShoulder: { value: 0 }, uShoulderKnee: { value: 0.58 },
      uGreenPull: { value: 0 }, uGreenAxis: { value: new THREE.Vector3(1, 1, 1) },
    }));

    // three's own FXAA 3.11 port, with EXACTLY one substitution: its `Sample`
    // helper's implicit-LOD fetch becomes an explicit level 0. FXAA's edge
    // search is a loop with a data-dependent exit, so an implicit fetch inside
    // it is the same ANGLE `X3595` the AO shader had, and the smoke runner
    // fails on any WebGL warning, correctly.
    //
    // The substitution SHOULD not be able to change a pixel, because `tLdr` has
    // no mipmaps and implicit LOD selection therefore already resolves to level
    // 0 for every fetch. That is an argument, and `setFxaaImplicitLod` below is
    // what turns it into a measurement: it rebuilds this one program in place so
    // the two variants can be framehashed inside ONE page, at one settled
    // camera, with nothing else different. Comparing across two page loads was
    // tried first and is worthless here, because the hash is only stable once
    // terrain streaming has converged and the first attempt had not.
    this.aa = this.buildAa();
  }

  private buildAa(): Blit {
    const src = this.tune.fxaaImplicitLod
      ? FXAAShader.fragmentShader
      : FXAAShader.fragmentShader.replace(
        'return texture( tex2D, uv );', 'return textureLod( tex2D, uv, 0.0 );');
    return new Blit(postMaterial('of.fxaa', src, {
      tDiffuse: { value: null }, resolution: { value: new THREE.Vector2() },
    }));
  }

  /** Swap the FXAA program between three's source and the explicit-LOD one. */
  setFxaaImplicitLod(on: boolean): boolean {
    if (on !== this.tune.fxaaImplicitLod) {
      this.tune.fxaaImplicitLod = on;
      this.aa.dispose();
      this.aa = this.buildAa();
    }
    return this.tune.fxaaImplicitLod;
  }

  /** Includes the underwater pass's own buffer, which is zero until it runs. */
  get vram(): number { return this.targets.bytes + this.underwaterPass.bytes; }
  get sizes(): { w: number; h: number; aoW: number; aoH: number } { return this.targets.sizes; }

  /**
   * Bind the HDR scene target. Returns false when post is off, in which case
   * the caller renders straight to the canvas exactly as it did before this
   * lane existed - that is what makes `?post=0` a true baseline rather than a
   * different code path with the effects zeroed.
   */
  beginFrame(): boolean {
    this.calls = 0;
    Object.assign(this.timings, ZERO);
    this.aoRan = false;
    this.contactPass.ran = false;
    this.underwaterPass.ran = false;
    if (!this.flags.post) { this.host.setTarget(null); return false; }
    const s = this.host.bufferSize();
    this.targets.resize(s.w, s.h);
    this.host.setTarget(this.targets.scene);
    return true;
  }

  /** Called after the NEAR pass and before its clearDepth(). */
  afterNear(camera: THREE.PerspectiveCamera, depthClear: number, logFC: number): void {
    if (!this.flags.post) return;
    if (!this.flags.ao && !this.flags.contact && !this.flags.underwater) return;
    const t = this.targets;
    const depth = t.scene.depthTexture;
    const projInv = this.projInv.copy(camera.projectionMatrix).invert();
    if (this.flags.ao) this.runAo(camera, depth, projInv, depthClear, logFC);
    if (this.flags.contact) {
      const t0 = performance.now();
      this.calls += this.contactPass.run(
        this.host, t, camera, depth, projInv, depthClear, logFC);
      this.timings.contact = performance.now() - t0;
    }
    // LAST of the three, so occlusion is computed on DRY radiance and then
    // attenuated rather than the other way round, which is the physical order.
    if (this.flags.underwater) {
      const t0 = performance.now();
      this.calls += this.underwaterPass.run(
        this.host, t, camera, depth, projInv, depthClear, logFC);
      this.timings.underwater = performance.now() - t0;
    }
  }

  private runAo(
    camera: THREE.PerspectiveCamera, depth: THREE.DepthTexture | null,
    projInv: THREE.Matrix4, depthClear: number, logFC: number,
  ): void {
    const t0 = performance.now();
    const t = this.targets;

    const u = this.ao.u;
    u.tDepth.value = depth;
    (u.uFullTexel.value as THREE.Vector2).set(1 / t.sizes.w, 1 / t.sizes.h);
    (u.uTexel.value as THREE.Vector2).set(1 / t.sizes.aoW, 1 / t.sizes.aoH);
    (u.uProj.value as THREE.Matrix4).copy(camera.projectionMatrix);
    (u.uProjInv.value as THREE.Matrix4).copy(projInv);
    u.uLogFC.value = logFC;
    u.uDepthClear.value = depthClear;
    u.uRadius.value = this.tune.aoRadiusM;
    u.uMaxScreen.value = this.tune.aoMaxScreen;
    u.uFalloffInv.value = 1 / Math.max(1e-3, this.tune.aoRadiusM * this.tune.aoFalloff);
    this.host.setTarget(t.ao);
    this.host.drawFullScreen(this.ao.mesh);

    const b = this.aoBlur.u;
    b.tAo.value = t.ao.texture;
    b.tDepth.value = depth;
    (b.uTexel.value as THREE.Vector2).set(1 / t.sizes.aoW, 1 / t.sizes.aoH);
    b.uDepthSigma.value = this.tune.aoDepthSigma;
    (b.uProjInv.value as THREE.Matrix4).copy(projInv);
    b.uLogFC.value = logFC;
    b.uDepthClear.value = depthClear;
    this.host.setTarget(t.aoBlur);
    this.host.drawFullScreen(this.aoBlur.mesh);

    const s = this.aoUpsample.u;
    s.tAo.value = t.aoBlur.texture;
    s.tDepth.value = depth;
    (s.uAoTexel.value as THREE.Vector2).set(1 / t.sizes.aoW, 1 / t.sizes.aoH);
    s.uDepthSigma.value = this.tune.aoDepthSigma;
    (s.uProjInv.value as THREE.Matrix4).copy(projInv);
    s.uLogFC.value = logFC;
    s.uDepthClear.value = depthClear;
    this.host.setTarget(t.aoFull);
    this.host.drawFullScreen(this.aoUpsample.mesh);

    // The ONLY pass that touches the scene colour, and the only one that must
    // not sample anything the scene framebuffer owns.
    const a = this.aoApply.u;
    a.tAo.value = t.aoFull.texture;
    // RN-2130: per-channel, so occluded light keeps a sky tint. See AoGlsl.
    const ot = TONE.occTint;
    (a.uStrength.value as THREE.Vector3).set(
      this.tune.aoStrength * ot[0], this.tune.aoStrength * ot[1],
      this.tune.aoStrength * ot[2]);
    a.uPower.value = this.tune.aoPower;
    this.host.setTarget(t.scene);
    this.host.drawFullScreen(this.aoApply.mesh);

    this.calls += 4;
    this.aoRan = true;
    this.timings.ao = performance.now() - t0;
  }

  /** Bloom pyramid, composite, AA. Ends bound to the default framebuffer. */
  finish(): void {
    if (!this.flags.post) return;
    const t = this.targets;
    const tb = performance.now();
    let bloomTex: THREE.Texture = this.black;
    if (this.flags.bloom && t.bloom.length > 0) {
      let src: THREE.Texture = t.scene.texture;
      let sw = t.sizes.w;
      let sh = t.sizes.h;
      for (let i = 0; i < t.bloom.length; ++i) {
        const blit = i === 0 ? this.bloomDownFirst : this.bloomDown;
        blit.u.tSrc.value = src;
        (blit.u.uTexel.value as THREE.Vector2).set(1 / sw, 1 / sh);
        blit.u.uThreshold.value = this.tune.bloomThreshold;
        blit.u.uKnee.value = this.tune.bloomKnee;
        this.host.setTarget(t.bloom[i]);
        this.host.drawFullScreen(blit.mesh);
        src = t.bloom[i].texture;
        sw = t.bloom[i].width;
        sh = t.bloom[i].height;
        this.calls++;
      }
      for (let i = t.bloom.length - 1; i > 0; --i) {
        this.bloomUp.u.tSrc.value = t.bloom[i].texture;
        (this.bloomUp.u.uTexel.value as THREE.Vector2)
          .set(1 / t.bloom[i].width, 1 / t.bloom[i].height);
        this.bloomUp.u.uScatter.value = this.tune.bloomScatter;
        this.host.setTarget(t.bloom[i - 1]);
        this.host.drawFullScreen(this.bloomUp.mesh);
        this.calls++;
      }
      bloomTex = t.bloom[0].texture;
    }
    this.timings.bloom = performance.now() - tb;

    const tc = performance.now();
    const c = this.composite.u;
    c.tScene.value = t.scene.texture;
    c.tBloom.value = bloomTex;
    c.uBloomStrength.value = this.flags.bloom ? this.tune.bloomStrength : 0;
    // RN-2130: exposure, shoulder, warmth and palette in one call, because the
    // art direction is one decision and reads as one in ToneDrive.ts.
    writeToneUniforms(c, this.tune, this.flags.grade);
    const useAa = this.flags.aa;
    this.host.setTarget(useAa ? t.ldr : null);
    this.host.drawFullScreen(this.composite.mesh);
    this.calls++;
    this.timings.composite = performance.now() - tc;

    if (useAa) {
      const ta = performance.now();
      this.aa.u.tDiffuse.value = t.ldr.texture;
      (this.aa.u.resolution.value as THREE.Vector2).set(1 / t.sizes.w, 1 / t.sizes.h);
      this.host.setTarget(null);
      this.host.drawFullScreen(this.aa.mesh);
      this.calls++;
      this.timings.aa = performance.now() - ta;
    }
    this.timings.total = this.timings.ao + this.timings.contact
      + this.timings.underwater + this.timings.bloom + this.timings.composite
      + this.timings.aa;
  }

  get aoApplied(): boolean { return this.aoRan; }
  get contactApplied(): boolean { return this.contactPass.ran; }
  get underwaterApplied(): boolean { return this.underwaterPass.ran; }
  /** Direction TOWARD the sun, world space. Written by `Frame` every frame. */
  get sunWorld(): THREE.Vector3 { return this.contactPass.sunWorld; }

  dispose(): void {
    this.targets.dispose();
    this.contactPass.dispose();
    this.underwaterPass.dispose();
    for (const b of [this.ao, this.aoBlur, this.aoUpsample, this.aoApply,
      this.bloomDown,
      this.bloomDownFirst, this.bloomUp, this.composite, this.aa]) b.dispose();
    this.black.dispose();
  }
}
