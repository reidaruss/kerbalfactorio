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
ROLES = ["SteelLight", "Steel", "SteelDark", "Accent", "Hazard", "Glass",
         "SuitAccent"]

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

def tube(p, r, z0, z1, role, r_top=None, seg=SEG, smooth=True, loc=(0.0, 0.0)):
    """A cylinder or frustum between two heights on the stack axis."""
    v, f, sm = of.cyl_data(r, z1 - z0, (loc[0], loc[1], (z0 + z1) * 0.5),
                           axis="Z", segments=seg, smooth_sides=smooth,
                           radius_top=r_top)
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


def ring_band(p, r_in, r_out, z0, z1, role, seg=SEG):
    """A true ANNULUS prism: a ring with a hole all the way through it.

    Everything else in this file is a capped tube, and a capped tube inside a
    capped tube is two discs nobody can see. The docking port needs an actual
    hole, because "flat ring" is its entire silhouette and a disc with a
    darker disc painted on it is a different part at 30 m.

    Built as TWO HALF SWEEPS rather than one 0-to-360 sweep, because a full
    sweep puts its start and end caps on the same plane, and mesh.validate()
    deletes the degenerate result - which would make the reported triangle
    count a lie (of_lib.arc_band_data says the same thing about r_in). The two
    seam caps that remain are coincident, interior and backface-culled."""
    loc = (0.0, 0.0, (z0 + z1) * 0.5)
    for a0 in (0.0, 180.0):
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
# Stack parts
# ---------------------------------------------------------------------------

POD_H = 2.50


