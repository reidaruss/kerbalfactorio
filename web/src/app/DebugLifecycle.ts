// The driven surface for the world lifecycle (CE-19 / CE-20). Two reads and one
// verb, exposed on `window.__of` so a probe can tear the world down and measure
// what is left rather than looking at a screenshot and hoping.
//
// It is DEBUG-ONLY on purpose. Nothing in the game calls `reboot`, and the
// reason is worth writing down rather than leaving as an omission: a body switch
// is not yet correct end to end. The body scope rebuilds cleanly, and a measured
// residue of collaborators outside it keep the previous body's radius and handle
// (see `stale` below). Wiring this to a door the player can walk through before
// that residue is zero would ship the bug rather than the seam.

import type { Services } from './Services.js';
import type { BodyId } from '../world/PlanetBody.js';
import { discoveryScopeReport } from '../world/DiscoveryScope.js';
import { worldScopeReport } from '../game/WorldScope.js';

/** What still believes in the previous body after a switch. */
export interface StaleHolder {
  readonly holder: string;
  readonly field: string;
  /** What it currently answers. */
  readonly value: number | string;
  /** What the live body says. Equal means this holder is fine. */
  readonly live: number | string;
  readonly stale: boolean;
}

export function lifecycleApi(s: Services): Record<string, unknown> {
  return {
    /**
     * Everything the lifecycle can be measured by, in one object: the epoch, the
     * body, the teardown steps currently registered, the per-key event
     * subscriber and emit counts, and the main-thread WASM handle census.
     */
    life(): unknown {
      return {
        ...s.session.audit(),
        terrain: {
          disposed: s.terrain.isDisposed,
          resident: s.terrain.residentViews.size,
          workerHandles: s.session.workerHandles,
        },
        origin: {
          rebases: s.origin.rebases,
          x: s.origin.origin.x, y: s.origin.origin.y, z: s.origin.origin.z,
        },
        // PS-46. Which body /core's one discovery field is cut for, and the
        // streams this session is holding for the bodies it is not standing on.
        // Beside `stale` because it is the same kind of fact: what survived the
        // switch, measured off the thing that owns it rather than inferred.
        discovery: discoveryScopeReport(),
        // PS-49. Whether the body-scoped half of the save is still the live
        // world or a frozen reading of it, beside `discovery` and `stale` for
        // their reason: what survived the switch, measured off the thing that
        // owns it. `frozen` true is the state in which nothing built, dug or
        // mined is being saved, so it is the first thing to look at when a
        // rebooted session's world stops changing on disk.
        world: worldScopeReport(),
        stale: staleHolders(s),
      };
    },

    /**
     * Tear the body scope down and build it again. No argument is a SAME-BODY
     * reboot, which is the negative control: everything must come back.
     */
    async reboot(bodyId?: number): Promise<unknown> {
      const to = bodyId === undefined ? undefined : (bodyId === 1 ? 1 : 0) as BodyId;
      const r = await s.session.reboot(to);
      if (r.fromBodyId !== r.toBodyId) {
        // Loud, once, at the moment the residue is created. A warning that only
        // exists in a report nobody opens is not a warning.
        const bad = staleHolders(s).filter((h) => h.stale).map((h) => `${h.holder}.${h.field}`);
        if (bad.length > 0) {
          console.warn(`[of] body switch ${r.fromBodyId} -> ${r.toBodyId}: `
            + `${bad.length} collaborator(s) still hold the previous body: ${bad.join(', ')}`);
        }
      }
      return r;
    },
  };
}

/**
 * WHO STILL BELIEVES IN THE OLD BODY, measured rather than greppped.
 *
 * A static search for `bodyRadiusM` finds every copy and cannot tell which ones
 * matter; this asks each holder what it currently answers and compares it with
 * the live body. That distinction is the whole value: a holder whose copy
 * happens to be re-read per frame reads CLEAN here and would read as a defect in
 * a grep, and a holder that caches something derived (a proxy's baked geometry
 * radius) reads as a defect here and is invisible to a grep.
 *
 * The list is deliberately incomplete and says so. It covers what `Services`
 * can reach without importing another domain's internals. Everything it cannot
 * see is named in core-engine.md rather than pretended away.
 */
export function staleHolders(s: Services): StaleHolder[] {
  const live = s.body;
  const out: StaleHolder[] = [];
  const row = (holder: string, field: string, value: number | string,
    against: number | string): void => {
    out.push({ holder, field, value, live: against, stale: value !== against });
  };

  row('oracle', 'body.radiusM', s.oracle.body.radiusM, live.radiusM);
  // PS-46 / GP-725. THE DISCOVERY FIELD WAS NOT ON THIS LIST, which is a large
  // part of why it went unnoticed: /core keeps ONE `g_disc` whose lattice
  // resolution is a function of the body radius, so a field left cut for the
  // previous body silently records the new body's walking at the old body's cell
  // size. It is asked the same question everything else here is asked, and the
  // answer comes off `_of_disc_report[15]` rather than from anything the client
  // wrote down. `map` is null under `?flight=0`, where there is no driver to ask.
  const disc = s.map?.discovery ?? null;
  if (disc !== null) row('discovery', 'bodyRadiusM', disc.stats().bodyRadiusM, live.radiusM);
  row('oracle.water', 'body.radiusM', s.oracle.water.body.radiusM, live.radiusM);
  row('proxy', 'bodyName', s.proxy.mesh.name, `${live.name}Proxy`);
  row('sky', 'uPlanetR', s.sky.atmos.uPlanetR.value, live.radiusM);
  row('scatter', 'bodyRadiusM', s.scatter.bodyRadiusForAudit, live.radiusM);
  if (s.voxelMesh !== null) row('voxelMesh', 'bodyHandle', s.voxelMesh.bodyHandleForAudit, live.handle);
  if (s.gameplay !== null) {
    const g = s.gameplay as unknown as { d?: { bodyHandle?: number; bodyRadiusM?: number } };
    if (g.d?.bodyHandle !== undefined) row('gameplay', 'bodyHandle', g.d.bodyHandle, live.handle);
    if (g.d?.bodyRadiusM !== undefined) row('gameplay', 'bodyRadiusM', g.d.bodyRadiusM, live.radiusM);
  }
  if (s.flight !== null) {
    const f = s.flight as unknown as { d?: { bodyHandle?: number; bodyRadiusM?: number } };
    if (f.d?.bodyHandle !== undefined) row('flight', 'bodyHandle', f.d.bodyHandle, live.handle);
    if (f.d?.bodyRadiusM !== undefined) row('flight', 'bodyRadiusM', f.d.bodyRadiusM, live.radiusM);
  }
  return out;
}
