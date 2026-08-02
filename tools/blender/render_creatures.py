"""render_creatures.py - the three shots a single-asset render structurally cannot take.

    blender --background --python tools/blender/render_creatures.py -- <mode> ...

`render_check.py` frames a 1.80 m player at about 4 m and renders ONE .glb at a
time. Neither property survives a creature pass:

  * a 4.53 m spider is off three sides of every view in that table, and
  * "massive" is a claim about a RATIO, so it cannot be photographed with one
    asset in the frame. A spider alone at any focal length is just a spider.

So this file adds creature-scaled views, a two-asset scale shot, and a pose
sheet, and it does all three through ONE import/lighting/camera path so a
before/after pair is comparable by construction.

MODES

  single <glb> <prefix> <scale> <clip:frame:view> ...
      one asset, creature-framed views.

  scale <prefix> <spider_scale>
      player_body.glb standing beside spider.glb at the scale the client
      actually draws it (EnemyTypes.bodyRadiusM, 0.75 to 1.25 over the shipped
      catalogue). The player is posed at Idle so the arms hang: a T-pose is
      1.80 m of arm span and reads as a wider silhouette than the character.

  sheet <glb> <prefix> <scale> <clip> <f0> <f1> ...
      a walk-cycle pose sheet as ONE render containing N BAKED copies.

WHY THE SHEET BAKES RATHER THAN RENDERING N FILES. Blender evaluates every
object at the single scene frame, so N poses in one frame cannot come from N
armatures. Each copy is therefore `new_from_object` on the depsgraph-evaluated
mesh at its own frame, which is the DEFORMED result, and the copies are then
static. That has a property a strip of separate renders does not: if a clip
failed to bind after a re-author, its column stands in the rest pose beside
five that do not, in one image, under one light.

Cycles on the CPU for the same reason render_check gives: a check that only
runs where there is a GPU is not a check.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    # Blender only puts the script's directory on sys.path for some invocation
    # paths, so `import surface_preview` is made explicit rather than lucky.
    sys.path.insert(0, HERE)

# What SpiderFlock.materialFor() builds. Repeated here because a preview that
# does not use the SHIPPED constants is a preview of something else, and the
# merge means these two numbers are the ONLY roughness and metalness the near
# creature has. Keep them equal to the client or the studio pair is fiction.
CLIENT_MERGE_ROUGH_METAL = (0.80, 0.04)

# Set by the argument parser: None leaves materials exactly as the .glb shipped
# them, True applies the surface maps, False strips them and rewrites the flat
# palette constants (which is a positive statement about the BEFORE half rather
# than an assumption that nothing has touched it).
_MAPS = None
_MERGED = False


def apply_maps():
    """Wire the shipped surface maps, once, after an import.

    Imported here rather than at module scope so that a caller who asks for no
    maps does not depend on assets/textures/dist/ existing."""
    if _MAPS is None:
        return
    import surface_preview
    rep = surface_preview.apply_all(
        off=not _MAPS,
        force=CLIENT_MERGE_ROUGH_METAL if (_MAPS and _MERGED) else None)
    print("[render_creatures] surface maps %s: %d mapped, %d flat, %d skipped"
          % ("ON" if _MAPS else "OFF (stripped)", len(rep["mapped"]),
             len(rep["flat"]), len(rep["skipped"])))

# Creature-scaled views. Positions are metres, target is the look-at point, and
# the third entry is the focal length. The wide three frame the whole 4.53 m
# foot span; the det* three put roughly 0.6 to 1.2 m of creature across the
# frame, which is the distance a player fights it at.
VIEWS = {
    "cfront": ((0.0, -7.60, 1.85), (0.0, -0.10, 0.80), 55.0),
    "cside": ((7.30, -0.40, 1.95), (0.0, 0.00, 0.80), 55.0),
    "c34": ((4.90, -5.60, 2.75), (0.0, -0.10, 0.75), 55.0),
    # the head and mouthparts, from just above and to one side
    "chead": ((0.86, -2.22, 1.14), (0.0, -0.95, 0.55), 62.0),
    # one knee at azimuth 70: the joint the leg articulates over
    "cknee": ((2.05, -1.55, 2.28), (0.99, -0.36, 1.48), 62.0),
    # the abdomen rear: banding, spinnerets, the dorsal line
    "cabd": ((1.02, 2.32, 1.62), (0.0, 0.95, 0.86), 62.0),
    # the whole creature from above, where the leg spread reads
    "ctop": ((0.30, -3.10, 6.40), (0.0, 0.05, 0.55), 45.0),
}

# Wider than render_check's 420 x 540 on purpose: at 420 px a 4.5 m creature is
# 93 px per metre and every detail this pass adds is under the sampling floor.
RES = {"wide": (800, 600), "det": (700, 700), "sheet": (1500, 520),
       "scale": (1000, 620)}


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]),
                          0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_view_transform(scn):
    """Get the studio render onto the SHIPPED response curve, not Blender's.

    docs/controllers/rendering.md section 2.1 is the calibrated target and the
    client's curve is ACES with exposure 1.2, contrast 1.45 on a slope-matched
    S and saturation 0.92. Blender 5.0 defaults to AgX, which is a
    substantially FLATTER and more desaturating transform than any of that, and
    it is applied to every pixel after the material has done its work.

    That is not a detail. Judged under AgX the chitin reads as dusty
    terracotta, which is a statement about the view transform and not about the
    map, and it is the exact shape of INSTRUMENTS.md's dominant failure: a
    control that depends on something nobody re-derived. Three renders of this
    pass were spent tuning a map against the wrong curve before this was found.

    `Standard` plus an exposure of +0.26 stops (2 ** 0.26 = 1.20) plus a
    high-contrast look is the closest the stock OCIO config gets. It is NOT
    ACES and this is not a claim that it is: what it buys is that the studio
    frame and the game frame are now wrong in the same DIRECTION rather than
    opposite ones, so a material judged here is not re-judged from scratch in
    the browser. The in-game shot remains the answer on lighting."""
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
    print("[render_creatures] view transform %r, look %r, exposure %+.2f stops"
          % (vs.view_transform, vs.look, vs.exposure))


def setup_world(samples=28):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.film_transparent = False
    setup_view_transform(scn)
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    # A COOL, DIM sky rather than a flat mid grey. The old 0.16 neutral was
    # half the light in the frame and it arrived from every direction at once,
    # which fills every crease the map spent its whole budget darkening. The
    # game's ambient is sky-coloured and the sun does most of the work, so the
    # studio rig now does the same and the shadow side of a leg is allowed to
    # be dark.
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.048, 0.058, 0.076, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 5.2
    # 2 degrees rather than 6: a shell's specular is a TIGHT highlight, and a
    # 6 degree source smears it into the broad sheen that made three renders of
    # this pass read as matte leather no matter what the roughness map said.
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
    cam.data.lens = 55.0
    cam.data.clip_start = 0.01
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def add_ground(half=22.0):
    """A SUBSTRATE-coloured floor, not Blender's default 0.8 grey.

    Section 2.1 item 2 gives the shipped groundNear luma as 35 to 55 at the
    vegetated sites and item 3 says the terrain is soil and litter at HSV
    saturation 0.25 to 0.35. A default-material floor is 0.8 albedo, which
    under the response curve above clips to paper white, throws a large
    bounce back up into every shadow on the subject, and makes any dark
    creature look darker than it will ever look in the game. The floor is part
    of the measurement."""
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
    """Import one .glb, hide everything the runtime does not draw, and return
    (armature, [visible mesh objects]).

    The hide list is render_check's, restated rather than imported: LOD1 and
    LOD2 are siblings in the file and drawing them on top of LOD0 z-fights in a
    way that reads exactly like broken geometry."""
    # THE IMPORTER SHIPS A 2 m SPHERE WITH THE FILE, AND IT IS NOT IN THE FILE.
    # Blender's glTF importer creates a mesh called `Icosphere`, with no
    # material, as the custom BONE DISPLAY SHAPE for the imported armature, and
    # parks it in a collection called `glTF_not_exported` that the view layer
    # excludes. It never renders, so nothing that renders the import directly
    # (render_check.py included) has ever been affected by it.
    #
    # The pose sheet is affected, because baking copies a mesh and LINKS the
    # copy to the master collection, which is exactly the step that escapes the
    # exclusion. The first two sheets therefore drew a white dome over every
    # body. The tell was dark legs around a white body on an asset whose legs
    # and body share ONE material, and the obvious reading of that ("the bake
    # lost its materials") is wrong and cost a material audit. Filter by the
    # collection, because the object's own hide flags are all False and say
    # nothing about it.
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
            o.location = (o.location[0] + offset[0], o.location[1] + offset[1],
                          o.location[2] + offset[2])
    return arm, meshes


def play(arm, clip, frame):
    """Assign one imported action and evaluate it at `frame`.

    The glTF importer pushes every clip into its own NLA track; left in place
    they all evaluate at once and the pose is a blend of every clip, which
    looks like a plausible pose and is not one."""
    if arm is None:
        return
    if arm.animation_data is None:
        arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    if clip == "rest":
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
        print("[render_creatures] NO ACTION NAMED %r, this frame is REST POSE"
              % clip)
        return
    arm.animation_data.action = act
    if hasattr(act, "slots") and len(act.slots):
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
    bpy.context.scene.frame_set(int(frame))


def shoot(cam, view, path, res="wide"):
    pos, tgt, lens = VIEWS[view]
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = RES[res]
    cam.data.lens = lens
    cam.location = pos
    look_at(cam, tgt)
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    scn.render.filepath = full
    bpy.ops.render.render(write_still=True)
    print("[render_creatures] wrote %s" % full)


def boot(samples=28):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 60
    return setup_world(samples)


# ---------------------------------------------------------------------------

def mode_single(argv):
    glb, prefix, scale = argv[0], argv[1], float(argv[2])
    cam = boot()
    add_ground()
    arm, _ = import_asset(glb, scale)
    print("[render_creatures] armature %s, actions %s"
          % (arm.name if arm else None, sorted(a.name for a in bpy.data.actions)))
    apply_maps()
    for shot in argv[3:]:
        clip, frame, view = shot.split(":")
        play(arm, clip, frame)
        res = "det" if view.startswith(("chead", "cknee", "cabd")) else "wide"
        shoot(cam, view, "%s_%s_f%s_%s.png" % (prefix, clip.lower(), frame, view),
              res)


def mode_scale(argv):
    """The player and the spider in ONE frame at true relative size.

    The only shot that can answer "is it massive", because massive is a ratio
    and a ratio needs two things in it. The spider is drawn at the scale the
    CLIENT uses (EnemyTypes.bodyRadiusM), not at unit scale, so what is on
    screen is what the player meets."""
    prefix, sscale = argv[0], float(argv[1])
    cam = boot(samples=36)
    add_ground()
    parm, _ = import_asset("assets/models/dist/player/player_body.glb",
                           1.0, (-3.30, -0.55, 0.0), spin_deg=-144.0)
    sarm, _ = import_asset("assets/models/dist/creatures/spider.glb",
                           sscale, (1.35, 0.0, 0.0), spin_deg=18.0)
    apply_maps()
    play(parm, "Idle", 0)
    play(sarm, "Spider_Walk", 12)
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = RES["scale"]
    cam.data.lens = 50.0
    cam.location = (1.60, -13.60, 2.55)
    look_at(cam, (-0.35, 0.0, 1.15))
    full = os.path.join(ROOT, "%s.png" % prefix)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    scn.render.filepath = full
    bpy.ops.render.render(write_still=True)
    print("[render_creatures] wrote %s (spider at scale %.3f, player 1.80 m)"
          % (full, sscale))


def mode_sheet(argv):
    """N poses of one clip in one render, as baked copies.

    A column standing in the rest pose beside five that are not IS the failure
    signature for a clip that stopped binding after a re-author."""
    glb, prefix, scale, clip = argv[0], argv[1], float(argv[2]), argv[3]
    frames = [int(f) for f in argv[4:]]
    cam = boot(samples=24)
    add_ground(half=40.0)
    arm, meshes = import_asset(glb, scale)
    if arm is None:
        raise SystemExit("[render_creatures] %s has no armature" % glb)
    apply_maps()
    step = 5.05 * scale
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
            # default white, which is exactly what the first pose sheet did:
            # dark legs around a white body, on an asset whose legs and body
            # share one material.
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
    # The lens is DERIVED from the row width, not guessed: Blender fits the
    # 36 mm sensor to the larger output dimension, so the frame is
    # 2 * D * tan(atan(18 / f)) wide, and a row that overflows it silently
    # drops the end poses, which is the first version of this shot.
    # The one-metre-square fill sits 5 m from a single subject and is 25 m from
    # the far end of a row, so on a sheet it lights the near columns and not
    # the far ones. Pushed back and widened, it lights all six the same, which
    # is the only reason six poses can be compared to each other at all.
    fill = bpy.data.objects.get("Fill")
    if fill is not None:
        fill.data.size = 18.0
        fill.data.energy = 2600.0
        fill.location = (-0.35 * span, -14.0, 9.0)
        look_at(fill, (0, 0, 1.0))
    dist = 1.05 * (span + 5.0 * scale)
    cam.data.lens = 18.0 * dist / (0.53 * (span + 5.6 * scale))
    cam.location = (0.0, -dist, 0.105 * dist)
    look_at(cam, (0.0, 0.0, 0.85 * scale))
    print("[render_creatures] sheet span %.2f m, camera %.2f m, lens %.1f mm"
          % (span, dist, cam.data.lens))
    full = os.path.join(ROOT, "%s.png" % prefix)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    scn.render.filepath = full
    bpy.ops.render.render(write_still=True)
    print("[render_creatures] wrote %s (%s, frames %s)"
          % (full, clip, ",".join(str(f) for f in frames)))


MODES = {"single": mode_single, "scale": mode_scale, "sheet": mode_sheet}


def main():
    global _MAPS, _MERGED
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    # Pulled out wherever they sit, so the positional arguments keep the
    # meaning and the order they have always had (render_check.py's rule).
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
