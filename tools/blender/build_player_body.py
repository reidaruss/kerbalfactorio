"""build_player_body.py - the third-person player, the only rigged Tier-0 asset.

    blender --background --python tools/blender/build_player_body.py

Produces assets/models/dist/player/player_body.glb (ASSET-SPECS 4.1).

44 bones, 14 clips, six bone-parented sockets, three LODs.

THE SKELETON IS FROZEN. BODY_BONES head/tail coordinates and SHOULDER_Z /
HIP_Z / EYE_Z are a published interface: a second armour asset is authored
against these exact coordinates, socket_head_cam sits at EYE_Z and /core
composes the observer as feet plus eye height, and the declared 1.80 x 1.80
envelope is bone-driven. Change the geometry over the skeleton, never the
skeleton.

HOW IT IS SKINNED (decision DW-7). Bone-heat automatic weights are attempted
first and are expected to fail: they solve a Laplacian over a closed manifold
and this character, like every asset in this game, is a pile of intersecting
tubes and boxes. The weights that ship come from of_lib.solve_weights - bone
segment distance inside a per-part whitelist (MeshBuilder.bind). The whitelist
is what makes it work: an arm tube considers only that arm's chain, so the
elbow gets a proper 50/50 blend while the left thigh structurally cannot pick
up weight from the right one.

HOW THE CLIPS ARE AUTHORED. The rest pose is a T-pose, because that is the
Mixamo retarget contract. Every clip therefore starts by bringing the arms
down: an upper-arm pose is ("Y", 76) to hang it, then ("X", swing) to swing
what now hangs, in that order (of_lib.pose_clip). Negative swing is forward.
Angles are armature-space degrees, so +X is the character's left, -Y is
forward and +Z is up everywhere.

WALK AND RUN ARE SOLVED, NOT SAMPLED (2026-07-27). They used to be one sine
per joint with the legs in antiphase, and a sine has no foot plant: it moves
the thigh FASTEST at the passing pose, which is exactly when the foot is on
the ground and has to be travelling backward at a constant ground speed, and
slowest at the extremes, where the foot is in the air and should be whipping
through. That is the skate, and it cannot be tuned out because the shape is
wrong. `_gait` authors the ANKLE PATH instead - a straight line backward
through the contact phase, at exactly the speed the clip is retimed against -
and rig_common.leg_ik solves hip and knee from it. Foot and ToeBase then carry
a real heel strike and toe-off; both were unkeyed in every locomotion clip
before, which is why the feet read as paddles.

Run matters most: the player moves at 4.6 m/s (Controller.ts:33) against a
3.0 m/s run threshold (AnimGraph.ts:44), so Run is the clip that plays
essentially all the time, at timeScale 4.6/4.5 = 1.02.

WHY THE EXPORTED POSE IS THE REST POSE, NOT FRAME 1. ASSET-SPECS 2.7 says a
clip's frame 1 must be the identity, because the exporter bakes the evaluated
pose into the node TRS. A walk cycle's frame 1 is mid-stride and cannot be the
identity, so the rigged form of that rule is export_rest_position_armature:
joints export at bind, every clip is relative to it, and validate_glb.py's
rest_pose check proves it by multiplying each joint's world matrix by its own
inverse bind matrix and demanding the identity.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import rig_common as rc  # noqa: E402

NAME = "Player"
OUT = of.dist_path("player", "player_body.glb")

SIDES = (("Left", 1.0), ("Right", -1.0))
SUIT, ACC, DARK, GLASS, SKIN, EM = ("Suit", "SuitAccent", "SteelDark",
                                    "Glass", "Skin", "EmissiveState")
GLOVE, PLATE = "SuitDark", "Plate"

# The two speeds the client retimes these clips against, straight off
# AnimGraph.ts:41-42. They live here because a gait authored to the wrong
# speed skates no matter how good the curve is.
WALK_CLIP_MPS = 1.4
RUN_CLIP_MPS = 4.5


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def build_mesh(name, arm):
    mb = of.MeshBuilder()

    # --- pelvis and the hip tool loop the stowed pickaxe hangs from ---
    mb.bind(["Hips"])
    mb.add_raw(*rc.stack([((0, 0, 0.840), 0.165, 0.115),
                          ((0, 0, 0.950), 0.175, 0.120),
                          ((0, 0, 1.060), 0.160, 0.110)]), role=SUIT)
    mb.add_raw(*of.box_data((0.045, 0.100, 0.100), (-0.195, 0.010, 0.930)),
               role=DARK)
    # belt: one dark band across the waist, which is what stops the torso and
    # the pelvis reading as one continuous white cylinder at 20 m
    mb.add_raw(*of.box_data((0.360, 0.250, 0.055), (0.0, 0.0, 1.045)),
               role=GLOVE)
    mb.add_raw(*of.box_data((0.090, 0.030, 0.070), (0.0, -0.125, 1.045)),
               role=PLATE)

    # --- torso: wide on top, narrow at the waist. The 'engineer' read ---
    mb.bind(["Hips", "Spine", "Spine1", "Spine2", "Neck"])
    mb.add_raw(*rc.stack([((0, 0, 1.060), 0.160, 0.108),
                          ((0, 0, 1.200), 0.175, 0.112),
                          ((0, 0, 1.340), 0.200, 0.118),
                          ((0, 0, 1.450), 0.205, 0.115),
                          ((0, 0, 1.500), 0.150, 0.095)]), role=SUIT)
    # flank panels, proud of the taper: a rib on the silhouette from the front
    mb.bind(["Spine", "Spine1", "Spine2"])
    for _, s in SIDES:
        mb.add_raw(*of.box_data((0.032, 0.150, 0.290), (s * 0.192, 0.0, 1.245)),
                   role=GLOVE)

    # --- chest pack, its two recessed vents, and the state indicator ---
    # Bound rigidly to Spine2: it is a hard box, and a hard box that deforms
    # when the spine bends looks broken in a way a soft shape does not. It is
    # OF_Plate now rather than OF_Suit: a white pack on a white torso is
    # invisible at 20 m, which is where this asset is usually seen.
    mb.bind(["Spine2"])
    mb.add_raw(*of.box_data((0.300, 0.095, 0.260), (0.0, -0.1525, 1.300)),
               role=PLATE)
    mb.add_raw(*of.box_data((0.320, 0.030, 0.040), (0.0, -0.150, 1.185)),
               role=ACC)
    # Four narrow slots, not two wide panels: two wide dark rectangles merge
    # into one black blob at 20 m and the chest stops reading as a machine.
    for sx in (-3, -1, 1, 3):
        mb.add_raw(*of.box_data((0.032, 0.020, 0.120),
                                (sx * 0.042, -0.188, 1.320)), role=DARK)
    mb.add_raw(*of.box_data((0.070, 0.020, 0.035), (0.0, -0.190, 1.395)),
               role=EM)

    # --- the back pack. The declared depth envelope went 0.39 to 0.46
    # specifically to buy this: the old back was a 55 mm slab and read as a
    # flat plate. Body, lid, two proud tanks and the straps that carry it.
    # The tanks set the asset's rearmost point at y = +0.240 exactly.
    mb.add_raw(*of.box_data((0.310, 0.100, 0.340), (0.0, 0.150, 1.290)),
               role=PLATE)
    mb.add_raw(*of.box_data((0.270, 0.090, 0.048), (0.0, 0.140, 1.484)),
               role=GLOVE)
    for _, s in SIDES:
        mb.add_raw(*of.cyl_data(0.048, 0.250, (s * 0.090, 0.192, 1.285),
                                "Z", 10), role=SUIT)
        mb.add_raw(*of.box_data((0.058, 0.230, 0.048),
                                (s * 0.118, 0.020, 1.438)), role=GLOVE)
    mb.add_raw(*of.box_data((0.170, 0.055, 0.090), (0.0, 0.128, 1.115)),
               role=DARK)

    # --- the accent stripe, shoulder to hip, following the torso taper so it
    # never floats off the surface ---
    mb.bind(["Hips", "Spine", "Spine1", "Spine2"])
    for _, s in SIDES:
        mb.add_raw(*rc.stack([((s * 0.150, -0.050, 1.000), 0.012, 0.038),
                              ((s * 0.178, -0.050, 1.220), 0.012, 0.038),
                              ((s * 0.196, -0.050, 1.420), 0.012, 0.038)]),
                   role=ACC)

    for pre, s in SIDES:
        # shoulder pad, sized to sit ON the thickened upper arm rather than
        # inside it
        mb.bind([pre + "Shoulder", pre + "Arm"])
        mb.add_raw(*rc.tube([(s * 0.130, 0, 1.430), (s * 0.180, 0, 1.462),
                             (s * 0.235, 0, 1.436)],
                            [0.100, 0.106, 0.092], seg=8), role=ACC)
        # arm: ONE tube shoulder to wrist, with a ring exactly on the elbow.
        # Thicker at the shoulder than it was (0.078 -> 0.088), because a thin
        # tube hanging off a boxy torso is the proportion that read wrong.
        mb.bind([pre + "Shoulder", pre + "Arm", pre + "ForeArm", pre + "Hand"])
        mb.add_raw(*rc.tube([(s * 0.170, 0, 1.45), (s * 0.310, 0, 1.45),
                             (s * 0.450, 0, 1.45), (s * 0.575, 0, 1.45),
                             (s * 0.700, 0, 1.45)],
                            [0.088, 0.078, 0.066, 0.058, 0.050], seg=10),
                   role=SUIT)
        mb.bind([pre + "Arm", pre + "ForeArm"])
        # TEN segments, not eight, and it has to match the arm it covers.
        # Two coaxial polygons only nest cleanly if one's circumradius clears
        # the other's inradius, and the cheap way to guarantee that is to give
        # them the same segment count. The arm reaches 0.0681 across this band,
        # so the band's 10-gon inradius (0.076 * cos(pi/10) = 0.0723) clears it
        # by 4 mm. check_mating.py's coaxial pass asserts this; it is the check
        # that found the original 8-gon-over-10-gon sawtooth.
        mb.add_raw(*of.cyl_data(0.076, 0.050, (s * 0.450, 0, 1.45), "X", 10),
                   role=DARK)

        # --- the hand. A palm is roughly twice as wide as it is thick, and a
        # round one can never read as a hand from any angle: the old glove was
        # a 0.105 x 0.095 box with three finger blocks and it read as a mitt in
        # first person AND at 5 m in third. So: an elliptical palm widening to
        # a knuckle line, a proud knuckle plate, four separate finger tubes and
        # a thumb, on the same three frozen bone chains. The Middle chain
        # carries three finger tubes; a tube offset from the chain it is
        # whitelisted to still curls with it, so this costs no bones.
        mb.bind([pre + "ForeArm", pre + "Hand"])
        mb.add_raw(*of.cyl_data(0.058, 0.028, (s * 0.700, 0, 1.45), "X", 10),
                   role=ACC)
        mb.add_raw(*rc.oval_tube([(s * 0.688, 0.000, 1.450),
                                  (s * 0.735, 0.012, 1.450),
                                  (s * 0.785, 0.022, 1.449),
                                  (s * 0.818, 0.026, 1.448)],
                                 [0.050, 0.050, 0.047, 0.040],
                                 [0.054, 0.066, 0.072, 0.064], seg=8),
                   role=GLOVE)
        mb.bind([pre + "Hand"])
        mb.add_raw(*rc.oval_tube([(s * 0.748, 0.014, 1.482),
                                  (s * 0.788, 0.022, 1.485),
                                  (s * 0.818, 0.026, 1.481)],
                                 [0.016, 0.017, 0.013],
                                 [0.056, 0.062, 0.054], seg=6), role=PLATE)
        # thumb: already on its own axis in the frozen rig (it runs +X and -Y
        # while the fingers run +X flat), which is exactly what makes it read
        mb.bind([pre + "Hand"] + rc.finger_bones(pre, ["Thumb"]))
        mb.add_raw(*rc.tube([(s * 0.752, -0.029, 1.436),
                             (s * 0.800, -0.045, 1.432),
                             (s * 0.838, -0.056, 1.429),
                             (s * 0.868, -0.062, 1.427)],
                            [0.022, 0.024, 0.022, 0.019], seg=6), role=GLOVE)
        mb.bind([pre + "Hand"] + rc.finger_bones(pre, ["Index"]))
        mb.add_raw(*rc.tube([(s * 0.782, -0.012, 1.453),
                             (s * 0.830, -0.011, 1.450),
                             (s * 0.868, -0.010, 1.447),
                             (s * 0.898, -0.010, 1.445)],
                            [0.020, 0.021, 0.019, 0.016], seg=6), role=GLOVE)
        mb.bind([pre + "Hand"] + rc.finger_bones(pre, ["Middle"]))
        for dy, rad, tip in ((0.018, 0.021, 0.898), (0.046, 0.0195, 0.884),
                             (0.072, 0.017, 0.856)):
            mb.add_raw(*rc.tube([(s * 0.782, dy, 1.451),
                                 (s * 0.830, dy + 0.002, 1.448),
                                 (s * ((0.830 + tip) * 0.5), dy + 0.003, 1.446),
                                 (s * tip, dy + 0.004, 1.444)],
                                [rad * 0.95, rad, rad * 0.9, rad * 0.8], seg=6),
                       role=GLOVE)

    # --- helmet: chamfered cylinder, ring, wide visor band, lamp, comm fin ---
    mb.bind(["Head"])
    mb.add_raw(*rc.tube([(0, 0, 1.530), (0, 0, 1.580), (0, 0, 1.700),
                         (0, 0, 1.755), (0, 0, 1.800)],
                        [0.098, 0.125, 0.125, 0.105, 0.055], seg=10),
               role=SUIT)
    mb.add_raw(*of.cyl_data(0.130, 0.028, (0, 0, 1.552), "Z", 10), role=PLATE)
    mb.add_raw(*of.arc_band_data(0.118, 0.136, 0.075, (0, 0, 1.660),
                                 -142.0, -38.0, 8), role=GLASS)
    # the fin tops out at exactly z = 1.800, the same as the helmet crown, so
    # the declared 1.80 m height stays bone-and-crown driven
    mb.add_raw(*of.box_data((0.030, 0.150, 0.058), (0.0, 0.020, 1.771)),
               role=PLATE)
    mb.add_raw(*of.arc_band_data(0.126, 0.140, 0.090, (0, 0, 1.640),
                                 48.0, 132.0, 6), role=GLOVE)
    mb.add_raw(*of.box_data((0.050, 0.032, 0.032), (0.0, -0.126, 1.742)),
               role=EM)
    mb.add_raw(*of.box_data((0.100, 0.070, 0.055), (0.0, -0.068, 1.545)),
               role=SKIN)
    mb.bind(["Neck", "Head", "Spine2"])
    mb.add_raw(*of.cyl_data(0.058, 0.100, (0, 0, 1.500), "Z", 8), role=SKIN)

    # --- legs: tapered tube with a ring on the knee, and a boot that has a
    # separate TOE, because ToeBase is a real bone and the locomotion clips
    # now drive it. A one-piece boot cannot roll from heel strike to toe-off.
    for pre, s in SIDES:
        # THE COLOUR BREAK IS COAXIAL, NOT A PANEL BOLTED ON THE FRONT. The
        # first attempt hung flat OF_Plate boxes off the thigh and shin for
        # contrast; they sheared straight off the leg at the knee in Run and
        # Walk, because a rigid box whitelisted across a joint gets a 50/50
        # distance blend down its middle and is torn in half. A tube segment
        # coaxial with the limb takes the same weights the limb does and bends
        # with it, so the break is a white thigh into a dark shin with a
        # OF_Plate knee band straddling the joint, and every ring stays round.
        mb.bind(["Hips", pre + "UpLeg", pre + "Leg"])
        mb.add_raw(*rc.tube([(s * 0.10, 0.000, 0.950), (s * 0.10, 0.000, 0.790),
                             (s * 0.10, 0.000, 0.630), (s * 0.10, 0.000, 0.510)],
                            [0.105, 0.097, 0.086, 0.078], seg=10), role=SUIT)
        mb.bind([pre + "UpLeg", pre + "Leg", pre + "Foot"])
        mb.add_raw(*rc.tube([(s * 0.10, 0.000, 0.545), (s * 0.10, 0.000, 0.400),
                             (s * 0.10, 0.000, 0.255), (s * 0.10, -0.005, 0.130)],
                            [0.090, 0.078, 0.069, 0.060], seg=10), role=GLOVE)
        # knee band: a ring exactly ON the joint, ten segments to match the
        # leg, and an inradius of 0.0951 against a leg that reaches 0.090
        mb.bind([pre + "UpLeg", pre + "Leg"])
        mb.add_raw(*rc.tube([(s * 0.10, 0.000, 0.565), (s * 0.10, 0.000, 0.510),
                             (s * 0.10, 0.000, 0.462)],
                            [0.096, 0.100, 0.094], seg=10), role=PLATE)

        # boot: heel block on Foot, toe block on ToeBase, overlapping across
        # the joint so the roll never opens a crack
        mb.bind([pre + "Leg", pre + "Foot"])
        mb.add_raw(*rc.stack([((s * 0.10, -0.010, 0.024), 0.076, 0.100),
                              ((s * 0.10, -0.010, 0.075), 0.078, 0.100),
                              ((s * 0.10, 0.000, 0.140), 0.072, 0.078),
                              ((s * 0.10, 0.005, 0.190), 0.064, 0.062)]),
                   role=GLOVE)
        mb.add_raw(*of.box_data((0.160, 0.200, 0.024),
                                (s * 0.10, 0.000, 0.012)), role=DARK)
        mb.bind([pre + "Foot", pre + "ToeBase"])
        mb.add_raw(*rc.stack([((s * 0.10, -0.075, 0.020), 0.074, 0.062),
                              ((s * 0.10, -0.140, 0.026), 0.070, 0.062),
                              ((s * 0.10, -0.182, 0.048), 0.062, 0.038)]),
                   role=GLOVE)
        mb.add_raw(*of.box_data((0.150, 0.150, 0.022),
                                (s * 0.10, -0.145, 0.011)), role=DARK)
        mb.bind([pre + "Foot"])
        mb.add_raw(*of.box_data((0.120, 0.030, 0.060),
                                (s * 0.10, 0.048, 0.100)), role=PLATE)

    mb.bind(None)
    return mb, mb.build(name, arm)


# ---------------------------------------------------------------------------
# Pose vocabulary. Every clip is written in these four verbs.
# ---------------------------------------------------------------------------

def arm(s, down, swing=0.0, out=0.0):
    """Upper arm. down 0 is the T-pose, 76 hangs it, negative raises it.
    swing is forward (negative) or back (positive) AFTER it hangs; out
    abducts it sideways."""
    return [("Y", s * down), ("X", swing), ("Y", s * out)]


def elbow(s, bend):
    """Forearm. The bend axis in the forearm's own rest frame is Z, because
    the rest frame is the T-pose and the parent's pose is inherited."""
    return [("Z", -s * bend)]


