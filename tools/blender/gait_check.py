#!/usr/bin/env python3
"""
gait_check.py - does the SHIPPED walk cycle actually walk?

    blender --background --python tools/blender/gait_check.py --
    blender --background --python tools/blender/gait_check.py -- \
        --glb assets/models/dist/creatures/spider.glb --clip Spider_Walk
    ... -- --samples 480 --ground-band 0.04 --stance-trim 0.10

WHY THIS EXISTS. A gait defect is the one class of art bug a still frame
cannot show and a render very nearly cannot show either. The foot path can be
exactly the right shape while the body slides underneath it; the stance can
look planted while the planted foot travels at a speed the client never agreed
to; eight legs authored from one formula can pass through each other in the
middle of the cycle and read, at 30 frames a second on a creature the size of
a car, as "legs moving". DW-34 (docs/web/DECISIONS.md) is the precedent: a
16.7 ms dead hold at the head of every clip in the project, invisible to every
render ever taken, found by measuring the shipped bytes. This is that method
pointed at the gait.

WHY IT IS NOT ENOUGH THAT build_spider.py ALREADY PRINTS 2.5 m/s. That print
is the builder's own arithmetic: lever radius times sweep angle over stance
time. It proves the build script agrees with itself, which was never in doubt.
It cannot prove that the exporter wrote what the script authored, that the
BEZIER handles of_lib.pose_clip installs by default did not bow the straight
line rig_common.ramp asked for, that the curve BETWEEN two keys is the ramp
the keys imply, that eight legs derived from one azimuth table clear each
other, or that the cycle closes. Those are properties of the file, so the file
is what gets opened.

WHAT IT MEASURES, AND WHAT IT REFUSES TO DO. Every number below is read out of
assets/models/dist, sampled from posed bone matrices on the evaluated
depsgraph. Nothing is a pass or a fail: there is no tuned threshold anywhere
that turns a measurement into a verdict, because a threshold is an opinion and
this file has no standing to hold one. The two places a judgement is
unavoidable (is the touchdown clustering an alternating tetrapod, do adjacent
knees interpenetrate) print the observed sets and the observed distance next
to the literal definition being applied, so the reader can disagree with the
definition without having to re-run anything. Exit status is non-zero only for
a structural failure: no file, no armature, a requested clip that is not in
the file, a bone the report needs that the file does not have.

HOW THIS INSTRUMENT CAN LIE TO YOU. Written down because a probe that reports
a number without saying what could be wrong with it is a log line, not a test.

  1. STANCE IS A HEIGHT THRESHOLD. The window is "foot z within --ground-band
     of that foot's own minimum for that clip", which is the cheapest honest
     definition and is not the same thing as contact. The walk clip bobs the
     Root, so a genuinely planted foot moves vertically anyway; if the band is
     not comfortably larger than that bob, real stance gets cut off at both
     ends. STANCE_Z_P2P is printed next to the band for exactly this reason
     and BAND_MARGIN_WARN fires when they are within a factor of the constant
     below.

  2. THE SAME THRESHOLD ADMITS THE ENDS OF SWING. A foot 20 mm off the ground
     is inside a 50 mm band and is moving at swing speed, so a few samples of
     swing land in the stance statistics and inflate the slip. That is a real
     property of the clip (the foot does not land velocity matched), but it is
     not the ramp's linearity, so SLIP_CORE repeats the measurement with
     --stance-trim of the window removed from each end. Read both. If they
     disagree by a lot, the defect is at the transitions; if they agree, it is
     in the ramp.

  3. THE IMPORTER RESAMPLES TIME INTO FRAMES AT THE SCENE FPS. glTF stores
     seconds. Blender stores frames. The scene fps is forced to 60 here to
     match the rate of_lib authored at, so a key written at t = k/60 lands on
     an integer frame and nothing is quantised. At any other fps every phase
     in this report would be an interpolation of an interpolation.

  4. SUB-FRAME SAMPLES ARE BLENDER'S OPINION, NOT THREE.JS'S. Between two
     keys, this reads Blender's reconstruction of the glTF sampler; the client
     runs three.js's. They agree exactly ON the keys and may differ between
     them wherever the exporter wrote CUBICSPLINE. Numbers that fall on a key
     frame are exact; numbers between keys are an estimate of what the client
     will do.

  5. THE BODY IS AT THE ORIGIN. The walk clip carries no root translation by
     design (the client drives the creature forward), so every speed here is a
     speed through BODY space. If the client's forward speed ever stops
     matching the implied speed measured below, the feet skate, and that
     mismatch is invisible from inside this file.

  6. ONE NUMBER IS NOT MEASURED. The limb radius at the knee is read out of
     build_spider.py's LEG_RINGS table (parsed as text, not imported, so this
     tool never executes a file another lane is editing). It is authoring
     data, not shipped bytes, and the per-ring wobble LEG_JIT means the ring
     actually in the file is within a few percent of it. It is printed only so
     a clearance can be compared against something.

  7. THE FOOT TIP IS RECONSTRUCTED, BECAUSE glTF DOES NOT HAVE ONE. A glTF
     skeleton is joint POSITIONS: a joint has no length and no tail, so the
     importer invents one for every leaf bone. On this file the Tibia's
     imported tail lands at about 0.75 of the real limb (measured and printed
     as IMPORTED_TIBIA_TAIL_ERROR_M), which means the obvious reading,
     `pose_bone.tail`, is a foot tip roughly a metre in the air and every
     trajectory taken from it is fiction. It looks completely plausible: it
     moves with the leg, it sweeps, it lifts. So the tip is taken from the
     SHIPPED MESH instead: the most distal cluster of LOD0 vertices whose
     dominant vertex group is that leg's Tibia, averaged, and then carried
     through each pose by the Tibia's own rigid transform
     (pose.matrix * rest.matrix_local inverse). That transform is exactly what
     the armature modifier applies, so for a vertex weighted 1.0 to the Tibia
     the result IS the skinned position and not an approximation of it. The
     weight is checked rather than assumed: FOOT_TIP_REST prints the cluster
     size and its minimum weight, and anything below TIP_MIN_WEIGHT is a
     warning, because at a lower weight the tip would be blended between two
     bones and this shortcut would stop being exact.

     That "IS, not approximates" is a claim, so it is tested and not asserted.
     SKIN_XFORM_CHECK re-derives the tip at several phases of every clip from
     the DEFORMED mesh off the evaluated depsgraph, which is the same armature
     evaluation the viewport runs, and prints the largest disagreement in
     metres. If that number is not float noise then the cheap path is wrong
     and every foot number in this report is wrong with it.

     WHY THE MEAN OF A RING AND NOT THE SINGLE MOST DISTAL VERTEX. The obvious
     auditable rule (the Tibia-weighted vertex of greatest horizontal radius)
     picks a point on the SURFACE of a 10 mm tube, on a ring whose radius the
     build script deliberately wobbles per leg (LEG_JIT), so the lever arm it
     yields is partly a function of a jitter seed. The mean of a closed ring
     sits back on the bone axis. Both are printed, FOOT_TIP_REST and FOOT_VERT
     (the latter carrying its vertex INDEX, so a re-author that moves the tip
     shows up as a changed index rather than as silent drift), along with the
     gap between them, so the choice is arguable from the output alone.

  8. THE KNEE IS NOT RECONSTRUCTED, AND THAT IS DELIBERATE. It is a real glTF
     node, so pose_bone.head is the joint itself and no mesh is needed. It is
     also the right point for a clearance: a limb AXIS separation compared
     against twice a limb RADIUS is a statement about interpenetration, while
     a separation between two surface vertices is a statement about two
     arbitrary points on two tubes. The radius it is compared against is
     MEASURED off the shipped mesh (KNEE_MESH_RADIUS_M, the nearest rest
     vertex to the joint), with the authored LEG_RINGS number printed beside
     it only as a cross-check, so no verdict here rests on a constant copied
     out of the builder.
"""

