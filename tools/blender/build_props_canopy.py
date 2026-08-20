"""build_props_canopy.py - the mature canopy trees, as SCENERY.

    blender --background --python tools/blender/build_props_canopy.py

Produces assets/models/dist/props/props_canopy.glb. Three props, all scatter,
none of them harvestable, none of them collidable.

THE ONE DESIGN RULE THAT WAS. Forest already has two LIVE trees standing in it
and both of them are harvest nodes: TreeConifer (2.40 x 2.40 x 6.50 m, skirted
with branches all the way down to the ground) and TreeBroadleaf (4.00 x 4.00 x
5.00 m, a wide low forked crown starting at 2.0 m). props_forest.py could
therefore contain no live tree at all, because a scatter tree that looked like
either one would read as a node the player cannot chop. This file was the way
out of that, and the way out was a rule the game stated in words:

    HARVEST trees are small and branched to the ground.
    CANOPY trees are mature: twice the height or more, with a BARE TRUNK for
    the lower half and the crown carried high.

RETIRED 2026-08-01 (RN-310) BY REID'S RULING, verbatim: "there should be no
scenery trees. all trees should be minable." One family cannot be told apart
from another family that no longer exists, so WG-13 to WG-17 are superseded and
the `assert_bare_trunk` gate at the foot of this file is gone with them. The
full attribution, and the lesson the gate leaves behind, are recorded there;
the short version is that the gate was correct while the rule stood and is
being removed because the rule was withdrawn, not because it was wrong.

BARE-TRUNK FRACTIONS ARE THEREFORE NO LONGER CONSTRAINED ON ANY TREE HERE.
Root flare, low branching and forks may go wherever the form wants them, which
under docs/web/ART-DIRECTION.md is a licence this set should use: holding a
trunk bare to 0.62 of its height is a strong constraint on a shape, and it was
being paid for a signal that has been withdrawn. What the trees currently
happen to measure, for the record and not as a target:

    Canopy_Pine        3.85 x 2.55 x 12.00 m   lowest foliage 0.597 of height
    Canopy_Fir         2.90 x 2.20 x 16.50 m   lowest foliage 0.623
    Canopy_Broadleaf   8.40 x 10.50 x 10.50 m  lowest foliage 0.586

Those are still MEASURED off the exported bytes and still printed by the build,
because Parts.fit rescales z after every build function has returned (WG-14's
rule and WG-14's reason) and a number nobody can see is a number that drifts.
They are simply no longer a floor. See `report_foliage_ratio`.

THE WIDER CONSEQUENCE OF REID'S RULING IS NOT THIS LANE'S TO LAND: if every
tree is minable then these three props stop being scatter props at all and
become harvest nodes, which is a Registry, world-gen and gameplay change well
outside a Blender pass. Flagged up rather than half-done here.

Canopy_Fir is the EMERGENT and it is the single most important silhouette in
the set: at 16.5 m it is 2.5x the conifer harvest node and it is the shape that
breaks the canopy line, so a stand of forest reads as a canopy with something
standing out of it rather than as a field of the same tree at two sizes. The
pine carries a few bare Bark limb stubs in the 45 to 58% band, which is the
transition that says the bare trunk is bare because the lower limbs were shed,
not because the mesh simply starts there.

RN-271 to RN-278, THE PARASOL PASS, AND WHY THE OLD SET REPEATED. Every frame
of forest showed these three trees over and over as the SAME outline, and the
per-instance tint and size that ship (RN-61, ScatterLook) could not touch it,
because the repetition is silhouette. The mechanism turns out to be already
written down for a different asset family: RN-63 found that mineral props all
read alike because "rotation does not change a silhouette viewed from a level
camera", and the scatter DOES yaw every instance through a full turn
(ScatterEmit.ts:153, a hashed 0 to 2*pi about the surface normal).

All three canopy trees were built as SOLIDS OF REVOLUTION about their own
trunk: stacked concentric rings and domes centred on the axis. A solid of
revolution has the same outline at every yaw, so the one machine the engine
already runs to make each tree different was doing nothing at all. The forest
was not short of variety mechanisms, it was short of anything for them to act
on. That is why this is an ASSET fix and not a scatter fix.

So the crowns are no longer rings around the axis. Each tree is a small set of
heavy BOUGHS (tree_common.limb swept along tree_common.arc, which rises, flattens
and lets its outer end fall) at UNEVEN azimuths and UNEQUAL reach, carrying
foliage plates of unequal size, with the whole crown mass biased toward one
bearing. Trunks sweep rather than lean, wear coherent vertical ridging instead
of per-ring noise, and flare into root buttresses at the ground. Each tree
carries at least one bare, broken or dead limb, because nothing in a real
canopy is undamaged.

The measurable claim is not "it looks better", it is that the outline is now a
FUNCTION of yaw. tools/blender/flora_silhouette.py rotates the exported LOD0 and
reports how much the projected width and the projected area move, and how
little two yaws of one tree overlap. Numbers are in the pass report.

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
per-tier `splits`. The SHAPE primitives are now shared with tree_common (see
the note above `_bands`); the palette policy is not, and stays here, because a
scatter prop has no depletion variants to keep a palette consistent across.

LOD2 IS A MASS, NOT A CROSSED QUAD. Props are LOD0 and LOD2 only, and LOD2 is
the tree beyond the 78 m LOD0 radius WG-17 pinned, which is where nearly every
instance of a canopy tree actually is. So LOD2 is hand authored, never a
COLLAPSE decimate (a collapse decimator eats a conifer tier whole and leaves a
shard) and never the crossed-quad impostor the harvest trees carry.

The original reason given here for refusing the crossed quad was that no
texture pipeline existed, and THAT PREMISE IS NOW FALSE: RN-176 to RN-183
shipped alpha-tested leaf and grass cards and this atlas wears them. The
refusal survives on its second reason, which is the one that was always doing
the work: a crossed quad is two flat planes, so it has one silhouette from the
front, a different one from 45 degrees and almost none edge on, and the whole
point of this pass is that the outline must survive rotation. A small solid
mass does. Every LOD2 here is OFF-CENTRE in the same direction its LOD0 crown
leans, and is fitted to the same box, so the two occupy identical space, the
switch cannot pop, and the far tree keeps the near tree's lean.

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
import tree_common as tc       # noqa: E402  (taper_bands, limb, arc)

NAME = "PropsCanopy"
OUT = of.dist_path("props", "props_canopy.glb")

# The pinned slot order, identical on all three props. Adding a fifth name here
# is a draw call, so it does not happen without an Admin-logged decision.
#
# RN-2245 IS THAT DECISION, AND THE DRAW CALL IT WAS GUARDING AGAINST DOES NOT
# ARRIVE. `Canopy` is authored at `_LOD3` ALONE, and RN-2244 already made
# `ScatterEmit.emit` refuse to acquire a canopy part whose own `lods[LOD3]` is
# -1. So after this commit `Bark`/`LeafDeep`/`Leaf`/`LeafLight` all have no
# LOD3 of their own, all four are refused, and the ONE live canopy batch is
# `OF_Canopy:canopy` instead of `OF_Leaf:canopy` -- a rename of the live batch,
# not an addition. An empty batch drops out of the frame (that is the same
# mechanism RN-2244 measured taking the calls 29 -> 26), and the canopy suffix
# never casts a cascade, so the shadow passes are untouched as well.
# What the fifth name actually buys is a texture: `leaf` is a picture of one
# frond and cannot be re-authored as a crown without putting a crown on every
# bough of every tree the player walks up to. See texgen's `_canopy_strips`.
ORDER = ["Bark", "LeafDeep", "Leaf", "LeafLight", "Canopy"]


# ---------------------------------------------------------------------------
# Local geometry. `_dome` and `_cone` stay local: that module is the
# harvest-node rig's shared code and these are scatter props, which carry no
# rig, no depletion variants and no clips.
#
# `_bands` USED TO BE LOCAL TOO AND IS NOW A WRAPPER, and the reason is worth
# stating. RN-271 added swept offsets, coherent ridging and root flare to
# tree_common.taper_bands; the local copy generated its rings with the same
# five lines of trigonometry, so keeping it local would have meant a second
# implementation of all three. Two copies of a shape rule drift, and this file
# has already been through that once (the LOD2 comment above cited a texture
# pipeline that had shipped). What was genuinely local was never the ring
# maths, it was the CAP POLICY and the UV policy, and that is all that is left
# here.
# ---------------------------------------------------------------------------

def _bands(rings, seg=6, seed=1, jit=0.07, phase_deg=0.0, lean=(0.0, 0.0),
           loc=(0.0, 0.0, 0.0), roles="Bark", caps=(True, True),
           offsets=None, ridge=None, flare=None):
    """A stack of jittered rings along +Z with ONE PALETTE ROLE PER SIDE BAND.

    rings is ((radius, z), ...) bottom to top, at least two entries. `roles` is
    one role for the whole stack or one per side band (len(rings) - 1), which
    is how a single conifer tier shades LeafDeep to Leaf to LeafLight for zero
    extra triangles. `lean` offsets the TOP ring in x/y and is interpolated
    down the stack; `offsets`, `ridge` and `flare` are tree_common.taper_bands'
    RN-271 shape arguments and are documented there.

    `caps` is (bottom, top). Both are on by default because the underside of a
    tier is the face a player standing under a canopy tree actually looks at.
    An LOD2 trunk stub turns both off: its base is buried in the terrain and
    its top is buried in the crown, so two caps there are triangles no camera
    can reach.

    Returns (verts, faces, smooth, roles, uvs, uv_roles), splat-ready for
    Parts.add: a stack whose roles are ALL foliage carries authored shell UVs
    (props_common.shell_uvs), a bark stack carries None and keeps its
    box-projected metres.

    Triangles: caps * (seg - 2) + 2 * seg * (len(rings) - 1).
    """
    verts, faces, smooth, froles = tc.taper_bands(
        rings, seg=seg, seed=seed, jit=jit, phase_deg=phase_deg, loc=loc,
        lean=lean, roles=roles, cap=caps, offsets=offsets, ridge=ridge,
        flare=flare)
    uvs = (pc.shell_uvs(verts, seed, centre=(loc[0], loc[1]))
           if set(froles) <= pc.FOLIAGE_ROLES else None)
    return verts, faces, smooth, froles, uvs, None


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
    # A dome is always foliage, so it always carries authored shell UVs.
    return (verts, faces, [False] * len(faces), froles,
            pc.shell_uvs(verts, seed, centre=(loc[0], loc[1])), None)


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
    # All three zones are foliage roles: shell UVs over the whole cone. The
    # ripple is for the flat base fan, the only face `under` owns here: it
    # needs a nonzero v extent of its own (see props_common.shell_uvs).
    return (v, f, sm, roles,
            pc.shell_uvs(v, seed, centre=(loc[0], loc[1]), v_ripple=0.05),
            None)


# ---------------------------------------------------------------------------
# The crown, as BOUGHS. This is the whole RN-271 pass in one function.
# ---------------------------------------------------------------------------

def _fan(p, seed, count, z_lo, z_hi, bias_deg, gain, reach, rise, droop,
         r_bot, r_top, clump, clumps=3, span=(0.36, 1.0), squash=0.92,
         depth=0.22, seg_l=3, seg_p=5, steps=2, sweep=26.0,
         bands=("LeafDeep", "Leaf", "LeafLight"), dead=-1, plate_lift=0.10,
         lobe_deg=0.0, lobe=0.0):
    """`count` heavy boughs leaving the trunk between z_lo and z_hi, each
    carrying a foliage plate at its outer end, one of them (index `dead`) bare.

    FOUR THINGS HERE ARE DELIBERATE AND EACH REPLACES A SYMMETRY.

    AZIMUTH is drawn as an uneven walk round the circle rather than
    k * 360 / count. Evenly spaced limbs are a wheel: the plan-view outline is
    a regular polygon, which at any real distance is a circle again, and a
    circle is what the whole pass exists to get rid of.

    REACH carries TWO harmonics of azimuth and they do different jobs, which
    was found by measuring rather than by design. `gain` is the FIRST harmonic,
    cos(az - bias): it makes the crown reach further one way than the other, so
    the mass centre leaves the trunk axis and the tree leans. That is what
    drove the silhouette overlap between two yaws down, and it is the term the
    first draft of this pass had.

    It is NOT what makes a tree look WIDER from one bearing than another,
    because a first harmonic DISPLACES a circle rather than stretching it: the
    first draft measured a plan aspect ratio of 1.019 on the pine, i.e. still
    round. `lobe` is the SECOND harmonic, cos(2 * (az - lobe_deg)), which
    reaches far on two opposite bearings and short on the two between them.
    That is an ellipse, it is what a crown grown toward a gap in a stand
    actually does, and it is the term that makes the projected width a real
    function of yaw.

    HEIGHT of attachment is drawn per bough, so the boughs do not form a
    layer. A ring of limbs all leaving at one height is a tier, which is the
    construction this pass removed.

    `dead` marks one bough that gets no foliage at all: a bare limb still on
    the tree. Nothing in a mature canopy is undamaged, and one bare limb per
    tree is the cheapest possible statement of that (zero extra triangles: the
    bough is drawn either way).

    Returns [(azimuth, reach, tip_point), ...] so a caller can fork a bough
    again or hang a second plate part way along it.
    """
    nxt = hc.rng(seed)
    tips = []
    for k in range(count):
        az = 360.0 * (k + 0.28 + 0.62 * nxt()) / count
        w = math.cos(math.radians(az - bias_deg))
        w2 = math.cos(math.radians(2.0 * (az - lobe_deg)))
        g = (0.70 + 0.44 * nxt()) * (1.0 + gain * w) * (1.0 + lobe * w2)
        z0 = z_lo + (z_hi - z_lo) * nxt()
        rr = reach * g
        rb = r_bot * (0.82 + 0.34 * nxt())
        path = tc.arc(az, rr, z0, rise * (0.30 + 1.45 * nxt()),
                      droop * (0.55 + 0.9 * nxt()), steps=steps,
                      r0=rb * 1.5, sweep_deg=sweep * (nxt() * 2.0 - 1.0))
        radii = [rb]
        for s in range(steps):
            radii.append(rb + (r_top - rb) * (s + 1) / float(steps))
        p.add(*tc.limb(path, radii, seg=seg_l, seed=seed + 13 * k + 1,
                       jit=0.15, roles="Bark"))
        tip = path[-1]
        tips.append((az, rr, tip))
        if k == dead:
            continue
        # FOLIAGE CLOTHES THE BOUGH, IT DOES NOT SIT ON THE END OF IT, and the
        # first build of this pass got that wrong in a way only a render
        # showed. One wide flat mass per limb reads as a lily pad on a stick:
        # the limb stays visible as a bare spar for its whole length, the
        # masses do not touch each other, and a stand of them looks like
        # furniture rather than like trees. Every silhouette NUMBER was already
        # good at that point, which is INSTRUMENTS.md's rule in its own words:
        # a structural check cannot replace looking.
        #
        # So each bough carries `clumps` masses spread along the outer part of
        # its own path, sized to OVERLAP their neighbours, shrinking outward.
        # The union is one irregular mass with holes in it and a thinning edge,
        # the limb is hidden inside its own foliage except where it pokes out,
        # and the clumps of adjacent boughs merge where the boughs are close.
        #
        # The path is re-sampled here at a finer step than the limb geometry
        # uses. tc.arc is a pure function of t, so the clump positions are
        # DERIVED from the same curve the limb was built on rather than copied
        # from its coarse vertices, which is the two-parts-one-landmark rule.
        fine = tc.arc(az, rr, z0, rise * (0.30 + 1.45 * nxt()),
                      droop * (0.55 + 0.9 * nxt()), steps=12,
                      r0=rb * 1.5, sweep_deg=sweep * (nxt() * 2.0 - 1.0))
        for c in range(clumps):
            u = span[0] + (span[1] - span[0]) * (c / float(max(1, clumps - 1))
                                                 if clumps > 1 else 1.0)
            q = fine[min(len(fine) - 1, int(round(u * (len(fine) - 1))))]
            grow = 1.0 - 0.38 * u
            pr = (clump * grow * (0.80 + 0.40 * nxt())
                  * (1.0 + 0.40 * gain * w) * (1.0 + 0.55 * lobe * w2))
            lift = pr * (squash * plate_lift + depth * (nxt() * 2.0 - 1.0))
            p.add(*_dome(pr, pr * (0.84 + 0.28 * nxt()), pr * squash,
                         loc=(q[0], q[1], q[2] + lift),
                         seg=seg_p, seed=seed + 401 + 31 * k + 7 * c,
                         jit=0.22, rings=(0.34, 0.68), radii=(0.86, 1.00),
                         bands=bands))
    return tips


def _stub(p, az_deg, r0, reach, z0, dz, seed, r_bot=0.075, r_top=0.030,
          seg=3):
    """One short bare limb: a shed lower branch, or a snapped one. Two path
    points and no foliage, which is 8 triangles at seg 3."""
    a = math.radians(az_deg)
    p.add(*tc.limb([(r0 * math.cos(a), r0 * math.sin(a), z0),
                    ((r0 + reach) * math.cos(a), (r0 + reach) * math.sin(a),
                     z0 + dz)],
                   [r_bot, r_top], seg=seg, seed=seed, jit=0.16, roles="Bark"))
    return p


# ===========================================================================
# Canopy_Pine - 3.10 x 3.10 x 12.00 m, bare trunk to 0.55 of height
# ===========================================================================

PINE_H = 12.00

# THE PINE IS NO LONGER A CONE. Up to RN-271 it was five stacked frusta, which
# is the Christmas-tree silhouette, and the fir above it is the same
# construction at different proportions, so two of the three canopy trees in
# every forest frame were the same shape at two sizes. A mature pine is not
# that: it sheds its lower limbs, loses its leader, and ends up with a few
# heavy boughs holding flat plates of needle at the top of a long bare trunk,
# open enough to see the sky through and markedly one-sided. That silhouette
# is also nothing like the fir's spire, which is the point.
#
# The trunk SWEEPS (per-ring offsets, a curve rather than a lean), wears four
# coherent vertical ridges instead of per-ring noise, and flares into three
# root buttresses at the ground. All three cost zero triangles: they reshape
# rings that already exist.
PINE_TRUNK = ((0.40, 0.00), (0.30, 1.40), (0.235, 4.70), (0.155, 8.20),
              (0.115, 10.90))
PINE_SWEEP = ((0.00, 0.00), (0.07, -0.04), (0.19, -0.10), (0.27, -0.05),
              (0.30, 0.02))


def pine():
    p = hc.Parts()
    p.add(*_bands(PINE_TRUNK, seg=6, seed=6001, jit=0.045, roles="Bark",
                  offsets=PINE_SWEEP, ridge=(4, 0.085, 34.0),
                  flare=(3, 0.62, 0.22)))
    # The main crown: six boughs between 0.56 and 0.82 of the height, biased
    # hard toward 214 degrees, one of them bare.
    _fan(p, 6100, 7, 7.20, 10.20, 8.0, 0.40, 1.46, 1.30, 0.62,
         0.140, 0.058, 1.00, clumps=3, span=(0.28, 0.94), squash=1.02,
         seg_p=5, dead=3, lobe_deg=0.0, lobe=0.26)
    # A second, smaller and much tighter fan in the top 15%, biased the OTHER
    # way. A crown that leans one way all the way up is a bent tree; a crown
    # whose top recovers over the trunk is a tree that lost a leader and grew a
    # new one, which is what a pine of this age looks like.
    _fan(p, 6140, 4, 10.05, 11.35, 196.0, 0.30, 0.90, 0.52, 0.30,
         0.095, 0.040, 0.74, clumps=2, span=(0.32, 0.92), squash=1.02,
         seg_p=4, lobe_deg=0.0, lobe=0.22,
         bands=("LeafDeep", "Leaf", "LeafLight"))
    # A last plate closing the top, sitting off the axis so the crown does not
    # come to a point centred on the trunk.
    p.add(*_dome(0.62, 0.54, 0.72, loc=(0.24, 0.10, 11.52), seg=5, seed=6181,
                 jit=0.20, rings=(0.30, 0.70), radii=(0.72, 1.00),
                 bands=("LeafDeep", "Leaf", "LeafLight")))
    # Shed lower limbs in the 45 to 58% band: the transition that says the bare
    # trunk is bare because the lower limbs went, not because the mesh starts
    # at 0.55. One of them is a long snapped spar that still hangs on.
    _stub(p, 24.0, 0.24, 0.50, 5.60, -0.14, 6201)
    _stub(p, 158.0, 0.23, 0.38, 6.25, 0.16, 6207, r_bot=0.062, r_top=0.026)
    _stub(p, 292.0, 0.22, 0.86, 6.85, -0.34, 6213, r_bot=0.070, r_top=0.024)
    return p


def pine_lod2():
    """A two-section cone over a bare trunk, both pushed toward 214 degrees so
    the far tree keeps the near tree's lean, plus one small satellite mass on
    the heavy side. An off-centre outline is what has to survive to 500 m: the
    lean is the only part of the LOD0's asymmetry big enough to read there."""
    p = hc.Parts()
    p.add(*_bands(((0.30, 0.00), (0.185, 3.80), (0.150, 7.30)), seg=4,
                  seed=6221, jit=0.04, roles="Bark", caps=(False, False),
                  offsets=((0.0, 0.0), (0.14, -0.07), (0.24, -0.05))))
    p.add(*_cone(1.62, PINE_H - 6.90, (0.03, 0.09, 6.90), seg=5, seed=6223,
                 r_mid=0.86, mid_z=0.55))
    p.add(*_dome(0.78, 0.66, 0.92, loc=(1.03, 0.76, 8.55), seg=4, seed=6227,
                 jit=0.10, rings=(0.34, 0.76), radii=(0.68, 1.00),
                 bands=("LeafDeep", "Leaf", "LeafLight")))
    return p


