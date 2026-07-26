"""build_props_plains.py - the Plains biome scatter atlas.

    blender --background --python tools/blender/build_props_plains.py

Produces assets/models/dist/props/props_plains.glb (ASSET-SPECS 3.2,
Biome::Plains).

Plains is the biome the player spends the first hour in, and the one with the
least terrain relief to look at, so its dressing does the work the landform
does not. Six props across three scale bands: two grass tufts that differ in
height and density rather than in shape, a flower cluster that is the only
saturated colour in any biome atlas, two pebbles a step apart in size, and one
shrub that breaks the horizon line.

Materials (4): OF_Leaf, OF_LeafDry, OF_Accent, OF_Rock. The pebbles carry a
couple of OF_LeafDry facets as dry lichen, which is a second stone tone for
free and keeps the atlas at four roles.

Collision: Plains_PebbleB only. Everything else - both tufts, the flowers, the
small pebble and the shrub - is walk-through, because plains scatter is dense
and a player pushing through waist-high grass should not feel it.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsPlains"
OUT = of.dist_path("props", "props_plains.glb")


def grass_tuft_a():
    """Dense, low, springy. The default ground cover."""
    return pc.tuft(14, 0.40, 0.040, 0.075, 3101, bend=0.16, segs=3,
                   droop=0.34, role="Leaf", h_var=0.45)


def grass_tuft_a_lod2():
    return pc.tuft(4, 0.40, 0.070, 0.05, 3101, bend=0.16, segs=2, droop=0.34,
                   role="Leaf", h_var=0.30)


def grass_tuft_b():
    """Taller, sparser, going over. Every fourth blade is dry, which is the
    whole difference in read between A and B at 15 m."""
    return pc.tuft(12, 0.70, 0.048, 0.11, 3111, bend=0.30, segs=3,
                   droop=0.40, role="Leaf", alt_role="LeafDry", alt_every=4,
                   h_var=0.50, phase=17.0)


def grass_tuft_b_lod2():
    return pc.tuft(4, 0.70, 0.080, 0.07, 3111, bend=0.30, segs=2, droop=0.40,
                   role="Leaf", alt_role="LeafDry", alt_every=4, h_var=0.30,
                   phase=17.0)


def _flower(height, azim, bend, seed, radius):
    """One straight stem with a flat petal disc on its tip.

    The disc is a single n-gon facing +Z: three triangles, single sided, seen
    from above, which is the only angle a 60 mm flower is ever read from. The
    stem tip is computed from the same expression blade() uses, so the head
    lands exactly on it rather than near it."""
    p = hc.Parts()
    droop = 0.06
    p.add(*pc.blade(height, 0.022, azim, bend, segs=2, droop=droop),
          role="Leaf")
    a = math.radians(azim)
    tip = (math.cos(a) * bend, math.sin(a) * bend, height * (1.0 - droop))
    p.add(*hc.ngon(5, radius, 0.0, loc=tip, seed=seed, jit=0.18),
          role="Accent")
    return p


def flower_cluster():
    p = pc.tuft(8, 0.34, 0.036, 0.09, 3121, bend=0.20, segs=3, droop=0.34,
                role="Leaf", h_var=0.40)
    for i, (h, az, bd, r) in enumerate(((0.50, 20.0, 0.06, 0.055),
                                        (0.44, 120.0, 0.09, 0.048),
                                        (0.47, 205.0, 0.05, 0.052),
                                        (0.38, 285.0, 0.11, 0.042),
                                        (0.42, 330.0, 0.07, 0.045))):
        p.extend(_flower(h, az, bd, 3131 + i * 7, r))
    return p


def flower_cluster_lod2():
    p = pc.tuft(3, 0.34, 0.060, 0.06, 3121, bend=0.20, segs=2, droop=0.34,
                role="Leaf", h_var=0.30)
    for i, (h, az, bd, r) in enumerate(((0.50, 20.0, 0.06, 0.060),
                                        (0.44, 205.0, 0.05, 0.055))):
        p.extend(_flower(h, az, bd, 3131 + i * 7, r))
    return p


def pebble_a():
    return pc.rock(3141, "Rock", "LeafDry", ((13, 16),), lobes=1, seg=6,
                   jit=0.22, rings=pc.SLAB_RINGS,
                   plan=(((0.0, 0.0, 0.0), (0.50, 0.44, 0.26)),))


def pebble_b():
    """One step up in size and one lobe up in complexity, so the two pebbles
    never read as the same rock scaled."""
    return pc.rock(3151, "Rock", "LeafDry", ((12, 15), (14,)), lobes=2, seg=6,
                   jit=0.19,
                   plan=(((0.00, 0.00, 0.00), (0.50, 0.44, 0.34)),
                         ((0.32, -0.14, 0.00), (0.26, 0.24, 0.22))))


def shrub():
    """Four leaf masses sitting straight on the ground, no visible stem: at
    1 m across a stem is two pixels and costs 16 triangles to say nothing."""
    p = hc.Parts()
    plan = (((0.00, 0.00, 0.00), (0.44, 0.40, 0.62), "Leaf", 3161),
            ((0.30, 0.16, 0.00), (0.28, 0.26, 0.44), "Leaf", 3167),
            ((-0.26, 0.14, 0.00), (0.26, 0.24, 0.40), "LeafDry", 3173),
            ((0.04, -0.28, 0.00), (0.24, 0.22, 0.36), "Leaf", 3179))
    for loc, r, role, seed in plan:
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=6, seed=seed, jit=0.22,
                       role=role))
    return p


PROPS = [
    pc.Prop("Plains_GrassTuftA", (0.44, 0.42, 0.38), grass_tuft_a,
            ["Leaf"], lod2=grass_tuft_a_lod2),
    pc.Prop("Plains_GrassTuftB", (0.66, 0.62, 0.68), grass_tuft_b,
            ["Leaf", "LeafDry"], lod2=grass_tuft_b_lod2),
    pc.Prop("Plains_FlowerCluster", (0.54, 0.50, 0.52), flower_cluster,
            ["Leaf", "Accent"], lod2=flower_cluster_lod2),
    pc.Prop("Plains_PebbleA", (0.34, 0.30, 0.18), pebble_a,
            ["Rock", "LeafDry"], lod2=0.20),
    pc.Prop("Plains_PebbleB", (0.85, 0.72, 0.50), pebble_b,
            ["Rock", "LeafDry"], lod2=0.18, collide=True, col_role="Rock"),
    pc.Prop("Plains_Shrub", (1.05, 0.95, 0.80), shrub,
            ["Leaf", "LeafDry"], lod2=0.16),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
