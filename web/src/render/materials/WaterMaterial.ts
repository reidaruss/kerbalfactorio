// The water ShaderMaterial: DW-10 slot 4, and the wiring that keeps it honest.
//
// EVERY GLOBAL THIS MATERIAL NEEDS IS TAKEN FROM THE TERRAIN MATERIAL BY
// REFERENCE, and that is the whole of the design. The sun direction, the
// atmosphere record, the planet centre in engine space, the sim clock, the
// cascade splits, the ambient and the sky-ambient scale are all uniform OBJECTS
// the near terrain material already owns and Systems.ts already pushes once a
// frame. Sharing them means:
//
//   * no new per-frame push anywhere, and no edit to Systems.ts or Boot.ts;
//   * the pond is lit by exactly the globals the ground around it is lit by, so
//     "the water agrees with the shore" is a property of the object graph rather
//     than something a future lane has to remember to keep in step.
//
// This is DW-22's mechanism (one atmosphere model, held BY REFERENCE by every
// material that uses it) applied to the rest of the frame globals. The lights
// block is the one thing NOT shared: `UniformsUtils.merge` deep-clones and three
// writes the shadow maps and light lists into each material's own slots, so
// water merges its own, exactly as the near and far terrain materials each do.

import * as THREE from 'three';
import type { DepthPolicy } from '../DepthPolicy.js';
import type { AtmosphereUniforms } from './Atmosphere.glsl.js';
import { waterFragmentShader, waterVertexShader } from './WaterShader.js';
import {
  WATER_ALPHA_DEEP, WATER_ALPHA_FULL_M, WATER_ALPHA_SHORE,
  WATER_DEEP_HEX, WATER_SHALLOW_HEX, WATER_SIGMA, WATER_TINT,
} from './WaterOptics.js';

/** Sky-reflection sample counts. The reflected ray escapes, so it is cheap. */
const REFL_VIEW_STEPS = 3;
const REFL_LIGHT_STEPS = 2;

/**
 * Master amplitudes. Each is a multiplier on the authored value, so 0 is off and
 * 1 is as designed, matching `uArtAmp`'s convention exactly.
 */
export const WATER_AMP_DEFAULT = { ripple: 1.0, glint: 1.0, refract: 1.0, foam: 1.0 };

/**
 * x base roughness, y chop (domain-warp gain), z glint clamp, w refraction
 * metres of lateral shift per unit of surface slope per metre of depth.
 *
 * The glint clamp is not cosmetic. GGX at roughness 0.03 peaks near 350, and a
 * peak of 350 through the bloom pyramid downstream is a white star that survives
 * three downsamples. 60 keeps a bright, tight highlight and keeps the pyramid
 * fed with a value it can resolve.
 */
const TUNE_DEFAULT = new THREE.Vector4(0.035, 0.55, 60.0, 0.55);
/** x alphaShore, y alphaDeep, z alphaFullM, w shoreSoftM (refraction path). */
const ALPHA_DEFAULT = new THREE.Vector4(
  WATER_ALPHA_SHORE, WATER_ALPHA_DEEP, WATER_ALPHA_FULL_M, 0.16);
/**
 * x foam depth m, y foam wave gain, z foam noise scale, w refraction full depth m.
 *
 * THE FOAM DEPTH IS 0.10 AND NOT 0.34, AND IT WAS MEASURED RATHER THAN CHOSEN.
 * It bounds a band of DEPTH, and depth converts to distance up the shore through
 * the beach slope: at this pond's 6 degrees, 0.34 m reaches 3.2 m inland and
 * covers most of the lower frame from any standing position, which photographed
 * as a solid white wash over the sand. `?waterfoam=0` is what attributed it,
 * which is the whole reason standing rule 7 asks for one flag per term.
 */
const SHORE_DEFAULT = new THREE.Vector4(0.10, 1.2, 2.6, 1.4);