# ===========================================================================
# Canopy_Fir - 2.60 x 2.60 x 16.50 m, bare trunk to 0.62 of height
# ===========================================================================

FIR_H = 16.50

# The fir KEEPS its spire, because it is the emergent and the one shape in the
# set whose job is to break the canopy line. What it loses is concentricity.
#
# (r0, r1, z0, z1, phase_deg, (dx, dy), splits). The new column is the tier's
# own CENTRE OFFSET: a tier is still a stack of rings, but the stack no longer
# sits on the trunk axis, and consecutive tiers disagree about which way they
# are pushed. A spire built of concentric tiers is a solid of revolution and
# has one outline at every yaw; the same tiers shoved 10 to 25 cm off axis in
# alternating directions give a ragged column whose width genuinely changes as
# it turns. It costs nothing at all: `_bands` already takes a `loc`.
FIR_TIERS = (
    (1.24, 1.00, 10.28, 11.30, 17, (0.16, -0.07), (0.55, 0.88)),
    (1.16, 0.90, 11.15, 12.30, 55, (-0.13, 0.11), (0.47, 0.80)),
    (1.05, 0.78, 12.10, 13.25, 31, (0.09, 0.15), (0.39, 0.72)),
    (0.88, 0.62, 13.05, 14.20, 69, (-0.15, -0.06), (0.31, 0.64)),
    (0.72, 0.45, 14.00, 15.20, 8, (0.12, 0.09), (0.22, 0.55)),
    (0.50, 0.05, 15.00, 16.50, 44, (-0.07, 0.13), (0.12, 0.42)),
)

