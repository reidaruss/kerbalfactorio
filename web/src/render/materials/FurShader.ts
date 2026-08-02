// THE PELT: a rim scatter term, a wind sway and a motion lag, on the ONE
// material the near creatures are drawn with. RN-463 to RN-465.
//
// Reid, on the shell version: "make it more hairy. it looks like its made of
// shiny stone. it should look like it has almost like a fur. very short fur.
// the fur should react to movement and the wind too". The map and the geometry
// answer the first three sentences and are verifiable in Blender. This file
// answers the fourth, and it is NOT verifiable in Blender, because wind and
// motion lag are functions of a clock and a velocity that only exist in the
// running game.
//
// DW-10, STATED BOTH WAYS. This is ONE new live `onBeforeCompile`, taking the
// stack from 4 ShaderMaterial + 2 hooks to 4 + 3 with the flora wind on. It is
// spent, not saved, and the argument is ART-DIRECTION.md's: the ledger is a
// budget with an argument attached. What it buys that no map can:
//
//   1. RIM SCATTER. Short fur reads almost entirely at the SILHOUETTE and at
//      grazing angles, because that is where the line of sight passes through
//      many strands instead of bouncing off one. That is a view-dependent term
//      and a texture is by definition not view-dependent. This is the single
//      largest difference between "matte dark object" and "velvet", and
//      without it the creature is correctly rough and still reads as felt
//      rather than as fur.
//   2. WIND and 3. MOTION LAG are vertex work on geometry that is already
//      being skinned. Nothing outside a vertex shader can move a hair.
//
// WHY NOT EXTEND PropWind. Its hook is `#ifdef USE_BATCHING` and reads
// `batchingMatrix[3].xyz` for the per-instance phase, which is exactly right
// for a BatchedMesh and does not exist on a SkinnedMesh. Its amplitude is also
// linear in height above the prop base, which is the correct model for a plant
// rooted in the ground and the wrong one for hair on a body: fur sways by how
// far it stands off the SURFACE, not by how far it is above the feet. So this
// is the analogue rather than an extension, and it deliberately keeps
// PropWind's three rules: the clock is `Loop.simSecs` so pausing stops the
// breeze, the per-body phase comes from POSITION and never from spawn time so
// a capture reproduces, and one shared function object is assigned to every
// material so three's program cache key (which stringifies onBeforeCompile)
// stays identical and the materials still share one program.
//
// `?fur=0` REMOVES THE HOOK ENTIRELY rather than zeroing its amplitude, so the
// material keeps its stock program and the build is bit-exact to the one
// before this file existed. That is both the negative control and the
// performance isolator, and zeroing a uniform would be neither.
//
// NAMED FAILURE MODES, before anyone measures this: fur that swims while the
// creature stands still is the clock running off a wall timer instead of
// simSecs; fur that pops when a rig is claimed is the phase coming from spawn
// time instead of position; a rim that outlines the creature evenly like a
// cartoon is the noise term dead, because a real fuzzy edge is ragged; and a
// creature that goes black when the sun moves behind it is the rim being added
// to diffuse instead of to outgoing radiance.

// RN-491. The pelt is not the whole creature. A fang is bare keratin and an
// eye is a wet lens, and neither is fur, so both the map and the motion have
// to stop somewhere. `PartMaterial` is the general form of "somewhere": it
// carries the per-part response the merge throws away, and it rides THIS hook
// rather than installing one of its own, so the DW-10 ledger stays at 4 + 3.
// Every fur term below is therefore weighted by `1 - bare`.
import * as THREE from 'three';
import { PART_BARE_GLSL, injectPartMat } from './PartMaterial.js';

const q = new URLSearchParams(self.location.search).get('fur');
/** `?fur=0` removes the hook: stock programs, and the pelt stops moving. It
 *  removes the per-part channel with it, which is correct for a control whose
 *  definition is "this material compiles the stock program". `?partmat=0`
 *  isolates that channel on its own while the pelt keeps running. */
const enabled = q !== '0';
/** Present-or-absent, so the shipped DEFAULT is assertable in its own right
 *  and not inferred from `enabled` (RN-150). */
const flagPresent = q !== null;

/** Metres of sway at the tip of a hair standing fully off the surface. */
const SWAY_M = 0.018;
/** Metres of lag at full run speed. Fur streams back, it does not detach. */
const LAG_M = 0.030;
/** How sharply the rim falls off. Higher is a thinner, tighter edge. */
const RIM_POWER = 2.6;
/** How much radiance the rim adds at full grazing. */
const RIM_GAIN = 0.42;

