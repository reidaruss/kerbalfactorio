// =============================================================================
// of_power_api.inc — §14, THE ELECTRICAL GRID (power.h through automation.h).
//
// #included into of_core_api.cpp, exactly as the three vessel files are, so the
// scratch arena, the Registry template and `g_nets` above are all in scope. One
// translation unit is the contract.
//
// This is lane D's roadmap blocker D-1 closed: the model landed complete and
// green in /core and had NO WAY TO REACH THE GAME, because nothing in the
// client could call it. The list below is the one published in
// docs/controllers/factory-sim.md §5.1, honoured entry for entry.
//
// TWO THINGS THAT ARE EASY TO GET WRONG HERE, both called out by lane D.
//
//   1. WATTS FIT AN int32 AND ENERGY DOES NOT. One coal unit is 4,000,000,000
//      millijoules, which overflows a signed 32-bit integer by a factor of two.
//      So every watt figure below goes through `wattsI32` (which CLAMPS rather
//      than wrapping, because a wrapped watt reads as a negative generator) and
//      the one energy figure is its own `double`-returning call. There is no
//      millijoule anywhere in this file's int surface.
//
//   2. A NETWORK ID IS NOT A HANDLE. `power.h` re-derives the partition on every
//      topology change, so network 0 after a pole is pulled is a DIFFERENT
//      network from network 0 before it. `NetworkStats` therefore comes back BY
//      VALUE in /core and is copied into the scratch here; nothing on the JS
//      side may cache one across a placement.
//
// Everything reads off the LAST solve. `of_net_step` already pumps the grid
// (automation.h `step()` calls `pumpPower()` when the grid is on), so a panel
// never has to ask for a solve and can never ask for one at the wrong moment.
// =============================================================================

namespace {
// Clamp a 64-bit watt figure into the int32 the scratch carries. Clamping and
// not wrapping: a wrapped watt is a negative generator, which is a number a
// panel will happily draw and a player will never understand.
inline int32_t wattsI32(int64_t w) {
  if (w > 2147483647LL) return 2147483647;
  if (w < -2147483648LL) return -2147483648LL;
  return static_cast<int32_t>(w);
}
}  // namespace

// --- Turning the grid on -----------------------------------------------------
// A network that never calls this behaves exactly as it always did: every
// machine runs at full speed whatever its powerW says. Turning it on hands the
// satisfaction decision to the PowerGrid, and from that moment anything no pole
// reaches is pinned to ZERO, which is the honest answer and is the reason this
// is an explicit call rather than something the first pole implies.
OF_API void of_net_enable_grid(int nId, int on) {
  NetRec* r = g_nets.get(nId);
  if (r) r->net->enableGrid(on != 0);
}
OF_API int of_net_grid_enabled(int nId) {
  NetRec* r = g_nets.get(nId);
  return r && r->net->gridEnabled() ? 1 : 0;
}

// --- Poles: the distribution half -------------------------------------------
// `cls` is power::PoleClass in enum order: 0 small, 1 medium, 2 substation.
// Returns the PoleId, or -1. Positions are LOCAL metres about the plan anchor,
// the same frame of_net_set_placement uses, because the grid's reach is
// measured in millimetres of int64 and planet-scale absolutes would saturate it.
OF_API int of_net_place_pole(int nId, double x, double y, double z, int cls) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  const int c = cls < 0 ? 0 : (cls > 2 ? 2 : cls);
  return static_cast<int>(r->net->placePole(
      static_cast<float>(x), static_cast<float>(y), static_cast<float>(z),
      static_cast<au::PoleClass>(c)));
}

// 1 if the pole was alive and is now gone. Removing a BRIDGING pole splits one
// network into two, which is the behaviour worth having a panel for.
OF_API int of_net_remove_pole(int nId, int poleId) {
  NetRec* r = g_nets.get(nId);
  if (!r || poleId < 0) return 0;
  return r->net->removePole(static_cast<au::PoleId>(poleId)) ? 1 : 0;
}

OF_API int of_net_pole_count(int nId) {
  NetRec* r = g_nets.get(nId);
  return r ? static_cast<int>(r->net->grid().livePoleCount()) : 0;
}

// --- Generators: the supply half --------------------------------------------
// A burner generator makes watts by BURNING an item, and it burns in proportion
// to what it actually produces, so an idle base does not eat coal. Returns the
// generator's NodeId, or -1.
OF_API int of_net_place_burner_generator(int nId, double x, double y, double z,
                                         int fuelItem) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  return static_cast<int>(r->net->placeBurnerGenerator(
      static_cast<float>(x), static_cast<float>(y), static_cast<float>(z),
      static_cast<fs::ItemId>(fuelItem)));
}

