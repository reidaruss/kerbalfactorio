"""
build_floor.py - Tier-0 structural floor deck, which is ALSO the ceiling.

    blender --background --python tools/blender/build_floor.py

Produces assets/models/dist/structures/floor.glb.

Footprint 1 x 1 m, height 0.50 m (structure_common.DECK_H) - the same envelope
as the foundation, because a deck is a deck: a floor that was thinner than a
foundation would put the storey pitch at two different numbers depending on
which one you stood on, and the whole point of the module is that it is one
number.

CEILING = FLOOR, DELIBERATELY. There is no ceiling.glb. Storey N's ceiling is
storey N+1's floor: the same part, the same origin, placed at z = 3 (N + 1).
That is why the ribs are on the UNDERSIDE and the plate is on top - the part is
authored to be seen from both sides at once, plate from above and ribbed
structure from below, which is exactly what a real deck looks like. Shipping a
second, flipped file would double the payload to make the same picture.

READ. A steel deck plate on a perimeter beam frame with two cross ribs. Distinct
from the foundation on purpose: stone-and-kerb means ground, steel-and-beam
means suspended, and a player should be able to tell from the material alone
whether the thing under their feet is on soil or over a drop.
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

BEAM_W = 0.10
BEAM_H = 0.40                    # z 0.00 .. 0.40, so the base is on z = 0
PLATE_Z0 = 0.38                  # plate z 0.38 .. 0.50, overlapping the beams
RIB_Y = 0.22


def build_lod0(root):
    mb = of.MeshBuilder()
    # Perimeter beams. Outer faces exactly on +/-0.5: the beams, not the plate,
    # are what two neighbouring decks butt against.
    for s in (-1, 1):
        mb.box((W, BEAM_W, BEAM_H),
               (0, s * (sc.HALF - BEAM_W * 0.5), BEAM_H * 0.5), "SteelDark")
        mb.box((BEAM_W, D, BEAM_H),
               (s * (sc.HALF - BEAM_W * 0.5), 0, BEAM_H * 0.5), "SteelDark")
        mb.box((0.80, 0.08, 0.28), (0, s * RIB_Y, 0.26), "SteelDark")
    mb.box((W, D, H - PLATE_Z0), (0, 0, (PLATE_Z0 + H) * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    for s in (-1, 1):
        mb.box((W, BEAM_W, BEAM_H),
               (0, s * (sc.HALF - BEAM_W * 0.5), BEAM_H * 0.5), "SteelDark")
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
