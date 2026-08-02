"""render_player.py - the player body and the first-person arms, rendered the
way the player actually sees them.

    blender --background --python tools/blender/render_player.py -- \
        fp RN641_fp_before --nomaps
    blender --background --python tools/blender/render_player.py -- \
        body RN641_body_before --nomaps rest:0:p34
    blender --background --python tools/blender/render_player.py -- \
        sheet assets/models/dist/player/player_fp_arms.glb RN641_sheet \
        FP_Swing_Pickaxe 0 6 12 16 22 30

WHY THIS EXISTS AND WHY IT IS NOT render_check.py, IN ONE SENTENCE EACH.

  THE VIEW TRANSFORM. render_check.py never touches `scene.view_settings`, so
  it renders under whatever Blender 5.0 defaults to, which is AgX. RN-456 paid
  three renders to learn that a material judged under AgX is not the material
  the game draws, and the fix there was to make the rig PRINT its transform
  every run. render_check.py is shared with several lanes and is not mine to
  re-point mid-pass, so the player gets its own rig with the printing built in.

  THE FIELD OF VIEW, AND THIS IS A CORRECTION. `ASSET-SPECS 4.2` says the
  client runs "roughly 70 degrees" vertical and render_check.py's `eye` view
  and rig_common.py's hand-distance arithmetic are both derived from that
  number. The client does not use it. `CameraRig.ts` constructs every camera
  including `vmCam` at `fovDeg = 60` and `setFov` is never called anywhere in
  web/src, so the shipped vertical FOV is 60 degrees. At the authored hand
  distance of 0.62 m the visible frame height is 2 * 0.62 * tan(30) = 0.716 m,
  not the 0.868 m the sizing comment assumes: the hands are 21 per cent larger
  in the frame than the arithmetic that placed them believed. That is not a
  detail on the one asset whose whole problem was ever that it was too big.

  So the lens here is DERIVED, never typed: Blender fits its sensor to the
  larger output dimension under `sensor_fit = 'AUTO'`, which silently makes a
  landscape render horizontal-fit while three.js `PerspectiveCamera.fov` is
  always VERTICAL. `sensor_fit` is pinned to 'VERTICAL' and the focal length
  comes out of the FOV, so changing the output resolution cannot change the
  framing. The number is printed with the transform.

  THE FRAMING ITSELF. The first-person arms hang BELOW an origin that is the
  camera point, so no three-quarter studio shot is a substitute for the one
  view that matters: camera at the origin, looking where the player looks.
  There is no ground plane in that shot, because a plane at z = 0 sits above
  the model and both occludes it and shadows it.

Cycles on the CPU, for render_check.py's reason: EEVEE needs a GPU context a
headless Windows Blender does not reliably have, and a check that only runs on
the author's machine is not a check.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

BODY = "assets/models/dist/player/player_body.glb"
ARMS = "assets/models/dist/player/player_fp_arms.glb"
OUT = "docs/screenshots"

# The shipped vertical field of view, read off web/src/render/CameraRig.ts
# (`private fovDeg = 60`, applied to skyCam, farCam, nearCam and vmCam alike,
# and never changed because setFov has no caller). Everything framed as "what
# the player sees" is derived from this one number.
CLIENT_FOV_V_DEG = 60.0

# RN-455's finding, restated because it applies to the player too: the client
# merges an asset's primitives and keeps ONE roughness and ONE metalness, so a
# studio render that gives each part its own is flattering in the direction
# nobody double-checks. None means "render what the .glb says".
CLIENT_MERGE_ROUGH_METAL = None

_MAPS = None
_MERGED = False


def apply_maps():
    """Wire the shipped surface maps, once, after an import.

    Imported inside the function so a caller who asks for no maps does not
    depend on assets/textures/dist/ existing at all."""
    if _MAPS is None:
        return
    import surface_preview
    kw = {}
    if _MAPS and _MERGED and CLIENT_MERGE_ROUGH_METAL is not None:
        kw["force"] = CLIENT_MERGE_ROUGH_METAL
    rep = surface_preview.apply_all(off=not _MAPS, **kw)
    print("[render_player] surface maps %s: %d mapped, %d flat, %d skipped"
          % ("ON" if _MAPS else "OFF (stripped)", len(rep["mapped"]),
             len(rep["flat"]), len(rep["skipped"])))
    for name in sorted(rep["mapped"]):
        print("[render_player]   mapped %s" % name)


# ---------------------------------------------------------------------------
# Views. (camera position, look-at target, vertical FOV in degrees).
#
# The FOV is carried per view rather than a focal length, because a focal
# length is only meaningful once you know the sensor fit and the aspect, and
# carrying the angle is what lets the player views state the client's own
# number instead of a lens that happens to approximate it at one resolution.
# ---------------------------------------------------------------------------

VIEWS = {
    # --- first person. THE SHOT THIS PASS EXISTS FOR. ------------------------
    # Camera exactly on the model origin, because the model origin IS the
    # camera point (rig_common: the view model attaches with an identity
    # transform). The look-at direction is straight ahead and 12.4 degrees
    # down, which is where a walking player's eyeline sits.
    "fp": ((0.0, 0.0, 0.0), (0.0, -1.0, -0.22), CLIENT_FOV_V_DEG),
    # The same eye point on a longer lens: not a different camera, a crop.
    # This is the only honest way to look closer at a view model, because
    # MOVING the camera changes the one thing about a view model that is
    # fixed by construction.
    "fpcrop": ((0.0, 0.0, 0.0), (0.0, -1.0, -0.30), 26.0),
    # Over the player's right shoulder, so the arms can be judged as objects
    # rather than as a composition. Not a substitute for `fp` and never
    # reported instead of it.
    "fpoff": ((0.55, -0.30, 0.30), (0.0, -0.35, -0.28), 42.0),
    # --- third person body --------------------------------------------------
    "pfront": ((0.0, -4.6, 1.10), (0.0, 0.0, 0.95), 40.0),
    "pside": ((3.6, -0.5, 1.25), (0.0, 0.0, 0.95), 40.0),
    "p34": ((2.4, -2.7, 1.55), (0.0, 0.0, 0.95), 40.0),
    "pback": ((-0.9, 3.9, 1.45), (0.0, 0.0, 1.10), 40.0),
    # --- body detail. Roughly 0.5 to 0.8 m of surface across the frame, which
    # --- is the distance at which a seam either reads as a seam or as dirt.
    "phead": ((0.62, -1.05, 1.88), (0.0, -0.10, 1.64), 34.0),
    "pchest": ((0.42, -1.05, 1.45), (0.0, -0.16, 1.25), 34.0),
    "ppack": ((-0.40, 1.15, 1.52), (0.0, 0.12, 1.30), 34.0),
    "pboot": ((0.52, -0.86, 0.42), (0.10, -0.05, 0.12), 34.0),
    "phand": ((0.95, -0.80, 1.66), (0.79, 0.0, 1.44), 34.0),
}

RES = {"fp": (1200, 800), "wide": (700, 900), "det": (760, 760),
       "sheet": (1600, 620)}


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]),
                          0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_view_transform(scn):
    """Put the studio render on the SHIPPED response curve, not Blender's.

    rendering.md section 2.1 is the calibrated target: the client is ACES at
    exposure 1.2, contrast 1.45 on a slope-matched S, saturation 0.92, black
    point zero. Blender 5.0 defaults to AgX, which is both flatter and more
    desaturating than any of that, and it is applied to every pixel after the
    material has finished.

    `Standard` plus +0.26 stops (2 ** 0.26 = 1.20) plus a high-contrast look is
    the closest the stock OCIO config reaches. THIS IS NOT ACES and nothing
    here claims it is. What it buys is that the studio frame and the game frame
    are now wrong in the same DIRECTION rather than in opposite ones, so a
    material judged here does not have to be judged from scratch again in the
    browser. The in-game frame remains the answer on lighting.

    RN-456 spent three renders discovering this on the spider. It is restated
    here rather than imported because render_creatures.py belongs to the
    creature lane and is being edited by it right now."""
    vs = scn.view_settings
    for want in ("Standard", "Filmic", "AgX"):
        try:
            vs.view_transform = want
            break
        except TypeError:
            continue
    vs.exposure = 0.26
    for want in ("High Contrast", "Medium High Contrast", "None"):
        try:
            vs.look = want
            break
        except TypeError:
            continue
    print("[render_player] view transform %r, look %r, exposure %+.2f stops"
          % (vs.view_transform, vs.look, vs.exposure))


def setup_world(samples=32):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.film_transparent = False
    setup_view_transform(scn)

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    # A cool dim sky rather than a flat mid grey, for RN-456's reason: a 0.16
    # neutral world is half the light in the frame and it arrives from every
    # direction at once, which fills in every crease a normal map spent its
    # whole budget cutting. The game's ambient is sky-coloured and the sun does
    # the work, so the studio rig does the same and a shadowed cuff is allowed
    # to be dark.
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.048, 0.058, 0.076, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 5.2
    # 2 degrees, not 6. A visor and a knuckle plate live or die on a TIGHT
    # specular, and a 6 degree source smears it into the broad sheen that made
    # three of the spider's renders read as matte leather whatever the
    # roughness map said.
    sun.data.angle = math.radians(2.0)
    sun.rotation_euler = (math.radians(52), 0.0, math.radians(38))
    bpy.context.scene.collection.objects.link(sun)

    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 320.0
    fill.data.size = 5.0
    fill.location = (-5.0, -4.0, 3.4)
    look_at(fill, (0, 0, 1.0))
    bpy.context.scene.collection.objects.link(fill)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.clip_start = 0.01
    # Pinned, and this is the whole reason the framing is trustworthy.
    # 'AUTO' fits the 36 mm sensor width to whichever output dimension is
    # LARGER, so the same lens frames a portrait render vertically and a
    # landscape render horizontally. three.js `PerspectiveCamera.fov` is always
    # the VERTICAL angle. Pinning the fit makes the two agree by construction
    # instead of by a resolution nobody is going to re-check.
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 24.0
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def add_ground(half=14.0):
    """A SUBSTRATE-coloured floor at section 2.1's own reference luma.

    Blender's default material is 0.8 albedo, which under the curve above
    clips to paper white and throws a large bounce back up into every shadow on
    the subject. Section 2.1 item 2 puts groundNear at luma 35 to 55 and item 3
    puts the substrate at HSV saturation 0.25 to 0.35, so the floor is authored
    to that. The floor is part of the measurement."""
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-half, -half, 0), (half, -half, 0),
                      (half, half, 0), (-half, half, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    mat = bpy.data.materials.new("StudioGround")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = (0.052, 0.045, 0.033, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.95
    mesh.materials.append(mat)
    bpy.context.scene.collection.objects.link(
        bpy.data.objects.new("Ground", mesh))


def import_asset(glb, scale=1.0, offset=(0.0, 0.0, 0.0), spin_deg=0.0):
    """Import one .glb, hide what the runtime does not draw, return
    (armature, [visible mesh objects]).

    THE IMPORTER SHIPS A 2 m SPHERE WITH THE FILE AND IT IS NOT IN THE FILE.
    Blender's glTF importer creates a material-less mesh called `Icosphere` as
    the custom bone display shape for the imported armature and parks it in a
    collection called `glTF_not_exported` that the view layer excludes. Direct
    renders never see it. The POSE SHEET does, because baking copies a mesh and
    links the copy to the master collection, which is exactly the step that
    escapes the exclusion. RN-4xx's creature sheets drew a white dome over
    every body before this filter existed. Filter by the collection: the
    object's own hide flags are all False and say nothing about it."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, glb))
    new = [o for o in bpy.context.scene.objects if o not in before
           and not any(c.name.startswith("glTF_not_exported")
                       for c in o.users_collection)]
    arm, meshes = None, []
    for o in new:
        if o.type == "ARMATURE":
            arm = o
        hide = (o.name.startswith("col_")
                or any(o.name.endswith("_LOD%d" % i) for i in range(1, 10)))
        if hide:
            o.hide_render = True
            o.hide_viewport = True
        elif o.type == "MESH":
            meshes.append(o)
    for o in new:
        if o.parent is None:
            o.scale = (scale, scale, scale)
            o.rotation_mode = "XYZ"
            o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                                o.rotation_euler[2] + math.radians(spin_deg))
            o.location = tuple(o.location[k] + offset[k] for k in range(3))
    return arm, meshes


