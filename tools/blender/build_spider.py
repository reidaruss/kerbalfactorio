"""build_spider.py - the giant spider, the game's first rigged CREATURE.

    blender --background --python tools/blender/build_spider.py

Produces assets/models/dist/creatures/spider.glb: 28 bones, 2 clips
(Spider_Idle, Spider_Walk), three LODs, no sockets, no collision (the shot
sphere is EnemyTypes.radiusM, not a mesh).

RN-452 (2026-08-01), THE FORM PASS UNDER docs/web/ART-DIRECTION.md. Reid saw
v1 and said "a good start", and then the art direction moved: realistic,
detailed, complex, and "clean" is now a defect. v1 was five smooth tubes, six
cubes and eight smooth wires, 1,060 triangles, and rendered on a neutral floor
it is a clay blob on stilts with nothing to look at at any distance. This
version is 3,450: a carapace with an overhanging margin, five overlapping
tergites, a real pedicel waist, eight coxal sockets, chelicerae with the jaw
behind the fang, pedipalps, eight domed eyes in two rows, six spinnerets,
thirty bristles and legs with twice the mass and a pinched knee. Every bone
name, every clip name and every landmark constant below is UNCHANGED.

THE PROPORTIONS ARE ALREADY A CONTRACT. web/src/game/EnemyArt.ts (RN-122)
ships a procedural far-LOD stand-in authored TO this asset: knees arching to
~1.55 m, feet on a 2.4 m radius, azimuths 35/70/110/145, body mass ~2.2 m
long topping ~1.15 m.

That contract is NARROWER than it reads, and RN-452 measured which half is
real. `EnemyArt.creatureGeometry` is not this file at a lower LOD: it is five
boxes and sixteen limb boxes built in TypeScript, and the ONLY things the two
representations share are HIP_Y 0.62, KNEE_Y 1.55, KNEE_R 1.05, FOOT_R 2.4 and
the four azimuths. So the claim boundary swaps animation and not shape only to
the extent of those five numbers, and NO amount of silhouette work in this
file reaches the far swarm. Those five are frozen here; everything else on the
creature was free to move, and did. Re-authoring the far stand-in against this
form is a client-lane follow-up and is named in the report.

THE BODY MASS MAY NOT GROW, AND THAT IS WHY THE LEGS DID. Admin's ruling is
that a creature is never drawn larger than the body combat resolves against.
The client draws this asset at scale = EnemyTypes.bodyRadiusM, at most 1.25
over the shipped catalogue, so the largest spider in the game has a 2.50 m
shot sphere against a body mass that already spans 1.895 m authored, i.e.
2.37 m drawn. There is under 130 mm of headroom and the abdomen is not allowed
to take it. Legs are the opposite case and EnemyArt says so in its own
comment: a leg deliberately overreaches the hit sphere because a leg is
silhouette and not target. So the leg is where the mass went.

THE WALK SPEED IS ALSO A CONTRACT. web/src/game/SpiderFlock.ts declares
SPIDER_WALK_MPS = 2.5 and retimes the clip against it; a clip authored at any
other speed is the "animates but slides" failure. So 2.5 is DECLARED here and
the stance sweep angle is DERIVED from it: while a foot is planted the coxa
yaws at constant angular rate (rig_common.ramp, not wave - a sine has no foot
plant and skates, see rig_common.leg_ik's docstring), sweeping an arc of
exactly walk_mps * stance_seconds at the foot's lever radius.

THE IDLE KEEPS THE FEET FIXED. The client asserts it, so it is a contract:
no Coxa/Femur/Tibia rotation may displace a foot tip more than ~1 cm. The
breathing therefore lives on the Abdomen (no leg children) and the Head, and
the Thorax counter-sway is CANCELLED on every coxa: the coxa counter-rotates
by the thorax's own angle, so a foot only moves by the coxa HEAD's travel
about the thorax pivot, which is millimetres and is printed at build time.

DERIVE, NEVER COPY. Every part is dimensioned off the named landmark
constants below: leg roots come from the cephalothorax's authored half-width,
fangs and eyes from the head landmark, knees and feet from one radius each.
Two parts independently restating a dimension is this project's catalogued
defect class.

Skinning, LODs, clip frame numbering and the rest-pose export all follow
build_player_body.py exactly (DW-7, DW-34): bone-heat is probed honestly and
expected to fail on a pile of tubes, the shipping weights are
of_lib.solve_weights inside per-leg MeshBuilder.bind whitelists, LOD copies
are decimated AFTER weighting so they inherit the vertex groups, and the
armature exports at rest with every clip relative to it.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import rig_common as rc  # noqa: E402

NAME = "Spider"
OUT = of.dist_path("creatures", "spider.glb")

# The creature palette. Injected at runtime rather than edited into of_lib's
# PALETTE: these four roles belong to exactly one asset, and of_lib.PALETTE is
# the shared game-wide surface set. Same tuple shape, same get_material path.
of.PALETTE.update({
    # very dark desaturated chitin; the body reads as silhouette
    "Chitin":      ("2B2126", 0.00, 0.75, 1.0, None),
    # lighter warm underside: the belly and the light-catching leg blend
    "ChitinUnder": ("5C5049", 0.00, 0.80, 1.0, None),
    "Fang":        ("D8CCB4", 0.00, 0.55, 1.0, None),
    # warm, glossy: roughness 0.12 is what makes the eyes catch the light
    "EyeGlow":     ("FFB347", 0.00, 0.12, 1.0, None),
})
CHITIN, UNDER, FANG, EYE = "Chitin", "ChitinUnder", "Fang", "EyeGlow"

# ---------------------------------------------------------------------------
# Landmarks. Blender axes: +Z up, -Y forward. The spider stands on z = 0,
# faces -Y, and its legs radiate from the origin so the foot ring is symmetric
# fore-and-aft and the measured bounding box centres itself (pivot 'ground').
# ---------------------------------------------------------------------------

CEPH_C = (0.0, -0.26, 0.60)      # cephalothorax centre: front mass, low, flat
CEPH_HALF_W = 0.33               # its authored half-width, the leg-root source
ABD_C = (0.0, 0.62, 0.84)        # abdomen centre: the heavier rear bulb
HEAD_TIP = (0.0, -0.96, 0.52)    # front of the head cluster; fangs hang off it

LEG_ROOT_Z = 0.62                # coxa heads at the thorax rim height
RIM_R = CEPH_HALF_W - 0.03       # leg-root radius, derived from the rim
COXA_OUT = 0.30                  # coxa segment length, radially outward
COXA_Z = 0.95                    # coxa tail height (the leg is already rising)
KNEE_R = 1.05                    # knee radius (EnemyArt KNEE_R)
KNEE_Z = 1.55                    # knee peak (EnemyArt KNEE_Y): sells "massive"
FOOT_R = 2.40                    # foot radius (EnemyArt FOOT_R)
FOOT_Z = 0.02                    # foot tip centre; the 0.015 tip grazes z = 0
TIP_R = 0.015                    # feet end in points

# Leg azimuths, degrees from forward (-Y): leg 1 forward-out to leg 4
# rear-out. Symmetric about 90, which with origin-centred radii is what makes
# the foot ring symmetric in y.
AZIMUTH_DEG = (35.0, 70.0, 110.0, 145.0)

SIDES = (("L", 1.0), ("R", -1.0))


def leg_u(az_deg, s):
    """Horizontal unit vector of one leg: outward at `az_deg` from forward."""
    a = math.radians(az_deg)
    return (s * math.sin(a), -math.cos(a))


def radial(u, r, z):
    return (u[0] * r, u[1] * r, z)


# ---------------------------------------------------------------------------
# Skeleton: 28 bones as (name, head, tail, parent). Root and the two body
# masses hang off Root; the head off the thorax; each leg is a three-bone
# chain Coxa <- Thorax. The spider skeleton lives HERE, not in rig_common:
# that file is the player skeleton contract.
# ---------------------------------------------------------------------------

def _spider_bones():
    bones = [
        ("Root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.14), None),
        ("Abdomen", (0.0, 0.06, 0.68), (0.0, 0.95, 0.86), "Root"),
        ("Thorax", (0.0, CEPH_C[1], CEPH_C[2]), (0.0, -0.70, 0.58), "Root"),
        ("Head", (0.0, -0.70, 0.55), (0.0, -1.00, 0.50), "Thorax"),
    ]
    for pre, s in SIDES:
        for i, az in enumerate(AZIMUTH_DEG, start=1):
            u = leg_u(az, s)
            hip = radial(u, RIM_R, LEG_ROOT_Z)
            c2 = radial(u, RIM_R + COXA_OUT, COXA_Z)
            knee = radial(u, KNEE_R, KNEE_Z)
            foot = radial(u, FOOT_R, FOOT_Z)
            n = "%s%d" % (pre, i)
            bones += [(n + "Coxa", hip, c2, "Thorax"),
                      (n + "Femur", c2, knee, n + "Coxa"),
                      (n + "Tibia", knee, foot, n + "Femur")]
    return bones


SPIDER_BONES = _spider_bones()


def leg_bones(pre, i):
    return ["%s%d%s" % (pre, i, part) for part in ("Coxa", "Femur", "Tibia")]


# ---------------------------------------------------------------------------
# Deterministic noise. A four-line LCG rather than harvest_common.rng, and the
# duplication is deliberate: harvest_common is the ORGANIC PROP library and is
# edited by three other lanes, so importing it would make this character's
# shipped bytes a function of a file this lane does not own. NUMBERS.md's
# fifth sweep is exactly that shape (a generated artifact laundering another
# lane's uncommitted edit), and the cheapest defence is not to read the file.
# ---------------------------------------------------------------------------

def rng(seed):
    """Seeded LCG returning floats in [0, 1). Numerical Recipes constants.

    Not `random`: the stdlib stream is a language implementation detail, and a
    build whose bytes depend on the Python build cannot be reviewed by diff."""
    state = [(seed * 2654435761) & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state[0] / 4294967296.0
    return nxt


# ---------------------------------------------------------------------------
# Geometry vocabulary
#
# ART-DIRECTION.md, 2026-08-01: realistic, detailed, complex, and "clean" is a
# defect. The v1 body was five smooth tubes and six cubes; rendered, it is a
# clay blob on six smooth wires with nothing to look at anywhere. What follows
# is the same landmark skeleton wearing a chitin vocabulary, and the ordering
# is deliberate: the two mechanisms that cost NOTHING come first.
#
#   1. FLAT SIDES (zero triangles). rig_common.oval_tube's new smooth_sides
#      flag. A smooth-shaded 8-gon claims a cylinder it does not have and lits
#      as one even gradient; the same triangles flat-shaded give eight hard
#      lit values. This is most of the difference between chitin and clay.
#   2. THE STEPPED RING PROFILE (two rings where there was one). Two rings
#      18 mm apart with a 30 mm radius drop is an annular lip: a hard shadow
#      line right round the body and a step in the silhouette. Four of them
#      down the abdomen is tergite banding, and it is watertight, which a pile
#      of separate scute plates is not. Borrowed from rock_form's bedding
#      ledge (RN-241), which is where this trick was measured.
#   3. THE BRIM. A second flattened tube through the carapace at rim height,
#      wider than the dome, so the carapace MARGIN overhangs and the eight legs
#      emerge from underneath it instead of out of a smooth egg.
#   4. Everything that genuinely costs: sockets, knuckles, mouthparts, eyes,
#      spinnerets, spines.
# ---------------------------------------------------------------------------

def spike(base, tip, r_base, r_tip=0.0035, seg=3):
    """One bristle or leg spine: a three-sided taper, 8 triangles.

    Bristles are the detail this asset most obviously lacked and the one that
    cannot be faked by a normal map at the distance the player fights at, so
    they are geometry. Three sides is the cheapest thing that still has a
    silhouette; at 8 triangles each, twenty of them cost less than one leg."""
    return rc.tube([base, tip], [r_base, r_tip], seg=seg, smooth_sides=False)


def eye_dome(centre, normal, r, seg=5):
    """One eye: a raised dome, 16 triangles, SMOOTH.

    Smooth here and flat almost everywhere else, on purpose. An eye is the one
    part of a spider that is genuinely a polished convex sphere, and the
    v1 asset used axis-aligned CUBES, which is why the eyes read as painted
    dots rather than as anything that catches a light."""
    n = math.sqrt(sum(c * c for c in normal)) or 1.0
    apex = tuple(centre[k] + normal[k] / n * r * 1.30 for k in range(3))
    return rc.tube([centre, apex], [r, r * 0.44], seg=seg)


# The eight legs, as ONE tube each with a ring at every landmark joint and at
# every place the profile has something to say. (radius from the origin,
# height, tube radius). Rings 1, 3, 6 and 11 are the Coxa head, Femur head,
# Knee and foot: those four are the BONE joints and may not move, because the
# ring at a joint is where the 50/50 weight blend lands (rig_common's whole
# argument for a tube over a box) and because FOOT_R sets the walk clip's
# lever arm.
#
# THE KNEE IS A CORNER NOW, NOT AN ARC. Rings 6 and 7 are 55 mm apart across
# the apex, which creases the tube instead of letting parallel transport round
# it off, and rings 5 and 8 swell either side of the crease. A spider's
# patella is a hard angular knuckle, and v1's smooth arc over a single ring is
# the single strongest reason those legs read as bent wire.
#
# THE LEG IS TWICE AS THICK AS v1 AND THE JOINTS ARE PINCHES BETWEEN
# SWELLINGS. v1's femur was 64 mm of radius over a 2.10 m reach, i.e. 3% of
# its own length, which is a harvestman. A hunting spider's femur is nearer
# 10%, and "massive" is a proportion before it is a size: the landmark
# constants below (the knee at 1.55, the foot at 2.40) are a CROSS-LANE
# contract with EnemyArt.ts and cannot move, so the only axis left to make the
# creature heavy is the one perpendicular to the leg. The joints then have to
# come back the other way, because a limb of constant thickness reads as pipe:
# the trochanter (ring 2) and the knee (rings 6, 7) are hard pinches with a
# swelling either side, which is what a chitinous joint actually is.
#
# THE KNEE PINCH IS ALSO WHAT KEEPS THE DECLARED HEIGHT. A 100 mm knuckle
# centred on KNEE_Z would put the top of the asset at 1.65 and grow the drawn
# creature by 3%; a 52 mm ring at the joint with 100 mm knuckles either side
# reads as a bigger knee and measures 1.6049, under v1's 1.6054.
LEG_RINGS = (
    (0.150, 0.600, 0.104),   # buried root: no leg can float off the body
    (RIM_R, LEG_ROOT_Z, 0.150),          # BONE JOINT: coxa head, a ball
    (0.430, 0.752, 0.090),   # trochanter pinch
    (RIM_R + COXA_OUT, COXA_Z, 0.138),   # BONE JOINT: femur head
    (0.860, 1.360, 0.120),   # femur mid
    (0.975, 1.503, 0.108),   # patella knuckle, under the apex
    (KNEE_R, KNEE_Z, 0.052),             # BONE JOINT: knee apex, front of crease
    (1.105, 1.512, 0.055),   # knee apex, back of crease
    (1.210, 1.395, 0.104),   # tibia shoulder knuckle
    (1.620, 0.900, 0.086),   # tibia
    (2.020, 0.400, 0.058),   # metatarsus
    (2.230, 0.150, 0.042),   # ANKLE: the metatarsus/tarsus knuckle
    (2.340, 0.060, 0.028),   # tarsus, laid nearly flat
    (FOOT_R, 0.014, 0.010),              # BONE JOINT: tarsal claw
)
# THE LAST THREE RINGS ARE A FOOT, NOT A POINT. v1 ran a straight line from
# the knee to a 15 mm needle tip, so eight legs ended in hypodermics and the
# creature stood on stilts. A real spider's tarsus lies almost flat and grips:
# rings 11 to 13 break the line into an ankle knuckle, a near-horizontal
# tarsus and a claw, which puts CONTACT under the creature and is most of what
# separates "heavy thing walking" from "thing balanced on wires". The claw
# still ends exactly on FOOT_R, because that radius is the walk clip's lever
# arm and the far stand-in's foot ring.
LEG_SEG = 8
# Per (side, leg, ring) radius wobble. Rock_form's ring_jit (RN-241) applied to
# a limb: re-rolling a small factor per ring bends each side quad so the
# exporter splits it into two triangles with different normals, which doubles
# the lit facet count for zero triangles AND breaks the mirror symmetry that
# makes eight identical legs read as eight copies of one leg. Only the RADIUS
# is jittered, never the ring's position: the positions are the walk clip's
# lever arithmetic and the skin blend points. 0.040 rather than a rounder
# number is the knee ring's own budget: 0.052 * 1.04 puts the top of the asset
# at 1.6040, which is the last value under v1's measured 1.6054.
LEG_JIT = 0.040

# Where the leg spines sit, as (ring index, outward lean, downward lean,
# PROTRUSION in metres past the leg surface, base radius). The lean pair is a
# direction and is normalised, so the fourth number is a length and not a
# scale factor: a spine authored as a scale factor is mostly buried inside the
# limb it grows out of, which is the first version of this table and it read
# as a row of pimples.
#
# The front two leg pairs get three spines and the rear two get two. That is
# not decoration: the forward legs of a hunting spider carry the prey-capture
# spination, and it gives an eight-fold radial silhouette a FRONT.
LEG_SPINES = ((4, 0.42, -0.90, 0.115, 0.016),
              (8, 0.62, -0.78, 0.095, 0.013),
              (9, 0.70, -0.72, 0.075, 0.010))


def leg_points(pre, s, i, az):
    """(points, radii) for one leg, with the seeded per-ring wobble applied."""
    u = leg_u(az, s)
    nxt = rng(hash_seed(pre, i))
    pts, rad = [], []
    for r, z, tr in LEG_RINGS:
        pts.append(radial(u, r, z))
        rad.append(tr * (1.0 + (nxt() * 2.0 - 1.0) * LEG_JIT))
    return pts, rad


def hash_seed(pre, i):
    """A stable integer per leg. Ordinal arithmetic, so it cannot depend on
    the platform's string hashing (PYTHONHASHSEED randomises that)."""
    return (ord(pre[0]) * 977 + i * 131 + 7) & 0xFFFF


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def build_mesh(name, arm):
    mb = of.MeshBuilder()
    cy, cz = CEPH_C[1], CEPH_C[2]
    ay, az_ = ABD_C[1], ABD_C[2]
    hy, hz = HEAD_TIP[1], HEAD_TIP[2]

    # --- carapace: a domed plate sitting ON an overhanging margin ---------
    # Two tubes, and the second one is the whole read. The dome alone is v1's
    # egg; the brim is 40 mm wider than the dome at every station, so the
    # carapace has an EDGE, that edge throws a shadow onto the legs under it,
    # and the eight leg roots come out from beneath a plate rather than out of
    # the side of a balloon.
    mb.bind(["Thorax"])
    mb.add_raw(*rc.oval_tube(
        [(0, cy - 0.400, cz - 0.055), (0, cy - 0.255, cz + 0.010),
         (0, cy - 0.090, cz + 0.042), (0, cy + 0.075, cz + 0.048),
         (0, cy + 0.235, cz + 0.020), (0, cy + 0.395, cz - 0.035)],
        [0.090, 0.160, 0.196, 0.202, 0.175, 0.090],
        [0.130, 0.235, 0.290, 0.298, 0.250, 0.128],
        seg=10, smooth_sides=False), role=CHITIN)
    mb.add_raw(*rc.oval_tube(
        [(0, cy - 0.420, cz - 0.047), (0, cy - 0.250, cz - 0.041),
         (0, cy - 0.080, cz - 0.037), (0, cy + 0.090, cz - 0.037),
         (0, cy + 0.250, cz - 0.045), (0, cy + 0.400, cz - 0.059)],
        [0.028, 0.034, 0.036, 0.036, 0.032, 0.024],
        [0.150, 0.268, 0.325, CEPH_HALF_W + 0.004, 0.280, 0.145],
        seg=8, smooth_sides=False), role=CHITIN)
    # the fovea: a raised midline keel that dips where the thoracic groove is.
    # It is what stops the top of the carapace, the largest single unbroken
    # area on the creature, from being a blank.
    mb.add_raw(*rc.oval_tube(
        [(0, cy - 0.230, cz + 0.170), (0, cy - 0.060, cz + 0.216),
         (0, cy + 0.090, cz + 0.198), (0, cy + 0.250, cz + 0.128)],
        [0.036, 0.044, 0.030, 0.020],
        [0.030, 0.038, 0.026, 0.016],
        seg=6, smooth_sides=False), role=CHITIN)
    for k, (bx, by, bz, ln) in enumerate(((0.150, -0.130, 0.150, 0.205),
                                          (-0.150, -0.130, 0.150, 0.205),
                                          (0.115, 0.190, 0.140, 0.175),
                                          (-0.115, 0.190, 0.140, 0.175))):
        mb.add_raw(*spike((bx, cy + by, cz + bz),
                          (bx * 1.55, cy + by - 0.045, cz + bz + ln),
                          0.011), role=CHITIN)

    # --- sternum: the hard ventral plate the eight coxae ring -------------
    mb.add_raw(*rc.oval_tube(
        [(0, cy - 0.330, cz - 0.150), (0, cy - 0.160, cz - 0.185),
         (0, cy + 0.020, cz - 0.192), (0, cy + 0.200, cz - 0.176),
         (0, cy + 0.340, cz - 0.140)],
        [0.048, 0.062, 0.066, 0.058, 0.040],
        [0.105, 0.170, 0.185, 0.160, 0.098],
        seg=8, smooth_sides=False), role=UNDER)

    # --- eight coxal sockets: a flared sleeve the leg turns inside -------
    # Bound to the THORAX, not to the leg, which is the point: the leg yaws
    # 27.28 degrees through the walk and the socket does not move with it, so
    # the joint reads as a joint. The inner ring is buried under the brim so
    # its open cap cannot be seen; the outer ring pinches down onto the leg,
    # which closes the annulus a straight sleeve would leave open.
    for pre, s in SIDES:
        for i, az in enumerate(AZIMUTH_DEG, start=1):
            u = leg_u(az, s)
            mb.add_raw(*rc.tube(
                [radial(u, 0.310, LEG_ROOT_Z + 0.004),
                 radial(u, 0.380, LEG_ROOT_Z + 0.024),
                 radial(u, 0.450, LEG_ROOT_Z + 0.048)],
                [0.168, 0.150, 0.118], seg=6, closed_caps=False,
                smooth_sides=False), role=CHITIN)

    # --- pedicel: the waist. A spider's two body masses are joined by a
    # STALK, and v1 had them merged into one continuous lump, which is most of
    # why the silhouette read as a beetle rather than as a spider.
    mb.bind(["Thorax", "Abdomen"])
    mb.add_raw(*rc.tube(
        [(0, cy + 0.280, cz + 0.008), (0, 0.115, 0.655), (0, ay - 0.400, 0.716)],
        [0.106, 0.070, 0.104], seg=6, smooth_sides=False), role=CHITIN)

    # --- abdomen: five overlapping tergites off ONE stepped tube ----------
    # Each pair of rings 18 mm apart with a radius drop is a plate whose rear
    # edge overhangs the plate behind it. Four steps, watertight, 80 triangles
    # more than v1's smooth egg, and it is the whole segmentation read.
    mb.bind(["Abdomen"])
    ab = ((-0.470, -0.170, 0.095, 0.110),
          (-0.330, -0.055, 0.243, 0.306),
          (-0.310, -0.048, 0.196, 0.248),
          (-0.125, +0.012, 0.308, 0.406),
          (-0.105, +0.016, 0.250, 0.338),
          (+0.105, +0.024, 0.318, 0.454),
          (+0.125, +0.020, 0.256, 0.380),
          (+0.320, -0.006, 0.270, 0.388),
          (+0.340, -0.012, 0.212, 0.312),
          (+0.510, -0.070, 0.168, 0.238),
          (+0.615, -0.130, 0.075, 0.105))
    mb.add_raw(*rc.oval_tube([(0, ay + d, az_ + dz) for d, dz, _, _ in ab],
                             [ru for _, _, ru, _ in ab],
                             [rv for _, _, _, rv in ab],
                             seg=10, smooth_sides=False), role=CHITIN)
    # the lighter venter, one plate under the abdomen only (v1 ran one mass
    # under BOTH body segments, which is what filled the waist in)
    mb.add_raw(*rc.oval_tube(
        [(0, ay - 0.330, az_ - 0.230), (0, ay - 0.100, az_ - 0.290),
         (0, ay + 0.160, az_ - 0.285), (0, ay + 0.420, az_ - 0.205)],
        [0.070, 0.086, 0.080, 0.052],
        [0.190, 0.245, 0.220, 0.130],
        seg=8, smooth_sides=False), role=UNDER)
    # spinnerets: three pairs of different lengths at the rear, plus the anal
    # tubercle above them. Nothing else on the creature says "spider" from
    # behind, and the rear is what the player sees while it walks away.
    for sx, dy, dz, ln, r in ((0.052, 0.640, -0.180, 0.135, 0.030),
                              (-0.052, 0.640, -0.180, 0.135, 0.030),
                              (0.090, 0.612, -0.130, 0.100, 0.024),
                              (-0.090, 0.612, -0.130, 0.100, 0.024),
                              (0.032, 0.628, -0.245, 0.090, 0.021),
                              (-0.032, 0.628, -0.245, 0.090, 0.021)):
        mb.add_raw(*rc.tube(
            [(sx, ay + dy, az_ + dz),
             (sx * 1.20, ay + dy + ln * 0.86, az_ + dz - ln * 0.38)],
            [r, r * 0.55], seg=4, smooth_sides=False), role=CHITIN)
    mb.add_raw(*eye_dome((0.0, ay + 0.628, az_ - 0.055), (0.0, 1.0, 0.3),
                         0.048, seg=6), role=CHITIN)
    # dorsal bristles. Two of them are BROKEN OFF (blunt, half length): the
    # asset ships one seed and eight of these are on screen at once, so the
    # only asymmetry available is asymmetry inside the body itself.
    # Every base below is authored INSIDE the tergite it grows from, by 15 to
    # 30 mm against the interpolated ring profile. A spike seated on the
    # nominal surface floats wherever the profile steps between its two
    # rings, and a field of floating fragments is exactly the defect the
    # Hills scree prop shipped with at RN-246.
    nxt = rng(4409)
    for k, (bx, by, bz) in enumerate(((0.105, -0.240, 0.200), (-0.115, -0.215, 0.210),
                                      (0.155, 0.010, 0.264), (-0.150, 0.020, 0.266),
                                      (0.120, 0.245, 0.238), (-0.135, 0.235, 0.238),
                                      (0.060, 0.430, 0.128), (-0.070, 0.420, 0.133),
                                      (0.000, -0.120, 0.272), (0.010, 0.150, 0.268))):
        broken = k in (3, 6)
        ln = (0.090 if broken else 0.215) * (0.85 + 0.30 * nxt())
        mb.add_raw(*spike((bx, ay + by, az_ + bz),
                          (bx * 1.45, ay + by - 0.055, az_ + bz + ln),
                          0.013, r_tip=0.010 if broken else 0.0035),
                   role=CHITIN)

    # --- head: capsule, eye tubercle, eight eyes, chelicerae, fangs, palps -
    mb.bind(["Head"])
    mb.add_raw(*rc.oval_tube(
        [(0, hy + 0.400, hz + 0.060), (0, hy + 0.240, hz + 0.055),
         (0, hy + 0.100, hz + 0.020), (0, hy + 0.000, hz - 0.010)],
        [0.115, 0.140, 0.115, 0.070],
        [0.150, 0.185, 0.150, 0.088],
        seg=8, smooth_sides=False), role=CHITIN)
    # the ocular tubercle: the eyes sit on a RAISED boss, which is what gives
    # the front of the head a brow and the eye cluster somewhere to be
    mb.add_raw(*rc.oval_tube(
        [(0, hy + 0.230, hz + 0.150), (0, hy + 0.120, hz + 0.168),
         (0, hy + 0.030, hz + 0.130)],
        [0.052, 0.062, 0.044],
        [0.105, 0.128, 0.090],
        seg=6, smooth_sides=False), role=CHITIN)
    # EIGHT eyes in the two rows a spider actually has, not six cubes: a big
    # anterior median pair, a smaller anterior lateral pair, and a posterior
    # row of four set back on the tubercle.
    for x, dy, dz, r in ((0.040, 0.055, 0.150, 0.030), (-0.040, 0.055, 0.150, 0.030),
                         (0.100, 0.080, 0.135, 0.022), (-0.100, 0.080, 0.135, 0.022),
                         (0.048, 0.175, 0.205, 0.019), (-0.048, 0.175, 0.205, 0.019),
                         (0.112, 0.195, 0.178, 0.016), (-0.112, 0.195, 0.178, 0.016)):
        mb.add_raw(*eye_dome((x, hy + dy, hz + dz),
                             (x * 0.9, -0.55, 0.45), r), role=EYE)
    for _, s in SIDES:
        # the paturon: the heavy basal segment the fang folds against. v1 had
        # a fang and no jaw behind it, which is why the mouth read as two
        # toothpicks glued to a face.
        mb.add_raw(*rc.oval_tube(
            [(s * 0.078, hy + 0.115, hz + 0.030),
             (s * 0.096, hy + 0.035, hz - 0.075),
             (s * 0.106, hy - 0.030, hz - 0.170),
             (s * 0.100, hy - 0.058, hz - 0.245)],
            [0.070, 0.078, 0.062, 0.040],
            [0.062, 0.070, 0.056, 0.036],
            seg=6, smooth_sides=False), role=CHITIN)
        mb.add_raw(*rc.tube(
            [(s * 0.100, hy - 0.055, hz - 0.245),
             (s * 0.098, hy - 0.090, hz - 0.340),
             (s * 0.082, hy - 0.082, hz - 0.418),
             (s * 0.062, hy - 0.048, hz - 0.466)],
            [0.032, 0.024, 0.014, 0.005], seg=5), role=FANG)
        # pedipalps, and the LEFT one is a segment short. A creature the
        # player meets eight of at once cannot be mirror-perfect and still
        # look alive; this is the largest asymmetry the silhouette can carry
        # without reading as a modelling error.
        cut = 0.72 if s > 0 else 1.0
        mb.add_raw(*rc.tube(
            [(s * 0.140, hy + 0.340, hz - 0.020),
             (s * 0.205, hy + 0.160, hz - 0.140),
             (s * 0.215, hy - 0.020, hz - 0.240),
             (s * (0.215 - 0.030 * cut), hy - 0.020 - 0.140 * cut,
              hz - 0.240 + 0.040 * cut),
             (s * (0.215 - 0.065 * cut), hy - 0.020 - 0.240 * cut,
              hz - 0.240 + 0.100 * cut)],
            [0.055, 0.046, 0.036, 0.028, 0.018], seg=5,
            smooth_sides=False), role=CHITIN)
    # the labium, between the jaws
    mb.add_raw(*rc.tube(
        [(0, hy + 0.070, hz - 0.060), (0, hy + 0.010, hz - 0.135),
         (0, hy - 0.020, hz - 0.200)],
        [0.052, 0.044, 0.028], seg=5, smooth_sides=False), role=UNDER)

    # --- eight legs ------------------------------------------------------
    for pre, s in SIDES:
        for i, az in enumerate(AZIMUTH_DEG, start=1):
            u = leg_u(az, s)
            pts, rad = leg_points(pre, s, i, az)
            mb.bind(leg_bones(pre, i))
            mb.add_raw(*rc.tube(pts, rad, seg=LEG_SEG, smooth_sides=False),
                       role=CHITIN)
            for ring, out, down, ln, r in LEG_SPINES[:3 if i <= 2 else 2]:
                d = (u[0] * out, u[1] * out, down)
                dn = math.sqrt(sum(c * c for c in d))
                d = tuple(c / dn for c in d)
                c0, seat = pts[ring], rad[ring] * 0.55
                mb.add_raw(*spike(
                    tuple(c0[k] + d[k] * seat for k in range(3)),
                    tuple(c0[k] + d[k] * (rad[ring] + ln) for k in range(3)),
                    r), role=CHITIN)

    mb.bind(None)
    return mb, mb.build(name, arm)


