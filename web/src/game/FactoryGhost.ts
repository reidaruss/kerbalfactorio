// WHERE THE GHOST LANDS, and what it is allowed to say before the button goes
// down. Split out of BuildMode when FS-26 socket snapping landed and the file
// reached its 400-line cap, along a seam that was already there: BuildMode owns
// the GESTURE (press, hold, drag, turn) and this owns the single question "given
// this aim ray and this part, which cell, which way, and would it be accepted".
//
// THE AIM MARCH IS AGAINST THE LIVE GROUND, asked through `Structures.
// groundRadius`. It used to pass a literal 0 for the edit set, so over ground the
// player had dug or levelled the ray stopped at a surface that no longer existed:
// measured, a -25 degree aim across a cut put the ghost 1.807 m from where the
// aim actually meets the ground, a cell and a half of targeting error, and most
// of what made laying a line into a cut feel unresponsive.
//
// FS-26: THE SOCKET OVERRULES THE GRID. Where the ray stops is a good guess and
// nothing more, and it is a bad guess exactly where it matters most, at the end
// of a run the player is obviously trying to extend. So before the hit point is
// floored into a cell it is offered to `FactorySnap`, and a published socket
// within 0.90 m takes the decision instead. What was caught is REPORTED, on the
// ghost and in the probe report, because a snap the player cannot see is
// indistinguishable from a coincidence.

import { headingIn, type MachineAddr } from './MachinePlacement.js';
import { socketReachM } from './FactoryKinds.js';
import { chainsInto } from './FactoryWiring.js';
import { mateFor, nearestSocket, proposeFromSocket, SNAP_M,
  type SocketDef, type SocketHit } from './FactorySnap.js';
import { linksBetween, machinePorts, portsOf, PORT_MATE_M,
  type PortHost } from './FactoryPorts.js';
import { aimedAt, refusalFor } from './FactoryRefusal.js';
import { orient } from './Grid.js';
import type { BuildKind, Factory } from './Factory.js';
import type * as THREE from 'three';

/** Aim march: step and reach, in metres. */
const STEP_M = 0.35;
const REACH_M = 9.0;
/** Where the ghost falls back to when the aim never meets the ground. */
const FALLBACK_M = 2.6;

/** An aim ray, as the player's own view produces it. */
export interface BuildRay {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

export interface BuildTarget {
  pos: { x: number; y: number; z: number };
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  cell: string;
  addr: MachineAddr;
  /**
   * FS-19. The site under this ghost does not exist yet: it was founded on the
   * lattice cell under the aim point purely so the ghost has a frame, and it
   * becomes real only if something is placed. `cell` and the site id are
   * PLACEHOLDERS while this is true, so a consumer comparing two ghosts must
   * read it. Three probes learned that the hard way.
   */
  prospective: boolean;
  /**
   * FS-26. The socket this ghost caught, as `#12 socket_belt_out`, or ''. The
   * ghost says it out loud for the reason GP-37 does: a player who cannot see
   * WHICH thing was caught cannot tell a snap from a lucky grid cell.
   */
  snapped: string;
  /** The caught socket itself, so a probe can measure the gap it produced. */
  hit: SocketHit | null;
  /**
   * FS-27. A run already chains into this cell. It no longer means the heading
   * is locked (that was FS-18, and Reid overruled it): `pitchRuns` now sets
   * pitch only, so R survives a commit and this tile would simply become a
   * corner. It is still worth saying, because "this continues the run" is the
   * thing a player is trying to find out.
   */
  chains: boolean;
  ok: boolean;
  reason: string;
  /** Drill only: the ore patch under the ghost, or -1. */
  patch: number;
  /** Drill only: what it would mine here, units per second. Richness varies
   * across a deposit, so WHERE on the patch a drill goes is a real decision and
   * the ghost has to answer it before the button is pressed. */
  ratePerSec: number;
  /**
   * FS-45: WOULD THIS CONNECT, AND IF NOT WHY NOT, BEFORE THE BUTTON GOES DOWN.
   *
   * The empty string means "this placement makes no connection either way",
   * which is the normal case in the middle of a run and deliberately says
   * nothing. Anything else is either a mate, named by both sockets, or a refusal
   * carrying its own fix.
   *
   * THIS IS THE HALF THAT MAKES THE REFUSAL RECOVERABLE. A port model refuses
   * far more often than proximity wiring did, and a refusal a player only
   * discovers by watching a smelter not work is a worse deadlock than the one
   * FS-17 removed. So the answer arrives at the same moment as the decision,
   * and it is computed by `FactoryPorts` against a PROVISIONAL host built from
   * the ghost's own pose, so the sentence on screen and the wiring that follows
   * cannot be two different calculations.
   */
  ports: string;
}

/** March the aim ray until it is below the LIVE ground. */
function march(ground: (x: number, y: number, z: number) => number,
               ray: BuildRay): { x: number; y: number; z: number } {
  const o = ray.origin, d = ray.dir;
  let hitT = -1;
  for (let t = 0.6; t <= REACH_M; t += STEP_M) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (Math.hypot(x, y, z) <= ground(x, y, z)) { hitT = t; break; }
  }
  const t = hitT < 0 ? FALLBACK_M : hitT;
  return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
}