def curl(s, deg):
    return [("Y", s * deg)]


def thumb(s, deg):
    return [("Z", -s * deg)]


def hand_pose(t, grip=0.0, spread=0.0):
    """Finger tracks for one hand at one frame. grip 0 is open, 1 is a fist
    around a tool haft."""
    out = {}
    for pre, s in SIDES:
        for i, b in enumerate(rc.finger_bones(pre, ["Index", "Middle"])):
            out[b] = {"rot": [(t, curl(s, 18 + 42 * grip - spread * 10))]}
        for b in rc.finger_bones(pre, ["Thumb"]):
            out[b] = {"rot": [(t, thumb(s, 10 + 30 * grip))]}
    return out


def both_arms(track, keyframes):
    """keyframes: [(frame, down, swing, out, bend), ...] applied to both arms
    symmetrically, which is what a two-handed tool swing is."""
    for pre, s in SIDES:
        track[pre + "Arm"] = {"rot": [(f, arm(s, d, sw, o))
                                      for f, d, sw, o, _ in keyframes]}
        track[pre + "ForeArm"] = {"rot": [(f, elbow(s, b))
                                          for f, _, _, _, b in keyframes]}
    return track


# ---------------------------------------------------------------------------
# The fourteen clips
# ---------------------------------------------------------------------------