# ---------------------------------------------------------------------------
# Clips. Both authored through of.pose_clip; keys are 1-based and authored
# frame 1 exports at t = 0 (of_lib.clip_frame, DW-34).
# ---------------------------------------------------------------------------

IDLE_N = 121                     # 2.0 s at 60 fps: (121 - 1) / 60
WALK_N = 49                      # 0.8 s: (49 - 1) / 60

# The declared ground speed of the walk cycle at unit scale. MUST equal
# web/src/game/SpiderFlock.ts SPIDER_WALK_MPS; the stance sweep is derived
# from it, never the other way round.
SPIDER_WALK_MPS = 2.5
STANCE_FRAC = 0.5                # alternating tetrapod: each foot half down
WALK_CYCLE_S = (WALK_N - 1) / 60.0
# Every foot sits at the same lever radius from its own coxa head (both are
# radial from the origin), so ONE sweep angle serves all eight legs and no
# planted foot fights another.
FOOT_LEVER_M = FOOT_R - RIM_R
SWEEP_RAD = SPIDER_WALK_MPS * WALK_CYCLE_S * STANCE_FRAC / FOOT_LEVER_M

LIFT_DEG = 15.0                  # swing knee lift (spec: 12 to 18)
TUCK_DEG = 8.0                   # tibia fold under the lifted knee


