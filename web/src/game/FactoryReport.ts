// What the factory says about itself, for the HUD and for a driven probe.
//
// A pure read, split out of Factory for the same reason GameplayViews was split
// out of Gameplay: shaping rows is not a responsibility, and Factory was at the
// 400-line cap with the demolition path still to land.
//
// EVERY CONSERVATION COUNTER IS HERE and none of them is optional.
// `itemsLostToRebuild` and `demolishedInFlight` exist because a topology change
// throws away the items riding a belt, and a loss that is not counted is a
// conservation claim that has already rotted. `refunded` and `spilled` are the
// other two ends of the same ledger: what demolition gave back, and what the
// pack had no room for.

import { labelOf } from '../player/Bindings.js';
import type { Factory, Placed } from './Factory.js';
import type { GameCore } from './GameCore.js';
import type { HudTarget } from '../ui/GameHud.js';

export interface RefundLine { item: number; count: number }

/** The verbs, spelled the way the binding table currently spells them. One
 *  source, so a remap never leaves a stale key name on screen. */
const USE = labelOf('use');
const TAKE = `${labelOf('interact')} take`;
const OPEN = `${labelOf('interact')} open`;
const REMOVE = `${labelOf('demolish')} remove`;

/**
 * What an automated machine says about itself under the crosshair, including
 * that it can be pulled up: a player who cannot see that removal exists has it
 * only in the same sense that an undocumented console command exists.
 */
export function buildPrompt(f: Factory, game: GameCore, b: Placed): HudTarget {
  const item = f.outputItemOf(b);
  const name = item > 0 ? game.itemName(item) : b.kind;
  if (b.kind === 'miner') {
    const left = b.build < 0 ? 0 : f.line.minerRemaining(b.build);
    const n = b.patch >= 0 ? f.ore.patch(b.patch) : null;
    return {
      name: `mining drill  ${Math.round(left)} ${name} left`,
      fraction: n !== null && n.initial > 0 ? left / n.initial : 0,
      // `empty` is the HARVEST NODE's depleted caption; a machine has its own
      // words for being empty and does not want "node depleted" under them.
      empty: false, distanceM: 0, action: `${TAKE}    ${REMOVE}`,
    };
  }
  if (b.kind === 'belt') {
    // FS-28: a belt is now a thing you can take FROM, so it says how much is on
    // the line and offers the turn key, which is the only place a player finds
    // out that R works on a placed tile.
    const on = b.run < 0 ? 0 : f.line.beltItems(f.runBuilds[b.run] ?? -1);
    return {
      name: on > 0 ? `belt  ${on} on the line` : 'belt  empty',
      fraction: 0, empty: on === 0, distanceM: 0,
      action: `${TAKE} one    ${labelOf('rotate')} turn    ${REMOVE}`,
    };
  }
  const out = b.build < 0 ? 0 : f.line.outputBuffer(b.build);
  return {
    name: out > 0 ? `${b.kind}  ${labelOf('interact')} to take ${out} ${name}`
      : `${b.kind}  working`,
    fraction: b.build < 0 ? 0 : f.line.progress01(b.build),
    empty: false, distanceM: 0, action: `${TAKE}    ${labelOf('rotate')} turn    ${REMOVE}`,
  };
}

/**
 * FS-18: what the MACHINE ghost says, including whether R does anything here.
 *
 * A structural ghost has had a prompt since base building landed
 * (`StructurePlacement.ghostPrompt`) and a machine ghost has had none, so the
 * drill's "2.1 ore/s here" was computed every tick and shown only if the player
 * pressed and was refused. Same argument as DW-24's: a message that arrives
 * after the key is pressed teaches nothing.
 *
 * FS-27 REPLACES WHAT THIS USED TO SAY ABOUT THE TURN KEY. It read "R turn: the
 * run sets this heading", which was honest about FS-18's behaviour and is now
 * false: `pitchRuns` writes pitch and never yaw, so a tile keeps whatever
 * heading it was given and a run flows through the corner that makes. The prompt
 * says what the key does instead, and the second clause is the discoverability
 * half of the same feature, because a key that only works with an EMPTY hand is
 * a key nobody finds by accident.
 */
