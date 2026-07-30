// THE MACHINE SCREEN'S BRAIN: which machines the bare-handed left button opens
// (GP-61), the view each one shows, and the verbs its buttons run.
//
// One panel serves BOTH machine families. The hand furnace is a gameplay-layer
// `survival::Furnace` behind a WASM handle (GP-19); a drill, an auto smelter,
// an electric smelter and a generator are factory-sim citizens behind a build
// index. They answer the same three questions (what is in you, what have you
// made, how far along is this unit) through different exports, and this file is
// the one place that difference lives, so the panel and the input layer never
// learn it.
//
// THE PROGRESS BAR IS THE SIM'S COUNTER, both ways (GP-63): the furnace's
// `progress / ticksPerSmelt` out of `of_gp_furnace_state`, and the factory's
// `of_net_progress01`, which is /core's own fixed-point work counter
// normalised. Nothing here interpolates, because a bar that guesses drifts from
// the machine it claims to describe and then lies exactly when it matters.

import { feedMachine, refuel } from './GameplayActions.js';
import { machinePorts } from './FactoryPorts.js';
import { assemblerPanelView, feedAssembler } from './MachineAssembler.js';
import { chestPanelView, loadChest, takeFromChest } from './MachineChest.js';
import { PART_INFO } from './Hotbar.js';
import type { MachineView } from '../ui/FurnacePanel.js';
import type { Gameplay } from './Gameplay.js';
import type { Machine } from './Machines.js';
import type { BuildKind, Placed } from './Factory.js';

/**
 * The factory kinds the panel opens for: everything with a buffer to show.
 * A belt is not a machine (E takes one item off it, FS-28) and a pole holds
 * nothing at all, so neither is here, and the bare hand keeps digging past
 * them exactly as it did.
 */
const OPENABLE = new Set<BuildKind>(['miner', 'smelter', 'esmelter', 'generator',
  // FS-56. The assembler is the FIRST machine you must open, rather than one you
  // may: an unset one makes nothing at all until somebody chooses a recipe, so
  // if it were not on this list the machine would be unusable and there would be
  // no way in the game to find out why.
  'assembler',
  // FS-70. A chest MUST be openable or it is a box you can never look inside:
  // it has no recipe to set and no fuel to add, so the panel is the only way to
  // put something in by hand or get it back out.
  'chest']);

/**
 * GP-163: does this factory kind have a screen the interact key can open?
 * Published for GameplayInput, which routes E to the panel for these kinds and
 * keeps FS-28's take-one for belts. One set, one answer; a copy in the input
 * layer would drift the first time a machine was added to one of them.
 */
export function openableMachine(kind: BuildKind): boolean {
  return OPENABLE.has(kind);
}

/**
 * GP-61: what a bare-handed left click on the crosshair's machine does.
 * Returns true when it opened a screen, so the caller skips the swing.
 */
export function openAimedMachine(g: Gameplay): boolean {
  if (g.aimedMachine !== null) { g.openFurnace(g.aimedMachine); return true; }
  const b = g.aimedBuild;
  if (b !== null && OPENABLE.has(b.kind)) { g.openBuildPanel(b); return true; }
  return false;
}

/** Whichever machine the screen is showing, as one view. */
export function screenView(g: Gameplay): MachineView {
  if (g.openMachine !== null) return furnacePanelView(g, g.openMachine);
  if (g.openBuild !== null) {
    if (g.openBuild.kind === 'assembler') return assemblerPanelView(g, g.openBuild);
    if (g.openBuild.kind === 'chest') return chestPanelView(g, g.openBuild);
    return buildPanelView(g, g.openBuild);
  }
  return { title: '', status: '', input: null, input2: null, fuel: null,
    output: null, progress01: null, progressText: '', canTakeInput: false,
    takeInputHint: '', loadable: [], recipes: null, refused: [] };
}

/** GP-62: why the input cell refuses today, said where the player can read it. */
const TAKE_ORE_HINT =
  'taking loaded ore back out needs a bridge export (of_gp_furnace_take_ore)';

