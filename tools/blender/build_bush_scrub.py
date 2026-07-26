"""build_bush_scrub.py - Scrub bush, an art variant of NodeKind::Tree.

    blender --background --python tools/blender/build_bush_scrub.py

Produces assets/models/dist/nodes/bush_scrub.glb.

1.0 x 1.0 x 0.9 m, five faceted lobes on a stub stem. This is NOT a new
NodeKind: it is the low-yield Tree dressing, the bootstrap harvest a player
strips before they have an axe, so it must read as "a few sticks" rather than
"a tree you could fell". Hence no Tree_Fall clip and no stump variant: you pick
a bush clean, you do not chop it down.

DEPLETION 5 lobes -> 3 lobes -> 2 dry lobes. Two LOD bands only, per the
manifest: a 0.9 m prop is either near enough to matter or gone.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import tree_common as tc       # noqa: E402

NAME = "BushScrub"
OUT = of.dist_path("nodes", "bush_scrub.glb")
DIMS = (1.00, 1.00, 0.90)
ORDER = ["Bark", "Leaf", "LeafDry"]
SEED = 6113

# (centre, radii, height, segments) for the five lobes, biggest first. None of
# them shares a centre with the stem, so the mass sits off to one side the way
# a wind-pruned scrub bush actually grows.
LOBES = (((-0.10, 0.06, 0.52), (0.34, 0.30), 0.46, 6),
         ((0.24, -0.14, 0.44), (0.28, 0.30), 0.40, 6),
         ((0.06, 0.30, 0.40), (0.26, 0.24), 0.36, 6),
         ((-0.28, -0.20, 0.34), (0.24, 0.26), 0.32, 5),
         ((0.20, 0.20, 0.60), (0.20, 0.19), 0.26, 5))


def _stem(p, seg=5):
    p.add(*hc.taper(0.075, 0.045, 0.0, 0.26, seg=seg), role="Bark")
    return p


def _bush(count, role_of, seg_bias=0, jit=0.20):
    p = hc.Parts()
    _stem(p, seg=5 if seg_bias == 0 else 4)
    for k in range(count):
        loc, r, h, seg = LOBES[k]
        p.add(*hc.blob(r[0], r[1], h, loc, seg=max(4, seg + seg_bias),
                       seed=SEED + k * 29, jit=jit,
                       rings=(0.30, 0.66), radii=(0.82, 0.80)),
              role=role_of(k))
    return p


def full_lod0():
    return _bush(5, lambda k: "Leaf")


def full_lod1():
    # Four lobes, not five: the manifest budget for LOD1 is 80 tris and the
    # fifth lobe is the smallest, so dropping it is invisible at 25 m.
    return _bush(4, lambda k: "Leaf", seg_bias=-2)


def half_lod0():
    return _bush(3, lambda k: "LeafDry" if k == 2 else "Leaf")


def half_lod1():
    return _bush(3, lambda k: "LeafDry" if k == 2 else "Leaf", seg_bias=-2)


def low_lod0():
    p = hc.Parts()
    _stem(p)
    for k in (3, 4):
        loc, r, h, seg = LOBES[k]
        p.add(*hc.blob(r[0] * 0.72, r[1] * 0.72, h * 0.62,
                       (loc[0], loc[1], loc[2] * 0.62), seg=max(4, seg - 1),
                       seed=SEED + k * 29, jit=0.22,
                       rings=(0.30, 0.66), radii=(0.82, 0.80)),
              role="LeafDry")
    return p


def low_lod1():
    p = hc.Parts()
    _stem(p, seg=4)
    loc, r, h, _ = LOBES[3]
    p.add(*hc.blob(r[0] * 0.80, r[1] * 0.80, h * 0.66,
                   (loc[0], loc[1], loc[2] * 0.62), seg=4, seed=SEED + 87,
                   jit=0.20, rings=(0.32, 0.68), radii=(0.84, 0.78)),
          role="LeafDry")
    return p


VARIANTS = (("Full", (full_lod0, full_lod1)),
            ("Half", (half_lod0, half_lod1)),
            ("Low", (low_lod0, low_lod1)))


def main():
    of.reset_scene()
    root = of.add_root(NAME)
    # fall=False: no Tree_Fall clip, no socket_fell_pivot. A bush is stripped,
    # never felled.
    sway = tc.rig(root, NAME, (0.90, 0.90, DIMS[2]), 0.45,
                  (0.0, -0.30, 0.55), fall=False)

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
