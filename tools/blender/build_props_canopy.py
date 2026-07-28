"""build_props_canopy.py - the mature canopy trees, as SCENERY.

    blender --background --python tools/blender/build_props_canopy.py

Produces assets/models/dist/props/props_canopy.glb. Three props, all scatter,
none of them harvestable, none of them collidable.

THE ONE DESIGN RULE. Forest already has two LIVE trees standing in it and both
of them are harvest nodes: TreeConifer (2.40 x 2.40 x 6.50 m, skirted with
branches all the way down to the ground) and TreeBroadleaf (4.00 x 4.00 x
5.00 m, a wide low forked crown starting at 2.0 m). props_forest.py could
therefore contain no live tree at all, because a scatter tree that looked like
either one would read as a node the player cannot chop. This file is the way
out of that, and the way out is a rule the game states in words:

    HARVEST trees are small and branched to the ground.
    CANOPY trees are mature: twice the height or more, with a BARE TRUNK for
    the lower half and the crown carried high.

That has to survive being read off a silhouette at 200 m, where colour, bark
detail and the hover prompt are all gone and the only surviving signal is the
outline. So the rule is enforced as geometry, strictly, with no foliage of any
role below the stated fraction:

    Canopy_Pine        3.10 x 3.10 x 12.00 m   crown in the top 45%, bare 0.55
    Canopy_Fir         2.60 x 2.60 x 16.50 m   crown in the top 38%, bare 0.62
    Canopy_Broadleaf   9.00 x 9.00 x 10.50 m   forks at 0.45, crown above 0.60

Canopy_Fir is the EMERGENT and it is the single most important silhouette in
the set: at 16.5 m it is 2.5x the conifer harvest node and it is the shape that
breaks the canopy line, so a stand of forest reads as a canopy with something
standing out of it rather than as a field of the same tree at two sizes. The
pine carries a few bare Bark limb stubs in the 45 to 58% band, which is the
transition that says the bare trunk is bare because the lower limbs were shed,
not because the mesh simply starts there.

MATERIALS. Exactly four roles, pinned in this order on every prop:

    Bark, LeafDeep, Leaf, LeafLight

and NOT one role more. Material count, not triangle count, is the real budget
for a scatter atlas (props_common.py, point 2): the renderer batches by
material, so a new role name would cost one extra draw call in the near pass
plus one more per shadow cascade, every chunk, forever. All four of these are
already live batch keys in the client (OF_Bark, OF_LeafDeep, OF_Leaf,
OF_LeafLight), so this whole atlas is ZERO additional draw calls. Colour lives
in the material and never in geometry.

Inside that budget the crowns shade bottom to top rather than per tier:
LeafDeep on the shadowed underside, Leaf through the middle, LeafLight at the
sunlit tip. Every tier and every crown mass hands off between the three at its
own split point, biased low in the crown (mostly lit, a thin shadowed collar)
and high at the bottom of the crown (mostly shadow, a thin lit cap), so the
WHOLE tree reads dark-at-the-bottom and lit-at-the-top and not just each tier
in isolation. It is the same argument build_tree_conifer.py makes for its
per-tier `splits`, re-implemented here in _bands/_dome rather than imported,
because these are scatter props and must not depend on the harvest-node rig.

LOD2 IS A CONE, NOT A CROSSED QUAD. Props are LOD0 and LOD2 only, and LOD2 is
the tree from roughly 150 m to 500 m, which is where nearly every instance of a
canopy tree actually is. So LOD2 is hand authored, never a COLLAPSE decimate
(a collapse decimator eats a conifer tier whole and leaves a shard) and never
the crossed-quad impostor the harvest trees carry. There is no texture pipeline
in this project (props_common.py:54-62), and an untextured crossed quad renders
as a solid rectangle standing in the forest. A 5-sided cone on a 4-sided trunk
stub is silhouette-correct with no texture at all, costs the same handful of
triangles, and keeps the bare-trunk rule readable at the distance the rule was
written for. Every LOD2 here is fitted to the same box as its LOD0, so the two
occupy identical space and the switch cannot pop.

COLLISION. None. collide=False on all three, and there is no col_ proxy in the
file. Nothing in the client collides with a scatter prop today: `collides` is
consumed by exactly one caller, the contact-skirt code in
web/src/world/ScatterEmit.ts:115, so a collider per canopy tree would be a lie
that costs a box per instance. The contract still declares max_tris_collision
12 to keep the same shape as every other atlas.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsCanopy"
OUT = of.dist_path("props", "props_canopy.glb")

# The pinned slot order, identical on all three props. Adding a fifth name here
# is a draw call, so it does not happen without an Admin-logged decision.
ORDER = ["Bark", "LeafDeep", "Leaf", "LeafLight"]


# ---------------------------------------------------------------------------
# Local geometry. Deliberately NOT imported from tree_common: that module is
# the harvest-node rig's shared code and these are scatter props, which carry
# no rig, no depletion variants and no clips. Two small functions is a cheaper
# coupling than a shared module that both families have to agree about.
# ---------------------------------------------------------------------------

def _bands(rings, seg=6, seed=1, jit=0.07, phase_deg=0.0, lean=(0.0, 0.0),
           loc=(0.0, 0.0, 0.0), roles="Bark", caps=(True, True)):
    """A stack of jittered rings along +Z with ONE PALETTE ROLE PER SIDE BAND.

    rings is ((radius, z), ...) bottom to top, at least two entries. `roles` is
    one role for the whole stack or one per side band (len(rings) - 1), which
    is how a single conifer tier shades LeafDeep to Leaf to LeafLight for zero
    extra triangles. `lean` offsets the TOP ring in x/y and is interpolated
    down the stack, so a limb forks away from the trunk with no rotation
    machinery.

    `caps` is (bottom, top). Both are on by default because the underside of a
    tier is the face a player standing under a canopy tree actually looks at.
    An LOD2 trunk stub turns both off: its base is buried in the terrain and
    its top is buried in the crown, so two caps there are triangles no camera
    can reach.

    Triangles: caps * (seg - 2) + 2 * seg * (len(rings) - 1).
    """
    n = max(3, seg)
    k = len(rings)
    if k < 2:
        raise ValueError("_bands needs at least 2 rings, got %d" % k)
    band_roles = [roles] * (k - 1) if isinstance(roles, str) else list(roles)
    if len(band_roles) != k - 1:
        raise ValueError("_bands got %d role(s) for %d side band(s)"
                         % (len(band_roles), k - 1))
    nxt = hc.rng(seed)
    ph = math.radians(phase_deg)
    verts = []
    for ri, (r, z) in enumerate(rings):
        t = ri / float(k - 1)
        dx, dy = lean[0] * t, lean[1] * t
        for i in range(n):
            a = 2.0 * math.pi * i / n + ph
            rr = r * (1.0 + (nxt() - 0.5) * 2.0 * jit)
            verts.append((loc[0] + dx + rr * math.cos(a),
                          loc[1] + dy + rr * math.sin(a), loc[2] + z))
    faces, froles = [], []
    if caps[0]:
        faces.append(tuple(range(n - 1, -1, -1)))
        froles.append(band_roles[0])
    if caps[1]:
        top = (k - 1) * n
        faces.append(tuple(range(top, top + n)))
        froles.append(band_roles[-1])
    for b in range(k - 1):
        lo, hi = b * n, (b + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((lo + i, lo + j, hi + j, hi + i))
            froles.append(band_roles[b])
    return verts, faces, [False] * len(faces), froles


def _dome(rx, ry, rz, loc=(0.0, 0.0, 0.0), seg=9, seed=1, jit=0.13,
          rings=(0.22, 0.52, 0.82), radii=(0.60, 1.00, 0.66),
          bands=("LeafDeep", "LeafDeep", "Leaf", "LeafLight")):
    """A closed faceted spheroid centred on `loc`, with one role per vertical
    zone: bottom fan, then one per consecutive ring pair, then top fan, so
    len(bands) is len(rings) + 1.

    rz is the FULL height and rx/ry are radii, so a crown flattened to 0.6 of
    its width (ASSET-SPECS 4.7) is rz = 1.2 * rx. The underside of the mass
    faces away from the sky and reads dark; the top fan catches it and reads
    light. That is the whole reason a canopy mass has volume rather than being
    a flat green blob, and it costs nothing over a single-role blob.

    Triangles: 2 * seg * len(rings).
    """
    if len(bands) != len(rings) + 1:
        raise ValueError("_dome needs %d band role(s) for %d rings, got %d"
                         % (len(rings) + 1, len(rings), len(bands)))
    n = max(3, seg)
    nxt = hc.rng(seed)
    z0 = loc[2] - rz * 0.5
    verts = [(loc[0], loc[1], z0)]
    for frac, rf in zip(rings, radii):
        z = z0 + rz * frac * (1.0 + (nxt() - 0.5) * 0.12)
        for i in range(n):
            a = 2.0 * math.pi * i / n + (nxt() - 0.5) * (2.0 * math.pi / n) * 0.6
            r = rf * (1.0 + (nxt() - 0.5) * 2.0 * jit)
            verts.append((loc[0] + rx * r * math.cos(a),
                          loc[1] + ry * r * math.sin(a), z))
    top = len(verts)
    verts.append((loc[0] + rx * (nxt() - 0.5) * 0.20,
                  loc[1] + ry * (nxt() - 0.5) * 0.20, z0 + rz))

    faces, froles = [], []
    for i in range(n):
        j = (i + 1) % n
        faces.append((0, 1 + j, 1 + i))
        froles.append(bands[0])
    for b in range(len(rings) - 1):
        lo, hi = 1 + b * n, 1 + (b + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((lo + i, lo + j, hi + j, hi + i))
            froles.append(bands[b + 1])
    last = 1 + (len(rings) - 1) * n
    for i in range(n):
        j = (i + 1) % n
        faces.append((last + i, last + j, top))
        froles.append(bands[-1])
    return verts, faces, [False] * len(faces), froles


def _cone(r_bot, rz, loc, seg=5, seed=1, jit=0.05, r_mid=None, mid_z=0.52,
          under="LeafDeep", body="Leaf", tip="LeafLight"):
    """The LOD2 crown primitive: hc.lobe reduced to a cone standing on `loc`.

    r_mid None gives a plain cone (base n-gon plus an apex fan, 2 * seg - 2
    triangles). A non-zero r_mid inserts one waist ring at mid_z of the height,
    which is a frustum band under a cone: two sections, so the spire keeps a
    visible taper instead of running dead straight from base to tip.

    hc.lobe emits the base n-gon first and the apex fan last, so the three
    zones are addressable by slicing the returned role list, with no second
    mesh and no extra triangle: base is the shadowed underside a player sees
    when standing beneath, the band is the body, the apex fan is the lit tip.
    """
    rings = (((0.0, 1.00),) if r_mid is None
             else ((0.0, 1.00), (mid_z, r_mid / r_bot)))
    v, f, sm, roles = hc.lobe(r_bot, r_bot, rz, loc=loc, seg=seg, seed=seed,
                              jit=jit, rings=rings, role=body)
    n = max(3, seg)
    roles[0] = under
    for i in range(len(roles) - n, len(roles)):
        roles[i] = tip
    return v, f, sm, roles


# ===========================================================================
# Canopy_Pine - 3.10 x 3.10 x 12.00 m, bare trunk to 0.55 of height
# ===========================================================================

PINE_H = 12.00

# (r0, r1, z0, z1, phase_deg, lean, splits). splits is the (low, high) fraction
# of a tier's own height where LeafDeep hands to Leaf and Leaf hands to
# LeafLight. Pushed high at the bottom of the crown (mostly shadow, a thin lit
# cap) and low at the top (mostly lit, a thin shadowed collar), so the tree
# reads dark to light as a WHOLE and not tier by tier. Every tier is phase
# rotated off its neighbour, which is what stops five stacked frusta reading as
# one procedural cone.
PINE_TIERS = (
    (1.46, 1.06, 6.60, 8.05, 41, (0.05, -0.04), (0.52, 0.88)),
    (1.34, 0.90, 7.85, 9.35, 12, (-0.05, 0.05), (0.42, 0.78)),
    (1.11, 0.68, 9.15, 10.45, 63, (0.04, 0.05), (0.32, 0.68)),
    (0.81, 0.43, 10.25, 11.30, 27, (-0.04, -0.03), (0.22, 0.56)),
    (0.49, 0.06, 11.15, 12.00, 50, (0.03, 0.03), (0.12, 0.44)),
)

# Short BARE limb stubs in the 45 to 58 percent band, all Bark, no foliage on
# them at all. They are the transition that says the lower trunk is bare
# because a mature tree sheds its lower limbs, rather than because the crown
# geometry simply begins at 0.55.
PINE_STUBS = (
    (0.085, 0.030, 5.40, 6.05, (0.44, -0.16), 6101),
    (0.075, 0.026, 5.95, 6.55, (-0.38, 0.30), 6107),
    (0.065, 0.024, 6.50, 6.95, (0.22, 0.40), 6113),
)


def _pine_trunk(p):
    """Root flare plus one straight tapered trunk running the full height of
    the crown. Jittered so it is not a turned dowel, but still round."""
    p.add(*_bands(((0.40, 0.00), (0.255, 0.62)), seg=6, seed=6001, jit=0.05,
                  roles="Bark"))
    p.add(*_bands(((0.245, 0.55), (0.105, 11.20)), seg=6, seed=6003, jit=0.05,
                  phase_deg=26, lean=(0.04, -0.03), roles="Bark"))
    return p


def pine():
    p = hc.Parts()
    _pine_trunk(p)
    for r0, r1, z0, z1, ph, lean, splits in PINE_TIERS:
        za = z0 + (z1 - z0) * splits[0]
        zb = z0 + (z1 - z0) * splits[1]
        ra = r0 + (r1 - r0) * splits[0]
        rb = r0 + (r1 - r0) * splits[1]
        p.add(*_bands(((r0, z0), (ra, za), (rb, zb), (r1, z1)), seg=6,
                      seed=6021 + int(z0 * 100), jit=0.11, phase_deg=ph,
                      lean=lean,
                      roles=["LeafDeep", "Leaf", "LeafLight"]))
    for r0, r1, z0, z1, lean, seed in PINE_STUBS:
        p.add(*_bands(((r0, z0), (r1, z1)), seg=4, seed=seed, jit=0.10,
                      lean=lean, roles="Bark"))
    return p


def pine_lod2():
    """One 5-sided two-section cone over a 4-sided bare trunk. The cone base
    sits at 0.55 of the height, so the rule the whole set exists to carry is
    still legible in 26 triangles."""
    p = hc.Parts()
    p.add(*_bands(((0.30, 0.00), (0.155, 7.20)), seg=4, seed=6201, jit=0.04,
                  roles="Bark", caps=(False, False)))
    p.add(*_cone(1.55, PINE_H - 6.60, (0.0, 0.0, 6.60), seg=5, seed=6203,
                 r_mid=0.78, mid_z=0.55))
    return p


# ===========================================================================
# Canopy_Fir - 2.60 x 2.60 x 16.50 m, bare trunk to 0.62 of height
# ===========================================================================

FIR_H = 16.50

# Six very shallow tiers packed into the top 38%: a near-columnar spire rather
# than a cone. Each tier is barely wider than the one above it, which is what
# makes the outline a column that tapers instead of a triangle.
FIR_TIERS = (
    (1.22, 0.98, 10.25, 11.35, 17, (0.03, -0.02), (0.55, 0.88)),
    (1.13, 0.88, 11.20, 12.30, 55, (-0.03, 0.03), (0.47, 0.80)),
    (1.02, 0.76, 12.15, 13.25, 31, (0.02, 0.03), (0.39, 0.72)),
    (0.87, 0.62, 13.10, 14.20, 69, (-0.02, -0.02), (0.31, 0.64)),
    (0.70, 0.44, 14.05, 15.20, 8, (0.02, 0.02), (0.22, 0.55)),
    (0.49, 0.05, 15.05, 16.50, 44, (-0.02, 0.01), (0.12, 0.42)),
)


def fir():
    p = hc.Parts()
    p.add(*_bands(((0.34, 0.00), (0.215, 0.68)), seg=5, seed=6301, jit=0.05,
                  roles="Bark"))
    p.add(*_bands(((0.205, 0.60), (0.085, 15.60)), seg=5, seed=6303, jit=0.05,
                  phase_deg=34, lean=(-0.03, 0.02), roles="Bark"))
    for r0, r1, z0, z1, ph, lean, splits in FIR_TIERS:
        za = z0 + (z1 - z0) * splits[0]
        zb = z0 + (z1 - z0) * splits[1]
        ra = r0 + (r1 - r0) * splits[0]
        rb = r0 + (r1 - r0) * splits[1]
        p.add(*_bands(((r0, z0), (ra, za), (rb, zb), (r1, z1)), seg=5,
                      seed=6321 + int(z0 * 100), jit=0.10, phase_deg=ph,
                      lean=lean,
                      roles=["LeafDeep", "Leaf", "LeafLight"]))
    return p


def fir_lod2():
    """Two stacked 5-sided cones on a 3-sided bare trunk. One cone would run
    dead straight from 10.25 m to the tip and lose the taper that makes this
    the emergent; two sections keep it in 22 triangles. The trunk is 3-sided
    because at 150 m a 0.3 m trunk on a 16.5 m tree is a sliver, and the
    triangles are worth more in the spire."""
    p = hc.Parts()
    p.add(*_bands(((0.26, 0.00), (0.125, 11.40)), seg=3, seed=6401, jit=0.04,
                  roles="Bark", caps=(False, False)))
    p.add(*_cone(1.30, 3.95, (0.0, 0.0, 10.25), seg=5, seed=6403,
                 under="LeafDeep", tip="Leaf"))
    p.add(*_cone(0.82, 2.90, (0.0, 0.0, 13.60), seg=5, seed=6407,
                 under="Leaf", tip="LeafLight"))
    return p


# ===========================================================================
# Canopy_Broadleaf - 9.00 x 9.00 x 10.50 m, bare trunk to the fork at 0.45
# ===========================================================================

BROAD_H = 10.50
BROAD_FORK_Z = 4.725

# (r0, r1, z0, z1, lean, seed) per fork limb. Three unequal limbs leaving the
# fork at three azimuths, each carrying one crown mass out to its own tip.
BROAD_LIMBS = (
    (0.27, 0.16, 4.60, 7.20, (-1.90, 0.72), 6501),
    (0.25, 0.15, 4.70, 7.10, (1.85, -1.80), 6507),
    (0.22, 0.13, 4.85, 6.95, (0.25, 2.00), 6513),
)

# (rx, ry, rz, loc, seg, seed, bands). Three big masses whose centres are about
# 2 m apart and whose radii are about 2.5 m, so they OVERLAP heavily and merge
# into one wide slightly flattened dome rather than reading as three balloons
# tied to a stick. The fourth, smaller mass breaks the outline where the first
# three would otherwise show a clean seam. Bands shift toward LeafLight the
# higher the mass sits, which is what carries the dark-to-light read across the
# whole crown instead of within each mass.
BROAD_MASSES = (
    (2.55, 2.40, 3.20, (-1.90, 0.75, 8.60), 10, 6601,
     ("LeafDeep", "Leaf", "Leaf", "LeafLight")),
    (2.55, 2.60, 3.00, (1.85, -1.85, 8.30), 10, 6607,
     ("LeafDeep", "LeafDeep", "Leaf", "LeafLight")),
    (2.30, 2.40, 2.80, (0.25, 2.05, 8.00), 10, 6613,
     ("LeafDeep", "LeafDeep", "Leaf", "Leaf")),
    (1.70, 1.60, 2.00, (-0.55, -0.30, 7.45), 7, 6619,
     ("LeafDeep", "LeafDeep", "Leaf", "LeafLight")),
)


def broadleaf():
    p = hc.Parts()
    p.add(*_bands(((0.62, 0.00), (0.44, 0.78)), seg=6, seed=6701, jit=0.05,
                  roles="Bark"))
    p.add(*_bands(((0.42, 0.70), (0.30, 4.90)), seg=6, seed=6703, jit=0.05,
                  phase_deg=19, lean=(0.05, 0.04), roles="Bark"))
    for r0, r1, z0, z1, lean, seed in BROAD_LIMBS:
        p.add(*_bands(((r0, z0), (r1, z1)), seg=5, seed=seed, jit=0.08,
                      lean=lean, roles="Bark"))
    for rx, ry, rz, loc, seg, seed, bands in BROAD_MASSES:
        p.add(*_dome(rx, ry, rz, loc=loc, seg=seg, seed=seed, jit=0.14,
                     bands=bands))
    return p


def broadleaf_lod2():
    """One low-poly dome on a 4-sided bare trunk. hc.lobe at seg 6 with a waist
    ring at 0.46 of the height is a dome rather than a cone: widest below the
    middle, which is the outline a spreading crown actually has. The dome's
    underside stays LeafDeep and its apex fan LeafLight, so even the impostor
    keeps the dark-below, lit-above read."""
    p = hc.Parts()
    p.add(*_bands(((0.50, 0.00), (0.33, 7.10)), seg=4, seed=6801, jit=0.04,
                  roles="Bark", caps=(False, False)))
    v, f, sm, roles = hc.lobe(4.50, 4.50, BROAD_H - 6.60,
                              loc=(0.0, 0.0, 6.60), seg=6, seed=6803, jit=0.05,
                              rings=((0.0, 0.60), (0.46, 1.00)), role="Leaf")
    roles[0] = "LeafDeep"
    for i in range(len(roles) - 6, len(roles)):
        roles[i] = "LeafLight"
    p.add(v, f, sm, roles)
    return p


PROPS = [
    pc.Prop("Canopy_Pine", (3.10, 3.10, PINE_H), pine, ORDER,
            lod2=pine_lod2, collide=False,
            note="crown in the top 45%, bare trunk to 0.55 of height"),
    pc.Prop("Canopy_Fir", (2.60, 2.60, FIR_H), fir, ORDER,
            lod2=fir_lod2, collide=False,
            note="the emergent: crown in the top 38%, bare to 0.62"),
    pc.Prop("Canopy_Broadleaf", (9.00, 9.00, BROAD_H), broadleaf, ORDER,
            lod2=broadleaf_lod2, collide=False,
            note="forks at 0.45, crown carried above 0.60"),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
