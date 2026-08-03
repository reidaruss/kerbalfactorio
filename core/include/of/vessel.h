#pragma once
// =============================================================================
// of::vessel - the part and vessel data model (DW-29).
//
// A vessel is a TREE of parts, not a list. Stack attachment (the 1.25 m mating
// planes the art lane already ships) and radial attachment give it its shape,
// and an ordered list of STAGES says what ignites and what is thrown away, in
// what order. Firing a stage severs the tree and hands back the discarded
// subtree as a vessel in its own right, which is why the tree has to be a tree:
// "everything below the decoupler" is a subtree and is not expressible as a
// span of a flat array once radial boosters exist.
//
// What lives here:
//   §1  ids, enums, and the propellant kinds
//   §2  PartDef - one row of the authored part catalogue
//   §3  the catalogue itself, as DATA, exactly the way gameplay.h §A.2 authors
//       recipes: a curated array in a registry object, no file format, no
//       parser, and therefore nothing that can be out of sync at runtime
//   §4  PartInstance and Vessel - the tree
//   §5  mass properties: total/dry/wet, per stage, centre of mass, centre of
//       pressure, moment of inertia
//   §6  staging: fireStage() splits the tree and conserves mass
//   §7  derived performance: Tsiolkovsky delta-v per stage, TWR, burn time
//
// What does NOT live here: gravity (BodyParams::muM3S2 is the one authority,
// DW-18), air (atmosphere.h), integration (flight.h), and orbits (orbital.h).
//
// Geometry convention, taken verbatim from the shipped art contract
// (docs/web/ASSET-SPECS.md §3.3, "The stack contract") so that no runtime
// translation table exists anywhere:
//   * +Y is the stack axis and points at the nose. A vessel assembles up the
//     world up axis and stands on a pad with no rotation.
//   * a stack part's ORIGIN is its bottom mating plane, centred on the axis.
//     socket_stack_bottom is local (0,0,0); socket_stack_top is local (0,H,0).
//   * to stack B on A: B.position = A.position + A.socket_stack_top.position.
//     There is no per-part offset table, here or in the renderer.
//   * a radial part's origin is on its own mount plane and its body extends +X;
//     it attaches at (R cos a, y, R sin a) rotated by -a.
//   * an engine has no bottom node and a nose cone has no top node: they
//     terminate a stack.
//
// Header-only, double precision, no engine deps.
// =============================================================================
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "of/atmosphere.h"
#include "of/vec3.h"

namespace of {
namespace vessel {

// =============================================================================
// §1 - ids, enums, propellants.
// =============================================================================

// PartId is its own opaque, hand-assigned, stable, append-only id space, the
// same discipline gameplay.h uses for ItemId. It starts at 0x0100 so a part id
// and an ItemId can never be confused if they end up in the same debug print.
//
// NOTE for gameplay: the ITEM form of a part (what sits in the pack, what a
// recipe costs) is an ItemId and belongs to gameplay.h's pinned table, not
// here. This file has no opinion about what a part costs to build.
using PartId = uint16_t;
static constexpr PartId kNoPart = 0;

namespace parts {
// --- Tier 1 (DW-29), class S: the 1.25 m stack a first rocket is built on. ---
static constexpr PartId CommandPod          = 0x0100;
static constexpr PartId TankLiquidSmall     = 0x0101;  // 1.25 x 2.00
static constexpr PartId TankLiquidSmallLong = 0x0102;  // 1.25 x 4.00
static constexpr PartId EngineLiquidSmall   = 0x0103;  // 1.25 m, sea-level bell
static constexpr PartId EngineVacuumSmall   = 0x0104;  // 1.25 m, vacuum bell
static constexpr PartId SolidBooster        = 0x0105;  // no throttle, no restart
static constexpr PartId DecouplerStackSmall = 0x0106;
static constexpr PartId DecouplerRadial     = 0x0107;
static constexpr PartId NoseCone            = 0x0108;
static constexpr PartId LandingLeg          = 0x0109;
static constexpr PartId Parachute           = 0x010A;
static constexpr PartId Fin                 = 0x010B;
static constexpr PartId CargoBay            = 0x010C;
// GP-267. The autopilot. Allocated out of the 0x010D..0x010F gap this block has
// always held, so no id moves and no ItemId moves: `of_vessel_api.inc` maps
// ItemId = 0x0050 + (PartId - 0x0100), which puts this at 0x005D, inside the
// reserved 0x0050..0x006A block. It sits with Tier 1 by ID and is NOT Tier 1 by
// availability: `research.h`'s `techs::FlightAutopilot` unlocks it, which is the
// item that tech was written for and never had (see its own comment there).
static constexpr PartId AutopilotModule     = 0x010D;
// --- Tier 2 (DW-29): control, power, docking. --------------------------------
static constexpr PartId RcsBlock            = 0x0110;
static constexpr PartId TankMonoprop        = 0x0111;
static constexpr PartId ReactionWheel       = 0x0112;
static constexpr PartId Battery             = 0x0113;
static constexpr PartId SolarPanel          = 0x0114;
static constexpr PartId DockingPort         = 0x0115;
static constexpr PartId EngineVernier       = 0x0116;  // radial, fine control
// --- Class L: the 2.50 m stack, exactly twice class S across. ----------------
// DW-29 asks for "liquid tanks and engines in two sizes" and this is what the
// art lane built to answer it: two DIAMETER classes with an adapter between
// them, rather than two performance tiers on one diameter. Their reading is the
// better one and it is the one with meshes, so it is the one authored here.
static constexpr PartId TankLiquidLarge     = 0x0117;  // 2.50 x 4.00
static constexpr PartId EngineLiquidLarge   = 0x0118;  // 2.50 x 2.60
static constexpr PartId DecouplerStackLarge = 0x0119;
static constexpr PartId StackAdapter        = 0x011A;  // L below, S above
}  // namespace parts

// The two stack diameters. Every stack part is exactly one of these, and the
// only part with a different class at each end is StackAdapter.
static constexpr double kStackDiameterS = 1.25;
static constexpr double kStackDiameterL = 2.50;

enum class PartClass : uint8_t {
  Pod = 0, Tank, Engine, Decoupler, Aero, Structural,
  Control, Power, Docking, Utility,
};

// The propellant kinds. A part holds AT MOST ONE, which is a deliberate
// simplification: KSP's separate LiquidFuel/Oxidiser pair adds a second number
// to every tank and changes no decision the player makes, so liquid propellant
// here is one mass of "the stuff a liquid engine burns".
enum class Propellant : uint8_t {
  None = 0,
  LiquidFuel,       // burnable by liquid engines, transferable, crossfeed-able
  SolidFuel,        // locked inside its booster; cannot be transferred or fed
  Monopropellant,   // RCS only. Inert mass to a liquid-engine delta-v sum.
  ElectricCharge,   // not a mass; capacity is in charge units, mass is dry
};

// How a part attaches to its PARENT.
enum class Attach : uint8_t {
  Root = 0,      // the part has no parent
  StackTop,      // this part sits ON TOP of the parent (parent's top node)
  StackBottom,   // this part hangs BELOW the parent (parent's bottom node)
  Radial,        // this part clings to the parent's side
};

// WHAT A RADIAL PART'S ORIGIN MEANS. PH-81.
//
// Two conventions are in the shipped art and both are correct for the part that
// uses them, so this is DECLARED per part rather than inferred:
//
//   MountPlane  the origin is the part's INBOARD mount face and the body
//               extends outward from it. ASSET-SPECS §3.3 publishes
//               `socket_radial_mount` at local (0,0,0) for exactly these.
//               A fin, a solar panel, an RCS block, a landing leg, a vernier
//               and the radial decoupler are all authored this way.
//
//   Axis        the origin is the part's OWN AXIS, because the same mesh must
//               also serve stack mounting, where the origin is the bottom
//               mating plane ON the axis. ASSET-SPECS §3.3 publishes
//               `socket_radial_attach` at (-R, h/2, 0) for these: a point on
//               the part's own hull, facing inboard. The Solid Booster is the
//               shipped example and the reason this enum exists.
//
// DO NOT DERIVE THIS FROM THE MESH, THE PART CLASS, OR WHETHER THE PART ALSO
// STACKS. The Solid Booster is a stack part, an engine, and a radial part all
// at once; every derivation anybody tried got one of the six radial parts
// wrong. It is a declaration because a declaration is a question the compiler
// can force somebody to answer (see PartDef's constructor), and a derivation
// rots the first time an asset breaks the pattern.
//
// The defect this closes, measured: a Solid Booster strapped to a 1.25 m core
// had its axis at r = 0.775 m with its own radius 0.625 m, so its inboard face
// sat 0.15 m INSIDE a 0.625 m hull. 0.475 m of interpenetrating cylinders,
// visible in the assembly bay (docs/screenshots/GP150_radial_sink.png).
enum class RadialOrigin : uint8_t {
  MountPlane = 0,
  Axis,
};

using PartHandle = uint32_t;
static constexpr PartHandle kNoHandle = 0xFFFFFFFFu;

// A part that is never decoupled belongs to the final stage and rides all the
// way to the end of the mission.
static constexpr int kNeverDecoupled = 0x7FFFFFFF;

// =============================================================================
// §2 - PartDef: one authored row.
//
// Everything DW-29 asks a part to carry, plus the two aerodynamic areas the
// anti-flip model needs (see the comment on dragAreaNormalM2 - one Cd and one
// reference area genuinely cannot express a rocket, and that is not a detail).
// =============================================================================
struct PartDef {
  // THE ONE REQUIRED FIELD, and it is required by being the only constructor
  // parameter. There is no default constructor and `radialOrigin` has no
  // in-class initialiser, so `PartDef d;` DOES NOT COMPILE and every authored
  // row in §3 has to state which convention its mesh uses. That is the point:
  // a defaulted field would have let the Solid Booster keep the wrong answer
  // silently, which is exactly what happened for the whole life of §3 so far.
  explicit PartDef(RadialOrigin ro) : radialOrigin(ro) {}
  PartDef() = delete;

