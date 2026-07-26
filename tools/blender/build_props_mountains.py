"""build_props_mountains.py - the Mountains biome scatter atlas.

    blender --background --python tools/blender/build_props_mountains.py

Produces assets/models/dist/props/props_mountains.glb (ASSET-SPECS 3.2,
Biome::Mountains).

biome.h amplifies mountain relief by 1.60, so this is the biome with real
vertical terrain and the one place where a scatter prop can be TALLER than the
player and still look small. The rock spire is the whole point of the atlas:
one vertical shape at 3.4 m breaks a ridgeline in a way no amount of ground
detail can, and it is the only Tier-1 prop that reads from 200 m.

Materials (3): OF_Rock, OF_RockDark, OF_Ice. Three roles is the smallest
atlas in the batch and it is deliberate - above the tree line there is nothing
but stone and snow, and the renderer batches by material.

Collision: Mtn_RockSpire and Mtn_TalusChunk. The snow patch is a surface, not
an obstacle, and is walk-through.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsMountains"
OUT = of.dist_path("props", "props_mountains.glb")


def rock_spire():
    """A weathered tooth with one buttress at its foot. SPIRE_RINGS pulls the
    radius in hard with height, which is what a frost-shattered pinnacle does
    and what stops it reading as a cylinder."""
    return pc.rock(6101, "Rock", "RockDark",
                   ((1, 4, 8, 12), (2, 6, 11), (0, 5)),
                   lobes=3, seg=7, jit=0.17, rings=pc.SPIRE_RINGS,
                   lean_gain=0.10,
                   plan=(((0.00, 0.00, 0.00), (0.36, 0.32, 1.00)),
                         ((0.30, 0.16, 0.00), (0.24, 0.22, 0.38)),
                         ((-0.24, -0.18, 0.00), (0.18, 0.20, 0.24))))


def talus_chunk():
    """One frost-shattered block with a splinter still leaning on it. High
    jitter and few sides, because talus is fractured along planes and every
    face should be flat and big."""
    return pc.rock(6111, "RockDark", "Rock", ((0, 3, 7, 11), (2, 5)), lobes=2,
                   seg=6, jit=0.30, rings=pc.SLAB_RINGS,
                   plan=(((0.00, 0.00, 0.00), (0.50, 0.45, 0.42)),
                         ((0.34, -0.18, 0.00), (0.22, 0.20, 0.26))))


def snow_patch():
    """Wind-packed snow lying in a hollow: three overlapping flat domes, not
    a disc. A disc has a hard circular edge that reads as a decal; three
    domes give it a lobed shoreline for eight extra triangles."""
    p = hc.Parts()
    plan = (((0.00, 0.00, 0.00), (0.52, 0.42, 0.30), 6121),
            ((0.36, 0.14, 0.00), (0.30, 0.28, 0.22), 6127),
            ((-0.30, -0.18, 0.00), (0.28, 0.26, 0.19), 6133))
    for loc, r, seed in plan:
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=6, seed=seed, jit=0.20,
                       rings=((0.0, 1.00), (0.55, 0.70)), role="Ice"))
    return p


PROPS = [
    pc.Prop("Mtn_RockSpire", (1.25, 1.10, 3.40), rock_spire,
            ["Rock", "RockDark"], lod2=0.15, collide=True, col_role="Rock"),
    pc.Prop("Mtn_TalusChunk", (0.95, 0.85, 0.72), talus_chunk,
            ["RockDark", "Rock"], lod2=0.25, collide=True,
            col_role="RockDark"),
    pc.Prop("Mtn_SnowPatch", (2.60, 2.10, 0.22), snow_patch,
            ["Ice"], lod2=0.18),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
