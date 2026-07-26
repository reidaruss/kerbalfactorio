"""build_tree_conifer.py - Conifer tree, worldgen::survival::NodeKind::Tree.

    blender --background --python tools/blender/build_tree_conifer.py

Produces assets/models/dist/nodes/tree_conifer.glb.

2.4 x 2.4 x 6.5 m. A tall narrow spire: stacked skirt tiers on a straight
tapered trunk, every tier phase-rotated off its neighbour and three branch
lobes hung asymmetrically off the sides. The phase rotation and the stray
lobes are the whole reason it does not read as a procedural cone, and they are
what makes it look hand placed next to the broadleaf, whose silhouette is
deliberately the opposite shape: wide, low and forked.

DEPLETION, four variants, swapped at RemainingAmount / InitialAmount:

    _Full    full skirt, three branch lobes, green throughout
    _Half    skirt gone, tiers narrowed by a third, upper tiers gone dry
    _Low     bare trunk with branch stubs and one dry crown tuft
    _Stump   cut off at 0.62 m with a pale sapwood cut face

Volume drops roughly 100 / 55 / 25 / 4 percent, so depletion reads from the
silhouette alone at distance, and the dry-needle material adds a second,
colour-based read up close. The root flare and trunk are byte-identical across
all four variants because every variant is fitted by ONE transform, computed
from _Full: a swap must not shift the trunk by a millimetre.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import tree_common as tc       # noqa: E402

NAME = "TreeConifer"
OUT = of.dist_path("nodes", "tree_conifer.glb")
DIMS = (2.40, 2.40, 6.50)
ORDER = ["Bark", "Leaf", "LeafDry"]

TRUNK_Z1 = 5.35
SEED = 4201


def _trunk(p):
    """Root flare plus trunk. IDENTICAL in every variant except the stump."""
    p.add(*hc.taper(0.34, 0.21, 0.0, 0.42, seg=8), role="Bark")
    p.add(*hc.taper(0.20, 0.105, 0.38, TRUNK_Z1, seg=8, phase_deg=22),
          role="Bark")
    return p


def full_lod0():
    p = hc.Parts()
    _trunk(p)
    p.add(*hc.taper(1.24, 0.92, 1.72, 2.30, seg=9, phase_deg=48), role="Leaf")
    p.add(*hc.taper(1.16, 0.42, 2.15, 3.75, seg=9, phase_deg=0), role="Leaf")
    p.add(*hc.taper(0.96, 0.34, 3.45, 4.95, seg=9, phase_deg=20), role="Leaf")
    p.add(*hc.taper(0.66, 0.24, 4.70, 5.85, seg=9, phase_deg=40), role="Leaf")
    p.add(*hc.taper(0.34, 0.05, 5.70, 6.55, seg=8, phase_deg=12), role="Leaf")
    for loc, r, seg, seed in (((0.62, -0.30, 2.55), (0.44, 0.36, 0.58), 6, 0),
                              ((-0.58, 0.36, 3.85), (0.36, 0.42, 0.48), 6, 1),
                              ((0.34, 0.50, 4.85), (0.30, 0.28, 0.40), 5, 2)):
        v, f, sm, roles = hc.lobe(r[0], r[1], r[2], loc=loc, seg=seg,
                                  seed=SEED + seed * 31, jit=0.20,
                                  role="Leaf")
        p.add(v, f, sm, roles)
    return p


def full_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.26, 0.105, 0.0, TRUNK_Z1, seg=6), role="Bark")
    for r0, r1, z0, z1, ph in ((1.24, 0.92, 1.72, 2.30, 48),
                               (1.16, 0.42, 2.15, 3.75, 0),
                               (0.96, 0.34, 3.45, 4.95, 20),
                               (0.66, 0.24, 4.70, 5.85, 40),
                               (0.34, 0.05, 5.70, 6.55, 12)):
        p.add(*hc.taper(r0, r1, z0, z1, seg=6, phase_deg=ph), role="Leaf")
    return p


def _impostor(width, height, z0, trunk_r, trunk_h):
    """LOD2: a trunk stub plus two crossed foliage quads. Sixteen triangles
    that hold the tree's mass past 80 m, which is all LOD2 owes anyone."""
    p = hc.Parts()
    p.add(*hc.taper(trunk_r, trunk_r * 0.7, 0.0, trunk_h, seg=4), role="Bark")
    p.add(*hc.crossed_quads(width, height, z0=z0), role="Leaf")
    return p