  /** Does this part's origin mean its inboard mount plane, or its own axis?
   *  Read ONLY when the part is attached with Attach::Radial; a part that
   *  never straps on still has to declare it, because the day it grows a
   *  radial mount is the day nobody remembers to come back here. */
  RadialOrigin radialOrigin;

  PartId id = kNoPart;
  const char* name = "";        // display name
  const char* asset = "";       // the glb node name, EXACTLY (ASSET-SPECS §3.3)
  PartClass cls = PartClass::Structural;

  // --- geometry (metres; the art contract's numbers, not invented here) ------
  double diameterM = 1.25;      // 1.25 on every stack part
  double heightM = 1.0;         // bottom mating plane to top mating plane
  bool nodeTop = false;         // publishes socket_stack_top
  bool nodeBottom = false;      // publishes socket_stack_bottom
  bool radialMount = false;     // publishes socket_radial_mount

  // --- mass and tankage -----------------------------------------------------
  double dryMassKg = 0.0;
  Propellant propellant = Propellant::None;
  double propellantCapacityKg = 0.0;   // mass units, except ElectricCharge
  double electricCapacity = 0.0;       // charge units (not mass)
  double electricRatePerS = 0.0;       // solar panel output, charge/s

  // --- propulsion (0 for a part that is not an engine) ----------------------
  double thrustSeaLevelN = 0.0;
  double thrustVacuumN = 0.0;
  double ispSeaLevelS = 0.0;
  double ispVacuumS = 0.0;
  Propellant consumes = Propellant::None;
  bool throttleable = false;    // a solid booster is not
  bool restartable = false;     // a solid booster is not
  double minThrottle = 0.0;     // fraction, 0 = can idle down to nothing
  double gimbalRangeRad = 0.0;  // DW-30 item 3: generous

  // --- reaction control -----------------------------------------------------
  double reactionTorqueNm = 0.0;  // pod / reaction wheel, free of propellant
  double rcsThrustN = 0.0;        // total across the block's nozzles
  double rcsIspS = 0.0;

  // --- crew -----------------------------------------------------------------
  uint8_t crewCapacity = 0;

  // --- aerodynamics ---------------------------------------------------------
  // TWO axes, and this is load-bearing rather than fussy. A rocket flying
  // nose-on presents a 1.23 m^2 disc; the same rocket broadside presents 12 m^2
  // of flank. Collapsing that to one "drag coefficient and reference area"
  // makes the pitching moment unrepresentable, and the pitching moment IS the
  // flip that DW-30 exists to damp. It is also what makes a fin do anything: a
  // fin is almost pure normal area at almost no axial area.
  double dragCdAxial = 0.0;      // nose-on
  double dragAreaAxialM2 = 0.0;  // frontal reference area
  double dragCdNormal = 0.0;     // broadside
  double dragAreaNormalM2 = 0.0; // side-profile reference area

  // The part's share of the vehicle's normal-force slope, dCn/d(alpha), in m^2
  // (already multiplied through by a reference area, so the sum over parts is
  // the vehicle's). This is a SEPARATE number from the broadside drag area and
  // it has to be, which is the least obvious thing in this file:
  //
  //   Broadside area answers "how hard does the air push a vehicle that is
  //   flying sideways". Normal-force slope answers "where does the pushing
  //   START when it is barely off axis", and those are not the same
  //   distribution. Barrowman's result, which model rocketry has used since
  //   1967 and which every flight-sim aero model reduces to: a constant-
  //   diameter body tube contributes almost NOTHING to normal force at small
  //   angle of attack, essentially all of the body's contribution comes from
  //   the nose, and a fin contributes in proportion to its planform.
  //
  //   Weighting the centre of pressure by broadside area instead was tried
  //   first and it is wrong in a way that matters: a 12 m tube of 16 m^2 of
  //   flank drowns out 3.7 m^2 of fin, so four fins moved the CoP by 0.87 m and
  //   left the reference rocket statically UNSTABLE. With the correct
  //   coefficient the same four fins move it 4.12 m and the margin flips sign,
  //   which is what a fin is for and what a player expects to be able to fix.
  //
  //   Values: a nose (cone or capsule) gets 2 x its own frontal area, which is
  //   Barrowman's Cn_alpha = 2 for ANY nose shape; a body tube gets 0.15 x its
  //   side profile, a deliberately small residual so that a very long stack
  //   still has some body contribution; an aerodynamic surface gets 2.5 x its
  //   planform.
  double normalForceSlopeM2 = 0.0;

  // --- part-specific --------------------------------------------------------
  double chuteDragAreaM2 = 0.0;   // parachute, fully deployed
  double legReachM = 0.0;         // landing leg, foot drop below its mount
  double dockCaptureRadiusM = 0.0;// DW-30 item 5: a WIDE magnetic capture cone
  double dockCaptureConeRad = 0.0;

  bool isEngine() const { return thrustVacuumN > 0.0; }
  bool isTank() const { return propellantCapacityKg > 0.0; }
  bool isDecoupler() const { return cls == PartClass::Decoupler; }
};

// =============================================================================
// §3 - the catalogue, authored as DATA.
//
// Sourcing of the numbers, so a later reader can tell what is measured, what is
// copied from the art contract, and what is a game-balance choice:
//   * every dimension is READ OFF docs/web/ASSET-SPECS.md §3.3, which is what
//     tools/blender actually built. Nothing here invents a size.
//   * masses and Isp are game balance, chosen KSP-adjacent so that a two-stage
//     1.25 m rocket reaches a 60 km orbit on Forge with margin. They are stated
//     in the physics controller file and pinned by test_vessel.cpp.
//   * every engine is authored so that thrustSL/IspSL == thrustVac/IspVac
//     EXACTLY, which makes mass flow altitude-invariant (atmosphere.h §3). The
//     catalogue test asserts it, so a typo in one of the four numbers is caught
//     at build time rather than as a burn time that drifts with altitude.
// =============================================================================
class PartCatalogue {
 public:
  PartCatalogue() { build(); }

  const PartDef* get(PartId id) const {
    for (const PartDef& d : defs_)
      if (d.id == id) return &d;
    return nullptr;
  }
  const std::vector<PartDef>& all() const { return defs_; }
  size_t size() const { return defs_.size(); }

 private:
  std::vector<PartDef> defs_;

  // Frontal area of a cylinder of diameter d.
  static double discArea(double d) { return 3.14159265358979323846 * d * d * 0.25; }

  // The three normal-force-slope rules (see PartDef::normalForceSlopeM2).
  static double noseCn(double d) { return 2.0 * discArea(d); }
  static double tubeCn(double d, double L) { return 0.15 * d * L; }
  static double surfaceCn(double planformM2) { return 2.5 * planformM2; }

