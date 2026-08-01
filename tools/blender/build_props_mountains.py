"""build_props_mountains.py - the Mountains biome scatter atlas.

    blender --background --python tools/blender/build_props_mountains.py

Produces assets/models/dist/props/props_mountains.glb (ASSET-SPECS 3.2,
Biome::Mountains).

biome.h amplifies mountain relief by 1.60, so this is the biome with real
vertical terrain. The old atlas leaned on that with a 3.40 m rock spire and a
0.72 m talus chunk, and WG-68 retired BOTH from the world: there are no inert
rocks, and a rock the crosshair cannot catch is a lie the player learns after
one swing. Nothing in web/src has named them since (`grep -rn Mtn_RockSpire
web/src` finds two lines of comment in Registry.ts and no table row), so they
are removed from the ATLAS here as well rather than left in the file as art
that a future lane could re-enable by accident.

WHAT REPLACES THEM.

  The spire, as a harvest node: assets/models/dist/nodes/rock_spire.glb, built
  by build_rock_spire.py. It is the same silhouette doing the same job on a
  ridgeline, and hitting it now gives stone.

  The small stuff, here, all of it strictly under the derived decoration cap
  (crag_common.decor_authored_max, 0.174 m for a Registry `P` prop). Three
  forms rather than one, because a scree slope dressed in a single prop reads
  as a repeating stamp no matter how good that prop is:

    Mtn_ScreeSheet   a broad thin sheet of fractured plate, the ground a
                     rockfall lands on. Widest footprint, lowest profile.
    Mtn_TalusFan     fewer, chunkier blocks piled tight, leaning on each other:
                     the heap under a cliff rather than the sheet spread away
                     from it.
    Mtn_FrostShards  thin platy splinters standing on edge at every bearing,
                     which is what frost shattering actually leaves and what
                     neither of the other two produces.

Materials (3): OF_Rock, OF_RockDark, OF_Ice. Above the tree line there is
nothing but stone and snow, and the renderer batches by material.

Collision: NONE. Every rock in this atlas is now ankle-height debris, and a
collider on ankle gravel is a player snagging on gravel. The two proxies this
file used to author belonged to the two props that are gone.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import crag_common as cc       # noqa: E402

NAME = "PropsMountains"
OUT = of.dist_path("props", "props_mountains.glb")

# Each size tuple is written ONCE and used twice: as the prop's fitted box and
# as the height crag_common.check_decor_height gates on. Two transcriptions of
# one number is the catalogued defect class on this project, and here it would
# be silent: a prop authored 0.20 m and checked at 0.15 m would pass the gate
# and ship above the harvest threshold anyway.
SCREE = (1.75, 1.50, 0.155)
TALUS = (1.30, 1.15, 0.168)
SHARDS = (1.45, 1.25, 0.160)
SNOW = (2.60, 2.10, 0.22)


def scree_sheet():
    return cc.scree_sheet("Mtn_ScreeSheet", 6141, "RockDark", "Rock",
                          SCREE[2], count=14)


def talus_fan():
    return cc.talus_cluster("Mtn_TalusFan", 6151, "Rock", "RockDark",
                            TALUS[2], count=7)


def frost_shards():
    return cc.frost_shards("Mtn_FrostShards", 6161, "RockDark", "Rock",
                           SHARDS[2], count=9)


def snow_patch():
    """Wind-packed snow lying in a hollow: three overlapping flat domes, not
    a disc. A disc has a hard circular edge that reads as a decal; three
    domes give it a lobed shoreline for eight extra triangles.

    Unchanged, and deliberately so: this is the one prop in the atlas that is
    not rock, the rocks lane does not own snow, and its bytes are held still so
    that the atlas diff is entirely the rock work."""
    p = hc.Parts()
    plan = (((0.00, 0.00, 0.00), (0.52, 0.42, 0.30), 6121),
            ((0.36, 0.14, 0.00), (0.30, 0.28, 0.22), 6127),
            ((-0.30, -0.18, 0.00), (0.28, 0.26, 0.19), 6133))
    for loc, r, seed in plan:
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=6, seed=seed, jit=0.20,
                       rings=((0.0, 1.00), (0.55, 0.70)), role="Ice"))
    return p


PROPS = [
    pc.Prop("Mtn_ScreeSheet", SCREE, scree_sheet, ["RockDark", "Rock"],
            lod2=0.18),
    pc.Prop("Mtn_TalusFan", TALUS, talus_fan, ["Rock", "RockDark"],
            lod2=0.22),
    pc.Prop("Mtn_FrostShards", SHARDS, frost_shards, ["RockDark", "Rock"],
            lod2=0.22),
    pc.Prop("Mtn_SnowPatch", SNOW, snow_patch, ["Ice"], lod2=0.18),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
