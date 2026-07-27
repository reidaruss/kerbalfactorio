"""
build_floor.py - Tier-0 structural floor deck, which is ALSO the ceiling.

    blender --background --python tools/blender/build_floor.py

Produces assets/models/dist/structures/floor.glb.

Footprint 4 x 4 m, height 0.50 m (structure_common.DECK_H) - the same envelope
as the foundation, because a deck is a deck: a floor that was thinner than a
foundation would put the storey pitch at two different numbers depending on
which one you stood on, and the whole point of the module is that it is one
number.

CEILING = FLOOR, DELIBERATELY. There is no ceiling.glb. Storey N's ceiling is
storey N+1's floor: the same part, the same origin, placed at z = 4 (N + 1).
That is why the ribs are on the UNDERSIDE and the plate is on top - the part is
authored to be seen from both sides at once, plate from above and ribbed
structure from below, which is exactly what a real deck looks like. Shipping a
second, flipped file would double the payload to make the same picture.

READ. A steel deck plate on a perimeter beam frame over a rib grid. Distinct
from the foundation on purpose: stone-and-kerb means ground, steel-and-beam
means suspended, and a player should be able to tell from the material alone
whether the thing under their feet is on soil or over a drop.

WHAT THE FOUR-METRE CELL CHANGED (DW-32). Two parallel ribs spanned a 1 m deck;
they do not span four. The underside is now a WAFFLE: three ribs each way on the
1 m voxel lines, which is the honest structure for a 4 m square panel carried
only on its edges, and which is the thing a player standing underneath actually
sees. The beam depth stayed at 0.40 because DECK_H stayed at 0.50, so the beam
is now 4.00 / 0.40 = 10:1 on span, which is what a real deck beam is.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import structure_common as sc  # noqa: E402

NAME = "Floor"
OUT = of.dist_path("structures", "floor.glb")

W = D = sc.CELL
H = sc.DECK_H

BEAM_W = 0.14
BEAM_H = 0.40                    # z 0.00 .. 0.40, so the base is on z = 0
PLATE_Z0 = 0.38                  # plate z 0.38 .. 0.50, overlapping the beams
RIB_W = 0.10
RIB_H = 0.28                     # z 0.12 .. 0.40, tucked up inside the frame
RIB_SPAN = W - 2.0 * BEAM_W      # 3.72, beam inner face to beam inner face
RIB_AT = (-1.0, 0.0, 1.0)        # on the 1 m voxel lines, three bays each way


def _ribs(mb):
    """The waffle. Ribs run BOTH ways because a 4 m panel supported on four
    edges spans both ways; a one-way rib set would be a lie about the load and
    would read as one from underneath, which is where this face is seen from."""
    for v in RIB_AT:
        mb.box((RIB_SPAN, RIB_W, RIB_H), (0, v, PLATE_Z0 - RIB_H * 0.5 + 0.02),
               "SteelDark")
        mb.box((RIB_W, RIB_SPAN, RIB_H), (v, 0, PLATE_Z0 - RIB_H * 0.5 + 0.02),
               "SteelDark")


def _beams(mb):
    """Perimeter beams. Outer faces exactly on +/-2.0: the beams, not the plate,
    are what two neighbouring decks butt against."""
    for s in (-1, 1):
        mb.box((W, BEAM_W, BEAM_H),
               (0, s * (sc.HALF - BEAM_W * 0.5), BEAM_H * 0.5), "SteelDark")
        mb.box((BEAM_W, D, BEAM_H),
               (s * (sc.HALF - BEAM_W * 0.5), 0, BEAM_H * 0.5), "SteelDark")


def build_lod0(root):
    mb = of.MeshBuilder()
    _beams(mb)
    _ribs(mb)
    mb.box((W, D, H - PLATE_Z0), (0, 0, (PLATE_Z0 + H) * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _beams(mb)
    mb.box((W, D, H - PLATE_Z0), (0, 0, (PLATE_Z0 + H) * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, H), (0, 0, H * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root,
                         role="SteelDark")
    sc.deck_sockets(root)

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    sc.report_bounds(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
