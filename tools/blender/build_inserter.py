"""
build_inserter.py - Inserter (sim-internal, no TypeId).

    ~/.local/bin/blender501 --background --python tools/blender/build_inserter.py

Produces assets/models/dist/machines/inserter.glb.

DW-9: inserters are not player-placeable. BuildableNetwork::connect creates
them, so they carry no item id and no BuildKind - but they exist in the world
wherever a connection exists and must be rendered, because a connection you
cannot see is a connection you cannot debug. Hence the mesh.

Footprint 1 x 1 m, height 0.9 m. Base disc, mast, and a swing arm ending in a
two-finger grip that is visibly holding something.

The arm reaches EXACTLY 0.50 m from the mast axis, which is the inscribed
radius of the 1 m cell, so the full 180 degree sweep from socket_pick to
socket_drop never crosses into a neighbouring cell at any point in the clip.
That is the whole reason the reach is 0.50 and not the 0.55 a longer forearm
would have wanted.

--------------------------------------------------------------------------
RN-1596 AND RN-1597, THE SE FORM PASS
--------------------------------------------------------------------------
THIS FILE DOES NOT IMPORT machine_form, AND THAT IS RN-1591's DECISION RATHER
THAN AN OVERSIGHT. That module's LAYER table is in ABSOLUTE METRES and every
height in it was derived against a 4 m to 8 m machine. This machine is 0.70 m
across the base disc and 0.90 m tall: a `housing` stands 281 mm proud, which is
a third of the whole inserter; a `tray` stands 74 mm off a mast whose RADIUS is
100 mm; a `coaming` is taller than the base. The vocabulary does not scale
down - its heights are properties of the greeble TYPE, which is exactly what
makes it safe on the big machines - so this asset is detailed with
hand-authored boxes at its own scale and says so here. The belt made the same
call at RN-1551 and the power pole makes it at RN-1598.

WHAT THE PASS BOUGHT, AT THIS MACHINE'S SCALE:
  - ANCHOR BOLTS. The base was a disc resting on the ground. Six 45 mm heads
    on a 0.29 m circle is what bolts a machine down, and at 0.9 m tall it is
    also the only fastener a player will ever be close enough to read.
  - A BEARING HOUSING AND ITS GREASE POINT at the pivot, which is the one
    place on this machine where a moving part meets a fixed one. The head was
    a plain 0.16 m disc; it is a stepped housing with a cap and a nipple now.
  - A COUNTERWEIGHT behind the pivot. A 0.50 m arm swinging a load needs one,
    it is what an inserter physically is, and it is the only thing that puts
    anything in this silhouette ABOVE the mast on the side away from the work.
  - THE POWER CABLE, clipped up the mast and into the housing. This machine had
    no way of being connected to anything. It is the asset's `coarse` consumer
    and the argument is `hose`'s at RN-1552: the joint at the top ROTATES, so
    the run to it cannot be rigid.
  - A BOLTED SERVICE COVER on the pedestal, and hazard blocks on the base under
    the two ends of the sweep. A 0.50 m arm swinging through 180 degrees at
    shin height is the most dangerous thing in a starter base and nothing on
    the machine said so.

THE 14 COPLANAR PAIRS ARE CLOSED AT THE CAUSE (RN-1597), and both causes were
one part sized to end exactly where another one ends:
  - the status chip's outer face was ON its own bezel's outer face, and its
    top was ON the base disc's top. A lens sits INSIDE a bezel; it does now.
  - on the ARM, the two Accent fingers ended exactly on the Steel wrist's own
    end planes. The wrist is 10 mm wider than the fingers now, which is also
    what a fork carrying two fingers looks like.
The `machines/inserter: 14` row is deleted from check_coplanar.ALLOWED in this
commit, per that table's rule about an allowance that has stopped ratcheting.

WHAT THE BUDGET ARGUMENT HAS TO CLEAR, and it is the belt's argument and not
the smelter's. An inserter is drawn PER LINK, so a base with a lot of belt has
a lot of inserters; portcost.js counts them as N-1 per line. That is why the
raise is 400 -> 520 and not the generator's 900 -> 1450, why every addition
above is a box rather than a greeble stack, and why LOD1 was re-measured
before the raise was written down rather than after (contracts.json).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Inserter"
OUT = of.dist_path("machines", "inserter.glb")

BASE_R = 0.35                   # the mesh AABB: 0.70 across, inside the 1 m cell
H = 0.90
PIVOT_Z = 0.84
REACH = 0.50                    # inscribed radius of the cell
ITEM_Z = 0.35                   # belt deck height + item

BOLT_R = 0.29                   # anchor circle, inside the disc's own 0.35
CHIP_X = 0.285                  # status bezel centre; see the coplanar note
CABLE_A = 0.09                  # the cable's offset round the mast.
#   RN-1597 MEASURED THIS NUMBER RATHER THAN CHOSE IT. At 0.10 the clamp
#   bands' outer corners sit 57.0 mm off LOD1's 0.10 m mast, and cascade 1 is
#   56.25 mm per texel: 0.75 mm of cable decided whether every inserter in
#   every base is drawn at LOD0 by two cascades or by one. Pulled in to 0.09,
#   which is a cable clipped TIGHT to a mast and is what one looks like.


def _anchors(mb, n=6):
    """The hold-down bolts. `ring_boxes` is exactly the right primitive and it
    is a Z circle, which is what this machine has: the base disc's own axis."""
    mb.ring_boxes((0.045, 0.045, 0.05), BOLT_R, n, (0, 0, 0.135), "SteelDark",
                  phase=0.5236)


