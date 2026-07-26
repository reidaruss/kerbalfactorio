"""rig_common.py - the player skeleton, shared by the body and the FP arms.

    build_player_body.py       44 bones, 14 clips, third person
    build_player_fp_arms.py    27 bones,  8 clips, view model

THE BONE NAMES ARE THE CONTRACT. They are structurally the Mixamo skeleton
(same hierarchy, same T-pose rest) with clean unprefixed names, so any CC0
Mixamo clip retargets through a rename map, and both player assets bind to the
same names so one animation layer drives both.

WHAT LIVES HERE
  BODY_BONES / FP_BONES   the two skeletons, as (name, head, tail, parent)
  mirror()                one authored side becomes two
  keys()                  sample a pose function into keyframes
  tube() / stack()        the two skinnable primitives

WHY A TUBE AND NOT A BOX. Every other asset in this game is boxes, because a
box is free and reads correctly for a machine. A limb is different: a skinned
box has vertices only at its two ends, so bending a joint inside it shears the
whole panel. A tube carries a ring AT the joint, which is where the 50/50 weight
blend lands, so the bend happens at the joint and the panels either side stay
straight. That single property is most of what makes the deformation acceptable
without hand-painted weights.
"""

import math


# ---------------------------------------------------------------------------
# Skeleton. Blender axes: +X is the character's LEFT, -Y is forward, +Z is up.
# Metres, matching ASSET-SPECS 4.1: 1.80 m tall, 1.80 m arm span, shoulders at
# 1.45, hips at 0.95, eyes at 1.65.
# ---------------------------------------------------------------------------

SHOULDER_Z = 1.45
HIP_Z = 0.95
EYE_Z = 1.65

_SPINE = [
    ("Root", (0.0, 0.0, 0.0), (0.0, 0.0, 0.14), None),
    ("Hips", (0.0, 0.0, HIP_Z), (0.0, 0.0, 1.06), "Root"),
    ("Spine", (0.0, 0.0, 1.06), (0.0, 0.0, 1.18), "Hips"),
    ("Spine1", (0.0, 0.0, 1.18), (0.0, 0.0, 1.30), "Spine"),
    ("Spine2", (0.0, 0.0, 1.30), (0.0, 0.0, 1.44), "Spine1"),
    ("Neck", (0.0, 0.0, 1.44), (0.0, 0.0, 1.54), "Spine2"),
    ("Head", (0.0, 0.0, 1.54), (0.0, 0.0, 1.70), "Neck"),
    ("HeadTop_End", (0.0, 0.0, 1.70), (0.0, 0.0, 1.80), "Head"),
]

# Finger chains: thumb, index, and ONE merged middle block standing in for the
# remaining three fingers. Three chains per hand, not five: enough to sell a
# tool grip, and it saves twelve bones (ASSET-SPECS 4.1).
_FINGERS = [
    ("Thumb", (0.770, -0.035, 1.434), [(0.815, -0.050, 1.431),
                                       (0.845, -0.058, 1.429),
                                       (0.868, -0.062, 1.427)]),
    ("Index", (0.790, -0.018, 1.452), [(0.828, -0.020, 1.450),
                                       (0.862, -0.021, 1.448),
                                       (0.890, -0.022, 1.446)]),
    ("Middle", (0.790, 0.018, 1.450), [(0.828, 0.020, 1.448),
                                       (0.862, 0.021, 1.446),
                                       (0.890, 0.022, 1.444)]),
]


def _mirror_pt(p, s):
    return (p[0] * s, p[1], p[2])


def _arm_bones(side, s, parent):
    """One arm chain: shoulder, upper, fore, hand, three finger chains."""
    pre = "Left" if side == "L" else "Right"
    out = [
        (pre + "Shoulder", _mirror_pt((0.040, 0.0, 1.420), s),
         _mirror_pt((0.170, 0.0, SHOULDER_Z), s), parent),
        (pre + "Arm", _mirror_pt((0.170, 0.0, SHOULDER_Z), s),
         _mirror_pt((0.450, 0.0, SHOULDER_Z), s), pre + "Shoulder"),
        (pre + "ForeArm", _mirror_pt((0.450, 0.0, SHOULDER_Z), s),
         _mirror_pt((0.700, 0.0, SHOULDER_Z), s), pre + "Arm"),
        (pre + "Hand", _mirror_pt((0.700, 0.0, SHOULDER_Z), s),
         _mirror_pt((0.790, 0.0, SHOULDER_Z), s), pre + "ForeArm"),
    ]
    for fname, head, tails in _FINGERS:
        prev_name, prev_pt = pre + "Hand", head
        for i, tail in enumerate(tails):
            bname = "%sHand%s%d" % (pre, fname, i + 1)
            out.append((bname, _mirror_pt(prev_pt, s), _mirror_pt(tail, s),
                        prev_name))
            prev_name, prev_pt = bname, tail
    return out


