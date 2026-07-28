// FS-78: WHAT HAPPENS TO A FACTORY THAT WAS BUILT WHEN THE MACHINES WERE SMALLER.
//
// THE DECISION, stated before the code, because it is the decision that matters.
//
// FS-73 took the smelter, the electric smelter and the drill from 2 m to 4 m. A
// `SaveBuilding` records `pos` and `cell` and carries NO footprint, and the mesh
// is shared, so "existing placements keep the old size" is not an option that
// exists: every placement in every saved world is re-drawn at the new size, in
// the position it was placed at for the old one.
//
// AND THE FAILURE THAT PRODUCES IS SILENT, WHICH IS WHY THIS FILE EXISTS. Take a
// belt feeding a smelter, the commonest pair in the game:
//
//                     centre to centre   inlet from   outlet from   gap   linked
//   as it shipped         2.004 m          1.000 m      1.502 m    0.502   yes
//   placed today          3.006 m          2.000 m      2.506 m    0.506   yes
//   RESTORED FROM A SAVE  2.004 m          2.000 m      1.502 m    0.498   yes
//
// The saved row is a belt standing half a metre INSIDE the housing, and it reads
// as connected, because `PortFit.gapM` was a `Math.hypot` and a magnitude cannot
// carry a sign. Every indicator agreed: the ghost, the crosshair, the wired-link
// list, the report and five probes. INSTRUMENTS.md calls that a control that
// cannot report the defect it exists to catch, and it is the most expensive shape
// of green this project has. FS-76 gave `PortFit` a signed `alongM` so the
// measurement can no longer say it, and this file makes the geometry true.
//
// THE MIGRATION IS: RE-SPACE ALONG THE RUNS, ANCHORED ON THE DRILLS, MOVING
// NOTHING THAT IS ALREADY CORRECT, AND NAMING EVERY PAIR IT COULD NOT FIX.
//
// FS-46 is the precedent and its argument is inherited whole: a migration that
// deletes work destroys a base, and a migration that relocates buildings can put
// a drill off its patch or a smelter inside a wall, silently, at load time when
// nobody is watching. FS-46 could satisfy that by TURNING machines, because yaw
// was the only variable proximity never constrained. This one cannot: a base
// built at 2 m density physically cannot hold 4 m machines, because two machines
// two cells apart now overlap by 2 m, and no rotation makes room. Something has
// to move. So the design is about WHICH things move and by HOW LITTLE:
//
//   1. A DRILL IS AN ANCHOR. It stands on an ore patch (DW-25) and moving it is
//      the one edit that can destroy the thing it is for. Every connected group
//      containing a drill is rooted at that drill, so the drill does not move,
//      and any drill that moves anyway (two drills in one component) is CHECKED
//      against its patch afterwards and named if it left it.
//   2. A BELT RUN IS RIGID. Its tiles are 1 m and did not rescale, so their
//      spacing is already right and re-spacing them would split the run. A run
//      moves as one body or not at all.
//   3. THE TARGET IS ABSOLUTE, NOT A DELTA. Each pair is pushed to the spacing
//      `stepsFor` requires TODAY, which is a function of the table as it stands
//      and not of what the table used to say. That makes the migration
//      IDEMPOTENT: run it twice and the second run moves nothing, because the
//      first left every pair at its required spacing. It also means this file
//      never has to know the old footprint, which is just as well, because
//      nothing in the save records it.
//   4. WHAT CANNOT BE FIXED IS NAMED, NOT ACCEPTED. Every residual pair goes into
//      `notes` with both ends and both numbers, through the same channel FS-45
//      built for a refusal made today.
//
// AND THE REQUIRED SPACING IS THE SAME NUMBER TWICE, which is what makes one rule
// enough. `FactorySnap.stepsFor` is `ceil((fa + fb) / 2)`, and
// `MachinePlacement.footprintsOverlap` clears exactly when `2d >= fa + fb`, i.e.
// when `d >= ceil((fa + fb) / 2)` for integer cells. The MATING distance IS the
// minimum clash-free distance, at every size (FS-65 noticed this from the other
// side: "the last cell the test allows IS the mating cell"). So "push every pair
// out to `stepsFor`" simultaneously restores every connection and clears every
// overlap, and there is no second rule to disagree with the first.

import * as THREE from 'three';
import { FOOTPRINT, type BuildKind } from './FactoryKinds.js';
import { addressIn, anchorIn, machineCellKey, parseMachineCellKey, siteAt }
  from './MachinePlacement.js';
import { stepsFor } from './FactorySnap.js';
// FS-86. The integer-cell layout solver, which has no world in it and is
// therefore the half of this file another lane can test without a browser.
import { PASS_CAP, relaxOnce, tooCloseIn, type Cellular }
  from './FactoryRespace.js';