def play(arm, clip, frame):
    """Assign ONE imported action and evaluate it at `frame`.

    The glTF importer pushes every clip into its own NLA track. Left in place
    all fourteen evaluate at once and the result is a blend of every clip,
    which looks like a plausible pose and is not one."""
    if arm is None:
        return
    if arm.animation_data is None:
        arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    if clip == "rest":
        # Clearing the action does NOT restore the rest pose: pose bones keep
        # whatever was last evaluated on them, which after an import is
        # whichever clip the importer happened to assign last. The bind pose
        # has to be asked for explicitly.
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
        # LOUD, because the failure mode this catches is a pose sheet in which
        # every column is the rest pose and nothing says so.
        print("[render_player] NO ACTION NAMED %r, THIS FRAME IS THE REST POSE"
              % clip)
        return
    arm.animation_data.action = act
    if hasattr(act, "slots") and len(act.slots):
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
    bpy.context.scene.frame_set(int(frame))


def lens_for(fov_v_deg):
    """Focal length that gives `fov_v_deg` VERTICALLY on a 24 mm sensor height.

    Derived rather than typed. With sensor_fit pinned to VERTICAL this holds at
    every output resolution, which is the property that makes two renders at
    two resolutions comparable."""
    return 12.0 / math.tan(math.radians(fov_v_deg) * 0.5)


