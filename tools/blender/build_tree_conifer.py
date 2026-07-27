"""build_tree_conifer.py - Conifer tree, worldgen::survival::NodeKind::Tree.

    blender --background --python tools/blender/build_tree_conifer.py

Produces assets/models/dist/nodes/tree_conifer.glb.

2.4 x 2.4 x 6.5 m. A tall narrow spire: stacked skirt tiers on a straight
tapered trunk, every tier phase-rotated off its neighbour and three branch
lobes hung asymmetrically off the sides. The phase rotation and the stray
lobes are the whole reason it does not read as a procedural cone, and they are
what makes it look hand placed next to the broadleaf, whose silhouette is
deliberately the opposite shape: wide, low and forked.

W11 pass (2026-07-27): every tier is now jittered (tc.taper_bands, a per-vertex
seeded wobble on every ring) instead of a perfect circular frustum, and each
tier shades through three bands - LeafDeep at the shadowed base, Leaf through
the middle, LeafLight at the sunlit tip - with the split point biased lower
for the ground tiers and higher for the crown, so the WHOLE tree reads
shadow-at-the-bottom, lit-at-the-top and not just each tier in isolation. Two
bare Bark stubs sit in the gap between the root flare and the first tier, the
"this is a trunk, not a dowel" cue. The client only ever draws _LOD0 of the
Full/Half/Low variants (NodeBatch.ts matches `_LOD0$` and drops Stump
entirely), so LOD1/LOD2/Stump keep their original cheap geometry unchanged;
every triangle spent here goes into the three visible LOD0s.

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
ORDER = ["Bark", "LeafDeep", "Leaf", "LeafLight", "LeafDry"]

TRUNK_Z1 = 5.35
SEED = 4201

# (r0, r1, z0, z1, phase_deg, lean, splits). splits is the (low, high)
# fraction of the tier's own height where LeafDeep hands off to Leaf and Leaf
# hands off to LeafLight: pushed high for the ground tiers (mostly in shadow,
# a thin lit cap) and low for the crown (mostly lit, a thin shadowed collar),
# so the tree reads dark-to-light bottom-to-top as a whole, not just per tier.
TIERS = (
    (1.24, 0.92, 1.72, 2.30, 48, (0.05, -0.03), (0.50, 0.86)),
    (1.16, 0.42, 2.15, 3.75,  0, (-0.05, 0.04), (0.40, 0.75)),
    (0.96, 0.34, 3.45, 4.95, 20, (0.04, 0.05), (0.30, 0.65)),
    (0.66, 0.24, 4.70, 5.85, 40, (-0.04, -0.03), (0.20, 0.55)),
    (0.34, 0.05, 5.70, 6.55, 12, (0.03, 0.03), (0.10, 0.40)),
)

# Four asymmetric branch lobes hung off the sides, none sharing a centre with
# the trunk or with each other. Roles vary per lobe rather than per face so
# one interior lobe reads as shadow, the outer two catch light.
LOBES = (
    ((0.62, -0.30, 2.55), (0.44, 0.36, 0.58), 6, 0, "LeafDeep"),
    ((-0.58, 0.36, 3.85), (0.36, 0.42, 0.48), 6, 1, "Leaf"),
    ((0.34, 0.50, 4.85), (0.30, 0.28, 0.40), 5, 2, "LeafLight"),
    ((-0.40, -0.42, 3.95), (0.24, 0.26, 0.34), 5, 3, "LeafLight"),
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


def _tier(r0, r1, z0, z1, seg, seed, phase_deg=0.0, lean=(0.0, 0.0),
          splits=(0.35, 0.70), jit=0.13):
    """One skirt tier: a 4-ring taper_bands (3 side bands) shading
    LeafDeep -> Leaf -> LeafLight from base to tip."""
    za = z0 + (z1 - z0) * splits[0]
    zb = z0 + (z1 - z0) * splits[1]
    ra = r0 + (r1 - r0) * splits[0]
    rb = r0 + (r1 - r0) * splits[1]
    return tc.taper_bands(((r0, z0), (ra, za), (rb, zb), (r1, z1)), seg=seg,
                          seed=seed, jit=jit, phase_deg=phase_deg, lean=lean,
                          roles=["LeafDeep", "Leaf", "LeafLight"])


def _tier2(r0, r1, z0, z1, seg, seed, phase_deg=0.0, lean=(0.0, 0.0),
           split=0.5, roles=("LeafDeep", "Leaf"), jit=0.13):
    """A two-band tier for the Half variant's remaining green skirt."""
    zm = z0 + (z1 - z0) * split
    rm = r0 + (r1 - r0) * split
    return tc.taper_bands(((r0, z0), (rm, zm), (r1, z1)), seg=seg, seed=seed,
                          jit=jit, phase_deg=phase_deg, lean=lean,
                          roles=list(roles))


def full_lod0():
    p = hc.Parts()
    _trunk(p)
    _stubs(p)
    for i, (r0, r1, z0, z1, ph, lean, splits) in enumerate(TIERS):
        v, f, sm, roles = _tier(r0, r1, z0, z1, seg=10, seed=SEED + 20 + i * 13,
                                phase_deg=ph, lean=lean, splits=splits)
        p.add(v, f, sm, roles)
    for loc, r, seg, seed, role in LOBES:
        v, f, sm, roles = hc.lobe(r[0], r[1], r[2], loc=loc, seg=seg,
                                  seed=SEED + seed * 31, jit=0.20, role=role)
        p.add(v, f, sm, roles)
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
    p = hc.Parts()
    _trunk(p)
    v, f, sm, roles = _tier2(0.86, 0.34, 2.30, 3.70, seg=9, seed=SEED + 201,
                             phase_deg=0, lean=(-0.03, 0.04), split=0.55,
                             roles=("LeafDeep", "Leaf"))
    p.add(v, f, sm, roles)
    v, f, sm, roles = _tier2(0.70, 0.26, 3.55, 4.80, seg=9, seed=SEED + 202,
                             phase_deg=20, lean=(0.04, -0.03), split=0.4,
                             roles=("Leaf", "LeafLight"))
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.48, 4.65), (0.18, 5.70)), seg=9,
                                     seed=SEED + 203, jit=0.12, phase_deg=40,
                                     roles="LeafDry")
    p.add(v, f, sm, roles)
    v, f, sm, roles = tc.taper_bands(((0.28, 5.60), (0.05, 6.40)), seg=8,
                                     seed=SEED + 204, jit=0.10, phase_deg=12,
                                     roles="LeafDry")
    p.add(v, f, sm, roles)
    v, f, sm, roles = hc.lobe(0.34, 0.30, 0.44, loc=(-0.50, 0.30, 3.40),
                              seg=6, seed=SEED + 77, jit=0.20, role="LeafDeep")
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