/** The hand furnace / survival smelter, over of_gp_furnace_state. */
function furnacePanelView(g: Gameplay, m: Machine): MachineView {
  const st = g.game.furnaceState(m.handle);
  const tps = st?.ticksPerSmelt ?? 180;
  return {
    title: m.tier === 1 ? 'Smelter' : 'Primitive furnace',
    status: st?.smelting === true ? 'SMELTING' : 'IDLE',
    input: { name: st === null ? '' : g.game.itemName(st.oreItem),
      count: st?.oreCount ?? 0 },
    fuel: { main: `${((st?.fuelTicks ?? 0) / 60).toFixed(1)} s`,
      sub: `${st?.fuelTicks ?? 0} t` },
    output: { name: st === null || st.outItem === 0 ? ''
      : g.game.itemName(st.outItem), count: st?.outCount ?? 0 },
    progress01: (st?.progress ?? 0) / Math.max(1, tps),
    progressText: `${st?.progress ?? 0} / ${tps} ticks this smelt`,
    canTakeInput: g.game.furnaceTakeOre(m.handle, 0) !== null,
    takeInputHint: TAKE_ORE_HINT,
    loadable: furnaceLoadable(g),
    // A hand furnace's recipe is the ORE you put in it, so there is nothing to
    // choose. Null and not [], which the panel's own comment distinguishes.
    input2: null, recipes: null, refused: [],
  };
}

/**
 * What the pack can feed a hand furnace. THE ORE HALF ASKS THE SIM'S OWN
 * EXPORTED TABLE (`smeltOutputFor`); the fuel half is the ONE list in this
 * client the sim does not export yet (`sv::fuelTicksPerUnit` has no of_gp_
 * query), so it is a NAMED SEAM: it decides only which buttons are OFFERED,
 * never what is accepted, because the click goes through of_gp_furnace_insert
 * and the sim refuses anything this list gets wrong, out loud (GP-62).
 */
function fuelSeam(g: Gameplay): number[] { return [g.game.ids.coal, g.game.ids.wood]; }

function furnaceLoadable(g: Gameplay) {
  const fuels = fuelSeam(g);
  const out = [];
  for (const c of g.game.carried()) {
    const ore = g.game.smeltOutputFor(c.item) !== 0;
    const fuel = fuels.includes(c.item);
    if (ore || fuel) out.push({ item: c.item, name: c.name, count: c.count, fuel });
  }
  return out;
}

/** A factory machine, over the of_net_* exports the report already reads. */
function buildPanelView(g: Gameplay, b: Placed): MachineView {
  const f = g.factory;
  const live = b.build >= 0;
  const outItem = f.outputItemOf(b);
  const inItem = f.inputItemOf(b);
  const crafts = b.kind === 'smelter' || b.kind === 'esmelter';
  const working = live && f.line.working(b.build);
  const packIn = inItem > 0 ? g.game.count(inItem) : 0;
  const coal = g.game.count(g.game.ids.coal);
  return {
    title: PART_INFO[b.kind].label,
    // FS-52: NO NETWORK COMES BEFORE NO FUEL, and the order is the point. A
    // generator that has coal and is on no network reads BURNING under the old
    // test, which is the most misleading thing this panel could say: it is the
    // one state where everything looks right and no watt reaches anything. The
    // three states are now separable at a glance, and they have three different
    // fixes (put a pole beside it, feed it, nothing).
    status: b.kind === 'generator'
      ? (b.grid >= 0 && f.power.generatorOffGrid(b.grid) ? 'NO NETWORK'
        : b.grid >= 0 && f.power.generatorFuel(b.grid) > 0 ? 'BURNING' : 'NO FUEL')
      : working ? (b.kind === 'miner' ? 'MINING' : 'SMELTING') : 'IDLE',
    input: crafts ? { name: g.game.itemName(inItem),
      count: live ? f.line.inputBuffer(b.build) : 0,
      ...portInfo(g, b, 'in') } : null,
    fuel: b.kind === 'generator'
      ? { main: `${b.grid >= 0 ? f.power.generatorFuel(b.grid) : 0} units`,
        sub: 'coal' } : null,
    output: b.kind === 'generator' ? null
      : { name: outItem > 0 ? g.game.itemName(outItem) : '',
        count: live ? f.line.outputBuffer(b.build) : 0,
        ...portInfo(g, b, 'out') },
    // /core's own per-unit work counter, normalised on the far side (GP-63).
    progress01: crafts && live ? f.line.progress01(b.build) : null,
    progressText: crafts && live
      ? `${Math.round(Math.max(0, Math.min(1, f.line.progress01(b.build))) * 100)}% of this unit`
      : b.kind === 'miner' ? 'mines continuously at the patch rate' : '',
    canTakeInput: false,
    takeInputHint: 'taking the hopper back out needs a bridge export (of_net_take_input)',
    loadable: b.kind === 'generator'
      ? (coal > 0 ? [{ item: g.game.ids.coal, name: g.game.itemName(g.game.ids.coal),
        count: coal, fuel: true }] : [])
      : crafts && packIn > 0
        ? [{ item: inItem, name: g.game.itemName(inItem), count: packIn, fuel: false }]
        : [],
    input2: null, recipes: null, refused: [],
  };
}


