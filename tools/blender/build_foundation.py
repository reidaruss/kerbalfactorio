"""
build_foundation.py - Tier-0 structural foundation.

    blender --background --python tools/blender/build_foundation.py

Produces assets/models/dist/structures/foundation.glb.

Footprint 1 x 1 m, height 0.50 m (structure_common.DECK_H). The ground-contact
deck: the thing a player levels terrain for and builds a base on top of.

READ. A poured stone pad on a stepped footing, edged with a steel kerb. The
kerb is not decoration: it is what makes the tile boundary legible, so a
20 x 20 m platform reads as a grid of placed modules rather than as one grey
sheet, and a player can see where the next foundation goes without a ghost.

TILING. The footing and the body are inset; only the deck plate and its kerb
reach the full 1.00 m, so two neighbours meet on the kerb line and show a
shallow reveal below it. That reveal is free (the inset geometry was going to
be there anyway) and it is what stops a large pad from looking like a single
extruded box.
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
KERB_W = 0.11                    # 0.09 of kerb + 0.02 of overlap into the core


def build_lod0(root):
    mb = of.MeshBuilder()
    mb.box((0.94, 0.94, FOOTING_H), (0, 0, FOOTING_H * 0.5), "RockDark")
    mb.box((0.86, 0.86, BODY_Z1 - BODY_Z0), (0, 0, (BODY_Z0 + BODY_Z1) * 0.5),
           "Rock")
    mb.box((0.82, 0.82, H - DECK_Z0), (0, 0, (DECK_Z0 + H) * 0.5), "Rock")
    # Steel kerb: four strips whose OUTER faces are exactly on +/-0.5, so the
    # module dimension is set by the kerb and by nothing else. They cross at the
    # corners on purpose; overlapping solids never z-fight, coincident faces can.
    for s in (-1, 1):
        mb.box((W, KERB_W, H - DECK_Z0),
               (0, s * (sc.HALF - KERB_W * 0.5), (DECK_Z0 + H) * 0.5),
               "SteelDark")
        mb.box((KERB_W, D, H - DECK_Z0),
               (s * (sc.HALF - KERB_W * 0.5), 0, (DECK_Z0 + H) * 0.5),
               "SteelDark")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    mb.box((0.94, 0.94, 0.38), (0, 0, 0.19), "Rock")
    mb.box((W, D, H - 0.38), (0, 0, (0.38 + H) * 0.5), "SteelDark")
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