def half_lod0():
    p = hc.Parts()
    _trunk(p)
    p.add(*hc.taper(0.86, 0.34, 2.30, 3.70, seg=9, phase_deg=0), role="Leaf")
    p.add(*hc.taper(0.70, 0.26, 3.55, 4.80, seg=9, phase_deg=20), role="Leaf")
    p.add(*hc.taper(0.48, 0.18, 4.65, 5.70, seg=9, phase_deg=40),
          role="LeafDry")
    p.add(*hc.taper(0.28, 0.05, 5.60, 6.40, seg=8, phase_deg=12),
          role="LeafDry")
    v, f, sm, roles = hc.lobe(0.34, 0.30, 0.44, loc=(-0.50, 0.30, 3.40),
                              seg=6, seed=SEED + 77, jit=0.20, role="Leaf")
    p.add(v, f, sm, roles)
    return p


def half_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.26, 0.105, 0.0, TRUNK_Z1, seg=6), role="Bark")
    for r0, r1, z0, z1, role in ((0.86, 0.34, 2.30, 3.70, "Leaf"),
                                 (0.70, 0.26, 3.55, 4.80, "Leaf"),
                                 (0.48, 0.05, 4.65, 6.40, "LeafDry")):
        p.add(*hc.taper(r0, r1, z0, z1, seg=6), role=role)
    return p


def low_lod0():
    p = hc.Parts()
    _trunk(p)
    for x, y, z, ln in ((0.36, -0.10, 2.60, 0.42), (-0.34, 0.14, 3.30, 0.38),
                        (0.10, 0.36, 4.05, 0.34), (-0.16, -0.30, 4.70, 0.28)):
        p.add(*hc.taper(0.075, 0.035, z, z + ln, loc=(x, y, 0.0), seg=4),
              role="Bark")
    p.add(*hc.taper(0.40, 0.12, 5.05, 5.95, seg=8, phase_deg=15),
          role="LeafDry")
    p.add(*hc.taper(0.20, 0.05, 5.85, 6.35, seg=6), role="LeafDry")
    return p


def low_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.26, 0.105, 0.0, TRUNK_Z1, seg=6), role="Bark")
    p.add(*hc.taper(0.40, 0.05, 5.05, 6.35, seg=6), role="LeafDry")
    return p


def stump_lod0():
    p = hc.Parts()
    p.add(*hc.taper(0.34, 0.21, 0.0, 0.42, seg=8), role="Bark")
    p.add(*hc.taper(0.21, 0.19, 0.40, 0.62, seg=8), role="Bark")
    p.add(*hc.ngon(8, 0.185, 0.63, seed=SEED + 5, jit=0.04), role="LeafDry")
    return p


def stump_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.32, 0.20, 0.0, 0.60, seg=6), role="Bark")
    p.add(*hc.ngon(6, 0.19, 0.61, seed=SEED + 6, jit=0.03), role="LeafDry")
    return p


VARIANTS = (
    ("Full", (full_lod0, full_lod1,
              lambda: _impostor(2.30, 4.70, 1.85, 0.20, 2.20))),
    ("Half", (half_lod0, half_lod1,
              lambda: _impostor(1.70, 4.20, 2.20, 0.20, 2.50))),
    ("Low", (low_lod0, low_lod1,
             lambda: _impostor(0.80, 1.40, 5.00, 0.20, 5.20))),
    ("Stump", (stump_lod0, stump_lod1,
               lambda: stump_lod1())),
)


def main():
    of.reset_scene()
    root = of.add_root(NAME)
    sway = tc.rig(root, NAME, (0.50, 0.50, DIMS[2]), 1.20,
                  (0.0, -0.45, 0.90), fall=True)

    # ONE fit transform, computed from Full_LOD0 and replayed on every other
    # mesh, so the trunk lands on identical world coordinates in all four
    # depletion variants and a swap cannot pop.
    hero = full_lod0()
    xform = hero.fit(DIMS)

    reported = []
    for vname, makers in VARIANTS:
        for lod, maker in enumerate(makers):
            p = hero if (vname == "Full" and lod == 0) else maker()
            if p is not hero:
                p.apply(xform)
            mb = of.MeshBuilder()
            p.into(mb, role_order=ORDER)
            mb.build("%s_%s_LOD%d" % (NAME, vname, lod), sway)
            reported.append(("%s_LOD%d" % (vname, lod), mb))

    of.report(NAME, reported)
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