/**
 * FS-48: WHICH PORT A STACK ARRIVES ON, AND WHAT IS ON THE OTHER END OF IT.
 *
 * The panel and the world have to agree about the same machine, and until FS-44
 * they could not: a connection was a distance between two centres, so there was
 * no port to name and "fed by the drill over there" was as specific as the truth
 * got. Now a hand-off happens through a socket the player can walk round and
 * look at, and `f.links` records both socket names, so this reads the SAME rows
 * the wiring wrote rather than re-deriving the geometry. Re-deriving it is how
 * the panel ends up confidently disagreeing with the belt.
 *
 * A DISCONNECTED PORT SAYS SO, and that is the half that earns this. A player
 * opens this panel because a machine has stopped, and "in: socket_item_in, not
 * connected" is the answer, printed where they are already looking, in the
 * moment they are already asking.
 */
/**
 * FS-56 widened this with an optional socket NAME, and the reason is the whole
 * point of the assembler: `defs.find((d) => d.dir === dir)` returns the FIRST
 * port of that direction, which was unambiguous while every machine had at most
 * one inlet, and silently returns input A for both cells the moment one has two.
 * The panel would then have said "socket_item_in_a" beside the stone stack and
 * been confidently wrong about the very thing FS-48 added it to be right about.
 * Callers with one port pass nothing and behave exactly as before.
 */
export function portInfo(g: Gameplay, b: Placed, dir: 'in' | 'out', name?: string):
{ port?: string; via?: string } {
  const defs = machinePorts().get(b.kind) ?? [];
  const def = name === undefined ? defs.find((d) => d.dir === dir)
    : defs.find((d) => d.name === name);
  if (def === undefined) return {};
  const f = g.factory;
  const l = dir === 'in'
    ? f.links.find((k) => k.to === b.id && k.toPort === def.name)
    : f.links.find((k) => k.from === b.id && k.fromPort === def.name);
  if (l === undefined) return { port: def.name, via: 'not connected' };
  const other = f.placed.find((p) => p.id === (dir === 'in' ? l.from : l.to));
  const label = other === undefined ? '?' : `#${other.id} ${other.kind}`;
  return { port: def.name,
    via: dir === 'in' ? `fed by ${label}` : `feeding ${label}` };
}

/**
 * WHAT THE SCREEN IS SHOWING, for `__of.game()`. It carries the DRAWN bar
 * beside the view's own number so a probe can assert the pixel against the sim
 * rather than against a second copy of the same arithmetic (GP-63).
 */