def leg_phi(az, s):
    """The leg's horizontal direction as an angle from +X, degrees. Used to
    conjugate a lift rotation onto the leg's own azimuth axis."""
    u = leg_u(az, s)
    return math.degrees(math.atan2(u[1], u[0]))


def lift_rot(phi, deg):
    """Ordered rotation about the horizontal axis perpendicular to a leg at
    azimuth angle `phi`: Rz(phi) @ Ry(-deg) @ Rz(-phi), innermost first.
    Positive `deg` lifts the distal end."""
    return [("Z", -phi), ("Y", -deg), ("Z", phi)]


def walk_legs():
    """Alternating-tetrapod gait: L1,R2,L3,R4 in phase, R1,L2,R3,L4 in
    antiphase. Stance is a STRAIGHT LINE in yaw (rc.ramp): the planted foot
    sweeps backward at constant angular rate, which is the whole difference
    between a walk and a skate."""
    h = math.degrees(SWEEP_RAD) * 0.5
    t = {}
    for pre, s in SIDES:
        for i, az in enumerate(AZIMUTH_DEG, start=1):
            ph = 0.0 if ((i % 2 == 1) == (pre == "L")) else 0.5
            phi = leg_phi(az, s)
            names = leg_bones(pre, i)

            def yaw(x, ph=ph, s=s):
                p = (x + ph) % 1.0
                return s * rc.ramp(p, [(0.0, -h), (STANCE_FRAC, h), (1.0, -h)])

            def swing(x, ph=ph):
                p = (x + ph) % 1.0
                if p <= STANCE_FRAC:
                    return 0.0
                u = (p - STANCE_FRAC) / (1.0 - STANCE_FRAC)
                return math.sin(math.pi * u)

            t[names[0]] = {"rot": rc.keys(
                WALK_N, WALK_N - 1, lambda x, yaw=yaw: [("Z", yaw(x))])}
            t[names[1]] = {"rot": rc.keys(
                WALK_N, WALK_N - 1,
                lambda x, sw=swing, phi=phi: lift_rot(phi, LIFT_DEG * sw(x)))}
            t[names[2]] = {"rot": rc.keys(
                WALK_N, WALK_N - 1,
                lambda x, sw=swing, phi=phi: lift_rot(phi, -TUCK_DEG * sw(x)))}
    return t


