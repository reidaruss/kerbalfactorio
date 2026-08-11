"""
render_ruin.py - the ruin from outside, from INSIDE, and standing on the worst
ground poi.h will admit.

    ~/.local/bin/blender501 --background --python tools/blender/render_ruin.py

Writes docs/screenshots/RN145*_ruin_*.png.

WHY THIS IS NOT render_structures.py AND NOT render_check.py. Both of those
frame an OBJECT: they solve a stand-off from a bounding box and photograph its
outside. That is the right instrument for a 4 m wall panel, and it is
structurally unable to answer either of the two questions this asset actually
raises. `render_station.py` made the first half of the argument already and it
is repeated here because it is the same mistake: AN INTERIOR CANNOT BE JUDGED
FROM OUTSIDE IT. Every exterior view of a walkable ruin is a silhouette, and a
silhouette is exactly the picture in which a chamber with no headroom, no
light and no floor under the doorway looks perfect.

THE SECOND QUESTION IS NEW HERE AND IT IS THE ONE THIS ASSET WAS BUILT AROUND.
`build_ruin.py` claims that 2.30 m of buried course absorbs the worst ground
`poi.h`'s admission gate will pass, with no daylight under the rim. That claim
is arithmetic, and arithmetic can be right about a number and wrong about a
shape. So the third shot does not put the ruin on a flat plane: it builds THE
WORST ADMISSIBLE SURFACE - a 4.0 degree plane (maxTiltDeg) plus a 1.0 m
residual dish (maxResidM), which is the 2.2587 m the derivation is about - sinks
the model by GRADE_Z, and photographs the downhill rim from ground level. The
frame either shows stone meeting soil all the way round or it shows sky under
the plinth. There is no third answer and no camera angle that flatters it.

THE GROUND IS A HEIGHTFIELD MESH AND NOT TWO TILTED PLANES, for the reason
render_structures.add_slab gives about risers: a residual has to be a bump in a
surface, and a surface made of flat pieces has edges where the ruin's skirt
could pass through a gap that no real terrain has.

THE INTERIOR CAMERA IS A PLAYER, NOT A DRONE. The eye sits at EYE_Z above the
cella floor and the frame is CLIENT_FOV_V_DEG wide vertically, because that is
what the shipped camera does. A studio that picks a comfortable 35 mm lens for
an interior is measuring a lens: a 4.20 m chamber shot at 35 mm looks generous,
and the same chamber at the client's 60 degrees is the actual experience.
`sensor_fit` is pinned to VERTICAL and the focal length is derived through
`lens_for`, so `RES` cannot silently change the framing.

THE INTERIOR IS LIT BY THE HOLE IN ITS OWN ROOF AND BY NOTHING ELSE, which is
the one place this rig refuses a convenience the station's rig allowed itself.
The station has emissive light strips and a legitimate argument that a sealed
hull in orbit has no ambient; this room has a bay of fallen roof over the stele
and the whole interior read depends on that being enough. Adding a fill would
answer the question the shot was taken to ask. The sun is therefore steep
enough to reach through the opening, which is stated as a choice rather than
hidden in a rotation.

NO SURFACE MAPS ARE BOUND, AND THAT IS A LIMIT OF THIS RIG RATHER THAN OF THE
ASSET. `render_station.py` has a `--maps` mode; this one does not, so what you
are looking at is the .glb's own per-role albedo, roughness and metalness with
no `of_stone_*` albedo, normal or ORM over them. In the client `Surfaces.ts`
binds those maps by ROLE, so the shipped ruin carries stone grain, a normal map
and a real ORM response that none of these frames show. Read these as a FORM
and VALUE check, not as a material one: a mark that reads as a flat rectangle
here may still read as flat with a map on it, which is worth fixing, but the
absence of surface texture in the frame is the rig.

THE SHADED FACES READ NEAR BLACK and that is one sun plus a dim sky, not a hole
in the mesh. The first hero frame appeared to show black rectangles punched
through the cornices; a close frame at 26 degrees resolved them as the shadowed
+Y faces of the same cornices seen at a glancing angle. Worth writing down
because "there is a hole in the roof" and "that face is in shadow" look
identical at 1500 px across a 35 m subject, and only one of them is a defect.

Cycles on the CPU, for render_check.py's reason: EEVEE wants a GPU context a
headless render node does not reliably have, and a check that only runs on one
machine is not a check.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

RUIN = os.path.join(ROOT, "assets", "models", "dist", "structures", "ruin.glb")
OUT = os.path.join(ROOT, "docs", "screenshots")

# Read off web/src/render/CameraRig.ts (`private fovDeg = 60`) and
# web/src/player/Capsule.ts (`eyeHeightM`). Never typed twice.
CLIENT_FOV_V_DEG = 60.0
EYE_Z = 1.62

# The asset's own datums, restated ONLY as what the frames are read against.
GRADE_Z = 2.30
DECK_Z = 3.30
CELLA_CLEAR = 4.20
STELE = (-12.10, 0.95)
R_BASE = 17.60

# poi.h's gates, and the third shot is built from them rather than from a look.
FOOTPRINT_M = 18.0
MAX_TILT_DEG = 4.0
MAX_RESID_M = 1.0

RES = (1500, 860)
SAMPLES = 44


def lens_for(fov_v_deg, sensor=36.0):
    """Focal length for a VERTICAL field of view. `sensor_fit` is pinned to
    VERTICAL in `world()`, so this is the whole conversion and the resolution
    does not enter it."""
    return sensor / (2.0 * math.tan(math.radians(fov_v_deg) * 0.5))


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def harvest(only):
    """Import the shipped .glb and keep ONE tier's mesh datablock with the
    world matrix it had inside its own file.

    Only one tier, for render_structures' reason: a .glb holds every band as
    siblings and drawing LOD0 on top of LOD1 z-fights in a way that reads
    exactly like broken geometry. It loads from `assets/models/dist`, through
    the importer, so what is judged is the SHIPPED BYTES and not what was in
    memory when the build script ran."""
    bpy.ops.import_scene.gltf(filepath=RUIN)
    kept = None
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name == only:
            kept = (o.data, o.matrix_world.copy())
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    if kept is None:
        raise SystemExit("no mesh named %s in %s" % (only, RUIN))
    obj = bpy.data.objects.new(only + "_inst", kept[0])
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = kept[1]
    return obj


def flat_ground(z):
    """A slab, not a plane: a plane has no edge and the plinth's buried course
    has to be seen meeting something with thickness."""
    add_field(lambda x, y: z, n=2, half=90.0, name="GroundFlat")


def worst_ground():
    """THE WORST SURFACE poi.h's `admit` WILL PASS, built from its own gates.

    tilt      `maxTiltDeg` 4.0 degrees, dropping toward +X
    residual  `maxResidM` 1.0 m of dish on top of the fitted plane

    Together they put the +X rim 18*tan(4) + 1.0 = 2.2587 m below the centre,
    which is the number `build_ruin.GRADE_Z` was set from. The residual is a
    smooth dish rather than noise because the gate measures a p95 residual and
    the worst case for a rim is one that is low ALL THE WAY ROUND that side,
    not one that is low in patches.

    The datum is the site CENTRE, at z = GRADE_Z, because that is the point
    `FSite.pos` names and the point `socket_grade` is placed on."""
    k = math.tan(math.radians(MAX_TILT_DEG))

    def h(x, y):
        r = math.hypot(x, y)
        t = min(1.0, r / FOOTPRINT_M)
        # The dish only bites inside the footprint the gate measured; outside
        # it the ground just keeps falling on the plane, which is what a real
        # slope does.
        return GRADE_Z - k * x - MAX_RESID_M * t * t * (1.0 if x > 0 else 0.35)

    add_field(h, n=64, half=70.0, name="GroundWorst")
    rim = h(FOOTPRINT_M, 0.0)
    print("[render_ruin] worst admissible ground: centre %.4f, +X rim at 18 m "
          "%.4f, drop %.4f m (build_ruin absorbs %.4f)"
          % (GRADE_Z, rim, GRADE_Z - rim, GRADE_Z))


def add_field(h, n, half, name):
    """A heightfield slab: an n x n grid of `h(x, y)` with 40 m of skirt under
    it so nothing can be seen through its own edge."""
    verts, faces = [], []
    step = 2.0 * half / n
    for j in range(n + 1):
        for i in range(n + 1):
            x = -half + step * i
            y = -half + step * j
            verts.append((x, y, h(x, y)))
    top = len(verts)
    for j in range(n + 1):
        for i in range(n + 1):
            x = -half + step * i
            y = -half + step * j
            verts.append((x, y, h(x, y) - 40.0))
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            faces.append((a, a + 1, a + n + 2, a + n + 1))
            b = top + a
            faces.append((b + n + 1, b + n + 2, b + 1, b))
    for i in range(n):
        faces.append((i, top + i, top + i + 1, i + 1))
        a = n * (n + 1)
        faces.append((a + i + 1, top + a + i + 1, top + a + i, a + i))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new("GroundMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.128, 0.108, 0.079, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    me.materials.append(mat)
    return obj


def world(sun_alt_deg, sun_az_deg, energy=4.4):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = SAMPLES
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = RES
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.20, 0.24, 0.30, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = w
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = energy
    sun.data.angle = math.radians(2.0)
    # A Blender sun points down its own -Z, so the first euler is the angle OFF
    # vertical and the third is the bearing. Written out because a sun that is
    # 22 degrees off vertical here is not decoration: it is what decides
    # whether light reaches through the hole in the cella roof.
    sun.rotation_euler = (math.radians(sun_alt_deg), 0.0,
                          math.radians(sun_az_deg))
    scn.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.sensor_fit = "VERTICAL"
    cam.data.clip_start = 0.02
    cam.data.clip_end = 900.0
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def shoot(cam, pos, target, fov_v, name):
    cam.data.lens = lens_for(fov_v)
    cam.location = pos
    look_at(cam, target)
    path = os.path.join(OUT, name + ".png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_ruin] wrote %s" % path)


def scene(sun_alt, sun_az, energy=4.4, only="Ruin_LOD0"):
    """Import FIRST, then light the set: `harvest` clears bpy.data.objects
    wholesale to drop the imported hierarchy once the mesh datablock is banked,
    so anything built before it is deleted too (render_structures' note)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    harvest(only)
    return world(sun_alt, sun_az, energy)


def main():
    # RN-1451, THE HERO. Off the -X / +Y bearing, which is the one that puts
    # the intact cella and the standing colonnade nearest the lens and runs the
    # collapsed +X / -Y quarter away from it. A ruin read from its flattened
    # end first is a pile; read from its standing end it is a building that
    # something happened to, which is the same argument render_station.py makes
    # for its own hero and the reason `damage()` has a direction at all.
    # 68 m of range at 34 degrees is a 41.6 m frame height against a 35.2 m
    # plan and 11.4 m of height, so the whole platform is in with margin.
    cam = scene(58.0, -28.0)
    flat_ground(GRADE_Z)
    shoot(cam, (-34.0, 52.0, 24.0), (-1.0, 1.0, 4.2), 34.0, "RN1451_ruin_hero")

    # RN-1452, THE INTERIOR, at the client's own field of view, standing just
    # inside the doorway on the threshold a player crosses. The target is the
    # stele, 5.3 m ahead and slightly below the eye, where a walking player's
    # eyeline sits. The sun is steep and bears round to +X so it comes through
    # the fallen bay of roof; there is NO fill, on purpose, so the frame
    # reports whether the hole lights the room.
    cam = scene(20.0, 8.0, energy=5.2)
    shoot(cam, (-6.90, 0.0, DECK_Z + EYE_Z),
          (STELE[0], STELE[1], DECK_Z + 1.45), CLIENT_FOV_V_DEG,
          "RN1452_ruin_interior")

    # RN-1453, THE RIM ON THE WORST GROUND poi.h WILL ADMIT. Camera at standing
    # eye height on the downhill (+X) side, low and close, looking back along
    # the plinth face. This is the frame the whole GRADE_Z derivation is for.
    cam = scene(46.0, 24.0)
    worst_ground()
    shoot(cam, (30.0, -17.0, GRADE_Z - 1.6 + EYE_Z), (10.0, -2.0, GRADE_Z),
          40.0, "RN1453_ruin_worstground")

    # RN-1454, THE COLLAPSE. The +X / -Y quarter close, so the rubble under the
    # spans that are GONE, the snapped drums and the blackened deck can be read
    # against the standing colonnade behind them. A wear-with-a-cause claim is
    # only checkable in a frame that holds the cause and the wear at once.
    cam = scene(52.0, 62.0)
    flat_ground(GRADE_Z)
    shoot(cam, (40.0, -34.0, 15.0), (6.0, -4.0, 4.0), 36.0,
          "RN1454_ruin_collapse")


if __name__ == "__main__":
    main()
