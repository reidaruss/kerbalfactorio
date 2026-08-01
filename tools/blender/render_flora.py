"""render_flora.py - look at a tree, and look at a STAND of them.

    blender --background --python tools/blender/render_flora.py -- \\
        assets/models/dist/props/props_canopy.glb docs/screenshots/RN271 \\
        studio:Canopy_Pine_LOD0

    blender --background --python tools/blender/render_flora.py -- \\
        assets/models/dist/props/props_canopy.glb docs/screenshots/RN271 \\
        group:Canopy_Pine,Canopy_Fir,Canopy_Broadleaf:16:7

WHY NOT render_check.py. That harness frames a 1.8 m player: its tallest view
(`site34`) tops out around 8 m, and every canopy tree here is 10.5 to 16.5 m.
It also has no way to draw more than one copy of an asset, and ONE COPY IS
EXACTLY WHAT CANNOT ANSWER THIS PASS'S QUESTION. The defect being fixed is that
a forest repeats one outline; a single hero render of a tree cannot show that
either way, and a lane that only ever renders one tree can ship a beautiful
asset that still tiles.

THE GROUP SHOT IS THE INSTRUMENT AND IT COPIES THE CLIENT'S OWN DISTRIBUTIONS.
`ScatterEmit.ts:153` yaws every instance by a hashed 0 to 2*pi about the
surface normal, and `ScatterLook.scaleFor` draws a width jitter of +/-0.14 and
a height factor of 0.84 to 1.20 (Registry.C). So the stand below draws yaw and
scale from those SAME ranges rather than from taste. If the asset's outline
does not depend on yaw, this render shows a row of identical trees at slightly
different sizes, which is the "before" and is exactly what the frame is meant
to expose.

Cycles on the CPU with a modest sample count, for render_check.py's reason: a
check that only runs where a GPU context exists is not a check. Lighting here
is deliberately plain and is IDENTICAL across a before/after pair. It is not a
look-development statement and must not be read as one: this pass is geometry,
and the lighting exists only so that two geometries can be compared under it.
"""

import math
import os
import random
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]),
                          0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_world(w, h, samples):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.resolution_x = w
    scn.render.resolution_y = h
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.20, 0.23, 0.27, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.4
    sun.data.angle = math.radians(3.0)
    sun.rotation_euler = (math.radians(58), 0.0, math.radians(34))
    bpy.context.scene.collection.objects.link(sun)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 50.0
    cam.data.clip_start = 0.05
    cam.data.clip_end = 900.0
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def add_ground(size=260.0):
    """A neutral floor. Mid grey, matte, no texture: the point of every frame
    here is an OUTLINE against a background, and a patterned floor competes
    with the thing being judged."""
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-size, -size, 0), (size, -size, 0),
                      (size, size, 0), (-size, size, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new("Ground", mesh)
    mat = bpy.data.materials.new("Floor")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.20, 0.20, 0.21, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.92
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def lod0_objects(stem=None):
    """The meshes the client actually draws: _LOD0 only, no collision proxy,
    and for a harvest node only the _Full depletion variant. Rendering a .glb
    raw draws LOD0, LOD1 and LOD2 on top of one another, and two nearly
    coincident surfaces z-fight, which reads exactly like broken geometry."""
    out = []
    for o in list(bpy.data.objects):
        n = o.name
        if o.type != "MESH":
            continue
        if (n.startswith("col_") or not n.endswith("_LOD0")
                or "_Half_" in n or "_Low_" in n or "_Stump_" in n):
            o.hide_render = True
            continue
        if stem is not None and not n.startswith(stem):
            o.hide_render = True
            continue
        out.append(o)
    return out


def bounds_of(objs):
    lo = [1e30] * 3
    hi = [-1e30] * 3
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])
    return lo, hi


