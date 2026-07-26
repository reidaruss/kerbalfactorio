// What a structure is to a BODY: a small set of axis-aligned boxes in the part's
// own frame, and nothing else.
//
// DW-12 says there is no physics engine, so this cannot be a collision library
// and should not try. A structural part ships its own broadphase proxies
// (ASSET-SPECS 2.5) and they are already boxes, so the whole of "can I walk
// there" is a point-in-box test with the point rotated into the part's frame.
//
// THE DOOR IS THREE BOXES AND THAT IS THE POINT. `col_Door_JambL`,
// `col_Door_JambR` and `col_Door_Header` leave the 0.76 x 2.10 m opening
// genuinely open. Hulling them together would seal the doorway, and the only way
// to catch that is to make a walk through the opening an assertion, which is
// what `probes/build.js` does. The LEAF carries no authored proxy; it gets a
// derived one that exists only while the door is CLOSED, so a shut door is a
// wall and an open one is a hole. That is not a swinging collider: it is a box
// that is present or absent, which is all a kinematic walker can honestly do.

import * as THREE from 'three';
import type { Vec3d } from '../world/PlanetBody.js';

/** One proxy, in the part's local frame. */
export interface LocalBox {
  min: [number, number, number];
  max: [number, number, number];
  /** True for the derived door leaf, which only blocks while the door is shut. */
  leaf: boolean;
}

/** A placed part, as the walker sees it. */
export interface Solid {
  id: number;
  pos: Vec3d;
  quat: THREE.Quaternion;
  boxes: readonly LocalBox[];
  /** Body-frame bound: centre plus radius, for the O(1) reject. */
  cx: number; cy: number; cz: number; cr: number;
  /** Doors only. A shut door blocks its own opening. */
  shut: boolean;
}

/**
 * The bound of a named node's geometry, in the root's frame.
 *
 * It TRAVERSES rather than reading one `.geometry`, because a glTF mesh with
 * more than one material becomes a Group of primitives under three's loader:
 * `Door_Leaf` has three, so `getObjectByName('Door_Leaf').geometry` is
 * undefined. Every structural part has multi-material meshes, so this is the
 * normal case and not an edge one.
 */
export function boundsOf(root: THREE.Object3D, name: string): THREE.Box3 | null {
  const node = root.getObjectByName(name);
  if (node === undefined) return null;
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  let any = false;
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (bb === null) return;
    box.union(bb.clone().applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld)));
    any = true;
  });
  return any ? box : null;
}

/** Collect the `col_*` proxies of a loaded root, in root-local metres. */
export function proxiesOf(root: THREE.Object3D): LocalBox[] {
  const out: LocalBox[] = [];
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const seen = new Set<string>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true || !mesh.name.startsWith('col_')) return;
    // One proxy per NAMED node, unioned across its primitives, so a multi-
    // material collision box is still one box and the door still has three.
    const base = mesh.name.replace(/_\d+$/, '');
    if (seen.has(base)) return;
    seen.add(base);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (bb === null) return;
    const b = bb.clone().applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
    out.push({ min: [b.min.x, b.min.y, b.min.z],
      max: [b.max.x, b.max.y, b.max.z], leaf: false });
  });
  return out;
}

/**
 * The door leaf's derived proxy, in the DOOR's frame with the leaf shut.
 *
 * `Door_Leaf` hangs off `door_hinge`, and at rest the hinge is identity (the
 * exported static pose is a closed door, which `frame1_identity` asserts), so
 * the shut leaf's box is its own geometry bound offset by the hinge.
 */
export function leafProxy(root: THREE.Object3D): LocalBox | null {
  const bb = boundsOf(root, 'Door_Leaf');
  if (bb === null) return null;
  return {
    min: [bb.min.x, bb.min.y, bb.min.z],
    max: [bb.max.x, bb.max.y, bb.max.z],
    leaf: true,
  };
}

/** Bounding sphere of a proxy set once a part is placed. */
export function boundOf(boxes: readonly LocalBox[]): number {
  let r = 0;
  for (const b of boxes) {
    for (const [x, y, z] of [b.min, b.max]) r = Math.max(r, Math.hypot(x, y, z));
  }
  return r;
}

/**
 * Every structural solid in the world, as one queryable set.
 *
 * This is what the walker is handed. It holds no opinion about terrain: rock is
 * still the oracle's answer and nothing here touches it (standing rule 1).
 */
export class StructureBodies {
  readonly list: Solid[] = [];
  /** Point tests made since the last reset, charged to the tick budget. */
  tests = 0;
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly near: Solid[] = [];

  resetTests(): void { this.tests = 0; }

  clear(): void { this.list.length = 0; }

  add(s: Solid): void { this.list.push(s); }

  remove(pred: (s: Solid) => boolean): void {
    for (let i = this.list.length - 1; i >= 0; --i) {
      if (pred(this.list[i])) this.list.splice(i, 1);
    }
  }

  /** Is this body-frame point inside any structural proxy? */
  blocks(x: number, y: number, z: number): boolean {
    for (const s of this.list) {
      const dx = x - s.cx, dy = y - s.cy, dz = z - s.cz;
      if (dx * dx + dy * dy + dz * dz > s.cr * s.cr) continue;
      if (this.inside(s, x, y, z)) return true;
    }
    return false;
  }

