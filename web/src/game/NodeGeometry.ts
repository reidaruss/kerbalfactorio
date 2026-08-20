// EVERYTHING THAT HAPPENS BEFORE A BATCH EXISTS: find the primitives in the
// loaded templates, decide which family each belongs to, merge a variant's
// several roles into one geometry, and normalise it to what a BatchedMesh
// demands. Split out of NodeBatch.ts (GP-1086).
//
// The two gates live here rather than beside the material they affect, because
// `build`'s vertex bake and `makeBatch`'s hook install must ask the SAME
// question and the only way to guarantee that is one answer in one place.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { copyUv, familyForMaterial } from '../render/instancing/Surfaces.js';
import { bakePartMat, partMatEnabled } from '../render/materials/PartMaterial.js';
import { rockMatEnabled } from '../render/materials/RockShader.js';
import { LODS, VARIANTS, type Found } from './NodeBatchTypes.js';

/**
 * Which batches take the per-mineral material channel, asked ONCE and answered
 * in ONE place, because the hook install and the vertex bake must agree.
 *
 * MINERAL FAMILIES ONLY, and the exclusions are decisions rather than
 * omissions. `leaf:` and `grass:` already carry `applyWind`, and a second
 * `onBeforeCompile` on the same material would overwrite the first, so hooking
 * them would silently stop the crowns swaying. `flat:` holds Water and Oil
 * (RN-181 moved the foliage roles out of it), and giving a pool surface its
 * authored response is a change nobody asked for and is out of scope for a
 * pass about rock.
 */
export function mineralFamily(name: string): boolean {
  // RN-742 adds `stone:`, and it is the one that MATTERS most of the three:
  // the host rock is the bulk of every boulder, the whole spire and all the
  // scree, and after the role move it is no longer reached by `coarse:`. A
  // family split that forgot this line would have silently taken the per-part
  // channel away from the exact surfaces this pass exists to skin, and it would
  // have looked like the channel simply doing nothing rather than like a bug.
  return name.startsWith('coarse:') || name.startsWith('ore:')
    || name.startsWith('stone:');
}

/**
 * Whether the per-part channel is LIVE, read once at module load from two
 * immutable URL flags rather than per batch, so `makeBatch`'s base constants
 * and `build`'s bake gate cannot disagree about it mid-build.
 *
 * BOTH flags, not just `rockmat`. `?rockmat=0` removes the hook, and
 * `?partmat=0` leaves the hook installed but makes `injectPartMat` and
 * `bakePartMat` no-ops, so in that second state nothing divides the base back
 * out and it must stay at its old literal value. See `makeBatch` in
 * `NodeMaterial.ts`.
 */
export const ROCK_CHANNEL = rockMatEnabled() && partMatEnabled();

/** Merge one family's primitives into a single geometry. One is already merged. */
export function concat(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (list.length === 1) return list[0];
  const g = mergeGeometries(list, false);
  if (g === null) return list[0];
  g.computeBoundingSphere();
  return g;
}

/**
 * Strip to what every geometry in a batch must agree about (see PropLibrary),
 * and BAKE the source material's colour into a per-vertex attribute so several
 * roles can share one material. `mat.color` is already in the renderer's linear
 * working space (GLTFLoader converted it), which is the space three expects a
 * vertex colour to be in, so the components copy across untouched.
 *
 * `bake` is the source material AGAIN, and passing it is what turns the
 * per-part roughness and metalness channel on for this primitive; `null` means
 * do not bake. It is a separate argument rather than a flag read in here on
 * purpose: `PartMaterial` does not know which hook will read its attribute, so
 * only the caller can know whether one will be compiled, and a bake with no
 * consumer is a dead per-vertex buffer that no program binds (RockShader.ts
 * failure mode (b)). Colour is baked unconditionally right below and always
 * has been; this rides beside it.
 */
export function normalize(src: THREE.BufferGeometry, world: THREE.Matrix4,
                   tint: THREE.Color,
                   bake: THREE.MeshStandardMaterial | null): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  g.setAttribute('position', pos.clone());
  const nrm = src.getAttribute('normal');
  g.setAttribute('normal', nrm !== undefined
    ? (nrm as THREE.BufferAttribute).clone()
    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  copyUv(src, g, pos.count, 'nodes');   // UNCONDITIONAL. See Surfaces.copyUv.
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; ++i) {
    col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // The channel the merge used to throw away, carried exactly the way the
  // colour one line up is: the proof that per-vertex data survives this merge
  // and the BatchedMesh behind it was already sitting there.
  if (bake !== null) bakePartMat(g, pos.count, bake, bake.name);
  const idx = src.getIndex();
  if (idx !== null) g.setIndex(idx.clone());
  else {
    const seq = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; ++i) seq[i] = i;
    g.setIndex(new THREE.BufferAttribute(seq, 1));
  }
  g.applyMatrix4(world);
  g.computeBoundingSphere();
  return g;
}

/**
 * Which batch a role belongs to: `<surface>:<shading>`, and BOTH halves matter.
 *
 * Metalness alone put Leaf and Grass in the same bucket as Rock and Bark. That
 * was free while nothing was textured and it stopped being free the moment the
 * bucket got a map, because Leaf and Grass are `flat_roles`: the texture pass
 * recorded a reason for each ("sub-pixel blades at any real viewing distance",
 * "a double-sided card whose normal map fights the flat-shaded silhouette"), and
 * a rock normal map on a foliage card is worse than no map at all. Splitting on
 * the surface family is what preserves that decision through the batching.
 *
 * The cost is at most two extra batches, which at 53 draws of a 150 budget is
 * the cheap side of the trade (ASSET-SPECS 2.9).
 */
export function familyOf(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return `${familyForMaterial(m)}:${(s.metalness ?? 0) > 0.5 ? 'metal' : 'matte'}`;
}

/**
 * PASS ONE: every drawable primitive in every loaded template, flattened.
 *
 * Lifted verbatim out of `NodeBatch.build` (GP-1086), which is where the two
 * passes were already documented as two passes; this is the first of them, and
 * nothing downstream of it needs a NodeBatch to exist yet. `col_` meshes are
 * collision proxies, a name that does not parse as `<Variant>_LOD<n>` is not
 * node art, and a variant outside the three is a Stump or similar and is
 * skipped rather than guessed at.
 */
export function scanTemplates(
  templates: ReadonlyMap<string, { root: string; scene: THREE.Object3D }>,
): Found[] {
  const found: Found[] = [];
  for (const [file, t] of templates) {
    t.scene.updateWorldMatrix(true, true);
    t.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true || m.name.startsWith('col_')) return;
      // GLTFLoader appends _0/_1/... per primitive of a multi-material mesh.
      const hit = /^(.*)_LOD(\d)(?:_\d+)?$/.exec(m.name);
      if (hit === null) return;
      const lod = Number(hit[2]);
      if (!(lod >= 0 && lod < LODS)) return;
      const v = VARIANTS.indexOf(hit[1].replace(`${t.root}_`, '') as typeof VARIANTS[number]);
      if (v < 0) return;   // a Stump or anything else outside the three variants
      found.push({
        file, variant: v, lod, geometry: m.geometry, world: m.matrixWorld,
        material: familyOf(m.material as THREE.Material),
        source: m.material as THREE.Material,
      });
    });
  }
  return found;
}
