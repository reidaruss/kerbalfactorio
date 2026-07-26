"""render_check.py - render frames of an exported .glb so a human can look at it.

    blender --background --python tools/blender/render_check.py -- \
        assets/models/dist/player/player_body.glb docs/screenshots/player \
        rest:1:front Walk:9:side Swing_Pickaxe:17:threequarter

WHY IT LOADS THE .glb AND NOT THE BUILD SCENE. validate_glb.py proves the file
obeys its contract, and a rigged asset can pass every one of those checks and
still deform badly: weights are numbers, deformation is a picture. This renders
the SHIPPED file, through the same import path a runtime uses, so what is
judged is what is actually in dist/ rather than what was in memory when the
build script ran.

Cycles on the CPU, deliberately. EEVEE needs a GPU context that a headless
Windows Blender does not reliably have, and a check that only runs on the
author's machine is not a check.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

VIEWS = {
    # name: (camera position, look-at target, focal length mm)
    "front": ((0.0, -4.6, 1.10), (0.0, 0.0, 0.95), 55.0),
    "side": ((3.6, -0.5, 1.25), (0.0, 0.0, 0.95), 55.0),
    "threequarter": ((2.4, -2.7, 1.55), (0.0, 0.0, 0.95), 55.0),
    "hand": ((0.95, -0.80, 1.66), (0.79, 0.0, 1.44), 55.0),
    # The view model as the PLAYER sees it: camera on the asset origin, a 24 mm
    # lens for roughly the 70 degree vertical FOV of ASSET-SPECS 4.2, and a
    # 0.01 m near plane so nothing is clipped at arm's length.
    "eye": ((0.0, 0.0, 0.0), (0.0, -1.0, -0.22), 24.0),
    "eyeoff": ((0.55, -0.30, 0.30), (0.0, -0.35, -0.28), 35.0),
    # Tier 2. The views above frame a 1.8 m player; a 6.4 m lander or a 12 m
    # launch tower is off the top of every one of them.
    "vessel34": ((7.2, -8.6, 4.6), (0.0, 0.0, 3.0), 50.0),
    "site34": ((14.0, -16.0, 8.5), (0.0, 0.0, 4.2), 50.0),
}


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]),
                          0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_world():
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 24
    scn.cycles.use_denoising = True
    scn.render.resolution_x = 420
    scn.render.resolution_y = 540
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.17, 0.19, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.angle = math.radians(6.0)
    sun.rotation_euler = (math.radians(52), 0.0, math.radians(38))
    bpy.context.scene.collection.objects.link(sun)

    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 220.0
    fill.data.size = 4.0
    fill.location = (-3.0, -2.4, 2.4)
    look_at(fill, (0, 0, 1.0))
    bpy.context.scene.collection.objects.link(fill)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 55.0
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def add_ground():
    """A ground plane, so a walk cycle's foot contact is judgeable.

    Only for assets that stand ON the ground. A view model hangs BELOW its
    origin (the origin is the camera point), so a plane at z = 0 would both
    occlude it and put it in shadow - which is what a first attempt at the
    first-person render looked like."""
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-8, -8, 0), (8, -8, 0), (8, 8, 0), (-8, 8, 0)], [],
                     [(0, 1, 2, 3)])
    mesh.update()
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("Ground", mesh))


def find_armature():
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            return o
    return None


def play(arm, clip, frame):
    """Assign one imported action and evaluate it at `frame`."""
    if arm is None:
        return
    if arm.animation_data is None:
        arm.animation_data_create()
    # The glTF importer pushes every clip into its own NLA track. Left in
    # place they all evaluate at once and the pose is a blend of fourteen
    # clips, which looks like a plausible pose and is not one.
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    if clip == "rest":
        # Clearing the action does NOT restore the rest pose: pose bones keep
        # whatever was last evaluated on them, which after an import is
        # whichever clip the importer happened to assign. The bind pose has to
        # be asked for explicitly.
        arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.matrix_basis.identity()
        bpy.context.scene.frame_set(1)
        return
    act = bpy.data.actions.get(clip)
    if act is None:
        cands = [a for a in bpy.data.actions if a.name.startswith(clip)]
        act = cands[0] if cands else None
    if act is None:
        print("[render_check] no action named %r" % clip)
        return
    arm.animation_data.action = act
    if hasattr(act, "slots") and len(act.slots):
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
    bpy.context.scene.frame_set(int(frame))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 3:
        print(__doc__)
        return
    glb, out_prefix, shots = argv[0], argv[1], argv[2:]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 60
    cam = setup_world()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, glb))
    # Show what the RUNTIME shows: one LOD band, no collision proxy, and for a
    # harvest node only the _Full depletion variant. A .glb holds every band and
    # every variant as siblings, so rendering the file raw draws LOD0, LOD1 and
    # LOD2 on top of each other - and two nearly-coincident surfaces z-fight,
    # which reads exactly like broken geometry on small details such as a hand.
    for o in list(bpy.data.objects):
        n = o.name
        hide = (n.startswith("col_")
                or any(n.endswith("_LOD%d" % i) for i in range(1, 10))
                or "_Half_" in n or "_Low_" in n or "_Stump_" in n)
        if hide:
            o.hide_render = True
    lowest = min([(o.matrix_world @ v.co).z
                  for o in bpy.data.objects if o.type == "MESH" and not o.hide_render
                  for v in o.data.vertices] or [0.0])
    if lowest > -0.05:
        add_ground()
    arm = find_armature()
    print("[render_check] armature %s, actions %s"
          % (arm.name if arm else None, sorted(a.name for a in bpy.data.actions)))

    out_dir = os.path.join(ROOT, os.path.dirname(out_prefix))
    os.makedirs(out_dir, exist_ok=True)
    for shot in shots:
        clip, frame, view = shot.split(":")
        pos, tgt, lens = VIEWS[view]
        cam.data.lens = lens
        cam.data.clip_start = 0.01
        cam.location = pos
        look_at(cam, tgt)
        play(arm, clip, frame)
        path = os.path.join(ROOT, "%s_%s_f%s_%s.png"
                            % (out_prefix, clip.lower(), frame, view))
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("[render_check] wrote %s" % path)


if __name__ == "__main__":
    main()
