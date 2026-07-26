"""rocket_common.py - Tier 2 vessel geometry and the 1.25 m STACK CONTRACT.

    build_rocket_parts.py, build_lander_landed.py

THE STACK CONTRACT (ASSET-SPECS 3.3 / 4.23). Everything else in Tier 2
composes out of this, so it is stated once, here, and the validator checks it
per part through contracts.json's `part_sockets` block.

  DIAMETER      Every stack part is exactly 1.25 m across (R = 0.625), so any
                tank, engine, decoupler and pod mate without a per-pair
                adapter. SEG = 16 segments, and 16 matters: a polygon whose
                segment count is divisible by 4 puts vertices exactly on +-X
                and +-Y, so the exported bounding box is exactly 1.25 x 1.25.
                A 14-gon of the same radius measures 1.250 x 1.244 and fails
                the dimension check by 6 mm.

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


R = 0.625                  # stack radius; the 1.25 m standard diameter
SEG = 16                   # divisible by 4 -> the AABB is exactly 2R x 2R
R_BODY = 0.600             # tank/bay barrel, so collars at R read proud

# Material slot order, pinned across all 13 parts. A renderer that wants "the
# glass" or "the state-orange trim" of any part indexes the same slot on every
# one of them. Parts.into() skips roles a part does not use, so passing the
# full list never creates an empty slot.
ROLES = ["SteelLight", "Steel", "SteelDark", "Accent", "Hazard", "Glass",
         "SuitAccent"]

# Deploy geometry, shared with the landed lander so the static assembly and the
# animated part agree to the millimetre.
LEG_DEPLOY_DEG = 125.0     # leg_pivot rotation about +Y, stowed -> deployed
LEG_PAD_LOC = (0.26, 0.0, 1.34)   # foot pad centre, STOWED, leg-pivot local
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


def fuel_tank(height, bands=1):
    """1.25 x 1.25 x `height`. Barrel at R_BODY with collars at R, so the
    1.25 m mating diameter is carried by the RINGS and the barrel reads
    slightly waisted. That is also what keeps the bounding box exact when a
    stringer stands proud of the barrel."""
    p = hc.Parts()
    tube(p, R_BODY, 0.00, height, "SteelLight")
    tube(p, R, 0.00, 0.09, "SteelDark")
    tube(p, R, height - 0.09, height, "SteelDark")
    for i in range(bands):
        z = height * (i + 1) / (bands + 1)
        tube(p, 0.615, z - 0.05, z + 0.05, "Accent")
    # Four stringers at 45 degrees. At R_BODY they never reach +-X or +-Y, so
    # they cannot touch the AABB the collars define.
    ring_slabs(p, (0.10, 0.10, height - 0.30), R_BODY, 4, height * 0.5,
               "Steel", phase=math.pi * 0.25)
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


DECOUPLER_H = 0.25


def decoupler():
    """1.25 x 1.25 x 0.25. The one part whose job is to stop existing, so it
    is the one part banded in hazard yellow."""
    p = hc.Parts()
    tube(p, R_BODY, 0.00, DECOUPLER_H, "SteelDark")
    tube(p, R, 0.00, 0.06, "Steel")
    tube(p, R, DECOUPLER_H - 0.06, DECOUPLER_H, "Steel")
    tube(p, 0.62, 0.09, 0.16, "Hazard")
    ring_slabs(p, (0.08, 0.08, 0.09), 0.58, 6, 0.125, "SteelDark")
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


# ---------------------------------------------------------------------------
# Radial parts. Origin on the mount plane, body extends +X.
# ---------------------------------------------------------------------------

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
    slab(p, (0.14, 0.16, 1.28), (0.20, 0.0, 0.66), "Steel")        # strut
    slab(p, (0.19, 0.21, 0.44), (0.20, 0.0, 0.30), "SteelDark")    # shock
    slab(p, (0.09, 0.09, 0.90), (0.31, 0.0, 0.80), "SteelDark")    # brace
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
