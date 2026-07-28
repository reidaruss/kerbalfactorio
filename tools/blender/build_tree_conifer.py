"""build_tree_conifer.py - Conifer tree, worldgen::survival::NodeKind::Tree.

    blender --background --python tools/blender/build_tree_conifer.py

Produces assets/models/dist/nodes/tree_conifer.glb.

2.4 x 2.4 x 6.5 m. A tall narrow spire: a bare tapered trunk carrying fifteen
whorls of individual drooping branch blades, with a short green leader closing
the top. It is deliberately the opposite silhouette to the broadleaf, which is
wide, low and forked.

W12 pass (2026-07-28), THE OPEN CANOPY. Up to W11 the crown was five stacked
skirt tiers, each a closed radial sweep (tc.taper_bands). That construction
cannot be fixed by jitter or by phase offsets, and the triangle budget was
never the problem (584 of 900 spent). A solid of revolution has no holes in
it, so no sky ever showed through the crown, and the union of five concentric
sweeps is an outline made of circular arcs. Both are why it read as stacked
cones on a dowel at 5 m. The tiers are gone. What replaced them:

  * The crown is now ~121 SEPARATE BLADES (_frond, five verts and three tris
    each), hung in whorls off the trunk. Between any two neighbouring blades
    there is nothing at all, so sky shows through the canopy from every angle:
    that is the single change this pass exists for.
  * Blade REACH varies by nearly a factor of two inside one whorl (_whorl
    picks a length fraction per blade), and consecutive whorls disagree on
    their nominal radius on purpose (WHORLS is not monotonic: 1.30, 1.18,
    1.29, 1.09, 1.15 ...). The outline is therefore sawtoothed, not a stack of
    arcs, and no two whorls are concentric.
  * Each blade KINKS: it leaves the stem near level, then drops at the mid
    ring and again at the tip, so the profile has two slope changes per
    branch instead of one straight cone flank.
  * The BARK TRUNK IS NOW VISIBLE THROUGH THE CROWN, because nothing fills the
    space between the blades any more. That, plus the green leader running on
    past the trunk top to 6.55 m, is the strongest single "conifer" cue in the
    asset and it was previously buried inside the tiers.

Shading is still LeafDeep at the base through Leaf to LeafLight at the top,
but it is now assigned PER BLADE (with a one-in-four chance of a blade
dropping a step darker than its whorl) rather than per horizontal band, so the
crown mottles instead of striping. Faceted throughout, never smooth: flat
facets are the house style and hold up at 5 m. Two bare Bark stubs sit in the
gap between the root flare and the first whorl, the "this is a trunk, not a
dowel" cue. The client only ever draws _LOD0 of the Full/Half/Low variants
(NodeBatch.ts matches `_LOD0$` and drops Stump entirely), so LOD1/LOD2/Stump
keep their original cheap geometry unchanged; every triangle spent here goes
into the three visible LOD0s.

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

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import tree_common as tc       # noqa: E402

NAME = "TreeConifer"
OUT = of.dist_path("nodes", "tree_conifer.glb")
DIMS = (2.40, 2.40, 6.50)
ORDER = ["Bark", "LeafDeep", "Leaf", "LeafLight", "LeafDry"]

TRUNK_Z1 = 5.35
SEED = 4201

# The green leader: the last 1.5 m of stem, running on past the top of the
# bark trunk (TRUNK_Z1 = 5.35) to the 6.55 m tip. A conifer's trunk does not
# stop where its lowest branches stop, and a crown that just fades out has no
# spire. This is the only closed sweep left in the canopy and it is 12 cm
# wide, so it blocks nothing.
LEADER = ((0.135, 5.05), (0.098, 5.62), (0.062, 6.12), (0.022, 6.55))

# The whorls. (z, count, r_out, phase_deg, base_role, tip_role), one row per
# ring of branches up the trunk. r_out is the NOMINAL tip radius; each blade
# takes a random 0.60 to 1.00 of it, so the reach inside one whorl varies by
# two thirds and the tips do not land on a circle.
#
# r_out is deliberately NOT monotonic. A monotonically shrinking sequence is a
# cone no matter how the individual branches are built, so alternate whorls
# are pulled IN and pushed back OUT past their lower neighbour. Reading down
# the +x flank the outline therefore steps in and out instead of falling on
# one straight line, which is the difference between a tree and a bottle
# brush. Whorl SPACING is 0.24 m, close enough that neighbouring whorls
# interleave: a wide gap between whorls is what made the first attempt at this
# read as a fishbone rather than a crown.
WHORLS = (
    (1.45, 13, 1.36,  0, "LeafDeep", "Leaf"),
    (1.68, 12, 1.24, 27, "LeafDeep", "Leaf"),
    (1.92, 13, 1.34, 61, "LeafDeep", "Leaf"),
    (2.16, 12, 1.16, 14, "LeafDeep", "Leaf"),
    (2.40, 12, 1.30, 48, "LeafDeep", "Leaf"),
    (2.64, 11, 1.12, 79, "LeafDeep", "Leaf"),
    (2.88, 11, 1.22, 33, "Leaf", "LeafLight"),
    (3.12, 11, 1.04, 66, "LeafDeep", "Leaf"),
    (3.36, 10, 1.14,  9, "Leaf", "LeafLight"),
    (3.60, 10, 0.96, 52, "LeafDeep", "Leaf"),
    (3.84, 10, 1.04, 21, "Leaf", "LeafLight"),
    (4.08,  9, 0.88, 71, "LeafDeep", "Leaf"),
    (4.32,  9, 0.94, 38, "Leaf", "LeafLight"),
    (4.56,  9, 0.78,  5, "Leaf", "LeafLight"),
    (4.80,  8, 0.82, 57, "LeafDeep", "Leaf"),
    (5.04,  8, 0.66, 24, "Leaf", "LeafLight"),
    (5.28,  7, 0.58, 74, "Leaf", "LeafLight"),
    (5.52,  7, 0.48, 43, "Leaf", "LeafLight"),
    (5.78,  6, 0.36, 11, "Leaf", "LeafLight"),
    (6.06,  6, 0.25, 63, "Leaf", "LeafLight"),
    (6.30,  5, 0.16, 30, "Leaf", "LeafLight"),
)

# The Half variant's remaining green, same construction. This has to be blades
# too: the client draws Full_LOD0 and Half_LOD0 at the same distance and swaps
# between them as the node depletes, so a Half built out of closed tiers would
# pop from "tree" to "cone" the moment the axe took it past the threshold.
HALF_WHORLS = (
    (2.28, 11, 0.95,  0, "LeafDeep", "Leaf"),
    (2.50, 10, 0.84, 41, "LeafDeep", "Leaf"),
    (2.72, 10, 0.92, 17, "LeafDeep", "Leaf"),
    (2.94,  9, 0.80, 63, "LeafDeep", "Leaf"),
    (3.16,  9, 0.86, 29, "Leaf", "LeafLight"),
    (3.38,  8, 0.72, 72, "LeafDeep", "Leaf"),
    (3.60,  8, 0.78,  8, "Leaf", "LeafLight"),
    (3.82,  7, 0.64, 50, "LeafDeep", "Leaf"),
    (4.04,  7, 0.68, 22, "Leaf", "LeafLight"),
    (4.26,  6, 0.54, 66, "Leaf", "LeafLight"),
    (4.48,  6, 0.44, 35, "LeafDry", "LeafDry"),
    (4.72,  5, 0.36, 12, "LeafDry", "LeafDry"),
    (4.96,  5, 0.28, 58, "LeafDry", "LeafDry"),
)

# Two bare branch stubs in the visible gap between the root flare (ends
# z=0.42) and the first skirt tier (starts z=1.72): the cue that this is a
# living trunk and not a cone on a dowel.
STUBS = (
    ((0.34, -0.10, 0.0), 0.95, 1.32, (0.05, -0.03), 4401),
    ((-0.30, 0.16, 0.0), 1.18, 1.52, (-0.04, 0.05), 4407),
)


def _trunk(p):
    """Root flare plus trunk. IDENTICAL in every variant except the stump.
    Jittered (not a perfect cylinder) but still round enough to read as a
    turned trunk rather than a canopy tier."""
    v, f, sm, roles = tc.taper_bands(((0.34, 0.0), (0.21, 0.42)), seg=8,
                                     seed=SEED + 1, jit=0.05, roles="Bark")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.20, 0.38), (0.105, TRUNK_Z1)),
                                     seg=8, seed=SEED + 2, jit=0.05,
                                     phase_deg=22, roles="Bark")
    p.add(v, f, sm, roles)
    return p


def _stubs(p):
    for loc, z0, z1, lean, seed in STUBS:
        v, f, sm, roles = tc.taper_bands(((0.055, z0), (0.022, z1)), seg=4,
                                         seed=seed, jit=0.10, lean=lean,
                                         loc=loc, roles="Bark")
        p.add(v, f, sm, roles)
    return p


def _leader(p):
    """The green stem tip above the bark trunk."""
    v, f, sm, roles = tc.taper_bands(LEADER, seg=6, seed=SEED + 9, jit=0.16,
                                     phase_deg=18,
                                     roles=["Leaf", "Leaf", "LeafLight"])
    p.add(v, f, sm, roles)
    return p


def _stem_r(z):
    """Radius of whatever the canopy hangs off at height z: the bark trunk
    below TRUNK_Z1, the green leader above. Blade bases are set from this and
    then pulled 20 percent further in, so a blade always starts INSIDE the
    stem and can never be caught floating in the gap it now has to cross."""
    if z <= TRUNK_Z1:
        t = min(1.0, max(0.0, (z - 0.38) / (TRUNK_Z1 - 0.38)))
        return 0.20 + (0.105 - 0.20) * t
    t = min(1.0, max(0.0, (z - LEADER[0][1]) / (LEADER[-1][1] - LEADER[0][1])))
    return LEADER[0][0] + (LEADER[-1][0] - LEADER[0][0]) * t


def _frond(nxt, az_deg, r0, r1, z0, droop, roles, kink=0.30, wf=0.21,
           wob=0.055):
    """ONE branch blade. Five vertices, three triangles, and no back side.

    This is the primitive the whole W12 pass turns on. A closed skirt tier is
    a solid of revolution: whatever you do to its radii it still has no holes,
    so the crown never shows sky and its outline is always an arc. A blade has
    two neighbours and a GAP on each side of it, and the gaps are the point.

    Shape, from the stem outwards: a narrow quad leaves the trunk roughly
    level, widens to the mid ring where the blade KINKS downward, then closes
    to a single drooping tip triangle. Two slope changes per branch, so the
    silhouette of the whole whorl is sawtoothed. Every vertex except the tip
    also takes a small independent z wobble, which leaves the base quad
    non-planar; Blender triangulates it across the diagonal and the resulting
    crease catches directional light down the length of the blade.

    Flat geometry is legal here because every OF_Leaf* role is in of_lib's
    DOUBLE_SIDED set AND in this asset's double_sided_ok contract list, so a
    blade reads from underneath as well as from above. Without that these
    would vanish half the time and the fix would be worse than the bug.
    """
    a = math.radians(az_deg)
    ca, sa = math.cos(a), math.sin(a)
    ln = max(0.02, r1 - r0)
    rm = r0 + ln * 0.55
    zm = z0 - droop * kink
    w0, w1 = ln * 0.06, ln * wf

    def pt(r, w, z):
        return (r * ca - w * sa, r * sa + w * ca,
                z + (nxt() - 0.5) * 2.0 * wob * ln)

    verts = [pt(r0, -w0, z0), pt(r0, w0, z0),
             pt(rm, -w1, zm), pt(rm, w1, zm),
             (r1 * ca, r1 * sa, z0 - droop)]
    return verts, [(0, 2, 3, 1), (2, 4, 3)], [False, False], list(roles)


def _whorl(p, z, count, r_out, phase_deg, roles, seed):
    """One ring of blades. The variation lives HERE, not in per-vertex jitter:
    length, azimuth, attachment height and palette role are all drawn per
    blade, so a whorl is a ragged spray rather than a rotated copy."""
    nxt = hc.rng(seed)
    r0 = _stem_r(z) * 0.80
    for i in range(count):
        # +/- a full slot of azimuth wander, which is enough for two blades to
        # bunch up and leave a real hole on the far side. Evenly spaced blades
        # rebuild the arc the tiers used to draw.
        az = phase_deg + 360.0 * i / count + (nxt() - 0.5) * (640.0 / count)
        f = 0.60 + 0.40 * nxt()
        zz = z + (nxt() - 0.5) * 0.16
        # One blade in four drops a step darker than its whorl, so the crown
        # mottles instead of banding into horizontal stripes of one colour.
        rr = roles if nxt() > 0.26 else (roles[0], roles[0])
        r1 = r0 + (r_out - r0) * f
        v, fc, sm, rl = _frond(nxt, az, r0, r1, zz,
                               (r1 - r0) * (0.38 + 0.24 * nxt()), rr)
        p.add(v, fc, sm, rl)
    return p


def full_lod0():
    p = hc.Parts()
    _trunk(p)
    _stubs(p)
    _leader(p)
    for i, (z, count, r_out, ph, base, tip) in enumerate(WHORLS):
        _whorl(p, z, count, r_out, ph, (base, tip), SEED + 40 + i * 17)
    return p


def full_lod1():
    # Unchanged: NodeBatch.ts never draws this LOD, so no design effort spent
    # here, only enough geometry to keep the LOD chain and the contract valid.
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
    """LOD2: a trunk stub plus two crossed foliage quads. Never drawn by the
    client today (NodeBatch.ts is LOD0-only); kept exactly as before."""
    p = hc.Parts()
    p.add(*hc.taper(trunk_r, trunk_r * 0.7, 0.0, trunk_h, seg=4), role="Bark")
    p.add(*hc.crossed_quads(width, height, z0=z0), role="Leaf")
    return p


def half_lod0():
    """Half depletion: the lower skirt is stripped, what is left is a shorter
    band of blades with a dead crown above it. The two LeafDry tapers stay
    CLOSED on purpose - a dead top is a bare spar with the needles gone, so a
    solid narrow cone is the right read for it and the contrast against the
    open green below is itself the depletion signal."""
    p = hc.Parts()
    _trunk(p)
    for i, (z, count, r_out, ph, base, tip) in enumerate(HALF_WHORLS):
        _whorl(p, z, count, r_out, ph, (base, tip), SEED + 200 + i * 23)
    v, f, sm, roles = tc.taper_bands(((0.22, 4.80), (0.11, 5.70)), seg=8,
                                     seed=SEED + 203, jit=0.14, phase_deg=40,
                                     roles="LeafDry")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.20, 5.60), (0.05, 6.40)), seg=7,
                                     seed=SEED + 204, jit=0.12, phase_deg=12,
                                     roles="LeafDry")
    p.add(v, f, sm, roles)
    return p


def half_lod1():
    # Unchanged, not drawn by the client.
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
        v, f, sm, roles = tc.taper_bands(((0.075, z), (0.035, z + ln)),
                                         seg=4, seed=4501 + int(z * 100),
                                         jit=0.10, loc=(x, y, 0.0),
                                         roles="Bark")
        p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.40, 5.05), (0.12, 5.95)), seg=8,
                                     seed=SEED + 301, jit=0.10, phase_deg=15,
                                     roles="LeafDry")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.20, 5.85), (0.05, 6.35)), seg=6,
                                     seed=SEED + 302, jit=0.08, roles="LeafDry")
    p.add(v, f, sm, roles)
    return p


def low_lod1():
    # Unchanged, not drawn by the client.
    p = hc.Parts()
    p.add(*hc.taper(0.26, 0.105, 0.0, TRUNK_Z1, seg=6), role="Bark")
    p.add(*hc.taper(0.40, 0.05, 5.05, 6.35, seg=6), role="LeafDry")
    return p


def stump_lod0():
    # Unchanged: the Stump variant is contract-required (lod_nodes) but never
    # drawn (NodeBatch.ts's VARIANTS list is Full/Half/Low only).
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
