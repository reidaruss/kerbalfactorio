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

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import rig_common as rc  # noqa: E402

NAME = "PlayerFPArms"
OUT = of.dist_path("player", "player_fp_arms.glb")

SIDES = (("Left", 1.0), ("Right", -1.0))
SUIT, ACC, DARK, SKIN = "Suit", "SuitAccent", "SteelDark", "Skin"
GLOVE, PLATE, GRIME = "SuitDark", "Plate", "SuitGrime"

# THE HAND'S SECTION AT THE KNUCKLE LINE, and every other number on the hand
# is derived from these two (RN-857). They are half extents in metres, so the
# glove is 96 mm across and 42 mm thick.
#
# A real adult hand measures about 90 mm across the knuckles and 28 mm thick.
# A padded work glove is legitimately thicker than that and is not much wider,
# which is exactly the ratio here: the width is a hand's width and the
# thickness is a hand plus 7 mm of padding on each face.
#
# THE PREVIOUS VALUES WERE 130 mm ACROSS AND 86 mm THICK. Nothing was wrong
# with any single part of the old hand; the section was a mitten, so every
# part that sat on it inherited the mitten. Keeping the two numbers here, and
# deriving the palm rings, the finger radii and the knuckle plates from them,
# is what stops a later pass fixing one and leaving the others behind.
HAND_HALF_W = 0.048
HAND_HALF_T = 0.021

# The glove's first ring, i.e. the cuff mouth, as multiples of the two above.
# Named because THREE separate things depend on it: the palm's own first ring,
# the skin band that has to fit inside it, and the assertion below.
GLOVE_MOUTH_W, GLOVE_MOUTH_T = 0.79, 1.24

# The bare wrist's radius. A round tube has to fit inside an ELLIPSE, so the
# binding dimension is the ellipse's SHORT axis, never its long one. 0.86 of
# that leaves a 3 mm sleeve of glove all the way round.
WRIST_R = HAND_HALF_T * GLOVE_MOUTH_T * 0.86


def _assert_wrist_fits():
    """The glove's mouth must swallow the skin band's end.

    This file has always said so in a comment and nothing has ever checked it,
    which cost exactly one render in RN-857: re-proportioning the glove took
    its mouth below the skin tube's typed 45 mm radius and the bare wrist burst
    out of the cuff as an orange collar. A sentence in a comment is not an
    invariant; this is."""
    mouth_t = HAND_HALF_T * GLOVE_MOUTH_T
    mouth_w = HAND_HALF_W * GLOVE_MOUTH_W
    if WRIST_R >= min(mouth_t, mouth_w):
        raise ValueError(
            "the skin band's radius %.4f is not inside the glove mouth's "
            "%.4f x %.4f half extents: the wrist will poke out through the "
            "cuff" % (WRIST_R, mouth_w, mouth_t))
    return WRIST_R


