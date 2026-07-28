// FS-43: A MACHINE'S IO IS GEOMETRY. A BELT CONNECTS TO A PORT, NOT TO A
// BUILDING.
//
// Reid, 2026-07-27: "for smelters, make it like satisfactory (the game) where
// you have specific slots that you belt things into and a specific slot for
// belting things out."
//
// THIS IS A MODEL CHANGE AND NOT A UI CHANGE, and the difference is worth
// stating because the old behaviour was also perfectly usable. Until now
// `FactoryWiring.wire` decided that two buildings were connected by measuring
// the distance between their CENTRES against a reach derived from their
// footprints. That is Factorio's model, where an inserter is a separate machine
// that reaches over a tile boundary and the two buildings it spans need no
// agreement about where their edges are. In Satisfactory a machine has physical
// ports on its housing, a belt terminates AT one, and the connection is a thing
// you can see and point at. The whole difference between the two is contained in
// this file: an adjacency test that asks about centres cannot be made to answer
// about faces, however the tolerance is tuned.
//
// THE PORTS WERE ALREADY IN THE ASSETS. Every machine `.glb` this project ships
// carries `socket_item_in` and `socket_item_out` as authored empty nodes, and
// every belt tile carries `socket_belt_in` and `socket_belt_out`; ASSET-SPECS
// 4.12 and 4.15 published them and FS-26 read them for SNAPPING. Nothing had
// ever read them for CONNECTING, so the geometry the player was aiming at and
// the geometry the wiring believed in were two different things that happened to
// agree most of the time. `web/scripts/check-proxies.mjs` now validates the
// declared socket set against the shipped nodes in both directions across all 48
// assets (FS-50), so this file is reading a checked contract rather than a
// convention.
//
// NOTHING HERE MAPS A SOCKET'S NAME TO A DIRECTION IN SPACE. That rule is
// FactorySnap's and it is repeated here because it matters more here: a port's
// FACE comes from the socket's own local position, resolved against the
// building's quaternion, so this file stays correct for any authored yaw and
// survives the art lane moving a hopper to another side of a housing. The name
// says only whether items go IN or OUT, which is what a name is legitimately
// for, and is exactly the distinction FactorySnap's `OUTWARD` set already drew.
//
// THE NUMBERS THIS MODEL RUNS ON, read out of the shipped bytes rather than
// transcribed from a build script (glTF local metres, +Z forward, +Y up):
//
//   smelter  socket_item_in  [0, 0.90, -1.0]   socket_item_out [0, 0.45, +1.0]
//   miner                    (no input port)   socket_item_out [0, 0.55, +1.0]
//   box      socket_item_in  [0, 0.60, -0.5]   socket_item_out [0, 0.60, +0.5]
//   belt     socket_belt_in  [0, 0.25, -0.5]   socket_belt_out [0, 0.25, +0.5]
//
// One convention across the whole set: items enter at local -Z and leave at
// local +Z. That is not something this file imposes; it is something it
// MEASURED, and if an asset ever stops obeying it the face derivation below
// still gets the right answer because it reads the position.

import * as THREE from 'three';
import type { BuildKind } from './FactoryKinds.js';
import { socketWorld, type SocketDef } from './FactorySnap.js';
import type { Vec3d } from '../world/PlanetBody.js';

/**
 * THE LEAST A THING NEEDS TO HAVE PORTS, and it is deliberately not `Placed`.
 *
 * A build GHOST has to be asked the same question a placed building is, so that
 * the sentence on screen before the button goes down is produced by the same
 * code that decides afterwards. That is the rule FactoryGhost's header already
 * states about refusals and it is worth more here than anywhere: a ghost that
 * says "this will connect" from one calculation and a commit that declines from
 * another is exactly the class of defect a port model is supposed to end.
 * `Placed` satisfies this structurally, so nothing at a call site changed.
 */
export interface PortHost {
  id: number;
  kind: BuildKind;
  pos: Vec3d;
  up: THREE.Vector3;
  quat: THREE.Quaternion;
}

/** Which way items cross a port. */
export type PortDir = 'in' | 'out';

/** One authored port, in its building's own local frame. */
export interface PortDef {
  /** The socket node's name, verbatim. The player is shown this. */
  name: string;
  dir: PortDir;
  local: THREE.Vector3;
  /**
   * The housing face it sits on, as a unit local vector, DERIVED from `local`.
   * See the header: never from the name.
   */
  faceLocal: THREE.Vector3;
}

/** A port of a placed building, resolved into the world. */
export interface PortWorld {
  build: PortHost;
  name: string;
  dir: PortDir;
  world: Vec3d;
  /** Which way the port faces, in body-frame metres. */
  face: THREE.Vector3;
}

