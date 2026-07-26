"""
structure_common.py - the Tier-0 base-building module: the ONE set of numbers
every structural part is built from, and the socket conventions that make a
placement system pure arithmetic.

WHY A SHARED MODULE AND NOT FOUR INDEPENDENT SCRIPTS. A machine is allowed to
be whatever size it wants inside its cell; a structural part is not. Foundation,
floor, wall and door are a TILING SET, and a tiling set is only correct as a
whole: if the wall height and the deck thickness are typed separately into four
files, the storey pitch is a number nobody owns and it drifts the first time
somebody nudges a wall. So the module constants live here, once, and the four
build scripts import them.

THE MODULE (all whole or half metres, on the 1 m world grid; kVoxelSizeM = 1.0)

    plan cell      CELL      1.00 m      matches the voxel grid and the 1x1 machines
    deck thickness DECK_H    0.50 m      foundation, floor and ceiling are ONE thickness
    wall height    WALL_H    2.50 m      clear head height inside a storey
    wall thickness WALL_T    0.25 m      centred on the cell EDGE, so a wall is shared
    storey pitch   STOREY    3.00 m      = DECK_H + WALL_H, exact, so levels stack on
                                          a whole-metre lattice

The storey identity DECK_H + WALL_H == STOREY is the load-bearing one and it is
asserted at import time. A wall stands on a deck top, and its own top is exactly
the base plane of the next deck. Level N's deck base is therefore at
z = 3 N metres for every N, with no accumulated error and no per-level offset.

THE TWO ANCHORS. Structural parts do not all snap to the same thing, and
pretending they do is where a build system goes wrong:

    a DECK anchors to a CELL CENTRE   (floor(x) + 0.5, floor(z) + 0.5)
    a WALL anchors to a CELL EDGE MIDPOINT, and straddles it

Both still obey ASSET-SPECS 2.1 exactly: pivot centred in X/Y, base at Z = 0.
A wall is centred on its own origin across its 0.25 m thickness, so putting that
origin on the edge line is what makes one wall serve both cells it divides, and
what makes four walls close exactly around one foundation.

COLLINEAR PARTS TOUCH, PERPENDICULAR PARTS INTERPENETRATE. Two walls in a row
share the plane x = k exactly: zero gap, zero overlap, and no z-fighting,
because two opaque faces back to back are one culled and one occluded. Two walls
meeting at a right-angled corner necessarily share a WALL_T/2 square
(0.125 x 0.125 m) of volume. That is unavoidable for edge-centred walls of
finite thickness and it is invisible, because the shared volume is inside solid
geometry on both parts. Do not "fix" it by shortening the panels: that would
open a real gap between collinear walls, which IS visible.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402


# --- the module -----------------------------------------------------------
CELL = 1.00          # plan module, X and Y
HALF = CELL * 0.5
DECK_H = 0.50        # foundation / floor / ceiling thickness
WALL_H = 2.50        # wall height, deck top to next deck base
WALL_T = 0.25        # wall thickness, centred on the cell edge
STOREY = 3.00        # deck base to next deck base

assert abs(DECK_H + WALL_H - STOREY) < 1e-9, (
    "storey pitch broken: DECK_H + WALL_H must equal STOREY")
assert all(abs(v * 100 - round(v * 100)) < 1e-9
           for v in (CELL, DECK_H, WALL_H, WALL_T, STOREY)), (
    "module dimensions must be exact centimetres")

# Door opening. 0.76 m clear is wider than the 0.60 m player body (ASSET-SPECS
# 3.1) with 8 cm either side, and it is what a 1 m module can give once the
# jambs are thick enough to read as jambs at 1 m.
DOOR_W = 0.76        # clear opening width
DOOR_H = 2.10        # clear opening height above the deck
JAMB_W = (CELL - DOOR_W) * 0.5   # 0.12
HINGE_X = -DOOR_W * 0.5          # -0.38, the left jamb's inner face

# Facing angles for sockets, in degrees about +Z. A socket's local -Y is its
# facing (ASSET-SPECS 2.6), so a rotation of theta sends -Y to
# (sin theta, -cos theta): 0 is -Y, 180 is +Y, +90 is +X, -90 is -X.
FACE_S, FACE_N, FACE_E, FACE_W = 0.0, 180.0, 90.0, -90.0


def deck_sockets(root, top_z=DECK_H):
    """The five sockets every deck publishes.

    socket_top      the deck surface centre: where a stacked deck's origin goes
    socket_edge_*   the four edge midpoints ON the deck top, which is exactly
                    where a wall's origin goes. "Snap a wall to this foundation's
                    north edge" is then one getObjectByName and one assignment,
                    with no arithmetic in the placement code at all.
    """
    of.add_socket("socket_top", (0.0, 0.0, top_z), parent=root,
                  extras={"of_role": "deck_top"})
    for name, loc, face in (
            ("socket_edge_n", (0.0, HALF, top_z), FACE_N),
            ("socket_edge_e", (HALF, 0.0, top_z), FACE_E),
            ("socket_edge_s", (0.0, -HALF, top_z), FACE_S),
            ("socket_edge_w", (-HALF, 0.0, top_z), FACE_W)):
        of.add_socket(name, loc, rot=of.deg3(z=face), parent=root,
                      extras={"of_role": "wall_mount"})


def wall_sockets(root, top_z=WALL_H):
    """The three sockets every wall-family part publishes.

    socket_top      the wall head: the base plane of the deck above it
    socket_end_l/r  the two end faces, for collinear continuation. A wall run is
                    built by walking socket_end_r to the next wall's origin.
    """
    of.add_socket("socket_top", (0.0, 0.0, top_z), parent=root,
                  extras={"of_role": "wall_top"})
    of.add_socket("socket_end_l", (-HALF, 0.0, 0.0), rot=of.deg3(z=FACE_W),
                  parent=root, extras={"of_role": "wall_end"})
    of.add_socket("socket_end_r", (HALF, 0.0, 0.0), rot=of.deg3(z=FACE_E),
                  parent=root, extras={"of_role": "wall_end"})


def report_bounds(name, meshes):
    """Print the MEASURED world AABB of each mesh next to the module it claims
    to fill. The tiling promise in ASSET-SPECS 4.23 is arithmetic on these six
    numbers, so they are printed by the build rather than asserted in prose."""
    print("[structure] %s bounds (Blender x, y, z):" % name)
    for label, mb in meshes:
        lo, hi = mb.bounds()
        print("[structure]   %-22s x[%+.3f %+.3f] y[%+.3f %+.3f] z[%+.3f %+.3f]"
              "  size %.3f x %.3f x %.3f"
              % (label, lo[0], hi[0], lo[1], hi[1], lo[2], hi[2],
                 hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))
