"""rocket_common.py - Tier 2 vessel geometry and the TWO-CLASS STACK CONTRACT.

    build_rocket_parts.py, build_lander_landed.py

THE STACK CONTRACT (ASSET-SPECS 3.3 / 4.23). Everything else in Tier 2
composes out of this, so it is stated once, here, and the validator checks it
per part through contracts.json's `part_sockets` block.

  DIAMETER      TWO CLASSES AND NO MORE (DW-29). Class S is 1.25 m across
                (R = 0.625) and class L is 2.50 m (R = 1.250), exactly 2x, so
                the catalogue has one lift class and one heavy class rather
                than a continuum nobody can remember. Inside a class every
                tank, engine, decoupler and pod mate without a per-pair
                adapter; BETWEEN the classes there is exactly one part,
                StackAdapter, whose two ends differ. Without it two classes
                would be two disjoint catalogues.

                Segment counts are 16 and 24, and divisible-by-4 is the whole
                reason for both: a polygon whose segment count is divisible by
                4 puts vertices exactly on +-X and +-Y, so the exported
                bounding box is exactly the class diameter. A 14-gon of
                radius 0.625 measures 1.250 x 1.244 and fails the dimension
                check by 6 mm.

                Class L's collars carry R = 1.250 exactly while its barrel is
                1.200, which is class S's 0.625 / 0.600 language doubled: a
                stringer standing proud of the barrel can then never touch the
                bounding box.

  AXIS          The stack axis is Blender +Z, which is three.js +Y after
                export_yup. A vessel is therefore assembled up the world up
                axis and needs no rotation to sit on a launch pad.

  ORIGIN        A stack part's origin is its BOTTOM mating plane, centred on
                the axis: pivot rule "ground", the same rule a machine obeys.
                So socket_stack_bottom is ALWAYS at the local origin, and
                stacking B on A is
                    B.position = A.position + A.socket_stack_top.position
                with no per-part offset table anywhere in the engine.

  SOCKETS       socket_stack_bottom  local (0, 0, 0),  facing -Y (three.js),
                                     i.e. DOWN, away from the part.
                socket_stack_top     local (0, H, 0) in three.js axes,
                                     facing +Y, i.e. UP, away from the part.
                Two mated sockets are therefore anti-parallel, which is what
                lets the engine test "do these two faces mate" as a dot
                product rather than as a naming convention.
                An ENGINE has no socket_stack_bottom: it terminates a stack.
                A NOSE CONE has no socket_stack_top, for the same reason.

  RADIAL PARTS  A leg, fin, solar panel, RCS block or vernier is not a stack
                element. Its origin is its MOUNT PLANE and its body extends
                +X (three.js +X), so a radial attach is
                    part.position = (R * cos a, y, R * sin a)   [three.js]
                    part.rotateY(-a)
                with R the host tank's radius. Each carries
                socket_radial_mount at its own origin, and its pivot rule is
                "none" because neither "ground" nor "centre" describes a part
                whose origin is on its own side face.

  DEPLOY        The landing leg and the solar panel are authored STOWED,
                because a vessel flies stowed and the frame-1 identity rule
                (ASSET-SPECS 2.7) means the exported static pose is whatever
                frame 1 of its clip is. Deploying is one clip driving one
                pivot from the identity, and stowing is the same clip played
                with a negative timeScale.

Nothing here touches bpy: every builder returns an hc.Parts pile in metres,
Blender axes, so build_rocket_parts.py can pour it straight into a mesh and
build_lander_landed.py can rotate and place the same pile four times.

THE CAPPED-TUBE DEFECT, AND WHY IT IS FIRST IN THIS FILE (RN-411).
check_coplanar.py measured this asset at 778 overlapping same-facing pairs,
an order of magnitude worse than anything else in the game. 704 of those 778,
which is 90.5 percent, are ONE mistake made once and repeated in eleven parts:

    a tube in this file is CAPPED AT BOTH ENDS, and every stack part is built
    as two or more concentric tubes that SHARE AN END PLANE.

A tank is a barrel at the class barrel radius spanning z = 0 to h, plus a
collar at the class mating radius spanning z = 0 to 0.09. Both start at z = 0.
Both therefore emit a bottom cap on z = 0 facing -Z, in two different
materials, one entirely inside the other. Neither is in front. The depth test
has nothing to arbitrate with, so the MATING FACE OF EVERY TANK IN THE GAME
resolves to whichever of SteelLight and SteelDark the rasteriser happened to
visit last. Nobody saw it because a mating face is covered in an assembled
stack; it is the top of the topmost part, the bottom of the bottom-most, and
every part held on its own in the VAB that show it.

The fix is `caps=`, and it is triangle-NEGATIVE: the buried cap is deleted
rather than nudged, because a disc of radius 0.600 sealed inside a collar of
radius 0.625 was never geometry anyone could see. See _CAP_ORDER for the guard
that keeps this honest.

THE FORM VOCABULARY (RN-412) then spends what the deletion saved, plus an
argued raise, on the things docs/web/ART-DIRECTION.md asks for: weld seams,
stringer end fittings, insulation blankets with a hard edge, plumbing that
runs down ONE side of a tank and not four, and fittings whose azimuths are
prime to each other so that no two parts in a stack line up.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402


# class -> (mating radius, segments, barrel radius). THE table: every stack
# part derives its numbers from here rather than carrying literals, so "what
# is class L" has exactly one answer and adding a third class would be a
# one-line change rather than an archaeology exercise.
CLASS = {
    "S": (0.625, 16, 0.600),      # 1.25 m, the lift class
    "L": (1.250, 24, 1.200),      # 2.50 m, the heavy class, exactly 2x
}

# Class-S aliases. Class S is the default everywhere, and these are what the
# original thirteen parts and build_lander_landed.py already spell.
R, SEG, R_BODY = CLASS["S"]

# Trim counts that do NOT simply scale with the class. Four stringers read as
# "ribbed" on a 1.25 m barrel; the same four spread around a 2.50 m barrel read
# as bare, because the eye counts gaps, not ribs. Same argument for the
# decoupler's separation bolts.
STRINGERS = {"S": 4, "L": 8}
DECOUPLER_BOLTS = {"S": 6, "L": 10}


def class_scale(cls):
    """How much bigger this class's TRIM is than class S's.

    Trim depth (collar height, band width, stringer section) scales with the
    class, but part HEIGHTS do not: a 2.50 m decoupler is 0.35 m tall, not
    0.50, because its job is to be a joint and a joint does not get taller
    just because it got wider."""
    return CLASS[cls][0] / CLASS["S"][0]

# Material slot order, pinned across all 13 parts. A renderer that wants "the
# glass" or "the state-orange trim" of any part indexes the same slot on every
# one of them. Parts.into() skips roles a part does not use, so passing the
# full list never creates an empty slot.
# RN-851 APPENDS "Rubber" AND DOES NOT REORDER, which is the whole point of a
# pinned list: every existing index is unchanged, so nothing that indexes a
# slot today has to be found and edited. It buys the ONE dielectric on an
# otherwise entirely metallic catalogue, the docking port's seal gasket, and
# that is a material claim rather than a colour one: metalness 0.85 -> 0.00 and
# roughness 0.55 -> 0.85 is a surface that answers the light differently, which
# is exactly what ART-DIRECTION.md asks a surface to do. A dark grey painted
# onto steel is not a seal; it is steel that has been told to look like one.
ROLES = ["SteelLight", "Steel", "SteelDark", "Accent", "Hazard", "Glass",
         "SuitAccent", "Rubber"]

# Deploy geometry, shared with the landed lander so the static assembly and the
# animated part agree to the millimetre.
# A LEG MUST OUT-REACH THE ENGINE BELL. The first version of this part folded
# 1.34 m of strut and dropped its foot 0.98 m below the hinge, and the landed
# lander is what proved that useless: a 1.60 m engine hangs below the tank the
# legs mount on, so a leg that drops less than about 2.1 m puts the bell
# through the ground before the feet touch it. 2.42 m of strut at 145 degrees
# drops 2.13 m and reaches 1.18 m out, which lands the bell 0.26 m clear.
LEG_DEPLOY_DEG = 145.0     # leg_pivot rotation about +Y, stowed -> deployed
LEG_PAD_LOC = (0.26, 0.0, 2.42)   # foot pad centre, STOWED, leg-pivot local
SOLAR_DEPLOY_DEG = 90.0    # solar_pivot rotation about +Y
SOLAR_HINGE_X = 0.13       # array hinge, on the outboard face of its mount


def leg_foot_offset():
    """Where the foot pad ends up once Leg_Deploy has played, relative to the
    leg's mount point. The landed lander needs this to sit its feet on z = 0,
    and physics needs it as the ground-contact point."""
    a = math.radians(LEG_DEPLOY_DEG)
    x, _, z = LEG_PAD_LOC
    return (x * math.cos(a) + z * math.sin(a), 0.0,
            -x * math.sin(a) + z * math.cos(a))


# ---------------------------------------------------------------------------
# Primitive helpers. A rocket is a stack of tubes; everything else is trim.
# ---------------------------------------------------------------------------

def _cap_order():
    """Which face index of of_lib.cyl_data is which cap, MEASURED not assumed.

    `caps=` below deletes faces by index, which couples this file to of_lib's
    internal face order. That is a coupling worth having (the alternative is
    re-implementing the cylinder) but not worth trusting, so it is checked
    once at import against a probe cylinder whose two ends are at known
    heights. If of_lib ever reorders its faces this raises here, by name, at
    import, rather than silently deleting a side quad out of every tank in the
    catalogue."""
    v, f, _sm = of.cyl_data(1.0, 2.0, (0.0, 0.0, 0.0), segments=6)
    if len(f) != 8:
        raise RuntimeError("cyl_data face count changed: %d, expected 8"
                           % len(f))
    zs = [[round(v[i][2], 6) for i in face] for face in f[:2]]
    if zs[0] != [-1.0] * 6 or zs[1] != [1.0] * 6:
        raise RuntimeError("cyl_data cap order changed: %r" % zs)
    return (0, 1)


_CAP_ORDER = _cap_order()
# `caps=` values -> the set of cap face indices to KEEP.
_CAPS = {"both": {0, 1}, "lo": {0}, "hi": {1}, "none": set()}


def tube(p, r, z0, z1, role, r_top=None, seg=SEG, smooth=True, loc=(0.0, 0.0),
         caps="both"):
    """A cylinder or frustum between two heights on the stack axis.

    `caps` is "both" (the default, unchanged), "lo", "hi" or "none", naming
    which END DISCS survive. Suppressing a cap is the fix for the defect the
    module docstring describes, and the rule for using it is narrow: SUPPRESS A
    CAP ONLY WHERE THE DISC IS ENTIRELY INSIDE ANOTHER SOLID. A suppressed cap
    on an open end is a hole you can see through into the inside of the part,
    which is a worse defect than the one being fixed and is not caught by any
    checker in this project."""
    v, f, sm = of.cyl_data(r, z1 - z0, (loc[0], loc[1], (z0 + z1) * 0.5),
                           axis="Z", segments=seg, smooth_sides=smooth,
                           radius_top=r_top)
    if caps != "both":
        keep = _CAPS[caps]
        f = [face for i, face in enumerate(f) if i > 1 or i in keep]
        sm = [s for i, s in enumerate(sm) if i > 1 or i in keep]
    return p.add(v, f, sm, role)


def slab(p, size, loc, role, rot_z=0.0):
    v, f, sm = of.box_data(size, loc, rot_z)
    return p.add(v, f, sm, role)


def ring_slabs(p, size, radius, count, z, role, phase=0.0):
    """`count` small boxes around the stack axis: rivet rows, bolt clusters,
    stringers. Placed at 45 degree azimuths by default so a box that stands
    proud of the barrel still cannot push the 1.25 m bounding box."""
    for i in range(count):
        a = 2.0 * math.pi * i / count + phase
        slab(p, size, (radius * math.cos(a), radius * math.sin(a), z), role)
    return p


def disc(p, r, thickness, loc, role, seg=8, axis="Z"):
    v, f, sm = of.cyl_data(r, thickness, loc, axis=axis, segments=seg,
                           smooth_sides=False)
    return p.add(v, f, sm, role)


def ring_band(p, r_in, r_out, z0, z1, role, seg=SEG, phase_deg=0.0):
    """A true ANNULUS prism: a ring with a hole all the way through it.

    Everything else in this file is a capped tube, and a capped tube inside a
    capped tube is two discs nobody can see. The docking port needs an actual
    hole, because "flat ring" is its entire silhouette and a disc with a
    darker disc painted on it is a different part at 30 m.

    Built as TWO HALF SWEEPS rather than one 0-to-360 sweep, because a full
    sweep puts its start and end caps on the same plane, and mesh.validate()
    deletes the degenerate result - which would make the reported triangle
    count a lie (of_lib.arc_band_data says the same thing about r_in). The two
    seam caps that remain are coincident, interior and backface-culled.

    `phase_deg` ROTATES WHERE THE SEAM IS, and it exists because "coincident,
    interior and backface-culled" stops being true the moment two rings of
    DIFFERENT MATERIALS overlap radially. RN-851 stacked three concentric
    annuli to build a sealing interface (a metal contact land, a seal land and
    a rubber gasket) and `check_coplanar.py` immediately found 16 same-facing
    pairs on the plane y = 0: every ring puts its two seam caps on that one
    plane, so where two rings overlap, one ring's cap is painted on another
    ring's cap in a different material.

    Phasing by a WHOLE SEGMENT STEP moves the cap plane without moving a single
    vertex: an annulus phased by 22.5 degrees at seg 16 has the same ring of
    vertex azimuths as one phased by 0, because the set {0, 22.5, 45, ...} is
    closed under a 22.5 shift. So the facets still line up with the barrel and
    with each other, and only the seam moves. Phase by something that is NOT a
    segment step and the facets stop aligning, which is a different defect."""
    loc = (0.0, 0.0, (z0 + z1) * 0.5)
    for a0 in (phase_deg, phase_deg + 180.0):
        v, f, sm = of.arc_band_data(r_in, r_out, z1 - z0, loc,
                                    a0, a0 + 180.0, max(1, seg // 2))
        p.add(v, f, sm, role)
    return p


def bell_shell(p, r_exit, r_throat, z0, z1, role, wall=0.025, seg=SEG):
    """A THIN-WALLED conical nozzle: an outer surface, an inner surface, and a
    rim annulus closing the wall thickness at each end.

    Every other tube in this file is CAPPED, and a capped bell is a solid disc
    across the nozzle mouth. On a sea-level engine that never shows: the mouth
    is 1.16 m across at most and it points away from everything. On a VACUUM
    engine the mouth is 1.23 m across and is the entire read of the part, so a
    disc there is the difference between a nozzle and a bucket.

    Wall thickness is 25 mm because it has to survive being seen: a real
    regeneratively cooled wall is a few millimetres, which at this scale is one
    pixel of rim and reads as an authoring mistake rather than as thin.

    ON check_mating's COAXIAL PASS. A shell puts two different radii in the
    same axial plane, so it fails that check's solid-of-revolution test and is
    SKIPPED rather than compared. Nothing is being smuggled past the check:
    the condition it exists to enforce is that coaxial round surfaces share a
    segment count, and on this part every one of them does, by construction.
    """
    n = seg
    v = []
    for r, z in ((r_exit, z0), (r_exit - wall, z0),
                 (r_throat, z1), (r_throat - wall, z1)):
        for i in range(n):
            a = 2.0 * math.pi * i / n
            v.append((r * math.cos(a), r * math.sin(a), z))
    ob, ib, ot, it = 0, n, 2 * n, 3 * n
    f, sm = [], []
    for i in range(n):
        j = (i + 1) % n
        f.append((ob + i, ob + j, ot + j, ot + i))     # outer wall
        sm.append(True)
        f.append((ib + j, ib + i, it + i, it + j))     # inner wall, reversed
        sm.append(True)
        f.append((ob + i, ob + j, ib + j, ib + i))     # exit rim, normal -Z
        sm.append(False)
        f.append((ot + j, ot + i, it + i, it + j))     # throat rim, normal +Z
        sm.append(False)
    return p.add(v, f, sm, role)


# ---------------------------------------------------------------------------
# THE FORM VOCABULARY (RN-412). Detail that is cheap, and detail that is
# ASYMMETRIC, because a stack of solids of revolution is what this catalogue
# already was.
# ---------------------------------------------------------------------------

# Fitting azimuths, in degrees, and the reason they are these numbers.
#
# ANYTHING ON +-X OR +-Y PUSHES THE BOUNDING BOX. A 16-gon at the mating radius
# has vertices exactly on the four axes, which is what makes the exported AABB
# exactly 1.250 m (see the CLASS note above); a fitting standing 40 mm proud of
# the barrel at azimuth 0 measures 1.280 and fails dims_xyz_m by 30 mm. So
# every fitting azimuth here is off-axis, and `hull` asserts the result.
#
# THEY ARE ALSO NOT MULTIPLES OF THE STRINGER PITCH. Stringers sit on the
# half-azimuth of a 4-fold or 8-fold ring; a feed line at 45 degrees would ride
# exactly on one and read as part of it. 23 / 68 / 157 / 292 share no factor
# with 45 or 90, so a tank has plumbing on one side, a conduit on another, and
# a bare quadrant you can see the weld seams across.
# A THIRD CONSTRAINT SETS THE ACTUAL NUMBERS, and it is arithmetic rather than
# taste. A fitting sitting on the barrel is centred near r 0.64 on a class
# whose radius is 0.625, so it only fits at all where the axis it would push is
# well off the azimuth: the reach is r|cos a| + hx|cos a| + hy|sin a|, which
# clears 0.625 only for a between about 28 and 62 degrees of an axis. These
# four are 33 / 28 / 34 / 32 degrees off their nearest axis, and 10 to 13
# degrees off the nearest stringer at either class.
AZ_FEED = 33.0        # main propellant feed line, one side only
AZ_CONDUIT = 118.0    # instrumentation conduit
AZ_LUG = 214.0        # hold-down / lifting lug
AZ_PLACARD = 302.0    # stencil plate, the one flat spot on a round part


def hull(r, az_deg, clearance=None):
    """(x, y) at radius `r` and azimuth `az_deg`, refusing anything that would
    reach the class bounding box.

    `clearance` is the mating radius the result must stay inside, i.e. the
    number dims_xyz_m is measured against. Passing it turns "I think this
    fitting fits" into an arithmetic fact printed at build time, which is the
    half of the bounding-box rule that STRINGERS documents in prose and that
    nothing has ever checked."""
    a = math.radians(az_deg)
    x, y = r * math.cos(a), r * math.sin(a)
    if clearance is not None and max(abs(x), abs(y)) > clearance:
        raise ValueError(
            "fitting at r %.4f azimuth %.1f reaches %.4f on an axis, past the "
            "%.4f class radius: it would widen the part past its class"
            % (r, az_deg, max(abs(x), abs(y)), clearance))
    return x, y


def weld(p, r, z, role, seg=SEG, proud=0.006, h=0.024):
    """A circumferential weld bead: a capless ring standing `proud` of the
    barrel it is on.

    2 * seg triangles for a hard horizontal line all the way round a tank, and
    it is the cheapest detail in this file per unit of read. Real tanks are
    welded from rolled plate courses and the bead is the one thing that says
    so. Capless because both discs would be sealed inside the barrel, which is
    exactly the defect the module docstring is about."""
    return tube(p, r + proud, z - h * 0.5, z + h * 0.5, role, seg=seg,
                smooth=False, caps="none")


def blanket(p, r, z0, z1, role, seg=SEG, proud=0.010):
    """Cryogenic insulation over part of a barrel: a capless sleeve with a hard
    edge top and bottom.

    A hard edge is the whole point. Insulation on a real tank is a blanket that
    STOPS, and the step where it stops is a silhouette break and a shadow line.
    Capless for the same reason weld is: the discs are inside the barrel."""
    return tube(p, r + proud, z0, z1, role, seg=seg, smooth=True, caps="none")


def feed_line(p, r_hull, az_deg, z0, z1, role, clearance, r_pipe=0.032,
              seg=6, boss_role=None):
    """A propellant or pressurant line running down ONE side of a barrel, with
    a fairing boss at each end.

    THE ASYMMETRY IS THE POINT. Everything else in this catalogue is a solid of
    revolution, and RN-271 measured what that costs on a forest: the engine
    already rotates instances, and a shape that is the same from every bearing
    gives the rotation nothing to act on. A tank cannot stop being round, but
    its plumbing can stop being four-fold."""
    x, y = hull(r_hull + r_pipe, az_deg, clearance)
    tube(p, r_pipe, z0, z1, role, seg=seg, smooth=True, caps="none",
         loc=(x, y))
    for z in (z0, z1):
        bx, by = hull(r_hull + r_pipe * 0.4, az_deg, clearance)
        tube(p, r_pipe * 1.9, z - 0.055 if z == z1 else z,
             z if z == z1 else z + 0.055, boss_role or role, seg=seg,
             smooth=False, caps="none", loc=(bx, by))
    return p


def fitting(p, size, r_hull, az_deg, z, role, clearance, yaw=True):
    """One box fitting on a barrel, placed by radius and azimuth, yawed to face
    outward, and CHECKED against the class bounding box for real.

    `hull` checks a point; this checks the solid, which is the check that
    matters. A box yawed by `a` with half-sizes (hx, hy) has world AABB half
    extents hx|cos a| + hy|sin a| and hx|sin a| + hy|cos a|, so a wide fitting
    near an axis reaches much further than its centre does. A 0.16 m lug at
    azimuth 157 sits at x = -0.580 and REACHES -0.671, which is 46 mm past the
    class radius and would have failed dims_xyz_m by 92 mm on a check nobody
    would have thought to run until the validator said so two minutes later.
    """
    a = math.radians(az_deg)
    ca, sa = abs(math.cos(a)), abs(math.sin(a))
    hx, hy = size[0] * 0.5, size[1] * 0.5
    ex, ey = (hx * ca + hy * sa, hx * sa + hy * ca) if yaw else (hx, hy)
    x, y = r_hull * math.cos(a), r_hull * math.sin(a)
    reach = max(abs(x) + ex, abs(y) + ey)
    if reach > clearance:
        raise ValueError(
            "fitting %s at r %.4f azimuth %.1f reaches %.4f, past the %.4f "
            "class radius" % (list(size), r_hull, az_deg, reach, clearance))
    return slab(p, size, (x, y, z), role, rot_z=az_deg if yaw else 0.0)


def stud_ring(p, size, radius, count, z, role, phase=0.0, clearance=None):
    """ring_slabs with the bounding-box check ring_slabs never had.

    Every ring of bolts, lugs and stringers in this file is placed by radius
    and azimuth and then hoped to be inside the class. `clearance` makes the
    hope an assertion; the half-diagonal of the box is added because a box at
    45 degrees reaches further on an axis than its centre does."""
    half = max(size[0], size[1]) * 0.5
    for i in range(count):
        a = 2.0 * math.pi * i / count + phase
        x, y = radius * math.cos(a), radius * math.sin(a)
        if clearance is not None and max(abs(x), abs(y)) + half > clearance:
            raise ValueError(
                "stud %d of %d at r %.4f reaches %.4f past the %.4f class "
                "radius" % (i, count, radius,
                            max(abs(x), abs(y)) + half, clearance))
        slab(p, size, (x, y, z), role)
    return p


def hexa(p, bottom, top, role):
    """An arbitrary eight-vertex solid: two quads, matching corner order.

    Everything else in this file is a solid of revolution or an axis-aligned
    box, and both of those are yawed at most. A GUIDE PETAL is neither: its
    inner face has to lie on a cone at a stated angle, its width has to change
    along its length, and it has to be a closed solid so it can be lit from
    both sides. Twelve triangles buys all of that, which is cheaper than any
    approximation out of tubes.

    `bottom` and `top` are four points each, in the SAME rotational order,
    counter-clockwise seen from +Z. Winding is then of_lib._box_data's exactly:
    the bottom quad reversed, the top quad forward, and the four sides walking
    the same corner pairs. Copied from that function rather than reasoned out,
    because a face wound the wrong way is invisible in Blender (which draws
    both sides) and a hole in the browser (which does not).

    `role` may be one role or a list of six, bottom, top, then the four sides
    in corner order. The per-face form is how a petal gets a POLISHED INNER
    FACE against a dull outer one, which is what a part that has been scraped
    by another hull actually looks like."""
    if len(bottom) != 4 or len(top) != 4:
        raise ValueError("hexa needs four points top and bottom")
    v = list(bottom) + list(top)
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return p.add(v, f, [False] * 6, role)


def petal(p, az_deg, r_tip, z_tip, z_root, cone_deg, thickness,
          half_w_root, half_w_tip, role, clearance=None, skew_deg=0.0):
    """A docking guide petal: a tapered plate whose INNER face is a cone.

    THE TWO CATALOGUE NUMBERS ARE THIS SHAPE AND NOT A COMMENT. `vessel.h`
    publishes `dockCaptureRadiusM` and `dockCaptureConeRad` for the docking
    port, and until now no geometry anywhere expressed either of them: the
    part could have been any diameter with any lead-in and every gate would
    have passed. Here `r_tip` IS the capture radius (the circle a petal tip
    sweeps at the mating plane) and `cone_deg` IS the capture cone (the angle
    the inner face makes with the stack axis), so a change to either number in
    the catalogue moves the mesh, and a mesh that cannot honour a number
    raises here instead of disagreeing quietly.

    `skew_deg` rotates the tip relative to the root about the stack axis. Real
    petals are not skewed; a petal that has been loaded sideways by thirty
    dockings is. It is per-petal so no two need to match.

    `clearance` is the class mating radius every corner must stay inside,
    checked on the CORNERS rather than on the centre line, because the corner
    of a wide tip near an axis reaches much further than its centre does.
    """
    dz = z_tip - z_root
    if dz <= 0.0:
        raise ValueError("petal tip must be above its root")
    r_root = r_tip - dz * math.tan(math.radians(cone_deg))
    if r_root <= 0.0:
        raise ValueError("petal cone %.1f deg over %.3f m eats the whole "
                         "radius" % (cone_deg, dz))
    out = []
    for (r_in, z, half_w, extra_az) in ((r_root, z_root, half_w_root, 0.0),
                                        (r_tip, z_tip, half_w_tip, skew_deg)):
        a = math.radians(az_deg + extra_az)
        ca, sa = math.cos(a), math.sin(a)
        ux, uy = ca, sa                 # radial
        tx, ty = -sa, ca                # tangential
        quad = []
        for (dr, dw) in ((0.0, -half_w), (thickness, -half_w),
                         (thickness, half_w), (0.0, half_w)):
            r = r_in + dr
            quad.append((r * ux + dw * tx, r * uy + dw * ty, z))
        out.append(quad)
    if clearance is not None:
        for q in out:
            for (x, y, _z) in q:
                if max(abs(x), abs(y)) > clearance:
                    raise ValueError(
                        "petal at azimuth %.1f reaches %.4f on an axis, past "
                        "the %.4f class radius"
                        % (az_deg, max(abs(x), abs(y)), clearance))
    return hexa(p, out[0], out[1], role)


def bell(p, profile, role, seg=SEG, wall=0.030, flute=0.0, sleeve=0.30,
         smooth=True, loc=(0.0, 0.0)):
    """A rocket nozzle: an open-mouthed shell swept through a `profile` of
    (z, radius) rings, bottom (the exit) upward, optionally FLUTED.

    THREE THINGS THIS DOES THAT bell_shell DOES NOT, and each is why the
    engines are re-authored rather than re-proportioned (RN-413).

      A CURVE.       bell_shell takes two radii and interpolates linearly, so
                     every nozzle in this catalogue was a straight cone in two
                     segments with a visible kink between them. A real bell is
                     a bell: it flares hard near the throat and flattens toward
                     the exit. `profile` is that curve, and the ring count is
                     the only thing it costs.
      FLUTES, AND    `flute` adds a constant to every ODD column's radius, so
      A RULE THAT
      COMES WITH
      THEM.
                     the outer surface is a ring of half-round tubes rather
                     than a smooth cone. That is what a regeneratively cooled
                     wall looks like from outside, it is the single most
                     recognisable feature of a real engine, and IT COSTS ZERO
                     TRIANGLES: the columns already existed. It also doubles
                     the number of distinct lit facets, exactly as
                     rock_form.ring_jit does.
                     THE RULE THAT COMES WITH IT: WHERE THE BELL IS THE
                     WIDEST SOLID ON THE PART, `seg` MUST BE DIVISIBLE BY 8.
                     `seg` divisible by 4 puts columns on +-X and +-Y, which
                     is what makes an exported AABB exactly the declared
                     diameter; but the flute lands on ODD columns, so the two
                     axis columns must also be even, and column seg/4 is even
                     only when seg is a multiple of 8. At seg 12 the vernier
                     measured 0.354 wide and 0.292 deep instead of 0.360 and
                     0.280, wrong in both directions at once, which looks like
                     a typo and is actually a parity argument.
      A SHORT INNER  the mouth is a mouth, but only for `sleeve` of the way up
      SLEEVE.        the first section. You cannot see further than that up a
                     nozzle, and the full inner cone bell_shell builds is a
                     second complete surface nobody will ever look at.

    Cost is 2 * seg * (rings + 1) triangles: the outer walls, one inner
    sleeve and the rim annulus that closes the wall thickness at the mouth.
    The throat end is deliberately OPEN and unrimmed, because a chamber always
    sits on it and a rim there would be two annuli on one plane, which is the
    defect this whole pass is about."""
    n = seg
    cx, cy = loc
    ring_v = []
    for z, r in profile:
        for i in range(n):
            a = 2.0 * math.pi * i / n
            rr = r + (flute if i % 2 else 0.0)
            ring_v.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z))
    z0, r0 = profile[0]
    z1, r1 = profile[1]
    t = min(1.0, max(0.05, sleeve))
    base = len(ring_v)
    for zz, rr in ((z0, r0 - wall), (z0 + (z1 - z0) * t, r1 * t + r0 * (1 - t)
                                     - wall)):
        for i in range(n):
            a = 2.0 * math.pi * i / n
            ring_v.append((cx + rr * math.cos(a), cy + rr * math.sin(a), zz))
    f, sm = [], []
    for k in range(len(profile) - 1):
        lo, hi = k * n, (k + 1) * n
        for i in range(n):
            j = (i + 1) % n
            f.append((lo + i, lo + j, hi + j, hi + i))
            sm.append(smooth and not flute)
    ib, it = base, base + n
    for i in range(n):
        j = (i + 1) % n
        f.append((ib + j, ib + i, it + i, it + j))       # inner, reversed
        sm.append(True)
        f.append((i, j, ib + j, ib + i))                 # exit rim, normal -Z
        sm.append(False)
    return p.add(ring_v, f, sm, role)


def truss(p, r_in, r_out, z0, z1, count, role, section=0.055, phase=0.0,
          clearance=None):
    """`count` splayed struts from a chamber shoulder out to a mount ring, each
    built along +Z and swung into place.

    The trick is engine_vacuum's, promoted here because every engine in the
    catalogue wants it: a strut authored at its final angle is a strut that
    cannot be moved, so it is built upright and rotated. What is new is that
    the struts are UNEVENLY PAIRED, at `phase` and at phase + a half pitch
    offset, because a real thrust structure carries the gimbal actuators on two
    of its bays and not on all of them."""
    dx, dz = r_out - r_in, z1 - z0
    length = math.hypot(dx, dz)
    tilt = math.degrees(math.atan2(dx, dz))
    for i in range(count):
        az = 360.0 * i / count + phase
        s = hc.Parts()
        slab(s, (section, section, length), (0.0, 0.0, length * 0.5), role)
        s.rotate("Y", tilt)
        s.translate(r_in, 0.0, z0)
        s.rotate("Z", az)
        if clearance is not None:
            lo, hi = s.bounds()
            reach = max(abs(lo[0]), abs(hi[0]), abs(lo[1]), abs(hi[1]))
            if reach > clearance:
                raise ValueError("truss strut %d reaches %.4f past %.4f"
                                 % (i, reach, clearance))
        p.extend(s)
    return p


def assert_class_envelope(name, pile, cls, height, tol=0.002):
    """The dimension contract, checked in the BUILD rather than by the
    validator afterwards.

    validate_glb.py measures the exported node and fails after Blender has
    run, which on this file is a two-minute round trip and a message that names
    a node rather than a fitting. This measures the pile the moment it is
    poured and refuses BY PART NAME with the offending extent printed, so a
    detail pass that widens a tank by 3 mm is caught by the line that widened
    it."""
    lo, hi = pile.bounds()
    d = CLASS[cls][0] * 2.0
    for k, axis in ((0, "x"), (1, "y")):
        span = hi[k] - lo[k]
        # BOTH directions. dims_xyz_m is an equality with a 5 mm tolerance, so
        # a part that came out NARROW is as wrong as one that came out wide,
        # and a detail pass that accidentally deleted a collar would otherwise
        # sail through the only check that would have caught it.
        if abs(span - d) > tol:
            raise ValueError("%s: %s spans %.4f, class %s declares %.4f"
                             % (name, axis, span, cls, d))
    if abs((hi[2] - lo[2]) - height) > tol:
        raise ValueError("%s: z spans %.4f, declared %.4f"
                         % (name, hi[2] - lo[2], height))
    if abs(lo[2]) > tol:
        raise ValueError("%s: bottom face at z %.4f, not on the origin"
                         % (name, lo[2]))
    return pile


# ---------------------------------------------------------------------------
# Stack parts
# ---------------------------------------------------------------------------

POD_H = 2.50
# The pod's hull cone, as (z0, r0) -> (z1, r1). Written once so _cone_r and
# the geometry cannot disagree, which they did in the first draft of RN-414 by
# 20 mm over half a metre of run.
#
# THE HULL IS NARROWER THAN THE SHIELD, and that is the fix the envelope gate
# forced. The first draft ran the cone from R and put a proud chine ring on the
# joint, which measured 1.2580 and failed dims_xyz_m by 8 mm: on a part whose
# widest solid is already AT the class radius there is no room for anything
# proud, anywhere. So the cone starts 15 mm inside it and the SHIELD RIM
# OVERHANGS THE HULL, which is what a real ablator ring does anyway.
POD_CONE = (0.16, 0.610, 1.95, 0.36)


def _cone_r(z):
    """The pod hull's radius at height z, so a fitting sits ON the hull."""
    z0, r0, z1, r1 = POD_CONE
    t = min(1.0, max(0.0, (z - z0) / (z1 - z0)))
    return r0 + (r1 - r0) * t


