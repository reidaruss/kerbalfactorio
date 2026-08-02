"""
build_smelter.py - Smelter, TypeId 0x12 (of::gameplay::types::Smelter).

    blender --background --python tools/blender/build_smelter.py

Produces assets/models/dist/machines/smelter.glb.

Footprint 4 x 4 m, height 3.60 m. It shipped at 2 x 2 x 2.6, which is Factorio
scale, and it was the last machine still at the old baseline: the assembler is
8 m (FS-57), the storage box is 4 m (FS-68) and `FactoryKinds.FOOTPRINT`
already reads `smelter: 4`. The asset was the lagging half of that number.

WHY 3.60 m AND NOT 3.00 LIKE THE BOX. The housing itself tops out at 3.12,
which is the box's 3.00 plus a roof rim, because a kiln and a container of the
same footprint should have the same shoulder height. The last 0.48 m is the
CHIMNEY, and a chimney that does not clear its own roof is a pipe. So the
family reads box 3.00 < smelter 3.60 < assembler 4.00 by height while the
smelter's HOUSING is exactly the box's size, which is the honest description of
what this machine is: a 4 m box with a stack on it.

WHY THE BODY WAS REDRAWN AND NOT JUST SCALED, which is FS-57's and FS-68's
argument repeated once more. The old smelter was a 2 m kiln: corner bricks
0.22 m square, two jacket bands, a 0.44 m chimney, a hopper stuck on the +Y
face. Scale all of that by two and the bands stop being structural, because a
band's thickness only reads as a stiffener while the panel it stiffens is a
few band-widths across. So this is the box's body language at the box's size:
a low plinth flush to the footprint edge, refractory corner posts, ribs that
show on both side faces, a collar, a rimmed roof pan, and the stack.

THE SLOTS ARE THE POINT, exactly as they are on the box and the assembler.
Each item port is a recessed mouth in the housing face: two jambs, a head, a
sill, a dark throat plate set back from the outer plane, and a painted band
across the head and the sill. A belt terminating at one visibly runs INTO a
hole rather than stopping near a wall.

THE PORT HEIGHTS ARE UNCHANGED AND THAT IS THE WHOLE CONTRACT (FS-57).
socket_item_in stays at z = 0.90 and socket_item_out at z = 0.45, exactly
where build_box.py and build_assembler.py put their own. Every machine in the
game presents item ports at the same two heights, so one belt deck at 0.25 m
reaches all of them and FactoryPorts' rise is a per-role constant instead of a
per-asset one. Only the horizontal offset moved, from 1.00 m to HALF = 2.00 m.

THE FOOTPRINT STAYS AN EVEN WHOLE NUMBER OF METRES and that is not taste.
Machines snap on a 1 m site grid and FactorySnap.stepsFor steps a new part
ceil((fpA + fpB) / 2) cells away, so an even footprint keeps exactly the
half-cell residual PORT_MATE_M (0.65 m) was derived against. An odd footprint
lands on the other side of the rounding and moves the bound for every machine
in the game, not just this one.

WHY THE PLINTH IS NOTCHED UNDER THE OUTLET, which is the one place this file
departs from build_box.py. socket_item_out is at z = 0.45 and its slot's sill
therefore reaches the ground, so the painted band on that sill wants the same
outer plane (y = -HALF) that the plinth's own front face already occupies.
HALF is a hard edge, so the paint cannot move outward; the STEEL has to move
inward instead. Measured on the shipped bytes, build_box.py and
build_assembler.py both still lose that argument: their outlet sill bands are
coplanar with their plinths and the depth test picks a winner per pixel. Here
the plinth is three boxes instead of one and simply is not there across the
outlet's width, which also means a belt deck at 0.25 m can run right up to the
face instead of butting into 0.30 m of skirt. The plinth still alone sets the
4 x 4 footprint: its two outer strips hold all four corners.

MATERIALS ARE FIVE AND THAT DECIDED THE BAND COLOUR. The set is SteelDark,
Steel, Accent, Rock and EmissiveState. Rock is the refractory brick at the
corners, which is this machine's one non-steel read and the thing that tells
it apart from the box at 40 m, so it keeps its slot; the painted bands are
therefore Accent rather than the Hazard yellow the box and the assembler use.
Accent also carries the keep-out ring above the plinth and the chute lip, so
one colour means one thing here: this is where the machine hands you something.

Combustion machine (ASSET-SPECS 2.3): VisualState 1 "working" overrides to
fire orange #FF7A1E at intensity 2.2 rather than the standard green. Idle,
blocked and no-power stay standard so the scanning rule still holds.

HALF IS A HARD EDGE. No LOD0 geometry crosses it in any axis in the tangent
plane, which is what makes the exported bounding box exactly 4 x 4 and the
grid-footprint check exact rather than approximate.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Smelter"
OUT = of.dist_path("machines", "smelter.glb")

W = D = 4.00
H = 3.60
HALF = 2.00                     # the hard edge nothing in LOD0 may cross

PLINTH_H = 0.30
BODY = 3.40
BODY_HALF = BODY * 0.5          # 1.70
BODY_Z0 = 0.24                  # the body's foot is BURIED in the plinth, so
                                # its underside shares no plane with the skirt's
BODY_TOP = 2.60
COLLAR = 3.86
COLLAR_TOP = 2.76
DECK = 3.30
DECK_TOP = 2.92                 # the roof PAN; the rim above it reaches 3.12
RIM_T = 0.16
RIM_TOP = 3.12                  # the housing's own top; the stack carries the H
SKIRT_H = 0.06                  # the painted keep-out ring above the plinth

MOUTH_D = HALF - BODY_HALF      # 0.30, the gap the slot frames live in
BAND_D = 0.06                   # painted band thickness, flush with the edge
FRAME_D = MOUTH_D - BAND_D      # 0.24: the frame stops SHORT of the edge, so
                                # the band is a raised strip and not a decal
                                # fighting the steel for the same pixels.

IN_Z = 0.90                     # FS-57's item_in height, unchanged
OUT_Z = 0.45                    # FS-57's item_out height, unchanged
STATUS_Z = 1.90
DOOR_Z = 1.70                   # firebox centre, ABOVE the outlet slot's head

# Intake slot. The sill is short (0.18) on purpose: it puts the slot's bottom
# edge at 0.37, clear of the painted skirt at 0.30 to 0.36, so the intake's
# band never shares the plinth's or the skirt's outer plane.
IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL = 1.40, 0.70, 0.50, 0.30, 0.18
# Outlet slot. Its sill reaches the ground, which is why the plinth is notched.
OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL = 1.40, 0.50, 0.50, 0.30, 0.20
SLOT_HALF = OUT_W * 0.5 + OUT_JAMB      # 1.20, and the notch's half-width
NOTCH_Y = 1.66                  # the notched plinth's -Y edge. It is INSIDE the
                                # body face at 1.70 rather than on it, so the
                                # plinth's front face is buried in the body
                                # instead of being coplanar with it.

CHIM_R = 0.34
CHIM_Y = 1.00                   # offset toward the BACK, which is what tells a
                                # player at 40 m which way the machine faces
CHIM_Z0 = 2.86                  # the stack's foot, sunk INTO the roof pan
CAP_Z0 = 3.54

POST = 0.36
POST_C = BODY_HALF + 0.02       # 1.72, so a brick post is proud of the body
POST_Z0 = 0.20                  # inside the plinth, and not on the body's foot
POST_TOP = 2.66                 # inside the collar, and not on the body's top
CORNERS = [(sx * POST_C, sy * POST_C) for sx in (-1, 1) for sy in (-1, 1)]

# Power inlet: the body's upper +X shoulder, NOT a top corner. The corners are
# the brick posts and the roof is the stack's, so a nub at either would either
# vanish inside the brick or interpenetrate the roof rim.
PWR_X, PWR_Y, PWR_Z = 1.98, 1.10, 3.02

RIB_YS = (-1.35, -0.90, 0.90, 1.35)


def _mouth(mb, sign, z_c, open_w, open_h, jamb, head_h, sill_h, band_role):
    """A recessed port slot in the +Y (sign 1) or -Y (sign -1) face.

    Two jambs, a head and a sill fill the first 0.24 m of the step between the
    body face and the footprint edge, leaving a hole `open_w` by `open_h`
    centred on `z_c`; the painted band fills the last 0.06 m across the head and
    the sill, so the slot is legible as a port from across the base. A dark
    throat plate stands proud of the body face so the hole has a visible
    bottom."""
    z0 = z_c - open_h * 0.5
    z1 = z_c + open_h * 0.5
    lo, hi = z0 - sill_h, z1 + head_h
    outer_w = open_w + 2.0 * jamb
    jamb_c = (open_w + jamb) * 0.5
    y_frame = sign * (BODY_HALF + FRAME_D * 0.5)    # 1.82, the frame's middle
    y_throat = sign * (BODY_HALF + 0.05)            # 1.75, proud of the body
    y_band = sign * (HALF - BAND_D * 0.5)           # 1.97, flush with the edge

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


def _mouth_block(mb, sign, z_c, open_w, open_h, jamb, head_h, sill_h):
    """The same slot at LOD1: one filled frame block plus a dark inset, so the
    port is still where it was and still reads dark, at two boxes instead of
    seven. A decimator cannot do this to a slot; it closes the hole."""
    lo = z_c - open_h * 0.5 - sill_h
    hi = z_c + open_h * 0.5 + head_h
    outer_w = open_w + 2.0 * jamb
    mb.box((outer_w, MOUTH_D, hi - lo),
           (0, sign * (HALF - MOUTH_D * 0.5), (lo + hi) * 0.5), "Steel")
    mb.box((open_w, 0.10, open_h), (0, sign * (HALF - 0.06), z_c), "SteelDark")


def _plinth(mb):
    """The footprint, in three boxes rather than one.

    The main slab runs from the notch line back to +HALF; two strips carry it
    out to -HALF on either side of the outlet, so all four corners are held and
    the exported bounding box is exactly 4 x 4. What is deliberately ABSENT is
    the strip directly under socket_item_out: see the module docstring."""
    mb.box((W, HALF + NOTCH_Y, PLINTH_H),
           (0, (HALF - NOTCH_Y) * 0.5, PLINTH_H * 0.5), "SteelDark")
    for s in (-1, 1):
        mb.box((HALF - SLOT_HALF, HALF - NOTCH_Y, PLINTH_H),
               (s * (HALF + SLOT_HALF) * 0.5, -(HALF + NOTCH_Y) * 0.5,
                PLINTH_H * 0.5), "SteelDark")


def _shell(mb):
    """Plinth, body, collar and roof pan: the stepped silhouette every LOD
    keeps. The plinth alone sets the 4 x 4 footprint, so no detail part has to
    be trimmed to hold the cell edge."""
    _plinth(mb)
    mb.box((BODY, BODY, BODY_TOP - BODY_Z0),
           (0, 0, (BODY_Z0 + BODY_TOP) * 0.5), "Steel")
    mb.box((COLLAR, COLLAR, COLLAR_TOP - BODY_TOP),
           (0, 0, (BODY_TOP + COLLAR_TOP) * 0.5), "SteelDark")
    mb.box((DECK, DECK, DECK_TOP - COLLAR_TOP),
           (0, 0, (COLLAR_TOP + DECK_TOP) * 0.5), "Steel")


def _posts(mb):
    """Refractory brick corner posts: this machine's one non-steel read.

    They start inside the plinth and stop inside the collar, so neither end
    leaves a face coplanar with a face of the shell. The old 2 m smelter set
    them FLUSH with the body face at BODY_HALF, which put brick and steel on
    exactly one plane over the whole height of the machine; measured on the
    shipped bytes that was 24 overlapping coplanar pairs, and it is why they
    are 0.02 proud here."""
    for cx, cy in CORNERS:
        mb.box((POST, POST, POST_TOP - POST_Z0),
               (cx, cy, (POST_Z0 + POST_TOP) * 0.5), "Rock")


def build_lod0(root):
    mb = of.MeshBuilder()
    _shell(mb)

    # painted keep-out ring: the band of plinth left proud of the body. It sits
    # entirely ABOVE the plinth top rather than straddling it, so its side faces
    # never overlap the plinth's own on the footprint plane. It is also why the
    # intake slot's sill stops at 0.37 and not lower.
    mb.box((W, D, SKIRT_H), (0, 0, PLINTH_H + SKIRT_H * 0.5), "Accent")
    _posts(mb)

    # body ribs. ONE box per rib spans the whole width and shows on BOTH side
    # faces, so eight visible ribs cost four boxes and neither ribbed face can
    # ever drift out of line with the other. They are placed clear of the
    # status rail at y = 0 and clear of the brick posts at |y| = 1.54.
    for y in RIB_YS:
        mb.box((BODY + 0.14, 0.28, 2.10), (0, y, 1.45), "SteelDark")

    # roof rim: the lip that carries the HOUSING to 3.12, which is why nothing
    # on the pan itself has to reach that height and z-fight the deck. It is
    # 0.03 wider than the pan on each side, so the pan's own edge face is
    # covered rather than coplanar with it.
    rim_c = DECK * 0.5 - 0.05
    for s in (-1, 1):
        mb.box((DECK + 0.06, RIM_T, RIM_TOP - DECK_TOP),
               (0, s * rim_c, (DECK_TOP + RIM_TOP) * 0.5), "SteelDark")
        mb.box((RIM_T, DECK + 0.06, RIM_TOP - DECK_TOP),
               (s * rim_c, 0, (DECK_TOP + RIM_TOP) * 0.5), "SteelDark")

    # the two item slots: intake on +Y at 0.90, output on -Y at 0.45.
    _mouth(mb, 1, IN_Z, IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL, "Accent")
    _mouth(mb, -1, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL, "Accent")

    # output chute: a shelf inside the recess and a lip that reaches the cell
    # edge, so the outlet hands items DOWN rather than merely being a hole. The
    # lip is WIDER than the shelf and sits inside the shelf's height, so the two
    # share no plane at all.
    mb.box((1.30, 0.24, 0.10), (0, -1.86, 0.25), "SteelDark")
    mb.box((1.44, 0.08, 0.06), (0, -1.96, 0.25), "Accent")

    # power inlet nub on the +X shoulder, under socket_power_in
    mb.box((0.28, 0.40, 0.44), (1.84, PWR_Y, 2.80), "Steel")

    # chimney: collar, stack and cap. The stack's foot is sunk 0.06 into the
    # roof pan and its head 0.04 into the cap, so neither end of the Steel tube
    # shares a plane with the SteelDark it meets.
    mb.cylinder(CHIM_R + 0.12, 0.14, (0, CHIM_Y, DECK_TOP + 0.07), axis="Z",
                segments=8, role="SteelDark")
    mb.cylinder(CHIM_R, (CAP_Z0 + 0.04) - CHIM_Z0,
                (0, CHIM_Y, (CHIM_Z0 + CAP_Z0 + 0.04) * 0.5), axis="Z",
                segments=12, role="Steel")
    mb.cylinder(CHIM_R + 0.10, H - CAP_Z0, (0, CHIM_Y, (CAP_Z0 + H) * 0.5),
                axis="Z", segments=8, role="SteelDark")

    # Firebox surround and status bezel go down BEFORE the emissive parts, so
    # OF_EmissiveState is always the LAST material slot on every mesh (the
    # renderer indexes it by position).
    mb.box((1.90, 0.08, 1.16), (0, -1.74, DOOR_Z), "SteelDark")
    mb.box((0.10, 0.72, 0.40), (1.75, 0.0, STATUS_Z), "Steel")
    mb.box((0.06, 0.56, 0.26), (1.81, 0.0, STATUS_Z), "SteelDark")

    # --- state surfaces: the firebox door and the +X status chip ---
    # Both stand PROUD of the bezel behind them rather than flush with it. The
    # 2 m smelter had its door at exactly the surround's outer plane, which is
    # the same coplanar-paint defect the slot bands were fixed for.
    mb.box((1.60, 0.08, 0.86), (0, -1.80, DOOR_Z), "EmissiveState")
    mb.box((0.05, 0.44, 0.18), (1.845, 0.0, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _shell(mb)
    _posts(mb)
    _mouth_block(mb, 1, IN_Z, IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL)
    _mouth_block(mb, -1, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL)
    # the stack as one square tube, foot sunk into the pan as at LOD0
    mb.box((CHIM_R * 2, CHIM_R * 2, H - CHIM_Z0),
           (0, CHIM_Y, (CHIM_Z0 + H) * 0.5), "Steel")
    mb.box((0.05, 0.44, 0.18), (1.845, 0.0, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    """Four boxes. The silhouette that has to survive is plinth, body, roof and
    an offset stack, because that offset is the facing cue."""
    mb = of.MeshBuilder()
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "SteelDark")
    mb.box((BODY, BODY, COLLAR_TOP - PLINTH_H),
           (0, 0, (PLINTH_H + COLLAR_TOP) * 0.5), "Steel")
    mb.box((DECK, DECK, RIM_TOP - COLLAR_TOP),
           (0, 0, (COLLAR_TOP + RIM_TOP) * 0.5), "SteelDark")
    mb.box((CHIM_R * 2, CHIM_R * 2, H - RIM_TOP),
           (0, CHIM_Y, (RIM_TOP + H) * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_glow(root):
    """The glow card in front of the firebox door. Built centred on its OWN
    origin so the scale clip pulses it in place instead of sliding it toward
    0,0,0. It is a sibling of _LOD0, so its growth cannot enlarge the LOD0
    bounding box the footprint check reads."""
    mb = of.MeshBuilder()
    mb.box((1.40, 0.02, 0.70), (0, 0, 0), "EmissiveState")
    obj = mb.build("Smelter_Glow", root)
    obj.location = (0.0, -1.86, DOOR_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbg, glow = build_glow(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_in", (0.0, HALF, IN_Z), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -HALF, OUT_Z), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_power_in", (PWR_X, PWR_Y, PWR_Z), parent=root,
                  extras={"of_role": "power_in"})
    of.add_socket("socket_smoke", (0.0, CHIM_Y, H), parent=root,
                  extras={"of_role": "smoke"})
    of.add_socket("socket_status", (HALF, 0.0, STATUS_Z), parent=root,
                  extras={"of_role": "state_light"})

    # Furnace_Glow: 60 frames == SmeltFerrite.timeTicks.
    # Preferred at runtime: drive emissiveIntensity from AnimPhase and drop the
    # clip entirely. It ships so the asset is complete without shader work.
    of.add_clip(glow, "Furnace_Glow", "scale",
                [(1, (1.0, 1.0, 1.0)), (31, (1.08, 1.0, 1.08)),
                 (61, (1.0, 1.0, 1.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Smelter_Glow", mbg)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