def command_pod():
    """1.25 x 1.25 x 2.50. A blunt re-entry cone with a docking ring on top.

    The cone is the whole read: nothing else in the game is conical, so a
    vessel with a pod on it is identifiable as crewed from any distance."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.18, "SteelDark")                     # heat-shield skirt
    tube(p, R, 0.18, 1.95, "SteelLight", r_top=0.36)        # hull cone
    tube(p, 0.505, 0.98, 1.06, "Accent")                    # trim band
    tube(p, 0.38, 1.95, 2.06, "SteelDark")                  # shoulder ring
    tube(p, 0.34, 2.06, 2.34, "Steel")                      # neck
    tube(p, 0.30, 2.34, POD_H, "SteelDark", seg=12)         # docking ring
    # Forward window: frame first, glass proud of it, both on the -Y face the
    # asset convention calls forward.
    slab(p, (0.52, 0.08, 0.32), (0.0, -0.425, 1.35), "SteelDark")
    slab(p, (0.44, 0.10, 0.24), (0.0, -0.445, 1.35), "Glass")
    # Crew hatch on +X, clear of the window.
    slab(p, (0.08, 0.42, 0.48), (0.462, 0.0, 1.15), "SteelDark")
    slab(p, (0.05, 0.30, 0.10), (0.478, 0.0, 1.30), "Accent")
    return p


def fuel_tank(height, bands=1, cls="S"):
    """<class diameter> square x `height`. Barrel at the class barrel radius
    with collars at the class mating radius, so the mating diameter is carried
    by the RINGS and the barrel reads slightly waisted. That is also what keeps
    the bounding box exact when a stringer stands proud of the barrel.

    Class L is this form RE-DERIVED, not a scaled copy: the trim depth doubles
    with `class_scale`, but the stringer COUNT doubles independently (see
    STRINGERS) and the height is whatever the part is, so a 2.50 x 4.00 tank
    reads as a wide tank and not as a small tank filmed from closer up."""
    r, seg, r_body = CLASS[cls]
    k = class_scale(cls)
    p = hc.Parts()
    tube(p, r_body, 0.00, height, "SteelLight", seg=seg)
    tube(p, r, 0.00, 0.09 * k, "SteelDark", seg=seg)
    tube(p, r, height - 0.09 * k, height, "SteelDark", seg=seg)
    for i in range(bands):
        z = height * (i + 1) / (bands + 1)
        tube(p, r - 0.010 * k, z - 0.05 * k, z + 0.05 * k, "Accent", seg=seg)
    # Stringers on the half-azimuth. At r_body they never reach +-X or +-Y, so
    # they cannot touch the AABB the collars define.
    n = STRINGERS[cls]
    ring_slabs(p, (0.10 * k, 0.10 * k, height - 0.30 * k), r_body, n,
               height * 0.5, "Steel", phase=math.pi / n)
    return p


ENGINE_H = 1.60


def engine_main():
    """1.25 x 1.25 x 1.60. Bell exit at z = 0, which is where socket_muzzle
    sits and where vfx_engine_plume.glb attaches with an identity transform."""
    p = hc.Parts()
    tube(p, R, 1.50, ENGINE_H, "SteelDark")                 # mount plate
    tube(p, 0.30, 1.12, 1.50, "Steel", seg=12)              # thrust structure
    ring_slabs(p, (0.09, 0.09, 0.40), 0.46, 4, 1.30, "Steel",
               phase=math.pi * 0.25)
    tube(p, 0.24, 0.95, 1.12, "SteelDark", seg=12)          # throat collar
    tube(p, 0.38, 0.45, 0.95, "SteelDark", r_top=0.22)      # bell, upper
    tube(p, 0.55, 0.00, 0.45, "SteelDark", r_top=0.38)      # bell, lower
    tube(p, 0.58, 0.00, 0.06, "Steel")                      # exit lip
    slab(p, (0.30, 0.22, 0.30), (0.34, 0.0, 1.30), "Steel")  # turbopump
    tube(p, 0.05, 1.00, 1.45, "SteelDark", seg=8, loc=(0.34, 0.16))
    ring_slabs(p, (0.07, 0.07, 0.05), 0.54, 8, 1.545, "Hazard")
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
    mating face and a tank has to bolt to something."""
    p = hc.Parts()
    bell_shell(p, 0.615, 0.175, 0.00, 0.62, "SteelDark")
    tube(p, 0.415, 0.29, 0.33, "Steel")                 # stiffener hoop
    tube(p, 0.16, 0.62, 0.78, "SteelDark")              # throat
    tube(p, 0.24, 0.78, 0.88, "Steel")                  # chamber / injector
    tube(p, 0.255, 0.80, 0.84, "Accent")                # band
    tube(p, R, 0.92, ENGINE_V_H, "SteelDark")           # mount ring
    # Four open struts, chamber shoulder out to the mount ring underside. Built
    # once along +Z and swung into place, the same trick the landing leg's foot
    # pad uses, because a strut authored at its final angle is a strut that
    # cannot be moved.
    for az in (0.0, 90.0, 180.0, 270.0):
        s = hc.Parts()
        slab(s, (0.055, 0.055, 0.31), (0.0, 0.0, 0.135), "Steel")
        s.rotate("Y", 67.8)
        s.translate(0.25, 0.0, 0.83)
        s.rotate("Z", az)
        p.extend(s)
    for sy in (-1.0, 1.0):                              # propellant feeds
        tube(p, 0.035, 0.84, 0.95, "Steel", seg=8, loc=(0.0, sy * 0.30))
    return p


DECOUPLER_H = 0.25            # class S
DECOUPLER_L_H = 0.35          # class L: wider, but a joint, so barely taller


def decoupler(cls="S"):
    """<class diameter> square x 0.25 (S) or 0.35 (L). The one part whose job
    is to stop existing, so it is the one part banded in hazard yellow.

    Every proportion is a FRACTION OF ITS OWN HEIGHT rather than a literal, so
    the two classes are the same part at two sizes and not two drawings that
    happen to look alike: collars are 0.24 h, the hazard band spans 0.36 h to
    0.64 h, and the separation bolts are 0.36 h tall on the mid plane."""
    r, seg, r_body = CLASS[cls]
    k = class_scale(cls)
    h = DECOUPLER_H if cls == "S" else DECOUPLER_L_H
    p = hc.Parts()
    tube(p, r_body, 0.00, h, "SteelDark", seg=seg)
    tube(p, r, 0.00, h * 0.24, "Steel", seg=seg)
    tube(p, r, h - h * 0.24, h, "Steel", seg=seg)
    tube(p, r - 0.005 * k, h * 0.36, h * 0.64, "Hazard", seg=seg)
    ring_slabs(p, (0.08 * k, 0.08 * k, h * 0.36), r - 0.045 * k,
               DECOUPLER_BOLTS[cls], h * 0.5, "SteelDark")
    return p


