"""build_props_cave.py - the voxel-tunnel dressing atlas.

    blender --background --python tools/blender/build_props_cave.py

Produces assets/models/dist/props/props_cave.glb (ASSET-SPECS 3.2).

The one Tier-1 atlas that is not bound to a Biome value. It dresses the 1 m^3
voxel tunnels the player digs (voxel_terrain.h, kVoxelSizeM = 1.0), and its
job is to make a dug hole read as a PLACE. A raw voxel tunnel is a corridor of
identical cubes with no scale reference at all, so the props here are chosen
for what they tell the player rather than for how they look:

  Cave_Stalagmite      "this was here before you" - the only prop that says
                       the cave is natural rather than dug
  Cave_CrystalCluster  a bright find in an otherwise monochrome space
  Cave_Rubble          spoil, which is what makes a tunnel look worked
  Cave_SupportFrame    a 2.4 m timber frame: the SCALE REFERENCE. It is sized
                       against the player (1.80 m), so a tunnel with frames in
                       it has a readable height and one without does not
  Cave_OreVeinPanel    the only way ore density reads underground

Cave_OreVeinPanel is a shallow decal placed flat against a dug voxel face when
the voxel it replaced held ore, so its pivot is its VOLUMETRIC CENTRE, not the
ground: it mates with a 1 m face, not with a floor. It carries exactly two
material slots, OF_RockDark host and OF_Iron vein, in that pinned order, and
the renderer OVERRIDES SLOT 1 per ore type (iron / copper / coal / ferrite).
One mesh, four ores, no extra geometry.

Crystals are OF_Glass and NOT OF_EmissiveState. Emissive is reserved for
machine state and genuine fire (ASSET-SPECS 1); a glowing decorative crystal
would break the single rule that buys this game its at-a-glance clarity, and
underground the player has a helmet lamp for exactly this reason.

Materials (5): OF_RockDark, OF_Rock, OF_Glass, OF_Bark, OF_Iron. Five is one
more than any biome atlas and it is the cave's five distinct jobs above.

Collision: Cave_Stalagmite, Cave_CrystalCluster, Cave_SupportFrame. Rubble is
walk-over spoil and the wall panel is a decal.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsCave"
OUT = of.dist_path("props", "props_cave.glb")


def stalagmite():
    """Three cones of falling height off one base, so it reads as something
    that GREW rather than something that was placed."""
    return pc.rock(1201, "RockDark", "Rock", ((0, 3, 6), (1, 4), (2,)),
                   lobes=3, seg=6, jit=0.18, rings=pc.SPIRE_RINGS,
                   lean_gain=0.08,
                   plan=(((0.00, 0.00, 0.00), (0.34, 0.30, 1.00)),
                         ((0.30, 0.14, 0.00), (0.22, 0.20, 0.58)),
                         ((-0.22, -0.20, 0.00), (0.18, 0.17, 0.34))))


def crystal_cluster():
    """Five glass prisms leaning out of a dark socket. The prisms are 4-sided
    on purpose: a crystal is faceted, and four flat faces catch a helmet lamp
    as four distinct highlights where eight average out to a smooth blur."""
    p = hc.Parts()
    p.add(*hc.lobe(0.34, 0.30, 0.22, seg=6, seed=1211, jit=0.24,
                   rings=((0.0, 1.00), (0.60, 0.62)), role="RockDark"))
    plan = (((0.00, 0.00, 0.12), (0.10, 0.09, 0.80), (0.05, 0.03), 1221),
            ((0.15, 0.08, 0.10), (0.08, 0.07, 0.58), (0.16, 0.09), 1227),
            ((-0.14, 0.06, 0.10), (0.07, 0.06, 0.46), (-0.15, 0.08), 1233),
            ((0.05, -0.16, 0.09), (0.07, 0.06, 0.40), (0.06, -0.17), 1239),
            ((-0.09, -0.10, 0.08), (0.05, 0.05, 0.28), (-0.10, -0.11), 1247))
    for loc, r, lean, seed in plan:
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=4, seed=seed, jit=0.10,
                       lean=lean, rings=((0.0, 1.00), (0.62, 0.72)),
                       role="Glass"))
    return p


def rubble():
    """Spoil: nine angular fragments, the debris the player's own digging
    left. Flat rings, because dug rock breaks along planes."""
    return pc.chips(9, (0.40, 0.34), (0.13, 0.11, 0.09), 1251, "RockDark",
                    alt_role="Rock", alt_every=3, seg=5, jit=0.32,
                    rings=((0.0, 1.00), (0.58, 0.60)))


def support_frame():
    """Two posts, a lintel, corbels and footings. 2.40 m tall against a
    1.80 m player, which is the entire point of the prop: it is the scale
    reference that turns a corridor of identical cubes into a space with a
    readable height.

    The corbels are horizontal knee blocks rather than diagonal braces
    because of_lib's box only yaws about Z, and a diagonal in the XZ plane
    would need a rotation the primitive cannot express. A corbel reads as
    carpentry at this size and costs the same twelve triangles."""
    p = hc.Parts()
    for sx in (-1.0, 1.0):
        p.add(*of.box_data((0.18, 0.22, 2.20), (sx * 0.80, 0.0, 1.10)),
              role="Bark")
        p.add(*of.box_data((0.30, 0.28, 0.16), (sx * 0.80, 0.0, 0.08)),
              role="Bark")
        p.add(*of.box_data((0.34, 0.20, 0.16), (sx * 0.52, 0.0, 2.06)),
              role="Bark")
    p.add(*of.box_data((1.96, 0.24, 0.20), (0.0, 0.0, 2.30)), role="Bark")
    return p


def ore_vein_panel():
    """A 1 m decal for a dug voxel face: a shallow OF_RockDark backing slab
    with a diagonal band of OF_Iron chips standing proud of it.

    A DIAGONAL band, not a blob: a vein that crosses the panel corner to
    corner tiles against the neighbouring panel in any orientation, so a rich
    seam reads as one continuous streak across several dug faces instead of as
    a row of identical stamps. The chips are yawed boxes for the same reason
    of_lib's hand-piled stone is - no two share an edge angle."""
    p = hc.Parts()
    p.add(*of.box_data((0.98, 0.06, 0.98), (0.0, 0.03, 0.0)), role="RockDark")
    chips = ((-0.36, -0.34, 0.17, 0.15, 14.0),
             (-0.22, -0.14, 0.13, 0.12, -31.0),
             (-0.05, 0.03, 0.19, 0.14, 22.0),
             (0.12, -0.06, 0.11, 0.10, -12.0),
             (0.19, 0.22, 0.16, 0.13, 37.0),
             (0.34, 0.38, 0.12, 0.11, -24.0),
             (-0.30, 0.18, 0.09, 0.08, 8.0),
             (0.28, -0.28, 0.08, 0.08, -41.0))
    for x, z, sx, sz, rz in chips:
        p.add(*of.box_data((sx, 0.07, sz), (x, -0.025, z), rot_z=rz),
              role="Iron")
    return p


PROPS = [
    pc.Prop("Cave_Stalagmite", (0.58, 0.52, 1.85), stalagmite,
            ["RockDark", "Rock"], lod2=0.18, collide=True,
            col_role="RockDark"),
    pc.Prop("Cave_CrystalCluster", (0.72, 0.62, 0.95), crystal_cluster,
            ["RockDark", "Glass"], lod2=0.22, collide=True,
            col_role="RockDark"),
    pc.Prop("Cave_Rubble", (1.25, 1.05, 0.38), rubble,
            ["RockDark", "Rock"], lod2=0.18),
    pc.Prop("Cave_SupportFrame", (2.00, 0.34, 2.40), support_frame,
            ["Bark"], lod2=0.30, collide=True, col_role="Bark"),
    pc.Prop("Cave_OreVeinPanel", (1.00, 0.14, 1.00), ore_vein_panel,
            ["RockDark", "Iron"], lod2=0.30, base_z=-0.50),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