def _leg_bones(side, s, parent):
    pre = "Left" if side == "L" else "Right"
    chain = [(pre + "UpLeg", (0.100, 0.000, 0.920), (0.100, 0.000, 0.510), parent),
             (pre + "Leg", (0.100, 0.000, 0.510), (0.100, 0.000, 0.100), pre + "UpLeg"),
             (pre + "Foot", (0.100, 0.000, 0.100), (0.100, -0.100, 0.035), pre + "Leg"),
             (pre + "ToeBase", (0.100, -0.100, 0.035), (0.100, -0.180, 0.025), pre + "Foot"),
             (pre + "Toe_End", (0.100, -0.180, 0.025), (0.100, -0.220, 0.025), pre + "ToeBase")]
    return [(n, _mirror_pt(h, s), _mirror_pt(t, s), p) for n, h, t, p in chain]


BODY_BONES = (_SPINE
              + _arm_bones("L", 1.0, "Spine2") + _arm_bones("R", -1.0, "Spine2")
              + _leg_bones("L", 1.0, "Hips") + _leg_bones("R", -1.0, "Hips"))

# The first-person arms carry the SAME bone names and the same hierarchy from
# the shoulders down, plus a Root, and nothing else: 27 bones. See ASSET-SPECS
# 4.2 for why its BIND POSE is the view-model rest rather than the T-pose.
FP_ARM_BONES = (_arm_bones("L", 1.0, "Root") + _arm_bones("R", -1.0, "Root"))

ARM_CHAIN = ["Shoulder", "Arm", "ForeArm", "Hand"]
FINGER_CHAINS = ["Thumb", "Index", "Middle"]


def side_bones(pre, parts):
    return [pre + p for p in parts]


def finger_bones(pre, which=None):
    out = []
    for f in (which or FINGER_CHAINS):
        out += ["%sHand%s%d" % (pre, f, i) for i in (1, 2, 3)]
    return out


# ---------------------------------------------------------------------------
# Clip authoring helpers
# ---------------------------------------------------------------------------

def keys(frames, samples, fn):
    """Sample a pose function into `samples`+1 keyframes over 1..frames.

    fn(t) takes t in [0, 1] and returns whatever pose_clip accepts: an
    (rx, ry, rz) triple or an ordered [(axis, degrees), ...] list. Sampling
    rather than hand-listing keys is what keeps a 121-frame idle to two lines
    and keeps a cycle exactly periodic: fn(0) and fn(1) are the same call."""
    return [(1 + int(round((frames - 1) * i / float(samples))), fn(i / float(samples)))
            for i in range(samples + 1)]


def wave(t, amp, cycles=1.0, phase=0.0, offset=0.0):
    return offset + amp * math.sin(2.0 * math.pi * (cycles * t + phase))


_MIRROR_NAME = (("Left", "\x00"), ("Right", "Left"), ("\x00", "Right"))


def _swap_side(name):
    for a, b in _MIRROR_NAME:
        name = name.replace(a, b)
    return name


def _mirror_rot(rot):
    """Reflect a rotation through the YZ plane.

    M R M with M = diag(-1, 1, 1) leaves an X rotation alone and negates Y and
    Z, and because M (ABC) M = (MAM)(MBM)(MCM) the same rule applies term by
    term to an ordered composition. That is the whole of 'author one side'."""
    if len(rot) == 3 and all(isinstance(v, (int, float)) for v in rot):
        return (rot[0], -rot[1], -rot[2])
    return [(ax, deg if ax == "X" else -deg) for ax, deg in rot]


