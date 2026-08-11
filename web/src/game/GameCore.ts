// THE gameplay-state authority in the client: a typed face over the of_gp_*
// flat C ABI (of_core_api.cpp section 9), which is itself a thin shim over the
// tested `/core` gameplay.h. No rule is implemented here. Stack caps, yields,
// tool assistance, craft costs and smelt timings all come back out of WASM, so
// the browser cannot hold an opinion that the headless suites do not.
//
// STANDING RULE 5 lives in every read below: a scratch view is built AFTER the
// producing call and COPIED before anything else calls into WASM. Nothing here
// keeps a heap view in a field.

import { scratchF64, scratchI32, scratchU8, type OfCoreModule } from '../sim/wasm/heap.js';

export interface Slot { item: number; count: number }
export interface RecipeInput { item: number; have: number; need: number }
/**
 * WHY A CRAFT IS REFUSED. `gameplay.h`'s `CraftBlock`, in enum order.
 *
 * GP-51. `craftable` below is the INPUT side only, which is what /core's
 * `canCraft` answers and what `payInputs` needs; `block` is the whole answer.
 * They are two questions and not one, in the same way GP-48 keeps `freeBuild`
 * and `researchGated` apart: a full pack and an empty pack both make a craft
 * impossible and they need OPPOSITE actions from the player.
 */
export const CRAFT_BLOCK = {
  None: 0, NoRecipe: 1, InputsShort: 2, PackFull: 3,
} as const;

/** The refusal as a player reads it. One place, so the button's tooltip and the
 *  HUD flash cannot say different things about the same code. */
export function craftBlockText(block: number): string {
  if (block === CRAFT_BLOCK.PackFull) return 'pack is full  (drop something first)';
  if (block === CRAFT_BLOCK.InputsShort) return 'not enough materials';
  if (block === CRAFT_BLOCK.NoRecipe) return 'no such recipe';
  return '';
}

export interface RecipeView {
  index: number;
  output: number;
  outputCount: number;
  /** INPUTS ONLY. See `CRAFT_BLOCK`: this is true on a full pack. */
  craftable: boolean;
  /** The whole answer, as a `CRAFT_BLOCK` code. 0 means it will really craft. */
  block: number;
  inputs: RecipeInput[];
}
export interface NodeState {
  x: number; y: number; z: number;
  remaining: number; initial: number; grade: number;
  kind: number; resource: number;
}
export interface HarvestResult {
  granted: number; usedTool: boolean; nodeEmpty: boolean; resource: number;
  /** A `HarvestRefusal` code (GP-506): 0 unless the tool gate refused the
   *  swing outright. `granted === 0` used to mean "empty node" or "pack full"
   *  with no way to tell them apart from this event alone; this is the third
   *  case, named. */
  refusal: number;
}
/**
 * WHY A HARVEST SWING IS REFUSED. gameplay.h's `HarvestRefusal`, in enum
 * order (GP-506, mirrors `CRAFT_BLOCK`'s "ask before" shape).
 *
 * Only the TOOL gate is representable here: it is knowable in advance, from
 * what the pack holds and what the node is, which is what makes asking before
 * swinging possible at all. An empty node or a full pack are not — both
 * depend on the pull actually being computed — so they stay `granted === 0`
 * with `refusal === None`, read off `nodeEmpty` as before.
 */
export const HARVEST_REFUSAL = { None: 0, ToolRequired: 1 } as const;

/** The refusal as a player reads it. One place, so a HUD flash cannot say
 *  something different than the hint a hovering crosshair would give. */
export function harvestRefusalText(refusal: number): string {
  if (refusal === HARVEST_REFUSAL.ToolRequired) return 'need a pickaxe for this';
  return '';
}
/** One structural part: its item id, its render TypeId and its build cost. */
export interface StructureDef {
  index: number;
  item: number;
  typeId: number;
  /** `survival::StructureKind`, in enum order: foundation, floor, wall, door. */
  kind: number;
  cost: { item: number; count: number }[];
}
export interface FurnaceState {
  oreItem: number; oreCount: number; outItem: number; outCount: number;
  fuelTicks: number; progress: number; ticksPerSmelt: number; smelting: boolean;
}

/** The survival ItemId block, read from /core rather than transcribed. */
export interface ItemIds {
  wood: number; stone: number; coal: number; rawIron: number; rawCopper: number;
  water: number; oil: number; iron: number; copper: number;
  pickaxe: number; axe: number; furnace: number; smelter: number;
}

/** worldgen::survival::NodeKind, in enum order. */
export const NODE_KIND = {
  Tree: 0, Rock: 1, CoalSeam: 2, IronOre: 3, CopperOre: 4, WaterPool: 5, OilSeep: 6,
} as const;

