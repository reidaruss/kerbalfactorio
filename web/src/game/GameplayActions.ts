// The verbs: what a key press actually DOES to the pack, a machine or a recipe.
//
// Split out of Gameplay when the W7 checklist landed and the composition crossed
// its 400-line cap, and split along the seam that was already there. Gameplay
// owns ORDER and the POINTER; these five functions own the small transactions,
// and every one of them is the same shape: ask /core, then say so out loud.
//
// SAYING SO OUT LOUD IS THE POINT, and it is why they are not one-liners on
// GameCore. A player who presses G with an empty pack must be told why nothing
// happened. The rule is /core's; the sentence is this file's.

import { demolishAimed } from './Demolition.js';
import type { PadPart } from './LaunchPad.js';
import { CRAFT_BLOCK, craftBlockText } from './GameCore.js';
import { GATED_BY_ITEM } from './Factory.js';
import { recipeRows, slotRows } from './GameplayViews.js';
import { urlForMode, type GameMode } from './GameMode.js';
import { craftOnDemand, shortOfText, tierToPlace } from './Buildables.js';
import { SKILL } from './Progression.js';
import { labelOf } from '../player/Bindings.js';
import type { PartKind, SlotContent } from './Hotbar.js';
import type { Gameplay } from './Gameplay.js';
import type { BuildRay } from './BuildMode.js';
import type { Placed } from './Factory.js';
import type { Machine } from './Machines.js';
import type { ResearchStation } from './ResearchStations.js';
import type { ScanAntenna } from './Antennas.js';
import type { RubbleRow } from './Wreckage.js';
import type { StructurePart } from './Structures.js';
import { Sites } from '../world/Sites.js';
import { markerRegistry } from './MarkerRegistry.js';
import { markerFor } from './PoiMarkers.js';

/** The two panel views, with the item pictures bound in one place. */
export function slots(g: Gameplay) {
  return slotRows(g.game, (n) => g.icons.for(n),
    (item) => HOTBAR_ITEMS.has(item));
}
export function recipes(g: Gameplay) {
  return recipeRows(g.game, (n) => g.icons.for(n), g.mode.fullCatalogue,
    (i) => lockOn(g, i));
}

/**
 * WHAT LOCKS A RECIPE, in one place and asked of /core.
 *
 * `ModeRules.researchGated` and not `if (sandbox)`: GP-29's whole argument is
 * that a gate written later must get the right answer without anyone
 * remembering to add an or-clause, and this is the branch `freeBuild`'s comment
 * predicted a year of decisions ago.
 */
function lockOn(g: Gameplay, recipeIndex: number): string {
  if (!g.mode.researchGated) return '';
  const rs = g.progress.research;
  if (rs.recipeAvailable(recipeIndex)) return '';
  const out = g.game.recipes()[recipeIndex]?.output ?? 0;
  return rs.techForItem(out)?.name ?? 'a technology';
}

/** The pack items that mean something on a hotbar slot. The three ABI 9 items
 *  plus the two hand furnaces; everything else is a resource or a tool. */
const HOTBAR_ITEMS = new Set([0x003B, 0x003C, 0x003D, 0x003E, 0x003F]);

/**
 * Take an automated machine's finished stock into the pack, or ONE ITEM OFF A
 * BELT (FS-28). A belt used to reach the first branch, ask a `BeltLine` for an
 * output buffer it does not have, and answer "nothing to take yet" for ever.
 * Same key, same sentence, because it is the same verb.
 */
