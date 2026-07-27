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

import * as THREE from 'three';
import { frameOf } from './Grid.js';
import { chainRuns, wire } from './FactoryWiring.js';
import { FOOTPRINT, TYPE_ID, type Factory, type Placed } from './Factory.js';

/** Belt tier and craft time. The DRILL's rate is not here: it comes out of
 * /core per position (of_gp_patch_drill_rate, the authored units per second
 * times the richness under the machine), which is why a drill in the middle of
 * a patch outruns one on the rim. */
const BELT_SPEED_UNITS_PER_TICK = 8;      // tier 1: 1.875 m/s (ASSET-SPECS 4.12)
const SMELT_TICKS = 60;                    // the survival smelter's own rate
/** The powered rung (FS-23). Twice the coal smelter's speed, at 30 kW, which
 *  is /core's own `placeElectricSmelter` default and the number lane D's
 *  headline case is derived from: one 90 kW generator runs exactly three of
 *  these and the fourth adds precisely zero output. */
const E_SMELT_TICKS = 30;
const E_SMELT_W = 30000;

export function commitPlan(f: Factory): void {

    const carry = f.placed.map((p) => ({
      remaining: p.build < 0 ? 0 : f.line.minerRemaining(p.build),
      input: p.build < 0 || p.kind === 'belt' ? 0 : f.line.inputBuffer(p.build),
      // FUEL IS CARRIED THE SAME WAY A MINER'S ORE IS, and it has to be: the
      // grid lives inside the BuildableNetwork, so `recreate()` below destroys
      // every pole and every generator along with the belts. Without this,
      // laying one belt tile anywhere in the base would empty every generator
      // in it, and the symptom would be a base that mysteriously browns out
      // whenever you build something.
      fuel: p.kind === 'generator' && p.grid >= 0
        ? f.power.generatorFuel(p.grid) : p.fuel,
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
    // THE GRID GOES ON THE MOMENT THE FIRST POLE OR GENERATOR EXISTS, and not
    // one placement before. Turning it on pins anything no pole reaches to
    // ZERO, so a world that has never built anything electrical must never have
    // it on: /core is explicit that a network which never calls enableGrid()
    // behaves exactly as it always did, and that is the property protecting
    // every already-placed machine and every existing probe.
    const electrical = f.placed.some((p) => p.kind === 'pole'
      || p.kind === 'generator' || p.kind === 'esmelter');
    if (electrical) f.power.enable(true);
    // Poles FIRST, before any consumer or generator, so the supply areas exist
    // when the grid partitions them. Placing a generator into a world with no
    // poles yet is legal and simply leaves it on no network, which is exactly
    // what the panel then reports.
    const a = f.anchor();
    for (const p of f.placed) {
      if (p.kind !== 'pole') continue;
      p.grid = f.power.placePole(p.pos.x - a.x, p.pos.y - a.y, p.pos.z - a.z);
      p.build = -1;
      p.entity = -1;
    }
    f.placed.forEach((p, i) => {
      if (p.kind === 'pole') return;
      if (p.kind === 'generator') {
        p.grid = f.power.placeGenerator(p.pos.x - a.x, p.pos.y - a.y,
          p.pos.z - a.z, ids.coal);
        // The carried fuel goes straight back in. `insertFuel` returns what was
        // ACCEPTED, so the stored figure is what the generator really holds and
        // not what we hoped to give it.
        p.fuel = p.grid < 0 || carry[i].fuel <= 0 ? 0
          : f.power.insertFuel(p.grid, ids.coal, carry[i].fuel);
        p.build = -1;
        p.entity = -1;
        return;
      }
      if (p.kind === 'esmelter') {
        const ore = oreFedTo(f, p) || ids.rawIron;
        const ingot = f.M._of_gp_smelt_output_for(ore) || ids.iron;
        // Placed AND registered on the grid in ONE call, so a 30 kW machine
        // cannot exist that quietly runs at full speed off a grid it never
        // joined. 30 ticks against the coal smelter's 60: the ladder's top rung
        // is twice as fast and costs watts instead of coal.
        p.build = f.power.placeElectricSmelter(ore, ingot,
          p.pos.x - a.x, p.pos.y - a.y, p.pos.z - a.z, E_SMELT_TICKS, E_SMELT_W);
        if (carry[i].input > 0) f.line.feed(p.build, carry[i].input);
        p.entity = p.build < 0 ? -1 : f.line.entityIndex(p.build);
        return;
      }
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
    pitchRuns(f);
    wire(f);
}

/**
 * A RUN IS A RAMP, NOT A STAIRCASE, and FS-27: IT MAY SET A TILE'S PITCH BUT
 * NEVER ITS YAW.
 *
 * The ramp half is the original reason this exists. A belt follows the ground,
 * so consecutive tiles differ in height by the local slope: measured on the
 * shipped world, 0.19 m per 1.00 m tile on an 11 degree hillside. Left upright,
 * each tile is a horizontal plank at its own height and the run reads as a
 * flight of steps. So a tile takes the pitch of the segment it sits on and a
 * normal perpendicular to that, and the residual is the kink between two rigid
 * 1.00 m planks whose centres are 1.0176 m apart: 0.018 m at that slope against
 * the 0.189 m step it replaces.
 *
 * THE YAW HALF IS FS-27 AND IT REVERSES FS-18. This function used to write the
 * whole heading, `a.fwd.copy(d)`, straight from the run's own geometry. That
 * made a dragged run chained BY CONSTRUCTION, which was the property worth
 * having, and it also made the R key a lie: a tile placed beside an existing run
 * had its rotation overwritten on the very next commit, and FS-18 responded by
 * withdrawing the advertisement rather than the overwrite. Reid overruled that
 * ("make it like factorio where i can change the direction after i place it"),
 * and he is right, because in Factorio a belt tile's DIRECTION is the datum and
 * the run is derived from it, which is the only model in which a corner is
 * something a player places rather than something a drag implies.
 *
 * The reconciliation is that the two halves were never the same quantity. Split
 * the heading into the tangent YAW (which of the four site axes the tile faces)
 * and the PITCH out of the tangent plane (how steeply the ground falls along
 * it). The yaw is the player's, set by placement or by R, and is never written
 * here. The pitch is the ground's, and is all this function writes.
 *
 * `t` below is the tile's own heading with the radial component removed, so it
 * is the yaw and nothing else; `s` is the segment's slope, taken from the tile
 * ahead when there is one and from the tile behind for the last tile of a run.
 * Rebuilding `fwd = t*cos + r*sin` therefore reproduces the OLD result exactly
 * whenever the tile's yaw already agrees with the run's geometry, which is every
 * tile of every dragged run, since `BuildMode.dragRun` refaces each tile at its
 * successor as it lays it. The only tile that moves is the one whose heading the
 * player deliberately set to something the run did not imply, and that tile is
 * now a corner instead of being silently straightened.
 *
 * It still runs AFTER `chainRuns`: chaining asks which tile is ahead along the
 * flow, and answering that with a pitched vector on a slope would make the test
 * depend on the terrain.
 */
function pitchRuns(f: Factory): void {
  const d = new THREE.Vector3();
  const r = new THREE.Vector3();
  const t = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (const run of f.runs) {
    if (run.length < 2) continue;
    for (let i = 0; i < run.length; ++i) {
      const a = run[i];
      // The last tile has no successor, so it borrows the SLOPE of the segment
      // into it. Only the slope: its own yaw is whatever the player set, which
      // is exactly how the corner at the end of a run survives to be drawn.
      const b = i + 1 < run.length ? run[i + 1] : run[i - 1];
      const s = i + 1 < run.length ? 1 : -1;
      d.set((b.pos.x - a.pos.x) * s, (b.pos.y - a.pos.y) * s,
        (b.pos.z - a.pos.z) * s);
      if (d.lengthSq() < 1e-9) continue;
      d.normalize();
      r.set(a.pos.x, a.pos.y, a.pos.z).normalize();
      // The tile's OWN yaw, and the one line in this function that guarantees
      // the player's rotation survives a commit.
      t.copy(a.fwd).addScaledVector(r, -a.fwd.dot(r));
      if (t.lengthSq() < 1e-9) continue;
      t.normalize();
      // Clamped because a near-vertical segment has no meaningful yaw to pitch,
      // and 0.9 is a 64 degree slope: past that the terrain is a cliff and a
      // belt on it is refused elsewhere long before this matters.
      const sin = Math.max(-0.9, Math.min(0.9, d.dot(r)));
      a.fwd.copy(t).multiplyScalar(Math.sqrt(1 - sin * sin)).addScaledVector(r, sin);
      a.fwd.normalize();
      up.copy(r).addScaledVector(a.fwd, -r.dot(a.fwd));
      if (up.lengthSq() < 1e-9) continue;
      a.up.copy(up.normalize());
      a.quat = frameOf(a.up, a.fwd);
    }
  }
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
