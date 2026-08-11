// THE ONLY module that constructs the Emscripten Module object.
//
// Loads web/wasm/dist/of-core.{mjs,wasm} (synced into public/wasm by
// scripts/sync-wasm.mjs). Works unchanged on the main thread and inside a module
// worker, which is the point: DECISIONS.md DW-4 gives every JS thread its own
// single-threaded instance, with no SharedArrayBuffer and no COOP/COEP.

import type { OfCoreModule } from './heap.js';
import { HandleLedger } from './HandleLedger.js';

// ABI 2 (2026-07-25, the surface-authority audit): of_observer_latlon_alt gained
// an `edits` parameter and now reads the oracle, of_quadmesh_generate's last
// parameter became `rawBase` so 0 is the safe value, and of_chunk_max_offset
// became a true Euclidean bound including the skirt (WASM-BRIDGE.md section 4.1).
// ABI 3 (2026-07-26): the of_gp_patch_* ore-body surface over deposits.h.
// ABI 4 (2026-07-26): TERRAFORMING (WG-22). VoxelEdits gained a second sparse
// set so fill is representable; of_edits_fill, of_level_area, of_derived_raising
// and of_surface_offset are new, and of_edits_serialize writes a new
// self-describing format that carries BOTH sets (old slots still load).
// ABI 5 (2026-07-26): the STRUCTURAL BUILDING SET (gameplay.h section S.6).
// of_gp_structure_count / _info / _can_afford / _pay expose the four base
// building parts and their authored build costs. Additive: no existing
// signature or struct layout changed, so every ABI 4 caller is unaffected.
// ABI 6 (2026-07-26): the VESSEL SURFACE (vessel.h / atmosphere.h / flight.h).
// of_vs_* is the part catalogue as data, the item form of a part and its build
// cost, the vessel TREE, staging (autostage plus a reorder that renumbers the
// parts with the rows) and the derived delta-v / mass / TWR figures DW-30 item 4
// makes non-negotiable. of_atmo_* and of_fl_* are the atmosphere and a FlightSim
// pass-through, landed in the SAME bump because a second one costs more than one
// file. Declared in sim/wasm/vesselabi.ts, not here: heap.ts is at the line cap.
// ABI 12 (2026-07-27): THE DISCOVERABLE MAP (discovery.h, WG-29 / DW-36).
// of_disc_* publishes what the player has SEEN of a body as WORLD state: one
// rule (a cell is discovered when the observer has been somewhere it was above
// their horizon) read at two resolutions, a coarse SURVEY layer that orbit
// fills in and a fine EXPLORE layer capped at 10 km of ground chord. reset /
// ensure / configure / clear own the field, observe feeds BOTH layers from one
// call, has is the gate, window hands the map the discovered cells' CORNERS,
// report publishes the counts taken inside those calls (including window
// truncation), and serialize / alloc_bytes / deserialize persist it exactly as
// of_edits_* does.
// THE SAVE IS SELF-DESCRIBING, which is an ordering fix and not a format
// preference: the stream carries the body radius, so deserialize needs no field
// to exist first, and `ensure` resets only when there is no field or it is cut
// for another body, so the map built AFTER the save was applied cannot wipe what
// was just restored. Without both halves a reload lost everything the player had
// explored and the next autosave made it permanent (restored.discovery = -1).
// Additive: no existing signature or value moved; `ensure` is new and the
// discovery byte format changed, which it may, because 12 is not landed and no
// shipped build has ever written a save with it. Declared in
// sim/wasm/discabi.ts, not here, for the same line-cap reason.
//
// This constant is the only thing standing between a browser and a wasm that
// answers a different question than the one the client is asking. It was left at
// 2 while the shim already returned 3, which is the failure it exists to catch,
// and it happened again at 4 against a shim reporting 5. AN ABI BUMP IS ATOMIC
// ACROSS THE BRIDGE: the shim's version, the rebuilt and SYNCED wasm, this
// constant and its callers land in one commit, and that commit boots.
// ABI 15 (2026-07-27): THE ENEMY LOOP (enemies.h, GP-85). §20 of the shim adds
// the of_en_* surface: emitters in, the pollution field spreads and decays,
// nests absorb and attribute, evolution rises from three separately accounted
// inputs, and AttackWaves come out with an origin, a target and a roster.
// PURELY ADDITIVE, so every ABI 14 caller is unaffected and the bump exists only
// so this handshake can say the surface is there. Declared in
// sim/wasm/enemyabi.ts, not here, for the same line-cap reason vesselabi.ts and
// discabi.ts are.
// ABI 16 (2026-07-27): THE WATER LEVEL (water_field.h, WG-36). §3b of the shim
// adds the of_water_* surface. The export list is purely additive, but the bump
// is NOT cosmetic: the pond's BASIN is a change to sampleDesignedHeight, which
// is what every existing surface call and every streamed chunk returns, so an
// old wasm under this client would draw a pond nothing collided with. Refusing
// to boot is the correct outcome and the whole reason the handshake exists.
// ABI 17 (2026-07-27): THE SECOND INGREDIENT CAN BE HAND-FED (FS-56). One new
// export, of_net_feed_machine2, onto factory_sim.h's `feedMachine2`, which has
// existed since the multi-input Recipe landed and had no way across. Purely
// additive, and NOT a convenience: `commitPlan` rebuilds the whole network on
// every placement and carries each machine's input buffer across by reading it
// and feeding it back, so with only slot 1 reachable every belt tile laid
// anywhere in a base silently deleted whatever every assembler was holding in
// slot 2. The bump exists to close a loss that had no message.
// ABI 18 (2026-07-27): A VESSEL CAN BE PUT BACK, AND A VESSEL CAN BE LEFT
// (PH-64 to PH-67). Three exports, all additive: `of_fl_set_propellant`, the one
// write the fuel surface never had, without which a restored vessel comes back
// with FULL TANKS and free delta-v (R11 refused to ship exactly that); and
// `of_orb_park` / `of_orb_resume`, which are `orbital::park`/`resume` reaching
// the browser, so an unattended vessel can be advanced ANALYTICALLY instead of
// by keeping alive the object that leaving it was meant to retire.
// ABI 19 (2026-07-28): STORAGE EXISTS (factory_sim.h EntityKind::Container,
// FS-66). Six of_net_container_* exports, purely additive. A container holds ONE
// item type up to a capacity, refuses a second type with visible back pressure,
// and RELEASES its type when emptied so a chest is reusable. It has no recipe,
// no progress and no system of its own: the inserters do the work at both ends.
// The absence of a recipe is the design, not an omission: FS-49 refused storage
// as a pass-through machine because `producedCountOf` is a lifetime production
// tally, so a box passing 500 iron along would have reported manufacturing 500
// iron. Here that is impossible by construction rather than by rule.
// ABI 20 (2026-07-28): A RADIAL PART'S ORIGIN IS A DECLARED PROPERTY (PH-81).
// `PartDef` gained a REQUIRED `radialOrigin`: MountPlane (the origin is the
// inboard mount face, body outward: fin, solar panel, RCS, leg, vernier, radial
// decoupler) or Axis (the origin is the part's own centreline, because the same
// mesh also serves stack mounting: the Solid Booster). `vessel.h::originFrom`
// and `centroidOf` branch on the declaration instead of assuming mount-plane
// semantics, which is what buried half a strap-on booster inside a 1.25 m core.
// Same bump: `of_vs_transforms` / `of_fl_transforms` are NINE doubles per part,
// the ninth being `radialOffsetM`, appended so no existing index moves.
// ABI 23 (2026-08-11, GP-506): `of_gp_node_harvest`'s i32 scratch grows a 5th
// word, `refusal` (a `HarvestRefusal` code), and `of_gp_node_harvest_gate(i)`
// is a new pure query. Both additive.
export const OF_ABI_VERSION = 23;