/**
 * The whole ghost decision. Returns null only when there is nothing to show.
 *
 * The order matters and is stated once here: march, then SNAP, then floor into a
 * cell, then judge. Snapping before flooring is the entire point, because
 * flooring is the step that throws away the sub-cell information a socket needs.
 * A snap whose proposed cell is already taken falls through to the grid rather
 * than showing a red ghost, because "the cell after the one you meant" is a
 * better guess than "no".
 *
 * `snapOn` IS FALSE FOR EVERY TICK OF A DRAG, and that is not a tuning knob, it
 * is the fix for a defect this feature introduced and `probes/beltsnap.js`
 * caught on its first run. A drag reads the ghost's ADDRESS as the cell to walk
 * towards, so a ghost that had jumped to a socket's proposal was steering the
 * drag rather than reporting the crosshair. Measured: laying a run of eight
 * tiles put the FIRST one in the cell BEHIND the seed tile, pointing backwards,
 * and `chainRuns` correctly reported two transport lines where the player had
 * laid one, which is exactly the class of silent failure this whole file exists
 * to prevent. Snapping is a targeting aid for ONE placement; during a drag the
 * run itself is the guide and the crosshair is the only input.
 */
export function resolveGhost(f: Factory, kind: BuildKind, ray: BuildRay,
                             rotation: number,
                             ground: (x: number, y: number, z: number) => number,
                             sockets: ReadonlyMap<string, SocketDef[]>,
                             snapOn = true):
