// The carpet's material, one per rung. RN-2145.
//
// It borrows, BY REFERENCE, every uniform that decides how the ground is lit:
// the atmosphere record, the planet centre, the cascade splits, the shared
// ambient floor and the shared sky-ambient weight. That is WaterMaterial's own
// pattern (RN-52/RN-53) and it is here for a stronger reason than symmetry:
// lane A1 measured that the props' fill path never sees the sky ambient at all,
// so a carpet lit through it would sit in the old grey floor while the terrain
// under it wore A1's sky tint. Borrowing the objects rather than the numbers is
// what makes "cover and substrate cannot disagree" structural.
//
// `UniformsUtils.merge` DEEP-CLONES, so the shared objects are assigned AFTER
// the lights merge or they stop being shared. DW-22's trap, WaterMaterial's
// note, repeated here because it is silent when you get it wrong.

import * as THREE from 'three';
import type { DepthPolicy } from '../DepthPolicy.js';
import type { AtmosphereUniforms } from '../materials/Atmosphere.glsl.js';
import { surfaces } from '../instancing/SurfaceBind.js';
import { windUniforms } from '../instancing/PropWind.js';
import { EMIT_UNIFORMS } from '../materials/EmissiveLight.js';
import { grassFragmentShader, grassVertexShader } from './GrassGlsl.js';
import { FADE_PX_HI, FADE_PX_LO, GROW_M, GROW_MAX } from './GrassTuning.js';

export interface GrassRungUniforms {
  /** x instances per m2 at the eye, y the falloff half-distance. A half of
   *  1e9 makes the rung FLAT, which is how the far rung is expressed without a
   *  second code path. */
  densK: THREE.Vector2;
  /** Metres: fade IN lo, hi. (-2, -1) means "already in". */
  inM: THREE.Vector2;
  /** Metres: hand OVER lo, hi. (1e8, 1e9) means "never hands over". */
  outM: THREE.Vector2;
  /** Sway amplitude multiplier on PropWind's shared metre amplitude. */
  windGain: number;
}

export interface GrassMaterialOptions {
  readonly depth: DepthPolicy;
  /** The NEAR terrain material, for the uniform objects the ground is lit by. */
  readonly terrain: THREE.ShaderMaterial;
  readonly atmosphere: AtmosphereUniforms;
  readonly cascades: number;
  readonly rung: GrassRungUniforms;
  readonly name: string;
}

/** A page number, with RN-150's rule: a MISSING parameter is missing, not 0. */
function numQ(name: string, dflt: number): number {
  const v = new URLSearchParams(self.location.search).get(name);
  const f = v === null ? NaN : Number(v);
  return Number.isFinite(f) ? f : dflt;
}

/** Translucency: x wrap width, y forward-scatter gain, z tip value lift.
 *  `?grasstrans=0` removes all three, which is the isolator for "is the glow
 *  this term or is it the grade". */
function transFromQuery(): THREE.Vector3 {
  const p = new URLSearchParams(self.location.search);
  if (p.get('grasstrans') === '0') return new THREE.Vector3(0, 0, 0);
  const v = p.get('grasstransamp');
  const f = v === null ? NaN : Number(v);
  const k = Number.isFinite(f) ? f : 1;
  return new THREE.Vector3(0.55, 0.42 * k, 0.22);
}

export interface GrassMaterialHandle {
  readonly material: THREE.ShaderMaterial;
  /** Push the camera's pixels-per-radian. Called once per frame. */
  setPxPerRad(v: number): void;
  /** Bind the texgen grass card once `surfacesReady()` has resolved. Returns
   *  false if the family is missing, which is a loud condition and not a
   *  fallback: a carpet with no card is a field of untextured quads. */
  bindCard(): boolean;
  cardBound(): boolean;
}