NOSE_H = 1.20


def nose_cone():
    """1.25 x 1.25 x 1.20 ogive. Four frustum sections, because a single cone
    reads as a party hat and an ogive reads as a rocket."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.08, "SteelDark")
    rings = ((0.08, 0.625), (0.40, 0.560), (0.75, 0.430),
             (1.02, 0.250), (NOSE_H, 0.055))
    for (z0, r0), (z1, r1) in zip(rings, rings[1:]):
        tube(p, r0, z0, z1, "SteelLight", r_top=r1)
    tube(p, 0.60, 0.30, 0.36, "Accent")
    return p


CHUTE_H = 0.75


def parachute():
    """1.25 x 1.25 x 0.75 canister. The canopy itself is not authored: a
    deployed parachute is cloth, and cloth is a shader-and-simulation problem
    that does not belong in a static .glb. socket_chute is where it spawns."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.06, "SteelDark")                     # mounting flange
    tube(p, 0.42, 0.06, 0.66, "Steel")                      # canister
    tube(p, 0.44, 0.66, CHUTE_H, "SteelDark")               # lid
    tube(p, 0.43, 0.28, 0.36, "Hazard")                     # band
    ring_slabs(p, (0.06, 0.06, 0.58), 0.44, 4, 0.36, "SteelDark",
               phase=math.pi * 0.25)
    return p


BAY_H = 1.60


def cargo_bay():
    """1.25 x 1.25 x 1.60. Doors are modelled shut with a deep seam: a cargo
    bay that reads as openable without carrying a clip nobody has asked the
    sim for yet."""
    p = hc.Parts()
    tube(p, R_BODY, 0.00, BAY_H, "SteelLight")
    tube(p, R, 0.00, 0.10, "SteelDark")
    tube(p, R, BAY_H - 0.10, BAY_H, "SteelDark")
    for sy in (-1.0, 1.0):
        slab(p, (0.90, 0.04, 1.24), (0.0, sy * 0.598, 0.80), "SteelDark")
        slab(p, (0.86, 0.03, 0.05), (0.0, sy * 0.606, 0.80), "Hazard")
    # Hinge rods at 0.570: an 8-gon of radius 0.05 reaches exactly 0.05 along
    # +-X, so a rod centred at 0.585 pushed the bounding box out to 1.27 and
    # broke the one dimension the whole stack contract rests on.
    for sx in (-1.0, 1.0):                                  # hinge rods
        tube(p, 0.05, 0.16, BAY_H - 0.16, "Steel", seg=8, loc=(sx * 0.570, 0.0))
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
    its own hull, which is the part that makes it strap-on."""
    p = hc.Parts()
    tube(p, 0.520, 0.04, 0.55, "SteelDark", r_top=R)        # aft skirt
    tube(p, 0.44, 0.00, 0.52, "SteelDark", r_top=0.16, seg=12)   # nozzle
    tube(p, R_BODY, 0.55, 5.40, "SteelLight")               # casing
    tube(p, R, 0.55, 0.64, "SteelDark")                     # aft collar
    tube(p, R, 5.31, 5.40, "SteelDark")                     # forward collar
    tube(p, R_BODY, 5.40, BOOSTER_H, "SteelLight", r_top=0.30)   # nose taper
    tube(p, 0.615, 0.95, 1.13, "Hazard")                    # jettison band
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
    way, and the 32 triangles it costs are the price of a clean joint."""
    p = hc.Parts()
    tube(p, 0.36, 0.00, 0.08, "SteelDark")                  # bottom flange
    tube(p, 0.36, 0.08, 0.44, "SteelLight", r_top=0.605)    # lower bowl
    tube(p, R, 0.44, 0.56, "Accent")                        # equator belt
    tube(p, 0.605, 0.56, 0.92, "SteelLight", r_top=0.36)    # upper bowl
    tube(p, 0.36, 0.92, MONO_H, "SteelDark")                # top flange
    slab(p, (0.10, 0.10, 0.06), (0.22, 0.0, 0.96), "Steel")  # fill port
    return p