/**
 * HOW FAR APART TWO MATING PORTS MAY BE, in the tangent plane, in metres.
 *
 * 0.65, and it is DERIVED rather than picked. Machines stand on a 1.000 m site
 * grid (`MACHINE_TILE_M`) and a smelter is 2.000 m across, so FS-26's snap puts
 * a smelter exactly two cells from the belt head that feeds it. Work the
 * geometry through with the socket positions in the header: the belt's outlet is
 * 0.500 m ahead of the tile's centre, the smelter's inlet is 1.000 m behind its
 * own, the centres are 2.000 m apart, and the two port points therefore stand
 * exactly 0.500 m apart. That 0.500 m is not slack. It is the even-footprint
 * residual that `FactorySnap.stepsFor` already names and explains: a 2 m machine
 * on a 1 m grid cannot have its face meet a 1 m tile's face, and closing it
 * needs a half-cell placement rule that is a placement decision and not a
 * wiring one.
 *
 * The rest is the ground. The site grid measures 1.002 m per cell on the shipped
 * world rather than 1.000, which adds 0.002 m over two cells, and on a slope the
 * two parts pitch by different amounts so their sockets swing a few centimetres
 * out of the shared tangent plane. 0.65 covers both with room and is still
 * nowhere near the distances the refusals have to stay clear of: a belt arriving
 * at a smelter's SIDE puts its outlet 1.80 m from the nearest inlet, and a belt
 * stopping one cell short puts it 1.50 m away. The bound separates the cases by
 * a factor of well over two, which is the property that matters, and
 * `probes/machineports.js` measures all three rather than trusting this
 * paragraph.
 */
export const PORT_MATE_M = 0.65;

/**
 * How nearly two mating ports must face each other, as a dot product.
 *
 * -0.85 is about 31 degrees. Two parts on flat ground that face each other score
 * exactly -1; a belt running PAST a machine scores 0 or +1; a belt arriving at a
 * machine's side scores 0. On a hillside the two pitch differently and the score
 * drifts off -1 by a few hundredths, which is the only reason this is not -0.99.
 */
export const PORT_FACE_DOT = -0.85;

/**
 * Which sockets are ITEM PORTS, per build kind, and which way each one runs.
 *
 * `socket_power_in`, `socket_fuel_in`, `socket_smoke`, `socket_status`,
 * `socket_drill_tip`, `socket_wire_a` and `socket_wire_b` are deliberately
 * absent. Some are render anchors and some are other systems' contracts;
 * offering to belt ore into a smelter's chimney is how a port model stops being
 * trusted, and it is the same argument `FactorySnap.WANT` already makes about
 * snapping.
 *
 * A BELT'S TWO ENDS ARE PORTS TOO, and treating them as such is what makes the
 * whole model one rule instead of two. A run's tail presents `socket_belt_in`
 * and its head presents `socket_belt_out`, so "does this belt feed this smelter"
 * and "does this smelter feed this belt" are the same question asked twice.
 */
const PORT_NAMES: Partial<Record<BuildKind, { name: string; dir: PortDir }[]>> = {
  belt: [{ name: 'socket_belt_in', dir: 'in' },
         { name: 'socket_belt_out', dir: 'out' }],
  miner: [{ name: 'socket_item_out', dir: 'out' }],
  smelter: [{ name: 'socket_item_in', dir: 'in' },
            { name: 'socket_item_out', dir: 'out' }],
  esmelter: [{ name: 'socket_item_in', dir: 'in' },
             { name: 'socket_item_out', dir: 'out' }],
};

// THE STORAGE CHEST IS NOT IN THAT TABLE YET, AND THE REASON IS NOT THE PORTS.
//
// `box.glb` has shipped for months carrying exactly the pair this model wants,
// `socket_item_in` at [0, 0.60, -0.5] and `socket_item_out` at [0, 0.60, +0.5],
// declared in `contracts.json` and now checked both ways by check-proxies. A
// `chest` row here would give it working ports in a few lines and every one of
// them would be honest. What is missing is the STORAGE: `factory_sim.h` has no
// container entity, so a chest would have to be a machine whose recipe turns
// item X into X in one tick, and `producedCountOf` is a LIFETIME PRODUCTION
// tally (FS-13) that the report publishes and FS-41's probes read, so a box
// passing 500 iron through would report having MANUFACTURED 500 iron. Storage
// would start counting as production, in the one ledger that answers "what did
// the factory make". Full argument and the shape of the real fix: FS-49 in
// docs/controllers/factory-sim.md.

