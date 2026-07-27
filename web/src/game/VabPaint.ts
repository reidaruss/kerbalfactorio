// Material and socket helpers for the assembly bay. Split out of VabView only
// because that file reached the 400-line cap; these three functions are the
// low-level glTF and material handling the bay does, and they are the kind of
// thing that is easy to get subtly wrong, so they are worth reading together.
import * as THREE from 'three';
import { renderMeshes } from '../assets/Loaders.js';

/**
 * Find a socket by its AUTHORED name, tolerating three's uniquifier.
 *
 * `GLTFLoader.createUniqueName` appends `_1`, `_2` ... to every repeat of a node
 * name in a file, and twenty parts in `rocket_parts.glb` publish a node called
 * `socket_stack_top`. So exactly one part in the file has a socket by that exact
 * name and nineteen have `socket_stack_top_7`-shaped names, which made a plain
 * `getObjectByName` return nothing for nineteen parts out of twenty and report
 * every joint as unmeasurable. The same suffix is why `Loaders.selectLod`'s
 * regex carries a trailing `(_\d+)?`.
 *
 * Scoped to `root`, which is always ONE cloned part, so the match is unambiguous
 * whatever number the loader happened to hang on the end.
 */
export function findSocket(root: THREE.Object3D, base: string): THREE.Object3D | null {
  const re = new RegExp(`^${base}(_\\d+)?$`);
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => { if (hit === null && re.test(o.name)) hit = o; });
  return hit;
}

/**
 * Give every material under `o` its own copy, once. A glb template is shared by
 * every clone of that part, so writing to a material without this makes tinting
 * one fin tint all four, and a ghost recolour the rocket it is hovering over.
 */
function ownMaterials(o: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  for (const m of renderMeshes(o)) {
    const mat = m.material as THREE.Material | THREE.Material[];
    const list = Array.isArray(mat) ? mat : [mat];
    for (let i = 0; i < list.length; ++i) {
      let use = list[i];
      if (!use) continue;
      if (use.userData.vabOwned !== true) {
        use = use.clone();
        use.userData.vabOwned = true;
        if (Array.isArray(mat)) mat[i] = use; else m.material = use;
      }
      out.push(use as THREE.MeshStandardMaterial);
    }
  }
  return out;
}

/** Replace the colour outright. For the GHOST only, which is not a part yet. */
export function paint(o: THREE.Object3D, colour: number, opacity: number): void {
  for (const s of ownMaterials(o)) {
    if (s.color) s.color.setHex(colour);
    if (s.emissive) s.emissive.setHex(colour);
    s.emissiveIntensity = 0.4;
    s.transparent = true;
    s.opacity = opacity;
    s.depthWrite = false;
  }
}

/** Additive emissive only, so the authored colour survives underneath. */
export function glow(o: THREE.Object3D, colour: number, strength: number): void {
  for (const s of ownMaterials(o)) {
    if (!s.emissive) continue;
    s.emissive.setHex(colour);
    s.emissiveIntensity = strength;
  }
}
