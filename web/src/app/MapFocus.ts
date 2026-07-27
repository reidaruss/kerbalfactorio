// =============================================================================
// MapFocus.ts - what the map is looking at, and therefore from where.
//
// R17 named the centring as the change and it turns out to be two things, not
// one: a focus supplies the projection's ORIGIN and also the axis it looks down.
// Both belong to the focus and neither belongs to the zoom, and that is the
// decision worth defending here.
//
// WHY THE AXIS IS NOT A FUNCTION OF SCALE. The obvious build of "one continuous
// map" is to slew the projection from a plan view of the ground into the orbital
// plane as you zoom out. It looks right and it is wrong, because it makes the
// map's most valuable property - that a conic drawn down its own orbit normal is
// EXACT rather than a simplification (MapTypes' header) - depend on how far the
// wheel has been turned. A maneuver planned at one zoom would foreshorten at
// another.
//
// Putting the axis on the FOCUS instead costs nothing and fixes it:
//
//   * focus YOU  -> origin is where you stand, axis is your own radial. That is
//     a plan view looking straight down at the ground, at every zoom, which is
//     the "centered around the player" Reid asked for. Zoom out from it and the
//     orbits are still drawn, foreshortened, and the panel says so.
//   * focus a VESSEL -> origin is the vessel, axis is ITS orbit normal. The
//     conic is exact, which is the behaviour that shipped and is what the node
//     workflow depends on.
//   * focus the BODY -> origin is the body centre. This is the old map exactly:
//     `centreM` of [0,0,0] reproduces the pre-DW-36 projection bit for bit,
//     which is what makes this a widening rather than a replacement.
//
// So there is no zoom threshold anywhere, and switching what you are looking at
// is a thing the player chose rather than a thing the wheel did to them.
// =============================================================================
import type { V3 } from '../ui/MapTypes.js';

export interface FocusTarget {
  readonly name: string;
  /** The projection origin, body-centred inertial metres. */
  readonly centreM: V3;
  /** The axis the projection looks down, unnormalised is fine. */
  readonly pole: V3;
  /** That axis IN WORDS, for the footer. It travels with the focus rather than
   *  being a constant in the painter, because the two answers are different
   *  claims: down an orbit normal the conic is exact, down your own radial it
   *  is foreshortened, and a map that states the first while drawing the second
   *  is lying in the one place it promised not to. */
  readonly axisName: string;
}

/** Where the candidates come from. Nulls are normal: on foot there is no
 *  vessel, and in flight the player is the vessel. */
export interface FocusSources {
  /** Where the player is standing, body-frame metres. */
  player(): { x: number; y: number; z: number } | null;
  /** The live vessel: its position and its orbit normal, both from /core. */
  vessel(): { pos: V3; normal: V3; name: string } | null;
  bodyName: string;
}

function unit(a: V3, fallback: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (!Number.isFinite(l) || l < 1e-12) return fallback;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export class MapFocus {
  /** The player's own name for the option, not an index: an index would shift
   *  under them the moment a vessel appeared. */
  private want = 'you';
  /** Kept across frames and re-orthogonalised rather than rebuilt, so a
   *  near-circular orbit's map does not SPIN (periapsis is arbitrary there) and
   *  a plane change follows smoothly. Moved here from MapMode with the pole,
   *  because the two are one answer. */
  private planeU: V3 = [1, 0, 0];

  constructor(private readonly s: FocusSources) {}

  /** Every focus the player may choose right now, in a stable order. */
  options(): string[] {
    const out: string[] = [];
    if (this.s.player() !== null) out.push('you');
    const v = this.s.vessel();
    if (v !== null) out.push(v.name);
    out.push(this.s.bodyName);
    return out;
  }

  /** Ask for a focus by name. An unknown name is ignored rather than throwing:
   *  the list changes under the player (a rocket lands, they get out) and a
   *  stale button press is not an error. */
  set(name: string): void {
    if (this.options().includes(name)) this.want = name;
  }

  get selected(): string { return this.want; }

  /**
   * The focus in force THIS frame, which is not always the one asked for: a
   * vessel that was destroyed or a player who boarded takes their option with
   * them. Falling back silently is right here and the report says which one won,
   * so a probe can tell a fallback from a choice.
   */
  current(): FocusTarget {
    const opts = this.options();
    const name = opts.includes(this.want) ? this.want : (opts[0] ?? 'body');
    const v = this.s.vessel();
    if (v !== null && name === v.name) {
      return { name, centreM: v.pos, pole: this.hold(v.normal),
        axisName: 'down the orbit normal' };
    }
    const p = this.s.player();
    if (p !== null && name === 'you') {
      const c: V3 = [p.x, p.y, p.z];
      // Straight down. The player's own radial IS the plan view's axis, so this
      // needs no choice and cannot drift.
      return { name, centreM: c, pole: this.hold(unit(c, [0, 1, 0])),
        axisName: 'straight down at the ground' };
    }
    // The body. Keep whatever axis is meaningful - a live orbit's normal if
    // there is one, the player's radial otherwise - so `centreM` of [0,0,0]
    // reproduces the map that shipped.
    const pole = v !== null ? v.normal
      : (p !== null ? unit([p.x, p.y, p.z], [0, 1, 0]) : [0, 1, 0] as V3);
    return { name: opts.includes(this.want) ? name : (opts[0] ?? name),
      centreM: [0, 0, 0], pole: this.hold(pole),
      axisName: v !== null ? 'down the orbit normal' : 'down your own radial' };
  }

  /** The in-plane axes for a pole. `planeU` is projected onto the plane rather
   *  than rebuilt from it, which is what keeps the picture from spinning. */
  basis(pole: V3): { u: V3; v: V3 } {
    const n = unit(pole, [0, 1, 0]);
    const u = this.planeU;
    const d = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
    let x = u[0] - n[0] * d, y = u[1] - n[1] * d, z = u[2] - n[2] * d;
    let l = Math.hypot(x, y, z);
    if (l < 1e-6) {
      // Degenerate only when the stored axis has become the pole itself. Seed
      // off whichever world axis is least aligned with it.
      const s: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const k = s[0] * n[0] + s[1] * n[1] + s[2] * n[2];
      x = s[0] - n[0] * k; y = s[1] - n[1] * k; z = s[2] - n[2] * k;
      l = Math.hypot(x, y, z) || 1;
    }
    this.planeU = [x / l, y / l, z / l];
    const p = this.planeU;
    return {
      u: p,
      v: [n[1] * p[2] - n[2] * p[1], n[2] * p[0] - n[0] * p[2],
        n[0] * p[1] - n[1] * p[0]],
    };
  }

  /** Re-orthogonalise on every read so `current()` and `basis()` cannot
   *  disagree about which frame they are in. */
  private hold(pole: V3): V3 { return unit(pole, [0, 1, 0]); }

  report(): unknown {
    const c = this.current();
    return { want: this.want, active: c.name, options: this.options(),
      fallback: c.name !== this.want, centreM: c.centreM, pole: c.pole };
  }
}