import argparse
import math
import os
import re
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_GLB = os.path.join(ROOT, "assets", "models", "dist", "creatures",
                           "spider.glb")
SOURCE_PY = os.path.join(HERE, "build_spider.py")

# of_lib.reset_scene runs the whole project at 60 fps so one animation frame is
# one sim tick. The importer converts glTF seconds to frames with the SCENE
# rate, so anything else here would put authored keys on fractional frames.
AUTHORING_FPS = 60.0

DEFAULT_SAMPLES = 240
# A piecewise-linear stance ramp is only resolved if the sampler steps inside
# the authored frames; four is the floor, and short clips get more than the
# default rather than less.
MIN_SAMPLES_PER_FRAME = 4
# Wide enough to survive the walk clip's Root bob (see failure mode 1) and far
# below the swing apex, which is about a third of a metre.
DEFAULT_GROUND_BAND_M = 0.05
# Fraction of the stance window dropped from each end for the CORE statistics.
DEFAULT_STANCE_TRIM = 0.05
# If the foot's vertical travel during stance is this close to the band, the
# band is deciding where stance ends and the window is not trustworthy.
BAND_MARGIN_WARN = 0.75

# Touchdown phases closer together than this are one cluster. About two frames
# of a 49-frame cycle: tight enough that a half-cycle offset can never merge,
# loose enough that the 1/samples resolution of an edge cannot split a group.
CLUSTER_GAP_PHASE = 0.05
# How far the two cluster centres may sit from a clean half cycle.
ANTIPHASE_TOL_PHASE = 0.03

# The literal definition of an alternating tetrapod for THIS skeleton, which
# is also the grouping build_spider.walk_legs claims to author.
TETRAPOD_A = ("L1", "L3", "R2", "R4")
TETRAPOD_B = ("L2", "L4", "R1", "R3")

SIDES = ("L", "R")
LEG_INDICES = (1, 2, 3, 4)
LEGS = tuple("%s%d" % (s, i) for s in SIDES for i in LEG_INDICES)
# The knee is the Tibia HEAD, which is the joint the LEG_RINGS table calls the
# knee apex. The foot tip is the Tibia tail in the AUTHORING rig and is not in
# the shipped file at all (failure mode 7), so it is rebuilt from the mesh.
TIBIA = "%sTibia"
# Vertices this far behind the most distal one are the same terminal ring. The
# tarsal claw ring is 75 mm past the ring before it and carries a 10 mm tube
# radius, so this window takes all of one ring and none of the next.
TIP_CLUSTER_M = 0.025
# Below this the tip would be blended across two bones and the rigid-transform
# shortcut would stop being exact rather than merely close.
TIP_MIN_WEIGHT = 0.999
# Phases at which the rigid-transform tip is re-derived from the deformed mesh
# (failure mode 7). Enough to catch a systematic error, few enough that the
# per-sample cost of building a mesh stays off the main loop.
SKIN_CHECK_PHASES = 8
# A disagreement above this is not float noise and the method is broken.
SKIN_CHECK_EPS_M = 1e-5
BODY_BONES = ("Root", "Thorax", "Abdomen")
# Adjacent same-side neighbours: the only pairs whose swing arcs overlap.
ADJACENT = tuple((("%s%d" % (s, i)), ("%s%d" % (s, i + 1)))
                 for s in SIDES for i in (1, 2, 3))