def command_pod():
    """1.25 x 1.25 x 2.50. A blunt re-entry cone with a docking ring on top.

    The cone is the whole read: nothing else in the game is conical, so a
    vessel with a pod on it is identifiable as crewed from any distance.

    RN-414, UNDER ART-DIRECTION.md. THIS IS THE PART REID LOOKS AT LONGEST,
    because it is the one with a person in it. What it was: five stacked
    frusta, one window, one hatch drawn as two flat boxes, and a heat shield
    that was a 180 mm can. What it is now, and every line of it is a thing a
    capsule has rather than a thing that reads well:

      AN ABLATOR THAT IS  three tile courses stepping up the shield's flank
      MADE OF COURSES     and a proud chine where the shield meets the hull.
                          A heat shield is the one surface on a vessel that is
                          CONSUMED, so it has to look like a different
                          material assembly from the hull above it.
      PANEL BREAKS        two circumferential seams on the cone and a
                          longitudinal joint strap, so the hull reads as
                          rolled and riveted rather than turned.
      A HATCH WITH        a raised sill, two hinges on one side and a latch
      HARDWARE            handle on the other. A door that is symmetric is a
                          panel; the hinges are what make it a door.
      TWO WINDOWS, NOT    the forward one it had, plus a smaller side port
      ONE, AND NOT        offset from the hatch. The pair is what breaks the
      OPPOSITE            solid of revolution: at any yaw you see either one
                          window, or two, or none.
      RCS PORTS           two clusters, on two of four possible bearings.
      AN ANTENNA AND AN   on the shoulder ring, on opposite sides, at
      UMBILICAL PANEL     different heights.
    """
    p = hc.Parts()
    # --- ablative heat shield ---------------------------------------------
    # ONE solid carries the z = 0 mating face. Everything else on the shield
    # is a capless course ring on its flank, because a second disc on z = 0
    # would be the defect this pass exists to remove.
    tube(p, R, 0.00, 0.18, "SteelDark")
    for z in (0.055, 0.105, 0.152):
        tube(p, 0.618, z - 0.014, z + 0.014, "Steel", smooth=False,
             caps="none")
    z0c, r0c, z1c, r1c = POD_CONE
    tube(p, r0c, z0c, z1c, "SteelLight", r_top=r1c, caps="hi")    # hull cone
    weld(p, _cone_r(0.215), 0.215, "SteelDark", proud=0.005, h=0.030)

    # --- hull panel breaks -------------------------------------------------
    # Every feature on the cone is placed by _cone_r, which is the cone's own
    # radius at that height. A fitting placed at a typed radius sinks into the
    # hull at one end and floats off it at the other, and on a 15-degree cone
    # that is 20 mm over half a metre of run.
    for z in (0.62, 1.62):
        weld(p, _cone_r(z), z, "Steel", proud=0.005, h=0.022)
    tube(p, 0.505, 0.98, 1.06, "Accent")                    # trim band
    # A longitudinal joint strap in three courses, on a bearing that is not
    # the hatch's and not a window's, so no two features share an azimuth.
    for z in (0.46, 0.94, 1.42):
        fitting(p, (0.030, 0.075, 0.44), _cone_r(z) + 0.011, 251.0, z,
                "Steel", R)

    tube(p, 0.38, 1.95, 2.06, "SteelDark")                  # shoulder ring
    tube(p, 0.34, 2.06, 2.34, "Steel")                      # neck
    tube(p, 0.30, 2.34, POD_H, "SteelDark", seg=12)         # docking ring
    stud_ring(p, (0.045, 0.045, 0.035), 0.335, 6, 2.0225, "Steel",
              clearance=R)

    # --- forward window: frame, glass proud of it, on -Y ------------------
    slab(p, (0.52, 0.08, 0.32), (0.0, -0.425, 1.35), "SteelDark")
    slab(p, (0.44, 0.10, 0.24), (0.0, -0.445, 1.35), "Glass")
    # --- side port, smaller, offset, and NOT opposite the forward one -----
    fitting(p, (0.075, 0.30, 0.26), _cone_r(1.52) + 0.026, 61.0, 1.52,
            "SteelDark", R)
    fitting(p, (0.085, 0.21, 0.17), _cone_r(1.52) + 0.037, 61.0, 1.52,
            "Glass", R)

    # --- crew hatch on +X, clear of the window ----------------------------
    # socket_hatch is published at (0.50, 0, 1.15), so this one feature cannot
    # move off the +X axis; it is instead built as a real door assembly.
    slab(p, (0.08, 0.42, 0.48), (0.462, 0.0, 1.15), "SteelDark")   # sill
    slab(p, (0.06, 0.35, 0.41), (0.497, 0.0, 1.15), "Steel")       # leaf
    # 0.5045 +- 0.0175 spans 0.487 to 0.522, INSIDE the leaf's 0.467 to 0.527.
    # The first draft had it at 0.492 +- 0.025, and 0.492 - 0.025 is 0.467,
    # which is 0.497 - 0.03 to the millimetre: two independently chosen
    # literals that happen to sum to the same face. There is nothing to see in
    # either number; the defect only exists in their difference.
    slab(p, (0.035, 0.30, 0.10), (0.5045, 0.0, 1.30), "Accent")    # placard
    for sz in (-1.0, 1.0):                                          # hinges
        slab(p, (0.055, 0.055, 0.075), (0.487, 0.213, 1.15 + sz * 0.145),
             "Steel")
    slab(p, (0.045, 0.10, 0.045), (0.503, -0.205, 1.10), "Steel")  # latch

    # --- RCS ports, two clusters, on two of the four possible bearings -----
    # Built on +X and swung round, so the nozzles point OUTWARD rather than
    # along a world axis. It also puts every face of the cluster off the world
    # axes, which is the cheap way to keep a box fitting out of check_coplanar
    # entirely: only its +-Z faces stay axis aligned and this one has none.
    for az, z in ((131.0, 1.66), (318.0, 1.28)):
        q = hc.Parts()
        rr = _cone_r(z)
        slab(q, (0.085, 0.135, 0.135), (rr + 0.030, 0.0, 0.0), "SteelDark")
        for sy in (-1.0, 1.0):
            v, f, sm = of.cyl_data(0.030, 0.05, (rr + 0.090, sy * 0.048, 0.0),
                                   axis="X", segments=6, radius_top=0.018)
            q.add(v, f, sm, "Steel")
        q.rotate("Z", az).translate(0.0, 0.0, z)
        p.extend(q)

    # --- antenna and umbilical panel, opposite bearings, different heights -
    fitting(p, (0.075, 0.075, 0.20), 0.372, 37.0, 2.14, "Steel", R)
    tube(p, 0.016, 2.24, 2.44, "SteelDark", seg=4, caps="none",
         loc=hull(0.372, 37.0, R))
    fitting(p, (0.055, 0.145, 0.12), 0.372, 214.0, 2.10, "Accent", R)
    return p