import { orient } from './Grid.js';
import type { Site } from './StructureGrid.js';
import type { Factory } from './Factory.js';

/** What the rescale did, for the report, the HUD and `probes/rescale.js`. */
export interface Rescale {
  ran: boolean;
  /** Pairs standing closer than `stepsFor` requires, BEFORE and AFTER. The
   *  after count is the verdict: a complete migration leaves zero. */
  tooCloseBefore: number;
  tooCloseAfter: number;
  /** Buildings whose cell changed, and the total cells of displacement. A
   *  PARTIAL migration is distinguishable from a complete one by these two
   *  together with `tooCloseAfter`: moved > 0 with residuals left is partial,
   *  moved == 0 with residuals left is a migration that did not run at all. */
  moved: number;
  cells: number;
  /** Relaxation passes actually used, and the cap. Hitting the cap is reported
   *  rather than hidden, because it means the layout did not converge. */
  passes: number;
  passCap: number;
  /** Drills that moved at all, and drills that moved OFF their ore patch. The
   *  second must be zero and is the reason drills anchor. */
  drillsMoved: number;
  drillsOffPatch: number;
  /** Where the pre-migration save was copied. Empty when nothing was backed up
   *  (a world that needed no migration is never copied). */
  backupKey: string;
  /** One line per residual pair and per drill that left its patch. */
  notes: string[];
  /** Standing rule 7: `?rescale=0` was on, so the world was MEASURED and not
   *  moved. A control run and a real run are then two rows of the same shape
   *  that differ in exactly one field, which is what makes them comparable. */
  disabled: boolean;
}

export const NO_RESCALE: Readonly<Rescale> = Object.freeze({
  ran: false, tooCloseBefore: 0, tooCloseAfter: 0, moved: 0, cells: 0,
  passes: 0, passCap: 0, drillsMoved: 0, drillsOffPatch: 0, backupKey: '',
  notes: Object.freeze([]) as unknown as string[], disabled: false,
});

/**
 * STANDING RULE 7: `?rescale=0` TURNS THE MIGRATION OFF SO IT CAN BE MEASURED.
 *
 * "A defect that one system hides is still a defect, and the hiding system will
 * be removed." The rescale exists to hide a defect, which is precisely why there
 * has to be a way to see the world without it: a run that cannot show the base
 * broken cannot claim to have fixed it, and `probes/rescale.js` uses this for its
 * negative control exactly as `?stitch=0`, `?proxy=0` and `?inserters=1` are used
 * for theirs.
 *
 * The flag skips the MOVE and not the MEASUREMENT. A controlled load still
 * reports `tooCloseBefore`, so the control prints the same number the real run
 * prints and the two are directly comparable, which is the property that makes a
 * control worth having. It also still takes the rescue copy, because the copy is
 * not the thing under test.
 */
function rescaleDisabled(): boolean {
  return typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('rescale') === '0';
}

/** Read the plan as cells. Anything whose key will not parse is skipped and
 *  named: a prospective key (`m~...`) is never saved, so one here means the
 *  plan was assembled by something other than a restore. */
function cellsOf(f: Factory, skipped: string[]): Cellular[] {
  const out: Cellular[] = [];
  for (const p of f.placed) {
    const k = parseMachineCellKey(p.cell);
    if (k === null) { skipped.push(`#${p.id} ${p.kind} has cell "${p.cell}"`); continue; }
    out.push({ p, site: k.site, i: k.i, j: k.j, fp: FOOTPRINT[p.kind] });
  }
  return out;
}

/**
 * IS THIS PLAN AT THE OLD SCALE? A pure question about saved rows.
 *
 * It is asked of the SAVE and not of a committed world, so the caller can copy
 * the slot before anything has touched it, and it needs no site registry, no
 * terrain and no /core: two cell keys and two kinds are enough. It is also the
 * idempotence gate, and the reason there is no "already migrated" flag anywhere
 * in the save format.
 *
 * A FLAG WOULD HAVE BEEN THE OBVIOUS ANSWER AND IT IS THE WEAKER ONE. A flag
 * records that the migration RAN; this records that the geometry is RIGHT, and
 * those come apart exactly when it matters, which is a migration interrupted
 * half way. INSTRUMENTS.md's dominant failure is a control that reports success
 * for a state it cannot actually see, and "migrated: true" beside an overlapping
 * base is that failure with a save format around it. This cannot say yes while
 * the base is wrong, because it is the same predicate the verdict is computed
 * from. It also costs no field, so `SAVE_VERSION` does not move and no slot
 * anybody is playing is refused.
 */