# Bough tips poking out through the tier profile: (az, r0, reach, z, dz, seed).
# A conifer tier's edge is where the eye reads the outline, and a clean frustum
# edge is a straight line. These break it, and the ones with a negative dz are
# the drooping lower branches that make a fir read as a fir rather than as a
# cone: they hang BELOW the tier they leave, which no ring of any radius can do.
FIR_SPURS = (
    (28.0, 0.60, 0.72, 10.72, -0.26, 6331),
    (139.0, 0.52, 0.86, 11.35, -0.34, 6337),
    (247.0, 0.58, 0.64, 11.95, -0.22, 6343),
    (72.0, 0.46, 0.70, 12.70, -0.26, 6349),
    (318.0, 0.44, 0.58, 13.40, -0.24, 6353),
    (186.0, 0.38, 0.62, 14.15, -0.28, 6359),
    (95.0, 0.30, 0.46, 15.05, -0.20, 6367),
    (263.0, 0.22, 0.40, 15.75, -0.18, 6373),
)


def fir():
    p = hc.Parts()
    p.add(*_bands(((0.36, 0.00), (0.27, 0.90), (0.225, 3.60), (0.145, 9.60),
                   (0.095, 15.40)), seg=5, seed=6301, jit=0.045, roles="Bark",
                  offsets=((0.0, 0.0), (-0.05, 0.03), (-0.12, 0.06),
                           (-0.16, 0.02), (-0.11, -0.04)),
                  ridge=(3, 0.075, -26.0), flare=(3, 0.55, 0.18)))
    for r0, r1, z0, z1, ph, off, splits in FIR_TIERS:
        za = z0 + (z1 - z0) * splits[0]
        zb = z0 + (z1 - z0) * splits[1]
        ra = r0 + (r1 - r0) * splits[0]
        rb = r0 + (r1 - r0) * splits[1]
        p.add(*_bands(((r0, z0), (ra, za), (rb, zb), (r1, z1)), seg=5,
                      seed=6321 + int(z0 * 100), jit=0.13, phase_deg=ph,
                      loc=(off[0], off[1], 0.0),
                      roles=["LeafDeep", "Leaf", "LeafLight"]))
    for az, r0, reach, z, dz, seed in FIR_SPURS:
        a = math.radians(az)
        x0, y0 = r0 * math.cos(a), r0 * math.sin(a)
        x1, y1 = (r0 + reach) * math.cos(a), (r0 + reach) * math.sin(a)
        v, f, sm, roles = tc.limb([(x0, y0, z), (x1, y1, z + dz)],
                                  [0.085, 0.030], seg=3, seed=seed, jit=0.18,
                                  roles="LeafDeep")
        # The UV centre is the SPUR's own midpoint, not the tree's origin. A
        # shell UV taken about the origin would give every vertex of a thin
        # off-axis tube nearly the same azimuth, so u would be a constant and
        # the whole spur would sample one column of the leaf card. Whether that
        # column is opaque or is cut away by the 0.35 alpha test would then be
        # decided by a hash, which is a coin flip on whether the branch exists.
        p.add(v, f, sm, roles,
              uvs=pc.shell_uvs(v, seed, centre=((x0 + x1) * 0.5,
                                                (y0 + y1) * 0.5)))
    # One dead spar high on the trunk, bare. The emergent is the tree that
    # takes the weather, so it is the one that should look like it has.
    _stub(p, 208.0, 0.13, 0.74, 13.90, 0.22, 6391, r_bot=0.060, r_top=0.020)
    return p