const uniforms = {
  uFurTime: { value: 0 },
  uFurSway: { value: SWAY_M },
  /** World-space lag vector: the flock's recent motion, negated and scaled. */
  uFurLag: { value: new THREE.Vector3() },
  uFurRim: { value: new THREE.Vector2(RIM_POWER, RIM_GAIN) },
  /** Warm scatter tint. Light through keratin picks up the pigment it passes. */
  uFurTint: { value: new THREE.Color(0.62, 0.47, 0.38) },
};

let frozen = false;
const hooked: string[] = [];

// WHY THE DISPLACEMENT IS DRIVEN BY THE NORMAL AND NOT BY HEIGHT. On a plant,
// "how much does this vertex move" is "how far above the roots is it", because
// the plant is a cantilever anchored at the ground. On a creature the anchor is
// the SKIN, and a hair moves by how far it stands off it. There is no per-vertex
// "distance from the body" attribute and adding one would change the skinning
// payload, so it is INFERRED: the shell geometry is smooth and its normals vary
// slowly, while a hair spike is a three-sided cone whose normals point hard away
// from the body. `furOut` is therefore near 0 on the body and near 1 on a hair,
// for zero extra bytes, and it degrades gracefully (a slightly swaying shell
// edge is invisible at 18 mm; a rigid hair would not be).
const FUR_GLSL = `
{
  vec3 furN = normalize( objectNormal );
  vec3 furR = normalize( transformed - vec3( 0.0, transformed.y * 0.0, 0.0 ) );
  float furOut = clamp( abs( dot( furN, normalize( furR + vec3( 1e-5 ) ) ) ), 0.0, 1.0 );
  furOut = smoothstep( 0.55, 0.98, furOut );
  // A BARE part does not sway. furOut is inferred from the normal, and a
  // fang is a three-sided cone whose normals point hard away from the body,
  // so without this line the one part of the creature that is rigid keratin
  // reads as the FURRIEST thing on it and streams in the wind. That is a
  // latent bug in the shipped build, not a new risk from this pass.
  furOut *= 1.0 - ${PART_BARE_GLSL};
  vec3 furW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  float furPh = dot( modelMatrix[3].xyz, vec3( 0.331, 0.089, 0.397 ) );
  float furT = uFurTime;
  // Two incommensurate harmonics, as the flora hook uses and for the same
  // reason: the sway is signed over any window longer than a few seconds, and
  // no capture pair can land on a still point of a simple loop.
  float furSx = sin( furT * 1.71 + furPh )
              + 0.48 * sin( furT * 2.93 + furPh * 1.41 + 1.9 );
  float furSz = 0.68 * cos( furT * 1.37 + furPh * 0.77 )
              + 0.34 * sin( furT * 3.11 + furPh + 4.2 );
  // The flutter dephases on the vertex's own position, so the pelt shimmers
  // instead of translating as one mass.
  float furFl = sin( furT * 4.3 + furPh + dot( furW.xz, vec2( 2.7, 1.9 ) ) );
  vec3 furSway = uFurSway * furOut
               * ( vec3( furSx, 0.22 * furFl, furSz ) );
  transformed += furSway + uFurLag * furOut;
}
`;

// The rim is added to OUTGOING radiance, after the BRDF has run. Added to
// diffuse it would be multiplied by the light and vanish on the shadow side,
// which is precisely where a fuzzy silhouette is most visible against a bright
// background. The noise breaks the edge so it reads as ragged fuzz rather than
// as a cartoon outline; `vFurNoise` is computed in the vertex stage off world
// position, so it costs one varying and no texture fetch.
const RIM_FRAG = `
{
  float furFres = 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
  float furRim = pow( clamp( furFres, 0.0, 1.0 ), uFurRim.x );
  furRim *= 0.55 + 0.45 * vFurNoise;
  // The rim is the SILHOUETTE SCATTER of many strands. Bare keratin has no
  // strands to scatter through, and a warm fuzzy halo painted around a fang
  // would undo the exact contrast this pass exists to create.
  furRim *= 1.0 - ${PART_BARE_GLSL};
  outgoingLight += uFurTint * ( uFurRim.y * furRim ) * diffuseColor.rgb;
}
`;

function hook(shader: {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string; fragmentShader: string;
}): void {
  shader.uniforms.uFurTime = uniforms.uFurTime;
  shader.uniforms.uFurSway = uniforms.uFurSway;
  shader.uniforms.uFurLag = uniforms.uFurLag;
  shader.uniforms.uFurRim = uniforms.uFurRim;
  shader.uniforms.uFurTint = uniforms.uFurTint;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n'
      + 'uniform float uFurTime;\nuniform float uFurSway;\n'
      + 'uniform vec3 uFurLag;\nvarying float vFurNoise;')
    // AFTER <skinning_vertex>, not after <begin_vertex>. `transformed` is the
    // bind-pose position until skinning has run, so displacing it earlier
    // would move the fur in bind space and the pelt would swim against the
    // animation instead of riding it.
    .replace('#include <skinning_vertex>', '#include <skinning_vertex>' + FUR_GLSL)
    .replace('#include <project_vertex>', '#include <project_vertex>\n'
      + 'vFurNoise = fract( sin( dot( transformed.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n'
      + 'uniform vec2 uFurRim;\nuniform vec3 uFurTint;\nvarying float vFurNoise;')
    .replace('#include <opaque_fragment>', RIM_FRAG + '\n#include <opaque_fragment>');
  // RN-491, and the ORDER IS FREE. Both this function and injectPartMat
  // anchor on `#include <common>` and both put the include BACK, so neither
  // can eat the other's anchor whichever runs first. Splicing here rather
  // than installing a second onBeforeCompile is the whole reason the per-part
  // channel costs no DW-10 slot.
  injectPartMat(shader);
}