def clip_idle(n=121):
    """Two-second breathing cycle. Deliberately tiny: a big idle reads as a
    fidget, and this character is standing in a factory, not on a stage."""
    t = {
        "Spine1": {"rot": rc.keys(n, 8, lambda x: (rc.wave(x, 1.4), 0, 0))},
        "Spine2": {"rot": rc.keys(n, 8, lambda x: (rc.wave(x, -1.0), 0, 0))},
        "Head": {"rot": rc.keys(n, 8, lambda x: (rc.wave(x, 1.1, phase=0.12),
                                                 rc.wave(x, 0.8, cycles=0.5), 0))},
        "Hips": {"loc": rc.keys(n, 8, lambda x: (0, 0, rc.wave(x, 0.006)))},
    }
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(
            n, 8, lambda x, s=s: arm(s, 76 + rc.wave(x, 1.2), -4, 1.5))}
        t[pre + "ForeArm"] = {"rot": [(1, elbow(s, 12))]}
    t.update(hand_pose(1, grip=0.15))
    return t


def _rot2(y, z, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return (y * c - z * s, y * s + z * c)


# The sole, as (y, z) offsets from the ANKLE (the Foot bone head, rest z 0.100).
# The heel and the ball ride the Foot bone; the toe pad rides ToeBase, which
# hinges at (-0.100, -0.065) from the ankle.
_HEEL = (0.100, -0.100)
_BALL = (-0.100, -0.100)
_TOE_HINGE = (-0.100, -0.065)
_TOE_PAD = ((-0.020, -0.035), (-0.120, -0.035))


def sole_ankle_z(ank, toe):
    """Ankle height that lands the lowest point of the ROLLING sole on z = 0.

    Authoring an ankle height and an ankle angle independently is what put the
    toe 30 mm through the ground at frame 3 of the first attempt: a foot
    pitched 6 degrees toe-down about an ankle held at its rest height does not
    have its sole on the floor. So the angle is authored - heel strike, flat,
    heel lift, toe-off - and the height is SOLVED from it. Whatever the roll,
    the lowest sole point is exactly on the ground, by construction."""
    pts = [_rot2(y, z, ank) for y, z in (_HEEL, _BALL)]
    hy, hz = _rot2(_TOE_HINGE[0], _TOE_HINGE[1], ank)
    for y, z in _TOE_PAD:
        ty, tz = _rot2(y, z, ank + toe)
        pts.append((hy + ty, hz + tz))
    return -min(p[1] for p in pts)


def _gait(n, mps, contact, strike, lift, lift_bias,
          lean, swing, bend, hips_knots, push, toe_push, sway, yaw,
          samples=None):
    """One locomotion cycle, solved from an authored ANKLE PATH.

    n            frames. Frame 1 and frame n are the same pose, so the period
                 is (n - 1) intervals: 25 frames is 0.400 s at 60 fps, not
                 0.4167. Getting that wrong is a 4% skate on its own.
    mps          the ground speed the client retimes this clip against
                 (AnimGraph WALK_CLIP_MPS / RUN_CLIP_MPS). The contact-phase
                 foot velocity is set to exactly this.
    contact      fraction of the cycle each foot spends on the ground. Below
                 0.5 there is a flight phase, which is what makes it a run.
    strike       how far in front of the hip the ankle lands, metres.
    lift         peak ankle height during the swing
    hips_knots   ramp knots for the hips' vertical offset over HALF a cycle,
                 since both legs do the same thing half a cycle apart. This is
                 what decides whether the leg can actually REACH the authored
                 foot position, so it is authored, not derived from a sine.

    The contact phase is a straight line: the ankle moves backward relative to
    the hip at exactly `mps`, so the planted foot is stationary in the world
    while the character translates. That single property is the whole fix.

    THE LEAN IS NOT ON THE HIPS. It used to be, and it silently broke the
    solve: a rotation on Hips is inherited by UpLeg, so an 11 degree run lean
    put the whole leg 11 degrees further back than the IK asked for and pitched
    the sole 11 degrees toe-down, which drove the toe 30 mm into the ground.
    The lean lives on the spine chain now, above the legs, where a lean belongs.
    """
    # ONE KEY PER FRAME. rc.keys samples fn(i / samples) but places the key at
    # `1 + round((n - 1) * i / samples)`, so unless (n - 1) / samples is a whole
    # number the sampled VALUE and the frame it lands on disagree: at 16
    # samples over 25 frames the key for phase 0.0625 was written to frame 3,
    # which is phase 0.0833. That alone made the contact-phase foot velocity
    # swing between 1.7 and 6.6 m/s around a 4.5 m/s target. A key on every
    # frame removes the question, and it costs nothing in the exported file
    # because export_force_sampling bakes per frame anyway.
    samples = (n - 1) if samples is None else samples
    cycle_s = (n - 1) / 60.0
    travel = mps * cycle_s * contact
    toe_off = strike - travel
    strike_z = sole_ankle_z(-14.0, 0.0)
    lift_off_z = sole_ankle_z(push, -toe_push)

    def hips_z(x):
        return rc.ramp((x % 0.5) / 0.5, hips_knots)

    def hip_shift(x, side):
        """(forward, up) displacement of ONE hip socket caused by the pelvis
        rotating, relative to the pelvis centre.

        The UpLeg head sits 0.10 m off the midline, so a pelvis yaw carries it
        fore and aft and a pelvis roll carries it up and down. leg_ik solves
        the ankle relative to the HIP, so without this the yaw quietly stole
        12 mm out of every contact phase - a 2.3% skate that survived every
        other fix, because the foot path was right and the hip was moving."""
        yaw_r = math.radians(rc.wave(x, yaw, phase=0.25))
        roll_r = math.radians(rc.wave(x, 2.0))
        return (-side * 0.10 * math.sin(yaw_r),
                -side * 0.10 * math.sin(roll_r))

    def roll(p):
        """(ankle pitch, toe hinge) in degrees at this leg's own phase.
        Positive ankle is toe-down; negative toe hinge lifts the heel off a
        toe that is still flat on the ground."""
        if p < contact:
            q = p / contact
            return (rc.ramp(q, [(0.0, -14.0), (0.16, 0.0), (0.55, 0.0),
                                (0.72, push * 0.28), (1.0, push)]),
                    rc.ramp(q, [(0.0, 0.0), (0.55, 0.0),
                                (0.72, -toe_push * 0.25), (1.0, -toe_push)]))
        u = (p - contact) / (1.0 - contact)
        return (rc.ramp(u, [(0.0, push), (0.18, 10.0), (0.55, -8.0),
                            (1.0, -14.0)]),
                rc.ramp(u, [(0.0, -toe_push), (0.25, -4.0), (0.70, 0.0),
                            (1.0, 0.0)]))

    def ankle(p):
        """(forward offset from the hip, world height) at this leg's own phase."""
        ank, toe = roll(p)
        if p < contact:
            q = p / contact
            return strike - travel * q, sole_ankle_z(ank, toe)
        u = (p - contact) / (1.0 - contact)
        e = 0.5 - 0.5 * math.cos(math.pi * u ** 0.9)
        z = (lift_off_z + (strike_z - lift_off_z) * u
             + (lift - lift_off_z) * math.sin(math.pi * u ** lift_bias) ** 1.4)
        return toe_off + travel * e, z

    reach = [0.0]

    def leg(x, ph, side):
        p = (x + ph) % 1.0
        f, z = ankle(p)
        dfwd, dup = hip_shift(x, side)
        f = f - dfwd
        drop = 0.920 + hips_z(x) + dup - z
        reach[0] = max(reach[0], math.sqrt(f * f + drop * drop))
        hip_deg, knee_deg, shank = rc.leg_ik(f, drop)
        ank, toe = roll(p)
        # `shank` cancels the accumulated thigh+knee rotation, so `ank` is the
        # foot's angle to the GROUND rather than to the shin.
        return hip_deg, knee_deg, shank + ank, toe

    t = {}
    for pre, s, ph in (("Left", 1.0, 0.0), ("Right", -1.0, 0.5)):
        t[pre + "UpLeg"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph, s=s: (leg(x, ph, s)[0], 0, 0))}
        t[pre + "Leg"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph, s=s: (leg(x, ph, s)[1], 0, 0))}
        t[pre + "Foot"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph, s=s: (leg(x, ph, s)[2], 0, 0))}
        t[pre + "ToeBase"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph, s=s: (leg(x, ph, s)[3], 0, 0))}
        # the arm counter-swings the OPPOSITE leg, so it is most forward half a
        # cycle after its own side's heel strike
        t[pre + "Arm"] = {"rot": rc.keys(
            n, samples, lambda x, s=s, ph=ph: arm(
                s, 76, rc.wave(x, swing, phase=0.25 + ph), 3))}
        t[pre + "ForeArm"] = {"rot": rc.keys(
            n, samples, lambda x, s=s, ph=ph: elbow(
                s, bend - bend * 0.42 * rc.wave(x, 1.0, phase=0.25 + ph)))}
    t["Hips"] = {
        "loc": rc.keys(n, samples, lambda x: (rc.wave(x, sway, phase=0.25),
                                              0.0, hips_z(x))),
        "rot": rc.keys(n, samples, lambda x: (0.0, rc.wave(x, 2.0),
                                              rc.wave(x, yaw, phase=0.25))),
    }
    # The lean is spread up the spine, above the legs. The shoulders
    # counter-rotate against the pelvis, and the head stays level: a runner
    # leaning 11 degrees who also looks 11 degrees at the floor reads as
    # falling over rather than as running.
    t["Spine"] = {"rot": [(1, (lean * 0.45, 0, 0)), (n, (lean * 0.45, 0, 0))]}
    t["Spine1"] = {"rot": rc.keys(n, samples, lambda x: (
        lean * 0.35, 0, rc.wave(x, -yaw * 1.3, phase=0.25)))}
    t["Spine2"] = {"rot": [(1, (lean * 0.20, 0, 0)), (n, (lean * 0.20, 0, 0))]}
    t["Head"] = {"rot": [(1, (-lean * 0.85, 0, 0)), (n, (-lean * 0.85, 0, 0))]}
    print("[gait] %d frames %.3f s, mps %.2f, contact %.2f, travel %.4f m, "
          "strike_z %.4f, liftoff_z %.4f, max reach %.4f of 0.8175"
          % (n, cycle_s, mps, contact, travel, strike_z, lift_off_z, reach[0]))
    return t