  void build() {
    defs_.clear();

    // ---- Tier 1 -----------------------------------------------------------
    {  // Command pod. Crew 1, carries the vessel's baseline reaction torque and
       // 40 kg of monopropellant, which is INERT to a liquid-engine delta-v sum.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::CommandPod; d.name = "Command Pod Mk1"; d.asset = "CommandPod";
      d.cls = PartClass::Pod;
      d.diameterM = 1.25; d.heightM = 2.50; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 800.0;
      d.propellant = Propellant::Monopropellant; d.propellantCapacityKg = 40.0;
      d.electricCapacity = 100.0;
      d.reactionTorqueNm = 5000.0;   // DW-30 item 3: generous, on the pod itself
      d.crewCapacity = 1;
      d.dragCdAxial = 0.55; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 2.50;
      d.normalForceSlopeM2 = noseCn(1.25);
      defs_.push_back(d);
    }
    {  // Small liquid tank. 1.25 x 2.00 m = 2.454 m^3 -> 2150 kg at ~876 kg/m^3,
       // a realistic bulk propellant density, and a 10:1 wet/dry ratio.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::TankLiquidSmall; d.name = "Fuel Tank (small)"; d.asset = "LiquidTankSmall";
      d.cls = PartClass::Tank;
      d.diameterM = 1.25; d.heightM = 2.00; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 215.0;
      d.propellant = Propellant::LiquidFuel; d.propellantCapacityKg = 2150.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 2.00;
      d.normalForceSlopeM2 = tubeCn(1.25, 2.00);
      defs_.push_back(d);
    }
    {  // Large liquid tank: exactly twice the small one, same 1.25 m diameter.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::TankLiquidSmallLong; d.name = "Fuel Tank (large)"; d.asset = "LiquidTankSmallLong";
      d.cls = PartClass::Tank;
      d.diameterM = 1.25; d.heightM = 4.00; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 430.0;
      d.propellant = Propellant::LiquidFuel; d.propellantCapacityKg = 4300.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 4.00;
      d.normalForceSlopeM2 = tubeCn(1.25, 4.00);
      defs_.push_back(d);
    }
    {  // Main engine: sea-level bell, the one that gets you off the pad.
       // 160/264 == 200/330 == 20/33 exactly -> mdot 61.8010 kg/s at any altitude.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::EngineLiquidSmall; d.name = "Main Engine"; d.asset = "LiquidEngineSmall";
      d.cls = PartClass::Engine;
      d.diameterM = 1.25; d.heightM = 1.60; d.nodeTop = true; d.nodeBottom = false;
      d.dryMassKg = 1200.0;
      d.thrustSeaLevelN = 160000.0; d.thrustVacuumN = 200000.0;
      d.ispSeaLevelS = 264.0; d.ispVacuumS = 330.0;
      d.consumes = Propellant::LiquidFuel;
      d.throttleable = true; d.restartable = true; d.minThrottle = 0.0;
      d.gimbalRangeRad = 5.0 * 3.14159265358979323846 / 180.0;  // 5 deg
      d.dragCdAxial = 0.45; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.00; d.dragAreaNormalM2 = 1.25 * 1.60;
      d.normalForceSlopeM2 = tubeCn(1.25, 1.60);
      defs_.push_back(d);
    }
    {  // Small engine: vacuum bell, the one that circularises.
       // 30/180 == 60/360 == 0.166666...  -> mdot 16.9953 kg/s at any altitude.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::EngineVacuumSmall; d.name = "Vacuum Engine"; d.asset = "LiquidEngineVacuumSmall";
      d.cls = PartClass::Engine;
      d.diameterM = 1.25; d.heightM = 1.00; d.nodeTop = true; d.nodeBottom = false;
      d.dryMassKg = 400.0;
      d.thrustSeaLevelN = 30000.0; d.thrustVacuumN = 60000.0;
      d.ispSeaLevelS = 180.0; d.ispVacuumS = 360.0;
      d.consumes = Propellant::LiquidFuel;
      d.throttleable = true; d.restartable = true; d.minThrottle = 0.0;
      d.gimbalRangeRad = 5.0 * 3.14159265358979323846 / 180.0;
      d.dragCdAxial = 0.45; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.00; d.dragAreaNormalM2 = 1.25 * 1.00;
      d.normalForceSlopeM2 = tubeCn(1.25, 1.00);
      defs_.push_back(d);
    }
    {  // Solid booster. DW-29 is explicit: no throttle, no restart. It is also
       // its own tank, and its SolidFuel can never be transferred out, which is
       // what makes "light it and live with it" a real decision.
       // 250/190 == 280/212.8 -> mdot 134.1 kg/s.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::SolidBooster; d.name = "Solid Booster"; d.asset = "SolidBooster";
      d.cls = PartClass::Engine;
      d.diameterM = kStackDiameterS; d.heightM = 6.00;
      d.nodeTop = true; d.nodeBottom = false;   // terminates a stack downward
      d.radialMount = true;                     // and straps on the side
      d.dryMassKg = 1300.0;
      d.propellant = Propellant::SolidFuel; d.propellantCapacityKg = 9000.0;
      // 600/190 == 672/212.8 == 60/19 exactly -> mdot 321.99 kg/s, 27.95 s of
      // burn. Big thrust for a short time is what a solid is FOR.
      d.thrustSeaLevelN = 600000.0; d.thrustVacuumN = 672000.0;
      d.ispSeaLevelS = 190.0; d.ispVacuumS = 212.8;
      d.consumes = Propellant::SolidFuel;
      d.throttleable = false; d.restartable = false; d.minThrottle = 1.0;
      d.gimbalRangeRad = 0.0;
      d.dragCdAxial = 0.40; d.dragAreaAxialM2 = discArea(kStackDiameterS);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = kStackDiameterS * 6.00;
      d.normalForceSlopeM2 =
          noseCn(kStackDiameterS) + tubeCn(kStackDiameterS, 6.00);
      defs_.push_back(d);
    }
    {  // Stack decoupler. Severs its link to its PARENT (§6).
      PartDef d(RadialOrigin::Axis);
      d.id = parts::DecouplerStackSmall; d.name = "Stack Decoupler"; d.asset = "StackDecouplerSmall";
      d.cls = PartClass::Decoupler;
      d.diameterM = 1.25; d.heightM = 0.25; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 50.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 0.25;
      d.normalForceSlopeM2 = tubeCn(1.25, 0.25);
      defs_.push_back(d);
    }
    {  // Radial decoupler: what a strap-on booster hangs from.
      PartDef d(RadialOrigin::MountPlane);
      d.id = parts::DecouplerRadial; d.name = "Radial Decoupler"; d.asset = "DecouplerRadial";
      d.cls = PartClass::Decoupler;
      d.diameterM = 0.30; d.heightM = 0.40; d.radialMount = true;
      d.dryMassKg = 25.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = 0.09;
      d.dragCdNormal = 0.80; d.dragAreaNormalM2 = 0.12;
      d.normalForceSlopeM2 = 0.05;
      defs_.push_back(d);
    }
    {  // Nose cone: terminates a stack upward, and its whole point is a LOW
       // axial Cd. It also sits at the very front, so it drags the centre of
       // pressure forward: nose cones make a rocket prettier and less stable,
       // which is exactly the trade a player should be able to feel.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::NoseCone; d.name = "Nose Cone"; d.asset = "NoseCone";
      d.cls = PartClass::Aero;
      d.diameterM = 1.25; d.heightM = 1.20; d.nodeTop = false; d.nodeBottom = true;
      d.dryMassKg = 30.0;
      d.dragCdAxial = 0.12; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 0.90; d.dragAreaNormalM2 = 1.25 * 1.20 * 0.5;  // a cone
      d.normalForceSlopeM2 = noseCn(1.25);
      defs_.push_back(d);
    }
    {  // Landing leg. 2.13 m of drop is the art lane's measured reach, sized so
       // the feet touch before a 1.60 m engine bell does (ASSET-SPECS §3.3).
      PartDef d(RadialOrigin::MountPlane);
      d.id = parts::LandingLeg; d.name = "Landing Leg"; d.asset = "LandingLeg";
      d.cls = PartClass::Utility;
      d.diameterM = 0.48; d.heightM = 0.42; d.radialMount = true;
      d.dryMassKg = 50.0; d.legReachM = 2.13;
      d.dragCdAxial = 0.40; d.dragAreaAxialM2 = 0.07;
      d.dragCdNormal = 0.80; d.dragAreaNormalM2 = 0.18;
      d.normalForceSlopeM2 = 0.09;
      defs_.push_back(d);
    }
    {  // Parachute.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::Parachute; d.name = "Parachute"; d.asset = "Parachute";
      d.cls = PartClass::Utility;
      d.diameterM = 1.25; d.heightM = 0.75; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 100.0; d.chuteDragAreaM2 = 50.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 0.75;
      d.normalForceSlopeM2 = tubeCn(1.25, 0.75);
      defs_.push_back(d);
    }
    {  // Fin. Almost no axial area, a lot of normal area, and it goes at the
       // BOTTOM: that combination is the whole of static stability.
      PartDef d(RadialOrigin::MountPlane);
      d.id = parts::Fin; d.name = "Aero Fin"; d.asset = "Fin";
      d.cls = PartClass::Aero;
      d.diameterM = 0.10; d.heightM = 1.10; d.radialMount = true;
      d.dryMassKg = 40.0;
      d.dragCdAxial = 0.05; d.dragAreaAxialM2 = 0.10 * 1.10;
      d.dragCdNormal = 1.30; d.dragAreaNormalM2 = 0.85 * 1.10;  // planform
      d.normalForceSlopeM2 = surfaceCn(0.85 * 1.10);
      defs_.push_back(d);
    }
    {  // Cargo bay.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::CargoBay; d.name = "Cargo Bay"; d.asset = "CargoBay";
      d.cls = PartClass::Structural;
      d.diameterM = 1.25; d.heightM = 1.60; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 150.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 1.60;
      d.normalForceSlopeM2 = tubeCn(1.25, 1.60);
      defs_.push_back(d);
    }

    {  // GP-267. THE AUTOPILOT MODULE. A guidance can, and it is deliberately
       // a stack part on the class-S diameter rather than a radial box: a
       // player has to make ROOM for it, which is the cost that makes fitting
       // one a decision. It carries a little reaction torque because a thing
       // that flies the vehicle with no authority of its own would be a lie
       // about what it does; `flight.h` sums `reactionTorqueNm` over all parts
       // with no flag, so this needs no new mechanism. It is a tenth of a
       // reaction wheel's, so it is a hint and never a substitute.
       //
       // NO NEW FIELD, and that is the whole reason this row costs no ABI bump:
       // "this part is an autopilot" is its PartId, which the gameplay lane
       // already has to know in order to gate its own screens on.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::AutopilotModule; d.name = "Autopilot Module";
      d.asset = "AutopilotModule";
      d.cls = PartClass::Control;
      d.diameterM = kStackDiameterS; d.heightM = 0.30;
      d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 45.0;
      d.reactionTorqueNm = 1500.0;
      d.electricCapacity = 50.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(kStackDiameterS);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = kStackDiameterS * 0.30;
      d.normalForceSlopeM2 = tubeCn(kStackDiameterS, 0.30);
      defs_.push_back(d);
    }

    // ---- Tier 2 -----------------------------------------------------------
    {  // RCS block: four nozzles, monopropellant, the vacuum authority that
       // makes stability assist cost something (DW-30 item 2).
      PartDef d(RadialOrigin::MountPlane);
      d.id = parts::RcsBlock; d.name = "RCS Block"; d.asset = "RcsBlock";
      d.cls = PartClass::Control;
      d.diameterM = 0.50; d.heightM = 0.50; d.radialMount = true;
      d.dryMassKg = 20.0;
      d.rcsThrustN = 1000.0; d.rcsIspS = 240.0;
      d.consumes = Propellant::Monopropellant;
      d.dragCdAxial = 0.60; d.dragAreaAxialM2 = 0.12;
      d.dragCdNormal = 0.90; d.dragAreaNormalM2 = 0.25;
      d.normalForceSlopeM2 = 0.125;
      defs_.push_back(d);
    }
    {  // Monopropellant tank.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::TankMonoprop; d.name = "Monopropellant Tank"; d.asset = "MonopropTank";
      d.cls = PartClass::Tank;
      d.diameterM = 1.25; d.heightM = 1.00; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 40.0;
      d.propellant = Propellant::Monopropellant; d.propellantCapacityKg = 200.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 1.00;
      d.normalForceSlopeM2 = tubeCn(1.25, 1.00);
      defs_.push_back(d);
    }
    {  // Reaction wheel: torque with no propellant, paid for in electricity.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::ReactionWheel; d.name = "Reaction Wheel"; d.asset = "ReactionWheel";
      d.cls = PartClass::Control;
      d.diameterM = 1.25; d.heightM = 0.40; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 50.0;
      d.reactionTorqueNm = 15000.0;   // DW-30 item 3
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 0.40;
      d.normalForceSlopeM2 = tubeCn(1.25, 0.40);
      defs_.push_back(d);
    }
    {  // Battery.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::Battery; d.name = "Battery"; d.asset = "Battery";
      d.cls = PartClass::Power;
      d.diameterM = 1.25; d.heightM = 0.60; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 20.0;
      d.propellant = Propellant::ElectricCharge; d.electricCapacity = 1000.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 0.60;
      d.normalForceSlopeM2 = tubeCn(1.25, 0.60);
      defs_.push_back(d);
    }
    {  // Solar panel. Deploys (Solar_Deploy clip already ships).
      PartDef d(RadialOrigin::MountPlane);
      d.id = parts::SolarPanel; d.name = "Solar Panel"; d.asset = "SolarPanel";
      d.cls = PartClass::Power;
      d.diameterM = 0.44; d.heightM = 0.30; d.radialMount = true;
      d.dryMassKg = 20.0; d.electricRatePerS = 2.0;
      d.dragCdAxial = 0.60; d.dragAreaAxialM2 = 0.06;
      d.dragCdNormal = 1.20; d.dragAreaNormalM2 = 0.70;
      d.normalForceSlopeM2 = 0.35;
      defs_.push_back(d);
    }
    {  // Docking port. DW-30 item 5: the capture cone is WIDE on purpose. The
       // numbers are carried as data here; the docking LOGIC is not built.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::DockingPort; d.name = "Docking Port"; d.asset = "DockingPort";
      d.cls = PartClass::Docking;
      d.diameterM = 1.25; d.heightM = 0.30; d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 50.0;
      d.dockCaptureRadiusM = 0.60;
      d.dockCaptureConeRad = 30.0 * 3.14159265358979323846 / 180.0;  // 30 deg
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(1.25);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = 1.25 * 0.30;
      d.normalForceSlopeM2 = tubeCn(1.25, 0.30);
      defs_.push_back(d);
    }
    // ---- Class L: 2.50 m across, exactly twice class S. -------------------
    {  // Large liquid tank: four times the cross-section, so four times the
       // propellant of the 4 m class-S tank at the same length.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::TankLiquidLarge; d.name = "Fuel Tank (large)"; d.asset = "LiquidTankLarge";
      d.cls = PartClass::Tank;
      d.diameterM = kStackDiameterL; d.heightM = 4.00;
      d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 1720.0;
      d.propellant = Propellant::LiquidFuel; d.propellantCapacityKg = 17200.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(kStackDiameterL);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = kStackDiameterL * 4.00;
      d.normalForceSlopeM2 = tubeCn(kStackDiameterL, 4.00);
      defs_.push_back(d);
    }
    {  // Large main engine. 640/264 == 800/330 == 80/33 -> mdot 247.20 kg/s.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::EngineLiquidLarge; d.name = "Main Engine (large)"; d.asset = "LiquidEngineLarge";
      d.cls = PartClass::Engine;
      d.diameterM = kStackDiameterL; d.heightM = 2.60;
      d.nodeTop = true; d.nodeBottom = false;
      d.dryMassKg = 4800.0;
      d.thrustSeaLevelN = 640000.0; d.thrustVacuumN = 800000.0;
      d.ispSeaLevelS = 264.0; d.ispVacuumS = 330.0;
      d.consumes = Propellant::LiquidFuel;
      d.throttleable = true; d.restartable = true; d.minThrottle = 0.0;
      d.gimbalRangeRad = 5.0 * 3.14159265358979323846 / 180.0;
      d.dragCdAxial = 0.45; d.dragAreaAxialM2 = discArea(kStackDiameterL);
      d.dragCdNormal = 1.00; d.dragAreaNormalM2 = kStackDiameterL * 2.60;
      d.normalForceSlopeM2 = tubeCn(kStackDiameterL, 2.60);
      defs_.push_back(d);
    }
    {  // Large stack decoupler.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::DecouplerStackLarge; d.name = "Stack Decoupler (large)";
      d.asset = "StackDecouplerLarge";
      d.cls = PartClass::Decoupler;
      d.diameterM = kStackDiameterL; d.heightM = 0.35;
      d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 150.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(kStackDiameterL);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = kStackDiameterL * 0.35;
      d.normalForceSlopeM2 = tubeCn(kStackDiameterL, 0.35);
      defs_.push_back(d);
    }
    {  // The only part whose two ends are different classes: class L below,
       // class S above. `diameterM` is its LARGE end; a builder that needs the
       // small one reads kStackDiameterS.
      PartDef d(RadialOrigin::Axis);
      d.id = parts::StackAdapter; d.name = "Stack Adapter"; d.asset = "StackAdapter";
      d.cls = PartClass::Structural;
      d.diameterM = kStackDiameterL; d.heightM = 1.00;
      d.nodeTop = true; d.nodeBottom = true;
      d.dryMassKg = 300.0;
      d.dragCdAxial = 0.30; d.dragAreaAxialM2 = discArea(kStackDiameterL);
      d.dragCdNormal = 1.10; d.dragAreaNormalM2 = kStackDiameterL * 1.00 * 0.75;
      d.normalForceSlopeM2 = tubeCn(kStackDiameterL, 1.00);
      defs_.push_back(d);
    }
    {  // Vernier: a small radial liquid engine for fine control.
       // 16/250 == 20/312.5 -> mdot 6.5262 kg/s.
      PartDef d(RadialOrigin::MountPlane);
      d.id = parts::EngineVernier; d.name = "Vernier Engine"; d.asset = "EngineVernier";
      d.cls = PartClass::Engine;
      d.diameterM = 0.28; d.heightM = 0.43; d.radialMount = true;
      d.dryMassKg = 80.0;
      d.thrustSeaLevelN = 16000.0; d.thrustVacuumN = 20000.0;
      d.ispSeaLevelS = 250.0; d.ispVacuumS = 312.5;
      d.consumes = Propellant::LiquidFuel;
      d.throttleable = true; d.restartable = true; d.minThrottle = 0.0;
      d.gimbalRangeRad = 8.0 * 3.14159265358979323846 / 180.0;
      d.dragCdAxial = 0.50; d.dragAreaAxialM2 = 0.08;
      d.dragCdNormal = 0.90; d.dragAreaNormalM2 = 0.16;
      d.normalForceSlopeM2 = 0.08;
      defs_.push_back(d);
    }
  }
};

// The one shared catalogue instance. Header-only, so it is a function-local
// static: constructed once, on first use, in every translation unit that asks.
inline const PartCatalogue& catalogue() {
  static const PartCatalogue c;
  return c;
}

// =============================================================================
// §4 - the tree.
// =============================================================================

struct PartInstance {
  PartHandle handle = kNoHandle;
  PartId def = kNoPart;
  PartHandle parent = kNoHandle;
  Attach attach = Attach::Root;