/**
 * Which face of the housing a socket sits on, from its position alone.
 *
 * The local +Y component is dropped first, because height along the housing is
 * how far up the face the hopper mouth is and says nothing about which face it
 * is. What is left is reduced to whichever of the four tangent axes dominates,
 * which is `FactorySnap.axisStepOf`'s trick applied in the local frame instead
 * of the site's.
 *
 * Returns null when the socket is not on a face at all. That is a real case and
 * not defensive padding: the miner's `socket_drill_tip` sits at the origin, and
 * a socket at the origin has no face to point out of. Excluding it structurally
 * is better than excluding it by name, because the next asset to grow a centred
 * socket gets the right answer without anybody remembering this file.
 */
function faceOf(local: THREE.Vector3): THREE.Vector3 | null {
  const ax = Math.abs(local.x);
  const az = Math.abs(local.z);
  if (ax < 0.05 && az < 0.05) return null;
  if (ax >= az) return new THREE.Vector3(local.x >= 0 ? 1 : -1, 0, 0);
  return new THREE.Vector3(0, 0, local.z >= 0 ? 1 : -1);
}

/**
 * Turn the sockets FactorySnap already read off the shipped files into ports.
 *
 * It is handed the SAME map, rather than reading the scenes again, so the
 * geometry a placement snaps to and the geometry a connection is made through
 * cannot fall out of step. That is standing rule 1 applied to a machine's
 * housing: one authority for where a port is.
 */
export function portsFromSockets(
  sockets: ReadonlyMap<string, SocketDef[]>,
): Map<BuildKind, PortDef[]> {
  const out = new Map<BuildKind, PortDef[]>();
  for (const [kind, wanted] of Object.entries(PORT_NAMES)) {
    const defs = sockets.get(kind) ?? [];
    const list: PortDef[] = [];
    for (const w of wanted ?? []) {
      const s = defs.find((d) => d.name === w.name);
      if (s === undefined) continue;
      const face = faceOf(s.local);
      if (face === null) continue;
      list.push({ name: w.name, dir: w.dir, local: s.local.clone(), faceLocal: face });
    }
    if (list.length > 0) out.set(kind as BuildKind, list);
  }
  return out;
}

/**
 * THE ONE PORT TABLE IN THE PROCESS, published by whoever reads the assets.
 *
 * This is a module-level singleton and that is a deliberate choice against the
 * reflex, so the argument is written down. The alternative is to thread the
 * table from `FactoryView.load` (the only code that opens the `.glb` files)
 * through `Gameplay`, `BuildMode`, `Factory` and `FactoryWiring` as a
 * constructor argument. Three of those files belong to other live lanes, which
 * is a reason but not THE reason. The reason is that a threaded table can be
 * held twice: `FactoryGhost` would answer "this will connect" from one copy and
 * `FactoryWiring` would answer "it did not" from another, and the two would
 * disagree exactly once, at an asset reload, in a way nobody could reproduce.
 * That is the five-surfaces failure this codebase has already paid for five
 * times (DW-26), applied to a machine's housing.
 *
 * So it is published ONCE, from the one place that reads the shipped bytes, and
 * `portsLoaded` is reported rather than defaulted, because a wiring layer that
 * silently connects nothing because its table is empty is precisely the ceiling
 * that reports success (DW-28).
 */
let table: ReadonlyMap<BuildKind, PortDef[]> = new Map();
let missing: string[] = [...Object.keys(PORT_NAMES)];

/** Called by `FactoryView.load` with the sockets it read off the shipped files. */
export function publishPorts(sockets: ReadonlyMap<string, SocketDef[]>): void {
  table = portsFromSockets(sockets);
  missing = Object.keys(PORT_NAMES).filter((k) => !table.has(k as BuildKind));
}

export function machinePorts(): ReadonlyMap<BuildKind, PortDef[]> { return table; }

/**
 * EVERY kind this file asks for resolved, not merely SOME of them.
 *
 * The first draft wrote `loaded = table.size > 0`, which is the exact defect the
 * paragraph above cites DW-28 about, three lines below writing it down. An
 * asset set in which the belt resolved and the smelter did not would have
 * reported LOADED, wired belt to belt happily, and silently refused every
 * machine in the game, and the report would have said the port table was fine.
 *
 * The rule is now that `PORT_NAMES` is a CLAIM: a kind listed there is a kind
 * this client says has item ports, so a kind listed there that produced none is
 * a broken asset and not a configuration. `missing` names them, so the failure
 * says which, rather than leaving somebody to diff two lists by eye. A kind with
 * genuinely no item IO (a pole, a generator) is absent from `PORT_NAMES`
 * entirely and never reaches this.
 */
export function portsLoaded(): boolean { return missing.length === 0; }

/** Which kinds `PORT_NAMES` claims have ports and the assets did not deliver. */
export function portsMissing(): readonly string[] { return missing; }

