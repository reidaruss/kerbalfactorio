// WHAT THE BATCH PATHS REPORT IN: the UV copy every consumer must go through,
// its three counters, and the shader-chunk ordering note.
//
// Split out of Surfaces.ts at the 400-line cap (2.2 rule 1). A pure move.
//
// The counters are `let` and `copyUv` is their ONLY writer, so they move with
// it; `surfaceReport` reads them across the import, which an ES module binding
// gives for free precisely because an importer cannot reassign them.

import * as THREE from 'three';

export let uvCopied = 0;
export let uvSynthesised = 0;
export let uvCountMismatch = 0;

/** Geometries whose UVs were copied, per consumer, so "the UVs arrived" can be
 *  asserted for the machine path separately from the node and prop paths. */
export const uvBy: Record<string, number> = {};
export const shaderOrder: Record<string, unknown> = {};

/**
 * Copy `uv` from `src` onto `dst`. UNCONDITIONALLY: the attribute is always
 * created, and the only thing the source's presence decides is whether it holds
 * the asset's UVs or zeroes.
 *
 * This is the whole of ASSET-SPECS 2.9 (1) and it lives in one function on
 * purpose. Guarding the `setAttribute` with `if (src.getAttribute('uv'))`
 * reintroduces a mixed-attribute merge: `mergeGeometries` returns `null` on a
 * mismatched attribute set and both call sites swallow that with `?? list[0]`,
 * so ONE untextured primitive anywhere in an asset would silently reduce it to
 * its first primitive. `BatchedMesh.addGeometry` is the same trap one layer
 * down. The failure mode is "most of the scene quietly disappeared".
 *
 * `uvSynthesised` and `uvCountMismatch` are counted rather than tolerated: both
 * mean an asset shipped without usable UVs, and a probe asserts they are zero.
 */
export function copyUv(src: THREE.BufferGeometry, dst: THREE.BufferGeometry,
                       count: number, tag = '?'): void {
  const a = src.getAttribute('uv');
  const uv = new Float32Array(count * 2);
  if (a === undefined) { uvSynthesised++; uvBy[`${tag}:MISSING`] = (uvBy[`${tag}:MISSING`] ?? 0) + 1; }
  else if (a.count < count) uvCountMismatch++;
  else {
    for (let i = 0; i < count; ++i) { uv[i * 2] = a.getX(i); uv[i * 2 + 1] = a.getY(i); }
    uvCopied++;
    uvBy[tag] = (uvBy[tag] ?? 0) + 1;
  }
  dst.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Record where three's map chunks sit relative to a custom `onBeforeCompile`
 * hook, off the ACTUAL shader string three handed the caller.
 *
 * `MachineBatch` overwrites `diffuseColor.rgb` at `<emissivemap_fragment>`,
 * which is the reason ASSET-SPECS 2.8 refuses an albedo map. The claim that the
 * OTHER four maps survive that edit is an ordering claim about meshphysical's
 * chunk list, and this asserts it instead of remembering it: roughness,
 * metalness and the normal frame must all resolve BEFORE the hook, and AO is
 * applied after it. If three ever reorders those chunks, this reads false.
 */
export function noteShaderOrder(tag: string, frag: string): void {
  const at = (c: string): number => frag.indexOf(`#include <${c}>`);
  const rough = at('roughnessmap_fragment');
  const metal = at('metalnessmap_fragment');
  const nrm = at('normal_fragment_maps');
  const hook = at('emissivemap_fragment');
  const ao = at('aomap_fragment');
  shaderOrder[tag] = {
    roughnessmap: rough, metalnessmap: metal, normalMaps: nrm,
    emissivemapHook: hook, aomap: ao,
    mapsResolveBeforeHook: rough > 0 && metal > 0 && nrm > 0 && hook > 0
      && Math.max(rough, metal, nrm) < hook,
    aoAppliedAfterHook: ao > hook && hook > 0,
  };
}