// How many units were ACCEPTED (the generator has a bounded fuel slot, so this
// is not always `count`). The caller removes exactly this many from the pack.
OF_API int of_net_insert_fuel(int nId, int genId, int item, int count) {
  NetRec* r = g_nets.get(nId);
  if (!r || genId < 0 || count <= 0) return 0;
  return static_cast<int>(r->net->insertFuel(static_cast<au::GeneratorId>(genId),
                                             static_cast<fs::ItemId>(item),
                                             static_cast<uint16_t>(count)));
}

OF_API int of_net_generator_fuel(int nId, int genId) {
  NetRec* r = g_nets.get(nId);
  if (!r || genId < 0) return 0;
  return static_cast<int>(r->net->generatorFuel(static_cast<au::GeneratorId>(genId)));
}

// What this generator actually PUT OUT on the last solve. Zero for a generator
// that is out of fuel, and zero for one on a network with no demand, which are
// different situations the panel distinguishes with the fuel count above.
OF_API int of_net_generator_output_w(int nId, int genId) {
  NetRec* r = g_nets.get(nId);
  if (!r || genId < 0) return 0;
  return wattsI32(r->net->generatorOutputW(static_cast<au::GeneratorId>(genId)));
}

// What it COULD have put out: rated while fuelled, fading over the final
// partly-funded tick. `available - output` is the spare on this one machine.
OF_API int of_net_generator_available_w(int nId, int genId) {
  NetRec* r = g_nets.get(nId);
  if (!r || genId < 0) return 0;
  return wattsI32(r->net->grid().generatorAvailableW(
      static_cast<au::GeneratorId>(genId)));
}

// THE ONE FIGURE THAT IS NOT AN int32, and the reason lane D wrote the warning
// down: a single coal unit is 4e9 millijoules. Returned in JOULES as a double,
// which is exact for every energy this game can hold (2^53 J is 9 petajoules).
OF_API double of_net_generator_energy_j(int nId, int genId) {
  NetRec* r = g_nets.get(nId);
  if (!r || genId < 0) return 0.0;
  const uint64_t mj = r->net->grid().storedEnergyMilliJ(
      static_cast<au::GeneratorId>(genId));
  return static_cast<double>(mj) / 1000.0;
}

// --- Consumers ---------------------------------------------------------------
// Register an ALREADY-PLACED building as a grid consumer. A building that is
// never registered stays off-grid at full speed, which is right for a belt and
// wrong for a smelter, so `of_net_place_electric_smelter` below does both in
// one call rather than trusting a caller to remember the second.
OF_API void of_net_connect_to_grid(int nId, int build, double x, double y,
                                   double z, int ratedDrawW) {
  NetRec* r = g_nets.get(nId);
  au::BuildId* b = r ? r->build(build) : nullptr;
  if (!r || !b) return;
  r->net->connectToGrid(*b, static_cast<float>(x), static_cast<float>(y),
                        static_cast<float>(z), ratedDrawW);
}

// The third rung of the smelting ladder (FS-23): same ore-in ingot-out contract
// as of_net_place_smelter, but it burns WATTS instead of coal and is registered
// on the grid in the same call. Returns the build index, or -1.
OF_API int of_net_place_electric_smelter(int nId, int ore, int ingot,
                                         double x, double y, double z,
                                         int craftTicks, int powerW, int outCap) {
  NetRec* r = g_nets.get(nId);
  if (!r) return -1;
  r->builds.push_back(r->net->placeElectricSmelter(
      static_cast<fs::ItemId>(ore), static_cast<fs::ItemId>(ingot),
      static_cast<float>(x), static_cast<float>(y), static_cast<float>(z),
      static_cast<uint32_t>(craftTicks > 0 ? craftTicks : 30),
      powerW > 0 ? powerW : 30000, static_cast<uint16_t>(outCap)));
  return static_cast<int>(r->builds.size()) - 1;
}

// --- What the supply-and-demand panel reads ---------------------------------
OF_API int of_net_network_count(int nId) {
  NetRec* r = g_nets.get(nId);
  return r ? static_cast<int>(r->net->networkCount()) : 0;
}