def fir_lod2():
    """Two stacked cones on a bare trunk, both pushed off the trunk axis in
    alternating directions so even the impostor is not a solid of revolution.
    One cone would run dead straight from 10.15 m to the tip and lose the taper
    that makes this the emergent; two sections keep it."""
    p = hc.Parts()
    p.add(*_bands(((0.26, 0.00), (0.165, 5.60), (0.125, 11.30)), seg=3,
                  seed=6401, jit=0.04, roles="Bark", caps=(False, False),
                  offsets=((0.0, 0.0), (-0.09, 0.05), (-0.13, 0.03))))
    p.add(*_cone(1.32, 3.95, (0.10, -0.06, 10.15), seg=5, seed=6403,
                 under="LeafDeep", tip="Leaf"))
    p.add(*_cone(0.84, 2.95, (-0.12, 0.08, 13.55), seg=5, seed=6407,
                 under="Leaf", tip="LeafLight"))
    return p


# ===========================================================================
# Canopy_Broadleaf - 9.00 x 9.00 x 10.50 m, bare trunk to the fork at 0.45
# ===========================================================================

BROAD_H = 10.50

# THIS IS THE PARASOL. Four overlapping spheroids centred over a trunk is a
# mushroom, and a mushroom is rotationally symmetric, so a hundred of them in
# one frame are a hundred copies of one outline. It is the single most repeated
# silhouette in a forest frame because it is also the widest.
#
# What replaces it is a spreading crown carried on FIVE unequal primary limbs
# out of an off-centre fork, two of which fork again, one of which is broken
# off short and carries nothing. Foliage hangs in plates at the limb ends AND
# part way back along the heavy ones, so the crown has depth in plan as well as
# an edge. The whole mass is biased toward 118 degrees: this tree reaches.
BROAD_FORK_Z = 4.60