export function screenReport(g: Gameplay): unknown {
  if (g.openMachine === null && g.openBuild === null) {
    // FS-56. THE CLOSED SHAPE CARRIES THE SAME KEYS AS THE OPEN ONE, valued
    // null. A probe that reads `screen.status` on a panel that failed to open
    // gets `undefined`, which reads in a report as "the field does not exist"
    // and sends somebody hunting for a missing feature; `null` says "the panel
    // is shut", which is the truth and is a different investigation. This cost
    // a run on `probes/assembler.js`.
    return { open: false, of: null, barPct: g.furnacePanel.barPct,
      title: null, status: null, input: null, input2: null, fuel: null,
      output: null, progress01: null, progressText: null, canTakeInput: false,
      loadable: [], recipe: 0, recipes: null, refused: [] };
  }
  const v = screenView(g);
  return {
    open: true,
    of: g.openMachine !== null ? `furnace${g.openMachine.tier}` : g.openBuild?.kind,
    title: v.title, status: v.status,
    input: v.input, input2: v.input2, fuel: v.fuel, output: v.output,
    progress01: v.progress01, progressText: v.progressText,
    canTakeInput: v.canTakeInput,
    barPct: g.furnacePanel.barPct,
    loadable: v.loadable.map((l) => `${l.name}:${l.count}${l.fuel ? ' (fuel)' : ''}`),
    // FS-56. The recipe the machine is SET to is published beside the menu, and
    // separately from it, so a probe can assert that a click changed the plan
    // rather than only that a button rendered with a highlight.
    recipe: g.openBuild?.recipe ?? 0,
    recipes: v.recipes === null ? null
      : v.recipes.map((r) => `${r.output}:${r.label}=${r.cost}`
        + `${r.selected ? ' [set]' : ''}${r.affordable ? '' : ' [short]'}`),
    refused: v.refused.map((r) => `${r.label}: ${r.why}`),
  };
}

// --- the three verbs the panel's buttons run --------------------------------
// Same shape as every verb in GameplayActions: ask /core, then say so out loud.

/** A pack row was clicked: put it in, as ore or fuel, THE SIM DECIDING. */
export function loadInto(g: Gameplay, item: number): void {
  const m = g.openMachine;
  if (m !== null) {
    const n = g.game.furnaceInsert(m.handle, item, 5);
    // A refused insert is never silent: the sim's acceptance rule is the ONLY
    // acceptance rule, so its "no" is the sentence's whole content (GP-62).
    if (n > 0) { g.hud.flash(`loaded ${n} ${g.game.itemName(item)}`); g.sfx.confirm(); }
    else g.hud.flash(`this ${m.tier === 1 ? 'smelter' : 'furnace'} will not take that`);
    g.panel.invalidate();
    return;
  }
  const b = g.openBuild;
  if (b === null) return;
  if (b.kind === 'generator') { refuel(g, b); return; }
  if (b.kind === 'assembler') { feedAssembler(g, b, item); return; }
  if (b.kind === 'chest') { loadChest(g, b, item); return; }
  feedMachine(g, b);
}

/** FS-56's fourth verb, re-exported so `Gameplay` keeps ONE import for the
 *  panel's callbacks and never learns that the assembler has its own file. */
export { setRecipe } from './MachineAssembler.js';

/** The input cell was clicked: the ore back, THROUGH THE SEAM (GP-62). */
export function takeInput(g: Gameplay): void {
  const m = g.openMachine;
  if (m === null) return;
  const item = g.game.furnaceState(m.handle)?.oreItem ?? 0;
  const n = g.game.furnaceTakeOre(m.handle, 999);
  if (n === null) { g.hud.flash(TAKE_ORE_HINT); return; }
  if (n > 0) { g.hud.flash(`took ${n} ${g.game.itemName(item)} back`); g.sfx.confirm(); }
  else g.hud.flash('nothing loaded');
  g.panel.invalidate();
}

/** The output cell was clicked: the whole stack, identity and count. */
export function takeOut(g: Gameplay): void {
  const m = g.openMachine;
  if (m !== null) {
    const item = g.game.furnaceState(m.handle)?.outItem ?? 0;
    const n = g.game.furnaceCollect(m.handle, 999);
    if (n > 0) { g.hud.flash(`took ${n} ${g.game.itemName(item)}`); g.sfx.confirm(); }
    else g.hud.flash('nothing to take yet');
    g.panel.invalidate();
    return;
  }
  const b = g.openBuild;
  if (b === null) return;
  // FS-70. A chest is not collected through `factory.collect`: that reads the
  // machine OUT-SLOT, and a container's pool is not an out-slot even though it
  // lives in the same arrays.
  if (b.kind === 'chest' && takeFromChest(g, b)) return;
  const n = g.factory.collect(b);
  if (n <= 0) { g.hud.flash('nothing to take yet'); return; }
  g.autoCollected += n;
  g.hud.flash(`took ${n} ${g.game.itemName(g.factory.outputItemOf(b))}`);
  g.sfx.confirm();
  g.panel.invalidate();
}