# Below this, a single step has no direction worth reporting.
DIR_EPS_M = 1e-7
# A foot whose NET displacement is under this fraction of the distance it
# actually travelled did not go anywhere, so "the direction it went" is not a
# quantity. The idle is exactly that case: a millimetre of travel with no net,
# which without this gate reports a confident and meaningless 180 degrees.
DIR_NET_MIN_FRACTION = 0.02
# And an absolute floor, because a relative test alone still certifies a
# direction for the idle's twentieth of a millimetre of net travel. A foot
# that nets under a millimetre across a whole clip has not gone anywhere that
# anything in this game can distinguish. This is a stated opinion about when
# to print a direction, not a threshold that decides a pass.
DIR_NET_MIN_M = 1e-3

FAILURES = []


def fail(msg):
    FAILURES.append(msg)
    print("STRUCTURAL_FAILURE %s" % msg)


def f4(x):
    return "%.4f" % x


# ---------------------------------------------------------------------------
# Authoring constants, parsed as TEXT out of build_spider.py.
#
# Not imported: build_spider imports of_lib, of_lib is edited by other lanes,
# and an instrument whose reading depends on another lane's uncommitted work
# is not an instrument. Not retyped either, because a retyped constant only
# proves the typist was consistent.
# ---------------------------------------------------------------------------

_ASSIGN = re.compile(r"^([A-Z][A-Z0-9_]*)\s*=\s*([-+*/(). 0-9A-Za-z_]+?)"
                     r"\s*(?:#.*)?$")


def source_constants(path):
    """Every `NAME = <arithmetic>` line in a build script, evaluated in order.

    Lines whose value is a tuple, a string or a call are skipped by the
    character class or raise and are dropped: this only wants the scalars."""
    consts = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return consts, ""
    for line in text.splitlines():
        m = _ASSIGN.match(line)
        if not m:
            continue
        try:
            consts[m.group(1)] = float(
                eval(m.group(2), {"__builtins__": {}}, dict(consts)))
        except Exception:
            pass
    return consts, text


_RING = re.compile(r"\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)")


def knee_limb_radius(text, consts):
    """The LEG_RINGS row at the knee, as (radius, height, thickness, source).

    Found by matching the row's radius and height against KNEE_R and KNEE_Z
    rather than by row index, so the table can grow rings without silently
    handing back the wrong one."""
    block = re.search(r"^LEG_RINGS = \((.*?)^\)", text,
                      re.S | re.M)
    if not block or "KNEE_R" not in consts:
        return None
    for line in block.group(1).splitlines():
        m = _RING.search(line)
        if not m:
            continue
        try:
            row = [float(eval(g, {"__builtins__": {}}, dict(consts)))
                   for g in m.groups()]
        except Exception:
            continue
        if (abs(row[0] - consts["KNEE_R"]) < 1e-9
                and abs(row[1] - consts["KNEE_Z"]) < 1e-9):
            return row[0], row[1], row[2], m.group(0)
    return None


# ---------------------------------------------------------------------------
# Opening the file
# ---------------------------------------------------------------------------

def reset():
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    except Exception:
        bpy.ops.wm.read_homefile(use_empty=True)
    scn = bpy.context.scene
    scn.render.fps = int(AUTHORING_FPS)
    scn.render.fps_base = 1.0
    return scn


def import_glb(path):
    """Import and return (armature, [skinned meshes], [ignored object names]).

    THE IMPORTER SHIPS A 2 m SPHERE WITH THE FILE, AND IT IS NOT IN THE FILE.
    Blender's glTF importer builds an `Icosphere` as the custom bone display
    shape for the imported armature and parks it in a collection called
    `glTF_not_exported`. The view layer excludes that collection, so nothing
    that renders is affected, but every object-level scan sees it. Filter by
    the collection: the object's own hide flags are all False and say nothing.
    """
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    arm, meshes, ignored = None, [], []
    for o in bpy.context.scene.objects:
        if o in before:
            continue
        if any(c.name.startswith("glTF_not_exported")
               for c in o.users_collection):
            ignored.append(o.name)
            continue
        if o.type == "ARMATURE" and arm is None:
            arm = o
        elif o.type == "MESH" and any(m.type == "ARMATURE"
                                      for m in o.modifiers):
            meshes.append(o)
    return arm, meshes, ignored


def pick_lod0(meshes):
    """The mesh the client actually draws up close, which is the one whose
    vertices define where the feet are. LOD1 and LOD2 are decimations of it
    and their terminal ring may have lost the vertex being looked for."""
    for o in meshes:
        if o.name.endswith("_LOD0"):
            return o
    return max(meshes, key=lambda o: len(o.data.vertices)) if meshes else None


class Tip(object):
    """One leg's foot tip, located once in the bind pose from shipped bytes."""

    __slots__ = ("pos", "members", "weight", "vert", "vert_pos")

    def __init__(self, pos, members, weight, vert, vert_pos):
        self.pos = pos              # ring mean, in rest armature space
        self.members = members      # LOD0 vertex indices the mean is over
        self.weight = weight        # smallest Tibia weight among them
        self.vert = vert            # most distal single vertex, for the audit
        self.vert_pos = vert_pos


