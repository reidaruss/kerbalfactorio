// ONE shared ShaderMaterial for every chunk in both scenes. Same program, same
// uniforms, so chunks batch trivially and the shader cache never thrashes; the
// far-scene variant is the same source with #define OF_SCALED, not a second
// material (ARCHITECTURE.md section 4.4).
//
// Per-chunk state is ZERO. Everything that varies per chunk arrives in the
// aBiome / aHeight / aFadeT0 attributes, which is what lets one material serve
// 250 meshes without a clone or a per-draw uniform push.
//
// The GLSL lives in TerrainShader.ts.

import * as THREE from 'three';
import type { DepthPolicy } from '../DepthPolicy.js';
import type { AtmosphereUniforms } from './Atmosphere.glsl.js';
import { biomeColorArray } from './BiomePalette.js';
import { terrainFragmentShader, terrainVertexShader } from './TerrainShader.js';
import { FAR_SCALE } from '../Scenes.js';

// ?side= overrides this for a one-off diagnosis; the committed default is what
// the winding actually needs (see SharedIndex).
const TERRAIN_SIDE = ((): THREE.Side => {
  const s = new URLSearchParams(self.location.search).get('side');
  if (s === 'double') return THREE.DoubleSide;
  if (s === 'back') return THREE.BackSide;
  return THREE.FrontSide;
})();

/**
 * Aerial-perspective sample counts. Far cheaper than the sky quad: the segment
 * is short and nearly iso-altitude, so 4 x 2 is already smooth.
 */
const AP_VIEW_STEPS = 4;
const AP_LIGHT_STEPS = 2;

/**
 * SURFACE ART amplitudes (RN-45): macro colour variation, detail bump, rock
 * strata. See TerrainArt.glsl.ts for what each one is and why.
 *
 * Isolation is BOTH a query flag and a runtime handle, deliberately, because
 * the two answer different questions and RN-30 showed the second is the
 * stronger instrument. `?terrainart=0` and the three per-term flags give
 * standing rule 7's one-binary control over a whole session. `__ofTerrainArt`
 * lets a probe toggle a term between two SETTLED FRAMES, which holds the
 * camera, the sun, the streamed chunk set and the scatter equal by
 * construction rather than by care, and that is what makes a before/after
 * attributable to the term instead of to the run.
 *
 * Defaults are not tuned to taste. Macro 1.0 is the field's authored
 * amplitude; strata 1.0 is full bedding. Each is a multiplier ON those, so 0
 * is off and 1 is as designed.
 *
 * THE DETAIL BUMP IS BACK ON AT RN-50, on a different coordinate. Everything
 * below is the RN-45 measurement that took it OUT, kept because it is the
 * reason the term is keyed on the chunk UV rather than on planet-centred
 * metres, and because it generalises to any future screen-derivative effect on
 * a 600 km body. The artefact and the arithmetic are unchanged; what changed is
 * that the height field no longer reads a coordinate carrying a planet-scale
 * quantum. See TerrainShader's note at the ofArtBump call.
 *
 * WHAT RN-45 MEASURED AND WHY THE TERM WAS DISABLED: It is left in the build, reachable with
 * `?bumpamp=1`, because the measurement is the deliverable and the next person
 * to reach for a screen-derivative effect on this planet needs to be able to
 * reproduce it in one flag.
 *
 * WHAT HAPPENS: a field of concentric moire arcs across the ground within
 * about fifteen metres of the eye (`docs/screenshots/RN45_iso_bump.png`). No
 * number in the probe saw it. It moved 35% of the near band with a healthy
 * peak, which is exactly what a working bump would do.
 *
 * WHY, and it is arithmetic rather than tuning. A screen-derivative bump needs
 * the height field's ARGUMENT to change between adjacent pixels. The argument
 * is planet-centred metres, which is float32 and about 6e5 at Forge's surface,
 * so one ULP is 2^(19-23) = 0.0625 m. The ground under the player is seen at a
 * shallow depression angle, and at the pinned camera one pixel covers 4.3 mm of
 * ground at 2 m and 21.5 mm at 5 m. The quantum is 3 to 15 times the pixel
 * footprint, so whole runs of adjacent pixels sample the SAME quantised
 * position, `dFdx` of the field is exactly zero across them, and it steps at
 * the quantisation boundaries. Those boundaries are surfaces of constant range
 * from the eye, which is why the artefact is a set of arcs centred on the
 * player rather than noise.
 *
 * WHY IT IS NOT FIXABLE BY FADING: the term only becomes well conditioned once
 * the footprint clears the quantum, which is about 20 m (footprint 5 ULP), and
 * it starts aliasing its own 4.2 m octave once the footprint passes a third of
 * that wavelength, which is about 45 m. A twenty-five metre annulus is a band
 * of ground, not a surface treatment, and a bump that exists only in a ring
 * around the player is worse than no bump.
 *
 * WHAT WOULD FIX IT, stated so it is a dependency and not a shrug: the height
 * field needs a high-precision position, which means a per-chunk phase reduced
 * modulo the octave period on the CPU in float64 (where it is exact) and
 * carried alongside the integer cell index, so the shader adds a small local
 * offset to a small local coordinate and never forms a 6e5 intermediate. That
 * is a terrain-chunk format change and therefore world-gen's, not this lane's.
 * Note the macro colour term is UNAFFECTED and ships on: it reads the field's
 * VALUE, where 0.0625 m against an 11.9 m finest octave is 0.5% of a
 * wavelength, and only the DERIVATIVE is destroyed by the quantisation.
 */