// i32 scratch, TEN fields in NetworkStats' own declaration order:
//   [id, capacityW, productionW, demandW, consumptionW, satisfactionQ16,
//    poleCount, generatorCount, consumerCount, fuelledGeneratorCount]
// Returns 10, or 0 for a bad handle.
//
// capacityW VERSUS productionW is the pair that makes the panel worth having:
// capacity is what the fuelled generators COULD make and production is what was
// actually drawn, so a big gap means "you have spare generators" while
// demand > capacity means "you are short". A panel with only one of them can
// say that a base slowed down but never why.
//
// satisfactionQ16 is passed through UNROUNDED, so a probe can compare the
// client's number against /core's own integer rather than against a percentage
// that has been through a float and a `toFixed`.
OF_API int of_net_network_stats(int nId, int net) {
  resetI32(10);
  NetRec* r = g_nets.get(nId);
  if (!r || net < 0) return 0;
  const au::NetworkStats s = r->net->networkStats(static_cast<au::NetworkId>(net));
  g_i32.push_back(static_cast<int32_t>(s.id));
  g_i32.push_back(wattsI32(s.capacityW));
  g_i32.push_back(wattsI32(s.productionW));
  g_i32.push_back(wattsI32(s.demandW));
  g_i32.push_back(wattsI32(s.consumptionW));
  g_i32.push_back(static_cast<int32_t>(s.satisfactionQ16));
  g_i32.push_back(static_cast<int32_t>(s.poleCount));
  g_i32.push_back(static_cast<int32_t>(s.generatorCount));
  g_i32.push_back(static_cast<int32_t>(s.consumerCount));
  g_i32.push_back(static_cast<int32_t>(s.fuelledGeneratorCount));
  return 10;
}

// The ring buffer, oldest first, FOUR i32 per sample:
//   [tick, productionW, demandW, satisfactionQ16]
// Returns the SAMPLE count (not the element count), so a caller reads
// `count * 4` elements. The tick is truncated into an int32 deliberately: it is
// a graph's x axis and wraps after 414 days of continuous simulation.
OF_API int of_net_network_history(int nId, int net) {
  resetI32(4 * 64);
  NetRec* r = g_nets.get(nId);
  if (!r || net < 0) return 0;
  const std::vector<au::NetworkSample> h =
      r->net->networkHistory(static_cast<au::NetworkId>(net));
  for (const au::NetworkSample& s : h) {
    g_i32.push_back(static_cast<int32_t>(s.tick & 0x7FFFFFFFu));
    g_i32.push_back(wattsI32(s.productionW));
    g_i32.push_back(wattsI32(s.demandW));
    g_i32.push_back(static_cast<int32_t>(s.satisfactionQ16));
  }
  return static_cast<int>(h.size());
}

// The wires to DRAW. f32 scratch, SEVEN floats per segment:
//   [ax, ay, az, bx, by, bz, network]
// Returns the SEGMENT count. There are exactly (poles in network - 1) of them,
// never one per in-reach pair: 30 poles a metre apart is 182 in-reach pairs
// against 29 segments, and the naive rule is O(N^2) in exactly the layouts
// players build. A stretched instanced quad per segment is the whole job.
OF_API int of_net_wires(int nId) {
  resetF32(7 * 32);
  NetRec* r = g_nets.get(nId);
  if (!r) return 0;
  const std::vector<au::WireSegment>& w = r->net->wires();
  for (const au::WireSegment& s : w) {
    g_f32.push_back(s.ax); g_f32.push_back(s.ay); g_f32.push_back(s.az);
    g_f32.push_back(s.bx); g_f32.push_back(s.by); g_f32.push_back(s.bz);
    g_f32.push_back(static_cast<float>(s.network));
  }
  return static_cast<int>(w.size());
}

// Which network this building sits on. -1 means NO POLE REACHES IT, which is a
// different thing from "on a network with no generators" and is the answer a
// panel needs to say "these machines are running at zero because nothing is
// wired to them" rather than "you are short of power".
OF_API int of_net_build_network(int nId, int build) {
  NetRec* r = g_nets.get(nId);
  au::BuildId* b = r ? r->build(build) : nullptr;
  if (!r || !b) return -1;
  const au::NetworkId n = r->net->networkOfBuild(*b);
  return n == au::kNoNetwork ? -1 : static_cast<int>(n);
}

// This building's OWN satisfaction, Q16.16 (65536 == full speed). A machine
// that was never registered as a consumer reads 65536, because a 0 W machine is
// not short of anything; one that IS registered but off-grid reads 0.
OF_API int of_net_build_satisfaction(int nId, int build) {
  NetRec* r = g_nets.get(nId);
  au::BuildId* b = r ? r->build(build) : nullptr;
  if (!r || !b) return static_cast<int>(of::power::kQ16One);
  return static_cast<int>(r->net->satisfactionQ16Of(*b));
}
