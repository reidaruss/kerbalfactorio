// PROCEDURAL BODIES FOR THE CREATURES AND THE NESTS.
//
// WHY GEOMETRY IN CODE RATHER THAN A .glb. Every other placed thing in this game
// comes out of the headless Blender pipeline (DW-5) and so should these,
// eventually. They do not tonight for one honest reason: the art lane is live in
// `assets/` and `web/src/render/**`, and a creature is the first asset this
// project would need that MOVES, which means a rig, a walk clip and an impact
// contract (DW-34) rather than a mesh. Shipping a procedural stand-in keeps the
// gameplay seam provable now and leaves exactly one file to delete when the
// authored asset lands. It is named as a stand-in rather than left to look like
// a decision.
//
// ONE GEOMETRY PER TYPE, AT UNIT SIZE, TINTED. The instance matrix carries the
// scale, so `EnemyTypes.radiusM` (which is derived from /core's own `reachM`)
// stays the single number that decides how big a thing is, and the art cannot
// disagree with the hitbox a shot tests. The tint is baked into a vertex colour
// so the whole swarm is ONE material and therefore one draw plus its cascades,
// which is the same argument `NodeBatch` measured: a material is the budget, not
// an object.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Paint a geometry, drop what a batch cannot merge, and hand it back. */
function tinted(g: THREE.BufferGeometry, colour: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = colour.r; c[i * 3 + 1] = colour.g; c[i * 3 + 2] = colour.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

function put(g: THREE.BufferGeometry, x: number, y: number, z: number,
             rx = 0): THREE.BufferGeometry {
  if (rx !== 0) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

/** A box swept from `a` to `b`, radius `r`, for a leg segment. */
function limb(a: [number, number, number], b: [number, number, number],
              r: number): THREE.BufferGeometry {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const g = new THREE.BoxGeometry(r * 2, len, r * 2);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx / len, dy / len, dz / len));
  g.applyQuaternion(q);
  g.translate(a[0], a[1], a[2]);
  return g;
}

/**
 * RN-122: THE FAR SPIDER. The batch stand-in now shares the AUTHORED
 * spider.glb's proportions (body mass ~2.2 m long topping at ~1.15 m, knees
 * arching to ~1.55 m, feet spanning ~4.8 m tip to tip, all at unit scale),
 * so a creature crossing the SpiderFlock claim boundary swaps ANIMATION, not
 * SHAPE. Still one merged, vertex-tinted geometry per type in one
 * BatchedMesh: the far swarm's whole cost is unchanged.
 *
 * Standing on y = 0, facing +Z, drawn at scale = the type's radiusM, exactly
 * as before. The legs deliberately overreach the radiusM hit sphere: a leg
 * is silhouette, not target, and the shot sphere stays the body mass.
 */
export function creatureGeometry(tint: number): THREE.BufferGeometry {
  const dark = new THREE.Color(tint).multiplyScalar(0.55);
  const body = new THREE.Color(tint);
  const pale = new THREE.Color(tint).multiplyScalar(0.85).addScalar(0.06);
  const parts: THREE.BufferGeometry[] = [
    // Abdomen: the raised rear bulb; cephalothorax: lower and flatter.
    tinted(put(new THREE.BoxGeometry(0.86, 0.66, 1.10), 0, 0.82, -0.62), body),
    tinted(put(new THREE.BoxGeometry(0.68, 0.44, 0.80), 0, 0.58, 0.28), body),
    // Head cluster with down-forward fangs.
    tinted(put(new THREE.BoxGeometry(0.40, 0.28, 0.30), 0, 0.56, 0.80), dark),
    tinted(limb([0.10, 0.50, 0.92], [0.13, 0.22, 1.02], 0.035), pale),
    tinted(limb([-0.10, 0.50, 0.92], [-0.13, 0.22, 1.02], 0.035), pale),
  ];
  // Eight legs off the cephalothorax rim: femur up-out to the knee, tibia
  // down-out to a pointed-enough foot. Angles match the authored gait's
  // stance (leg 1 forward-raked to leg 4 rear-raked).
  const HIP_Y = 0.62;
  const KNEE_Y = 1.55;
  const FOOT_R = 2.4;
  const KNEE_R = 1.05;
  const AZ = [35, 70, 110, 145];
  for (const side of [1, -1]) {
    for (let i = 0; i < AZ.length; i++) {
      const a = (AZ[i] * Math.PI) / 180;
      const ux = Math.sin(a) * side;
      const uz = Math.cos(a);
      const hip: [number, number, number] = [ux * 0.30, HIP_Y, uz * 0.30 + 0.20];
      const knee: [number, number, number] =
        [ux * KNEE_R, KNEE_Y, uz * KNEE_R + 0.20];
      const foot: [number, number, number] =
        [ux * FOOT_R, 0.02, uz * FOOT_R + 0.20];
      parts.push(tinted(limb(hip, knee, 0.055), dark));
      parts.push(tinted(limb(knee, foot, 0.035), dark));
    }
  }
  const g = mergeGeometries(parts, false) ?? parts[0];
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * A nest at unit size: a 1 m mound with spines, scaled up by `NEST_RADIUS_M`.
 *
 * It is deliberately BIG and deliberately not subtle. A nest is the only thing
 * in the world whose destruction moves the evolution factor, so a player who
 * cannot find one cannot act on the one lever the difficulty curve has.
 */
export function nestGeometry(): THREE.BufferGeometry {
  const shell = new THREE.Color(0x4a3350);
  const spine = new THREE.Color(0x9c5f3a);
  const parts: THREE.BufferGeometry[] = [
    tinted(new THREE.SphereGeometry(1.0, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), shell),
    tinted(put(new THREE.CylinderGeometry(0.62, 0.95, 0.5, 10), 0, 0.12, 0), shell),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.ConeGeometry(0.16, 1.1, 5);
    g.rotateX(0.42 * Math.cos(a));
    g.rotateZ(-0.42 * Math.sin(a));
    parts.push(tinted(put(g, Math.cos(a) * 0.62, 0.86, Math.sin(a) * 0.62), spine));
  }
  const g = mergeGeometries(parts, false) ?? parts[0];
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** How big a nest is, in metres. Also the bounding sphere a shot tests, so the
 *  picture and the hitbox are one number. */
export const NEST_RADIUS_M = 5.0;

export function enemyMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, metalness: 0.05, roughness: 0.85,
  });
  m.name = 'enemies:bodies';
  return m;
}