const ART_DEFAULT = { macro: 1.0, bump: 1.0, strata: 1.0 };

function artAmpFromQuery(): THREE.Vector3 {
  const p = new URLSearchParams(self.location.search);
  const num = (k: string, d: number): number => {
    const v = p.get(k);
    const f = v === null ? NaN : Number(v);
    return Number.isFinite(f) ? f : d;
  };
  const all = p.get('terrainart') === '0' ? 0 : 1;
  return new THREE.Vector3(
    all * (p.get('macrovar') === '0' ? 0 : num('macroamp', ART_DEFAULT.macro)),
    all * (p.get('terrainbump') === '0' ? 0 : num('bumpamp', ART_DEFAULT.bump)),
    all * (p.get('strata') === '0' ? 0 : num('strataamp', ART_DEFAULT.strata)),
  );
}

/**
 * WHAT THE GROUND NEEDS TO KNOW ABOUT WATER, and it is deliberately the least
 * that will do (RN-57): a direction, two radii and a height. It is NOT a
 * WaterOracle and it is NOT `depthAt`. The ground does not ask where the water
 * is per fragment, because that would be a second consumer of the water
 * authority inside a shader, which is the DW-26 trap by another route. It is
 * handed the pond's published disc once at boot, and it darkens a band.
 */
export interface TerrainWaterBand {
  /** Unit direction of the pond centre, body frame. */
  readonly dirX: number; readonly dirY: number; readonly dirZ: number;
  /** The water surface, METRES ABOVE THE DATUM, i.e. the same frame as aHeight. */
  readonly levelM: number;
  readonly shorelineM: number;
}

/**
 * The height in metres over which ground above the waterline dries out. 0.55 m
 * is capillary rise plus the ripple's own reach, and it is generous rather than
 * physical: the shipped terrain LOD is 1.8 m under the player, so a band much
 * tighter than half a metre would be thinner than the triangles carrying it and
 * would read as a jagged outline of the mesh rather than as a wet margin.
 */
const WET_HEIGHT_M = 0.55;

function wetBandFromQuery(w: TerrainWaterBand | null): THREE.Vector4 {
  if (w === null) return new THREE.Vector4(0, 1, WET_HEIGHT_M, 0);
  const p = new URLSearchParams(self.location.search);
  const raw = Number(p.get('wetsandamp'));
  const amp = p.get('wetsand') === '0' ? 0 : (Number.isFinite(raw) ? raw : 1);
  return new THREE.Vector4(w.levelM, w.shorelineM, WET_HEIGHT_M, amp);
}

export interface TerrainMaterialOptions {
  readonly depth: DepthPolicy;
  readonly maxReliefM: number;
  /** The pond, or null on a dry body. See TerrainWaterBand. */
  readonly water: TerrainWaterBand | null;
  readonly atmosphere: AtmosphereUniforms;
  /** Cascade far planes in metres; the length is the cascade count. */
  readonly cascadeSplits: number[];
  readonly fadeSecs: number;
}

export interface TerrainMaterials {
  readonly near: THREE.ShaderMaterial;
  readonly far: THREE.ShaderMaterial;
  /** Push the per-frame globals. Per-chunk uniform state stays at zero. */
  update(bodyCenterEngine: THREE.Vector3, simTimeSecs: number): void;
  dispose(): void;
}

