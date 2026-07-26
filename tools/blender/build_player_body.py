"""build_player_body.py - the third-person player, the only rigged Tier-0 asset.

    blender --background --python tools/blender/build_player_body.py

Produces assets/models/dist/player/player_body.glb (ASSET-SPECS 4.1).

44 bones, 14 clips, six bone-parented sockets, three LODs.

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

    # --- torso: wide on top, narrow at the waist. The 'engineer' read ---
    mb.bind(["Hips", "Spine", "Spine1", "Spine2", "Neck"])
    mb.add_raw(*rc.stack([((0, 0, 1.060), 0.160, 0.108),
                          ((0, 0, 1.200), 0.175, 0.112),
                          ((0, 0, 1.340), 0.200, 0.118),
                          ((0, 0, 1.450), 0.205, 0.115),
                          ((0, 0, 1.500), 0.150, 0.095)]), role=SUIT)

    # --- chest pack, its two recessed vents, and the state indicator ---
    # Bound rigidly to Spine2: it is a hard box, and a hard box that deforms
    # when the spine bends looks broken in a way a soft shape does not.
    mb.bind(["Spine2"])
    mb.add_raw(*of.box_data((0.300, 0.095, 0.260), (0.0, -0.1525, 1.300)),
               role=SUIT)
    for sx in (-1, 1):
        mb.add_raw(*of.box_data((0.090, 0.020, 0.120),
                                (sx * 0.070, -0.188, 1.320)), role=DARK)
    mb.add_raw(*of.box_data((0.070, 0.020, 0.035), (0.0, -0.190, 1.395)),
               role=EM)
    # Back mount plate: what socket_back actually stows a tool against, and
    # what keeps the silhouette's depth balanced around the ground pivot
    # instead of hanging 48 mm forward of it.
    mb.add_raw(*of.box_data((0.170, 0.055, 0.230), (0.0, 0.1425, 1.290)),
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
        # shoulder pad
        mb.bind([pre + "Shoulder", pre + "Arm"])
        mb.add_raw(*rc.tube([(s * 0.130, 0, 1.430), (s * 0.180, 0, 1.458),
                             (s * 0.230, 0, 1.436)],
                            [0.090, 0.096, 0.072], seg=8), role=ACC)
        # arm: ONE tube shoulder to wrist, with a ring exactly on the elbow
        mb.bind([pre + "Shoulder", pre + "Arm", pre + "ForeArm", pre + "Hand"])
        mb.add_raw(*rc.tube([(s * 0.170, 0, 1.45), (s * 0.310, 0, 1.45),
                             (s * 0.450, 0, 1.45), (s * 0.575, 0, 1.45),
                             (s * 0.700, 0, 1.45)],
                            [0.078, 0.070, 0.062, 0.057, 0.050], seg=10),
                   role=SUIT)
        mb.bind([pre + "Arm", pre + "ForeArm"])
        mb.add_raw(*of.cyl_data(0.068, 0.050, (s * 0.450, 0, 1.45), "X", 8),
                   role=DARK)
        # oversized glove, and a cuff that spans the wrist joint
        mb.bind([pre + "Hand"])
        mb.add_raw(*of.box_data((0.115, 0.105, 0.095),
                                (s * 0.7525, 0.0, 1.4475)), role=SUIT)
        mb.bind([pre + "Hand", pre + "ForeArm"])
        mb.add_raw(*of.cyl_data(0.062, 0.035, (s * 0.705, 0, 1.45), "X", 8),
                   role=DARK)
        # three finger blocks, each whitelisted to its own chain so a curl
        # bends it and nothing else
        mb.bind(rc.finger_bones(pre, ["Thumb"]))
        mb.add_raw(*of.box_data((0.085, 0.034, 0.030),
                                (s * 0.828, -0.050, 1.430)), role=SUIT)
        mb.bind(rc.finger_bones(pre, ["Index"]))
        mb.add_raw(*of.box_data((0.110, 0.030, 0.030),
                                (s * 0.845, -0.020, 1.449)), role=SUIT)
        mb.bind(rc.finger_bones(pre, ["Middle"]))
        mb.add_raw(*of.box_data((0.110, 0.040, 0.034),
                                (s * 0.845, 0.021, 1.446)), role=SUIT)

    # --- helmet: chamfered cylinder, ring, wide visor band, lamp ---
    mb.bind(["Head"])
    mb.add_raw(*rc.tube([(0, 0, 1.530), (0, 0, 1.580), (0, 0, 1.700),
                         (0, 0, 1.755), (0, 0, 1.800)],
                        [0.098, 0.125, 0.125, 0.105, 0.055], seg=10),
               role=SUIT)
    mb.add_raw(*of.cyl_data(0.130, 0.028, (0, 0, 1.552), "Z", 10), role=DARK)
    mb.add_raw(*of.arc_band_data(0.118, 0.136, 0.075, (0, 0, 1.660),
                                 -142.0, -38.0, 8), role=GLASS)
    mb.add_raw(*of.box_data((0.050, 0.032, 0.032), (0.0, -0.126, 1.742)),
               role=EM)
    mb.add_raw(*of.box_data((0.100, 0.070, 0.055), (0.0, -0.068, 1.545)),
               role=SKIN)
    mb.bind(["Neck", "Head", "Spine2"])
    mb.add_raw(*of.cyl_data(0.058, 0.100, (0, 0, 1.500), "Z", 8), role=SKIN)

    # --- legs: tapered tube with a ring on the knee, chunky boot, dark sole ---
    for pre, s in SIDES:
        mb.bind(["Hips", pre + "UpLeg", pre + "Leg", pre + "Foot"])
        mb.add_raw(*rc.tube([(s * 0.10, 0.000, 0.950), (s * 0.10, 0.000, 0.730),
                             (s * 0.10, 0.000, 0.510), (s * 0.10, 0.000, 0.320),
                             (s * 0.10, -0.005, 0.130)],
                            [0.105, 0.092, 0.078, 0.070, 0.060], seg=10),
                   role=SUIT)
        mb.bind([pre + "UpLeg", pre + "Leg"])
        mb.add_raw(*of.box_data((0.090, 0.045, 0.100),
                                (s * 0.10, -0.072, 0.510)), role=DARK)
        mb.bind([pre + "Foot", pre + "ToeBase"])
        mb.add_raw(*rc.stack([((s * 0.10, -0.080, 0.020), 0.075, 0.140),
                              ((s * 0.10, -0.080, 0.070), 0.078, 0.140),
                              ((s * 0.10, -0.060, 0.130), 0.072, 0.110),
                              ((s * 0.10, -0.040, 0.175), 0.062, 0.080)]),
                   role=SUIT)
        mb.add_raw(*of.box_data((0.160, 0.280, 0.024),
                                (s * 0.10, -0.080, 0.012)), role=DARK)

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


def _walk_like(n, thigh, knee, swing, bend, bob, lean, samples=8):
    """The shared body of Walk, Run and Crouch_Walk. One sine per joint, legs
    in antiphase, arms counter-swinging against the legs on the same axis,
    which is the entire mechanical content of a bipedal gait."""
    t = {}
    for pre, s, ph in (("Left", 1.0, 0.0), ("Right", -1.0, 0.5)):
        t[pre + "UpLeg"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph: (rc.wave(x, -thigh, phase=ph), 0, 0))}
        t[pre + "Leg"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph: (
                knee * 0.5 + rc.wave(x, -knee * 0.5, phase=ph + 0.30), 0, 0))}
        t[pre + "Foot"] = {"rot": rc.keys(
            n, samples, lambda x, ph=ph: (rc.wave(x, 12, phase=ph + 0.55), 0, 0))}
        # arm counter-swings the leg on the same side: phase + 0.5
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


def clip_walk(n=33):
    t = _walk_like(n, thigh=24, knee=34, swing=17, bend=16, bob=0.012, lean=2)
    t.update(hand_pose(1, grip=0.2))
    return t


def clip_run(n=25):
    t = _walk_like(n, thigh=36, knee=64, swing=34, bend=52, bob=0.028, lean=12)
    t.update(hand_pose(1, grip=0.5))
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
                                   (13, (26, 0, 0))]}
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
        t[pre + "Foot"] = {"rot": [(1, (-14, 0, 0)), (n, (-14, 0, 0))]}
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
        t[pre + "Foot"] = {"rot": [(1, (18, 0, 0)), (7, (-16, 0, 0)),
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
    t["Spine1"] = {"rot": rc.keys(n, 4, lambda x: (10 + rc.wave(x, 3), 0, 0))}
    t["Head"] = {"rot": [(1, (-10, 0, 0)), (n, (-10, 0, 0))]}
    return t


def _swing(n, impact, high, low, lean_back, lean_fwd, bend_hi, bend_lo):
    """A two-handed overhead tool swing. `impact` is a CONTRACT frame: gameplay
    fires harvestNode() there, so the pose on that frame must be the moment the
    head lands, not one frame either side of it."""
    wind = max(2, impact - 10)
    settle = impact + max(4, (n - impact) // 3)
    t = both_arms({}, [
        (1, 44, -26, 6, 40),
        (wind, high, 38, 10, bend_hi),
        (impact, low, -58, 2, bend_lo),
        (settle, low - 14, -40, 3, bend_lo + 18),
        (n, 44, -26, 6, 40),
    ])
    t["Spine1"] = {"rot": [(1, (-4, 0, 0)), (wind, (lean_back, 0, 0)),
                           (impact, (lean_fwd, 0, 0)),
                           (settle, (lean_fwd * 0.6, 0, 0)), (n, (-4, 0, 0))]}
    t["Hips"] = {"loc": [(1, (0, 0, 0)), (wind, (0, 0, 0.02)),
                         (impact, (0, 0, -0.06)), (n, (0, 0, 0))],
                 "rot": [(1, (0, 0, -8)), (wind, (0, 0, -16)),
                         (impact, (0, 0, 6)), (n, (0, 0, -8))]}
    for pre, _ in SIDES:
        t[pre + "UpLeg"] = {"rot": [(1, (-6, 0, 0)), (wind, (2, 0, 0)),
                                    (impact, (-14, 0, 0)), (n, (-6, 0, 0))]}
        t[pre + "Leg"] = {"rot": [(1, (10, 0, 0)), (wind, (6, 0, 0)),
                                  (impact, (22, 0, 0)), (n, (10, 0, 0))]}
    t.update(hand_pose(1, grip=1.0))
    return t


def clip_swing_pickaxe(n=33):
    return _swing(n, 17, high=-38, low=88, lean_back=-16, lean_fwd=26,
                  bend_hi=96, bend_lo=26)


def clip_swing_axe(n=35):
    return _swing(n, 18, high=-24, low=80, lean_back=-12, lean_fwd=22,
                  bend_hi=84, bend_lo=30)


def clip_dig(n=31):
    """Voxel mining: a short downward jab at the ground, not a felling swing."""
    return _swing(n, 16, high=6, low=96, lean_back=-6, lean_fwd=34,
                  bend_hi=70, bend_lo=34)


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
    bpy.context.scene.frame_set(1)

    of.report(NAME, [("LOD0", mb)])
    print("[player] clips: %d, bones: %d" % (len(CLIPS), len(rc.BODY_BONES)))
    of.export_glb(OUT)


import bpy  # noqa: E402

if __name__ == "__main__":
    main()
