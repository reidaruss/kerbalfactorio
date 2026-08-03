// THE ONE rebase authority (ARCHITECTURE.md section 3.6). There is exactly one
// emit site for OriginRebased in the whole codebase and it is below. The UE layer
// grew four hand-rolled Reanchor* copies inside one class; the structural fix is
// that subscribers never re-derive a delta, they re-derive their engine transform
// from their cached 64-bit anchor through toEngine().
//
// W1 uses this at its degenerate setting (the observer is the origin). W2 turns
// the threshold up to of::FloatingOrigin's 4 km and adds the walk.
//
// OWNER: core-engine (CE-21). Floating origin has been in that domain's charter
// since the project began ("64-bit coordinates, floating origin, reference
// frames, the active/on-rails framework") and this file nevertheless carried no
// decision tag and was named in no controller document for a year, which is how
// the lifecycle around it came to be nobody's. The class itself was always fine.
// What was missing was an owner for the questions this file cannot answer on its
// own: who unsubscribes, and what the origin MEANS when the body underneath it
// changes. See `reseat` below for the second one.

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

  /**
   * CE-21. FORGET THE OLD BODY'S ORIGIN, without broadcasting a rebase.
   *
   * A `UniverseCoord` is meaningless without its frame, and this class holds a
   * body-frame position. On a body switch the stored origin is not merely stale,
   * it is nonsense: `{x:0, y:600000, z:0}` is a point on Forge's surface and a
   * point three body-radii above Cinder, so the next `step()` would measure the
   * observer's drift against a coordinate from a different world and, worse,
   * would find it further than 4 km and emit a rebase whose delta is the
   * distance between two planets.
   *
   * Deliberately SILENT. `OriginRebased` means "the same world moved under you,
   * re-derive your transform from your 64-bit anchor", and every subscriber acts
   * on exactly that. A body switch is not that event: the anchors themselves are
   * gone, so a subscriber that dutifully re-derived would re-derive from a
   * coordinate in the previous frame. The correct handling of a body switch is
   * for the body-scoped objects to be TORN DOWN and rebuilt, which is
   * `WorldSession`'s job, and for the ones that survive to be re-seated
   * explicitly. Emitting here would give them a third, wrong option.
   *
   * `rebases` is reset to 0 so the next `step()` seats the origin on the new
   * observer unconditionally, which is the same first-step behaviour boot has.
   */
  reseat(observer: Vec3d): void {
    this.origin.x = observer.x;
    this.origin.y = observer.y;
    this.origin.z = observer.z;
    this.lastDelta.x = 0;
    this.lastDelta.y = 0;
    this.lastDelta.z = 0;
    this.rebases = 0;
  }

  /** f64 body-frame -> engine-space metres. The subtraction happens in f64. */
  toEngine(p: Vec3d, out: THREE.Vector3): THREE.Vector3 {
    return out.set(p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z);
  }
}