def fuel_tank(height, bands=1, cls="S"):
    """<class diameter> square x `height`. Barrel at the class barrel radius
    with collars at the class mating radius, so the mating diameter is carried
    by the RINGS and the barrel reads slightly waisted. That is also what keeps
    the bounding box exact when a stringer stands proud of the barrel.

    Class L is this form RE-DERIVED, not a scaled copy: the trim depth doubles
    with `class_scale`, but the stringer COUNT doubles independently (see
    STRINGERS) and the height is whatever the part is, so a 2.50 x 4.00 tank
    reads as a wide tank and not as a small tank filmed from closer up.

    RN-412, UNDER ART-DIRECTION.md. What this used to be was a barrel, two
    collars, an accent band and four identical stringers: six solids of
    revolution and a 4-fold ring, which is the same tank from every bearing
    and has nothing to look at from two metres away. What it is now:

      PLATE COURSES     the barrel is welded from rolled courses about 0.75 m
                        deep and every joint carries a bead. Two on the short
                        tank, four on the long one, so length is legible off
                        the tank itself rather than only by comparison.
      A BLANKET THAT    cryogenic insulation over the lower 42 percent, with a
      STOPS             hard step where it ends. It is the only horizontal
                        silhouette break on the part.
      PLUMBING ON ONE   a feed line down ONE side with a fairing boss at each
      SIDE              end, an instrumentation conduit on another bearing, a
                        hold-down lug on a third and a stencil plate on a
                        fourth. Four fittings, four azimuths, none of them a
                        multiple of the stringer pitch, so the tank presents a
                        different profile at every yaw the engine hands it."""
    r, seg, r_body = CLASS[cls]
    k = class_scale(cls)
    collar = 0.09 * k
    p = hc.Parts()

    # --- the pressure vessel ---------------------------------------------
    # The barrel is CAPLESS: both its discs are sealed inside the collars, and
    # a sealed disc on the collar's own plane is the 704-pair defect this pass
    # exists to remove. See the module docstring.
    tube(p, r_body, 0.00, height, "SteelLight", seg=seg, caps="none")
    tube(p, r, 0.00, collar, "SteelDark", seg=seg)
    tube(p, r, height - collar, height, "SteelDark", seg=seg)

    # --- plate courses ----------------------------------------------------
    # One bead per internal joint of a barrel rolled from ~0.75 m courses.
    courses = max(2, int(round((height - 2.0 * collar) / (0.75 * k))))
    z0, z1 = collar, height - collar
    # 10 mm proud and 34 mm deep, not 6 and 24. RN-436's `vessel_close` shot
    # is what decided that: at a standing player's distance a 6 mm bead on a
    # 1250 mm barrel is half a percent of the diameter and rendered as a hair
    # line that could equally have been a shading artefact. The pass had
    # already declared the courses its cheapest read per triangle, and they
    # were not reading. Neither number was measurable off any statistic.
    for i in range(1, courses):
        weld(p, r_body, z0 + (z1 - z0) * i / courses, "Steel", seg=seg,
             proud=0.010 * k, h=0.034 * k)

    # --- insulation blanket, and it STOPS ---------------------------------
    blanket(p, r_body, collar, collar + (height - 2.0 * collar) * 0.42,
            "SteelDark", seg=seg, proud=0.010 * k)

    for i in range(bands):
        z = height * (i + 1) / (bands + 1)
        tube(p, r - 0.010 * k, z - 0.05 * k, z + 0.05 * k, "Accent", seg=seg)

    # --- longerons --------------------------------------------------------
    # Stringers on the half-azimuth. At r_body they never reach +-X or +-Y, so
    # they cannot touch the AABB the collars define, and stud_ring now asserts
    # that rather than leaving it to a comment.
    n = STRINGERS[cls]
    stud_ring(p, (0.10 * k, 0.10 * k, height - 0.30 * k), r_body, n,
              height * 0.5, "Steel", phase=math.pi / n, clearance=r)

    # --- the four fittings, on four unrelated bearings ---------------------
    feed_line(p, r_body, AZ_FEED, collar + 0.10 * k, height - collar - 0.10 * k,
              "Steel", r, r_pipe=0.032 * k, boss_role="SteelDark")

    fitting(p, (0.075 * k, 0.045 * k, height - 0.44 * k),
            r_body + 0.022 * k, AZ_CONDUIT, height * 0.5, "SteelDark", r)
    for i in range(3):
        z = collar + (height - 2.0 * collar) * (i + 0.5) / 3.0
        fitting(p, (0.105 * k, 0.028 * k, 0.055 * k), r_body + 0.022 * k,
                AZ_CONDUIT, z, "Steel", r)

    fitting(p, (0.085 * k, 0.16 * k, 0.19 * k), r_body + 0.024 * k, AZ_LUG,
            collar + 0.16 * k, "Steel", r)
    fitting(p, (0.115 * k, 0.055 * k, 0.075 * k), r_body + 0.030 * k, AZ_LUG,
            collar + 0.28 * k, "SteelDark", r)

    fitting(p, (0.020 * k, 0.20 * k, 0.13 * k), r_body + 0.012 * k,
            AZ_PLACARD, height - collar - 0.20 * k, "Accent", r)
    return p


