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

# ---------------------------------------------------------------------------
# The first-person arms: the SAME bone names and the same hierarchy from the
# shoulders down, plus a Root, and nothing else. 27 bones.
#
# Its BIND POSE is the view-model rest - arms held forward into the lower third
# of the view - not the T-pose. Three reasons, recorded in ASSET-SPECS 4.2:
# the declared bounds are the posed bounds and a T-posed arm subset is 1.80 m
# wide; a view model is never retargeted from Mixamo, so the T-pose buys
# nothing here; and weights authored in the pose the model will actually be
# seen in are better weights. What the two assets share is the NAME and
# hierarchy contract, which is what lets one animation layer drive both.
#
# The origin is the CAMERA POINT, so the model attaches to the camera with an
# identity transform.
#
# 2026-07-27, THE FRAMING. Reid played the game and reported the on-screen
# hands as "large white mitts". They were, and it was arithmetic rather than
# taste: the hand sat 0.435 m from the camera, and at the client's roughly 70
# degree vertical FOV the visible height at that distance is 0.61 m, so a
# 0.10 m glove was a sixth of the screen. Two of them plus the forearms coming
# at the lens is the mitt. The hands now sit at 0.62 m (visible height 0.87 m)
# and 0.30 m below the eye, the elbows come in from 0.388 to 0.360 so the carry
# is narrower, and the forearms are thinner.
# ---------------------------------------------------------------------------

_FP_SHOULDER = (0.105, 0.055, -0.150)
_FP_ELBOW_IN = (0.235, -0.030, -0.205)     # deltoid, where the upper arm starts
_FP_ELBOW = (0.367, -0.165, -0.335)
_FP_WRIST = (0.222, -0.500, -0.300)
_FP_HAND = (0.200, -0.620, -0.302)

# One entry per finger CHAIN: (knuckle offset from _FP_HAND, three segment
# vectors). The old rig gave every finger ONE straight direction repeated three
# times, 0.165 m long, which is why the hands read as a cone with three prongs
# stuck in the end. A finger is 0.075 m and it CURLS: each segment angles
# further down than the last, so the hand has a knuckle line, a silhouette and
# a readable grip at 0.62 m. Blender axes, unmirrored (the character's LEFT).
_FP_FINGERS = (
    # The thumb springs from the SIDE of the palm, well back of the knuckle
    # line, and runs forward and inboard while the fingers run forward and
    # down. Being on a genuinely different axis is what makes it read as a
    # thumb; the old rig fanned all three chains the same way and the thumb
    # simply merged into the mass at this camera angle.
    ("Thumb", (-0.034, 0.032, -0.014),
     ((-0.026, -0.019, 0.001), (-0.015, -0.021, -0.008),
      (-0.006, -0.015, -0.012))),
    ("Index", (-0.030, -0.020, 0.005),
     ((-0.004, -0.031, -0.013), (-0.002, -0.016, -0.024),
      (0.000, -0.007, -0.018))),
    ("Middle", (0.012, -0.019, 0.003),
     ((0.002, -0.032, -0.013), (0.001, -0.017, -0.026),
      (0.000, -0.006, -0.020))),
)

# The Middle chain stands in for the middle, ring and little fingers, and it now
# carries THREE tubes instead of one fat block: three fingers' worth of
# silhouette for zero extra bones, because a tube offset from the chain it is
# whitelisted to still curls with it. (offset from the chain, radius, length).
#
# RN-857 RE-SPACES AND THINS THEM, and it is arithmetic rather than taste.
# TWO CIRCLES ARE SEPARATE ONLY WHEN THEIR CENTRES ARE FURTHER APART THAN THE
# SUM OF THEIR RADII, and measured off the old table every adjacent pair
# failed that test:
#
#   Index    to Middle-1   centres 31.0 mm apart, radii sum 43.0   OVERLAP 12.0
#   Middle-1 to Middle-2   centres 23.0 mm apart, radii sum 41.5   OVERLAP 18.5
#   Middle-2 to Middle-3   centres 21.0 mm apart, radii sum 37.0   OVERLAP 16.0
#
# So the five tubes were one fused solid and the hand COULD NOT show a gap
# between two fingers at any pose, from any camera, under any lighting. That
# is why it read as a webbed paddle: the webbing was not missing detail, it
# was the tubes intersecting. A finger was also 43 mm across against a real
# adult finger's 18 to 20.
#
# The new radii are a padded glove's, about 24 mm across a finger, and the
# offsets put every adjacent pair 1.4 to 2.8 mm APART. `_assert_fp_fingers`
# below checks that rather than trusting this comment, because the numbers are
# close enough that a later nudge could re-fuse them without anything looking
# obviously wrong in the source.
_FP_MIDDLE_TUBES = (((-0.017, 0.000, 0.002), 0.0118, 1.00),
                    ((0.008, 0.000, 0.000), 0.0110, 0.94),
                    ((0.031, -0.005, -0.007), 0.0092, 0.82))

_FP_FINGER_R = {"Thumb": 0.0140, "Index": 0.0118, "Middle": 0.0118}


