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

Materials (3): OF_Rock, OF_RockDark, OF_Snow. Above the tree line there is
nothing but stone and snow, and the renderer batches by material.

RN-2700 replaced OF_Ice with OF_Snow here, and the count is unchanged because
it is a SPLIT rather than an addition: nothing in this atlas was ever ice. See
of_lib.PALETTE's `Snow` row for why one palette row was doing two substances'
work and why `Ice` keeps the polar assets it describes correctly.

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


# RN-2700. THE DRIFT PROFILE, (z_frac, r_frac) from the ground up.
#
# The shipped profile was ((0.0, 1.00), (0.55, 0.70)) at seg 6, and World Audit
# R6 ranked what that builds ahead of every other look gap in the world: "hard
# edged convex polyhedra with visible flat facets ... a razor silhouette, no
# feathering at the edge, no accumulation against the rocks beside them". The
# form is wrong in three separate ways and each ring here answers one of them.
#
# (1) THE RIM. Two rings means the FIRST step out of the ground is also the
#     step that builds the body, so the surface leaves the ground at 33.8
#     degrees averaged over the three lobes (measured on the shipped mesh,
#     after fit). Snow that has been lying long enough to pack does not end at
#     33 degrees, it thins to nothing: the 1.00 -> 0.90 step costs 3.5 per cent
#     of the height over 10 per cent of the radius, which is 4.0 degrees at the
#     big lobe after the fit into SNOW, and 7.9 degrees averaged over all three.
#     That is the feather, and it is a RING rather than a taper on the existing
#     one because a taper would have moved the shoreline inward and shrunk the
#     prop.
#
# (2) THE BODY AND THE CROWN. 0.90 -> 0.74 -> 0.50 -> apex is a convex profile
#     in three pieces where the shipped mesh had one, so the top stops being a
#     single flat plate seen end on. This is the half the 4x crop shows most
#     plainly: the shipped patch reads as one lit facet with a blue rim.
#
# (3) SEGMENTATION, per lobe rather than one number. The longest STRAIGHT run in
#     the ground shoreline is what "faceted polyhedron" means as a measurement,
#     and it is set by the widest lobe alone, so 18 segments go where they are
#     read and 12 to the two small lobes. Shipped 1.263 m; this 0.509 m. At
#     mtnslope's 58 px/m (the row-191 patch spans about 150 px across its
#     2.60 m box) that is 73.2 px -> 29.5 px at 1x, or 293 px -> 118 px in the
#     audit's own 4x crop.
SNOW_RINGS = ((0.000, 1.00), (0.035, 0.90), (0.24, 0.74), (0.58, 0.50))

# loc, radii, seed, segments. The three lobes and their overlap are the shipped
# plan to the digit: the docstring's argument for them ("a disc has a hard
# circular edge that reads as a decal") was always right and is not what R6
# ranked. Only `seg` is new here, and `jit` moves with it: 0.20 of radial
# jitter on a 6-gon is a lobed shoreline, and the same 0.20 on an 18-gon is
# high-frequency crenellation, which is a second way to look wrong. 0.06 is
# under half the 0.10 gap between the first two rings, so jitter can never
# reorder them and turn the feather into an overhang.
SNOW_PLAN = (((0.00, 0.00, 0.00), (0.52, 0.42, 0.30), 6121, 18),
             ((0.36, 0.14, 0.00), (0.30, 0.28, 0.22), 6127, 12),
             ((-0.30, -0.18, 0.00), (0.28, 0.26, 0.19), 6133, 12))

# Wind. `lean` displaces each ring by `lean * z_frac`, so the shoreline stays
# put and the crest walks off centre: a windward slope that is longer and
# shallower than the lee one. It is the "no accumulation shape" half of the
# finding and it costs zero triangles, which is why it is here rather than in a
# fourth lobe. 0.18 of the lobe's own radius, so the crest of the big lobe sits
# about 0.22 m off centre on a 2.60 m drift.
SNOW_LEAN = 0.18


def snow_patch():
    """Wind-packed snow lying in a hollow: three overlapping domes with a
    feathered rim and an off-centre crest, not a disc and no longer a slab.

    THIS LANE IS THE ONE LICENSED TO MOVE THESE BYTES. The held-still clause
    this docstring used to carry said the snow's bytes are frozen "so that the
    atlas diff is entirely the rock work", which binds a ROCKS lane. RN-2700 is
    the snow lane and it holds the three rock props still instead, so the atlas
    diff is entirely the snow work and is stated as such.

    SMOOTH SHADED, AND THE BASE FACE IS DROPPED TO MAKE THAT LEGAL.
    ASSET-SPECS 4.5 puts a boulder in five to seven large flat facets because
    flat facets catch directional light and hold a silhouette; snow has no
    facets to catch anything with, and flat shading is the mechanism that turned
    this prop into the highest-contrast object in three hero poses. Blender
    averages a vertex normal over EVERY face touching it, including a flat
    shaded one, so leaving `lobe`'s downward base n-gon in place would drag the
    whole ground ring's normals toward straight down and light the feather as if
    it faced the earth. A drift is a surface lying on the ground and not a solid
    with an underside, so the base is dropped: the rim normals come out pointing
    up and out, which is what they describe, and 36 triangles that were never
    rasterised go with it.
    """
    p = hc.Parts()
    for loc, r, seed, seg in SNOW_PLAN:
        v, f, _, roles = hc.lobe(
            r[0], r[1], r[2], loc=loc, seg=seg, seed=seed, jit=0.06,
            lean=(SNOW_LEAN * r[0], SNOW_LEAN * r[1] * 0.35),
            rings=SNOW_RINGS, role="Snow")
        # faces[0] is the flat base n-gon; `lobe` always emits it first.
        p.add(v, f[1:], [True] * (len(f) - 1), role=roles[1:])
    return p


PROPS = [
    pc.Prop("Mtn_ScreeSheet", SCREE, scree_sheet, ["RockDark", "Rock"],
            lod2=0.18),
    pc.Prop("Mtn_TalusFan", TALUS, talus_fan, ["Rock", "RockDark"],
            lod2=0.22),
    pc.Prop("Mtn_FrostShards", SHARDS, frost_shards, ["RockDark", "Rock"],
            lod2=0.22),
    pc.Prop("Mtn_SnowPatch", SNOW, snow_patch, ["Snow"], lod2=0.18),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