def broadleaf():
    p = hc.Parts()
    # Buttressed, swept trunk. A 9 m crown standing on a 0.6 m dowel is the
    # other half of why the old one read as a prop; the flare is what makes it
    # look like it is holding the crown up.
    p.add(*_bands(((0.66, 0.00), (0.50, 1.00), (0.40, 3.80), (0.33, 7.45)),
                  seg=6, seed=6701, jit=0.05, roles="Bark",
                  offsets=((0.0, 0.0), (0.05, 0.04), (0.13, 0.09),
                           (0.20, 0.11)),
                  ridge=(4, 0.075, 30.0), flare=(4, 0.58, 0.30)))
    # Five primaries out of the fork. `_fan` puts them at uneven azimuths and
    # unequal reach, biased toward 118 degrees, and bough 2 is the broken one.
    tips = _fan(p, 6600, 6, 8.10, 9.25, 12.0, 0.46, 3.30, 2.35, 0.88,
                0.270, 0.105, 2.05, clumps=3, span=(0.34, 0.94), squash=1.02,
                seg_l=4, seg_p=6, steps=3,
                sweep=34.0, dead=2, plate_lift=0.06, lobe_deg=0.0,
                lobe=0.28)
    # Two of the primaries fork again, and the secondaries are what stop the
    # crown resolving into a countable number of equal lumps. Each takes its
    # parent's tip as its own root, so it is DERIVED from where the limb
    # actually ended rather than copied from the table that made it: two parts
    # dimensioned off one landmark is the catalogued coplanar defect.
    nxt = hc.rng(6650)
    for k in (0, 4):
        az, rr, tip = tips[k]
        for s in (-1, 1):
            a2 = az + s * (26.0 + 16.0 * nxt())
            r2 = rr * (0.26 + 0.20 * nxt())
            path = tc.arc(a2, rr + r2, tip[2] - 0.10, 0.55, 0.72, steps=2,
                          r0=rr * 0.86, sweep_deg=18.0 * s)
            p.add(*tc.limb(path, [0.105, 0.074, 0.046], seg=3,
                           seed=6660 + 11 * k + s, jit=0.16, roles="Bark"))
            t2 = path[-1]
            pr = 1.30 * (0.62 + 0.5 * nxt())
            p.add(*_dome(pr, pr * 0.88, pr * 0.86,
                         loc=(t2[0] * 0.92, t2[1] * 0.92, t2[2] + 0.14),
                         seg=6, seed=6680 + 13 * k + s, jit=0.19,
                         rings=(0.32, 0.74), radii=(0.66, 1.00),
                         bands=("LeafDeep", "Leaf", "LeafLight")))
    # Interior foliage, hung UNDER the crown between the fork and the plates.
    # A crown whose leaves are all on the outside is a shell, and a shell with
    # any hole in it shows you its own inside surface. These are what a player
    # standing under the tree looks up into.
    for lx, ly, lz, pr, sd in ((0.55, 1.05, 9.75, 1.16, 6721),
                               (-0.95, 0.20, 10.15, 0.98, 6727),
                               (0.20, -0.90, 9.55, 0.86, 6733)):
        p.add(*_dome(pr, pr * 0.86, pr * 0.72, loc=(lx, ly, lz), seg=5,
                     seed=sd, jit=0.22, rings=(0.32, 0.74),
                     radii=(0.66, 1.00),
                     bands=("LeafDeep", "LeafDeep", "Leaf")))
    return p


