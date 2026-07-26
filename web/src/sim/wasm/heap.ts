// Typed-array views over the WASM heap.
//
// STANDING RULE 5 (DECISIONS.md) lives here and nowhere else: -sALLOW_MEMORY_GROWTH
// can replace the whole WebAssembly.Memory buffer on ANY allocation, which detaches
// every typed array over the old buffer, and the scratch vectors can move on any
// producing call. So: never cache a heap view or a scratch pointer across a call
// into WASM. Re-read M.HEAPxx AND re-read the pointer, in that order, every time.
//
// Every scratch read in the codebase goes through these four helpers, so the rule
// is not something a caller can forget.

/** The Emscripten module, narrowed to the exports we actually call. */
export interface OfCoreModule {
  HEAPU8: Uint8Array;
  HEAP8: Int8Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  _of_abi_version(): number;
  _of_last_hi(): number;
  _of_scratch_f32(): number;
  _of_scratch_f64(): number;
  _of_scratch_i32(): number;
  _of_scratch_u8(): number;

  _of_body_create_forge(seedLo: number, seedHi: number): number;
  _of_body_create_cinder(seedLo: number, seedHi: number): number;
  _of_body_destroy(body: number): void;
  _of_body_radius(body: number): number;
  _of_body_max_relief(body: number): number;
  _of_body_mu(body: number): number;
  _of_gravity_accel(body: number, rM: number): number;
  _of_body_kind(body: number): number;

  _of_base_height(body: number, dx: number, dy: number, dz: number): number;
  /** WG-22. Metres of PLACED ground stacked on the base under this dir. */
  _of_derived_raising(body: number, edits: number, dx: number, dy: number,
                      dz: number): number;
  /** Signed metres the edited surface sits BELOW the base; negative = raised. */
  _of_surface_offset(body: number, edits: number, dx: number, dy: number,
                     dz: number): number;
  /** The fill cap the oracle clamps the heightfield view to, in metres. */
  _of_max_fill(): number;
  _of_surface_height(body: number, edits: number, dx: number, dy: number, dz: number): number;
  _of_surface_radius(body: number, edits: number, dx: number, dy: number, dz: number): number;
  _of_solid_at(body: number, edits: number, x: number, y: number, z: number): number;
  _of_solid_cell(body: number, edits: number, cx: number, cy: number, cz: number): number;
  _of_biome_at(body: number, dx: number, dy: number, dz: number): number;

