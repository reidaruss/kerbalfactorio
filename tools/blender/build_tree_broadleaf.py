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

W11 pass (2026-07-27): trunk and limbs are jittered (tc.taper_bands) instead of
perfect cylinders, a fourth small canopy mass overlaps the largest one so the
outline is irregular rather than three clean lobes, and every canopy mass now
shades LeafDeep (interior, in its own shadow) through Leaf to LeafLight (top
surface, catching the sky) via tc.canopy_mass - real volume for zero extra
triangles. The client only ever draws _LOD0 of the Full/Half/Low variants
(NodeBatch.ts matches `_LOD0$` and drops Stump), so LOD1/LOD2/Stump keep their
original geometry unchanged.

DEPLETION mirrors the conifer so the two trees behave identically in code:

    _Full    three canopy masses, three limbs
    _Half    the largest limb snapped off, remaining canopy smaller, one mass dry
    _Low     bare limb stubs, one dry tuft
    _Stump   cut at 0.70 m with a pale sapwood cut face

One fit transform, computed from _Full and replayed everywhere, keeps the
trunk identical across the swap.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import tree_common as tc       # noqa: E402

NAME = "TreeBroadleaf"
OUT = of.dist_path("nodes", "tree_broadleaf.glb")
DIMS = (4.00, 4.00, 5.00)
ORDER = ["Bark", "LeafDeep", "Leaf", "LeafLight", "LeafDry"]

FORK_Z = 2.00
SEED = 5107

# The crown, as (centre, outer radii, core radii, core seg, blade count, seed).
# Two layers per cluster and they do different jobs:
#
#   CORE   a small tc.canopy_mass, roughly half the outer radius. Closed, so
#          it is opaque, and that is the point: it is the dark heart of the
#          clump, the thing that stops the crown looking like a cloud of loose
#          leaves. It is well INSIDE the silhouette and never draws it.
#   SPRAY  `count` individual leaf blades radiating from the core out to the
#          outer radii, in random directions biased upward. These draw the
#          whole outline, and the gaps between them are sky.
#
# Outer radii are oblate (z about 0.7 of the horizontal) per ASSET-SPECS 4.7.
CLUSTERS = (
    ((-0.78, 0.30, 3.95), (1.46, 1.34, 1.22), (0.76, 0.70, 0.66), 9, 60, 1),
    ((0.72, -0.38, 3.70), (1.34, 1.46, 1.14), (0.70, 0.76, 0.62), 9, 56, 2),
    ((0.14, 0.78, 3.30), (1.04, 0.98, 0.92), (0.54, 0.51, 0.50), 8, 46, 3),
    # A fourth cluster with NO core, hung low and to the back: it is pure
    # spray, so it thins the crown out towards its edge instead of adding
    # another closed lump. Three clean lumps read as balloons on a stick,
    # which is exactly what this pass exists to stop.
    ((-0.30, -0.62, 3.50), (0.96, 1.00, 0.74), None, 0, 38, 4),
)


def _trunk(p):
    """Root flare plus trunk to the fork. Identical in every variant. Jittered
    (not a perfect cylinder) but still round enough to read as a turned
    trunk."""
    v, f, sm, roles = tc.taper_bands(((0.44, 0.0), (0.30, 0.40)), seg=8,
                                     seed=SEED + 1, jit=0.05, roles="Bark")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.28, 0.36), (0.22, 2.20)), seg=8,
                                     seed=SEED + 2, jit=0.05, phase_deg=18,
                                     roles="Bark")
    p.add(v, f, sm, roles)
    return p


