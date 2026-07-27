"""build_detail_cards.py - the highest-density ground cover in the game.

    blender --background --python tools/blender/build_detail_cards.py

Produces assets/models/dist/props/detail_cards.glb (ASSET-SPECS 3.2).

These four are NOT biome props. They are the layer under the biome props: the
thing the renderer stamps by the square metre across every vegetated chunk,
where a biome prop is placed by the handful. Their instance count is one to
two orders of magnitude above anything else in the batch, so every rule here
is about cost:

  * 18 to 42 triangles each, not the 60 to 400 the biome props run at.
  * Three materials for the whole file, so the entire detail layer is three
    draws per chunk no matter how many blades are in it.
  * No LOD chain at all. A grass card is already at the floor - decimating
    18 triangles saves nothing and there is no distance at which a 0.5 m tuft
    is worth a second mesh. The renderer culls the whole layer at its own
    detail distance instead, which is one distance test rather than one LOD
    switch per instance.
  * Nothing collides. Obviously.

TWO SPEC CORRECTIONS, both flagged in ASSET-SPECS 3.2.

1. NOT ALPHA-TESTED CROSSED QUADS. The spec called these crossed quads drawn
   with alpha test. There is no texture pipeline (section 2.8 defers one until
   the texture payload would cross 1 MB, and 45 untextured props never get
   close), and an untextured crossed quad renders as a SOLID RECTANGLE
   standing in the grass. Five triangles of actual tapered blade is cheaper
   than the alpha-test fragment cost would have been, needs no UVs, no mask
   authoring and no KTX2 step, and is the only version that reads correctly
   with the materials this game actually has.

2. NOT "the only double-sided meshes outside glass and water". OF_Leaf and
   OF_LeafDry have been in of_lib.DOUBLE_SIDED since the trees shipped,
   because a single-sided leaf disappears from half the angles you look at it
   from. This file uses the same two roles and adds nothing new.

Materials (3): OF_Grass, OF_LeafDry, OF_Rock.

W11 note (2026-07-27): Registry.ts never passes detailCards to loadGlb, so
nothing here is drawn today; the controller is reporting that hook-up
separately. This file gets the minimum needed to stay valid and consistent
with the grass elsewhere: cards A and B moved onto OF_Grass (was OF_Leaf), the
same ground-grass role the plains and forest atlases now use, and their spawn
radius/width moved to the same tight-base, wide-blade ratio the plains fans
use (mass over blade count, see build_props_plains.py) since it costs nothing
extra to keep them consistent. No other change, deliberately: the effort went
to props_plains, props_forest and the two trees.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "DetailCards"
OUT = of.dist_path("props", "detail_cards.glb")


def grass_card_a():
    """Six short blades, three triangles each, based tight and wide so the
    card is a small mass rather than a spread of hairs. The default: this is
    the one that covers a plains chunk end to end."""
    return pc.tuft(6, 0.38, 0.090, 0.030, 1301, bend=0.14, segs=2, droop=0.32,
                   role="Grass", h_var=0.35)


def grass_card_b():
    """Eight taller blades with a real arch, same tight-base logic as A.
    Scattered at maybe a fifth of A's density to break the uniformity, which
    is the only job it has."""
    return pc.tuft(8, 0.60, 0.085, 0.040, 1311, bend=0.26, segs=3, droop=0.40,
                   role="Grass", h_var=0.40, phase=23.0)


def grass_card_c():
    """The dry note. Same shape budget as A, OF_LeafDry instead of OF_Leaf,
    so a chunk can be pushed toward parched by changing the mix ratio and
    nothing else."""
    return pc.tuft(6, 0.44, 0.058, 0.065, 1321, bend=0.18, segs=2, droop=0.30,
                   role="LeafDry", h_var=0.40, phase=41.0)


def pebble_scatter():
    """Seven grit-sized stones, six triangles each: a single-ring lobe is a
    faceted cone, which is exactly what a chip of gravel is. This is what
    stops bare soil and worn paths from reading as flat colour."""
    p = hc.Parts()
    nxt = hc.rng(1331)
    for i in range(7):
        a = 2.0 * math.pi * i / 7 + (nxt() - 0.5) * 1.2
        rr = 0.42 * (0.25 + nxt())
        s = 0.55 + 0.65 * nxt()
        p.add(*hc.lobe(0.075 * s, 0.065 * s, 0.048 * s,
                       loc=(rr * math.cos(a), rr * math.sin(a), 0.0),
                       seg=4, seed=1341 + i * 13, jit=0.30,
                       rings=((0.0, 1.00),), role="Rock"))
    return p


PROPS = [
    pc.Prop("Detail_GrassCardA", (0.50, 0.48, 0.36), grass_card_a,
            ["Grass"], lod2=None),
    pc.Prop("Detail_GrassCardB", (0.72, 0.68, 0.58), grass_card_b,
            ["Grass"], lod2=None),
    pc.Prop("Detail_GrassCardC", (0.62, 0.58, 0.42), grass_card_c,
            ["LeafDry"], lod2=None),
    pc.Prop("Detail_PebbleScatter", (0.92, 0.80, 0.10), pebble_scatter,
            ["Rock"], lod2=None),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