export function collectFrom(g: Gameplay, b: Placed): void {
  // A GENERATOR IS FED, NOT EMPTIED, and E is the key that means "deal with the
  // thing in front of me", so this is the same verb rather than a new one. It
  // is also the ONLY way a grid ever starts: a burner generator with no coal
  // offers zero capacity, so without this the whole electrical layer is a panel
  // that reads 0 W for ever, which is exactly the shape of failure W11 exists
  // to stop shipping.
  if (b.kind === 'generator') {
    refuel(g, b);
    return;
  }
  // AN ELECTRIC SMELTER IS FED BY HAND UNTIL A BELT REACHES IT, for a reason
  // that is a property of /core: `pumpPower` publishes what a machine WANTS
  // THIS TICK, and a starved machine wants nothing. So an unfed electric
  // smelter draws 0 W, the network reads 100% satisfied, and the panel is a
  // screen of zeroes however many generators stand on it.
  //
  // AN EMPTY HOPPER MEANS FEED, ANYTHING ELSE MEANS EMPTY. The first version
  // had it the other way round and it is unusable: a running machine has
  // finished stock within half a second, so E alternated between collecting one
  // ingot and refusing to load. Keyed on the HOPPER, the key does the thing the
  // machine is short of, which is the only rule that stays right while it
  // runs.
  if (b.kind === 'esmelter' && g.factory.inputOf(b) <= 0) {
    feedMachine(g, b);
    return;
  }
  if (b.kind === 'belt') {
    const got = g.factory.takeFromBelt(b);
    if (got === null) { g.hud.flash('nothing on this belt'); return; }
    g.autoCollected += got.count;
    g.hud.flash(got.count > 0 ? `took 1 ${g.game.itemName(got.item)}`
      : `pack full: ${g.game.itemName(got.item)} dropped`);
    g.sfx.confirm();
    g.panel.invalidate();
    return;
  }
  const n = g.factory.collect(b);
  if (n <= 0) { g.hud.flash('nothing to take yet'); return; }
  g.autoCollected += n;
  g.hud.flash(`took ${n} ${g.game.itemName(g.factory.outputItemOf(b))}`);
  g.sfx.confirm();
  g.panel.invalidate();
}

/**
 * Put a hand furnace or a hand smelter on the 1 m grid ahead of the eye.
 *
 * GP-114. RAW MATERIALS ARE ENOUGH NOW: with none in the pack `craftOnDemand`
 * makes one at /core's own price and `Machines.place` consumes it as it always
 * has, so there is one charge on one path and the bar's `furnace` slot and the
 * build menu pay the same. The rule, the ORDER and DW-31 are in Buildables.ts. */
export function placeMachine(g: Gameplay,
                             ray: { origin: { x: number; y: number; z: number };
                                    dir: { x: number; y: number; z: number } }): void {
  const ids = g.game.ids;
  const h = g.hotbar.held;
  const tier = tierToPlace(g, h.kind === 'furnace' ? h.tier ?? -1 : -1);
  if (tier < 0 || !craftOnDemand(g, tier)) { g.hud.flash(shortOfText(g, tier)); return; }
  const item = tier === 0 ? ids.furnace : ids.smelter;
  if (g.machines.place(item, tier, ray.origin, ray.dir) === null) {
    g.hud.flash('cannot place there');
    return;
  }
  g.placements++;
  g.hud.flash(`placed ${g.game.itemName(item)}`);
  g.sfx.confirm();
}

/**
 * D-019. Put a research station on the ground ahead of the eye.
 *
 * `ResearchStations.place` owns the RULE (can it be afforded, where does it
 * snap, which way does it face) and this owns the SENTENCE, which is the split
 * this whole file exists for. The refusal names what is short by reading /core's
 * own bill rather than a copy, so a rebalance in `gameplay.h` §S.6 moves the
 * message with the price.
 */
