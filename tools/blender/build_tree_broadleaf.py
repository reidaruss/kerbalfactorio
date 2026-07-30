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
import props_common as pc      # noqa: E402  (foliage card UV helpers)

NAME = "TreeBroadleaf"
OUT = of.dist_path("nodes", "tree_broadleaf.glb")
DIMS = (4.00, 4.00, 5.00)
ORDER = ["Bark", "LeafDeep", "Leaf", "LeafLight", "LeafDry"]

FORK_Z = 2.00
SEED = 5107

# The crown, as (centre, radii, card count, seed). One entry per clump.
#
# THERE IS NO LONGER A SOLID MASS ANYWHERE IN THIS TREE. Up to W11 the crown
# was four closed tc.canopy_mass spheroids, and a measurement of the rendered
# silhouette put the sky visible THROUGH the canopy at 0.27 percent of its own
# area: it was a solid, full stop, which is the whole reason it read as a blob
# on a stick. Shrinking those masses and fringing them with cards was tried
# and only reached 0.67 percent, because a closed spheroid of ANY size is
# still opaque and it sits exactly where you would want to see through. They
# are gone. A clump is now nothing but a loose cloud of leaf cards spread
# through its own volume, and the gaps between them are the canopy's sky.
#
# Radii are oblate (z about 0.75 of the horizontal) per ASSET-SPECS 4.7.
CLUSTERS = (
    ((-0.92, 0.30, 3.98), (1.42, 1.30, 1.34), 72, 1),
    ((0.86, -0.38, 3.72), (1.30, 1.42, 1.26), 68, 2),
    ((0.14, 0.82, 3.48), (1.02, 0.96, 0.92), 52, 3),
    # A fourth clump hung low and to the back, smaller and thinner than the
    # other three: it stops the crown resolving into a countable number of
    # equal lumps, which is what "three balloons tied to a stick" looks like.
    ((-0.30, -0.66, 3.62), (0.94, 0.98, 0.76), 42, 4),
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


def _spray(p, centre, radii, count, seed, dry=False):
    """`count` leaf CARDS scattered over one cluster's shell. Four verts and
    two triangles each, which is the cheapest patch of foliage there is.

    Why cards and not the conifer's radial blades. A blade pointing straight
    out from the crown centre is seen EDGE ON from roughly half the directions
    you can look at the tree from, so a crown built of them alternates between
    solid and a scatter of slivers as the camera moves, and at rest it reads
    as a wreath of spikes rather than foliage. That was the second attempt at
    this and it was worse than the blob it replaced. A card lies TANGENT to
    the crown surface instead: it faces the viewer wherever it is on the
    shell, so it always presents area, and the gaps between neighbouring cards
    are what the sky comes through.

    Each card sits at a random point on the cluster's ellipsoid, sized from
    the local shell scale, and its four corners are independently pushed in or
    out radially by up to 15 percent. That does three jobs at once: the card
    is non-planar, so Blender's triangulation puts a crease across it and the
    two halves catch light differently; the cards no longer lie on a common
    smooth surface, so there are no concentric arcs; and the outline of the
    crown becomes the ragged union of corner positions rather than an
    ellipse.

    Flat geometry is safe because all four OF_Leaf* roles are in of_lib's
    DOUBLE_SIDED set and in this asset's double_sided_ok contract list.
    """
    nxt = hc.rng(seed)
    cx, cy, cz = centre
    rx, ry, rz = radii
    rm = (rx + ry + rz) / 3.0
    for ci in range(count):
        th = 2.0 * math.pi * nxt()
        # Elevation biased upward: the sine is drawn from -0.62 to 0.94, so
        # roughly two thirds of the cards clothe the sunlit upper surface and
        # the rest hang under the crown in its own shadow.
        ez = -0.62 + 1.56 * nxt()
        s = math.sqrt(max(0.0, 1.0 - ez * ez))
        vx, vy, vz = rx * s * math.cos(th), ry * s * math.sin(th), rz * ez
        vn = max(1e-4, math.sqrt(vx * vx + vy * vy + vz * vz))
        nx, ny, nz = vx / vn, vy / vn, vz / vn

        # In-plane axes: u horizontal, w up the slope of the shell.
        ux, uy = -ny, nx
        un = math.hypot(ux, uy)
        if un < 1e-6:
            ux, uy, un = 1.0, 0.0, 1.0
        ux, uy = ux / un, uy / un
        wx, wy, wz_ = -nz * uy, nz * ux, nx * uy - ny * ux

        # Cards sit at any DEPTH from 0.42 to 1.02 of the radius, not on one
        # shell. A single shell of cards is a hollow ball: dense enough to
        # cover and it is opaque again, sparse enough to see through and the
        # crown reads as an empty wreath. Scattered through the volume, the
        # canopy has interior leaves to look at AND the holes in the near and
        # far layers only occasionally line up, which is what real foliage
        # does.
        fs = 0.42 + 0.60 * nxt()
        # Card SIZE is the sky dial and it was set by measurement, not taste.
        # Total card area over the crown's projected area is the coverage
        # factor, and visible sky falls off as exp(-coverage): the W11 crown
        # ran at coverage 10 and showed 0.27 percent sky. Many small cards at
        # coverage near 2 hold the same apparent mass and let roughly an
        # eighth of the canopy through, which is the difference between
        # foliage and a solid.
        a = rm * (0.085 + 0.075 * nxt())
        # One card in five is half again as big. A crown of identically-sized
        # cards is a texture; a few broad ones among many small ones is what
        # makes it read as clumps of leaves on branches.
        if nxt() < 0.20:
            a *= 1.55
        b = a * (0.62 + 0.40 * nxt())
        px, py, pz = cx + vx * fs, cy + vy * fs, cz + vz * fs

        verts = []
        for su, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            # Corner offsets are scaled IN PLANE as well as pushed radially,
            # so a card is an irregular quadrilateral rather than a rectangle.
            # A shell of identical rectangles reads as tiling, which is the
            # same failure as a circular arc, one dimension down.
            su *= 0.58 + 0.84 * nxt()
            sw *= 0.58 + 0.84 * nxt()
            k = (nxt() - 0.5) * 0.30 * rm
            verts.append((px + ux * a * su + wx * b * sw + nx * k,
                          py + uy * a * su + wy * b * sw + ny * k,
                          pz + wz_ * b * sw + nz * k))

        # Underside cards are in the crown's own shadow, top cards catch the
        # sky. Assigning that per card rather than per horizontal band is what
        # gives the crown volume without a single extra triangle, and the
        # one-in-five darkening stops the two zones banding into stripes.
        if dry:
            role = "LeafDry"
        elif ez < -0.10:
            role = "LeafDeep"
        elif ez < 0.42:
            role = "Leaf" if nxt() > 0.45 else "LeafDeep"
        else:
            role = "LeafLight" if nxt() > 0.38 else "Leaf"
        # A crown card is a whole leaf: the full "leaf" card once, upright
        # in the card's own (u along, w up-slope) frame, mirror hashed from
        # the card index so no rng draw moves the geometry.
        p.add(verts, [(0, 1, 2, 3)], [False], role,
              uvs=pc.quad_card_uvs(1, seed * 8191 + ci))
    return p


def _crown(p, clusters):
    for centre, radii, count, seed in clusters:
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
    v, f, sm = hc.blob(1.35, 1.25, 1.55, (-0.78, 0.30, 4.05), seg=6,
                       seed=SEED + 1, rings=(0.30, 0.68), radii=(0.85, 0.80))
    p.add(v, f, sm, "Leaf",
          uvs=pc.shell_uvs(v, SEED + 1, centre=(-0.78, 0.30)))
    v, f, sm = hc.blob(1.25, 1.35, 1.45, (0.72, -0.38, 3.95), seg=6,
                       seed=SEED + 2, rings=(0.30, 0.68), radii=(0.85, 0.80))
    p.add(v, f, sm, "Leaf",
          uvs=pc.shell_uvs(v, SEED + 2, centre=(0.72, -0.38)))
    return p


def _impostor(width, height, z0, trunk_r, trunk_h):
    # Never drawn by the client today; kept as before apart from the card UVs.
    p = hc.Parts()
    p.add(*hc.taper(trunk_r, trunk_r * 0.8, 0.0, trunk_h, seg=4), role="Bark")
    v, f, sm = hc.crossed_quads(width, height, z0=z0)
    p.add(v, f, sm, "Leaf", uvs=pc.quad_card_uvs(2, int(width * 1000)))
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
    # Cards here too. The client draws Full_LOD0 and Half_LOD0 at the same
    # distance and swaps between them as the node depletes, so a Half still
    # built out of a closed tc.canopy_mass would pop from "leaves" back to
    # "solid" the moment the axe took it past the threshold.
    _spray(p, (-0.66, 0.26, 3.75), (1.06, 1.00, 1.14), 58, SEED + 811)
    _spray(p, (0.34, -0.22, 3.05), (0.64, 0.60, 0.72), 24, SEED + 823, dry=True)
    return p


def half_lod1():
    # Unchanged, not drawn by the client.
    p = hc.Parts()
    p.add(*hc.taper(0.34, 0.22, 0.0, 2.20, seg=6), role="Bark")
    p.add(*hc.taper(0.18, 0.11, FORK_Z, 3.20, seg=5, lean=(-0.55, 0.20)),
          role="Bark")
    v, f, sm = hc.blob(1.05, 0.98, 1.20, (-0.66, 0.26, 3.75), seg=6,
                       seed=SEED + 11, rings=(0.30, 0.68), radii=(0.85, 0.80))
    p.add(v, f, sm, "Leaf",
          uvs=pc.shell_uvs(v, SEED + 11, centre=(-0.66, 0.26)))
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
    p.add(v, f, sm, role="LeafDry",
          uvs=pc.shell_uvs(v, SEED + 21, centre=(-0.34, 0.14)))
    return p


def low_lod1():
    # Unchanged, not drawn by the client.
    p = hc.Parts()
    p.add(*hc.taper(0.34, 0.22, 0.0, 2.20, seg=6), role="Bark")
    v, f, sm = hc.blob(0.46, 0.44, 0.56, (-0.34, 0.14, 2.95), seg=5,
                       seed=SEED + 21, rings=(0.32, 0.70), radii=(0.85, 0.78))
    p.add(v, f, sm, "LeafDry",
          uvs=pc.shell_uvs(v, SEED + 22, centre=(-0.34, 0.14)))
    return p


def stump_lod0():
    # Unchanged: the Stump variant is contract-required (lod_nodes) but never
    # drawn (NodeBatch.ts's VARIANTS list is Full/Half/Low only).
    p = hc.Parts()
    p.add(*hc.taper(0.44, 0.30, 0.0, 0.40, seg=8), role="Bark")
    p.add(*hc.taper(0.29, 0.27, 0.38, 0.70, seg=8), role="Bark")
    # Sapwood cut face on the LeafDry role: disc UVs on the card's opaque
    # centre, same as the conifer stump.
    v, f, sm = hc.ngon(8, 0.265, 0.71, seed=SEED + 5, jit=0.04)
    p.add(v, f, sm, "LeafDry", uvs=pc.disc_uvs(v))
    return p


def stump_lod1():
    p = hc.Parts()
    p.add(*hc.taper(0.42, 0.28, 0.0, 0.68, seg=6), role="Bark")
    v, f, sm = hc.ngon(6, 0.275, 0.69, seed=SEED + 6, jit=0.03)
    p.add(v, f, sm, "LeafDry", uvs=pc.disc_uvs(v))
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