export function createGrassMaterial(o: GrassMaterialOptions): GrassMaterialHandle {
  const tu = o.terrain.uniforms;
  const wind = windUniforms();

  const uniforms: Record<string, THREE.IUniform> =
    THREE.UniformsUtils.merge([THREE.UniformsLib.lights]);
  // SHARED BY REFERENCE, after the merge. See the header.
  Object.assign(uniforms, o.atmosphere, {
    uBodyCenter: tu.uBodyCenter,
    uCascadeFar: tu.uCascadeFar,
    uAmbient: tu.uAmbient,
    uSkyAmbient: tu.uSkyAmbient,
    // PropWind's own objects, so the carpet and the crowns share one clock and
    // one amplitude and `__ofWind.freeze` pins both for a matched pair.
    uWindTime: wind.uWindTime,
    uWindAmp: wind.uWindAmp,
  });
  // RN-2735. THE SAME EMISSIVE BUNDLE THE TERRAIN TAKES, on this file's own
  // header rule ("cover and substrate cannot disagree") applied to the fire
  // the way it was already applied to the sky: `EMIT_UNIFORMS` is
  // EmissiveLight.ts's one set of emitter holders (the same four objects the
  // machine programs and the terrain read), and `tu.uEmitGround` is NOT a
  // second `emitGroundFromQuery()` read -- it is TerrainProgram.ts's own
  // `uEmitGround` object, taken off the terrain material this rung was built
  // beside. `?firelightground=0` therefore stays a COMPLETE kill of the ground
  // term: there is one flag value, shared by reference, not two switches that
  // happen to agree today. Assigned unconditionally, on `EMIT_UNIFORMS`'s own
  // precedent in TerrainProgram.ts: the entries go nowhere when
  // `?firelight=off` compiles the declaration out of GrassGlsl's program, and
  // an unused uniform is free rather than a branch to avoid.
  Object.assign(uniforms, EMIT_UNIFORMS);
  uniforms.uEmitGround = tu.uEmitGround;
  Object.assign(uniforms, {
    uCard: { value: null as THREE.Texture | null },
    uAlphaTest: { value: 0.35 },
    uCardMean: { value: 1 },
    // `?grasssharp=1` is the exact control: it makes the rescale the identity,
    // so the arm is the raw alpha comparison the props take.
    uSharp: { value: ((): number => {
      const v = new URLSearchParams(self.location.search).get('grasssharp');
      const f = v === null ? NaN : Number(v);
      return Number.isFinite(f) ? f : 3.2;
    })() },
    uPxPerRad: { value: 779.4 },
    uFadePx: { value: new THREE.Vector2(FADE_PX_HI, FADE_PX_LO) },
    uGrow: { value: new THREE.Vector2(GROW_M, GROW_MAX) },
    uDensK: { value: o.rung.densK.clone() },
    uIn: { value: o.rung.inM.clone() },
    uOut: { value: o.rung.outM.clone() },
    // ZERO WHEN THE HOOK IS OFF. `?wind=0` removes PropWind's hook, which stops
    // the props but cannot stop a ShaderMaterial that reads the shared clock
    // directly; the carpet has to opt out itself or the flag is not a control.
    // See PropWind.windUniforms for the measurement that found this.
    uWindGain: { value: wind.enabled ? o.rung.windGain : 0 },
    uTrans: { value: transFromQuery() },
    // THE LEAN AND THE RAMP, both swept by one flag each because both are look
    // terms judged on a frame rather than derived from anything.
    // `?grasslean=0` stands every card dead vertical, which is the exact
    // pre-lean state and the before half of that pair; `?grassramp=0` flattens
    // the root-to-tip value ramp to 1.0 at both ends, likewise.
    uLean: { value: new THREE.Vector2(0.30, 0.34)
      .multiplyScalar(numQ('grasslean', 1)) },
    uRamp: { value: numQ('grassramp', 1) === 0
      ? new THREE.Vector2(1, 1)
      : new THREE.Vector2(1 - 0.50 * numQ('grassramp', 1),
        1 + 0.30 * numQ('grassramp', 1)) },
    // RN-2220. 0.7 by eye against the meadow pose (enough bend that the carpet
    // reads lit rather than upright-and-dim, not so much that the tuft's own
    // facet disappears) and by the forestfloor box (closes the 6.6 per cent
    // residual; see GrassGlsl's note at its one use). `?grassbend=0` is the
    // exact pre-RN-2220 control (mix identity, GrassGlsl's `ns` becomes `n`).
    uBendUp: { value: numQ('grassbend', 0.7) },
  });

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: grassVertexShader(o.depth),
    fragmentShader: grassFragmentShader(o.depth),
    defines: { OF_CASCADES: o.cascades },
    lights: true,
    // DoubleSide because a card has no back: the bent normal points up on both
    // faces (GrassGlsl's note), so there is no wrong side to hide.
    side: THREE.DoubleSide,
  });
  material.name = o.name;

  let bound = false;
  return {
    material,
    setPxPerRad(v: number): void { uniforms.uPxPerRad.value = v; },
    cardBound(): boolean { return bound; },
    bindCard(): boolean {
      const s = surfaces.get('grass');
      if (s === undefined || s.albedo === undefined) return false;
      // D-016's refusal, applied here for the same reason SurfaceBind applies
      // it: a card with no valid mean would silently darken the whole carpet by
      // the card's own average, and it would read as a lighting bug nobody
      // could trace back to a manifest field.
      if (!(s.albedoMean !== undefined && s.albedoMean > 0)) {
        throw new Error('[of] grass: the grass family has an albedo map but no '
          + `valid albedo_mean_linear (got ${String(s.albedoMean)}).`);
      }
      uniforms.uCard.value = s.albedo;
      uniforms.uCardMean.value = 1 / s.albedoMean;
      uniforms.uAlphaTest.value = s.alphaTest ?? 0.35;
      material.needsUpdate = true;
      bound = true;
      return true;
    },
  };
}