def _assert_fp_fingers():
    """No two finger tubes may intersect at the knuckle line.

    Cheap, and it is the check that would have caught the defect this table
    was rewritten to fix. It runs at import, so a build that fuses the fingers
    fails in the build rather than in a render nobody happens to look at."""
    root_x = {n: r[0] for n, r, _s in _FP_FINGERS}
    tubes = [("Index", root_x["Index"], _FP_FINGER_R["Index"])]
    for i, (off, rad, _sc) in enumerate(_FP_MIDDLE_TUBES):
        tubes.append(("Middle-%d" % (i + 1), root_x["Middle"] + off[0], rad))
    tubes.sort(key=lambda t: t[1])
    for (na, xa, ra), (nb, xb, rb) in zip(tubes, tubes[1:]):
        gap = abs(xb - xa) - (ra + rb)
        if gap <= 0.0:
            raise ValueError(
                "FP fingers %s and %s intersect: centres %.1f mm apart, radii "
                "sum %.1f mm. The hand cannot show a gap between them."
                % (na, nb, abs(xb - xa) * 1000.0, (ra + rb) * 1000.0))
    return tubes


_FP_FINGER_LAYOUT = _assert_fp_fingers()


def fp_finger_points(fname, scale=1.0, offset=(0.0, 0.0, 0.0)):
    """The four joint points of one FP finger, unmirrored.

    [knuckle, joint1, joint2, tip]. `scale` shortens the whole chain (the
    little finger) and `offset` slides it sideways across the knuckle line,
    which is how one bone chain carries three finger tubes."""
    for name, root, segs in _FP_FINGERS:
        if name != fname:
            continue
        p = tuple(_FP_HAND[k] + root[k] + offset[k] for k in range(3))
        out = [p]
        for seg in segs:
            p = tuple(p[k] + seg[k] * scale for k in range(3))
            out.append(p)
        return out
    raise KeyError("no FP finger chain named %r" % fname)


def _fp_arm(side, s):
    pre = "Left" if side == "L" else "Right"
    out = [
        (pre + "Shoulder", _mirror_pt(_FP_SHOULDER, s),
         _mirror_pt(_FP_ELBOW_IN, s), "Root"),
        (pre + "Arm", _mirror_pt(_FP_ELBOW_IN, s), _mirror_pt(_FP_ELBOW, s),
         pre + "Shoulder"),
        (pre + "ForeArm", _mirror_pt(_FP_ELBOW, s), _mirror_pt(_FP_WRIST, s),
         pre + "Arm"),
        (pre + "Hand", _mirror_pt(_FP_WRIST, s), _mirror_pt(_FP_HAND, s),
         pre + "ForeArm"),
    ]
    for fname, _root, _segs in _FP_FINGERS:
        pts = fp_finger_points(fname)
        prev_name = pre + "Hand"
        for i in range(3):
            bname = "%sHand%s%d" % (pre, fname, i + 1)
            out.append((bname, _mirror_pt(pts[i], s), _mirror_pt(pts[i + 1], s),
                        prev_name))
            prev_name = bname
    return out


