"""
build_pillar.py - Tier-0 structural support pillar. FOUR PARTS, NOT ONE ASSET.

    blender --background --python tools/blender/build_pillar.py

Produces assets/models/dist/structures/pillar.glb.

WHY THIS EXISTS. DW-32 lets a foundation hang out over a drop, carried by the
neighbour it is butted against, and a base built along a ridge or a crater rim
therefore has decks standing well clear of the ground. A visible pillar is what
makes that read as engineering instead of as a bug in the terrain collision.

WHY IT CANNOT BE ONE MESH. The gap from an overhanging deck's underside to the
ground is a CONTINUOUS number: 0.9 m at the lip, 8 m thirty metres out. A single
pillar mesh scaled to fit stretches its own foot and its own bracket along with
its shaft, so a tall pillar grows a two-metre boot and a short one has none.

    PillarFoot     1.20 x 0.40 x 1.20    splayed base plate, on the ground
    PillarShaft    0.50 x 1.00 x 0.50    the only part that is ever scaled
    PillarCollar   0.70 x 0.24 x 0.70    a band, every 2 m, NEVER scaled
    PillarHead     1.00 x 0.30 x 1.00    the bracket under the deck

(dimensions in three.js axes: X right, Y up, Z forward)

THE SHAFT IS PRISMATIC, AND THAT IS THE WHOLE TRICK. Its cross section is
constant along the axis and there is NO vertical feature of any kind on it: no
taper, no rib, no band, no bolt. So scaling it in Y is not an approximation of
a longer shaft, it IS a longer shaft, exactly, at any length, and nothing can
distort because there is nothing along the axis to distort. It is authored at
EXACTLY 1.00 m so that scale.y is the length in metres and the client never
divides by an authored height it had to look up.

The cross section is an octagon rather than a square because a machined column
reads as machined when it has more than four faces to catch light on, and
because eight facets on a 0.5 m column is still 16 triangles of side wall. That
is the ONLY place the shaft is allowed to spend geometry, because every triangle
on it is a triangle that must survive being stretched by a factor of ten.

THE RHYTHM LIVES IN THE COLLAR. A featureless prism at 8 m long is a pipe. The
collar is what puts the beat back, and it works because it is placed at a fixed
PITCH (2.00 m) rather than at a fraction of the length: a 3 m pillar and a 9 m
pillar then have bands at the same absolute spacing, so they read as the same
part at two lengths instead of as two parts. It is never scaled, for the same
reason: a stretched band is a stretched band.

ASSEMBLY IS ARITHMETIC, and it lives in structure_common.pillar_parts() so the
renderer and the client share one copy:

    gap < PILLAR_MIN_H (0.70)   no pillar at all, the deck is close enough
    PillarFoot    y = 0                    0.40 tall
    PillarShaft   y = 0.40                 scale.y = gap - 0.70
    PillarCollar  y = 0.40 + 2.00 k        k = 1.., dropped near either end
    PillarHead    y = gap - 0.30           0.30 tall

LOD0 ONLY for all four parts, and that is a floor rather than an omission. The
shaft is 28 triangles and the collar 56; a decimator does not start saving
anything until well above that, and it would eat the octagon's silhouette first.
detail_cards.glb makes the same call for the same reason.

FILE LAYOUT is the rocket_parts.glb pattern: one group Empty per part, each
sitting on the file origin holding its own mesh, sockets and proxy. The runtime
rule is the same one: clone the PART node and query sockets on the clone, never
on the file root.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import structure_common as sc  # noqa: E402

NAME = "Pillar"
OUT = of.dist_path("structures", "pillar.glb")

SEG = 8                          # octagon: an 8-gon's AABB is exactly 2r

FOOT_W = 1.20
FOOT_H = sc.PILLAR_FOOT_H        # 0.40
SHAFT_W = 0.50
SHAFT_H = sc.PILLAR_SHAFT_LEN    # 1.00, so scale.y IS metres
COLLAR_W = 0.70
COLLAR_H = sc.PILLAR_COLLAR_H    # 0.24
HEAD_W = 1.00
HEAD_H = sc.PILLAR_HEAD_H        # 0.30

_report = []
_bounds = []


def _part(root, name, build, socket=None, collide=None):
    """One group Empty holding one LOD0 mesh, optionally a socket and a proxy.

    Every part is GROUND PIVOTED on the file origin, which is what lets the
    assembly recipe be four translations and one scale with no per-part offset
    to remember."""
    grp = of.add_pivot(name, (0.0, 0.0, 0.0), root)
    mb = of.MeshBuilder()
    build(mb)
    mb.build(name + "_LOD0", grp)
    if socket is not None:
        sname, loc, role = socket
        of.add_socket(sname, loc, parent=grp, extras={"of_role": role})
    if collide is not None:
        size, loc, role = collide
        of.add_collision_box("col_" + name, size, loc, grp, role=role)
    _report.append((name + "_LOD0", mb))
    _bounds.append((name + "_LOD0", mb))
    return grp


def foot(mb):
    """A hazard-painted ground plate, a bolted pad and a splay up to the shaft.

    The hazard yellow is here and nowhere else on the pillar: the foot is the
    only part of a pillar a player ever walks into, and a 0.5 m column standing
    in shadow under a deck is exactly the thing to trip over."""
    mb.box((FOOT_W, FOOT_W, 0.08), (0, 0, 0.04), "Hazard")
    mb.box((1.04, 1.04, 0.10), (0, 0, 0.11), "SteelDark")
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((0.18, 0.18, 0.06), (sx * 0.42, sy * 0.42, 0.19), "SteelDark")
    mb.frustum(0.46, 0.26, 0.26, (0, 0, 0.27), segments=SEG, role="SteelDark",
               smooth_sides=False)


def shaft(mb):
    """The prismatic octagon. Nothing else may ever go in this function: any
    feature added here is a feature that gets stretched."""
    mb.cylinder(SHAFT_W * 0.5, SHAFT_H, (0, 0, SHAFT_H * 0.5), segments=SEG,
                role="Steel", smooth_sides=False)


def collar(mb):
    """A sleeve with a proud band. Two octagons, so it belongs to the shaft's
    section rather than sitting on it as a separate idea."""
    mb.cylinder(0.29, COLLAR_H, (0, 0, COLLAR_H * 0.5), segments=SEG,
                role="SteelDark", smooth_sides=False)
    mb.cylinder(COLLAR_W * 0.5, 0.16, (0, 0, 0.12), segments=SEG,
                role="SteelDark", smooth_sides=False)


def head(mb):
    """A flare off the shaft into a square bearing plate. The plate is square
    and 1.00 m because what it meets is a square deck on a 4 m module, and a
    round bracket under a square slab reads as a mismatch of two systems."""
    mb.frustum(0.30, 0.44, 0.14, (0, 0, 0.07), segments=SEG, role="SteelDark",
               smooth_sides=False)
    mb.box((0.90, 0.90, 0.08), (0, 0, 0.18), "Steel")
    mb.box((HEAD_W, HEAD_W, 0.08), (0, 0, 0.26), "SteelDark")


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    _part(root, "PillarFoot", foot,
          socket=("socket_top", (0.0, 0.0, FOOT_H), "pillar_shaft_base"),
          collide=((FOOT_W, FOOT_W, FOOT_H), (0, 0, FOOT_H * 0.5), "SteelDark"))
    _part(root, "PillarShaft", shaft,
          collide=((SHAFT_W, SHAFT_W, SHAFT_H), (0, 0, SHAFT_H * 0.5), "Steel"))
    _part(root, "PillarCollar", collar)
    _part(root, "PillarHead", head,
          socket=("socket_deck", (0.0, 0.0, HEAD_H), "deck_underside"))

    of.report(NAME, _report)
    sc.report_bounds(NAME, _bounds)

    # Print the recipe the client codes against, resolved at three lengths, so
    # a reader of the build log can check the arithmetic without running it.
    for gap in (0.90, 3.60, 8.20):
        print("[pillar] gap %.2f m -> %s"
              % (gap, ["%s z=%.2f sy=%.2f" % p for p in sc.pillar_parts(gap)]))

    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