def rest_tips(arm, mesh):
    """{leg: Tip}, one pass over the bind-pose vertices.

    Vertices are bucketed by DOMINANT vertex group, then each Tibia's most
    distal cluster is taken. The cluster is averaged rather than reduced to
    its furthest member for the reason in failure mode 7; the furthest member
    is kept anyway, with its index, because it is the auditable choice."""
    gname = {vg.index: vg.name for vg in mesh.vertex_groups}
    want = {TIBIA % leg: leg for leg in LEGS}
    to_arm = arm.matrix_world.inverted() @ mesh.matrix_world
    buckets = {leg: [] for leg in LEGS}
    for v in mesh.data.vertices:
        if not v.groups:
            continue
        g = max(v.groups, key=lambda e: e.weight)
        leg = want.get(gname.get(g.group))
        if leg is not None:
            buckets[leg].append((v.index, to_arm @ v.co, g.weight))
    out = {}
    for leg in LEGS:
        head = arm.data.bones[TIBIA % leg].head_local
        rows = buckets[leg]
        if not rows:
            continue
        far = max((p - head).length for _, p, _ in rows)
        sel = [r for r in rows if (r[1] - head).length >= far - TIP_CLUSTER_M]
        c = Vector((0.0, 0.0, 0.0))
        for _, p, _ in sel:
            c += p
        # The audit pick: greatest horizontal radius from the armature origin,
        # ties broken by the lowest vertex, which on a tarsal claw is the
        # point of the claw.
        av = max(sel, key=lambda r: (round(math.hypot(r[1].x, r[1].y), 6),
                                     -r[1].z))
        out[leg] = Tip(c / len(sel), [r[0] for r in sel],
                       min(r[2] for r in sel), av[0], av[1])
    return out


def mesh_radius_at(mesh, to_arm, point):
    """Distance from a joint to the nearest bind-pose vertex of the skin.

    For a joint on the axis of a tube, that is the tube's radius AS SHIPPED,
    which is what a clearance has to be compared against. Measured rather than
    read out of the build script, so a retuned limb cannot leave a stale
    number behind (docs/web/NUMBERS.md)."""
    return min((to_arm @ v.co - point).length for v in mesh.data.vertices)


def action_fcurves(act):
    """Every fcurve of an Action, across Blender's two storage layouts.

    4.4+ moved fcurves into slot/layer channelbags; the legacy list is still
    the fallback because an Action with no slots keeps its curves there."""
    out = []
    if hasattr(act, "slots") and len(act.slots):
        for layer in act.layers:
            for strip in layer.strips:
                try:
                    bag = strip.channelbag(act.slots[0])
                except Exception:
                    bag = None
                if bag:
                    out.extend(bag.fcurves)
    if not out:
        out.extend(act.fcurves)
    return out


def assign(arm, act):
    """Make `act` the only thing driving the armature.

    The importer pushes every clip into its own NLA track. Left in place they
    all evaluate at once and the result is a blend of every clip, which looks
    like a plausible pose and is not one."""
    if arm.animation_data is None:
        arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    arm.animation_data.action = act
    if hasattr(act, "slots") and len(act.slots):
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------

class Pose(object):
    """One evaluated instant: world-space foot tips, knees and body heads."""

    __slots__ = ("foot", "knee", "body", "world")

    def __init__(self, arm_eval, tip_local):
        mw = arm_eval.matrix_world
        pb = arm_eval.pose.bones
        self.world = mw.copy()
        # pose_bone.head is already the POSED joint in armature space, so one
        # matrix multiply is the whole transform to world. The tip is a point
        # rigidly carried by the Tibia, so it needs that bone's own transform
        # first (see failure mode 7: pose_bone.tail is not the foot).
        self.knee = {leg: mw @ pb[TIBIA % leg].head.copy() for leg in LEGS}
        self.foot = {leg: mw @ (pb[TIBIA % leg].matrix @ tip_local[leg])
                     for leg in LEGS}
        self.body = {b: mw @ pb[b].head.copy() for b in BODY_BONES}


def goto(scn, f):
    base = math.floor(f)
    scn.frame_set(int(base), subframe=float(f - base))
    return bpy.context.evaluated_depsgraph_get()


def sample(arm, scn, first, last, n, tip_local, with_end):
    """n samples across [first, last), plus the closing sample if asked."""
    span = last - first
    out = []
    for i in range(n + (1 if with_end else 0)):
        dg = goto(scn, first + span * (i / float(n)))
        out.append(Pose(arm.evaluated_get(dg), tip_local))
    return out


def skin_xform_check(arm, scn, mesh, first, last, tips, tip_local):
    """Largest gap between the rigid-transform tip and the DEFORMED mesh.

    The whole foot half of this report rides on one claim: that carrying a
    weight-1.0 point on the Tibia's own transform gives the same answer as
    letting the armature modifier deform it. This is that claim, run against
    Blender's own evaluation, at phases spread across the clip."""
    worst = 0.0
    for i in range(SKIN_CHECK_PHASES):
        dg = goto(scn, first + (last - first) * (i / float(SKIN_CHECK_PHASES)))
        ev_arm = arm.evaluated_get(dg)
        ev_mesh = mesh.evaluated_get(dg)
        me = ev_mesh.to_mesh()
        try:
            pred = Pose(ev_arm, tip_local).foot
            for leg in LEGS:
                c = Vector((0.0, 0.0, 0.0))
                for vi in tips[leg].members:
                    c += me.vertices[vi].co
                c /= len(tips[leg].members)
                worst = max(worst, (ev_mesh.matrix_world @ c
                                    - pred[leg]).length)
        finally:
            ev_mesh.to_mesh_clear()
    return worst


# ---------------------------------------------------------------------------
# Small numerics
# ---------------------------------------------------------------------------

def stats(xs):
    """(mean, min, max, population sd), zeros for an empty sample."""
    if not xs:
        return 0.0, 0.0, 0.0, 0.0
    m = sum(xs) / len(xs)
    var = sum((x - m) ** 2 for x in xs) / len(xs)
    return m, min(xs), max(xs), math.sqrt(var)


def circ_dist(a, b):
    d = abs(a - b) % 1.0
    return min(d, 1.0 - d)


