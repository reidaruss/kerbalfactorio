// The ABI 9 half of the module surface: the electrical grid, the tech tree and
// the player's own progression. Split out of heap.ts because that file carries
// the standing-rule-5 argument about heap views and should stay readable, and
// because these three arrived together in one bump and read as one block.
//
// `OfCoreModule` extends this, so every call site is unchanged and there is
// still exactly ONE type describing what the wasm exports.

export interface OfCoreProgressApi {
  // --- ABI 9 §14: THE ELECTRICAL GRID (power.h through automation.h) ---------
  // Watts are int32 everywhere below and ENERGY IS NOT: one coal unit is 4e9
  // millijoules, so `_of_net_generator_energy_j` returns joules as a double.
  // Positions are LOCAL metres about the plan anchor, the frame
  // `_of_net_set_placement` already uses.
  _of_net_enable_grid(n: number, on: number): void;
  _of_net_grid_enabled(n: number): number;
  /** cls: 0 small, 1 medium, 2 substation. Returns the PoleId, or -1. */
  _of_net_place_pole(n: number, x: number, y: number, z: number,
                     cls: number): number;
  _of_net_remove_pole(n: number, poleId: number): number;
  _of_net_pole_count(n: number): number;
  _of_net_place_burner_generator(n: number, x: number, y: number, z: number,
                                 fuelItem: number): number;
  /** Units ACCEPTED, which is not always `count`. Remove exactly this many. */
  _of_net_insert_fuel(n: number, genId: number, item: number,
                      count: number): number;
  _of_net_generator_fuel(n: number, genId: number): number;
  _of_net_generator_output_w(n: number, genId: number): number;
  _of_net_generator_available_w(n: number, genId: number): number;
  _of_net_generator_energy_j(n: number, genId: number): number;
  _of_net_connect_to_grid(n: number, build: number, x: number, y: number,
                          z: number, ratedDrawW: number): void;
  _of_net_place_electric_smelter(n: number, ore: number, ingot: number,
                                 x: number, y: number, z: number,
                                 craftTicks: number, powerW: number,
                                 outCap: number): number;
  _of_net_network_count(n: number): number;
  /** i32 [id, capacityW, productionW, demandW, consumptionW, satisfactionQ16,
   *  poles, generators, consumers, fuelledGenerators]. Returns 10. */
  _of_net_network_stats(n: number, net: number): number;
  /** i32 [tick, productionW, demandW, satisfactionQ16] per sample, oldest
   *  first. Returns the SAMPLE count, so read `count * 4` elements. */
  _of_net_network_history(n: number, net: number): number;
  /** f32 [ax,ay,az,bx,by,bz,network] per segment. Returns the SEGMENT count. */
  _of_net_wires(n: number): number;
  /** -1 means NO POLE REACHES IT, which is not "short of power". */
  _of_net_build_network(n: number, build: number): number;
  /** Q16.16: 65536 is full speed. Never-registered reads 65536, off-grid 0. */
  _of_net_build_satisfaction(n: number, build: number): number;

  // --- ABI 9 §15: RESEARCH (research.h, green since June, never once called) --
  _of_rs_init(): number;
  _of_rs_tech_count(): number;
  _of_rs_tech_id(i: number): number;
  _of_rs_tech_name(i: number): number;
  /** i32 [id, depth, unlocked, canResearch, block, prereq, milestone,
   *  costItem, shortBy]. `block` is ResearchBlock in enum order. Returns 9. */
  _of_rs_tech_state(i: number): number;
  _of_rs_tech_prereqs(i: number): number;
  /** i32 [item, have, need] per row. Returns the ROW count. */
  _of_rs_tech_cost(i: number): number;
  /** i32 [kind, id] per row; kind 0 item, 1 entity, 2 recipe. ROW count. */
  _of_rs_tech_unlocks(i: number): number;
  /** Spend the science and apply the unlock. All or nothing. */
  _of_rs_try(techId: number): number;
  _of_rs_item_available(item: number): number;
  _of_rs_entity_available(typeId: number): number;
  _of_rs_item_gated(item: number): number;
  _of_rs_recipe_available(index: number): number;
  _of_rs_set_milestone(m: number): number;
  _of_rs_has_milestone(m: number): number;
  _of_rs_milestone_name(m: number): number;
  _of_rs_milestones(): number;
  _of_rs_unlocked(): number;
  _of_rs_restore(techId: number): number;
  _of_rs_science_items(): number;

  // --- ABI 9 §16: PLAYER PROGRESSION (progression.h) -------------------------
  _of_pg_slot_count(): number;
  _of_pg_slot_name(slot: number): number;
  /** The armour_set.glb node name for a slot. A pure function of the slot. */
  _of_pg_armour_node(slot: number): number;
  _of_pg_worn(slot: number): number;
  _of_pg_equip(item: number): number;
  _of_pg_unequip(slot: number): number;
  _of_pg_armour_count(): number;
  /** f64 [item, slot, damageReduction, moveSpeedMul, insulationC]. */
  _of_pg_armour_info(i: number): number;
  /** f64 [damageReduction, moveSpeedMul, insulationC], the summed suit. */
  _of_pg_total(): number;
  _of_pg_damage_after(raw: number): number;
  _of_pg_worn_all(): number;
  _of_pg_restore_worn(head: number, chest: number, legs: number,
                      feet: number): number;
  _of_pg_skill_count(): number;
  _of_pg_skill_name(i: number): number;
  /** f64 [level, xp, progress, multiplier, nextAt]. `nextAt` is 0 at the cap. */
  _of_pg_skill_state(i: number): number;
  /** Returns how many LEVELS the grant bought. */
  _of_pg_add_xp(i: number, n: number): number;
  _of_pg_apply_yield(i: number, base: number): number;
  _of_pg_skill_xp_all(): number;
  _of_pg_restore_skills(mining: number, forestry: number, smelting: number,
                        building: number, piloting: number): void;
  /** i32 [skin, suitPrimary, suitSecondary, visor, build]. */
  _of_pg_appearance(): number;
  _of_pg_set_appearance(field: number, value: number): number;
  /** i32 packed 0xRRGGBB. which: 0 skin, 1 suit, 2 visor. */
  _of_pg_palette(which: number): number;
}
