"""
build_box.py - Storage container, TypeId 0x14 (of::gameplay::types::Box).

    blender --background --python tools/blender/build_box.py

Produces assets/models/dist/machines/box.glb.

Footprint 4 x 4 m, height 3.0 m: ONE structural module square (DW-32 puts the
module at 4 m) and half the assembler. It used to be a 1 m crate, which is
Factorio scale and was the smallest thing in a machine set whose largest member
is now an 8 m assembler.

WHY THE BODY WAS REDRAWN AND NOT JUST SCALED, which is FS-57's argument
repeated. The old box was a shipping crate: four corner posts, three banded
sides, a hinged lid and a narrow fill bar. At 1 m that reads as a crate a
player picks up; at 4 m the identical parts read as a pallet, because a band's
thickness stops being structural once the panel it stiffens is four times
wider. So this is a Satisfactory-style storage container instead: a low plinth
flush to the footprint edge, a ribbed body with corner posts, a rimmed roof pan
with the hatch recessed into it, and a full-width inspection window on the
front so the thing looks like it HOLDS something rather than like it is one.

THE SLOTS ARE THE POINT, exactly as they are on the assembler. Each item port
is a recessed mouth in the housing face: two jambs, a head, a sill, a dark
throat plate set back from the outer plane, and a painted band across the head
and the sill. A belt terminating at one visibly runs INTO a hole rather than
stopping near a wall. The output face adds a chute shelf and a lip at the
footprint edge, because an outlet that hands items DOWN onto a belt is a
different physical claim from an inlet that swallows them.

THE PORT HEIGHTS ARE THE SMELTER'S, DELIBERATELY. socket_item_in sits at
z = 0.90 and socket_item_out at z = 0.45, exactly where build_smelter.py and
build_assembler.py put their own. Every machine in the game therefore presents
item ports at the same two heights, so one belt deck at 0.25 m reaches all of
them and FactoryPorts' rise is a per-role constant instead of a per-asset one.

THE FOOTPRINT STAYS AN EVEN WHOLE NUMBER OF METRES and that is not taste.
Machines snap on a 1 m site grid and FactorySnap.stepsFor steps a new part
ceil((fpA + fpB) / 2) cells away, so an even footprint keeps exactly the
half-cell residual PORT_MATE_M (0.65 m) was derived against. An odd footprint
lands on the other side of the rounding and moves the bound for every machine
in the game, not just this one.

The hatch is still a sibling of _LOD0 rather than a child, so LOD0's bounding
box stays exactly 4 x 4 x 3 while the lid is free to swing above the roof pan.
Its clip is unchanged in name, length and direction: Box_Lid, 15 frames,
negative X so the FRONT edge lifts and the player can see in.

The status chip on the front rail carries the standard four VisualState
colours. The fill-level READOUT the 1 m crate's docstring promised (bar length
driven from the buffer) is not authored here and never was: the chip lives
inside the LOD0 mesh, so nothing can scale it independently. It wants its own
sibling object the day /core grows a container entity to read a level from.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "Box"
OUT = of.dist_path("machines", "box.glb")

W = D = 4.00
H = 3.00
HALF = 2.00                     # the hard edge nothing in LOD0 may cross

PLINTH_H = 0.30
BODY = 3.40
BODY_HALF = BODY * 0.5          # 1.70
BODY_TOP = 2.55
COLLAR = 3.70
COLLAR_TOP = 2.75
DECK = 3.50
DECK_TOP = 2.95                 # the roof PAN; the rim above it reaches H
MOUTH_D = HALF - BODY_HALF      # 0.30, the gap the slot frames live in
BAND_D = 0.06                   # painted band thickness, flush with the edge
FRAME_D = MOUTH_D - BAND_D      # 0.24: the frame stops SHORT of the edge.
# build_assembler.py gives its frames the full step depth AND puts its bands at
# the same outer plane, so the band's front face and the head's front face are
# exactly coplanar and z-fight; measured here, the steel wins and the paint
# disappears. Stopping the frame one band-thickness short makes the band a real
# raised strip instead of a decal fighting for the same pixels.

IN_Z = 0.90                     # smelter's socket_item_in height
OUT_Z = 0.45                    # smelter's socket_item_out height
STATUS_Z = 2.30

HINGE_Y = 0.85                  # hatch hinge, on the BACK edge of the pan
LID_Z = 2.84                    # lid top at 2.96, proud of the pan, under H

POST = 0.36
POST_Z0 = PLINTH_H - 0.10       # 0.20, so the post's foot is inside the plinth
POST_C = BODY_HALF + 0.02       # 1.72, so a post is proud of the body face
CORNERS = [(sx * POST_C, sy * POST_C) for sx in (-1, 1) for sy in (-1, 1)]


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


def _shell(mb):
    """Plinth, body, collar and roof pan: the stepped silhouette every LOD
    keeps. The plinth alone sets the 4 x 4 footprint, so no detail part has to
    be trimmed to hold the cell edge."""
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "SteelDark")
    mb.box((BODY, BODY, BODY_TOP - PLINTH_H),
           (0, 0, (PLINTH_H + BODY_TOP) * 0.5), "Steel")
    mb.box((COLLAR, COLLAR, COLLAR_TOP - BODY_TOP),
           (0, 0, (BODY_TOP + COLLAR_TOP) * 0.5), "SteelDark")
    mb.box((DECK, DECK, DECK_TOP - COLLAR_TOP),
           (0, 0, (COLLAR_TOP + DECK_TOP) * 0.5), "Steel")


def _posts(mb):
    """Corner posts, buried in the plinth at the bottom and covered by the
    collar overhang at the top, so neither end leaves a face coplanar with a
    visible face of the shell. They are what frames the two slots and stops a
    3.40 m panel reading as a sheet."""
    for cx, cy in CORNERS:
        mb.box((POST, POST, BODY_TOP - POST_Z0), (cx, cy, (POST_Z0 + BODY_TOP) * 0.5),
               "SteelDark")


def build_lod0(root):
    mb = of.MeshBuilder()
    _shell(mb)

    # hazard skirt: the ring of plinth left proud of the body, painted. It sits
    # entirely ABOVE the plinth top rather than straddling it, so its side faces
    # never share a plane with the plinth's own.
    mb.box((W, D, 0.06), (0, 0, PLINTH_H + 0.03), "Hazard")
    _posts(mb)

    # body ribs. ONE box per rib spans the whole width and shows on BOTH side
    # faces, so eight visible ribs cost four boxes and neither ribbed face can
    # ever drift out of line with the other.
    for y in (-1.20, -0.40, 0.40, 1.20):
        mb.box((BODY + 0.14, 0.26, 2.15), (0, y, 1.375), "SteelDark")

    # roof rim: the lip that carries the housing to its full 3.00 m, which is
    # why nothing on the pan itself has to reach the top and z-fight the deck.
    # It is 0.03 wider than the pan on each side, so the pan's own edge face is
    # covered rather than coplanar with it.
    rim_c = DECK * 0.5 - 0.05
    for s in (-1, 1):
        mb.box((DECK + 0.06, 0.16, H - COLLAR_TOP),
               (0, s * rim_c, (COLLAR_TOP + H) * 0.5), "SteelDark")
        mb.box((0.16, DECK + 0.06, H - COLLAR_TOP),
               (s * rim_c, 0, (COLLAR_TOP + H) * 0.5), "SteelDark")
    # hatch hinge lugs, on the back edge of the pan under the lid
    for sx in (-1, 1):
        mb.box((0.24, 0.20, 0.10), (sx * 0.55, HINGE_Y + 0.03, 2.92), "SteelDark")

    # the two item slots: intake on +Y at the smelter's inlet height, output on
    # -Y at its outlet height.
    _mouth(mb, 1, IN_Z, 1.40, 0.70, 0.50, 0.35, 0.35, "Hazard")
    _mouth(mb, -1, OUT_Z, 1.40, 0.50, 0.50, 0.30, 0.20, "Accent")

    # output chute: a shelf inside the recess and a lip flush with the cell
    # edge, so the outlet hands items DOWN rather than merely being a hole.
    mb.box((1.30, 0.22, 0.08), (0, -1.85, 0.24), "SteelDark")
    mb.box((1.40, 0.08, 0.06), (0, -1.96, 0.27), "Accent")
    # placard over the intake, so the back face is not a blank panel
    mb.box((1.20, 0.06, 0.24), (0, 1.75, 2.00), "Accent")

    # inspection window: what makes this read as a container and not a housing
    mb.box((2.60, 0.10, 1.00), (0, -1.72, 1.55), "SteelDark")
    mb.box((2.30, 0.06, 0.76), (0, -1.78, 1.55), "Glass")
    for sx in (-1, 1):
        mb.box((0.10, 0.12, 1.00), (sx * 0.78, -1.79, 1.55), "SteelDark")

    # front status rail. Bezel and inlay before the chip: OF_EmissiveState has
    # to stay the LAST material slot on every mesh.
    mb.box((2.80, 0.12, 0.34), (0, -1.74, STATUS_Z), "Steel")
    mb.box((2.50, 0.06, 0.22), (0, -1.79, STATUS_Z), "SteelDark")
    mb.box((2.20, 0.05, 0.16), (0, -1.815, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _shell(mb)
    _posts(mb)
    _mouth_block(mb, 1, IN_Z, 1.40, 0.70, 0.50, 0.35, 0.35)
    _mouth_block(mb, -1, OUT_Z, 1.40, 0.50, 0.50, 0.30, 0.20)
    mb.box((2.30, 0.06, 0.76), (0, -1.78, 1.55), "Glass")
    mb.box((2.20, 0.05, 0.16), (0, -1.815, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "SteelDark")
    mb.box((BODY, BODY, COLLAR_TOP - PLINTH_H),
           (0, 0, (PLINTH_H + COLLAR_TOP) * 0.5), "Steel")
    mb.box((DECK, DECK, H - COLLAR_TOP), (0, 0, (COLLAR_TOP + H) * 0.5),
           "SteelDark")
    return mb, mb.build(NAME + "_LOD2", root)


def build_lid(root):
    """Hinged on the BACK edge. Geometry is authored relative to the hinge so
    the clip is a plain rotation about the object's own X axis."""
    mb = of.MeshBuilder()
    mb.box((1.70, 1.70, 0.12), (0, -0.85, 0.06), "Steel")
    mb.box((0.40, 0.10, 0.07), (0, -1.62, 0.155), "Accent")
    obj = mb.build("Box_Lid", root)
    obj.location = (0.0, HINGE_Y, LID_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbl, lid = build_lid(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_in", (0.0, HALF, IN_Z), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -HALF, OUT_Z), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_status", (0.0, -HALF, STATUS_Z), parent=root,
                  extras={"of_role": "state_light"})

    # Box_Lid: one-shot open over 15 frames, played with a negative timeScale
    # to close. Negative X so the FRONT edge lifts and the player can see in.
    of.add_clip(lid, "Box_Lid", "rotation_euler",
                [(1, of.deg3(x=0)), (8, of.deg3(x=-40)), (15, of.deg3(x=-72))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Box_Lid", mbl)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
