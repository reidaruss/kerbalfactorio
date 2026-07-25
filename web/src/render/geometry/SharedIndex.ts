// THE one index buffer. kGridDim is constexpr 33 in /core, so the 33x33 grid
// plus the skirt ring produces an identical 6,912-index triangle list for every
// chunk that will ever exist. 384 resident chunks therefore share ONE
// BufferAttribute (13.5 kB) instead of carrying 384 copies (5.2 MB), and it is
// uploaded once, never again.

import * as THREE from 'three';

export class SharedIndex {
  readonly attribute: THREE.BufferAttribute;
  readonly indexCount: number;
  readonly interiorIndexCount: number;

  constructor(indices: Uint16Array, interiorIndexCount: number) {
    this.attribute = new THREE.BufferAttribute(indices, 1);
    this.attribute.setUsage(THREE.StaticDrawUsage);
    this.indexCount = indices.length;
    this.interiorIndexCount = interiorIndexCount;
  }

  /** Bytes this costs once, for the VRAM estimate. */
  get bytes(): number { return this.indexCount * 2; }
}