WHEEL_H = 0.40


def reaction_wheel():
    """1.25 x 1.25 x 0.40. Torque with no propellant.

    A thin ring: two mating collars at the full class radius with a deep waist
    between them, which is a profile nothing else in the catalogue has. The
    three gyro bosses sit IN that waist, standing proud of the 0.46 drum and
    still 15 mm clear of the 0.625 bounding box, so the groove reads as a
    groove from the side and the bosses say "this thing spins" from above."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.06, "SteelDark")                     # bottom collar
    tube(p, R, 0.34, WHEEL_H, "SteelDark")                  # top collar
    tube(p, 0.46, 0.06, 0.34, "Steel")                      # rotor housing
    tube(p, 0.50, 0.16, 0.24, "Accent")                     # band
    ring_slabs(p, (0.18, 0.18, 0.26), 0.52, 3, 0.20, "SteelDark")
    return p


BATTERY_H = 0.60


def battery():
    """1.25 x 1.25 x 0.60. Stored charge for the night side.

    A ribbed drum: eight cell blocks around a narrow core, which is the one
    silhouette in the catalogue built out of repetition rather than out of
    revolution. Banded in SuitAccent blue rather than Accent orange, because
    the solar panel's cells are already SuitAccent and colour-blocking the
    electrical parts together is free legibility. Orange stays what it is
    everywhere else in the game: the trim colour, not a system."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.07, "SteelDark")                     # bottom collar
    tube(p, R, 0.53, BATTERY_H, "SteelDark")                # top collar
    tube(p, 0.44, 0.07, 0.53, "Steel")                      # core
    ring_slabs(p, (0.16, 0.16, 0.40), 0.52, 8, 0.30, "SteelDark",
               phase=math.pi * 0.125)
    tube(p, 0.50, 0.27, 0.33, "SuitAccent")                 # charge stripe
    return p


DOCK_H = 0.30


