// THE index buffers. kGridDim is constexpr 33 in /core, so the 33x33 grid plus
// the skirt ring produces an identical 6,912-index triangle list for every chunk
// that will ever exist. 384 resident chunks therefore share ONE BufferAttribute
// (13.5 kB) instead of carrying 384 copies (5.2 MB), and it is uploaded once.
//
// There are TWO of them, and that is a W3 bug fix, not an optimisation.
// /core's cubed sphere parametrizes three of the six faces left-handed, so one
// winding order makes those faces BACK-facing and `side: FrontSide` culls them
// entirely. From orbit that removed half the planet: measured 150,265 void
// pixels with the PlanetProxy hidden, 0 with `?side=double`. The proxy was
// filling the hole, which is why W1 and W2 only ever saw the 279-pixel residue
// at the limb where the proxy's silhouette ends (ARCHITECTURE.md 15.2 item 19).
//
// The flipped copy costs 13.5 kB and nothing per frame. DoubleSide would have
// cost every terrain fragment its backface-culling saving, forever.

import * as THREE from 'three';

export class SharedIndex {
  /** Counter-clockwise as seen from outside: the three.js FrontSide winding. */
  readonly attribute: THREE.BufferAttribute;
  /** The same triangles with b and c swapped, for the left-handed faces. */
  readonly flipped: THREE.BufferAttribute;
  readonly indexCount: number;
  readonly interiorIndexCount: number;

  constructor(indices: Uint16Array, interiorIndexCount: number) {
    this.attribute = new THREE.BufferAttribute(indices, 1);
    this.attribute.setUsage(THREE.StaticDrawUsage);
    const flip = new Uint16Array(indices.length);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      flip[i] = indices[i];
      flip[i + 1] = indices[i + 2];
      flip[i + 2] = indices[i + 1];
    }
    this.flipped = new THREE.BufferAttribute(flip, 1);
    this.flipped.setUsage(THREE.StaticDrawUsage);
    this.indexCount = indices.length;
    this.interiorIndexCount = interiorIndexCount;
  }

  /**
   * Which index buffer a chunk needs, decided by MEASURING the chunk rather than
   * by tabulating /core's face conventions: take the first interior triangle and
   * compare its winding normal against the outward normal /core already stored
   * on the vertex. A convention change in /core therefore cannot silently
   * reintroduce the missing-face bug.
   */
  needsFlip(position: Float32Array, normal: Int8Array): boolean {
    const idx = this.attribute.array as Uint16Array;
    const a = idx[0] * 3, b = idx[1] * 3, c = idx[2] * 3;
    const abx = position[b] - position[a];
    const aby = position[b + 1] - position[a + 1];
    const abz = position[b + 2] - position[a + 2];
    const acx = position[c] - position[a];
    const acy = position[c + 1] - position[a + 1];
    const acz = position[c + 2] - position[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    return nx * normal[a] + ny * normal[a + 1] + nz * normal[a + 2] < 0;
  }

  /** Bytes these cost once, for the VRAM estimate. */
  get bytes(): number { return this.indexCount * 4; }
}
