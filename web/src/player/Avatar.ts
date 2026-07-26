// The player's own body, as a placeholder capsule until W4 brings the rigged
// mesh. It exists at W2 for one structural reason: ARCHITECTURE.md section 3.4
// says the character sits on LAYER_PLAYER_BODY and the FIRST-PERSON camera
// disables that layer, so the M3.1b "FP black slab self-shadow" bug is fixed by
// construction rather than by a workaround. Wiring that at W2 means the shadow
// pass at W3 inherits it for free.
//
// It is world-anchored, so it re-derives from the 64-bit feet position every
// frame and needs no rebase subscription of its own.

import * as THREE from 'three';
import { LAYER_PLAYER_BODY } from '../render/Scenes.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';
import type { Vec3d } from '../world/PlanetBody.js';
import { CAPSULE } from './KinematicBody.js';

export class Avatar {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly basis = new THREE.Matrix4();
  private readonly zero = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  constructor() {
    const shaft = CAPSULE.heightM - 2 * CAPSULE.radiusM;
    this.body = new THREE.Mesh(
      new THREE.CapsuleGeometry(CAPSULE.radiusM, shaft, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xd8813a, roughness: 0.7, metalness: 0.05 }),
    );
    this.body.position.y = CAPSULE.heightM * 0.5;
    this.head = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.16, 0.26),
      new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.4 }),
    );
    // A visor on the front, so a TP screenshot shows which way the body faces.
    this.head.position.set(0, CAPSULE.eyeHeightM, -CAPSULE.radiusM * 0.75);
    this.group.add(this.body);
    this.group.add(this.head);
    this.group.name = 'playerBody';
    this.group.traverse((o) => { o.layers.set(LAYER_PLAYER_BODY); });
    this.group.matrixAutoUpdate = false;
  }

  /** Stand the capsule on `feet`, facing `aim` projected into the tangent plane. */
  place(origin: FloatingOrigin, feet: Vec3d, up: THREE.Vector3, aim: THREE.Vector3): void {
    const g = this.group;
    origin.toEngine(feet, g.position);
    // -Z is the model's forward, so look from the origin ALONG the flattened aim.
    const fx = aim.x - up.x * aim.dot(up);
    const fy = aim.y - up.y * aim.dot(up);
    const fz = aim.z - up.z * aim.dot(up);
    const l = Math.hypot(fx, fy, fz);
    if (l > 1e-6) {
      // Matrix4.lookAt(eye, target, up) points -Z at the target, and -Z is the
      // model's forward, so the target IS the flattened aim direction.
      this.basis.lookAt(this.zero, this.fwd.set(fx / l, fy / l, fz / l), up);
      g.quaternion.setFromRotationMatrix(this.basis);
    }
    g.updateMatrix();
    g.updateMatrixWorld(true);
  }
}