export function ghostMachinePrompt(
  label: string,
  t: { reason: string; ok: boolean; chains: boolean } | null,
): HudTarget | null {
  if (t === null || label === '') return null;
  return {
    name: `${label}${t.reason === '' ? '' : `  ${t.reason}`}`,
    fraction: 0, empty: !t.ok, distanceM: 0,
    action: `${USE} place  (hold to drag)    ${labelOf('rotate')} turn`
      + (t.chains ? '  (continues the run)' : ''),
  };
}

export function factoryReport(f: Factory): unknown {
  return {
    buildings: f.placed.length,
    // TAIL AND HEAD BY ID, because a run is ordered and both ends are wired
    // differently: a source feeds the TAIL and the HEAD feeds a sink. Naming
    // them is what lets a probe say "the smelter is wired onto the tail of the
    // belt whose head feeds it", which is FS-17's deadlock stated exactly.
    runs: f.runs.map((r, i) => ({
      tiles: r.length, items: f.line.beltItems(f.runBuilds[i] ?? -1),
      tail: r[0]?.id ?? -1, head: r[r.length - 1]?.id ?? -1,
    })),
    /** Every inserter connect() created, and the two plan ids it sits between. */
    links: f.links.map((l) => ({ from: l.from, to: l.to })),
    ticks: f.line.ticks,
    coreTicks: f.line.coreTicks,
    rebuilds: f.line.rebuilds,
    itemsLostToRebuild: f.line.itemsLostToRebuild,
    minedFromNodes: f.minedFromNodes,
    collected: f.collected,
    spilled: f.spilled,
    takenFromBelts: f.takenFromBelts,
    beltTakeAttempts: f.beltTakeAttempts,
    removals: f.removals,
    refunded: f.refunded,
    demolishedInFlight: f.demolishedInFlight,
    list: f.placed.map((p) => row(f, p)),
    flows: f.line.beltFlows(),
  };
}

function row(f: Factory, p: Placed): unknown {
  const live = p.build >= 0;
  const machine = live && p.kind !== 'belt';
  return {
    id: p.id, kind: p.kind, build: p.build, entity: p.entity, run: p.run,
    patch: p.patch, outputItem: f.outputItemOf(p),
    cell: p.cell,
    // THE POSITION IS PART OF THE REPORT, because "belts line up" is a distance
    // and not a screenshot: the acceptance measures tile to tile (GP-27).
    pos: [p.pos.x, p.pos.y, p.pos.z],
    fwd: [p.fwd.x, p.fwd.y, p.fwd.z],
    remaining: p.kind === 'miner' && live ? f.line.minerRemaining(p.build) : null,
    input: p.kind === 'smelter' && live ? f.line.inputBuffer(p.build) : null,
    output: machine ? f.line.outputBuffer(p.build) : null,
    working: live ? f.line.working(p.build) : false,
  };
}

/**
 * THE ONE PROMPT DECISION: an automated machine, a hand furnace, or a harvest
 * node, in that order of priority. The order matters and is the same one the
 * interaction step uses, so what the crosshair SAYS and what the key DOES can
 * never disagree.
 */
export function aimPrompt(f: Factory, game: GameCore, build: Placed | null,
                          machine: { handle: number } | null,
                          node: { name: string; fraction: number; empty: boolean;
                                  distanceM: number } | null): HudTarget | null {
  if (build !== null) return buildPrompt(f, game, build);
  if (machine !== null) {
    const st = game.furnaceState(machine.handle);
    return {
      name: st !== null && st.smelting ? 'furnace (smelting)' : 'furnace',
      fraction: st === null ? 0 : st.progress / Math.max(1, st.ticksPerSmelt),
      empty: false, distanceM: 0, action: `${OPEN}    ${REMOVE}`,
    };
  }
  if (node === null) return null;
  return {
    name: node.name, fraction: node.fraction,
    empty: node.empty, distanceM: node.distanceM, verb: USE,
  };
}