  private inside(s: Solid, x: number, y: number, z: number): boolean {
    this.tests++;
    this.v.set(x - s.pos.x, y - s.pos.y, z - s.pos.z)
      .applyQuaternion(this.q.copy(s.quat).invert());
    for (const b of s.boxes) {
      if (b.leaf && !s.shut) continue;
      if (this.v.x >= b.min[0] && this.v.x <= b.max[0]
        && this.v.y >= b.min[1] && this.v.y <= b.max[1]
        && this.v.z >= b.min[2] && this.v.z <= b.max[2]) return true;
    }
    return false;
  }

  /** The parts whose bound reaches within `radiusM` of a point. */
  private gather(x: number, y: number, z: number, radiusM: number): Solid[] {
    this.near.length = 0;
    for (const s of this.list) {
      const dx = x - s.cx, dy = y - s.cy, dz = z - s.cz;
      const reach = s.cr + radiusM;
      if (dx * dx + dy * dy + dz * dz <= reach * reach) this.near.push(s);
    }
    return this.near;
  }

  /**
   * The radius of the top of the highest structural surface under `rFrom` along
   * a radial direction, or null when there is none within `searchM`.
   *
   * Marched at 0.05 m rather than solved, for the same reason
   * `VoxelCollider.floorBelow` marches: a deck top is a plane in a rotated frame
   * and an exact solve buys a centimetre of accuracy that nothing can see. The
   * candidate set is gathered ONCE, so the march costs at most a handful of box
   * tests per step and usually none at all.
   */
  deckUnder(dx: number, dy: number, dz: number, rFrom: number,
            searchM: number): number | null {
    const near = this.gather(dx * rFrom, dy * rFrom, dz * rFrom, searchM + 1);
    if (near.length === 0) return null;
    for (let d = 0; d <= searchM; d += 0.05) {
      const r = rFrom - d;
      const x = dx * r, y = dy * r, z = dz * r;
      for (const s of near) {
        if (this.inside(s, x, y, z)) return Math.min(rFrom, r + 0.05);
      }
    }
    return null;
  }

  /**
   * Resolve a step against structural solids: take it, step up onto it, slide
   * along it, or refuse it. Deliberately the same shape as
   * `VoxelCollider.resolveStep`, because it is the same problem with boxes in a
   * rotated frame instead of boxes on a lattice, and two walkers with different
   * manners would be the thing a player notices.
   */
  resolveStep(p: Vec3d, qx: number, qy: number, qz: number,
              ux: number, uy: number, uz: number,
              samplesM: readonly number[], stepUpM: readonly number[]):
  { x: number; y: number; z: number; blocked: boolean } {
    if (this.free(qx, qy, qz, ux, uy, uz, samplesM)) {
      return { x: qx, y: qy, z: qz, blocked: false };
    }
    if (!this.free(p.x, p.y, p.z, ux, uy, uz, samplesM)) {
      return { x: qx, y: qy, z: qz, blocked: false };
    }
    for (const h of stepUpM) {
      const sx = qx + ux * h, sy = qy + uy * h, sz = qz + uz * h;
      if (this.free(sx, sy, sz, ux, uy, uz, samplesM)) {
        return { x: sx, y: sy, z: sz, blocked: false };
      }
    }
    const dx = qx - p.x, dy = qy - p.y, dz = qz - p.z;
    const tries: [number, number, number][] = [
      [0, dy, dz], [dx, 0, dz], [dx, dy, 0], [dx, 0, 0], [0, dy, 0], [0, 0, dz],
    ];
    tries.sort((a, b) => (b[0] * b[0] + b[1] * b[1] + b[2] * b[2])
      - (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]));
    for (const [ax, ay, az] of tries) {
      if (ax === dx && ay === dy && az === dz) continue;
      if (ax === 0 && ay === 0 && az === 0) continue;
      const sx = p.x + ax, sy = p.y + ay, sz = p.z + az;
      if (this.free(sx, sy, sz, ux, uy, uz, samplesM)) {
        return { x: sx, y: sy, z: sz, blocked: false };
      }
    }
    return { x: p.x, y: p.y, z: p.z, blocked: true };
  }

  private free(x: number, y: number, z: number, ux: number, uy: number,
               uz: number, samplesM: readonly number[]): boolean {
    for (const h of samplesM) {
      if (this.blocks(x + ux * h, y + uy * h, z + uz * h)) return false;
    }
    return true;
  }

  /**
   * March an aim ray against the solids. Returns the distance to the first
   * point inside one, or -1. This is what lets the placement ghost climb: aiming
   * at a foundation top has to name the deck, not the ground under it.
   */
  rayHit(o: Vec3d, d: Vec3d, reachM: number, stepM: number): number {
    for (let t = stepM; t <= reachM; t += stepM) {
      if (this.blocks(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t)) return t;
    }
    return -1;
  }

  /** The first part an aim ray enters, and how far along it. */
  rayPick(o: Vec3d, d: Vec3d, reachM: number, stepM: number):
  { t: number; solid: Solid } | null {
    for (let t = stepM; t <= reachM; t += stepM) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      for (const s of this.list) {
        const dx = x - s.cx, dy = y - s.cy, dz = z - s.cz;
        if (dx * dx + dy * dy + dz * dz > s.cr * s.cr) continue;
        if (this.inside(s, x, y, z)) return { t, solid: s };
      }
    }
    return null;
  }
}