FP_BONES = ([("Root", (0.0, 0.0, 0.0), (0.0, -0.12, 0.0), None)]
            + _fp_arm("L", 1.0) + _fp_arm("R", -1.0))

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

    Authored frames are 1-based; of_lib.clip_frame maps frame 1 to t = 0, so an
    `frames`-frame clip exports as a span of (frames - 1)/60 s.

    fn(t) takes t in [0, 1] and returns whatever pose_clip accepts: an
    (rx, ry, rz) triple or an ordered [(axis, degrees), ...] list. Sampling
    rather than hand-listing keys is what keeps a 121-frame idle to two lines
    and keeps a cycle exactly periodic: fn(0) and fn(1) are the same call."""
    return [(1 + int(round((frames - 1) * i / float(samples))), fn(i / float(samples)))
            for i in range(samples + 1)]


def wave(t, amp, cycles=1.0, phase=0.0, offset=0.0):
    return offset + amp * math.sin(2.0 * math.pi * (cycles * t + phase))


def ramp(x, knots):
    """Piecewise-linear lookup. knots is [(t, value), ...] ascending in t.

    A gait is a SHAPE, not a sine. The contact phase of a step is a straight
    line - the planted foot moves backward relative to the hip at exactly the
    ground speed - and the swing phase is not. `wave` cannot express a foot
    plant at all, which is the whole reason the run used to skate."""
    if x <= knots[0][0]:
        return knots[0][1]
    for i in range(1, len(knots)):
        t0, v0 = knots[i - 1]
        t1, v1 = knots[i]
        if x <= t1:
            f = 0.0 if t1 <= t0 else (x - t0) / (t1 - t0)
            return v0 + (v1 - v0) * f
    return knots[-1][1]


# Thigh and shank lengths read straight off BODY_BONES: hip 0.920 -> knee 0.510
# -> ankle 0.100. They are here so leg_ik and the skeleton cannot drift apart.
THIGH_LEN = 0.410
SHANK_LEN = 0.410


def leg_ik(fwd, drop, thigh=THIGH_LEN, shank=SHANK_LEN):
    """Planar two-link solve for one leg -> (hip_deg, knee_deg, shank_fwd_deg).

    `fwd` is how far the ANKLE is in front of the hip and `drop` how far below
    it, metres, in the sagittal plane. The three returned angles are degrees in
    this rig's own sign convention:

      hip_deg        the UpLeg X rotation. Negative swings the leg forward,
                     because +X rotation carries a bone pointing down toward
                     +Y, and +Y is backward.
      knee_deg       the Leg X rotation, relative to the posed thigh. Positive
                     is flexion, heel toward the seat.
      shank_fwd_deg  the shank's forward lean from vertical. Not a channel: it
                     is what the Foot rotation has to CANCEL to keep the sole
                     flat on the ground, so a heel strike is `shank_fwd - 14`
                     and a toe-off is `shank_fwd + 40` and both mean what they
                     say regardless of what the rest of the leg is doing.

    WHY IK RATHER THAN A SINE. A sine moves the thigh FASTEST at the passing
    pose, which is precisely when the foot is planted and must be travelling
    backward at a constant ground speed, and slowest at the extremes, where the
    foot is in the air and should be whipping through. That is the skate, and no
    amount of tuning the amplitude fixes it because the shape is wrong. Solving
    the joints from an authored foot PATH inverts the problem: the path is the
    thing that has to be right and the angles fall out of it."""
    reach = (thigh + shank) * 0.997
    r = math.sqrt(fwd * fwd + drop * drop)
    if r < 1e-6:
        return 0.0, 0.0, 0.0
    if r > reach:
        fwd, drop, r = fwd * reach / r, drop * reach / r, reach
    c_knee = (thigh * thigh + shank * shank - r * r) / (2.0 * thigh * shank)
    knee = math.pi - math.acos(max(-1.0, min(1.0, c_knee)))
    c_beta = (r * r + thigh * thigh - shank * shank) / (2.0 * r * thigh)
    beta = math.acos(max(-1.0, min(1.0, c_beta)))
    hip_fwd = math.atan2(fwd, drop) + beta
    return (-math.degrees(hip_fwd), math.degrees(knee),
            math.degrees(hip_fwd - knee))


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


def oval_tube(points, radii_u, radii_v, seg=10, closed_caps=True,
              smooth_sides=True):
    """A closed tube of ELLIPTICAL section through a polyline.

    `radii_u` is the half-extent along the carried up reference (vertical for a
    roughly horizontal sweep) and `radii_v` the half-extent across it. A circle
    is the case radii_u == radii_v, which is what `tube` passes.

    This exists for the first-person hand. A hand is not round: it is roughly
    twice as wide as it is thick, and a round palm is exactly the shape that
    reads as a mitt. It also builds the knuckle plate and the boot cuff.

    `smooth_sides=False` flat-shades the side quads. The default is True and
    every caller written before 2026-08-01 keeps it, so nothing rebuilt.

    WHY FLAT IS NOT A DOWNGRADE (ART-DIRECTION.md). A smooth-shaded tube of
    seven or eight sides is a lie the shader tells: the normals claim a
    cylinder while the silhouette shows a heptagon, and the lit result is an
    even gradient with no edge anywhere on it. That is exactly the "smooth,
    unweathered" read the art direction now calls a defect. Flat shading gives
    the SAME triangles eight distinct lit values with hard boundaries between
    them, which is what makes a leg segment read as plate rather than as clay.
    It is the cheapest detail in this file: it costs zero triangles, and it
    costs vertices only where a hard edge is wanted."""
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
        ru, rv = radii_u[i], radii_v[i]
        for j in range(seg):
            a = 2.0 * math.pi * j / seg
            ca, sa = math.cos(a) * ru, math.sin(a) * rv
            verts.append(tuple(points[i][k] + u[k] * ca + v[k] * sa
                               for k in range(3)))
    faces, smooth = [], []
    for i in range(n - 1):
        lo, hi = ring_start[i], ring_start[i + 1]
        for j in range(seg):
            k = (j + 1) % seg
            faces.append((lo + j, lo + k, hi + k, hi + j))
            smooth.append(smooth_sides)
    if closed_caps:
        faces.append(tuple(range(seg - 1, -1, -1)))
        smooth.append(False)
        last = ring_start[-1]
        faces.append(tuple(range(last, last + seg)))
        smooth.append(False)
    return verts, faces, smooth


def tube(points, radii, seg=10, closed_caps=True, smooth_sides=True):
    """A closed tube through a polyline, one ring per point.

    The rings are parallel-transported (each ring's frame is carried from the
    previous one rather than rebuilt from a fixed up vector), so a bent tube -
    the first-person forearm - does not twist between rings.

    Returns (verts, faces, smooth) for MeshBuilder.add_raw."""
    return oval_tube(points, radii, radii, seg, closed_caps, smooth_sides)


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