def _spray(p, centre, radii, count, seed, wf=0.32, wob=0.045):
    """`count` individual leaf blades radiating out of one cluster centre.

    Five verts and three tris each, the broadleaf's answer to the conifer's
    _frond: a narrow quad leaves the core, widens and kinks down at the mid
    ring, and closes to a drooping tip. The difference is that these point in
    ANY direction rather than radially in the XY plane, because a broadleaf
    crown is a ball of foliage and a conifer crown is a stack of skirts.

    Direction is a random azimuth plus an elevation biased upward (the sine of
    the elevation is drawn from -0.55 to 1.00, so roughly two thirds of the
    blades sit on the sunlit upper surface and the rest hang under). The
    direction vector is then scaled COMPONENTWISE by the cluster's radii, so
    the spray inherits the oblate crown shape for free.

    Why blades at all: four closed tc.canopy_mass spheroids can be jittered,
    overlapped and shaded as much as you like and they are still four solids
    of revolution with no holes. No sky ever came through the old crown from
    any angle, which is most of why it read as a blob on a stick. Every gap
    between two blades here is open sky. Flat geometry is safe because all
    four OF_Leaf* roles are in of_lib's DOUBLE_SIDED set and in this asset's
    double_sided_ok contract list.
    """
    nxt = hc.rng(seed)
    cx, cy, cz = centre
    rx, ry, rz = radii
    for _ in range(count):
        th = 2.0 * math.pi * nxt()
        ez = -0.60 + 1.50 * nxt()
        s = math.sqrt(max(0.0, 1.0 - ez * ez))
        vx, vy, vz = rx * s * math.cos(th), ry * s * math.sin(th), rz * ez
        # The blade starts on a SHELL, roughly at the core's surface, not at
        # the cluster centre. Blades that all converge on one point read as a
        # palm frond crown, which is what the first attempt at this looked
        # like: each blade covers only the outer 40 percent of the radius, and
        # it takes a lot of them to clothe the shell.
        fin = 0.50 + 0.14 * nxt()
        fout = 0.92 + 0.16 * nxt()
        bx, by, bz = cx + vx * fin, cy + vy * fin, cz + vz * fin
        tx, ty, tz = cx + vx * fout, cy + vy * fout, cz + vz * fout
        dx, dy, dz = tx - bx, ty - by, tz - bz
        ln = max(1e-4, math.sqrt(dx * dx + dy * dy + dz * dz))
        ux, uy = -dy, dx
        un = math.hypot(ux, uy)
        if un < 1e-6:
            ux, uy, un = 1.0, 0.0, 1.0
        ux, uy = ux / un, uy / un
        # Droop is scaled OUT of the blades that point upward. A flat droop
        # applied to every blade bends the top of the crown back down onto
        # itself and the whole thing collapses into a disc, which is what the
        # first version of this looked like; a horizontal blade should hang,
        # a blade reaching for the sky should not.
        droop = ln * (0.20 + 0.22 * nxt()) * (1.0 - 0.85 * max(0.0, ez))
        w0, w1 = ln * 0.07, ln * wf
        mx, my = bx + dx * 0.55, by + dy * 0.55
        mz = bz + dz * 0.55 - droop * 0.32

        def wz():
            return (nxt() - 0.5) * 2.0 * wob * ln

        # Underside blades are in the crown's own shadow, top blades catch the
        # sky: assigning that per blade rather than per horizontal band is what
        # gives the crown volume without a single extra triangle.
        if ez < -0.08:
            rr = ("LeafDeep", "LeafDeep")
        elif ez < 0.45:
            rr = ("LeafDeep", "Leaf")
        else:
            rr = ("Leaf", "LeafLight")
        if nxt() < 0.22:
            rr = (rr[0], rr[0])

        verts = [(bx - ux * w0, by - uy * w0, bz + wz()),
                 (bx + ux * w0, by + uy * w0, bz + wz()),
                 (mx - ux * w1, my - uy * w1, mz + wz()),
                 (mx + ux * w1, my + uy * w1, mz + wz()),
                 (tx, ty, tz - droop)]
        p.add(verts, [(0, 2, 3, 1), (2, 4, 3)], [False, False], list(rr))
    return p


