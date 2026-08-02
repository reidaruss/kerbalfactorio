// THE CHANNEL THE MERGE THROWS AWAY: per-part roughness, metalness and a
// "this part is not a member of the family" flag, carried through a
// merge-to-one-material as a vertex attribute. RN-491.
//
// THE PROBLEM, AND IT IS NOT THE SPIDER'S. A rigged or batched asset is merged
// down to ONE geometry with ONE material so it costs one draw call per pass
// instead of one per authored material. That merge KEEPS colour (it bakes each
// source material's colour into a vertex attribute) and THROWS EVERYTHING ELSE
// AWAY. So the .glb can author a fang at roughness 0.18 against a body at 0.95
// and the client draws both at 0.95. RN-455 wrote that limit down and priced
// the fix; RN-491 is the fix.
//
// Reid, on the shipped pelt: "the fangs appear to have the texture as well.
// the fangs can be solid white with a sheen." A sheen IS a specular, a
// specular IS low roughness, and low roughness is exactly the channel the
// merge discards. The ask and the missing channel are the same thing.
//
// WHY THIS IS A GENERAL MECHANISM AND NOT A FANG. Every merged asset after
// this one has the same shape: the player suit is fabric plus a GLASS VISOR
// plus METAL FITTINGS; a machine is painted steel plus glass plus rubber. A
// single tiling family cannot describe any of those, and the part it cannot
// describe is reliably the part a player looks at. So the channel is authored
// per ROLE in of_lib.PALETTE (which every asset already uses), carried in the
// .glb by the loader's own material fields plus one glTF `extras` entry, and
// read here with no role table, no name parsing and no per-asset branch. A
// lane that merges a new asset calls `bakePartMat` in its merge loop and
// `injectPartMat` from whatever hook it already has, and inherits all of it.
//
// WHAT IT COSTS IN THE DW-10 LEDGER: NOTHING, and that is deliberate. This
// file declares no material and installs no `onBeforeCompile` of its own. It
// exports GLSL and a baker, and FurShader.ts splices them into the ONE hook
// RN-463 already argued for and spent. The ledger stays at 4 ShaderMaterial +
// 3 hooks. Built as its own hook it would have been 4 + 4, which is what
// RN-455 priced it at before FurShader existed.
//
// THE RULE, STATED ONCE. Effective response for a part is
//
//     effective = authoredPartValue * familyOrmChannel
//
// i.e. the FAMILY MAP supplies the variation across the surface and the
// AUTHORED ROLE supplies the level. The merged material's own roughness and
// metalness become a base that the attribute divides out, so they no longer
// decide anything except the fallback when this channel is off; they must be
// NON-ZERO for the ratio to carry, which `bakePartMat` asserts rather than
// assumes. For a BARE part the family variation is dropped as well and the
// authored value is used flat, because a part that is not in the family has no
// business wearing the family's roughness pattern either.
//
// NAMED FAILURE MODES, BEFORE ANY MEASUREMENT (INSTRUMENTS.md):
//
//   1. THE ANCHOR MISSES AND THE INJECTION IS A NO-OP. A `String.replace`
//      whose needle is absent returns the string unchanged and reports
//      nothing, so every part would render exactly as the body does today.
//      That failure looks EXACTLY like "the pass did nothing", which is the
//      worst possible signature. `injectPartMat` therefore COUNTS its
//      replacements against a named anchor list and publishes the misses, so
//      "no change" and "no effect" are distinguishable without a screenshot.
//   2. THE WRONG COMPONENT IS READ AND THE WHOLE CREATURE GOES WHITE. `.z` is
//      the bare flag; reading `.x` there would put the body's 0.95 in as a
//      bare weight and unmap everything. The component order is asserted by
//      `partMatState().wrote`, which reports the exact triple written per
//      role, and the roles are few enough to read.
//   3. THE ATTRIBUTE IS DROPPED BY THE MERGE. `mergeGeometries` returns null
//      on a mismatched attribute set, which the caller already throws on, so
//      a partial bake cannot silently survive; `partMatState().verts` is the
//      positive statement that it was written at all.
//
// FLAGS. `?partmat=0` isolates this channel while leaving the pelt running.
// `?fur=0` removes FurShader's hook entirely and therefore removes this too:
// that is the stock-program control and the perf isolator, and it stays
// bit-exact. Both DEFAULTS are fixtures and are published separately from the
// values (RN-150: `Number(null)` is 0, so a probe that always passes an
// explicit flag never exercises the shipped default).
//
// RN-498, AND IT IS THE CALLER'S JOB, NOT THIS FILE'S. This module does not
// read the `fur` flag, because it does not know which hook a given asset
// splices it into; a merged machine will have a different one. The rule is
// that `bakePartMat` is only called when a hook that reads the attribute will
// actually be compiled, and the caller is the only place that knows. Bake it
// with no consumer and the geometry carries a dead per-vertex buffer (about
// 52 KB on the spider) that no program binds, which would quietly break
// whatever bit-exactness claim that asset's control flag makes.

