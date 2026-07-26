"""build_props_hills.py - the Hills biome scatter atlas.

    blender --background --python tools/blender/build_props_hills.py

Produces assets/models/dist/props/props_hills.glb (ASSET-SPECS 3.2,
Biome::Hills).

Hills is the prime ore zone (biome.h biomeResource gives it the highest spawn
probability in the game), so a player spends real time here and the dressing
has to say "broken ground" without competing with the ore boulders that are
the actual harvest nodes. Three props, all about stone breaking down: one
boulder far bigger than any harvest node so the two are never confused, the
scree it sheds, and one wiry shrub for the only non-grey note.

Materials (4): OF_Rock, OF_RockDark, OF_Bark, OF_Leaf.
Collision: Hills_LargeBoulder only. Scree is ankle-height gravel and the shrub
is soft; both are walk-through.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsHills"
OUT = of.dist_path("props", "props_hills.glb")


def large_boulder():
    """2.3 m across, which is deliberately bigger than the largest ore boulder
    (1.7 m). Size alone tells the player this one is scenery."""
    return pc.rock(5101, "Rock", "RockDark",
                   ((1, 5, 9, 14), (2, 7, 11), (0, 6, 12)),
                   lobes=3, seg=7, jit=0.20,
                   plan=(((0.00, 0.00, 0.00), (0.52, 0.46, 0.54)),
                         ((0.33, 0.17, 0.00), (0.30, 0.28, 0.33)),
                         ((-0.29, -0.21, 0.00), (0.25, 0.29, 0.27))))


def scree_patch():
    """Nine angular fragments in a shallow fan, the debris the boulder above
    is turning into. Flat rings: scree is fractured plate, not pebble."""
    return pc.chips(9, (0.52, 0.44), (0.14, 0.12, 0.08), 5111, "RockDark",
                    alt_role="Rock", alt_every=3, seg=5, jit=0.30,
                    rings=((0.0, 1.00), (0.58, 0.62)))


def hill_shrub():
    """Wiry upland scrub: visible woody stems with small leaf masses, the
    opposite of the plains shrub's solid dome. At this size the stems ARE the
    silhouette, which is why they are worth their triangles here and were not
    on the plains."""
    p = hc.Parts()
    for r0, r1, z1, lean, seed in ((0.035, 0.018, 0.62, (0.16, 0.08), 5121),
                                   (0.030, 0.015, 0.52, (-0.20, 0.12), 5127),
                                   (0.028, 0.014, 0.46, (0.06, -0.22), 5133)):
        v, f, sm = hc.taper(r0, r1, 0.0, z1, seg=4, lean=lean, smooth=False,
                            phase_deg=(seed % 5) * 17.0)
        p.add(v, f, sm, "Bark")
    for loc, r, seed in (((0.20, 0.10, 0.52), (0.28, 0.26, 0.30), 5141),
                         ((-0.24, 0.14, 0.44), (0.24, 0.22, 0.26), 5147),
                         ((0.07, -0.26, 0.38), (0.22, 0.21, 0.24), 5153),
                         ((0.00, 0.00, 0.18), (0.20, 0.19, 0.22), 5159)):
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=5, seed=seed, jit=0.24,
                       role="Leaf"))
    return p


PROPS = [
    pc.Prop("Hills_LargeBoulder", (2.30, 1.95, 1.55), large_boulder,
            ["Rock", "RockDark"], lod2=0.15, collide=True, col_role="Rock"),
    pc.Prop("Hills_ScreePatch", (1.70, 1.45, 0.24), scree_patch,
            ["RockDark", "Rock"], lod2=0.18),
    pc.Prop("Hills_Shrub", (1.15, 1.05, 0.78), hill_shrub,
            ["Bark", "Leaf"], lod2=0.20),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
