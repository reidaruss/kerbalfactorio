"""
build_foundation.py - Tier-0 structural foundation.

    blender --background --python tools/blender/build_foundation.py

Produces assets/models/dist/structures/foundation.glb.

Footprint 4 x 4 m, height 0.50 m (structure_common.DECK_H). The ground-contact
deck: the thing a player levels terrain for and builds a base on top of.

RESCALED 2026-07-26 (DW-32). The plan module went 1.00 -> 4.00 m and DECK_H did
NOT move, so this part went from a 2:1 pad to an 8:1 slab. That is the correct
answer rather than a compromise: a 4 m span carried on half a metre of deck is
what a real slab looks like, and scaling the thickness with the plan would have
given a 2 m plinth that reads as a bunker foundation for a shed.

READ. A poured stone pad on a stepped footing, edged with a steel kerb. The
kerb is not decoration: it is what makes the tile boundary legible, so a
20 x 20 m platform reads as a grid of five placed modules rather than as one
grey sheet, and a player can see where the next foundation goes without a ghost.

WHAT THE FOUR-METRE CELL CHANGED. The kerb had to get wider, because 0.11 m of
edge on a 4 m tile is 2.7 percent of the module and disappears at the distance
the kerb exists to work at; 0.34 m holds the same 8-ish percent the 1 m tile
had. And a 4 x 4 m field of flat stone is a big empty rectangle, so the deck
carries a steel CROSS on the cell centrelines, splitting it into four 1.7 m
quadrants. That cross is the same "recessed field inside a frame" language the
wall panel uses, it lands on the 2 m half-cell so a platform shows a regular
sub-grid, and it is what gives the eye something to measure 4 m against.

TILING. The footing and the body are inset; only the kerb and the cross reach
the full 4.00 m, so two neighbours meet on the kerb line and show a shallow
reveal below it. That reveal is free (the inset geometry was going to be there
anyway) and it is what stops a large pad from looking like a single extruded
box. The stone field sits 0.02 m below the kerb top, so the module height is set
by the steel and by nothing else.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import structure_common as sc  # noqa: E402

NAME = "Foundation"
OUT = of.dist_path("structures", "foundation.glb")

W = D = sc.CELL
H = sc.DECK_H

FOOTING_H = 0.12                 # z 0.00 .. 0.12
BODY_Z0, BODY_Z1 = 0.10, 0.38    # overlaps the footing by 0.02, never touches
DECK_Z0 = 0.36                   # deck plate, z 0.36 .. 0.50
FIELD_Z1 = 0.48                  # stone field, 0.02 below the kerb top
KERB_W = 0.34                    # 0.30 of kerb + 0.04 of overlap into the core
CROSS_W = 0.16                   # centreline strips, on the 2 m half-cell

FOOTING = 3.80                   # inset 0.10 per side
BODY = 3.52                      # inset 0.24
FIELD = 3.40                     # inset 0.30, so the kerb overlaps it by 0.04


def build_lod0(root):
    mb = of.MeshBuilder()
    mb.box((FOOTING, FOOTING, FOOTING_H), (0, 0, FOOTING_H * 0.5), "RockDark")
    mb.box((BODY, BODY, BODY_Z1 - BODY_Z0), (0, 0, (BODY_Z0 + BODY_Z1) * 0.5),
           "Rock")
    mb.box((FIELD, FIELD, FIELD_Z1 - DECK_Z0), (0, 0, (DECK_Z0 + FIELD_Z1) * 0.5),
           "Rock")
    # Steel kerb: four strips whose OUTER faces are exactly on +/-2.0, so the
    # module dimension is set by the kerb and by nothing else. They cross at the
    # corners on purpose; overlapping solids never z-fight, coincident faces can.
    for s in (-1, 1):
        mb.box((W, KERB_W, H - DECK_Z0),
               (0, s * (sc.HALF - KERB_W * 0.5), (DECK_Z0 + H) * 0.5),
               "SteelDark")
        mb.box((KERB_W, D, H - DECK_Z0),
               (s * (sc.HALF - KERB_W * 0.5), 0, (DECK_Z0 + H) * 0.5),
               "SteelDark")
    # The centreline cross. Full length, so it runs kerb to kerb and a platform
    # shows an unbroken 2 m sub-grid across every tile boundary.
    mb.box((W, CROSS_W, H - DECK_Z0), (0, 0, (DECK_Z0 + H) * 0.5), "SteelDark")
    mb.box((CROSS_W, D, H - DECK_Z0), (0, 0, (DECK_Z0 + H) * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    mb.box((FOOTING, FOOTING, BODY_Z1), (0, 0, BODY_Z1 * 0.5), "Rock")
    mb.box((W, D, H - BODY_Z1), (0, 0, (BODY_Z1 + H) * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, H), (0, 0, H * 0.5), "Rock")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root,
                         role="Rock")
    sc.deck_sockets(root)

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    sc.report_bounds(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
