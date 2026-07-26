// COMMITTING THE PLAN: turning the placement records into a live /core network.
//
// Split out of Factory when drag-placing landed and the file crossed its cap,
// and split along a seam that was already there: Factory owns the PLAN and its
// lifecycle, and this owns the one operation that turns a plan into entities.
//
// WHY A REBUILD RATHER THAN AN EDIT is argued in Factory.ts's header. What
// matters here is the ORDER, which matters exactly once: belts are grouped into
// RUNS first, because a run is ONE transport line however many tiles the player
// laid, which is the whole point of the factory_sim section 2 model. Then
// sources and sinks are wired to the runs' ends: a run's FIRST tile is its tail
// (where items enter) and its LAST tile is its head (where they leave), matching
// addInserter's direction.

import { chainRuns, wire } from './FactoryWiring.js';
import { FOOTPRINT, TYPE_ID, type Factory, type Placed } from './Factory.js';

/** Belt tier and craft time. The DRILL's rate is not here: it comes out of
 * /core per position (of_gp_patch_drill_rate, the authored units per second
 * times the richness under the machine), which is why a drill in the middle of
 * a patch outruns one on the rim. */
const BELT_SPEED_UNITS_PER_TICK = 8;      // tier 1: 1.875 m/s (ASSET-SPECS 4.12)
const SMELT_TICKS = 60;                    // the survival smelter's own rate

export function commitPlan(f: Factory): void {

    const carry = f.placed.map((p) => ({
      remaining: p.build < 0 ? 0 : f.line.minerRemaining(p.build),
      input: p.build < 0 || p.kind === 'belt' ? 0 : f.line.inputBuffer(p.build),
    }));
    // Empty every output into the pack BEFORE the network goes away: those are
    // finished ingots, and a rebuild is not allowed to eat them.
    for (const p of f.placed) if (p.kind === 'smelter' && p.build >= 0) f.collect(p);
    let inFlight = 0;
    for (const b of f.runBuilds) inFlight += f.line.beltItems(b);
    f.line.recreate(inFlight);

    f.runs = chainRuns(f.placed);
    f.runBuilds = f.runs.map((r) =>
      f.line.placeBelt(r.length, BELT_SPEED_UNITS_PER_TICK));
    f.runs.forEach((r, i) => r.forEach((t) => { t.run = i; }));

    const ids = f.core.ids;
    f.placed.forEach((p, i) => {
      if (p.kind === 'miner') {
        const patch = p.patch >= 0 ? f.ore.patch(p.patch) : null;
        // The deposit is the PATCH's remaining ore on the first build, and the
        // drill's own remaining on every rebuild after it, so re-laying a belt
        // does not refill the mountain.
        const amount = carry[i].remaining > 0 ? carry[i].remaining
          : Math.floor(patch?.remaining ?? 0);
        // The rate is the GROUND's, asked where this drill actually stands.
        const rate = p.patch < 0 ? 0
          : f.ore.drillRate(p.patch, p.pos.x, p.pos.y, p.pos.z);
        p.build = f.line.placeMinerForNode(patch?.kind ?? 3, amount, rate);
        p.lastRemaining = f.line.minerRemaining(p.build);
      } else if (p.kind === 'smelter') {
        // The ORE the smelter takes is whatever a miner in this plan produces,
        // and what it becomes is gameplay.h's smeltOutputFor, never a JS table.
        const ore = oreFedTo(f, p) || ids.rawIron;
        const ingot = f.M._of_gp_smelt_output_for(ore) || ids.iron;
        p.build = f.line.placeSmelter(ore, ingot, SMELT_TICKS);
        if (carry[i].input > 0) f.line.feed(p.build, carry[i].input);
      } else {
        p.build = f.runBuilds[p.run] ?? -1;
      }
      p.entity = p.build < 0 ? -1 : f.line.entityIndex(p.build);
    });

    stampPlacements(f);
    wire(f);
}

/** What ore reaches this smelter: the resource of the nearest drill's patch. */
export function oreFedTo(f: Factory, s: Placed): number {
  let best = 0;
  let bestD = Infinity;
  for (const p of f.placed) {
    if (p.kind !== 'miner' || p.patch < 0) continue;
    const n = f.ore.patch(p.patch);
    if (n === null) continue;
    const d = Math.hypot(p.pos.x - s.pos.x, p.pos.y - s.pos.y, p.pos.z - s.pos.z);
    if (d < bestD) { bestD = d; best = n.resource; }
  }
  return best;
}

function stampPlacements(f: Factory): void {
  for (const p of f.placed) {
    if (p.build < 0) continue;
    // The stream carries LOCAL metres about the plan's first building, not
    // planet-scale absolutes: the field is float32 (standing rule 6).
    const a = f.anchor();
    f.line.setPlacement(p.build, TYPE_ID[p.kind],
      p.pos.x - a.x, p.pos.y - a.y, p.pos.z - a.z,
      Math.round(FOOTPRINT[p.kind] * 70));
  }
}