  // --- W5 voxel edits. The main thread owns the ONE handle (DW-16); workers
  //     replay the op log into their own instance, they never share this one.
  _of_edits_create(): number;
  _of_edits_destroy(edits: number): void;
  _of_edits_dig(edits: number, body: number, x: number, y: number, z: number,
                radiusM: number): number;
  _of_edits_dig_cell(edits: number, cx: number, cy: number, cz: number): number;
  _of_edits_removed_count(edits: number): number;
  _of_edits_is_removed_cell(edits: number, cx: number, cy: number, cz: number): number;
  // --- WG-22 terraforming: the FILL half. `added` is the second sparse set, so
  //     ground the player PUT DOWN is a first class citizen of the same diff.
  _of_edits_fill(edits: number, body: number, x: number, y: number, z: number,
                 radiusM: number): number;
  _of_edits_fill_cell(edits: number, body: number, cx: number, cy: number,
                      cz: number): number;
  _of_edits_added_count(edits: number): number;
  _of_edits_is_added_cell(edits: number, cx: number, cy: number, cz: number): number;
  /**
   * THE LEVELLING OP. Inside a cylinder of `radiusM` about (x,y,z) aligned with
   * the local up, every cell above `targetHeightM` becomes air and every cell
   * below it becomes solid. Returns total cells changed; i32 scratch holds
   * [dug, filled, scanned]. Pass 0 for either bound to take /core's default.
   */
  _of_level_area(edits: number, body: number, x: number, y: number, z: number,
                 radiusM: number, targetHeightM: number,
                 maxCutM: number, maxFillM: number): number;
  /** Fills i32 scratch [minX,minY,minZ,maxX,maxY,maxZ]; 1 = valid, 0 = untouched. */
  _of_edits_dirty_region(edits: number): number;
  _of_edits_clear_dirty(edits: number): void;
  /** DW-17. Write the removed-cell diff into the u8 scratch. Byte count, or -1. */
  _of_edits_serialize(edits: number): number;
  /** Size the u8 scratch to `n` bytes so JS can copy a saved diff in. */
  _of_edits_alloc_bytes(n: number): void;
  /** Load the diff from the u8 scratch. Returns the removed-cell count, or -1. */
  _of_edits_deserialize(edits: number): number;
  /** Face count; i32 scratch holds 5 ints per face [cx,cy,cz,axis,sign]. */
  _of_exposed_faces(body: number, edits: number, x: number, y: number, z: number,
                    radiusM: number): number;
  _of_voxel_size(): number;
  _of_cell_for_pos(x: number, y: number, z: number): void;
  _of_cell_center(cx: number, cy: number, cz: number): void;
  _of_streamer_set_edits(s: number, edits: number): void;
  /** Replay one dig into the streamer's own edits and re-mesh the chunks it
   *  opened, publishing them through the normal ready path. Returns the count. */
  _of_streamer_dig(s: number, x: number, y: number, z: number, radiusM: number): number;
  /**
   * Replace the streamer's own edit set from the u8 scratch and re-mesh every
   * resident chunk within radiusM of (x,y,z). The RESTORE path: a worker
   * reconciled against the authority, not against a history of ops.
   */
  _of_streamer_load_edits(s: number, x: number, y: number, z: number,
                          radiusM: number): number;
  /** The same replay for a LEVEL op (WG-22). Returns chunks re-meshed. */
  _of_streamer_level(s: number, x: number, y: number, z: number, radiusM: number,
                     targetHeightM: number, maxCutM: number,
                     maxFillM: number): number;
  _of_material_for_biome(biome: number): number;
  _of_latlon_to_dir(lat: number, lon: number): void;
  _of_dir_to_latlon(dx: number, dy: number, dz: number): void;

  _of_streamer_create(body: number, splitRatio: number, mergeHysteresis: number,
                      maxDepth: number, minResidentDepth: number,
                      skirtFraction: number, genBudget: number): number;
  _of_streamer_destroy(s: number): void;
  // ABI 2: takes the edits handle and derives from of_surface_radius, so it is
  // now on the one surface authority. SurfaceOracle.observerPos still computes
  // the position itself, which keeps the oracle the single caller of record.
  _of_observer_latlon_alt(body: number, edits: number, lat: number, lon: number,
                          altM: number): void;
  _of_streamer_update(s: number, ox: number, oy: number, oz: number): number;
  _of_streamer_evicted_count(s: number): number;
  _of_streamer_generated(s: number): number;
  _of_streamer_converged(s: number): number;
  _of_streamer_resident_count(s: number): number;
  _of_streamer_ready_keys(s: number): number;
  _of_streamer_evicted_keys(s: number): number;

  _of_chunk_meta(s: number, i: number): number;
  _of_chunk_anchor(s: number, i: number): number;
  _of_chunk_neighbour_depths(s: number, i: number): number;
  _of_chunk_packed(s: number, i: number): number;
  _of_chunk_max_offset(s: number, i: number): number;

  _of_packed_stride(): number;
  _of_packed_vertex_count(): number;
  _of_chunk_index_buffer(): number;
  _of_chunk_index_ptr(): number;
  _of_chunk_interior_index_count(): number;

  // --- W5 gameplay slice (of_core_api.cpp section 9). One SliceRegistry and one
  //     Inventory per module instance, so these are singletons on the MAIN
  //     thread instance only; a worker's copy is a different pack.
  _of_gp_init(): number;
  _of_gp_slot_count(): number;
  /** Fills i32 scratch with [item, count] per slot. Returns the slot count. */
  _of_gp_inventory(): number;
  _of_gp_count(item: number): number;
  _of_gp_add(item: number, count: number): number;
  _of_gp_remove(item: number, count: number): number;
  _of_gp_clear(): number;
  _of_gp_item_count(): number;
  _of_gp_item_at(index: number): number;
  /** Writes the display name into the u8 scratch. Returns the byte length. */
  _of_gp_item_name(item: number): number;
  /** Fills i32 scratch with the 13 survival ItemIds. Returns 13. */
  _of_gp_item_ids(): number;