export function placeStation(g: Gameplay, ray: BuildRay): void {
  const before = g.stations.list.length;
  if (g.stations.place(ray.origin, ray.dir) === null) {
    const d = g.stations.definition;
    const short = (d?.cost ?? [])
      .filter((c) => g.game.count(c.item) < c.count)
      .map((c) => `${c.count - g.game.count(c.item)} more ${g.game.itemName(c.item)}`)
      .join(' and ');
    g.hud.flash(short === '' ? 'cannot place a research station there'
      : `research station: you need ${short}`, 2.4);
    return;
  }
  g.placements++;
  g.progress.credit(SKILL.Building, 1);
  g.sfx.confirm();
  g.panel.invalidate();
  // WHAT IT IS FOR, not merely that it went down: this is the first building in
  // the game whose entire purpose is a screen, so the toast names the key. Same
  // argument the launch pad's own message makes.
  if (before === 0) {
    g.hud.flash(`RESEARCH STATION BUILT: ${labelOf('interact')} at it opens the `
      + `tech tree, and ${labelOf('research')} now works anywhere`, 5);
  } else {
    g.hud.flash('placed research station');
  }
}

/**
 * GP-533. TIER 1: how far from the antenna's own mast a build reveals ruins.
 *
 * `story_line_outline_v1.txt` says "upon building the scanning antenna it
 * shows the location of nearby ruins" — the FORGE ruin sits 700 to 1400 m from
 * SPAWN (`poi.h`'s `forgeSpecs` comment), so this radius has to clear that band
 * from wherever the antenna actually stands, not from spawn itself. A player
 * builds the antenna near the base they already have, which by the time they
 * have run belts and smelting and raised a research station is not guaranteed
 * to be AT spawn, so the margin is generous rather than exact: 2,500 m clears
 * the ruin's own 1,400 m outer edge with 1,100 m of slack for how far the base
 * has crept from the landing point. A later antenna UPGRADE
 * (`story_line_outline_v1.txt`'s next rung, "the solar system map will be
 * revealed") is a SECOND, larger tier and is deliberately not this constant.
 */
const ANTENNA_REVEAL_RADIUS_M = 2500;

/** GP-533. THE ONE-SHOT REVEAL a successful antenna placement triggers:
 *  `of_poi_near` at the tier radius around the antenna's OWN position, then
 *  `of_poi_mark_known` on every hit -- both already-shipped ABI 24 exports
 *  (WG-151), so this needs no core change of its own. Idempotent by
 *  construction: `markKnown` returns false and `MarkerRegistry.add` simply
 *  overwrites for a site a previous antenna (or this one, restored from a
 *  save) already revealed, so calling this on every placement is safe and a
 *  second antenna elsewhere legitimately extends coverage rather than
 *  double-counting. Returns how many sites were NEWLY revealed, for the toast.
 */
function revealNearbySites(g: Gameplay, at: ScanAntenna): number {
  const sites = new Sites(g.core, g.bodyHandle);
  if (!sites.live) return 0;
  const bodyRadiusM = g.core._of_body_radius(g.bodyHandle);
  if (!(bodyRadiusM > 0)) return 0;
  const r = Math.hypot(at.pos.x, at.pos.y, at.pos.z) || 1;
  const dir = { x: at.pos.x / r, y: at.pos.y / r, z: at.pos.z / r };
  const cosHalfAngle = Math.cos(ANTENNA_REVEAL_RADIUS_M / bodyRadiusM);
  const hits = sites.near(dir, cosHalfAngle, 64);
  let revealed = 0;
  for (const i of hits) {
    const row = sites.row(i);
    if (row === null) continue;
    if (!sites.markKnown(row)) continue;   // already known: not NEW
    revealed++;
    markerRegistry.add(markerFor(row));
  }
  return revealed;
}

/**
 * GP-533. Put a scanning antenna on the ground ahead of the eye.
 *
 * `Antennas.place` owns the RULE, this owns the SENTENCE (`placeStation`'s own
 * split), plus the one thing the station never had to do: fire the one-shot
 * reveal and say what it found.
 */