const decoder = new TextDecoder();

export class GameCore {
  readonly ids: ItemIds;
  private readonly names = new Map<number, string>();

  constructor(private readonly M: OfCoreModule) {
    if (M._of_gp_init() !== 1) throw new Error('of_gp_init failed: no slice registry');
    M._of_gp_item_ids();
    const p = scratchI32(M, 13);
    this.ids = {
      wood: p[0], stone: p[1], coal: p[2], rawIron: p[3], rawCopper: p[4],
      water: p[5], oil: p[6], iron: p[7], copper: p[8],
      pickaxe: p[9], axe: p[10], furnace: p[11], smelter: p[12],
    };
  }

  // --- inventory -----------------------------------------------------------
  get slotCount(): number { return this.M._of_gp_slot_count(); }

  inventory(): Slot[] {
    const n = this.M._of_gp_inventory();
    const p = scratchI32(this.M, n * 2);
    const out: Slot[] = [];
    for (let i = 0; i < n; ++i) out.push({ item: p[i * 2], count: p[i * 2 + 1] });
    return out;
  }

  count(item: number): number { return this.M._of_gp_count(item); }
  /** Returns the overflow that did not fit. */
  add(item: number, count: number): number { return this.M._of_gp_add(item, count); }
  remove(item: number, count: number): number { return this.M._of_gp_remove(item, count); }
  clear(): void { this.M._of_gp_clear(); }

  /** Display name from the /core registry, memoised (the string never changes). */
  itemName(item: number): string {
    const hit = this.names.get(item);
    if (hit !== undefined) return hit;
    const n = this.M._of_gp_item_name(item);
    // slice() before anything else touches WASM: the view is over the heap.
    const name = n > 0 ? decoder.decode(scratchU8(this.M, n).slice()) : `#${item}`;
    this.names.set(item, name);
    return name;
  }

  /** Non-empty slots collapsed to one line per item, for the compact HUD. */
  carried(): { item: number; name: string; count: number }[] {
    const totals = new Map<number, number>();
    for (const s of this.inventory()) {
      if (s.item === 0 || s.count === 0) continue;
      totals.set(s.item, (totals.get(s.item) ?? 0) + s.count);
    }
    return [...totals.entries()]
      .map(([item, count]) => ({ item, name: this.itemName(item), count }))
      .sort((a, b) => a.item - b.item);
  }

  // --- harvest nodes -------------------------------------------------------
  /** Place one node on the oracle surface along `dir`. Returns its index. */
  addNode(body: number, edits: number, kind: number,
          dx: number, dy: number, dz: number): number {
    return this.M._of_gp_node_add(body, edits, kind, dx, dy, dz);
  }
  clearNodes(): void { this.M._of_gp_nodes_clear(); }
  get nodeCount(): number { return this.M._of_gp_nodes_count(); }

  node(i: number): NodeState | null {
    if (this.M._of_gp_node_state(i) !== 8) return null;
    const p = scratchF64(this.M, 8);
    return {
      x: p[0], y: p[1], z: p[2], remaining: p[3], initial: p[4],
      grade: p[5], kind: p[6], resource: p[7],
    };
  }

  harvest(i: number, baseYield: number, toolYield: number): HarvestResult {
    this.M._of_gp_node_harvest(i, baseYield, toolYield);
    const p = scratchI32(this.M, 5);
    return {
      granted: p[0], usedTool: p[1] !== 0, nodeEmpty: p[2] !== 0, resource: p[3],
      refusal: p[4],
    };
  }

  /** GP-506. Ask BEFORE swinging: would the tool gate refuse this node right
   *  now? A pure query, no mutation, no cooldown paid to find out. */
  harvestGate(i: number): number { return this.M._of_gp_node_harvest_gate(i); }

  // --- hand crafting -------------------------------------------------------
  recipes(): RecipeView[] {
    const n = this.M._of_gp_recipe_count();
    const out: RecipeView[] = [];
    for (let i = 0; i < n; ++i) {
      const len = this.M._of_gp_recipe_info(i);
      if (len < 4) continue;
      // One copy of the whole row: itemName() below calls back into WASM and
      // would otherwise detach the view mid-read.
      const p = scratchI32(this.M, len).slice();
      const inputs: RecipeInput[] = [];
      for (let k = 0; k < p[3]; ++k) {
        inputs.push({ item: p[4 + k * 3], have: p[5 + k * 3], need: p[6 + k * 3] });
      }
      // AFTER the copy above, because this is a second call into WASM and would
      // detach the view (standing rule 5).
      const block = this.M._of_gp_craft_block(i);
      out.push({
        index: i, output: p[0], outputCount: p[1], craftable: p[2] !== 0,
        block, inputs,
      });
    }
    return out;
  }