_assert_wrist_fits()


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

        # THE WRIST DISCONNECT. RN-645.
        #
        # This was one 0.15-long OF_SuitAccent tube, and OF_SuitAccent is
        # 2E7DBE, a saturated primary blue. Under the corrected 60 degree FOV
        # it is the largest single block of colour in the first-person frame,
        # and ART-DIRECTION.md names pastel and saturated primaries as the
        # thing to unlearn: "value and material contrast do the work rather
        # than hue". It also could not be re-surfaced out of the problem,
        # because SuitAccent is shared with rocket_common.py and the lander.
        #
        # A pressure glove does not attach with a painted band. It attaches
        # with a METAL LOCKING RING, and that is both the honest object and
        # the one that fixes the frame: the ring is OF_Plate, so it wears
        # `suitplate` and reads as worn alloy, and the accent survives as a
        # 6 mm index stripe rather than a 150 mm slab. Same silhouette, one
        # hundredth of the saturated area.
        mb.bind([pre + "ForeArm", pre + "Hand"])
        # the ring proper: two courses, the outboard one slightly proud, so
        # there is a hard machined step where the sleeve ends
        mb.add_raw(*rc.tube([_pt(_lerp(el, wr, 0.645), s),
                             _pt(_lerp(el, wr, 0.700), s),
                             _pt(_lerp(el, wr, 0.760), s),
                             _pt(_lerp(el, wr, 0.800), s)],
                            [0.057, 0.062, 0.062, 0.055], seg=12),
                   role=PLATE)
        # THREE LATCH LUGS, at 40, 160 and 280 degrees around the ring.
        # Not four and not evenly on the axes: a lug on the top centre line
        # is the one place the camera looks straight down at, where it reads
        # as a lump rather than as hardware, and three at 120 degrees is what
        # a real bayonet fitting uses.
        for ang in (40.0, 160.0, 280.0):
            a = math.radians(ang)
            up = (0.0, 0.0, 0.011 * math.cos(a))
            side = (0.011 * math.sin(a) * s, 0.0, 0.0)
            c0 = _off(_off(_pt(_lerp(el, wr, 0.690), s), up), side)
            c1 = _off(_off(_pt(_lerp(el, wr, 0.775), s), up), side)
            mb.add_raw(*rc.oval_tube([c0, c1], [0.0075, 0.0068],
                                     [0.0135, 0.0120], seg=4), role=DARK)
        # the accent, reduced to an index stripe: the mark you line up to
        # seat the ring. 6 mm of the colour instead of 150.
        mb.add_raw(*rc.tube([_pt(_lerp(el, wr, 0.706), s),
                             _pt(_lerp(el, wr, 0.718), s)],
                            [0.0635, 0.0635], seg=12), role=ACC)
        # Bare skin, cuff to glove, running past the wrist into the palm.
        #
        # IT TAPERS TO A WRIST NOW (RN-857), and the reason is an invariant
        # this file already stated in prose and nothing checked. The glove's
        # first ring has to SWALLOW this tube's end, or the skin pokes out
        # through the glove as a collar. That held while the tube was a
        # constant 45 mm and the glove's first ring was 48 mm; re-proportioning
        # the glove took its first ring to 26 x 38 mm and the skin band
        # immediately burst out of it as a fat orange cuff, which the render
        # showed at once.
        #
        # So the last radius is DERIVED from the glove's own first ring rather
        # than typed beside it, and `_assert_wrist_fits` proves it. A real
        # forearm also narrows into the wrist, which this never did: 46 mm at
        # the cuff down to the glove's own section is an arm rather than a
        # pipe, and it is the same silhouette argument as the palm's.
        wrist_r = WRIST_R
        mb.add_raw(*rc.tube([_pt(_lerp(el, wr, 0.74), s),
                             _pt(_lerp(el, wr, 0.97), s),
                             _pt(_lerp(wr, hd, 0.20), s)],
                            [0.046, wrist_r * 1.06, wrist_r], seg=12),
                   role=SKIN)

        # The glove.
        #
        # RN-857 RE-PROPORTIONS IT, AND THE REASON IS A MEASUREMENT RATHER
        # THAN A TASTE. Reid's original complaint about this asset was "large
        # white mitts". RN-641 fixed the colour and the distance and left the
        # SECTION alone, and the section was the mitten: the palm was authored
        # 0.065 half-width against 0.043 half-thickness, i.e. **130 mm across
        # and 86 mm thick**. A real hand at the knuckles is about 90 mm across
        # and 28 mm thick, so this was 1.4x too wide and **3.1x too thick**,
        # and its aspect ratio was 1.5:1 where a hand is about 3.2:1.
        #
        # That is not a hand that needs more detail. It is the shape of a
        # mitten, and no amount of knuckle plates, finger tubes or weave was
        # ever going to make it read as anything else. The comment above this
        # block used to say "an ELLIPSE, twice as wide as it is thick", which
        # is what it was reaching for and is not what the numbers said.
        #
        # A padded glove is legitimately thicker than the hand inside it, so
        # this does not go to 28 mm. It goes to 42 mm thick and 96 mm across,
        # a 2.3:1 section, which is a heavy work glove rather than a mitten.
        # Every other number on the hand is now derived from HAND_HALF_W and
        # HAND_HALF_T below, so the palm, the fingers and the knuckle plates
        # cannot drift apart from each other again.
        mb.bind([pre + "ForeArm", pre + "Hand"])
        palm = [_pt(_lerp(wr, hd, t), s)
                for t in (-0.32, 0.06, 0.50, 1.00, 1.32)]
        # Widest at the KNUCKLE line and then stepping hard down: the width
        # step is most of what separates a hand from a paddle in silhouette.
        # RN-859 splits it at the knuckle line: the cuff-to-knuckle length is
        # clean and the knuckle-to-tip nose is grimed, matching the fingers
        # that continue out of it. Same overlap rule as the fingers, one
        # shared ring rather than a shared plane.
        prof_t = [t * HAND_HALF_T for t in (1.24, 1.14, 1.05, 1.00, 0.71)]
        prof_w = [w * HAND_HALF_W for w in (0.79, 0.85, 0.96, 1.00, 0.71)]
        mb.add_raw(*rc.oval_tube(palm[:4], prof_t[:4], prof_w[:4], seg=8),
                   role=GLOVE)
        mb.add_raw(*rc.oval_tube(palm[3:], prof_t[3:], prof_w[3:], seg=8),
                   role=GRIME)
        # THE KNUCKLE GUARD, RN-646, and it is now FOUR plates and not one.
        #
        # It was a single 0.046-half-width oval slab running the length of the
        # back of the hand, and at the corrected framing it is the second
        # largest thing in the frame after the glove itself. One slab has one
        # silhouette and one specular, which is why the before render reads as
        # a chrome tile glued to a mitten: a mirror highlight sliding across an
        # unbroken 9 cm face is the single strongest "this is one flat hard
        # object" cue there is.
        #
        # Four plates on the four knuckles break that highlight into four, give
        # the back of the hand a knuckle LINE in silhouette, and let the guard
        # articulate visually with the fingers under it. The widths taper
        # outboard the way a hand does. They sit on a shared carrier strip so
        # there is still something holding them on.
        mb.bind([pre + "Hand"])
        # NO CARRIER STRIP. The first version had a thin dark OF_SteelDark
        # oval running the length of the back of the hand for the plates to be
        # riveted to, on the reasoning that hardware needs something holding it
        # on. It was authored 43 to 47 mm half-width, WIDER than the four
        # plates that were supposed to hide it, and it tapered to a point at
        # its forward end. What the render showed was not a carrier: it was a
        # dark triangle sitting between the plates, pointing down the hand,
        # and it was the most conspicuous thing on the glove.
        #
        # The lesson is the same one the claw version taught an hour earlier
        # and it is worth writing down once: on a view model, a part authored
        # to explain another part is only worth its triangles if it is
        # actually hidden, and "mostly hidden" is a claim that has to be
        # rendered rather than assumed. The plates sit on the glove.
        # A PLATE IS FLAT, AND THE FIRST VERSION OF THIS WAS NOT.
        #
        # The first four plates were authored 12.5 mm half-width against
        # 10.5 mm half-thickness, which is very nearly ROUND in section, with
        # their long axis running forward along the hand and the middle ring
        # raised. Four near-round forward-pointing wedges seen from a camera
        # sitting behind the hand do not read as knuckle guards. They read as
        # CLAWS, and the render caught it immediately: it was a worse frame
        # than the single slab it was meant to improve.
        #
        # The numbers that fix it are the aspect ratio and the standoff. A
        # guard is a flat pad: 16 mm half-width against 4.5 mm half-thickness
        # is 3.6:1 rather than 1.2:1, so it presents a FACE to the camera
        # instead of an edge. The long axis is now ACROSS the hand, following
        # the knuckle line, which is the direction a knuckle guard actually
        # runs. And it sits 3 mm off the carrier rather than 7, so the plates
        # lie ON the back of the hand instead of standing proud of it.
        # (across-hand offset, half-width, half-thickness, along-hand centre)
        # seg=8, not 6. On a section this flat the segment count decides how
        # wide the TOP facet is: a hexagon puts two facets across the top at a
        # slant, so the sun catches each at a grazing angle and the plate
        # reads as a dark chip. An octagon gives one broad facet lying nearly
        # parallel to the back of the hand, which is the face that is supposed
        # to catch the light and is the whole reason for putting metal here.
        # 6 mm half-thickness rather than 4.6 for the same reason: the plate
        # has to have a visible EDGE to read as a plate rather than as a decal.
        #
        # RN-857: THE PLATES NOW SIT ON THE FINGERS THEY GUARD, and both
        # numbers that put them there are derived rather than typed. Their
        # across-hand positions come from `rc._FP_FINGER_LAYOUT`, which is the
        # same table the finger tubes are built from, so a knuckle guard can no
        # longer end up between two knuckles. Their height comes from
        # HAND_HALF_T, which matters more than it sounds: the old plates sat at
        # a typed z of 0.0360 against a palm half-thickness of 0.043, i.e.
        # BURIED 7 mm inside the glove, and against the corrected 0.021 palm
        # the same typed number would have left them floating 15 mm ABOVE it.
        # A constant tuned against another part's dimension is only correct
        # until that dimension moves, and this one just did.
        plate_z = HAND_HALF_T - 0.0015
        for (_fn, dx, frad), t0 in zip(rc._FP_FINGER_LAYOUT,
                                       (0.85, 0.91, 0.87, 0.79)):
            hw = frad * 0.92          # a guard is as wide as the knuckle it is on
            ht = 0.0058
            c = _off(_pt(_lerp(wr, hd, t0), s), (dx * s, 0.0, plate_z))
            a = _off(c, (0.0, 0.014, -0.0020))
            b = _off(c, (0.0, -0.013, -0.0024))
            mb.add_raw(*rc.oval_tube([a, c, b],
                                     [ht * 0.82, ht, ht * 0.72],
                                     [hw * 0.90, hw, hw * 0.80], seg=8),
                       role=PLATE)

        # Five finger tubes on three bone chains. The Middle chain carries
        # three of them, offset across the knuckle line, so the hand has four
        # fingers and a thumb in silhouette and the rig still has 27 bones.
        #
        # RN-859: THE LAST TWO SEGMENTS ARE FILTHY, and this is the whole
        # grime pass rather than a detail of it. ART-DIRECTION.md asks for
        # wear, dirt and staining more directly than for anything else and
        # says "clean is a defect" in those words, and this asset was the
        # cleanest thing on screen while being in every frame.
        #
        # WHERE grime goes is not a taste question, it is a question about
        # what the object touches. A work glove is filthy at the FINGERTIPS
        # and along the leading edge, because that is the 20 per cent of it
        # that contacts everything, and it stays comparatively clean across
        # the back of the hand. Putting the dirt anywhere else would read as
        # a paint scheme. It also happens to be the part of the glove nearest
        # the camera in the first-person frame, so it is dirt the player can
        # actually see rather than dirt on the palm that faces away.
        #
        # Each finger is emitted as TWO tubes sharing their middle rings, so
        # the split costs one extra tube per finger and no new machinery. The
        # tubes OVERLAP by one segment rather than abutting, for the reason
        # every solid in this project overlaps its neighbour: two surfaces
        # that end on the same plane are a coplanar pair.
        for fname, _root, segs in rc._FP_FINGERS:
            r = rc._FP_FINGER_R[fname]
            variants = (rc._FP_MIDDLE_TUBES if fname == "Middle"
                        else (((0.0, 0.0, 0.0), r, 1.0),))
            for offset, rad, scale in variants:
                mb.bind([pre + "Hand"] + rc.finger_bones(pre, [fname]))
                pts = rc.fp_finger_points(fname, scale=scale, offset=offset)
                root = tuple(pts[0][k] - segs[0][k] * 0.55 for k in range(3))
                ring = [_pt(root, s)] + [_pt(p, s) for p in pts]
                rads = [rad * 0.90, rad, rad * 0.92, rad * 0.85, rad * 0.72]
                # Clean, from the knuckle to the second joint.
                mb.add_raw(*rc.tube(ring[:4], rads[:4], seg=8), role=GLOVE)
                # Dirty, from the first joint to the tip, one ring of overlap.
                mb.add_raw(*rc.tube(ring[2:], rads[2:], seg=8), role=GRIME)

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