export function placeAntenna(g: Gameplay, ray: BuildRay): void {
  if (g.mode.researchGated && g.antennas.definition !== null
      && !g.progress.research.itemAvailable(g.antennas.definition.item)) {
    const tech = g.progress.research.techForItem(g.antennas.definition.item)?.name
      ?? 'a technology';
    g.hud.flash(`scanning antenna needs ${tech}  (${labelOf('research')} to research)`, 2.4);
    return;
  }
  const at = g.antennas.place(ray.origin, ray.dir);
  if (at === null) {
    const d = g.antennas.definition;
    const short = (d?.cost ?? [])
      .filter((c) => g.game.count(c.item) < c.count)
      .map((c) => `${c.count - g.game.count(c.item)} more ${g.game.itemName(c.item)}`)
      .join(' and ');
    g.hud.flash(short === '' ? 'cannot place a scanning antenna there'
      : `scanning antenna: you need ${short}`, 2.4);
    return;
  }
  g.placements++;
  g.progress.credit(SKILL.Building, 1);
  g.sfx.confirm();
  g.panel.invalidate();
  const revealed = revealNearbySites(g, at);
  g.hud.flash(revealed > 0
    ? `SCANNING ANTENNA BUILT: ${revealed} nearby ruin${revealed === 1 ? '' : 's'} `
      + `revealed on the map  (${labelOf('map')} to view)`
    : 'placed scanning antenna: nothing nearby to reveal yet', 5);
}

/**
 * THE LEFT BUTTON, whole. What it does is decided by the HOTBAR and by nothing
 * else: a player holding a wall who clicks means the wall, and guessing from
 * what happens to be under the crosshair is the sort of thing that makes a game
 * feel unlistening.
 *
 * `use` is the held state and `pressed` the rising edge, because they mean
 * different things: a press puts one part down, and a HOLD drags a run (GP-27).
 *
 * Returns true if anything was put down, so the caller can skip the rest of the
 * tick's interaction.
 */
