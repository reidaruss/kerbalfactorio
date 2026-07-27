// THE ELECTRICAL GRID in the client: the typed face over `of_net_*`'s ABI 9
// additions (lane D's roadmap blocker D-1).
//
// `core/include/of/power.h` landed complete and green last night with no way to
// reach the game, because nothing in the browser could call it. Everything here
// is a read off /core's LAST SOLVE; nothing recomputes a watt.
//
// THE ONE NUMBER THAT MATTERS is `satisfactionQ16`, and it is carried through
// this file UNROUNDED. /core computes it as an exact Q16.16 integer (90 kW
// against 120 kW is 49152, not "0.75"), and a panel that displays a percentage
// derived from a float cannot be checked against the headless suite. So the
// integer travels intact and the percentage is derived from it at the last
// possible moment, in the panel.
//
// ENERGY IS NOT AN int32 and that is lane D's own warning: one coal unit is
// 4,000,000,000 millijoules. `generatorEnergyJ` is the only double-returning
// read here and it comes back in JOULES.
//
// A NETWORK ID IS NOT A HANDLE. power.h re-derives the partition on every
// topology change, so network 0 after a pole is pulled is a different network
// from network 0 before it. Nothing here caches a NetworkRow across a
// placement, and `networks()` is rebuilt per call for that reason.

import { scratchF32, scratchI32, type OfCoreModule } from '../sim/wasm/heap.js';

/** Q16.16 full satisfaction. `power.h` kQ16One, restated nowhere else. */
export const Q16_ONE = 65536;

/** power::PoleClass, in enum order. */
export const POLE_CLASS = { Small: 0, Medium: 1, Substation: 2 } as const;

export interface PowerSample {
  tick: number; productionW: number; demandW: number; satisfactionQ16: number;
}

export interface NetworkRow {
  id: number;
  /** What the fuelled generators COULD make. */
  capacityW: number;
  /** What they actually made this tick. */
  productionW: number;
  demandW: number;
  consumptionW: number;
  /** /core's own integer, unrounded. Divide by 65536 for a fraction. */
  satisfactionQ16: number;
  poles: number;
  generators: number;
  consumers: number;
  fuelledGenerators: number;
}

export interface WireRow {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  network: number;
}

export class Power {
  /** Poles and generators placed this session, so a report can prove a build. */
  polesPlaced = 0;
  generatorsPlaced = 0;
  fuelInserted = 0;

  /**
   * `netOf` is a PORT and not a number, and that is load-bearing rather than
   * fussy. `AutoLine.recreate()` destroys the whole BuildableNetwork and makes
   * a new one on every commit, so a handle captured in this constructor is
   * stale the first time the player lays a belt, and every read after that
   * would come back from a destroyed network as a plausible-looking zero. The
   * handle is therefore asked for on every call.
   */
  constructor(private readonly M: OfCoreModule,
              private readonly netOf: () => number) {}

  private get net(): number { return this.netOf(); }

  /**
   * Hand the satisfaction decision to the grid.
   *
   * Explicit rather than implied by the first pole, because turning it on pins
   * anything no pole reaches to ZERO. That is the honest answer, and it is also
   * a change to every existing machine in the world, so it is a decision the
   * caller makes once rather than a side effect of a placement.
   */
  enable(on = true): void { this.M._of_net_enable_grid(this.net, on ? 1 : 0); }
  get enabled(): boolean { return this.M._of_net_grid_enabled(this.net) === 1; }

  // --- distribution ---------------------------------------------------------
  /** Returns the PoleId, or -1. Positions are LOCAL metres about the anchor. */
  placePole(x: number, y: number, z: number,
            cls: number = POLE_CLASS.Small): number {
    const id = this.M._of_net_place_pole(this.net, x, y, z, cls);
    if (id >= 0) this.polesPlaced++;
    return id;
  }
  removePole(poleId: number): boolean {
    return this.M._of_net_remove_pole(this.net, poleId) === 1;
  }
  get poleCount(): number { return this.M._of_net_pole_count(this.net); }

  // --- supply ---------------------------------------------------------------
  placeGenerator(x: number, y: number, z: number, fuelItem: number): number {
    const id = this.M._of_net_place_burner_generator(this.net, x, y, z, fuelItem);
    if (id >= 0) this.generatorsPlaced++;
    return id;
  }
  /** Units ACCEPTED, which is not always `count`: the fuel slot is bounded, so
   *  the caller removes exactly this many from the pack and no more. */
  insertFuel(genId: number, item: number, count: number): number {
    const n = this.M._of_net_insert_fuel(this.net, genId, item, count);
    this.fuelInserted += n;
    return n;
  }
  generatorFuel(genId: number): number {
    return this.M._of_net_generator_fuel(this.net, genId);
  }
  /** What it actually PUT OUT on the last solve. */
  generatorOutputW(genId: number): number {
    return this.M._of_net_generator_output_w(this.net, genId);
  }
  /** What it COULD have. `available - output` is this machine's own spare. */
  generatorAvailableW(genId: number): number {
    return this.M._of_net_generator_available_w(this.net, genId);
  }
  /** Joules, as a double. Millijoules would overflow an int32 on one coal. */
  generatorEnergyJ(genId: number): number {
    return this.M._of_net_generator_energy_j(this.net, genId);
  }