export function createTerrainMaterials(o: TerrainMaterialOptions): TerrainMaterials {
  const palette = biomeColorArray();
  // ONE Vector3 shared by both materials by reference, on the atmosphere's own
  // precedent (see the merge note below): a runtime toggle that reached the
  // near material and not the far one would be a second authority on how the
  // ground looks, which is the exact bug class this file already guards.
  const artAmp = artAmpFromQuery();
  // The wet band, likewise ONE object shared by both materials by reference so
  // a runtime tweak cannot reach one and not the other. The amplitude is zero on
  // a dry body, which is what makes `ofArtWet` return on its first line and cost
  // the fragment a compare rather than two lengths.
  const wetBand = wetBandFromQuery(o.water);
  const wetDir = new THREE.Vector3(
    o.water?.dirX ?? 0, o.water?.dirY ?? 1, o.water?.dirZ ?? 0);
  const cascades = o.cascadeSplits.length;
  const splits = new THREE.Vector3(
    o.cascadeSplits[0] ?? 1, o.cascadeSplits[1] ?? 1, o.cascadeSplits[2] ?? 1,
  );

  const make = (scaled: boolean): THREE.ShaderMaterial => {
    // UniformsLib.lights is MANDATORY for a lights:true ShaderMaterial: three
    // writes ambientLightColor / directionalLights / directionalShadowMap
    // straight into material.uniforms and throws if the slots are missing.
    const uniforms: Record<string, THREE.IUniform> =
      THREE.UniformsUtils.merge([THREE.UniformsLib.lights]);
    // Assigned AFTER the merge on purpose: merge deep-clones, and the atmosphere
    // uniforms must stay the SAME OBJECTS the sky material holds. Sharing by
    // reference is what makes "the sky and the horizon agree" structural rather
    // than something someone has to remember to synchronise.
    Object.assign(uniforms, o.atmosphere, {
      uBodyCenter: { value: new THREE.Vector3(0, 0, 0) },
      uMaxRelief: { value: o.maxReliefM },
      uBiomeColor: { value: palette },
      uAmbient: { value: new THREE.Color(0.030, 0.034, 0.045) },
      uTime: { value: 0 },
      uFadeDur: { value: o.fadeSecs },
      uMetresPerUnit: { value: scaled ? 1 / FAR_SCALE : 1 },
      uCascadeFar: { value: splits },
      uSkyAmbient: { value: 0.32 },
      uArtAmp: { value: artAmp },
      uWetBand: { value: wetBand },
      uWetDir: { value: wetDir },
    });
    const m = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: terrainVertexShader(o.depth),
      fragmentShader: terrainFragmentShader(o.depth),
      // HAS_NORMAL is NOT set here: WebGLProgram already emits it for any
      // material whose geometry has a normal attribute, and defining it twice is
      // a hard compile failure. shadowmap_vertex reads it to decide whether to
      // apply the normal bias, so it must come from three, not from us.
      defines: {
        OF_CASCADES: scaled ? 0 : cascades,
        OF_AP_VIEW: AP_VIEW_STEPS,
        OF_AP_LIGHT: AP_LIGHT_STEPS,
        ...(scaled ? { OF_SCALED: 1 } : {}),
      },
      lights: true,
      side: TERRAIN_SIDE,
    });
    m.name = scaled ? 'TerrainMaterial(scaled)' : 'TerrainMaterial';
    return m;
  };

  const near = make(false);
  const far = make(true);
  // The runtime handle, on the `window.__ofSurfaces` / `window.__ofAtmos`
  // precedent. It writes the SHARED vector, so there is no path by which the
  // two materials can disagree, and it needs no uniform push because three
  // uploads a ShaderMaterial's uniforms every frame.
  (self as unknown as Record<string, unknown>).__ofTerrainArt = {
    set(macro: number, bump: number, strata: number): void {
      artAmp.set(macro, bump, strata);
    },
    get(): [number, number, number] { return [artAmp.x, artAmp.y, artAmp.z]; },
    reset(): void {
      artAmp.set(ART_DEFAULT.macro, ART_DEFAULT.bump, ART_DEFAULT.strata);
    },
    // RN-57. Same handle rather than a second one, because the wet band is a
    // terrain art term and a probe toggling it wants the SAME settled-frame
    // instrument RN-45 built for the other three.
    setWet(amp: number): number { wetBand.w = amp; return amp; },
    getWet(): [number, number, number, number] { return wetBand.toArray(); },
  };
  return {
    near,
    far,
    update(bodyCenterEngine, simTimeSecs) {
      (near.uniforms.uBodyCenter.value as THREE.Vector3).copy(bodyCenterEngine);
      // The far scene puts the body centre at the scaled origin, always.
      (far.uniforms.uBodyCenter.value as THREE.Vector3).set(0, 0, 0);
      near.uniforms.uTime.value = simTimeSecs;
      far.uniforms.uTime.value = simTimeSecs;
    },
    dispose() { near.dispose(); far.dispose(); },
  };
}