export function stepBuild(g: Gameplay, ray: BuildRay, use: boolean,
                          pressed: boolean): boolean {
  // THE RESEARCH GATE ON PLACEMENT, and it is here rather than in BuildMode for
  // the reason this whole file exists: BuildMode owns the rule and this owns
  // the sentence. A refusal that says nothing is indistinguishable from a
  // button that does nothing, which is the complaint that started W11.
  const part = g.hotbar.partInHand;
  // A structural part is a `PartKind` but never a `BuildKind`, so the lookup is
  // widened rather than cast: a foundation is simply not in the table, which is
  // the same "gated iff mentioned" rule /core's tech tree uses for items.
  const gates: Partial<Record<string, number>> = GATED_BY_ITEM;
  const gate = part === null ? undefined : gates[part];
  if (gate !== undefined && g.mode.researchGated
      && !g.progress.research.itemAvailable(gate)) {
    if (pressed) {
      const tech = g.progress.research.techForItem(gate)?.name ?? 'a technology';
      g.hud.flash(`${g.game.itemName(gate)} needs ${tech}  (J to research)`, 2.4);
    }
    return false;
  }
  // A hand furnace comes out of the PACK and goes down through Machines, not
  // through the factory plan (GP-19), so it is its own slot kind and its own
  // branch rather than a fake `BuildKind`.
  if (g.hotbar.held.kind === 'furnace') {
    if (!pressed) return false;
    placeMachine(g, ray);
    return true;
  }
  // D-019. THE RESEARCH STATION, on the hand furnace's own branch and for the
  // hand furnace's own reason: it is placed by its own owner rather than by the
  // factory plan or the structural grid, so it is its own slot kind and its own
  // branch rather than a fake `PartKind`. NO DRAG: a run of research stations is
  // not a thing anybody wants by accident, which is `stepPad`'s argument at a
  // smaller scale.
  if (g.hotbar.held.kind === 'station') {
    if (!pressed) return false;
    placeStation(g, ray);
    return true;
  }
  // GP-533. THE SCANNING ANTENNA, the station's own branch and reason: placed
  // by its own owner, NO DRAG. The research gate is unlike the station's
  // (which is deliberately never gated): `placeAntenna` checks it itself,
  // because a run one key press away must refuse before it ever asks
  // `Antennas.place` to spend copper.
  if (g.hotbar.held.kind === 'antenna') {
    if (!pressed) return false;
    placeAntenna(g, ray);
    return true;
  }
  // GP-57 / DW-29. THE PAD'S GATE IS SET ON THE GHOST, NOT SPRUNG ON THE PRESS.
  //
  // The three power buildables above are refused at the moment of the click,
  // which is right for them: they are one-metre machines and the ghost has no
  // room to explain itself. A launch pad is 24 m, needs 36 foundations under it
  // and costs 60 iron, so a player aiming one is making a decision several
  // minutes long, and finding out only on the click that they cannot build it
  // at all would waste every one of those minutes. So the sentence is handed to
  // BuildMode, which paints it red under the crosshair through the same path as
  // "11 of 36 cells have no foundation". It is composed here because this file
  // holds the mode and the tech names; BuildMode holds the rule.
  if (g.pads !== null) {
    const padItem = g.pads.definition?.item ?? 0;
    g.build.padLocked = padItem > 0 && g.mode.researchGated
      && !g.progress.research.itemAvailable(padItem)
      ? `needs ${g.progress.research.techForItem(padItem)?.name ?? 'a technology'}`
        + '  (J to research)'
      : '';
  }
  const turns0 = g.build.turns;
  // GP-59: the player's own look angles go in beside the ray. See BuildMode's
  // `stepStructure`: they are what tells a held click apart from a drag, and
  // they are read from the CONTROLLER rather than derived from the ray, because
  // being lifted onto a foundation moves the ray and not these.
  const n = g.build.step((a) => g.input.act(a), use, ray, g.lookAngles);
  // FS-27: R on a placed building. It is announced HERE rather than inside
  // BuildMode for the reason this whole file exists: BuildMode owns the rule and
  // this owns the sentence, and a turn that says nothing is indistinguishable
  // from a key that does nothing, which is the exact complaint being fixed.
  if (g.build.turns > turns0 && g.build.lastTurn !== null) {
    g.hud.flash(`turned the ${g.build.lastTurn.kind}`);
    g.sfx.confirm();
  }
  if (n > 0) {
    announce(g, n, pressed);
    // Building is credited per PLACEMENT rather than per drag, so a twenty
    // tile belt run is twenty, which is what it cost the player.
    g.progress.credit(SKILL.Building, n);
    g.sfx.confirm();
    g.panel.invalidate();
    return true;
  }
  if (g.build.selected === null) return false;
  const refused = g.build.padTarget !== null
    ? (g.build.padTarget.ok ? null : g.build.padTarget.reason)
    : g.build.structTarget !== null
      ? (g.build.structTarget.ok ? null : g.build.structTarget.reason)
      : (g.build.target?.ok === false ? g.build.target.reason : null);
  if (pressed && refused !== null) g.hud.flash(refused);
  return false;
}

/** What a placement says out loud. A drag says the RUN, not each tile. */
function announce(g: Gameplay, n: number, pressed: boolean): void {
  // GP-57. A launch pad is the biggest single thing a player builds, and what
  // they need to hear next is not "placed launch pad" but what it is FOR.
  if (g.build.lastPad !== null && g.build.padTarget !== null) {
    g.build.lastPad = null;
    g.hud.flash('LAUNCH PAD BUILT: press C to build a rocket, then G rolls it '
      + 'out onto the pad', 5);
    return;
  }
  if (!pressed || n > 1) {
    g.hud.flash(`${g.build.dragLength + n} ${g.build.label}`);
    return;
  }
  const part = g.build.lastPart;
  if (g.build.structTarget !== null && part !== null) {
    // The COST is said out loud on placement, because a player who cannot see
    // what a wall costs cannot plan a room.
    g.hud.flash(`placed ${part.kind}  -${g.structures.costText(part.kind)}`);
    return;
  }
  // The RATE is said out loud, because richness varies across a deposit and a
  // player who cannot see what a spot is worth cannot choose.
  const r = g.build.lastRate;
  g.hud.flash(r > 0 ? `placed ${g.build.label}  ${r.toFixed(1)} ore/s`
    : `placed ${g.build.label}`);
}

