"""build_player_fp_arms.py - the first-person view model.

    blender --background --python tools/blender/build_player_fp_arms.py

Produces assets/models/dist/player/player_fp_arms.glb (ASSET-SPECS 4.2).

27 bones (the body rig's arm subset, identical names, plus Root), 8 clips,
two bone-parented sockets, one LOD.

THE ORIGIN IS THE CAMERA POINT, so the model attaches to the camera with an
identity transform, and the BIND POSE is the view-model rest rather than the
T-pose (rig_common explains why). Everything here is authored to be read at
0.35 m in front of the near plane: twelve-sided arm tubes rather than the
body's ten, a real wrist gap with skin showing, and separate finger blocks,
because at that distance the silhouette IS the model.

The impact frames of FP_Swing_Pickaxe (17), FP_Swing_Axe (18) and FP_Dig (16)
match the third-person clips exactly. They are a gameplay contract, not an
animation preference: harvestNode() fires on those frames whichever view the
player is in.
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


def _pt(p, s):
    return (p[0] * s, p[1], p[2])


def _lerp(a, b, t):
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


def build_mesh(name, arm_obj):
    mb = of.MeshBuilder()

    # Shallow chest stub: the bottom of the frame, and the thing that stops the
    # arms reading as two objects floating in space.
    mb.bind(["Root"])
    mb.add_raw(*rc.stack([((0.0, 0.010, -0.622), 0.150, 0.090),
                          ((0.0, 0.000, -0.510), 0.185, 0.105),
                          ((0.0, -0.010, -0.390), 0.175, 0.100)]), role=SUIT)

    sh, el_in, el, wr, hd = (rc._FP_SHOULDER, rc._FP_ELBOW_IN, rc._FP_ELBOW,
                             rc._FP_WRIST, rc._FP_HAND)
    for pre, s in SIDES:
        chain = [pre + "Shoulder", pre + "Arm", pre + "ForeArm", pre + "Hand"]
        mb.bind([pre + "Shoulder", pre + "Arm"])
        mb.add_raw(*rc.tube([_pt(sh, s), _pt(_lerp(sh, el_in, 0.55), s),
                             _pt(el_in, s)],
                            [0.082, 0.090, 0.084], seg=12), role=ACC)
        # one tube shoulder to wrist, with a ring exactly on the elbow
        mb.bind(chain)
        mb.add_raw(*rc.tube([_pt(_lerp(sh, el_in, 0.80), s),
                             _pt(_lerp(el_in, el, 0.5), s),
                             _pt(el, s), _pt(_lerp(el, wr, 0.5), s),
                             _pt(wr, s)],
                            [0.080, 0.072, 0.064, 0.058, 0.050], seg=12),
                   role=SUIT)
        mb.bind([pre + "Arm", pre + "ForeArm"])
        mb.add_raw(*rc.tube([_pt(_lerp(el_in, el, 0.86), s),
                             _pt(_lerp(el, wr, 0.14), s)],
                            [0.069, 0.069], seg=12), role=DARK)
        # wrist: a bare skin band between the cuff and the glove. It is two
        # rings of geometry and it is the only thing at this distance that says
        # there is a person inside the suit.
        # EVERY PART OVERLAPS THE JOINT IT CROSSES. A part that starts exactly
        # on its bone's head swings away from its neighbour the moment that
        # bone rotates, and opens a crack. On a machine that is invisible; on a
        # view model at 0.35 m it is the first thing the player sees. So the
        # skin band runs past the wrist into the palm, the glove starts behind
        # the wrist, and every finger starts half a segment inside the hand.
        mb.bind([pre + "ForeArm", pre + "Hand"])
        mb.add_raw(*rc.tube([_pt(_lerp(el, wr, 0.84), s),
                             _pt(_lerp(wr, hd, 0.22), s)],
                            [0.049, 0.047], seg=12), role=SKIN)
        mb.bind([pre + "Hand"])
        mb.add_raw(*rc.tube([_pt(_lerp(el, wr, 0.94), s),
                             _pt(_lerp(wr, hd, 0.55), s),
                             _pt(_lerp(wr, hd, 1.08), s)],
                            [0.050, 0.058, 0.052], seg=12), role=SUIT)
        for fname, off in rc._FP_FINGER_OFF.items():
            mb.bind(rc.finger_bones(pre, [fname]))
            head = tuple(hd[k] + off[k] for k in range(3))
            tip = tuple(head[k] + rc._FP_FINGER_DIR[k] * 2.2 for k in range(3))
            root = tuple(head[k] - rc._FP_FINGER_DIR[k] * 0.55 for k in range(3))
            r = 0.019 if fname != "Middle" else 0.027
            mb.add_raw(*rc.tube([_pt(root, s), _pt(head, s),
                                 _pt(_lerp(head, tip, 0.55), s), _pt(tip, s)],
                                [r * 0.92, r, r * 0.94, r * 0.82], seg=6),
                       role=SUIT)

    mb.bind(None)
    return mb, mb.build(name, arm_obj)


# ---------------------------------------------------------------------------
# Clips. Every FP bone's bind pose IS its rest pose, so unlike the third-person
# rig there is no base pose to compose against: a delta here is a plain
# armature-space rotation. Negative X raises the arms, positive X drives them
# down and forward.
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


def clip_fp_idle(n=121):
    t = {}
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(n, 8, lambda x, s=s: (
            rc.wave(x, 1.6), 0, s * rc.wave(x, 1.0, phase=0.2)))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 8, lambda x: (
            rc.wave(x, 1.2, phase=0.35), 0, 0))}
    t["Root"] = {"loc": rc.keys(n, 8, lambda x: (0, 0, rc.wave(x, 0.004)))}
    return t


def _bob(n, amp, roll, cycles=2.0):
    """A view-model bob is a motion of the WHOLE model, so it belongs on Root:
    one channel instead of twenty-six, and it stays in step with the camera
    bob the renderer applies."""
    return {"Root": {
        "loc": rc.keys(n, 8, lambda x: (rc.wave(x, amp * 0.9, phase=0.25),
                                        0.0, rc.wave(x, amp, cycles=cycles))),
        "rot": rc.keys(n, 8, lambda x: (rc.wave(x, roll * 0.6, cycles=cycles),
                                        rc.wave(x, roll, phase=0.25), 0))}}


def clip_fp_walk_bob(n=33):
    t = _bob(n, 0.014, 2.2)
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(n, 8, lambda x, s=s: (
            rc.wave(x, 3.0, phase=0.5 if s < 0 else 0.0), 0, 0))}
    return t


def clip_fp_run_bob(n=25):
    t = _bob(n, 0.030, 4.5)
    for pre, s in SIDES:
        t[pre + "Arm"] = {"rot": rc.keys(n, 8, lambda x, s=s: (
            8.0 + rc.wave(x, 7.0, phase=0.5 if s < 0 else 0.0), 0, 0))}
        t[pre + "ForeArm"] = {"rot": [(1, (-16, 0, 0)), (n, (-16, 0, 0))]}
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
    t["Root"] = {"loc": [(1, (0, 0, 0)), (wind, (0, 0.035, 0.020)),
                         (impact, (0, -0.075, -0.015)), (settle, (0, -0.02, -0.005)),
                         (n, (0, 0, 0))],
                 "rot": [(1, (0, 0, 0)), (wind, (-6, 0, 0)),
                         (impact, (6, 0, 0)), (settle, (2, 0, 0)),
                         (n, (0, 0, 0))]}
    return t


def clip_fp_swing_pickaxe(n=33):
    return _fp_swing(n, 17, raise_deg=-13, drive_deg=14, twist=10,
                     fore_hi=-9, fore_lo=4)


def clip_fp_swing_axe(n=35):
    return _fp_swing(n, 18, raise_deg=-11, drive_deg=12, twist=18,
                     fore_hi=-7, fore_lo=2)


def clip_fp_dig(n=31):
    return _fp_swing(n, 16, raise_deg=-8, drive_deg=18, twist=4,
                     fore_hi=-5, fore_lo=8)


def clip_fp_place(n=25):
    """The right hand pushes the ghost into place, the left steadies it."""
    t = {
        "RightArm": {"rot": [(1, (0, 0, 0)), (9, (-14, 0, -8)),
                             (15, (-8, 0, -6)), (n, (0, 0, 0))]},
        "RightForeArm": {"rot": [(1, (0, 0, 0)), (9, (-26, 0, 0)),
                                 (15, (-12, 0, 0)), (n, (0, 0, 0))]},
        "LeftArm": {"rot": [(1, (0, 0, 0)), (9, (-6, 0, 6)), (15, (-4, 0, 4)),
                            (n, (0, 0, 0))]},
        "LeftForeArm": {"rot": [(1, (0, 0, 0)), (9, (-14, 0, 0)),
                                (15, (-8, 0, 0)), (n, (0, 0, 0))]},
        "Root": {"loc": [(1, (0, 0, 0)), (9, (0, -0.055, -0.010)),
                         (15, (0, -0.030, -0.005)), (n, (0, 0, 0))]},
    }
    for b in rc.finger_bones("Right"):
        t[b] = {"rot": [(1, (0, 0, 0)), (9, (0, 0, 22)), (15, (0, 0, -10)),
                        (n, (0, 0, 0))]}
    return t


def clip_fp_craft(n=61):
    """Both hands working on something held between them, one second, looping.
    The fingers carry it: at 0.35 m the hands are most of the frame."""
    t = {}
    for pre, s, ph in (("Left", 1.0, 0.0), ("Right", -1.0, 0.5)):
        t[pre + "Arm"] = {"rot": rc.keys(n, 8, lambda x, s=s, ph=ph: (
            -10 + rc.wave(x, 4, phase=ph), 0, s * (8 + rc.wave(x, 5, phase=ph))))}
        t[pre + "ForeArm"] = {"rot": rc.keys(n, 8, lambda x, ph=ph: (
            -16 + rc.wave(x, 6, phase=ph + 0.25), 0, 0))}
        for b in rc.finger_bones(pre, ["Index", "Middle"]):
            t[b] = {"rot": rc.keys(n, 8, lambda x, s=s, ph=ph: (
                0, 0, s * (14 + rc.wave(x, 16, phase=ph))))}
        for b in rc.finger_bones(pre, ["Thumb"]):
            t[b] = {"rot": rc.keys(n, 8, lambda x, s=s, ph=ph: (
                0, 0, s * (10 + rc.wave(x, 10, phase=ph + 0.5))))}
    t["Root"] = {"loc": rc.keys(n, 8, lambda x: (0, 0, rc.wave(x, 0.006, cycles=2)))}
    return t


CLIPS = [
    ("FP_Idle", clip_fp_idle), ("FP_Walk_Bob", clip_fp_walk_bob),
    ("FP_Run_Bob", clip_fp_run_bob),
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
    of.add_bone_socket("socket_hand_R", arm_obj, "RightHand",
                       _pt(rc._FP_HAND, -1.0), extras={"of_role": "hand_r"})
    of.add_bone_socket("socket_hand_L", arm_obj, "LeftHand",
                       _pt(rc._FP_HAND, 1.0), extras={"of_role": "hand_l"})

    for name, fn in CLIPS:
        of.pose_clip(arm_obj, name, fn())
    if arm_obj.animation_data:
        arm_obj.animation_data.action = None
    bpy.context.scene.frame_set(1)

    of.report(NAME, [("LOD0", mb)])
    print("[fp_arms] clips: %d, bones: %d" % (len(CLIPS), len(rc.FP_BONES)))
    of.export_glb(OUT)


import bpy  # noqa: E402

if __name__ == "__main__":
    main()