def clip_walk(n=33):
    t = _gait(n, WALK_CLIP_MPS, contact=0.62, strike=0.200,
              lift=0.200, lift_bias=0.80, lean=4.0, swing=16.0,
              bend=20.0, push=24.0, toe_push=20.0, sway=0.014, yaw=3.5,
              hips_knots=[(0.0, -0.014), (0.54, -0.006), (1.0, -0.014)])
    t.update(hand_pose(1, grip=0.2))
    return t


def clip_run(n=25):
    """The flagship clip. The player's ground speed is 4.6 m/s against a
    3.0 m/s run threshold, so this is what plays essentially all the time, at
    timeScale 1.02. Contact is 0.36 of the cycle, which puts a flight phase
    either side of it; a 0.82 m leg cannot sweep a whole 0.90 m step along the
    ground, so the remainder is carried in the air, which is what a run is."""
    t = _gait(n, RUN_CLIP_MPS, contact=0.32, strike=0.255,
              lift=0.415, lift_bias=0.72, lean=11.0, swing=36.0,
              bend=54.0, push=40.0, toe_push=34.0, sway=0.016, yaw=5.0,
              hips_knots=[(0.0, -0.040), (0.34, -0.060), (0.64, -0.010),
                          (0.82, 0.008), (1.0, -0.040)])
    t.update(hand_pose(1, grip=0.5))
    return t