  // Radial placement (ignored unless attach == Attach::Radial): the angle
  // around the parent's axis and the height up the parent at which the mount
  // plane sits. Matches the art contract's (R cos a, y, R sin a).
  double radialAngleRad = 0.0;
  double radialOffsetM = 0.0;

  // Current contents. Capacity lives in the PartDef; this is what is left.
  double propellantKg = 0.0;
  double electricCharge = 0.0;

  // The STAGE GROUP this part belongs to: the index of the burn during which it
  // is aboard and its tank, if it has one, is being drained. kNeverDecoupled
  // means it is payload and rides to the end.
  //
  // This is deliberately NOT "the index of the stage that decouples me", which
  // is off by one from it and was the first thing tried. Under the KSP sequence
  // that this model follows, stage k LIGHTS burn k and DROPS the hardware of
  // burn k-1, because a single press has to be able to jettison the spent stage
  // and light the next engine together. So a stage's decouple list names the
  // group that just finished, and this field names the group a part is in. One
  // integer, one meaning, and a delta-v sum is then a filter over it.
  int stage = kNeverDecoupled;

  // Filled by Vessel::layout(): the part's own origin (its bottom mating
  // plane for a stack part, its mount plane for a radial one) expressed in the
  // VESSEL body frame, +Y along the stack axis toward the nose.
  Vec3 originM{0, 0, 0};
  // The part's centroid in the same frame (what mass and area are weighted at).
  Vec3 centroidM{0, 0, 0};