def circ_mean(ps):
    """Mean of phases known to be clustered, taken about the first member."""
    ref = ps[0]
    off = sum(((p - ref + 0.5) % 1.0) - 0.5 for p in ps) / len(ps)
    return (ref + off) % 1.0


def runs_on_circle(flags):
    """Contiguous True runs of a cyclic boolean array, as [(start, length)]."""
    n = len(flags)
    if all(flags):
        return [(0, n)]
    if not any(flags):
        return []
    return [(i, _run_len(flags, i)) for i in range(n)
            if flags[i] and not flags[i - 1]]


def _run_len(flags, start):
    n, k = len(flags), 0
    while flags[(start + k) % n]:
        k += 1
    return k


def xy(v):
    return Vector((v.x, v.y))


# ---------------------------------------------------------------------------
# Per-clip measurement
# ---------------------------------------------------------------------------

def measure_clip(arm, scn, act, args, geom, declared_mps):
    knee_row, knee_r, tips, tip_local, mesh = geom
    fcs = action_fcurves(act)
    keyed = [kp.co.x for fc in fcs for kp in fc.keyframe_points]
    if not keyed:
        fail("clip %s has no keyframes" % act.name)
        return
    first, last = min(keyed), max(keyed)
    span_frames = last - first
    fps = scn.render.fps / scn.render.fps_base
    duration = span_frames / fps

    n = max(args.samples,
            int(math.ceil(span_frames * MIN_SAMPLES_PER_FRAME)))
    assign(arm, act)
    poses = sample(arm, scn, first, last, n, tip_local, with_end=True)
    cyc, closing = poses[:n], poses[n]
    dt = duration / n
    phases = [i / float(n) for i in range(n)]

    print("")
    print("# ======================================================== %s"
          % act.name)
    print("CLIP_NAME %s" % act.name)
    print("CLIP_FPS %s" % f4(fps))
    print("CLIP_FRAME_FIRST %s" % f4(first))
    print("CLIP_FRAME_LAST %s" % f4(last))
    print("CLIP_DURATION_S %s" % f4(duration))
    print("CLIP_KEY_COUNT %d" % len(set(round(k, 6) for k in keyed)))
    # DW-34: authored frame 1 must export at t = 0. The exporter turns a
    # Blender frame straight into seconds, so a first key anywhere but 0 is a
    # dead hold at the head of every loop of this clip, forever.
    print("CLIP_FIRST_KEY_S %s" % f4(first / fps))
    print("CLIP_FIRST_KEY_AT_ZERO %d" % (1 if abs(first) < 1e-9 else 0))
    print("CLIP_SAMPLES %d" % n)
    print("CLIP_SAMPLES_PER_AUTHORED_FRAME %s"
          % f4(n / span_frames if span_frames else 0.0))
    print("CLIP_DT_S %s" % f4(dt))
    print("CLIP_GROUND_BAND_M %s" % f4(args.ground_band))
    print("CLIP_STANCE_TRIM %s" % f4(args.stance_trim))
    print("CLIP_DECLARED_MPS %s" % f4(declared_mps))

    # The premises the slip metric rests on, measured rather than assumed: the
    # armature object must not move (or "body space" is not one space), and
    # the Root bone must not translate horizontally (or the foot's travel
    # through body space is not the stance drag).
    moved = max((p.world.translation - cyc[0].world.translation).length
                for p in cyc)
    print("ARMATURE_OBJECT_TRAVEL_M %s" % f4(moved))
    root0 = xy(cyc[0].body["Root"])
    print("ROOT_XY_TRAVEL_M %s"
          % f4(max((xy(p.body["Root"]) - root0).length for p in cyc)))
    err = skin_xform_check(arm, scn, mesh, first, last, tips, tip_local)
    print("SKIN_XFORM_CHECK %s %d" % (f4(err), 1 if err <= SKIN_CHECK_EPS_M
                                      else 0))
    if err > SKIN_CHECK_EPS_M:
        print("SKIN_XFORM_WARN tracked tip disagrees with the deformed mesh "
              "by %s m: every foot metric below is suspect" % f4(err))

    # -- 2. foot trajectory --------------------------------------------------
    print("")
    print("# FOOT_Z <leg> <min> <max> <mean>")
    zmin = {}
    for leg in LEGS:
        zs = [p.foot[leg].z for p in cyc]
        zmin[leg] = min(zs)
        print("FOOT_Z %s %s %s %s"
              % (leg, f4(min(zs)), f4(max(zs)), f4(sum(zs) / n)))

    down = {leg: [p.foot[leg].z <= zmin[leg] + args.ground_band for p in cyc]
            for leg in LEGS}

    print("")
    print("# STANCE <leg> <start_phase> <end_phase> <duty> <contacts> <runs>")
    print("# STANCE_Z_P2P <leg> <vertical_travel_during_stance_m>")
    stance = {}
    for leg in LEGS:
        rs = runs_on_circle(down[leg])
        rs.sort(key=lambda sl: -sl[1])
        s, L = rs[0] if rs else (0, 0)
        idx = [(s + k) % n for k in range(L)]
        stance[leg] = idx
        print("STANCE %s %s %s %s %d %d"
              % (leg, f4(s / float(n)), f4(((s + L) % n) / float(n)),
                 f4(L / float(n)), L, len(rs)))
    for leg in LEGS:
        zs = [cyc[i].foot[leg].z for i in stance[leg]]
        p2p = (max(zs) - min(zs)) if zs else 0.0
        print("STANCE_Z_P2P %s %s" % (leg, f4(p2p)))
        # Failure mode 1: if the planted foot's own vertical travel is close
        # to the band, the band is what ends stance, not the foot.
        if p2p >= BAND_MARGIN_WARN * args.ground_band:
            print("BAND_MARGIN_WARN %s %s of %s"
                  % (leg, f4(p2p), f4(args.ground_band)))

    # -- 3. stance speed and intrinsic slip ---------------------------------
    print("")
    print("# STANCE_SPEED <leg> <mean> <min> <max> <sd>   (xy, body space)")
    print("# STANCE_PATH <leg> <path_len_m> <chord_m> <stance_s>")
    print("# SLIP <leg> <implied_mps> <max_dev_mps> <pct_of_declared>")
    print("# SLIP_CORE <leg> <implied_mps> <max_dev_mps> <pct_of_declared>")
    print("# STANCE_DIR <leg> <ux> <uy> <backward> <max_angle_deg> <defined>")
    print("# STANCE_DIR_CORE <leg> <ux> <uy> <backward> <max_angle_deg>"
          " <defined>")
    worst_slip = ("", 0.0, 0.0)
    worst_core = ("", 0.0, 0.0)
    worst_angle = ("", 0.0)
    worst_core_angle = ("", 0.0)
    for leg in LEGS:
        idx = stance[leg]
        speeds, steps = [], []
        for k in range(len(idx) - 1):
            d = xy(cyc[idx[k + 1]].foot[leg]) - xy(cyc[idx[k]].foot[leg])
            steps.append(d)
            speeds.append(d.length / dt)
        m, lo, hi, sd = stats(speeds)
        print("STANCE_SPEED %s %s %s %s %s"
              % (leg, f4(m), f4(lo), f4(hi), f4(sd)))

        path = sum(d.length for d in steps)
        chord = ((xy(cyc[idx[-1]].foot[leg]) - xy(cyc[idx[0]].foot[leg])).length
                 if idx else 0.0)
        secs = max(len(idx) - 1, 0) * dt
        print("STANCE_PATH %s %s %s %s" % (leg, f4(path), f4(chord), f4(secs)))

        for tag, sel in (("SLIP", speeds), ("SLIP_CORE", _trim(
                speeds, args.stance_trim))):
            im = sum(sel) / len(sel) if sel else 0.0
            dev = max((abs(v - im) for v in sel), default=0.0)
            pct = 100.0 * dev / declared_mps if declared_mps else 0.0
            print("%s %s %s %s %s" % (tag, leg, f4(im), f4(dev), f4(pct)))
            if tag == "SLIP" and dev > worst_slip[1]:
                worst_slip = (leg, dev, pct)
            if tag == "SLIP_CORE" and dev > worst_core[1]:
                worst_core = (leg, dev, pct)

        # Blender authors -Y as forward, so a correctly dragged stance foot
        # travels toward +Y through body space.
        u, ang, ok = direction(steps)
        cu, cang, cok = direction(_trim(steps, args.stance_trim))
        print("STANCE_DIR %s %s %s %s %s %d"
              % (leg, f4(u.x), f4(u.y), f4(u.y), f4(ang), ok))
        print("STANCE_DIR_CORE %s %s %s %s %s %d"
              % (leg, f4(cu.x), f4(cu.y), f4(cu.y), f4(cang), cok))
        if ok and ang > worst_angle[1]:
            worst_angle = (leg, ang)
        if cok and cang > worst_core_angle[1]:
            worst_core_angle = (leg, cang)

    print("SLIP_WORST %s %s %s"
          % (worst_slip[0], f4(worst_slip[1]), f4(worst_slip[2])))
    print("SLIP_CORE_WORST %s %s %s"
          % (worst_core[0], f4(worst_core[1]), f4(worst_core[2])))
    print("STANCE_DIR_WORST %s %s" % (worst_angle[0], f4(worst_angle[1])))
    print("STANCE_DIR_CORE_WORST %s %s"
          % (worst_core_angle[0], f4(worst_core_angle[1])))

    # -- 4. gait phase relationships ----------------------------------------
    print("")
    print("# GAIT_PHASE <leg> <touchdown> <liftoff>")
    td = {}
    for leg in LEGS:
        idx = stance[leg]
        t = (idx[0] / float(n)) if idx else 0.0
        l = (((idx[-1] + 1) % n) / float(n)) if idx else 0.0
        td[leg] = t
        print("GAIT_PHASE %s %s %s" % (leg, f4(t), f4(l)))

    clusters = cluster(list(td.items()), CLUSTER_GAP_PHASE)
    print("GAIT_CLUSTER_COUNT %d" % len(clusters))
    print("# GAIT_CLUSTER <i> <centre_phase> <n> <members>")
    for i, cl in enumerate(clusters):
        print("GAIT_CLUSTER %d %s %d %s"
              % (i, f4(circ_mean([p for _, p in cl])), len(cl),
                 " ".join(sorted(leg for leg, _ in cl))))
    sep = (circ_dist(circ_mean([p for _, p in clusters[0]]),
                     circ_mean([p for _, p in clusters[1]]))
           if len(clusters) == 2 else 0.0)
    print("GAIT_CLUSTER_SEPARATION %s" % f4(sep))

    sets = [frozenset(leg for leg, _ in cl) for cl in clusters]
    strict = (len(clusters) == 2
              and all(len(cl) == 4 for cl in clusters)
              and abs(sep - 0.5) <= ANTIPHASE_TOL_PHASE
              and set(sets) == {frozenset(TETRAPOD_A), frozenset(TETRAPOD_B)})
    print("GAIT_EXPECTED_A %s" % " ".join(sorted(TETRAPOD_A)))
    print("GAIT_EXPECTED_B %s" % " ".join(sorted(TETRAPOD_B)))
    for i, s in enumerate(sets):
        print("GAIT_OBSERVED_%d %s" % (i, " ".join(sorted(s))))
    print("GAIT_ALTERNATING_TETRAPOD %d" % (1 if strict else 0))

    counts = [sum(1 for leg in LEGS if down[leg][i]) for i in range(n)]
    print("FEET_DOWN %s %s %s"
          % (f4(min(counts)), f4(max(counts)), f4(sum(counts) / float(n))))

    # -- 5. inter-leg clearance ---------------------------------------------
    print("")
    print("# CLEAR_FOOT <a> <b> <min_dist_m> <phase>")
    print("# CLEAR_KNEE <a> <b> <min_dist_m> <phase>")
    worst_knee = (None, 1e9, 0.0)
    for label, field in (("CLEAR_FOOT", "foot"), ("CLEAR_KNEE", "knee")):
        for a, b in ADJACENT:
            best, at = 1e9, 0.0
            for i, p in enumerate(cyc):
                d = (getattr(p, field)[a] - getattr(p, field)[b]).length
                if d < best:
                    best, at = d, phases[i]
            print("%s %s %s %s %s" % (label, a, b, f4(best), f4(at)))
            if field == "knee" and best < worst_knee[1]:
                worst_knee = ((a, b), best, at)

    # The verdict uses the radius MEASURED off the shipped skin; the authored
    # LEG_RINGS thickness is printed next to it as a cross-check on the two
    # ways of knowing, never as the source of the comparison.
    print("KNEE_MESH_RADIUS_M %s" % f4(knee_r))
    if knee_row:
        print("KNEE_AUTHORED_RADIUS_M %s" % f4(knee_row[2]))
        print("KNEE_AUTHORED_SOURCE build_spider.py LEG_RINGS %s"
              % knee_row[3])
    else:
        print("KNEE_AUTHORED_RADIUS_M unavailable")
    print("KNEE_CONTACT_DISTANCE_M %s" % f4(2.0 * knee_r))
    print("CLEAR_KNEE_WORST %s %s %s %s %d"
          % (worst_knee[0][0], worst_knee[0][1], f4(worst_knee[1]),
             f4(worst_knee[2]), 1 if worst_knee[1] < 2.0 * knee_r else 0))

    # -- 6. body motion ------------------------------------------------------
    print("")
    print("# BODY_Z <bone> <min> <max> <mean> <p2p>")
    for b in BODY_BONES:
        zs = [p.body[b].z for p in cyc]
        print("BODY_Z %s %s %s %s %s"
              % (b, f4(min(zs)), f4(max(zs)), f4(sum(zs) / n),
                 f4(max(zs) - min(zs))))

    # The "feet are pinned" contract belongs to the idle, where build_spider
    # prints a predicted residual of about 0.01 m. Measured for every clip
    # because the cost is nothing and the walk's value is the step length.
    print("# FOOTPIN <leg> <xy_bbox_diag_m> <xy_radius_from_mean_m>")
    worst_pin = ("", 0.0, 0.0)
    for leg in LEGS:
        ps = [xy(p.foot[leg]) for p in cyc]
        dx = max(v.x for v in ps) - min(v.x for v in ps)
        dy = max(v.y for v in ps) - min(v.y for v in ps)
        diag = math.hypot(dx, dy)
        c = Vector((sum(v.x for v in ps) / n, sum(v.y for v in ps) / n))
        rad = max((v - c).length for v in ps)
        print("FOOTPIN %s %s %s" % (leg, f4(diag), f4(rad)))
        if diag > worst_pin[1]:
            worst_pin = (leg, diag, rad)
    print("FOOTPIN_WORST %s %s %s"
          % (worst_pin[0], f4(worst_pin[1]), f4(worst_pin[2])))

    # -- 7. periodicity ------------------------------------------------------
    print("")
    print("# LOOP_FOOT <leg> <dx> <dy> <dz> <dist>   (phase 1.0 minus 0.0)")
    worst_loop = ("", 0.0)
    for leg in LEGS:
        d = closing.foot[leg] - cyc[0].foot[leg]
        print("LOOP_FOOT %s %s %s %s %s"
              % (leg, f4(d.x), f4(d.y), f4(d.z), f4(d.length)))
        if d.length > worst_loop[1]:
            worst_loop = (leg, d.length)
    print("LOOP_FOOT_WORST %s %s" % (worst_loop[0], f4(worst_loop[1])))
    d = closing.body["Root"] - cyc[0].body["Root"]
    print("LOOP_ROOT %s %s %s %s" % (f4(d.x), f4(d.y), f4(d.z), f4(d.length)))