def _walk_like(n, thigh, knee, swing, bend, bob, lean, samples=8):
    """The old sine gait, kept for Crouch_Walk only.

    A sine has no foot plant, which is why Walk and Run no longer use it; at
    crouch speed with a 0.008 m bob the error is a few millimetres per frame
    and the shape is not worth solving."""
    t = {}
    for pre, s, ph in (("Left", 1.0, 0.0), ("Right", -1.0, 0.5)):
        t[pre + "UpLeg"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph: (rc.wave(x, -thigh, phase=ph), 0, 0))}
        t[pre + "Leg"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph: (
                knee * 0.5 + rc.wave(x, -knee * 0.5, phase=ph + 0.30), 0, 0))}
        t[pre + "Foot"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph: (rc.wave(x, 12, phase=ph + 0.55), 0, 0))}
        t[pre + "ToeBase"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph: (
                -8.0 + rc.wave(x, 8.0, phase=ph + 0.70), 0, 0))}
        t[pre + "Arm"] = {"rot": rc.keys(
            n, samples, lambda x, s=s, ph=ph: arm(
                s, 76, rc.wave(x, swing, phase=ph + 0.5), 3))}
        t[pre + "ForeArm"] = {"rot": rc.keys(
            n, samples, lambda x, s=s, ph=ph: elbow(
                s, bend + rc.wave(x, bend * 0.35, phase=ph + 0.5)))}
    t["Hips"] = {
        "loc": rc.keys(n, samples, lambda x: (rc.wave(x, 0.015, phase=0.25),
                                              0, rc.wave(x, bob, cycles=2.0))),
        "rot": rc.keys(n, samples, lambda x: (lean, rc.wave(x, 2.5),
                                              rc.wave(x, 4.0, phase=0.25))),
    }
    t["Spine1"] = {"rot": rc.keys(n, samples,
                                  lambda x: (0, 0, rc.wave(x, -5.0, phase=0.25)))}
    return t


