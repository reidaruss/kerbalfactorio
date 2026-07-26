"""build_props_polar.py - the Polar biome scatter atlas.

    blender --background --python tools/blender/build_props_polar.py

Produces assets/models/dist/props/props_polar.glb (ASSET-SPECS 3.2,
Biome::Polar).

Polar is the only biome where the ground material and the scatter material are
the same colour, so silhouette is doing ALL the work: a white prop on white
terrain is invisible unless its shape casts a shape. That is why every prop
here is either sharply vertical (the shard) or strongly directional (the
drift), and why the ice boulder keeps a dark stone core showing through - a
pure white lump on a white plain is a prop the player never sees.

Materials (3): OF_Ice, OF_Rock, OF_RockDark. OF_Ice is the palette's only
low-roughness natural surface (0.25 against everything else's 0.9), so ice
reads as ice purely from the specular response.

Collision: Polar_IceShard and Polar_IceBoulder. The snow drift is a surface
the player walks over.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsPolar"
OUT = of.dist_path("props", "props_polar.glb")


def ice_shard():
    """A pressure-ridge blade tipped off vertical, with grit-dark facets where
    it comes out of the ground. The lean is the read: a vertical shard reads
    as a monument, a leaning one reads as ice that was pushed."""
    return pc.rock(7101, "Ice", "RockDark", ((0, 2, 5), (1, 4)), lobes=2,
                   seg=6, jit=0.16, rings=pc.SPIRE_RINGS, lean_gain=0.22,
                   plan=(((0.00, 0.00, 0.00), (0.34, 0.28, 1.00)),
                         ((0.26, 0.12, 0.00), (0.20, 0.18, 0.34))))


def snow_drift():
    """A wind drift: four flattened masses in a line along X with a rising
    crest, so it has a windward and a leeward side. Strongly directional on
    purpose - the scatter pass yaws it to the prevailing wind and a whole
    polar plain then reads as one weather system."""
    p = hc.Parts()
    plan = (((-0.62, 0.02, 0.00), (0.36, 0.24, 0.42), 7111),
            ((-0.10, -0.04, 0.00), (0.42, 0.28, 0.62), 7117),
            ((0.42, 0.03, 0.00), (0.34, 0.24, 0.46), 7123),
            ((0.86, -0.02, 0.00), (0.24, 0.18, 0.26), 7129))
    for loc, r, seed in plan:
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=6, seed=seed, jit=0.18,
                       rings=((0.0, 1.00), (0.50, 0.78), (0.85, 0.40)),
                       role="Ice"))
    return p


def ice_boulder():
    """A glacial erratic in its ice glaze: an OF_Rock body with OF_Ice on the
    apex fan. Facet indices 12..17 on a six-sided lobe are exactly the faces
    that see the sky, so the glaze lands where snow would actually settle and
    the dark stone stays visible on the flanks, which is what makes the prop
    legible against a white plain at all."""
    return pc.rock(7131, "Rock", "Ice",
                   ((12, 13, 14, 16), (11, 13, 15), (12, 17)),
                   lobes=3, seg=6, jit=0.16,
                   plan=(((0.00, 0.00, 0.00), (0.52, 0.46, 0.52)),
                         ((0.32, 0.16, 0.00), (0.29, 0.27, 0.32)),
                         ((-0.28, -0.20, 0.00), (0.25, 0.28, 0.26))))


PROPS = [
    pc.Prop("Polar_IceShard", (0.75, 0.62, 1.70), ice_shard,
            ["Ice", "RockDark"], lod2=0.20, collide=True, col_role="Ice"),
    pc.Prop("Polar_SnowDrift", (3.20, 1.30, 0.50), snow_drift,
            ["Ice"], lod2=0.15),
    pc.Prop("Polar_IceBoulder", (1.55, 1.35, 1.15), ice_boulder,
            ["Rock", "Ice"], lod2=0.16, collide=True, col_role="Rock"),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
