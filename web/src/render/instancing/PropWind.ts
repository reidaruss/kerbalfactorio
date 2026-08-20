// WIND: a vertex-stage sway for foliage, injected into the EXISTING batch
// materials through one shared onBeforeCompile. RN-96 to RN-99.
//
// WHY A HOOK AND NOT A MATERIAL, WHICH IS THE DW-10 ARGUMENT (RN-52's shape).
// A sway moves VERTICES, so a post pass cannot do it (post has pixels, not
// geometry), and no existing custom shader draws a single foliage triangle
// (terrain, sky, stars, water; the one live onBeforeCompile is the machines').
// Replacing the foliage materials with a ShaderMaterial would buy nothing and
// forfeit everything: three's lighting, the shadow receive path, the batching
// chunks and the Surfaces map bindings all come with MeshStandardMaterial, and
// a hand-rolled copy of them is exactly the second-authority failure this
// project keeps paying for. So: one function, assigned to the eight foliage
// prop batch materials and the harvest trees' leaf batch, touching ONLY the
// vertex stage. The fragment stage stays stock. The ledger reads
// 4 ShaderMaterial + 2 live onBeforeCompile with this on, 4 + 1 with ?wind=0,
// because with the flag off the hook is never assigned and the program set is
// the stock one, which is what makes the flag a true negative control.
//
// WHERE THE AMPLITUDE COMES FROM. `position.y` in the batched geometry is
// metres above the prop's own base: both normalize() paths apply the node's
// world matrix before batching and every prop is authored ground-pivoted, so
// y = 0 IS the ground contact. The displacement is zero there BY CONSTRUCTION,
// which retires the classic failure "the grass detaches from the ground
// plane" before any measurement is taken. The other classic, "the whole tree
// slides", is retired by the trunks never being hooked at all: bark is not
// foliage (`isFoliageMaterial`), so trunks are rigid and only crowns move.
//
// WHY THE PHASE IS POSITION, NOT TIME-OF-SPAWN. The per-instance phase is a
// dot product on the batching matrix's translation, so the same instance at
// the same sim time is the same pose, and a probe's matched pair cannot be
// broken by when a chunk happened to stream in. The one caveat, recorded
// rather than hidden: the translation is ENGINE space, which rebases when the
// floating origin steps (every 4 km of travel), so a rebase re-seeds phases.
// A phase is not a position; nothing pops, the field just re-decorrelates.
//
// TIME is sim seconds, pushed by Systems.ts beside TerrainMaterials.update,
// so wind pauses when the sim pauses, exactly as the water does. The uniform
// OBJECTS are shared by reference across every hooked material, so one write
// reaches all of them and `__ofWind.set` needs no material list.

import type * as THREE from 'three';
import { injectPropSkyAmbient } from '../materials/PropSkyAmbient.js';

/** Tip displacement scale in metres. Peak per-axis excursion is ~1.5x this. */
const AMP_M = 0.045;
/** Metres of extra reach per metre above 1 m: crowns drift, they do not thrash.
 *  At 12 m (a canopy crown top) the reach is 2.65, i.e. ~18 cm peak, which is
 *  the same order as the authored (and unread) Tree_Sway clip's 17 cm. */
const TREE_K = 0.15;

const q = new URLSearchParams(self.location.search);
/** ?wind=0 removes the hook entirely: stock programs, static build. */
const enabled = q.get('wind') !== '0';
const ampQ = Number.parseFloat(q.get('windamp') ?? '');

const uniforms = {
  uWindTime: { value: 0 },
  uWindAmp: { value: AMP_M * (Number.isFinite(ampQ) ? ampQ : 1) },
  uWindTree: { value: TREE_K },
};
let frozen = false;
const hooked: string[] = [];

// Two incommensurate harmonics per axis plus a per-vertex flutter term. The
// harmonics make the sway BIDIRECTIONAL over any window longer than ~5 s
// (sin is signed), which is the property the probe asserts; incommensurate
// frequencies keep a capture pair from ever landing on a still point of a
// simple loop. The flutter dephases on the vertex's own position inside the
// prop, so a crown shimmers instead of translating as one rigid mass.
// NO NORMAL ADJUSTMENT: at <=18 cm of excursion on metre-scale geometry the
// lighting error is below anything the eye or the tile means resolve, and
// the shadow pass is NOT hooked either, so cast shadows are static. Both are
// stated limits, not oversights.
const WIND_GLSL = `
#ifdef USE_BATCHING
{
  float windH = max( transformed.y, 0.0 );
  float windReach = min( windH, 1.0 ) + uWindTree * max( windH - 1.0, 0.0 );
  vec3 windOrg = batchingMatrix[3].xyz;
  float windPh = dot( windOrg, vec3( 0.331, 0.089, 0.397 ) );
  float windT = uWindTime;
  float windSx = sin( windT * 1.31 + windPh )
               + 0.52 * sin( windT * 2.17 + windPh * 1.41 + 1.9 );
  float windSz = 0.71 * cos( windT * 1.09 + windPh * 0.77 )
               + 0.37 * sin( windT * 2.53 + windPh + 4.2 );
  float windFl = sin( windT * 3.1 + windPh + dot( transformed.xz, vec2( 1.83, 1.31 ) ) );
  vec2 windSway = uWindAmp * windReach
                * ( vec2( windSx, windSz ) + 0.22 * windFl * vec2( 0.7, -0.6 ) );
  transformed.x += windSway.x;
  transformed.z += windSway.y;
}
#endif
`;