ENGINE_H = 1.60


def engine_main():
    """1.25 x 1.25 x 1.60. Bell exit at z = 0, which is where socket_muzzle
    sits and where vfx_engine_plume.glb attaches with an identity transform.

    RN-413, UNDER ART-DIRECTION.md, AND THIS IS THE HERO PART OF THE FILE.
    A player looks at an engine more closely than at anything else he builds,
    because choosing one is the decision the catalogue exists for. What was
    here was a stack of six coaxial frusta, a box for a turbopump and one rod:
    an engine-shaped object with no plumbing on it, and a nozzle that was two
    straight cones with a kink where they met.

    What it is now is an engine read off what an engine actually has, and
    every item on the list is load-bearing for the read:

      A FLUTED BELL      a curve through five rings rather than a kink through
                         two, with the cooling-channel flutes on the outer
                         wall. Free: the columns already existed.
      A REAL THROAT      chamber, injector dome and throat as three different
      STACK              diameters, so the narrowest point of the engine is
                         visible as the narrowest point.
      A TRUSS            six splayed struts where there was a plain cylinder.
                         You can see through a thrust structure.
      A TURBOPUMP THAT   pump body, volute, hot-gas line to the injector and a
      IS PLUMBED         turbine exhaust duct running back down the bell. One
                         side of the engine only, which is what makes the part
                         asymmetric at every yaw.
      TWO GIMBAL         on two bays of six, not on all of them, because an
      ACTUATORS          engine gimbals in two axes and a ring of six
                         identical actuators is a decoration rather than a
                         mechanism."""
    p = hc.Parts()
    # --- nozzle -----------------------------------------------------------
    bell(p, [(0.00, 0.552), (0.21, 0.474), (0.46, 0.372), (0.72, 0.256),
             (0.95, 0.190)], "SteelDark", seg=SEG, wall=0.028, flute=0.013)
    tube(p, 0.566, 0.05, 0.10, "Steel", seg=SEG, smooth=False, caps="none")

    # --- chamber ----------------------------------------------------------
    # Each of these three suppresses the cap that the next one buries. They
    # are the same-radius stack the tanks' collars were, and left capped they
    # would be the same defect at a smaller diameter.
    tube(p, 0.196, 0.95, 1.07, "Steel", seg=12, caps="lo")   # throat
    tube(p, 0.262, 1.07, 1.32, "SteelDark", seg=12, caps="lo")  # chamber
    tube(p, 0.262, 1.32, 1.40, "Steel", r_top=0.300, seg=12,
         caps="hi")                                          # injector dome
    weld(p, 0.262, 1.19, "Steel", seg=12, proud=0.007, h=0.020)

    # --- thrust structure -------------------------------------------------
    tube(p, R, 1.50, ENGINE_H, "SteelDark")                 # mount plate
    truss(p, 0.300, 0.505, 1.38, 1.50, 6, "Steel", section=0.052, phase=15.0,
          clearance=R)
    truss(p, 0.286, 0.470, 1.06, 1.49, 2, "SteelDark", section=0.062,
          phase=97.0, clearance=R)                          # gimbal actuators
    stud_ring(p, (0.07, 0.07, 0.05), 0.54, 8, 1.545, "Hazard", clearance=R)

    # --- turbopump and its plumbing, all on one side ----------------------
    px, py = hull(0.352, 20.0, R)
    tube(p, 0.132, 1.09, 1.41, "Steel", seg=8, smooth=True, loc=(px, py))
    fitting(p, (0.24, 0.17, 0.13), 0.352, 20.0, 1.44, "SteelDark", R)
    vx, vy = hull(0.300, 44.0, R)
    tube(p, 0.058, 0.98, 1.12, "SteelDark", seg=6, caps="none", loc=(vx, vy))
    hx, hy = hull(0.318, -6.0, R)
    tube(p, 0.042, 1.16, 1.38, "Steel", seg=6, caps="none", loc=(hx, hy))
    fitting(p, (0.10, 0.07, 0.06), 0.318, -6.0, 1.13, "SteelDark", R)
    # Two propellant feeds down from the mount plate, different diameters
    # because oxidiser and fuel are not the same flow.
    for az, rp, r_at in ((146.0, 0.050, 0.400), (196.0, 0.036, 0.372)):
        fx, fy = hull(r_at, az, R - rp)
        tube(p, rp, 1.30, 1.51, "SteelDark", seg=6, caps="none",
             loc=(fx, fy))
        fitting(p, (0.11, 0.08, 0.055), r_at, az, 1.28, "Steel", R)
    return p


ENGINE_V_H = 1.00


def engine_vacuum():
    """1.25 x 1.25 x 1.00. The class S vacuum engine, and the upper stage's.

    IT EXISTS TO BE TOLD APART FROM engine_main, because choosing between them
    is the decision the part list is for, and physics measured the difference
    at about 970 m/s on the reference vessel's upper stage. So every line of it
    is the sea-level engine's opposite, and the contrast is carried by
    SILHOUETTE rather than by trim:

      SHORT AND WIDE     1.00 m tall against 1.60, with the bell opening to
                         R 0.615 against 0.58. That is as wide as class S
                         allows, and it is also the real-world contrast: an
                         expansion ratio you can only use where there is no
                         atmosphere to push back.
      THIN WALLED        a real shell rather than a capped tube (see
                         bell_shell), so the mouth is a mouth.
      NOTHING TO HIDE    the sea-level engine shrouds its thrust structure
                         behind a mount plate and a turbopump box. This one
                         never flies through air, so its neck, chamber and
                         four struts are simply out in the open, and the gaps
                         between them are as much of the read as the parts.

    Only the top 80 mm is solid across the full 1.25 m, because that is the
    mating face and a tank has to bolt to something.

    RN-415: the bell is now a `bell` rather than a `bell_shell`, so the
    expansion curve is a curve and the cooling channels are on it. Everything
    else about the part is preserved deliberately, because the open thrust
    structure is what tells it apart from engine_main and that read was already
    correct."""
    p = hc.Parts()
    bell(p, [(0.00, 0.612), (0.17, 0.520), (0.36, 0.396), (0.52, 0.268),
             (0.62, 0.180)], "SteelDark", seg=SEG, wall=0.026, flute=0.011)
    tube(p, 0.415, 0.29, 0.33, "Steel", caps="none")    # stiffener hoop
    tube(p, 0.16, 0.62, 0.78, "SteelDark", caps="hi")   # throat
    tube(p, 0.24, 0.78, 0.88, "Steel")                  # chamber / injector
    tube(p, 0.255, 0.80, 0.84, "Accent")                # band
    tube(p, R, 0.92, ENGINE_V_H, "SteelDark")           # mount ring
    # Four open struts, chamber shoulder out to the mount ring underside. Built
    # once along +Z and swung into place, the same trick the landing leg's foot
    # pad uses, because a strut authored at its final angle is a strut that
    # cannot be moved. `truss` is that trick, extracted.
    truss(p, 0.250, 0.535, 0.83, 0.94, 4, "Steel", section=0.055, phase=0.0,
          clearance=R)
    # Two more, shorter and on the half-pitch, carrying the gimbal actuators.
    truss(p, 0.238, 0.430, 0.86, 0.93, 2, "SteelDark", section=0.048,
          phase=45.0, clearance=R)
    for az, rp in ((118.0, 0.036), (243.0, 0.028)):     # propellant feeds
        fx, fy = hull(0.300, az, R - rp)
        tube(p, rp, 0.84, 0.94, "Steel", seg=6, caps="none", loc=(fx, fy))
        fitting(p, (0.085, 0.062, 0.05), 0.300, az, 0.815, "SteelDark", R)
    return p


DECOUPLER_H = 0.25            # class S
DECOUPLER_L_H = 0.35          # class L: wider, but a joint, so barely taller


def decoupler(cls="S"):
    """<class diameter> square x 0.25 (S) or 0.35 (L). The one part whose job
    is to stop existing, so it is the one part banded in hazard yellow.

    Every proportion is a FRACTION OF ITS OWN HEIGHT rather than a literal, so
    the two classes are the same part at two sizes and not two drawings that
    happen to look alike: collars are 0.24 h, the hazard band spans 0.36 h to
    0.64 h, and the separation bolts are 0.36 h tall on the mid plane.

    RN-416, UNDER ART-DIRECTION.md: IT NOW LOOKS LIKE SEPARATION HARDWARE.
    What it was is a short can with a yellow stripe round it, which says
    "important" and does not say what it does. What separation hardware
    actually has, and now does:

      A PARTING LINE     a recessed groove ALL THE WAY ROUND on the mid plane.
                         This is the joint that fires. It is one capless ring
                         at a smaller radius than the barrel, so it reads as a
                         shadow rather than as a painted band, and it is the
                         single most legible thing on the part.
      A DETONATION CORD  a raised conduit running the circumference just above
      RACEWAY            the parting line, with a firing head at ONE azimuth.
      PUSHER SPRINGS     four (six on class L) blocks straddling the line,
                         which is what pushes the stages apart.
      AN INITIATOR BOX   one, on one bearing, with its own cable running to
                         the raceway. There is exactly one of these on a real
                         decoupler and putting a ring of them round the part
                         would be the same mistake as a ring of gimbals."""
    r, seg, r_body = CLASS[cls]
    k = class_scale(cls)
    h = DECOUPLER_H if cls == "S" else DECOUPLER_L_H
    n_push = 4 if cls == "S" else 6
    p = hc.Parts()
    # Capless: both discs are sealed inside the collars, and both were a
    # 34-pair (class S) / 55-pair (class L) same-facing overlap on the mating
    # planes. See the module docstring.
    tube(p, r_body, 0.00, h, "SteelDark", seg=seg, caps="none")
    tube(p, r, 0.00, h * 0.24, "Steel", seg=seg)
    tube(p, r, h - h * 0.24, h, "Steel", seg=seg)
    tube(p, r - 0.005 * k, h * 0.36, h * 0.64, "Hazard", seg=seg)
    # The parting line: recessed INSIDE the barrel, so it is a groove.
    tube(p, r_body - 0.022 * k, h * 0.47, h * 0.53, "SteelDark", seg=seg,
         smooth=False, caps="none")
    # The det-cord raceway, just above it.
    tube(p, r - 0.002 * k, h * 0.60, h * 0.665, "Steel", seg=seg,
         smooth=False, caps="none")
    stud_ring(p, (0.08 * k, 0.08 * k, h * 0.36), r - 0.045 * k,
              DECOUPLER_BOLTS[cls], h * 0.5, "SteelDark", clearance=r)
    stud_ring(p, (0.09 * k, 0.10 * k, h * 0.78), r_body - 0.055 * k, n_push,
              h * 0.5, "Steel", phase=math.pi / n_push, clearance=r)
    fitting(p, (0.09 * k, 0.15 * k, h * 0.62), r_body + 0.012 * k, AZ_FEED,
            h * 0.5, "Steel", r)
    fitting(p, (0.05 * k, 0.07 * k, h * 0.30), r_body + 0.026 * k,
            AZ_FEED + 9.0, h * 0.63, "SteelDark", r)
    return p


NOSE_H = 1.20


