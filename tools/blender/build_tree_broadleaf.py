"""build_tree_broadleaf.py - Broadleaf tree, NodeKind::Tree.

    blender --background --python tools/blender/build_tree_broadleaf.py

Produces assets/models/dist/nodes/tree_broadleaf.glb.

4.0 x 4.0 x 5.0 m. The deliberate opposite of the conifer: short, wide and
forked where the conifer is tall, narrow and stacked. A heavy trunk splits into
three unequal limbs at 2.0 m, each carrying a squashed faceted canopy mass
(radii about 1.3 m, height about 1.5 m, so the vertical is 0.6 of the
horizontal per ASSET-SPECS 4.7). The three masses are different sizes at
different heights and none of them is centred on the trunk, which is what buys
a hand-placed read from a scripted asset.

DEPLETION mirrors the conifer so the two trees behave identically in code:

    _Full    three canopy masses, three limbs
    _Half    the largest limb snapped off, remaining canopy smaller, one mass dry
    _Low     bare limb stubs, one dry tuft
    _Stump   cut at 0.70 m with a pale sapwood cut face

One fit transform, computed from _Full and replayed everywhere, keeps the
trunk identical across the swap.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import tree_common as tc       # noqa: E402

NAME = "TreeBroadleaf"
OUT = of.dist_path("nodes", "tree_broadleaf.glb")
DIMS = (4.00, 4.00, 5.00)
ORDER = ["Bark", "Leaf", "LeafDry"]

FORK_Z = 2.00
SEED = 5107


def _trunk(p):
    """Root flare plus trunk to the fork. Identical in every variant."""
    p.add(*hc.taper(0.44, 0.30, 0.0, 0.40, seg=8), role="Bark")
    p.add(*hc.taper(0.28, 0.22, 0.36, 2.20, seg=8, phase_deg=18), role="Bark")
    return p


def full_lod0():
    p = hc.Parts()
    _trunk(p)
    p.add(*hc.taper(0.18, 0.11, FORK_Z, 3.40, seg=7, lean=(-0.62, 0.22)),
          role="Bark")
    p.add(*hc.taper(0.17, 0.10, 2.05, 3.25, seg=7, lean=(0.58, -0.30)),
          role="Bark")
    p.add(*hc.taper(0.12, 0.07, 2.30, 3.10, seg=6, lean=(0.10, 0.55)),
          role="Bark")
    p.add(*hc.blob(1.35, 1.25, 1.55, (-0.78, 0.30, 4.05), seg=9,
                   seed=SEED + 1), role="Leaf")
    p.add(*hc.blob(1.25, 1.35, 1.45, (0.72, -0.38, 3.95), seg=9,
                   seed=SEED + 2), role="Leaf")
    p.add(*hc.blob(0.95, 0.90, 1.10, (0.14, 0.78, 3.55), seg=8,
                   seed=SEED + 3), role="Leaf")
    return p


def full_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.34, 0.22, 0.0, 2.20, seg=6), role="Bark")
    p.add(*hc.taper(0.18, 0.11, FORK_Z, 3.40, seg=5, lean=(-0.62, 0.22)),
          role="Bark")
    p.add(*hc.taper(0.17, 0.10, 2.05, 3.25, seg=5, lean=(0.58, -0.30)),
          role="Bark")
    p.add(*hc.blob(1.35, 1.25, 1.55, (-0.78, 0.30, 4.05), seg=6,
                   seed=SEED + 1, rings=(0.30, 0.68), radii=(0.85, 0.80)),
          role="Leaf")
    p.add(*hc.blob(1.25, 1.35, 1.45, (0.72, -0.38, 3.95), seg=6,
                   seed=SEED + 2, rings=(0.30, 0.68), radii=(0.85, 0.80)),
          role="Leaf")
    return p


def _impostor(width, height, z0, trunk_r, trunk_h):
    p = hc.Parts()
    p.add(*hc.taper(trunk_r, trunk_r * 0.8, 0.0, trunk_h, seg=4), role="Bark")
    p.add(*hc.crossed_quads(width, height, z0=z0), role="Leaf")
    return p


def half_lod0():
    p = hc.Parts()
    _trunk(p)
    p.add(*hc.taper(0.18, 0.11, FORK_Z, 3.20, seg=7, lean=(-0.55, 0.20)),
          role="Bark")
    p.add(*hc.taper(0.17, 0.13, 2.05, 2.75, seg=6, lean=(0.28, -0.15)),
          role="Bark")
    p.add(*hc.blob(1.05, 0.98, 1.20, (-0.66, 0.26, 3.75), seg=8,
                   seed=SEED + 11), role="Leaf")
    p.add(*hc.blob(0.62, 0.58, 0.74, (0.34, -0.22, 3.05), seg=7,
                   seed=SEED + 12), role="LeafDry")
    return p


def half_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.34, 0.22, 0.0, 2.20, seg=6), role="Bark")
    p.add(*hc.taper(0.18, 0.11, FORK_Z, 3.20, seg=5, lean=(-0.55, 0.20)),
          role="Bark")
    p.add(*hc.blob(1.05, 0.98, 1.20, (-0.66, 0.26, 3.75), seg=6,
                   seed=SEED + 11, rings=(0.30, 0.68), radii=(0.85, 0.80)),
          role="Leaf")
    return p


def low_lod0():
    p = hc.Parts()
    _trunk(p)
    p.add(*hc.taper(0.18, 0.10, FORK_Z, 2.85, seg=6, lean=(-0.42, 0.16)),
          role="Bark")
    p.add(*hc.taper(0.16, 0.09, 2.05, 2.70, seg=6, lean=(0.38, -0.20)),
          role="Bark")
    p.add(*hc.blob(0.46, 0.44, 0.56, (-0.34, 0.14, 2.95), seg=6,
                   seed=SEED + 21), role="LeafDry")
    return p


def low_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.34, 0.22, 0.0, 2.20, seg=6), role="Bark")
    p.add(*hc.blob(0.46, 0.44, 0.56, (-0.34, 0.14, 2.95), seg=5,
                   seed=SEED + 21, rings=(0.32, 0.70), radii=(0.85, 0.78)),
          role="LeafDry")
    return p


def stump_lod0():
    p = hc.Parts()
    p.add(*hc.taper(0.44, 0.30, 0.0, 0.40, seg=8), role="Bark")
    p.add(*hc.taper(0.29, 0.27, 0.38, 0.70, seg=8), role="Bark")
    p.add(*hc.ngon(8, 0.265, 0.71, seed=SEED + 5, jit=0.04), role="LeafDry")
    return p


def stump_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.42, 0.28, 0.0, 0.68, seg=6), role="Bark")
    p.add(*hc.ngon(6, 0.275, 0.69, seed=SEED + 6, jit=0.03), role="LeafDry")
    return p


VARIANTS = (
    ("Full", (full_lod0, full_lod1,
              lambda: _impostor(3.80, 3.10, 1.90, 0.28, 2.10))),
    ("Half", (half_lod0, half_lod1,
              lambda: _impostor(2.40, 2.40, 2.20, 0.28, 2.30))),
    ("Low", (low_lod0, low_lod1,
             lambda: _impostor(1.00, 1.00, 2.60, 0.28, 2.60))),
    ("Stump", (stump_lod0, stump_lod1, stump_lod1)),
)


def main():
    of.reset_scene()
    root = of.add_root(NAME)
    sway = tc.rig(root, NAME, (0.60, 0.60, DIMS[2]), 1.20,
                  (0.0, -0.55, 0.90), fall=True)

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