def _pedestal(mb):
    """Base disc, hold-downs, the sweep warning and a bolted service cover.

    THE HAZARD BLOCKS ARE UNDER THE TWO ENDS OF THE SWEEP AND NOWHERE ELSE.
    A ring of yellow round the whole base would be a decoration; two blocks on
    the pick and drop bearings are a statement about where the arm goes, and
    they are on the +Y/-Y axis because that is the axis socket_pick and
    socket_drop are on."""
    mb.cylinder(BASE_R, 0.12, (0, 0, 0.06), axis="Z", segments=12,
                role="SteelDark")
    _anchors(mb)
    for sy in (-1, 1):
        mb.box((0.16, 0.07, 0.035), (0, sy * 0.29, 0.1375), "Hazard")
    mb.cylinder(0.20, 0.16, (0, 0, 0.20), axis="Z", segments=12, role="Steel")
    mb.cylinder(0.21, 0.04, (0, 0, 0.28), axis="Z", segments=12, role="Accent")
    # the service cover on the pedestal's -X cheek, with its two bolts
    mb.box((0.03, 0.15, 0.11), (-0.195, 0, 0.20), "SteelDark")
    for sy in (-1, 1):
        mb.box((0.022, 0.035, 0.035), (-0.213, sy * 0.045, 0.20), "SteelLight")


def _column(mb):
    """The mast, its cable and the bearing housing the arm turns in.

    THE CABLE IS THE `coarse` CONSUMER AND IT IS NOT A PIPE. What is at the top
    of this mast is a joint that rotates through 180 degrees, twice per item,
    for the whole game. RN-1552's `hose` exists because a rigid duct cannot
    cross a joint that moves, and that is exactly this joint; the run is
    authored here rather than through that function only because the function's
    clamp band is sized in the same absolute metres the LAYER table is."""
    mb.cylinder(0.10, 0.50, (0, 0, 0.53), axis="Z", segments=12, role="Steel")
    # the cable: two clipped runs up the mast into the housing, and the two
    # clamp bands that are the only hard parts of the assembly
    mb.box((0.036, 0.036, 0.44), (CABLE_A, -0.048, 0.52), "Rubber")
    mb.box((0.036, 0.10, 0.036), (CABLE_A, -0.02, 0.755), "Rubber")
    for z in (0.36, 0.66):
        mb.box((0.05, 0.05, 0.028), (CABLE_A, -0.048, z), "SteelLight")
    # bearing housing: a stepped collar, a cap and the grease point
    mb.cylinder(0.16, 0.10, (0, 0, H - 0.07), axis="Z", segments=12,
                role="SteelDark")
    # THE CAP TOP IS H EXACTLY, and the first draft had it at 0.920. `col_`
    # for this machine is (0.70, 0.70, 0.90) and is a PUBLISHED INTERFACE, so
    # 20 mm of bearing cap standing out of the collision proxy is a machine
    # whose declared envelope is a lie; validate_glb caught it on the scale
    # line. The cap got shorter, which is what machine_form's footprint rule
    # says happens: the DETAIL moves, never the declared box.
    mb.cylinder(0.115, 0.045, (0, 0, H - 0.0225), axis="Z", segments=8,
                role="Steel")
    mb.box((0.032, 0.032, 0.055), (0.128, 0.062, 0.845), "SteelLight")