  bool deployed = false;   // legs / panels / chute
};

// One stage: what it lights and what it throws away, in firing order.
//
// The KSP sequence, and the reason it is this way round: pressing stage k
// simultaneously DROPS the spent hardware of burn k-1 and LIGHTS burn k. So the
// first press of a two-stage rocket lights the lower engine and decouples
// nothing (`decouple` empty), and the second press decouples the whole lower
// stage and lights the upper engine. A stage that ignited and decoupled in the
// same press could never be burned, which is what the other ordering does.
struct Stage {
  std::vector<PartHandle> activate;   // engines ignited when this stage fires
  std::vector<PartHandle> decouple;   // decouplers fired (each severs a subtree)
};

class Vessel {
 public:
  std::vector<PartInstance> parts;
  std::vector<Stage> stages;
  int nextStageIndex = 0;   // the stage that will fire next; == stages.size()
                            // once everything has been staged.

  // ---- construction --------------------------------------------------------

  PartHandle addRoot(PartId def) {
    PartInstance p;
    p.handle = nextHandle_++;
    p.def = def;
    p.parent = kNoHandle;
    p.attach = Attach::Root;
    fill(p);
    parts.push_back(p);
    return p.handle;
  }

  // Attach a part to `parent`. `how` must be StackTop, StackBottom or Radial.
  PartHandle attach(PartHandle parent, PartId def, Attach how,
                    double radialAngleRad = 0.0, double radialOffsetM = 0.0) {
    PartInstance p;
    p.handle = nextHandle_++;
    p.def = def;
    p.parent = parent;
    p.attach = how;
    p.radialAngleRad = radialAngleRad;
    p.radialOffsetM = radialOffsetM;
    fill(p);
    parts.push_back(p);
    return p.handle;
  }

  // ---- access --------------------------------------------------------------

  PartInstance* find(PartHandle h) {
    for (auto& p : parts) if (p.handle == h) return &p;
    return nullptr;
  }
  const PartInstance* find(PartHandle h) const {
    for (const auto& p : parts) if (p.handle == h) return &p;
    return nullptr;
  }
  const PartDef& def(const PartInstance& p) const {
    const PartDef* d = catalogue().get(p.def);
    // The unresolvable-part fallback. MountPlane is the conservative answer:
    // it is what every radial part did before PH-81, so a part id that does not
    // resolve cannot make the layout move.
    static const PartDef kEmpty(RadialOrigin::MountPlane);
    return d ? *d : kEmpty;
  }
  PartHandle root() const {
    for (const auto& p : parts) if (p.parent == kNoHandle) return p.handle;
    return kNoHandle;
  }
  bool empty() const { return parts.empty(); }

  // Assign every part in the subtree rooted at `h` (inclusive) to stage group
  // `s`. This is how an assembly UI says "this decoupler and everything it
  // holds burns during stage 0" with one call.
  void assignSubtreeToStage(PartHandle h, int s) {
    for (auto& p : parts)
      if (isInSubtree(p.handle, h)) p.stage = s;
  }

  bool isInSubtree(PartHandle node, PartHandle rootOfSubtree) const {
    PartHandle cur = node;
    int guard = 0;
    while (cur != kNoHandle && guard++ < 4096) {
      if (cur == rootOfSubtree) return true;
      const PartInstance* p = find(cur);
      if (!p) return false;
      cur = p->parent;
    }
    return false;
  }

  // ---- geometry ------------------------------------------------------------
  // Fills originM / centroidM for every part. Cheap (one pass per depth level),
  // and idempotent, so callers may just call it after any structural change.
  void layout() {
    // Resolve in parent-before-child order. The tree is small (tens of parts),
    // so repeated sweeps are cheaper than building an index.
    std::vector<bool> done(parts.size(), false);
    for (size_t i = 0; i < parts.size(); ++i) {
      if (parts[i].parent == kNoHandle) {
        parts[i].originM = Vec3{0, 0, 0};
        parts[i].centroidM = centroidOf(parts[i], parts[i].originM);
        done[i] = true;
      }
    }
    bool progress = true;
    while (progress) {
      progress = false;
      for (size_t i = 0; i < parts.size(); ++i) {
        if (done[i]) continue;
        const PartInstance* par = find(parts[i].parent);
        if (!par) { done[i] = true; continue; }  // orphan: leave at origin
        size_t pi = parts.size();
        for (size_t k = 0; k < parts.size(); ++k)
          if (parts[k].handle == par->handle) { pi = k; break; }
        if (pi == parts.size() || !done[pi]) continue;
        parts[i].originM = originFrom(parts[pi], parts[i]);
        parts[i].centroidM = centroidOf(parts[i], parts[i].originM);
        done[i] = true;
        progress = true;
      }
    }
  }

  // Overall length along the stack axis, nose tip to engine bell.
  double lengthM() const {
    if (parts.empty()) return 0.0;
    double lo = 1e300, hi = -1e300;
    for (const auto& p : parts) {
      const PartDef& d = def(p);
      const double a = p.originM.y;
      const double b = p.originM.y + ((p.attach == Attach::Radial) ? d.heightM : d.heightM);
      lo = std::fmin(lo, std::fmin(a, b));
      hi = std::fmax(hi, std::fmax(a, b));
    }
    return hi - lo;
  }

 private:
  PartHandle nextHandle_ = 1;