  /** GP-51. Ask BEFORE crafting, or ask again after a refusal to say why. */
  craftBlock(index: number): number { return this.M._of_gp_craft_block(index); }

  craft(index: number): boolean { return this.M._of_gp_craft(index) === 1; }

  // --- structural building set ---------------------------------------------
  /**
   * The four structural parts and what each one COSTS, straight out of /core.
   *
   * The costs are authored in `gameplay.h` §S.6 as `CraftRecipe`s, so balance
   * moves in the header the headless suites test and never in a JS table. The
   * guard is for one window only: a client running against a wasm older than
   * ABI 5 has no structural surface, and losing the build menu is a better
   * failure than a page that will not boot.
   */
  structures(): StructureDef[] {
    const M = this.M as Partial<OfCoreModule>;
    if (typeof M._of_gp_structure_count !== 'function') return [];
    const n = this.M._of_gp_structure_count();
    const out: StructureDef[] = [];
    for (let i = 0; i < n; ++i) {
      const len = this.M._of_gp_structure_info(i);
      if (len < 4) continue;
      const p = scratchI32(this.M, len).slice();
      const cost: { item: number; count: number }[] = [];
      for (let k = 0; k < p[3]; ++k) {
        cost.push({ item: p[4 + k * 2], count: p[5 + k * 2] });
      }
      out.push({ index: i, item: p[0], typeId: p[1], kind: p[2], cost });
    }
    return out;
  }

  /** Can the pack pay for structure `index` right now? /core answers. */
  structureAfford(index: number): boolean {
    const M = this.M as Partial<OfCoreModule>;
    if (typeof M._of_gp_structure_can_afford !== 'function') return false;
    return this.M._of_gp_structure_can_afford(index) === 1;
  }

  /** Spend the cost, all or nothing. Returns false and spends nothing if short. */
  structurePay(index: number): boolean {
    const M = this.M as Partial<OfCoreModule>;
    if (typeof M._of_gp_structure_pay !== 'function') return false;
    return this.M._of_gp_structure_pay(index) === 1;
  }

  // --- furnaces ------------------------------------------------------------
  /**
   * What `ore` smelts into, or 0. THE SIM'S OWN TABLE (gameplay.h
   * `smeltOutputFor`, the same export the auto-line reads): the panel's "what
   * can this furnace take" question is answered here and never by a JS list,
   * because a hand-rolled second acceptance table is one balance pass away from
   * smelting coal into iron (GP-58).
   */
  smeltOutputFor(item: number): number {
    return this.M._of_gp_smelt_output_for(item);
  }

  /**
   * Furnace ore buffer -> pack. PUBLISHED AGAINST A SEAM (GP-58): /core's
   * `Furnace` has `loadOre` and no `takeOre`, so the export
   * `of_gp_furnace_take_ore(f, want)` does not exist yet. Null means "the seam
   * is not filled"; the caller says so out loud rather than doing nothing. The
   * day the bridge lane exports it (moves up to `want` ore furnace->pack,
   * returns the count moved, pack overflow stays in the furnace), this client
   * works unchanged.
   */
  furnaceTakeOre(f: number, want: number): number | null {
    const M = this.M as { _of_gp_furnace_take_ore?: (f: number, w: number) => number };
    if (typeof M._of_gp_furnace_take_ore !== 'function') return null;
    return M._of_gp_furnace_take_ore(f, want);
  }

  furnaceCreate(tier: number): number { return this.M._of_gp_furnace_create(tier); }
  furnaceDestroy(f: number): void { this.M._of_gp_furnace_destroy(f); }
  /** Pack -> furnace, as ore or fuel. Returns the count actually moved. */
  furnaceInsert(f: number, item: number, count: number): number {
    return this.M._of_gp_furnace_insert(f, item, count);
  }
  /** Furnace -> pack. Returns the count moved. */
  furnaceCollect(f: number, want: number): number {
    return this.M._of_gp_furnace_collect(f, want);
  }
  /** Advance the furnace. Returns the smelts completed in the window. */
  furnaceRun(f: number, ticks: number): number {
    return this.M._of_gp_furnace_run(f, ticks);
  }
  furnaceState(f: number): FurnaceState | null {
    if (this.M._of_gp_furnace_state(f) !== 8) return null;
    const p = scratchI32(this.M, 8);
    return {
      oreItem: p[0], oreCount: p[1], outItem: p[2], outCount: p[3],
      fuelTicks: p[4], progress: p[5], ticksPerSmelt: p[6], smelting: p[7] !== 0,
    };
  }
}