import * as THREE from 'three';

const params = new URLSearchParams(self.location.search);
const raw = params.get('partmat');
/** Whether the parameter was present at all, so the DEFAULT can be asserted
 *  as its own fixture rather than inferred from `enabled`. */
const flagPresent = raw !== null;
const enabled = raw !== '0';

/** The vertex attribute: (authored roughness, authored metalness, bare). */
export const PART_ATTR = 'aPartMat';

/**
 * `vPartMat.z` when the channel is live, and the literal `0.0` when it is
 * not, so a consumer hook can multiply by it unconditionally without
 * referencing a varying that was never declared.
 */
export const PART_BARE_GLSL = enabled ? 'vPartMat.z' : '0.0';

export function partMatEnabled(): boolean { return enabled; }

interface Bake {
  label: string; roughness: number; metalness: number; bare: number;
  verts: number;
}
const wrote: Bake[] = [];
let missing: string[] = [];
let injections = 0;

/**
 * Write one source material's response into the per-vertex channel, for the
 * geometry that material's primitive contributes to a merge.
 *
 * Call it in the merge loop, beside whatever already bakes the colour. The
 * caller must merge with a matching attribute set on EVERY part (that is the
 * `mergeGeometries` contract), so this is called for all parts or none.
 */
export function bakePartMat(g: THREE.BufferGeometry, count: number,
                            src: THREE.MeshStandardMaterial,
                            label: string): void {
  if (!enabled) return;
  // `of_bare` arrives as a glTF material `extras` entry, which three's
  // GLTFLoader assigns to material.userData. Missing is parsed as MISSING and
  // then defaulted, rather than being run through a Number() that turns null
  // into a legitimate-looking 0.
  const ud = src.userData as Record<string, unknown> | undefined;
  const flag = ud === undefined ? undefined : ud.of_bare;
  const bare = flag === undefined ? 0 : (Number(flag) > 0 ? 1 : 0);
  const r = src.roughness;
  const m = src.metalness;
  const a = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    a[i * 3] = r; a[i * 3 + 1] = m; a[i * 3 + 2] = bare;
  }
  g.setAttribute(PART_ATTR, new THREE.BufferAttribute(a, 3));
  wrote.push({ label, roughness: r, metalness: m, bare, verts: count });
}

/**
 * The base the attribute divides against. Both must be non-zero or the ratio
 * cannot carry a part's level, and a zero base is a silent total loss of the
 * channel rather than a visible one, so it is asserted at the call site.
 */
export function assertPartMatBase(mat: THREE.MeshStandardMaterial): void {
  if (!enabled) return;
  if (!(mat.roughness > 0) || !(mat.metalness > 0)) {
    throw new Error(
      `${mat.name}: the merged base roughness/metalness must both be > 0 for `
      + `the per-part channel to carry (got ${mat.roughness}/${mat.metalness})`);
  }
}

// The GLSL. Anchor names are listed once, and every replacement is counted
// against that list, because a missed anchor is failure mode 1.
const V_COMMON = '#include <common>';
const V_BEGIN = '#include <begin_vertex>';
const F_COMMON = '#include <common>';
const F_COLOR = '#include <color_fragment>';
const F_ROUGH = '#include <roughnessmap_fragment>';
const F_METAL = '#include <metalnessmap_fragment>';
const F_NORMAL = '#include <normal_fragment_maps>';
const F_AO = '#include <aomap_fragment>';

/**
 * Splice the channel into a compiling MeshStandardMaterial program.
 *
 * Called from an EXISTING `onBeforeCompile`; this file installs none. The
 * caller's hook must be one shared function object so three's program cache
 * key (which stringifies onBeforeCompile) stays identical across materials.
 */