  void fill(PartInstance& p) {
    const PartDef* d = catalogue().get(p.def);
    if (!d) return;
    if (d->propellant != Propellant::None &&
        d->propellant != Propellant::ElectricCharge) {
      p.propellantKg = d->propellantCapacityKg;
    }
    p.electricCharge = d->electricCapacity;
  }

  // Where a child's origin sits, given its parent's.
  Vec3 originFrom(const PartInstance& parent, const PartInstance& child) const {
    const PartDef& pd = def(parent);
    const PartDef& cd = def(child);
    switch (child.attach) {
      case Attach::StackTop:
        // child sits ON the parent: child's bottom plane == parent's top plane.
        return Vec3{parent.originM.x, parent.originM.y + pd.heightM, parent.originM.z};
      case Attach::StackBottom:
        // child hangs BELOW: child's top plane == parent's bottom plane, and a
        // stack part's origin is its own bottom plane, so drop by its height.
        return Vec3{parent.originM.x, parent.originM.y - cd.heightM, parent.originM.z};
      case Attach::Radial: {
        // PH-81. HOW FAR OUT THE CHILD'S ORIGIN GOES DEPENDS ON WHAT THE
        // CHILD'S ORIGIN MEANS, and that is declared, not inferred (see
        // RadialOrigin in §1).
        //
        //   MountPlane  the origin IS the inboard face, so it belongs exactly
        //               on the parent's hull. Unchanged, bit for bit: this is
        //               what a fin, a solar panel, an RCS block, a landing leg,
        //               a vernier and a radial decoupler have always done and
        //               none of them was broken.
        //
        //   Axis        the origin is the child's own centreline, so putting it
        //               on the parent's hull buries half the child INSIDE the
        //               parent. Pushed out by the child's own radius as well,
        //               which puts the two hulls exactly in contact.
        const double R = (cd.radialOrigin == RadialOrigin::Axis)
                             ? pd.diameterM * 0.5 + cd.diameterM * 0.5
                             : pd.diameterM * 0.5;
        return Vec3{parent.originM.x + R * std::cos(child.radialAngleRad),
                    parent.originM.y + child.radialOffsetM,
                    parent.originM.z + R * std::sin(child.radialAngleRad)};
      }
      case Attach::Root:
      default:
        return Vec3{0, 0, 0};
    }
  }