def direction(steps):
    """(unit net direction, worst angle any step makes with it, defined flag).

    The net direction is where the foot ACTUALLY went, so a step that opposes
    it reads as 180 degrees. On a planted foot nothing can, which is what
    makes this worth printing next to a plausible-looking mean speed. The flag
    is 0 when the net is lost in the path length, because then the answer
    would be a direction picked out of rounding error."""
    net = Vector((0.0, 0.0))
    path = 0.0
    for d in steps:
        net += d
        path += d.length
    if (net.length < DIR_NET_MIN_M
            or net.length < DIR_NET_MIN_FRACTION * path):
        return Vector((0.0, 0.0)), 0.0, 0
    u, ang = net.normalized(), 0.0
    for d in steps:
        if d.length > DIR_EPS_M:
            c = max(-1.0, min(1.0, u.dot(d.normalized())))
            ang = max(ang, math.degrees(math.acos(c)))
    return u, ang, 1


def _trim(xs, frac):
    """Drop `frac` of a stance sample from each end, keeping at least one."""
    k = int(math.floor(len(xs) * frac))
    return xs[k:len(xs) - k] if len(xs) - 2 * k >= 1 else xs


def cluster(pairs, gap):
    """Group (leg, phase) by circular proximity, wrapping across phase 0."""
    order = sorted(pairs, key=lambda kv: kv[1])
    out = []
    for leg, p in order:
        if out and circ_dist(p, out[-1][-1][1]) <= gap:
            out[-1].append((leg, p))
        else:
            out.append([(leg, p)])
    if len(out) > 1 and circ_dist(out[0][0][1], out[-1][-1][1]) <= gap:
        out[0] = out.pop() + out[0]
    return out