def broadleaf_lod2():
    """A low dome on a bare trunk, pushed toward 118 degrees so the far tree
    leans the way the near one does, with a second smaller mass on the light
    side. Widest below the middle, which is the outline a spreading crown
    actually has, and off centre, which is the part that has to survive."""
    p = hc.Parts()
    p.add(*_bands(((0.52, 0.00), (0.40, 2.40), (0.34, 4.90)), seg=4,
                  seed=6801, jit=0.04, roles="Bark", caps=(False, False),
                  offsets=((0.0, 0.0), (0.10, 0.07), (0.17, 0.10))))
    v, f, sm, roles = hc.lobe(3.95, 3.60, BROAD_H - 5.60,
                              loc=(2.01, 1.47, 5.60), seg=6, seed=6803,
                              jit=0.07, rings=((0.0, 0.58), (0.44, 1.00)),
                              role="Leaf")
    roles[0] = "LeafDeep"
    for i in range(len(roles) - 6, len(roles)):
        roles[i] = "LeafLight"
    p.add(v, f, sm, roles, uvs=pc.shell_uvs(v, 6803, centre=(2.01, 1.47),
                                            v_ripple=0.05))
    p.add(*_dome(1.85, 1.60, 1.90, loc=(-0.71, -0.93, 7.10), seg=5, seed=6807,
                 jit=0.12, rings=(0.34, 0.76), radii=(0.68, 1.00),
                 bands=("LeafDeep", "Leaf", "LeafLight")))
    return p


