// FS-86: THE LAYOUT SOLVER, WITH NO WORLD IN IT.
//
// Split out of `FactoryRescale.ts` when that file crossed the 400-line cap, and
// split along a seam that is worth more than the line count. Everything here is
// arithmetic on INTEGER CELLS: which pairs stand closer than the dimension table
// allows, which bodies are rigid, and which way to push them apart. It never
// touches a `Factory`, a site frame, the terrain oracle, `three` or a save. What
// is left in `FactoryRescale` is the part that does: reading a plan, re-deriving
// world positions through `anchorIn`, checking a drill is still on its patch,
// and reporting.
//
// THAT SPLIT IS THE TESTABLE ONE. The hard part of a migration is the layout
// relaxation, and until now it could only be exercised by loading a world. Every
// function below takes and returns plain numbers, so the next lane that wants to
// prove a base of a hundred parts converges can do it without a browser.
//
// The one thing it does import is `stepsFor`, which is deliberate and is stated
// in `FactoryRescale`'s header: the required spacing must be the SAME function
// the placement system uses, or a migration would be free to disagree with the
// placements that produced it.

import type { Placed } from './FactoryKinds.js';
import { stepsFor } from './FactorySnap.js';

/** The relaxation cap. Eight, because one pass fixes a chain and a second fixes
 *  what the first pushed into something else; measured convergence on the shipped
 *  scenes is 2 passes, so eight is four times the observed need and is a
 *  TERMINATION guard rather than a tuning parameter. */
export const PASS_CAP = 8;

/** A building reduced to the only three things this solver reasons about. */
export interface Cellular {
  p: Placed;
  site: number;
  i: number;
  j: number;
  fp: number;
}

/**
 * A pair that is too close, and the cheapest single push that clears it.
 *
 * The axis chosen is the one ALREADY carrying more separation, which is what
 * makes the push minimal: two squares clear when they clear on EITHER axis, so
 * finishing the axis that is nearly there costs fewer cells than starting the
 * other. Ties go to `i` so the answer does not depend on iteration order.
 */
export function violationOf(a: Cellular, b: Cellular):
{ axis: 0 | 1; push: number; dir: number } | null {
  if (a.site !== b.site) return null;
  const need = stepsFor(a.p.kind, b.p.kind);
  const di = b.i - a.i;
  const dj = b.j - a.j;
  if (Math.abs(di) >= need || Math.abs(dj) >= need) return null;
  const axis: 0 | 1 = Math.abs(di) >= Math.abs(dj) ? 0 : 1;
  const d = axis === 0 ? di : dj;
  // `d === 0` has no direction of its own, so the push takes the other axis's
  // sign, and failing that +1. Two buildings on exactly the same cell cannot
  // happen (`Factory.occupied`), so this only fires for a perfectly broadside
  // pair, where either way out is equally good and the choice must merely be
  // DETERMINISTIC rather than clever.
  const other = axis === 0 ? dj : di;
  const dir = d !== 0 ? Math.sign(d) : (other !== 0 ? Math.sign(other) : 1);
  return { axis, push: need - Math.abs(d), dir };
}

/** Union-find, small and local. */
function findRoot(parent: number[], x: number): number {
  let r = x;
  while (parent[r] !== r) r = parent[r];
  while (parent[x] !== r) { const n = parent[x]; parent[x] = r; x = n; }
  return r;
}

/**
 * RIGID GROUPS: every belt tile orthogonally adjacent to another belt tile is in
 * the same body, and everything else is alone.
 *
 * Adjacency is read from the CELLS rather than from `Factory.runs`, and that is
 * deliberate. A run is a directed chain the wiring derives; what has to stay
 * rigid here is the whole connected blob of belt, including a junction where two
 * runs meet and a tile the chainer decided started a new run. Splitting a blob
 * because the chainer split a run would open a 1 m hole in the middle of a line,
 * which is precisely the outcome this migration exists to prevent.
 */