def nose_cone():
    """1.25 x 1.25 x 1.20 ogive. Four frustum sections, because a single cone
    reads as a party hat and an ogive reads as a rocket.

    RN-417. The four sections were already the right idea and stayed; what
    changed is that the JOINTS BETWEEN THEM ARE NOW VISIBLE. An ogive built
    from four frusta has three kinks in its profile that read as faceting, i.e.
    as a modelling artefact. Put a station ring on each one and the same three
    kinks read as fairing stations, which is what they are on a real fairing.
    Free, near enough: the rings replace eight buried end caps that were
    costing 112 triangles between them and could never be seen.

    A nose cone also gets the one thing this catalogue had nowhere: a TIP.
    The old apex was a 55 mm disc floating in space at the top of a frustum."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.08, "SteelDark", caps="lo")
    rings = ((0.08, 0.625), (0.40, 0.560), (0.75, 0.430),
             (1.02, 0.250), (NOSE_H, 0.055))
    last = len(rings) - 2
    for i, ((z0, r0), (z1, r1)) in enumerate(zip(rings, rings[1:])):
        tube(p, r0, z0, z1, "SteelLight", r_top=r1,
             caps="hi" if i == last else "none")
    for z, r in rings[1:-1]:
        weld(p, r, z, "Steel", proud=0.006, h=0.026)
    tube(p, 0.60, 0.30, 0.36, "Accent")
    tube(p, 0.082, 1.120, 1.178, "SteelDark", seg=8, caps="none")   # tip cuff
    stud_ring(p, (0.055, 0.055, 0.030), 0.575, 6, 0.098, "Steel",
              clearance=R)
    # An access hatch and two static ports, none of them sharing a bearing.
    fitting(p, (0.030, 0.19, 0.24), 0.549, 71.0, 0.58, "SteelDark", R)
    for az, z in ((196.0, 0.86), (263.0, 0.52)):
        rr = 0.430 + (0.560 - 0.430) * max(0.0, (0.75 - z) / 0.35)
        fitting(p, (0.036, 0.06, 0.06), min(rr, 0.58) + 0.014, az, z,
                "Steel", R)
    return p


CHUTE_H = 0.75


def parachute():
    """1.25 x 1.25 x 0.75 canister. The canopy itself is not authored: a
    deployed parachute is cloth, and cloth is a shader-and-simulation problem
    that does not belong in a static .glb. socket_chute is where it spawns.

    RN-418: it is a MORTAR now rather than a can. The lid is a separate
    pyrotechnic cover with its own clamp band and a lanyard eye; the four
    straps got shoes at both ends; and the riser attachment lugs are on TWO
    bearings rather than four, because a canopy hangs off risers and risers
    are not a decoration ring."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.06, "SteelDark")                     # mounting flange
    tube(p, 0.42, 0.06, 0.66, "Steel", caps="hi")           # canister
    tube(p, 0.44, 0.66, CHUTE_H, "SteelDark")               # lid
    tube(p, 0.452, 0.655, 0.685, "Steel", smooth=False,
         caps="none")                                       # clamp band
    tube(p, 0.43, 0.28, 0.36, "Hazard")                     # band
    stud_ring(p, (0.06, 0.06, 0.58), 0.44, 4, 0.36, "SteelDark",
              phase=math.pi * 0.25, clearance=R)
    stud_ring(p, (0.10, 0.075, 0.045), 0.435, 4, 0.098, "Steel",
              phase=math.pi * 0.25, clearance=R)            # strap shoes
    for az in (54.0, 226.0):                                # riser lugs
        fitting(p, (0.055, 0.10, 0.09), 0.452, az, 0.585, "Steel", R)
    fitting(p, (0.05, 0.075, 0.055), 0.30, 118.0, CHUTE_H - 0.028,
            "Accent", R)                                    # lanyard eye
    return p


BAY_H = 1.60


def cargo_bay():
    """1.25 x 1.25 x 1.60. Doors are modelled shut with a deep seam: a cargo
    bay that reads as openable without carrying a clip nobody has asked the
    sim for yet.

    RN-419: the seam is now a door ASSEMBLY. Two leaves, four latches down the
    seam on one side and three hinge knuckles on the rod on the other, plus
    corner reinforcement gussets and a hazard chevron that stops short of the
    leaf edge. A bay that reads as openable needs the hardware that would open
    it; two flat plates with a gap between them read as a decal."""
    p = hc.Parts()
    # Capless: both discs are sealed inside the collars (68 same-facing pairs).
    tube(p, R_BODY, 0.00, BAY_H, "SteelLight", caps="none")
    tube(p, R, 0.00, 0.10, "SteelDark")
    tube(p, R, BAY_H - 0.10, BAY_H, "SteelDark")
    for sy in (-1.0, 1.0):
        slab(p, (0.90, 0.04, 1.24), (0.0, sy * 0.598, 0.80), "SteelDark")
        slab(p, (0.86, 0.03, 0.05), (0.0, sy * 0.606, 0.80), "Hazard")
        for sx in (-1.0, 1.0):                              # corner gussets
            for sz in (-1.0, 1.0):
                slab(p, (0.13, 0.055, 0.09),
                     (sx * 0.365, sy * 0.586, 0.80 + sz * 0.545), "Steel")
    # Hinge rods at 0.570: an 8-gon of radius 0.05 reaches exactly 0.05 along
    # +-X, so a rod centred at 0.585 pushed the bounding box out to 1.27 and
    # broke the one dimension the whole stack contract rests on.
    for sx in (-1.0, 1.0):                                  # hinge rods
        tube(p, 0.05, 0.16, BAY_H - 0.16, "Steel", seg=8, loc=(sx * 0.570, 0.0))
        # Knuckles are SLABS and not rings, for the same reason the rod is at
        # 0.570 and not 0.585: an 8-gon reaches its full radius on +-X, so a
        # 0.072 ring on the rod measures 1.284 across and breaks the class. A
        # slab is 0.10 wide in x and 0.16 in y, which is the shape a hinge
        # knuckle is anyway.
        for z in (0.33, 0.80, 1.27):                        # hinge knuckles
            slab(p, (0.10, 0.16, 0.11), (sx * 0.570, 0.0, z), "SteelDark")
    for sy in (-1.0, 1.0):                                  # seam latches
        for z in (0.30, 0.63, 0.97, 1.30):
            # 0.5975 +- 0.0245 spans 0.573 to 0.622: 5 mm clear of the leaf's
            # inner face, 4 mm proud of its outer one and 3 mm inside the
            # class. On a part where the door skin is already 7 mm from the
            # bounding box, every fitting is a three-sided fit and none of the
            # three sides may be equal to a neighbour.
            slab(p, (0.075, 0.049, 0.085), (0.40, sy * 0.5975, z), "Steel")
    return p


BOOSTER_H = 6.00


def solid_booster():
    """1.25 x 1.25 x 6.00. A strap-on solid rocket booster.

    THE SILHOUETTE IS THE SPEC: one long plain casing with a nose taper, and
    NO PLUMBING. That is not laziness, it is what a solid is. It cannot be
    throttled, shut down or restarted, so it has no turbopump, no feed lines
    and no gimbal ring, and putting any of that on it would make it read as
    just another liquid engine at the exact distance where the read matters.

    The nozzle lives inside an aft boat-tail skirt so the bell exit sits ON
    z = 0 rather than hanging below it: the part is carried radially, and a
    bell poking out of the declared envelope is a bell that intersects
    whatever the booster is strapped to. The skirt is a FRUSTUM rather than a
    can so the nozzle inside it is visible through the mouth instead of being
    44 triangles nobody will ever see.

    It terminates a stack downward exactly as an engine does, so it carries no
    socket_stack_bottom; what it carries instead is socket_radial_attach, on
    its own hull, which is the part that makes it strap-on.

    RN-420, AND THE NO-PLUMBING RULE SURVIVES INTACT. Everything added here is
    something a SOLID has and a liquid engine does not, which is why the
    silhouette argument above is strengthened rather than weakened:

      FIELD JOINTS       a solid is cast in segments and bolted together in
                         the field, so it has three heavy circumferential
                         joint bands up its 4.85 m casing. This is the single
                         most recognisable feature of a real strap-on solid
                         and the catalogue had none of it.
      A CABLE RACEWAY    one conduit running the whole casing on ONE bearing,
                         with clamps. A 6 m cylinder is the longest surface in
                         the file and it was completely bare.
      A REAL NOZZLE      `bell` in the boat-tail rather than a capped cone,
                         and it is visible through the skirt mouth, which is
                         the reason the skirt is a frustum in the first place.
      SEPARATION MOTORS  four small ones in the nose taper and four in the aft
                         skirt, which is how a strap-on actually gets pushed
                         clear. They are what the nose taper is FOR."""
    p = hc.Parts()
    tube(p, 0.520, 0.04, 0.55, "SteelDark", r_top=R)        # aft skirt
    bell(p, [(0.00, 0.435), (0.16, 0.360), (0.34, 0.248), (0.52, 0.158)],
         "SteelDark", seg=12, wall=0.022, flute=0.010)      # nozzle
    # Capless: both discs are sealed inside the collars (68 same-facing pairs,
    # at z = 0.55 and z = 5.40).
    tube(p, R_BODY, 0.55, 5.40, "SteelLight", caps="none")  # casing
    tube(p, R, 0.55, 0.64, "SteelDark")                     # aft collar
    tube(p, R, 5.31, 5.40, "SteelDark")                     # forward collar
    tube(p, R_BODY, 5.40, BOOSTER_H, "SteelLight", r_top=0.30, caps="hi")
    tube(p, 0.615, 0.95, 1.13, "Hazard")                    # jettison band
    # --- field joints -----------------------------------------------------
    for z in (1.75, 3.02, 4.29):
        tube(p, 0.612, z - 0.055, z + 0.055, "SteelDark", smooth=False,
             caps="none")
        # 0.607 + half of 0.026 is 0.620, five millimetres inside the class.
        # The bolt heads have to stand proud of a band that is itself already
        # 12 mm proud of the barrel, on a part whose collars are AT the
        # bounding box: this is the tightest three-way fit in the file.
        stud_ring(p, (0.026, 0.026, 0.15), 0.607, 6, z, "Steel",
                  phase=math.pi / 6.0, clearance=R)
    # --- cable raceway, one bearing, the whole length ---------------------
    for z in (1.20, 2.35, 3.60, 4.75):
        fitting(p, (0.085, 0.055, 0.075), R_BODY + 0.017, AZ_CONDUIT, z,
                "Steel", R)
    # z centre 3.05 and not 3.00: 3.00 - 4.10/2 is exactly 0.95, which is the
    # jettison band's own bottom face. Two numbers chosen 4 m apart for
    # unrelated reasons, landing on one plane.
    fitting(p, (0.058, 0.038, 4.10), R_BODY + 0.017, AZ_CONDUIT, 3.05,
            "SteelDark", R)
    # --- separation motors, nose and aft ----------------------------------
    for az in (41.0, 131.0, 221.0, 311.0):
        for z, rr in ((5.62, 0.435), (0.78, 0.575)):
            fitting(p, (0.075, 0.075, 0.22), rr, az, z, "SteelDark", R)
    # Attach saddles on -X, straddling socket_radial_attach at half height.
    # 0.590 + 0.030 = 0.620 keeps them inside the collars' 0.625: a lug that
    # touched the bounding box would widen the part past its class.
    for z in (2.60, 3.40):
        slab(p, (0.06, 0.26, 0.18), (-0.590, 0.0, z), "Steel")
    return p


MONO_H = 1.00


def monoprop_tank():
    """1.25 x 1.25 x 1.00. Monopropellant for the RCS blocks.

    Deliberately NOT a short liquid tank. A liquid tank is a straight barrel
    with a narrow accent band and four stringers; this is a squat pressure
    sphere with narrow mating flanges and one WIDE accent belt at the equator,
    so the two are different parts at a glance and not the same part at two
    lengths. The belt is also what carries the 1.25 m mating diameter, exactly
    as a tank's collars do, so the bowls can stay inside it.

    The flanges are 16-gon like the bowls they meet, NOT the cheaper 12 a
    0.36 m neck would otherwise deserve. Two tubes of the same radius and
    different segment counts do not share a surface: a 12-gon and a 16-gon at
    0.36 have inradii 0.3477 and 0.3531, so they interleave and the joint
    renders as a 5 mm scallop. Same rule the stack adapter learned the hard
    way, and the 32 triangles it costs are the price of a clean joint.

    RN-423 adds what a pressure vessel carries and a fuel tank does not: two
    HOOP STRAPS holding the bowls to the belt, a helium pressurant bottle
    clamped to one side, a fill-and-drain valve on another and a level probe
    on a third. The bowls' four buried end caps go, which pays for the straps
    outright."""
    p = hc.Parts()
    tube(p, 0.36, 0.00, 0.08, "SteelDark", caps="lo")       # bottom flange
    tube(p, 0.36, 0.08, 0.44, "SteelLight", r_top=0.605,
         caps="none")                                       # lower bowl
    tube(p, R, 0.44, 0.56, "Accent")                        # equator belt
    tube(p, 0.605, 0.56, 0.92, "SteelLight", r_top=0.36,
         caps="none")                                       # upper bowl
    tube(p, 0.36, 0.92, MONO_H, "SteelDark", caps="hi")     # top flange
    for z, rr in ((0.28, 0.522), (0.72, 0.522)):            # hoop straps
        tube(p, rr, z - 0.026, z + 0.026, "SteelDark", smooth=False,
             caps="none")
    # A helium bottle on one bearing, its feed on another, a fill valve on a
    # third and a level probe on a fourth.
    bx, by = hull(0.545, 249.0, R - 0.075)
    tube(p, 0.072, 0.30, 0.70, "Steel", seg=8, loc=(bx, by))
    for z in (0.34, 0.66):
        fitting(p, (0.055, 0.13, 0.045), 0.545, 249.0, z, "SteelDark", R)
    fitting(p, (0.075, 0.09, 0.075), 0.560, 158.0, 0.66, "Steel", R)
    slab(p, (0.10, 0.10, 0.06), (0.22, 0.0, 0.96), "Steel")  # fill port
    tube(p, 0.020, 0.62, 0.95, "SteelDark", seg=4, caps="none",
         loc=hull(0.480, 62.0, R))                           # level probe
    return p


WHEEL_H = 0.40


