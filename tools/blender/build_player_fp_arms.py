"""build_player_fp_arms.py - the first-person view model.

    blender --background --python tools/blender/build_player_fp_arms.py

Produces assets/models/dist/player/player_fp_arms.glb (ASSET-SPECS 4.2).

27 bones (the body rig's arm subset, identical names, plus Root), 12 clips,
two bone-parented sockets, one LOD.

THE ORIGIN IS THE CAMERA POINT, so the model attaches to the camera with an
identity transform, and the BIND POSE is the view-model rest rather than the
T-pose (rig_common explains why).

2026-07-27, WHY THIS WAS REBUILT. Reid played the game and reported the hands
as "large white mitts", and they were. Three things made them one:

  DISTANCE. The hand sat 0.435 m from the eye. At the client's roughly 70
  degree vertical FOV the visible height at that distance is 0.61 m, so a
  0.10 m glove was a sixth of the screen and there were two of them with the
  forearms coming at the lens behind them. The hand is now at 0.62 m, where
  the visible height is 0.87 m, and 0.30 m below the eye instead of 0.22.

  COLOUR. Every part was OF_Suit, a pale bone white, so there was no glove, no
  cuff and no wrist: there was one white shape. The glove is OF_SuitDark now,
  the cuff is OF_SuitAccent, the knuckles are OF_Plate, and the bare OF_Skin
  band between cuff and glove is wider, because it is the only thing at this
  distance that says there is a person inside the suit.

  SHAPE. The old hand was a round tube tapering to a point with three 0.165 m
  prongs stuck in the end, seen end on. A hand is not round and a finger is
  0.075 m long and curls. The palm is an ELLIPSE now (rig_common.oval_tube),
  twice as wide as it is thick; there are five separate finger tubes on the
  three finger bone chains, each curling further at each joint; and the thumb
  comes off the inboard side where a thumb goes.

EVERY PART OVERLAPS THE JOINT IT CROSSES. A part starting exactly on its
bone's head swings away from its neighbour the moment that bone rotates and
opens a crack. On a machine that is invisible; on a view model it is the first
thing the player sees. So the skin band runs past the wrist into the palm, the
glove starts 0.04 m behind the wrist, and every finger starts half a segment
inside the hand.

The impact frames of FP_Swing_Pickaxe (authored 17), FP_Swing_Axe (18) and
FP_Dig (16) match the third-person clips exactly. They are a gameplay contract,
not an animation preference: harvestNode() fires on those frames whichever view
the player is in. Authored frames are 1-based and authored frame 1 exports at
t = 0 (of_lib.clip_frame), so the RUNTIME tick is one lower than the number
written here: 16, 17 and 15, at 0.2667, 0.2833 and 0.2500 s (DW-34).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import rig_common as rc  # noqa: E402

NAME = "PlayerFPArms"
OUT = of.dist_path("player", "player_fp_arms.glb")

SIDES = (("Left", 1.0), ("Right", -1.0))
SUIT, ACC, DARK, SKIN = "Suit", "SuitAccent", "SteelDark", "Skin"
GLOVE, PLATE = "SuitDark", "Plate"


def _pt(p, s):
    return (p[0] * s, p[1], p[2])


def _lerp(a, b, t):
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


def _off(p, d):
    return tuple(p[k] + d[k] for k in range(3))


def build_mesh(name, arm_obj):
    mb = of.MeshBuilder()

    # Shallow chest stub: the bottom of the frame, and the thing that stops the
    # arms reading as two objects floating in space. It sits below and behind
    # the eye, so it is never actually on screen; what it does carry is the
    # asset's declared depth and height envelope.
    mb.bind(["Root"])
    mb.add_raw(*rc.stack([((0.0, 0.030, -0.6470), 0.150, 0.130),
                          ((0.0, 0.048, -0.5200), 0.185, 0.170),
                          ((0.0, 0.034, -0.4000), 0.175, 0.155)]), role=SUIT)

    sh, el_in, el, wr, hd = (rc._FP_SHOULDER, rc._FP_ELBOW_IN, rc._FP_ELBOW,
                             rc._FP_WRIST, rc._FP_HAND)
    for pre, s in SIDES:
        chain = [pre + "Shoulder", pre + "Arm", pre + "ForeArm", pre + "Hand"]

        # deltoid
        mb.bind([pre + "Shoulder", pre + "Arm"])
        mb.add_raw(*rc.tube([_pt(sh, s), _pt(_lerp(sh, el_in, 0.55), s),
                             _pt(el_in, s)],
                            [0.084, 0.090, 0.084], seg=12), role=ACC)

        # ONE tube shoulder to wrist, with a ring exactly ON the elbow so the
        # bend happens at the joint. Thinner than it was: the forearm ends at
        # 0.048 rather than 0.050 and drops faster, which is most of what stops
        # it reading as a club coming at the camera.
        mb.bind(chain)
        mb.add_raw(*rc.tube([_pt(_lerp(sh, el_in, 0.80), s),
                             _pt(_lerp(el_in, el, 0.50), s),
                             _pt(el, s),
                             _pt(_lerp(el, wr, 0.42), s),
                             _pt(_lerp(el, wr, 0.74), s)],
                            [0.080, 0.070, 0.061, 0.052, 0.048], seg=12),
                   role=SUIT)

        # Elbow band. TWELVE segments, matching the tube it covers: two coaxial
        # polygons only nest if one's circumradius clears the other's inradius,
        # and the cheap guarantee is the same segment count. 0.070 has an
        # inradius of 0.0676 against an arm of 0.0639 there.
        mb.bind([pre + "Arm", pre + "ForeArm"])
        mb.add_raw(*rc.tube([_pt(_lerp(el_in, el, 0.84), s),
                             _pt(_lerp(el, wr, 0.13), s)],
                            [0.070, 0.070], seg=12), role=DARK)

        # forearm brace, proud of the sleeve on the top face only
        mb.add_raw(*rc.oval_tube([_off(_pt(_lerp(el, wr, 0.20), s), (0, 0, 0.038)),
                                  _off(_pt(_lerp(el, wr, 0.44), s), (0, 0, 0.034)),
                                  _off(_pt(_lerp(el, wr, 0.62), s), (0, 0, 0.031))],
                                 [0.016, 0.015, 0.013],
                                 [0.042, 0.039, 0.035], seg=6), role=PLATE)

        # cuff: the sleeve's end, and the top of the bare wrist
        mb.bind([pre + "ForeArm", pre + "Hand"])
        mb.add_raw(*rc.tube([_pt(_lerp(el, wr, 0.64), s),
                             _pt(_lerp(el, wr, 0.79), s)],
                            [0.056, 0.056], seg=12), role=ACC)
        # bare skin, cuff to glove, running past the wrist into the palm
        mb.add_raw(*rc.tube([_pt(_lerp(el, wr, 0.74), s),
                             _pt(_lerp(el, wr, 0.97), s),
                             _pt(_lerp(wr, hd, 0.20), s)],
                            [0.046, 0.045, 0.045], seg=12), role=SKIN)

        # The glove. An ELLIPSE, 0.12 m across and 0.09 m thick at the palm,
        # starting 0.04 m behind the wrist so the skin band can never come
        # apart from it. Its first ring's inradius (0.0480) swallows the skin
        # band's circumradius (0.045).
        mb.bind([pre + "ForeArm", pre + "Hand"])
        palm = [_pt(_lerp(wr, hd, t), s)
                for t in (-0.32, 0.06, 0.50, 1.00, 1.32)]
        # Widest at the KNUCKLE line and then stepping hard down: the width
        # step is most of what separates a hand from a paddle in silhouette.
        mb.add_raw(*rc.oval_tube(palm,
                                 [0.052, 0.049, 0.045, 0.043, 0.028],
                                 [0.053, 0.056, 0.062, 0.065, 0.046], seg=8),
                   role=GLOVE)
        mb.bind([pre + "Hand"])
        mb.add_raw(*rc.oval_tube(
            [_off(_pt(_lerp(wr, hd, 0.35), s), (0, 0, 0.034)),
             _off(_pt(_lerp(wr, hd, 0.75), s), (0, 0, 0.036)),
             _off(_pt(_lerp(wr, hd, 1.10), s), (0, 0, 0.032))],
            [0.016, 0.017, 0.013], [0.046, 0.050, 0.044], seg=6), role=PLATE)

        # Five finger tubes on three bone chains. The Middle chain carries
        # three of them, offset across the knuckle line, so the hand has four
        # fingers and a thumb in silhouette and the rig still has 27 bones.
        for fname, _root, segs in rc._FP_FINGERS:
            r = rc._FP_FINGER_R[fname]
            variants = (rc._FP_MIDDLE_TUBES if fname == "Middle"
                        else (((0.0, 0.0, 0.0), r, 1.0),))
            for offset, rad, scale in variants:
                mb.bind([pre + "Hand"] + rc.finger_bones(pre, [fname]))
                pts = rc.fp_finger_points(fname, scale=scale, offset=offset)
                root = tuple(pts[0][k] - segs[0][k] * 0.55 for k in range(3))
                ring = [_pt(root, s)] + [_pt(p, s) for p in pts]
                mb.add_raw(*rc.tube(ring,
                                    [rad * 0.90, rad, rad * 0.92, rad * 0.85,
                                     rad * 0.72], seg=8), role=GLOVE)

    mb.bind(None)
    return mb, mb.build(name, arm_obj)


# ---------------------------------------------------------------------------
# Clips. Every FP bone's bind pose IS its rest pose, so unlike the third-person
# rig there is no base pose to compose against: a delta here is a plain
# armature-space rotation. Negative X raises the arms, positive X drives them
# down and forward. A finger curls on POSITIVE X, which survives the mirror
# (of_lib's _mirror_rot leaves X alone), so one number does both hands.
# ---------------------------------------------------------------------------

def _both(track, keyframes, bones=("Arm", "ForeArm")):
    """keyframes: [(frame, {bone_suffix: (rx, ry, rz)}), ...], mirrored."""
    for frame, poses in keyframes:
        for suffix, rot in poses.items():
            for pre, s in SIDES:
                b = pre + suffix
                track.setdefault(b, {}).setdefault("rot", []).append(
                    (frame, rot if s > 0 else rc._mirror_rot(rot)))
    return track


def fp_grip(n, grip=0.0):
    """A held finger pose for the whole clip.

    The BIND pose is already a relaxed curl, so grip 0 is "as authored" and
    grip 1 closes the fist another 42 degrees per finger. Every clip states it
    rather than leaving the fingers unkeyed, because the 0.15 s crossfade
    between two clips that disagree about the hand is exactly where a finger
    pops."""
    out = {}
    for pre, _s in SIDES:
        for b in rc.finger_bones(pre, ["Index", "Middle"]):
            out[b] = {"rot": [(1, (14.0 * grip, 0, 0)), (n, (14.0 * grip, 0, 0))]}
        for b in rc.finger_bones(pre, ["Thumb"]):
            out[b] = {"rot": [(1, (9.0 * grip, 0, 0)), (n, (9.0 * grip, 0, 0))]}
    return out


def clip_fp_idle(n=121):
    t = {}
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(n, 8, lambda x, s=s: (
            rc.wave(x, 1.5), 0, s * rc.wave(x, 0.9, phase=0.2)))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 8, lambda x: (
            rc.wave(x, 1.1, phase=0.35), 0, 0))}
    t["Root"] = {"loc": rc.keys(n, 8, lambda x: (0, 0, rc.wave(x, 0.005)))}
    t.update(fp_grip(n, 0.30))
    return t


def _bob(n, amp, roll, cycles=2.0, surge=0.0):
    """A view-model bob is a motion of the WHOLE model, so it belongs on Root:
    one channel instead of twenty-six, and it stays in step with the camera
    bob the renderer applies."""
    return {"Root": {
        "loc": rc.keys(n, 12, lambda x: (rc.wave(x, amp * 0.9, phase=0.25),
                                         rc.wave(x, surge, cycles=cycles,
                                                 phase=0.12),
                                         rc.wave(x, amp, cycles=cycles))),
        "rot": rc.keys(n, 12, lambda x: (rc.wave(x, roll * 0.6, cycles=cycles),
                                         rc.wave(x, roll, phase=0.25), 0))}}


def clip_fp_walk_bob(n=33):
    t = _bob(n, 0.013, 2.0, surge=0.006)
    for pre, s in SIDES:
        ph = 0.0 if s > 0 else 0.5
        t[pre + "Arm"] = {"rot": rc.keys(n, 12, lambda x, ph=ph: (
            rc.wave(x, 3.2, phase=ph), 0, 0))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 12, lambda x, ph=ph: (
            -5.0 + rc.wave(x, 2.4, phase=ph + 0.12), 0, 0))}
    t.update(fp_grip(n, 0.35))
    return t


def clip_fp_run_bob(n=25):
    """25 frames, the same length as the third-person Run, because the client
    plays them together and a view model half a beat out of step with the body
    it belongs to is worse than no bob at all."""
    # The ALTERNATION is small on purpose. Nine degrees of counter-pump at the
    # shoulder is 0.10 m of height difference between the two hands once they
    # sit 0.62 m out, and a view model with one hand at the bottom edge and the
    # other mid-frame reads as broken rather than as running. The energy lives
    # in the Root bob, which moves both hands together the way a head does.
    t = _bob(n, 0.030, 4.4, surge=0.014)
    for pre, s in SIDES:
        ph = 0.0 if s > 0 else 0.5
        t[pre + "Arm"] = {"rot": rc.keys(n, 12, lambda x, ph=ph: (
            4.0 + rc.wave(x, 4.5, phase=ph), 0, 0))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 12, lambda x, ph=ph: (
            -8.0 + rc.wave(x, 3.5, phase=ph + 0.12), 0, 0))}
    t.update(fp_grip(n, 0.55))
    return t


# --- air states. New in W11: the client maps FP jump/fall to null today, so
# --- jumping in first person is a dead-still view model. The art has to exist
# --- before the wiring can, and the wiring is a reported client change.

def clip_fp_jump_start(n=13):
    """The load and the launch, read from the eye: the model dips as the knees
    bend, then the whole view model drops relative to the camera as the camera
    accelerates upward past it."""
    t = _both({}, [(1, {"Arm": (0, 0, 0), "ForeArm": (0, 0, 0)}),
                   (6, {"Arm": (7, 0, 0), "ForeArm": (6, 0, 0)}),
                   (n, {"Arm": (-11, 0, 0), "ForeArm": (-14, 0, 0)})])
    t["Root"] = {"loc": [(1, (0, 0, 0)), (6, (0, 0.008, -0.018)),
                         (n, (0, -0.010, -0.028))],
                 "rot": [(1, (0, 0, 0)), (6, (5, 0, 0)), (n, (-7, 0, 0))]}
    t.update(fp_grip(n, 0.5))
    return t


def clip_fp_jump_loop(n=21):
    """Airborne and looping. Almost nothing: at the top of a jump the hands are
    steady relative to the head, and a big float here reads as a bug."""
    t = {}
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(n, 6, lambda x: (
            -11 + rc.wave(x, 2.0), 0, 0))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 6, lambda x: (
            -14 + rc.wave(x, 2.6, phase=0.3), 0, 0))}
    t["Root"] = {"loc": rc.keys(n, 6, lambda x: (
        0, 0, -0.026 + rc.wave(x, 0.004))),
        "rot": rc.keys(n, 6, lambda x: (-7 + rc.wave(x, 1.2), 0, 0))}
    t.update(fp_grip(n, 0.5))
    return t


def clip_fp_jump_land(n=17):
    """The impact. The camera stops dead and the arms keep going, so the model
    punches DOWN through the frame on frame 5 and recovers. The whole read of a
    landing in first person is this one dip."""
    t = _both({}, [(1, {"Arm": (-6, 0, 0), "ForeArm": (-8, 0, 0)}),
                   (5, {"Arm": (7, 0, 0), "ForeArm": (6, 0, 0)}),
                   (10, {"Arm": (2, 0, 0), "ForeArm": (1, 0, 0)}),
                   (n, {"Arm": (0, 0, 0), "ForeArm": (0, 0, 0)})])
    t["Root"] = {"loc": [(1, (0, 0, -0.014)), (5, (0, 0.014, -0.026)),
                         (10, (0, 0.003, -0.008)), (n, (0, 0, 0))],
                 "rot": [(1, (-3, 0, 0)), (5, (5, 0, 0)), (10, (-1, 0, 0)),
                         (n, (0, 0, 0))]}
    t.update(fp_grip(n, 0.7))
    return t


def clip_fp_fall(n=21):
    """A long fall: the arms come up and the model rides slightly high in the
    frame, with a slow flutter so it reads as air rather than as a pause."""
    t = {}
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(n, 8, lambda x, s=s: (
            -10 + rc.wave(x, 3.0), 0, s * rc.wave(x, 1.5, phase=0.2)))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 8, lambda x: (
            -13 + rc.wave(x, 3.5, phase=0.35), 0, 0))}
    t["Root"] = {"loc": rc.keys(n, 8, lambda x: (
        rc.wave(x, 0.006, phase=0.3), 0, -0.014 + rc.wave(x, 0.008))),
        "rot": rc.keys(n, 8, lambda x: (-9 + rc.wave(x, 2.0), 0, 0))}
    t.update(fp_grip(n, 0.45))
    return t


def _fp_swing(n, impact, raise_deg, drive_deg, twist, fore_hi, fore_lo):
    wind = max(2, impact - 10)
    settle = impact + max(4, (n - impact) // 3)
    t = _both({}, [
        (1, {"Arm": (0, 0, 0), "ForeArm": (0, 0, 0)}),
        (wind, {"Arm": (raise_deg, 0, twist), "ForeArm": (fore_hi, 0, 0)}),
        (impact, {"Arm": (drive_deg, 0, -twist * 0.5), "ForeArm": (fore_lo, 0, 0)}),
        (settle, {"Arm": (drive_deg * 0.55, 0, 0),
                  "ForeArm": (fore_lo * 0.5, 0, 0)}),
        (n, {"Arm": (0, 0, 0), "ForeArm": (0, 0, 0)}),
    ])
    # The hands must stay IN FRAME through the whole swing. A view model is not
    # a third-person body: the camera is bolted to the eye, so a 54 degree
    # drive that looks powerful on the body renders as an empty screen here.
    # The travel is carried by the tool, not by the arms.
    # RAISED at the impact frame, not lowered. The hands now sit at 0.62 m from
    # the eye instead of 0.435, so a given angle at the shoulder moves them
    # further down the frame than it used to: the old +6 degree Root tip alone
    # was 0.065 m of drop and it put both hands under the bottom edge on frame
    # 17. The punch is carried by the FORWARD surge and by the tool, and the
    # vertical stays positive all the way through.
    t["Root"] = {"loc": [(1, (0, 0, 0)), (wind, (0, 0.026, 0.014)),
                         (impact, (0, -0.052, 0.004)), (settle, (0, -0.014, 0.002)),
                         (n, (0, 0, 0))],
                 "rot": [(1, (0, 0, 0)), (wind, (-3, 0, 0)),
                         (impact, (2, 0, 0)), (settle, (1, 0, 0)),
                         (n, (0, 0, 0))]}
    # The fist closes into the impact and opens on the follow-through. It is
    # four keys and it is the difference between a tool being SWUNG and a tool
    # being carried past the camera.
    for pre, _s in SIDES:
        for b in rc.finger_bones(pre, ["Index", "Middle"]):
            t[b] = {"rot": [(1, (8, 0, 0)), (wind, (5, 0, 0)),
                            (impact, (17, 0, 0)), (settle, (12, 0, 0)),
                            (n, (8, 0, 0))]}
        for b in rc.finger_bones(pre, ["Thumb"]):
            t[b] = {"rot": [(1, (5, 0, 0)), (impact, (11, 0, 0)),
                            (n, (5, 0, 0))]}
    return t


def clip_fp_swing_pickaxe(n=33):
    return _fp_swing(n, 17, raise_deg=-7, drive_deg=7, twist=4,
                     fore_hi=-5, fore_lo=3)


def clip_fp_swing_axe(n=35):
    return _fp_swing(n, 18, raise_deg=-6, drive_deg=6, twist=7,
                     fore_hi=-4, fore_lo=2)


def clip_fp_dig(n=31):
    return _fp_swing(n, 16, raise_deg=-5, drive_deg=9, twist=2,
                     fore_hi=-3, fore_lo=5)


def clip_fp_place(n=25):
    """The right hand pushes the ghost into place, the left steadies it."""
    t = {
        "RightArm": {"rot": [(1, (0, 0, 0)), (9, (-11, 0, -3)),
                             (15, (-6, 0, -2)), (n, (0, 0, 0))]},
        "RightForeArm": {"rot": [(1, (0, 0, 0)), (9, (-26, 0, 0)),
                                 (15, (-12, 0, 0)), (n, (0, 0, 0))]},
        "LeftArm": {"rot": [(1, (0, 0, 0)), (9, (-5, 0, 2)), (15, (-3, 0, 1)),
                            (n, (0, 0, 0))]},
        "LeftForeArm": {"rot": [(1, (0, 0, 0)), (9, (-14, 0, 0)),
                                (15, (-8, 0, 0)), (n, (0, 0, 0))]},
        "Root": {"loc": [(1, (0, 0, 0)), (9, (0, -0.055, -0.010)),
                         (15, (0, -0.030, -0.005)), (n, (0, 0, 0))]},
    }
    t.update(fp_grip(n, 0.2))
    for b in rc.finger_bones("Right"):
        t[b] = {"rot": [(1, (4, 0, 0)), (9, (-14, 0, 0)), (15, (20, 0, 0)),
                        (n, (4, 0, 0))]}
    return t


def clip_fp_craft(n=61):
    """Both hands working on something held between them, one second, looping.
    The fingers carry it: the hands are most of the frame."""
    t = {}
    for pre, s, ph in (("Left", 1.0, 0.0), ("Right", -1.0, 0.5)):
        t[pre + "Arm"] = {"rot": rc.keys(n, 8, lambda x, s=s, ph=ph: (
            -10 + rc.wave(x, 4, phase=ph), 0, s * (3 + rc.wave(x, 2.5, phase=ph))))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 8, lambda x, ph=ph: (
            -13 + rc.wave(x, 5, phase=ph + 0.25), 0, 0))}
        for b in rc.finger_bones(pre, ["Index", "Middle"]):
            t[b] = {"rot": rc.keys(n, 8, lambda x, ph=ph: (
                12 + rc.wave(x, 13, phase=ph), 0, 0))}
        for b in rc.finger_bones(pre, ["Thumb"]):
            t[b] = {"rot": rc.keys(n, 8, lambda x, ph=ph: (
                8 + rc.wave(x, 9, phase=ph + 0.5), 0, 0))}
    t["Root"] = {"loc": rc.keys(n, 8, lambda x: (0, 0, rc.wave(x, 0.006, cycles=2)))}
    return t


CLIPS = [
    ("FP_Idle", clip_fp_idle), ("FP_Walk_Bob", clip_fp_walk_bob),
    ("FP_Run_Bob", clip_fp_run_bob),
    ("FP_Jump_Start", clip_fp_jump_start), ("FP_Jump_Loop", clip_fp_jump_loop),
    ("FP_Jump_Land", clip_fp_jump_land), ("FP_Fall", clip_fp_fall),
    ("FP_Swing_Pickaxe", clip_fp_swing_pickaxe),
    ("FP_Swing_Axe", clip_fp_swing_axe), ("FP_Dig", clip_fp_dig),
    ("FP_Place", clip_fp_place), ("FP_Craft", clip_fp_craft),
]


def main():
    of.reset_scene()
    arm_obj = of.add_armature(NAME, rc.FP_BONES)

    mb, lod0 = build_mesh(NAME + "_LOD0", arm_obj)
    segs = of.bone_segments(rc.FP_BONES)
    groups = of.solve_weights(mb.verts, mb.vert_bones, segs)
    sums = [0.0] * len(mb.verts)
    for bone, pairs in groups.items():
        for i, w in pairs:
            sums[i] += w
    print("[fp_arms] scripted weights: %d verts, %d bones used, "
          "weight sum %.4f to %.4f" % (len(mb.verts), len(groups),
                                       min(sums), max(sums)))
    of.bind_skin(lod0, arm_obj, groups)

    # No LOD chain and no collision proxy: first person is always near, and the
    # view model never collides with anything (ASSET-SPECS 4.2).
    # The socket sits IN the fist, not on the hand bone's tail. The tail is on
    # the palm's centre line, and with the client's FP_CARRY_TILT the haft
    # then rides across the top of the knuckle plate instead of through the
    # grip. Dropping it 32 mm and pushing it 10 mm forward puts it where the
    # fingers close. Verified by rendering the pickaxe parented here, not by
    # assuming: the tool moves with the hand and the hand moved a long way.
    grip = (rc._FP_HAND[0], rc._FP_HAND[1] - 0.010, rc._FP_HAND[2] - 0.032)
    of.add_bone_socket("socket_hand_R", arm_obj, "RightHand",
                       _pt(grip, -1.0), extras={"of_role": "hand_r"})
    of.add_bone_socket("socket_hand_L", arm_obj, "LeftHand",
                       _pt(grip, 1.0), extras={"of_role": "hand_l"})

    for name, fn in CLIPS:
        of.pose_clip(arm_obj, name, fn())
    if arm_obj.animation_data:
        arm_obj.animation_data.action = None
    bpy.context.scene.frame_set(int(of.clip_frame(1)))

    lo, hi = mb.bounds()
    print("[fp_arms] bounds blender x %.4f..%.4f  y %.4f..%.4f  z %.4f..%.4f"
          % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    print("[fp_arms] envelope three.js xyz [%.4f, %.4f, %.4f]"
          % (hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]))
    of.report(NAME, [("LOD0", mb)])
    print("[fp_arms] clips: %d, bones: %d" % (len(CLIPS), len(rc.FP_BONES)))
    of.export_glb(OUT)


import bpy  # noqa: E402

if __name__ == "__main__":
    main()
