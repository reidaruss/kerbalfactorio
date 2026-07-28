"""
build_assembler.py - Assembler, TypeId 0x13 (of::gameplay::types::Assembler).

    blender --background --python tools/blender/build_assembler.py

Produces assets/models/dist/machines/assembler.glb.

Footprint 8 x 8 m, height 4.0 m: two structural modules square, one module
tall (DW-32 puts the module at 4 m). It used to be 3 x 3 x 2.8, which is
Factorio scale, and VISION-NOTES section 2 is the reason it is not any more:
"they're pretty big and they have slots for the inputs and slots for the
outputs that fit the belts and the belts snap to".

WHY THE BODY WAS REDRAWN AND NOT JUST SCALED. The old assembler was an
open-topped work cell: four corner posts, an upper ring, a platen in the
middle. At 3 m that reads as a machine; at 8 m the same parts read as a
gazebo, because a post's thickness stops being structural once the span it
carries is nearly three times longer. So this is a solid industrial housing
instead: a plinth flush to the footprint edge, a stepped body, and a roof deck
carrying the plant. The parts that carry the read are now the SLOTS.

THE SLOTS ARE THE POINT. Each item port is a recessed mouth in the housing
face: two jambs, a head, a sill, a dark throat set 0.30 m back from the outer
plane, and a painted band across the head and the sill. A belt terminating at
one visibly runs INTO a hole rather than stopping near a wall, which is the
thing FS-43's port model asserts in code and the art had never shown.

THE PORT HEIGHTS ARE THE SMELTER'S, DELIBERATELY. socket_item_in_* sits at
z = 0.90 and socket_item_out at z = 0.45, exactly where build_smelter.py puts
its own pair. Every machine in the game therefore presents item ports at the
same two heights, so one belt deck height reaches all of them and
FactoryPorts.fitOf's rise is a per-role constant instead of a per-asset one.
The footprint stays an EVEN whole number of metres because machines snap on a
1 m site grid and PORT_MATE_M (0.65) is derived from the even-footprint
half-cell residual being exactly 0.50 m.

FS-75: WHAT WAS COPLANAR AND IS NOT ANY MORE. `tools/blender/check_coplanar.py`
reads the shipped bytes and counts pairs of DIFFERENT-material triangles that
sit on one plane, point the same way and overlap in area, which is the only
arrangement a depth test cannot resolve. This file measured 63. In descending
order of blame:

  36  the roof railings were as long as the deck and stood on 3.65, so each
      rail's end faces were exactly on the deck's own side planes at 3.70.
      Nothing to do with paint; just two parts sharing an edge plane.
  12  the LOD1 slot blocks reach y = HALF and so did the plinth under them.
   6  the outlet's frame ran to z = 0 and so did the plinth's underside.
   4  the two inlet sills hung 0.20 m below the top of the skirt they stand on,
      putting their painted bands on the plinth's front plane.
   3  the outlet's own sill band, on the plinth's front plane, which is the
      defect FS-68 named and did not finish.
   2  the body's underside and the skirt's underside both started at PLINTH_H.

Each is fixed where it was caused rather than by nudging a part 1 mm: the rails
are shorter, the foundation is notched under the outlet, the inlet sills are
DERIVED from the height of the thing they stand on, and the body's foot is
buried. The asset now measures 0 and check_coplanar.py gates it there.

The arm is a sibling of _LOD0, not a child, exactly like the belt slat strip:
it keeps LOD0's bounding box at exactly 8 x 8 x 4 while the sweep is free to
carry the gripper wherever the cycle needs it. It is roof mounted now, because
a solid housing has no interior to sweep over, and it is still the one part
allowed to break the box silhouette: a static assembler and a running one must
be distinguishable from across the base.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Assembler"
OUT = of.dist_path("machines", "assembler.glb")

W = D = 8.00
H = 4.00
HALF = 4.00                     # the hard edge nothing in LOD0 may cross

PLINTH_H = 0.35
SKIRT_H = 0.07                  # the painted keep-out ring on the plinth top
BODY = 7.20
BODY_HALF = BODY * 0.5          # 3.60
BODY_Z0 = 0.28                  # the body's foot is BURIED in the plinth, so
                                # its underside shares no plane with the
                                # skirt's. Both used to start at PLINTH_H and
                                # both point down, which is two front faces on
                                # one plane: see the FS-75 note below.
BODY_TOP = 2.90
COLLAR = 7.60
COLLAR_TOP = 3.20
DECK = 7.40
DECK_TOP = 3.35
RAIL_C = DECK * 0.5 - 0.10      # 3.60: the roof railing's centreline. It used
                                # to be 3.65 with a rail as long as the DECK,
                                # which put the rail's END faces on exactly the
                                # deck's own side planes at 3.70. Measured on
                                # the shipped bytes that was 36 of this asset's
                                # 63 same-facing coplanar pairs, by far the
                                # largest single cause, and it had nothing to
                                # do with paint at the footprint edge.
MOUTH_D = HALF - BODY_HALF      # 0.40, the gap the slot frames live in
BAND_T = 0.06                   # painted band thickness; it ends ON HALF and
                                # the steel behind it stops short by this much

IN_Z = 0.90                     # smelter's socket_item_in height
OUT_Z = 0.45                    # smelter's socket_item_out height
STATUS_Z = 2.20

# --- the three slots, hoisted out of the LOD bodies ------------------------
# They are constants rather than call-site literals because the plinth's notch
# has to be exactly as wide as the outlet's frame, and a notch that is a
# transcription of a width rather than a function of it is a defect waiting for
# somebody to retune one of the two.
IN_W, IN_H, IN_JAMB, IN_HEAD = 1.60, 0.70, 0.55, 0.40
# THE INLET SILL IS DERIVED, NOT CHOSEN. The slot has to stand ON the painted
# skirt rather than hang over it: the sill's own painted band lands on y = HALF
# and so does the plinth's front face, so any part of the band that reaches
# below the skirt's top is paint lying on steel with nothing to break the tie.
# It used to be 0.40, which put the band at 0.25 to 0.45 against a plinth that
# tops out at 0.35, and that is 4 of the 63 pairs.
IN_SILL = IN_Z - IN_H * 0.5 - (PLINTH_H + SKIRT_H)      # 0.13
OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL = 1.60, 0.50, 0.50, 0.35, 0.20
# The outlet cannot be lifted the same way: socket_item_out is at 0.45 and the
# opening's own bottom edge is therefore at 0.20, BELOW the 0.42 the plinth and
# skirt reach. No trimming fixes that, so the foundation gets out of the way
# instead. This is the half-width the notch has to span.
SLOT_HALF = OUT_W * 0.5 + OUT_JAMB                      # 1.30
NOTCH_Y = BODY_HALF - 0.04      # 3.56: the notched plinth's -Y edge. It stops
                                # INSIDE the body face rather than on it, so
                                # the plinth's front face is buried in the body
                                # instead of being coplanar with it.

PWR_X, PWR_Y, PWR_Z = 3.10, -3.10, 3.90
ARM_X, ARM_Y, ARM_Z = -2.20, -2.20, H       # shoulder, on the roof deck plant
BOOM = 2.60                     # shoulder to elbow
GRIP_Z = -0.42                  # gripper point, in the arm's own frame


def _put(mb, axis, across, along, zs, c_across, c_along, z, role):
    """Place a box on a face whose OUTWARD normal runs along `axis`.

    `across` is the size in the face's horizontal direction and `along` is its
    thickness through the face, so one description of a slot serves the +Y, +X
    and -Y faces without three transcriptions of the same numbers."""
    if axis == "Y":
        mb.box((across, along, zs), (c_across, c_along, z), role)
    else:
        mb.box((along, across, zs), (c_along, c_across, z), role)


def _mouth(mb, axis, sign, z_c, open_w, open_h, jamb, head_h, sill_h,
           band_role):
    """A recessed port slot in one face of the housing.

    Two jambs, a head and a sill fill the 0.40 m step between the body face
    and the footprint edge, leaving a hole `open_w` by `open_h` centred on
    `z_c`. A dark throat plate sits 0.30 m behind the outer plane so the hole
    has a visible bottom, and a painted band crosses the head and the sill so
    the slot is legible as a port from across the base."""
    z0 = z_c - open_h * 0.5
    z1 = z_c + open_h * 0.5
    lo, hi = z0 - sill_h, z1 + head_h
    outer_w = open_w + 2.0 * jamb
    jamb_c = (open_w + jamb) * 0.5

    # THE FRAME STOPS ONE BAND SHORT OF THE EDGE, AND THAT IS THE WHOLE REASON
    # THIS IS NOT ONE NUMBER. The band has to end at HALF because HALF is the
    # hard footprint edge, so the band cannot move outward to clear the steel;
    # the steel has to move inward instead. Give the frame the full MOUTH_D and
    # both land their outer face on exactly HALF, the painted band is then
    # coplanar with the steel it is painted on, and the depth test picks a
    # winner per pixel: the band disappears, or worse, flickers with the camera.
    frame_d = MOUTH_D - BAND_T                      # 0.34
    a_frame = sign * (HALF - BAND_T - frame_d * 0.5)  # 3.77, stopping at 3.94
    a_throat = sign * (BODY_HALF + 0.05)            # 3.65, 0.30 back from 4.00
    a_band = sign * (HALF - BAND_T * 0.5)           # 3.97, ending ON the edge

    for s in (-1, 1):
        _put(mb, axis, jamb, frame_d, hi - lo, s * jamb_c, a_frame,
             (lo + hi) * 0.5, "Steel")
    _put(mb, axis, outer_w, frame_d, head_h, 0.0, a_frame,
         z1 + head_h * 0.5, "Steel")
    _put(mb, axis, outer_w, frame_d, sill_h, 0.0, a_frame,
         z0 - sill_h * 0.5, "Steel")
    _put(mb, axis, open_w, 0.10, open_h, 0.0, a_throat, z_c, "SteelDark")
    _put(mb, axis, outer_w, BAND_T, head_h * 0.5, 0.0, a_band,
         z1 + head_h * 0.5, band_role)
    _put(mb, axis, outer_w, BAND_T, sill_h * 0.5, 0.0, a_band,
         z0 - sill_h * 0.5, band_role)


def _mouth_block(mb, axis, sign, z_c, open_w, open_h, jamb, head_h, sill_h):
    """The same slot at LOD1: one filled frame block plus a dark inset, so the
    port is still where it was and still reads dark, at two boxes instead of
    six. A decimator cannot do this to a slot; it closes the hole."""
    lo = z_c - open_h * 0.5 - sill_h
    hi = z_c + open_h * 0.5 + head_h
    outer_w = open_w + 2.0 * jamb
    _put(mb, axis, outer_w, MOUTH_D, hi - lo, 0.0,
         sign * (HALF - MOUTH_D * 0.5), (lo + hi) * 0.5, "Steel")
    _put(mb, axis, open_w, 0.10, open_h, 0.0, sign * (HALF - 0.06), z_c,
         "SteelDark")


def _notched(mb, thickness, z0, role):
    """One layer of the foundation, in three boxes rather than one, absent
    across the outlet's width.

    THIS IS THE FS-75 FIX AND IT IS THE ONLY SHAPE THE ARGUMENT ALLOWS. The
    outlet's sill band has to land on y = -HALF because HALF is the hard
    footprint edge and paint at the edge is the whole point of a painted band.
    The plinth's own front face is already on that plane, so the two are
    coplanar, they point the same way, they overlap, and the depth test picks a
    winner per pixel: the band disappears or it flickers with the camera. The
    band cannot move outward because HALF is hard, and it cannot move inward
    because then it is not on the edge. So the STEEL moves, and the only way
    steel moves out of a plane it is defined to occupy is by not being there.

    The layer still sets the 8 x 8 footprint on its own: the two outer strips
    hold all four corners, which is what the exported bounding box reads.

    It is also better as a machine. A belt deck sits at 0.25 m, and a 0.35 m
    foundation running unbroken across the face is something a belt has to butt
    into rather than reach; the notch is the clearance an outlet at 0.45 m
    always implied and never had."""
    mb.box((W, HALF + NOTCH_Y, thickness),
           (0, (HALF - NOTCH_Y) * 0.5, z0 + thickness * 0.5), role)
    for s in (-1, 1):
        mb.box((HALF - SLOT_HALF, HALF - NOTCH_Y, thickness),
               (s * (HALF + SLOT_HALF) * 0.5, -(HALF + NOTCH_Y) * 0.5,
                z0 + thickness * 0.5), role)


def _shell(mb):
    """Plinth, body, collar and roof deck: the stepped silhouette every LOD
    keeps. The plinth alone sets the 8 x 8 footprint, so no detail part has to
    be trimmed to hold the cell edge."""
    _notched(mb, PLINTH_H, 0.0, "SteelDark")
    mb.box((BODY, BODY, BODY_TOP - BODY_Z0),
           (0, 0, (BODY_Z0 + BODY_TOP) * 0.5), "Steel")
    mb.box((COLLAR, COLLAR, COLLAR_TOP - BODY_TOP),
           (0, 0, (BODY_TOP + COLLAR_TOP) * 0.5), "SteelDark")
    mb.box((DECK, DECK, DECK_TOP - COLLAR_TOP),
           (0, 0, (COLLAR_TOP + DECK_TOP) * 0.5), "Steel")


def _plant(mb):
    """Roof plant: the turret pedestal the arm stands on, the exhaust manifold
    and its three stacks. These are what carry the housing to its full 4.00 m,
    which is why nothing else on the roof needs to reach the top and z-fight
    the deck."""
    mb.box((1.40, 1.40, H - COLLAR_TOP), (ARM_X, ARM_Y, (COLLAR_TOP + H) * 0.5),
           "Steel")
    mb.box((2.60, 1.20, 0.70), (1.40, 1.60, 3.60), "SteelDark")
    for x in (0.60, 1.40, 2.20):
        mb.box((0.34, 0.34, H - 3.30), (x, 1.60, (3.30 + H) * 0.5), "Steel")


def build_lod0(root):
    mb = of.MeshBuilder()
    _shell(mb)

    # hazard skirt: the ring of plinth left proud of the body, painted. It is
    # the keep-out the old deck chevrons were, moved to where a 8 m machine
    # actually has spare deck.
    #
    # IT SITS ON TOP OF THE PLINTH, NOT INTO IT. The skirt's four sides land on
    # the footprint edge, which is where the plinth's sides already are; sink it
    # 0.03 into the plinth and that much of both is the same plane and the paint
    # fights the plinth for it. Stacking them makes the contact a line instead
    # of an area, which no depth test has to arbitrate.
    #
    # IT CARRIES THE SAME NOTCH AS THE PLINTH UNDER IT. Not because the paint
    # would fight anything there (the outlet's own bands clear this height), but
    # because a keep-out ring painted across a doorway is a claim about the
    # machine that is not true, and because leaving it whole would hang a 0.07 m
    # lintel over a 0.44 m void.
    _notched(mb, SKIRT_H, PLINTH_H, "Hazard")

    # corner buttresses, sunk into the plinth and the collar at both ends so
    # no face of theirs is coplanar with a face of the shell
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((0.70, 0.70, 2.95), (sx * 3.40, sy * 3.40, 1.775),
                   "SteelDark")
    # jacket bands, kept clear of the slots (which top out at 1.65) and of the
    # status rail (1.98 to 2.42)
    for z in (1.80, 2.80):
        mb.box((BODY + 0.10, BODY + 0.10, 0.16), (0, 0, z), "SteelDark")
    mb.box((COLLAR + 0.06, COLLAR + 0.06, 0.10), (0, 0, 3.05), "Accent")

    # the three item slots. Inputs on +Y and +X at the smelter's inlet height,
    # output on -Y at its outlet height. The inputs STAND ON the skirt (their
    # sill is derived from its top); the output runs to the ground through the
    # notch _notched cut for it.
    _mouth(mb, "Y", 1, IN_Z, IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL, "Hazard")
    _mouth(mb, "X", 1, IN_Z, IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL, "Hazard")
    _mouth(mb, "Y", -1, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL,
           "Accent")

    # -X is the service face: a louvre bank and an access door
    mb.box((0.10, 4.60, 1.10), (-3.58, 0, 1.10), "SteelDark")
    for z in (0.70, 1.00, 1.30, 1.60):
        mb.box((0.14, 4.40, 0.14), (-3.64, 0, z), "Steel")
    mb.box((0.12, 2.20, 0.65), (-3.64, 0, 2.325), "SteelDark")
    mb.box((0.10, 0.12, 0.36), (-3.72, 0.80, 2.325), "Steel")

    # roof deck railing, then the plant. The rails are DECK - 0.20 long and
    # stand on RAIL_C, so no end face of a rail lands on the deck's own side
    # plane at 3.70. See RAIL_C for what that cost before.
    for s in (-1, 1):
        mb.box((DECK - 0.20, 0.10, 0.44), (0, s * RAIL_C, 3.53), "SteelDark")
        mb.box((0.10, DECK - 0.20, 0.44), (s * RAIL_C, 0, 3.53), "SteelDark")
    _plant(mb)
    mb.box((0.30, 0.30, 0.60), (PWR_X, PWR_Y, 3.60), "Steel")

    # front status rail. Bezel and inlay before the chip: OF_EmissiveState has
    # to stay the LAST material slot on every mesh.
    mb.box((4.40, 0.14, 0.44), (0, -3.67, STATUS_Z), "Steel")
    mb.box((4.00, 0.06, 0.28), (0, -3.76, STATUS_Z), "SteelDark")
    mb.box((3.60, 0.05, 0.20), (0, -3.785, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _shell(mb)
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((0.70, 0.70, 2.95), (sx * 3.40, sy * 3.40, 1.775),
                   "SteelDark")
    mb.box((COLLAR + 0.06, COLLAR + 0.06, 0.10), (0, 0, 3.05), "Accent")
    _mouth_block(mb, "Y", 1, IN_Z, IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL)
    _mouth_block(mb, "X", 1, IN_Z, IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL)
    _mouth_block(mb, "Y", -1, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL)
    _plant(mb)
    mb.box((3.60, 0.05, 0.20), (0, -3.785, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "SteelDark")
    mb.box((BODY, BODY, COLLAR_TOP - PLINTH_H),
           (0, 0, (PLINTH_H + COLLAR_TOP) * 0.5), "Steel")
    mb.box((DECK, DECK, H - COLLAR_TOP), (0, 0, (COLLAR_TOP + H) * 0.5),
           "SteelDark")
    return mb, mb.build(NAME + "_LOD2", root)


def build_arm(root):
    """Turret, boom, forearm and two-finger gripper as ONE object, built with
    the shoulder at its local origin so a single rotation_euler Z curve is the
    whole sweep. One clip, one object - see of_lib.add_clip_multi."""
    mb = of.MeshBuilder()
    mb.cylinder(0.45, 0.50, (0, 0, 0.25), axis="Z", segments=12, role="Steel")
    mb.box((0.50, 0.50, 0.60), (0, 0, 0.80), "SteelDark")
    mb.box((0.30, BOOM, 0.30), (0, BOOM * 0.5, 1.05), "Steel")
    mb.box((0.34, 0.24, 0.34), (0, 1.30, 1.05), "Hazard")
    mb.box((0.40, 0.40, 0.40), (0, BOOM, 1.05), "SteelDark")
    mb.box((0.24, 0.24, 0.95), (0, BOOM, 0.575), "Steel")
    mb.box((0.38, 0.34, 0.16), (0, BOOM, 0.02), "SteelDark")
    for sx in (-1, 1):
        mb.box((0.10, 0.18, 0.42), (sx * 0.14, BOOM, -0.27), "Steel")
    obj = mb.build("Assembler_Arm", root)
    obj.location = (ARM_X, ARM_Y, ARM_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mba, arm = build_arm(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_in_a", (0.0, HALF, IN_Z), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_in_b", (HALF, 0.0, IN_Z), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -HALF, OUT_Z), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_power_in", (PWR_X, PWR_Y, PWR_Z), parent=root,
                  extras={"of_role": "power_in"})
    of.add_socket("socket_arm_grip", (0.0, BOOM, GRIP_Z), parent=arm,
                  extras={"of_role": "carried_item"})
    of.add_socket("socket_status", (0.0, -HALF, STATUS_Z), parent=root,
                  extras={"of_role": "state_light"})

    # Assembler_Arm_Cycle: 90 frames == AssembleFrame.timeTicks.
    # reach to input 1-25, swing over the deck 26-50, press 51-60, return
    # 61-90. Rotation and the press dip are two channels of ONE action, so the
    # exporter cannot split them into two same-named clips.
    # three.js: action.timeScale = 90 / recipe.craftTimeTicks.
    of.add_clip_multi(arm, "Assembler_Arm_Cycle", {
        "rotation_euler": [(1, of.deg3(z=0)), (25, of.deg3(z=12)),
                           (50, of.deg3(z=-45)), (60, of.deg3(z=-45)),
                           (91, of.deg3(z=0))],
        "location": [(1, (ARM_X, ARM_Y, ARM_Z)),
                     (50, (ARM_X, ARM_Y, ARM_Z)),
                     (55, (ARM_X, ARM_Y, ARM_Z - 0.16)),
                     (60, (ARM_X, ARM_Y, ARM_Z - 0.16)),
                     (66, (ARM_X, ARM_Y, ARM_Z)),
                     (91, (ARM_X, ARM_Y, ARM_Z))],
    })

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Assembler_Arm", mba)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