/**
 * The X key, whole. Whatever is under the crosshair goes back through its own
 * owner, and what could not survive the removal is named in the same toast.
 *
 * The machine is tried first for the same reason it takes the mine key: it is
 * the nearer, larger object, and a belt tile or a wall behind it must not steal
 * the press.
 */
export function raze(g: Gameplay, machine: Machine | null, build: Placed | null,
                     part: StructurePart | null,
                     pad: PadPart | null = null,
                     station: ResearchStation | null = null,
                     antenna: ScanAntenna | null = null,
                     rubble: RubbleRow | null = null): boolean {
  const r = demolishAimed(g, machine, build, part, pad, station, antenna, rubble);
  if (r === null) { g.hud.flash('nothing to remove'); return false; }
  g.fx.forgetSmelters();
  g.hud.flash(r.message, 2.2);
  g.sfx.undo();
  g.panel.invalidate();
  return true;
}

/**
 * Coal out of the pack and into a generator. Returns nothing and says
 * everything, like every other verb here.
 *
 * The count that leaves the pack is the count /core ACCEPTED, never the count
 * asked for: the fuel slot is bounded at 50 units, so a player with 400 coal
 * who presses E next to a full generator must not silently lose 10 of it.
 */
export function refuel(g: Gameplay, b: Placed, want = 10): void {
  if (b.grid < 0) { g.hud.flash('this generator is not built yet'); return; }
  const coal = g.game.ids.coal;
  const held = g.game.count(coal);
  if (held <= 0) { g.hud.flash('no coal in the pack'); return; }
  const took = g.factory.power.insertFuel(b.grid, coal,
    Math.min(want, held));
  if (took <= 0) { g.hud.flash('this generator is full'); return; }
  g.game.remove(coal, took);
  b.fuel = g.factory.power.generatorFuel(b.grid);
  g.hud.flash(`fuelled: ${took} coal in, ${b.fuel} units burning`, 2.2);
  g.sfx.confirm();
  g.panel.invalidate();
}

/**
 * Ore out of the pack and into a powered machine, five at a time.
 *
 * What it takes is decided by /core: the ore the machine was BOUND to when it
 * was placed, which is `smeltOutputFor`'s own input side. A JS table of "what
 * goes in a smelter" would be a second authority one balance pass away from
 * being wrong.
 */
export function feedMachine(g: Gameplay, b: Placed, want = 20): void {
  if (b.build < 0) { g.hud.flash('this machine is not built yet'); return; }
  const ore = g.factory.inputItemOf(b);
  if (ore <= 0) { g.hud.flash('this machine takes nothing by hand'); return; }
  const held = g.game.count(ore);
  if (held <= 0) {
    g.hud.flash(`no ${g.game.itemName(ore)} in the pack`);
    return;
  }
  // TWENTY, NOT FIVE, and the number is about the machine rather than the
  // hopper. An electric smelter is 30 ticks a unit, so five units is 150 ticks:
  // half a second of work for a press, which means a player hand-feeding a base
  // spends the whole game pressing E. Twenty is ten seconds, which is long
  // enough to walk to the next machine and is the interval a belt is meant to
  // replace rather than a substitute for one.
  const n = Math.min(want, held);
  g.factory.feed(b, n);
  g.game.remove(ore, n);
  g.hud.flash(`loaded ${n} ${g.game.itemName(ore)}`);
  g.sfx.confirm();
  g.panel.invalidate();
}

// The machine screen's own verbs (load, take output, take input) live in
// MachineScreen.ts with the views they serve (GP-57).

/**
 * Hand-craft by recipe index, and redraw the panel that asked for it.
 *
 * DW-31: in sandbox the output is GRANTED rather than crafted, because "i can
 * just pick anything thats in the game" has to be true of items and not only of
 * buildings, and the craft list is the only catalogue of items the game already
 * has. `of_gp_craft` is not called at all, for the reason `Structures.pay`
 * gives: a call whose false return is ignored would eat inputs it did not
 * announce.
 */