type Factory = (opts?: Record<string, unknown>) => Promise<OfCoreModule>;

function glueUrl(): string {
  // BASE_URL keeps this correct when the site is served from a subpath.
  const base = import.meta.env.BASE_URL || '/';
  return new URL(`${base}wasm/of-core.mjs`, self.location.href).href;
}

/**
 * Construct one WASM instance. Handle id spaces are per instance, and heaps are
 * never shared, so callers must not pass handles between threads
 * (WASM-BRIDGE.md section 3.1).
 */
export async function loadOfCore(): Promise<OfCoreModule> {
  const mod = (await import(/* @vite-ignore */ glueUrl())) as { default: Factory };
  const M = await mod.default();
  const abi = M._of_abi_version();
  if (abi !== OF_ABI_VERSION) {
    throw new Error(`of-core ABI mismatch: wasm reports ${abi}, client expects ${OF_ABI_VERSION}`);
  }
  // CE-19. Every handle this thread mints is counted from here on. This is the
  // only module-construction site in the client, on the main thread and in every
  // worker, which is what makes the census total rather than opt-in: a caller
  // cannot bypass it without constructing a module some other way, and nothing
  // does. See sim/wasm/HandleLedger.ts for what it can and cannot see.
  HandleLedger.install(M, threadLabel());
  return M;
}

/** 'main', or the Worker's own `name` ('of-terrain', 'of-oracle-probe'). */
function threadLabel(): string {
  if (typeof window !== 'undefined') return 'main';
  const n = (self as unknown as { name?: string }).name;
  return n !== undefined && n !== '' ? n : 'worker';
}

export interface OracleTiming {
  baseHeightUs: number;
  surfaceHeightUs: number;
  biomeAtUs: number;
  solidAtUs: number;
}

/**
 * Measure the synchronous main-thread oracle cost. WASM-BRIDGE.md section 7.2
 * puts these at 1.4 to 3.8 microseconds under node; this is the browser number,
 * and the frame budget depends on it staying there.
 */
export function benchOracle(M: OfCoreModule, body: number, iters = 4000): OracleTiming {
  // Sweep directions so the noise stack cannot be cached by branch luck.
  const dirs = new Float64Array(iters * 3);
  for (let i = 0; i < iters; ++i) {
    const a = (i * 0.61803398875) % 1;
    const lat = (a - 0.5) * 3.0;
    const lon = ((i * 0.7548776662) % 1) * 6.2831853;
    const cl = Math.cos(lat);
    dirs[i * 3] = cl * Math.cos(lon);
    dirs[i * 3 + 1] = Math.sin(lat);
    dirs[i * 3 + 2] = cl * Math.sin(lon);
  }
  const time = (fn: (i: number) => number): number => {
    let sink = 0;
    const t0 = performance.now();
    for (let i = 0; i < iters; ++i) sink += fn(i);
    const dt = performance.now() - t0;
    if (!Number.isFinite(sink)) throw new Error('oracle produced NaN');
    return (dt * 1000) / iters;
  };
  const R = M._of_body_radius(body);
  return {
    baseHeightUs: time((i) => M._of_base_height(body, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])),
    surfaceHeightUs: time((i) => M._of_surface_height(body, 0, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])),
    biomeAtUs: time((i) => M._of_biome_at(body, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])),
    solidAtUs: time((i) => M._of_solid_at(body, 0, dirs[i * 3] * R, dirs[i * 3 + 1] * R, dirs[i * 3 + 2] * R)),
  };
}