/**
 * Hook one creature material. Returns whether it was hooked; the caller does
 * not need to check, because with `?fur=0` this is a no-op and the material
 * keeps its stock program.
 */
export function applyFur(m: THREE.MeshStandardMaterial, tag: string): boolean {
  if (!enabled) return false;
  m.onBeforeCompile = hook;
  m.needsUpdate = true;
  hooked.push(tag);
  return true;
}

/**
 * Per frame, from the flock, on the SIM clock.
 *
 * `speedMps` and `dir` are the flock's own recent motion, not one rig's. THE
 * CHEAP VERSION, DELIBERATELY, and its limit is worth stating rather than
 * discovering: every claimed rig shares one lag vector, so eight creatures
 * running in different directions all stream their fur the same way. Per-rig
 * lag needs a material clone per rig, which costs nothing in draw calls (each
 * rig is already its own mesh) but does need `materialFor` restructured; that
 * is the upgrade if the shared version reads wrong, and it is not built.
 */
export function furUpdate(simSecs: number, dir: THREE.Vector3,
                          speedMps: number): void {
  if (!enabled || frozen) return;
  uniforms.uFurTime.value = simSecs;
  // Fur lags BACKWARD against travel, saturating: at 2.5 m/s it is at about
  // 71% of LAG_M, so a sprinting creature does not tear its own pelt off.
  const k = LAG_M * (1.0 - Math.exp(-speedMps / 2.0));
  uniforms.uFurLag.value.copy(dir).multiplyScalar(-k);
}

/** Freeze for a negative control without changing the program. */
export function furFreeze(on: boolean): void { frozen = on; }

export function furState(): {
  enabled: boolean; flagPresent: boolean; frozen: boolean; hooked: string[];
  swayM: number; lag: [number, number, number]; rimPower: number;
  rimGain: number; time: number;
} {
  const l = uniforms.uFurLag.value;
  return {
    enabled, flagPresent, frozen, hooked: [...hooked],
    swayM: uniforms.uFurSway.value,
    lag: [l.x, l.y, l.z],
    rimPower: uniforms.uFurRim.value.x,
    rimGain: uniforms.uFurRim.value.y,
    time: uniforms.uFurTime.value,
  };
}

// RN-514. THE HANDLE, BECAUSE "PUBLISHED" AND "REACHABLE" ARE DIFFERENT THINGS.
// RN-465 shipped `furStats()` on `SpiderFlock` and recorded that it existed so
// the hook and the `?fur=0` boot default could each be asserted in their own
// right. It was never wired to anything: `SpiderFlock.furStats` is called by no
// file in the repository and no debug surface exposes the flock, so a probe
// could not read one field of it. That is INSTRUMENTS.md's "a tool that reports
// nothing may not be running" in its purest form, since the tool was never
// started at all.
//
// It is registered HERE rather than on the flock, on PropWind's own precedent
// (`__ofWind` is registered in module scope in the file that owns the uniforms),
// and for the same reason: this module owns the one shared uniform record, so it
// is the only place that can reach every hooked material at once. It costs no
// program, no draw call and no uniform.
//
// `freeze` is what makes the WIND measurable. The sway is a function of
// `uFurTime` alone, so two captures at two pinned times differ by the sway and
// by nothing else, which is exactly the technique the flora lane built for
// `__ofWind` and the only way to photograph a motion whose amplitude is 18 mm.
(self as unknown as Record<string, unknown>).__ofFur = {
  state: (): unknown => furState(),
  /** Pin the fur clock. Two calls at two times ARE the matched pair. */
  freeze: (t: number): number => { frozen = true; uniforms.uFurTime.value = t; return t; },
  thaw: (): void => { frozen = false; },
  /** Set the lag vector directly, so "does lag respond to velocity" is a
   *  question about the SHADER rather than about whether a creature happened to
   *  be running when the shutter opened. */
  setLag: (x: number, y: number, z: number): number[] => {
    uniforms.uFurLag.value.set(x, y, z);
    return uniforms.uFurLag.value.toArray();
  },
};
