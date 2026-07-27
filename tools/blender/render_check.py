"""render_check.py - render frames of an exported .glb so a human can look at it.

    blender --background --python tools/blender/render_check.py -- \
        assets/models/dist/player/player_body.glb docs/screenshots/player \
        rest:0:front Walk:8:side Swing_Pickaxe:16:threequarter

A shot is clip:frame:view, and the frame is a frame of the IMPORTED clip, which
starts at 0 (DW-34, of_lib.clip_frame). It is therefore the authored frame in
ASSET-SPECS minus one: the pickaxe impact is authored frame 17 and imported
frame 16.

WHY IT LOADS THE .glb AND NOT THE BUILD SCENE. validate_glb.py proves the file
obeys its contract, and a rigged asset can pass every one of those checks and
still deform badly: weights are numbers, deformation is a picture. This renders
the SHIPPED file, through the same import path a runtime uses, so what is
judged is what is actually in dist/ rather than what was in memory when the
build script ran.

Cycles on the CPU, deliberately. EEVEE needs a GPU context that a headless
Windows Blender does not reliably have, and a check that only runs on the
author's machine is not a check.

SURFACE MAPS (DW-35), opt in. A `--maps` or `--nomaps` token anywhere in the
argument list runs `surface_preview.apply_all()` (or `apply_all(off=True)`)
after the import and before the first render:

    ... -- <glb> <prefix> --nomaps rest:0:surfmach     # the BEFORE
    ... -- <glb> <prefix> --maps   rest:0:surfmach     # the AFTER

With NEITHER token the behaviour is exactly what it was: no import of
surface_preview, no material edits, flat palette constants as the .glb shipped
them. That default matters, because every existing caller and every committed
screenshot was produced by it.

`--nomaps` is not the same as omitting the flag. It strips the maps and REWRITES
the palette constants onto the BSDF, which makes the before half of a comparison
a positive statement about what the material is rather than an assumption that
nothing has touched it. Same scene, same camera, same lighting, same shipped
file, one flag: that is the only thing that makes the two frames comparable.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    # Blender puts the SCRIPT's directory on sys.path only for some invocation
    # paths, so `import surface_preview` is made explicit rather than lucky.
    sys.path.insert(0, HERE)

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

    # --- DW-35 surface comparison -------------------------------------------
    # Two views per asset, and the pair is the argument: a surface pass is a
    # claim about two different distances at once. The `surf*` views frame the
    # WHOLE asset, which is where tiling repetition shows and where a texture
    # that is too fine disappears; the `det*` views put roughly 0.5 to 0.8 m of
    # surface across the frame, which is where the panel line either reads as a
    # panel line or reads as dirt. Judging either one alone is how a texture
    # ships that looks right in a hero shot and wrong in the game.
    #
    # Frame widths are computed, not eyeballed: at 420 x 540 Blender fits the
    # 36 mm sensor to the LARGER dimension, so the horizontal half-angle is
    # atan(14 / f) and one metre of surface at distance D is 420 / (0.509 * D)
    # pixels at f = 55. The numbers in the comments below are that arithmetic.
    "surfmach": ((4.22, -6.76, 4.57), (0.0, 0.0, 1.35), 55.0),   # 4.4 m wide
    "surfwall": ((2.56, -7.87, 4.07), (0.0, 0.0, 1.70), 55.0),   # 4.4 m wide
    "surfpad": ((4.52, -7.83, 7.84), (0.0, 0.0, 0.25), 55.0),    # 6.0 m wide
    "surfnode": ((2.70, -3.85, 2.21), (0.0, 0.0, 0.50), 55.0),   # 2.5 m wide
    # The player's full view is the existing `front`, deliberately: it is the
    # frame every committed player screenshot already uses.
    "detmach": ((0.75, -2.60, 1.95), (0.0, -1.20, 1.45), 55.0),  # 0.6-0.8 m
    "detwall": ((0.55, -1.35, 1.85), (0.0, -0.12, 1.60), 55.0),  # 0.70 m
    "detpad": ((0.60, -1.10, 1.55), (0.0, -0.35, 0.50), 55.0),   # 0.73 m
    # Pulled back from a first attempt at 1.5 m, which put three facets of a
    # 1.6 m boulder across the whole frame: at that distance the coarse tile is
    # bigger than the frame, so the one thing the shot exists to answer - does
    # this tile repeat - could not be answered by it.
    "detnode": ((1.58, -1.77, 1.84), (0.05, -0.15, 0.65), 55.0),  # 0.94 m
    "detbody": ((0.42, -1.05, 1.45), (0.0, -0.16, 1.25), 55.0),  # 0.51 m
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
        bpy.context.scene.frame_set(0)
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
    # Pull the surface-map token out wherever it sits, so the positional
    # arguments keep the meaning and the ORDER they have always had. `maps` is
    # None when neither token is present, and None is the untouched default -
    # distinct from False, which is an active "strip them".
    maps = None
    for tok, val in (("--maps", True), ("--nomaps", False)):
        while tok in argv:
            argv.remove(tok)
            maps = val
    if len(argv) < 3:
        print(__doc__)
        return
    glb, out_prefix, shots = argv[0], argv[1], argv[2:]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 60
    cam = setup_world()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, glb))
    if maps is not None:
        # Imported at module scope this would make every existing caller depend
        # on assets/textures/dist/ being present, and surface_preview raises if
        # the manifest is missing. Imported here, only a caller that asked for
        # maps can be told the maps are not built.
        import surface_preview
        rep = surface_preview.apply_all(off=not maps)
        print("[render_check] surface maps %s: %d mapped, %d flat, %d skipped"
              % ("ON" if maps else "OFF (stripped)", len(rep["mapped"]),
                 len(rep["flat"]), len(rep["skipped"])))
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