export function needsRescale(rows: readonly { kind: string; cell: string }[]):
boolean {
  const cs: { i: number; j: number; site: number; kind: BuildKind }[] = [];
  for (const r of rows) {
    const k = parseMachineCellKey(r.cell);
    if (k === null) continue;
    const kind = r.kind as BuildKind;
    if (FOOTPRINT[kind] === undefined) continue;
    cs.push({ i: k.i, j: k.j, site: k.site, kind });
  }
  for (let a = 0; a < cs.length; ++a) {
    for (let b = a + 1; b < cs.length; ++b) {
      if (cs[a].site !== cs[b].site) continue;
      const need = stepsFor(cs[a].kind, cs[b].kind);
      if (Math.abs(cs[a].i - cs[b].i) >= need) continue;
      if (Math.abs(cs[a].j - cs[b].j) >= need) continue;
      return true;
    }
  }
  return false;
}

/**
 * Re-space a plan in place. Returns what it did; the caller re-commits.
 *
 * The plan is edited through its CELLS and the world position is then re-derived
 * from the site frame by `anchorIn`, never by adding a metre offset to the saved
 * `pos`. That matters: the height is the ORACLE's, so a building pushed one cell
 * along a slope has to be put back on the ground at its new address rather than
 * translated in the tangent plane and left in the air or under the soil (GP-39,
 * standing rule 1).
 */
export function rescalePlan(f: Factory, backupKey = ''): Rescale {
  const notes: string[] = [];
  const cells = cellsOf(f, notes);
  const out: Rescale = {
    ran: true, tooCloseBefore: 0, tooCloseAfter: 0, moved: 0, cells: 0,
    passes: 0, passCap: PASS_CAP, drillsMoved: 0, drillsOffPatch: 0,
    backupKey, notes, disabled: false,
  };
  out.tooCloseBefore = tooCloseIn(cells, null);
  if (out.tooCloseBefore === 0) return out;
  if (rescaleDisabled()) {
    out.disabled = true;
    out.tooCloseAfter = tooCloseIn(cells, notes);
    return out;
  }

  const wasI = cells.map((c) => c.i);
  const wasJ = cells.map((c) => c.j);
  for (let pass = 0; pass < PASS_CAP; ++pass) {
    const moved = relaxOnce(cells);
    out.passes = pass + 1;
    if (moved === 0) break;
  }

  // The site objects, found from each building's ORIGINAL position. A site is
  // adopted, so `siteAt` returns the real one and never founds a prospective.
  const sites = new Map<number, Site>();
  for (const c of cells) {
    if (sites.has(c.site)) continue;
    const s = siteAt(f.host, c.p.pos);
    if (!s.prospective) sites.set(s.site.id, s.site);
  }

  cells.forEach((c, k) => {
    if (c.i === wasI[k] && c.j === wasJ[k]) return;
    const site = sites.get(c.site);
    if (site === undefined) {
      notes.push(`#${c.p.id} ${c.p.kind} could not be re-placed: no site ${c.site}`);
      return;
    }
    const before = addressIn(site, f.host.module, c.p.pos);
    const addr = { site, i: c.i, j: c.j, prospective: false, u: before.u };
    const a = anchorIn(f.host, addr);
    const wasPatch = c.p.patch;
    c.p.pos = a.pos;
    c.p.up = a.up;
    c.p.cell = machineCellKey(addr);
    // `fwd` is re-projected into the new tangent plane rather than kept, for the
    // reason `FactoryHand.turnPlaced` re-projects it: one cell of travel across a
    // 600 km sphere turns the plane by about 1.7e-6 rad, which is invisible and
    // is still a `fwd` that is no longer perpendicular to `up`, and `orient`
    // takes the component that lies in the plane. Leaving it would accumulate.
    const fwd = c.p.fwd.clone().addScaledVector(a.up, -c.p.fwd.dot(a.up));
    if (fwd.lengthSq() > 1e-9) c.p.fwd = fwd.normalize();
    c.p.quat = orient(c.p.up, c.p.fwd) as THREE.Quaternion;
    ++out.moved;
    out.cells += Math.abs(c.i - wasI[k]) + Math.abs(c.j - wasJ[k]);
    if (c.p.kind !== 'miner') return;
    ++out.drillsMoved;
    const now = f.patchUnder(c.p.pos);
    if (now === wasPatch) return;
    ++out.drillsOffPatch;
    notes.push(`#${c.p.id} drill was moved ${Math.abs(c.i - wasI[k])
      + Math.abs(c.j - wasJ[k])} cells to clear a neighbour and is no longer over `
      + `patch ${wasPatch} (it is over ${now}). It keeps its building and stops `
      + `mining. Move it back onto the ore, or demolish and re-place it.`);
  });

  out.tooCloseAfter = tooCloseIn(cells, notes);
  return out;
}