def clip_crouch_walk(n=37):
    t = _walk_like(n, thigh=16, knee=20, swing=10, bend=30, bob=0.008, lean=0,
                   samples=8)
    return rc.merge(_crouch_pose(n), t)


def _crouch_pose(n, deep=1.0):
    """Sitting into the knees, torso forward to keep the mass over the feet.
    Authored once and layered under both crouch clips."""
    t = {"Hips": {"loc": [(1, (0, 0, -0.32 * deep)), (n, (0, 0, -0.32 * deep))],
                  "rot": [(1, (26 * deep, 0, 0)), (n, (26 * deep, 0, 0))]},
         "Spine": {"rot": [(1, (-6, 0, 0)), (n, (-6, 0, 0))]},
         "Spine1": {"rot": [(1, (-6, 0, 0)), (n, (-6, 0, 0))]}}
    for pre, s in SIDES:
        t[pre + "UpLeg"] = {"rot": [(1, (-58 * deep, 0, 0)), (n, (-58 * deep, 0, 0))]}
        t[pre + "Leg"] = {"rot": [(1, (78 * deep, 0, 0)), (n, (78 * deep, 0, 0))]}
        t[pre + "Foot"] = {"rot": [(1, (-24 * deep, 0, 0)), (n, (-24 * deep, 0, 0))]}
        t[pre + "Arm"] = {"rot": [(1, arm(s, 70, -14, 4)), (n, arm(s, 70, -14, 4))]}
        t[pre + "ForeArm"] = {"rot": [(1, elbow(s, 34)), (n, elbow(s, 34))]}
    return t


def clip_crouch_idle(n=91):
    t = _crouch_pose(n)
    t["Spine1"] = {"rot": rc.keys(n, 6, lambda x: (-6 + rc.wave(x, 1.2), 0, 0))}
    t["Head"] = {"rot": rc.keys(n, 6, lambda x: (rc.wave(x, 1.0, phase=0.2), 0, 0))}
    return t


def clip_jump_start(n=13):
    """Crouch and launch. Frames 1 to 7 load, 7 to 13 extend."""
    t = both_arms({}, [(1, 70, -10, 3, 18), (7, 58, 40, 6, 62),
                       (13, 20, -30, 10, 22)])
    t["Hips"] = {"loc": [(1, (0, 0, 0)), (7, (0, 0, -0.22)), (13, (0, 0, 0.02))],
                 "rot": [(1, (4, 0, 0)), (7, (26, 0, 0)), (13, (-6, 0, 0))]}
    for pre, _ in SIDES:
        t[pre + "UpLeg"] = {"rot": [(1, (-4, 0, 0)), (7, (-52, 0, 0)),
                                    (13, (6, 0, 0))]}
        t[pre + "Leg"] = {"rot": [(1, (6, 0, 0)), (7, (70, 0, 0)), (13, (4, 0, 0))]}
        t[pre + "Foot"] = {"rot": [(1, (0, 0, 0)), (7, (-20, 0, 0)),
                                   (13, (34, 0, 0))]}
        # the launch is a toe-off, so the toe hinges hard on the last frames
        t[pre + "ToeBase"] = {"rot": [(1, (0, 0, 0)), (7, (0, 0, 0)),
                                      (13, (-30, 0, 0))]}
    return t


def clip_jump_loop(n=21):
    """Airborne: legs tucked, arms out for balance, one slow cycle so the pose
    is not frozen."""
    t = {}
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(n, 4, lambda x, s=s: arm(
            s, 34 + rc.wave(x, 5), -18, 14))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 4, lambda x, s=s: elbow(
            s, 46 + rc.wave(x, 6)))}
        t[pre + "UpLeg"] = {"rot": rc.keys(n, 4, lambda x: (-32 + rc.wave(x, 4), 0, 0))}
        t[pre + "Leg"] = {"rot": rc.keys(n, 4, lambda x: (46 + rc.wave(x, 6), 0, 0))}
        t[pre + "Foot"] = {"rot": [(1, (16, 0, 0)), (n, (16, 0, 0))]}
        t[pre + "ToeBase"] = {"rot": [(1, (-6, 0, 0)), (n, (-6, 0, 0))]}
    t["Spine1"] = {"rot": rc.keys(n, 4, lambda x: (-8 + rc.wave(x, 2), 0, 0))}
    return t