def reaction_wheel():
    """1.25 x 1.25 x 0.40. Torque with no propellant.

    A thin ring: two mating collars at the full class radius with a deep waist
    between them, which is a profile nothing else in the catalogue has. The
    three gyro bosses sit IN that waist, standing proud of the 0.46 drum and
    still 15 mm clear of the 0.625 bounding box, so the groove reads as a
    groove from the side and the bosses say "this thing spins" from above.

    RN-424: THREE gyros, and now they are three DIFFERENT gyros. A reaction
    wheel assembly carries one wheel per axis and they are mounted on three
    orthogonal bearings, so a ring of three identical bosses at 120 degrees is
    the one arrangement a real unit cannot have. Each boss now gets its own
    bearing cap and its own cable gland, at its own height, and the avionics
    box sits between two of them."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.06, "SteelDark")                     # bottom collar
    tube(p, R, 0.34, WHEEL_H, "SteelDark")                  # top collar
    tube(p, 0.46, 0.06, 0.34, "Steel", caps="none")         # rotor housing
    tube(p, 0.50, 0.16, 0.24, "Accent")                     # band
    stud_ring(p, (0.18, 0.18, 0.26), 0.52, 3, 0.20, "SteelDark", clearance=R)
    for i, (dz, dr) in enumerate(((0.045, 0.560), (-0.038, 0.548),
                                  (0.012, 0.566))):
        az = 120.0 * i
        fitting(p, (0.055, 0.10, 0.075), dr, az, 0.20 + dz, "Steel", R)
        fitting(p, (0.035, 0.045, 0.040), dr - 0.012, az + 17.0,
                0.20 - dz, "SteelDark", R)
    fitting(p, (0.075, 0.17, 0.15), 0.505, 61.0, 0.20, "SteelDark", R)
    return p


BATTERY_H = 0.60


def battery():
    """1.25 x 1.25 x 0.60. Stored charge for the night side.

    A ribbed drum: eight cell blocks around a narrow core, which is the one
    silhouette in the catalogue built out of repetition rather than out of
    revolution. Banded in SuitAccent blue rather than Accent orange, because
    the solar panel's cells are already SuitAccent and colour-blocking the
    electrical parts together is free legibility. Orange stays what it is
    everywhere else in the game: the trim colour, not a system.

    RN-425: the eight cells get END CAPS and INTERCONNECTS, which is what
    turns eight identical blocks into a battery. One of the eight bays is a
    TERMINAL BOX instead of a cell, with the bus running out of it, because a
    battery has a positive end and a ring of eight identical cells does not."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.07, "SteelDark")                     # bottom collar
    tube(p, R, 0.53, BATTERY_H, "SteelDark")                # top collar
    tube(p, 0.44, 0.07, 0.53, "Steel", caps="none")         # core
    stud_ring(p, (0.16, 0.16, 0.40), 0.52, 8, 0.30, "SteelDark",
              phase=math.pi * 0.125, clearance=R)
    stud_ring(p, (0.135, 0.135, 0.045), 0.52, 8, 0.485, "Steel",
              phase=math.pi * 0.125, clearance=R)           # cell end caps
    stud_ring(p, (0.135, 0.135, 0.045), 0.52, 8, 0.115, "Steel",
              phase=math.pi * 0.125, clearance=R)
    tube(p, 0.50, 0.27, 0.33, "SuitAccent")                 # charge stripe
    # One bay is the terminal box, and the bus bar leaves it.
    fitting(p, (0.11, 0.20, 0.19), 0.505, 22.5, 0.30, "Steel", R)
    fitting(p, (0.045, 0.055, 0.10), 0.545, 22.5, 0.415, "SuitAccent", R)
    tube(p, 0.024, 0.13, 0.47, "SuitAccent", seg=4, caps="none",
         loc=hull(0.548, 40.0, R))
    return p


DOCK_H = 0.30

# THE TWO NUMBERS THE CATALOGUE ALREADY PUBLISHES, and the whole reason this
# part was re-authored. `core/include/of/vessel.h` carries, for parts::
# DockingPort, `dockCaptureRadiusM = 0.60` and `dockCaptureConeRad = 30 deg`.
# They are the gameplay contract: a port captures another port whose axis lands
# within 0.60 m laterally and within 30 degrees angularly.
#
# UNTIL THIS PASS NO GEOMETRY ANYWHERE EXPRESSED EITHER OF THEM. The shipped
# mesh's widest guide feature sat at r 0.478 and its lead-in had no angle at
# all, so the picture and the rule were unrelated objects that happened to
# share a name, and every gate in the project passed on that: validate_glb
# measures the 1.25 m class box, check_coplanar measures paint, and neither has
# any opinion about whether a capture radius is anywhere in the file.
#
# So they are mirrored here as the DRIVING dimensions rather than as prose:
# `petal()` takes them, the petal tip circle IS the capture radius, the petal's
# inner face IS the capture cone, and `_assert_capture_geometry` below refuses
# to build a port whose geometry cannot honour them inside the class box. The
# direction of the dependency matters: the catalogue is the authority and the
# mesh conforms, which is why the numbers are copied with the file and line
# they are copied FROM. If they ever move, this raises rather than drifts.
DOCK_CAPTURE_R = 0.600          # vessel.h dockCaptureRadiusM
DOCK_CONE_DEG = 30.0            # vessel.h dockCaptureConeRad, in degrees

# THE ROLL DATUM, and it is a machine-readable interface and not decoration.
# A docking port is a body of revolution, so position and axis do not pin its
# orientation: something has to say which way is UP across the joint, or two
# mated hulls have a free rotation between them and nothing can be aligned
# across the seam (a hatch, a handrail, a solar wing, a label).
#
# The datum is azimuth 0 in this part's own frame, which after export is the
# socket node's LOCAL +X. Two features mark it and they are the only two
# things on the part at that bearing: a full-height Accent stripe down the
# barrel (readable from any approach bearing, at range) and an Accent bar on
# the seal land (readable through the mouth, at contact). A datum a pilot
# cannot see is a datum only the code believes in.
DOCK_INDEX_AZ = 0.0

# Every other bearing on the part, in one table, because RN-426's rule is that
# nothing shares an azimuth with anything else and a rule like that is only
# keepable if the azimuths are in one place where they can be read at a glance.
DOCK_AZ_LATCH = (27.0, 147.0, 267.0)     # the three capture latches
# THE PETAL BEARINGS ARE CONSTRAINED, not chosen, and the constraint is the
# class box rather than taste. A petal tip is a WIDE feature at very nearly the
# class mating radius, so near an axis its tangential half-width adds to the
# same coordinate its radius does: at azimuth 183 a tip at r 0.618 with a
# 0.115 half-width reaches 0.628 on x and widens the part past 1.25 m. `petal`
# raised exactly that, by name, on the first build of this pass.
#
# With three petals at a 120 degree pitch the offsets from the nearest axis
# repeat every 30 degrees, so the best achievable worst-case offset is 15
# degrees, and 45 / 165 / 285 is one of the bearings that achieves it. The tip
# width and plate thickness below are then sized against that 15 degrees with
# margin, WITH the skew counted, because a skew moves a tip toward an axis.
DOCK_AZ_PETAL = (45.0, 165.0, 285.0)     # the three guide petals
DOCK_PETAL_T = 0.016                     # plate thickness, radial
DOCK_PETAL_W = (0.062, 0.090)            # half width at the root, at the tip
DOCK_PETAL_SKEW = (0.0, 1.6, -1.7)       # thirty dockings of side loading
DOCK_PETAL_Z0 = 0.158                    # root height; see docking_port
DOCK_AZ_UMBILICAL = 206.0                # power and data across the joint
DOCK_AZ_PLACARD = 322.0                  # the one flat spot on a round part
DOCK_AZ_HANDRAIL = 88.0                  # EVA hand hold


def _assert_capture_geometry(r_tip, cone_deg, thickness, half_w_tip):
    """Refuse a port whose published capture numbers do not fit its class box.

    This is the check that makes the two constants above load-bearing instead
    of ornamental. A petal tip at r_tip plus its plate thickness must stay
    inside the 0.625 class mating radius, or the part silently widens past
    1.25 m and `assert_class_envelope` fails much later with a message about a
    span rather than about a capture radius.

    It also states the one relationship a reader would otherwise have to
    derive: the cone is measured FROM THE STACK AXIS, so a bigger angle makes
    the funnel shallower, not deeper."""
    reach = r_tip + thickness
    if reach > R:
        raise ValueError(
            "docking port: capture radius %.3f plus a %.3f petal reaches "
            "%.4f, past the %.4f class mating radius. Either the catalogue's "
            "dockCaptureRadiusM is wrong for a class S part or the petal is "
            "too thick." % (r_tip, thickness, reach, R))
    if not 0.0 < cone_deg < 90.0:
        raise ValueError("docking port: capture cone %.1f deg is not an angle "
                         "from the stack axis" % cone_deg)
    # A tip half-width wide enough to overlap its neighbour is a closed ring
    # with three seams in it, not three petals, and it reads as a mistake.
    pitch = 360.0 / len(DOCK_AZ_PETAL)
    span = math.degrees(math.atan2(half_w_tip, r_tip)) * 2.0
    if span >= pitch:
        raise ValueError("docking port: a petal spans %.1f deg at its tip, "
                         "which meets its neighbour at a %.1f deg pitch"
                         % (span, pitch))


def docking_port():
    """1.25 x 1.25 x 0.30. The androgynous mating interface.

    Its top face IS a mating plane, so socket_dock and socket_stack_top are
    co-located: docking is stacking that happened in orbit, and the engine
    should not need two rules for it.

    RN-851 RE-AUTHORS THIS PART, and the reason is not that the old one was
    ugly. It is that this is the only part in the catalogue whose GAMEPLAY
    NUMBERS live in `vessel.h` as a capture radius and a capture cone, and the
    old mesh expressed neither. A docking port whose geometry has no
    relationship to its own capture volume is a picture of a docking port. See
    DOCK_CAPTURE_R above for the full argument; the short form is that the
    petal tips now sweep exactly the published 0.60 m circle and their inner
    faces are exactly the published 30 degree cone.

    WHAT IT LOOKS LIKE, and this half is `docs/web/ART-DIRECTION.md` rather
    than `vessel.h`. A docking port is the one piece of a spacecraft that is
    repeatedly slammed into another spacecraft, so the wear is not sprinkled
    over it, it is CONCENTRATED WHERE CONTACT HAPPENS and absent everywhere
    else:

      - the contact land and the petal INNER faces are SteelLight, the
        brightest and smoothest role in the palette, because a surface that
        another hull grinds against is scraped back to bare metal;
      - the petal OUTER faces, which nothing ever touches, are SteelDark on
        the same solid, via `hexa`'s per-face role list. One petal, two
        materials, twelve triangles, and the wear story is in the geometry
        rather than in a decal;
      - the seal is Rubber, the only dielectric in this catalogue. Metal
        against metal is a colour difference; metal against rubber is a
        material difference, and only the second survives a lighting change.

    Asymmetry is by bearing (see the DOCK_AZ_* table) and by wear: the three
    petals carry different skews, because a petal that has been loaded
    sideways by thirty dockings is not where the drawing put it, and three
    identical petals on a body of revolution give the engine's instance
    rotation nothing to act on.

    THE HATCH IS MODELLED AND IT IS NOT DECORATION. The old part was an
    annulus over a bulkhead disc, so the "hole" bottomed out 0.02 m in. Here
    the mouth opens into a 0.09 m well onto a real hatch with a handle, three
    dogs and a porthole, which is what a player looking into a port from a
    metre away is entitled to see, and it costs nothing at range because it is
    all inside the silhouette.

    RN-426's rule survives intact and is why every solid below OVERLAPS its
    neighbour instead of abutting it: a trim solid whose extent lands exactly
    on its host's end plane is a coplanar pair, and coplanar pairs are how the
    mating face of every tank in this game once resolved to whichever material
    the rasteriser visited last. There is no shared plane anywhere in this
    function, on purpose."""
    p = hc.Parts()
    r_tip, cone, th = DOCK_CAPTURE_R, DOCK_CONE_DEG, DOCK_PETAL_T
    _assert_capture_geometry(r_tip, cone, th, DOCK_PETAL_W[1])

    # --- structure, bottom up. Every span overlaps the one below it. -------
    tube(p, R, 0.000, 0.086, "SteelDark")                    # base collar
    tube(p, 0.586, 0.068, 0.132, "Steel", caps="hi")         # bolt flange
    stud_ring(p, (0.040, 0.034, 0.026), 0.550, 8, 0.126, "SteelDark",
              phase=math.pi / 8.0, clearance=R)              # flange bolts
    tube(p, 0.524, 0.118, 0.254, "Steel", caps="none")       # body barrel
    weld(p, 0.524, 0.148, "SteelLight")                      # course weld

    # --- the tunnel and the hatch at the bottom of it ----------------------
    # A capped tube rather than a disc, so the well has a WALL: the seal
    # land's inner radius is 0.336 and this stands 6 mm inside it, which is
    # what stops a player looking into the port and seeing the inside of the
    # barrel's single-sided skin.
    tube(p, 0.330, 0.104, 0.248, "Steel", caps="hi")         # hatch pan
    # Hatch furniture, all off-centre. A hatch handle on the axis is a target
    # cross; a hatch handle to one side is a hatch.
    for dx in (-0.075, 0.075):
        slab(p, (0.026, 0.026, 0.030), (dx - 0.055, 0.118, 0.262), "Steel")
    slab(p, (0.196, 0.028, 0.024), (-0.055, 0.118, 0.284), "SteelLight")
    for i, (hx, hy) in enumerate(((0.196, -0.104), (-0.190, -0.118),
                                  (0.012, 0.226))):
        slab(p, (0.048, 0.036, 0.020), (hx, hy, 0.260), "Steel",
             rot_z=31.0 * (i + 1))                           # hatch dogs
    disc(p, 0.104, 0.016, (0.104, -0.062, 0.252), "SteelLight", seg=8)
    disc(p, 0.084, 0.016, (0.104, -0.062, 0.259), "Glass", seg=8)

    # --- the two lands. This is the part. ---------------------------------
    # A real ANNULUS (see ring_band), because "flat ring with a hole in it" is
    # the port's whole silhouette and a painted hole is not a hole from 15
    # degrees off axis. Two of them at two heights is a SEALING interface
    # rather than a washer: the outer one is the metal land that takes the
    # load, the inner one is 18 mm lower and carries the gasket.
    # THE THREE PHASES ARE NOT DECORATION. Three concentric annuli of three
    # materials that all seam on y = 0 paint 16 coplanar pairs on that plane
    # where they overlap radially. One whole segment step apart, they cannot.
    ring_band(p, 0.452, 0.570, 0.230, DOCK_H, "SteelLight", phase_deg=0.0)
    ring_band(p, 0.336, 0.462, 0.236, 0.282, "Steel", phase_deg=22.5)
    ring_band(p, 0.352, 0.416, 0.274, 0.292, "Rubber", phase_deg=45.0)

    # --- capture latches, inboard of the land, under the mating plane ------
    # 2 mm under, and that 2 mm is RN-426's whole lesson: the old latches were
    # written to land exactly on 0.300 and produced 17 coplanar pairs.
    #
    # z 0.288 rather than 0.286, and the 2 mm is the same lesson a second time.
    # At 0.286 with a 0.024 height the latch's UNDERSIDE lands on 0.274, which
    # is exactly the gasket's own underside, and the two overlap in radius:
    # 12 more same-facing pairs, found by the gate rather than by reading.
    for az in DOCK_AZ_LATCH:
        fitting(p, (0.052, 0.096, 0.022), 0.430, az, 0.288, "Steel", R)

    # --- the capture cone, as three petals ---------------------------------
    # The tips sweep DOCK_CAPTURE_R and the inner faces lie on DOCK_CONE_DEG.
    # Per-face roles: bottom, top, then the four sides in corner order, which
    # for `petal` are inner, +tangential, outer, -tangential.
    # Steel everywhere the petal is merely hardware, SteelLight on the ONE
    # face another hull grinds against. The first version painted the outer
    # face SteelDark and the petals read as three black wedges bolted to the
    # outside of the ring rather than as a funnel; a scraped face is BRIGHTER
    # than its surroundings, not darker, and making the rest dark to
    # exaggerate that inverted the read.
    petal_roles = ["Steel", "Steel", "SteelLight",
                   "Steel", "Steel", "Steel"]
    #
    # THE ROOT HEIGHT IS SET BY LOOKING, and the first version got it wrong in
    # a way no number would have caught. Rooted at z 0.232 the petals were
    # geometrically correct, honoured both catalogue numbers exactly, and
    # rendered as three small tabs clipped to the outside of the ring: 68 mm
    # of run is not a funnel, it is a chamfer. Rooted at DOCK_PETAL_Z0 they
    # run 142 mm from the barrel out to the tip circle and read as what they
    # are from any bearing. Same two published numbers, same triangle count.
    for az, skew in zip(DOCK_AZ_PETAL, DOCK_PETAL_SKEW):
        petal(p, az, r_tip, DOCK_H, DOCK_PETAL_Z0, cone, th,
              DOCK_PETAL_W[0], DOCK_PETAL_W[1],
              petal_roles, clearance=R, skew_deg=skew)

    # --- one-off hardware, one bearing each --------------------------------
    fitting(p, (0.072, 0.112, 0.058), 0.532, DOCK_AZ_UMBILICAL, 0.186,
            "SteelDark", R)                                  # umbilical body
    fitting(p, (0.030, 0.048, 0.030), 0.578, DOCK_AZ_UMBILICAL, 0.210,
            "Accent", R)                                     # its keyed cap
    fitting(p, (0.012, 0.092, 0.056), 0.530, DOCK_AZ_PLACARD, 0.190,
            "SteelLight", R)                                 # placard
    for d in (-7.5, 7.5):
        fitting(p, (0.026, 0.026, 0.072), 0.538, DOCK_AZ_HANDRAIL + d, 0.182,
                "Steel", R)                                  # rail stanchions
    fitting(p, (0.024, 0.152, 0.024), 0.566, DOCK_AZ_HANDRAIL, 0.212,
            "SteelLight", R)                                 # the rail itself

    # --- the roll datum, at DOCK_INDEX_AZ and nowhere else -----------------
    fitting(p, (0.016, 0.052, 0.104), 0.530, DOCK_INDEX_AZ, 0.184, "Accent", R)
    fitting(p, (0.052, 0.030, 0.014), 0.400, DOCK_INDEX_AZ, 0.286, "Accent", R)
    return p


