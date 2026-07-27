"""render_armour.py - dress the shipped player in the shipped armour and MOVE it.

    blender --background --python tools/blender/render_armour.py
    blender --background --python tools/blender/render_armour.py -- run crouch

Writes docs/screenshots/W11_armour_*.png and prints a numeric clearance report.

WHY THIS IS NOT render_check.py. render_check renders ONE file, which is the
right tool for a machine or for a character on its own: an asset that is wrong
is wrong in isolation. Armour is not like that. Every slot passes
validate_glb.py on its own and the interesting failure is BETWEEN the armour and
the body it is worn over - a knee that pokes through a poleyn at the bottom of a
run cycle, an elbow that emerges from a pauldron, a waist that opens at the
crouch. Those defects do not exist in either file. They exist in the ASSEMBLY,
in MOTION, so an assembly in motion is what gets rendered. render_structures.py
is the precedent and it exists for exactly this reason.

WHY IT IS A REAL TEST AND NOT A RESTATEMENT. Both .glb files are read out of
assets/models/dist through the glTF importer, the same path a runtime uses.
Nothing is imported from build_armour_set.py and no coordinate is retyped. The
body's own clip drives BOTH armatures, and the maximum disagreement between the
two rigs' 44 bones is measured and printed every frame set: if the armour rig
ever drifts from the body rig, this prints it rather than drawing it small.

WHAT THE CLEARANCE NUMBERS MEAN, precisely, because a naive reading of them is
wrong. For every armour vertex the signed distance to the nearest body surface
is measured in the REST pose (positive is outside the body). A NEGATIVE minimum
is expected and is not a defect: the inner face of every strapped-on plate is
deliberately buried in the limb it is strapped to, which is what makes it a
plate rather than a floating shell. The number that matters is the MEAN, which
says how far the armour stands off the body on average, and the identity of the
most negative vertex, which must always be an inner face. A plate whose OUTER
face went negative would be the real defect, and it would show up here as a
mean at or below zero.

Cycles on the CPU, deliberately, for render_check.py's reason: EEVEE needs a GPU
context that a headless Windows Blender does not reliably have, and a check that
only runs on the author's machine is not a check.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DIST = os.path.join(ROOT, "assets", "models", "dist", "player")
OUT = os.path.join(ROOT, "docs", "screenshots")

BODY = os.path.join(DIST, "player_body.glb")
ARMOUR = os.path.join(DIST, "armour_set.glb")

SLOTS = ["Armour_Head_LOD0", "Armour_Chest_LOD0", "Armour_Legs_LOD0",
         "Armour_Feet_LOD0"]

# name: (camera position, look-at target, focal length mm, (res_x, res_y))
VIEWS = {
    "34": ((2.40, -2.70, 1.55), (0.0, 0.0, 0.95), 55.0, (460, 600)),
    "side": ((3.60, -0.50, 1.25), (0.0, 0.0, 0.95), 55.0, (460, 600)),
    # The two close-ups. A 5 mm poke-through at a knee is roughly one pixel in
    # a full-body frame, which is to say invisible, which is to say the
    # full-body frames alone cannot answer the question this tool exists for.
    "knee": ((1.15, -1.30, 0.78), (0.0, -0.06, 0.50), 78.0, (520, 520)),
    "torso": ((1.35, -1.55, 1.44), (0.0, -0.05, 1.30), 72.0, (520, 520)),
}

# (clip, frame, views). The frames are the ones where the joints are most bent,
# because a straight limb proves nothing about a joint.
#
# These are frames in the IMPORTED clip, which now starts at frame 0 (DW-34,
# of_lib.clip_frame), so each one is the authored frame minus one. The
# Swing_Pickaxe shot is the impact: authored 17, imported 16.
SHOTS = [
    ("rest", 0, ("34", "side")),
    ("Idle", 59, ("34", "side")),
    ("Run", 0, ("34", "side")),
    ("Run", 6, ("34", "side", "knee", "torso")),
    ("Run", 12, ("34", "side")),
    ("Run", 18, ("34", "side", "knee", "torso")),
    ("Jump_Loop", 10, ("34", "side", "knee")),
    ("Swing_Pickaxe", 16, ("34", "side", "torso")),
    ("Crouch_Idle", 0, ("34", "side", "knee", "torso")),
]


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_world():
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 20
    scn.cycles.use_denoising = True
    scn.render.film_transparent = False
    scn.render.fps = 60
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.17, 0.19, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.angle = math.radians(6.0)
    sun.rotation_euler = (math.radians(52), 0.0, math.radians(38))
    scn.collection.objects.link(sun)

    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 220.0
    fill.data.size = 4.0
    fill.location = (-3.0, -2.4, 2.4)
    look_at(fill, (0, 0, 1.0))
    scn.collection.objects.link(fill)

    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-8, -8, 0), (8, -8, 0), (8, 8, 0), (-8, 8, 0)], [],
                     [(0, 1, 2, 3)])
    mesh.update()
    scn.collection.objects.link(bpy.data.objects.new("Ground", mesh))

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.clip_start = 0.01
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def import_glb(path):
    """-> the objects this import added, so the two files stay tellable apart.

    Blender 5.0's glTF importer leaves one stray `Icosphere` datablock behind
    per import. It is in neither file - both were checked node by node - so it
    is deleted here rather than filtered downstream, where it would otherwise
    ride along in the armour's show/hide set and blank a body part in the bare
    comparison renders."""
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    added = [o for o in bpy.data.objects if o.name not in before]
    for o in list(added):
        if o.name.split(".")[0] == "Icosphere":
            added.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    return added


def hide_non_lod0(objs):
    """Show what the RUNTIME shows: LOD0 only, no collision proxy. A .glb holds
    every band as siblings, and LOD0 drawn on top of LOD1 z-fights in a way that
    reads exactly like the broken geometry this tool is hunting for."""
    for o in objs:
        n = o.name
        if n.startswith("col_") or any(n.endswith("_LOD%d" % i)
                                       for i in range(1, 10)):
            o.hide_render = True


def armature_of(objs):
    for o in objs:
        if o.type == "ARMATURE":
            return o
    return None


def pose(arm, clip, frame):
    """Assign ONE imported action and evaluate it. Same body as render_check's
    play(), including the NLA purge: the importer pushes every clip into its own
    track and left in place they all evaluate at once, which produces a
    plausible-looking pose that is a blend of fourteen clips."""
    if arm is None:
        return None
    if arm.animation_data is None:
        arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    if clip == "rest":
        arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.matrix_basis.identity()
        bpy.context.scene.frame_set(0)
        return None
    act = bpy.data.actions.get(clip)
    if act is None:
        cands = [a for a in bpy.data.actions if a.name.startswith(clip)]
        act = cands[0] if cands else None
    if act is None:
        raise SystemExit("[armour] no action named %r" % clip)
    arm.animation_data.action = act
    if hasattr(act, "slots") and len(act.slots):
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
    bpy.context.scene.frame_set(int(frame))
    return act


def rig_drift(a, b):
    """Max |world matrix difference| over the bones the two rigs share.

    This is the property contracts.json's bones[] and rest_pose exist to make
    checkable, measured on the POSED rigs rather than on the bind pose: two rigs
    that agree at bind and disagree under a clip would draw exactly the defect
    this tool is looking for, and would be indistinguishable from a weighting
    bug in the picture."""
    worst, where = 0.0, ""
    names = {pb.name for pb in a.pose.bones} & {pb.name for pb in b.pose.bones}
    for n in sorted(names):
        ma = a.matrix_world @ a.pose.bones[n].matrix
        mb = b.matrix_world @ b.pose.bones[n].matrix
        d = max(abs(ma[r][c] - mb[r][c]) for r in range(4) for c in range(4))
        if d > worst:
            worst, where = d, n
    return worst, where


def drive_both(body_arm, armour_arm, clip, frame):
    """Play `clip` at `frame` on the body, then on the armour, and prove they
    landed in the same place. Falls back to copying the pose basis bone by bone
    if the action would not bind to the second armature, and says so."""
    pose(body_arm, clip, frame)
    pose(armour_arm, clip, frame)
    worst, where = rig_drift(body_arm, armour_arm)
    how = "action"
    if worst > 1e-5:
        for pb in armour_arm.pose.bones:
            src = body_arm.pose.bones.get(pb.name)
            if src is not None:
                pb.matrix_basis = src.matrix_basis.copy()
        bpy.context.view_layer.update()
        worst, where = rig_drift(body_arm, armour_arm)
        how = "basis-copy"
    return worst, where, how


# ---------------------------------------------------------------------------
# Clearance
# ---------------------------------------------------------------------------

def world_geometry(objs):
    """World-space (verts, triangles) of the visible meshes in `objs`."""
    dg = bpy.context.evaluated_depsgraph_get()
    verts, tris = [], []
    for o in objs:
        if o.type != "MESH" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        m = o.matrix_world
        base = len(verts)
        verts.extend(m @ v.co for v in me.vertices)
        for p in me.polygons:
            idx = [base + i for i in p.vertices]
            for k in range(1, len(idx) - 1):
                tris.append((idx[0], idx[k], idx[k + 1]))
        ev.to_mesh_clear()
    return verts, tris


def clearance(body_objs, armour_objs):
    from mathutils.bvhtree import BVHTree
    bv, bt = world_geometry(body_objs)
    bvh = BVHTree.FromPolygons(bv, bt)
    dg = bpy.context.evaluated_depsgraph_get()
    print("\n[armour] CLEARANCE, rest pose, signed distance from each armour "
          "vertex to the\n"
          "         nearest body surface. Positive is outside the body. A "
          "negative MINIMUM is\n"
          "         the buried inner face of a strapped-on plate and is by "
          "design; the MEAN is\n"
          "         the standoff, and it is the number that must stay well "
          "above zero.")
    print("         %-22s %9s %9s %9s   %s"
          % ("slot", "min m", "mean m", "max m", "deepest vertex (blender xyz)"))
    for o in armour_objs:
        if o.type != "MESH" or o.name not in SLOTS:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        m = o.matrix_world
        ds, worst, wp = [], 1e30, None
        for v in me.vertices:
            p = m @ v.co
            loc, nrm, _idx, _dist = bvh.find_nearest(p)
            if loc is None:
                continue
            d = (p - loc).length
            if (p - loc).dot(nrm) < 0.0:
                d = -d
            ds.append(d)
            if d < worst:
                worst, wp = d, p
        ev.to_mesh_clear()
        neg = sum(1 for d in ds if d < 0.0)
        # The armour is authored in Blender axes but imported through a Y-up
        # conversion, so report the deepest vertex back in AUTHORING axes:
        # glTF (x, y, z) came from Blender (x, -z, y).
        auth = (wp[0], -wp[1], wp[2]) if wp is not None else (0, 0, 0)
        print("         %-22s %+9.4f %+9.4f %+9.4f   (%+.3f %+.3f %+.3f)  "
              "%d/%d inside"
              % (o.name, min(ds), sum(ds) / len(ds), max(ds),
                 auth[0], auth[1], auth[2], neg, len(ds)))


# ---------------------------------------------------------------------------

def shoot(cam, view, name):
    pos, tgt, lens, res = VIEWS[view]
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = res
    cam.data.lens = lens
    cam.location = pos
    look_at(cam, tgt)
    path = os.path.join(OUT, name + ".png")
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[armour] wrote %s" % os.path.basename(path))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    want = {a.lower() for a in argv}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    cam = setup_world()

    body_objs = import_glb(BODY)
    armour_objs = import_glb(ARMOUR)
    hide_non_lod0(body_objs)
    hide_non_lod0(armour_objs)
    body_arm = armature_of(body_objs)
    armour_arm = armature_of(armour_objs)
    if body_arm is None or armour_arm is None:
        raise SystemExit("[armour] missing an armature: body=%s armour=%s"
                         % (body_arm, armour_arm))
    have = sorted(o.name for o in armour_objs if o.type == "MESH")
    print("[armour] body rig %s (%d bones), armour rig %s (%d bones)"
          % (body_arm.name, len(body_arm.pose.bones),
             armour_arm.name, len(armour_arm.pose.bones)))
    print("[armour] armour meshes: %s" % have)
    missing = [s for s in SLOTS if s not in have]
    if missing:
        raise SystemExit("[armour] missing slots: %s" % missing)

    drive_both(body_arm, armour_arm, "rest", 1)
    clearance(body_objs, armour_objs)

    armour_meshes = [o for o in armour_objs if o.name in SLOTS]
    print()
    for clip, frame, views in SHOTS:
        if want and clip.lower() not in want:
            continue
        worst, where, how = drive_both(body_arm, armour_arm, clip, frame)
        print("[armour] %s:%d  rig drift %.2e at %s (%s)"
              % (clip, frame, worst, where or "-", how))
        stem = "W11_armour_%s_f%d" % (clip.lower(), frame)
        for v in views:
            for o in armour_meshes:
                o.hide_render = False
            shoot(cam, v, "%s_%s" % (stem, v))
        # The same pose with the armour hidden: the comparison that says what
        # the plates actually changed, and the control for "is that the body or
        # the armour I am looking at".
        for o in armour_meshes:
            o.hide_render = True
        for v in views:
            if v in ("34", "side"):
                shoot(cam, v, "W11_armour_bare_%s_f%d_%s" % (clip.lower(),
                                                             frame, v))
        for o in armour_meshes:
            o.hide_render = False


if __name__ == "__main__":
    main()