/** Every port of one placed building, in the world. */
export function portsOf(b: PortHost,
                        ports: ReadonlyMap<BuildKind, PortDef[]>): PortWorld[] {
  const defs = ports.get(b.kind);
  if (defs === undefined) return [];
  return defs.map((d) => ({
    build: b, name: d.name, dir: d.dir,
    world: socketWorld(b, { name: d.name, local: d.local }),
    face: d.faceLocal.clone().applyQuaternion(b.quat),
  }));
}

/** One port of one building, by name, or null. */
export function portOf(b: PortHost, name: string,
                       ports: ReadonlyMap<BuildKind, PortDef[]>): PortWorld | null {
  return portsOf(b, ports).find((p) => p.name === name) ?? null;
}

/** What two ports measure against each other. Reported whether they mate or not,
 *  because "why did this not connect" is answered by the numbers. */
export interface PortFit {
  /** Distance between the two port points, projected into the tangent plane. */
  gapM: number;
  /** How far apart they are along `up`. Measured and reported, never gated: a
   *  hopper mouth is deliberately higher than a belt deck. */
  riseM: number;
  /** Dot of the two faces. -1 is head on. */
  facing: number;
  /** All three rules passed. */
  mated: boolean;
}

/**
 * Does an OUT port hand off to an IN port, and by how much does it miss?
 *
 * The gap is measured in the TANGENT PLANE and the rise is measured separately,
 * which is the one piece of this that is not obvious. A smelter's inlet is
 * authored at 0.90 m up its housing and a belt's deck at 0.25 m, so the two port
 * points are 0.65 m apart vertically BY DESIGN: the ore falls into the hopper.
 * Gating on the straight-line distance would therefore have refused the one
 * arrangement the assets were built for, and tuning the bound up to 0.90 to
 * absorb it would have let a belt at a machine's side back in through the side
 * door. Separating the two measurements keeps the bound honest and makes the
 * vertical drop a number the report carries rather than a constant nobody knows
 * about.
 */
export function fitOf(from: PortWorld, to: PortWorld,
                      up: THREE.Vector3): PortFit {
  const dx = to.world.x - from.world.x;
  const dy = to.world.y - from.world.y;
  const dz = to.world.z - from.world.z;
  const rise = dx * up.x + dy * up.y + dz * up.z;
  const gap = Math.hypot(dx - up.x * rise, dy - up.y * rise, dz - up.z * rise);
  const facing = from.face.dot(to.face);
  return {
    gapM: gap, riseM: rise, facing,
    mated: from.dir === 'out' && to.dir === 'in'
      && gap <= PORT_MATE_M && facing <= PORT_FACE_DOT,
  };
}

/**
 * WHAT A CONNECTION IS ON THE PLAN, once the geometry has decided.
 *
 * FS-44 CHANGED WHAT A LINK IS, and the row is where that shows. It used to be a
 * proximity adjacency between two centres, and the inserter arm drawn at its
 * midpoint was the only thing making it legible (DW-9). It is now a PORT PAIR:
 * an outlet meeting an inlet, named on both sides by the sockets the shipped
 * assets publish, carrying the three measurements that decided it. The
 * connection is legible because the belt visibly ends at the hopper, so nothing
 * is drawn on it (FS-47), and the measurements are here because "which building
 * feeds which, through which port" is the one thing a wiring defect gets wrong
 * and the only thing a screenshot cannot show.
 */
export interface WiredLink {
  /** The midpoint of the two PORTS, not of the two centres. */
  pos: { x: number; y: number; z: number };
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  /** The two plan ids. Unchanged, so every probe that asserted on them reads. */
  from: number;
  to: number;
  /** The socket names, verbatim from the shipped assets. */
  fromPort: string;
  toPort: string;
  /** Tangent-plane gap, vertical drop, and how head on it is. */
  gapM: number;
  riseM: number;
  facing: number;
}

/** A connection the geometry actually makes: an outlet meeting an inlet. */
export interface PortLink {
  from: PortWorld;
  to: PortWorld;
  fit: PortFit;
}

/** Every outlet of `a` that mates an inlet of `b`. Usually zero or one. */
export function linksBetween(a: PortHost, b: PortHost,
                             ports: ReadonlyMap<BuildKind, PortDef[]>): PortLink[] {
  const out: PortLink[] = [];
  for (const f of portsOf(a, ports)) {
    if (f.dir !== 'out') continue;
    for (const t of portsOf(b, ports)) {
      if (t.dir !== 'in') continue;
      const fit = fitOf(f, t, a.up);
      if (fit.mated) out.push({ from: f, to: t, fit });
    }
  }
  return out;
}