  Vec3 centroidOf(const PartInstance& p, const Vec3& origin) const {
    const PartDef& d = def(p);
    if (p.attach == Attach::Radial) {
      // PH-81. THIS BRANCHES TOO, and getting it wrong moves the centre of mass
      // and every mass property downstream of it.
      //
      //   MountPlane  origin is on the inboard face and the body extends
      //               outward, so the centroid is offset outboard. Unchanged.
      //   Axis        origin is ALREADY the centreline, so the centroid is ON
      //               it. Offsetting it outward would double-count the same
      //               radius `originFrom` has just added and hang the mass half
      //               a diameter off the part.
      //
      // Both cases span the part's own height about its origin the same way,
      // because a radially carried stack part's origin is still its bottom
      // mating plane in Y.
      const double c = std::cos(p.radialAngleRad), s = std::sin(p.radialAngleRad);
      const double out =
          (d.radialOrigin == RadialOrigin::Axis) ? 0.0 : d.diameterM * 0.5;
      return Vec3{origin.x + out * c, origin.y + d.heightM * 0.5, origin.z + out * s};
    }
    return Vec3{origin.x, origin.y + d.heightM * 0.5, origin.z};
  }
};

// =============================================================================
// §5 - mass properties.
// =============================================================================

struct MassProperties {
  double dryKg = 0.0;         // structure only
  double propellantKg = 0.0;  // everything burnable or transferable
  double totalKg = 0.0;       // dry + propellant
  Vec3 comM{0, 0, 0};         // centre of mass, vessel body frame
  Vec3 copM{0, 0, 0};         // centre of pressure, normal-force-slope weighted
  double normalCdA = 0.0;     // sum of Cd*A broadside (the sideways FORCE)
  double axialCdA = 0.0;      // sum of Cd*A nose-on
  double normalForceSlope = 0.0;  // sum of dCn/dalpha (the pitching MOMENT)
  // Diagonal inertia about the CoM in the body frame. Ixx == Izz for an
  // axisymmetric stack; Iyy is the roll axis.
  double IxxKgM2 = 0.0, IyyKgM2 = 0.0, IzzKgM2 = 0.0;
};

inline double partMassKg(const Vessel& v, const PartInstance& p) {
  return v.def(p).dryMassKg + p.propellantKg;
}

// Total propellant of one kind currently aboard.
inline double propellantAboardKg(const Vessel& v, Propellant kind) {
  double sum = 0.0;
  for (const auto& p : v.parts)
    if (v.def(p).propellant == kind) sum += p.propellantKg;
  return sum;
}

// Turbulent flat-plate skin-friction coefficient, applied to the stack's wetted
// area. 0.004 is the textbook value at the Reynolds numbers a launch vehicle
// sees, and it is what stops a long thin rocket from being as slippery as a
// short one (see the axial-drag comment in massProperties).
static constexpr double kSkinFrictionCd = 0.004;

inline MassProperties massProperties(const Vessel& v) {
  MassProperties m;
  Vec3 momentum{0, 0, 0};
  Vec3 areaMoment{0, 0, 0};

  // Axial drag is NOT a sum over parts, and this is the second place in this
  // file where the obvious sum is wrong. Parts in a stack SHADE ONE ANOTHER:
  // air meets the nose and then flows along the tube, so only the forward-most
  // part presents pressure drag and the rest contribute skin friction.
  //
  // Summing Cd*A over the parts instead gave the 12 m reference rocket an
  // axial Cd*A of 3.274 m^2 on a 1.227 m^2 frontal disc, an effective Cd of
  // 2.67 for a rocket, which is roughly a parachute. It cost 64 kN of drag at
  // max-q against 180 kN of thrust: 36% of the engine was being spent on an
  // arithmetic error, and the ascent still reached orbit, which is exactly why
  // it needed a number rather than a look.
  //
  // The model instead is the standard decomposition:
  //     Cd*A = Cd(nose) * A_max  +  Cf * wetted area  +  radial parts, unshaded
  // Radial parts are summed because they genuinely are not shaded: a fin or a
  // strap-on booster sticks out into clean air.
  //
  // The BROADSIDE sum above is left as a sum, and that is not an inconsistency:
  // flying sideways, the parts are side by side across the flow and every one
  // of them is in it.
  double maxFrontalM2 = 0.0;
  double stackSideAreaM2 = 0.0;
  double radialCdA = 0.0;
  double forwardMostY = -1e300;
  double noseCd = 0.0;

  for (const auto& p : v.parts) {
    const PartDef& d = v.def(p);
    const double mass = d.dryMassKg + p.propellantKg;
    m.dryKg += d.dryMassKg;
    m.propellantKg += p.propellantKg;
    momentum = momentum + p.centroidM * mass;

    m.normalCdA += d.dragCdNormal * d.dragAreaNormalM2;
    m.normalForceSlope += d.normalForceSlopeM2;
    areaMoment = areaMoment + p.centroidM * d.normalForceSlopeM2;

    if (p.attach == Attach::Radial) {
      radialCdA += d.dragCdAxial * d.dragAreaAxialM2;
    } else {
      if (d.dragAreaAxialM2 > maxFrontalM2) maxFrontalM2 = d.dragAreaAxialM2;
      stackSideAreaM2 += d.dragAreaNormalM2;
      const double leadingEdgeY = p.originM.y + d.heightM;
      if (leadingEdgeY > forwardMostY) {
        forwardMostY = leadingEdgeY;
        noseCd = d.dragCdAxial;
      }
    }
  }
  // Wetted area of a cylinder of side profile D*L is pi*D*L.
  m.axialCdA = noseCd * maxFrontalM2 +
               kSkinFrictionCd * 3.14159265358979323846 * stackSideAreaM2 +
               radialCdA;
  m.totalKg = m.dryKg + m.propellantKg;
  if (m.totalKg > 0.0) m.comM = momentum * (1.0 / m.totalKg);
  if (m.normalForceSlope > 0.0) m.copM = areaMoment * (1.0 / m.normalForceSlope);

  // Inertia: each part is a uniform cylinder with its axis along +Y, moved to
  // its own centroid by the parallel-axis theorem.
  for (const auto& p : v.parts) {
    const PartDef& d = v.def(p);
    const double mass = d.dryMassKg + p.propellantKg;
    const double r = d.diameterM * 0.5;
    const double L = d.heightM;
    const double Iaxial = 0.5 * mass * r * r;                  // about its own +Y
    const double Itrans = mass * (3.0 * r * r + L * L) / 12.0; // about its own X/Z
    const Vec3 dv = p.centroidM - m.comM;
    m.IyyKgM2 += Iaxial + mass * (dv.x * dv.x + dv.z * dv.z);
    m.IxxKgM2 += Itrans + mass * (dv.y * dv.y + dv.z * dv.z);
    m.IzzKgM2 += Itrans + mass * (dv.x * dv.x + dv.y * dv.y);
  }
  return m;
}

// The static-stability number, and the one the anti-flip model keys off.
// Positive means the centre of pressure is FORWARD of the centre of mass along
// the stack axis, i.e. the vessel is statically UNSTABLE in pitch and any angle
// of attack grows. Negative means fins (or an empty upper tank) have pulled the
// CoP aft and aerodynamic torque restores. See flight.h §4.
inline double staticMarginM(const MassProperties& m) {
  return m.copM.y - m.comM.y;
}

// =============================================================================
// §6 - staging.
//
// fireStage() advances nextStageIndex, which ignites that stage's engines (the
// caller reads `activeEngines()`), and severs the tree at every decoupler the
// stage lists. The rule, stated once so it cannot be re-invented per caller:
//
//   A DECOUPLER SEVERS THE LINK TO ITS OWN PARENT. The decoupler, and its
//   entire subtree (everything further from the root than it), leaves. The
//   decoupler's own mass goes WITH the discarded side.
//
// The root of a vessel is its command pod, so "further from the root" is
// "further down the stack", which is what a player means by staging. The same
// rule serves a radial decoupler holding a strap-on booster with no special
// case, which is the reason to state it in terms of the tree rather than in
// terms of up and down.
//
// Mass is conserved by construction: every part is either kept or moved, never
// copied and never dropped. test_vessel.cpp asserts it anyway, because "by
// construction" is a claim and this project's rule is that a claim without a
// number is an opinion.
// =============================================================================

// Every engine the vessel has ignited and not yet discarded. A stage's engines
// stay lit once activated (a spent stage's engines leave with the stage).
inline std::vector<PartHandle> activeEngines(const Vessel& v) {
  std::vector<PartHandle> out;
  for (int s = 0; s < v.nextStageIndex && s < static_cast<int>(v.stages.size()); ++s)
    for (PartHandle h : v.stages[s].activate)
      if (v.find(h) != nullptr) out.push_back(h);
  return out;
}

struct StageResult {
  bool fired = false;
  int stageIndex = -1;
  std::vector<Vessel> jettisoned;  // usually 1; 2 for a pair of strap-ons
  double jettisonedMassKg = 0.0;
};

inline StageResult fireStage(Vessel& v) {
  StageResult res;
  if (v.nextStageIndex >= static_cast<int>(v.stages.size())) return res;

  const int idx = v.nextStageIndex;
  const Stage& st = v.stages[idx];
  res.fired = true;
  res.stageIndex = idx;
  v.nextStageIndex = idx + 1;

  for (PartHandle dh : st.decouple) {
    const PartInstance* dec = v.find(dh);
    if (!dec) continue;

    // Collect the subtree rooted at the decoupler.
    Vessel out;
    std::vector<PartInstance> keep;
    for (const auto& p : v.parts) {
      if (v.isInSubtree(p.handle, dh)) {
        PartInstance q = p;
        if (q.handle == dh) { q.parent = kNoHandle; q.attach = Attach::Root; }
        out.parts.push_back(q);
        res.jettisonedMassKg += v.def(p).dryMassKg + p.propellantKg;
      } else {
        keep.push_back(p);
      }
    }
    v.parts.swap(keep);

    // The jettisoned vessel keeps whatever staging it still owns, renumbered
    // from 0, so debris with its own live stages (a spent booster that still
    // has a chute) remains a legal vessel rather than a bag of parts.
    for (const Stage& s : v.stages) {
      Stage kept;
      for (PartHandle h : s.activate) if (out.find(h)) kept.activate.push_back(h);
      for (PartHandle h : s.decouple) if (out.find(h) && h != dh) kept.decouple.push_back(h);
      if (!kept.activate.empty() || !kept.decouple.empty()) out.stages.push_back(kept);
    }
    out.layout();
    res.jettisoned.push_back(std::move(out));
  }

  // Drop references to parts that have left, so the remaining vessel's stage
  // lists stay honest.
  for (Stage& s : v.stages) {
    std::vector<PartHandle> a, d;
    for (PartHandle h : s.activate) if (v.find(h)) a.push_back(h);
    for (PartHandle h : s.decouple) if (v.find(h)) d.push_back(h);
    s.activate.swap(a);
    s.decouple.swap(d);
  }
  v.layout();
  return res;
}

// =============================================================================
// §7 - derived performance. DW-30 item 4: per-stage delta-v is ALWAYS visible,
// in the assembly view and in flight, so it has to be cheap and it has to be
// right.
//
// The staging convention, which is the part most easily got wrong:
//   When stage k ignites, the vessel is every part belonging to stage k plus
//   every part belonging to every LATER stage. Earlier stages are already gone.
//   m0(k) = that wet mass.
//   m1(k) = m0(k) minus the propellant stage k's engines can actually burn,
//           which is the propellant held by stage-k parts of the kind the
//           stage's engines consume. The stage's dry structure is still
//           attached at burnout: it is thrown away AFTER the burn, not during.
//
// Monopropellant is therefore inert to a liquid-engine delta-v sum and appears
// in both m0 and m1, which is exactly right and is the single most common way
// a home-made delta-v readout comes out a few percent optimistic.
// =============================================================================

struct StagePerformance {
  int index = -1;
  double startMassKg = 0.0;      // m0
  double endMassKg = 0.0;        // m1
  double propellantKg = 0.0;     // burned by this stage, ALL kinds it can drink
  double ispVacuumS = 0.0;       // thrust-weighted, AT IGNITION (see R43 below)
  double ispSeaLevelS = 0.0;
  double thrustVacuumN = 0.0;    // AT IGNITION: fed engines only
  double thrustSeaLevelN = 0.0;
  double massFlowKgS = 0.0;      // AT IGNITION; altitude-invariant by construction
  double deltaVVacuumMS = 0.0;   // summed ACROSS the burn's phases
  double deltaVSeaLevelMS = 0.0;
  double burnTimeS = 0.0;        // LAST flameout: the stage is spent
  double fullThrustS = 0.0;      // FIRST flameout: ignition thrust ends here
};

// Does part `p` belong to stage `k` or to a later one? kNeverDecoupled counts
// as "later than everything".
inline bool partPresentAtStage(const PartInstance& p, int k) {
  return p.stage >= k;
}

// Tsiolkovsky. Stated as its own function so the test can hit it directly and
// so nobody re-types the formula: deltaV = Isp * g0 * ln(m0 / m1).
inline double tsiolkovsky(double ispS, double m0Kg, double m1Kg) {
  if (ispS <= 0.0 || m1Kg <= 0.0 || m0Kg <= m1Kg) return 0.0;
  return ispS * atmo::kG0 * std::log(m0Kg / m1Kg);
}

// R43, fixed 2026-08-02. A stage that lights two propellant KINDS at once has
// TWO burn times and ONE delta-v, and the old code had neither. It pooled the
// FIRST engine's kind of propellant and then divided that by EVERY engine's
// mass flow: a solid booster beside a liquid engine reported 4300 kg over
// 61.801 + 321.99 kg/s = 11.203 s, against a flight that burned the booster's
// 9000 kg for 27.95 s and ran the engine to 69.58 s. The readout was not
// approximate, it was measuring a quantity that does not exist.
//
// The model here is per-kind and phase-integrated:
//
//   * each propellant kind has its own tankage in this stage, its own engines,
//     its own mass flow (altitude-invariant, because T_sl/Isp_sl == T_vac/Isp_vac
//     for every authored engine) and therefore its OWN flameout time;
//   * the burn is CUT at every flameout and Tsiolkovsky is applied across each
//     phase with that phase's thrust-weighted Isp, then summed. One ratio over
//     the whole stage is wrong the instant the kinds differ, because losing an
//     engine part-way changes the effective Isp of everything after it;
//   * `fullThrustS` is the FIRST flameout (how long the stage holds its ignition
//     thrust) and `burnTimeS` is the LAST (when the stage is spent). On a
//     single-kind stage they are equal and every figure this function published
//     before R43 is unmoved to the last bit, which is what the reference
//     vehicle's 1857.79 + 3065.12 m/s pins;
//   * an engine whose kind has NO propellant in this stage is NOT FIRING, so it
//     contributes neither thrust nor Isp nor mass flow. A thrust-to-weight that
//     counts a dry engine is the same class of lie as the burn time above.
//
// Why not simply filter the engine loop by `consumes`, which is the one-line
// version: because that DROPS the booster's 672 kN out of a stage it dominates
// and reports a pad TWR that says the vehicle cannot leave the ground. Trading
// an understated burn time for an understated thrust is not a fix.
inline StagePerformance stagePerformance(const Vessel& v, int k) {
  StagePerformance sp;
  sp.index = k;
  if (k < 0 || k > static_cast<int>(v.stages.size())) return sp;

  // Indexed by the Propellant enumerator. 0 is None and is never used.
  constexpr int kKinds = 5;
  double fuelKg[kKinds] = {0.0, 0.0, 0.0, 0.0, 0.0};
  double mdot[kKinds]   = {0.0, 0.0, 0.0, 0.0, 0.0};
  double thrVac[kKinds] = {0.0, 0.0, 0.0, 0.0, 0.0};
  double thrSl[kKinds]  = {0.0, 0.0, 0.0, 0.0, 0.0};
  double invVac[kKinds] = {0.0, 0.0, 0.0, 0.0, 0.0};   // sum(T_vac / Isp_vac)
  double invSl[kKinds]  = {0.0, 0.0, 0.0, 0.0, 0.0};   // sum(T_sl  / Isp_sl)
  bool   drinks[kKinds] = {false, false, false, false, false};

  // Which engines does this stage light, and what does each of them drink?
  if (k < static_cast<int>(v.stages.size())) {
    for (PartHandle h : v.stages[k].activate) {
      const PartInstance* p = v.find(h);
      if (!p) continue;
      const PartDef& d = v.def(*p);
      if (!d.isEngine()) continue;
      const int c = static_cast<int>(d.consumes);
      if (c <= 0 || c >= kKinds) continue;
      drinks[c] = true;
      thrVac[c] += d.thrustVacuumN;
      thrSl[c] += d.thrustSeaLevelN;
      if (d.ispVacuumS > 0.0) {
        invVac[c] += d.thrustVacuumN / d.ispVacuumS;
        mdot[c] += d.thrustVacuumN / (d.ispVacuumS * atmo::kG0);
      }
      if (d.ispSeaLevelS > 0.0) invSl[c] += d.thrustSeaLevelN / d.ispSeaLevelS;
    }
  }

  // m0: everything still attached when this stage lights.
  for (const auto& p : v.parts)
    if (partPresentAtStage(p, k)) sp.startMassKg += partMassKg(v, p);

  // The propellant this stage can actually burn, pooled BY KIND. Membership is
  // unchanged: a stage-k tank, or a never-decoupled tank on the final stage.
  // A kind no engine here drinks stays inert and sits in both m0 and m1.
  for (const auto& p : v.parts) {
    if (p.stage != k) {
      // A never-decoupled part belongs to the final stage.
      const bool isFinalStage = (k == static_cast<int>(v.stages.size()) - 1) ||
                                (v.stages.empty() && k == 0);
      if (!(isFinalStage && p.stage == kNeverDecoupled)) continue;
    }
    const int c = static_cast<int>(v.def(p).propellant);
    if (c <= 0 || c >= kKinds || !drinks[c]) continue;
    fuelKg[c] += p.propellantKg;
  }

  // The kinds that actually burn: an engine to drink them AND fuel to drink.
  int live[kKinds];
  int nLive = 0;
  double tOut[kKinds] = {0.0, 0.0, 0.0, 0.0, 0.0};
  for (int c = 1; c < kKinds; ++c) {
    if (mdot[c] <= 0.0 || fuelKg[c] <= 0.0) continue;
    tOut[c] = fuelKg[c] / mdot[c];
    live[nLive++] = c;
    sp.propellantKg += fuelKg[c];
  }
  sp.endMassKg = sp.startMassKg - sp.propellantKg;

  // Ignition figures: fed engines only, with the correct Isp combination rule
  // (Isp = sum(T) / sum(T / Isp), NOT the arithmetic mean).
  double invVac0 = 0.0, invSl0 = 0.0;
  for (int i = 0; i < nLive; ++i) {
    const int c = live[i];
    sp.thrustVacuumN += thrVac[c];
    sp.thrustSeaLevelN += thrSl[c];
    sp.massFlowKgS += mdot[c];
    invVac0 += invVac[c];
    invSl0 += invSl[c];
  }
  if (invVac0 > 0.0) sp.ispVacuumS = sp.thrustVacuumN / invVac0;
  if (invSl0 > 0.0) sp.ispSeaLevelS = sp.thrustSeaLevelN / invSl0;

  // Flameouts in time order. At most 4 kinds, so an insertion sort is both the
  // fastest and the only one worth reading.
  for (int i = 1; i < nLive; ++i) {
    const int key = live[i];
    int j = i - 1;
    while (j >= 0 && tOut[live[j]] > tOut[key]) { live[j + 1] = live[j]; --j; }
    live[j + 1] = key;
  }
  if (nLive > 0) {
    sp.fullThrustS = tOut[live[0]];
    sp.burnTimeS = tOut[live[nLive - 1]];
  }

  // Walk the phases. Between two flameouts the thrust, the Isp and the flow are
  // all constant, so each phase is one honest Tsiolkovsky.
  bool spent[kKinds] = {false, false, false, false, false};
  double tPrev = 0.0;
  double m = sp.startMassKg;
  for (int i = 0; i < nLive; ++i) {
    const double tNow = tOut[live[i]];
    double flow = 0.0, tv = 0.0, ts = 0.0, iv = 0.0, is = 0.0;
    for (int j = 0; j < nLive; ++j) {
      const int c = live[j];
      if (spent[c]) continue;
      flow += mdot[c]; tv += thrVac[c]; ts += thrSl[c];
      iv += invVac[c]; is += invSl[c];
    }
    // The LAST phase lands on m1 exactly rather than on an accumulated product,
    // so a single-kind stage reproduces tsiolkovsky(isp, m0, m1) bit for bit.
    const bool last = (i == nLive - 1);
    const double mNext = last ? sp.endMassKg : (m - flow * (tNow - tPrev));
    if (mNext < m && flow > 0.0) {
      if (iv > 0.0) sp.deltaVVacuumMS += tsiolkovsky(tv / iv, m, mNext);
      if (is > 0.0) sp.deltaVSeaLevelMS += tsiolkovsky(ts / is, m, mNext);
      m = mNext;
    }
    tPrev = tNow;
    for (int j = 0; j < nLive; ++j)
      if (tOut[live[j]] <= tNow) spent[live[j]] = true;
  }
  return sp;
}

inline std::vector<StagePerformance> allStagePerformance(const Vessel& v) {
  std::vector<StagePerformance> out;
  const int n = static_cast<int>(v.stages.size());
  for (int k = 0; k < n; ++k) out.push_back(stagePerformance(v, k));
  return out;
}

inline double totalDeltaVVacuumMS(const Vessel& v) {
  double sum = 0.0;
  for (const StagePerformance& s : allStagePerformance(v)) sum += s.deltaVVacuumMS;
  return sum;
}

// Delta-v still available from the CURRENT state: the stage that is burning now
// plus everything after it, using the propellant actually left aboard. This is
// the number that goes on the flight HUD (DW-30 item 4) and it is deliberately
// a different function from the assembly-view total, because after a burn they
// legitimately differ.
inline double remainingDeltaVVacuumMS(const Vessel& v) {
  double sum = 0.0;
  const int first = (v.nextStageIndex > 0) ? v.nextStageIndex - 1 : 0;
  for (int k = first; k < static_cast<int>(v.stages.size()); ++k)
    sum += stagePerformance(v, k).deltaVVacuumMS;
  return sum;
}

// Thrust-to-weight at a given body and altitude. Gravity comes from the body's
// mu and NOTHING ELSE (DW-18): g = mu / (R + h)^2. Thrust lapses with ambient
// pressure through atmosphere.h, so this is the honest pad number and it falls
// as the vehicle climbs (weight down, thrust up).
inline double thrustToWeight(const Vessel& v, int stageIndex,
                             double bodyMuM3S2, double bodyRadiusM,
                             double altitudeM, const atmo::AtmosphereProfile& air) {
  const StagePerformance sp = stagePerformance(v, stageIndex);
  const double r = bodyRadiusM + altitudeM;
  if (r <= 0.0 || sp.startMassKg <= 0.0) return 0.0;
  const double g = bodyMuM3S2 / (r * r);
  const double pr = atmo::pressureRatio(air, altitudeM);
  const double T = atmo::lapse(sp.thrustSeaLevelN, sp.thrustVacuumN, pr);
  return T / (sp.startMassKg * g);
}

}  // namespace vessel
}  // namespace of