  _of_gp_kinds_reset(): void;
  _of_gp_kinds_push(kind: number): void;
  _of_gp_nodes_clear(): void;
  _of_gp_nodes_count(): number;
  _of_gp_nodes_layout(body: number, edits: number, dx: number, dy: number,
                      dz: number, ringRadiusRad: number): number;
  _of_gp_node_add(body: number, edits: number, kind: number,
                  dx: number, dy: number, dz: number): number;
  /** f64 scratch [x,y,z,remaining,initial,grade,kind,resource]. Returns 8. */
  _of_gp_node_state(i: number): number;
  /** i32 scratch [granted,usedTool,nodeEmpty,resource]. Returns granted. */
  _of_gp_node_harvest(i: number, baseYield: number, toolYield: number): number;

  _of_gp_recipe_count(): number;
  /** i32 scratch [out,outN,can,inN,(item,have,need)*inN]. Returns the length. */
  _of_gp_recipe_info(i: number): number;
  _of_gp_craft(i: number): number;

  _of_gp_furnace_create(tier: number): number;
  _of_gp_furnace_destroy(f: number): void;
  _of_gp_furnace_insert(f: number, item: number, count: number): number;
  _of_gp_furnace_collect(f: number, want: number): number;
  _of_gp_furnace_run(f: number, ticks: number): number;
  /** i32 scratch [oreItem,oreN,outItem,outN,fuel,progress,perSmelt,on]. 8. */
  _of_gp_furnace_state(f: number): number;
  /** Remove ore from a node WITHOUT granting it. Returns the units removed.
   * A node that is an OUTCROP of a patch drains its patch, because it holds no
   * ore of its own. */
  _of_gp_node_drain(i: number, units: number): number;

  // --- ABI 3: ORE PATCHES (deposits.h §P). A deposit is an irregular area of
  //     ground holding ONE pool. Every shape and balance answer is /core's; the
  //     directions that come back are UNIT vectors, so the caller re-asks the
  //     surface oracle for the radius and a dug patch still hugs the ground.
  _of_gp_patches_clear(): void;
  _of_gp_patches_count(): number;
  /** Lay out one patch per queued kind around `dir`. Returns the total. */
  _of_gp_patch_layout(body: number, edits: number, dx: number, dy: number,
                      dz: number, spreadM: number): number;
  /** f64 scratch, 18: centre, dir, t1, t2, radiusM, kind, resource, grade,
   * initial, remaining. Returns 18. */
  _of_gp_patch_state(i: number): number;
  /** f64 scratch [dirX,dirY,dirZ,coverage] per vertex. Returns the count. */
  _of_gp_patch_mesh(i: number, rings: number, segs: number): number;
  /** f64 scratch [dirX,dirY,dirZ,scale,sink,coverage]. Returns the count. */
  _of_gp_patch_outcrops(i: number): number;
  /** Coverage in [0,1] at a body-frame point. 0 means "not on this patch". */
  _of_gp_patch_cover(i: number, x: number, y: number, z: number): number;
  /** Which patch is under this point, or -1. THE drill placement question. */
  _of_gp_patch_find(x: number, y: number, z: number): number;
  /** A drill's units per second where it stands: rate times richness. */
  _of_gp_patch_drill_rate(i: number, x: number, y: number, z: number): number;
  /** Take ore out of a patch without granting it. Returns what was removed. */
  _of_gp_patch_drain(i: number, units: number): number;
  /** Add a harvest node that is an outcrop OF a patch. Returns its index. */
  _of_gp_node_add_outcrop(body: number, edits: number, patch: number,
                          dx: number, dy: number, dz: number): number;
  /** What `ore` smelts into (gameplay.h smeltOutputFor), or 0 if not an ore. */
  _of_gp_smelt_output_for(ore: number): number;
  // --- DW-17 save slot. The BYTES are persistence.h's SaveWriter format; the
  //     container is JS's, because persistence_file.h has no browser
  //     filesystem. Encoding the pack in JS would give the format two authors.
  /** Write the pack into the u8 scratch. Returns the byte count, or -1. */
  _of_gp_inventory_serialize(): number;
  /** Size the u8 scratch to `n` bytes so JS can copy a slot in. */
  _of_gp_bytes_alloc(n: number): void;
  /** Load the pack from the u8 scratch. Returns the units restored, or -1. */
  _of_gp_inventory_deserialize(): number;