# ---------------------------------------------------------------------------

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="gait_check.py", add_help=True)
    ap.add_argument("--glb", default=DEFAULT_GLB)
    ap.add_argument("--clip", action="append", default=None,
                    help="measure only this clip; repeatable")
    ap.add_argument("--samples", type=int, default=DEFAULT_SAMPLES,
                    help="samples per cycle (raised to %d per authored frame)"
                         % MIN_SAMPLES_PER_FRAME)
    ap.add_argument("--ground-band", type=float, default=DEFAULT_GROUND_BAND_M,
                    dest="ground_band")
    ap.add_argument("--stance-trim", type=float, default=DEFAULT_STANCE_TRIM,
                    dest="stance_trim")
    ap.add_argument("--declared-mps", type=float, default=None,
                    dest="declared_mps",
                    help="ground speed the clip claims; default is "
                         "SPIDER_WALK_MPS out of build_spider.py")
    args = ap.parse_args(argv)

    path = args.glb if os.path.isabs(args.glb) else os.path.join(ROOT,
                                                                 args.glb)
    print("GLB %s" % path)
    if not os.path.isfile(path):
        fail("no such file: %s" % path)
        return 1

    consts, text = source_constants(SOURCE_PY)
    knee_row = knee_limb_radius(text, consts) if text else None
    declared = args.declared_mps
    if declared is None:
        declared = consts.get("SPIDER_WALK_MPS", 0.0)
        if not declared:
            print("DECLARED_MPS_SOURCE missing (percentages will read 0)")
        else:
            print("DECLARED_MPS_SOURCE build_spider.py SPIDER_WALK_MPS")
    else:
        print("DECLARED_MPS_SOURCE --declared-mps")

    scn = reset()
    arm, meshes, ignored = import_glb(path)
    print("IGNORED_IMPORTER_OBJECTS %s" % (" ".join(ignored) or "none"))
    if arm is None:
        fail("no armature in %s" % path)
        return 1
    print("ARMATURE %s" % arm.name)
    print("BONE_COUNT %d" % len(arm.pose.bones))

    have = set(arm.pose.bones.keys())
    need = set(BODY_BONES) | {TIBIA % leg for leg in LEGS}
    missing = sorted(need - have)
    if missing:
        fail("armature is missing bones: %s" % " ".join(missing))
        return 1

    lod0 = pick_lod0(meshes)
    if lod0 is None:
        fail("no skinned mesh in %s, so the foot tip cannot be located" % path)
        return 1
    print("SKIN_MESH %s %d" % (lod0.name, len(lod0.data.vertices)))
    tips = rest_tips(arm, lod0)
    if sorted(tips) != sorted(LEGS):
        fail("no Tibia-weighted vertices for: %s"
             % " ".join(sorted(set(LEGS) - set(tips))))
        return 1

    print("# FOOT_TIP_REST <leg> <x> <y> <z> <radius_xy> <verts> <min_weight>")
    print("# FOOT_VERT <leg> <vertex_index> <x> <y> <z> <radius_xy> <gap>")
    tip_local, tail_err = {}, 0.0
    for leg in LEGS:
        t = tips[leg]
        p = t.pos
        bone = arm.data.bones[TIBIA % leg]
        tip_local[leg] = bone.matrix_local.inverted() @ p
        print("FOOT_TIP_REST %s %s %s %s %s %d %s"
              % (leg, f4(p.x), f4(p.y), f4(p.z), f4(math.hypot(p.x, p.y)),
                 len(t.members), f4(t.weight)))
        q = t.vert_pos
        print("FOOT_VERT %s %d %s %s %s %s %s"
              % (leg, t.vert, f4(q.x), f4(q.y), f4(q.z),
                 f4(math.hypot(q.x, q.y)), f4((q - p).length)))
        if t.weight < TIP_MIN_WEIGHT:
            print("TIP_WEIGHT_WARN %s %s below %s"
                  % (leg, f4(t.weight), f4(TIP_MIN_WEIGHT)))
        tail_err = max(tail_err, (bone.tail_local - p).length)
    # The size of the trap failure mode 7 describes, in metres, so the next
    # reader does not have to take it on faith that pose_bone.tail is unusable.
    print("IMPORTED_TIBIA_TAIL_ERROR_M %s" % f4(tail_err))

    to_arm = arm.matrix_world.inverted() @ lod0.matrix_world
    knee_r = min(mesh_radius_at(lod0, to_arm,
                                arm.data.bones[TIBIA % leg].head_local)
                 for leg in LEGS)
    geom = (knee_row, knee_r, tips, tip_local, lod0)

    acts = sorted(bpy.data.actions, key=lambda a: a.name)
    print("CLIPS_IN_FILE %s" % " ".join(a.name for a in acts))
    if args.clip:
        by_name = {a.name: a for a in acts}
        chosen = []
        for want in args.clip:
            if want not in by_name:
                fail("no clip named %s in %s" % (want, path))
            else:
                chosen.append(by_name[want])
        acts = chosen
    if not acts:
        fail("no animation clips to measure")
    for act in acts:
        measure_clip(arm, scn, act, args, geom, declared)

    print("")
    print("STRUCTURAL_FAILURES %d" % len(FAILURES))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