export interface WaterMaterialOptions {
  readonly depth: DepthPolicy;
  /**
   * The NEAR terrain material. Read for its uniform OBJECTS only; nothing is
   * copied out of it. See the header for why this is a reference and not a
   * parameter list.
   */
  readonly terrain: THREE.ShaderMaterial;
  /** The ONE shared atmosphere record (DW-22). Held, never copied. */
  readonly atmosphere: AtmosphereUniforms;
  /** The pond's tangent basis at its centre, body frame (== engine direction). */
  readonly east: THREE.Vector3;
  readonly north: THREE.Vector3;
  /** Cascade count, so the shadow branch compiles to the same thing terrain has. */
  readonly cascades: number;
}

export interface WaterFlags {
  ripple: number; glint: number; refract: number; foam: number;
}

export interface WaterMaterialHandle {
  readonly material: THREE.ShaderMaterial;
  /** Live amplitudes. Written by the query flags and by `window.__ofWater`. */
  readonly amp: THREE.Vector4;
  /** Bind the grab, or null to fall back to the WG-42 depth-ramp look. */
  setGrab(t: THREE.Texture | null): void;
  /** Per-frame projection facts. Pushed from `onBeforeRender`, never polled. */
  setView(fovYRad: number, aspect: number, bufferHeight: number): void;
  dispose(): void;
}

function ampFromQuery(): THREE.Vector4 {
  const p = new URLSearchParams(self.location.search);
  const num = (k: string, d: number): number => {
    const v = p.get(k);
    const f = v === null ? NaN : Number(v);
    return Number.isFinite(f) ? f : d;
  };
  return new THREE.Vector4(
    p.get('waterripple') === '0' ? 0 : num('rippleamp', WATER_AMP_DEFAULT.ripple),
    p.get('waterglint') === '0' ? 0 : num('glintamp', WATER_AMP_DEFAULT.glint),
    p.get('waterrefract') === '0' ? 0 : num('refractamp', WATER_AMP_DEFAULT.refract),
    p.get('waterfoam') === '0' ? 0 : num('foamamp', WATER_AMP_DEFAULT.foam),
  );
}

