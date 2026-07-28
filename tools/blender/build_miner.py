"""
build_miner.py - Miner, TypeId 0x10 (of::gameplay::types::Miner).

    blender --background --python tools/blender/build_miner.py

Produces assets/models/dist/machines/miner.glb.

Footprint 4 x 4 m, height 3.20 m. It shipped at 2 x 2 x 2.4, which is Factorio
scale, and it was the last machine still at the old baseline alongside the
smelter: the assembler is 8 m (FS-57) and the storage box is 4 m (FS-68), and
`FactoryKinds.FOOTPRINT` already reads `miner: 4`. The asset was the lagging
half of that number.

WHY 3.20 m AND NOT THE SMELTER'S 3.60. This is a drill tower, and the thing a
drill tower must not do is out-top the kiln standing next to it: a chimney has
to be the tallest silhouette on a starter base or it stops reading as a
chimney. 3.20 also keeps the drill motor housing a whole 0.70 m above the body
top, which is what makes the machine read as "a motor pushing a column into
the ground" rather than as a box with a lid. Family by height: box 3.00,
miner 3.20, smelter 3.60, assembler 4.00.

WHY THIS ONE DOES NOT GET THE PLINTH THE BOX AND THE SMELTER HAVE.
EntityDef.requiresDeposit is true, so the design has to say "it eats the
ground": four corner legs straddle the ore with NOTHING between them, and you
can see straight through to the deposit the machine is bound to. A plinth
flush to the footprint edge would close exactly the gap that claim is made of.
So the FOOT PADS alone set the 4 x 4 footprint, which is the same discipline
the plinth serves elsewhere (one part owns the cell edge and no detail part
has to be trimmed to hold it) applied to a machine that must stay open.

THE SLOT IS THE POINT, and at this scale the miner can finally have one. Its
outlet is a recessed mouth in a chute housing hung off the -Y face: two jambs,
a head, a sill, a dark throat plate set back from the outer plane, and a
painted band across the head and the sill. At 2 m the chute was a bare box
with an accent stripe, because there was no 0.26 m of depth to recess anything
into. A belt terminating here now visibly runs INTO a hole.

SOCKET_ITEM_OUT MOVED FROM z = 0.55 TO z = 0.45, AND THAT IS DELIBERATE
(FS-57 finally finished). Every other machine in the game hands items out at
0.45: the smelter, the box and the assembler all do. The miner's 0.55 was the
last hold-out and it existed only because the 2 m gantry's chute happened to
sit there. One belt deck at 0.25 m now reaches every outlet in the game and
FactoryPorts' rise is a per-role constant rather than a per-asset one.

THE FOOTPRINT STAYS AN EVEN WHOLE NUMBER OF METRES and that is not taste.
Machines snap on a 1 m site grid and FactorySnap.stepsFor steps a new part
ceil((fpA + fpB) / 2) cells away, so an even footprint keeps exactly the
half-cell residual PORT_MATE_M (0.65 m) was derived against. An odd footprint
lands on the other side of the rounding and moves the bound for every machine
in the game, not just this one.

THE DRILL AND ITS MOUNT ARE SIBLINGS OF _LOD0, NOT CHILDREN, so the LOD0
bounding box stays exactly 4 x 4 x 3.2 while the column is free to sink below
z = 0. Drill_Bob translates the mount, Drill_Spin turns the column under it, so
each clip still drives exactly one object (of_lib.add_clip_multi says why).

HALF IS A HARD EDGE. No LOD0 geometry crosses it in any axis in the tangent
plane. In particular the leg posts stop at 1.92 and their painted cuffs at
1.95, so the pads are the only parts on the cell edge and the cuffs never
share the pads' outer plane. The 2 m miner put pad, leg and cuff all flush at
HALF, which measured as 10 overlapping coplanar pairs of steel against paint.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Miner"
OUT = of.dist_path("machines", "miner.glb")

# --- dimensions (metres) ---------------------------------------------------
W = D = 4.00                    # footprint, whole metres (4 x 4 build cells)
H = 3.20
HALF = W * 0.5                  # 2.00, the hard edge nothing in LOD0 may cross

FOOT = 0.60                     # foot pad section; the pads own the cell edge
FOOT_H = 0.24
FOOT_C = HALF - FOOT * 0.5      # 1.70, so the pad's outer corner IS the corner
LEG = 0.44                      # leg section, centred on its pad
LEG_TOP = 1.52                  # legs end INSIDE the body, not on its underside
CUFF = LEG + 0.06               # painted cuff, proud of the leg and short of
                                # the pad's outer plane at HALF
BODY = 3.40
BODY_HALF = BODY * 0.5          # 1.70
BODY_Z0 = 1.40                  # the body's underside; the gantry is below it
BODY_TOP = 2.50
FLANGE = 3.60
FLANGE_TOP = 2.64
HOUSE = 1.90                    # drill motor housing, carries the 3.20 m height
HOUSE_Z0 = 2.58                 # sunk INTO the flange, so no shared plane
CORNERS = [(sx * FOOT_C, sy * FOOT_C) for sx in (-1, 1) for sy in (-1, 1)]

# The turning column. It hangs from the bob mount and is a SIBLING of LOD0.
COL_R = 0.44
COL_H = 1.90
COL_Z = 1.50                    # column centre -> z 0.55 .. 2.45, top buried
                                # in the body so the tube has no visible cap
BIT_TIP_Z = 0.06

# --- the outlet slot -------------------------------------------------------
# CHUTE_Y is this machine's BODY_HALF as far as the mouth is concerned: the
# plane the frame is recessed from. It is 0.04 proud of the body face so the
# chute housing and the body share no plane at all.
CHUTE_Y = 1.74
MOUTH_D = HALF - CHUTE_Y        # 0.26, the gap the slot frame lives in
BAND_D = 0.06                   # painted band thickness, flush with the edge
FRAME_D = MOUTH_D - BAND_D      # 0.20: the frame stops SHORT of the edge, so
                                # the band is a raised strip and not a decal
                                # fighting the steel for the same pixels.
OUT_Z = 0.45                    # FS-57's item_out height, and see the docstring
OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL = 1.30, 0.46, 0.42, 0.28, 0.22

STATUS_Z = 2.00
# Power inlet: a bracket on the body's +X face at the -Y end, clear of both the
# ribs and the leg tops. A top-corner nub would sit inside the flange.
PWR_X, PWR_Y, PWR_Z = 1.98, -1.50, 2.46

RIB_YS = (-1.20, -0.62, 0.62, 1.20)


def _mouth(mb, z_c, open_w, open_h, jamb, head_h, sill_h, band_role):
    """The recessed outlet slot in the -Y face of the chute housing.

    Two jambs, a head and a sill fill the first 0.20 m of the step between the
    chute face and the footprint edge, leaving a hole `open_w` by `open_h`
    centred on `z_c`; the painted band fills the last 0.06 m across the head
    and the sill, so the slot is legible as a port from across the base. A dark
    throat plate stands proud of the chute face so the hole has a visible
    bottom. Only -Y is parameterised because the miner has exactly one item
    port: it takes its input from the ground."""
    z0 = z_c - open_h * 0.5
    z1 = z_c + open_h * 0.5
    lo, hi = z0 - sill_h, z1 + head_h
    outer_w = open_w + 2.0 * jamb
    jamb_c = (open_w + jamb) * 0.5
    y_frame = -(CHUTE_Y + FRAME_D * 0.5)        # -1.84, the frame's middle
    y_throat = -(CHUTE_Y + 0.05)                # -1.79, proud of the chute
    y_band = -(HALF - BAND_D * 0.5)             # -1.97, flush with the edge

    for s in (-1, 1):
        mb.box((jamb, FRAME_D, hi - lo), (s * jamb_c, y_frame, (lo + hi) * 0.5),
               "Steel")
    mb.box((outer_w, FRAME_D, head_h), (0, y_frame, z1 + head_h * 0.5), "Steel")
    mb.box((outer_w, FRAME_D, sill_h), (0, y_frame, z0 - sill_h * 0.5), "Steel")
    mb.box((open_w, 0.10, open_h), (0, y_throat, z_c), "SteelDark")
    mb.box((outer_w, BAND_D, head_h * 0.5), (0, y_band, z1 + head_h * 0.5),
           band_role)
    mb.box((outer_w, BAND_D, sill_h * 0.5), (0, y_band, z0 - sill_h * 0.5),
           band_role)


def _mouth_block(mb, z_c, open_w, open_h, jamb, head_h, sill_h):
    """The same slot at LOD1: one filled frame block plus a dark inset, so the
    port is still where it was and still reads dark, at two boxes instead of
    seven. A decimator cannot do this to a slot; it closes the hole."""
    lo = z_c - open_h * 0.5 - sill_h
    hi = z_c + open_h * 0.5 + head_h
    outer_w = open_w + 2.0 * jamb
    mb.box((outer_w, MOUTH_D, hi - lo),
           (0, -(HALF - MOUTH_D * 0.5), (lo + hi) * 0.5), "Steel")
    mb.box((open_w, 0.10, open_h), (0, -(HALF - 0.06), z_c), "SteelDark")


def _gantry(mb):
    """Four pads on the cell corners and four legs standing on them.

    The pads alone reach HALF. The legs are centred on their pads and stop
    0.08 short of the edge, and they begin exactly at the pad top so the only
    plane they share with a pad is a back-to-back contact no depth test has to
    arbitrate. Their tops end INSIDE the body for the same reason."""
    for cx, cy in CORNERS:
        mb.box((FOOT, FOOT, FOOT_H), (cx, cy, FOOT_H * 0.5), "SteelDark")
    for cx, cy in CORNERS:
        mb.box((LEG, LEG, LEG_TOP - FOOT_H), (cx, cy, (FOOT_H + LEG_TOP) * 0.5),
               "Steel")


def _chute(mb):
    """The housing the outlet slot is cut into: a box hung off the -Y face,
    0.04 proud of it, running from just above the ground up into the body.

    It has to exist because the -Y face at z = 0.45 is OPEN GANTRY on this
    machine; there is no wall there to recess a mouth into. Its top is buried
    in the body and its front plane is CHUTE_Y, so it shares no plane with the
    body it hangs from."""
    mb.box((2.40, 0.68, 1.50), (0, -1.40, 0.80), "SteelDark")


def _shell(mb):
    """Body, cap flange and drill motor housing: the parts every LOD keeps."""
    mb.box((BODY, BODY, BODY_TOP - BODY_Z0),
           (0, 0, (BODY_Z0 + BODY_TOP) * 0.5), "Steel")
    mb.box((FLANGE, FLANGE, FLANGE_TOP - BODY_TOP),
           (0, 0, (BODY_TOP + FLANGE_TOP) * 0.5), "Accent")
    mb.box((HOUSE, HOUSE, H - HOUSE_Z0), (0, 0, (HOUSE_Z0 + H) * 0.5),
           "SteelDark")


def build_lod0(root):
    mb = of.MeshBuilder()
    _gantry(mb)
    # painted cuffs at shin height: the legs are the part a player walks into.
    # Proud of the leg (so no shared plane) and short of HALF (so none of the
    # paint lands on the pads' outer plane).
    for cx, cy in CORNERS:
        mb.box((CUFF, CUFF, 0.18), (cx, cy, 0.63), "Hazard")

    _chute(mb)
    _shell(mb)

    # body ribs. ONE box per rib spans the whole width and shows on BOTH side
    # faces, so eight visible ribs cost four boxes and neither ribbed face can
    # ever drift out of line with the other. Placed clear of the status rail at
    # y = 0 and clear of the leg tops at |y| = 1.48.
    for y in RIB_YS:
        mb.box((BODY + 0.14, 0.26, 0.90), (0, y, 1.97), "SteelDark")

    # motor housing fins, proud on both +X and -X for the same reason
    for y in (-0.60, -0.20, 0.20, 0.60):
        mb.box((HOUSE + 0.06, 0.10, 0.30), (0, y, 2.92), "Steel")

    # hazard collar where the column enters the body underside. Its top is
    # inside the body, so the ring and the body share no plane.
    mb.cylinder(0.70, 0.20, (0, 0, BODY_Z0), axis="Z", segments=12,
                role="Hazard")

    # the outlet slot, then the chute shelf and lip. The lip is WIDER than the
    # shelf and sits inside the shelf's height, so the two share no plane.
    _mouth(mb, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL, "Accent")
    mb.box((1.20, 0.24, 0.10), (0, -1.86, 0.27), "SteelDark")
    mb.box((1.34, 0.08, 0.06), (0, -1.96, 0.27), "Accent")

    # power inlet bracket under socket_power_in
    mb.box((0.28, 0.40, 0.40), (1.84, PWR_Y, 2.26), "Steel")

    # Status bezel and inlay go down BEFORE the chip, so OF_EmissiveState is
    # always the LAST material slot on every mesh (the renderer indexes it by
    # position). The chip stands proud of the inlay rather than flush with it.
    mb.box((0.10, 0.72, 0.36), (1.75, 0.0, STATUS_Z), "SteelDark")
    mb.box((0.06, 0.56, 0.24), (1.81, 0.0, STATUS_Z), "Steel")
    mb.box((0.05, 0.44, 0.16), (1.845, 0.0, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    """Hand-built. The read that must survive is the open gantry, so the legs
    stay and the surface detail goes; the slot survives as a block because a
    decimator would close it."""
    mb = of.MeshBuilder()
    _gantry(mb)
    _chute(mb)
    _shell(mb)
    _mouth_block(mb, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL)
    mb.box((0.05, 0.44, 0.16), (1.845, 0.0, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    """Three boxes. The gantry is gone at this range, so a squat base stands in
    for it; it is narrower than the body so the two share no plane."""
    mb = of.MeshBuilder()
    mb.box((3.20, 3.20, BODY_Z0), (0, 0, BODY_Z0 * 0.5), "SteelDark")
    mb.box((BODY, BODY, BODY_TOP - BODY_Z0),
           (0, 0, (BODY_Z0 + BODY_TOP) * 0.5), "Steel")
    mb.box((HOUSE, HOUSE, H - BODY_TOP), (0, 0, (BODY_TOP + H) * 0.5),
           "SteelDark")
    return mb, mb.build(NAME + "_LOD2", root)


def build_drill(mount):
    """The turning column, a child of the bob mount and a SIBLING of LOD0."""
    mb = of.MeshBuilder()
    mb.cylinder(COL_R, COL_H, (0, 0, COL_Z), axis="Z", segments=12, role="Steel")
    # Three flutes proud of the column. Without them a 12-gon cylinder spinning
    # about its own axis is indistinguishable from a static one.
    mb.ring_boxes((0.16, 0.16, COL_H - 0.16), COL_R - 0.02, 3, (0, 0, COL_Z),
                  "SteelDark")
    mb.cylinder(COL_R + 0.08, 0.16, (0, 0, COL_Z - COL_H * 0.5), axis="Z",
                segments=12, role="SteelDark")
    mb.frustum(COL_R + 0.02, 0.08, (COL_Z - COL_H * 0.5) - BIT_TIP_Z,
               (0, 0, (COL_Z - COL_H * 0.5 + BIT_TIP_Z) * 0.5), axis="Z",
               segments=8, role="Hazard")
    return mb, mb.build("Miner_Drill", mount)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mount = of.add_pivot("Miner_DrillMount", (0, 0, 0), root)
    mbd, drill = build_drill(mount)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_out", (0.0, -HALF, OUT_Z), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_power_in", (PWR_X, PWR_Y, PWR_Z), parent=root,
                  extras={"of_role": "power_in"})
    of.add_socket("socket_status", (HALF, 0.0, STATUS_Z), parent=root,
                  extras={"of_role": "state_light"})
    # socket_drill_tip stays ON THE ORIGIN in the tangent plane. That is not a
    # convenience: FactoryPorts.faceOf returns null for a socket at x = z = 0,
    # which is how this one is excluded from being a belt target STRUCTURALLY
    # rather than by matching its name.
    of.add_socket("socket_drill_tip", (0.0, 0.0, 0.0), parent=root,
                  extras={"of_role": "dig_vfx"})

    # Drill_Spin: 30 frames == MineFerrite.timeTicks, one full turn about Z.
    # Keyed in 120 degree steps: glTF stores rotation as a quaternion, so a
    # two-key 0 -> 360 curve would export as no rotation at all.
    of.add_clip(drill, "Drill_Spin", "rotation_euler",
                [(1, of.deg3(z=0)), (11, of.deg3(z=120)),
                 (21, of.deg3(z=240)), (31, of.deg3(z=360))])
    # Drill_Bob: the mount sinks and lifts back over 60 frames. The throw grew
    # with the machine, from 80 mm to 120 mm, so the motion stays visible at
    # the range a 4 m machine is actually looked at from.
    of.add_clip(mount, "Drill_Bob", "location",
                [(1, (0, 0, 0.0)), (31, (0, 0, -0.12)), (61, (0, 0, 0.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Miner_Drill", mbd)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