  // --- consumers ------------------------------------------------------------
  connect(build: number, x: number, y: number, z: number, ratedDrawW: number): void {
    this.M._of_net_connect_to_grid(this.net, build, x, y, z, ratedDrawW);
  }
  /** The powered smelting rung: places AND registers in one call, so a caller
   *  cannot place one and forget to wire it, which would leave a 30 kW machine
   *  quietly running at full speed off a grid it never joined. */
  placeElectricSmelter(ore: number, ingot: number, x: number, y: number,
                       z: number, craftTicks = 30, powerW = 30000,
                       outCap = 0): number {
    return this.M._of_net_place_electric_smelter(this.net, ore, ingot, x, y, z,
      craftTicks, powerW, outCap);
  }

  // --- what the panel reads -------------------------------------------------
  get networkCount(): number { return this.M._of_net_network_count(this.net); }

  network(id: number): NetworkRow | null {
    if (this.M._of_net_network_stats(this.net, id) !== 10) return null;
    const p = scratchI32(this.M, 10);
    return {
      id: p[0], capacityW: p[1], productionW: p[2], demandW: p[3],
      consumptionW: p[4], satisfactionQ16: p[5], poles: p[6],
      generators: p[7], consumers: p[8], fuelledGenerators: p[9],
    };
  }

  networks(): NetworkRow[] {
    const out: NetworkRow[] = [];
    for (let i = 0; i < this.networkCount; ++i) {
      const r = this.network(i);
      if (r !== null) out.push(r);
    }
    return out;
  }

  /** Oldest first. What a sparkline draws. */
  history(id: number): PowerSample[] {
    const n = this.M._of_net_network_history(this.net, id);
    if (n <= 0) return [];
    const p = scratchI32(this.M, n * 4);
    const out: PowerSample[] = [];
    for (let k = 0; k < n; ++k) {
      out.push({
        tick: p[k * 4], productionW: p[k * 4 + 1],
        demandW: p[k * 4 + 2], satisfactionQ16: p[k * 4 + 3],
      });
    }
    return out;
  }

  /** Exactly (poles in network - 1) per network, never one per in-reach pair. */
  wires(): WireRow[] {
    const n = this.M._of_net_wires(this.net);
    if (n <= 0) return [];
    const p = scratchF32(this.M, n * 7);
    const out: WireRow[] = [];
    for (let k = 0; k < n; ++k) {
      out.push({
        ax: p[k * 7], ay: p[k * 7 + 1], az: p[k * 7 + 2],
        bx: p[k * 7 + 3], by: p[k * 7 + 4], bz: p[k * 7 + 5],
        network: p[k * 7 + 6],
      });
    }
    return out;
  }

  /** -1 means NO POLE REACHES IT, which is a different thing from being on a
   *  network with no generators, and the panel says so differently. */
  networkOf(build: number): number {
    return this.M._of_net_build_network(this.net, build);
  }
  /** Q16.16. Never-registered reads 65536 (a 0 W machine is short of nothing);
   *  registered but off-grid reads 0. */
  satisfactionQ16Of(build: number): number {
    return this.M._of_net_build_satisfaction(this.net, build);
  }

  report(): unknown {
    const nets = this.networks();
    return {
      enabled: this.enabled,
      networks: nets.length,
      poles: this.poleCount,
      polesPlaced: this.polesPlaced,
      generatorsPlaced: this.generatorsPlaced,
      fuelInserted: this.fuelInserted,
      wires: this.wires().length,
      // The Q16 integers, verbatim, so a probe compares against /core's own
      // arithmetic rather than against a percentage that has been through a
      // float and a toFixed.
      satisfactionQ16: nets.map((n) => n.satisfactionQ16),
      demandW: nets.map((n) => n.demandW),
      productionW: nets.map((n) => n.productionW),
      capacityW: nets.map((n) => n.capacityW),
      consumersOnNet: nets[0]?.consumers ?? 0,
      fuelledGenerators: nets.map((n) => n.fuelledGenerators),
    };
  }
}

/** Watts as a player reads them. One place, so the panel and the HUD agree. */
export function formatWatts(w: number): string {
  const a = Math.abs(w);
  if (a >= 1e6) return `${(w / 1e6).toFixed(2)} MW`;
  if (a >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}