def shoot(cam, view, path, res="wide"):
    pos, tgt, fov = VIEWS[view]
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = RES[res]
    cam.data.lens = lens_for(fov)
    cam.location = pos
    look_at(cam, tgt)
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    scn.render.filepath = full
    print("[render_player] view %s: fov_v %.1f deg -> lens %.2f mm at %dx%d"
          % (view, fov, cam.data.lens, scn.render.resolution_x,
             scn.render.resolution_y))
    bpy.ops.render.render(write_still=True)
    print("[render_player] wrote %s" % full)


def boot(samples=32):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 60
    return setup_world(samples)


# ---------------------------------------------------------------------------

def _shot_path(prefix, clip, frame, view):
    return "%s/%s_%s_f%s_%s.png" % (OUT, prefix, clip.lower(), frame, view)


def mode_fp(argv):
    """The first-person arms from the eye point. NO ground plane.

    A view model hangs below an origin that is the camera, so a plane at z = 0
    is ABOVE it: it occludes the hands and drops them into its own shadow. The
    first attempt at a first-person render in this project did exactly that."""
    prefix = argv[0]
    shots = argv[1:] or ["rest:0:fp", "FP_Idle:0:fp", "FP_Idle:0:fpcrop",
                         "FP_Swing_Pickaxe:16:fp"]
    cam = boot()
    arm, _ = import_asset(ARMS)
    print("[render_player] armature %s, actions %s"
          % (arm.name if arm else None,
             ",".join(sorted(a.name for a in bpy.data.actions))))
    apply_maps()
    for shot in shots:
        clip, frame, view = shot.split(":")
        play(arm, clip, frame)
        res = "fp" if view in ("fp", "fpcrop", "fpoff") else "wide"
        shoot(cam, view, _shot_path(prefix, clip, frame, view), res)


