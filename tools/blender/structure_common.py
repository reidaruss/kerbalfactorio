"""
structure_common.py - the Tier-0 base-building module: the ONE set of numbers
every structural part is built from, and the socket conventions that make a
placement system pure arithmetic.

WHY A SHARED MODULE AND NOT FIVE INDEPENDENT SCRIPTS. A machine is allowed to
be whatever size it wants inside its cell; a structural part is not. Foundation,
floor, wall, door and pillar are a TILING SET, and a tiling set is only correct
as a whole: if the wall height and the deck thickness are typed separately into
five files, the storey pitch is a number nobody owns and it drifts the first
time somebody nudges a wall. So the module constants live here, once, and the
build scripts import them.

THE MODULE, RESCALED 2026-07-26 (decision DW-32). The plan cell went from 1.00 m
to 4.00 m, and this is the whole re-derivation, because the interesting part is
what did NOT move:

    plan cell      CELL      4.00 m      was 1.00.  SCALED
    deck thickness DECK_H    0.50 m      UNCHANGED
    wall height    WALL_H    3.50 m      was 2.50.  RAISED, not scaled
    wall thickness WALL_T    0.25 m      UNCHANGED
    storey pitch   STOREY    4.00 m      was 3.00,  = DECK_H + WALL_H

ONLY THE PLAN MODULE SCALES. DECK_H and WALL_T are person-and-structure-scale
numbers: they are set by what a deck and a wall physically ARE, not by how wide
the bay is. Scaling them by four would have given a 2 m thick slab and a 1 m
thick partition, which is a bunker, not a base. A 4 x 4 x 0.50 m deck is an 8:1
slab, and 8:1 is what a real 4 m span looks like.

WALL_H RISES TO 3.50 for two reasons. A 4 m wide bay under a 2.5 m ceiling reads
squat: the room would be wider than it is tall by 1.6:1 in section, and every
interior would feel like a crawl space. And 3.50 is the number that makes the
new identity land:

    STOREY == CELL == 4.00

so the plan lattice and the vertical lattice are ONE number, and 4 is a whole
multiple of the 1 m voxel grid (kVoxelSizeM = 1.0). Level N's deck base is at
z = 4 N exactly, for every N, with no accumulated error and no per-level offset.
Both identities are asserted at import time, because they are the two facts the
whole set is balanced on.

THE TWO ANCHORS, UNCHANGED. Structural parts do not all snap to the same thing,
and pretending they do is where a build system goes wrong:

    a DECK anchors to a CELL CENTRE          (4 floor(x/4) + 2, 4 floor(z/4) + 2)
    a WALL anchors to a CELL EDGE MIDPOINT, and straddles it

Both still obey ASSET-SPECS 2.1 exactly: pivot centred in X/Y, base at Z = 0.
A wall is centred on its own origin across its 0.25 m thickness, so putting that
origin on the edge line is what makes one wall serve both cells it divides, and
what makes four walls close exactly around one foundation. The clear interior of
a one-cell room is now CELL - WALL_T = 3.75 m.

COLLINEAR PARTS TOUCH, PERPENDICULAR PARTS INTERPENETRATE. Two walls in a row
share the plane x = 4k exactly: zero gap, zero overlap, and no z-fighting,
because two opaque faces back to back are one culled and one occluded. Two walls
meeting at a right-angled corner necessarily share a WALL_T/2 square of volume.
That square is STILL 0.125 x 0.125 m, precisely because WALL_T did not scale, and
it is invisible, because the shared volume is inside solid geometry on both
parts. Do not "fix" it by shortening the panels: that would open a real gap
between collinear walls, which IS visible.

THE DOOR IS STILL ONE FULL CELL, and the OPENING DELIBERATELY DID NOT SCALE.
See build_door.py for the argument; the numbers are DOOR_W / DOOR_H below.

THE PILLAR IS NOT A PART, IT IS A RECIPE. DW-32 lets a foundation hang over a
drop on its neighbour's support, so the gap from an overhanging deck's underside
to the ground is a CONTINUOUS number, which no single mesh can span without
stretching its own foot and bracket. The PILLAR_* constants and pillar_parts()
below are that recipe, published here so the renderer and the client code
against one source instead of two. See build_pillar.py.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402


# --- the module -----------------------------------------------------------
CELL = 4.00          # plan module, X and Y
HALF = CELL * 0.5    # 2.00
DECK_H = 0.50        # foundation / floor / ceiling thickness
WALL_H = 3.50        # wall height, deck top to next deck base
WALL_T = 0.25        # wall thickness, centred on the cell edge
STOREY = 4.00        # deck base to next deck base

assert abs(DECK_H + WALL_H - STOREY) < 1e-9, (
    "storey pitch broken: DECK_H + WALL_H must equal STOREY")
# The DW-32 identity. Deleting this assert is a design decision, not a fix: it
# is what says the plan lattice and the vertical lattice are the same number,
# which is why a deck base lands on z = 4 N and a wall run on x = 4 k.
assert abs(STOREY - CELL) < 1e-9, (
    "DW-32 identity broken: STOREY must equal CELL")
assert all(abs(v * 100 - round(v * 100)) < 1e-9
           for v in (CELL, DECK_H, WALL_H, WALL_T, STOREY)), (
    "module dimensions must be exact centimetres")

# Door opening. 1.20 m clear is a double the 0.60 m player body (ASSET-SPECS
# 3.1), which is what an industrial doorway carrying equipment wants, and it is
# NOT four times the old 0.76: the module scaled and the opening did not. 2.40 m
# clear head height is a person-scale number for the same reason DECK_H is.
DOOR_W = 1.20        # clear opening width
DOOR_H = 2.40        # clear opening height above the deck
JAMB_W = (CELL - DOOR_W) * 0.5   # 1.40, which is a lot of panel: see build_door
HINGE_X = -DOOR_W * 0.5          # -0.60, the left jamb's inner face

# --- the pillar recipe ----------------------------------------------------
# Published as named constants so nothing downstream re-derives them. A pillar
# is assembled from four ground-pivoted parts that all sit on the file origin in
# pillar.glb; only the SHAFT is ever scaled, and only in its own axis.
PILLAR_FOOT_H = 0.40             # splayed base plate, sits on the ground
PILLAR_SHAFT_LEN = 1.00          # authored length, so scale.y IS metres
PILLAR_COLLAR_H = 0.24           # band height, NEVER scaled
PILLAR_HEAD_H = 0.30             # bracket meeting the foundation underside
PILLAR_MIN_H = PILLAR_FOOT_H + PILLAR_HEAD_H     # 0.70; below this, no pillar
PILLAR_COLLAR_PITCH = 2.00       # one collar every 2 m of shaft
PILLAR_COLLAR_CLEAR = 0.35       # drop a collar within this of either shaft end


def pillar_collars(gap):
    """Collar BASE heights above the ground, for a pillar spanning `gap` metres.

    The collars are the whole reason the shaft can be a featureless prism: they
    put the rhythm back that scaling took out, and because they are placed at a
    fixed PITCH rather than at a fraction of the length, a 3 m pillar and a 9 m
    pillar have collars at the same absolute spacing and read as the same part.

    A collar is dropped when it would land within PILLAR_COLLAR_CLEAR of either
    end of the shaft, because a band crowding the foot or the bracket reads as a
    mistake rather than as rhythm. The clearance is measured against the collar's
    own extent, not its base, which is why PILLAR_COLLAR_H appears here."""
    lo = PILLAR_FOOT_H + PILLAR_COLLAR_CLEAR
    hi = gap - PILLAR_HEAD_H - PILLAR_COLLAR_CLEAR - PILLAR_COLLAR_H
    out = []
    k = 1
    while True:
        z = PILLAR_FOOT_H + PILLAR_COLLAR_PITCH * k
        if z > hi:
            return out
        if z >= lo:
            out.append(z)
        k += 1


def pillar_parts(gap):
    """The full assembly for a gap of `gap` metres, ground at z = 0.

    Returns [(part_stem, z, scale_z), ...], empty when the deck is close enough
    to the ground that no pillar is wanted. `scale_z` is 1.0 for everything
    except the shaft, whose scale IS its length in metres because the part is
    authored at exactly PILLAR_SHAFT_LEN.

    This is THE recipe. The renderer calls it, the client should call the same
    arithmetic, and neither should ever type 0.40 or 0.30 again."""
    if gap < PILLAR_MIN_H:
        return []
    out = [("PillarFoot", 0.0, 1.0),
           ("PillarShaft", PILLAR_FOOT_H, gap - PILLAR_MIN_H)]
    out += [("PillarCollar", z, 1.0) for z in pillar_collars(gap)]
    out.append(("PillarHead", gap - PILLAR_HEAD_H, 1.0))
    return out


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
                    with no arithmetic in the placement code at all. They moved
                    from +/-0.50 to +/-2.00 with the module, and the MEANING is
                    what the placement code binds to, so nothing downstream
                    changes.
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

    socket_top      the wall head: the base plane of the deck above it, now at
                    3.50, so socket_top + DECK_H lands on the next storey at 4.00
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