def _crown(p, clusters):
    for centre, radii, core, seg, count, seed in clusters:
        if core is not None:
            v, f, sm, roles = tc.canopy_mass(core[0], core[1], core[2], centre,
                                             seg=seg, seed=SEED + seed,
                                             jit=0.17,
                                             bands=("LeafDeep", "LeafDeep",
                                                    "Leaf", "LeafLight"))
            p.add(v, f, sm, roles)
        _spray(p, centre, radii, count, SEED + 700 + seed * 37)
    return p


def full_lod0():
    p = hc.Parts()
    _trunk(p)
    v, f, sm, roles = tc.taper_bands(((0.18, FORK_Z), (0.11, 3.40)), seg=7,
                                     seed=SEED + 11, jit=0.08,
                                     lean=(-0.62, 0.22), roles="Bark")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.17, 2.05), (0.10, 3.25)), seg=7,
                                     seed=SEED + 12, jit=0.08,
                                     lean=(0.58, -0.30), roles="Bark")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.12, 2.30), (0.07, 3.10)), seg=6,
                                     seed=SEED + 13, jit=0.08,
                                     lean=(0.10, 0.55), roles="Bark")
    p.add(v, f, sm, roles)
    _crown(p, CLUSTERS)
    return p


def full_lod1():
    # Unchanged: NodeBatch.ts never draws this LOD, so no design effort spent
    # here, only enough geometry to keep the LOD chain and the contract valid.
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
    # Never drawn by the client today; kept exactly as before.
    p = hc.Parts()
    p.add(*hc.taper(trunk_r, trunk_r * 0.8, 0.0, trunk_h, seg=4), role="Bark")
    p.add(*hc.crossed_quads(width, height, z0=z0), role="Leaf")
    return p


def half_lod0():
    p = hc.Parts()
    _trunk(p)
    v, f, sm, roles = tc.taper_bands(((0.18, FORK_Z), (0.11, 3.20)), seg=7,
                                     seed=SEED + 21, jit=0.08,
                                     lean=(-0.55, 0.20), roles="Bark")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.17, 2.05), (0.13, 2.75)), seg=6,
                                     seed=SEED + 22, jit=0.08,
                                     lean=(0.28, -0.15), roles="Bark")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.canopy_mass(1.05, 0.98, 1.20, (-0.66, 0.26, 3.75),
                                     seg=8, seed=SEED + 11, jit=0.14,
                                     bands=("LeafDeep", "LeafDeep", "Leaf",
                                            "LeafLight"))
    p.add(v, f, sm, roles)
    v, f, sm = hc.blob(0.62, 0.58, 0.74, (0.34, -0.22, 3.05), seg=7,
                       seed=SEED + 12, jit=0.20)
    p.add(v, f, sm, role="LeafDry")
    return p


def half_lod1():
    # Unchanged, not drawn by the client.
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
    v, f, sm, roles = tc.taper_bands(((0.18, FORK_Z), (0.10, 2.85)), seg=6,
                                     seed=SEED + 31, jit=0.10,
                                     lean=(-0.42, 0.16), roles="Bark")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.16, 2.05), (0.09, 2.70)), seg=6,
                                     seed=SEED + 32, jit=0.10,
                                     lean=(0.38, -0.20), roles="Bark")
    p.add(v, f, sm, roles)
    v, f, sm = hc.blob(0.46, 0.44, 0.56, (-0.34, 0.14, 2.95), seg=6,
                       seed=SEED + 21, jit=0.20)
    p.add(v, f, sm, role="LeafDry")
    return p


def low_lod1():
    # Unchanged, not drawn by the client.
    p = hc.Parts()
    p.add(*hc.taper(0.34, 0.22, 0.0, 2.20, seg=6), role="Bark")
    p.add(*hc.blob(0.46, 0.44, 0.56, (-0.34, 0.14, 2.95), seg=5,
                   seed=SEED + 21, rings=(0.32, 0.70), radii=(0.85, 0.78)),
          role="LeafDry")
    return p


def stump_lod0():
    # Unchanged: the Stump variant is contract-required (lod_nodes) but never
    # drawn (NodeBatch.ts's VARIANTS list is Full/Half/Low only).
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