def studio(cam, node, out_prefix):
    """One tree on the neutral floor, framed to its own height, from two
    bearings 90 degrees apart. The pair is the point: a single bearing cannot
    show whether an outline depends on which side you are standing on, which
    is the whole property this pass is about."""
    objs = lod0_objects(node.replace("_LOD0", ""))
    lo, hi = bounds_of(objs)
    h = hi[2] - lo[2]
    r = max(hi[0] - lo[0], hi[1] - lo[1])
    # Distance so the tree fills about 80% of the frame height at 50 mm on a
    # 36 mm sensor fitted to the LARGER dimension (here, height).
    d = (h * 1.25) * 50.0 / 24.0
    for tag, az in (("a", -62.0), ("b", 28.0)):
        a = math.radians(az)
        cam.location = (d * math.cos(a), d * math.sin(a), h * 0.52)
        look_at(cam, (0.0, 0.0, h * 0.46))
        path = os.path.join(ROOT, "%s_%s_%s.png"
                            % (out_prefix, node.replace("_LOD0", "").lower(),
                               tag))
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("[render_flora] wrote %s  (h=%.2f w=%.2f)" % (path, h, r))


def group(cam, stems, count, seed, out_prefix, tag="group"):
    """A mid-field stand: `count` instances of the given stems, placed in a
    band 26 to 78 m from the camera, each with its own yaw and non-uniform
    scale drawn from the CLIENT's distributions.

    78 m is not an arbitrary far edge: it is `CANOPY_LOD2_M`, the radius WG-17
    pinned equal to `DETAIL_RADIUS_M`, so everything in this frame is inside
    the band where the game draws these LOD0 meshes. A stand rendered further
    out would be showing impostors and would answer a different question.
    """
    src = {}
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        o.hide_render = True
        for s in stems:
            if o.name.startswith(s + "_LOD0"):
                src.setdefault(s, []).append(o)
    rnd = random.Random(seed)
    placed = 0
    for k in range(count):
        stem = stems[k % len(stems)]
        parts = src.get(stem)
        if not parts:
            continue
        # A band, not a grid: a regular lattice reads as a lattice and would
        # be a second repetition on top of the one being measured.
        depth = 26.0 + 52.0 * (k + 0.15 + 0.7 * rnd.random()) / count
        lateral = (rnd.random() * 2.0 - 1.0) * depth * 0.46
        # ScatterLook.scaleFor: width jitter +/- 0.14, height 0.84 to 1.20 of
        # the width, applied about the prop's own up axis.
        w = 1.0 + (rnd.random() * 2.0 - 1.0) * 0.14
        hgt = w * (0.84 + rnd.random() * 0.36)
        yaw = rnd.random() * 2.0 * math.pi
        for o in parts:
            c = o.copy()
            c.data = o.data
            c.hide_render = False
            c.location = (lateral, depth, 0.0)
            c.rotation_euler = (0.0, 0.0, yaw)
            c.scale = (w, w, hgt)
            bpy.context.scene.collection.objects.link(c)
        placed += 1
    cam.data.lens = 38.0
    cam.location = (0.0, -13.0, 5.4)
    look_at(cam, (0.0, 46.0, 7.4))
    path = os.path.join(ROOT, "%s_%s.png" % (out_prefix, tag))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_flora] wrote %s  (%d instances)" % (path, placed))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 3:
        print(__doc__)
        return
    glb, out_prefix, shots = argv[0], argv[1], argv[2:]
    w, h, samples = 720, 640, 28
    if shots[0].startswith("group"):
        w, h, samples = 1100, 520, 22
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = setup_world(w, h, samples)
    bpy.ops.import_scene.gltf(
        filepath=glb if os.path.isabs(glb) else os.path.join(ROOT, glb))
    add_ground()
    os.makedirs(os.path.join(ROOT, os.path.dirname(out_prefix)), exist_ok=True)
    for shot in shots:
        kind, rest = shot.split(":", 1)
        if kind == "studio":
            studio(cam, rest, out_prefix)
        elif kind == "group":
            stems, count, seed = rest.split(":")
            group(cam, stems.split(","), int(count), int(seed), out_prefix)
        elif kind == "groupone":
            stem, count, seed = rest.split(":")
            group(cam, [stem], int(count), int(seed), out_prefix,
                  tag="group_" + stem.lower())
        else:
            print("[render_flora] unknown shot %r" % shot)


if __name__ == "__main__":
    main()
