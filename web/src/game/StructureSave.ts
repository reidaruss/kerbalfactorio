// The structural half of the save slot, and the report the probes read.
//
// A part is saved with the transform it was BUILT with, not with the address it
// was built at, because a restore must not depend on re-deriving a site frame
// from a seed: the frame is player state the moment the first foundation goes
// down. The address rides along anyway, so a base loaded from a slot still snaps
// the next wall onto the same grid rather than founding a second site on top of
// the first.
//
// The sites go with it for the same reason. Without them a reload would leave a
// base standing but ungriddable, which is the quiet kind of persistence bug that
// only shows up when somebody tries to extend a room a week later.

import * as THREE from 'three';
import { STRUCTURE_KINDS, type Addr, type Site, type StructureKind }
  from './StructureGrid.js';
import type { Structures } from './Structures.js';

export interface SaveSite {
  id: number;
  o: [number, number, number];
  up: [number, number, number];
  east: [number, number, number];
  north: [number, number, number];
  baseR: number;
}

export interface SaveStructure {
  kind: string;
  site: number;
  key: string;
  /** i, j, level, axis, flip. Empty for a freely placed part. */
  addr: number[];
  pos: [number, number, number];
  up: [number, number, number];
  fwd: [number, number, number];
  open: boolean;
}

export function saveSites(s: Structures): SaveSite[] {
  return s.sites.map((t) => ({
    id: t.id,
    o: [t.o.x, t.o.y, t.o.z],
    up: [t.up.x, t.up.y, t.up.z],
    east: [t.east.x, t.east.y, t.east.z],
    north: [t.north.x, t.north.y, t.north.z],
    baseR: t.baseR,
  }));
}

export function saveParts(s: Structures): SaveStructure[] {
  return s.parts.map((p) => ({
    kind: p.kind, site: p.siteId, key: p.key,
    addr: p.addr === null ? []
      : [p.addr.i, p.addr.j, p.addr.level, p.addr.axis, p.addr.flip],
    pos: [p.pos.x, p.pos.y, p.pos.z],
    up: [p.up.x, p.up.y, p.up.z],
    fwd: [p.fwd.x, p.fwd.y, p.fwd.z],
    open: p.wantOpen,
  }));
}

/**
 * Put a saved base back. Returns how many parts came back.
 *
 * Nothing is PAID here, and that is the point: the cost was spent when the part
 * was built and the save records the world after that. Charging again on load
 * would bill a player for their own house every time they opened the page.
 */
export function restoreStructures(s: Structures, sites: readonly SaveSite[],
                                  rows: readonly SaveStructure[]): number {
  s.reset();
  for (const t of sites) {
    const site: Site = {
      id: t.id,
      o: { x: t.o[0], y: t.o[1], z: t.o[2] },
      up: new THREE.Vector3(t.up[0], t.up[1], t.up[2]),
      east: new THREE.Vector3(t.east[0], t.east[1], t.east[2]),
      north: new THREE.Vector3(t.north[0], t.north[1], t.north[2]),
      baseR: t.baseR,
    };
    s.adoptSite(site);
  }
  let n = 0;
  for (const r of rows) {
    const kind = r.kind as StructureKind;
    if (!STRUCTURE_KINDS.includes(kind)) continue;
    const def = s.defFor(kind);
    if (def === null) continue;
    const addr: Addr | null = r.addr.length === 5
      ? { kind, i: r.addr[0], j: r.addr[1], level: r.addr[2],
        axis: r.addr[3] === 1 ? 1 : 0, flip: r.addr[4] === 1 ? 1 : 0 }
      : null;
    const up = new THREE.Vector3(r.up[0], r.up[1], r.up[2]);
    const fwd = new THREE.Vector3(r.fwd[0], r.fwd[1], r.fwd[2]);
    // The quaternion is rebuilt from up and fwd inside `adopt`, through the SAME
    // `orient` the placement used, so a restored wall faces exactly where it
    // faced and no rounding creeps in through a saved quaternion.
    const p = s.adopt(kind, def, r.site, addr, r.key,
      { x: r.pos[0], y: r.pos[1], z: r.pos[2] }, up, fwd);
    p.wantOpen = r.open;
    p.swing = r.open ? 1 : 0;
    p.solid.shut = !r.open;
    n++;
  }
  return n;
}

/** Everything a probe needs to check a base without reaching into the model. */
export function structureReport(s: Structures): unknown {
  return {
    ready: s.ready,
    module: s.module,
    tolerance: { floatM: s.floatToleranceM, buryM: s.buryToleranceM },
    swing: { secs: s.swingSecs, rad: +s.swingRad.toFixed(5) },
    placements: s.placements,
    refusals: s.refusals,
    unevenRefusals: s.unevenRefusals,
    removals: s.removals,
    sites: s.sites.length,
    costs: STRUCTURE_KINDS.map((k) => ({ kind: k, cost: s.costText(k),
      item: s.defFor(k)?.item ?? 0, typeId: s.defFor(k)?.typeId ?? 0 })),
    parts: s.parts.map((p) => ({
      id: p.id, kind: p.kind, site: p.siteId, key: p.key,
      addr: p.addr === null ? null
        : [p.addr.i, p.addr.j, p.addr.level, p.addr.axis, p.addr.flip],
      pos: [p.pos.x, p.pos.y, p.pos.z],
      open: p.wantOpen, swing: +p.swing.toFixed(3), shut: p.solid.shut,
    })),
  };
}