function hook(shader: { uniforms: Record<string, { value: unknown }>;
                       vertexShader: string; fragmentShader: string }): void {
  shader.uniforms.uWindTime = uniforms.uWindTime;
  shader.uniforms.uWindAmp = uniforms.uWindAmp;
  shader.uniforms.uWindTree = uniforms.uWindTree;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n'
      + 'uniform float uWindTime;\nuniform float uWindAmp;\nuniform float uWindTree;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>' + WIND_GLSL);
  // RN-2201, CHAINED not replaced, on FurShader's precedent. A material holds
  // ONE `onBeforeCompile`, and every foliage prop and every leaf node batch
  // already spends it here, so the sky-ambient term can only reach the surfaces
  // that most need it (the meadow's near ground IS props) by being called from
  // inside this one. This hook owns the VERTEX stage and that one owns the
  // FRAGMENT stage, so they cannot eat each other's anchors.
  injectPropSkyAmbient(shader as unknown as
    { uniforms: Record<string, THREE.IUniform>; fragmentShader: string });
}

/**
 * Hook one batch material. Returns whether it was hooked, and the caller does
 * not need to check: with `?wind=0` this is a no-op and the material keeps its
 * stock program. ONE shared function object is assigned everywhere, so three's
 * program cache key (which stringifies onBeforeCompile) is identical across
 * all hooked materials and same-state materials still share one program.
 */
export function applyWind(m: THREE.MeshStandardMaterial, tag: string): boolean {
  if (!enabled) return false;
  m.onBeforeCompile = hook;
  hooked.push(tag);
  return true;
}

/** Called once per frame from Systems.ts with sim seconds. */
export function windUpdate(simSecs: number): void {
  if (enabled && !frozen) uniforms.uWindTime.value = simSecs;
}

/**
 * RN-2145. The shared uniform OBJECTS, for a consumer that is not a
 * MeshStandardMaterial and therefore cannot go through `applyWind`.
 *
 * The ground-cover carpet (render/grass) is a ShaderMaterial, for reasons its
 * own header gives, so the hook above cannot reach it. It takes these two
 * objects instead, which is what actually matters for coherence: one clock and
 * one amplitude, so `__ofWind.freeze` pins the carpet and the crowns at the
 * same instant and a matched capture pair cannot have one of them moving.
 *
 * NOTHING ABOUT THE EMITTED GLSL ABOVE CHANGES, and that is deliberate. The
 * carpet's sway is written out in its own shader rather than factored out of
 * WIND_GLSL, because WIND_GLSL is the props' program and this lane's before and
 * after depend on the props not moving by so much as a rounding difference.
 * `uWindTree` is not exported: it is the tree reach law and a 0.26 m blade has
 * no use for it.
 *
 * `enabled` IS EXPORTED AND THE CARPET MUST READ IT, and this line is here
 * because the first version did not and the control caught it. `?wind=0` drops
 * the hook, so the props go still; the carpet is a ShaderMaterial that reads
 * these objects unconditionally, and `__ofWind.freeze` writes `uWindTime`
 * whether the hook exists or not. So with `?wind=0` the props stood still and
 * the carpet kept swaying, and `probes/grasswind.js`'s still arm measured 34.59
 * counts of tile motion where it must measure none. A control that fails to go
 * red is a finding, and this is the finding.
 */
export function windUniforms(): {
  uWindTime: { value: number }; uWindAmp: { value: number }; enabled: boolean;
} {
  return {
    uWindTime: uniforms.uWindTime, uWindAmp: uniforms.uWindAmp, enabled,
  };
}

// The probe surface, on the `__ofProps` precedent and for its reason: a page
// reload cannot hold the camera, the sun and the streamed chunk set equal, so
// the honest before/after is a matched pair inside one settled frame, and
// `freeze` is what pins the wind's own clock at two chosen offsets for it.
// `hooked` is published because a toggle that silently matched nothing is the
// exact shape of a measurement over an effect that never ran.
(window as unknown as { __ofWind: unknown }).__ofWind = {
  state: (): unknown => ({
    enabled, frozen,
    ampM: uniforms.uWindAmp.value,
    treeK: uniforms.uWindTree.value,
    time: uniforms.uWindTime.value,
    hooked: [...hooked],
  }),
  set: (ampM: number): void => { uniforms.uWindAmp.value = ampM; },
  tree: (k: number): void => { uniforms.uWindTree.value = k; },
  freeze: (t: number): void => { frozen = true; uniforms.uWindTime.value = t; },
  thaw: (): void => { frozen = false; },
};