  // --- W6 automation (of_core_api.cpp section 7, over automation.h). One
  //     BuildableNetwork per handle; buildings are per-network build indices.
  _of_net_create(fixedDt: number): number;
  _of_net_destroy(n: number): void;
  _of_net_place_miner(n: number, deposit: number, item: number,
                      ratePerSecond: number, outCap: number): number;
  _of_net_place_miner_for_node(n: number, kind: number, deposit: number,
                               ratePerSecond: number, outCap: number): number;
  _of_net_place_belt(n: number, tiles: number, speed: number): number;
  _of_net_place_smelter(n: number, ore: number, ingot: number, craftTicks: number,
                        powerW: number, outCap: number): number;
  _of_net_place_assembler(n: number, inA: number, countA: number, inB: number,
                          countB: number, out: number, outCount: number,
                          craftTicks: number, powerW: number, outCap: number): number;
  /** Wire two buildings; item 0 auto-infers. 1 on success. */
  _of_net_connect(n: number, from: number, to: number, item: number): number;
  _of_net_step_n(n: number, ticks: number): void;
  _of_net_tick_index(n: number): number;
  _of_net_produced_of(n: number, item: number): number;
  _of_net_miner_remaining(n: number, build: number): number;
  _of_net_miner_depleted(n: number, build: number): number;
  _of_net_output_buffer(n: number, build: number): number;
  _of_net_input_buffer(n: number, build: number): number;
  _of_net_belt_item_count(n: number, build: number): number;
  _of_net_working(n: number, build: number): number;
  _of_net_progress01(n: number, build: number): number;
  _of_net_feed_machine(n: number, build: number, count: number): number;
  _of_net_take_output(n: number, build: number, want: number): number;
  _of_net_set_placement(n: number, build: number, typeId: number,
                        x: number, y: number, z: number, boundCm: number): void;
  _of_net_entity_index(n: number, build: number): number;
  _of_net_build_count(n: number): number;
  /** Rows; i32 [Id,TypeId,VisualState,AnimPhase,Lod,BoundRadius], f32 [x,y,z]. */
  _of_net_emit_entity_states(n: number): number;
  /** Rows; i32 [LineId,ItemDominant,FlowSpeedQuant,Density,Compressed]. */
  _of_net_emit_belt_flows(n: number): number;
  /** Items; i32 [ItemType,UnitOffset] per item. LOD-0 only (the O(items) pull). */
  _of_net_get_line_items(n: number, build: number): number;
  _of_net_units_per_tile(): number;
}

/** Read the f64 scratch arena. Call AFTER the producing call, never before. */
export function scratchF64(M: OfCoreModule, n: number): Float64Array {
  const p = M._of_scratch_f64();
  return M.HEAPF64.subarray(p >>> 3, (p >>> 3) + n);
}

export function scratchF32(M: OfCoreModule, n: number): Float32Array {
  const p = M._of_scratch_f32();
  return M.HEAPF32.subarray(p >>> 2, (p >>> 2) + n);
}

export function scratchI32(M: OfCoreModule, n: number): Int32Array {
  const p = M._of_scratch_i32();
  return M.HEAP32.subarray(p >>> 2, (p >>> 2) + n);
}

export function scratchU8(M: OfCoreModule, n: number): Uint8Array {
  const p = M._of_scratch_u8();
  return M.HEAPU8.subarray(p, p + n);
}

/** A retained (non-scratch) uint16 span. Still invalidated by memory growth. */
export function viewU16(M: OfCoreModule, ptr: number, n: number): Uint16Array {
  return M.HEAPU16.subarray(ptr >>> 1, (ptr >>> 1) + n);
}