def clip_walk(n=WALK_N):
    t = walk_legs()
    # body: a bob at twice the cycle rate (two tetrapod strikes per cycle),
    # a slight thorax yaw sway, and the abdomen answering the bob late
    t["Root"] = {"loc": rc.keys(
        n, n - 1, lambda x: (0.0, 0.0, rc.wave(x, 0.02, cycles=2.0)))}
    t["Thorax"] = {"rot": rc.keys(
        n, n - 1, lambda x: (0.0, 0.0, rc.wave(x, 2.0)))}
    t["Abdomen"] = {"rot": rc.keys(
        n, n - 1, lambda x: (rc.wave(x, 1.5, cycles=2.0, phase=0.2), 0.0, 0.0))}
    t["Head"] = {"rot": rc.keys(
        n, n - 1, lambda x: (0.0, 0.0, rc.wave(x, -1.5)))}
    return t


def clip_idle(n=IDLE_N):
    """Two-second breathing loop with the feet pinned. The thorax sway is
    cancelled on every coxa (same armature-space axis, opposite sign), so a
    foot only inherits the coxa HEAD's few-millimetre travel about the thorax
    pivot; the Femur and Tibia carry no keys at all."""
    thorax_amp = 0.8
    t = {
        "Abdomen": {"rot": rc.keys(n, 8, lambda x: (rc.wave(x, 2.0), 0, 0))},
        "Thorax": {"rot": rc.keys(
            n, 8, lambda x: (rc.wave(x, -thorax_amp), 0, 0))},
        "Head": {"rot": rc.keys(
            n, 8, lambda x: (rc.wave(x, 1.2, phase=0.12), 0,
                             rc.wave(x, 0.8, cycles=0.5)))},
        "Root": {"loc": rc.keys(n, 8, lambda x: (0, 0, rc.wave(x, 0.01)))},
    }
    for pre, s in SIDES:
        for i in range(1, 5):
            t[leg_bones(pre, i)[0]] = {"rot": rc.keys(
                n, 8, lambda x: (rc.wave(x, thorax_amp), 0, 0))}
    # the residual foot drift the cancellation leaves: the coxa head's arc
    # about the thorax pivot's armature-X axis. Printed so "the idle keeps the
    # feet fixed" is a measured statement, not a hope.
    ty, tz = CEPH_C[1], CEPH_C[2]
    worst = 0.0
    for az in AZIMUTH_DEG:
        u = leg_u(az, 1.0)
        hy, hz = u[1] * RIM_R, LEG_ROOT_Z
        r = math.hypot(hy - ty, hz - tz)
        worst = max(worst, r * math.radians(thorax_amp))
    print("[spider] idle residual foot drift %.4f m from the thorax sway "
          "(plus the 0.010 m root bob), contract is ~0.01" % worst)
    return t