def clip_jump_land(n=17):
    t = both_arms({}, [(1, 26, -24, 12, 30), (7, 62, 30, 6, 54),
                       (17, 76, -4, 2, 14)])
    t["Hips"] = {"loc": [(1, (0, 0, 0.02)), (7, (0, 0, -0.20)), (17, (0, 0, 0))],
                 "rot": [(1, (-4, 0, 0)), (7, (24, 0, 0)), (17, (2, 0, 0))]}
    for pre, _ in SIDES:
        t[pre + "UpLeg"] = {"rot": [(1, (-14, 0, 0)), (7, (-48, 0, 0)),
                                    (17, (-2, 0, 0))]}
        t[pre + "Leg"] = {"rot": [(1, (24, 0, 0)), (7, (64, 0, 0)), (17, (4, 0, 0))]}
        # toes first, then the heel comes down: the landing reads as a landing
        t[pre + "Foot"] = {"rot": [(1, (26, 0, 0)), (5, (2, 0, 0)),
                                   (7, (-16, 0, 0)), (17, (0, 0, 0))]}
        t[pre + "ToeBase"] = {"rot": [(1, (-18, 0, 0)), (5, (-6, 0, 0)),
                                      (17, (0, 0, 0))]}
    return t


def clip_fall(n=21):
    """A long fall. Arms out and back, legs trailing, a slow flutter so it
    reads as air rather than as a pause."""
    t = {}
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(n, 4, lambda x, s=s: arm(
            s, 12 + rc.wave(x, 7), 26 + rc.wave(x, 6, phase=0.3), 22))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 4, lambda x, s=s: elbow(
            s, 24 + rc.wave(x, 8, phase=0.15)))}
        t[pre + "UpLeg"] = {"rot": rc.keys(n, 4, lambda x: (18 + rc.wave(x, 6), 0, 0))}
        t[pre + "Leg"] = {"rot": rc.keys(n, 4, lambda x: (26 + rc.wave(x, 8, phase=0.5), 0, 0))}
        t[pre + "Foot"] = {"rot": rc.keys(n, 4, lambda x: (18 + rc.wave(x, 5, phase=0.25), 0, 0))}
        t[pre + "ToeBase"] = {"rot": [(1, (-10, 0, 0)), (n, (-10, 0, 0))]}
    t["Spine1"] = {"rot": rc.keys(n, 4, lambda x: (10 + rc.wave(x, 3), 0, 0))}
    t["Head"] = {"rot": [(1, (-10, 0, 0)), (n, (-10, 0, 0))]}
    return t


def _swing(n, impact, high, low, lean_back, lean_fwd, bend_hi, bend_lo):
    """A two-handed overhead tool swing. `impact` is a CONTRACT frame: gameplay
    fires harvestNode() there, so the pose on that frame must be the moment the
    head lands, not one frame either side of it.

    `impact` is an AUTHORED (1-based) frame and authored frame 1 exports at
    t = 0, so the tick the client counts is `impact - 1` (of_lib.clip_frame,
    DW-34): authored 17 is runtime tick 16 at 0.2667 s."""
    wind = max(2, impact - 10)
    settle = impact + max(4, (n - impact) // 3)
    t = both_arms({}, [
        (1, 44, -26, 6, 40),
        (wind, high, 38, 10, bend_hi),
        (impact, low, -58, 9, bend_lo),
        (settle, low - 14, -40, 8, bend_lo + 18),
        (n, 44, -26, 6, 40),
    ])
    # The lean is spread over the whole spine, not dumped on one joint: a strike
    # driven from one vertebra reads as a nod, and the follow-through past the
    # impact frame is what sells the weight of the tool.
    for bone, share in (("Spine", 0.30), ("Spine1", 0.42), ("Spine2", 0.28)):
        t[bone] = {"rot": [(1, (-2 * share, 0, 0)),
                           (wind, (lean_back * share, 0, 0)),
                           (impact, (lean_fwd * share, 0, 0)),
                           (settle, (lean_fwd * share * 0.55, 0, 0)),
                           (n, (-2 * share, 0, 0))]}
    t["Hips"] = {"loc": [(1, (0, 0, 0)), (wind, (0, 0.06, 0.02)),
                         (impact, (0, -0.03, -0.09)), (settle, (0, 0, -0.04)),
                         (n, (0, 0, 0))],
                 "rot": [(1, (0, 0, -8)), (wind, (-8, 0, -16)),
                         (impact, (10, 0, 6)), (n, (0, 0, -8))]}
    for pre, _ in SIDES:
        t[pre + "UpLeg"] = {"rot": [(1, (-6, 0, 0)), (wind, (2, 0, 0)),
                                    (impact, (-14, 0, 0)), (n, (-6, 0, 0))]}
        t[pre + "Leg"] = {"rot": [(1, (10, 0, 0)), (wind, (6, 0, 0)),
                                  (impact, (22, 0, 0)), (n, (10, 0, 0))]}
        t[pre + "Foot"] = {"rot": [(1, (-4, 0, 0)), (wind, (-2, 0, 0)),
                                   (impact, (-10, 0, 0)), (n, (-4, 0, 0))]}
    t.update(hand_pose(1, grip=1.0))
    return t


def clip_swing_pickaxe(n=33):
    """Overhead, driven down past the knees: the pick tip lands at the ore,
    which is on the ground."""
    return _swing(n, 17, high=-38, low=104, lean_back=-18, lean_fwd=42,
                  bend_hi=96, bend_lo=18)


def clip_swing_axe(n=35):
    """Shallower and more horizontal than the pickaxe: an axe lands on a trunk
    at chest height, not on the floor."""
    return _swing(n, 18, high=-24, low=86, lean_back=-14, lean_fwd=26,
                  bend_hi=84, bend_lo=26)


def clip_dig(n=31):
    """Voxel mining: a short downward jab at the ground, not a felling swing."""
    return _swing(n, 16, high=12, low=112, lean_back=-6, lean_fwd=48,
                  bend_hi=70, bend_lo=26)


def clip_place(n=25):
    """Build placement: the right arm reaches out and sets the machine down,
    the left steadies it."""
    t = {
        "RightArm": {"rot": [(1, arm(-1, 72, -10, 4)), (9, arm(-1, 46, -74, 8)),
                             (15, arm(-1, 58, -66, 6)), (n, arm(-1, 72, -10, 4))]},
        "RightForeArm": {"rot": [(1, elbow(-1, 20)), (9, elbow(-1, 44)),
                                 (15, elbow(-1, 28)), (n, elbow(-1, 20))]},
        "LeftArm": {"rot": [(1, arm(1, 74, -8, 3)), (9, arm(1, 60, -46, 6)),
                            (15, arm(1, 64, -40, 5)), (n, arm(1, 74, -8, 3))]},
        "LeftForeArm": {"rot": [(1, elbow(1, 22)), (9, elbow(1, 52)),
                                (15, elbow(1, 46)), (n, elbow(1, 22))]},
        "Spine1": {"rot": [(1, (0, 0, 0)), (9, (10, 0, -6)), (15, (12, 0, -6)),
                           (n, (0, 0, 0))]},
        "Hips": {"loc": [(1, (0, 0, 0)), (9, (0, 0, -0.05)), (15, (0, 0, -0.05)),
                         (n, (0, 0, 0))]},
    }
    t.update(hand_pose(1, grip=0.35))
    for b in rc.finger_bones("Right"):
        t[b] = {"rot": [(1, curl(-1, 20)), (9, curl(-1, 8)), (15, curl(-1, 52)),
                        (n, curl(-1, 20))]}
    return t


def clip_craft(n=61):
    """Hand-craft loop: both hands in front of the chest working on something
    small. One full second, looping."""
    t = {}
    for pre, s, ph in (("Left", 1.0, 0.0), ("Right", -1.0, 0.5)):
        t[pre + "Arm"] = {"rot": rc.keys(n, 8, lambda x, s=s, ph=ph: arm(
            s, 58 + rc.wave(x, 4, phase=ph), -40 + rc.wave(x, 6, phase=ph), 10))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 8, lambda x, s=s, ph=ph: elbow(
            s, 74 + rc.wave(x, 9, phase=ph + 0.25)))}
        for b in rc.finger_bones(pre, ["Index", "Middle"]):
            t[b] = {"rot": rc.keys(n, 8, lambda x, s=s, ph=ph: curl(
                s, 40 + rc.wave(x, 22, phase=ph)))}
        for b in rc.finger_bones(pre, ["Thumb"]):
            t[b] = {"rot": rc.keys(n, 8, lambda x, s=s, ph=ph: thumb(
                s, 26 + rc.wave(x, 12, phase=ph + 0.5)))}
    t["Spine1"] = {"rot": rc.keys(n, 8, lambda x: (8 + rc.wave(x, 1.5), 0, 0))}
    t["Head"] = {"rot": [(1, (12, 0, 0)), (n, (12, 0, 0))]}
    return t