def mode_body(argv):
    prefix = argv[0]
    shots = argv[1:] or ["rest:0:p34"]
    cam = boot()
    add_ground()
    arm, _ = import_asset(BODY)
    print("[render_player] armature %s, actions %s"
          % (arm.name if arm else None,
             ",".join(sorted(a.name for a in bpy.data.actions))))
    apply_maps()
    for shot in shots:
        clip, frame, view = shot.split(":")
        play(arm, clip, frame)
        res = "det" if view.startswith(("phead", "pchest", "ppack", "pboot",
                                        "phand")) else "wide"
        shoot(cam, view, _shot_path(prefix, clip, frame, view), res)


def mode_sheet(argv):
    """N frames of one clip in one render, as baked copies.

    THIS IS THE CLIP-BINDING PROOF and it is a picture on purpose. A column
    standing in the rest pose beside five that are not is the exact failure
    signature of a clip that stopped binding after a re-author, and the three
    catalogued causes (mixer not ticking, bind-matrix mismatch collapsing to
    the origin, two loaders) all show up in it and in nothing else."""
    glb, prefix, clip = argv[0], argv[1], argv[2]
    frames = [int(f) for f in argv[3:]]
    fp = "fp_arms" in glb
    cam = boot(samples=24)
    if not fp:
        add_ground(half=40.0)
    arm, meshes = import_asset(glb)
    if arm is None:
        raise SystemExit("[render_player] %s has no armature" % glb)
    apply_maps()
    # A body is 0.9 m across at the shoulders; a pair of FP arms is 0.86 m wide
    # and swings. 1.30 m of pitch clears both without letting a swing overlap
    # its neighbour.
    step = 1.30 if fp else 1.15
    span = step * (len(frames) - 1)
    for k, f in enumerate(frames):
        play(arm, clip, f)
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        for src in meshes:
            ev = src.evaluated_get(dg)
            me = bpy.data.meshes.new_from_object(
                ev, preserve_all_data_layers=True, depsgraph=dg)
            # new_from_object does NOT carry a material slot whose link is
            # OBJECT rather than DATA, and the glTF importer sets some of them
            # that way. Without this the baked copy renders in Blender's
            # default white.
            me.materials.clear()
            for slot in src.material_slots:
                me.materials.append(slot.material)
            ob = bpy.data.objects.new("%s_pose%02d" % (src.name, k), me)
            ob.matrix_world = src.matrix_world.copy()
            ob.location = (ob.location[0] + k * step - span * 0.5,
                           ob.location[1], ob.location[2])
            bpy.context.scene.collection.objects.link(ob)
    for src in meshes:
        src.hide_render = True

    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = RES["sheet"]
    fill = bpy.data.objects.get("Fill")
    if fill is not None:
        # A one-metre fill 5 m from a single subject is 10 m from the far end
        # of a row, so on a sheet it lights the near columns and not the far
        # ones. Pushed back and widened it lights them all the same, which is
        # the only reason the columns can be compared to each other at all.
        fill.data.size = 12.0
        fill.data.energy = 1800.0
        fill.location = (-0.35 * span, -9.0, 6.0)
        look_at(fill, (0, 0, 0.9 if not fp else -0.35))
    # The distance is derived from the row width and the FOV, not guessed: a
    # row that overflows the frame silently drops its end poses.
    fov_v = 34.0
    half_w = 0.5 * (span + (1.10 if fp else 1.30))
    aspect = RES["sheet"][0] / float(RES["sheet"][1])
    dist = half_w / (aspect * math.tan(math.radians(fov_v) * 0.5))
    cam.data.lens = lens_for(fov_v)
    if fp:
        cam.location = (0.0, -dist, -0.10)
        look_at(cam, (0.0, 0.0, -0.36))
    else:
        cam.location = (0.0, -dist, 1.15)
        look_at(cam, (0.0, 0.0, 0.90))
    print("[render_player] sheet span %.2f m, camera %.2f m, lens %.2f mm, "
          "%d frames of %s" % (span, dist, cam.data.lens, len(frames), clip))
    full = os.path.join(ROOT, "%s/%s.png" % (OUT, prefix))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    scn.render.filepath = full
    bpy.ops.render.render(write_still=True)
    print("[render_player] wrote %s" % full)


MODES = {"fp": mode_fp, "body": mode_body, "sheet": mode_sheet}


def main():
    global _MAPS, _MERGED
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    # Pulled out wherever they sit, so the positional arguments keep the order
    # and the meaning they have (render_check.py's rule).
    for tok, val in (("--maps", True), ("--nomaps", False)):
        while tok in argv:
            argv.remove(tok)
            _MAPS = val
    while "--merged" in argv:
        argv.remove("--merged")
        _MERGED = True
    if not argv or argv[0] not in MODES:
        print(__doc__)
        return
    MODES[argv[0]](argv[1:])


if __name__ == "__main__":
    main()