export function groupsOf(cells: Cellular[]): number[] {
  const parent = cells.map((_, k) => k);
  for (let a = 0; a < cells.length; ++a) {
    const ca = cells[a];
    if (ca.p.kind !== 'belt') continue;
    for (let b = a + 1; b < cells.length; ++b) {
      const cb = cells[b];
      if (cb.p.kind !== 'belt' || cb.site !== ca.site) continue;
      if (Math.abs(ca.i - cb.i) + Math.abs(ca.j - cb.j) !== 1) continue;
      const ra = findRoot(parent, a);
      const rb = findRoot(parent, b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  return cells.map((_, k) => findRoot(parent, k));
}

/** One push between two rigid groups: the worst of their members' violations. */
interface GroupEdge { a: number; b: number; axis: 0 | 1; push: number; dir: number }

function edgesOf(cells: Cellular[], group: number[]):
{ edges: GroupEdge[]; pairs: number } {
  const worst = new Map<string, GroupEdge>();
  let pairs = 0;
  for (let a = 0; a < cells.length; ++a) {
    for (let b = a + 1; b < cells.length; ++b) {
      if (group[a] === group[b]) continue;
      const v = violationOf(cells[a], cells[b]);
      if (v === null) continue;
      ++pairs;
      const ga = group[a];
      const gb = group[b];
      const key = `${Math.min(ga, gb)}:${Math.max(ga, gb)}`;
      // Normalise the edge so `dir` always points from the LOWER group index to
      // the higher one, or two member pairs of the same groups would disagree
      // about which way out is which.
      const flip = ga > gb;
      const e: GroupEdge = {
        a: Math.min(ga, gb), b: Math.max(ga, gb),
        axis: v.axis, push: v.push, dir: flip ? -v.dir : v.dir,
      };
      const had = worst.get(key);
      if (had === undefined || e.push > had.push) worst.set(key, e);
    }
  }
  return { edges: [...worst.values()], pairs };
}

/**
 * One relaxation pass: build the push graph, root it, and translate subtrees.
 *
 * Roots are chosen so a drill never moves if anything else in its component can
 * move instead: drills first, then the largest group, then the lowest group
 * index, which makes the whole thing a pure function of the plan and not of the
 * order it happened to be saved in.
 */
export function relaxOnce(cells: Cellular[]): number {
  const group = groupsOf(cells);
  const { edges } = edgesOf(cells, group);
  if (edges.length === 0) return 0;

  const adj = new Map<number, GroupEdge[]>();
  for (const e of edges) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a) as GroupEdge[]).push(e);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b) as GroupEdge[]).push(e);
  }

  const size = new Map<number, number>();
  const hasDrill = new Set<number>();
  cells.forEach((c, k) => {
    size.set(group[k], (size.get(group[k]) ?? 0) + 1);
    if (c.p.kind === 'miner') hasDrill.add(group[k]);
  });
  const roots = [...adj.keys()].sort((x, y) => {
    const dx = hasDrill.has(x) ? 0 : 1;
    const dy = hasDrill.has(y) ? 0 : 1;
    if (dx !== dy) return dx - dy;
    const sx = size.get(x) ?? 0;
    const sy = size.get(y) ?? 0;
    if (sx !== sy) return sy - sx;
    return x - y;
  });

  const offI = new Map<number, number>();
  const offJ = new Map<number, number>();
  const seen = new Set<number>();
  for (const r of roots) {
    if (seen.has(r)) continue;
    seen.add(r);
    offI.set(r, 0);
    offJ.set(r, 0);
    const queue = [r];
    while (queue.length > 0) {
      const u = queue.shift() as number;
      for (const e of adj.get(u) ?? []) {
        const v = e.a === u ? e.b : e.a;
        if (seen.has(v)) continue;
        seen.add(v);
        // `dir` runs from the lower group index to the higher, so a child that is
        // the lower index is pushed the other way.
        const away = (v === e.b ? e.dir : -e.dir) * e.push;
        offI.set(v, (offI.get(u) ?? 0) + (e.axis === 0 ? away : 0));
        offJ.set(v, (offJ.get(u) ?? 0) + (e.axis === 1 ? away : 0));
        queue.push(v);
      }
    }
  }

  let moved = 0;
  cells.forEach((c, k) => {
    const di = offI.get(group[k]) ?? 0;
    const dj = offJ.get(group[k]) ?? 0;
    if (di === 0 && dj === 0) return;
    c.i += di;
    c.j += dj;
    moved += Math.abs(di) + Math.abs(dj);
  });
  return moved;
}

/** How many pairs are still closer than the table requires. */
export function tooCloseIn(cells: Cellular[], notes: string[] | null): number {
  let n = 0;
  for (let a = 0; a < cells.length; ++a) {
    for (let b = a + 1; b < cells.length; ++b) {
      const v = violationOf(cells[a], cells[b]);
      if (v === null) continue;
      ++n;
      if (notes !== null && notes.length < 24) {
        const ca = cells[a];
        const cb = cells[b];
        notes.push(`#${ca.p.id} ${ca.p.kind} at ${ca.i},${ca.j} and `
          + `#${cb.p.id} ${cb.p.kind} at ${cb.i},${cb.j} still overlap: they need `
          + `${stepsFor(ca.p.kind, cb.p.kind)} cells apart and have `
          + `${Math.max(Math.abs(ca.i - cb.i), Math.abs(ca.j - cb.j))}. `
          + `Move one of them and the line reconnects.`);
      }
    }
  }
  return n;
}