def build_lod0(root):
    mb = of.MeshBuilder()
    _pedestal(mb)
    _column(mb)
    # status chip on the base rim, inside r = 0.35 so the AABB stays 0.70.
    # RN-1597: the lens is 5 mm INSIDE its bezel on every one of the three axes
    # that used to be shared, which is what a lens in a bezel is.
    mb.box((0.13, 0.09, 0.07), (CHIP_X, 0, 0.105), "SteelDark")
    mb.box((0.09, 0.06, 0.04), (0.300, 0, 0.105), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    mb.cylinder(BASE_R, 0.12, (0, 0, 0.06), axis="Z", segments=8,
                role="SteelDark")
    mb.cylinder(0.10, 0.66, (0, 0, 0.45), axis="Z", segments=8, role="Steel")
    # RN-1597's LOD1 STAND-INS, both chosen by check_shadow_lod rather than by
    # eye. The pedestal collar and the bearing housing are the two places the
    # form pass put material out at radius, and LOD1 carried a 0.10 m mast past
    # both of them; two cylinders keep this tier inside cascade 2's texel and
    # so keep the marginal multiplier where the pass found it.
    mb.cylinder(0.20, 0.20, (0, 0, 0.20), axis="Z", segments=8, role="Steel")
    mb.cylinder(0.16, 0.14, (0, 0, H - 0.07), axis="Z", segments=8,
                role="SteelDark")
    mb.box((0.09, 0.06, 0.04), (0.300, 0, 0.105), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((BASE_R * 2, BASE_R * 2, H), (0, 0, H * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD2", root)


def build_arm(root):
    """Stepped down toward the grip so the fingers land at item height (0.35 m)
    rather than at pivot height. A sibling of _LOD0: the arm is the one part
    that must be free to move, and keeping it out of LOD0 leaves the footprint
    check exact.

    THE COUNTERWEIGHT IS ON THE OTHER SIDE OF THE PIVOT and is the one addition
    here that is about the machine's PHYSICS rather than its surface: a 0.50 m
    arm lifting a load is a lever, and a lever with nothing behind its fulcrum
    is a claim that the motor takes the whole moment. It also gives the only
    silhouette this machine has above the mast on the idle side, which is the
    side facing a player half the time."""
    mb = of.MeshBuilder()
    mb.box((0.20, 0.14, 0.10), (0, -0.05, 0), "SteelDark")
    mb.box((0.13, 0.17, 0.09), (0, 0.115, -0.005), "SteelDark")
    mb.box((0.10, 0.10, 0.10), (0, 0.185, -0.005), "SteelLight")
    for dy, dz in ((-0.13, -0.06), (-0.245, -0.19), (-0.36, -0.32)):
        mb.box((0.09, 0.16, 0.09), (0, dy, dz), "Steel")
    # RN-1597. The wrist was 0.14 across and the two fingers ended on x =
    # +/-0.07, which IS the wrist's own end plane: 6 same-facing pairs on the
    # part that moves. 0.16 puts the wrist 10 mm outboard of each finger, which
    # is also what a fork carrying two fingers looks like.
    mb.box((0.16, 0.10, 0.10), (0, -0.44, -0.40), "Steel")
    finger_z = ITEM_Z - PIVOT_Z + 0.06      # fingers bottom out at ITEM_Z
    for sx in (-1, 1):
        mb.box((0.04, 0.07, 0.12), (sx * 0.05, -0.44, finger_z), "Accent")
        # the pad that actually touches cargo, all game: `paintchip`, for the
        # box rubbing strip's reason at RN-1553.
        mb.box((0.025, 0.05, 0.05), (sx * 0.035, -0.452, finger_z - 0.028),
               "SteelWorn")
    obj = mb.build("Inserter_Arm", root)
    obj.location = (0.0, 0.0, PIVOT_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mba, arm = build_arm(root)

    # SPEC CORRECTION (ASSET-SPECS 4.20): the proxy was 0.6 x 0.6, which does
    # not contain the r = 0.35 base disc the same section specifies. 0.70.
    of.add_collision_box("col_" + NAME, (0.70, 0.70, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_pick", (0.0, REACH, ITEM_Z), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_drop", (0.0, -REACH, ITEM_Z), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_grip", (0.0, -0.44, ITEM_Z - PIVOT_Z), parent=arm,
                  extras={"of_role": "carried_item"})
    of.add_socket("socket_status", (0.35, 0.0, 0.10), parent=root,
                  extras={"of_role": "state_light"})

    # Inserter_Swing, 30 frames, one-shot. The sim has two phases
    # (InserterPhase::Idle / Holding), so the renderer plays this forward to
    # carry and backward (negative timeScale) to return.
    #
    # SPEC CORRECTION (4.20): the spec says "+90 to -90 degrees about Z", which
    # assumes the arm is modelled along +X. It is modelled along -Y, the
    # project forward axis, so the identical sweep is 180 -> 0 degrees: 180 is
    # over socket_pick on +Y, 0 is over socket_drop on -Y. Keyed in 60 degree
    # steps because a single 180 degree quaternion step has no defined
    # direction.
    of.add_clip(arm, "Inserter_Swing", "rotation_euler",
                [(1, of.deg3(z=180)), (11, of.deg3(z=120)),
                 (21, of.deg3(z=60)), (31, of.deg3(z=0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Inserter_Arm", mba)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
