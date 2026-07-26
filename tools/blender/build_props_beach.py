"""build_props_beach.py - the Beach biome scatter atlas.

    blender --background --python tools/blender/build_props_beach.py

Produces assets/models/dist/props/props_beach.glb (ASSET-SPECS 3.2,
Biome::Beach in core/include/of/biome.h).

Beach is the narrowest biome band on the planet, so its four props have to
carry the whole read from one glance: SAND is the identity colour, and every
prop either sits in it or is bleached by it. The four silhouettes are
deliberately one per scale band - a low wide cobble, a long horizontal
driftwood spar, a flat shell bed at ankle height, and a vertical grass tuft -
so a scattered beach never repeats a shape at the same size twice.

Materials (4): OF_Rock, OF_Sand, OF_Bark, OF_LeafDry.
Collision: Beach_Rock and Beach_Driftwood only. Shells and dune grass are
walk-through: they are ankle-height dressing and a collider on either one is
just the player snagging on the beach.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsBeach"
OUT = of.dist_path("props", "props_beach.glb")


def beach_rock():
    """A water-smoothed cobble: wide, low, and flat-topped rather than
    angular. SLAB_RINGS is the difference between a beach cobble and a
    mountain rock - the sea takes the point off the top."""
    return pc.rock(2101, "Rock", "Sand", ((1, 4, 8), (2, 6), (0, 5)),
                   lobes=3, seg=7, jit=0.15, rings=pc.SLAB_RINGS,
                   plan=(((0.00, 0.00, 0.00), (0.52, 0.46, 0.28)),
                         ((0.30, 0.14, 0.00), (0.28, 0.26, 0.19)),
                         ((-0.26, -0.20, 0.00), (0.24, 0.26, 0.16))))


def beach_rock_lod2():
    return pc.rock(2101, "Rock", "Sand", ((1, 4),), lobes=1, seg=5, jit=0.12,
                   rings=pc.SLAB_RINGS,
                   plan=(((0.00, 0.00, 0.00), (0.56, 0.50, 0.30)),))


def driftwood():
    """A bleached spar with one fork and one broken root stub. The pale
    LeafDry end caps are the whole design: dark bark with a bright cut face is
    what says 'timber' rather than 'brown tube', and it is the same rule the
    log item and the conifer stump already follow."""
    p = hc.Parts()
    p.add(*pc.prism_x(((-1.05, 0.150, 0.00, 0.00),
                       (-0.20, 0.170, 0.02, -0.02),
                       (0.55, 0.130, -0.01, 0.01),
                       (1.05, 0.095, -0.04, 0.03)),
                      seg=7, seed=2111, jit=0.13))
    # the fork, splaying in +Y and lifting clear of the sand
    p.add(*pc.prism_x(((0.20, 0.085, 0.02, 0.01),
                       (0.62, 0.070, 0.16, 0.05),
                       (0.98, 0.042, 0.26, 0.10)),
                      seg=6, seed=2113, jit=0.16))
    # a snapped root stub the other way
    p.add(*pc.prism_x(((-0.92, 0.070, -0.02, 0.01),
                       (-0.62, 0.050, -0.16, 0.04)),
                      seg=5, seed=2117, jit=0.18))
    return p


def shell_cluster():
    """A bed of five shells and a couple of wave-rolled pebbles. Flat rings,
    because a shell is a dome and not a rock."""
    return pc.chips(7, (0.26, 0.22), (0.085, 0.075, 0.045), 2131, "Sand",
                    alt_role="Rock", alt_every=3, seg=5, jit=0.24,
                    rings=((0.0, 1.00), (0.62, 0.58)))


def dune_grass():
    """Marram: tall, stiff, sparse and bleached, leaning out of the dune.
    Fewer, longer, straighter blades than the plains tuft, which is what makes
    the two read as different plants at 20 m."""
    return pc.tuft(13, 0.90, 0.055, 0.10, 2141, bend=0.30, segs=3,
                   droop=0.22, role="LeafDry", h_var=0.50)


def dune_grass_lod2():
    return pc.tuft(4, 0.90, 0.085, 0.07, 2141, bend=0.30, segs=2,
                   droop=0.22, role="LeafDry", h_var=0.35)


PROPS = [
    pc.Prop("Beach_Rock", (1.10, 0.95, 0.55), beach_rock,
            ["Rock", "Sand"], lod2=beach_rock_lod2, collide=True,
            col_size=(1.10, 0.95, 0.55), col_role="Rock"),
    pc.Prop("Beach_Driftwood", (2.20, 0.60, 0.36), driftwood,
            ["Bark", "LeafDry"], lod2=0.28, collide=True,
            col_size=(2.20, 0.60, 0.36), col_role="Bark"),
    pc.Prop("Beach_ShellCluster", (0.58, 0.50, 0.11), shell_cluster,
            ["Sand", "Rock"], lod2=0.18),
    pc.Prop("Beach_DuneGrass", (0.78, 0.74, 0.88), dune_grass,
            ["LeafDry"], lod2=dune_grass_lod2),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