ENGINE_L_H = 2.60


def engine_large():
    """2.50 x 2.50 x 2.60. The class L main engine.

    ONE BELL, not a cluster, and that is a socket decision before it is an art
    decision: socket_muzzle is a single point and vfx_engine_plume.glb attaches
    to it at identity, so a four-bell engine would need four muzzles and the
    plume rule would stop being one rule. A 2.20 m exit diameter is also just
    a bigger engine, which is what the class means.

    Same language as engine_main at 1.25 m - mount plate, thrust structure,
    throat collar, two-section bell, exit lip, one turbopump - re-proportioned
    rather than scaled, because scaling engine_main by 2 would have put a
    1.16 m turbopump on the side of it.

    RN-421 carries engine_main's re-authoring across, and fixes the ONE
    coplanar defect that was this part's alone rather than the file's: the
    hazard stud ring was written as `z 2.465, height 0.09`, and 2.465 - 0.045
    is EXACTLY 2.42, the mount plate's own bottom face. The class S engine has
    the identical ring at `z 1.545, height 0.05` inside a plate spanning 1.50
    to 1.60, i.e. comfortably interior. So this is a scaled transcription in
    which one of the two numbers was re-derived and the other was not, and it
    cost 29 same-facing pairs across the widest horizontal face in the file.
    The studs are now placed from the plate's own span, so the arithmetic that
    put them there cannot produce a flush face."""
    r, seg, _ = CLASS["L"]
    plate_z0, plate_z1 = 2.42, ENGINE_L_H
    p = hc.Parts()
    # --- nozzle -----------------------------------------------------------
    bell(p, [(0.00, 1.096), (0.36, 0.940), (0.78, 0.726), (1.20, 0.520),
             (1.55, 0.420)], "SteelDark", seg=seg, wall=0.044, flute=0.022)
    tube(p, 1.126, 0.09, 0.17, "Steel", seg=seg, smooth=False, caps="none")

    # --- chamber ----------------------------------------------------------
    tube(p, 0.430, 1.55, 1.74, "Steel", seg=12, caps="lo")     # throat
    tube(p, 0.556, 1.74, 2.16, "SteelDark", seg=12, caps="lo")  # chamber
    tube(p, 0.556, 2.16, 2.30, "Steel", r_top=0.620, seg=12,
         caps="hi")                                             # injector dome
    weld(p, 0.556, 1.93, "Steel", seg=12, proud=0.013, h=0.036)

    # --- thrust structure -------------------------------------------------
    tube(p, r, plate_z0, plate_z1, "SteelDark", seg=seg)    # mount plate
    truss(p, 0.620, 1.010, 2.28, plate_z0, 6, "Steel", section=0.098,
          phase=15.0, clearance=r)
    truss(p, 0.590, 0.940, 1.74, plate_z0 - 0.02, 2, "SteelDark",
          section=0.116, phase=97.0, clearance=r)           # gimbal actuators
    # DERIVED from the plate, not typed: centre of the plate's lower third,
    # with the stud height taken as a fraction of the plate's own thickness so
    # the ring is interior by construction at any plate depth.
    plate_t = plate_z1 - plate_z0
    stud_ring(p, (0.14, 0.14, plate_t * 0.30), 1.06, 8,
              plate_z0 + plate_t * 0.30, "Hazard", clearance=r)

    # --- turbopump and its plumbing, all on one side ----------------------
    px, py = hull(0.700, 20.0, r)
    tube(p, 0.260, 1.78, 2.32, "Steel", seg=8, loc=(px, py))
    fitting(p, (0.46, 0.33, 0.24), 0.700, 20.0, 2.38, "SteelDark", r)
    vx, vy = hull(0.600, 44.0, r)
    tube(p, 0.112, 1.60, 1.84, "SteelDark", seg=6, caps="none", loc=(vx, vy))
    hx, hy = hull(0.634, -6.0, r)
    tube(p, 0.082, 1.90, 2.26, "Steel", seg=6, caps="none", loc=(hx, hy))
    fitting(p, (0.19, 0.13, 0.11), 0.634, -6.0, 1.86, "SteelDark", r)
    for az, rp, r_at in ((146.0, 0.098, 0.800), (196.0, 0.070, 0.744)):
        fx, fy = hull(r_at, az, r - rp)
        tube(p, rp, 2.10, 2.44, "SteelDark", seg=6, caps="none", loc=(fx, fy))
        fitting(p, (0.21, 0.15, 0.10), r_at, az, 2.06, "Steel", r)
    return p


ADAPTER_H = 1.00


def stack_adapter():
    """2.50 x 2.50 x 1.00. THE PART THAT MAKES TWO CLASSES ONE CATALOGUE.

    Bottom face class L, top face class S, and it is the only part in the file
    whose two ends differ. Everything else about it is the tank language: a
    barrel (here a cone from 1.200 down to 0.600) with a COLLAR at each end at
    that end's mating radius, so each face's diameter is carried by its own
    ring and the cone in between is free to be whatever reads best.

    A MATING FACE IS BUILT WITH THE SEGMENT COUNT OF THE CLASS IT PRESENTS, so
    the collars are 24-gon at the bottom and 16-gon at the top, so each face is
    exactly its class diameter rather than approximately it.

    THE COLLAR MUST ALSO STAND PROUD OF THE CONE, and that is the half of the
    rule a validator cannot check. A 24-gon and a 16-gon of the same
    CIRCUMRADIUS are not the same surface: their inradii at R 0.625 are 0.6199
    and 0.6130. So a cone that was still 0.654 wide where the class S collar
    starts poked out through it at alternating azimuths and rendered as a
    ragged, scalloped ring right under the joint - while dims_xyz_m,
    part_sockets and check_mating all passed, because the mating PLANES were
    exact and it was the mating SURFACES that disagreed. Only the render showed
    it (docs/screenshots/vessel_adapter_joint.png).

    The cone therefore finishes its taper at the class S BARREL radius 0.600
    where the collar begins, exactly as a tank's barrel does. The 24-to-16
    mismatch then lands under a collar that overhangs it by 13 mm at the worst
    azimuth, which is hidden by construction rather than by luck.

    RN-422: the cone is CAPLESS. Its bottom disc was sealed inside the class L
    collar and coplanar with that collar's own mating face, which is 55 of the
    file's 778 pairs and the second largest single group in it. The top disc
    is sealed inside the class S collar and goes for the same reason. What the
    freed triangles buy is the thing an interstage adapter visibly has and
    this one did not: LONGITUDINAL PANEL SEAMS, because a conical shell is
    rolled from flat plate and the seams are the only thing that says which
    way up it is."""
    rl, segl, rbl = CLASS["L"]
    rs, segs, rbs = CLASS["S"]
    z_s = ADAPTER_H - 0.09              # class S collar depth, as fuel_tank's
    p = hc.Parts()
    tube(p, rbl, 0.00, z_s, "SteelLight", r_top=rbs, seg=segl, caps="none")
    tube(p, rl, 0.00, 0.14, "SteelDark", seg=segl)          # class L collar
    tube(p, rs, z_s, ADAPTER_H, "SteelDark", seg=segs)      # class S collar
    tube(p, 0.945, 0.45, 0.55, "Accent", r_top=0.885, seg=segl)
    stud_ring(p, (0.14, 0.14, 0.10), 1.10, 8, 0.19, "SteelDark", clearance=rl)
    # Six longitudinal seam straps, each following the cone's own taper in
    # three courses. The cone runs 1.200 down to 0.600 over 0.91 m, so a strap
    # placed at one radius stands 300 mm off the hull at one end.
    for i in range(6):
        az = 60.0 * i + 11.0
        for j in range(3):
            zc = 0.20 + 0.28 * j
            rc = rbl + (rbs - rbl) * (zc / z_s)
            fitting(p, (0.038, 0.10, 0.26), rc + 0.014, az, zc, "Steel", rl)
    # Two lifting lugs and an umbilical plate, none of them on a seam bearing.
    for az in (37.0, 217.0):
        fitting(p, (0.10, 0.19, 0.16), rbl - 0.02, az, 0.30, "Steel", rl)
    fitting(p, (0.055, 0.24, 0.18), 0.960, 143.0, 0.62, "Accent", rl)
    return p


# ---------------------------------------------------------------------------
# Radial parts. Origin on the mount plane, body extends +X.
# ---------------------------------------------------------------------------

# The published hull-to-hull gap a radial decoupler holds open.
RADIAL_STANDOFF = 0.30


def radial_decoupler():
    """0.30 x 0.36 x 0.60 (Blender x/y/z). The strap-on separator.

    Its X EXTENT IS THE CONTRACT. The part spans exactly RADIAL_STANDOFF from
    its mount plane to its outboard face, so "how far from the hull does a
    strapped-on booster sit" has one answer that is measurable off the shipped
    mesh: socket_radial_mount at 0, socket_radial_out at 0.30, and nothing in
    between sticking out past either. check_mating.py measures precisely that.

    Hazard banded, because like the stack decoupler its job is to stop
    existing, and the player should be able to see which parts do that.

    RN-427: it gets the pusher piston that is the whole mechanism, a firing
    connector on ONE side (a radial decoupler fires once and has one initiator)
    and a hinge knuckle at the top, which is what a real strap-on separator
    pivots about so the booster swings out rather than sliding sideways."""
    p = hc.Parts()
    slab(p, (0.06, 0.36, 0.60), (0.03, 0.0, 0.0), "SteelDark")   # hull saddle
    slab(p, (0.18, 0.26, 0.44), (0.15, 0.0, 0.0), "Steel")       # body
    slab(p, (0.20, 0.28, 0.10), (0.15, 0.0, 0.0), "Hazard")      # band
    slab(p, (0.06, 0.30, 0.50), (0.27, 0.0, 0.0), "SteelDark")   # outboard pad
    for sy in (-1.0, 1.0):
        for sz in (-1.0, 1.0):
            slab(p, (0.05, 0.06, 0.06), (0.03, sy * 0.14, sz * 0.24), "Steel")
    # The pusher: a piston in a barrel, on the axis, breaking the outboard pad
    # in the middle. It is the reason the part exists.
    v, f, sm = of.cyl_data(0.075, 0.13, (0.155, 0.0, 0.0), axis="X",
                           segments=8)
    p.add(v, f, sm, "SteelDark")
    v, f, sm = of.cyl_data(0.046, 0.11, (0.235, 0.0, 0.0), axis="X",
                           segments=8)
    p.add(v, f, sm, "Steel")
    # Hinge knuckle at the top, firing connector at the bottom, one side each.
    # THE X EXTENT IS THE PUBLISHED RADIAL_STANDOFF, so the piston stops at
    # 0.29 and not at 0.30: a piston flush with the outboard pad would both
    # move the standoff check_mating.py measures AND put two materials on one
    # plane, which is the pair of mistakes this pass is about.
    slab(p, (0.11, 0.075, 0.085), (0.105, 0.140, 0.245), "Steel")
    slab(p, (0.085, 0.10, 0.07), (0.115, -0.130, -0.215), "SteelDark")
    return p


def engine_vernier():
    """A small gimballed thruster on a stub arm, bell facing down.

    RN-428: it is a GIMBALLED thruster and now it looks gimballed. A yoke, a
    trunnion through it, and one actuator off to one side; plus a real fluted
    bell rather than a capped cone, and a feed line down the arm."""
    p = hc.Parts()
    slab(p, (0.12, 0.26, 0.26), (0.06, 0.0, 0.0), "SteelDark")   # mount plate
    slab(p, (0.20, 0.13, 0.13), (0.16, 0.0, 0.0), "Steel")       # arm
    for sy in (-1.0, 1.0):                                       # yoke cheeks
        slab(p, (0.075, 0.032, 0.19), (0.225, sy * 0.082, 0.015), "SteelDark")
    v, f, sm = of.cyl_data(0.028, 0.22, (0.225, 0.0, 0.015), axis="Y",
                           segments=6)
    p.add(v, f, sm, "Steel")                                     # trunnion
    tube(p, 0.11, -0.02, 0.10, "Steel", seg=8, loc=(0.22, 0.0))  # chamber
    # 0.134 + the 0.006 flute is 0.140, so the widest column lands on exactly
    # the 0.22 + 0.14 = 0.36 this part has always measured. A bell whose flutes
    # were added ON TOP of the old radius would have moved dims_xyz_m.
    # SEG 8, NOT 12, AND THE REASON IS THE BOUNDING BOX (see bell's docstring).
    # The flute lands on ODD columns, so a segment count whose quarter is odd
    # puts a fluted column on +-Y and none on +-X: at 12 the widest column is
    # at 90 degrees, and this part's dims_xyz_m came out 0.354 x 0.292 instead
    # of 0.36 x 0.28. At 8 the quarter is 2, both axes land on EVEN columns,
    # and the part measures exactly what it always did.
    bell(p, [(-0.30, 0.140), (-0.19, 0.118), (-0.08, 0.095),
             (-0.02, 0.084)], "SteelDark", seg=8, wall=0.014, flute=0.006,
         loc=(0.22, 0.0))
    # One actuator, on one side, which is what makes it asymmetric.
    slab(p, (0.145, 0.045, 0.045), (0.155, -0.115, 0.105), "Steel")
    tube(p, 0.020, -0.01, 0.12, "SteelDark", seg=4, caps="none",
         loc=(0.115, 0.098))                                     # feed line
    return p


