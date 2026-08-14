"""
build_generator.py - Generator, TypeId 0x15 (of::gameplay::types::Generator).

    ~/.local/bin/blender501 --background --python tools/blender/build_generator.py

Produces assets/models/dist/machines/generator.glb.

Footprint 3 x 2 m, height 2.6 m. A horizontal boiler on a skid with a large
flywheel on one end and a tall offset exhaust stack.

This is the only machine whose animation must read from across the whole base,
because "is my power on" is the question players ask most. The flywheel is
therefore deliberately oversized and carries four raised spokes and a bright
crank-pin boss: a smooth 16-gon disc turning about its own axis is visually
identical to a stationary one, and a stopped generator that looks like a
running one is the single worst readability failure this machine can have.

--------------------------------------------------------------------------
RN-1592 TO RN-1595, THE SE FORM PASS (docs/web/ART-DIRECTION.md, D-020)
--------------------------------------------------------------------------
THE HEADLINE IS THE FLYWHEEL GUARD, and it is the same finding wave one made
twice. A 1.2 m wheel turning at chest height, 150 mm from where a player walks
past the skid, with nothing between the two. RN-1552 added `guard_cage` for the
miner's column and the assembler's turret and it CANNOT be used here: a cage is
a ring of uprights about a VERTICAL axis and this wheel is a disc standing in a
vertical plane. So RN-1592 adds `machine_form.guard_arc`, which is the same
idea with the axis turned over: seven bars running along the shaft, hung on an
arc over the top, with the outer two in Hazard because they are the ones a
person actually meets and two legs down to the skid because a guard bolted to
something is a guard.

IT HAD TO BE BARS AND NOT A COWL, and the machine's own paragraph above is why.
A sheet cowl over this wheel is better safety geometry and it would delete the
only signal in the game that answers "is my power on" from across a base. The
wheel shows between the bars, exactly as the miner's deposit shows between its
cage bars, and for the same reason.

WHAT ELSE THE PASS BOUGHT, and every item is a thing that does a job:
  - The boiler had two blank end caps. It now has a bolted end plate (eight
    heads on `bolt_circle`, RN-1592's other new greeble, because `ring_boxes`
    only ever did a Z circle and a boiler lies on its side), a longitudinal
    seam strap along the crown and a relief valve standing off it.
  - The firebox had a glowing grate and no door. It now has a coamed fire door
    with two knuckles and a latch, and an ash lip under it in `SteelRust`.
  - Nothing on this machine had an instrument. There is now a control cabinet
    on the front at reading height, with a two-dial cluster, a bolted access
    plate, a cable tray climbing out of it and an armoured cable running to the
    power take-off mast.
  - The exhaust was a tube with a disc on top whose faces were coplanar with
    it. It is `machine_form.stack` now: three diameters over its length.
  - The skid was one extruded box with two hazard strips. It has lifting pad
    eyes at the four corners, which is how a 3 m skid arrives on site.

THE ONE PLACE THE VOCABULARY DOES NOT FIT, stated because machine_form's own
docstring asks callers to state it. That LAYER table is absolute metres sized
against 4 m to 8 m machines and this machine is 3.00 x 2.00 x 2.60. It bites
twice. A `housing` stands 281 mm proud, which against a 650 mm boiler radius is
a lump nearly half the vessel's size, so NOTHING is mounted on the boiler with
one; the relief valve and the crown strap are hand-placed solids in world
space, which is what they physically are. And the firebox sat 50 mm inboard of
the -Y footprint edge, which is less room than a `coaming` needs to stand in,
so RN-1593 moved it 100 mm inboard rather than mounting a door that would have
been a build failure by name. The move is the ONLY change to this machine's
existing silhouette and it is 100 mm on a part that was never on the edge for a
reason.

THE FIVE COPLANAR PAIRS THIS ASSET WAS ALLOWED, CLOSED AT THE CAUSE (RN-1595).
check_coplanar's table carried `machines/generator: 35` from the FS-75 baseline
and its header calls every row "a debt with a name on it, not a licence". All
three causes were the same mistake in three places - a painted part sized so
its outer face lands exactly ON the plane of the thing it is painted on:

    Y = 2.60 x14  the stack tube's top face was flush with its own cap disc.
                  `machine_form.stack` gives the tube a flared foot and a rain
                  cap WIDER than itself, so no two of its three diameters end
                  on one plane.
    Z = 1.00 x3   the hopper's accent band was 100 mm deep on a hopper 600 mm
                  deep, both flush with y = -HY. The band is now proud of the
                  hopper face rather than level with it.
    Y = 0.30 x4   the hazard strip on the skid top shared its underside plane
                  with the mast and the hopper standing on the same skid. The
                  strip sits 10 mm INTO the skid now, which is what a painted
                  strip does anyway.
    X = 0.14 x8   on the FLYWHEEL: the crank pin's outer face landed exactly on
                  the spoke plane. The pin moved 20 mm outboard, which also
                  puts it where a connecting rod could reach it.

The row is deleted from check_coplanar.ALLOWED in this same commit, per that
table's own rule that an allowance larger than the measurement has stopped
ratcheting.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402

NAME = "Generator"
OUT = of.dist_path("machines", "generator.glb")

W, D, H = 3.00, 2.00, 2.60
HX, HY = 1.50, 1.00             # the hard edges nothing may cross

SKID_H = 0.30
BOIL_R = 0.65
BOIL_L = 2.20
BOIL_Z = 1.10
WHEEL_X = 1.35
WHEEL_R = 0.60
STACK_XY = (-0.90, 0.55)
STACK_R = 0.20

# RN-1593. The firebox moved 100 mm inboard, from y = -0.75 to y = -0.65, and
# the grate with it. See the docstring: a `coaming` stands 108 mm proud and the
# old face left 50 mm to the footprint edge, so a fire door on the old position
# was a ValueError with the overshoot printed, not a judgement call.
FIRE_Y = -0.65
FIRE_D = 0.40
FIRE_FACE = FIRE_Y - FIRE_D * 0.5        # -0.85, the door's mounting plane
GRATE_Y = FIRE_FACE - 0.03               # the emissive grate, 30 mm proud

HOP_XY = (0.60, -0.70)
CAB_X = -1.12                            # the control cabinet, on the free
CAB_Y = -0.62                            # front bay outboard of the firebox
CAB_FACE = CAB_Y - 0.11                  # -0.73, leaving 270 mm of room, which
CAB_Z = 0.95                             # is what a boss plus a dial needs:
#                                          `boss` is 37 mm and `gauge` is 163
#                                          on top of it, and at the 170 mm the
#                                          first placement left, machine_form
#                                          refused the build by name with the
#                                          30 mm overshoot printed. The cabinet
#                                          moved, which is the rule that module
#                                          exists to enforce: the DETAIL moves,
#                                          never the declared edge.

PTO_X = -1.42                            # power take-off mast


def _boiler_crown(mb):
    """The pressure vessel's own hardware, in WORLD SOLIDS rather than in Face
    greebles, and machine_form's docstring asks for the reason to be here. The
    boiler is a 0.65 m cylinder and every greeble in that module mounts on a
    FLAT face at a height set by its type: a `housing` on this crown stands
    281 mm off a 650 mm radius, which is not a junction box on a boiler, it is
    a second boiler. A strap and a valve are solids in space and are authored
    as solids in space."""
    # the longitudinal crown seam, tangent at the top, half buried in the shell
    mb.box((BOIL_L * 0.94, 0.13, 0.07), (0, 0, BOIL_Z + BOIL_R - 0.01),
           "SteelDark")
    # relief valve: a boss, a body and the escape pipe leaning off the crown
    mb.cylinder(0.10, 0.10, (-0.55, 0, BOIL_Z + BOIL_R + 0.02), axis="Z",
                segments=8, role="SteelDark")
    mb.cylinder(0.07, 0.20, (-0.55, 0, BOIL_Z + BOIL_R + 0.15), axis="Z",
                segments=8, role="Steel")
    mb.box((0.09, 0.30, 0.09), (-0.55, -0.17, BOIL_Z + BOIL_R + 0.22), "Steel")
    # the service end plate: a raised flange face and the ring of bolts that
    # holds it on. -X, because +X is behind the flywheel and its guard.
    mb.cylinder(0.58, 0.06, (-BOIL_L * 0.5 - 0.08, 0, BOIL_Z), axis="X",
                segments=12, role="Steel")
    mf.bolt_circle(mb, (-BOIL_L * 0.5 - 0.09, 0.0, BOIL_Z), 0.50, 8, 0.075,
                   "X", "SteelDark", phase_deg=22.5, depth=0.05)


def _firebox(mb, lod0):
    """The combustion end: a housing, a coamed fire door, an ash lip and the
    emissive grate the sim overrides.

    THE ASH LIP IS THE `rust` CONSUMER AND IT IS THE ONLY ONE ON THIS MACHINE.
    RN-1558's rule is that rust in a working factory is the WET path and
    nothing else, which on a miner is the ore and on a coal boiler is the ash:
    ash is hygroscopic and mildly alkaline, so the one part of a fired boiler
    that genuinely goes is the pan under the grate. A rusted body panel would
    say this generator is a wreck, and it is running."""
    mb.box((0.90, FIRE_D, 0.70), (-0.35, FIRE_Y, 0.65), "SteelDark")
    if not lod0:
        return
    face = mf.Face("Y", -1, FIRE_FACE, limit=-HY, name="firebox front")
    # NOT `machine_form.hatch`, and the reason is this machine's whole point.
    # `hatch` puts a solid PANEL inside its coaming, and what is inside this
    # coaming is the emissive grate: a maintenance hatch here would bolt a
    # steel plate over the one surface the sim drives. So the door is the
    # coaming, its knuckles and its latch, and the fire itself is the window -
    # which is what a fire door with a sight port actually looks like, and it
    # puts the glow BEHIND a mouth 108 mm proud instead of flat on a panel.
    face.coaming(mb, 0.66, 0.41, -0.35, 0.60, "SteelDark", rail=0.06)
    for s in (-1, 1):
        face.part(mb, 0.075, 0.11, -0.755, 0.60 + s * 0.14, "hinge",
                  "SteelDark")
    face.part(mb, 0.055, 0.20, 0.055, 0.60, "latch", "Steel")
    mf.placard(mb, face, -0.35, 0.90, 0.26, 0.09, "Hazard")
    # the ash lip: a shelf under the grate, where wet ash sits. Its own two
    # faces are the only rust in the file.
    mb.box((0.72, 0.10, 0.09), (-0.35, FIRE_FACE - 0.04, 0.335), "SteelRust")
    mb.box((0.64, 0.05, 0.14), (-0.35, FIRE_FACE + 0.01, 0.415), "SteelRust")


def _cabinet(mb):
    """The control cabinet: the machine's instruments, its access plate and the
    cable that leaves it.

    NOTHING ON THIS MACHINE HAD AN INSTRUMENT, which is the plainest possible
    failure against D-020's bar. A boiler with no pressure gauge is not a
    boiler, and `gauge_cluster` exists because instruments on a real machine
    are grouped where a person stands to read them. This is at 0.95 m on the
    only clear bay of the front face, which is where a person stands."""
    mb.box((0.44, 0.22, 0.52), (CAB_X, CAB_Y, CAB_Z), "Steel")
    mb.box((0.50, 0.26, 0.06), (CAB_X, CAB_Y, CAB_Z + 0.29), "SteelDark")
    face = mf.Face("Y", -1, CAB_FACE, limit=-HY, name="cabinet front")
    mf.gauge_cluster(mb, face, CAB_X, CAB_Z + 0.13, 2, "SteelDark",
                     "SteelLight")
    mf.bolted_plate(mb, face, CAB_X, CAB_Z - 0.13, 0.30, 0.16, "SteelDark",
                    "SteelLight", inset=0.055, size=0.042)
    # the tray climbing the cabinet's outboard cheek, and the armoured cable
    # from its head to the power take-off mast. `hose` and not `pipe_run`: a
    # cable is flexible, so it bends rather than turning through a fitting,
    # and this is the machine's one honest `coarse` consumer.
    side = mf.Face("X", -1, CAB_X - 0.22, limit=-HX, name="cabinet cheek")
    mf.tray(mb, side, CAB_Y, CAB_Z - 0.18, CAB_Z + 0.22, 0.09, 2, "SteelDark",
            "SteelLight")
    mf.hose(mb, [(CAB_X, CAB_Y, CAB_Z + 0.34),
                 (PTO_X, CAB_Y, CAB_Z + 0.34),
                 (PTO_X, -0.06, CAB_Z + 0.34),
                 (PTO_X, -0.06, 1.86)], 0.07, "Rubber",
            clamp_role="SteelDark")


def _skid(mb, lod0):
    """The skid, and the pad eyes that say it was craned into place.

    THE SKID IS THE FOOTPRINT, so it is the one surface on this machine with
    ZERO room for a greeble: `Face(limit=)` on any of its four sides refuses
    everything in the table, correctly, because a 6 mm scribe on x = -1.50 is
    50 mm of machine outside its declared box and FactorySnap.stepsFor derives
    the clash-free mating distance from that box. Everything here therefore
    stands ON the skid rather than off its sides."""
    mb.box((W, D, SKID_H), (0, 0, SKID_H * 0.5), "SteelDark")
    if not lod0:
        return
    # RN-1595. The strip is 10 mm INTO the skid rather than sitting on it: the
    # old strip's underside was on z = 0.30 and so were the mast's and the
    # hopper's, which is 4 same-facing pairs and is also not what paint does.
    for sx in (-1, 1):
        mb.box((0.14, D - 0.10, 0.05), (sx * 1.42, 0, SKID_H + 0.015),
               "Hazard")
    # lifting pad eyes, inboard of the hazard strips so they never touch them
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((0.13, 0.19, 0.05), (sx * 1.14, sy * 0.80, SKID_H + 0.025),
                   "SteelDark")
            mb.box((0.09, 0.15, 0.19), (sx * 1.14, sy * 0.80, SKID_H + 0.145),
                   "Steel")


def build_lod0(root):
    mb = of.MeshBuilder()
    _skid(mb, True)
    mb.cylinder(BOIL_R, BOIL_L, (0, 0, BOIL_Z), axis="X", segments=16,
                role="Steel")
    for sx in (-1, 1):
        mb.cylinder(0.70, 0.10, (sx * (BOIL_L * 0.5), 0, BOIL_Z), axis="X",
                    segments=12, role="SteelDark")
        mb.box((0.30, 1.40, 0.55), (sx * 0.70, 0, SKID_H + 0.275), "SteelDark")
    for x in (-0.70, 0.0, 0.70):
        mb.cylinder(0.68, 0.06, (x, 0, BOIL_Z), axis="X", segments=12,
                    role="SteelDark")
    _boiler_crown(mb)

    # exhaust stack, offset to the back corner, carrying the full 2.60 m.
    # RN-1595: `machine_form.stack`, which is three diameters over its length
    # (a flared foot, the tube, a rain cap wider than the tube) instead of a
    # tube with a disc whose top face was on the tube's own top plane.
    # The base plate is 0.62 and not 0.50 for one measured reason: the flared
    # foot `stack` puts on the tube has a circumradius of 0.284, so a bolt on
    # a 0.50 plate lands INSIDE the foot and is a fastener nobody can see. At
    # 0.62 the four heads sit on a 0.30 circle, clear of the foot's 0.262
    # inradius, and still 68 mm inside the plate's own corner.
    mb.box((0.60, 0.60, 0.12), (STACK_XY[0], STACK_XY[1], 1.30), "SteelDark")
    mf.stack(mb, STACK_XY[0], STACK_XY[1], 1.36, H, STACK_R, "Steel",
             "SteelDark", segments=8)
    mf.bolt_circle(mb, (STACK_XY[0], STACK_XY[1], 1.385), 0.30, 4, 0.06, "Z",
                   "SteelLight", phase_deg=45.0, depth=0.05)

    # solid-fuel hopper, flush with the -Y cell edge. RN-1595: the accent band
    # is PROUD of the hopper face by 30 mm rather than flush with it, which is
    # both what a rubbing band is and the end of 3 same-facing pairs.
    mb.box((0.70, 0.60, 0.70), (HOP_XY[0], HOP_XY[1] + 0.02, 0.63),
           "Steel")
    mb.box((0.78, 0.07, 0.11), (HOP_XY[0], -HY + 0.035, 1.03), "Accent")
    # the charging lip a fuel load is dragged over: `paintchip`, for the box's
    # rubbing-strip reason at RN-1553. It is the one surface on this machine
    # that is hit by hand, all day.
    mb.box((0.74, 0.52, 0.06), (HOP_XY[0], HOP_XY[1] + 0.04, 1.00),
           "SteelWorn")
    mb.box((0.60, 0.10, 0.10), (HOP_XY[0], HOP_XY[1] + 0.20, 1.03),
           "SteelDark")

    # power take-off mast under socket_power_out
    mb.box((0.12, 0.12, 1.90), (PTO_X, 0, 1.25), "Steel")
    mb.box((0.16, 0.24, 0.24), (-HX + 0.08, 0, 2.00), "SteelDark")
    mb.box((0.20, 0.34, 0.05), (PTO_X + 0.02, 0, 1.72), "SteelDark")

    _firebox(mb, True)
    _cabinet(mb)

    # RN-1592, THE FLYWHEEL GUARD. Seven bars over the top of a 1.2 m wheel,
    # the outer two in Hazard, legs down to the skid. Radius 0.74 against the
    # wheel's own 0.60 leaves 140 mm of clearance to a part that turns; the
    # guard's own extent is x 1.16 to 1.54 ... which is 40 mm PAST the hard
    # edge, so half_len is 0.14 and not 0.19, and the number that moved is the
    # guard's rather than the wheel's.
    mf.guard_arc(mb, (WHEEL_X, 0.0, BOIL_Z), 0.74, "X", 0.14, 7, "SteelDark",
                 "Hazard", spread_deg=98.0, foot_z=SKID_H, role_foot="Steel")

    mb.box((0.40, 0.12, 0.12), (1.28, 0, 1.78), "Steel")
    mb.box((0.05, 0.40, 0.30), (1.465, 0, 1.80), "SteelDark")

    # --- state surfaces: firebox grate (combustion override) + status chip ---
    mb.box((0.60, 0.06, 0.35), (-0.35, GRATE_Y, 0.60), "EmissiveState")
    mb.box((0.04, 0.32, 0.22), (1.478, 0, 1.80), "EmissiveState")

    mf.assert_inside(mb, HX, HY, H, "Generator_LOD0")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    mb.box((W, D, SKID_H), (0, 0, SKID_H * 0.5), "SteelDark")
    mb.cylinder(BOIL_R, BOIL_L, (0, 0, BOIL_Z), axis="X", segments=12,
                role="Steel")
    for sx in (-1, 1):
        mb.box((0.30, 1.40, 0.55), (sx * 0.70, 0, SKID_H + 0.275), "SteelDark")
    mb.box((STACK_R * 2, STACK_R * 2, 1.30),
           (STACK_XY[0], STACK_XY[1], 1.95), "Steel")
    mb.box((0.70, 0.60, 0.70), (HOP_XY[0], HOP_XY[1] + 0.02, 0.63), "Steel")
    _firebox(mb, False)
    # RN-1594. THE POWER TAKE-OFF MAST, WHICH IS THE OLDEST DEFECT IN THIS FILE
    # AND BELONGS TO NOBODY'S PASS. `check_shadow_lod` reported this asset at
    # 559.02 mm before a triangle of the form pass existed, and the worst
    # vertex is at (-1.48, -0.06, 2.20): the mast head, a 1.90 m column that
    # LOD1 simply did not have. One box is 12 triangles and it is the single
    # cheapest thing in this wave; the guard stand-in below is the second.
    mb.box((0.14, 0.14, 1.90), (PTO_X, 0, 1.25), "Steel")
    mb.box((0.20, 0.28, 0.26), (-HX + 0.10, 0, 2.00), "SteelDark")
    mb.box((0.46, 0.26, 0.56), (CAB_X, CAB_Y, CAB_Z + 0.02), "Steel")
    # and the boiler crown, whose relief valve is the next outlier once the
    # mast is covered. One box takes the whole tier from 338.79 mm to inside
    # cascade 2's 210.94 mm texel, which is what buys the marginal multiplier
    # down from 4.0x to 3.0x on every generator in every base.
    mb.box((0.34, 0.42, 0.34), (-0.55, -0.12, 1.86), "SteelDark")
    # and the four lifting pad eyes, which become the outlier the moment the
    # crown is covered: 12 triangles each against a 240.00 mm deviation that
    # denies the whole asset cascade 2.
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((0.13, 0.19, 0.24), (sx * 1.14, sy * 0.80, SKID_H + 0.12),
                   "SteelDark")
    # RN-1594's LOD1 STAND-IN, chosen by check_shadow_lod exactly as RN-1556's
    # step riser was. The guard is the outermost geometry on this machine and
    # LOD1 had nothing under it at all, so every guard vertex measured its full
    # 740 mm stand-off and the whole asset kept all four cascades on LOD0. One
    # box across the wheel bay is 12 triangles and it is what buys the guard
    # back; the numbers are in contracts.json.
    mb.box((0.30, 1.24, 1.24), (WHEEL_X, 0, BOIL_Z), "SteelDark")
    mb.box((0.60, 0.06, 0.35), (-0.35, GRATE_Y, 0.60), "EmissiveState")
    mb.box((0.04, 0.32, 0.22), (1.478, 0, 1.80), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, SKID_H), (0, 0, SKID_H * 0.5), "SteelDark")
    mb.box((BOIL_L, BOIL_R * 2, BOIL_R * 2), (0, 0, BOIL_Z), "Steel")
    mb.box((STACK_R * 2, STACK_R * 2, 1.30),
           (STACK_XY[0], STACK_XY[1], 1.95), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_flywheel(root):
    """Built about its OWN origin so Gen_Flywheel is a plain rotation, and a
    SIBLING of _LOD0 so the wheel's swept volume never enters the footprint
    check. Everything stays inside the 3 x 2 cell at every angle: the wheel
    sweeps a circle of radius 0.60 about (y=0, z=1.10)."""
    mb = of.MeshBuilder()
    mb.cylinder(WHEEL_R, 0.18, (0, 0, 0), axis="X", segments=16, role="Steel")
    for dy, dz in ((0.30, 0), (-0.30, 0), (0, 0.30), (0, -0.30)):
        size = (0.06, 0.14, 0.50) if dz == 0 else (0.06, 0.50, 0.14)
        mb.box(size, (0.11, dy, dz), "SteelDark")
    mb.cylinder(0.14, 0.26, (0, 0, 0), axis="X", segments=12, role="SteelDark")
    # RN-1595. The crank pin was at x = 0.06 with a length of 0.16, so its
    # outer face landed on x = 0.14 and so did the spokes': 8 same-facing
    # pairs on the one part of this machine that MOVES, which is the worst
    # place in the file for a flicker. It is 20 mm further out now, which is
    # also where a connecting rod could reach it.
    mb.cylinder(0.07, 0.16, (0.19, 0.40, 0), axis="X", segments=12,
                role="Accent")
    mb.cylinder(0.055, 0.05, (0.29, 0.40, 0), axis="X", segments=8,
                role="SteelLight")
    obj = mb.build("Generator_Flywheel", root)
    obj.location = (WHEEL_X, 0.0, BOIL_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbw, wheel = build_flywheel(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_fuel_in", (0.60, -HY, 0.90), parent=root,
                  extras={"of_role": "fuel_in"})
    of.add_socket("socket_power_out", (-1.40, 0.0, 2.00), parent=root,
                  extras={"of_role": "power_out"})
    of.add_socket("socket_smoke", (STACK_XY[0], STACK_XY[1], H), parent=root,
                  extras={"of_role": "smoke"})
    of.add_socket("socket_status", (HX, 0.0, 1.80), parent=root,
                  extras={"of_role": "state_light"})

    # Gen_Flywheel: 120 frames == BurnCombustite.timeTicks, two full turns per
    # burn. Keyed in 120 degree steps so the quaternion slerp cannot shortcut
    # or stall (see of_lib.add_clip).
    of.add_clip(wheel, "Gen_Flywheel", "rotation_euler",
                [(1 + i * 20, of.deg3(x=120 * i)) for i in range(7)])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Generator_Flywheel", mbw)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