CLIPS = [("Spider_Idle", clip_idle), ("Spider_Walk", clip_walk)]


# ---------------------------------------------------------------------------

def main():
    of.reset_scene()
    # The armature IS the asset root, as on the player: every mesh is inside
    # the thing that animates it, and the client clones the bone subtree.
    arm_obj = of.add_armature(NAME, SPIDER_BONES)

    mb, lod0 = build_mesh(NAME + "_LOD0", arm_obj)

    # DW-7 step 1: try Blender's own automatic weights, honestly, first.
    probe = mb.build(NAME + "_AutoWeightProbe", arm_obj)
    auto_ok, auto_note = of.skin_auto(probe, arm_obj)
    print("[spider] bone-heat automatic weights: %s %s"
          % ("SUCCEEDED" if auto_ok else "FAILED", auto_note))
    bpy.data.objects.remove(probe, do_unlink=True)

    segs = of.bone_segments(SPIDER_BONES)
    groups = of.solve_weights(mb.verts, mb.vert_bones, segs)
    sums = [0.0] * len(mb.verts)
    for bone, pairs in groups.items():
        for i, w in pairs:
            sums[i] += w
    print("[spider] scripted weights: %d verts, %d bones used, "
          "weight sum %.4f to %.4f" % (len(mb.verts), len(groups),
                                       min(sums), max(sums)))
    of.bind_skin(lod0, arm_obj, groups)

    # Organic form, so decimation is the right LOD tool (ASSET-SPECS 2.4).
    # Copies made AFTER weighting so they inherit the vertex groups.
    lod1 = of.add_lod_decimate(lod0, 1, 0.55, parent=arm_obj)
    lod2 = of.add_lod_decimate(lod0, 2, 0.30, parent=arm_obj)
    for o in (lod1, lod2):
        of.bind_skin(o, arm_obj)

    for cname, fn in CLIPS:
        of.pose_clip(arm_obj, cname, fn())

    print("[spider] SPIDER_WALK_MPS %.3f m/s at unit scale: %.3f m lever * "
          "%.2f deg stance sweep over %.3f s planted"
          % (FOOT_LEVER_M * SWEEP_RAD / (WALK_CYCLE_S * STANCE_FRAC),
             FOOT_LEVER_M, math.degrees(SWEEP_RAD),
             WALK_CYCLE_S * STANCE_FRAC))

    # Leave the armature unposed so nothing but the rest pose can be baked
    # into the joint nodes; export_rest_position_armature is belt and braces.
    if arm_obj.animation_data:
        arm_obj.animation_data.action = None
    bpy.context.scene.frame_set(int(of.clip_frame(1)))

    lo, hi = mb.bounds()
    print("[spider] bounds blender x %.4f..%.4f  y %.4f..%.4f  z %.4f..%.4f"
          % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    print("[spider] envelope three.js xyz [%.4f, %.4f, %.4f]"
          % (hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]))
    of.report(NAME, [("LOD0", mb)])
    print("[spider] clips: %d, bones: %d" % (len(CLIPS), len(SPIDER_BONES)))
    of.export_glb(OUT)


import bpy  # noqa: E402

if __name__ == "__main__":
    main()