export function injectPartMat(shader: {
  vertexShader: string; fragmentShader: string;
}): void {
  if (!enabled) return;
  const miss: string[] = [];
  const sub = (s: string, needle: string, next: string, name: string):
  string => {
    if (!s.includes(needle)) { miss.push(name); return s; }
    return s.replace(needle, next);
  };

  let v = shader.vertexShader;
  v = sub(v, V_COMMON, `${V_COMMON}
attribute vec3 ${PART_ATTR};
varying vec3 vPartMat;`, 'vertex:common');
  v = sub(v, V_BEGIN, `${V_BEGIN}
	vPartMat = ${PART_ATTR};`, 'vertex:begin');
  shader.vertexShader = v;

  let f = shader.fragmentShader;
  f = sub(f, F_COMMON, `${F_COMMON}
varying vec3 vPartMat;`, 'fragment:common');

  // ALBEDO. A bare part is its own authored colour and nothing else: not the
  // family's tiling albedo, and not the merged material's colour either. The
  // second half matters more than it looks. `Surfaces.apply` sets
  // `material.color = palette / albedo_mean`, a 1/0.5954 brightening that
  // exists to make the family map mean-neutral; a bare part that kept
  // material.color would wear a 1.68x lift that belongs to a map it is not
  // sampling. Taking the vertex colour raw drops the family tint AND the
  // per-type tint, which is the intended meaning of bare: this part is its
  // own material, not a member and not subject to the member's paint.
  f = sub(f, F_COLOR, `${F_COLOR}
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor.rgb = mix( diffuseColor.rgb, vColor.rgb, vPartMat.z );
#endif`, 'fragment:color');

  // ROUGHNESS. `roughnessFactor` is `roughness * ormG` at this point, so
  // dividing by the uniform recovers ormG and multiplying by the authored
  // value gives `authored * ormG`: family variation, authored level. A bare
  // part takes the authored value flat, because it is not wearing the map
  // that variation came from. The 0.045 floor keeps a mirror out of the
  // specular denominator; nothing in the palette is near it.
  f = sub(f, F_ROUGH, `${F_ROUGH}
	float partR = roughnessFactor * ( vPartMat.x / max( roughness, 1e-4 ) );
	roughnessFactor = clamp( mix( partR, vPartMat.x, vPartMat.z ), 0.045, 1.0 );`,
  'fragment:roughness');

  // METALNESS, by the same ratio for the same reason. The clamp is what makes
  // the ratio safe for a genuinely metal part on a dielectric base: a role
  // authored at 1.0 against a 0.02 base scales ormB by 50 and lands on ormB.
  f = sub(f, F_METAL, `${F_METAL}
	float partM = metalnessFactor * ( vPartMat.y / max( metalness, 1e-4 ) );
	metalnessFactor = clamp( mix( partM, vPartMat.y, vPartMat.z ), 0.0, 1.0 );`,
  'fragment:metalness');

  // NORMAL. The geometric normal is saved before the family's normal map
  // perturbs it and mixed back for a bare part, so a fang stops wearing the
  // pelt's strand relief. This is the half of Reid's note that roughness
  // alone does not answer: a smooth white cone with hair-shaped bumps in it
  // still reads as hairy.
  f = sub(f, F_NORMAL, `vec3 partGeoN = normal;
${F_NORMAL}
	normal = normalize( mix( normal, partGeoN, vPartMat.z ) );`, 'fragment:normal');

  // AMBIENT OCCLUSION, the third map in the same ORM and easy to forget. It
  // multiplies INDIRECT diffuse only, so leaving it would print faint
  // strand-shaped smudges into the ambient of a surface that is supposed to
  // be solid white, which is precisely the complaint.
  f = sub(f, F_AO, `vec3 partPreAo = reflectedLight.indirectDiffuse;
${F_AO}
	reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, partPreAo, vPartMat.z );`,
  'fragment:ao');

  shader.fragmentShader = f;
  injections++;
  if (miss.length > 0) {
    missing = [...new Set([...missing, ...miss])];
    // Loud once per miss, because the silent version of this is a pass that
    // appears to have done nothing at all.
    console.error('[of] partMat: anchors not found, channel is inert:', miss);
  }
}

export function partMatState(): {
  enabled: boolean; flagPresent: boolean; attr: string;
  injections: number; missing: string[]; verts: number; wrote: Bake[];
} {
  return {
    enabled, flagPresent, attr: PART_ATTR, injections,
    missing: [...missing],
    verts: wrote.reduce((s, w) => s + w.verts, 0),
    wrote: wrote.map((w) => ({ ...w })),
  };
}
