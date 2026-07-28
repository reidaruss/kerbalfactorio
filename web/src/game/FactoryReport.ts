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
import { portsMissing } from './FactoryPorts.js';
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
    // FS-45: AND IF THIS TILE IS WHERE A LINE STOPPED, IT SAYS WHY, HERE.
    //
    // The ghost's verdict (FactoryGhost.portPreview) covers the moment BEFORE
    // the press. This covers every moment after it, which is the one that
    // matters for a save that was migrated, for a line the player built and
    // walked away from, and for a machine somebody else turned. Without it a
    // refusal is a thing you could only have learned at placement time, and a
    // player who missed it has no way back to the sentence.
    const r = f.refusals.find((k) => k.from === b.id);
    return {
      name: r === undefined
        ? (on > 0 ? `belt  ${on} on the line` : 'belt  empty')
        : `belt  NOT CONNECTED: ${r.reason}`,
      fraction: 0, empty: on === 0 && r === undefined, distanceM: 0,
      action: r === undefined
        ? `${TAKE} one    ${labelOf('rotate')} turn    ${REMOVE}`
        : `${r.fix}    ${labelOf('rotate')} turn    ${REMOVE}`,
    };
  }
  // FS-52: A GENERATOR ON NO NETWORK SAYS SO WHERE THE PLAYER IS LOOKING.
  //
  // Reid: "i placed a few power poles and they connect to each other but not to
  // the generator." The wires between the poles are drawn, so the grid LOOKS
  // built; the one thing that was invisible is that the generator joined none of
  // it. This is the same sentence-and-fix shape FS-45 gives a refused belt, for
  // the same reason: a connection rule the player cannot see, failing silently.
  // The predicate is /core's (`Power.generatorOffGrid` argues how), never a
  // distance recomputed here against a copy of the supply radius.
  if (b.kind === 'generator') {
    const off = b.grid >= 0 && f.power.generatorOffGrid(b.grid);
    const fuel = b.grid < 0 ? 0 : f.power.generatorFuel(b.grid);
    return {
      name: off ? 'generator  ON NO NETWORK: no power pole reaches it'
        : fuel > 0 ? `generator  burning, ${fuel} coal left` : 'generator  no fuel',
      fraction: 0, empty: off || fuel === 0, distanceM: 0,
      action: off
        ? `put a power pole beside it    ${OPEN}    ${REMOVE}`
        : `${OPEN}    ${REMOVE}`,
    };
  }
  const out = b.build < 0 ? 0 : f.line.outputBuffer(b.build);
  // FS-45: AND A MACHINE SOMETHING IS POINTED AT SAYS SO FROM THE MACHINE'S END.
  //
  // The refusal is recorded against the BELT (its head is the end that ran into
  // the housing), so aiming at the belt already names it. But a player whose line
  // has stopped walks up to the SMELTER, because that is the thing visibly not
  // working, and telling them nothing there sends them looking down the belt for
  // a fault that is on the machine they are standing in front of. Same sentence,
  // same fix, from whichever end they approach.
  const at = f.refusals.find((k) => k.to === b.id);
  return {
    name: at !== undefined ? `${b.kind}  NOT FED: ${at.reason}`
      : out > 0 ? `${b.kind}  ${labelOf('interact')} to take ${out} ${name}`
        : `${b.kind}  working`,
    fraction: b.build < 0 ? 0 : f.line.progress01(b.build),
    empty: false,
    action: at !== undefined ? `${at.fix}    ${labelOf('rotate')} turn    ${REMOVE}`
      : `${TAKE}    ${labelOf('rotate')} turn    ${REMOVE}`,
    distanceM: 0,
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
  t: { reason: string; ok: boolean; chains: boolean; ports?: string } | null,
): HudTarget | null {
  if (t === null || label === '') return null;
  // FS-45: THE PORT VERDICT GOES ON THE PROMPT, and it goes on the ACTION line
  // rather than the name line, because it is the longest thing the ghost ever
  // says and the name line is where the drill's ore rate and the clash refusal
  // already live. Empty when the placement connects to nothing, which is the
  // normal case and must stay silent: a ghost that shouts every frame is a ghost
  // nobody reads, which is how the refusal channel dies.
  const port = t.ports === undefined || t.ports === '' ? '' : `\n${t.ports}`;
  return {
    name: `${label}${t.reason === '' ? '' : `  ${t.reason}`}`,
    fraction: 0, empty: !t.ok, distanceM: 0,
    action: `${USE} place  (hold to drag)    ${labelOf('rotate')} turn`
      + (t.chains ? '  (continues the run)' : '') + port,
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
      // The FULL tile order, tail first, exactly as the cargo layer indexes it.
      // A probe measuring items against belt geometry needs the run's own order,
      // not a reconstruction from positions that could disagree with it.
      tileIds: r.map((t) => t.id),
    })),
    /**
     * FS-44: every connection, AS A PAIR OF PORTS.
     *
     * `from`/`to` are the plan ids and are unchanged, so every probe that ever
     * asserted "the head feeds the smelter" still reads. What is new is which
     * SOCKET each end used and the three measurements that decided it, because
     * under a port model "these two are connected" and "these two are near each
     * other" are different claims and a report that cannot separate them cannot
     * check the change that separated them.
     */
    links: f.links.map((l) => ({ from: l.from, to: l.to,
      fromPort: l.fromPort, toPort: l.toPort,
      gapM: l.gapM, riseM: l.riseM, facing: l.facing })),
    /** FS-45: every belt end that ran into a housing, with the reason. */
    refusals: f.refusals,
    /** The port table was published before this plan was wired, and it means
     *  EVERY kind that claims ports delivered them, not merely some. See
     *  FactoryPorts.portsLoaded: a half-loaded table connects belts to belts
     *  and silently refuses every machine, which is the ceiling that reports
     *  success. `portsMissing` names any kind that came up empty. */
    portsLoaded: f.portsLoaded,
    portsMissing: portsMissing(),
    /** FS-46: what the last restore did to a pre-port save. */
    migration: f.migration,
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
    // FS-41: WHAT THIS MACHINE WAS BUILT TO EAT, and what it has ever made.
    //
    // `outputItem` alone could not answer Reid's "feeding coal into a smelter
    // produces iron?", because the answer was iron either way: the defect was
    // that the machine's INPUT half was chosen separately from its output half
    // and came out as coal. `producedOfOutput` is /core's own lifetime tally
    // (`producedCountOf`), so a probe can ask whether the fiction was ever
    // ACTED on rather than only whether it was declared.
    inputItem: f.inputItemOf(p),
    producedOfOutput: machine && f.outputItemOf(p) > 0
      ? f.line.producedOf(f.outputItemOf(p)) : 0,
    cell: p.cell,
    // THE POSITION IS PART OF THE REPORT, because "belts line up" is a distance
    // and not a screenshot: the acceptance measures tile to tile (GP-27).
    pos: [p.pos.x, p.pos.y, p.pos.z],
    fwd: [p.fwd.x, p.fwd.y, p.fwd.z],
    // `up` completes the tile frame: a probe checking cargo against the belt's
    // centre-line arc needs the deck plane, and pos+fwd alone cannot give it.
    up: [p.up.x, p.up.y, p.up.z],
    remaining: p.kind === 'miner' && live ? f.line.minerRemaining(p.build) : null,
    input: live && f.inputItemOf(p) > 0 ? f.line.inputBuffer(p.build) : null,
    output: machine ? f.line.outputBuffer(p.build) : null,
    working: live ? f.line.working(p.build) : false,
    // ABI 9. A pole and a generator are GRID citizens with their own id space,
    // so `build` is -1 on both and `grid` is where they actually live. A
    // consumer's own network and satisfaction are here rather than only in the
    // panel because "this machine is slow" and "this machine is on no network
    // at all" are different faults with different fixes, and a report that
    // cannot tell them apart sends the player to build the wrong thing.
    grid: p.grid,
    fuel: p.kind === 'generator' && p.grid >= 0
      ? f.power.generatorFuel(p.grid) : null,
    network: live && p.kind === 'esmelter' ? f.power.networkOf(p.build) : null,
    satisfactionQ16: live && p.kind === 'esmelter'
      ? f.power.satisfactionQ16Of(p.build) : null,
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