# ---------------------------------------------------------------------------
# RN-2202, THE IMPOSTOR RUNG.
#
# WHAT IT IS FOR. The world audit measured 188,081 triangles at 1,200 m and NOT
# ONE TREE in any aerial frame; the same missing far rung is why 58.8 per cent
# of the standing frame's triangles exist only to fill shadow maps. Both are the
# same shape: the cheapest thing this set can draw is a 28-to-58 triangle CONE,
# so the canopy can only be afforded inside a 620 m ring and only with every
# instance casting into three cascades.
#
# WHY THE OLD FILE SAID NOT TO BUILD ONE, AND WHY THAT REASON IS GONE. The
# contract's own comment reads: "LOD2 is hand authored as a CONE, never a
# decimate and never the crossed-quad impostor the harvest trees carry: there is
# no texture pipeline, so an untextured crossed quad renders as a solid
# rectangle." That was true and is not now. RN-181 moved the leaf roles into the
# `leaf` CARD family, so OF_Leaf is an alpha-tested unit-UV leaf texture, and
# this atlas already declares `uv_authored_materials: [OF_Leaf, OF_LeafDeep,
# OF_LeafLight]` with `family: leaf, alpha: true`. A crossed quad on OF_Leaf is
# a leaf mass now, not a rectangle. The rung is unblocked by a change somebody
# else made, which is worth writing down rather than quietly acting on.
#
# RN-2240, THE TRUNK STUB CAME OUT, AND IT IS NOT A TRIANGLE SAVING. It reads
# like one -- twelve triangles down to four -- but the real cost was never on
# this side of the pipe. PropLibrary batches by MATERIAL and registers one
# batch per (stem, material) found ANYWHERE the stem appears, not per LOD: a
# canopy tree's LOD0 and LOD2 use all four of Bark / LeafDeep / Leaf /
# LeafLight, so `PropLibrary.parts.get('Canopy_Pine')` was always four parts,
# and ScatterEmit's placement loop acquired an instance slot in EVERY one of
# them for EVERY canopy tree, because a placed prop is the union of its parts
# by construction (ScatterEmit.ts:193). The old LOD3 authored Bark and Leaf
# directly and left LeafDeep and LeafLight unauthored at this rung, so those
# two parts did not go empty, they fell back to their LOD2 geometry
# (PropLods.meshAtTier's walk-down rule, correct for an asset with no far rung
# at all, silently wrong for a rung that dropped ONE material on purpose) --
# the far tier was drawing a cone's worth of LeafDeep/LeafLight triangles at
# 91,760 total instances for a canopy population of only 22,940 trees.
#
# Dropping Bark from this rung, so it authors Leaf alone, is what lets
# ScatterEmit's canopy-only skip (RN-2240, `part.lods[LOD3] < 0` for a
# `spec.canopy` prop) refuse Bark, LeafDeep and LeafLight cleanly instead of
# refusing Bark and falling back on the other two: with all three gone the far
# tier acquires exactly ONE slot per tree, a real quarter of 91,760. The trunk
# itself costs nothing to lose: the thickest canopy stem here is 0.26 m in
# radius (Broadleaf) and no canopy instance is ever nearer than CANOPY_NEAR_M
# (550 m, past CANOPY_LOD3_M's own 420 m), where a 0.52 m stem is under a
# pixel wide in the shipped 1600x900 / 60 degree frame -- the identical
# arithmetic NODE_LOD3_M was derived from for the harvest trees, whose own
# `_card` (build_tree_conifer.py) already drops its stem the same way and
# whose docstring says it plainly: "dropping the trunk is the whole of the
# saving." This rung now matches that precedent instead of being the one
# holdout that kept a second material for a stub nobody was rendering.
#
# ONE MATERIAL AT THIS RUNG, AND SINCE RN-2245 IT IS ITS OWN. The rung was
# `OF_Leaf` and cost no new name; RN-2244's own report then said out loud that
# the tier's remaining limit was the ASSET, and the WG-220 verifiers agreed
# from the other side ("a nine-pixel green blob has no canopy texture, so woods
# read as scrub"). `leaf` is a picture of one conifer frond, `canopy` is a
# picture of one crown, and a frond minified to nine pixels is a green chip.
# The name costs one role, one texgen family and one PNG; it does NOT cost a
# draw call (see ORDER above) and it does not cost a triangle.
def _impostor(height, crown_lo, key):
    """Two crossed CROWN quads over the crown, and NOTHING ELSE. Four
    triangles, one material.

    Fitted to the SAME box as LOD0 and LOD2 by `pc.build_atlas`, which is what
    keeps the plan aspect RN-271 bought: the card is stretched by the same two
    factors the crown is, so the impostor is elliptical in plan exactly where
    the tree is and the per-instance yaw still changes its projected width. It
    is also what lets ONE authored crown serve three species: the pine's box is
    3.85 x 2.55 and the broadleaf's is 8.40 x 10.50, and the ovoid outline in
    `texgen._canopy_profile` was chosen to survive both stretches.

    STILL TWO CROSSED QUADS AND NOT THREE. The classic third quad -- a
    horizontal "lid" across the crown top -- was priced against this game's own
    aerial poses and refused; the arithmetic is in rendering.md 2.16.2, and in
    one line it is that a lid presents `sin(pitch)` of its area where the
    vertical pair presents `cos(pitch)`, so at the flyover's and forestair's
    14 degrees it is 0.249 of one quad's pixels for 50 per cent more triangles.
    A lid earns its cost past 45 degrees of pitch and this game has no shipped
    pose there.
    """
    p = hc.Parts()
    z0 = height * crown_lo
    v, f, sm = hc.crossed_quads(2.0, height - z0, z0=z0, yaw_deg=0.0)
    p.add(v, f, sm, "Canopy", uvs=pc.quad_card_uvs(2, key))
    return p