BuildTarget | null {
  const hp = march(ground, ray);
  let snapped = '';
  let hit: SocketHit | null = null;
  let s = f.snap(hp.x, hp.y, hp.z);
  let fwd = headingIn(s.addr.site, ray.dir, rotation);

  // A DRILL NEVER SNAPS, AND THAT IS NOT AN OMISSION. Its position is decided
  // by the GROUND: `patchUnder` refuses a cell with no ore, and "you cannot
  // place a drill here, there is no ore" is the one sentence that teaches the
  // whole mechanic. A socket that moves the ghost two cells to line it up with a
  // belt can move it straight off the patch, and then the snap has replaced a
  // rule the player can see with one they cannot. Measured: with this guard
  // absent, `probes/shortline.js` and `probes/demolish.js` both failed at "the
  // drill would not go down beyond the tail", because the belt's tail socket
  // proposed a cell 2.000 m back that had no ore under it. Belts and smelters
  // have no such constraint, so they snap freely.
  const caught = snapOn
    ? nearestSocket(f.placed, sockets, hp, SNAP_M, kind !== 'belt') : null;
  // FS-58, CLOSING FS-55: A DRILL TAKES THE HEADING AND NEVER THE CELL.
  //
  // The paragraph above is still true and is why this is a separate branch
  // rather than a relaxed condition. Snapping carries TWO things, a position and
  // a heading, and only the position is dangerous to a drill: a cell proposed by
  // a belt's tail socket can sit off the patch, and then a rule the player can
  // see has been replaced by one they cannot. The HEADING carries no such risk,
  // because a drill's yaw constrains nothing except which way its own
  // `socket_item_out` points, which is exactly the thing that was wrong.
  //
  // Before this, a drill placed on ore faced wherever the crosshair happened to
  // point, its outlet faced nothing, and the player pressed R until it did. That
  // is discoverable, and it is also the first thing the port model made harder,
  // which is why FS-55 named it rather than leaving it to be found.
  //
  // THE STICKY-ROTATION TRAP IS AVOIDED THE SAME WAY THE BRANCH BELOW AVOIDS IT:
  // `rotation` is NOT added on top. `BuildMode.rotation` persists across
  // placements, so a player who pressed R twenty minutes ago would otherwise have
  // every drill they ever snap silently reversed, which is the measured defect
  // that made `probes/demolish.js` fail at FS-26.
  if (kind === 'miner' && caught !== null) {
    const prop = proposeFromSocket(caught, kind, (p) => f.snap(p.x, p.y, p.z).addr);
    // `s` is deliberately left alone. Only the yaw moves.
    if (prop !== null) {
      fwd = prop.fwd;
      hit = caught;
      snapped = `#${caught.build.id} ${caught.name} -> heading only`;
    }
  } else if (caught !== null) {
    const prop = proposeFromSocket(caught, kind, (p) => f.snap(p.x, p.y, p.z).addr);
    if (prop !== null && !f.occupied(f.snapAddr(prop.addr).cell)) {
      s = f.snapAddr(prop.addr);
      // A SNAPPED HEADING IS THE SOCKET'S, AND THE ROTATE KEY DOES NOT TOUCH IT.
      //
      // The first draft added `rotation` on top, reasoning that a player who
      // wanted to branch sideways off a run's end should still be able to. The
      // cost of that is much larger than the benefit and it is measured:
      // `BuildMode.rotation` is STICKY, so a player (or a probe) who pressed R
      // twenty minutes ago to lay one run backwards has every subsequent snap
      // silently reversed. `probes/demolish.js` pulls a tile out of the middle
      // of a run and puts it back, with rotation sitting at 2 from laying the
      // run; the replacement inherited the socket's heading REVERSED, so the
      // run came back as 3 tiles plus 1 instead of re-merging into 4, and
      // nothing said why. Continuity is the entire reason to snap. Branching is
      // still available: aim past the socket's reach and the grid answers, where
      // R does exactly what it always did.
      fwd = prop.fwd;
      hit = caught;
      snapped = `#${caught.build.id} ${caught.name} -> ${mateFor(kind, caught)}`;
    }
  }

  let ok = true;
  let reason = snapped === '' ? '' : `snapped to ${snapped}`;
  let patch = -1;
  let ratePerSec = 0;
  const chains = kind === 'belt' && chainsInto(f.placed, s.pos);
  const inside = f.clash(kind, s.addr);
  if (f.occupied(s.cell)) { ok = false; reason = 'cell taken'; }
  else if (inside !== null) {
    // GP-49, AND THE SENTENCE IS THE FIX. A 2 m machine one cell from another
    // 2 m machine stands half inside it, and `Factory.pick` then resolves every
    // bearing that reaches either to whichever is better centred, so one of the
    // two can never be aimed at, opened, fed or demolished again. That is worse
    // than a refusal: the player paid for it and it is gone with no way to get
    // it back. Naming the neighbour is what makes the rule learnable rather
    // than a mystery red ghost, exactly as DW-25's "there is no ore" does.
    ok = false;
    reason = `too close to #${inside.id} ${inside.kind}`;
  } else if (kind === 'miner') {
    // THE SENTENCE THAT TEACHES THE MECHANIC. A drill eats the ground under
    // itself, so the only question is whether there is ore in that ground, and
    // the answer is on the ghost before the button is pressed rather than in an
    // error message after it. Several drills on one patch are fine: a deposit is
    // a piece of ground, not a socket.
    patch = f.patchUnder(s.pos);
    if (patch < 0) {
      ok = false; reason = 'you cannot place a drill here, there is no ore';
    } else {
      ratePerSec = f.ore.drillRate(patch, s.pos.x, s.pos.y, s.pos.z);
      reason = `${ratePerSec.toFixed(1)} ore/s here`;
    }
  }
  return { pos: s.pos, up: s.up, fwd, cell: s.cell, addr: s.addr,
    prospective: s.addr.prospective, snapped, hit, chains, ok, reason, patch,
    ratePerSec, ports: ok ? portPreview(f, kind, s.pos, s.up, fwd) : '' };
}

