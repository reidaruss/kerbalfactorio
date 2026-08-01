"""build_bush_scrub.py - Scrub bush, an art variant of NodeKind::Tree.

    blender --background --python tools/blender/build_bush_scrub.py

Produces assets/models/dist/nodes/bush_scrub.glb.

Five faceted lobes on a stub stem was the old shape. This is NOT a new
NodeKind: it is the low-yield Tree dressing, the bootstrap harvest a player
strips before they have an axe, so it must read as "a few sticks" rather than
"a tree you could fell". Hence no Tree_Fall clip and no stump variant: you pick
a bush clean, you do not chop it down.

DEPLETION 5 masses -> 3 -> 2 dry, on the same woody frame throughout. Two LOD
bands only, per the manifest: a 0.9 m prop is either near enough to matter or
gone.

W11 pass (2026-07-27): the Full lobes shade Leaf (base/interior) into
LeafLight (sunlit top) via tree_common.canopy_mass instead of one flat green,
the same volume trick the two trees use, sized to the 4-material budget this
asset has (Bark, Leaf, LeafLight, LeafDry). The stem is jittered instead of a
perfect cylinder.

RN-309 (2026-08-01), THE SOLID-OF-REVOLUTION FIX, AND THE ONE ASSET IN THE
FLORA SET THAT STILL HAD IT.

`tools/blender/flora_silhouette.py` rotates an exported LOD0 about its own up
axis and asks how much the outline actually moves, because `ScatterEmit.ts:153`
yaws every scatter instance and `NodeBatch.ts:353` says harvest nodes differ
"only in yaw": an asset whose outline does not depend on yaw hands that
machinery nothing to act on, and no amount of per-instance tint or scale can
reach a repetition that lives in the SILHOUETTE. After RN-271 to RN-284 fixed
the five trees, this bush measured **IoU 0.745 and width cv 0.0201**, the worst
in the whole flora set: a projected width that moved two percent over an entire
revolution, which is faceting and nothing else.

The cause was the same one RN-63 wrote down years of decisions ago and RN-271
finally named. The bush was a stub stem plus five ELLIPSOIDS. An ellipsoid on a
vertical axis is a solid of revolution; five of them scattered around the axis
at similar radii sum to a round plan; and `Parts.fit` then scaled X and Y
independently into a SQUARE 1.00 x 1.00 footprint, which normalises away
whatever plan anisotropy did survive (RN-273). Every one of those three
independently guarantees a round bush.

So the bush is now WOOD FIRST. Three stems leave a flared base at uneven
azimuths and sweep out along `tree_common.arc`-shaped paths; the foliage is
several small masses clothed ALONG each stem's length rather than one mass per
stem; two BARE dead stems stand out of the top of the mass with one snapped
pale end. The whole crown is biased onto one bearing, because a scrub bush is
wind pruned and grows away from the weather.

CLOTHING ALONG THE LENGTH IS THE PART THAT WAS LEARNED THE HARD WAY, one tier
up: RN-278's first draft scored well on every silhouette statistic and rendered
as flat discs on sticks, because one mass at the end of each limb leaves the
limb bare for its whole length, and a table top rotates perfectly well.

THE BARE STEMS ARE THE OTHER HALF OF THE ART DIRECTION and they cost 20
triangles. `docs/web/ART-DIRECTION.md` names "clean" as a defect outright, and
a bush with no dead wood in it is clean by construction. They also do real
work for the depletion read: the Low variant is the same frame with almost all
the foliage gone, which is what "picked clean" should look like, rather than
two small green blobs.

MATERIAL VALUES ARE NOT TOUCHED, per the sequencing rule in ART-DIRECTION.md.
The four roles and their order are exactly as before; this pass only chooses
which of them a face sits on.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import tree_common as tc       # noqa: E402
import props_common as pc      # noqa: E402  (foliage card UV helpers)

NAME = "BushScrub"
OUT = of.dist_path("nodes", "bush_scrub.glb")

# THE FOOTPRINT STATES THE PLAN ASPECT THE BUSH ACTUALLY HAS. 1.00 x 1.00 did
# not: `Parts.fit` fills `size` exactly on X and Y independently, so a square
# box is an instruction to be round whatever the build function produced. The
# MEAN is held at 1.00 so the ground the bush occupies, and therefore any
# spacing derived from it, does not move as a side effect.
DIMS = (1.14, 0.86, 0.90)
ORDER = ["Bark", "Leaf", "LeafLight", "LeafDry"]
SEED = 6113

# The woody frame: three stems, each a polyline from the base out to a tip, at
# UNEVEN azimuths and UNEQUAL reach. Radii taper along the path. The two long
# ones lean onto the same bearing, which is the wind-pruned bias.
STEMS = (
    (((0.020, -0.020, 0.040), (0.160, -0.130, 0.275), (0.305, -0.200, 0.435)),
     (0.052, 0.030, 0.013), 6201),
    (((-0.030, 0.015, 0.038), (-0.190, 0.090, 0.255), (-0.340, 0.140, 0.395)),
     (0.046, 0.027, 0.012), 6211),
    (((0.005, 0.030, 0.045), (0.130, 0.160, 0.300), (0.250, 0.240, 0.490)),
     (0.042, 0.025, 0.011), 6217),
)

# The dead wood: two bare stems standing clear of the foliage, one snapped.
# THIN AND SHORT, AND THE FIRST CUT WAS NEITHER. At 3.4 cm thick and 0.86 of
# the bush's height they rendered as two dark chopsticks crossing in front of
# the crown: on a 0.9 m prop a dead stem is a detail, and a detail that
# out-reads the whole plant has stopped being one.
DEAD = (
    (((0.042, -0.005, 0.055), (0.185, -0.050, 0.420), (0.228, -0.070, 0.720)),
     (0.019, 0.011, 0.005), 6223, True),
    (((-0.020, -0.028, 0.045), (-0.135, -0.150, 0.330), (-0.196, -0.222, 0.545)),
     (0.016, 0.009, 0.004), 6229, False),
)

# (stem index, t along that stem, x radius, y radius, height, segments). Read
# down the column: every stem carries THREE masses spread along its length,
# biggest inboard, and the numbers are unequal on every axis. The order is the
# depletion order, so `_bush(n)` keeps the first n, which is why the three
# LOWEST and largest masses are listed first: a half-picked bush should lose
# its outer growth, not its middle.
#
# THE FIRST ROW OF t VALUES WAS 0.30 TO 0.62 AND THE RENDER REFUSED IT. Every
# mass then sat in the middle third of the frame, so the bush was a green slab
# hovering over a gap with a stump under it. A scrub bush is dense from the
# ground up; the lowest masses now start at t 0.14 to 0.20, where the stem is
# still only 11 cm up, so the foliage MEETS the base.
CLUMPS = (
    (0, 0.16, 0.250, 0.205, 0.300, 5),
    (2, 0.20, 0.215, 0.240, 0.285, 5),
    (1, 0.14, 0.205, 0.215, 0.270, 5),
    (0, 0.60, 0.185, 0.150, 0.240, 4),
    (2, 0.58, 0.160, 0.180, 0.230, 4),
    (1, 0.62, 0.150, 0.160, 0.215, 4),
    (0, 0.97, 0.130, 0.110, 0.185, 4),
    (2, 0.95, 0.115, 0.130, 0.170, 4),
    (1, 0.98, 0.105, 0.115, 0.160, 4),
)


def _at(path, t):
    """The point a fraction `t` along a polyline, by arc length in segments.

    Deliberately NOT a copy of any coordinate in STEMS: a clump derives its
    centre from the stem it hangs on, so moving a stem moves its foliage with
    it. Two parts dimensioned off the same landmark by COPYING the number is
    the catalogued coplanar defect, and it is also how a crown ends up
    detached from the branch it is meant to be growing out of."""
    n = len(path) - 1
    u = min(max(t, 0.0), 1.0) * n
    i = min(int(u), n - 1)
    f = u - i
    a, b = path[i], path[i + 1]
    return (a[0] + (b[0] - a[0]) * f,
            a[1] + (b[1] - a[1]) * f,
            a[2] + (b[2] - a[2]) * f)


def _base(p, seg=6):
    """The root swell the stems leave from. `flare` adds buttressing to the
    bottom of the stack and costs zero triangles: it reshapes rings that
    already exist. cap=False on both ends because the bottom is on the ground
    and the top is inside the stems."""
    v, f, sm, roles = tc.taper_bands(
        ((0.098, 0.0), (0.076, 0.055), (0.058, 0.115)), seg=seg,
        seed=SEED + 501, jit=0.10, phase_deg=17.0, roles="Bark", cap=False,
        flare=(3, 0.62, 0.55))
    p.add(v, f, sm, roles)
    return p


def _wood(p, seg=4, dead=True):
    """The three live stems and, optionally, the two dead ones."""
    for path, radii, seed in STEMS:
        p.add(*tc.limb(path, radii, seg=seg, seed=seed, jit=0.15,
                       roles="Bark", cap=(False, True)))
    if not dead:
        return p
    for path, radii, seed, snapped in DEAD:
        v, f, sm, roles = tc.limb(path, radii, seg=seg, seed=seed, jit=0.20,
                                  roles="Bark", cap=(False, True))
        if snapped:
            # The top cap is emitted last, so roles[-1] is exactly "the face
            # this stem broke across". Pale sapwood on a dead stem is the same
            # language the conifer stump and the fallen log speak, and once
            # LeafDry wears an alpha-tested card that cut face has to sample
            # somewhere opaque, which is what disc_uvs is for.
            roles = list(roles)
            roles[-1] = "LeafDry"
            p.add(v, f, sm, roles, uvs=pc.disc_uvs(v), uv_roles={"LeafDry"})
        else:
            p.add(v, f, sm, roles)
    return p


def _bush(count, dry_from=None, seg_bias=0, dead=True, jit=0.22):
    """`count` foliage masses on the full woody frame. `dry_from` is the index
    at and beyond which a mass shades LeafDry instead of Leaf/LeafLight, which
    is how a depletion state dries out without a second mesh."""
    p = hc.Parts()
    _base(p, seg=6 if seg_bias == 0 else 5)
    _wood(p, seg=max(3, 4 + seg_bias), dead=dead)
    for k in range(count):
        si, t, rx, ry, h, seg = CLUMPS[k]
        loc = _at(STEMS[si][0], t)
        s = max(4, seg + seg_bias)
        seed = SEED + k * 29
        if dry_from is not None and k >= dry_from:
            v, f, sm = hc.blob(rx, ry, h, loc, seg=s, seed=seed, jit=jit,
                               rings=(0.30, 0.66), radii=(0.82, 0.80))
            p.add(v, f, sm, "LeafDry",
                  uvs=pc.shell_uvs(v, seed, centre=(loc[0], loc[1])))
        else:
            # Two-tone: base/interior Leaf, sunlit top LeafLight. Real volume
            # for the same triangle count a flat-coloured blob already cost.
            # The mass is a closed SHELL, so it takes the shell UV rule
            # (azimuth u at three repeats, elevation v off the clamped rows).
            v, f, sm, roles = tc.canopy_mass(
                rx, ry, h, loc, seg=s, seed=seed, jit=jit,
                rings=(0.30, 0.66), radii=(0.82, 0.80),
                bands=("Leaf", "Leaf", "LeafLight"))
            p.add(v, f, sm, roles,
                  uvs=pc.shell_uvs(v, seed, centre=(loc[0], loc[1])))
    return p


def full_lod0():
    return _bush(9)


def full_lod1():
    # Five masses, not nine, one facet off each, and NO DEAD STEMS. The bare
    # stems are 1 to 3 cm thick, so at the 25 m this LOD serves they are under
    # a pixel: they are a close-range feature and they are paid for at close
    # range only. The base swell STAYS in every variant, because it is what
    # touches the ground: every LOD here is placed by the hero's own fit
    # transform rather than refitted, so dropping the lowest geometry from one
    # of them would leave that LOD hovering.
    return _bush(5, seg_bias=-1, dead=False)


def half_lod0():
    return _bush(5, dry_from=4)


def half_lod1():
    return _bush(3, dry_from=2, seg_bias=-1, dead=False)


def low_lod0():
    """Picked clean: the woody frame with two dry masses left on it. This is
    the state the bare stems were worth their triangles for, because a
    stripped bush IS sticks and the old Low variant was two green blobs."""
    return _bush(2, dry_from=0)


def low_lod1():
    return _bush(1, dry_from=0, seg_bias=-1, dead=False)


VARIANTS = (("Full", (full_lod0, full_lod1)),
            ("Half", (half_lod0, half_lod1)),
            ("Low", (low_lod0, low_lod1)))


def main():
    of.reset_scene()
    root = of.add_root(NAME)
    # fall=False: no Tree_Fall clip, no socket_fell_pivot. A bush is stripped,
    # never felled. The collision box keeps its old 0.90 fraction of the
    # footprint on both axes, so it follows the footprint rather than
    # contradicting it.
    sway = tc.rig(root, NAME, (DIMS[0] * 0.90, DIMS[1] * 0.90, DIMS[2]), 0.45,
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
