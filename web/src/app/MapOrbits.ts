// =============================================================================
// MapOrbits.ts - the trajectory lines the 3D map draws (GP-207).
//
// NOTHING HERE COMPUTES A TRAJECTORY, same rule as the flat map, held the same
// way. The flying vessel's line is the SAME 192-point `of_mn_path` polyline the
// flat map has always drawn (it arrives in MapScene.current/planned). A rails
// vessel's line is `stateOf` (`_of_orb_resume`, one Kepler solve per sample)
// swept across ONE period of its published elements: /core answers "where is it
// at time t" 192 times and this file connects the answers. Nothing integrates,
// and no ellipse is re-derived in TypeScript, so an axis-convention mistake
// here is structurally impossible: the line is made of the same solver output
// the marker is (PH-65's rule: on rails, elements do not drift).
//
// REBUILD ONLY ON CHANGE. A rails line's geometry is keyed on the element
// record; on rails the elements are frozen, so a parked fleet costs zero
// rebuilds per frame. The flying vessel's line rewrites a preallocated buffer
// in place every frame, because under thrust or in air its conic genuinely
// changes (the flat map repainted it every frame for the same reason).
//
// Materials are stock LineBasicMaterial throughout: zero DW-10 ledger slots.
// =============================================================================
import * as THREE from 'three';
import { FAR_SCALE } from '../render/Scenes.js';
import { registry, stateOf, RAILS_DT } from '../sim/VesselRegistry.js';
import type { VesselRecord } from '../sim/VesselRegistry.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { MapConic } from '../ui/MapTypes.js';
import { bodyIdOf } from '../world/VesselBody.js';

/** Samples per rails orbit. The flat map's own count, for the same picture. */
const RAIL_SAMPLES = 192;
/** Vertex capacity of the two per-frame lines (flight and planned). */
const FLIGHT_CAP = 256;

export const COLOUR_CURRENT = 0x59d3e8;
export const COLOUR_PLANNED = 0xffa64d;
export const COLOUR_RAILS = 0x9ad48a;
export const COLOUR_SELECTED = 0xffffff;

/** One period of a rails vessel's orbit, in body-centred metres, sampled by
 *  /core. Empty when the record has no bound conic to sweep (parked or frozen
 *  vessels have a fixed position, and an unbound e >= 1 has no period). */
export function railsPathM(M: OfCoreModule, rec: VesselRecord,
                           tick: number): Float64Array {
  if (rec.where.kind !== 'conic') return new Float64Array(0);
  const el = rec.where.el;
  if (!(el.e < 1) || !(el.a > 0) || !(el.mu > 0)) return new Float64Array(0);
  const periodS = 2 * Math.PI * Math.sqrt((el.a ** 3) / el.mu);
  if (!Number.isFinite(periodS) || periodS <= 0) return new Float64Array(0);
  const out = new Float64Array(RAIL_SAMPLES * 3);
  for (let k = 0; k < RAIL_SAMPLES; ++k) {
    // Fractional ticks are fine: clockAt is linear in the tick.
    const t = tick + (k / RAIL_SAMPLES) * (periodS / RAILS_DT);
    const st = stateOf(M, registry, rec, t);
    out[k * 3] = st.pos[0]; out[k * 3 + 1] = st.pos[1]; out[k * 3 + 2] = st.pos[2];
  }
  return out;
}

function makeLine(capacity: number, colour: number, loop: boolean): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',
    new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ color: colour });
  const line = loop ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
  line.frustumCulled = false;
  return line;
}

/** Write body-centred metres into a line's buffer at FAR_SCALE. */
function writePoints(line: THREE.Line, pts: Float64Array): number {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  const n = Math.min(Math.floor(pts.length / 3), attr.count);
  const a = attr.array as Float32Array;
  for (let i = 0; i < n * 3; ++i) a[i] = pts[i] * FAR_SCALE;
  attr.needsUpdate = true;
  line.geometry.setDrawRange(0, n);
  line.visible = n > 1;
  return n;
}

export class OrbitLines {
  readonly group = new THREE.Group();
  private readonly current = makeLine(FLIGHT_CAP, COLOUR_CURRENT, false);
  private readonly planned = makeLine(FLIGHT_CAP, COLOUR_PLANNED, false);
  private readonly rails = new Map<number, { key: string; line: THREE.LineLoop }>();
  /** What the last sync drew, for the report. */
  drawn = { currentPoints: 0, plannedPoints: 0, railsLines: 0, rebuilds: 0,
            skippedElsewhere: 0 };

  constructor(private readonly M: OfCoreModule) {
    this.group.name = 'mapOrbits';
    this.group.add(this.current);
    this.group.add(this.planned);
  }

  /** The flying vessel's conics, straight from MapScene. Null clears. */
  syncFlight(current: MapConic | null, planned: MapConic | null): void {
    this.drawn.currentPoints =
      writePoints(this.current, current?.points ?? new Float64Array(0));
    this.drawn.plannedPoints =
      writePoints(this.planned, planned?.points ?? new Float64Array(0));
  }

  /**
   * One closed line per rails vessel, keyed on its frozen elements. `skipId`
   * is the promoted vessel, whose line is the flight line above.
   *
   * GP-650. `bodyId` IS THE FRAME THIS SCENE IS IN, and a record at any other
   * body is skipped. `stateOf` answers in the record's OWN body-centred metres
   * with no frame in the signature, so drawing a Forge conic here put a
   * 1,000,000 m ellipse around a 200 km moon: the arithmetic was right and the
   * frame was wrong, which is the quietest way for a picture to lie. Skipping
   * also disposes the line, because `seen` no longer holds it.
   */
  syncRails(list: readonly VesselRecord[], tick: number, skipId: number,
            selectedId: number, M: OfCoreModule, bodyId: number): void {
    const seen = new Set<number>();
    this.drawn.skippedElsewhere = 0;
    for (const rec of list) {
      if (rec.id === skipId || rec.where.kind !== 'conic') continue;
      if (bodyIdOf(M, rec, bodyId) !== bodyId) {
        this.drawn.skippedElsewhere += 1;
        continue;
      }
      const el = rec.where.el;
      const key = `${el.a}|${el.e}|${el.i}|${el.lan}|${el.argp}|${el.epoch}`;
      seen.add(rec.id);
      let entry = this.rails.get(rec.id);
      if (entry === undefined || entry.key !== key) {
        const pts = railsPathM(this.M, rec, tick);
        if (entry === undefined) {
          const line = makeLine(RAIL_SAMPLES, COLOUR_RAILS, true) as THREE.LineLoop;
          this.group.add(line);
          entry = { key, line };
          this.rails.set(rec.id, entry);
        } else {
          entry.key = key;
        }
        writePoints(entry.line, pts);
        this.drawn.rebuilds += 1;
      }
      (entry.line.material as THREE.LineBasicMaterial).color
        .setHex(rec.id === selectedId ? COLOUR_SELECTED : COLOUR_RAILS);
    }
    for (const [id, entry] of this.rails) {
      if (seen.has(id)) continue;
      this.group.remove(entry.line);
      entry.line.geometry.dispose();
      (entry.line.material as THREE.Material).dispose();
      this.rails.delete(id);
    }
    this.drawn.railsLines = this.rails.size;
  }

  dispose(): void {
    this.syncRails([], 0, 0, 0, this.M, 0);
    for (const l of [this.current, this.planned]) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  }
}