def docking_port():
    """1.25 x 1.25 x 0.30. The androgynous mating ring.

    Its top face IS a mating plane, so socket_dock and socket_stack_top are
    co-located: docking is stacking that happened in orbit, and the engine
    should not need two rules for it.

    The ring is a real ANNULUS (see ring_band) rather than a disc with a
    darker disc painted on it. A docking port is 0.30 m tall against a 6 m
    booster, so the hole is the only thing that identifies it at any distance
    at all, and a painted hole is not a hole from 15 degrees off axis."""
    p = hc.Parts()
    tube(p, R, 0.00, 0.10, "SteelDark")                     # base collar
    tube(p, 0.56, 0.10, 0.18, "Steel")                      # bulkhead
    ring_band(p, 0.34, 0.52, 0.18, DOCK_H, "SteelLight")    # capture ring
    ring_slabs(p, (0.12, 0.09, 0.07), 0.40, 3, 0.265, "Steel")   # latches
    slab(p, (0.09, 0.05, 0.03), (0.56, 0.0, 0.085), "Accent")    # index mark
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
    1.16 m turbopump on the side of it."""
    r, seg, _ = CLASS["L"]
    p = hc.Parts()
    tube(p, r, 2.42, ENGINE_L_H, "SteelDark", seg=seg)      # mount plate
    tube(p, 0.60, 1.90, 2.42, "Steel", seg=12)              # thrust structure
    ring_slabs(p, (0.16, 0.16, 0.52), 0.90, 4, 2.16, "Steel",
               phase=math.pi * 0.25)
    tube(p, 0.46, 1.55, 1.90, "SteelDark", seg=12)          # throat collar
    # The bell carries the class segment count. It is 2.28 m across, so the
    # module default of 16 would have put a visibly coarser polygon on the
    # biggest curved surface in the file than on the 2.50 m plate above it.
    # The small internal cylinders stay at 12, exactly as engine_main's do:
    # segment count follows DIAMETER, and a 0.46 m throat is not a class face.
    tube(p, 0.72, 0.75, 1.55, "SteelDark", r_top=0.44, seg=seg)   # bell, upper
    tube(p, 1.10, 0.00, 0.75, "SteelDark", r_top=0.72, seg=seg)   # bell, lower
    tube(p, 1.14, 0.00, 0.10, "Steel", seg=seg)             # exit lip
    slab(p, (0.50, 0.36, 0.50), (0.72, 0.0, 2.16), "Steel")  # turbopump
    tube(p, 0.09, 1.66, 2.36, "SteelDark", seg=8, loc=(0.72, 0.26))
    ring_slabs(p, (0.14, 0.14, 0.09), 1.06, 8, 2.465, "Hazard")
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
    azimuth, which is hidden by construction rather than by luck."""
    rl, segl, rbl = CLASS["L"]
    rs, segs, rbs = CLASS["S"]
    z_s = ADAPTER_H - 0.09              # class S collar depth, as fuel_tank's
    p = hc.Parts()
    tube(p, rbl, 0.00, z_s, "SteelLight", r_top=rbs, seg=segl)   # cone
    tube(p, rl, 0.00, 0.14, "SteelDark", seg=segl)          # class L collar
    tube(p, rs, z_s, ADAPTER_H, "SteelDark", seg=segs)      # class S collar
    tube(p, 0.945, 0.45, 0.55, "Accent", r_top=0.885, seg=segl)
    ring_slabs(p, (0.14, 0.14, 0.10), 1.10, 8, 0.19, "SteelDark")
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
    existing, and the player should be able to see which parts do that."""
    p = hc.Parts()
    slab(p, (0.06, 0.36, 0.60), (0.03, 0.0, 0.0), "SteelDark")   # hull saddle
    slab(p, (0.18, 0.26, 0.44), (0.15, 0.0, 0.0), "Steel")       # body
    slab(p, (0.20, 0.28, 0.10), (0.15, 0.0, 0.0), "Hazard")      # band
    slab(p, (0.06, 0.30, 0.50), (0.27, 0.0, 0.0), "SteelDark")   # outboard pad
    for sy in (-1.0, 1.0):
        for sz in (-1.0, 1.0):
            slab(p, (0.05, 0.06, 0.06), (0.03, sy * 0.14, sz * 0.24), "Steel")
    return p


def engine_vernier():
    """A small gimballed thruster on a stub arm, bell facing down."""
    p = hc.Parts()
    slab(p, (0.12, 0.26, 0.26), (0.06, 0.0, 0.0), "SteelDark")
    slab(p, (0.20, 0.13, 0.13), (0.16, 0.0, 0.0), "Steel")
    tube(p, 0.11, -0.02, 0.10, "Steel", seg=8, loc=(0.22, 0.0))
    tube(p, 0.14, -0.30, -0.02, "SteelDark", r_top=0.09, seg=12,
         loc=(0.22, 0.0))
    return p


def landing_leg_bracket():
    """The half of the leg that does NOT move: the hull yoke the strut hinges
    in. It is its own mesh because one Blender Action drives one object, so
    anything that must stay put cannot share a mesh with anything that
    moves."""
    p = hc.Parts()
    slab(p, (0.16, 0.34, 0.42), (0.08, 0.0, 0.0), "SteelDark")
    slab(p, (0.20, 0.10, 0.12), (0.10, 0.0, 0.0), "Steel")
    return p


def landing_leg_strut():
    """The moving half, authored STOWED: folded up flat along the hull.

    The foot pad is built pre-rotated by -LEG_DEPLOY_DEG about Y, so that once
    the deploy clip has rotated the pivot by +LEG_DEPLOY_DEG the pad is exactly
    horizontal and lands flat. Stowed, it lies flat against the tank, which is
    also what a real folded leg does."""
    p = hc.Parts()
    slab(p, (0.14, 0.16, 2.30), (0.20, 0.0, 1.18), "Steel")        # strut
    slab(p, (0.19, 0.21, 0.60), (0.20, 0.0, 0.40), "SteelDark")    # shock
    slab(p, (0.09, 0.09, 1.60), (0.31, 0.0, 1.30), "SteelDark")    # brace
    pad = hc.Parts()
    disc(pad, 0.24, 0.07, (0.0, 0.0, 0.0), "SteelDark", seg=8)
    disc(pad, 0.15, 0.10, (0.0, 0.0, 0.02), "Steel", seg=8)
    pad.rotate("Y", -LEG_DEPLOY_DEG)
    pad.translate(*LEG_PAD_LOC)
    p.extend(pad)
    return p


def fin():
    """A swept delta fin: chord on the stack axis, span radial, thin in Y.

    Written out as eight vertices rather than assembled from primitives,
    because a fin is a single wedge and every primitive version of it is a box
    with two faces in the wrong place."""
    root_t, tip_t = 0.045, 0.020
    v = [(0.00, -root_t, -0.55), (0.00, root_t, -0.55),
         (0.00, root_t, 0.55), (0.00, -root_t, 0.55),
         (0.85, -tip_t, -0.55), (0.85, tip_t, -0.55),
         (0.85, tip_t, -0.05), (0.85, -tip_t, -0.05)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    p = hc.Parts()
    p.add(v, f, [False] * len(f), "SteelLight")
    slab(p, (0.06, 0.10, 1.10), (0.03, 0.0, 0.0), "SteelDark")
    return p


def solar_mount():
    """The fixed half of the solar panel."""
    p = hc.Parts()
    slab(p, (0.16, 0.44, 0.30), (0.08, 0.0, 0.0), "SteelDark")
    slab(p, (0.10, 0.16, 0.16), (0.13, 0.0, 0.0), "Steel")
    return p


def solar_array():
    """The moving half, authored STOWED: folded flat against the hull with the
    CELLS FACING INBOARD.

    That is not a detail. Solar_Deploy rotates the pivot +90 degrees about Y,
    which maps local -X onto world +Z, so cells authored on the inboard face
    are the ones pointing at the sky once the panel is out. Author them
    outboard and the deployed panel presents its back to the star."""
    p = hc.Parts()
    slab(p, (0.06, 0.10, 1.26), (0.055, 0.0, 0.67), "Steel")       # spine
    for z in (0.24, 0.66, 1.08):
        slab(p, (0.030, 0.56, 0.36), (0.0425, 0.0, z), "SuitAccent")
        slab(p, (0.035, 0.56, 0.02), (0.0725, 0.0, z), "SteelDark")
    return p


def rcs_block():
    """Four-nozzle attitude thruster cluster."""
    p = hc.Parts()
    slab(p, (0.10, 0.26, 0.26), (0.05, 0.0, 0.0), "SteelDark")
    slab(p, (0.14, 0.16, 0.16), (0.17, 0.0, 0.0), "Steel")
    for sy in (-1.0, 1.0):
        v, f, sm = of.cyl_data(0.075, 0.12, (0.17, sy * 0.19, 0.0), axis="Y",
                               segments=8, radius_top=0.045)
        p.add(v, f, sm, "SteelDark")
    for sz in (-1.0, 1.0):
        v, f, sm = of.cyl_data(0.075, 0.12, (0.17, 0.0, sz * 0.19), axis="Z",
                               segments=8, radius_top=0.045)
        p.add(v, f, sm, "SteelDark")
    return p