export function craft(g: Gameplay, index: number): void {
  // The same gate the panel greyed the button with, asserted again here,
  // because a disabled button is a suggestion and a probe can click through it.
  if (lockOn(g, index) !== '') {
    g.hud.flash(`not researched yet  (J)`);
    return;
  }
  const want = g.game.recipes()[index];
  // GP-51: THE REFUSAL IS ASKED FOR BEFORE THE ATTEMPT, so the player is told
  // which of two opposite things to go and do. `of_gp_craft` used to return
  // true on a full pack, spend the inputs and drop the output, and the only
  // symptom was that nothing happened. The reason travels as a CODE (GP-46);
  // the sentence is composed here, where the item names live.
  const block = g.mode.freeBuild ? CRAFT_BLOCK.None : g.game.craftBlock(index);
  if (block !== CRAFT_BLOCK.None) {
    g.hud.flash(craftBlockText(block), 2.4);
    g.sfx.undo();
    return;
  }
  const ok = g.mode.freeBuild
    ? want !== undefined && g.game.add(want.output, want.outputCount) === 0
    : g.game.craft(index);
  g.panel.invalidate();
  g.panel.render(slots(g), recipes(g));
  const r = ok ? g.game.recipes()[index] : undefined;
  if (r === undefined) {
    // Sandbox GRANTS rather than crafts, so /core's block code never ran and a
    // full pack lands here. Never silent, either way.
    g.hud.flash(craftBlockText(CRAFT_BLOCK.PackFull), 2.4);
    return;
  }
  g.hud.flash(`crafted ${g.game.itemName(r.output)}`);
  g.sfx.confirm();
}

/**
 * Put a pack item on the SELECTED hotbar slot.
 *
 * THE BAR HAS NINE SLOTS AND THE GAME NOW HAS TWELVE PLACEABLE THINGS, so a
 * fixed `DEFAULT_BAR` can no longer reach everything and the three machines
 * researched tonight would have been craftable and unplaceable. Hotbar.ts's own
 * header calls "put things in a hotbar" the ask; this is it, and it is a
 * POINTER gesture in the open pack for the same reason rearranging is: during
 * play the pointer is locked to the canvas and there is no cursor to click a
 * slot with.
 */
export function assignToBar(g: Gameplay, item: number): void {
  const part = PART_FOR_ITEM[item];
  const slot = g.hotbar.selectedIndex;
  const content: SlotContent = part === undefined
    ? { kind: 'furnace' } : { kind: 'part', part };
  if (!g.hotbar.assign(slot, content)) return;
  g.hotbarBar.invalidate();
  g.hud.flash(`${g.game.itemName(item)} on slot ${slot + 1}`);
  g.sfx.confirm();
}

/** ItemId -> the part it places. The two hand furnaces are absent because they
 *  are not a `PartKind`: they come out of the pack through `Machines` (GP-19),
 *  which is exactly the `furnace` slot kind. */
const PART_FOR_ITEM: Record<number, PartKind> = {
  0x003D: 'esmelter', 0x003E: 'generator', 0x003F: 'pole',
  0x0013: 'assembler',   // FS-56. `items::Assembler`, a live registered id.
};

/**
 * Leave for the other mode, from the menu.
 *
 * IT RELOADS, and that is the design and not a shortcut. A mode is stamped on
 * the save slot and decides which slot the world even lives in, so a session
 * that spent five minutes in each has no honest label to write. The current
 * world is saved to its OWN slot first, so switching costs nothing and coming
 * back finds it exactly as it was left.
 */
export function switchMode(g: Gameplay, to: GameMode): void {
  if (to === g.mode.mode) return;
  const href = urlForMode(window.location.href, to);
  void g.save().then(() => { window.location.assign(href); });
}
