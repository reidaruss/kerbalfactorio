"""build_spider.py - the giant spider, the game's first rigged CREATURE.

    blender --background --python tools/blender/build_spider.py

Produces assets/models/dist/creatures/spider.glb: 28 bones, 2 clips
(Spider_Idle, Spider_Walk), three LODs, no sockets, no collision (the shot
sphere is EnemyTypes.radiusM, not a mesh).

THE PROPORTIONS ARE ALREADY A CONTRACT. web/src/game/EnemyArt.ts (RN-122)
ships a procedural far-LOD stand-in authored TO this asset: knees arching to
~1.55 m, feet on a 2.4 m radius, azimuths 35/70/110/145, body mass ~2.2 m
long topping ~1.15 m. A creature crossing the SpiderFlock claim boundary
swaps ANIMATION, not SHAPE, so those numbers are landmarks here, not taste.

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
# Geometry
# ---------------------------------------------------------------------------

def build_mesh(name, arm):
    mb = of.MeshBuilder()

    # --- cephalothorax: lower and flatter than the abdomen ---
    cy, cz = CEPH_C[1], CEPH_C[2]
    mb.bind(["Thorax"])
    mb.add_raw(*rc.oval_tube(
        [(0, cy - 0.40, cz - 0.05), (0, cy - 0.22, cz - 0.00),
         (0, cy + 0.02, cz + 0.02), (0, cy + 0.28, cz - 0.00),
         (0, cy + 0.40, cz - 0.04)],
        [0.10, 0.17, 0.20, 0.17, 0.10],
        [0.16, 0.26, CEPH_HALF_W, 0.28, 0.14], seg=10), role=CHITIN)

    # --- abdomen: the heavier bulb, raked upward toward the rear ---
    ay, az_ = ABD_C[1], ABD_C[2]
    mb.bind(["Abdomen"])
    mb.add_raw(*rc.oval_tube(
        [(0, ay - 0.55, az_ - 0.14), (0, ay - 0.30, az_ - 0.04),
         (0, ay + 0.00, az_ + 0.00), (0, ay + 0.30, az_ + 0.00),
         (0, ay + 0.54, az_ - 0.06)],
        [0.14, 0.27, 0.31, 0.27, 0.10],
        [0.18, 0.34, 0.45, 0.35, 0.12], seg=10), role=CHITIN)

    # --- the lighter underbelly, one mass under both body segments ---
    mb.bind(["Thorax", "Abdomen"])
    mb.add_raw(*rc.oval_tube(
        [(0, -0.52, 0.44), (0, -0.12, 0.42), (0, 0.36, 0.46), (0, 0.80, 0.55)],
        [0.09, 0.12, 0.13, 0.09],
        [0.20, 0.26, 0.30, 0.20], seg=8), role=UNDER)

    # --- head cluster at the front, everything hung off HEAD_TIP ---
    hy, hz = HEAD_TIP[1], HEAD_TIP[2]
    mb.bind(["Head"])
    mb.add_raw(*rc.oval_tube(
        [(0, hy + 0.34, hz + 0.02), (0, hy + 0.16, hz + 0.04),
         (0, hy + 0.00, hz + 0.00)],
        [0.10, 0.13, 0.08],
        [0.13, 0.17, 0.10], seg=8), role=CHITIN)
    # two chelicera prongs, down-forward from the head tip
    for _, s in SIDES:
        mb.add_raw(*rc.tube(
            [(s * 0.085, hy + 0.06, hz - 0.06),
             (s * 0.110, hy - 0.07, hz - 0.19),
             (s * 0.125, hy - 0.12, hz - 0.34)],
            [0.040, 0.030, 0.010], seg=5), role=FANG)
    # six eye bumps on the head's front-top, two rows. Boxes are the only
    # axis-aligned faces in the whole asset and they only ever meet the curved
    # head surface, which is what keeps check_coplanar at zero by geometry
    # rather than by allowance.
    for x, dy, dz, r in ((0.042, 0.045, 0.075, 0.021),
                         (-0.042, 0.045, 0.075, 0.021),
                         (0.096, 0.075, 0.045, 0.017),
                         (-0.096, 0.075, 0.045, 0.017),
                         (0.033, 0.115, 0.114, 0.014),
                         (-0.033, 0.115, 0.114, 0.014)):
        mb.box((r * 2, r * 2, r * 2), (x, hy + dy, hz + dz), role=EYE)

    # --- eight legs: ONE tube each, hip to toe, with a ring at every joint
    # (rig_common's argument: the ring is where the 50/50 blend lands, so the
    # bend happens AT the joint). The first point is buried inside the body so
    # no leg root can float; the taper runs 0.09 at the coxa to a 0.015 point.
    for pre, s in SIDES:
        for i, az in enumerate(AZIMUTH_DEG, start=1):
            u = leg_u(az, s)
            mid_r = (KNEE_R + FOOT_R) * 0.5
            mid_z = (KNEE_Z + FOOT_Z) * 0.5
            mb.bind(leg_bones(pre, i))
            mb.add_raw(*rc.tube(
                [radial(u, RIM_R * 0.55, LEG_ROOT_Z - 0.01),
                 radial(u, RIM_R, LEG_ROOT_Z),
                 radial(u, RIM_R + COXA_OUT, COXA_Z),
                 radial(u, KNEE_R, KNEE_Z),
                 radial(u, mid_r, mid_z),
                 radial(u, FOOT_R, FOOT_Z)],
                [0.085, 0.090, 0.078, 0.056, 0.036, TIP_R], seg=7),
                role=CHITIN)

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