def mirror(tracks):
    """Left-side tracks become right-side tracks. Returns a NEW dict holding
    both sides, so a symmetric clip is authored once."""
    out = dict(tracks)
    for bone, chans in tracks.items():
        other = _swap_side(bone)
        if other == bone:
            continue
        m = {}
        if chans.get("rot"):
            m["rot"] = [(f, _mirror_rot(r)) for f, r in chans["rot"]]
        if chans.get("loc"):
            m["loc"] = [(f, (-v[0], v[1], v[2])) for f, v in chans["loc"]]
        out[other] = m
    return out


def merge(*track_dicts):
    """Combine track dicts. Later dicts win per bone, which is how a clip
    layers a leg cycle on top of a crouch pose without restating the crouch."""
    out = {}
    for d in track_dicts:
        for bone, chans in d.items():
            out.setdefault(bone, {}).update(chans)
    return out


# ---------------------------------------------------------------------------
# Skinnable geometry
# ---------------------------------------------------------------------------

def _basis(direction, ref):
    d = list(direction)
    n = math.sqrt(sum(c * c for c in d)) or 1.0
    d = [c / n for c in d]
    # project the carried reference onto the plane perpendicular to d
    dot = sum(ref[k] * d[k] for k in range(3))
    u = [ref[k] - d[k] * dot for k in range(3)]
    un = math.sqrt(sum(c * c for c in u))
    if un < 1e-6:
        seed = (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)
        dot = sum(seed[k] * d[k] for k in range(3))
        u = [seed[k] - d[k] * dot for k in range(3)]
        un = math.sqrt(sum(c * c for c in u))
    u = [c / un for c in u]
    v = [d[1] * u[2] - d[2] * u[1],
         d[2] * u[0] - d[0] * u[2],
         d[0] * u[1] - d[1] * u[0]]
    return d, u, v


def tube(points, radii, seg=10, closed_caps=True):
    """A closed tube through a polyline, one ring per point.

    The rings are parallel-transported (each ring's frame is carried from the
    previous one rather than rebuilt from a fixed up vector), so a bent tube -
    the first-person forearm - does not twist between rings.

    Returns (verts, faces, smooth) for MeshBuilder.add_raw."""
    n = len(points)
    ref = [0.0, 0.0, 1.0]
    verts, ring_start = [], []
    for i in range(n):
        if i == 0:
            d = [points[1][k] - points[0][k] for k in range(3)]
        elif i == n - 1:
            d = [points[i][k] - points[i - 1][k] for k in range(3)]
        else:
            d = [points[i + 1][k] - points[i - 1][k] for k in range(3)]
        d, u, v = _basis(d, ref)
        ref = u
        ring_start.append(len(verts))
        r = radii[i]
        for j in range(seg):
            a = 2.0 * math.pi * j / seg
            ca, sa = math.cos(a) * r, math.sin(a) * r
            verts.append(tuple(points[i][k] + u[k] * ca + v[k] * sa
                               for k in range(3)))
    faces, smooth = [], []
    for i in range(n - 1):
        lo, hi = ring_start[i], ring_start[i + 1]
        for j in range(seg):
            k = (j + 1) % seg
            faces.append((lo + j, lo + k, hi + k, hi + j))
            smooth.append(True)
    if closed_caps:
        faces.append(tuple(range(seg - 1, -1, -1)))
        smooth.append(False)
        last = ring_start[-1]
        faces.append(tuple(range(last, last + seg)))
        smooth.append(False)
    return verts, faces, smooth


def stack(rings):
    """A closed rectangular prism through rings of (centre_xyz, half_x, half_y).

    The torso, the pelvis and the boots. A per-ring centre is what lets the
    boot tilt forward as it rises without any rotation machinery."""
    verts = []
    for (cx, cy, cz), hx, hy in rings:
        verts += [(cx - hx, cy - hy, cz), (cx + hx, cy - hy, cz),
                  (cx + hx, cy + hy, cz), (cx - hx, cy + hy, cz)]
    faces = [(0, 3, 2, 1)]
    for b in range(len(rings) - 1):
        lo, hi = b * 4, (b + 1) * 4
        for i in range(4):
            j = (i + 1) % 4
            faces.append((lo + i, lo + j, hi + j, hi + i))
    top = (len(rings) - 1) * 4
    faces.append((top, top + 1, top + 2, top + 3))
    return verts, faces, [False] * len(faces)