# THE FOOTPRINTS ARE NO LONGER SQUARE, AND THAT IS THE SINGLE HIGHEST-LEVERAGE
# NUMBER IN THIS FILE. It was found by measurement and it is worth stating
# plainly, because it defeats the obvious version of this pass.
#
# `Parts.fit` scales X and Y INDEPENDENTLY to make the finished pile exactly
# fill `size`. Against a SQUARE size that is not a neutral operation: it takes
# whatever plan-view aspect the crown was authored with and normalises it away.
# The first draft of this pass rebuilt all three crowns out of asymmetric
# boughs and still measured a plan aspect of 1.019 on the pine, i.e. round,
# because fit had squared it back up. Projected width therefore still barely
# moved with yaw (width cv 0.023) even though the silhouette OVERLAP between
# two yaws had collapsed from 0.845 to 0.352.
#
# So the box states the aspect the tree actually has, and fit then preserves it
# instead of destroying it. The MEAN footprint is deliberately held near the old
# value (pine 3.10 to 3.10, fir 2.60 to 2.55, broadleaf 9.00 to 9.20) so the
# forest does not get denser or thinner as a side effect of a silhouette fix;
# what changes is that a canopy tree is now half again as wide across one
# bearing as across the other, and the scatter's per-instance yaw turns that
# into a different width for every tree in the frame.
#
# It is also the right shape on its own terms. A crown grown in a stand reaches
# toward the gaps and is elliptical in plan; a circular crown is what you get
# from a lathe.
#
# The FIR earns its aspect differently and honestly: its crown is still tiers
# rather than a bough fan, so it has no second harmonic of its own, and the
# 2.90 x 2.20 box is what turns those tiers into ellipses. For a stack of rings
# that stretch is exact and uniform at every height, which is why it is an
# acceptable way to buy the aspect there and not a way to buy it anywhere.
# The LOD3 crown bases are each tree's OWN measured lowest-foliage fraction,
# printed by `report_foliage_ratio` off the exported bytes every build (pine
# 0.597, fir 0.623, broadleaf 0.586) and rounded DOWN a little so the card
# starts at or below the foliage rather than above it. They are read off the
# asset rather than chosen, which is the only reason they can be trusted to
# stay right when the crowns move: if a crown drops, the printed number drops
# with it and the mismatch is visible in the build log.
PROPS = [
    pc.Prop("Canopy_Pine", (3.85, 2.55, PINE_H), pine, ORDER,
            lod2=pine_lod2,
            lod3=lambda: _impostor(PINE_H, 0.55, 22001),
            collide=False,
            note="crown in the top 45%, bare trunk to 0.55 of height"),
    pc.Prop("Canopy_Fir", (2.90, 2.20, FIR_H), fir, ORDER,
            lod2=fir_lod2,
            lod3=lambda: _impostor(FIR_H, 0.60, 22002),
            collide=False,
            note="the emergent: crown in the top 38%, bare to 0.62"),
    pc.Prop("Canopy_Broadleaf", (8.40, 10.50, BROAD_H), broadleaf, ORDER,
            lod2=broadleaf_lod2,
            lod3=lambda: _impostor(BROAD_H, 0.52, 22003),
            collide=False,
            note="forks at 0.45, crown carried above 0.60"),
]


# THE BARE-TRUNK FLOOR IS RETIRED, BY REID'S RULING AND NOT BY ANYONE JUDGING
# THE GATE WRONG. RN-310, 2026-08-01.
#
# Reid ruled, verbatim: "there should be no scenery trees. all trees should be
# minable." That abolishes the SCENERY-versus-HARVESTABLE distinction outright,
# and WG-13 to WG-17 existed only to keep those two families apart at 200 m on
# the silhouette alone. With one family there is nothing left to separate, so
# bare-trunk fractions are no longer constrained on any tree in this project
# and root flare, low branching and forks may go wherever the form wants them.
#
# THE GATE WAS RIGHT WHILE THE RULE STOOD, and it is worth saying so plainly
# because it is being deleted. WG-14's own reasoning applied to itself: a rule
# stated in a docstring drifts from the asset the first time either moves. The
# RN-271 pass moved this asset FOUR times and drifted the number THREE of them,
# in both directions (broadleaf 0.632 -> 0.507 -> 0.558 -> 0.468 -> 0.516),
# each time caught only because a human happened to re-run the tool. It then
# caught a genuine near miss: at 0.531 against the harvest broadleaf's 0.517
# the two were the same tree at two sizes on the one signal the rule existed to
# protect, a margin of 0.014. It was watched failing, too (floor temporarily
# raised to 0.70, build refused by name, reverted, glb byte-identical).
#
# THE LESSON OUTLIVES THE RULE, and it is the part to keep: A CONSTRAINT THAT
# SEPARATES TWO FAMILIES CANNOT BE CHECKED BY MEASURING ONE OF THEM. WG-14
# measured the SCENERY fractions off the exported bytes and never published the
# HARVEST ones, so nothing in the project recorded that the broadleaf pair was
# separated by 0.11 of height and by nothing else, and the margin could shrink
# to 0.014 with every published number still looking healthy.
#
# WHAT SURVIVES, AND WHY IT IS NOT THE OLD RULE IN DISGUISE. The measurement is
# kept and PRINTED, because a number nobody can see is a number that drifts,
# and the geometry pass that follows Reid's ruling will want to watch these
# fractions fall on purpose. The only thing still asserted is that every canopy
# LOD0 has SOME foliage on it, which is a build defect (a tree exported as a
# bare pole) rather than a design rule about two families: it does not name a
# fraction, it cannot be satisfied by making a tree taller, and it would have
# fired on `ratio is None` under the old gate too.
CANOPY_TREES = ("Canopy_Pine", "Canopy_Fir", "Canopy_Broadleaf")


def report_foliage_ratio(path):
    """Print each canopy LOD0's lowest foliage as a fraction of its height, and
    refuse only a tree that has no foliage at all.

    Reads the EXPORTED file, not the in-memory Parts pile, for the reason
    WG-14 gives and which still holds: Parts.fit rescales z after every build
    function has returned, so a ratio computed before the fit is a ratio of a
    shape that never shipped."""
    import flora_silhouette as fs   # noqa: E402  (pure python, no bpy)
    import validate_glb as vg       # noqa: E402
    gltf, binc, _n = vg.read_glb(path)
    walked = vg.walk(gltf)
    bare = []
    for idx, (nm, _m, _p) in sorted(walked.items()):
        if not nm.endswith("_LOD0") or nm[:-5] not in CANOPY_TREES:
            continue
        ratio, h = fs.foliage_ratio(fs.node_triangles(gltf, binc, walked,
                                                      idx, []))
        print("[canopy] %-18s h=%5.2f  lowest foliage at %s of height "
              "(unconstrained since RN-310)"
              % (nm[:-5], h, "NONE" if ratio is None else "%.3f" % ratio))
        if ratio is None:
            bare.append(nm[:-5])
    if bare:
        raise SystemExit("[canopy] NO FOLIAGE ON: " + ", ".join(bare)
                         + " (a canopy tree exported as a bare pole is a build"
                           " defect, not an art choice)")


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
    report_foliage_ratio(OUT)