export function createWaterMaterial(o: WaterMaterialOptions): WaterMaterialHandle {
  const tu = o.terrain.uniforms;
  const amp = ampFromQuery();
  // The refraction amplitude the SHADER sees. It is the authored amplitude
  // gated by whether a grab exists at all, so a build with no grab (post off, or
  // MSAA on, or the pond off screen on the very first frame) falls back to the
  // WG-42 depth ramp instead of sampling a texture that is not there. Kept
  // apart from `amp` so `__ofWater.state()` can report the two separately and a
  // zero can be ATTRIBUTED, which is RN-48's rule about `wetCells: 0`.
  const live = new THREE.Vector4().copy(amp);

  const uniforms: Record<string, THREE.IUniform> =
    THREE.UniformsUtils.merge([THREE.UniformsLib.lights]);
  // SHARED BY REFERENCE. Not copies. See the header.
  //
  // The atmosphere record arrives as ONE object rather than as a list of names,
  // exactly as `createTerrainMaterials` takes it, so a uniform added to the
  // shared model reaches this material with no edit here. Assigning it AFTER
  // the lights merge is mandatory and is the same trap DW-22 records:
  // `UniformsUtils.merge` deep-clones, so anything merged stops being shared.
  Object.assign(uniforms, o.atmosphere, {
    uBodyCenter: tu.uBodyCenter, uTime: tu.uTime, uCascadeFar: tu.uCascadeFar,
    uAmbient: tu.uAmbient, uSkyAmbient: tu.uSkyAmbient,
  });
  Object.assign(uniforms, {
    uWaterAmp: { value: live },
    uPlaneE: { value: o.east.clone() },
    uPlaneN: { value: o.north.clone() },
    uPixelScale: { value: 0.002 },
    uInvViewSpan: { value: new THREE.Vector2(0.9, 0.9) },
    tGrab: { value: null },
    uSigma: { value: new THREE.Vector3(...WATER_SIGMA) },
    uTintDeep: { value: new THREE.Vector3(...WATER_TINT) },
    uShallow: { value: new THREE.Color(WATER_SHALLOW_HEX) },
    uDeep: { value: new THREE.Color(WATER_DEEP_HEX) },
    uWaterTune: { value: TUNE_DEFAULT.clone() },
    uWaterAlpha: { value: ALPHA_DEFAULT.clone() },
    uWaterShore: { value: SHORE_DEFAULT.clone() },
  });

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: waterVertexShader(o.depth),
    fragmentShader: waterFragmentShader(o.depth),
    defines: {
      OF_CASCADES: o.cascades,
      OF_W_VIEW: REFL_VIEW_STEPS,
      OF_W_LIGHT: REFL_LIGHT_STEPS,
    },
    lights: true,
    transparent: true,
    // DoubleSide so the surface is still there when the camera goes under it.
    // Without it, swimming would look exactly like walking through a hole.
    side: THREE.DoubleSide,
    // Off, so the pond bed and anything standing in the water still draw. This
    // is the one sorting compromise in the file and it is the standard one for a
    // single translucent layer.
    depthWrite: false,
  });
  material.name = 'Water';

  const setGrab = (t: THREE.Texture | null): void => {
    uniforms.tGrab.value = t;
    live.z = t === null ? 0 : amp.z;
  };
  setGrab(null);

  (self as unknown as Record<string, unknown>).__ofWater = {
    set(ripple: number, glint: number, refract: number, foam: number): void {
      amp.set(ripple, glint, refract, foam);
      live.set(ripple, glint, uniforms.tGrab.value === null ? 0 : refract, foam);
    },
    reset(): void {
      const d = WATER_AMP_DEFAULT;
      amp.set(d.ripple, d.glint, d.refract, d.foam);
      live.set(d.ripple, d.glint,
        uniforms.tGrab.value === null ? 0 : d.refract, d.foam);
    },
    tune(k: string, v: number): number {
      const map: Record<string, [THREE.Vector4, 'x' | 'y' | 'z' | 'w']> = {
        rough: [uniforms.uWaterTune.value as THREE.Vector4, 'x'],
        chop: [uniforms.uWaterTune.value as THREE.Vector4, 'y'],
        glintmax: [uniforms.uWaterTune.value as THREE.Vector4, 'z'],
        refractm: [uniforms.uWaterTune.value as THREE.Vector4, 'w'],
        shoresoft: [uniforms.uWaterAlpha.value as THREE.Vector4, 'w'],
        foamdepth: [uniforms.uWaterShore.value as THREE.Vector4, 'x'],
        foamwave: [uniforms.uWaterShore.value as THREE.Vector4, 'y'],
        foamnoise: [uniforms.uWaterShore.value as THREE.Vector4, 'z'],
        refractfull: [uniforms.uWaterShore.value as THREE.Vector4, 'w'],
      };
      const e = map[k];
      if (e === undefined) return NaN;
      e[0][e[1]] = v;
      return v;
    },
    state(): unknown {
      return {
        // The AUTHORED amplitudes and the ones the shader actually got. A
        // refraction reading of 0 in `live` with 1 in `amp` says the grab is
        // missing, which is a different fault from the term being switched off.
        amp: amp.toArray(), live: live.toArray(),
        grab: uniforms.tGrab.value !== null,
        tune: (uniforms.uWaterTune.value as THREE.Vector4).toArray(),
        alpha: (uniforms.uWaterAlpha.value as THREE.Vector4).toArray(),
        shore: (uniforms.uWaterShore.value as THREE.Vector4).toArray(),
      };
    },
  };

  return {
    material,
    amp,
    setGrab,
    setView(fovYRad, aspect, bufferHeight) {
      const tanHalf = Math.tan(fovYRad * 0.5);
      uniforms.uPixelScale.value = (2 * tanHalf) / Math.max(1, bufferHeight);
      const s = 1 / Math.max(1e-6, 2 * tanHalf);
      (uniforms.uInvViewSpan.value as THREE.Vector2)
        .set(s / Math.max(1e-3, aspect), s);
    },
    dispose() { material.dispose(); },
  };
}
