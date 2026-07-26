"""build_props_moon.py - the moon scatter atlas, all three airless biomes.

    blender --background --python tools/blender/build_props_moon.py

Produces assets/models/dist/props/props_moon.glb (ASSET-SPECS 3.2,
Biome::Regolith / MoonHighland / CraterFloor).

ONE FILE COVERS THREE BIOMES, which is right rather than lazy: biome.h
classifies the moon by elevation band alone (rel < -0.10 crater floor,
rel > 0.20 highland, regolith otherwise), the bands abut with no transition
zone, and the surface material is the same dust everywhere. So the scatter
pass loads one file and picks a per-biome subset of the six props:

    Regolith      Moon_RockSmall, Moon_RockLarge, Moon_RegolithRipple
    MoonHighland  Moon_HighlandOutcrop, Moon_RockLarge, Moon_RockSmall
    CraterFloor   Moon_CraterRimRock, Moon_ImpactGlass, Moon_RockSmall

Airless means no weathering, so every silhouette here is either SHARP (nothing
has rounded it) or DUST (everything is buried in ejecta). There is no middle,
and that contrast is what makes a moon read as a moon rather than a grey
desert. The moon is also the Cinderite biome (WG-4), so this is the atlas the
player sees on the trip the whole progression is pointed at.

Materials (4): OF_Regolith, OF_Rock, OF_RockDark, OF_Oil.

OF_Oil on the moon needs saying out loud: impact melt glass is dark and
GLOSSY, and OF_Oil is the palette's only dark low-roughness surface (0.25
against every other ground role's 0.9+). The role is a PBR role, not a
substance, and a glassy black splash against matte grey dust is the single
most distinctive thing on the crater floor. The alternative, OF_Glass, is
alpha-blended, and thousands of alpha-blended instances is a sorting problem
bought for nothing.

Collision: Moon_RockLarge, Moon_HighlandOutcrop, Moon_CraterRimRock. The small
rock, the regolith ripple and the impact glass are walk-through.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsMoon"
OUT = of.dist_path("props", "props_moon.glb")


def rock_small():
    """Ankle-height ejecta: one block with a splinter beside it. Sharp,
    because nothing on an airless body ever rounds a rock off."""
    return pc.rock(9101, "Regolith", "RockDark", ((0, 3, 7), (2,)), lobes=2,
                   seg=6, jit=0.28,
                   plan=(((0.00, 0.00, 0.00), (0.50, 0.44, 0.34)),
                         ((0.34, -0.20, 0.00), (0.22, 0.20, 0.20))))


def rock_large():
    return pc.rock(9111, "Regolith", "RockDark",
                   ((1, 5, 9, 13), (2, 7, 10), (0, 6)),
                   lobes=3, seg=6, jit=0.26,
                   plan=(((0.00, 0.00, 0.00), (0.52, 0.46, 0.50)),
                         ((0.33, 0.15, 0.00), (0.28, 0.27, 0.31)),
                         ((-0.27, -0.21, 0.00), (0.24, 0.28, 0.25))))


def regolith_ripple():
    """A dust ripple: five very flat masses in a line, no tonal break at all.
    This is the prop that does nothing except stop a flat plain from being
    flat, so it is the cheapest thing in the atlas and the most scattered."""
    p = hc.Parts()
    plan = (((-0.78, 0.03, 0.00), (0.30, 0.20, 0.30), 9121),
            ((-0.30, -0.02, 0.00), (0.34, 0.22, 0.44), 9127),
            ((0.16, 0.04, 0.00), (0.32, 0.21, 0.38), 9133),
            ((0.58, -0.03, 0.00), (0.26, 0.18, 0.28), 9139),
            ((0.92, 0.02, 0.00), (0.18, 0.14, 0.18), 9147))
    for loc, r, seed in plan:
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=5, seed=seed, jit=0.22,
                       rings=((0.0, 1.00), (0.55, 0.66)), role="Regolith"))
    return p


def highland_outcrop():
    """Stacked bedrock breaking through the dust: three slabs of decreasing
    size, each phase-rotated off the one below. OF_Rock body with OF_Regolith
    facets on the apex fans, because on an airless body the dust settles on
    every upward face and nowhere else."""
    p = hc.Parts()
    plan = (((0.00, 0.00, 0.00), (0.54, 0.46, 0.46), (12, 14, 16), 9151),
            ((0.10, 0.06, 0.40), (0.40, 0.34, 0.38), (13, 15), 9157),
            ((-0.08, -0.04, 0.72), (0.26, 0.22, 0.30), (12, 17), 9163))
    for loc, r, facets, seed in plan:
        p.add(*hc.lobe(r[0], r[1], r[2], loc=loc, seg=6, seed=seed, jit=0.20,
                       rings=pc.SLAB_RINGS, role="Rock",
                       ore_role="Regolith", ore_faces=facets))
    return p


def crater_rim_rock():
    """Overturned ejecta: a wedge kicked out of the crater and left leaning,
    dark fresh rock on top and dust-caked underneath. The lean is the story -
    a rim rock that sits flat looks placed."""
    return pc.rock(9171, "RockDark", "Regolith", ((0, 2, 5), (1, 4)), lobes=2,
                   seg=6, jit=0.26, rings=pc.SPIRE_RINGS, lean_gain=0.26,
                   plan=(((0.00, 0.00, 0.00), (0.48, 0.42, 0.62)),
                         ((0.30, -0.16, 0.00), (0.24, 0.22, 0.30))))


def impact_glass():
    """A frozen melt splash: a shattered OF_RockDark crust ring around a
    glossy OF_Oil pool. rim_ring is the same primitive the oil seep's cracked
    crust uses, which is not a coincidence - it is the same event, a liquid
    that froze where it landed."""
    p = hc.Parts()
    p.add(*hc.rim_ring(9, 0.50, 0.33, 0.075, seed=9181, jit=0.16, z_jit=0.30),
          role="RockDark")
    p.add(*hc.lobe(0.35, 0.31, 0.055, seg=7, seed=9187, jit=0.14,
                   rings=((0.0, 1.00), (0.60, 0.70)), role="Oil"))
    return p


PROPS = [
    pc.Prop("Moon_RockSmall", (0.48, 0.42, 0.32), rock_small,
            ["Regolith", "RockDark"], lod2=0.25),
    pc.Prop("Moon_RockLarge", (1.65, 1.42, 1.05), rock_large,
            ["Regolith", "RockDark"], lod2=0.16, collide=True,
            col_role="Regolith"),
    pc.Prop("Moon_RegolithRipple", (3.00, 1.40, 0.14), regolith_ripple,
            ["Regolith"], lod2=0.16),
    pc.Prop("Moon_HighlandOutcrop", (2.40, 1.80, 1.50), highland_outcrop,
            ["Rock", "Regolith"], lod2=0.16, collide=True, col_role="Rock"),
    pc.Prop("Moon_CraterRimRock", (1.20, 1.05, 0.85), crater_rim_rock,
            ["RockDark", "Regolith"], lod2=0.20, collide=True,
            col_role="RockDark"),
    pc.Prop("Moon_ImpactGlass", (0.95, 0.82, 0.20), impact_glass,
            ["RockDark", "Oil"], lod2=0.20),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
