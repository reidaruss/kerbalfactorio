// THE ONE rebase authority (ARCHITECTURE.md section 3.6). There is exactly one
// emit site for OriginRebased in the whole codebase and it is below. The UE layer
// grew four hand-rolled Reanchor* copies inside one class; the structural fix is
// that subscribers never re-derive a delta, they re-derive their engine transform
// from their cached 64-bit anchor through toEngine().
//
// W1 uses this at its degenerate setting (the observer is the origin). W2 turns
// the threshold up to of::FloatingOrigin's 4 km and adds the walk.

import type * as THREE from 'three';
import type { Events } from '../app/Events.js';
import type { Vec3d } from './PlanetBody.js';

export class FloatingOrigin {
  /** Body-frame f64 position that maps to engine (0,0,0). */
  readonly origin: Vec3d = { x: 0, y: 0, z: 0 };
  readonly lastDelta: Vec3d = { x: 0, y: 0, z: 0 };
  rebases = 0;

  constructor(private readonly events: Events, public thresholdM = 4000) {}

  /** Returns true if this step moved the origin. Call before any render read. */
  step(observer: Vec3d): boolean {
    const dx = observer.x - this.origin.x;
    const dy = observer.y - this.origin.y;
    const dz = observer.z - this.origin.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const t = this.thresholdM;
    if (this.rebases > 0 && d2 < t * t) return false;

    this.origin.x = observer.x;
    this.origin.y = observer.y;
    this.origin.z = observer.z;
    this.lastDelta.x = -dx;
    this.lastDelta.y = -dy;
    this.lastDelta.z = -dz;
    this.rebases++;
    // THE ONLY OriginRebased EMIT SITE.
    this.events.emit('OriginRebased', { dx: -dx, dy: -dy, dz: -dz });
    return true;
  }

  /** f64 body-frame -> engine-space metres. The subtraction happens in f64. */
  toEngine(p: Vec3d, out: THREE.Vector3): THREE.Vector3 {
    return out.set(p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z);
  }
}