/**
 * What the part in hand would connect to, asked of the port model itself.
 *
 * A PROVISIONAL HOST, not a second geometry calculation. `PortHost` exists so
 * this can be built out of the ghost's own pose and handed to exactly the
 * functions `FactoryWiring` calls; the alternative, re-deriving where a port
 * would land, is how a ghost ends up promising a connection the commit declines.
 * Id -1 marks it as not-yet-real, which nothing here reads and everything that
 * prints it does.
 *
 * BOTH DIRECTIONS ARE ASKED, because a belt at the head of a line wants to know
 * whether it will feed the smelter in front of it and a smelter placed at that
 * head wants to know whether the belt behind it will feed IT. They are the same
 * question about the same pair of sockets, so the outlet is tried first and the
 * inlet second, and the first hit wins.
 *
 * IT RUNS EVERY FRAME THE GHOST IS UP, which is why the coarse reject is here
 * and not saved for later. No socket of any machine asset sits further than
 * 1.6 m from its own origin, so two centres further apart than twice that plus
 * the mate bound cannot own a link whatever their yaw. Without it this is
 * O(buildings) quaternion applies per frame against a base that is meant to
 * reach four figures, for an answer that is always about the two or three
 * things under the crosshair.
 */
// FS-59, FOURTH COPY. `1.6 * 2 + PORT_MATE_M` again, and here it decided what
// the GHOST tells you it will connect to before the button goes down. With an
// 8 m assembler in hand it filtered out every building the machine could
// actually mate, so the ghost said nothing at all and the player learned what
// their placement would do only after making it. Derived per pair now, through
// the one definition in FactoryKinds.
function previewNearM(a: BuildKind, b: BuildKind): number {
  return socketReachM(a) + socketReachM(b) + PORT_MATE_M;
}

function portPreview(f: Factory, kind: BuildKind,
                     pos: { x: number; y: number; z: number },
                     up: THREE.Vector3, fwd: THREE.Vector3): string {
  const ports = machinePorts();
  if (!ports.has(kind)) return '';
  const host: PortHost = { id: -1, kind, pos, up, quat: orient(up, fwd) };
  const near = f.placed.filter((p) => Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y,
    p.pos.z - pos.z) <= previewNearM(kind, p.kind));
  for (const other of near) {
    for (const l of linksBetween(host, other, ports)) {
      return `${l.from.name} -> #${other.id} ${other.kind} ${l.to.name} `
        + `(${l.fit.gapM.toFixed(2)} m)`;
    }
    for (const l of linksBetween(other, host, ports)) {
      return `#${other.id} ${other.kind} ${l.from.name} -> ${l.to.name} `
        + `(${l.fit.gapM.toFixed(2)} m)`;
    }
  }
  // Nothing mates. Say WHY only when the player is plainly aiming at something,
  // which is `aimedAt`'s whole job: a belt in the middle of open ground is not
  // failing to connect, and a ghost that says so every frame is noise.
  const out = portsOf(host, ports).find((p) => p.dir === 'out');
  if (out === undefined) return '';
  const aim = aimedAt(out, near, ports);
  if (aim === null) return '';
  const r = refusalFor(out, aim, up);
  return r === null ? '' : `WILL NOT CONNECT: ${r.reason}. ${r.fix}`;
}