CLIPS = [
    ("Idle", clip_idle), ("Walk", clip_walk), ("Run", clip_run),
    ("Jump_Start", clip_jump_start), ("Jump_Loop", clip_jump_loop),
    ("Jump_Land", clip_jump_land), ("Fall", clip_fall),
    ("Swing_Pickaxe", clip_swing_pickaxe), ("Swing_Axe", clip_swing_axe),
    ("Dig", clip_dig), ("Place", clip_place), ("Craft", clip_craft),
    ("Crouch_Idle", clip_crouch_idle), ("Crouch_Walk", clip_crouch_walk),
]


# ---------------------------------------------------------------------------

def main():
    of.reset_scene()
    # The armature IS the asset root: one node fewer, and every mesh and socket
    # is already inside the thing that animates them.
    arm_obj = of.add_armature(NAME, rc.BODY_BONES)

    mb, lod0 = build_mesh(NAME + "_LOD0", arm_obj)

    # DW-7 step 1: try Blender's own automatic weights, honestly, first.
    probe = mb.build(NAME + "_AutoWeightProbe", arm_obj)
    auto_ok, auto_note = of.skin_auto(probe, arm_obj)
    print("[player] bone-heat automatic weights: %s %s"
          % ("SUCCEEDED" if auto_ok else "FAILED", auto_note))
    bpy.data.objects.remove(probe, do_unlink=True)

    segs = of.bone_segments(rc.BODY_BONES)
    groups = of.solve_weights(mb.verts, mb.vert_bones, segs)
    sums = [0.0] * len(mb.verts)
    for bone, pairs in groups.items():
        for i, w in pairs:
            sums[i] += w
    print("[player] scripted weights: %d verts, %d bones used, "
          "weight sum %.4f to %.4f" % (len(mb.verts), len(groups),
                                       min(sums), max(sums)))
    of.bind_skin(lod0, arm_obj, groups)

    # Organic form, so decimation is the right LOD tool here (ASSET-SPECS 2.4).
    # The copies are made AFTER weighting so they inherit the vertex groups,
    # and the decimate modifier interpolates them.
    lod1 = of.add_lod_decimate(lod0, 1, 0.45, parent=arm_obj)
    lod2 = of.add_lod_decimate(lod0, 2, 0.14, parent=arm_obj)
    for o in (lod1, lod2):
        of.bind_skin(o, arm_obj)

    of.add_collision_box("col_" + NAME, (0.70, 0.50, 1.80), (0.0, 0.0, 0.90),
                         arm_obj, role=DARK)

    # Bone-parented sockets. socket_hand_* is oriented so a tool authored with
    # its haft along +Z and its origin at the grip mates with an IDENTITY
    # transform: the 90 degree X rotation lays the haft along the fist axis.
    grip_rot = (math.radians(90.0), 0.0, 0.0)
    of.add_bone_socket("socket_hand_R", arm_obj, "RightHand",
                       (-0.755, 0.0, 1.447), grip_rot, {"of_role": "hand_r"})
    of.add_bone_socket("socket_hand_L", arm_obj, "LeftHand",
                       (0.755, 0.0, 1.447), grip_rot, {"of_role": "hand_l"})
    of.add_bone_socket("socket_back", arm_obj, "Spine2", (0.0, 0.125, 1.360),
                       extras={"of_role": "stow"})
    of.add_bone_socket("socket_hip_R", arm_obj, "Hips", (-0.215, 0.010, 0.930),
                       extras={"of_role": "tool_loop"})
    of.add_bone_socket("socket_head_cam", arm_obj, "Head",
                       (0.0, -0.060, rc.EYE_Z), extras={"of_role": "eye"})
    of.add_bone_socket("socket_lamp", arm_obj, "Head", (0.0, -0.145, 1.742),
                       extras={"of_role": "lamp"})

    for name, fn in CLIPS:
        of.pose_clip(arm_obj, name, fn())

    # Leave the armature unposed so nothing but the rest pose can be baked into
    # the joint nodes. export_rest_position_armature makes this belt and braces.
    if arm_obj.animation_data:
        arm_obj.animation_data.action = None
    bpy.context.scene.frame_set(int(of.clip_frame(1)))

    lo, hi = mb.bounds()
    print("[player] bounds blender x %.4f..%.4f  y %.4f..%.4f  z %.4f..%.4f"
          % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    print("[player] envelope three.js xyz [%.4f, %.4f, %.4f]"
          % (hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]))
    of.report(NAME, [("LOD0", mb)])
    print("[player] clips: %d, bones: %d" % (len(CLIPS), len(rc.BODY_BONES)))
    of.export_glb(OUT)


import bpy  # noqa: E402

if __name__ == "__main__":
    main()
