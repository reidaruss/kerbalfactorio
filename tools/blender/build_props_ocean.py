"""build_props_ocean.py - the Ocean biome scatter atlas.

    blender --background --python tools/blender/build_props_ocean.py

Produces assets/models/dist/props/props_ocean.glb (ASSET-SPECS 3.2,
Biome::Ocean).

Ocean is the smallest atlas in the batch (two props) and that is correct:
biome.h carves it into a real basin below the datum and gives it a spawn
probability of zero, so nothing is harvested there and the seabed is scenery
seen through water. Two props is enough to say "this floor is alive" without
paying for detail nobody swims down to inspect.

Both props are built for the underwater read specifically. Kelp is a tall,
soft, VERTICAL shape because the water above it is a flat horizontal plane and
vertical is the only direction that survives the refraction; the seabed rock
is flat-topped and encrusted because a domed rock underwater is a grey blur.

Materials (3): OF_Leaf, OF_Rock, OF_RockDark.
Collision: Ocean_SeabedRock only. Kelp is soft and a player (or eventually a
submersible) should swim straight through it.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsOcean"
OUT = of.dist_path("props", "props_ocean.glb")


def kelp():
    """A holdfast, a stipe, and seven long ribbon blades. droop is nearly zero
    and segs is 5: kelp is buoyant, so its blades rise and only curve at the
    very top, which is the exact opposite of the fern's arch and the reason
    the two never read as the same plant."""
    p = hc.Parts()
    v, f, sm = hc.taper(0.055, 0.022, 0.0, 2.55, seg=5, lean=(0.10, 0.06),
                        smooth=False)
    p.add(v, f, sm, "Leaf")
    p.extend(pc.tuft(7, 2.90, 0.130, 0.045, 8101, bend=0.42, segs=5,
                     droop=0.10, role="Leaf", h_var=0.38))
    p.add(*hc.lobe(0.20, 0.18, 0.10, seg=6, seed=8111, jit=0.30,
                   rings=((0.0, 1.00), (0.60, 0.55)), role="Leaf"))
    return p


def kelp_lod2():
    p = hc.Parts()
    v, f, sm = hc.taper(0.055, 0.022, 0.0, 2.55, seg=3, lean=(0.10, 0.06),
                        smooth=False)
    p.add(v, f, sm, "Leaf")
    p.extend(pc.tuft(3, 2.90, 0.220, 0.03, 8101, bend=0.42, segs=2,
                     droop=0.10, role="Leaf", h_var=0.20))
    return p


def seabed_rock():
    """Flat-topped and encrusted: an OF_Rock main mass, an OF_RockDark
    shoulder, OF_Leaf growth on both apex fans. SLAB_RINGS keeps the top wide,
    which gives the growth somewhere to sit and gives the silhouette a
    horizontal line to read against the seabed. Two lobes on two different
    stone roles, rather than one role plus facets, because underwater the
    tonal split has to survive the water tint."""
    p = hc.Parts()
    plan = (((0.00, 0.00, 0.00), (0.52, 0.46, 0.40), "Rock",
             (12, 14, 16), 8121),
            ((0.30, 0.18, 0.00), (0.28, 0.26, 0.26), "RockDark",
             (11, 13), 8131))
    for loc, r, role, facets, seed in plan:
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=6, seed=seed, jit=0.20,
                       rings=pc.SLAB_RINGS, role=role, ore_role="Leaf",
                       ore_faces=facets))
    return p


PROPS = [
    pc.Prop("Ocean_Kelp", (0.98, 0.88, 3.20), kelp, ["Leaf"],
            lod2=kelp_lod2),
    pc.Prop("Ocean_SeabedRock", (1.85, 1.55, 0.75), seabed_rock,
            ["Rock", "RockDark", "Leaf"], lod2=0.18, collide=True,
            col_role="Rock"),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
