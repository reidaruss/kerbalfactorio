// THE CARD GEOMETRY: the base mesh one carpet instance draws, and the instance
// attribute layout every rung shares. RN-2145.
//
// SOFT SHADING IS BUILT IN HERE RATHER THAN BOLTED ON, which is the difference
// between a carpet and a field of little billboards. A flat quad's true normal
// is perpendicular to the card, so a field of randomly-yawed quads under a
// directional sun is a field of randomly-lit quads: half of them face the sun
// and half face away, and the eye reads salt-and-pepper rather than a surface.
// Real grass does not do that, because a blade is a curved ribbon and a tuft is
// a hemisphere of them, and because most of what leaves it is scattered rather
// than reflected off one facet.
//
// The standard answer, and the one FoliageNormal.ts already applies to authored
// props (spherified toward the part's own base centre), is to BEND THE NORMAL
// TOWARD UP. It is baked at construction here rather than run through
// `bendNormals` because that function spherifies an authored mesh about its
// measured base and this mesh is generated: the exact normal is known in closed
// form, so there is nothing to measure and one fewer pass over the buffer.
//
// TWO RUNGS, TWO CARDS. See GrassTuning's MAT_W_M note for why the far rung is
// its own card and not the near one scaled up.

import * as THREE from 'three';
import {
  CARD_U_SPAN, TUFT_QUADS, TUFT_SEGS,
} from './GrassTuning.js';

/** How far the normal is rotated from the card's own facet toward local up.
 *  0 is a hard facet (the salt-and-pepper failure above); 1 is a pure ground
 *  normal, which loses the tuft's own form. 0.74 keeps a little facet so a
 *  tuft still has a lit side, and is the one number in this file chosen by
 *  looking at the meadow pose rather than derived. */
const BEND_UP = 0.74;
/** The remaining facet term is splayed across the card's width, so a card
 *  shades like a cylinder rather than like a plane and neighbouring blades in
 *  the same card do not all catch the light at once. */
const BEND_SIDE = 0.55;

export interface CardSpec {
  /** Quads per card, crossed at even angles about the card's own up. */
  readonly quads: number;
  /** Height segments per quad. Two lets the wind bend; one only shears. */
  readonly segs: number;
  /** The u-slice of the periodic card one quad takes (15 blades since
   *  RN-2330 to RN-2339, was 11). */
  readonly uSpan: number;
}

export const TUFT_CARD: CardSpec =
  { quads: TUFT_QUADS, segs: TUFT_SEGS, uSpan: CARD_U_SPAN };
/** The far rung: ONE quad, ONE segment, the FULL blade set (15 since
 *  RN-2330 to RN-2339, was 11). Two triangles. */
export const MAT_CARD: CardSpec = { quads: 1, segs: 1, uSpan: 1.0 };

/**
 * Build the base (non-instanced) attributes of one card.
 *
 * `position` is in CARD UNITS: x and z in [-0.5, 0.5], y in [0, 1]. The vertex
 * shader scales by the instance's width and height and plants y = 0 on the
 * ground, which is what makes the wind displacement zero at the root BY
 * CONSTRUCTION rather than by tuning, exactly as PropWind's `position.y` note
 * says of the props.
 */
export function buildCardGeometry(spec: CardSpec): THREE.InstancedBufferGeometry {
  const rows = spec.segs + 1;
  const vertsPerQuad = rows * 2;
  const n = spec.quads * vertsPerQuad;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const bend = new Float32Array(n);
  const idx: number[] = [];

  for (let q = 0; q < spec.quads; ++q) {
    // Crossed over a HALF turn, not a full one: a quad and its 180-degree twin
    // are the same plane, so spreading over pi is what actually spaces them.
    const a = (q * Math.PI) / spec.quads;
    const ca = Math.cos(a), sa = Math.sin(a);
    // The quad's own width direction and its facet normal, in card space.
    const wx = ca, wz = sa;
    const fx = -sa, fz = ca;
    const u0 = q * spec.uSpan;
    for (let r = 0; r < rows; ++r) {
      const v = r / spec.segs;
      // A blade is narrower at the tip. Tapering the CARD as well as the
      // painted blade keeps the alpha-cut silhouette off the card's own edge,
      // where a mip would otherwise erode a straight vertical line.
      // RN-2145 first capture: 0.30 was too much. Combined with the painted
      // blades' own taper it turned the card into a single triangle, which is
      // half of why the first meadow frame read as wedges rather than grass.
      const half = 0.5 * (1 - 0.14 * v);
      for (let s = 0; s < 2; ++s) {
        const x = (s === 0 ? -half : half);
        const i = q * vertsPerQuad + r * 2 + s;
        pos[i * 3] = wx * x;
        pos[i * 3 + 1] = v;
        pos[i * 3 + 2] = wz * x;
        // THE BENT NORMAL. Up, plus what is left of the facet, plus a splay
        // across the width. Normalised, so the shading is energy-sane.
        const sx = wx * (x * 2) * BEND_SIDE;
        const sz = wz * (x * 2) * BEND_SIDE;
        const rest = 1 - BEND_UP;
        let nx = fx * rest + sx * rest;
        let ny = BEND_UP;
        let nz = fz * rest + sz * rest;
        const il = 1 / (Math.hypot(nx, ny, nz) || 1);
        nx *= il; ny *= il; nz *= il;
        nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
        uv[i * 2] = u0 + (s === 0 ? 0 : spec.uSpan);
        uv[i * 2 + 1] = v;
        // The wind's reach up the card. v^1.6 rather than v: a real blade bends
        // as a cantilever, so the top third does most of the moving and the
        // bottom third barely moves at all. Linear reads as a hinge.
        bend[i] = Math.pow(v, 1.6);
      }
    }
    for (let r = 0; r < spec.segs; ++r) {
      const b = q * vertsPerQuad + r * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
  }

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aBend', new THREE.BufferAttribute(bend, 1));
  g.setIndex(idx);
  // Never culled as a whole: the instances are spread over a 190 m disc and the
  // base geometry's own bounding sphere is one card. PropLibrary sets the same
  // flag on its batches for the same reason.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/** Triangles one instance of this card draws, for the cost report. */
export function cardTriangles(spec: CardSpec): number {
  return spec.quads * spec.segs * 2;
}

/**
 * THE INSTANCE LAYOUT, 32 bytes, and every field is here because something
 * needs it per instance and nothing else can supply it.
 *
 *   iPos   vec3  f32  engine-space root position. Float32 and not a packed
 *                     format: this is a position in a frame that reaches 4 km
 *                     before it rebases, and half precision there is 4 m.
 *   iParam vec4  f32  x yaw, y width metres, z height metres, w the DEMAND
 *                     THRESHOLD (see GrassField.want): the instance density at
 *                     which this instance becomes wanted. The shader shows it
 *                     when the live density at its own range reaches that
 *                     figure, which is what makes the visible set a function of
 *                     the eye and not of when a chunk happened to be rebuilt.
 *   iCol   u8x4  srgb the GROUND COLOUR beneath this instance, rotated toward
 *                     cover green (GrassPalette.coverAlbedo). Stored sRGB-
 *                     encoded because that is what eight bits are for: linear
 *                     bytes quantise the dark end, where every one of these
 *                     colours lives. w carries the per-instance value jitter.
 */
export const F32_PER_INSTANCE = 7;
export const U8_PER_INSTANCE = 4;
