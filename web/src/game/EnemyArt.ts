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

/**
 * A creature at unit size: about 2 m long, 1.2 m tall, standing on y = 0 and
 * facing +Z, which is the convention every other placed thing in this client
 * uses for its forward axis.
 */
export function creatureGeometry(tint: number): THREE.BufferGeometry {
  const dark = new THREE.Color(tint).multiplyScalar(0.55);
  const body = new THREE.Color(tint);
  const parts: THREE.BufferGeometry[] = [
    // Abdomen and thorax: two blocks, the rear one heavier.
    tinted(put(new THREE.BoxGeometry(0.78, 0.60, 0.90), 0, 0.62, -0.34), body),
    tinted(put(new THREE.BoxGeometry(0.64, 0.50, 0.62), 0, 0.66, 0.30), body),
    // A wedge of a head, pointing the way it walks.
    tinted(put(new THREE.ConeGeometry(0.30, 0.62, 4), 0, 0.66, 0.82,
      Math.PI * 0.5), dark),
    // Four legs, splayed. Cheap boxes: at the ranges a swarm is read at, a leg
    // is a silhouette rather than a shape.
    tinted(put(new THREE.BoxGeometry(0.13, 0.66, 0.13), -0.40, 0.33, -0.34), dark),
    tinted(put(new THREE.BoxGeometry(0.13, 0.66, 0.13), 0.40, 0.33, -0.34), dark),
    tinted(put(new THREE.BoxGeometry(0.13, 0.62, 0.13), -0.38, 0.31, 0.26), dark),
    tinted(put(new THREE.BoxGeometry(0.13, 0.62, 0.13), 0.38, 0.31, 0.26), dark),
    // A back plate, so a creature seen from above is not a flat rectangle.
    tinted(put(new THREE.ConeGeometry(0.34, 0.36, 5), 0, 1.00, -0.30), dark),
  ];
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