def landing_leg_bracket():
    """The half of the leg that does NOT move: the hull yoke the strut hinges
    in. It is its own mesh because one Blender Action drives one object, so
    anything that must stay put cannot share a mesh with anything that
    moves.

    RN-430, THE SHARED MOUNT PLANE, 4 pairs. Both solids were written as
    `size s at x = s/2`, which puts both inboard faces on x = 0 because that
    is what "sits on the mount plane" means. Only ONE of them can be the
    mount face, and it is the yoke plate; the hinge boss is a boss and starts
    at the plate's OUTER face, which is where a boss on a plate starts. Form
    work on top: the yoke is now a proper A-frame with two cheeks and a
    trunnion pin through them, so you can see what the strut swings on.

    Everything here stays inside the 0.20 x 0.34 x 0.42 this part has always
    published, because a radial part's dims_xyz_m is its contract row and the
    fix for a coplanar pair is not a licence to make the part bigger."""
    p = hc.Parts()
    slab(p, (0.16, 0.34, 0.42), (0.08, 0.0, 0.0), "SteelDark")   # yoke plate
    # Starts at the plate's OUTER face (0.16), not at the mount plane. That
    # one number is the whole fix: `size s at x = s/2` is what put two
    # different materials on x = 0 with the same area under them.
    slab(p, (0.04, 0.10, 0.12), (0.18, 0.0, 0.0), "Steel")       # hinge boss
    for sy in (-1.0, 1.0):                                       # cheeks
        slab(p, (0.075, 0.030, 0.185), (0.1625, sy * 0.085, -0.03), "Steel")
    v, f, sm = of.cyl_data(0.024, 0.23, (0.175, 0.0, -0.03), axis="Y",
                           segments=6)
    p.add(v, f, sm, "SteelLight")                                # trunnion pin
    slab(p, (0.055, 0.075, 0.065), (0.115, 0.0, 0.175), "Steel")  # stop block
    return p


def landing_leg_strut():
    """The moving half, authored STOWED: folded up flat along the hull.

    The foot pad is built pre-rotated by -LEG_DEPLOY_DEG about Y, so that once
    the deploy clip has rotated the pivot by +LEG_DEPLOY_DEG the pad is exactly
    horizontal and lands flat. Stowed, it lies flat against the tank, which is
    also what a real folded leg does.

    RN-431: the shock is now visibly a shock. A cylinder body, a POLISHED
    PISTON of smaller section emerging from it, a gland nut where the two
    meet, and a bleed line running up the strut. That progression, thick to
    thin across a gland, is the only thing that says "this absorbs a landing"
    rather than "this is a thicker part of the same stick"."""
    p = hc.Parts()
    slab(p, (0.14, 0.16, 2.30), (0.20, 0.0, 1.18), "Steel")        # strut
    slab(p, (0.19, 0.21, 0.60), (0.20, 0.0, 0.40), "SteelDark")    # shock body
    slab(p, (0.125, 0.145, 0.30), (0.20, 0.0, 0.83), "SteelLight")  # piston
    slab(p, (0.215, 0.235, 0.055), (0.20, 0.0, 0.695), "Steel")    # gland nut
    slab(p, (0.09, 0.09, 1.60), (0.31, 0.0, 1.30), "SteelDark")    # brace
    for z in (0.72, 1.42, 2.05):                                   # clamps
        slab(p, (0.165, 0.185, 0.05), (0.263, 0.0, z), "Steel")
    tube(p, 0.018, 0.52, 2.24, "SteelDark", seg=4, caps="none",
         loc=(0.288, 0.062))                                       # bleed line
    pad = hc.Parts()
    disc(pad, 0.24, 0.07, (0.0, 0.0, 0.0), "SteelDark", seg=8)
    disc(pad, 0.15, 0.10, (0.0, 0.0, 0.02), "Steel", seg=8)
    for sy in (-1.0, 1.0):                                         # pad yoke
        slab(pad, (0.055, 0.028, 0.115), (0.0, sy * 0.062, 0.105), "Steel")
    pad.rotate("Y", -LEG_DEPLOY_DEG)
    pad.translate(*LEG_PAD_LOC)
    p.extend(pad)
    return p


def fin():
    """A swept delta fin: chord on the stack axis, span radial, thin in Y.

    Written out as eight vertices rather than assembled from primitives,
    because a fin is a single wedge and every primitive version of it is a box
    with two faces in the wrong place.

    RN-429 FIXES BOTH OF THIS PART'S DEFECTS, AND THEY ARE TWO DIFFERENT
    CAUSES SHARING ONE PART.

      THE SHARED MOUNT PLANE (4 pairs, x = 0). A radial part's origin IS its
      mount plane, so the wedge's root face and the root fairing's inboard
      face were both authored to start there. The fix is not to move either:
      it is that the wedge's root face IS ENTIRELY INSIDE THE FAIRING (the
      fairing is 0.10 wide in y against the root's 0.09, and spans the same
      z) and was never visible. Face `(0, 3, 2, 1)` is simply gone. Two
      triangles deleted, four pairs gone.

      THE COPIED CHORD (4 pairs, z = -0.55). The fairing was written 1.10
      tall, which is the wedge's chord to the millimetre because it was typed
      from it. A root fairing that runs the FULL chord is also wrong as a
      shape: it is a fillet at the join, and it stops short at both ends. At
      0.96 it stops short and the two bottom faces stop being one plane.

    RN-429's form work on top of that: a blunt leading edge in two facets
    rather than one sharp wedge, a tip cap, and a trailing-edge actuator
    fairing on ONE side, so the fin is not mirror-symmetric in y."""
    root_t, tip_t = 0.045, 0.020
    # Vertices 0..3 are the root, 4..7 the tip. The root FACE is deliberately
    # not built: see the docstring.
    v = [(0.00, -root_t, -0.55), (0.00, root_t, -0.55),
         (0.00, root_t, 0.55), (0.00, -root_t, 0.55),
         (0.85, -tip_t, -0.55), (0.85, tip_t, -0.55),
         (0.85, tip_t, -0.05), (0.85, -tip_t, -0.05)]
    f = [(4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    p = hc.Parts()
    p.add(v, f, [False] * len(f), "SteelLight")
    # 0.96 rather than 1.10: a root fillet stops short of both ends of the
    # chord, and the two bottom faces stop being one plane.
    slab(p, (0.06, 0.10, 0.96), (0.03, 0.0, -0.02), "SteelDark")
    # Leading edge (trailing in flight terms is +z here), blunted in one extra
    # facet, and a tip cap. Both are along the wedge, so neither is a plane
    # any other material shares.
    slab(p, (0.30, 0.052, 0.055), (0.16, 0.0, 0.522), "Steel")
    slab(p, (0.055, 0.030, 0.085), (0.822, 0.0, -0.30), "Steel")
    # ONE actuator fairing, on -y only. A control fin has an actuator and a
    # mirror-symmetric fin has none. The part is 0.10 m thick in total, so
    # both pieces sit against the -0.05 skin line and the SECOND one is held
    # 3 mm off it deliberately: two fittings sharing an outer face is the
    # copied-width defect this same part was just fixed for.
    slab(p, (0.22, 0.038, 0.11), (0.135, -0.031, -0.34), "SteelDark")
    slab(p, (0.085, 0.028, 0.075), (0.285, -0.033, -0.34), "Steel")
    return p


def solar_mount():
    """The fixed half of the solar panel.

    RN-432. THIS PART WAS ALREADY RIGHT and is recorded as such: its hinge
    boss spans x 0.08 to 0.18, i.e. it is let INTO the base plate rather than
    started at the mount plane, which is exactly the fix the landing leg's
    yoke needed. Nothing about the two solids is changed; the drive box and
    the two hinge cheeks are added inside the 0.18 x extent the part has
    always published, because a panel that deploys has a mechanism that
    deploys it."""
    p = hc.Parts()
    slab(p, (0.16, 0.44, 0.30), (0.08, 0.0, 0.0), "SteelDark")   # base plate
    slab(p, (0.10, 0.16, 0.16), (0.13, 0.0, 0.0), "Steel")       # hinge boss
    for sz in (-1.0, 1.0):                                       # cheeks
        slab(p, (0.085, 0.048, 0.042), (0.1275, 0.0, sz * 0.098), "Steel")
    slab(p, (0.055, 0.115, 0.09), (0.0575, 0.148, 0.0), "Steel")  # drive box
    slab(p, (0.045, 0.075, 0.062), (0.0525, -0.155, 0.058), "SteelLight")
    return p


def solar_array():
    """The moving half, authored STOWED: folded flat against the hull with the
    CELLS FACING INBOARD.

    That is not a detail. Solar_Deploy rotates the pivot +90 degrees about Y,
    which maps local -X onto world +Z, so cells authored on the inboard face
    are the ones pointing at the sky once the panel is out. Author them
    outboard and the deployed panel presents its back to the star.

    RN-433, THE COPIED WIDTH, AND IT IS THE DEFECT THE BRIEF PREDICTED. Both
    solids in each bay were written 0.56 wide in y, because the second one was
    typed from the first. Two boxes of the same width at the same y centre put
    their +y and -y faces on two shared planes with the full bay area under
    them, in two different materials: 3 bays x 2 sides x 2 triangles = 12
    pairs, and the only part of the file where the cause is literally a copied
    number rather than a shared landmark.

    The fix is not a millimetre. The second solid is a STIFFENER RIB behind
    the cell, and a rib behind a panel is narrower than the panel, so it is
    0.47. What the panel gets instead of a full-width backing plate is the
    thing that actually reads: CELL DIVISIONS. Each bay is now four cells with
    interconnect strips between them, plus a diagonal tension brace across the
    array and a hinge fitting at the root, so the panel is a structure rather
    than three painted slabs."""
    p = hc.Parts()
    slab(p, (0.06, 0.10, 1.26), (0.055, 0.0, 0.67), "Steel")       # spine
    for z in (0.24, 0.66, 1.08):
        slab(p, (0.030, 0.56, 0.36), (0.0425, 0.0, z), "SuitAccent")
        # 0.47, not 0.56: a rib behind a panel is narrower than the panel.
        slab(p, (0.035, 0.47, 0.02), (0.0725, 0.0, z), "SteelDark")
        # Every one of these stays inside the 0.065 x 0.56 x 1.26 the part has
        # always published: an array that grew would move dims_xyz_m, and the
        # deployed panel's world reach is what the lander is built around.
        # THE INTERCONNECTS STAND PROUD OF THE CELL, 0.036 against 0.030, and
        # that is not a style choice. The first draft of RN-433 gave them the
        # cell's own 0.030 at the cell's own x centre, which put four Steel
        # faces on the two SuitAccent planes with the whole cell area under
        # them: 72 same-facing pairs, i.e. I committed the copied-width defect
        # inside the fix for the copied-width defect, in the same function, on
        # the same day. check_coplanar caught it in the run after the build.
        # A strip on top of a cell is proud of the cell; it always was.
        for sy in (-1.0, 1.0):                                     # cell gaps
            slab(p, (0.036, 0.014, 0.345), (0.0425, sy * 0.128, z), "Steel")
        slab(p, (0.036, 0.545, 0.013), (0.0425, 0.0, z), "Steel")
    for sz in (-1.0, 1.0):                                         # end rails
        slab(p, (0.042, 0.545, 0.030), (0.048, 0.0, 0.67 + sz * 0.605),
             "SteelDark")
    # 0.062 to 0.088, INSIDE the rib's 0.055 to 0.090: a brace flush with the
    # rib's back face is the same defect one solid over.
    slab(p, (0.026, 0.075, 1.15), (0.075, 0.215, 0.67), "Steel")   # brace
    return p


def rcs_block():
    """Four-nozzle attitude thruster cluster.

    RN-434: the four nozzles get throats and mounting flanges, the manifold
    behind them gets its two propellant feeds (different diameters, because
    oxidiser and fuel are not the same flow) and a heater blanket, and the
    whole cluster keeps the 0.245 x 0.50 x 0.50 envelope it published. The
    four nozzles stay four and stay square: this is the one part in the file
    where a symmetric ring is CORRECT, because a thruster quad that cannot
    push equally in four directions is a thruster quad that does not work."""
    p = hc.Parts()
    slab(p, (0.10, 0.26, 0.26), (0.05, 0.0, 0.0), "SteelDark")   # base
    slab(p, (0.14, 0.16, 0.16), (0.17, 0.0, 0.0), "Steel")       # manifold
    for sy in (-1.0, 1.0):
        v, f, sm = of.cyl_data(0.075, 0.12, (0.17, sy * 0.19, 0.0), axis="Y",
                               segments=8, radius_top=0.045)
        p.add(v, f, sm, "SteelDark")
        v, f, sm = of.cyl_data(0.042, 0.055, (0.17, sy * 0.105, 0.0),
                               axis="Y", segments=8)
        p.add(v, f, sm, "Steel")                                 # throat
    for sz in (-1.0, 1.0):
        v, f, sm = of.cyl_data(0.075, 0.12, (0.17, 0.0, sz * 0.19), axis="Z",
                               segments=8, radius_top=0.045)
        p.add(v, f, sm, "SteelDark")
        v, f, sm = of.cyl_data(0.042, 0.055, (0.17, 0.0, sz * 0.105),
                               axis="Z", segments=8)
        p.add(v, f, sm, "Steel")                                 # throat
    # Two feeds and a heater blanket, all on one quadrant, which is what stops
    # the block being the same object at four yaws.
    slab(p, (0.115, 0.032, 0.032), (0.088, 0.098, 0.098), "Steel")
    slab(p, (0.100, 0.024, 0.024), (0.080, -0.092, 0.104), "SteelLight")
    # x 0.006 to 0.061, NOT 0 to 0.055: the base plate owns the mount plane
    # and nothing else may put a face on it. Same cause as the landing leg's.
    slab(p, (0.055, 0.135, 0.135), (0.0335, -0.055, -0.055), "Steel")
    return p
