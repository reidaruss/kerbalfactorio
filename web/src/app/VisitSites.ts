// GP-167 / GP-168. VISIT SITE: teleport on foot to the seven surveyed spawn
// candidates, from the cheat panel. Reid asked "can I like teleport to other
// biomes to check them out somehow", and the seven places worth checking out
// already exist: the WG-55 spawn survey shortlisted them, photographed them and
// measured them (docs/controllers/world-gen.md sections 6.1 and 6.2). This is
// also his spawn-decision tool: the pick is a pending decision he owns, and
// each row carries the one line that makes its site a DIFFERENT place, so he is
// choosing between true statements rather than between button names.
//
// THE COORDINATES ARE COPIED FROM THE DOC, and that is stated rather than
// hidden: the survey's numbers were only ever passed to `probes/sitelook.js` as
// command-line arguments, so the section 6.1 table IS the machine-readable
// source of record and there is no second one to cross-check against. `groundM`
// is the survey's designed ground height at each site; the probe asserts
// arrival against it, which is what catches a mistyped digit here (a wrong
// latitude does not land at the right altitude).
//
// THE TELEPORT IS NOT WRITTEN HERE. `pressVisit` is handed the ONE ground
// teleport authority the client has, the path `__of.teleport` and every site
// probe already drives (Debug.ts -> ViewRouter.teleport -> the walker's own
// spawn, which puts the feet ON the designed surface, grounded, at rest). A
// second teleport in this file would be a second authority, which is this
// project's catalogued failure shape.
//
// WHY THE GUARD IS "ABOARD" AND NOT "A CRAFT EXISTS": ViewRouter routes the
// teleport to the ACTIVE view source, and a vessel's `teleport()` is by design
// a no-op ("a vessel is rolled out, never teleported", VesselObserver.ts). So a
// press while flying would report success and move nothing, which is worse
// than a refusal. A craft parked on the pad is fine: the walker is the source.

import { labelOf } from '../player/Bindings.js';
import type { CheatRow } from '../ui/PauseMenu.js';
import type { FlightMode } from './FlightMode.js';

export interface VisitSite {
  id: string;
  label: string;
  /** What makes this site a different place, in one line, off sections 6.1/6.2:
   *  best-ever noon sun (Forge has no axial tilt, so it is permanent), the
   *  treeline, and the ground. */
  note: string;
  latDeg: number;
  lonDeg: number;
  /** The survey's designed ground height, m. The probe's arrival oracle. */
  groundM: number;
}

/** Doc order (world-gen.md section 6.1, "The candidates"): the control first. */
export const VISIT_SITES: readonly VisitSite[] = [
  { id: 'current', label: 'Mountains: the current spawn',
    note: 'the control, 4,668 m: noon sun 69.2 deg, snow props, 1,174 m of '
      + 'relief in 6 km. The survey ranks it last of 21',
    latDeg: 2.0, lonDeg: 144.0, groundM: 4667.8 },
  { id: 'hills', label: 'Hills: the valley floor',
    note: '2,077 m, ABOVE the treeline: no forest at all. Noon sun 36.1 deg. '
      + 'The survey\'s own recommendation on the numbers',
    latDeg: -31.165, lonDeg: -86.27401, groundM: 2077.2 },
  { id: 'hills2', label: 'Hills: the treeline view',
    note: '1,897 m, ON the treeline: 79% bare, wooded slopes falling away. The '
      + 'highest sun on the planet, 89.5 deg at noon',
    latDeg: 22.286, lonDeg: 108.84406, groundM: 1897.2 },
  { id: 'plains', label: 'Plains: the basin',
    note: '332 m: open grass with isolated copses, noon sun 59.3 deg. The most '
      + 'expensive frame of the seven (2.66 M triangles)',
    latDeg: -7.9675, lonDeg: 116.53189, groundM: 331.8 },
  { id: 'beach', label: 'Beach: the desert',
    note: '12 m: THE DESERT. The flattest ground on the planet, bare pale sand '
      + 'and dry scrub, no trees ever. Noon sun 31.6 deg',
    latDeg: -35.6028, lonDeg: 53.30131, groundM: 12.2 },
  { id: 'beach2', label: 'Beach: permanent golden light',
    note: '8 m: flatter still, but the sun NEVER rises above 9.3 deg here, so '
      + 'it is low golden light at every hour of every day',
    latDeg: -57.938, lonDeg: -85.626, groundM: 8.3 },
  { id: 'forest', label: 'Forest',
    note: '27 m: the densest canopy of the seven, 1,560 trees in one frame. '
      + 'Noon sun 47.4 deg',
    latDeg: -19.85, lonDeg: -72.7853, groundM: 27.3 },
];

/** Eye height handed to the teleport. The walker's spawn snaps the feet to the
 *  designed surface and ignores it (Controller.teleport), so the value only
 *  matters to a free camera; 2.0 is what sitelook.js has always passed. */
export const VISIT_EYE_ALT_M = 2.0;

/** Why no site can be visited right now, or ''. One sentence, naming the keys
 *  that fix it, off the binding table and never a literal (GP-140). */
export function visitBlocked(f: FlightMode | null): string {
  return f !== null && f.aboard
    ? `you are aboard a vessel: get out first (${labelOf('board')} to `
      + `disembark, ${labelOf('recover')} clears the pad)`
    : '';
}

/** The rows the panel draws. Derived per view, like every other row. */
export function visitRows(f: FlightMode | null): CheatRow[] {
  const blocked = visitBlocked(f);
  return VISIT_SITES.map((s) => ({
    id: `visit:${s.id}`, label: s.label, note: s.note,
    kind: 'button' as const, blocked }));
}

export interface VisitOutcome {
  done: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Handle a `visit:` press, or null for an id this file does not own.
 *
 * THE RECEIPT IS TERMINAL, not pending (GP-155's lesson checked, not just
 * cited): the teleport writes the feet synchronously, so by the time this
 * returns the player IS at the site. What follows is streaming, and the world
 * already reports that on its own channel (`chunks.converged`).
 */
export function pressVisit(id: string, f: FlightMode | null,
  teleport: (latDeg: number, lonDeg: number, altM: number) => void,
): VisitOutcome | null {
  if (!id.startsWith('visit:')) return null;
  const s = VISIT_SITES.find((x) => `visit:${x.id}` === id) ?? null;
  if (s === null) return { done: false, message: `no such site: ${id.slice(6)}` };
  const blocked = visitBlocked(f);
  if (blocked !== '') return { done: false, message: `refused: ${blocked}` };
  teleport(s.latDeg, s.lonDeg, VISIT_EYE_ALT_M);
  return {
    done: true,
    message: `standing at ${s.label} (lat ${s.latDeg}, lon ${s.lonDeg}) while `
      + 'the ground streams in',
    detail: { site: s.id, latDeg: s.latDeg, lonDeg: s.lonDeg,
      groundM: s.groundM },
  };
}
